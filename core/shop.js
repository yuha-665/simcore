// 상점 (v0.96) — 세계 안의 시스템 상점 (얼터헌터 "알터 스토어" 흡수가 발단).
//
// 로어북 상점의 고질병 두 가지를 구조로 잡는다:
//   · AI 뇌절 (S랭크 스킬북 남발) — 등급 어휘·등급별 가격 밴드를 스키마가 정하고,
//     밴드 밖 진열품은 시스템이 거부/클램프한다
//   · 가격 계산 — 결제·잔액·수량은 전부 엔진이 결정적으로 처리한다 (숫자는 시스템이)
//
// 거래 내역의 수명 (유저 설계: "영원히 쌓지 말고 다음 인풋에 싣고 비워라"):
//   · meta.pendingNotifies — 다음 전송에 [이벤트]로 실리고 자동 소거 (서사 반영 통로)
//   · meta.lastChanges — 보조 이중 계산 방지 원장 (매 턴 교체되는 기존 인프라)
//   · state.shop.log — 패널 표시용 최근 6건 (AI에게는 안 감)
//
// 재고의 수명:
//   · state.shop.stock — 스냅샷에 실려 리롤과 함께 되감김. 빈 동안만 턴 피기백으로 자동 입고,
//     그 뒤는 패널 [새로고침]으로만 물갈이 (매턴 토큰 비용 0)
//   · buying — 매입 시세판 (마정석 시세 등). 여기 있는 물건은 감정 없이 즉시 판매
//
// 스키마 (옵트인):
//   shop: { label, icon, currency(필수), buyTo(필수), sellFrom?, categories?, grades?,
//           bands?, sellRate?, maxStock?, guide?, when?, css?, exchange? }
//
// 환전 (v0.97): exchange: { var, rate, spread?, label? } — 상점 통화 ↔ 다른 지갑 변수.
//   1통화 = rate(상대 지갑 단위). spread가 암거래 수수료: 살 때 rate×(1+spread),
//   팔 때 rate×(1-spread). 계산은 전부 엔진 (환율 뇌절 방지 — 보조 호출 0).

const { evaluate, truthy } = require('./expr');

const CAPS = {
  NAME: 30, NOTE: 60, CAT: 12, STOCK_MAX: 30, BUYING_MAX: 12, LOG_MAX: 6,
  QTY_MAX: 9, PRICE_MAX: 100000000,
};

function shopConfig(schema) {
  const s = schema?.shop;
  if (!s || typeof s !== 'object') return null;
  if (typeof s.currency !== 'string' || !s.currency) return null;
  if (typeof s.buyTo !== 'string' || !s.buyTo) return null;
  return {
    label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : '상점',
    icon: typeof s.icon === 'string' && s.icon.trim() ? s.icon.trim() : '🛒',
    currency: s.currency,
    buyTo: s.buyTo,
    sellFrom: typeof s.sellFrom === 'string' && s.sellFrom ? s.sellFrom : null,
    categories: Array.isArray(s.categories) && s.categories.length
      ? s.categories.map((c) => String(c).slice(0, CAPS.CAT)).slice(0, 8) : ['일반'],
    grades: Array.isArray(s.grades) && s.grades.length ? s.grades.map(String) : null,
    bands: (s.bands && typeof s.bands === 'object') ? s.bands : null,  // { 등급: [최소, 최대] }
    sellRate: typeof s.sellRate === 'number' ? Math.max(0.1, Math.min(1, s.sellRate)) : 0.5,
    maxStock: Math.max(4, Math.min(CAPS.STOCK_MAX, s.maxStock ?? 18)),
    guide: typeof s.guide === 'string' ? s.guide : '',
    when: typeof s.when === 'string' ? s.when : '',
    css: typeof s.css === 'string' ? s.css : '',
    exchange: (s.exchange && typeof s.exchange === 'object'
      && typeof s.exchange.var === 'string' && s.exchange.var
      && typeof s.exchange.rate === 'number' && isFinite(s.exchange.rate) && s.exchange.rate > 0)
      ? {
        var: s.exchange.var,
        rate: s.exchange.rate,
        spread: typeof s.exchange.spread === 'number'
          ? Math.max(0, Math.min(0.9, s.exchange.spread)) : 0.2,
        label: typeof s.exchange.label === 'string' && s.exchange.label.trim()
          ? s.exchange.label.trim() : '환전',
      } : null,
  };
}

function initShop() { return { seq: 1, stock: [], buying: [], log: [], stocked: false }; }

function ensureShop(state) {
  const sh = state.shop;
  if (!sh || typeof sh !== 'object' || !Array.isArray(sh.stock)) state.shop = initShop();
  const s = state.shop;
  s.buying = Array.isArray(s.buying) ? s.buying : [];
  s.log = Array.isArray(s.log) ? s.log : [];
  if (typeof s.seq !== 'number' || !isFinite(s.seq)) s.seq = 1 + s.stock.reduce((m, x) => Math.max(m, x.id || 0), 0);
  return s;
}

function shopOpen(cfg, schema, vars, makeLookup) {
  if (!cfg.when) return true;
  try { return truthy(evaluate(cfg.when, makeLookup(schema, vars), null)); }
  catch { return true; }
}

const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** 가격을 등급 밴드로 클램프. 등급 어휘가 밴드 밖이면 null(거부) */
function clampPrice(cfg, grade, price) {
  let p = Math.round(Number(price));
  if (!isFinite(p) || p < 0) return null;
  p = Math.min(p, CAPS.PRICE_MAX);
  if (cfg.bands && grade && cfg.bands[grade]) {
    const [lo, hi] = cfg.bands[grade];
    p = Math.max(lo, Math.min(hi, p));
  }
  return p;
}

/** 보조가 준 재고를 규격으로 거른다 — 뇌절 방지의 실무 지점 */
function sanitizeStock(cfg, raw) {
  const out = { stock: [], buying: [], rejected: [] };
  if (!raw || typeof raw !== 'object') return out;
  for (const it of Array.isArray(raw.stock) ? raw.stock : []) {
    if (out.stock.length >= cfg.maxStock) break;
    if (!it || typeof it !== 'object') continue;
    const name = cut(it.name, CAPS.NAME);
    if (!name) continue;
    let grade = it.grade != null ? cut(it.grade, 12) : null;
    // 등급 어휘 통제 — 스키마에 없는 등급(레전더리 등)은 그 항목째 거부한다
    if (cfg.grades && grade && !cfg.grades.includes(grade)) { out.rejected.push(`${name} (등급 '${grade}')`); continue; }
    if (cfg.grades && !grade) grade = cfg.grades[0];
    const price = clampPrice(cfg, grade, it.price);
    if (price == null) { out.rejected.push(`${name} (가격 불명)`); continue; }
    const cat = cfg.categories.includes(cut(it.cat, CAPS.CAT)) ? cut(it.cat, CAPS.CAT) : cfg.categories[0];
    const qty = Number.isInteger(it.qty) && it.qty >= 1 ? Math.min(it.qty, CAPS.QTY_MAX) : null; // null = 무제한
    out.stock.push({ cat, name, grade, price, qty, note: cut(it.note, CAPS.NOTE) || null });
  }
  for (const b of Array.isArray(raw.buying) ? raw.buying : []) {
    if (out.buying.length >= CAPS.BUYING_MAX) break;
    if (!b || typeof b !== 'object') continue;
    const name = cut(b.name, CAPS.NAME);
    const price = clampPrice(cfg, null, b.price);
    if (!name || price == null) continue;
    out.buying.push({ name, price });
  }
  return out;
}

/** 재고 통째 교체 (물갈이) — 상점 진열창은 델타가 아니라 교체가 맞다 */
function applyStock(schema, state, raw) {
  const cfg = shopConfig(schema);
  if (!cfg) return { stocked: 0 };
  const shop = ensureShop(state);
  const clean = sanitizeStock(cfg, raw);
  if (!clean.stock.length && !clean.buying.length) return { stocked: 0, rejected: clean.rejected };
  shop.stock = clean.stock.map((it) => ({ id: shop.seq++, ...it }));
  if (clean.buying.length) shop.buying = clean.buying;
  shop.stocked = true;
  return { stocked: clean.stock.length, buying: clean.buying.length, rejected: clean.rejected };
}

/** 거래 공통 마무리 — 통지(다음 턴 서사) + 원장(이중 계산 방지) + 패널 로그(회전) */
function logTx(cfg, state, line) {
  const m = state.meta;
  m.pendingNotifies = m.pendingNotifies || [];
  m.pendingNotifies.push(`[${cfg.label}] ${line} 이번 서사에 자연스럽게 반영하라 — 수치 정산은 이미 끝났다.`);
  m.lastChanges = [...(m.lastChanges || []), `${cfg.label}: ${line}`].slice(-12);
  const shop = ensureShop(state);
  shop.log = [`${line}`, ...shop.log].slice(0, CAPS.LOG_MAX);
}

/** 소지 목록에 구매품 합류 — "이름 (등급)" 또는 기존 "… N" 끝수 증가 */
function mergeIntoList(list, display, maxItems) {
  const mBase = display.replace(/\s*\d+$/, '');
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item === display || item === mBase) { list[i] = `${mBase} 2`; return true; }
    const m = item.match(/^(.*)\s(\d+)$/);
    if (m && m[1] === mBase) { list[i] = `${mBase} ${Number(m[2]) + 1}`; return true; }
  }
  if (list.length >= maxItems) return false;
  list.push(display);
  return true;
}

/** 구매 — 결정적, 보조 호출 없음. 반환 { ok, reason?, line? } */
function buy(schema, state, itemId) {
  const cfg = shopConfig(schema);
  if (!cfg) return { ok: false, reason: '상점 없음' };
  const shop = ensureShop(state);
  const it = shop.stock.find((x) => x.id === itemId);
  if (!it) return { ok: false, reason: '이미 팔린 물건이에요' };
  const wallet = Number(state.vars[cfg.currency]) || 0;
  if (wallet < it.price) return { ok: false, reason: `잔액 부족 (${wallet} < ${it.price})` };
  const listDef = (schema.vars || []).find((v) => v.id === cfg.buyTo);
  const list = Array.isArray(state.vars[cfg.buyTo]) ? [...state.vars[cfg.buyTo]] : [];
  const display = it.grade ? `${it.name} (${it.grade})` : it.name;
  if (!mergeIntoList(list, display, listDef?.maxItems ?? 20)) {
    return { ok: false, reason: '소지품이 가득 찼어요' };
  }
  state.vars[cfg.currency] = wallet - it.price;
  state.vars[cfg.buyTo] = list;
  if (it.qty != null) { it.qty -= 1; if (it.qty <= 0) shop.stock = shop.stock.filter((x) => x.id !== itemId); }
  const line = `「${display}」 구매 (-${it.price}).`;
  logTx(cfg, state, line);
  return { ok: true, line };
}

/** 시세판 대조 — sellFrom 목록 항목이 즉시 판매 가능한가. 반환 매입가 또는 null */
function quoteFor(shop, itemText) {
  const base = String(itemText).replace(/\s*\d+$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  for (const b of shop.buying) {
    if (base === b.name || base.includes(b.name) || b.name.includes(base)) return b.price;
  }
  return null;
}

/** 판매 — 시세판 매치는 즉시, 아니면 감정가(보조)가 와야 한다. price = 감정가(원가 기준) */
function sell(schema, state, itemText, appraised = null) {
  const cfg = shopConfig(schema);
  if (!cfg || !cfg.sellFrom) return { ok: false, reason: '매입 창구 없음' };
  const shop = ensureShop(state);
  const list = Array.isArray(state.vars[cfg.sellFrom]) ? [...state.vars[cfg.sellFrom]] : [];
  const idx = list.indexOf(itemText);
  if (idx < 0) return { ok: false, reason: '가지고 있지 않은 물건이에요' };
  const quoted = quoteFor(shop, itemText);
  const gross = quoted != null ? quoted
    : appraised != null ? clampPrice(cfg, null, appraised) : null;
  if (gross == null) return { ok: false, needAppraisal: true };
  // 시세판 가격은 이미 매입가, 감정가는 sellRate를 물린다
  const payout = quoted != null ? quoted : Math.max(1, Math.round(gross * cfg.sellRate));
  // 끝수 수량("… N")이면 하나만 깎고, 아니면 항목 제거
  const m = itemText.match(/^(.*)\s(\d+)$/);
  if (m && Number(m[2]) > 1) list[idx] = `${m[1]} ${Number(m[2]) - 1}`;
  else list.splice(idx, 1);
  state.vars[cfg.sellFrom] = list;
  state.vars[cfg.currency] = (Number(state.vars[cfg.currency]) || 0) + payout;
  const line = `「${m ? m[1] : itemText}」 판매 (+${payout}).`;
  logTx(cfg, state, line);
  return { ok: true, line, payout };
}

/** 단위당 환율 — buy: 통화 1을 사는 값(상대 지갑), sell: 통화 1을 판 값. spread가 암거래 수수료 */
function exchangeRates(cfg) {
  const ex = cfg?.exchange;
  if (!ex) return null;
  return {
    buy: Math.max(1, Math.ceil(ex.rate * (1 + ex.spread))),
    sell: Math.max(1, Math.floor(ex.rate * (1 - ex.spread))),
  };
}

/** 환전 — 결정적, 보조 호출 없음. dir 'buy' = 통화 사기(상대 지갑 지불) / 'sell' = 통화 팔기 */
function exchange(schema, state, qty, dir) {
  const cfg = shopConfig(schema);
  if (!cfg || !cfg.exchange) return { ok: false, reason: '환전 창구 없음' };
  const rates = exchangeRates(cfg);
  const n = Math.floor(Number(qty));
  if (!isFinite(n) || n < 1) return { ok: false, reason: '수량은 1 이상 정수' };
  if (n > 1000000) return { ok: false, reason: '한 번에 백만까지만' };
  const label = (id) => (schema.vars || []).find((v) => v.id === id)?.label ?? id;
  const curVal = Number(state.vars[cfg.currency]) || 0;
  const exVal = Number(state.vars[cfg.exchange.var]) || 0;
  let line;
  if (dir === 'buy') {
    const cost = n * rates.buy;
    if (exVal < cost) return { ok: false, reason: `${label(cfg.exchange.var)} 부족 (${exVal} < ${cost})` };
    state.vars[cfg.currency] = curVal + n;
    state.vars[cfg.exchange.var] = exVal - cost;
    line = `${label(cfg.currency)} +${n} (${label(cfg.exchange.var)} -${cost}).`;
  } else {
    if (curVal < n) return { ok: false, reason: `${label(cfg.currency)} 부족 (${curVal} < ${n})` };
    const gain = n * rates.sell;
    state.vars[cfg.currency] = curVal - n;
    state.vars[cfg.exchange.var] = exVal + gain;
    line = `${label(cfg.currency)} -${n} (${label(cfg.exchange.var)} +${gain}).`;
  }
  // 통지 접두는 환전 창구 이름 — 상점 본체와 다른 장소일 수 있다 (얼헌: 알터 스토어 ≠ 암시장)
  logTx({ ...cfg, label: cfg.exchange.label }, state, line);
  return { ok: true, line };
}

const bandsText = (cfg) => cfg.bands
  ? Object.entries(cfg.bands).map(([g, [lo, hi]]) => `${g} ${lo}~${hi}`).join(' / ')
  : null;

/** 입고 지시 본문 — 턴 피기백(빈 재고 자동 입고)과 수동 새로고침이 같은 규격을 쓴다 */
function stockSpecBody(cfg) {
  return [
    `- "shop" 필드로 진열 상품("stock") ${Math.min(8, cfg.maxStock)}~${cfg.maxStock}개와 매입 시세판("buying") 3~${CAPS.BUYING_MAX}개를 내라.`,
    `- 카테고리(cat)는 다음 중에서만: ${cfg.categories.join(' | ')}. 카테고리마다 골고루.`,
    cfg.grades ? `- 등급(grade)은 다음 중에서만: ${cfg.grades.join(' | ')}. 그 밖의 등급은 시스템이 거부한다.` : null,
    bandsText(cfg) ? `- 가격 밴드 (시스템이 강제한다): ${bandsText(cfg)}.` : null,
    cfg.guide ? `- ${cfg.guide}` : null,
    '- 한정 수량 상품은 "qty"(1~9)를 달아라 (없으면 무제한). note는 한 줄 설명 (선택).',
    '- shop 형식: {"stock":[{"cat","name","grade","price","qty","note"}],"buying":[{"name","price"}]}',
  ].filter((x) => x !== null);
}

/** 턴 피기백 — 재고가 빈 동안만 (첫 입고). 이후 물갈이는 패널 버튼으로만 */
function auxSpec(schema, state, makeLookup) {
  const cfg = shopConfig(schema);
  if (!cfg) return '';
  const shop = state.shop;
  if (shop?.stocked || shop?.stock?.length) return '';
  if (!shopOpen(cfg, schema, state.vars, makeLookup)) return '';
  return ['', `[${cfg.label} — 시스템 상점 첫 입고] (필수 항목)`, ...stockSpecBody(cfg)].join('\n');
}

/** 패널 인터랙션 프롬프트 — restock(물갈이) / appraise(감정) */
function interactionPrompt(schema, state, kind, payload = {}) {
  const cfg = shopConfig(schema);
  if (!cfg) return null;
  const shop = ensureShop(state);
  if (kind === 'appraise') {
    return [
      `너는 "${cfg.label}"의 감정사다. 아래 물건의 매입 원가를 정하라.`,
      cfg.guide ? cfg.guide : null,
      bandsText(cfg) ? `가격 밴드 감각: ${bandsText(cfg)}.` : null,
      payload.narrative ? '[이야기 맥락]' : null,
      payload.narrative ? String(payload.narrative).slice(0, 1600) : null,
      '',
      `[감정 대상] ${cut(payload.item, CAPS.NAME + 20)}`,
      '',
      '출력 형식 (JSON만, 다른 텍스트 금지): {"shop":{"appraisal":숫자}}',
    ].filter((x) => x !== null).join('\n');
  }
  // restock — 현재 진열을 참고로 주고 통째 물갈이
  return [
    `너는 "${cfg.label}" 시스템 상점이다. 진열을 새로 짜라 (전 품목 교체 — 일부는 남겨도 된다).`,
    '[지금 진열]',
    shop.stock.length ? shop.stock.map((it) => `- [${it.cat}] ${it.name}${it.grade ? ` (${it.grade})` : ''} ${it.price}`).join('\n') : '(비어 있음)',
    payload.narrative ? '[이야기 맥락]' : null,
    payload.narrative ? String(payload.narrative).slice(0, 1600) : null,
    '',
    ...stockSpecBody(cfg),
    '',
    '출력 형식 (JSON만, 다른 텍스트 금지): {"shop":{"stock":[...],"buying":[...]}}',
  ].filter((x) => x !== null).join('\n');
}

function parseInteraction(text, extractJsonObject) {
  const obj = extractJsonObject(text, 'shop');
  return obj?.shop ?? null;
}

module.exports = {
  CAPS, shopConfig, initShop, ensureShop, shopOpen, sanitizeStock, applyStock,
  buy, sell, quoteFor, mergeIntoList, clampPrice, exchange, exchangeRates,
  auxSpec, interactionPrompt, parseInteraction,
};
