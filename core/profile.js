// 🔀 프로필 (v1.24.0) — 한 봇에 판 여러 벌, 채팅마다 하나. 설계: docs/design-프로필.md
//
// 커뮤니티 요청(2026-11-09, 유저 전달): "한 봇에서 가끔 다른 능력으로 하고 싶다 — 스키마를 채팅별로 따로, 프리셋처럼".
// 그전엔 스키마가 캐릭터에 하나(로어북 ⚙simcore)라 고치면 그 봇의 모든 채팅에 번졌다. 새 시작 프리셋은 시작값만 바꾼다.
//
// 원칙
//   · 기본 판 = 로어북 ⚙simcore (그대로). 프로필 = 로어북 ⚙simcore:<이름>, 내용 = **기본 판에서 달라진 부분만**(덧칠).
//     통째 사본이 아닌 이유 — ① 큰 봇 스키마가 수백 KB(아틀리에 494KB)라 사본 세 벌이면 캐릭터가 1.5MB 늘고 전송·채팅 전환마다
//     통째로 읽힌다 ② 제작자가 봇을 업데이트(번들)하면 사본은 옛 버전에 멈춘다. 덧칠은 새 기본 판 위에 다시 얹힌다.
//   · 이 채팅의 프로필 = 상태의 예약 키 sim_profile — 스냅샷에 실려서 과거 상태창·리롤·되감기가 그 시점의 판을 따른다.
//     채팅 변수 미러($sim_profile)로 CBS가 읽는다 — 로어북을 {{getvar::sim_profile}}로 판마다 켜고 끈다.
//   · 덧칠을 못 얹으면(기본 판이 바뀌어 검증 실패) 그 채팅은 기본 판으로 돌고 알린다 — 이름은 지우지 않는다(고치면 돌아온다).
//
// 덧칠 노드
//   { "$set": 값 }                     — 통째 교체
//   { "$list": { put, del, order } }   — id 달린 목록(vars·events·actions…). put = 새로 넣거나 바꾼 항목(**통째**),
//                                        del = 뺀 id, order = 순서가 바뀌었을 때만
//   { 키: 노드, …, "$del": [키] }      — 객체: 바뀐 키만, 없어진 키는 $del
// 목록 항목을 통째로 싣는 이유: 기본 판이 그 항목을 지워도 프로필 것이 살아남고, 고친 항목은 프로필 것이 이긴다(내가 고친 판이 우선).

const PROFILE_KEY = 'sim_profile';       // 상태 예약 키 — validate가 변수 id로 못 쓰게 막는다
const BASE_COMMENT = '⚙simcore';
const PROFILE_PREFIX = '⚙simcore:';     // ⚙simcore-pack·⚙simcore-addon(모듈)과는 하이픈/콜론으로 갈린다
const ENTRY_TAG = 'simcoreProfile';
const NAME_MAX = 20;
const PROFILE_MAX = 12;
const DESC_MAX = 80;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** 키 순서에 안 흔들리는 직렬화 (session.stableJson과 같은 규약) */
function stable(x) {
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
  if (isObj(x)) return '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
  return x === undefined ? 'null' : JSON.stringify(x);
}
const same = (a, b) => stable(a) === stable(b);

// ── 로어북 항목 ────────────────────────────────────────────

/** 스키마 항목인가 (기본 판·프로필) — 로어북 목록·인물 찾기·생성 맥락에서 뺄 때 */
function isSchemaLore(l) {
  const c = l && typeof l.comment === 'string' ? l.comment : '';
  return c === BASE_COMMENT || c.startsWith(PROFILE_PREFIX);
}
/** 프로필 항목이면 이름, 아니면 null */
function profileNameOf(l) {
  const c = l && typeof l.comment === 'string' ? l.comment : '';
  return c.startsWith(PROFILE_PREFIX) ? c.slice(PROFILE_PREFIX.length) : null;
}
const profileComment = (name) => PROFILE_PREFIX + name;

/** 이름 검사 — 문제면 이유, 괜찮으면 null. taken = 이미 있는 이름들 */
function checkProfileName(name, taken = []) {
  const n = typeof name === 'string' ? name : '';
  if (!n.trim()) return '이름을 적어 주세요';
  if (n !== n.trim()) return '이름 앞뒤에는 빈칸을 못 써요';
  if ([...n].length > NAME_MAX) return `이름은 ${NAME_MAX}자까지예요`;
  if (/[\u0000-\u001f{}]/.test(n)) return '이름에 못 쓰는 글자가 있어요 (중괄호·제어 문자)';
  if (n === '기본') return "'기본'은 기본 판의 이름이라 못 써요";
  if (taken.includes(n)) return '같은 이름의 프로필이 이미 있어요';
  return null;
}

// ── 덧칠: 차이 계산과 얹기 ─────────────────────────────────

/** 모든 항목이 객체이고 id(빈칸 아닌 글자)가 겹치지 않는 목록 */
function keyed(arr) {
  if (!Array.isArray(arr)) return false;
  const seen = new Set();
  for (const it of arr) {
    if (!isObj(it) || typeof it.id !== 'string' || !it.id || seen.has(it.id)) return false;
    seen.add(it.id);
  }
  return true;
}

function diffList(a, b) {
  const aBy = new Map(a.map((x) => [x.id, x]));
  const bIds = b.map((x) => x.id);
  const bSet = new Set(bIds);
  const L = {};
  const put = b.filter((x) => !aBy.has(x.id) || !same(aBy.get(x.id), x)).map(clone);
  const del = a.filter((x) => !bSet.has(x.id)).map((x) => x.id);
  if (put.length) L.put = put;
  if (del.length) L.del = del;
  // 순서: 기본 판 순서(뺀 것 제외) + 새 항목은 뒤 — 이것과 다를 때만 싣는다
  const natural = [...a.map((x) => x.id).filter((id) => bSet.has(id)), ...bIds.filter((id) => !aBy.has(id))];
  if (JSON.stringify(natural) !== JSON.stringify(bIds)) L.order = bIds;
  return L;
}

function diffNode(a, b) {
  if (same(a, b)) return undefined;
  if (isObj(a) && isObj(b)) {
    const out = {};
    for (const k of Object.keys(b)) {
      const d = diffNode(a[k], b[k]);
      if (d !== undefined) out[k] = d;
    }
    const del = Object.keys(a).filter((k) => !(k in b));
    if (del.length) out.$del = del;
    return out;
  }
  if (keyed(a) && keyed(b) && (a.length || b.length)) return { $list: diffList(a, b) };
  return { $set: clone(b) };
}

/**
 * 편집기 모양 — 편집기(editor.js normalize)가 실을 때 채우는 빈 칸·걷는 빈 절을 똑같이 맞춘다.
 * 덧칠은 양쪽을 이 모양으로 맞춘 뒤 잰다: 편집기가 채운 `derived: []`·`directives: []`·기본 promptState 따위가 덧칠에 `$set`으로 실리면
 * 제작자가 나중에 기본 판에 지시문을 넣어도 프로필에선 빈 목록이 그걸 덮는다 (구현 중 실측 — 기본 판 복제만 했는데 덧칠에 일곱 절).
 * ⚠ editor.js normalize와 같이 고친다 (test-profile이 둘을 같은 입력에 돌려 대조한다).
 */
function shapeFill(s) {
  if (!isObj(s)) return s;
  s.simcore = s.simcore || '0.1';
  s.meta = s.meta || {};
  s.vars = s.vars || [];
  s.derived = s.derived || [];
  s.directives = s.directives || [];
  s.rules = s.rules || {};
  s.rules.onTurn = s.rules.onTurn || [];
  s.rules.events = s.rules.events || [];
  s.rules.randomEvents = s.rules.randomEvents || { chancePerTurn: 0, table: [] };
  s.rules.randomEvents.table = s.rules.randomEvents.table || [];
  s.updater = s.updater || { model: 'aux', allow: [] };
  s.updater.allow = s.updater.allow || [];
  s.promptState = s.promptState || { position: 'history_end', template: '', includeEvents: true };
  s.statusUI = s.statusUI || { mode: 'auto', groups: [] };
  s.statusUI.groups = s.statusUI.groups || [];
  s.actions = s.actions || [];
  s.checks = s.checks || [];
  s.setup = s.setup || {};
  s.setup.presets = s.setup.presets || [];
  s.setup.ai = s.setup.ai || { enabled: false, vars: [] };
  if (s.assets && !(s.assets.packs || []).length && s.assets.moduleManifests !== true) delete s.assets;
  if (s.scenario && !(s.scenario.acts || []).length) delete s.scenario;
  if (Array.isArray(s.secrets) && !s.secrets.length) delete s.secrets;
  if (Array.isArray(s.fronts) && !s.fronts.length) delete s.fronts;
  return s;
}

/** 기본 판 → 고친 판의 덧칠. 같으면 {} — 편집기가 채운 빈 칸은 차이가 아니다 (shapeFill) */
function diffSchema(base, next) {
  return diffNode(shapeFill(clone(base ?? {})), shapeFill(clone(next ?? {}))) || {};
}
/** 비교용 서명 — 키 순서·편집기 빈 칸에 안 흔들린다 (어댑터 편집기 배너·되읽기 대조) */
const shapeSig = (s) => stable(shapeFill(clone(s ?? {})));

function applyList(base, L) {
  const del = new Set(Array.isArray(L?.del) ? L.del : []);
  let out = base.filter((x) => !(isObj(x) && del.has(x.id))).map(clone);
  for (const it of Array.isArray(L?.put) ? L.put : []) {
    if (!isObj(it) || typeof it.id !== 'string') continue;
    const i = out.findIndex((x) => isObj(x) && x.id === it.id);
    if (i >= 0) out[i] = clone(it); else out.push(clone(it));
  }
  if (Array.isArray(L?.order) && L.order.length) {
    const pos = new Map(L.order.map((id, i) => [id, i]));
    const inOrder = out.filter((x) => isObj(x) && pos.has(x.id)).sort((x, y) => pos.get(x.id) - pos.get(y.id));
    // 덧칠 뒤에 기본 판에 새로 생긴 항목(제작자 업데이트)은 순서 목록에 없다 — 뒤에 붙인다
    out = [...inOrder, ...out.filter((x) => !(isObj(x) && pos.has(x.id)))];
  }
  return out;
}

function applyNode(base, node) {
  if (!isObj(node)) return clone(base);                       // 깨진 노드는 무시 — 기본 판 그대로
  if ('$set' in node) return clone(node.$set);
  if ('$list' in node) return applyList(Array.isArray(base) ? base : [], node.$list);
  const out = isObj(base) ? clone(base) : {};
  if (Array.isArray(node.$del)) for (const k of node.$del) delete out[k];
  for (const k of Object.keys(node)) {
    if (k === '$del') continue;
    const v = applyNode(out[k], node[k]);
    if (v === undefined) delete out[k]; else out[k] = v;
  }
  return out;
}

/** 기본 판에 덧칠을 얹은 새 스키마 (기본 판은 안 바뀐다) */
function applyOverlay(base, overlay) {
  return applyNode(base ?? {}, isObj(overlay) ? overlay : {});
}

// ── 항목 내용 ──────────────────────────────────────────────

/** 프로필 항목의 content 글 */
function entryContent(overlay, meta = {}) {
  const o = { [ENTRY_TAG]: 1 };
  const desc = typeof meta.desc === 'string' ? meta.desc.trim().slice(0, DESC_MAX) : '';
  if (desc) o.desc = desc;
  const aka = Array.isArray(meta.aka) ? meta.aka.filter((x) => typeof x === 'string' && x).slice(-8) : [];
  if (aka.length) o.aka = aka;
  o.overlay = isObj(overlay) ? overlay : {};
  return JSON.stringify(o);
}

/** content → { desc, aka, overlay, full } — 통째 스키마를 붙여 넣은 항목도 받는다(그 자리에서 덧칠로 계산). 실패면 { error } */
function parseEntry(content, base) {
  let raw;
  try { raw = JSON.parse(String(content ?? '')); }
  catch (e) { return { error: 'JSON 손상: ' + e.message }; }
  if (isObj(raw) && raw[ENTRY_TAG]) {
    return {
      desc: typeof raw.desc === 'string' ? raw.desc : '',
      aka: Array.isArray(raw.aka) ? raw.aka.filter((x) => typeof x === 'string' && x) : [],
      overlay: isObj(raw.overlay) ? raw.overlay : {},
      full: false,
    };
  }
  if (isObj(raw) && Array.isArray(raw.vars)) return { desc: '', aka: [], overlay: diffSchema(base, raw), full: true };
  return { error: '프로필 형식이 아니에요 (simcoreProfile 표식도, 스키마도 아님)' };
}

/**
 * 로어북 항목 하나 → 프로필 정보. validate를 주면 얹은 판까지 검증한다.
 * @returns {{ name, comment, desc, aka, overlay, merged, ok, errors, warnings, error, full }}
 */
function readProfile(base, lore, validate) {
  const name = profileNameOf(lore);
  const item = { name, comment: lore?.comment, desc: '', aka: [], overlay: {}, merged: null, ok: false, errors: [], warnings: [], error: null, full: false };
  const badName = checkProfileName(name);
  if (badName) { item.error = `이름: ${badName}`; return item; }
  const p = parseEntry(lore?.content, base);
  if (p.error) { item.error = p.error; return item; }
  Object.assign(item, { desc: p.desc, aka: p.aka, overlay: p.overlay, full: p.full });
  item.merged = applyOverlay(base, p.overlay);
  if (typeof validate === 'function') {
    try {
      const v = validate(item.merged);
      item.ok = !!v.ok; item.errors = v.errors || []; item.warnings = v.warnings || [];
    } catch (e) { item.ok = false; item.errors = [{ path: '$', msg: '검증 중 오류: ' + e.message }]; }
  } else item.ok = true;
  return item;
}

/** 캐릭터 로어북의 프로필 전부 (같은 이름이 두 번이면 앞의 것) */
function readProfiles(base, lore, validate) {
  const out = [];
  const seen = new Set();
  for (const l of Array.isArray(lore) ? lore : []) {
    const name = profileNameOf(l);
    if (name == null || seen.has(name)) continue;
    seen.add(name);
    out.push(readProfile(base, l, validate));
  }
  return out;
}

/** 이름(또는 옛 이름 aka)으로 찾기 */
function findProfile(list, name) {
  if (typeof name !== 'string' || !name) return null;
  return (list || []).find((p) => p.name === name) || (list || []).find((p) => (p.aka || []).includes(name)) || null;
}

// ── 화면용 요약 ────────────────────────────────────────────

const AREA = {
  vars: '변수', derived: '파생', checks: '판정', rules: '규칙·이벤트', directives: '지시문', actions: '액션', statusUI: '상태창',
  promptState: 'AI 설정', updater: '보조 AI', setup: '새 시작', meta: '제목·메모', time: '시간', calendar: '달력', scenario: '시나리오',
  secrets: '비밀', map: '지도', shop: '상점', shops: '상점', board: '보드', messenger: '메신저', questBoard: '의뢰판', party: '편성표',
  assets: '에셋', fronts: '무대 뒤', liveChoices: '보조 갈림길', checkpoint: '되감기', pools: '후보 풀', suggest: '행동 제안', onTurn: '매 턴 정산',
};

/** 덧칠이 무엇을 바꾸는지 짧은 줄들 — ['변수 +2 ~1', '상태창', …] */
function summarizeOverlay(base, overlay) {
  const out = [];
  if (!isObj(overlay)) return out;
  for (const k of Object.keys(overlay)) {
    if (k === '$del') continue;
    const label = AREA[k] || k;
    const node = overlay[k];
    if (isObj(node) && isObj(node.$list)) {
      const ids = new Set((Array.isArray(base?.[k]) ? base[k] : []).map((x) => x && x.id));
      const put = Array.isArray(node.$list.put) ? node.$list.put : [];
      const add = put.filter((x) => !ids.has(x && x.id)).length;
      const chg = put.length - add;
      const del = Array.isArray(node.$list.del) ? node.$list.del.length : 0;
      const bits = [add ? `+${add}` : '', chg ? `~${chg}` : '', del ? `−${del}` : '', !add && !chg && !del && node.$list.order ? '순서' : ''].filter(Boolean);
      out.push(bits.length ? `${label} ${bits.join(' ')}` : label);
    } else out.push(label);
  }
  for (const k of Array.isArray(overlay.$del) ? overlay.$del : []) out.push(`${AREA[k] || k} 끔`);
  return out;
}

/** 배포 번들에서 📌 작업 지침(meta.notes)을 빼는 것과 같은 결 — 덧칠 안의 notes도 뺀다 */
function stripOverlayNotes(overlay) {
  const o = clone(overlay);
  if (!isObj(o) || !isObj(o.meta)) return o;
  if (isObj(o.meta.$set)) delete o.meta.$set.notes;
  else {
    delete o.meta.notes;
    if (Array.isArray(o.meta.$del)) { o.meta.$del = o.meta.$del.filter((k) => k !== 'notes'); if (!o.meta.$del.length) delete o.meta.$del; }
    if (!Object.keys(o.meta).length) delete o.meta;
  }
  return o;
}

module.exports = {
  PROFILE_KEY, BASE_COMMENT, PROFILE_PREFIX, NAME_MAX, PROFILE_MAX, DESC_MAX,
  isSchemaLore, profileNameOf, profileComment, checkProfileName,
  diffSchema, applyOverlay, entryContent, parseEntry, readProfile, readProfiles, findProfile,
  summarizeOverlay, stripOverlayNotes, stable, shapeFill, shapeSig, keyed,
};
