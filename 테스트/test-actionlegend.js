const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.5.1 — 액션 범례가 "과거 메시지"에 잠깐 나타났다 사라지는 문제 (실사고).
//
// 제보: "액션 버튼을 눌러도 UI가 1초 만에 사라지고 반응 없는 것처럼 보인다.
//        채팅창 새로고침하면 눌린 걸로 나온다."
//
// 뿌리: display 핸들러는 마커 번호가 마지막 out 인덱스와 다르면 '과거'로 보고 범례 없이
// 그린다. 그런데 그 시점 스냅샷이 램 캐시(histStates)에 아직 없으면 **현재 상태 + 범례**로
// 임시 렌더를 해 버렸다. 채팅을 갓 열었을 때는 캐시가 비어 있으므로 과거 메시지마다 범례가
// 보이고, 배경 적재가 끝나는 순간(≈1초) 다음 재렌더에서 전부 사라진다.
// → 토글은 실제로 됐는데(조작줄엔 무장이 뜬다) 누른 자리의 ✅만 증발해 "반응 없음"으로 읽힌다.
//
// 불변식: 과거로 판정된 메시지에는 캐시 유무와 무관하게 범례·하이라이트가 없다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 정적 확인 ──
{
  ck('캐시 미스 임시 렌더도 범례 없이 (v1.5.1)',
    src.includes('histFetch(idx); // 비동기 — 다음 재렌더부터 그 시점 상태')
    && /histFetch\(idx\);[\s\S]{0,700}?return renderStatusHtml\(schema, session\.current, null, null,/.test(src), '');
  ck('DOM 제자리 갱신도 과거 메시지엔 범례를 안 찍는다',
    src.includes('const isLast = !(isFinite(uidNum) && lastIdxNow >= 0 && uidNum < lastIdxNow);'), '');
  // 앵커가 뒤처져도 마지막 메시지에는 범례가 남아야 한다 (켤 자리가 사라지지 않게)
  ck("'과거'는 앵커보다 작은 번호만 (idx < lastIdx)", src.includes('&& idx < lastIdx) {'), '');
  ck('버튼 토글도 스냅샷에 저장 (/액션 명령과 같은 규약)',
    src.includes("await session.store.save('out', lastOutIndex, session.current); // 무장 유지"), '');
}

const SCHEMA = {
  simcore: '0.1', meta: { name: '범례 테스트' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
  actions: [{ id: 'offstage', label: '🎬 막간', mode: 'hold', offstage: true }],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
};

// 메시지 3개: char(마커 0) · user · char(마커 2) → 마지막 out 인덱스 = 2
const MSGS = [
  { role: 'char', data: '옛 장면 ⟦simcore:0⟧' },
  { role: 'user', data: '무언가 한다' },
  { role: 'char', data: '최신 장면 ⟦simcore:2⟧' },
];

async function boot() {
  const world = {
    chars: [{ chaId: 'c-leg', name: '범례봇', globalLore: [
      { comment: src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)[1], content: JSON.stringify(SCHEMA) },
    ] }],
    chat: { id: 'ch1', message: MSGS.map((m) => ({ ...m })) },
  };
  const store = new Map();
  global.Risuai = {
    getCharacter: async () => world.chars[0],
    setCharacter: async (c) => { world.chars[0] = c; },
    getCurrentCharacterIndex: async () => 0,
    getCurrentChatIndex: async () => 0,
    getChatFromIndex: async () => world.chat,
    setChatToIndex: async (_a, _b, c) => { world.chat = c; },
    registerButton: async () => {}, unregisterUIPart: async () => {}, registerSetting: async () => {},
    addRisuReplacer: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    addRisuScriptHandler: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    registerBodyIntercepter: async () => ({ id: 'x' }),
    showContainer: async () => {}, hideContainer: async () => {}, alert: async () => {},
    setChatPanel: async () => {}, getArgument: async () => 'off',
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
  await sleep(200);
  return { store };
}

(async () => {
  await boot();
  const disp = global.__hooks?.display;
  ck('display 핸들러 등록', typeof disp === 'function', '');

  // ── 과거 메시지 (마커 0) — 캐시가 비어 있는 갓 열린 채팅 ──
  const past = String(disp('옛 장면 ⟦simcore:0⟧'));
  ck('★ 과거 메시지 — 캐시 미스여도 범례 없음 (1초 뒤 증발의 뿌리)',
    !past.includes('sim-hitact-'), past.slice(0, 120));
  ck('과거 메시지도 상태창 자체는 그린다', past.includes('sim-status'), '');

  // ── 최신 메시지 (마커 2 = lastOutIndex) — 범례가 여기 있다 ──
  const last = String(disp('최신 장면 ⟦simcore:2⟧'));
  ck('★ 최신 메시지 — 범례 있음 (조작 자리)', last.includes('sim-hitact-offstage'), last.slice(-160));
  ck('무장 전 — ✅ 없음', !last.includes('✅'), '');

  // ── 토글 후: 최신에는 ✅, 과거에는 여전히 범례 없음 ──
  // 무장은 /액션 명령으로 건다 (범례 클릭과 같은 토글 경로 — 어댑터 내부 함수는 못 부른다)
  await global.__hooks.input('/액션 offstage');
  await sleep(30);
  const last2 = String(disp('최신 장면 ⟦simcore:2⟧'));
  ck('★ 무장 후 — 최신 메시지에 발동 대기 표시', last2.includes('✅'), last2.slice(-200));
  const past2 = String(disp('옛 장면 ⟦simcore:0⟧'));
  ck('★ 무장 후에도 과거 메시지엔 범례·표시 없음', !past2.includes('sim-hitact-') && !past2.includes('✅'), '');

  // ── 스냅샷이 적재된 뒤에도 같은 결과 (깜빡임 없음) ──
  await sleep(120);
  const past3 = String(disp('옛 장면 ⟦simcore:0⟧'));
  ck('★ 캐시 적재 뒤에도 동일 — 범례가 나타났다 사라지지 않는다', !past3.includes('sim-hitact-'), '');

  try { await global.__unload?.(); } catch { /* 무관 */ }
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
