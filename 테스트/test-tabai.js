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
  seg + '\nreturn { EVENT_PATTERNS, ACTION_PATTERNS, varContractTable, buildTabExportPrompt, pickTabFragment, TAB_SLICES, tabItemCounts, tabItemIds, planTabImport, FEATURE_RECIPES };')(
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

// ── 적용 전 계획 (v0.62.1) — 넣기 전에 "무엇이 사라지나"를 뽑는다 ──
{
  const ids = M.tabItemIds, plan = M.planTabImport;
  const RM = JSON.parse(JSON.stringify(TEMPLATES.romance.schema));

  ck('신원: 액션 id가 잡힘', ids(S, 'actions').every((s) => s.startsWith('액션 ')) && ids(S, 'actions').length === S.actions.length, '');
  ck('신원: 변수 탭은 변수+파생 둘 다',
    ids(S, 'vars').filter((s) => s.startsWith('변수 ')).length === S.vars.length
    && ids(S, 'vars').filter((s) => s.startsWith('파생 ')).length === S.derived.length, '');
  ck('신원: 규칙 탭은 이벤트·랜덤·지시문',
    ids(S, 'rules').some((s) => s.startsWith('이벤트 ')) && ids(S, 'rules').some((s) => s.startsWith('지시문 ')), '');
  ck('신원: 상태창은 그룹+항목', (() => {
    const r = ids(RM, 'status');
    return r.includes('그룹 관계') && r.includes('항목 affection');
  })(), ids(RM, 'status').slice(0, 4).join(' / '));

  // ★ 통 교체로 사라지는 것을 적용 전에 뽑아낸다
  const half = { actions: S.actions.slice(0, 1) };
  const pl = plan(S, 'actions', M.pickTabFragment('actions', half));
  ck('★ 사라지는 액션이 계획에 잡힘', pl.lost.length === S.actions.length - 1 && pl.gained.length === 0,
    `lost=${pl.lost.length} gained=${pl.gained.length}`);
  ck('★ 계획은 스키마를 안 건드림', S.actions.length > 1, String(S.actions.length));

  const same = plan(S, 'actions', M.pickTabFragment('actions', { actions: S.actions }));
  ck('★ 그대로면 손실 0 (확인 없이 통과해야 함)', same.lost.length === 0 && same.gained.length === 0, '');

  const grew = plan(S, 'actions', M.pickTabFragment('actions',
    { actions: [...S.actions, { id: 'new_one', label: '🆕 새것' }] }));
  ck('★ 추가만 하면 손실 0, 새것만 잡힘',
    grew.lost.length === 0 && grew.gained.length === 1 && grew.gained[0] === '액션 new_one', grew.gained.join(','));

  // 상태창 — 꾸미기는 보존되므로 계획에도 안 나온다 (groups만 비교)
  const stPlan = plan(RM, 'status', M.pickTabFragment('status',
    { groups: [{ label: '관계', items: [{ var: 'affection' }] }] }, RM));
  ck('★ status: 사라지는 그룹·항목이 잡힘',
    stPlan.lost.includes('그룹 감정') && stPlan.lost.includes('항목 mood') && !stPlan.lost.includes('항목 affection'),
    stPlan.lost.join(', '));
}

// ── 🧩 기능 추가 카드 (v0.63) — 카드는 JSON이 아니라 요청서를 만든다 ──
{
  const RC = M.FEATURE_RECIPES;
  const RM = JSON.parse(JSON.stringify(TEMPLATES.romance.schema));
  const BLANK = { vars: [], derived: [] };

  ck('★ 카드가 하나 이상 있음', Array.isArray(RC) && RC.length >= 5, String(RC.length));
  ck('★ 모든 단계가 실제 슬라이스를 가리킴',
    RC.every((r) => r.steps.every((s) => !!M.TAB_SLICES[s.tab])),
    RC.flatMap((r) => r.steps.map((s) => s.tab)).filter((t) => !M.TAB_SLICES[t]).join(', '));
  ck('모든 단계에 요구 문구가 있음', RC.every((r) => r.steps.every((s) => s.want && s.want.length > 10)), '');
  ck('id·라벨·설명이 모두 있고 id는 중복 없음',
    RC.every((r) => r.id && r.label && r.desc && r.icon) && new Set(RC.map((r) => r.id)).size === RC.length, '');

  // ★ needs는 순수 함수여야 한다 — 빈 스키마에서도 안 터지고, 막을 땐 이유를 말해야 한다
  ck('★ needs가 빈 스키마에서 안 터짐', (() => {
    try { RC.forEach((r) => r.needs(BLANK)); return true; } catch (e) { return false; }
  })(), '');
  ck('★ needs는 null 아니면 안내 문구', RC.every((r) => {
    const v = r.needs(RM);
    return v === null || (typeof v === 'string' && v.length > 5);
  }), '');

  const by = (id) => RC.find((r) => r.id === id);
  ck('★ 퀘스트 보드는 시간 없으면 막힘', typeof by('quest_board').needs(P) === 'string', '');
  ck('★ 퀘스트 보드는 시간 켜진 봇에선 열림', by('quest_board').needs(RM) === null, String(by('quest_board').needs(RM)));
  ck('★ 상점은 돈·소지품 없으면 막힘', typeof by('shop').needs(BLANK) === 'string', '');
  ck('상점은 survival(골드+목록)에선 열림', by('shop').needs(S) === null, String(by('shop').needs(S)));
  ck('★ 편성표는 enum·목록 없으면 막힘', typeof by('party').needs(BLANK) === 'string', '');
  ck('상태창 한 벌은 변수 2개 미만이면 막힘',
    typeof by('status_set').needs({ vars: [{ id: 'a' }] }) === 'string', '');

  // ★ 여러 절이 걸린 기능은 변수부터 — 다음 절이 그 변수를 보고 만들어야 한다
  ck('★ 다단계 기능은 변수 탭부터 시작',
    RC.filter((r) => r.steps.length > 1).every((r) => r.steps[0].tab === 'vars'),
    RC.filter((r) => r.steps.length > 1).map((r) => `${r.id}:${r.steps[0].tab}`).join(' '));
  // 비용 있는 items만 만들고 수입을 안 만들면 진단이 '못 버는 포인트'로 잡는다 = 죽은 화면
  ck('★ 스킬트리에 포인트 수입 단계가 있음',
    by('skilltree').steps.some((s) => s.tab === 'rules' && /포인트를 버는|수입/.test(s.want)), '');
  ck('상태창 카드는 status 슬라이스를 씀', by('status_set').steps[0].tab === 'status', '');
}

// ── 달력 슬라이스 (v0.63.1) — 📅 카드의 마지막 절 ──
{
  const RM = JSON.parse(JSON.stringify(TEMPLATES.romance.schema));
  RM.calendar.css = '.scc-day { border-color: gold; }';   // 보존 검증용 제작자 손값
  const cp = M.buildTabExportPrompt(RM, 'calendar');
  ck('★ calendar 슬라이스 등록', !!M.TAB_SLICES.calendar, '');
  ck('★ calendar: 최상위 키 못박음', cp.includes('`"calendar"`'), '');
  ck('calendar: 규격 절 포함 (marks 반복 규칙·expire)', cp.includes('## 달력 규격') && cp.includes('매년') && cp.includes('expire'), '');
  ck('★ calendar: 목록 계약 동봉 (list는 이 중에서만)', cp.includes('`plans`') && cp.includes('이 중에서만'), '');
  ck('★ calendar: 요일 계약 동봉 (커스텀 요일명 오타 방지)', cp.includes('월 · 화 · 수'), '');
  ck('calendar: css 원문 보존 지시', cp.includes('css가 이미 있으면 원문 그대로'), '');
  ck('calendar: 체크섬에 기념일 개수', /calendar\.marks` \*\*\d+개\*\*/.test(cp), '');
  ck('calendar: 요구 문구가 요청서에 실림',
    M.buildTabExportPrompt(RM, 'calendar', { want: '단오제는 5월 5일' }).includes('단오제는 5월 5일'), '');

  // 신원 — 일정 목록 연결은 스칼라지만 잃으면 등록 기능이 통째로 죽는다 → 신원으로 지킨다
  const idsCal = M.tabItemIds(RM, 'calendar');
  ck('★ 신원: 기념일 label + 일정 목록 연결',
    idsCal.includes('기념일 상대 생일') && idsCal.includes('일정 목록 plans'), idsCal.join(' / '));
  const dropList = M.planTabImport(RM, 'calendar',
    M.pickTabFragment('calendar', { calendar: { label: '달력', marks: RM.calendar.marks } }, RM));
  ck('★ 계획: list 연결이 빠지면 손실로 잡힘', dropList.lost.includes('일정 목록 plans'), dropList.lost.join(', '));

  // ★ 왕복 — AI가 준 것처럼 넣고: 기존 신원 무손실 + 검증 통과 + css 생존
  const frag = M.pickTabFragment('calendar', { calendar: {
    label: '달력', icon: '📅', list: 'plans', css: RM.calendar.css,
    marks: [...RM.calendar.marks, { label: '기말고사', month: 7, dom: 1 }],
  } }, RM);
  const plan2 = M.planTabImport(RM, 'calendar', frag);
  ck('★ 왕복: 기존 신원 무손실 + 새 기념일만 추가',
    plan2.lost.length === 0 && plan2.gained.includes('기념일 기말고사'),
    `lost=${plan2.lost.join(',')} gained=${plan2.gained.join(',')}`);
  const sch = JSON.parse(JSON.stringify(RM));
  Object.assign(sch, JSON.parse(JSON.stringify(frag)));
  const cv = validateSchema(sch);
  ck('★ 왕복 후 검증 통과', cv.ok, cv.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
  ck('★ 왕복 후 제작자 css 생존', sch.calendar.css === RM.calendar.css, '');
}

// ── ⑦ 기능별 회귀 — 모든 카드의 모든 단계 요청서가 재료를 실어 나가는가 ──
// 카드로 만든 결과물이 나쁘면 그건 요청서 버그다 (design-기능프리셋.md §병행 트랙).
// AI 응답은 시뮬 못 하니, 회귀의 대상은 "요청서에 무엇이 실렸나"와 needs의 정확성이다.
{
  const RC = M.FEATURE_RECIPES;
  // 카드마다 전제가 통과하는 홈 템플릿 — needs가 여기서 막히면 전제 검사가 잘못된 것
  const HOME = {
    status_set: 'romance', shop: 'survival', quest_board: 'romance', level: 'romance',
    affection: 'romance', skilltree: 'rpg', party: 'rpg', calendar: 'romance',
  };
  ck('★ 모든 카드에 홈 템플릿 지정', RC.every((r) => HOME[r.id]),
    RC.filter((r) => !HOME[r.id]).map((r) => r.id).join(', '));
  for (const r of RC) {
    const sch = JSON.parse(JSON.stringify(TEMPLATES[HOME[r.id] ?? 'romance'].schema));
    ck(`★ 회귀 ${r.id}: 홈에서 전제 통과`, r.needs(sch) === null, String(r.needs(sch)));
    for (const s of r.steps) {
      const p = M.buildTabExportPrompt(sch, s.tab, { want: s.want });
      ck(`회귀 ${r.id}/${s.tab}: 요구 문구가 요청서에 실림`, p.includes(s.want.slice(0, 20)), '');
      if (s.tab !== 'vars') {
        ck(`회귀 ${r.id}/${s.tab}: 변수 계약표 동봉 (없는 변수를 못 지어내게)`,
          p.includes('여기 있는 것만'), '');
      }
      ck(`회귀 ${r.id}/${s.tab}: 전체 세트 요구 (통 교체 방어)`,
        p.includes('한 세트로 돌려주세요') || p.includes('나머지가 전부 사라집니다'), '');
    }
  }
  ck('★ 📅 달력 카드가 등록됨 (시간 전제)', (() => {
    const c = RC.find((r) => r.id === 'calendar');
    return !!c && typeof c.needs(P) === 'string' && c.needs(TEMPLATES.romance.schema) === null;
  })(), '');
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
  ck('★ 적용 전 확인이 배선됨 (붙들기 → 그래도 적용 / 취소)',
    src.includes('tabPending') && src.includes('그래도 적용') && src.includes('commitTabImport'), '');
  ck('★ 손실 있으면 스키마를 건드리기 전에 멈춤',
    /tabPending = \{ tabKey, picked, \.\.\.plan \};\s*return false;/.test(src), '');
  ck('★ 🧩 기능 카드가 창작 탭에 배선됨',
    src.includes('featureBox()') && src.includes('FEATURE_RECIPES'), '');
  ck('★ 카드는 새 병합 코드 없이 탭 경로를 그대로 탐',
    /tabWant\[s\.tab\] = s\.want/.test(src) && /await runTabGenerate\(s\.tab\)/.test(src), '');
  ck('★ 결과·되돌리기를 카드와 탭이 같이 씀 (tabResultEl)',
    (src.match(/tabResultEl\(/g) || []).length >= 3, String((src.match(/tabResultEl\(/g) || []).length));
  // §결정 2 (design-시간.md) — "그냥 켜기"를 없애고 진행 입구 3택을 강제 (켜는 순간 완성품)
  ck('★ 시간 켜기 = 진행 입구 3택 강제',
    src.includes('시간이 어떻게 흐르나요') && src.includes('턴마다 하루 — 생존물')
    && src.includes('ensureSkipVars(); addEndDayAction();'), '');
  // §결정 1 — 상태창의 날짜 자리는 시간 탭으로만 통하는 문
  ck('★ 상태창 날짜 자리 = 시간 탭으로 보내는 문',
    src.includes('날짜 변수를 직접 만들지 마세요') && src.includes('🕐 시간 탭으로'), '');
  ck('달력 탭에도 AI 도구 배선', src.includes("tabAiTools('calendar')"), '');
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
