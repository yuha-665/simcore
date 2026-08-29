const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.96 — 상점: 세계 안의 시스템 상점 (얼터헌터 알터 스토어 흡수).
//
// 불변식:
//   · 뇌절 방지 — 등급 어휘 밖 진열 거부, 가격은 밴드로 클램프 (숫자는 시스템이)
//   · 구매·시세판 판매는 보조 호출 0 — 결제·잔액·수량 병합 전부 결정적
//   · 거래 내역은 pendingNotifies로 다음 전송 1회 실리고 자동 소거 (영구 누적 없음)
//   · 첫 입고만 턴 피기백 — 재고가 차면 매턴 비용 0, 물갈이는 패널 버튼
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const shop = SC.require('shop');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

const S = {
  simcore: '0.1', meta: { name: '상점봇' },
  vars: [
    { id: 'coin', label: '코인', type: 'int', init: 100, min: 0, format: '{v}C' },
    { id: 'won', label: '현금', type: 'int', init: 100000, min: 0 },
    { id: 'items', label: '소지품', type: 'list', init: ['고블린 마정석 3'], maxItems: 4 },
    { id: 'store_on', label: '스토어', type: 'bool', init: true },
  ],
  derived: [],
  updater: { allow: [{ id: 'coin', maxDelta: 50 }] },
  shop: {
    label: '알터 스토어', icon: '🛒', currency: 'coin', buyTo: 'items', sellFrom: 'items',
    categories: ['추천', '소모품', '장비'], grades: ['일반', '레어', '유니크'],
    bands: { '일반': [1, 60], '레어': [60, 400], '유니크': [400, 3000] },
    sellRate: 0.5, maxStock: 8, when: 'store_on',
    guide: 'E랭크 처치 1~5코인 기준의 상대 가격.',
    exchange: { var: 'won', rate: 1000, spread: 0.2, label: '암거래 환전' },
  },
};

// ── 검증 ──
{
  const v = validateSchema(S);
  ck('★ 정상 스키마 통과', v.ok, J(v.errors));
  const bad = JSON.parse(J(S)); bad.shop.currency = 'ghost';
  ck('없는 지갑 변수 오류', !validateSchema(bad).ok, '');
  const bad2 = JSON.parse(J(S)); bad2.shop.buyTo = 'coin';
  ck('buyTo가 list 아니면 오류', !validateSchema(bad2).ok, '');
  const bad3 = JSON.parse(J(S)); bad3.shop.bands['일반'] = [60, 1];
  ck('밴드 역전 오류', !validateSchema(bad3).ok, '');
  const warn = JSON.parse(J(S)); delete warn.shop.bands; delete warn.shop.grades;
  const vw = validateSchema(warn);
  ck('밴드 없으면 뇌절 경고', vw.ok && vw.warnings.some((w) => w.msg.includes('뇌절')), J(vw.warnings));
}

const fresh = () => { const t = engine.initState(S); t.meta.setupDone = true; return t; };

// ── 입고 정제 — 뇌절 방지의 실무 지점 ──
{
  const cfg = shop.shopConfig(S);
  const raw = { stock: [
    { cat: '소모품', name: '하급 회복 포션', grade: '일반', price: 12 },
    { cat: '장비', name: 'S급 스킬북', grade: '레전더리', price: 999999 },   // 등급 어휘 밖 → 거부
    { cat: '장비', name: '강화 전술복', grade: '레어', price: 999999 },      // 밴드 클램프 → 400
    { cat: '없는칸', name: '수상한 두루마리', grade: '일반', price: 0 },     // 카테고리 보정
    { cat: '추천', name: '한정 엘릭서', grade: '유니크', price: 500, qty: 2 },
  ], buying: [{ name: '고블린 마정석', price: 5 }, { name: '이름만', price: -3 }] };
  const clean = shop.sanitizeStock(cfg, raw);
  ck('★ 등급 어휘 밖(레전더리) 거부', !clean.stock.some((x) => x.name === 'S급 스킬북')
    && clean.rejected.some((x) => x.includes('S급 스킬북')), J(clean.rejected));
  ck('★ 가격 밴드 클램프 (999999 → 400)', clean.stock.find((x) => x.name === '강화 전술복').price === 400, '');
  ck('없는 카테고리 → 첫 칸 보정', clean.stock.find((x) => x.name === '수상한 두루마리').cat === '추천', '');
  ck('한정 수량 유지', clean.stock.find((x) => x.name === '한정 엘릭서').qty === 2, '');
  ck('시세판 — 음수 가격 탈락', clean.buying.length === 1 && clean.buying[0].name === '고블린 마정석', J(clean.buying));
}

// ── 첫 입고 피기백 — 빈 동안만 ──
{
  const t = fresh();
  const aux1 = engine.buildAuxPrompt(S, t, '서사', null);
  ck('★ 빈 재고 — 입고 요청 실림', aux1.includes('첫 입고') && aux1.includes('"shop"'), '');
  shop.applyStock(S, t, { stock: [{ cat: '추천', name: '포션', grade: '일반', price: 10 }] });
  const aux2 = engine.buildAuxPrompt(S, t, '서사', null);
  ck('★ 입고 후 — 요청 안 실림 (매턴 비용 0)', !aux2.includes('첫 입고'), '');
  t.vars.store_on = false;
  const t2 = fresh(); t2.vars.store_on = false;
  ck('when 닫힘 — 입고 요청 없음', !engine.buildAuxPrompt(S, t2, '서사', null).includes('첫 입고'), '');
}

// ── 구매 — 결정적 정산 ──
{
  const t = fresh();
  shop.applyStock(S, t, { stock: [
    { cat: '소모품', name: '하급 회복 포션', grade: '일반', price: 12 },
    { cat: '장비', name: '강철 단검', grade: '레어', price: 90 },
    { cat: '추천', name: '한정 부적', grade: '일반', price: 10, qty: 1 },
  ] });
  const potion = t.shop.stock.find((x) => x.name === '하급 회복 포션');
  let r = shop.buy(S, t, potion.id);
  ck('★ 구매 성공 — 지갑 차감 + 목록 합류', r.ok && t.vars.coin === 88
    && t.vars.items.includes('하급 회복 포션 (일반)'), J({ coin: t.vars.coin, items: t.vars.items }));
  r = shop.buy(S, t, potion.id);
  ck('★ 같은 것 재구매 — 끝수 병합 "… 2"', r.ok && t.vars.items.includes('하급 회복 포션 (일반) 2'), J(t.vars.items));
  const dagger = t.shop.stock.find((x) => x.name === '강철 단검');
  r = shop.buy(S, t, dagger.id);
  ck('잔액 부족 거부 (76 < 90)', !r.ok && r.reason.includes('잔액'), J(r));
  const charm = t.shop.stock.find((x) => x.name === '한정 부적');
  r = shop.buy(S, t, charm.id);
  ck('★ 한정 1개 — 구매 후 진열에서 소멸', r.ok && !t.shop.stock.some((x) => x.name === '한정 부적'), '');
  // 내역 — 통지·원장·로그
  ck('★ 거래 통지 대기 (다음 전송에 실림)', t.meta.pendingNotifies.length === 3
    && t.meta.pendingNotifies[0].includes('구매'), J(t.meta.pendingNotifies));
  ck('원장(lastChanges)에 기록 — 보조 이중 계산 방지', t.meta.lastChanges.some((l) => l.includes('구매')), '');
  ck('패널 로그 회전 (최근 6)', t.shop.log.length === 3, '');
  // 다음 전송에 실리고 비워진다
  const send = engine.sendPhase(S, t, { rng: seededRng('s', 1, 's') });
  ck('★ 전송 프롬프트에 [이벤트]로 합류', send.promptBlock.includes('알터 스토어') && send.promptBlock.includes('구매'), '');
  ck('★ 실린 뒤 자동 소거 (영구 누적 없음)', send.state.meta.pendingNotifies.length === 0, '');
}

// ── 소지품 상한 ──
{
  const t = fresh();
  t.vars.items = ['a', 'b', 'c', 'd']; // maxItems 4 가득
  shop.applyStock(S, t, { stock: [{ cat: '추천', name: '새 물건', grade: '일반', price: 1 }] });
  const r = shop.buy(S, t, t.shop.stock[0].id);
  ck('가방 가득 — 구매 거부 + 지갑 무변', !r.ok && t.vars.coin === 100, J(r));
}

// ── 판매 — 시세판 즉시 / 감정 경유 ──
{
  const t = fresh();
  shop.applyStock(S, t, { stock: [{ cat: '추천', name: '포션', grade: '일반', price: 10 }],
    buying: [{ name: '고블린 마정석', price: 5 }] });
  let r = shop.sell(S, t, '고블린 마정석 3');
  ck('★ 시세판 매치 — 즉시 판매 + 끝수 차감', r.ok && r.payout === 5 && t.vars.coin === 105
    && t.vars.items.includes('고블린 마정석 2'), J({ coin: t.vars.coin, items: t.vars.items }));
  t.vars.items.push('정체불명 반지');
  r = shop.sell(S, t, '정체불명 반지');
  ck('★ 시세판 밖 — 감정 필요 신호', !r.ok && r.needAppraisal === true, J(r));
  r = shop.sell(S, t, '정체불명 반지', 200);   // 감정가 200 → rate 0.5 → 100
  ck('★ 감정가 × 매입률 지급 + 항목 제거', r.ok && r.payout === 100 && t.vars.coin === 205
    && !t.vars.items.includes('정체불명 반지'), J({ coin: t.vars.coin }));
  r = shop.sell(S, t, '없는 물건');
  ck('없는 물건 거부', !r.ok && !r.needAppraisal, J(r));
}

// ── 환전 (v0.97) — 통화 ↔ 상대 지갑, 계산 전부 엔진 ──
{
  const cfg = shop.shopConfig(S);
  const rates = shop.exchangeRates(cfg);
  ck('★ 환율 — 수수료 반영 (1000, s0.2 → 사기 1200 / 팔기 800)', rates.buy === 1200 && rates.sell === 800, J(rates));
  const badX = JSON.parse(J(S)); badX.shop.exchange.var = 'ghost';
  ck('없는 상대 지갑 오류', !validateSchema(badX).ok, '');
  const badX2 = JSON.parse(J(S)); badX2.shop.exchange.var = 'coin';
  ck('상대 지갑 = 상점 통화 오류', !validateSchema(badX2).ok, '');

  const t = fresh();
  let r = shop.exchange(S, t, 50, 'buy');
  ck('★ 코인 사기 — 코인 +50, 현금 -60000', r.ok && t.vars.coin === 150 && t.vars.won === 40000,
    J({ coin: t.vars.coin, won: t.vars.won }));
  ck('★ 통지 접두 = 창구 이름 (상점 본체와 분리)', t.meta.pendingNotifies[0].includes('[암거래 환전]'),
    J(t.meta.pendingNotifies));
  r = shop.exchange(S, t, 100, 'buy');
  ck('현금 부족 거부 (40000 < 120000)', !r.ok && r.reason.includes('부족') && t.vars.coin === 150, J(r));
  r = shop.exchange(S, t, 100, 'sell');
  ck('★ 코인 팔기 — 코인 -100, 현금 +80000', r.ok && t.vars.coin === 50 && t.vars.won === 120000,
    J({ coin: t.vars.coin, won: t.vars.won }));
  r = shop.exchange(S, t, 999, 'sell');
  ck('보유 초과 판매 거부', !r.ok && t.vars.coin === 50, J(r));
  ck('수량 0·문자 거부', !shop.exchange(S, t, 0, 'buy').ok && !shop.exchange(S, t, 'x', 'buy').ok, '');
  const send = engine.sendPhase(S, t, { rng: seededRng('x', 1, 's') });
  ck('★ 환전 통지도 다음 전송 1회 후 소거', send.promptBlock.includes('암거래 환전')
    && send.state.meta.pendingNotifies.length === 0, '');
  const noX = JSON.parse(J(S)); delete noX.shop.exchange;
  ck('환전 미설정 — 창구 없음 거부', !shop.exchange(noX, fresh(), 10, 'buy').ok, '');
}

// ── 인터랙션 프롬프트·파싱 ──
{
  const t = fresh();
  const rp = shop.interactionPrompt(S, t, 'restock', { narrative: '맥락' });
  ck('물갈이 프롬프트 — 밴드·카테고리·형식', rp.includes('일반 1~60') && rp.includes('추천 | 소모품 | 장비')
    && rp.includes('{"shop"'), '');
  const ap = shop.interactionPrompt(S, t, 'appraise', { item: '정체불명 반지' });
  ck('감정 프롬프트 — 대상·형식', ap.includes('정체불명 반지') && ap.includes('appraisal'), '');
  const parsed = shop.parseInteraction('잡담 {"shop":{"appraisal":150}} 끝', engine.extractJsonObject);
  ck('감정 응답 관대 파싱', parsed && parsed.appraisal === 150, J(parsed));
}

// ── 통합 — outputPhase 경유 첫 입고 + 파서 통과 ──
{
  let t = fresh();
  const send = engine.sendPhase(S, t, { rng: seededRng('s', 10, 's') });
  const parsed = engine.parseAuxResponse('{"changes":{},"reasons":{},"shop":{"stock":[{"cat":"추천","name":"마나 물약","grade":"일반","price":8}]}}');
  ck('파서 — shop 필드 통과', parsed.shop != null, '');
  t = engine.outputPhase(S, send.state, parsed.changes, parsed.reasons,
    { rng: seededRng('s', 10, 'o'), shop: parsed.shop }).state;
  ck('★ outputPhase 경유 입고', t.shop.stock.length === 1 && t.shop.stock[0].name === '마나 물약'
    && t.shop.stocked === true, J(t.shop.stock));
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
