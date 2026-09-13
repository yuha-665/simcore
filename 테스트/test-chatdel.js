const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.19 — 대화 말풍선 지우기: ✕ 하나 · ⌫ 여기부터. 지운 말은 다음 전송에 안 실리고, pending 수정안의 말풍선을 지우면 계획 상자도 사라진다
// 커뮤니티 제보(에렌샤): "끝난 곁가지 B를 지우고 올릴 내용만 보내고 싶다"
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;

const BASE = {
  simcore: '0.1', meta: { name: '지우기 실험대' },
  vars: [{ id: 'gold', label: '금화', type: 'int', init: 100, min: 0 }],
  rules: { events: [{ id: 'broke', when: 'gold < 1', notify: '금고가 비었다.' }] },
  actions: [{ id: 'work', label: '⚒ 노역', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold + 10' }] }],
  statusUI: { mode: 'auto', groups: [] },
};

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
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };


(async () => {
  global.document = makeDom();
  global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (f) => f(), setTimeout, clearTimeout };
  global.navigator = { clipboard: { writeText: async () => {} } };
  const { createSchemaEditor } = SC.require('editor');
  const calls = [];
  let reply = () => '설명만 하는 턴이에요.';
  const ai = {
    generate: async (input) => { calls.push(input); return reply(input); },
    getBotContext: async () => ({ name: '실험봇', desc: '겨울 영지', lore: [] }),
    getGenModel: async () => ({ choice: 'main', staticId: '' }),
    setGenModel: async () => {}, getModelIds: async () => null,
  };
  const container = document.createElement('div');
  const ed = createSchemaEditor(container, JSON.parse(JSON.stringify(BASE)), { onChange: () => {}, ai });
  btn(container, '💬 대화').click();
  const area = () => findAll(container, (e) => e.tagName === 'TEXTAREA' && e.className.includes('sce-chat-input'))[0];
  const bubbles = () => findAll(container, (e) => (e.className || '').startsWith('sce-chat-msg'));
  const delBtns = (i) => findAll(bubbles()[i], (e) => e.tagName === 'BUTTON' && e.className.includes('sce-chat-del'));
  const send = async (t) => { area().value = t; area().oninput(); btn(container, '보내기').click(); await settle(); };

  await send('A 문제: 세금이 왜 있어?');
  await send('B 곁가지: 금화 상한은?');
  await send('다시 A: 세금 없애자');
  ck('말풍선 6개 (3왕복)', bubbles().length === 6, String(bubbles().length));
  ck('각 말풍선에 ✕, 마지막만 ⌫ 없음', delBtns(0).length === 2 && delBtns(5).length === 1 && delBtns(5)[0].textContent === '✕', JSON.stringify(bubbles().map((b, i) => delBtns(i).length)));
  ck('✕는 접근성 라벨', delBtns(0)[0].getAttribute('aria-label') === '이 말풍선 지우기', '');

  // ✕ — B 곁가지 질문(2)과 답(3)을 하나씩 지운다
  delBtns(3)[0].click();
  delBtns(2)[0].click();
  ck('★ 두 개 지우면 4개', bubbles().length === 4, String(bubbles().length));
  const texts = () => bubbles().map((b) => findAll(b, (e) => e.className === 'sce-chat-text')[0]?.textContent);
  ck('남은 순서 A질문·답·A질문·답', texts()[0].includes('A 문제') && texts()[2].includes('다시 A') && !texts().some((t) => t.includes('B 곁가지')), JSON.stringify(texts()));
  await send('그럼 반영해줘');
  const last = calls[calls.length - 1];
  ck('★ 다음 전송의 이력에 지운 말이 없다', !JSON.stringify(last.messages).includes('B 곁가지') && JSON.stringify(last.messages).includes('A 문제'), JSON.stringify(last.messages.map((m) => m.content.slice(0, 12))));
  ck('이력 길이 = 남은 말풍선 4 + 이번 말 1', last.messages.length === 5, String(last.messages.length));

  // ⌫ 여기부터 — 세 번째 말풍선부터 아래 전부
  delBtns(2)[1].click();
  ck('★ 여기부터 지우면 앞 둘만 남는다', bubbles().length === 2, String(bubbles().length));

  // pending 수정안의 말풍선을 지우면 계획 상자도 사라진다
  reply = () => '넣을게요.\n\n```json\n{"patchVersion":1,"add":{"vars":[{"id":"tax","label":"세금","type":"int","init":5,"min":0}]}}\n```';
  await send('세금 변수 넣어줘');
  const plan = () => findAll(container, (e) => (e.className || '').includes('sce-patch-plan') || (e.textContent || '').includes('패치 적용'))[0];
  ck('계획 상자가 떴다', !!btn(container, '패치 적용'), '');
  delBtns(bubbles().length - 1)[0].click();
  ck('★ 그 말풍선을 지우면 계획 상자도 없다', !btn(container, '패치 적용') && bubbles().length === 3, String(bubbles().length));
  ck('작업본은 안 바뀌었다', !ed.getSchema().vars.some((v) => v.id === 'tax'), '');

  // 소스 확인
  ck('전송 중엔 버튼 없음 (chat.busy 가드)', src.includes('const tools = chat.busy ? null : h(') && src.includes('if (chat.busy) return;\n      const removed = chat.msgs.splice(idx, count);'), '');
  ck('CSS', src.includes('.sce .sce-chat-tools {'), '');

  let pass = 0, fail = 0;
  for (const [c, n, x] of R) { console.log((c ? 'PASS' : 'FAIL'), n, c ? '' : `→ ${x}`); c ? pass++ : fail++; }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
