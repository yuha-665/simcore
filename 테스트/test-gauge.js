const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.14.0 사건 게이지 (core/gauge.js) — 보이지 않는 게이지가 작중 시간으로 차고, 100이면 랜덤 사건 하나가 터진 뒤 0으로.
// 유저 제안(2026-09-27): "정해진 턴수로 하지 말고 보이지 않는 게이지 형태로 — 서사나 확률적으로 차고 100이면 발동, 0으로 초기화 + 쿨다운".
// 배경: 옛 방식(chancePerTurn)은 턴마다 굴려 채팅 속도가 빈도를 정했다 (베리디아 보통: 하루 세 턴이면 한 해 나쁜 일 26번, 한 턴이면 10번).
//
// 약속:
//  ① 채팅 속도와 무관 — 하루 한 턴이든 세 턴이든 같은 작중 날에 터진다. 날이 안 가는 턴엔 안 찬다(perTurn 0).
//  ② 식힘 — 터진 뒤 cooldown일 동안 안 찬다. 한 턴이 식힘을 넘기면 남은 날은 찬다.
//  ③ 막힘 — 후보가 없으면 안 찬다 (막힌 사이 채워 두었다가 풀리자마자 터뜨리지 않는다).
//  ④ 항목 쿨다운은 날 단위 (시간 체계가 있을 때).
//  ⑤ 서사 개입 { gauge: N } — 당기고 늦춘다. 터진 사건의 여진은 비운 뒤 얹힌다.
//  ⑥ 보이지 않는다 — 변화 원장·보조 원장·상태창·메인 프롬프트에 없다. 조건식은 읽는다(전조 지시문).
//  ⑦ 옛 방식 그대로 — gauge가 없으면 예약 키도 없고, 턴 쿨다운·턴 굴림이다.
//  ⑧ 되감기·세이브 호환·시간 없는 봇·검증·편집기.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const cp = (o) => JSON.parse(JSON.stringify(o));

// 편집기 렌더용 가짜 DOM — test-editortabs.js의 것을 그대로 빌려 쓴다 (h()가 쓰는 만큼만)
const tabsSrc = fs.readFileSync(__P('test-editortabs.js'), 'utf8');
const makeDom = (0, eval)('(' + tabsSrc.slice(tabsSrc.indexOf('function makeDom()'), tabsSrc.indexOf('// 트리 안에서')) + ')');
global.document = makeDom();
global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (f) => f(), setTimeout, clearTimeout };
global.navigator = { clipboard: { writeText: async () => {} } };

(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const render = SC.require('render');
const gaugeMod = SC.require('gauge');
const { validateSchema } = SC.require('validate');
const { seededRng } = SC.require('rng');

const OMEN = '공기가 무겁다 — 무슨 일이 곧 터질 것 같다.';
const BASE = {
  simcore: '0.1', meta: { name: '사건 게이지 실험대' },
  time: { start: '2026-04-01 08:00', advance: 'explicit', expose: ['date', 'elapsed'] },
  vars: [
    { id: 'gold', label: '금', type: 'int', init: 0, min: 0 },
    { id: 'calm', label: '잠잠함', type: 'bool', init: true },
    { id: 'skip_day', label: '일 진행', type: 'int', init: 0, min: 0 },
  ],
  updater: { allow: [{ id: 'calm' }, { id: 'skip_day', maxDelta: 3650 }] },
  rules: {
    randomEvents: {
      gauge: { perDay: 10, jitter: 0, cooldown: 3 },
      table: [
        { id: 'rain', weight: 1, when: 'calm', effects: [{ set: 'gold', expr: 'gold + 1' }], notify: '비가 왔다.' },
        { id: 'wind', weight: 1, when: 'calm', notify: '바람이 불었다.' },
      ],
    },
  },
  actions: [{ id: 'provoke', label: '🔥 도발', mode: 'oneshot', effects: [{ gauge: '60' }] },
    { id: 'soothe', label: '🕊 달램', mode: 'oneshot', effects: [{ gauge: '-500' }] }],
  directives: [{ id: 'omen', when: 're_gauge >= 80', text: OMEN }],
  statusUI: { mode: 'auto', changeLog: 'open', groups: [{ label: '상태', items: [{ var: 'gold' }] }] },
  promptState: { template: '지금: {date} · 금 {gold}' },
};

const fresh = (S) => { const st = engine.initState(S); st.meta.setupDone = true; return st; };
// 한 턴 — 날 수(skip)와 보조 변경(ch)을 싣는다. rng는 턴마다 다른 시드
const turn = (S, st, skip, k, ch = {}, tag = 't') => {
  const s = engine.sendPhase(S, st, { rng: seededRng(tag, k, 's') });
  const o = engine.outputPhase(S, s.state, { skip_day: skip, ...ch }, {}, { rng: seededRng(tag, k, 'o') });
  return { s, o, st: o.state };
};
const day = (S, st) => engine.makeLookup(S, st.vars)('elapsed');
// 한 해를 굴려 터진 날을 모은다 — skipOf(i)가 i번째 턴의 날 수
const fireDays = (S, turns, skipOf, tag = 'r', st0 = null) => {
  let st = st0 || fresh(S); const out = [];
  for (let i = 0; i < turns; i++) {
    const t = turn(S, st, skipOf(i), i, {}, tag); st = t.st;
    for (const id of t.o.firedEvents) out.push(`${day(S, st)}:${id}`);
  }
  return { st, out, days: out.map((x) => Number(x.split(':')[0])) };
};

// ── ⑦ 옵트인 ──
{
  const S = cp(BASE); delete S.rules.randomEvents.gauge; S.rules.randomEvents.chancePerTurn = 0; S.directives = []; S.actions = [];
  const st = fresh(S);
  ck('⑦ 옵트인: gauge 없으면 예약 키 없음', !('re_gauge' in st.vars) && !('re_cool' in st.vars), JSON.stringify(Object.keys(st.vars)));
  ck('⑦ 옵트인: 검증 오류 0', validateSchema(S).ok, JSON.stringify(validateSchema(S).errors));
}

// ── 검증 ──
{
  const v = validateSchema(cp(BASE));
  ck('기본 스키마 오류 0 (chancePerTurn 없어도 게이지면 된다)', v.ok, JSON.stringify(v.errors));
  ck('기본 스키마 게이지 경고 0', !v.warnings.some((w) => /gauge|게이지/.test(w.path + w.msg)), JSON.stringify(v.warnings));
  const bad = (mut, re, name) => { const S = cp(BASE); mut(S); const r = validateSchema(S); ck(name, r.errors.some((e) => re.test(e.path + ' ' + e.msg)), JSON.stringify(r.errors)); };
  const warned = (mut, re, name) => { const S = cp(BASE); mut(S); const r = validateSchema(S); ck(name, r.warnings.some((w) => re.test(w.path + ' ' + w.msg)), JSON.stringify(r.warnings)); };
  bad((S) => { S.vars.push({ id: 're_gauge', type: 'int', init: 0 }); }, /예약 이름/, '검증: re_gauge 이름 충돌');
  bad((S) => { S.derived = [{ id: 're_cool', expr: '1' }]; }, /예약 이름/, '검증: re_cool 파생 충돌');
  bad((S) => { S.rules.randomEvents.gauge.jitter = 2; }, /jitter/, '검증: jitter 0~1');
  bad((S) => { S.rules.randomEvents.gauge.cooldown = -1; }, /cooldown/, '검증: cooldown 음수');
  bad((S) => { S.rules.randomEvents.gauge.perDay = -3; }, /perDay/, '검증: perDay 음수');
  bad((S) => { S.rules.randomEvents.gauge.perDay = 'nope + 1'; }, /perDay|nope/, '검증: perDay 식의 모르는 변수');
  bad((S) => { S.rules.randomEvents.gauge = [1]; }, /gauge는 객체/, '검증: gauge 배열');
  bad((S) => { delete S.rules.randomEvents.gauge; }, /gauge|chancePerTurn/, '검증: gauge 끄면 chancePerTurn 필요');
  bad((S) => { S.actions[0].effects = [{ gauge: '10', set: 'gold' }]; }, /같이 쓸 수 없음/, '검증: gauge 효과 + set 혼용');
  bad((S) => { S.actions[0].effects = [{ gauge: '' }]; }, /더할 양/, '검증: gauge 효과 양 비었음');
  bad((S) => { const g = S.rules.randomEvents.gauge; delete S.rules.randomEvents.gauge; S.rules.randomEvents.chancePerTurn = 0.1; void g; },
    /gauge 효과를 쓰려면/, '검증: 게이지 없이 gauge 효과');
  warned((S) => { S.rules.randomEvents.gauge.perDay = 0; }, /영영 안 찹니다/, '검증 경고: 속도 0');
  warned((S) => { S.rules.randomEvents.chancePerTurn = 0.2; }, /chancePerTurn은 안 쓰입니다/, '검증 경고: chancePerTurn 같이 둠');
  warned((S) => { delete S.time; S.vars = S.vars.filter((x) => x.id !== 'skip_day'); S.updater.allow = [{ id: 'calm' }]; S.directives = []; },
    /한 턴 = 하루/, '검증 경고: 시간 없는 봇의 perDay');
  const ok = cp(BASE); ok.directives[0].when = 're_gauge >= 80 and re_cool <= 0';
  ck('검증: 조건식이 re_gauge·re_cool을 읽는다', validateSchema(ok).ok, JSON.stringify(validateSchema(ok).errors));
}

// ── ① 채팅 속도와 무관 ──
{
  const S = cp(BASE);
  const a = fireDays(S, 60, () => 1, 'p1');
  const b = fireDays(S, 180, (i) => (i % 3 === 2 ? 1 : 0), 'p3');
  ck('① 하루 한 턴: 10일째 첫 사건, 이후 13일마다 (10 + 식힘 3)', JSON.stringify(a.days) === JSON.stringify([10, 23, 36, 49]), a.out.join(' '));
  ck('① ★ 하루 세 턴도 같은 날에 터진다', JSON.stringify(b.days) === JSON.stringify(a.days), `${a.days} vs ${b.days}`);
  const still = fireDays(S, 200, () => 0, 'p0');
  ck('① 날이 안 가면 안 찬다 (대화만 200턴 → 0번, 게이지 0)', still.out.length === 0 && still.st.vars.re_gauge === 0, `${still.out.length} · ${still.st.vars.re_gauge}`);
  const S2 = cp(BASE); S2.rules.randomEvents.gauge.perTurn = 1;
  const t2 = fireDays(S2, 150, () => 0, 'pt');
  ck('① perTurn을 주면 대화 턴에도 조금씩 (1이면 100턴에 한 번)', JSON.stringify(t2.out.map((x) => x.split(':')[1]).length) === '1', t2.out.join(' '));
  const S3 = cp(BASE); S3.rules.randomEvents.gauge.perDay = 'gold >= 1 ? 20 : 10';
  const t3 = fireDays(S3, 40, () => 1, 'px');
  const firstRain = t3.out.findIndex((x) => x.endsWith(':rain'));
  const gaps = t3.days.slice(1).map((d, i) => d - t3.days[i]);
  ck('① 속도가 식이면 지금 상태가 민다 (금이 생기기 전 13일 간격 → 생긴 뒤 8일)', firstRain >= 0 && gaps.every((g, i) => g === (i < firstRain ? 13 : 8)),
    `${t3.out.join(' ')} · 간격 ${gaps}`);
}

// ── ② 식힘 ──
{
  const S = cp(BASE);
  const five = fireDays(S, 12, () => 5, 'c5');
  ck('② 닷새 턴: 식힘 사흘 뒤 남은 이틀은 찬다 (10 → 25 → 40)', JSON.stringify(five.days.slice(0, 3)) === JSON.stringify([10, 25, 40]), five.out.join(' '));
  let st = fresh(S); st.vars.re_gauge = 95; st.vars.re_cool = 2;
  const t = turn(S, st, 1, 1).st;
  ck('② 식힘 중엔 100을 넘길 만큼 있어도 안 터지고 안 찬다', t.vars.re_gauge === 95 && t.vars.re_cool === 1, `${t.vars.re_gauge} · ${t.vars.re_cool}`);
  const S0 = cp(BASE); delete S0.rules.randomEvents.gauge.cooldown;
  const nc = fireDays(S0, 40, () => 1, 'nc');
  ck('② cooldown 없으면 10일마다', JSON.stringify(nc.days) === JSON.stringify([10, 20, 30, 40]), nc.out.join(' '));
}

// ── ③ 막힘 ──
{
  const S = cp(BASE);
  let st = fresh(S); const log = [];
  for (let i = 0; i < 40; i++) {
    const d = i + 1;
    const ch = d === 5 ? { calm: false } : (d === 31 ? { calm: true } : {});
    const t = turn(S, st, 1, i, ch, 'blk'); st = t.st;
    if (d === 5 || d === 30) log.push(`${d}일 ${st.vars.re_gauge}`);
    for (const id of t.o.firedEvents) log.push(`${day(S, st)}:${id}`);
  }
  ck('③ 후보가 없는 동안 게이지가 멈춘다 (5일 40 → 30일 40)', log.includes('5일 40') && log.includes('30일 40'), log.join(' '));
  ck('③ ★ 풀리자마자 터지지 않고 남은 만큼 차서 온다 (36일째)', log.some((x) => x.startsWith('36:')) && !log.some((x) => /^3[1-5]:/.test(x)), log.join(' '));
}

// ── ④ 항목 쿨다운은 날 ──
{
  const S = cp(BASE);
  S.rules.randomEvents.gauge = { perDay: 50, jitter: 0 };
  S.rules.randomEvents.table = [{ id: 'big', weight: 1000, cooldown: 30, notify: '큰일' }, { id: 'small', weight: 1, notify: '작은 일' }];
  const r = fireDays(S, 120, (i) => (i % 3 === 2 ? 1 : 0), 'cd');
  const big = r.out.filter((x) => x.endsWith(':big')).map((x) => Number(x.split(':')[0]));
  ck('④ ★ 하루 세 턴이어도 쿨다운 30은 30일 (턴이면 열흘)', big.length >= 2 && big.every((d, i) => i === 0 || d - big[i - 1] >= 30), big.join(','));
}

// ── ⑤ 서사 개입 ──
{
  const S = cp(BASE);
  let st = fresh(S);
  st = turn(S, st, 1, 1).st;                          // 10
  st = engine.toggleAction(S, st, 'provoke').state;
  const s1 = engine.sendPhase(S, st, { rng: seededRng('fx', 1, 's') });
  ck('⑤ 효과 { gauge: 60 } — 게이지를 당긴다', s1.state.vars.re_gauge === 70, `${s1.state.vars.re_gauge}`);
  const o1 = engine.outputPhase(S, s1.state, { skip_day: 3 }, {}, { rng: seededRng('fx', 1, 'o') });
  ck('⑤ 당긴 만큼 빨리 온다 (4일째 터짐)', o1.firedEvents.length === 1 && day(S, o1.state) === 4, `${o1.firedEvents} · ${day(S, o1.state)}일`);
  let st2 = fresh(S); st2.vars.re_gauge = 50;
  st2 = engine.toggleAction(S, st2, 'soothe').state;
  ck('⑤ 음수는 늦춘다 — 0 아래로는 안 간다', engine.sendPhase(S, st2, { rng: seededRng('fx', 2, 's') }).state.vars.re_gauge === 0, '');
  const S2 = cp(BASE); S2.rules.randomEvents.table = [{ id: 'quake', weight: 1, notify: '땅이 흔들렸다.', effects: [{ gauge: '50' }] }];
  const af = fireDays(S2, 30, () => 1, 'af');
  ck('⑤ ★ 여진 — 터진 사건의 { gauge: +50 }은 비운 뒤 얹힌다 (10 → 18 → 26)', JSON.stringify(af.days) === JSON.stringify([10, 18, 26]), af.out.join(' '));
}

// ── ⑥ 보이지 않는다 ──
{
  const S = cp(BASE);
  let st = fresh(S); const logs = []; let lastSend = null;
  for (let i = 0; i < 12; i++) { const t = turn(S, st, 1, i, {}, 'vis'); st = t.st; logs.push(...t.s.changeLog, ...t.o.changeLog); lastSend = t.s; }
  ck('⑥ 변화 원장에 게이지 없음', !logs.some((c) => /re_gauge|re_cool/.test(String(c.id))), JSON.stringify(logs.filter((c) => /re_/.test(String(c.id)))));
  ck('⑥ 보조 원장에 게이지 없음', !(st.meta.lastChanges || []).some((l) => /re_gauge|re_cool|게이지/.test(l)), JSON.stringify(st.meta.lastChanges));
  ck('⑥ 상태창에 게이지 없음', !/re_gauge|re_cool/.test(render.renderStatusHtml(S, st, logs)), '');
  ck('⑥ 메인 프롬프트에 게이지 숫자 없음', !/re_gauge|re_cool/.test(lastSend.promptBlock), '');
  const aux = engine.buildAuxPrompt ? engine.buildAuxPrompt(S, st, { recent: '' }) : '';
  ck('⑥ 보조 프롬프트에 게이지 없음', !/re_gauge|re_cool/.test(typeof aux === 'string' ? aux : JSON.stringify(aux)), '');
  const S2 = cp(BASE); S2.updater.allow.push({ id: 're_gauge' });
  ck('⑥ 보조 allow에 올릴 수 없다', !validateSchema(S2).ok, JSON.stringify(validateSchema(S2).errors.slice(0, 1)));
  let om = fresh(S); om.vars.re_gauge = 85;
  ck('⑥ 조건식은 읽는다 — 전조 지시문 (re_gauge >= 80)', engine.sendPhase(S, om, { rng: seededRng('om', 1, 's') }).promptBlock.includes(OMEN), '');
  ck('⑥ 전조 전엔 없다', !engine.sendPhase(S, fresh(S), { rng: seededRng('om', 2, 's') }).promptBlock.includes(OMEN), '');
}

// ── ⑦ 옛 방식 그대로 ──
{
  const S = cp(BASE); delete S.rules.randomEvents.gauge; S.rules.randomEvents.chancePerTurn = 1;
  S.rules.randomEvents.table = [{ id: 'tick', weight: 1, cooldown: 2, notify: '똑딱' }]; S.actions = []; S.directives = [];
  let st = fresh(S); const turnsFired = [];
  for (let i = 0; i < 9; i++) { const t = turn(S, st, i % 3 === 2 ? 1 : 0, i, {}, 'old'); st = t.st; if (t.o.firedEvents.length) turnsFired.push(st.meta.turn); }
  ck('⑦ 옛 방식: 턴마다 굴림 · 쿨다운은 턴 (1·3·5·7·9턴)', JSON.stringify(turnsFired) === JSON.stringify([1, 3, 5, 7, 9]), turnsFired.join(','));
  ck('⑦ 옛 방식: 날 단위 기록(eventLastAt)을 안 만든다', !st.meta.eventLastAt, JSON.stringify(st.meta.eventLastAt));
}

// ── ⑧ 되감기·세이브·시간 없는 봇 ──
{
  const S = cp(BASE);
  S.vars.push({ id: 'dead', type: 'bool', init: false });
  S.updater.allow.push({ id: 'dead' });
  S.rules.events = [{ id: 'bookmark', when: 'elapsed == 12', once: true, effects: [{ checkpoint: 'save' }] },
    { id: 'gameover', when: 'dead', effects: [{ checkpoint: 'load' }, { set: 'dead', expr: 'false' }] }];
  S.checkpoint = {};
  let st = fresh(S);
  for (let i = 0; i < 12; i++) st = turn(S, st, 1, i, {}, 'cp').st;   // 10일 터짐(식힘 3) → 12일 저장
  const saved = { g: st.vars.re_gauge, c: st.vars.re_cool, at: JSON.stringify(st.meta.eventLastAt) };
  for (let i = 12; i < 30; i++) st = turn(S, st, 1, i, {}, 'cp').st;
  st = turn(S, st, 0, 99, { dead: true }, 'cp').st;
  ck('⑧ 되감기: 게이지·식힘이 저장 시점으로', st.vars.re_gauge === saved.g && st.vars.re_cool === saved.c, `${st.vars.re_gauge}/${saved.g} · ${st.vars.re_cool}/${saved.c}`);
  ck('⑧ 되감기: 날 단위 항목 쿨다운 기록도', JSON.stringify(st.meta.eventLastAt) === saved.at, `${JSON.stringify(st.meta.eventLastAt)} vs ${saved.at}`);

  const old = fresh(cp(BASE)); delete old.vars.re_gauge; delete old.vars.re_cool;
  const rec = engine.reconcileState(cp(BASE), old);
  ck('⑧ 옛 세이브에 나중에 켜도 빈 게이지로 시작', rec.vars.re_gauge === 0 && rec.vars.re_cool === 0, JSON.stringify(rec.vars));

  const N = cp(BASE); delete N.time; N.vars = N.vars.filter((x) => x.id !== 'skip_day'); N.updater.allow = [{ id: 'calm' }];
  N.rules.randomEvents.gauge = { perDay: 25, jitter: 0, cooldown: 1 };
  let nt = fresh(N); const nf = [];
  for (let i = 0; i < 12; i++) { const s = engine.sendPhase(N, nt, { rng: seededRng('nt', i, 's') }); const o = engine.outputPhase(N, s.state, {}, {}, { rng: seededRng('nt', i, 'o') }); nt = o.state; if (o.firedEvents.length) nf.push(nt.meta.turn); }
  ck('⑧ 시간 없는 봇: 한 턴 = 하루 (25씩 → 4턴째, 식힘 1턴 → 9턴째)', JSON.stringify(nf) === JSON.stringify([4, 9]), nf.join(','));
  ck('⑧ 흔들림: 0.5면 차는 양이 ×0.5~×1.5', (() => {
    const cfg = gaugeMod.gaugeConfig({ rules: { randomEvents: { gauge: { perDay: 10, jitter: 0.5 } } } });
    const xs = Array.from({ length: 200 }, (_, i) => gaugeMod.fillAmount(cfg, () => 0, 1, seededRng('j', i, 'x')));
    return Math.min(...xs) >= 5 && Math.max(...xs) <= 15 && Math.max(...xs) - Math.min(...xs) > 8;
  })(), '');
}

// ── 편집기 (가짜 DOM에 실제로 그린다) ──
{
  const findAll = (root, pred, out = []) => { for (const c of root.children || []) { if (pred(c)) out.push(c); findAll(c, pred, out); } return out; };
  const { createSchemaEditor } = SC.require('editor');
  const container = document.createElement('div');
  let ed = null, err = null;
  try { ed = createSchemaEditor(container, cp(BASE), { onChange: () => {} }); } catch (e) { err = e; }
  ck('편집기: 게이지 봇이 예외 없이 뜬다', !err, err && err.message);
  if (ed) {
    const openLower = () => { for (const d of findAll(container, (e) => e.tagName === 'DETAILS' && e.className.includes('sce-lower'))) d.open = true; };
    openLower();
    const tab = findAll(container, (e) => e.tagName === 'BUTTON' && e.className.includes('sce-tab') && (e.textContent || '').includes('규칙·이벤트'))[0];
    let e2 = null; try { tab.onclick({ preventDefault() {} }); openLower(); } catch (e) { e2 = e; }
    ck('편집기: [규칙·이벤트] 탭이 그려진다', !e2, e2 && (e2.message + ' | ' + String(e2.stack).split('\n')[1]));
    const text = container.textContent;
    ck('편집기: 발동 방식 · 하루에 차는 양 · 쉬는 날 칸', text.includes('발동 방식') && text.includes('하루에 차는 양') && text.includes('터진 뒤 쉬는 날'), '');
    ck('편집기: 미리보기 "평균 13.0일에 한 번"', text.includes('평균 13.0일에 한 번'), (text.match(/시작 상태 기준[^·]*/) || [''])[0]);
    ck('편집기: 게이지 모드에선 턴당 확률 칸이 없다', !text.includes('턴당 발동 확률'), '');
    const sel = findAll(container, (e) => e.tagName === 'SELECT' && findAll(e, (o) => o.tagName === 'OPTION' && (o.textContent || '').includes('⏳ 게이지')).length)[0];
    ck('편집기: 방식 선택 상자가 있다', !!sel, '');
    if (sel) {
      sel.value = 'chance'; sel.onchange();
      const out = ed.getSchema();
      ck('편집기: 확률로 바꾸면 gauge가 빠지고 chancePerTurn이 생긴다', !out.rules.randomEvents.gauge && out.rules.randomEvents.chancePerTurn === 0.1, JSON.stringify(out.rules.randomEvents).slice(0, 120));
      ck('편집기: 확률로 바꾼 스키마도 유효하지 않다 — gauge 효과가 남았으니 (검증이 잡는다)', !validateSchema(out).ok, '');
      const sel2 = findAll(container, (e) => e.tagName === 'SELECT' && findAll(e, (o) => o.tagName === 'OPTION' && (o.textContent || '').includes('⏳ 게이지')).length)[0];
      sel2.value = 'gauge'; sel2.onchange();
      const back = ed.getSchema().rules.randomEvents;
      ck('편집기: 게이지로 되돌리면 기본값 (하루 7 · 흔들림 0.5 · 쉬는 날 3)', back.gauge && back.gauge.perDay === 7 && back.gauge.jitter === 0.5 && back.gauge.cooldown === 3 && back.chancePerTurn === undefined, JSON.stringify(back.gauge));
    }
    const actTab = findAll(container, (e) => e.tagName === 'BUTTON' && e.className.includes('sce-tab') && (e.textContent || '').includes('액션'))[0];
    let e3 = null; try { actTab.onclick({ preventDefault() {} }); openLower(); } catch (e) { e3 = e; }
    ck('편집기: [액션] 탭 — 게이지 효과 줄이 그려진다', !e3 && findAll(container, (e) => e.className && e.className.includes('sce-effect-gauge')).length >= 2, e3 && e3.message);
    ck('편집기: [액션] 탭 — "+ ⏳ 사건 게이지" 추가 버튼', container.textContent.includes('+ ⏳ 사건 게이지'), '');
  }
}

// ── 패치·작업본 비교 ──
{
  const P = SC.require('patch');
  const r = P.parsePatch({ update: { rules: { randomEvents: { gauge: { perDay: 5 }, table: [] } } } });
  ck('패치: 게이지는 조용히 버리지 않고 알린다', !r.ok && r.errors.some((e) => /사건 게이지는 패치로 못 옮깁니다/.test(e)), JSON.stringify(r.errors));
  const A = cp(BASE), B = cp(BASE); B.rules.randomEvents.gauge.perDay = 8;
  ck('작업본 비교: 게이지가 바뀌면 "사건 게이지"로 잡힌다', P.diffSchemas(A, B).areas.some((x) => /사건 게이지/.test(JSON.stringify(x))), JSON.stringify(P.diffSchemas(A, B).areas));
}

// ── 번들 (정적) ──
{
  ck('build.js CORE에 gauge (engine 앞)', src.includes('SimCore.define("gauge"') && src.indexOf('SimCore.define("gauge"') < src.indexOf('SimCore.define("engine"'), '');
  ck('AI 규격서에 게이지 안내', src.includes('시간 체계가 있는 봇은 `gauge`(사건 게이지)를 권장'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
