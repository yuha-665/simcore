const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.0.5 — 개조 번들 (배포 도구). 로어북 전체+정규식을 한 파일로 묶고 한 번에 교체 적용한다.
// 계기: 원본 카드 재배포 비허가 → "원본 카드 + 개조 파일" 배포인데 리수에 일괄삭제가 없어
// 받는 쪽이 원본 로어북을 하나씩 지워야 했다. 번들 교체가 그 수작업을 없앤다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 소스 정적 확인 ──
{
  ck('버전 1.7.0', src.includes('//@version 1.7.0'), '');
  ck('display-name 동반 범프', /\/\/@display-name .*v1\.7\.0/.test(src), '');
  // v1.0.6 회귀 — 실사고: 갓 임포트한 원본 카드에서 번들 적용이 안 먹힘
  ck('적용 후 되읽기 레이스 재시도 (v0.85.1 결)', src.includes('리수 반영이 늦어요'), '');
  ck('적용 후 편집기 작업본 동기화 (세이브와 같은 규약)', src.includes('if (editor) loadIntoEditor(bundled);'), '');
  ck('되돌리기도 편집기 동기화', src.includes('validateSchema(p).ok && editor) loadIntoEditor(p);'), '');
  // v1.0.7 회귀 ① — runInstall이 스켈레톤 안에 살면 renderPanel의 배너에서 참조가 끊긴다
  // ("runInstall is not defined" 실사고). IIFE 레벨(2칸 들여쓰기) 선언을 강제한다.
  ck('runInstall은 IIFE 레벨', /\n  async function runInstall\(/.test(src), '');
  ck('installSchemaToCurrentChar도 IIFE 레벨', /\n  async function installSchemaToCurrentChar\(/.test(src), '');
  // 같은 유형 전수 검출: buildPanelSkeleton 본문 안의 함수 선언이 밖에서 불리면 실패
  {
    const start = src.indexOf('function buildPanelSkeleton()');
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
    }
    const body = src.slice(start, end);
    const inner = [...body.matchAll(/\n    (?:async )?function ([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
    const outside = src.slice(0, start) + src.slice(end);
    const leaked = inner.filter((n) => outside.includes(n + '('));
    ck(`스켈레톤 내부 함수(${inner.length}개)의 외부 참조 없음`, leaked.length === 0, leaked.join(', '));
  }
  // v1.0.7 회귀 ② — 2단 확인 15초는 안내문 읽는 사이 만료됐다 (적용 대신 파일창 재오픈)
  ck('2단 확인 60초', src.includes('Date.now() + 60000'), '');
  ck('만료 후 클릭에 안내', src.includes('확인 시간이 지나 처음부터 다시'), '');
  ck('세이브 페이지에 번들 카드', src.includes('sc-bundle-export') && src.includes('sc-bundle-apply')
    && src.includes('sc-bundle-revert'), '');
  ck('백업 키 규약', src.includes("'sim:bundle-backup:'"), '');
  ck('onUnload에서 배수구 정리', src.includes('delete globalThis.__simcoreBundle'), '');
  ck('2단 확인 (패널 안 — host alert 금지 규칙)', src.includes('한 번 더 누르면 적용'), '');
}

const SCHEMA = {
  simcore: '0.1', meta: { name: '번들 테스트' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
};

async function boot(charOverride) {
  const world = {
    chars: [charOverride ?? { chaId: 'c-sim', name: '번들 봇', triggerscript: [{ comment: '루아 브리지 자리', content: 'x' }],
      customscript: [{ comment: '원본 정규식', type: 'editdisplay', in: 'a', out: 'b' }],
      globalLore: [
        { comment: '원본 설정 1', content: '지우기 귀찮은 항목' },
        { comment: '원본 설정 2', content: '지우기 귀찮은 항목 2' },
        { comment: src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)[1], content: JSON.stringify(SCHEMA) },
      ] }],
    chats: { 'c-sim:0': { id: 'ch1', message: [] } },
  };
  const store = new Map();
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
  const { world } = await boot();
  const B = globalThis.__simcoreBundle;
  ck('배수구 노출', !!B && typeof B.bundleFromChar === 'function', '');

  // ── 내보내기 — 제작자 카드에서 번들을 뽑는다 ──
  const modded = world.chars[0];
  const bundle = B.bundleFromChar(modded, '얼헌 개조');
  ck('형식 simcoreBundle: 1', bundle.simcoreBundle === 1, '');
  ck('로어북 전체 동봉 (⚙simcore 포함)', bundle.lorebook.length === 3
    && bundle.lorebook.some((l) => l.comment === '⚙simcore'), String(bundle.lorebook.length));
  ck('정규식 동봉', bundle.regex.length === 1 && bundle.regex[0].comment === '원본 정규식', '');
  ck('깊은 복사 — 원본 참조 아님', bundle.lorebook[0] !== modded.globalLore[0], '');

  // ── 형식 검사 ──
  ck('빈 로어북 거부', !!B.bundleShapeError({ simcoreBundle: 1, lorebook: [] }), '');
  ck('일반 JSON 거부', !!B.bundleShapeError({ lorebook: [{}] }), '');
  ck('regex 없는 번들 허용 (부분 번들)', B.bundleShapeError({ simcoreBundle: 1, lorebook: [{}] }) === null, '');
  ck('정상 번들 통과', B.bundleShapeError(bundle) === null, '');

  // ── 적용 — 받는 쪽의 "원본 카드"를 흉내: 원본 항목 잔뜩 + 자기 정규식 + 브리지 자리 ──
  const receiver = {
    chaId: 'c-recv', name: '원본 카드', firstMessage: '원작 인사말',
    triggerscript: [{ comment: '받는 쪽 트리거', content: 'keep' }],
    customscript: [{ comment: '원본 상태창 정규식', type: 'editdisplay', in: 'x', out: 'y' }],
    globalLore: Array.from({ length: 40 }, (_, i) => ({ comment: `원본 ${i}`, content: 'c' })),
  };
  B.applyBundleToChar(receiver, bundle);
  ck('★ 로어북 통째 교체 — 원본 40개가 개조 3개로', receiver.globalLore.length === 3
    && receiver.globalLore.some((l) => l.comment === '⚙simcore'), String(receiver.globalLore.length));
  ck('★ 정규식 통째 교체', receiver.customscript.length === 1
    && receiver.customscript[0].comment === '원본 정규식', '');
  ck('트리거는 안 건드림 (브리지 자리)', receiver.triggerscript[0].content === 'keep', '');
  ck('인사말·이름은 원본 유지', receiver.firstMessage === '원작 인사말' && receiver.name === '원본 카드', '');

  // regex 없는 부분 번들 — 정규식은 그대로 둔다
  const receiver2 = { customscript: [{ comment: '유지' }], globalLore: [{ comment: 'x', content: 'y' }] };
  B.applyBundleToChar(receiver2, { simcoreBundle: 1, lorebook: [{ comment: 'n', content: 'v' }] });
  ck('부분 번들 — 정규식 유지', receiver2.customscript[0].comment === '유지', '');
  ck('부분 번들 — 로어북은 교체', receiver2.globalLore[0].comment === 'n', '');

  // ── 교체 후 시스템이 실제로 뜨는가 — "번들만 적용된 원본 카드"로 플러그인을 재부팅 ──
  // (⚙simcore가 로어북에 실려 온 상태에서 별도 [설치] 없이 인식되는지가 배포 경로의 핵심)
  try { await global.__unload?.(); } catch { /* 무관 */ }
  delete global.__hooks;
  await boot({ ...receiver, chaId: 'c-recv2' });
  await sleep(50);
  const disp = global.__hooks?.display;
  const html = String(disp?.('첫 장면 ⟦simcore:0⟧') ?? '');
  ck('★ 번들로 온 ⚙simcore가 곧장 인식 — 상태창 렌더', html.includes('체력'), html.slice(0, 80));

  ck('언로드 후 배수구 정리', (await (async () => { try { await global.__unload?.(); } catch { /* 무관 */ }
    return !globalThis.__simcoreBundle; })()), '');

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
