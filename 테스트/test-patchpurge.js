const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.20.1 — 패치로 변수를 지우면 그 참조도 같이 정리한다 (커뮤니티 제보).
//
// 제보: "💬 대화로 수정할 때 삭제를 체크해도 삭제가 안 된다 — 뭔가 지울 때만
//   ✖ $.promptState.template: 템플릿의 알 수 없는 변수 'pop_goblin'
// 이 뜬다." 상태 요약(promptState)·상태창·새 시작은 패치로 못 고치는 자리라 AI가 같이 지울 길이 없고,
// 그 {id} 하나가 applyPatch의 마지막 관문에서 '새 오류'가 되어 패치 전체를 거부했다. v1.20.0 🗂 정리해서 반영도 같은 문이었다.
// 여기서 못 박는 것:
//   ① patch.js — opts.purge 훅: 정리기 없으면 종전대로 거부, 있으면 병합본에서 참조를 걷고 applied.purged에 남김,
//      AI가 고친 항목은 안 건드림, 정체성 참조(시나리오 해금)·🔒 보호 항목은 통째로 거부(purgeBlocked), 지울 변수가 없으면 안 부름
//   ② 가짜 DOM — 🗂 정리 제안에서 삭제를 체크하면 🧹 미리보기가 뜨고, 반영하면 상태 요약까지 정리돼 들어간다
//   ③ 배선 — 두 반영 경로가 정리기를 넘김, AI 패치 규칙 한 줄, 버전
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const PM = SC.require('patch');
const { validateSchema } = SC.require('validate');
const { referencedVars } = SC.require('expr');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };

// 편집기의 정리 계층만 뽑아 쓴다 (test-purge와 같은 추출) — 편집기가 applyPatch에 넘기는 것과 같은 모양으로 감싼다
const purgeSeg = src.slice(src.indexOf('function exprHits'), src.indexOf('/** AI에게'));
const PV = new Function('validateSchema', 'referencedVars',
  purgeSeg + '\nreturn { planVarPurge };')(validateSchema, referencedVars);
const OPTS = { purge: (s, ids) => { const p = PV.planVarPurge(s, ids); return { schema: p.schema, notes: p.notes, blockers: p.blockers }; } };

const clone = (x) => JSON.parse(JSON.stringify(x));
const BASE = {
  simcore: '0.1', meta: { name: '고블린 실험대' },
  vars: [
    { id: 'gold', label: '금화', type: 'int', init: 100, min: 0 },
    { id: 'pop_goblin', label: '고블린 수', type: 'int', init: 3, min: 0 },
  ],
  rules: { events: [{ id: 'horde', when: 'pop_goblin > 5', notify: '고블린 떼가 몰려온다.' }] },
  directives: [{ id: 'd_gob', when: 'true', text: '고블린 {pop_goblin}마리, 금화 {gold}.' }],
  statusUI: { mode: 'auto', groups: [{ label: '마을', items: [{ var: 'gold' }, { var: 'pop_goblin' }] }] },
  promptState: { template: '[마을]\n금화 {gold}\n고블린 {pop_goblin}마리' },
};
const RM = { patchVersion: 1, remove: { vars: ['pop_goblin'] } };

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

(async () => {
  ck('실험대 스키마 유효', validateSchema(BASE).ok, JSON.stringify(validateSchema(BASE).errors));

  console.log('── ① patch.js — opts.purge 훅');
  {
    const r0 = PM.applyPatch(clone(BASE), RM);
    ck('★ 제보 재현 — 정리기 없으면 종전대로 거부, 사유가 상태 요약의 알 수 없는 변수',
      !r0.ok && r0.errors.some((e) => e.includes('$.promptState.template') && e.includes("'pop_goblin'")), JSON.stringify(r0.errors));

    const S = clone(BASE);
    const r = PM.applyPatch(S, RM, {}, OPTS);
    ck('★ 정리기를 주면 반영된다', r.ok, JSON.stringify(r.errors));
    ck('변수 본체가 사라짐', r.ok && !r.schema.vars.some((v) => v.id === 'pop_goblin') && r.applied.removed.includes('vars:pop_goblin'), '');
    ck('★ 상태 요약 — 값이 안 남는 줄은 줄째', r.ok && r.schema.promptState.template === '[마을]\n금화 {gold}', r.ok && JSON.stringify(r.schema.promptState.template));
    ck('상태창 항목도', r.ok && r.schema.statusUI.groups[0].items.map((i) => i.var).join() === 'gold', r.ok && JSON.stringify(r.schema.statusUI));
    ck('지시문 자리표시자 (다른 값이 남는 줄은 남김)', r.ok && r.schema.directives[0].text === '고블린 마리, 금화 {gold}.', r.ok && r.schema.directives[0].text);
    ck('발동 조건이 지운 값을 보던 이벤트는 통째로', r.ok && !(r.schema.rules.events || []).some((e) => e.id === 'horde'), '');
    const P = (r.applied && r.applied.purged) || [];
    ck('★ applied.purged에 정리한 자리가 남는다 (AI 설정·상태창·지시문·이벤트)',
      ['AI 설정', '상태창', '지시문', '이벤트'].every((w) => P.some((n) => n.includes(w))), JSON.stringify(P));
    ck('원본 작업본은 그대로', S.vars.length === 2 && S.promptState.template.includes('{pop_goblin}'), '');
    ck('결과 스키마는 검증 통과', r.ok && validateSchema(r.schema).ok, r.ok && JSON.stringify(validateSchema(r.schema).errors));

    const rU = PM.applyPatch(clone(BASE), { patchVersion: 1, update: { events: [{ id: 'horde', when: 'gold < 10', notify: '고블린 떼가 금고를 노린다.' }] }, remove: { vars: ['pop_goblin'] } }, {}, OPTS);
    ck('★ AI가 같은 패치에서 고친 항목은 정리 대상이 아니다 (horde는 남고 새 조건)',
      rU.ok && rU.schema.rules.events.some((e) => e.id === 'horde' && e.when === 'gold < 10') && !rU.applied.purged.some((n) => n.includes('horde')), JSON.stringify(rU.errors || rU.applied.purged));

    let called = 0;
    const spy = { purge: (s, ids) => { called++; return OPTS.purge(s, ids); } };
    const rN = PM.applyPatch(clone(BASE), { patchVersion: 1, add: { vars: [{ id: 'fame', label: '명성', type: 'int', init: 0 }] }, remove: { events: ['horde'] } }, {}, spy);
    ck('지울 변수가 없으면 정리기를 안 부른다 (이벤트 삭제·추가만)', rN.ok && called === 0 && rN.applied.purged.length === 0, `${rN.ok} ${called}`);

    const S2 = clone(BASE);
    S2.scenario = { acts: [{ id: 'a1', label: '시작', direct: '평온한 마을.' }, { id: 'a2', label: '습격', unlock: 'pop_goblin >= 5', direct: '고블린이 몰려온다.' }] };
    ck('실험대 2 (시나리오 해금이 그 값을 봄) 유효', validateSchema(S2).ok, JSON.stringify(validateSchema(S2).errors));
    const rB = PM.applyPatch(S2, RM, {}, OPTS);
    ck('★ 정체성 참조(시나리오 해금)는 통째로 거부 + purgeBlocked',
      !rB.ok && rB.purgeBlocked === true && rB.errors.some((e) => e.includes('시나리오') && e.includes('해금')), JSON.stringify(rB.errors));

    const S3 = clone(BASE);
    S3.rules.events[0].keep = true;
    const rK = PM.applyPatch(S3, RM, {}, OPTS);
    ck('★ 🔒 보호 이벤트가 지운 값을 쓰면 통째로 거부 (정리기가 보호 항목을 지우지 않게)',
      !rK.ok && rK.purgeBlocked === true && rK.errors.some((e) => e.includes('🔒') && e.includes('horde')), JSON.stringify(rK.errors));
    ck('거부해도 원본은 그대로', S3.vars.length === 2 && S3.rules.events.length === 1, '');
  }

  console.log('── ② 가짜 DOM — 🗂 정리 제안 → 삭제 체크 → 🧹 미리보기 → 반영');
  {
    global.document = makeDom();
    global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (f) => f(), setTimeout, clearTimeout };
    global.navigator = { clipboard: { writeText: async () => {} } };
    const { createSchemaEditor } = SC.require('editor');
    let reply = () => '좋아요, 고블린 수는 빼죠. 넣으려면 [🗂 정리해서 반영]을 누르세요.';
    const ai = {
      generate: async () => reply(),
      getBotContext: async () => ({ name: '실험봇', desc: '숲가 마을', lore: [] }),
      getGenModel: async () => ({ choice: 'main', staticId: '' }),
      setGenModel: async () => {}, getModelIds: async () => null,
      loadChats: async () => null, saveChats: async () => {},
    };
    const container = document.createElement('div');
    const ed = createSchemaEditor(container, clone(BASE), { onChange: () => {}, ai });
    btn(container, '💬 대화').click();
    const area = () => findAll(container, (e) => e.tagName === 'TEXTAREA' && e.className.includes('sce-chat-input'))[0];
    area().value = '고블린 수 변수 지워줘'; area().oninput(); btn(container, '보내기').click(); await settle();
    reply = () => '```json\n{"patchVersion":1,"remove":{"vars":["pop_goblin"]},"reasons":{"vars:pop_goblin":"대화에서 지우기로 함"}}\n```';
    area().value = ''; area().oninput(); btn(container, '🗂 정리해서 반영').click(); await settle();
    const preview = () => findAll(container, (e) => (e.className || '').includes('sce-purge-preview'))[0];
    const removeCb = () => findAll(container, (e) => e.tagName === 'INPUT' && e.getAttribute('type') === 'checkbox' && e.getAttribute('aria-label') === '이 항목 반영')[0];
    ck('제안 상자 — 삭제 항목 하나, 기본 해제, 미리보기 없음', !!removeCb() && removeCb().checked === false && !preview(), '');
    removeCb().checked = true; removeCb().onchange();
    ck('★ 삭제를 체크하면 🧹 미리보기 — 같이 정리될 자리 수와 상태 요약', !!preview() && (preview().textContent || '').includes('🧹 지운 변수를 쓰던 자리도 같이 정리돼요')
      && (preview().textContent || '').includes('AI 설정'), preview() && preview().textContent);
    ck('미리보기는 작업본을 안 바꾼다', ed.getSchema().vars.length === 2, '');
    btn(container, '개 반영').click(); await settle();
    const s = ed.getSchema();
    ck('★ 반영 — 변수 사라지고 상태 요약에서 {pop_goblin} 줄이 빠짐', !s.vars.some((v) => v.id === 'pop_goblin') && s.promptState.template === '[마을]\n금화 {gold}', JSON.stringify(s.promptState));
    const bub = findAll(container, (e) => (e.className || '').startsWith('sce-chat-msg'));
    ck('★ 말풍선 표식에 "참조 정리 N곳"', bub.some((b) => /✅ 적용됨 — 삭제 vars:pop_goblin · 참조 정리 \d+곳/.test(b.textContent || '')), bub.map((b) => b.textContent).join(' | '));
    ck('오류 없이 반영 (✖ 줄 없음)', !findAll(container, (e) => (e.className || '') === 'sce-err' && (e.textContent || '').includes('pop_goblin'))[0], '');
  }

  console.log('── ③ 배선');
  // 셋 = 두 반영 버튼(🗂 제안 상자·변경 계획 상자) + 미리보기(purgePreviewBox). 정리기 없이 부르는 반영 버튼이 남으면 안 된다
  ck('★ 두 반영 경로(🗂 제안 상자·변경 계획 상자)와 미리보기가 정리기를 넘김', (src.match(/applyPatch\(schema, p2, resolutions, patchPurgeOpts\)/g) || []).length === 3
    && !/applyPatch\(schema, p2, resolutions\);/.test(src), '');
  ck('정리기 = planVarPurge (변수 탭 🧹와 같은 정리)', src.includes('const patchPurgeOpts = { purge: (s, ids) => { const p = planVarPurge(s, ids);'), '');
  ck('결과 보고에 참조 정리 접기', src.includes('지운 변수를 쓰던 자리 ${purged.length}곳을 같이 정리했어요'), '');
  ck('AI 패치 규칙 — 지우면 편집기가 같이 정리', src.includes('**편집기가 같이 정리**합니다'), '');
  ck('버전 1.20.1 이상 + 체인지로그', /\/\/@version (1\.(2\d)\.([1-9]\d*)|1\.([3-9]\d)\.\d+|[2-9]\.\d+\.\d+)/.test(src) && src.includes('// ── v1.20.1 ──'), '');

  console.log(`\n[test-patchpurge] ${pass}/${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL 예외:', e.stack || e); process.exit(1); });
