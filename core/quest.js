// 의뢰판 (v1.7.9) — 세계 안의 시스템 퀘스트 보드 (아틀리에 "벽보 의뢰 수주가 애매하다"가 발단).
//
// 게시판(board)에 의뢰를 얹으면 두 가지가 어긋난다:
//   · 메인은 게시판 원문을 못 받는다 (화제 한 줄뿐) — 의뢰인·내용·보수·기한을 모른 채 수주 장면을 쓴다
//   · "받았다"는 사실이 보조의 기록에만 의존한다 — 벽보 800콜이 수첩엔 500콜로 적힌다
// 의뢰판은 **수락·취소를 시스템 버튼**으로 만든다. 수락하면 스키마의 목록 변수에 봇이 정한 형식
// 그대로 항목이 들어가고(기존 기한·정산 기계가 그대로 돈다), 다음 전송에 통지 한 줄로 넷이 다 실린다.
//
// 상점(shop)과 같은 규약:
//   · 게시는 보조가 채운다 — 첫 게시는 턴 피기백, 그 뒤엔 게시가 minOffers 아래로 떨어졌을 때만
//     refillEvery턴 간격으로 보충 (평턴 비용 0에 가깝게), 패널 [새로고침]은 통째 교체
//   · 보수는 등급 밴드로 클램프, 밴드 밖 등급은 거부 (뇌절 방지)
//   · 수락·취소는 보조 호출 0 — 목록 변수·효과(effects)는 엔진이 결정적으로 처리
//   · 통지는 meta.pendingNotifies로 다음 전송 1회, 원장은 meta.lastChanges (이중 계산 방지)
//   · 게시물은 state.questBoard.offers (스냅샷 — 리롤과 함께 되감김). 게시 마감(until)은
//     시간 체계가 있으면 경과일, 없으면 턴 수 기준 — 지나면 시스템이 걷는다
//
// 스키마 (옵트인):
//   questBoard: { label, icon, listVar(필수), format?, grades?, bands?, days?, postDays?,
//                 maxOffers?, minOffers?, refillEvery?, unit?, accept?, cancel?, guide?, when?, css? }
//   · format: 목록 항목 형식. {client} {title} {grade} {pay} {days} {note} 자리 —
//     기본 '{client} · {title} ({grade}) @+{days} +{pay}' (엔진 목록 기한 규약 "@+N"과 끝수 보수)
//   · accept / cancel: [{ set, expr }] — 수락·취소 때 시스템이 적용하는 효과 (평판 -3 등).
//     식에서 pay·days·grade를 읽을 수 있다 (그 의뢰의 값).

const { evaluate, truthy } = require('./expr');
const { timeConfig } = require('./time');

const CAPS = {
  CLIENT: 24, TITLE: 40, NOTE: 80, GRADE: 12, OFFERS_MAX: 12, LOG_MAX: 6, PAY_MAX: 100000000, DAYS_MAX: 365,
};

const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const intIn = (v, lo, hi, dflt) => (Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
const pairIn = (v, lo, hi, dflt) => {
  if (!Array.isArray(v) || v.length !== 2 || !Number.isInteger(v[0]) || !Number.isInteger(v[1])) return dflt;
  const a = Math.max(lo, Math.min(hi, v[0])); const b = Math.max(lo, Math.min(hi, v[1]));
  return [Math.min(a, b), Math.max(a, b)];
};
const effectsOf = (raw) => (Array.isArray(raw) ? raw : [])
  .filter((e) => e && typeof e === 'object' && typeof e.set === 'string' && e.set && typeof e.expr === 'string' && e.expr.trim())
  .map((e) => ({ set: e.set, expr: e.expr }));

const DEFAULT_FORMAT = '{client} · {title} ({grade}) @+{days} +{pay}';

function questConfig(schema) {
  const q = schema?.questBoard;
  if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
  if (typeof q.listVar !== 'string' || !q.listVar) return null;
  const maxOffers = intIn(q.maxOffers, 3, CAPS.OFFERS_MAX, 6);
  return {
    label: typeof q.label === 'string' && q.label.trim() ? q.label.trim() : '의뢰판',
    icon: typeof q.icon === 'string' && q.icon.trim() ? q.icon.trim() : '📜',
    listVar: q.listVar,
    format: typeof q.format === 'string' && q.format.trim() ? q.format.trim() : DEFAULT_FORMAT,
    grades: Array.isArray(q.grades) && q.grades.length ? q.grades.map((g) => cut(g, CAPS.GRADE)).filter(Boolean) : null,
    bands: (q.bands && typeof q.bands === 'object' && !Array.isArray(q.bands)) ? q.bands : null,
    days: pairIn(q.days, 1, CAPS.DAYS_MAX, [1, 30]),
    postDays: pairIn(q.postDays, 1, CAPS.DAYS_MAX, [3, 10]),
    maxOffers,
    minOffers: intIn(q.minOffers, 0, maxOffers, Math.min(2, maxOffers)),
    refillEvery: intIn(q.refillEvery, 1, 20, 3),
    unit: typeof q.unit === 'string' ? cut(q.unit, 8) : '',
    accept: effectsOf(q.accept),
    cancel: effectsOf(q.cancel),
    guide: typeof q.guide === 'string' ? q.guide : '',
    when: typeof q.when === 'string' ? q.when : '',
    mainInject: q.mainInject !== false,   // v1.7.12 — 게시 목록을 메인에 싣는다 (기본 켬)
    css: typeof q.css === 'string' ? q.css : '',
  };
}

function initQuestBoard() { return { seq: 1, offers: [], log: [], stocked: false, lastFill: -1 }; }

/** 상태 보장 — initState·reconcile이 부른다 (상점 ensureShops와 같은 규약) */
function ensureQuestBoard(schema, state) {
  if (!questConfig(schema)) return null;
  const qb = state.questBoard;
  if (!qb || typeof qb !== 'object' || !Array.isArray(qb.offers)) state.questBoard = initQuestBoard();
  const s = state.questBoard;
  s.log = Array.isArray(s.log) ? s.log : [];
  if (typeof s.seq !== 'number' || !isFinite(s.seq)) s.seq = 1 + s.offers.reduce((m, x) => Math.max(m, x.id || 0), 0);
  if (typeof s.lastFill !== 'number') s.lastFill = -1;
  return s;
}

function questOpen(cfg, schema, vars, makeLookup) {
  if (!cfg.when) return true;
  try { return truthy(evaluate(cfg.when, makeLookup(schema, vars), null)); }
  catch { return true; }
}

/** "지금" — 게시 마감의 기준. 시간 체계가 있으면 경과일(elapsed), 없으면 턴 수 */
function nowOf(schema, state, makeLookup) {
  const turn = Number(state?.meta?.turn) || 0;
  if (timeConfig(schema) && typeof makeLookup === 'function') {
    try {
      const e = Number(makeLookup(schema, state.vars)('elapsed'));
      if (isFinite(e)) return { kind: 'day', value: e, turn };
    } catch { /* 폴백 */ }
  }
  return { kind: 'turn', value: turn, turn };
}

/** 보수를 등급 밴드로 클램프. 등급이 밴드 밖이면 null(거부) */
function clampPay(cfg, grade, pay) {
  let p = Math.round(Number(pay));
  if (!isFinite(p) || p < 0) return null;
  p = Math.min(p, CAPS.PAY_MAX);
  if (cfg.bands && grade && Array.isArray(cfg.bands[grade]) && cfg.bands[grade].length === 2) {
    const [lo, hi] = cfg.bands[grade];
    p = Math.max(lo, Math.min(hi, p));
  }
  return p;
}

/** 보조가 준 게시를 규격으로 거른다 — 뇌절 방지의 실무 지점 */
function sanitizeOffers(cfg, raw, now, rng = Math.random) {
  const out = { offers: [], rejected: [] };
  if (!raw || typeof raw !== 'object') return out;
  const list = Array.isArray(raw.new) ? raw.new : Array.isArray(raw.offers) ? raw.offers : Array.isArray(raw) ? raw : [];
  for (const it of list) {
    if (out.offers.length >= cfg.maxOffers) break;
    if (!it || typeof it !== 'object') continue;
    const title = cut(it.title, CAPS.TITLE);
    if (!title) continue;
    const client = cut(it.client, CAPS.CLIENT) || '이름 없는 의뢰인';
    let grade = it.grade != null ? cut(it.grade, CAPS.GRADE) : null;
    if (cfg.grades && grade && !cfg.grades.includes(grade)) { out.rejected.push(`${title} (등급 '${grade}')`); continue; }
    if (cfg.grades && !grade) grade = cfg.grades[0];
    const pay = clampPay(cfg, grade, it.pay);
    if (pay == null) { out.rejected.push(`${title} (보수 불명)`); continue; }
    const d = Math.round(Number(it.days));
    const days = isFinite(d) ? Math.max(cfg.days[0], Math.min(cfg.days[1], d)) : cfg.days[0];
    // 게시 마감 — postDays 범위에서 시스템이 정한다 (보조가 정하면 "영구 게시" 뇌절)
    const span = cfg.postDays[0] + Math.floor((rng() || 0) * (cfg.postDays[1] - cfg.postDays[0] + 1));
    const until = (now?.value ?? 0) + Math.max(cfg.postDays[0], Math.min(cfg.postDays[1], span));
    out.offers.push({ client, title, grade, pay, days, note: cut(it.note, CAPS.NOTE) || null, until });
  }
  return out;
}

/** 게시 적용 — replace(첫 게시·새로고침)는 통째 교체, 아니면 보충(append, 상한까지) */
function applyOffers(schema, state, raw, { replace = false, now = null, rng = Math.random } = {}) {
  const cfg = questConfig(schema);
  if (!cfg) return { posted: 0 };
  const qb = ensureQuestBoard(schema, state);
  const clean = sanitizeOffers(cfg, raw, now, rng);
  const turn = now?.turn ?? (Number(state?.meta?.turn) || 0);
  if (!clean.offers.length) { qb.lastFill = turn; return { posted: 0, rejected: clean.rejected }; }
  const stamped = clean.offers.map((o) => ({ id: qb.seq++, ...o }));
  if (replace || !qb.stocked) qb.offers = stamped;
  else {
    // 보충 — 같은 제목은 안 겹치게, 상한까지만
    const have = new Set(qb.offers.map((o) => o.title));
    for (const o of stamped) {
      if (qb.offers.length >= cfg.maxOffers) break;
      if (have.has(o.title)) continue;
      qb.offers.push(o); have.add(o.title);
    }
  }
  qb.stocked = true;
  qb.lastFill = turn;
  return { posted: stamped.length, rejected: clean.rejected };
}

/** 게시 마감 걷기 — 매 턴 시스템이 (outputPhase). 반환: 걷힌 수 */
function pruneExpired(schema, state, now) {
  const cfg = questConfig(schema);
  if (!cfg || !now) return 0;
  const qb = ensureQuestBoard(schema, state);
  const before = qb.offers.length;
  qb.offers = qb.offers.filter((o) => !(typeof o.until === 'number' && o.until <= now.value));
  return before - qb.offers.length;
}

/** 남은 게시일 — 패널 표기용 */
function offerLeft(offer, now) {
  if (!now || typeof offer?.until !== 'number') return null;
  const n = offer.until - now.value;
  return now.kind === 'day' ? `${Math.max(0, n)}일` : `${Math.max(0, n)}턴`;
}

/** 목록 항목 문자열 — 봇이 정한 형식 그대로 (기한·정산 기계가 이 문자열을 읽는다) */
function formatEntry(cfg, o) {
  const s = cfg.format
    .replace(/\{client\}/g, o.client ?? '')
    .replace(/\{title\}/g, o.title ?? '')
    .replace(/\{grade\}/g, o.grade ?? '')
    .replace(/\{pay\}/g, String(o.pay ?? ''))
    .replace(/\{days\}/g, String(o.days ?? ''))
    .replace(/\{note\}/g, o.note ?? '');
  return s.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
}

/** 거래 공통 마무리 — 통지(다음 턴 서사) + 원장 + 패널 로그 */
function logTx(cfg, state, line, tail) {
  const m = state.meta;
  m.pendingNotifies = m.pendingNotifies || [];
  m.pendingNotifies.push(`[${cfg.label}] ${line} ${tail}`);
  m.lastChanges = [...(m.lastChanges || []), `${cfg.label}: ${line}`].slice(-12);
  const qb = state.questBoard;   // 호출자(accept/cancel)가 ensureQuestBoard를 먼저 부른다
  if (qb) qb.log = [line, ...(qb.log || [])].slice(0, CAPS.LOG_MAX);
}

/** 효과 적용 — [{set, expr}] 결정적. 식은 그 의뢰의 pay·days·grade를 읽을 수 있다 */
function applyEffects(schema, state, effects, offer, makeLookup) {
  const changes = {};
  if (!effects.length || typeof makeLookup !== 'function') return changes;
  const varDefs = schema.vars || [];
  for (const e of effects) {
    const def = varDefs.find((v) => v.id === e.set);
    if (!def) continue;
    const base = makeLookup(schema, state.vars);
    const lookup = (name) => (name === 'pay' ? offer.pay : name === 'days' ? offer.days : name === 'grade' ? (offer.grade ?? '') : base(name));
    let v;
    try { v = evaluate(e.expr, lookup, null); } catch { continue; }
    if (def.type === 'int' || def.type === 'float') {
      let n = Number(v); if (!isFinite(n)) continue;
      if (def.type === 'int') n = Math.round(n);
      if (typeof def.min === 'number') n = Math.max(def.min, n);
      if (typeof def.max === 'number') n = Math.min(def.max, n);
      state.vars[e.set] = n; changes[e.set] = n;
    } else if (def.type === 'bool') { state.vars[e.set] = truthy(v); changes[e.set] = state.vars[e.set]; }
    else if (def.type === 'enum' || def.type === 'text') { state.vars[e.set] = String(v); changes[e.set] = state.vars[e.set]; }
  }
  return changes;
}

const payText = (cfg, n) => `${n}${cfg.unit}`;

/** 목록 expire 식이 "지금"이다 — 그 값을 읽어 "@+N" → "@(지금+N)". 규칙이 없거나 식이 깨지면 그대로 */
function listNow(schema, state, listId, makeLookup) {
  const rule = (schema?.rules?.onTurn || []).find((r) => r && r.list === listId && r.expire);
  if (!rule || typeof makeLookup !== 'function') return null;
  try { const v = Number(evaluate(rule.expire, makeLookup(schema, state.vars), null)); return isFinite(v) ? v : null; }
  catch { return null; }
}
function freezeRelative(schema, state, listId, entry, makeLookup) {
  if (!/@\+\d/.test(entry)) return entry;
  const now = listNow(schema, state, listId, makeLookup);
  if (now == null) return entry;
  return entry.replace(/@\+(\d+(?:\.\d+)?)/g, (_, n) => '@' + Math.round(now + parseFloat(n)));
}

/** 수락 — 결정적, 보조 호출 없음. 게시에서 빼 목록 변수에 형식대로 넣는다 */
function accept(schema, state, offerId, makeLookup) {
  const cfg = questConfig(schema);
  if (!cfg) return { ok: false, reason: '의뢰판 없음' };
  const qb = ensureQuestBoard(schema, state);
  const o = qb.offers.find((x) => x.id === offerId);
  if (!o) return { ok: false, reason: '이미 내려간 의뢰예요' };
  const def = (schema.vars || []).find((v) => v.id === cfg.listVar);
  const list = Array.isArray(state.vars[cfg.listVar]) ? [...state.vars[cfg.listVar]] : [];
  const maxItems = def?.maxItems ?? 20;
  if (list.length >= maxItems) return { ok: false, reason: `수첩이 가득 찼어요 (${maxItems}건)` };
  let entry = formatEntry(cfg, o);
  // "@+N"은 저장 전에 절대 경과값으로 굳힌다 — 보조 델타는 엔진(resolveRelativeExpiry)이 굳히지만 패널 삽입은
  // 그 길을 안 지난다. 안 굳히면 (N일)이 영영 안 줄고 expire도 안 걸린다 (엔진과 같은 규약: 목록의 expire 식이 "지금")
  entry = freezeRelative(schema, state, cfg.listVar, entry, makeLookup);
  if (def?.itemMaxLength) entry = entry.slice(0, def.itemMaxLength);
  if (!entry) return { ok: false, reason: '항목 형식이 비었어요' };
  if (list.includes(entry)) return { ok: false, reason: '이미 받은 의뢰예요' };
  list.push(entry);
  state.vars[cfg.listVar] = list;
  qb.offers = qb.offers.filter((x) => x.id !== offerId);
  const changes = { [cfg.listVar]: list, ...applyEffects(schema, state, cfg.accept, o, makeLookup) };
  const line = `「${o.client} · ${o.title}」 의뢰 수락 (보수 ${payText(cfg, o.pay)}${o.days ? ` · 기한 ${o.days}일` : ''}${o.grade ? ` · ${o.grade}` : ''}).`;
  logTx(cfg, state, line, `${o.note ? `의뢰 내용: ${o.note} ` : ''}이번 서사에 자연스럽게 반영하라 — 의뢰인·수첩 기록은 이미 끝났으니 다시 적지 마라.`);
  return { ok: true, line, entry, changes };
}

/** 취소(포기) — 목록 변수에서 저장 원문 그대로 뺀다. 효과(cancel)는 시스템이 */
function cancel(schema, state, itemText, makeLookup) {
  const cfg = questConfig(schema);
  if (!cfg) return { ok: false, reason: '의뢰판 없음' };
  ensureQuestBoard(schema, state);
  const list = Array.isArray(state.vars[cfg.listVar]) ? [...state.vars[cfg.listVar]] : [];
  const idx = list.indexOf(itemText);
  if (idx < 0) return { ok: false, reason: '수첩에 없는 의뢰예요' };
  list.splice(idx, 1);
  state.vars[cfg.listVar] = list;
  // 항목에서 보수·기한을 되읽는다 (형식 역파싱은 안 한다 — 끝수 보수·@기한만 규약). 기한은 남은 일수로
  const pay = Number((String(itemText).match(/\+(\d+)\s*$/) || [])[1]) || 0;
  const dueM = String(itemText).match(/@(\+?-?\d+(?:\.\d+)?)/);
  let days = 0;
  if (dueM) {
    if (dueM[1].startsWith('+')) days = Math.max(0, Math.round(parseFloat(dueM[1].slice(1))));
    else { const now = listNow(schema, state, cfg.listVar, makeLookup); days = now == null ? 0 : Math.max(0, Math.round(parseFloat(dueM[1]) - now)); }
  }
  const changes = { [cfg.listVar]: list, ...applyEffects(schema, state, cfg.cancel, { pay, days, grade: '' }, makeLookup) };
  const line = `「${cut(itemText.replace(/\s*@\+?\d+.*$/, ''), 40)}」 의뢰 취소.`;
  logTx(cfg, state, line, '의뢰인에게 알린 것으로 친다 — 이번 서사에 반응(실망·이해·다음 기회)을 자연스럽게 담아라.');
  return { ok: true, line, changes };
}

const bandsText = (cfg) => cfg.bands
  ? Object.entries(cfg.bands).map(([g, b]) => `${g} ${b[0]}~${b[1]}`).join(' / ') : null;

/** 게시 지시 본문 — 턴 피기백(첫 게시·보충)과 수동 새로고침이 같은 규격을 쓴다 */
function offerSpecBody(cfg, n) {
  return [
    `- "quests" 필드로 새 의뢰 게시("new") ${n[0]}~${n[1]}개를 내라. 각각 의뢰인(client)·제목(title)·보수(pay, 숫자 하나)·기한(days, ${cfg.days[0]}~${cfg.days[1]}일)·한 줄 내용(note).`,
    cfg.grades ? `- 등급(grade)은 다음 중에서만: ${cfg.grades.join(' | ')}. 그 밖의 등급은 시스템이 거부한다.` : null,
    bandsText(cfg) ? `- 보수 밴드 (시스템이 강제한다): ${bandsText(cfg)}${cfg.unit ? ` (${cfg.unit})` : ''}.` : null,
    cfg.guide ? `- ${cfg.guide}` : null,
    '- 서사에 이미 나온 의뢰인·사건을 살려도 좋지만 대부분은 세계의 평범한 부탁이다. 주인공이 이미 받은 의뢰는 다시 내지 마라.',
    '- quests 형식: {"new":[{"client":"의뢰인","title":"제목","grade":"등급","pay":숫자,"days":숫자,"note":"한 줄"}]}',
  ].filter((x) => x !== null);
}

/** 턴 피기백 — 첫 게시는 즉시, 그 뒤엔 게시가 minOffers 아래이고 refillEvery턴이 지났을 때만 */
function auxSpec(schema, state, makeLookup) {
  const cfg = questConfig(schema);
  if (!cfg) return '';
  const qb = state.questBoard;   // 읽기 전용 (초기화는 엔진 몫)
  if (!questOpen(cfg, schema, state.vars, makeLookup)) return '';
  const turn = Number(state?.meta?.turn) || 0;
  const live = qb?.offers?.length ?? 0;
  if (qb?.stocked) {
    if (live >= cfg.minOffers) return '';
    if (turn - (qb.lastFill ?? -1) < cfg.refillEvery) return '';
  }
  const want = qb?.stocked ? [1, Math.max(1, cfg.maxOffers - live)] : [Math.min(3, cfg.maxOffers), cfg.maxOffers];
  const head = qb?.stocked ? '보충 게시' : '첫 게시';
  return ['', `[${cfg.label} — 의뢰판 ${head}] (필수 항목)`, ...offerSpecBody(cfg, want)].join('\n');
}

/**
 * 메인 프롬프트 한 덩이 (v1.7.12) — 지금 붙어 있는 게시를 **원문 그대로** 싣는다.
 * 게시판(board)은 "화제 한 줄"만 주고 원문을 감추지만(토큰 절약이 존재 이유), 의뢰판은 반대다 — 게시가
 * maxOffers(≤12)로 유한하고, 메인이 목록을 모르면 벽보 장면마다 여기 없는 의뢰를 지어 붙인다
 * (아틀리에 실기: 패널엔 5건이 붙어 있는데 서사는 "하수구 쥐 퇴치 80콜" 같은 제 의뢰를 읊었다).
 * 수락은 여전히 버튼이라, 모델에게는 "고르되 받았다고 쓰지 마라"까지 같이 말한다.
 * when이 닫혀 있으면(의뢰판이 없는 장소) 안 싣는다 — 버튼과 같은 게이트.
 */
function mainLine(schema, state, makeLookup) {
  const cfg = questConfig(schema);
  if (!cfg || !cfg.mainInject) return null;
  if (typeof makeLookup === 'function' && !questOpen(cfg, schema, state?.vars || {}, makeLookup)) return null;
  const offers = state?.questBoard?.offers || [];
  if (!offers.length) return null;
  const now = nowOf(schema, state, makeLookup);
  const items = offers.map((o) => {
    const bits = [o.grade, `보수 ${payText(cfg, o.pay)}`, o.days ? `기한 ${o.days}일` : null].filter(Boolean).join(' · ');
    const left = offerLeft(o, now);
    return `- 「${o.client} · ${o.title}」(${bits}${left ? ` · 게시 ${left} 남음` : ''})${o.note ? ` — ${o.note}` : ''}`;
  });
  return [
    `[${cfg.label}] 지금 붙어 있는 의뢰 ${offers.length}건:`,
    ...items,
    '서사에 의뢰판·벽보가 나오면 이 목록에서만 고른다 — 여기 없는 의뢰를 지어 붙이지 마라. 수락은 유저가 버튼으로 하니 주인공이 받았다고 쓰지 말고, 눈에 띈 것 한둘을 비추는 데서 멈춰라.',
  ].join('\n');
}

/** 패널 [새로고침] 전용 프롬프트 — 채팅 없이 보조만 (통째 교체) */
function interactionPrompt(schema, state, kind, payload = {}) {
  const cfg = questConfig(schema);
  if (!cfg) return null;
  const qb = ensureQuestBoard(schema, state);
  return [
    `너는 "${cfg.label}" — 이 세계의 의뢰판이다. 게시를 새로 짜라 (전부 교체 — 일부는 남겨도 된다).`,
    '[지금 게시]',
    qb.offers.length ? qb.offers.map((o) => `- ${o.client} · ${o.title}${o.grade ? ` (${o.grade})` : ''} ${o.pay}${cfg.unit} · ${o.days}일`).join('\n') : '(비어 있음)',
    payload.narrative ? '[이야기 맥락]' : null,
    payload.narrative ? String(payload.narrative).slice(0, 1600) : null,
    '',
    ...offerSpecBody(cfg, [Math.min(3, cfg.maxOffers), cfg.maxOffers]),
    '',
    '출력 형식 (JSON만, 다른 텍스트 금지): {"quests":{"new":[...]}}',
  ].filter((x) => x !== null).join('\n');
}

function parseInteraction(text, extractJsonObject) {
  const obj = extractJsonObject(text, 'quests');
  return obj?.quests ?? null;
}

module.exports = {
  CAPS, DEFAULT_FORMAT, questConfig, initQuestBoard, ensureQuestBoard, questOpen, nowOf, clampPay,
  sanitizeOffers, applyOffers, pruneExpired, offerLeft, formatEntry, accept, cancel,
  auxSpec, mainLine, interactionPrompt, parseInteraction,
};
