const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.24 — 모듈 팩 매니페스트 체크가 팩 0개 봇에서도 켜진다 (normalize가 assets를 걷지 않는다)
// 실기 제보: "활성 모듈의 ⚙simcore-pack 항목에서 팩을 자동으로 읽어와요 — 백날 클릭해도 체크가 안 된다"
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;

const BASE = {
  simcore: '0.1', meta: { name: '받는 봇' },
  vars: [{ id: 'gold', label: '금화', type: 'int', init: 100, min: 0 }],
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
  const ai = { getAssetNames: async () => ['리아나_기쁨.png'], getModulePacks: async () => ({ merged: [], scanned: true }) };
  const container = document.createElement('div');
  let changed = null;
  const ed = createSchemaEditor(container, JSON.parse(JSON.stringify(BASE)), { onChange: (s) => { changed = s; }, ai, floor: 'assets' });
  const box = () => findAll(container, (e) => e.tagName === 'INPUT' && e.attrs.type === 'checkbox'
    && (e.parentNode?.textContent || '').includes('⚙simcore-pack'))[0];
  ck('★ 에셋 층에 모듈 팩 체크박스', !!box(), '');
  ck('처음엔 꺼짐 · assets 없음', box().checked === false && !ed.getSchema().assets, '');

  // 켜기 — 팩 0개 봇
  box().checked = true; box().onchange();
  ck('★ 켜면 저장본에 moduleManifests:true (팩 0개여도 assets가 걷히지 않는다)', ed.getSchema().assets?.moduleManifests === true && Array.isArray(ed.getSchema().assets.packs) && ed.getSchema().assets.packs.length === 0, JSON.stringify(ed.getSchema().assets));
  ck('★ 다시 그린 뒤에도 체크가 켜져 있다', box().checked === true, '');
  ck('onChange로 호스트에도 전달', changed?.assets?.moduleManifests === true, JSON.stringify(changed?.assets));
  ck('켜면 [모듈 팩 다시 읽기] 버튼이 뜬다', !!btn(container, '다시 읽기'), '');
  const { validateSchema } = SC.require('validate');
  ck('팩 0개 + 옵트인 스키마가 검증 통과', validateSchema(ed.getSchema()).ok, JSON.stringify(validateSchema(ed.getSchema()).errors));

  // 삽입 주체 (v1.9.26) — 모듈 팩만 받는 봇도 고를 수 있다
  const bySel = () => findAll(container, (e) => e.tagName === 'SELECT' && (e.parentNode?.textContent || '').includes('삽입 주체'))[0];
  ck('★ 체크가 켜지면 삽입 주체 선택기가 뜬다 (자체 팩 0개)', !!bySel() && bySel().value === 'aux', '');
  bySel().value = 'main'; bySel().onchange();
  ck('★ 메인으로 바꾸면 저장본 assets.by = main, 옵트인 유지', ed.getSchema().assets?.by === 'main' && ed.getSchema().assets.moduleManifests === true, JSON.stringify(ed.getSchema().assets));
  bySel().value = 'aux'; bySel().onchange();
  ck('보조로 되돌리면 by 필드 제거', ed.getSchema().assets && !('by' in ed.getSchema().assets), '');

  // 끄기 — 팩 0개면 assets가 걷힌다 ("없음 = 꺼짐" 불변식 유지)
  box().checked = false; box().onchange();
  ck('★ 끄면 assets가 다시 걷힌다', !ed.getSchema().assets && box().checked === false, JSON.stringify(ed.getSchema().assets));
  ck('끄면 선택기도 사라진다', !bySel(), '');

  // 팩이 있는 봇은 예전 그대로
  const withPack = { ...JSON.parse(JSON.stringify(BASE)), assets: { by: 'aux', packs: [{ id: 'p', who: ['리아나'], emotions: ['기쁨'], pattern: '{who}_{emotion}' }] } };
  const c2 = document.createElement('div');
  const ed2 = createSchemaEditor(c2, withPack, { onChange: () => {}, ai, floor: 'assets' });
  ck('팩 있는 봇: assets 유지 · 체크 꺼짐', ed2.getSchema().assets?.packs?.length === 1 && !ed2.getSchema().assets.moduleManifests, '');

  let pass = 0, fail = 0;
  for (const [c, n, x] of R) { console.log((c ? 'PASS' : 'FAIL'), n, c ? '' : `→ ${x}`); c ? pass++ : fail++; }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
