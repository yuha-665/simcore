const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.7.0 하루 넘김 대리 정산 (actions[].dayClose)
//
// 계기(유저·에고서치 제보): "하루넘기기 안 누르고 그냥 채팅으로 '하루가 지났다' 하면 인식을 못 한다."
// 뿌리는 버그가 아니라 **입구가 봇마다 다른 것**이었다 — skip_day를 보조에게 준 봇(romance)은
// 채팅으로 넘어가고, 버튼만 둔 봇(daily·zombie)은 날짜 권한이 아예 없었다.
// 처방: 날짜 권한을 여는 대신 **버튼을 대신 눌러 준다** — 정산은 그 액션의 effects 한 벌뿐이라
// 두 입구가 갈라질 수 없다 (idol이 손으로 만든 night_req 기제를 엔진으로 올린 것).
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const time = SC.require('time');
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;
const clone = (o) => JSON.parse(JSON.stringify(o));

// 버튼 하나로 하루를 닫는 봇 (daily 계열의 최소형) — skip_day 변수 자체가 없다
const S = {
  simcore: '0.1', meta: { name: 'dayclose-test' },
  time: { start: '2026-05-18 21:00', advance: 'explicit' },
  vars: [
    { id: 'skip_min', label: '흐른 분', type: 'int', init: 0, min: 0, max: 1440 },
    { id: 'day_n', label: '날짜 수', type: 'int', init: 1, min: 0, max: 999 },
    { id: 'food', label: '식량', type: 'int', init: 10, min: 0, max: 99 },
    { id: 'mood', label: '기분', type: 'int', init: 50, min: 0, max: 100 },
    { id: 'dead', label: '사망', type: 'bool', init: false },
  ],
  actions: [
    { id: 'end_day', label: '🌙 하루를 마친다', mode: 'oneshot', dayClose: true, when: 'not dead',
      inject: '[시간] 오늘은 여기까지다.',
      effects: [
        { set: 'skip_min', expr: 'skip_min + ((1859 - hour * 60 - minute) % 1440) + 1' },
        { set: 'day_n', expr: 'day_n + 1' }, { set: 'food', expr: 'max(food - 2, 0)' },
      ] },
    { id: 'rest', label: '쉰다', mode: 'oneshot', effects: [{ set: 'mood', expr: 'min(mood + 5, 100)' }] },
  ],
  updater: { allow: [{ id: 'mood', maxDelta: 20 }, { id: 'skip_min', maxGain: 720 }] },
  promptState: { template: '{date} {clock} · {day_n}일차' },
};

const rng = (i, l) => seededRng('dc', i, l);
const fresh = (sch = S) => { const st = engine.initState(sch); st.meta.setupDone = true; return st; };
const dateOf = (sch, st) => {
  const cfg = time.timeConfig(sch);
  const cal = time.calendarOf(st.vars[time.EPOCH_KEY], cfg.calendar);
  return time.formatDate(cfg.dateFmt, cal) + ' ' + time.formatClock(cfg.clockFmt, cal);
};
// 한 턴: (버튼) → 전송 → 보조 응답(changes + day_passed)
const turn = (st, { press = null, changes = {}, dayPassed = false, sch = S, i = 0 } = {}) => {
  const armed = press ? engine.toggleAction(sch, st, press).state : st;
  const send = engine.sendPhase(sch, armed, { rng: rng(i, 's') });
  const out = engine.outputPhase(sch, send.state, changes, {}, { rng: rng(i, 'o'), dayPassed });
  return { st: out.state, out, pb: send.promptBlock };
};

// ── 1. 검증 ──
{
  const v = validateSchema(S);
  ck('표본 스키마 통과', v.ok, J(v.errors));
  ck('경고 없음', v.warnings.length === 0, J(v.warnings));
  const b1 = clone(S); b1.actions[0].dayClose = 'yes';
  ck('dayClose 비불린 → 오류', validateSchema(b1).errors.some((e) => e.path.endsWith('.dayClose')), '');
  const b2 = clone(S); b2.actions[1].dayClose = true;
  ck('dayClose 2개 → 경고 (정산은 한 벌)', validateSchema(b2).warnings.some((w) => w.msg.includes('한 벌')), J(validateSchema(b2).warnings));
  const b3 = clone(S); b3.actions[0].effects = [];
  ck('효과 없는 dayClose → 경고', validateSchema(b3).warnings.some((w) => w.msg.includes('돌릴 정산이 없')), '');
  const b4 = clone(S); b4.actions[0].mode = 'hold';
  ck('지속형 dayClose → 경고', validateSchema(b4).warnings.some((w) => w.msg.includes('1회성')), '');
}

// ── 2. 보조 규격 — 창구가 하나일 때만 연다 ──
{
  const p = engine.buildAuxPrompt(S, fresh(), '서사', '유저', '');
  ck('★ day_passed 신고 칸 (버튼 라벨 그대로)', p.includes('"day_passed": true') && p.includes('[🌙 하루를 마친다]'), '');
  ck('같은 날 안이면 넣지 말라는 못박기', p.includes('같은 날 안에서 시간만 흐른 것'), '');
  const withSkip = clone(S);
  withSkip.vars.push({ id: 'skip_day', label: '흐른 날', type: 'int', init: 0, min: 0, max: 3650 });
  withSkip.updater.allow.push({ id: 'skip_day', maxGain: 3650 });
  // 신고 칸이 실렸는지는 규격 줄로 본다 — 'day_passed'라는 낱말만 보면 변수 desc에도 걸린다
  const hasSpec = (sch, st) => engine.buildAuxPrompt(sch, st, '서사', '유저', '').includes('"day_passed": true');
  ck('★ skip_day 창구가 열려 있으면 day_passed는 안 붙는다 (한 가지를 두 방법으로 말하게 하지 않는다)',
    !hasSpec(withSkip, fresh(withSkip)), '');
  const noDc = clone(S); delete noDc.actions[0].dayClose;
  ck('dayClose 액션이 없으면 안 붙는다', !hasSpec(noDc, fresh(noDc)), '');
  ck('브리지 굽기(allowAll)에는 안 싣는다',
    !engine.buildAuxPrompt(S, fresh(), '서사', '유저', '', { allowAll: true }).includes('"day_passed": true'), '');
}

// ── 3. 파싱 — 헐거운 참값도 받는다 ──
{
  const P = (s) => engine.parseAuxResponse(s);
  ck('day_passed: true', P('{"changes":{},"day_passed":true}').dayPassed === true, '');
  ck('문자열 "true"도 참 (보조가 JSON을 느슨하게 쓴다)', P('{"changes":{},"day_passed":"true"}').dayPassed === true, '');
  ck('숫자 1도 참', P('{"changes":{},"day_passed":1}').dayPassed === true, '');
  ck('false는 거짓', P('{"changes":{},"day_passed":false}').dayPassed === false, '');
  ck('없으면 거짓', P('{"changes":{}}').dayPassed === false, '');
}

// ── 4. 대리 정산 — 버튼과 같은 한 벌 ──
{
  const base = fresh();
  ck('시작 21:00', dateOf(S, base) === '2026-05-18 21:00', dateOf(S, base));
  // 버튼을 누른 경우
  const pressed = turn(base, { press: 'end_day', i: 1 });
  // 채팅만으로 넘긴 경우 (같은 시드)
  const auto = turn(base, { dayPassed: true, i: 1 });
  ck('★ 버튼 없이 day_passed만으로 하루가 넘어간다 (제보 재현)',
    auto.out.dayClosed === true && auto.st.vars.day_n === 2, `${auto.out.dayClosed}/${auto.st.vars.day_n}`);
  ck('★ 정산은 버튼과 완전히 같은 한 벌 (날짜·모든 변수 일치)',
    dateOf(S, auto.st) === dateOf(S, pressed.st) && auto.st.vars.day_n === pressed.st.vars.day_n
    && auto.st.vars.food === pressed.st.vars.food, `${dateOf(S, auto.st)} vs ${dateOf(S, pressed.st)}`);
  ck('날짜가 이번 턴에 바로 굳는다 (다음 날 07:00)', dateOf(S, auto.st) === '2026-05-19 07:00', dateOf(S, auto.st));
  ck('통지가 다음 전송에 실린다 — "다시 넘기지 마라"',
    turn(auto.st, { i: 2 }).pb.includes('이미 지나간 그 하루를 다시 넘기지 말고'), '');
  ck('신고가 없으면 아무 일도 없다', turn(base, { i: 3 }).out.dayClosed === false && turn(base, { i: 3 }).st.vars.day_n === 1, '');
  ck('보조 델타는 그대로 함께 반영', turn(base, { dayPassed: true, changes: { mood: 5 }, i: 4 }).st.vars.mood === 55, '');
}

// ── 5. 막는 것 셋 ──
{
  const base = fresh();
  // ① 유령 밤 — 버튼을 누른 그 턴의 신고 (idol v0.87.2 실사고를 구조로)
  const ghost = turn(base, { press: 'end_day', dayPassed: true, i: 10 });
  ck('★ 유령 밤 빗장 — 버튼 누른 턴의 신고는 무시 (하루가 두 번 안 흐른다)',
    ghost.out.dayClosed === false && ghost.st.vars.day_n === 2 && dateOf(S, ghost.st) === '2026-05-19 07:00',
    `${ghost.out.dayClosed}/${ghost.st.vars.day_n}`);
  // ② 보조가 skip_day를 직접 올린 턴 — 숫자가 이긴다
  const withSkip = clone(S);
  withSkip.vars.push({ id: 'skip_day', label: '흐른 날', type: 'int', init: 0, min: 0, max: 3650 });
  withSkip.updater.allow.push({ id: 'skip_day', maxGain: 3650 });
  const both = turn(fresh(withSkip), { changes: { skip_day: 3 }, dayPassed: true, sch: withSkip, i: 11 });
  ck('★ 보조가 skip_day를 올린 턴엔 대리 정산 안 함 (이중 진행 방지, 숫자가 이긴다)',
    both.out.dayClosed === false && both.st.vars.day_n === 1 && dateOf(withSkip, both.st) === '2026-05-21 21:00',
    `${both.out.dayClosed}/${dateOf(withSkip, both.st)}`);
  // ③ when 게이트
  let dead = fresh(); dead.vars.dead = true;
  const d = turn(dead, { dayPassed: true, i: 12 });
  ck('★ when이 거짓이면 무시 (죽었는데 밤이 넘어가지 않는다)', d.out.dayClosed === false && d.st.vars.day_n === 1, '');
}

// ── 6. 리롤 안정 ──
{
  const base = fresh();
  const a = turn(base, { dayPassed: true, i: 20 });
  const b = turn(base, { dayPassed: true, i: 20 });
  ck('같은 시드·같은 신고 → 같은 결과', J(a.st.vars) === J(b.st.vars), '');
}

// ── 7. 내장 템플릿 — daily(💤 깃발 계열) 실물 ──
{
  const D = TEMPLATES.daily.schema;
  const dc = (D.actions || []).find((a) => a.dayClose === true);
  ck('daily: 💤 하루를 마친다에 dayClose', !!dc && dc.id === 'end_day', J((D.actions || []).map((a) => a.id)));
  ck('daily: skip_day는 여전히 없다 (권한이 아니라 대리 정산으로 푼다)', !D.vars.some((v) => v.id === 'skip_day'), '');
  ck('daily 보조 규격에 day_passed', engine.buildAuxPrompt(D, fresh(D), '서사', '유저', '').includes('"day_passed": true'), '');
  ck('wake_at desc가 넘김 신고 턴도 포함 (깃발 세운 턴에 시계가 바로 맞는다). 필드명은 안 쓴다 — 그 칸이 없는 봇에도 실리는 문장',
    /하루가 넘어갔다고 신고할 때/.test(D.vars.find((v) => v.id === 'wake_at').desc)
    && !D.vars.find((v) => v.id === 'wake_at').desc.includes('day_passed'), '');
  // 깃발 계열: day_passed + wake_at을 같이 신고하면 같은 턴에 동기화 이벤트가 돈다
  let st = fresh(D);
  const before = dateOf(D, st);
  let r = turn(st, { changes: { wake_at: '아침' }, dayPassed: true, sch: D, i: 30 });
  ck('daily: 깃발이 서고 동기화가 같은 턴에 돈다 (day_break 내려감)',
    r.out.dayClosed === true && r.st.vars.day_break === false && r.st.vars.wake_at === '미정',
    `${r.out.dayClosed}/${r.st.vars.day_break}/${r.st.vars.wake_at}`);
  const after = dateOf(D, turn(r.st, { sch: D, i: 31 }).st);
  ck('★ daily: 채팅만으로 다음 날 아침에 도착', /08:00$/.test(after) && after !== before, `${before} → ${after}`);
  // wake_at을 안 주면 깃발만 서고 시계는 안 튄다 (동기화 이벤트 조건이 막는다)
  let q = turn(fresh(D), { dayPassed: true, sch: D, i: 32 });
  ck('wake_at 없이 신고하면 깃발만 — 시각을 멋대로 굳히지 않는다',
    q.st.vars.day_break === true && dateOf(D, q.st) === before, dateOf(D, q.st));
}

// ── 8. 내장 템플릿 — zombie(직접 계산 계열) ──
{
  const Z = TEMPLATES.zombie.schema;
  const dc = (Z.actions || []).find((a) => a.dayClose === true);
  ck('zombie: 🌙 밤을 넘긴다에 dayClose + when 유지', !!dc && dc.id === 'nightfall' && dc.when === 'not dead', '');
  // v1.7.0에서 드러난 옛 버그 — skip_min max 480이 🌙의 1440분 계산을 깎아 버튼을 눌러도 8시간만
  // 흘렀다 (07:00 → 15:00). 변수 max는 시스템 정산의 천장이지 AI 밸브가 아니다 (allow maxGain 240이 그 몫).
  ck('★ zombie: skip_min 상한이 하루를 담는다 (480이면 🌙이 8시간짜리가 된다)',
    Z.vars.find((v) => v.id === 'skip_min').max === 1440, String(Z.vars.find((v) => v.id === 'skip_min').max));
  ck('zombie: 보조 몫은 여전히 240으로 묶여 있다', (Z.updater.allow || []).find((a) => a.id === 'skip_min').maxGain === 240, '');
  let st = fresh(Z);
  const pressedZ = turn(st, { press: 'nightfall', sch: Z, i: 40 });
  ck('★ zombie: 버튼도 이제 온전히 하루를 넘긴다 (옛 15:00 버그 회귀)', /07:00$/.test(dateOf(Z, pressedZ.st)), dateOf(Z, pressedZ.st));
  const r = turn(st, { dayPassed: true, sch: Z, i: 40 });
  ck('★ zombie: 채팅만으로 다음 날 07:00 (직접 계산이라 그 턴에 바로)',
    r.out.dayClosed === true && /07:00$/.test(dateOf(Z, r.st)), dateOf(Z, r.st));
  let dead = fresh(Z); dead.vars.dead = true;
  ck('zombie: 죽었으면 대리 정산도 안 돈다', turn(dead, { dayPassed: true, sch: Z, i: 41 }).out.dayClosed === false, '');
}

// ── 9. romance — 숫자 창구가 열려 있어 대리는 꺼진다 ──
{
  const M = TEMPLATES.romance.schema;
  ck('romance: 🌙에 dayClose 표시는 있다', (M.actions || []).some((a) => a.dayClose === true), '');
  ck('romance: 그래도 day_passed는 안 붙는다 (skip_day가 allow에 있음)',
    !engine.buildAuxPrompt(M, fresh(M), '서사', '유저', '').includes('"day_passed": true'), '');
  ck('romance: skip_day 창구는 그대로', (M.updater.allow || []).some((a) => a.id === 'skip_day'), '');
}

// ── 10. 옛 세이브·미사용 봇 회귀 ──
{
  const plain = { simcore: '0.1', meta: { name: 'p' }, vars: [{ id: 'g', label: '금', type: 'int', init: 0 }],
    updater: { allow: [{ id: 'g' }] } };
  const o = engine.outputPhase(plain, engine.sendPhase(plain, engine.initState(plain)).state, { g: 5 }, {}, { dayPassed: true });
  ck('dayClose 액션이 없는 봇에 신고가 와도 조용히 무시', o.dayClosed === false && o.state.vars.g === 5, '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
