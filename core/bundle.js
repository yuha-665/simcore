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

module.exports = {
  hash53, unitHash, sameUnit, loreUnits, regexUnits, schemaUnits, pairUnits, fingerprintOf,
};
