const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.6.1 — 상태창 HTML의 일반 값에 든 큰따옴표가 유저의 대사 강조 정규식에 물리던 것 (실사고).
//
// 제보(스샷): 얼헌 가호 배너 『모든 이의 말투가 사극체가 된다 ("그대", "~하시오")』에서
// "그대"·"~하시오"가 각각 대사 박스로 감싸져 레이아웃이 깨졌다. 커스텀 템플릿 치환이
// 일반 값을 날것으로 넣어, 봇/프리셋의 `"…"` 정규식이 상태창 안까지 뭄.
//
// 불변식: 상태창·게임 패널 HTML의 일반 값은 `"` → `&quot;` (화면 글자는 동일).
//         프롬프트 렌더(지시문·상태 블록)는 원문 그대로 — 모델은 `"`를 봐야 한다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { renderStatusHtml, renderPanelTemplate } = SC.require('render');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const S = {
  simcore: '0.1', meta: { name: '따옴표' },
  vars: [
    { id: 'msg', label: '문구', type: 'text', init: '말투가 사극체가 된다 ("그대", "~하시오")', maxLength: 60 },
    { id: 'bag', label: '가방', type: 'list', init: ['"인용" 표식 <b>굵게</b>'], maxItems: 5 },
  ],
  derived: [{ id: 'msg2', label: '파생', expr: `'파생 "따옴표" 값'` }],
  directives: [{ id: 'd', when: 'true', text: '지시문: {msg} / {msg2}' }],
  promptState: { template: '[상태] {msg}' },
  statusUI: { mode: 'template', templates: [{ id: 't', template:
    '<div class="a">{msg}</div><div class="b">{msg2}</div><div class="c">{bag:tags}</div>' }] },
};
const st = engine.initState(S); st.meta.setupDone = true;

// ── 상태창 HTML — 일반 값·파생 값의 " 는 &quot; ──
const html = renderStatusHtml(S, st, null, null, { uid: 1 });
ck('★ 텍스트 변수 값의 큰따옴표 → &quot; (정규식이 못 문다)',
  html.includes('(&quot;그대&quot;, &quot;~하시오&quot;)') && !html.includes('("그대"'), html.slice(0, 200));
ck('파생 값도 동일', html.includes('파생 &quot;따옴표&quot; 값'), '');
ck(':tags 칩은 종전대로 전체 이스케이프 (<b>까지)',
  html.includes('&quot;인용&quot; 표식 &lt;b&gt;굵게&lt;/b&gt;'), '');
ck('템플릿 자체의 속성 따옴표는 그대로 (class="a")', html.includes('class="a"'), '');

// ── 게임 패널 템플릿 경로도 같은 규약 ──
const panel = renderPanelTemplate(S, st, '<p>{msg}</p>');
ck('게임 패널 렌더도 &quot;', panel.includes('&quot;그대&quot;') && !panel.includes('"그대"'), panel);

// ── 프롬프트 렌더는 원문 — 모델은 실제 따옴표를 봐야 한다 ──
const send = engine.sendPhase(S, st, { rng: seededRng('q', 1, 's') });
ck('★ 지시문·상태 블록에는 &quot; 없음 (원문 따옴표)',
  send.promptBlock.includes('("그대", "~하시오")') && send.promptBlock.includes('파생 "따옴표" 값')
  && !send.promptBlock.includes('&quot;'), send.promptBlock.slice(0, 200));

// ── 정적: 두 HTML 렌더 자리만 quoteSafe를 받는다 ──
// 꼬리를 열어 둔다 — renderTemplate은 뒤로 인자가 더 붙는다 (v1.7.1의 dueNow). 지키려는 건
// "HTML 렌더 두 자리만 quoteSafe를 받는다"는 것이지 인자 개수가 아니다.
ck('render의 HTML 치환 두 자리에 quoteSafe', (src.match(/lookup, extras, quoteSafe[,)]/g) || []).length === 2, '');

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
