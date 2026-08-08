const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.80 — 실기 제보 두 건.
//
// ① 시작 시각 무작위: 배포된 봇은 새 채팅마다 늘 같은 날 같은 시각에서 시작한다.
//    바꾸려면 플레이어가 시간 탭을 열어야 하는데, 그건 설정을 만질 줄 아는 사람만 쓰는 기능이다.
// ② 리롤해도 랜덤이 그대로: 배선(rerollStableRng)은 처음부터 있었는데 **칸이 없어서**
//    끌 방법이 없었다. 규칙 #3의 재발이고, 검증도 없어 오타가 조용히 무시됐다.
//
// 핵심 불변식은 셋이다:
//   · 판마다 다르다 (안 그러면 기능이 아니다)
//   · 같은 판 안에서는 고정이다 (안 그러면 리롤할 때마다 날짜가 튄다)
//   · rng를 안 주는 호출자(진단·테스트)는 예전 그대로다 (결정적 경로를 안 흔든다)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const time = SC.require('time');
const { validateSchema } = SC.require('validate');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const mk = (startRandom, extra = {}) => ({
  simcore: '0.1', meta: { name: '시각' },
  vars: [{ id: 'x', label: 'x', type: 'int', init: 0 }],
  time: { start: '2026-04-01 07:30', ...(startRandom ? { startRandom } : {}), ...extra },
});
const epochOf = (S, chat) => engine.initState(S, { rng: seededRng(chat, -1, 'start') }).vars.time_epoch;
const calOf = (S, chat) => time.calendarOf(epochOf(S, chat), time.timeConfig(S).calendar);

// ── 굴러가는가 ──
{
  const S = mk({ hour: [6, 22], dom: [1, 31], month: [1, 12] });
  ck('★ 설치 가능', validateSchema(S).ok, JSON.stringify(validateSchema(S).errors));

  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(epochOf(S, `chat${i}`));
  ck('★ 채팅마다 시작 시각이 갈린다', seen.size >= 35, `40판 중 ${seen.size}가지`);

  ck('★ 같은 채팅은 몇 번을 돌려도 같다 (리롤에 안 흔들린다)',
    epochOf(S, 'same') === epochOf(S, 'same'), '');

  ck('★ rng를 안 주면 예전 그대로 start',
    engine.initState(S).vars.time_epoch === time.timeConfig(S).startEpoch, '');
}

// 채운 칸만 굴린다 — 비운 칸은 start 값 고정
{
  const S = mk({ hour: [0, 23] });        // 시각만
  let fixedDate = true, movedHour = new Set();
  for (let i = 0; i < 60; i++) {
    const c = calOf(S, `c${i}`);
    if (!(c.y === 2026 && c.m === 4 && c.d === 1)) fixedDate = false;
    movedHour.add(c.h);
  }
  ck('★ 시각만 켜면 날짜는 start 그대로', fixedDate, '');
  ck('★ 그래도 시각은 갈린다', movedHour.size >= 8, `${movedHour.size}가지`);
  ck('★ 분은 안 켰으므로 start의 30분 고정',
    Array.from({ length: 20 }, (_, i) => calOf(S, `m${i}`).mi).every((mi) => mi === 30), '');
}

// 범위를 벗어나지 않는가 + 없는 날짜가 안 나오는가
{
  const S = mk({ hour: [9, 11], dom: [1, 31], month: [1, 12], year: [2020, 2024] });
  let out = 0, ghost = 0;
  for (let i = 0; i < 500; i++) {
    const c = calOf(S, `g${i}`);
    if (c.h < 9 || c.h > 11 || c.m < 1 || c.m > 12 || c.y < 2020 || c.y > 2024) out++;
    if (c.d > time.daysInMonth(c.y, c.m, 'gregorian')) ghost++;
  }
  ck('★ 500판 전부 지정 범위 안', out === 0, `${out}건 이탈`);
  ck('★ 없는 날짜(2월 31일 등)는 말일로 당겨진다', ghost === 0, `${ghost}건`);
  ck('윤년 2월 29일도 정상 취급', (() => {
    const L = mk({ dom: [29, 29], month: [2, 2], year: [2024, 2024] });   // 2024는 윤년
    return calOf(L, 'leap').d === 29;
  })(), '');
  ck('평년 2월 29일은 28일로', (() => {
    const NL = mk({ dom: [29, 29], month: [2, 2], year: [2025, 2025] });
    return calOf(NL, 'noleap').d === 28;
  })(), '');
}

// flat30 달력
{
  const S = mk({ dom: [1, 31] }, { calendar: 'flat30' });
  const v = validateSchema(S);
  ck('★ flat30에서 31일 범위는 경고 (한 달 30일)',
    v.ok && v.warnings.some((w) => w.path === '$.time.startRandom.dom'), JSON.stringify(v.warnings));
  ck('flat30에서도 없는 날은 안 나온다',
    Array.from({ length: 60 }, (_, i) => calOf(S, `f${i}`).d).every((d) => d >= 1 && d <= 30), '');
}

// ── 검증 ──
{
  const bad = (sr) => validateSchema(mk(sr));
  ck('★ 최소 > 최대는 오류', !bad({ hour: [22, 6] }).ok, '');
  ck('★ 범위 밖은 오류 (시각 25)', !bad({ hour: [0, 25] }).ok, '');
  ck('★ 모르는 칸은 오류', !bad({ hours: [0, 5] }).ok, '');
  ck('★ 숫자 두 개가 아니면 오류', !bad({ hour: [6] }).ok && !bad({ hour: 'a' }).ok, '');
  ck('★ 빈 객체는 경고 (켠 줄 알고 두면 안 굴러간다)', (() => {
    const v = bad({});
    return v.ok && v.warnings.some((w) => w.path === '$.time.startRandom');
  })(), '');
  ck('startRandom이 없으면 아무 말 없음',
    validateSchema(mk(null)).warnings.every((w) => !String(w.path).includes('startRandom')), '');
  ck('배열을 통째로 주면 오류', !validateSchema(mk([1, 2])).ok, '');
}

// ── 리롤 안정 토글 ──
{
  const S = mk(null);
  ck('★ rerollStableRng 검증 존재 (오타가 조용히 무시되지 않는다)',
    !validateSchema({ ...S, rerollStableRng: 'no' }).ok, '');
  ck('true/false는 통과',
    validateSchema({ ...S, rerollStableRng: false }).ok && validateSchema({ ...S, rerollStableRng: true }).ok, '');
  ck('★ 세션이 스키마 값을 읽는다', src.includes("schema.rerollStableRng !== false"), '');
  ck('★ 편집기에 토글 칸이 있다 (규칙 #3)',
    src.includes("'리롤 안정 (기본 켜짐)'") && src.includes('schema.rerollStableRng = on ? undefined : false'), '');
  ck('꺼짐/켜짐 설명이 갈린다', src.includes('리롤할 때마다 랜덤 이벤트·판정이 새로 굴러갑니다')
    && src.includes('같은 눈으로 나옵니다'), '');
}

// ── 편집기 배선 (규칙 #3) ──
{
  ck('★ 시간 탭에 무작위 토글', src.includes("'판마다 시작 시각을 다르게'"), '');
  ck('★ 켜면 시각 범위를 기본으로 채운다 (빈 껍데기 방지)',
    src.includes('T.startRandom = v ? { hour: [6, 22] } : undefined'), '');
  ck('★ 다섯 칸 전부 입력 가능', ['hour', 'minute', 'dom', 'month', 'year']
    .every((k) => new RegExp(`\\['${k}', '`).test(src)), '');
  ck('빈 칸은 고정으로 되돌린다', src.includes('else delete SR[key];'), '');
  ck('빈 껍데기 경고', src.includes('범위가 하나도 없어 지금은 꺼진 것과 같습니다'), '');
}

// ── 세션 배선 ──
{
  ck('★ 새 판 시작에 rng를 넘긴다', src.includes("engine.initState(this.schema, { rng: this._rng(-1, 'start') })"), '');
  ck('★ 판 초기화는 새로 굴린다', src.includes('engine.initState(this.schema, { rng: makeUnstableRng(this.random) })'), '');
  ck('미러 복구는 안 굴린다 (진행 중인 판의 날짜를 새로 지어내면 안 된다)',
    src.includes("require('./engine').initState(this.schema);"), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
