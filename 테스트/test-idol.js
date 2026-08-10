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
  // v0.82 — 자리를 고르는 건 플레이어고, 여는 축은 인지도 하나다.
  // ⚠ 등급(rank_n)을 조건에 같이 걸면 같은 말이 두 번 되고, 진단이 "못 쓰는 액션"으로 오해한다
  ck('★ 축③ 인지도가 일감 사다리를 연다',
    ['take_radio', 'take_mag', 'take_ltv', 'take_cable', 'take_net', 'take_gold']
      .every((id) => /awareness >= \d+/.test(A(id).when)), '');
  ck('★ 일감 조건에 등급이 겹쳐 있지 않다 (인지도의 얼굴이라 같은 말이다)',
    ['take_ltv', 'take_cable', 'take_net', 'take_gold'].every((id) => !/rank_n/.test(A(id).when)), '');
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
  // v0.82 — 셋이다: 번아웃(멘탈 0) · 미납 이탈(석 달) · 파산. 앞의 둘이 사람 쪽이다
  ck('끝나는 길이 셋이다 (번아웃 · 미납 이탈 · 파산)', ends.length === 3, String(ends.length));
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
    else if (w.job === '없음') want = ['take_cable', 'take_ltv', 'take_mag', 'take_radio', 'take_street', 'next_day'];
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
    // 여유가 있으면 레슨을 찍는다 — 편성표는 진단이 못 만지는 자리라 여기서만 굴러 본다.
    // ⚠ 여유는 **다음 청구서를 남기고 남은 것**이다. 고정 350만원으로 두면 이 자동 플레이어는
    //   월급·임대료가 큰 프리셋일수록 더 크게 미납을 내서, 잘나가는 유닛이 신인보다 빨리
    //   죽는 뒤집힌 결과가 나온다 — 판 탓이 아니라 자동 플레이어가 청구서를 안 남긴 탓이다.
    if (st.vars.funds > D('salary', st.vars) + D('rent', st.vars) + 350) {
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
  st.vars.job = '잡지 화보'; st.vars.job_days = 0;
  const before = st.vars.late;
  st = engine.toggleAction(S, st, 'next_day').state;
  st = engine.sendPhase(S, st, { rng: seededRng('l', 1, 'a') }).state;
  ck('★ D-day를 그냥 넘기면 펑크가 난다', st.vars.late === before + 1, `${before} → ${st.vars.late}`);
  ck('펑크가 나면 일감도 날아간다', st.vars.job === '없음', st.vars.job);
  ck('펑크는 판정에 그대로 붙는다', /late/.test(S.checks.find((c) => c.id === 'ck_stage').mod), '');
  // 남은 날이 있을 때는 펑크가 아니라 하루가 줄 뿐이다
  let ok = engine.initState(S); ok.meta.setupDone = true;
  ok.vars.job = '잡지 화보'; ok.vars.job_days = 3;
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
  // v0.85부터 이자율은 난이도가 정한다 — (3 + hard_n * 2)% (보통 5% = 예전 값)
  ck('이자가 빚이 클수록 아프다', /debt \* \(3 \+ hard_n \* 2\) \/ 100/.test(JSON.stringify(ev.effects)), '');
  ck('펑크는 달이 바뀌면 하나씩 잊힌다 (신용이 영영 안 죽는다)',
    ev.effects.some((f) => f.set === 'late'), '');
}

// ── 장부: 수입은 적고, 지출은 잔고 차이로 역산한다 ──
// 지출을 하나하나 적으면 반드시 빠지는 데가 생긴다. 실제로 하나 있었다 —
// 레슨비는 편성표가 자금을 직접 쓰기 때문에 액션 효과로는 못 잡는다.
{
  // v0.81: income은 갈래 넷(무대·티켓·굿즈·음반)의 **파생**이다 — vars에 없다
  const ledger = (st) => ({
    funds: st.vars.funds, income: D('income', st.vars),
    spend: D('spend', st.vars), balance: D('balance', st.vars),
  });
  let st = engine.initState(S); st.meta.setupDone = true;
  // v0.81: 수입이 갈래 넷이 되면서 장부가 자기 탭을 얻었다.
  // 대신 프로덕션 탭은 유닛을 흡수했다 — 이 판은 사무소에 유닛이 하나뿐이라 갈라 둘 이유가 없다.
  ck('★ 장부가 자기 탭에 모여 있다', (() => {
    const g = (S.statusUI.groups.find((x) => x.label === '장부') || { items: [] }).items.map((i) => i.var);
    return ['funds', 'income', 'inc_stage', 'inc_ticket', 'inc_goods', 'inc_album',
      'salary', 'spend', 'balance', 'debt'].every((v2) => g.includes(v2));
  })(), '');
  ck('★ 프로덕션 탭이 유닛을 품는다 (유닛 탭이 따로 없다)', (() => {
    const g = S.statusUI.groups.find((x) => x.label === '프로덕션').items.map((i) => i.var);
    return ['center', 'u_rank', 'u_fan', 'u_cond', 'u_vo', 'songs', 'wardrobe'].every((v2) => g.includes(v2))
      && !S.statusUI.groups.some((x) => x.label === '유닛');
  })(), '');
  ck('시작은 수지 0이다', ledger(st).balance === 0 && ledger(st).spend === 0, JSON.stringify(ledger(st)));

  // 무대 보수는 수입으로 적힌다
  Object.assign(st.vars, { job: '케이블 음악방송', job_days: 0 },
    Object.fromEntries(['m1', 'm2', 'm3'].flatMap((m) => ['vo', 'da', 'vi'].map((k) => [`${m}_${k}`, 99]))));
  st = engine.toggleAction(S, st, 'perform').state;
  st = engine.sendPhase(S, st, { rng: seededRng('led', 1, 'a') }).state;
  const afterStage = ledger(st);
  ck('★ 무대 보수가 수입으로 적힌다', afterStage.income > 0 && afterStage.balance === afterStage.income,
    JSON.stringify(afterStage));

  // ★ 레슨비 — 편성표가 자금을 직접 쓰는데도 지출에 잡혀야 한다
  const up = applyUpgrade(S, st, 'm1_vo');
  ck('레슨을 찍을 수 있다 (검산 전제)', up.ok, up.reason || '');
  if (up.ok) Object.assign(st.vars, up.changes);
  const afterLesson = ledger(st);
  ck('★ 레슨비가 지출에 잡힌다 (효과로는 못 잡는 돈이다)',
    afterLesson.spend === afterStage.funds - afterLesson.funds,
    `지출 ${afterLesson.spend} vs 실제 ${afterStage.funds - afterLesson.funds}`);

  // 융자·상환은 벌거나 쓴 게 아니다 — 수지에서 빠져야 한다
  let fin = engine.initState(S); fin.meta.setupDone = true;
  fin.vars.funds = 100; fin.vars.month_open = 100;
  fin = engine.toggleAction(S, fin, 'borrow').state;
  fin = engine.sendPhase(S, fin, { rng: seededRng('led', 2, 'a') }).state;
  ck('★ 융자는 수입이 아니다 (수지가 안 움직인다)',
    fin.vars.funds > 100 && ledger(fin).balance === 0 && ledger(fin).spend === 0, JSON.stringify(ledger(fin)));
  fin = engine.toggleAction(S, fin, 'repay').state;
  fin = engine.sendPhase(S, fin, { rng: seededRng('led', 3, 'a') }).state;
  ck('★ 상환도 지출이 아니다 (빚이 줄었을 뿐이다)', ledger(fin).balance === 0, JSON.stringify(ledger(fin)));

  // 운영비는 잡힌다
  const beforeNight = ledger(fin).spend;
  fin = engine.toggleAction(S, fin, 'next_day').state;
  fin = engine.sendPhase(S, fin, { rng: seededRng('led', 4, 'a') }).state;
  ck('하루 운영비는 지출에 잡힌다', ledger(fin).spend > beforeNight, `${beforeNight} → ${ledger(fin).spend}`);

  // 월말이 장부를 닫는다 — 닫기가 이자보다 먼저여야 이자가 어느 달에도 안 빠지지 않는다
  const settle = S.rules.events.find((e) => e.id === 'settle');
  const order = settle.effects.map((f) => f.set);
  ck('★ 월말이 장부를 닫는다 (수입 갈래 넷 0 · 기초 잔고 갱신)',
    ['inc_stage', 'inc_ticket', 'inc_goods', 'inc_album', 'month_open'].every((k) => order.includes(k)),
    order.join(','));
  ck('★ 월급이 새 달 첫 지출로 나간다', settle.effects.some((f) => /salary/.test(f.expr || '')), order.join(','));
  ck('★ 장부를 닫고 나서 이자를 낸다 (이자가 사라지지 않는다)',
    order.indexOf('month_open') < order.lastIndexOf('funds'), order.join(','));
  ck('장부는 AI에게 안 연다', !S.updater.allow.some((a) => ['income', 'month_open', 'inc_stage',
    'inc_ticket', 'inc_goods', 'inc_album'].includes(a.id)), '');
  ck('프리셋이 자금을 바꾸면 기초 잔고도 같이 바꾼다 (첫 달 장부가 안 어긋난다)',
    S.setup.presets.every((p) => p.set.funds == null || p.set.month_open === p.set.funds),
    S.setup.presets.map((p) => `${p.id}:${p.set.funds}/${p.set.month_open}`).join(' '));
}

// ── 무대 판정이 정말 능력치와 컨디션을 본다 ──
{
  const roll = (vars) => {
    let st = engine.initState(S); st.meta.setupDone = true;
    Object.assign(st.vars, vars, { job: '케이블 음악방송', job_days: 0 });
    let win = 0;
    for (let i = 0; i < 60; i++) {
      let s2 = engine.initState(S); s2.meta.setupDone = true;
      Object.assign(s2.vars, vars, { job: '케이블 음악방송', job_days: 0 });
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

// ── v0.82 의뢰판: 자리를 고르는 판이 정말 굴러가는가 ──
//
// 여기서 재는 건 밸런스가 아니라 **규약**이다. 판정이 액션보다 먼저 굴러서 "어느 자리를
// 노렸는지"를 모른다는 엔진 순서 위에 이 판이 세워져 있으므로, 그 규약이 깨지면
// 영업은 굴러가는 것처럼 보이면서 아무 자리도 안 잡힌다 — 화면에는 아무 표시도 안 난다.
const init = () => { const st = engine.initState(S); st.meta.setupDone = true; return st; };
const E = (e, vars) => expr.evaluate(e, engine.makeLookup(S, { ...engine.initState(S).vars, ...vars }));

{
  const TIERS = [
    ['take_radio', 'ck_radio', 'od_radio', '지역 라디오', '잡지 화보'],
    ['take_mag', 'ck_mag', 'od_mag', '잡지 화보', '지방 방송국'],
    ['take_ltv', 'ck_ltv', 'od_ltv', '지방 방송국', '케이블 음악방송'],
    ['take_cable', 'ck_cable', 'od_cable', '케이블 음악방송', '지상파 음악방송'],
    ['take_net', 'ck_net', 'od_net', '지상파 음악방송', '골든타임 특집'],
    ['take_gold', 'ck_gold', 'od_gold', '골든타임 특집', '골든타임 특집'],
  ];
  ck('★ 자리마다 버튼·판정·성사율이 한 벌씩 있다',
    TIERS.every(([a, c, o]) => A(a) && S.checks.find((x) => x.id === c) && S.derived.find((d) => d.id === o)), '');
  ck('★ 자리마다 판정이 따로다 (판정이 액션보다 먼저 굴러 vs를 못 고른다)',
    new Set(TIERS.map(([a]) => A(a).check)).size === TIERS.length, '');

  // 판정 → pitch_won → 액션이 자리를 넣는다. 셋 중 하나만 어긋나도 영업이 조용히 죽는다
  const jobOf = (id, won) => E(A(id).effects.find((f) => f.set === 'job').expr, { job: '없음', pitch_won: won });
  ck('★ 헛걸음(0)이면 자리가 안 잡힌다', TIERS.every(([id]) => jobOf(id, 0) === '없음'), '');
  ck('★ 수주(1)면 노린 자리가 잡힌다',
    TIERS.every(([id, , , mine]) => jobOf(id, 1) === mine), TIERS.map(([id]) => jobOf(id, 1)).join(','));
  ck('★ 대어(2)면 한 칸 위를 물고 온다 (꼭대기는 자기 자리)',
    TIERS.every(([id, , , , up]) => jobOf(id, 2) === up), TIERS.map(([id]) => jobOf(id, 2)).join(','));
  ck('★ 판정이 남기는 건 pitch_won뿐이다 (자리 이름은 액션만 안다)',
    TIERS.every(([, c]) => S.checks.find((x) => x.id === c).grades
      .every((g) => (g.effects || []).some((f) => f.set === 'pitch_won')
        && !(g.effects || []).some((f) => f.set === 'job'))), '');
  ck('★ 헛걸음이어도 영업비는 나간다 (성사율을 볼 이유가 여기 있다)',
    TIERS.every(([id]) => {
      const f = A(id).effects.find((x) => x.set === 'funds');
      return f && /funds - \d+/.test(f.expr);
    }), '');

  // 성사율 — 어려운 자리일수록 낮고, 이름값이 오르면 다 같이 오른다
  const odds = (id, vars) => D(id, { ...engine.initState(S).vars, ...vars });
  const at = (vars) => TIERS.map(([, , o]) => odds(o, vars));
  const low = at({ awareness: 12, buzz: 20 });
  ck('★ 어려운 자리일수록 성사율이 낮다', low.every((x, i) => i === 0 || x <= low[i - 1]), low.join('/'));
  const high = at({ awareness: 90, buzz: 90, rank: 'S' });
  ck('★ 이름값이 오르면 성사율이 오른다', high.every((x, i) => x >= low[i]), `${low.join('/')} → ${high.join('/')}`);
  ck('성사율은 5~100 사이다 (대성공이 있으니 0은 없다)',
    [...low, ...high].every((x) => x >= 5 && x <= 100), [...low, ...high].join('/'));
  ck('성사율 여섯이 pitch_mod 한 줄을 공유한다 (고칠 데가 하나다)',
    TIERS.every(([, , o]) => /pitch_mod/.test(S.derived.find((d) => d.id === o).expr))
    && TIERS.every(([, c]) => S.checks.find((x) => x.id === c).mod === 'pitch_mod'), '');
}

// ── 대관: 잡는 것과 채우는 것은 다른 질문이다 ──
{
  const HALLS = ['hall_small', 'hall_civic', 'hall_fest', 'hall_solo', 'hall_tour'];
  ck('★ 공연장은 판정 없이 빌린다 (돈만 있으면 잡힌다)', HALLS.every((id) => !A(id).check), '');
  ck('★ 대관료가 선불이다', HALLS.every((id) => A(id).effects.some((f) => f.set === 'funds' && /funds - \d+/.test(f.expr))), '');
  const fee = HALLS.map((id) => Number(/funds - (\d+)/.exec(A(id).effects.find((f) => f.set === 'funds').expr)[1]));
  ck('★ 큰 자리일수록 대관료가 비싸다', fee.every((x, i) => i === 0 || x > fee[i - 1]), fee.join('<'));
  ck('★ 팬이 있어야 큰 데를 빌려준다 (유저가 말한 "잡을 수 있을지")',
    HALLS.slice(1).every((id) => /fans >= \d+/.test(A(id).when)), '');
  // 정원이 천장 — 팬이 아무리 많아도 작은 데서는 그만큼만 팔린다
  const many = { fans: 900000, buzz: 100, live: '라이브하우스' };
  ck('★ 정원이 천장이다 (팬이 많아도 작은 데선 그만큼만)',
    D('live_tickets', { ...engine.initState(S).vars, ...many }) === D('live_cap', { ...engine.initState(S).vars, ...many }), '');
  // 반대로 무리하면 빈 객석 — 예상 객석이 그 경고다
  const thin = { fans: 800, buzz: 0, live: '전국 투어', m1_fan: 0, m2_fan: 0, m3_fan: 0 };
  ck('★ 무리해서 빌리면 예상 객석이 바닥이다 (빈 객석 경고)',
    D('live_fill', { ...engine.initState(S).vars, ...thin }) < 20,
    `${D('live_fill', { ...engine.initState(S).vars, ...thin })}%`);
  ck('라이브가 없으면 예상 객석은 0이다 (0으로 나누지 않는다)',
    D('live_fill', { ...engine.initState(S).vars, live: '없음' }) === 0, '');
  const lives = V('live').enum.filter((x) => x !== '없음');
  const lvs = S.derived.find((d) => d.id === 'live_vs').expr;
  const lpay = S.derived.find((d) => d.id === 'live_pay').expr;
  const lcap = S.derived.find((d) => d.id === 'live_cap').expr;
  ck('★ 라이브표가 세 줄(난이도·개런티·정원)에 다 모여 있다',
    lives.every((l) => lvs.includes(l) && lpay.includes(l) && lcap.includes(l)), lives.join(','));
}

// ── 제작 의뢰: 돈만으로는 안 된다 ──
{
  const DRESS = ['make_dress1', 'make_dress2', 'make_dress3'];
  const DISC = ['make_single', 'make_mini', 'make_full'];
  const costOf = (id) => Number(/funds - (\d+)/.exec(A(id).effects.find((f) => f.set === 'funds').expr)[1]);
  const needOf = (id) => { const m = /awareness >= (\d+)/.exec(A(id).when); return m ? Number(m[1]) : 0; };
  for (const [name, ids] of [['의상', DRESS], ['음반', DISC]]) {
    ck(`★ ${name} 등급이 오를수록 비싸다`, ids.map(costOf).every((x, i) => i === 0 || x > ids.map(costOf)[i - 1]),
      ids.map(costOf).join('<'));
    ck(`★ ${name} 등급이 오를수록 이름값을 요구한다 (돈만으로는 안 된다)`,
      ids.map(needOf).every((x, i) => i === 0 || x > ids.map(needOf)[i - 1]), ids.map(needOf).join('<'));
  }
  ck('★ 음반은 한 단계씩만 올라간다 (정규부터 낼 수 없다)',
    /album == '없음'/.test(A('make_single').when) && /album == '싱글'/.test(A('make_mini').when)
    && /album == '미니 앨범'/.test(A('make_full').when), '');
  ck('의상은 이미 좋은 걸 입고 있으면 안 열린다 (내려가는 버튼이 아니다)',
    DRESS.every((id) => /costume != '특주 의상'/.test(A(id).when)), '');
  ck('★ 좋은 옷일수록 무대가 유리하다', D('dress', { ...engine.initState(S).vars, costume: '특주 의상' })
    > D('dress', { ...engine.initState(S).vars, costume: '기본 무대의상' }), '');
}

// ── 유닛 랭크가 합계 눈금인가 ──
// ⚠ 실측 사고: 문턱을 한 사람 기준(260/200/150)으로 잡아 두는 바람에 **시작하자마자 S등급**이
//   떴다. u_pow는 셋을 자리 배수로 더한 값이라 만점이 990이다. 랭크가 첫 턴에 천장이면
//   성장이 화면에 안 보이고, u_pow를 문턱으로 쓰는 대관도 첫날에 전부 열린다.
{
  const base = engine.initState(S).vars;
  const MAX = Math.round((1.3 + 2) * 100 * 3);
  const full = Object.fromEntries(['m1', 'm2', 'm3'].flatMap((m) => ['vo', 'da', 'vi'].map((k) => [`${m}_${k}`, 100])));
  ck('★ 시작 유닛은 천장이 아니다 (랭크가 성장할 자리가 있다)',
    D('u_rank', base) !== 'S', `${D('u_pow', base)}/${MAX} → ${D('u_rank', base)}`);
  ck('★ 전원 만점이면 S등급이다 (사다리 꼭대기가 닿는다)',
    D('u_rank', { ...base, ...full }) === 'S', `${D('u_pow', { ...base, ...full })} → ${D('u_rank', { ...base, ...full })}`);
  ck('★ 랭크가 합계 눈금이다 (만점 대비 비율)', D('u_pow', { ...base, ...full }) === MAX, String(MAX));
  // 대관의 u_pow 문턱도 같은 자여야 한다 — 아니면 시작하자마자 큰 공연장이 열린다
  const powGate = (id) => Number(/u_pow >= (\d+)/.exec(A(id).when)[1]);
  ck('★ 대관 문턱도 같은 눈금이다 (시작 유닛으로는 안 열린다)',
    ['hall_fest', 'hall_solo', 'hall_tour'].every((id) => powGate(id) > D('u_pow', base)),
    `${D('u_pow', base)} vs ${['hall_fest', 'hall_solo', 'hall_tour'].map(powGate).join('/')}`);
}

// ── 인세: 손을 놓아도 도는 유일한 돈 (그리고 유령 지출이 아닌가) ──
{
  const settle = S.rules.events.find((e) => e.id === 'settle');
  const idx = settle.effects.map((f) => f.set);
  ck('★ 인세는 장부를 닫은 뒤에 들어온다 (새 달 수입이다)',
    idx.lastIndexOf('inc_album') > idx.indexOf('month_open'), idx.join(','));
  // ⚠ v0.81에서 실제로 밟은 버그 — 장부에만 적고 자금에 안 넣으면 지출로 둔갑한다
  const albumWrites = settle.effects.filter((f) => /album_n/.test(f.expr || ''));
  ck('★ 인세가 장부와 자금을 같이 올린다 (유령 지출 방지)',
    albumWrites.length === 2 && albumWrites.some((f) => f.set === 'inc_album') && albumWrites.some((f) => f.set === 'funds'),
    albumWrites.map((f) => f.set).join(','));
  ck('음반이 없으면 인세도 0이다', D('album_n', { ...engine.initState(S).vars, album: '없음' }) === 0, '');
  ck('★ 큰 음반일수록 인세가 크다',
    D('album_n', { ...engine.initState(S).vars, album: '정규 앨범' }) > D('album_n', { ...engine.initState(S).vars, album: '싱글' }), '');
}

// ── 음지: 오늘의 돈과 내일의 이름을 바꾸는 자리 ──
{
  const SHADE = [['shady_night', 'ck_night', 'od_night'], ['shady_spon', 'ck_spon', 'od_spon'],
    ['shady_gravure', 'ck_gravure', 'od_gravure'], ['shady_adult', 'ck_adult', 'od_adult']];
  ck('★ 음지도 자리마다 설득 판정이 있다', SHADE.every(([a, c]) => A(a) && A(a).check === c), '');
  ck('★ 거절하면 돈이 안 들어온다 (물어본 것만 남는다)',
    SHADE.every(([id]) => A(id).effects.filter((f) => /shady_ok/.test(f.expr || '')).length === A(id).effects.length)
    && SHADE.every(([id]) => E(A(id).effects.find((f) => f.set === 'funds').expr, { funds: 0, shady_ok: 0 }) === 0), '');
  ck('★ 수락하면 크게 들어온다',
    SHADE.every(([id]) => E(A(id).effects.find((f) => f.set === 'funds').expr, { funds: 0, shady_ok: 1 }) > 0), '');
  ck('★ 거절도 값을 치른다 (호감이 깎인다)',
    SHADE.every(([, c]) => /m1_love/.test(JSON.stringify(S.checks.find((x) => x.id === c).grades.at(-1)))), '');
  // 유저가 말한 "타락도에 따라 거절할 확률이 낮아져 점차 해금된다"
  const acc = (v) => SHADE.map(([, , o]) => D(o, { ...engine.initState(S).vars, corrupt: v, funds: 1000 }));
  ck('★ 타락도가 오르면 수락률이 오른다 (담근 만큼 다음이 쉬워진다)',
    acc(80).every((x, i) => x > acc(0)[i]), `${acc(0).join('/')} → ${acc(80).join('/')}`);
  ck('★ 문턱도 타락도가 연다 (처음부터 끝까지 갈 수는 없다)',
    SHADE.slice(1).map(([id]) => Number(/corrupt >= (\d+)/.exec(A(id).when)[1]))
      .every((x, i, a2) => i === 0 || x > a2[i - 1]), '');
  ck('★ 급하면 설득이 쉬워진다 (돈이 마르면 셋도 안다)',
    D('shady_mod', { ...engine.initState(S).vars, funds: 50 }) > D('shady_mod', { ...engine.initState(S).vars, funds: 5000 }), '');
  // 갈림길 — 음지로 가면 양지의 큰 자리가 닫힌다. 이게 없으면 그냥 "돈 더 주는 버튼"이다
  ck('★ 타락도가 지상파와 골든타임을 닫는다 (갈림길이 성립한다)',
    /corrupt <= 45/.test(A('take_net').when) && /corrupt <= 25/.test(A('take_gold').when), '');
  ck('타락은 달이 바뀌면 조금 잊힌다 (되돌아올 길이 있다)',
    S.rules.events.find((e) => e.id === 'settle').effects.some((f) => f.set === 'corrupt' && /corrupt - \d+/.test(f.expr)), '');
  ck('음지에도 청구서가 있다 (타락이 높으면 폭로가 돈다)',
    !!S.rules.randomEvents.table.find((e) => e.id === 'leak' && /corrupt >= \d+/.test(e.when)), '');
  ck('음지 액션은 함정 지적에서 면제 (손해인 줄 알고 누르는 자리다)',
    SHADE.every(([id]) => A(id).impactExempt === true), '');
  ck('타락도는 AI에게 안 연다 (시스템이 정한다)', !S.updater.allow.some((a) => a.id === 'corrupt'), '');
}

// ── 패널: 못 여는 자리도 잠긴 채로 보인다 ──
{
  const tabs = partyTabs(S);
  const byId = Object.fromEntries(tabs.map((t) => [t.id, t]));
  ck('★ 의뢰판이 편성표에 있다 (일감 · 무대 · 제작 · 음지)',
    ['jobs', 'halls', 'make', 'shade'].every((id) => byId[id]), tabs.map((t) => t.id).join(','));
  ck('★ 일감 탭에 사다리 아홉이 다 늘어서 있다 (잠긴 것도 보여야 다음 목표가 된다 — v0.86 백화점·축제 포함)',
    byId.jobs.actions.length === 9, String(byId.jobs.actions.length));
  ck('★ 음지 탭은 조건이 걸려 있다 (형편이 멀쩡하면 보이지도 않는다)',
    /funds < \d+ or corrupt >= 1/.test(byId.shade.when || ''), String(byId.shade.when));
  // 상태창 — 성사율은 일감이 비었을 때만 본다
  const jobPane = S.statusUI.groups.find((g) => g.label === '일감');
  const oddRows = jobPane.items.filter((it) => /^od_/.test(it.var));
  ck('★ 성사율이 일감 탭에 뜬다', oddRows.length === 6, String(oddRows.length));
  ck('★ 일감을 이미 잡았으면 성사율은 접힌다 (지금 중요한 게 가려지지 않게)',
    oddRows.every((it) => /job == '없음'/.test(it.showWhen || '')), '');
  ck('★ 성사율 표시 조건이 버튼 조건과 짝이다 (안 열리는 자리의 확률을 보여주지 않는다)',
    [['od_ltv', 'take_ltv'], ['od_cable', 'take_cable'], ['od_net', 'take_net'], ['od_gold', 'take_gold']]
      .every(([o, a]) => {
        const need = /awareness >= (\d+)/.exec(jobPane.items.find((it) => it.var === o).showWhen)[1];
        return need === /awareness >= (\d+)/.exec(A(a).when)[1];
      }), '');
  const shadePane = S.statusUI.groups.find((g) => g.label === '음지');
  ck('★ 음지 탭도 발을 담근 뒤에만 뜬다', /corrupt >= 1/.test(shadePane.showWhen || ''), String(shadePane.showWhen));
}

// ── 비너스 배틀 (v0.84) — 순위 결전: 위로 갈수록 상대가 세고, 정산은 이긴 상대 기준 ──
{
  const CK = S.checks.find((c) => c.id === 'ck_venus');
  const base = engine.initState(S).vars;
  const EV = (e, vars) => expr.evaluate(e, engine.makeLookup(S, { ...base, ...vars }));
  ck('★ 배틀 판정과 버튼이 짝지어져 있다', !!CK && A('venus_battle').check === 'ck_venus', '');
  const vs = (rk) => D('v_vs', { ...base, v_rank: rk });
  ck('★ 위로 갈수록 상대가 세진다 (순위표가 곧 대진표)',
    vs(0) < vs(100) && vs(100) < vs(50) && vs(50) < vs(20) && vs(20) < vs(1),
    [0, 100, 50, 20, 1].map((r) => vs(r)).join('/'));
  ck('★ 판정 mod와 승률 표시가 같은 줄(v_mod)을 읽는다 (화면의 숫자와 굴린 숫자가 같다)',
    CK.mod === 'v_mod' && /v_mod/.test(S.derived.find((d) => d.id === 'v_odds').expr), '');
  ck('배틀 승률은 5~100 사이다',
    [0, 1, 50].every((rk) => { const o = D('v_odds', { ...base, v_rank: rk }); return o >= 5 && o <= 100; }), '');
  // 정산 순서 — v_prize는 지금 순위를 읽으므로, 순위 이동이 상금보다 먼저면 다음 상대 기준이 된다
  const winG = CK.grades.find((g) => g.label === '승리');
  const order = winG.effects.map((f) => f.set);
  ck('★ 상금·팬이 순위 이동보다 먼저다 (이긴 상대 기준으로 정산된다)',
    order.indexOf('funds') < order.indexOf('v_rank') && order.indexOf('fans') < order.indexOf('v_rank'),
    order.join(','));
  ck('★ 상금은 장부와 자금에 같이 적힌다 (유령 지출 방지)',
    winG.effects.some((f) => f.set === 'inc_stage') && winG.effects.some((f) => f.set === 'funds'), '');
  const move = (g, rk) =>
    EV(CK.grades.find((x) => x.label === g).effects.find((f) => f.set === 'v_rank').expr, { v_rank: rk });
  ck('★ 데뷔전을 이기면 순위권에 든다', move('승리', 0) > 0 && move('압승', 0) > 0, '');
  ck('★ 이기면 오르고 지면 내려간다 (1위 위로는 없다)',
    move('승리', 50) < 50 && move('패배', 50) > 50 && move('승리', 1) === 1, '');
  ck('순위권 밖에서 지면 그대로 밖이다', move('패배', 0) === 0 && move('참패', 0) === 0, '');
  ck('바닥은 100위다 (한 번 들면 순위권 밖으로 안 밀려난다)', move('참패', 95) <= 100, String(move('참패', 95)));
  const crown = S.rules.events.find((e) => e.id === 'venus_crown');
  ck('★ 정점 이벤트는 판을 끝내지 않는 승리다',
    !!crown && !crown.effects.some((f) => f.set === 'unit_over'), '');
  const jobPane = S.statusUI.groups.find((g) => g.label === '일감');
  const gate = /fans >= (\d+)/.exec(A('venus_battle').when)[1];
  ck('★ 배틀 승률·상금 표시 문턱이 버튼 조건과 짝이다',
    ['v_stage', 'v_odds', 'v_prize'].every((v) =>
      (jobPane.items.find((it) => it.var === v).showWhen || '').includes(`fans >= ${gate}`)), '');
  ck('비너스 순위가 프롬프트에 실린다', /\{v_disp\}/.test(S.promptState.template), '');
  ck('순위는 AI에게 안 연다 (배틀 판정만 움직인다)', !S.updater.allow.some((a) => a.id === 'v_rank'), '');
}

// ── 난이도 (v0.85) — 보통이 기준이고, 사다리는 네 축(이자·팬·영업·시설)을 함께 민다 ──
{
  const base = engine.initState(S).vars;
  const H = ['쉬움', '보통', '어려움', '리얼리티'];
  const at = (h) => ({ ...base, hard: h });
  ck('★ 난이도 수치는 0~3 사다리다', H.map((h) => D('hard_n', at(h))).join(',') === '0,1,2,3',
    H.map((h) => D('hard_n', at(h))).join(','));
  ck('★ 보통이 기준값이다 (팬 배율 1.0 — 기존 세이브가 안 흔들린다)', D('fan_mul', at('보통')) === 1, '');
  ck('★ 난이도가 오르면 팬이 덜 는다', H.map((h) => D('fan_mul', at(h))).every((v, i, a2) => i === 0 || v < a2[i - 1]), '');
  ck('★ 난이도가 오르면 영업이 어려워진다',
    H.map((h) => D('pitch_mod', at(h))).every((v, i, a2) => i === 0 || v < a2[i - 1]), '');
  const ev = S.rules.events.find((e) => e.id === 'settle');
  const interest = (h) => {
    const f = ev.effects.filter((x) => x.set === 'funds').find((x) => /hard_n \* 2/.test(x.expr));
    return expr.evaluate(f.expr, engine.makeLookup(S, { ...at(h), debt: 1000, funds: 1000 }));
  };
  ck('★ 이자율도 난이도 사다리다 (쉬움 3% ~ 리얼리티 9%, 보통 5% = 예전 값)',
    interest('쉬움') === 970 && interest('보통') === 950 && interest('리얼리티') === 910,
    H.map((h) => 1000 - interest(h)).join(','));
}

// ── 관리 시설 (v0.85) — 돈으로 사는 회복, 위 시설은 이름값이 연다 ──
{
  const base = engine.initState(S).vars;
  const FAC = [['meal', 'meal_cost', 0], ['massage', 'mass_cost', 32], ['spa', 'spa_cost', 46], ['resort', 'resort_cost', 76]];
  ck('★ 시설 넷이 관리 탭에 있다', (() => {
    const care = partyTabs(S).find((t) => t.id === 'care');
    return !!care && FAC.every(([id]) => care.actions.includes(id)) && care.actions.includes('rest_day');
  })(), '');
  ck('★ 조건과 지출이 같은 비용 파생을 읽는다 (열리는 값 = 나가는 값)',
    FAC.every(([id, cost]) => A(id).when.includes(`funds >= ${cost}`)
      && A(id).effects.some((f) => f.set === 'funds' && f.expr.includes(cost))), '');
  ck('★ 위 시설일수록 이름값이 필요하다 (눈금은 등급 이벤트와 같다: 32=D · 46=C · 76=A)',
    FAC.slice(1).every(([id, , aw]) => A(id).when.includes(`awareness >= ${aw}`)), '');
  ck('★ 비용은 난이도가 올린다 (보통 1.0배 기준)',
    FAC.every(([, cost]) => D(cost, { ...base, hard: '리얼리티' }) > D(cost, { ...base, hard: '보통' })
      && D(cost, { ...base, hard: '쉬움' }) < D(cost, { ...base, hard: '보통' })), '');
  ck('시설은 몸이나 마음을 돌려준다',
    FAC.every(([id]) => A(id).effects.some((f) => /^m1_(st|me)$/.test(f.set))), '');
  const carePane = S.statusUI.groups.find((g) => g.label === '관리');
  ck('★ 비용표 표시 문턱이 버튼 조건과 짝이다',
    !!carePane && FAC.slice(1).every(([id, cost, aw]) =>
      (carePane.items.find((it) => it.var === cost).showWhen || '').includes(`awareness >= ${aw}`)), '');
}

// ── 빚 독촉 (v0.85) — 못 갚는 빚이 음지로 미는 문 ──
{
  const col = S.rules.randomEvents.table.find((e) => e.id === 'collector');
  ck('★ 독촉 이벤트가 있다', !!col, '');
  ck('★ 문턱은 난이도가 내린다 (어려운 판일수록 일찍 온다)', /3600 - hard_n \* 600/.test(col.when), col.when);
  ck('★ 소개받은 일이 타락도를 올린다 (음지 탭이 열리는 문)',
    col.choices[0].effects.some((f) => f.set === 'corrupt' && /\+ 8/.test(f.expr)), '');
  ck('갈림길 규약 — 마지막 선택지는 조건이 없다 (타임아웃 자동 결정)', !col.choices.at(-1).when, '');
  ck('버티는 것도 값을 치른다 (공짜 선택지 금지)',
    col.choices.at(-1).effects.some((f) => f.set === 'debt' || /^m1_me$/.test(f.set)), '');
}

report();

function report() {
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
}
