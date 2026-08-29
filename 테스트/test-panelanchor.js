const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.0.4 — 패널 쓰기 저장 앵커. 로드 직후(턴 0회) 세션에서 패널·명령이 만든 변화가
// out 스냅샷에 실제로 저장되는지 실측한다. 예전엔 lastOutIndex가 -1이라 조용히 생략됐고,
// 리로드(신안 재적용 등)가 램만의 변화를 지웠다 (실사고 2026-08-30: "내 글만 사라짐").
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 소스 정적 확인 ──
{
  ck('★ 로드 시 복원 앵커 승계', src.includes('lastOutIndex = lastCharIdx;'), '');
  ck('앵커 사유 주석 (증발 사고)', src.includes('패널 쓰기의 저장 앵커 (v1.0.4)'), '');
}

const SCHEMA = {
  simcore: '0.1', meta: { name: '앵커 테스트' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100, cmd: '체력' }],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
};
const mkState = (hp, turn) => JSON.stringify({
  vars: { hp },
  meta: { turn, setupDone: true, armed: {}, actionLastUsed: {}, eventLastFired: {}, firedOnce: {}, pendingNotifies: [] },
});

async function boot(preload) {
  const world = {
    chars: [{ chaId: 'c-sim', name: '앵커 봇', triggerscript: [],
      globalLore: [{ comment: src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)[1], content: JSON.stringify(SCHEMA) }] }],
    chats: { 'c-sim:0': { id: 'ch1', message: [
      { role: 'char', data: '첫 장면 ⟦simcore:0⟧' },
      { role: 'user', data: '진행' },
      { role: 'char', data: '두 번째 장면 ⟦simcore:2⟧' },
    ] } },
  };
  const store = new Map(Object.entries(preload ?? {}));
  global.Risuai = {
    getCharacter: async () => world.chars[0],
    setCharacter: async (c) => { world.chars[0] = c; },
    getCurrentCharacterIndex: async () => 0,
    getCurrentChatIndex: async () => 0,
    getChatFromIndex: async () => world.chats['c-sim:0'],
    setChatToIndex: async (_a, _b, c) => { world.chats['c-sim:0'] = c; },
    registerButton: async () => {}, unregisterUIPart: async () => {}, registerSetting: async () => {},
    addRisuReplacer: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    addRisuScriptHandler: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    registerBodyIntercepter: async () => ({ id: 'x' }),
    showContainer: async () => {}, alert: async () => {},
    getArgument: async () => 'off',
    onUnload: async (fn) => { global.__unload = fn; },
    runLLMModel: async () => ({ success: false }),
    pluginStorage: {
      getItem: async (k) => (store.has(k) ? store.get(k) : null),
      setItem: async (k, v) => { store.set(k, v); },
      removeItem: async (k) => { store.delete(k); },
      keys: async () => [...store.keys()],
    },
  };
  const el = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    children: [], appendChild() {}, append() {}, remove() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : undefined), set: () => true });
  global.document = { createElement: el, getElementById: () => null, body: el(),
    querySelector: () => null, querySelectorAll: () => [], head: el(), addEventListener() {} };
  global.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  (0, eval)(src);
  await sleep(150);
  return { world, store };
}

(async () => {
  // 로드 전용 세션: out:2 (hp 30)에서 복원, 턴은 한 번도 안 돈다
  const { store } = await boot({ 'sim:c-sim:ch1:out:0': mkState(90, 1), 'sim:c-sim:ch1:out:2': mkState(30, 2) });
  const hooks = global.__hooks ?? {};
  ck('input 훅 등록', typeof hooks.input === 'function', Object.keys(hooks).join(','));

  // 턴 없이 채팅 명령으로 상태를 만진다 — 패널 쓰기(보드·상점·수동 설정)와 같은 저장 경로
  await hooks.input('/체력 +10');
  const saved = JSON.parse(store.get('sim:c-sim:ch1:out:2') ?? 'null');
  ck('★ 턴 0회 세션의 변경이 복원 앵커(out:2)에 저장된다', saved?.vars?.hp === 40,
    JSON.stringify(saved?.vars));
  ck('다른 스냅샷(out:0)은 안 건드린다', JSON.parse(store.get('sim:c-sim:ch1:out:0')).vars.hp === 90, '');

  // 리로드 생존 실측 — 세션을 강제로 다시 잡아도 변경이 살아 있어야 한다 (증발 사고의 재현 조건)
  try { await global.__unload?.(); } catch { /* 무관 */ }
  delete global.__hooks;
  await boot(Object.fromEntries(store));   // 같은 스토어로 재부팅 = 신안 재적용/재부팅 리로드
  await sleep(100);
  const disp = global.__hooks?.display;
  const now = String(disp?.('두 번째 장면 ⟦simcore:2⟧') ?? '');
  // CSS 안의 숫자에 안 걸리게 라벨 기준으로 값을 읽는다
  const hpShown = now.match(/체력[^0-9]*([0-9]+)/)?.[1];
  ck('★ 리로드 후에도 변경 생존 (hp 40)', hpShown === '40', `표시값 ${hpShown}`);

  try { await global.__unload?.(); } catch { /* 무관 */ }
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
