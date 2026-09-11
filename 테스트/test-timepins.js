const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.11 — 시간 고정표(time.pins) + 이번 정산에서 흐른 시간(turn_min/turn_hour/turn_day)
// 제보: "매 턴 자동 처리가 10분이나 10년이나 한 턴으로 잡아 시간당 소모를 쓸 수 없다".
// 유저 결정: 시간은 기본으로 AI가 잡되, 사람이 정한 행동·상황만 고정값이 이긴다.
const fs = require('fs');
const engine = require(__P('../core/engine.js'));
const { validateSchema } = require(__P('../core/validate.js'));
const time = require(__P('../core/time.js'));
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));

const S = {
  simcore: '0.1', meta: { name: '고정표' },
  time: {
    start: '2026-01-01 09:00', advance: 'explicit', format: { date: 'YYYY-MM-DD', clock: 'HH:mm' },
    pins: [
      { label: '수업', mentions: ['수업', '강의'], min: 50 },
      { label: '휴식', mentions: ['쉰다'], min: 10, mode: 'add' },
      { action: 'act_travel', min: 60 },
      { action: 'act_nap', min: 30, mode: 'add' },
    ],
  },
  vars: [
    { id: 'hunger', label: '허기', type: 'int', init: 100, min: 0, max: 100 },
    { id: 'skip_min', label: '흐른 분', type: 'int', init: 0, min: 0, max: 1440 },
    { id: 'skip_day', label: '넘긴 날', type: 'int', init: 0, min: 0, max: 3650 },
  ],
  updater: { allow: [{ id: 'skip_min' }, { id: 'skip_day' }] },
  rules: { onTurn: [{ set: 'hunger', expr: 'hunger - floor(turn_hour * 6)' }] },
  actions: [
    { id: 'act_travel', label: '이동', effects: [{ set: 'skip_min', expr: 'skip_min + 15' }] },
    { id: 'act_nap', label: '낮잠', effects: [] },
  ],
};
const rng = (i, tag) => engine.makeRng ? engine.makeRng(`${i}:${tag}`) : (() => 0.5);
const fresh = (sch = S) => { const st = engine.initState(sch); st.meta.setupDone = true; return st; };
const turn = (st, { press = null, changes = {}, text = '', sch = S, i = 0 } = {}) => {
  const armed = press ? engine.toggleAction(sch, st, press).state : st;
  const send = engine.sendPhase(sch, armed, { rng: rng(i, 's') });
  const out = engine.outputPhase(sch, send.state, changes, {}, { rng: rng(i, 'o'), seenText: text });
  return { st: out.state, out, send };
};
const epoch = (st) => st.vars[time.EPOCH_KEY];

console.log('── 검증');
{
  const v = validateSchema(S);
  ck('표본 스키마 통과', v.ok, J(v.errors));
  ck('경고 없음', v.warnings.length === 0, J(v.warnings));
  const cfg = time.timeConfig(S);
  ck('timeConfig.pins 정규화 (4건, 기본 mode set)', cfg.pins.length === 4 && cfg.pins[0].mode === 'set' && cfg.pins[1].mode === 'add', J(cfg.pins));
  const b1 = clone(S); b1.time.pins.push({ min: 5 });
  ck('행동도 낱말도 없으면 오류', validateSchema(b1).errors.some((e) => e.path.startsWith('$.time.pins[4]')), '');
  const b2 = clone(S); b2.time.pins.push({ action: 'nope', min: 5 });
  ck('없는 액션 → 오류', validateSchema(b2).errors.some((e) => e.path === '$.time.pins[4].action'), '');
  const b3 = clone(S); b3.time.pins[0].mode = 'mul';
  ck('mode 오타 → 오류', validateSchema(b3).errors.some((e) => e.path === '$.time.pins[0].mode'), '');
  const b4 = clone(S); b4.time.pins[0].min = -1;
  ck('음수 분 → 오류', validateSchema(b4).errors.some((e) => e.path === '$.time.pins[0].min'), '');
  const b5 = clone(S); b5.time.pins[0].mentions = ['수'];
  ck('한 글자 낱말 → 경고', validateSchema(b5).warnings.some((w) => w.path === '$.time.pins[0].mentions'), '');
  const b6 = clone(S); b6.vars = b6.vars.filter((v) => v.id !== 'skip_min'); b6.updater.allow = [{ id: 'skip_day' }];
  ck('skip_min 없으면 경고 (고정값이 버려진다)', validateSchema(b6).warnings.some((w) => w.path === '$.time.pins'), J(validateSchema(b6).warnings));
  const b7 = clone(S); b7.vars.push({ id: 'turn_hour', type: 'int', init: 0 });
  ck('turn_hour 변수 id → 예약 이름 오류', validateSchema(b7).errors.some((e) => /turn_hour/.test(e.msg)), '');
  const b8 = clone(S); delete b8.time; b8.rules.onTurn = [{ set: 'hunger', expr: 'hunger - 1' }];
  ck('시간 없는 봇은 그대로 통과', validateSchema(b8).ok, J(validateSchema(b8).errors));
  const b9 = clone(S); delete b9.time;
  ck('시간 없는 봇에서 turn_hour 참조는 오류 (예약 이름이 안 열림)', !validateSchema(b9).ok, '');
}

console.log('── 흐른 시간 노출 (turn_min/turn_hour/turn_day)');
{
  let st = fresh();
  const e0 = epoch(st);
  ({ st } = turn(st, { changes: { skip_min: 15 }, text: '잡담을 나눴다' }));
  ck('보조 추정 15분 → 시계 +15', epoch(st) - e0 === 15, epoch(st) - e0);
  ck('onTurn이 turn_hour를 읽었다 (15분 = 0.25h → floor(1.5)=1)', st.vars.hunger === 99, st.vars.hunger);
  ck('정산 뒤 turn_min은 0으로', st.vars.turn_min === 0, st.vars.turn_min);
  ({ st } = turn(st, { changes: {}, text: '아무 일도 없었다' }));
  ck('시간이 안 흐른 턴은 안 깎인다', st.vars.hunger === 99, st.vars.hunger);
  ({ st } = turn(st, { changes: { skip_day: 1 }, text: '이튿날' }));
  ck('하루 도약 → 24h × 6 = 144 → 0으로 바닥', st.vars.hunger === 0, st.vars.hunger);
  const look = engine.makeLookup(S, { ...st.vars, turn_min: 90 });
  ck('lookup: turn_hour 1.5 · turn_day 0.0625', look('turn_hour') === 1.5 && look('turn_day') === 90 / 1440, `${look('turn_hour')} ${look('turn_day')}`);
  const noTime = clone(S); delete noTime.time; noTime.rules.onTurn = [];
  const st2 = engine.initState(noTime);
  ck('시간 없는 봇엔 turn_min이 없다', !('turn_min' in st2.vars), J(Object.keys(st2.vars)));
  // perTurn(턴마다 하루)도 쌓인다
  const pt = clone(S); pt.time.advance = 'perTurn';
  let p = fresh(pt);
  const { send: ps } = turn(p, { sch: pt, changes: {} });
  ({ st: p } = turn(p, { sch: pt, changes: {} }));
  ck('perTurn: 응답마다 하루 → turn_day 1 → 허기 -144 → 0', p.vars.hunger === 0, p.vars.hunger);
}

console.log('── 낱말 항목');
{
  let st = fresh();
  const e0 = epoch(st);
  const { st: s1, out } = turn(st, { changes: { skip_min: 15 }, text: '오늘 수업이 길었다' });
  ck('set: 보조 15분을 버리고 50분', epoch(s1) - e0 === 50, epoch(s1) - e0);
  ck('변화 로그에 시간 고정 줄', out.changeLog.some((c) => c.id === '시간 고정' && /수업 50분/.test(c.to)), J(out.changeLog.map((c) => c.id)));
  ck('허기는 50분치 (floor(5)=5)', s1.vars.hunger === 95, s1.vars.hunger);
  const { st: s2 } = turn(st, { changes: { skip_min: 15 }, text: '잠깐 쉰다' });
  ck('add: 보조 15 + 10 = 25', epoch(s2) - e0 === 25, epoch(s2) - e0);
  const { st: s3 } = turn(st, { changes: { skip_min: 15 }, text: '강의 뒤에 쉰다' });
  ck('set + add 동시: 50 + 10 = 60', epoch(s3) - e0 === 60, epoch(s3) - e0);
  const { st: s4 } = turn(st, { changes: { skip_min: 15, skip_day: 3 }, text: '사흘 뒤 수업' });
  ck('set은 skip_day(유저 선언)를 안 건드린다: 3일 + 50분', epoch(s4) - e0 === 3 * 1440 + 50, epoch(s4) - e0);
  const { st: s5 } = turn(st, { changes: { skip_min: 15 }, text: '수업' });
  ck('유저 글에서도 걸린다 (seenText = 서사+유저 글)', epoch(s5) - e0 === 50, epoch(s5) - e0);
  const { st: s6 } = turn(st, { changes: { skip_min: 15 }, text: 'SUEOP 대문자 강의' });
  ck('대소문자 무시 대조', epoch(s6) - e0 === 50, epoch(s6) - e0);
}

console.log('── 액션 항목');
{
  let st = fresh();
  const e0 = epoch(st);
  const { st: s1, send, out } = turn(st, { press: 'act_travel', changes: { skip_min: 15 }, text: '길을 떠났다' });
  ck('set: 효과 15분을 덮고 60분, 보조 15분은 버림 → +60', epoch(s1) - e0 === 60, epoch(s1) - e0);
  ck('전송 단계에 깃발이 선다', send.state.meta.timePin && send.state.meta.timePin.min === 60, J(send.state.meta.timePin));
  ck('응답 단계 뒤 깃발은 내려간다', s1.meta.timePin === null, J(s1.meta.timePin));
  ck('허기는 60분치 (floor(6)=6)', s1.vars.hunger === 94, s1.vars.hunger);
  ck('보조 허용에서 skip_min이 빠진다 (고정 턴)', !engine.auxAllowList(S, '길을 떠났다', send.state).some((a) => a.id === 'skip_min'), '');
  const prompt = engine.buildAuxPrompt(S, send.state, '길을 떠났다', '가자', '');
  ck('보조 프롬프트에 "굳혔다" 한 줄', /60분으로 굳혔다/.test(prompt), '');
  const { st: s2 } = turn(st, { press: 'act_nap', changes: { skip_min: 15 }, text: '눈을 붙였다' });
  ck('add: 보조 15 + 30 = 45', epoch(s2) - e0 === 45, epoch(s2) - e0);
  const { st: s3 } = turn(st, { press: 'act_travel', changes: { skip_min: 15 }, text: '가는 길에 쉰다' });
  ck('액션 set + 낱말 add: 60 + 10 = 70', epoch(s3) - e0 === 70, epoch(s3) - e0);
  const { st: s4 } = turn(st, { press: 'act_travel', changes: { skip_min: 15 }, text: '가는 길에 수업 얘기' });
  ck('액션 set이 굳었으면 낱말 set은 무시 (60, 50 아님)', epoch(s4) - e0 === 60, epoch(s4) - e0);
  const { st: s5 } = turn(st, { press: 'act_travel', changes: { skip_min: 15, skip_day: 2 }, text: '' });
  ck('액션 set도 skip_day는 그대로: 2일 + 60분', epoch(s5) - e0 === 2 * 1440 + 60, epoch(s5) - e0);
  // 진행 변수가 없으면 고정값은 조용히 버려진다 (검증이 경고) — 죽지는 않는다
  const noSkip = clone(S); noSkip.vars = noSkip.vars.filter((v) => v.id !== 'skip_min'); noSkip.updater.allow = [{ id: 'skip_day' }];
  noSkip.actions[0].effects = [];
  const ns = fresh(noSkip);
  const { st: s6 } = turn(ns, { sch: noSkip, press: 'act_travel', changes: {}, text: '수업' });
  ck('skip_min 없는 봇: 고정표가 죽이지 않는다', epoch(s6) === epoch(ns), '');
}

console.log('── 편집기·규격서·번들');
{
  ck('시간 탭에 고정표 카드', src.includes("timeSection('시간 고정표'") && src.includes('sce-time-pin-row'), '');
  ck('고정표 행: 행동·낱말·분·방식', src.includes("timeField('행동'") && src.includes("timeField('낱말'") && src.includes("timeField('분'") && src.includes("timeField('방식'"), '');
  ck('항목이 없으면 pins를 스키마에 안 남긴다', src.includes('if (!pins.length) delete T.pins;'), '');
  ck('매 턴 규칙 카드에 turn_hour 안내', src.includes('turn_hour·turn_day(이번 정산에서 흐른 시간)를 곱해 시간당 소모로'), '');
  ck('규격서 시간 탭에 pins·turn_*', src.includes("'- `pins` (v1.9.11): 시간 고정표") && src.includes('`turn_min`·`turn_hour`·`turn_day`'), '');
  ck('규격서 시간 규칙에 "응답 횟수에 걸지 마세요"', src.includes('매 턴 소모를 응답 횟수에 걸지 마세요'), '');
  ck('CSS 고정표 행 + 좁은 화면 1열', src.includes('.sce .sce-time-pin-row {') && src.includes('.sce .sce-time-pin-row { grid-template-columns:1fr; }'), '');
  ck('엔진: 응답 단계 끝에 turn_min 소진', src.includes('8.9 이번 정산에서 흐른 시간(turn_min) 소진'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
