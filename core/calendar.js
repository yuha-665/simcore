// 달력 패널 — 게임 패널 2호 (v0.61). 월 그리드 + 기한·기념일 마킹 + 날짜 클릭 일정 등록.
//
// 원칙: **새 저장소를 만들지 않는다** — 일정 = 평범한 list 변수 항목 + `@기한` 규약 재사용.
// 그래서 공짜로 따라오는 것들:
//   (1) 지난 일정 자동 정리 = 기존 onTurn expire 규칙
//   (2) AI가 서사로 일정 잡기 = updater.allow + `@+N` 상대 기한 (엔진이 절대값으로 굳힘)
//   (3) 조건식 연동 = has(약속, "축제") — 일정이 이벤트·지시문·showWhen의 재료가 된다
// 시간 산술은 전부 time.js 몫 — 여기서는 셀 배치와 마킹 대조만 한다. 상태를 바꾸는 것은
// 일정 등록/삭제뿐이고, 그마저 "바뀔 목록 연산"만 돌려준다 (적용은 호스트 — party와 같은 계약).
//
// `@값`의 단위 문제: 항목의 @D는 그 목록을 만료시키는 expire 식의 단위로 적혀 있다
// (engine.resolveRelativeExpiry와 같은 원칙 — 등록과 만료를 같은 시계로 잰다).
// 그래서 날짜↔@D 변환은 [절대일 = 오늘절대일 + (D − 지금의 expire 식 값)]으로 잇고,
// expire 규칙이 없는 목록만 elapsed(시작부터 경과일) 규약으로 간주한다.

const { timeConfig, calendarOf, epochFrom, daysInMonth, MIN_PER_DAY, EPOCH_KEY } = require('./time');
const { itemExpiry } = require('./expr');

function dayIdx(epochMin) { return Math.floor(epochMin / MIN_PER_DAY); }

/** 달력 설정 (시간 체계가 꺼져 있으면 null — 달력은 시계 위에서만 선다) */
function calendarConfig(schema) {
  const c = schema?.calendar;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  if (!timeConfig(schema)) return null;
  return c;
}

/** 사이드바 버튼 사양 — 어댑터가 registerButton에 그대로 쓴다 (party와 같은 계약) */
function calendarButtonSpec(schema) {
  const c = calendarConfig(schema);
  if (!c) return null;
  return { label: c.label ?? '달력', icon: c.icon ?? '📅' };
}

/** 항목에서 기한 표기를 걷어낸 표시용 라벨 ("영화 약속 @12" → "영화 약속") */
function planLabel(item) {
  return String(item).replace(/@\+?\d+(?:\.\d+)?/g, '').trim();
}

// 이 목록의 expire 식이 지금 가리키는 값 — @D와 같은 단위의 "현재". 규칙이 없거나
// 평가가 안 되면 null (호출부가 elapsed 규약으로 폴백).
function expireNow(schema, state, listId) {
  const rule = (schema.rules?.onTurn || []).find((r) => r && r.list === listId && r.expire);
  if (!rule) return null;
  try {
    const { evaluate } = require('./expr');
    const { makeLookup } = require('./engine');   // 지연 require — 번들 순서 무관
    const v = Number(evaluate(rule.expire, makeLookup(schema, state.vars), null));
    return isFinite(v) ? v : null;
  } catch { return null; }
}

/**
 * 한 달치 그리기 재료. 상태를 바꾸지 않는다.
 * opts { year, month } — 생략하면 오늘이 든 달.
 * 반환: { year, month, label, weekdays, lead, today: {y,m,d}, canRegister, listLabel,
 *         prev: {year,month}, next: {year,month},
 *         cells: [{ dom, weekday, today, marks: [{kind:'mark'|'plan'|'due', label, note?, from?, item?}] }] }
 */
function monthView(schema, state, opts = {}) {
  const c = calendarConfig(schema);
  if (!c) return null;
  const cfg = timeConfig(schema);
  const epoch = Number(state.vars?.[EPOCH_KEY] ?? cfg.startEpoch);
  const today = calendarOf(epoch, cfg.calendar);
  const y = opts.year ?? today.y;
  const m = opts.month ?? today.m;
  const dim = daysInMonth(y, m, cfg.calendar);
  const todayDay = dayIdx(epoch);
  const startDay = dayIdx(cfg.startEpoch);
  const absOf = (d) => dayIdx(epochFrom({ y, m, d, h: 0, mi: 0 }, cfg.calendar));
  const byId = Object.fromEntries((schema.vars || []).map((v) => [v.id, v]));

  // 절대일 → 그 칸에 붙을 마크들
  const byDay = new Map();
  const put = (absDay, mark) => {
    if (!byDay.has(absDay)) byDay.set(absDay, []);
    byDay.get(absDay).push(mark);
  };

  // ① 일정 (calendar.list) — 유저·AI가 등록한 항목
  if (c.list) {
    const items = state.vars?.[c.list] ?? byId[c.list]?.init ?? [];
    const now = expireNow(schema, state, c.list);
    for (const it of (Array.isArray(items) ? items : [])) {
      const D = itemExpiry(it);
      if (D == null) continue;   // 기한 없는 항목은 달력에 못 앉는다 (목록에는 그대로 있다)
      const absDay = now != null ? todayDay + Math.round(D - now) : startDay + Math.round(D);
      put(absDay, { kind: 'plan', label: planLabel(it), item: String(it) });
    }
  }
  // ② 기한 (다른 목록의 @기한 — 계약 만료·버프 종료가 달력에 저절로 보인다)
  for (const rule of (schema.rules?.onTurn || [])) {
    if (!rule || !rule.list || !rule.expire || rule.list === c.list) continue;
    const now = expireNow(schema, state, rule.list);
    if (now == null) continue;
    const items = state.vars?.[rule.list] ?? byId[rule.list]?.init ?? [];
    for (const it of (Array.isArray(items) ? items : [])) {
      const D = itemExpiry(it);
      if (D == null) continue;
      put(todayDay + Math.round(D - now), {
        kind: 'due', label: planLabel(it), from: byId[rule.list]?.label ?? rule.list,
      });
    }
  }

  const marks = Array.isArray(c.marks) ? c.marks : [];
  const cells = [];
  for (let d = 1; d <= dim; d++) {
    const wd = calendarOf(epochFrom({ y, m, d, h: 0, mi: 0 }, cfg.calendar), cfg.calendar).wd;
    const cellMarks = [];
    // ③ 제작자 기념일 — 적힌 성분이 전부 맞아야 그 칸 (month+dom=매년, dom만=매달, weekday만=매주)
    for (const mk of marks) {
      if (!mk || !mk.label) continue;
      if (mk.month != null && mk.month !== m) continue;
      if (mk.dom != null && mk.dom !== d) continue;
      if (mk.weekday != null && cfg.weekdays[wd] !== mk.weekday) continue;
      if (mk.month == null && mk.dom == null && mk.weekday == null) continue;
      cellMarks.push({ kind: 'mark', label: mk.label, note: mk.note ?? null });
    }
    cellMarks.push(...(byDay.get(absOf(d)) ?? []));
    cells.push({
      dom: d, weekday: wd,
      today: y === today.y && m === today.m && d === today.d,
      marks: cellMarks,
    });
  }

  return {
    year: y, month: m, label: `${y}년 ${m}월`,
    weekdays: cfg.weekdays, lead: cells[0]?.weekday ?? 0,
    today: { y: today.y, m: today.m, d: today.d },
    canRegister: !!c.list, listLabel: c.list ? (byId[c.list]?.label ?? c.list) : null,
    prev: m <= 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 },
    next: m >= 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 },
    cells,
  };
}

/**
 * 일정 등록 — 바뀔 목록 연산만 돌려준다 (적용은 호스트).
 * 반환: { ok, listId, item } | { ok: false, reason }
 */
function addPlan(schema, state, { year, month, dom, label }) {
  const c = calendarConfig(schema);
  if (!c) return { ok: false, reason: '달력이 정의되지 않음' };
  if (!c.list) return { ok: false, reason: '일정 목록(list)이 지정되지 않음 — 보기 전용 달력' };
  const cfg = timeConfig(schema);
  const def = (schema.vars || []).find((v) => v.id === c.list);
  // '@'는 기한 표기 문자라 라벨에서 걷어낸다 — 안 걷으면 itemExpiry가 엉뚱한 걸 기한으로 읽는다
  const name = String(label ?? '').replace(/@/g, '').trim();
  if (!name) return { ok: false, reason: '일정 내용을 적어 주세요' };
  if (dom < 1 || dom > daysInMonth(year, month, cfg.calendar)) {
    return { ok: false, reason: `${year}년 ${month}월에 ${dom}일은 없어요` };
  }
  const epoch = Number(state.vars?.[EPOCH_KEY] ?? cfg.startEpoch);
  const todayDay = dayIdx(epoch);
  const targetDay = dayIdx(epochFrom({ y: year, m: month, d: dom, h: 0, mi: 0 }, cfg.calendar));
  if (targetDay < todayDay) return { ok: false, reason: '지난 날짜에는 등록할 수 없어요' };
  const now = expireNow(schema, state, c.list);
  const D = now != null
    ? Math.round(now + (targetDay - todayDay))
    : targetDay - dayIdx(cfg.startEpoch);
  const item = `${name} @${D}`;
  const cur = state.vars?.[c.list] ?? def?.init ?? [];
  if (def?.maxItems && cur.length >= def.maxItems) {
    return { ok: false, reason: `일정이 가득 찼어요 (최대 ${def.maxItems}개)` };
  }
  // coerce의 길이 자르기에 맡기면 `@D`가 잘려 무기한 일정이 된다 — 여기서 막는다
  if (def?.itemMaxLength && item.length > def.itemMaxLength) {
    return { ok: false, reason: `내용이 너무 길어요 (기한 표기 포함 ${def.itemMaxLength}자까지)` };
  }
  return { ok: true, listId: c.list, item };
}

/** 일정 삭제 — 달력이 등록한 목록의 항목만, 정확히 일치할 때만 */
function removePlan(schema, state, item) {
  const c = calendarConfig(schema);
  if (!c?.list) return { ok: false, reason: '일정 목록이 없음' };
  const def = (schema.vars || []).find((v) => v.id === c.list);
  const cur = state.vars?.[c.list] ?? def?.init ?? [];
  if (!Array.isArray(cur) || !cur.includes(String(item))) {
    return { ok: false, reason: '이미 없는 일정이에요' };
  }
  return { ok: true, listId: c.list, item: String(item) };
}

module.exports = { calendarConfig, calendarButtonSpec, monthView, addPlan, removePlan, planLabel };
