const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.21.3 — 상태창이 "미리보기는 깔끔한데 채팅에서 찌그러진다" (커뮤니티 제보: 2열 그리드가 무너지고 탭 체크박스가 안 먹는다, 모바일·데스크탑 모드 둘 다).
// 리수 채팅은 상태창을 두 번 더 읽는다 (RisuAI main parser.svelte.ts, 2026-11-03 실사). 편집기 미리보기는 innerHTML 그대로라 둘 다 안 거친다.
//   ① markdown-it(html·breaks, 들여쓴 코드 끔) — HTML 블록은 블록 태그로 시작하는 줄에서 열려 빈 줄에서 끝나고, 나머지 줄은 <p>·<br> 문단이 된다.
//      덫 셋: 태그 안 빈 줄 · 4칸 넘는 들여쓰기(<div>여도 블록을 못 연다) · <style>로 시작하는 상태창 머리 줄(문단)에 템플릿 첫 줄이 붙는 것.
//   ② @adobe/css-tools 4.4.4 — <style> 하나라도 못 읽으면 블록째 버린다. CSS의 {uid}(안 바뀐 중괄호)·중첩 CSS가 기본 CSS까지 지웠다.
// 진짜 라이브러리는 리포에 없다(의존 없음) — 그걸로 돌린 대조(경우 12개, 리포 봇 7종·내장 16종 옛/새 비교)는 개발 중에 했고,
// 여기선 그 결과가 성립하는 구조 조건을 박는다: 블록 태그로 시작하는 템플릿은 상태창이 <div>로 시작하고 태그 안에 빈 줄이 없다
// (CommonMark: 6형 HTML 블록은 빈 줄에서만 끝난다) — 그러면 리수 채팅이 상태창을 통째로 HTML로 읽는다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { renderStatusHtml, buildStatusCss, statusCssParts } = SimCore.require('render');
const V = SimCore.require('validate');
const { TEMPLATES } = SimCore.require('templates');
const { buildLayoutSpecPrompt } = SimCore.require('editor');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const vars = [{ id: 'hp', label: '체력', type: 'int', init: 80 }, { id: 'loc', label: '위치', type: 'text', init: '광장' },
  { id: 'memo', label: '메모', type: 'text', init: '첫 단락\n\n둘째 단락' }];
const mk = (template, extra = {}) => ({ simcore: '0.1', meta: { name: '시험' }, vars, statusUI: { mode: 'template', template, ...extra } });
const draw = (sch, uid = '7', includeStyle = true) => renderStatusHtml(sch, engine.initState(sch), null, null, { includeStyle, uid });
const blankLines = (s) => s.split('\n').filter((l, i) => i > 0 && !l.trim()).length;
const noStyle = (s) => s.replace(/<style>[\s\S]*?<\/style>/g, '');

// AI가 흔히 내는 모양 — 4칸 들여쓰기 + 묶음 사이 빈 줄 + CSS의 {uid}
const AI_TPL = `<style>
.hud { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#t1-{uid}:checked ~ .p1 { display: block; }
</style>
<div class="tabs">
    <input type="radio" name="t-{uid}" id="t1-{uid}" checked>
    <label for="t1-{uid}">상태</label>

    <div class="p1">
        <div class="hud">
            <div class="cell">체력 {hp}</div>

            <div class="cell">위치 {loc}</div>
        </div>
    </div>
</div>`;

console.log('── ① 렌더 — 블록 태그로 시작하는 템플릿은 통째로 HTML 블록');
{
  const out = draw(mk(AI_TPL));
  ck('★ 상태창이 <div>로 시작한다 (머리 줄이 문단이 아니다)', out.startsWith('<div class="sim-status" id="simst-7">'), out.slice(0, 60));
  ck('★ 태그 안 빈 줄이 하나도 없다 (빈 주석으로 메움)', blankLines(noStyle(out)) === 0 && noStyle(out).includes('\n<!---->\n'), String(blankLines(noStyle(out))));
  ck('★ 블록 태그 줄은 들여쓰기를 뗀다 (4칸이면 <div>여도 블록을 못 연다)', /\n<div class="cell">체력 80<\/div>/.test(out) && !/\n {4,}<div/.test(noStyle(out)), '');
  ck('<style>은 상태창 뒤에', /<\/div><style>/.test(out) && !out.startsWith('<style>'), '');
  ck('글자 줄 들여쓰기는 그대로 (블록 태그 줄만 뗀다)', draw(mk('<div class="b">\n    체력 {hp}\n</div>')).includes('\n    체력 80\n'), '');
  const pv = draw(mk(AI_TPL), 'pv1', true);
  ck('미리보기(같은 렌더러)도 같은 HTML — uid만 다르다', pv.replace(/pv1/g, '7') === out, '');
  const refresh = draw(mk(AI_TPL), '7', false);
  ck('제자리 갱신용(includeStyle false)은 루트 하나 — 껍데기 벗기기가 그대로 된다', /^<div class="sim-status" id="simst-7">[\s\S]*<\/div>$/.test(refresh) && !refresh.includes('<style>'), refresh.slice(-30));
}

console.log('── ② 렌더 — 글자로 시작하는 템플릿·그룹 모드는 예전 그대로');
{
  const t = draw(mk('📍 {loc}\n❤️ {hp}'));
  ck('★ 글자형 템플릿: <style>이 앞, 글자가 머리 줄에 붙는다 (채팅의 줄바꿈 <br>은 마크다운이 그대로 넣는다)',
    t.startsWith('<style>') && t.includes('</summary>📍 광장\n❤️ 80'), t.slice(-60));
  const top = draw(mk('<div class="box">{hp}</div>\n\n메모 {loc}\n날씨 {hp}'));
  ck('★ 맨 바깥 빈 줄은 안 건드린다 — 그 뒤 글자 줄은 예전처럼 문단', top.includes('</div>\n\n메모 광장\n날씨 80'), '');
  const val = draw(mk('<style>.n{white-space:pre-line}</style>\n<div class="n">{memo}</div>'));
  ck('값의 빈 줄도 태그 안이면 메운다 (pre-line이면 빈 줄로 보인다)', val.includes('첫 단락\n<!---->\n둘째 단락'), '');
  const g = { simcore: '0.1', meta: { name: '시험' }, vars, statusUI: { groups: [{ label: '기본', items: [{ var: 'hp' }] }] } };
  const go = draw(g);
  ck('그룹 모드: <style>이 앞 (예전 그대로)', go.startsWith('<style>') && go.includes('<div class="sim-status" id="simst-7">'), go.slice(0, 40));
  ck('그룹 모드: 제작자 CSS가 없으면 <style>은 하나', (go.match(/<style>/g) || []).length === 1, '');
}

console.log('── ③ CSS — {uid}는 메시지 번호로, 제작자 CSS는 따로 블록');
{
  const a = draw(mk(AI_TPL), '7'), b = draw(mk(AI_TPL), '8');
  ck('★ CSS의 {uid}가 그 메시지 번호로 (#t1-7)', a.includes('#t1-7:checked') && !/<style>[^<]*\{uid\}/.test(a), '');
  ck('메시지마다 제 번호 (#t1-8)', b.includes('#t1-8:checked') && !b.includes('#t1-7'), '');
  ck('★ <style> 두 개 — 기본 CSS 블록과 제작자 CSS 블록 (제작자 CSS가 틀려도 리수가 기본 CSS까지 버리지 않게)',
    (a.match(/<style>/g) || []).length === 2 && /<style>\s*\.sim-status\{border/.test(a) && /<style>[^<]*\.sim-status \.hud\{/.test(a), '');
  const parts = statusCssParts(mk(AI_TPL), '9');
  ck('statusCssParts: base에 기본 CSS, custom에 제작자 CSS (+ {uid} 치환)', parts.base.includes('.sim-status{border') && parts.custom.includes('#t1-9') && !parts.base.includes('.hud'), '');
  ck('buildStatusCss는 예전처럼 문자열 하나 (기본 + 제작자)', buildStatusCss(mk(AI_TPL)).includes('.sim-status{border') && buildStatusCss(mk(AI_TPL)).includes('.hud'), '');
  const cc = draw({ simcore: '0.1', meta: { name: 't' }, vars, statusUI: { customCSS: '#x-{uid}{color:red}', groups: [{ label: 'g', items: [{ var: 'hp' }] }] } }, '5');
  ck('customCSS의 {uid}도 (그룹 모드)', cc.includes('#x-5{') && (cc.match(/<style>/g) || []).length === 2, '');
}

console.log('── ④ 검증기 — 리수 채팅이 버리는 CSS');
{
  const kill = (css) => V.cssChatProblems(css).kill.length > 0;
  for (const [n, css] of [['값에 {hp}', '.f{width:{hp}%}'], ['선택자에 {hp}', '.a-{hp}{color:red}'], ['중첩 CSS', '.a{color:red; .b{color:blue}}'],
    ['& 중첩', '.a{&:hover{color:red}}'], ['따옴표 안의 {', '.a::before{content:"{"}'], ['닫는 } 빠짐', '.a{color:red'], ['#{uid}', '#{uid}:checked ~ .p{display:block}']]) {
    ck(`★ ${n} → 통째로 버려짐`, kill(css), JSON.stringify(V.cssChatProblems(css)));
  }
  for (const [n, css] of [['{uid} 섞은 id', '#t1-{uid}:checked ~ .p{display:block}'], ['@media', '@media (max-width:400px){.a{color:red}}'],
    ['@keyframes', '@keyframes b{0%{opacity:0}100%{opacity:1}}.a{animation:b 1s}'], ['@container', '@container (min-width:300px){.a{color:red}}'],
    [':has :is', '.a:has(.b){color:red}:is(.c){color:blue}'], ['@font-face', "@font-face{font-family:X;src:local('Malgun Gothic')}"],
    [':root 변수', ':root{--c:red}.a{color:var(--c)}'], ['} 하나 더 (리수가 견딘다)', '.a{color:red}}'], ['주석 속 {', '/* { */.a{color:red}']]) {
    ck(`${n} → 문제없음`, !kill(css), JSON.stringify(V.cssChatProblems(css)));
  }
  ck('★ @layer·@starting-style → 안쪽 규칙이 채팅에서 안 먹는다 (리수가 접두를 안 붙임)',
    V.cssChatProblems('@layer a{.x{color:red}}@starting-style{.y{opacity:0}}').dead.join() === '@layer,@starting-style', '');
}

console.log('── ⑤ 검증기 — 고정 id · 남는 마크다운 줄');
{
  const ids = V.fixedIdRefs('<input type="checkbox" id="tog"><label for="tog">열기</label><input type="radio" name="grp" id="r-{uid}"><input type="checkbox" name="c1" id="c-{uid}"><div id="hud"></div>');
  ck('★ input id · label for · 라디오 name이 고정이면 잡는다', ids.includes('id="tog"') && ids.includes('for="tog"') && ids.includes('name="grp"'), ids.join(' '));
  ck('{uid} 섞은 것 · 체크박스 name · div id는 안 잡는다', !ids.some((x) => /r-\{uid\}|c-\{uid\}|c1|hud/.test(x)), ids.join(' '));
  // 문단에 이어진 줄은 줄마다 앞에 <br>이 낀다 — 닫는 </span> 줄도 (span은 블록 태그가 아니라 문단을 못 끊는다)
  const left = V.chatMarkdownLines('<span class="row">\n  <b>{hp}</b>\n</span>');
  ck('★ 글자로 시작한 템플릿의 태그 안 이어진 줄 → 채팅에서 <br>이 낀다고 알린다', left[0] === '<b>{hp}</b>' && left.length === 2, JSON.stringify(left));
  ck('블록 태그로 시작하면(렌더러가 통째 HTML로 낸다) 남는 줄 없음', V.chatMarkdownLines(AI_TPL.replace(/<style>[\s\S]*?<\/style>/, '')).length === 0, '');
  ck('글자형 템플릿(맨 바깥 줄)은 안 알린다 — 일부러 쓰는 줄바꿈', V.chatMarkdownLines('📍 {loc}\n❤️ {hp}').length === 0, '');
  const w = V.validateSchema(mk('<style>.a{.b{color:red}}</style>\n<div><input type="checkbox" id="tog"><label for="tog">x</label></div>')).warnings.map((x) => x.msg);
  ck('★ validateSchema가 경고로 낸다 (CSS 통째 · 고정 id)', w.some((m) => /통째로 버립니다/.test(m)) && w.some((m) => /\{uid\}가 없습니다/.test(m)), w.join(' / '));
  const wc = V.validateSchema({ simcore: '0.1', meta: { name: 't' }, vars, statusUI: { customCSS: '.f{width:{hp}%}', groups: [{ label: 'g', items: [{ var: 'hp' }] }] } }).warnings;
  ck('customCSS도 본다 (그룹 모드)', wc.some((x) => x.path === '$.statusUI.customCSS' && /\{hp\}/.test(x.msg)), wc.map((x) => x.msg).join(' / '));
}

console.log('── ⑥ 오탐 0 — 내장 템플릿 16종 · 리포 봇 7종');
{
  const NEW = /리수 채팅|\{uid\}가 없습니다/;
  const bad = [];
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const w = V.validateSchema(t.schema || t).warnings.filter((x) => NEW.test(x.msg));
    if (w.length) bad.push(`${k}: ${w[0].msg.slice(0, 60)}`);
  }
  const BOTS = ['trpg봇/페르소나테이블.json', '던전러너/던전러너.json', '베리디아/영지-변수상태창-신안.json', '아이돌DLC/미소녀유니버스-아이돌.json',
    '아틀리에/공방-아틀리에.json', '얼헌/헌터-신안.json', '조퇴악녀/조퇴악녀-스키마.json'];
  for (const f of BOTS) {
    const w = V.validateSchema(JSON.parse(fs.readFileSync(__P('..', f), 'utf8'))).warnings.filter((x) => NEW.test(x.msg));
    if (w.length) bad.push(`${f}: ${w[0].msg.slice(0, 60)}`);
  }
  ck(`★ 새 경고 오탐 0 (내장 ${Object.keys(TEMPLATES).length} + 봇 ${BOTS.length})`, bad.length === 0, bad.join(' | '));
  const ver = fs.readFileSync(__P('../베리디아/영지-변수상태창-신안.json'), 'utf8');
  ck('★ 베리디아 보고서 토글 id에 {uid} (최신 메시지 버튼이 맨 위 메시지 보고서를 열던 것)', ver.includes('sim_status_toggle-{uid}') && !/sim_status_toggle\\"/.test(ver), '');
}

console.log('── ⑦ 편집기 — AI 결과를 넣을 때 · 규격서');
{
  ck('★ 🎨 배치 결과는 빈 줄을 걷고 넣는다', src.includes('tpl = validateSchema.dropBlankLines(tpl);'), '');
  ck('dropBlankLines: 빈 줄만 걷고 <style> 안은 그대로', V.dropBlankLines('<style>.a{}\n\n.b{}</style>\n<div>\n\n  <span>x</span>\n   \n</div>') === '<style>.a{}\n\n.b{}</style>\n<div>\n  <span>x</span>\n</div>',
    JSON.stringify(V.dropBlankLines('<style>.a{}\n\n.b{}</style>\n<div>\n\n  <span>x</span>\n   \n</div>')));
  ck('🎨 스킨(CSS만) 결과가 채팅에서 버려질 문법이면 알린다', src.includes('validateSchema.cssChatProblems(css).kill') && src.includes('리수 채팅에서는 이 스킨이 통째로 버려집니다'), '');
  const lay = buildLayoutSpecPrompt(mk(AI_TPL));
  ck('★ 배치 규격서: 빈 줄 금지 · 중첩 CSS 금지 · CSS의 {uid}는 된다', /HTML 안에 빈 줄을 넣지 마세요/.test(lay) && /중첩/.test(lay) && /#tab1-\{uid\}:checked/.test(lay), '');
  ck('스킨 규격서: 중첩 CSS·@layer 금지', src.includes("'- **중첩 CSS(`.a { .b {…} }`, `&:hover`)와 `@layer`는 쓰지 마세요.**"), '');
  ck('버전 1.21.3 이상 + 체인지로그', /\/\/@version 1\.(2[1-9]\.([3-9]|\d\d)|2[2-9]\.\d+|[3-9]\d\.\d+)/.test(src) && src.includes('// ── v1.21.3 ──'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n[test-chathtml] ${p}/${p + f} 통과`);
process.exit(f ? 1 : 0);
