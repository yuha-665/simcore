// 상태창 렌더 (auto 모드) + 커스텀 CSS 스코핑
// 산출물은 리스 표시 파이프라인(DOMPurify)을 통과하므로 표준 태그 + 인라인/클래스 스타일만 사용.

const { makeLookup, renderTemplate, quoteSafe, commandSpecs: engineCommandSpecs, findChoiceEvent } = require('./engine');
const { evaluate, truthy } = require('./expr');
const { exposedDefs } = require('./time');
const { scenarioConfig, currentActIndex } = require('./scenario');
const { fightChipHtml } = require('./fight'); // 전투 안무 칩 (v1.6.0) — 교전 중일 때만 그려진다

// 내장 테마 — .sim-status 하위 오버라이드
const THEMES = {
  clean: '',
  parchment: `
.sim-status{background:rgba(233,221,196,.09);border-color:#8a6d3b66}
.sim-status summary{color:#c9a86a}
.sim-bar-fill{background:#a8865a}
.sim-badge{background:#8a6d3b33}
.sim-action{border-color:#8a6d3b88}
.sim-action.sim-armed{border-color:#c9a86a;background:#8a6d3b33}`,
  terminal: `
.sim-status{background:#04110a;border-color:#1f5c3d;font-family:ui-monospace,monospace}
.sim-status summary{color:#4ade80}
.sim-value,.sim-label{color:#86efac}
.sim-bar{background:#14351f}
.sim-bar-fill{background:#22c55e}
.sim-badge{background:#14351f;color:#86efac}
.sim-action{border-color:#1f5c3d;color:#86efac}
.sim-action.sim-armed{border-color:#22c55e;background:#14351f}`,
  card: `
.sim-status{background:rgba(91,141,239,.06);border:none;box-shadow:0 2px 12px rgba(0,0,0,.25);border-radius:14px}
.sim-group{background:rgba(128,128,128,.08);border-radius:10px;padding:8px 10px}
.sim-bar-fill{background:linear-gradient(90deg,#5b8def,#8b5bef)}`,
};

/** 상태창용 전체 CSS (기본 + 테마 + 스코프된 커스텀) — 메시지 내 <style> 자체 포함용 */
function buildStatusCss(schema) {
  const ui = schema?.statusUI || {};
  const theme = THEMES[ui.theme] ?? '';
  let custom = ui.customCSS ? scopeCss(ui.customCSS) : '';
  if (ui.mode === 'template') {
    if (ui.template) {
      const embedded = extractTemplateParts(ui.template).css;
      if (embedded.trim()) custom += '\n' + scopeCss(embedded);
    }
    // 여기서 state를 볼 수 없으니 어느 템플릿이 뜰지 모른다 → 전부 싣되, 각자 자기 id 껍데기에 가둔다.
    // 그래서 두 템플릿이 `.status-modal-window`를 똑같이 정의해도 서로를 덮어쓰지 않는다.
    for (const t of (ui.templates || [])) {
      if (!t?.template) continue;
      const embedded = extractTemplateParts(t.template).css;
      if (!embedded.trim()) continue;
      custom += '\n' + (t.id ? scopeCss(embedded, `.sim-status .sim-tpl-${t.id}`) : scopeCss(embedded));
    }
  }
  return BASE_CSS + layoutCss(ui) + theme + '\n' + custom;
}

const BASE_CSS = `
.sim-status{border:1px solid rgba(128,128,128,.35);border-radius:10px;padding:10px 12px;margin-top:10px;font-size:.92em;line-height:1.5}
.sim-status summary{cursor:pointer;font-weight:600;opacity:.85}
.sim-group{margin-top:8px}
.sim-group-label{font-weight:600;opacity:.7;font-size:.85em;margin-bottom:4px}
.sim-row{display:flex;align-items:center;gap:8px;margin:3px 0}
.sim-label{min-width:5.5em;opacity:.75}
.sim-value{font-variant-numeric:tabular-nums}
.sim-bar{display:block;flex:1;height:8px;border-radius:4px;background:rgba(128,128,128,.25);overflow:hidden;min-width:60px}
.sim-bar-fill{display:block;height:100%;border-radius:4px;background:#5b8def;transition:width .3s}
.sim-badge{display:inline-block;padding:1px 8px;border-radius:8px;background:rgba(128,128,128,.2);font-size:.85em}
.sim-tags{display:flex;flex-wrap:wrap;gap:4px;flex:1;justify-content:flex-end}
.sim-tag{display:inline-block;padding:1px 8px;border-radius:8px;background:rgba(128,128,128,.18);border:1px solid rgba(128,128,128,.25);font-size:.83em}
.sim-empty{opacity:.45;font-size:.85em}
.sim-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
.sim-choices{margin-top:8px;padding:7px 10px;border:1px solid rgba(200,160,80,.5);border-radius:7px}
.sim-choices-title{font-weight:700;font-size:.88em;opacity:.85;margin-bottom:4px}
.sim-choices-desc{font-size:.84em;opacity:.75;margin-bottom:5px}
.sim-choice{padding:2px 0;font-size:.92em}
.sim-choice.sim-locked{opacity:.45}
.sim-choices-hint{margin-top:4px;font-size:.8em;opacity:.6}
.sim-scn{display:inline-flex;align-items:baseline;gap:6px;padding:2px 10px;border-radius:8px;background:rgba(128,128,128,.16);border:1px solid rgba(128,128,128,.22);font-size:.86em}
.sim-scn-prog{opacity:.55;font-size:.9em}
.sim-cards{display:flex;flex-direction:column;gap:5px;margin-bottom:7px}
.sim-card{padding:7px 11px;border:1px solid rgba(128,128,160,.35);border-left:3px solid rgba(128,140,220,.9);border-radius:8px;font-size:.93em;line-height:1.45}
.sim-card.good{border-left-color:rgba(80,180,120,.95)}
.sim-card.bad{border-left-color:rgba(200,80,80,.95)}
.sim-card .d-up{color:#5fb87d;font-weight:700}
.sim-card .d-down{color:#d16a6a;font-weight:700}
.sim-card-now{opacity:.6;font-size:.88em}
.sim-card-more{opacity:.55;font-size:.85em;border-left-color:rgba(128,128,160,.4)}
.sim-actlocked{display:block;width:100%;margin-top:4px}
.sim-actlocked summary{cursor:pointer;font-size:.8em;opacity:.55;user-select:none}
.sim-actlocked[open] summary{margin-bottom:3px}
/* 클릭 조작(v0.42) — 어댑터가 좌표 히트테스트로 이 클래스가 붙은 자리를 진짜 버튼으로 만든다.
   mainDom 권한이 없으면 그냥 표시용 범례다 (기존 동작 그대로) */
.sim-hit{cursor:pointer}
.sim-hit:hover{filter:brightness(1.25)}
.sim-action-hint{flex-basis:100%;font-size:.78em;opacity:.55;margin-bottom:1px}
.sim-action{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.4);font-size:.88em;background:transparent}
.sim-action-glyph{font-size:1.15em;line-height:1}
.sim-action-state{font-size:.85em;opacity:.7}
.sim-action.sim-armed{border-color:#5b8def;background:rgba(91,141,239,.15);font-weight:600}
.sim-action.sim-disabled{opacity:.45}
.sim-log{margin-top:8px;font-size:.82em;opacity:.7}
.sim-log-item{margin:1px 0;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}
.sim-log-name{font-weight:600}
.sim-log-diff.plus{color:#3fb950;font-weight:600}
.sim-log-diff.minus{color:#f85149;font-weight:600}
.sim-log-reason{margin-left:auto;opacity:.75;text-align:right}
.sim-log-open{opacity:.92}
.sim-log-open .sim-log-item{padding:3px 0;border-bottom:1px solid rgba(128,128,128,.15)}
.sim-log-open .sim-log-item:last-child{border-bottom:0}
.sim-cmds{margin-top:10px;border-top:1px solid rgba(128,128,128,.25);padding-top:7px;font-size:.9em}
.sim-cmds-open{cursor:pointer;opacity:.75;font-size:.88em;font-weight:600;list-style:none}
.sim-cmds-hint{opacity:.6;font-size:.82em;margin:5px 0 7px}
.sim-cmds-body{display:flex;flex-direction:column;gap:7px}
.sim-cmd-name{font-size:.8em;opacity:.6;margin-bottom:2px}
.sim-cmd-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin:1px 0}
/* 배경을 칠했으면 글자색도 반드시 같이 정한다. 안 그러면 바깥 테마가 넣은 색과 겹쳐 글자가 사라진다.
   inherit이라 밝은 장부든 어두운 밀서든 그 상태창의 본문 색을 그대로 따라간다. */
.sim-cmd-syntax{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;color:inherit;
  padding:1px 7px;border-radius:6px;background:rgba(128,128,128,.16);border:1px solid rgba(128,128,128,.22);white-space:nowrap}
.sim-cmd-why{opacity:.6;font-size:.82em}

/* ── 배치(statusUI.layout) ── 전부 JS 없이 CSS만으로 전환된다.
   메시지 안 버튼은 리스가 클릭 이벤트의 target을 잘라내서 스크립트로는 못 받는다.
   ⚠ 숨김 라디오는 display:none이어야 한다. position:absolute 0×0으로 숨기면 라벨 클릭 때
   브라우저가 라디오에 포커스를 주며 scrollIntoView를 하는데, 리수의 overflow:hidden 앱
   컨테이너까지 스크롤시켜 화면 전체가 밀리고(아래는 검은 여백) 유저는 되돌릴 수도 없다.
   display:none이면 포커스 자체가 불가능하고, 라벨의 체크 전달과 형제 선택자는 그대로 동작한다. */
.sim-tabin{display:none}
.sim-tabbar{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 7px;border-bottom:1px solid rgba(128,128,128,.28)}
.sim-tab{cursor:pointer;padding:4px 11px;margin-bottom:-1px;border:1px solid transparent;border-bottom:none;
  border-radius:8px 8px 0 0;font-size:.88em;font-weight:600;opacity:.55}
.sim-panel{display:none}
/* 자리별 :checked 규칙은 그룹 수만큼 layoutCss()가 찍어 낸다 */
.sim-acc{margin-top:6px;border:1px solid rgba(128,128,128,.22);border-radius:8px;padding:5px 9px}
.sim-acc>summary{font-weight:600;opacity:.75;font-size:.88em}
.sim-pops{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.sim-pop{position:relative;outline:none}
.sim-pop-btn{display:inline-block;cursor:pointer;padding:3px 11px;border-radius:8px;
  border:1px solid rgba(128,128,128,.4);font-size:.88em;font-weight:600}
.sim-pop:focus-within .sim-pop-btn{background:rgba(128,128,128,.18)}
/* 팝업은 본문 위로 떠서 뒤가 비치면 안 된다 → 배경을 칠하고 글자색도 같이 정한다.
   Canvas/CanvasText는 시스템 색이라 밝은 테마·어두운 테마를 스스로 따라간다.
   봇 CSS에서 --sim-pop-bg / --sim-pop-fg로 덮어쓸 수 있다. */
.sim-pop-body{display:none;position:absolute;z-index:5;top:calc(100% + 5px);left:0;
  min-width:min(17em,72vw);max-width:min(24em,88vw);max-height:50vh;overflow:auto;
  padding:9px 11px;border:1px solid rgba(128,128,128,.4);border-radius:10px;
  background:var(--sim-pop-bg,Canvas);color:var(--sim-pop-fg,CanvasText);box-shadow:0 6px 22px rgba(0,0,0,.34)}
.sim-pop:focus-within .sim-pop-body{display:block}
`;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 라벨에서 대표 글리프 하나를 뽑는다.
 * 리스의 플로팅 버튼은 아이콘 칸이 한 칸으로 고정돼 있고 style/class가 제거돼 넓힐 수가 없다.
 * 두 글자를 넣으면 둘째 글자가 버튼 밖으로 흘러나오므로 무조건 한 칸으로 줄여야 한다.
 * 상태창 범례도 같은 글리프를 써야 짝이 맞으므로 여기(공용 모듈)에 둔다.
 * 정규식 유니코드 속성(\p{...})은 구형 엔진에서 파싱 단계에 터져 파일 전체를 죽일 수 있어 코드포인트를 직접 본다.
 */
/** 그림문자(이모지·기호)인가 — 라벨이 아이콘으로 시작하는지 판정용 */
function isPictograph(ch) {
  const c = String(ch ?? '').codePointAt(0);
  if (c === undefined) return false;
  return (c >= 0x1f000 && c <= 0x1faff) || (c >= 0x2600 && c <= 0x27bf)
    || (c >= 0x2b00 && c <= 0x2bff) || (c >= 0x2190 && c <= 0x21ff)
    || (c >= 0x23f0 && c <= 0x23ff) || c === 0x203c || c === 0x2049;
}

function actionGlyph(label) {
  const s = String(label ?? '').trim();
  if (!s) return '•';
  const chars = [...s];
  const isRegional = (ch) => {
    const c = ch.codePointAt(0);
    return c >= 0x1f1e6 && c <= 0x1f1ff;
  };
  // 국기는 지역표시자 두 개가 모여 한 글자다 (🇰 + 🇷 = 🇰🇷) — 반쪽만 남기면 빈 네모가 뜬다
  if (isRegional(chars[0]) && chars[1] && isRegional(chars[1])) return chars[0] + chars[1];
  // 뒤따르는 결합 문자를 흡수한다: 변이 선택자(⚙️), 키캡(1️⃣), ZWJ 조합(🧑‍🍳).
  // 이모지가 아니면 결합 문자가 따라오지 않으므로 자연히 첫 글자 하나만 남는다.
  let out = chars[0], i = 1;
  while (i < chars.length) {
    const c = chars[i];
    if (c === '️' || c === '︎' || c === '⃣') { out += c; i += 1; continue; }
    if (c === '‍' && chars[i + 1] !== undefined) { out += c + chars[i + 1]; i += 2; continue; }
    break;
  }
  return out;
}

/**
 * 상태창 HTML 생성
 * @param changeLog outputPhase의 changeLog (변화 로그 표시용, null 가능)
 * @param actionStates [{id,label,armed,disabled,reason}] (액션 버튼, null이면 생략)
 */
/**
 * 상태창의 {commands} 자리에 들어가는 명령 모음집.
 *
 * 여기 두는 이유: 명령 이름은 제작자가 정하는데 유저가 그걸 알 곳이 없었다.
 * 패널에 넣는 건 답이 안 된다 — 배포받은 유저가 패널을 안 여는 게 애초에 채팅 명령을 만든 이유다.
 * 그래서 유저가 늘 보는 화면에 두되, **자리와 노출 여부는 제작자가 정한다**(자리표시자를 안 박으면 안 나온다).
 */
/**
 * 걸려 있는 갈림길의 선택지 목록. 번호는 배열 순서 그대로라 어느 메시지의 상태창에서 봐도 같다.
 * 조건(when)이 거짓인 항목은 🔒로 잠가 두되 번호는 유지한다 — 번호가 밀리면 지난 메시지와 어긋난다.
 * (상태창 안 버튼은 리스가 클릭 target을 잘라 구조적으로 못 쓴다 — 그래서 /선택 채팅 명령이 통로다)
 */
function choicesHtml(schema, state) {
  const pc = state.meta?.pendingChoice;
  if (!pc) return '';
  const ev = findChoiceEvent(schema, pc.id);
  if (!ev) return '';
  const lookup = makeLookup(schema, state.vars);
  let out = '<div class="sim-choices"><div class="sim-choices-title">⌛ 선택의 순간</div>';
  // 무엇에 대한 선택인지 — 발동 순간의 notify를 다시 보여준다. 알림은 그 턴에 흘러가 버려서
  // 다음 메시지의 선택 블록만 보면 맥락이 없었다 (실기 제보: 빚 얘긴 줄 알았는데 일감 제안이었다)
  if (ev.notify) out += `<div class="sim-choices-desc">${esc(String(ev.notify))}</div>`;
  ev.choices.forEach((c, i) => {
    let locked = false;
    if (c.when) { try { locked = !truthy(evaluate(c.when, lookup, null)); } catch { locked = true; } }
    // 잠긴 항목에는 히트 클래스를 안 붙인다 — 눌러도 안 되는 걸 버튼처럼 보이게 하지 않는다
    const hit = locked ? '' : ` sim-hit sim-hitchoice-${i}`;
    out += `<div class="sim-choice${locked ? ' sim-locked' : ''}${hit}">${i + 1}. ${esc(String(c.label ?? ''))}${locked ? ' 🔒' : ''}</div>`;
  });
  out += '<div class="sim-choices-hint">눌러서 고르거나, 채팅에 /선택 번호 (예: /선택 1)'
    + (ev.timeout != null ? ` · ${ev.timeout}턴 안에 안 고르면 마지막 항목으로 흘러간다` : '') + '</div></div>';
  return out;
}

/**
 * 히트 클래스 해독 — 어댑터의 좌표 히트테스트가 명중한 요소에서 "무슨 버튼인지"를 읽는다.
 * 메시지 파이프라인은 class에 x-risu- 접두를 붙이므로 붙었든 안 붙었든(조작줄) 다 잡는다.
 */
function decodeHitClass(className) {
  const s = String(className ?? '');
  let m = s.match(/(?:^|\s)(?:x-risu-)?sim-hitact-([A-Za-z_][A-Za-z0-9_]*)/);
  if (m) return { kind: 'action', id: m[1] };
  m = s.match(/(?:^|\s)(?:x-risu-)?sim-hitchoice-(\d+)/);
  if (m) return { kind: 'choice', idx: Number(m[1]) };
  m = s.match(/(?:^|\s)(?:x-risu-)?sim-hitsug-(\d+)/); // 다음 행동 제안 칩 (v0.43, 조작줄 전용)
  if (m) return { kind: 'suggest', idx: Number(m[1]) };
  return null;
}

function commandsHtml(schema) {
  const specs = engineCommandSpecs(schema);
  if (!specs.length) return '';
  const rows = specs.map((s) => {
    const lines = s.usage.map(([syntax, why]) =>
      // ⚠ <code>를 쓰면 안 된다. 상태창은 리스의 메시지 렌더를 타므로 마크다운/테마 CSS가
      //   code에 자기 색을 먹인다 — 여기서 배경만 칠해 두면 글자색이 그쪽 것이 되어
      //   배경과 같은 색으로 겹쳐 통째로 안 보인다(실제로 그렇게 났다). span은 그 규칙에 안 걸린다.
      `<div class="sim-cmd-line"><span class="sim-cmd-syntax">${esc(syntax)}</span>`
      + `<span class="sim-cmd-why">${esc(why)}</span></div>`).join('');
    return `<div class="sim-cmd"><div class="sim-cmd-name">${esc(s.label)}</div>${lines}</div>`;
  }).join('');
  return `<details class="sim-cmds"><summary class="sim-cmds-open">⌨ 채팅창에 칠 수 있는 명령 ${specs.length}가지</summary>`
    + `<div class="sim-cmds-hint">서사가 알아서 반영합니다. 아래는 <b>AI가 잘못 넣었을 때 직접 고치는</b> 용도예요.</div>`
    + `<div class="sim-cmds-body">${rows}</div></details>`;
}

/**
 * 시나리오 진행 칩 (v0.93) — 현재 막 라벨 + 진행(i/N막)만. direct·secret은 절대 안 실린다 —
 * 상태창은 유저 눈이고, 은닉 보장(scenario §3-1)은 여기서도 지켜져야 한다.
 * 템플릿 모드에선 {scenario} 자리에, 자동 구성(그룹) 모드에선 상태창 맨 위에 자동으로 선다.
 * 대장(패널) 탭에도 같은 자리표시자로 나온다 — 그쪽은 sim-* CSS가 없어 맨글자로 뜨지만
 * 패널 템플릿은 어차피 <style>을 품으므로 .sim-scn을 제 손으로 입히면 된다.
 */
function scenarioChipHtml(schema, vars) {
  const cfg = scenarioConfig(schema);
  if (!cfg) return '';
  const idx = currentActIndex(cfg, vars);
  const act = cfg.acts[idx];
  return `<span class="sim-scn">📖 ${cfg.label ? esc(cfg.label) + ' · ' : ''}<b>${esc(act.label || act.id)}</b>`
    + ` <span class="sim-scn-prog">${idx + 1}/${cfg.acts.length}막</span></span>`;
}

/**
 * 하이라이트 카드 — 이번 턴의 체감 나는 변화만 골라 게임 알림처럼 세운다 (v0.86.4).
 * 전체 영수증(이번 턴 변화)과 역할이 다르다: 로그는 빠짐없이·접혀서, 카드는 골라서·세워서.
 * 규칙: 판정은 무조건 카드 / 숫자는 합산 델타(0이면 생략) / 목록은 넣고 뺀 것 /
 *       enum·text는 A → B / bool은 안 세운다 (대부분 시스템 깃발이라 소음이다).
 * 출처는 액션·판정·이벤트·랜덤·보조 AI만 — onTurn 틱·시간 소비는 매 턴 있는 배경이다.
 * statusUI.highlights: 'off' 로 끌 수 있다.
 */
function highlightCards(schema, changeLog, varById) {
  if (schema.statusUI?.highlights === 'off') return '';
  if (!changeLog || !changeLog.length) return '';
  const keep = changeLog.filter((c) => c.source === 'llm' || c.source?.startsWith('action:')
    || c.source?.startsWith('check:') || c.source?.startsWith('event:')
    || c.source?.startsWith('random:') || c.source?.startsWith('choice')
    || c.source?.startsWith('scenario:'));
  if (!keep.length) return '';
  const cards = [];
  // 막 전환 — 이야기가 다음 막으로 넘어간 순간은 이번 턴의 머리기사다 (§6 미결 3: notify는
  // AI쪽 통지라 유저 눈에 안 보였다 — 유저에게 보이는 답이 이 카드다). 엔진이 전환 때
  // 원장에 남긴 의사 항목(id=시나리오 라벨, 변수 아님)을 여기서 세운다. onEnter 효과는
  // 변수 항목이라 아래 일반 경로(📊·🎒)로 자연히 흐른다.
  for (const c of keep) {
    if (!c.source?.startsWith('scenario:') || varById[c.id]) continue;
    cards.push(`<div class="sim-card">📖 <b>${esc(String(c.id))}</b> ${esc(String(c.from ?? ''))} → <b>${esc(String(c.to ?? ''))}</b></div>`);
  }
  // 판정 요약줄 — 성패가 색을 정한다 (성공 계열 초록 / 실패 계열 붉음).
  // ⚠ 등급 효과의 변수 변화도 source가 check:라서, "요약줄 = id가 변수가 아닌 것"으로 가른다
  const isCheckSummary = (c) => c.source?.startsWith('check:') && !varById[c.id];
  for (const c of keep) {
    if (!isCheckSummary(c)) continue;
    const txt = String(c.to ?? '');
    const tone = /대실패|실패|사고|헛|거절/.test(txt) ? ' bad' : (/성공|만석|전설|수확|노다지|발견|합류/.test(txt) ? ' good' : '');
    cards.push(`<div class="sim-card${tone}">🎲 <b>${esc(String(c.id))}</b> ${esc(txt)}</div>`);
  }
  // 변수 — 같은 변수를 여러 효과가 만졌으면 처음→끝으로 합쳐 하나의 카드로
  const byVar = new Map();
  for (const c of keep) {
    if (isCheckSummary(c)) continue;
    const def = varById[c.id];
    if (!def || def.type === 'bool') continue;
    const prev = byVar.get(c.id);
    if (prev) prev.to = c.to;
    else byVar.set(c.id, { id: c.id, from: c.from, to: c.to, def });
  }
  // 우선순위 — 소지품·돈이 멤버별 잔카드에 밀려 상한 밖으로 떨어지지 않게:
  // 소지품(1) → 돈(2) → 상태 전환(3) → 나머지 숫자(4). 같은 순위끼리는 일어난 순서.
  const varCards = [];
  for (const { id, from, to, def } of byVar.values()) {
    const label = esc(def.label ?? id);
    if (Array.isArray(from) || Array.isArray(to)) {
      const fa = Array.isArray(from) ? from : []; const ta = Array.isArray(to) ? to : [];
      const added = ta.filter((x) => !fa.includes(x));
      const removed = fa.filter((x) => !ta.includes(x));
      if (!added.length && !removed.length) continue;
      const bits = [...added.map((x) => `<span class="d-up">+${esc(String(x))}</span>`),
        ...removed.map((x) => `<span class="d-down">−${esc(String(x))}</span>`)];
      varCards.push({ pri: 1, html: `<div class="sim-card">🎒 <b>${label}</b> ${bits.join(' ')}</div>` });
    } else if (typeof to === 'number' || typeof from === 'number') {
      const d = (Number(to) || 0) - (Number(from) || 0);
      if (!d) continue;
      const fmt = (v) => def.format ? def.format.replace('{v}', fmtNum(Math.abs(v))) : fmtNum(Math.abs(v));
      const money = /만원|골드|G\b|원/.test(String(def.format ?? ''));
      varCards.push({ pri: money ? 2 : 4, html: `<div class="sim-card">${money ? '💰' : '📊'} <b>${label}</b> `
        + `<span class="${d > 0 ? 'd-up' : 'd-down'}">${d > 0 ? '+' : '−'}${fmt(d)}</span>`
        + ` <span class="sim-card-now">(현재 ${esc(def.format ? def.format.replace('{v}', fmtNum(to)) : fmtNum(to))})</span></div>` });
    } else if (String(from) !== String(to)) {
      varCards.push({ pri: 3, html: `<div class="sim-card">🔔 <b>${label}</b> ${esc(String(from))} → <b>${esc(String(to))}</b></div>` });
    }
  }
  varCards.sort((a, b) => a.pri - b.pri);
  cards.push(...varCards.map((c) => c.html));
  if (!cards.length) return '';
  const MAX = 8;
  const shown = cards.slice(0, MAX);
  const more = cards.length > MAX ? `<div class="sim-card sim-card-more">…외 ${cards.length - MAX}건 — 아래 '이번 턴 변화'에서</div>` : '';
  return `<div class="sim-cards">${shown.join('')}${more}</div>`;
}

function renderStatusHtml(schema, state, changeLog = null, actionStates = null, opts = {}) {
  const ui = schema.statusUI || {};
  const lookup = makeLookup(schema, state.vars);
  // uid — 이 상태창이 그려진 메시지를 가리키는 꼬리표. 템플릿에서 {uid}로 쓴다.
  // 라디오/체크박스로 탭을 짤 때 id·name에 반드시 섞어야 메시지끼리 안 엉킨다.
  const uid = String(opts.uid ?? 'x').replace(/[^A-Za-z0-9_-]/g, '') || 'x';
  // {lastcheck} = 마지막 판정 한 줄 (예: "근력 판정: 14 + 2 = 16 vs 13 → 성공"). 판정 전에는 빈 문자열.
  const lc = state.meta?.lastCheck;
  const extras = { commands: commandsHtml(schema), uid,
    lastcheck: lc ? esc(`${lc.label}: ${lc.summary}`) : '',
    choices: choicesHtml(schema, state),
    scenario: scenarioChipHtml(schema, state.vars),
    fight: fightChipHtml(state.vars, esc) };   // {fight} = 교전 게이지 칩 (교전 없으면 빈 문자열)
  // 파생 변수 + 시간 노출 파생(날짜·시각·요일…)도 포함 (표시 이름·포맷 조회용)
  const varById = Object.fromEntries(
    [...schema.vars, ...(schema.derived || []), ...exposedDefs(schema)].map((v) => [v.id, v]));

  let inner = '';

  if (ui.mode === 'template' && (ui.template || (ui.templates || []).length)) {
    // 조건부 템플릿: 조건이 참인 첫 번째 것만 그린다 (한 봇에 두 가지 플레이가 있을 때).
    // 그린 것을 자기 id 클래스로 감싸는 게 핵심 — 두 템플릿이 똑같은 클래스명을 써도
    // CSS가 각자 자기 껍데기 안으로 갇혀서 서로를 덮어쓰지 않는다.
    const pick = pickTemplate(ui, lookup);
    if (pick) {
      const html = renderTemplate(extractTemplateParts(pick.template).html, lookup, extras, quoteSafe);
      inner = pick.id ? `<div class="sim-tpl-${esc(pick.id)}">${html}</div>` : html;
    }
  } else {
    const panes = [];
    for (const g of ui.groups || []) {
      const visibility = g.visibility ?? 'show'; // 'show' | 'collapsed' | 'hidden'
      if (visibility === 'hidden') continue; // 내부관리용 — 채팅 상태창에서 제외 (패널에서만)
      if (g.showWhen && !truthy(evalSafe(g.showWhen, lookup) ?? 0)) continue; // 조건부 그룹
      let rows = '';
      for (const it of g.items || []) {
        if (it.showWhen && !truthy(evalSafe(it.showWhen, lookup) ?? 0)) continue; // 조건부 항목
        const def = varById[it.var];
        const val = lookup(it.var);
        if (val === undefined) continue;
        const label = esc(it.label || def?.label || it.var); // 빈 문자열 라벨은 id로 폴백
        let valueHtml;
        if (def?.type === 'list' || Array.isArray(val)) {
          const items = Array.isArray(val) ? val : [];
          valueHtml = items.length
            ? `<span class="sim-tags">${items.map((x) => `<span class="sim-tag">${esc(x)}</span>`).join('')}</span>`
            : `<span class="sim-empty">비어 있음</span>`;
        } else if (def?.type === 'bool') {
          valueHtml = `<span class="sim-badge">${truthy(val) ? 'ON' : 'OFF'}</span>`;
        } else if (def?.type === 'enum' || def?.type === 'text' || typeof val === 'string') {
          valueHtml = `<span class="sim-badge">${esc(val)}</span>`;
        } else {
          const fmt = def?.format ? def.format.replace('{v}', fmtNum(val)) : fmtNum(val);
          valueHtml = `<span class="sim-value">${esc(fmt)}</span>`;
        }
        let barHtml = '';
        if (it.bar) {
          const max = Math.max(1, numOr(evalSafe(String(it.bar.max ?? 100), lookup), 100));
          const pct = Math.max(0, Math.min(100, (numOr(val, 0) / max) * 100));
          let color = '';
          if (it.color) {
            const c = evalSafe(it.color, lookup);
            if (typeof c === 'string') color = `;background:${esc(c)}`;
          }
          barHtml = `<span class="sim-bar"><span class="sim-bar-fill" style="width:${pct.toFixed(1)}%${color}"></span></span>`;
        }
        rows += `<div class="sim-row"><span class="sim-label">${label}</span>${barHtml}${valueHtml}</div>`;
      }
      panes.push({ label: g.label ?? `그룹 ${panes.length + 1}`, rows, collapsed: visibility === 'collapsed' });
    }
    // 그룹 모드는 배치를 플러그인이 정한다 — 자리표시자를 박을 데가 없으니 여기서 붙인다.
    // (템플릿 모드는 반대다: 제작자가 {scenario}/{commands}/{choices}를 박은 자리에만 나온다)
    if (extras.scenario) inner += `<div>${extras.scenario}</div>`; // 이야기 진행은 머리에
    if (extras.fight) inner += `<div>${extras.fight}</div>`;       // 교전 게이지도 머리에 (v1.6.0)
    inner += layoutGroups(panes, ui.layout ?? 'stack', extras.uid);
    inner += extras.choices;
    inner += extras.commands;
  }

  // 액션 범례 — v0.55부터 이게 액션의 정면이다 (우상단 플로팅 버튼은 게임 패널에 자리를 내줬다).
  // 클릭 조작(v0.42, mainDom)이 켜져 있으면 여기가 진짜 버튼이고,
  // 꺼져 있으면 표시용 범례 + /액션 명령이 토글을 맡는다.
  // (메시지 안의 <button>은 리스가 클릭 이벤트의 target을 잘라내 구조적으로 동작하지 않는다 —
  //  그래서 버튼 태그가 아니라 좌표 히트테스트다)
  if (actionStates && actionStates.length) {
    const actionChip = (a) => {
      // 클릭 조작(v0.42): 잠긴 액션은 히트 없음 — 눌러도 잠김 안내만 나올 자리라 아예 비활성
      const hit = a.disabled ? '' : ` sim-hit sim-hitact-${a.id}`;
      const cls = ['sim-action', a.armed ? 'sim-armed' : '', a.disabled ? 'sim-disabled' : ''].filter(Boolean).join(' ') + hit;
      const title = a.disabled && a.reason ? ` title="${esc(a.reason)}"` : '';
      // 라벨이 이모지로 시작하면 그게 곧 버튼 아이콘이다 → 배지로 떼어내고 본문에서는 지운다.
      // (안 지우면 '🔥 🔥 화로 최대'처럼 두 번 나온다)
      const lead = actionGlyph(a.label);
      const hasIcon = isPictograph(lead);
      const text = hasIcon ? (String(a.label).trim().slice(lead.length).trim() || a.label) : String(a.label);
      // 이모지가 없는 라벨은 버튼에 첫 글자가 뜬다. 그건 라벨 앞글자와 같으므로
      // 배지를 또 달면 '휴 휴식'이 된다 — 상태 표시가 있을 때만 배지를 붙인다.
      const badge = a.disabled ? '🔒' : (a.armed ? '✅' : (hasIcon ? lead : ''));
      const tail = a.armed ? ' <span class="sim-action-state">발동 대기</span>'
        : (a.disabled && a.reason ? ` <span class="sim-action-state">${esc(a.reason)}</span>` : '');
      return `<span class="${cls}"${title}>`
        + (badge ? `<span class="sim-action-glyph">${esc(badge)}</span>` : '')
        + `${esc(text)}${tail}</span>`;
    };
    // 지금 누를 수 있는 것만 펼치고, 잠긴 것은 접는다 (v0.86.2) — 액션이 60개가 되자
    // 잠금 사유가 벽지가 됐다 (실기 제보: 모바일 지옥). 해금 조건은 "다음 목표"라는
    // 가치가 있으므로 지우지 않고 접힌 상자 안에 그대로 남긴다.
    const open = actionStates.filter((a) => !a.disabled);
    const locked = actionStates.filter((a) => a.disabled);
    inner += `<div class="sim-actions">`;
    inner += `<span class="sim-action-hint">눌러서 무장 (안 눌리면 /액션 이름 으로도 된다)</span>`;
    for (const a of open) inner += actionChip(a);
    if (locked.length) {
      inner += `<details class="sim-actlocked"><summary>🔒 잠긴 액션 ${locked.length}개 — 해금 조건 보기</summary>`
        + locked.map(actionChip).join('') + `</details>`;
    }
    inner += `</div>`;
  }

  // 변화 로그 — statusUI.changeLog: 'collapsed'(기본, 접힘) | 'open'(영수증처럼 펼침) | 'off'(숨김).
  // 내용은 엔진 changeLog에서 그려지므로 "실제로 커밋된 변화"의 영수증이다 — 상한에 잘렸으면
  // 잘린 값이 찍힌다. 모델이 직접 쓰는 텍스트 영수증(주장)과 출처가 반대라는 게 이 칸의 가치.
  const logMode = ['open', 'collapsed', 'off'].includes(schema.statusUI?.changeLog)
    ? schema.statusUI.changeLog : 'collapsed';
  if (logMode !== 'off' && changeLog && changeLog.length) {
    const items = changeLog
      .filter((c) => c.source === 'llm' || c.source?.startsWith('event:') || c.source?.startsWith('random:')
        || c.source?.startsWith('action:') || c.source?.startsWith('check:') || c.source?.startsWith('scenario:')
        || c.source?.startsWith('fight:'))
      .map((c) => {
        // 교전 줄 (v1.6.0) — 개전·결착·이탈은 굴림 결과와 같은 꼴 (from 없음, to = 요약). win effects의 변수 변화는 아래 diff로
        if (c.source?.startsWith('fight:') && c.from == null && typeof c.to === 'string') {
          return `<div class="sim-log-item">⚔ ${esc(String(c.to))}</div>`;
        }
        // 판정 줄 — 변수 변화가 아니라 굴림 결과라 diff 형식이 안 맞는다 (id = 판정 라벨, to = 요약)
        if (c.source?.startsWith('check:')) {
          return `<div class="sim-log-item">🎲 ${esc(String(c.id))} ${esc(String(c.to))}</div>`;
        }
        const def = varById[c.id];
        const name = def?.label ?? c.id;
        let diff;
        let tone = ''; // 숫자 델타만 색을 얻는다 — 텍스트 교체·목록 증감 혼합에 색을 칠하면 거짓말이 된다
        if (typeof c.to === 'number' && typeof c.from === 'number') {
          const d = c.to - c.from;
          diff = `${d > 0 ? '+' : ''}${fmtNum(d)}`;
          tone = d > 0 ? ' plus' : d < 0 ? ' minus' : '';
        } else if (Array.isArray(c.to) || Array.isArray(c.from)) {
          const fromArr = Array.isArray(c.from) ? c.from : [];
          const toArr = Array.isArray(c.to) ? c.to : [];
          const counted = (arr) => arr.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
          const fc = counted(fromArr), tc = counted(toArr);
          const parts = [];
          for (const k of new Set([...fromArr, ...toArr])) {
            const d = (tc[k] || 0) - (fc[k] || 0);
            if (d > 0) parts.push(`+${esc(k)}${d > 1 ? '×' + d : ''}`);
            if (d < 0) parts.push(`-${esc(k)}${d < -1 ? '×' + -d : ''}`);
          }
          diff = parts.join(', ') || '변화 없음';
        } else {
          diff = `${esc(String(c.from))} → ${esc(String(c.to))}`;
        }
        return `<div class="sim-log-item"><span class="sim-log-name">${esc(name)}</span>`
          + `<span class="sim-log-diff${tone}">${diff}</span>`
          + (c.reason ? `<span class="sim-log-reason">${esc(c.reason)}</span>` : '')
          + '</div>';
      }).join('');
    if (items) {
      inner += logMode === 'open'
        ? `<details class="sim-log sim-log-open" open><summary>이번 턴 변화</summary>${items}</details>`
        : `<details class="sim-log"><summary>이번 턴 변화</summary>${items}</details>`;
    }
  }

  // 에셋만 쓰는 봇(변수 0개) — 그릴 것이 하나도 없으면 빈 상자도 만들지 않는다.
  // 변수가 있는 봇에서 조건 때문에 잠깐 비는 것과는 다르다. 그쪽은 상자가 남아 있어야
  // 다음 턴에 값이 돌아왔을 때 같은 자리에서 이어진다.
  if (!inner && !schema.vars.length) return '';

  const title = esc(schema.meta?.name ?? '상태');
  const body = ui.collapsible !== false
    ? `<details open><summary>${title}</summary>${inner}</details>`
    : inner;
  // 하이라이트 카드 (v0.86.4) — 접힌 상자 **바깥**, 상태창 맨 위. 이번 턴의 체감 나는
  // 변화(판정 성패·돈·소지품·스탯)를 게임 알림처럼 세운다. 실기 제보: 변화가 전부
  // 접힌 로그 속에 있어서 "플레이가 남긴 흔적"이 채팅에서 안 보였다.
  const cards = highlightCards(schema, changeLog, varById);
  const styleTag = opts.includeStyle ? `<style>${buildStatusCss(schema)}</style>` : '';
  // id에 uid를 섞는다 (규칙 #4) — 어댑터가 패널 조작 직후 이 손잡이로 상태창을 찾아
  // 제자리 갱신한다 (v0.85.4). 새니타이저 허용 속성이 id뿐이라 data-*는 못 쓴다.
  return `${styleTag}<div class="sim-status" id="simst-${uid}">${cards}${body}</div>`;
}

/**
 * 커스텀 CSS를 .sim-status 하위로 강제 스코핑.
 * 주석 제거 후 중괄호 단위로 파싱 — @keyframes 내부(from/to/%)는 스코핑하지 않고,
 * @media/@supports/@container는 통과시키되 내부 셀렉터는 스코핑한다.
 */
function scopeCss(css, prefix = '.sim-status') {
  css = String(css).replace(/\/\*[\s\S]*?\*\//g, ''); // 주석 제거
  const scopeSel = (sel) => sel.split(',').map((s) => {
    s = s.trim();
    if (!s) return s;
    if (s.startsWith(prefix)) return s;
    return `${prefix} ${s}`;
  }).filter(Boolean).join(', ');

  let out = '';
  let buf = '';
  const stack = []; // 'kf'(keyframes: 스코핑 금지) | 'wrap'(media 등) | 'rule'
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      const head = buf.trim();
      buf = '';
      if (head.startsWith('@')) {
        const isKf = /^@(-webkit-)?keyframes/i.test(head);
        stack.push(isKf ? 'kf' : 'wrap');
        out += head + '{';
      } else {
        const inKf = stack.includes('kf');
        stack.push('rule');
        out += (inKf ? head : scopeSel(head)) + '{';
      }
    } else if (c === '}') {
      out += buf.trim() + '}';
      buf = '';
      stack.pop();
    } else {
      buf += c;
    }
  }
  out += buf.trim();
  return out;
}

/**
 * 그룹들을 배치 방식대로 그린다. 'stack'(기본)은 예전 그대로.
 *
 * 탭·팝업은 **순수 CSS로만** 동작해야 한다 — 메시지 안의 버튼은 리스가 클릭 이벤트에서
 * target을 잘라 넘겨서 JS로는 어느 것이 눌렸는지 알 수가 없다(§메인 DOM 클릭 주석 참고).
 * 그래서 탭은 라디오+라벨, 팝업은 tabindex+:focus-within으로 만든다. 둘 다 새니타이저
 * 기본 허용 목록에 있는 것만 쓴다(input/label/details/summary + type·checked·id·for·name·tabindex).
 *
 * ⚠ uid가 핵심이다. 상태창은 마커가 달린 **모든 메시지마다** 그려지므로 id를 고정해 버리면
 * 메시지 열 개에 같은 id가 열 개 생기고, `<label for>`은 문서에서 처음 만난 것을 집는다
 * → 최신 메시지의 탭을 눌렀는데 맨 위 메시지의 탭이 바뀐다. 라디오 name도 같이 묶여
 * 다른 메시지의 선택이 풀린다. 그래서 메시지 인덱스를 id·name에 섞는다.
 * (아코디언·팝업은 id를 안 쓰므로 이 문제에서 자유롭다)
 */
function layoutGroups(panes, layout, uid) {
  if (!panes.length) return '';
  const u = String(uid ?? 'x').replace(/[^A-Za-z0-9_-]/g, '') || 'x';

  // 탭·팝업은 두 장 이상일 때만 의미가 있다 — 한 장짜리 탭바는 잡음이라 쌓기로 되돌린다.
  if (layout === 'tabs' && panes.length > 1) {
    let h = '<div class="sim-tabs">';
    // 입력·탭바·패널이 모두 형제여야 `:checked ~`가 닿는다 (그래서 input을 앞에 몰아 둔다)
    panes.forEach((p, i) => {
      h += `<input class="sim-tabin sim-tabin-${i}" type="radio" name="simtab-${u}"`
        + ` id="simtab-${u}-${i}"${i === 0 ? ' checked' : ''}>`;
    });
    h += '<div class="sim-tabbar">';
    panes.forEach((p, i) => {
      h += `<label class="sim-tab sim-tab-${i}" for="simtab-${u}-${i}">${esc(p.label)}</label>`;
    });
    h += '</div><div class="sim-panels">';
    panes.forEach((p, i) => { h += `<div class="sim-panel sim-panel-${i}">${p.rows}</div>`; });
    return h + '</div></div>';
  }

  if (layout === 'accordion') {
    // 첫 장만 펼쳐 둔다. 여러 장을 동시에 펼쳐 볼 수 있는 게 탭과 다른 점이다.
    return panes.map((p, i) =>
      `<details class="sim-group sim-acc"${i === 0 ? ' open' : ''}>`
      + `<summary class="sim-group-label">${esc(p.label)}</summary>${p.rows}</details>`).join('');
  }

  if (layout === 'popover' && panes.length > 1) {
    return '<div class="sim-pops">' + panes.map((p) =>
      `<div class="sim-pop" tabindex="0"><span class="sim-pop-btn">${esc(p.label)}</span>`
      + `<div class="sim-pop-body">${p.rows}</div></div>`).join('') + '</div>';
  }

  // stack — 예전 동작 그대로 (collapsed 그룹은 개별로 접힌다)
  return panes.map((p) => p.collapsed
    ? `<details class="sim-group"><summary class="sim-group-label">${esc(p.label)}</summary>${p.rows}</details>`
    : `<div class="sim-group">${p.label ? `<div class="sim-group-label">${esc(p.label)}</div>` : ''}${p.rows}</div>`
  ).join('');
}

/**
 * 탭은 몇 장이 될지 스키마마다 다르므로 `:checked ~` 규칙을 그룹 수만큼 찍어 낸다.
 * nth-of-type 대신 자리별 클래스를 쓴다 — 조건부 그룹(showWhen)으로 장수가 줄어도
 * 입력과 패널이 같은 번호로 짝지어져 어긋나지 않는다.
 */
function layoutCss(ui) {
  if ((ui.layout ?? 'stack') !== 'tabs') return '';
  const n = (ui.groups || []).length;
  let css = '';
  for (let i = 0; i < n; i++) {
    css += `.sim-tabin-${i}:checked ~ .sim-tabbar .sim-tab-${i}{opacity:1;background:rgba(128,128,128,.14);border-color:rgba(128,128,128,.28)}\n`;
    css += `.sim-tabin-${i}:checked ~ .sim-panels .sim-panel-${i}{display:block}\n`;
  }
  return css;
}

/**
 * 다중 패널 템플릿 뼈대를 그 봇의 **실제 변수로 채워서** 뽑아낸다.
 * `layout` 옵션이 손 안 대고 쓰는 길이라면 이쪽은 뜯어고치려는 사람을 위한 출발점이다.
 * 빈 예제를 주면 결국 변수명을 하나하나 갈아 끼워야 하므로, 그 일을 여기서 대신 한다.
 *
 * 클래스는 `mp-`를 쓴다 — 기본 상태창 CSS(.sim-*)와 안 부딪혀야 마음대로 뜯어고칠 수 있다.
 * 임베드된 <style>은 저장될 때 .sim-status 아래로 자동 스코핑된다.
 */
function multiPanelTemplate(schema, kind = 'tabs') {
  const ui = schema?.statusUI || {};
  const varById = Object.fromEntries(
    [...(schema?.vars || []), ...(schema?.derived || []), ...exposedDefs(schema)].map((v) => [v.id, v]));

  let panes = (ui.groups || [])
    .filter((g) => (g.visibility ?? 'show') !== 'hidden')
    .map((g) => ({ label: g.label || '분류', ids: (g.items || []).map((it) => it.var).filter((id) => varById[id]) }))
    .filter((p) => p.ids.length);
  if (!panes.length) {
    // 그룹을 안 만들어 둔 봇 — 변수를 여섯 개씩 끊어 임시로 나눠 준다 (이름은 고쳐 쓰라고 남긴다)
    const ids = (schema?.vars || []).map((v) => v.id);
    for (let i = 0; i < ids.length; i += 6) panes.push({ label: `${Math.floor(i / 6) + 1}쪽`, ids: ids.slice(i, i + 6) });
  }
  if (!panes.length) panes = [{ label: '상태', ids: [] }];

  const rows = (ids) => ids.map((id) => {
    const d = varById[id];
    const val = d?.type === 'list' ? `{${id}:tags}` : `{${id}}`;
    return `    <div class="mp-row"><span class="mp-k">${esc(d?.label ?? id)}</span><span class="mp-v">${val}</span></div>`;
  }).join('\n') || '    <div class="mp-row"><span class="mp-k">(항목을 넣으세요)</span></div>';

  const base = `.mp-row{display:flex;justify-content:space-between;gap:10px;margin:3px 0}
.mp-k{opacity:.72}
.mp-v{font-variant-numeric:tabular-nums;font-weight:600}`;

  if (kind === 'accordion') {
    return `<style>
${base}
.mp-acc{margin-top:6px;border:1px solid rgba(128,128,128,.24);border-radius:8px;padding:5px 10px}
.mp-acc>summary{cursor:pointer;font-weight:600;opacity:.78;font-size:.9em}
</style>
${panes.map((p, i) => `<details class="mp-acc"${i === 0 ? ' open' : ''}>
  <summary>${esc(p.label)}</summary>
${rows(p.ids)}
</details>`).join('\n')}`;
  }

  if (kind === 'popover') {
    return `<style>
${base}
.mp-pops{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.mp-pop{position:relative;outline:none}
.mp-btn{display:inline-block;cursor:pointer;padding:3px 11px;border-radius:8px;
  border:1px solid rgba(128,128,128,.4);font-size:.88em;font-weight:600}
.mp-pop:focus-within .mp-btn{background:rgba(128,128,128,.18)}
/* 본문이 글 위로 뜨므로 배경과 글자색을 함께 정한다. Canvas/CanvasText는 시스템 색이라
   밝은 테마·어두운 테마를 스스로 따라간다 — 고정색을 쓰고 싶으면 여기만 바꾸면 된다. */
.mp-body{display:none;position:absolute;z-index:5;top:calc(100% + 5px);left:0;
  min-width:min(16em,72vw);max-width:min(24em,88vw);max-height:50vh;overflow:auto;
  padding:9px 11px;border:1px solid rgba(128,128,128,.4);border-radius:10px;
  background:Canvas;color:CanvasText;box-shadow:0 6px 22px rgba(0,0,0,.34)}
.mp-pop:focus-within .mp-body{display:block}
</style>
<div class="mp-pops">
${panes.map((p) => `  <div class="mp-pop" tabindex="0"><span class="mp-btn">${esc(p.label)}</span>
    <div class="mp-body">
${rows(p.ids)}
    </div>
  </div>`).join('\n')}
</div>`;
  }

  // tabs — 라디오가 탭바·패널과 형제여야 `:checked ~`가 닿는다.
  // ⚠ name·id에 {uid}가 반드시 들어가야 한다. 상태창은 메시지마다 그려지므로
  //   고정 id를 쓰면 최신 메시지의 탭을 눌렀는데 맨 위 메시지가 바뀐다.
  const rulesCss = panes.map((p, i) =>
    `.mp-in-${i}:checked ~ .mp-bar .mp-tab-${i}{opacity:1;background:rgba(128,128,128,.14);border-color:rgba(128,128,128,.28)}
.mp-in-${i}:checked ~ .mp-panels .mp-panel-${i}{display:block}`).join('\n');
  return `<style>
${base}
.mp-in{display:none}
.mp-bar{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 7px;border-bottom:1px solid rgba(128,128,128,.28)}
.mp-tab{cursor:pointer;padding:4px 11px;margin-bottom:-1px;border:1px solid transparent;border-bottom:none;
  border-radius:8px 8px 0 0;font-size:.88em;font-weight:600;opacity:.55}
.mp-panel{display:none}
${rulesCss}
</style>
<div class="mp-tabs">
${panes.map((p, i) => `  <input class="mp-in mp-in-${i}" type="radio" name="mp{uid}" id="mp{uid}-${i}"${i === 0 ? ' checked' : ''}>`).join('\n')}
  <div class="mp-bar">
${panes.map((p, i) => `    <label class="mp-tab mp-tab-${i}" for="mp{uid}-${i}">${esc(p.label)}</label>`).join('\n')}
  </div>
  <div class="mp-panels">
${panes.map((p, i) => `    <div class="mp-panel mp-panel-${i}">
${rows(p.ids)}
    </div>`).join('\n')}
  </div>
</div>`;
}

/**
 * 지금 그릴 템플릿 하나를 고른다.
 * `templates[]`에서 조건이 참인 첫 번째, 없으면 조건 없는 것, 그것도 없으면 `template`(구버전 필드).
 * 조건 평가가 터지면 그 항목만 건너뛴다 — 상태창이 통째로 사라지는 것보다 낫다.
 */
function pickTemplate(ui, lookup) {
  for (const t of (ui.templates || [])) {
    if (!t || !t.template) continue;
    if (!t.when) return t;
    try { if (truthy(evalSafe(t.when, lookup) ?? 0)) return t; } catch (e) { /* 다음 것으로 */ }
  }
  return ui.template ? { id: null, template: ui.template } : null;
}

/** 템플릿에서 <style> 블록을 분리 — AI 결과물 통짜 붙여넣기 지원 */
function extractTemplateParts(template) {
  let css = '';
  const html = String(template ?? '').replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, c) => {
    css += c + '\n';
    return '';
  });
  return { html, css };
}

/**
 * 게임 패널 대장(臺帳) 탭 렌더 (v0.89) — party.tabs[].template을 HTML로.
 * 상태창 템플릿과 같은 자리표시자({변수}·{목록:tags}·{commands}·{lastcheck})를 그대로 쓴다 —
 * 상태창에서 패널로 옮길 때 템플릿 조각을 복사만 하면 되게 하기 위해서다.
 * 다른 점 둘:
 *   {uid} → 'scg' 고정 — 패널은 메시지마다가 아니라 한 장뿐이라 구분자가 필요 없다.
 *   {choices} → 빈 문자열 — 갈림길 클릭은 메인 DOM 좌표 히트테스트 기계라 패널에선 안 눌린다.
 *     안 눌리는 버튼을 그리면 고장으로 보이므로 아예 안 그린다.
 * 임베드 <style>은 #sc-game 범위로 가둬 함께 돌려준다 (party.css와 같은 안전 규약).
 */
function renderPanelTemplate(schema, state, tpl) {
  const lookup = makeLookup(schema, state.vars);
  const lc = state.meta?.lastCheck;
  const extras = { commands: commandsHtml(schema), uid: 'scg',
    lastcheck: lc ? esc(`${lc.label}: ${lc.summary}`) : '', choices: '',
    scenario: scenarioChipHtml(schema, state.vars),
    fight: fightChipHtml(state.vars, esc) };
  const parts = extractTemplateParts(tpl);
  const styleTag = parts.css.trim() ? `<style>${scopeCss(parts.css, '#sc-game')}</style>` : '';
  return styleTag + renderTemplate(parts.html, lookup, extras, quoteSafe);
}

function evalSafe(src, lookup) {
  try { return evaluate(src, lookup, null); } catch { return undefined; }
}
function numOr(v, d) { const n = Number(v); return isFinite(n) ? n : d; }
function fmtNum(n) {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : (Math.round(n * 100) / 100).toLocaleString('en-US');
}

module.exports = { renderStatusHtml, renderPanelTemplate, actionGlyph, scopeCss, buildStatusCss, extractTemplateParts,
  layoutGroups, layoutCss, multiPanelTemplate, decodeHitClass, scenarioChipHtml, BASE_CSS, THEMES };
