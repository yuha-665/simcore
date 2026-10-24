const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.16.0 — 💬 대화는 상담, 반영은 [🗂 정리해서 반영] (노벨 스튜디오 OOC·설정 정리 이식).
//
// 유저: "노벨 스튜디오를 만들고 직접 써 보니 저쪽처럼 구성하니까 OOC로 대화하기도 편하고, 설정 정리 버튼으로 설정집을
// 만드는 기능 자체가 쓰기 좋더라". 여기서 못 박는 것:
//   ① 순수 함수 — 정리 요청 조립(대화 기록·적용됨 표식·추가 요청·바이트 상한), reasons/note 가르기, 체크대로 자르기,
//      칸별 비교, 저장 모양·상한
//   ② 가짜 DOM — 채팅 막대(이름·새 채팅·지난 채팅·열기·지우기), 저장 통로(ai.loadChats/saveChats), 정리 → 제안 상자(이유·
//      체크·삭제/충돌 기본 해제) → 선택 반영 → 새 채팅으로
//   ③ 배선 — 어댑터 저장 키, CSS, 규약
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const E = SC.require('editor');
const { validateSchema } = SC.require('validate');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };

const BASE = {
  simcore: '0.1', meta: { name: '정리 실험대', notes: '- 모르면 모른다고 할 것' },
  vars: [{ id: 'gold', label: '금화', type: 'int', init: 100, min: 0 }],
  rules: { events: [{ id: 'broke', when: 'gold < 1', notify: '금고가 비었다.' }] },
  actions: [{ id: 'work', label: '⚒ 노역', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold + 10' }] }],
  statusUI: { mode: 'auto', groups: [] },
};
ck('실험대 스키마 유효', validateSchema(BASE).ok, '');

console.log('── ① 순수 함수');
{
  const msgs = [
    { role: 'user', text: '세금이 왜 있어?' },
    { role: 'ai', text: '월세 대신이에요.' },
    { role: 'ai', text: '넣었어요.', json: '{"patchVersion":1}', applied: '추가 vars:tax' },
    { role: 'ai', text: '이건 어때요.', json: '{"patchVersion":1}', pending: false },
    { role: 'user', text: '그럼 산적도 넣자', kind: 'extract' },
  ];
  const t = E.chatTranscript(msgs);
  ck('★ 기록은 제작자/어시스턴트 줄 + 적용됨·안 됨 표식, JSON 원문 없음',
    t.startsWith('제작자: 세금이 왜 있어?') && t.includes('어시스턴트: 월세 대신이에요.') && t.includes('[이 수정안은 작업본에 적용됨 — 추가 vars:tax]')
    && t.includes('[이 수정안은 적용되지 않음]') && !t.includes('patchVersion') && t.endsWith('제작자: 그럼 산적도 넣자'), t);
  const big = [{ role: 'user', text: 'ㄱ'.repeat(9000) }, { role: 'ai', text: '답' }, { role: 'user', text: '가'.repeat(9000) }];
  const tb = E.chatTranscript(big, 30 * 1024);
  ck('바이트 상한 — 오래된 것부터 버린다 (27KB + 작은 답 + 27KB > 30KB → 첫 줄만 빠진다)', !tb.includes('ㄱ') && tb.startsWith('어시스턴트: 답') && tb.includes('제작자: 가'), String(tb.length));
  ck('빈 대화 → 빈 문자열', E.chatTranscript([]) === '' && E.chatTranscript(null) === '', '');

  const rules = E.extractRules(false).join('\n'), rulesB = E.extractRules(true).join('\n');
  ck('정리 규약 — 합의된 것만·적용됨 재출력 금지·지어내지 않기·reasons·note', rules.includes('## 정리 규약') && rules.includes('반영하기로 합의된 것') && rules.includes('"[적용됨]" 표식이 붙은 것은 다시 내지 마세요') && rules.includes('"reasons"') && rules.includes('"note"'), '');
  ck('빈 작업본 정리 규약은 스키마 JSON · reasons 없음', rulesB.includes('스키마 JSON 하나') && !rulesB.includes('"reasons"'), '');

  const req = E.buildExtractRequest(BASE, msgs, '산적은 경계 변수로', '### 봇 설명\n겨울 영지', [{ ts: 1, via: 'chat', req: 'x', sum: '삭제 1', ids: ['tax_due'] }]);
  ck('★ 시스템 = 📌 지침 → 정리 규약 → 패치 규격서(다이제스트) → 작업 내역', req.system.indexOf('📌 사용자 작업 지침') < req.system.indexOf('## 정리 규약')
    && req.system.indexOf('## 정리 규약') < req.system.indexOf('## 패치 형식') && req.system.includes('broke') && req.system.includes('겨울 영지') && req.system.includes('tax_due'), req.system.slice(0, 200));
  ck('★ 요청 칸에 "대화에서 합의된 것 전부 — 특히: 추가 요청"', req.system.includes('아래 <대화>에서 작업본에 반영하기로 합의된 것 전부 — 특히: 산적은 경계 변수로'), '');
  ck('단발 마감 "패치 JSON 하나만"이 살아 있다 (대화 꼬리 아님)', req.system.includes('**패치 JSON 하나만** 출력하세요') && !req.system.includes('## 대화 규약이 우선'), '');
  ck('★ 메시지 하나 = <대화> + 추가 요청 + 지시', req.messages.length === 1 && req.messages[0].role === 'user' && req.messages[0].content.startsWith('<대화>\n제작자: 세금이')
    && req.messages[0].content.includes('</대화>') && req.messages[0].content.includes('제작자의 추가 요청: 산적은 경계 변수로') && req.messages[0].content.includes('패치 JSON 하나로 출력하세요'), req.messages[0].content.slice(-120));
  const reqB = E.buildExtractRequest({}, msgs, '', '');
  ck('빈 작업본 → 통짜 규격서 + 스키마 지시', reqB.system.includes('## 출력 형식') && !reqB.system.includes('## 패치 형식') && reqB.messages[0].content.includes('스키마 JSON 하나를 출력하세요') && !reqB.messages[0].content.includes('추가 요청'), '');

  const sp = E.splitProposal('{"patchVersion":1,"add":{"vars":[{"id":"raid","label":"경계","type":"int","init":0}]},"reasons":{"vars:raid":"습격 조건","nope":""},"note":"상태창은 [상태창] 탭에서"}');
  ck('★ reasons·note를 떼고 패치 본문만', sp.ok && sp.reasons['vars:raid'] === '습격 조건' && !('nope' in sp.reasons) && sp.note === '상태창은 [상태창] 탭에서' && !('reasons' in sp.body) && !('note' in sp.body) && sp.body.add.vars[0].id === 'raid', JSON.stringify(sp));
  ck('note만 → body null (반영할 것 없음)', (() => { const s = E.splitProposal('{"note":"없어요"}'); return s.ok && s.body === null && s.note === '없어요'; })(), '');
  ck('patchVersion만 있어도 빈 것', E.splitProposal('{"patchVersion":1}').body === null, '');
  ck('깨진 JSON → ok false + 사유', !E.splitProposal('{x').ok && /문법/.test(E.splitProposal('{x').error), '');
  ck('배열·원시값 → 거부', !E.splitProposal('[1]').ok && !E.splitProposal('"a"').ok, '');

  const patch = { add: { vars: [{ id: 'a' }, { id: 'b' }], events: [{ id: 'e' }] }, update: { actions: [{ id: 'work' }] }, remove: { vars: ['gold'], events: ['broke'] } };
  const p2 = E.pickPatch(patch, { 'add:vars:b': false, 'update:actions:work': false, 'remove:vars:gold': true });
  ck('★ 체크대로 자르기 — add는 false만 빠지고, update 빈 섹션은 사라지고, remove는 true만',
    p2.add.vars.length === 1 && p2.add.vars[0].id === 'a' && p2.add.events.length === 1 && !('actions' in p2.update) && p2.remove.vars.join() === 'gold' && !('events' in p2.remove), JSON.stringify(p2));
  ck('원본은 안 건드린다', patch.add.vars.length === 2 && patch.remove.events.length === 1, '');

  const d = E.entryDiffLines({ id: 'work', label: '노역', mode: 'oneshot', cooldown: 2 }, { id: 'work', label: '⚒ 노역', mode: 'oneshot', inject: '땀' });
  ck('★ 칸별 비교 — 바뀐 칸만, id 제외, 사라진 칸은 after undefined', d.length === 3 && d.find((x) => x.key === 'label').after === '⚒ 노역' && d.find((x) => x.key === 'cooldown').after === undefined && d.find((x) => x.key === 'inject').before === undefined && !d.some((x) => x.key === 'mode' || x.key === 'id'), JSON.stringify(d));

  const s = E.sanitizeChats({ current: { id: 'c1', title: 'x'.repeat(100), msgs: [{ role: 'user', text: 'q' }, { role: 'ai', text: 'a', applied: '추가 1', json: '{}', pending: true }, { role: 'bot', text: 'no' }, { role: 'ai', text: '' }] },
    shelf: [{ id: 's1', title: '', msgs: [{ role: 'user', text: 'old' }], at: 5 }, { id: 's2', msgs: [] }, 'x'] });
  ck('★ 저장 모양 — 역할·글만, applied 유지, json·pending 버림, 제목 60자, 빈 채팅·깨진 것 제외',
    s.current.msgs.length === 2 && s.current.msgs[1].applied === '추가 1' && !('json' in s.current.msgs[1]) && !('pending' in s.current.msgs[1]) && s.current.title.length <= 60 && s.shelf.length === 1 && s.shelf[0].id === 's1', JSON.stringify(s));
  const many = { current: { msgs: Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', text: 'm' + i })) }, shelf: Array.from({ length: 30 }, (_, i) => ({ id: 's' + i, msgs: [{ role: 'user', text: 'x' }] })) };
  const sm = E.sanitizeChats(many);
  ck('상한 — 지금 채팅 80개(최근 것), 지난 채팅 12개', sm.current.msgs.length === 80 && sm.current.msgs[79].text === 'm199' && sm.shelf.length === 12, `${sm.current.msgs.length}/${sm.shelf.length}`);
  const fat = { current: { msgs: [] }, shelf: Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, msgs: [{ role: 'user', text: 'ㄱ'.repeat(20000) }] })) };
  ck('바이트 상한 400KB — 오래된 지난 채팅부터 버린다', E.sanitizeChats(fat).shelf.length < 12 && E.sanitizeChats(fat).shelf[0].id === 's0', String(E.sanitizeChats(fat).shelf.length));
  ck('깨진 입력에도 안 던진다', E.sanitizeChats(null).shelf.length === 0 && E.sanitizeChats('x').current.msgs.length === 0, '');
  ck('채팅 이름 — 제목 > 첫 질문 30자 > 새 채팅', E.chatName('내 제목', []) === '내 제목' && E.chatName('', [{ role: 'ai', text: 'a' }, { role: 'user', text: 'ㄱ'.repeat(50) }]).length === 30 && E.chatName('', []) === '새 채팅', '');
}

// ── 가짜 DOM ──
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
  global.document = makeDom();
  global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (f) => f(), setTimeout, clearTimeout };
  global.navigator = { clipboard: { writeText: async () => {} } };
  const { createSchemaEditor } = SC.require('editor');

  console.log('── ② 채팅 막대 · 저장 · 정리 → 제안 → 반영');
  const calls = [];
  let reply = () => '월세 대신이에요. 넣으려면 [🗂 정리해서 반영]을 누르세요.';
  let stored = null;
  const ai = {
    generate: async (input) => { calls.push(input); return reply(input); },
    getBotContext: async () => ({ name: '실험봇', desc: '겨울 영지', lore: [] }),
    getGenModel: async () => ({ choice: 'main', staticId: '' }),
    setGenModel: async () => {}, getModelIds: async () => null,
    loadChats: async () => null, saveChats: async (o) => { stored = JSON.parse(JSON.stringify(o)); },
  };
  const container = document.createElement('div');
  const ed = createSchemaEditor(container, JSON.parse(JSON.stringify(BASE)), { onChange: () => {}, ai });
  btn(container, '💬 대화').click();
  const pane = () => findAll(container, (e) => e.className === 'sce-chat')[0];
  const bar = () => findAll(container, (e) => e.className === 'sce-ooc-bar')[0];
  const area = () => findAll(container, (e) => e.tagName === 'TEXTAREA' && e.className.includes('sce-chat-input'))[0];
  const bubbles = () => findAll(container, (e) => (e.className || '').startsWith('sce-chat-msg'));
  const send = async (t) => { area().value = t; area().oninput(); btn(container, '보내기').click(); await settle(); };
  const extract = async (t = '') => { area().value = t; area().oninput(); btn(container, '🗂 정리해서 반영').click(); await settle(); };
  const boxes = () => findAll(container, (e) => (e.className || '').includes('sce-prop-item'));
  const checks = () => findAll(container, (e) => e.tagName === 'INPUT' && e.getAttribute('type') === 'checkbox' && e.getAttribute('aria-label') === '이 항목 반영');

  ck('★ 채팅 막대 — 💬·이름 칸·[＋ 새 채팅]·[📂 지난 채팅 0]·[🗑 지우기]', !!bar() && !!findAll(bar(), (e) => e.className === 'sce-ooc-title')[0] && !!btn(bar(), '＋ 새 채팅') && !!btn(bar(), '📂 지난 채팅 0') && !!btn(bar(), '🗑 지우기'), '');
  ck('빈 채팅이면 새 채팅·지우기 비활성', btn(bar(), '＋ 새 채팅').disabled === true && btn(bar(), '🗑 지우기').disabled === true, '');
  ck('★ ⚙ 모델·전송·지침은 접이식 한 줄 (모델 라벨은 다음 렌더부터 정확 — 첫 렌더는 읽는 중)', !!findAll(container, (e) => e.tagName === 'DETAILS' && (e.className || '').includes('sce-chat-settings'))[0] && (pane().textContent || '').includes('⚙ 모델·전송·지침 — ') && (pane().textContent || '').includes('📌 지침'), (pane().textContent || '').slice(0, 120));
  ck('빈 안내가 정리 버튼·새 채팅을 말한다', (pane().textContent || '').includes('[🗂 정리해서 반영]') && (pane().textContent || '').includes('[＋ 새 채팅]'), '');
  ck('정리 버튼은 대화도 초안도 없으면 비활성', btn(container, '🗂 정리해서 반영').disabled === true, '');

  await send('세금이 왜 있어?');
  await send('그럼 산적 습격을 넣자. 경계 변수 raid_alert 0~10, 5 이상이면 금화 50 빼는 이벤트');
  ck('상담 턴 — 말풍선 4, 제안 상자 없음, 작업본 그대로', bubbles().length === 4 && !btn(container, '개 반영') && ed.getSchema().vars.length === 1, String(bubbles().length));
  ck('★ 상담 시스템 프롬프트에 "JSON을 붙이지 않습니다"', calls[0].system.includes('JSON을 붙이지 않습니다') && calls[0].system.includes('🗂 정리해서 반영'), '');
  await wait(600);
  ck('★ 저장 통로 — 지금 채팅 4개 + id + 지난 채팅 0', !!stored && stored.current.msgs.length === 4 && typeof stored.current.id === 'string' && stored.current.id && stored.shelf.length === 0, JSON.stringify(stored).slice(0, 160));
  ck('이름 칸 자리글 = 첫 질문', findAll(bar(), (e) => e.className === 'sce-ooc-title')[0].getAttribute('placeholder') === '세금이 왜 있어?', findAll(bar(), (e) => e.className === 'sce-ooc-title')[0].getAttribute('placeholder'));
  ck('막대 — 메시지 4개, 새 채팅·지우기 활성', (bar().textContent || '').includes('메시지 4개') && btn(bar(), '＋ 새 채팅').disabled === false, '');

  // 🗂 정리 — 추가 둘(변수·이벤트) + 수정 하나 + 삭제 하나, reasons·note
  reply = () => '```json\n' + JSON.stringify({ patchVersion: 1,
    add: { vars: [{ id: 'raid_alert', label: '산적 경계', type: 'int', init: 0, min: 0, max: 10 }],
      events: [{ id: 'bandit_raid', when: 'raid_alert >= 5', effects: [{ set: 'gold', expr: 'max(0, gold - 50)' }], notify: '산적이 습격했다.' }] },
    update: { actions: [{ id: 'work', label: '⚒ 노역 (경계+1)', effects: [{ set: 'gold', expr: 'gold + 10' }, { set: 'raid_alert', expr: 'min(10, raid_alert + 1)' }] }] },
    remove: { events: ['broke'] },
    reasons: { 'vars:raid_alert': '습격 조건이 읽을 값', 'events:bandit_raid': '대화에서 정한 5 이상', 'actions:work': '노역이 경계를 올린다고 했음', 'events:broke': '대화에 안 나왔지만 안 쓰이는 듯' },
    note: '상태창에 경계 막대는 [상태창] 탭에서 추가하세요.' }) + '\n```';
  await extract('삭제 후보도 같이 봐줘');
  const req = calls.at(-1);
  ck('★ 정리 요청 — 시스템은 정리 규약, 메시지는 <대화>(+추가 요청)', req.system.includes('## 정리 규약') && !req.system.includes('## 대화 규약') && req.messages.length === 1 && req.messages[0].content.includes('<대화>\n제작자: 세금이 왜 있어?') && req.messages[0].content.includes('제작자의 추가 요청: 삭제 후보도 같이 봐줘'), req.messages[0].content.slice(0, 120));
  ck('★ 말풍선 — 🗂 정리 요청(추가 요청 포함) + 🗂 정리 답(note)', bubbles().length === 6 && bubbles()[4].textContent.includes('🗂 정리해서 반영 — 삭제 후보도 같이 봐줘') && bubbles()[5].className.includes('is-extract') && bubbles()[5].textContent.includes('🗂 정리했어요 — 상태창에 경계 막대는'), bubbles().map((b) => b.textContent.slice(0, 30)).join(' | '));
  ck('입력창은 비워진다', area().value === '', area().value);
  const prop = () => findAll(container, (e) => (e.className || '').includes('sce-proposal') && !(e.className || '').includes('sce-proposal-'))[0];
  ck('★ 제안 상자 — 추가 2 · 수정 1 · 삭제 1, 항목 4', !!prop() && (prop().textContent || '').includes('추가 2 · 수정 1 · 삭제 1') && boxes().length === 4, prop() && prop().textContent.slice(0, 120));
  ck('★ 항목마다 💡 이유', boxes().every((b) => (b.textContent || '').includes('💡')) && (prop().textContent || '').includes('습격 조건이 읽을 값'), '');
  ck('새 항목은 본문(JSON), 수정은 칸별 전/후', (boxes()[0].textContent || '').includes('"label": "산적 경계"') && (boxes()[2].textContent || '').includes('label: ') && (boxes()[2].textContent || '').includes('⚒ 노역 (경계+1)') && (boxes()[2].textContent || '').includes('effects: '), boxes()[2].textContent.slice(0, 200));
  ck('★ 삭제는 기본 해제 (is-off) — 추가·수정은 켜짐', boxes()[3].className.includes('is-off') && !boxes()[0].className.includes('is-off') && !boxes()[2].className.includes('is-off'), boxes().map((b) => b.className).join(' | '));
  ck('적용 버튼 = 선택한 3개 반영', !!btn(container, '선택한 3개 반영'), '');
  ck('★ 전체 선택/해제 (항목 4개↑)', !!btn(container, '추가·수정 전체 선택') && !!btn(container, '전체 해제'), '');
  // 이벤트 추가는 빼고 반영
  const ev = checks()[1];
  ev.checked = false; ev.onchange();
  ck('체크를 끄면 is-off + 버튼 2개', boxes()[1].className.includes('is-off') && !!btn(container, '선택한 2개 반영'), '');
  btn(container, '선택한 2개 반영').click(); await settle();
  const sch = ed.getSchema();
  ck('★ 반영 — 변수 추가·액션 수정만, 이벤트 추가 안 됨, broke 안 지워짐', sch.vars.some((v) => v.id === 'raid_alert') && !sch.rules.events.some((e) => e.id === 'bandit_raid') && sch.rules.events.some((e) => e.id === 'broke') && sch.actions[0].label === '⚒ 노역 (경계+1)', JSON.stringify({ vars: sch.vars.map((v) => v.id), ev: sch.rules.events.map((e) => e.id), a: sch.actions[0].label }));
  ck('정리 말풍선에 ✅ 적용됨', bubbles()[5].textContent.includes('✅ 적용됨') && bubbles()[5].textContent.includes('raid_alert'), bubbles()[5].textContent.slice(-100));
  ck('적용 내역 + 되돌리기', !!btn(container, '적용 전으로 되돌리기') && !prop(), '');
  ck('다음 정리 기록에 "[적용됨]"이 실려 다시 안 낸다', E.chatTranscript(ed.getSchema() && []) === '' && true, ''); // 형식만 — 실제 기록은 아래 호출에서 본다

  // 삭제 항목만 체크해서 반영
  reply = () => '```json\n{"patchVersion":1,"remove":{"events":["broke"]},"reasons":{"events:broke":"안 쓰임"}}\n```';
  await extract();
  ck('삭제만 온 제안 — 기본 해제라 "선택한 0개 반영" 비활성', boxes().length === 1 && boxes()[0].className.includes('is-off') && btn(container, '선택한 0개 반영').disabled === true, '');
  ck('★ 정리 기록에 앞서 적용된 것이 표식으로 실린다', calls.at(-1).messages[0].content.includes('[이 수정안은 작업본에 적용됨 —'), '');
  checks()[0].checked = true; checks()[0].onchange();
  btn(container, '선택한 1개 반영').click(); await settle();
  ck('★ 체크한 삭제는 지워진다', !ed.getSchema().rules.events.some((e) => e.id === 'broke'), '');

  // 충돌 — 이미 있는 id를 add로: 기본 해제, 체크하면 교체
  reply = () => '```json\n{"patchVersion":1,"add":{"vars":[{"id":"gold","label":"금화(교체)","type":"int","init":5,"min":0}]}}\n```';
  await extract();
  ck('★ 충돌 항목 — 배지 충돌·기본 해제', boxes().length === 1 && boxes()[0].className.includes('is-conflict') && boxes()[0].className.includes('is-off') && (boxes()[0].textContent || '').includes('충돌'), boxes()[0].className);
  checks()[0].checked = true; checks()[0].onchange();
  ck('켜면 교체/새 id 선택 + 기존↔새것', (boxes()[0].textContent || '').includes('기존: 금화 ↔ 새것: 금화(교체)') && !!findAll(boxes()[0], (e) => e.tagName === 'SELECT')[0], boxes()[0].textContent.slice(0, 200));
  btn(container, '선택한 1개 반영').click(); await settle();
  ck('★ 기본 교체 → gold가 새 정의로', ed.getSchema().vars.find((v) => v.id === 'gold').label === '금화(교체)', '');

  // "반영한 뒤 새 채팅으로" → 지금 채팅은 📂 지난 채팅으로
  reply = () => '```json\n{"patchVersion":1,"add":{"vars":[{"id":"fame","label":"명성","type":"int","init":0}]},"note":"끝"}\n```';
  await extract();
  const freshCb = findAll(container, (e) => e.tagName === 'INPUT' && e.getAttribute('type') === 'checkbox' && !e.getAttribute('aria-label') && e.parentNode && (e.parentNode.textContent || '').includes('새 채팅으로'))[0];
  ck('[반영한 뒤 새 채팅으로] 체크', !!freshCb, '');
  freshCb.checked = true; freshCb.onchange();
  const before = bubbles().length;
  btn(container, '선택한 1개 반영').click(); await settle();
  ck('★ 반영 + 새 채팅 — 말풍선 0, 📂 지난 채팅 1, fame 들어감', bubbles().length === 0 && !!btn(bar(), '📂 지난 채팅 1') && ed.getSchema().vars.some((v) => v.id === 'fame'), `${before}→${bubbles().length}`);
  await wait(600);
  ck('저장 통로 — 지금 비고 지난 채팅 1개(메시지 있음, 적용됨 표식 유지)', stored.current.msgs.length === 0 && stored.shelf.length === 1 && stored.shelf[0].msgs.length > 0 && stored.shelf[0].msgs.some((m) => m.applied), JSON.stringify(stored).slice(0, 200));

  // 📂 지난 채팅 열기 → 자리 바꾸기
  await send('새 채팅의 첫 말');
  btn(bar(), '📂 지난 채팅 1').click(); await settle();
  const openBtn = findAll(bar(), (e) => e.tagName === 'BUTTON' && (e.className || '').includes('sce-ooc-open'))[0];
  ck('★ 목록에 지난 채팅 한 줄(첫 질문 이름)', !!openBtn && (openBtn.textContent || '').includes('세금이 왜 있어?'), openBtn && openBtn.textContent);
  openBtn.click(); await settle();
  ck('★ 열기 — 옛 채팅이 돌아오고(✅ 표식 유지) 지금 채팅은 지난 채팅으로', bubbles().length > 2 && bubbles()[0].textContent.includes('세금이 왜 있어?') && bubbles().some((b) => b.textContent.includes('✅ 적용됨')) && !!btn(bar(), '📂 지난 채팅 1'), String(bubbles().length));
  btn(bar(), '📂 지난 채팅 1').click(); await settle();
  const sh = findAll(bar(), (e) => e.tagName === 'BUTTON' && (e.className || '').includes('sce-ooc-open'))[0];
  ck('바뀐 지난 채팅 = 새 채팅의 첫 말', !!sh && (sh.textContent || '').includes('새 채팅의 첫 말'), sh && sh.textContent);
  findAll(bar(), (e) => e.tagName === 'BUTTON' && e.getAttribute('aria-label') === '이 채팅 지우기')[0].click(); await settle();
  ck('지난 채팅 지우기 → 0', !!btn(bar(), '📂 지난 채팅 0'), '');

  // 🗑 두 번
  btn(bar(), '🗑 지우기').click(); await settle();
  ck('첫 누름은 무장만 — 말풍선 그대로', bubbles().length > 0 && !!btn(bar(), '한 번 더 누르면 지워요'), '');
  btn(bar(), '한 번 더 누르면 지워요').click(); await settle();
  ck('★ 두 번째 누름 → 빈 채팅', bubbles().length === 0 && !!btn(bar(), '🗑 지우기'), '');

  // 되살리기 — 저장된 것으로 편집기를 다시 열면 그대로
  const c2 = document.createElement('div');
  const ai2 = { ...ai, loadChats: async () => ({ current: { id: 'k1', title: '내 상담', msgs: [{ role: 'user', text: '저장된 질문', ts: 1 }, { role: 'ai', text: '저장된 답', ts: 2, applied: '추가 1' }] },
    shelf: [{ id: 'k0', title: '', msgs: [{ role: 'user', text: '옛 질문' }], at: 3 }] }) };
  createSchemaEditor(c2, JSON.parse(JSON.stringify(BASE)), { onChange: () => {}, ai: ai2 });
  await settle();
  btn(c2, '💬 대화').click(); await settle();
  const b2 = findAll(c2, (e) => (e.className || '').startsWith('sce-chat-msg'));
  ck('★ 되살림 — 말풍선 2(✅ 표식), 이름 칸 "내 상담", 📂 지난 채팅 1', b2.length === 2 && b2[1].textContent.includes('✅ 적용됨 — 추가 1') && findAll(c2, (e) => e.className === 'sce-ooc-title')[0].value === '내 상담' && !!btn(c2, '📂 지난 채팅 1'), String(b2.length));

  // 정리가 "반영할 것 없음"으로 오면 상자 없이 말풍선만
  reply = () => '{"note":"합의된 것이 없어요"}';
  const c3 = document.createElement('div');
  createSchemaEditor(c3, JSON.parse(JSON.stringify(BASE)), { onChange: () => {}, ai });
  btn(c3, '💬 대화').click();
  const a3 = findAll(c3, (e) => e.tagName === 'TEXTAREA' && e.className.includes('sce-chat-input'))[0];
  a3.value = '아무거나'; a3.oninput(); btn(c3, '🗂 정리해서 반영').click(); await settle();
  const b3 = findAll(c3, (e) => (e.className || '').startsWith('sce-chat-msg'));
  ck('★ 반영할 것 없음 → "🗂 반영할 것이 없대요 — …" + 상자 없음', b3.length === 2 && b3[1].textContent.includes('🗂 반영할 것이 없대요 — 합의된 것이 없어요') && !btn(c3, '개 반영'), b3.map((b) => b.textContent).join(' | '));

  console.log('── ③ 배선');
  ck('어댑터 저장 통로 — sim:chats:<chaId>', src.includes('loadChats: async () =>') && src.includes('sim:chats:${currentChaId}') && src.includes('saveChats: async (obj) =>'), '');
  ck('CSS — 막대·제안 상자·배지', src.includes('.sce .sce-ooc-bar {') && src.includes('.sce .sce-prop-item {') && src.includes('.sce .sce-prop-badge.is-conflict {'), '');
  { // 💬 대화 탭에서만 — 🛠 봇 제작 대화(설정집, 저장 안 함)의 🧹는 따로 산다 (v1.20.0 합류)
    const i = src.indexOf('  function chatPane() {'), j = src.indexOf('  function bibleChatPane() {');
    ck('옛 [🧹 대화 초기화]는 💬 대화 탭에서 사라졌다', i > 0 && j > i && !src.slice(i, j).includes('🧹 대화 초기화'), '');
  }
  ck('버전 1.20.0 이상 + 체인지로그', /\/\/@version (1\.([2-9]\d)\.\d+|[2-9]\.\d+\.\d+)/.test(src) && src.includes('(cli-bridge의 v1.16.0)'), '');

  console.log(`\n[test-ooc] ${pass}/${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL 예외:', e.stack || e); process.exit(1); });
