const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.0.2 — 상태창 위치 선택 (statusUI.position: bottom 기본 | top).
// 저장 마커는 항상 본문 끝 고정 (스트리밍 부분 반환·마커 복구·beforeRequest 제거가 "끝" 전제)
// — display가 렌더할 때만 top이면 마커 자리를 비우고 본문 앞에 얹는다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 소스 정적 확인 ──
{
  ck('display에 위치 분기 존재', src.includes("statusUI?.position === 'top'"), '');
  ck('★ 저장 마커는 끝 고정 — output 반환은 위치와 무관', src.includes('저장되는 마커는 항상 끝 고정'), '');
  ck('편집기 [상태창] 탭에 위치 선택 (규칙 #3)', src.includes('상태창 위치') && src.includes('본문 위 — 수치부터 보임'), '');
  ck('AI 규격서에 position 행', src.includes('`"position"`: `bottom`(기본, 본문 아래)'), '');
  ck('탭 슬라이스 subOpt에 position (왕복에 실림)', src.includes("subOpt: ['layout', 'position']"), '');
}

// ── 검증기 ──
{
  const V = SC.require('validate');
  const base = () => ({
    simcore: '0.1', meta: { name: 't' },
    vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
    statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
  });
  const ok = base(); ok.statusUI.position = 'top';
  ck('★ 검증: position top 통과', V.validateSchema(ok).errors.every((e) => e.path !== '$.statusUI.position'), '');
  const bad = base(); bad.statusUI.position = 'middle';
  ck("★ 검증: '중단' 같은 값은 오류 (기준을 정의할 수 없다)",
    V.validateSchema(bad).errors.some((e) => e.path === '$.statusUI.position'), '');
  ck('검증: position 없으면 무언 (16종 템플릿 오탐 0의 근거)',
    V.validateSchema(base()).errors.every((e) => e.path !== '$.statusUI.position'), '');
}

// ── 가짜 리스 실부팅 — display가 실제로 어디에 그리나 ──
const mkState = (hp, turn) => JSON.stringify({
  vars: { hp },
  meta: { turn, setupDone: true, armed: {}, actionLastUsed: {}, eventLastFired: {}, firedOnce: {}, pendingNotifies: [] },
});

async function boot(position) {
  const SCHEMA = {
    simcore: '0.1', meta: { name: '위치 테스트' },
    vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
    statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }],
      ...(position ? { position } : {}) },
  };
  const LORE = src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)[1];
  const world = {
    chars: [{ chaId: 'c-sim', name: '위치 봇', triggerscript: [],
      globalLore: [{ comment: LORE, content: JSON.stringify(SCHEMA) }] }],
    chats: { 'c-sim:0': { id: 'ch1', message: [{ role: 'char', data: '첫 장면 ⟦simcore:0⟧' }] } },
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
  return global.__hooks.display;
}

(async () => {
  // 기본(bottom): 마커 자리를 그대로 치환 — 본문이 먼저, 상태창이 뒤
  {
    const disp = await boot(null);
    const out = String(disp('첫 장면 ⟦simcore:0⟧'));
    ck('★ 기본: 상태창이 본문 뒤 (마커 자리 치환)', out.startsWith('첫 장면') && /50</.test(out), out.slice(0, 60));
    ck('기본: 마커는 화면에서 사라진다', !out.includes('⟦simcore:'), '');
    try { await global.__unload?.(); } catch { /* 정리 실패 무관 */ }
  }
  // top: 마커 자리는 비우고 상태창이 본문 앞
  {
    const disp = await boot('top');
    const out = String(disp('첫 장면 ⟦simcore:0⟧'));
    const iBody = out.indexOf('첫 장면'), iHp = out.search(/50</);
    ck('★ top: 상태창이 본문 앞', iHp >= 0 && iBody > iHp, out.slice(0, 60));
    ck('top: 본문은 그대로 살아 있다', iBody >= 0, '');
    ck('top: 마커는 화면에서 사라진다', !out.includes('⟦simcore:'), '');
    ck('top: 마커 없는 글은 건드리지 않는다', String(disp('그냥 지문')) === '그냥 지문', '');
    try { await global.__unload?.(); } catch { /* 정리 실패 무관 */ }
  }

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
