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

// ── 초기화 ──────────────────────────────────────────────────

function initState(schema) {
  const vars = {};
  for (const v of schema.vars) {
    vars[v.id] = v.init !== undefined ? v.init : defaultInit(v);
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
  const m = (state.meta = state.meta || {});
  m.turn = m.turn ?? 0;
  m.setupDone = m.setupDone ?? false;
  m.armed = m.armed || {};
  m.actionLastUsed = m.actionLastUsed || {};
  m.eventLastFired = m.eventLastFired || {};
  m.firedOnce = m.firedOnce || {};
  m.pendingNotifies = m.pendingNotifies || [];
  m.firedThisSend = m.firedThisSend || {}; // 이번 전송에서 발동한 액션 (whenArmed 게이트용, 다음 전송에서 리셋)
  return state;
}

// ── 조회 (vars + derived, 순환 감지) ─────────────────────────

function makeLookup(schema, vars) {
  const derivedById = Object.fromEntries((schema.derived || []).map((d) => [d.id, d]));
  const memo = {};
  const computing = new Set();
  const lookup = (name) => {
    if (name in vars) return vars[name];
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

function applySets(schema, state, rules, rng, changeLog, source) {
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
    const lookup = makeLookup(schema, state.vars);
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
  for (const action of schema.actions || []) {
    if (!state.meta.armed[action.id]) continue;
    if (action.when && !truthy(evaluate(action.when, makeLookup(schema, state.vars), null))) continue;
    applySets(schema, state, action.effects, rng, changeLog, `action:${action.id}`);
    if (action.inject) injects.push(action.inject);
    consumedActions.push(action.id);
    state.meta.firedThisSend[action.id] = true;
    if ((action.mode || 'oneshot') === 'oneshot') {
      delete state.meta.armed[action.id];
      state.meta.actionLastUsed[action.id] = state.meta.turn;
    }
  }

  // 2. 직전 턴 이벤트 통지 합류
  const notifies = state.meta.pendingNotifies.splice(0);

  // 3. 상태 블록 렌더
  const lookup = makeLookup(schema, state.vars);
  const ps = schema.promptState || {};
  const lines = [];
  if (ps.template) lines.push(renderTemplate(ps.template, lookup));
  const showEvents = ps.includeEvents !== false && notifies.length > 0;
  if (showEvents) {
    for (const n of notifies) lines.push(`[이벤트] ${n}`);
    // 충돌 해소 규칙은 이벤트가 실제로 있는 턴에만 붙인다 (없는 턴에 넣어봐야 토큰 낭비 + 헛된 편향)
    if (ps.eventPriority !== false) {
      lines.push(renderTemplate(
        typeof ps.eventPriority === 'string' && ps.eventPriority.trim()
          ? ps.eventPriority : DEFAULT_EVENT_PRIORITY, lookup));
    }
  }
  for (const inj of injects) lines.push(inj);

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

  if (isSetupPending(schema, state)) {
    lines.push(schema.setup.ai.instruction ||
      '[최초 설정 진행 중] 아직 시뮬레이션이 시작되지 않았다. 유저와 함께 시작 상황(배경, 자원, 세력 등)을 정하는 대화를 진행하라. 유저의 묘사가 충분해지면 확정된 시작 상황을 서술로 정리하라.');
  }
  lines.push(ps.systemGuide || DEFAULT_SYSTEM_GUIDE);

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
function applyChangesToState(schema, prevState, changes, reasons, seenText = null) {
  const state = reconcileState(schema, clone(prevState));
  const changeLog = [];
  applyLLMChangesInto(schema, state, changes, reasons, changeLog, seenText);
  return { state, changeLog };
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
function outputPhase(schema, sendState, changes, reasons, { rng, seenText = null } = {}) {
  const state = reconcileState(schema, clone(sendState));
  const changeLog = [];
  const firedEvents = [];

  // 5. 보조 모델 델타 적용
  applyLLMChangesInto(schema, state, changes, reasons, changeLog, seenText);

  // 6. 정기 틱
  applySets(schema, state, schema.rules?.onTurn, rng, changeLog, 'onTurn');

  // 7. 조건 이벤트
  for (const ev of schema.rules?.events || []) {
    if (ev.once && state.meta.firedOnce[ev.id]) continue;
    const lookup = makeLookup(schema, state.vars);
    if (!truthy(evaluate(ev.when, lookup, null))) continue;
    applySets(schema, state, ev.effects, rng, changeLog, `event:${ev.id}`);
    if (ev.notify) state.meta.pendingNotifies.push(ev.notify);
    if (ev.once) state.meta.firedOnce[ev.id] = true;
    state.meta.eventLastFired[ev.id] = state.meta.turn;
    firedEvents.push(ev.id);
  }

  // 8. 랜덤 이벤트 추첨
  const re = schema.rules?.randomEvents;
  if (re && rng && rng() < (re.chancePerTurn ?? 0)) {
    const eligible = (re.table || []).filter((ev) => {
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
          applySets(schema, state, ev.effects, rng, changeLog, `random:${ev.id}`);
          if (ev.notify) state.meta.pendingNotifies.push(ev.notify);
          state.meta.eventLastFired[ev.id] = state.meta.turn;
          firedEvents.push(ev.id);
          break;
        }
      }
    }
  }

  // 9. 턴 카운터
  state.meta.turn += 1;

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
  return tpl.replace(/\{([^{}]+)\}/g, (_, inner) => {
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

  return allow.filter((a) => !a.mentions || keysOf(a).some(reallyIn));
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

  return [
    '너는 시뮬레이션 상태 관리자다. 아래 서사를 읽고 상태 변수의 변화만 JSON으로 출력하라.',
    '',
    '[조정 가능 변수]', specs, '',
    historyText || null, historyText ? '' : null,
    userText ? '[유저의 행동/발화]' : null, userText || null, userText ? '' : null,
    '[이번 턴 서사]', narrative, '',
    '[규칙]',
    '- 유저의 행동과 서사에 명시적으로 드러난 변화만 반영하라. 언급 없는 변수는 포함하지 마라.',
    historyText ? '- 앞선 대화는 맥락 파악용이다. 거기서 이미 반영된 변화를 다시 세지 마라. 이번 턴 서사에서 새로 일어난 것만 반영하라.' : null,
    '- 정기 수입·소비·시스템 이벤트로 인한 변화는 시스템이 별도 계산하니 반영하지 마라.',
    schema.updater?.guide ? `- ${schema.updater.guide}` : null,
    '',
    '출력 형식 (JSON만, 다른 텍스트 금지):',
    '{"changes": {"변수id": 값}, "reasons": {"변수id": "한 줄 사유"}}',
    '변화가 없으면 {"changes": {}, "reasons": {}}',
  ].filter((x) => x !== null).join('\n');
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
            ? [[`${c} on`, '켠다 (끄려면 off / 0 / false)']]
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
  if (!Object.keys(byCmd).length || !text || !text.includes('/')) {
    return { text, applied: [], vars: state.vars };
  }
  const vars = { ...state.vars };
  const applied = [];
  const out = text.split('\n').map((line) => {
    const m = line.match(CMD_LINE_RE);
    if (!m) return line;
    const [, cmd, minus, argRaw] = m;
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
  return { text: out, applied, vars };
}

/** 보조 모델 응답 파싱 (관대하게: <Thoughts> 서두/코드펜스/앞뒤 잡담 허용) */
function parseAuxResponse(text) {
  const obj = extractJsonObject(text, 'changes');
  if (!obj) return null;
  return { changes: obj.changes || {}, reasons: obj.reasons || {} };
}

module.exports = {
  initState, clone, reconcileState, makeLookup, coerce, applyListOps, applyChangesToState, resolveRelativeExpiry,
  sendPhase, outputPhase, toggleAction, actionAvailability,
  renderTemplate, buildAuxPrompt, auxAllowList, actionGateOpen, parseAuxResponse, formatHistory, applyChatCommands, commandSpecs,
  isSetupPending, applyPreset, setupPhase, buildSetupPrompt, parseSetupResponse,
  DEFAULT_TEXT_MAXLEN, DEFAULT_LIST_MAX_ITEMS, DEFAULT_LIST_ITEM_MAXLEN,
};
