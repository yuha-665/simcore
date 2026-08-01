// SimCore 블록 편집기 — 코딩 없이 스키마를 행 단위로 만드는 공용 DOM 컴포넌트.
// 플러그인 패널(iframe)과 플레이그라운드 양쪽에서 사용. 프레임워크 없음.
//
// createSchemaEditor(container, schema, { onChange, ai }) →
//   { getSchema(), setSchema(s), validateNow(), destroy() }
// ai = { generate(prompt), getBotContext() } — 내장 AI 생성(위층)용 호스트 주입. 없으면 복사 옆문만 뜬다.

const { validateSchema } = require('./validate');
const { referencedVars } = require('./expr');
const { renderStatusHtml, THEMES, multiPanelTemplate } = require('./render');
const engine = require('./engine');
const { TEMPLATES } = require('./templates');
const { diagnose, compareDiagnoses } = require('./diagnose');
const patchMod = require('./patch');
const { composeName, renderTag, resolveInPack, auxImageSpec, mainInjectionText } = require('./assets');
const { timeConfig, exposedValues, EXPOSABLE, EXPOSED_LABELS, SKIP_DAY, SKIP_MIN } = require('./time');

const CSS = `
.sce { font-size: 13px; }
.sce * { box-sizing: border-box; }
.sce .sce-tabs { display:flex; gap:2px; flex-wrap:wrap; border-bottom:2px solid #24304a; margin-bottom:12px; }
.sce .sce-tab { padding:6px 12px; cursor:pointer; border:1px solid transparent; border-bottom:none;
  border-radius:8px 8px 0 0; color:#a7b4cc; background:transparent; font-size:13px; }
.sce .sce-tab.on { color:#fff; border-color:#3d5384; background:rgba(84,120,214,.22); font-weight:600; }
.sce .sce-block { border:1px solid #2e3d60; border-left:3px solid #3d5384; border-radius:10px;
  padding:8px 10px; margin-bottom:8px; background:rgba(91,141,239,.05); }
.sce .sce-row { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin:4px 0; }
.sce .sce-row > label { color:#9fb0cd; font-size:12px; }
.sce .sce-pair { display:inline-flex; gap:5px; align-items:center; white-space:nowrap; }
.sce .sce-pair > label { color:#9fb0cd; font-size:12px; }
.sce input, .sce select, .sce textarea { background:#0a101f; color:#e6ebf5; border:1px solid #35486e;
  border-radius:6px; padding:4px 8px; font-size:12.5px; }
.sce input:focus, .sce textarea:focus { border-color:#5b8def; outline:none; }
.sce input[type=checkbox] { width:auto; }
.sce input.sce-w-s { width:70px; } .sce input.sce-w-m { width:110px; } .sce input.sce-w-l { width:100%; flex:1; min-width:140px; }
.sce textarea { width:100%; min-height:56px; font-family:ui-monospace,monospace; resize:vertical; }
.sce .sce-btn { background:#1c2740; color:#dfe7f5; border:1px solid #3d5384; border-radius:7px;
  padding:4px 10px; cursor:pointer; font-size:12.5px; }
.sce .sce-btn:hover { background:#24345c; border-color:#5b8def; }
.sce .sce-btn.sce-add { border-style:dashed; border-color:#3d5384; color:#9db8e8; width:100%; margin-top:2px; }
.sce .sce-btn.sce-add:hover { color:#cfe0ff; }
.sce .sce-btn.sce-mini { padding:2px 7px; font-size:12px; }
.sce .sce-btn.sce-danger { color:#d99aa6; }
.sce .sce-btn.sce-danger:hover { border-color:#d9596f; background:#331722; color:#f2aab6; }
.sce .sce-grip { display:flex; gap:2px; margin-left:auto; }
.sce .sce-sub { margin-left:14px; padding-left:10px; border-left:2px solid #3d538466; }
.sce .sce-hint { color:#aebdd8; font-size:11.5px; margin:2px 0 6px; }
.sce .sce-report { font-family:ui-monospace,monospace; font-size:12px; white-space:pre-wrap; margin-top:8px; }
.sce .sce-err { color:#ff7b7b; font-weight:600; } .sce .sce-warn { color:#ffd166; } .sce .sce-ok { color:#6fdb8c; font-weight:600; }
.sce details.sce-fold { margin:4px 0; } .sce details.sce-fold > summary { cursor:pointer; user-select:none; }
.sce details.sce-fold > div { margin-left:12px; }
.sce .sce-tag { display:inline-block; padding:1px 7px; border-radius:9px; font-size:11px; letter-spacing:.02em;
  background:#26304a; color:#9db8e8; border:1px solid #3a4560; }
.sce .sce-preview { margin-top:10px; }
.sce .sce-chips { display:flex; gap:6px; flex-wrap:wrap; }
.sce .sce-chip { display:flex; align-items:center; gap:4px; border:1px solid #35486e; border-radius:8px; padding:3px 8px; font-size:12px; color:#dfe7f5; }
.sce h4 { margin:16px 0 6px; font-size:12.5px; color:#9db8e8; padding-left:8px; border-left:3px solid #3d5384; }
.sce .sce-swatches { display:inline-flex; gap:4px; align-items:center; flex-wrap:wrap; }
.sce .sce-swatch { width:20px !important; height:20px !important; min-width:0 !important;
  border-radius:6px !important; border:1px solid rgba(0,0,0,.4) !important;
  cursor:pointer; padding:0 !important; flex:none; }
.sce .sce-swatch.on { outline:2px solid #fff !important; outline-offset:1px; }
.sce input[type=color] { width:30px !important; height:24px !important; min-width:0 !important;
  padding:1px !important; border-radius:6px !important; background:transparent !important; cursor:pointer; }
.sce .sce-colorbox { display:flex; flex-direction:column; gap:4px; margin:4px 0; padding:6px 8px;
  border:1px dashed #3d538488; border-radius:8px; }
.sce .sce-top { border-left-color:#8f6fd0; background:rgba(159,111,239,.07); }
.sce details.sce-lower { margin-top:14px; }
.sce details.sce-lower > summary { cursor:pointer; user-select:none; color:#9db8e8; font-weight:600;
  padding:7px 6px; border:1px solid #2e3d60; border-radius:10px; background:rgba(91,141,239,.05); }
.sce details.sce-lower[open] > summary { border-radius:10px 10px 0 0; margin-bottom:10px; }
`;

const VAR_TYPES = [
  ['int', '정수'], ['float', '실수'], ['text', '텍스트'], ['bool', 'ON/OFF'], ['enum', '선택지'],
  ['list', '목록 (아이템)'],
];

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el[k] = v;
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

// 값 바인딩 입력 (blur/변경 시 콜백 — 타이핑 중 리렌더로 포커스 잃지 않게)
function bindInput(value, apply, { cls = 'sce-w-m', ph = '', type = 'text', title = '' } = {}) {
  const el = h('input', { class: cls, placeholder: ph, type, title });
  el.value = value ?? '';
  el.onchange = () => apply(el.value);
  return el;
}
function bindArea(value, apply, ph = '') {
  const el = h('textarea', { placeholder: ph });
  el.value = value ?? '';
  el.onchange = () => apply(el.value);
  return el;
}
function bindCheck(value, apply, label) {
  const cb = h('input', { type: 'checkbox' });
  cb.checked = !!value;
  cb.onchange = () => apply(cb.checked);
  return h('label', { class: 'sce-chip', style: 'cursor:pointer' }, cb, label);
}
function bindSelect(value, options, apply) {
  const el = h('select', {}, ...options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = value ?? options[0][0];
  el.onchange = () => apply(el.value);
  return el;
}

/**
 * '복사해서 AI에게 붙여넣기' 위젯.
 * 샌드박스 iframe에서는 클립보드 API가 막힐 수 있어, 실패하면 전체 선택된 textarea로 떨어진다.
 * @param buildText 눌렀을 때 만들 텍스트 (오래 걸릴 수 있으므로 클릭 시점에 만든다)
 * @param extra 버튼 옆에 같이 놓을 컨트롤 (예: 예제 고르는 드롭다운)
 */
function copyWidget(btnLabel, hint, buildText, extra = []) {
  const note = h('div', { class: 'sce-hint' }, hint);
  const out = h('textarea', { style: 'display:none;height:190px' });
  const btn = h('button', { class: 'sce-btn', onclick: async () => {
    let text;
    try { text = buildText(); }
    catch (e) { note.textContent = `만들지 못했습니다 — ${e.message}`; return; }
    if (!text) { note.textContent = '복사할 내용이 없습니다.'; return; }
    out.value = text;
    out.style.display = '';
    out.focus();
    out.select();
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch (e) { /* 샌드박스 차단 */ }
    if (!copied) { try { copied = document.execCommand('copy'); } catch (e) { /* 폴백도 실패 */ } }
    const kb = (text.length / 1024).toFixed(1);
    note.textContent = copied
      ? `✓ 복사됐습니다 (${kb}KB) — AI 사이트에 붙여넣으세요.`
      : `아래 칸이 전체 선택돼 있습니다 (${kb}KB) — Ctrl+C로 복사하세요.`;
  } }, btnLabel);
  return {
    mount(parent) {
      parent.appendChild(note);
      parent.appendChild(h('div', { class: 'sce-row' }, btn, ...extra));
      parent.appendChild(out);
    },
  };
}

/**
 * 외부 AI에게 상태창 CSS를 맡길 때 통째로 넘기는 규격서.
 * 클래스 계약(고정)과 이 봇의 실제 렌더 결과(가변)를 함께 넘겨야
 * AI가 없는 클래스를 지어내지 않는다.
 */
const CSS_SPEC_CLASSES = [
  ['.sim-status', '상태창 전체를 감싸는 바깥 상자 (여기에 배경·테두리·폰트를 건다)'],
  ['.sim-status summary', '접기/펼치기 헤더 줄'],
  ['.sim-group', '그룹 한 덩어리'],
  ['.sim-group-label', '그룹 제목'],
  ['.sim-row', '항목 한 줄 (이름 + 게이지 + 값)'],
  ['.sim-label', '항목 이름'],
  ['.sim-value', '숫자 값'],
  ['.sim-bar', '게이지 배경 트랙'],
  ['.sim-bar-fill', '게이지 채워진 부분 (너비는 인라인 style로 들어오니 건드리지 말 것)'],
  ['.sim-badge', '선택지(enum)·ON/OFF 값 배지'],
  ['.sim-tags / .sim-tag', '목록형 변수의 칩 묶음 / 칩 하나'],
  ['.sim-empty', '빈 목록일 때의 회색 안내'],
  ['.sim-actions', '액션 범례가 놓이는 줄 (실행 버튼은 화면 우상단에 따로 뜬다)'],
  ['.sim-action-hint', '범례 위의 작은 안내 문구'],
  ['.sim-action', '범례 항목 하나 (.sim-armed = 발동 대기, .sim-disabled = 잠김)'],
  ['.sim-action-glyph', '범례 앞의 아이콘 — 우상단 버튼에 뜨는 그 글리프'],
  ['.sim-action-state', '범례 뒤의 상태 문구 (발동 대기 / 쿨다운 사유)'],
  ['.sim-log / .sim-log-item', '이번 턴 변화 로그'],
];

function buildCssSpecPrompt(schema, styleReq = '') {
  let skeleton = '(스키마에 오류가 있어 실제 구조를 못 뽑았습니다 — 위 클래스 목록만 보고 만들어 주세요)';
  try {
    const v = validateSchema(schema);
    if (v.ok) {
      const html = renderStatusHtml(schema, engine.initState(schema), null,
        (schema.actions || []).map((a) => ({ id: a.id, label: a.label ?? a.id, armed: false })),
        { includeStyle: false });
      skeleton = html.length > 4000 ? html.slice(0, 4000) + '\n... (이하 같은 구조 반복)' : html;
    }
  } catch (e) { /* 규격만으로도 충분히 만들 수 있다 */ }

  return [
    '아래 규격에 맞는 CSS를 만들어 주세요. RisuAI용 시뮬레이션 플러그인(SimCore)의 상태창 스킨입니다.',
    '',
    '## 내가 원하는 분위기',
    String(styleReq || '').trim()
      || '(여기에 원하는 스타일을 적으세요 — 예: "낡은 신문지 느낌, 세리프 폰트, 붉은 도장 같은 포인트 색")',
    '',
    '## 반드시 지킬 것',
    '- **CSS만** 출력하세요. HTML·JS·설명 없이 스타일 규칙만.',
    '- 모든 선택자는 시스템이 자동으로 `.sim-status` 안쪽으로 제한합니다.',
    '  `body`, `html`, `*`, `:root` 같은 바깥 선택자는 무시되니 쓰지 마세요.',
    '- 외부 리소스 금지: `@import`, `url(http...)`, 웹폰트 링크 전부 차단됩니다.',
    '  `font-family`는 기기에 이미 있는 폰트만 지정하세요.',
    '- `position: fixed` / `position: absolute`는 피하세요. 채팅 흐름 안에 들어가는 창입니다.',
    '- `@keyframes`와 `animation`, `transition`은 쓸 수 있습니다.',
    '- 아래 목록에 **없는 클래스는 만들지 마세요.** 존재하지 않아서 아무 효과가 없습니다.',
    '- 밝은 테마/어두운 테마 어느 쪽에서도 글씨가 읽히도록 배경색과 글자색을 같이 지정하세요.',
    '',
    '## 쓸 수 있는 클래스 (이게 전부입니다)',
    ...CSS_SPEC_CLASSES.map(([sel, desc]) => `- \`${sel}\` — ${desc}`),
    '',
    '## 이 봇의 실제 상태창 구조',
    '```html',
    skeleton,
    '```',
  ].join('\n');
}

// ── 배치까지 AI에게 맡기는 규격서 (커스텀 템플릿 통째) ─────────
// 스킨 규격(위)과 달리 클래스는 자유, 대신 {자리표시자} 계약이 생명이다 —
// 목록에 없는 자리표시자는 검증기가 거부하므로 "실패해도 안전"이 여기서도 성립한다.
function buildLayoutSpecPrompt(schema, styleReq = '') {
  const ph = [
    ...(schema.vars || []).map((v) =>
      `- \`{${v.id}}\` — ${v.label ?? v.id} (${v.type}${v.type === 'list' ? `, 목록이라 \`{${v.id}:tags}\`로 칩 렌더 가능` : ''})`),
    ...(schema.derived || []).map((d) => `- \`{${d.id}}\` — ${d.label ?? d.id} (자동 계산)`),
  ];
  const cur = schema.statusUI?.mode === 'template' && (schema.statusUI.template || '').trim();
  return [
    'RisuAI용 SimCore 플러그인의 상태창을 **HTML 템플릿 + CSS로 통째로** 만들어 주세요.',
    '채팅 메시지마다 이 HTML이 그려지고, {자리표시자}가 실제 값으로 치환됩니다.',
    '',
    '## 내가 원하는 분위기·배치',
    String(styleReq || '').trim()
      || '(여기에 적으세요 — 예: "왼쪽에 칭호 칸, 오른쪽에 수치 2열, 하단에 계약 목록 칩")',
    '',
    '## 반드시 지킬 것',
    '- 출력은 **`<style>` 블록 하나 + HTML**만. 코드펜스 밖에 설명을 덧붙이지 마세요.',
    '- CSS는 시스템이 이 상태창 범위로 자동 격리합니다. 클래스명은 자유롭게 지어도 됩니다.',
    '- 외부 리소스 금지: `@import`, `url(http...)`, 웹폰트 링크. `font-family`는 기기 폰트만.',
    '- `position: fixed` / `position: absolute`는 피하세요. 채팅 흐름 안에 들어가는 창입니다.',
    '- **아래 목록에 없는 {자리표시자}를 쓰면 설치가 거부됩니다.** 꾸밈용 텍스트는 그냥 글자로 쓰세요.',
    '- 탭·팝업 같은 전환은 체크박스/라디오 + CSS로만 (JS 불가). 라디오·체크박스의 `id`/`name`에는',
    '  반드시 `{uid}`를 섞으세요 (예: `id="tab1-{uid}"`) — 메시지마다 상태창이 새로 그려져서, 없으면 서로 엉킵니다.',
    '- 밝은 테마/어두운 테마 어느 쪽에서도 읽히도록 배경색과 글자색을 같이 지정하세요.',
    '',
    '## 쓸 수 있는 자리표시자 (이게 전부입니다)',
    ...ph,
    '',
    cur
      ? ['## 지금 쓰는 템플릿 — 이걸 바탕으로 고쳐도, 완전히 새로 만들어도 됩니다',
        '```html', cur, '```'].join('\n')
      : '(지금은 자동 배치를 쓰고 있습니다 — 위 자리표시자로 자유롭게 구성하세요.)',
  ].join('\n');
}

// ── 스키마를 통째로 AI에게 맡기는 경로 ──────────────────────────
// CSS 규격서의 확장판. 다른 점은 두 가지다.
//  ① 규칙이 훨씬 많아서 산문으로 다 적으면 AI가 뒷부분을 흘린다 → 완성된 템플릿을 예제로 같이 준다.
//  ② 검증기를 통과해도 게임이 죽어 있을 수 있다 → 밸런스 지침을 따로 못박는다.

const SCHEMA_HARD_RULES = [
  '- `id`(vars/derived/actions/events)는 영문자로 시작하고 영문자·숫자·`_`만 씁니다. 한글 id는 거부됩니다.',
  '- id는 서로 겹치면 안 됩니다. derived의 id도 vars와 겹칠 수 없습니다.',
  '- 변수 타입은 `int` `float` `text` `bool` `enum` `list` 여섯 가지뿐입니다.',
  '- `enum`은 `enum` 배열이 2개 이상이어야 하고 `init`이 그 목록 안에 있어야 합니다.',
  '- `int`/`float`은 `init`이 숫자여야 하고 `min` ≤ `init` ≤ `max` 여야 합니다.',
  '- `list`의 `init`은 문자열 배열입니다. **수식으로 대입할 수 없고** `{ "list": "아이디", "add": [...], "remove": [...] }` 형태로만 바꿉니다.',
  '- `derived`는 계산 전용입니다. 효과의 `set` 대상이 될 수 없습니다.',
  '- 수식에서 참조하는 이름은 반드시 `vars` 또는 `derived`에 정의돼 있어야 합니다. 없는 이름을 쓰면 거부됩니다.',
  '- `updater.allow[].id`도 `vars`에 있어야 하며, 숫자형에는 `maxDelta`를 주는 것이 좋습니다(없으면 AI가 무제한으로 바꿉니다).',
  '- `updater.contextTurns`는 1~5 정수입니다.',
  '- `promptState.template`, `directives[].text`, `statusUI` 안의 `{이름}` 자리표시자도 정의된 변수여야 합니다.',
  '- JSON에는 주석을 쓸 수 없습니다(`//` 금지).',
];

const SCHEMA_EXPR_RULES = [
  '연산자: `+ - * / %`, 비교 `== != > < >= <=`, 논리 `and` `or` `not`, 삼항 `조건 ? A : B`, 괄호',
  '함수: `round(x)` `floor(x)` `ceil(x)` `abs(x)` `min(a,b,...)` `max(a,b,...)` `clamp(값,최소,최대)` `rand(최소,최대)` `count(목록)` `has(목록,"항목")` `sum(목록[,"거르개"])`',
  '`sum(목록)`은 항목 **맨 끝의 숫자**를 더합니다 — `["양모 계약 +12", "제분소 5"]` → 17. '
  + '끝에 숫자가 없는 항목은 0입니다. 둘째 인자를 주면 그 글자가 든 항목만 셉니다: `sum(계약, "교역")`.',
  '목록 항목의 `@숫자`는 **기한**입니다(`"성벽 부역 @450 -4"`). 합산에서는 무시되고, '
  + 'onTurn의 `{ "list": "계약", "expire": "day" }`가 그 값보다 지난 항목을 스스로 뺍니다. '
  + '`@+숫자`로 쓰면(`"@+1080"` = 1080일 뒤) 추가되는 순간 시스템이 절대값으로 굳힙니다 — '
  + '보조 AI에게 "지금 날짜 + 기간"을 계산시키지 마세요. 그게 이 플러그인이 없애려는 일입니다.',
  '문자열 비교는 큰따옴표: `stage == "친구"`',
  '**`rand()`는 효과(effects)에서만** 씁니다. 조건(`when`)과 `derived`에는 쓸 수 없습니다.',
  '  → 주사위가 필요하면 "효과에서 굴려 변수에 담고 → 그 변수로 분기"하는 2단 구조를 쓰세요.',
  '대입·반복문·점 접근(`a.b`)·배열 인덱싱은 없습니다. 목록은 `count`/`has`/`sum`으로만 다룹니다.',
];

const SCHEMA_BALANCE_RULES = [
  '- **이벤트 조건이 실제로 도달 가능한지 역산하세요.** 리스크가 턴당 +2인데 발동선이 70이면 35턴이 걸립니다. 대부분의 플레이는 그 전에 끝납니다.',
  '- **시작값이 조건 경계와 같으면 영영 안 걸립니다.** 조건이 `press < 50`인데 시작값이 정확히 50이면 그 이벤트는 죽은 이벤트입니다.',
  '- 매 턴 소모가 있으면 `시작 비축량 ÷ 턴당 소모`를 계산해 몇 턴 버티는지 확인하세요. 너무 짧으면 첫 턴부터 파국입니다.',
  '- 액션에는 반대급부를 두세요. 하나를 얻으면 하나를 잃어야 선택이 의미를 가집니다.',
  '- 파생 변수로 계산 사슬을 만드세요(예: 유동인구 → 수요 → 판매량 → 매출 → 순익). 그래야 수치 하나가 세계 전체를 흔듭니다.',
];

// 반복 이벤트 패턴 — once 오남용은 실측 사고다 (맨션봇 시설 위기: once라 두 번째 고장부터 침묵).
// 예전 문구는 "매 턴 재발동"을 경고하며 해법으로 once만 이름을 댔고, AI는 배운 유일한 도구를
// 그대로 썼다. 규격서의 예제는 AI가 베끼는 코퍼스다 — 패턴 선택 규칙과 래치 실물을 같이 준다.
const SCHEMA_EVENT_PATTERN_RULES = [
  '- 조건 이벤트는 조건이 참인 동안 **매 턴** 발동하고, 조건 이벤트에는 쿨다운이 없습니다. 반복을 막는 길은 셋뿐입니다:',
  '  ① 효과가 조건을 스스로 해소 — `when: "storm"` + 효과에서 `storm = false`',
  '  ② `once: true` — **다시는 안 오는 일회성 전개 전용** (첫 고백, 최초 발견, 사망).',
  '     오르내리는 게이지의 문턱에 쓰면 **두 번째 위기부터 영영 침묵**합니다. 그런 곳엔 쓰지 마세요.',
  '  ③ **래치 짝** — "터지고, 회복되고, 또 터질 수 있는" 상태 알림의 정답. bool 경보 변수를 하나 두고:',
  '     `{ "id": "boiler_crisis", "when": "boiler <= 15 and not boiler_alert", "effects": [{ "set": "boiler_alert", "expr": "true" }], "notify": "..." }`',
  '     `{ "id": "boiler_ok", "when": "boiler >= 40 and boiler_alert", "effects": [{ "set": "boiler_alert", "expr": "false" }], "notify": "..." }`',
  '     문턱을 15/40처럼 벌려야 경계값 근처에서 켜졌다 꺼졌다 파닥거리지 않습니다.',
];

// 시간 진행 — onTurn day+1 복제는 규격서에 참고할 패턴이 없어서 생긴 사고다 (설계: docs/design-시간.md)
const SCHEMA_TIME_RULES = [
  '- **onTurn에 `day + 1`을 넣지 마세요** — 출력 하나가 하루가 되어 장면 단위 RP를 부숩니다.',
  '  날짜·요일·시각은 스키마 `time` 섹션(편집기 [시간] 탭)이 담당합니다. 켜져 있으면',
  '  `date` `clock` `weekday` `season` `month` `dom` `hour` `minute` `elapsed`(경과일)를',
  '  조건식·상태창에서 변수처럼 쓸 수 있습니다. day/clock 정수 조각을 직접 만들면 서로 어긋납니다.',
  '- 시간을 흐르게 하는 규칙(skip_day/skip_min 사용법)은 그 **변수의 `desc`**에 쓰세요 —',
  '  `directives`는 메인 모델 전용이라 상태를 갱신하는 보조 AI가 못 읽습니다.',
  '- **시간 등호 조건은 래치가 필요합니다.** `dom == 5`(급여일)는 그 날의 모든 턴에 참이라',
  '  래치 없이는 매 턴 지급됩니다. 위 래치 짝이나 "마지막 지급 월" 기록 변수로 막으세요.',
];

function schemaLanguageTable() {
  return [
    '| 필드 | 누가 읽나 | 어떤 언어로 |',
    '|---|---|---|',
    '| `vars[].label`, `enum` 값, `statusUI` 그룹 이름, `actions[].label` | **플레이어** (화면의 상태창) | 한국어 |',
    '| 모든 `id` | 아무도 (내부 식별자) | 영문 필수 |',
    '| `promptState.template`, `directives[].text`, `updater.guide`, `events[].notify`, `actions[].inject` | **AI 모델** | 영어 권장 — 토큰이 크게 줄고 지시 이해도가 올라갑니다 |',
    '',
    '※ 모델에게 가는 문구가 영어여도 모델은 한국어로 서술합니다. 걱정하지 마세요.',
    '※ `actions[].label`은 화면에 뜨므로 한국어로 쓰되, **반드시 이모지 하나로 시작**하세요 (예: `🔥 화로 최대`). 실행 버튼에는 그 이모지만 표시됩니다.',
  ].join('\n');
}

function buildSchemaSpecPrompt(exampleKey, includeValidator, gen = null) {
  // gen = { request, botCtx } — 내장 AI 생성(위층)이 채워 보낼 때. 복붙 경로는 placeholder 유지.
  const ex = TEMPLATES[exampleKey] ?? TEMPLATES.business;
  const parts = [
    '아래 규격에 맞는 시뮬레이션 스키마(JSON)를 만들어 주세요.',
    'RisuAI용 SimCore 플러그인이 이 JSON을 읽어서 상태창을 그리고 규칙·이벤트를 굴립니다.',
    '',
    '## 내가 만들 봇',
    ...(gen && gen.request
      ? [gen.request]
      : ['(여기를 채우세요 — 세계관과 주인공, 추적하고 싶은 수치, 일어나면 좋을 사건,',
        ' 플레이어가 누를 수 있는 행동, 상태창에 보이고 싶은 것)']),
    ...(gen && gen.botCtx
      ? ['', '## 이 봇의 실제 설정 (자동 동봉) — 세계관·인물·수치의 소재를 여기서 얻으세요', gen.botCtx]
      : []),
    '',
    '## 출력 형식',
    '- **JSON 하나만** 출력하세요. 코드펜스 바깥에 설명을 덧붙이지 마세요.',
    '- 최상위 키: `simcore`("0.1"), `meta`, `vars`, `derived`, `rules`, `directives`, `actions`, `updater`, `promptState`, `statusUI`, `setup`',
    '- 변수는 8~16개가 적당합니다. 너무 많으면 플레이어도 모델도 못 따라갑니다.',
    '',
    '## 언어 규칙 — 필드마다 읽는 사람이 다릅니다',
    schemaLanguageTable(),
    '',
    '## 절대 규칙 (어기면 설치가 거부됩니다)',
    ...SCHEMA_HARD_RULES,
    '',
    '## 수식 언어',
    ...SCHEMA_EXPR_RULES.map((s) => '- ' + s),
    '',
    '## 밸런스 — 문법이 맞아도 게임이 죽을 수 있습니다',
    '검증기는 문법만 봅니다. 아래는 검증을 통과하고도 실제로는 아무 일도 안 일어나게 만드는 함정들입니다.',
    ...SCHEMA_BALANCE_RULES,
    '',
    '## 반복 이벤트 — once인가 래치인가',
    ...SCHEMA_EVENT_PATTERN_RULES,
    '',
    '## 시간 진행',
    ...SCHEMA_TIME_RULES,
    '',
    `## 예제 — "${ex.label}". 이 구조를 그대로 따라가세요`,
    '```json',
    JSON.stringify(ex.schema, null, 2),
    '```',
  ];
  if (includeValidator) {
    parts.push('',
      '## 부록: 검증기 원문',
      '위 설명과 어긋나는 부분이 있으면 **이 코드가 정답**입니다. 플러그인이 실제로 돌리는 검사입니다.',
      '```js',
      String(validateSchema),
      '```');
  }
  return parts.join('\n');
}

/** 검증 실패를 AI에게 되돌려주는 프롬프트 — 이 왕복이 있어야 실제로 굴러간다 */
function buildFixPrompt(schema, v) {
  const parts = [
    '방금 준 스키마를 SimCore 검증기에 넣었더니 아래 문제가 나왔습니다.',
    '고쳐서 **전체 JSON을 다시** 주세요 (일부만 주지 말고 통째로).',
    '',
  ];
  if (v.errors.length) {
    parts.push('## 오류 — 반드시 전부 해결해야 설치됩니다',
      ...v.errors.map((e) => `- \`${e.path}\` — ${e.msg}`), '');
  }
  if (v.warnings.length) {
    parts.push('## 경고 — 고치면 좋습니다',
      ...v.warnings.map((w) => `- \`${w.path}\` — ${w.msg}`), '');
  }
  if (!v.errors.length && !v.warnings.length) {
    parts.push('## 문법 오류는 없습니다', '아래 스키마를 다시 검토해서 개선할 점만 제안해 주세요.', '');
  }
  parts.push('경로 표기는 JSON 위치입니다. 예를 들어 `$.actions[0].effects[1].expr`는',
    '`actions` 배열의 첫 번째 액션 안 `effects` 배열의 두 번째 항목의 `expr` 필드입니다.',
    '',
    '## 현재 스키마',
    '```json',
    JSON.stringify(schema, null, 2),
    '```');
  return parts.join('\n');
}

// ── AI 왕복 패치 — "고치게 하기" 내보내기 ────────────────────
// 통짜 재생성(①)과 달리 바꿀 부분만 받는다. AI가 실수해도 가져오기의 병합 검증(patch.js)이
// 정지시키므로, 여기서 할 일은 둘뿐이다 — (1) 기존 id를 전부 알려 우연 충돌을 줄이고
// (2) 출력 형식을 못박는 것. 스키마 통짜 대신 다이제스트를 보내는 이유: 베리디아급이면
// 절반이 상태창 HTML/CSS라, 참조에 필요한 것만 추리면 붙여넣기 부담과 실수 확률이 같이 준다.

// 이벤트·액션·판정·지시문·allow는 **전문**을 실어 보낸다 — update가 항목 통 교체라, 기존
// 본문을 모르면 AI가 update를 겁내 remove+add로 우회하다 가져오기에서 막힌다 (실전 사고).
// 용량 주범(상태창 HTML/CSS)은 여전히 제외라 다이제스트의 취지는 유지된다.
function patchIdDigest(schema) {
  const out = ['### 변수', varContractTable(schema)];
  // 시간 체계가 켜진 봇 — 노출 이름은 조건식에 쓸 수 있는 읽기 전용 값이다. 다이제스트에
  // 안 실으면 AI가 기존 조건식에서 눈치로 배워야 한다 (실측: 시설 패치 때 운 좋게 통했다).
  const tcfg = timeConfig(schema);
  if (tcfg) {
    out.push('', '### 시간 체계 (읽기 전용 — 조건식·자리표시자에 변수처럼 사용 가능)',
      `- 사용 가능한 이름: ${tcfg.expose.map((n) => `\`${n}\``).join(' ')}`,
      `- 시작 \`${schema.time.start}\` · 진행 ${tcfg.advance === 'explicit' ? '명시적(skip_day/skip_min 소비)' : '턴마다 하루'} · 달력 ${tcfg.calendar}`,
      '- 이 이름들은 `set` 대상이 될 수 없고, `time` 섹션 자체도 패치로 못 다룹니다 (편집기 [시간] 탭 전용).');
  }
  const body = (e) => { const { _rnd, ...b } = e; return '`' + JSON.stringify(b) + '`'; };
  const evs = [...(schema.rules?.events || []),
    ...((schema.rules?.randomEvents?.table || []).map((e) => ({ ...e, _rnd: true })))];
  if (evs.length) {
    out.push('', '### 이벤트 (events / randomEvents) — update로 고칠 땐 이 전문을 바탕으로 다시 쓰세요',
      ...evs.map((e) => `- ${e._rnd ? '(랜덤) ' : ''}${body(e)}`));
  }
  const fullLine = (label, arr) => {
    if ((arr || []).length) out.push('', `### ${label}`, ...arr.map((x) => `- ${body(x)}`));
  };
  fullLine('액션 (actions)', schema.actions);
  fullLine('판정 (checks)', schema.checks);
  fullLine('지시문 (directives)', schema.directives);
  fullLine('AI 허용 변수 (allow)', schema.updater?.allow);
  return out.join('\n');
}

function buildPatchExportPrompt(schema, opts = {}) {
  // 🔵(low)는 "확인만 해보세요" 수준이라 보내지 않는다 — 고칠 게 아닌 걸 고치게 하면 설계가 망가진다
  const fixes = (opts.findings || []).filter((f) => f.sev !== 'low');
  const s = opts.stats;
  const want = fixes.length
    ? ['## 진단에서 나온 문제 — 이걸 고치는 패치를 주세요',
      s ? `이 스키마를 실제로 ${s.turns}턴 × ${s.runs}시드 굴려 본 결과입니다.` : '',
      ...fixes.map((f, i) => `${i + 1}. ${f.sev === 'high' ? '🔴' : '🟡'} **[${f.tag}]** ${f.text}`),
      '',
      '- 한 지적이 여러 탭에 걸쳐도 됩니다 — 패치는 섹션을 자유롭게 넘나듭니다.',
      '- **고칠 자리가 상태창·매 턴 정산(onTurn)·새 시작이면 패치로 못 다룹니다** — 그 사실을 JSON 대신 말로 알려주세요.',
      '- 진단은 보조 AI를 안 돌리고 굴린 결과라, **AI가 바꾸는 변수는 "안 움직임"으로 잘못 나옵니다.**',
      '  그런 지적은 고치지 말고 그렇다고 말해 주세요.']
    : opts.request
      ? ['## 내가 원하는 것', opts.request]
      : ['## 내가 원하는 것',
        '(여기를 채우세요 — 예: "산적 습격 이벤트 추가. 경계가 5 이상이면 발동, 금화를 뺏김"',
        ' / "노역 액션 보상을 30으로" / "안 쓰는 명성 변수 지워줘")'];
  return [
    fixes.length
      ? '지금 쓰고 있는 SimCore 시뮬레이션 스키마의 문제를 **부분 수정**으로 고치려 합니다.'
      : '지금 쓰고 있는 SimCore 시뮬레이션 스키마에 **부분 수정**을 하려 합니다.',
    '스키마 전체를 다시 만들지 말고, 바꿀 부분만 담은 **패치 JSON 하나**를 출력하세요.',
    '',
    ...want,
    ...(opts.botCtx
      ? ['', '## 이 봇의 실제 설정 (자동 동봉) — 세계관·인물 참고용. 스키마 항목의 기준은 아래 다이제스트입니다', opts.botCtx]
      : []),
    '',
    '## 패치 형식',
    '```json',
    '{',
    '  "patchVersion": 1,',
    '  "add":    { "vars": [ { "id": "raid_alert", "label": "산적 경계", "type": "int", "init": 0, "min": 0, "max": 10 } ],',
    '              "events": [ { "id": "bandit_raid", "when": "raid_alert >= 5", "effects": [ { "set": "gold", "expr": "max(0, gold - 50)" } ], "notify": "Bandits raid the village." } ] },',
    '  "update": { "actions": [ { "id": "work", "label": "⚒ 노역", "mode": "oneshot", "effects": [ { "set": "gold", "expr": "gold + 30" } ] } ] },',
    '  "remove": { "vars": ["fame"] }',
    '}',
    '```',
    '- `add` = 새로 만드는 항목. **아래 "이미 있는 id"와 겹치면 안 됩니다** — 뜻이 비슷해도 반드시 새 id를 지으세요.',
    '- `update` = 기존 항목 수정. **기존 id만** 쓸 수 있고, 항목을 **통째로 다시** 씁니다 — 바꿀 필드만 주면 나머지 필드가 사라집니다.',
    '  기존 본문은 아래 다이제스트에 전문이 있으니, 그걸 바탕으로 고쳐 쓰세요.',
    '- **같은 id를 `remove`와 `add`에 함께 넣지 마세요** — 가져오기가 거부합니다. 항목을 갈아엎을 때도 `update`로 전문을 다시 쓰면 결과가 같습니다.',
    '- `remove` = 삭제. **사용자가 명시적으로 지워달라고 한 것만** 넣으세요. 정리 차원의 임의 삭제 금지.',
    '- 섹션 키는 전부 평평하게: `vars` `derived` `checks` `events` `randomEvents` `directives` `actions` `allow`',
    '- 랜덤 이벤트를 **이 봇에 처음** 넣을 때는 최상위에 `"randomEventsChance": 0.1` 처럼 턴당 발동률(0~1)을 함께 주세요.',
    '- 상태창(statusUI)·onTurn·setup·meta는 패치로 못 다룹니다. 그쪽 수정이 필요하면 JSON 대신 그 사실을 알려주세요.',
    '- 새 변수를 AI(보조 모델)가 서사에 따라 움직여야 하면 `allow`에도 같이 추가하세요.',
    '  단 **판정값·이벤트 플래그·날짜류 카운터·숨긴 정답은 allow에 넣지 마세요** — 시스템이 굴리는 값입니다.',
    '- 한 인물의 변수 여러 개(호감·기분·위치…)가 같은 mentions 낱말을 공유하는 것은 **정상 설계**입니다',
    '  (그 인물 장면에서 함께 열림). 경고를 지우려고 낱말을 억지로 나누지 마세요.',
    '',
    '## 반복 이벤트 — once인가 래치인가',
    ...SCHEMA_EVENT_PATTERN_RULES,
    ...(schema.time ? ['', '## 시간 진행', ...SCHEMA_TIME_RULES] : []),
    '',
    '## 이미 있는 항목 — add가 이 id들과 겹치면 가져오기에서 정지되고, update는 이 전문을 기준으로 다시 씁니다',
    patchIdDigest(schema),
    '',
    '## 언어 규칙 — 필드마다 읽는 사람이 다릅니다',
    schemaLanguageTable(),
    '',
    '## 절대 규칙 (어기면 가져오기가 거부됩니다)',
    ...SCHEMA_HARD_RULES,
    '',
    '## 수식 언어',
    ...SCHEMA_EXPR_RULES.map((s) => '- ' + s),
    '',
    '**패치 JSON 하나만** 출력하세요. 코드펜스 바깥에 설명을 덧붙이지 마세요.',
  ].join('\n');
}

// ── 내장 AI 생성 (위층) ──────────────────────────────────────
// 규격 복붙 왕복(공홈 다녀오기)을 플러그인 안으로 접는다. 프롬프트는 위 복붙용 빌더를
// 그대로 재사용한다 — 복붙용 문서가 곧 API 요청 본문 (설계: docs/design-내장-AI-생성.md).
// 호출 자체는 어댑터가 opts.ai.generate로 주입한다 — 코어는 리수 API를 모른다.
// ⚠ 자기 정산 함정: 주입되는 generate는 정산에 안 걸리는 경로여야 한다 — submodel이거나,
//   'model'이면 자기 식별표(GEN_SENTINEL)를 달아 어댑터 beforeRequest가 무개입 통과시키는 경로만.
//   식별 없는 mode:'model'은 우리 beforeRequest가 진짜 턴으로 알고 정산까지 돈다 (v0.37.2의 거울상).

function schemaIsBlank(s) {
  const n = (a) => (a || []).length;
  return !s || n(s.vars) + n(s.derived) + n(s.directives) + n(s.actions) + n(s.checks)
    + n(s.rules && s.rules.onTurn) + n(s.rules && s.rules.events)
    + n(s.rules && s.rules.randomEvents && s.rules.randomEvents.table)
    + n(s.updater && s.updater.allow) + n(s.statusUI && s.statusUI.groups)
    + n(s.setup && s.setup.presets) === 0;
}

const BOT_CTX_CAP = 20 * 1024; // 바이트 — 로어북이 수십 KB인 봇 방어

function byteLen(s) { return new TextEncoder().encode(String(s)).length; }

/**
 * 봇 설명·로어북을 생성 프롬프트에 동봉할 덩어리로 조립.
 * ⚙simcore 항목은 제외 — 스키마는 다이제스트로 이미 실리므로 이중 전송 금지
 * (어댑터도 거르지만 여기서 한 번 더).
 */
function assembleBotContext(ctx, cap = BOT_CTX_CAP) {
  if (!ctx) return { text: '', bytes: 0, truncated: false };
  const pieces = [];
  let used = 0, truncated = false;
  const push = (piece) => {
    const b = byteLen(piece) + 2;
    if (used + b > cap) {
      if (!pieces.length) { // 첫 덩어리(대개 설명)가 혼자 상한 초과 — 앞부분만 싣는다
        let t = piece;
        while (byteLen(t) > cap) t = t.slice(0, Math.floor(t.length * 0.9));
        pieces.push(t); used = cap;
      }
      truncated = true;
      return false;
    }
    pieces.push(piece); used += b;
    return true;
  };
  if ((ctx.name || '').trim()) push(`### 봇 이름\n${String(ctx.name).trim()}`);
  if ((ctx.desc || '').trim()) push(`### 봇 설명 (description)\n${String(ctx.desc).trim()}`);
  for (const l of ctx.lore || []) {
    const nm = String(l.name || '');
    if (nm.includes('⚙simcore')) continue;
    if (!(l.content || '').trim()) continue;
    if (!push(`### 로어북: ${nm || '(이름 없음)'}\n${String(l.content).trim()}`)) break;
  }
  const text = pieces.join('\n\n');
  return { text, bytes: byteLen(text), truncated };
}

/** 위층 생성 프롬프트 — 스키마가 비어 있으면 통짜 생성, 있으면 부분 패치. 유저는 구분을 몰라도 된다 */
function buildAiRequestPrompt(schema, request, botCtxText) {
  return schemaIsBlank(schema)
    ? buildSchemaSpecPrompt('business', true, { request, botCtx: botCtxText })
    : buildPatchExportPrompt(schema, { request, botCtx: botCtxText });
}

// ── 탭 단위로 AI에게 맡기기 ──────────────────────────────────
// 스키마를 통째로 만들게 하면 변수를 지어내면서 동시에 일관되게 써야 해서 오류가 쏟아진다.
// 탭 하나만 맡기면 "이미 정의된 변수 목록"을 계약으로 줄 수 있어 그 오류가 원천적으로 사라진다.

const EVENT_PATTERNS = [
  ['임계 돌파', '선을 넘으면 상태 플래그를 켠다. 되돌아오는 조건(회복)을 같이 만들지 않으면 영구 상태가 된다.',
    '{ "id": "riot", "when": "discontent >= 85 and not collapsed",\n'
    + '  "effects": [{ "set": "collapsed", "expr": "1" }],\n'
    + '  "notify": "군중이 화로 앞을 점거했다. 통제가 무너졌다." }'],
  ['시한폭탄', '수치가 조용히 쌓이다 선을 넘으면 터진다. 효과에서 값을 낮춰 리셋해야 다시 쌓인다.',
    '{ "id": "scandal_breaks", "when": "risk >= 70 and not in_scandal",\n'
    + '  "effects": [{ "set": "in_scandal", "expr": "1" }, { "set": "risk", "expr": "55" }],\n'
    + '  "notify": "의혹이 1면에 터졌다." }'],
  ['고갈', '자원이 바닥나면 정책(enum)을 강제로 바꾼다. 플레이어의 선택권을 시스템이 뺏는 순간이라 임팩트가 크다.',
    '{ "id": "fuel_out", "when": "coal <= 0 and heat != \\"정지\\"",\n'
    + '  "effects": [{ "set": "heat", "expr": "\\"정지\\"" }],\n'
    + '  "notify": "석탄이 바닥났다. 화로가 꺼지고 온기가 빠르게 빠져나간다." }'],
  ['소비·해소', '효과가 조건 자체를 지운다. 이렇게 안 짜면 조건이 참인 동안 매 턴 반복 발동한다.',
    '{ "id": "bill_passed", "when": "bill_result == \\"가결\\"",\n'
    + '  "effects": [{ "set": "capital", "expr": "min(100, capital + 10)" },\n'
    + '              { "set": "bill_result", "expr": "\\"없음\\"" }],\n'
    + '  "notify": "법안이 본회의를 통과했다." }'],
  ['회복', '대가를 치르고 나쁜 상태를 푼다. 임계 돌파와 짝을 이룬다.',
    '{ "id": "scandal_over", "when": "in_scandal and capital >= 70",\n'
    + '  "effects": [{ "set": "in_scandal", "expr": "0" }, { "set": "capital", "expr": "capital - 25" }],\n'
    + '  "notify": "정치 자본을 쏟아부어 의혹을 덮었다. 대가는 적지 않았다." }'],
  ['이정표', '`"once": true` — 조건을 처음 만족할 때 딱 한 번만. **다시는 안 오는 전개**에만 쓴다 '
    + '(겨울을 넘김, 첫 고백, 최초 발견). 오르내리는 게이지의 문턱에 once를 쓰면 두 번째부터 영영 침묵한다 — '
    + '그런 자리는 위 [임계 돌파]+[회복] 짝(경보 플래그를 켜고 끄는 래치)이 정답이다.',
    '{ "id": "survived", "once": true, "when": "day_no >= 30 and not collapsed",\n'
    + '  "notify": "기온이 처음으로 올라갔다. 최악의 겨울을 넘겼다." }'],
  ['기한 만료(목록)', '`expire`는 목록에서 항목의 `@숫자`가 이 값보다 지난 것을 스스로 뺀다. '
    + '서사가 등록한 한시 법령·계약·부역·저주가 기한이 다하면 알아서 사라진다 — `@`가 없는 항목은 무기한이라 안 건드린다. '
    + 'onTurn에 한 줄 둬도 되고, 예시처럼 목록이 비어 있지 않을 때만 도는 이벤트로 둬도 된다.\n'
    + '기준은 **이 턴이 끝나는 시점**이어야 한다. 시간 체계(time)를 켰다면 `"elapsed"`가 그대로 정답이다 — '
    + '엔진이 onTurn·이벤트보다 **먼저** 시간을 굳히므로 이미 이번 턴이 반영된 값이다. '
    + '(시간 체계 없이 직접 만든 카운터라면 아직 안 올라간 값이라 `"day + 1"`처럼 더해 줘야 한 턴 늦게 빠지지 않는다.)',
    '{ "id": "law_expiry", "when": "count(laws) > 0",\n'
    + '  "effects": [{ "list": "laws", "expire": "elapsed" }] }'],
  ['값 자르기', '범위를 벗어난 값을 되돌린다. 플레이어에게 알릴 게 없으므로 notify를 넣지 않는다.',
    '{ "id": "hp_cap", "when": "hp > max_hp",\n'
    + '  "effects": [{ "set": "hp", "expr": "max_hp" }] }'],
];

const ACTION_PATTERNS = [
  ['자원 전환', '가진 것을 주고 다른 것을 얻는다. 가장 기본형.',
    '{ "id": "restock", "label": "📦 발주", "mode": "oneshot", "cooldown": 1,\n'
    + '  "inject": "[경영 결정] 재고를 채워 넣는다.",\n'
    + '  "effects": [{ "set": "stock", "expr": "stock + 60" }, { "set": "cash", "expr": "cash - 360" }] }'],
  ['트레이드오프', '한쪽을 얻으면 반대쪽을 잃는다. 선택을 아프게 만드는 핵심 장치.',
    '{ "id": "meet_biz", "label": "🤝 재계 회동", "mode": "oneshot", "cooldown": 3,\n'
    + '  "inject": "[정치 행동] 재계 인사들과 자리를 갖는다.",\n'
    + '  "effects": [{ "set": "biz", "expr": "min(100, biz + 10)" }, { "set": "labor", "expr": "max(0, labor - 6)" }] }'],
  ['판정(주사위)', 'rand()는 조건에 못 쓴다 → **효과에서 굴려 변수에 담고, 그 변수로 등급을 매기는 2단 구조**를 쓴다.',
    '{ "id": "submit_bill", "label": "📜 법안 표결", "mode": "oneshot", "cooldown": 3, "when": "capital >= 15",\n'
    + '  "inject": "[정치 행동] 법안을 본회의에 올린다. 표결 결과는 상태창의 판정을 따르라.",\n'
    + '  "effects": [{ "set": "bill_roll", "expr": "rand(1, 100)" },\n'
    + '              { "set": "bill_result", "expr": "bill_roll <= bill_odds ? \\"가결\\" : \\"부결\\"" }] }'],
  ['정책 전환', 'enum 값을 갈아끼워 파생 사슬 전체를 흔든다. 수치가 아니라 국면이 바뀐다.',
    '{ "id": "stoke", "label": "🔥 화로 최대", "mode": "oneshot", "when": "coal > 0",\n'
    + '  "inject": "[결정] 화로 출력을 최대로 올린다.",\n'
    + '  "effects": [{ "set": "heat", "expr": "\\"최대\\"" }] }'],
  ['지속', '`"mode": "hold"` — 다시 끌 때까지 매 턴 효과가 적용된다. 유지비가 드는 정책에 쓴다.',
    '{ "id": "patrol", "label": "🛡 순찰 강화", "mode": "hold",\n'
    + '  "inject": "[지속 정책] 병사들이 순찰을 강화하고 있다.",\n'
    + '  "effects": [{ "set": "gold", "expr": "gold - 20" }] }'],
  ['소모(목록)', '목록 변수는 수식으로 못 바꾼다. `list`/`remove`/`add` 형태를 쓴다.',
    '{ "id": "potion", "label": "🧪 회복약 사용", "mode": "oneshot", "when": "has(inventory, \'회복약\')",\n'
    + '  "inject": "[플레이어 액션] 회복약을 마신다.",\n'
    + '  "effects": [{ "list": "inventory", "remove": ["회복약"] },\n'
    + '              { "set": "hp", "expr": "min(hp + 50, max_hp)" }] }'],
];

// 난이도는 "숫자를 크게/작게"가 아니다. 자원만 반토막 내면 어려워지는 게 아니라 판이 짧아질 뿐이고,
// 플레이어는 똑같은 판을 더 조급하게 볼 뿐이다. 판이 기울어 있어야 다른 이야기가 나온다.
const PRESET_PATTERNS = [
  ['비축 — 며칠 버티나', '자원 시작량. 가장 손쉬운 축이지만 **이것만 만지면 난이도가 아니라 길이가 바뀝니다.** '
    + '`시작량 ÷ 턴당 소모`로 몇 턴 버티는지 계산하고 정하세요.',
    '{ "id": "mild", "label": "🌤 온화한 겨울",\n'
    + '  "set": { "coal": 520, "food": 300, "hope": 70 } }'],
  ['완충 — 붕괴선까지의 거리', '게이지 시작값. 붕괴 조건이 `hope <= 0`이면 시작 희망이 그대로 여유 턴입니다. '
    + '70 → 45로 낮추면 실수 한 번이 치명적이 됩니다. 수치 총량은 그대로인데 체감은 완전히 달라집니다.',
    '{ "id": "harsh", "label": "🥶 혹한",\n'
    + '  "set": { "coal": 300, "food": 180, "hope": 45 } }'],
  ['국면 — 이미 기울어진 판', 'enum/bool을 나쁜 쪽으로 시작시킵니다. **가장 강하고 가장 재미있는 축입니다** — '
    + '첫 턴부터 이야기가 생기고, 플레이어가 "왜 이런 상황인지"를 스스로 채웁니다. '
    + '예고 변수(습격까지 N턴)를 미리 켜 두거나 지속 상태(한파 잔여 6일)를 걸어 두는 것도 여기 들어갑니다.',
    '{ "id": "aftermath", "label": "🔥 폭동 직후",\n'
    + '  "set": { "coal": 300, "food": 180, "hope": 45,\n'
    + '           "heat": "정지", "ration": "절반", "sick": 6, "discontent": 55 } }'],
  ['규모 — 아예 다른 판', '직원·인구처럼 산출과 소모를 동시에 키우는 값. 어려워지는 게 아니라 **다른 게임**이 됩니다. '
    + '난이도가 아니라 배경 선택에 쓰세요.',
    '{ "id": "metro", "label": "🏙 역세권 대형점",\n'
    + '  "set": { "cash": 9000, "staff": 4, "district": "역세권" } }'],
  ['배경 — 난이도가 아닌 것', '출신·컨셉만 바꾸는 프리셋. **난이도와 섞지 마세요** — 플레이어는 하나만 고를 수 있어서, '
    + '섞어 놓으면 "어려움 + 아이돌 컨셉"을 만들 수 없습니다. 한 스키마에서는 한쪽 기준으로만 나누세요.',
    '{ "id": "idol", "label": "🎀 아이돌 지망",\n'
    + '  "set": { "concept": "노래", "subs": 80, "funds": 30 } }'],
];

const PRESET_FIELD_SPEC = [
  '| 필드 | 설명 |',
  '|---|---|',
  '| `id` | 영문 id. 프리셋끼리 겹치면 안 됩니다 |',
  '| `label` | 버튼에 **그대로 전부** 표시됩니다. 이모지 + 짧은 이름으로 (예: `🥶 혹한`). 액션 버튼과 달리 글자까지 보입니다 |',
  '| `set` | `{ "변수id": 값 }` 형태. 여기 적은 변수만 바뀌고 나머지는 원래 시작값 그대로입니다 |',
  '',
  '**`set`의 값은 수식이 아니라 값입니다.** `"coal * 2"`, `"coal + 100"` 같은 건 문자열로 취급돼 거부됩니다.',
  '타입이 정확해야 합니다 — `int`/`float`은 따옴표 없는 숫자, `enum`은 **선택지 목록 안에 있는 문자열**,',
  '`bool`은 `true`/`false`, `list`는 배열, `text`는 문자열. `min`/`max` 범위도 지켜야 합니다.',
  '**파생 변수는 지정할 수 없습니다** (계산 결과라서). 재료가 되는 변수를 바꾸세요.',
  '`turn`/`day` 같은 진행 카운터는 엔진이 관리하니 건드리지 마세요.',
];

const PRESET_BALANCE_RULES = [
  '- **적지 않은 변수는 원래 시작값으로 갑니다.** 이건 결함이 아니라 기능입니다 — 기준선 프리셋은 `"set": {}`로 비워 두는 게 가장 정직하고, 특정 프리셋에서만 의미 있는 값(폐허에서만 생기는 환자 수 같은)은 그 프리셋에만 적으면 됩니다. 다만 **난이도를 가르는 핵심 변수**는 프리셋마다 빠짐없이 적으세요. 그게 빠지면 기본값이 사다리를 벗어나 순서가 뒤집힙니다.',
  '- **기준선("보통")은 현재 시작값과 똑같이 두세요.** 그래야 나머지를 어느 쪽으로 얼마나 밀었는지 한눈에 보이고, 밸런스를 다시 잡을 때 기준이 흔들리지 않습니다.',
  '- **이름만 다르고 값이 같은 프리셋을 만들지 마세요.** 플레이어는 골랐다고 생각하는데 실제로는 아무것도 안 고른 게 됩니다.',
  '- **한 축만 반으로 깎지 마세요.** 자원만 반토막 내면 어려워지는 게 아니라 판이 짧아집니다. 비축·완충·국면을 조금씩 같이 미는 편이 훨씬 다른 판이 됩니다.',
  '- 쉬움과 어려움의 격차는 **버티는 턴 수로 2배 안쪽**이 무난합니다. 3배가 넘어가면 어려움은 아무도 못 넘기고 쉬움은 아무 일도 안 일어납니다.',
  '- **3~4개면 충분합니다.** 버튼이 한 줄에 늘어서므로 6개가 넘으면 고르기 전에 지칩니다.',
  '- 라벨에 난이도 이름을 넣었다면 [🔬 진단] 탭에서 실제로 굴려 순서를 확인하세요. 시작값을 여러 개 동시에 밀면 합이 반대로 나오는 일이 정말 흔합니다 — 진단이 프리셋마다 판을 굴려 수명을 재고, 이름과 실제가 뒤집혔으면 잡아 줍니다.',
];

// 변수는 다른 모든 탭의 전제라 가장 먼저 만들어야 한다.
// 변수 없이 규칙부터 맡기면 AI가 이름을 지어내고, 가져오기에서 수백 건이 한꺼번에 터진다.
const VAR_PATTERNS = [
  ['자원 (비축 → 소모)', '매 턴 줄어드는 저장고. **늘리는 경로를 반드시 같이 계획하세요** — 액션이든 랜덤이벤트든. 소모만 있는 자원은 예외 없이 바닥나고 세계가 무너집니다.',
    '{ "id": "coal", "label": "석탄", "type": "int", "min": 0, "init": 400 }'],
  ['정책 (선택지)', 'enum. 플레이어가 갈아끼우면 파생 사슬 전체가 흔들립니다. 시뮬레이션의 조종간이라 1~3개는 꼭 두세요.',
    '{ "id": "heat", "label": "난방 출력", "type": "enum",\n'
    + '  "enum": ["정지", "약", "보통", "최대"], "init": "보통" }'],
  ['게이지 (0~100)', '민심·사기처럼 오르내리는 값. `min`/`max`를 반드시 주고 규칙에서 `clamp()`로 가둡니다.',
    '{ "id": "hope", "label": "희망", "type": "int", "min": 0, "max": 100, "init": 60 }'],
  ['지속 상태 (두 개가 한 쌍)', '"지금 무엇이" + "몇 턴 남았나". 이 둘이 있어야 며칠 가는 이상 기후·버프·디버프를 만들 수 있습니다. onTurn에서 잔여를 1씩 깎고, 0이 되면 이벤트로 해제하세요.',
    '{ "id": "condition", "label": "지역 이상", "type": "enum",\n'
    + '  "enum": ["없음", "한파", "폭염", "역병"], "init": "없음" },\n'
    + '{ "id": "condition_left", "label": "이상 잔여일", "type": "int", "min": 0, "init": 0 }'],
  ['지속 효과 등록부 (목록 + sum)', '계약·조약·저주·부역처럼 **서사가 만들어 내는 지속 효과**를 담는 자리입니다. '
    + '어떤 계약이 생길지는 미리 알 수 없으니 스키마에 다 적어 둘 수 없습니다. 대신 목록 하나를 열어 두고, '
    + 'AI가 성사된 그 턴에 `{"add": ["헤세 상단 양모 계약 +12"]}`로 등록하면 `sum()`이 매 턴 알아서 더합니다. '
    + '파기되면 `remove`로 빼면 그만이고, 사용자도 패널에서 ✕로 지울 수 있습니다. '
    + '**항목 끝에 숫자를 두는 것이 규칙입니다** — 없으면 0으로 셉니다. '
    + '쓰는 쪽은 파생에서 `"expr": "tax + sum(contracts)"`, onTurn에서 `{"set":"gold","expr":"max(0, gold + income)"}` 식입니다.\n'
    + '기한이 있으면 항목에 `@끝나는날`을 넣고(`"성벽 부역 @450 -4"`) onTurn에 '
    + '`{"list":"contracts","expire":"day"}`를 두세요 — 그날이 지나면 스스로 빠집니다. `@`가 없으면 무기한입니다. '
    + '**남은 일수가 아니라 끝나는 시점**을 적는 이유는, 남은 일수면 매 턴 전부 1씩 깎아야 하는데 '
    + '미니 표현식엔 반복문이 없어 불가능하고, 절대값이면 날짜를 며칠씩 건너뛰어도 저절로 맞기 때문입니다.\n'
    + '단 **보조 AI에게는 `@+기간`으로 쓰게 하세요**(`"@+1080"`). 추가되는 순간 시스템이 '
    + '위 expire 식으로 절대값을 계산해 굳힙니다. "지금 경과일 + 1080"을 모델에게 시키면 틀리고, '
    + '틀려도 조용합니다 — 3000년에 끝나는 계약이 생겨도 아무도 모릅니다.',
    '{ "id": "contracts", "label": "지속 계약", "type": "list", "init": [], "maxItems": 8,\n'
    + '  "desc": "매일 들어오는 수입원. \\"이름 +숫자\\" 형태로 끝에 일당을 적는다. 기한이 있으면 \\"@끝나는경과일\\"을 앞에 넣는다." }'],
  ['예고 (두 개가 한 쌍)', '"무엇이 오나" + "몇 턴 뒤". 다가오는 위협을 미리 알려 준비할 시간을 주는 장치. 도착하면 이벤트에서 처리하고 둘 다 초기화합니다.',
    '{ "id": "raid_kind", "label": "예고된 습격", "type": "enum",\n'
    + '  "enum": ["없음", "도적", "군대"], "init": "없음" },\n'
    + '{ "id": "raid_in", "label": "습격까지", "type": "int", "min": 0, "init": 0 }'],
  ['플래그', 'bool. 한 번 켜지면 세계의 규칙이 바뀌는 분기점. **끄는 조건도 같이 설계하세요** — 없으면 영구 상태가 됩니다.',
    '{ "id": "collapsed", "label": "통제 붕괴", "type": "bool", "init": false }'],
  ['목록', 'list. 소지품·시행 법령처럼 늘었다 줄었다 하는 것. **수식으로 못 바꾸고** `count()`/`has()`/`sum()`으로만 읽습니다.',
    '{ "id": "laws", "label": "시행 법령", "type": "list", "init": [], "maxItems": 6 }'],
  ['파생 사슬 — 가장 중요합니다', '읽기 전용 계산값. 정책 → 중간값 → 최종값으로 이어 붙이면 **수치 하나가 세계 전체를 흔듭니다.** 계산으로 정해지는 값은 상태 변수로 만들지 말고 전부 여기로 빼세요.',
    '{ "id": "heat_out", "label": "화로 출력",\n'
    + '  "expr": "heat == \\"최대\\" ? 3 : (heat == \\"보통\\" ? 2 : (heat == \\"약\\" ? 1 : 0))" },\n'
    + '{ "id": "indoor", "label": "실내 온도",\n'
    + '  "expr": "temp + heat_out * 9 + shelter * 2", "format": "{v}°C" },\n'
    + '{ "id": "coal_burn", "label": "일 석탄소모", "expr": "heat_out * 14 + 5" }'],
];

const VAR_FIELD_SPEC = [
  '| 필드 | 설명 |',
  '|---|---|',
  '| `id` | 수식에서 쓰는 이름. **영문자로 시작, 영문·숫자·`_`만.** 한글 id는 거부됩니다 |',
  '| `label` | 상태창에 보이는 이름 — **한국어로** 쓰세요 |',
  '| `type` | `int` `float` `text` `bool` `enum` `list` 여섯 가지뿐 |',
  '| `init` | 시작값. 타입에 맞아야 합니다 |',
  '| `min` `max` | 숫자형 범위 (선택이지만 되도록 주세요) |',
  '| `enum` | enum 전용. **2개 이상**이고 `init`이 그 안에 있어야 합니다 |',
  '| `maxItems` | list 전용, 최대 개수 |',
  '| `maxLength` | text 전용, 최대 글자수 |',
  '| `format` | 상태창 표시 형식. `{v}` 자리에 값이 들어갑니다 (예: `{v}G`, `{v}°C`, `{v}명`) |',
  '| `desc` | (선택) 이 항목이 무슨 뜻인지 AI에게 알려주는 한 줄 |',
  '',
  '파생 변수(`derived`)는 `{ "id", "label", "expr" }`(+ 선택 `format`)만 씁니다.',
  '**읽기 전용**이라 `set` 대상이 될 수 없고 `rand()`도 쓸 수 없습니다.',
];

const VAR_BALANCE_RULES = [
  '- **어디서도 값이 바뀌지 않는 변수를 만들지 마세요.** 규칙·액션·랜덤이벤트 중 최소 하나가 그 변수를 `set` 하도록 계획하고, 계산으로만 정해지는 값은 처음부터 파생 변수로 만드세요. (실제 사고: 기온을 목표치로 수렴시키는 변수를 만들어 놓고 그 목표치를 아무도 바꾸지 않아, 기온이 60턴 내내 시작값에서 1도 움직이지 않고 계절 시스템 전체가 죽은 적이 있습니다.)',
  '- **줄어들기만 하는 자원은 반드시 무너집니다.** 자원마다 늘어나는 경로를 하나 이상 정해 두세요. 생산 수단이 없으면 몇 턴 뒤 전멸이 확정입니다.',
  '- 시작값을 조건 경계와 똑같이 두지 마세요. 조건이 `temp < 20`인데 시작값이 정확히 20이면 그 조건은 영영 거짓입니다.',
  '- 매 턴 소모가 있으면 `시작 비축량 ÷ 턴당 소모`로 몇 턴 버티는지 계산하세요. 20~40턴이 무난합니다.',
  '- **10~15개로 시작하세요.** 상태 변수는 매 턴 프롬프트에 실립니다. 30개가 넘으면 토큰도 화면도 감당이 안 됩니다. 계산으로 나오는 값은 전부 파생으로 빼세요.',
  '- 숫자에는 되도록 `min`/`max`를 주세요. 없으면 값이 무한히 커지거나 음수로 내려갑니다.',
];

const EDITOR_ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/; // validate 모듈의 ID_RE와 같은 규칙 (모듈 경계라 재선언)

/** 다른 탭이 실제로 참조 중인 변수 id — 변수 탭에서 지우면 그쪽이 깨진다 */
function idsUsedElsewhere(schema) {
  const rest = JSON.stringify({
    rules: schema.rules, directives: schema.directives, actions: schema.actions,
    updater: schema.updater, promptState: schema.promptState,
    statusUI: schema.statusUI, setup: schema.setup,
  });
  const out = [];
  for (const v of [...(schema.vars || []), ...(schema.derived || [])]) {
    if (!v || !EDITOR_ID_RE.test(v.id || '')) continue; // id가 성하지 않으면 정규식을 만들지 않는다
    if (new RegExp(`\\b${v.id}\\b`).test(rest)) out.push(v.id);
  }
  return out;
}

// ── 변수 정리 (v0.45) ────────────────────────────────────────
// 변수 하나를 지우려면 그걸 쓰는 자리를 **전부** 같이 치워야 한다. 그 자리들이 규칙·상태창·
// 프롬프트 요약·새 시작에 흩어져 있어서, 왕복 패치로는 손댈 수 없는 영역(onTurn·promptState·
// setup)까지 걸린다 — 실전에서 "죽은 템플릿 잔재 층 지우기"가 사실상 불가능했던 이유다.
// 그래서 편집기가 직접 훑어 정리한다. 규율은 패치와 같다: 계획을 먼저 보이고, 병합 결과가
// 검증을 통과할 때만 적용한다.

/** 식이 지울 id를 건드리나 (토큰 기반 — 문자열 리터럴 안의 같은 낱말에 안 속는다) */
function exprHits(expr, doomed) {
  if (typeof expr !== 'string' || !expr.trim()) return false;
  try { return referencedVars(expr).some((id) => doomed.has(id)); } catch { return false; }
}

/**
 * 템플릿에서 {지울변수} 자리표시자를 걷어낸다.
 * dropEmpty면 값이 하나도 안 남는 줄은 줄째 버린다 ("호감도 {affection}" 같은 요약 줄).
 * 상태창 HTML에는 쓰지 않는다 — 줄을 버리면 여는 태그만 남을 수 있다.
 */
function stripPlaceholders(text, doomed, dropEmpty = false) {
  if (typeof text !== 'string') return { text, hit: false };
  const PH = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  let hit = false;
  const out = [];
  for (const line of text.split('\n')) {
    const after = line.replace(PH, (m, id) => (doomed.has(id) ? '' : m));
    if (after === line) { out.push(line); continue; }
    hit = true;
    if (!dropEmpty || /\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(after)) out.push(after);
  }
  return { text: out.join('\n'), hit };
}

/**
 * 변수(들)를 지우면서 그 참조를 함께 걷어낸 스키마를 만든다.
 * @returns { schema, notes[], doomed[], errors[] } — errors가 있으면 적용하면 안 된다
 */
function planVarPurge(schema0, rootIds) {
  const schema = JSON.parse(JSON.stringify(schema0));
  const notes = [];
  const note = (where, what) => notes.push(`${where} — ${what}`);

  // 1) 캐스케이드: 지울 변수를 쓰는 파생은 계산이 불가능해지므로 같이 지운다 (고정점까지)
  const doomed = new Set(rootIds);
  for (let pass = 0; pass < 20; pass++) {
    let grew = false;
    for (const d of (schema.derived || [])) {
      if (doomed.has(d.id)) continue;
      if (exprHits(d.expr, doomed)) { doomed.add(d.id); grew = true; note('파생 변수', `'${d.id}'(${d.label ?? ''})도 함께 — 지울 값을 계산에 쓰고 있음`); }
    }
    if (!grew) break;
  }
  // 판정은 굴림식이 무너지면 통째로 못 쓴다 — 그 판정을 가리키던 곳도 뒤에서 정리한다
  const deadChecks = new Set();
  for (const c of (schema.checks || [])) {
    if (exprHits(c.roll, doomed) || exprHits(c.mod, doomed) || exprHits(c.vs, doomed)) deadChecks.add(c.id);
  }

  const dropEffects = (arr, where) => (arr || []).filter((f) => {
    const hit = doomed.has(f.set) || doomed.has(f.list) || exprHits(f.expr, doomed) || exprHits(f.expire, doomed);
    if (hit) note(where, `효과 한 줄 (${f.set ?? f.list})`);
    return !hit;
  });

  // 2) 변수·파생 본체
  schema.vars = (schema.vars || []).filter((v) => !doomed.has(v.id));
  schema.derived = (schema.derived || []).filter((d) => !doomed.has(d.id));

  // 3) AI 허용·새 시작
  if (schema.updater?.allow) {
    const before = schema.updater.allow.length;
    schema.updater.allow = schema.updater.allow.filter((a) => !doomed.has(a.id));
    if (schema.updater.allow.length !== before) note('AI 설정', `허용 변수 ${before - schema.updater.allow.length}개`);
  }
  if (schema.setup?.ai?.vars) {
    const before = schema.setup.ai.vars.length;
    schema.setup.ai.vars = schema.setup.ai.vars.filter((id) => !doomed.has(id));
    if (schema.setup.ai.vars.length !== before) note('새 시작', `AI 최초설정 대상 ${before - schema.setup.ai.vars.length}개`);
  }
  for (const p of (schema.setup?.presets || [])) {
    for (const id of Object.keys(p.set || {})) if (doomed.has(id)) { delete p.set[id]; note('새 시작', `프리셋 '${p.label ?? p.id ?? ''}'의 ${id}`); }
  }

  // 4) 규칙
  const rules = schema.rules || {};
  if (rules.onTurn) {
    const before = rules.onTurn.length;
    rules.onTurn = dropEffects(rules.onTurn, '규칙 · 매 턴 정산');
    if (rules.onTurn.length !== before) note('규칙', `매 턴 정산 ${before - rules.onTurn.length}줄`);
  }
  const purgeEventList = (list, where) => (list || []).filter((e) => {
    if (exprHits(e.when, doomed)) { note(where, `'${e.id}' 통째로 — 발동 조건이 지울 값을 봄`); return false; }
    e.effects = dropEffects(e.effects, `${where} '${e.id}'`);
    if (e.choices) {
      e.choices = e.choices.filter((c) => {
        if (exprHits(c.when, doomed)) { note(where, `'${e.id}'의 선택지 '${c.label}'`); return false; }
        c.effects = dropEffects(c.effects, `${where} '${e.id}' 선택지`);
        return true;
      });
      if (!e.choices.length) delete e.choices;
    }
    if (deadChecks.has(e.check)) { delete e.check; note(where, `'${e.id}'의 판정 연결`); }
    const n = stripPlaceholders(e.notify, doomed);
    if (n.hit) { e.notify = n.text; note(where, `'${e.id}' 통지문의 자리표시자`); }
    return true;
  });
  if (rules.events) rules.events = purgeEventList(rules.events, '규칙 · 이벤트');
  if (rules.randomEvents?.table) rules.randomEvents.table = purgeEventList(rules.randomEvents.table, '규칙 · 랜덤 이벤트');

  // 5) 지시문 · 액션 · 판정
  schema.directives = (schema.directives || []).filter((d) => {
    if (exprHits(d.when, doomed)) { note('지시문', `'${d.id}' 통째로 — 조건이 지울 값을 봄`); return false; }
    const t = stripPlaceholders(d.text, doomed, true);
    if (t.hit) { d.text = t.text; note('지시문', `'${d.id}'의 자리표시자`); }
    return true;
  });
  schema.actions = (schema.actions || []).filter((a) => {
    if (exprHits(a.when, doomed)) { note('액션', `'${a.label ?? a.id}' 통째로 — 사용 조건이 지울 값을 봄`); return false; }
    a.effects = dropEffects(a.effects, `액션 '${a.label ?? a.id}'`);
    if (deadChecks.has(a.check)) { delete a.check; note('액션', `'${a.label ?? a.id}'의 판정 연결`); }
    return true;
  });
  schema.checks = (schema.checks || []).filter((c) => {
    if (deadChecks.has(c.id)) { note('판정', `'${c.label ?? c.id}' 통째로 — 굴림식이 지울 값을 씀`); return false; }
    c.grades = (c.grades || []).filter((g) => {
      if (exprHits(g.when, doomed)) { note('판정', `'${c.id}'의 등급 '${g.label}'`); return false; }
      g.effects = dropEffects(g.effects, `판정 '${c.id}' 등급`);
      return true;
    });
    return true;
  });

  // 6) 상태창 · 프롬프트 요약 (자리표시자 계열)
  const ui = schema.statusUI;
  if (ui) {
    for (const g of (ui.groups || [])) {
      const before = (g.items || []).length;
      g.items = (g.items || []).filter((it) => {
        if (doomed.has(it.var)) return false;
        if (exprHits(it.showWhen, doomed)) { delete it.showWhen; note('상태창', `'${it.var}' 항목의 표시 조건`); }
        if (it.bar && exprHits(String(it.bar.max), doomed)) { delete it.bar; note('상태창', `'${it.var}' 항목의 게이지 최대값`); }
        return true;
      });
      if (g.items.length !== before) note('상태창', `'${g.label || '이름 없는 그룹'}'에서 항목 ${before - g.items.length}개`);
      if (exprHits(g.showWhen, doomed)) { delete g.showWhen; note('상태창', `'${g.label}' 그룹의 표시 조건`); }
    }
    const emptied = (ui.groups || []).filter((g) => !(g.items || []).length);
    if (emptied.length) {
      ui.groups = (ui.groups || []).filter((g) => (g.items || []).length);
      note('상태창', `비게 된 그룹 ${emptied.length}개`);
    }
    const tp = stripPlaceholders(ui.template, doomed);
    if (tp.hit) { ui.template = tp.text; note('상태창', '커스텀 템플릿의 자리표시자'); }
    if (ui.templates) {
      ui.templates = ui.templates.filter((t) => {
        if (exprHits(t.when, doomed)) { note('상태창', `조건부 템플릿 '${t.id}' 통째로`); return false; }
        const r = stripPlaceholders(t.template, doomed);
        if (r.hit) { t.template = r.text; note('상태창', `조건부 템플릿 '${t.id}'의 자리표시자`); }
        return true;
      });
    }
  }
  if (schema.promptState?.template) {
    const r = stripPlaceholders(schema.promptState.template, doomed, true);
    if (r.hit) { schema.promptState.template = r.text; note('AI 설정', '상태 요약의 자리표시자 (값이 안 남는 줄은 줄째)'); }
  }

  const v = validateSchema(schema);
  return { schema, notes, doomed: [...doomed], errors: v.errors.map((e) => `${e.path}: ${e.msg}`) };
}

/** AI에게 "이 변수들만 써라"고 넘기는 계약표 — 탭 분할의 핵심 이득 */
function varContractTable(schema) {
  const rows = ['| id | 이름 | 타입 | 범위 / 선택지 | 시작값 |', '|---|---|---|---|---|'];
  for (const v of (schema.vars || [])) {
    let range = '';
    if (v.type === 'enum') range = (v.enum || []).join(' / ');
    else if (v.type === 'int' || v.type === 'float') {
      range = v.min != null && v.max != null ? `${v.min} ~ ${v.max}`
        : v.min != null ? `${v.min} 이상` : v.max != null ? `${v.max} 이하` : '제한 없음';
    } else if (v.type === 'list') range = `최대 ${v.maxItems ?? 20}개`;
    else if (v.type === 'text') range = v.maxLength ? `${v.maxLength}자 이내` : '';
    rows.push(`| \`${v.id}\` | ${v.label ?? v.id} | ${v.type} | ${range} | ${JSON.stringify(v.init)} |`);
  }
  const out = [rows.join('\n')];
  if ((schema.derived || []).length) {
    out.push('',
      '### 파생 변수 — **읽기 전용**입니다. 조건에는 쓸 수 있지만 `set` 대상이 될 수 없습니다.',
      '| id | 이름 | 계산식 |', '|---|---|---|',
      ...schema.derived.map((d) => `| \`${d.id}\` | ${d.label ?? d.id} | \`${d.expr}\` |`));
  }
  return out.join('\n');
}

/** 변수 묶음의 라벨 공통 접두사 — "노조미 호감"·"노조미 기분" → "노조미". 그룹 제목 자동 짓기용 */
function commonLabelPrefix(vars) {
  const labels = vars.map((v) => v.label || '');
  if (labels.some((l) => !l)) return '';
  let p = labels[0];
  for (const l of labels.slice(1)) {
    let i = 0;
    while (i < p.length && i < l.length && p[i] === l[i]) i++;
    p = p.slice(0, i);
    if (!p) return '';
  }
  // 낱말 중간에서 끊긴 접두사("노조미 호"…)는 마지막 공백까지 물러난다
  const cut = p.includes(' ') ? p.slice(0, p.lastIndexOf(' ')) : p;
  const t = cut.trim();
  return t.length >= 2 ? t : '';
}

const TAB_SLICES = {
  vars: { keys: ['vars', 'derived'], label: '변수' },
  // ⚠ 명령은 별도 배열이 아니라 **변수에 붙은 속성**(cmd)이다. 그래서 다른 탭처럼 통째로
  //   갈아끼우면 변수·파생이 통째로 날아간다. merge를 주면 cmd 배정만 기존 vars에 얹는다.
  commands: { keys: ['vars'], merge: 'cmd', label: '명령' },
  actions: { keys: ['actions'], label: '액션' },
  checks: { keys: ['checks'], label: '판정' },
  rules: { keys: ['rules', 'directives'], label: '규칙·이벤트' },
  // 새 시작 탭은 setup을 통째로 갈아끼우면 AI 최초설정(setup.ai)의 지침·가이드까지 날아간다.
  // sub를 주면 그 키 하나만 바꾸고 나머지 setup은 그대로 둔다.
  presets: { keys: ['setup'], sub: 'presets', label: '시작 프리셋' },
};

/**
 * 이 탭이 지금 담고 있는 항목 수.
 * AI에게 체크섬으로 준다 — 고친 것만 돌려주는 습성을 막는 가장 확실한 장치다.
 * (가져오기는 탭을 통째로 갈아끼우므로, 일부만 오면 나머지가 조용히 사라진다.)
 */
function tabItemCounts(schema, tabKey) {
  const out = [];
  const push = (path, arr) => { if (Array.isArray(arr)) out.push([path, arr.length]); };
  if (tabKey === 'vars') { push('vars', schema.vars); push('derived', schema.derived); }
  else if (tabKey === 'commands') push('commands', (schema.vars || []).filter((v) => v.cmd));
  else if (tabKey === 'actions') push('actions', schema.actions);
  else if (tabKey === 'checks') push('checks', schema.checks);
  else if (tabKey === 'presets') push('setup.presets', schema.setup?.presets);
  else if (tabKey === 'rules') {
    push('rules.onTurn', schema.rules?.onTurn);
    push('rules.events', schema.rules?.events);
    push('rules.randomEvents.table', schema.rules?.randomEvents?.table);
    push('directives', schema.directives);
  }
  return out;
}

/**
 * @param opts.findings 진단 결과 (있으면 "고쳐 주세요" 모드로 바뀐다)
 * @param opts.stats    진단 통계 (생존율 등 — 균형 판단 재료로 함께 넘긴다)
 */
function buildTabExportPrompt(schema, tabKey, opts = {}) {
  const slice = TAB_SLICES[tabKey];
  if (!slice) throw new Error(`알 수 없는 탭: ${tabKey}`);
  const current = {};
  if (slice.merge) {
    // 변수 전체가 아니라 "어느 변수에 어떤 이름을 붙였나"만 내보낸다.
    // vars를 통째로 실어 보내면 AI가 그걸 고쳐서 돌려주고, 가져오기에서 변수가 날아간다.
    current.commands = (schema.vars || []).filter((v) => v[slice.merge])
      .map((v) => ({ var: v.id, cmd: v[slice.merge] }));
  } else if (slice.sub) current[slice.sub] = schema[slice.keys[0]]?.[slice.sub] ?? [];
  else for (const k of slice.keys) if (schema[k] !== undefined) current[k] = schema[k];
  // 🔵는 "확인만 해보세요" 수준이라 AI에게 보내지 않는다.
  // 고칠 게 아닌 걸 고치라고 하면 멀쩡한 설계를 건드려 오히려 나빠지고, 목록이 영영 안 줄어든다.
  const fixes = (opts.findings || []).filter((f) => f.tab === tabKey && f.sev !== 'low');
  const fixMode = fixes.length > 0;
  const counts = tabItemCounts(schema, tabKey);

  const head = [
    fixMode
      ? `RisuAI용 SimCore 시뮬레이션 스키마의 **${slice.label}**에서 아래 문제들을 고쳐 주세요.`
      : `RisuAI용 SimCore 시뮬레이션 스키마의 **${slice.label}** 부분만 만들어 주세요.`,
    '',
  ];

  if (fixMode) {
    const s = opts.stats;
    head.push('## 진단에서 나온 문제 — 이걸 고쳐 주세요',
      s ? `이 스키마를 실제로 ${s.turns}턴 × ${s.runs}시드 굴려 본 결과입니다.`
        + (s.loseVar ? ` (아무것도 안 했을 때 생존 ${s.idleSurvive}/${s.runs}, 액션을 쓰면 ${s.playSurvive}/${s.runs})` : '')
        : '이 스키마를 실제로 굴려 본 결과입니다.',
      '');
    fixes.forEach((f, i) => {
      head.push(`${i + 1}. ${f.sev === 'high' ? '🔴' : f.sev === 'mid' ? '🟡' : '🔵'} **[${f.tag}]** ${f.text}`);
    });
    head.push('',
      '고치는 방법이 이 탭 밖에 있다고 판단되면(예: 자원을 늘리려면 액션이 필요하다면) '
      + 'JSON 대신 그 사실을 먼저 알려주세요.',
      '',
      '## 추가 요청',
      '(고쳤으면 하는 게 더 있으면 여기에 쓰세요 — 없으면 비워두면 됩니다)',
      '');
  } else {
    const WANT = {
      vars: '(여기를 채우세요 — 어떤 봇이고, 무엇을 수치로 굴리고 싶은지. 장르·분위기·플레이어가 쥐는 결정권을 적어주면 좋습니다)',
      presets: '(여기를 채우세요 — 예: "난이도 3단계로" / "출신 배경 4종으로" / "쉬움·보통·어려움인데 어려움은 이미 위기 상황에서 시작하게")',
      checks: '(여기를 채우세요 — 예: "d20 능력 판정 4종" / "은신·설득·해킹 판정, 대실패는 상황이 악화되게" / "2d6 판정, 10+ 성공 / 7~9 부분 성공")',
    };
    head.push('## 내가 원하는 것',
      WANT[tabKey] ?? '(여기를 채우세요 — 어떤 봇이고, 어떤 사건/행동이 있으면 좋겠는지)',
      '');
  }

  head.push('## 출력 형식',
    `- **JSON 하나만** 출력하세요. 최상위 키는 ${(slice.sub ? [slice.sub] : slice.keys).map((k) => `\`"${k}"\``).join(', ')} 입니다.`,
    '- 설명은 코드펜스 밖에 쓰지 마세요.',
    '',
    '## ⚠ 반드시 이 탭 전체를 다시 주세요',
    '가져오기는 이 탭을 **통째로 갈아끼웁니다.** 고친 항목만 보내면 **나머지가 전부 사라집니다.**',
    '손대지 않은 항목도 원문 그대로 옮겨 담아 한 세트로 돌려주세요.',
    ...(tabKey === 'presets'
      ? ['(갈아끼워지는 건 프리셋 목록뿐입니다. 같은 탭의 AI 최초설정은 그대로 남습니다.)'] : []),
    '',
    '지금 이 탭에 들어 있는 개수입니다 — 출력하기 전에 세어서 맞는지 확인하세요:',
    ...counts.map(([p, n]) => `- \`${p}\` **${n}개**`),
    '(의도적으로 추가하거나 지운 만큼은 달라져도 됩니다. 그 경우 무엇을 왜 바꿨는지 코드펜스 밖에 한 줄로 적어주세요.)',
    '');

  if (tabKey === 'vars') {
    // 변수 탭은 계약을 "받는" 쪽이 아니라 "만드는" 쪽이라 제약이 아니라 규격을 준다
    head.push('## 변수 하나는 이렇게 생겼습니다', ...VAR_FIELD_SPEC, '');
    const used = idsUsedElsewhere(schema);
    if (used.length) {
      head.push('## ⚠ 지금 다른 탭(규칙·액션·상태창)이 쓰고 있는 변수',
        '아래 id를 지우거나 이름을 바꾸면 **그쪽이 전부 깨집니다.** 남겨두거나, 정말 바꿔야 한다면 JSON 대신 그 사실을 먼저 알려주세요.',
        '`' + used.join('`, `') + '`', '');
    }
  } else {
    head.push('## 이미 정의된 변수 — **여기 있는 것만** 쓸 수 있습니다',
      '없는 이름을 쓰면 검증에서 거부됩니다. 새 변수가 필요하면 JSON 대신 그 사실을 먼저 알려주세요.',
      varContractTable(schema), '');
  }

  // 프리셋·명령은 수식을 아예 못 쓴다. 수식 규칙을 같이 주면 쓸 수 있다고 착각해서 `"coal * 2"`를 보낸다.
  // (명령은 정하는 게 '어느 변수에 어떤 이름'뿐이라 조건식이 낄 자리가 없다)
  if (tabKey !== 'presets' && tabKey !== 'commands') {
    head.push('## 수식 규칙',
      ...SCHEMA_EXPR_RULES.map((s) => '- ' + s),
      '');
  }

  const body = [];
  if (tabKey === 'vars') {
    body.push('## 변수는 이 9가지 역할 중 하나입니다',
      '`vars`는 세계의 현재 상태, `derived`는 그것들로 자동 계산되는 값입니다.',
      '');
    for (const [name, why, ex] of VAR_PATTERNS) {
      body.push(`### ${name}`, why, '```json', ex, '```', '');
    }
  } else if (tabKey === 'rules') {
    body.push('## 이벤트는 이 7가지 형태 중 하나입니다',
      '`rules.events`는 위에서부터 차례로 검사되고, 조건이 참이면 효과가 적용된 뒤 파생 변수가 다시 계산됩니다.',
      '');
    for (const [name, why, ex] of EVENT_PATTERNS) {
      body.push(`### ${name}`, why, '```json', ex, '```', '');
    }
    body.push('## 나머지 두 종류',
      '- `rules.onTurn` — 매 턴 무조건 실행되는 정산. 순서가 중요합니다(위에서부터, 매번 파생 재계산).',
      '- `rules.randomEvents` — `chancePerTurn`(0~1) 확률로 `table`에서 `weight` 비례 추첨. 각 항목에 `cooldown`을 꼭 주세요.',
      '- `directives` — 조건이 참일 때 **메인 모델에게 가는 서술 지시문**. 수치가 아니라 분위기를 바꿉니다.',
      '  예: `{ "id": "deadly_cold", "when": "indoor < -15", "text": "[상태] 실내조차 {indoor}°C다. 입김과 성에가 장면 전면에 나와야 한다." }`',
      '',
      '## 갈림길 (이벤트에 choices 달기 — 선택형 이벤트)',
      '이벤트에 `choices`를 달면 터지는 순간 유저에게 선택지를 내밀고, 고를 때까지 기다립니다.',
      '```json',
      '{ "id": "bandit_raid", "when": "...", "notify": "산적이 마을 어귀에 나타났다.", "timeout": 3,',
      '  "choices": [',
      '    { "label": "토벌대를 보낸다", "effects": [{ "set": "military", "expr": "military - 20" }] },',
      '    { "label": "금화로 무마한다", "when": "gold >= 100", "effects": [{ "set": "gold", "expr": "gold - 100" }] },',
      '    { "label": "외면한다" }',
      '  ] }',
      '```',
      '- 선택지는 2~4개. **맨 마지막은 조건(when) 없는 항목**으로 — 타임아웃이 지나면 마지막이 자동 결정됩니다.',
      '- `when`이 거짓인 선택지는 잠김(🔒)으로 표시만 되고 고를 수 없습니다.',
      '- 효과가 큰 결정에만 쓰세요 — 잦으면 흐름이 계속 끊깁니다.',
      '');
  } else if (tabKey === 'commands') {
    body.push('## 채팅 명령이 뭔가',
      '플레이어가 **채팅 입력창에 직접 치는 한 줄**입니다. `/계약 헤세 상단 양모 +12` 처럼요.',
      '상태는 평소에 보조 모델이 서사를 읽고 알아서 갱신합니다. 명령은 그게 **틀렸을 때 고치는 통로**입니다.',
      '',
      '변수 하나에 이름 하나를 붙이면 그 이름의 명령이 생깁니다. 안 붙인 변수에는 명령이 없습니다.',
      '**문법은 정하지 마세요** — 변수 타입이 이미 정합니다. 여러분이 정하는 건 이름뿐입니다.',
      '',
      '| 변수 타입 | 자동으로 생기는 문법 |',
      '|---|---|',
      '| `list` | `/이름 내용` 등록 · `/이름- 일부` 제거 |',
      '| `int` `float` | `/이름 +5` 증감 · `/이름 30` 지정 |',
      '| `enum` | `/이름 선택지` |',
      '| `text` | `/이름 내용` |',
      '| `bool` | `/이름 on` |',
      '',
      '## 어디에 붙이나 — 이게 이 탭의 전부입니다',
      '- **유저가 눈으로 보고 틀린 걸 알아챌 수 있는 것**에만 붙이세요. 상태창에 안 나오는 값은 틀려도 모릅니다.',
      '- **틀리면 복리로 어긋나는 것**이 1순위입니다 — 지속 수입·계약·봉급처럼 매일 더해지는 목록.',
      '- **호감도·평판**처럼 서사와 어긋나면 바로 거슬리는 수치도 좋습니다.',
      '- 붙이지 마세요: 시스템이 매 턴 계산하는 값(날짜·소비·수확), 파생 변수(계산 결과라 못 씁니다),',
      '  그리고 난이도 손잡이처럼 판 도중에 바뀌면 안 되는 값.',
      '- **5~10개면 충분합니다.** 전부에 붙이면 유저가 목록을 읽지 않습니다.',
      '',
      '## 이름 규칙',
      '- 공백 · `/` · `-` 를 쓸 수 없습니다. 겹쳐도 안 됩니다.',
      '- **짧고 그 봇의 말로.** 영지물이면 `계약`·`금`, 현대물이면 `잔고`·`스트레스`.',
      '  변수 id가 영문이어도 명령 이름은 한글로 다세요 — 유저가 치는 글자입니다.',
      '- 유저가 평소에 쓸 법한 문장의 첫 낱말은 피하세요. 명령으로 오인될 일은 없지만',
      '  (`/`로 시작해야 하니까) 헷갈리는 이름은 안내가 어려워집니다.',
      '',
      '## 이런 모양으로 주세요',
      '```json',
      '{ "commands": [',
      '  { "var": "contracts", "cmd": "계약" },',
      '  { "var": "gold", "cmd": "금" },',
      '  { "var": "bond_livia", "cmd": "호감" }',
      '] }',
      '```',
      '`var`는 **아래 변수 계약표에 있는 id 그대로** 써야 합니다. 없는 id를 쓰면 가져오기가 거부됩니다.',
      '여기 안 적힌 변수는 명령이 떨어집니다 — 남길 것도 전부 포함해서 한 세트로 주세요.',
      '');
  } else if (tabKey === 'presets') {
    body.push('## 프리셋이 뭔가',
      '플레이어가 **새 채팅을 시작할 때** 패널에서 한 번 누르는 버튼입니다. 누르면 `set`에 적은 변수들이',
      '그 값으로 한꺼번에 세팅됩니다. 적지 않은 변수는 원래 시작값 그대로 갑니다.',
      '(진행 중인 채팅에서 누르면 지금 수치가 덮어써지므로, 시작 시점 전용입니다.)',
      '',
      '## 프리셋 하나는 이렇게 생겼습니다',
      ...PRESET_FIELD_SPEC,
      '');
    body.push('## 난이도를 만드는 축은 이 5가지입니다',
      '**앞의 세 축(비축·완충·국면)이 난이도이고, 뒤의 둘은 난이도가 아닙니다.**',
      '어려움을 만들라는 요청을 받으면 세 축을 조금씩 함께 미세요 — 한 축만 크게 깎는 건 거의 항상 나쁜 답입니다.',
      '',
      '⚠ 아래 예시는 **다른 봇의 변수 이름**을 씁니다(혹한 생존·카페 경영). 형태만 보고,',
      '이름은 반드시 위 계약표에 있는 것으로 바꿔 쓰세요.',
      '');
    for (const [name, why, ex] of PRESET_PATTERNS) {
      body.push(`### ${name}`, why, '```json', ex, '```', '');
    }
  } else if (tabKey === 'checks') {
    body.push('## 판정이 뭔가',
      '주사위 판정입니다. **굴림은 시스템이 하고, AI는 결과를 받아 서사만 씁니다.**',
      '결과는 변수가 아니라 시스템 기록에 남아 보조 AI가 건드릴 수 없고, 리롤해도 같은 눈이 나옵니다.',
      '실행은 액션 버튼에 답니다 (액션의 `check` 필드에 판정 id).',
      '',
      '## 판정 하나는 이렇게 생겼습니다',
      '```json',
      '{ "checks": [ {',
      '  "id": "attack", "label": "공격 판정",',
      '  "roll": "rand(1, 20)",',
      '  "mod": "floor((str - 10) / 2)",',
      '  "vs": "dc",',
      '  "grades": [',
      '    { "when": "roll == 20", "label": "대성공", "inject": "기대 이상의 성과를 극적으로 그려라." },',
      '    { "when": "roll == 1", "label": "대실패", "inject": "단순 실패가 아니라 상황을 악화시켜라." },',
      '    { "when": "total >= vs", "label": "성공" },',
      '    { "label": "실패" }',
      '  ]',
      '} ] }',
      '```',
      '',
      '## 규칙',
      '- `roll`(굴림식)에서만 `rand()`를 쓸 수 있습니다. `mod`·`vs`·등급 `when`에서는 금지 — 굴림은 한 번입니다.',
      '- 등급은 **위에서부터 첫 매치**입니다. 맨 마지막에는 `when` 없는 기본 등급을 두세요.',
      '- 등급의 `when`과 `effects` 수식에서는 `roll`(굴린 눈)·`mod`(보정)·`total`(합계)·`vs`(목표치)를 그대로 쓸 수 있습니다.',
      '- 등급 `effects`는 이벤트 효과와 같은 형식입니다 (예: 대실패에 `{ "set": "hp", "expr": "hp - rand(1, 4)" }`).',
      '- 등급 `inject`는 그 등급일 때 AI에게 덧붙는 연출 지시입니다 (선택).',
      '');
  } else {
    body.push('## 액션은 이 6가지 형태 중 하나입니다',
      '액션은 플레이어가 화면 우상단 버튼으로 누릅니다. 누르면 무장(ON)되고 다음 전송에 효과가 적용됩니다.',
      '`label`은 **반드시 이모지 하나로 시작**하세요 — 버튼에는 그 이모지만 표시됩니다.',
      '`inject`는 그 턴에 메인 모델에게 전달되는 문장입니다.',
      '');
    for (const [name, why, ex] of ACTION_PATTERNS) {
      body.push(`### ${name}`, why, '```json', ex, '```', '');
    }
    body.push('## 필드',
      '- `mode`: `"oneshot"`(누른 턴에 1회) 또는 `"hold"`(끌 때까지 매 턴)',
      '- `when`: 사용 조건. 거짓이면 버튼이 잠깁니다(생략하면 항상 가능)',
      '- `cooldown`: 재사용까지 기다릴 턴 수',
      '');
  }

  const BALANCE = { vars: VAR_BALANCE_RULES, presets: PRESET_BALANCE_RULES };
  const tail = [
    '## 균형 잡기',
    ...(BALANCE[tabKey] ?? SCHEMA_BALANCE_RULES),
    '',
    `## 지금 이 봇의 ${slice.label} (여기서 출발하세요)`,
    '```json',
    JSON.stringify(current, null, 2),
    '```',
  ];

  if (tabKey === 'presets' && schema.setup?.ai?.enabled) {
    // 최초설정이 켜져 있으면 보조 AI가 첫 턴에 값을 다시 정한다. 겹치는 변수는 프리셋이 진 것처럼 보인다.
    const ov = (schema.setup.ai.vars || []);
    tail.push('',
      '## ⚠ 이 봇은 AI 최초설정이 켜져 있습니다',
      `첫 대화에서 AI가 ${ov.length ? '`' + ov.join('`, `') + '`' : '일부 변수'}를 직접 정합니다. `
      + '프리셋으로 그 변수를 세팅해도 AI가 덮어씁니다.',
      '난이도는 **AI가 건드리지 않는 변수**로 만드세요. 위 목록에 없는 것들입니다.');
  }

  if (tabKey === 'vars') {
    // 변수는 모든 탭의 전제다. 순서와 "대화를 잇지 말 것"을 여기서 못박지 않으면
    // 다음 탭에서 AI가 기억에 의존해 표에 없는 변수를 슬쩍 만들어 낸다.
    tail.push('',
      '## 이 다음에 할 일 (중요)',
      '1. 위 JSON을 SimCore 편집기의 **변수 탭**에 가져오기 합니다.',
      '2. 그 다음 **액션 탭**과 **규칙·이벤트 탭**에서 각각 [내보내기]를 누르세요.',
      '   → 방금 확정한 변수표가 그 프롬프트에 자동으로 실려 나갑니다.',
      '3. **이 대화를 이어서 쓰지 말고, 새 대화에 그 프롬프트를 붙여넣으세요.**',
      '   대화를 이어가면 AI가 기억에 의존해 표에 없는 변수를 슬쩍 만들어 냅니다.');
  }
  return [...head, ...body, ...tail].join('\n');
}

/**
 * AI가 준 조각에서 이 탭이 받는 키만 골라낸다.
 * 통째로 갈아끼우는 작업이라 호출부에서 반드시 되돌리기를 준비해야 한다.
 * @param schema sub 슬라이스(프리셋)에서 나머지 형제 키를 보존하는 데만 쓴다
 */
function pickTabFragment(tabKey, frag, schema) {
  const slice = TAB_SLICES[tabKey];
  if (!slice) throw new Error(`알 수 없는 탭: ${tabKey}`);
  // AI가 배열만 던져주는 일이 잦다 — 첫 키에 담아 준다
  if (Array.isArray(frag)) frag = { [slice.merge ? 'commands' : (slice.sub ?? slice.keys[0])]: frag };
  if (!frag || typeof frag !== 'object') throw new Error('JSON 객체가 아닙니다');

  // merge 슬라이스: 배정만 얹는다. vars 배열 자체는 절대 갈아끼우지 않는다 —
  // 여기서 통째로 바꾸면 명령 하나 붙이려다 변수·파생이 통째로 사라진다.
  if (slice.merge) {
    const arr = Array.isArray(frag.commands) ? frag.commands : null;
    if (!arr) throw new Error('"commands" 배열이 없습니다');
    const byId = {};
    for (const c of arr) {
      const id = c && (c.var ?? c.id);
      const name = c && c.cmd;
      if (!id || !name) continue;
      if (!(schema?.vars || []).some((v) => v.id === id)) throw new Error(`'${id}'은 없는 변수입니다`);
      byId[id] = String(name).trim();
    }
    // 목록에서 빠진 변수는 명령을 뗀다 — 그래야 "지워 달라"가 통한다.
    return {
      vars: (schema?.vars ?? []).map((v) => {
        const next = { ...v };
        if (byId[v.id]) next[slice.merge] = byId[v.id];
        else delete next[slice.merge];
        return next;
      }),
    };
  }

  // sub 슬라이스는 한 키만 갈아끼우고 형제(setup.ai 등)는 원문 그대로 둔다.
  // { presets: [...] }와 { setup: { presets: [...] } } 둘 다 온다.
  if (slice.sub) {
    const host = slice.keys[0];
    const arr = Array.isArray(frag[slice.sub]) ? frag[slice.sub]
      : Array.isArray(frag[host]?.[slice.sub]) ? frag[host][slice.sub] : null;
    if (!arr) throw new Error(`"${slice.sub}" 배열이 없습니다`);
    return { [host]: { ...(schema?.[host] ?? {}), [slice.sub]: arr } };
  }

  // 스키마를 통째로 준 경우에도 이 탭 몫만 뽑아 쓴다
  const picked = {};
  for (const k of slice.keys) if (frag[k] !== undefined) picked[k] = frag[k];
  if (!Object.keys(picked).length) {
    throw new Error(`${slice.keys.map((k) => `"${k}"`).join(' 또는 ')} 키가 없습니다`);
  }
  return picked;
}

// 행 이동/삭제 버튼 묶음. onDelete를 주면 삭제를 그쪽이 가로챈다 (변수 탭의 참조 정리)
function grip(list, i, rerender, onDelete) {
  const move = (d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    rerender();
  };
  return h('span', { class: 'sce-grip' },
    h('button', { class: 'sce-btn sce-mini', onclick: () => move(-1), title: '위로' }, '▲'),
    h('button', { class: 'sce-btn sce-mini', onclick: () => move(1), title: '아래로' }, '▼'),
    h('button', { class: 'sce-btn sce-mini sce-danger', title: '삭제',
      onclick: () => { if (onDelete && onDelete() === false) return; list.splice(i, 1); rerender(); } }, '✕'),
  );
}

function addBtn(label, onclick) {
  return h('button', { class: 'sce-btn sce-add', onclick }, '+ ' + label);
}

// 라벨+입력을 한 덩어리로 (줄바꿈 시 함께 이동)
function pair(label, el, title = '') {
  return h('span', { class: 'sce-pair', title }, h('label', {}, label), el);
}

// 변수 타입 변경 시 init을 새 타입으로 변환 + 이전 타입의 잔재 필드 정리
// (정수→텍스트 전환 후 "init은 문자열이어야 함" 검증 에러가 나던 문제의 근본 수정)
function changeVarType(v, newType) {
  v.type = newType;
  if (newType === 'int' || newType === 'float') {
    const n = Number(v.init);
    v.init = isFinite(n) ? (newType === 'int' ? Math.round(n) : n) : 0;
    delete v.enum; delete v.maxLength; delete v.maxItems; delete v.itemMaxLength;
  } else if (newType === 'text') {
    v.init = typeof v.init === 'string' ? v.init : (v.init != null && typeof v.init !== 'object' ? String(v.init) : '');
    delete v.min; delete v.max; delete v.format; delete v.enum; delete v.maxItems; delete v.itemMaxLength;
  } else if (newType === 'bool') {
    v.init = v.init === true;
    delete v.min; delete v.max; delete v.format; delete v.enum; delete v.maxLength; delete v.maxItems; delete v.itemMaxLength;
  } else if (newType === 'enum') {
    v.enum = Array.isArray(v.enum) && v.enum.length ? v.enum : [];
    v.init = v.enum.includes(v.init) ? v.init : v.enum[0];
    delete v.min; delete v.max; delete v.format; delete v.maxLength; delete v.maxItems; delete v.itemMaxLength;
  } else if (newType === 'list') {
    v.init = Array.isArray(v.init) ? v.init : [];
    delete v.min; delete v.max; delete v.format; delete v.enum; delete v.maxLength;
  }
}

// ── 에셋 팩: 실물 이름에서 슬롯 구조 감지 (🎨 층) ────────────
// "Hiromi_angry_apron" 무리에서 구분자·칸 수·칸별 어휘를 읽어 팩 초안을 만든다.
// 감지는 초안일 뿐 — format(출력 방언)은 봇의 표시 정규식에 맞게 사람이 확정한다.
function detectSlotsFromNames(names) {
  const clean = [...new Set((names || []).map((n) => String(n).trim()).filter(Boolean))];
  if (clean.length < 2) return null;
  let sep = null, sepRows = [];
  for (const s of ['_', '-', '.', ' ']) {
    const rows = clean.filter((n) => n.includes(s));
    if (rows.length > sepRows.length) { sep = s; sepRows = rows; }
  }
  // 구분자가 소수 이름에만 있으면 명명 규약이 아니라 우연 — 감지 포기 (틀린 초안이 더 해롭다)
  if (!sep || sepRows.length < Math.max(2, clean.length * 0.3)) return null;
  const rows = sepRows.map((n) => n.split(sep).filter((p) => p !== ''));
  const minCols = Math.min(...rows.map((r) => r.length));
  const maxCols = Math.max(...rows.map((r) => r.length));
  const cols = [];
  for (let c = 0; c < maxCols; c++) {
    const values = [...new Set(rows.map((r) => r[c]).filter((v) => v != null))];
    cols.push({ values, optional: c >= minCols });
  }
  return { sep, cols, covered: rows.length, total: clean.length };
}

// 감지 결과 → 팩 초안. 칸 이름은 관례 추정(0=인물, 1=감정)이고 사람이 고친다.
function packDraftFromDetect(det, packId) {
  const ids = ['who', 'emo'], labels = ['인물', '감정'];
  return {
    id: packId, source: '자동 감지', sep: det.sep, format: '<img="{name}">',
    slots: det.cols.map((c, i) => ({
      id: ids[i] ?? 'slot' + (i + 1), label: labels[i] ?? '칸 ' + (i + 1),
      values: c.values, ...(c.optional ? { optional: true } : {}),
    })),
  };
}

// 팩의 필수 칸 정조합 실존 커버리지 — "없는 조합"을 배포 전에 보는 진단.
// nameSet 없으면(대조 불가 환경) 조합 수만 센다. 조합이 너무 많으면 열거를 포기한다(capped).
// 빠진 조합마다 런타임과 같은 폴백 사다리(resolveInPack)를 미리 돌려 "구제되나"를 갈라 센다 —
// 스파스 매트릭스(의상별 감정 세트가 다름)는 정상 설계라, 폴백이 받아주는 조합까지 ⚠로
// 몰아 세면 정상 봇이 영원히 경고를 보게 된다 (도구가 정상 설계를 벌주지 않기, v0.52 원칙).
// missing 예시는 구제 안 되는 실질 구멍만 담는다 — 그게 폴백을 손볼 단서다.
function packCoverage(pack, nameSet) {
  const req = (pack.slots || []).filter((s) => !s.optional);
  let combos = 1;
  for (const s of req) combos *= Math.max(1, (s.values || []).length);
  // 대조 제외 팩 (verify:false) — 모듈 에셋을 못 읽는 환경. 조합 수만 알려준다
  if (pack.verify === false) return { combos, exist: null, rescued: 0, missing: [], skipped: true };
  if (!nameSet || !req.length) return { combos, exist: null, rescued: 0, missing: [] };
  if (combos > 4000) return { combos, exist: null, rescued: 0, missing: [], capped: true };
  let acc = [{}];
  for (const s of req) {
    const next = [];
    for (const c of acc) for (const v of s.values || []) next.push({ ...c, [s.id]: v });
    if (next.length) acc = next;
  }
  let exist = 0, rescued = 0; const missing = [];
  for (const c of acc) {
    const name = composeName(pack, c);
    if (name && nameSet.has(name)) exist++;
    else if (name) {
      if (resolveInPack(pack, c, nameSet)) rescued++;
      else if (missing.length < 6) missing.push(name);
    }
  }
  return { combos: acc.length, exist, rescued, missing };
}

// ── 에셋 팩: 매 턴 비용 추정 — "이 기능이 뭘 아끼나"를 숫자로 보이게 ──
// 토크나이저 없이 대략(±30%): CJK ≈ 1.5자/토큰, 그 외 ≈ 3.5자/토큰.
// 기준선(예전 방식) = {{assetlist}} 통짜 덤프 — 실물 이름 전부를 매 턴 실었던 그것.
// 손으로 쓰던 지침 문단은 알 수 없어 안 세므로 절감률은 보수적이다 (실제로는 더 이득).
function estTokens(s) {
  let cjk = 0, other = 0;
  for (const ch of String(s || '')) {
    if (/[ᄀ-ᇿ㄰-㆏가-힯一-鿿぀-ヿ]/.test(ch)) cjk++;
    else other++;
  }
  return Math.round(cjk / 1.5 + other / 3.5);
}

// 게이트 팩은 lookup 없이는 닫힌 것으로 계산된다 — "항상 나가는 비용"이 기본 표시고,
// 게이트가 열리는 턴의 추가분은 캡션으로만 말한다 (상태를 모르는 편집기에서 정직한 최소치).
function estAssetCost(schema, assetNames) {
  const by = schema?.assets?.by ?? 'aux';
  const aux = by === 'main' ? 0 : estTokens(auxImageSpec(schema, null).instruction);
  const main = by === 'main' ? estTokens(mainInjectionText(schema, null)) : 0;
  const baseline = assetNames && assetNames.length
    ? estTokens([...new Set(assetNames.map(String))].join('\n')) : null;
  return { main, aux, baseline };
}

// ── 에셋 팩: 모듈 지침 원문 → 팩 JSON 변환 프롬프트 (임포터) ──
// 자동 감지가 못 읽는 환경이나 모듈 배포문(수동 키워드 목록 + 지침 문단)을 팩으로 옮긴다.
function buildPackImportPrompt(pasteText) {
  return [
    '너는 SimCore 에셋 팩 변환기다. 아래는 어떤 봇/모듈의 이미지 삽입 지침 원문이다.',
    '이 지침이 요구하는 이미지 태그 규약을 SimCore 팩 선언(JSON)으로 변환하라.',
    '',
    '팩 스키마:',
    '{"packs": [{ "id": "영문id", "source": "출처 표기", "sep": "구분자(기본 _)",',
    '  "format": "출력 태그 원형 — {name} 자리에 조합된 이름 (예: <img=\\"{name}\\">)",',
    '  "chars": ["(선택) 태그가 캐릭터 고정인 단일 캐릭 모듈이면 담당 인물"],',
    '  "when": "(선택) 성인 등 조건부 어휘 게이트 — 비워 두면 항상 열림",',
    '  "slots": [{ "id": "who", "label": "인물", "values": ["..."] },',
    '            { "id": "emo", "label": "감정", "values": ["..."], "fallback": "중립값" },',
    '            { "id": "wear", "label": "의상", "values": ["..."], "optional": true }] }]}',
    '',
    '규칙:',
    '- 지침에 실제로 나열된 어휘만 values에 담아라. 지어내지 마라.',
    '- 인물명이 이름 조합의 일부면 who 칸으로, 태그 자체가 캐릭터 고정이면 chars로.',
    '- 성인/조건부 어휘는 별도 팩으로 쪼개라. when은 비워 둬라 (변수 연결은 사람이 한다).',
    '- 팩 수는 최소로. 팩을 나누는 기준은 (출력 형식·구분자·잠글 조건)이 다를 때뿐이다 —',
    '  같은 조건으로 열릴 어휘는 카테고리가 여럿이어도 한 팩의 한 칸에 합쳐라.',
    '- 출력 태그의 실제 문법(format)은 지침 원문의 예시에서 그대로 베껴라.',
    '- 출력은 JSON 하나만. 다른 텍스트 금지.',
    '',
    '[지침 원문]', pasteText,
  ].join('\n');
}

// ── 색 빌더: 팔레트 딸깍 ↔ 수식 문자열 변환 ─────────────────
const PALETTE = [
  '#e74c3c', '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#1abc9c',
  '#5b8def', '#8b5bef', '#e84393', '#95a5a6',
];
const HEX_RE = '#[0-9a-fA-F]{3,8}';

function parseColorSpec(color, varId) {
  if (!color) return { mode: 'auto' };
  const s = String(color);
  let m = s.match(new RegExp("^\\s*'(" + HEX_RE + ")'\\s*$"));
  if (m) return { mode: 'solid', solid: m[1] };
  const vid = varId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  m = s.match(new RegExp('^\\s*' + vid + "\\s*<\\s*\\(?([^?]+?)\\)?\\s*\\*\\s*([\\d.]+)\\s*\\?\\s*'(" + HEX_RE + ")'\\s*:\\s*'(" + HEX_RE + ")'\\s*$"));
  if (m) return { mode: 'threshold', kind: 'pct', value: Math.round(parseFloat(m[2]) * 100),
    danger: m[3], ok: m[4] };
  m = s.match(new RegExp('^\\s*' + vid + "\\s*<\\s*([\\d.]+)\\s*\\?\\s*'(" + HEX_RE + ")'\\s*:\\s*'(" + HEX_RE + ")'\\s*$"));
  if (m) return { mode: 'threshold', kind: 'abs', value: parseFloat(m[1]), danger: m[2], ok: m[3] };
  return { mode: 'expr', raw: s };
}

function buildColorSpec(spec, varId, maxExpr) {
  if (spec.mode === 'auto') return undefined;
  if (spec.mode === 'solid') return "'" + spec.solid + "'";
  if (spec.mode === 'threshold') {
    if (spec.kind === 'pct') return varId + ' < (' + (maxExpr || 100) + ') * ' + (spec.value / 100) + " ? '" + spec.danger + "' : '" + spec.ok + "'";
    return varId + ' < ' + spec.value + " ? '" + spec.danger + "' : '" + spec.ok + "'";
  }
  return spec.raw;
}

// 스와치 줄 + 커스텀 색 선택기
function swatchPicker(current, onPick) {
  const wrap = h('span', { class: 'sce-swatches' });
  for (const c of PALETTE) {
    wrap.appendChild(h('button', {
      class: 'sce-swatch' + ((current || '').toLowerCase() === c ? ' on' : ''),
      style: 'background:' + c + ' !important',
      title: c,
      onclick: () => onPick(c),
    }));
  }
  const custom = h('input', { type: 'color', title: '직접 고르기' });
  if (current && /^#[0-9a-fA-F]{6}$/.test(current)) custom.value = current;
  custom.onchange = () => onPick(custom.value);
  wrap.appendChild(custom);
  return wrap;
}

// 게이지 색 빌더 전체 UI
// 수식(고급) 모드는 색 문자열만으로는 구분이 안 되므로 (단색/위험 전환 문자열도 유효한 수식)
// 사용자가 고른 모드를 아이템 객체 기준으로 기억한다 (스키마에는 남지 않음)
const colorModeOverride = new WeakMap();
function colorBuilder(it, varId, rerender) {
  let spec = parseColorSpec(it.color, varId);
  if (colorModeOverride.get(it) === 'expr' && spec.mode !== 'expr') {
    spec = { mode: 'expr', raw: it.color ?? '' };
  }
  const write = (s) => { it.color = buildColorSpec(s, varId, it.bar?.max); rerender(); };
  const box = h('div', { class: 'sce-colorbox' });
  box.appendChild(h('div', { class: 'sce-row' },
    pair('색', bindSelect(spec.mode, [
      ['auto', '기본색'], ['solid', '단색'], ['threshold', '위험 전환'], ['expr', '수식 (고급)'],
    ], (m) => {
      if (m === 'expr') { colorModeOverride.set(it, 'expr'); rerender(); return; }
      colorModeOverride.delete(it);
      if (m === 'auto') write({ mode: 'auto' });
      else if (m === 'solid') write({ mode: 'solid', solid: spec.solid ?? spec.ok ?? '#5b8def' });
      else write({ mode: 'threshold', kind: spec.kind ?? 'pct',
        value: spec.value ?? 30, danger: spec.danger ?? '#c0392b', ok: spec.ok ?? spec.solid ?? '#27ae60' });
    })),
  ));
  if (spec.mode === 'solid') {
    box.appendChild(h('div', { class: 'sce-row' },
      swatchPicker(spec.solid, (c) => write({ ...spec, solid: c }))));
  } else if (spec.mode === 'threshold') {
    box.appendChild(h('div', { class: 'sce-row' },
      pair('기준', bindInput(spec.value, (x) => write({ ...spec, value: Number(x) || 0 }), { cls: 'sce-w-s' })),
      bindSelect(spec.kind, [['pct', '% (최대 대비)'], ['abs', '값 이하']], (k) => write({ ...spec, kind: k })),
    ));
    box.appendChild(h('div', { class: 'sce-row' },
      pair('위험색', swatchPicker(spec.danger, (c) => write({ ...spec, danger: c })))));
    box.appendChild(h('div', { class: 'sce-row' },
      pair('평상색', swatchPicker(spec.ok, (c) => write({ ...spec, ok: c })))));
  } else if (spec.mode === 'expr') {
    box.appendChild(h('div', { class: 'sce-row' },
      bindInput(it.color, (x) => { it.color = x || undefined; rerender(); },
        { cls: 'sce-w-l', ph: "loyalty < 30 ? '#c0392b' : '#27ae60'" })));
  }
  return box;
}

// 효과 행 목록 — 수식 효과 {set, expr} + 아이템 효과 {list, add, remove}
function effectRows(schema, effects, rerender) {
  const wrap = h('div', { class: 'sce-sub' });
  const nonListVars = schema.vars.filter((v) => v.type !== 'list');
  const listVars = schema.vars.filter((v) => v.type === 'list');
  const varOpts = nonListVars.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`]);
  const listOpts = listVars.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`]);
  effects.forEach((ef, i) => {
    if (ef.list !== undefined) {
      wrap.appendChild(h('div', { class: 'sce-row' },
        bindSelect(ef.list, listOpts.length ? listOpts : [['', '(목록 변수 없음)']], (v) => { ef.list = v; rerender(); }),
        pair('추가', bindInput((ef.add || []).join(', '), (x) => {
          ef.add = x.split(',').map((s) => s.trim()).filter(Boolean); rerender();
        }, { cls: 'sce-w-m', ph: '회복약' })),
        pair('제거', bindInput((ef.remove || []).join(', '), (x) => {
          ef.remove = x.split(',').map((s) => s.trim()).filter(Boolean); rerender();
        }, { cls: 'sce-w-m', ph: '녹슨 검' })),
        grip(effects, i, rerender),
      ));
      return;
    }
    wrap.appendChild(h('div', { class: 'sce-row' },
      bindSelect(ef.set, varOpts.length ? varOpts : [['', '(변수 없음)']], (v) => { ef.set = v; rerender(); }),
      h('span', {}, '='),
      bindInput(ef.expr, (v) => { ef.expr = v; rerender(); }, { cls: 'sce-w-l', ph: '수식 예: gold + 100, loyalty - 5' }),
      grip(effects, i, rerender),
    ));
  });
  const btnRow = h('div', { class: 'sce-row' });
  btnRow.appendChild(h('button', { class: 'sce-btn sce-add', style: 'flex:1', onclick: () => {
    effects.push({ set: nonListVars[0]?.id ?? '', expr: '' });
    rerender();
  } }, '+ 수치 효과'));
  if (listVars.length) {
    btnRow.appendChild(h('button', { class: 'sce-btn sce-add', style: 'flex:1', onclick: () => {
      effects.push({ list: listVars[0].id, add: [], remove: [] });
      rerender();
    } }, '+ 아이템 효과'));
  }
  wrap.appendChild(btnRow);
  return wrap;
}

function createSchemaEditor(container, initialSchema, opts = {}) {
  const { onChange, ai, floor, onRequestFloor } = opts; // ai = { generate(prompt)→Promise<text|null|{blocked}>, getBotContext()→Promise } — 어댑터 주입
  // onRequestFloor(f): 편집기 안에서 층 이동이 필요할 때 호스트에게 부탁 — 사이드바 하이라이트까지 같이 옮기라고
  // floor: 'top'|'json'|'assets'|'deep' — 호스트가 층을 사이드 내비로 직접 고르는 모드 (층 하나만 그림).
  // 안 주면 스택형(1층 + 2·3층 접기) — 플레이그라운드처럼 층 내비가 없는 호스트용 폴백.
  let floorView = floor ?? null;
  let schema = JSON.parse(JSON.stringify(initialSchema));
  let activeTab = 'vars';
  let destroyed = false;
  let reportWarnOpen = false; // 검증 리포트의 경고 접기 상태 — rerender에도 유지
  // 변수 정리 상태 — rerender가 DOM을 새로 만들므로 탭 함수 바깥에 둔다
  let purge = null, purgeDone = null, purgeBackup = null;
  // 🎨 에셋 층 상태 — 실물 이름 캐시(호스트 additionalAssets+켜진 모듈), 안내문, 임포터 입력/진행.
  // 임포터 안내는 따로(assetImportNote) — 실패 사유가 버튼 바로 아래 보여야 유저가 알아챈다 (실측).
  let assetNames = null, assetNote = null, assetImportText = '', assetImportNote = null, assetBusy = false, assetsOpen = false;

  // 스키마 하위 구조 보정 (편집기가 만지는 경로는 항상 존재하게)
  function normalize() {
    schema.simcore = schema.simcore || '0.1';
    schema.meta = schema.meta || {};
    schema.vars = schema.vars || [];
    schema.derived = schema.derived || [];
    schema.directives = schema.directives || [];
    schema.rules = schema.rules || {};
    schema.rules.onTurn = schema.rules.onTurn || [];
    schema.rules.events = schema.rules.events || [];
    schema.rules.randomEvents = schema.rules.randomEvents || { chancePerTurn: 0, table: [] };
    schema.rules.randomEvents.table = schema.rules.randomEvents.table || [];
    schema.updater = schema.updater || { model: 'aux', allow: [] };
    schema.updater.allow = schema.updater.allow || [];
    schema.promptState = schema.promptState || { position: 'history_end', template: '', includeEvents: true };
    schema.statusUI = schema.statusUI || { mode: 'auto', groups: [] };
    schema.statusUI.groups = schema.statusUI.groups || [];
    schema.actions = schema.actions || [];
    schema.checks = schema.checks || [];
    schema.setup = schema.setup || {};
    schema.setup.presets = schema.setup.presets || [];
    schema.setup.ai = schema.setup.ai || { enabled: false, vars: [] };
    // 팩을 다 지우면 assets 자체를 걷는다 — "없음 = 꺼짐"을 JSON에도 유지
    if (schema.assets && !(schema.assets.packs || []).length) delete schema.assets;
  }
  normalize();

  const style = h('style', {}, CSS);
  const root = h('div', { class: 'sce' });
  container.appendChild(style);
  container.appendChild(root);

  // 3층(심층 편집)의 탭들 — 진단은 1층(AI에게 맡기기 곁)으로, JSON은 2층(독립 작업대)으로 올라갔다
  const TABS = [
    ['vars', '변수'], ['commands', '명령'], ['status', '상태창'], ['party', '편성표'], ['rules', '규칙·이벤트'],
    ['actions', '액션'], ['checks', '판정'], ['time', '시간'], ['setup', '새 시작'], ['ai', 'AI 설정'],
  ];

  function emit() {
    if (onChange) onChange(JSON.parse(JSON.stringify(schema)));
  }

  function rerender() {
    if (destroyed) return;
    normalize();
    emit();
    render();
  }

  // ── 탭: 변수 ──────────────────────────────────────────────
  function tabVars() {
    const wrap = h('div');
    wrap.appendChild(tabAiTools('vars'));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '상태창에 들어갈 항목들. 행 추가로 자유롭게 — 타입에 따라 AI 갱신 방식이 달라진다 (숫자=증감, 텍스트=재작성, 선택지=교체).'));

    // 정리 계획 — 쓰이는 변수를 지우려 할 때만 뜬다. 확인해야 실제로 지운다 (패치와 같은 규율)
    if (purge) {
      const { id, label, plan } = purge;
      const box = h('div', { class: 'sce-block' });
      box.appendChild(h('div', { class: 'sce-warn' },
        `⚠ '${label}'(${id})는 다른 곳에서 쓰이고 있습니다 — 같이 정리할 자리 ${plan.notes.length}군데:`));
      const list = h('div');
      for (const n of plan.notes) list.appendChild(h('div', { class: 'sce-hint' }, `· ${n}`));
      box.appendChild(plan.notes.length > 6
        ? h('details', { class: 'sce-fold' }, h('summary', {}, `${plan.notes.length}군데 — 눌러서 펼치기`), list)
        : list);
      if (plan.doomed.length > 1) {
        box.appendChild(h('div', { class: 'sce-hint' },
          `함께 사라지는 항목: ${plan.doomed.join(', ')} (지울 값을 계산에 쓰는 파생은 남길 수 없습니다)`));
      }
      box.appendChild(h('div', { class: 'sce-hint' },
        '자리표시자만 걷어낸 문장은 앞뒤 말이 어색하게 남을 수 있습니다 (예: "호감 {값} · 기분 {값}" → "호감 · 기분 {값}"). '
        + '적용 뒤 그 탭에서 한 번 훑어보세요.'));
      if (plan.errors.length) {
        box.append(h('div', { class: 'sce-err' }, '정리해도 검증을 통과하지 못합니다 — 지울 수 없습니다:'),
          ...plan.errors.slice(0, 8).map((e) => h('div', { class: 'sce-err' }, `- ${e}`)),
          h('div', { class: 'sce-hint' }, '자동으로 못 걷어내는 자리가 남아 있습니다. 그 탭에서 먼저 손보고 다시 시도하세요.'));
      }
      box.appendChild(h('div', { class: 'sce-row' },
        plan.errors.length ? null : h('button', { class: 'sce-btn sce-danger', onclick: () => {
          purgeBackup = JSON.parse(JSON.stringify(schema));
          schema = plan.schema;
          purge = null; purgeDone = `'${label}' 및 참조 ${plan.notes.length}군데를 정리했습니다.`;
          rerender();
        } }, '🧹 정리하고 지우기'),
        h('button', { class: 'sce-btn', onclick: () => { purge = null; rerender(); } }, '취소'),
      ));
      wrap.appendChild(box);
    }
    if (purgeDone) {
      wrap.appendChild(h('div', { class: 'sce-block' },
        h('div', { class: 'sce-ok' }, `✅ ${purgeDone}`),
        h('div', { class: 'sce-row' },
          purgeBackup ? h('button', { class: 'sce-btn', onclick: () => {
            schema = purgeBackup; purgeBackup = null; purgeDone = null; rerender();
          } }, '↩ 되돌리기') : null,
          h('button', { class: 'sce-btn', onclick: () => { purgeDone = null; rerender(); } }, '확인'))));
    }
    schema.vars.forEach((v, i) => {
      const rows = [
        h('div', { class: 'sce-row' },
          bindInput(v.id, (x) => { v.id = x.trim(); rerender(); }, { cls: 'sce-w-m', ph: '영문id (예: gold)' }),
          bindInput(v.label, (x) => { v.label = x; rerender(); }, { cls: 'sce-w-m', ph: '표시 이름 (예: 자금)' }),
          bindSelect(v.type, VAR_TYPES, (x) => { changeVarType(v, x); rerender(); }),
          // 쓰이는 변수를 그냥 지우면 규칙·상태창·프롬프트가 조용히 깨진다 → 정리 계획을 먼저 보인다
          grip(schema.vars, i, rerender, () => {
            if (!v.id) return true;
            const plan = planVarPurge(schema, [v.id]);
            if (!plan.notes.length && !plan.errors.length) return true; // 아무 데도 안 쓰임 — 그냥 지운다
            purge = { id: v.id, label: v.label ?? v.id, plan };
            rerender();
            return false;
          }),
        ),
      ];
      const detail = h('div', { class: 'sce-row' });
      if (v.type === 'int' || v.type === 'float') {
        detail.append(
          pair('시작값', bindInput(v.init, (x) => { v.init = num(x); rerender(); }, { cls: 'sce-w-s' })),
          pair('최소', bindInput(v.min, (x) => { v.min = numOrNull(x); rerender(); }, { cls: 'sce-w-s', ph: '없음' })),
          pair('최대', bindInput(v.max, (x) => { v.max = numOrNull(x); rerender(); }, { cls: 'sce-w-s', ph: '없음' })),
          pair('표시 형식', bindInput(v.format, (x) => { v.format = x || undefined; rerender(); }, { cls: 'sce-w-m', ph: '{v}G → 1,000G' }),
            '상태창 표시용. {v} 자리에 값이 들어감 (예: {v}G, {v}명, {v}개월차). 비우면 숫자만'),
        );
      } else if (v.type === 'text') {
        detail.append(
          pair('시작값', bindInput(v.init, (x) => { v.init = x; rerender(); }, { cls: 'sce-w-l' })),
          pair('최대 글자', bindInput(v.maxLength, (x) => { v.maxLength = numOrNull(x) ?? undefined; rerender(); }, { cls: 'sce-w-s', ph: '200' })),
        );
      } else if (v.type === 'bool') {
        detail.append(bindCheck(v.init, (x) => { v.init = x; rerender(); }, '시작 시 ON'));
      } else if (v.type === 'enum') {
        detail.append(
          pair('선택지', bindInput((v.enum || []).join(', '), (x) => { v.enum = x.split(',').map((s) => s.trim()).filter(Boolean); rerender(); }, { cls: 'sce-w-l', ph: '봄, 여름, 가을, 겨울 (쉼표 구분)' })),
          pair('시작값', bindInput(v.init, (x) => { v.init = x; rerender(); }, { cls: 'sce-w-s' })),
        );
      } else if (v.type === 'list') {
        detail.append(
          pair('시작 아이템', bindInput((Array.isArray(v.init) ? v.init : []).join(', '),
            (x) => { v.init = x.split(',').map((s) => s.trim()).filter(Boolean); rerender(); },
            { cls: 'sce-w-l', ph: '빵, 물통 (쉼표 구분, 비워도 됨)' })),
          pair('최대 개수', bindInput(v.maxItems, (x) => { v.maxItems = numOrNull(x) ?? undefined; rerender(); }, { cls: 'sce-w-s', ph: '20' })),
          pair('아이템 글자수', bindInput(v.itemMaxLength, (x) => { v.itemMaxLength = numOrNull(x) ?? undefined; rerender(); }, { cls: 'sce-w-s', ph: '40' })),
        );
      }
      rows.push(detail);
      rows.push(h('div', { class: 'sce-row' },
        pair('설명', bindInput(v.desc, (x) => { v.desc = x || undefined; rerender(); },
          { cls: 'sce-w-l', ph: '(선택) AI에게 알려줄 이 항목의 의미 — 예: 남은 식량을 일수로 표기 (0이면 굶주림)' }),
          'AI가 이 변수를 언제/어떻게 갱신해야 하는지 알려주는 설명. 빈칸으로 방치되는 변수에 특히 유용'),
      ));
      wrap.appendChild(h('div', { class: 'sce-block' }, ...rows));
    });
    wrap.appendChild(addBtn('변수 추가', () => {
      schema.vars.push({ id: 'var' + (schema.vars.length + 1), label: '', type: 'int', init: 0 });
      rerender();
    }));

    wrap.appendChild(h('h4', {}, '파생 변수 (자동 계산 — AI도 규칙도 직접 못 바꿈)'));
    schema.derived.forEach((d, i) => {
      wrap.appendChild(h('div', { class: 'sce-block' }, h('div', { class: 'sce-row' },
        bindInput(d.id, (x) => { d.id = x.trim(); rerender(); }, { cls: 'sce-w-m', ph: '영문id' }),
        bindInput(d.label, (x) => { d.label = x; rerender(); }, { cls: 'sce-w-m', ph: '표시 이름' }),
        h('span', {}, '='),
        bindInput(d.expr, (x) => { d.expr = x; rerender(); }, { cls: 'sce-w-l', ph: 'round(population * 0.3) - military * 2' }),
        grip(schema.derived, i, rerender),
      )));
    });
    wrap.appendChild(addBtn('파생 변수 추가', () => { schema.derived.push({ id: 'calc' + (schema.derived.length + 1), expr: '0' }); rerender(); }));
    return wrap;
  }

  // ── 탭: 상태창 ────────────────────────────────────────────
  // 뼈대 덮어쓰기 확인용 — rerender()가 DOM을 새로 만들므로 tabStatus 밖에 둬야 살아남는다
  let tplArm = null;
  function tabStatus() {
    const ui = schema.statusUI;
    const wrap = h('div');
    const allIds = [...schema.vars.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`]),
                    ...schema.derived.map((d) => [d.id, `${d.label ?? d.id} (${d.id}, 자동)`]),
                    // 시간 노출 파생 — 시간 체계가 켜져 있으면 날짜·시각도 상태창 항목이 된다
                    ...(timeConfig(schema)?.expose ?? []).map((n) => [n, `${EXPOSED_LABELS[n]} (${n}, 시간)`])];
    wrap.appendChild(h('div', { class: 'sce-row' },
      // 제목은 여기가 유일한 입력칸 — meta는 패치·탭별 내보내기 어느 쪽도 안 다루는 영역이라
      // 이 칸이 없으면 JSON 직접 수정이 강제된다 (실전 제보로 발견된 구멍, v0.44.3)
      pair('제목', bindInput(schema.meta?.name, (x) => {
        schema.meta = schema.meta || {};
        schema.meta.name = x.trim() || undefined; rerender();
      }, { cls: 'sce-w-m', ph: '(비우면 "상태")' }),
        '상태창 머리글 + 메인 AI 상태 블록 제목 + 진단 리포트 제목'),
      pair('표시 방식', bindSelect(ui.mode ?? 'auto', [
        ['auto', '자동 구성 (그룹/항목)'], ['template', '커스텀 HTML 템플릿 (고급)'],
      ], (x) => { ui.mode = x; if (x === 'template' && !ui.template) ui.template = ''; rerender(); }),
        '자동: 아래 그룹/항목으로 엔진이 구성. 템플릿: HTML을 직접 짜고 {변수id}로 값을 꽂음 — 팝업/특수 레이아웃용'),
      pair('테마', bindSelect(ui.theme ?? 'clean', Object.keys(THEMES).map((t) => [t, t]), (x) => { ui.theme = x; rerender(); })),
      bindCheck(ui.collapsible !== false, (x) => { ui.collapsible = x; rerender(); }, '접을 수 있게'),
    ));
    if ((ui.mode ?? 'auto') !== 'template') {
      wrap.appendChild(h('div', { class: 'sce-row' },
        pair('그룹 배치', bindSelect(ui.layout ?? 'stack', [
          ['stack', '쌓기 (기본)'], ['tabs', '탭 — 한 번에 한 장'],
          ['accordion', '접기/펼치기 — 여러 장 동시에'], ['popover', '버튼 팝업 — 눌러야 뜸'],
        ], (x) => { ui.layout = x === 'stack' ? undefined : x; rerender(); }),
          '그룹이 여럿일 때 어떻게 보여줄지. 탭·팝업은 그룹이 둘 이상이어야 동작한다 (하나면 그냥 쌓인다).'),
      ));
      if (['tabs', 'popover'].includes(ui.layout)) {
        wrap.appendChild(h('div', { class: 'sce-hint' },
          '전환은 CSS만으로 돈다 — 메시지 안의 버튼은 리스가 클릭 정보를 잘라내서 스크립트로는 못 받기 때문. '
          + '그래서 탭 선택은 새 턴이 와서 최신 메시지가 다시 그려지면 첫 탭으로 돌아간다 (지난 메시지는 그대로 남는다).'));
      }
    }

    if (ui.mode === 'template') {
      wrap.appendChild(h('div', { class: 'sce-hint' },
        'AI가 만들어준 결과물을 <style> 포함 통째로 이 칸에 붙여넣어도 됨 — CSS는 자동 분리·스코핑됨. ' +
        'HTML 안에 {변수id}가 실제 값으로 치환되고, 목록은 {변수id:tags}로 칩 렌더. ' +
        '팝업(체크박스 토글) 구조 가능. 팁: 팝업형이면 "접을 수 있게" 끄기.'));
      wrap.appendChild(bindArea(ui.template, (x) => { ui.template = x; rerender(); },
        '<div class="my-ledger">\n  <b>재정:</b> {gold}G | <b>사기:</b> {morale_grade}\n  <div>{facilities:tags}</div>\n</div>'));

      // 다중 패널 뼈대 — 빈 예제를 주면 결국 변수명을 하나씩 갈아 끼워야 하므로,
      // 이 봇의 그룹·변수로 채워서 뽑아 준다. 그대로 써도 되고 뜯어고쳐도 된다.
      // 확인은 패널 자체 UI로 받는다 — 호스트 대화상자(alertConfirm)는 패널이 전체화면일 때
      // 우리 iframe에 덮여 안 보이고, 샌드박스에서는 네이티브 confirm도 막힐 수 있다.
      // 그래서 이미 쓴 게 있으면 한 번 더 눌러야 덮어쓴다.
      const putTpl = (kind) => () => {
        if (ui.template && ui.template.trim() && tplArm !== kind) { tplArm = kind; rerender(); return; }
        tplArm = null;
        ui.template = multiPanelTemplate(schema, kind);
        rerender();
      };
      const tplBtn = (kind, label) => addBtn(tplArm === kind ? `정말 덮어쓸까요? — ${label}` : label, putTpl(kind));
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '여러 패널로 나누고 싶으면 아래에서 뼈대를 뽑아 쓰세요 — 이 봇의 그룹·변수가 이미 채워져 나옵니다. '
        + '탭은 {uid}(이 상태창이 그려진 메시지 번호)를 라디오 id·name에 씁니다. '
        + '빼면 메시지끼리 탭이 엉켜서 최신 글의 탭을 눌렀는데 맨 위 글이 바뀝니다. '
        + '그냥 쓰기만 할 거면 표시 방식을 "자동 구성"으로 두고 [그룹 배치]에서 고르는 쪽이 간단합니다.'));
      wrap.appendChild(h('div', { class: 'sce-row' },
        tplBtn('tabs', '탭 뼈대 넣기'),
        tplBtn('accordion', '접기/펼치기 뼈대'),
        tplBtn('popover', '버튼 팝업 뼈대'),
      ));

      // ── 조건부 템플릿: 한 봇에 두 가지 플레이가 있을 때 상태창을 통째로 갈아끼운다 ──
      ui.templates = ui.templates || [];
      wrap.appendChild(h('h4', {}, '조건부 템플릿 (한 봇에 여러 판이 있을 때)'));
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '조건이 참인 첫 번째 것만 그려진다. 예: 영지 운영이면 A, 왕궁 시종이면 B. '
        + '각 템플릿의 <style>은 자기 id 껍데기(.sim-tpl-<id>) 안으로 자동 격리되므로, '
        + '두 템플릿이 똑같은 클래스명을 써도 서로를 덮어쓰지 않는다. '
        + '위 칸(조건 없는 기본 템플릿)은 어느 조건도 안 맞을 때의 보험으로 남겨두면 좋다.'));
      ui.templates.forEach((t, i) => {
        wrap.appendChild(h('div', { class: 'sce-block' },
          h('div', { class: 'sce-row' },
            pair('id', bindInput(t.id, (x) => { t.id = x.trim(); rerender(); }, { cls: 'sce-w-s', ph: 'estate' }),
              'CSS 격리에 쓰이는 이름 — 영문·숫자·_만'),
            pair('표시 조건', bindInput(t.when, (x) => { t.when = x || undefined; rerender(); },
              { cls: 'sce-w-l', ph: '(비우면 항상 — 맨 뒤에 두세요) mode == "영지"' })),
            grip(ui.templates, i, rerender),
          ),
          bindArea(t.template, (x) => { t.template = x; rerender(); },
            '<style>.ledger{...}</style>\n<div class="ledger">{gold}G</div>'),
        ));
      });
      wrap.appendChild(addBtn('조건부 템플릿 추가', () => {
        ui.templates.push({ id: 'tpl' + (ui.templates.length + 1), when: '', template: '' });
        rerender();
      }));
    } else {

    ui.groups.forEach((g, gi) => {
      const block = h('div', { class: 'sce-block' });
      block.appendChild(h('div', { class: 'sce-row' },
        pair('그룹', bindInput(g.label, (x) => { g.label = x; rerender(); }, { cls: 'sce-w-m', ph: '그룹 이름 (예: 내정)' })),
        pair('표시', bindSelect(g.visibility ?? 'show', [
          ['show', '보임'], ['collapsed', '접힘 (펼쳐서 봄)'], ['hidden', '숨김 — 내부관리용'],
        ], (x) => { g.visibility = x === 'show' ? undefined : x; rerender(); }),
          '숨김: 채팅 상태창엔 안 나오고 규칙·AI·패널에서만 관리되는 내부 수치'),
        pair('표시 조건', bindInput(g.showWhen, (x) => { g.showWhen = x || undefined; rerender(); },
          { cls: 'sce-w-m', ph: '(비우면 항상)' }),
          '조건이 참일 때만 이 그룹이 상태창에 등장. 예: famine / curse > 0'),
        // 그룹 통째 합치기 — 항목을 드롭다운으로 하나씩 옮기다 눈 빠진다는 제보 (v0.44.2)
        ui.groups.length >= 2 ? pair('합치기', bindSelect('', [['', '↪ 다른 그룹으로…'],
          ...ui.groups.map((g2, i2) => [String(i2), `${i2 + 1}. ${g2.label || '(이름 없음)'}`])
            .filter(([i2]) => i2 !== '' && Number(i2) !== gi)],
          (x) => {
            if (x === '') return;
            const target = ui.groups[Number(x)];
            target.items = (target.items || []).concat(g.items || []);
            ui.groups.splice(gi, 1);
            rerender();
          }),
          '이 그룹의 항목 전부를 고른 그룹 끝에 붙이고, 이 그룹은 없앰') : null,
        grip(ui.groups, gi, rerender),
      ));
      g.items = g.items || [];
      const sub = h('div', { class: 'sce-sub' });
      g.items.forEach((it, ii) => {
        const row = h('div', { class: 'sce-row' },
          bindSelect(it.var, allIds.length ? allIds : [['', '(변수 없음)']], (x) => { it.var = x; rerender(); }),
          bindCheck(!!it.bar, (x) => { if (x) it.bar = it.bar || { max: 100 }; else delete it.bar; rerender(); }, '게이지'),
          pair('조건', bindInput(it.showWhen, (x) => { it.showWhen = x || undefined; rerender(); },
            { cls: 'sce-w-m', ph: '(항상)' }),
            '조건이 참일 때만 이 항목이 표시. 예: famine, hp < max_hp'),
        );
        if (it.bar) {
          row.append(
            pair('최대', bindInput(it.bar.max, (x) => {
              it.bar.max = x;
              // % 기준 위험 전환 색은 최대값을 수식에 품고 있으므로 같이 재생성
              const spec = parseColorSpec(it.color, it.var);
              if (spec.mode === 'threshold' && spec.kind === 'pct') {
                it.color = buildColorSpec(spec, it.var, x);
              }
              rerender();
            }, { cls: 'sce-w-m', ph: '100 또는 수식 (예: max_hp)' })),
          );
        }
        row.appendChild(grip(g.items, ii, rerender));
        sub.appendChild(row);
        if (it.bar) sub.appendChild(colorBuilder(it, it.var, rerender));
      });
      sub.appendChild(addBtn('항목', () => { g.items.push({ var: schema.vars[0]?.id ?? '' }); rerender(); }));
      block.appendChild(sub);
      wrap.appendChild(block);
    });
    wrap.appendChild(addBtn('그룹 추가', () => { ui.groups.push({ label: '', items: [] }); rerender(); }));

    // 자동 배치: 아직 상태창에 없는 변수·파생을 한 번에 채워넣기
    const usedIds = new Set(ui.groups.flatMap((g2) => (g2.items || []).map((it) => it.var)));
    const missing = [
      ...schema.vars.filter((v) => !usedIds.has(v.id)),
      ...schema.derived.filter((d) => !usedIds.has(d.id)).map((d) => ({ ...d, _derived: true })),
    ];
    // 최소·최대가 모두 잡힌 숫자 변수는 게이지 자동 설정
    const mkItem = (v) => {
      const item = { var: v.id };
      if (!v._derived && (v.type === 'int' || v.type === 'float') && v.min != null && v.max != null) {
        item.bar = { max: v.max };
      }
      return item;
    };
    const autoBtn = h('button', { class: 'sce-btn sce-add', onclick: () => {
      if (!missing.length) return;
      let target = ui.groups[ui.groups.length - 1];
      if (!target) { target = { label: '상태', items: [] }; ui.groups.push(target); }
      target.items = target.items || [];
      for (const v of missing) target.items.push(mkItem(v));
      rerender();
    } }, missing.length
      ? `⚡ 빠진 변수 자동 배치 (${missing.length}개 — 마지막 그룹에 추가)`
      : '⚡ 자동 배치 — 모든 변수가 이미 배치됨');
    if (!missing.length) { autoBtn.disabled = true; autoBtn.style.opacity = .45; }
    wrap.appendChild(autoBtn);

    // 접두사 묶음 배치 — noz_aff·noz_mood처럼 접두사를 공유하는 변수들을 인물·주제별 그룹으로.
    // 다인 봇(입주자 8명 × 수치 6개 = 그룹 8개 손조립)의 노가다를 없앤다.
    const buckets = new Map(); // 접두사 → 변수들
    for (const v of missing) {
      const m = /^([a-zA-Z][a-zA-Z0-9]*)_./.exec(v.id);
      if (!m) continue;
      const key = m[1].toLowerCase();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(v);
    }
    for (const [k, arr] of [...buckets]) if (arr.length < 2) buckets.delete(k);
    if (buckets.size >= 2) {
      wrap.appendChild(h('button', { class: 'sce-btn sce-add', onclick: () => {
        const placed = new Set();
        for (const [pre, arr] of buckets) {
          const g = {
            label: commonLabelPrefix(arr) || pre,
            visibility: 'collapsed',
            items: arr.map(mkItem),
          };
          for (const v of arr) placed.add(v.id);
          ui.groups.push(g);
        }
        const rest = missing.filter((v) => !placed.has(v.id));
        if (rest.length) ui.groups.push({ label: '기타', items: rest.map(mkItem) });
        rerender();
      } }, `⚡ 접두사로 그룹 묶어 배치 (${buckets.size}묶음 — ${[...buckets.keys()].slice(0, 3).map((k) => k + '_*').join(', ')}${buckets.size > 3 ? ' …' : ''})`));
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '같은 접두사(noz_… 등)를 쓰는 변수끼리 그룹 하나씩 만들어 넣습니다. 그룹 제목은 라벨의 공통 앞부분'
        + '("노조미 호감"·"노조미 기분" → "노조미")에서 따오고, 기본 접힘으로 둡니다. 그룹이 많으면 위 [그룹 배치]에서 탭·아코디언을 고르세요.'));
    }
    } // end auto mode

    wrap.appendChild(h('h4', {}, 'CSS 레시피 — 딸깍하면 아래 커스텀 CSS에 채워짐 (이어서 수정 가능)'));
    const RECIPES = [
      ['양피지 장부', `.sim-status { background:#f3ead3; border:1px solid #b09b6b; color:#4a3a26; font-family:Georgia,'Nanum Myeongjo',serif; }
.sim-status summary { color:#6b512f; }
.sim-group { border-bottom:1px dashed #cbb98d; padding-bottom:6px; }
.sim-group-label { color:#8a6d45; letter-spacing:.08em; }
.sim-label { color:#6b5638; opacity:1; }
.sim-value { color:#9c2f21; font-weight:700; }
.sim-badge, .sim-tag { background:#45351d; color:#f0e6cf; border:none; }
.sim-bar { background:#ddd0ae; }
.sim-bar-fill { background:#9c2f21; }
.sim-action { border-color:#8a6d45; color:#6b512f; }
.sim-log { color:#7a6a4c; }`],
      ['한밤 유리', `.sim-status { background:rgba(20,28,48,.75); border:1px solid rgba(120,160,255,.25); border-radius:16px; backdrop-filter:blur(6px); box-shadow:0 8px 24px rgba(0,0,0,.35); }
.sim-status summary { color:#9db8e8; }
.sim-group { background:rgba(91,141,239,.07); border-radius:10px; padding:6px 8px; }
.sim-badge, .sim-tag { background:rgba(91,141,239,.18); border:1px solid rgba(91,141,239,.3); }
.sim-bar { background:rgba(91,141,239,.15); }
.sim-bar-fill { background:linear-gradient(90deg,#5b8def,#9d6bef); }`],
      ['로얄 골드', `.sim-status { background:#151310; border:1px solid #8a6d3b; color:#e8ddc4; }
.sim-status summary { color:#d4af37; letter-spacing:.06em; }
.sim-group-label { color:#d4af37; border-bottom:1px solid #3a3325; }
.sim-value { color:#f1e3b8; }
.sim-badge, .sim-tag { background:#2a2418; color:#d4af37; border:1px solid #8a6d3b66; }
.sim-bar { background:#2a2418; }
.sim-bar-fill { background:linear-gradient(90deg,#8a6d3b,#d4af37); }
.sim-action { border-color:#8a6d3b; color:#d4af37; }`],
      ['벚꽃', `.sim-status { background:#fff5f7; border:1px solid #f3c1cf; color:#5c4046; }
.sim-status summary { color:#d16a8a; }
.sim-group-label { color:#c25c7d; }
.sim-value { color:#b03a5e; font-weight:600; }
.sim-badge, .sim-tag { background:#fbe3ea; color:#a34565; border:1px solid #f3c1cf; }
.sim-bar { background:#f8dde5; }
.sim-bar-fill { background:linear-gradient(90deg,#f199b4,#d16a8a); }`],
      ['픽셀 레트로', `.sim-status { background:#0b1020; border:2px solid #4a5aef; border-radius:0; color:#cdd6ff; font-family:'Galmuri11','DungGeunMo',monospace; }
.sim-status summary { color:#7f8cff; }
.sim-group-label { color:#ffd166; }
.sim-bar { background:#1c2440; border-radius:0; height:10px; border:1px solid #4a5aef55; }
.sim-bar-fill { border-radius:0; background:#4ade80; }
.sim-badge, .sim-tag { border-radius:0; background:#1c2440; border:1px solid #4a5aef88; }
.sim-action { border-radius:0; }`],
    ];
    const recipeRow = h('div', { class: 'sce-row' });
    for (const [name, css] of RECIPES) {
      recipeRow.appendChild(h('button', { class: 'sce-btn', onclick: () => { ui.customCSS = css; rerender(); } }, name));
    }
    recipeRow.appendChild(h('button', { class: 'sce-btn sce-danger', onclick: () => { ui.customCSS = undefined; rerender(); } }, 'CSS 지우기'));
    wrap.appendChild(recipeRow);

    // 직접 CSS를 짜는 대신, 규격서를 통째로 복사해 외부 AI에 맡기는 경로.
    copyWidget('📋 AI에게 요청할 CSS 규격 복사',
      '원하는 디자인이 레시피에 없으면 — 아래 버튼으로 규격서를 복사해서 아무 AI 사이트에 붙여넣고 '
      + '"이런 분위기로 만들어줘"라고만 하세요. 받아온 CSS를 아래 칸에 넣으면 끝입니다.',
      () => buildCssSpecPrompt(schema),
    ).mount(wrap);

    wrap.appendChild(h('h4', {}, '커스텀 CSS (자동으로 상태창 범위로 제한됨 — 앱 UI를 못 깨뜨림)'));
    wrap.appendChild(bindArea(ui.customCSS, (x) => { ui.customCSS = x || undefined; rerender(); },
      '.sim-status { border-color: gold; }\n.sim-bar-fill { background: crimson; }'));

    // 미리보기 — 1층 결과 창구와 같은 렌더러 (uid만 다르게, 접기 상태가 서로를 건드리면 안 된다)
    wrap.appendChild(h('h4', {}, '미리보기 (시작값 기준)'));
    wrap.appendChild(statusPreviewEl('pv'));
    return wrap;
  }

  // ── 탭: 규칙·이벤트 ───────────────────────────────────────
  // ── 탭 하나만 떼어 AI에게 맡기는 도구 (내보내기 → 붙여넣기 → 되돌리기) ──
  let tabUndo = null; // { tabKey, label, before } — 통째로 갈아끼우므로 한 단계 되돌리기가 필수
  let tabAiMsg = null; // { tabKey, text } — rerender를 건너뛰고 살아남아야 하는 가져오기 결과 안내

  // 검증 오류 경로 → 그 오류가 속한 탭. 변수를 갈아끼웠을 때 어디를 고쳐야 하는지 알려준다.
  const PATH_TABS = [
    [/^\$\.(rules|directives)\b/, '규칙·이벤트', true],
    [/^\$\.actions\b/, '액션', true],
    [/^\$\.party\b/, '편성표', false],
    [/^\$\.(statusUI|promptState)\b/, '상태창', false],
    [/^\$\.updater\b/, 'AI 설정', false],
    [/^\$\.setup\.presets\b/, '새 시작(프리셋)', true],
    [/^\$\.setup\b/, '새 시작', false],
  ];

  // 변수를 갈아끼우면 그 변수를 쓰던 다른 탭이 조용히 깨진다. 검증기에 물어 사라진 이름과 깨진 탭을 뽑는다.
  function breakageAfterVarImport() {
    const missing = new Set();
    const aiReady = new Set(), manual = new Set();
    for (const e of validateSchema(schema).errors) {
      if (!/알 수 없는 변수|vars에 없음|정의되지 않음/.test(e.msg)) continue;
      const m = /'([a-zA-Z_][a-zA-Z0-9_]*)'/.exec(e.msg);
      if (m) missing.add(m[1]);
      const hit = PATH_TABS.find(([re]) => re.test(e.path || ''));
      if (hit) (hit[2] ? aiReady : manual).add(hit[1]);
    }
    return { missing: [...missing], aiReady: [...aiReady], manual: [...manual] };
  }

  function tabAiTools(tabKey) {
    const slice = TAB_SLICES[tabKey];
    const wrap = h('div', { class: 'sce-block' });
    wrap.appendChild(h('h4', {}, `🤖 ${slice.label}만 AI에게 맡기기`));

    copyWidget(`📤 ${slice.label} 규격 내보내기`,
      tabKey === 'vars'
        ? '**가장 먼저 하는 탭입니다.** 변수는 액션·규칙·상태창 전부의 전제라, 여기부터 확정해야 나머지 탭이 '
          + '"이 변수만 써라"는 계약을 받을 수 있습니다. 순서를 건너뛰면 가져오기에서 오류가 수백 건 터집니다.'
        : '이 탭 몫만 떼어내 AI에게 맡깁니다. **이미 정의된 변수 목록이 함께 나가서** 없는 변수를 지어내지 못하고, '
          + '패턴 예시가 붙어 있어 형태도 흐트러지지 않습니다.',
      () => buildTabExportPrompt(schema, tabKey),
    ).mount(wrap);
    wrap.appendChild(jumpRow('부분 수정이면 ✨ AI에게 맡기기(패치)가 더 안전합니다 — 통 교체는 AI가 하나만 빠뜨려도 그게 삭제라서, 전면 재작성일 때만 이 내보내기를 쓰세요.'));

    const note = h('div', { class: 'sce-hint' },
      (tabAiMsg && tabAiMsg.tabKey === tabKey) ? tabAiMsg.text
        : 'AI가 준 JSON을 여기 붙여넣고 [가져오기]를 누르세요. 코드펜스(```)나 앞뒤 설명이 붙어 있어도 됩니다.');
    if (tabAiMsg && tabAiMsg.tabKey === tabKey && tabAiMsg.warn) note.className += ' sce-warn';
    const area = h('textarea', { style: 'height:130px', placeholder: `{ "${slice.keys[0]}": [ ... ] }` });
    const row = h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn', onclick: () => {
        const raw = String(area.value).trim();
        if (!raw) { note.textContent = '붙여넣은 내용이 없습니다.'; return; }
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        let frag;
        try { frag = JSON.parse(fenced ? fenced[1] : raw); }
        catch (e) { note.textContent = `JSON 파싱 실패 — ${e.message}`; return; }
        let picked;
        try { picked = pickTabFragment(tabKey, frag, schema); }
        catch (e) { note.textContent = `가져오기 실패 — ${e.message}`; return; }
        const beforeCounts = tabItemCounts(schema, tabKey);
        tabUndo = { tabKey, label: slice.label, before: JSON.parse(JSON.stringify(schema)) };
        Object.assign(schema, JSON.parse(JSON.stringify(picked)));
        normalize();
        const afterCounts = tabItemCounts(schema, tabKey);
        const counts = afterCounts.map(([p, n]) => `${p} ${n}개`).join(', ');
        let text = `✓ 가져왔습니다${counts ? ` — ${counts}` : ''}.`;
        let warn = false;

        // AI가 "고친 것만" 돌려주는 일이 잦다. 통째로 갈아끼우는 구조라 그러면 나머지가 조용히 날아간다.
        const lost = afterCounts
          .map(([p, n], i) => [p, beforeCounts[i]?.[1] ?? 0, n])
          .filter(([, was, now]) => was >= 4 && now < was * 0.6);
        if (lost.length) {
          warn = true;
          text = `⚠ 가져왔지만 항목이 크게 줄었습니다 — `
            + lost.map(([p, was, now]) => `${p} ${was}개 → ${now}개`).join(', ')
            + '. AI가 고친 것만 돌려준 것 같습니다. 의도한 게 아니면 [↩ 되돌리기]를 누르고, '
            + 'AI에게 "손대지 않은 항목까지 전부 포함해 한 세트로 다시 달라"고 요청하세요.';
        } else if (tabKey === 'vars') {
          const b = breakageAfterVarImport();
          if (b.missing.length) {
            warn = true;
            text += ` 다만 다른 탭이 쓰던 변수 ${b.missing.length}개가 사라졌습니다 (${b.missing.join(', ')}).`;
            if (b.aiReady.length) text += ` ${b.aiReady.join('·')} 탭은 [내보내기]로 다시 만들면 됩니다.`;
            if (b.manual.length) text += ` ${b.manual.join('·')} 탭은 직접 고쳐야 합니다.`;
          } else {
            text += ' 이제 액션 탭과 규칙·이벤트 탭에서 내보내기를 하면 이 변수표가 함께 나갑니다.';
          }
        }
        tabAiMsg = { tabKey, text, warn };
        rerender(); // 아래 검증 리포트가 바로 갱신된다 — 오류가 있으면 [②]로 AI에게 돌려주면 된다
      } }, '📥 가져오기'),
    );
    if (tabUndo && tabUndo.tabKey === tabKey) {
      row.appendChild(h('button', { class: 'sce-btn sce-danger', onclick: () => {
        schema = tabUndo.before;
        tabUndo = null;
        tabAiMsg = { tabKey, text: '↩ 가져오기 전으로 되돌렸습니다.', warn: false };
        rerender();
      } }, '↩ 가져오기 되돌리기'));
    }
    wrap.appendChild(note);
    wrap.appendChild(area);
    wrap.appendChild(row);
    return wrap;
  }

  function tabRules() {
    const wrap = h('div');
    wrap.appendChild(tabAiTools('rules'));
    wrap.appendChild(h('h4', {}, '매 턴 자동 처리 (수입·소비 같은 정기 틱)'));
    wrap.appendChild(effectRows(schema, schema.rules.onTurn, rerender));

    wrap.appendChild(h('h4', {}, '상태 지시문 — 조건을 만족하는 동안 매 턴 AI에게 전달'));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '이벤트(발동 순간 1회 통지)와 달리, 조건이 참인 동안 계속 주입되는 지시/정보. ' +
      '예: 호감도 30 미만이면 "차갑게 대하라", 허기 20 이하면 "매우 배가 고픈 상태다". {변수id}로 값 삽입 가능.'));
    schema.directives.forEach((d, i) => {
      wrap.appendChild(h('div', { class: 'sce-block' },
        h('div', { class: 'sce-row' },
          bindInput(d.id, (x) => { d.id = x.trim(); rerender(); }, { cls: 'sce-w-m', ph: '지시문id' }),
          pair('조건', bindInput(d.when, (x) => { d.when = x; rerender(); }, { cls: 'sce-w-l', ph: 'affection < 30 / hunger <= 20' })),
          grip(schema.directives, i, rerender),
        ),
        bindArea(d.text, (x) => { d.text = x; rerender(); },
          '예: {{char}}는 아직 마음을 열지 않았다. 차갑고 퉁명스럽게 대하라. (현재 호감도 {affection})'),
      ));
    });
    wrap.appendChild(addBtn('상태 지시문', () => {
      schema.directives.push({ id: 'directive' + (schema.directives.length + 1), when: '', text: '' });
      rerender();
    }));

    wrap.appendChild(h('h4', {}, '조건 이벤트 (조건을 만족하면 자동 발동)'));
    schema.rules.events.forEach((ev, i) => {
      wrap.appendChild(h('div', { class: 'sce-block' },
        h('div', { class: 'sce-row' },
          bindInput(ev.id, (x) => { ev.id = x.trim(); rerender(); }, { cls: 'sce-w-m', ph: '이벤트id' }),
          pair('조건', bindInput(ev.when, (x) => { ev.when = x; rerender(); }, { cls: 'sce-w-l', ph: 'food <= 0 and not famine' })),
          bindCheck(ev.once, (x) => { ev.once = x || undefined; rerender(); }, '1회만'),
          grip(schema.rules.events, i, rerender),
        ),
        effectRows(schema, ev.effects = ev.effects || [], rerender),
        h('div', { class: 'sce-row' },
          pair('AI 통지', bindInput(ev.notify, (x) => { ev.notify = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '다음 턴에 AI에게 전달될 서술 (예: 기근이 시작되었다...)' })),
        ),
        choiceEditor(ev),
      ));
    });
    wrap.appendChild(addBtn('조건 이벤트', () => { schema.rules.events.push({ id: 'event' + (schema.rules.events.length + 1), when: '', effects: [] }); rerender(); }));

    const re = schema.rules.randomEvents;
    wrap.appendChild(h('h4', {}, '랜덤 이벤트'));
    wrap.appendChild(h('div', { class: 'sce-row' },
      pair('턴당 발동 확률', bindInput(Math.round((re.chancePerTurn ?? 0) * 100), (x) => { re.chancePerTurn = Math.max(0, Math.min(100, num(x))) / 100; rerender(); }, { cls: 'sce-w-s' })),
      h('span', {}, '%'),
    ));
    re.table.forEach((ev, i) => {
      wrap.appendChild(h('div', { class: 'sce-block' },
        h('div', { class: 'sce-row' },
          bindInput(ev.id, (x) => { ev.id = x.trim(); rerender(); }, { cls: 'sce-w-m', ph: '이벤트id' }),
          pair('가중치', bindInput(ev.weight ?? 1, (x) => { ev.weight = num(x) || 1; rerender(); }, { cls: 'sce-w-s' })),
          pair('쿨다운', bindInput(ev.cooldown, (x) => { ev.cooldown = numOrNull(x) ?? undefined; rerender(); }, { cls: 'sce-w-s', ph: '턴' })),
          grip(re.table, i, rerender),
        ),
        h('div', { class: 'sce-row' },
          pair('조건', bindInput(ev.when, (x) => { ev.when = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '(비우면 항상 후보) military < 150' })),
        ),
        effectRows(schema, ev.effects = ev.effects || [], rerender),
        h('div', { class: 'sce-row' },
          pair('AI 통지', bindInput(ev.notify, (x) => { ev.notify = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '산적이 상단을 습격했다...' })),
        ),
        choiceEditor(ev),
      ));
    });
    wrap.appendChild(addBtn('랜덤 이벤트', () => { re.table.push({ id: 'random' + (re.table.length + 1), weight: 1 }); rerender(); }));
    return wrap;
  }

  // 갈림길(choices) 편집 — 이벤트의 속성이라 별도 탭이 아니라 이벤트 블록 안에 붙는다.
  // (조건 이벤트·랜덤 이벤트 공용)
  function choiceEditor(ev) {
    const box = h('div', { class: 'sce-sub' });
    if (!Array.isArray(ev.choices)) {
      box.appendChild(h('button', { class: 'sce-btn sce-mini', onclick: () => {
        ev.choices = [{ label: '', effects: [] }, { label: '', effects: [] }];
        ev.timeout = ev.timeout ?? 3;
        rerender();
      } }, '⌛ 갈림길로 만들기 — 터지면 선택지를 내밀고 유저가 /선택으로 고를 때까지 기다린다'));
      return box;
    }
    box.appendChild(h('div', { class: 'sce-hint' },
      '이 이벤트는 갈림길이다: 터지면 상태창에 선택지가 뜨고, 유저가 채팅에 /선택 번호 를 칠 때까지 기다린다. '
      + '기다리는 동안 이 선택지들이 만질 변수는 보조 AI에서 빠진다(결과 선점 방지). '
      + '타임아웃이 지나면 맨 마지막 항목이 자동 결정되므로, 마지막은 조건 없는 "외면한다"류로 둘 것.'));
    ev.choices.forEach((c, ci) => {
      box.appendChild(h('div', { class: 'sce-block' },
        h('div', { class: 'sce-row' },
          h('span', { class: 'sce-w-s' }, `${ci + 1}.`),
          bindInput(c.label, (x) => { c.label = x; rerender(); }, { cls: 'sce-w-m', ph: '선택지 이름 (예: 토벌대를 보낸다)' }),
          pair('조건', bindInput(c.when, (x) => { c.when = String(x).trim() || undefined; rerender(); },
            { cls: 'sce-w-m', ph: '(비우면 항상) gold >= 100' }),
            '거짓이면 잠김(🔒)으로 표시되고 고를 수 없다. 번호는 유지된다'),
          grip(ev.choices, ci, rerender),
        ),
        effectRows(schema, c.effects = c.effects || [], rerender),
        h('div', { class: 'sce-row' },
          pair('AI 전달문', bindInput(c.inject, (x) => { c.inject = x || undefined; rerender(); },
            { cls: 'sce-w-l', ph: '(선택) 고른 턴에 AI에게 덧붙는 문장 — "[선택] 이름"은 자동으로 나간다' })),
        ),
      ));
    });
    box.appendChild(h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn sce-add', style: 'flex:1', onclick: () => {
        ev.choices.push({ label: '', effects: [] }); rerender();
      } }, '+ 선택지'),
      pair('타임아웃', bindInput(ev.timeout, (x) => { ev.timeout = numOrNull(x) ?? undefined; rerender(); },
        { cls: 'sce-w-s', ph: '턴' }),
        '안 고르고 이만큼 지나면 마지막 항목 자동. 비우면 고를 때까지 무한정 기다린다 (비추)'),
      h('button', { class: 'sce-btn sce-mini sce-danger', onclick: () => {
        delete ev.choices; delete ev.timeout; rerender();
      } }, '갈림길 떼기'),
    ));
    return box;
  }

  // ── 탭: 명령 ──────────────────────────────────────────────
  // 상태는 보조 모델이 알아서 갱신한다. 여기서 여는 건 **그게 틀렸을 때 유저가 고치는 통로**다.
  // 명령 이름은 제작자가 정하므로, 유저가 그걸 볼 자리(상태창 {commands})까지 이 탭이 안내한다.
  function tabCommands() {
    const wrap = h('div');
    wrap.appendChild(tabAiTools('commands'));

    const withCmd = schema.vars.filter((v) => v.cmd);
    const free = schema.vars.filter((v) => !v.cmd);

    wrap.appendChild(h('h4', {}, `채팅 명령 (${withCmd.length}개)`));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '유저가 채팅 입력창에 치는 한 줄. 변수에 이름을 붙이면 그 이름의 명령이 생긴다 — '
      + '안 붙이면 그 변수엔 명령이 없다. 문법은 적을 필요가 없다, 변수 타입이 정한다. '
      + '공백·"/"·"-"는 이름에 못 쓰고 겹쳐도 안 된다. 파생 변수에는 못 단다(계산 결과라서).'));

    if (!withCmd.length) {
      wrap.appendChild(h('div', { class: 'sce-hint sce-warn' },
        '아직 하나도 없습니다 — 이 봇에는 채팅 명령이 없는 상태입니다. '
        + '틀리면 매일 복리로 어긋나는 것(지속 수입·계약·봉급)부터 하나 열어 두시길 권합니다.'));
    }

    for (const v of withCmd) {
      const spec = engine.commandSpecs(schema).find((s) => s.id === v.id);
      wrap.appendChild(h('div', { class: 'sce-block' },
        h('div', { class: 'sce-row' },
          h('span', { class: 'sce-w-m' }, `${v.label ?? v.id} (${v.type})`),
          h('span', {}, '/'),
          bindInput(v.cmd, (x) => {
            const t = String(x).trim();
            if (t) v.cmd = t; else delete v.cmd;
            rerender();
          }, { cls: 'sce-w-m', ph: '명령 이름' }),
          h('button', { class: 'sce-btn sce-mini sce-danger', title: '명령 떼기',
            onclick: () => { delete v.cmd; rerender(); } }, '✕'),
        ),
        h('div', { class: 'sce-hint' },
          (spec ? spec.usage.map(([syn, why]) => `${syn}  —  ${why}`).join('\n') : '')),
      ));
    }

    // 붙일 변수 고르기. 목록형을 위로 올린다 — 계약·봉급처럼 틀리면 복리로 어긋나는 게 여기 있다.
    const pick = h('select', { class: 'sce-w-l' });
    pick.appendChild(h('option', { value: '' }, '— 명령을 붙일 변수 —'));
    for (const v of [...free].sort((a, b) => (a.type === 'list' ? -1 : 0) - (b.type === 'list' ? -1 : 0))) {
      pick.appendChild(h('option', { value: v.id }, `${v.label ?? v.id} (${v.id} · ${v.type})`));
    }
    wrap.appendChild(h('div', { class: 'sce-row' }, pick,
      h('button', { class: 'sce-btn', onclick: () => {
        const v = schema.vars.find((x) => x.id === pick.value);
        if (!v) return;
        // 라벨을 그대로 이름으로 쓰면 공백이 들어가 검증에서 막힌다 — 첫 낱말만 쓴다.
        const base = String(v.label ?? v.id).trim().split(/\s+/)[0].replace(/[\/-]/g, '') || v.id;
        const taken = new Set(schema.vars.filter((x) => x.cmd).map((x) => x.cmd));
        let name = base, n = 2;
        while (taken.has(name)) name = base + (n++);
        v.cmd = name;
        rerender();
      } }, '＋ 명령 열기')));

    // 유저가 이걸 볼 자리. 이 안내가 없으면 명령을 만들어 놓고 아무도 모르는 상태가 그대로 남는다.
    wrap.appendChild(h('h4', {}, '유저가 이 목록을 보는 자리'));
    const tplMode = (schema.statusUI?.mode === 'template');
    wrap.appendChild(h('div', { class: 'sce-hint' },
      tplMode
        ? '상태창 템플릿에서 원하는 자리에 {commands} 를 넣으면 접이식 명령 목록이 그려집니다. '
          + '안 넣으면 안 나옵니다 — 유저는 무슨 명령이 있는지 알 방법이 없어집니다.'
        : '지금은 그룹 모드라 상태창 맨 아래에 자동으로 붙습니다. 템플릿 모드로 바꾸면 '
          + '{commands} 를 넣은 자리에만 나옵니다.'));
    if (tplMode) {
      const has = (schema.statusUI.templates || []).some((t) => String(t.template || '').includes('{commands}'))
        || String(schema.statusUI.template || '').includes('{commands}');
      if (withCmd.length && !has) {
        wrap.appendChild(h('div', { class: 'sce-hint sce-warn' },
          '⚠ 명령을 열어 뒀는데 상태창 어디에도 {commands} 가 없습니다. 지금은 유저가 명령의 존재를 알 수 없습니다.'));
      }
    }
    return wrap;
  }

  // ── 탭: 편성표 ────────────────────────────────────────────
  // 게임 패널 1호 (v0.55, 설계 docs/design-편성표.md). 슬롯 = enum 변수, 보유 = list 변수.
  // 채팅 화면 우상단에 버튼이 생기고, 누르면 팝업에서 슬롯을 채운다 — 저장은 변수라서
  // 상태창 when 분기·지시문·AI 프롬프트가 전부 그대로 읽는다 (새 표시 문법 없음).
  function tabParty() {
    const wrap = h('div');
    const enums = schema.vars.filter((v) => v.type === 'enum');
    const lists = schema.vars.filter((v) => v.type === 'list');

    if (!schema.party) {
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '파티 편성표 — 채팅 화면 우상단에 버튼을 달고, 누르면 팝업에서 슬롯에 인물을 앉힙니다. '
        + '슬롯 하나 = enum 변수 하나 (그 enum의 값 목록이 편성 후보), 보유 목록(list)을 지정하면 '
        + '목록에 있는 인물만 고를 수 있습니다 (영입해야 열리는 구조). '
        + '저장되는 건 변수 값이라 상태창·지시문·프롬프트의 조건 분기가 전부 그대로 읽습니다.'));
      if (!enums.length) {
        wrap.appendChild(h('div', { class: 'sce-hint sce-warn' },
          '슬롯으로 쓸 enum 변수가 아직 없습니다 — [변수] 탭에서 먼저 만드세요. '
          + '예: id "front", 타입 enum, 값 ["없음","아린","바크","셀레네"], 시작값 "없음".'));
      }
      wrap.appendChild(addBtn('편성표 만들기', () => {
        schema.party = {
          label: '편성표', icon: '⚔️', empty: '없음',
          slots: enums.length ? [{ var: enums[0].id }] : [],
        };
        rerender();
      }));
      return wrap;
    }

    const P = schema.party;
    const hasTabs = Array.isArray(P.tabs) && P.tabs.length > 0;
    if (!hasTabs) P.slots = Array.isArray(P.slots) ? P.slots : [];
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '버튼은 스키마를 설치한 봇의 채팅 화면 우상단에 뜹니다. 팝업에서 고른 값은 슬롯 변수에 '
      + '저장됩니다 — 상태창에 보이게 하려면 [상태창] 탭에서 그 변수를 넣으세요 '
      + '(showWhen으로 "편성했을 때만 표시" 같은 분기도 됩니다).'));

    wrap.appendChild(h('div', { class: 'sce-block' },
      h('div', { class: 'sce-row' },
        pair('버튼 이름', bindInput(P.label, (x) => { P.label = x || undefined; rerender(); }, { cls: 'sce-w-m', ph: '편성표' })),
        pair('아이콘', bindInput(P.icon, (x) => { P.icon = x || undefined; rerender(); }, { cls: 'sce-w-s', ph: '⚔️' }),
          '우상단 버튼에 들어가는 글리프 하나'),
        pair('빈값', bindInput(P.empty, (x) => { P.empty = x || undefined; rerender(); }, { cls: 'sce-w-s', ph: '없음' }),
          '슬롯을 비울 때 넣는 값 — 각 슬롯 enum 목록에 이 값이 있어야 한다'),
      ),
      h('div', { class: 'sce-row' },
        pair('보유 목록', bindSelect(P.roster ?? '',
          [['', '(제한 없음 — enum 전체)'], ...lists.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`])],
          (x) => { if (x) P.roster = x; else delete P.roster; rerender(); }),
          '지정하면 이 목록에 있는 이름만 편성 가능 — 영입(목록 추가)해야 열린다'),
        bindCheck(P.unique !== false, (x) => { if (x) delete P.unique; else P.unique = false; rerender(); },
          '중복 편성 금지 (이미 앉은 인물을 고르면 이동/맞교환)'),
      ),
      h('div', { class: 'sce-row' },
        pair('설명', bindInput(P.note, (x) => { P.note = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '팝업 상단에 보이는 한 줄 (비워도 됨)' })),
      ),
    ));

    // ── 슬롯·액션 편집 조각 (축약형과 탭 양쪽에서 재사용) ──
    const allFlatSlots = () => (hasTabs ? P.tabs.flatMap((t) => (Array.isArray(t.slots) ? t.slots : [])) : P.slots);
    const slotBlocks = (list) => {
      const frag = h('div');
      list.forEach((s, i) => {
        const def = schema.vars.find((v) => v.id === s.var);
        frag.appendChild(h('div', { class: 'sce-block' },
          h('div', { class: 'sce-row' },
            pair('변수', bindSelect(s.var ?? '',
              enums.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`]),
              (x) => { s.var = x; rerender(); }),
              '이 슬롯이 저장되는 enum 변수'),
            pair('슬롯 이름', bindInput(s.label, (x) => { s.label = x || undefined; rerender(); }, { cls: 'sce-w-m', ph: def?.label ?? '(변수 라벨)' })),
            grip(list, i, rerender),
          ),
          def ? h('div', { class: 'sce-hint' }, `후보: ${(def.enum || []).join(', ')}`) : null,
        ));
      });
      if (enums.length) {
        frag.appendChild(addBtn('슬롯 추가', () => {
          const used = new Set(allFlatSlots().map((s) => s.var));
          const next = enums.find((v) => !used.has(v.id)) ?? enums[0];
          list.push({ var: next.id });
          rerender();
        }));
      }
      return frag;
    };
    // 탭의 버튼 = 기존 액션 연결. 액션이 이미 이벤트·규칙·판정 배선이라(effects/check/inject)
    // 체크 하나로 "출격·수복·제작"이 걸린다 — 새 트리거 기계 없음.
    const actionPicks = (owner) => {
      const row = h('div', { class: 'sce-row' });
      if (!schema.actions.length) {
        row.appendChild(h('span', { class: 'sce-hint' },
          '연결할 액션이 아직 없습니다 — [액션] 탭에서 만들면 여기 체크 칸이 생깁니다.'));
        return row;
      }
      row.appendChild(h('span', { class: 'sce-hint' }, '팝업 버튼으로 넣을 액션:'));
      for (const a of schema.actions) {
        const arr = () => (owner.actions = Array.isArray(owner.actions) ? owner.actions : []);
        row.appendChild(bindCheck((owner.actions || []).includes(a.id), (on) => {
          const list = arr();
          if (on && !list.includes(a.id)) list.push(a.id);
          if (!on) owner.actions = list.filter((x) => x !== a.id);
          if (owner.actions && !owner.actions.length) delete owner.actions;
          rerender();
        }, a.label || a.id));
      }
      return row;
    };

    if (!enums.length) {
      wrap.appendChild(h('div', { class: 'sce-hint sce-warn' },
        'enum 변수가 없어 슬롯을 만들 수 없습니다 — [변수] 탭에서 먼저 만드세요.'));
    }

    if (!hasTabs) {
      // 단일 편성 (축약형)
      wrap.appendChild(h('h4', {}, `슬롯 (${P.slots.length}개)`));
      wrap.appendChild(slotBlocks(P.slots));
      wrap.appendChild(actionPicks(P));
      // 칸코레식 확장 — 함대 여러 개 + 수복·제작 같은 시설 탭
      wrap.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn', onclick: () => {
          P.tabs = [{ id: 'tab1', label: '편성 1', slots: P.slots, ...(P.actions ? { actions: P.actions } : {}) }];
          delete P.slots; delete P.actions;
          rerender();
        } }, '🗂 탭 구조로 전환 (편성 여러 개 · 수복/제작 같은 시설 탭)')));
    } else {
      // 여러 탭 (칸코레 모델) — 슬롯 있는 탭 = 편성, 슬롯 없이 액션만 = 시설(수복·제작)
      wrap.appendChild(h('h4', {}, `탭 (${P.tabs.length}개)`));
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '탭 = 편성 하나 또는 시설 하나. 슬롯을 채우면 편성 탭, 슬롯 없이 액션만 걸면 '
        + '수복·제작 같은 시설 탭이 됩니다. 인물은 탭이 달라도 한 자리에만 앉습니다 (이동/맞교환).'));
      P.tabs.forEach((t, ti) => {
        t.slots = Array.isArray(t.slots) ? t.slots : [];
        wrap.appendChild(h('div', { class: 'sce-block' },
          h('div', { class: 'sce-row' },
            pair('탭 이름', bindInput(t.label, (x) => { t.label = x || undefined; rerender(); }, { cls: 'sce-w-m', ph: `탭${ti + 1}` })),
            pair('id', bindInput(t.id, (x) => { const v = String(x).trim(); if (v) t.id = v; else delete t.id; rerender(); }, { cls: 'sce-w-s', ph: `tab${ti + 1}` }),
              '안 적으면 자동 (tabN)'),
            pair('보유 목록', bindSelect(t.roster ?? '',
              [['', P.roster ? `(공용 — ${P.roster})` : '(제한 없음)'], ...lists.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`])],
              (x) => { if (x) t.roster = x; else delete t.roster; rerender(); }),
              '이 탭만 다른 목록을 쓸 때 (예: 수복 대기열)'),
            // 삭제를 onDelete가 전담하고 false를 돌려 grip의 기본 splice를 막는다 (이중 삭제 방지)
            grip(P.tabs, ti, rerender, () => { P.tabs.splice(ti, 1); if (!P.tabs.length) delete P.tabs; rerender(); return false; }),
          ),
          h('div', { class: 'sce-row' },
            pair('탭 설명', bindInput(t.note, (x) => { t.note = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '탭 상단 한 줄 (비워도 됨)' })),
          ),
          slotBlocks(t.slots),
          actionPicks(t),
        ));
      });
      wrap.appendChild(addBtn('탭 추가', () => {
        P.tabs.push({ id: `tab${P.tabs.length + 1}`, label: `편성 ${P.tabs.length + 1}`, slots: [] });
        rerender();
      }));
    }

    // AI가 편성을 서사로 움직이게 할지 — 슬롯 변수를 allow에 넣으면 된다 (선택 사항)
    const allowIds = new Set((schema.updater?.allow || []).map((a) => a.id));
    const aiMoved = allFlatSlots().filter((s) => allowIds.has(s.var));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      aiMoved.length
        ? `보조 AI도 슬롯을 움직일 수 있습니다 (${aiMoved.map((s) => s.var).join(', ')}가 [AI 설정] 허용 목록에 있음) — `
          + '서사에서 "전위를 바꾼다"가 나오면 AI가 따라 바꿉니다. 원치 않으면 허용 목록에서 빼세요.'
        : '지금은 유저만 편성을 바꿉니다 (슬롯 변수가 [AI 설정] 허용 목록에 없음) — '
          + 'AI도 서사 따라 바꾸게 하려면 허용 목록에 슬롯 변수를 추가하세요.'));

    // ── 초상 (v0.57) — 이름 → 캐릭터 에셋 이름. 슬롯·후보 칩에 얼굴이 뜬다 ──
    {
      const allNames = [...new Set(allFlatSlots()
        .flatMap((s) => (schema.vars.find((v) => v.id === s.var)?.enum || []))
        .filter((n) => n !== P.empty))];
      if (allNames.length) {
        const fold = h('details', { class: 'sce-fold' },
          h('summary', {}, `🖼 초상 매핑 (${Object.keys(P.portraits || {}).filter((k) => P.portraits[k]).length}/${allNames.length}명)`));
        fold.appendChild(h('div', { class: 'sce-hint' },
          '인물별로 캐릭터 추가 에셋의 이름을 적으면 편성 팝업의 슬롯·후보 칩에 얼굴이 뜹니다 '
          + '(확장자는 생략 가능 — leningrad_profile.png → leningrad_profile). '
          + '비워 두면 그 인물은 이름만 표시됩니다. 에셋 이름은 봇 편집의 추가 에셋 탭에서 볼 수 있습니다.'));
        const dl = h('datalist', { id: 'scep-portrait-assets' });
        fold.appendChild(dl);
        if (ai && ai.getAssetSources) {
          const note = h('span', { class: 'sce-hint' }, '');
          fold.appendChild(h('div', { class: 'sce-row' },
            h('button', { class: 'sce-btn', onclick: async () => {
              try {
                const r = await ai.getAssetSources();
                const names = [...new Set((r?.sources || []).flatMap((s) => s.names || []))];
                dl.replaceChildren(...names.map((n) => h('option', { value: n })));
                note.textContent = `에셋 ${names.length}개 읽음 — 입력 칸에서 자동완성됩니다.`;
              } catch (e) { note.textContent = `에셋 읽기 실패 — ${e.message}`; }
            } }, '🔎 에셋 이름 불러오기 (자동완성용)'), note));
        }
        for (const nm of allNames) {
          fold.appendChild(h('div', { class: 'sce-row' },
            h('span', { class: 'sce-w-m' }, nm),
            (() => {
              const inp = bindInput(P.portraits?.[nm], (x) => {
                P.portraits = P.portraits || {};
                const t = String(x).trim();
                if (t) P.portraits[nm] = t; else delete P.portraits[nm];
                if (!Object.keys(P.portraits).length) delete P.portraits;
                rerender();
              }, { cls: 'sce-w-l', ph: '(에셋 이름 — 비우면 글자만)' });
              inp.setAttribute('list', 'scep-portrait-assets');
              return inp;
            })(),
          ));
        }
        wrap.appendChild(fold);
      }
    }

    wrap.appendChild(h('h4', {}, '팝업 커스텀 CSS (자동으로 팝업 범위로 제한됨 — 앱 UI를 못 깨뜨림)'));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '쓸 수 있는 클래스: .scg-card(카드) .scg-title(제목) .scg-slot(슬롯 상자) .scg-slot-label '
      + '.scg-slot-val(현재값) .scg-chip(후보 칩) .scg-chip.scg-on(현재 편성) .scg-chip.scg-locked(미보유) '
      + '.scg-roster(보유 줄). 슬롯·칩에는 data-slot / data-val 속성이 있어 인물별 색도 됩니다 — '
      + '예: .scg-chip[data-val="아린"] { border-color: gold; }'));
    wrap.appendChild(bindArea(P.css, (x) => { P.css = x || undefined; rerender(); },
      '.scg-card { background:#1a1030; border-color:#7a5cd0; }\n.scg-chip.scg-on { background:#7a5cd0; }'));

    wrap.appendChild(h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn sce-danger', onclick: () => { delete schema.party; rerender(); } }, '편성표 제거')));
    return wrap;
  }

  // ── 탭: 액션 ──────────────────────────────────────────────
  function tabActions() {
    const wrap = h('div');
    wrap.appendChild(tabAiTools('actions'));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '켜고 끄는 자리는 상태창 아래 범례다 — 클릭 조작(권한 1회)이 켜져 있으면 범례를 직접 누르고, '
      + '안 켜져 있으면 /액션 명령으로 토글한다 (예: /액션 공격). 라벨을 이모지로 시작하면 범례에서 알아보기 좋다 — 예: 🔥 화로 최대. '
      + '누르면 무장(ON)되고 다음 전송에 반영 — 1회성은 자동 OFF, 지속형은 끌 때까지 매 턴 적용. '
      + '(v0.55부터 우상단 플로팅 버튼은 없다 — 그 자리는 편성표 같은 게임 패널 버튼 몫이다.)'));
    schema.actions.forEach((a, i) => {
      wrap.appendChild(h('div', { class: 'sce-block' },
        h('div', { class: 'sce-row' },
          bindInput(a.id, (x) => { a.id = x.trim(); rerender(); }, { cls: 'sce-w-m', ph: '영문id' }),
          bindInput(a.label, (x) => { a.label = x; rerender(); }, { cls: 'sce-w-m', ph: '버튼 이름' }),
          bindSelect(a.mode ?? 'oneshot', [['oneshot', '1회성'], ['hold', '지속형']], (x) => { a.mode = x; rerender(); }),
          pair('쿨다운', bindInput(a.cooldown, (x) => { a.cooldown = numOrNull(x) ?? undefined; rerender(); }, { cls: 'sce-w-s', ph: '턴' })),
          grip(schema.actions, i, rerender),
        ),
        h('div', { class: 'sce-row' },
          pair('사용 조건', bindInput(a.when, (x) => { a.when = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '(비우면 항상 가능) turn >= 2' })),
          // 판정(check) — 이 버튼을 켠 턴에 그 판정을 굴려 [판정] 결과 줄을 서사에 함께 준다
          pair('판정', bindSelect(a.check ?? '',
            [['', '(없음)'], ...schema.checks.map((c) => [c.id, `${c.label || c.id} (${c.id})`])],
            (x) => { if (x) a.check = x; else delete a.check; rerender(); }),
            schema.checks.length
              ? '버튼을 켠 턴에 이 판정을 굴린다. 굴림식·등급은 [판정] 탭에서'
              : '아직 판정이 없다 — [판정] 탭에서 먼저 만들 것'),
        ),
        h('div', { class: 'sce-row' },
          pair('AI 전달문', bindInput(a.inject, (x) => { a.inject = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '[플레이어 액션] 영주는 특별 징세를 단행한다.' })),
        ),
        effectRows(schema, a.effects = a.effects || [], rerender),
      ));
    });
    wrap.appendChild(addBtn('액션 추가', () => { schema.actions.push({ id: 'action' + (schema.actions.length + 1), label: '', mode: 'oneshot', effects: [] }); rerender(); }));
    return wrap;
  }

  // ── 탭: 판정 ──────────────────────────────────────────────
  // "완벽 주사위" — 굴림은 엔진이 하고, AI는 결과를 받아 서사만 쓴다. 결과는 변수가 아니라
  // 시스템 기록(meta.lastCheck)에 남아 보조 AI가 건드릴 방법이 없고, 시드 굴림이라 리롤해도 같은 눈이다.
  function tabChecks() {
    const wrap = h('div');
    wrap.appendChild(tabAiTools('checks'));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '주사위 판정. 실행은 액션 버튼에 단다 — 아래 [🎲 액션 버튼 만들기]를 누르거나 [액션] 탭에서 '
      + '판정 칸에 고르면 된다. 버튼을 켠 턴에 시스템이 굴려 [판정] 결과 줄이 같은 턴 서사에 반영된다. '
      + '등급은 위에서부터 첫 매치 — 맨 마지막에 조건 없는 기본 등급을 둘 것. '
      + '등급의 조건·효과에서는 roll(굴린 눈)·mod(보정)·total(합계)·vs(목표치)를 그대로 쓸 수 있다. '
      + '결과는 AI가 못 건드리고, 리롤해도 같은 눈이 나온다.'));
    schema.checks.forEach((c, i) => {
      const hasBtn = (schema.actions || []).some((a) => a.check === c.id);
      const block = h('div', { class: 'sce-block' },
        h('div', { class: 'sce-row' },
          bindInput(c.id, (x) => { c.id = x.trim(); rerender(); }, { cls: 'sce-w-m', ph: '영문id (예: attack)' }),
          bindInput(c.label, (x) => { c.label = x; rerender(); }, { cls: 'sce-w-m', ph: '표시 이름 (예: 공격 판정)' }),
          grip(schema.checks, i, rerender),
        ),
        h('div', { class: 'sce-row' },
          pair('굴림식', bindInput(c.roll, (x) => { c.roll = x; rerender(); }, { cls: 'sce-w-m', ph: 'rand(1, 20)' }),
            '주사위 자체. rand()는 여기서만 허용된다. 이점 굴림은 adv ? max(rand(1,20), rand(1,20)) : rand(1,20) 식으로'),
          pair('보정식', bindInput(c.mod, (x) => { c.mod = String(x).trim() || undefined; rerender(); }, { cls: 'sce-w-m', ph: '(비우면 0) str_mod' }),
            '능력치 보너스. 변수·파생을 읽는다. rand 불가'),
          pair('목표치', bindInput(c.vs, (x) => {
            const t = String(x).trim();
            if (!t) { c.vs = undefined; } else { const n = Number(t); c.vs = isFinite(n) && String(n) === t ? n : t; }
            rerender();
          }, { cls: 'sce-w-s', ph: 'dc 또는 13' }),
            '넘어야 하는 값. 숫자나 수식. 비우면 목표치 없는 판정. 등급 조건에서 vs로 읽는다'),
        ),
      );
      c.grades = c.grades || [];
      c.grades.forEach((g, gi) => {
        block.appendChild(h('div', { class: 'sce-sub' },
          h('div', { class: 'sce-row' },
            pair('조건', bindInput(g.when, (x) => { g.when = String(x).trim() || undefined; rerender(); },
              { cls: 'sce-w-m', ph: '(비우면 항상 — 기본 등급) roll == 20' })),
            bindInput(g.label, (x) => { g.label = x; rerender(); }, { cls: 'sce-w-s', ph: '등급 이름' }),
            grip(c.grades, gi, rerender),
          ),
          effectRows(schema, g.effects = g.effects || [], rerender),
          h('div', { class: 'sce-row' },
            pair('연출 지시', bindInput(g.inject, (x) => { g.inject = x || undefined; rerender(); },
              { cls: 'sce-w-l', ph: '(선택) 이 등급일 때 AI에게 덧붙는 지시 — 예: 기대 이상의 성과를 극적으로 그려라.' })),
          ),
        ));
      });
      block.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn sce-add', style: 'flex:1', onclick: () => {
          c.grades.push({ label: '등급' + (c.grades.length + 1) });
          rerender();
        } }, '+ 등급'),
        h('button', { class: 'sce-btn', style: 'flex:1', disabled: hasBtn || undefined, onclick: () => {
          if ((schema.actions || []).some((a) => a.check === c.id)) return;
          const taken = new Set(schema.actions.map((a) => a.id));
          let id = 'roll_' + (c.id || 'check'), n = 2;
          while (taken.has(id)) id = 'roll_' + (c.id || 'check') + (n++);
          schema.actions.push({ id, label: '🎲 ' + (c.label || c.id || '판정'), mode: 'oneshot', check: c.id, effects: [] });
          rerender();
        } }, hasBtn ? '✓ 액션 버튼 있음' : '🎲 액션 버튼 만들기'),
      ));
      wrap.appendChild(block);
    });
    wrap.appendChild(addBtn('판정 추가', () => {
      schema.checks.push({
        id: 'check' + (schema.checks.length + 1), label: '', roll: 'rand(1, 20)', vs: 13,
        grades: [
          { when: 'roll == 20', label: '대성공' },
          { when: 'roll == 1', label: '대실패' },
          { when: 'total >= vs', label: '성공' },
          { label: '실패' },
        ],
      });
      rerender();
    }));
    return wrap;
  }

  // ── 탭: 시간 (설계: docs/design-시간.md) ──────────────────
  // 봇들이 손으로 다시 만들던 day/clock_h/sim_* 계열을 대체한다. 내부는 분 단위 정수
  // 하나(time_epoch)라 "정수 여러 개가 따로 노는" 날짜 사고가 구조적으로 안 난다.
  // day_advance·day_skip·clock_prev처럼 접두 파생형도 잡는다 (실측: 맨션봇의 자정 넘김 배선 3종)
  const LEGACY_TIME_RE = /^(days|date|hour|minute|week|weekday|month|year|season|time_of_day)$|^(day|clock)(_|$)|^sim_(year|month|dom|day|season|week)/;

  function tabTime() {
    const wrap = h('div');
    const legacy = schema.vars.filter((v) => LEGACY_TIME_RE.test(v.id));

    if (!schema.time) {
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '날짜·시각을 시스템이 관리하게 한다. 요일·윤년·월별 일수·자릿수(07:05)는 엔진이 계산하고, '
        + 'AI는 "며칠/몇 분 지났나"만 답한다 — 날짜 산술을 안 시킨다. '
        + '켜면 date · clock · weekday · season · month · dom · hour · elapsed 같은 이름을 '
        + '조건식({when})과 상태창({date})에서 변수처럼 바로 쓸 수 있다.'));
      if (legacy.length) {
        wrap.appendChild(h('div', { class: 'sce-hint' },
          `이 봇에는 손으로 만든 날짜 변수가 있습니다 (${legacy.map((v) => v.id).join(', ')}) — `
          + '켠 뒤 아래 정리 마법사로 걷어내면 노출 이름과의 충돌도 함께 풀립니다.'));
      }
      wrap.appendChild(addBtn('🕐 시간 체계 켜기', () => {
        schema.time = { start: '2026-01-01 09:00', advance: 'explicit', format: { date: 'YYYY-MM-DD', clock: 'HH:mm' } };
        rerender();
      }));
      return wrap;
    }

    const T = schema.time;
    T.format = T.format || {};
    const cfg = timeConfig(schema);

    // 시작 시점 미리보기 — 포맷·달력·요일 설정이 실제로 어떻게 보일지 그 자리에서 확인
    {
      const pv = exposedValues({ ...cfg, expose: EXPOSABLE }, cfg.startEpoch);
      wrap.appendChild(h('div', { class: 'sce-hint' },
        `시작 시점 미리보기: ${pv.date} (${pv.weekday}) ${pv.clock} · ${pv.season}`));
    }

    wrap.appendChild(h('div', { class: 'sce-row' },
      pair('시작 시점', bindInput(T.start, (x) => { T.start = x.trim(); rerender(); },
        { cls: 'sce-w-m', ph: '2026-04-01 07:30' }), '"YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm" — 실재하는 날짜여야 한다'),
      pair('진행', bindSelect(T.advance ?? 'explicit', [
        ['explicit', '명시적 — 버튼·보고로만'], ['perTurn', '턴마다 하루 (구형)'],
      ], (x) => { T.advance = x; rerender(); }),
        '명시적: skip_day/skip_min에 쌓인 만큼만 흐른다. 턴마다 하루: 메시지 하나 = 하루 (장면 단위 RP를 부수므로 생존물 외 비권장)'),
      pair('달력', bindSelect(T.calendar ?? 'gregorian', [
        ['gregorian', '그레고리력 (실제 달력·윤년)'], ['flat30', '판타지 — 한 달 30일 × 12달'],
      ], (x) => { T.calendar = x === 'gregorian' ? undefined : x; rerender(); })),
    ));
    wrap.appendChild(h('div', { class: 'sce-row' },
      pair('날짜 형식', bindInput(T.format.date, (x) => { T.format.date = x || undefined; rerender(); },
        { cls: 'sce-w-m', ph: 'YYYY-MM-DD' }), '토큰: YYYY YY MM M DD D — 예: "M월 D일", "YY/MM/DD"'),
      pair('시각 형식', bindInput(T.format.clock, (x) => { T.format.clock = x || undefined; rerender(); },
        { cls: 'sce-w-m', ph: 'HH:mm' }), '토큰: HH H mm m — 예: "H시 m분". 자릿수는 형식이 책임진다 (07:05)'),
    ));
    wrap.appendChild(h('div', { class: 'sce-row' },
      pair('요일', bindInput((T.weekdays || []).join(', '), (x) => {
        const a = x.split(',').map((s) => s.trim()).filter(Boolean);
        T.weekdays = a.length ? a : undefined; rerender();
      }, { cls: 'sce-w-l', ph: '월, 화, 수, 목, 금, 토, 일 (비우면 기본) — 첫 칸이 월요일' })),
      pair('계절', bindInput((T.seasons || []).join(', '), (x) => {
        const a = x.split(',').map((s) => s.trim()).filter(Boolean);
        T.seasons = a.length ? a : undefined; rerender();
      }, { cls: 'sce-w-l', ph: '봄, 여름, 가을, 겨울 (비우면 기본)' })),
    ));

    // 노출 이름 — 체크한 것만 조건식·상태창에서 변수처럼 열린다
    wrap.appendChild(h('h4', {}, '노출 이름 (조건식·상태창에서 변수처럼 쓴다)'));
    const exposeRow = h('div', { class: 'sce-row' });
    for (const n of EXPOSABLE) {
      exposeRow.appendChild(bindCheck(cfg.expose.includes(n), (on) => {
        const cur = new Set(cfg.expose);
        if (on) cur.add(n); else cur.delete(n);
        T.expose = EXPOSABLE.filter((k) => cur.has(k));
        rerender();
      }, `${EXPOSED_LABELS[n]}(${n})`));
    }
    wrap.appendChild(exposeRow);
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '예: 이벤트 조건 `dom == 1`(매달 1일), `weekday == "토"`, `hour >= 22`. '
      + '상태창 항목·템플릿에는 {date} {clock}처럼 꽂는다. 같은 이름의 변수가 있으면 검증이 알려 준다.'));

    // 진행 입구 — explicit이면 skip 변수가 있어야 시간이 흐른다
    if ((T.advance ?? 'explicit') === 'explicit') {
      wrap.appendChild(h('h4', {}, '진행 입구'));
      const hasDay = schema.vars.some((v) => v.id === SKIP_DAY);
      const hasMin = schema.vars.some((v) => v.id === SKIP_MIN);
      if (!hasDay && !hasMin) {
        wrap.appendChild(h('div', { class: 'sce-warn' },
          `⚠ ${SKIP_DAY}/${SKIP_MIN} 변수가 없어 시간이 흐를 입구가 없습니다.`));
        wrap.appendChild(addBtn(`진행 입구 만들기 — ${SKIP_DAY}·${SKIP_MIN} 변수 + AI 허용`, () => {
          schema.vars.push(
            { id: SKIP_DAY, label: '건너뛴 일수', type: 'int', init: 0, min: 0, max: 30,
              desc: '며칠 통째로 지났나. 같은 날 안이면 0. 자고 일어나 이튿날 아침이면 1. 2 이상은 "며칠 뒤"처럼 명시적으로 건너뛴 만큼만.' },
            { id: SKIP_MIN, label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 1440,
              desc: '이번 장면에서 흐른 시간(분). 대화 한 토막이면 5~20, 식사·외출이면 60~180. 날짜가 넘어가면 skip_day를 올리고 여기엔 그날 안에서 흐른 분만.' },
          );
          schema.updater.allow.push({ id: SKIP_DAY, maxGain: 7 }, { id: SKIP_MIN, maxGain: 720 });
          rerender();
        }));
        wrap.appendChild(h('div', { class: 'sce-hint' },
          '⚠ 진행 규칙은 변수의 "설명"(desc)에 산다 — 지시문(directives)은 메인 AI 전용이라 상태를 갱신하는 보조 AI가 못 읽는다.'));
      } else {
        wrap.appendChild(h('div', { class: 'sce-ok' },
          `✓ 진행 입구: ${[hasDay ? SKIP_DAY : null, hasMin ? SKIP_MIN : null].filter(Boolean).join(' · ')} `
          + '(엔진이 매 턴 소비 후 0으로 되돌린다)'));
        const hasEndDay = (schema.actions || []).some((a) =>
          (a.effects || []).some((f) => f.set === SKIP_DAY));
        if (hasDay && !hasEndDay) {
          wrap.appendChild(addBtn("🌙 '하루를 마친다' 액션 추가", () => {
            schema.actions.push({
              id: 'end_day', label: '🌙 하루를 마친다',
              effects: [{ set: SKIP_DAY, expr: '1' }, ...(hasMin ? [{ set: SKIP_MIN, expr: '0' }] : [])],
              inject: '[하루 마무리] 오늘은 여기까지다. 다음 서사는 이튿날 아침 장면으로 시작하라.',
            });
            rerender();
          }));
        }
      }
    }

    // 옛 날짜 변수 정리 — v0.45 정리 마법사 재사용 (참조까지 함께 걷는다)
    if (legacy.length) {
      wrap.appendChild(h('h4', {}, '옛 날짜 변수 정리'));
      wrap.appendChild(h('div', { class: 'sce-hint' },
        `손으로 만든 날짜 변수가 남아 있습니다: ${legacy.map((v) => `${v.id}(${v.label ?? ''})`).join(', ')} — `
        + '시간 체계와 겹치면 노출 이름 충돌이 나고, 안 겹쳐도 두 시계가 따로 돕니다.'));
      wrap.appendChild(addBtn('🧹 정리 마법사로 한꺼번에 지우기 (변수 탭에서 확인 후 적용)', () => {
        const ids = legacy.map((v) => v.id);
        const plan = planVarPurge(schema, ids);
        purge = { id: ids[0], label: ids.join(', '), plan };
        activeTab = 'vars';
        rerender();
      }));
    }

    wrap.appendChild(h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn sce-danger', onclick: () => { delete schema.time; rerender(); } }, '시간 체계 끄기'),
      h('span', { class: 'sce-hint' }, '꺼도 세이브의 time_epoch는 그대로 남는다 — 다시 켜면 이어진다.'),
    ));
    return wrap;
  }

  // ── 탭: 새 시작 ───────────────────────────────────────────
  function tabSetup() {
    const wrap = h('div');
    wrap.appendChild(tabAiTools('presets'));
    wrap.appendChild(h('h4', {}, '시작 프리셋 (플레이어가 고르는 난이도/배경 세트)'));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '새 채팅을 시작할 때 패널에서 한 번 누르는 버튼. 여기 적은 변수만 그 값으로 세팅되고 나머지는 시작값 그대로 간다. '
      + '값만 쓸 수 있고 수식은 안 된다. 난이도 이름을 붙였다면 [🔬 진단]에서 실제로 굴려 순서가 맞는지 확인할 것.'));
    schema.setup.presets.forEach((p, i) => {
      const block = h('div', { class: 'sce-block' });
      block.appendChild(h('div', { class: 'sce-row' },
        bindInput(p.id, (x) => { p.id = x.trim(); rerender(); }, { cls: 'sce-w-m', ph: '영문id' }),
        bindInput(p.label, (x) => { p.label = x; rerender(); }, { cls: 'sce-w-m', ph: '표시 이름' }),
        // 시간 체계가 켜져 있으면 시계도 시작값의 일부다 — "주말 오후에 시작" 같은 배경 프리셋용.
        // epoch은 set으로 못 건드리는 예약 키라 이 칸이 유일한 통로다.
        schema.time ? pair('시작 시점', bindInput(p.startAt, (x) => {
          p.startAt = x.trim() || undefined; rerender();
        }, { cls: 'sce-w-m', ph: `(비우면 ${schema.time.start})` }),
        '이 프리셋으로 시작할 때의 작중 날짜·시각. "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm"') : null,
        grip(schema.setup.presets, i, rerender),
      ));
      p.set = p.set || {};
      const entries = Object.entries(p.set);
      const sub = h('div', { class: 'sce-sub' });
      entries.forEach(([id, val], ei) => {
        sub.appendChild(h('div', { class: 'sce-row' },
          bindSelect(id, schema.vars.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`]), (nid) => {
            delete p.set[id]; p.set[nid] = val; rerender();
          }),
          h('span', {}, '='),
          bindInput(typeof val === 'string' ? val : JSON.stringify(val), (x) => {
            p.set[id] = smartVal(schema, id, x); rerender();
          }, { cls: 'sce-w-l' }),
          h('button', { class: 'sce-btn sce-mini sce-danger', onclick: () => { delete p.set[id]; rerender(); } }, '✕'),
        ));
      });
      sub.appendChild(addBtn('시작값', () => {
        const unused = schema.vars.find((v) => !(v.id in p.set));
        if (unused) { p.set[unused.id] = unused.init ?? 0; rerender(); }
      }));
      block.appendChild(sub);
      wrap.appendChild(block);
    });
    wrap.appendChild(addBtn('프리셋 추가', () => { schema.setup.presets.push({ id: 'preset' + (schema.setup.presets.length + 1), label: '', set: {} }); rerender(); }));

    const ai = schema.setup.ai;
    wrap.appendChild(h('h4', {}, 'AI 최초설정 (세션 0 — 첫 대화로 시작 상황을 정함)'));
    wrap.appendChild(h('div', { class: 'sce-row' },
      bindCheck(ai.enabled, (x) => { ai.enabled = x; rerender(); }, '사용'),
    ));
    if (ai.enabled) {
      ai.vars = ai.vars || [];
      wrap.appendChild(h('div', { class: 'sce-hint' }, 'AI가 정할 수 있는 변수 선택:'));
      const chips = h('div', { class: 'sce-chips' });
      for (const v of schema.vars) {
        chips.appendChild(bindCheck(ai.vars.includes(v.id), (on) => {
          if (on && !ai.vars.includes(v.id)) ai.vars.push(v.id);
          if (!on) ai.vars = ai.vars.filter((x) => x !== v.id);
          rerender();
        }, v.label ?? v.id));
      }
      wrap.appendChild(chips);
      wrap.appendChild(h('h4', {}, '설정 대화 중 메인 AI에게 줄 지침'));
      wrap.appendChild(bindArea(ai.instruction, (x) => { ai.instruction = x || undefined; rerender(); },
        '[최초 설정 진행 중] 유저와 함께 시작 상황을 정하는 대화를 하라...'));
      wrap.appendChild(h('h4', {}, '값 결정 가이드 (보조 AI용)'));
      wrap.appendChild(bindArea(ai.guide, (x) => { ai.guide = x || undefined; rerender(); },
        '유저가 명시한 값은 그대로, 나머지는 배경에 어울리게 정하라.'));
    }
    return wrap;
  }

  // ── 탭: AI 설정 (프롬프트 + 보조 모델) ────────────────────
  function tabAi() {
    const wrap = h('div');
    const ps = schema.promptState;
    wrap.appendChild(h('h4', {}, 'AI에게 매 턴 보낼 상태 요약 (자리표시자 {변수id})'));
    wrap.appendChild(bindArea(ps.template, (x) => { ps.template = x; rerender(); },
      '[영지 현황 — {turn}개월차]\\n자금 {gold}G | 식량 {food} ...'));
    wrap.appendChild(h('button', { class: 'sce-btn sce-add', onclick: () => {
      const line = (v) => {
        const name = v.label || v.id;
        if (v.format) return name + ' ' + v.format.replace('{v}', '{' + v.id + '}');
        return name + ' {' + v.id + '}';
      };
      ps.template = '[' + (schema.meta?.name ?? '현재 상태') + ']\n'
        + schema.vars.map(line).join(' | ')
        + (schema.derived.length ? '\n' + schema.derived.map(line).join(' | ') : '');
      rerender();
    } }, '⚡ 변수로 자동 생성 (지금 내용 덮어씀 — 생성 후 다듬기 권장)'));
    wrap.appendChild(h('div', { class: 'sce-row' },
      bindCheck(ps.includeEvents !== false, (x) => { ps.includeEvents = x; rerender(); }, '이벤트 통지 포함'),
      bindCheck(ps.eventPriority !== false, (x) => { ps.eventPriority = x ? undefined : false; rerender(); },
        '이벤트 우선 규칙 붙이기'),
    ));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '이벤트가 발동한 턴에만 "사건은 확정 사실, 유저 행동은 시도" 규칙이 자동으로 붙는다 — '
      + '서사가 이벤트를 무시해 수치와 어긋나는 걸 막는다. 아래에 직접 쓰면 그 문구로 대체된다.'));
    wrap.appendChild(bindArea(typeof ps.eventPriority === 'string' ? ps.eventPriority : '',
      (x) => { ps.eventPriority = x.trim() ? x : undefined; rerender(); },
      '(비우면 기본 문구 사용)'));
    wrap.appendChild(h('h4', {}, '메인 AI 지침 (비우면 기본: "수치는 시스템이 관리, 서사에 집중")'));
    wrap.appendChild(bindArea(ps.systemGuide, (x) => { ps.systemGuide = x || undefined; rerender(); }, ''));

    wrap.appendChild(h('h4', {}, '보조 AI에게 함께 보낼 최근 대화'));
    wrap.appendChild(h('div', { class: 'sce-row' },
      bindSelect(String(schema.updater.contextTurns ?? 1),
        [['1', '1턴 — 이번 턴만 (기본, 가장 저렴)'], ['2', '2턴'], ['3', '3턴 — 권장'], ['4', '4턴'], ['5', '5턴 — 맥락 최대, 토큰 많이 씀']],
        (x) => { const n = parseInt(x, 10); schema.updater.contextTurns = n > 1 ? n : undefined; rerender(); })));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '앞선 대화를 같이 보내면 "아까 준 선물" 같은 맥락을 보조 AI가 이해해 판단이 정확해진다. '
      + '다만 턴마다 토큰을 더 쓰고, 이미 반영한 변화를 다시 셀 위험도 조금 생긴다 (그러지 말라는 지시는 자동으로 붙는다).'));

    // 다음 행동 제안 (v0.43) — 보조 응답에 얹혀 오는 옵트인 기능. 스키마 키는 suggest 하나.
    wrap.appendChild(h('h4', {}, '다음 행동 제안'));
    if (!schema.suggest) {
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '켜면 매 턴 보조 AI가 "유저가 다음에 입력할 만한 행동" 2~4개를 만들어 입력창 위 조작줄에 칩으로 띄운다. '
        + '칩을 누르면 그 문장이 그대로 전송된다 (전송 권한 확인 1회, 거부해도 표시는 된다). '
        + '상태 갱신과 같은 보조 호출에 얹혀 가서 추가 호출 비용이 없다. 루아 브리지 모드에서는 아직 안 뜬다.'));
      wrap.appendChild(addBtn('다음 행동 제안 켜기', () => { schema.suggest = { count: 3 }; rerender(); }));
    } else {
      wrap.appendChild(h('div', { class: 'sce-row' },
        pair('개수', bindSelect(String(schema.suggest.count ?? 3), [['2', '2개'], ['3', '3개 (기본)'], ['4', '4개']],
          (x) => { schema.suggest.count = parseInt(x, 10); rerender(); })),
        h('button', { class: 'sce-btn sce-mini sce-danger', onclick: () => { delete schema.suggest; rerender(); } }, '제안 끄기'),
      ));
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '제안 지침 (선택) — 제안의 결을 정한다. 예: "공방 일과에 어울리는 행동으로, 하나는 뜻밖의 것을 섞어라."'));
      wrap.appendChild(bindArea(schema.suggest.guide, (x) => { schema.suggest.guide = x.trim() ? x : undefined; rerender(); }, '(비우면 기본 지침만)'));
    }

    wrap.appendChild(h('h4', {}, '보조 AI가 조정할 수 있는 변수와 한도'));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '숫자형은 턴당 최대 증감폭, 텍스트는 최대 글자수. 목록에 없는 변수는 AI가 절대 못 건드림.'));
    const allow = schema.updater.allow;
    allow.forEach((a, i) => {
      const def = schema.vars.find((v) => v.id === a.id);
      const row = h('div', { class: 'sce-row' },
        bindSelect(a.id, schema.vars.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`]), (x) => { a.id = x; rerender(); }),
      );
      if (def && (def.type === 'int' || def.type === 'float')) {
        row.append(
          pair('증가 한도', bindInput(a.maxGain ?? a.maxDelta, (x) => {
            const v2 = numOrNull(x);
            a.maxGain = v2 ?? undefined;
            if (a.maxLoss === undefined && a.maxDelta != null) a.maxLoss = a.maxDelta;
            delete a.maxDelta;
            rerender();
          }, { cls: 'sce-w-s', ph: '무제한' }),
            '보조 AI가 한 턴에 올릴 수 있는 최대치 — +5천만을 불러도 이 값까지만 적용'),
          pair('감소 한도', bindInput(a.maxLoss ?? a.maxDelta, (x) => {
            const v2 = numOrNull(x);
            a.maxLoss = v2 ?? undefined;
            if (a.maxGain === undefined && a.maxDelta != null) a.maxGain = a.maxDelta;
            delete a.maxDelta;
            rerender();
          }, { cls: 'sce-w-s', ph: '무제한' }),
            '한 턴에 잃을 수 있는 최대치'),
        );
      } else if (def && def.type === 'text') {
        row.append(pair('최대 글자', bindInput(a.maxLength, (x) => { a.maxLength = numOrNull(x) ?? undefined; rerender(); }, { cls: 'sce-w-s', ph: '기본 200' }),
          '비우면 기본 200자. 짧은 항목(장비 이름 등)은 30~50 권장'));
      }
      // 등장 낱말(mentions) — 켜면 그 말이 이번 턴 글에 있을 때만 보조 AI에게 열린다.
      // 켜기만 하고 낱말을 비우면 true(=변수 이름을 낱말로 씀). 인물 호감도는 label이 곧 이름이라 그게 맞다.
      const onMention = a.mentions != null;
      row.append(bindCheck(onMention, (on) => {
        if (on) a.mentions = true; else delete a.mentions;
        rerender();
      }, '등장할 때만'));
      if (onMention) {
        row.append(pair('낱말', bindInput(a.mentions === true ? '' : [].concat(a.mentions).join(', '),
          (x) => {
            const keys = String(x).split(',').map((s) => s.trim()).filter(Boolean);
            a.mentions = keys.length ? keys : true;
            rerender();
          }, { cls: 'sce-w-m', ph: def?.label ? `${def.label} (비우면 이 이름)` : '(비우면 변수 이름)' }),
          '이번 턴 서사에 이 말이 나왔을 때만 보조 AI가 이 변수를 볼 수 있다. 쉼표로 여러 개. '
          + '별명이 있으면 같이 적을 것 — 짧은 이름이 긴 이름 안에 들어 있으면 긴 쪽이 이긴다. '
          + '⚠ 채팅 언어의 낱말이어야 한다 — 영어로도 놀 봇이면 두 언어를 다 적을 것 (예: 골드, gold). '
          + '"골드"처럼 매 턴 상태창에 찍히는 단위 말은 넣지 말 것 (항상 열려서 잠금이 무의미해진다).'));
      }
      // 액션 잠금(whenArmed) — 그 액션이 무장·발동된 턴에만 보조 AI에게 열린다.
      // 낱말과 달리 채팅 언어와 무관·결정적. "개인 지갑 vs 가게 금고" 같은 이중 장부에 특효.
      {
        const actionOpts = (schema.actions || []).map((x) => x.id).join(', ');
        row.append(pair('액션 잠금', bindInput([].concat(a.whenArmed || []).join(', '),
          (x) => {
            const ids = String(x).split(',').map((s) => s.trim()).filter(Boolean);
            if (ids.length) a.whenArmed = ids.length === 1 ? ids[0] : ids; else delete a.whenArmed;
            rerender();
          }, { cls: 'sce-w-m', ph: '액션 id (비우면 잠금 없음)' }),
          '적으면 그 액션 버튼이 무장 중이거나 방금 발동된 턴에만 보조 AI가 이 변수를 고칠 수 있다. '
          + '쉼표로 여러 개 (하나만 무장돼도 열림). 낱말 잠금과 달리 어떤 언어로 채팅해도 똑같이 작동한다. '
          + '돈처럼 AI가 자꾸 멋대로 만지는 변수에 걸어두면, 유저가 버튼을 켠 턴에만 움직인다.'
          + (actionOpts ? ` 현재 액션: ${actionOpts}` : ' (⚠ 아직 액션이 없다 — [액션] 탭에서 먼저 만들 것)')));
      }
      row.appendChild(grip(allow, i, rerender));
      wrap.appendChild(h('div', { class: 'sce-block' }, row));
    });
    wrap.appendChild(addBtn('허용 변수', () => {
      const unused = schema.vars.find((v) => !allow.some((a) => a.id === v.id));
      allow.push({ id: (unused ?? schema.vars[0])?.id ?? '', maxDelta: unused?.type === 'int' ? 100 : undefined });
      rerender();
    }));
    const missingAllow = schema.vars.filter((v) => !allow.some((a) => a.id === v.id));
    if (missingAllow.length) {
      wrap.appendChild(h('button', { class: 'sce-btn sce-add', onclick: () => {
        for (const v of missingAllow) {
          const entry = { id: v.id };
          if (v.type === 'text') entry.maxLength = v.maxLength;
          allow.push(entry);
        }
        rerender();
      } }, `⚡ 빠진 변수 모두 추가 (${missingAllow.length}개 — 숫자 한도는 직접 채우는 걸 권장)`));
    }
    wrap.appendChild(h('h4', {}, '보조 AI 추가 지시'));
    wrap.appendChild(bindArea(schema.updater.guide, (x) => { schema.updater.guide = x || undefined; rerender(); },
      '서사에 명시된 변화만 반영...'));
    return wrap;
  }

  // ── 탭: JSON ──────────────────────────────────────────────
  // ② AI 왕복 패치 상태 — 탭을 옮겨도 유지된다 (진단 탭의 diagResult와 같은 이유)
  let patchText = '';      // 붙여넣은 패치 원문
  let patchPlan = null;    // [패치 검사] 결과 { patch, plan } — 적용 전 계획
  let patchChoices = {};   // 충돌 해소 선택('cf:키'), 개명 id('rn:키'), 삭제 체크('rm:섹션:id')
  let patchBackup = null;  // 적용 직전 스키마 — 되돌리기 1슬롯
  let patchReport = null;  // 마지막 적용 내역 (rerender를 넘어 보여줘야 해서 상태로)

  // ── 위층 (AI에게 맡기기) 상태 — docs/design-내장-AI-생성.md ──
  let aiReq = '';           // 요청 문구
  let aiCtxOn = true;       // 봇 설명·로어북 동봉 여부
  let aiBotCtx;             // getBotContext 결과 캐시 (undefined = 아직 안 읽음, null = 못 읽음)
  let aiGenModel;           // 생성 모델 선택 캐시 { choice, staticId } (undefined = 아직 안 읽음)
  let aiModelIds;           // 리수 DB의 모델 id { main, sub } (undefined = 미시도, null = 못 읽음)
  let aiGen = { busy: false, seq: 0, note: null, raw: null }; // 생성 진행·실패 상태 (seq로 취소 판별)
  let aiFull = null;        // 통짜 생성 결과 대기 { schema, warnings } — 반영 전 확인
  let aiFullReport = null;  // 통짜 반영 내역 문구
  let patchSource = 'json'; // 패치 계획·적용 UI를 어느 층에 그릴까: 'top'(위층 생성) | 'json'(② 붙여넣기)
  // 삼층 구조의 접힘 상태 — rerender에도 유지
  let jsonOpen = false;     // 2층 (JSON 작업대)
  let lowerOpen = false;    // 3층 (심층 편집 탭 8개)

  // 2·3층의 복붙 도구 곁에서 "복붙 없이 하려면 이쪽" — 입구는 1층 하나로 유지하고 이동만 공짜로.
  // (같은 다이렉트 버튼을 층마다 또 깔면 접근성 진단 때의 'AI 입구 13개' 문제로 되돌아간다)
  function jumpToMake() {
    topTab = 'make';
    if (floorView && onRequestFloor) { onRequestFloor('top'); return; } // 호스트가 사이드바와 함께 전환
    if (floorView) floorView = 'top';
    rerender();
  }

  function jumpRow(hint) {
    return h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn sce-mini', onclick: () => jumpToMake() }, '✨ 말로 시키기'),
      h('span', { class: 'sce-hint', style: 'margin:0' }, hint));
  }

  async function fetchBotCtx() {
    if (aiBotCtx !== undefined) return aiBotCtx;
    if (!ai || !ai.getBotContext) { aiBotCtx = null; return null; }
    try { aiBotCtx = (await ai.getBotContext()) || null; } catch { aiBotCtx = null; }
    return aiBotCtx;
  }

  // diag = { findings, stats } — 진단 결과에서 바로 부를 때. 요청 문구 대신 문제 목록이 실린다.
  async function runAiGenerate(diag = null) {
    if (!ai || !ai.generate || aiGen.busy) return;
    const req = aiReq.trim();
    if (!diag && !req) { aiGen.note = '먼저 위 칸에 원하는 걸 적어주세요.'; rerender(); return; }
    const mySeq = ++aiGen.seq;
    aiGen.busy = true; aiGen.note = null; aiGen.raw = null;
    aiFull = null; aiFullReport = null;
    rerender();

    let ctxText = '';
    if (aiCtxOn) ctxText = assembleBotContext(await fetchBotCtx()).text;
    if (aiGen.seq !== mySeq || destroyed) return;

    const blank = !diag && schemaIsBlank(schema); // 진단은 스키마가 있어야 돌았으니 항상 패치 모드
    const stripFence = (raw) => {
      const m = String(raw).trim().match(/```(?:json)?\s*([\s\S]*?)```/);
      return (m ? m[1] : String(raw)).trim();
    };
    // 응답 검사 — 패치는 parsePatch+planPatch, 통짜는 JSON+validateSchema까지 통과해야 합격.
    // 불합격이어도 안전하다는 게 이 설계의 핵심 — 쓰레기는 여기서 멈추고 스키마는 안 변한다.
    const inspect = (text) => {
      if (blank) {
        let obj;
        try { obj = JSON.parse(stripFence(text)); }
        catch (e) { return { ok: false, errors: ['JSON 파싱 실패: ' + e.message] }; }
        const v = validateSchema(obj);
        if (!v.ok) return { ok: false, errors: v.errors.map((e) => `${e.path} — ${e.msg}`) };
        return { ok: true, full: { schema: obj, warnings: v.warnings } };
      }
      const p = patchMod.parsePatch(text);
      if (!p.ok) return { ok: false, errors: p.errors };
      const plan = patchMod.planPatch(schema, p.patch);
      if (plan.errors.length) return { ok: false, errors: plan.errors };
      return { ok: true, patch: p.patch, plan };
    };

    const prompt = diag
      ? buildPatchExportPrompt(schema, { findings: diag.findings, stats: diag.stats, botCtx: ctxText })
      : buildAiRequestPrompt(schema, req, ctxText);
    let fatal = null, text = null, got = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = attempt === 0 ? prompt
        // 형식 불합격 1회 자동 재시도 — 오류를 첨부해 다시 (aux JSON 재시도와 같은 규율)
        : prompt + '\n\n──\n방금 응답이 형식 검사에서 거부되었습니다:\n'
          + got.errors.slice(0, 8).map((e) => '- ' + e).join('\n')
          + '\n설명 없이, 형식에 맞는 JSON 하나만 다시 출력하세요.';
      let res = null;
      try { res = await ai.generate(p); } catch (e) { res = { error: '호출 예외: ' + e.message }; }
      if (aiGen.seq !== mySeq || destroyed) return; // 취소됨 — 결과를 버린다
      if (typeof res !== 'string' || !res.trim()) {
        fatal = res && res.blocked ? 'blocked'
          : { msg: (res && res.error) || '원인 불명 — 콘솔(F12)의 [simcore] 생성 호출 로그를 확인하세요' };
        break;
      }
      text = res;
      got = inspect(res);
      if (got.ok) break;
    }

    aiGen.busy = false;
    if (fatal === 'blocked') {
      aiGen.note = '⚠ 이 환경은 플러그인의 LLM 직접 호출이 차단되어 있습니다 — [📋 복사해서 다른 AI에게]로 우회하세요.';
    } else if (fatal) {
      aiGen.note = '⚠ 생성 호출 실패 — ' + fatal.msg
        + ' · 생성 모델을 바꾸거나 [📋 복사해서 다른 AI에게]를 쓰세요.';
    } else if (!got.ok) {
      aiGen.note = '⚠ 두 번 모두 형식 검사를 통과하지 못했습니다 — 보조 모델이 이 작업에는 약할 수 있습니다. '
        + '아래 원문을 확인하거나, [📋 복사해서 다른 AI에게]로 더 강한 모델에 맡기세요. 첫 오류: ' + got.errors[0];
      aiGen.raw = text;
    } else if (blank) {
      aiFull = got.full; // 반영은 사람이 누른다 — 요약·경고를 보여주고 확인받는다
    } else {
      patchText = text;
      patchPlan = { patch: got.patch, plan: got.plan };
      patchChoices = {};
      patchSource = 'top';
    }
    topTab = 'make'; // 계획·실패 안내가 창작 탭에 뜬다 — 진단 탭에서 시켰어도 결과가 보이게
    rerender();
  }

  // ── 1층 결과 창구 — 만들었으면 바로 눈으로 확인한다 (미리보기·CSS·도감) ──
  // 접기 나열은 전부 같은 줄 모양이라 스캔이 안 된다는 피드백 → 1층 안을 3탭으로 (창작/결과/진단)
  let topTab = 'make';      // 'make' | 'result' | 'diag'
  let cssReq = '';          // 꾸미기 요청 문구 (분위기·배치)
  let cssMode = 'skin';     // 'skin' = customCSS만 | 'layout' = 커스텀 템플릿 통째
  let cssGen = { busy: false, seq: 0, note: null };
  let cssBackup = null;     // { mode, template, customCSS } — 꾸미기 적용 직전 상태 (되돌리기 1슬롯)

  function statusPreviewEl(uid) {
    // uid는 채팅 메시지 번호·다른 미리보기와 겹치지 않게 — 접기 상태가 서로를 건드리면 안 된다
    const pv = h('div', { class: 'sce-preview' });
    try {
      const v = validateSchema(schema);
      if (v.ok) {
        pv.innerHTML = renderStatusHtml(schema, engine.initState(schema), null,
          (schema.actions || []).map((a) => ({ id: a.id, label: a.label ?? a.id, armed: false })),
          { includeStyle: true, uid });
      } else {
        pv.textContent = '스키마 오류를 먼저 해결하면 미리보기가 표시됩니다';
        pv.className += ' sce-warn';
      }
    } catch (e) {
      pv.textContent = '미리보기 실패: ' + e.message;
    }
    return pv;
  }

  async function runCssGenerate() {
    if (!ai || !ai.generate || cssGen.busy) return;
    const layout = cssMode === 'layout';
    const mySeq = ++cssGen.seq;
    cssGen.busy = true; cssGen.note = null;
    rerender();
    let res = null;
    try {
      res = await ai.generate(layout ? buildLayoutSpecPrompt(schema, cssReq) : buildCssSpecPrompt(schema, cssReq));
    } catch (e) { res = { error: '호출 예외: ' + e.message }; }
    if (cssGen.seq !== mySeq || destroyed) return;
    cssGen.busy = false;
    topTab = 'result'; // 적용 결과·실패 안내가 결과 탭에 뜬다
    if (typeof res !== 'string' || !res.trim()) {
      cssGen.note = res && res.blocked
        ? '⚠ 이 환경은 LLM 직접 호출이 차단되어 있습니다 — [📋 규격 복사]로 우회하세요.'
        : '⚠ 호출 실패 — ' + ((res && res.error) || '원인 불명') + ' · 생성 모델을 바꾸거나 [📋 규격 복사]를 쓰세요.';
      rerender(); return;
    }
    const ui = schema.statusUI;
    const takeBackup = () => { cssBackup = { mode: ui.mode, template: ui.template, customCSS: ui.customCSS }; };

    if (!layout) {
      let css = res.trim();
      const m = css.match(/```(?:css)?\s*([\s\S]*?)```/);
      if (m) css = m[1].trim();
      css = css.replace(/<\/?style[^>]*>/g, '').trim(); // <style> 껍데기째 주는 모델 방어
      if (!css || !css.includes('{')) {
        cssGen.note = '⚠ CSS로 보이지 않는 응답입니다 — 앞부분: ' + css.slice(0, 80);
        rerender(); return;
      }
      // 적용은 즉시, 안전은 이중으로 — 스코핑(.sim-status 제한)은 렌더러가 자동으로 하고, 되돌리기 1슬롯
      takeBackup();
      ui.customCSS = css;
      cssGen.note = '✅ 적용됐습니다 — 아래 미리보기가 새 스킨입니다.';
      rerender(); return;
    }

    // 배치까지 — 커스텀 템플릿 통째. <style>은 렌더러가 자동 분리·격리하므로 통으로 넣는다.
    let tpl = res.trim();
    const mh = tpl.match(/```(?:html)?\s*([\s\S]*?)```/);
    if (mh) tpl = mh[1].trim();
    if (!/[<][a-zA-Z]/.test(tpl)) {
      cssGen.note = '⚠ HTML 템플릿으로 보이지 않는 응답입니다 — 앞부분: ' + tpl.slice(0, 80);
      rerender(); return;
    }
    // 원자 적용 — 자리표시자 계약은 검증기가 지킨다. 새 오류가 생기면 통째로 되돌린다.
    const beforeErrs = new Set(validateSchema(schema).errors.map((e) => e.path + '|' + e.msg));
    takeBackup();
    ui.mode = 'template';
    ui.template = tpl;
    const after = validateSchema(schema);
    const fresh = after.errors.filter((e) => !beforeErrs.has(e.path + '|' + e.msg));
    if (fresh.length) {
      ui.mode = cssBackup.mode; ui.template = cssBackup.template; ui.customCSS = cssBackup.customCSS;
      cssBackup = null;
      cssGen.note = '⚠ 생성된 템플릿이 검증에서 거부됐습니다 (스키마는 안 바뀜) — '
        + fresh.slice(0, 3).map((e) => e.msg).join(' / ')
        + '. 다시 시키거나 더 강한 생성 모델을 쓰세요.';
      rerender(); return;
    }
    cssGen.note = '✅ 배치가 적용됐습니다 — 아래 미리보기가 새 상태창입니다. 세부 수정은 3층 상태창 탭에서.';
    rerender();
  }

  function catalogView() {
    const wrap = h('div');
    const fmtE = (e) => {
      if (e == null || typeof e !== 'object') return String(e);
      if (e.set) return `${e.set} ← ${e.expr}`;
      if (e.list) {
        const ops = [];
        if (e.add) ops.push(`추가 ${JSON.stringify(e.add)}`);
        if (e.remove) ops.push(`제거 ${JSON.stringify(e.remove)}`);
        if (e.expire) ops.push(`기한만료 기준 ${e.expire}`);
        return `목록 ${e.list}: ${ops.join(', ') || '(변경 없음)'}`;
      }
      return JSON.stringify(e);
    };
    const line = (icon, title, subs) => h('div', { style: 'margin:2px 0 8px' },
      h('div', {}, `${icon} ${title}`),
      ...subs.filter(Boolean).map((s) => h('div', { class: 'sce-hint', style: 'margin:0 0 0 20px' }, s)));

    const evs = schema.rules.events || [];
    const rndChance = schema.rules.randomEvents?.chancePerTurn || 0;
    const rnd = schema.rules.randomEvents?.table || [];
    if (evs.length + rnd.length) {
      wrap.appendChild(h('h4', {}, `이벤트 ${evs.length + rnd.length}개`));
      for (const e of evs) wrap.appendChild(line('⚡', `${e.id}${e.once ? ' — 딱 한 번' : ''}`, [
        e.when ? `발동: ${e.when}` : null,
        (e.effects || []).length ? `효과: ${e.effects.map(fmtE).join(' · ')}` : null,
        e.notify ? `통지: ${e.notify}` : null,
      ]));
      for (const e of rnd) wrap.appendChild(line('🎲', `${e.id} — 랜덤${rndChance ? ` (턴당 ${Math.round(rndChance * 100)}%)` : ''}`, [
        e.when ? `조건: ${e.when}` : null,
        (e.effects || []).length ? `효과: ${e.effects.map(fmtE).join(' · ')}` : null,
        e.notify ? `통지: ${e.notify}` : null,
      ]));
    }
    if ((schema.actions || []).length) {
      wrap.appendChild(h('h4', {}, `액션 ${schema.actions.length}개`));
      for (const a of schema.actions) wrap.appendChild(line('🔘', `${a.label ?? a.id}${a.mode ? ` (${a.mode})` : ''}`, [
        a.when ? `조건: ${a.when}` : null,
        (a.effects || []).length ? `효과: ${a.effects.map(fmtE).join(' · ')}` : null,
        a.check ? `연결 판정: ${a.check}` : null,
        a.inject ? `서사 지시: ${a.inject}` : null,
      ]));
    }
    if ((schema.checks || []).length) {
      wrap.appendChild(h('h4', {}, `판정 ${schema.checks.length}개`));
      for (const c of schema.checks) wrap.appendChild(line('🎯', c.label ?? c.id, [
        `굴림: ${c.roll}`,
        (c.grades || []).length ? `${c.grades.length}단계: ${c.grades.map((g) => g.label ?? '(이름 없음)').join(' / ')}` : null,
      ]));
    }
    if ((schema.directives || []).length) {
      wrap.appendChild(h('h4', {}, `지시문 ${schema.directives.length}개`));
      for (const d of schema.directives) wrap.appendChild(line('📣', d.id, [
        d.when ? `켜짐: ${d.when}` : null,
        d.text ? `지시: ${d.text}` : null,
      ]));
    }
    if ((schema.rules.onTurn || []).length) {
      wrap.appendChild(h('h4', {}, '매 턴 정산'));
      wrap.appendChild(line('🔁', `${schema.rules.onTurn.length}건`,
        schema.rules.onTurn.map((e) => fmtE(e))));
    }
    if (!wrap.childNodes.length) {
      wrap.appendChild(h('div', { class: 'sce-hint' }, '아직 만들어진 이벤트·액션·판정이 없습니다 — 위 입력창에 시켜보세요.'));
    }
    return wrap;
  }

  function topFloor() {
    const box = h('div', { class: 'sce-block sce-top' });
    box.appendChild(h('h4', { style: 'margin-top:2px' }, '✨ AI에게 맡기기'));
    const blank = schemaIsBlank(schema);

    // 1층 내부 탭 — 창작(시키기) / 결과(보기) / 진단(굴리기). 빈 스키마는 보여줄 결과가 없어 창작만.
    if (!blank) {
      const diagCnt = diagResult && diagResult.findings
        ? diagResult.findings.filter((f) => f.sev !== 'low').length : null;
      const bar = h('div', { class: 'sce-tabs' });
      for (const [key, label] of [
        ['make', `✍ 창작${aiGen.busy ? ' ⏳' : (patchSource === 'top' && patchPlan) ? ' ●' : ''}`],
        ['result', '👁 결과'],
        ['diag', `🔬 진단${diagCnt != null ? ` (${diagCnt})` : ''}`],
      ]) {
        bar.appendChild(h('button', {
          class: 'sce-tab' + (topTab === key ? ' on' : ''),
          onclick: () => { topTab = key; render(); },
        }, label));
      }
      box.appendChild(bar);
    }

    // 👁 결과 — 상태창 미리보기 + CSS 커스텀 + 만들어진 것들 도감
    if (!blank && topTab === 'result') {
      box.appendChild(h('div', { class: 'sce-hint' },
        '지금 스키마가 그리는 상태창입니다 — 창작·심층 어디서 고치든 즉시 갱신됩니다.'));
      box.appendChild(statusPreviewEl('pv1'));
      // 꾸미기 — 스킨(색·폰트)과 배치(템플릿 통째) 둘 다 자동화 영역. 손조립은 3층 몫.
      const layoutMode = cssMode === 'layout';
      const cssRow = h('div', { class: 'sce-row' });
      cssRow.appendChild(bindSelect(cssMode, [
        ['skin', '🎨 스킨만 — 색·폰트·질감'],
        ['layout', '🖼 배치까지 — 템플릿 통째'],
      ], (x) => { cssMode = x; rerender(); }));
      cssRow.appendChild(bindInput(cssReq, (x) => { cssReq = x; },
        { cls: 'sce-w-l', ph: layoutMode
          ? '원하는 배치·분위기 — 예: 왼쪽 칭호 칸, 오른쪽 수치 2열, 하단 계약 칩'
          : '원하는 분위기 — 예: 낡은 신문지 느낌, 세리프 폰트, 붉은 도장 포인트' }));
      if (ai && ai.generate) {
        cssRow.appendChild(cssGen.busy
          ? h('button', { class: 'sce-btn', onclick: () => { cssGen.seq++; cssGen.busy = false; rerender(); } }, '✋ 취소')
          : h('button', { class: 'sce-btn', onclick: () => runCssGenerate() }, layoutMode ? '🖼 생성' : '🎨 생성'));
      }
      if (cssBackup) {
        cssRow.appendChild(h('button', { class: 'sce-btn', onclick: () => {
          schema.statusUI.mode = cssBackup.mode;
          schema.statusUI.template = cssBackup.template;
          schema.statusUI.customCSS = cssBackup.customCSS;
          cssBackup = null; cssGen.note = null; rerender();
        } }, '↩ 꾸미기 되돌리기'));
      }
      box.appendChild(cssRow);
      if (!layoutMode && schema.statusUI.mode === 'template') {
        box.appendChild(h('div', { class: 'sce-warn' },
          '⚠ 이 봇은 커스텀 템플릿을 쓰고 있어 스킨 CSS(자동 배치 클래스 기준)가 힘을 못 씁니다 — [🖼 배치까지]를 쓰세요.'));
      }
      if (cssGen.busy) box.appendChild(h('div', { class: 'sce-hint' }, layoutMode ? '⏳ 배치 생성 중… (수십 초 걸릴 수 있음)' : '⏳ CSS 생성 중…'));
      else if (cssGen.note) box.appendChild(h('div', { class: cssGen.note.startsWith('✅') ? 'sce-hint' : 'sce-warn' }, cssGen.note));
      copyWidget(layoutMode ? '📋 배치 규격 복사' : '📋 CSS 규격 복사',
        layoutMode
          ? '배치 요청과 자리표시자 계약이 담긴 규격서를 복사합니다 — 웹 AI에게 주고, 받은 HTML은 '
            + '3층 상태창 탭에서 표시 방식을 커스텀으로 바꾼 뒤 템플릿 칸에 통째로 붙여넣으세요 (<style> 자동 분리).'
          : '분위기 문구와 이 봇의 실제 상태창 구조가 담긴 규격서를 복사합니다 — 웹 AI에게 주고, '
            + '받은 CSS는 3층 상태창 탭의 커스텀 CSS 칸에 붙여넣으세요.',
        () => (cssMode === 'layout' ? buildLayoutSpecPrompt(schema, cssReq) : buildCssSpecPrompt(schema, cssReq))).mount(box);
      box.appendChild(h('h4', {}, '📖 만들어진 것들 — 이벤트·액션·판정 한눈에'));
      box.appendChild(catalogView());
      return box;
    }

    // 🔬 진단 — 굴려서 찾고, 고쳐달라기는 창작 탭 계획 상자로 이어진다
    if (!blank && topTab === 'diag') {
      box.appendChild(tabDiag());
      return box;
    }

    box.appendChild(h('div', { class: 'sce-hint' },
      blank
        ? '아직 스키마가 없습니다 — 원하는 봇을 말하면 AI가 통째로 만들어 옵니다. 검증을 통과해야만 반영되니 부담 없이 시키세요.'
        : '원하는 걸 말하면 바꿀 부분만 담은 패치가 옵니다 — 적용 전에 계획을 보여주고, 충돌이 있으면 멈춰서 물어봅니다.'));

    // 통짜 생성 결과 — 반영 전 확인 상자
    if (aiFull) {
      const s2 = aiFull.schema;
      const cnt = (a) => (a || []).length;
      const summary = `변수 ${cnt(s2.vars)} · 이벤트 ${cnt(s2.rules && s2.rules.events)
        + cnt(s2.rules && s2.rules.randomEvents && s2.rules.randomEvents.table)}`
        + ` · 액션 ${cnt(s2.actions)} · 판정 ${cnt(s2.checks)} · 지시문 ${cnt(s2.directives)}`;
      const warns = (aiFull.warnings || []).map((w) => h('div', { class: 'sce-warn' }, `⚠ ${w.path} — ${w.msg}`));
      box.appendChild(h('div', { class: 'sce-block' },
        h('div', {}, `📦 스키마가 도착했습니다 — ${summary}`),
        ...(warns.length > 3
          ? [h('details', { class: 'sce-fold' },
              h('summary', { class: 'sce-warn' }, `⚠ 경고 ${warns.length}건 — 눌러서 펼치기`), ...warns)]
          : warns),
        h('div', { class: 'sce-row' },
          h('button', { class: 'sce-btn sce-add', style: 'width:auto', onclick: () => {
            patchBackup = JSON.parse(JSON.stringify(schema));
            schema = aiFull.schema;
            aiFullReport = `✅ 생성된 스키마를 반영했습니다 — ${summary}. 아래층 탭에서 세부를 다듬을 수 있습니다.`;
            aiFull = null;
            lowerOpen = true; // 무엇이 생겼는지 바로 보이게
            rerender();
          } }, '✅ 편집기에 반영'),
          h('button', { class: 'sce-btn', onclick: () => { aiFull = null; rerender(); } }, '버리기'),
        )));
    }
    if (aiFullReport) {
      box.appendChild(h('div', { class: 'sce-block' },
        h('div', {}, aiFullReport),
        h('div', { class: 'sce-row' },
          patchBackup ? h('button', { class: 'sce-btn', onclick: () => {
            schema = patchBackup; patchBackup = null; aiFullReport = null; rerender();
          } }, '↩ 되돌리기 (반영 전으로)') : null,
          h('button', { class: 'sce-btn', onclick: () => { aiFullReport = null; rerender(); } }, '확인'),
        )));
    }

    const area = h('textarea', { style: 'min-height:64px',
      placeholder: blank
        ? '예: 겨울 영지 경영 봇. 식량·민심·온기를 추적하고, 식량이 떨어지면 폭동이 일어나게'
        : '예: 산적 습격 이벤트 추가해줘. 경계가 5 이상이면 발동하고 금화를 뺏기게' });
    area.value = aiReq;
    area.oninput = () => { aiReq = area.value; };
    box.appendChild(area);

    // 프리셋 칩 — 검증 오류가 있으면 그걸 고쳐달라는 요청을 한 번에 채운다
    if (!blank) {
      const v0 = validateSchema(schema);
      if (v0.errors.length) {
        box.appendChild(h('div', { class: 'sce-row' },
          h('button', { class: 'sce-btn sce-mini', onclick: () => {
            aiReq = '아래 검증 오류를 전부 고쳐줘:\n' + v0.errors.map((e) => `- ${e.path} — ${e.msg}`).join('\n');
            area.value = aiReq;
          } }, `🩹 검증 오류 ${v0.errors.length}건 고쳐달라고 적기`)));
      }
    }

    // 봇 컨텍스트 동봉 + 전송 크기 실측 (copyWidget이 이미 하는 것과 같은 예의)
    const ctxLine = h('div', { class: 'sce-row' });
    const renderCtxLine = () => {
      ctxLine.replaceChildren();
      if (!ai || !ai.getBotContext) return;
      if (aiBotCtx === undefined) { ctxLine.appendChild(h('span', { class: 'sce-hint' }, '봇 설정 읽는 중…')); return; }
      const a = assembleBotContext(aiBotCtx);
      if (a.text) {
        ctxLine.appendChild(bindCheck(aiCtxOn, (x) => { aiCtxOn = x; renderCtxLine(); },
          `봇 설명·로어북 함께 보냄 (${(a.bytes / 1024).toFixed(1)}KB${a.truncated ? ' — 상한 20KB 초과분은 생략' : ''})`));
      } else {
        ctxLine.appendChild(h('span', { class: 'sce-hint' }, '동봉할 봇 설명·로어북이 없습니다 — 요청 문구만 보냅니다.'));
      }
      const total = byteLen(buildAiRequestPrompt(schema, aiReq, aiCtxOn && a.text ? a.text : ''));
      ctxLine.appendChild(h('span', { class: 'sce-hint' }, `· 요청서 전체 약 ${Math.max(1, Math.round(total / 1024))}KB`));
    };
    renderCtxLine();
    fetchBotCtx().then(() => { if (!destroyed) renderCtxLine(); });
    box.appendChild(ctxLine);

    // 생성 모델 슬롯 — 보조는 번역·요약용 싼 모델이 꽂힌 자리라, 스키마 생성엔 급이 다른
    // 모델이 필요할 수 있다. 어느 걸로 쏠지는 유저가 고른다 (기기 로컬 저장, 어댑터 몫).
    if (ai && ai.getGenModel && ai.setGenModel) {
      const gmLine = h('div', { class: 'sce-row' });
      const renderGmLine = () => {
        gmLine.replaceChildren();
        if (aiGenModel === undefined) return;
        const save = () => ai.setGenModel({ choice: aiGenModel.choice, staticId: aiGenModel.staticId });
        gmLine.appendChild(h('span', { class: 'sce-hint', style: 'margin:0' }, '생성 모델:'));
        gmLine.appendChild(bindSelect(aiGenModel.choice, [
          ['aux', '보조 모델 (기본)'],
          ['main', '메인 모델 (대화용 그대로)'],
          ['static', '직접 지정 (실험적)'],
        ], (x) => { aiGenModel.choice = x; save(); renderGmLine(); }));
        if (aiGenModel.choice === 'static') {
          gmLine.appendChild(bindInput(aiGenModel.staticId, (x) => { aiGenModel.staticId = x.trim(); save(); },
            { cls: 'sce-w-m', ph: '모델 id', title: '리수가 이 id를 모르면 보조 모델로 조용히 폴백됩니다' }));
          // 설정 화면은 표시명만 보여줘서 id를 손으로 알 수 없다 — 리수 DB에서 직접 읽어다 채운다
          if (ai.getModelIds && aiModelIds === undefined) {
            gmLine.appendChild(h('button', { class: 'sce-btn sce-mini', onclick: () => {
              Promise.resolve(ai.getModelIds()).then((v) => { aiModelIds = v || null; })
                .catch(() => { aiModelIds = null; })
                .then(() => { if (!destroyed) renderGmLine(); });
            } }, '🔎 리수에서 id 읽기'));
          } else if (aiModelIds) {
            for (const [k, label] of [['main', '메인'], ['sub', '보조']]) {
              const id = aiModelIds[k];
              if (!id) continue;
              gmLine.appendChild(h('button', { class: 'sce-btn sce-mini', title: id, onclick: () => {
                aiGenModel.staticId = id; save(); renderGmLine();
              } }, `${label}: ${id.length > 26 ? id.slice(0, 26) + '…' : id}`));
            }
          } else if (aiModelIds === null) {
            gmLine.appendChild(h('span', { class: 'sce-hint', style: 'margin:0' },
              'id를 못 읽는 리수 버전입니다 — 보조 모델을 상위로 교체하는 우회를 쓰세요'));
          }
        }
        gmLine.appendChild(h('span', { class: 'sce-hint', style: 'margin:0' },
          aiGenModel.choice === 'aux'
            ? '보조가 번역·요약용 싼 모델이면 생성 품질이 낮습니다 — 결과가 계속 거부되면 상위 모델을 꽂아보세요'
            : aiGenModel.choice === 'main'
              ? '대화 모델로 보냅니다 — 단 일부 환경(Claude 공식 API 등)은 인증이 안 붙어 실패합니다. 실패하면 [직접 지정]으로.'
              : '보조 자리에 이 모델을 꽂아 쏩니다 — 리수 모델 설정에 보이는 id를 그대로'));
      };
      renderGmLine();
      if (aiGenModel === undefined) {
        Promise.resolve(ai.getGenModel())
          .then((v) => { aiGenModel = (v && v.choice) ? v : { choice: 'aux', staticId: '' }; })
          .catch(() => { aiGenModel = { choice: 'aux', staticId: '' }; })
          .then(() => { if (!destroyed) renderGmLine(); });
      }
      box.appendChild(gmLine);
    }

    if (ai && ai.generate) {
      box.appendChild(h('div', { class: 'sce-row' },
        aiGen.busy
          ? h('button', { class: 'sce-btn', onclick: () => { aiGen.seq++; aiGen.busy = false; rerender(); } }, '✋ 취소')
          : h('button', { class: 'sce-btn sce-add', style: 'width:auto', onclick: () => runAiGenerate() }, '✨ 생성')));
    }
    if (aiGen.busy) {
      box.appendChild(h('div', { class: 'sce-hint' },
        '⏳ 생성 중… 보조 모델이 쓰고 있습니다. 수십 초 걸릴 수 있고, 다른 탭을 보고 있어도 끝나면 결과가 여기 남습니다.'));
    } else if (aiGen.note) {
      box.appendChild(h('div', { class: 'sce-warn' }, aiGen.note));
    }
    if (aiGen.raw && !aiGen.busy) {
      const rawArea = h('textarea', { style: 'height:110px', readonly: 'readonly' });
      rawArea.value = aiGen.raw;
      box.appendChild(h('details', { class: 'sce-fold' }, h('summary', {}, 'AI가 보낸 원문 — 눌러서 펼치기'), rawArea));
    }

    // 생성 결과의 계획·적용 — ②(붙여넣기)와 같은 UI, 같은 규율
    if (patchSource === 'top') {
      const rb = patchReportBox();
      if (rb) box.appendChild(rb);
      if (patchPlan) box.appendChild(planBoxUI());
    }

    // 옆문 — API 크레딧 없이 공홈(웹 AI) 구독을 쓰는 유저의 경로. 강등이 아니라 병행 —
    // 같은 프롬프트 빌더를 쓰므로 [✨ 생성]과 내용이 똑같다.
    copyWidget('📋 복사해서 다른 AI에게',
      '위 요청과 봇 설정이 담긴 규격서를 복사해 웹 AI(GPT·클로드 등)에 붙여넣으세요. '
      + '받은 JSON은 🧾 JSON 작업대에 붙여넣으면 됩니다 (패치는 ②, 통짜 스키마는 ④).',
      () => {
        const a = aiCtxOn ? assembleBotContext(aiBotCtx) : { text: '' };
        return buildAiRequestPrompt(schema, aiReq, a.text);
      }).mount(box);

    return box;
  }

  function tabJson() {
    const wrap = h('div');

    // ── AI에게 통째로 맡기는 경로 ──
    wrap.appendChild(h('h4', {}, '① AI에게 스키마 만들게 하기'));
    let exampleKey = 'business';
    let withValidator = true;
    const exSelect = bindSelect(exampleKey,
      Object.entries(TEMPLATES).filter(([k]) => k !== 'blank').map(([k, t]) => [k, '예제: ' + t.label.split(' (')[0]]),
      (x) => { exampleKey = x; });
    const valCheck = bindCheck(withValidator, (x) => { withValidator = x; }, '검증기 원문 첨부 (정확도↑, 길이↑)');
    copyWidget('📋 AI에게 요청할 스키마 규격 복사',
      '봇 설정을 AI에게 설명하고 이 규격서를 붙여넣으면 스키마를 통째로 만들어 줍니다. '
      + '받아온 JSON을 아래 칸에 붙여넣고 [JSON → 편집기 반영]을 누르세요. '
      + '모델에게 가는 문구를 영어로 쓰게 되어 있어 토큰도 절약됩니다.',
      () => buildSchemaSpecPrompt(exampleKey, withValidator),
      [exSelect, valCheck],
    ).mount(wrap);
    if (schemaIsBlank(schema)) {
      wrap.appendChild(jumpRow('복붙 없이 하려면 — ✨ AI에게 맡기기에서 말로 시키면 통짜를 직접 만들어 옵니다.'));
    }

    // ── AI에게 부분 수정을 맡기는 경로 (왕복 패치) ──
    // 통짜 재생성은 안 고칠 부분까지 다시 쓰게 해서 위험하다. 여기는 바꿀 부분만 받아
    // patch.js가 병합한다 — add 충돌은 정지 후 선택, 적용은 원자적(전체 아니면 전무).
    wrap.appendChild(h('h4', {}, '② AI에게 스키마 고치게 하기 (부분 수정)'));

    if (patchSource === 'json') {
      const rb = patchReportBox();
      if (rb) wrap.appendChild(rb);
    }

    copyWidget('📋 수정 요청 규격 복사',
      '지금 스키마의 id 목록과 패치 형식을 함께 복사합니다. AI에게 무엇을 바꾸고 싶은지 설명하고 '
      + '이걸 붙여넣으면, 바꿀 부분만 담긴 패치 JSON이 옵니다. 받아온 걸 아래 칸에 붙여넣고 '
      + '[패치 검사]를 누르세요. 처음부터 통째로 만들 때는 ①, 이미 있는 봇을 고칠 때는 여기입니다.',
      () => buildPatchExportPrompt(schema),
    ).mount(wrap);
    wrap.appendChild(jumpRow('복붙 없이 하려면 — ✨ AI에게 맡기기에서 말로 시키면 같은 패치가 직접 옵니다.'));

    const pArea = h('textarea', { style: 'min-height:120px',
      placeholder: 'AI가 준 패치 JSON을 여기에 — 코드펜스(```)째 붙여넣어도 됩니다' });
    pArea.value = patchText;
    pArea.oninput = () => { patchText = pArea.value; };
    wrap.appendChild(pArea);
    wrap.appendChild(h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn', onclick: () => {
        const parsed = patchMod.parsePatch(patchText);
        patchPlan = parsed.ok
          ? { patch: parsed.patch, plan: patchMod.planPatch(schema, parsed.patch) }
          : { patch: null, plan: { errors: parsed.errors, warnings: [], ops: [], conflicts: [], summary: { add: 0, update: 0, remove: 0, conflicts: 0 } } };
        patchChoices = {};
        patchSource = 'json';
        rerender();
      } }, '🔍 패치 검사'),
    ));
    if (patchSource === 'json' && patchPlan) wrap.appendChild(planBoxUI());

    appendJsonTail(wrap);
    return wrap;
  }

  // ── 패치 계획·충돌·적용 UI — ②(붙여넣기)와 위층(✨ 생성)이 공유. 상태는 인스턴스 공통 ──
  function planBoxUI() {
    const planBox = h('div');

    const renderPlanBox = () => {
      planBox.replaceChildren();
      if (!patchPlan) return;
      const { patch, plan } = patchPlan;
      const box = h('div', { class: 'sce-block' });

      if (plan.errors.length) {
        box.append(h('div', { class: 'sce-err' }, '패치를 적용할 수 없습니다:'),
          ...plan.errors.map((e) => h('div', { class: 'sce-err' }, `- ${e}`)),
          h('div', { class: 'sce-hint' },
            'AI가 헛짚은 것일 수 있습니다 — 위의 [수정 요청 규격 복사]를 다시 복사해 AI에게 주고, 오류 문구를 함께 전달하세요.'));
        planBox.appendChild(box);
        return;
      }

      const secLabel = (s) => patchMod.SECTIONS[s]?.label ?? s;
      const entryName = (e) => e.label ?? e.notify ?? e.text ?? '';
      box.appendChild(h('div', {},
        `계획: 추가 ${plan.summary.add} · 교체 ${plan.summary.update} · 삭제 후보 ${plan.summary.remove} · 충돌 ${plan.summary.conflicts}`));
      if (patch.randomEventsChance != null)
        box.appendChild(h('div', {}, `⚙ 랜덤 이벤트 발동률 → ${patch.randomEventsChance}`));
      for (const w of plan.warnings) box.appendChild(h('div', { class: 'sce-warn' }, `⚠ ${w}`));

      const conflictKeys = new Set(plan.conflicts.map((c) => `${c.section}:${c.id}`));
      for (const o of plan.ops) {
        if (o.op === 'remove') continue;                       // 삭제는 아래 체크 목록에서
        if (o.op === 'add' && conflictKeys.has(`${o.section}:${o.id}`)) continue;  // 충돌은 충돌 블록에서
        const mark = o.op === 'add' ? '＋' : '✎';
        box.appendChild(h('div', {}, `${mark} ${secLabel(o.section)} ${o.id} ${entryName(o.entry)}`));
      }

      // 충돌 — 항목마다 선택. 기본은 '건너뛰기'(가장 안전) — 조용한 교체가 없게.
      // 셋 이상이면 일괄 버튼 — 실전에서 충돌 수십 개를 하나씩 고르다 눈 빠진다는 제보.
      if (plan.conflicts.length >= 3) {
        const setAll = (mode) => {
          for (const c of plan.conflicts) {
            if (!c.options.includes(mode)) continue;
            patchChoices[`cf:${c.key}`] = mode;
            if (mode !== 'rename') delete patchChoices[`rn:${c.key}`];
          }
          renderPlanBox();
        };
        box.appendChild(h('div', { class: 'sce-row' },
          h('span', { class: 'sce-hint' }, `충돌 ${plan.conflicts.length}건 일괄:`),
          h('button', { class: 'sce-btn', onclick: () => setAll('replace') }, '전부 교체'),
          h('button', { class: 'sce-btn', onclick: () => setAll('rename') }, '전부 새 id'),
          h('button', { class: 'sce-btn', onclick: () => setAll('skip') }, '전부 건너뛰기'),
        ));
        box.appendChild(h('div', { class: 'sce-hint' },
          '충돌이 이렇게 많으면 낡은 규격으로 만든 패치일 수 있습니다 — 이미 있는 걸 AI가 add로 다시 낸 것. '
          + '전부 교체하기 전에, [수정 요청 규격 복사]를 새로 해서 재요청하는 쪽이 안전할 때가 많습니다.'));
      }
      for (const c of plan.conflicts) {
        const cf = `cf:${c.key}`, rn = `rn:${c.key}`;
        const mode = patchChoices[cf] ?? 'skip';
        const OPT_LABEL = { replace: '기존을 교체', rename: '새 id로 추가', skip: '건너뛰기 (기본)' };
        const sel = bindSelect(mode, c.options.map((o) => [o, OPT_LABEL[o]]),
          (x) => { patchChoices[cf] = x; renderPlanBox(); });
        const row = h('div', { class: 'sce-row' },
          h('span', {}, `⚠ 충돌: ${c.reason}`), sel);
        if (mode === 'rename') {
          const suggested = patchChoices[rn] ?? patchMod.suggestFreeId(schema, patch, c.section, c.id);
          patchChoices[rn] = suggested;
          row.appendChild(pair('새 id', bindInput(suggested, (x) => { patchChoices[rn] = x.trim(); }, { cls: 'sce-w-m' }),
            '패치 안에서 이 id를 참조하는 식·효과도 함께 바뀝니다'));
        }
        const exName = entryName(c.existing), inName = entryName(c.incoming);
        box.appendChild(h('div', { class: 'sce-block' }, row,
          h('div', { class: 'sce-hint' },
            `기존: ${exName || '(이름 없음)'} ↔ 새것: ${inName || '(이름 없음)'}`
            + (exName && inName && exName !== inName ? ' — 이름이 달라 서로 다른 항목일 가능성이 높습니다' : ''))));
      }

      // 삭제 — 기본 해제. AI가 시키지도 않은 삭제를 끼워 넣는 것을 사람 눈으로 거른다.
      const removeOps = plan.ops.filter((o) => o.op === 'remove');
      if (removeOps.length) {
        box.appendChild(h('div', { class: 'sce-hint' }, '삭제 후보 — 체크한 것만 지워집니다 (기본 해제):'));
        if (removeOps.length >= 3) {
          const setRm = (v) => {
            for (const o of removeOps) patchChoices[`rm:${o.section}:${o.id}`] = v;
            renderPlanBox();
          };
          box.appendChild(h('div', { class: 'sce-row' },
            h('button', { class: 'sce-btn', onclick: () => setRm(true) }, '전체 체크'),
            h('button', { class: 'sce-btn', onclick: () => setRm(false) }, '전체 해제'),
          ));
        }
        for (const o of removeOps) {
          const key = `rm:${o.section}:${o.id}`;
          box.appendChild(h('div', {}, bindCheck(patchChoices[key], (x) => { patchChoices[key] = x; },
            `삭제: ${secLabel(o.section)} ${o.id} ${entryName(o.previous)}`)));
        }
      }

      // 직전 적용 시도의 실패 사유 — 계획·충돌 선택 UI는 남겨서 고르고 다시 시도할 수 있게
      for (const e of (patchPlan.applyErrors || []))
        box.appendChild(h('div', { class: 'sce-err' }, `✖ ${e}`));

      box.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn sce-add', onclick: () => {
          // 체크 안 된 remove는 패치에서 뺀다
          const p2 = JSON.parse(JSON.stringify(patch));
          for (const [sec, ids] of Object.entries(p2.remove || {}))
            p2.remove[sec] = ids.filter((id) => patchChoices[`rm:${sec}:${id}`]);
          const resolutions = {};
          for (const c of plan.conflicts) {
            const m = patchChoices[`cf:${c.key}`] ?? 'skip';
            resolutions[c.key] = m === 'rename' ? { rename: patchChoices[`rn:${c.key}`] } : m;
          }
          const r = patchMod.applyPatch(schema, p2, resolutions);
          if (!r.ok) {
            patchPlan.applyErrors = r.errors;
            renderPlanBox();
            return;
          }
          patchBackup = JSON.parse(JSON.stringify(schema));
          patchReport = r.applied;
          patchText = ''; patchPlan = null; patchChoices = {};
          schema = r.schema;
          rerender();
        } }, '✅ 패치 적용'),
        h('button', { class: 'sce-btn', onclick: () => { patchPlan = null; patchChoices = {}; rerender(); } }, '취소'),
      ));
      planBox.appendChild(box);
    };

    renderPlanBox();
    return planBox;
  }

  function patchReportBox() {
    if (!patchReport) return null;
    const rep = patchReport;
    const lines = [];
    if (rep.added.length) lines.push(`추가 ${rep.added.length} (${rep.added.join(', ')})`);
    if (rep.updated.length) lines.push(`교체 ${rep.updated.length} (${rep.updated.join(', ')})`);
    if (rep.removed.length) lines.push(`삭제 ${rep.removed.length} (${rep.removed.join(', ')})`);
    if (rep.skipped.length) lines.push(`건너뜀 ${rep.skipped.length} (${rep.skipped.join(', ')})`);
    const repWarns = (rep.warnings || []).map((w) => h('div', { class: 'sce-warn' }, `⚠ ${w}`));
    return h('div', { class: 'sce-block' },
      h('div', {}, `✅ 패치 적용됨 — ${lines.join(' · ') || '변화 없음'}`),
      ...(repWarns.length > 3
        ? [h('details', { class: 'sce-fold' },
            h('summary', { class: 'sce-warn' }, `⚠ 경고 ${repWarns.length}건 — 눌러서 펼치기`),
            ...repWarns)]
        : repWarns),
      h('div', { class: 'sce-row' },
        patchBackup ? h('button', { class: 'sce-btn', onclick: () => {
          schema = patchBackup; patchBackup = null; patchReport = null; rerender();
        } }, '↩ 되돌리기 (적용 전으로)') : null,
        h('button', { class: 'sce-btn', onclick: () => { patchReport = null; rerender(); } }, '확인'),
      ));
  }

  function appendJsonTail(wrap) {
    // ── 검증 실패를 되돌려주는 경로 ──
    wrap.appendChild(h('h4', {}, '③ 오류를 AI에게 돌려주기'));
    const v = validateSchema(schema);
    copyWidget('📋 검증 결과를 AI에게 돌려주기',
      v.ok
        ? `지금 스키마는 유효합니다${v.warnings.length ? ` (경고 ${v.warnings.length}개)` : ''}. 그래도 개선점을 물어보고 싶으면 누르세요.`
        : `오류 ${v.errors.length}개 — 이 버튼으로 오류 목록과 현재 스키마를 함께 복사해서 AI에게 그대로 주면 고쳐 줍니다. 통과할 때까지 반복하세요.`,
      () => buildFixPrompt(schema, validateSchema(schema)),
    ).mount(wrap);
    if (!v.ok) wrap.appendChild(jumpRow('복붙 없이 하려면 — ✨ AI에게 맡기기의 🩹 칩이 오류 목록을 한 번에 보냅니다.'));

    // ── 원본 편집 ──
    wrap.appendChild(h('h4', {}, '④ 스키마 원본'));
    wrap.appendChild(h('div', { class: 'sce-hint' }, '여기 붙여넣고 [반영]하면 편집기에 로드됩니다.'));
    const area = h('textarea', { id: 'sce-json', style: 'min-height:300px' });
    area.value = JSON.stringify(schema, null, 2);
    wrap.appendChild(area);
    wrap.appendChild(h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn', onclick: () => {
        // AI가 코드펜스를 붙여 주는 일이 잦다 — 벗겨내고 파싱한다
        const raw = String(area.value).trim();
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        const src = fenced ? fenced[1] : raw;
        try { schema = JSON.parse(src); rerender(); }
        catch (e) { reportEl.innerHTML = `<div class="sce-err">JSON 파싱 실패: ${escText(e.message)}</div>`; }
      } }, 'JSON → 편집기 반영'),
      h('button', { class: 'sce-btn', onclick: () => { area.value = JSON.stringify(schema, null, 2); } }, '편집기 → JSON 갱신'),
    ));
    return wrap;
  }

  // ── 탭: 진단 ──────────────────────────────────────────────
  // 검증기는 "형태가 맞나"만 본다. 여기서 보는 건 "게임이 되나"다 —
  // 실제로 N턴 굴려 죽은 이벤트·못 쓰는 액션·안 움직이는 수치를 찾는다.
  let diagResult = null;   // 마지막 결과 (탭을 옮겨도 유지)
  let diagPrev = null;     // 직전 회차 — "고쳤는데 왜 또 비슷하지?"에 답하려면 비교가 필요하다
  let diagTurns = 60, diagRuns = 6;

  const SEV = { high: ['🔴', '반드시 고쳐야 함'], mid: ['🟡', '고치는 게 좋음'], low: ['🔵', '확인만 해보세요'] };

  function tabDiag() {
    const wrap = h('div');
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '스키마를 실제로 여러 번 굴려 봅니다. 문법 오류가 아니라 **게임이 성립하는지**를 봅니다 — '
      + '영영 안 뜨는 이벤트, 한 번도 못 누르는 액션, 아무도 안 바꾸는 변수, 눌렀을 때 오히려 손해인 버튼 같은 것들. '
      + '변수·액션·규칙을 AI에게 맡겼다면 내보내기 전에 꼭 한 번 돌려 보세요.'));

    const turnsIn = bindInput(diagTurns, (x) => { diagTurns = Math.max(5, num(x)); }, { cls: 'sce-w-s' });
    const runsIn = bindInput(diagRuns, (x) => { diagRuns = Math.max(1, num(x)); }, { cls: 'sce-w-s' });
    const status = h('div', { class: 'sce-hint' }, diagResult ? '' : '아직 실행하지 않았습니다.');
    const out = h('div');

    const runBtn = h('button', { class: 'sce-btn sce-add', onclick: () => {
      status.textContent = '굴리는 중…';
      status.className = 'sce-hint';
      // 무거운 작업이라 버튼 눌린 게 먼저 그려지도록 한 틱 넘긴다
      setTimeout(() => {
        const t0 = Date.now();
        const before = diagResult;
        try { diagResult = diagnose(schema, { turns: diagTurns, runs: diagRuns }); }
        catch (e) { diagResult = before; status.textContent = `진단 실패 — ${e.message}`; status.className = 'sce-hint sce-warn'; return; }
        diagResult.stats.ms = Date.now() - t0;
        // 턴/시드가 같아야 숫자를 나란히 놓고 볼 수 있다
        diagPrev = (before?.ran && before.stats.turns === diagTurns && before.stats.runs === diagRuns) ? before : null;
        render();
      }, 0);
    } }, '🔬 진단 실행');

    wrap.appendChild(h('div', { class: 'sce-row' },
      runBtn, pair('턴 수', turnsIn, '한 판을 몇 턴까지 굴릴지'), pair('시드 수', runsIn, '운 편차를 보려면 여러 번')));
    wrap.appendChild(status);

    if (diagResult) {
      const { ran, findings, stats } = diagResult;
      const line = [];
      if (stats.loseVar) {
        line.push(`방치 생존 ${stats.idleSurvive}/${stats.runs}(평균 ${stats.idleLife.toFixed(0)}턴)`);
        if (stats.playSurvive !== undefined) line.push(`플레이 생존 ${stats.playSurvive}/${stats.runs}(평균 ${stats.playLife.toFixed(0)}턴)`);
        line.push(`패배 판정: ${stats.loseVar}`);
        // 수명 평균만 보면 천장에 닿은 봇이 다 똑같아 보인다. 갈리는 폭을 같이 보여준다.
        if (stats.playSpread != null && stats.playRange) {
          line.push(`결과 편차 ±${stats.playSpread.toFixed(0)}턴 (${stats.playRange[0]}~${stats.playRange[1]})`);
        }
      }
      if (stats.eventCoverage) line.push(`이벤트 ${stats.eventCoverage[0]}/${stats.eventCoverage[1]}종 발동`);
      else if (stats.deadEvents) line.push(`안 뜬 이벤트 ${stats.deadEvents}종`);
      line.push(`${stats.ms}ms`);
      const late = (stats.lateEvents ?? 0) + (stats.lateActions ?? 0);
      out.appendChild(h('div', { class: 'sce-block' },
        h('div', {}, ran
          ? `🔴 ${stats.high}  🟡 ${stats.mid}  🔵 ${stats.low}   —   ${stats.turns}턴 × ${stats.runs}시드`
          : '스키마 오류부터 고쳐야 굴려볼 수 있습니다'),
        h('div', { class: 'sce-hint' }, line.join(' · ')),
        // 짧은 판에서 진단하면 후반부 콘텐츠가 통째로 "안 뜬 것"이 된다. 그걸 결함으로
        // 착각하지 않도록, 몇 개가 그런 경우인지 맨 위에서 미리 말해 준다.
        ...(late ? [h('div', { class: 'sce-hint' },
          `🔵 ${late}개는 ${stats.turns}턴이 짧아서 못 본 것뿐입니다 — `
          + `${stats.turns * 2}턴으로 다시 돌리면 사라집니다. 이 봇의 후반부까지 보려면 턴 수를 올리세요.`)] : [])));

      // ── 직전 회차와 비교 ──
      // "고쳐도 계속 비슷하게 나온다"는 느낌은 대개 착각이다. 실제로 뭐가 없어졌는지 보여준다.
      const cmp = compareDiagnoses(diagPrev, diagResult);
      if (cmp) {
        const sign = (n) => (n > 0 ? `+${n}` : String(n));
        const box = h('div', { class: 'sce-block' });
        box.appendChild(h('h4', {}, '📊 직전 진단과 비교'));
        box.appendChild(h('div', {},
          `🔴 ${sign(cmp.delta.high)}  🟡 ${sign(cmp.delta.mid)}  🔵 ${sign(cmp.delta.low)}`
          + (cmp.delta.deadEvents ? `  ·  안 뜬 이벤트 ${sign(cmp.delta.deadEvents)}종` : '')));
        if (cmp.survive) {
          box.appendChild(h('div', {},
            `방치 생존 ${cmp.survive.idle[0]} → ${cmp.survive.idle[1]}`
            + ` (평균 ${cmp.survive.idleLife[0].toFixed(0)} → ${cmp.survive.idleLife[1].toFixed(0)}턴)`
            + `  ·  플레이 생존 ${cmp.survive.play[0]} → ${cmp.survive.play[1]}`
            + ` (평균 ${cmp.survive.playLife[0].toFixed(0)} → ${cmp.survive.playLife[1].toFixed(0)}턴)`));
        }
        box.appendChild(h('div', { class: cmp.fixed.length ? 'sce-ok' : 'sce-hint' },
          `✓ 해결됨 ${cmp.fixed.length}건`
          + (cmp.fixed.length ? `: ${cmp.fixed.slice(0, 6).map((f) => f.tag + (/'([^']+)'/.exec(f.text)?.[1] ? ` ${/'([^']+)'/.exec(f.text)[1]}` : '')).join(', ')}`
            + (cmp.fixed.length > 6 ? ` 외 ${cmp.fixed.length - 6}건` : '') : '')));
        box.appendChild(h('div', { class: cmp.fresh.length ? 'sce-warn' : 'sce-hint' },
          `${cmp.fresh.length ? '⚠' : '·'} 새로 생김 ${cmp.fresh.length}건`
          + (cmp.fresh.length ? `: ${cmp.fresh.slice(0, 6).map((f) => f.tag + (/'([^']+)'/.exec(f.text)?.[1] ? ` ${/'([^']+)'/.exec(f.text)[1]}` : '')).join(', ')}` : '')));
        box.appendChild(h('div', { class: 'sce-hint' },
          `그대로 남음 ${cmp.stayed.length}건`
          + (cmp.stayed.length ? ' — 이건 그 탭에서 못 고치는 문제일 수 있습니다. 아래 목록에서 해결 방법이 다른 탭에 있는지 보세요.' : '')));
        out.appendChild(box);
      }

      if (ran && !findings.length) {
        out.appendChild(h('div', { class: 'sce-ok' }, '✓ 걸린 게 없습니다. 이대로 내보내도 좋습니다.'));
      }
      for (const sev of ['high', 'mid', 'low']) {
        const group = findings.filter((f) => f.sev === sev);
        if (!group.length) continue;
        const [icon, label] = SEV[sev];
        out.appendChild(h('h4', {}, `${icon} ${label} (${group.length})`));
        for (const f of group) {
          out.appendChild(h('div', { class: 'sce-block' },
            h('div', { class: 'sce-row' }, h('span', { class: 'sce-tag' }, f.tag)),
            h('div', {}, f.text)));
        }
      }

      // ── 진단 결과를 그대로 AI에게 넘기기 ──
      // 탭별로 나눠 보내는 게 핵심이다. 한꺼번에 고치라고 하면 변수를 지어내면서 전부 어긋난다.
      if (ran && findings.length) {
        out.appendChild(h('h4', {}, '🤖 이 결과로 AI에게 수정 요청하기'));

        // 권장 경로 — 패치 (v0.45). 통 교체는 항목 100개짜리 봇에서 AI가 하나만 빠뜨려도 그게 삭제다.
        const fixable = findings.filter((f) => f.sev !== 'low');

        // 직결 경로 (v0.47) — 복사 왕복 없이 그 자리에서 생성. 계획·충돌 확인은 똑같이 거친다.
        if (fixable.length && ai && ai.generate) {
          out.appendChild(h('div', { class: 'sce-row' },
            h('button', { class: 'sce-btn sce-add', style: 'width:auto', onclick: () => runAiGenerate({ findings, stats: diagResult.stats }) },
              `✨ 이 결과로 바로 고쳐달라기 (${fixable.length}건)`),
            h('span', { class: 'sce-hint', style: 'margin:0' },
              '창작 탭의 생성 모델로 패치를 받아 옵니다 — 도착하면 ✍ 창작 탭으로 이동합니다.')));
        }

        if (fixable.length) {
          copyWidget(`📤 수정 패치 요청 복사 (${fixable.length}건${fixable.filter((f) => f.sev === 'high').length ? `, 🔴 ${fixable.filter((f) => f.sev === 'high').length}` : ''}) — 권장`,
            '문제 목록 전체와 지금 봇의 항목 전문을 함께 복사합니다. 받은 패치 JSON은 '
            + '🧾 JSON 작업대 ②의 [패치 검사]에 붙여넣으면 됩니다 — 바꿀 부분만 병합되고, 나머지는 손대지 않습니다. '
            + '🔵는 고칠 거리가 아니라 확인 사항이라 보내지 않습니다.',
            () => buildPatchExportPrompt(schema, { findings, stats: diagResult.stats }),
          ).mount(out);
        }

        out.appendChild(h('div', { class: 'sce-hint' },
          '아래는 예전 방식(탭 통 교체)입니다 — 그 탭을 **전면 재작성**할 때만 쓰세요. '
          + '"손대지 않은 것까지 전부 포함해 한 세트로 달라"는 지시가 박혀 나가지만, 항목이 많은 봇에서는 '
          + 'AI가 하나만 빠뜨려도 그게 곧 삭제입니다. 부분 수정이면 위의 패치를 쓰세요.'));

        const byTab = {};
        for (const f of findings) if (f.tab && f.sev !== 'low') (byTab[f.tab] = byTab[f.tab] || []).push(f);
        let anyBtn = false;
        for (const key of Object.keys(TAB_SLICES)) {
          const group = byTab[key];
          if (!group?.length) continue;
          anyBtn = true;
          const hi = group.filter((f) => f.sev === 'high').length;
          copyWidget(`📤 ${TAB_SLICES[key].label} 수정 요청 복사 (${group.length}건${hi ? `, 🔴 ${hi}` : ''})`,
            group.map((f) => `· [${f.tag}] ${f.text}`).join('\n'),
            () => buildTabExportPrompt(schema, key, { findings, stats: diagResult.stats }),
          ).mount(out);
        }

        const orphan = findings.filter((f) => !f.tab || !TAB_SLICES[f.tab]);
        if (orphan.length) {
          out.appendChild(h('div', { class: 'sce-hint' },
            `AI 내보내기가 없는 탭이거나 여러 탭에 걸친 지적 ${orphan.length}건은 직접 고쳐야 합니다: `
            + [...new Set(orphan.map((f) => f.tag))].join(', ')));
        }
        if (!anyBtn) out.appendChild(h('div', { class: 'sce-hint' }, '특정 탭으로 넘길 수 있는 지적이 없습니다.'));

        copyWidget('📋 진단 결과 전체를 글로 복사',
          '어디든 붙여넣을 수 있는 사람이 읽는 형태입니다. 메모하거나 남에게 보여줄 때 쓰세요.',
          () => [
            `# ${schema.meta?.name ?? '시뮬레이션'} 진단 (${stats.turns}턴 × ${stats.runs}시드)`,
            stats.loseVar ? `방치 생존 ${stats.idleSurvive}/${stats.runs}(평균 ${stats.idleLife.toFixed(0)}턴)`
              + ` · 플레이 생존 ${stats.playSurvive}/${stats.runs}(평균 ${stats.playLife.toFixed(0)}턴)`
              + (stats.playSpread != null ? ` · 결과 편차 ±${stats.playSpread.toFixed(0)}턴 (${stats.playRange[0]}~${stats.playRange[1]})` : '') : '',
            stats.eventCoverage ? `이벤트 커버리지 ${stats.eventCoverage[0]}/${stats.eventCoverage[1]}종`
              + ` (${Math.round(stats.eventCoverage[0] / stats.eventCoverage[1] * 100)}%)` : '',
            stats.presetLives?.length
              ? `프리셋 수명 (${stats.presetMode === 'idle' ? '방치 기준' : '플레이 기준'}): `
                + stats.presetLives.map((p) => `${p.label} ${p.life.toFixed(0)}턴±${p.ci === Infinity ? '?' : p.ci.toFixed(1)}`
                  + ` 생존 ${p.survive}/${stats.runs}`).join(' · ') : '',
            (stats.lateEvents ?? 0) + (stats.lateActions ?? 0)
              ? `🔵 ${(stats.lateEvents ?? 0) + (stats.lateActions ?? 0)}개는 ${stats.turns}턴이 짧아서 못 본 것입니다`
                + ` (${stats.turns * 2}턴이면 뜹니다)` : '',
            ...(stats.lossCauses?.length
              ? ['', '## 붕괴 원인 분포', ...stats.lossCauses.map(([k, n]) => `- ${k} — ${n}회`)] : []),
            '',
            ...['high', 'mid', 'low'].flatMap((sev) => {
              const g = findings.filter((f) => f.sev === sev);
              if (!g.length) return [];
              return [`## ${SEV[sev][0]} ${SEV[sev][1]} (${g.length})`,
                ...g.map((f) => `- [${f.tag}] ${f.text}`), ''];
            }),
            ...(stats.actionImpact?.length
              ? [`## 액션별 기여도 (그 버튼이 있을 때 vs 없을 때 수명 차이, ${stats.impactRuns}시드 짝비교)`,
                '±는 95% 신뢰구간입니다. 폭이 값보다 크면 시드 운과 구분되지 않으니 고치지 마세요.',
                ...(stats.impactSaturated
                  ? [`⚠ ${stats.turns}턴에서는 어느 쪽으로 놀아도 전부 살아남아 이 표가 아무것도 구분하지 못합니다`
                    + ` — ${stats.turns * 2}턴 이상으로 다시 돌리세요.`] : []),
                ...stats.actionImpact.map((a) => `- ${a.label}: ${a.delta >= 0 ? '+' : ''}${a.delta.toFixed(1)}턴 (±${a.ci.toFixed(1)})`
                  + (Math.abs(a.delta) <= a.ci ? ' ← 0과 구분 안 됨' : ''))]
              : []),
          ].filter((x) => x !== '').join('\n'),
        ).mount(out);
      }

      if (diagResult.stats.actionImpact?.length) {
        out.appendChild(h('h4', {}, '액션별 기여도 (그 버튼이 있을 때 vs 없을 때 수명 차이)'));
        out.appendChild(h('div', { class: 'sce-hint' },
          `나머지 액션은 양쪽 판에서 똑같이 쓰고, 이 버튼의 유무만 다르게 ${diagResult.stats.impactRuns}쌍을 돌린 결과입니다 `
          + '(같은 시드로 짝지어 굴려 시드 운을 상쇄합니다). +면 있어서 이득, −면 있는 게 손해. '
          + '±는 95% 신뢰구간 — 이 폭이 값보다 크면 시드 운과 구분되지 않는다는 뜻이니 그 줄은 고치지 마세요.'
          + (diagResult.stats.actionSkipped?.length
            ? ` 정책 전환 버튼(${diagResult.stats.actionSkipped.join(', ')})은 언제 누르냐가 전부라 자동 평가에서 제외했습니다.`
            : '')));
        if (diagResult.stats.impactSaturated) {
          out.appendChild(h('div', { class: 'sce-hint' },
            `⚠ ${diagResult.stats.turns}턴에서는 어느 쪽으로 놀아도 전부 끝까지 살아남아, 이 표가 아무것도 구분하지 못합니다. `
            + `액션 기여도를 보려면 판이 실제로 끝나는 길이(${diagResult.stats.turns * 2}턴 이상)로 다시 돌리세요.`));
        }
        const tbl = h('div', { class: 'sce-block' });
        for (const it of diagResult.stats.actionImpact) {
          const noisy = Math.abs(it.delta) <= it.ci;
          const mark = noisy ? '　'
            : it.delta > diagResult.stats.turns * 0.05 ? '🟢'
              : it.delta < -diagResult.stats.turns * 0.05 ? '🔴' : '　';
          tbl.appendChild(h('div', { class: noisy ? 'sce-hint' : '' },
            `${mark} ${it.label} — 수명 ${it.delta >= 0 ? '+' : ''}${it.delta.toFixed(1)}턴 ±${it.ci.toFixed(1)}`
            + (noisy ? ' (시드 운과 구분 안 됨)' : '')
            + (it.exempt ? ' · 지적 제외됨' : '')));
        }
        out.appendChild(tbl);
      }

      // ── 프리셋이 정말 난이도인가 ──
      // 라벨은 만드는 사람 머릿속이고, 이 표는 실제로 굴려 본 결과다. 둘이 어긋나는 일이 흔하다.
      if (diagResult.stats.presetLives?.length) {
        const ps = diagResult.stats.presetLives;
        out.appendChild(h('h4', {}, '프리셋별 실제 난이도'));
        out.appendChild(h('div', { class: 'sce-hint' },
          `프리셋마다 판을 새로 굴려 몇 턴에 무너지는지 잰 결과입니다 — `
          + `${diagResult.stats.presetMode === 'idle' ? '아무 액션도 안 썼을 때' : '액션을 무작위로 쓰며 놀았을 때'} 기준, `
          + `${diagResult.stats.runs}시드를 프리셋 전체에 똑같이 재사용했습니다(짝비교). `
          + '±는 95% 신뢰구간 — 두 프리셋의 구간이 겹치면 그 둘은 사실상 같은 난이도입니다.'));
        const tbl = h('div', { class: 'sce-block' });
        const longest = ps.reduce((a, b) => (a.life >= b.life ? a : b)).life;
        const shortest = ps.reduce((a, b) => (a.life <= b.life ? a : b)).life;
        for (const p of ps) {
          const mark = ps.length < 2 || longest === shortest ? '　'
            : p.life === longest ? '🟢' : p.life === shortest ? '🔴' : '　';
          tbl.appendChild(h('div', {},
            `${mark} ${p.label} — ${p.life.toFixed(0)}턴 ±${p.ci === Infinity ? '?' : p.ci.toFixed(1)}`
            + ` · 끝까지 생존 ${p.survive}/${diagResult.stats.runs}`));
        }
        out.appendChild(tbl);
      }
    }
    wrap.appendChild(out);
    return wrap;
  }

  // ── 프레임 ────────────────────────────────────────────────
  const reportEl = h('div', { class: 'sce-report' });

  // ── 🎨 에셋 층 — 팩 카드·자동 감지·모듈 지침 변환·실존 진단 ──
  // 팩이 없으면 기능 꺼짐 = schema.assets 자체가 없는 상태를 유지한다 (기존 봇 무영향).
  function ensureAssets() {
    if (!schema.assets) schema.assets = { packs: [] };
    schema.assets.packs = schema.assets.packs || [];
    return schema.assets;
  }

  async function loadAssetNames() {
    if (!ai || !ai.getAssetNames) {
      assetNote = '이 환경은 에셋 목록을 읽을 수 없다 (플레이그라운드 등) — 어휘는 손으로 넣어야 한다.';
      rerender(); return null;
    }
    try {
      // 출처 구성까지 주는 훅이 있으면 그걸로 — "왜 0개인가"를 말할 수 있다 (v0.54.4)
      if (ai.getAssetSources) {
        const r = await ai.getAssetSources();
        const names = [...new Set((r.sources || []).flatMap((s) => s.names.map(String)))];
        if (!names.length) {
          assetNote = r.dbErr
            ? `에셋 0개 — 모듈 접근 실패: ${r.dbErr}. 리수의 권한(db) 팝업에서 허용해야 모듈 에셋을 읽을 수 있다.`
            : '캐릭터·활성 모듈 어디에도 추가 에셋이 없다. (모듈은 이 봇/채팅에서 활성화돼 있어야 보인다)';
          rerender(); return null;
        }
        assetNames = names;
        assetNote = '읽음: ' + (r.sources || []).map((s) => `${s.label} ${s.names.length}개`).join(' + ')
          + (r.dbErr ? ` ⚠ 모듈 접근 실패: ${r.dbErr}` : '');
        return assetNames;
      }
      const names = await ai.getAssetNames();
      if (!names || !names.length) {
        assetNote = '캐릭터·활성 모듈 어디에서도 추가 에셋을 읽지 못했다 — 에셋이 없거나 이 리수 버전이 접근을 막는다.';
        rerender(); return null;
      }
      assetNames = names.map(String);
      return assetNames;
    } catch (e) { assetNote = '에셋 읽기 실패: ' + e.message; rerender(); return null; }
  }

  function assetsFloor() {
    const box = h('div', { class: 'sce-block sce-top' });
    box.appendChild(h('h4', { style: 'margin-top:2px' }, '🎨 에셋 팩 — 이미지 태그 자동화'));
    box.appendChild(h('div', { class: 'sce-hint' },
      '매 턴 손으로 싣던 이미지 지침(인물×감정 곱셈 목록)을 팩 선언으로 대체한다. ' +
      '보조가 인물·감정만 고르면 조합·실존 대조·폴백은 시스템이 한다. 팩이 없으면 기능 꺼짐 — 기존 봇은 아무것도 안 바뀐다.'));

    const a = schema.assets;
    if (a && a.packs && a.packs.length) {
      box.appendChild(h('div', { class: 'sce-row' },
        pair('삽입 주체', bindSelect(a.by ?? 'aux', [
          ['aux', '보조가 고름 — 맨 앞 1장, 추가 비용 0 (권장)'],
          ['aux_flow', '보조가 고름 — 서사 위치에 여러 장 (본문 인용 앵커)'],
          ['main', '메인 모델이 직접 — 주입문이 매 턴 전송에 합류'],
        ], (x) => { if (x === 'aux') delete a.by; else a.by = x; rerender(); }),
        'aux 계열은 실존 대조·폴백까지 돈다. aux_flow는 보조가 본문 문장을 인용해 자리를 잡고, ' +
        '인용을 못 찾으면 그 장은 생략 — 어긋난 위치가 나갈 통로가 없다. main은 대조가 불가능해 "확신 없으면 생략" 지시로 버틴다')));
    }

    const tools = h('div', { class: 'sce-row' });
    tools.appendChild(h('button', { class: 'sce-btn', onclick: async () => {
      assetNote = null;
      const names = await loadAssetNames();
      if (!names) return;
      const det = detectSlotsFromNames(names);
      if (!det) { assetNote = `이름 ${names.length}개에서 공통 구분자를 못 찾았다 — 칸을 손으로 만들어야 한다.`; rerender(); return; }
      const A = ensureAssets();
      A.packs.push(packDraftFromDetect(det, 'pack' + (A.packs.length + 1)));
      assetNote = `구분자 '${det.sep}' 기준 ${det.covered}/${det.total}개 이름에서 칸 ${det.cols.length}개 감지 — ` +
        '출력 태그(format)는 봇의 표시 규약에 맞게 꼭 손볼 것.';
      rerender();
    } }, '🔍 에셋에서 자동 감지'));
    tools.appendChild(h('button', { class: 'sce-btn', onclick: async () => {
      assetNote = null;
      if (await loadAssetNames()) rerender();
    } }, '📇 실존 대조 새로고침'));
    box.appendChild(tools);
    if (assetNote) box.appendChild(h('div', { class: 'sce-warn' }, assetNote));
    if (assetNames) box.appendChild(h('div', { class: 'sce-hint' },
      `실물 에셋 ${assetNames.length}개 읽음 — 팩 카드마다 실존 커버리지가 표시된다.`));

    // 매 턴 비용 추정 — 이 기능이 뭘 아끼는지 숫자로. 기준선은 예전 방식(assetlist 통짜 덤프)
    if (a && a.packs && a.packs.length) {
      const cost = estAssetCost(schema, assetNames);
      let line = `📊 매 턴 비용(추정 ±30%): 메인 프롬프트 +${cost.main} tok · 보조 호출 +${cost.aux} tok`;
      if (cost.baseline != null) {
        const now = cost.main + cost.aux;
        line += ` — 예전 방식(이름 ${assetNames.length}개 통짜 목록)이면 메인에 매 턴 ~${cost.baseline} tok`;
        if (now < cost.baseline) line += `, 절감 ~${Math.round((1 - now / cost.baseline) * 100)}% (지침 문단 제외한 보수적 수치)`;
      } else {
        line += ' — [📇 실존 대조 새로고침]을 누르면 예전 방식(통짜 목록) 대비 절감률도 계산해 준다';
      }
      box.appendChild(h('div', { class: 'sce-hint' }, line + '. 게이트 팩 어휘는 열린 턴에만 추가된다.'));
    }

    const packs = (a && a.packs) || [];
    const nameSet = assetNames ? new Set(assetNames) : null;
    packs.forEach((p, i) => {
      const card = h('div', { class: 'sce-block' });
      card.appendChild(h('div', { class: 'sce-row' },
        bindCheck(p.enabled !== false, (x) => { if (x) delete p.enabled; else p.enabled = false; rerender(); }, '켜짐'),
        bindInput(p.id, (x) => { p.id = x.trim(); rerender(); }, { cls: 'sce-w-m', ph: '영문id (예: mansion)' }),
        pair('출처', bindInput(p.source, (x) => { p.source = x || undefined; rerender(); },
          { cls: 'sce-w-m', ph: '모듈/봇 이름 — 어디서 온 팩인지' })),
        grip(packs, i, rerender),
      ));
      card.appendChild(h('div', { class: 'sce-row' },
        pair('구분자', bindInput(p.sep ?? '_', (x) => { if (x === '_' || x === '') delete p.sep; else p.sep = x; rerender(); }, { cls: 'sce-w-s', ph: '_' })),
        pair('출력 태그', bindInput(p.format, (x) => { p.format = x; rerender(); },
          { cls: 'sce-w-l', ph: '<img="{name}"> — {name}에 조합 이름' }),
          '봇의 표시 정규식이 알아듣는 문법 그대로. {name} 외에 {칸id}도 자리표시자로 쓸 수 있다'),
      ));
      card.appendChild(h('div', { class: 'sce-row' },
        pair('게이트', bindInput(p.when, (x) => { p.when = x || undefined; rerender(); },
          { cls: 'sce-w-m', ph: '(선택) nsfw_on — 닫히면 통째 제외' }),
          '조건식이 참일 때만 팩이 열린다. 성인 어휘 팩을 쪼개 두면 대부분의 턴에서 토큰이 통째로 빠진다'),
        pair('고정 인물', bindInput((p.chars || []).join(', '), (x) => {
          const v = x.split(',').map((s) => s.trim()).filter(Boolean);
          if (v.length) p.chars = v; else delete p.chars; rerender();
        }, { cls: 'sce-w-m', ph: '(선택) 단일 캐릭 모듈용, 쉼표 구분' }),
          '이름 조합에 인물 칸이 없는 팩은 여기 적은 인물로 라우팅된다'),
        bindCheck(p.verify !== false, (x) => { if (x) delete p.verify; else p.verify = false; rerender(); }, '실존 대조'),
      ));
      (p.slots || []).forEach((s, j) => {
        card.appendChild(h('div', { class: 'sce-row' },
          bindInput(s.id, (x) => { s.id = x.trim(); rerender(); }, { cls: 'sce-w-s', ph: '칸id (who/emo)' }),
          bindInput(s.label, (x) => { s.label = x || undefined; rerender(); }, { cls: 'sce-w-s', ph: '표시명' }),
          pair('어휘', bindInput((s.values || []).join(', '), (x) => {
            s.values = x.split(',').map((t) => t.trim()).filter(Boolean); rerender();
          }, { cls: 'sce-w-l', ph: 'angry, smile, neutral (쉼표 구분)' })),
          bindCheck(!!s.optional, (x) => { if (x) s.optional = true; else delete s.optional; rerender(); }, '생략 가능'),
          pair('폴백', bindInput(s.fallback, (x) => { s.fallback = x || undefined; rerender(); }, { cls: 'sce-w-s', ph: 'neutral' }),
            '정조합이 실존하지 않을 때 이 값으로 강등해 재시도 (인물 칸에는 안 씀)'),
          grip(p.slots, j, rerender),
        ));
      });
      card.appendChild(addBtn('칸 추가', () => {
        p.slots = p.slots || [];
        p.slots.push({ id: 'slot' + (p.slots.length + 1), values: [] });
        rerender();
      }));

      // 미리보기 — 각 칸의 첫 어휘로 조합한 출력 실물 (format 오타를 눈으로 잡는 자리)
      const first = {};
      for (const s of p.slots || []) if ((s.values || []).length) first[s.id] = s.values[0];
      const prevName = composeName(p, first);
      if (prevName) card.appendChild(h('div', { class: 'sce-hint' }, `예시 출력: ${renderTag(p, prevName, first)}`));

      const cov = packCoverage(p, nameSet);
      if (cov.skipped) {
        card.appendChild(h('div', { class: 'sce-hint' },
          `대조 제외 — 조합 ${cov.combos}개를 검사 없이 신뢰한다. 에셋이 모듈에 살아서 이름 목록을 못 읽는 환경용 ` +
          '(어휘가 지침 그대로면 안전하지만, 오타 조합은 깨진 이미지로 나간다).'));
      } else if (cov.exist != null) {
        // 실질 구멍 = 정조합도 없고 폴백 사다리도 못 받는 조합. 이것만 ⚠의 근거가 된다 —
        // 폴백이 받아주는 빠짐은 스파스 매트릭스의 정상 모습이다.
        const holes = cov.combos - cov.exist - cov.rescued;
        let line = `실존 대조: 필수 조합 ${cov.combos}개 중 ${cov.exist}개 실존`;
        if (cov.rescued) line += `, 빠진 ${cov.combos - cov.exist}개 중 ${cov.rescued}개는 폴백 구제`;
        if (holes > 0) line += ` — 실질 구멍 ${holes}개 (예: ${cov.missing.join(', ')}${holes > cov.missing.length ? ' …' : ''})`;
        card.appendChild(h('div', { class: holes === 0 ? 'sce-ok' : 'sce-warn' },
          (holes === 0 ? '✓ ' : '⚠ ') + line));
        if (holes > 0 && !cov.rescued && (p.slots || []).every((s) => s.fallback == null))
          card.appendChild(h('div', { class: 'sce-hint' },
            '폴백이 하나도 없다 — 감정 칸에 "어떤 조합으로도 실존하는 값"을 폴백으로 주면 구멍 대부분이 구제된다.'));
      } else if (cov.capped) {
        card.appendChild(h('div', { class: 'sce-warn' },
          `⚠ 필수 조합이 ${cov.combos}개 — 너무 많아 대조를 생략했다 (어휘를 줄이거나 칸을 생략 가능으로)`));
      } else if (!nameSet) {
        card.appendChild(h('div', { class: 'sce-hint' },
          `필수 조합 ${cov.combos}개 — [📇 실존 대조 새로고침]을 누르면 실물과 대조해 준다`));
      }
      box.appendChild(card);
    });
    box.appendChild(addBtn('팩 추가 (빈 카드)', () => {
      const A = ensureAssets();
      A.packs.push({ id: 'pack' + (A.packs.length + 1), format: '<img="{name}">',
        slots: [{ id: 'who', label: '인물', values: [] }, { id: 'emo', label: '감정', values: [] }] });
      rerender();
    }));

    // 임포터 — 모듈 배포문(키워드 목록 + 삽입 문법)을 팩 선언으로
    box.appendChild(h('h4', {}, '📋 모듈 지침 가져오기'));
    box.appendChild(h('div', { class: 'sce-hint' },
      '모듈/봇이 들고 온 이미지 지침 원문을 붙여넣으면 팩 선언으로 변환한다. 변환 결과는 검증을 통과해야 반영된다.'));
    const ta = bindArea(assetImportText, (x) => { assetImportText = x; }, '여기에 지침 원문 붙여넣기…');
    box.appendChild(ta);
    if (ai && ai.generate) {
      box.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn sce-add', style: 'width:auto', onclick: async () => {
          if (assetBusy) return;
          assetImportText = ta.value;
          if (!assetImportText.trim()) { assetImportNote = '붙여넣은 지침이 없다.'; rerender(); return; }
          assetBusy = true; assetImportNote = null; rerender();
          try {
            const r = await ai.generate(buildPackImportPrompt(assetImportText));
            const text = typeof r === 'string' ? r : null;
            if (!text) {
              assetImportNote = '변환 호출 실패' + (r && r.error ? ' — ' + r.error : (r && r.blocked ? ' — 차단됨' : ''));
              return;
            }
            // 추론 모델의 <Thoughts> 서두·코드펜스·잡담을 견디는 추출기 — 보조 응답 파서와 같은 것.
            // 순진한 첫{ ~ 끝} 슬라이스는 Thoughts 안의 중괄호에 걸려 깨진다 (실측: MIKU&BRS 변환).
            const obj = engine.extractJsonObject(text, 'packs');
            if (!obj) { assetImportNote = '변환 응답에서 JSON을 못 찾았다 — 원문: ' + text.slice(0, 120); return; }
            const got = Array.isArray(obj && obj.packs) ? obj.packs : null;
            if (!got || !got.length) { assetImportNote = '변환 결과에 팩이 없다.'; return; }
            // 변환 결과 청소 — AI가 "비워 둬라"를 빈 문자열/빈 배열로 내는 건 정상이니 여기서 걷는다
            for (const g of got) {
              if (!g || typeof g !== 'object') continue;
              if (String(g.when ?? '').trim() === '') delete g.when;
              if (Array.isArray(g.chars) && !g.chars.length) delete g.chars;
            }
            // 원자 적용 — 붙여 보고 검증 오류가 늘면 통째 되돌린다 (배치 생성과 같은 규율).
            // 기존 오류(예: 손으로 만들다 만 빈 팩 카드)는 늘어난 것이 아니므로 반영을 막지 않는다.
            const backup = JSON.parse(JSON.stringify(schema));
            const before = validateSchema(schema).errors.length;
            ensureAssets().packs.push(...got);
            const after = validateSchema(schema);
            if (after.errors.length > before) {
              schema = backup;
              assetImportNote = '변환 결과가 검증 실패 — 반영 안 함: ' + after.errors.slice(0, 3).map((e) => e.msg).join(' / ');
            } else {
              assetImportText = '';
              assetImportNote = `팩 ${got.length}개 변환 반영 — 게이트(when)와 출력 태그는 눈으로 확인할 것.`
                + (before ? ' ⚠ 기존 오류가 남아 있다 — 설치 전에 위 팩 카드의 오류(빈 어휘 등)를 지워야 한다.' : '');
            }
          } finally { assetBusy = false; rerender(); }
        } }, assetBusy ? '⏳ 변환 중…' : '✨ AI로 팩 변환')));
    } else {
      box.appendChild(copyWidget('📋 변환 요청서 복사', '외부 AI에게 붙여넣고, 받은 JSON의 packs를 손으로 반영',
        () => buildPackImportPrompt(ta.value)));
    }
    // 임포터 결과/실패 사유는 버튼 바로 아래 — 층 위쪽의 안내(assetNote)와 섞이면 못 알아챈다
    if (assetImportNote) box.appendChild(h('div', {
      class: assetImportNote.startsWith('팩 ') ? 'sce-ok' : 'sce-warn' }, assetImportNote));
    return box;
  }

  function deepTabs() {
    const tabs = h('div', { class: 'sce-tabs' });
    for (const [key, label] of TABS) {
      tabs.appendChild(h('button', {
        class: 'sce-tab' + (activeTab === key ? ' on' : ''),
        onclick: () => { activeTab = key; render(); },
      }, label));
    }
    return tabs;
  }

  function deepBody() {
    return { vars: tabVars, commands: tabCommands, status: tabStatus, party: tabParty, rules: tabRules, actions: tabActions,
      checks: tabChecks, time: tabTime, setup: tabSetup, ai: tabAi }[activeTab]();
  }

  // 라이브 검증 리포트 — 오류는 항상 보이고, 경고는 많으면 접는다 (수백 줄이 오류를 가리는 것 방지)
  function buildReport(v) {
    let html = '';
    for (const e of v.errors) html += `<div class="sce-err">✗ ${escText(e.path)} — ${escText(e.msg)}</div>`;
    const wHtml = v.warnings.map((w) => `<div class="sce-warn">⚠ ${escText(w.path)} — ${escText(w.msg)}</div>`).join('');
    if (v.warnings.length > 3) {
      html += `<details class="sce-fold"${reportWarnOpen ? ' open' : ''}><summary class="sce-warn">⚠ 경고 ${v.warnings.length}건 — 눌러서 펼치기</summary>${wHtml}</details>`;
    } else html += wHtml;
    if (v.ok) html += `<div class="sce-ok">✓ 스키마 유효${v.warnings.length ? ` (경고 ${v.warnings.length})` : ''}</div>`;
    reportEl.innerHTML = html;
    const fold = reportEl.querySelector('details.sce-fold');
    if (fold) fold.addEventListener('toggle', () => { reportWarnOpen = fold.open; });
  }

  function render() {
    root.innerHTML = '';
    // ── 삼층 구조 (docs/design-접근성.md §2) ──
    // 1층 = AI에게 맡기기(창작/결과/진단), 2층 = JSON 작업대, 3층 = 심층 편집 탭.
    // 층은 어떻게 나뉘어 보이든 같은 스키마·같은 rerender — 어느 층에서 고쳐도 다 반영된다.
    const v = validateSchema(schema);
    buildReport(v);

    // 호스트 사이드 내비 모드 — 층 하나만 (v0.47.4: 2·3층을 사이드바로 승격, 스크롤 압박 제거)
    if (floorView) {
      if (floorView === 'json') {
        root.appendChild(tabJson());
        root.appendChild(reportEl);
      } else if (floorView === 'assets') {
        root.appendChild(assetsFloor());
        root.appendChild(reportEl);
      } else if (floorView === 'deep') {
        root.appendChild(deepTabs());
        root.appendChild(deepBody());
        root.appendChild(reportEl);
      } else {
        root.appendChild(topFloor());
      }
      return;
    }

    // 스택형 폴백 — 1층 + 2·3층 접기 (층 내비가 없는 호스트: 플레이그라운드 등)
    root.appendChild(topFloor());

    const jsonFloor = h('details', { class: 'sce-lower' },
      h('summary', {}, '🧾 JSON 작업대 — 통짜 생성 · 패치 · 오류 돌려주기 · 원본'),
      tabJson());
    jsonFloor.open = jsonOpen;
    jsonFloor.addEventListener('toggle', () => { jsonOpen = jsonFloor.open; });
    root.appendChild(jsonFloor);

    const assetFold = h('details', { class: 'sce-lower' },
      h('summary', {}, '🎨 에셋 팩 — 이미지 태그 자동화'),
      assetsFloor());
    assetFold.open = assetsOpen;
    assetFold.addEventListener('toggle', () => { assetsOpen = assetFold.open; });
    root.appendChild(assetFold);

    const lower = h('details', { class: 'sce-lower' },
      h('summary', {}, `🧰 직접 만지기 — 심층 편집 탭${v.ok ? '' : ` (✗ 오류 ${v.errors.length})`}`),
      deepTabs(), deepBody(), reportEl);
    lower.open = lowerOpen;
    lower.addEventListener('toggle', () => { lowerOpen = lower.open; });
    root.appendChild(lower);
  }

  function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function num(x) { const n = Number(x); return isFinite(n) ? n : 0; }
  function numOrNull(x) { if (x === '' || x == null) return null; const n = Number(x); return isFinite(n) ? n : null; }
  function smartVal(sch, id, raw) {
    const def = sch.vars.find((v) => v.id === id);
    if (!def) return raw;
    if (def.type === 'int' || def.type === 'float') return num(raw);
    if (def.type === 'bool') return raw === 'true' || raw === '1' || raw === 'ON';
    return raw;
  }

  render();

  return {
    getSchema: () => JSON.parse(JSON.stringify(schema)),
    setSchema: (s) => { schema = JSON.parse(JSON.stringify(s)); rerender(); },
    setFloor: (f) => { floorView = f || null; render(); }, // 'top'|'json'|'assets'|'deep'|null(스택형)
    validateNow: () => validateSchema(schema),
    destroy: () => { destroyed = true; container.innerHTML = ''; },
  };
}

module.exports = { createSchemaEditor, detectSlotsFromNames, packDraftFromDetect, packCoverage, buildPackImportPrompt, estTokens, estAssetCost };
