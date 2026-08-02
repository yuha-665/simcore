const __P = (...p) => require('path').resolve(__dirname, ...p);
// 탭 단위로 AI에게 맡기는 경로 검증 — 계약표 / 패턴 카탈로그 / 조각 병합 / 왕복
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');

const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
const M = new Function('validateSchema', 'TEMPLATES', 'timeConfig', 'EXPOSED_LABELS',
  seg + '\nreturn { EVENT_PATTERNS, ACTION_PATTERNS, varContractTable, buildTabExportPrompt, pickTabFragment, TAB_SLICES, tabItemCounts };')(
  validateSchema, TEMPLATES, SC.require('time').timeConfig, SC.require('time').EXPOSED_LABELS);

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const S = TEMPLATES.survival.schema;
const P = TEMPLATES.politics.schema;

// ── 변수 계약표: 이게 정확해야 AI가 없는 변수를 안 지어낸다 ──
{
  const t = M.varContractTable(S);
  ck('★ 모든 변수가 계약표에 나옴',
    S.vars.every((v) => t.includes(`\`${v.id}\``)),
    S.vars.filter((v) => !t.includes(`\`${v.id}\``)).map((v) => v.id).join(', '));
  ck('★ 모든 파생 변수도 나옴', S.derived.every((d) => t.includes(`\`${d.id}\``)), '');
  ck('★ 파생은 읽기 전용이라고 못박음', t.includes('읽기 전용') && t.includes('set` 대상이 될 수 없'), '');
  ck('enum 선택지가 전부 나열됨', t.includes('정지 / 약 / 보통 / 최대'), '');
  ck('숫자 범위가 나옴', t.includes('-60 ~ 10'), '');
  ck('하한만 있으면 "이상"', t.includes('0 이상'), '');
  ck('목록은 최대 개수', t.includes('최대 6개'), '');
  ck('시작값이 나옴', t.includes('400') && t.includes('"보통"'), '');
  ck('파생 계산식이 그대로 나옴', t.includes('temp + heat_out * 9 + shelter * 2'), '');

  const noDerived = M.varContractTable({ vars: [{ id: 'a', label: 'A', type: 'int', init: 1 }] });
  ck('파생이 없으면 그 절도 없음', !noDerived.includes('파생 변수'), '');
}

// ── ★ 패턴 카탈로그의 예시가 실제로 유효한 스키마인가 ──
// (여기가 틀리면 AI에게 틀린 걸 가르치는 셈이 된다)
{
  const HOME = {
    riot: 'survival', fuel_out: 'survival', survived: 'survival', stoke: 'survival', law_expiry: 'survival',
    scandal_breaks: 'politics', scandal_over: 'politics', bill_passed: 'politics',
    meet_biz: 'politics', submit_bill: 'politics',
    hp_cap: 'rpg', potion: 'rpg', restock: 'business', patrol: 'estate',
  };
  const check = (kind, list) => {
    for (const [name, why, exJson] of list) {
      let obj = null;
      try { obj = JSON.parse(exJson); }
      catch (e) { ck(`${kind} '${name}': 예시가 JSON으로 파싱됨`, false, e.message); continue; }
      ck(`${kind} '${name}': 예시가 JSON으로 파싱됨`, true);
      ck(`${kind} '${name}': 설명이 있음`, !!why && why.length > 10, why);

      const home = HOME[obj.id];
      if (!home) { ck(`${kind} '${name}': 검증할 템플릿이 지정됨`, false, `id=${obj.id}`); continue; }
      const sch = JSON.parse(JSON.stringify(TEMPLATES[home].schema));
      if (kind === '이벤트') { sch.rules = sch.rules || {}; sch.rules.events = [obj]; }
      else {
        sch.actions = [obj];
        // 액션을 통째로 갈아끼우면 편성표의 액션 참조(party.actions)가 끊긴다 — 여기서는
        // 패턴 예시의 유효성만 보는 것이므로 편성표를 떼고 검증한다 (참조 절단 오류는 정상 동작)
        delete sch.party;
        // 편성표를 떼면 deployed 가상 목록(v0.59)도 사라진다 — 그걸 보는 지시문도 함께 뗀다
        sch.directives = (sch.directives || []).filter(
          (d) => !/\bdeployed\b/.test(`${d.when ?? ''} ${d.text ?? ''}`));
      }
      const v = validateSchema(sch);
      ck(`★ ${kind} '${name}' 예시가 실제로 검증 통과 (${home})`, v.ok,
        v.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
    }
  };
  check('이벤트', M.EVENT_PATTERNS);
  check('액션', M.ACTION_PATTERNS);
  ck('이벤트 패턴 8종', M.EVENT_PATTERNS.length === 8, String(M.EVENT_PATTERNS.length));
  ck('액션 패턴 6종', M.ACTION_PATTERNS.length === 6, String(M.ACTION_PATTERNS.length));
  ck('★ 액션 예시 라벨은 전부 이모지로 시작',
    M.ACTION_PATTERNS.every(([, , ex]) => {
      const cp = JSON.parse(ex).label.codePointAt(0);
      return (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff);
    }), M.ACTION_PATTERNS.map(([, , ex]) => JSON.parse(ex).label).join(' '));
  ck('값 자르기 예시엔 notify가 없음 (의도)', !JSON.parse(M.EVENT_PATTERNS[6][2]).notify, '');
  ck('이정표 예시엔 once:true', JSON.parse(M.EVENT_PATTERNS[5][2]).once === true, '');
}

// ── 내보내기 프롬프트 ──
{
  const a = M.buildTabExportPrompt(S, 'actions');
  const r = M.buildTabExportPrompt(P, 'rules');

  ck('액션: 채울 자리 있음', a.includes('## 내가 원하는 것'), '');
  ck('★ 액션: 최상위 키를 못박음', a.includes('`"actions"`'), '');
  // v0.24: 경고를 전용 절로 키우고 현재 개수를 체크섬으로 함께 준다 (자세한 검증은 test-fixprompt.js)
  ck('★ 전체 목록을 달라고 요구 (일부만 주면 사라짐)',
    a.includes('나머지가 전부 사라집니다') && a.includes('한 세트로 돌려주세요')
    && /- `actions` \*\*\d+개\*\*/.test(a), '');
  ck('★ 액션: 변수 계약표 동봉', a.includes('여기 있는 것만') && a.includes('| `coal` |'), '');
  ck('액션: 없는 변수 쓰면 거부된다고 경고', a.includes('없는 이름을 쓰면 검증에서 거부'), '');
  ck('★ 액션: 패턴 6종 전부 실림', M.ACTION_PATTERNS.every(([n]) => a.includes(`### ${n}`)), '');
  ck('액션: 이모지 시작 규칙 명시', a.includes('이모지 하나로 시작'), '');
  ck('액션: mode/when/cooldown 설명', a.includes('"oneshot"') && a.includes('"hold"') && a.includes('cooldown'), '');
  ck('액션: 현재 내용이 출발점으로 실림', a.includes('"stoke"') && a.includes('지금 이 봇의 액션'), '');
  ck('액션: 이벤트 패턴은 안 들어감 (탭이 섞이지 않음)', !a.includes('### 시한폭탄'), '');

  ck('★ 규칙: 최상위 키 둘 다 못박음', r.includes('`"rules"`') && r.includes('`"directives"`'), '');
  ck('★ 규칙: 패턴 7종 전부 실림', M.EVENT_PATTERNS.every(([n]) => r.includes(`### ${n}`)), '');
  ck('규칙: onTurn 순서 중요성 설명', r.includes('순서가 중요'), '');
  ck('규칙: randomEvents 설명', r.includes('chancePerTurn') && r.includes('weight'), '');
  ck('규칙: directives가 서술 지시문임을 설명', r.includes('메인 모델에게 가는 서술 지시문'), '');
  ck('규칙: 현재 내용이 실림', r.includes('scandal_breaks'), '');
  ck('규칙: 액션 패턴은 안 들어감', !r.includes('### 트레이드오프'), '');

  ck('양쪽 다 수식 규칙 포함', a.includes('rand()') && r.includes('rand()'), '');
  ck('양쪽 다 밸런스 지침 포함', a.includes('역산') && r.includes('역산'), '');

  const kb = (s) => (s.length / 1024).toFixed(1) + 'KB';
  ck('★ 통짜 규격서보다 훨씬 가벼움', a.length < 20 * 1024 && r.length < 25 * 1024, `${kb(a)} / ${kb(r)}`);
  console.log(`  [크기] 액션 ${kb(a)} / 규칙 ${kb(r)}`);

  // 'vars'는 이제 지원된다 (전용 검증은 test-varsai.js) — 여긴 미지원 탭 처리만 본다
  ck('vars 탭은 이제 지원됨', M.buildTabExportPrompt(S, 'vars').length > 1000, '');
  // 'status'도 v0.62부터 지원 (전용 검증은 아래 상태창 슬라이스 절)
  ck('status 탭은 이제 지원됨', M.buildTabExportPrompt(S, 'status').length > 1000, '');
  for (const key of ['setup', 'ai', '없는탭']) {
    let threw = false;
    try { M.buildTabExportPrompt(S, key); } catch (e) { threw = true; }
    ck(`미지원 탭 '${key}'은 거부`, threw, '');
  }
}

// ── 편성표 슬라이스 (v0.60) — [편성표] 탭도 AI에게 맡길 수 있다 ──
{
  const RP = JSON.parse(JSON.stringify(TEMPLATES.rpg.schema));
  const pp = M.buildTabExportPrompt(RP, 'party');
  ck('★ party 슬라이스 등록', !!M.TAB_SLICES.party, '');
  ck('★ party: 최상위 키 못박음', pp.includes('`"party"`'), '');
  ck('party: 규격 절 포함 (deployed·when·items)', pp.includes('## 편성표 규격') && pp.includes('deployed') && pp.includes('items'), '');
  ck('★ party: 기존 액션 계약 동봉 (탭 actions는 이 id만)', pp.includes('`rest`') && pp.includes('이 id만 참조'), '');
  ck('party: portraits·css 보존 지시', pp.includes('portraits') && pp.includes('원문 그대로'), '');
  ck('party: 현재 내용이 출발점으로 실림', pp.includes('"skill_sword"'), '');
  ck('party: 체크섬에 슬롯·업그레이드 개수', /슬롯\(전체 탭\)` \*\*\d+개\*\*/.test(pp) && /업그레이드\(전체 탭\)` \*\*\d+개\*\*/.test(pp), pp.match(/- `[^`]+` \*\*\d+개\*\*/g)?.join(' ') ?? '');
  ck('party: 조각 골라내기', JSON.stringify(M.pickTabFragment('party', { party: { slots: [] } })) === '{"party":{"slots":[]}}', '');
}

// ── 상태창 슬라이스 (v0.62) — 구조 창구. 꾸미기(CSS·템플릿)는 절대 안 건드린다 ──
{
  const RM = JSON.parse(JSON.stringify(TEMPLATES.romance.schema));
  const sp = M.buildTabExportPrompt(RM, 'status');
  ck('★ status 슬라이스 등록', !!M.TAB_SLICES.status, '');
  ck('★ status: 최상위 키 groups·layout 못박음', sp.includes('`"groups"`') && sp.includes('`"layout"`'), '');
  ck('status: 규격 절 포함', sp.includes('## 상태창 규격') && sp.includes('showWhen') && sp.includes('collapsed'), '');
  ck('★ status: 날짜 줄 직접 만들기 금지', sp.includes('날짜·시각 줄을 직접 만들지 마세요'), '');
  ck('★ status: 꾸미기는 그대로 남는다고 못박음', sp.includes('커스텀 CSS') && sp.includes('그대로 남습니다'), '');
  ck('status: 현재 그룹이 출발점으로 실림', sp.includes('"affection"'), '');
  ck('status: 체크섬에 그룹·표시 항목 개수',
    /statusUI\.groups` \*\*\d+개\*\*/.test(sp) && /표시 항목` \*\*\d+개\*\*/.test(sp),
    sp.match(/- `[^`]+` \*\*\d+개\*\*/g)?.join(' ') ?? '');

  // ★ 계약표에 시간 노출 이름이 실려야 "date를 그냥 쓰라"는 지시가 성립한다.
  //   이게 빠지면 AI는 날짜를 못 쓰는 줄 알고 day 변수를 새로 만들자고 한다 (design-시간.md §결정 1).
  ck('★ 계약표에 시간 노출 이름 (date·clock)', sp.includes('| `date` |') && sp.includes('| `clock` |'), '');
  ck('시간 꺼진 봇엔 노출 이름 절이 없음',
    !M.buildTabExportPrompt(P, 'status').includes('시간 체계가 켜져 있습니다'), '');

  // ★ 통째 교체가 아니라 groups만 갈아끼운다 — 제작자가 쌓은 꾸미기가 살아남아야 한다
  const got = M.pickTabFragment('status', { groups: [{ label: '새 그룹', items: [{ var: 'affection' }] }] }, RM);
  ck('★ status: customCSS가 보존됨',
    !!RM.statusUI.customCSS && got.statusUI.customCSS === RM.statusUI.customCSS, '');
  ck('★ status: 그룹만 갈아끼워짐',
    got.statusUI.groups.length === 1 && got.statusUI.groups[0].label === '새 그룹', '');
  ck('status: mode·collapsible 등 나머지 보존',
    got.statusUI.mode === RM.statusUI.mode && got.statusUI.collapsible === RM.statusUI.collapsible, '');

  // layout — 준 것만 반영. 빠뜨렸다고 기존 설정을 지우면 그게 손실이다
  ck('★ status: layout을 주면 반영',
    M.pickTabFragment('status', { groups: [], layout: 'tabs' }, RM).statusUI.layout === 'tabs', '');
  ck('★ status: layout을 안 주면 기존 유지',
    M.pickTabFragment('status', { groups: [] },
      { statusUI: { groups: [], layout: 'accordion' } }).statusUI.layout === 'accordion', '');
  ck('status: statusUI로 감싼 응답도 받음', (() => {
    const w = M.pickTabFragment('status', { statusUI: { groups: [{ label: 'A', items: [] }], layout: 'tabs' } }, RM);
    return w.statusUI.groups[0].label === 'A' && w.statusUI.layout === 'tabs';
  })(), '');

  // ★ 왕복 — AI가 준 것처럼 넣고 실제로 검증을 통과하는가
  const sch = JSON.parse(JSON.stringify(RM));
  Object.assign(sch, M.pickTabFragment('status', {
    layout: 'tabs',
    groups: [
      { label: '관계', items: [
        { var: 'date' }, { var: 'clock' },
        { var: 'affection', bar: { max: 100 }, color: "affection < 30 ? '#c0392b' : '#2e8b57'" }] },
      { label: '기록', visibility: 'collapsed', items: [
        { var: 'memories' }, { var: 'jealousy', showWhen: 'jealousy > 0' }] },
    ],
  }, sch));
  const sv = validateSchema(sch);
  ck('★ AI가 준 상태창 조각이 병합 후 검증 통과', sv.ok, sv.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
  ck('★ 왕복 후에도 커스텀 CSS가 살아 있음', sch.statusUI.customCSS === RM.statusUI.customCSS, '');
  ck('왕복 후 체크섬이 새 개수를 반영',
    JSON.stringify(M.tabItemCounts(sch, 'status')) === JSON.stringify([['statusUI.groups', 2], ['표시 항목', 5]]),
    JSON.stringify(M.tabItemCounts(sch, 'status')));
}

// ── 번들 스모크: 두 창구가 실제로 배선됐는가 ──
// 구조 = 3층 상태창 탭 / 꾸미기 = 1층 👁 결과 + 3층 상태창 탭 (같은 함수, 상태 공유)
{
  ck('★ 구조 창구가 상태창 탭에 배선됨', src.includes("tabAiTools('status')"), '');
  const nCss = (src.match(/cssAiTools\(\)/g) || []).length;
  ck('★ 꾸미기 창구가 양쪽에서 쓰임 (정의 1 + 호출 2)', nCss >= 3, String(nCss));
  ck('직결 생성·공통 가져오기 경로 존재',
    src.includes('runTabGenerate') && src.includes('applyTabImport'), '');
  ck('요구 입력칸 예시가 status에도 있음', src.includes('체력·허기·기온은 게이지로'), '');
  ck('★ 상태창이 [내보내기]로 되살릴 수 있는 탭으로 승격', src.includes("'상태창', true"), '');
  ck('promptState는 상태창과 분리됨', src.includes("'AI 설정', false"), '');
}

// ── 가져오기: 조각 골라내기 ──
{
  const pick = M.pickTabFragment;
  ck('정상 객체', JSON.stringify(pick('actions', { actions: [1] })) === '{"actions":[1]}', '');
  ck('★ 배열만 던져줘도 받아줌', JSON.stringify(pick('actions', [1, 2])) === '{"actions":[1,2]}', '');
  ck('★ 스키마를 통째로 줘도 이 탭 몫만 뽑음',
    JSON.stringify(pick('actions', { vars: [9], actions: [1], rules: {} })) === '{"actions":[1]}', '');
  ck('규칙 탭은 두 키를 함께 받음',
    JSON.stringify(pick('rules', { rules: { events: [] }, directives: [7] })) === '{"rules":{"events":[]},"directives":[7]}', '');
  ck('규칙 탭: 한쪽만 와도 받음', JSON.stringify(pick('rules', { rules: {} })) === '{"rules":{}}', '');
  ck('★ 다른 탭 것은 안 섞임 (액션에 rules를 줘도 무시)',
    (() => { try { pick('actions', { rules: {} }); return false; } catch (e) { return e.message.includes('"actions"'); } })(), '');

  for (const [bad, why] of [[null, 'null'], ['문자열', '문자열'], [42, '숫자']]) {
    let msg = '';
    try { pick('actions', bad); } catch (e) { msg = e.message; }
    ck(`${why}은 거부`, !!msg, msg);
  }
}

// ── 코드펜스 벗기기 (탭 가져오기도 같은 처리) ──
{
  const strip = (raw0) => {
    const raw = String(raw0).trim();
    const f = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return f ? f[1] : raw;
  };
  const frag = '{"actions":[]}';
  ck('맨 JSON', JSON.parse(strip(frag)).actions.length === 0, '');
  ck('```json 펜스', JSON.parse(strip('```json\n' + frag + '\n```')).actions.length === 0, '');
  ck('앞뒤 설명 섞여도', JSON.parse(strip('네 만들었습니다:\n```json\n' + frag + '\n```\n확인해보세요')).actions.length === 0, '');
}

// ── ★ 왕복: AI가 준 것처럼 조각을 넣고 실제로 굴러가는가 ──
{
  const sch = JSON.parse(JSON.stringify(S));
  // "AI가 만들어 온" 액션 — 계약표의 변수만 사용
  const fromAi = {
    actions: [
      { id: 'pray', label: '🕯 기도 집회', mode: 'oneshot', cooldown: 3,
        inject: '[결정] 사람들을 모아 기도하게 한다.',
        effects: [{ set: 'hope', expr: 'min(100, hope + 12)' },
                  { set: 'discontent', expr: 'max(0, discontent - 5)' }] },
      { id: 'scavenge', label: '🔦 잔해 수색', mode: 'oneshot', cooldown: 2, when: 'workforce >= 3',
        inject: '[결정] 무너진 건물을 뒤진다.',
        effects: [{ set: 'food', expr: 'food + rand(20, 60)' },
                  { set: 'sick', expr: 'min(people, sick + 1)' }] },
    ],
  };
  const picked = M.pickTabFragment('actions', fromAi);
  Object.assign(sch, picked);
  const v = validateSchema(sch);
  ck('★ AI가 준 액션 조각이 병합 후 검증 통과', v.ok, v.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
  ck('기존 액션이 교체됨 (전체 목록을 받았으므로)', sch.actions.length === 2, String(sch.actions.length));

  // 실제로 굴려본다 — 문법만이 아니라 동작까지
  const engine = SC.require('engine');
  const { seededRng } = SC.require('rng');
  let st = engine.initState(sch); st.meta.setupDone = true;
  const before = st.vars.hope;
  const armed = engine.toggleAction(sch, st, 'pray').state;
  const sent = engine.sendPhase(sch, armed, { rng: seededRng('c', 1, 'send') });
  ck('★ 새 액션이 실제로 상태를 바꿈', sent.state.vars.hope > before,
    `${before} → ${sent.state.vars.hope}`);
  ck('새 액션의 전달문이 모델에게 나감', sent.promptBlock.includes('기도하게 한다'), '');

  // 계약을 어긴 조각은 검증에서 잡히는가
  const bad = JSON.parse(JSON.stringify(S));
  Object.assign(bad, M.pickTabFragment('actions', {
    actions: [{ id: 'oops', label: '💀 없는 변수', mode: 'oneshot', inject: 'x',
      effects: [{ set: 'nonexistent_var', expr: '1' }] }],
  }));
  const bv = validateSchema(bad);
  ck('★ 계약에 없는 변수를 쓰면 잡힌다', !bv.ok && bv.errors.some((e) => e.msg.includes('nonexistent_var')),
    JSON.stringify(bv.errors));

  // 파생 변수에 set 하려 들면 잡히는가
  const bad2 = JSON.parse(JSON.stringify(S));
  Object.assign(bad2, M.pickTabFragment('actions', {
    actions: [{ id: 'oops2', label: '💀 파생에 대입', mode: 'oneshot', inject: 'x',
      effects: [{ set: 'indoor', expr: '0' }] }],
  }));
  ck('★ 파생 변수에 대입하면 잡힌다', !validateSchema(bad2).ok, '');
}

// ── 되돌리기 안전성 (깊은 복사로 원본이 안 물리는가) ──
{
  const sch = JSON.parse(JSON.stringify(S));
  const before = JSON.parse(JSON.stringify(sch));      // UI가 저장하는 스냅샷과 같은 방식
  Object.assign(sch, JSON.parse(JSON.stringify(M.pickTabFragment('actions', { actions: [] }))));
  ck('가져오면 현재 스키마가 바뀜', sch.actions.length === 0, '');
  ck('★ 되돌리기 스냅샷은 안 망가짐', before.actions.length === S.actions.length, String(before.actions.length));
  const restored = before;
  ck('되돌리면 원래대로', restored.actions.length === S.actions.length, '');
  ck('되돌린 결과도 유효', validateSchema(restored).ok, '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
