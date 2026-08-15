const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.55 편성표 (core/party.js, 설계 docs/design-편성표.md)
//
// 배경: 레코드 층 순서 2 — "파티 편성표는 레코드 없이 지금 재료로 된다".
// 슬롯 = enum 변수(제작자가 후보 확정 — AI는 명사를 못 만든다), 보유 = list 변수(roster),
// 표시 = statusUI when 분기. 이 테스트는 순수 로직(view/apply)·검증·/액션 명령을 굴린다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const party = SC.require('party');
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

// 공용 픽스처 — RPG 템플릿과 같은 구조의 최소본
const BASE = {
  simcore: '0.1',
  meta: { name: '편성 테스트' },
  vars: [
    { id: 'allies', label: '동료', type: 'list', init: ['아린', '바크 @3일'] },
    { id: 'front', label: '전위', type: 'enum', init: '없음', enum: ['없음', '아린', '바크', '셀레네'] },
    { id: 'rear', label: '후위', type: 'enum', init: '없음', enum: ['없음', '아린', '바크', '셀레네'] },
    { id: 'hp', label: '체력', type: 'int', init: 10, min: 0, max: 20 },
  ],
  updater: { allow: [{ id: 'hp', maxDelta: 5 }] },
  party: {
    label: '편성', icon: '⚔️', empty: '없음', roster: 'allies',
    slots: [{ var: 'front', label: '전위' }, { var: 'rear' }],
  },
};
const clone = (o) => JSON.parse(J(o));

// ── 1. 검증 ─────────────────────────────────────────────────
{
  const v = validateSchema(BASE);
  ck('★ 정상 편성표 검증 통과', v.ok, J(v.errors));

  const noEnum = clone(BASE);
  noEnum.party.slots[0].var = 'hp';
  ck('슬롯 변수가 enum이 아니면 오류', validateSchema(noEnum).errors.some((e) => /enum 타입이어야/.test(e.msg)), '');

  const badEmpty = clone(BASE);
  badEmpty.party.empty = '공석';
  ck('빈값이 슬롯 enum에 없으면 오류', validateSchema(badEmpty).errors.some((e) => /비울 수 없게/.test(e.msg)), '');

  const badRoster = clone(BASE);
  badRoster.party.roster = 'hp';
  ck('보유 목록이 list가 아니면 오류', validateSchema(badRoster).errors.some((e) => /list 타입이어야/.test(e.msg)), '');

  const dup = clone(BASE);
  dup.party.slots[1].var = 'front';
  ck('슬롯 변수 중복 오류', validateSchema(dup).errors.some((e) => /중복/.test(e.msg)), '');

  const ghost = clone(BASE);
  ghost.party.slots[0].var = 'nobody';
  ck('없는 변수 참조 오류', validateSchema(ghost).errors.some((e) => /vars에 없음/.test(e.msg)), '');

  const noEmpty = clone(BASE);
  delete noEmpty.party.empty;
  const ne = validateSchema(noEmpty);
  ck('empty 없으면 경고 (오류 아님)', ne.ok && ne.warnings.some((w) => /empty/.test(w.msg)), J(ne.warnings));

  const noParty = clone(BASE);
  delete noParty.party;
  ck('party 없는 스키마는 그대로 통과', validateSchema(noParty).ok, '');
}

// ── 2. partyView — 후보·잠금·자리 (축약형 = 탭 1개) ──────────
{
  const state = engine.initState(BASE);
  const view = party.partyView(BASE, state);
  const slots = view.tabs[0].slots;
  ck('★ 뷰 기본 — 탭 1개·슬롯 2개·라벨', view.tabs.length === 1 && slots.length === 2 && slots[0].label === '전위' && slots[1].label === '후위', J(slots.map((s) => s.label)));
  ck('빈 슬롯 표시', slots[0].isEmpty === true, '');
  const names = slots[0].candidates.map((c) => c.name);
  ck('후보에서 빈값 제외', J(names) === J(['아린', '바크', '셀레네']), J(names));
  // roster 잠금 — 아린은 보유, 바크는 "@기한" 꼬리가 붙어도 보유로 친다, 셀레네는 미보유
  const lockOf = (n) => slots[0].candidates.find((c) => c.name === n).locked;
  ck('★ roster 잠금 — 미보유만 잠긴다', !lockOf('아린') && !lockOf('바크') && lockOf('셀레네'),
    J(slots[0].candidates));
  ck('rosterName — 목록 규약 꼬리 제거', party.rosterName('바크 @3일') === '바크' && party.rosterName('아린 +2') === '아린', '');

  state.vars.front = '아린';
  const v2 = party.partyView(BASE, state);
  ck('usedBy — 딴 슬롯에 앉은 인물 표시', v2.tabs[0].slots[1].candidates.find((c) => c.name === '아린').usedBy === 'front', '');
  ck('자기 슬롯에서는 usedBy 없음', v2.tabs[0].slots[0].candidates.find((c) => c.name === '아린').usedBy === null, '');

  ck('party 없는 스키마 뷰는 null', party.partyView({ vars: [] }, state) === null, '');
  const spec = party.partyButtonSpec(BASE);
  ck('버튼 사양', spec.label === '편성' && spec.icon === '⚔️', J(spec));
}

// ── 3. applyPartyPick — 앉히기·이동·맞교환·거부 ──────────────
{
  const state = engine.initState(BASE);
  const r1 = party.applyPartyPick(BASE, state, 'front', '아린');
  ck('★ 편성 — 바뀔 값만 돌려준다', r1.ok && J(r1.changes) === J({ front: '아린' }), J(r1));
  Object.assign(state.vars, r1.changes);

  const r2 = party.applyPartyPick(BASE, state, 'rear', '아린');
  ck('★ 중복 편성 = 이동 (원래 자리 비움)', r2.ok && r2.changes.rear === '아린' && r2.changes.front === '없음' && r2.moved.from === 'front', J(r2));
  Object.assign(state.vars, r2.changes);

  const r3 = party.applyPartyPick(BASE, state, 'front', '셀레네');
  ck('미보유 인물 거부 + 이유', !r3.ok && /보유하지 않음/.test(r3.reason), J(r3));

  const r4 = party.applyPartyPick(BASE, state, 'front', '괴물');
  ck('enum 밖 값 거부', !r4.ok && /후보에 없음/.test(r4.reason), J(r4));

  const r5 = party.applyPartyPick(BASE, state, 'rear', '없음');
  ck('비우기 — roster와 무관하게 허용', r5.ok && r5.changes.rear === '없음', J(r5));

  const r6 = party.applyPartyPick(BASE, state, 'hp', '아린');
  ck('슬롯 아닌 변수 거부', !r6.ok, '');

  state.vars.rear = '아린';
  const r7 = party.applyPartyPick(BASE, state, 'rear', '아린');
  ck('같은 값 재선택 = 변화 없음', r7.ok && J(r7.changes) === J({}), J(r7));

  // 빈값 없는 스키마 — 이동 대신 맞교환
  const noEmpty = clone(BASE);
  delete noEmpty.party.empty;
  const st2 = engine.initState(noEmpty);
  st2.vars.front = '아린'; st2.vars.rear = '바크';
  const r8 = party.applyPartyPick(noEmpty, st2, 'front', '바크');
  ck('★ 빈값 없으면 맞교환', r8.ok && r8.changes.front === '바크' && r8.changes.rear === '아린', J(r8));
}

// ── 3.5 탭 (v0.56) — 칸코레 모델: 함대 여럿 + 시설(수복·제작) 탭 ──
{
  // 함대 2개 + 수복(별도 roster) + 제작(슬롯 없이 버튼만)
  const KAN = {
    simcore: '0.1',
    meta: { name: '칸코레풍' },
    vars: [
      { id: 'ships', label: '보유 함선', type: 'list', init: ['무라쿠모', '시구레', '유키카제'] },
      { id: 'dock_q', label: '수복 대기', type: 'list', init: ['시구레'] },
      { id: 'f1_flag', label: '1함대 기함', type: 'enum', init: '없음', enum: ['없음', '무라쿠모', '시구레', '유키카제'] },
      { id: 'f2_flag', label: '2함대 기함', type: 'enum', init: '없음', enum: ['없음', '무라쿠모', '시구레', '유키카제'] },
      { id: 'dock1', label: '독 1', type: 'enum', init: '없음', enum: ['없음', '무라쿠모', '시구레', '유키카제'] },
      { id: 'res', label: '자원', type: 'int', init: 100, min: 0 },
    ],
    actions: [
      { id: 'sortie', label: '⚓ 출격', mode: 'oneshot', effects: [] },
      { id: 'build', label: '🔨 건조', mode: 'oneshot', when: 'res >= 50', effects: [{ set: 'res', expr: 'res - 50' }] },
    ],
    party: {
      label: '함대', icon: '⚓', empty: '없음', roster: 'ships',
      tabs: [
        { id: 'f1', label: '제1함대', slots: [{ var: 'f1_flag', label: '기함' }], actions: ['sortie'] },
        { id: 'f2', label: '제2함대', slots: [{ var: 'f2_flag', label: '기함' }] },
        { id: 'dock', label: '수복', roster: 'dock_q', slots: [{ var: 'dock1' }] },
        { id: 'fac', label: '제작', actions: ['build'] },
      ],
    },
  };
  const v = validateSchema(KAN);
  ck('★ 탭 스키마 검증 통과', v.ok, J(v.errors));

  const state = engine.initState(KAN);
  const view = party.partyView(KAN, state, {
    actionStates: [{ id: 'sortie', label: '⚓ 출격', armed: false, disabled: false, reason: '' },
      { id: 'build', label: '🔨 건조', armed: true, disabled: false, reason: '' }],
  });
  ck('★ 탭 4개 — 라벨·순서', J(view.tabs.map((t) => t.label)) === J(['제1함대', '제2함대', '수복', '제작']), J(view.tabs.map((t) => t.label)));
  ck('시설 탭 — 슬롯 0 + 액션 1', view.tabs[3].slots.length === 0 && view.tabs[3].actions.length === 1, '');
  ck('★ 탭 액션이 호스트 상태와 짝', view.tabs[0].actions[0].label === '⚓ 출격' && view.tabs[3].actions[0].armed === true, J(view.tabs[3].actions));
  ck('탭별 roster — 수복은 대기열만 연다',
    view.tabs[2].slots[0].candidates.filter((c) => !c.locked).map((c) => c.name).join() === '시구레',
    J(view.tabs[2].slots[0].candidates));
  ck('공용 roster — 함대 탭은 보유 전체', view.tabs[0].slots[0].candidates.every((c) => !c.locked), '');

  // 탭을 가로지르는 한 자리 원칙 — 1함대 기함을 2함대에 앉히면 이동해 온다
  state.vars.f1_flag = '무라쿠모';
  const v2 = party.partyView(KAN, state);
  ck('★ 교차 탭 usedBy', v2.tabs[1].slots[0].candidates.find((c) => c.name === '무라쿠모').usedBy === 'f1_flag', '');
  const mv = party.applyPartyPick(KAN, state, 'f2_flag', '무라쿠모');
  ck('★ 교차 탭 이동', mv.ok && mv.changes.f2_flag === '무라쿠모' && mv.changes.f1_flag === '없음', J(mv));

  // 검증 — 탭 구조의 새 오류들
  const dupX = clone(KAN);
  dupX.party.tabs[1].slots[0].var = 'f1_flag';
  ck('교차 탭 슬롯 중복 오류', validateSchema(dupX).errors.some((e) => /탭이 달라도/.test(e.msg)), '');
  const badAct = clone(KAN);
  badAct.party.tabs[0].actions = ['launch_nukes'];
  ck('없는 액션 id 오류', validateSchema(badAct).errors.some((e) => /actions에 없는 액션/.test(e.msg)), '');
  const emptyTab = clone(KAN);
  emptyTab.party.tabs.push({ id: 'nothing', label: '빈 탭' });
  ck('슬롯도 액션도 없는 탭 오류', validateSchema(emptyTab).errors.some((e) => /슬롯도 액션도 없는/.test(e.msg)), '');
  const mixed = clone(KAN);
  mixed.party.slots = [{ var: 'f1_flag' }];
  ck('tabs+최상위 slots 혼용 오류', validateSchema(mixed).errors.some((e) => /같이 쓸 수 없음/.test(e.msg)), '');
  const dupTabId = clone(KAN);
  dupTabId.party.tabs[1].id = 'f1';
  ck('탭 id 중복 오류', validateSchema(dupTabId).errors.some((e) => /중복된 탭 id/.test(e.msg)), '');

  // 축약형 하위 호환 — v0.55 스키마(BASE)가 탭 하나로 정규화된다
  const tabs = party.partyTabs(BASE);
  ck('★ 축약형 = 탭 1개로 정규화', tabs.length === 1 && tabs[0].slots.length === 2 && tabs[0].roster === 'allies', J(tabs));
}

// ── 3.7 초상 (v0.57) — 이름 → 에셋 이름 매핑 ─────────────────
{
  const P = clone(BASE);
  P.party.portraits = { '아린': 'arin_profile', '바크': 'bark_profile.png' };
  const v = validateSchema(P);
  ck('★ portraits 검증 통과', v.ok, J(v.errors));

  const state = engine.initState(P);
  state.vars.front = '아린';
  const view = party.partyView(P, state);
  const slot = view.tabs[0].slots[0];
  ck('★ 슬롯에 초상 이름 실림', slot.portrait === 'arin_profile', J(slot.portrait));
  ck('후보 칩에도 실림', slot.candidates.find((c) => c.name === '바크').portrait === 'bark_profile.png', '');
  ck('매핑 없는 인물은 null (글자 폴백)', slot.candidates.find((c) => c.name === '셀레네').portrait === null, '');
  ck('빈 슬롯은 초상 없음', view.tabs[0].slots[1].portrait === null, '');

  const typo = clone(P);
  // ── 초상 이름 맞추기 (v0.83.2) ──
  // ⚠ 실측 사고: 이름 안에 점이 있는 에셋(Nakano_Miku.default.avif)에서 짝이 안 맞았다.
  //   꼬리 하나를 떼는 규칙은 'Nakano_Miku.default'에서 .default를 확장자로 착각해
  //   'Nakano_Miku'까지 깎는다. 편성표에 얼굴이 하나도 안 뜨는데 오류는 없는 종류의 사고다.
  {
    const { matchAssetName } = SC.require('party');
    const A = [['Nakano_Miku.default.avif', 'a1', 'avif'], ['bark_profile.png', 'a2', 'png'],
      ['arin_profile', 'a3', 'png']];
    const got = (w) => { const r = matchAssetName(A, w); return r ? r[0] : null; };
    ck('★ 이름에 점이 있어도 확장자만 떼고 맞춘다',
      got('Nakano_Miku.default') === 'Nakano_Miku.default.avif', String(got('Nakano_Miku.default')));
    ck('★ 확장자까지 그대로 적어도 맞는다',
      got('Nakano_Miku.default.avif') === 'Nakano_Miku.default.avif', '');
    ck('대소문자·앞뒤 공백은 무시', got('  nakano_miku.DEFAULT  ') === 'Nakano_Miku.default.avif', '');
    ck('에셋에만 확장자가 있어도 맞는다', got('bark_profile') === 'bark_profile.png', '');
    ck('적은 쪽에만 확장자가 있어도 맞는다', got('arin_profile.png') === 'arin_profile', '');
    ck('없는 이름은 null (조용히 글자 폴백)', got('Nobody_here') === null, '');
    ck('빈 이름은 null (아무 에셋이나 걸리지 않는다)', matchAssetName(A, '   ') === null, '');
    ck('어댑터가 이 함수를 쓴다 (규칙을 한 군데 둔다)',
      src.includes('partyMod.matchAssetName(char?.additionalAssets'), '');
  }

  typo.party.portraits['셀레나'] = 'x';
  ck('명단에 없는 이름은 경고 (오타 감지)', validateSchema(typo).warnings.some((w) => /오타이거나/.test(w.msg)), '');
  const bad = clone(P);
  bad.party.portraits = ['x'];
  ck('배열이면 오류', validateSchema(bad).errors.some((e) => /객체여야/.test(e.msg)), '');
  const blank = clone(P);
  blank.party.portraits['아린'] = ' ';
  ck('빈 에셋 이름 오류', validateSchema(blank).errors.some((e) => /비어 있음/.test(e.msg)), '');
}

// ── 3.8 업그레이드 (v0.58) — 스킬트리·시설 레벨·특성 찍기 ────
{
  const SK = {
    simcore: '0.1',
    meta: { name: '수련 테스트' },
    vars: [
      { id: 'sp', label: 'SP', type: 'int', init: 4, min: 0, max: 99 },
      { id: 'gold', label: '골드', type: 'int', init: 100, min: 0 },
      { id: 'sword', label: '검술', type: 'int', init: 0, min: 0, max: 5 },
      { id: 'heal', label: '치유술', type: 'int', init: 0, min: 0, max: 3 },
      { id: 'trait_iron', label: '강철 체질', type: 'int', init: 0, min: 0, max: 1 },
      { id: 'mine', label: '광산', type: 'int', init: 1, min: 0, max: 4 },
    ],
    party: {
      label: '성장', icon: '📖', points: 'sp',
      tabs: [
        { id: 'skill', label: '스킬',
          items: [
            { var: 'sword', cost: 1 },
            { var: 'heal', cost: 1, requires: 'sword >= 2', requiresLabel: '검술 2 필요' },
            { var: 'trait_iron', cost: 2, note: 'max 1 = 특성' },
          ] },
        { id: 'estate', label: '영지', points: 'gold',
          items: [{ var: 'mine', cost: '(mine + 1) * 30' }] },
      ],
    },
  };
  const v = validateSchema(SK);
  ck('★ 업그레이드 스키마 검증 통과', v.ok, J(v.errors));

  const state = engine.initState(SK);
  const view = party.partyView(SK, state);
  const skill = view.tabs[0];
  ck('★ 포인트 헤더 — 탭별 자원', skill.points.label === 'SP' && skill.points.value === 4
    && view.tabs[1].points.var === 'gold', J([skill.points, view.tabs[1].points]));
  ck('항목 뷰 — 레벨·최대', skill.items[0].level === 0 && skill.items[0].max === 5, J(skill.items[0]));
  ck('★ 선행 조건 잠금 + 제작자 문구', skill.items[1].locked && skill.items[1].reason === '검술 2 필요', J(skill.items[1]));
  ck('비용식 — 현재 레벨 참조 (점증)', view.tabs[1].items[0].cost === 60, J(view.tabs[1].items[0].cost));

  const r1 = party.applyUpgrade(SK, state, 'sword');
  ck('★ 찍기 — 레벨 +1, 포인트 차감', r1.ok && r1.changes.sword === 1 && r1.changes.sp === 3, J(r1));
  Object.assign(state.vars, r1.changes);
  Object.assign(state.vars, party.applyUpgrade(SK, state, 'sword').changes);
  const v2 = party.partyView(SK, state);
  ck('검술 2 → 치유술 해금', !v2.tabs[0].items[1].locked, J(v2.tabs[0].items[1]));

  const r2 = party.applyUpgrade(SK, state, 'trait_iron');
  ck('특성(max 1) 찍기', r2.ok && r2.changes.trait_iron === 1, J(r2));
  Object.assign(state.vars, r2.changes);
  ck('SP 0 도달', state.vars.sp === 0, String(state.vars.sp));
  const r3 = party.applyUpgrade(SK, state, 'heal');
  ck('★ 포인트 부족 거부', !r3.ok && /포인트 부족/.test(r3.reason), J(r3));
  const r4 = party.applyUpgrade(SK, state, 'trait_iron');
  ck('최대 레벨 거부', !r4.ok && /최대 레벨/.test(r4.reason), J(r4));
  const r5 = party.applyUpgrade(SK, state, 'mine');
  ck('★ 영지 탭 — 골드로 시설 레벨', r5.ok && r5.changes.mine === 2 && r5.changes.gold === 40, J(r5));
  ck('없는 항목 거부', !party.applyUpgrade(SK, state, 'hp').ok, '');

  // nav (v0.58.1) — 탭 표시 방식은 제작자 선택
  const navSel = clone(SK);
  navSel.party.nav = 'select';
  ck('nav=select 검증 통과', validateSchema(navSel).ok, '');
  const navBad = clone(SK);
  navBad.party.nav = 'dropdown';
  ck('nav 오타 오류', validateSchema(navBad).errors.some((e) => /tabs.*select/.test(e.msg)), '');

  // 검증 — 새 오류들
  const badVar = clone(SK);
  badVar.party.tabs[0].items[0].var = 'nobody';
  ck('없는 변수 오류', validateSchema(badVar).errors.some((e) => /vars에 없음/.test(e.msg)), '');
  const notInt = clone(SK);
  notInt.vars.push({ id: 'mood', label: '기분', type: 'text', init: '' });
  notInt.party.tabs[0].items[0].var = 'mood';
  ck('int 아니면 오류', validateSchema(notInt).errors.some((e) => /int 타입이어야/.test(e.msg)), '');
  const noPts = clone(SK);
  delete noPts.party.points; delete noPts.party.tabs[0].points;
  ck('비용 있는데 포인트 없음 오류', validateSchema(noPts).errors.some((e) => /포인트 변수.*없습니다/.test(e.msg)), '');
  const badReq = clone(SK);
  badReq.party.tabs[0].items[1].requires = 'ghost >= 1';
  ck('선행 조건의 없는 변수 오류', validateSchema(badReq).errors.some((e) => /알 수 없는 변수/.test(e.msg)), '');
}

// ── 4. /액션 내장 명령 — 플로팅 버튼 제거(v0.55)의 폴백 통로 ──
{
  const schema = {
    simcore: '0.1',
    vars: [{ id: 'hp', label: '체력', type: 'int', init: 10, min: 0, max: 20 }],
    actions: [
      { id: 'atk', label: '⚔ 공격', mode: 'oneshot', effects: [] },
      { id: 'guard', label: '🛡 방어', mode: 'hold', when: 'hp >= 5', effects: [] },
    ],
  };
  const state = engine.initState(schema);
  const r1 = engine.applyChatCommands(schema, state, '/액션 공격');
  ck('★ /액션 — 라벨 부분일치로 무장', r1.meta?.armed?.atk === true && /켜짐/.test(r1.text), J([r1.text, r1.meta?.armed]));
  ck('applied에 액션 기록', r1.applied.some((a) => a.id === 'action:atk' && a.how === '무장'), J(r1.applied));

  // 켠 상태에서 다시 — 해제
  const armedState = { ...state, meta: { ...state.meta, armed: { atk: true } } };
  const r2 = engine.applyChatCommands(schema, armedState, '/액션 공격');
  ck('/액션 재입력 = 해제', r2.meta?.armed?.atk === undefined && /꺼짐/.test(r2.text), J(r2.text));

  // 조건 미충족 차단 — toggleAction과 같은 검증
  const hurt = { ...state, vars: { hp: 2 } };
  const r3 = engine.applyChatCommands(schema, hurt, '/액션 방어');
  ck('★ 조건 미충족이면 차단 + 이유', r3.meta === null && /조건 미충족/.test(r3.text), J(r3.text));

  const r4 = engine.applyChatCommands(schema, state, '/액션');
  ck('인자 없으면 사용법 안내', /이렇게 켜고 끕니다/.test(r4.text) && /공격/.test(r4.text), J(r4.text));

  const r5 = engine.applyChatCommands(schema, state, '/액션 2');
  ck('번호로도 토글', r5.meta?.armed?.guard === true, J(r5.meta?.armed));

  // 변수 명령이 '액션' 이름을 선점하면 내장은 비켜난다 (하위 호환)
  const custom = clone(schema);
  custom.vars.push({ id: 'note', label: '메모', type: 'text', init: '', cmd: '액션' });
  const r6 = engine.applyChatCommands(custom, engine.initState(custom), '/액션 뭔가');
  ck('변수 cmd가 선점하면 내장 양보', r6.meta === null && r6.applied.some((a) => a.id === 'note'), J(r6.applied));

  // 액션 없는 스키마 — /액션은 유저 글로 취급
  const noAct = { simcore: '0.1', vars: [{ id: 'hp', type: 'int', init: 1, label: 'x', cmd: '체력' }] };
  const r7 = engine.applyChatCommands(noAct, engine.initState(noAct), '/액션 공격');
  ck('액션 없으면 건드리지 않음', r7.text === '/액션 공격', J(r7.text));
}

// ── 5. RPG 템플릿 — 편성표 예시가 실제로 돌아간다 ────────────
{
  const t = TEMPLATES.rpg?.schema ?? Object.values(TEMPLATES).find((x) => x.schema?.party)?.schema;
  ck('★ 편성표 실린 템플릿 존재', !!t?.party, '');
  if (t?.party) {
    const v = validateSchema(t);
    ck('★ 템플릿 검증 통과', v.ok, J(v.errors));
    const state = engine.initState(t);
    const view = party.partyView(t, state);
    const slots = view.tabs[0].slots;
    ck('템플릿 뷰 — 슬롯 2·시작은 빈 편성', slots.length === 2 && slots.every((s) => s.isEmpty), J(slots));
    ck('시작 보유(아린)만 열려 있다', slots[0].candidates.filter((c) => !c.locked).map((c) => c.name).join() === '아린', J(slots[0].candidates));
    ck('액션 연결(rest)이 첫 탭에 실린다 (v0.56)', view.tabs[0].actions.some((a) => a.id === 'rest'), J(view.tabs[0].actions));
    const r = party.applyPartyPick(t, state, slots[0].var, '아린');
    ck('템플릿에서 편성 동작', r.ok && Object.values(r.changes)[0] === '아린', J(r));
  }
}

// ── 6. 편성 연동 (v0.59) — deployed 가상 목록 + 탭 표시 조건(when) ──
// 유저 제안: "편성에 들어온 애들만 상태창에 보여주기, 스킬창 목록에서도".
// deployed는 allIds(검증)와 makeLookup(실행) 두 관문에만 꽂혀 모든 조건식 자리에서 통한다.
{
  const { evaluate, truthy } = SC.require('expr');

  // deployed 가상 목록 — makeLookup
  const state = engine.initState(BASE);
  const dep = () => evaluate('deployed', engine.makeLookup(BASE, state.vars), null);
  ck('★ deployed — 아무도 없으면 빈 목록', J(dep()) === J([]), J(dep()));
  state.vars.front = '아린';
  state.vars.rear = '바크';
  ck('★ deployed — 앉은 이름들 (빈값 제외)', J(dep()) === J(['아린', '바크']), J(dep()));
  ck('★ has(deployed, ...) — showWhen·이벤트·requires에 쓰는 실전형',
    truthy(evaluate("has(deployed, '아린')", engine.makeLookup(BASE, state.vars), null))
    && !truthy(evaluate("has(deployed, '셀레네')", engine.makeLookup(BASE, state.vars), null)), '');
  ck('party 없는 스키마에서 deployed는 미정의 변수',
    (() => { try { evaluate('deployed', engine.makeLookup({ vars: [], party: null }, {}), null); return false; }
      catch (e) { return /알 수 없는 변수/.test(e.message); } })(), '');
  // 같은 id의 실제 변수가 있으면 그쪽이 이긴다 (기존 스키마 호환)
  const shadow = clone(BASE);
  shadow.vars.push({ id: 'deployed', label: '주둔지', type: 'text', init: '요새' });
  ck('deployed 변수가 있으면 그 값이 이긴다',
    evaluate('deployed', engine.makeLookup(shadow, engine.initState(shadow).vars), null) === '요새', '');
  const sv = validateSchema(shadow);
  ck('그림자 경고 — deployed 변수 + 편성표', sv.warnings.some((w) => /deployed/.test(w.msg)), J(sv.warnings));

  // 검증 — deployed 참조 허용 여부는 편성표 유무를 따른다
  const withRef = clone(BASE);
  withRef.directives = [{ id: 'd1', when: "has(deployed, '아린')", text: '[편성] 아린 동행: {deployed}' }];
  const vr = validateSchema(withRef);
  ck('★ 검증 — party 있으면 deployed 참조·자리표시자 통과', vr.ok, J(vr.errors));
  const noP = clone(withRef);
  delete noP.party;
  ck('검증 — party 없으면 deployed는 알 수 없는 변수',
    validateSchema(noP).errors.some((e) => /알 수 없는 변수 'deployed'/.test(e.msg)), '');

  // 탭 표시 조건 — 편성된 인물의 스킬트리 탭만 남기기
  const GATED = clone(BASE);
  GATED.vars.push(
    { id: 'sp', label: 'SP', type: 'int', init: 3, min: 0, max: 99 },
    { id: 'arin_sword', label: '아린 검술', type: 'int', init: 0, min: 0, max: 5 },
  );
  delete GATED.party.slots;
  GATED.party.tabs = [
    { id: 'main', label: '편성', slots: [{ var: 'front', label: '전위' }, { var: 'rear' }] },
    { id: 'arin', label: '아린 수련', when: "has(deployed, '아린')", points: 'sp',
      items: [{ var: 'arin_sword', cost: 1 }] },
  ];
  const gv = validateSchema(GATED);
  ck('★ 탭 when 검증 통과', gv.ok, J(gv.errors));
  const badWhen = clone(GATED);
  badWhen.party.tabs[1].when = 'has(nobody_list, "x")';
  ck('탭 when의 없는 변수는 오류', validateSchema(badWhen).errors.some((e) => /알 수 없는 변수/.test(e.msg)), '');
  const allGated = clone(GATED);
  allGated.party.tabs[0].when = 'hp > 0';
  ck('모든 탭에 when이면 경고', validateSchema(allGated).warnings.some((w) => /모든 탭에 표시 조건/.test(w.msg)), '');

  const gs = engine.initState(GATED);
  const hidden = party.partyView(GATED, gs);
  ck('★ 미편성 — 수련 탭이 숨는다', hidden.tabs.length === 1 && hidden.tabs[0].id === 'main', J(hidden.tabs.map((t) => t.id)));
  ck('숨은 탭의 항목은 찍기 거부 아님 확인 — 뷰에서만 숨는다 (자리·검증은 유효)',
    party.allItems(GATED).length === 1, '');
  gs.vars.front = '아린';
  const shown = party.partyView(GATED, gs);
  ck('★ 아린 편성 → 수련 탭이 나타난다', shown.tabs.length === 2 && shown.tabs[1].id === 'arin', J(shown.tabs.map((t) => t.id)));
  // 깨진 식은 보이는 쪽으로 (조용히 사라지면 원인을 못 찾는다)
  const broken = clone(GATED);
  broken.party.tabs[1].when = 'has(';
  ck('깨진 when은 탭을 숨기지 않는다', party.partyView(broken, engine.initState(broken)).tabs.length === 2, '');

  // 진단 — deployed를 보는 액션/이벤트는 편성 게이트 (오탐 방지, v0.52 원칙)
  const DIAG = clone(GATED);
  DIAG.actions = [{ id: 'duo', label: '🗡 합격술', mode: 'oneshot', when: "has(deployed, '아린')",
    inject: '[액션] 아린과 합을 맞춘다.', effects: [{ set: 'hp', expr: 'min(hp + 1, 20)' }] }];
  DIAG.rules = { events: [{ id: 'arin_ev', when: "has(deployed, '아린') and hp < 5",
    effects: [{ set: 'hp', expr: 'hp + 2' }], notify: '아린이 감쌌다' }] };
  const dv = validateSchema(DIAG);
  ck('진단 픽스처 검증 통과', dv.ok, J(dv.errors));
  const findings = SC.require('diagnose').diagnose(DIAG, { runs: 3, turns: 30 }).findings;
  ck('★ deployed 조건 액션 = 편성 담당 문턱 (못 쓰는 액션 아님)',
    findings.some((x) => x.tag === '편성 담당 문턱') && !findings.some((x) => x.tag === '못 쓰는 액션'),
    J(findings.map((x) => x.tag)));
  ck('★ deployed 조건 이벤트 = 편성 담당 이벤트 (죽은 이벤트 아님)',
    findings.some((x) => x.tag === '편성 담당 이벤트') && !findings.some((x) => x.tag === '죽은 이벤트'),
    J(findings.map((x) => x.tag)));
}

// ── 7. 편성표 정적 진단 (v0.60) — 팝업 경제의 죽은 경로 ──
// 편성·찍기는 시뮬 밖("측정 불가" 원칙)이라, 그 반대급부로 정말 죽은 경로도 침묵했다.
// 수입 없는 포인트·영입 경로 없는 잠금·영영 안 열리는 탭은 정적으로 잡는다.
{
  const diagnose = SC.require('diagnose').diagnose;
  const tags = (s) => diagnose(s, { runs: 2, turns: 20 }).findings.map((x) => x.tag);

  const DEAD = clone(BASE);
  DEAD.vars.push({ id: 'sp', label: 'SP', type: 'int', init: 3, min: 0, max: 99 },
    { id: 'skill_a', label: '검술', type: 'int', init: 0, min: 0, max: 5 });
  delete DEAD.party.slots;
  DEAD.party.tabs = [
    { id: 'main', label: '편성', slots: [{ var: 'front' }, { var: 'rear' }] },
    { id: 'train', label: '수련', points: 'sp', items: [{ var: 'skill_a', cost: 1 }] },
  ];
  ck('진단 픽스처 검증 통과', validateSchema(DEAD).ok, J(validateSchema(DEAD).errors));

  // ① 못 버는 포인트 — sp를 올려 주는 곳이 어디에도 없다
  ck('★ 수입 없는 포인트 → 못 버는 포인트', tags(DEAD).includes('못 버는 포인트'), J(tags(DEAD)));
  const EARN = clone(DEAD);
  EARN.rules = { events: [{ id: 'lv', when: 'hp >= 10', once: true,
    effects: [{ set: 'sp', expr: 'min(sp + 1, 99)' }], notify: '수련 포인트를 얻었다' }] };
  ck('지급 이벤트가 생기면 안 뜬다', !tags(EARN).includes('못 버는 포인트'), J(tags(EARN)));

  // ② 영입 경로 없음 — 셀레네가 roster에 없는데 allies를 움직이는 곳도 없다
  ck('★ 영입 경로 없음 (잠긴 후보 + 목록 이동 경로 전무)', tags(DEAD).includes('영입 경로 없음'), J(tags(DEAD)));
  const RECRUIT = clone(DEAD);
  RECRUIT.updater.allow.push({ id: 'allies' });
  ck('보유 목록이 AI 허용이면 안 뜬다 (서사 영입 가능)', !tags(RECRUIT).includes('영입 경로 없음'), J(tags(RECRUIT)));

  // ③ 열리지 않는 탭 — when이 시작부터 거짓 + 조건 변수를 아무도 못 움직임
  const HIDDEN = clone(DEAD);
  HIDDEN.vars.push({ id: 'fame', label: '명성', type: 'int', init: 0, min: 0, max: 10 });
  HIDDEN.party.tabs[1].when = 'fame >= 3';
  ck('★ 시작부터 거짓 + 이동 경로 없음 → 열리지 않는 탭', tags(HIDDEN).includes('열리지 않는 탭'), J(tags(HIDDEN)));
  const OK1 = clone(HIDDEN);
  OK1.updater.allow.push({ id: 'fame' });
  ck('조건 변수가 움직일 수 있으면 안 뜬다', !tags(OK1).includes('열리지 않는 탭'), J(tags(OK1)));
  const OK2 = clone(HIDDEN);
  OK2.party.tabs[1].when = "has(deployed, '아린')";
  ck('deployed 게이트는 정상 설계 — 안 뜬다 (편성 담당)', !tags(OK2).includes('열리지 않는 탭'), J(tags(OK2)));

  // 템플릿은 셋 다 깨끗해야 한다 — 오탐이 나면 v0.52 원칙 위반
  for (const key of ['rpg', 'fleet']) {
    const tg = tags(JSON.parse(J(TEMPLATES[key].schema)));
    ck(`템플릿 '${key}'에 편성 정적 경고 없음`,
      !tg.includes('못 버는 포인트') && !tg.includes('영입 경로 없음') && !tg.includes('열리지 않는 탭'), J(tg));
  }
}

// ── 8. 대장 탭 + 플로팅 버튼 (v0.89) — template/fab ──
// 베리디아 리메이크 P1: 상태창의 참고 정보(인물 대장·영지 대장)를 패널로 옮기는 통로.
{
  const { renderPanelTemplate } = SC.require('render');

  const T = clone(BASE);
  delete T.party.slots;
  T.vars.push({ id: 'gold', label: '재정', type: 'int', init: 120, min: 0 });
  T.party.tabs = [
    { id: 'main', label: '편성', slots: [{ var: 'front' }, { var: 'rear' }] },
    { id: 'ledger', label: '인물 대장', fab: '📋',
      template: '<style>.led { color: red; }</style><div class="led">재정 {gold} · 동료 {count(allies)}명</div><div>{allies:tags}</div>' },
  ];
  const v = validateSchema(T);
  ck('★ 슬롯 없이 template만 있는 탭 검증 통과', v.ok, J(v.errors));

  // 자리표시자 오타는 렌더에서 {이름} 리터럴로 유저에게 보인다 — 검증이 미리 잡아야 한다
  const badRef = clone(T);
  badRef.party.tabs[1].template = '<div>{golld}</div>';
  ck('template의 없는 변수 → 오류', validateSchema(badRef).errors.some((e) => /golld/.test(e.msg)), J(validateSchema(badRef).errors));

  const badFab = clone(T);
  badFab.party.tabs[1].fab = '인물 대장 열기 버튼';
  ck('fab이 길면 오류 (버튼에 안 들어감)', validateSchema(badFab).errors.some((e) => /이모지 한두 글자/.test(e.msg)), '');

  const mix = clone(T);
  mix.party.template = '<div>{gold}</div>';
  ck('tabs와 최상위 template 혼용 오류', validateSchema(mix).errors.some((e) => /같이 쓸 수 없음/.test(e.msg)), '');

  const notStr = clone(T);
  notStr.party.tabs[1].template = 42;
  ck('template이 문자열 아니면 오류', validateSchema(notStr).errors.some((e) => /문자열이어야/.test(e.msg)), '');

  // 축약형: template만으로 편성표가 성립하고, fab은 의미가 없으니 경고
  const solo = clone(BASE);
  delete solo.party.slots;
  delete solo.party.roster;
  solo.party.template = '<div>체력 {hp}</div>';
  ck('축약형 template만으로 검증 통과', validateSchema(solo).ok, J(validateSchema(solo).errors));
  ck('축약형 template만으로 편성표 성립 (버튼이 달린다)', party.partyConfig(solo) != null, '');
  const soloFab = clone(solo);
  soloFab.party.fab = '📋';
  ck('축약형 fab은 경고', validateSchema(soloFab).warnings.some((w) => /축약형/.test(w.msg)), J(validateSchema(soloFab).warnings));

  // fab 사양 — 어댑터가 이대로 registerButton을 단다
  ck('★ partyFabSpecs = fab 있는 탭만', J(party.partyFabSpecs(T)) === J([{ id: 'ledger', label: '인물 대장', icon: '📋' }]), J(party.partyFabSpecs(T)));

  // 뷰 통과 — 어댑터 renderPartyPanel이 tab.template를 그대로 받는다
  const st = engine.initState(T);
  const view = party.partyView(T, st);
  ck('뷰에 template/fab 실림', view.tabs[1].template != null && view.tabs[1].fab === '📋', J(view.tabs[1]));

  // 렌더 — 상태창과 같은 자리표시자, 패널 전용 규약 셋
  const html = renderPanelTemplate(T, st, T.party.tabs[1].template);
  ck('★ 자리표시자 치환 (변수·식)', html.includes('재정 120') && html.includes('동료 2명'), html);
  ck(':tags 칩 + 목록 규약 꼬리 유지', html.includes('sim-tag') && html.includes('바크 @3일'), html);
  ck('임베드 <style>은 #sc-game로 스코핑', html.includes('#sc-game .led'), html);
  const html2 = renderPanelTemplate(T, st, '{uid}|{choices}|{{img::지도}}');
  ck('{uid}=scg 고정 · {choices}=빈칸 · CBS 통과', html2 === 'scg||{{img::지도}}', html2);
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
