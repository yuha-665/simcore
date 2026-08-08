// 시간·날짜 1급 지원 — epoch(분)↔달력 순수 함수 + 포맷터 (설계: docs/design-시간.md)
//
// 원칙: 내부는 정수 하나(분 단위 epoch), 표시는 포맷이 책임진다. 달력 산술(윤년·월별
// 일수·요일)은 전부 여기서 한다 — AI에게도, 제작자의 파생식에게도 날짜 계산을 안 시킨다.
//
// epoch 기준: 그레고리력은 1970-01-01 00:00 = 0 (그 전은 음수).
// flat30(판타지 달력: 한 달 30일 × 12달 = 360일)은 0001-01-01 00:00 = 0.
// 저장은 세이브의 vars.time_epoch 한 칸 — 스키마 vars가 아니라 엔진이 관리하는 예약 키다.

const MIN_PER_DAY = 1440;

// 스키마에 안 적었을 때의 기본값들 — 검증·엔진·편집기가 같은 것을 봐야 어긋나지 않는다
const DEFAULT_WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']; // [0] = 월요일 고정
const DEFAULT_SEASONS = ['봄', '여름', '가을', '겨울'];              // 3~5월 / 6~8 / 9~11 / 12~2
const DEFAULT_DATE_FMT = 'YYYY-MM-DD';
const DEFAULT_CLOCK_FMT = 'HH:mm';
const DEFAULT_EXPOSE = ['date', 'clock', 'weekday', 'season', 'month', 'dom', 'hour', 'minute', 'elapsed'];
const EXPOSABLE = ['date', 'clock', 'weekday', 'season', 'year', 'month', 'dom', 'hour', 'minute', 'elapsed'];

// 진행 입구 — 이 이름의 int 변수가 있으면 엔진이 매 턴 소비한다 (설계 §진행 — 두 입구)
const SKIP_DAY = 'skip_day';
const SKIP_MIN = 'skip_min';
const EPOCH_KEY = 'time_epoch';

// ── 달력 산술 (그레고리력: Howard Hinnant civil-from-days, 음수 안전) ──

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y, m, calendar) {
  if (calendar === 'flat30') return 30;
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

// ── 시작 시점 파싱 ──────────────────────────────────────────

/**
 * "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm" → { y, m, d, h, mi } / 형식이 틀리면 null.
 * 시각을 안 적으면 00:00. 존재하지 않는 날짜(2월 30일 등)도 null — 검증이 그대로 알려 준다.
 */
function parseStart(str, calendar = 'gregorian') {
  const m = String(str ?? '').trim()
    .match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?$/);
  if (!m) return null;
  const [, ys, ms, ds, hs, mis] = m;
  const y = Number(ys), mo = Number(ms), d = Number(ds);
  const h = hs != null ? Number(hs) : 0, mi = mis != null ? Number(mis) : 0;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo, calendar)) return null;
  if (h > 23 || mi > 59) return null;
  return { y, m: mo, d, h, mi };
}

/** 달력 성분 → epoch 분 */
function epochFrom(parts, calendar = 'gregorian') {
  const days = calendar === 'flat30'
    ? (parts.y - 1) * 360 + (parts.m - 1) * 30 + (parts.d - 1)
    : daysFromCivil(parts.y, parts.m, parts.d);
  return days * MIN_PER_DAY + parts.h * 60 + parts.mi;
}

/** epoch 분 → 달력 성분 { y, m, d, h, mi, wd } (wd: 0=월 … 6=일) */
function calendarOf(epoch, calendar = 'gregorian') {
  const days = Math.floor(epoch / MIN_PER_DAY);
  const rem = epoch - days * MIN_PER_DAY; // floor라 음수 epoch에서도 0~1439
  let y, m, d;
  if (calendar === 'flat30') {
    const yd = Math.floor(days / 360);
    const doy = days - yd * 360;
    y = yd + 1; m = Math.floor(doy / 30) + 1; d = (doy % 30) + 1;
  } else {
    ({ y, m, d } = civilFromDays(days));
  }
  // 1970-01-01은 목요일 — 월요일 기준 인덱스로 3. flat30은 0001-01-01을 월요일로 친다.
  const wd = calendar === 'flat30'
    ? ((days % 7) + 7) % 7
    : ((days % 7) + 7 + 3) % 7;
  return { y, m, d, h: Math.floor(rem / 60), mi: rem % 60, wd };
}

// ── 포맷터 — 자릿수는 여기가 책임진다 (fmtNum의 콤마와 무관) ──

const pad2 = (n) => String(n).padStart(2, '0');

const DATE_TOKEN = /YYYY|YY|MM|M|DD|D/g;
const CLOCK_TOKEN = /HH|H|mm|m/g;

function formatDate(fmt, cal) {
  return String(fmt).replace(DATE_TOKEN, (t) => {
    switch (t) {
      case 'YYYY': return String(cal.y).padStart(4, '0');
      case 'YY': return pad2(((cal.y % 100) + 100) % 100);
      case 'MM': return pad2(cal.m);
      case 'M': return String(cal.m);
      case 'DD': return pad2(cal.d);
      case 'D': return String(cal.d);
    }
    return t;
  });
}

function formatClock(fmt, cal) {
  return String(fmt).replace(CLOCK_TOKEN, (t) => {
    switch (t) {
      case 'HH': return pad2(cal.h);
      case 'H': return String(cal.h);
      case 'mm': return pad2(cal.mi);
      case 'm': return String(cal.mi);
    }
    return t;
  });
}

// ── 스키마 time 섹션 해석 ───────────────────────────────────

/** 스키마의 time 섹션을 기본값 채워 돌려준다. time이 없으면 null — 아무것도 안 바뀐다. */
function timeConfig(schema) {
  const t = schema?.time;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const calendar = t.calendar === 'flat30' ? 'flat30' : 'gregorian';
  const parts = parseStart(t.start, calendar) ?? { y: 2026, m: 1, d: 1, h: 9, mi: 0 };
  return {
    calendar,
    start: parts,
    startEpoch: epochFrom(parts, calendar),
    advance: t.advance === 'perTurn' ? 'perTurn' : 'explicit',
    dateFmt: typeof t.format?.date === 'string' ? t.format.date : DEFAULT_DATE_FMT,
    clockFmt: typeof t.format?.clock === 'string' ? t.format.clock : DEFAULT_CLOCK_FMT,
    weekdays: Array.isArray(t.weekdays) && t.weekdays.length === 7 ? t.weekdays.map(String) : DEFAULT_WEEKDAYS,
    seasons: Array.isArray(t.seasons) && t.seasons.length === 4 ? t.seasons.map(String) : DEFAULT_SEASONS,
    expose: Array.isArray(t.expose)
      ? t.expose.filter((n) => EXPOSABLE.includes(n))
      : DEFAULT_EXPOSE,
    startRandom: normStartRandom(t.startRandom),   // 없으면 null = 늘 start에서 시작 (v0.80)
  };
}

// ── 시작 시각 무작위 (v0.80) ────────────────────────────────
// 배포된 봇은 새 채팅마다 늘 같은 날 같은 시각에서 시작한다. 그걸 바꾸려면 제작자가 아니라
// **플레이어가** 시간 탭을 열어야 하는데, 그건 설정을 만질 줄 아는 사람만 쓰는 기능이 된다
// (실기 제보). 범위를 정해 두면 판마다 시작점이 달라진다.
//
// 칸마다 따로 켠다 — "시각만 무작위, 날짜는 고정"이 가장 흔한 쓰임이라 전부 아니면 전무는 안 된다.
// 안 켠 칸은 start의 값을 그대로 쓴다.
const RANDOM_FIELDS = { year: 'y', month: 'm', dom: 'd', hour: 'h', minute: 'mi' };
const RANDOM_BOUNDS = { year: [1, 9999], month: [1, 12], dom: [1, 31], hour: [0, 23], minute: [0, 59] };

/** startRandom 정규화 — 쓸 수 있는 범위만 남긴다. 하나도 없으면 null(꺼짐) */
function normStartRandom(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of Object.keys(RANDOM_FIELDS)) {
    const r = raw[key];
    if (!Array.isArray(r) || r.length !== 2) continue;
    const lo = Math.floor(Number(r[0])), hi = Math.floor(Number(r[1]));
    if (!isFinite(lo) || !isFinite(hi) || lo > hi) continue;
    const [bl, bh] = RANDOM_BOUNDS[key];
    out[key] = [Math.max(bl, lo), Math.min(bh, hi)];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 시작 시점을 굴린다. rng가 없으면(진단·테스트) start 그대로 — 결정적 경로를 안 흔든다.
 * 세션은 chatId로 시드를 만들므로 **같은 채팅이면 늘 같은 시각, 새 채팅이면 새 시각**이다.
 */
function rollStart(cfg, rng) {
  const R = cfg?.startRandom;
  if (!R || typeof rng !== 'function') return cfg.start;
  const pick = ([lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));
  const p = { ...cfg.start };
  for (const [key, slot] of Object.entries(RANDOM_FIELDS)) if (R[key]) p[slot] = pick(R[key]);
  // 말일 보정 — 2월 30일처럼 없는 날이 나오면 그 달 마지막 날로 당긴다 (범위를 1~31로 둬도 안전)
  const dmax = daysInMonth(p.y, p.m, cfg.calendar);
  if (p.d > dmax) p.d = dmax;
  return p;
}

/** 월 → 계절 인덱스 (0봄 1여름 2가을 3겨울) */
function seasonIndex(month) {
  if (month >= 3 && month <= 5) return 0;
  if (month >= 6 && month <= 8) return 1;
  if (month >= 9 && month <= 11) return 2;
  return 3;
}

/**
 * 노출 파생 전부 계산 — makeLookup·상태창·진단이 같은 것을 본다.
 * @param cfg timeConfig() 결과
 * @param epoch 현재 epoch 분 (vars.time_epoch)
 */
function exposedValues(cfg, epoch) {
  const e = typeof epoch === 'number' && isFinite(epoch) ? epoch : cfg.startEpoch;
  const cal = calendarOf(e, cfg.calendar);
  const all = {
    date: formatDate(cfg.dateFmt, cal),
    clock: formatClock(cfg.clockFmt, cal),
    weekday: cfg.weekdays[cal.wd],
    season: cfg.seasons[seasonIndex(cal.m)],
    year: cal.y,
    month: cal.m,
    dom: cal.d,
    hour: cal.h,
    minute: cal.mi,
    elapsed: Math.floor(e / MIN_PER_DAY) - Math.floor(cfg.startEpoch / MIN_PER_DAY),
  };
  const out = {};
  for (const n of cfg.expose) out[n] = all[n];
  return out;
}

/** 상태창·편집기용 노출 파생 의사 정의 — label과 type만 있으면 렌더러가 나머지를 안다 */
const EXPOSED_LABELS = {
  date: '날짜', clock: '시각', weekday: '요일', season: '계절', year: '연도',
  month: '월', dom: '일', hour: '시', minute: '분', elapsed: '경과일',
};

function exposedDefs(schema) {
  const cfg = timeConfig(schema);
  if (!cfg) return [];
  return cfg.expose.map((n) => ({
    id: n,
    label: EXPOSED_LABELS[n] ?? n,
    type: ['date', 'clock', 'weekday', 'season'].includes(n) ? 'text' : 'int',
  }));
}

module.exports = {
  MIN_PER_DAY, EXPOSABLE, DEFAULT_EXPOSE, DEFAULT_WEEKDAYS, DEFAULT_SEASONS,
  DEFAULT_DATE_FMT, DEFAULT_CLOCK_FMT, SKIP_DAY, SKIP_MIN, EPOCH_KEY, EXPOSED_LABELS,
  parseStart, epochFrom, calendarOf, isLeap, daysInMonth, seasonIndex, rollStart, normStartRandom, RANDOM_BOUNDS,
  formatDate, formatClock, timeConfig, exposedValues, exposedDefs,
};
