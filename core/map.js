// 지도 (v1.23.0) — 게임 패널 7호. 좌표 위의 장소·구역·이정표 + 현재 위치 + 채워지는 지도.
//
// 유저(2026-11-09, 교토 전도 스샷): "심코어에도 이렇게 지도 그리는 기능" → "아틀리에나 베리디아처럼
// 지도를 완성해 가면서 채워지는 기믹도". 그전 지도는 편성표 템플릿 탭(얼헌 서울 5권역·아틀리에 채집지 격자·
// 베리디아 탐사 방향 줄)으로 칸에 글자를 꽂는 방식뿐이었다 — 좌표도, 안개도, 누르면 펼쳐지는 사정도 없었다.
//
// 원칙
//   · **새 저장소를 만들지 않는다** (달력과 같은 원칙). 현재 위치 = 기존 위치 변수(locVar),
//     들른 곳 = 평범한 list 변수(seenVar — 시스템이 적는다), 찾아낸 곳 = 평범한 list 변수(listVar — "이름 (구역)").
//     그래서 리롤·되감기·현황 탭 손수정·조건식(`has(visited, "기온")`, `count(visited)`)이 공짜로 따라온다.
//   · **숫자는 시스템** — 들른 곳 기록은 보조 AI가 아니라 정산이 한다 (위치 변수 값이 장소 이름과 같으면).
//   · 안개(fog)를 켜면 못 가 본 구역은 가리고, 모르는 장소는 안 그린다. 지도는 플레이가 채운다.
//   · 좌표는 지도 크기에 대한 % (0~100) — 화면 폭이 달라도 같은 자리.
//   · 그리기 재료(mapView)와 HTML(renderMapHtml)을 여기 둔다 — 패널(어댑터)과 편집기 미리보기가 같은 그림을 쓴다.
//
// 스키마 (옵트인):
//   map: { label?, icon?, note?, ratio?, bg?, locVar?, seenVar?, listVar?, fog?, css?,
//          categories?: [{ label, color? }],
//          zones?:  [{ label, x, y, w, h, cat?, color?, desc?, known?, match? }],
//          places?: [{ name, x, y, sub?, cat?, desc?, rumor?, known?, alias? }],
//          exits?:  [{ label, dir, at?, known? }] }
//   known: true = 처음부터 보임 · 식 = 참이 되면 보임 · 없음 = 안개면 가 봐야 보임(안개가 없으면 보임)

const { evaluate, truthy } = require('./expr');

const DIRS = { n: '↑', ne: '↗', e: '→', se: '↘', s: '↓', sw: '↙', w: '←', nw: '↖' };
const DIR_EDGE = { n: 'top', s: 'bottom', e: 'right', ne: 'right', se: 'right', w: 'left', nw: 'left', sw: 'left' };
const CAPS = { CATS: 10, ZONES: 40, PLACES: 80, EXITS: 16, DYN: 80, NAME: 30, TEXT: 600 };
const DEFAULT_RATIO = 1;
const PALETTE = ['#b3392f', '#2f5fa8', '#7a3fa0', '#3f8a4a', '#b07a1c', '#2b8a8a', '#a33a6b', '#5a6b2f', '#8a5a2b', '#4a4a8a'];

function mapConfig(schema) {
  const m = schema?.map;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  return m;
}

/** 우상단 버튼 사양 — 어댑터가 registerButton에 그대로 쓴다 (달력과 같은 계약) */
function mapButtonSpec(schema) {
  const m = mapConfig(schema);
  if (!m) return null;
  return { label: str(m.label) || '지도', icon: str(m.icon) || '🗺️' };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const norm = (v) => String(v ?? '').trim().toLowerCase();
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const pct = (v) => { const n = num(v); return n == null ? null : Math.max(0, Math.min(100, n)); };
const arr = (v) => (Array.isArray(v) ? v : []);
const round1 = (n) => Math.round(n * 10) / 10;

/** 세로 ÷ 가로 (0.4~2.5) */
function ratioOf(m) {
  const r = num(m?.ratio);
  return r == null ? DEFAULT_RATIO : Math.max(0.4, Math.min(2.5, r));
}

/** 목록 항목 "이름 (구역) @12" → { name, tag } — 기한 표기는 떼고, 끝 괄호를 구역 꼬리표로 */
function splitTag(raw) {
  const s = String(raw ?? '').replace(/\s*@[+-]?\d+(?:\.\d+)?\S*/g, '').trim();
  const m = s.match(/^(.*?)\s*[(（]([^()（）]+)[)）]\s*$/);
  if (m && m[1].trim()) return { name: m[1].trim(), tag: m[2].trim() };
  return { name: s, tag: null };
}

// 문자열 해시 (FNV-1a) — 찾아낸 곳의 자리를 이름으로 정한다. 같은 이름은 늘 같은 자리.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function knownOf(entry, lookup, fog, dflt) {
  const k = entry?.known;
  if (k === true) return true;
  if (k === false) return false;
  if (typeof k === 'string' && k.trim()) {
    try { return truthy(evaluate(k, lookup, null)); } catch { return false; }
  }
  return dflt ?? !fog;
}

/** 분류 — 이름(label)이 열쇠다. 색이 없으면 팔레트 순서로 */
function categoriesOf(m) {
  const out = [];
  const seen = new Set();
  for (const c of arr(m?.categories)) {
    const label = str(typeof c === 'string' ? c : c?.label);
    if (!label || seen.has(label) || out.length >= CAPS.CATS) continue;
    seen.add(label);
    out.push({ label, color: str(c?.color) || PALETTE[out.length % PALETTE.length] });
  }
  return out;
}

/**
 * 구역의 빈자리 — 칸을 나눠 이름 해시 순으로 탐색한다. 고정 장소 근처·이미 앉은 자리는 건너뛴다.
 * 칸이 다 차면 구역 가운데 근처에 조금씩 비켜 앉힌다 (사라지는 것보다 겹치는 게 낫다).
 */
// 핀 이름표가 차지하는 가로 폭(지도 %의 어림) — 겹침은 점이 아니라 이름표끼리 난다
const labelW = (name) => Math.min(30, 3 + String(name || '').length * 2.2);
const LABEL_LEFT_AT = 62;   // 이보다 오른쪽 핀은 이름표를 왼쪽에 단다 (지도 밖으로 안 나가게) — 그리기와 같은 문턱
/** 핀 + 이름표의 가로 구간과 세로 띠 */
function pinBox(p) {
  const w = labelW(p.name);
  const [x0, x1] = p.x > LABEL_LEFT_AT ? [p.x - 2 - w, p.x + 1.5] : [p.x - 1.5, p.x + 2 + w];
  return { x0, x1, y0: p.y - 2.2, y1: p.y + 2.2 };
}
const boxHit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function placeInZone(z, name, taken, inner = []) {
  const cols = Math.max(1, Math.round(z.w / 9));
  const rows = Math.max(1, Math.round(z.h / 7));
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: z.x + (z.w * (c + 0.5)) / cols, y: z.y + (z.h * (r + 0.5)) / rows, name });
    }
  }
  // 탐색 순서 = 이름으로 섞은 칸 순서 (같은 이름은 늘 같은 순서). 보폭으로 건너뛰면 보폭이 칸 수와 약수를 나눌 때
  // 일부 칸만 돌고 "자리 없음"으로 떨어졌다 (25칸·보폭 5 → 다섯 칸만 봄)
  const order = cells.map((c, i) => [hash(name + '#' + i), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  // 비켜 앉을 것: 구역 이름표(왼쪽 위) · 안에 든 작은 구역(성 안의 도시 — 들판 핀이 왕도 칸에 떨어지면 왕도 것처럼 보인다) ·
  // 이미 앉은 핀의 이름표. 첫 바퀴는 이름표까지 구역 안에 드는 자리만, 둘째 바퀴는 넘쳐도 된다.
  const blocks = [
    { x0: z.x, x1: z.x + labelW(z.label) + 15, y0: z.y, y1: z.y + 4.5 },   // +15 = "📍 현재 위치" 뱃지가 붙을 자리
    ...inner.map((o) => ({ x0: o.x - 1, x1: o.x + o.w + 1, y0: o.y - 1, y1: o.y + o.h + 1 })),
    ...taken.map(pinBox),
  ];
  const within = (b) => b.x0 >= z.x - 1 && b.x1 <= z.x + z.w + 1;
  for (const strict of [true, false]) {
    for (const p of order) {
      const b = pinBox(p);
      if ((!strict || within(b)) && !blocks.some((o) => boxHit(b, o))) return { x: round1(p.x), y: round1(p.y) };
    }
  }
  const k = taken.length;
  return { x: round1(z.x + z.w / 2 + ((k % 3) - 1) * 3), y: round1(z.y + z.h / 2 + ((Math.floor(k / 3) % 3) - 1) * 3) };
}

/**
 * 그리기 재료. 상태를 바꾸지 않는다.
 * opts.reveal = true면 안개를 걷은 모습 (편집기 미리보기 "다 밝힌 모습").
 * 반환: { label, icon, note, ratio, bg, fog, cats, zones, places, pins, exits, stray, here, loc, counts }
 */
function mapView(schema, state, makeLookup, opts = {}) {
  const m = mapConfig(schema);
  if (!m) return null;
  const vars = state?.vars || {};
  const lookup = typeof makeLookup === 'function' ? makeLookup(schema, vars) : (n) => vars[n];
  const byId = Object.fromEntries(arr(schema.vars).filter(Boolean).map((v) => [v.id, v]));
  const read = (id) => {
    if (!id || typeof id !== 'string') return undefined;
    let v;
    try { v = lookup(id); } catch { v = undefined; }
    return v === undefined ? byId[id]?.init : v;
  };
  const listOf = (id) => { const v = read(id); return Array.isArray(v) ? v.map(String) : []; };
  const reveal = !!opts.reveal;
  const fog = m.fog === true && !reveal;
  const cats = categoriesOf(m);
  const catColor = (c) => cats.find((x) => x.label === c)?.color ?? null;
  const locRaw = read(m.locVar);
  const loc = locRaw == null ? '' : String(locRaw).trim();
  const seenSet = new Set(listOf(m.seenVar).map(norm));

  // ① 구역
  const zones = [];
  arr(m.zones).slice(0, CAPS.ZONES).forEach((z, i) => {
    if (!z || typeof z !== 'object') return;
    const label = str(z.label);
    const x = pct(z.x), y = pct(z.y), w = pct(z.w), h = pct(z.h);
    if (!label || x == null || y == null || !w || !h) return;
    zones.push({
      key: `z${i}`, label, x, y, w: Math.min(w, 100 - x), h: Math.min(h, 100 - y),
      cat: str(z.cat) || null, color: str(z.color) || catColor(str(z.cat)) || null,
      desc: str(z.desc), match: [label, ...arr(z.match).map(str).filter(Boolean)],
      known: reveal || knownOf(z, lookup, fog, !fog), seen: reveal || seenSet.has(norm(label)),
      here: false, open: false, pins: [], places: [],
    });
  });
  const zoneAt = (x, y) => {
    let best = null;
    for (const z of zones) {
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h && (!best || z.w * z.h < best.w * best.h)) best = z;
    }
    return best;
  };
  const zoneByTag = (tag, text) => {
    if (tag) {
      const t = norm(tag);
      const hit = zones.find((z) => z.match.some((mm) => norm(mm) === t));
      if (hit) return hit;
    }
    // 꼬리표가 없거나 안 맞으면 항목 글에 든 구역 이름 (상태창 {목록:tags:구역}과 같은 '품은 글' 규약) — 긴 이름 우선
    const all = norm(text);
    let best = null, bestLen = 0;
    for (const z of zones) for (const mm of z.match) {
      const n = norm(mm);
      if (n && all.includes(n) && n.length > bestLen) { best = z; bestLen = n.length; }
    }
    return best;
  };

  // ② 고정 장소
  const places = [];
  arr(m.places).slice(0, CAPS.PLACES).forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const name = str(p.name);
    const x = pct(p.x), y = pct(p.y);
    if (!name || x == null || y == null) return;
    const alias = arr(p.alias).map(str).filter(Boolean);
    const cat = str(p.cat) || null;
    const zone = zoneAt(x, y);
    places.push({
      key: `p${i}`, name, sub: str(p.sub), x, y, cat, color: catColor(cat),
      desc: str(p.desc), rumor: str(p.rumor), alias, zone: zone ? zone.key : null,
      known: reveal || knownOf(p, lookup, fog, !fog),
      seen: reveal || seenSet.has(norm(name)) || alias.some((a) => seenSet.has(norm(a))),
      here: false, state: 'hidden',
    });
    if (zone) zone.places.push(`p${i}`);
  });

  // ③ 찾아낸 곳 (listVar) — "이름 (구역)"이 그 구역에 핀으로 꽂힌다
  const pins = [];
  const stray = [];
  const taken = places.map((p) => ({ x: p.x, y: p.y, name: p.name }));
  for (const raw of listOf(m.listVar).slice(0, CAPS.DYN)) {
    const { name, tag } = splitTag(raw);
    if (!name) continue;
    const z = zoneByTag(tag, raw);
    if (!z) { stray.push({ name, raw: String(raw), tag }); continue; }
    const inner = zones.filter((o) => o !== z && o.x >= z.x && o.y >= z.y && o.x + o.w <= z.x + z.w && o.y + o.h <= z.y + z.h);
    const pos = placeInZone(z, name, taken, inner);
    taken.push({ ...pos, name });
    const key = `d${pins.length}`;
    pins.push({ key, name, raw: String(raw), x: pos.x, y: pos.y, zone: z.key, cat: z.cat, color: z.color, here: false });
    z.pins.push(key);
  }

  // ④ 지금 여기 — 장소(이름·별칭) > 찾아낸 곳 > 구역 순
  let here = null;
  if (loc) {
    const L = norm(loc);
    const p = places.find((q) => norm(q.name) === L || q.alias.some((a) => norm(a) === L));
    if (p) { p.here = true; p.seen = true; here = { kind: 'place', key: p.key, name: p.name }; }
    if (!here) {
      const d = pins.find((q) => norm(q.name) === L);
      if (d) { d.here = true; here = { kind: 'pin', key: d.key, name: d.name }; }
    }
    if (!here) {
      const z = zones.find((q) => q.match.some((mm) => norm(mm) === L));
      if (z) { z.here = true; z.seen = true; here = { kind: 'zone', key: z.key, name: z.label }; }
    }
  }

  for (const p of places) p.state = p.seen ? 'seen' : p.known ? 'known' : 'hidden';
  const zoneOf = (k) => zones.find((z) => z.key === k);
  for (const z of zones) {
    z.open = !fog || z.known || z.seen || z.here || z.pins.length > 0
      || z.places.some((k) => places.find((p) => p.key === k)?.state === 'seen')
      || (here && here.kind !== 'zone' && (places.find((p) => p.key === here.key)?.zone === z.key || pins.find((d) => d.key === here.key)?.zone === z.key));
  }

  // ⑤ 이정표 — 같은 변에 선 것들은 순서대로 고르게 나눈다 (at을 적은 것만 그 자리)
  const exits = [];
  const ORDER = { ne: 0, nw: 0, n: 1, s: 1, e: 1, w: 1, se: 2, sw: 2 };
  arr(m.exits).slice(0, CAPS.EXITS).forEach((e, i) => {
    if (!e || typeof e !== 'object') return;
    const label = str(e.label);
    const dir = DIRS[e.dir] ? e.dir : null;
    if (!label || !dir) return;
    if (!(reveal || knownOf(e, lookup, fog, true))) return;
    exits.push({ key: `e${i}`, label, dir, arrow: DIRS[dir], edge: DIR_EDGE[dir], at: pct(e.at), i });
  });
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    const on = exits.filter((e) => e.edge === edge && e.at == null).sort((a, b) => (ORDER[a.dir] - ORDER[b.dir]) || (a.i - b.i));
    on.forEach((e, k) => { e.at = round1(on.length === 1 ? (ORDER[e.dir] === 0 ? 10 : ORDER[e.dir] === 2 ? 90 : 50) : 10 + (80 * k) / (on.length - 1)); });
  }

  const counts = {
    places: places.length,
    seen: places.filter((p) => p.state === 'seen').length,
    known: places.filter((p) => p.state !== 'hidden').length,
    zones: zones.length,
    open: zones.filter((z) => z.open).length,
    pins: pins.length,
  };
  return {
    label: str(m.label) || '지도', icon: str(m.icon) || '🗺️', note: str(m.note), ratio: ratioOf(m),
    bg: str(m.bg) || null, fog, fogOn: m.fog === true, cats, zones, places, pins, exits, stray,
    here, loc, counts, zoneOf,
  };
}

/**
 * 들른 곳 기록 — 정산 끝에 엔진이 부른다. 위치 변수 값이 장소(이름·별칭)나 구역이면 그 이름을 seenVar에 넣는다.
 * 상태를 직접 바꾼다 (엔진 정산 안에서만 부를 것). 반환: 넣은 이름 | null.
 * 목록이 꽉 찼으면 넣지 않는다 — 오래된 발자취를 밀어내면 지도가 도로 안개에 덮인다 (검증이 크기를 경고한다).
 */
function recordVisit(schema, state, makeLookup) {
  const m = mapConfig(schema);
  if (!m || !m.seenVar || !state?.vars) return null;
  const def = arr(schema.vars).find((v) => v && v.id === m.seenVar);
  if (!def || def.type !== 'list') return null;
  const view = mapView(schema, state, makeLookup);
  if (!view || !view.here || view.here.kind === 'pin') return null;
  const name = view.here.name;
  const cur = Array.isArray(state.vars[m.seenVar]) ? state.vars[m.seenVar] : [];
  if (cur.some((x) => norm(x) === norm(name))) return null;
  const maxItems = Number.isInteger(def.maxItems) ? def.maxItems : 20;
  const maxLen = Number.isInteger(def.itemMaxLength) ? def.itemMaxLength : 40;
  if (cur.length >= maxItems || name.length > maxLen) return null;
  state.vars[m.seenVar] = [...cur, name];
  return name;
}

/**
 * 검증 — validate.js가 부른다. ctx { vars, exprIds, allIds, err, warn, checkExpr }.
 * 모듈에 두는 이유: 규격서가 validateSchema 소스를 통째로 싣는데 128KB 상한이 코앞이었다 (sample.validatePools와 같은 길).
 * 규칙 요지는 편집기 SCHEMA_MAP_RULES가 AI에게 말한다.
 */
function validateMap(schema, { vars, exprIds, allIds, err, warn, checkExpr }) {
  if (schema.map == null) return;
  const M = schema.map; const P = '$.map';
  if (typeof M !== 'object' || Array.isArray(M)) err(P, 'map은 객체여야 함');
  else {
    for (const k of ['label', 'note', 'css', 'bg']) if (M[k] != null && typeof M[k] !== 'string') err(`${P}.${k}`, `${k}는 문자열이어야 함`);
    if (M.icon != null && (typeof M.icon !== 'string' || M.icon.length > 8)) err(`${P}.icon`, '아이콘은 이모지 한두 글자 (8자 이내)');
    if (M.ratio != null && (typeof M.ratio !== 'number' || M.ratio < 0.4 || M.ratio > 2.5)) err(`${P}.ratio`, 'ratio(세로÷가로)는 0.4~2.5 숫자');
    if (M.fog != null && typeof M.fog !== 'boolean') err(`${P}.fog`, 'fog는 true/false');
    const knownChk = (v, p) => { if (v != null && typeof v !== 'boolean') checkExpr(v, p, exprIds, err, { allowRand: false }); };
    const pctChk = (v, p, name) => { if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 100) { err(p, `${name}는 0~100 숫자 (지도 크기에 대한 %)`); return false; } return true; };
    const listVarChk = (k, name) => {
      if (M[k] == null) return null;
      const lv = vars.find((v) => v && v.id === M[k]);
      if (typeof M[k] !== 'string' || !lv) { err(`${P}.${k}`, `${name} '${M[k]}'가 vars에 없음`); return null; }
      if (lv.type !== 'list') { err(`${P}.${k}`, `${name} '${M[k]}'는 list 타입이어야 함 (현재: ${lv.type})`); return null; }
      return lv;
    };
    let locDef = null;
    if (M.locVar == null) warn(`${P}.locVar`, '현재 위치 변수(locVar)가 없어 "지금 여기"도, 들른 곳 기록도 안 됩니다');
    else if (typeof M.locVar !== 'string' || !allIds.has(M.locVar)) err(`${P}.locVar`, `위치 변수 '${M.locVar}'가 vars·파생에 없음`);
    else {
      locDef = vars.find((v) => v && v.id === M.locVar) || null;
      if (locDef && locDef.type === 'list') err(`${P}.locVar`, '위치 변수는 값 하나여야 함 (list는 발자취·찾아낸 곳 칸에)');
    }
    const seenDef = listVarChk('seenVar', '발자취 목록');
    listVarChk('listVar', '찾아낸 곳 목록');
    if (seenDef && M.locVar == null) warn(`${P}.seenVar`, '발자취는 위치 변수를 보고 적힙니다 — locVar가 없으면 비어 있습니다');
    const cats = new Set();
    if (M.categories != null) {
      if (!Array.isArray(M.categories)) err(`${P}.categories`, '분류는 [{ label, color }] 배열');
      else {
        if (M.categories.length > 10) err(`${P}.categories`, '분류는 10개까지');
        M.categories.forEach((c, i) => {
          const label = typeof c === 'string' ? c : c?.label;
          if (typeof label !== 'string' || !label.trim()) err(`${P}.categories[${i}].label`, '분류 이름(label) 필요');
          else if (cats.has(label.trim())) err(`${P}.categories[${i}].label`, `중복 분류 '${label}'`);
          else cats.add(label.trim());
          if (c && typeof c === 'object' && c.color != null && typeof c.color !== 'string') err(`${P}.categories[${i}].color`, '색(color)은 문자열 (#rrggbb)');
        });
      }
    }
    const catChk = (v, p) => { if (v != null && (typeof v !== 'string' || !cats.has(v.trim()))) warn(p, `분류 '${v}'가 categories에 없습니다 — 분류 단추로 거를 수 없어요`); };
    const names = new Set();
    for (const [k, cap, what] of [['zones', 40, '구역'], ['places', 80, '장소'], ['exits', 16, '이정표']]) {
      if (M[k] == null) continue;
      if (!Array.isArray(M[k])) { err(`${P}.${k}`, `${what}(${k})은 배열`); continue; }
      if (M[k].length > cap) err(`${P}.${k}`, `${what}은 ${cap}개까지`);
      M[k].forEach((e, i) => {
        const ep = `${P}.${k}[${i}]`;
        if (!e || typeof e !== 'object' || Array.isArray(e)) { err(ep, `${what}은 객체`); return; }
        const nm = k === 'places' ? e.name : e.label;
        if (typeof nm !== 'string' || !nm.trim()) err(`${ep}.${k === 'places' ? 'name' : 'label'}`, `${what} 이름 필요`);
        else if (k !== 'exits') {
          for (const n of [nm, ...(Array.isArray(e.alias) ? e.alias : []), ...(Array.isArray(e.match) ? e.match : [])]) {
            if (typeof n !== 'string') { err(ep, '별칭·match는 문자열 배열'); continue; }
            if (names.has(n.trim())) err(ep, `이름 '${n}'이 다른 장소·구역과 겹칩니다 — 위치 값이 어디를 가리키는지 모호해집니다`);
            names.add(n.trim());
          }
        }
        for (const t of ['desc', 'rumor', 'sub', 'color']) if (e[t] != null && typeof e[t] !== 'string') err(`${ep}.${t}`, `${t}는 문자열`);
        knownChk(e.known, `${ep}.known`);
        if (k === 'exits') {
          if (!['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(e.dir)) err(`${ep}.dir`, 'dir은 n·ne·e·se·s·sw·w·nw 중 하나');
          if (e.at != null) pctChk(e.at, `${ep}.at`, 'at(변을 따라 놓을 자리)');
          return;
        }
        catChk(e.cat, `${ep}.cat`);
        const okX = pctChk(e.x, `${ep}.x`, 'x'), okY = pctChk(e.y, `${ep}.y`, 'y');
        if (k === 'zones') {
          const okW = pctChk(e.w, `${ep}.w`, 'w'), okH = pctChk(e.h, `${ep}.h`, 'h');
          if (okW && okH && (!e.w || !e.h)) err(ep, '구역 너비·높이(w·h)는 0보다 커야 함');
          if (okX && okY && okW && okH && (e.x + e.w > 100.5 || e.y + e.h > 100.5)) warn(ep, '구역이 지도 밖으로 나갑니다 — 넘친 만큼 잘려 그려집니다');
        }
      });
    }
    const nPlaces = Array.isArray(M.places) ? M.places.length : 0, nZones = Array.isArray(M.zones) ? M.zones.length : 0;
    if (M.listVar != null && !nZones) warn(`${P}.listVar`, '찾아낸 곳은 구역에 꽂힙니다 — 구역(zones)이 없으면 전부 "자리를 못 찾은 곳"이 됩니다');
    if (seenDef && (seenDef.maxItems ?? 20) < nPlaces + nZones) warn(`${P}.seenVar`, `발자취 목록 '${seenDef.id}'의 maxItems(${seenDef.maxItems ?? 20})가 장소+구역 수(${nPlaces + nZones})보다 작습니다 — 꽉 차면 더 적지 못해 새로 간 곳이 안개에 남습니다`);
    // 안개 지도에서 위치 선택지에 없는 장소 = 영영 못 가 보는 곳 (known도 없으면 끝까지 안 보인다)
    if (M.fog === true && locDef && locDef.type === 'enum' && Array.isArray(locDef.enum) && Array.isArray(M.places)) {
      const en = new Set(locDef.enum.map((x) => String(x).trim()));
      const never = M.places.filter((p) => p && typeof p.name === 'string' && p.known == null
        && ![p.name, ...(Array.isArray(p.alias) ? p.alias : [])].some((n) => en.has(String(n).trim()))).map((p) => p.name);
      if (never.length) warn(`${P}.places`, `위치 선택지(${M.locVar})에 없고 known도 없는 장소 ${never.length}곳 — 갈 수 없어 끝까지 안개 속입니다: ${never.slice(0, 5).join(', ')}${never.length > 5 ? ' …' : ''}`);
    }
  }
}

// ── 그리기 ─────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeColor = (c) => (/^#[0-9a-f]{3,8}$|^[a-z]+$|^(rgb|hsl)a?\([\d\s.,%]+\)$/i.test(String(c || '')) ? c : null);

/** 지금 고른 것의 사정 — 장소·찾아낸 곳·구역 */
function detailOf(view, key) {
  if (!key) return null;
  const p = view.places.find((x) => x.key === key);
  if (p && p.state !== 'hidden') {
    const z = p.zone ? view.zoneOf(p.zone) : null;
    const badge = p.here ? '📍 지금 여기' : p.state === 'seen' ? (view.fogOn ? '✓ 가 본 곳' : '') : view.fog ? '소문으로만 아는 곳' : '';
    const text = (p.state === 'seen' || !view.fog) ? p.desc : (p.rumor || '아직 가 보지 않은 곳이다.');
    return { title: p.name, sub: p.sub, where: [z?.open ? z.label : null, p.cat].filter(Boolean).join(' · '), badge, text, list: [] };
  }
  const d = view.pins.find((x) => x.key === key);
  if (d) {
    const z = view.zoneOf(d.zone);
    return { title: d.name, sub: '', where: [z?.label, d.cat].filter(Boolean).join(' · '), badge: d.here ? '📍 지금 여기' : '✓ 찾아낸 곳',
      text: d.raw !== d.name ? d.raw : '', list: [] };
  }
  const z = view.zoneOf(key);
  if (z) {
    if (!z.open) return { title: '？', sub: '', where: '', badge: '아직 그려지지 않은 곳', text: '아무도 이곳을 지도에 옮기지 않았다.', list: [] };
    const names = [
      ...z.places.map((k) => view.places.find((p) => p.key === k)).filter((p) => p && p.state !== 'hidden').map((p) => p.name),
      ...z.pins.map((k) => view.pins.find((q) => q.key === k)?.name).filter(Boolean),
    ];
    return { title: z.label, sub: '', where: z.cat || '', badge: z.here ? '📍 지금 여기' : (view.fogOn && z.seen ? '✓ 가 본 곳' : ''),
      text: z.desc, list: names };
  }
  return null;
}

/**
 * 지도 몸통 HTML — 패널과 편집기 미리보기가 같이 쓴다. 제목·닫기는 부르는 쪽 몫.
 * ui { cat: 분류 이름|null, sel: 고른 열쇠|null }, opts { bgUrl, pick: 편집기 찍기 중인가 }
 * 상호작용은 data-scm(고르기)·data-scm-cat(분류) 속성 — 부르는 쪽이 위임 클릭으로 받는다.
 */
function renderMapHtml(view, ui = {}, opts = {}) {
  if (!view) return '';
  const cat = ui.cat && view.cats.some((c) => c.label === ui.cat) ? ui.cat : null;
  const dim = (c) => (cat && c !== cat ? ' scm-dim' : '');
  const color = (c) => { const ok = safeColor(c); return ok ? `--scm-c:${ok};` : ''; };
  const sel = ui.sel || null;
  const h = [];
  h.push(`<div class="scm${opts.pick ? ' scm-picking' : ''}">`);
  if (view.cats.length) {
    h.push('<div class="scm-filters" role="toolbar" aria-label="분류">');
    h.push(`<button type="button" class="scm-fbtn${cat ? '' : ' scm-on'}" data-scm-cat="">전체</button>`);
    for (const c of view.cats) {
      h.push(`<button type="button" class="scm-fbtn${cat === c.label ? ' scm-on' : ''}" data-scm-cat="${esc(c.label)}" style="${color(c.color)}"><i class="scm-sw"></i>${esc(c.label)}</button>`);
    }
    h.push('</div>');
  }
  h.push(`<div class="scm-frame" style="--scm-ratio:${round1(view.ratio * 100)}%"><div class="scm-surface">`);
  if (opts.bgUrl) h.push(`<img class="scm-bg" src="${esc(opts.bgUrl)}" alt="">`);
  for (const z of view.zones) {
    const cls = `scm-zone${z.open ? '' : ' scm-fog'}${z.here ? ' scm-here' : ''}${sel === z.key ? ' scm-sel' : ''}${dim(z.cat)}`;
    h.push(`<button type="button" class="${cls}" data-scm="${z.key}" style="left:${z.x}%;top:${z.y}%;width:${z.w}%;height:${z.h}%;${z.open ? color(z.color) : ''}" aria-label="${esc(z.open ? z.label : '아직 그려지지 않은 곳')}${z.here ? ' (현재 위치)' : ''}">`
      // 구역이 '지금 여기'면 가운데 점 대신 이름표에 붙인다 — 가운데엔 그 구역의 핀들이 앉는다
      + `<span class="scm-zl">${esc(z.open ? z.label : '？')}${z.here ? '<b class="scm-zhere">📍 현재 위치</b>' : ''}</span></button>`);
  }
  const side = (x) => (x > LABEL_LEFT_AT ? ' scm-left' : '');
  for (const p of view.places) {
    if (p.state === 'hidden') continue;
    // 안개가 없는 지도에선 '소문' 모양(빈 마름모)을 안 쓴다 — 다 아는 곳이다
    const cls = `scm-pin scm-st-${view.fog ? p.state : 'seen'}${p.here ? ' scm-here' : ''}${sel === p.key ? ' scm-sel' : ''}${side(p.x)}${dim(p.cat)}`;
    h.push(`<button type="button" class="${cls}" data-scm="${p.key}" style="left:${p.x}%;top:${p.y}%;${color(p.color)}" aria-label="${esc(p.name)}${p.here ? ' (현재 위치)' : ''}">`
      + `<i class="scm-dot"></i><span class="scm-name">${esc(p.name)}${p.state === 'known' && view.fog ? ' ?' : ''}</span>`
      + (p.here ? '<span class="scm-now">현재 위치</span>' : '') + '</button>');
  }
  for (const d of view.pins) {
    const cls = `scm-pin scm-dyn${d.here ? ' scm-here' : ''}${sel === d.key ? ' scm-sel' : ''}${side(d.x)}${dim(d.cat)}`;
    h.push(`<button type="button" class="${cls}" data-scm="${d.key}" style="left:${d.x}%;top:${d.y}%;${color(d.color)}" aria-label="${esc(d.name)}${d.here ? ' (현재 위치)' : ''}">`
      + `<i class="scm-dot"></i><span class="scm-name">${esc(d.name)}</span>`
      + (d.here ? '<span class="scm-now">현재 위치</span>' : '') + '</button>');
  }
  for (const e of view.exits) {
    const pos = e.edge === 'top' || e.edge === 'bottom' ? `left:${e.at}%` : `top:${e.at}%`;
    h.push(`<span class="scm-exit scm-edge-${e.edge}" style="${pos}">${e.arrow} ${esc(e.label)}</span>`);
  }
  h.push('</div></div>');

  // 아래 — 지금 · 채운 정도 · 고른 곳의 사정
  h.push('<div class="scm-under">');
  if (view.loc) h.push(`<div class="scm-hereline">📍 <b>${esc(view.loc)}</b>${view.here ? '' : ' <span class="scm-off">(지도 밖)</span>'}</div>`);
  const cnt = [];
  if (view.counts.places) cnt.push(view.fogOn ? `장소 ${view.counts.seen} / ${view.counts.places}` : `장소 ${view.counts.places}곳`);
  if (view.counts.zones && view.fogOn) cnt.push(`지역 ${view.counts.open} / ${view.counts.zones}`);
  if (view.counts.pins) cnt.push(`찾아낸 곳 ${view.counts.pins}`);
  if (view.exits.length) cnt.push(`이정표 ${view.exits.length}`);
  if (cnt.length) h.push(`<div class="scm-count">${cnt.join(' · ')}</div>`);
  if (view.note) h.push(`<div class="scm-note">${esc(view.note)}</div>`);
  const dt = detailOf(view, sel);
  if (dt) {
    h.push('<div class="scm-detail">');
    h.push(`<div class="scm-dt-head"><b class="scm-dt-title">${esc(dt.title)}</b>${dt.sub ? ` <span class="scm-dt-sub">${esc(dt.sub)}</span>` : ''}${dt.badge ? ` <span class="scm-dt-badge">${esc(dt.badge)}</span>` : ''}</div>`);
    if (dt.where) h.push(`<div class="scm-dt-where">${esc(dt.where)}</div>`);
    if (dt.text) h.push(`<div class="scm-dt-text">${esc(dt.text)}</div>`);
    if (dt.list.length) h.push(`<div class="scm-dt-list">${dt.list.map((n) => `<span>${esc(n)}</span>`).join('')}</div>`);
    h.push('</div>');
  } else {
    h.push('<div class="scm-hint">장소를 누르면 그곳의 사정을 볼 수 있어요. 다시 누르면 닫혀요.</div>');
  }
  if (view.stray.length) {
    h.push(`<div class="scm-stray">자리를 못 찾은 곳 — ${view.stray.map((s) => esc(s.raw)).join(', ')}<br><small>항목 끝에 구역 이름을 괄호로 붙이면 그 구역에 놓여요 (예: "이름 (${esc(view.zones[0]?.label || '구역')})")</small></div>`);
  }
  h.push('</div></div>');
  return h.join('');
}

// 기본 모양 — 낡은 종이 지도. 봇의 map.css가 #sc-game 범위로 덮어쓴다 (편집기 미리보기는 .sce-map-preview 범위)
const MAP_CSS = `
.scm{font-size:13px}
.scm *{box-sizing:border-box}
.scm-filters{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 9px}
.scm-fbtn{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(128,128,128,.45);border-radius:999px;background:rgba(128,128,128,.12);color:inherit;padding:3px 11px;font-size:12.5px;cursor:pointer;font-family:inherit}
.scm-fbtn:hover{border-color:rgba(128,128,128,.8)}
.scm-fbtn.scm-on{background:#7d2a20;border-color:#c0574a;color:#fff;font-weight:700}
.scm-sw{display:inline-block;width:8px;height:8px;transform:rotate(45deg);background:var(--scm-c,#8a2a22)}
.scm-frame{position:relative;width:100%;container-type:inline-size;border-radius:10px;overflow:hidden;border:2px solid #5a4630;box-shadow:0 6px 18px rgba(0,0,0,.35)}
.scm-frame::before{content:'';display:block;padding-top:var(--scm-ratio,100%)}
.scm-surface{position:absolute;inset:0;color:#3b2a1a;background-color:#e8dcbf;
  background-image:linear-gradient(rgba(120,95,60,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(120,95,60,.10) 1px,transparent 1px),radial-gradient(ellipse at center,rgba(255,250,235,.55),rgba(160,130,85,.25));
  background-size:24px 24px,24px 24px,100% 100%}
.scm-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}
.scm-zone{position:absolute;display:block;margin:0;padding:3px 5px;text-align:left;border:1.5px solid rgba(90,70,48,.45);border-radius:9px;
  background:rgba(120,150,90,.16);background:color-mix(in srgb,var(--scm-c,#7d9a5a) 20%,transparent);cursor:pointer;font-family:inherit;color:inherit;z-index:1}
.scm-zone:hover{border-color:rgba(90,70,48,.8)}
.scm-zl{position:absolute;left:4px;top:3px;display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.02em;color:#4a3626;background:rgba(255,250,238,.7);border-radius:4px;padding:0 4px;max-width:calc(100% - 8px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scm-zhere{margin-left:4px;color:#a3271b;font-weight:800}
.scm-zone.scm-fog{background:repeating-linear-gradient(45deg,rgba(105,96,82,.42) 0 7px,rgba(105,96,82,.26) 7px 14px);border-style:dashed;border-color:rgba(80,70,58,.5)}
.scm-zone.scm-fog .scm-zl{left:50%;top:50%;transform:translate(-50%,-50%);background:none;color:rgba(60,50,40,.6);font-size:15px}
.scm-zone.scm-here{border-color:#a3271b;border-width:2px}
.scm-zone.scm-sel{outline:2px solid #2b1d10;outline-offset:1px}
.scm-pin{position:absolute;width:0;height:0;margin:0;padding:0;border:0;background:none;cursor:pointer;z-index:3;font-family:inherit}
.scm-dot{position:absolute;left:-6px;top:-6px;width:12px;height:12px;transform:rotate(45deg);background:var(--scm-c,#8a2a22);border:1.5px solid #fff8e8;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.scm-name{position:absolute;left:9px;top:-9px;font-size:11px;font-weight:700;line-height:16px;color:#2b1d10;background:rgba(255,250,238,.93);border:1px solid rgba(90,70,48,.55);border-radius:4px;padding:0 5px;white-space:nowrap}
.scm-pin.scm-left .scm-name{left:auto;right:9px}
.scm-pin:hover .scm-name,.scm-pin:focus-visible .scm-name{background:#fff;border-color:#2b1d10}
.scm-st-known .scm-dot{background:transparent;border:1.5px dashed var(--scm-c,#8a2a22);box-shadow:none}
.scm-st-known .scm-name{opacity:.8;font-style:italic}
.scm-dyn .scm-dot{width:9px;height:9px;left:-4.5px;top:-4.5px;border-radius:50%;transform:none}
.scm-dyn .scm-name{font-weight:600;font-size:10.5px;left:7px;top:-8px;line-height:15px}
.scm-dyn.scm-left .scm-name{right:7px}
.scm-pin.scm-sel .scm-name{background:#2b1d10;color:#fff8e8;border-color:#2b1d10}
.scm-pin.scm-here .scm-dot{background:#a3271b;border-color:#fff}
.scm-pin.scm-here .scm-dot::after{content:'';position:absolute;inset:-7px;border:2px solid #a3271b;border-radius:3px;animation:scm-ping 1.6s ease-out infinite}
.scm-now{position:absolute;left:-30px;top:10px;width:60px;text-align:center;font-size:10px;font-weight:800;color:#a3271b;text-shadow:0 0 3px #fff8e8,0 0 3px #fff8e8}
@keyframes scm-ping{from{opacity:.9;transform:scale(.7)}to{opacity:0;transform:scale(1.5)}}
@media (prefers-reduced-motion:reduce){.scm-pin.scm-here .scm-dot::after{animation:none}}
.scm-dim{opacity:.22}
.scm-exit{position:absolute;z-index:2;font-size:11px;font-weight:700;line-height:17px;color:#f3e6c8;background:#4a3423;border:1px solid #2c1f14;border-radius:4px;padding:0 6px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.35);pointer-events:none}
.scm-edge-top{top:5px;transform:translateX(-50%)}
.scm-edge-bottom{bottom:5px;transform:translateX(-50%)}
.scm-edge-left{left:5px;transform:translateY(-50%)}
.scm-edge-right{right:5px;transform:translateY(-50%)}
.scm-under{margin-top:9px}
.scm-hereline{display:inline-block;border:1px solid rgba(163,39,27,.7);background:rgba(163,39,27,.12);color:inherit;border-radius:7px;padding:3px 10px;font-size:12.5px}
.scm-off{opacity:.65;font-size:11.5px}
.scm-count{margin-top:6px;opacity:.75;font-size:12px}
.scm-note{margin-top:4px;opacity:.65;font-size:12px}
.scm-hint{margin-top:6px;opacity:.6;font-size:12px}
.scm-detail{margin-top:8px;background:#f4ead6;color:#2b1d10;border-left:4px solid #7d2a20;border-radius:8px;padding:10px 12px}
.scm-dt-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px}
.scm-dt-title{font-size:15px}
.scm-dt-sub{color:#7a6650;font-size:12px}
.scm-dt-badge{margin-left:auto;font-size:11px;font-weight:700;color:#7d2a20;border:1px solid rgba(125,42,32,.45);border-radius:999px;padding:0 8px}
.scm-dt-where{margin-top:2px;color:#7a6650;font-size:11.5px}
.scm-dt-text{margin-top:7px;font-size:13px;line-height:1.6;white-space:pre-wrap}
.scm-dt-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
.scm-dt-list span{font-size:11.5px;border:1px solid rgba(90,70,48,.4);border-radius:999px;padding:0 8px;background:rgba(255,255,255,.5)}
.scm-stray{margin-top:8px;font-size:12px;border-left:3px solid #c98a1a;padding-left:8px}
.scm-stray small{opacity:.7}
/* 좁은 화면 — 이름표는 px이고 자리는 %라 폭이 줄면 겹친다. 글자를 줄이고, 더 좁으면 찾아낸 곳은 점만 (누르거나 지금 여기면 이름) */
@container (max-width:460px){.scm-name{font-size:10px;line-height:14px;padding:0 3px;top:-8px}.scm-zl{font-size:9.5px}.scm-exit{font-size:10px;line-height:15px;padding:0 4px}.scm-now{font-size:9px}}
@container (max-width:380px){.scm-dyn .scm-name{display:none}.scm-dyn.scm-sel .scm-name,.scm-dyn.scm-here .scm-name,.scm-dyn:focus-visible .scm-name{display:block}}
.scm-picking .scm-surface{cursor:crosshair;outline:2px dashed #ffd166;outline-offset:-2px}
`;

module.exports = {
  DIRS, DIR_EDGE, CAPS, PALETTE, DEFAULT_RATIO, MAP_CSS,
  mapConfig, mapButtonSpec, mapView, recordVisit, validateMap, renderMapHtml, detailOf, splitTag, categoriesOf, ratioOf,
};
