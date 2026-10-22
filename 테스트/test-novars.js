const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.15.1 — 변수·상태창은 필수가 아니다 (커뮤니티: "한번 만들어지면 제거하는 법이 없다").
//
// 막고 있던 셋을 못 박는다:
//   ① 검증 — 변수 0개 통과 조건이 v0.64의 "에셋 팩·행동 제안"에 멈춰 있었다. 켜진 절이 하나라도 있으면 통과, 아무것도 없을 때만
//      오류이고 그 오류문이 [캐릭터에서 제거]를 가리킨다.
//   ② 상태창 — statusUI.mode 'off'가 검증 한 줄에만 있고 render·편집기가 몰랐다. 이제 render는 빈 문자열, 편집기엔 선택지.
//   ③ 제거 — [캐릭터에서 제거] 뒤 설치본 없는 캐릭터의 display가 ⟦simcore:N⟧을 날것으로 두던 것. 이제 숨긴다 (저장본은 그대로).
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema, activeSections, varFreeWork } = SC.require('validate');
const { renderStatusHtml } = SC.require('render');
const { schemaIsBlank } = SC.require('editor');
const eng = SC.require('engine');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (extra) => ({ simcore: '0.1', meta: { name: '변수 없음' }, vars: [], ...extra });

(async () => {
  console.log('── ① 검증: 변수 0개 + 켜진 절 하나면 설치 통과');
  {
    // 절마다 하나씩 — 각 절의 최소 모양. 다른 검증(그 절의 필수 칸)에 걸리면 $.vars가 아닌 다른 경로의 오류다
    const cases = [
      ['에셋 팩', { assets: { by: 'aux', packs: [{ id: 'p', source: '모듈', sep: '_', format: '<img="{name}">', slots: [{ id: 'who', values: ['A'] }] }] } }],
      ['행동 제안', { suggest: { count: 3 } }],
      ['게시판', { board: { label: '마을 게시판' } }],
      ['시나리오', { scenario: { acts: [{ id: 'a1', label: '1막', text: '시작' }] } }],
      ['비밀', { secrets: [{ id: 's1', kind: 'person', label: '과거', about: '아린', tiers: [{ text: '비밀 1' }] }] }],
      ['무대 뒤', { fronts: [{ id: 'f1', label: '교단', max: 100, signs: [], steps: [] }] }],
      ['되감기', { checkpoint: { notify: '그 아침으로' } }],
      ['시간', { time: { mode: 'auto', start: '2026-01-01 08:00' } }],
      ['지시문', { directives: [{ id: 'd1', when: 'true', text: '늘 존댓말' }] }],
      ['액션', { actions: [{ id: 'rest', label: '쉬기', mode: 'oneshot', inject: '쉰다' }] }],
      ['이벤트', { rules: { events: [{ id: 'e1', when: 'true', notify: '비가 온다', once: true }] } }],
      ['랜덤 사건', { rules: { randomEvents: { chance: 0.2, table: [{ id: 'r1', weight: 1, text: '우박' }] } } }],
    ];
    for (const [label, extra] of cases) {
      const v = validateSchema(base(extra));
      const varsErr = v.errors.filter((e) => e.path === '$.vars');
      ck(`${label}만 켠 봇 — $.vars 오류 없음 (경고로 알린다)`, !varsErr.length && v.warnings.some((w) => w.path === '$.vars' && w.msg.includes(label)),
        JSON.stringify({ errs: v.errors.slice(0, 3), warns: v.warnings.filter((w) => w.path === '$.vars') }));
      ck(`  activeSections에 '${label}'`, activeSections(base(extra)).includes(label) && varFreeWork(base(extra)), activeSections(base(extra)).join(','));
    }
    const multi = activeSections(base({ suggest: { count: 2 }, scenario: { acts: [{ id: 'a', label: 'a', text: 't' }] }, secrets: [{ id: 's', tiers: [] }] }));
    ck('여러 절이면 전부 이름표에', multi.join('·') === '행동 제안·시나리오·비밀', multi.join('·'));
    ck('변수에 기대는 절(onTurn·허용 목록·상태창 그룹)은 이름표가 아니다',
      activeSections(base({ rules: { onTurn: [{ set: 'hp', value: 1 }] }, updater: { allow: [{ id: 'hp' }] }, statusUI: { groups: [{ label: 'x', items: [] }] } })).length === 0, '');
    ck('빈 목록·빈 객체·배열 아닌 값은 안 센다',
      activeSections(base({ shops: [], scenario: { acts: [] }, secrets: 'x', fronts: null, liveChoices: [] })).length === 0, '');
    ck('깨진 입력에도 안 던진다', activeSections(null).length === 0 && activeSections('x').length === 0, '');
  }
  console.log('── ① 검증: 아무것도 없으면 오류 + 제거 안내');
  {
    const v = validateSchema(base({}));
    const e = v.errors.find((x) => x.path === '$.vars');
    ck('변수도 켜진 절도 없으면 $.vars 오류', !v.ok && !!e, JSON.stringify(v.errors));
    ck('★ 오류문이 [캐릭터에서 제거]를 가리킨다 (심코어를 빼려는 사람에게)', !!e && /캐릭터에서 제거/.test(e.msg) && /변수도 켜진 기능도 없음/.test(e.msg), e && e.msg);
    ck('편집기 검증 리포트가 그 문구로 첫 안내 블록을 세운다', src.includes("String(e.msg || '').includes('변수도 켜진 기능도 없음')") && !src.includes("includes('변수가 하나도 정의되지 않음')"), '');
    ck('첫 안내 블록 문구 — 변수는 필수가 아니다 + 제거 길', src.includes('변수를 만들거나 기능을 켜 주세요') && src.includes('[캐릭터 설치 관리]의 [캐릭터에서 제거]'), '');
    const v2 = validateSchema(base({ vars: [{ id: 'hp', label: 'HP', type: 'int', init: 1 }] }));
    ck('변수가 있으면 $.vars 경고·오류 없음 (예전 그대로)', !v2.errors.some((x) => x.path === '$.vars') && !v2.warnings.some((x) => x.path === '$.vars'), '');
  }
  console.log('── ① 편집기 빈 변수 탭 · schemaIsBlank');
  {
    ck('빈 변수 탭 문구 — 켜진 절을 이름으로', src.includes('만 쓰는 봇이에요`') && src.includes("'변수는 필수가 아니에요 — 기억할 값을 만들거나"), '');
    ck('옛 문구는 화면 코드에서 사라졌다 (체인지로그 인용만 남는다)', !src.includes("'게임에서 기억할 값 하나를 먼저 만들어 주세요.'") && !src.includes("'변수 없이 에셋만 쓰는 봇이에요'"), '');
    ck('만드는 순서 띠도 말한다', src.includes('변수는 필수가 아니에요\'));') || src.includes('· 변수는 필수가 아니에요'), '');
    ck('schemaIsBlank: 시나리오만 있는 봇은 빈 봇이 아니다', schemaIsBlank(base({ scenario: { acts: [{ id: 'a', label: 'a', text: 't' }] } })) === false, '');
    ck('schemaIsBlank: 게시판만 · 비밀만 · 시간만도', !schemaIsBlank(base({ board: {} })) && !schemaIsBlank(base({ secrets: [{ id: 's' }] })) && !schemaIsBlank(base({ time: {} })), '');
    ck('schemaIsBlank: 정말 빈 것은 빈 봇', schemaIsBlank(base({})) === true && schemaIsBlank(null) === true, '');
  }

  console.log('── ② 상태창 표시하지 않기');
  {
    const S = base({ vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
      statusUI: { mode: 'off', groups: [{ label: '상태', items: [{ var: 'hp' }] }] } });
    const st = eng.initState(S);
    ck('★ mode off → render가 빈 문자열', renderStatusHtml(S, st, null, null, { includeStyle: true, uid: 'x' }) === '', renderStatusHtml(S, st).slice(0, 80));
    const S2 = { ...S, statusUI: { ...S.statusUI, mode: 'auto' } };
    ck('같은 스키마 mode auto면 그려진다', /체력/.test(renderStatusHtml(S2, st)), '');
    const v = validateSchema(S);
    ck('off도 검증 통과 (그룹은 남아 있어 다시 켜면 그대로)', v.ok, JSON.stringify(v.errors));
    ck('편집기 구성 방식 선택지에 [표시하지 않기]', src.includes("['off', '표시하지 않기 — 채팅에 상태창을 안 그려요']"), '');
    ck('미리보기가 끈 상태를 말한다', src.includes("if (schema.statusUI?.mode === 'off') {") && src.includes('상태창을 표시하지 않기로 했어요'), '');
    ck("표시 방식 문구 '표시 안 함'", src.includes("ui.mode === 'off' ? '표시 안 함'"), '');
  }

  console.log('── ③ 제거 뒤 display: 설치본 없는 캐릭터의 마커를 숨긴다 (가짜 리수)');
  {
    const world = {
      chars: [{ chaId: 'c-none', name: '심코어 없는 봇', triggerscript: [], globalLore: [] }],
      chats: { 'c-none:0': { id: 'ch1', message: [{ role: 'char', data: '옛 장면 ⟦simcore:3⟧' }] } },
    };
    const store = new Map();
    global.Risuai = {
      getCharacter: async () => world.chars[0], setCharacter: async (c) => { world.chars[0] = c; },
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
      getChatFromIndex: async () => world.chats['c-none:0'], setChatToIndex: async (_a, _b, c) => { world.chats['c-none:0'] = c; },
      registerButton: async () => {}, unregisterUIPart: async () => {}, registerSetting: async () => {},
      addRisuReplacer: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
      addRisuScriptHandler: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
      registerBodyIntercepter: async () => ({ id: 'x' }), showContainer: async () => {}, alert: async () => {},
      getArgument: async (k) => (k === 'aux_model_mode' ? 'aux' : 'off'), onUnload: async () => {},
      runLLMModel: async () => ({ type: 'success', result: '{}' }),
      pluginStorage: { getItem: async (k) => (store.has(k) ? store.get(k) : null), setItem: async (k, v) => { store.set(k, v); }, removeItem: async (k) => { store.delete(k); }, keys: async () => [...store.keys()] },
    };
    const el = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
      children: [], appendChild() {}, append() {}, remove() {}, setAttribute() {}, addEventListener() {},
      querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : undefined), set: () => true });
    global.document = { createElement: el, getElementById: () => null, body: el(), querySelector: () => null, querySelectorAll: () => [], head: el(), addEventListener() {} };
    global.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
    (0, eval)(src);
    await sleep(200);
    const display = global.__hooks?.display;
    ck('display 훅이 걸렸다', typeof display === 'function', '');
    if (display) {
      ck('★ 설치본 없는 캐릭터 — 마커가 화면에서 사라진다', display('옛 장면 ⟦simcore:3⟧') === '옛 장면', JSON.stringify(display('옛 장면 ⟦simcore:3⟧')));
      ck('여러 개·잘린 꼬리도 (stripMarkers 규약대로 — 앞 공백은 그대로)', /^a\s*\n\nb$/.test(display('a ⟦simcore:1⟧\n\nb ⟦simcore:2⟧\n\n⟦simcore:')), JSON.stringify(display('a ⟦simcore:1⟧\n\nb ⟦simcore:2⟧\n\n⟦simcore:')));
      ck('마커 없는 글은 그대로', display('그냥 글') === '그냥 글', '');
      const before = world.chats['c-none:0'].message[0].data;
      ck('저장본은 안 건드린다 (다시 설치하면 과거 상태가 그 번호로 돌아온다)', before === '옛 장면 ⟦simcore:3⟧', before);
    }
    ck('소스: 설치본 없을 때 분기가 stripMarkers를 탄다', src.includes("if (!session) return hasMarker(content) ? stripMarkers(content.replace(MARKER_TAIL_RE, '')) : content;"), '');
    ck('소스: 위치 top에서 빈 블록은 빈 줄을 안 남긴다', src.includes('const b = renderFor(idxStr); if (b) blocks.push(b);'), '');
  }

  ck('버전 1.15.1 + 체인지로그', src.includes('//@version 1.15.1') && src.includes('// ── v1.15.1 ──'), '');
  console.log(`\n[test-novars] ${pass}/${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL 예외:', e.stack || e); process.exit(1); });
