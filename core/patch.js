// AI 왕복 패치 — 부분 수정 가져오기의 엔진 코어 (설계: docs/design-ai-왕복-패치.md)
//
// 통 교체 가져오기의 "일부 수정 불가"를 푸는 병합 계층. 세 가지 약속:
// - add/update/remove 선언 분리 — 같은 id의 조용한 덮어쓰기(upsert)는 없다.
//   add가 기존 id와 겹치면 **정지**하고 사용자 선택(교체/개명/건너뛰기)을 기다린다.
//   공홈 새 챗에서 "딴거 만들어줘" → AI가 이전 패치를 모르고 같은 id를 재생성하는
//   패턴이 1급 사고라서, AI의 협조가 아니라 구조로 막는다.
// - 적용은 원자적 — 일부만 들어가면 참조 무결성이 깨진다(이벤트는 들어갔는데 그
//   변수는 거부된 상태). 병합 후 validateSchema 통과까지가 적용 조건이고, 실패하면
//   원본 스키마는 한 글자도 안 바뀐다.
// - 개명은 패치 전체에 파급 — add 항목을 개명하면 그 id를 참조하는 패치 안의 다른
//   식·효과 대상·지시문 자리표시자도 함께 바뀐다. 안 그러면 개명이 곧 참조 파손이다.

const { renameVar } = require('./expr');
const { validateSchema } = require('./validate');

const ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// 병합 대상 섹션. ns가 같으면 id를 한 이름 공간으로 본다 —
// idspace: 변수·파생·판정은 검증이 서로 겹침을 금지한다 / events: 이벤트·랜덤 이벤트 공유.
// statusUI·onTurn(무id)·setup·meta는 병합 미지원 — 기존 통 교체 경로를 쓴다.
const SECTIONS = {
  vars:         { label: '변수',        ns: 'idspace' },
  derived:      { label: '파생 변수',   ns: 'idspace' },
  checks:       { label: '판정',        ns: 'idspace' },
  events:       { label: '이벤트',      ns: 'events' },
  randomEvents: { label: '랜덤 이벤트', ns: 'events' },
  directives:   { label: '지시문',      ns: 'directives' },
  actions:      { label: '액션',        ns: 'actions' },
  allow:        { label: 'AI 허용 변수', ns: 'allow', noRename: true },
};
const SECTION_KEYS = Object.keys(SECTIONS);
const UNSUPPORTED = new Set(['statusUI', 'onTurn', 'setup', 'meta', 'promptState', 'suggest', 'simcore']);

function getList(schema, key) {
  switch (key) {
    case 'vars': return schema.vars;
    case 'derived': return schema.derived;
    case 'checks': return schema.checks;
    case 'events': return schema.rules && schema.rules.events;
    case 'randomEvents': return schema.rules && schema.rules.randomEvents && schema.rules.randomEvents.table;
    case 'directives': return schema.directives;
    case 'actions': return schema.actions;
    case 'allow': return schema.updater && schema.updater.allow;
  }
}

function setList(schema, key, arr) {
  switch (key) {
    case 'vars': schema.vars = arr; break;
    case 'derived': schema.derived = arr; break;
    case 'checks': schema.checks = arr; break;
    case 'events': (schema.rules = schema.rules || {}).events = arr; break;
    case 'randomEvents': {
      const rules = schema.rules = schema.rules || {};
      // chancePerTurn 없이 표만 생기면 검증이 잡는다 — 여기서 0으로 메꾸면 조용히 죽은 표가 된다
      (rules.randomEvents = rules.randomEvents || {}).table = arr; break;
    }
    case 'directives': schema.directives = arr; break;
    case 'actions': schema.actions = arr; break;
    case 'allow': (schema.updater = schema.updater || {}).allow = arr; break;
  }
}

// ── 1. 패치 파싱 ────────────────────────────────────────────

/** AI가 준 원문(코드펜스 허용)이나 객체를 정규화된 패치로. {ok, patch?, errors[]} */
function parsePatch(raw) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  let obj = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    try { obj = JSON.parse(fence ? fence[1] : s); }
    catch (e) { return { ok: false, errors: [`패치 JSON 파싱 실패: ${e.message}`] }; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    return { ok: false, errors: ['패치는 JSON 객체여야 함'] };
  if (obj.patchVersion != null && obj.patchVersion !== 1)
    return { ok: false, errors: [`지원하지 않는 patchVersion: ${obj.patchVersion} (지원: 1)`] };

  for (const k of Object.keys(obj)) {
    if (!['patchVersion', 'add', 'update', 'remove'].includes(k))
      err(`패치 최상위에는 add/update/remove만 옵니다 — '${k}'는 알 수 없음`);
  }

  const patch = { add: {}, update: {}, remove: {} };
  for (const op of ['add', 'update']) {
    const m = normalizeSectionMap(obj[op], op, err);
    for (const [key, entries] of Object.entries(m)) {
      const seen = new Set();
      const list = [];
      entries.forEach((e, i) => {
        if (!e || typeof e !== 'object' || Array.isArray(e)) { err(`${op}.${key}[${i}]: 항목은 객체여야 함`); return; }
        if (typeof e.id !== 'string' || !e.id) { err(`${op}.${key}[${i}]: id 필요`); return; }
        if (seen.has(e.id)) { err(`${op}.${key}: '${e.id}'가 패치 안에서 중복`); return; }
        seen.add(e.id);
        list.push(e);
      });
      if (list.length) patch[op][key] = list;
    }
  }
  {
    const m = normalizeSectionMap(obj.remove, 'remove', err);
    for (const [key, entries] of Object.entries(m)) {
      const ids = [];
      entries.forEach((e, i) => {
        const id = typeof e === 'string' ? e : (e && typeof e === 'object' ? e.id : null);
        if (typeof id !== 'string' || !id) { err(`remove.${key}[${i}]: id 문자열 필요`); return; }
        if (!ids.includes(id)) ids.push(id);
      });
      if (ids.length) patch.remove[key] = ids;
    }
  }

  if (errors.length) return { ok: false, errors };
  if (!Object.keys(patch.add).length && !Object.keys(patch.update).length && !Object.keys(patch.remove).length)
    return { ok: false, errors: ['패치에 적용할 작업이 없음 (add/update/remove 전부 비어 있음)'] };
  return { ok: true, patch };
}

// 섹션 표기는 평평한 키가 기본이되, AI가 스키마 모양(rules.events 등)을 따라 해도 받아준다.
function normalizeSectionMap(rawOp, opName, err) {
  const out = {};
  if (rawOp == null) return out;
  if (typeof rawOp !== 'object' || Array.isArray(rawOp)) { err(`${opName}은 {섹션: [...]} 객체여야 함`); return out; }
  const put = (key, val, label) => {
    if (val == null) return;
    if (!Array.isArray(val)) { err(`${opName}.${label}: 배열이어야 함`); return; }
    out[key] = (out[key] || []).concat(val);
  };
  for (const [k, v] of Object.entries(rawOp)) {
    if (k === 'rules' && v && typeof v === 'object') {
      put('events', v.events, 'rules.events');
      const re = v.randomEvents;
      put('randomEvents', Array.isArray(re) ? re : (re && re.table), 'rules.randomEvents.table');
      for (const rk of Object.keys(v)) {
        if (rk === 'onTurn') err(`${opName}.rules.onTurn: onTurn은 id가 없어 패치 병합 미지원 — 통 교체 경로를 쓰세요`);
        else if (!['events', 'randomEvents'].includes(rk)) err(`${opName}.rules.${rk}: 알 수 없는 섹션`);
      }
    } else if (k === 'updater' && v && typeof v === 'object') {
      put('allow', v.allow, 'updater.allow');
    } else if (SECTION_KEYS.includes(k)) {
      put(k, v, k);
    } else if (UNSUPPORTED.has(k)) {
      err(`${opName}.${k}: 이 섹션은 패치 병합 미지원 — 기존 통 교체 가져오기를 쓰세요`);
    } else {
      err(`${opName}.${k}: 알 수 없는 섹션 (가능: ${SECTION_KEYS.join(', ')})`);
    }
  }
  return out;
}

// ── 2. 계획 (충돌·헛짚음 감지) ──────────────────────────────

/**
 * 병합 계획. 스키마는 안 건드린다.
 * @returns { ops[], conflicts[], errors[], warnings[], summary }
 *   conflicts[]: { key: 'events:bandit_raid', section, id, existing, incoming,
 *                  options: ['replace'|'rename'|'skip'], reason }
 */
function planPatch(schema, patch) {
  const errors = [], warnings = [], ops = [], conflicts = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  // 섹션별 기존 id → 항목, ns별 id → 섹션
  const existing = {}, nsOwner = {};
  for (const key of SECTION_KEYS) {
    existing[key] = new Map();
    for (const e of (getList(schema, key) || [])) {
      if (e && e.id != null) {
        existing[key].set(e.id, e);
        const ns = SECTIONS[key].ns;
        (nsOwner[ns] = nsOwner[ns] || new Map()).set(e.id, key);
      }
    }
  }

  // 한 패치가 같은 id를 두 작업으로 다루면 순서 의미가 생겨버린다 — 금지
  const opOf = new Map(); // `${ns}:${id}` → `${op} ${section}`
  const claim = (ns, id, op, key) => {
    const k = `${ns}:${id}`;
    if (opOf.has(k)) { err(`'${id}'를 ${opOf.get(k)}와 ${op}.${key}가 같이 다룸 — 한 패치에서 한 번만`); return false; }
    opOf.set(k, `${op}.${key}`);
    return true;
  };

  for (const [key, entries] of Object.entries(patch.add || {})) {
    const ns = SECTIONS[key].ns;
    for (const e of entries) {
      if (!claim(ns, e.id, 'add', key)) continue;
      if (!ID_RE.test(e.id)) { err(`add.${key}: 잘못된 id '${e.id}' (영문자/숫자/_, 영문자 시작)`); continue; }
      const owner = nsOwner[ns] && nsOwner[ns].get(e.id);
      if (owner === key) {
        conflicts.push({
          key: `${key}:${e.id}`, section: key, id: e.id,
          existing: existing[key].get(e.id), incoming: e,
          options: SECTIONS[key].noRename ? ['replace', 'skip'] : ['replace', 'rename', 'skip'],
          reason: `${SECTIONS[key].label} '${e.id}'가 이미 있음`,
        });
      } else if (owner) {
        // 같은 이름 공간의 다른 종류와 충돌 — 교체는 성립하지 않는다 (변수를 파생으로 바꿀 수 없음)
        conflicts.push({
          key: `${key}:${e.id}`, section: key, id: e.id,
          existing: existing[owner].get(e.id), incoming: e,
          options: ['rename', 'skip'],
          reason: `'${e.id}'는 ${SECTIONS[owner].label} 이름과 겹침 — 교체 불가, 개명하거나 건너뛰세요`,
        });
      }
      ops.push({ op: 'add', section: key, id: e.id, entry: e });
    }
  }

  for (const [key, entries] of Object.entries(patch.update || {})) {
    const ns = SECTIONS[key].ns;
    for (const e of entries) {
      if (!claim(ns, e.id, 'update', key)) continue;
      const cur = existing[key].get(e.id);
      if (!cur) { err(`update.${key}: '${e.id}'가 스키마에 없음 — AI가 없는 항목을 고치려 함 (add로 의도했다면 add로)`); continue; }
      if (key === 'vars' && e.type && cur.type && e.type !== cur.type)
        warn(`update.vars '${e.id}': 타입 변경 ${cur.type}→${e.type} — 진행 중인 채팅의 저장값과 충돌할 수 있음`);
      ops.push({ op: 'update', section: key, id: e.id, entry: e, previous: cur });
    }
  }

  for (const [key, ids] of Object.entries(patch.remove || {})) {
    const ns = SECTIONS[key].ns;
    for (const id of ids) {
      if (!claim(ns, id, 'remove', key)) continue;
      if (!existing[key].has(id)) { warn(`remove.${key}: '${id}'는 원래 없음 — 무시됨`); continue; }
      ops.push({ op: 'remove', section: key, id, previous: existing[key].get(id) });
    }
  }

  const count = (op) => ops.filter((o) => o.op === op).length;
  return {
    ops, conflicts, errors, warnings,
    summary: { add: count('add'), update: count('update'), remove: count('remove'), conflicts: conflicts.length },
  };
}

// ── 3. 개명 파급 (패치 내부) ────────────────────────────────

// 섹션별 식(expr) 필드 자리 — 검증기가 아는 자리와 같은 목록.
// 새 필드가 생기면 여기도 늘려야 한다 (안 늘리면 개명이 그 자리만 빼먹는다).
function renameEffects(effects, from, to) {
  for (const r of (effects || [])) {
    if (r.set === from) r.set = to;
    if (r.list === from) r.list = to;
    if (typeof r.expr === 'string') r.expr = renameVar(r.expr, from, to);
    if (typeof r.expire === 'string') r.expire = renameVar(r.expire, from, to);
  }
}

function renameVarRefsInEntry(section, e, from, to) {
  if (typeof e.when === 'string') e.when = renameVar(e.when, from, to);
  renameEffects(e.effects, from, to);
  switch (section) {
    case 'derived':
      if (typeof e.expr === 'string') e.expr = renameVar(e.expr, from, to);
      break;
    case 'events': case 'randomEvents':
      for (const c of (e.choices || [])) {
        if (typeof c.when === 'string') c.when = renameVar(c.when, from, to);
        renameEffects(c.effects, from, to);
      }
      break;
    case 'directives':
      // 지시문 본문은 {변수id} 자리표시자 — 식이 아니라 정확 일치 치환
      if (typeof e.text === 'string') e.text = e.text.split(`{${from}}`).join(`{${to}}`);
      break;
    case 'checks':
      if (typeof e.roll === 'string') e.roll = renameVar(e.roll, from, to);
      if (typeof e.mod === 'string') e.mod = renameVar(e.mod, from, to);
      if (typeof e.vs === 'string') e.vs = renameVar(e.vs, from, to);
      for (const g of (e.grades || [])) {
        if (typeof g.when === 'string') g.when = renameVar(g.when, from, to);
        renameEffects(g.effects, from, to);
      }
      break;
  }
}

/** 패치 안에서 id 개명 — 항목 자신 + 종류에 맞는 참조 자리 전부. 패치를 직접 바꾼다. */
function renameInPatch(patch, section, from, to) {
  const kind = SECTIONS[section].ns;
  for (const op of ['add', 'update']) {
    for (const [key, entries] of Object.entries(patch[op] || {})) {
      for (const e of entries) {
        if (key === section && e.id === from) e.id = to;
        if (kind === 'idspace' && section !== 'checks') {
          // 변수/파생 개명 → 모든 식·효과 대상·자리표시자에 파급
          renameVarRefsInEntry(key, e, from, to);
          if (key === 'allow' && e.id === from) e.id = to;
        } else if (section === 'checks') {
          // 판정 개명 → 이벤트·액션의 check 참조만
          if (e.check === from) e.check = to;
        }
        // 이벤트·액션·지시문 id는 다른 항목이 참조하지 않는다
      }
    }
  }
  for (const [key, ids] of Object.entries(patch.remove || {})) {
    if (key === section) patch.remove[key] = ids.map((id) => (id === from ? to : id));
  }
}

/** 이름 공간에서 안 겹치는 id 제안 — raid_alert → raid_alert2, raid_alert3 … */
function suggestFreeId(schema, patch, section, base) {
  const taken = new Set();
  const ns = SECTIONS[section].ns;
  for (const key of SECTION_KEYS) {
    if (SECTIONS[key].ns !== ns) continue;
    for (const e of (getList(schema, key) || [])) if (e && e.id) taken.add(e.id);
    for (const op of ['add', 'update'])
      for (const e of ((patch[op] || {})[key] || [])) if (e && e.id) taken.add(e.id);
  }
  for (let n = 2; ; n++) {
    const cand = `${base}${n}`;
    if (!taken.has(cand)) return cand;
  }
}

// ── 4. 적용 (원자적) ────────────────────────────────────────

/**
 * 충돌 해소안까지 받아 병합. 성공 시에만 새 스키마 반환 — 원본은 절대 안 바뀐다.
 * @param resolutions { 'events:bandit_raid': 'replace' | 'skip' | { rename: 'bandit_raid2' } }
 * @returns { ok, schema?, errors[], warnings[], applied? }
 */
function applyPatch(schema, patch0, resolutions = {}) {
  // 개명이 패치를 바꾸므로 사본으로 작업 — 호출자의 패치도 원본 유지
  const patch = JSON.parse(JSON.stringify(patch0));
  let plan = planPatch(schema, patch);
  if (plan.errors.length) return { ok: false, errors: plan.errors, warnings: plan.warnings };

  // 충돌 해소: 개명 먼저 반영하고 다시 계획 — 개명 뒤에도 겹치면 그건 새 충돌이다
  const decided = new Map();
  for (const c of plan.conflicts) {
    const r = resolutions[c.key];
    if (r == null) return { ok: false, errors: [`충돌 미해결: ${c.reason} (${c.key}) — 교체/개명/건너뛰기를 정해야 적용됩니다`], warnings: plan.warnings };
    const mode = typeof r === 'string' ? r : 'rename';
    if (!c.options.includes(mode))
      return { ok: false, errors: [`충돌 ${c.key}: '${mode}'는 선택지에 없음 (가능: ${c.options.join('/')})`], warnings: plan.warnings };
    if (mode === 'rename') {
      const to = typeof r === 'object' && r.rename ? r.rename : null;
      if (!to || !ID_RE.test(to)) return { ok: false, errors: [`충돌 ${c.key}: 개명할 새 id가 잘못됨 ('${to}')`], warnings: plan.warnings };
      renameInPatch(patch, c.section, c.id, to);
      decided.set(`${c.section}:${to}`, 'renamed');
    } else {
      decided.set(c.key, mode);
    }
  }
  plan = planPatch(schema, patch);
  if (plan.errors.length) return { ok: false, errors: plan.errors, warnings: plan.warnings };
  const unresolved = plan.conflicts.filter((c) => {
    const d = decided.get(c.key);
    return !(d === 'replace' || d === 'skip');
  });
  if (unresolved.length)
    return { ok: false, errors: unresolved.map((c) => `충돌 미해결: ${c.reason} (${c.key})${decided.has(c.key) ? '' : ' — 개명한 id가 또 겹친 것일 수 있음'}`), warnings: plan.warnings };

  // 병합 — 깊은 사본에만 쓴다
  const merged = JSON.parse(JSON.stringify(schema));
  const applied = { added: [], updated: [], removed: [], skipped: [], warnings: plan.warnings };
  for (const o of plan.ops) {
    const list = (getList(merged, o.section) || []).slice();
    const idx = list.findIndex((e) => e && e.id === o.id);
    if (o.op === 'add') {
      const d = decided.get(`${o.section}:${o.id}`);
      if (d === 'skip') { applied.skipped.push(`${o.section}:${o.id}`); continue; }
      if (idx >= 0) { list[idx] = o.entry; applied.updated.push(`${o.section}:${o.id} (교체)`); }
      else { list.push(o.entry); applied.added.push(`${o.section}:${o.id}`); }
    } else if (o.op === 'update') {
      list[idx] = o.entry;
      applied.updated.push(`${o.section}:${o.id}`);
    } else {
      list.splice(idx, 1);
      applied.removed.push(`${o.section}:${o.id}`);
    }
    setList(merged, o.section, list);
  }

  // 원자성의 마지막 관문 — 병합 결과가 통짜 검증을 못 넘으면 아무것도 적용하지 않는다
  const v = validateSchema(merged);
  if (!v.ok) {
    return {
      ok: false, warnings: plan.warnings,
      errors: ['병합 결과가 검증에 실패 — 아무것도 적용되지 않음',
        ...v.errors.map((e) => `${e.path}: ${e.msg}`)],
    };
  }
  applied.warnings = plan.warnings.concat(v.warnings.map((w) => `${w.path}: ${w.msg}`));
  return { ok: true, schema: merged, errors: [], warnings: applied.warnings, applied };
}

module.exports = { parsePatch, planPatch, applyPatch, renameInPatch, suggestFreeId, SECTIONS };
