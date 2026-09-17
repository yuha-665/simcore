const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.27 — 잘린 마커 회귀 (포켓리스 제보 2026-09-16).
// 증상: 상태창이 안 뜨고 답변 끝에 `⟦simcore:`만 덩그러니 남는다 (기본 새 시뮬에서도 동일).
// 뿌리: 마커 판정이 includes('⟦simcore:') 하나여서 **잘린 꼬리도 "마커 있음"**으로 읽혔다.
// 여기서 재현하는 것:
//   · 프론트가 마커 한가운데서 자른 글을 도로 먹여도 → 완성 마커 하나가 끝에 선다
//   · 잘린 꼬리가 본문에 남지 않는다 (붙일 때 걷어낸다)
//   · display: 잘린 꼬리만 있는 글은 꼬리를 치우고, 성한 마커는 상태창으로 그린다
//   · 마커 유실 복구(4초)가 잘린 꼬리를 성한 마커로 갈아 세운다 — 그물이 같이 눈멀지 않는다
//   · beforeRequest·맥락 추출이 꼬리를 지워 모델에게 안 샌다
//   · 멀쩡한 ⟦⟧ 글(⟦중요⟧ 등)은 안 건드린다
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 소스 정적 확인 ──
{
  ck('완성형 전용 판정 존재 (hasMarker)', src.includes('const hasMarker =') && src.includes('MARKER_ONE_RE'), '');
  ck('꼬리까지 지우는 제거기 존재 (stripMarkers)', src.includes('const stripMarkers =') && src.includes('MARKER_TAIL_RE'), '');
  ck('★ 부분 문자열 검사가 코드에 남아 있지 않다', !/[^/]includes\('⟦simcore:'\)/.test(src.replace(/^\s*\/\/.*$/gm, '')), '');
  ck('★ 복구 그물도 완성형으로 판정', src.includes('hasMarker(msg.data)'), '');
  ck('복구는 꼬리를 갈아 붙인다 (+= 아님)', src.includes('msg.data = stripMarkers(msg.data) +'), '');
  ck('루아 브리지도 꼬리 제거', src.includes("'⟦simcore:%d*$'"), '');
}

// ── 제거기·판정기 순수 확인 (번들에서 정규식만 떠서) ──
{
  const one = new RegExp(src.match(/const MARKER_ONE_RE = \/(.+?)\/;/)[1]);
  const tailSrc = src.match(/const MARKER_TAIL_RE = \/(.+?)\/;/)[1];
  const tail = new RegExp(tailSrc);
  const all = /⟦simcore:(\d+)⟧/g;
  const strip = (t) => t.replace(all, '').replace(tail, '').trimEnd();

  ck('성한 마커는 마커', one.test('본문\n\n⟦simcore:12⟧'), '');
  ck('★ `⟦simcore:`는 마커가 아니다', !one.test('본문\n\n⟦simcore:'), '');
  ck('★ `⟦simcore:12`(닫힘 없음)도 마커가 아니다', !one.test('본문\n\n⟦simcore:12'), '');
  ck('한 글자만 남은 `⟦`도 마커가 아니다', !one.test('본문\n\n⟦'), '');

  ck('★ 잘린 꼬리 제거 (`⟦simcore:`)', strip('그가 웃었다.\n\n⟦simcore:') === '그가 웃었다.', JSON.stringify(strip('그가 웃었다.\n\n⟦simcore:')));
  ck('★ 잘린 꼬리 제거 (숫자까지 온 것)', strip('그가 웃었다.\n\n⟦simcore:12') === '그가 웃었다.', '');
  ck('중간에서 잘린 꼬리 제거 (`⟦simc`)', strip('그가 웃었다.\n\n⟦simc') === '그가 웃었다.', '');
  ck('성한 마커 제거', strip('그가 웃었다.\n\n⟦simcore:12⟧') === '그가 웃었다.', '');
  ck('마커 없는 글은 그대로', strip('그가 웃었다.') === '그가 웃었다.', '');
  ck('★ 남의 ⟦⟧ 괄호는 안 건드린다', strip('그가 ⟦중요⟧ 말했다.') === '그가 ⟦중요⟧ 말했다.', strip('그가 ⟦중요⟧ 말했다.'));
  ck('★ 끝에 온 ⟦중요⟧도 안 건드린다', strip('그가 말했다 ⟦중요⟧') === '그가 말했다 ⟦중요⟧', strip('그가 말했다 ⟦중요⟧'));
}

// ── 가짜 리스에 붙여 실제로 굴린다 ──
const SCHEMA = {
  simcore: '0.1', meta: { name: '마커 테스트' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
  updater: { allow: [{ id: 'hp' }] },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
};
const mkState = (hp, turn) => JSON.stringify({
  vars: { hp },
  meta: { turn, setupDone: true, armed: {}, actionLastUsed: {}, eventLastFired: {}, firedOnce: {}, pendingNotifies: [] },
});

async function boot() {
  const world = {
    llmCalls: 0,
    auxResult: '{"changes":{"hp":-5},"reasons":{"hp":"부상"}}',
    chars: [{ chaId: 'c-sim', name: '심코어 봇', triggerscript: [], globalLore: [] }],
    chats: { 'c-sim:0': { id: 'ch1', message: [
      { role: 'char', data: '첫 장면 ⟦simcore:0⟧' },
      { role: 'user', data: '진행' },
    ] } },
  };
  const store = new Map([['sim:c-sim:ch1:out:0', mkState(50, 1)]]);
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
    getArgument: async (k) => (k === 'aux_model_mode' ? 'aux' : 'off'),
    onUnload: async (fn) => { global.__unload = fn; },
    runLLMModel: async () => { world.llmCalls++; return { type: 'success', result: world.auxResult }; },
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
  const { world } = await boot();
  const hooks = global.__hooks ?? {};
  world.chars[0].globalLore = [{ comment: src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)[1], content: JSON.stringify(SCHEMA) }];
  const chat = () => world.chats['c-sim:0'];
  const CUT = '⟦simcore:';                 // 포켓리스가 남긴 잘린 꼬리

  // ── 턴 1: 스트리밍 중 프론트가 마커를 자른 채 저장하고, 그 글을 도로 먹인다 ──
  await hooks.beforeRequest([{ role: 'user', content: '진행' }], 'model');
  chat().message.push({ role: 'char', data: '' });         // 리수의 스트리밍 사전 push
  const p1 = await hooks.output('그가 다가');
  chat().message[2].data = p1;
  ck('스트리밍 첫 조각에 성한 마커', /⟦simcore:2⟧$/.test(p1), p1.slice(-24));

  // 프론트가 마커 한가운데서 자른 채 저장 — 다음 조각의 입력이 이 꼴로 들어온다
  chat().message[2].data = '그가 다가왔다.\n\n' + CUT;
  const p2 = await hooks.output('그가 다가왔다.\n\n' + CUT);
  chat().message[2].data = p2;
  ck('★ 잘린 글을 먹여도 성한 마커가 끝에 선다', /⟦simcore:2⟧$/.test(p2), p2.slice(-24));
  ck('★ 잘린 꼬리가 본문에 안 남는다', p2.replace(/⟦simcore:2⟧$/, '').indexOf(CUT) === -1, JSON.stringify(p2));
  ck('본문은 보존', p2.startsWith('그가 다가왔다.'), JSON.stringify(p2.slice(0, 20)));
  ck('마커는 딱 하나', (p2.match(/⟦simcore:\d+⟧/g) ?? []).length === 1, String((p2.match(/⟦simcore:\d+⟧/g) ?? []).length));

  await global.__simcoreDrainTurn();
  ck('확정 처리 1회 (잘린 입력에도 정산은 돈다)', world.llmCalls === 1, `${world.llmCalls}회`);

  // ── display: 잘린 꼬리 vs 성한 마커 ──
  {
    const cut = hooks.display('그가 다가왔다.\n\n' + CUT);
    ck('★ display: 잘린 꼬리는 화면에서 치운다', !cut.includes(CUT), JSON.stringify(cut));
    ck('display: 본문은 남긴다', cut.includes('그가 다가왔다.'), JSON.stringify(cut));
    const good = hooks.display('그가 다가왔다.\n\n⟦simcore:2⟧');
    ck('★ display: 성한 마커는 상태창으로 그린다', good.includes('<style') || good.includes('sc-'), good.slice(0, 60));
    const plain = hooks.display('마커 없는 글 ⟦중요⟧');
    ck('display: 무관한 글은 그대로', plain === '마커 없는 글 ⟦중요⟧', JSON.stringify(plain));
  }

  // ── beforeRequest: 꼬리가 모델에게 새지 않는다 ──
  {
    const msgs = [{ role: 'assistant', content: '지난 장면.\n\n' + CUT },
      { role: 'assistant', content: '더 지난 장면.\n\n⟦simcore:0⟧' },
      { role: 'user', content: '계속' }];
    const out = await hooks.beforeRequest(msgs, 'model');
    ck('★ beforeRequest: 잘린 꼬리 제거', !out[0].content.includes(CUT), JSON.stringify(out[0].content));
    ck('beforeRequest: 성한 마커도 제거', !out[1].content.includes('⟦simcore:0⟧'), JSON.stringify(out[1].content));
    ck('beforeRequest: 본문 보존', out[0].content === '지난 장면.', JSON.stringify(out[0].content));
  }

  // ── 마커 유실 복구(4초)가 잘린 꼬리를 갈아 세운다 ──
  // 턴을 하나 굴린 뒤 그 메시지를 "잘린 채 저장된" 꼴로 망가뜨리고 복구 시도를 기다린다.
  {
    chat().message.push({ role: 'user', data: '다음' });
    await hooks.beforeRequest([{ role: 'user', content: '다음' }], 'model');
    const o = await hooks.output('조용한 밤.');
    const idx = Number(o.match(/⟦simcore:(\d+)⟧/)[1]);
    chat().message[idx] = { role: 'char', data: '조용한 밤.\n\n' + CUT };   // 포켓리스가 자른 채 저장
    await sleep(4400);                                                     // 복구 1차(4초)
    const healed = chat().message[idx].data;
    ck('★ 복구 그물이 잘린 꼬리를 성한 마커로 갈아 세운다', new RegExp(`⟦simcore:${idx}⟧$`).test(healed), JSON.stringify(healed));
    ck('★ 복구 뒤 꼬리 잔해 없음', (healed.match(/⟦simcore:/g) ?? []).length === 1, JSON.stringify(healed));
    ck('복구가 본문을 안 건드린다', healed.startsWith('조용한 밤.'), JSON.stringify(healed));
  }

  try { await global.__unload?.(); } catch { /* 정리 실패는 결과와 무관 */ }
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
