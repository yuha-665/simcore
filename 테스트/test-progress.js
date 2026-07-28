const __P = (...p) => require('path').resolve(__dirname, ...p);
// 병렬화 속도 + 진행 보고 정확도 검증
// 리스 샌드박스 브리지처럼 호출당 지연이 있는 백엔드를 흉내낸다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const bundleStart = src.indexOf('const SimCore = (() => {');
const bundleEnd = src.indexOf('(async () => {');
(0, eval)(src.slice(bundleStart, bundleEnd) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const store = SimCore.require('store');
const sessionMod = (() => {
  for (const n of ['session', 'simsession', 'plugin']) {
    try { const m = SimCore.require(n); if (m.SimSession) return m; } catch {}
  }
  return null;
})();
const SimSession = sessionMod && sessionMod.SimSession;
if (!SimSession) { console.log('SKIP: SimSession 로드 실패'); process.exit(0); }

const RTT = 6; // 브리지 왕복 지연(ms) 가정
class SlowBackend {
  constructor() { this.m = new Map(); this.calls = 0; }
  async _lag() { this.calls++; return new Promise((r) => setTimeout(r, RTT)); }
  async get(k) { await this._lag(); return this.m.has(k) ? this.m.get(k) : null; }
  async set(k, v) { await this._lag(); this.m.set(k, v); }
  async remove(k) { await this._lag(); this.m.delete(k); }
  async keys() { await this._lag(); return [...this.m.keys()]; }
}

const SCHEMA = { simcore: '0.1', meta: { name: 'T' }, vars: [{ id: 'hp', type: 'int', init: 100 }], statusUI: { mode: 'auto', groups: [] } };
const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

(async () => {
  // 스냅샷 150개 준비
  const be = new SlowBackend();
  const s = new SimSession(SCHEMA, be, { chatId: 'c1', prefix: 'sim:x:c1' });
  await s.init(-1);
  for (let i = 0; i < 150; i++) be.m.set(`sim:x:c1:out:${i}`, JSON.stringify({ vars: { hp: i }, meta: { turn: i } }));
  be.m.set('other-plugin:junk', 'x'); // 남의 키는 건드리면 안 됨

  // ── 내보내기: 진행 보고 + 소요 시간 ──
  const ticks = [];
  const t0 = Date.now();
  const data = await s.exportData(149, (d, t, p) => ticks.push([d, t, p]));
  const elapsed = Date.now() - t0;

  ck('스냅샷 150개 전부 수집', Object.keys(data.snapshots).length === 150, Object.keys(data.snapshots).length);
  ck('남의 플러그인 키는 제외', !Object.keys(data.snapshots).some((k) => k.includes('junk')));
  ck('진행 보고가 발생함', ticks.length > 1, `ticks=${ticks.length}`);
  ck('진행 보고 total이 정확', ticks.some(([, t]) => t === 150), JSON.stringify(ticks.slice(-1)));
  ck('마지막 보고가 100%', (() => { const l = ticks[ticks.length - 1]; return l[0] === l[1]; })(), JSON.stringify(ticks[ticks.length - 1]));
  ck('진행값이 단조 증가', (() => {
    const seq = ticks.filter(([, t]) => t === 150).map(([d]) => d);
    return seq.every((v, i) => i === 0 || v >= seq[i - 1]);
  })());

  const seqEstimate = 151 * RTT; // 순차로 돌렸을 때의 하한
  ck(`병렬화로 순차 대비 빨라짐 (실측 ${elapsed}ms vs 순차 최소 ${seqEstimate}ms)`, elapsed < seqEstimate * 0.5, `${elapsed}ms`);

  // ── 가져오기(같은 채팅): 진행 보고 ──
  const be2 = new SlowBackend();
  const s2 = new SimSession(SCHEMA, be2, { chatId: 'c1', prefix: 'sim:x:c1' });
  await s2.init(-1);
  const ticks2 = [];
  const t1 = Date.now();
  const r2 = await s2.importData(data, 149, (d, t, p) => ticks2.push([d, t, p]));
  const el2 = Date.now() - t1;
  ck('같은 채팅 가져오기 성공', r2.ok && r2.sameChat);
  ck('가져오기도 진행 보고', ticks2.some(([, t]) => t === 150), `ticks=${ticks2.length}`);
  ck(`가져오기도 병렬 (실측 ${el2}ms vs 순차 최소 ${150 * RTT}ms)`, el2 < 150 * RTT * 0.5, `${el2}ms`);
  ck('스냅샷 실제 기록됨', be2.m.size === 150, be2.m.size);

  // ── 다른 채팅 이식: 정리 진행 보고 ──
  const ticks3 = [];
  const r3 = await s2.importData({ ...data, chatId: 'other' }, 5, (d, t, p) => ticks3.push([d, t, p]));
  ck('다른 채팅 이식 성공', r3.ok && r3.sameChat === false);
  ck('정리 국면 보고됨', ticks3.some(([, , p]) => /정리/.test(p)), JSON.stringify(ticks3.slice(0, 2)));
  ck('앵커만 남음', be2.m.size === 1 && be2.m.has('sim:x:c1:out:5'), [...be2.m.keys()].join(','));

  // ── 완전 초기화 ──
  const be3 = new SlowBackend();
  const s3 = new SimSession(SCHEMA, be3, { chatId: 'c1', prefix: 'sim:x:c1' });
  await s3.init(-1);
  for (let i = 0; i < 40; i++) be3.m.set(`sim:x:c1:out:${i}`, '{}');
  be3.m.set('keep-me', 'x');
  const ticks4 = [];
  await s3.resetAll((d, t, p) => ticks4.push([d, t, p]));
  ck('초기화 진행 보고', ticks4.some(([, t]) => t === 40), `ticks=${ticks4.length}`);
  ck('초기화 후 남의 키 보존', be3.m.size === 1 && be3.m.has('keep-me'), [...be3.m.keys()].join(','));

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
