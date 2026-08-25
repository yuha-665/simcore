const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.90 시나리오레이터 (core/scenario.js, 설계 docs/design-시나리오레이터.md)
//
// 검증 축 = 설계의 세 약속:
//  ① 은닉 보장 — 모델은 현재 막 direct + 열린 막 secret만 본다. 뒷막은 프롬프트 어디에도 없다.
//  ② 페이스 — 전환은 조건식+minTurns가 정하고, 턴당 한 막만 걷는다.
//  ③ 옵트인 — scenario가 없으면 아무것도 바뀌지 않는다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const scn = SC.require('scenario');
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const cp = (o) => JSON.parse(JSON.stringify(o));

// 공용 스키마 — 무협 봇 축소판 (설계 §2의 예제 그대로: finds가 막을 연다)
const BASE = {
  simcore: '0.1',
  vars: [
    { id: 'finds', label: '조각 발견', type: 'int', init: 0, min: 0, max: 10 },
    { id: 'threat', label: '위협', type: 'int', init: 0, min: 0, max: 100 },
  ],
  rules: { events: [] },
  updater: { allow: [{ id: 'finds', maxDelta: 5 }] },
  scenario: {
    label: '제1장 — 혈마심경',
    acts: [
      { id: 'act1', label: '잠복', intensity: '잠복',
        direct: '실마리를 옅게만 암시하라. 현재 조각 {finds}개.',
        secret: '혈마심경 조각은 사실 셋이 아니라 넷이다.' },
      { id: 'act2', label: '전개', unlock: 'finds >= 2', minTurns: 2, intensity: '전개',
        direct: '조각을 노리는 자들이 움직이기 시작한다.',
        secret: '흑막은 문파 안에 있다.',
        onEnter: [{ set: 'threat', expr: 'clamp(threat + 10, 0, 100)' }],
        notify: '[이야기] 수면 아래에서 무언가 움직이기 시작했다.' },
      { id: 'act3', label: '절정', unlock: 'threat >= 10', intensity: '절정' },
    ],
  },
};

// 한 턴 굴리기 — sendPhase → outputPhase (보조 changes 포함)
function turn(schema, state, changes = {}) {
  const rng = () => 0.99; // 랜덤 이벤트 없음 — 결정적
  const sp = engine.sendPhase(schema, state, { armedActions: [] });
  const op = engine.outputPhase(schema, sp.state, changes, {}, { rng });
  return { state: op.state, prompt: sp.promptBlock, fired: op.firedEvents };
}

// ── 정규화·옵트인 ──
{
  ck('scenario 없으면 null (없음 = 꺼짐)', scn.scenarioConfig({ vars: [] }) === null, '');
  ck('acts 빈 배열도 null', scn.scenarioConfig({ scenario: { acts: [] } }) === null, '');
  const cfg = scn.scenarioConfig(BASE);
  ck('★ 정규화: 막 3개 + 라벨', cfg.acts.length === 3 && cfg.label === '제1장 — 혈마심경', '');
  ck('id 없는 막은 자동 id', scn.scenarioConfig({ scenario: { acts: [{ direct: 'x' }] } }).acts[0].id === 'act1', '');
  ck('★ scenario 없는 스키마는 initState에 예약 키가 없음', (() => {
    const st = engine.initState({ ...cp(BASE), scenario: undefined, vars: BASE.vars });
    return !('scn_idx' in st.vars) && !('scn_turns' in st.vars);
  })(), '');
  const st0 = engine.initState(cp(BASE));
  ck('★ initState: scn_idx=0 · scn_turns=0', st0.vars.scn_idx === 0 && st0.vars.scn_turns === 0, JSON.stringify([st0.vars.scn_idx, st0.vars.scn_turns]));
}

// ── ① 은닉 보장 — 프롬프트에 실리는 것과 안 실리는 것 ──
{
  const schema = cp(BASE);
  let st = engine.initState(schema);
  const t1 = turn(schema, st);
  ck('★ 1막: 머리글 + 진행 표기', t1.prompt.includes('[이야기 지침]') && t1.prompt.includes('(1/3막)'), '');
  ck('★ 1막: direct에 {변수} 치환', t1.prompt.includes('현재 조각 0개'), '');
  ck('1막: intensity 기본 문구(잠복)', t1.prompt.includes('수면 아래'), '');
  ck('★ 1막: 자기 secret은 공개', t1.prompt.includes('셋이 아니라 넷'), '');
  ck('★ 1막: 뒷막 direct·secret·notify 전부 없음 — 은닉의 실체',
    !t1.prompt.includes('노리는 자들') && !t1.prompt.includes('문파 안에') && !t1.prompt.includes('움직이기 시작했다'), '');
  ck('★ 미공개 어법 동봉 ("거짓이 아니라 아직")', t1.prompt.includes('거짓이 아니라 아직'), '');
  // secret이 하나도 없는 시나리오 — 내막 절 자체가 없어야 한다 (있다는 신호도 스포일러)
  const noSec = cp(BASE);
  noSec.scenario.acts.forEach((a) => delete a.secret);
  const tn = turn(noSec, engine.initState(noSec));
  ck('★ secret 0개면 [밝혀진 내막] 절 자체가 없음', !tn.prompt.includes('[밝혀진 내막]'), '');
}

// ── ② 페이스 — unlock + minTurns + 턴당 한 막 ──
{
  const schema = cp(BASE);
  let st = engine.initState(schema);
  // 조건 미충족 — 몇 턴을 굴려도 1막
  for (let i = 0; i < 3; i++) st = turn(schema, st).state;
  ck('★ 조건 미충족이면 전환 없음', st.vars.scn_idx === 0 && st.vars.scn_turns === 3, JSON.stringify([st.vars.scn_idx, st.vars.scn_turns]));

  // 조건 충족 (finds 2) — minTurns=2는 이미 3턴 지났으므로 즉시 전환
  let r = turn(schema, st, { finds: 2 });
  st = r.state;
  ck('★ unlock 충족 → 2막 전환', st.vars.scn_idx === 1, String(st.vars.scn_idx));
  ck('★ 전환 시 scn_turns 리셋', st.vars.scn_turns === 0, String(st.vars.scn_turns));
  ck('★ onEnter 효과 적용 (threat +10)', st.vars.threat === 10, String(st.vars.threat));
  ck('★ notify가 다음 전송 통지에 실림', st.meta.pendingNotifies.some((n) => n.includes('움직이기 시작했다')), '');
  ck('전환이 firedEvents 창구로 보임', r.fired.includes('scenario:act2'), r.fired.join(','));

  // ★ 턴당 한 막 — act3의 unlock(threat >= 10)은 onEnter로 이미 참이지만 같은 턴에 안 넘어갔다
  ck('★ 연쇄 전환 없음 — 같은 턴에 act3으로 안 감', st.vars.scn_idx === 1, '');
  // 다음 턴에 act3 전환 (act3은 minTurns 없음 → 1턴 뒤 바로)
  st = turn(schema, st).state;
  ck('★ 다음 턴에 act3 전환', st.vars.scn_idx === 2, String(st.vars.scn_idx));
  // 마지막 막 — 더 굴려도 유지 (해소 상태)
  st = turn(schema, st).state;
  ck('마지막 막 유지', st.vars.scn_idx === 2, '');

  // 2막 프롬프트에 secret 누적 확인 (act3 전환 전 상태를 다시 만들어 검사)
  const s2 = cp(BASE);
  let st2 = engine.initState(s2);
  st2 = turn(s2, st2).state; st2 = turn(s2, st2).state;       // minTurns 채우기
  st2 = turn(s2, st2, { finds: 2 }).state;                    // 2막 전환
  const t2 = turn(s2, st2);
  ck('★ 2막: secret 누적 (1막 것 + 2막 것)', t2.prompt.includes('셋이 아니라 넷') && t2.prompt.includes('문파 안에'), '');
  ck('2막: 현재 막 direct로 교체', t2.prompt.includes('노리는 자들') && !t2.prompt.includes('옅게만 암시'), '');
}

// ── minTurns 페이스 바닥 — 조건이 먼저 차도 바닥까지 머문다 ──
{
  const schema = cp(BASE);
  schema.vars[0].init = 5; // finds 시작부터 충족
  let st = engine.initState(schema);
  st = turn(schema, st).state;
  ck('★ minTurns 바닥: 1턴째는 전환 안 됨', st.vars.scn_idx === 0, String(st.vars.scn_idx));
  st = turn(schema, st).state;
  ck('★ minTurns=2 채운 턴에 전환', st.vars.scn_idx === 1, String(st.vars.scn_idx));
}

// ── 노출 이름 — 조건식·자리표시자에서 scn_act/scn_label/scn_turns ──
{
  const schema = cp(BASE);
  schema.directives = [
    { id: 'd1', when: 'scn_act == "act2"', text: '2막 전용 지시' },
    { id: 'd2', when: 'scn_turns >= 1', text: '막 경과 지시' },
  ];
  const v = validateSchema(schema);
  ck('★ 검증: scn_* 조건식 통과', v.ok, v.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
  let st = engine.initState(schema);
  const t1 = turn(schema, st);
  ck('★ scn_act 지시문: 1막에선 안 뜸', !t1.prompt.includes('2막 전용'), '');
  st = t1.state; st = turn(schema, st).state;
  st = turn(schema, st, { finds: 2 }).state;
  const t2 = turn(schema, st);
  ck('★ scn_act 지시문: 2막에서 뜸', t2.prompt.includes('2막 전용'), '');
  const lookup = engine.makeLookup(schema, st.vars);
  ck('★ lookup: scn_label = 현재 막 라벨', lookup('scn_label') === '전개', String(lookup('scn_label')));
}

// ── 세이브 왕복 — 직렬화 뒤에도 막이 유지된다 ──
{
  const schema = cp(BASE);
  let st = engine.initState(schema);
  st = turn(schema, st).state; st = turn(schema, st).state;
  st = turn(schema, st, { finds: 2 }).state;
  const revived = engine.reconcileState(schema, JSON.parse(JSON.stringify(st)));
  ck('★ 세이브 왕복: 막 유지', revived.vars.scn_idx === 1, String(revived.vars.scn_idx));
  // 막이 줄어든 스키마를 만난 옛 세이브 — 잘라내고 안 죽는다
  const shrunk = cp(schema);
  shrunk.scenario.acts = shrunk.scenario.acts.slice(0, 1);
  const t = turn(shrunk, revived);
  ck('막이 줄어도 안 죽음 (잘라냄)', t.prompt.includes('(1/1막)'), '');
}

// ── 세션 0(최초설정) — 이야기 지시는 아직 이르다 ──
{
  const schema = cp(BASE);
  schema.setup = { ai: { enabled: true, vars: ['finds'] } };
  const st = engine.initState(schema);
  const sp = engine.sendPhase(schema, st, { armedActions: [] });
  ck('★ 세션 0에는 시나리오 주입 없음', !sp.promptBlock.includes('[이야기 지침]'), '');
}

// ── 보조 프롬프트 격리 — secret은 보조 쪽에도 안 실린다 ──
{
  const schema = cp(BASE);
  const st = engine.initState(schema);
  const aux = engine.buildAuxPrompt(schema, st, '서사 본문', '유저 입력', '');
  ck('★ 보조 프롬프트에 시나리오 없음 (direct·secret 둘 다)',
    !aux.includes('셋이 아니라 넷') && !aux.includes('[이야기 지침]'), '');
  ck('보조 조정 목록에 예약 키 없음', !aux.includes('scn_idx') && !aux.includes('scn_turns'), '');
}

// ── 검증 ──
{
  const v0 = validateSchema(cp(BASE));
  ck('★ 기준 스키마 검증 통과', v0.ok, v0.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));

  const noUnlock = cp(BASE);
  delete noUnlock.scenario.acts[1].unlock;
  ck('★ 중간 막 unlock 없음 = 오류 ("영영 안 열림")',
    validateSchema(noUnlock).errors.some((e) => e.msg.includes('영영 안 열립니다')), '');

  const badExpr = cp(BASE);
  badExpr.scenario.acts[1].unlock = 'nonexistent >= 2';
  ck('★ unlock의 없는 변수 = 오류', validateSchema(badExpr).errors.some((e) => e.msg.includes("'nonexistent'")), '');

  const randUnlock = cp(BASE);
  randUnlock.scenario.acts[1].unlock = 'rand(1, 6) >= 5';
  ck('★ unlock에 rand() 금지 (전환은 결정적)', validateSchema(randUnlock).errors.some((e) => e.msg.includes('rand()')), '');

  const firstUnlock = cp(BASE);
  firstUnlock.scenario.acts[0].unlock = 'finds >= 1';
  ck('첫 막 unlock = 경고 (무시됨)', validateSchema(firstUnlock).warnings.some((w) => w.msg.includes('첫 막')), '');

  const badIntensity = cp(BASE);
  badIntensity.scenario.acts[0].intensity = '폭발';
  ck('모르는 intensity = 오류', validateSchema(badIntensity).errors.some((e) => e.msg.includes('intensity')), '');

  const collide = cp(BASE);
  collide.vars.push({ id: 'scn_act', label: 'X', type: 'int', init: 0 });
  ck('★ 예약 이름 충돌 = 오류', validateSchema(collide).errors.some((e) => e.msg.includes('예약 이름')), '');

  const badEnter = cp(BASE);
  badEnter.scenario.acts[1].onEnter = [{ set: 'nope', expr: '1' }];
  ck('onEnter의 없는 변수 = 오류', validateSchema(badEnter).errors.some((e) => e.path.includes('onEnter')), '');

  const dupId = cp(BASE);
  dupId.scenario.acts[2].id = 'act2';
  ck('중복 막 id = 오류', validateSchema(dupId).errors.some((e) => e.msg.includes('중복 막 id')), '');

  const emptyActs = cp(BASE);
  emptyActs.scenario.acts = [];
  ck('빈 acts = 오류', validateSchema(emptyActs).errors.some((e) => e.path === '$.scenario.acts'), '');

  const bareAct = cp(BASE);
  delete bareAct.scenario.acts[2].intensity;
  ck('direct도 intensity도 없는 막 = 경고', validateSchema(bareAct).warnings.some((w) => w.msg.includes('연출 지시가 없습니다')), '');
}

// ── 편집기 슬라이스 (v0.91) — [시나리오] 탭을 AI에게 맡길 수 있다 ──
{
  const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
  const M = new Function('validateSchema', 'TEMPLATES', 'timeConfig', 'EXPOSED_LABELS', 'INTENSITIES',
    seg + '\nreturn { buildTabExportPrompt, pickTabFragment, TAB_SLICES, tabItemCounts, tabItemIds, planTabImport, FEATURE_RECIPES };')(
    validateSchema, SC.require('templates').TEMPLATES, SC.require('time').timeConfig,
    SC.require('time').EXPOSED_LABELS, scn.INTENSITIES);

  ck('★ scenario 슬라이스 등록', !!M.TAB_SLICES.scenario, '');
  const sp = M.buildTabExportPrompt(cp(BASE), 'scenario');
  ck('★ 요청서: 최상위 키 못박음', sp.includes('`"scenario"`'), '');
  ck('★ 요청서: 규격 절 + v1.3 생성 규칙 (표면/secret 분리·주인공 금지)',
    sp.includes('## 시나리오 규격') && sp.includes('표면') && sp.includes('배우를 조종'), '');
  ck('요청서: 변수 계약표 동봉', sp.includes('여기 있는 것만') && sp.includes('| `finds` |'), '');
  ck('요청서: 예시 JSON 동봉 + 다른 봇 이름 경고', sp.includes('"acts"') && sp.includes('다른 봇의 변수 이름'), '');
  ck('요청서: 체크섬에 막 개수', /scenario\.acts` \*\*\d+개\*\*/.test(sp), '');

  // 왕복 — 조각 골라내기 + 신원 계획
  const got = M.pickTabFragment('scenario', { scenario: { acts: [{ id: 'a1', direct: 'x' }] } });
  ck('★ 조각 골라내기', got.scenario.acts.length === 1, '');
  const plan = M.planTabImport(cp(BASE), 'scenario',
    { scenario: { label: '', acts: [{ id: 'act1', label: '잠복' }] } });
  ck('★ 적용 전 계획: 사라지는 막이 신원으로 잡힘',
    plan.lost.includes('막 전개') && plan.lost.includes('막 절정') && !plan.lost.includes('막 잠복'),
    plan.lost.join(', '));

  // 🧩 카드
  const card = M.FEATURE_RECIPES.find((r) => r.id === 'scenario');
  ck('★ 📖 시나리오 카드 존재 + scenario 슬라이스 사용', !!card && card.steps[0].tab === 'scenario', '');
  ck('카드 전제: 변수 0개면 막힘', typeof card.needs({ vars: [] }) === 'string', '');
  ck('카드 전제: 변수 있으면 열림', card.needs(cp(BASE)) === null, '');

  // 통짜 규격서에도 절이 실림 (내장 AI 생성 경로)
  ck('★ 편집기 탭·통짜 규격서 배선', src.includes("['scenario', '시나리오']")
    && src.includes('scenario: tabScenario') && src.includes('시나리오(scenario) — 중심 이야기를'), '');
}

// ── 집계 ──
let pass = 0, fail = 0;
for (const [c, n, x] of R) {
  if (c) { pass++; console.log(`PASS ${n}`); }
  else { fail++; console.log(`FAIL ${n} ${x ? '— ' + x : ''}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
