// 사건 게이지 (rules.randomEvents.gauge) — 보이지 않는 게이지가 차면 사건이 온다 (v1.14.0, 유저 제안 2026-09-27)
//
// 옛 방식(chancePerTurn)은 **턴마다** 한 번 굴린다. 그래서 작중 시간이 아니라 채팅 속도가 빈도를 정했다 —
// 베리디아 실측(보통): 하루에 세 턴을 쓰면 한 해 나쁜 일 26번, 하루 한 턴이면 10번, 닷새에 한 턴이면 2번.
// 항목 쿨다운도 턴이라 하루 세 턴 판에선 같은 사건이 세 배 자주 돌아왔다. 굴림이라 몰리고 비는 폭도 크다(기하 분포).
//
// 게이지 = 숨은 수치 하나(re_gauge, 0~100).
//   - **작중 시간으로 찬다** — 하루당 perDay(시간 체계의 turn_min 기준: 대화만 한 턴은 0, "한 달 뒤"는 한 달치) + 턴당 perTurn.
//     시간 체계가 없으면 한 턴 = 하루. 식이면 매 턴 현 상태로 평가한다 — 서사가 만든 상태(위협·불안·난이도)가 속도를 민다.
//   - 흔들림 jitter — 차는 양에 ×(1−j ~ 1+j). 박자는 있되 달력처럼 딱 맞지는 않게.
//   - **100이 되면 터진다** — 지금 후보(조건·항목 쿨다운 통과) 중 weight 비례로 하나. 게이지는 0으로,
//     그리고 cooldown(날 — 시간 체계가 없으면 턴) 동안은 안 찬다(re_cool).
//   - 후보가 하나도 없으면 **안 찬다** — 재해가 이어지는 동안 모든 사건을 막는 봇이면 그동안 멈췄다가 끝나면 이어서 찬다.
//     막힌 사이에 100을 채워 두었다가 풀리자마자 터뜨리지 않는다.
//   - 서사의 개입은 효과 `{ gauge: 식 }` — 선택지·액션·이벤트가 게이지를 당기거나(+) 늦춘다(−). 0~100으로 잘린다.
//   - 항목 cooldown도 게이지 모드에선 **날** 단위(시간 체계가 있을 때) — 마지막 발동 시각(meta.eventLastAt, epoch 분)으로 잰다.
//
// 예약 키 (vars에 산다 — scn_idx·fr_*와 같은 계열. 패널 현황 탭은 스키마 vars만 그리므로 안 보이고,
// 스냅샷·체크포인트 되감기가 같이 되감는다): re_gauge (0~100), re_cool (남은 식힘 — 날 또는 턴).
// 보조 AI는 못 만진다(allow에 못 올린다). 조건식은 읽는다 — `re_gauge >= 80`으로 전조 지시문을 걸 수 있다.
// 변화 원장에는 안 남긴다 — 변화 로그·하이라이트·보조 원장 어디에도 게이지가 새지 않는다(보이지 않는 게 요점).

const { evaluate } = require('./expr');

const GAUGE_KEY = 're_gauge';
const COOL_KEY = 're_cool';
const GAUGE_MAX = 100;
const DEFAULT_JITTER = 0.5;
const RESERVED = [GAUGE_KEY, COOL_KEY];

const isRate = (x) => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '');
// 부동소수 찌꺼기 정리 — 99.99999999 때문에 100 문턱이 한 턴 늦지 않게
const tidy = (v) => Math.round(v * 1e6) / 1e6;

/** 정규화된 게이지 설정 — 없으면 null (옛 방식 chancePerTurn). 검증은 validate 몫, 여기는 방어 정규화만 */
function gaugeConfig(schema) {
  const g = schema?.rules?.randomEvents?.gauge;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  const j = Number(g.jitter);
  const cd = Number(g.cooldown);
  return {
    perDay: isRate(g.perDay) ? g.perDay : 0,
    perTurn: isRate(g.perTurn) ? g.perTurn : 0,
    jitter: g.jitter == null ? DEFAULT_JITTER : (Number.isFinite(j) ? Math.max(0, Math.min(1, j)) : DEFAULT_JITTER),
    cooldown: Number.isFinite(cd) && cd > 0 ? cd : 0,
  };
}

/** 예약 이름들 — 검증이 조건식 이름표에 등록하고 변수 id 충돌을 막는다 */
function gaugeExposedNames(schema) { return gaugeConfig(schema) ? RESERVED.slice() : []; }

/** 진행 중 세이브에 나중에 켜도 안전하게 — 없는 키만 0으로 */
function ensureGaugeKeys(schema, vars) {
  if (!gaugeConfig(schema)) return;
  if (typeof vars[GAUGE_KEY] !== 'number') vars[GAUGE_KEY] = 0;
  if (typeof vars[COOL_KEY] !== 'number') vars[COOL_KEY] = 0;
}

const isGaugeEffect = (rule) => !!rule && typeof rule === 'object' && rule.gauge !== undefined;

const rateOf = (r, lookup) => {
  let n = 0;
  try { n = Number(typeof r === 'number' ? r : evaluate(r, lookup, null)); } catch { n = 0; } // 깨진 식은 0 (검증이 미리 잡는다)
  return Number.isFinite(n) ? n : 0;
};

/** 효과 `{ gauge: 식 }` — applySets가 부른다. 0~100으로 자른다. 원장엔 안 남긴다(보이지 않는 게 요점) */
function applyGaugeEffect(schema, vars, rule, lookup, rng) {
  if (!gaugeConfig(schema)) return;
  let d;
  try { d = Number(evaluate(String(rule.gauge), lookup, rng)); } catch { return; }
  if (!Number.isFinite(d) || d === 0) return;
  vars[GAUGE_KEY] = tidy(Math.max(0, Math.min(GAUGE_MAX, (Number(vars[GAUGE_KEY]) || 0) + d)));
}

/**
 * 이번 턴에 차는 양 — perDay × 흐른 날 + perTurn, 흔들림을 곱한다. 음수는 0 (게이지를 되돌리는 건 효과의 몫).
 * @param days 이번 정산에서 흐른 작중 일수 (시간 체계 없으면 1) — 식힘이 도중에 끝난 턴이면 남은 날만
 * @param withTurn perTurn을 얹나 — 식힘으로 시작한 턴은 안 얹는다 (그 턴은 식힘의 몫)
 */
function fillAmount(cfg, lookup, days, rng, withTurn = true) {
  const base = rateOf(cfg.perDay, lookup) * Math.max(0, Number(days) || 0) + (withTurn ? rateOf(cfg.perTurn, lookup) : 0);
  if (!(base > 0)) return 0;
  const k = cfg.jitter > 0 && typeof rng === 'function' ? 1 - cfg.jitter + 2 * cfg.jitter * rng() : 1;
  return base * k;
}

/** 평균 며칠(턴)에 한 번 터지나 — 식이 아닌 숫자 설정일 때만 (편집기 미리보기용). 후보가 늘 있다고 친 근사 */
function meanInterval(cfg, lookup = () => 0) {
  const perDay = rateOf(cfg.perDay, lookup), perTurn = rateOf(cfg.perTurn, lookup);
  return { perDay, perTurn, days: perDay > 0 ? GAUGE_MAX / perDay + cfg.cooldown : null, turns: perTurn > 0 ? GAUGE_MAX / perTurn : null };
}

module.exports = {
  GAUGE_KEY, COOL_KEY, GAUGE_MAX, DEFAULT_JITTER, RESERVED,
  gaugeConfig, gaugeExposedNames, ensureGaugeKeys, isGaugeEffect, applyGaugeEffect, fillAmount, meanInterval, tidy,
};
