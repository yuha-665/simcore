const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.0.1 — 스트리밍 중복 호출 픽스 실측.
// 리수는 스트리밍 중 청크마다 editoutput을 다시 돌린다 (index.svelte.ts 실측, 2026-08-29 제보:
// 한 턴에 보조 10회+ 호출·틱 중복). 여기서는 가짜 리수로 그 호출 패턴을 재현해:
//   · 부분 텍스트 호출에는 보조 0회 (마커만)
//   · 잠잠해진 뒤 확정 처리 1회 (보조 1회, 델타 1회 적용)
//   · 스트리밍 outIndex = length-1 (예전 계산은 +1로 밀렸다)
//   · 늦은 조각(lastSettledKey)은 두 번 확정하지 않는다
//   · 비스트리밍 인라인 경로는 그대로
//   · bodyIntercepter가 보조 요청만 식별해 출력 상한·thinking 예산을 클램프
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 소스 정적 확인 (배선이 실제로 들어갔는가) ──
{
  ck('스트리밍 확정 기계 존재', src.includes('scheduleOutputSettle') && src.includes('finalizeOutputSettle'), '');
  ck('★ 부분 호출은 아무것도 안 굴린다 (스트리밍 판정 → settle만)', src.includes('scheduleOutputSettle(chaIdx, chatIdx, outIndex, content)'), '');
  ck('★ 다음 턴이 미확정분을 먼저 정산한다 (beforeRequest flush)', src.includes('await flushOutputSettle();\n      lastSettledKey = null;'), '');
  ck('★ 보조 출력 상한 클램프 존재 (runLLMModel엔 maxTokens가 없다)', src.includes('auxCapInFlight') && src.includes('clampAuxBody'), '');
  ck('클램프는 이중 걸쇠 (호출 진행 중 + AUX_NUDGE 실존)', src.includes('auxCapInFlight == null || body == null') && src.includes('body.includes(AUX_NUDGE)'), '');
  ck('클램프 실패해도 원본 유지 (남의 요청을 죽이면 안 된다)', src.includes('catch { return body; }'), '');
  ck('테스트·디버그 배수구', src.includes('globalThis.__simcoreDrainTurn = flushOutputSettle'), '');
}

// ── 가짜 리스에 붙여 실제로 굴린다 ──
const SCHEMA = {
  simcore: '0.1', meta: { name: '스트리밍 테스트' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
  updater: { allow: [{ id: 'hp' }] },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
};
const mkState = (hp, turn) => JSON.stringify({
  vars: { hp },
  meta: { turn, setupDone: true, armed: {}, actionLastUsed: {}, eventLastFired: {}, firedOnce: {}, pendingNotifies: [] },
});
const AUX_NUDGE = src.match(/const AUX_NUDGE = '([^']+)'/)?.[1];

async function boot() {
  const world = {
    llmCalls: 0, clamped: [],
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
    registerBodyIntercepter: async (fn) => { global.__bodyCb = fn; return { id: 'x' }; },
    showContainer: async () => {}, alert: async () => {},
    getArgument: async (k) => (k === 'aux_model_mode' ? 'aux' : 'off'),
    onUnload: async (fn) => { global.__unload = fn; },
    runLLMModel: async () => {
      world.llmCalls++;
      // 요청이 나가는 동안 fetch 계층에서 인터셉터가 도는 것을 재현 — 클램프 결과를 기록
      if (global.__bodyCb) {
        const body = JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: AUX_NUDGE }] }],
          generationConfig: { maxOutputTokens: 10000, thinkingConfig: { thinkingBudget: -1 } },
        });
        world.clamped.push(await global.__bodyCb(body, 'gemini_base_stream'));
      }
      return { type: 'success', result: world.auxResult };
    },
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
  ck('AUX_NUDGE 추출됨 (클램프 걸쇠 문장)', !!AUX_NUDGE, '');
  const { world, store } = await boot();
  const hooks = global.__hooks ?? {};
  world.chars[0].globalLore = [{ comment: src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)[1], content: JSON.stringify(SCHEMA) }];
  const chat = () => world.chats['c-sim:0'];
  const outVars = (n) => JSON.parse(store.get(`sim:c-sim:ch1:out:${n}`) ?? 'null')?.vars;

  // ── 턴 1: 스트리밍 — 빈 char 메시지가 미리 push된 채 청크마다 output이 돈다 ──
  await hooks.beforeRequest([{ role: 'user', content: '진행' }], 'model');
  chat().message.push({ role: 'char', data: '' });          // 리수의 스트리밍 사전 push 재현
  const p1 = await hooks.output('그가 다가');                 // 청크 1 (부분)
  chat().message[2].data = p1;                              // 리수가 반환값을 저장하는 것 재현
  ck('★ 스트리밍 부분 호출: 마커만 붙는다 (outIndex = length-1 = 2)', /⟦simcore:2⟧$/.test(p1), p1.slice(-30));
  const p2 = await hooks.output('그가 다가왔다.');            // 청크 2 (완성)
  chat().message[2].data = p2;
  const p3 = await hooks.output('그가 다가왔다.');            // 마지막 플러시 (같은 내용)
  chat().message[2].data = p3;
  ck('★ 부분 호출 3회 동안 보조 호출 0회', world.llmCalls === 0, `${world.llmCalls}회`);
  ck('부분 호출 반환에도 마커 유지', /⟦simcore:2⟧$/.test(p3), p3.slice(-30));

  await global.__simcoreDrainTurn();                        // 스트림 종료 후 확정 (배수구)
  ck('★ 확정 처리에서 보조 딱 1회', world.llmCalls === 1, `${world.llmCalls}회`);
  ck('★ 델타 1회만 적용 (hp 50 → 45, 중복 갱신 없음)', outVars(2)?.hp === 45, JSON.stringify(outVars(2)));

  // 늦은 조각 (deferStreamingPostProcessing 후처리 등) — 두 번 확정하지 않는다
  const late = await hooks.output('그가 다가왔다.');
  await global.__simcoreDrainTurn();
  ck('★ 늦은 조각은 재확정 없음 (보조 여전히 1회)', world.llmCalls === 1, `${world.llmCalls}회`);
  ck('늦은 조각도 hp 그대로 45', outVars(2)?.hp === 45, JSON.stringify(outVars(2)));
  ck('늦은 조각 반환에도 마커', /⟦simcore:2⟧$/.test(late), late.slice(-30));

  // ── 클램프: 보조 요청 바디에서 상한이 실제로 내려갔다 ──
  {
    ck('클램프가 보조 요청에 돌았다', world.clamped.length === 1, `${world.clamped.length}회`);
    const b = JSON.parse(world.clamped[0] ?? '{}');
    ck('★ maxOutputTokens 10000 → 1000 (요청 400×2, 최소 1000)', b?.generationConfig?.maxOutputTokens === 1000, JSON.stringify(b?.generationConfig));
    ck('★ thinking 동적(-1) → 512 예산', b?.generationConfig?.thinkingConfig?.thinkingBudget === 512, '');
    // 보조 호출이 없는 동안엔 어떤 바디도 건드리지 않는다 (걸쇠 ①)
    const idle = JSON.stringify({ contents: [{ parts: [{ text: AUX_NUDGE }] }], generationConfig: { maxOutputTokens: 9999 } });
    ck('★ 보조 미진행 중엔 원본 그대로 (메인 요청 오폭 없음)', await global.__bodyCb(idle, 'gemini_base') === idle, '');
    // JSON이 아닌 바디도 그대로 (죽지 않는다)
    ck('비JSON 바디 통과', await global.__bodyCb('hello', 'x') === 'hello', '');
  }

  // ── 턴 2: 비스트리밍 — push 전에 한 번 오는 기존 경로는 인라인 그대로 ──
  chat().message.push({ role: 'user', data: '다음' });
  await hooks.beforeRequest([{ role: 'user', content: '다음' }], 'model');
  const o2 = await hooks.output('조용한 밤.');
  ck('★ 비스트리밍: 인라인 1회 처리 (보조 2회째)', world.llmCalls === 2, `${world.llmCalls}회`);
  ck('★ 비스트리밍 outIndex = length = 4', /⟦simcore:4⟧$/.test(o2), o2.slice(-30));
  ck('비스트리밍 hp 45 → 40', outVars(4)?.hp === 40, JSON.stringify(outVars(4)));

  try { await global.__unload?.(); } catch { /* 정리 실패는 결과와 무관 */ }
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
