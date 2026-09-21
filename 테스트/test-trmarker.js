const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.10.2 — 번역문에 상태창이 안 뜨던 회귀 (커뮤니티 제보 2026-09-21).
// 증상: 번역문에는 ⟦simcore:N⟧이 없어 상태창이 안 선다. 번역문을 손으로 고쳐 마커를 넣으면 선다.
//       번역가의 노트에 "마지막에 포함하라"고 적어도 안 된다.
// 뿌리: 마커를 지운 건 번역가가 아니라 우리 beforeRequest다 (v0.37.2 — 마커 제거는 전 타입 공통).
//       리수의 LLM 번역 + [HTML 포맷 전 번역]은 저장 원문을 그대로 번역 요청에 넣고, 상태창(display)은
//       번역 **뒤에** 그려진다. 번역가는 마커를 본 적이 없다.
// 해법: 떼는 건 그대로, 뗀 번호를 기억했다가 afterRequest에서 번역 결과 끝에 도로 붙인다.
// 여기서 못 박는 것:
//   · 번역가에게는 여전히 마커가 안 간다 (떼기는 유지)
//   · 번역 결과 끝에 **제** 마커가 선다 — 하나뿐일 때 / 동시에 여럿일 때(순서가 뒤집혀도)
//   · 애매하면 안 붙인다 (틀린 마커 < 없는 마커)
//   · translate가 아닌 응답은 글자 하나 안 건드린다 — 이 훅도 앱의 모든 성공 응답에 걸린다
//   · 실패한 요청이 남긴 대기는 시간이 치운다 / 재시도·[다시 번역]은 같은 대기로 합친다
//   · 어떤 입력에도 던지지 않는다 (호출부에 try/catch가 없다)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const adapter = fs.readFileSync(__P('../adapter/risu-plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 소스 정적 확인 ──
{
  ck('afterRequest 리플레이서를 건다', src.includes("addRisuReplacer('afterRequest'"), '');
  ck('★ translate가 아니면 그대로 돌려준다 (타입 가드가 첫 줄)',
    /addRisuReplacer\('afterRequest', async \(content, type\) => \{\s*if \(type !== 'translate' \|\| typeof content !== 'string'\) return content;/.test(src), '');
  ck('등록이 던져도 부팅이 안 죽는다 (옛 리수엔 이 훅 이름이 없다)',
    /try \{\s*await Risuai\.addRisuReplacer\('afterRequest'/.test(src), '');
  ck('★ 떼기는 그대로 — beforeRequest의 전 타입 마커 제거가 남아 있다',
    /if \(m && typeof m\.content === 'string'\) m\.content = stripMarkers\(m\.content\);/.test(src), '');
  ck('번역 요청에서만 번호를 기억한다', src.includes("if (type === 'translate') { try { trFound = trFindMarker(messages); }"), '');
  ck('버전이 v1.10.2 이상', /\/\/@version 1\.1[0-9]\.([2-9]|\d\d)/.test(adapter), '');
  ck('체인지로그에 v1.10.2 항목', adapter.includes('── v1.10.2 ─'), '');
}

const SCHEMA = {
  simcore: '0.1', meta: { name: '번역 마커 테스트' },
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

// 시계를 민다 — 대기 만료(3분)를 기다리지 않고 재현한다
const realNow = Date.now; let skew = 0;
Date.now = () => realNow() + skew;
const flush = () => { skew += 200000; };          // 다음 호출에서 떠 있던 대기가 전부 만료된다

const SYS = { role: 'system', content: 'Translate the following text to Korean. Keep the formatting.' };
const req = (text) => [{ ...SYS }, { role: 'user', content: text }];
const markers = (t) => (String(t).match(/⟦simcore:\d+⟧/g) ?? []);

(async () => {
  const { world } = await boot();
  const hooks = global.__hooks ?? {};
  world.chars[0].globalLore = [{ comment: src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)[1], content: JSON.stringify(SCHEMA) }];
  ck('훅이 실제로 걸렸다', typeof hooks.afterRequest === 'function' && typeof hooks.beforeRequest === 'function', Object.keys(hooks).join(','));

  // 세션을 세운다 (display 확인용) — 한 턴 굴린다
  await hooks.beforeRequest([{ role: 'user', content: '진행' }], 'model');
  world.chats['c-sim:0'].message.push({ role: 'char', data: '' });
  world.chats['c-sim:0'].message[2].data = await hooks.output('He stepped closer.');
  await global.__simcoreDrainTurn();
  const callsAfterTurn = world.llmCalls;

  // ── ① 하나뿐인 번역 ──
  {
    flush();
    const m = req('He stepped closer.\n\n⟦simcore:2⟧');
    const sent = await hooks.beforeRequest(m, 'translate');
    ck('★ 번역가에게는 마커가 안 간다 (떼기 유지)', !sent.some((x) => /⟦simcore/.test(x.content)), JSON.stringify(sent[1].content));
    ck('번역 요청에 아무것도 얹지 않는다 (메시지 수·시스템 문구 그대로)', sent.length === 2 && sent[0].content === SYS.content, '');
    const out = await hooks.afterRequest('그가 가까이 다가왔다.', 'translate');
    ck('★ 번역 결과 끝에 제 마커가 선다', /^그가 가까이 다가왔다\.\n\n⟦simcore:2⟧$/.test(out), JSON.stringify(out));
    ck('번역은 우리 턴을 넘기지 않는다 (보조 호출 0회 추가)', world.llmCalls === callsAfterTurn, `${world.llmCalls}`);
    const shown = hooks.display(out);
    ck('★ 되붙인 번역문이 상태창으로 그려진다', (shown.includes('<style') || shown.includes('sc-')) && !/⟦simcore/.test(shown), shown.slice(0, 60));
    const again = await hooks.afterRequest('또 다른 글', 'translate');
    ck('대기가 비면 손대지 않는다 (한 번 쓰면 끝)', again === '또 다른 글', JSON.stringify(again));
  }

  // ── ② translate가 아닌 응답은 안 건드린다 ──
  {
    flush();
    await hooks.beforeRequest(req('Rain fell.\n\n⟦simcore:4⟧'), 'translate');
    for (const t of ['model', 'submodel', 'memory', 'emotion', 'otherAx', undefined]) {
      const r = await hooks.afterRequest('남의 응답', t);
      ck(`★ ${t} 응답은 그대로 (번역 대기가 떠 있어도)`, r === '남의 응답', JSON.stringify(r));
    }
    const out = await hooks.afterRequest('비가 내렸다.', 'translate');
    ck('그 사이 대기는 안 닳았다 — 제 번역엔 붙는다', /⟦simcore:4⟧$/.test(out), JSON.stringify(out));
  }

  // ── ③ 마커 없는 번역 (유저 글 · HTML 번역 모드) ──
  {
    flush();
    await hooks.beforeRequest(req('I open the door.'), 'translate');
    const out = await hooks.afterRequest('나는 문을 연다.', 'translate');
    ck('마커 없던 글의 번역엔 아무것도 안 붙는다', out === '나는 문을 연다.', JSON.stringify(out));
  }

  // ── ④ 재시도 루프 — 리수는 이미 뗀 배열로 beforeRequest를 다시 부른다 ──
  {
    flush();
    const m = req('The bell rang.\n\n⟦simcore:6⟧');
    const once = await hooks.beforeRequest(m, 'translate');
    await hooks.beforeRequest(once, 'translate');           // 재시도: 마커가 이미 없다
    const out = await hooks.afterRequest('종이 울렸다.', 'translate');
    ck('★ 재시도가 번호를 null로 덮지 않는다', /⟦simcore:6⟧$/.test(out), JSON.stringify(out));
    const next = await hooks.afterRequest('무관한 글', 'translate');
    ck('재시도는 대기를 둘로 늘리지 않는다', next === '무관한 글', JSON.stringify(next));
  }

  // ── ⑤ 동시에 둘 — 숫자로 짝을 맞춘다 (결과 순서가 뒤집혀도) ──
  {
    flush();
    await hooks.beforeRequest(req('HP fell to 30. She paid 1200 gold.\n\n⟦simcore:8⟧'), 'translate');
    await hooks.beforeRequest(req('Day 17. There were 5 wolves at the gate.\n\n⟦simcore:10⟧'), 'translate');
    const b = await hooks.afterRequest('17일째. 성문에 늑대 5마리가 있었다.', 'translate');
    ck('★ 나중 요청의 결과가 먼저 와도 제 마커', /⟦simcore:10⟧$/.test(b), JSON.stringify(b));
    const a = await hooks.afterRequest('체력이 30으로 떨어졌다. 그녀는 1200골드를 냈다.', 'translate');
    ck('★ 남은 하나도 제 마커', /⟦simcore:8⟧$/.test(a), JSON.stringify(a));
  }

  // ── ⑥ 동시에 둘 — 태그(에셋)로 짝을 맞춘다 ──
  {
    flush();
    await hooks.beforeRequest(req('<img="Miku_smile">\n\nShe laughed. <b>Really</b>?\n\n⟦simcore:12⟧'), 'translate');
    await hooks.beforeRequest(req('<img="Nino_angry">\n\nShe frowned. <i>Hmph</i>.\n\n⟦simcore:14⟧'), 'translate');
    const n = await hooks.afterRequest('<img="Nino_angry">\n\n그녀가 얼굴을 찌푸렸다. <i>흥</i>.', 'translate');
    ck('★ 태그가 같은 쪽이 짝이다', /⟦simcore:14⟧$/.test(n), JSON.stringify(n));
    const k = await hooks.afterRequest('<img="Miku_smile">\n\n그녀가 웃었다. <b>정말</b>?', 'translate');
    ck('남은 하나도 제 마커', /⟦simcore:12⟧$/.test(k), JSON.stringify(k));
  }

  // ── ⑦ 동시에 둘인데 잴 것이 없다 — 안 붙인다 ──
  {
    flush();
    await hooks.beforeRequest(req('She smiled softly.\n\n⟦simcore:16⟧'), 'translate');
    await hooks.beforeRequest(req('He looked away.\n\n⟦simcore:18⟧'), 'translate');
    const x = await hooks.afterRequest('그는 시선을 돌렸다.', 'translate');
    ck('★ 애매하면 안 붙인다 (틀린 마커 < 없는 마커)', markers(x).length === 0 && x === '그는 시선을 돌렸다.', JSON.stringify(x));
    const y = await hooks.afterRequest('그녀가 부드럽게 웃었다.', 'translate');
    ck('★ 하나 남았다고 그걸 붙이지 않는다 — 앞 결과가 누구 것인지 모른다', markers(y).length === 0, JSON.stringify(y));
    // 떠 있던 둘이 다 돌아왔으니 대기는 비어야 한다 — 다음 단독 번역은 정확히 붙는다 (3분을 안 기다린다)
    await hooks.beforeRequest(req('Morning came.\n\n⟦simcore:20⟧'), 'translate');
    const z = await hooks.afterRequest('아침이 왔다.', 'translate');
    ck('★ 전부 돌아온 뒤엔 대기가 비어 다음 번역이 바로 선다', /⟦simcore:20⟧$/.test(z), JSON.stringify(z));
  }

  // ── ⑧ 지문이 같으면 포기하고, 토큰 하나라도 다르면 그걸로 가른다 ──
  {
    flush();
    await hooks.beforeRequest(req('HP 30, gold 1200. She sighed.\n\n⟦simcore:22⟧'), 'translate');
    await hooks.beforeRequest(req('HP 30, gold 1200. He nodded.\n\n⟦simcore:24⟧'), 'translate');
    const x = await hooks.afterRequest('체력 30, 골드 1200. 그가 끄덕였다.', 'translate');
    ck('★ 지문이 똑같으면 안 붙인다', markers(x).length === 0, JSON.stringify(x));

    flush();
    await hooks.beforeRequest(req('HP 30, gold 1200, day 5.\n\n⟦simcore:36⟧'), 'translate');
    await hooks.beforeRequest(req('HP 30, gold 1200, day 6.\n\n⟦simcore:38⟧'), 'translate');
    const y = await hooks.afterRequest('체력 30, 골드 1200, 6일째.', 'translate');
    ck('토큰 하나가 다르면 그 하나로 가른다', /⟦simcore:38⟧$/.test(y), JSON.stringify(y));
    // 번역가가 그 하나를 글자로 풀어 쓰면("닷새") 가를 것이 사라진다 — 그때는 포기
    flush();
    await hooks.beforeRequest(req('HP 30, gold 1200, day 5.\n\n⟦simcore:40⟧'), 'translate');
    await hooks.beforeRequest(req('HP 30, gold 1200, day 6.\n\n⟦simcore:42⟧'), 'translate');
    const z = await hooks.afterRequest('체력 30, 골드 1200, 닷새째.', 'translate');
    ck('★ 가를 토큰이 번역에서 사라지면 안 붙인다', markers(z).length === 0, JSON.stringify(z));
  }

  // ── ⑨ 실패한 요청의 잔여 — afterRequest가 안 온다 ──
  {
    flush();
    await hooks.beforeRequest(req('The gate was shut.\n\n⟦simcore:26⟧'), 'translate');   // 실패 — 결과가 영영 안 온다
    // 같은 글을 [다시 번역] → 같은 대기로 합쳐져 단독이 된다
    await hooks.beforeRequest(req('The gate was shut.\n\n⟦simcore:26⟧'), 'translate');
    const r = await hooks.afterRequest('성문은 닫혀 있었다.', 'translate');
    ck('★ 실패 뒤 [다시 번역]은 같은 대기로 합쳐 바로 붙는다', /⟦simcore:26⟧$/.test(r), JSON.stringify(r));

    await hooks.beforeRequest(req('A failed one.\n\n⟦simcore:28⟧'), 'translate');          // 또 실패
    flush();                                                                               // 3분 넘게 흐른다
    await hooks.beforeRequest(req('Snow began to fall.\n\n⟦simcore:30⟧'), 'translate');
    const s = await hooks.afterRequest('눈이 내리기 시작했다.', 'translate');
    ck('★ 만료된 잔여는 다음 번역을 흐리지 않는다 (30이 붙는다, 28 아님)', /⟦simcore:30⟧$/.test(s) && !/simcore:28/.test(s), JSON.stringify(s));
  }

  // ── ⑩ 결과에 이미 마커가 있어도 하나만 ──
  {
    flush();
    await hooks.beforeRequest(req('Wind.\n\n⟦simcore:32⟧'), 'translate');
    const r = await hooks.afterRequest('바람.\n\n⟦simcore:99⟧', 'translate');
    ck('마커는 딱 하나, 제 번호로', markers(r).length === 1 && /⟦simcore:32⟧$/.test(r), JSON.stringify(r));
  }

  // ── ⑪ ChatML 프리셋 — 원문이 큰 메시지 한가운데 박혀 온다 ──
  {
    flush();
    const m = [{ role: 'user', content: '# Note\nkeep tone\n\n# Text\nThe lamp went out.\n\n⟦simcore:34⟧\n\n# End' }];
    const sent = await hooks.beforeRequest(m, 'translate');
    ck('가운데 박힌 마커도 뗀다', !/⟦simcore/.test(sent[0].content), JSON.stringify(sent[0].content));
    const r = await hooks.afterRequest('등불이 꺼졌다.', 'translate');
    ck('붙이는 자리는 결과의 끝', /^등불이 꺼졌다\.\n\n⟦simcore:34⟧$/.test(r), JSON.stringify(r));
  }

  // ── ⑫ 던지지 않는다 ──
  {
    flush();
    let threw = false;
    try {
      await hooks.beforeRequest(null, 'translate');
      await hooks.beforeRequest([null, { role: 'user' }, { role: 'user', content: 42 }], 'translate');
      const a = await hooks.afterRequest(undefined, 'translate');
      const b = await hooks.afterRequest(123, 'translate');
      const c = await hooks.afterRequest('', 'translate');
      ck('문자열이 아니면 그대로 돌려준다', a === undefined && b === 123, `${a},${b}`);
      ck('빈 결과도 안 죽는다', typeof c === 'string', JSON.stringify(c));
    } catch (e) { threw = true; ck('던지지 않는다', false, e.message); }
    if (!threw) ck('★ 어떤 입력에도 던지지 않는다 (호출부에 try/catch가 없다)', true, '');
  }

  Date.now = realNow;
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  try { await global.__unload?.(); } catch { /* 정리 실패는 무시 */ }
  process.exit(f ? 1 : 0);
})();
