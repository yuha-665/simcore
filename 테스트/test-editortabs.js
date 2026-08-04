const __P = (...p) => require('path').resolve(__dirname, ...p);
// 편집기 탭이 **실제로 그려지는가** — 가짜 DOM에 편집기를 띄우고 심층 11탭 + 1층 3탭을 다 눌러 본다.
//
// 배경: v0.66에서 외부 기여분(UI 개조판)을 병합하며 변수·명령·상태창·에셋 탭이 통째로 새 코드가
// 됐는데, 탭을 하나라도 실제로 렌더해 보는 테스트가 하나도 없었다. 문자열 어서션(src.includes)만
// 2500개 있어 봐야 "그 문구가 파일에 있다"까지만 증명한다 — 렌더 중 예외 하나면 화면은 빈다.
// v0.65에서 어댑터 input 훅이 무커버리지라 새어 나간 것과 같은 종류의 구멍이다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── 가짜 DOM ── h()가 쓰는 만큼만. 텍스트와 자식을 보관해 버튼을 찾아 누를 수 있게 한다.
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
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'open') el.open = true; },
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
    return el;
  };
  const doc = {
    createElement: mkEl,
    createTextNode: (t) => { const n = mkEl('#text'); n.nodeType = 3; n._text = String(t); return n; },
    createDocumentFragment: () => mkEl('#frag'),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  doc.body = mkEl('body'); doc.head = mkEl('head'); doc.documentElement = mkEl('html');
  return doc;
}

// 트리 안에서 조건에 맞는 원소 찾기
function findAll(root, pred, out = []) {
  for (const c of root.children || []) { if (pred(c)) out.push(c); findAll(c, pred, out); }
  return out;
}
const countEls = (root) => findAll(root, () => true).length;

// ── 실험대 스키마 — 모든 탭이 그릴 것을 하나씩 가진 봇 ──
const SCHEMA = {
  simcore: '0.1',
  meta: { name: '탭 실험대' },
  time: { start: '2026-03-02 08:30', advance: 'explicit', format: { date: 'M월 D일', clock: 'HH:mm' }, calendar: 'gregorian' },
  vars: [
    { id: 'gold', label: '재정', type: 'int', init: 100, min: 0, max: 9999, cmd: '금', desc: '돈' },
    { id: 'mood', label: '기분', type: 'enum', enum: ['좋음, 아주', '보통', '나쁨'], init: '보통' },
    { id: 'name', label: '이름', type: 'text', init: '무명', maxLength: 30 },
    { id: 'flag', label: '깃발', type: 'bool', init: false },
    { id: 'bag', label: '가방', type: 'list', init: ['검, 낡은', '방패'], maxItems: 8, itemMaxLength: 40 },
    { id: 'skip_day', label: '건너뛴 일수', type: 'int', init: 0, min: 0, max: 30 },
    { id: 'skip_min', label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 1440 },
  ],
  derived: [{ id: 'rich', label: '부자', expr: 'gold >= 500' }],
  actions: [{ id: 'rest', label: '🛏 휴식', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold - 1' }] }],
  checks: [{ id: 'luck', label: '운', roll: 'rand(1, 20)', vs: '10', grades: [{ when: 'total >= vs', label: '성공' }, { label: '실패' }] }],
  directives: [{ id: 'tone', when: 'flag', text: '차분하게 그려라.' }],
  rules: {
    onTurn: [{ set: 'gold', expr: 'gold + 1' }],
    events: [{ id: 'fork', when: 'gold >= 50', notify: '갈림길', choices: [
      { label: '왼쪽', effects: [{ set: 'gold', expr: 'gold + 1' }] },
      { label: '오른쪽', effects: [{ set: 'gold', expr: 'gold - 1' }] },
    ] }],
    randomEvents: { chancePerTurn: 0.1, table: [{ id: 'rain', notify: '비' }] },
  },
  party: { label: '편성', roster: 'bag', tabs: [{ id: 'main', label: '편성', slots: [{ var: 'mood', label: '전위' }], actions: ['rest'] }] },
  assets: { packs: [{ id: 'p1', sep: '_', format: '<img="{name}">', slots: [{ id: 'who', label: '인물', values: ['Hiromi'] }] }] },
  suggest: { count: 2 },
  statusUI: { mode: 'auto', layout: 'stack', groups: [{ label: '상태', items: [{ var: 'gold', bar: true, max: 9999 }, { var: 'mood' }] }] },
  updater: { model: 'aux', allow: [{ id: 'gold', maxGain: 50 }, { id: 'mood' }] },
  setup: { steps: [{ id: 's1', ask: '이름은?', set: 'name' }] },
};

// ── 부팅 ──
global.document = makeDom();
global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (f) => f(), setTimeout, clearTimeout };
global.navigator = { clipboard: { writeText: async () => {} } };

(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const { createSchemaEditor } = SimCore.require('editor');
const { validateSchema } = SimCore.require('validate');

ck('실험대 스키마가 유효하다', validateSchema(SCHEMA).ok, JSON.stringify(validateSchema(SCHEMA).errors));

const container = document.createElement('div');
let ed = null; let bootErr = null;
try { ed = createSchemaEditor(container, SCHEMA, { onChange: () => {} }); } catch (e) { bootErr = e; }
ck('★ 편집기가 예외 없이 뜬다', !bootErr, bootErr && (bootErr.message + ' | ' + bootErr.stack.split('\n')[1]));

if (ed) {
  // ── 심층 편집 11탭 — 탭 버튼을 실제로 눌러 본다 ──
  const DEEP = ['변수', '명령', '상태창', '편성표', '달력', '규칙·이벤트', '액션', '판정', '시간', '새 시작', 'AI 설정'];
  // 심층 편집 접이를 편다 (닫혀 있으면 탭 버튼이 안 그려진다)
  const openLower = () => {
    for (const d of findAll(container, (e) => e.tagName === 'DETAILS' && e.className.includes('sce-lower'))) d.open = true;
  };
  openLower();
  for (const label of DEEP) {
    const btn = findAll(container, (e) => e.tagName === 'BUTTON' && e.className.includes('sce-tab')
      && (e.textContent || '').includes(label))[0];
    if (!btn) { ck(`심층 탭 [${label}] 버튼이 있다`, false, '못 찾음'); continue; }
    let err = null; let after = 0;
    try { btn.onclick({ preventDefault() {} }); openLower(); after = countEls(container); } catch (e) { err = e; }
    ck(`★ 심층 탭 [${label}] 렌더`, !err && after > 50,
      err ? err.message + ' | ' + String(err.stack).split('\n')[1] : `원소 ${after}개`);
  }

  // ── 1층 탭 3종 ──
  for (const label of ['창작', '결과', '진단']) {
    const btn = findAll(container, (e) => e.tagName === 'BUTTON' && e.className.includes('sce-tab')
      && (e.textContent || '').includes(label))[0];
    if (!btn) { ck(`1층 탭 [${label}] 버튼이 있다`, false, '못 찾음'); continue; }
    let err = null; let after = 0;
    try { btn.onclick({ preventDefault() {} }); after = countEls(container); } catch (e) { err = e; }
    ck(`★ 1층 탭 [${label}] 렌더`, !err && after > 30,
      err ? err.message + ' | ' + String(err.stack).split('\n')[1] : `원소 ${after}개`);
  }

  // ── 편집을 거쳐도 스키마가 상하지 않는다 ──
  const out = ed.getSchema();
  ck('탭을 다 돌아도 변수가 그대로', out.vars.length === SCHEMA.vars.length, `${out.vars.length}`);
  ck('★ 쉼표가 든 선택지가 쪼개지지 않는다 (v0.66 한 줄 편집)',
    out.vars.find((v) => v.id === 'mood').enum[0] === '좋음, 아주',
    JSON.stringify(out.vars.find((v) => v.id === 'mood').enum));
  ck('★ 쉼표가 든 목록 항목도 그대로',
    out.vars.find((v) => v.id === 'bag').init[0] === '검, 낡은',
    JSON.stringify(out.vars.find((v) => v.id === 'bag').init));
  ck('상태창 그룹이 그대로', out.statusUI.groups.length === 1 && out.statusUI.groups[0].items.length === 2, '');

  // ── 변수 0개 봇(에셋 전용, v0.64)도 탭이 그려져야 한다 ──
  const assetOnly = { simcore: '0.1', meta: { name: '에셋만' }, vars: [], rules: { onTurn: [], events: [], randomEvents: { chancePerTurn: 0, table: [] } },
    statusUI: { mode: 'auto', groups: [] }, updater: { model: 'aux', allow: [] },
    assets: { packs: [{ id: 'p', sep: '_', format: '<img="{name}">', slots: [{ id: 'who', label: '인물', values: ['A'] }] }] } };
  let e2 = null;
  try { ed.setSchema(assetOnly); } catch (e) { e2 = e; }
  ck('★ 변수 0개(에셋 전용) 봇도 예외 없이 그려진다', !e2, e2 && e2.message);
  ck('에셋 전용 안내가 뜬다', (container.textContent || '').includes('에셋만 쓰는 봇'),
    (container.textContent || '').slice(0, 120));

  // ── ⠿ 끌어서 순서 바꾸기 (v0.66.1) — 손잡이를 실제로 잡고 놓아 본다 ──
  ed.setSchema(SCHEMA);
  for (const d of findAll(container, (e) => e.tagName === 'DETAILS' && e.className.includes('sce-lower'))) d.open = true;
  {
    const varTab = findAll(container, (e) => e.tagName === 'BUTTON' && e.className.includes('sce-tab')
      && (e.textContent || '').includes('변수'))[0];
    varTab?.onclick({ preventDefault() {} });
    for (const d of findAll(container, (e) => e.tagName === 'DETAILS' && e.className.includes('sce-lower'))) d.open = true;
    const handles = findAll(container, (e) => e.className.includes('sce-variable-drag-handle'));
    // 기본 변수 + 파생 변수 카드 전부에 붙는다
    ck('★ 변수 카드마다 ⠿ 손잡이가 있다',
      handles.length === SCHEMA.vars.length + SCHEMA.derived.length, `${handles.length}개`);

    // 첫 카드를 잡아 둘째 카드 아래로 놓는다. document 리스너로 이어지므로 그걸 붙잡아 부른다.
    const moves = []; const ups = [];
    const realAdd = document.addEventListener;
    document.addEventListener = (type, fn) => { if (type === 'pointermove') moves.push(fn); if (type === 'pointerup') ups.push(fn); };
    let dragErr = null;
    try {
      handles[0].onpointerdown({ pointerId: 1, clientX: 10, clientY: 10, preventDefault() {}, button: 0 });
      for (const fn of moves) fn({ pointerId: 1, clientX: 10, clientY: 200, preventDefault() {} });
      for (const fn of ups) fn({ pointerId: 1, clientX: 10, clientY: 200, preventDefault() {} });
    } catch (e) { dragErr = e; }
    document.addEventListener = realAdd;
    ck('★ 손잡이를 잡고 놓아도 예외가 없다', !dragErr,
      dragErr && dragErr.message + ' | ' + String(dragErr.stack).split('\n')[1]);
    const after = ed.getSchema();
    ck('끌어도 변수 개수는 그대로 (잃거나 복제되지 않는다)',
      after.vars.length === SCHEMA.vars.length, `${after.vars.length}`);
    ck('끌어도 변수 집합은 그대로 (순서만 바뀐다)',
      after.vars.map((v) => v.id).sort().join(',') === SCHEMA.vars.map((v) => v.id).sort().join(','),
      after.vars.map((v) => v.id).join(','));
  }

  ed.destroy();
}

// ── 끌어서 이동 스위치 (v0.66) ──
{
  const on = /const CARD_DRAG = true/.test(src);
  ck('CARD_DRAG 스위치가 있다', /const CARD_DRAG = (true|false)/.test(src), '');
  ck(on ? '스위치 ON — 손잡이가 붙는다' : '스위치 OFF — ⠿ 손잡이가 안 붙는다',
    on ? src.includes("}, '⠿') : null") : !/⠿/.test(container.textContent || ''), '');
  ck('끌기와 별개로 ▲▼ 순서 버튼은 남는다',
    src.includes("title: '위로' }, '▲'") && src.includes("title: '아래로' }, '▼'"), '');

  // ★ 손잡이 자리를 **고정 폭 격자 열**로 잡으면, 스위치를 끄는 순간 그 열로 옆엣것이
  //   밀려 들어가 찌그러진다 (실측: 상태창 항목 셀렉트가 30px가 됐다).
  //   스위치가 어느 쪽이든 무너지지 않아야 하므로 CSS 자체를 못 박는다.
  const css = src.slice(src.indexOf('const CSS = `'), src.indexOf('\n`;', src.indexOf('const CSS = `')));
  const rule = css.match(/\.sce \.sce-status-value-control \{([^}]*)\}/)?.[1] ?? '';
  ck('★ 손잡이 자리는 고정 폭 격자 열이 아니다 (없어도 안 찌그러진다)',
    /display:flex/.test(rule) && !/grid-template-columns/.test(rule), rule.replace(/\s+/g, ' ').trim());

  // 폭 층은 두 개까지 — 패널폭 → 작업폭. 카드 안에 세 번째 숫자를 박으면 전부 어긋나 보인다.
  ck('★ 카드 안쪽은 카드 폭을 따른다 (세 번째 폭 층 없음)',
    /--sce-variable-work-width:100%/.test(css), (css.match(/--sce-variable-work-width:[^;]*/) || ['없음'])[0]);
  const dupes = [...css.matchAll(/(\.sce [^{]+)\{([^}]*)\}/g)]
    .filter((m) => (m[2].match(/max-width:/g) || []).length > 1).map((m) => m[1].trim());
  ck('★ 한 규칙에 max-width가 두 번 들어간 곳이 없다 (뒤엣것이 조용히 이긴다)',
    dupes.length === 0, dupes.join(', '));

  // ★ 심층 편집 탭의 작업 폭은 **한 숫자**여야 한다.
  //   블록마다 px를 박던 방식이라 820·960·1040·680이 섞여 한 탭 안에서 오른쪽 끝이
  //   네 군데로 갈라졌다. 새 상한을 px로 박으면 여기서 걸린다.
  const DEEP = /^\.sce \.sce-(vars|variable|derived|command|status|assets|deep)-/;
  const strays = [];
  for (const m of css.matchAll(/(\.sce [^{]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim();
    const w = m[2].match(/max-width:\s*([^;}]+)/);
    if (!w || !DEEP.test(sel)) continue;
    const v = w[1].trim();
    // 허용: 공용 토큰 | 부모를 그대로 따름 | 화면 폭 기준(드래그 고스트) | 해제
    if (/^var\(--sce-(work-w|variable-work-width)\)$/.test(v) || v === '100%'
      || v.startsWith('calc(100vw') || v === 'none' || v === 'none !important') continue;
    strays.push(`${sel} → ${v}`);
  }
  ck('★ 심층 편집 폭 상한이 공용 토큰 하나로 모여 있다 (px 직접 박기 금지)',
    strays.length === 0, strays.join(' | '));
  // 폭 상한은 **탭 바까지 품은 기둥**에 걸려야 한다. 본문만 좁히면 탭 바 밑줄이 혼자
  // 패널 끝까지 가서 탭마다 오른쪽이 어긋난다 (실측 제보: "모든탭이 다 안맞게되었는데").
  ck('★ 폭 상한이 탭 바까지 품은 기둥에 걸려 있다',
    /\.sce \.sce-deep \{[^}]*max-width:var\(--sce-work-w\)/.test(css)
    && src.includes("h('div', { class: 'sce-deep' }, deepTabs(), deepBody(), reportEl)"), '');

  // ── 관리 패널(#sc-root)의 id 특이도가 편집기 폭 체계를 눌러 죽이지 않는가 ──
  // 실기 제보: 에셋 팩 편집 화면의 입력칸이 전부 130px에 눌어붙었다. 범인은 관리 패널의
  // `#sc-root input { width:130px }` — id 선택자라 .sce-w-* 를 전부 이긴다. flex로 짠 곳은
  // .sce-w-l의 flex:1이 대신 버텨 줘서 여태 안 드러났고, **격자로 짠 곳만** 무너졌다.
  // v0.47.8에 같은 사고가 button으로 한 번 있었다 — 되풀이라 어서션으로 못 박는다.
  {
    const blanket = /#sc-root input \{[^}]*width:\s*130px/.test(src);
    ck('관리 패널에 input 폭을 통으로 박는 규칙이 있다 (아래 어서션의 전제)', blanket, '');
    const guards = ['s', 'm', 'l'].every((k) =>
      new RegExp(`#sc-root \\.sce input\\.sce-w-${k} \\{[^}]*width:`).test(src));
    ck('★ 편집기 안에서는 .sce-w-* 폭 체계가 다시 이긴다 (id 특이도로 되돌려 둔다)',
      !blanket || (guards && /#sc-root \.sce input \{[^}]*width:\s*auto/.test(src)), '');
    ck('★ 큰 입력칸은 격자 안에서도 칸을 채운다 (flex:1에만 기대지 않는다)',
      !blanket || /#sc-root \.sce input\.sce-w-l \{[^}]*width:\s*100%/.test(src), '');
    ck('체크박스는 폭 되돌리기에 안 휩쓸린다',
      !blanket || /#sc-root \.sce input\[type="checkbox"\] \{[^}]*width:\s*auto/.test(src), '');
  }
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
