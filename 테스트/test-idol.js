const __P = (...p) => require('path').resolve(__dirname, ...p);
// 아이돌 프로듀스 템플릿 — 달력을 한가운데 둔 판이 실제로 굴러가는가.
//
// 진단은 액션을 안 누르고, 편성표(레슨·편성)는 아예 못 만진다. 이 템플릿은 그 두 곳에
// 루프의 절반이 들어 있다 — 일감을 받아 D-day를 기다렸다가 무대에 서는 흐름과, 자금을
// 스탯으로 바꾸는 레슨. 그래서 여기서 직접 굴린다.
//
// 진단이 못 보는 것 하나 더: 패배는 대개 멘탈 0(burnout)인데 멘탈은 보조 AI가 움직인다.
// 시뮬에는 AI가 없으니 진단 쪽에서는 파산만 잡힌다 — 그건 결함이 아니라 사각지대다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { TEMPLATES } = SC.require('templates');
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const expr = SC.require('expr');
const { seededRng } = SC.require('rng');
const { partyTabs, applyUpgrade } = SC.require('party');
const { monthView } = SC.require('calendar');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const S = TEMPLATES.idol && TEMPLATES.idol.schema;
ck('아이돌 템플릿이 등록됐다', !!S, '');
if (!S) report();

const v = validateSchema(S);
ck('스키마가 유효하다', v.ok, (v.errors[0] || {}).msg);
ck('경고도 없다', v.warnings.length === 0, (v.warnings[0] || {}).msg);

const A = (id) => S.actions.find((a) => a.id === id);
const V = (id) => S.vars.find((x) => x.id === id);
const D = (id, vars) => expr.evaluate(S.derived.find((d) => d.id === id).expr, engine.makeLookup(S, vars));

// ── 이 템플릿이 세운 세 축 ──
{
  ck('★ 축① 달력이 루프의 한가운데다 (일감에 D-day가 박힌다)',
    !!V('job_days') && /job_days/.test(JSON.stringify(A('perform').when)), '');
  const condExpr = S.derived.find((d) => d.id === 'c1').expr;
  ck('★ 축② 컨디션은 체력과 멘탈에서 나온다 (따로 굴러다니는 숫자가 아니다)',
    /m1_st/.test(condExpr) && /m1_me/.test(condExpr), condExpr);
  ck('★ 축② 컨디션이 무대 판정에 실린다',
    /u_cond/.test(S.checks.find((c) => c.id === 'ck_stage').mod), '');
  ck('★ 축③ 등급이 일감 크기를 연다',
    /rank_n/.test(JSON.stringify(A('take_small').effects))
    && /rank_n/.test(JSON.stringify(S.checks.find((c) => c.id === 'ck_pitch').grades)), '');
  ck('날짜를 넘기는 입구는 🌙 하나뿐이다 (AI에게도 안 연다)',
    S.actions.filter((a) => /skip_day/.test(JSON.stringify(a.effects || []))).length === 1
    && !S.updater.allow.some((a) => a.id === 'skip_day'), '');
  ck('🌙는 함정 지적에서 면제 표시 (안 누를 수가 없는 버튼이다)', A('next_day').impactExempt === true, '');
  ck('융자도 면제 표시 (일부러 손해인 버튼이다)', A('borrow').impactExempt === true, '');
}

// ── 패배 조건 — 이름 규약을 지켜야 진단이 난이도를 잰다 ──
{
  const lose = V('unit_over');
  ck('★ 패배 변수가 bool로 있다', lose && lose.type === 'bool', '');
  // 진단의 pickLoseVar가 id를 정규식(dead|lost|over|fail|…)으로 찾는다. 한국어 라벨은
  // 자유지만 id가 이 규약을 벗어나면 생존율도 프리셋 난이도도 통째로 못 잰다 (실측).
  ck('★ 패배 변수 이름이 진단 규약에 맞는다 (over/dead/lost/fail …)',
    /lost|collapse|dead|over|fail|ruin|defeat|gameover/i.test(lose.id), lose.id);
  const ends = S.rules.events.filter((e) => JSON.stringify(e.effects || []).includes('"unit_over"'));
  ck('끝나는 길이 둘이다 (사람 / 돈)', ends.length === 2, String(ends.length));
  ck('사람 쪽이 먼저다 (멘탈 0이면 판이 멈춘다)',
    !!S.rules.events.find((e) => e.id === 'burnout' && /m1_me <= 0/.test(e.when)), '');
  ck('패배 변수는 AI에게 안 연다', !S.updater.allow.some((a) => a.id === 'unit_over'), '');
}

// ── 달력 ──
{
  ck('달력 패널이 일정 목록을 가리킨다', S.calendar.list === 'schedule', '');
  ck('지난 일정이 스스로 지워진다 (만료 규칙)',
    S.rules.onTurn.some((r) => r.list === 'schedule' && r.expire === 'elapsed'), '');
  ck('고정 일정이 달력에 박혀 있다 (매주 · 매달)',
    S.calendar.marks.length === 2 && S.calendar.marks.some((m) => m.weekday) && S.calendar.marks.some((m) => m.dom), '');
  const st = engine.initState(S);
  const mv = monthView(S, st, {});
  ck('★ 달력이 실제로 그려진다 (칸에 기념일이 붙는다)',
    mv && mv.cells.length >= 28 && mv.cells.some((c) => c.marks.length > 0),
    mv ? `${mv.cells.length}칸` : 'null');
}

// ── 편성: 센터가 더 실린다 ──
{
  const base = engine.initState(S).vars;
  const asCenter = { ...base, center: '린', side1: '유나', side2: '세리' };
  const asSide = { ...base, center: '유나', side1: '린', side2: '세리' };
  ck('★ 센터에 세운 사람이 더 크게 실린다', D('p3', asCenter) > D('p3', asSide),
    `${D('p3', asCenter)} vs ${D('p3', asSide)}`);
  ck('자리를 비우면 그 사람은 안 실린다', D('p3', { ...base, center: '유나', side1: '세리', side2: '없음' }) === 0, '');
  ck('빈 유닛은 무대에 못 선다',
    /stand >= 1/.test(A('perform').when) && D('stand', { ...base, center: '없음', side1: '없음', side2: '없음' }) === 0, '');
  const slots = S.party.tabs.flatMap((t) => (t.slots || []).map((s2) => s2.var));
  ck('슬롯이 전부 enum이다', slots.length === 3 && slots.every((id) => V(id).type === 'enum'), '');
  ck('빈값이 슬롯 후보에 들어 있다 (한 번 앉힌 뒤 비울 수 있다)',
    slots.every((id) => V(id).enum.includes(S.party.empty)), '');
}

// ── 레슨: 자금이 스탯이 된다 ──
{
  let st = engine.initState(S); st.meta.setupDone = true;
  st.vars.funds = 5000;
  const items = partyTabs(S).flatMap((t) => t.items || []);
  ck('레슨 항목이 멤버 셋 × 세 스탯이다', items.length === 9, String(items.length));
  const before = st.vars.m1_vo, fundsBefore = st.vars.funds;
  const r = applyUpgrade(S, st, 'm1_vo');
  ck('★ 레슨을 찍으면 스탯이 오른다', r.ok && r.changes.m1_vo === before + 1, r.reason || '');
  if (r.ok) Object.assign(st.vars, r.changes);
  ck('★ 레슨은 운용자금을 먹는다', st.vars.funds < fundsBefore, `${fundsBefore} → ${st.vars.funds}`);
  // 비용이 자기 레벨을 보므로 올릴수록 다음 한 칸이 비싸진다 — 이게 유일한 브레이크다
  const cheap = expr.evaluate(items[0].cost, engine.makeLookup(S, { ...st.vars, m1_vo: 10 }));
  const dear = expr.evaluate(items[0].cost, engine.makeLookup(S, { ...st.vars, m1_vo: 90 }));
  ck('★ 올릴수록 다음 한 칸이 비싸진다 (레슨의 브레이크)', dear > cheap * 2, `${cheap} → ${dear}`);
  let poor = engine.initState(S); poor.meta.setupDone = true; poor.vars.funds = 0;
  ck('자금이 없으면 못 찍는다', !applyUpgrade(S, poor, 'm1_vo').ok, '');
  ck('능력치는 AI에게 안 연다 (레슨으로만 오른다)',
    !S.updater.allow.some((a) => /_(vo|da|vi)$/.test(a.id)), '');
}

// ── 판을 실제로 굴린다 ──
// 하루 리듬: 일감을 받고, D-day를 기다리며 사람을 챙기고, 그날 무대에 선다.
function play(seed, preset, days = 60) {
  let st = engine.initState(S); st.meta.setupDone = true;
  if (preset) for (const [k, val] of Object.entries(preset.set)) st.vars[k] = val;
  let stages = 0, nights = 0, lessons = 0, stuck = 0, maxStuck = 0;
  for (let t = 1; t <= days * 3 && nights < days; t++) {
    if (st.vars.unit_over) break;
    const w = st.vars;
    const cond = D('u_cond', w);
    // ⚠ 케어 액션(talk·promo·rest_day)을 D-day 대기 중에 나란히 두면 쿨다운이 서로
    // 어긋나면서 영원히 그것만 돌다 하루를 못 넘긴다 — 좀비 템플릿의 보강(fortify)과
    // 똑같은 정책 함정이라 실측으로 밟았다. 컨디션이 멀쩡하면 무조건 날을 넘긴다.
    let want;
    if (w.job !== '없음' && w.job_days <= 0) want = ['perform', 'next_day'];
    else if (cond < 55) want = ['rest_day', 'talk', 'next_day'];
    else if (w.job === '없음') want = ['take_big', 'take_small', 'next_day'];
    else want = ['next_day'];
    if (w.job === '없음' && w.funds >= 300) want = ['promo', ...want];
    if (w.funds >= 800 && w.debt > 0) want = ['repay', ...want];
    if (w.funds < 60) want = ['borrow', ...want];

    let armed = null, pick = null;
    for (const a of want) { const r = engine.toggleAction(S, st, a); if (r.armed) { armed = r; pick = a; break; } }
    if (armed) {
      st = armed.state; stuck = 0;
      if (pick === 'perform') stages++;
      if (pick === 'next_day') nights++;
    } else { stuck++; maxStuck = Math.max(maxStuck, stuck); }
    st = engine.sendPhase(S, st, { rng: seededRng(seed, t, 'a') }).state;
    st = engine.outputPhase(S, st, {}, {}, { rng: seededRng(seed, t, 'o') }).state;
    // 여유가 있으면 레슨을 찍는다 — 편성표는 진단이 못 만지는 자리라 여기서만 굴러 본다
    if (st.vars.funds > 350) {
      for (const it of partyTabs(S).flatMap((tb) => tb.items || [])) {
        const up = applyUpgrade(S, st, it.var);
        if (up.ok) { Object.assign(st.vars, up.changes); lessons++; break; }
      }
    }
  }
  return { ...st.vars, stages, nights, lessons, maxStuck };
}

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const runs = (p) => SEEDS.map((s) => play(s, p));
const rate = (rows, f) => rows.filter(f).length / rows.length;
const avg = (rows, k) => Math.round(rows.reduce((a, b) => a + b[k], 0) / rows.length);

{
  const base = runs(null);
  ck('★ 무대에 실제로 여러 번 선다 (일감 루프가 돈다)', avg(base, 'stages') >= 8, `평균 ${avg(base, 'stages')}회`);
  ck('★ 날이 실제로 흐른다', avg(base, 'nights') >= 30, `평균 ${avg(base, 'nights')}일`);
  ck('★ 레슨이 실제로 돌아간다 (자금이 스탯이 된다)', avg(base, 'lessons') >= 3, `평균 ${avg(base, 'lessons')}회`);
  ck('교착이 없다 (할 수 있는 일이 항상 하나는 있다)', Math.max(...base.map((r) => r.maxStuck)) <= 2,
    `최장 ${Math.max(...base.map((r) => r.maxStuck))}턴`);
  ck('★ 능력치가 실제로 자란다', avg(base, 'm1_vo') > V('m1_vo').init, `${V('m1_vo').init} → ${avg(base, 'm1_vo')}`);
  ck('★ 등급이 올라간다 (인지도 → 등급 사다리가 살아 있다)',
    base.some((r) => r.rank !== V('rank').init), base.map((r) => r.rank).join(''));
  const survived = rate(base, (r) => !r.unit_over);
  ck('★ 제대로 굴리면 살 만하다', survived >= 0.5, `생존 ${Math.round(survived * 100)}%`);
}

// ── 펑크: 그날 무대에 안 서면 신용이 깎인다 ──
{
  let st = engine.initState(S); st.meta.setupDone = true;
  st.vars.job = '지역 라이브'; st.vars.job_days = 0;
  const before = st.vars.late;
  st = engine.toggleAction(S, st, 'next_day').state;
  st = engine.sendPhase(S, st, { rng: seededRng('l', 1, 'a') }).state;
  ck('★ D-day를 그냥 넘기면 펑크가 난다', st.vars.late === before + 1, `${before} → ${st.vars.late}`);
  ck('펑크가 나면 일감도 날아간다', st.vars.job === '없음', st.vars.job);
  ck('펑크는 판정에 그대로 붙는다', /late/.test(S.checks.find((c) => c.id === 'ck_stage').mod), '');
  // 남은 날이 있을 때는 펑크가 아니라 하루가 줄 뿐이다
  let ok = engine.initState(S); ok.meta.setupDone = true;
  ok.vars.job = '지역 라이브'; ok.vars.job_days = 3;
  ok = engine.toggleAction(S, ok, 'next_day').state;
  ok = engine.sendPhase(S, ok, { rng: seededRng('l', 2, 'a') }).state;
  ck('아직 남은 날이면 하루만 준다', ok.vars.late === 0 && ok.vars.job_days === 2,
    `펑크 ${ok.vars.late} · 남은 ${ok.vars.job_days}`);
}

// ── 월말 정산 빗장 — 시간 등호에는 반드시 짝이 필요하다 ──
{
  const ev = S.rules.events.find((e) => e.id === 'settle');
  ck('월말 정산이 빗장을 스스로 닫는다 (같은 달에 두 번 안 돈다)',
    /settled != month/.test(ev.when) && ev.effects.some((f) => f.set === 'settled'), '');
  ck('이자가 빚이 클수록 아프다', /debt \* 0\.05/.test(JSON.stringify(ev.effects)), '');
  ck('펑크는 달이 바뀌면 하나씩 잊힌다 (신용이 영영 안 죽는다)',
    ev.effects.some((f) => f.set === 'late'), '');
}

// ── 무대 판정이 정말 능력치와 컨디션을 본다 ──
{
  const roll = (vars) => {
    let st = engine.initState(S); st.meta.setupDone = true;
    Object.assign(st.vars, vars, { job: 'TV 음악방송', job_days: 0 });
    let win = 0;
    for (let i = 0; i < 60; i++) {
      let s2 = engine.initState(S); s2.meta.setupDone = true;
      Object.assign(s2.vars, vars, { job: 'TV 음악방송', job_days: 0 });
      s2 = engine.toggleAction(S, s2, 'perform').state;
      s2 = engine.sendPhase(S, s2, { rng: seededRng('s', i, 'a') }).state;
      if (s2.vars.buzz > 20 + 10) win++;     // 성공 계열만 화제성이 크게 뛴다
    }
    return win;
  };
  const weak = roll({ m1_vo: 10, m1_da: 10, m1_vi: 10, m2_vo: 10, m2_da: 10, m2_vi: 10, m3_vo: 10, m3_da: 10, m3_vi: 10 });
  const strong = roll({ m1_vo: 90, m1_da: 90, m1_vi: 90, m2_vo: 90, m2_da: 90, m2_vi: 90, m3_vo: 90, m3_da: 90, m3_vi: 90 });
  ck('★ 능력치가 높으면 무대가 잘 된다', strong > weak, `${weak} vs ${strong}`);
  const tired = roll({ m1_st: 5, m1_me: 5, m2_st: 5, m2_me: 5, m3_st: 5, m3_me: 5 });
  const fresh = roll({ m1_st: 100, m1_me: 100, m2_st: 100, m2_me: 100, m3_st: 100, m3_me: 100 });
  ck('★ 지쳐 있으면 무대가 무너진다 (컨디션이 진짜 축이다)', fresh > tired, `${tired} vs ${fresh}`);
  ck('무대에 서면 체력을 쓴다', /m1_st/.test(JSON.stringify(A('perform').effects)), '');
}

// ── 프리셋 난이도 사다리 ──
{
  ck('프리셋이 셋이다', S.setup.presets.length === 3, '');
  const by = {};
  for (const p of S.setup.presets) by[p.id] = rate(runs(p), (r) => !r.unit_over);
  ck('★ 사다리가 순서대로다 (빚에 눌려 ≤ 신인 셋 ≤ 한 번 터졌다)',
    by.debtor <= by.rookie + 0.001 && by.rookie <= by.hit + 0.001,
    `빚 ${Math.round(by.debtor * 100)}% · 신인 ${Math.round(by.rookie * 100)}% · 터졌다 ${Math.round(by.hit * 100)}%`);
  ck('가장 어려운 프리셋도 전멸은 아니다', by.debtor > 0, `${Math.round(by.debtor * 100)}%`);
}

// ── 개조하기 쉬운 초안인가 (이 템플릿의 목적) ──
{
  // 멤버 블록은 일곱 줄이 한 벌로 완전히 같아야 복사만으로 넷째가 들어온다
  const keys = (n) => S.vars.filter((x) => x.id.startsWith(`m${n}_`)).map((x) => x.id.slice(3)).sort().join(',');
  ck('★ 멤버 블록 셋이 완전히 같은 모양이다 (복사만으로 넷째가 들어온다)',
    keys(1) === keys(2) && keys(2) === keys(3) && keys(1).split(',').length === 7, keys(1));
  // 일감표가 두 줄에 모여 있어야 새 일감을 넣을 때 흩어진 곳을 안 찾는다
  const jobs = V('job').enum.filter((j) => j !== '없음');
  const vs = S.derived.find((d) => d.id === 'job_vs').expr;
  const pay = S.derived.find((d) => d.id === 'job_pay').expr;
  ck('★ 일감표가 두 줄(난이도·보수)에 다 모여 있다',
    jobs.every((j) => vs.includes(j) && pay.includes(j)), jobs.join(','));
  ck('일감이 어려울수록 많이 준다', (() => {
    const val = (e, j) => expr.evaluate(e, engine.makeLookup(S, { ...engine.initState(S).vars, job: j }));
    for (let i = 1; i < jobs.length; i++) {
      if (val(vs, jobs[i]) <= val(vs, jobs[i - 1])) return false;
      if (val(pay, jobs[i]) <= val(pay, jobs[i - 1])) return false;
    }
    return true;
  })(), jobs.join(' < '));
  ck('자리 배수가 멤버마다 한 줄이다 (슬롯×멤버 격자가 아니다)',
    ['p1', 'p2', 'p3'].every((id) => !!S.derived.find((d) => d.id === id)), '');
}

report();

function report() {
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
}
