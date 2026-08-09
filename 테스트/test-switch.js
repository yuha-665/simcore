const __P = (...p) => require('path').resolve(__dirname, ...p);
// 캐릭터/채팅 전환 감지 — 가짜 Risuai를 물려 어댑터 전체를 실제로 부팅시킨다.
// "설치는 끝났는데 패널을 한 번 열어야 붙는" 문제가 실제로 사라졌는지 확인하는 게 목적.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 소스 정적 확인 (배선이 실제로 들어갔는가) ──
{
  ck('전환 감지 타이머가 존재', /setInterval\(switchTick, \d+\)/.test(src), '');
  ck('★ 턴 중에는 세션을 갈아끼우지 않는다', src.includes('if (turnBusy && Date.now() - turnBusyAt'), '');
  ck('★ 취소된 턴은 스스로 풀린다 (플래그 영구 잠김 방지)', src.includes('turnBusy = false;\n    const sig'), '');
  ck('★ output이 실패해도 플래그를 푼다', /finally \{\n      turnBusy = false;/.test(src), '');
  ck('★ 언로드 시 타이머 정리', src.includes('clearInterval(switchTimer)'), '');
  ck('부팅 직후 중복 로드를 하지 않는다', !src.includes('await switchTick();'), '');
  ck("'스키마 없음'은 재시도하지 않는다 (폴링 낭비 방지)",
    src.includes("panelStatus.state !== 'no-char'"), '');
}

// ── 가짜 리스에 붙여 실제로 굴린다 ──
async function boot() {
  const log = [];
  const world = {
    chaIdx: 0, chatIdx: 0,
    chars: [
      { chaId: 'c-plain', name: '스키마 없는 봇', globalLore: [], triggerscript: [] },
      { chaId: 'c-sim', name: '심코어 봇', globalLore: [], triggerscript: [] },
    ],
    chats: { 'c-plain:0': { id: 'ch0', message: [] }, 'c-sim:0': { id: 'ch1', message: [] }, 'c-sim:1': { id: 'ch2', message: [] } },
  };
  const buttons = new Map();
  const store = new Map();
  const cur = () => world.chars[world.chaIdx];
  const curChat = () => world.chats[`${cur().chaId}:${world.chatIdx}`] ?? { id: 'x', message: [] };

  global.Risuai = {
    getCharacter: async () => (world.ready ? cur() : null),
    setCharacter: async (c) => { world.chars[world.chaIdx] = c; },
    getCurrentCharacterIndex: async () => world.chaIdx,
    getCurrentChatIndex: async () => world.chatIdx,
    getChatFromIndex: async () => curChat(),
    setChatToIndex: async (_a, _b, c) => { world.chats[`${cur().chaId}:${world.chatIdx}`] = c; },
    registerButton: async (o) => { buttons.set(o.id ?? o.name, o); log.push('btn+' + (o.id ?? o.name)); },
    unregisterUIPart: async (id) => { buttons.delete(id); log.push('btn-' + id); },
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
  // 어댑터는 DOM을 만지지만 우리는 훅/버튼만 본다 — 최소 스텁
  const el = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    children: [], appendChild() {}, append() {}, remove() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : undefined), set: () => true });
  global.document = { createElement: el, getElementById: () => null, body: el(),
    querySelector: () => null, querySelectorAll: () => [], head: el(), addEventListener() {} };
  global.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };

  world.ready = true;
  (0, eval)(src);                    // 플러그인 전체를 실제로 부팅
  await sleep(120);                  // 부팅 await 체인 소화
  return { world, buttons, log, store };
}

// v0.55: 우상단에 붙는 건 이제 액션 버튼이 아니라 게임 패널 유틸 버튼(편성표)이다.
// "전환만으로 UI가 붙는가"라는 검증 목적은 같고, 관측 대상만 바뀌었다.
const SCHEMA = {
  simcore: '0.1', meta: { name: '전환 테스트' },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 },
    { id: 'front', label: '전위', type: 'enum', init: '없음', enum: ['없음', '아린'] },
  ],
  actions: [{ id: 'heal', label: '💊 회복', mode: 'oneshot', effects: [{ set: 'hp', expr: 'min(100, hp + 10)' }] }],
  party: { label: '편성', icon: '⚔️', empty: '없음', slots: [{ var: 'front' }] },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
  setup: { presets: [{ id: 'hardmode', label: '어려움', set: { hp: 5 } }] },
};

(async () => {
  const { world, buttons, store } = await boot();

  // ⚙️ 진입 버튼은 항상 있다 — 유틸(게임 패널) 버튼만 센다
  const utilBtns = () => [...buttons.keys()].filter((k) => k !== 'SimCore');
  ck('스키마 없는 캐릭터에서는 유틸 버튼이 없다', utilBtns().length === 0, utilBtns().join(','));
  ck('진입 버튼(⚙️)은 스키마와 무관하게 항상 있다', buttons.has('SimCore'), [...buttons.keys()].join(','));

  // 심코어 봇에 스키마를 심고 그쪽으로 "전환"만 한다 (메시지 전송도, 패널 열기도 하지 않는다)
  const LORE = src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)?.[1]
    ?? src.match(/SCHEMA_LORE_COMMENT\s*=\s*"([^"]+)"/)?.[1];
  ck('스키마 로어북 주석 상수를 찾았다', !!LORE, String(LORE));
  world.chars[1].globalLore = [{ comment: LORE, content: JSON.stringify(SCHEMA) }];
  world.chaIdx = 1;

  await sleep(2200);                 // 폴링 한 주기 이상
  ck('★ 전환만 했는데 편성표 버튼이 붙는다 (메시지 전송·패널 열기 없이)',
    buttons.has('simcore:util:party'), [...buttons.keys()].join(','));
  ck('액션별 플로팅 버튼은 더 이상 안 붙는다 (v0.55 제거 확인)',
    ![...buttons.keys()].some((k) => /heal/.test(k)), [...buttons.keys()].join(','));

  // 같은 캐릭터의 다른 채팅으로 이동 → 세션이 새로 잡혀야 한다
  const before = [...buttons.keys()].join(',');
  world.chatIdx = 1;
  await sleep(2200);
  ck('★ 채팅을 바꿔도 버튼이 유지된다 (세션 재로드 성공)',
    buttons.has('simcore:util:party'), [...buttons.keys()].join(',') + ' (이전: ' + before + ')');

  // ── 새 시작 프리셋의 캐릭터 저장 (v0.85.2) ──
  // 실사고: 패널에서 리얼리티를 골랐는데 **새 채팅**을 만들자 초기값으로 시작했다.
  // 선택은 캐릭터에 저장되고, 턴 0인 새 세션이 잡힐 때마다 자동 적용되어야 한다.
  store.set('sim:start-preset:c-sim', 'hardmode');
  world.chats['c-sim:2'] = { id: 'ch3', message: [{ role: 'char', data: '첫인사 ⟦simcore:0⟧' }] };
  world.chatIdx = 2;
  await sleep(2200);
  const html = global.__hooks?.display?.('⟦simcore:0⟧') ?? '';
  ck('★ 저장된 프리셋이 새 채팅 턴 0에 자동 적용된다 (hp 50→5)',
    /5</.test(String(html)) && !/50</.test(String(html)), String(html).slice(0, 200));
  // 없는 프리셋 id가 저장돼 있으면 조용히 무시한다 (스키마 교체 대비)
  store.set('sim:start-preset:c-sim', 'ghost-preset');
  world.chats['c-sim:3'] = { id: 'ch4', message: [{ role: 'char', data: '첫인사 ⟦simcore:0⟧' }] };
  world.chatIdx = 3;
  await sleep(2200);
  const html2 = global.__hooks?.display?.('⟦simcore:0⟧') ?? '';
  ck('스키마에 없는 저장 프리셋은 무시된다 (초기값 유지)', /50</.test(String(html2)), String(html2).slice(0, 200));

  // 스키마 없는 캐릭터로 돌아가면 버튼이 걷힌다
  world.chaIdx = 0; world.chatIdx = 0;
  await sleep(2200);
  ck('★ 스키마 없는 캐릭터로 돌아가면 버튼이 걷힌다',
    !buttons.has('simcore:util:party'), [...buttons.keys()].join(','));

  // 폴링이 실제로 멈추는가
  if (global.__unload) global.__unload();
  const n1 = buttons.size;
  world.chaIdx = 1;
  await sleep(2200);
  ck('언로드 후에는 폴링이 멈춘다', buttons.size === n1, `${n1} → ${buttons.size}`);

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
