const __P = (...p) => require('path').resolve(__dirname, ...p);
// 💬 대화형 어시스턴트 (v1.9.0) — 프롬프트 조립·이력 접기·응답 가르기·토큰 추정 + 가짜 DOM에서 실제 왕복
// + 편집기 만드는 순서(3층 묶음 순서·띠·변수 설명 힌트). 설계: docs/design-내장-AI-생성.md "대화형 정제" 절.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── 편집기 계층 추출 (test-aigen과 같은 방식) + estTokens(구간 밖) ──
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const { estTokens } = SC.require('editor');
const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
const M = new Function('validateSchema', 'TEMPLATES', 'timeConfig', 'estTokens',
  seg + '\nreturn { chatRules, buildChatSystemPrompt, chatHistoryMessages, splitChatResponse, chatTurnEstimate, buildPatchExportPrompt, buildSchemaSpecPrompt, CHAT_HISTORY_MAX, CHAT_HISTORY_BYTES };')(
  validateSchema, TEMPLATES, SC.require('time').timeConfig, estTokens);

const BASE = {
  simcore: '0.1', meta: { name: '대화 실험대' },
  vars: [{ id: 'gold', label: '금화', type: 'int', init: 100, min: 0 }],
  rules: { events: [{ id: 'broke', when: 'gold < 1', notify: '금고가 비었다.' }] },
  actions: [{ id: 'work', label: '⚒ 노역', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold + 10' }] }],
  statusUI: { mode: 'auto', groups: [] },
};
ck('실험대 스키마 유효', validateSchema(BASE).ok, validateSchema(BASE).errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));

// ── 대화 규약 ──
{
  const full = M.chatRules(false).join('\n'), blank = M.chatRules(true).join('\n');
  ck('규약 제목 + 우선 선언', full.includes('## 대화 규약') && full.includes('출력 형식보다 우선'), '');
  ck('★ 바꿀 때만 JSON — 논의 턴엔 붙이지 마라', full.includes('바꿔야 할 때만') && full.includes('붙이지 마세요'), '');
  ck('확인이 필요하면 먼저 묻는다', full.includes('먼저 묻고'), '');
  ck('적용됨/적용되지 않음 표식 설명', full.includes('[적용됨') && full.includes('[적용되지 않음]'), '');
  ck('패치 못 다루는 절은 말로 안내', full.includes('statusUI') && full.includes('말로 안내'), '');
  ck('★ 빈 작업본 규약은 스키마 JSON (패치 아님)', blank.includes('스키마 JSON 코드펜스') && !blank.includes('패치 JSON 코드펜스'), '');
  ck('빈 작업본엔 "이미 있는 항목" 언급 없음', !blank.includes('이미 있는 항목') && !blank.includes('statusUI'), '');
}

// ── 시스템 프롬프트 — 규약 + 규격서(대화 꼬리) ──
{
  const p = M.buildChatSystemPrompt(BASE, '');
  ck('규약이 맨 앞', p.startsWith('## 대화 규약'), p.slice(0, 40));
  ck('★ 패치 규격서가 그 뒤에 (다이제스트 포함)', p.includes('## 패치 형식') && p.includes('## 이미 있는 항목') && p.includes('broke'), '');
  ck('★ 단발용 마감 "패치 JSON 하나만 출력하세요"는 빠지고 대화용 꼬리', !p.includes('**패치 JSON 하나만** 출력하세요') && p.includes('## 대화 규약이 우선'), '');
  ck('요청 칸은 "대화 이력에 있다"로', p.includes('대화 이력과 마지막 메시지에 있습니다'), '');
  ck('봇 컨텍스트 동봉', M.buildChatSystemPrompt(BASE, '### 봇 설명\n겨울 영지').includes('겨울 영지'), '');
  // v1.9.6 — 패치 밖 영역의 세부 편집기 지도 (실기: "변화 로그 끄는 법"에 "옵션 메뉴"라고 얼버무림)
  ck('★ 규약에 세부 편집기 지도 — 이번 턴 변화(변화 로그) 자리', p.includes('이번 턴 변화') && p.includes('표시하지 않기') && p.includes('[상태창] 탭') && p.includes('[새 시작] 탭'), '');
  ck('빈 작업본 규약엔 지도 없음 (고칠 작업본이 없다)', !M.buildChatSystemPrompt({}, '').includes('세부 편집기 지도'), '');
  ck('단발 patch 규격서는 그대로 (chat 없으면 마감 문구 유지)', M.buildPatchExportPrompt(BASE, { request: 'x' }).includes('**패치 JSON 하나만** 출력하세요'), '');

  const b = M.buildChatSystemPrompt({}, '');
  ck('★ 빈 작업본 → 통짜 규격서 + 대화 꼬리', b.includes('## 출력 형식') && b.includes('## 대화 규약이 우선') && !b.includes('## 패치 형식'), '');
  ck('단발 통짜 규격서엔 꼬리 없음', !M.buildSchemaSpecPrompt('business', false).includes('## 대화 규약이 우선'), '');
}

// ── 이력 접기 ──
{
  const H = M.chatHistoryMessages;
  ck('빈 이력 → []', H([]).length === 0, '');
  const msgs = [
    { role: 'user', text: '금화가 뭐야?' },
    { role: 'ai', text: '돈이에요.' },
    { role: 'user', text: '산적 넣어줘' },
    { role: 'ai', text: '넣었어요.', json: '{"patchVersion":1}', applied: '추가 bandit' },
    { role: 'user', text: '하나 더' },
    { role: 'ai', text: '이건 어때요.', json: '{"patchVersion":1,"add":{}}', pending: false },
    { role: 'user', text: '아니 이렇게' },
    { role: 'ai', text: '고쳤어요.', json: '{"patchVersion":1,"update":{}}', pending: true },
    { role: 'ai', text: '깨진 거.', jsonError: 'JSON 문법 오류', jsonRaw: '{' },
  ];
  const out = H(msgs);
  ck('역할 매핑 user/assistant', out[0].role === 'user' && out[1].role === 'assistant', JSON.stringify(out.map((m) => m.role)));
  ck('★ 적용된 패치는 요약으로 접힘 (원문 안 실림)', out[3].content.includes('[적용됨 — 추가 bandit]') && !out[3].content.includes('patchVersion'), out[3].content);
  ck('★ 버린 패치는 "[적용되지 않음]"', out[5].content.includes('[적용되지 않음]') && !out[5].content.includes('"add"'), out[5].content);
  ck('★ 계획 상자에 떠 있는 패치는 코드펜스 그대로 (후속 수정 요청용)', out[7].content.includes('```json') && out[7].content.includes('"update"'), out[7].content);
  ck('형식 불합격 JSON은 사유만', out[8].content.includes('형식 검사에 걸려') && !out[8].content.includes('{'), out[8].content);

  const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', text: `m${i}` }));
  const t = H(many);
  ck(`최근 ${M.CHAT_HISTORY_MAX}개만`, t.length === M.CHAT_HISTORY_MAX && t[t.length - 1].content === 'm29', `${t.length}`);
  ck('★ 첫 메시지는 user로 시작', t[0].role === 'user', t[0].role);
  ck('max 옵션 (4개 = user·ai·user·ai)', H(many, { max: 4 }).length === 4, '');
  const big = [{ role: 'user', text: 'ㄱ'.repeat(9000) }, { role: 'ai', text: '답' }, { role: 'user', text: '가'.repeat(9000) }];
  const tb = H(big, { bytes: 30 * 1024 });
  ck('★ 바이트 상한 — 오래된 것부터 버림 (27KB + 27KB > 30KB → 마지막만)', tb.length === 1 && tb[0].content.startsWith('가'), `${tb.length}`);
  ck('상한보다 큰 마지막 메시지 하나는 그래도 싣는다', H([{ role: 'user', text: 'ㄱ'.repeat(9000) }], { bytes: 100 }).length === 1, '');
  ck('AI로만 남으면 비운다', H([{ role: 'ai', text: '혼잣말' }]).length === 0, '');
}

// ── 응답 가르기 ──
{
  const S = M.splitChatResponse;
  const r1 = S('산적을 넣었어요.\n\n```json\n{"patchVersion":1,"add":{}}\n```');
  ck('★ 산문 + json 펜스', r1.prose === '산적을 넣었어요.' && r1.json === '{"patchVersion":1,"add":{}}', JSON.stringify(r1));
  const r2 = S('설명만.');
  ck('펜스 없음 → 논의 턴 (json null)', r2.prose === '설명만.' && r2.json === null, '');
  const r3 = S('앞말\n```\n{"a":1}\n```\n뒷말');
  ck('태그 없는 펜스도, 앞뒤 산문은 합쳐진다', r3.json === '{"a":1}' && r3.prose === '앞말\n뒷말', JSON.stringify(r3));
  const r4 = S('예시는 이렇고\n```json\n{"x":1}\n```\n실제는 이것\n```json\n{"y":2}\n```');
  ck('★ 여러 펜스면 마지막 것', r4.json === '{"y":2}' && r4.prose.includes('{"x":1}'), JSON.stringify(r4));
  // v1.9.2 — 제미니 직결 호출은 추론 블록이 본문에 실려 온다 (실기: "<Thoughts>**Testing SimCore Connection** …</Thoughts>네, 잘 들립니다!")
  const t5 = S('<Thoughts>\n\n**Testing SimCore Connection**\n\nI am verifying.\n\n</Thoughts>\n\n네, 잘 들립니다!');
  ck('★ <Thoughts> 블록은 말풍선에서 뗀다', t5.prose === '네, 잘 들립니다!' && t5.json === null, JSON.stringify(t5));
  const t6 = S('<thinking>plan</thinking>\n산적을 넣었어요.\n\n```json\n{"patchVersion":1,"add":{}}\n```');
  ck('<thinking> 뗀 뒤에도 산문·JSON 분리 그대로', t6.prose === '산적을 넣었어요.' && t6.json === '{"patchVersion":1,"add":{}}', JSON.stringify(t6));
  const t7 = S('<think>a</think><think>b</think>둘 다 뗌');
  ck('여러 블록도 전부', t7.prose === '둘 다 뗌', JSON.stringify(t7));
  const t8 = S('<Thoughts>닫히지 않은 태그 — 본문을 통째 먹지 않는다');
  ck('닫힘 없는 여는 태그는 그대로 둔다', t8.prose.includes('닫히지 않은'), JSON.stringify(t8));
  const r5 = S('식은 이렇게\n```js\ngold + 1\n```');
  ck('{로 안 시작하는 펜스(코드 예시)는 산문', r5.json === null && r5.prose.includes('gold + 1'), '');
  const r6 = S('{"patchVersion":1}');
  ck('통째 JSON(설명 없이) → json', r6.json === '{"patchVersion":1}' && r6.prose === '', '');
  ck('깨진 통째 JSON은 산문 취급', S('{이건 말이야}').json === null, '');
  ck('빈 응답', S('').prose === '' && S(null).json === null, '');
}

// ── 토큰 추정 ──
{
  const sys = 'a'.repeat(350), msgs = [{ role: 'user', content: '가'.repeat(150) }];
  ck('시스템 + 메시지 합 (ASCII 3.5자·CJK 1.5자 / 토큰)', M.chatTurnEstimate(sys, msgs) === 100 + 100, `${M.chatTurnEstimate(sys, msgs)}`);
  ck('메시지 없음', M.chatTurnEstimate('abc', null) === estTokens('abc'), '');
}

// ── 어댑터·편집기 배선 핀 ──
{
  ck('★ 어댑터 callGenLLM이 { system, messages } 입력을 받는다', src.includes('async function callGenLLM(input)') && src.includes("const chatIn = input && typeof input === 'object' ? input : null"), '');
  ck('★ 세 경로 모두 같은 메시지 배열 — 보조', src.includes('callAuxLLM(promptText, 8000, chatIn ? buildMessages(promptText) : null)'), '');
  ck('★ 메인 경로는 센티널을 시스템에 (자기 정산 함정 가드 유지)', src.includes('messages: buildMessages(GEN_SENTINEL + \'\\n\' + promptText)'), '');
  ck('callAuxLLM messages 인자 — 없으면 예전 그대로 system+AUX_NUDGE', src.includes('async function callAuxLLM(promptText, maxTokens, messages = null)')
    && src.includes("messages: messages || [{ role: 'system', content: promptText }, { role: 'user', content: AUX_NUDGE }]"), '');
  ck('ai 역할도 assistant로 정규화', src.includes("m.role === 'ai' || m.role === 'assistant' ? 'assistant' : 'user'"), '');
  ck('편집기 주입 핀은 그대로 (test-aigen·genmodel 호환)', src.includes('generate: (promptText) => callGenLLM(promptText)'), '');
  ck('★ 편집기: 대화 전송은 ai.generate({ system, messages })', src.includes('ai.generate({ system, messages: msgs })'), '');
  ck('1층 탭에 💬 대화 (직결 호출 있을 때만)', src.includes("['chat', `💬 대화") && src.includes('const chatOn = !!(ai && ai.generate)'), '');
  ck('대화 패치는 patchSource=chat으로 계획 상자 공유', src.includes("patchSource = 'chat'") && src.includes("if (patchSource === 'chat') chatMarkApplied("), '');
  ck('형식 불합격 1회 재요청 — 설명 반복 말고 JSON만', src.includes('고친 JSON 코드펜스 하나만 다시 붙이세요'), '');
  ck('토큰 미터 — 이번 전송·누적 보낸/받은', src.includes('이번 전송 약 ') && src.includes('이 대화 누적 보낸 약 '), '');
  ck('보조 모델이면 메인급 권장 문구 (막지 않음)', src.includes('대화와 제작은 메인급 모델을 권해요'), '');
  ck('Ctrl+Enter 전송', src.includes("e.key === 'Enter' && (e.ctrlKey || e.metaKey)"), '');
}

// ── 편집기 만드는 순서 (같은 제보) ──
{
  ck('★ 3층 묶음 순서 기본 → 진행 → 세계 → 자동화', src.includes("[['기본', ['vars', 'commands', 'status']], ['진행', ['rules', 'scenario', 'actions', 'checks', 'time', 'setup']], ['세계', ["), '');
  ck('묶음 색은 이름을 따라간다 (2번째=진행=warning)', src.includes('.sce-tab-group:nth-child(2) { --g:var(--sce-warning); }') && src.includes('.sce-tab-group:nth-child(3) { --g:var(--sce-success); }'), '');
  ck('★ 만드는 순서 띠 — 변수 → AI 설정 → 규칙·이벤트 → 상태창', src.includes("['vars', '① 변수'") && src.includes("['ai', '② AI 설정에서 열기'") && src.includes("['rules', '③ 규칙·이벤트'") && src.includes("['status', '④ 상태창'"), '');
  ck('띠가 3층 본문 머리에', src.includes("h('div', { class: 'sce-deep-body' }, deepFlowStrip(), body)"), '');
  ck('★ 변수 [AI용 설명] 칸이 "규칙은 [규칙·이벤트] 탭에"라고 말한다', src.includes('같은 규칙은 [규칙·이벤트] 탭에') && src.includes('규칙은 [규칙·이벤트] 탭이 맡아요'), '');
}

// ── 가짜 DOM 왕복 — 실제로 보내고, 계획 상자가 뜨고, 적용되고, 이력에 접히는가 ──
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
  let ed = null, bootErr = null;
  try { ed = createSchemaEditor(container, JSON.parse(JSON.stringify(BASE)), { onChange: () => {}, ai }); } catch (e) { bootErr = e; }
  ck('★ ai 주입 편집기가 뜬다', !bootErr, bootErr && (bootErr.message + ' | ' + bootErr.stack.split('\n')[1]));
  if (!ed) return finish();

  const chatTab = btn(container, '💬 대화');
  ck('★ 1층에 [💬 대화] 탭', !!chatTab, '');
  let err = null;
  try { chatTab.click(); } catch (e) { err = e; }
  ck('★ 대화 탭 렌더 예외 없음', !err, err && err.stack.split('\n').slice(0, 2).join(' | '));
  const pane = () => findAll(container, (e) => e.className === 'sce-chat')[0];
  ck('대화 판이 그려짐 + 빈 안내', !!pane() && (pane().textContent || '').includes('예: "'), '');
  const area = () => findAll(container, (e) => e.tagName === 'TEXTAREA' && e.className.includes('sce-chat-input'))[0];
  ck('보내기 버튼은 빈 초안이면 비활성', btn(container, '보내기')?.disabled === true, '');

  // ① 논의 턴 — JSON 없음 → 계획 상자 없음
  area().value = '금화가 뭐야?'; area().oninput();
  ck('초안 입력 → 활성', btn(container, '보내기').disabled === false, '');
  btn(container, '보내기').click();
  await settle();
  ck('★ 호출 입력이 { system, messages }', calls.length === 1 && typeof calls[0] === 'object' && typeof calls[0].system === 'string' && Array.isArray(calls[0].messages), '');
  ck('시스템에 규약 + 다이제스트 + 봇 컨텍스트', calls[0].system.includes('## 대화 규약') && calls[0].system.includes('broke') && calls[0].system.includes('겨울 영지'), '');
  ck('메시지는 이번 말 하나 (user)', calls[0].messages.length === 1 && calls[0].messages[0].role === 'user' && calls[0].messages[0].content === '금화가 뭐야?', JSON.stringify(calls[0].messages));
  let bubbles = findAll(container, (e) => e.className.startsWith('sce-chat-msg'));
  ck('★ 말풍선 둘 (나·어시스턴트)', bubbles.length === 2 && bubbles[1].className.includes('is-ai') && bubbles[1].textContent.includes('설명만 하는 턴'), `${bubbles.length}`);
  ck('논의 턴엔 계획 상자 없음', !btn(container, '패치 적용'), '');
  ck('누적 토큰 표시가 0이 아니다', /누적 보낸 약 [1-9]/.test(pane().textContent), '');
  ck('작업본은 안 변함', ed.getSchema().vars.length === 1, '');

  // ② 수정 턴 — 산문 + 패치 펜스 → 계획 상자 → 적용 → 이력에 접힘
  reply = () => '산적 경계 변수를 넣었어요. 이유: 습격 이벤트의 조건이 필요해요.\n\n```json\n{"patchVersion":1,"add":{"vars":[{"id":"raid_alert","label":"산적 경계","type":"int","init":0,"min":0,"max":10}]}}\n```';
  area().value = '산적 경계 넣어줘'; area().oninput();
  btn(container, '보내기').click();
  await settle();
  ck('이력이 실린다 (앞 왕복 2개 + 이번 말)', calls[1].messages.length === 3 && calls[1].messages[1].role === 'assistant', JSON.stringify(calls[1].messages.map((m) => m.role)));
  bubbles = findAll(container, (e) => e.className.startsWith('sce-chat-msg'));
  ck('★ 산문은 말풍선에 (JSON은 안 보임)', bubbles[3].textContent.includes('산적 경계 변수를 넣었어요') && !bubbles[3].textContent.includes('patchVersion'), '');
  ck('★ 수정안 대기 표식 + 계획 상자(변경 계획·패치 적용)', bubbles[3].textContent.includes('수정안이 아래 변경 계획에') && !!btn(container, '패치 적용') && (pane().textContent || '').includes('변경 계획'), '');
  ck('★ 대화 탭 표식 ●', (btn(container, '💬 대화').textContent || '').includes('●'), '');
  ck('적용 전엔 작업본 그대로', ed.getSchema().vars.length === 1, '');
  btn(container, '패치 적용').click();
  await settle();
  ck('★ 적용 → 작업본에 raid_alert', ed.getSchema().vars.some((v) => v.id === 'raid_alert'), '');
  bubbles = findAll(container, (e) => e.className.startsWith('sce-chat-msg'));
  ck('★ 말풍선에 "✅ 적용됨 — 추가 …"', bubbles[3].textContent.includes('✅ 적용됨') && bubbles[3].textContent.includes('raid_alert'), bubbles[3].textContent.slice(-80));
  ck('적용 내역 상자 + 되돌리기', !!btn(container, '적용 전으로 되돌리기'), '');
  ck('창작 탭 쪽엔 안 샌다 (patchSource=chat)', (() => { btn(container, '✍ 창작').click(); const leaked = !!btn(container, '적용 전으로 되돌리기'); btn(container, '💬 대화').click(); return !leaked; })(), '');

  // ③ 다음 턴 — 이력에 [적용됨 — …] 요약으로, 다이제스트엔 새 변수
  reply = () => '네, 그 변수는 이제 있어요.';
  area().value = '방금 뭘 넣었지?'; area().oninput();
  btn(container, '보내기').click();
  await settle();
  const hist = calls[2].messages;
  ck('★ 적용된 패치는 이력에 요약으로', hist.some((m) => m.role === 'assistant' && m.content.includes('[적용됨 — 추가 vars:raid_alert]') && !m.content.includes('```')), JSON.stringify(hist.map((m) => m.content.slice(0, 40))));
  ck('★ 시스템 다이제스트가 최신 작업본 (raid_alert 포함)', calls[2].system.includes('raid_alert'), '');

  // ④ 형식 불합격 — 두 번 다 깨지면 버리고 사유 표시, 작업본 무변
  let n = 0;
  reply = () => { n++; return '해봤어요.\n\n```json\n{"patchVersion":1,"remove":{"vars":["gold"]},"add":{"vars":[{"id":"gold","label":"금화","type":"int","init":1}]}}\n```'; }; // 같은 id를 add·remove가 같이 — planPatch 정지
  area().value = '금화 다시 만들어'; area().oninput();
  btn(container, '보내기').click();
  await settle();
  ck('★ 불합격 1회 재요청 (호출 2회) — 재요청 메시지에 오류 첨부', n === 2 && calls[calls.length - 1].messages.at(-1).content.includes('형식 검사에서 거부'), `${n}`);
  bubbles = findAll(container, (e) => e.className.startsWith('sce-chat-msg'));
  ck('★ 두 번 다 실패 → 말풍선에 사유 + 원문 접기, 계획 상자 없음', bubbles.at(-1).textContent.includes('형식 검사를 통과하지 못해') && !btn(container, '패치 적용'), bubbles.at(-1).textContent.slice(0, 120));
  ck('작업본은 그대로 (gold 하나)', ed.getSchema().vars.filter((v) => v.id === 'gold').length === 1, '');

  // ⑤ 떠 있는 수정안을 두고 다음 말 → "적용하지 않았어요"로 접힘
  reply = () => '또 넣을게요.\n\n```json\n{"patchVersion":1,"add":{"vars":[{"id":"fame","label":"명성","type":"int","init":0}]}}\n```';
  area().value = '명성도'; area().oninput(); btn(container, '보내기').click(); await settle();
  ck('수정안 대기', !!btn(container, '패치 적용'), '');
  reply = () => '알겠어요.';
  area().value = '아니 됐어'; area().oninput(); btn(container, '보내기').click(); await settle();
  bubbles = findAll(container, (e) => e.className.startsWith('sce-chat-msg'));
  ck('★ 지나간 수정안은 "적용하지 않았어요" + 계획 상자 치움', bubbles.some((b) => b.textContent.includes('적용하지 않았어요')) && !btn(container, '패치 적용'), '');
  ck('이력엔 [적용되지 않음]', calls.at(-1).messages.some((m) => m.content.includes('[적용되지 않음]')), '');
  ck('fame은 안 들어감', !ed.getSchema().vars.some((v) => v.id === 'fame'), '');

  // ⑥ 초기화
  btn(container, '대화 초기화').click();
  await settle();
  ck('★ 초기화 → 말풍선 0, 누적 0', findAll(container, (e) => e.className.startsWith('sce-chat-msg')).length === 0 && /누적 보낸 약 0 /.test(pane().textContent), '');

  // ⑦ 빈 작업본 — 통짜 스키마가 오면 확인 상자, [편집기에 넣기]로 반영
  const c2 = document.createElement('div');
  const ed2 = createSchemaEditor(c2, {}, { onChange: () => {}, ai });
  ck('빈 작업본에도 [💬 대화] 탭 (결과·진단은 없음)', !!btn(c2, '💬 대화') && !btn(c2, '👁 결과'), '');
  btn(c2, '💬 대화').click();
  reply = () => '이렇게 시작해요.\n\n```json\n' + JSON.stringify({ simcore: '0.1', meta: { name: '새 봇' }, vars: [{ id: 'hp', label: '체력', type: 'int', init: 10, min: 0, max: 10 }], rules: { events: [] }, statusUI: { mode: 'auto', groups: [] } }) + '\n```';
  const a2 = findAll(c2, (e) => e.tagName === 'TEXTAREA' && e.className.includes('sce-chat-input'))[0];
  a2.value = '체력만 있는 봇'; a2.oninput(); btn(c2, '보내기').click(); await settle();
  ck('★ 빈 작업본 시스템은 통짜 규격서', calls.at(-1).system.includes('## 출력 형식') && !calls.at(-1).system.includes('## 패치 형식'), '');
  ck('★ 통짜 확인 상자 "스키마가 도착했습니다"', (c2.textContent || '').includes('스키마가 도착했습니다') && !!btn(c2, '편집기에 넣기'), '');
  btn(c2, '편집기에 넣기').click(); await settle();
  ck('★ 반영 → hp 변수', ed2.getSchema().vars.some((v) => v.id === 'hp'), '');
  ck('말풍선에 적용됨', findAll(c2, (e) => e.className.startsWith('sce-chat-msg')).some((b) => b.textContent.includes('✅ 적용됨')), '');

  // ⑧ ai 주입 없는 편집기엔 대화 탭 없음
  const c3 = document.createElement('div');
  createSchemaEditor(c3, JSON.parse(JSON.stringify(BASE)), { onChange: () => {} });
  ck('ai 없음 → 대화 탭 없음', !btn(c3, '💬 대화'), '');

  // ⑨ 템플릿에서 시작 (v1.9.1) — 1층 창작·대화 안에서 내장 템플릿을 연다
  {
    let changed = 0;
    const c4 = document.createElement('div');
    const ed4 = createSchemaEditor(c4, {}, { onChange: () => { changed++; }, ai });
    const ids = (x) => ((x.getSchema ? x.getSchema() : x).vars || []).map((v) => v.id).join(',') || '(none)'; // normalize()가 기본값을 채우므로 통짜 비교는 안 맞는다
    const sel = () => findAll(c4, (e) => e.tagName === 'SELECT' && e.className.includes('sce-tpl-select'))[0];
    ck('★ 빈 작업본 창작 탭에 [템플릿에서 시작] 카드 + 16종 선택', !!sel() && sel().children.length === 16 && !!btn(c4, '편집기에 열기'), sel() && String(sel().children.length));
    ck('빈 작업본이면 접히지 않은 카드', findAll(c4, (e) => e.tagName === 'DETAILS' && e.className.includes('sce-tpl-details')).length === 0, '');
    btn(c4, '💬 대화').click();
    ck('★ 대화 탭에도 같은 카드 + 전송량 안내', !!sel() && !!btn(c4, '편집기에 열기') && (c4.textContent || '').includes('전송량이 크게 줄어요'), '');
    sel().value = 'daily'; sel().onchange();
    btn(c4, '편집기에 열기').click(); await settle();
    ck('★ [편집기에 열기] → 작업본이 daily 템플릿', ed4.getSchema().vars.length > 0 && ids(ed4) === ids(TEMPLATES.daily.schema), '');
    ck('onChange가 울린다 (호스트가 설치본과 다름 표시)', changed >= 1, String(changed));
    ck('작업본이 생기면 결과·진단 탭이 뜬다', !!btn(c4, '👁 결과') && !!btn(c4, '🔬 진단'), '');
    // 작업본이 있을 때: 접힌 칸 + 두 번 누르기
    const det = () => findAll(c4, (e) => e.tagName === 'DETAILS' && e.className.includes('sce-tpl-details'))[0];
    ck('★ 작업본 있으면 접힌 칸으로', !!det() && !btn(c4, '편집기에 열기') && !!btn(c4, '템플릿으로 갈아끼우기'), '');
    sel().value = 'rpg'; sel().onchange();
    btn(c4, '템플릿으로 갈아끼우기').click(); await settle();
    ck('★ 첫 누름은 무장만 — 작업본 그대로 + 경고 문구', ids(ed4) === ids(TEMPLATES.daily.schema) && !!btn(c4, '한 번 더 누르면'), '');
    btn(c4, '한 번 더 누르면').click(); await settle();
    ck('★ 두 번째 누름 → rpg 템플릿으로 갈아끼움', ids(ed4) === ids(TEMPLATES.rpg.schema), '');
    btn(c4, '✍ 창작').click();
    ck('창작 탭도 접힌 칸 (덮어쓰기라 눈에 안 띄게)', !!det() && !!btn(c4, '템플릿으로 갈아끼우기'), '');
    sel().value = 'zombie'; sel().onchange();
    ck('템플릿을 바꾸면 무장 해제 (다시 첫 누름부터)', !!btn(c4, '템플릿으로 갈아끼우기') && !btn(c4, '한 번 더 누르면'), '');
  }

  finish();
})().catch((e) => { ck('★ 비동기 왕복 예외 없음', false, e.stack.split('\n').slice(0, 3).join(' | ')); finish(); });

function finish() {
  let pass = 0, fail = 0;
  for (const [c, n, x] of R) { if (c) pass++; else { fail++; console.log(`FAIL ${n}${x ? ' — ' + x : ''}`); } }
  console.log(`[test-aichat] ${pass}/${pass + fail} 통과`);
  if (fail) process.exit(1);
}
