// SimCore 엔진 — 턴 처리의 심장. 전부 순수 함수 (호스트 의존성 없음).
//
// 상태(state) 구조:
// {
//   vars: { id: value, ... },                // 스키마 vars의 현재 값
//   meta: {
//     turn: 0,                               // 엔진 내부 턴 카운터 (output 처리 횟수)
//     armed: { actionId: true },             // 무장된 액션
//     actionLastUsed: { actionId: turn },    // 액션 쿨다운 기준점
//     eventLastFired: { eventId: turn },     // 이벤트 쿨다운 기준점
//     firedOnce: { eventId: true },          // once 이벤트 기록
//     pendingNotifies: [ '...' ],            // 다음 전송에 실릴 이벤트 통지
//   }
// }

const { compile, evaluate, truthy, itemExpiry, itemValue } = require('./expr');
const { mainInjectionText, auxImageSpec } = require('./assets');
const { timeConfig, exposedValues, parseStart, epochFrom, calendarOf, formatDate, formatClock,
  MIN_PER_DAY, SKIP_DAY, SKIP_MIN, EPOCH_KEY, rollStart } = require('./time');

const DEFAULT_TEXT_MAXLEN = 200;
const DEFAULT_SYSTEM_GUIDE =
  '수치·상태는 시스템이 관리한다. 본문에 상태창이나 수치 표를 직접 쓰지 말고 서사에만 집중하라.';

/**
 * 이벤트가 발동한 턴에만 덧붙는 충돌 해소 규칙.
 * 이벤트는 엔진이 이미 확정하고 수치까지 반영한 사실이라, 서사가 이를 무시하면
 * 숫자와 이야기가 어긋난다. 그렇다고 "유저 입력보다 무조건 우선"이라고 하면
 * 모델이 유저 행동을 통째로 버려 조작감이 사라진다. 그래서
 * "사건은 확정, 유저 행동은 시도" 로 층을 나눠 둘 다 살린다.
 */
const DEFAULT_EVENT_PRIORITY =
  '※ 위 [이벤트]는 시스템이 이미 확정해 수치까지 반영한 사실이다. 일어나지 않은 것처럼 쓰거나 미루지 말고 이번 서사에 반드시 드러내라. '
  + '유저의 행동과 양립하지 않으면, 유저의 행동은 그대로 "시도"하게 두되 그 결과를 이 사건이 바꾸도록 전개하라 '
  + '(유저의 행동 자체를 없던 일로 만들지는 마라).';

// 판정([판정] 줄)이 실제로 있는 턴에만 덧붙는다 — eventPriority와 같은 절약 원칙.
// 이 한 줄이 없으면 모델이 "17이 나왔지만 아슬아슬하게 실패했다"처럼 결과를 뒤집어 쓴다.
const DEFAULT_CHECK_GUIDE =
  '※ 위 [판정]은 시스템이 주사위로 확정한 결과다. 성공을 실패로, 실패를 성공으로 뒤집어 서술하지 마라. '
  + '수치를 본문에 나열하지 말고 그 결과의 무게를 장면으로 그려라.';

// 갈림길이 걸려 있는 동안 매 전송 덧붙는다 — 지시문은 AI가 모르는 것만 말한다는 원칙대로,
// 선택지 내용은 안 싣는다(그건 유저 상태창의 것이다). 모델이 대신 골라 버리는 것만 막는다.
const DEFAULT_CHOICE_WAIT =
  '[선택 대기] 유저에게 선택지가 제시되어 있고 아직 고르지 않았다. 대신 선택하거나 재촉하지 말고, '
  + '어느 쪽으로도 결과를 확정하지 않는 서술을 하라.';

// ── 초기화 ──────────────────────────────────────────────────

function initState(schema, opts = {}) {
  const vars = {};
  for (const v of schema.vars) {
    vars[v.id] = v.init !== undefined ? v.init : defaultInit(v);
  }
  // 시간 체계(schema.time) — 내부 저장은 epoch(분) 정수 하나. 스키마 vars가 아니라
  // 엔진 예약 키라 allow에 올릴 수 없고, 보조 AI가 날짜를 직접 만질 방법이 없다.
  //
  // 시작 시각 무작위(v0.80)는 **rng를 준 호출자에게만** 걸린다. 세션은 chatId로 시드를
  // 만들어 넘기므로 판마다 다르고 같은 판 안에서는 고정이다. 진단·테스트처럼 rng를 안 주는
  // 호출자는 예전 그대로 start에서 시작한다 — 결정적 경로를 흔들지 않는다.
  const tcfg = timeConfig(schema);
  if (tcfg) {
    vars[EPOCH_KEY] = tcfg.startRandom && typeof opts.rng === 'function'
      ? epochFrom(rollStart(tcfg, opts.rng), tcfg.calendar)
      : tcfg.startEpoch;
  }
  return {
    vars,
    meta: { turn: 0, setupDone: false, armed: {}, actionLastUsed: {}, eventLastFired: {}, firedOnce: {}, pendingNotifies: [] },
  };
}

/** AI 최초설정이 아직 필요한 상태인가 */
function isSetupPending(schema, state) {
  return !!schema.setup?.ai?.enabled && !state.meta.setupDone && state.meta.turn === 0;
}

/** 프리셋 적용 (새 시작 전용 — 진행 중 채팅에 쓰면 수치가 덮어써짐) */
function applyPreset(schema, prevState, presetId) {
  const preset = (schema.setup?.presets || []).find((p) => p.id === presetId);
  if (!preset) return { state: prevState, applied: false };
  const state = reconcileState(schema, clone(prevState));
  const varById = Object.fromEntries(schema.vars.map((v) => [v.id, v]));
  // 시작 시점(startAt) — 시간 체계가 켜져 있으면 **시계도 시작값의 일부**다.
  // epoch은 스키마 vars가 아니라 엔진 예약 키라 set으로는 못 건드리는데, "주말 오후에 시작"
  // 같은 배경 프리셋은 그게 정확히 필요한 것이라 여기만 따로 연다 (실측: daily 템플릿의 주말 판).
  const tcfg = timeConfig(schema);
  if (tcfg && preset.startAt) {
    const parts = parseStart(preset.startAt, tcfg.calendar);
    if (parts) state.vars[EPOCH_KEY] = epochFrom(parts, tcfg.calendar);
  }
  for (const [id, val] of Object.entries(preset.set || {})) {
    const def = varById[id];
    if (!def) continue;
    const to = coerce(def, val);
    if (to !== undefined) state.vars[id] = to;
  }
  return { state, applied: true };
}

const DEFAULT_LIST_MAX_ITEMS = 20;
const DEFAULT_LIST_ITEM_MAXLEN = 40;

function defaultInit(v) {
  switch (v.type) {
    case 'int': case 'float': return v.min ?? 0;
    case 'text': return '';
    case 'bool': return false;
    case 'enum': return v.enum[0];
    case 'list': return [];
  }
}

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

/**
 * 스키마 업데이트 호환: 구버전 세이브에 없는 변수는 init으로 채우고,
 * 스키마에서 사라진 변수는 보존하되 무시한다 (파괴적 삭제 금지).
 * 모든 페이즈 진입 시 clone 직후 호출된다.
 */
function reconcileState(schema, state) {
  state.vars = state.vars || {};
  for (const v of schema.vars) {
    if (!(v.id in state.vars)) state.vars[v.id] = v.init !== undefined ? v.init : defaultInit(v);
  }
  // 시간 체계를 나중에 켠 진행 중 세이브 — 시작 시점부터 흐른 것으로 친다
  const tcfg = timeConfig(schema);
  if (tcfg && typeof state.vars[EPOCH_KEY] !== 'number') state.vars[EPOCH_KEY] = tcfg.startEpoch;
  const m = (state.meta = state.meta || {});
  m.turn = m.turn ?? 0;
  m.setupDone = m.setupDone ?? false;
  m.armed = m.armed || {};
  m.actionLastUsed = m.actionLastUsed || {};
  m.eventLastFired = m.eventLastFired || {};
  m.firedOnce = m.firedOnce || {};
  m.pendingNotifies = m.pendingNotifies || [];
  m.firedThisSend = m.firedThisSend || {}; // 이번 전송에서 발동한 액션 (whenArmed 게이트용, 다음 전송에서 리셋)
  m.lastCheck = m.lastCheck ?? null; // 마지막 판정 결과 — vars가 아니라 여기 산다 (AI가 못 만진다)
  m.pendingChoice = m.pendingChoice ?? null; // 걸려 있는 갈림길 { id, turn } — 동시 1개 상한
  m.pendingChoicePick = m.pendingChoicePick ?? null; // /선택으로 고른 번호 (0기준) — 다음 전송에서 집행
  m.suggestions = m.suggestions || []; // 다음 행동 제안 (v0.43) — 보조 AI가 만들고, 전송하면 비워진다
  // 직전 보조 호출 이후로 이미 반영된 변화 (v0.65) — 다음 보조 프롬프트에 "끝난 일"로 실린다.
  // 채팅 텍스트가 아니라 여기 사는 게 핵심: 모델을 안 거치므로 숫자가 지어내질 수 없고,
  // 리롤·삭제로 스냅샷이 되감기면 이 줄들도 같이 되감긴다.
  m.lastChanges = m.lastChanges || [];
  return state;
}

// 보조에게 보여 줄 "이미 반영된 변화" 줄 만들기 ────────────────
// 정기 틱(onTurn)은 뺀다 — 매 턴 같은 줄이 반복되어 정보량이 없고, "정기 수입·소비는
// 시스템이 계산하니 반영하지 마라"는 규칙이 이미 그 몫을 한다.
const CHANGE_MEMO_MAX = 8;
function changeMemoLines(schema, changeLog) {
  const cfg = timeConfig(schema);
  const varById = Object.fromEntries([...schema.vars, ...(schema.derived || [])].map((v) => [v.id, v]));
  const out = [];
  for (const c of changeLog || []) {
    if (out.length >= CHANGE_MEMO_MAX) break;
    if (c.source === 'onTurn') continue;
    // 시간 우편함(skip_day/skip_min)은 건너뛴다 — 소비 결과가 아래 '시각' 줄이라 두 번 말하게 된다
    if (c.id === SKIP_DAY || c.id === SKIP_MIN) continue;
    if (c.id === EPOCH_KEY) {
      if (!cfg) continue;
      const stamp = (e) => {
        const cal = calendarOf(e, cfg.calendar);
        return `${formatDate(cfg.dateFmt, cal)} ${formatClock(cfg.clockFmt, cal)}`;
      };
      out.push(`- 시각 ${stamp(c.from)} → ${stamp(c.to)} (${c.to - c.from}분 진행)`);
      continue;
    }
    // 판정 줄 — id가 라벨이고 from이 없다 (변수 변화가 아니라 굴림 결과)
    if (c.from == null && typeof c.to === 'string') { out.push(`- ${c.id}: ${c.to}`); continue; }
    const name = varById[c.id]?.label || c.id;
    const reason = c.reason ? ` — ${String(c.reason).slice(0, 40)}` : '';
    if (typeof c.from === 'number' && typeof c.to === 'number') {
      const d = c.to - c.from;
      out.push(`- ${name} ${c.from} → ${c.to} (${d > 0 ? '+' : ''}${d})${reason}`);
    } else if (Array.isArray(c.from) || Array.isArray(c.to)) {
      const from = Array.isArray(c.from) ? c.from : [], to = Array.isArray(c.to) ? c.to : [];
      const added = to.filter((x) => !from.includes(x)), gone = from.filter((x) => !to.includes(x));
      const parts = [...added.map((x) => `+${x}`), ...gone.map((x) => `-${x}`)];
      if (parts.length) out.push(`- ${name} ${parts.join(', ')}${reason}`);
    } else {
      out.push(`- ${name} ${c.from} → ${c.to}${reason}`);
    }
  }
  return out.map((s) => s.slice(0, 140));
}

/** @param append true면 이번 사이클에 이어 붙인다 (전송 단계 → 응답 단계 순서 보존) */
function recordChangeMemo(schema, state, changeLog, append = false) {
  const lines = changeMemoLines(schema, changeLog);
  state.meta.lastChanges = append
    ? [...(state.meta.lastChanges || []), ...lines].slice(-CHANGE_MEMO_MAX)
    : lines;
}

/**
 * 다음 행동 제안(schema.suggest) 정리 — 보조 AI가 준 배열을 표시 가능한 형태로 다듬는다.
 * 스키마에 suggest가 없으면 무조건 빈 배열 (기능 자체가 옵트인).
 */
function sanitizeSuggestions(schema, arr) {
  if (!schema.suggest || !Array.isArray(arr)) return [];
  const count = Math.min(Math.max(schema.suggest.count ?? 3, 2), 4);
  return arr.filter((s) => typeof s === 'string')
    .map((s) => s.trim().replace(/\s+/g, ' ').slice(0, 80))
    .filter(Boolean)
    .slice(0, count);
}

/** 갈림길(choices 달린 이벤트)을 id로 찾는다 — 조건 이벤트·랜덤 표 양쪽에서 */
function findChoiceEvent(schema, id) {
  const all = [...(schema.rules?.events || []), ...(schema.rules?.randomEvents?.table || [])];
  const ev = all.find((e) => e.id === id);
  return ev && Array.isArray(ev.choices) && ev.choices.length ? ev : null;
}

/**
 * 갈림길 선택 검증 — /선택 명령과 클릭 조작이 같은 눈으로 봐야 어긋나지 않는다.
 * 상태는 바꾸지 않는다 (기록은 부르는 쪽이, 집행은 전송 단계가).
 * @returns {{ ok: boolean, label?: string, reason?: string, locked?: boolean }}
 */
function pickChoice(schema, state, idx) {
  const pc = state.meta?.pendingChoice;
  const ev = pc ? findChoiceEvent(schema, pc.id) : null;
  if (!ev) return { ok: false, reason: '지금 고를 선택지가 없음' };
  const c = ev.choices[idx];
  if (!c) return { ok: false, reason: `1~${ev.choices.length} 사이 번호가 아님` };
  if (c.when) {
    let pass = true;
    try { pass = truthy(evaluate(c.when, makeLookup(schema, state.vars), null)); } catch { pass = false; }
    if (!pass) return { ok: false, reason: `'${c.label}'은 지금 고를 수 없음 🔒`, locked: true };
  }
  return { ok: true, label: c.label };
}

// ── 조회 (vars + derived, 순환 감지) ─────────────────────────

function makeLookup(schema, vars) {
  const derivedById = Object.fromEntries((schema.derived || []).map((d) => [d.id, d]));
  const memo = {};
  const computing = new Set();
  // 시간 노출 파생 (date/clock/weekday/…) — epoch 하나에서 전부 계산된다.
  // epoch이 같은 동안 캐시 — applySets가 규칙마다 lookup을 새로 만들어도 값은 한 번만 계산.
  const tcfg = timeConfig(schema);
  let tEpoch, tVals = null;
  const timeVal = (name) => {
    if (!tcfg || !tcfg.expose.includes(name)) return undefined;
    const e = vars[EPOCH_KEY];
    if (tVals === null || e !== tEpoch) { tEpoch = e; tVals = exposedValues(tcfg, e); }
    return tVals[name];
  };
  const lookup = (name) => {
    if (name in vars) return vars[name];
    const tv = timeVal(name);
    if (tv !== undefined) return tv;
    // 편성 가상 목록 (v0.59) — 편성 슬롯에 앉은 이름들을 읽기 전용 목록으로 노출.
    // has(deployed, '아린')이 상태창 showWhen·탭 when·지시문·이벤트·requires 어디서든 통한다.
    // 같은 id의 실제 변수/파생이 있으면 그쪽이 이긴다 (변수는 위에서 이미 잡혔고, 파생은 여기서 양보).
    if (name === 'deployed' && schema.party && !derivedById.deployed) {
      const { allSlots } = require('./party');   // 지연 require — party ↔ engine 순환 회피
      const empty = schema.party.empty ?? null;
      const byId = Object.fromEntries((schema.vars || []).map((v) => [v.id, v]));
      const out = [];
      for (const s of allSlots(schema)) {
        const v = vars[s.var] ?? byId[s.var]?.init ?? null;
        if (v != null && v !== empty && !out.includes(v)) out.push(v);
      }
      return out;
    }
    const d = derivedById[name];
    if (!d) return undefined;
    if (name in memo) return memo[name];
    if (computing.has(name)) throw new Error(`derived 순환 참조: '${name}'`);
    computing.add(name);
    const val = evaluate(d.expr, lookup, null);
    computing.delete(name);
    memo[name] = val;
    return val;
  };
  return lookup;
}

// ── 값 강제(coerce) & set 규칙 적용 ─────────────────────────

function coerce(varDef, value) {
  switch (varDef.type) {
    case 'int': {
      let n = Math.round(Number(value) || 0);
      if (varDef.min != null) n = Math.max(n, varDef.min);
      if (varDef.max != null) n = Math.min(n, varDef.max);
      return n;
    }
    case 'float': {
      let n = Number(value) || 0;
      if (varDef.min != null) n = Math.max(n, varDef.min);
      if (varDef.max != null) n = Math.min(n, varDef.max);
      return n;
    }
    case 'bool':
      return typeof value === 'boolean' ? value : truthy(value);
    case 'enum':
      return varDef.enum.includes(value) ? value : undefined; // undefined = 거부
    case 'text': {
      const s = String(value);
      const cap = varDef.maxLength ?? DEFAULT_TEXT_MAXLEN;
      return s.length > cap ? s.slice(0, cap) : s;
    }
    case 'list': {
      let arr;
      if (Array.isArray(value)) arr = value;
      else if (typeof value === 'string') arr = value.split(',').map((s) => s.trim()).filter(Boolean);
      else return undefined;
      const itemCap = varDef.itemMaxLength ?? DEFAULT_LIST_ITEM_MAXLEN;
      const maxItems = varDef.maxItems ?? DEFAULT_LIST_MAX_ITEMS;
      return arr.map((x) => String(x).slice(0, itemCap)).filter(Boolean).slice(0, maxItems);
    }
  }
}

/**
 * 목록 항목의 상대 기한 `@+N`을 절대 기한 `@(지금+N)`으로 굳힌다.
 *
 * 왜 필요한가: 기한은 절대값이어야 한다(매 턴 전부 1씩 깎을 방법이 없다). 그런데 절대값을
 * 보조 모델에게 직접 쓰게 하면 "지금 경과일 12에 1080을 더해서 1092"라는 산술을 시키게 된다.
 * 그건 이 플러그인이 없애려고 만든 바로 그 종류의 일이다. 모델은 "3년"만 알면 되고("@+1080"),
 * 날짜로 굳히는 건 시스템이 한다.
 *
 * 기준 시각은 그 목록을 만료시키는 onTurn 규칙의 expire 식을 그대로 쓴다 —
 * 등록과 만료를 같은 시계로 재야 어긋나지 않는다. 규칙이 없으면 손대지 않고,
 * 굳지 않은 `@+N`은 itemExpiry의 `@숫자` 패턴에 안 걸려 그냥 무기한이 된다 (안전한 실패).
 */
function resolveRelativeExpiry(schema, state, listId, items, rng) {
  if (!Array.isArray(items) || !items.some((s) => /@\+\d/.test(String(s)))) return items;
  const rule = (schema.rules?.onTurn || []).find((r) => r.list === listId && r.expire);
  if (!rule) return items;
  let now;
  try { now = Number(evaluate(rule.expire, makeLookup(schema, state.vars), rng)); }
  catch { return items; }
  if (!isFinite(now)) return items;
  return items.map((s) => String(s).replace(/@\+(\d+(?:\.\d+)?)/g,
    (_, n) => '@' + Math.round(now + parseFloat(n))));
}

/** 목록 add/remove 연산 적용 (중복 추가 허용 — '회복약'을 2개 가질 수 있음) */
function applyListOps(varDef, current, ops) {
  let arr = Array.isArray(current) ? [...current] : [];
  for (const item of [].concat(ops?.remove ?? [])) {
    const idx = arr.indexOf(String(item));
    if (idx >= 0) arr.splice(idx, 1);
  }
  for (const item of [].concat(ops?.add ?? [])) {
    if (item != null && String(item).trim()) arr.push(String(item).trim());
  }
  return coerce(varDef, arr);
}

// overlay: 판정 등급 효과에서 roll/mod/total/vs를 임시 식별자로 여는 데 쓴다 (변수보다 우선)
function applySets(schema, state, rules, rng, changeLog, source, overlay = null) {
  const varById = Object.fromEntries(schema.vars.map((v) => [v.id, v]));
  for (const rule of rules || []) {
    // 목록 효과: { list: 'inventory', add: [...], remove: [...], expire: '수식' }
    if (rule.list) {
      const def = varById[rule.list];
      if (!def || def.type !== 'list') continue;
      const from = state.vars[rule.list];
      // expire: 항목의 `@숫자`가 이 값보다 작아지면 만료 — 기한이 다한 계약·부역이 스스로 빠진다.
      // (`@`가 없는 항목은 무기한이라 건드리지 않는다)
      let base = from;
      if (rule.expire) {
        const now = Number(evaluate(rule.expire, makeLookup(schema, state.vars), rng));
        if (isFinite(now) && Array.isArray(from)) {
          base = from.filter((it) => { const e = itemExpiry(it); return e === null || e >= now; });
        }
      }
      const ops = rule.add
        ? { ...rule, add: resolveRelativeExpiry(schema, state, rule.list, [].concat(rule.add), rng) }
        : rule;
      const to = applyListOps(def, base, ops);
      if (to !== undefined && JSON.stringify(to) !== JSON.stringify(from)) {
        state.vars[rule.list] = to;
        changeLog.push({ id: rule.list, from, to, source });
      }
      continue;
    }
    const def = varById[rule.set];
    if (!def) continue; // 검증 단계에서 걸러지지만 방어
    if (def.type === 'list') continue; // 목록은 수식 set 불가 (list 효과 사용)
    const base = makeLookup(schema, state.vars);
    const lookup = overlay ? (n) => (n in overlay ? overlay[n] : base(n)) : base;
    const raw = evaluate(rule.expr, lookup, rng);
    const from = state.vars[rule.set];
    const to = coerce(def, def.type === 'bool' ? truthy(raw) : raw);
    if (to === undefined) continue;
    if (to !== from) {
      state.vars[rule.set] = to;
      changeLog.push({ id: rule.set, from, to, source });
    }
  }
}

// ── 시간 진행 소비 ──────────────────────────────────────────
// skip_day/skip_min에 쌓인 진행량을 epoch에 굳히고 0으로 되돌린다.
// 두 곳에서 부른다: 전송 단계(액션 효과 직후 — 🌙 버튼이 굳힌 하루가 이번 프롬프트의
// 날짜에 바로 반영되어야 AI가 이튿날 아침을 쓴다)와 응답 단계(보조 델타 직후 —
// 보조가 "이 장면에서 1시간 흘렀다"고 보고한 것은 다음 전송부터 반영되면 된다).
// 양쪽 다 소비 후 0으로 리셋하므로 이중 계산은 없다.
function consumeTimeSkips(schema, state, changeLog, { perTurnTick = false } = {}) {
  const cfg = timeConfig(schema);
  if (!cfg) return;
  let addMin = 0;
  const hasDay = schema.vars.some((v) => v.id === SKIP_DAY);
  const hasMin = schema.vars.some((v) => v.id === SKIP_MIN);
  // 음수는 안 센다 — 시간이 뒤로 가면 목록 기한(@숫자)이 전부 어긋난다
  if (hasDay) addMin += Math.max(0, Number(state.vars[SKIP_DAY]) || 0) * MIN_PER_DAY;
  if (hasMin) addMin += Math.max(0, Number(state.vars[SKIP_MIN]) || 0);
  if (perTurnTick && cfg.advance === 'perTurn') addMin += MIN_PER_DAY; // 구 호환: 1턴 = 1일
  if (addMin > 0) {
    const from = state.vars[EPOCH_KEY];
    state.vars[EPOCH_KEY] = from + addMin;
    changeLog.push({ id: EPOCH_KEY, from, to: state.vars[EPOCH_KEY], source: 'time' });
  }
  if (hasDay && state.vars[SKIP_DAY] !== 0) state.vars[SKIP_DAY] = 0;
  if (hasMin && state.vars[SKIP_MIN] !== 0) state.vars[SKIP_MIN] = 0;
}

// ── 판정 (checks) — "완벽 주사위" ────────────────────────────
// 굴림은 엔진이 하고, AI는 결과를 받아 서사만 쓴다. 결과는 vars가 아니라 meta.lastCheck에
// 남는다 — 보조 AI의 allow에 올릴 수 있는 형태가 아예 아니어서, 모델이 판정 결과를 고쳐 쓰는
// 사고가 구조적으로 불가능하다 (설계 문서의 "allow 금지"를 검증이 아니라 구조로 달성).
// 같은 시드 rng를 받으므로 리롤해도 같은 굴림이다.
// 등급은 위에서부터 첫 매치, when 없는 등급은 항상 참(기본 등급).
// 등급의 when/effects에서는 roll/mod/total(/vs)이 임시 식별자로 열린다 — 변수보다 우선.
function rollCheck(schema, state, check, rng, changeLog) {
  const lookup = makeLookup(schema, state.vars);
  let roll, mod, vs = null;
  try {
    roll = Number(evaluate(check.roll, lookup, rng)); // rand가 허용되는 유일한 굴림 자리
    mod = check.mod != null ? Number(evaluate(String(check.mod), lookup, null)) : 0;
    if (check.vs != null) vs = typeof check.vs === 'number' ? check.vs : Number(evaluate(String(check.vs), lookup, null));
  } catch { return null; } // 검증 단계에서 걸러지지만 방어
  if (!isFinite(roll) || !isFinite(mod)) return null;
  if (vs != null && !isFinite(vs)) vs = null;
  const total = roll + mod;
  const overlay = { roll, mod, total };
  if (vs != null) overlay.vs = vs;
  const ov = (n) => (n in overlay ? overlay[n] : lookup(n));
  let grade = null;
  for (const g of check.grades || []) {
    if (!g.when) { grade = g; break; }
    try { if (truthy(evaluate(g.when, ov, null))) { grade = g; break; } }
    catch { /* 이 등급만 건너뛴다 — 방어 */ }
  }
  const summary = `${roll}${mod ? (mod > 0 ? ` + ${mod} = ${total}` : ` - ${-mod} = ${total}`) : ''}`
    + `${vs != null ? ` vs ${vs}` : ''} → ${grade ? grade.label : '(등급 없음)'}`;
  const label = check.label ?? check.id;
  if (grade) applySets(schema, state, grade.effects, rng, changeLog, `check:${check.id}`, overlay);
  state.meta.lastCheck = { id: check.id, label, roll, mod, total, vs, grade: grade ? grade.label : null, summary, turn: state.meta.turn };
  changeLog.push({ id: label, from: null, to: summary, source: `check:${check.id}` });
  return { line: `[판정] ${label}: ${summary}`, inject: grade?.inject || null, grade: grade ? grade.label : null };
}

// ── ① 전송 단계 (beforeRequest) ──────────────────────────────
// 반환: { state, promptBlock, consumedActions, changeLog }

function sendPhase(schema, prevState, { rng } = {}) {
  const state = reconcileState(schema, clone(prevState));
  const changeLog = [];
  const injects = [];
  const consumedActions = [];

  // 1. 무장 액션 effects (결정적) + inject 수집
  // firedThisSend: whenArmed 게이트의 기준. oneshot은 여기서 무장이 풀리므로 armed만으로는
  // 같은 사이클의 output(즉시·지연·브리지 소급 모두)에서 "방금 발동했다"를 알 수 없다.
  // 다음 sendPhase에서 통째로 리셋 → 리롤은 pre 스냅샷에서 재계산되므로 안전.
  state.meta.firedThisSend = {};
  state.meta.suggestions = []; // 다음 행동 제안은 이번 입력으로 소비됐다 — 보조 AI가 새로 채운다

  // 0.5 갈림길 집행 — /선택은 명령 시점에 기록만 하고(pendingChoicePick) 여기서 집행한다.
  // 효과식엔 rand가 올 수 있고 변화 로그·시드 rng가 필요한데, 그건 전송 단계의 것들이라서다.
  // 리롤은 pre 스냅샷(기록 포함)에서 재계산되므로 같은 결과가 나온다.
  if (state.meta.pendingChoice && state.meta.pendingChoicePick != null) {
    const ev = findChoiceEvent(schema, state.meta.pendingChoice.id);
    const c = ev?.choices?.[state.meta.pendingChoicePick];
    if (c) {
      applySets(schema, state, c.effects, rng, changeLog, `choice:${ev.id}`);
      injects.push(`[선택] ${c.label}`);
      if (c.inject) injects.push(c.inject);
    }
    state.meta.pendingChoice = null;
    state.meta.pendingChoicePick = null;
  }

  const checkById = Object.fromEntries((schema.checks || []).map((c) => [c.id, c]));
  for (const action of schema.actions || []) {
    if (!state.meta.armed[action.id]) continue;
    if (action.when && !truthy(evaluate(action.when, makeLookup(schema, state.vars), null))) continue;
    // 판정 달린 액션: 먼저 굴린다 — 굴림식이 이점(adv) 같은 소모성 변수를 읽기 때문이다.
    // 순서: 굴림+등급 효과 → 액션 자체 효과. "이점 끄기" 같은 정리는 액션 effects에 둔다.
    let checkResult = null;
    if (action.check && checkById[action.check]) {
      checkResult = rollCheck(schema, state, checkById[action.check], rng, changeLog);
    }
    applySets(schema, state, action.effects, rng, changeLog, `action:${action.id}`);
    if (action.inject) injects.push(action.inject);
    if (checkResult) {
      injects.push(checkResult.line);
      if (checkResult.inject) injects.push(checkResult.inject);
    }
    consumedActions.push(action.id);
    state.meta.firedThisSend[action.id] = true;
    if ((action.mode || 'oneshot') === 'oneshot') {
      delete state.meta.armed[action.id];
      state.meta.actionLastUsed[action.id] = state.meta.turn;
    }
  }

  // 1.5 시간 진행 소비 — 액션(🌙 하루를 마친다 등)이 굳힌 진행량을 지금 반영해야
  // 아래 상태 블록의 날짜가 새 날로 나가고, AI가 이튿날 장면을 쓴다
  consumeTimeSkips(schema, state, changeLog);

  // 2. 직전 턴 이벤트 통지 합류
  const notifies = state.meta.pendingNotifies.splice(0);

  // 3. 상태 블록 렌더
  const lookup = makeLookup(schema, state.vars);
  const ps = schema.promptState || {};
  const lines = [];
  if (ps.template) lines.push(renderTemplate(ps.template, lookup));
  const showEvents = ps.includeEvents !== false && notifies.length > 0;
  if (showEvents) {
    // 이벤트가 굴린 판정 결과([판정] 줄)는 통지로 실려 오지만 이벤트가 아니다 — 태그를 겹치지 않는다
    for (const n of notifies) lines.push(String(n).startsWith('[판정]') ? n : `[이벤트] ${n}`);
    // 충돌 해소 규칙은 이벤트가 실제로 있는 턴에만 붙인다 (없는 턴에 넣어봐야 토큰 낭비 + 헛된 편향)
    if (ps.eventPriority !== false) {
      lines.push(renderTemplate(
        typeof ps.eventPriority === 'string' && ps.eventPriority.trim()
          ? ps.eventPriority : DEFAULT_EVENT_PRIORITY, lookup));
    }
  }
  for (const inj of injects) lines.push(inj);

  // 3.4 판정 규칙 줄 — [판정]이 실제로 있는 턴에만 (액션이 방금 굴렸든, 이벤트 통지로 실려 왔든).
  // includeEvents가 꺼져 통지가 안 나간 턴에는 규칙 줄도 안 붙인다 — 없는 줄에 대한 규칙이 된다.
  const hasCheckLine = injects.concat(showEvents ? notifies : []).some((s) => String(s).startsWith('[판정]'));
  if (hasCheckLine && ps.checkGuide !== false) {
    lines.push(typeof ps.checkGuide === 'string' && ps.checkGuide.trim()
      ? renderTemplate(ps.checkGuide, lookup) : DEFAULT_CHECK_GUIDE);
  }

  // 3.5 상태 지시문: 조건을 만족하는 동안 매 턴 주입 (세션 0 중에는 제외)
  const activeDirectives = [];
  if (!isSetupPending(schema, state)) {
    for (const d of schema.directives || []) {
      try {
        if (truthy(evaluate(d.when, lookup, null))) {
          lines.push(renderTemplate(d.text, lookup));
          activeDirectives.push(d.id);
        }
      } catch { /* 검증 단계에서 걸러지지만 방어 */ }
    }
  }

  // 3.6 갈림길 대기 줄 — 걸려 있는 동안 매 전송 (모델이 대신 골라 버리는 것을 막는다)
  if (state.meta.pendingChoice && findChoiceEvent(schema, state.meta.pendingChoice.id)) {
    lines.push(DEFAULT_CHOICE_WAIT);
  }

  // 3.7 에셋 팩 주입문 (by:'main') — 손으로 쓰던 이미지 지침 블록을 팩 선언에서 생성.
  // 닫힌 팩은 통째로 빠지므로 매 전송 다시 계산한다. 세션 0(최초설정)엔 안 붙인다.
  if (!isSetupPending(schema, state)) {
    const imgBlock = mainInjectionText(schema, lookup);
    if (imgBlock) lines.push(imgBlock);
  }

  if (isSetupPending(schema, state)) {
    lines.push(schema.setup.ai.instruction ||
      '[최초 설정 진행 중] 아직 시뮬레이션이 시작되지 않았다. 유저와 함께 시작 상황(배경, 자원, 세력 등)을 정하는 대화를 진행하라. 유저의 묘사가 충분해지면 확정된 시작 상황을 서술로 정리하라.');
  }
  // 기본 지침("수치·상태는 시스템이 관리한다")은 관리할 수치가 있을 때만 뜻이 있다.
  // 에셋만 쓰는 봇(변수 0개)에 넣으면 있지도 않은 상태창을 쓰지 말라는 지시가 된다.
  if (ps.systemGuide) lines.push(ps.systemGuide);
  else if (schema.vars.length) lines.push(DEFAULT_SYSTEM_GUIDE);

  // 전송 단계에서 일어난 것(무장 액션 효과·시간 소비)도 "이미 반영됨"에 이어 붙인다 —
  // 이번 턴 보조 호출은 이 뒤에 오므로, 보조가 그걸 자기 몫으로 또 세면 안 된다.
  recordChangeMemo(schema, state, changeLog, true);

  return { state, promptBlock: lines.join('\n'), consumedActions, changeLog, activeDirectives };
}

// ── ②' 최초설정 응답 단계 — 절대값 적용, 정기 틱·이벤트 없음 ──
// values: { id: 절대값 }  (델타 아님)
function setupPhase(schema, prevState, values, reasons) {
  const state = reconcileState(schema, clone(prevState));
  const changeLog = [];
  const varById = Object.fromEntries(schema.vars.map((v) => [v.id, v]));
  const allowed = new Set(schema.setup?.ai?.vars ?? schema.vars.map((v) => v.id));
  for (const [id, proposed] of Object.entries(values || {})) {
    const def = varById[id];
    if (!def || !allowed.has(id)) continue;
    const from = state.vars[id];
    const to = coerce(def, def.type === 'bool' ? truthy(proposed) : proposed);
    if (to === undefined || to === from) continue;
    if (def.type === 'list' && JSON.stringify(to) === JSON.stringify(from)) continue;
    state.vars[id] = to;
    changeLog.push({ id, from, to, source: 'setup', reason: reasons?.[id] });
  }
  state.meta.setupDone = true; // 값이 비어도 설정 단계는 소비됨 (재시도는 리롤로)
  return { state, changeLog, firedEvents: [] };
}

/** 최초설정용 보조 모델 프롬프트 — 절대값 + 허용 범위 명세 */
function buildSetupPrompt(schema, state, narrative) {
  const varById = Object.fromEntries(schema.vars.map((v) => [v.id, v]));
  const ids = schema.setup?.ai?.vars ?? schema.vars.map((v) => v.id);
  const specs = ids.map((id) => {
    const v = varById[id];
    if (!v) return null;
    const d = v.desc ? ` — ${v.desc}` : '';
    const base = `- ${id} (${v.label ?? id}`;
    if (v.type === 'int' || v.type === 'float') {
      const range = [v.min != null ? `최소 ${v.min}` : null, v.max != null ? `최대 ${v.max}` : null].filter(Boolean).join(', ');
      return `${base}, 숫자${range ? ', ' + range : ''}): 기본값 ${JSON.stringify(v.init)}${d}`;
    }
    if (v.type === 'enum') return `${base}, 선택): 다음 중 하나: ${v.enum.join(' | ')} (기본 ${JSON.stringify(v.init)})${d}`;
    if (v.type === 'bool') return `${base}, 참/거짓): 기본 ${JSON.stringify(v.init ?? false)}${d}`;
    if (v.type === 'list') return `${base}, 목록): 문자열 배열로 제시 (최대 ${v.maxItems ?? DEFAULT_LIST_MAX_ITEMS}개, 기본 ${JSON.stringify(v.init ?? [])})${d}`;
    return `${base}, 텍스트 ${v.maxLength ?? DEFAULT_TEXT_MAXLEN}자 이내): 기본 ${JSON.stringify(v.init ?? '')}${d}`;
  }).filter(Boolean).join('\n');

  return [
    '너는 시뮬레이션 초기 설정 관리자다. 아래 대화에서 확정된 시작 상황을 읽고 각 변수의 초기값을 JSON으로 출력하라.',
    '',
    '[설정 가능 변수]', specs, '',
    '[시작 상황 대화]', narrative, '',
    '[규칙]',
    '- 대화에서 정해진 내용을 우선 반영하고, 언급되지 않은 변수는 기본값을 유지하거나 상황에 맞게 자연스럽게 정하라.',
    '- 절대값으로 제시하라 (델타 아님).',
    schema.setup?.ai?.guide ? `- ${schema.setup.ai.guide}` : null,
    '',
    '출력 형식 (JSON만, 다른 텍스트 금지):',
    '{"values": {"변수id": 값}, "reasons": {"변수id": "한 줄 사유"}}',
  ].filter((x) => x !== null).join('\n');
}

/**
 * 응답 텍스트에서 JSON 객체 추출 (관대하게).
 * 추론 모델의 <Thoughts>...</Thoughts> 서두, 코드펜스, 앞뒤 잡담을 전부 견딘다.
 * requiredKey가 있으면 그 키를 가진 첫 객체를 우선하고, 없으면 첫 파싱 성공 객체.
 */
function extractJsonObject(text, requiredKey) {
  if (typeof text !== 'string') return null;
  // 추론(thinking) 블록 제거 — Gemini 등이 JSON 앞에 사고 과정을 뱉는 경우
  let src = text.replace(/<Thoughts>[\s\S]*?<\/Thoughts>/gi, '')
                .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  // 코드펜스 안 JSON 우선
  const fence = src.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fence ? [fence[1], src, text] : [src, text];
  let fallback = null;
  for (const cand of candidates) {
    // 균형 잡힌 { } 블록 스캔 (문자열/이스케이프 인지)
    for (let start = cand.indexOf('{'); start !== -1; start = cand.indexOf('{', start + 1)) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < cand.length; i++) {
        const ch = cand[i];
        if (esc) { esc = false; continue; }
        if (inStr) {
          if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(cand.slice(start, i + 1));
              if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                if (!requiredKey || requiredKey in obj) return obj;
                if (!fallback) fallback = obj;
              }
            } catch { /* 다음 후보로 */ }
            break;
          }
        }
      }
    }
    if (fallback) break; // 이 후보 텍스트에서 뭐라도 건졌으면 다음 후보는 안 봄
  }
  return fallback;
}

/** 최초설정 응답 파싱 */
function parseSetupResponse(text) {
  const obj = extractJsonObject(text, 'values');
  if (!obj) return null;
  return { values: obj.values || {}, reasons: obj.reasons || {} };
}

// ── ② 응답 단계 (afterRequest/output) ────────────────────────
// changes: 보조 모델 제안 { id: number(델타) | string | bool }
// reasons: { id: '사유' } (선택)
// 반환: { state, changeLog, firedEvents }

/** 보조 모델 델타만 적용 (캡·검증) — outputPhase 내부와 지연 소급 적용에서 공용 */
function applyChangesToState(schema, prevState, changes, reasons, seenText = null, suggest = null, conflicts = null, detected = null) {
  const state = reconcileState(schema, clone(prevState));
  const changeLog = [];
  applyLLMChangesInto(schema, state, changes, reasons, changeLog, seenText);
  if (suggest != null) state.meta.suggestions = sanitizeSuggestions(schema, suggest);
  // 불일치 신고 — 소급 경로에서도 통지로만. 다음 전송에 실린다 (한 턴 늦지만 안 실리는 것보단 낫다)
  pushConflictNotifies(state, conflicts);
  // 감지 신고 — 소급 경로에서는 있으면 얹기만 한다 (빈 신고로 지우면, 이 응답보다 새 출력이
  // 세워 둔 해제 표를 밟는다. 교체는 정규 경로 outputPhase의 몫)
  if (schema.updater?.wordDetect !== false) {
    const det = sanitizeDetected(schema, detected);
    if (det.length) state.meta.wordUnlock = { ...(state.meta.wordUnlock || {}), ...Object.fromEntries(det.map((id) => [id, true])) };
  }
  // 지연·브리지 소급 경로 — outputPhase가 이미 자기 몫을 쓴 뒤라 이어 붙인다
  recordChangeMemo(schema, state, changeLog, true);
  return { state, changeLog };
}

/**
 * 불일치 신고 정제 + 통지 합류 (v0.71, 신고 전용 채널).
 * 보조가 "서사는 이렇게 선언했는데 시스템 관리 항목이라 조정 못 한다"를 보고하면,
 * 변수는 그대로 두고 통지에만 얹는다. 다음 턴 상태 블록의 [이벤트] 줄로 나가므로
 * 메인 모델이 시스템 상태 쪽으로 서사를 되돌릴 근거가 된다. 유저에게는 패널 요약에 보인다.
 */
function sanitizeConflicts(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim().replace(/\s+/g, ' ').slice(0, 160))
    .slice(0, 3);
}

function pushConflictNotifies(state, conflicts) {
  for (const c of sanitizeConflicts(conflicts)) {
    state.meta.pendingNotifies.push(`⚠ 시스템 미확정: ${c} — 상태에 반영되지 않았다. 서사를 현재 상태에 맞춰라.`);
  }
}

/**
 * 감지 신고 정제 (v0.74, 연성 축의 신고 채널 — conflicts의 쌍둥이).
 * 낱말 게이트에 닫힌 변수를 서사가 명백히 서술했다고 보조가 신고하면, 그 턴에는 아무것도
 * 안 바꾸고 **다음 전송 한 번만** 낱말 필터를 우회해 연다. 신고 자체에 쓰기 권한이 없어
 * 게이트의 존재 이유(등장 안 한 변수의 드리프트)는 그대로 지켜진다 — 열린 뒤의 변화도
 * 여전히 상한·coerce를 통과한다.
 */
function sanitizeDetected(schema, list) {
  if (!Array.isArray(list)) return [];
  const gated = new Set((schema.updater?.allow || []).filter((a) => a.mentions).map((a) => a.id));
  return [...new Set(list.filter((s) => typeof s === 'string').map((s) => s.trim())
    .filter((s) => gated.has(s)))].slice(0, 4);
}

/** 다음 전송 1회분 해제 표를 갈아끼운다 — 매 출력마다 교체라 유효 기간이 정확히 한 전송이다 */
function consumeDetected(schema, state, detected) {
  if (schema.updater?.wordDetect === false) { delete state.meta.wordUnlock; return; }
  const det = sanitizeDetected(schema, detected);
  if (det.length) state.meta.wordUnlock = Object.fromEntries(det.map((id) => [id, true]));
  else delete state.meta.wordUnlock;
}

/** @param seenText 이번 턴 글. 주면 그때 열어 준 변수만 받는다 (auxAllowList와 같은 기준) */
function applyLLMChangesInto(schema, state, changes, reasons, changeLog, seenText = null) {
  const varById = Object.fromEntries(schema.vars.map((v) => [v.id, v]));
  // state를 같이 넘겨 whenArmed 게이트를 적용 시점에도 강제한다 —
  // 브리지·지연 소급(seenText 없음)에서도 액션 잠금만은 결정적으로 걸린다
  const allowById = Object.fromEntries(auxAllowList(schema, seenText, state).map((a) => [a.id, a]));
  for (const [id, proposed] of Object.entries(changes || {})) {
    const def = varById[id];
    const allow = allowById[id];
    if (!def || !allow) continue; // 허용 목록 밖 → 무시
    const from = state.vars[id];
    let to;
    if (def.type === 'int' || def.type === 'float') {
      let delta = Number(proposed);
      if (!isFinite(delta) || delta === 0) continue;
      const gainCap = allow.maxGain ?? allow.maxDelta;
      const lossCap = allow.maxLoss ?? allow.maxDelta;
      if (delta > 0 && gainCap != null) delta = Math.min(gainCap, delta);
      if (delta < 0 && lossCap != null) delta = Math.max(-lossCap, delta);
      to = coerce(def, from + delta);
    } else if (def.type === 'text') {
      const cap = allow.maxLength ?? def.maxLength ?? DEFAULT_TEXT_MAXLEN;
      to = coerce({ ...def, maxLength: cap }, proposed);
    } else if (def.type === 'list') {
      // {"add": [...], "remove": [...]} 연산만 허용 (전체 교체 금지 — 아이템 증발 방지)
      if (typeof proposed !== 'object' || proposed === null || Array.isArray(proposed)) continue;
      // 보조 모델이 "@+1080"(3년)이라고만 써도 여기서 실제 날짜로 굳는다 — 산술은 시스템 몫
      const ops = proposed.add
        ? { ...proposed, add: resolveRelativeExpiry(schema, state, id, [].concat(proposed.add)) }
        : proposed;
      to = applyListOps(def, from, ops);
    } else {
      to = coerce(def, proposed); // enum(목록 밖 거부) / bool
    }
    if (to === undefined || to === from) continue;
    if (def.type === 'list' && JSON.stringify(to) === JSON.stringify(from)) continue;
    state.vars[id] = to;
    changeLog.push({ id, from, to, source: 'llm', reason: reasons?.[id] });
  }
}

// ── ② 응답 단계 (afterRequest/output) ────────────────────────
function outputPhase(schema, sendState, changes, reasons, { rng, seenText = null, suggest = null, conflicts = null, detected = null } = {}) {
  const state = reconcileState(schema, clone(sendState));
  const changeLog = [];
  const firedEvents = [];

  // 5. 보조 모델 델타 적용 — 지난 턴 신고(wordUnlock)가 있으면 여기서 소비된다
  // (auxAllowList가 state로 읽는다). 그래서 해제 표 교체(5.3)는 반드시 이 뒤여야 한다.
  applyLLMChangesInto(schema, state, changes, reasons, changeLog, seenText);
  // 5.1 다음 행동 제안 (v0.43) — 보조 응답에 실려 오면 여기서 갈아끼운다 (변수가 아니라 meta)
  if (suggest != null) state.meta.suggestions = sanitizeSuggestions(schema, suggest);
  // 5.2 서사-시스템 불일치 신고 (v0.71) — **신고 전용, 변수에는 절대 반영하지 않는다.**
  // 통지로만 흘러 다음 턴 [이벤트] 줄에 실린다 → 서사가 스스로 물러나는 자기 수복 유도.
  // 쓰기 권한이 없어 이중 계산·환각 보정이 원천 불가능한, 정합 패스의 안전한 반쪽이다.
  pushConflictNotifies(state, conflicts);
  // 5.3 감지 신고 (v0.74) — 연성 축의 신고 채널. 이번 신고분으로 해제 표를 갈아끼운다
  // (다음 전송 한 번만 유효). 이 턴의 changes에 신고 변수가 섞여 있어도 5에서 이미
  // 게이트에 걸러졌다 — 신고와 반영이 같은 턴에 겹치는 일은 구조적으로 없다.
  consumeDetected(schema, state, detected);

  // 5.5 시간 진행 소비 — 보조가 보고한 진행량(skip_day/skip_min 델타)을 epoch에 굳힌다.
  // onTurn·이벤트보다 먼저라, 날짜 조건(dom == 1 등)이 걸린 이벤트가 새 날짜를 보고 발동한다.
  consumeTimeSkips(schema, state, changeLog, { perTurnTick: true });

  // 6. 정기 틱
  applySets(schema, state, schema.rules?.onTurn, rng, changeLog, 'onTurn');

  // 6.5 갈림길 타임아웃 — 제시된 지 timeout턴이 지나도록 안 고르면 **마지막 항목**이 자동 결정된다
  // (마지막은 "외면한다"류의 조건 없는 항목을 두는 게 규격 — 조건이 있고 거짓이면 효과 없이 지나간다)
  if (state.meta.pendingChoice) {
    const pcEv = findChoiceEvent(schema, state.meta.pendingChoice.id);
    if (!pcEv) {
      state.meta.pendingChoice = null; // 스키마에서 사라진 갈림길 — 방어
      state.meta.pendingChoicePick = null;
    } else if (pcEv.timeout != null && state.meta.turn - state.meta.pendingChoice.turn >= pcEv.timeout) {
      const last = pcEv.choices[pcEv.choices.length - 1];
      let ok = true;
      if (last.when) { try { ok = truthy(evaluate(last.when, makeLookup(schema, state.vars), null)); } catch { ok = false; } }
      if (ok) {
        applySets(schema, state, last.effects, rng, changeLog, `choice:${pcEv.id}`);
        state.meta.pendingNotifies.push(`[선택] ${last.label} (정하지 않아 그렇게 흘러갔다)`);
        if (last.inject) state.meta.pendingNotifies.push(last.inject);
      } else {
        state.meta.pendingNotifies.push('선택의 순간이 지나갔다.');
      }
      state.meta.pendingChoice = null;
      state.meta.pendingChoicePick = null;
    }
  }

  // 7. 조건 이벤트
  // 판정 달린 이벤트: 굴림·등급 효과는 지금 적용되고, [판정] 줄은 통지에 실려 다음 전송에 합류한다.
  // 순서는 액션과 같다 — 굴림이 먼저(굴림식이 소모성 변수를 읽는다), 이벤트 자체 효과가 나중.
  // 갈림길(choices) 이벤트는 발동하면서 pendingChoice로 들어간다 — 동시 1개 상한이라,
  // 하나가 걸려 있는 동안 다른 갈림길은 (자기 자신 포함) 발동을 미룬다. 일반 이벤트는 정상.
  const checkById = Object.fromEntries((schema.checks || []).map((c) => [c.id, c]));
  for (const ev of schema.rules?.events || []) {
    if (ev.once && state.meta.firedOnce[ev.id]) continue;
    if (Array.isArray(ev.choices) && ev.choices.length && state.meta.pendingChoice) continue;
    const lookup = makeLookup(schema, state.vars);
    if (!truthy(evaluate(ev.when, lookup, null))) continue;
    let checkResult = null;
    if (ev.check && checkById[ev.check]) checkResult = rollCheck(schema, state, checkById[ev.check], rng, changeLog);
    applySets(schema, state, ev.effects, rng, changeLog, `event:${ev.id}`);
    if (ev.notify) state.meta.pendingNotifies.push(ev.notify);
    if (checkResult) {
      state.meta.pendingNotifies.push(checkResult.line);
      if (checkResult.inject) state.meta.pendingNotifies.push(checkResult.inject);
    }
    if (Array.isArray(ev.choices) && ev.choices.length) {
      state.meta.pendingChoice = { id: ev.id, turn: state.meta.turn };
      state.meta.pendingChoicePick = null;
    }
    if (ev.once) state.meta.firedOnce[ev.id] = true;
    state.meta.eventLastFired[ev.id] = state.meta.turn;
    firedEvents.push(ev.id);
  }

  // 8. 랜덤 이벤트 추첨
  const re = schema.rules?.randomEvents;
  // 발동 확률 — 숫자 또는 식 (v0.89.1). 식이면 지금 상태로 평가한다: 난이도 변수(hardship 등)를
  // 읽게 짜면 프리셋이 초기값 하나만 바꿔도 사건 빈도가 따라 움직인다 — "난이도로 조절할 값은
  // 변수로 빼고 수식이 읽게 한다" 원칙의 마지막 조각 (chancePerTurn만 상수로 남아 있었다).
  // 깨진 식은 0으로 낮춘다 (검증이 미리 잡는다 — 여기서 던지면 턴 전체가 죽는다).
  let reChance = 0;
  if (re) {
    if (typeof re.chancePerTurn === 'string') {
      try { reChance = Number(evaluate(re.chancePerTurn, makeLookup(schema, state.vars), null)); } catch { reChance = 0; }
      reChance = isFinite(reChance) ? Math.max(0, Math.min(1, reChance)) : 0;
    } else reChance = re.chancePerTurn ?? 0;
  }
  if (re && rng && rng() < reChance) {
    const eligible = (re.table || []).filter((ev) => {
      // 갈림길이 걸려 있는 동안 랜덤 갈림길도 후보에서 빠진다 (동시 1개 상한)
      if (Array.isArray(ev.choices) && ev.choices.length && state.meta.pendingChoice) return false;
      if (ev.cooldown != null) {
        const last = state.meta.eventLastFired[ev.id];
        if (last != null && state.meta.turn - last < ev.cooldown) return false;
      }
      if (ev.when) {
        const lookup = makeLookup(schema, state.vars);
        if (!truthy(evaluate(ev.when, lookup, null))) return false;
      }
      return true;
    });
    const total = eligible.reduce((s, e) => s + (e.weight ?? 1), 0);
    if (total > 0) {
      let roll = rng() * total;
      for (const ev of eligible) {
        roll -= ev.weight ?? 1;
        if (roll <= 0) {
          let checkResult = null;
          if (ev.check && checkById[ev.check]) checkResult = rollCheck(schema, state, checkById[ev.check], rng, changeLog);
          applySets(schema, state, ev.effects, rng, changeLog, `random:${ev.id}`);
          if (ev.notify) state.meta.pendingNotifies.push(ev.notify);
          if (checkResult) {
            state.meta.pendingNotifies.push(checkResult.line);
            if (checkResult.inject) state.meta.pendingNotifies.push(checkResult.inject);
          }
          if (Array.isArray(ev.choices) && ev.choices.length) {
            state.meta.pendingChoice = { id: ev.id, turn: state.meta.turn };
            state.meta.pendingChoicePick = null;
          }
          state.meta.eventLastFired[ev.id] = state.meta.turn;
          firedEvents.push(ev.id);
          break;
        }
      }
    }
  }

  // 9. 턴 카운터
  state.meta.turn += 1;

  // 이번 사이클의 원장을 새로 쓴다 (전송 단계 몫은 보조가 이미 봤으니 여기서 교체).
  recordChangeMemo(schema, state, changeLog, false);

  return { state, changeLog, firedEvents };
}

// ── 액션 토글 ───────────────────────────────────────────────

function toggleAction(schema, prevState, actionId) {
  const state = reconcileState(schema, clone(prevState));
  const action = (schema.actions || []).find((a) => a.id === actionId);
  if (!action) return { state, armed: false, blocked: '알 수 없는 액션' };
  if (state.meta.armed[actionId]) {
    delete state.meta.armed[actionId];
    return { state, armed: false };
  }
  const avail = actionAvailability(schema, state, action);
  if (!avail.ok) return { state, armed: false, blocked: avail.reason };
  state.meta.armed[actionId] = true;
  return { state, armed: true };
}

function actionAvailability(schema, state, action) {
  if (action.cooldown != null) {
    const last = state.meta.actionLastUsed[action.id];
    if (last != null && state.meta.turn - last < action.cooldown) {
      return { ok: false, reason: `쿨다운 (${action.cooldown - (state.meta.turn - last)}턴 남음)` };
    }
  }
  if (action.when) {
    const lookup = makeLookup(schema, state.vars);
    if (!truthy(evaluate(action.when, lookup, null))) return { ok: false, reason: '조건 미충족' };
  }
  return { ok: true };
}

// ── 템플릿 & 보조 모델 프롬프트 ─────────────────────────────

/**
 * @param extras 수식이 아니라 미리 만들어 둔 조각 (예: {commands}).
 *   변수보다 **먼저** 본다 — 같은 이름의 변수가 있으면 검증이 경고로 잡는다.
 */
function renderTemplate(tpl, lookup, extras = null) {
  return tpl.replace(/\{([^{}]+)\}/g, (whole, inner, idx, all) => {
    // 리수 CBS({{...}})는 통째로 남긴다 (v0.76). 우리 정규식은 안쪽 한 겹을 무는데,
    // CBS 이름이 우리 변수·시간 노출 이름과 겹치면 값이 치환돼 CBS가 깨진다.
    // (실측: 시간 체계를 켠 봇에서 `{{date}}` → `{3월 12일}`. 겹치지 않는 이름은
    //  evaluate가 던져 우연히 살아남고 있었을 뿐이라, 이름 운에 맡길 수 없다.)
    // 이걸 남겨야 상태창 템플릿에서 `{{img::지도}}` 같은 에셋 참조를 쓸 수 있다.
    if (all[idx - 1] === '{' && all[idx + whole.length] === '}') return whole;
    try {
      let expr = inner.trim();
      if (extras && Object.prototype.hasOwnProperty.call(extras, expr)) return extras[expr];
      let filter = null;
      const m = expr.match(/^(.*?):(tags)$/); // {inventory:tags} → 칩 목록 HTML
      if (m) { expr = m[1].trim(); filter = m[2]; }
      const v = evaluate(expr, lookup, null);
      if (filter === 'tags') {
        const arr = Array.isArray(v) ? v : [String(v)];
        return arr.length
          ? arr.map((x) => `<span class="sim-tag">${escapeHtml(String(x))}</span>`).join('')
          : '<span class="sim-empty">없음</span>';
      }
      if (Array.isArray(v)) return v.length ? v.join(', ') : '(없음)';
      return String(v);
    } catch {
      return `{${inner}}`;
    }
  });
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 보조 모델에 보낼 프롬프트 생성 (어댑터가 LLM 호출에 사용) */
/** 최근 대화를 보조모델용 한 덩어리 텍스트로. 비면 빈 문자열 (프롬프트에서 통째로 빠진다) */
function formatHistory(msgs) {
  const lines = (msgs || [])
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => `${m.role === 'user' ? '유저' : '상대'}: ${m.text.trim()}`);
  return lines.length ? '[앞선 대화 흐름 — 참고용]\n' + lines.join('\n') : '';
}

/**
 * 이번 턴에 실제로 열어 줄 변수만 골라낸다 — 로어북 키워드와 같은 방식이다.
 *
 * ⚠ `updater.allow`에는 조건식(when)을 못 단다. 달아 봐야 소용도 없다 —
 *   "이번 턴에 그 사람이 나왔나"는 변수가 아니라 **서사 원문**에만 있는 정보라서다.
 *   그래서 조건이 아니라 낱말로 건다: `mentions`에 적은 말이 이번 턴 글에 있어야 열린다.
 *   (`mentions: true`면 그 변수의 label을 낱말로 쓴다 — 인물 호감도는 label이 곧 이름이다)
 *
 * 왜 하는가: 인물이 스물여섯이면 매 턴 스물여섯 줄이 나가고, 모델은 그걸 전부
 * "건드려도 되는 것"으로 읽는다. 등장하지도 않은 사람의 호감도가 분위기상 ±1씩 움직이면
 * 상한도 소용이 없다 — 상한은 크기를 막지 빈도를 못 막는다.
 *
 * @param text 이번 턴 서사 + 유저 발화 (+ 배경 대화). 비워 두면 낱말 필터를 거르지 않는다(구버전 호환).
 * @param state 현재 상태 (선택). 주면 whenArmed(액션 잠금) 게이트도 적용한다 —
 *   그 액션이 무장 중이거나 이번 전송에서 발동한 턴에만 열린다. 낱말과 달리 언어 무관·결정적이라
 *   "개인 지갑과 대장간 금고" 같은 이중 장부 상황에서 귀속 오류를 원천 차단한다.
 */
function actionGateOpen(state, ids) {
  const m = state?.meta || {};
  return [].concat(ids).some((id) => (m.armed && m.armed[id]) || (m.firedThisSend && m.firedThisSend[id]));
}

function auxAllowList(schema, text, state = null) {
  let allow = schema.updater?.allow || [];
  // 액션 잠금 — 낱말 필터보다 먼저, 상태만 있으면 텍스트 없이도(브리지 소급 적용) 작동한다
  if (state) allow = allow.filter((a) => !a.whenArmed || actionGateOpen(state, a.whenArmed));
  // 갈림길 대기 중엔 그 선택지들이 만질 변수만 잠깐 뺀다 — 서사가 결과를 앞질러 굳히는 것을 막는다.
  // 전부 잠그면 선택과 무관한 값(호감도 등)까지 얼어붙으므로, 해당 변수만이다.
  if (state?.meta?.pendingChoice) {
    const ev = findChoiceEvent(schema, state.meta.pendingChoice.id);
    const frozen = new Set((ev?.choices || [])
      .flatMap((c) => (c.effects || []).map((f) => f.set ?? f.list)).filter(Boolean));
    if (frozen.size) allow = allow.filter((a) => !frozen.has(a.id));
  }
  if (text == null) return allow;
  const hay = String(text).toLowerCase();
  const varById = Object.fromEntries(schema.vars.map((v) => [v.id, v]));
  const keysOf = (a) => (a.mentions === true ? [varById[a.id]?.label ?? a.id] : [].concat(a.mentions))
    .filter((k) => typeof k === 'string' && k.trim()).map((k) => k.toLowerCase());

  // 이번 글에 실제로 등장한 낱말 전부. 아래 '가려짐' 판정의 재료다.
  const present = [];
  for (const a of allow) {
    if (!a.mentions) continue;
    for (const k of keysOf(a)) if (hay.includes(k)) present.push(k);
  }

  // ⚠ 한국어는 이름이 서로 겹치고("릴리아나" 안에 "리아나"가 있다) 조사가 붙어 단어 경계를 못 쓴다.
  //   그냥 부분일치로 두면 릴리아나가 나올 때마다 리아나 백작까지 열린다.
  //   그래서 **더 긴 낱말에 통째로 가려진 자리는 안 친다.** 걸린 자리가 전부 그렇다면 등장한 게 아니다.
  //   ("리아나 백작이 왔다"는 릴리아나가 없으니 그대로 걸리고, "릴리아나가 왔다"는 가려져 안 걸린다)
  const reallyIn = (k) => {
    const longer = present.filter((o) => o.length > k.length && o.includes(k));
    if (!longer.length) return hay.includes(k);
    for (let i = hay.indexOf(k); i >= 0; i = hay.indexOf(k, i + 1)) {
      const covered = longer.some((o) => {
        for (let j = hay.indexOf(o); j >= 0; j = hay.indexOf(o, j + 1)) {
          if (j <= i && j + o.length >= i + k.length) return true;
        }
        return false;
      });
      if (!covered) return true;   // 가려지지 않은 자리가 하나라도 있으면 진짜 등장이다
    }
    return false;
  };

  // 감지 신고 해제 (v0.74) — 지난 출력이 "서사가 이 변수의 변화를 서술했다"고 신고한 변수는
  // 이번 전송 한 번만 낱말 없이도 열린다. **낱말 필터만** 우회한다 — whenArmed·갈림길 동결은
  // 위에서 이미 걸러져 여기 오지도 않으므로, 신고로는 결정적 잠금을 못 푼다.
  const unlocked = state?.meta?.wordUnlock || {};
  return allow.filter((a) => !a.mentions || unlocked[a.id] || keysOf(a).some(reallyIn));
}

/**
 * @param historyText formatHistory()의 결과 (선택). 이번 턴 판단의 배경 맥락으로만 쓴다
 * @param opts.allowAll mentions 필터를 끈다. 루아 브리지는 서사 자리에 자리표시자를 박아
 *   **설치 시점에 한 번** 템플릿을 굽기 때문에, 여기서 거르면 mentions 변수가 영영 닫힌다.
 */
function buildAuxPrompt(schema, state, narrative, userText, historyText, opts = {}) {
  const varById = Object.fromEntries(schema.vars.map((v) => [v.id, v]));
  // 프롬프트와 적용이 같은 함수로 같은 글을 봐야 어긋나지 않는다.
  // 안 보여 준 변수를 나중에 받아 주면 거르는 의미가 없어진다.
  // allowAll(루아 브리지 템플릿 굽기)에서는 state도 안 넘긴다 — 설치 시점의 무장 상태로
  // 굳어버리면 whenArmed 변수가 템플릿에서 영영 빠진다. 브리지의 게이트는 적용 시점에 걸린다.
  const allow = auxAllowList(schema,
    opts.allowAll ? null : [narrative, userText, historyText].filter(Boolean).join('\n'),
    opts.allowAll ? null : state);
  const specs = allow.map((a) => {
    const v = varById[a.id];
    if (!v) return null;
    const cur = JSON.stringify(state.vars[a.id]);
    const desc = v.desc ? ` — ${v.desc}` : '';
    if (v.type === 'int' || v.type === 'float') {
      const gainCap = a.maxGain ?? a.maxDelta;
      const lossCap = a.maxLoss ?? a.maxDelta;
      const capDesc = (gainCap != null || lossCap != null)
        ? `증가 최대 +${gainCap ?? '무제한'}, 감소 최대 -${lossCap ?? '무제한'}`
        : '한도 무제한';
      return `- ${a.id} (${v.label ?? a.id}, 숫자): 현재 ${cur}. 변화량(델타)으로 제시. ${capDesc}${desc}`;
    }
    if (v.type === 'enum')
      return `- ${a.id} (${v.label ?? a.id}, 선택): 현재 ${cur}. 다음 중 하나로만: ${v.enum.join(' | ')}${desc}`;
    if (v.type === 'bool')
      return `- ${a.id} (${v.label ?? a.id}, 참/거짓): 현재 ${cur}. true 또는 false로 제시${desc}`;
    if (v.type === 'list')
      return `- ${a.id} (${v.label ?? a.id}, 목록): 현재 ${cur}. {"add": ["얻은 것"], "remove": ["잃은 것"]} 연산으로만 제시 (전체 교체 금지, 최대 ${v.maxItems ?? DEFAULT_LIST_MAX_ITEMS}개)${desc}`;
    return `- ${a.id} (${v.label ?? a.id}, 텍스트): 현재 ${cur}. 새 값 전체를 제시 (${a.maxLength ?? v.maxLength ?? DEFAULT_TEXT_MAXLEN}자 이내)${desc}`;
  }).filter(Boolean).join('\n');

  // 에셋 이미지 피기백 (by:'aux') — 상태 갱신 호출에 얹어 추가 비용 0으로 받는다.
  // 브리지 템플릿 굽기(allowAll)에는 안 얹는다 — 브리지는 changes/reasons만 회수한다 (retro 제약).
  const imgSpec = (!opts.allowAll && state)
    ? auxImageSpec(schema, makeLookup(schema, state.vars)).instruction : '';

  // 조정할 변수가 하나도 없는 호출 — 에셋 전용 봇(변수 0개)이거나 이번 턴에 mentions 게이트가
  // 전부 닫힌 경우다. 그때 "상태 변수의 변화만 출력하라 / [조정 가능 변수] (빈칸)"을 그대로 보내면
  // 시킨 일이 없는 지시서가 된다 — 모델이 image·suggest까지 같이 흘려버린다.
  // JSON 겉껍데기(changes/reasons)는 그대로 둔다: 파서·적용 경로가 한 갈래로 유지된다.
  const noVars = !specs;

  // 지금 몇 시인가 (v0.65) — 없으면 "밤까지 잤다" 같은 **절대 시점** 서술을 델타로 바꿀 수가 없다.
  // 상대량("3일 후")은 글에 답이 적혀 있어 시계 없이도 되지만, 한국어 RP의 시간 표현은
  // 대부분 절대 시점이다. 실측 사고: 큰 도약 한 번 뒤 매 턴 500분씩 밀림 — 보조는 자기가
  // 방금 민 시계를 확인할 방법이 없어 매번 처음처럼 "저녁까지의 간격"을 다시 넣고 있었다.
  // ⚠ 루아 브리지(allowAll)에는 안 싣는다. 브리지는 설치 시점에 템플릿을 한 번 굽고
  // 실행 때 `⟦cur:id⟧`를 채팅 변수로 치환하는데, 그 치환 목록이 schema.vars 뿐이라
  // 엔진 예약 키인 time_epoch은 채워지지 않는다. 게다가 채워 봐야 분 단위 정수라
  // 루아 쪽에 달력 산술이 또 필요하다 — 이미지가 없는 것과 같은 계열의 브리지 제약.
  const cfg = opts.allowAll ? null : timeConfig(schema);
  let nowLine = null;
  if (cfg && state && typeof state.vars?.[EPOCH_KEY] === 'number') {
    const cal = calendarOf(state.vars[EPOCH_KEY], cfg.calendar);
    nowLine = `[지금] ${formatDate(cfg.dateFmt, cal)} (${cfg.weekdays[cal.wd]}) ${formatClock(cfg.clockFmt, cal)}`;
  }
  // 이미 반영된 변화 — 끝난 일이라고 못 박아 이중 계산을 막는다.
  // 브리지 템플릿 굽기(allowAll)에는 안 싣는다: 설치 시점에 한 번 구워지므로 그때의 원장이
  // 영영 박혀 매 턴 거짓말이 된다.
  const memo = (!opts.allowAll && state?.meta?.lastChanges?.length) ? state.meta.lastChanges : null;
  // 시간 규칙은 보조가 실제로 시간을 만질 수 있을 때만 (skip 우편함이 열려 있어야 뜻이 있다)
  const timeRule = nowLine && allow.some((a) => a.id === SKIP_DAY || a.id === SKIP_MIN);

  // 신고 전용 불일치 채널 (v0.71) — 허용 목록에 아예 없는 변수 = 서사가 손대면 안 되는
  // 시스템 항목(경성 축)이다. 서사가 그 변화를 선언하면 **보고만** 받는다: changes에 못
  // 실리니 변수는 안전하고, 통지로만 흘러 유저와 다음 턴 서사가 불일치를 알게 된다.
  // 브리지 템플릿 굽기(allowAll)에는 안 싣는다 — 브리지는 changes/reasons만 회수한다.
  const allowedIds = new Set((schema.updater?.allow || []).map((a) => a.id));
  const systemLabels = (!opts.allowAll && !noVars)
    ? schema.vars.filter((v) => !allowedIds.has(v.id)).map((v) => v.label ?? v.id).slice(0, 24)
    : [];

  // 감지 신고 채널 (v0.74) — 낱말 게이트에만 닫힌 변수의 **label만** 싣는다 (현재값·상한은
  // 안 준다 — 조정 대상이 아니라 감지 대상이다). auxAllowList(null, state)는 낱말 필터 없이
  // whenArmed·갈림길 동결만 적용한 목록이라, 그 차집합이 "낱말 때문에 닫힌 것"과 정확히 같다.
  // whenArmed·동결로 닫힌 변수는 여기 안 실린다 — 결정적 잠금은 신고로도 못 연다.
  // 브리지 굽기(allowAll)에는 안 싣는다 — 설치 시점에 한 번 구워져 잠김 목록이 거짓말이 된다.
  const openIds = new Set(allow.map((a) => a.id));
  const detectable = (!opts.allowAll && state && schema.updater?.wordDetect !== false)
    ? auxAllowList(schema, null, state).filter((a) => a.mentions && !openIds.has(a.id)).slice(0, 24)
    : [];
  // 지난 턴 신고로 이번 턴만 열린 변수 — "앞선 대화 재계산 금지" 규칙의 명시적 예외를 달아야
  // 한다. 변화가 일어난 서사는 지난 턴 글이라, 예외 없이는 열어 줘도 모델이 스스로 버린다.
  const unlockedNow = allow.filter((a) => state?.meta?.wordUnlock?.[a.id]);

  return [
    noVars
      ? '너는 장면 분석기다. 아래 서사를 읽고 아래에서 요청한 항목만 JSON으로 출력하라.'
      : '너는 시뮬레이션 상태 관리자다. 아래 서사를 읽고 상태 변수의 변화만 JSON으로 출력하라.',
    '',
    nowLine, nowLine ? '' : null,
    noVars ? null : '[조정 가능 변수]', noVars ? null : specs, noVars ? null : '',
    memo ? '[직전 보조 호출 이후 이미 반영된 변화]' : null,
    memo ? memo.join('\n') : null, memo ? '' : null,
    historyText || null, historyText ? '' : null,
    userText ? '[유저의 행동/발화]' : null, userText || null, userText ? '' : null,
    '[이번 턴 서사]', narrative, '',
    '[규칙]',
    noVars
      ? '- 조정할 변수가 없다. changes와 reasons는 항상 빈 객체로 두어라.'
      : '- 유저의 행동과 서사에 명시적으로 드러난 변화만 반영하라. 언급 없는 변수는 포함하지 마라.',
    memo ? '- 위 "이미 반영된 변화"는 시스템이 이미 끝낸 일이다. 같은 것을 다시 세지 마라. 이번 턴 서사에서 **새로** 일어난 것만 보고하라.' : null,
    historyText ? '- 앞선 대화는 맥락 파악용이다. 거기서 이미 반영된 변화를 다시 세지 마라. 이번 턴 서사에서 새로 일어난 것만 반영하라.' : null,
    // 시간 — 절대 시점 서술("저녁이 되었다")을 [지금] 기준의 델타로 바꾸게 한다
    timeRule ? `- 시간은 [지금] 시각 이후로 **새로** 흐른 만큼만 보고하라. [지금]이 이미 밤이면 "밤이 되었다"는 서술에 시간을 더 밀지 마라. 자정을 넘길 때만 ${SKIP_DAY}를 올리고, ${SKIP_MIN}에는 그날 안에서 흐른 분만 담아라.` : null,
    noVars ? null : '- 정기 수입·소비·시스템 이벤트로 인한 변화는 시스템이 별도 계산하니 반영하지 마라.',
    systemLabels.length
      ? `- 서사가 시스템 관리 항목(${systemLabels.join(', ')})의 변화를 명시적으로 선언했다면 그 값을 조정하려 하지 말고, "conflicts" 배열에 "무엇이 어떻게 선언됐는지"를 한 줄 문자열로 보고하라 (최대 3건). 선언이 없으면 conflicts를 아예 넣지 마라.`
      : null,
    detectable.length
      ? `- 다음 변수는 이번 턴 잠겨 있다: ${detectable.map((a) => `${varById[a.id]?.label ?? a.id}(${a.id})`).join(', ')}. 서사가 이들의 변화를 **명백히 서술**했을 때만 그 id를 "detected" 배열로 보고하라 (최대 4개, changes에는 넣지 마라 — 다음 턴에 열린다). 분위기·추측으로 넣지 말고, 서술이 없으면 detected를 아예 넣지 마라.`
      : null,
    unlockedNow.length
      ? `- ${unlockedNow.map((a) => `${varById[a.id]?.label ?? a.id}(${a.id})`).join(', ')} 변수는 지난 턴 감지 신고로 이번 턴만 열렸다. **지난 턴 서사**에서 일어난 그 변화를 이번 changes에 반영하라 (앞선 대화 재계산 금지 규칙의 예외다. 단, 위 "이미 반영된 변화"에 있는 것은 여전히 다시 세지 마라).`
      : null,
    noVars || !schema.updater?.guide ? null : `- ${schema.updater.guide}`,
    // 다음 행동 제안 (v0.43, 옵트인) — 같은 호출에 얹어 추가 비용 없이 받는다
    schema.suggest ? '' : null,
    schema.suggest ? `- 이어서 "suggest"에 유저가 다음에 입력할 만한 행동 제안 ${Math.min(Math.max(schema.suggest.count ?? 3, 2), 4)}개를 담아라. 각각 유저 시점의 짧은 한 문장(40자 이내), 서로 다른 방향으로.${schema.suggest.guide ? ` ${schema.suggest.guide}` : ''}` : null,
    '',
    '출력 형식 (JSON만, 다른 텍스트 금지):',
    noVars
      ? (schema.suggest
        ? '{"changes": {}, "reasons": {}, "suggest": ["행동 제안", "행동 제안"]}'
        : '{"changes": {}, "reasons": {}}')
      : (schema.suggest
        ? '{"changes": {"변수id": 값}, "reasons": {"변수id": "한 줄 사유"}, "suggest": ["행동 제안", "행동 제안"]}'
        : '{"changes": {"변수id": 값}, "reasons": {"변수id": "한 줄 사유"}}'),
    noVars ? null
      : (schema.suggest ? '변화가 없으면 changes와 reasons는 빈 객체로 두되 suggest는 항상 채워라' : '변화가 없으면 {"changes": {}, "reasons": {}}'),
    imgSpec ? '' : null,
    imgSpec || null,
  ].filter((x) => x !== null).join('\n');
}

/**
 * 이번 턴 보조 호출에 시킬 일이 있나 — 호출을 건너뛸지 판단하는 유일한 기준.
 *
 * ⚠ 예전에는 `updater.allow.length > 0`으로만 판단했다. 그런데 상태 갱신 호출에는 이미지와
 * 행동 제안이 **얹혀 간다**(추가 호출 0이 설계의 핵심). 그래서 변수가 없는 봇 —
 * 에셋만 쓰려고 만든 봇 — 에서는 호출 자체가 건너뛰어져 이미지가 영영 안 붙었다.
 * 얹혀 가는 것이 하나라도 있으면 부른다.
 *
 * @param state 이미지 팩 게이트(when) 판정용. 없으면 팩 존재만으로 본다.
 */
function auxHasWork(schema, state = null) {
  if ((schema?.updater?.allow?.length ?? 0) > 0) return true;
  if (schema?.suggest) return true;
  // 이미지 — 'main'은 본 프롬프트에 직접 주입되므로 보조 호출과 무관하다.
  // 게이트가 전부 닫힌 턴에는 지시문이 비므로 그때는 부를 이유가 없다.
  if ((schema?.assets?.packs?.length ?? 0) > 0) {
    const by = schema.assets.by ?? 'aux';
    if (by === 'aux' || by === 'aux_flow') {
      if (!state) return true; // 상태를 모르면 있다고 본다 — 건너뛰어 잃는 쪽이 더 나쁘다
      if (auxImageSpec(schema, makeLookup(schema, state.vars)).instruction) return true;
    }
  }
  return false;
}

// ── 채팅 명령 ────────────────────────────────────────────────
// 배포받은 유저는 플러그인 패널을 안 연다. 그런데 "이번에 맺은 계약"처럼 제작자가 미리
// 알 수 없는 것은 누군가 손으로 넣어야 한다. 액션 버튼으로는 안 된다 — 버튼은 미리 정해둔
// 것만 누를 수 있고, 계약 이름과 금액은 유저가 그 자리에서 적어야 하는 값이다.
// 그래서 채팅 입력창에 치는 명령으로 받는다. 변수에 `cmd`를 달아 두면 열린다.
//
//   /계약 헤세 상단 양모 +12 @+1080   목록에 추가 (int면 델타, text/enum이면 대입)
//   /계약- 헤세 상단 양모             목록에서 제거
//
// 명령 줄은 모델에게 가기 전에 확인 문구로 바뀐다. 지우지 않는 이유는 두 가지다:
// ① 유저 메시지가 통째로 비면 빈 턴이 된다 ② 모델이 등록 사실을 알아야 그에 맞게 서술한다.
const CMD_LINE_RE = /^[ \t]*\/([^\s\/-][^\s-]*)(-?)[ \t]*(.*)$/;

/**
 * 이 스키마가 열어 둔 채팅 명령 목록.
 *
 * ⚠ 명령 이름은 플러그인이 아니라 **제작자**가 변수마다 붙인다. 그래서 유저는 자기가 쓰는 봇에
 *   무슨 명령이 있는지 알 방법이 없었다 — 상태창 {commands}와 편집기 명령 탭이 여기서 같이 읽어
 *   서로 어긋나지 않게 한다. 문법은 손으로 적는 게 아니라 **변수 타입이 정한다.**
 */
function commandSpecs(schema) {
  return (schema.vars || []).filter((v) => v.cmd).map((v) => {
    const c = `/${v.cmd}`;
    const en = v.enum || [];
    const usage = v.type === 'list'
      ? [[`${c} 내용`, '목록에 넣는다'], [`${c}- 내용 일부`, '목록에서 뺀다 — 일부만 써도 찾는다']]
      : (v.type === 'int' || v.type === 'float')
        ? [[`${c} +5`, '지금 값에서 더하거나 뺀다 (-5도 같다)'], [`${c} 30`, '부호가 없으면 그 값으로 지정한다']]
        : v.type === 'enum'
          ? [[`${c} ${en.slice(0, 3).join(' / ')}${en.length > 3 ? ' / …' : ''}`, '선택지 중 하나로 바꾼다']]
          : v.type === 'bool'
            ? [[`${c} on`, '켠다 (끄려면 0 / false)']]
            : [[`${c} 내용`, '적은 그대로 넣는다']];
    return { cmd: v.cmd, id: v.id, label: v.label ?? v.id, type: v.type, usage };
  });
}

/**
 * 제거 명령의 인자를 실제 항목에 맞춘다.
 *
 * ⚠ 목록 제거는 완전일치라서, 유저가 친 `/계약- 헤세 상단 양모`로는
 *   `"헤세 상단 양모 +12 @1093"`이 안 지워졌다. 금액이야 안다 쳐도 `@1093`은
 *   시스템이 굳힌 값이라 유저가 알 방법이 없다 — 제거가 사실상 막혀 있었다.
 *   (AI는 목록 현재값을 보고 쓰니 완전일치로 충분하다. 사람만 못 맞춘다.)
 *
 * 완전일치 → 앞머리 → 부분일치 순으로 좁힌다. 하나로 안 좁혀지면 후보를 돌려주고
 * 부르는 쪽이 되묻는다 — 여럿 중 아무거나 지우는 건 조용히 틀리는 것보다도 나쁘다.
 * @returns {string|string[]|null} 항목 하나 / 후보 여럿 / 없음
 */
function matchListItem(list, arg) {
  const arr = Array.isArray(list) ? list : [];
  const a = String(arg).trim();
  if (arr.includes(a)) return a;
  const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
  const na = norm(a);
  if (!na) return null;
  for (const pick of [arr.filter((it) => norm(it).startsWith(na)),
    arr.filter((it) => norm(it).includes(na))]) {
    if (pick.length === 1) return pick[0];
    if (pick.length > 1) return pick;
  }
  return null;
}

/** 이 목록이 어딘가에서 sum()으로 합산되는가 — 그렇다면 항목 끝의 숫자가 의미를 갖는다 */
function isSummedList(schema, id) {
  const re = new RegExp(`sum\\s*\\(\\s*${id}\\b`);
  const exprs = [
    ...(schema.derived || []).map((d) => d.expr),
    ...(schema.rules?.onTurn || []).map((r) => r.expr || r.expire),
    ...(schema.rules?.events || []).flatMap((e) => [e.when, ...(e.effects || []).map((f) => f.expr)]),
    ...(schema.directives || []).map((d) => d.when),
    ...(schema.actions || []).flatMap((a) => [a.when, ...(a.effects || []).map((f) => f.expr)]),
  ];
  return exprs.some((e) => typeof e === 'string' && re.test(e));
}

/**
 * 유저 입력에서 채팅 명령을 뽑아 적용한다. 순수 함수 — state를 직접 고치지 않고 새 vars를 돌려준다.
 * 모르는 명령은 손대지 않는다 (유저가 그냥 '/'로 시작하는 말을 썼을 수 있다).
 * @returns {{ text: string, applied: Array, vars: object }}
 */
function applyChatCommands(schema, state, text, rng) {
  const byCmd = {};
  for (const v of schema.vars) if (v.cmd) byCmd[v.cmd] = v;
  // /선택은 변수 명령이 아니라 갈림길(choices) 내장 명령 — 갈림길이 있는 스키마면 항상 열린다
  const hasChoices = [...(schema.rules?.events || []), ...(schema.rules?.randomEvents?.table || [])]
    .some((e) => Array.isArray(e.choices) && e.choices.length);
  // /액션도 내장 — 우상단 플로팅 버튼이 v0.55에서 사라져서, 클릭 조작(mainDom)이 거부된
  // 환경에서는 이 명령이 액션을 켜는 유일한 통로다. 상태창 범례가 이름을 보여준다.
  const hasActions = (schema.actions || []).length > 0;
  // /날짜도 내장 — 시간 체계를 켠 봇이면 항상 열린다 (아래 분기 주석 참고)
  const cmdTcfg = timeConfig(schema);
  if ((!Object.keys(byCmd).length && !hasChoices && !hasActions && !cmdTcfg) || !text || !text.includes('/')) {
    return { text, applied: [], vars: state.vars, pick: null, meta: null };
  }
  const vars = { ...state.vars };
  const applied = [];
  let pick = null;
  let meta = null; // /액션이 무장을 바꿨을 때만 채워진다 — 호스트가 state.meta에 반영
  const out = text.split('\n').map((line) => {
    const m = line.match(CMD_LINE_RE);
    if (!m) return line;
    const [, cmd, minus, argRaw] = m;
    // 액션 토글 — toggleAction과 같은 검증(쿨다운·when)을 그대로 탄다
    if (cmd === '액션' && !byCmd['액션'] && hasActions) {
      const arg = argRaw.trim();
      const acts = schema.actions;
      const labels = acts.map((a) => String(a.label ?? a.id));
      const usage = () => {
        const armedSet = (meta ?? state.meta)?.armed || {};
        return `(시스템: 액션 — 이렇게 켜고 끕니다: ${acts.map((a) =>
          `/액션 ${a.label ?? a.id}${armedSet[a.id] ? ' [켜짐]' : ''}`).join(' · ')})`;
      };
      if (!arg) return usage();
      let idx = -1;
      if (/^\d+$/.test(arg)) idx = Number(arg) - 1;
      else {
        const hit = matchListItem(labels, arg) ?? matchListItem(acts.map((a) => a.id), arg);
        if (Array.isArray(hit)) return `(시스템: 액션 — '${arg}'에 여럿이 걸립니다: ${hit.join(' / ')}. 더 길게 적어 주세요)`;
        if (hit !== null) idx = labels.indexOf(hit) >= 0 ? labels.indexOf(hit) : acts.findIndex((a) => a.id === hit);
      }
      if (idx < 0 || idx >= acts.length) return usage();
      const a = acts[idx];
      // 명령 앞줄이 변수를 바꿨을 수 있으니 지금까지의 vars로 판정한다 (클릭 조작과 같은 검증기)
      const r = toggleAction(schema, { ...state, vars: { ...vars }, meta: meta ?? state.meta }, a.id);
      if (r.blocked) return `(시스템: 액션 ${a.label ?? a.id} — ${r.blocked})`;
      meta = r.state.meta;
      applied.push({ id: `action:${a.id}`, from: !r.armed, to: r.armed, how: r.armed ? '무장' : '해제' });
      return `(시스템: 액션 ${a.label ?? a.id} — ${r.armed ? '켜짐 ●' : '꺼짐'})`;
    }
    // 갈림길 선택 — 기록만 한다. 집행(효과·주입)은 다음 전송 단계의 것 (rand·변화 로그·리롤 안정)
    if (cmd === '선택' && !byCmd['선택'] && hasChoices) {
      const arg = argRaw.trim();
      const pc = state.meta?.pendingChoice;
      const ev = pc ? findChoiceEvent(schema, pc.id) : null;
      if (!ev) return '(시스템: 지금 고를 선택지가 없음)';
      const labels = ev.choices.map((c) => String(c.label ?? ''));
      let idx = -1;
      if (/^\d+$/.test(arg)) idx = Number(arg) - 1;
      else if (arg) {
        const hit = matchListItem(labels, arg);
        if (Array.isArray(hit)) return `(시스템: 선택 — '${arg}'에 여럿이 걸립니다: ${hit.join(' / ')}. 번호로 고르세요)`;
        if (hit !== null) idx = labels.indexOf(hit);
      }
      if (idx < 0 || idx >= labels.length) {
        return `(시스템: 선택 — 이렇게 고르세요: ${labels.map((l, i) => `/선택 ${i + 1} (${l})`).join(' · ')})`;
      }
      // 명령 앞줄이 변수를 바꿨을 수 있으니 지금까지의 vars로 검증한다 (클릭 조작과 같은 검증기)
      const v = pickChoice(schema, { meta: state.meta, vars }, idx);
      if (!v.ok) return `(시스템: 선택 — ${v.reason})`;
      pick = idx;
      applied.push({ id: `choice:${ev.id}`, from: null, to: v.label, how: '선택' });
      return `(시스템: 선택 — ${idx + 1}. ${v.label})`;
    }
    // 날짜 세팅 (v0.61.1) — 시계(time_epoch)는 세이브에 산다. 시간 탭의 시작값을 고쳐도
    // 진행 중인 채팅에는 소급되지 않고(실측 문의: "작중은 10월인데 상태창이 3월"),
    // 보조 AI의 skip 보고는 캡이 있어 몇 달을 못 건넌다. 진행 중 시계를 맞추는 직통로.
    if (cmd === '날짜' && !byCmd['날짜'] && cmdTcfg) {
      const arg = argRaw.trim();
      const from = Number(vars[EPOCH_KEY] ?? cmdTcfg.startEpoch);
      const curCal = calendarOf(from, cmdTcfg.calendar);
      const show = (cal2) => `${formatDate(cmdTcfg.dateFmt, cal2)} (${cmdTcfg.weekdays[cal2.wd]}) ${formatClock(cmdTcfg.clockFmt, cal2)}`;
      if (!arg) {
        return `(시스템: 날짜 — 지금 ${show(curCal)}. 이렇게 맞춥니다: /날짜 2026-10-05 또는 /날짜 2026-10-05 14:00)`;
      }
      const parts = parseStart(arg, cmdTcfg.calendar);
      if (!parts) {
        return `(시스템: 날짜 — '${arg}'를 읽을 수 없음. "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm" 형식의 실재하는 날짜여야 합니다)`;
      }
      // 시각을 안 적었으면 지금 시각을 유지한다 — 보통은 날짜만 옮기고 싶은 것이다
      if (!arg.includes(':')) { parts.h = curCal.h; parts.mi = curCal.mi; }
      const toEpoch = epochFrom(parts, cmdTcfg.calendar);
      if (toEpoch === from) return '(시스템: 날짜 — 바뀐 것 없음)';
      vars[EPOCH_KEY] = toEpoch;
      applied.push({ id: EPOCH_KEY, from, to: toEpoch, how: '날짜 지정' });
      return `(시스템: 날짜 — ${show(calendarOf(toEpoch, cmdTcfg.calendar))}로 맞춤)`;
    }
    const def = byCmd[cmd];
    if (!def) return line;                     // 모르는 명령 — 유저 글이다, 건드리지 않는다
    const arg = argRaw.trim();
    const from = vars[def.id];
    let to, how, removed = null;
    if (def.type === 'list') {
      if (!arg) return line;
      if (minus) {
        // 유저는 항목을 글자까지 외우고 있지 않다. 앞머리만 맞아도 찾아 준다.
        const hit = matchListItem(from, arg);
        if (hit === null) {
          return `(시스템: ${def.label ?? def.id} — '${arg}'와 맞는 항목이 없음)`;
        }
        if (Array.isArray(hit)) {
          return `(시스템: ${def.label ?? def.id} — '${arg}'에 여럿이 걸립니다: ${hit.join(' / ')}`
            + '. 지울 것 하나만 가려지게 더 적어 주세요)';
        }
        removed = hit;
        to = applyListOps(def, from, { remove: [hit] }); how = '제거';
      } else {
        const add = resolveRelativeExpiry(schema, { vars }, def.id, [arg], rng);
        to = applyListOps(def, from, { add }); how = '등록';
      }
    } else if (def.type === 'int' || def.type === 'float') {
      const n = Number(arg.replace(/\s/g, ''));
      if (!isFinite(n)) return line;
      // 부호를 붙였으면 증감, 안 붙였으면 그 값으로 지정
      to = coerce(def, /^[+-]/.test(arg.trim()) ? Number(from) + n : n);
      how = /^[+-]/.test(arg.trim()) ? '조정' : '지정';
    } else {
      if (!arg && def.type !== 'text') return line;
      to = coerce(def, def.type === 'bool' ? truthy(arg) : arg);
      how = '지정';
    }
    // 거부와 '변화 없음'은 다르다. 거부는 왜 거부됐는지 말해 줘야 유저가 고칠 수 있다.
    if (to === undefined) {
      const why = def.type === 'enum' ? `${def.enum.join(' | ')} 중 하나여야 함` : '값을 받아들일 수 없음';
      return `(시스템: ${def.label ?? def.id} — '${arg}' 거부됨, ${why})`;
    }
    if (JSON.stringify(to) === JSON.stringify(from)) {
      return `(시스템: ${def.label ?? def.id} — 바뀐 것 없음)`;
    }
    // sum()으로 합산되는 목록에 숫자 없는 항목이 들어가면 조용히 0이 된다.
    // "나무 +12G"처럼 단위를 붙이는 건 사람이 제일 자연스럽게 저지르는 실수다.
    // 등록되는 그 순간 눈앞에서 알려 줘야 고칠 수 있다.
    if (def.type === 'list' && !minus && isSummedList(schema, def.id) && itemValue(arg) === null) {
      vars[def.id] = to;
      applied.push({ id: def.id, from, to, how: '등록' });
      return `(시스템: ${def.label ?? def.id} 등록 — ${arg}`
        + ` ⚠ 끝이 숫자가 아니라 합산에서 0으로 잡힙니다. 단위를 빼고 "… +12"처럼 숫자로 끝내세요)`;
    }
    vars[def.id] = to;
    applied.push({ id: def.id, from, to, how });
    // 목록은 방금 건드린 항목만 보여준다. 제거는 유저가 친 말이 아니라
    // **실제로 지워진 항목**을 되돌려 준다 — 앞머리만 쳤을 때 뭐가 지워졌는지 확인할 자리다.
    const shown = Array.isArray(to)
      ? (minus ? (removed ?? arg) : (to[to.length - 1] ?? arg))
      : String(to);
    return `(시스템: ${def.label ?? def.id} ${how} — ${shown})`;
  }).join('\n');
  return { text: out, applied, vars, pick, meta };
}

/** 보조 모델 응답 파싱 (관대하게: <Thoughts> 서두/코드펜스/앞뒤 잡담 허용) */
function parseAuxResponse(text) {
  const obj = extractJsonObject(text, 'changes');
  if (!obj) return null;
  return { changes: obj.changes || {}, reasons: obj.reasons || {}, suggest: obj.suggest ?? null,
    conflicts: Array.isArray(obj.conflicts) ? obj.conflicts : null,
    detected: Array.isArray(obj.detected) ? obj.detected : null, // 감지 신고 (v0.74) — 다음 턴 1회 해제
    image: obj.image ?? null, images: Array.isArray(obj.images) ? obj.images : null };
}

module.exports = {
  initState, clone, reconcileState, makeLookup, coerce, applyListOps, applyChangesToState, resolveRelativeExpiry, sanitizeSuggestions, sanitizeConflicts, sanitizeDetected, consumeTimeSkips,
  sendPhase, outputPhase, toggleAction, actionAvailability, rollCheck, findChoiceEvent, pickChoice,
  renderTemplate, buildAuxPrompt, auxAllowList, auxHasWork, actionGateOpen, parseAuxResponse, extractJsonObject, formatHistory, applyChatCommands, commandSpecs,
  isSetupPending, applyPreset, setupPhase, buildSetupPrompt, parseSetupResponse,
  DEFAULT_TEXT_MAXLEN, DEFAULT_LIST_MAX_ITEMS, DEFAULT_LIST_ITEM_MAXLEN,
};
