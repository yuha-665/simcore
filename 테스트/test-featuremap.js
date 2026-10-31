const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.21.0 — 대화가 자기 기능을 안다 (커뮤니티 제보, 2026-10-31).
//
// 제보: "대화 단위에선 자기 기능을 잘 모르나요 — 자체 상점이나 보드가 있어도 어떻게든 액션 버튼에 상태창을 연동하려 하고,
// 대화에서 안 된다 그러면 준비만 해 줄 줄 알았는데 물어보면 모르는 것처럼 말한다."
// 모델 탓이 아니었다. 작업본이 있는 봇의 대화·🗂 정리·✨ 창작이 받는 패치 규격서엔 상점·보드·메신저·의뢰판이 이름조차 없었고(경영 템플릿 실측 0건),
// 넷이 다 켜진 얼헌도 그 설정값이 안 실렸고, 🧩 상점 카드는 액션 묶음을 시켰다. 여기서 못 박는 것:
//   ① 표 — FEATURE_MAP이 patch.js UNSUPPORTED_HINT·validate.activeSections와 맞는다 (새 기능을 빠뜨리면 여기서 걸린다)
//   ② 지도 — 진짜 편집기에서 ai.generate로 가는 프롬프트에 기능·자리·준비 + 안내가 실린다. 규격은 대화에 나온 것만, 셋까지
//   ③ 현황 — 켜진 기능의 설정값이 보이고, 숨은 글·css는 안 샌다
//   ④ 빈 작업본 — 규격서에 네 기능의 설명이 있고, 검증기 들여쓰기를 빼도 코드는 그대로다
//   ⑤ note — 패치에 안내 칸, ✨ 창작이 말로 온 안내를 형식 실패로 안 받는다 (v1.21.1 💬 대화에 붙어 온 안내도)
//   ⑥ 봇 제작 — 상점·보드·메신저·의뢰판으로 분류된다
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const E = SC.require('editor');
const PM = SC.require('patch');
const B = SC.require('bible');
const { TEMPLATES } = SC.require('templates');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const bracket = (s) => (String(s).match(/\[[^\]]+\]/) || [''])[0];

// 가짜 DOM — test-ooc와 같은 것
function makeDom() {
  const mkEl = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(), nodeType: 1, children: [], childNodes: [],
      style: { cssText: '' }, dataset: {}, attrs: {}, _text: '',
      className: '', value: '', checked: false, open: false, disabled: false,
      classList: {
        add(...c) { for (const x of c) if (!el.className.split(' ').includes(x)) el.className = (el.className + ' ' + x).trim(); },
        remove(...c) { el.className = el.className.split(' ').filter((x) => !c.includes(x)).join(' '); },
        contains: (c) => el.className.split(' ').includes(c),
        toggle(c, on) { if (on === false || (on === undefined && el.classList.contains(c))) el.classList.remove(c); else el.classList.add(c); },
      },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'open') el.open = true; if (k === 'disabled') el.disabled = true; },
      getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
      removeAttribute(k) { delete el.attrs[k]; },
      appendChild(c) { el.children.push(c); el.childNodes.push(c); c.parentNode = el; return c; },
      append(...cs) { for (const c of cs) el.appendChild(c); },
      insertBefore(c, ref) { const i = el.children.indexOf(ref); el.children.splice(i < 0 ? el.children.length : i, 0, c); el.childNodes = el.children; c.parentNode = el; return c; },
      removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) { el.children.splice(i, 1); el.childNodes = el.children; } return c; },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() { el.onclick?.({ preventDefault() {} }); },
      scrollIntoView() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 200, height: 30, bottom: 30, right: 200 }),
      setPointerCapture() {}, releasePointerCapture() {},
      replaceChildren(...cs) { el.children = []; el.childNodes = []; for (const c of cs) el.appendChild(c); },
      prepend(...cs) { el.children.unshift(...cs); el.childNodes = el.children; },
      querySelector: () => null, querySelectorAll: () => [],
      closest: () => null, contains: () => false,
      cloneNode: () => mkEl(tag),
    };
    Object.defineProperty(el, 'textContent', {
      get() { return el._text + el.children.map((c) => c.textContent ?? '').join(''); },
      set(v) { el._text = String(v); el.children = []; el.childNodes = []; },
    });
    Object.defineProperty(el, 'innerHTML', { get: () => el._html ?? '', set(v) { el._html = String(v); el.children = []; el.childNodes = []; } });
    Object.defineProperty(el, 'firstChild', { get: () => el.children[0] ?? null });
    Object.defineProperty(el, 'lastChild', { get: () => el.children[el.children.length - 1] ?? null });
    return el;
  };
  const doc = {
    createElement: mkEl, createElementNS: (_ns, tag) => mkEl(tag),
    createTextNode: (t) => { const n = mkEl('#text'); n.nodeType = 3; n._text = String(t); return n; },
    createDocumentFragment: () => mkEl('#frag'),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  doc.body = mkEl('body'); doc.head = mkEl('head'); doc.documentElement = mkEl('html');
  return doc;
}
function findAll(root, pred, out = []) {
  for (const c of root.children || []) { if (pred(c)) out.push(c); findAll(c, pred, out); }
  return out;
}
const btn = (root, label) => findAll(root, (e) => e.tagName === 'BUTTON' && (e.textContent || '').includes(label))[0];
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 14; i++) await tick(); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function boot() {
  global.document = makeDom();
  global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (f) => f(), setTimeout, clearTimeout };
  global.navigator = { clipboard: { writeText: async () => {} } };
}
function makeAi(reply) {
  const calls = [];
  return { calls, ai: {
    generate: async (i) => { calls.push(i); return reply(calls.length); },
    getBotContext: async () => ({ name: '실험봇', desc: '', lore: [] }),
    getGenModel: async () => ({ choice: 'main', staticId: '' }), setGenModel: async () => {}, getModelIds: async () => null,
    loadChats: async () => null, saveChats: async () => {},
  } };
}
/** 진짜 편집기에서 💬 대화를 한 번 보내 모델에게 가는 system을 그대로 잡는다 */
async function chatPrompt(schema, text) {
  boot();
  const { calls, ai } = makeAi(() => '네.');
  const c = document.createElement('div');
  E.createSchemaEditor(c, clone(schema), { onChange: () => {}, ai });
  btn(c, '💬 대화').click();
  const area = findAll(c, (e) => e.tagName === 'TEXTAREA' && e.className.includes('sce-chat-input'))[0];
  area.value = text; area.oninput(); btn(c, '보내기').click(); await settle();
  return calls[0].system;
}
/** ✨ 창작을 한 번 눌러 호출 수와 화면을 본다 */
async function makeRun(schema, text, reply) {
  boot();
  const { calls, ai } = makeAi(reply);
  const c = document.createElement('div');
  E.createSchemaEditor(c, clone(schema), { onChange: () => {}, ai });
  const area = findAll(c, (e) => e.className === 'sce-ai-request')[0];
  area.value = text; area.oninput(); btn(c, '수정안 생성').click(); await settle(); await settle();
  return { calls, text: c.textContent || '', warn: findAll(c, (e) => e.className === 'sce-warn').map((e) => e.textContent).join(' | '), c };
}
/** 💬 대화를 한 번 보내 호출 수와 화면을 본다 */
async function chatRun(schema, text, reply) {
  boot();
  const { calls, ai } = makeAi(reply);
  const c = document.createElement('div');
  E.createSchemaEditor(c, clone(schema), { onChange: () => {}, ai });
  btn(c, '💬 대화').click();
  const area = findAll(c, (e) => e.tagName === 'TEXTAREA' && e.className.includes('sce-chat-input'))[0];
  area.value = text; area.oninput(); btn(c, '보내기').click(); await settle(); await settle();
  return { calls, text: c.textContent || '' };
}

(async () => {
  const MAP = E.FEATURE_MAP;
  console.log('── ① 표');
  {
    const hints = Object.keys(PM.UNSUPPORTED_HINT).filter((k) => k !== 'simcore');
    const covered = new Set([...MAP.flatMap((f) => f.keys), ...E.PATCH_OFF_SPOTS.map(([k]) => k)]);
    const missing = hints.filter((k) => !covered.has(k));
    ck('★ 패치로 못 다루는 섹션이 표에 전부 있다 (새 섹션을 빠뜨리면 모델이 모른다)', !missing.length, missing.join(', '));
    const hintOf = (k) => bracket(PM.UNSUPPORTED_HINT[k]);
    const off = [...MAP.flatMap((f) => f.keys.map((k) => [k, f.where])), ...E.PATCH_OFF_SPOTS.map(([k, , w]) => [k, w])].filter(([k, w]) => hintOf(k) !== bracket(w));
    ck('★ 표의 자리가 패치 거부 문구의 자리와 같다', !off.length, JSON.stringify(off));

    const tabsSrc = (src.match(/const TABS = \[([\s\S]*?)\n  \];/) || [])[1] || '';
    const labels = new Set([...tabsSrc.matchAll(/\['[a-z]+', '([^']+)'\]/g)].map((m) => `[${m[1]}]`)); labels.add('[에셋 관리자]');
    ck('탭 목록을 읽었다', labels.has('[상점]') && labels.has('[보드]') && labels.has('[규칙·이벤트]'), [...labels].join(' '));
    const ghost = [...MAP.map((f) => f.where), ...E.PATCH_OFF_SPOTS.map(([, , w]) => w)].filter((w) => !labels.has(bracket(w)));
    ck('★ 표의 자리가 실제 탭 이름이다 (없는 탭으로 안내하면 안 된다)', !ghost.length, ghost.join(', '));

    const SAMPLE = { shop: { shop: {} }, shops: { shops: [{ id: 'a' }] }, board: { board: {} }, messenger: { messenger: {} }, questBoard: { questBoard: {} },
      party: { party: {} }, calendar: { calendar: {} }, scenario: { scenario: { acts: [{ id: 'a' }] } }, secrets: { secrets: [{ id: 's' }] }, fronts: { fronts: [{ id: 'f' }] },
      checkpoint: { checkpoint: {} }, liveChoices: { liveChoices: {} }, pools: { pools: [{ id: 'p' }] }, assets: { assets: { packs: [{ id: 'a' }] } }, suggest: { suggest: {} }, time: { time: {} } };
    const noSample = MAP.flatMap((f) => f.keys.filter((k) => !SAMPLE[k]));
    ck('시험 자료가 표의 키를 다 덮는다', !noSample.length, noSample.join(', '));
    const notOn = MAP.flatMap((f) => f.keys.filter((k) => SAMPLE[k] && !f.on(SAMPLE[k])).map((k) => `${f.id}:${k}`));
    ck('★ 그 키가 있으면 켜진 것으로 본다', !notOn.length, notOn.join(', '));
    ck('사건 게이지·전투 안무도 판정된다', MAP.find((f) => f.id === 'gauge').on({ rules: { randomEvents: { gauge: { perDay: 7 } } } }) && MAP.find((f) => f.id === 'fight').on({ checks: [{ id: 'c', fight: {} }] }), '');
    let threw = null;
    for (const s of [{}, { rules: null, checks: [null], scenario: null, assets: null, liveChoices: null }, { rules: { randomEvents: null } }]) {
      try { for (const f of MAP) if (f.on(s)) threw = `${f.id}가 켜짐`; } catch (e) { threw = e.message; }
    }
    ck('★ 빈·깨진 스키마에서 안 터지고 전부 꺼짐', !threw, threw);

    const fn = src.slice(src.indexOf('function activeSections(schema)'), src.indexOf('function varFreeWork('));
    const section = [...fn.matchAll(/out\.push\('([^']+)'\)/g)].map((m) => m[1]).filter((l) => !['지시문', '판정', '액션', '이벤트', '랜덤 사건'].includes(l));
    const lost = section.filter((l) => !MAP.some((f) => f.name.includes(l)));
    ck('activeSections를 읽었다', section.length >= 14, String(section.length));
    ck('★ 켜짐 판정 목록의 기능이 표에 전부 있다', !lost.length, lost.join(', '));
    ck('규격이 있는 기능은 낱말이 있고, 낱말에 g 플래그가 없다', MAP.every((f) => !f.rules || (f.words instanceof RegExp && !f.words.global && Array.isArray(f.rules))), '');
  }

  console.log('── ② 지도 — 경영 템플릿(켜진 기능 없음)');
  const BIZ = TEMPLATES.business.schema;
  {
    const p = await chatPrompt(BIZ, '변수 설명 좀 해줘');
    const noName = MAP.filter((f) => !p.includes(`**${f.name}**`) || !p.includes(f.where));
    ck('★ 모든 기능의 이름·자리가 대화 프롬프트에 있다 (제보 전엔 상점 0건)', !noName.length, noName.map((f) => f.id).join(', '));
    ck('★ 흉내 내지 말고 시스템 기능을 먼저 제안', p.includes('시스템 기능이 맞는 일은 그 기능을 먼저 제안') && p.includes('흉내 내지 마세요'), '');
    ck('사용자가 액션을 고르면 따른다', p.includes('그래도 액션으로 하겠다면 따르세요'), '');
    ck('★ "없다"·"모른다"고 하기 전에 지도를', p.includes('고 답하기 전에 이 지도를 보세요'), '');
    // 실제 모델 시험에서 나왔다 — ✅가 없는 봇에 "보드가 켜져 있는지 확인이 안 돼요"
    ck('표시가 없으면 꺼진 것이라고 말한다', p.includes('표시가 없으면 꺼져 있음'), '');
    ck('★ 준비와 안내 — 준비물은 패치로, 나머지는 note에 탭을', p.includes('### 패치로 못 넣는 기능') && p.includes('**준비물**') && p.includes('`"note"`') && p.includes('**패치 전체가 거부**'), '');
    ck('탭의 AI 창구를 알려 준다', p.includes('AI로 상점 만들기'), '');
    ck('상점 준비물 — 지갑·구매품 목록', p.includes('지갑(숫자 변수)·구매품 목록(list 변수)'), '');
    ck('패치로 못 고치는 자리 전부', E.PATCH_OFF_SPOTS.every(([k]) => p.includes('`' + k + '`')), '');
    ck('대화 규약 — 어떤 기능이 있는지는 지도가 정답', p.includes('"심코어 기능 지도"가 정답'), '');
    // 실제 모델 시험(2026-10-31)에서 나왔다 — 보드를 잘 안내하고는 끝에 "[🗂 정리해서 반영]을 누르면 넣을 수 있어요". 규약의 기본 문구를 따른 것이다
    ck('★ 기능 자체는 🗂로 안 들어간다고 규약이 말한다 — 🗂는 준비물만', p.includes('**그 기능 자체는 [🗂 정리해서 반영]으로 안 들어갑니다**') && p.includes('준비물(지갑·목록 변수 등)이 있을 때 그 준비물에 대해서만'), '');
    ck('켜진 기능이 없으면 ✅도 현황 절도 없다', !/^- ✅/m.test(p) && !p.includes('### 이 봇에 켜진 시스템 기능'), '');
    ck('★ 말하지 않은 기능의 규격은 안 싣는다', !p.includes('## 이 대화에 나온 기능의 규격') && !p.includes('`currency`(지갑 숫자 변수)'), '');

    const ps = await chatPrompt(BIZ, '물건을 파는 상점을 넣고 싶어');
    ck('★ 말한 기능의 규격은 싣는다', ps.includes('### 상점 규격') && ps.includes('`currency`(지갑 숫자 변수)'), '');
    ck('다른 기능은 안 딸려 온다', !ps.includes('### 메신저 규격'), '');
    ck('"사고팔"도 상점이다', (await chatPrompt(BIZ, '손님한테 물건을 사고팔 수 있게 하고 싶어')).includes('### 상점 규격'), '');
    const pm = await chatPrompt(BIZ, '상점, 게시판, 메신저, 의뢰판, 달력 다 넣자');
    const heads = (pm.match(/^### .+ 규격$/gm) || []).join(' ');
    ck('★ 규격은 셋까지, 최근에 말한 순', heads === '### 달력 규격 ### 의뢰판 규격 ### 메신저 규격', heads);
    const pd = await chatPrompt(BIZ, '시나리오에 회귀도 넣자');
    ck('같은 규격은 한 번만 (시나리오·되감기)', (pd.match(/^### .+ 규격$/gm) || []).length === 1, (pd.match(/^### .+ 규격$/gm) || []).join(' '));
    const pt = await chatPrompt(BIZ, '문자열 변수는 어떻게 만들어?');
    ck('"문자열"은 메신저가 아니다', !pt.includes('### 메신저 규격'), '');

    const ex = E.buildExtractRequest(BIZ, [{ role: 'user', text: '상점을 넣자' }, { role: 'ai', text: '좋아요' }], '', '');
    ck('★ 🗂 정리에도 지도·규격·거부 경고·준비물', ex.system.includes('## 심코어 기능 지도') && ex.system.includes('### 상점 규격')
      && ex.system.includes('`shop` 같은 키를 쓰면 패치 전체가 거부') && ex.system.includes('준비물(지갑·목록 변수 등)만 패치에 넣고'), '');
    ck('🗂 추가 요청의 낱말도 본다', E.buildExtractRequest(BIZ, [{ role: 'user', text: '좋아' }], '메신저도', '').system.includes('### 메신저 규격'), '');
    const bytes = Buffer.byteLength(p.slice(p.indexOf('## 심코어 기능 지도'), p.indexOf('## 필드 사전')));
    ck('★ 지도 + 준비·안내가 5KB 안 (매 턴 나가는 몫)', bytes < 5 * 1024, (bytes / 1024).toFixed(1) + 'KB');
  }

  console.log('── ③ 현황 — 켜진 기능이 보이고 안 샌다');
  {
    const H = JSON.parse(fs.readFileSync(__P('../얼헌/헌터-신안.json'), 'utf8'));
    const p = await chatPrompt(H, '변수 설명 좀 해줘');
    ck('★ 켜진 기능에 ✅', ['상점', '보드(게시판)', '메신저', '의뢰판', '편성표'].every((n) => p.includes(`- ✅ **${n}**`)), '');
    ck('안 켜진 기능엔 ✅가 없다', p.includes('- **시나리오**') && !p.includes('- ✅ **시나리오**'), '');
    ck('★ 현황 절', p.includes('### 이 봇에 켜진 시스템 기능'), '');
    ck('★ 설정값이 실린다 (제보 전엔 전부 없었다)', [H.shop.guide, H.board.guide, H.messenger.guide, H.questBoard.guide].every((g) => p.includes(String(g).slice(0, 24))), '');
    ck('★ 그 기능이 쓰는 변수는 remove 금지', p.includes(`\`${H.shop.currency}\``) && /- \*\*상점\*\*:.*remove 금지/.test(p) && /- \*\*메신저\*\*:.*remove 금지/.test(p) && /- \*\*의뢰판\*\*:.*remove 금지/.test(p), '');
    ck('★ 켜져 있어도 말하지 않으면 규격은 안 싣는다 (다 켠 봇이 매 턴 9KB를 더 내지 않게)', !p.includes('### 상점 규격'), '');

    const S = clone(BIZ);
    S.shop = { label: '잡화점', currency: 'gold', buyTo: 'bag', guide: '지침-표식', css: '.css-표식{}' };
    S.board = { label: '방', css: '.css-표식{}', guide: 'x'.repeat(400) };
    const q = await chatPrompt(S, '변수 설명');
    ck('css는 안 싣는다', q.includes('지침-표식') && !q.includes('css-표식'), '');
    ck('긴 글은 자른다', !q.includes('x'.repeat(100)), '');

    const R = clone(TEMPLATES.rpg.schema);
    const act = R.scenario.acts.find((a) => a.secret);
    const r = await chatPrompt(R, '구조 설명해줘');
    ck('시나리오는 막 이름·해금만', r.includes(`\`${act.id}\``) && r.includes('- **시나리오**: 막 '), '');
    ck('★ 막의 숨은 글·본문은 다이제스트로 안 샌다', !r.includes(String(act.secret).slice(0, 20)) && !r.includes(String(act.direct).slice(0, 20)), '');
  }

  console.log('── ④ 빈 작업본');
  {
    const p = await chatPrompt({ simcore: '0.1' }, '상점 있는 봇 만들래');
    const desc = p.split('## 부록: 검증기 원문')[0];
    ck('★ 설명 구간에 네 기능의 규격 (전엔 검증기 코드에만 있었다)', ['## 상점(shop·shops)', '## 보드(board)', '## 메신저(messenger)', '## 의뢰판(questBoard)'].every((t) => desc.includes(t)) && desc.includes('`currency`(지갑 숫자 변수)'), '');
    ck('★ 최상위 키에 네 기능', /최상위 키:[^\n]*`shop`[^\n]*`board`[^\n]*`messenger`[^\n]*`questBoard`/.test(desc), '');
    ck('지도가 있고 빈 봇에 ✅는 없다', desc.includes('## 심코어 기능 지도') && !/^- ✅/m.test(desc), '');
    const code = (p.split('## 부록: 검증기 원문')[1] || '').split('```js')[1]?.split('```')[0] || '';
    ck('검증기 부록을 읽었다', code.includes('function validateSchema'), '');
    ck('들여쓰기를 뺐다', code.split('\n').every((l) => l === l.trimStart()), '');
    let compiled = null;
    try { new Function(`return (${code.trim()});`); compiled = true; } catch (e) { compiled = e.message; }
    ck('★ 들여쓰기를 빼도 코드는 그대로 읽힌다', compiled === true, compiled);
  }

  console.log('── ⑤ note · ✨ 창작이 말로 온 안내를 받는다');
  {
    const pp = PM.parsePatch({ patchVersion: 1, add: { vars: [{ id: 'coin', label: '코인', type: 'int', init: 0 }] }, note: ' [상점] 탭에서 진열을 채우세요 ' });
    ck('★ 패치 최상위 note를 받는다', pp.ok && pp.patch.note === '[상점] 탭에서 진열을 채우세요', JSON.stringify(pp));
    ck('note는 800자로 자른다', PM.parsePatch({ add: { vars: [{ id: 'c', label: 'c', type: 'int', init: 0 }] }, note: 'ㄱ'.repeat(900) }).patch.note.length === 800, '');
    const r = PM.applyPatch(clone(BIZ), pp.patch);
    ck('note는 병합에 안 든다', r.ok && !('note' in r.schema) && r.schema.vars.some((v) => v.id === 'coin'), JSON.stringify(r.errors));
    ck('note만이면 패치가 아니다 (할 일 없음)', !PM.parsePatch({ note: 'x' }).ok, '');
    ck('기능 키는 여전히 거부 + 자리를 말한다', PM.parsePatch({ add: { shop: {} } }).errors[0].includes('[상점] 탭'), '');
    ck('★ 보드 거부 문구가 실제 탭 이름 (전엔 [게시판] 탭)', PM.parsePatch({ add: { board: {} } }).errors[0].includes('[보드] 탭'), '');

    const G = await makeRun(BIZ, '상점 만들어 줘', () => '상점은 패치로 못 넣어요. [상점] 탭의 AI로 상점 만들기에서 만드세요.');
    ck('★ 말로 온 안내 — 재시도 없이 그대로 보여 준다', G.calls.length === 1 && G.warn.includes('💬') && G.warn.includes('AI로 상점 만들기') && !G.warn.includes('형식 검사'), `${G.calls.length} ${G.warn}`);
    ck('✨ 프롬프트에도 지도와 말한 기능의 규격', String(G.calls[0]).includes('## 심코어 기능 지도') && String(G.calls[0]).includes('### 상점 규격'), '');
    const N = await makeRun(BIZ, '보드 켜 줘', () => '{"note":"[보드] 탭에서 켜 주세요"}');
    ck('★ note만 온 답도 안내로', N.calls.length === 1 && N.warn.includes('[보드] 탭에서 켜 주세요') && !N.warn.includes('형식 검사'), `${N.calls.length} ${N.warn}`);
    const Bad = await makeRun(BIZ, '금화 변수 줄여 줘', () => '네 알겠습니다!');
    ck('탭을 안 가리키는 산문은 종전대로 재시도', Bad.calls.length === 2 && Bad.warn.includes('형식 검사'), `${Bad.calls.length} ${Bad.warn}`);
    const W = await makeRun(BIZ, '상점 준비해 줘', () => '```json\n' + JSON.stringify({ patchVersion: 1, add: { vars: [{ id: 'bag', label: '가방', type: 'list', init: [] }] }, note: '[상점] 탭에서 지갑과 가방을 연결하세요' }) + '\n```');
    ck('★ 패치 + note → 변경 계획 상자에 💡', W.text.includes('💡 [상점] 탭에서 지갑과 가방을 연결하세요'), W.text.slice(0, 200));

    // v1.21.1 — 규약상 대화엔 JSON이 없지만 규격서가 {"note":"…"}를 가르치니 약한 모델은 붙일 수 있다. v1.21.0은 ✨·🗂만 챙겼다
    const CN = await chatRun(BIZ, '보드 켜 줘', () => '```json\n{"note":"[보드] 탭에서 켜 주세요"}\n```');
    ck('★ 💬 note만 붙어 와도 말풍선으로 — 재시도·오류 없이', CN.calls.length === 1 && CN.text.includes('[보드] 탭에서 켜 주세요') && !CN.text.includes('수정안만 보냈어요'), `${CN.calls.length} ${CN.text.slice(0, 200)}`);
    const CS = await chatRun(BIZ, '보드 켜 줘', () => '탭에서 켜는 기능이에요.\n```json\n{"note":"[보드] 탭에서 켜 주세요"}\n```');
    ck('💬 앞의 설명도 같이 남는다', CS.calls.length === 1 && CS.text.includes('탭에서 켜는 기능이에요.') && CS.text.includes('[보드] 탭에서 켜 주세요'), CS.text.slice(0, 200));
    const CP = await chatRun(BIZ, '상점 준비해 줘', () => '가방을 준비할게요.\n```json\n' + JSON.stringify({ patchVersion: 1, add: { vars: [{ id: 'bag', label: '가방', type: 'list', init: [] }] }, note: '[상점] 탭에서 지갑과 가방을 연결하세요' }) + '\n```');
    ck('★ 💬 패치 + note → 제안 상자에 💡', CP.calls.length === 1 && CP.text.includes('💡 [상점] 탭에서 지갑과 가방을 연결하세요'), CP.text.slice(0, 300));
    const CB = await chatRun(BIZ, '금화 변수 줄여 줘', () => '```json\n{"nonsense":true}\n```');
    ck('💬 안내가 아닌 깨진 JSON은 종전대로 재시도', CB.calls.length === 2, String(CB.calls.length));
  }

  console.log('── ⑥ 봇 제작');
  {
    ck('★ 분류에 상점·보드·메신저·의뢰판', ['상점', '보드', '메신저', '의뢰판'].every((h) => B.SIM_HOW.includes(h)), B.SIM_HOW.join());
    const rules = B.bibleRules().join('\n');
    ck('규약이 분류를 가르친다', rules.includes('how="상점"') && rules.includes('how="의뢰판"') && rules.includes('상점|보드|메신저|의뢰판'), '');
    const n = B.normalizeBible({ sim: [{ what: '잡화점', how: '상점', why: '사고판다' }] });
    ck('분류가 살아남는다', n.sim[0].how === '상점', JSON.stringify(n.sim));
    const req = B.simRequestText(n);
    ck('💬로 넘기면 상점 규격이 걸린다', (await chatPrompt(BIZ, req)).includes('### 상점 규격'), '');
  }

  console.log('── ⑦ 배선');
  ck('버전 1.21.0 이상 + 체인지로그', /\/\/@version (1\.2[1-9]\.\d+|1\.([3-9]\d)\.\d+|[2-9]\.\d+\.\d+)/.test(src) && src.includes('// ── v1.21.0 ──'), '');

  console.log(`\n[test-featuremap] ${pass}/${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL 예외:', e.stack || e); process.exit(1); });
