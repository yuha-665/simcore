const __P = (...p) => require('path').resolve(__dirname, ...p);
// 채팅 명령의 **응답이 유저에게 닿는가** — 가짜 리스에 붙여 input 훅을 실제로 굴린다.
//
// 배경(실측): "/날짜 이거 인풋에 치니 바로 채팅 보내지기되는데 뭔가 다른곳에 써야했나".
// 쓰는 곳은 맞았다. 어댑터가 `if (!r.applied.length) return content;`로 끊고 있어서
// **상태가 안 바뀌는 응답이 전부 버려졌다** — 도움말(`/날짜`), 오류('읽을 수 없음'),
// 거부('쿨다운'). 유저 글이 그대로 모델에게 나가니 명령을 처음 써 보는 사람은
// "명령이 안 먹는다"로 읽는다. 엔진 테스트(test-chatcmd)는 통과하고 있었다 —
// 엔진은 제대로 만들어 돌려주고 있었고, 버린 건 어댑터라서.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCHEMA = {
  simcore: '0.1', meta: { name: '명령 실부팅' },
  time: { start: '2026-03-02 08:30', advance: 'explicit', format: { date: 'M월 D일', clock: 'HH:mm' } },
  vars: [
    { id: 'gold', label: '재정', type: 'int', init: 100, min: 0, cmd: '금' },
    { id: 'skip_day', label: '건너뛴 일수', type: 'int', init: 0, min: 0, max: 30 },
    { id: 'skip_min', label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 1440 },
  ],
  actions: [{ id: 'rest', label: '🛏 휴식', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold - 1' }] }],
  // 갈림길이 하나라도 있어야 /선택이 내장으로 열린다 (없는 봇에서 가로채면 유저 글을 먹는다).
  // 조건을 영영 거짓으로 둬서 "열려는 있는데 지금은 걸린 게 없다" 상태를 만든다.
  rules: { events: [{ id: 'fork', when: 'gold >= 9999', notify: '갈림길이 나타났다', choices: [
    { label: '왼쪽', effects: [{ set: 'gold', expr: 'gold + 1' }] },
    { label: '오른쪽', effects: [{ set: 'gold', expr: 'gold - 1' }] },
  ] }] },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'gold' }] }] },
  updater: { allow: [{ id: 'gold', maxGain: 50 }] },
};

async function boot() {
  const LORE = src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)?.[1];
  const world = {
    chars: [{ chaId: 'c-sim', name: '명령봇', triggerscript: [],
      globalLore: [{ comment: LORE, content: JSON.stringify(SCHEMA) }] }],
    chats: { 'c-sim:0': { id: 'ch0', message: [{ role: 'user', data: '안녕' }] } },
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
    showContainer: async () => {}, alert: async () => {},
    getArgument: async () => 'off',
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
  return world;
}

(async () => {
  // 스키마부터 성립해야 아래 전부가 의미가 있다
  (0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
  const v = globalThis.__SC.require('validate').validateSchema(SCHEMA);
  ck('실험대 스키마가 유효하다', v.ok, JSON.stringify(v.errors));

  await boot();
  const hooks = global.__hooks ?? {};
  ck('input 훅이 등록됐다', typeof hooks.input === 'function', Object.keys(hooks).join(','));
  if (typeof hooks.input !== 'function') { report(); return; }

  const say = (t) => hooks.input(t);

  // ── ① 상태가 바뀌는 명령 — 원래도 되던 길 ──
  const okDate = await say('/날짜 2026-10-05');
  ck('★ /날짜 2026-10-05 → 확인문으로 바뀐다',
    okDate.includes('시스템: 날짜') && okDate.includes('10월 5일'), okDate);
  ck('시각을 안 적으면 원래 시각을 지킨다', okDate.includes('08:30'), okDate);

  // ── ② 상태가 안 바뀌는 응답 — 여기가 통째로 버려지고 있었다 ──
  const help = await say('/날짜');
  ck('★ /날짜만 치면 현재 날짜+사용법이 온다 (예전엔 유저 글이 그대로 나갔다)',
    help !== '/날짜' && help.includes('시스템: 날짜') && help.includes('이렇게 맞춥니다'), help);
  ck('도움말에 지금 날짜가 들어 있다', /10월 5일/.test(help), help);

  const bad = await say('/날짜 어제');
  ck('★ 못 읽는 날짜는 오류 안내가 온다', bad.includes('읽을 수 없음'), bad);

  const same = await say('/날짜 2026-10-05');
  ck('같은 날짜면 "바뀐 것 없음"도 유저에게 닿는다', same.includes('바뀐 것 없음'), same);

  const actHelp = await say('/액션');
  ck('★ /액션만 치면 켜고 끄는 법이 온다', actHelp.includes('시스템: 액션') && actHelp.includes('🛏 휴식'), actHelp);

  const pickNone = await say('/선택 1');
  ck('걸린 갈림길이 없으면 그 사실이 온다', pickNone.includes('고를 선택지가 없음'), pickNone);

  // ── ③ 우리 명령이 아닌 글은 절대 건드리지 않는다 (이 완화의 대가가 없어야 한다) ──
  for (const raw of ['/랄라 어쩌구', 'http://example.com/path', '오늘은 12/25 크리스마스', '그냥 평범한 말']) {
    ck(`남의 글은 그대로: ${raw.slice(0, 14)}`, (await say(raw)) === raw, await say(raw));
  }

  // ── ④ 한 입력에 섞여도 각 줄이 각자 답한다 ──
  const mixed = await say('/금 +30\n/날짜\n같이 가자');
  ck('★ 적용된 줄과 안내 줄이 한 입력에서 같이 나온다',
    mixed.includes('재정') && mixed.includes('이렇게 맞춥니다') && mixed.includes('같이 가자'), mixed);

  if (global.__unload) global.__unload();
  report();
})().catch((e) => { console.log('CRASH', e.message, e.stack.split('\n').slice(0, 3).join(' | ')); process.exit(1); });

function report() {
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
}
