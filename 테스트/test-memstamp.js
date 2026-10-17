const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.18.3 — 장기기억 요약에 이야기 속 시각 (커뮤니티 제보 2026-10-17).
// 증상: HypaPlus(20~30턴마다 요약)가 만든 기억의 "시간:"이 "미정"이거나 모델이 지어낸 날짜.
// 뿌리: 요약기는 채팅 원문을 모아 'memory' 요청으로 보낸다(HypaPlus·HypaMinus = getChatFromIndex 원문 + runLLMModel memory,
//       내장 HypaV3 = requestChatData memory). 원문엔 날짜가 없다 — 상태창은 화면 전용, 상태 블록은 그 턴의 메인 요청에만 실린다.
//       우리 beforeRequest는 전 타입에서 ⟦simcore:N⟧을 지워 그 시점 스냅샷 번호마저 요약기에 안 갔다.
// 해법: 'memory' 요청에서만 마커를 그 응답의 시각 도장으로 바꾼다 — 시작 = pre:N-1, 끝 = out:N.
// 여기서 못 박는 것:
//   · 도장 서식 — 같은 날 / 날짜가 바뀜(MM-DD) / 해가 바뀜 / 시계가 앞으로 안 감(끝 하나) / 시작을 모름(끝 하나)
//   · 시계를 안 보이는 봇(하루 단위 — 베리디아식 expose)은 날짜만 — 종일 08:00인 시계를 밤 장면에 찍지 않는다
//   · HypaPlus식(원문을 빈 줄로 이은 한 통)·HypaV3식(role: 줄) 둘 다
//   · 스냅샷이 없거나 시계가 없는 스냅샷·잘린 꼬리는 종전대로 지운다 — 남는 ⟦simcore 없음
//   · ★ memory가 아닌 요청(model·translate·submodel·emotion·otherAx)엔 도장이 안 간다 — 종전대로 지운다
//   · 시간 체계가 없는 봇은 종전대로 지운다 / 재시도(두 번 거침)에도 같은 글 / 어떤 입력에도 던지지 않는다
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const adapter = fs.readFileSync(__P('../adapter/risu-plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 소스 정적 확인 ──
{
  ck('★ memory 요청만 도장을 찍는다 (타입 가드)', /if \(type === 'memory'\) \{\s*try \{\s*const n = await stampMemoryRequest\(messages\);/.test(src), '');
  ck('★ 도장이 공통 제거보다 먼저 (지운 뒤엔 번호가 없다)',
    src.indexOf('await stampMemoryRequest(messages)') > 0
    && src.indexOf('await stampMemoryRequest(messages)') < src.indexOf("if (m && typeof m.content === 'string') m.content = stripMarkers(m.content);"), '');
  ck('도장 실패는 삼킨다 (beforeRequest는 try 바깥 — 던지면 앱의 모든 요청이 죽는다)',
    /catch \(e\) \{ console\.log\('\[simcore\] 요약 시각 도장 실패:'/.test(src), '');
  ck('버전이 v1.18.3 이상', /\/\/@version 1\.(18\.([3-9]|\d\d)|(19|[2-9]\d)\.\d+)/.test(adapter), '');
  ck('체인지로그에 v1.18.3 항목', adapter.includes('── v1.18.3 ─'), '');
}

// flat30 달력의 epoch(분) — core/time.js epochFrom과 같은 식
const E = (y, m, d, h = 0, mi = 0) => (((y - 1) * 360 + (m - 1) * 30 + (d - 1)) * 1440) + h * 60 + mi;

const SCHEMA = {
  simcore: '0.1', meta: { name: '요약 시각 테스트' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
  updater: { allow: [{ id: 'hp' }] },
  time: { calendar: 'flat30', start: '1499-03-01 08:00' },
  promptState: { template: '지금: {date} {clock}' },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
};
const SCHEMA_NO_TIME = { ...SCHEMA, meta: { name: '시간 없는 봇' }, time: undefined, promptState: { template: '체력 {hp}' } };
const mkState = (epoch, turn = 1) => JSON.stringify({
  vars: epoch == null ? { hp: 50 } : { hp: 50, time_epoch: epoch },
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
  const store = new Map([['sim:c-sim:ch1:out:0', mkState(E(1499, 3, 1, 8, 0), 1)]]);
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

const LORE = src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)[1];
const left = (msgs) => msgs.some((x) => /⟦simcore/.test(String(x.content)));
const SUMMARY_PROMPT = '# Roleplay Log\n\n{{slot}}\n\n시간: YYYY-MM-DD HH:mm';

(async () => {
  const { world, store } = await boot();
  const hooks = global.__hooks ?? {};
  world.chars[0].globalLore = [{ comment: LORE, content: JSON.stringify(SCHEMA) }];
  ck('훅이 실제로 걸렸다', typeof hooks.beforeRequest === 'function' && typeof hooks.output === 'function', Object.keys(hooks).join(','));

  // 세션을 세운다 — 한 턴 굴린다 (out:2는 램 캐시 histStates로도 들어간다)
  await hooks.beforeRequest([{ role: 'user', content: '진행' }], 'model');
  world.chats['c-sim:0'].message.push({ role: 'char', data: '' });
  world.chats['c-sim:0'].message[2].data = await hooks.output('He stepped closer.');
  await global.__simcoreDrainTurn();
  ck('턴이 마커를 남겼다', /⟦simcore:2⟧$/.test(world.chats['c-sim:0'].message[2].data), JSON.stringify(world.chats['c-sim:0'].message[2].data));
  const callsAfterTurn = world.llmCalls;

  // 지난 턴들의 스냅샷 — 저장소에 직접 (keepN 정리 전 상태를 흉내)
  const put = (phase, i, epoch) => store.set(`sim:c-sim:ch1:${phase}:${i}`, mkState(epoch));
  put('pre', 3, E(1499, 3, 1, 8, 30)); put('out', 4, E(1499, 3, 1, 11, 30));      // 같은 날
  put('pre', 5, E(1499, 3, 1, 22, 0)); put('out', 6, E(1499, 3, 4, 9, 0));        // 날짜가 바뀜
  put('out', 8, E(1499, 3, 4, 10, 0));                                            // 시작(pre:7)을 모름
  put('pre', 9, E(1499, 12, 30, 23, 0)); put('out', 10, E(1500, 1, 1, 7, 0));     // 해가 바뀜
  put('pre', 11, E(1499, 3, 10, 18, 0)); put('out', 12, E(1499, 3, 2, 8, 0));     // ⏪ 되감기 — 뒤로 감
  // 14 = 스냅샷 없음(정리됨) / 16 = 시계가 없는 스냅샷
  put('pre', 15, null); put('out', 16, null);

  const W = {
    2: '[Story time: 1499-03-01 08:00]',                      // 실제 턴 — 시계가 안 갔다 (pre:1 = out:2 = 시작 시각)
    4: '[Story time: 1499-03-01 08:30 → 11:30]',
    6: '[Story time: 1499-03-01 22:00 → 03-04 09:00]',
    8: '[Story time: 1499-03-04 10:00]',
    10: '[Story time: 1499-12-30 23:00 → 1500-01-01 07:00]',
    12: '[Story time: 1499-03-02 08:00]',
  };
  const LOG = [
    ['user', '진행'], ['char', 'He stepped closer.\n\n⟦simcore:2⟧'],
    ['user', '성으로 간다'], ['char', '성에 닿았다.\n\n⟦simcore:4⟧'],
    ['user', '잔다'], ['char', '사흘을 앓았다.\n\n⟦simcore:6⟧'],
    ['user', '일어난다'], ['char', '창밖이 밝다.\n\n⟦simcore:8⟧'],
    ['user', '해를 넘긴다'], ['char', '새해가 왔다.\n\n⟦simcore:10⟧'],
    ['user', '죽는다'], ['char', '그 아침으로 돌아왔다.\n\n⟦simcore:12⟧'],
    ['user', '오래전'], ['char', '정리된 턴.\n\n⟦simcore:14⟧'],
    ['user', '시계 없음'], ['char', '옛 세이브.\n\n⟦simcore:16⟧'],
    ['user', '끊김'], ['char', '스트리밍이 잘렸다.\n\n⟦simcore:'],
  ];

  // ── ① HypaPlus·HypaMinus식 — 원문을 빈 줄로 이어 한 통 (runLLMModel memory) ──
  {
    const text = LOG.map(([, t]) => t).join('\n\n');
    const sent = await hooks.beforeRequest([{ role: 'user', content: SUMMARY_PROMPT.replace('{{slot}}', text) }], 'memory');
    const out = sent[0].content;
    for (const [i, w] of Object.entries(W)) ck(`★ 응답 ${i}의 도장 ${w}`, out.includes(w), out.slice(0, 400));
    ck('★ 도장은 그 응답 바로 뒤 — 본문과 다음 유저 글 사이', out.includes('성에 닿았다.\n\n[Story time: 1499-03-01 08:30 → 11:30]\n\n잔다'), '');
    ck('★ 스냅샷 없는 마커·시계 없는 스냅샷·잘린 꼬리는 종전대로 지운다 — ⟦simcore 없음', !left(sent), JSON.stringify(out.slice(-120)));
    ck('정리된 턴엔 도장을 지어내지 않는다', out.includes('정리된 턴.\n\n시계 없음') && out.includes('옛 세이브.\n\n끊김'), JSON.stringify(out.slice(-160)));
    ck('도장 개수 = 찾은 스냅샷 수 (6)', (out.match(/\[Story time: /g) ?? []).length === 6, String((out.match(/\[Story time: /g) ?? []).length));
    ck('요약 요청에 아무것도 얹지 않는다 (메시지 수 그대로)', sent.length === 1, String(sent.length));
    ck('요약은 우리 턴을 넘기지 않는다 (보조 호출 0회 추가)', world.llmCalls === callsAfterTurn, `${world.llmCalls}`);
    const again = await hooks.beforeRequest([{ role: 'user', content: out }], 'memory');
    ck('재시도(두 번 거침)에도 같은 글', again[0].content === out, '');
  }

  // ── ② 내장 HypaV3식 — "role: 내용" 줄 + 시스템 프롬프트 (requestChatData memory) ──
  {
    const text = LOG.slice(0, 6).map(([r, t]) => `${r === 'char' ? 'assistant' : 'user'}: ${t}`).join('\n');
    const sent = await hooks.beforeRequest([
      { role: 'user', content: text },
      { role: 'system', content: '[Summarize the ongoing role story]' },
    ], 'memory');
    ck('★ HypaV3식에도 도장', sent[0].content.includes('assistant: 성에 닿았다.\n\n[Story time: 1499-03-01 08:30 → 11:30]\nuser: 잔다'), JSON.stringify(sent[0].content.slice(0, 200)));
    ck('시스템 프롬프트는 그대로', sent[1].content === '[Summarize the ongoing role story]', '');
  }

  // ── ③ memory가 아닌 요청엔 도장이 안 간다 — 종전대로 지운다 ──
  for (const t of ['model', 'translate', 'submodel', 'emotion', 'otherAx', undefined]) {
    const sent = await hooks.beforeRequest([{ role: 'user', content: '성에 닿았다.\n\n⟦simcore:4⟧' }], t);
    const c = sent.map((x) => x.content).join('\n');
    ck(`★ ${t} 요청엔 도장 없음 + 마커는 지운다`, !c.includes('Story time') && !/⟦simcore/.test(c), JSON.stringify(c.slice(0, 120)));
  }
  ck('메인(턴 아닌 model 요청)도 우리 턴을 안 넘겼다', world.llmCalls === callsAfterTurn, `${world.llmCalls}`);

  // ── ④ 어떤 입력에도 던지지 않는다 ──
  {
    let threw = null;
    try {
      await hooks.beforeRequest([null, { role: 'user' }, { role: 'user', content: 42 }, { role: 'user', content: '⟦simcore:abc⟧ ⟦simcore:999999⟧' }], 'memory');
      await hooks.beforeRequest([], 'memory');
    } catch (e) { threw = e; }
    ck('★ 이상한 입력에도 안 던진다', threw === null, String(threw?.message ?? ''));
  }

  // ── ⑤ 시간 체계가 없는 봇 — 종전대로 지운다 ──
  {
    world.chars[0].globalLore = [{ comment: LORE, content: JSON.stringify(SCHEMA_NO_TIME) }];
    world.chats['c-sim:0'] = { id: 'ch2', message: [{ role: 'char', data: '첫 장면 ⟦simcore:0⟧' }] };
    store.set('sim:c-sim:ch2:out:0', mkState(null));
    await hooks.beforeRequest([{ role: 'user', content: '...' }], 'model');   // 채팅이 바뀌었다 — 세션을 다시 세운다 (마지막이 char라 턴 아님)
    const sent = await hooks.beforeRequest([{ role: 'user', content: '첫 장면\n\n⟦simcore:0⟧' }], 'memory');
    ck('★ 시간 체계가 없으면 도장 없이 지운다', sent[0].content === '첫 장면', JSON.stringify(sent[0].content));
  }

  // ── ⑥ 시계를 안 보이는 봇 (하루 단위 — 베리디아식 expose) — 날짜만 ──
  // 그 봇의 시계는 하루 종일 시작 시각(08:00)에 서 있다 — 밤 장면에 08:00을 찍으면 그게 지어낸 시각이다
  {
    const DATE_ONLY = { ...SCHEMA, meta: { name: '하루 단위 봇' },
      time: { ...SCHEMA.time, expose: ['date', 'season', 'year', 'month', 'dom', 'elapsed'] }, promptState: { template: '{date}' } };
    world.chars[0].globalLore = [{ comment: LORE, content: JSON.stringify(DATE_ONLY) }];
    world.chats['c-sim:0'] = { id: 'ch3', message: [{ role: 'char', data: '첫 장면 ⟦simcore:0⟧' }] };
    store.set('sim:c-sim:ch3:out:0', mkState(E(1499, 3, 1, 8, 0)));
    const put3 = (phase, i, epoch) => store.set(`sim:c-sim:ch3:${phase}:${i}`, mkState(epoch));
    put3('pre', 1, E(1499, 3, 2, 8, 0)); put3('out', 2, E(1499, 3, 2, 8, 0));     // 같은 날 (밤 장면이어도 시계는 08:00)
    put3('pre', 3, E(1499, 3, 2, 8, 0)); put3('out', 4, E(1499, 3, 3, 8, 0));     // 하루 닫기
    put3('pre', 5, E(1499, 12, 30, 8, 0)); put3('out', 6, E(1500, 1, 1, 8, 0));   // 해가 바뀜
    await hooks.beforeRequest([{ role: 'user', content: '...' }], 'model');
    const sent = await hooks.beforeRequest([{ role: 'user', content: '밤이 깊었다.\n\n⟦simcore:2⟧\n\n잔다\n\n아침이다.\n\n⟦simcore:4⟧\n\n넘긴다\n\n새해.\n\n⟦simcore:6⟧' }], 'memory');
    const c = sent[0].content;
    ck('★ 시계 없는 봇: 같은 날은 날짜 하나 (08:00 안 찍음)', c.includes('밤이 깊었다.\n\n[Story time: 1499-03-02]\n\n'), JSON.stringify(c));
    ck('★ 시계 없는 봇: 날짜가 바뀌면 → MM-DD', c.includes('[Story time: 1499-03-02 → 03-03]'), JSON.stringify(c));
    ck('시계 없는 봇: 해가 바뀌면 → YYYY-MM-DD', c.includes('[Story time: 1499-12-30 → 1500-01-01]'), JSON.stringify(c));
    ck('시계 없는 봇: 어디에도 HH:mm이 없다', !/\d{2}:\d{2}/.test(c), JSON.stringify(c));
  }

  const p = R.filter(([c]) => c).length; const f = R.length - p;
  for (const [c, n, x] of R) console.log(`${c ? '✓' : '✗'} ${n}${!c && x ? '  :: ' + x : ''}`);
  console.log(`\n${p} passed, ${f} failed`);
  if (global.__unload) { try { await global.__unload(); } catch {} }
  process.exit(f ? 1 : 0);
})();
