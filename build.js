// SimCore 빌드 — core/*를 번들해 dist/simcore.plugin.js 와 playground.html 생성
// 실행: node build.js

const fs = require('fs');
const path = require('path');

const CORE = ['expr', 'rng', 'store', 'time', 'fight', 'validate', 'assets', 'party', 'calendar', 'scenario', 'board', 'messenger', 'shop', 'patch', 'engine', 'render', 'session', 'diagnose', 'editor', 'templates'];
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

// ── CJS → 브라우저 심 ──────────────────────────────────────
function wrapModule2(name, code) {
  return `SimCore.define(${JSON.stringify(name)}, function (require, module, exports) {\n${code}\n});\n`;
}

const SHIM2 = `
const SimCore = (() => {
  const mods = {};
  const cache = {};
  const define = (name, fn) => { mods[name] = fn; };
  const requireFn = (name) => {
    const key = name.replace(/^\\.\\//, '').replace(/^\\.\\.\\/core\\//, '').replace(/\\.js$/, '');
    if (cache[key]) return cache[key].exports;
    const fn = mods[key];
    if (!fn) throw new Error('module not found: ' + name);
    const module = { exports: {} };
    cache[key] = module;
    fn(requireFn, module, module.exports);
    return module.exports;
  };
  return { define, require: requireFn };
})();
`;

function bundleCore() {
  return SHIM2 + CORE.map((n) => wrapModule2(n, read(`core/${n}.js`))).join('\n');
}

// ── 1. 리스 플러그인 ───────────────────────────────────────
function buildPlugin() {
  const adapter = read('adapter/risu-plugin.js');
  // //@ 헤더는 파일 최상단에 있어야 하므로 헤더를 앞으로 뺀다
  const lines = adapter.split('\n');
  const headerEnd = lines.findIndex((l) => !l.startsWith('//'));
  const header = lines.slice(0, headerEnd).join('\n');
  const body = lines.slice(headerEnd).join('\n');
  const out = `${header}\n\n${bundleCore()}\n${body}`;
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'dist/simcore.plugin.js'), out);
  console.log('dist/simcore.plugin.js 생성');
}

// ── 2. 플레이그라운드 ──────────────────────────────────────
function buildPlayground() {
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SimCore 플레이그라운드</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, 'Apple SD Gothic Neo', sans-serif; background: #14161a; color: #dfe3ea; }
  header { padding: 14px 20px; border-bottom: 1px solid #2a2e36; display: flex; align-items: baseline; gap: 12px; }
  header h1 { font-size: 16px; margin: 0; }
  header .sub { font-size: 12px; opacity: .55; }
  main { display: grid; grid-template-columns: minmax(340px, 44%) 1fr; gap: 0; height: calc(100vh - 49px); }
  section { padding: 14px 16px; overflow: auto; }
  .left { border-right: 1px solid #2a2e36; display: flex; flex-direction: column; gap: 8px; }
  textarea { width: 100%; background: #0e1013; color: #cfd6e4; border: 1px solid #2a2e36; border-radius: 8px; padding: 10px; font-family: ui-monospace, monospace; font-size: 12px; resize: vertical; }
  #schema { flex: 1; min-height: 240px; }
  button { background: #232833; color: #dfe3ea; border: 1px solid #3a4150; border-radius: 8px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
  button:hover { background: #2c3342; }
  button.primary { background: #3856c1; border-color: #4a68d4; }
  button.primary:hover { background: #4062d8; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .report { font-size: 12px; white-space: pre-wrap; font-family: ui-monospace, monospace; }
  .report .err { color: #ef6a6a; } .report .warn { color: #e0b355; } .report .ok { color: #6ac97f; }
  h3 { font-size: 13px; margin: 14px 0 6px; opacity: .75; }
  .turnlog { border: 1px solid #2a2e36; border-radius: 10px; padding: 10px 12px; margin-top: 10px; font-size: 13px; }
  .turnlog .who { font-weight: 600; opacity: .6; font-size: 11px; margin-bottom: 4px; }
  .promptblock { background: #0e1013; border-radius: 8px; padding: 8px 10px; font-family: ui-monospace, monospace; font-size: 11.5px; white-space: pre-wrap; opacity: .85; }
  details.aux { font-size: 12px; opacity: .8; margin-top: 6px; }
  #status-live { position: sticky; top: 0; background: #14161a; padding-bottom: 6px; z-index: 5; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #232833; opacity: .8; }
  label { font-size: 12px; opacity: .75; }
</style>
<style id="simcore-css"></style>
</head>
<body>
<header>
  <h1>SimCore 플레이그라운드</h1>
  <span class="sub">리스 없이 엔진 턴 루프를 그대로 시뮬 — 회사에서 몰래 굴리기 좋음</span>
</header>
<main>
  <section class="left">
    <div class="row">
      <button class="primary" id="apply">스키마 적용 (세션 리셋)</button>
      <button id="reset">처음부터</button>
      <span class="pill" id="ver"></span>
    </div>
    <div class="row">
      <select id="template"></select>
      <button id="load-template">템플릿 불러오기</button>
    </div>
    <div class="report" id="report"></div>
    <div id="editor" style="flex:1; overflow:auto; margin-top:6px"></div>
  </section>
  <section>
    <div class="row" id="presets" style="margin-bottom:8px"></div>
    <div class="row" id="actions" style="margin-bottom:8px"></div>
    <div id="status-live"></div>
    <h3 id="turn-title">이번 턴 — AI 응답(서사)을 직접 쓰거나 예시 버튼</h3>
    <textarea id="narrative" rows="3" placeholder="예: 영주는 남작가의 용병단을 고용했다. 계약금으로 금화가 빠져나갔지만 병사들의 사기가 올랐다."></textarea>
    <details class="aux"><summary>보조 모델에게 실제로 갈 프롬프트 보기</summary><div class="promptblock" id="auxprompt"></div></details>
    <div class="row" style="margin-top:6px">
      <label>보조 모델 응답(JSON 흉내):</label>
      <button id="fill-example">예시 채우기</button>
    </div>
    <textarea id="aux" rows="3" spellcheck="false">{"changes":{},"reasons":{}}</textarea>
    <div class="row" style="margin-top:8px">
      <button class="primary" id="turn">턴 진행 ▶</button>
      <button id="reroll">리롤 (같은 턴 다시)</button>
      <span class="pill" id="turninfo"></span>
    </div>
    <h3>턴 로그</h3>
    <div id="log"></div>
  </section>
</main>
<script>
${bundleCore()}
</script>
<script>
const { validateSchema } = SimCore.require('validate');
const { SimSession } = SimCore.require('session');
const { MapBackend } = SimCore.require('store');
const { renderStatusHtml, scopeCss, buildStatusCss, BASE_CSS } = SimCore.require('render');
const { createSchemaEditor } = SimCore.require('editor');
const { TEMPLATES } = SimCore.require('templates');
const engine = SimCore.require('engine');

const DEFAULT_SCHEMA = TEMPLATES.estate.schema;

const $ = (id) => document.getElementById(id);
let schema = null, session = null, msgCount = 0, lastLog = [];
const editor = createSchemaEditor($('editor'), DEFAULT_SCHEMA, {});

const EXAMPLES = [
  { n: '영주는 남작가의 용병단 30명을 고용했다. 계약금 120골드가 빠져나갔다.', a: { changes: { gold: -120, military: 30 }, reasons: { gold: '용병 계약금', military: '용병단 합류' } } },
  { n: '풍년이다. 곡창이 가득 찼고 백성들의 얼굴에 웃음이 돈다.', a: { changes: { food: 200, loyalty: 8 }, reasons: { food: '풍년 수확', loyalty: '민심 고조' } } },
  { n: '이웃 영지에서 유민 50여 명이 흘러들어왔다. 정착지를 마련해 주었다.', a: { changes: { population: 50, gold: -50 }, reasons: { population: '유민 정착', gold: '정착 지원금' } } },
];
const SETUP_EXAMPLE = {
  n: '"몰락한 변경백으로 시작하고 싶어. 금고는 거의 비었고, 백성도 병사도 얼마 안 남은 가을." — 알겠다. 낙엽 지는 폐허의 성문 앞, 그대의 재건이 시작된다.',
  a: { values: { gold: 150, food: 120, population: 90, loyalty: 30, military: 15, situation: '몰락 직후, 재건의 첫걸음', season: '가을' }, reasons: { gold: '몰락한 배경' } },
};
let exampleIdx = 0;

function isSetupNow() {
  return session && engine.isSetupPending(schema, session.current);
}

function renderPresets() {
  const div = $('presets');
  div.innerHTML = '';
  const presets = schema.setup?.presets || [];
  for (const p of presets) {
    const b = document.createElement('button');
    b.textContent = '프리셋: ' + (p.label ?? p.id);
    b.onclick = () => { session.applyPreset(p.id); renderLive(); updateAuxPromptPreview(); };
    div.appendChild(b);
  }
  if (isSetupNow()) {
    const s = document.createElement('span');
    s.className = 'pill';
    s.textContent = '⏳ AI 최초설정 대기 — 다음 [턴 진행]은 세션 0 (절대값 세팅, 틱 없음)';
    div.appendChild(s);
  }
}

function applySchema() {
  const parsed = editor.getSchema();
  const r = validateSchema(parsed);
  let html = '';
  for (const e of r.errors) html += '<span class="err">✗ ' + e.path + ' — ' + e.msg + '</span>\\n';
  for (const w of r.warnings) html += '<span class="warn">⚠ ' + w.path + ' — ' + w.msg + '</span>\\n';
  if (r.ok) html += '<span class="ok">✓ 스키마 유효 — 세션 시작' + (r.warnings.length ? ' (경고 ' + r.warnings.length + ')' : '') + '</span>';
  $('report').innerHTML = html;
  if (!r.ok) return;
  schema = parsed;
  $('simcore-css').textContent = buildStatusCss(schema);
  resetSession();
}

function resetSession() {
  session = new SimSession(schema, new MapBackend(), { chatId: 'playground' });
  session.init();
  msgCount = 0; lastLog = [];
  $('log').innerHTML = '';
  $('ver').textContent = (schema.meta?.name ?? '이름 없음') + ' · simcore ' + schema.simcore;
  renderPresets();
  renderLive();
  updateAuxPromptPreview();
  turnInfo();
}

function actionStates() {
  return (schema.actions || []).map((a) => {
    const avail = engine.actionAvailability(schema, session.current, a);
    return { id: a.id, label: a.label, armed: !!session.current.meta.armed[a.id], disabled: !avail.ok, reason: avail.reason };
  });
}

function renderLive() {
  $('status-live').innerHTML = renderStatusHtml(schema, session.current, lastLog, actionStates());
  renderActions();
}

// 상태창 속 액션은 표시 전용(v0.38) — 플레이그라운드에서는 별도 버튼줄로 토글
function renderActions() {
  const div = $('actions');
  div.innerHTML = '';
  for (const a of actionStates()) {
    const b = document.createElement('button');
    b.textContent = (a.armed ? '● ' : '') + a.label;
    b.dataset.action = a.id;
    if (a.disabled && !a.armed) { b.disabled = true; b.title = a.reason || ''; }
    b.onclick = () => {
      const r = session.toggle(a.id);
      if (r.blocked) console.warn('[simcore] 차단:', r.blocked);
      renderLive();
      updateAuxPromptPreview();
    };
    div.appendChild(b);
  }
}

function updateAuxPromptPreview() {
  const narrative = $('narrative').value || '(서사)';
  $('auxprompt').textContent = isSetupNow()
    ? engine.buildSetupPrompt(schema, session.current, narrative)
    : engine.buildAuxPrompt(schema, session.current, narrative);
  $('turn-title').textContent = isSetupNow()
    ? '세션 0 (최초 설정) — 시작 상황 대화를 쓰고 보조 모델 응답은 {"values":...} 형식'
    : '이번 턴 — AI 응답(서사)을 직접 쓰거나 예시 버튼';
}

function turnInfo() {
  $('turninfo').textContent = '엔진 턴 ' + session.current.meta.turn + ' · 다음 인덱스 ' + msgCount;
}

async function runTurn(rerun) {
  if (!session) return;
  const sendIndex = rerun ? Math.max(0, msgCount - 2) : msgCount;
  const send = await session.onSend(sendIndex);
  const isSetup = await session.isSetupTurn(sendIndex + 1);
  const out = isSetup
    ? await session.onSetupOutput(sendIndex + 1, $('aux').value)
    : await session.onOutput(sendIndex + 1, $('aux').value);
  if (!rerun) msgCount += 2;
  lastLog = [...send.changeLog, ...out.changeLog];

  const div = document.createElement('div');
  div.className = 'turnlog';
  const narrative = $('narrative').value.trim() || '(서사 없음)';
  div.innerHTML =
    '<div class="who">↑ 모델에 주입된 상태 블록' + (rerun ? ' — 리롤' : '') + (isSetup ? ' — 세션 0 (최초 설정)' : '') + '</div>' +
    '<div class="promptblock">' + escapeHtml(send.promptBlock) + '</div>' +
    '<div class="who" style="margin-top:8px">AI 서사 (수동 입력)</div>' +
    '<div>' + escapeHtml(narrative) + '</div>' +
    (out.firedEvents.length ? '<div class="who" style="margin-top:8px">발동 이벤트</div><div>' + out.firedEvents.join(', ') + '</div>' : '') +
    renderStatusHtml(schema, out.state, lastLog, null);
  $('log').prepend(div);
  renderPresets();
  renderLive();
  updateAuxPromptPreview();
  turnInfo();
}

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

$('apply').onclick = applySchema;
$('reset').onclick = () => { if (schema) resetSession(); };
$('turn').onclick = () => runTurn(false);
$('reroll').onclick = () => { if (msgCount > 0) runTurn(true); };
$('fill-example').onclick = () => {
  const ex = isSetupNow() ? SETUP_EXAMPLE : EXAMPLES[exampleIdx++ % EXAMPLES.length];
  $('narrative').value = ex.n;
  $('aux').value = JSON.stringify(ex.a);
  updateAuxPromptPreview();
};
$('narrative').addEventListener('input', updateAuxPromptPreview);

for (const [key, t] of Object.entries(TEMPLATES)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = t.label;
  if (key === 'estate') opt.selected = true;
  $('template').appendChild(opt);
}
$('load-template').onclick = () => {
  const t = TEMPLATES[$('template').value];
  if (t) { editor.setSchema(JSON.parse(JSON.stringify(t.schema))); applySchema(); }
};

applySchema();
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(__dirname, 'playground.html'), html);
  console.log('playground.html 생성');
}

buildPlugin();
buildPlayground();
