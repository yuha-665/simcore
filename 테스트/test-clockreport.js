const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.19.0 — 시각 보고: 보조는 "장면이 끝난 시각"을 적고, 빼기는 엔진이 한다.
// 제보(커뮤니티 2026-10-17): "심코어 타임이랑 LLM이 인식하는 타임이 안 맞는다."
// 뿌리: 시계를 미는 보조가 [지금]에서 직접 빼 흐른 분을 적었다 — "저녁이 되었다"면 570을 계산, 자정을 넘기면 일·분으로 쪼개기
// (skip_day는 시각을 보존해 22:00에 자고 07:00에 깨는 것은 둘로 적을 수조차 없었다). 델타는 두 번 세면 두 배라 상한을 걸었고,
// 그 상한이 "저녁까지 잤다"를 잘라 서사와 시계가 갈라졌다. 시각은 두 번 적어도 같은 시각이다.
// 여기서 못 박는 것:
//   · 옮기기: 같은 날 / 같은 시각 두 번(0분) / 자정 넘김(6시간 안) / 날짜 신고 + 시각 / 며칠 뒤 + 시각
//   · 거꾸로 온 시각이 6시간 밖이면 버린다(회상·약속 속 시각) · 하루 닫기 버튼이 있고 날짜 창구가 없는 봇은 자정을 안 넘긴다
//   · 같은 날 몫엔 봇의 maxGain 그대로 — 넘으면 그만큼만, 다음 턴 같은 시각 보고가 나머지를 메운다 (쌓이지 않고 수렴)
//   · 양보: day_passed · 액션이 시간을 굳힌 턴(timePin) · 시간을 정하는 이벤트가 걸린 턴 · 낱말 고정표(set)가 이긴다
//   · 분으로 답하는 보조도 받는다(시각이 없을 때) / changes 안의 clock도 / 봇에 clock 변수가 있으면 그건 그 봇의 변수다
//   · 시계를 안 보이는 봇(하루 단위)·skip_min이 닫힌 봇은 시각을 와도 무시
//   · 프롬프트: 시계 봇엔 시각 규칙·형식 줄·skip_min 주석, 시계 없는 봇·루아 브리지 굽기엔 종전 규칙
//   · 변화 카드: 보조의 skip_min 줄을 "시각 보고 HH:mm" 한 줄로 / 보조 원장엔 시각 줄 하나(중복 없음)
//   · 지연(소급) 경로도 시각을 받는다 · 세션·어댑터가 clock을 넘긴다
//   · 실제 템플릿(로맨스·일상)의 하루 마치기 흐름이 시각이 같이 와도 종전과 같다 · 좀비는 상한(4시간) 안에서 시각을 따른다
// v1.19.1 — 날짜가 하루 더 가는 두 자리:
//   · 새벽잠: 날짜 문구는 달력 기준("자고 일어남" 예시 삭제) + 자정~05:00의 "이튿날"(시각이 지금보다 뒤)은 같은 날로 받는다
//   · 🌙 메아리: 하루 닫기 버튼이 넘긴 밤을 보조가 skip_day로 또 세면 하루를 뺀다 — 로맨스(깃발 + 동기화)·아틀리에 꼴(시계를 바로 옮김)
//     둘 다, 지연 경로도. 깃발이 서 있는 동안은 시각 보고를 안 묻고 안 받는다(그 밤은 동기화 몫). 동기화 턴엔 보조의 분도 버린다
//     (아침을 넘긴 분 = 하루가 두 번 가는 두 번째 길). 대조: 버튼을 모르는 엔진이면 이틀 뒤
const fs = require('fs');
const engine = require(__P('../core/engine.js'));
const { validateSchema } = require(__P('../core/validate.js'));
const time = require(__P('../core/time.js'));
const { TEMPLATES } = require(__P('../core/templates.js'));
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));
const R = () => 0.5;

const S = {
  simcore: '0.1', meta: { name: '시각 보고' },
  time: { start: '2026-03-02 08:30', advance: 'explicit', format: { date: 'YYYY-MM-DD', clock: 'HH:mm' },
    pins: [{ label: '수업', mentions: ['수업'], min: 50 }, { action: 'act_travel', min: 60 }] },
  vars: [
    { id: 'hunger', label: '허기', type: 'int', init: 100, min: 0, max: 100 },
    { id: 'flag', label: '깃발', type: 'bool', init: false },
    { id: 'skip_min', label: '흐른 분', type: 'int', init: 0, min: 0, max: 1440 },
    { id: 'skip_day', label: '넘긴 날', type: 'int', init: 0, min: 0, max: 3650 },
  ],
  updater: { allow: [{ id: 'hunger' }, { id: 'flag' }, { id: 'skip_min', maxGain: 720 }, { id: 'skip_day', maxGain: 3650 }] },
  actions: [{ id: 'act_travel', label: '이동', effects: [] }],
  promptState: { template: '지금: {date} {clock}' },
};
const cfgOf = (sch) => time.timeConfig(sch);
const fresh = (sch = S, at = null) => {
  const st = engine.initState(sch); st.meta.setupDone = true;
  if (at) { const c = cfgOf(sch); st.vars[time.EPOCH_KEY] = time.epochFrom(time.parseStart(at, c.calendar), c.calendar); }
  return st;
};
const when = (sch, st) => {
  const c = cfgOf(sch), cal = time.calendarOf(st.vars[time.EPOCH_KEY], c.calendar);
  return `${time.formatDate('YYYY-MM-DD', cal)} ${time.formatClock('HH:mm', cal)}`;
};
// 한 턴 — 전송(액션 소비) → 응답(보조 결과). 응답 단계 소비까지 끝난 상태를 돌려준다
const turn = (sch, st, { changes = {}, clock = null, press = null, text = '', dayPassed = false } = {}) => {
  const armed = press ? engine.toggleAction(sch, st, press).state : st;
  const send = engine.sendPhase(sch, armed, { rng: R });
  const out = engine.outputPhase(sch, send.state, changes, {}, { rng: R, seenText: text, pinText: text, clock, dayPassed });
  return { st: out.state, out, send };
};

console.log('── 파서 · 판정');
{
  const P = time.parseClockText;
  const cases = [['18:00', 1080], ['8:05', 485], ['18:00:00', 1080], ['18시', 1080], ['18시 30분', 1110], ['18시 반', 1110],
    ['오후 6시', 1080], ['오전 12시', 0], ['오후 12시', 720], ['6:30 PM', 1110], ['6:30 am', 390], ['24:00', 0], [' 07:45 ', 465]];
  for (const [s, w] of cases) ck(`"${s}" → ${w}`, P(s) === w, P(s));
  for (const s of ['25:00', '18', '저녁', '18:60', '오후 13시', '', null, 18]) ck(`못 읽는 것 ${J(s)} → null`, P(s) === null, P(s));
  ck('시계 노출 기본값 → 시계 봇', time.clockExposed(cfgOf(S)) === true, '');
  ck('하루 단위 봇(베리디아식 expose) → 시계 없음', time.clockExposed(cfgOf({ ...S, time: { ...S.time, expose: ['date', 'season', 'year', 'month', 'dom', 'elapsed'] } })) === false, '');
  ck('hour만 노출해도 시계 봇', time.clockExposed(cfgOf({ ...S, time: { ...S.time, expose: ['date', 'hour'] } })) === true, '');
  ck('시간 체계 없음 → 아님', time.clockExposed(null) === false, '');
  const v = validateSchema(S);
  ck('표본 스키마 통과', v.ok, J(v.errors));
}

console.log('── 옮기기');
{
  let r = turn(S, fresh(), { clock: '18:30' });
  ck('★ 같은 날 — 08:30에 "18:30" → 18:30', when(S, r.st) === '2026-03-02 18:30', when(S, r.st));
  const log = r.out.changeLog.filter((c) => c.id === 'skip_min');
  ck('변화 카드 한 줄 — 흐른 분 0 → 600, 사유 "시각 보고 18:30"', log.length === 1 && log[0].from === 0 && log[0].to === 600 && log[0].source === 'llm' && log[0].reason === '시각 보고 18:30', J(log));
  const memo = r.st.meta.lastChanges || [];
  ck('보조 원장엔 시각 줄 하나 (skip_min 줄·시각 보고 줄 중복 없음)',
    memo.some((s) => s.includes('2026-03-02 08:30 → 2026-03-02 18:30 (600분 진행)')) && !memo.some((s) => /흐른 분|시각 보고/.test(s)), J(memo));
  const r2 = turn(S, r.st, { clock: '18:30' });
  ck('★ 같은 시각을 또 적으면 0분 (두 번 세지 않는다)', when(S, r2.st) === '2026-03-02 18:30' && !r2.out.changeLog.some((c) => c.id === 'skip_min'), when(S, r2.st));
  r = turn(S, fresh(), { changes: { skip_min: 30 }, clock: '10:00' });
  ck('★ 분과 시각이 같이 오면 시각이 이긴다 (08:30 → 10:00, +90)', when(S, r.st) === '2026-03-02 10:00', when(S, r.st));
  ck('그때도 변화 카드는 한 줄 (0 → 90)', J(r.out.changeLog.filter((c) => c.id === 'skip_min').map((c) => [c.from, c.to])) === '[[0,90]]', J(r.out.changeLog));
  r = turn(S, fresh(), { changes: { skip_min: 30 } });
  ck('★ 시각 없이 분만 오면 종전대로 (+30)', when(S, r.st) === '2026-03-02 09:00', when(S, r.st));
  r = turn(S, fresh(S, '2026-03-02 22:00'), { clock: '01:30' });
  ck('★ 자정 넘김 — 22:00에 "01:30" → 다음 날 01:30', when(S, r.st) === '2026-03-03 01:30', when(S, r.st));
  r = turn(S, fresh(S, '2026-03-02 22:00'), { clock: '09:00' });
  ck('★ 거꾸로 온 시각이 6시간 밖 → 버린다 (회상·약속 속 시각)', when(S, r.st) === '2026-03-02 22:00', when(S, r.st));
  r = turn(S, fresh(S, '2026-03-02 22:00'), { clock: '09:00', changes: { skip_min: 60 } });
  ck('버린 턴에 분 보고가 있으면 그것으로 (+60)', when(S, r.st) === '2026-03-02 23:00', when(S, r.st));
  r = turn(S, fresh(S, '2026-03-02 22:00'), { clock: '07:00', changes: { skip_day: 1 } });
  ck('★ 날짜 신고 + 시각 — 22:00에 자고 "다음 날 07:00" → 03-03 07:00 (예전 길로는 03-03 22:00)', when(S, r.st) === '2026-03-03 07:00', when(S, r.st));
  ck('흐른 시간 = 540분 (turn_day 0.375 — 하루를 통째로 세지 않는다)', r.out.changeLog.some((c) => c.id === time.EPOCH_KEY && c.to - c.from === 540), J(r.out.changeLog.filter((c) => c.id === time.EPOCH_KEY)));
  r = turn(S, fresh(S, '2026-03-02 22:00'), { clock: '09:00', changes: { skip_day: 3 } });
  ck('★ 며칠 뒤 + 시각 — "사흘 뒤 09:00" → 03-05 09:00', when(S, r.st) === '2026-03-05 09:00', when(S, r.st));
  r = turn(S, fresh(), { changes: { clock: '11:15' } });
  ck('changes 안에 넣어 온 clock도 받는다', when(S, r.st) === '2026-03-02 11:15' && !r.out.changeLog.some((c) => c.id === 'clock'), when(S, r.st));
}

console.log('── 상한 · 수렴');
{
  const SC = clone(S); SC.updater.allow.find((a) => a.id === 'skip_min').maxGain = 240;
  let st = fresh(SC);
  const seen = [];
  for (let i = 0; i < 4; i++) { st = turn(SC, st, { clock: '18:30' }).st; seen.push(when(SC, st).slice(11)); }
  ck('★ 상한 4시간 봇 — 같은 "18:30"이 매 턴 와도 12:30 → 16:30 → 18:30에서 멈춘다 (쌓이지 않고 수렴)', J(seen) === J(['12:30', '16:30', '18:30', '18:30']), J(seen));
}

console.log('── 양보');
{
  let r = turn(S, fresh(), { press: 'act_travel', clock: '23:00' });
  ck('★ 액션이 시간을 굳힌 턴(timePin) — 시각 보고를 안 받는다 (이동 60분만)', when(S, r.st) === '2026-03-02 09:30', when(S, r.st));
  r = turn(S, fresh(), { clock: '12:00', text: '수업이 끝났다' });
  ck('★ 낱말 고정표(set)가 이긴다 — "수업" 50분 (시각 12:00이 와도)', when(S, r.st) === '2026-03-02 09:20', when(S, r.st));
  const SE = clone(S); SE.rules = { events: [{ id: 'faint', when: 'flag', effects: [{ set: 'skip_min', expr: '45' }, { set: 'flag', expr: 'false' }] }] };
  r = turn(SE, fresh(SE), { changes: { flag: true }, clock: '20:00' });
  ck('★ 시간을 정하는 이벤트가 걸린 턴 — 시각 보고가 비킨다 (이벤트 몫 45분은 다음 전송에)', when(SE, r.st) === '2026-03-02 08:30' && r.st.vars.skip_min === 45, `${when(SE, r.st)} skip_min=${r.st.vars.skip_min}`);
  r = turn(SE, fresh(SE), { clock: '20:00' });
  ck('그 이벤트가 안 걸린 턴엔 시각대로', when(SE, r.st) === '2026-03-02 20:00', when(SE, r.st));
  // 하루 닫기 버튼이 있고 보조에게 날짜 창구가 없는 봇 (일상·좀비 꼴)
  const SD = clone(S);
  SD.updater.allow = [{ id: 'hunger' }, { id: 'skip_min', maxGain: 720 }];
  SD.actions = [{ id: 'sleep', label: '🌙 잔다', mode: 'oneshot', dayClose: true,
    effects: [{ set: 'skip_min', expr: '((8 * 60 - (hour * 60 + minute)) + 1439) % 1440 + 1' }] }];
  SD.time.pins = [];
  ck('하루 닫기 표본 통과', validateSchema(SD).ok, J(validateSchema(SD).errors));
  r = turn(SD, fresh(SD, '2026-03-02 22:00'), { clock: '01:00' });
  ck('★ 하루 닫기 봇 — 시각 보고로 자정을 안 넘긴다 (그건 버튼·day_passed의 몫)', when(SD, r.st) === '2026-03-02 22:00', when(SD, r.st));
  r = turn(SD, fresh(SD, '2026-03-02 22:00'), { clock: '23:30' });
  ck('하루 닫기 봇 — 같은 날 앞으로는 받는다 (+90)', when(SD, r.st) === '2026-03-02 23:30', when(SD, r.st));
  r = turn(SD, fresh(SD, '2026-03-02 22:00'), { clock: '08:15', dayPassed: true });
  ck('★ day_passed — 시각 보고를 버리고 하루 닫기 정산이 시간을 정한다 (다음 날 08:00)', when(SD, r.st) === '2026-03-03 08:00', when(SD, r.st));
}

console.log('── 대상이 아닌 봇');
{
  const SV = clone(S); SV.time.expose = ['date', 'season', 'year', 'month', 'dom', 'elapsed']; SV.time.pins = [];
  SV.promptState = { template: '지금: {date}' };
  ck('하루 단위 표본 통과', validateSchema(SV).ok, J(validateSchema(SV).errors));
  let r = turn(SV, fresh(SV), { clock: '18:30' });
  ck('★ 시계를 안 보이는 봇 — 시각을 와도 무시', r.st.vars[time.EPOCH_KEY] === fresh(SV).vars[time.EPOCH_KEY], when(SV, r.st));
  const SN = clone(S); SN.updater.allow = [{ id: 'hunger' }, { id: 'skip_day' }];
  r = turn(SN, fresh(SN), { clock: '18:30' });
  ck('★ skip_min이 닫힌 봇 — 시각을 와도 무시', when(SN, r.st) === '2026-03-02 08:30', when(SN, r.st));
  const SX = { simcore: '0.1', meta: { name: '시계 변수 봇' }, vars: [{ id: 'clock', label: '시간대', type: 'text', init: '아침' }],
    updater: { allow: [{ id: 'clock' }] } };
  const sx = engine.initState(SX); sx.meta.setupDone = true;
  const ox = engine.outputPhase(SX, engine.sendPhase(SX, sx, { rng: R }).state, { clock: '저녁' }, {}, { rng: R });
  ck('★ 봇에 clock 변수가 있으면 그건 그 봇의 변수다 (끌어올리지 않는다)', ox.state.vars.clock === '저녁', J(ox.state.vars));
}

console.log('── 보조 응답 파싱');
{
  const p1 = engine.parseAuxResponse('{"changes": {"hunger": -5}, "reasons": {}, "clock": " 18:30 "}');
  ck('최상위 clock', p1 && p1.clock === '18:30' && p1.changes.hunger === -5, J(p1));
  const p2 = engine.parseAuxResponse('{"clock": "07:00", "changes": {}, "reasons": {}}');
  ck('clock이 앞에 와도', p2 && p2.clock === '07:00', J(p2));
  const p3 = engine.parseAuxResponse('{"changes": {"clock": "09:00"}, "reasons": {}}');
  ck('changes 안의 clock은 파서가 안 건드린다 (스키마를 아는 엔진이 끌어올린다)', p3 && p3.clock === null && p3.changes.clock === '09:00', J(p3));
  const p4 = engine.parseAuxResponse('{"changes": {}, "reasons": {}}');
  ck('없으면 null', p4 && p4.clock === null, J(p4));
  ck('알려진 키 목록에 clock', /KNOWN_AUX_KEYS = \[[^\]]*'clock'/.test(src), '');
}

console.log('── 프롬프트');
{
  const st = engine.sendPhase(S, fresh(), { rng: R }).state;
  const p = engine.buildAuxPrompt(S, st, '성에 닿았다.', '간다', '');
  ck('★ 시계 봇 — 시각 규칙', p.includes('"clock"에 "HH:mm"(24시간)으로 적어라') && p.includes('회상·약속·대사 속 시각이 아니라'), p);
  ck('★ 날짜 창구가 열린 봇 — 날짜는 skip_day, 시각은 그날의 시각', p.includes('skip_day에 [지금]의 날짜에서 넘어간 날 수를 적고, clock에는 그날의 시각을'), '');
  ck('★ v1.19.1 날짜는 달력 기준 — 새벽에 잠들어 같은 날 깨면 0', p.includes('날짜는 달력 기준이다: 밤에 자고 이튿날 깼으면 1, 자정을 넘긴 새벽에 잠들어 같은 날 아침에 깼으면 0'), '');
  ck('v1.19.1 옛 예시 "자고 일어남"은 없다 (새벽잠에도 하루를 넘기게 했다)', !p.includes('자고 일어남'), '');
  ck('형식 줄에 clock 예시', p.includes('"clock": "18:30"'), '');
  ck('skip_min 줄에 "시각을 정할 수 없을 때만" 주석', /- skip_min \(흐른 분, 숫자\): 현재 0\. ※ 시간은 아래 규칙대로 "clock"/.test(p), '');
  ck('종전 분 규칙은 안 실린다 (한 가지를 두 방법으로 시키지 않는다)', !p.includes('새로** 흐른 만큼만 보고하라'), '');
  const SD = clone(S); SD.updater.allow = [{ id: 'skip_min', maxGain: 240 }]; SD.time.pins = [];
  SD.actions = [{ id: 'sleep', label: '🌙 잔다', mode: 'oneshot', dayClose: true, effects: [{ set: 'skip_day', expr: 'skip_day + 1' }] }];
  const pd = engine.buildAuxPrompt(SD, engine.sendPhase(SD, fresh(SD), { rng: R }).state, '밤이 깊었다.', '', '');
  ck('★ 하루 닫기 봇 — 날짜가 넘어가면 clock 대신 day_passed', pd.includes('날짜가 넘어갔으면 clock 대신 아래 day_passed 규칙을 따라라') && pd.includes('"day_passed": true'), pd);
  const SV = clone(S); SV.time.expose = ['date', 'elapsed']; SV.time.pins = []; SV.promptState = { template: '{date}' };
  const pv = engine.buildAuxPrompt(SV, engine.sendPhase(SV, fresh(SV), { rng: R }).state, '하루가 갔다.', '', '');
  ck('★ 시계 없는 봇 — 시각 규칙 없음, 종전 규칙', !pv.includes('"clock"') && pv.includes('새로** 흐른 만큼만 보고하라'), pv);
  const pb = engine.buildAuxPrompt(S, st, '⟦narr⟧', '⟦user⟧', '', { allowAll: true });
  ck('★ 루아 브리지 굽기 — 시각 규칙 없음 ([지금]이 없다)', !pb.includes('"clock"') && !pb.includes('[지금]'), pb.slice(0, 300));
  const stPin = engine.sendPhase(S, engine.toggleAction(S, fresh(), 'act_travel').state, { rng: R }).state;
  const pp = engine.buildAuxPrompt(S, stPin, '이동했다.', '', '');
  ck('액션이 시간을 굳힌 턴 — 시각 규칙 없음', !pp.includes('"clock"에') && pp.includes('굳혔다'), pp);
}

console.log('── 지연(소급) 경로');
{
  const r = turn(S, fresh(), {});   // 보조 결과가 늦게 와서 응답 단계는 빈손으로 지나갔다
  const am = engine.applyChangesToState(S, r.st, {}, {}, null, null, null, null, { clock: '13:00' });
  ck('★ 소급 경로도 시각을 받는다 — 옮긴 분이 다음 전송에서 굳는다', am.state.vars.skip_min === 270, `skip_min=${am.state.vars.skip_min}`);
  const next = engine.sendPhase(S, am.state, { rng: R });
  ck('다음 전송 뒤 13:00', when(S, next.state) === '2026-03-02 13:00', when(S, next.state));
  const am2 = engine.applyChangesToState(S, r.st, { clock: '09:30' }, {}, null, null, null, null);
  ck('소급 경로도 changes 안의 clock을 끌어올린다', am2.state.vars.skip_min === 60 && !am2.rejected.some((x) => x.id === 'clock'), J(am2.rejected));
  ck('세션이 clock을 넘긴다', /clock: parsed\.clock \?\? null/.test(fs.readFileSync(__P('../core/session.js'), 'utf8')), '');
  ck('어댑터의 소급 두 곳이 clock을 넘긴다', (src.match(/\{ clock: parsed\.clock, dayPassed: parsed\.dayPassed \}/g) || []).length === 2, '');
}

console.log('── 실제 템플릿');
{
  // 하루 마치기(🌙) 흐름 — 시각이 같이 와도 종전(시각 없음)과 같은 시계여야 한다 (동기화 이벤트가 하루를 두 번 넘기지 않게)
  for (const key of ['romance', 'daily']) {
    const T = TEMPLATES[key].schema || TEMPLATES[key];
    const endId = (T.actions || []).find((a) => a.dayClose).id;
    const run = (at, clock) => {
      let st = fresh(T, at);
      const a = turn(T, st, { press: endId, changes: { wake_at: '아침' }, clock });
      const b = engine.sendPhase(T, a.st, { rng: R });   // 동기화 이벤트가 굳힌 분이 여기서 소비된다
      return when(T, b.state);
    };
    const base = run('2026-04-01 22:40', null), withClock = run('2026-04-01 22:40', '07:30');
    ck(`★ ${key}: 🌙 + 시간대 "아침" — 시각("07:30")이 같이 와도 종전과 같다 (${base})`, withClock === base && base === '2026-04-02 08:00', `${base} / ${withClock}`);
    // 새벽 3시에 자면 같은 날 아침 — 시각 "08:30"이 먼저 시계를 옮기면 동기화가 "다음으로 돌아오는 08:00"(이튿날)을 또 더한다. 양보가 막는 자리
    const dawn = run('2026-04-01 03:00', null), dawnClock = run('2026-04-01 03:00', '08:30');
    ck(`★ ${key}: 새벽 3시 🌙 — 시각("08:30")이 와도 하루가 두 번 안 간다 (${dawn})`, dawnClock === dawn && dawn === '2026-04-01 08:00', `${dawn} / ${dawnClock}`);
    let st = fresh(T, '2026-04-01 09:00');
    st = turn(T, st, { clock: '11:00' }).st;
    ck(`${key}: 평소 턴엔 시각대로 (09:00 → 11:00)`, when(T, st) === '2026-04-01 11:00', when(T, st));
  }
  const Z = TEMPLATES.zombie.schema || TEMPLATES.zombie;
  let st = fresh(Z, '2026-04-01 09:00');
  st = turn(Z, st, { clock: '15:00' }).st;
  ck('★ zombie: 상한 4시간 — "15:00"이 와도 13:00까지 (생존물 템포 존중)', when(Z, st) === '2026-04-01 13:00', when(Z, st));
}

console.log('── v1.19.1 새벽잠은 같은 날');
{
  let r = turn(S, fresh(S, '2026-03-02 01:00'), { clock: '07:00', changes: { skip_day: 1 } });
  ck('★ 01:00에 "이튿날 07:00" → 같은 날 07:00 (새벽의 이튿날은 달력으로 같은 날)', when(S, r.st) === '2026-03-02 07:00', when(S, r.st));
  const log = r.out.changeLog.filter((c) => c.id === 'skip_min' || c.id === 'skip_day');
  ck('변화 카드 — 흐른 분 0 → 360 한 줄, 사유에 "새벽의 이튿날은 같은 날" (skip_day 줄 없음)',
    log.length === 1 && log[0].id === 'skip_min' && log[0].to === 360 && log[0].reason === '시각 보고 07:00 · 새벽의 이튿날은 같은 날', J(log));
  r = turn(S, fresh(S, '2026-03-02 01:00'), { clock: '07:00' });
  ck('날짜 신고 없이 오면 그대로 같은 날 07:00', when(S, r.st) === '2026-03-02 07:00', when(S, r.st));
  r = turn(S, fresh(S, '2026-03-02 01:00'), { clock: '00:30', changes: { skip_day: 1 } });
  ck('시각이 지금보다 앞이면 하루를 그대로 받는다 (01:00 → 이튿날 00:30)', when(S, r.st) === '2026-03-03 00:30', when(S, r.st));
  r = turn(S, fresh(S, '2026-03-02 01:00'), { clock: '07:00', changes: { skip_day: 2 } });
  ck('며칠 뒤(2 이상)는 그대로 (01:00 → 03-04 07:00)', when(S, r.st) === '2026-03-04 07:00', when(S, r.st));
  r = turn(S, fresh(S, '2026-03-02 06:00'), { clock: '07:00', changes: { skip_day: 1 } });
  ck('05:00 뒤엔 종전대로 하루 (06:00 → 이튿날 07:00)', when(S, r.st) === '2026-03-03 07:00', when(S, r.st));
  r = turn(S, fresh(S, '2026-03-02 04:59'), { clock: '08:00', changes: { skip_day: 1 } });
  ck('경계 직전 04:59 → 같은 날 08:00', when(S, r.st) === '2026-03-02 08:00', when(S, r.st));
  r = turn(S, fresh(S, '2026-03-02 23:00'), { clock: '07:00', changes: { skip_day: 1 } });
  ck('밤에 자고 이튿날은 그대로 하루 (23:00 → 03-03 07:00)', when(S, r.st) === '2026-03-03 07:00', when(S, r.st));
}

console.log('── v1.19.1 🌙 메아리 — 로맨스 (버튼이 깃발을 세우고 동기화가 아침으로)');
{
  const T = TEMPLATES.romance.schema || TEMPLATES.romance;
  const endId = T.actions.find((a) => a.dayClose).id;
  // 🌙 턴 → 다음 전송까지 (동기화가 굳힌 분이 다음 전송에서 소비된다)
  const night = (at, changes, clock = null, sch = T) => {
    const a = turn(sch, fresh(sch, at), { press: endId, changes, clock });
    return { a, at: when(sch, engine.sendPhase(sch, a.st, { rng: R }).state) };
  };
  let n = night('2026-04-01 22:40', { wake_at: '아침', skip_day: 1 });
  ck('★ 22:40 🌙 + "이튿날 아침"(skip_day 1, desc 그대로) → 04-02 08:00 (이틀 뒤가 아니다)', n.at === '2026-04-02 08:00', n.at);
  ck('변화 카드에 skip_day 줄이 안 남는다 (1 → 0으로 빠졌다)', !n.a.out.changeLog.some((c) => c.id === 'skip_day'), J(n.a.out.changeLog.filter((c) => c.id === 'skip_day')));
  // 대조 — 하루 닫기 표시를 떼면(엔진이 버튼을 모르면) 종전대로 이틀 뒤. 이 수리가 막는 그 자리
  const T0 = clone(T); T0.actions.find((a) => a.id === endId).dayClose = false;
  const n0 = night('2026-04-01 22:40', { wake_at: '아침', skip_day: 1 }, null, T0);
  ck('(대조) 버튼을 모르는 엔진이면 04-03 08:00 — 하루가 두 번 갔다', n0.at === '2026-04-03 08:00', n0.at);
  n = night('2026-04-01 22:40', { wake_at: '아침', skip_day: 1 }, '08:00');
  ck('★ 시각("08:00")까지 같이 와도 04-02 08:00', n.at === '2026-04-02 08:00', n.at);
  n = night('2026-04-01 22:40', { wake_at: '아침', skip_day: 3 });
  ck('★ "사흘 뒤 아침"(3) → 04-04 08:00 (3 → 2 + 버튼의 하루)', n.at === '2026-04-04 08:00', n.at);
  const l3 = n.a.out.changeLog.find((c) => c.id === 'skip_day');
  ck('그때 변화 카드 — 0 → 2, 사유에 버튼 몫', l3 && l3.to === 2 && /그 밤은 \[🌙 하루를 마친다\] 몫/.test(l3.reason || ''), J(l3));
  n = night('2026-04-01 03:00', { wake_at: '아침', skip_day: 1 });
  ck('★ 새벽 3시 🌙 + skip_day 1 → 같은 날 04-01 08:00', n.at === '2026-04-01 08:00', n.at);
  n = night('2026-04-01 22:40', { wake_at: '아침' });
  ck('skip_day 없이 오면 종전과 같다 (04-02 08:00)', n.at === '2026-04-02 08:00', n.at);
  // 두 번째 길 — 동기화 턴에 보조가 일어난 시각까지의 분을 크게 적으면 "다음으로 돌아오는 아침"을 넘겨 동기화가 이튿날 아침으로 또 간다
  n = night('2026-04-01 22:40', { wake_at: '아침', skip_min: 600 });
  ck('★ 동기화 턴에 "10시 기상"을 600분으로 적어도 04-02 08:00', n.at === '2026-04-02 08:00', n.at);
  ck('그 턴 변화 카드에 보조의 skip_min 줄이 안 남는다', !n.a.out.changeLog.some((c) => c.id === 'skip_min' && c.source === 'llm'), J(n.a.out.changeLog.filter((c) => c.id === 'skip_min')));
  const n600 = night('2026-04-01 22:40', { wake_at: '아침', skip_min: 600 }, null, T0);
  ck('(대조) 버튼을 모르는 엔진이면 04-03 08:00', n600.at === '2026-04-03 08:00', n600.at);
  n = night('2026-04-01 22:40', { wake_at: '아침', skip_min: 30 });
  ck('아침을 안 넘긴 분(30)은 어차피 흡수 — 04-02 08:00', n.at === '2026-04-02 08:00', n.at);
  // 보조가 wake_at을 빠뜨린 🌙 턴 — 날짜만 적어 와도 깃발이 서 있는 동안 그 밤은 동기화 몫
  let a = turn(T, fresh(T, '2026-04-01 22:40'), { press: endId, changes: { skip_day: 1 }, clock: '08:30' });
  ck('★ wake_at을 빠뜨리고 skip_day 1 + "08:30" → 시계는 그대로 22:40 (깃발 중엔 시각을 안 받는다)', when(T, a.st) === '2026-04-01 22:40' && a.st.vars.day_break === true, `${when(T, a.st)} day_break=${a.st.vars.day_break}`);
  let b = turn(T, a.st, { changes: { wake_at: '아침', skip_day: 1 } });
  let at = when(T, engine.sendPhase(T, b.st, { rng: R }).state);
  ck('★ 다음 턴 wake_at(+또 skip_day 1) → 04-02 08:00', at === '2026-04-02 08:00', at);
  // 새벽 🌙에 시각만 먼저 온 턴 — 받으면 08:30으로 간 시계에 동기화가 "다음 08:00"(이튿날)을 또 더한다
  a = turn(T, fresh(T, '2026-04-01 02:00'), { press: endId, clock: '08:30' });
  b = turn(T, a.st, { changes: { wake_at: '아침' } });
  at = when(T, engine.sendPhase(T, b.st, { rng: R }).state);
  ck('★ 새벽 2시 🌙 — 시각이 wake_at보다 먼저 와도 같은 날 08:00', at === '2026-04-01 08:00', at);
  // 버튼 턴엔 밤 장면만, 아침은 다음 턴 (늦게 넘어감)
  a = turn(T, fresh(T, '2026-04-01 22:40'), { press: endId, changes: { skip_min: 30 } });
  b = turn(T, a.st, { changes: { wake_at: '아침', skip_day: 1 } });
  at = when(T, engine.sendPhase(T, b.st, { rng: R }).state);
  ck('★ 버튼 턴엔 밤 장면, 다음 턴에 아침(+skip_day 1) → 04-02 08:00', at === '2026-04-02 08:00', at);
  // 깃발 중 프롬프트 — 시각을 안 묻는다(종전 분 규칙). 동기화 뒤엔 다시 묻는다
  const stF = engine.sendPhase(T, engine.toggleAction(T, fresh(T, '2026-04-01 22:40'), endId).state, { rng: R }).state;
  const pf = engine.buildAuxPrompt(T, stF, '둘은 인사를 나눴다.', '', '');
  ck('★ 깃발 중 프롬프트 — 시각 규칙 없음, 종전 분 규칙', !pf.includes('"clock"에') && pf.includes('새로** 흐른 만큼만 보고하라'), pf);
  const stAfter = engine.sendPhase(T, n.a.st, { rng: R }).state;
  const pa = engine.buildAuxPrompt(T, stAfter, '아침이 밝았다.', '', '');
  ck('동기화 뒤(깃발 내림) — 시각 규칙이 돌아온다', stAfter.vars.day_break === false && pa.includes('"clock"에 "HH:mm"'), `day_break=${stAfter.vars.day_break}`);
  // 버튼과 무관한 평소 턴 — 하루를 그대로 받는다
  const r = turn(T, fresh(T, '2026-04-01 10:00'), { changes: { skip_day: 1 }, clock: '09:00' });
  ck('평소 턴 skip_day 1 + "09:00" → 04-02 09:00 (빼지 않는다)', when(T, r.st) === '2026-04-02 09:00', when(T, r.st));
  // 지연(소급) 경로 — 보조가 늦게 와도 같은 출력의 보고라 같게 뺀다
  const late = turn(T, fresh(T, '2026-04-01 22:40'), { press: endId });
  const am = engine.applyChangesToState(T, late.st, { wake_at: '아침', skip_day: 1 }, {}, null, null, null, null, { clock: '08:00' });
  ck('★ 소급 경로 — skip_day 1 → 0, 시각은 깃발 중이라 안 받는다', am.state.vars.skip_day === 0 && am.state.vars.skip_min === 0, `skip_day=${am.state.vars.skip_day} skip_min=${am.state.vars.skip_min}`);
  b = turn(T, am.state, {});
  at = when(T, engine.sendPhase(T, b.st, { rng: R }).state);
  ck('소급 뒤 다음 턴 동기화 → 04-02 08:00', at === '2026-04-02 08:00', at);
}

console.log('── v1.19.1 🌙 메아리 — 버튼이 시계를 바로 옮기는 봇 (아틀리에 꼴)');
{
  const SA = clone(S); SA.time.pins = [];
  SA.actions = [{ id: 'sleep', label: '🌙 잔다', mode: 'oneshot', dayClose: true,
    effects: [{ set: 'skip_min', expr: '((7 * 60 - (hour * 60 + minute)) + 1439) % 1440 + 1' }] }];
  ck('표본 통과', validateSchema(SA).ok, J(validateSchema(SA).errors));
  let r = turn(SA, fresh(SA, '2026-03-02 23:00'), { press: 'sleep', changes: { skip_day: 1 }, clock: '07:20' });
  ck('★ 23:00 🌙(→ 07:00) + 보조가 그 밤을 또 셈(skip_day 1, "07:20") → 03-03 07:20 (03-04가 아니다)', when(SA, r.st) === '2026-03-03 07:20', when(SA, r.st));
  r = turn(SA, fresh(SA, '2026-03-02 23:00'), { press: 'sleep', clock: '07:20' });
  ck('날짜를 안 세면 그대로 03-03 07:20', when(SA, r.st) === '2026-03-03 07:20', when(SA, r.st));
  r = turn(SA, r.st, { changes: { skip_day: 1 }, clock: '09:00' });
  ck('다음 턴(버튼 안 누름)의 skip_day 1은 그대로 → 03-04 09:00', when(SA, r.st) === '2026-03-04 09:00', when(SA, r.st));
  const st0 = engine.sendPhase(SA, engine.toggleAction(SA, fresh(SA, '2026-03-02 23:00'), 'sleep').state, { rng: R }).state;
  ck('깃발 없는 봇 — 🌙 턴에도 시각을 묻는다 ([지금]이 이미 아침)', engine.buildAuxPrompt(SA, st0, '아침이 밝았다.', '', '').includes('"clock"에 "HH:mm"'), '');
}

console.log('── 정적');
{
  const i535 = src.indexOf('// 5.35 시각 보고'), i54 = src.indexOf('// 5.4 하루 넘김 대리 정산'), i545 = src.indexOf('// 5.45 시간 고정표');
  ck('엔진: 5.35 시각 보고가 하루 넘김(5.4)·고정표(5.45)보다 앞', i535 > 0 && i535 < i54 && i54 < i545, `${i535} ${i54} ${i545}`);
  ck('자정 넘김 한도 6시간', /const CLOCK_CROSS_MAX = 360;/.test(src), '');
  const i533 = src.indexOf('// 5.33 🌙 메아리');
  ck('엔진: 5.33 🌙 메아리가 시각 보고(5.35)보다 앞', i533 > 0 && i533 < i535, `${i533} ${i535}`);
  ck('소급 경로도 메아리를 뺀다', /applyLLMChangesInto\(schema, state, changes, reasons, changeLog, seenText, openIds\);\n  trimDayCloseEcho\(/.test(src), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
