const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.49 시간·날짜 1급 지원 (core/time.js, 설계 docs/design-시간.md)
//
// 배경(실측): 선라이즈 맨션 봇 — 날짜를 day/clock_h/clock_m/sim_* 정수 여러 개로 쪼개
// 손조립했더니 아웃풋마다 하루가 튀었다. LLM은 날짜를 텍스트 한 덩어리로 다루는데
// 개별 정수는 각자 따로 움직여서다. 해법: 내부는 분 단위 epoch 정수 **하나**, 표시는 포맷.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const time = SC.require('time');
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');
const { renderStatusHtml } = SC.require('render');
const { diagnose } = SC.require('diagnose');
const { parsePatch, planPatch } = SC.require('patch');
const { TEMPLATES } = SC.require('templates');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

// ── 1. 달력 산술 (순수 함수) ──────────────────────────────────
{
  const p = time.parseStart('2026-04-01 07:30');
  ck('시작 시점 파싱', J(p) === J({ y: 2026, m: 4, d: 1, h: 7, mi: 30 }), J(p));
  ck('시각 생략은 00:00', J(time.parseStart('2026-04-01')) === J({ y: 2026, m: 4, d: 1, h: 0, mi: 0 }), '');
  ck('존재하지 않는 날짜 거부 (2월 30일)', time.parseStart('2026-02-30') === null, '');
  ck('형식 오류 거부', time.parseStart('작년 봄') === null && time.parseStart('2026/04/01') === null, '');

  const cal = time.calendarOf(time.epochFrom(p));
  ck('★ epoch 왕복 (분까지)', J(cal) === J({ y: 2026, m: 4, d: 1, h: 7, mi: 30, wd: 2 }), J(cal));
  ck('★ 요일 — 2026-04-01은 수요일', cal.wd === 2 && time.DEFAULT_WEEKDAYS[cal.wd] === '수', '');

  // 윤년: 2024는 윤년(2/29 존재), 2026은 평년, 2000은 윤년, 1900은 평년 (100/400 규칙)
  ck('윤년 규칙', time.isLeap(2024) && !time.isLeap(2026) && time.isLeap(2000) && !time.isLeap(1900), '');
  const leap = time.calendarOf(time.epochFrom(time.parseStart('2024-02-28')) + time.MIN_PER_DAY);
  ck('★ 윤년 월말: 2024-02-28 +1일 = 02-29', leap.m === 2 && leap.d === 29, J(leap));
  const noleap = time.calendarOf(time.epochFrom(time.parseStart('2026-02-28')) + time.MIN_PER_DAY);
  ck('평년 월말: 2026-02-28 +1일 = 03-01', noleap.m === 3 && noleap.d === 1, J(noleap));
  const yearEnd = time.calendarOf(time.epochFrom(time.parseStart('2026-12-31 23:59')) + 1);
  ck('★ 연말 자정 넘김: 12-31 23:59 +1분 = 이듬해 01-01 00:00',
    yearEnd.y === 2027 && yearEnd.m === 1 && yearEnd.d === 1 && yearEnd.h === 0 && yearEnd.mi === 0, J(yearEnd));

  // 자릿수 — fmtNum(콤마만)으로는 영영 못 만들던 07:05 (설계 문제 진단 §2)
  const c2 = time.calendarOf(time.epochFrom(time.parseStart('2026-04-01 07:05')));
  ck('★ 자릿수는 포맷이 책임진다 — 07:05', time.formatClock('HH:mm', c2) === '07:05', time.formatClock('HH:mm', c2));
  ck('날짜 포맷 토큰', time.formatDate('YYYY-MM-DD', c2) === '2026-04-01'
    && time.formatDate('YY/M/D', c2) === '26/4/1'
    && time.formatDate('M월 D일', c2) === '4월 1일', '');
  ck('시각 포맷 토큰', time.formatClock('H시 m분', c2) === '7시 5분', '');

  // flat30 판타지 달력 — 한 달 30일 × 12달 = 360일 (베리디아 체계)
  const f = time.calendarOf(time.epochFrom(time.parseStart('0100-01-30', 'flat30'), 'flat30') + time.MIN_PER_DAY, 'flat30');
  ck('flat30 월말: 1-30 +1일 = 2-1', f.m === 2 && f.d === 1, J(f));
  ck('flat30은 2월 30일이 실재한다', time.parseStart('0100-02-30', 'flat30') !== null, '');
  ck('flat30 연말: 12-30 +1일 = 이듬해 1-1',
    (() => { const x = time.calendarOf(time.epochFrom(time.parseStart('0100-12-30', 'flat30'), 'flat30') + time.MIN_PER_DAY, 'flat30');
      return x.y === 101 && x.m === 1 && x.d === 1; })(), '');
}

// ── 2. 스키마 통합 — 실험대: 맨션형 봇 ────────────────────────
const BASE = {
  simcore: '0.1', meta: { name: '시간 실험대' },
  time: {
    start: '2026-04-01 07:30', advance: 'explicit',
    format: { date: 'YYYY-MM-DD', clock: 'HH:mm' },
  },
  vars: [
    { id: 'gold', label: '자금', type: 'int', init: 100, min: 0 },
    { id: 'skip_day', label: '건너뛴 일수', type: 'int', init: 0, min: 0, max: 30 },
    { id: 'skip_min', label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 1440 },
  ],
  derived: [{ id: 'night', label: '밤', expr: 'hour >= 22 or hour < 6' }],
  rules: {
    events: [
      { id: 'rent', when: 'dom == 1 and elapsed > 0', once: true, notify: '월세일이다.', effects: [{ set: 'gold', expr: 'max(gold - 30, 0)' }] },
      { id: 'weekend', when: 'weekday == "토"', once: true, notify: '주말이다.', effects: [] },
    ],
  },
  updater: { allow: [{ id: 'gold', maxDelta: 50 }, { id: 'skip_day', maxGain: 7 }, { id: 'skip_min', maxGain: 720 }] },
  actions: [{ id: 'end_day', label: '🌙 하루를 마친다', effects: [{ set: 'skip_day', expr: '1' }, { set: 'skip_min', expr: '0' }] }],
  statusUI: { groups: [{ label: '시간', items: [{ var: 'date' }, { var: 'clock' }, { var: 'weekday' }, { var: 'gold' }] }] },
  promptState: { template: '[{date} ({weekday}) {clock}] 자금 {gold}' },
};
const clone = (o) => JSON.parse(JSON.stringify(o));

{
  const v = validateSchema(BASE);
  ck('★ 검증 통과 — 노출 이름을 조건식·템플릿·상태창에서 변수처럼', v.ok, J(v.errors));

  let st = engine.initState(BASE);
  ck('초기 epoch = 시작 시점', st.vars.time_epoch === time.epochFrom(time.parseStart('2026-04-01 07:30')), '');
  const look = engine.makeLookup(BASE, st.vars);
  ck('노출 파생 조회', look('date') === '2026-04-01' && look('clock') === '07:30' && look('weekday') === '수'
    && look('dom') === 1 && look('elapsed') === 0 && look('season') === '봄', '');
  ck('일반 파생이 노출 이름을 참조', look('night') === 0, String(look('night')));

  // 보조 보고 경로: skip_min 델타 → outputPhase 소비 → 시각 전진 + 0 리셋
  let o = engine.outputPhase(BASE, st, { skip_min: 90 }, {}, {});
  ck('★ 보조 보고 90분 → 09:00', engine.makeLookup(BASE, o.state.vars)('clock') === '09:00', '');
  ck('소비 후 skip_min = 0', o.state.vars.skip_min === 0, '');
  ck('epoch 변화가 로그에 남는다 (source: time)', o.changeLog.some((c) => c.id === 'time_epoch' && c.source === 'time'), '');

  // 버튼 경로: 🌙 무장 → sendPhase에서 소비 → **이번 프롬프트의 날짜가 이미 새 날**
  let t = engine.toggleAction(BASE, o.state, 'end_day');
  const send = engine.sendPhase(BASE, t.state, {});
  ck('★ 🌙 버튼 하루는 그 턴 프롬프트에 바로 반영', send.promptBlock.includes('[2026-04-02'), send.promptBlock.split('\n')[0]);
  ck('버튼 소비 후 skip_day = 0', send.state.vars.skip_day === 0, '');

  // 며칠 도약: "3일 뒤" — AI는 3만 말하면 된다 (4320분 산술은 시스템 몫)
  o = engine.outputPhase(BASE, send.state, { skip_day: 3 }, {}, {});
  ck('★ 며칠 도약 (skip_day 3)', engine.makeLookup(BASE, o.state.vars)('date') === '2026-04-05', '');
  ck('maxGain 캡이 도약에도 걸린다 (+30 제안 → +7)',
    (() => { const x = engine.outputPhase(BASE, o.state, { skip_day: 30 }, {}, {});
      return engine.makeLookup(BASE, x.state.vars)('date') === '2026-04-12'; })(), '');

  // 날짜 조건 이벤트 — 토요일이 오면 주말, 5/1이 되면 월세
  // (04-05에서 +6 = 04-11 토 · 그다음 +7씩 두 번 = 04-25 · +6 = 05-01)
  const sat = engine.outputPhase(BASE, o.state, { skip_day: 6 }, {}, {}); // 04-05 → 04-11 (토)
  ck('★ weekday 조건 이벤트 발동', sat.firedEvents.includes('weekend'),
    engine.makeLookup(BASE, sat.state.vars)('date') + ' ' + engine.makeLookup(BASE, sat.state.vars)('weekday'));
  let cur = engine.outputPhase(BASE, sat.state, { skip_day: 7 }, {}, {}); // → 04-18
  cur = engine.outputPhase(BASE, cur.state, { skip_day: 7 }, {}, {});     // → 04-25
  const may = engine.outputPhase(BASE, cur.state, { skip_day: 6 }, {}, {}); // → 05-01
  ck('★ dom == 1 월세 이벤트 발동 + 효과', may.firedEvents.includes('rent') && may.state.vars.gold < 100,
    engine.makeLookup(BASE, may.state.vars)('date'));

  // 음수 진행은 무시 — 시간이 뒤로 가면 목록 기한이 어긋난다
  const neg = engine.outputPhase(BASE, may.state, { skip_min: -600 }, {}, {});
  ck('음수 진행 무시', neg.state.vars.time_epoch === may.state.vars.time_epoch, '');

  // 세이브 왕복 + 진행 중 세이브에 나중에 켜기
  const saved = JSON.parse(JSON.stringify(may.state));
  ck('세이브 왕복 — epoch 정수 하나 그대로', saved.vars.time_epoch === may.state.vars.time_epoch, '');
  const oldSave = { vars: { gold: 70 }, meta: { turn: 12 } }; // time 없던 시절 세이브
  const rec = engine.reconcileState(BASE, clone(oldSave));
  ck('★ 구세이브에 시간 켜기 — 시작 시점부터', rec.vars.time_epoch === time.epochFrom(time.parseStart('2026-04-01 07:30')), '');

  // 상태창 — 노출 파생이 라벨과 함께 그려진다
  const html = renderStatusHtml(BASE, may.state, null, null);
  ck('★ 상태창에 날짜·시각·요일', html.includes('날짜') && html.includes('2026-05-01') && html.includes('시각'), '');
}

// ── 3. time 없는 봇은 아무것도 안 바뀐다 (옵트인) ─────────────
{
  const plain = clone(BASE);
  delete plain.time;
  plain.derived = []; // hour 참조 제거
  plain.rules.events = [];
  plain.promptState = { template: '자금 {gold}' };
  plain.statusUI = { groups: [{ label: '재정', items: [{ var: 'gold' }] }] };
  const v = validateSchema(plain);
  ck('time 없으면 검증 그대로', v.ok, J(v.errors));
  const st = engine.initState(plain);
  ck('★ time 없으면 time_epoch 자체가 없다', !('time_epoch' in st.vars), '');
  const o = engine.outputPhase(plain, st, { skip_min: 90 }, {}, {});
  ck('time 없으면 skip 변수도 그냥 변수', o.state.vars.skip_min === 90, '');
}

// ── 4. 검증 — 이름 충돌·형식·입구 ────────────────────────────
{
  const bad = clone(BASE);
  bad.vars.push({ id: 'date', label: '수제 날짜', type: 'text', init: '' });
  const v = validateSchema(bad);
  ck('★ 노출 이름과 변수 충돌 거부', !v.ok && v.errors.some((e) => e.msg.includes("'date'")), J(v.errors));

  const bad2 = clone(BASE);
  bad2.time.start = '2026-13-01';
  ck('불가능한 시작 시점 거부', !validateSchema(bad2).ok, '');

  const bad3 = clone(BASE);
  bad3.time.format = { clock: '시각' }; // 토큰 없음
  ck('토큰 없는 시각 형식 거부', !validateSchema(bad3).ok, '');

  const bad4 = clone(BASE);
  bad4.vars = bad4.vars.filter((x) => !x.id.startsWith('skip_'));
  bad4.updater.allow = bad4.updater.allow.filter((a) => !a.id.startsWith('skip_'));
  bad4.actions = [];
  const v4 = validateSchema(bad4);
  ck('★ explicit인데 진행 입구 없음 → 경고', v4.ok && v4.warnings.some((w) => w.msg.includes('입구')), J(v4.warnings));

  const bad5 = clone(BASE);
  bad5.vars.find((x) => x.id === 'skip_day').type = 'bool';
  bad5.vars.find((x) => x.id === 'skip_day').init = false;
  ck('skip_day가 int가 아니면 오류 (bool 플래그는 캡을 못 건다)', !validateSchema(bad5).ok, '');

  const bad6 = clone(BASE);
  bad6.vars.push({ id: 'time_epoch', label: '예약 키 침범', type: 'int', init: 0 });
  ck('time_epoch 예약 키 침범 거부', !validateSchema(bad6).ok, '');

  const bad7 = clone(BASE);
  bad7.time.expose = ['date', 'timestamp'];
  ck('모르는 노출 이름 거부', !validateSchema(bad7).ok, '');
}

// ── 5. 진단 — explicit이면 하루/턴 가정 (가장 중요한 함정) ────
{
  const d = diagnose(BASE, { turns: 40, runs: 2, actionImpact: false });
  ck('★ 진단이 시간 가정을 명시한다', d.findings.some((f) => f.tag === '시간 가정'), '');
  // 하루/턴 가정 덕에 rent(5/1)·weekend(토)가 40턴 안에 뜬다 — 죽은 이벤트 오탐 0
  ck('★ 날짜 이벤트가 죽은 이벤트로 오탐되지 않는다',
    !d.findings.some((f) => f.tag === '죽은 이벤트' && (f.text.includes("'rent'") || f.text.includes("'weekend'"))),
    J(d.findings.filter((f) => f.tag === '죽은 이벤트').map((f) => f.text)));

  // perTurn(구형)은 소비 배선만으로 하루가 간다 — 진단 가정 불필요
  const pt = clone(BASE);
  pt.time.advance = 'perTurn';
  const d2 = diagnose(pt, { turns: 40, runs: 2, actionImpact: false });
  ck('perTurn은 시간 가정 문구 없음', !d2.findings.some((f) => f.tag === '시간 가정'), '');
  ck('perTurn도 날짜 이벤트 오탐 없음',
    !d2.findings.some((f) => f.tag === '죽은 이벤트' && f.text.includes("'rent'")), '');
}

// ── 6. 패치 경계 — time 섹션은 왕복 패치 미지원 ───────────────
{
  const r = parsePatch(J({ patchVersion: 1, add: { time: { start: '2030-01-01' } } }));
  ck('★ 패치로 time 섹션 못 만진다 (파싱 단계에서 미지원 안내)',
    r.ok === false && r.errors.some((e) => e.includes('time') && e.includes('미지원')), J(r.errors));
}

// ── 7. 번들 — 편집기 시간 탭이 실려 있다 ─────────────────────
{
  ck('★ 번들: 시간 탭', src.includes("['time', '시간']") && src.includes('🕐 시간 체계 켜기'), '');
  ck('번들: 진행 입구 생성 버튼', src.includes('진행 입구 만들기'), '');
  ck('번들: 🌙 액션 추가 버튼', src.includes("'하루를 마친다' 액션 추가"), '');
  ck('번들: 옛 날짜 변수 정리 마법사 연계', src.includes('옛 날짜 변수 정리'), '');
  ck("번들: desc가 규칙의 자리라는 안내 (지시문은 메인 전용)", src.includes('보조 AI가 못 읽는다'), '');
  ck('어댑터 버전은 0.49 이상', /\/\/@version 0\.(49|[5-9]\d)/.test(src), '');
}

// ── 8. 전 템플릿 오탐 0 — time 없는 기존 봇은 진단이 안 바뀐다 ──
{
  let changed = 0;
  for (const [key, t] of Object.entries(TEMPLATES)) {
    if (t.schema.time) continue; // 아직 time 쓰는 템플릿 없음 — 생기면 별도 확인
    const d = diagnose(t.schema, { turns: 30, runs: 2, actionImpact: false });
    if (d.findings.some((f) => f.tag === '시간 가정')) changed++;
  }
  ck('★ time 없는 전 템플릿에 시간 가정 지적 0', changed === 0, String(changed));
}

// ── /날짜 내장 명령 (v0.61.1) — 진행 중 채팅의 시계를 직접 맞추는 직통로 ──
// 배경(실측 문의): "작중은 10월인데 상태창이 3월" — 시계는 세이브(time_epoch)에 살아서
// 시간 탭의 시작값 변경이 소급되지 않고, skip 보고는 캡이 있어 몇 달을 못 건넌다.
{
  const S = {
    simcore: '0.1', meta: { name: '날짜 명령' },
    time: { start: '2026-03-02 08:30', advance: 'explicit' },
    vars: [{ id: 'hp', label: '체력', type: 'int', init: 10, min: 0, max: 20, cmd: '체력' }],
    updater: { allow: [] },
  };
  const st = engine.initState(S);
  const run = (line, state = st) => engine.applyChatCommands(S, state, line, () => 0.5);

  const r1 = run('/날짜 2026-10-05');
  ck('★ /날짜 — epoch가 그 날로 바뀐다', r1.vars.time_epoch !== st.vars.time_epoch
    && J(time.calendarOf(r1.vars.time_epoch).y) === '2026'
    && time.calendarOf(r1.vars.time_epoch).m === 10 && time.calendarOf(r1.vars.time_epoch).d === 5, J(r1.applied));
  ck('★ 시각을 안 적으면 지금 시각(08:30) 유지', time.calendarOf(r1.vars.time_epoch).h === 8
    && time.calendarOf(r1.vars.time_epoch).mi === 30, '');
  ck('시스템 줄로 치환됨', /\(시스템: 날짜 — .*맞춤\)/.test(r1.text), r1.text);

  const r2 = run('/날짜 2026-10-05 21:00');
  ck('시각까지 적으면 그 시각', time.calendarOf(r2.vars.time_epoch).h === 21, '');

  ck('인자 없으면 현재와 사용법 안내', /지금.*\/날짜 2026-10-05/.test(run('/날짜').text), run('/날짜').text);
  ck('없는 날짜는 거부 (2월 30일)', /읽을 수 없음/.test(run('/날짜 2026-02-30').text), '');
  ck('같은 날짜는 변화 없음', /바뀐 것 없음/.test(run('/날짜 2026-03-02 08:30').text), '');

  // 양보 규칙 — 제작자가 '날짜'라는 변수 명령을 만들었다면 그쪽이 이긴다 (/액션과 동일)
  const S2 = JSON.parse(J(S));
  S2.vars.push({ id: 'memo', label: '메모', type: 'text', init: '', cmd: '날짜' });
  const st2 = engine.initState(S2);
  const y = engine.applyChatCommands(S2, st2, '/날짜 개업 기념일', () => 0.5);
  ck('★ 같은 이름의 변수 명령에 양보', y.vars.memo === '개업 기념일' && y.vars.time_epoch === st2.vars.time_epoch, J(y.applied));

  // 시간 체계 없는 봇에서는 내장이 아예 없다 — 유저 글이면 건드리지 않는다
  const S3 = { simcore: '0.1', meta: { name: 'x' }, vars: [{ id: 'hp', type: 'int', init: 1, cmd: '체력' }], updater: { allow: [] } };
  const n = engine.applyChatCommands(S3, engine.initState(S3), '/날짜 2026-10-05', () => 0.5);
  ck('시간 없는 봇은 /날짜를 그대로 둔다', n.text === '/날짜 2026-10-05', n.text);

  // 다른 명령과 한 입력에 섞여도 각자 처리
  const mix = run('/체력 15\n/날짜 2026-12-25');
  ck('변수 명령과 같이 써도 각자 동작', mix.vars.hp === 15 && time.calendarOf(mix.vars.time_epoch).m === 12, '');
}

// ── v0.65 보조에게 시계와 원장을 준다 ──────────────────────
// 실측 제보: 🌙 버튼이 하루를 통째로 넘겨서 대신 "밤까지 잤다"고 썼더니, 그 뒤로 매 동작마다
// 500분씩 밀렸다. 원인은 보조가 **지금 몇 시인지 몰랐다는 것**. "3일 후" 같은 상대량은 글에
// 답이 있어 시계 없이도 되지만 "밤까지"는 목표 시각이라 빼기가 필요한데, 피감수를 안 줬다.
// 게다가 자기가 방금 민 시계를 확인할 방법이 없어 매 턴 처음처럼 같은 간격을 다시 넣었다.
{
  const R2 = TEMPLATES.romance.schema;
  const boot = () => { const s = engine.initState(R2); s.meta.setupDone = true; return s; };
  const prompt = (st, narr = '창밖이 어둑하다.') => engine.buildAuxPrompt(R2, st, narr, null, '');

  // ① [지금] — 시계를 보여 준다
  const p0 = prompt(boot());
  ck('★ 시간 켠 봇의 보조 프롬프트에 [지금] 시각이 실린다', /\[지금\] 3월 2일 \(월\) 08:30/.test(p0), p0.slice(0, 90));
  const noTime = { simcore: '0.1', meta: { name: 'x' }, vars: [{ id: 'hp', label: '체력', type: 'int', init: 10 }], updater: { allow: [{ id: 'hp' }] } };
  ck('시간 안 켠 봇에는 [지금]이 없다', !engine.buildAuxPrompt(noTime, engine.initState(noTime), '싸운다', null, '').includes('[지금]'), '');
  // 브리지는 설치 시점에 한 번 굽고 ⟦cur:id⟧를 schema.vars로만 치환한다 —
  // time_epoch은 그 목록에 없어 치환이 안 되므로 아예 안 싣는다
  const baked = engine.buildAuxPrompt(R2, boot(), '⟦NARR⟧', '⟦USER⟧', '', { allowAll: true });
  ck('★ 루아 브리지 굽기에는 [지금]을 안 싣는다 (치환 안 되는 자리)', !baked.includes('[지금]'), '');

  // ② 시간 규칙 — 보조가 실제로 시간을 만질 수 있을 때만
  ck('skip 우편함이 열려 있으면 시간 규칙이 붙는다', p0.includes('[지금] 시각 이후로'), '');
  const R3 = JSON.parse(J(R2));
  R3.updater.allow = R3.updater.allow.filter((a) => !/^skip_/.test(a.id));
  ck('보조가 시간을 못 만지는 봇엔 시간 규칙을 안 붙인다',
    !engine.buildAuxPrompt(R3, boot(), '창밖이 어둑하다.', null, '').includes('[지금] 시각 이후로'), '');

  // ③ 원장 — 이미 반영된 변화
  let st = boot();
  st = engine.sendPhase(R2, st).state;
  const o1 = engine.outputPhase(R2, st, { skip_min: 500, affection: 5 }, { affection: '도서관에서 웃어 줬다' });
  st = o1.state;
  const memo = st.meta.lastChanges;
  ck('★ 원장이 시각을 절대 시각 두 개로 적는다',
    memo.some((l) => /시각 3월 2일 08:30 → 3월 2일 16:50 \(500분 진행\)/.test(l)), J(memo));
  ck('원장이 변수 변화를 사유까지 적는다',
    memo.some((l) => /호감도 10 → 15 \(\+5\) — 도서관에서 웃어 줬다/.test(l)), J(memo));
  ck('★ skip 우편함 자체는 원장에 안 나온다 (시각 줄과 두 번 말하기 금지)',
    !memo.some((l) => /skip_min|skip_day/.test(l)), J(memo));

  // ④ 다음 턴 프롬프트에 실리고, 다시 세지 말라는 못이 박힌다
  const st2 = engine.sendPhase(R2, st).state;
  const p2 = prompt(st2, '창밖은 어느새 어둑했다. 민서가 하품을 했다.');
  ck('★ 다음 턴 보조 프롬프트에 원장이 실린다', p2.includes('[직전 보조 호출 이후 이미 반영된 변화]'), '');
  ck('★ 500분 밀린 뒤: 지금이 16:50이라는 것과 500분을 이미 썼다는 것이 둘 다 보인다',
    /\[지금\] 3월 2일 \(월\) 16:50/.test(p2) && p2.includes('(500분 진행)'), '');
  ck('원장에는 "다시 세지 마라"가 붙는다', p2.includes('같은 것을 다시 세지 마라'), '');
  ck('브리지 굽기에는 원장을 안 싣는다 (한 번 구운 원장이 영영 거짓말이 된다)',
    !engine.buildAuxPrompt(R2, st2, '⟦NARR⟧', '⟦USER⟧', '', { allowAll: true }).includes('이미 반영된 변화'), '');

  // ⑤ 누적하지 않는다 — 사이클마다 교체 (전송 단계 몫은 이어 붙이고, 응답 단계에서 새로 씀)
  const o2 = engine.outputPhase(R2, st2, { affection: 1 }, {});
  ck('★ 원장은 사이클마다 교체된다 (무한 누적 금지)',
    !o2.state.meta.lastChanges.some((l) => l.includes('500분 진행')), J(o2.state.meta.lastChanges));

  // ⑥ 정기 틱은 뺀다 — 매 턴 같은 줄이라 정보량이 없고, 규칙이 이미 그 몫을 한다
  const TICK = { simcore: '0.1', meta: { name: 't' },
    vars: [{ id: 'gold', label: '돈', type: 'int', init: 0 }, { id: 'mood', label: '기분', type: 'int', init: 0 }],
    rules: { onTurn: [{ set: 'gold', expr: 'gold + 10' }] },
    updater: { allow: [{ id: 'mood' }] } };
  const ts = engine.outputPhase(TICK, engine.sendPhase(TICK, engine.initState(TICK)).state, { mood: 3 }, {});
  ck('정기 틱(onTurn)은 원장에서 뺀다', !ts.state.meta.lastChanges.some((l) => l.includes('돈')), J(ts.state.meta.lastChanges));
  ck('보조가 민 것은 원장에 남는다', ts.state.meta.lastChanges.some((l) => l.includes('기분')), J(ts.state.meta.lastChanges));

  // ⑦ 상한 — 세이브에 매 턴 실리므로 무한정 길어지면 안 된다
  const many = { ...TICK, vars: Array.from({ length: 20 }, (_, i) => ({ id: 'v' + i, label: '값' + i, type: 'int', init: 0 })),
    rules: {}, updater: { allow: Array.from({ length: 20 }, (_, i) => ({ id: 'v' + i })) } };
  const chg = {}; for (let i = 0; i < 20; i++) chg['v' + i] = 1;
  const ms = engine.outputPhase(many, engine.sendPhase(many, engine.initState(many)).state, chg, {});
  ck('원장은 8줄로 끊는다', ms.state.meta.lastChanges.length === 8, String(ms.state.meta.lastChanges.length));
}

// ⚠ 집계는 반드시 맨 끝. 예전엔 이 두 줄이 /날짜 블록 **앞**에 있어서 그 11건이
// 출력도 집계도 안 됐다 — 깨져도 "0 failed"가 나오는, 실패할 수 없는 테스트였다.
let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
