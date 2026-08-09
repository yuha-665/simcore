// SimCore 블록 편집기 — 코딩 없이 스키마를 행 단위로 만드는 공용 DOM 컴포넌트.
// 플러그인 패널(iframe)과 플레이그라운드 양쪽에서 사용. 프레임워크 없음.
//
// createSchemaEditor(container, schema, { onChange, ai }) →
//   { getSchema(), setSchema(s), validateNow(), destroy() }
// ai = { generate(prompt), getBotContext() } — 내장 AI 생성(위층)용 호스트 주입. 없으면 복사 옆문만 뜬다.

// 카드 순서를 **끌어서** 바꾸는 길 (v0.66 UI 개조판에서 들어옴).
// 순서 바꾸기 자체는 grip()의 ▲▼ 버튼이 그대로 맡고 있어서 이건 덧붙임이고, 꺼도 기능은 안 잃는다.
// v0.66.0에서 실기 확인 전이라 잠깐 꺼 뒀다가 v0.66.1에서 켰다 (유저 요청).
// ⚠ 끌 때는 CSS도 같이 봐야 한다 — 손잡이 자리를 고정 폭 격자 열로 잡아 두면 손잡이가 없을 때
// 그 열로 다른 게 밀려 들어간다 (실측: 상태창 항목 셀렉트가 30px로 찌그러졌다).
// 지금은 그 자리를 flex로 바꿔 둬서 꺼도 안 무너진다.
const CARD_DRAG = true;

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
.sce {
  --sce-bg:var(--sc-bg, #171a1f); --sce-surface:var(--sc-surface, #1d2127);
  --sce-surface-soft:var(--sc-surface-soft, #242a31); --sce-field:var(--sc-field, #12161b);
  --sce-line:var(--sc-line, #3b4652); --sce-line-strong:var(--sc-line-strong, #526171);
  --sce-text:var(--sc-text, #e3e7eb); --sce-text-strong:var(--sc-text-strong, #f7f9fb);
  --sce-muted:var(--sc-muted, #b6bec8); --sce-accent:var(--sc-accent, #78a9ff);
  --sce-accent-strong:var(--sc-accent-strong, #4f7fe8); --sce-focus:var(--sc-focus, #9ac2ff);
  --sce-success:var(--sc-success, #79d99a); --sce-warning:var(--sc-warning, #f1cb72);
  --sce-danger:var(--sc-danger, #ff9292); --sce-danger-bg:var(--sc-danger-bg, #3a2225);
  /* 심층 편집 작업 폭 — 탭 바부터 오류줄까지 이 한 값을 쓴다. 개별 상자에 숫자를 박으면
     새 상자를 넣을 때마다 하나씩 어긋난다 (실측: 소개 상자만 끝까지 늘어나 있었다).
     100% = 패널을 채운다. 재설계 전 탭(규칙·이벤트 뒤쪽)이 원래 이렇게 도는데, 앞쪽 넷만
     좁혀 두니 탭을 옮길 때마다 오른쪽 끝이 튀었다 — 좁히려면 여기 한 곳만 px로 바꾸면
     되고, 그래도 오른쪽 끝은 계속 한 줄로 떨어진다. */
  --sce-work-w:100%;
  color:var(--sce-text); font-family:var(--sc-font-body, 'Pretendard Variable', Pretendard,
    'SUIT Variable', 'Noto Sans KR', system-ui, sans-serif); font-size:14px; line-height:1.6;
  overflow-wrap:anywhere; text-rendering:optimizeLegibility; -webkit-font-smoothing:antialiased;
}
.sce * { box-sizing:border-box; }
.sce .sce-tabs { display:flex; gap:18px; flex-wrap:wrap; border-bottom:1px solid var(--sce-line); margin-bottom:12px; }
.sce .sce-tab { min-height:38px; padding:7px 2px; cursor:pointer; border:0; border-radius:0;
  color:var(--sce-muted); background:transparent; font:inherit; font-size:13.5px; }
.sce .sce-tab.on { color:var(--sce-text-strong); background:transparent; font-weight:650;
  box-shadow:inset 0 -2px 0 var(--sce-accent); }
.sce .sce-block { border:1px solid var(--sce-line); border-left:3px solid var(--sce-line-strong); border-radius:4px;
  padding:10px 12px; margin-bottom:9px; background:var(--sce-surface); }
.sce .sce-row { display:flex; gap:7px; align-items:center; flex-wrap:wrap; margin:5px 0; }
.sce .sce-row > label, .sce .sce-pair > label { color:var(--sce-muted); font-size:12.5px; font-weight:550; }
.sce .sce-pair { display:inline-flex; gap:6px; align-items:center; white-space:nowrap; }
.sce input, .sce select, .sce textarea { min-height:38px; background:var(--sce-field); color:var(--sce-text-strong);
  border:1px solid var(--sce-line-strong); border-radius:5px; padding:6px 9px; font:inherit; font-size:13.5px; }
.sce input::placeholder, .sce textarea::placeholder { color:#929ca7; opacity:1; }
.sce input[type=checkbox] { width:auto; min-height:auto; accent-color:var(--sce-accent-strong); }
.sce input.sce-w-s { width:76px; } .sce input.sce-w-m { width:120px; }
.sce input.sce-w-l { width:100%; flex:1; min-width:140px; }
.sce textarea { width:100%; min-height:72px; font-family:var(--sc-font-mono, 'D2Coding', ui-monospace, monospace); resize:vertical; }
.sce .sce-btn { min-height:38px; background:var(--sce-surface-soft); color:var(--sce-text-strong);
  border:1px solid var(--sce-line-strong); border-radius:5px; padding:7px 11px; cursor:pointer;
  font:inherit; font-size:13.5px; font-weight:600; line-height:1.25; word-break:keep-all; }
.sce .sce-btn.sce-add { border-style:dashed; color:var(--sce-accent); width:100%; margin-top:2px; }
.sce .sce-btn.sce-mini { min-height:32px; padding:4px 8px; font-size:12.5px; }
.sce .sce-btn.sce-danger { color:var(--sce-danger); }
.sce .sce-btn:disabled { opacity:.5; cursor:not-allowed; }
.sce .sce-grip { display:flex; gap:3px; margin-left:auto; }
.sce .sce-sub { margin-left:14px; padding-left:10px; border-left:2px solid var(--sce-line); }
.sce .sce-hint { color:var(--sce-muted); font-size:12.5px; margin:3px 0 7px; line-height:1.6; }
.sce .sce-field-label { display:block; margin:12px 0 5px; color:var(--sce-text-strong);
  font-size:12.5px; font-weight:700; }
.sce .sce-report { font-family:var(--sc-font-mono, 'D2Coding', ui-monospace, monospace);
  font-size:12.5px; white-space:pre-wrap; margin-top:8px; }
.sce .sce-err { color:var(--sce-danger); font-weight:650; }
.sce .sce-warn { color:var(--sce-warning); }
.sce .sce-ok { color:var(--sce-success); font-weight:650; }
.sce details.sce-fold { margin:4px 0; }
.sce details.sce-fold > summary { cursor:pointer; user-select:none; color:var(--sce-text); }
.sce details.sce-fold > div { margin-left:12px; }
.sce .sce-tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11.5px; letter-spacing:.02em;
  background:var(--sce-surface-soft); color:var(--sce-text); border:1px solid var(--sce-line-strong); }
.sce .sce-preview { margin-top:10px; }
.sce .sce-chips { display:flex; gap:6px; flex-wrap:wrap; }
.sce .sce-chip { display:flex; align-items:center; gap:4px; border:1px solid var(--sce-line-strong);
  border-radius:7px; padding:4px 8px; font-size:12.5px; color:var(--sce-text); }
.sce h4 { margin:17px 0 7px; font-size:13.5px; color:var(--sce-text-strong); padding-left:9px;
  border-left:3px solid var(--sce-accent); letter-spacing:-.01em; }
.sce .sce-swatches { display:inline-flex; gap:4px; align-items:center; flex-wrap:wrap; }
.sce .sce-swatch { width:24px !important; height:24px !important; min-width:0 !important;
  border-radius:5px !important; border:1px solid var(--sce-line-strong) !important;
  cursor:pointer; padding:0 !important; flex:none; }
.sce .sce-swatch.on { outline:2px solid var(--sce-focus) !important; outline-offset:2px; }
.sce input[type=color] { width:34px !important; height:30px !important; min-width:0 !important;
  padding:2px !important; border-radius:5px !important; background:transparent !important; cursor:pointer; }
.sce .sce-colorbox { display:flex; flex-direction:column; gap:4px; margin:4px 0; padding:7px 9px;
  border:1px dashed var(--sce-line-strong); border-radius:6px; }
.sce .sce-top { border-left-color:#6f9ed6; border-radius:4px; background:var(--sce-surface); }
.sce .sce-ai-setup { margin-top:11px; padding:9px 0;
  border-top:1px solid var(--sce-line); border-bottom:1px solid var(--sce-line); }
.sce .sce-ai-section-label { margin-bottom:7px; color:var(--sce-text-strong); font-size:13px; font-weight:750; }
.sce .sce-ai-request-head { display:flex; justify-content:space-between; align-items:end; gap:8px 14px;
  margin:12px 0 5px; flex-wrap:wrap; }
.sce .sce-ai-request-head .sce-field-label { margin:0; }
.sce .sce-ai-request-mode { color:var(--sce-muted); font-size:11.5px; }
.sce .sce-ai-request { min-height:92px !important; font-family:inherit; line-height:1.6; }
.sce .sce-ai-settings-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.15fr); gap:8px;
  align-items:stretch; }
.sce .sce-ai-setting-card { min-width:0; padding:9px 10px; border:1px solid var(--sce-line);
  border-radius:4px; background:transparent; height:100%; }
.sce .sce-ai-setting-name { margin-bottom:6px; color:var(--sce-text-strong); font-size:12px; font-weight:700; }
.sce .sce-ai-context { display:grid; gap:6px; margin:0; align-items:start; }
.sce .sce-ai-context-toggle { display:flex; align-items:flex-start; gap:8px; width:fit-content; max-width:100%;
  color:var(--sce-text-strong); font-size:13px; font-weight:650; cursor:pointer; }
.sce .sce-ai-context-toggle input { flex:none; margin-top:4px; }
.sce .sce-ai-context-meta { display:grid; grid-template-columns:repeat(2,minmax(0,1fr));
  border-top:1px solid var(--sce-line); padding-top:5px; }
.sce .sce-ai-context-meta span { min-width:0; padding:1px 8px 1px 0; color:var(--sce-muted);
  font-size:11.5px; font-variant-numeric:tabular-nums; }
.sce .sce-ai-context-meta span:nth-child(even) { padding-left:8px; border-left:1px solid var(--sce-line); }
.sce .sce-ai-model-row { display:grid; grid-template-columns:auto minmax(180px,1fr); gap:6px 8px; margin:0; }
.sce .sce-ai-model-row > .sce-hint { align-self:center; }
.sce .sce-ai-model-copy { grid-column:1 / -1; margin:0; color:var(--sce-muted); font-size:12px; line-height:1.55; }
.sce .sce-ai-context-note { display:block; color:var(--sce-muted); font-size:11.5px; font-weight:400; }
.sce .sce-ai-action-row { justify-content:space-between; margin:10px 0 0; padding-top:10px;
  border-top:1px solid var(--sce-line); }
.sce .sce-ai-action-hint { color:var(--sce-muted); font-size:12px; }
.sce .sce-btn.sce-ai-primary { min-width:124px; background:var(--sce-accent-strong);
  border-color:var(--sce-accent); color:#fff; }
.sce .sce-ai-alt { margin-top:13px; padding-top:11px; border-top:1px solid var(--sce-line); }
.sce .sce-ai-alt-title { margin-bottom:2px; color:var(--sce-text-strong); font-size:12.5px; font-weight:750; }
.sce .sce-design-polish { display:flex; align-items:center; gap:6px 10px; flex-wrap:wrap; margin:8px 0 10px;
  padding:8px 0; border-top:1px solid var(--sce-line); border-bottom:1px solid var(--sce-line); background:transparent; }
.sce .sce-design-polish .sce-chip { flex:none; padding:0; border:0; border-radius:0; background:transparent; }
.sce .sce-hallmark-link { display:inline-flex; align-items:center; gap:4px; color:var(--sce-accent);
  font-size:12px; font-weight:650; text-decoration:none; white-space:nowrap; }
.sce .sce-hallmark-link:hover { text-decoration:underline; text-underline-offset:2px; }
.sce .sce-result-section { margin-top:14px; padding-top:13px; border-top:1px solid var(--sce-line); }
.sce .sce-result-section:first-of-type { margin-top:0; padding-top:0; border-top:0; }
.sce .sce-result-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:8px; }
.sce .sce-result-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-result-copy { margin-top:2px; color:var(--sce-muted); font-size:12px; line-height:1.5; }
.sce .sce-mode-switch { display:flex; align-items:center; gap:8px; flex-wrap:wrap; width:100%; margin:4px 0 9px; }
.sce .sce-mode-btn { min-height:34px; padding:5px 10px; border:1px solid var(--sce-line-strong); border-radius:4px;
  background:transparent; color:var(--sce-muted); font:inherit; font-size:12px; cursor:pointer; }
.sce .sce-mode-btn.on { background:var(--sce-surface-soft); color:var(--sce-text-strong); font-weight:700;
  border-color:var(--sce-accent); box-shadow:inset 0 -2px 0 var(--sce-accent); }
.sce .sce-design-actions { display:grid; grid-template-columns:minmax(0,1fr); gap:7px; align-items:start; }
.sce .sce-design-request { width:100%; min-height:112px; padding:9px 10px; font-family:inherit;
  line-height:1.55; resize:vertical; }
.sce .sce-design-controls { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
.sce .sce-design-controls .sce-btn { flex:none; }
.sce .sce-design-controls .sce-btn.sce-ai-primary { min-width:100px; }
.sce .sce-generation-state { min-height:20px; margin-top:7px; color:var(--sce-muted); font-size:12px; }
.sce .sce-generation-state.ok { color:var(--sce-success); }
.sce .sce-generation-state.warn { color:var(--sce-warning); }
.sce .sce-catalog-counts { display:flex; gap:6px 14px; flex-wrap:wrap; color:var(--sce-text);
  font-size:12.5px; font-variant-numeric:tabular-nums; }
.sce .sce-catalog-counts b { color:var(--sce-text-strong); }
.sce .sce-catalog-details { margin-top:8px; border-top:1px solid var(--sce-line); padding-top:8px; }
.sce .sce-catalog-details > summary { width:fit-content; color:var(--sce-text); cursor:pointer; font-size:12.5px; }
.sce .sce-catalog-group { margin-top:12px; }
.sce .sce-catalog-group > h4 { margin-top:0; }
.sce .sce-catalog-grid, .sce .sce-event-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr));
  gap:8px; align-items:stretch; }
.sce .sce-catalog-item, .sce .sce-event-row { min-width:0; padding:9px 10px; border:1px solid var(--sce-line);
  border-radius:4px; background:var(--sce-field); }
.sce .sce-catalog-item-title { color:var(--sce-text-strong); font-size:12.5px; font-weight:700; overflow-wrap:anywhere; }
.sce .sce-catalog-item-detail { margin-top:3px; color:var(--sce-muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.sce .sce-event-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px; }
.sce .sce-event-kind { flex:none; padding:2px 6px; border:1px solid var(--sce-line-strong); border-radius:3px;
  color:var(--sce-text); font-size:10.5px; font-weight:700; letter-spacing:.02em; }
.sce .sce-event-title { min-width:0; color:var(--sce-text-strong); font-size:13px; font-weight:700;
  overflow-wrap:anywhere; }
.sce .sce-event-fields { display:grid; grid-template-columns:minmax(104px,auto) minmax(0,1fr); margin:0; }
.sce .sce-event-fields dt, .sce .sce-event-fields dd { min-width:0; margin:0; padding:4px 0;
  border-top:1px solid var(--sce-line); font-size:12px; line-height:1.5; }
.sce .sce-event-fields dt { padding-right:10px; color:var(--sce-muted); font-weight:650; }
.sce .sce-event-fields dd { color:var(--sce-text); overflow-wrap:anywhere; }
.sce .sce-diag-intro { margin:3px 0 12px; padding:9px 11px; border-left:2px solid var(--sce-accent);
  background:var(--sce-field); }
.sce .sce-diag-intro-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-diag-intro p { margin:3px 0 0; color:var(--sce-muted); font-size:12.5px; line-height:1.55; }
.sce .sce-diag-controls { display:grid; grid-template-columns:minmax(145px,190px) minmax(145px,190px) auto;
  gap:8px; align-items:end; padding:10px 0; border-top:1px solid var(--sce-line); border-bottom:1px solid var(--sce-line); }
.sce .sce-diag-field { display:grid; grid-template-columns:auto minmax(72px,1fr); gap:2px 8px; align-items:center; }
.sce .sce-diag-field > span { color:var(--sce-text-strong); font-size:12.5px; font-weight:700; }
.sce .sce-diag-field > small { grid-column:1 / -1; color:var(--sce-muted); font-size:11px; line-height:1.35; }
.sce .sce-diag-field input { width:100%; }
.sce .sce-diag-run { min-width:112px; }
.sce .sce-diag-status { min-height:20px; margin:6px 0 0; color:var(--sce-muted); font-size:12px; }
.sce .sce-diag-summary { margin:8px 0 12px; padding:10px 11px; border:1px solid var(--sce-line);
  border-left:3px solid var(--sce-line-strong); border-radius:4px; background:var(--sce-surface); }
.sce .sce-diag-summary-head { display:flex; justify-content:space-between; gap:8px 16px; align-items:center; flex-wrap:wrap; }
.sce .sce-diag-counts { display:flex; gap:7px 14px; flex-wrap:wrap; font-variant-numeric:tabular-nums; }
.sce .sce-diag-count { color:var(--sce-muted); font-size:12px; }
.sce .sce-diag-count strong { margin-left:3px; color:var(--sce-text-strong); font-size:14px; }
.sce .sce-diag-meta { color:var(--sce-text); font-size:12px; font-variant-numeric:tabular-nums; }
.sce .sce-diag-summary-detail { margin-top:6px; padding-top:6px; border-top:1px solid var(--sce-line);
  color:var(--sce-muted); font-size:12px; line-height:1.5; }
.sce .sce-diag-compare { margin:10px 0 13px; border:1px solid var(--sce-line); border-radius:4px;
  background:var(--sce-surface); }
.sce .sce-diag-compare-head { padding:9px 11px; border-bottom:1px solid var(--sce-line);
  color:var(--sce-text-strong); font-size:13px; font-weight:750; }
.sce .sce-diag-compare-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); }
.sce .sce-diag-compare-metric { min-width:0; padding:8px 10px; border-right:1px solid var(--sce-line); }
.sce .sce-diag-compare-metric:last-child { border-right:0; }
.sce .sce-diag-compare-metric span { display:block; color:var(--sce-muted); font-size:10.5px; }
.sce .sce-diag-compare-metric strong { display:block; margin-top:1px; color:var(--sce-text-strong);
  font-size:13.5px; font-variant-numeric:tabular-nums; }
.sce .sce-diag-compare-detail { display:grid; gap:4px; padding:9px 11px; border-top:1px solid var(--sce-line);
  color:var(--sce-muted); font-size:12px; line-height:1.55; }
.sce .sce-diag-clear { margin:10px 0 13px; padding:10px 11px; border:1px solid var(--sce-line);
  border-left:3px solid var(--sce-success); border-radius:4px; background:var(--sce-field); }
.sce .sce-diag-clear strong { display:block; color:var(--sce-text-strong); font-size:13.5px; }
.sce .sce-diag-clear span { display:block; margin-top:2px; color:var(--sce-muted); font-size:12px; line-height:1.55; }
.sce .sce-diag-group { margin-top:14px; }
.sce .sce-diag-group-head { display:flex; align-items:center; gap:7px; margin-bottom:7px; padding-left:8px;
  border-left:3px solid var(--sce-accent); color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-diag-group-count { color:var(--sce-muted); font-size:12px; font-weight:600; }
.sce .sce-diag-findings { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; align-items:start; }
.sce .sce-diag-finding { min-width:0; padding:11px 12px; border:1px solid var(--sce-line); border-radius:4px;
  background:var(--sce-field); }
.sce .sce-diag-group-high .sce-diag-finding { border-left:3px solid var(--sce-danger); }
.sce .sce-diag-group-mid .sce-diag-finding { border-left:3px solid var(--sce-warning); }
.sce .sce-diag-group-low .sce-diag-finding { border-left:3px solid var(--sce-accent); }
.sce .sce-diag-finding .sce-tag { border-radius:3px; padding:3px 7px; font-size:11.5px; }
.sce .sce-diag-finding-main { margin-top:7px; color:var(--sce-text-strong); font-size:13.5px; line-height:1.65;
  overflow-wrap:anywhere; }
.sce .sce-diag-finding-next { display:grid; grid-template-columns:72px minmax(0,1fr); gap:8px;
  margin-top:8px; padding-top:7px; border-top:1px solid var(--sce-line); color:var(--sce-text);
  font-size:12.5px; line-height:1.6; overflow-wrap:anywhere; }
.sce .sce-diag-finding-next > span { color:var(--sce-muted); font-size:11.5px; font-weight:700; }
.sce .sce-diag-group-fold { border-top:1px solid var(--sce-line); }
.sce .sce-diag-group-fold > summary { width:fit-content; padding:9px 0 7px; color:var(--sce-text);
  font-size:12.5px; font-weight:650; cursor:pointer; }
.sce .sce-diag-ai { margin-top:18px; padding-top:14px; border-top:1px solid var(--sce-line-strong); }
.sce .sce-diag-ai-head { margin-bottom:9px; }
.sce .sce-diag-ai-title { color:var(--sce-text-strong); font-size:15px; font-weight:750; }
.sce .sce-diag-ai-copy { margin-top:3px; color:var(--sce-muted); font-size:12.5px; line-height:1.6; }
.sce .sce-diag-ai-primary { display:flex; justify-content:space-between; align-items:center; gap:12px;
  padding:11px 12px; border:1px solid var(--sce-line); border-left:3px solid var(--sce-accent);
  border-radius:4px; background:var(--sce-field); }
.sce .sce-diag-ai-primary-text { min-width:0; }
.sce .sce-diag-ai-primary-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:700; }
.sce .sce-diag-ai-primary-copy { margin-top:2px; color:var(--sce-muted); font-size:12px; line-height:1.55; }
.sce .sce-diag-ai-more { margin-top:9px; border-top:1px solid var(--sce-line); }
.sce .sce-diag-ai-more > summary { padding:10px 0 7px; color:var(--sce-text); font-size:12.5px;
  font-weight:650; cursor:pointer; }
.sce .sce-diag-ai-more-body { display:grid; gap:10px; padding:2px 0 4px; }
.sce .sce-diag-ai-subhead { margin:2px 0 -2px; color:var(--sce-text-strong); font-size:12.5px; font-weight:700; }
.sce .sce-diag-ai-export-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.sce .sce-diag-ai-export-card { min-width:0; padding:10px 11px; border:1px solid var(--sce-line);
  border-radius:4px; background:var(--sce-field); }
.sce .sce-diag-ai-export-card.is-primary { border-left:3px solid var(--sce-accent); }
.sce .sce-diag-ai-export-card .sce-hint { margin-top:0; }
.sce .sce-diag-ai-export-card .sce-row { margin-bottom:0; }
.sce .sce-diag-rewrite { margin-top:2px; border-top:1px solid var(--sce-line); }
.sce .sce-diag-rewrite > summary { padding:9px 0; color:var(--sce-text); font-size:12.5px;
  font-weight:700; cursor:pointer; }
.sce .sce-diag-rewrite-body { display:grid; gap:8px; padding:0 0 4px; }
.sce .sce-diag-orphan { border-top:1px solid var(--sce-line); }
.sce .sce-diag-orphan > summary { width:fit-content; padding:8px 0 4px; color:var(--sce-muted);
  font-size:12px; cursor:pointer; }
.sce .sce-diag-orphan > div { padding:3px 0 5px; color:var(--sce-muted); font-size:12px; line-height:1.55; }
.sce .sce-diag-ai-warning { margin:10px 0 5px; padding:8px 10px; border-left:2px solid var(--sce-warning);
  color:var(--sce-muted); font-size:12px; line-height:1.6; background:var(--sce-field); }
.sce .sce-result-external { margin-top:12px; padding:10px 11px; border-left:2px solid var(--sce-line-strong);
  background:var(--sce-field); }
.sce .sce-result-external .sce-ai-alt-title { font-size:12px; }
.sce .sce-json-intro { margin:2px 0 12px; padding:9px 11px; border-left:2px solid var(--sce-accent);
  background:var(--sce-field); }
.sce .sce-json-intro-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-json-intro-copy { margin-top:3px; color:var(--sce-muted); font-size:12.5px; line-height:1.55; }
.sce .sce-json-paths { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; align-items:stretch; }
.sce .sce-json-path { min-width:0; padding:11px 12px; border:1px solid var(--sce-line); border-radius:4px;
  background:var(--sce-surface); display:flex; flex-direction:column; height:100%; }
.sce .sce-json-path.is-primary { border-left:3px solid var(--sce-accent); }
.sce .sce-json-path-head { display:flex; justify-content:space-between; gap:8px; align-items:start; margin-bottom:5px; }
.sce .sce-json-path-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-json-path-badge { flex:none; color:var(--sce-muted); font-size:10.5px; font-weight:700; }
.sce .sce-json-path-copy { min-height:38px; color:var(--sce-muted); font-size:12px; line-height:1.55; }
.sce .sce-json-path > .sce-hint { min-height:38px; margin:8px 0 0; }
.sce .sce-json-path > .sce-row { margin:7px 0 0; }
.sce .sce-json-path > .sce-row:last-of-type { margin-top:auto; padding-top:7px; }
.sce .sce-json-path > .sce-copy-output { margin-top:8px; }
.sce .sce-copy-output[hidden] { display:none !important; }
.sce .sce-json-workspace { margin-top:14px; padding-top:13px; border-top:1px solid var(--sce-line-strong); }
.sce .sce-json-section-head { display:flex; justify-content:space-between; gap:8px 16px; align-items:start;
  margin-bottom:7px; flex-wrap:wrap; }
.sce .sce-json-section-title { color:var(--sce-text-strong); font-size:14px; font-weight:750; }
.sce .sce-json-section-copy { margin-top:2px; color:var(--sce-muted); font-size:12px; line-height:1.5; }
.sce .sce-json-patch-input { min-height:138px; }
.sce .sce-json-action-row { justify-content:space-between; margin-top:8px; }
.sce .sce-json-action-state { color:var(--sce-muted); font-size:12px; }
.sce .sce-json-validation { margin-top:15px; padding-top:13px; border-top:1px solid var(--sce-line-strong); }
.sce .sce-json-validation-status { display:flex; gap:8px; align-items:flex-start; padding:8px 10px;
  border-left:3px solid var(--sce-success); background:var(--sce-field); }
.sce .sce-json-validation-status.is-error { border-left-color:var(--sce-danger); }
.sce .sce-json-validation-mark { flex:none; color:var(--sce-success); font-weight:800; }
.sce .sce-json-validation-status.is-error .sce-json-validation-mark { color:var(--sce-danger); }
.sce .sce-json-validation-main { color:var(--sce-text-strong); font-size:12.5px; font-weight:700; }
.sce .sce-json-validation-next { margin-top:2px; color:var(--sce-muted); font-size:12px; line-height:1.5; }
.sce .sce-json-source { margin-top:14px; border-top:1px solid var(--sce-line-strong);
  border-bottom:1px solid var(--sce-line); }
.sce .sce-json-source > summary { display:flex; justify-content:space-between; gap:10px; padding:11px 0;
  color:var(--sce-text); font-size:12.5px; font-weight:700; cursor:pointer; }
.sce .sce-json-source-body { padding:0 0 11px; }
.sce .sce-json-source textarea { min-height:300px; }
.sce .sce-json-source-state { min-height:20px; margin-top:6px; color:var(--sce-muted); font-size:12px; }
.sce .sce-json-source-state.is-dirty { color:var(--sce-warning); }
.sce .sce-json-import-preview { margin-top:9px; padding:10px 11px; border:1px solid var(--sce-line);
  border-left:3px solid var(--sce-accent); border-radius:4px; background:var(--sce-field); }
.sce .sce-json-import-preview.is-error { border-left-color:var(--sce-danger); }
.sce .sce-json-import-title { color:var(--sce-text-strong); font-size:13px; font-weight:750; }
.sce .sce-json-import-copy { margin-top:2px; color:var(--sce-muted); font-size:12px; line-height:1.5; }
.sce .sce-json-import-metrics { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); margin-top:8px;
  border-top:1px solid var(--sce-line); border-bottom:1px solid var(--sce-line); }
.sce .sce-json-import-metric { min-width:0; padding:6px 8px; border-right:1px solid var(--sce-line); }
.sce .sce-json-import-metric:last-child { border-right:0; }
.sce .sce-json-import-metric span { display:block; color:var(--sce-muted); font-size:10.5px; }
.sce .sce-json-import-metric strong { display:block; color:var(--sce-text-strong); font-size:13px;
  font-variant-numeric:tabular-nums; }
.sce .sce-json-import-errors { margin-top:8px; color:var(--sce-danger); font-size:12px; line-height:1.55; }
.sce .sce-json-import-applied { display:flex; justify-content:space-between; align-items:center; gap:8px 12px;
  margin-bottom:9px; padding:8px 10px; border-left:3px solid var(--sce-success); background:var(--sce-field); }
.sce .sce-json-import-applied span { color:var(--sce-text); font-size:12px; line-height:1.5; }
.sce .sce-vars-intro {
  width:100%; max-width:var(--sce-work-w); margin:2px 0 12px; padding:9px 11px; border-left:2px solid var(--sce-accent);
  background:var(--sce-field); }
.sce .sce-vars-intro-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-vars-intro-copy { margin-top:3px; color:var(--sce-muted); font-size:12.5px; line-height:1.55; }
.sce .sce-vars-ai { width:100%; max-width:var(--sce-work-w); margin:0 0 13px; padding:11px 12px 12px;
  border:1px solid var(--sce-line); border-left:2px solid var(--sce-accent); border-radius:4px;
  background:var(--sce-surface); }
.sce .sce-vars-ai-head { display:flex; justify-content:space-between; align-items:baseline; gap:8px 14px;
  margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--sce-line); }
.sce .sce-vars-ai-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-vars-ai-summary { color:var(--sce-muted); font-size:11.5px; font-weight:600; }
.sce .sce-tab-ai-vars { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);
  gap:0; margin:0; padding:0; border:0; background:transparent; }
.sce .sce-vars-ai-direct { grid-column:1 / -1; min-width:0; padding:0 0 9px;
  border-bottom:1px solid var(--sce-line); margin-bottom:4px; }
.sce .sce-vars-ai-direct > .sce-hint { margin-top:5px; }
.sce .sce-vars-ai-export, .sce .sce-vars-ai-import { min-width:0; padding:5px 12px 3px 0; }
.sce .sce-vars-ai-import { padding-left:12px; padding-right:0; border-left:1px solid var(--sce-line); }
.sce .sce-vars-ai-export > .sce-hint, .sce .sce-vars-ai-import > .sce-hint { margin-top:0; }
.sce .sce-vars-ai-export > .sce-row, .sce .sce-vars-ai-import > .sce-row { margin-bottom:0; }
.sce .sce-vars-ai-input { min-height:88px; height:88px; }
.sce .sce-editor-section-head {
  width:100%; max-width:var(--sce-work-w); display:flex; justify-content:space-between; gap:8px 14px;
  align-items:flex-start; margin:13px 0 7px; }
.sce .sce-editor-section-head.sce-variable-section-head { width:100%; max-width:var(--sce-work-w); }
.sce .sce-editor-section-title { color:var(--sce-text-strong); font-size:14px; font-weight:750; }
.sce .sce-editor-section-copy { margin-top:2px; color:var(--sce-muted); font-size:12px; line-height:1.5; }
.sce .sce-editor-section-actions { display:flex; justify-content:flex-end; align-items:center; gap:7px; flex-wrap:wrap; }
.sce .sce-variable-list { display:grid; gap:8px; width:100%; max-width:var(--sce-work-w); }
.sce .sce-variable-card { min-width:0; padding:9px 10px; }
.sce .sce-variable-card.is-collapsed { padding:8px 10px; background:transparent; }
.sce .sce-variable-card-head { display:flex; justify-content:space-between; align-items:center; gap:10px 14px; }
.sce .sce-variable-card-title { display:flex; align-items:center; gap:7px; min-width:0; flex:1; }
.sce .sce-variable-drag-handle { flex:none; min-width:30px; color:var(--sce-muted); cursor:grab;
  touch-action:none; letter-spacing:-.08em; }
.sce .sce-variable-drag-handle:active { cursor:grabbing; }
.sce .sce-variable-card-index { flex:none; color:var(--sce-muted); font-family:var(--sc-font-mono,
  'D2Coding', ui-monospace, monospace); font-size:10.5px; font-weight:700; }
.sce .sce-variable-title-field { display:flex; align-items:center; gap:7px; width:380px; max-width:100%; }
.sce .sce-variable-title-field > span { flex:none; color:var(--sce-muted); font-size:11.5px; font-weight:650; }
.sce .sce-variable-title-field > input { width:100% !important; min-width:0 !important; }
.sce .sce-variable-card-actions { display:flex; align-items:center; gap:5px; flex:none; }
.sce .sce-variable-card-actions .sce-grip { margin-left:0; }
.sce .sce-variable-title-display { min-width:0; color:var(--sce-text-strong); font-size:13px;
  font-weight:750; overflow-wrap:anywhere; }
.sce .sce-variable-card-summary { min-width:0; color:var(--sce-muted); font-size:11.5px;
  line-height:1.45; overflow-wrap:anywhere; }
/* 카드 안쪽은 카드 폭에 맞춘다. 여기에 따로 숫자(680px)를 박아 두면 한 탭 안에
   패널폭 → 작업폭(--sce-work-w) → 카드안폭 세 층이 생겨 전부 어긋나 보인다 (실측 제보). */
.sce .sce-variable-card-body { --sce-variable-work-width:100%; margin-top:7px; padding-top:7px;
  border-top:1px solid var(--sce-line); }
.sce .sce-variable-grid { display:grid; width:100%; max-width:var(--sce-variable-work-width);
  grid-template-columns:260px minmax(0,1fr); gap:7px; align-items:end; }
.sce .sce-variable-grid.values { grid-template-columns:repeat(3,108px) minmax(0,1fr); margin-top:7px; }
.sce .sce-variable-grid.values.is-text { grid-template-columns:minmax(0,1fr) 108px; }
.sce .sce-variable-grid.values.is-enum { grid-template-columns:minmax(0,1fr) 180px; }
.sce .sce-variable-grid.values.is-list { grid-template-columns:minmax(0,1fr) 108px 132px; }
.sce .sce-variable-grid.values.is-bool { width:max-content; grid-template-columns:max-content; }
.sce .sce-variable-field { display:grid; gap:2px; min-width:0; color:var(--sce-muted); font-size:11.5px;
  font-weight:650; }
.sce .sce-variable-field > input, .sce .sce-variable-field > select, .sce .sce-variable-field > textarea {
  width:100% !important; min-width:0 !important; max-width:none !important; }
.sce .sce-variable-field > textarea { min-height:78px; resize:vertical; line-height:1.45; }
.sce .sce-variable-grid.values.is-enum .sce-variable-field > textarea,
.sce .sce-variable-grid.values.is-list .sce-variable-field > textarea {
  min-height:118px; height:118px; }
.sce .sce-variable-field.is-wide { grid-column:1 / -1; }
.sce .sce-variable-field.has-error > input, .sce .sce-variable-field.has-error > select,
.sce .sce-variable-field.has-error > textarea {
  border-color:var(--sce-danger); }
.sce .sce-variable-reference-note { width:100%; max-width:var(--sce-variable-work-width); margin-top:5px;
  padding:5px 8px; border-left:2px solid var(--sce-warning); background:var(--sce-field);
  color:var(--sce-text); font-size:11.5px; line-height:1.45; }
.sce .sce-variable-type-help { margin:4px 0 0; color:var(--sce-muted); font-size:11.5px; line-height:1.45; }
.sce .sce-variable-description { width:100%; max-width:var(--sce-variable-work-width); margin-top:6px; }
.sce .sce-variable-bool { display:flex; gap:6px; }
.sce .sce-variable-bool .sce-mode-btn { min-width:76px; }
.sce .sce-field-error { color:var(--sce-danger); font-size:11.5px; font-weight:600; line-height:1.45; }
.sce .sce-card-issue-count { flex:none; padding-bottom:8px; color:var(--sce-danger); font-size:11.5px;
  font-weight:700; white-space:nowrap; }
.sce .sce-card-issue-summary { min-width:0; color:var(--sce-danger); font-size:11.5px;
  font-weight:650; line-height:1.45; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sce .sce-variable-card.is-just-moved { border-color:var(--sce-accent); }
.sce .sce-variable-card.is-newly-created, .sce .sce-command-card.is-newly-created {
  border-color:var(--sce-accent); animation:sce-editor-new-card 1.5s ease both; }
.sce .sce-variable-card.is-just-moved.moved-up { animation:sce-variable-move-up .72s cubic-bezier(.2,.9,.25,1); }
.sce .sce-variable-card.is-just-moved.moved-down { animation:sce-variable-move-down .72s cubic-bezier(.2,.9,.25,1); }
.sce .sce-variable-card.is-just-moved.moved-drag { animation:sce-variable-move-drop .78s cubic-bezier(.2,.9,.25,1); }
.sce .sce-variable-card.is-dragging { opacity:.46; transform:scale(.994); }
.sce .sce-variable-card.is-drag-before { border-top-color:var(--sce-accent);
  box-shadow:0 -4px 0 var(--sce-accent), 0 8px 18px rgba(0,0,0,.18); transform:translateY(4px); }
.sce .sce-variable-card.is-drag-after { border-bottom-color:var(--sce-accent);
  box-shadow:0 4px 0 var(--sce-accent), 0 8px 18px rgba(0,0,0,.18); transform:translateY(-4px); }
.sce .sce-variable-drag-ghost { position:fixed; z-index:120; pointer-events:none; box-sizing:border-box;
  max-width:calc(100vw - 32px); max-height:180px; overflow:hidden; border:1px solid var(--sce-accent);
  border-radius:4px; background:rgba(24,30,38,.9); opacity:.86; transform:rotate(.5deg) scale(.99);
  transform-origin:16px 16px; box-shadow:0 16px 36px rgba(0,0,0,.38), 0 0 0 2px rgba(120,169,255,.2); }
.sce .sce-variable-drag-ghost::after { content:""; position:absolute; inset:auto 0 0; height:34px;
  background:linear-gradient(transparent, rgba(24,30,38,.96)); }
.sce .sce-variable-drag-ghost-badge { position:absolute; right:9px; bottom:7px; z-index:1;
  padding:3px 6px; border:1px solid var(--sce-accent); border-radius:3px; background:#243a5c;
  color:var(--sce-text-strong); font-size:10px; font-weight:750; }
.sce .sce-variable-move-feedback { flex:none; padding:4px 7px; border:1px solid var(--sce-success);
  border-radius:3px; background:rgba(54,142,94,.14); color:var(--sce-success); font-size:10.5px;
  font-weight:750; white-space:nowrap; animation:sce-variable-feedback-pop .45s ease both; }
@keyframes sce-variable-move-up {
  0% { transform:translateY(12px) scale(.99); background:#20314a; box-shadow:0 0 0 2px rgba(120,169,255,.34); }
  58% { transform:translateY(-2px) scale(1.002); }
  100% { transform:translateY(0) scale(1); background:var(--sce-surface); box-shadow:none; }
}
@keyframes sce-variable-move-down {
  0% { transform:translateY(-12px) scale(.99); background:#20314a; box-shadow:0 0 0 2px rgba(120,169,255,.34); }
  58% { transform:translateY(2px) scale(1.002); }
  100% { transform:translateY(0) scale(1); background:var(--sce-surface); box-shadow:none; }
}
@keyframes sce-variable-move-drop {
  0% { transform:scale(.975); background:#20314a; box-shadow:0 0 0 3px rgba(120,169,255,.34); }
  62% { transform:scale(1.004); }
  100% { transform:scale(1); background:var(--sce-surface); box-shadow:none; }
}
@keyframes sce-variable-feedback-pop {
  0% { opacity:0; transform:scale(.84); }
  45% { opacity:1; transform:scale(1.04); }
  100% { opacity:1; transform:scale(1); }
}
@keyframes sce-editor-new-card {
  0% { background:#20314a; box-shadow:0 0 0 3px rgba(120,169,255,.32); }
  58% { background:var(--sce-surface); box-shadow:0 0 0 1px rgba(120,169,255,.14); }
  100% { background:var(--sce-surface); box-shadow:none; }
}
.sce .sce-variable-preview { width:100%; max-width:var(--sce-variable-work-width); margin-top:5px;
  color:var(--sce-muted); font-size:11.5px; }
.sce .sce-variable-preview strong { color:var(--sce-text); font-weight:650; }
.sce .sce-derived-grid { display:grid; width:100%; max-width:var(--sce-variable-work-width);
  grid-template-columns:240px minmax(0,1fr); gap:7px; }
.sce .sce-vars-empty { width:100%; max-width:var(--sce-work-w); padding:14px; border:1px dashed var(--sce-line-strong); border-radius:4px;
  color:var(--sce-muted); font-size:12.5px; }
.sce .sce-vars-empty strong { display:block; margin-bottom:3px; color:var(--sce-text-strong); }
.sce .sce-vars-empty .sce-btn { margin-top:9px; }
.sce .sce-vars-undo { display:flex; justify-content:space-between; align-items:center; gap:8px 12px;
  width:100%; max-width:var(--sce-work-w); margin:8px 0; padding:8px 10px; border-left:3px solid var(--sce-success);
  background:var(--sce-field); }
.sce .sce-vars-undo span { color:var(--sce-text); font-size:12px; line-height:1.5; }
.sce .sce-command-intro {
  width:100%; max-width:var(--sce-work-w); margin:2px 0 12px; padding:9px 11px; border-left:2px solid var(--sce-accent);
  background:var(--sce-field); }
.sce .sce-command-intro-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-command-intro-copy { margin-top:3px; color:var(--sce-muted); font-size:12.5px; line-height:1.55; }
.sce .sce-command-workspace { width:100%; max-width:var(--sce-work-w); }
.sce .sce-command-create { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px;
  align-items:end; margin:7px 0 11px; padding:9px 0; border-top:1px solid var(--sce-line);
  border-bottom:1px solid var(--sce-line); }
.sce .sce-command-list { display:grid; gap:8px; width:100%; max-width:var(--sce-work-w); }
.sce .sce-command-card { padding:10px 11px; }
.sce .sce-command-card.is-collapsed { padding:8px 10px; background:transparent; }
.sce .sce-command-card-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px 14px; }
.sce .sce-command-card-title { min-width:0; }
.sce .sce-command-card-title strong { display:block; color:var(--sce-text-strong); font-size:13.5px;
  overflow-wrap:anywhere; }
.sce .sce-command-card-title span { display:block; margin-top:1px; color:var(--sce-muted); font-size:11.5px; }
.sce .sce-command-card-title .sce-command-issue-summary { color:var(--sce-danger); font-weight:700; }
.sce .sce-command-card-title .sce-command-issue-summary.is-warning { color:var(--sce-warning); }
.sce .sce-command-card-actions { display:flex; align-items:center; justify-content:flex-end; gap:5px; flex:none; }
.sce .sce-command-card-body { margin-top:8px; padding-top:8px; border-top:1px solid var(--sce-line); }
.sce .sce-command-grid { display:grid; grid-template-columns:240px minmax(0,1fr); gap:8px;
  width:100%; max-width:100%; align-items:start; }
.sce .sce-command-readonly { min-height:38px; display:flex; align-items:center; padding:6px 8px;
  border:1px solid var(--sce-line); border-radius:4px; background:var(--sce-field); color:var(--sce-text); }
.sce .sce-command-name-control { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; }
.sce .sce-command-prefix { min-height:38px; display:flex; align-items:center; padding:0 8px;
  border:1px solid var(--sce-line-strong); border-right:0; border-radius:4px 0 0 4px;
  background:var(--sce-surface-soft); color:var(--sce-muted); font-family:var(--sc-font-mono,'D2Coding',monospace); }
.sce .sce-command-name-control input { width:100% !important; min-width:0 !important; max-width:none !important;
  border-radius:0 4px 4px 0; }
.sce .sce-command-usage { width:100%; max-width:100%; margin-top:9px; padding-top:8px;
  border-top:1px solid var(--sce-line); }
.sce .sce-command-usage > strong { display:block; margin-bottom:4px; color:var(--sce-text-strong); font-size:12px; }
.sce .sce-command-usage-line { display:grid; grid-template-columns:minmax(150px,auto) minmax(0,1fr);
  gap:8px; align-items:baseline; padding:3px 0; }
.sce .sce-command-usage-line code { color:var(--sce-text-strong); font-family:var(--sc-font-mono,'D2Coding',monospace);
  white-space:normal; overflow-wrap:anywhere; word-break:break-word; }
.sce .sce-command-usage-line span { color:var(--sce-muted); font-size:12px; }
.sce .sce-command-usage-note { margin-top:6px; padding:7px 9px; border-left:2px solid var(--sce-accent);
  background:var(--sce-field); color:var(--sce-text); font-size:12px; line-height:1.55; }
.sce .sce-command-visibility { display:flex; align-items:flex-start; justify-content:space-between; gap:10px 14px;
  width:100%; max-width:var(--sce-work-w); margin-top:13px; padding:9px 10px; border-left:3px solid var(--sce-success);
  background:var(--sce-field); }
.sce .sce-command-visibility.is-warning { border-left-color:var(--sce-warning); }
.sce .sce-command-visibility strong { display:block; color:var(--sce-text-strong); font-size:12.5px; }
.sce .sce-command-visibility p { margin:2px 0 0; color:var(--sce-muted); font-size:12px; line-height:1.5; }
/* 심층 편집 작업 폭 — 상한은 이 기둥 하나로 끝난다. 탭 바·본문·오류줄이 같이 들어 있어
   오른쪽 끝이 한 줄로 떨어진다. 안쪽 블록은 자기 폭을 다시 박지 않는다 (전부 100%/토큰). */
.sce .sce-deep { width:100%; max-width:var(--sce-work-w); }
.sce .sce-deep-body { width:100%; }
.sce .sce-status-editor { width:100%; max-width:var(--sce-work-w); }
.sce .sce-status-intro {
  width:100%; max-width:var(--sce-work-w); margin:2px 0 12px; padding:9px 11px; border-left:2px solid var(--sce-accent);
  background:var(--sce-field); }
.sce .sce-status-intro-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-status-intro-copy { margin-top:3px; color:var(--sce-muted); font-size:12.5px; line-height:1.55; }
.sce .sce-status-settings { padding:10px 0; border-top:1px solid var(--sce-line);
  border-bottom:1px solid var(--sce-line); }
.sce .sce-status-settings-grid { display:grid;
  grid-template-columns:minmax(220px,1.25fr) minmax(220px,1fr) minmax(130px,.55fr) minmax(150px,.6fr);
  gap:8px; align-items:end; }
.sce .sce-status-field { display:grid; gap:4px; min-width:0; color:var(--sce-muted);
  font-size:11.5px; font-weight:650; }
.sce .sce-status-field > input, .sce .sce-status-field > select,
.sce .sce-status-field > .sce-chip { width:100%; min-width:0; max-width:none; }
.sce .sce-status-field > .sce-chip { min-height:38px; align-items:center; }
.sce .sce-status-layout { width:min(420px,100%); margin-top:8px; }
.sce .sce-status-layout select { width:100%; min-width:0; max-width:none; }
.sce .sce-status-note {
  width:100%; max-width:var(--sce-work-w); margin-top:7px; color:var(--sce-muted); font-size:11.5px; line-height:1.5; }
.sce .sce-status-timegate { display:flex; justify-content:space-between; align-items:center; gap:8px 12px;
  width:100%; max-width:var(--sce-work-w); margin-top:9px; padding:8px 10px;
  border-left:3px solid var(--sce-accent); background:var(--sce-surface-soft); border-radius:0 4px 4px 0; }
.sce .sce-status-timegate > button { flex:none; }
.sce .sce-status-section-head { display:flex; align-items:flex-start; justify-content:space-between;
  gap:8px 14px; margin:14px 0 7px; }
.sce .sce-status-section-head h4 { margin:0; }
.sce .sce-status-section-head p { margin:2px 0 0; color:var(--sce-muted); font-size:12px; line-height:1.5; }
.sce .sce-status-section-actions { display:flex; align-items:center; justify-content:flex-end; gap:6px; flex-wrap:wrap; }
.sce .sce-status-count { min-width:34px; padding:4px 7px; border:1px solid var(--sce-line-strong);
  border-radius:999px; color:var(--sce-text); font-size:11.5px; font-weight:700; text-align:center; }
.sce .sce-status-groups { display:grid; gap:8px; width:100%; max-width:var(--sce-work-w); }
.sce .sce-status-group { min-width:0; padding:10px 11px; border:1px solid var(--sce-line);
  border-radius:4px; background:var(--sce-surface); }
.sce .sce-status-group.is-collapsed { padding:8px 10px; background:transparent; }
.sce .sce-status-group-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px 14px; }
.sce .sce-status-group-identity { display:flex; align-items:center; gap:7px; min-width:0; }
.sce .sce-status-group-title { min-width:0; }
.sce .sce-status-group-title strong { display:block; color:var(--sce-text-strong); font-size:13.5px; }
.sce .sce-status-group-title span { display:block; margin-top:1px; color:var(--sce-muted); font-size:11.5px; }
.sce .sce-status-group-actions { display:flex; align-items:center; justify-content:flex-end; gap:5px; flex:none; }
.sce .sce-status-group-body { margin-top:8px; padding-top:8px; border-top:1px solid var(--sce-line); }
.sce .sce-status-group-settings { display:grid;
  grid-template-columns:minmax(170px,.7fr) minmax(190px,.8fr) minmax(220px,1.1fr);
  gap:10px; align-items:end; }
.sce .sce-status-group-settings .sce-status-field > input,
.sce .sce-status-group-settings .sce-status-field > select { width:100%; min-width:0; max-width:none; }
.sce .sce-status-items { margin-top:12px; border-top:1px solid var(--sce-line); }
.sce .sce-status-item-head, .sce .sce-status-item { display:grid;
  grid-template-columns:minmax(210px,1.2fr) 68px minmax(155px,.9fr) minmax(150px,.85fr) auto;
  gap:9px; align-items:end; }
.sce .sce-status-item-head { padding:8px 0 5px; color:var(--sce-muted); font-size:10.5px; font-weight:700; }
.sce .sce-status-item { padding:9px 0; border-top:1px solid var(--sce-line); }
.sce .sce-status-item select, .sce .sce-status-item input { width:100%; min-width:0; max-width:none; }
/* 손잡이가 없을 수도 있다 (CARD_DRAG=false) — 고정 폭 격자 열로 잡으면 그때 셀렉트가
   손잡이 자리로 밀려 들어가 30px로 찌그러진다. flex는 있으면 붙고 없으면 그냥 사라진다. */
.sce .sce-status-value-control { display:flex; gap:6px; align-items:center; min-width:0; }
.sce .sce-status-value-control > select { flex:1; min-width:0; }
.sce .sce-status-drag-handle { width:30px; min-width:30px; padding:0; color:var(--sce-muted);
  cursor:grab; touch-action:none; letter-spacing:-.08em; }
.sce .sce-status-drag-handle:active { cursor:grabbing; }
.sce .sce-status-item .sce-chip { min-height:38px; padding:5px 6px; justify-content:center; white-space:nowrap; }
.sce .sce-status-item-max.is-disabled { display:flex; align-items:center; min-height:38px; padding:0 9px;
  border:1px solid var(--sce-line); border-radius:4px; background:var(--sce-field); color:var(--sce-muted); }
.sce .sce-status-item-actions { display:flex; align-items:center; justify-content:flex-end; gap:5px; align-self:end; }
.sce .sce-status-item-color { margin:0 0 7px; padding:7px 0 2px 12px;
  border-left:2px solid var(--sce-line-strong); }
.sce .sce-status-draggable.is-just-moved { border-color:var(--sce-accent); }
.sce .sce-status-draggable.is-just-moved.moved-up { animation:sce-variable-move-up .72s cubic-bezier(.2,.9,.25,1); }
.sce .sce-status-draggable.is-just-moved.moved-down { animation:sce-variable-move-down .72s cubic-bezier(.2,.9,.25,1); }
.sce .sce-status-draggable.is-just-moved.moved-drag { animation:sce-variable-move-drop .78s cubic-bezier(.2,.9,.25,1); }
.sce .sce-status-draggable.is-dragging { opacity:.46; transform:scale(.994); }
.sce .sce-status-draggable.is-drag-before { border-top-color:var(--sce-accent);
  box-shadow:0 -4px 0 var(--sce-accent), 0 8px 18px rgba(0,0,0,.18); transform:translateY(4px); }
.sce .sce-status-draggable.is-drag-after { border-bottom-color:var(--sce-accent);
  box-shadow:0 4px 0 var(--sce-accent), 0 8px 18px rgba(0,0,0,.18); transform:translateY(-4px); }
.sce .sce-status-drag-ghost { position:fixed; z-index:120; pointer-events:none; box-sizing:border-box;
  max-width:calc(100vw - 32px); max-height:150px; overflow:hidden; border:1px solid var(--sce-accent);
  border-radius:4px; background:rgba(24,30,38,.92); opacity:.88; transform:rotate(.5deg) scale(.99);
  transform-origin:16px 16px; box-shadow:0 16px 36px rgba(0,0,0,.38), 0 0 0 2px rgba(120,169,255,.2); }
.sce .sce-status-drag-ghost-badge { position:absolute; right:9px; bottom:7px; z-index:1;
  padding:3px 6px; border:1px solid var(--sce-accent); border-radius:3px; background:#243a5c;
  color:var(--sce-text-strong); font-size:10px; font-weight:750; }
.sce .sce-status-move-feedback { flex:none; padding:4px 7px; border:1px solid var(--sce-success);
  border-radius:3px; background:rgba(54,142,94,.14); color:var(--sce-success); font-size:10.5px;
  font-weight:750; white-space:nowrap; animation:sce-variable-feedback-pop .45s ease both; }
.sce .sce-status-empty {
  width:100%; max-width:var(--sce-work-w); padding:11px 0; color:var(--sce-muted); font-size:12px; text-align:center; }
.sce .sce-status-add-item { width:100%; margin-top:4px; }
.sce .sce-status-tools { display:flex; align-items:center; gap:7px; flex-wrap:wrap;
  width:100%; max-width:var(--sce-work-w); margin-top:9px; padding-top:9px; border-top:1px solid var(--sce-line); }
.sce .sce-status-template { width:100%; max-width:var(--sce-work-w); margin-top:12px; }
.sce .sce-status-design { width:100%; max-width:var(--sce-work-w); margin-top:15px; border-top:1px solid var(--sce-line-strong);
  border-bottom:1px solid var(--sce-line); }
.sce .sce-status-design > summary { padding:11px 0; color:var(--sce-text-strong); font-size:13px;
  font-weight:750; cursor:pointer; }
.sce .sce-status-design-body { padding:0 0 12px; }
.sce .sce-status-preview { width:100%; max-width:var(--sce-work-w); margin-top:15px; }
.sce .sce-status-preview h4 { margin-bottom:7px; }
.sce .sce-assets { min-width:0; }
.sce .sce-assets-intro {
  width:100%; max-width:var(--sce-work-w); margin:2px 0 12px; padding:9px 11px; border-left:2px solid var(--sce-accent);
  background:var(--sce-field); }
.sce .sce-assets-intro-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-assets-intro-copy { margin-top:3px; color:var(--sce-muted); font-size:12.5px; line-height:1.55; }
.sce .sce-assets-controls {
  width:100%; max-width:var(--sce-work-w); display:grid; grid-template-columns:minmax(0,1fr) auto; gap:9px 12px;
  align-items:end; padding:10px 0; border-top:1px solid var(--sce-line); border-bottom:1px solid var(--sce-line); }
.sce .sce-assets-mode { min-width:0; }
.sce .sce-assets-mode .sce-pair { display:grid; grid-template-columns:auto minmax(0,1fr); }
.sce .sce-assets-mode select { width:100%; min-width:0; }
.sce .sce-assets-tools {
  width:100%; max-width:var(--sce-work-w); justify-content:flex-end; margin:0; }
.sce .sce-assets-note { grid-column:1 / -1; padding:7px 9px; border-left:3px solid var(--sce-warning);
  color:var(--sce-text); background:var(--sce-field); font-size:12px; line-height:1.55; }
.sce .sce-assets-note.is-ok { border-left-color:var(--sce-success); }
.sce .sce-assets-count { grid-column:1 / -1; color:var(--sce-muted); font-size:12px; }
.sce .sce-assets-cost {
  width:100%; max-width:var(--sce-work-w); display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); margin:11px 0 2px;
  border-top:1px solid var(--sce-line); border-bottom:1px solid var(--sce-line); }
.sce .sce-assets-cost-item { min-width:0; padding:8px 10px; border-right:1px solid var(--sce-line); }
.sce .sce-assets-cost-item:last-child { border-right:0; }
.sce .sce-assets-cost-item span { display:block; color:var(--sce-muted); font-size:10.5px; }
.sce .sce-assets-cost-item strong { display:block; margin-top:1px; color:var(--sce-text-strong); font-size:13.5px;
  font-variant-numeric:tabular-nums; }
.sce .sce-assets-cost-note { grid-column:1 / -1; padding:7px 10px; border-top:1px solid var(--sce-line);
  color:var(--sce-muted); font-size:11.5px; line-height:1.5; }
.sce .sce-assets-list { display:grid; gap:10px; margin-top:7px; }
.sce .sce-assets-list-head {
  width:100%; max-width:var(--sce-work-w); display:flex; justify-content:space-between; align-items:center; gap:8px;
  margin-top:14px; }
.sce .sce-assets-list-title { color:var(--sce-text-strong); font-size:14px; font-weight:750; }
.sce .sce-assets-list-count { color:var(--sce-muted); font-size:12px; }
.sce .sce-asset-pack { min-width:0; padding:12px; border:1px solid var(--sce-line); border-radius:4px;
  background:var(--sce-surface); }
.sce .sce-asset-pack-head { display:flex; justify-content:space-between; align-items:start; gap:10px;
  margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--sce-line); }
.sce .sce-asset-pack-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-asset-pack-sub { margin-top:2px; color:var(--sce-muted); font-size:11.5px; }
.sce .sce-asset-pack-settings { display:grid; gap:9px; }
.sce .sce-asset-pack-core { display:grid; grid-template-columns:auto minmax(150px,.7fr) minmax(180px,1fr);
  gap:8px; align-items:end; }
.sce .sce-asset-pack-layout { display:grid; grid-template-columns:minmax(110px,.35fr) minmax(240px,1fr);
  gap:8px; }
.sce .sce-asset-pack-options { display:grid; grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) auto;
  gap:8px; align-items:end; }
.sce .sce-asset-field { display:grid; gap:4px; min-width:0; color:var(--sce-muted); font-size:11.5px;
  font-weight:650; }
.sce .sce-asset-field > input, .sce .sce-asset-field > select { width:100%; min-width:0; }
.sce .sce-asset-toggle { display:flex; align-items:center; min-height:38px; padding:0 2px; }
.sce .sce-asset-slots-head { display:flex; justify-content:space-between; align-items:center; gap:8px;
  margin-top:10px; padding-top:9px; border-top:1px solid var(--sce-line); }
.sce .sce-asset-slots-title { color:var(--sce-text-strong); font-size:12.5px; font-weight:700; }
.sce .sce-asset-slot { margin-top:8px; padding-top:8px; border-top:1px solid var(--sce-line); }
.sce .sce-asset-slot-main { display:grid; grid-template-columns:minmax(110px,.55fr) minmax(130px,.7fr) minmax(240px,2fr);
  gap:8px; }
.sce .sce-asset-slot-options { display:flex; justify-content:flex-end; align-items:end; gap:8px;
  margin-top:7px; }
.sce .sce-asset-slot-options .sce-asset-field { width:min(180px,100%); }
.sce .sce-asset-slot-options .sce-grip { margin-left:0; }
.sce .sce-asset-pack-status { margin-top:9px; padding-top:8px; border-top:1px solid var(--sce-line);
  color:var(--sce-muted); font-size:12px; line-height:1.55; }
.sce .sce-asset-issues { display:grid; gap:5px; margin-top:9px; padding-top:8px; border-top:1px solid var(--sce-line); }
.sce .sce-asset-issue { display:grid; grid-template-columns:70px minmax(0,1fr); gap:8px; font-size:12px;
  line-height:1.5; }
.sce .sce-asset-issue strong { color:var(--sce-danger); }
.sce .sce-asset-issue.is-warning strong { color:var(--sce-warning); }
.sce .sce-asset-issue span { color:var(--sce-text); }
.sce .sce-assets-other-issues { margin-top:12px; border-top:1px solid var(--sce-line); }
.sce .sce-assets-other-issues > summary { padding:9px 0; color:var(--sce-muted); font-size:12px; cursor:pointer; }
.sce .sce-assets-other-issues-body { display:grid; gap:5px; padding-bottom:6px; color:var(--sce-muted);
  font-size:12px; line-height:1.5; }
.sce .sce-assets-empty { margin-top:13px; padding:12px; border:1px dashed var(--sce-line-strong);
  color:var(--sce-muted); font-size:12.5px; text-align:center; }
.sce .sce-assets-import { margin-top:15px; border-top:1px solid var(--sce-line-strong);
  border-bottom:1px solid var(--sce-line); }
.sce .sce-assets-import > summary { padding:11px 0; color:var(--sce-text); font-size:12.5px;
  font-weight:700; cursor:pointer; }
.sce .sce-assets-import-body { padding:0 0 11px; }
.sce .sce-assets-import textarea { min-height:150px; }
.sce .sce-assets-import-state { min-height:20px; margin-top:6px; color:var(--sce-muted); font-size:12px; }
.sce .sce-patch-plan { padding:0; overflow:hidden; border-left-width:1px; }
.sce .sce-patch-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start;
  padding:11px 12px 9px; border-bottom:1px solid var(--sce-line); }
.sce .sce-patch-title { color:var(--sce-text-strong); font-size:13.5px; font-weight:750; }
.sce .sce-patch-copy { margin-top:2px; color:var(--sce-muted); font-size:12px; }
.sce .sce-patch-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-bottom:1px solid var(--sce-line); }
.sce .sce-patch-metric { min-width:0; padding:8px 10px; border-right:1px solid var(--sce-line); }
.sce .sce-patch-metric:last-child { border-right:0; }
.sce .sce-patch-metric span { display:block; color:var(--sce-muted); font-size:10.5px; letter-spacing:.03em; }
.sce .sce-patch-metric strong { display:block; margin-top:1px; color:var(--sce-text-strong);
  font-family:var(--sc-font-mono, 'D2Coding', ui-monospace, monospace); font-size:14px; }
.sce .sce-patch-body { padding:9px 12px; }
.sce .sce-patch-changes { margin-top:3px; border-top:1px solid var(--sce-line); }
.sce .sce-patch-changes > summary { padding:8px 0 5px; color:var(--sce-text); font-size:12.5px; cursor:pointer; }
.sce .sce-patch-change { display:grid; grid-template-columns:18px minmax(0,1fr); gap:6px; padding:4px 0;
  color:var(--sce-text); font-size:12.5px; line-height:1.45; }
.sce .sce-patch-change-mark { color:var(--sce-accent); font-family:var(--sc-font-mono, 'D2Coding', ui-monospace, monospace); }
.sce .sce-patch-actions { display:flex; justify-content:flex-end; gap:7px; padding:9px 12px;
  border-top:1px solid var(--sce-line); background:var(--sce-field); }
.sce .sce-patch-report { border-left-color:var(--sce-success); }
.sce .sce-top-head { display:flex; justify-content:space-between; align-items:center; gap:10px; margin:2px 0 8px; }
.sce .sce-top-head h4 { min-width:0; }
.sce .sce-first-install-guide { position:relative; margin:8px 0 14px; padding:13px;
  border:1px solid var(--sce-line-strong); border-radius:7px; background:var(--sce-surface); }
.sce .sce-first-install-close { position:absolute; top:8px; right:8px; min-width:32px; min-height:32px;
  padding:0; border:1px solid transparent; border-radius:5px; background:transparent; color:var(--sce-muted);
  cursor:pointer; font:inherit; font-size:20px; line-height:1; }
.sce .sce-first-install-title { margin-bottom:2px; color:var(--sce-text-strong); font-weight:750; }
.sce .sce-first-install-lead { margin:0 38px 11px 0; color:var(--sce-muted); font-size:12.5px; }
.sce .sce-first-install-steps { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.sce .sce-first-install-step { display:grid; grid-template-columns:68px minmax(0,1fr); gap:3px 9px;
  align-content:start; min-width:0; padding:10px 11px; border:1px solid var(--sce-line); border-radius:6px;
  background:var(--sce-field); }
.sce .sce-first-install-number { color:var(--sce-muted); font-family:var(--sc-font-mono, 'D2Coding', ui-monospace, monospace);
  font-size:10.5px; font-weight:700; letter-spacing:.04em; }
.sce .sce-first-install-step.on .sce-first-install-number,
.sce .sce-first-install-step.on b { color:var(--sce-accent); }
.sce .sce-first-install-step.done .sce-first-install-number { color:var(--sce-success); }
.sce .sce-first-install-step b { color:var(--sce-text-strong); font-size:12.5px; }
.sce .sce-first-install-step span:last-child { grid-column:1 / -1; color:var(--sce-muted); font-size:12px; line-height:1.5; }
.sce .sce-first-install-note { margin-top:11px; color:var(--sce-text); font-size:12.5px; line-height:1.55; }
.sce details.sce-lower { margin-top:14px; }
.sce details.sce-lower > summary { cursor:pointer; user-select:none; color:var(--sce-text-strong); font-weight:650;
  padding:8px; border:1px solid var(--sce-line); border-radius:7px; background:var(--sce-surface); }
.sce details.sce-lower[open] > summary { border-radius:7px 7px 0 0; margin-bottom:10px; }
.sce button:focus-visible, .sce input:focus-visible, .sce select:focus-visible,
.sce textarea:focus-visible, .sce summary:focus-visible, .sce a:focus-visible {
  outline:2px solid var(--sce-focus); outline-offset:2px; border-color:var(--sce-accent);
}
@media (hover:hover) and (pointer:fine) {
  .sce .sce-tab:hover:not(:disabled), .sce .sce-btn:hover:not(:disabled) {
    background:#2c343d; border-color:var(--sce-accent);
  }
  .sce .sce-mode-btn:hover:not(:disabled) { background:#2c343d; border-color:var(--sce-accent); }
  .sce .sce-btn.sce-danger:hover:not(:disabled) {
    border-color:var(--sce-danger); background:var(--sce-danger-bg); color:#ffc1c1;
  }
  .sce .sce-first-install-close:hover { color:var(--sce-text-strong); border-color:var(--sce-line-strong); }
}
@media (max-width:1040px) {
  .sce .sce-status-settings-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .sce .sce-status-group-settings { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .sce .sce-asset-pack-core, .sce .sce-asset-pack-layout, .sce .sce-asset-pack-options {
    grid-template-columns:repeat(2,minmax(0,1fr)); }
  .sce .sce-asset-toggle { align-self:end; }
  .sce .sce-asset-slot-main { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .sce .sce-asset-slot-main .sce-asset-field:last-child { grid-column:1 / -1; }
}
@media (max-width:760px) {
  .sce .sce-tab-ai-vars { grid-template-columns:1fr; }
  .sce .sce-vars-ai-export, .sce .sce-vars-ai-import { padding:5px 0; }
  .sce .sce-vars-ai-import { margin-top:7px; padding-top:9px; border-left:0; border-top:1px solid var(--sce-line); }
  .sce .sce-editor-section-head { align-items:stretch; flex-direction:column; }
  .sce .sce-editor-section-actions { justify-content:flex-start; }
  .sce .sce-variable-card-head { align-items:stretch; flex-direction:column; }
  .sce .sce-variable-card-title { align-items:flex-start; flex-wrap:wrap; }
  .sce .sce-variable-title-field { width:100%; }
  .sce .sce-variable-card-actions { justify-content:flex-end; }
  .sce .sce-variable-grid, .sce .sce-variable-grid.values, .sce .sce-variable-grid.values.is-text,
  .sce .sce-variable-grid.values.is-enum, .sce .sce-variable-grid.values.is-list,
  .sce .sce-variable-grid.values.is-bool, .sce .sce-derived-grid { grid-template-columns:1fr; }
  .sce .sce-variable-grid.values.is-list .sce-variable-field:first-child,
  .sce .sce-variable-field.is-wide { grid-column:auto; }
  .sce .sce-vars-undo { align-items:stretch; flex-direction:column; }
  .sce .sce-command-create, .sce .sce-command-grid { grid-template-columns:1fr; }
  .sce .sce-command-card-head, .sce .sce-command-visibility { align-items:stretch; flex-direction:column; }
  .sce .sce-command-card-actions { width:100%; }
  .sce .sce-command-usage-line { grid-template-columns:1fr; gap:1px; }
  .sce .sce-status-settings-grid, .sce .sce-status-group-settings { grid-template-columns:1fr; }
  .sce .sce-status-section-head, .sce .sce-status-group-head { align-items:stretch; flex-direction:column; }
  .sce .sce-status-section-actions, .sce .sce-status-group-actions { justify-content:flex-start; }
  .sce .sce-status-item-head { display:none; }
  .sce .sce-status-item { grid-template-columns:minmax(0,1fr) auto; }
  .sce .sce-status-item > :nth-child(1), .sce .sce-status-item > :nth-child(3) { grid-column:1 / -1; }
  .sce .sce-status-item-color { padding-left:8px; }
  .sce .sce-ai-settings-grid, .sce .sce-first-install-steps { grid-template-columns:1fr; }
  .sce .sce-catalog-grid, .sce .sce-event-list, .sce .sce-diag-findings { grid-template-columns:1fr; }
  .sce .sce-diag-ai-export-grid { grid-template-columns:1fr; }
  .sce .sce-json-paths { grid-template-columns:1fr; }
  .sce .sce-json-import-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .sce .sce-json-import-metric { border-bottom:1px solid var(--sce-line); }
  .sce .sce-json-import-applied { align-items:stretch; flex-direction:column; }
  .sce .sce-assets-controls { grid-template-columns:1fr; align-items:stretch; }
  .sce .sce-assets-tools { justify-content:flex-start; }
  .sce .sce-assets-note, .sce .sce-assets-count { grid-column:auto; }
  .sce .sce-asset-pack-core, .sce .sce-asset-pack-layout, .sce .sce-asset-pack-options,
  .sce .sce-asset-slot-main { grid-template-columns:1fr; }
  .sce .sce-asset-slot-main .sce-asset-field:last-child { grid-column:auto; }
  .sce .sce-asset-slot-options { align-items:stretch; flex-direction:column; }
  .sce .sce-asset-slot-options .sce-asset-field { width:100%; }
  .sce .sce-diag-ai-primary { align-items:stretch; flex-direction:column; }
  .sce .sce-diag-ai-primary .sce-btn { width:100%; }
  .sce .sce-diag-compare-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .sce .sce-diag-compare-metric:nth-child(2) { border-right:0; }
  .sce .sce-diag-compare-metric:nth-child(-n+2) { border-bottom:1px solid var(--sce-line); }
  .sce .sce-diag-controls { grid-template-columns:1fr 1fr; }
  .sce .sce-diag-run { grid-column:1 / -1; width:100%; }
  .sce .sce-patch-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .sce .sce-patch-metric:nth-child(2) { border-right:0; }
  .sce .sce-patch-metric:nth-child(-n+2) { border-bottom:1px solid var(--sce-line); }
}
@media (max-width:600px) {
  .sce { font-size:14px; }
  .sce .sce-tab, .sce .sce-btn, .sce input, .sce select, .sce textarea { min-height:44px; }
  .sce .sce-btn.sce-mini { min-height:40px; }
  .sce .sce-btn.sce-ai-primary { width:100%; }
  .sce .sce-mode-btn, .sce .sce-design-controls .sce-btn.sce-mini { min-height:44px; }
  .sce .sce-design-controls .sce-btn.sce-ai-primary { width:auto; }
  .sce .sce-event-fields { grid-template-columns:minmax(92px,auto) minmax(0,1fr); }
  .sce .sce-diag-controls { grid-template-columns:1fr; }
  .sce .sce-diag-run { grid-column:auto; }
}
@media (prefers-reduced-motion:reduce) {
  .sce *, .sce *::before, .sce *::after { scroll-behavior:auto !important; transition:none !important; }
}
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
function copyWidget(btnLabel, hint, buildText, extra = [], options = {}) {
  const note = h('div', { class: 'sce-hint' }, hint);
  const out = h('textarea', { class: 'sce-copy-output', style: 'height:190px' });
  out.hidden = true;
  const foldBtn = h('button', { class: 'sce-btn sce-mini', onclick: () => {
    out.hidden = true;
    foldBtn.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    note.textContent = hint;
  } }, '복사 내용 닫기');
  foldBtn.hidden = true;
  const btn = h('button', { class: 'sce-btn', onclick: async () => {
    let text;
    try { text = buildText(); }
    catch (e) { note.textContent = `만들지 못했습니다 — ${e.message}`; return; }
    if (!text) { note.textContent = '복사할 내용이 없습니다.'; return; }
    out.value = text;
    out.hidden = false;
    if (options.collapsible) {
      btn.setAttribute('aria-expanded', 'true');
      foldBtn.hidden = false;
    }
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
  if (options.collapsible) btn.setAttribute('aria-expanded', 'false');
  return {
    mount(parent) {
      parent.appendChild(note);
      parent.appendChild(h('div', { class: 'sce-row' }, btn, ...(options.collapsible ? [foldBtn] : []), ...extra));
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

const DESIGN_POLISH_PROMPT = [
  '## 획일적인 AI 디자인 줄이기',
  '- 요청한 장르와 분위기를 먼저 따르고, 흔한 AI 대시보드 형태를 기본값으로 삼지 마세요.',
  '- 카드 중첩, 이유 없는 둥근 상자, 알약형 배지 남발을 피하세요.',
  '- 장식용 그라데이션과 과한 그림자는 쓰지 말고 여백·글자·선·정렬로 위계를 만드세요.',
  '- 기본·초점·처리 중·성공·경고·오류·비활성 상태를 색에만 의존하지 말고 구분하세요.',
  '- 긴 텍스트, 빈 값, 모바일 폭과 글자 대비를 함께 점검하세요.',
];

function buildCssSpecPrompt(schema, styleReq = '', designPolish = true) {
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
    ...(designPolish ? ['', ...DESIGN_POLISH_PROMPT] : []),
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
function buildLayoutSpecPrompt(schema, styleReq = '', designPolish = true) {
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
    ...(designPolish ? ['', ...DESIGN_POLISH_PROMPT] : []),
    '',
    '## 반드시 지킬 것',
    '- 출력은 **`<style>` 블록 하나 + HTML**만. 코드펜스 밖에 설명을 덧붙이지 마세요.',
    '- CSS는 시스템이 이 상태창 범위로 자동 격리합니다. 클래스명은 자유롭게 지어도 됩니다.',
    '- 외부 리소스 금지: `@import`, `url(http...)`, 웹폰트 링크. `font-family`는 기기 폰트만.',
    '- `position: fixed` 금지. `position: absolute`는 **이 템플릿 안의 `position: relative` 컨테이너 내부에서만** 쓰세요 (지도 핀·겹침 레이어용). 채팅 흐름에 들어가는 창이라 밖으로 삐져나가면 안 됩니다.',
    '- **아래 목록에 없는 {자리표시자}를 쓰면 설치가 거부됩니다.** 꾸밈용 텍스트는 그냥 글자로 쓰세요.',
    '- 탭·팝업 같은 전환은 체크박스/라디오 + CSS로만 (JS 불가). 라디오·체크박스의 `id`/`name`에는',
    '  반드시 `{uid}`를 섞으세요 (예: `id="tab1-{uid}"`) — 메시지마다 상태창이 새로 그려져서, 없으면 서로 엉킵니다.',
    '- 밝은 테마/어두운 테마 어느 쪽에서도 읽히도록 배경색과 글자색을 같이 지정하세요.',
    '',
    '## 쓸 수 있는 자리표시자 (이게 전부입니다)',
    ...ph,
    '',
    '## 자리표시자 심화 — 수식·조건부 클래스·이미지',
    "- 자리표시자에는 수식이 됩니다: `{hp < 30 ? '위험' : '안정'}`. class 속성 안에 넣으면 조건부 스타일이 됩니다:",
    '  `<i class="pin {region_a == \'적군\' ? \'hostile\' : \'\'}">` — 값에 따라 다른 CSS가 걸립니다.',
    '- `{{img::에셋이름}}` 같은 리수 문법(중괄호 **두 겹**)은 건드리지 않고 그대로 내보냅니다 —',
    '  봇에 올린 이미지 에셋을 상태창 안에 넣을 수 있습니다.',
    '- 두 겹 안에 한 겹을 조립할 수 있습니다: `{{img::지역A_{region_a}}}` → `{{img::지역A_적군}}` —',
    '  변수 값에 따라 다른 이미지가 뽑힙니다.',
    '- 존재하지 않는 에셋 이름을 지어내지 마세요. 요청 문구에 적힌 이름만 쓰고, 이미지가 없으면 CSS만으로 그리세요.',
    '',
    '## 지도·도해 패턴 (요청이 지도·전황판·신체 부위도·평면도라면)',
    '- 뼈대: `position:relative` 컨테이너에 배경(`{{img::지도이름}}` 또는 CSS 그라디언트)을 깔고, 그 위에 요소를 절대배치합니다.',
    '- **지점 핀**: `position:absolute; left:57%; top:45%; transform:translate(-50%,-50%)` — % 좌표라 폭이 변해도 자리가 유지됩니다.',
    '  핀의 class에 위 조건부 수식을 넣어 상태(확보/전투 중/미탐사)를 색·점멸로 가르세요.',
    '- **영역 색칠**: 같은 크기의 투명 이미지 레이어를 겹칩니다 — 레이어마다 `position:absolute; inset:0; width:100%; pointer-events:none`,',
    '  이름을 `{{img::지역_{지역변수}}}`로 조립하면 변수가 바뀔 때 그 지역의 색이 바뀝니다.',
    '- 접었다 펴는 지도는 체크박스 + `:checked ~` 로 (JS 불가). 이때도 `id`에 `{uid}`를 꼭 섞으세요.',
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
  '- 수식에서 참조하는 이름은 반드시 `vars` 또는 `derived`에 정의돼 있어야 합니다. 없는 이름을 쓰면 거부됩니다. '
  + '(예외: 편성표 `party`가 있으면 `deployed` — 편성 슬롯에 앉은 이름들의 읽기 전용 목록 — 를 쓸 수 있습니다)',
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
  '편성표(`party`)가 있으면 `deployed`(편성 슬롯에 앉은 이름들, 읽기 전용 목록)가 자동 제공됩니다 — '
  + '`has(deployed, "아린")`으로 "지금 편성돼 있나"를 조건·showWhen·지시문 어디서든 묻습니다. '
  + '`party.tabs[].when`에 걸면 그 탭이 조건이 참일 때만 보입니다 (인물별 스킬트리 탭 걸러내기).',
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

// 낱말 게이트(mentions) 작성 규칙 (v0.73) — 내장 템플릿에 실물이 하나도 없어 이 규격서가
// 유일한 교재다. 게이트를 모르면 등장 안 한 인물의 호감도까지 매 턴 열리고, 상한(maxDelta)은
// 변화 크기만 막지 빈도를 못 막는다. 반대로 아무 데나 달면 낱말을 놓친 턴의 변화를 잃는다 —
// 그래서 "어디에 달고 어디에 안 다는가"와 "어간으로 적는 요령"을 같이 준다.
const SCHEMA_ALLOW_RULES = [
  '- `allow` 항목에 `mentions`를 달면 **그 낱말이 이번 턴 글에 있을 때만** 보조 AI에게 그 변수가 열립니다 (로어북 키워드와 같은 방식, 부분일치).',
  '- **인물별 수치**(호감·신뢰처럼 인물마다 하나씩 있는 것)에는 `"mentions": true` — 변수의 label(=이름)이 낱말이 됩니다. 별명·애칭이 있으면 배열로 직접: `"mentions": ["세라핀", "세라"]`',
  '- **상태어 수치**(부상·평판·의심처럼 가끔만 움직이는 것)에는 **유의어 4~8개**를 배열로: `"mentions": ["부상", "상처", "붕대", "절뚝", "다쳤", "다친"]`',
  '  유의어는 **명사 위주**로 고르고, 동사·형용사는 문장 종결형 그대로 적지 마세요 — `"다쳤다"`는 그 한 꼴에만 걸립니다.',
  '  끝의 "다"를 뗀 `"다쳤"`은 "다쳤다·다쳤고·다쳤을"에 걸립니다 (부분일치). 한글은 음절이 축약되므로("다치었다"→"다쳤다") 자주 나오는 꼴 2~3개(`"다쳤", "다친", "다치"`)를 같이 적는 게 안전합니다.',
  '- **매 턴 움직이는 핵심 수치**(돈·피로·시각류)에는 mentions를 달지 마세요 — 낱말을 놓친 턴의 변화가 통째로 사라집니다.',
  '- 상태창이 매 턴 찍는 단위 말("골드"처럼 어떤 변수의 `format`에 든 말)은 낱말로 금지 — 매 턴 화면에 찍혀 항상 열리므로 게이트가 무의미해집니다.',
  '- 낱말을 놓쳐도 안전망이 있습니다: 서사가 잠긴 변수의 변화를 서술하면 보조 AI가 신고하고 그 변수가 다음 턴 한 번 열립니다(감지 신고, 기본 켜짐). 그래도 유의어를 잘 갖출수록 반영이 한 턴 빠릅니다.',
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

// 편성표(party, v0.55~0.59) — 규격 압축본. 세부 정답은 검증기 원문이지만, 존재 자체를
// 여기서 안 알리면 AI는 party 키를 영영 모른다 (검증기는 "있으면 검사"지 "만들라"가 아니다).
const SCHEMA_PARTY_RULES = [
  '- 편성표는 **인물을 자리에 앉히는 봇에만** 넣으세요 (파티·함대·부대·영지 인사). 아니면 `party` 키 자체를 빼세요.',
  '- 슬롯 = enum 변수 하나. **enum 값 목록이 곧 편성 후보**이고, 빈값(`empty`, 예: "없음")이 그 목록에 있어야 합니다.',
  '- `roster`에 list 변수를 주면 **그 목록에 있는 이름만** 편성할 수 있습니다 (영입해야 열리는 구조).',
  '- `tabs` 배열로 탭 여러 개: 편성 탭(`slots`) / 시설 탭(`actions` — **기존 액션 id 참조**, 새 트리거를 만들지 마세요) / 업그레이드 탭(`items`).',
  '- `items[]` = `{ "var": int변수, "cost": 숫자|식, "requires": 조건식, "max": 상한 }` — 찍기 = 포인트(`points` 변수) 차감 + 레벨 +1. `max` 1이면 특성(해금)입니다.',
  '- **비용 있는 items를 만들면 포인트 수입 경로도 함께 만드세요** — 이벤트·액션·onTurn이 points 변수를 올려 줘야 찍을 수 있습니다. 수입 없는 스킬트리는 죽은 화면입니다.',
  '- `tabs[].when` = 표시 조건. 거짓이면 탭이 통째로 숨습니다 — `has(deployed, "이름")`을 걸면 편성된 인물의 탭만 남습니다.',
  '- `portraits`(초상)와 `css`는 봇 제작자가 편집기에서 채우는 몫입니다 — AI는 에셋 이름을 모르니 만들지 마세요.',
  '- 실물 예제: "용사의 여정"(rpg — 편성+수련 탭)과 "함대 — 편성과 출격"(fleet — 편성/정비창/보급 탭) 템플릿.',
];

// 달력(calendar, v0.61) — party와 같은 이유로 규격서에 직접 알린다.
const SCHEMA_CALENDAR_RULES = [
  '- 달력은 **시간 체계(`time` 섹션)가 켜진 봇에만** 넣을 수 있습니다. 날짜가 중요한 봇(일상·학원·경영·영지)이 아니면 빼세요.',
  '- `list`에 list 변수를 주면 유저가 달력에서 날짜를 눌러 일정을 등록합니다. 항목은 `"내용 @경과일"`로 저장되는 평범한 목록이라, '
  + '`has(목록, "축제")` 조건·onTurn 만료 규칙(`{ "list": "...", "expire": "elapsed" }` — 지난 일정 자동 삭제)이 그대로 통합니다.',
  '- `marks` = 기념일: `{ "label": "생일", "month": 5, "dom": 14 }`. 적는 칸이 반복을 정합니다 — 월+일=매년, 일만=매달(월세일), 요일만=매주(수업).',
  '- 다른 목록의 `@기한`(계약 만료 등)은 자동으로 달력에 표시됩니다 — 따로 적을 것이 없습니다.',
  '- 일정 목록을 `updater.allow`에 넣으면 보조 AI가 서사에서 "@+N"(며칠 뒤)으로 일정을 잡고, 시스템이 날짜로 굳힙니다.',
];

// 상태창 구조(statusUI.groups/layout) — 꾸미기(CSS·커스텀 템플릿)와 창구를 나눈 쪽의 규격.
// "무엇을 보여줄까"만 다룬다. 색·폰트·배치 HTML은 🎨 꾸미기 창구가 따로 맡는다.
const SCHEMA_STATUS_RULES = [
  '- 상태창은 **그룹(`groups`) → 항목(`items`)** 두 단입니다. 그룹은 화면의 한 칸, 항목은 그 안의 한 줄입니다.',
  '- 항목의 기본형은 `{ "var": "변수id" }`입니다. **위 계약표에 있는 이름만** 쓸 수 있습니다 (파생·시간 노출 이름 포함).',
  '- 게이지 `"bar": { "max": 100 }`는 **최소·최대가 뚜렷한 수치에만** 다세요. `max`에는 수식(`max_hp`)도 됩니다. '
  + '골드·일수처럼 상한이 없는 값에 달면 눈금이 거짓말을 합니다.',
  '- `"showWhen"`은 그 줄의 표시 조건입니다. 평소엔 0이고 사건이 있을 때만 의미가 생기는 값(질투·부상·수배)에 쓰세요.',
  '- 그룹 `"visibility"`: `show`(기본) / `collapsed`(접어둠 — 자주 안 보는 묶음) / `hidden`(화면에서 감춤 — 규칙만 쓰는 내부 수치).',
  '- `"layout"`: `stack`(기본, 쌓기) / `tabs` / `accordion` / `popover`. **탭·팝업은 보이는 그룹이 둘 이상일 때만** 동작합니다.',
  '- 색은 조건식으로 줍니다: `"color": "hp < max_hp * 0.3 ? \'#c0392b\' : \'#2e8b57\'"`. '
  + '**색 코드는 작은따옴표**로 감싸세요 — 편집기의 색 고르개가 그 형태만 되읽습니다.',
  '- ⚠ **날짜·시각 줄을 직접 만들지 마세요.** `day` 같은 변수를 새로 요구하지 말고, 계약표에 `date`·`clock`·`weekday`가 '
  + '있으면 `{ "var": "date" }`처럼 **그 이름을 그대로 참조**하세요. 계약표에 없으면 이 봇은 시간 체계가 꺼진 것이니 '
  + '날짜 줄 자체를 넣지 마세요 — 켜는 것은 [시간] 탭의 몫입니다.',
  '- **꾸미기는 여기서 하지 않습니다.** 색·폰트·테두리·커스텀 HTML은 별도 창구(🎨 꾸미기)가 담당합니다. `groups`와 `layout`만 주세요.',
  '- 한 그룹에 항목을 열 개 넘게 몰지 마세요. 주제별로 나누고, 자주 안 보는 묶음은 `collapsed`로 접어 두세요.',
];

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
    '- 최상위 키: `simcore`("0.1"), `meta`, `vars`, `derived`, `rules`, `directives`, `actions`, `updater`, `promptState`, `statusUI`, `setup`, `party`(선택 — 편성표가 어울리는 봇만), `calendar`(선택 — 시간 체계 켠 봇만)',
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
    '## 낱말 게이트 — `updater.allow`의 `mentions`, 변수를 등장한 턴에만 열기',
    ...SCHEMA_ALLOW_RULES,
    '',
    '## 반복 이벤트 — once인가 래치인가',
    ...SCHEMA_EVENT_PATTERN_RULES,
    '',
    '## 편성표(party) — 인물을 자리에 앉히는 봇이면 (선택)',
    ...SCHEMA_PARTY_RULES,
    '',
    '## 달력(calendar) — 날짜가 중요한 봇이면 (선택)',
    ...SCHEMA_CALENDAR_RULES,
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
  // 편성표(v0.55~) — 패치 대상이 아니지만 **참조를 모르면 사고가 난다**: 편성표가 가리키는
  // 액션·변수를 remove하면 가져오기가 정지되는데, 다이제스트에 없으면 AI는 원인을 모른다.
  // (require 대신 인라인 정규화 — 이 구간은 테스트가 단독 평가해서 모듈을 못 부른다)
  if (schema.party && typeof schema.party === 'object') {
    const P = schema.party;
    const tabs = Array.isArray(P.tabs) && P.tabs.length ? P.tabs
      : [{ slots: P.slots, actions: P.actions, items: P.items, roster: P.roster, points: P.points }];
    const flat = (k) => tabs.flatMap((t) => Array.isArray(t?.[k]) ? t[k] : []);
    const uniq = (a) => [...new Set(a.filter(Boolean))];
    const refVars = uniq([
      ...flat('slots').map((s) => s?.var), ...flat('items').map((it) => it?.var),
      ...tabs.map((t) => t?.roster), P.roster, ...tabs.map((t) => t?.points), P.points,
    ]);
    const refActs = uniq(flat('actions'));
    out.push('', '### 편성표 (party) — 패치로 못 다룹니다. 참조만 알아 두세요',
      `- 편성표가 참조하는 변수: ${refVars.map((v) => `\`${v}\``).join(' ') || '(없음)'} — **remove 금지** (지우면 가져오기 정지)`,
      ...(refActs.length
        ? [`- 편성표 탭이 버튼으로 쓰는 액션: ${refActs.map((a) => `\`${a}\``).join(' ')} — **remove 금지**, update는 됩니다`]
        : []),
      '- 조건식에서는 `deployed`(편성 슬롯에 앉은 이름들, 읽기 전용 목록)를 쓸 수 있습니다 — `has(deployed, "이름")`');
  }
  // 달력(v0.61) — 같은 이유: 일정 목록 변수를 지우면 달력이 깨지는데 AI가 원인을 모른다
  if (schema.calendar && typeof schema.calendar === 'object' && schema.calendar.list) {
    out.push('', '### 달력 (calendar) — 패치로 못 다룹니다',
      `- 일정 목록 \`${schema.calendar.list}\` — **remove 금지** (달력 일정 등록이 이 목록에 삽니다). `
      + '항목의 `@숫자`는 날짜 기한 표기이니 지우지 마세요.');
  }
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
    '- 상태창(statusUI)·onTurn·setup·meta·편성표(party)·달력(calendar)은 패치로 못 다룹니다. 그쪽 수정이 필요하면 JSON 대신 그 사실을 알려주세요.',
    '- 새 변수를 AI(보조 모델)가 서사에 따라 움직여야 하면 `allow`에도 같이 추가하세요.',
    '  단 **판정값·이벤트 플래그·날짜류 카운터·숨긴 정답은 allow에 넣지 마세요** — 시스템이 굴리는 값입니다.',
    '- 한 인물의 변수 여러 개(호감·기분·위치…)가 같은 mentions 낱말을 공유하는 것은 **정상 설계**입니다',
    '  (그 인물 장면에서 함께 열림). 경고를 지우려고 낱말을 억지로 나누지 마세요.',
    '',
    '## 낱말 게이트 — `allow`의 `mentions`, 변수를 등장한 턴에만 열기',
    ...SCHEMA_ALLOW_RULES,
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
    // 에셋 팩 (v0.64) — 변수 0개여도 팩이 있으면 빈 봇이 아니다. 여기서 빠뜨리면
    // 에셋 전용 봇이 "아직 스키마가 없습니다" 취급을 받아 기능 카드도 패치 경로도 안 열린다.
    + n(s.assets && s.assets.packs)
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
  // 시간 노출 이름도 계약이다. 이게 빠지면 AI는 date를 못 쓰는 줄 알고 day 변수를 새로 만들자고 한다 —
  // design-시간.md §결정 1이 막으려는 바로 그 길이라, 상태창·규칙 요청서 전부가 이 표에 기댄다.
  const tcfg = timeConfig(schema);
  const exposed = tcfg?.expose ?? [];
  if (exposed.length) {
    out.push('',
      '### 시간 체계가 켜져 있습니다 — 아래 이름은 **읽기 전용**으로 그냥 쓸 수 있습니다.',
      '날짜·시각 변수를 새로 만들지 마세요. 날짜 계산도 하지 마세요 — 요일·윤년·자릿수는 엔진이 처리합니다.',
      '| id | 뜻 |', '|---|---|',
      ...exposed.map((n) => `| \`${n}\` | ${EXPOSED_LABELS[n] ?? n} |`));
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
  // 편성표(v0.60) — party 객체 통째 교체. portraits·css까지 실려 나가므로 요청서가
  // "원문 그대로 옮겨 담아라"를 못박는다 (제작자가 손으로 채운 값이라 AI가 지어낼 수 없다).
  party: { keys: ['party'], label: '편성표' },
  // 상태창(v0.62) — 구조 창구. statusUI를 통째로 갈아끼우면 제작자가 쌓은 꾸미기
  // (customCSS·커스텀 템플릿·테마)까지 날아가므로, groups 하나만 갈아끼우고 layout만 덤으로 받는다.
  // 꾸미기는 👁 결과 탭의 🎨 창구가 따로 맡는다 — 같은 절을 두 창구가 겹치지 않게 나눠 쥔다.
  status: { keys: ['statusUI'], sub: 'groups', subOpt: ['layout'], label: '상태창' },
  // 달력(v0.63.1) — calendar 객체 통째 교체. css는 제작자 손값이라 원문 보존을 요청서가
  // 못박는다. 일정 목록 변수·만료 규칙은 vars/rules 절 몫 — 📅 카드가 순차로 나눠 맡긴다.
  calendar: { keys: ['calendar'], label: '달력' },
};

// 직결 생성 입력칸의 예시 문구 — 여기 쓴 내용이 요청서의 '내가 원하는 것'에 그대로 들어간다.
// 빈 칸으로 눌러도 된다 (그 경우 요청서의 기본 안내문이 그대로 나간다).
const TAB_WANT_PH = {
  vars: '예: 눈 덮인 산장에서 겨울나기 — 체온·장작·식량을 굴리고 싶다',
  commands: '예: 골드는 /돈, 소지품은 /가방으로 치게',
  actions: '예: 사냥·장작패기·불침번 — 불침번은 끌 때까지 유지되게',
  checks: '예: d20 능력 판정 4종, 대실패는 상황이 악화되게',
  rules: '예: 체온이 0 아래로 3턴 가면 동사, 눈보라는 가끔 터지게',
  presets: '예: 난이도 3단계 — 어려움은 이미 위기 상황에서 시작',
  party: '예: 출격 편성 3슬롯 + 정비창 탭',
  status: '예: 체력·허기·기온은 게이지로 맨 위, 소지품은 접어서 아래',
  calendar: '예: 마을 축제는 매년 10월 15일, 정산일은 매달 1일, 약속 목록 연결',
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
  else if (tabKey === 'status') {
    // 그룹 수만으로는 부족하다 — AI가 그룹은 남기고 항목만 솎아내는 쪽이 더 흔하다
    push('statusUI.groups', schema.statusUI?.groups);
    out.push(['표시 항목', (schema.statusUI?.groups || []).reduce((n, g) => n + (g.items?.length || 0), 0)]);
  }
  else if (tabKey === 'party') {
    // 인라인 정규화 (축약형 = 탭 1개) — 이 구간은 테스트가 단독 평가라 party 모듈을 못 부른다
    const P = schema.party || {};
    const tabs = Array.isArray(P.tabs) && P.tabs.length ? P.tabs
      : (P.slots || P.actions || P.items ? [P] : []);
    if (Array.isArray(P.tabs)) push('party.tabs', P.tabs);
    push('슬롯(전체 탭)', tabs.flatMap((t) => Array.isArray(t?.slots) ? t.slots : []));
    push('업그레이드(전체 탭)', tabs.flatMap((t) => Array.isArray(t?.items) ? t.items : []));
  }
  else if (tabKey === 'calendar') push('calendar.marks', schema.calendar?.marks);
  else if (tabKey === 'rules') {
    push('rules.onTurn', schema.rules?.onTurn);
    push('rules.events', schema.rules?.events);
    push('rules.randomEvents.table', schema.rules?.randomEvents?.table);
    push('directives', schema.directives);
  }
  return out;
}

// ── 🧩 기능 추가 — 카드 하나가 "규격에 맞춰 AI에게 맡기기"를 대신 눌러준다 ────
//
// 고정된 패치 JSON이 아니다 (design-기능프리셋.md §방향 전환). 상태창·편성표·스킬트리는
// 애초에 그 봇의 변수가 있어야 성립하므로 찍어낼 수 없고, 굴러가는 스키마에 밀어 넣으면
// 이름·전제가 어긋나며 제작자의 작업을 덮는다. 그래서 카드가 만드는 것은 **요청서**다 —
// 하는 일은 tabWant[슬라이스]를 채우고 그 탭의 직결 생성을 부르는 것뿐이라,
// 검사·계획 확인·되돌리기가 전부 탭별 도구의 것을 그대로 탄다.
//
// steps가 여럿이면 **순차**다. 변수부터 확정해야 다음 절이 그 변수를 보고 만든다 —
// 한 번에 다 시키면 없는 이름을 지어내면서 전부 어긋난다 (진단 수정 요청과 같은 이유).
const FEATURE_RECIPES = [
  {
    id: 'status_set', icon: '📊', label: '상태창 한 벌',
    desc: '지금 변수들을 주제별 그룹으로 묶고 게이지·표시 조건까지 배정',
    needs: (s) => ((s.vars || []).length >= 2 ? null : '변수가 2개 이상 있어야 합니다 — [변수] 탭에서 먼저'),
    steps: [{ tab: 'status', want: '지금 있는 변수들을 주제별 그룹으로 묶어 상태창을 한 벌 짜 주세요. '
      + '최소·최대가 뚜렷한 수치는 게이지로, 평소 0이고 사건 때만 의미가 생기는 값은 표시 조건을 걸어 주세요. '
      + '자주 안 보는 묶음은 접어 두세요.' }],
  },
  {
    id: 'shop', icon: '🛒', label: '상점',
    desc: '돈을 쓰는 구매 액션 묶음 — 못 살 땐 버튼이 잠김',
    needs: (s) => {
      if (!(s.vars || []).some((v) => v.type === 'int' || v.type === 'float')) return '돈으로 쓸 숫자 변수가 필요합니다';
      if (!(s.vars || []).some((v) => v.type === 'list')) return '소지품으로 쓸 목록 변수가 필요합니다';
      return null;
    },
    steps: [{ tab: 'actions', want: '돈을 소모해 물건을 사는 상점 액션을 몇 개 만들어 주세요. '
      + '살 돈이 모자라면 버튼이 잠기게 조건을 걸고, 산 물건은 소지품 목록에 들어가게 해 주세요.' }],
  },
  {
    id: 'quest_board', icon: '📜', label: '퀘스트 보드',
    desc: '의뢰가 뜨고, 수주를 고르고, 기한이 지나면 사라지는 한 벌',
    needs: (s) => (s.time ? null : '시간 체계가 필요합니다 — [시간] 탭에서 먼저 켜세요'),
    steps: [
      { tab: 'vars', want: '의뢰 목록 변수(항목에 "@기한"이 붙는 list)와 평판·보수처럼 의뢰에 딸린 수치를 만들어 주세요.' },
      { tab: 'rules', want: '가끔 새 의뢰가 붙는 랜덤 이벤트를 만들어 주세요 — 받을지 말지 고르는 갈림길을 달고, '
        + '기한이 지난 의뢰는 목록에서 자동으로 사라지게 정리 규칙도 함께 주세요.' },
    ],
  },
  {
    id: 'level', icon: '📈', label: '레벨·성장',
    desc: '경험치가 쌓이면 레벨이 오르고 포인트를 주는 한 벌',
    needs: () => null,
    steps: [
      { tab: 'vars', want: '경험치·레벨·남은 포인트 변수를 만들어 주세요.' },
      { tab: 'rules', want: '경험치가 기준을 넘으면 레벨이 오르고 포인트를 주는 이벤트를 만들어 주세요. '
        + '레벨이 오를 때 알림이 뜨게 해 주세요.' },
    ],
  },
  {
    id: 'affection', icon: '💕', label: '호감도 인물',
    desc: '한 인물의 호감 수치 + 관계 단계 + 단계별 서술 지시문',
    needs: () => null,
    steps: [
      { tab: 'vars', want: '인물 한 명의 호감 수치와, 그 수치로 자동 계산되는 관계 단계(파생 변수)를 만들어 주세요.' },
      { tab: 'rules', want: '관계 단계에 따라 그 인물의 태도·말투가 달라지는 서술 지시문을 단계마다 하나씩 만들어 주세요.' },
    ],
  },
  {
    id: 'skilltree', icon: '🌳', label: '스킬트리',
    desc: '포인트를 찍어 올리는 스킬 탭 — 선행 조건까지',
    needs: () => null,
    steps: [
      { tab: 'vars', want: '스킬 포인트 변수와, 포인트를 써서 올릴 스킬 레벨 변수 몇 개를 만들어 주세요.' },
      // 수입 경로를 안 만들면 진단이 '못 버는 포인트'로 잡는다 — 죽은 화면을 만들지 않으려면 필수 단계다
      { tab: 'rules', want: '스킬 포인트를 버는 경로를 만들어 주세요 — 조건을 넘기면 포인트를 주는 이벤트로요. '
        + '수입이 없으면 스킬 탭은 아무것도 못 찍는 죽은 화면이 됩니다.' },
      { tab: 'party', want: '스킬 포인트로 찍는 업그레이드 탭을 만들어 주세요. '
        + '뒷 단계 스킬에는 앞 단계를 요구하는 선행 조건을 걸어 주세요.' },
    ],
  },
  {
    id: 'party', icon: '⚓', label: '편성표',
    desc: '인물을 자리에 앉히는 편성 탭',
    needs: (s) => ((s.vars || []).some((v) => v.type === 'enum' || v.type === 'list')
      ? null : '편성 후보로 쓸 enum 또는 목록 변수가 필요합니다'),
    steps: [{ tab: 'party', want: '인물을 자리에 앉히는 편성 탭을 만들어 주세요. '
      + '자리를 비워 둘 수 있게 빈값도 후보에 넣어 주세요.' }],
  },
  {
    id: 'calendar', icon: '📅', label: '달력·일정',
    desc: '세계관 기념일이 박힌 달력 + 날짜 클릭 일정 등록',
    needs: (s) => (s.time ? null : '시간 체계가 필요합니다 — [시간] 탭에서 먼저 켜세요'),
    steps: [
      { tab: 'vars', want: '달력에서 쓸 일정 목록(list) 변수를 하나 만들어 주세요 — 약속·예정된 일이 들어가고 '
        + '항목 끝에 "@기한"이 붙습니다. 알맞은 목록이 이미 있으면 새로 만들지 말고 그대로 두세요.' },
      { tab: 'rules', want: '일정 목록의 기한이 지난 항목이 자동으로 사라지는 정리 규칙(onTurn expire)을 넣어 주세요.' },
      { tab: 'calendar', want: '이 봇 세계관에 어울리는 기념일(생일·축제·정산일·정기 모임)을 달력에 박고, '
        + '일정 목록을 연결해 주세요.' },
    ],
  },
];

/**
 * 이 탭이 지금 쥐고 있는 항목들의 **신원** 목록. 가져오기 전후를 비교해 사라지는 것을 찾는다.
 * 개수 체크섬(tabItemCounts)이 "몇 개 줄었나"라면 이쪽은 "무엇이 없어지나"다 —
 * 넣은 뒤에 경고하는 것과 넣기 전에 막는 것의 차이라, 통 교체의 실질 안전판은 이쪽이다.
 * (같은 이름이 둘이면 집합에서 하나로 뭉친다. 그 몫은 개수 체크섬이 잡는다.)
 */
function tabItemIds(schema, tabKey) {
  const out = [];
  const add = (kind, arr, key = 'id') => {
    for (const it of (Array.isArray(arr) ? arr : [])) {
      const v = it && typeof it === 'object' ? it[key] : it;
      if (v != null && v !== '') out.push(`${kind} ${v}`);
    }
  };
  if (tabKey === 'vars') { add('변수', schema.vars); add('파생', schema.derived); }
  else if (tabKey === 'commands') add('명령', (schema.vars || []).filter((v) => v.cmd));
  else if (tabKey === 'actions') add('액션', schema.actions);
  else if (tabKey === 'checks') add('판정', schema.checks);
  else if (tabKey === 'presets') add('프리셋', schema.setup?.presets);
  else if (tabKey === 'status') {
    const gs = schema.statusUI?.groups || [];
    gs.forEach((g, i) => out.push(`그룹 ${g?.label || `#${i + 1}`}`));
    add('항목', gs.flatMap((g) => (Array.isArray(g?.items) ? g.items : [])), 'var');
  } else if (tabKey === 'party') {
    const P = schema.party || {};
    const tabs = Array.isArray(P.tabs) && P.tabs.length ? P.tabs
      : (P.slots || P.actions || P.items ? [P] : []);
    if (Array.isArray(P.tabs)) add('탭', P.tabs);
    add('슬롯', tabs.flatMap((t) => (Array.isArray(t?.slots) ? t.slots : [])), 'var');
    add('업그레이드', tabs.flatMap((t) => (Array.isArray(t?.items) ? t.items : [])), 'var');
  } else if (tabKey === 'calendar') {
    add('기념일', schema.calendar?.marks, 'label');
    // 일정 목록 연결은 스칼라지만 잃어버리면 등록 기능이 통째로 죽는다 — 신원으로 취급해 지킨다
    if (schema.calendar?.list) out.push(`일정 목록 ${schema.calendar.list}`);
  } else if (tabKey === 'rules') {
    add('이벤트', schema.rules?.events);
    add('랜덤', schema.rules?.randomEvents?.table);
    add('지시문', schema.directives);
  }
  return out;
}

/** 가져오기 계획 — 적용하면 무엇이 사라지고 무엇이 생기는가 (스키마를 건드리지 않는다) */
function planTabImport(schema, tabKey, picked) {
  const before = tabItemIds(schema, tabKey);
  const after = tabItemIds({ ...schema, ...JSON.parse(JSON.stringify(picked)) }, tabKey);
  const beforeSet = new Set(before), afterSet = new Set(after);
  return {
    lost: [...beforeSet].filter((s) => !afterSet.has(s)),
    gained: [...afterSet].filter((s) => !beforeSet.has(s)),
  };
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
  } else if (slice.sub) {
    current[slice.sub] = schema[slice.keys[0]]?.[slice.sub] ?? [];
    // 곁딸린 스칼라(상태창 layout 등) — 있으면 같이 보여줘야 AI가 현 상태를 알고 고른다
    for (const k of slice.subOpt ?? []) {
      const v = schema[slice.keys[0]]?.[k];
      if (v !== undefined) current[k] = v;
    }
  } else for (const k of slice.keys) if (schema[k] !== undefined) current[k] = schema[k];
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
      party: '(여기를 채우세요 — 예: "출격 편성 3슬롯 + 정비창 탭" / "동료 4명 각자 스킬트리 탭, 편성된 동료 탭만 보이게" / "영지 시설 레벨 찍는 업그레이드 탭")',
      status: '(여기를 채우세요 — 예: "체력·허기·기온은 게이지로 맨 위, 소지품은 접어서 아래" / "인물 4명을 각각 그룹으로 나누고 탭으로" / "위험할 때만 뜨는 경고 줄 몇 개")',
    };
    // 직결 생성은 유저가 쓴 요구를 여기에 꽂는다. 복사 왕복이면 빈 자리표시자가 그대로 나가고,
    // 유저가 붙여넣기 전에 손으로 채운다 — 같은 요청서를 두 경로가 나눠 쓴다.
    const want = String(opts.want ?? '').trim();
    head.push('## 내가 원하는 것',
      want || WANT[tabKey] || '(여기를 채우세요 — 어떤 봇이고, 어떤 사건/행동이 있으면 좋겠는지)',
      '');
  }

  head.push('## 출력 형식',
    `- **JSON 하나만** 출력하세요. 최상위 키는 ${(slice.sub ? [slice.sub, ...(slice.subOpt ?? [])] : slice.keys).map((k) => `\`"${k}"\``).join(', ')} 입니다.`,
    '- 설명은 코드펜스 밖에 쓰지 마세요.',
    '',
    '## ⚠ 반드시 이 탭 전체를 다시 주세요',
    '가져오기는 이 탭을 **통째로 갈아끼웁니다.** 고친 항목만 보내면 **나머지가 전부 사라집니다.**',
    '손대지 않은 항목도 원문 그대로 옮겨 담아 한 세트로 돌려주세요.',
    ...(tabKey === 'presets'
      ? ['(갈아끼워지는 건 프리셋 목록뿐입니다. 같은 탭의 AI 최초설정은 그대로 남습니다.)'] : []),
    ...(tabKey === 'status'
      ? ['(갈아끼워지는 건 그룹 목록과 배치뿐입니다. 커스텀 CSS·HTML 템플릿·테마는 그대로 남습니다 — 손대지 마세요.)'] : []),
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
  } else if (tabKey === 'party') {
    body.push('## 편성표 규격', ...SCHEMA_PARTY_RULES, '',
      '## 이미 있는 액션 — 탭의 `actions`는 이 id만 참조할 수 있습니다',
      (schema.actions || []).length
        ? (schema.actions).map((a) => `- \`${a.id}\` ${a.label ?? ''}`).join('\n')
        : '(없음 — actions 참조를 넣지 마세요. 시설 버튼이 필요하면 JSON 대신 그 사실을 알려주세요)',
      '',
      '## ⚠ portraits(초상)·css가 이미 있으면 원문 그대로 옮겨 담으세요',
      '봇 제작자가 손으로 채운 값입니다. 고치라는 요청이 없는 한 지우지도, 지어내지도 마세요.',
      '',
      '## 이런 모양으로 주세요',
      '⚠ 아래 예시는 **다른 봇의 변수 이름**입니다. 형태만 보고, 이름은 반드시 위 계약표의 것으로 바꿔 쓰세요.',
      '```json',
      '{ "party": { "label": "편성", "icon": "⚔️", "empty": "없음", "roster": "allies",',
      '  "tabs": [',
      '    { "id": "main", "label": "편성", "slots": [ { "var": "front", "label": "전위" } ] },',
      '    { "id": "train", "label": "수련", "points": "sp", "when": "has(deployed, \'아린\')",',
      '      "items": [ { "var": "skill_sword", "cost": 1, "max": 5 } ] }',
      '  ] } }',
      '```',
      '');
  } else if (tabKey === 'status') {
    body.push('## 상태창 규격', ...SCHEMA_STATUS_RULES, '',
      '## 이런 모양으로 주세요',
      '⚠ 아래 예시는 **다른 봇의 변수 이름**입니다. 형태만 보고, 이름은 반드시 위 계약표의 것으로 바꿔 쓰세요.',
      '```json',
      '{ "layout": "stack",',
      '  "groups": [',
      '    { "label": "몸 상태", "items": [',
      '      { "var": "hp", "bar": { "max": "max_hp" }, "color": "hp < max_hp * 0.3 ? \'#c0392b\' : \'#2e8b57\'" },',
      '      { "var": "hunger", "bar": { "max": 100 } },',
      '      { "var": "wound", "showWhen": "wound > 0" } ] },',
      '    { "label": "소지품", "visibility": "collapsed", "items": [',
      '      { "var": "gold" }, { "var": "pack" } ] }',
      '  ] }',
      '```',
      '');
  } else if (tabKey === 'calendar') {
    const tcal = timeConfig(schema);
    const listVars = (schema.vars || []).filter((v) => v.type === 'list');
    body.push('## 달력 규격', ...SCHEMA_CALENDAR_RULES, '',
      '## 이미 있는 목록 변수 — `list`(일정 등록용)는 이 중에서만 고를 수 있습니다',
      listVars.length
        ? listVars.map((v) => `- \`${v.id}\` ${v.label ?? ''}`).join('\n')
        : '(없음 — `list` 항목을 넣지 마세요. 보기 전용 달력이 됩니다. 일정 목록이 필요하면 JSON 대신 그 사실을 알려주세요)',
      '',
      ...(tcal ? [`## 이 봇의 요일 이름 — \`weekday\`는 이 중에서만: ${tcal.weekdays.join(' · ')}`, ''] : []),
      '## ⚠ css가 이미 있으면 원문 그대로 옮겨 담으세요',
      '봇 제작자가 손으로 채운 값입니다. 고치라는 요청이 없는 한 지우지도, 지어내지도 마세요.',
      '',
      '## 이런 모양으로 주세요',
      '⚠ 아래 예시는 **다른 봇의 이름**입니다. 형태만 보고, 이름은 위 계약표·목록의 것으로 바꿔 쓰세요.',
      '```json',
      '{ "calendar": { "label": "달력", "icon": "📅", "list": "plans",',
      '  "marks": [',
      '    { "label": "상대 생일", "month": 5, "dom": 14, "note": "잊으면 큰일 난다." },',
      '    { "label": "정산일", "dom": 1 },',
      '    { "label": "도서부 모임", "weekday": "수" }',
      '  ] } }',
      '```',
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
    const idCounts = new Map();
    for (const v of (schema?.vars || [])) idCounts.set(v.id, (idCounts.get(v.id) || 0) + 1);
    const byId = {};
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      const id = c && (c.var ?? c.id);
      const name = c && c.cmd;
      if (!id || !name) throw new Error(`commands[${i}]에 var 또는 cmd가 없습니다`);
      if (!(schema?.vars || []).some((v) => v.id === id)) throw new Error(`'${id}'은 없는 변수입니다`);
      if ((idCounts.get(id) || 0) > 1) throw new Error(`변수 ID '${id}'이 중복되어 명령 대상을 고를 수 없습니다`);
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
    const next = { ...(schema?.[host] ?? {}), [slice.sub]: arr };
    // 곁딸린 스칼라는 준 것만 반영한다 — 빠뜨렸다고 기존 설정을 지우면 그게 손실이다
    for (const k of slice.subOpt ?? []) {
      const v = frag[k] !== undefined ? frag[k] : frag[host]?.[k];
      if (v !== undefined) next[k] = v;
    }
    return { [host]: next };
  }

  // 스키마를 통째로 준 경우에도 이 탭 몫만 뽑아 쓴다
  const picked = {};
  for (const k of slice.keys) if (frag[k] !== undefined) picked[k] = frag[k];
  if (!Object.keys(picked).length) {
    throw new Error(`${slice.keys.map((k) => `"${k}"`).join(' 또는 ')} 키가 없습니다`);
  }
  return picked;
}

// 행 이동/삭제 버튼 묶음. onDelete/onMove를 주면 변수 탭의 복구·이동 피드백을 연결한다.
function grip(list, i, rerender, onDelete, onMove) {
  const move = (d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    if (onMove) onMove(list[j], j, d);
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
    '- **optional이 아닌 칸에는 fallback을 반드시 넣어라** (가장 무난한 값 — 감정이면 중립). '
    + '보조 AI가 그 칸을 빠뜨리거나 없는 조합을 고르면 fallback이 이미지를 구해 준다. 없으면 그 턴 이미지가 통째로 사라진다.',
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
  const { onChange, ai, floor, onRequestFloor, isInstalled,
    getFirstInstallGuideDismissed, setFirstInstallGuideDismissed } = opts; // ai = { generate(prompt)→Promise<text|null|{blocked}>, getBotContext()→Promise } — 어댑터 주입
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
  // 변수 카드의 접힘 상태는 편집 화면에만 남기고 스키마에는 기록하지 않는다.
  const collapsedVariableCards = new WeakSet();
  let deletedVariableCard = null;
  let variableMoveFeedback = null; // { item, position, kind } — 다음 렌더에서 한 번 소비
  let createdVariableCard = null;
  let deletedCommand = null;
  const collapsedCommandCards = new WeakSet();
  let createdCommandCard = null;
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
  let firstInstallGuideDismissed = false;
  if (typeof getFirstInstallGuideDismissed === 'function') {
    Promise.resolve(getFirstInstallGuideDismissed()).then((value) => {
      if (destroyed) return;
      firstInstallGuideDismissed = !!value;
      render();
    }).catch(() => {});
  }

  const style = h('style', {}, CSS);
  const root = h('div', { class: 'sce' });
  container.appendChild(style);
  container.appendChild(root);

  // 3층(심층 편집)의 탭들 — 진단은 1층(AI에게 맡기기 곁)으로, JSON은 2층(독립 작업대)으로 올라갔다
  const TABS = [
    ['vars', '변수'], ['commands', '명령'], ['status', '상태창'], ['party', '편성표'], ['calendar', '달력'], ['rules', '규칙·이벤트'],
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
    const validation = validateSchema(schema);
    const referencedIds = new Set(idsUsedElsewhere(schema));
    let fieldErrorSeq = 0;
    const itemErrors = (path) => validation.errors.filter((e) => e.path === path || e.path.startsWith(path + '.'));
    const issueKind = (error) => {
      const msg = String(error.msg || '');
      if (/\.expr$/.test(error.path || '')) return 'expr';
      if (/id|예약어|중복/.test(msg)) return 'id';
      if (/알 수 없는 type/.test(msg)) return 'type';
      if (/enum/.test(msg)) return /init/.test(msg) ? 'init' : 'enum';
      if (/maxLength/.test(msg)) return 'maxLength';
      if (/itemMaxLength/.test(msg)) return 'itemMaxLength';
      if (/maxItems/.test(msg)) return 'maxItems';
      if (/min > max/.test(msg)) return 'range';
      if (/init|bool|list 항목/.test(msg)) return 'init';
      return 'card';
    };
    const fieldIssues = (path, ...kinds) => itemErrors(path).filter((e) => kinds.includes(issueKind(e)));
    const variableField = (label, control, { title = '', wide = false, issues = [] } = {}) => {
      let errorId;
      if (issues.length) {
        errorId = `sce-variable-error-${++fieldErrorSeq}`;
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', errorId);
      }
      return h('div', {
        class: `sce-variable-field${wide ? ' is-wide' : ''}${issues.length ? ' has-error' : ''}`,
        title,
      }, h('span', {}, label), control,
      issues.length ? h('span', { id: errorId, class: 'sce-field-error' },
        issues.map((e) => e.msg).join(' · ')) : null);
    };
    const referenceNote = (item) => referencedIds.has(item.id)
      ? h('div', { class: 'sce-variable-reference-note' },
        '이 ID를 바꾸면 규칙·상태창에서 이 변수를 찾지 못해요.')
      : null;
    const itemLines = (items) => (Array.isArray(items) ? items : []).join('\n');
    const parseItemLines = (text) => String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const nextEditorId = (prefix) => {
      const used = new Set([...schema.vars, ...schema.derived].map((item) => item?.id).filter(Boolean));
      let n = 1;
      while (used.has(`${prefix}${n}`)) n += 1;
      return `${prefix}${n}`;
    };
    const trimSummary = (value, limit = 32) => {
      const text = String(value ?? '').trim();
      return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
    };
    const variableSummary = (item, derived = false) => {
      if (derived) return `${item.id || 'ID 미정'} · 계산식 ${trimSummary(item.expr || '0', 38)}`;
      const id = item.id || 'ID 미정';
      if (item.type === 'int' || item.type === 'float') {
        return `${id} · ${item.type === 'int' ? '정수' : '실수'} · 시작 ${item.init ?? 0}`;
      }
      if (item.type === 'text') return `${id} · 텍스트 · ${trimSummary(item.init) || '빈 문자열'}`;
      if (item.type === 'bool') return `${id} · ON/OFF · ${item.init ? '켜짐' : '꺼짐'}`;
      if (item.type === 'enum') return `${id} · 선택지 ${(item.enum || []).length}개 · 시작 ${item.init ?? '미정'}`;
      if (item.type === 'list') {
        const count = Array.isArray(item.init) ? item.init.length : 0;
        return `${id} · 목록 ${count}개 · 최대 ${item.maxItems ?? '제한 없음'}`;
      }
      return `${id} · ${item.type || '형식 미정'}`;
    };
    const deleteWithUndo = (listKey, index, fallbackTitle) => {
      const list = schema[listKey];
      const [item] = list.splice(index, 1);
      deletedVariableCard = { listKey, index, item, title: item?.label?.trim() || fallbackTitle };
      rerender();
      return false;
    };
    const bulkControls = (list, pathBase) => {
      const errorIndexes = new Set(list.map((_, i) => itemErrors(`${pathBase}[${i}]`).length ? i : -1).filter((i) => i >= 0));
      return [
        h('button', { class: 'sce-btn sce-mini', disabled: !list.length ? 'disabled' : undefined,
          onclick: () => { list.forEach((item) => collapsedVariableCards.add(item)); rerender(); } }, '모두 접기'),
        h('button', { class: 'sce-btn sce-mini', disabled: !list.length ? 'disabled' : undefined,
          onclick: () => { list.forEach((item) => collapsedVariableCards.delete(item)); rerender(); } }, '모두 펼치기'),
        h('button', { class: 'sce-btn sce-mini', disabled: !errorIndexes.size ? 'disabled' : undefined,
          onclick: () => {
            list.forEach((item, i) => {
              if (errorIndexes.has(i)) collapsedVariableCards.delete(item);
              else collapsedVariableCards.add(item);
            });
            rerender();
        } }, `오류만 펼치기${errorIndexes.size ? ` ${errorIndexes.size}` : ''}`),
      ];
    };
    const variableCardElements = new Map();
    const beginVariableDrag = (item, list, event, handle) => {
      if (event.button !== 0) return;
      const sourceCard = variableCardElements.get(item);
      if (!sourceCard) return;
      event.preventDefault();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      let ghost = null;
      let targetItem = null;
      let afterTarget = false;

      const clearTargets = () => {
        for (const card of variableCardElements.values()) {
          card.classList.remove('is-drag-before', 'is-drag-after');
        }
      };
      const cleanup = () => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerCancel);
        try { handle.releasePointerCapture?.(pointerId); } catch (e) { /* 이미 해제된 환경 */ }
        ghost?.remove();
        sourceCard.classList.remove('is-dragging');
        clearTargets();
      };
      const commit = () => {
        cleanup();
        if (!moved || !targetItem || targetItem === item) return;
        const originalIndex = list.indexOf(item);
        const withoutItem = list.filter((candidate) => candidate !== item);
        let nextIndex = withoutItem.indexOf(targetItem);
        if (originalIndex < 0 || nextIndex < 0) return;
        if (afterTarget) nextIndex += 1;
        if (nextIndex === originalIndex) return;
        withoutItem.splice(nextIndex, 0, item);
        list.splice(0, list.length, ...withoutItem);
        variableMoveFeedback = { item, position: nextIndex + 1, kind: 'drag' };
        rerender();
      };
      const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 8) return;
        if (!moved) {
          moved = true;
          ghost = sourceCard.cloneNode(true);
          ghost.className = 'sce-variable-drag-ghost';
          ghost.setAttribute('aria-hidden', 'true');
          ghost.setAttribute('inert', '');
          const width = sourceCard.getBoundingClientRect().width;
          if (width > 0) ghost.style.width = `${width}px`;
          ghost.appendChild(h('span', { class: 'sce-variable-drag-ghost-badge' }, '이동 중'));
          root.appendChild(ghost);
        }
        ghost.style.left = `${moveEvent.clientX + 14}px`;
        ghost.style.top = `${moveEvent.clientY + 14}px`;
        const candidates = [...variableCardElements.entries()]
          .filter(([candidate]) => candidate !== item && list.includes(candidate))
          .map(([candidate, card]) => ({ candidate, card, bounds: card.getBoundingClientRect() }))
          .sort((a, b) => a.bounds.top - b.bounds.top);
        if (!candidates.length) return;
        const target = candidates.find(({ bounds }) => moveEvent.clientY < bounds.top + bounds.height / 2)
          || candidates[candidates.length - 1];
        clearTargets();
        targetItem = target.candidate;
        afterTarget = moveEvent.clientY > target.bounds.top + target.bounds.height / 2;
        target.card.classList.add(afterTarget ? 'is-drag-after' : 'is-drag-before');
        if (moveEvent.clientY < 48) window.scrollBy(0, -20);
        else if (moveEvent.clientY > window.innerHeight - 48) window.scrollBy(0, 20);
      };
      const onPointerUp = (upEvent) => { if (upEvent.pointerId === pointerId) commit(); };
      const onPointerCancel = (cancelEvent) => { if (cancelEvent.pointerId === pointerId) cleanup(); };

      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);
      sourceCard.classList.add('is-dragging');
      try { handle.setPointerCapture?.(pointerId); } catch (e) { /* 문서 이벤트로 계속 처리 */ }
    };
    const variableCard = (item, fallbackTitle, list, index, body, issues, onDelete, summary) => {
      const collapsed = collapsedVariableCards.has(item);
      const newlyCreated = createdVariableCard === item;
      if (newlyCreated) createdVariableCard = null;
      const title = item.label?.trim() || fallbackTitle;
      const firstIssue = issues[0]?.msg;
      const moveFeedback = variableMoveFeedback?.item === item ? variableMoveFeedback : null;
      if (moveFeedback) variableMoveFeedback = null;
      const titleInput = bindInput(item.label, (x) => { item.label = x; rerender(); },
        { cls: 'sce-w-l', ph: fallbackTitle });
      const dragHandle = CARD_DRAG ? h('button', {
        class: 'sce-btn sce-mini sce-variable-drag-handle',
        title: `${title} 순서 끌어서 이동`,
        'aria-label': `${title} 순서 끌어서 이동`,
        onpointerdown: (event) => beginVariableDrag(item, list, event, dragHandle),
        onclick: (event) => event.preventDefault(),
      }, '⠿') : null;
      const card = h('section', {
        class: `sce-block sce-variable-card${collapsed ? ' is-collapsed' : ''}`
          + (moveFeedback ? ` is-just-moved moved-${moveFeedback.kind}` : '')
          + (newlyCreated ? ' is-newly-created' : ''),
      },
        h('div', { class: 'sce-variable-card-head' },
          h('div', { class: 'sce-variable-card-title' },
            dragHandle,
            h('span', { class: 'sce-variable-card-index' }, String(index + 1).padStart(2, '0')),
            collapsed
              ? h('span', { class: 'sce-variable-title-display' }, title)
              : h('label', { class: 'sce-variable-title-field' }, h('span', {}, '표시 이름'), titleInput),
            collapsed ? h('span', { class: 'sce-variable-card-summary' }, summary) : null,
            firstIssue ? h('span', { class: 'sce-card-issue-summary', title: firstIssue },
              `오류 ${issues.length}개 · ${firstIssue}`) : null),
          h('div', { class: 'sce-variable-card-actions' },
            moveFeedback ? h('span', { class: 'sce-variable-move-feedback', role: 'status', 'aria-live': 'polite' },
              `✓ ${moveFeedback.position}번째로 이동`) : null,
            h('button', {
              class: 'sce-btn sce-mini',
              'aria-expanded': String(!collapsed),
              title: collapsed ? `${title} 펼치기` : `${title} 접기`,
              onclick: () => {
                if (collapsed) collapsedVariableCards.delete(item);
                else collapsedVariableCards.add(item);
                rerender();
              },
            }, collapsed ? '펼치기' : '접기'),
            grip(list, index, rerender, onDelete, (movedItem, nextIndex, direction) => {
              variableMoveFeedback = {
                item: movedItem,
                position: nextIndex + 1,
                kind: direction < 0 ? 'up' : 'down',
              };
            }))),
        collapsed ? null : h('div', { class: 'sce-variable-card-body' }, body));
      if (moveFeedback) {
        setTimeout(() => {
          card.classList.remove('is-just-moved', `moved-${moveFeedback.kind}`);
          card.querySelector('.sce-variable-move-feedback')?.remove();
        }, 1500);
      }
      variableCardElements.set(item, card);
      if (newlyCreated) {
        requestAnimationFrame(() => {
          const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
          card.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
          try { titleInput.focus({ preventScroll: true }); } catch (_) { titleInput.focus(); }
        });
        setTimeout(() => card.classList.remove('is-newly-created'), 1500);
      }
      return card;
    };

    wrap.appendChild(h('section', { class: 'sce-vars-intro' },
      h('div', { class: 'sce-vars-intro-title' }, '게임이 기억하고 바꿀 값을 정해요'),
      h('div', { class: 'sce-vars-intro-copy' },
        '숫자·문장·선택지·목록에 따라 저장 방식이 달라져요. 먼저 기본 변수를 정한 뒤 규칙과 상태창에서 사용하면 됩니다.')));
    wrap.appendChild(h('section', { class: 'sce-vars-ai' },
      h('div', { class: 'sce-vars-ai-head' },
        h('div', { class: 'sce-vars-ai-title' }, 'AI로 변수 전체 만들기·교체'),
        h('div', { class: 'sce-vars-ai-summary' }, `${schema.vars.length}개 변수 · 선택 작업`)),
      tabAiTools('vars')));

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
    if (deletedVariableCard) {
      const deleted = deletedVariableCard;
      wrap.appendChild(h('div', { class: 'sce-vars-undo', role: 'status' },
        h('span', {}, `'${deleted.title}' 항목을 삭제했어요.`),
        h('button', { class: 'sce-btn sce-mini', onclick: () => {
          const list = schema[deleted.listKey];
          list.splice(Math.min(deleted.index, list.length), 0, deleted.item);
          deletedVariableCard = null;
          rerender();
        } }, '되돌리기')));
    }
    const addVariable = () => {
      const item = { id: nextEditorId('var'), label: '', type: 'int', init: 0 };
      schema.vars.push(item);
      createdVariableCard = item;
      rerender();
    };
    wrap.appendChild(h('div', { class: 'sce-editor-section-head sce-variable-section-head' },
      h('div', {},
        h('div', { class: 'sce-editor-section-title' }, '기본 변수'),
        h('div', { class: 'sce-editor-section-copy' }, '시뮬레이션이 직접 저장하고 변경하는 값입니다.')),
      h('div', { class: 'sce-editor-section-actions' },
        h('span', { class: 'sce-tag' }, `${schema.vars.length}개`),
        ...bulkControls(schema.vars, '$.vars'),
        schema.vars.length ? h('button', { class: 'sce-btn sce-mini', onclick: addVariable }, '+ 변수 추가') : null)));
    // 에셋 전용 설치 (v0.64) — 변수 탭이 비어 있어도 되는 유일한 경우.
    // 안 알려주면 "쓰지도 않을 변수를 하나 만들어 두는" 우회를 하게 된다.
    const assetOnly = !schema.vars.length && (schema.assets?.packs?.length ?? 0) > 0;
    if (!schema.vars.length) wrap.appendChild(h('div', { class: 'sce-vars-empty' },
      h('strong', {}, assetOnly ? '변수 없이 에셋만 쓰는 봇이에요' : '아직 기본 변수가 없어요'),
      h('span', {}, assetOnly
        ? '이 봇은 이미지 태그만 씁니다. 변수는 비워 둬도 그대로 설치되니 억지로 만들 필요 없어요.'
        : '게임에서 기억할 값 하나를 먼저 만들어 주세요.'),
      h('button', { class: 'sce-btn', onclick: addVariable }, '변수 만들기')));

    const variableList = h('div', { class: 'sce-variable-list' });
    schema.vars.forEach((v, i) => {
      const path = `$.vars[${i}]`;
      const issues = itemErrors(path);
      const identity = h('div', { class: 'sce-variable-grid' },
        variableField('변수 ID', bindInput(v.id, (x) => { v.id = x.trim(); rerender(); },
          { cls: 'sce-w-l', ph: '영문 ID (예: gold)' }), { issues: fieldIssues(path, 'id') }),
        variableField('값 형식', bindSelect(v.type, VAR_TYPES, (x) => { changeVarType(v, x); rerender(); }),
          { issues: fieldIssues(path, 'type') }));
      const typeHelp = h('div', { class: 'sce-variable-type-help' }, ({
        int: '정수는 소수점 없는 숫자예요. 시작값과 범위를 정할 수 있어요.',
        float: '실수는 소수점이 필요한 숫자예요. 시작값과 범위를 정할 수 있어요.',
        text: '텍스트는 문장이나 짧은 상태를 저장해요.',
        bool: 'ON/OFF는 켜짐과 꺼짐 두 상태만 저장해요.',
        enum: `선택지는 미리 정한 값 중 하나만 저장해요. 현재 ${(v.enum || []).length}개예요.`,
        list: `목록은 여러 아이템 이름을 한 변수에 저장해요. 시작 아이템은 ${Array.isArray(v.init) ? v.init.length : 0}개예요.`,
      })[v.type] || '저장할 값의 형식을 선택해 주세요.');
      const detail = h('div', { class: `sce-variable-grid values is-${v.type}` });
      if (v.type === 'int' || v.type === 'float') {
        detail.append(
          variableField('시작값', bindInput(v.init, (x) => { v.init = num(x); rerender(); }, { cls: 'sce-w-l' }),
            { issues: fieldIssues(path, 'init') }),
          variableField('최소', bindInput(v.min, (x) => { v.min = numOrNull(x); rerender(); }, { cls: 'sce-w-l', ph: '제한 없음' }),
            { issues: fieldIssues(path, 'range') }),
          variableField('최대', bindInput(v.max, (x) => { v.max = numOrNull(x); rerender(); }, { cls: 'sce-w-l', ph: '제한 없음' }),
            { issues: fieldIssues(path, 'range') }),
          variableField('상태창 표시 형식', bindInput(v.format, (x) => { v.format = x || undefined; rerender(); },
            { cls: 'sce-w-l', ph: '{v}G → 1,000G' }),
            { title: '{v} 자리에 값이 들어가요. 비우면 숫자만 표시합니다.' }),
        );
      } else if (v.type === 'text') {
        detail.append(
          variableField('시작값', bindInput(v.init, (x) => { v.init = x; rerender(); }, { cls: 'sce-w-l' }),
            { issues: fieldIssues(path, 'init') }),
          variableField('최대 글자 수', bindInput(v.maxLength, (x) => { v.maxLength = numOrNull(x) ?? undefined; rerender(); },
            { cls: 'sce-w-l', ph: '200' }), { issues: fieldIssues(path, 'maxLength') }),
        );
      } else if (v.type === 'bool') {
        const boolControl = h('div', { class: 'sce-variable-bool', role: 'group', 'aria-label': '시작 상태' },
          h('button', { class: `sce-mode-btn${v.init === false ? ' on' : ''}`, 'aria-pressed': String(v.init === false),
            onclick: () => { v.init = false; rerender(); } }, '꺼짐'),
          h('button', { class: `sce-mode-btn${v.init === true ? ' on' : ''}`, 'aria-pressed': String(v.init === true),
            onclick: () => { v.init = true; rerender(); } }, '켜짐'));
        detail.append(variableField('시작 상태', boolControl, { issues: fieldIssues(path, 'init') }));
      } else if (v.type === 'enum') {
        const enumOptions = (v.enum || []).map((value) => [value, value]);
        const startSelect = bindSelect(v.init, enumOptions.length ? enumOptions : [['', '선택지를 먼저 입력해 주세요']],
          (x) => { v.init = x; rerender(); });
        if (!enumOptions.length) startSelect.disabled = true;
        detail.append(
          variableField('선택지 · 한 줄에 하나', bindArea(itemLines(v.enum), (x) => {
            v.enum = parseItemLines(x);
            if (!v.enum.includes(v.init)) v.init = v.enum[0];
            rerender();
          }, '봄\n여름\n가을\n겨울'), { issues: fieldIssues(path, 'enum') }),
          variableField('시작값', startSelect, { issues: fieldIssues(path, 'init') }),
        );
      } else if (v.type === 'list') {
        detail.append(
          variableField('시작 아이템 · 한 줄에 하나', bindArea(itemLines(v.init),
            (x) => { v.init = parseItemLines(x); rerender(); }, '빵\n물통\n워싱턴, D.C.'),
          { issues: fieldIssues(path, 'init') }),
          variableField('최대 개수', bindInput(v.maxItems, (x) => { v.maxItems = numOrNull(x) ?? undefined; rerender(); },
            { cls: 'sce-w-l', ph: '20' }), { issues: fieldIssues(path, 'maxItems') }),
          variableField('아이템 글자 수', bindInput(v.itemMaxLength, (x) => { v.itemMaxLength = numOrNull(x) ?? undefined; rerender(); },
            { cls: 'sce-w-l', ph: '40' }), { issues: fieldIssues(path, 'itemMaxLength') }),
        );
      }
      const description = variableField('AI용 설명', bindInput(v.desc, (x) => { v.desc = x || undefined; rerender(); },
        { cls: 'sce-w-l', ph: '(선택) 이 값의 의미와 언제 바뀌는지 적어 주세요.' }),
        { title: 'AI가 이 변수를 언제 어떻게 갱신해야 하는지 알려주는 설명입니다.', wide: true });
      let preview = null;
      if (v.type === 'int' || v.type === 'float') {
        const n = Number(v.init ?? 0);
        const shown = Number.isFinite(n) ? n.toLocaleString('ko-KR') : String(v.init ?? 0);
        const formatted = v.format ? String(v.format).replace(/\{v\}/g, shown) : shown;
        preview = h('div', { class: 'sce-variable-preview' }, '상태창 미리보기: ', h('strong', {}, formatted));
      }
      variableList.appendChild(variableCard(v, `변수 ${i + 1}`, schema.vars, i,
        [identity, referenceNote(v), typeHelp, detail, preview, h('div', { class: 'sce-variable-description' }, description)], issues, () => {
          if (!v.id) return deleteWithUndo('vars', i, `변수 ${i + 1}`);
          const plan = planVarPurge(schema, [v.id]);
          if (!plan.notes.length && !plan.errors.length) return deleteWithUndo('vars', i, `변수 ${i + 1}`);
          purge = { id: v.id, label: v.label ?? v.id, plan };
          rerender();
          return false;
        }, variableSummary(v)));
    });
    wrap.appendChild(variableList);

    const addDerived = () => {
      const item = { id: nextEditorId('calc'), expr: '0' };
      schema.derived.push(item);
      createdVariableCard = item;
      rerender();
    };
    wrap.appendChild(h('div', { class: 'sce-editor-section-head sce-variable-section-head' },
      h('div', {},
        h('div', { class: 'sce-editor-section-title' }, '파생 변수'),
        h('div', { class: 'sce-editor-section-copy' },
          '기본 변수로 자동 계산되는 읽기 전용 값입니다. AI와 규칙은 직접 바꿀 수 없어요.')),
      h('div', { class: 'sce-editor-section-actions' },
        h('span', { class: 'sce-tag' }, `${schema.derived.length}개`),
        ...bulkControls(schema.derived, '$.derived'),
        schema.derived.length ? h('button', { class: 'sce-btn sce-mini', onclick: addDerived }, '+ 파생 변수 추가') : null)));
    if (!schema.derived.length) wrap.appendChild(h('div', { class: 'sce-vars-empty' },
      h('strong', {}, '아직 파생 변수가 없어요'),
      h('span', {}, '기본 변수의 값을 계산해서 보여줄 항목이 필요할 때 추가하면 됩니다.'),
      h('button', { class: 'sce-btn', onclick: addDerived }, '파생 변수 만들기')));
    const derivedList = h('div', { class: 'sce-variable-list' });
    schema.derived.forEach((d, i) => {
      const path = `$.derived[${i}]`;
      const issues = itemErrors(path);
      derivedList.appendChild(variableCard(d, `파생 변수 ${i + 1}`, schema.derived, i,
        [h('div', { class: 'sce-derived-grid' },
          variableField('변수 ID', bindInput(d.id, (x) => { d.id = x.trim(); rerender(); },
            { cls: 'sce-w-l', ph: '영문 ID' }), { issues: fieldIssues(path, 'id') }),
          variableField('계산식', bindInput(d.expr, (x) => { d.expr = x; rerender(); },
            { cls: 'sce-w-l', ph: 'round(population * 0.3) - military * 2' }),
            { issues: fieldIssues(path, 'expr', 'card') })), referenceNote(d)], issues,
        () => deleteWithUndo('derived', i, `파생 변수 ${i + 1}`), variableSummary(d, true)));
    });
    wrap.appendChild(derivedList);
    return wrap;
  }

  // ── 탭: 상태창 ────────────────────────────────────────────
  // 뼈대 덮어쓰기 확인용 — rerender()가 DOM을 새로 만들므로 tabStatus 밖에 둬야 살아남는다
  let tplArm = null;
  const collapsedStatusGroups = new WeakSet();
  let statusMoveFeedback = null; // { item, position, kind } — 그룹과 항목 이동 뒤 한 번 표시
  function tabStatus() {
    const ui = schema.statusUI;
    const wrap = h('div', { class: 'sce-status-editor' });
    const allIds = [...schema.vars.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`]),
                    ...schema.derived.map((d) => [d.id, `${d.label ?? d.id} (${d.id}, 자동)`]),
                    // 시간 노출 파생 — 시간 체계가 켜져 있으면 날짜·시각도 상태창 항목이 된다
                    ...(timeConfig(schema)?.expose ?? []).map((n) => [n, `${EXPOSED_LABELS[n]} (${n}, 시간)`])];
    const statusField = (label, control, hint = '') => h('div', { class: 'sce-status-field' },
      h('span', {}, label), control, hint ? h('small', {}, hint) : null);
    const statusDragElements = new Map();
    const beginStatusDrag = (item, list, event, handle) => {
      if (event.button !== 0) return;
      const source = statusDragElements.get(item);
      if (!source) return;
      event.preventDefault();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      let ghost = null;
      let targetItem = null;
      let afterTarget = false;
      const clearTargets = () => {
        for (const element of statusDragElements.values()) {
          element.classList.remove('is-drag-before', 'is-drag-after');
        }
      };
      const cleanup = () => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerCancel);
        try { handle.releasePointerCapture?.(pointerId); } catch (_) { /* 이미 해제된 환경 */ }
        ghost?.remove();
        source.classList.remove('is-dragging');
        clearTargets();
      };
      const commit = () => {
        cleanup();
        if (!moved || !targetItem || targetItem === item) return;
        const originalIndex = list.indexOf(item);
        const withoutItem = list.filter((candidate) => candidate !== item);
        let nextIndex = withoutItem.indexOf(targetItem);
        if (originalIndex < 0 || nextIndex < 0) return;
        if (afterTarget) nextIndex += 1;
        if (nextIndex === originalIndex) return;
        withoutItem.splice(nextIndex, 0, item);
        list.splice(0, list.length, ...withoutItem);
        statusMoveFeedback = { item, position: nextIndex + 1, kind: 'drag' };
        rerender();
      };
      const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 8) return;
        if (!moved) {
          moved = true;
          ghost = source.cloneNode(true);
          ghost.className = 'sce-status-drag-ghost';
          ghost.setAttribute('aria-hidden', 'true');
          ghost.setAttribute('inert', '');
          const width = source.getBoundingClientRect().width;
          if (width > 0) ghost.style.width = `${width}px`;
          ghost.appendChild(h('span', { class: 'sce-status-drag-ghost-badge' }, '이동 중'));
          root.appendChild(ghost);
        }
        ghost.style.left = `${moveEvent.clientX + 14}px`;
        ghost.style.top = `${moveEvent.clientY + 14}px`;
        const candidates = [...statusDragElements.entries()]
          .filter(([candidate]) => candidate !== item && list.includes(candidate))
          .map(([candidate, element]) => ({ candidate, element, bounds: element.getBoundingClientRect() }))
          .sort((a, b) => a.bounds.top - b.bounds.top);
        if (!candidates.length) return;
        const target = candidates.find(({ bounds }) => moveEvent.clientY < bounds.top + bounds.height / 2)
          || candidates[candidates.length - 1];
        clearTargets();
        targetItem = target.candidate;
        afterTarget = moveEvent.clientY > target.bounds.top + target.bounds.height / 2;
        target.element.classList.add(afterTarget ? 'is-drag-after' : 'is-drag-before');
        if (moveEvent.clientY < 48) window.scrollBy(0, -20);
        else if (moveEvent.clientY > window.innerHeight - 48) window.scrollBy(0, 20);
      };
      const onPointerUp = (upEvent) => { if (upEvent.pointerId === pointerId) commit(); };
      const onPointerCancel = (cancelEvent) => { if (cancelEvent.pointerId === pointerId) cleanup(); };
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);
      source.classList.add('is-dragging');
      try { handle.setPointerCapture?.(pointerId); } catch (_) { /* 문서 이벤트로 계속 처리 */ }
    };
    const statusDragHandle = (item, list, label) => {
      if (!CARD_DRAG) return null;
      const handle = h('button', {
        class: 'sce-btn sce-mini sce-status-drag-handle',
        title: `${label} 순서 끌어서 이동`,
        'aria-label': `${label} 순서 끌어서 이동`,
        onpointerdown: (event) => beginStatusDrag(item, list, event, handle),
        onclick: (event) => event.preventDefault(),
      }, '⠿');
      return handle;
    };
    const finishStatusMoveFeedback = (element, feedback) => {
      if (!feedback) return;
      setTimeout(() => {
        element.classList.remove('is-just-moved', `moved-${feedback.kind}`);
        element.querySelector('.sce-status-move-feedback')?.remove();
      }, 1500);
    };
    wrap.appendChild(h('section', { class: 'sce-status-intro' },
      h('div', { class: 'sce-status-intro-title' }, '플레이어에게 보여줄 상태를 정리해요'),
      h('div', { class: 'sce-status-intro-copy' },
        '저장된 값 중 필요한 것만 그룹으로 묶습니다. 여기서 순서와 표시 방식을 바꿔도 변수나 규칙의 값은 바뀌지 않아요.')));
    const settings = h('section', { class: 'sce-status-settings' });
    settings.appendChild(h('div', { class: 'sce-status-settings-grid' },
      // 제목은 여기가 유일한 입력칸 — meta는 패치·탭별 내보내기 어느 쪽도 안 다루는 영역이라
      // 이 칸이 없으면 JSON 직접 수정이 강제된다 (실전 제보로 발견된 구멍, v0.44.3)
      statusField('상태창 제목', bindInput(schema.meta?.name, (x) => {
        schema.meta = schema.meta || {};
        schema.meta.name = x.trim() || undefined; rerender();
      }, { cls: 'sce-w-m', ph: '비우면 상태' })),
      statusField('구성 방식', bindSelect(ui.mode ?? 'auto', [
        ['auto', '자동 구성 (그룹/항목)'], ['template', '커스텀 HTML 템플릿 (고급)'],
      ], (x) => { ui.mode = x; if (x === 'template' && !ui.template) ui.template = ''; rerender(); })),
      statusField('기본 테마', bindSelect(ui.theme ?? 'clean', Object.keys(THEMES).map((t) => [t, t]),
        (x) => { ui.theme = x; rerender(); })),
      statusField('메시지 표시', bindCheck(ui.collapsible !== false,
        (x) => { ui.collapsible = x; rerender(); }, '상태창 접기 허용')),
      // 변화 로그 (v0.72) — 엔진이 실제로 커밋한 변화의 영수증. 서사가 뭘 바꿨는지
      // 매 턴 눈으로 확인하고 싶으면 펼침으로 (수동 보정 판단에도 도움이 된다)
      statusField('변화 로그', bindSelect(ui.changeLog ?? 'collapsed', [
        ['collapsed', '접힘 (기본) — 눌러야 보임'], ['open', '펼침 — 영수증처럼 항상 표시'], ['off', '숨김'],
      ], (x) => { ui.changeLog = x === 'collapsed' ? undefined : x; rerender(); }),
      '이번 턴에 실제 반영된 변수 변화와 사유를 상태창 아래에 보여줘요.'),
    ));
    if ((ui.mode ?? 'auto') !== 'template') {
      settings.appendChild(h('div', { class: 'sce-status-layout' },
        statusField('여러 그룹 배치', bindSelect(ui.layout ?? 'stack', [
          ['stack', '쌓기 (기본)'], ['tabs', '탭 — 한 번에 한 장'],
          ['accordion', '접기/펼치기 — 여러 장 동시에'], ['popover', '버튼 팝업 — 눌러야 뜸'],
        ], (x) => { ui.layout = x === 'stack' ? undefined : x; rerender(); })),
      ));
      if (['tabs', 'popover'].includes(ui.layout)) {
        settings.appendChild(h('div', { class: 'sce-status-note' },
          '탭·팝업 선택은 새 상태 메시지가 만들어지면 첫 그룹으로 돌아가요.'));
      }
    }
    wrap.appendChild(settings);

    if (ui.mode === 'template') {
      const templateBox = h('section', { class: 'sce-status-template' });
      templateBox.appendChild(h('div', { class: 'sce-hint' },
        'AI가 만들어준 결과물을 <style> 포함 통째로 이 칸에 붙여넣어도 됨 — CSS는 자동 분리·스코핑됨. ' +
        'HTML 안에 {변수id}가 실제 값으로 치환되고, 목록은 {변수id:tags}로 칩 렌더. ' +
        '팝업(체크박스 토글) 구조 가능. 팁: 팝업형이면 "접을 수 있게" 끄기.'));
      templateBox.appendChild(bindArea(ui.template, (x) => { ui.template = x; rerender(); },
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
      templateBox.appendChild(h('div', { class: 'sce-hint' },
        '여러 패널로 나누고 싶으면 아래에서 뼈대를 뽑아 쓰세요 — 이 봇의 그룹·변수가 이미 채워져 나옵니다. '
        + '탭은 {uid}(이 상태창이 그려진 메시지 번호)를 라디오 id·name에 씁니다. '
        + '빼면 메시지끼리 탭이 엉켜서 최신 글의 탭을 눌렀는데 맨 위 글이 바뀝니다. '
        + '그냥 쓰기만 할 거면 표시 방식을 "자동 구성"으로 두고 [그룹 배치]에서 고르는 쪽이 간단합니다.'));
      templateBox.appendChild(h('div', { class: 'sce-row' },
        tplBtn('tabs', '탭 뼈대 넣기'),
        tplBtn('accordion', '접기/펼치기 뼈대'),
        tplBtn('popover', '버튼 팝업 뼈대'),
      ));

      // ── 조건부 템플릿: 한 봇에 두 가지 플레이가 있을 때 상태창을 통째로 갈아끼운다 ──
      ui.templates = ui.templates || [];
      templateBox.appendChild(h('h4', {}, '조건부 템플릿 (한 봇에 여러 판이 있을 때)'));
      templateBox.appendChild(h('div', { class: 'sce-hint' },
        '조건이 참인 첫 번째 것만 그려진다. 예: 영지 운영이면 A, 왕궁 시종이면 B. '
        + '각 템플릿의 <style>은 자기 id 껍데기(.sim-tpl-<id>) 안으로 자동 격리되므로, '
        + '두 템플릿이 똑같은 클래스명을 써도 서로를 덮어쓰지 않는다. '
        + '위 칸(조건 없는 기본 템플릿)은 어느 조건도 안 맞을 때의 보험으로 남겨두면 좋다.'));
      ui.templates.forEach((t, i) => {
        templateBox.appendChild(h('div', { class: 'sce-block' },
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
      templateBox.appendChild(addBtn('조건부 템플릿 추가', () => {
        ui.templates.push({ id: 'tpl' + (ui.templates.length + 1), when: '', template: '' });
        rerender();
      }));
      wrap.appendChild(templateBox);
    } else {

    const groupsHead = h('div', { class: 'sce-status-section-head' },
      h('div', {},
        h('h4', {}, '표시 그룹'),
        h('p', {}, '관련된 값을 묶고, 플레이어가 읽을 순서대로 정리해요.')),
      h('div', { class: 'sce-status-section-actions' },
        h('span', { class: 'sce-status-count' }, `${ui.groups.length}개`),
        h('button', { class: 'sce-btn sce-mini', onclick: () => {
          ui.groups.forEach((group) => collapsedStatusGroups.add(group)); rerender();
        } }, '모두 접기'),
        h('button', { class: 'sce-btn sce-mini', onclick: () => {
          ui.groups.forEach((group) => collapsedStatusGroups.delete(group)); rerender();
        } }, '모두 펼치기'),
        h('button', { class: 'sce-btn sce-mini', onclick: () => {
          ui.groups.push({ label: '', items: [] }); rerender();
        } }, '+ 그룹 추가')));
    wrap.appendChild(groupsHead);
    const groupsList = h('div', { class: 'sce-status-groups' });
    ui.groups.forEach((g, gi) => {
      g.items = g.items || [];
      const collapsed = collapsedStatusGroups.has(g);
      const groupMoveFeedback = statusMoveFeedback?.item === g ? statusMoveFeedback : null;
      if (groupMoveFeedback) statusMoveFeedback = null;
      const visibilityLabel = g.visibility === 'hidden' ? '숨김' : g.visibility === 'collapsed' ? '기본 접힘' : '보임';
      const groupLabel = g.label || '이름 없는 그룹';
      const groupDragHandle = statusDragHandle(g, ui.groups, groupLabel);
      const block = h('section', { class: `sce-status-group sce-status-draggable${collapsed ? ' is-collapsed' : ''}`
        + (groupMoveFeedback ? ` is-just-moved moved-${groupMoveFeedback.kind}` : '') });
      const body = h('div', { class: 'sce-status-group-body' });
      const toggle = h('button', { class: 'sce-btn sce-mini', onclick: () => {
        if (collapsedStatusGroups.has(g)) collapsedStatusGroups.delete(g);
        else collapsedStatusGroups.add(g);
        rerender();
      } }, collapsed ? '펼치기' : '접기');
      block.appendChild(h('div', { class: 'sce-status-group-head' },
        h('div', { class: 'sce-status-group-identity' }, groupDragHandle,
          h('div', { class: 'sce-status-group-title' },
            h('strong', {}, `${String(gi + 1).padStart(2, '0')}  ${groupLabel}`),
            h('span', {}, `항목 ${g.items.length}개 · ${visibilityLabel}${g.showWhen ? ' · 조건부 표시' : ''}`))),
        h('div', { class: 'sce-status-group-actions' },
          groupMoveFeedback ? h('span', { class: 'sce-status-move-feedback', role: 'status', 'aria-live': 'polite' },
            `✓ ${groupMoveFeedback.position}번째로 이동`) : null,
          toggle, grip(ui.groups, gi, rerender, null, (movedItem, nextIndex, direction) => {
            statusMoveFeedback = {
              item: movedItem,
              position: nextIndex + 1,
              kind: direction < 0 ? 'up' : 'down',
            };
          }))));
      if (!collapsed) {
        body.appendChild(h('div', { class: 'sce-status-group-settings' },
          statusField('그룹 이름', bindInput(g.label, (x) => { g.label = x; rerender(); },
            { cls: 'sce-w-m', ph: '예: 기온, 비축' })),
          statusField('처음 보이는 상태', bindSelect(g.visibility ?? 'show', [
            ['show', '보임'], ['collapsed', '접힌 상태'], ['hidden', '숨김 (내부 관리)'],
          ], (x) => { g.visibility = x === 'show' ? undefined : x; rerender(); })),
          statusField('그룹 표시 조건', bindInput(g.showWhen, (x) => { g.showWhen = x || undefined; rerender(); },
            { cls: 'sce-w-m', ph: '비우면 항상 표시' })),
        ));
        if (ui.groups.length >= 2) {
          body.appendChild(h('div', { class: 'sce-status-layout' },
            statusField('다른 그룹에 합치기', bindSelect('', [['', '대상 그룹 선택…'],
              ...ui.groups.map((g2, i2) => [String(i2), `${i2 + 1}. ${g2.label || '이름 없음'}`])
                .filter(([i2]) => i2 !== '' && Number(i2) !== gi)],
              (x) => {
                if (x === '') return;
                const target = ui.groups[Number(x)];
                target.items = (target.items || []).concat(g.items || []);
                ui.groups.splice(gi, 1);
                rerender();
              }))));
        }
        const items = h('div', { class: 'sce-status-items' });
        if (g.items.length) {
          items.appendChild(h('div', { class: 'sce-status-item-head' },
            h('span', {}, '표시할 값'), h('span', {}, '게이지'), h('span', {}, '표시 조건'),
            h('span', {}, '게이지 최대값'), h('span', {}, '순서')));
        } else {
          items.appendChild(h('div', { class: 'sce-status-empty' },
            '아직 표시할 값이 없어요. 아래에서 항목을 추가하세요.'));
        }
        g.items.forEach((it, ii) => {
          const itemMoveFeedback = statusMoveFeedback?.item === it ? statusMoveFeedback : null;
          if (itemMoveFeedback) statusMoveFeedback = null;
          const itemLabel = allIds.find(([id]) => id === it.var)?.[1] || it.var || '상태창 항목';
          const itemDragHandle = statusDragHandle(it, g.items, itemLabel);
          const row = h('div', { class: 'sce-status-item sce-status-draggable'
            + (itemMoveFeedback ? ` is-just-moved moved-${itemMoveFeedback.kind}` : '') },
            h('div', { class: 'sce-status-value-control' }, itemDragHandle,
              bindSelect(it.var, allIds.length ? allIds : [['', '(변수 없음)']],
                (x) => { it.var = x; rerender(); })),
            bindCheck(!!it.bar, (x) => {
              if (x) it.bar = it.bar || { max: 100 }; else delete it.bar;
              rerender();
            }, '사용'),
            bindInput(it.showWhen, (x) => { it.showWhen = x || undefined; rerender(); },
              { cls: 'sce-w-m', ph: '항상 표시' }),
            it.bar
              ? bindInput(it.bar.max, (x) => {
                it.bar.max = x;
                // % 기준 위험 전환 색은 최대값을 수식에 품고 있으므로 같이 재생성
                const spec = parseColorSpec(it.color, it.var);
                if (spec.mode === 'threshold' && spec.kind === 'pct') {
                  it.color = buildColorSpec(spec, it.var, x);
                }
                rerender();
              }, { cls: 'sce-w-m', ph: '100 또는 max_hp' })
              : h('div', { class: 'sce-status-item-max is-disabled' }, '사용 안 함'),
            h('span', { class: 'sce-status-item-actions' },
              itemMoveFeedback ? h('span', { class: 'sce-status-move-feedback', role: 'status', 'aria-live': 'polite' },
                `✓ ${itemMoveFeedback.position}번째로 이동`) : null,
              grip(g.items, ii, rerender, null, (movedItem, nextIndex, direction) => {
                statusMoveFeedback = {
                  item: movedItem,
                  position: nextIndex + 1,
                  kind: direction < 0 ? 'up' : 'down',
                };
              })),
          );
          statusDragElements.set(it, row);
          finishStatusMoveFeedback(row, itemMoveFeedback);
          items.appendChild(row);
          if (it.bar) items.appendChild(h('div', { class: 'sce-status-item-color' },
            colorBuilder(it, it.var, rerender)));
        });
        items.appendChild(h('button', { class: 'sce-btn sce-add sce-status-add-item', onclick: () => {
          g.items.push({ var: schema.vars[0]?.id ?? '' }); rerender();
        } }, '+ 항목 추가'));
        body.appendChild(items);
        block.appendChild(body);
      }
      statusDragElements.set(g, block);
      finishStatusMoveFeedback(block, groupMoveFeedback);
      groupsList.appendChild(block);
    });
    if (!ui.groups.length) groupsList.appendChild(h('div', { class: 'sce-status-empty' },
      '아직 그룹이 없어요. 위의 [그룹 추가]로 상태창 구성을 시작하세요.'));
    wrap.appendChild(groupsList);
    // 날짜 자리 = 시간 탭으로만 통하는 문 (design-시간.md §결정 1) — day 같은 int 변수를
    // 손으로 만들어 꽂는 길이 열려 있는 한 사람도 AI도 그리로 샌다 (실측 사고 5건 전부 그 길).
    if (!schema.time) {
      wrap.appendChild(h('div', { class: 'sce-status-note sce-status-timegate' },
        h('span', {},
          '📅 날짜·시각을 표시하고 싶다면 날짜 변수를 직접 만들지 마세요 — 매 턴 어긋납니다. '
          + '시간 체계를 켜면 date·clock이 위 항목 목록에 자동으로 생겨요.'),
        h('button', { class: 'sce-btn', onclick: () => { activeTab = 'time'; rerender(); } },
          '🕐 시간 탭으로')));
    }

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
    const statusTools = h('div', { class: 'sce-status-tools' }, autoBtn);

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
      statusTools.appendChild(h('button', { class: 'sce-btn sce-add', onclick: () => {
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
      statusTools.appendChild(h('div', { class: 'sce-status-note' },
        '같은 접두사를 쓰는 변수들을 별도 그룹으로 묶어요.'));
    }
    wrap.appendChild(statusTools);
    // 🤖 구조 창구 — "무엇을 보여줄까". 아래 꾸미기 창구와 짝이다.
    // 템플릿 모드에서는 그룹이 그려지지 않으므로 자동 구성일 때만 띄운다 (만들어도 안 보이면 사고다).
    wrap.appendChild(tabAiTools('status'));
    } // end auto mode

    const design = h('details', { class: 'sce-status-design' },
      h('summary', {}, '상태창 꾸미기 (선택)'));
    const designBody = h('div', { class: 'sce-status-design-body' });
    designBody.appendChild(h('h4', {}, '디자인 레시피'));
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
    designBody.appendChild(recipeRow);

    // 🎨 꾸미기 창구 — "어떻게 보일까". 1층 👁 결과와 **같은 것**을 여기서도 띄운다
    // (요청 문구·되돌리기 슬롯까지 공유하므로 어느 쪽에서 눌러도 결과가 같다).
    wrap.appendChild(h('div', { class: 'sce-editor-section-head' }, h('div', {},
      h('div', { class: 'sce-editor-section-title' }, '🎨 꾸미기도 AI에게 맡기기'),
      h('div', { class: 'sce-editor-section-copy' },
        '구조 창구가 무엇을 보여줄지(그룹·항목)를 만든다면, 이쪽은 어떻게 보일지를 만들어요. '
        + '[스킨만]은 아래 커스텀 CSS 칸을 채우고, [배치까지]는 커스텀 HTML 템플릿을 통째로 짜 넣습니다. '
        + '배치까지 맡기면 표시 방식이 커스텀으로 바뀌어 그룹 목록 대신 그 템플릿이 그려져요.'))));
    wrap.appendChild(cssAiTools());

    designBody.appendChild(h('h4', {}, '커스텀 CSS'));
    designBody.appendChild(h('div', { class: 'sce-status-note' },
      '이 상태창 안에서만 적용돼요. 앱의 다른 화면에는 영향을 주지 않습니다.'));
    designBody.appendChild(bindArea(ui.customCSS, (x) => { ui.customCSS = x || undefined; rerender(); },
      '.sim-status { border-color: gold; }\n.sim-bar-fill { background: crimson; }'));
    design.appendChild(designBody);
    wrap.appendChild(design);

    // 미리보기 — 1층 결과 창구와 같은 렌더러 (uid만 다르게, 접기 상태가 서로를 건드리면 안 된다)
    wrap.appendChild(h('section', { class: 'sce-status-preview' },
      h('h4', {}, '미리보기'),
      h('div', { class: 'sce-status-note' }, '현재 시작값을 기준으로 보여요.'),
      statusPreviewEl('pv')));
    return wrap;
  }

  // ── 탭: 규칙·이벤트 ───────────────────────────────────────
  // ── 탭 하나만 떼어 AI에게 맡기는 도구 (내보내기 → 붙여넣기 → 되돌리기) ──
  let tabUndo = null; // { tabKey, label, before } — 통째로 갈아끼우므로 한 단계 되돌리기가 필수
  let tabAiMsg = null; // { tabKey, text } — rerender를 건너뛰고 살아남아야 하는 가져오기 결과 안내
  let tabWant = {};   // tabKey → 요구 문구. 요청서의 '내가 원하는 것'에 그대로 들어간다
  let tabGen = { busy: false, seq: 0, key: null }; // 탭별 직결 생성 (cssGen과 같은 취소 규약)
  // { tabKey, picked, lost, gained } — 사라지는 것이 있으면 여기 붙들어 두고 확인을 받는다.
  // 스키마는 아직 안 건드린 상태다 (취소 = 무변화).
  let tabPending = null;
  let featureWant = '';  // 🧩 카드에 덧붙이는 요구 (선택)
  let featureRun = null; // { id, icon, label, step, total, tab } — 여러 단계짜리 기능의 진행 위치

  // 검증 오류 경로 → 그 오류가 속한 탭. 변수를 갈아끼웠을 때 어디를 고쳐야 하는지 알려준다.
  const PATH_TABS = [
    [/^\$\.(rules|directives)\b/, '규칙·이벤트', true],
    [/^\$\.actions\b/, '액션', true],
    [/^\$\.party\b/, '편성표', false],
    [/^\$\.calendar\b/, '달력', false],
    // 상태창은 v0.62부터 슬라이스가 생겨 [내보내기]로 다시 만들 수 있다.
    // promptState(AI에게 가는 상태 요약)는 같은 슬라이스가 아니라 따로 안내한다.
    [/^\$\.statusUI\b/, '상태창', true],
    [/^\$\.promptState\b/, 'AI 설정', false],
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

  // 붙여넣기와 직결 생성이 **같은 문**으로 들어오게 한다 — 검사·경고·되돌리기를 한 곳에서만 관리한다.
  // from='ai'면 산문 응답도 정상 경로다 (요청서가 "이 탭 밖의 일이면 JSON 대신 알려달라"고 시킨다).
  function applyTabImport(tabKey, raw, from) {
    tabPending = null; // 새로 들어온 것이 앞선 계획을 대체한다
    const text = String(raw ?? '').trim();
    if (!text) { tabAiMsg = { tabKey, text: '붙여넣은 내용이 없습니다.', warn: true }; return false; }

    let frag = null, why = '';
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try { frag = JSON.parse(fenced ? fenced[1] : text); }
    catch (e) {
      why = e.message;
      // 앞뒤에 설명이 붙은 응답 — 보조 파서와 같은 관대한 추출기로 한 번 더 (v0.54.9와 같은 이유)
      try { frag = engine.extractJsonObject(text); } catch { frag = null; }
    }
    if (!frag) {
      const prose = text.replace(/```[\s\S]*?```/g, '').trim();
      tabAiMsg = { tabKey, warn: true, text: (from === 'ai' && prose && !text.includes('{'))
        ? 'AI가 JSON 대신 답을 보냈습니다 — ' + prose.slice(0, 400)
        : `JSON 파싱 실패 — ${why}` };
      return false;
    }

    let picked;
    try { picked = pickTabFragment(tabKey, frag, schema); }
    catch (e) { tabAiMsg = { tabKey, text: `가져오기 실패 — ${e.message}`, warn: true }; return false; }

    // 넣기 **전에** 사라지는 것을 보여주고 멈춘다. 아래 급감 경고는 이미 넣은 뒤에 뜨므로,
    // "작업하던 게 통 교체로 날아간다"를 실제로 막는 건 여기다. 손실이 없으면 그냥 통과한다.
    const plan = planTabImport(schema, tabKey, picked);
    if (plan.lost.length) {
      tabPending = { tabKey, picked, ...plan };
      return false;
    }
    return commitTabImport(tabKey, picked, plan);
  }

  function commitTabImport(tabKey, picked, plan) {
    const slice = TAB_SLICES[tabKey];
    const beforeCounts = tabItemCounts(schema, tabKey);
    tabUndo = { tabKey, label: slice.label, before: JSON.parse(JSON.stringify(schema)) };
    Object.assign(schema, JSON.parse(JSON.stringify(picked)));
    normalize();
    tabPending = null;
    const afterCounts = tabItemCounts(schema, tabKey);
    const counts = afterCounts.map(([p, n]) => `${p} ${n}개`).join(', ');
    let msg = `✓ 가져왔습니다${counts ? ` — ${counts}` : ''}.`;
    let warn = false;
    // 계획을 보고 눌렀다면 무엇을 지웠는지 결과에도 남긴다 (되돌리기 판단 재료)
    if (plan?.lost?.length) msg += ` ${plan.lost.length}개를 지웠습니다 (${plan.lost.slice(0, 6).join(', ')}${plan.lost.length > 6 ? ' 외' : ''}).`;

    // AI가 "고친 것만" 돌려주는 일이 잦다. 통째로 갈아끼우는 구조라 그러면 나머지가 조용히 날아간다.
    const lost = afterCounts
      .map(([p, n], i) => [p, beforeCounts[i]?.[1] ?? 0, n])
      .filter(([, was, now]) => was >= 4 && now < was * 0.6);
    if (lost.length) {
      warn = true;
      msg = `⚠ 가져왔지만 항목이 크게 줄었습니다 — `
        + lost.map(([p, was, now]) => `${p} ${was}개 → ${now}개`).join(', ')
        + '. AI가 고친 것만 돌려준 것 같습니다. 의도한 게 아니면 [↩ 되돌리기]를 누르고, '
        + 'AI에게 "손대지 않은 항목까지 전부 포함해 한 세트로 다시 달라"고 요청하세요.';
    } else if (tabKey === 'vars') {
      const b = breakageAfterVarImport();
      if (b.missing.length) {
        warn = true;
        msg += ` 다만 다른 탭이 쓰던 변수 ${b.missing.length}개가 사라졌습니다 (${b.missing.join(', ')}).`;
        if (b.aiReady.length) msg += ` ${b.aiReady.join('·')} 탭은 [내보내기]로 다시 만들면 됩니다.`;
        if (b.manual.length) msg += ` ${b.manual.join('·')} 탭은 직접 고쳐야 합니다.`;
      } else {
        msg += ' 이제 액션 탭과 규칙·이벤트 탭에서 내보내기를 하면 이 변수표가 함께 나갑니다.';
      }
    }
    tabAiMsg = { tabKey, text: msg, warn };
    return true;
  }

  // 탭 하나만 그 자리에서 생성 — 복사 왕복 없이. 규격서·변수 계약·개수 체크섬은 내보내기와 완전히 같다.
  async function runTabGenerate(tabKey) {
    if (!ai || !ai.generate || tabGen.busy) return;
    const mySeq = ++tabGen.seq;
    tabGen.busy = true; tabGen.key = tabKey; tabAiMsg = null; tabPending = null;
    rerender();
    let res = null;
    try { res = await ai.generate(buildTabExportPrompt(schema, tabKey, { want: tabWant[tabKey] })); }
    catch (e) { res = { error: '호출 예외: ' + e.message }; }
    if (tabGen.seq !== mySeq || destroyed) return;
    tabGen.busy = false;
    if (typeof res !== 'string' || !res.trim()) {
      tabAiMsg = { tabKey, warn: true, text: res && res.blocked
        ? '⚠ 이 환경은 LLM 직접 호출이 차단되어 있습니다 — 아래 [📤 규격 내보내기]로 복사해 웹 AI에 주세요.'
        : '⚠ 호출 실패 — ' + ((res && res.error) || '원인 불명') + ' · 생성 모델을 바꾸거나 [📤 규격 내보내기]를 쓰세요.' };
      rerender(); return;
    }
    applyTabImport(tabKey, res, 'ai');
    rerender();
  }

  // 가져오기 결과 한 덩어리 — 적용 전 계획 상자 + 안내 문구 + 되돌리기.
  // 탭별 도구와 🧩 기능 추가가 **같은 것**을 쓴다: 어디서 시작했든 같은 확인을 받는다.
  // 🧩 카드 한 장 = 그 기능에 필요한 절(들)을 순서대로 AI에게 시키는 일.
  // 카드가 하는 일은 tabWant를 채우고 그 탭의 직결 생성을 부르는 것뿐이다 —
  // 검사·계획 확인·되돌리기는 탭별 도구의 것을 그대로 탄다 (새 병합 코드 없음).
  async function runFeature(recipe, step) {
    const s = recipe.steps[step];
    if (!s || !ai || !ai.generate || tabGen.busy) return;
    featureRun = { id: recipe.id, icon: recipe.icon, label: recipe.label,
      step, total: recipe.steps.length, tab: s.tab };
    const extra = featureWant.trim();
    tabWant[s.tab] = s.want + (extra ? ` 그리고 이렇게 해 주세요: ${extra}` : '');
    await runTabGenerate(s.tab);
  }

  function featureBox() {
    const wrap = h('div', { class: 'sce-block' });
    wrap.appendChild(h('h4', {}, '🧩 기능 추가 — 굴러가는 봇에 서브시스템 하나 얹기'));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '고정된 조각을 밀어 넣는 게 아닙니다 — **이 봇의 변수를 보고** AI가 그 자리에 맞게 만듭니다. '
      + '만드는 절의 규격서와 변수 계약이 그대로 나가고, 넣기 전에 사라지는 것을 보여주는 확인도 똑같이 붙습니다.'));

    if (!ai || !ai.generate) {
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '이 환경은 플러그인에서 LLM을 직접 못 부릅니다 — 🧰 세부 편집기의 각 탭에서 '
        + '[📤 규격 내보내기]로 복사해 웹 AI에게 주세요. 나오는 요청서는 카드가 쓰는 것과 같습니다.'));
      return wrap;
    }

    wrap.appendChild(h('div', { class: 'sce-row' },
      bindInput(featureWant, (x) => { featureWant = x; },
        { cls: 'sce-w-l', ph: '(선택) 덧붙일 요구 — 예: 판타지 분위기로 / 인물 이름은 히로미로' })));

    for (const r of FEATURE_RECIPES) {
      let blocked = null;
      try { blocked = r.needs(schema); } catch { blocked = null; }
      const btn = h('button', { class: 'sce-btn sce-add', style: 'width:auto',
        onclick: () => { if (!blocked) runFeature(r, 0); } }, `${r.icon} ${r.label}`);
      if (blocked || tabGen.busy) { btn.disabled = true; btn.style.opacity = .45; }
      wrap.appendChild(h('div', { class: 'sce-row' }, btn,
        h('span', { class: 'sce-hint', style: 'margin:0' },
          blocked ? `⛔ ${blocked}`
            : r.desc + (r.steps.length > 1 ? ` · ${r.steps.length}단계` : ''))));
    }

    // 진행 중인 기능 — 단계 표시 + 결과(계획 확인·되돌리기) + 다음 단계
    if (featureRun) {
      const fr = featureRun;
      const r = FEATURE_RECIPES.find((x) => x.id === fr.id);
      const box = h('div', { class: 'sce-block' });
      box.appendChild(h('h4', {},
        `${fr.icon} ${fr.label} — ${fr.step + 1}/${fr.total}단계 · ${TAB_SLICES[fr.tab].label}`));
      if (tabGen.busy && tabGen.key === fr.tab) {
        box.appendChild(h('div', { class: 'sce-hint' }, '⏳ 만드는 중… (수십 초 걸릴 수 있음)'));
      }
      box.appendChild(tabResultEl(fr.tab));
      // 앞 단계가 들어간 뒤에야 다음으로 간다 — 확인 대기 중이면 다음 버튼을 안 띄운다
      const settled = !tabGen.busy && !tabPending && tabUndo && tabUndo.tabKey === fr.tab;
      if (settled && r && fr.step + 1 < fr.total) {
        const nx = r.steps[fr.step + 1];
        box.appendChild(h('div', { class: 'sce-row' },
          h('button', { class: 'sce-btn sce-add', style: 'width:auto',
            onclick: () => runFeature(r, fr.step + 1) },
          `▶ 다음 — ${fr.step + 2}/${fr.total} ${TAB_SLICES[nx.tab].label}`),
          h('span', { class: 'sce-hint', style: 'margin:0' },
            '앞 단계가 만든 것을 보고 다음 절을 만듭니다 — 한꺼번에 시키면 없는 이름을 지어냅니다.')));
      } else if (settled) {
        box.appendChild(h('div', { class: 'sce-hint' },
          `✅ ${fr.label} 완료. 🔬 진단으로 한 번 굴려 보세요 — 새로 생긴 수치가 상태창에 안 보이면 `
          + '🧰 세부 편집기의 [상태창] 탭에서 배치하면 됩니다.'));
      }
      box.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn sce-mini', onclick: () => { featureRun = null; rerender(); } }, '닫기')));
      wrap.appendChild(box);
    }
    return wrap;
  }

  function tabResultEl(tabKey) {
    const wrap = h('div');
    if (tabPending && tabPending.tabKey === tabKey) {
      const p = tabPending;
      const cut = (arr) => arr.slice(0, 12).join(', ') + (arr.length > 12 ? ` 외 ${arr.length - 12}개` : '');
      const box = h('div', { class: 'sce-block' });
      box.appendChild(h('div', { class: 'sce-warn' },
        `⚠ 적용하면 ${p.lost.length}개가 사라집니다 — ${cut(p.lost)}`));
      if (p.gained.length) {
        box.appendChild(h('div', { class: 'sce-hint' },
          `새로 생기는 것 ${p.gained.length}개 — ${cut(p.gained)}`));
      }
      box.appendChild(h('div', { class: 'sce-hint' },
        'AI가 **고친 것만** 돌려주면 나머지가 통째로 없어집니다. 의도한 삭제가 아니면 [취소]를 누르고 '
        + '"손대지 않은 항목까지 전부 포함해 한 세트로 다시 달라"고 요청하세요.'));
      box.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn sce-danger', onclick: () => {
          commitTabImport(tabKey, p.picked, p); rerender();
        } }, `그래도 적용 (${p.lost.length}개 삭제)`),
        h('button', { class: 'sce-btn', onclick: () => {
          tabPending = null;
          tabAiMsg = { tabKey, text: '취소했습니다 — 아무것도 바뀌지 않았습니다.', warn: false };
          rerender();
        } }, '취소')));
      wrap.appendChild(box);
    }
    if (tabAiMsg && tabAiMsg.tabKey === tabKey) {
      wrap.appendChild(h('div', { class: tabAiMsg.warn ? 'sce-warn' : 'sce-hint' }, tabAiMsg.text));
    }
    if (tabUndo && tabUndo.tabKey === tabKey) {
      wrap.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn sce-danger', onclick: () => {
          schema = tabUndo.before;
          tabUndo = null; tabPending = null;
          tabAiMsg = { tabKey, text: '↩ 가져오기 전으로 되돌렸습니다.', warn: false };
          rerender();
        } }, `↩ ${TAB_SLICES[tabKey].label} 가져오기 되돌리기`)));
    }
    return wrap;
  }

  function tabAiTools(tabKey) {
    const slice = TAB_SLICES[tabKey];
    const varsMode = tabKey === 'vars';
    const commandsMode = tabKey === 'commands';
    const compactMode = varsMode || commandsMode;
    const wrap = h('div', { class: `sce-block sce-tab-ai-tools${compactMode ? ' sce-tab-ai-vars sce-tab-ai-compact' : ''}` });
    if (!compactMode) wrap.appendChild(h('h4', {}, `🤖 ${slice.label}만 AI에게 맡기기`));

    // ① 직결 — 요구를 한 줄 쓰고 그 자리에서 받는다. 복사 왕복이 없으면 요구를 여러 번 고쳐 넣기 쉽다.
    // compact(변수·명령)는 내보내기|가져오기 2열 격자라, 이 블록만 두 열을 가로질러 맨 위에 눕힌다.
    const directBox = compactMode ? h('div', { class: 'sce-vars-ai-direct' }) : wrap;
    if (ai && ai.generate) {
      const genRow = h('div', { class: 'sce-row' },
        bindInput(tabWant[tabKey] ?? '', (x) => { tabWant[tabKey] = x; },
          { cls: 'sce-w-l', ph: TAB_WANT_PH[tabKey] ?? '원하는 것을 한 줄로' }));
      genRow.appendChild(tabGen.busy && tabGen.key === tabKey
        ? h('button', { class: 'sce-btn', onclick: () => { tabGen.seq++; tabGen.busy = false; rerender(); } }, '✋ 취소')
        : h('button', { class: 'sce-btn sce-add', style: 'width:auto',
            onclick: () => runTabGenerate(tabKey) }, `✨ ${slice.label} 만들어 달라기`));
      directBox.appendChild(genRow);
      directBox.appendChild(h('div', { class: 'sce-hint' },
        tabGen.busy && tabGen.key === tabKey
          ? '⏳ 생성 중이에요. 수십 초 걸릴 수 있어요.'
          : '창작 탭의 생성 모델이 이 탭 몫만 만들어 와요. 규격서와 이 봇에 이미 있는 변수 목록이 함께 나가서 '
            + '없는 이름을 지어내지 못합니다. 받은 결과는 검사를 거쳐 들어가고 [↩ 되돌리기]가 한 번 남아요.'));
    }

    directBox.appendChild(tabResultEl(tabKey));
    if (compactMode) wrap.appendChild(directBox);

    const exportBox = compactMode ? h('div', { class: 'sce-vars-ai-export' }) : wrap;
    copyWidget(`📤 ${slice.label} 규격 내보내기`,
      tabKey === 'vars'
        ? '변수는 액션·규칙·상태창이 함께 사용하는 기준이에요. 전체 구성을 새로 만들 때 먼저 확정해 두면 '
          + '다른 탭에서 정의되지 않은 변수를 사용하는 오류를 줄일 수 있어요.'
        : commandsMode
          ? '명령은 이미 만든 변수에 연결돼요. 전체 명령표를 새로 만들 때 변수 목록과 타입별 문법을 함께 넘깁니다.'
        : '이 탭 몫만 떼어내 AI에게 맡깁니다. **이미 정의된 변수 목록이 함께 나가서** 없는 변수를 지어내지 못하고, '
          + '패턴 예시가 붙어 있어 형태도 흐트러지지 않습니다.',
      () => buildTabExportPrompt(schema, tabKey),
    ).mount(exportBox);
    exportBox.appendChild(jumpRow(compactMode
      ? commandsMode
        ? '말로 설명해 명령 전체를 만들거나, 필요한 명령만 안전하게 고칠 수 있어요.'
        : '말로 설명해 새 작업본을 만들거나, 일부만 안전하게 고칠 수 있어요.'
      : '부분 수정이면 ✨ AI 어시스턴트(패치)가 더 안전합니다 — 통 교체는 AI가 하나만 빠뜨려도 그게 삭제라서, 전면 재작성일 때만 이 내보내기를 쓰세요.'));
    if (compactMode) wrap.appendChild(exportBox);

    // 결과 안내·되돌리기는 위 tabResultEl이 맡는다 — 여기는 붙여넣기 사용법만 남긴다
    const note = h('div', { class: 'sce-hint' },
      'AI가 준 JSON을 여기 붙여넣고 [가져오기]를 누르세요. 코드펜스(```)나 앞뒤 설명이 붙어 있어도 됩니다.');
    // 결과 문구(tabAiMsg)는 위 tabResultEl 한 곳에서만 띄운다 — 두 곳에 쓰면 같은 말이 겹친다
    const importKey = slice.merge ? 'commands' : (slice.sub ?? slice.keys[0]);
    const area = h('textarea', { class: compactMode ? 'sce-vars-ai-input' : '',
      style: compactMode ? '' : 'height:130px', placeholder: `{ "${importKey}": [ ... ] }` });
    const row = h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn', onclick: () => {
        applyTabImport(tabKey, area.value, 'paste');
        rerender(); // 아래 검증 리포트가 바로 갱신된다 — 오류가 있으면 [②]로 AI에게 돌려주면 된다
      } }, '📥 가져오기'),
    );
    // 되돌리기 버튼도 tabResultEl 한 곳이 맡는다 (여기 또 달면 버튼이 둘이 된다)
    if (compactMode) {
      wrap.appendChild(h('div', { class: 'sce-vars-ai-import' }, note, area, row));
    } else {
      wrap.appendChild(note);
      wrap.appendChild(area);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function tabRules() {
    const wrap = h('div');
    wrap.appendChild(tabAiTools('rules'));

    // 리롤 안정 난수 (v0.80에 칸이 생김 — 배선은 처음부터 있었다). 규칙 #3의 재발이었다:
    // 스키마 키만 있고 칸이 없어서, "리롤해도 랜덤이 똑같다"를 버그로 겪고도 끌 방법이 없었다.
    wrap.appendChild(h('h4', {}, '난수'));
    wrap.appendChild(h('div', { class: 'sce-row' },
      bindCheck(schema.rerollStableRng !== false,
        (on) => { schema.rerollStableRng = on ? undefined : false; rerender(); },
        '리롤 안정 (기본 켜짐)')));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      schema.rerollStableRng === false
        ? '**꺼짐** — 리롤할 때마다 랜덤 이벤트·판정이 새로 굴러갑니다. 마음에 안 드는 결과를 '
          + '다시 굴릴 수 있는 대신, 같은 지점에서 계속 굴려 원하는 결과를 뽑아낼 수도 있습니다.'
        : '**켜짐** — 같은 지점에서 리롤하면 랜덤 이벤트·판정이 같은 눈으로 나옵니다. 서사 표현만 '
          + '다시 뽑고 결과는 못 바꾸게 하는 설정이라, TRPG·생존물처럼 판정이 무거운 봇에 맞습니다. '
          + '"리롤해도 변수가 그대로다"가 불편하면 끄세요.'));

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
  const COMMAND_TYPE_LABELS = {
    int: '정수',
    float: '실수',
    text: '텍스트',
    bool: 'ON/OFF',
    enum: '선택지',
    list: '목록',
  };
  // 엔진 내부 헬퍼에 기대지 않고, 편집 화면에서 합산 목록 안내가 필요한지만 안전하게 확인한다.
  // 유효하지 않은 임시 id가 있어도 정규식 생성으로 편집기 전체가 멈추지 않아야 한다.
  function commandListIsSummed(id) {
    const escapedId = String(id ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escapedId) return false;
    let pattern;
    try { pattern = new RegExp(`sum\\s*\\(\\s*${escapedId}\\b`); }
    catch (_) { return false; }
    const rules = schema.rules || {};
    const expressions = [
      ...(schema.derived || []).map((d) => d?.expr),
      ...(rules.onTurn || []).flatMap((r) => [r?.expr, r?.expire]),
      ...(rules.events || []).flatMap((e) => [e?.when, ...(e?.effects || []).map((f) => f?.expr)]),
      ...(rules.randomEvents?.table || []).flatMap((e) => [e?.when, ...(e?.effects || []).map((f) => f?.expr)]),
      ...(schema.directives || []).map((d) => d?.when),
      ...(schema.actions || []).flatMap((a) => [a?.when, ...(a?.effects || []).map((f) => f?.expr)]),
    ];
    return expressions.some((expression) => typeof expression === 'string' && pattern.test(expression));
  }
  function commandEditorUsage(v, fallbackUsage) {
    const command = `/${v.cmd}`;
    if (v.type === 'int' || v.type === 'float') {
      const step = v.type === 'int' ? '5' : '0.5';
      const target = v.type === 'int' ? '30' : '21.5';
      const limits = [
        v.min != null ? `최소 ${v.min}` : '',
        v.max != null ? `최대 ${v.max}` : '',
      ].filter(Boolean).join(' · ');
      return {
        rows: [
          [`${command} +${step}`, `현재 값에 ${step}만큼 더해요`],
          [`${command} -${step}`, `현재 값에서 ${step}만큼 빼요`],
          [`${command} ${target}`, '현재 값을 입력한 숫자로 바꿔요'],
        ],
        note: `숫자 앞의 +와 -만 계산 기호로 사용할 수 있어요.${limits ? ` 값은 ${limits} 범위로 제한돼요.` : ''}`
          + (v.type === 'int' ? ' 정수의 계산 결과는 반올림해요.' : ''),
      };
    }
    if (v.type === 'list') {
      const sample = String(Array.isArray(v.init) && v.init[0] ? v.init[0] : '새 항목 +12');
      const removeSample = sample.split(/\s+/).find(Boolean) || '새 항목';
      return {
        rows: [
          [`${command} ${sample}`, '뒤의 내용을 새 항목으로 추가해요'],
          [`${command}- ${removeSample}`, '명령 이름 바로 뒤에 -를 붙여 일치하는 항목을 빼요'],
        ],
        note: '항목을 뺄 때는 목록에서 하나만 가려질 만큼의 일부 문구를 입력해도 돼요.'
          + (commandListIsSummed(v.id) ? ' 이 목록은 합산에 사용되므로 추가 항목을 숫자로 끝내세요.' : ''),
      };
    }
    if (v.type === 'enum') {
      const choices = (v.enum || []).slice(0, 3);
      return {
        rows: choices.length
          ? choices.map((choice) => [`${command} ${choice}`, `선택 값을 '${choice}'로 바꿔요`])
          : (fallbackUsage || []),
        note: '등록된 선택지 중 하나를 정확히 입력해야 해요.',
      };
    }
    if (v.type === 'bool') {
      return {
        rows: [
          [`${command} on`, '켜요'],
          [`${command} 0`, '꺼요'],
          [`${command} false`, '꺼요'],
        ],
        note: '영문은 소문자로 입력하세요. 끄려면 0 또는 false를 사용하세요.',
      };
    }
    if (v.type === 'text') {
      const sample = String(v.init || '새로운 상태');
      return {
        rows: [
          [`${command} ${sample}`, '현재 텍스트 전체를 입력한 내용으로 바꿔요'],
          [`${command} 이동 중`, '띄어쓰기가 포함된 문장도 그대로 저장해요'],
        ],
        note: '기존 문장 뒤에 덧붙이지 않고 입력한 내용으로 전체를 교체해요.',
      };
    }
    return { rows: fallbackUsage || [], note: '' };
  }
  function tabCommands() {
    const wrap = h('div');
    const withCmd = schema.vars.filter((v) => v.cmd);
    const free = schema.vars.filter((v) => !v.cmd);
    const validation = validateSchema(schema);
    let commandErrorSeq = 0;
    const specs = new Map(engine.commandSpecs(schema).map((s) => [s.id, s]));
    const commandIssues = (v) => {
      const index = schema.vars.indexOf(v);
      const path = `$.vars[${index}]`;
      return {
        errors: validation.errors.filter((e) =>
          (e.path === path || e.path.startsWith(path + '.')) && /cmd|명령 이름|중복/.test(e.msg || '')),
        warnings: validation.warnings.filter((e) =>
          (e.path === path || e.path.startsWith(path + '.')) && /cmd|명령|선택/.test(e.msg || '')),
      };
    };
    const issueCache = new Map(withCmd.map((v) => [v, commandIssues(v)]));
    const problemCommands = new Set(withCmd.filter((v) => {
      const issues = issueCache.get(v);
      return issues.errors.length || issues.warnings.length;
    }));

    wrap.appendChild(h('section', { class: 'sce-command-intro' },
      h('div', { class: 'sce-command-intro-title' }, '채팅에서 값을 바로 고치는 명령'),
      h('div', { class: 'sce-command-intro-copy' },
        '명령은 기존 변수에 짧은 이름을 붙여 만들어요. 입력 문법은 정수·선택지·목록 같은 변수 형식에 맞춰 자동으로 정해집니다.'),
    ));
    wrap.appendChild(h('section', { class: 'sce-vars-ai sce-command-ai' },
      h('div', { class: 'sce-vars-ai-head' },
        h('div', {},
          h('h4', {}, 'AI로 명령 전체 만들기·교체'),
          h('p', {}, '전면 재작성이나 여러 명령을 한꺼번에 정리할 때만 사용하세요.'),
        ),
        h('span', { class: 'sce-tag' }, `${withCmd.length}개 명령`),
      ),
      tabAiTools('commands'),
    ));

    if (deletedCommand) {
      const deleted = deletedCommand;
      wrap.appendChild(h('div', { class: 'sce-vars-undo', role: 'status' },
        h('span', {}, `/${deleted.cmd} 명령을 삭제했어요.`),
        h('button', { class: 'sce-btn sce-mini', onclick: () => {
          const variable = schema.vars.includes(deleted.variable)
            ? deleted.variable
            : (schema.vars[deleted.index]?.id === deleted.varId
              ? schema.vars[deleted.index]
              : schema.vars.find((v) => v.id === deleted.varId));
          if (variable) variable.cmd = deleted.cmd;
          deletedCommand = null;
          rerender();
        } }, '되돌리기'),
      ));
    }

    const workspace = h('div', { class: 'sce-command-workspace' });
    workspace.appendChild(h('div', { class: 'sce-editor-section-head' },
      h('div', {},
        h('h4', {}, '채팅 명령'),
        h('p', {}, '변수를 고르면 명령과 타입별 사용 예시가 함께 만들어져요. 상태창에서는 변수 탭의 순서대로 표시됩니다.'),
      ),
      h('div', { class: 'sce-editor-section-actions' },
        h('span', { class: 'sce-tag' }, `${withCmd.length}개`),
        h('button', { class: 'sce-btn sce-mini', disabled: !withCmd.some((v) => !collapsedCommandCards.has(v)) ? 'disabled' : undefined,
          onclick: () => {
          withCmd.forEach((v) => collapsedCommandCards.add(v));
          rerender();
        } }, '모두 접기'),
        h('button', {
          class: 'sce-btn sce-mini', disabled: !withCmd.some((v) => collapsedCommandCards.has(v)) ? 'disabled' : undefined,
          onclick: () => {
            withCmd.forEach((v) => collapsedCommandCards.delete(v));
            rerender();
          },
        }, '모두 펼치기'),
        h('button', {
          class: 'sce-btn sce-mini', disabled: !problemCommands.size ? 'disabled' : undefined,
          onclick: () => {
            withCmd.forEach((v) => {
              if (problemCommands.has(v)) collapsedCommandCards.delete(v);
              else collapsedCommandCards.add(v);
            });
            rerender();
          },
        }, `문제만 펼치기${problemCommands.size ? ` ${problemCommands.size}` : ''}`),
      ),
    ));

    if (!schema.vars.length) {
      workspace.appendChild(h('div', { class: 'sce-vars-empty' },
        h('strong', {}, '명령을 연결할 변수가 없어요'),
        h('span', {}, '명령은 기존 변수에 붙는 기능이에요. 변수 탭에서 먼저 변수를 만들어 주세요.'),
        h('button', { class: 'sce-btn', onclick: () => { activeTab = 'vars'; rerender(); } }, '변수 만들러 가기'),
      ));
    } else {
      const pick = h('select', { class: 'sce-w-l', disabled: free.length ? undefined : 'disabled' });
      pick.appendChild(h('option', { value: '' }, free.length ? '변수를 선택하세요' : '연결할 수 있는 변수가 없어요'));
      for (const v of [...free].sort((a, b) => (a.type === 'list' ? -1 : 0) - (b.type === 'list' ? -1 : 0))) {
        pick.appendChild(h('option', { value: String(schema.vars.indexOf(v)) },
          `${v.label ?? v.id} (${v.id} · ${COMMAND_TYPE_LABELS[v.type] || v.type})`));
      }
      const openButton = h('button', { class: 'sce-btn', disabled: 'disabled', onclick: () => {
        const index = Number(pick.value);
        const v = Number.isInteger(index) ? schema.vars[index] : null;
        if (!v || v.cmd) return;
        const base = String(v.label ?? v.id).trim().split(/\s+/)[0].replace(/[\/-]/g, '') || v.id;
        const taken = new Set(schema.vars.filter((x) => x.cmd).map((x) => x.cmd));
        let name = base, n = 2;
        while (taken.has(name)) name = base + (n++);
        v.cmd = name;
        createdCommandCard = v;
        rerender();
      } }, '명령 추가');
      pick.onchange = () => { openButton.disabled = !pick.value; };
      workspace.appendChild(h('div', { class: 'sce-command-create' },
        h('div', { class: 'sce-variable-field' },
          h('label', {}, free.length ? '명령을 연결할 변수' : '모든 변수에 명령이 연결되어 있어요'),
          pick,
        ),
        openButton,
      ));
    }
    if (!withCmd.length && schema.vars.length) {
      workspace.appendChild(h('div', { class: 'sce-vars-empty' },
        h('strong', {}, '아직 채팅 명령이 없어요'),
        h('span', {}, '위에서 변수를 선택하면 해당 형식에 맞는 명령과 사용 예시가 만들어져요.'),
      ));
    }
    wrap.appendChild(workspace);

    const commandList = h('div', { class: 'sce-command-list' });
    for (const v of withCmd) {
      const spec = specs.get(v.id);
      const usage = commandEditorUsage(v, spec?.usage);
      const issues = issueCache.get(v);
      const collapsed = collapsedCommandCards.has(v);
      const newlyCreated = createdCommandCard === v;
      if (newlyCreated) createdCommandCard = null;
      const input = bindInput(v.cmd, (x) => {
        const t = String(x).trim();
        if (t) v.cmd = t; else delete v.cmd;
        rerender();
      }, { cls: 'sce-w-l', ph: '명령 이름' });
      let errorId;
      if (issues.errors.length) {
        errorId = `sce-command-error-${++commandErrorSeq}`;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errorId);
      }
      const firstIssue = issues.errors[0]?.msg || issues.warnings[0]?.msg;
      const issueCount = issues.errors.length + issues.warnings.length;
      const card = h('section', {
        class: `sce-block sce-command-card${collapsed ? ' is-collapsed' : ''}${newlyCreated ? ' is-newly-created' : ''}`,
      },
        h('div', { class: 'sce-command-card-head' },
          h('div', { class: 'sce-command-card-title' },
            h('strong', {}, `/${v.cmd}`),
            h('span', {}, `${v.label ?? v.id} · ${v.id} · ${COMMAND_TYPE_LABELS[v.type] || v.type}`),
            firstIssue ? h('span', {
              class: `sce-command-issue-summary${!issues.errors.length ? ' is-warning' : ''}`,
              title: firstIssue,
            }, `${issues.errors.length ? '오류' : '경고'} ${issueCount}개 · ${firstIssue}`) : null,
          ),
          h('div', { class: 'sce-command-card-actions' },
            h('button', {
              class: 'sce-btn sce-mini',
              onclick: () => {
                if (collapsed) collapsedCommandCards.delete(v);
                else collapsedCommandCards.add(v);
                rerender();
              },
              'aria-expanded': String(!collapsed),
            }, collapsed ? '펼치기' : '접기'),
            h('button', { class: 'sce-btn sce-mini sce-danger', title: '명령 삭제', onclick: () => {
              deletedCommand = { variable: v, index: schema.vars.indexOf(v), varId: v.id, cmd: v.cmd };
              delete v.cmd;
              rerender();
            } }, '삭제'),
          ),
        ),
        collapsed ? null : h('div', { class: 'sce-command-card-body' },
          h('div', { class: 'sce-command-grid' },
            h('div', { class: 'sce-variable-field' },
              h('label', {}, '연결 변수'),
              h('div', { class: 'sce-command-readonly' }, `${v.label ?? v.id} · ${COMMAND_TYPE_LABELS[v.type] || v.type}`),
            ),
            h('div', { class: `sce-variable-field${issues.errors.length ? ' has-error' : ''}` },
              h('label', {}, '명령 이름'),
              h('div', { class: 'sce-command-name-control' },
                h('span', { class: 'sce-command-prefix' }, '/'),
                input,
              ),
              issues.errors.length ? h('div', { id: errorId, class: 'sce-field-error' },
                issues.errors.map((e) => e.msg).join(' · ')) : h('div', { class: 'sce-hint' },
                '공백, /, -는 사용할 수 없으며 다른 명령과 겹칠 수 없어요.'),
              ...issues.warnings.map((e) => h('div', { class: 'sce-warn' }, e.msg)),
            ),
          ),
          h('div', { class: 'sce-command-usage' },
            h('strong', {}, '사용 예시'),
            ...usage.rows.map(([syntax, why]) => h('div', { class: 'sce-command-usage-line' },
              h('code', {}, syntax),
              h('span', {}, why),
            )),
            usage.note ? h('div', { class: 'sce-command-usage-note' }, usage.note) : null,
          ),
        ),
      );
      commandList.appendChild(card);
      if (newlyCreated) {
        requestAnimationFrame(() => {
          const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
          card.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
          try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
        });
        setTimeout(() => card.classList.remove('is-newly-created'), 1500);
      }
    }
    wrap.appendChild(commandList);

    // 유저가 이걸 볼 자리. 이 안내가 없으면 명령을 만들어 놓고 아무도 모르는 상태가 그대로 남는다.
    const tplMode = (schema.statusUI?.mode === 'template');
    const hasCommandsSlot = (schema.statusUI?.templates || []).some((t) => String(t.template || '').includes('{commands}'))
      || String(schema.statusUI?.template || '').includes('{commands}');
    const visibilityWarning = tplMode && withCmd.length && !hasCommandsSlot;
    wrap.appendChild(h('div', { class: `sce-command-visibility${visibilityWarning ? ' is-warning' : ''}` },
      h('div', {},
        h('strong', {}, visibilityWarning ? '상태창에 명령 목록이 표시되지 않아요' : '상태창 표시 상태'),
        h('p', {}, tplMode
          ? hasCommandsSlot
            ? 'HTML 템플릿의 {commands} 위치에 접이식 명령 목록이 표시돼요.'
            : 'HTML 템플릿에서는 {commands}를 넣어야 유저가 명령 목록을 볼 수 있어요.'
          : '자동 구성 방식에서는 상태창 맨 아래에 명령 목록이 자동으로 표시돼요.'),
      ),
      visibilityWarning ? h('button', { class: 'sce-btn sce-mini', onclick: () => {
        activeTab = 'status';
        rerender();
      } }, '상태창 설정 보기') : h('span', { class: 'sce-tag' },
        tplMode ? '템플릿에 표시 중' : '자동 표시 중'),
    ));
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

    wrap.appendChild(tabAiTools('party'));

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
      + '(showWhen으로 "편성했을 때만 표시" 같은 분기도 됩니다). '
      + '편성표가 있으면 deployed(편성 슬롯에 앉은 이름 목록)가 자동 제공됩니다 — '
      + 'has(deployed, "아린")을 상태창 showWhen·지시문·이벤트 조건 어디서든 쓸 수 있습니다.'));

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

    // 업그레이드 항목 (v0.58) — 스킬트리·시설 레벨·특성(max 1). 항목 = int 변수 하나.
    const ints = schema.vars.filter((v) => v.type === 'int');
    const pointsSelect = (owner, hint) => pair('포인트', bindSelect(owner.points ?? '',
      [['', hint], ...ints.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`])],
      (x) => { if (x) owner.points = x; else delete owner.points; rerender(); }),
      '업그레이드 비용을 치를 자원 (스킬=SP, 시설=골드). 비용 있는 항목엔 필수');
    const itemBlocks = (owner) => {
      const frag = h('div');
      const list = () => (owner.items = Array.isArray(owner.items) ? owner.items : []);
      (owner.items || []).forEach((it, i) => {
        const def = schema.vars.find((v) => v.id === it.var);
        frag.appendChild(h('div', { class: 'sce-block' },
          h('div', { class: 'sce-row' },
            pair('변수', bindSelect(it.var ?? '', ints.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`]),
              (x) => { it.var = x; rerender(); }), '레벨이 저장되는 int 변수'),
            pair('이름', bindInput(it.label, (x) => { it.label = x || undefined; rerender(); }, { cls: 'sce-w-m', ph: def?.label ?? '(변수 라벨)' })),
            pair('최대', bindInput(it.max, (x) => { it.max = numOrNull(x) ?? undefined; rerender(); }, { cls: 'sce-w-s', ph: def?.max != null ? String(def.max) : '5' }),
              'max 1이면 특성(해금)이 된다'),
            pair('비용', bindInput(it.cost, (x) => {
              const t = String(x).trim();
              if (!t) { delete it.cost; }
              else { const n = Number(t); it.cost = isFinite(n) ? n : t; }
              rerender();
            }, { cls: 'sce-w-m', ph: '1 또는 식: (skill+1)*10' }),
              '숫자 또는 표현식 — 식은 현재 레벨을 참조해 점증 비용을 만든다'),
            grip(owner.items, i, rerender),
          ),
          h('div', { class: 'sce-row' },
            pair('선행 조건', bindInput(it.requires, (x) => { it.requires = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '(비우면 없음) skill_sword >= 2' })),
            pair('조건 설명', bindInput(it.requiresLabel, (x) => { it.requiresLabel = x || undefined; rerender(); }, { cls: 'sce-w-m', ph: '검술 2 필요' }),
              '잠겼을 때 보여줄 한 줄 — 비우면 "선행 조건 미충족"'),
            pair('설명', bindInput(it.note, (x) => { it.note = x || undefined; rerender(); }, { cls: 'sce-w-m', ph: '(팝업에 보이는 한 줄)' })),
          ),
        ));
      });
      if (ints.length) {
        frag.appendChild(addBtn('업그레이드 항목 추가', () => { list().push({ var: ints[0].id, cost: 1 }); rerender(); }));
      } else {
        frag.appendChild(h('div', { class: 'sce-hint' }, '업그레이드 항목은 int 변수가 필요합니다 — [변수] 탭에서 먼저 만드세요 (예: skill_sword, init 0, max 5).'));
      }
      return frag;
    };

    if (!enums.length) {
      wrap.appendChild(h('div', { class: 'sce-hint sce-warn' },
        'enum 변수가 없어 슬롯을 만들 수 없습니다 — [변수] 탭에서 먼저 만드세요.'));
    }

    if (!hasTabs) {
      // 단일 편성 (축약형)
      wrap.appendChild(h('h4', {}, `슬롯 (${P.slots.length}개)`));
      wrap.appendChild(slotBlocks(P.slots));
      wrap.appendChild(h('h4', {}, `업그레이드 (${(P.items || []).length}개) — 스킬 레벨·시설·특성 찍기`));
      wrap.appendChild(h('div', { class: 'sce-row' }, pointsSelect(P, '(포인트 없음)')));
      wrap.appendChild(itemBlocks(P));
      wrap.appendChild(actionPicks(P));
      // 칸코레식 확장 — 함대 여러 개 + 수복·제작 같은 시설 탭
      wrap.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn', onclick: () => {
          P.tabs = [{ id: 'tab1', label: '편성 1', slots: P.slots,
            ...(P.actions ? { actions: P.actions } : {}),
            ...(P.items ? { items: P.items } : {}),
            ...(P.points ? { points: P.points } : {}) }];
          delete P.slots; delete P.actions; delete P.items; delete P.points;
          rerender();
        } }, '🗂 탭 구조로 전환 (편성 여러 개 · 수복/제작 같은 시설 탭)')));
    } else {
      // 여러 탭 (칸코레 모델) — 슬롯 있는 탭 = 편성, 슬롯 없이 액션만 = 시설(수복·제작)
      wrap.appendChild(h('h4', {}, `탭 (${P.tabs.length}개)`));
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '탭 = 편성 하나 또는 시설 하나. 슬롯을 채우면 편성 탭, 슬롯 없이 액션만 걸면 '
        + '수복·제작 같은 시설 탭이 됩니다. 인물은 탭이 달라도 한 자리에만 앉습니다 (이동/맞교환).'));
      wrap.appendChild(h('div', { class: 'sce-row' },
        pair('탭 표시 방식', bindSelect(P.nav ?? 'tabs',
          [['tabs', '탭 바 — 몇 개 안 될 때'], ['select', '셀렉트 + 검색 — 인물별 탭이 많을 때']],
          (x) => { if (x === 'tabs') delete P.nav; else P.nav = x; rerender(); }),
          '탭이 십수 개(인물별 스킬트리 등)면 셀렉트+검색이 찾기 쉽다'),
        (P.tabs.length >= 8 && P.nav !== 'select')
          ? h('span', { class: 'sce-hint sce-warn' }, `탭이 ${P.tabs.length}개 — 셀렉트+검색을 권합니다`)
          : null,
      ));
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
            pointsSelect(t, P.points ? `(공용 — ${P.points})` : '(포인트 없음)'),
          ),
          h('div', { class: 'sce-row' },
            pair('표시 조건', bindInput(t.when, (x) => { t.when = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '(비우면 항상 표시) has(deployed, "아린")' }),
              '거짓이면 탭이 통째로 숨는다 — 인물별 스킬트리 탭을 편성된 인물만 남기는 용도'),
          ),
          slotBlocks(t.slots),
          h('div', { class: 'sce-hint' }, `업그레이드 항목 ${(t.items || []).length}개 — 스킬 레벨·시설·특성(max 1) 찍기`),
          itemBlocks(t),
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

  // ── 탭: 달력 ──────────────────────────────────────────────
  // 게임 패널 2호 (v0.61). 일정 = list 변수 + @기한 규약 — 새 저장소를 만들지 않아서
  // 만료 자동 정리(onTurn expire)·AI의 @+N 등록·has() 조건식이 전부 기존 기계로 돈다.
  function tabCalendar() {
    const wrap = h('div');
    const tcfg = timeConfig(schema);
    if (!tcfg) {
      wrap.appendChild(h('div', { class: 'sce-hint sce-warn' },
        '달력 패널은 시간 체계 위에서 섭니다 — 시계 없는 달력은 그릴 날짜가 없습니다. '
        + '[시간] 탭에서 먼저 켜고 오세요.'));
      return wrap;
    }
    const lists = schema.vars.filter((v) => v.type === 'list');

    wrap.appendChild(tabAiTools('calendar'));

    if (!schema.calendar) {
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '달력 패널 — 채팅 화면 우상단에 [📅] 버튼을 달고, 누르면 이번 달 달력이 뜹니다. '
        + '계약·버프의 @기한이 자동으로 표시되고, 기념일(생일·축제·월세일)을 박아 둘 수 있고, '
        + '일정 목록을 지정하면 날짜를 눌러 약속을 등록할 수 있습니다 (일상물·학원물·경영물용).'));
      wrap.appendChild(addBtn('달력 만들기', () => {
        schema.calendar = { label: '달력', icon: '📅' };
        rerender();
      }));
      return wrap;
    }

    const C = schema.calendar;
    wrap.appendChild(h('div', { class: 'sce-block' },
      h('div', { class: 'sce-row' },
        pair('버튼 이름', bindInput(C.label, (x) => { C.label = x || undefined; rerender(); }, { cls: 'sce-w-m', ph: '달력' })),
        pair('아이콘', bindInput(C.icon, (x) => { C.icon = x || undefined; rerender(); }, { cls: 'sce-w-s', ph: '📅' })),
        pair('설명', bindInput(C.note, (x) => { C.note = x || undefined; rerender(); }, { cls: 'sce-w-l', ph: '팝업 상단 한 줄 (비워도 됨)' })),
      ),
      h('div', { class: 'sce-row' },
        pair('일정 목록', bindSelect(C.list ?? '',
          [['', '(없음 — 보기 전용 달력)'], ...lists.map((v) => [v.id, `${v.label ?? v.id} (${v.id})`])],
          (x) => { if (x) C.list = x; else delete C.list; rerender(); }),
          '지정하면 달력에서 날짜를 눌러 일정을 등록할 수 있다 — 항목은 "내용 @경과일"로 저장'),
      ),
    ));

    if (!C.list) {
      // 일정 목록 골격 — 변수 + 만료 규칙을 한 번에. 이름이 겹치면 만들지 않는다 (직접 고르게)
      const canScaffold = !schema.vars.some((v) => v.id === 'plans');
      wrap.appendChild(h('div', { class: 'sce-row' },
        canScaffold ? h('button', { class: 'sce-btn', onclick: () => {
          schema.vars.push({ id: 'plans', label: '일정', type: 'list', init: [], maxItems: 12, itemMaxLength: 30,
            desc: '앞으로 잡힌 약속·일정. 날짜가 지나면 자동으로 지워진다.' });
          if (tcfg.expose.includes('elapsed')) {
            schema.rules = schema.rules || {};
            schema.rules.onTurn = schema.rules.onTurn || [];
            schema.rules.onTurn.push({ list: 'plans', expire: 'elapsed' });
          }
          C.list = 'plans';
          rerender();
        } }, '📝 일정 목록 만들기 (plans 변수 + 자동 정리 규칙)') : null,
        h('span', { class: 'sce-hint' }, canScaffold
          ? '누르면 list 변수 하나와 "지난 일정 자동 삭제" 규칙이 같이 생깁니다.'
          : 'plans 변수가 이미 있습니다 — 위에서 직접 고르세요.'),
      ));
    } else {
      const hasExpire = (schema.rules?.onTurn || []).some((r) => r && r.list === C.list && r.expire);
      if (!hasExpire && tcfg.expose.includes('elapsed')) {
        wrap.appendChild(h('div', { class: 'sce-row' },
          h('button', { class: 'sce-btn', onclick: () => {
            schema.rules = schema.rules || {};
            schema.rules.onTurn = schema.rules.onTurn || [];
            schema.rules.onTurn.push({ list: C.list, expire: 'elapsed' });
            rerender();
          } }, '🧹 지난 일정 자동 정리 규칙 추가'),
          h('span', { class: 'sce-hint sce-warn' }, '지금은 지난 일정이 목록에 계속 남습니다.'),
        ));
      }
      const allowed = (schema.updater?.allow || []).some((a) => a.id === C.list);
      wrap.appendChild(h('div', { class: 'sce-hint' }, allowed
        ? `보조 AI도 일정을 잡을 수 있습니다 ('${C.list}'가 [AI 설정] 허용 목록에 있음) — `
          + '서사에서 "일요일에 보자"가 나오면 AI가 "@+N"(며칠 뒤)으로 등록하고, 시스템이 날짜로 굳힙니다.'
        : `지금은 유저만 일정을 등록합니다 — AI도 서사 따라 잡게 하려면 '${C.list}'를 [AI 설정] 허용 목록에 넣으세요.`));
    }

    // 기념일 (marks) — 적힌 성분이 전부 맞는 날에 뜬다
    C.marks = Array.isArray(C.marks) ? C.marks : [];
    wrap.appendChild(h('h4', {}, `기념일 (${C.marks.length}개)`));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '반복은 적는 칸이 정합니다 — 월+일 = 매년 (생일·축제) · 일만 = 매달 (월세일·정산일) · 요일만 = 매주 (수업·정기 모임). '
      + '메모는 그 날을 눌렀을 때 보입니다.'));
    C.marks.forEach((mk, i) => {
      wrap.appendChild(h('div', { class: 'sce-block' },
        h('div', { class: 'sce-row' },
          pair('이름', bindInput(mk.label, (x) => { mk.label = x; rerender(); }, { cls: 'sce-w-m', ph: '생일' })),
          pair('월', bindInput(mk.month, (x) => { mk.month = numOrNull(x) ?? undefined; rerender(); }, { cls: 'sce-w-s', ph: '-' })),
          pair('일', bindInput(mk.dom, (x) => { mk.dom = numOrNull(x) ?? undefined; rerender(); }, { cls: 'sce-w-s', ph: '-' })),
          pair('요일', bindSelect(mk.weekday ?? '',
            [['', '(무관)'], ...tcfg.weekdays.map((w) => [w, w])],
            (x) => { if (x) mk.weekday = x; else delete mk.weekday; rerender(); })),
          pair('메모', bindInput(mk.note, (x) => { mk.note = x || undefined; rerender(); }, { cls: 'sce-w-m', ph: '(비워도 됨)' })),
          grip(C.marks, i, rerender),
        ),
      ));
    });
    wrap.appendChild(addBtn('기념일 추가', () => {
      (C.marks = Array.isArray(C.marks) ? C.marks : []).push({ label: '기념일', month: 1, dom: 1 });
      rerender();
    }));
    if (!C.marks.length) delete C.marks;   // 빈 배열은 스키마에 안 남긴다 (addBtn이 되살린다)

    wrap.appendChild(h('h4', {}, '팝업 커스텀 CSS (자동으로 팝업 범위로 제한됨)'));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '쓸 수 있는 클래스: .scc-day(날짜 칸) .scc-day.scc-today(오늘) .scc-day.scc-sel(선택) '
      + '.scc-dot.scc-mark(기념일 점) .scc-dot.scc-plan(일정 점) .scc-dot.scc-due(기한 점) '
      + '.scc-nav(달 이동 줄) .scc-detail(하단 상세). 카드·제목은 편성표와 같은 .scg-card/.scg-title.'));
    wrap.appendChild(bindArea(C.css, (x) => { C.css = x || undefined; rerender(); },
      '.scg-card { background:#141018; border-color:#8a6d3b; }\n.scc-day.scc-today { border-color:#e0a94a; }'));

    wrap.appendChild(h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn sce-danger', onclick: () => { delete schema.calendar; rerender(); } }, '달력 제거')));
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

  // 시간 골격 헬퍼 — 켜기 3택과 진행 입구 버튼이 같은 것을 만든다 (두 벌 금지)
  function ensureSkipVars() {
    if (!schema.vars.some((v) => v.id === SKIP_DAY)) {
      schema.vars.push({ id: SKIP_DAY, label: '건너뛴 일수', type: 'int', init: 0, min: 0, max: 30,
        desc: '며칠 통째로 지났나. 같은 날 안이면 0. 자고 일어나 이튿날 아침이면 1. 2 이상은 "며칠 뒤"처럼 명시적으로 건너뛴 만큼만.' });
      schema.updater.allow.push({ id: SKIP_DAY, maxGain: 7 });
    }
    if (!schema.vars.some((v) => v.id === SKIP_MIN)) {
      schema.vars.push({ id: SKIP_MIN, label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 1440,
        desc: '이번 장면에서 흐른 시간(분). 대화 한 토막이면 5~20, 식사·외출이면 60~180. 날짜가 넘어가면 skip_day를 올리고 여기엔 그날 안에서 흐른 분만.' });
      schema.updater.allow.push({ id: SKIP_MIN, maxGain: 720 });
    }
  }
  function addEndDayAction() {
    if ((schema.actions || []).some((a) => (a.effects || []).some((f) => f.set === SKIP_DAY))) return;
    schema.actions.push({
      id: 'end_day', label: '🌙 하루를 마친다',
      effects: [{ set: SKIP_DAY, expr: '1' }, { set: SKIP_MIN, expr: '0' }],
      inject: '[하루 마무리] 오늘은 여기까지다. 다음 서사는 이튿날 아침 장면으로 시작하라.',
    });
  }

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
      // 켜는 순간 완성품 (design-시간.md §결정 2) — 켜기만 하고 진행 입구가 없으면 시계가
      // 멈춘 채 박힌다. 상태창에 같은 날짜가 영원히 뜨는 건 날짜가 없는 것보다 나쁘다 —
      // 그래서 "그냥 켜기" 버튼을 두지 않고, 시간이 흐르는 방식을 같이 고르게 한다.
      wrap.appendChild(h('h4', {}, '🕐 시간 체계 켜기 — 시간이 어떻게 흐르나요?'));
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '켜기만 하면 시계가 멈춘 채 시작합니다. 흐르는 방식까지 골라야 완성품입니다 (켠 뒤에 바꿀 수 있어요).'));
      const enable = (advance) => {
        schema.time = { start: '2026-01-01 09:00', advance, format: { date: 'YYYY-MM-DD', clock: 'HH:mm' } };
      };
      wrap.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn', onclick: () => {
          enable('explicit'); ensureSkipVars(); addEndDayAction(); rerender();
        } }, '🌙 버튼·보고로 — 일상물 표준 (하루 마무리 액션 + AI 장면 보고)')));
      wrap.appendChild(h('div', { class: 'sce-hint' },
        '유저가 [🌙 하루를 마친다]를 누르거나, 보조 AI가 장면마다 "몇 분 흘렀나"를 보고해 시간이 갑니다. 대부분의 봇은 이걸 고르세요.'));
      wrap.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn', onclick: () => {
          enable('explicit'); ensureSkipVars(); rerender();
        } }, '📝 AI 보고로만 — 버튼 없이 서사 흐름 따라')));
      wrap.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn', onclick: () => {
          enable('perTurn'); rerender();
        } }, '📆 턴마다 하루 — 생존물·경영물형 (출력 1번 = 1일)')));
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

    // ⚠ 소급 안 됨 — 시계(time_epoch)는 채팅 시작 때 세이브에 박힌다. 여기를 고쳐도
    //   진행 중인 채팅의 날짜는 안 바뀐다 (실측 문의: "작중은 10월인데 상태창이 3월").
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '시작 시점은 **새로 시작하는 채팅**에만 적용됩니다 — 진행 중인 채팅의 시계는 세이브에 '
      + '저장돼 있어 여기서 안 바뀝니다. 진행 중인 판의 날짜를 옮기려면 채팅에 '
      + '/날짜 2026-10-05 를 치거나, [새 시작] 탭의 프리셋 시작 시점(startAt)을 쓰세요.'));
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
    // 시작 시각 무작위 (v0.80) — 켜면 판마다 시작점이 달라진다. 안 켠 칸은 위 시작 시점 그대로.
    // 규칙 #3: 엔진에만 넣고 칸을 안 만들면 JSON 손편집 말고는 쓸 방법이 없다.
    {
      const RF = [
        ['hour', '시각', 0, 23, '6, 22'],
        ['minute', '분', 0, 59, '0, 59'],
        ['dom', '일', 1, 31, '1, 28'],
        ['month', '월', 1, 12, '3, 5'],
        ['year', '년', 1, 9999, '2024, 2026'],
      ];
      const on = !!T.startRandom;
      wrap.appendChild(h('h4', {}, '시작 시각 무작위'));
      wrap.appendChild(h('div', { class: 'sce-row' },
        bindCheck(on, (v) => {
          // 켤 때 시각 범위를 기본으로 채워 준다 — 빈 껍데기를 켜 두면 아무것도 안 바뀐다
          T.startRandom = v ? { hour: [6, 22] } : undefined;
          rerender();
        }, '판마다 시작 시각을 다르게')));
      if (on) {
        const SR = T.startRandom;
        const row = h('div', { class: 'sce-row' });
        for (const [key, label, lo, hi, ph] of RF) {
          const cur = Array.isArray(SR[key]) ? SR[key].join(', ') : '';
          row.appendChild(pair(label, bindInput(cur, (x) => {
            const nums = String(x).split(/[,~\-\s]+/).map((n) => n.trim()).filter(Boolean).map(Number);
            if (nums.length === 2 && nums.every((n) => isFinite(n))) SR[key] = [Math.floor(nums[0]), Math.floor(nums[1])];
            else delete SR[key];   // 비우면 그 칸은 고정 (시작 시점 값을 그대로 쓴다)
            rerender();
          }, { cls: 'sce-w-s', ph }), `${lo}~${hi} · 비우면 고정`));
        }
        wrap.appendChild(row);
        wrap.appendChild(h('div', { class: 'sce-hint' },
          '채운 칸만 굴립니다 — 비운 칸은 위 [시작 시점]의 값을 그대로 씁니다 (예: 시각만 채우면 날짜는 고정). '
          + '**같은 채팅 안에서는 늘 같은 시각**이라 리롤해도 안 흔들리고, 새 채팅을 열면 새로 굴립니다. '
          + '[현황]의 판 초기화로도 다시 굴러갑니다. 없는 날짜(2월 31일 등)는 그 달 말일로 당겨집니다.'));
        if (!Object.keys(SR).length) {
          wrap.appendChild(h('div', { class: 'sce-hint' },
            '⚠ 범위가 하나도 없어 지금은 꺼진 것과 같습니다 — 칸을 하나 이상 채우세요.'));
        }
      }
    }

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
          ensureSkipVars();
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
            ensureSkipVars();   // skip_min이 없던 봇이면 함께 — 액션 효과가 그 변수를 만진다
            addEndDayAction();
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
        '이 프리셋으로 시작할 때의 작중 날짜·시각 ("YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm"). '
        + '진행 중 채팅에서 눌러도 시계가 이 시점으로 점프한다 — 변수를 안 적으면 시계만 옮긴다. '
        + '한 번만 옮길 거면 채팅에 /날짜 2026-10-05 를 쳐도 된다') : null,
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

    // 감지 신고 (v0.74) — 낱말 게이트의 안전망. 기본 켜짐, 끄기만 저장 (규칙 #3)
    wrap.appendChild(h('h4', {}, '잠긴 변수 감지 신고'));
    wrap.appendChild(h('div', { class: 'sce-row' },
      bindCheck(schema.updater.wordDetect !== false,
        (on) => { schema.updater.wordDetect = on ? undefined : false; rerender(); }, '감지 신고 켜기 (기본)')));
    wrap.appendChild(h('div', { class: 'sce-hint' },
      '등장 낱말로 잠근 변수를 서사가 낱말 없이 서술하면("발을 헛디뎠고 일어서지 못했다") 보조 AI가 '
      + '그 사실만 신고하고, 그 변수가 다음 턴 한 번 열린다. 신고 자체는 값을 못 바꾸고, 열린 뒤에도 '
      + '증감 한도는 그대로 걸린다. 낱말 잠금을 안 쓰는 봇에는 아무 영향이 없다.'));

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
          + '상태어(부상·평판 등)는 유의어를 여러 개, 명사 위주로 — 동사는 "다쳤다" 대신 끝의 다를 뗀 "다쳤"으로 적으면 다쳤다·다쳤고에 다 걸리고, "다친" 같은 다른 꼴도 같이 적을 것. '
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
  let jsonDraft = null;    // 원본 JSON 편집 중 내용 (null = 현재 작업본과 같음)
  let jsonDraftDirty = false;
  let jsonImportPreview = null; // 전체 교체 전 검사 결과
  let jsonImportBackup = null;  // 전체 교체 직전 작업본 — 되돌리기 1슬롯
  let jsonImportApplied = false;

  // ── 위층 (AI에게 맡기기) 상태 — docs/design-내장-AI-생성.md ──
  let aiReq = '';           // 요청 문구
  let aiCtxOn = true;       // 봇 설명·로어북 동봉 여부
  let aiBotCtx;             // getBotContext 결과 캐시 (undefined = 아직 안 읽음, null = 못 읽음)
  let aiBotCtxError = null; // 캐릭터 연결 실패를 실제 빈 컨텍스트와 구분
  let aiGenModel;           // 생성 모델 선택 캐시 { choice, staticId } (undefined = 아직 안 읽음)
  let aiModelIds;           // 리수 DB의 모델 id { main, sub } (undefined = 미시도, null = 못 읽음)
  // 생성 모델 선택 줄 (v0.78) — 예전엔 [AI 어시스턴트] 탭 안에만 있었다. 그런데 생성은
  // 거기서만 일어나지 않는다: 에셋 팩 변환도, 상태창 꾸미기도 같은 `ai.generate`를 탄다.
  // 설정은 전역이라 이미 적용되고 있었는데 **고르는 자리가 안 보여서** 늘 보조 모델로
  // 가는 것처럼 보였다(실기 제보). 그래서 줄을 함수로 빼서 생성 버튼이 있는 곳마다 붙인다.
  //   compact=true — 긴 설명 대신 한 줄 주석만 (임포터·꾸미기처럼 자리가 좁은 곳)
  function buildGenModelRow(compact) {
    if (!ai || !ai.getGenModel || !ai.setGenModel) return null;
    const gmLine = h('div', { class: 'sce-row sce-ai-model-row' });
    const renderGmLine = () => {
      gmLine.replaceChildren();
      if (aiGenModel === undefined) {
        gmLine.appendChild(h('span', { class: 'sce-hint', style: 'margin:0' }, '생성 모델 읽는 중…'));
        return;
      }
      const save = () => ai.setGenModel({ choice: aiGenModel.choice, staticId: aiGenModel.staticId });
      gmLine.appendChild(h('span', { class: 'sce-hint', style: 'margin:0' }, '생성 모델:'));
      gmLine.appendChild(bindSelect(aiGenModel.choice, [
        ['aux', '보조 모델 (기본)'],
        ['main', '메인 모델 (대화용 그대로)'],
        ['static', '직접 지정 (실험적)'],
      ], (x) => { aiGenModel.choice = x; save(); rerender(); }));
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
      const copy = aiGenModel.choice === 'aux'
        ? (compact ? '보조 모델로 변환해요 — 결과가 부실하면 메인 모델로 바꿔 보세요.'
          : '보조 모델로 생성해요. 품질이 낮으면 더 높은 성능의 모델로 바꿔 보세요.')
        : aiGenModel.choice === 'main'
          ? '대화 모델로 보내요. 일부 환경에서는 인증 문제로 실패할 수 있어요.'
          : '입력한 모델 id로 보내요. Risu 모델 설정에 표시된 id를 사용해 주세요.';
      gmLine.appendChild(h('div', { class: 'sce-ai-model-copy' }, copy));
    };
    renderGmLine();
    // 어느 화면에서 처음 열든 여기서 읽는다 — [AI 어시스턴트]를 안 거쳐도 선택이 뜬다
    if (aiGenModel === undefined) {
      Promise.resolve(ai.getGenModel())
        .then((v) => { aiGenModel = (v && v.choice) ? v : { choice: 'aux', staticId: '' }; })
        .catch(() => { aiGenModel = { choice: 'aux', staticId: '' }; })
        .then(() => { if (!destroyed) renderGmLine(); });
    }
    return gmLine;
  }

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

  async function fetchBotCtx(force = false) {
    if (!force && aiBotCtx !== undefined) return aiBotCtx;
    aiBotCtxError = null;
    if (!ai || !ai.getBotContext) {
      aiBotCtx = null;
      aiBotCtxError = '현재 환경에서 캐릭터 정보를 읽는 기능을 사용할 수 없어요.';
      return null;
    }
    try { aiBotCtx = (await ai.getBotContext()) || null; }
    catch (e) {
      aiBotCtx = null;
      aiBotCtxError = e instanceof Error ? e.message : String(e);
    }
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
    const jsonParseFailure = (raw, error) => {
      const cleaned = stripFence(raw);
      const position = Number(/position\s+(\d+)/i.exec(error.message)?.[1]);
      let line = 1, column = 1;
      if (Number.isFinite(position)) {
        const before = cleaned.slice(0, position);
        line = before.split('\n').length;
        column = position - before.lastIndexOf('\n');
      } else {
        const lc = /line\s+(\d+)\s+column\s+(\d+)/i.exec(error.message);
        if (lc) { line = Number(lc[1]); column = Number(lc[2]); }
      }
      const lines = cleaned.split('\n');
      const from = Math.max(0, line - 2), to = Math.min(lines.length, line + 1);
      const context = lines.slice(from, to).map((value, i) => `${from + i + 1} | ${value}`).join('\n');
      return {
        error: `JSON 문법 오류 · ${line}행 ${column}열 — ${error.message}`,
        context: context.slice(0, 900),
      };
    };
    // 응답 검사 — 패치는 parsePatch+planPatch, 통짜는 JSON+validateSchema까지 통과해야 합격.
    // 불합격이어도 안전하다는 게 이 설계의 핵심 — 쓰레기는 여기서 멈추고 스키마는 안 변한다.
    const inspect = (text) => {
      let parsedJson;
      try { parsedJson = JSON.parse(stripFence(text)); }
      catch (e) {
        const failure = jsonParseFailure(text, e);
        return { ok: false, errors: [failure.error], retryContext: failure.context };
      }
      if (blank) {
        const v = validateSchema(parsedJson);
        if (!v.ok) return { ok: false, errors: v.errors.map((e) => `${e.path} — ${e.msg}`) };
        return { ok: true, full: { schema: parsedJson, warnings: v.warnings } };
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
    const selectedModelLabel = aiGenModel?.choice === 'main' ? '메인 모델'
      : aiGenModel?.choice === 'static' ? '직접 지정 모델' : '보조 모델';
    let fatal = null, text = null, got = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = attempt === 0 ? prompt
        // 형식 불합격 1회 자동 재시도 — 오류를 첨부해 다시 (aux JSON 재시도와 같은 규율)
        : prompt + '\n\n──\n방금 응답이 형식 검사에서 거부되었습니다:\n'
          + got.errors.slice(0, 8).map((e) => '- ' + e).join('\n')
          + (got.retryContext ? `\n\n문제가 발견된 주변:\n${got.retryContext}` : '')
          + '\n\n이전 출력을 그대로 이어 쓰지 말고 처음부터 다시 작성하세요.'
          + '\n출력 직전에 쉼표, 따옴표, 중괄호 짝을 검사하고 설명이나 코드펜스 없이 유효한 JSON 하나만 출력하세요.';
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
      aiGen.note = `⚠ ${selectedModelLabel} 호출이 이 환경에서 차단됐어요 — [규격서 복사]로 다른 AI를 이용해 주세요.`;
    } else if (fatal) {
      aiGen.note = `⚠ ${selectedModelLabel} 호출 실패 — ${fatal.msg}`
        + ' · 생성 모델을 바꾸거나 [규격서 복사]를 이용해 주세요.';
    } else if (!got.ok) {
      aiGen.note = `⚠ ${selectedModelLabel} 응답이 두 번 모두 형식 검사를 통과하지 못했어요. `
        + '아래 원문과 오류 위치를 확인하거나 [규격서 복사]로 다른 AI에 맡겨 주세요. 오류: ' + got.errors[0]
        + (got.retryContext ? ` · 주변: ${got.retryContext.replace(/\s+/g, ' ').slice(0, 240)}` : '');
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
  let cssDesignPolish = true;
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

  // 🎨 꾸미기 창구 본체 — 1층 👁 결과와 3층 상태창 탭이 같은 것을 띄운다.
  // 상태(cssMode·cssReq·cssGen·cssBackup)를 공유하므로 어느 쪽에서 눌러도 결과와 되돌리기가 같다.
  // 꾸미기 창구 — 1층 👁 결과와 3층 상태창 탭이 **같은 것**을 띄운다 (요청 문구·되돌리기
  // 슬롯까지 공유하므로 어느 쪽에서 눌러도 결과가 같다). 표현은 v0.66 개조판 것을 따른다.
  function cssAiTools() {
    const wrap = h('div');
    const layoutMode = cssMode === 'layout';

    const modeSwitch = h('div', { class: 'sce-mode-switch', role: 'group', 'aria-label': '디자인 생성 범위' });
    for (const [mode, label, desc] of [
      ['skin', '스킨만', '색·글꼴·질감'],
      ['layout', '배치까지', '템플릿 전체'],
    ]) {
      modeSwitch.appendChild(h('button', { type: 'button', class: 'sce-mode-btn' + (cssMode === mode ? ' on' : ''),
        'aria-pressed': String(cssMode === mode), onclick: () => { cssMode = mode; rerender(); } },
      `${label} · ${desc}`));
    }
    wrap.appendChild(modeSwitch);

    const cssActions = h('div', { class: 'sce-design-actions' });
    const cssRequest = bindArea(cssReq, (x) => { cssReq = x; }, layoutMode
      ? '원하는 배치·분위기 — 예: 왼쪽 칭호 칸, 오른쪽 수치 2열, 하단 계약 칩 / 작전 지도: 배경 에셋 worldmap 위에 거점 핀'
      : '원하는 분위기 — 예: 낡은 신문지 느낌, 세리프 폰트, 붉은 도장 포인트');
    cssRequest.className = 'sce-design-request';
    cssRequest.setAttribute('aria-label', layoutMode ? '원하는 배치와 분위기' : '원하는 분위기');
    cssActions.appendChild(cssRequest);

    const cssControls = h('div', { class: 'sce-design-controls' });
    if (ai && ai.generate) {
      cssControls.appendChild(cssGen.busy
        ? h('button', { class: 'sce-btn sce-mini', onclick: () => {
          cssGen.seq++; cssGen.busy = false; rerender();
        } }, '생성 취소')
        : h('button', { class: 'sce-btn sce-mini sce-ai-primary', onclick: () => runCssGenerate() },
          layoutMode ? '배치 생성' : '스킨 생성'));
      // 꾸미기도 같은 생성 경로다 — 모델 선택을 여기서도 (v0.78)
      const gmLine = buildGenModelRow(true);
      if (gmLine) cssControls.appendChild(gmLine);
    }
    const cssStateClass = cssGen.note && !cssGen.note.startsWith('✅') ? ' warn'
      : cssGen.note?.startsWith('✅') ? ' ok' : '';
    cssControls.appendChild(h('span', { class: 'sce-generation-state' + cssStateClass, 'aria-live': 'polite' },
      cssGen.busy ? (layoutMode ? '배치 생성 중…' : '스킨 생성 중…') : (cssGen.note || '')));
    if (cssBackup) {
      cssControls.appendChild(h('button', { class: 'sce-btn sce-mini', onclick: () => {
        schema.statusUI.mode = cssBackup.mode;
        schema.statusUI.template = cssBackup.template;
        schema.statusUI.customCSS = cssBackup.customCSS;
        cssBackup = null; cssGen.note = null; rerender();
      } }, '꾸미기 되돌리기'));
    }
    cssActions.appendChild(cssControls);
    wrap.appendChild(cssActions);

    wrap.appendChild(h('div', { class: 'sce-design-polish' },
      bindCheck(cssDesignPolish, (x) => { cssDesignPolish = x; rerender(); }, '획일적인 AI 디자인 줄이기'),
      h('span', { class: 'sce-hint', style: 'margin:0' },
        'Hallmark 가이드를 보정 지침으로 더해 흔한 카드·배지 남발을 줄여요.'),
      h('a', { class: 'sce-hallmark-link', href: 'https://github.com/Nutlope/hallmark',
        target: '_blank', rel: 'noopener noreferrer', title: 'Hallmark GitHub 저장소 열기' }, 'GitHub ↗')));

    if (!layoutMode && schema.statusUI.mode === 'template') {
      wrap.appendChild(h('div', { class: 'sce-warn' },
        '현재 커스텀 템플릿을 사용 중이라 스킨 CSS가 제대로 반영되지 않을 수 있어요. [배치까지]를 선택해 주세요.'));
    }

    const external = h('div', { class: 'sce-result-external' },
      h('div', { class: 'sce-ai-alt-title' }, '외부 AI로 만들기'));
    copyWidget(layoutMode ? '📋 배치 규격 복사' : '📋 CSS 규격 복사',
      layoutMode
        ? '배치 요청과 자리표시자 계약이 담긴 규격서를 복사해요. 웹 AI에게 주고, 받은 HTML은 '
          + '세부 편집기 상태창 탭에서 표시 방식을 커스텀으로 바꾼 뒤 템플릿 칸에 통째로 붙여넣으세요 (<style>은 자동 분리됩니다).'
        : '분위기 문구와 이 봇의 실제 상태창 구조가 담긴 규격서를 복사해요. 웹 AI에게 주고, '
          + '받은 CSS는 세부 편집기 상태창 탭의 커스텀 CSS 칸에 붙여넣으세요.',
      () => (cssMode === 'layout'
        ? buildLayoutSpecPrompt(schema, cssReq, cssDesignPolish)
        : buildCssSpecPrompt(schema, cssReq, cssDesignPolish)), [], { collapsible: true }).mount(external);
    wrap.appendChild(external);
    return wrap;
  }

  async function runCssGenerate() {
    if (!ai || !ai.generate || cssGen.busy) return;
    const layout = cssMode === 'layout';
    const mySeq = ++cssGen.seq;
    cssGen.busy = true; cssGen.note = null;
    rerender();
    let res = null;
    try {
      res = await ai.generate(layout
        ? buildLayoutSpecPrompt(schema, cssReq, cssDesignPolish)
        : buildCssSpecPrompt(schema, cssReq, cssDesignPolish));
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
    const line = (icon, title, subs) => h('div', { class: 'sce-catalog-item' },
      h('div', { class: 'sce-catalog-item-title' }, `${icon} ${title}`),
      ...subs.filter(Boolean).map((s) => h('div', { class: 'sce-catalog-item-detail' }, s)));
    const eventRow = (e, random, rndChance) => {
      const condition = [];
      if (e.when) condition.push(e.when);
      if (e.check) condition.push(`판정 ${e.check}`);
      if (e.once) condition.push('한 번만 발동');
      if (e.cooldown != null) condition.push(`쿨다운 ${e.cooldown}턴`);
      if (random && e.weight != null) condition.push(`가중치 ${e.weight}`);
      const effects = (e.effects || []).map(fmtE);
      if ((e.choices || []).length) effects.push(`갈림길 ${e.choices.length}개`);
      const kind = random ? `랜덤 · 턴당 ${Math.round(rndChance * 100)}%` : '일반 이벤트';
      const fields = [
        ['추가된 항목', e.id || '(ID 없음)'],
        ['발동·조건', condition.join(' · ') || '조건 없음'],
        ['효과·변수 변경', effects.join(' · ') || '변경 없음'],
        ['통지', e.notify || '통지 없음'],
      ];
      return h('article', { class: 'sce-event-row' },
        h('div', { class: 'sce-event-head' },
          h('span', { class: 'sce-event-kind' }, kind),
          h('span', { class: 'sce-event-title' }, e.id || '(ID 없음)')),
        h('dl', { class: 'sce-event-fields' },
          ...fields.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])));
    };

    if ((schema.vars || []).length) {
      const group = h('section', { class: 'sce-catalog-group' }, h('h4', {}, `변수 ${schema.vars.length}개`));
      const grid = h('div', { class: 'sce-catalog-grid' });
      for (const v of schema.vars) grid.appendChild(line('◆', v.label ?? v.id ?? '(ID 없음)', [
        `ID: ${v.id ?? '(없음)'}`,
        `형식: ${v.type ?? 'int'} · 시작값: ${JSON.stringify(v.init ?? 0)}`,
        v.min != null || v.max != null ? `범위: ${v.min ?? '제한 없음'} ~ ${v.max ?? '제한 없음'}` : null,
      ]));
      group.appendChild(grid); wrap.appendChild(group);
    }

    const evs = schema.rules.events || [];
    const rndChance = schema.rules.randomEvents?.chancePerTurn ?? 0;
    const rnd = schema.rules.randomEvents?.table || [];
    if (evs.length + rnd.length) {
      const group = h('section', { class: 'sce-catalog-group' },
        h('h4', {}, `이벤트 ${evs.length + rnd.length}개`));
      const list = h('div', { class: 'sce-event-list' });
      for (const e of evs) list.appendChild(eventRow(e, false, rndChance));
      for (const e of rnd) list.appendChild(eventRow(e, true, rndChance));
      group.appendChild(list);
      wrap.appendChild(group);
    }
    if ((schema.actions || []).length) {
      const group = h('section', { class: 'sce-catalog-group' }, h('h4', {}, `액션 ${schema.actions.length}개`));
      const grid = h('div', { class: 'sce-catalog-grid' });
      for (const a of schema.actions) grid.appendChild(line('🔘', `${a.label ?? a.id}${a.mode ? ` (${a.mode})` : ''}`, [
        a.when ? `조건: ${a.when}` : null,
        (a.effects || []).length ? `효과: ${a.effects.map(fmtE).join(' · ')}` : null,
        a.check ? `연결 판정: ${a.check}` : null,
        a.inject ? `서사 지시: ${a.inject}` : null,
      ]));
      group.appendChild(grid); wrap.appendChild(group);
    }
    if ((schema.checks || []).length) {
      const group = h('section', { class: 'sce-catalog-group' }, h('h4', {}, `판정 ${schema.checks.length}개`));
      const grid = h('div', { class: 'sce-catalog-grid' });
      for (const c of schema.checks) grid.appendChild(line('🎯', c.label ?? c.id, [
        `굴림: ${c.roll}`,
        (c.grades || []).length ? `${c.grades.length}단계: ${c.grades.map((g) => g.label ?? '(이름 없음)').join(' / ')}` : null,
      ]));
      group.appendChild(grid); wrap.appendChild(group);
    }
    if ((schema.directives || []).length) {
      const group = h('section', { class: 'sce-catalog-group' }, h('h4', {}, `지시문 ${schema.directives.length}개`));
      const grid = h('div', { class: 'sce-catalog-grid' });
      for (const d of schema.directives) grid.appendChild(line('📣', d.id, [
        d.when ? `켜짐: ${d.when}` : null,
        d.text ? `지시: ${d.text}` : null,
      ]));
      group.appendChild(grid); wrap.appendChild(group);
    }
    if ((schema.rules.onTurn || []).length) {
      const group = h('section', { class: 'sce-catalog-group' }, h('h4', {}, '매 턴 정산'));
      const grid = h('div', { class: 'sce-catalog-grid' },
        line('🔁', `${schema.rules.onTurn.length}건`, schema.rules.onTurn.map((e) => fmtE(e))));
      group.appendChild(grid); wrap.appendChild(group);
    }
    if (!wrap.childNodes.length) {
      wrap.appendChild(h('div', { class: 'sce-hint' }, '아직 만들어진 이벤트·액션·판정이 없어요. 창작 탭에서 원하는 내용을 입력해 주세요.'));
    }
    return wrap;
  }

  function topFloor() {
    const box = h('div', { class: 'sce-block sce-top' });
    const topHead = h('div', { class: 'sce-top-head' },
      h('h4', { style: 'margin:0' }, '✨ AI 어시스턴트'));
    if (firstInstallGuideDismissed) {
      topHead.appendChild(h('button', { class: 'sce-btn sce-mini', type: 'button', onclick: () => {
        firstInstallGuideDismissed = false;
        if (typeof setFirstInstallGuideDismissed === 'function')
          Promise.resolve(setFirstInstallGuideDismissed(false)).catch(() => {});
        rerender();
      } }, '설치 순서 보기'));
    }
    box.appendChild(topHead);
    const blank = schemaIsBlank(schema);
    const installed = typeof isInstalled === 'function' ? !!isInstalled() : !blank;
    const firstInstallStep = installed ? 5 : aiFull ? 3 : blank ? (aiGen.busy ? 2 : 1) : 4;
    const firstInstallClass = (step) => 'sce-first-install-step'
      + (firstInstallStep === step ? ' on' : step < firstInstallStep ? ' done' : '');
    const firstInstallNumber = (step) => `${String(step).padStart(2, '0')}${firstInstallStep === step ? ' · 현재' : step < firstInstallStep ? ' · 완료' : ''}`;

    if (!firstInstallGuideDismissed) {
      box.appendChild(h('div', { class: 'sce-first-install-guide' },
        h('button', { class: 'sce-first-install-close', type: 'button', 'aria-label': '처음 설치 순서 닫기',
          title: '안내 닫기', onclick: () => {
            firstInstallGuideDismissed = true;
            if (typeof setFirstInstallGuideDismissed === 'function')
              Promise.resolve(setFirstInstallGuideDismissed(true)).catch(() => {});
            rerender();
          } }, '×'),
        h('div', { class: 'sce-first-install-title' }, '처음 설치 순서'),
        h('div', { class: 'sce-first-install-lead' }, '아래 네 단계를 차례대로 진행해 주세요.'),
        h('div', { class: 'sce-first-install-steps' },
          h('div', { class: firstInstallClass(1) },
            h('span', { class: 'sce-first-install-number' }, firstInstallNumber(1)),
            h('b', {}, '원하는 내용 입력'),
            h('span', {}, '아래 입력칸에 만들고 싶은 시뮬레이션을 적어 주세요.')),
          h('div', { class: firstInstallClass(2) },
            h('span', { class: 'sce-first-install-number' }, firstInstallNumber(2)),
            h('b', {}, '작업본 생성'),
            h('span', {}, '[작업본 생성]을 눌러 작업본을 만들어 주세요.')),
          h('div', { class: firstInstallClass(3) },
            h('span', { class: 'sce-first-install-number' }, firstInstallNumber(3)),
            h('b', {}, '편집기에 넣기'),
            h('span', {}, '결과를 확인하고 [편집기에 넣기]를 눌러 주세요.')),
          h('div', { class: firstInstallClass(4) },
            h('span', { class: 'sce-first-install-number' }, firstInstallNumber(4)),
            h('b', {}, '캐릭터에 적용'),
            h('span', {}, '마지막으로 화면 위쪽의 [캐릭터에 적용]을 눌러 주세요.')),
        ),
        h('div', { class: 'sce-first-install-note' },
          installed
            ? '설치가 완료됐어요. 안내가 더 필요하지 않으면 오른쪽 위 ×를 눌러 닫아 주세요.'
            : '캐릭터에 적용한 뒤에도 이 안내는 유지돼요. 확인을 마치면 오른쪽 위 ×를 눌러 닫아 주세요.'),
      ));
    }

    // 1층 내부 탭 — 창작(시키기) / 결과(보기) / 진단(굴리기). 빈 스키마는 보여줄 결과가 없어 창작만.
    if (!blank) {
      const diagCnt = diagResult && diagResult.findings
        ? diagResult.findings.filter((f) => f.sev !== 'low').length : null;
      const bar = h('div', { class: 'sce-tabs', role: 'tablist', 'aria-label': 'AI 작업 단계' });
      for (const [key, label] of [
        ['make', `✍ 창작${aiGen.busy ? ' ⏳' : (patchSource === 'top' && patchPlan) ? ' ●' : ''}`],
        ['result', '👁 결과'],
        ['diag', `🔬 진단${diagCnt != null ? ` (${diagCnt})` : ''}`],
      ]) {
        bar.appendChild(h('button', {
          class: 'sce-tab' + (topTab === key ? ' on' : ''),
          role: 'tab', 'aria-selected': String(topTab === key),
          onclick: () => { topTab = key; render(); },
        }, label));
      }
      box.appendChild(bar);
    }

    // 👁 결과 — 상태창 미리보기 + CSS 커스텀 + 만들어진 것들 도감
    if (!blank && topTab === 'result') {
      const previewSection = h('section', { class: 'sce-result-section' },
        h('div', { class: 'sce-result-head' }, h('div', {},
          h('div', { class: 'sce-result-title' }, '상태창 미리보기'),
          h('div', { class: 'sce-result-copy' },
            '현재 작업본의 시작값을 보여줍니다. 창작이나 세부 편집기에서 고치면 바로 갱신돼요.'))),
        statusPreviewEl('pv1'));
      box.appendChild(previewSection);

      // 꾸미기 — 스킨(색·폰트)과 배치(템플릿 통째) 둘 다 자동화 영역.
      // 구조("무엇을 보여줄까")를 맡기는 창구는 심층 편집 상태창 탭에 있다 — 같은 절을 둘이 나눠 쥔다.
      const designSection = h('section', { class: 'sce-result-section' },
        h('div', { class: 'sce-result-head' }, h('div', {},
          h('div', { class: 'sce-result-title' }, '디자인 생성'),
          h('div', { class: 'sce-result-copy' },
            '색과 글꼴만 바꾸거나, 상태창의 배치까지 새로 만들 수 있어요.'))),
        cssAiTools());
      designSection.appendChild(h('div', { class: 'sce-result-copy' },
        '보여줄 항목 자체(그룹·게이지·표시 조건)를 AI에게 맡기려면 세부 편집기 → 상태창 탭의 구조 창구를 쓰세요.'));
      box.appendChild(designSection);

      const eventCount = (schema.rules.events || []).length + (schema.rules.randomEvents?.table || []).length;
      const counts = [
        ['변수', (schema.vars || []).length], ['이벤트', eventCount], ['액션', (schema.actions || []).length],
        ['판정', (schema.checks || []).length], ['지시문', (schema.directives || []).length],
      ];
      const catalogSection = h('section', { class: 'sce-result-section' },
        h('div', { class: 'sce-result-head' }, h('div', {},
          h('div', { class: 'sce-result-title' }, '만들어진 것들'),
          h('div', { class: 'sce-result-copy' }, '작업본의 구성 개수를 먼저 확인하고 필요한 경우에만 세부 내용을 펼쳐 보세요.'))),
        h('div', { class: 'sce-catalog-counts' },
          ...counts.map(([label, count]) => h('span', {}, `${label} `, h('b', {}, String(count))))),
        h('details', { class: 'sce-catalog-details' },
          h('summary', {}, '세부 목록 펼치기'), catalogView()));
      box.appendChild(catalogSection);
      return box;
    }

    // 🔬 진단 — 굴려서 찾고, 고쳐달라기는 창작 탭 계획 상자로 이어진다
    if (!blank && topTab === 'diag') {
      box.appendChild(tabDiag());
      return box;
    }

    // 🧩 기능 카드 먼저, 자유 입력은 그 아래 — "이 중에 없으면 말로 시키세요"의 동선.
    // 빈 봇에는 안 띄운다 (얹을 대상이 없다 — 통짜 생성이나 템플릿이 먼저다).
    if (!blank) box.appendChild(featureBox());

    box.appendChild(h('div', { class: 'sce-hint' },
      blank
        ? '아직 작업본이 없어요. 원하는 내용을 입력한 뒤 [작업본 생성]을 눌러 주세요. AI가 전체 작업본을 만들어요.'
        : '바꾸고 싶은 내용을 적으면 AI가 필요한 부분만 수정해요. 적용 전에는 변경 계획을 보여드리고, 충돌이 있으면 확인을 요청해요.'));

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
          } }, '편집기에 넣기'),
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

    box.appendChild(h('div', { class: 'sce-ai-request-head' },
      h('label', { class: 'sce-field-label', for: 'sce-ai-request' }, '만들고 싶은 내용'),
      h('span', { class: 'sce-ai-request-mode' }, blank ? '새 작업본 만들기' : '현재 작업본 부분 수정')));
    const area = h('textarea', { id: 'sce-ai-request', class: 'sce-ai-request',
      placeholder: blank
        ? '예: 겨울 영지 경영 봇. 식량·민심·온기를 추적하고, 식량이 떨어지면 폭동이 일어나게'
        : '예: 산적 습격 이벤트 추가해줘. 경계가 5 이상이면 발동하고 금화를 뺏기게' });
    area.value = aiReq;
    box.appendChild(area);

    // 프리셋 칩 — 검증 오류가 있으면 그걸 고쳐달라는 요청을 한 번에 채운다
    if (!blank) {
      const v0 = validateSchema(schema);
      if (v0.errors.length) {
        box.appendChild(h('div', { class: 'sce-row' },
          h('button', { class: 'sce-btn sce-mini', onclick: () => {
            aiReq = '아래 검증 오류를 전부 고쳐줘:\n' + v0.errors.map((e) => `- ${e.path} — ${e.msg}`).join('\n');
            area.value = aiReq;
            renderCtxLine();
          } }, `🩹 검증 오류 ${v0.errors.length}건 고쳐달라고 적기`)));
      }
    }

    const aiSetup = h('div', { class: 'sce-ai-setup' },
      h('div', { class: 'sce-ai-section-label' }, '생성 설정'));
    box.appendChild(aiSetup);
    const aiSettingsGrid = h('div', { class: 'sce-ai-settings-grid' });
    aiSetup.appendChild(aiSettingsGrid);

    // 봇 컨텍스트 동봉 + 전송 크기 실측 (copyWidget이 이미 하는 것과 같은 예의)
    const ctxLine = h('div', { class: 'sce-row sce-ai-context' });
    const renderCtxLine = () => {
      ctxLine.replaceChildren();
      if (!ai || !ai.getBotContext) return;
      if (aiBotCtx === undefined) {
        ctxLine.appendChild(h('span', { class: 'sce-hint' }, '현재 캐릭터 정보 읽는 중…'));
        return;
      }
      const reconnect = () => h('button', { class: 'sce-btn sce-mini', onclick: async () => {
        aiBotCtx = undefined;
        aiBotCtxError = null;
        renderCtxLine();
        await fetchBotCtx(true);
        if (!destroyed) renderCtxLine();
      } }, '현재 캐릭터 다시 연결');
      if (aiBotCtxError) {
        ctxLine.appendChild(h('span', { class: 'sce-warn' },
          `캐릭터 정보를 읽지 못했어요 — ${aiBotCtxError}`));
        ctxLine.appendChild(reconnect());
      }
      const a = assembleBotContext(aiBotCtx);
      if (!aiBotCtxError && a.text) {
        const descBytes = byteLen(String(aiBotCtx?.desc || '').trim());
        const loreCount = (aiBotCtx?.lore || []).filter((l) => (l.content || '').trim()).length;
        const ctxCheck = h('input', { type: 'checkbox' });
        ctxCheck.checked = aiCtxOn;
        ctxCheck.onchange = () => { aiCtxOn = ctxCheck.checked; renderCtxLine(); };
        ctxLine.appendChild(h('label', { class: 'sce-ai-context-toggle' }, ctxCheck,
          h('span', {}, '현재 캐릭터 정보 포함',
            h('span', { class: 'sce-ai-context-note' },
              a.truncated ? '20KB를 넘는 내용은 생략해서 보내요.' : '설명과 로어북을 생성 요청에 함께 보내요.'))));
        const total = byteLen(buildAiRequestPrompt(schema, aiReq, aiCtxOn ? a.text : ''));
        ctxLine.appendChild(h('div', { class: 'sce-ai-context-meta' },
          h('span', {}, `캐릭터 ${(a.bytes / 1024).toFixed(1)}KB`),
          h('span', {}, descBytes || loreCount ? `설명 ${(descBytes / 1024).toFixed(1)}KB · 로어북 ${loreCount}개` : '캐릭터 이름만 포함'),
          h('span', {}, `입력 ${aiReq.trim().length.toLocaleString()}자`),
          h('span', {}, `전체 ${(total / 1024).toFixed(1)}KB`)));
      } else if (!aiBotCtxError) {
        ctxLine.appendChild(h('span', { class: 'sce-hint' },
          '현재 캐릭터에서 함께 보낼 설명이나 로어북을 찾지 못했어요. 요청 내용만 보내요.'));
        ctxLine.appendChild(reconnect());
        const total = byteLen(buildAiRequestPrompt(schema, aiReq, ''));
        ctxLine.appendChild(h('div', { class: 'sce-ai-context-meta' },
          h('span', {}, `입력 ${aiReq.trim().length.toLocaleString()}자`),
          h('span', {}, `전체 ${(total / 1024).toFixed(1)}KB`)));
      }
    };
    renderCtxLine();
    fetchBotCtx().then(() => { if (!destroyed) renderCtxLine(); });
    aiSettingsGrid.appendChild(h('div', { class: 'sce-ai-setting-card' },
      h('div', { class: 'sce-ai-setting-name' }, '전송 정보'), ctxLine));

    // 생성 모델 슬롯 — 보조는 번역·요약용 싼 모델이 꽂힌 자리라, 스키마 생성엔 급이 다른
    // 모델이 필요할 수 있다. 어느 걸로 쏠지는 유저가 고른다 (기기 로컬 저장, 어댑터 몫).
    // 줄 자체는 buildGenModelRow가 만든다 — 에셋 변환·꾸미기에서도 같은 줄을 쓴다 (v0.78).
    {
      const gmLine = buildGenModelRow(false);
      if (gmLine) {
        aiSettingsGrid.appendChild(h('div', { class: 'sce-ai-setting-card' },
          h('div', { class: 'sce-ai-setting-name' }, '모델 선택'), gmLine));
      }
    }

    if (ai && ai.generate) {
      const actionHint = h('span', { class: 'sce-ai-action-hint' });
      const generateBtn = aiGen.busy
        ? h('button', { class: 'sce-btn', onclick: () => { aiGen.seq++; aiGen.busy = false; rerender(); } }, '생성 취소')
        : h('button', { class: 'sce-btn sce-ai-primary', onclick: () => runAiGenerate() },
          blank ? '작업본 생성' : '수정안 생성');
      const refreshGenerateState = () => {
        if (aiGen.busy) {
          actionHint.textContent = '응답을 기다리고 있어요. 취소해도 현재 작업본은 바뀌지 않아요.';
          return;
        }
        const ready = !!aiReq.trim();
        generateBtn.disabled = !ready;
        generateBtn.title = ready ? '' : '만들거나 수정할 내용을 먼저 입력해 주세요.';
        actionHint.textContent = ready
          ? '입력한 요청과 위 설정으로 생성해요.'
          : '내용을 입력하면 생성 버튼이 활성화돼요.';
      };
      area.oninput = () => { aiReq = area.value; renderCtxLine(); refreshGenerateState(); };
      refreshGenerateState();
      aiSetup.appendChild(h('div', { class: 'sce-row sce-ai-action-row' },
        actionHint, generateBtn));
    } else {
      area.oninput = () => { aiReq = area.value; renderCtxLine(); };
    }
    if (aiGen.busy) {
      aiSetup.appendChild(h('div', { class: 'sce-generation-state', 'aria-live': 'polite' },
        `${blank ? '작업본' : '수정안'} 생성 중… 응답을 기다리고 있어요. 다른 탭을 봐도 결과는 여기에 남아요.`));
    } else if (aiGen.note) {
      aiSetup.appendChild(h('div', { class: 'sce-warn' }, aiGen.note));
    }
    if (aiGen.raw && !aiGen.busy) {
      const rawArea = h('textarea', { style: 'height:110px', readonly: 'readonly' });
      rawArea.value = aiGen.raw;
      aiSetup.appendChild(h('details', { class: 'sce-fold' }, h('summary', {}, 'AI가 보낸 원문 — 눌러서 펼치기'), rawArea));
    }

    // 생성 결과의 계획·적용 — ②(붙여넣기)와 같은 UI, 같은 규율
    if (patchSource === 'top') {
      const rb = patchReportBox();
      if (rb) box.appendChild(rb);
      if (patchPlan) box.appendChild(planBoxUI());
    }

    // 옆문 — API 크레딧 없이 공홈(웹 AI) 구독을 쓰는 유저의 경로. 강등이 아니라 병행 —
    // 같은 프롬프트 빌더를 쓰므로 [✨ 생성]과 내용이 똑같다.
    const aiAlt = h('div', { class: 'sce-ai-alt' },
      h('div', { class: 'sce-ai-alt-title' }, '다른 AI 사용'));
    box.appendChild(aiAlt);
    copyWidget('규격서 복사',
      '요청과 캐릭터 설정이 담긴 규격서를 복사해 다른 AI에 붙여넣어 주세요. '
      + '받은 JSON은 🧾 JSON 관리자에 넣으면 돼요 (패치는 ②, 전체 작업본은 ④).',
      () => {
        const a = aiCtxOn ? assembleBotContext(aiBotCtx) : { text: '' };
        return buildAiRequestPrompt(schema, aiReq, a.text);
      }, [], { collapsible: true }).mount(aiAlt);

    return box;
  }

  function tabJson() {
    const wrap = h('div');

    wrap.appendChild(h('section', { class: 'sce-json-intro' },
      h('div', { class: 'sce-json-intro-title' }, 'JSON을 직접 가져오거나 안전하게 부분 수정해요'),
      h('div', { class: 'sce-json-intro-copy' },
        '검사와 편집은 현재 작업본에서만 이루어져요. 캐릭터에 반영하려면 화면 위쪽의 [캐릭터에 적용]을 눌러 주세요.')));

    const paths = h('div', { class: 'sce-json-paths' });
    wrap.appendChild(paths);

    // ── AI에게 통째로 맡기는 경로 ──
    const fullPath = h('section', { class: 'sce-json-path' },
      h('div', { class: 'sce-json-path-head' },
        h('div', { class: 'sce-json-path-title' }, '전체 작업본 만들기'),
        h('span', { class: 'sce-json-path-badge' }, '처음 만들 때')),
      h('div', { class: 'sce-json-path-copy' },
        '외부 AI에 전달할 전체 스키마 규격을 만들어요. 받은 JSON은 아래 원본 편집 영역에서 불러옵니다.'));
    paths.appendChild(fullPath);
    let exampleKey = 'business';
    let withValidator = true;
    const exSelect = bindSelect(exampleKey,
      Object.entries(TEMPLATES).filter(([k]) => k !== 'blank').map(([k, t]) => [k, '예제: ' + t.label.split(' (')[0]]),
      (x) => { exampleKey = x; });
    const valCheck = bindCheck(withValidator, (x) => { withValidator = x; }, '검증기 원문 첨부 (정확도↑, 길이↑)');
    copyWidget('전체 스키마 규격 복사',
      '예제와 검증기 포함 여부를 고른 뒤 복사해 외부 AI에 전달하세요.',
      () => buildSchemaSpecPrompt(exampleKey, withValidator),
      [exSelect, valCheck],
      { collapsible: true },
    ).mount(fullPath);
    if (schemaIsBlank(schema)) {
      fullPath.appendChild(jumpRow('복사하지 않고 새 작업본을 만들 수 있어요.'));
    }

    // ── AI에게 부분 수정을 맡기는 경로 (왕복 패치) ──
    // 통짜 재생성은 안 고칠 부분까지 다시 쓰게 해서 위험하다. 여기는 바꿀 부분만 받아
    // patch.js가 병합한다 — add 충돌은 정지 후 선택, 적용은 원자적(전체 아니면 전무).
    const patchPath = h('section', { class: 'sce-json-path is-primary' },
      h('div', { class: 'sce-json-path-head' },
        h('div', { class: 'sce-json-path-title' }, '부분 수정 요청서'),
        h('span', { class: 'sce-json-path-badge' }, '기존 작업본 수정')),
      h('div', { class: 'sce-json-path-copy' },
        '현재 ID와 패치 형식을 외부 AI에 전달해 바뀌는 부분만 받아요. 기존 작업본을 수정할 때 권장합니다.'));
    paths.appendChild(patchPath);

    const jsonPatchReport = patchSource === 'json' ? patchReportBox() : null;

    copyWidget('부분 수정 규격 복사',
      '복사한 규격과 바꾸고 싶은 내용을 외부 AI에 전달한 뒤, 받은 패치를 아래 검사 영역에 붙여넣으세요.',
      () => buildPatchExportPrompt(schema),
      [], { collapsible: true },
    ).mount(patchPath);
    patchPath.appendChild(jumpRow('복사하지 않고 같은 부분 패치를 만들 수 있어요.'));

    const workspace = h('section', { class: 'sce-json-workspace' },
      h('div', { class: 'sce-json-section-head' }, h('div', {},
        h('div', { class: 'sce-json-section-title' }, '패치 붙여넣기·검사'),
        h('div', { class: 'sce-json-section-copy' },
          '검사만으로는 작업본이 바뀌지 않아요. 변경 계획과 충돌을 확인한 뒤 적용할 수 있습니다.'))));
    wrap.appendChild(workspace);
    if (jsonPatchReport) workspace.appendChild(jsonPatchReport);
    const pArea = h('textarea', { class: 'sce-json-patch-input',
      'aria-label': '검사할 패치 JSON',
      placeholder: '외부 AI가 준 패치 JSON을 붙여넣어 주세요. 코드펜스(```)가 있어도 검사할 수 있어요.' });
    pArea.value = patchText;
    workspace.appendChild(pArea);
    const patchState = h('span', { class: 'sce-json-action-state', 'aria-live': 'polite' });
    const checkBtn = h('button', { class: 'sce-btn sce-ai-primary', onclick: () => {
        const parsed = patchMod.parsePatch(patchText);
        patchPlan = parsed.ok
          ? { patch: parsed.patch, plan: patchMod.planPatch(schema, parsed.patch) }
          : { patch: null, plan: { errors: parsed.errors, warnings: [], ops: [], conflicts: [], summary: { add: 0, update: 0, remove: 0, conflicts: 0 } } };
        patchChoices = {};
        patchSource = 'json';
        rerender();
      } }, '패치 검사');
    const refreshPatchState = () => {
      const ready = !!patchText.trim();
      checkBtn.disabled = !ready;
      checkBtn.title = ready ? '' : '검사할 패치 JSON을 먼저 붙여넣어 주세요.';
      patchState.textContent = ready ? '붙여넣은 내용의 형식과 변경 범위를 확인해요.' : '패치를 붙여넣으면 검사 버튼이 활성화돼요.';
    };
    pArea.oninput = () => { patchText = pArea.value; refreshPatchState(); };
    refreshPatchState();
    workspace.appendChild(h('div', { class: 'sce-row sce-json-action-row' }, patchState, checkBtn));
    if (patchSource === 'json' && patchPlan) workspace.appendChild(planBoxUI());

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
      box.className = 'sce-block sce-patch-plan';

      const secLabel = (s) => patchMod.SECTIONS[s]?.label ?? s;
      const entryName = (e) => e.label ?? e.notify ?? e.text ?? '';
      box.appendChild(h('div', { class: 'sce-patch-head' }, h('div', {},
        h('div', { class: 'sce-patch-title' }, '변경 계획'),
        h('div', { class: 'sce-patch-copy' }, '적용 전 변경 범위와 충돌 여부를 확인해 주세요.'))));
      box.appendChild(h('div', { class: 'sce-patch-summary' },
        ...[['추가', plan.summary.add], ['교체', plan.summary.update],
          ['삭제 후보', plan.summary.remove], ['충돌', plan.summary.conflicts]]
          .map(([label, value]) => h('div', { class: 'sce-patch-metric' },
            h('span', {}, label), h('strong', {}, String(value))))));
      const body = h('div', { class: 'sce-patch-body' });
      box.appendChild(body);
      if (patch.randomEventsChance != null)
        body.appendChild(h('div', {}, `랜덤 이벤트 발동률 → ${patch.randomEventsChance}`));
      for (const w of plan.warnings) body.appendChild(h('div', { class: 'sce-warn' }, `⚠ ${w}`));

      const conflictKeys = new Set(plan.conflicts.map((c) => `${c.section}:${c.id}`));
      const changes = [];
      for (const o of plan.ops) {
        if (o.op === 'remove') continue;                       // 삭제는 아래 체크 목록에서
        if (o.op === 'add' && conflictKeys.has(`${o.section}:${o.id}`)) continue;  // 충돌은 충돌 블록에서
        const mark = o.op === 'add' ? '＋' : '✎';
        changes.push(h('div', { class: 'sce-patch-change' },
          h('span', { class: 'sce-patch-change-mark' }, mark),
          h('span', {}, `${secLabel(o.section)} ${o.id} ${entryName(o.entry)}`)));
      }
      if (changes.length) {
        body.appendChild(h('details', { class: 'sce-patch-changes', open: changes.length <= 6 ? 'open' : null },
          h('summary', {}, `변경 항목 ${changes.length}개 ${changes.length <= 6 ? '' : '펼치기'}`), ...changes));
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
        body.appendChild(h('div', { class: 'sce-row' },
          h('span', { class: 'sce-hint' }, `충돌 ${plan.conflicts.length}건 일괄:`),
          h('button', { class: 'sce-btn', onclick: () => setAll('replace') }, '전부 교체'),
          h('button', { class: 'sce-btn', onclick: () => setAll('rename') }, '전부 새 id'),
          h('button', { class: 'sce-btn', onclick: () => setAll('skip') }, '전부 건너뛰기'),
        ));
        body.appendChild(h('div', { class: 'sce-hint' },
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
        body.appendChild(h('div', { class: 'sce-block' }, row,
          h('div', { class: 'sce-hint' },
            `기존: ${exName || '(이름 없음)'} ↔ 새것: ${inName || '(이름 없음)'}`
            + (exName && inName && exName !== inName ? ' — 이름이 달라 서로 다른 항목일 가능성이 높습니다' : ''))));
      }

      // 삭제 — 기본 해제. AI가 시키지도 않은 삭제를 끼워 넣는 것을 사람 눈으로 거른다.
      const removeOps = plan.ops.filter((o) => o.op === 'remove');
      if (removeOps.length) {
        body.appendChild(h('div', { class: 'sce-hint' }, '삭제 후보 — 체크한 것만 지워집니다 (기본 해제):'));
        if (removeOps.length >= 3) {
          const setRm = (v) => {
            for (const o of removeOps) patchChoices[`rm:${o.section}:${o.id}`] = v;
            renderPlanBox();
          };
          body.appendChild(h('div', { class: 'sce-row' },
            h('button', { class: 'sce-btn', onclick: () => setRm(true) }, '전체 체크'),
            h('button', { class: 'sce-btn', onclick: () => setRm(false) }, '전체 해제'),
          ));
        }
        for (const o of removeOps) {
          const key = `rm:${o.section}:${o.id}`;
          body.appendChild(h('div', {}, bindCheck(patchChoices[key], (x) => { patchChoices[key] = x; },
            `삭제: ${secLabel(o.section)} ${o.id} ${entryName(o.previous)}`)));
        }
      }

      // 직전 적용 시도의 실패 사유 — 계획·충돌 선택 UI는 남겨서 고르고 다시 시도할 수 있게
      for (const e of (patchPlan.applyErrors || []))
        body.appendChild(h('div', { class: 'sce-err' }, `✖ ${e}`));

      box.appendChild(h('div', { class: 'sce-patch-actions' },
        h('button', { class: 'sce-btn', onclick: () => { patchPlan = null; patchChoices = {}; rerender(); } }, '취소'),
        h('button', { class: 'sce-btn sce-ai-primary', onclick: () => {
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
        } }, '패치 적용'),
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
    return h('div', { class: 'sce-block sce-patch-report' },
      h('div', { class: 'sce-ok' }, `패치 적용 완료 — ${lines.join(' · ') || '변화 없음'}`),
      ...(repWarns.length > 3
        ? [h('details', { class: 'sce-fold' },
            h('summary', { class: 'sce-warn' }, `⚠ 경고 ${repWarns.length}건 — 눌러서 펼치기`),
            ...repWarns)]
        : repWarns),
      h('div', { class: 'sce-row' },
        patchBackup ? h('button', { class: 'sce-btn', onclick: () => {
          schema = patchBackup; patchBackup = null; patchReport = null; rerender();
        } }, '적용 전으로 되돌리기') : null,
        h('button', { class: 'sce-btn', onclick: () => { patchReport = null; rerender(); } }, '확인'),
      ));
  }

  function appendJsonTail(wrap) {
    // ── 검증 실패를 되돌려주는 경로 ──
    const v = validateSchema(schema);
    const validation = h('section', { class: 'sce-json-validation' },
      h('div', { class: 'sce-json-section-head' }, h('div', {},
        h('div', { class: 'sce-json-section-title' }, '현재 작업본 검사'),
        h('div', { class: 'sce-json-section-copy' },
          '스키마 형식 오류와 경고를 확인하고, 필요하면 외부 AI에 전달할 수정 요청서를 만들어요.'))),
      h('div', { class: 'sce-json-validation-status' + (v.ok ? '' : ' is-error') },
        h('span', { class: 'sce-json-validation-mark' }, v.ok ? '✓' : '!'),
        h('div', {},
          h('div', { class: 'sce-json-validation-main' },
            v.ok ? `형식 검사를 통과했어요${v.warnings.length ? ` · 경고 ${v.warnings.length}건` : ''}`
              : `형식 오류 ${v.errors.length}건을 먼저 수정해야 해요`),
          h('div', { class: 'sce-json-validation-next' },
            v.ok
              ? '게임 동작까지 확인하려면 AI 어시스턴트의 [진단] 탭을 실행해 주세요.'
              : '아래 수정 요청서를 외부 AI에 전달하거나, AI 어시스턴트에서 오류 수정을 요청하세요.'))));
    wrap.appendChild(validation);
    const fixExport = h('div');
    validation.appendChild(fixExport);
    copyWidget(v.ok ? '검사 결과·개선 요청서 복사' : `오류 수정 요청서 복사 · ${v.errors.length}건`,
      v.ok
        ? '현재 스키마와 검사 결과를 외부 AI에 전달해 개선점을 물어볼 수 있어요.'
        : '오류 목록과 현재 스키마를 함께 복사해 외부 AI에 전달하세요.',
      () => buildFixPrompt(schema, validateSchema(schema)),
      [], { collapsible: true },
    ).mount(fixExport);
    if (!v.ok) validation.appendChild(jumpRow('복사하지 않고 검증 오류 전체를 수정 요청에 넣을 수 있어요.'));

    // ── 원본 편집 ──
    const sourceBody = h('div', { class: 'sce-json-source-body' },
      h('div', { class: 'sce-hint' },
        '전체 JSON을 직접 고치거나 외부에서 받은 작업본으로 교체할 때만 사용하세요. 불러온 뒤에도 캐릭터에는 자동 반영되지 않아요.'));
    const source = h('details', { class: 'sce-json-source',
      open: jsonImportPreview || jsonImportApplied || jsonDraftDirty ? 'open' : null },
      h('summary', {}, h('span', {}, '스키마 원본 직접 편집'), h('span', { class: 'sce-json-path-badge' }, '고급 작업')),
      sourceBody);
    wrap.appendChild(source);
    if (jsonImportApplied && jsonImportBackup) {
      sourceBody.appendChild(h('div', { class: 'sce-json-import-applied' },
        h('span', {}, '전체 JSON을 현재 작업본에 불러왔어요. 캐릭터에는 아직 반영되지 않았습니다.'),
        h('button', { class: 'sce-btn sce-mini', onclick: () => {
          schema = jsonImportBackup;
          jsonImportBackup = null;
          jsonImportApplied = false;
          jsonDraft = null;
          jsonDraftDirty = false;
          jsonImportPreview = null;
          rerender();
        } }, '이전 작업본으로 되돌리기')));
    }
    const baselineJson = JSON.stringify(schema, null, 2);
    const area = h('textarea', { id: 'sce-json', 'aria-label': '스키마 원본 JSON' });
    area.value = jsonDraft ?? baselineJson;
    sourceBody.appendChild(area);
    const sourceState = h('div', { class: 'sce-json-source-state', 'aria-live': 'polite' });
    const previewHost = h('div');
    const setDraftState = (message, cls = '') => {
      sourceState.textContent = message;
      sourceState.className = 'sce-json-source-state' + (cls ? ` ${cls}` : '');
    };
    const schemaCounts = (s) => ({
      vars: (s?.vars || []).length,
      events: (s?.rules?.events || []).length + (s?.rules?.randomEvents?.table || []).length,
      actions: (s?.actions || []).length,
      checks: (s?.checks || []).length,
      directives: (s?.directives || []).length,
    });
    const renderImportPreview = () => {
      previewHost.replaceChildren();
      if (!jsonImportPreview) return;
      const { candidate, validation } = jsonImportPreview;
      const counts = schemaCounts(candidate);
      const preview = h('div', { class: 'sce-json-import-preview' + (validation.ok ? '' : ' is-error') },
        h('div', { class: 'sce-json-import-title' }, validation.ok ? '불러오기 전 확인' : '전체 JSON을 불러올 수 없어요'),
        h('div', { class: 'sce-json-import-copy' }, validation.ok
          ? `형식 검사를 통과했어요${validation.warnings.length ? ` · 경고 ${validation.warnings.length}건` : ''}. 구성 개수를 확인한 뒤 작업본을 교체하세요.`
          : `형식 오류 ${validation.errors.length}건을 먼저 수정해 주세요. 현재 작업본은 바뀌지 않았어요.`),
        h('div', { class: 'sce-json-import-metrics' },
          ...[['변수', counts.vars], ['이벤트', counts.events], ['액션', counts.actions],
            ['판정', counts.checks], ['지시문', counts.directives]]
            .map(([label, value]) => h('div', { class: 'sce-json-import-metric' },
              h('span', {}, label), h('strong', {}, String(value))))));
      if (!validation.ok) {
        preview.appendChild(h('div', { class: 'sce-json-import-errors' },
          ...validation.errors.slice(0, 5).map((e) => h('div', {}, `${e.path} — ${e.msg}`)),
          ...(validation.errors.length > 5 ? [h('div', {}, `외 ${validation.errors.length - 5}건`)] : [])));
      }
      preview.appendChild(h('div', { class: 'sce-row' },
        h('button', { class: 'sce-btn', onclick: () => {
          jsonImportPreview = null;
          renderImportPreview();
          setDraftState('편집 중 · 아직 작업본에 불러오지 않았어요.', 'is-dirty');
        } }, '취소'),
        h('button', { class: 'sce-btn sce-ai-primary', disabled: validation.ok ? null : 'disabled',
          title: validation.ok ? '' : '형식 오류를 먼저 수정해 주세요.', onclick: () => {
            if (!validation.ok) return;
            jsonImportBackup = JSON.parse(JSON.stringify(schema));
            schema = candidate;
            jsonImportApplied = true;
            jsonDraft = null;
            jsonDraftDirty = false;
            jsonImportPreview = null;
            rerender();
          } }, '전체 작업본 교체')));
      previewHost.appendChild(preview);
    };
    area.oninput = () => {
      jsonDraft = area.value;
      jsonDraftDirty = area.value !== baselineJson;
      jsonImportPreview = null;
      renderImportPreview();
      setDraftState(jsonDraftDirty ? '편집 중 · 아직 작업본에 불러오지 않았어요.' : '현재 작업본과 같은 내용이에요.',
        jsonDraftDirty ? 'is-dirty' : '');
    };
    setDraftState(jsonDraftDirty ? '편집 중 · 아직 작업본에 불러오지 않았어요.' : '현재 작업본과 같은 내용이에요.',
      jsonDraftDirty ? 'is-dirty' : '');
    sourceBody.appendChild(h('div', { class: 'sce-row' },
      h('button', { class: 'sce-btn', onclick: () => {
        // AI가 코드펜스를 붙여 주는 일이 잦다 — 벗겨내고 파싱한다
        const raw = String(area.value).trim();
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        const src = fenced ? fenced[1] : raw;
        try {
          const candidate = JSON.parse(src);
          jsonImportPreview = { candidate, validation: validateSchema(candidate) };
          renderImportPreview();
          setDraftState('검사가 끝났어요. 아래 내용을 확인해 주세요.');
        }
        catch (e) {
          sourceState.textContent = `불러오지 못했어요 — JSON 문법을 확인해 주세요. ${e.message}`;
          sourceState.className = 'sce-json-source-state sce-err';
        }
      } }, '불러오기 전 검사'),
      h('button', { class: 'sce-btn', onclick: () => {
        area.value = baselineJson;
        jsonDraft = null;
        jsonDraftDirty = false;
        jsonImportPreview = null;
        renderImportPreview();
        sourceState.textContent = '현재 작업본의 JSON으로 되돌렸어요.';
        sourceState.className = 'sce-json-source-state sce-ok';
      } }, '현재 작업본으로 되돌리기'),
    ));
    sourceBody.appendChild(sourceState);
    sourceBody.appendChild(previewHost);
    renderImportPreview();
    return wrap;
  }

  // ── 탭: 진단 ──────────────────────────────────────────────
  // 검증기는 "형태가 맞나"만 본다. 여기서 보는 건 "게임이 되나"다 —
  // 실제로 N턴 굴려 죽은 이벤트·못 쓰는 액션·안 움직이는 수치를 찾는다.
  let diagResult = null;   // 마지막 결과 (탭을 옮겨도 유지)
  let diagPrev = null;     // 직전 회차 — "고쳤는데 왜 또 비슷하지?"에 답하려면 비교가 필요하다
  let diagTurns = 60, diagRuns = 6;

  const SEV = {
    high: ['🔴', '먼저 수정할 항목'],
    mid: ['🟡', '개선하면 좋은 항목'],
    low: ['🔵', '확인이 필요한 항목'],
  };

  function tabDiag() {
    const wrap = h('div');
    wrap.appendChild(h('section', { class: 'sce-diag-intro' },
      h('div', { class: 'sce-diag-intro-title' }, '게임이 실제로 성립하는지 여러 번 굴려 봐요'),
      h('p', {}, '문법 검사가 놓치는 죽은 이벤트, 누를 수 없는 액션, 움직이지 않는 변수와 손해가 되는 버튼을 찾습니다.'),
      h('p', {}, '변수·액션·규칙을 AI에게 맡겼다면 내보내기 전에 한 번 확인해 주세요.')));

    const turnsIn = bindInput(diagTurns, (x) => { diagTurns = Math.max(5, num(x)); }, { cls: 'sce-w-s', type: 'number' });
    const runsIn = bindInput(diagRuns, (x) => { diagRuns = Math.max(1, num(x)); }, { cls: 'sce-w-s', type: 'number' });
    const status = h('div', { class: 'sce-diag-status', 'aria-live': 'polite' }, diagResult ? '' : '아직 실행하지 않았어요.');
    const out = h('div');

    const runBtn = h('button', { class: 'sce-btn sce-ai-primary sce-diag-run', onclick: () => {
      runBtn.disabled = true;
      runBtn.setAttribute('aria-busy', 'true');
      runBtn.textContent = '진단 중…';
      turnsIn.disabled = true;
      runsIn.disabled = true;
      status.textContent = `${diagTurns}턴 × ${diagRuns}시드를 확인하고 있어요. 현재 작업본은 바뀌지 않아요.`;
      status.className = 'sce-diag-status';
      // 무거운 작업이라 버튼 눌린 게 먼저 그려지도록 한 틱 넘긴다
      setTimeout(() => {
        const t0 = Date.now();
        const before = diagResult;
        try { diagResult = diagnose(schema, { turns: diagTurns, runs: diagRuns }); }
        catch (e) {
          diagResult = before;
          runBtn.disabled = false;
          runBtn.removeAttribute('aria-busy');
          runBtn.textContent = '진단 다시 실행';
          turnsIn.disabled = false;
          runsIn.disabled = false;
          status.textContent = `진단하지 못했어요 — ${e.message}. 설정값을 확인한 뒤 다시 실행해 주세요.`;
          status.className = 'sce-diag-status sce-warn';
          return;
        }
        diagResult.stats.ms = Date.now() - t0;
        // 턴/시드가 같아야 숫자를 나란히 놓고 볼 수 있다
        diagPrev = (before?.ran && before.stats.turns === diagTurns && before.stats.runs === diagRuns) ? before : null;
        render();
      }, 0);
    } }, diagResult ? '진단 다시 실행' : '진단 실행');

    wrap.appendChild(h('div', { class: 'sce-diag-controls' },
      h('label', { class: 'sce-diag-field' }, h('span', {}, '턴 수'), turnsIn,
        h('small', {}, '한 판을 몇 턴까지 굴릴지 정해요.')),
      h('label', { class: 'sce-diag-field' }, h('span', {}, '시드 수'), runsIn,
        h('small', {}, '운에 따른 편차를 여러 번 비교해요.')),
      runBtn));
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
      if (ran) {
        out.appendChild(h('section', { class: 'sce-diag-summary' },
          h('div', { class: 'sce-diag-summary-head' },
            h('div', { class: 'sce-diag-counts' },
              h('span', { class: 'sce-diag-count' }, '수정 필요', h('strong', {}, String(stats.high))),
              h('span', { class: 'sce-diag-count' }, '개선 권장', h('strong', {}, String(stats.mid))),
              h('span', { class: 'sce-diag-count' }, '확인 필요', h('strong', {}, String(stats.low)))),
            h('span', { class: 'sce-diag-meta' }, `${stats.turns}턴 × ${stats.runs}시드`)),
          h('div', { class: 'sce-diag-summary-detail' }, line.join(' · ')),
          // 짧은 판에서 진단하면 후반부 콘텐츠가 통째로 "안 뜬 것"이 된다. 그걸 결함으로
          // 착각하지 않도록, 몇 개가 그런 경우인지 맨 위에서 미리 말해 준다.
          ...(late ? [h('div', { class: 'sce-diag-summary-detail' },
            `확인 · ${late}개는 ${stats.turns}턴이 짧아서 못 본 항목이에요. `
            + `${stats.turns * 2}턴으로 다시 돌려 후반부까지 확인해 주세요.`)] : [])));
      } else {
        out.appendChild(h('div', { class: 'sce-warn sce-diag-summary' }, '스키마 오류부터 고쳐야 진단을 실행할 수 있어요.'));
      }

      // ── 직전 회차와 비교 ──
      // "고쳐도 계속 비슷하게 나온다"는 느낌은 대개 착각이다. 실제로 뭐가 없어졌는지 보여준다.
      const cmp = compareDiagnoses(diagPrev, diagResult);
      if (cmp) {
        const sign = (n) => (n > 0 ? `+${n}` : String(n));
        const box = h('section', { class: 'sce-diag-compare' });
        box.appendChild(h('div', { class: 'sce-diag-compare-head' }, '직전 진단과 비교'));
        box.appendChild(h('div', { class: 'sce-diag-compare-grid' },
          ...[
            ['수정 필요', sign(cmp.delta.high)],
            ['개선 권장', sign(cmp.delta.mid)],
            ['확인 필요', sign(cmp.delta.low)],
            ['안 뜬 이벤트', `${sign(cmp.delta.deadEvents || 0)}종`],
          ].map(([label, value]) => h('div', { class: 'sce-diag-compare-metric' },
            h('span', {}, label), h('strong', {}, value)))));
        const detail = h('div', { class: 'sce-diag-compare-detail' });
        if (cmp.survive) {
          detail.appendChild(h('div', {},
            `방치 생존 ${cmp.survive.idle[0]} → ${cmp.survive.idle[1]}`
            + ` (평균 ${cmp.survive.idleLife[0].toFixed(0)} → ${cmp.survive.idleLife[1].toFixed(0)}턴)`
            + `  ·  플레이 생존 ${cmp.survive.play[0]} → ${cmp.survive.play[1]}`
            + ` (평균 ${cmp.survive.playLife[0].toFixed(0)} → ${cmp.survive.playLife[1].toFixed(0)}턴)`));
        }
        detail.appendChild(h('div', { class: cmp.fixed.length ? 'sce-ok' : '' },
          `해결된 항목 ${cmp.fixed.length}건`
          + (cmp.fixed.length ? `: ${cmp.fixed.slice(0, 6).map((f) => f.tag + (/'([^']+)'/.exec(f.text)?.[1] ? ` ${/'([^']+)'/.exec(f.text)[1]}` : '')).join(', ')}`
            + (cmp.fixed.length > 6 ? ` 외 ${cmp.fixed.length - 6}건` : '') : '')));
        detail.appendChild(h('div', { class: cmp.fresh.length ? 'sce-warn' : '' },
          `새로 발견된 항목 ${cmp.fresh.length}건`
          + (cmp.fresh.length ? `: ${cmp.fresh.slice(0, 6).map((f) => f.tag + (/'([^']+)'/.exec(f.text)?.[1] ? ` ${/'([^']+)'/.exec(f.text)[1]}` : '')).join(', ')}` : '')));
        detail.appendChild(h('div', {},
          `남아 있는 항목 ${cmp.stayed.length}건`
          + (cmp.stayed.length ? ' — 아래 목록의 확인할 점을 보고 수정 위치를 찾아 주세요.' : '')));
        box.appendChild(detail);
        out.appendChild(box);
      }

      if (ran && !findings.length) {
        out.appendChild(h('div', { class: 'sce-diag-clear' },
          h('strong', {}, '이번 진단에서는 문제가 발견되지 않았어요.'),
          h('span', {}, '내보내기 전에 실제 채팅에서도 주요 이벤트와 액션이 의도대로 작동하는지 한 번 확인해 주세요.')));
      }
      for (const sev of ['high', 'mid', 'low']) {
        const group = findings.filter((f) => f.sev === sev);
        if (!group.length) continue;
        const [icon, label] = SEV[sev];
        const section = h('section', { class: `sce-diag-group sce-diag-group-${sev}` },
          h('div', { class: 'sce-diag-group-head' }, icon, label,
            h('span', { class: 'sce-diag-group-count' }, `${group.length}건`)));
        const grid = h('div', { class: 'sce-diag-findings' });
        for (const f of group) {
          const parts = String(f.text || '').split(/\s+—\s+/);
          const finding = parts.shift() || '';
          const next = parts.join(' — ');
          grid.appendChild(h('article', { class: 'sce-diag-finding' },
            h('span', { class: 'sce-tag' }, f.tag),
            h('div', { class: 'sce-diag-finding-main' }, finding),
            ...(next ? [h('div', { class: 'sce-diag-finding-next' },
              h('span', {}, '확인할 점'), next)] : [])));
        }
        if (sev === 'low' && group.length > 4) {
          section.appendChild(h('details', { class: 'sce-diag-group-fold' },
            h('summary', {}, `${group.length}개 항목 펼쳐보기`), grid));
        } else {
          section.appendChild(grid);
        }
        out.appendChild(section);
      }

      // ── 진단 결과를 그대로 AI에게 넘기기 ──
      // 탭별로 나눠 보내는 게 핵심이다. 한꺼번에 고치라고 하면 변수를 지어내면서 전부 어긋난다.
      if (ran && findings.length) {
        // 권장 경로 — 패치 (v0.45). 통 교체는 항목 100개짜리 봇에서 AI가 하나만 빠뜨려도 그게 삭제다.
        const fixable = findings.filter((f) => f.sev !== 'low');
        const aiSection = h('section', { class: 'sce-diag-ai' },
          h('div', { class: 'sce-diag-ai-head' },
            h('div', { class: 'sce-diag-ai-title' }, '진단 결과 수정'),
            h('div', { class: 'sce-diag-ai-copy' },
              `수정 필요·개선 권장 ${fixable.length}건만 대상으로 삼아요. 확인 필요 항목은 자동 수정에서 제외합니다.`)));
        const moreBody = h('div', { class: 'sce-diag-ai-more-body' });
        const more = h('details', { class: 'sce-diag-ai-more', open: (!ai || !ai.generate) ? 'open' : null },
          h('summary', {}, '외부 AI와 전체 재작성 옵션'), moreBody);
        out.appendChild(aiSection);

        // 직결 경로 (v0.47) — 복사 왕복 없이 그 자리에서 생성. 계획·충돌 확인은 똑같이 거친다.
        if (fixable.length && ai && ai.generate) {
          aiSection.appendChild(h('div', { class: 'sce-diag-ai-primary' },
            h('div', { class: 'sce-diag-ai-primary-text' },
              h('div', { class: 'sce-diag-ai-primary-title' }, '부분 패치 만들기'),
              h('div', { class: 'sce-diag-ai-primary-copy' },
                '현재 생성 모델이 필요한 부분만 수정해요. 완성되면 창작 탭에서 변경 계획을 확인합니다.')),
            h('button', { class: 'sce-btn sce-ai-primary', onclick: () => runAiGenerate({ findings, stats: diagResult.stats }) },
              `패치 만들기 · ${fixable.length}건`)));
        }

        if (fixable.length) {
          moreBody.appendChild(h('div', { class: 'sce-diag-ai-subhead' }, '외부 AI로 부분 수정'));
          const patchExport = h('section', { class: 'sce-diag-ai-export-card is-primary' });
          copyWidget(`수정 패치 규격서 복사 · ${fixable.length}건${fixable.filter((f) => f.sev === 'high').length ? ` / 우선 ${fixable.filter((f) => f.sev === 'high').length}건` : ''}`,
            '다른 AI에 전달할 부분 수정 규격서예요. 받은 패치 JSON은 JSON 관리자의 [패치 검사]에서 확인한 뒤 적용하세요.',
            () => buildPatchExportPrompt(schema, { findings, stats: diagResult.stats }),
            [], { collapsible: true },
          ).mount(patchExport);
          moreBody.appendChild(patchExport);
        }

        const byTab = {};
        for (const f of findings) if (f.tab && f.sev !== 'low') (byTab[f.tab] = byTab[f.tab] || []).push(f);
        let anyBtn = false;
        const tabExportGrid = h('div', { class: 'sce-diag-ai-export-grid' });
        for (const key of Object.keys(TAB_SLICES)) {
          const group = byTab[key];
          if (!group?.length) continue;
          anyBtn = true;
          const hi = group.filter((f) => f.sev === 'high').length;
          const tabExport = h('section', { class: 'sce-diag-ai-export-card' });
          copyWidget(`${TAB_SLICES[key].label} 탭 전체 요청서 · ${group.length}건${hi ? ` / 우선 ${hi}건` : ''}`,
            `${TAB_SLICES[key].label} 탭의 관련 항목 ${group.length}건을 반영한 전체 재작성 요청서예요. `
              + '기존 항목이 빠질 수 있으므로 전면 재작성할 때만 사용하세요.',
            () => buildTabExportPrompt(schema, key, { findings, stats: diagResult.stats }),
            [], { collapsible: true },
          ).mount(tabExport);
          tabExportGrid.appendChild(tabExport);
        }
        if (anyBtn) {
          const rewriteBody = h('div', { class: 'sce-diag-rewrite-body' },
            h('div', { class: 'sce-diag-ai-warning' },
              '탭 전체를 다시 만드는 요청서예요. 빠진 항목은 삭제될 수 있으므로 일반적인 수정에는 위의 부분 패치를 이용해 주세요.'),
            tabExportGrid);
          moreBody.appendChild(h('details', { class: 'sce-diag-rewrite' },
            h('summary', {}, `탭 전체 재작성 · ${Object.keys(byTab).filter((key) => byTab[key]?.length).length}개 탭`),
            rewriteBody));
        }

        const orphan = findings.filter((f) => !f.tab || !TAB_SLICES[f.tab]);
        if (orphan.length) {
          moreBody.appendChild(h('details', { class: 'sce-diag-orphan' },
            h('summary', {}, `직접 확인할 항목 · ${orphan.length}건`),
            h('div', {}, '자동 수정 대상이 아니거나 특정 탭에만 묶을 수 없는 항목이에요. 해당 종류: '
              + [...new Set(orphan.map((f) => f.tag))].join(', '))));
        }
        if (!anyBtn) moreBody.appendChild(h('div', { class: 'sce-hint' }, '탭 전체 요청서로 만들 항목은 없어요.'));

        moreBody.appendChild(h('div', { class: 'sce-diag-ai-subhead' }, '기록용'));
        const textExport = h('section', { class: 'sce-diag-ai-export-card' });
        copyWidget('진단 내용 복사',
          '진단 내용을 사람이 읽는 글로 복사해요. 기록하거나 공유할 때 사용하세요.',
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
          [], { collapsible: true },
        ).mount(textExport);
        moreBody.appendChild(textExport);
        aiSection.appendChild(more);
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
      assetNote = '이 환경에서는 에셋 목록을 읽을 수 없어요. 팩의 어휘를 직접 입력해 주세요.';
      rerender(); return null;
    }
    try {
      // 출처 구성까지 주는 훅이 있으면 그걸로 — "왜 0개인가"를 말할 수 있다 (v0.54.4)
      if (ai.getAssetSources) {
        const r = await ai.getAssetSources();
        const names = [...new Set((r.sources || []).flatMap((s) => s.names.map(String)))];
        // 모듈 읽기는 기본으로 꺼져 있다 (v0.83 — db 접근이 느려 편집기가 몇 초씩 멈췄다).
        // 껐다는 사실을 여기서 말하지 않으면 "에셋이 0개다"가 결함처럼 보인다.
        const moduleHint = r.moduleOff
          ? ' 모듈 에셋은 읽지 않았어요 — 이미지가 모듈에 있는 봇이면 리수 플러그인 설정에서 module_assets를 on으로 바꾸세요.'
          : '';
        if (!names.length) {
          assetNote = r.dbErr
            ? `에셋을 읽지 못했어요 — 모듈 접근 실패: ${r.dbErr}. Risu 권한 창에서 DB 접근을 허용한 뒤 다시 시도해 주세요.`
            : `캐릭터에서 추가 에셋을 찾지 못했어요.${moduleHint || ' 해당 모듈이 현재 봇이나 채팅에서 활성화됐는지 확인해 주세요.'}`;
          rerender(); return null;
        }
        assetNames = names;
        assetNote = '읽음: ' + (r.sources || []).map((s) => `${s.label} ${s.names.length}개`).join(' + ')
          + (r.dbErr ? ` ⚠ 모듈 접근 실패: ${r.dbErr}` : '') + moduleHint;
        return assetNames;
      }
      const names = await ai.getAssetNames();
      if (!names || !names.length) {
        assetNote = '캐릭터와 활성 모듈에서 추가 에셋을 읽지 못했어요. 에셋 유무와 현재 Risu의 접근 권한을 확인해 주세요.';
        rerender(); return null;
      }
      assetNames = names.map(String);
      return assetNames;
    } catch (e) { assetNote = '에셋 목록을 읽지 못했어요 — ' + e.message + '. 권한을 확인한 뒤 다시 시도해 주세요.'; rerender(); return null; }
  }

  function assetsFloor() {
    const box = h('div', { class: 'sce-assets' });
    box.appendChild(h('section', { class: 'sce-assets-intro' },
      h('div', { class: 'sce-assets-intro-title' }, '이미지 이름을 팩으로 묶어 자동으로 불러와요'),
      h('div', { class: 'sce-assets-intro-copy' },
        '인물·감정 같은 칸만 정하면 시스템이 실제 에셋 이름을 조합하고, 없는 이미지는 폴백으로 처리해요. 팩이 없으면 기능은 꺼진 상태로 유지됩니다.')));

    const a = schema.assets;
    // 에셋 전용 설치 (v0.64) — 변수를 하나도 안 만들어도 설치되고 돈다.
    // 이 안내가 없으면 "변수 탭이 비었는데 괜찮은 건가"에서 손이 멈춘다 (실제 문의).
    if (!schema.vars.length) {
      const packed = !!(a && a.packs && a.packs.length);
      box.appendChild(h('div', { class: `sce-assets-note${packed ? ' is-ok' : ''}` },
        packed
          ? '✅ 변수 없이 에셋만 쓰는 봇이에요. 이대로 저장하면 됩니다. 상태창·명령·시간은 뜨지 않고 이미지만 붙어요. '
            + '나중에 상태창이 필요해지면 그때 변수 탭에서 만들면 됩니다.'
          : '변수를 하나도 만들지 않아도 돼요. 팩을 하나 만들면 에셋 전용 봇으로 그대로 설치됩니다.'));
    }
    const controls = h('section', { class: 'sce-assets-controls' });
    box.appendChild(controls);
    if (a && a.packs && a.packs.length) {
      controls.appendChild(h('div', { class: 'sce-assets-mode' },
        pair('삽입 주체', bindSelect(a.by ?? 'aux', [
          ['aux', '보조 모델 · 첫 위치에 1장 (권장)'],
          ['aux_flow', '보조 모델 · 서사 위치에 여러 장'],
          ['main', '메인 모델 · 매 턴 지침 전송'],
        ], (x) => { if (x === 'aux') delete a.by; else a.by = x; rerender(); }),
        '보조 모델 경로는 실존 대조와 폴백을 사용해요. 서사 위치 방식은 인용할 문장을 찾지 못하면 해당 이미지를 생략합니다.')));
    } else {
      controls.appendChild(h('div', { class: 'sce-assets-mode' },
        h('div', { class: 'sce-hint', style: 'margin:0' }, '아직 활성화된 팩이 없어요. 자동 감지하거나 빈 팩을 추가해 시작하세요.')));
    }

    const tools = h('div', { class: 'sce-row sce-assets-tools' });
    tools.appendChild(h('button', { class: 'sce-btn', onclick: async () => {
      assetNote = null;
      const names = await loadAssetNames();
      if (!names) return;
      const det = detectSlotsFromNames(names);
      if (!det) { assetNote = `에셋 이름 ${names.length}개에서 공통 구분자를 찾지 못했어요. 빈 팩을 추가해 칸을 직접 설정해 주세요.`; rerender(); return; }
      const A = ensureAssets();
      A.packs.push(packDraftFromDetect(det, 'pack' + (A.packs.length + 1)));
      assetNote = `구분자 '${det.sep}' 기준 ${det.covered}/${det.total}개 이름에서 칸 ${det.cols.length}개 감지 — ` +
        '출력 태그(format)는 봇의 표시 규약에 맞게 꼭 손볼 것.';
      rerender();
    } }, '에셋에서 자동 감지'));
    tools.appendChild(h('button', { class: 'sce-btn', onclick: async () => {
      assetNote = null;
      if (await loadAssetNames()) rerender();
    } }, '에셋 목록 새로고침'));
    controls.appendChild(tools);
    if (assetNote) {
      const isOk = /^(읽음|구분자)/.test(assetNote);
      controls.appendChild(h('div', { class: 'sce-assets-note' + (isOk ? ' is-ok' : ''), 'aria-live': 'polite' }, assetNote));
    }
    if (assetNames) controls.appendChild(h('div', { class: 'sce-assets-count' },
      `실제 에셋 ${assetNames.length}개를 읽었어요. 각 팩 아래에서 조합 커버리지를 확인할 수 있습니다.`));

    // 매 턴 비용 추정 — 이 기능이 뭘 아끼는지 숫자로. 기준선은 예전 방식(assetlist 통짜 덤프)
    if (a && a.packs && a.packs.length) {
      const cost = estAssetCost(schema, assetNames);
      let saving = null;
      if (cost.baseline != null) {
        const now = cost.main + cost.aux;
        if (now < cost.baseline) saving = Math.round((1 - now / cost.baseline) * 100);
      }
      box.appendChild(h('section', { class: 'sce-assets-cost' },
        ...[['메인 프롬프트', `+${cost.main} tok`], ['보조 호출', `+${cost.aux} tok`],
          ['예상 절감', saving != null ? `약 ${saving}%` : '목록 확인 필요']]
          .map(([label, value]) => h('div', { class: 'sce-assets-cost-item' },
            h('span', {}, label), h('strong', {}, value))),
        h('div', { class: 'sce-assets-cost-note' },
          '매 턴 비용 추정치로 약 ±30% 오차가 있어요. 조건이 닫힌 팩의 어휘는 해당 턴에 전송되지 않습니다.')));
    }

    const packs = (a && a.packs) || [];
    const nameSet = assetNames ? new Set(assetNames) : null;
    const assetValidation = validateSchema(schema);
    const assetField = (label, control) => h('label', { class: 'sce-asset-field' },
      h('span', {}, label), control);
    const issueLabel = (path, packIndex) => {
      const rest = String(path || '').replace(`$.assets.packs[${packIndex}]`, '');
      const slot = /^\.slots\[(\d+)\](?:\.([^.]+))?/.exec(rest);
      if (slot) {
        const names = { id: 'ID', label: '표시명', values: '어휘', fallback: '폴백' };
        return `칸 ${Number(slot[1]) + 1}${slot[2] ? ` ${names[slot[2]] || slot[2]}` : ''}`;
      }
      const key = /^\.([^.]+)/.exec(rest)?.[1];
      return ({ id: '팩 ID', format: '출력 태그', source: '출처', when: '게이트', chars: '고정 인물' })[key] || '팩 설정';
    };
    box.appendChild(h('div', { class: 'sce-assets-list-head' },
      h('div', { class: 'sce-assets-list-title' }, '팩 편집'),
      h('div', { class: 'sce-assets-list-count' }, `${packs.length}개`)));
    const packList = h('div', { class: 'sce-assets-list' });
    box.appendChild(packList);
    packs.forEach((p, i) => {
      const card = h('section', { class: 'sce-asset-pack' });
      card.appendChild(h('div', { class: 'sce-asset-pack-head' },
        h('div', {},
          h('div', { class: 'sce-asset-pack-title' }, p.id || `팩 ${i + 1}`),
          h('div', { class: 'sce-asset-pack-sub' }, `${(p.slots || []).length}개 칸 · ${p.enabled === false ? '꺼짐' : '사용 중'}`)),
        grip(packs, i, rerender)));
      const settings = h('div', { class: 'sce-asset-pack-settings' });
      card.appendChild(settings);
      settings.appendChild(h('div', { class: 'sce-asset-pack-core' },
        h('div', { class: 'sce-asset-toggle' },
          bindCheck(p.enabled !== false, (x) => { if (x) delete p.enabled; else p.enabled = false; rerender(); }, '이 팩 사용')),
        assetField('팩 ID', bindInput(p.id, (x) => { p.id = x.trim(); rerender(); },
          { cls: 'sce-w-l', ph: '예: mansion' })),
        assetField('출처', bindInput(p.source, (x) => { p.source = x || undefined; rerender(); },
          { cls: 'sce-w-l', ph: '모듈 또는 봇 이름' }))));
      settings.appendChild(h('div', { class: 'sce-asset-pack-layout' },
        assetField('이름 구분자', bindInput(p.sep ?? '_', (x) => {
          if (x === '_' || x === '') delete p.sep; else p.sep = x; rerender();
        }, { cls: 'sce-w-l', ph: '_' })),
        assetField('출력 태그', bindInput(p.format, (x) => { p.format = x; rerender(); },
          { cls: 'sce-w-l', ph: '<img="{name}">' }))));
      settings.appendChild(h('div', { class: 'sce-asset-pack-options' },
        assetField('게이트 조건', bindInput(p.when, (x) => { p.when = x || undefined; rerender(); },
          { cls: 'sce-w-l', ph: '선택 · 예: nsfw_on' })),
        assetField('고정 인물', bindInput((p.chars || []).join(', '), (x) => {
          const v = x.split(',').map((s) => s.trim()).filter(Boolean);
          if (v.length) p.chars = v; else delete p.chars; rerender();
        }, { cls: 'sce-w-l', ph: '선택 · 쉼표로 구분' })),
        h('div', { class: 'sce-asset-toggle' },
          bindCheck(p.verify !== false, (x) => { if (x) delete p.verify; else p.verify = false; rerender(); }, '실제 파일과 대조'))));
      card.appendChild(h('div', { class: 'sce-asset-slots-head' },
        h('div', { class: 'sce-asset-slots-title' }, `칸 설정 · ${(p.slots || []).length}개`),
        h('span', { class: 'sce-hint', style: 'margin:0' }, 'ID · 표시명 · 어휘 · 폴백')));
      (p.slots || []).forEach((s, j) => {
        card.appendChild(h('div', { class: 'sce-asset-slot' },
          h('div', { class: 'sce-asset-slot-main' },
            assetField('칸 ID', bindInput(s.id, (x) => { s.id = x.trim(); rerender(); },
              { cls: 'sce-w-l', ph: '예: who, emo' })),
            assetField('표시명', bindInput(s.label, (x) => { s.label = x || undefined; rerender(); },
              { cls: 'sce-w-l', ph: '예: 인물, 감정' })),
            assetField('어휘', bindInput((s.values || []).join(', '), (x) => {
              s.values = x.split(',').map((t) => t.trim()).filter(Boolean); rerender();
            }, { cls: 'sce-w-l', ph: '예: angry, smile, neutral · 쉼표로 구분' }))),
          h('div', { class: 'sce-asset-slot-options' },
            h('div', { class: 'sce-asset-toggle' },
              bindCheck(!!s.optional, (x) => { if (x) s.optional = true; else delete s.optional; rerender(); }, '이 칸 생략 가능')),
            assetField('없을 때 사용할 폴백', bindInput(s.fallback, (x) => {
              s.fallback = x || undefined; rerender();
            }, { cls: 'sce-w-l', ph: '예: neutral' })),
            grip(p.slots, j, rerender)),
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
      const status = h('div', { class: 'sce-asset-pack-status' });
      if (prevName) status.appendChild(h('div', {}, `예시 출력 · ${renderTag(p, prevName, first)}`));

      const cov = packCoverage(p, nameSet);
      if (cov.skipped) {
        status.appendChild(h('div', {},
          `대조 제외 — 조합 ${cov.combos}개를 검사 없이 신뢰한다. 에셋이 모듈에 살아서 이름 목록을 못 읽는 환경용 ` +
          '(어휘가 지침 그대로면 안전하지만, 오타 조합은 깨진 이미지로 나간다).'));
      } else if (cov.exist != null) {
        // 실질 구멍 = 정조합도 없고 폴백 사다리도 못 받는 조합. 이것만 ⚠의 근거가 된다 —
        // 폴백이 받아주는 빠짐은 스파스 매트릭스의 정상 모습이다.
        const holes = cov.combos - cov.exist - cov.rescued;
        let line = `실존 대조: 필수 조합 ${cov.combos}개 중 ${cov.exist}개 실존`;
        if (cov.rescued) line += `, 빠진 ${cov.combos - cov.exist}개 중 ${cov.rescued}개는 폴백 구제`;
        if (holes > 0) line += ` — 실질 구멍 ${holes}개 (예: ${cov.missing.join(', ')}${holes > cov.missing.length ? ' …' : ''})`;
        status.appendChild(h('div', { class: holes === 0 ? 'sce-ok' : 'sce-warn' },
          (holes === 0 ? '✓ ' : '⚠ ') + line));
        if (holes > 0 && !cov.rescued && (p.slots || []).every((s) => s.fallback == null))
          status.appendChild(h('div', {},
            '폴백이 하나도 없다 — 감정 칸에 "어떤 조합으로도 실존하는 값"을 폴백으로 주면 구멍 대부분이 구제된다.'));
      } else if (cov.capped) {
        status.appendChild(h('div', { class: 'sce-warn' },
          `⚠ 필수 조합이 ${cov.combos}개 — 너무 많아 대조를 생략했다 (어휘를 줄이거나 칸을 생략 가능으로)`));
      } else if (!nameSet) {
        status.appendChild(h('div', {},
          `필수 조합 ${cov.combos}개 — [에셋 목록 새로고침]을 누르면 실제 파일과 대조할 수 있어요.`));
      }
      if (status.childNodes.length) card.appendChild(status);
      const prefix = `$.assets.packs[${i}]`;
      const packErrors = assetValidation.errors.filter((e) => String(e.path || '').startsWith(prefix));
      const packWarnings = assetValidation.warnings.filter((e) => String(e.path || '').startsWith(prefix));
      if (packErrors.length || packWarnings.length) {
        const issues = h('div', { class: 'sce-asset-issues' });
        for (const e of packErrors) issues.appendChild(h('div', { class: 'sce-asset-issue' },
          h('strong', {}, issueLabel(e.path, i)), h('span', {}, e.msg)));
        for (const e of packWarnings) issues.appendChild(h('div', { class: 'sce-asset-issue is-warning' },
          h('strong', {}, issueLabel(e.path, i)), h('span', {}, e.msg)));
        card.appendChild(issues);
      }
      packList.appendChild(card);
    });
    if (!packs.length) packList.appendChild(h('div', { class: 'sce-assets-empty' },
      '아직 에셋 팩이 없어요. 위의 자동 감지를 사용하거나 빈 팩을 추가해 직접 설정하세요.'));
    box.appendChild(addBtn('빈 팩 추가', () => {
      const A = ensureAssets();
      A.packs.push({ id: 'pack' + (A.packs.length + 1), format: '<img="{name}">',
        slots: [{ id: 'who', label: '인물', values: [] }, { id: 'emo', label: '감정', values: [] }] });
      rerender();
    }));

    const otherErrors = assetValidation.errors.filter((e) => !String(e.path || '').startsWith('$.assets'));
    const otherWarnings = assetValidation.warnings.filter((e) => !String(e.path || '').startsWith('$.assets'));
    if (otherErrors.length || otherWarnings.length) {
      const otherBody = h('div', { class: 'sce-assets-other-issues-body' });
      for (const e of otherErrors) otherBody.appendChild(h('div', {}, `오류 · ${e.path} — ${e.msg}`));
      for (const e of otherWarnings) otherBody.appendChild(h('div', {}, `확인 · ${e.path} — ${e.msg}`));
      box.appendChild(h('details', { class: 'sce-assets-other-issues' },
        h('summary', {}, `에셋 팩 외 작업본 문제 · ${otherErrors.length + otherWarnings.length}건`), otherBody));
    }

    // 임포터 — 모듈 배포문(키워드 목록 + 삽입 문법)을 팩 선언으로
    const importBody = h('div', { class: 'sce-assets-import-body' },
      h('div', { class: 'sce-hint' },
        '기존 모듈이나 봇의 이미지 지침을 붙여넣으면 팩 선언으로 변환해요. 형식 검사를 통과한 결과만 현재 작업본에 추가됩니다.'));
    const importer = h('details', { class: 'sce-assets-import' },
      h('summary', {}, '기존 이미지 지침에서 팩 가져오기'), importBody);
    box.appendChild(importer);
    const ta = bindArea(assetImportText, (x) => { assetImportText = x; }, '여기에 지침 원문 붙여넣기…');
    importBody.appendChild(ta);
    if (ai && ai.generate) {
      // 변환도 ai.generate를 탄다 = 생성 모델 설정을 그대로 따른다. 고르는 자리를 여기에도
      // 둔다 — 없으면 "에셋 변환은 무조건 보조 모델"로 보인다 (실기 제보, v0.78)
      const gmLine = buildGenModelRow(true);
      if (gmLine) importBody.appendChild(gmLine);
      const importHint = h('span', { class: 'sce-hint', style: 'margin:0' });
      const importBtn = h('button', { class: 'sce-btn sce-ai-primary',
        'aria-busy': assetBusy ? 'true' : 'false', onclick: async () => {
          if (assetBusy) return;
          assetImportText = ta.value;
          if (!assetImportText.trim()) { assetImportNote = '변환할 이미지 지침을 먼저 붙여넣어 주세요.'; rerender(); return; }
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
        } }, assetBusy ? '변환 중…' : '팩으로 변환');
      const refreshImportState = () => {
        const ready = !!ta.value.trim();
        importBtn.disabled = assetBusy || !ready;
        importBtn.title = ready ? '' : '변환할 이미지 지침을 먼저 붙여넣어 주세요.';
        importHint.textContent = assetBusy
          ? '응답을 기다리고 있어요. 현재 팩은 바뀌지 않습니다.'
          : ready ? '변환 결과는 검사 후 한 번에 추가돼요.' : '이미지 지침을 붙여넣으면 변환 버튼이 활성화돼요.';
      };
      ta.oninput = () => { assetImportText = ta.value; refreshImportState(); };
      refreshImportState();
      importBody.appendChild(h('div', { class: 'sce-row' }, importBtn, importHint));
    } else {
      copyWidget('변환 요청서 복사', '외부 AI에 전달한 뒤 받은 packs JSON을 원본 편집에서 확인해 주세요.',
        () => buildPackImportPrompt(ta.value), [], { collapsible: true }).mount(importBody);
    }
    // 임포터 결과/실패 사유는 버튼 바로 아래 — 층 위쪽의 안내(assetNote)와 섞이면 못 알아챈다
    if (assetImportNote) importBody.appendChild(h('div', {
      class: 'sce-assets-import-state ' + (assetImportNote.startsWith('팩 ') ? 'sce-ok' : 'sce-warn'),
      'aria-live': 'polite' }, assetImportNote));
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

  // 심층 편집 몸통 — 폭 상한을 **여기 한 곳에서** 건다.
  // 블록마다 숫자를 박던 방식이라 820·960·1040·680이 섞여 한 탭 안에서 오른쪽 끝이
  // 네 군데로 갈라져 있었다 (실측 제보). 새 블록이 늘어도 이 상자를 못 넘어간다.
  function deepBody() {
    const body = { vars: tabVars, commands: tabCommands, status: tabStatus, party: tabParty, calendar: tabCalendar, rules: tabRules, actions: tabActions,
      checks: tabChecks, time: tabTime, setup: tabSetup, ai: tabAi }[activeTab]();
    return h('div', { class: 'sce-deep-body' }, body);
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
      h('summary', {}, '🧾 JSON 관리자 — 통짜 생성 · 패치 · 오류 돌려주기 · 원본'),
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

    // 탭 바·본문·오류줄을 한 기둥에 넣는다. 폭 상한은 본문이 아니라 **이 기둥**에 걸린다 —
    // 본문만 좁히면 탭 바 밑줄이 혼자 패널 끝까지 가서 탭마다 오른쪽이 어긋나 보인다 (실측 제보).
    const lower = h('details', { class: 'sce-lower' },
      h('summary', {}, `🧰 직접 만지기 — 세부 편집 탭${v.ok ? '' : ` (✗ 오류 ${v.errors.length})`}`),
      h('div', { class: 'sce-deep' }, deepTabs(), deepBody(), reportEl));
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

module.exports = { createSchemaEditor, schemaIsBlank, detectSlotsFromNames, packDraftFromDetect, packCoverage, buildPackImportPrompt, estTokens, estAssetCost };
