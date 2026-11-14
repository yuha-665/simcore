// 🧩 번들 조각 · 업데이트 병합 (v1.25.0) — 설계: docs/design-번들-조각.md
//
// 커뮤니티 제보(2026-11-14, 유저 전달): "번들을 배포할 때 원하는 항목만 골라 낼 수 없나 — 내 페르소나 능력·상태창이 섞여 있다
// (예: 직접 만든 던만추 지도만 떼어 주고 싶다)". 유저 판단: 새 통로를 만들지 말고 번들 칸 하나로, 그리고 같은 번들의
// 다음 판이 오면 비교해서 내 것을 남긴 채 얹는다.
//
// 모델 — 번들 = 자기 항목 + 기준 지문
//   · 번들은 id를 갖는다. 넣을 때 "이 번들이 준 단위들의 해시"를 캐릭터별로 저장한다(기준 지문 B).
//   · 조각 = 일부 단위만 담은 번들(simcoreBundle: 2). 전체 번들(1)은 전부 담은 조각일 뿐이다.
//   · 번들에 없는 단위를 지울 수 있는 건 그 번들의 지문에 있던 단위뿐 → 조각은 자기가 넣은 것만 건드리고 여러 조각이 공존한다.
//   · 다음 판이 오면 단위마다 기준(B)·내 것(C)·번들(I)을 대조한다(3자 비교는 일반 기법 — 전부 새로 짰다).
//
// 단위 (지문 한 줄 = 단위 하나)
//   lore:<comment>#<n>          로어북 항목 (comment가 비면 ~k:<key>, 그것도 비면 ~h:<내용 해시>). 폴더·프로필도 한 단위
//   regex:<comment>|<type>#<n>  정규식
//   schema:<a.b>[<id>]          스키마의 id 목록 항목 (변수 하나, 액션 하나 …)
//   schema:<a.b.c>              그 밖 — 객체는 키마다 내려가고, id 없는 배열·값은 그 자리가 한 단위
//   ⚙simcore 로어 항목은 lore: 단위가 아니라 풀어서 schema: 단위들로 다룬다.
//   빈 것(undefined·[]·{})은 단위가 아니다 — 조각이 빈 배열을 "번들이 준 것"으로 만들지 않게.
//
// 순수 모듈 — 저장·화면은 어댑터 몫. editor.js는 딸린 것 묶기에서만, 함수 안에서 늦게 부른다(순환 require 회피).

const P = require('./profile');
const { validateSchema } = require('./validate');

const BASE_COMMENT = P.BASE_COMMENT;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const isEmpty = (x) => x === undefined || (Array.isArray(x) && !x.length) || (isObj(x) && !Object.keys(x).length);

// ── 해시 ───────────────────────────────────────────────────

/** 53비트 문자열 해시(36진 글자) — rng.hashStr(32비트)은 단위 수천 개의 지문으로 쓰기엔 짧다 */
function hash53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * 비교·해시에서 빼는 필드를 걷어 낸 값.
 *   로어 — id·loreCache: 리수가 "이 채팅에만 켜기" 때 붙인다. 안 빼면 손대지 않은 항목이 "내 수정"으로 잡힌다.
 *   스키마 항목 — keep: 받는 쪽의 🔒 표식이지 내용이 아니다.
 */
function cleanUnit(value, kind) {
  if (!isObj(value)) return value;
  if (kind === 'lore' && ('id' in value || 'loreCache' in value)) { const o = { ...value }; delete o.id; delete o.loreCache; return o; }
  if (kind === 'schema' && typeof value.id === 'string' && 'keep' in value) { const o = { ...value }; delete o.keep; return o; }
  return value;
}
const unitText = (value, kind) => P.stable(cleanUnit(value, kind));
const unitHash = (value, kind) => hash53(unitText(value, kind));
/** "내 것 = 번들 것"은 해시가 아니라 안정 JSON을 직접 댄다 */
const sameUnit = (a, b, kind) => unitText(a, kind) === unitText(b, kind);

// ── 단위 걷기 ──────────────────────────────────────────────

function numbered(names) {
  const seen = new Map();
  return names.map((n) => { const k = seen.get(n) || 0; seen.set(n, k + 1); return `${n}#${k}`; });
}
function loreName(l) {
  const c = l && typeof l.comment === 'string' ? l.comment : '';
  if (c) return c;
  const k = l && typeof l.key === 'string' ? l.key : '';
  if (k.trim()) return '~k:' + k;
  return '~h:' + unitHash(l, 'lore');
}
const isFolder = (l) => !!l && l.mode === 'folder';
/** 로어북 단위 — ⚙simcore(기본 판)는 뺀다(스키마 단위로 푼다). index = 원래 배열에서의 자리 */
function loreUnits(lorebook) {
  const list = (Array.isArray(lorebook) ? lorebook : []).map((l, index) => ({ l, index }))
    .filter((x) => isObj(x.l) && x.l.comment !== BASE_COMMENT);
  const keys = numbered(list.map((x) => loreName(x.l)));
  return list.map((x, n) => ({
    key: 'lore:' + keys[n], kind: 'lore', value: x.l, index: x.index,
    label: (isFolder(x.l) ? '📁 ' : '') + (x.l.comment || x.l.key || '(이름 없는 항목)'),
  }));
}
function regexUnits(regex) {
  const list = (Array.isArray(regex) ? regex : []).map((r, index) => ({ r, index })).filter((x) => isObj(x.r));
  const keys = numbered(list.map((x) => `${x.r.comment ?? ''}|${x.r.type ?? ''}`));
  return list.map((x, n) => ({ key: 'regex:' + keys[n], kind: 'regex', value: x.r, index: x.index, label: x.r.comment || '(이름 없는 정규식)' }));
}

// 요약 줄에 쓰는 이름 — 경로 앞머리를 사람 말로
const PATH_LABELS = [
  ['rules.randomEvents.table', '랜덤 이벤트'], ['rules.randomEvents', '랜덤 이벤트 설정'], ['rules.events', '이벤트'], ['rules.onTurn', '매 턴 정산'],
  ['updater.allow', 'AI 허용'], ['updater', '보조 AI 설정'], ['setup.presets', '시작 프리셋'], ['setup', '새 시작'],
  ['vars', '변수'], ['derived', '파생'], ['checks', '판정'], ['actions', '액션'], ['directives', '지시문'], ['rules', '규칙'],
  ['statusUI', '상태창'], ['promptState', 'AI 상태 요약'], ['map', '지도'], ['shops', '상점'], ['shop', '상점'], ['board', '보드'], ['messenger', '메신저'],
  ['questBoard', '의뢰판'], ['party', '편성표'], ['calendar', '달력'], ['scenario', '시나리오'], ['secrets', '비밀'], ['fronts', '무대 뒤'],
  ['time', '시간'], ['liveChoices', '보조 갈림길'], ['assets', '에셋'], ['checkpoint', '되감기'], ['pools', '후보 풀'], ['suggest', '행동 제안'], ['meta', '제목·지침'],
];
function schemaLabel(path, id) {
  const p = path.join('.');
  for (const [pre, label] of PATH_LABELS) {
    if (p === pre) return id != null ? `${label} ${id}` : label;
    if (p.startsWith(pre + '.')) return `${label} › ${p.slice(pre.length + 1)}${id != null ? ` ${id}` : ''}`;
  }
  return id != null ? `${p} ${id}` : p;
}
const schemaKey = (path, id) => 'schema:' + path.join('.') + (id != null ? `[${id}]` : '');
const schemaUnit = (path, id, value) => ({ key: schemaKey(path, id), kind: 'schema', path, id: id ?? null, value, label: schemaLabel(path, id) });
const idList = (x) => Array.isArray(x) && x.length > 0 && P.keyed(x);

/**
 * 내 것(c)과 번들(i)을 같은 경로에서 같이 내려간다 — 둘이 같은 굵기의 단위로 쪼개지게.
 * 둘 다 객체(한쪽이 없음이어도)면 키마다, 둘 다 id 목록(한쪽이 없음이어도)이면 항목마다, 모양이 어긋나면 그 자리가 잎 하나.
 */
function walkPair(c, i, path, C, I) {
  const ce = isEmpty(c), ie = isEmpty(i);
  if (ce && ie) return;
  if ((ce || isObj(c)) && (ie || isObj(i))) {
    const keys = new Set([...(isObj(c) ? Object.keys(c) : []), ...(isObj(i) ? Object.keys(i) : [])]);
    for (const k of keys) walkPair(isObj(c) ? c[k] : undefined, isObj(i) ? i[k] : undefined, [...path, k], C, I);
    return;
  }
  if ((ce || idList(c)) && (ie || idList(i))) {
    if (!ce) for (const it of c) { const u = schemaUnit(path, it.id, it); C.set(u.key, u); }
    if (!ie) for (const it of i) { const u = schemaUnit(path, it.id, it); I.set(u.key, u); }
    return;
  }
  if (!ce) { const u = schemaUnit(path, null, c); C.set(u.key, u); }
  if (!ie) { const u = schemaUnit(path, null, i); I.set(u.key, u); }
}
function pairUnits(c, i) {
  const C = new Map(), I = new Map();
  walkPair(isObj(c) ? c : undefined, isObj(i) ? i : undefined, [], C, I);
  return { c: C, i: I };
}
/** 스키마를 혼자 걸은 단위 목록 */
function schemaUnits(schema) { return [...pairUnits(undefined, schema).i.values()]; }

// ── 지문 ───────────────────────────────────────────────────

/** 조각의 성긴 스키마 — meta·simcore는 싣지도 받지도 않는다(받는 봇의 제목·버전 표식을 안 바꾼다) */
function pieceSchema(data) {
  if (!data || !isObj(data.schema)) return null;
  const { meta, simcore, ...rest } = data.schema;
  return rest;
}
/** 전체 번들(형식 1)의 ⚙simcore — 편집기 모양으로 채운 사본. 없거나 깨졌으면 null */
function wholeSchema(data) {
  const entry = (Array.isArray(data && data.lorebook) ? data.lorebook : []).find((l) => l && l.comment === BASE_COMMENT);
  if (!entry || typeof entry.content !== 'string') return null;
  try { const s = JSON.parse(entry.content); return isObj(s) ? P.shapeFill(s) : null; } catch { return null; }
}
/** 번들이 준 단위들 — 혼자 걸은 것(지문의 재료) */
function bundleUnits(data) {
  const piece = data && data.simcoreBundle === 2;
  const schema = piece ? pieceSchema(data) : wholeSchema(data);
  const regex = piece ? data.regex : [...(Array.isArray(data && data.regex) ? data.regex : []), ...(Array.isArray(data && data.regexAdd) ? data.regexAdd : [])];
  return [...loreUnits(data && data.lorebook), ...regexUnits(regex), ...(schema ? schemaUnits(schema) : [])];
}
/** 기준 지문 — { 열쇠: 해시 }. 적용 뒤 저장하는 것은 병합 결과가 아니라 번들이 준 것(I)이다 */
function fingerprintOf(data) {
  const out = {};
  for (const u of bundleUnits(data)) out[u.key] = unitHash(u.value, u.kind);
  return out;
}

// ── 형식 ───────────────────────────────────────────────────

const ID_OK = /^[A-Za-z0-9_-]{3,40}$/;
/** 조각(형식 2) 검사 — 아니면 이유 문자열, 맞으면 null. 조각은 lorebook·regex·schema 중 하나만 있어도 된다 */
function pieceShapeError(data) {
  if (!isObj(data) || data.simcoreBundle !== 2) return '조각 번들 파일이 아님 (simcoreBundle: 2 필요)';
  if (typeof data.id !== 'string' || !ID_OK.test(data.id)) return '조각에 id가 없음 — 이 플러그인으로 내보낸 조각 파일인지 확인해 주세요';
  if (data.lorebook != null && !Array.isArray(data.lorebook)) return 'lorebook은 배열이어야 함';
  if (data.regex != null && !Array.isArray(data.regex)) return 'regex는 배열이어야 함';
  if (data.schema != null && !isObj(data.schema)) return 'schema는 객체여야 함';
  if (!(data.lorebook || []).length && !(data.regex || []).length && isEmpty(pieceSchema(data) || {})) return '조각이 비어 있음';
  return null;
}
/** 번들 칸에 스키마 JSON을 넣었을 때의 안내 (2026-11 실기 — "개조 번들 파일이 아님"만 떴다). 스키마로 안 보이면 null */
function schemaFileHint(data) {
  if (!isObj(data) || data.simcoreBundle != null) return null;
  if (data.simcore == null && !Array.isArray(data.vars)) return null;
  return '스키마 파일이에요 — 번들 칸이 아니라 편집 작업공간의 JSON 관리자에 붙여 넣고 [전체 작업본 교체] → [캐릭터에 적용]으로 넣어 주세요';
}

// ── 판정 · 계획 ────────────────────────────────────────────

const LINE_LABELS = { add: '추가', update: '번들 수정', mineEdit: '내 수정 유지', removed: '제작자 삭제', iDeleted: '내가 지움', conflict: '충돌', locked: '🔒' };
const LINE_ORDER = ['add', 'update', 'mineEdit', 'removed', 'iDeleted', 'conflict', 'locked'];
// 한 이름 공간 — 검증이 서로 겹침을 금지한다 (patch.js SECTIONS의 ns와 같은 묶음)
const NAMESPACES = [['vars', 'derived', 'checks'], ['rules.events', 'rules.randomEvents.table']];
/** 로어북 항목 모양 — 어댑터 schemaLoreEntry와 같다 (키가 절대 안 걸리는 상시 꺼짐 항목) */
const schemaLoreEntry = (content) => ({
  comment: BASE_COMMENT, key: ' __simcore_never__', secondkey: '',
  insertorder: 0, content, mode: 'normal', alwaysActive: false, selective: false,
});

function getAt(root, path) { let o = root; for (const k of path) { if (!isObj(o)) return undefined; o = o[k]; } return o; }
function setAt(root, path, value) {
  let o = root;
  for (let n = 0; n < path.length - 1; n++) { if (!isObj(o[path[n]])) o[path[n]] = {}; o = o[path[n]]; }
  o[path[path.length - 1]] = value;
}
/** 지우고, 그래서 비게 된 부모 객체도 걷는다 — 빈 `map: {}`가 남으면 "켜진 절"로 읽힌다 */
function deleteAt(root, path) {
  const chain = [root];
  for (let n = 0; n < path.length - 1; n++) { const next = chain[n][path[n]]; if (!isObj(next)) return; chain.push(next); }
  delete chain[chain.length - 1][path[path.length - 1]];
  for (let n = chain.length - 1; n > 0; n--) { if (Object.keys(chain[n]).length) break; delete chain[n - 1][path[n - 1]]; }
}

/**
 * 조각(형식 2)을 캐릭터에 넣는 계획 — 순수 함수, 아무것도 안 바꾼다.
 * @param char    리수 캐릭터 (globalLore·customscript를 읽는다)
 * @param data    조각 번들
 * @param base    이 번들의 기준 지문 { rev, units: { 열쇠: 해시 } } — 처음 넣는 것이면 null
 * @param choices { 열쇠: 'bundle'|'mine' } — 요약 줄에서 바꾼 것
 * @param fresh   true면 지문을 무시하고 첫 설치 길로 ([처음부터 다시 넣기])
 * @returns Plan { ok, error?, id, name, rev, note, installedRev, downgrade, lines, counts,
 *                 result: { globalLore, customscript|null, schemaChanged }, schemaErrors, errorKeys, fingerprint }
 *   lines[] = { key, unit, kind, label, def, choice, locked, why?, oust? } — kind는 LINE_LABELS의 키
 */
function planPiece({ char, data, base = null, choices = {}, fresh = false }) {
  const bad = pieceShapeError(data);
  if (bad) return { ok: false, error: bad };
  const Bmap = !fresh && base && isObj(base.units) ? base.units : null;
  const hasB = (k) => !!Bmap && Object.prototype.hasOwnProperty.call(Bmap, k);
  const bKeys = Bmap ? Object.keys(Bmap) : [];

  // 내 것(C)
  const cLoreList = Array.isArray(char && char.globalLore) ? char.globalLore : [];
  const cRegexList = Array.isArray(char && char.customscript) ? char.customscript : [];
  const baseEntry = cLoreList.find((l) => l && l.comment === BASE_COMMENT) || null;
  const touchSchema = !!pieceSchema(data) || bKeys.some((k) => k.startsWith('schema:'));
  const touchRegex = Array.isArray(data.regex) || bKeys.some((k) => k.startsWith('regex:'));
  let cSchema = null;
  if (touchSchema && baseEntry) {
    try { cSchema = JSON.parse(baseEntry.content); } catch { cSchema = undefined; }
    if (!isObj(cSchema)) return { ok: false, error: '이 캐릭터의 ⚙simcore가 깨져 있어요 — 편집 작업공간에서 스키마를 다시 [캐릭터에 적용]한 뒤 넣어 주세요 (로어북·정규식만 든 조각은 그대로 들어가요)' };
  }
  const cFilled = cSchema ? P.shapeFill(clone(cSchema)) : {};
  const sPair = touchSchema ? pairUnits(cFilled, pieceSchema(data) || {}) : { c: new Map(), i: new Map() };
  const toMap = (arr) => new Map(arr.map((u) => [u.key, u]));
  const C = { lore: toMap(loreUnits(cLoreList)), regex: toMap(regexUnits(cRegexList)), schema: sPair.c };
  const I = { lore: toMap(loreUnits(data.lorebook)), regex: toMap(regexUnits(data.regex)), schema: sPair.i };

  // 🔒 — 받는 쪽 내 판의 keep. 변수가 보호되면 그 allow 줄도 같이 (patch.isKept와 같은 규칙)
  const lockedUnit = (u) => {
    if (!u || u.kind !== 'schema' || u.id == null) return false;
    if (isObj(u.value) && u.value.keep === true) return true;
    return u.path.join('.') === 'updater.allow' && (cFilled.vars || []).some((v) => v && v.id === u.id && v.keep === true);
  };

  const lines = [];
  const lineOf = new Map();
  const R = { lore: new Map(), regex: new Map(), schema: new Map() }; // 결과: 열쇠 → { unit, from: 'c'|'i' }
  for (const kind of ['lore', 'regex', 'schema']) {
    const keys = new Set([...C[kind].keys(), ...I[kind].keys()]);
    for (const key of keys) {
      const cu = C[kind].get(key), iu = I[kind].get(key);
      let verdict = null; // { kind, def, why? }
      if (!(cu && iu && sameUnit(cu.value, iu.value, kind))) {
        const hc = cu ? unitHash(cu.value, kind) : null, hi = iu ? unitHash(iu.value, kind) : null;
        if (!hasB(key)) {
          if (!cu) verdict = { kind: 'add', def: 'bundle' };
          else if (iu) verdict = { kind: 'conflict', def: 'bundle', why: '같은 이름이 이미 있어요' };
          // C만 있고 지문에 없다 = 내 것. 줄 없이 남긴다
        } else {
          const b = Bmap[key];
          if (cu && iu) {
            if (hc === b) verdict = { kind: 'update', def: 'bundle' };
            else if (hi === b) verdict = { kind: 'mineEdit', def: 'mine' };
            else verdict = { kind: 'conflict', def: 'bundle', why: '제작자도 나도 고쳤어요' };
          } else if (cu) {
            verdict = hc === b ? { kind: 'removed', def: 'bundle' }
              : { kind: 'conflict', def: 'mine', why: '제작자는 뺐는데 내가 고친 항목이에요' };
          } else {
            verdict = hi === b ? { kind: 'iDeleted', def: 'mine' }
              : { kind: 'conflict', def: 'bundle', why: '내가 지웠는데 제작자가 고쳤어요' };
          }
        }
      }
      if (!verdict) { if (cu) R[kind].set(key, { unit: cu, from: 'c' }); continue; }
      const locked = lockedUnit(cu);
      const pick = choices[key] === 'bundle' || choices[key] === 'mine' ? choices[key] : verdict.def;
      const ln = { key, unit: kind, kind: locked ? 'locked' : verdict.kind, label: (iu || cu).label, def: locked ? 'mine' : verdict.def,
        choice: locked ? 'mine' : pick, locked };
      if (verdict.why && !locked) ln.why = verdict.why;
      lines.push(ln); lineOf.set(key, ln);
      if (ln.choice === 'bundle') { if (iu) R[kind].set(key, { unit: iu, from: 'i' }); }
      else if (cu) R[kind].set(key, { unit: cu, from: 'c' });
    }
  }

  // 한 이름 공간의 겹침 — 조각의 변수 x와 내 파생 x는 경로가 달라 위 표로는 안 잡힌다. 줄 하나로 올린다
  const ousted = [];
  for (const group of NAMESPACES) {
    const mineById = new Map();
    for (const [key, u] of C.schema) if (u.id != null && group.includes(u.path.join('.'))) mineById.set(u.id, [...(mineById.get(u.id) || []), key]);
    for (const [key, iu] of I.schema) {
      const ln = lineOf.get(key);
      if (!ln || iu.id == null || !group.includes(iu.path.join('.'))) continue;
      const rivalKey = (mineById.get(iu.id) || []).find((k) => k !== key && R.schema.get(k) && R.schema.get(k).from === 'c');
      if (!rivalKey) continue;
      const rival = C.schema.get(rivalKey);
      if (lockedUnit(rival)) {
        ln.kind = 'locked'; ln.locked = true; ln.def = 'mine'; ln.choice = 'mine'; delete ln.why;
        const cu = C.schema.get(key);
        if (cu) R.schema.set(key, { unit: cu, from: 'c' }); else R.schema.delete(key);
        continue;
      }
      ln.kind = 'conflict'; ln.oust = rivalKey; ln.label = `${iu.label} ↔ 내 ${rival.label}`;
      ln.why = '같은 id를 내 다른 항목이 쓰고 있어요 — [번들 것]이면 내 쪽을 빼고 넣어요';
      if (ln.choice === 'bundle') { R.schema.delete(rivalKey); ousted.push(rival); }
    }
  }

  const counts = { add: 0, update: 0, mineEdit: 0, removed: 0, iDeleted: 0, conflict: 0, locked: 0 };
  for (const ln of lines) counts[ln.kind]++;

  // 결과 — 조각은 내 순서를 지키고 새 항목은 끝에 (조각의 로어·정규식이 카드 것보다 앞에 서지 않게)
  const mergeList = (cList, kind, iList) => {
    const byIndex = new Map([...C[kind].values()].map((u) => [u.index, u]));
    const out = [];
    cList.forEach((item, idx) => {
      const u = byIndex.get(idx);
      if (!u) { out.push(item); return; }                 // ⚙simcore 기본 판 · 객체가 아닌 것은 그대로
      const r = R[kind].get(u.key);
      if (!r) return;
      if (r.from === 'c') { out.push(item); return; }
      const next = clone(r.unit.value);
      if (kind === 'lore' && item && item.id != null) next.id = item.id; // 채팅별 켜기 표식은 내 것을 잇는다
      out.push(next);
    });
    for (const u of iList) { const r = R[kind].get(u.key); if (r && r.from === 'i' && !C[kind].has(u.key)) out.push(clone(u.value)); }
    return out;
  };
  let globalLore = mergeList(cLoreList, 'lore', [...I.lore.values()]);
  const customscript = touchRegex ? mergeList(cRegexList, 'regex', [...I.regex.values()]) : null;

  // 스키마 — 채운 사본에 바뀐 단위만 얹는다. 하나도 안 바뀌면 ⚙simcore 글은 원문 그대로
  const schemaLines = lines.filter((ln) => ln.unit === 'schema' && ln.choice === 'bundle');
  const schemaChanged = schemaLines.length > 0;
  let schemaErrors = [];
  const errorKeys = [];
  if (schemaChanged) {
    const out = clone(cFilled);
    const dropItem = (u) => { const list = getAt(out, u.path); if (Array.isArray(list)) setAt(out, u.path, list.filter((x) => !(x && x.id === u.id))); };
    for (const u of ousted) dropItem(u);
    for (const ln of schemaLines) {
      if (I.schema.has(ln.key)) continue;
      const cu = C.schema.get(ln.key);
      if (!cu) continue;
      if (cu.id != null) dropItem(cu); else deleteAt(out, cu.path);
    }
    for (const [key, iu] of I.schema) {       // 번들 순서대로 — 새 항목이 번들 순서로 끝에 붙는다
      const ln = lineOf.get(key);
      if (!ln || ln.choice !== 'bundle') continue;
      const value = clone(iu.value);
      if (iu.id == null) { setAt(out, iu.path, value); continue; }
      let list = getAt(out, iu.path);
      if (!Array.isArray(list)) { list = []; setAt(out, iu.path, list); }
      const at = list.findIndex((x) => x && x.id === iu.id);
      if (at >= 0) list[at] = value; else list.push(value);
    }
    P.shapeFill(out);
    if (!cSchema && !out.meta.name) out.meta.name = String(data.name || '조각');
    const v = validateSchema(out);
    if (!v.ok) {
      schemaErrors = v.errors.map((e) => `${e.path}: ${e.msg}`);
      const text = schemaErrors.join('\n');
      for (const ln of lines) {
        if (ln.unit !== 'schema') continue;
        const u = I.schema.get(ln.key) || C.schema.get(ln.key);
        const hit = u.id != null ? new RegExp(`(^|[^A-Za-z0-9_])${String(u.id).replace(/[^A-Za-z0-9_]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(text) : text.includes('$.' + u.path.join('.'));
        if (hit) errorKeys.push(ln.key);
      }
    } else {
      const content = JSON.stringify(out);
      globalLore = baseEntry ? globalLore.map((l) => (l === baseEntry ? { ...l, content } : l)) : [...globalLore, schemaLoreEntry(content)];
    }
  }

  const rev = Number.isFinite(Number(data.rev)) ? Number(data.rev) : 1;
  const installedRev = base && Number.isFinite(Number(base.rev)) ? Number(base.rev) : null;
  return {
    ok: true, id: data.id, name: String(data.name || '조각'), rev, note: typeof data.note === 'string' ? data.note.slice(0, 200) : '',
    installedRev, downgrade: installedRev != null && rev < installedRev,
    lines, counts, result: { globalLore, customscript, schemaChanged }, schemaErrors, errorKeys,
    fingerprint: fingerprintOf(data),
  };
}

/** 요약 한 줄 — `'이름' r4 (설치된 판 r3) — 추가 4 · 번들 수정 6 · …` (0인 갈래는 뺀다) */
function summaryText(plan) {
  const parts = LINE_ORDER.filter((k) => plan.counts[k]).map((k) => `${LINE_LABELS[k]} ${plan.counts[k]}`);
  return `'${plan.name}' r${plan.rev}${plan.installedRev != null ? ` (설치된 판 r${plan.installedRev})` : ''} — ${parts.length ? parts.join(' · ') : '바뀌는 것이 없어요'}`;
}

/** 계획을 캐릭터에 얹는다 — char를 고쳐 돌려줄 뿐 저장(setCharacter)은 호출자 몫. 병합 스키마가 검증을 못 넘으면 던진다(원자적) */
function applyPlanToChar(char, plan) {
  if (!plan || !plan.ok) throw new Error((plan && plan.error) || '조각 계획이 없음');
  if (plan.schemaErrors.length) throw new Error('병합한 스키마가 검증을 못 넘음: ' + plan.schemaErrors[0]);
  char.globalLore = clone(plan.result.globalLore);
  if (plan.result.customscript) char.customscript = clone(plan.result.customscript);
  return char;
}

module.exports = {
  hash53, unitHash, sameUnit, loreUnits, regexUnits, schemaUnits, pairUnits, fingerprintOf,
  pieceShapeError, schemaFileHint, planPiece, summaryText, applyPlanToChar, LINE_LABELS, LINE_ORDER,
};
