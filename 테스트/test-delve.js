const __P = (...p) => require('path').resolve(__dirname, ...p);
// 미궁 탐사 템플릿 — **판이 실제로 굴러가는가.**
//
// 진단(diagnose)은 액션을 안 누른다. 그런데 이 템플릿은 핵심 루프가 통째로 액션이라
// (내려간다 → 판다 → 돌아온다) 진단으로는 아무것도 못 잰다 — 실측했더니 120턴 내내
// 지상에 서 있었고 발견은 low 4건뿐이었다. 그래서 여기서 직접 굴린다.
//
// ★ 이 파일이 존재하는 진짜 이유는 교착이다. 첫 판에서 **횃불 0 · 금화 28** 상태로
//   영구 정지했다 — 보급은 50이 필요하고, 금화는 내려가야 벌리고, 내려가려면 횃불이 있어야 한다.
//   어느 프리셋의 문제가 아니라 누구나 빠질 수 있는 구멍이었다. 삯일(odd_job)이 바닥을 받친다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { TEMPLATES } = SC.require('templates');
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const expr = SC.require('expr');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const S = TEMPLATES.delve && TEMPLATES.delve.schema;

ck('미궁 템플릿이 등록됐다', !!S, '');
if (!S) { report(); }

const v = validateSchema(S);
ck('스키마가 유효하다', v.ok, (v.errors[0] || {}).msg);
ck('경고도 없다', v.warnings.length === 0, (v.warnings[0] || {}).msg);

// ── 이 템플릿이 맡은 기능 (다른 13종이 안 쓰던 것들) ──
ck('★ 탭 배치를 쓰는 첫 템플릿', S.statusUI.layout === 'tabs', String(S.statusUI.layout));
ck('탭이 성립하려면 보이는 그룹이 둘 이상', S.statusUI.groups.length >= 2, String(S.statusUI.groups.length));
ck('모든 그룹에 이름이 있다 (없으면 탭에 "그룹 N"으로 뜬다)',
  S.statusUI.groups.every((g) => !!g.label), '');
ck('판정 2종 — 굴림 규칙이 서로 다르다', S.checks.length === 2
  && S.checks[0].roll !== S.checks[1].roll, '');
ck('어둠이면 불리하게 굴린다', /min\(rand/.test(S.checks.find((c) => c.id === 'ck_delve').roll), '');
ck('whenArmed 두 번째 사용처 — 영입 턴에만 명단을 연다',
  (S.updater.allow.find((a) => a.id === 'roster') || {}).whenArmed?.[0] === 'recruit', '');

// ── 편성이 판정에 실제로 실리는가 ──
{
  const st = engine.initState(S);
  const D = (id, vars) => expr.evaluate(S.derived.find((d) => d.id === id).expr, engine.makeLookup(S, vars));
  ck('★ 기본값으로도 진형이 차 있다 (비면 전투력 0이라 거의 다 실패한다)',
    D('power', st.vars) > 0, `power ${D('power', st.vars)}`);
  const full = { ...st.vars, front1: '가르한', front2: '바위손', back1: '이슬비', back2: '무명' };
  ck('진형을 채우면 전투력이 오른다', D('power', full) > D('power', st.vars),
    `${D('power', st.vars)} → ${D('power', full)}`);
  ck('전열이 후열보다 크게 실린다',
    D('power', { ...st.vars, front1: '가르한', front2: '없음', back1: '없음', back2: '없음' })
    > D('power', { ...st.vars, front1: '없음', front2: '없음', back1: '이슬비', back2: '없음' }), '');
  ck('깊어질수록 문턱이 오른다', D('danger', { ...st.vars, depth: 10 }) > D('danger', { ...st.vars, depth: 1 }), '');
}

// ── 판을 실제로 굴린다 ──
// 탐욕 플레이어: 지상이면 벌고 사고 내려가고, 지하면 위험할 때 돌아온다.
function play(seed, preset, turns = 200) {
  let st = engine.initState(S); st.meta.setupDone = true;
  if (preset) for (const [k, val] of Object.entries(preset.set)) st.vars[k] = val;
  const D = (id) => expr.evaluate(S.derived.find((d) => d.id === id).expr, engine.makeLookup(S, st.vars));
  let stuck = 0, maxStuck = 0, acted = 0;
  for (let t = 1; t <= turns; t++) {
    const w = st.vars;
    // 하고 싶은 순서대로 늘어놓고 **실제로 무장되는 첫 번째**를 고른다.
    // 하나만 찍어서 실패하면(쿨다운·조건) 그 턴을 통째로 날린다 — 사람도 그렇게 안 논다.
    let want;
    if (w.depth === 0) {
      want = ['recruit', 'heal', 'supply', 'enter', 'odd_job'];
      if (!(w.gold >= 400 && w.roster.length < 6)) want = want.filter((a) => a !== 'recruit');
      if (!(w.gold >= 50 && w.torch < Math.max(w.anchor, 1) + 6)) want = want.filter((a) => a !== 'supply');
    } else if (w.hp <= D('max_hp') * 0.3 || w.torch <= 0 || w.rations <= 0) want = ['retreat'];
    else want = w.stairs ? ['descend', 'delve'] : ['delve', 'retreat'];

    let armed = null;
    for (const a of want) {
      const r = engine.toggleAction(S, st, a);
      if (r.armed) { armed = r; break; }
      st = r.state; // 무장 실패는 상태를 안 바꾸지만 반환본을 계속 이어 쓴다
    }
    if (armed) { st = armed.state; acted++; stuck = 0; }
    else { stuck++; maxStuck = Math.max(maxStuck, stuck); }
    st = engine.sendPhase(S, st, { rng: seededRng(seed, t, 'a') }).state;
    st = engine.outputPhase(S, st, {}, {}, { rng: seededRng(seed, t, 'o') }).state;
  }
  return { ...st.vars, maxStuck, acted };
}

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f'];
const runs = (preset) => SEEDS.map((s) => play(s, preset));
const avg = (rows, k) => Math.round(rows.reduce((a, b) => a + (Array.isArray(b[k]) ? b[k].length : b[k]), 0) / rows.length);

{
  const base = runs(null);
  ck('★ 판이 굴러간다 — 기본값으로 지하까지 내려간다', avg(base, 'best_depth') >= 3,
    `평균 ${avg(base, 'best_depth')}층`);
  ck('귀환 지점이 자란다 (매번 1층부터면 무한 미궁이 성립 안 한다)',
    avg(base, 'anchor') >= 2, `평균 ${avg(base, 'anchor')}층`);
  ck('노획이 금화로 바뀐다', avg(base, 'gold') > 0, String(avg(base, 'gold')));

  // ★ 교착 — 아무 액션도 못 누르는 상태가 이어지면 판이 죽는다
  const worstStuck = Math.max(...base.map((r) => r.maxStuck));
  ck('★ 교착이 없다 (지상에서 할 수 있는 일이 항상 하나는 있다)',
    worstStuck <= 2, `최장 ${worstStuck}턴 연속 아무것도 못 함`);
  ck('삯일이 바닥을 받친다', (S.actions.find((a) => a.id === 'odd_job') || {}).when === 'depth == 0',
    '조건 없이 지상이면 항상 눌려야 한다');
}

// ── 프리셋 난이도 사다리 ──
{
  const by = {};
  for (const p of S.setup.presets) by[p.id] = avg(runs(p), 'best_depth');
  const easy = by.veteran, mid = by.first, hard = by.debt;
  ck('프리셋이 셋이다', S.setup.presets.length === 3, '');
  ck('★ 사다리가 순서대로다 (빚 < 첫 잠행 < 숙련)', hard <= mid && mid <= easy,
    `빚 ${hard} · 첫 ${mid} · 숙련 ${easy}`);
  // 규격: 쉬움과 어려움의 격차가 너무 벌어지면 어려움은 아무도 못 깨고 쉬움은 심심하다
  ck('쉬움/어려움 격차가 2.5배 안쪽', easy <= hard * 2.5,
    `숙련 ${easy} / 빚 ${hard} = ${(easy / hard).toFixed(1)}배`);
  ck('어려움도 지하까지는 간다 (시작부터 막히면 안 된다)', hard >= 3, `${hard}층`);
}

// ── 쓰러져도 판이 이어진다 (원정형) ──
{
  let st = engine.initState(S); st.meta.setupDone = true;
  st.vars.depth = 6; st.vars.anchor = 6; st.vars.haul = 500; st.vars.hp = 0;
  st = engine.outputPhase(S, st, {}, {}, { rng: seededRng('z', 1, 'o') }).state;
  ck('★ 쓰러지면 지상으로 기어나온다 (죽지 않는다)', st.vars.depth === 0 && st.vars.hp > 0,
    `depth ${st.vars.depth} hp ${st.vars.hp}`);
  ck('노획을 통째로 잃는다 — 이게 강행의 대가', st.vars.haul === 0, String(st.vars.haul));
  ck('귀환 지점도 뒤로 밀린다', st.vars.anchor < 6, String(st.vars.anchor));
  // hp를 1로 올려 조건을 스스로 닫는다 — 안 그러면 매 턴 재발동한다
  const again = engine.outputPhase(S, st, {}, {}, { rng: seededRng('z', 2, 'o') }).state;
  ck('한 번만 발동한다 (조건을 스스로 닫는다)', again.vars.anchor === st.vars.anchor, '');
}

// ── 편성표·기능 카드가 이 스키마에서 성립하는가 ──
{
  ck('편성표가 명단을 가리킨다', S.party.roster === 'roster', '');
  const slotVars = S.party.tabs[0].slots.map((s2) => s2.var);
  ck('슬롯이 전부 enum이다', slotVars.every((id) => (S.vars.find((x) => x.id === id) || {}).type === 'enum'), '');
  ck('명단 초기값이 슬롯 후보에 들어 있다', (() => {
    const cand = S.vars.find((x) => x.id === 'front1').enum;
    return S.vars.find((x) => x.id === 'roster').init.every((n) => cand.includes(n));
  })(), '');
  // 🧩 기능 카드 전제 — 상점(돈+목록) · 스킬트리(enum|목록) · 편성표
  const hasNum = S.vars.some((x) => x.type === 'int');
  const hasList = S.vars.some((x) => x.type === 'list');
  const hasEnum = S.vars.some((x) => x.type === 'enum');
  ck('🧩 상점 카드 전제 충족 (숫자 + 목록)', hasNum && hasList, '');
  ck('🧩 스킬트리·편성표 카드 전제 충족 (enum 또는 목록)', hasEnum || hasList, '');
  // 시간 체계가 없으니 퀘스트·달력 카드는 잠긴다 — 의도된 것이다 (한 턴 = 탐색 1회)
  ck('시간 체계는 일부러 안 쓴다 (한 턴 = 탐색 1회)', !S.time, '');
}

report();

function report() {
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
}
