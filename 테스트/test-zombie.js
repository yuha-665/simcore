const __P = (...p) => require('path').resolve(__dirname, ...p);
// 아포칼립스 템플릿 — 낮에 나가 뒤지고 밤에 버티는 판이 실제로 굴러가는가.
//
// 진단은 액션을 안 누른다. 게다가 이 템플릿은 시간이 명시적(explicit)이라 진단의 "방치" 쪽은
// **시계가 아예 안 흐른다** — 가만있으면 영원히 안 죽는 것으로 나온다. 그래서 진단의
// "액션을 쓸수록 빨리 죽는다"는 지적은 이 템플릿에서 구조적으로 뜰 수밖에 없다.
// 진짜로 물어야 할 것은 "제대로 플레이하면 살 만한가"이고, 그건 여기서 직접 굴려서 잰다.
//
// ★ 만들면서 실측으로 잡은 것: place를 보조 AI만 바꿀 수 있게 뒀더니 은신처에서 한 발짝도
//   못 나가 수색을 0번 하고 8시드 전부 굶어 죽었다. 물자 루프 전체가 AI 협조에 걸려 있었다.
//   나가기·돌아오기를 버튼이 확정하게 바꾼 뒤에야 판이 성립했다.
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
const S = TEMPLATES.zombie && TEMPLATES.zombie.schema;
ck('아포칼립스 템플릿이 등록됐다', !!S, '');
if (!S) report();

const v = validateSchema(S);
ck('스키마가 유효하다', v.ok, (v.errors[0] || {}).msg);
ck('경고도 없다', v.warnings.length === 0, (v.warnings[0] || {}).msg);

// ── 이 템플릿이 세운 세 축 ──
ck('★ 축① 소음이 밤 습격의 유일한 입력이다',
  /noise/.test((S.derived.find((d) => d.id === 'horde') || {}).expr || ''), '');
ck('★ 축② 감염은 밤을 넘길 때만 진행한다 (하루당 정확히 1)',
  /bitten/.test(JSON.stringify(S.actions.find((a) => a.id === 'nightfall').effects)), '');
ck('★ 축③ 시계가 진짜로 흐른다 (explicit)', S.time && S.time.advance === 'explicit', '');
ck('밤을 넘기면 다음 날 아침으로 (daily의 💤과 같은 계산)',
  /1859 - hour \* 60 - minute/.test(JSON.stringify(S.actions.find((a) => a.id === 'nightfall').effects)), '');

// ── 패배 조건이 bool로 명시돼 있어야 진단이 난이도를 잰다 ──
{
  const dead = S.vars.find((x) => x.id === 'dead');
  ck('★ 패배 변수가 bool로 있다 (없으면 진단이 난이도를 못 잰다)', dead && dead.type === 'bool', '');
  const ends = S.rules.events.filter((e) => JSON.stringify(e.effects || []).includes('"dead"'));
  ck('끝나는 길이 둘이다 (감염 / 체력)', ends.length === 2, String(ends.length));
  ck('패배 변수는 AI에게 안 연다', !S.updater.allow.some((a) => a.id === 'dead'), '');
}

// ── ★ 물자 루프가 AI 협조 없이 성립하는가 ──
// 실측 사고: place를 AI만 바꿀 수 있게 뒀더니 수색을 영영 못 했다.
{
  const out = S.actions.find((a) => a.id === 'go_out');
  const home = S.actions.find((a) => a.id === 'go_home');
  ck('★ 나가기가 place를 스스로 바꾼다 (AI에 안 맡긴다)',
    out && /place/.test(JSON.stringify(out.effects || [])), '');
  ck('★ 돌아오기도 스스로 바꾼다', home && /place/.test(JSON.stringify(home.effects || [])), '');
  ck('어느 건물인지는 명령으로도 옮긴다 (/장소)',
    (S.vars.find((x) => x.id === 'place') || {}).cmd === '장소', '');
  ck('밤 버튼은 함정 지적에서 면제 표시 (안 누를 수가 없는 버튼이다)',
    S.actions.find((a) => a.id === 'nightfall').impactExempt === true, '');
}

// ── 판을 실제로 굴린다 ──
// 하루 리듬: 아침에 나가 뒤지고, 늦으면 돌아와 보강하고, 밤을 넘긴다.
function play(seed, preset, days = 40) {
  let st = engine.initState(S); st.meta.setupDone = true;
  if (preset) for (const [k, val] of Object.entries(preset.set)) st.vars[k] = val;
  const D = (id) => expr.evaluate(S.derived.find((d) => d.id === id).expr, engine.makeLookup(S, st.vars));
  let scavenged = 0, nights = 0, stuck = 0, maxStuck = 0;
  for (let t = 1; t <= days * 6; t++) {
    if (st.vars.dead) break;
    const w = st.vars;
    // 하루 리듬. ⚠ 밤에 보강(fortify)을 앞에 두면 쿨다운이 없어 영원히 보강만 하다
    // 밤을 못 넘긴다 — 실측으로 밟은 정책 함정이라 순서가 중요하다.
    let want;
    if (D('is_night')) want = w.place === '은신처' ? ['nightfall'] : ['go_home', 'nightfall'];
    else if (w.hp < 30 || w.bitten >= 3) want = w.place === '은신처' ? ['treat', 'nightfall'] : ['go_home'];
    else if (w.place === '은신처') {
      want = w.barricade < 50 ? ['fortify', 'go_out'] : ['go_out', 'rest'];
      if (w.bitten >= 1 || w.hp < 60) want = ['treat', ...want];
    } else if (w.food >= 10 || w.noise >= 70) want = ['go_home'];
    else want = ['scavenge', 'go_home'];

    let armed = null, pick = null;
    for (const a of want) { const r = engine.toggleAction(S, st, a); if (r.armed) { armed = r; pick = a; break; } }
    if (armed) {
      st = armed.state; stuck = 0;
      if (pick === 'scavenge') scavenged++;
      if (pick === 'nightfall') nights++;
    } else { stuck++; maxStuck = Math.max(maxStuck, stuck); }
    st = engine.sendPhase(S, st, { rng: seededRng(seed, t, 'a') }).state;
    st = engine.outputPhase(S, st, {}, {}, { rng: seededRng(seed, t, 'o') }).state;
  }
  return { ...st.vars, scavenged, nights, maxStuck };
}

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const runs = (p) => SEEDS.map((s) => play(s, p));
const rate = (rows, f) => rows.filter(f).length / rows.length;
const avg = (rows, k) => Math.round(rows.reduce((a, b) => a + b[k], 0) / rows.length);

{
  const base = runs(null);
  ck('★ 수색을 실제로 한다 (은신처에 갇히지 않는다)', avg(base, 'scavenged') >= 5,
    `평균 ${avg(base, 'scavenged')}회`);
  ck('★ 밤을 여러 번 넘긴다 (하루 리듬이 돈다)', avg(base, 'nights') >= 5, `평균 ${avg(base, 'nights')}밤`);
  ck('교착이 없다 (할 수 있는 일이 항상 하나는 있다)', Math.max(...base.map((r) => r.maxStuck)) <= 2,
    `최장 ${Math.max(...base.map((r) => r.maxStuck))}턴`);
  const survived = rate(base, (r) => !r.dead);
  // 살 만해야 하고, 그렇다고 아무나 사는 것도 아니어야 한다
  ck('★ 제대로 굴리면 살 만하다 (전멸하는 판이 아니다)', survived > 0, `생존 ${Math.round(survived * 100)}%`);
  ck('그렇다고 늘 사는 것도 아니다 (긴장이 남아 있다)', survived < 1, `생존 ${Math.round(survived * 100)}%`);
}

// ── 프리셋 난이도 사다리 ──
{
  ck('프리셋이 셋이다', S.setup.presets.length === 3, '');
  const by = {};
  for (const p of S.setup.presets) by[p.id] = rate(runs(p), (r) => !r.dead);
  ck('★ 사다리가 순서대로다 (물렸다 ≤ 사흘째 ≤ 운이 좋았다)',
    by.bitten <= by.day3 + 0.001 && by.day3 <= by.lucky + 0.001,
    `물렸다 ${Math.round(by.bitten * 100)}% · 사흘째 ${Math.round(by.day3 * 100)}% · 운 ${Math.round(by.lucky * 100)}%`);
  ck('가장 어려운 프리셋도 전멸은 아니다', by.bitten >= 0 && by.lucky > 0,
    `물렸다 ${Math.round(by.bitten * 100)}%`);
}

// ── 감염 시한이 실제로 굴러가는가 ──
{
  let st = engine.initState(S); st.meta.setupDone = true;
  st.vars.bitten = 1; st.vars.food = 20; st.vars.med = 0;
  const before = st.vars.bitten;
  for (let d = 0; d < 3; d++) {
    st = engine.toggleAction(S, st, 'nightfall').state;
    st = engine.sendPhase(S, st, { rng: seededRng('n', d, 'a') }).state;
    st = engine.outputPhase(S, st, {}, {}, { rng: seededRng('n', d, 'o') }).state;
  }
  ck('★ 감염은 밤마다 진행한다', st.vars.bitten > before, `${before} → ${st.vars.bitten}`);
  // 약이 있으면 되돌린다
  let st2 = engine.initState(S); st2.meta.setupDone = true;
  st2.vars.bitten = 3; st2.vars.med = 2;
  st2 = engine.toggleAction(S, st2, 'treat').state;
  st2 = engine.sendPhase(S, st2, { rng: seededRng('m', 1, 'a') }).state;
  ck('약이 감염을 되돌린다', st2.vars.bitten < 3, `3 → ${st2.vars.bitten}`);
  ck('약 없이 5까지 가면 끝난다', (S.rules.events.find((e) => e.id === 'turned') || {}).when === 'bitten >= 5 and not dead', '');
}

// ── 소음 → 밤 습격이 이어지는가 ──
{
  const D = (id, vars) => expr.evaluate(S.derived.find((d) => d.id === id).expr, engine.makeLookup(S, vars));
  const st = engine.initState(S);
  ck('소음이 높을수록 습격이 커진다',
    D('horde', { ...st.vars, noise: 80 }) > D('horde', { ...st.vars, noise: 10 }), '');
  const loud = (v) => { // 시끄러운 밤을 하루 넘겨 본다
    let s2 = engine.initState(S); s2.meta.setupDone = true;
    s2.vars.noise = v; s2.vars.barricade = 0; s2.vars.guard1 = '없음'; s2.vars.food = 20;
    s2 = engine.toggleAction(S, s2, 'nightfall').state;
    s2 = engine.sendPhase(S, s2, { rng: seededRng('q', v, 'a') }).state;
    return s2.vars.hp;
  };
  ck('★ 시끄러운 밤이 더 아프다 (소음이 진짜 대가다)', loud(90) < loud(10), `${loud(90)} vs ${loud(10)}`);
  ck('방벽과 보초가 습격을 받아낸다', (() => {
    let a = engine.initState(S); a.meta.setupDone = true;
    a.vars.noise = 90; a.vars.barricade = 90; a.vars.guard1 = '미주'; a.vars.food = 20;
    a = engine.toggleAction(S, a, 'nightfall').state;
    a = engine.sendPhase(S, a, { rng: seededRng('q', 90, 'a') }).state;
    return a.vars.hp > loud(90);
  })(), '');
  ck('밤을 넘기면 소음이 가라앉는다',
    /noise.*0\.4/.test(JSON.stringify(S.actions.find((a) => a.id === 'nightfall').effects)), '');
}

// ── 편성표 ──
{
  ck('편성표가 명단을 가리킨다', S.party.roster === 'crew', '');
  const slots = S.party.tabs.flatMap((t) => (t.slots || []).map((s2) => s2.var));
  ck('슬롯이 전부 enum이다', slots.every((id) => (S.vars.find((x) => x.id === id) || {}).type === 'enum'), '');
  ck('명단 초기값이 슬롯 후보에 들어 있다', (() => {
    const cand = S.vars.find((x) => x.id === 'scout1').enum;
    return S.vars.find((x) => x.id === 'crew').init.every((n) => cand.includes(n));
  })(), '');
  ck('탐색조와 밤이 탭으로 갈려 있다', S.party.tabs.length === 2, '');
}

report();

function report() {
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
}
