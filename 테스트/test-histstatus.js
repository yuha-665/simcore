const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.0 #1 — 과거 메시지 상태창: 과거 마커는 그 시점(out:N) 스냅샷으로 그린다.
// v0.11부터 주석 예고만 있던 기능. display 핸들러가 동기라 램 캐시(histStates)로 푼다:
//   · out 저장 가로채기(store.save 랩) + 로드 시 배경 프리페치
//   · 캐시에 없으면 현재 상태 폴백 (keepN 밖 옛 메시지)
//   · 과거 렌더는 하이라이트·액션 범례·갈림길 없이 (현재 세션 조작 오독 방지)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 소스 정적 확인 (배선이 실제로 들어갔는가) ──
{
  ck('캐시·프리페치·저장 랩 존재', src.includes('histPut') && src.includes('histPrefetch')
    && src.includes("if (phase === 'out') histPut(index, state);"), '');
  ck('★ display가 과거 마커를 캐시로 그린다', src.includes('histStates.get(idx)'), '');
  ck('과거 렌더는 하이라이트·범례 없이', src.includes('renderStatusHtml(schema, cached, null, null'), '');
  ck('갈림길·제안 유령 제거', src.includes('s.meta.pendingChoice = null;'), '');
}

// ── 가짜 리스에 붙여 실제로 굴린다 (test-switch 하네스 축약) ──
const SCHEMA = {
  simcore: '0.1', meta: { name: '과거 상태창 테스트' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
};
const mkState = (hp, turn) => JSON.stringify({
  vars: { hp },
  meta: { turn, setupDone: true, armed: {}, actionLastUsed: {}, eventLastFired: {}, firedOnce: {}, pendingNotifies: [] },
});

async function boot(preload) {
  const world = {
    chaIdx: 0, chatIdx: 0,
    chars: [
      { chaId: 'c-plain', name: '스키마 없는 봇', globalLore: [], triggerscript: [] },
      { chaId: 'c-sim', name: '심코어 봇', globalLore: [], triggerscript: [] },
    ],
    chats: {
      'c-plain:0': { id: 'ch0', message: [] },
      'c-sim:0': { id: 'ch1', message: [
        { role: 'char', data: '첫 장면 ⟦simcore:0⟧' },
        { role: 'user', data: '진행' },
        { role: 'char', data: '두 번째 장면 ⟦simcore:2⟧' },
      ] },
    },
  };
  const buttons = new Map();
  const store = new Map(Object.entries(preload ?? {}));
  const cur = () => world.chars[world.chaIdx];
  const curChat = () => world.chats[`${cur().chaId}:${world.chatIdx}`] ?? { id: 'x', message: [] };
  global.Risuai = {
    getCharacter: async () => (world.ready ? cur() : null),
    setCharacter: async (c) => { world.chars[world.chaIdx] = c; },
    getCurrentCharacterIndex: async () => world.chaIdx,
    getCurrentChatIndex: async () => world.chatIdx,
    getChatFromIndex: async () => curChat(),
    setChatToIndex: async (_a, _b, c) => { world.chats[`${cur().chaId}:${world.chatIdx}`] = c; },
    registerButton: async (o) => { buttons.set(o.id ?? o.name, o); },
    unregisterUIPart: async (id) => { buttons.delete(id); },
    registerSetting: async () => {},
    addRisuReplacer: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    addRisuScriptHandler: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    showContainer: async () => {},
    alert: async () => {},
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
  world.ready = true;
  (0, eval)(src);
  await sleep(120);
  return { world, store };
}

(async () => {
  // out:0 = hp 90 시절, out:2 = hp 30 시절 — 채팅 로드는 out:2를 현재로 복원한다
  const { world } = await boot({
    'sim:c-sim:ch1:out:0': mkState(90, 1),
    'sim:c-sim:ch1:out:2': mkState(30, 2),
  });
  const LORE = src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)?.[1]
    ?? src.match(/SCHEMA_LORE_COMMENT\s*=\s*"([^"]+)"/)?.[1];
  world.chars[1].globalLore = [{ comment: LORE, content: JSON.stringify(SCHEMA) }];
  world.chaIdx = 1;
  await sleep(2400); // 전환 폴링 + 프리페치 소화

  const disp = global.__hooks?.display;
  ck('display 핸들러 등록됨', typeof disp === 'function', '');
  const now = String(disp('두 번째 장면 ⟦simcore:2⟧') ?? '');
  ck('★ 최신 마커 = 현재 상태 (hp 30)', /30</.test(now) && !/90</.test(now), now.slice(0, 200));
  const old = String(disp('첫 장면 ⟦simcore:0⟧') ?? '');
  ck('★ 과거 마커 = 그 시점 스냅샷 (hp 90)', /90</.test(old) && !/30</.test(old), old.slice(0, 200));
  // 스냅샷이 없는(keepN 밖) 과거 마커 — 현재 상태 폴백, 죽지 않는다
  const miss = String(disp('사라진 장면 ⟦simcore:1⟧') ?? '');
  ck('스냅샷 없는 과거 마커 — 현재 상태 폴백', /30</.test(miss), miss.slice(0, 200));

  try { await global.__unload?.(); } catch { /* 정리 실패는 결과와 무관 */ }
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
