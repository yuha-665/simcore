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

// ── 2. partyView — 후보·잠금·자리 ────────────────────────────
{
  const state = engine.initState(BASE);
  const view = party.partyView(BASE, state);
  ck('★ 뷰 기본 — 슬롯 2개·라벨', view.slots.length === 2 && view.slots[0].label === '전위' && view.slots[1].label === '후위', J(view.slots.map((s) => s.label)));
  ck('빈 슬롯 표시', view.slots[0].isEmpty === true, '');
  const names = view.slots[0].candidates.map((c) => c.name);
  ck('후보에서 빈값 제외', J(names) === J(['아린', '바크', '셀레네']), J(names));
  // roster 잠금 — 아린은 보유, 바크는 "@기한" 꼬리가 붙어도 보유로 친다, 셀레네는 미보유
  const lockOf = (n) => view.slots[0].candidates.find((c) => c.name === n).locked;
  ck('★ roster 잠금 — 미보유만 잠긴다', !lockOf('아린') && !lockOf('바크') && lockOf('셀레네'),
    J(view.slots[0].candidates));
  ck('rosterName — 목록 규약 꼬리 제거', party.rosterName('바크 @3일') === '바크' && party.rosterName('아린 +2') === '아린', '');

  state.vars.front = '아린';
  const v2 = party.partyView(BASE, state);
  ck('usedBy — 딴 슬롯에 앉은 인물 표시', v2.slots[1].candidates.find((c) => c.name === '아린').usedBy === 'front', '');
  ck('자기 슬롯에서는 usedBy 없음', v2.slots[0].candidates.find((c) => c.name === '아린').usedBy === null, '');

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
    ck('템플릿 뷰 — 슬롯 2·시작은 빈 편성', view.slots.length === 2 && view.slots.every((s) => s.isEmpty), J(view.slots));
    ck('시작 보유(아린)만 열려 있다', view.slots[0].candidates.filter((c) => !c.locked).map((c) => c.name).join() === '아린', J(view.slots[0].candidates));
    const r = party.applyPartyPick(t, state, view.slots[0].var, '아린');
    ck('템플릿에서 편성 동작', r.ok && Object.values(r.changes)[0] === '아린', J(r));
  }
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
