const __P = (...p) => require('path').resolve(__dirname, ...p);
// 실제 실패 재현: RPG 템플릿이 설치된 상태에서 영지 세이브를 가져오면
// "알 수 없는 변수 'inventory'"로 터지던 문제 (v0.16에서 reconcileState로 수정)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { MapBackend } = SimCore.require('store');
const sessionMod = (() => { for (const n of ['session', 'simsession', 'plugin']) { try { const m = SimCore.require(n); if (m.SimSession) return m; } catch {} } return null; })();
const SimSession = sessionMod && sessionMod.SimSession;
if (!SimSession) { console.log('SKIP'); process.exit(0); }

// 실제 유저 세이브 (리포에 커밋된 영지 세이브 — 재현 조건인 var11 보유·inventory 부재 동일)
const save = JSON.parse(fs.readFileSync(__P('../베리디아/simcore-save-영지.json'), 'utf8'));

// 가져오기 시점에 설치돼 있던 RPG 계열 스키마 (inventory 참조가 핵심)
const RPG = {
  simcore: '0.1', meta: { name: 'RPG 모험 기록' },
  vars: [
    { id: 'hp', type: 'int', init: 100 },
    { id: 'gold', type: 'int', init: 50 },
    { id: 'inventory', type: 'list', init: ['회복약'] },
  ],
  derived: [{ id: 'itemCount', expr: 'count(inventory)' }],
  rules: { onTurn: [], events: [{ id: 'broke', when: 'gold < 1', effects: [], notify: '빈털터리다' }] },
  actions: [
    { id: 'usePotion', label: '회복약 사용', when: 'has(inventory, "회복약")', effects: [] },
    { id: 'rest', label: '휴식', effects: [] },
  ],
  statusUI: { mode: 'auto', groups: [] },
};

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

(async () => {
  ck('세이브에 inventory 없음 (재현 조건)', !('inventory' in save.current.vars));
  ck('세이브에 영지 변수 있음 (재현 조건)', 'var11' in save.current.vars);

  const be = new MapBackend();
  const s = new SimSession(RPG, be, { chatId: 'different-chat', prefix: 'sim:x:new' });
  await s.init(-1);

  // ── 가져오기 (스키마는 RPG 그대로 = 유저가 '취소'를 골랐거나 확인창이 안 뜬 경우) ──
  let err = null, res = null;
  try { res = await s.importData(save, 3); } catch (e) { err = e; }
  ck('가져오기가 예외를 던지지 않음', !err, err && err.message);
  ck('가져오기 성공', res && res.ok, JSON.stringify(res));

  // ── 예전에 터지던 지점들이 이제 견디는가 ──
  ck('없던 변수는 스키마 기본값으로 채워짐', JSON.stringify(s.current.vars.inventory) === JSON.stringify(['회복약']), JSON.stringify(s.current.vars.inventory));
  ck('세이브의 값은 보존됨', s.current.vars.var11 !== undefined, JSON.stringify(s.current.vars.var11));
  ck('스키마에 없는 변수도 버리지 않음 (비파괴)', 'var20' in s.current.vars);

  let e2 = null;
  try { for (const a of RPG.actions) engine.actionAvailability(RPG, s.current, a); } catch (e) { e2 = e; }
  ck('액션 조건식 평가 정상', !e2, e2 && e2.message);

  let e3 = null;
  try { engine.makeLookup(RPG, s.current.vars)('itemCount'); } catch (e) { e3 = e; }
  ck('derived 평가 정상', !e3, e3 && e3.message);

  let e4 = null, out = null;
  try { out = engine.outputPhase(RPG, s.current, {}, {}, { rng: () => 0.5 }); } catch (e) { e4 = e; }
  ck('턴 진행(outputPhase) 정상', !e4, e4 && e4.message);
  ck('이벤트 규칙 평가 정상', !e4 && !!out);

  // ── 스키마까지 복원하는 정상 경로 ──
  const be2 = new MapBackend();
  const s2 = new SimSession(save.schema, be2, { chatId: 'different-chat', prefix: 'sim:x:ok' });
  await s2.init(-1);
  const r2 = await s2.importData(save, 3);
  ck('스키마 복원 경로도 정상', r2.ok);
  ck('영지 값 그대로', s2.current.vars.var11 !== undefined && s2.current.meta.turn === save.current.meta.turn,
    `turn=${s2.current.meta.turn}`);

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
