const __P = (...p) => require('path').resolve(__dirname, ...p);
// beforeRequest 리플레이서가 남의 요청까지 오염시키지 않는지 — 가짜 리스에 붙여 실제로 굴린다.
//
// 리수는 이 훅을 `replacer(formated, model)`로 부르는데 model은 메인 생성('model')만이 아니라
// 'submodel'|'memory'|'emotion'|'translate'|'otherAx' 전부다. 모듈의 루아 axLLM은 'otherAx',
// 다른 플러그인의 runLLMModel은 대개 'submodel'이라 여기에 상태 블록을 얹으면 그쪽 기능이 죽는다.
// (v0.37.2 이전 실제 증상: "심코어는 되는데 모듈 상태창이 안 뜬다", "다른 플러그인이 안 돈다")
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCHEMA = {
  simcore: '0.1', meta: { name: '오염 테스트' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
  updater: { allow: [{ id: 'hp', maxDelta: 5 }] },
};

async function boot() {
  const LORE = src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)?.[1];
  const world = {
    chaIdx: 0, chatIdx: 0, ready: true,
    chars: [{
      chaId: 'c-sim', name: '심코어 봇', triggerscript: [],
      globalLore: [{ comment: LORE, content: JSON.stringify(SCHEMA) }],
    }],
    chats: { 'c-sim:0': { id: 'ch0', message: [{ role: 'user', data: '안녕' }] } },
  };
  const store = new Map();
  const writes = [];                       // mirrorVars 등 채팅 쓰기 흔적
  const curChat = () => world.chats['c-sim:' + world.chatIdx];

  global.Risuai = {
    getCharacter: async () => world.chars[world.chaIdx],
    setCharacter: async (c) => { world.chars[world.chaIdx] = c; },
    getCurrentCharacterIndex: async () => world.chaIdx,
    getCurrentChatIndex: async () => world.chatIdx,
    getChatFromIndex: async () => curChat(),
    setChatToIndex: async (_a, _b, c) => { writes.push(c); world.chats['c-sim:' + world.chatIdx] = c; },
    registerButton: async () => {}, unregisterUIPart: async () => {}, registerSetting: async () => {},
    addRisuReplacer: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    addRisuScriptHandler: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    showContainer: async () => {}, alert: async () => {},
    getArgument: async () => 'off',       // 보조 호출은 끈다 — 여기서 보는 건 프롬프트 주입뿐
    onUnload: async (fn) => { global.__unload = fn; },
    runLLMModel: async () => ({ type: 'fail', result: '' }),
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
  return { world, writes };
}

(async () => {
  // ── 소스 정적 확인 ──
  ck('★ 리플레이서가 type을 실제로 본다', /if \(type !== 'model'\) return messages;/.test(src), '');
  ck('★ loadForCurrentChar가 try 안에 있다 (던지면 앱의 모든 요청이 죽는다)',
    /try \{[\s\S]{0,200}await loadForCurrentChar\(\);/.test(src), '');

  const { writes } = await boot();
  const hooks = global.__hooks ?? {};
  ck('beforeRequest 훅이 등록됐다', typeof hooks.beforeRequest === 'function', Object.keys(hooks).join(','));
  if (typeof hooks.beforeRequest !== 'function') { report(); return; }

  const mk = () => [{ role: 'user', content: '유저 발화 ⟦simcore:3⟧' },
    { role: 'assistant', content: '이전 응답' }];

  // ── 메인 생성: 상태 블록이 실려야 한다 ──
  const main = await hooks.beforeRequest(mk(), 'model');
  ck('★ 메인 생성에는 상태 블록이 실린다', main.length === 3 && main[2].role === 'system',
    main.map((m) => m.role).join(',') + ` (${main.length}통)`);
  const block = main[2]?.content ?? '';
  ck('상태 블록이 비어 있지 않다', block.length > 20, String(block.length));

  // ── 남의 보조 호출: 아무것도 얹지 않는다 ──
  for (const type of ['submodel', 'otherAx', 'memory', 'emotion', 'translate']) {
    const before = writes.length;
    const out = await hooks.beforeRequest(mk(), type);
    ck(`★ '${type}' 요청에는 아무것도 얹지 않는다`, out.length === 2,
      out.map((m) => m.role).join(',') + ` (${out.length}통)`);
    ck(`'${type}'은 우리 턴을 넘기지 않는다 (onSend·mirrorVars 미실행)`, writes.length === before,
      `쓰기 ${before} → ${writes.length}`);
  }

  // ── 마커는 전 타입에서 지워져야 한다 ──
  // 모듈(에모지 태그 등)은 서사에 줄번호를 매겨 보조모델에 넘긴다. 마커가 남으면 그 줄이 밀린다.
  const bled = await hooks.beforeRequest(mk(), 'otherAx');
  ck('★ 보조 요청에서도 ⟦simcore:N⟧ 마커는 지워진다',
    !bled.some((m) => String(m.content).includes('⟦simcore:')), JSON.stringify(bled[0]?.content));
  ck('메인 생성에서도 마커는 지워진다', !main.some((m) => String(m.content).includes('⟦simcore:')), '');

  // ── 이상한 입력이 와도 요청을 죽이지 않는다 (호출부에 try/catch가 없다) ──
  let threw = null;
  try {
    await hooks.beforeRequest([{ role: 'user' }, { role: 'user', content: null }, null], 'otherAx');
  } catch (e) { threw = e; }
  ck('★ content가 문자열이 아니어도 던지지 않는다', threw === null, threw && threw.message);
  try { await hooks.beforeRequest(undefined, 'translate'); } catch (e) { threw = e; }
  ck('messages가 없어도 던지지 않는다', threw === null, threw && threw.message);

  if (global.__unload) global.__unload();
  report();
})();

function report() {
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
}
