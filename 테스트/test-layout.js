const __P = (...p) => require('path').resolve(__dirname, ...p);
// statusUI.layout — 그룹을 탭/아코디언/팝업으로 배치. 전부 JS 없이 CSS만으로 전환된다.
//
// 메시지 안의 버튼은 리스가 클릭 이벤트에서 target을 잘라 넘겨 어느 것이 눌렸는지 알 수 없다.
// 그래서 여기서 확인할 것은 두 가지다: ① 새니타이저가 남겨 주는 것만 썼는가,
// ② 메시지마다 그려져도 서로의 탭을 건드리지 않는가(uid).
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { renderStatusHtml, buildStatusCss, layoutGroups, layoutCss } = SimCore.require('render');
const { validateSchema } = SimCore.require('validate');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const mk = (layout, groups = 3) => ({
  simcore: '0.1', meta: { name: '배치 테스트' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 },
    { id: 'gold', label: '금화', type: 'int', init: 10, min: 0 },
    { id: 'fame', label: '명성', type: 'int', init: 3, min: 0 }],
  statusUI: {
    mode: 'auto', layout,
    groups: [{ label: '영지', items: [{ var: 'hp' }] }, { label: '인물', items: [{ var: 'gold' }] },
      { label: '탐사', items: [{ var: 'fame' }] }].slice(0, groups),
  },
});
const draw = (sch, uid) => renderStatusHtml(sch, engine.initState(sch), null, null, { includeStyle: false, uid });

// ── stack = 예전 그대로 ──
{
  const a = draw(mk(undefined), 3);
  const b = draw(mk('stack'), 3);
  ck('layout 미지정과 stack이 같다 (기존 봇 무변화)', a === b, '');
  ck('stack은 탭 껍데기를 안 만든다', !a.includes('sim-tabs') && !a.includes('sim-pops'), '');
  ck('stack도 그룹 셋을 다 그린다', (a.match(/sim-group-label/g) || []).length === 3, '');
}

// ── 탭 ──
{
  const html = draw(mk('tabs'), 7);
  ck('★ 탭: 라디오가 그룹 수만큼', (html.match(/<input /g) || []).length === 3, html.slice(0, 120));
  ck('탭: 라벨이 그룹 수만큼', (html.match(/<label /g) || []).length === 3, '');
  ck('탭: 패널이 그룹 수만큼', (html.match(/sim-panel sim-panel-/g) || []).length === 3, '');
  ck('탭: 첫 장만 checked', (html.match(/ checked/g) || []).length === 1, '');
  ck('탭: 라벨이 자기 라디오를 가리킨다',
    html.includes('id="simtab-7-1"') && html.includes('for="simtab-7-1"'), '');
  ck('탭: 그룹 이름이 탭 이름이 된다', html.includes('>영지</label>') && html.includes('>탐사</label>'), '');
  ck('탭: 라디오·탭바·패널이 형제다 (:checked ~ 가 닿는 조건)',
    /<div class="sim-tabs">(<input [^>]*>)+<div class="sim-tabbar">/.test(html), '');

  // 한 장짜리 탭바는 잡음이라 쌓기로 되돌린다
  const one = draw(mk('tabs', 1), 7);
  ck('★ 그룹이 하나면 탭을 안 만든다', !one.includes('sim-tabs') && one.includes('sim-group'), '');
}

// ── uid: 메시지끼리 탭이 엉키지 않는가 (이 기능의 핵심 함정) ──
{
  const m3 = draw(mk('tabs'), 3);
  const m4 = draw(mk('tabs'), 4);
  ck('★ 메시지가 다르면 라디오 id가 다르다', !m3.includes('simtab-4-') && m4.includes('simtab-4-0'), '');
  ck('★ 메시지가 다르면 라디오 name도 다르다 (선택이 서로 풀리지 않게)',
    m3.includes('name="simtab-3"') && m4.includes('name="simtab-4"'), '');
  const ids3 = (m3.match(/id="[^"]+"/g) || []);
  ck('한 메시지 안에서는 id가 서로 다르다', new Set(ids3).size === ids3.length, ids3.join(' '));
  // uid가 없거나 이상해도 선택자로 깨지지 않는 문자만 남긴다
  ck('uid 미지정도 안전한 id를 만든다', /id="simtab-x-0"/.test(draw(mk('tabs'), undefined)), '');
  // 선택자·속성을 깨는 문자는 다 떨어져 나간다 (1"><script>2 → 1script2)
  const nasty = draw(mk('tabs'), '1"><script>2');
  ck('uid의 위험한 문자는 걸러진다',
    nasty.includes('id="simtab-1script2-0"') && !/id="[^"]*[<>]/.test(nasty),
    (nasty.match(/id="[^"]*"/) || [])[0]);
}

// ── 아코디언 ──
{
  const html = draw(mk('accordion'), 3);
  ck('★ 아코디언: 그룹마다 details', (html.match(/<details class="sim-group sim-acc"/g) || []).length === 3, '');
  // 바깥 껍데기(<details open>)도 open이라 그건 빼고 센다
  ck('아코디언: 첫 장만 펼쳐져 있다', (html.match(/sim-acc" open>/g) || []).length === 1,
    (html.match(/<details[^>]*>/g) || []).join(' '));
  ck('★ 아코디언은 id를 안 쓴다 (메시지끼리 충돌 불가)', !html.includes('id='), '');
  ck('아코디언: 그룹이 하나여도 동작한다', draw(mk('accordion', 1), 3).includes('sim-acc'), '');
}

// ── 팝업 ──
{
  const html = draw(mk('popover'), 3);
  ck('★ 팝업: 그룹마다 tabindex 가진 껍데기', (html.match(/class="sim-pop" tabindex="0"/g) || []).length === 3, '');
  ck('팝업: 버튼과 본문이 짝지어져 있다',
    (html.match(/sim-pop-btn/g) || []).length === 3 && (html.match(/sim-pop-body/g) || []).length === 3, '');
  ck('★ 팝업도 id를 안 쓴다', !html.includes('id='), '');
  ck('팝업: 그룹이 하나면 쌓기로 되돌린다', !draw(mk('popover', 1), 3).includes('sim-pops'), '');
}

// ── CSS ──
{
  const css = buildStatusCss(mk('tabs'));
  ck('★ 탭 CSS가 자리별로 찍혀 나온다',
    css.includes('.sim-tabin-0:checked ~ .sim-panels .sim-panel-0{display:block}')
    && css.includes('.sim-tabin-2:checked ~ .sim-panels .sim-panel-2{display:block}'), '');
  ck('탭 CSS는 그룹 수만큼만 (남는 규칙 없음)', !css.includes('.sim-panel-3'), '');
  ck('패널은 기본이 숨김', css.includes('.sim-panel{display:none}'), '');
  ck('stack에는 탭 규칙을 안 싣는다', !buildStatusCss(mk('stack')).includes(':checked ~'), '');
  ck('팝업 본문은 배경과 글자색을 같이 정한다 (뒤가 비치면 안 된다)',
    /\.sim-pop-body\{[^}]*background:var\(--sim-pop-bg[^}]*color:var\(--sim-pop-fg/.test(buildStatusCss(mk('popover'))), '');
  ck('팝업은 :focus-within으로 열린다', buildStatusCss(mk('popover')).includes('.sim-pop:focus-within .sim-pop-body{display:block}'), '');
}

// ── 새니타이저 안전성: 리수가 남겨 주는 것만 썼는가 ──
// (DOMPurify 기본 허용 목록 + 리수의 ADD_TAGS/ADD_ATTR에서 우리가 쓰는 것만 추려 실측한 값)
{
  const OK_TAGS = new Set(['div', 'span', 'details', 'summary', 'input', 'label', 'style']);
  const OK_ATTRS = new Set(['class', 'type', 'name', 'id', 'for', 'checked', 'tabindex', 'open', 'style', 'title']);
  for (const layout of ['tabs', 'accordion', 'popover']) {
    const html = draw(mk(layout), 5);
    const tags = new Set((html.match(/<([a-z]+)/g) || []).map((s) => s.slice(1)));
    const bad = [...tags].filter((t) => !OK_TAGS.has(t));
    ck(`★ '${layout}'은 허용된 태그만 쓴다`, bad.length === 0, bad.join(','));
    const attrs = new Set((html.match(/[\s"]([a-z-]+)=/g) || []).map((s) => s.slice(1, -1)));
    const badA = [...attrs].filter((a) => !OK_ATTRS.has(a));
    ck(`'${layout}'은 허용된 속성만 쓴다`, badA.length === 0, badA.join(','));
  }
}

// ── 검증기 ──
{
  ck('알 수 없는 layout은 거부', !validateSchema(mk('grid')).ok,
    JSON.stringify(validateSchema(mk('grid')).errors?.[0] ?? {}));
  ck('거부 시 경로가 정확', validateSchema(mk('grid')).errors.some((e) => e.path === '$.statusUI.layout'), '');
  for (const l of ['stack', 'tabs', 'accordion', 'popover', undefined]) {
    ck(`layout '${l}' 통과`, validateSchema(mk(l)).ok, JSON.stringify(validateSchema(mk(l)).errors ?? []));
  }
  const one = validateSchema(mk('tabs', 1));
  ck('★ 그룹이 하나인데 탭이면 경고한다 (조용히 쌓이는 걸 알려 준다)',
    one.ok && (one.warnings || []).some((w) => w.path === '$.statusUI.layout'),
    JSON.stringify(one.warnings ?? []));
}

// ── {uid} 자리표시자 ──
{
  const T = {
    simcore: '0.1', meta: { name: 't' },
    vars: [{ id: 'hp', label: 'HP', type: 'int', init: 5 }],
    statusUI: { mode: 'template', template: '<input type="radio" name="g{uid}" id="g{uid}a">HP {hp}' },
  };
  const v = validateSchema(T);
  ck('★ {uid}는 예약 자리표시자다 (알 수 없는 변수로 안 잡힌다)', v.ok, JSON.stringify(v.errors ?? []));
  const html = renderStatusHtml(T, engine.initState(T), null, null, { includeStyle: false, uid: 9 });
  ck('{uid}가 실제 메시지 번호로 치환된다', html.includes('name="g9"') && html.includes('id="g9a"'), html.slice(0, 160));
  ck('템플릿 모드에 layout을 쓰면 경고', (validateSchema({ ...T, statusUI: { ...T.statusUI, layout: 'tabs' } }).warnings || [])
    .some((w) => w.path === '$.statusUI.layout'), '');
}

// ── 붙여넣기 뼈대 (multiPanelTemplate) — 자유 편집용 ──
{
  const { multiPanelTemplate } = SimCore.require('render');
  const SCH = {
    simcore: '0.1', meta: { name: '뼈대' },
    vars: [{ id: 'hp', label: '체력', type: 'int', init: 5 }, { id: 'gold', label: '금화', type: 'int', init: 9 },
      { id: 'bag', label: '소지품', type: 'list', init: ['빵'] }],
    statusUI: { mode: 'auto', groups: [{ label: '몸', items: [{ var: 'hp' }] },
      { label: '짐', items: [{ var: 'gold' }, { var: 'bag' }] }] },
  };
  for (const kind of ['tabs', 'accordion', 'popover']) {
    const tpl = multiPanelTemplate(SCH, kind);
    const s2 = { ...SCH, statusUI: { mode: 'template', template: tpl } };
    const v = validateSchema(s2);
    ck(`★ '${kind}' 뼈대가 그대로 검증을 통과한다`, v.ok, JSON.stringify(v.errors ?? []));
    const html = renderStatusHtml(s2, engine.initState(s2), null, null, { includeStyle: true, uid: 7 });
    const body = html.replace(/<style>[\s\S]*?<\/style>/, '');
    ck(`'${kind}' 뼈대에 미치환 자리표시자가 없다`, !/\{[A-Za-z_]/.test(body),
      (body.match(/\{[^}]*\}/g) || []).join(','));
    ck(`'${kind}' 뼈대가 그룹 이름을 가져온다`, body.includes('몸') && body.includes('짐'), '');
    ck(`'${kind}' 뼈대가 값을 실제로 꽂는다`, /체력[\s\S]{0,80}>5</.test(body), '');
    ck(`'${kind}' 뼈대는 목록을 칩으로 그린다`, body.includes('sim-tag'), '');
    ck(`'${kind}' 뼈대 CSS는 .sim-status 안으로 갇힌다`,
      !/(^|\n)\.mp-/.test(html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''), '');
  }
  const tabs = multiPanelTemplate(SCH, 'tabs');
  ck('★ 탭 뼈대는 {uid}를 id·name 양쪽에 쓴다',
    tabs.includes('name="mp{uid}"') && tabs.includes('id="mp{uid}-0"') && tabs.includes('for="mp{uid}-0"'), '');
  ck('탭 뼈대 CSS가 자리 수만큼 나온다',
    tabs.includes('.mp-in-1:checked ~ .mp-panels .mp-panel-1') && !tabs.includes('.mp-panel-2'), '');
  ck('뼈대는 기본 CSS(.sim-*)와 클래스가 안 겹친다', !/class="[^"]*\bsim-/.test(tabs), '');

  // 그룹을 안 만들어 둔 봇도 뭔가 나와야 한다 (빈 상자를 주면 아무도 못 고친다)
  const NOG = { ...SCH, statusUI: { mode: 'template' } };
  const bare = multiPanelTemplate(NOG, 'tabs');
  ck('★ 그룹이 없어도 변수로 뼈대를 채운다', bare.includes('{hp}') && bare.includes('{gold}'), bare.slice(0, 100));
  ck('변수도 없으면 빈 자리라도 안내한다',
    multiPanelTemplate({ statusUI: {} }, 'accordion').includes('항목을 넣으세요'), '');
}

// ── 배선 (어댑터가 메시지 번호를 실제로 넘기는가) ──
{
  ck('★ 표시 핸들러가 마커의 메시지 번호를 uid로 넘긴다', /includeStyle: true, uid: idxStr/.test(src), '');
  ck('편집기 미리보기는 메시지와 안 겹치는 uid를 쓴다', /includeStyle: true, uid: 'pv'/.test(src), '');
  ck('편집기에 배치 고르는 칸이 있다', src.includes("pair('그룹 배치'"), '');
  ck('편집기에서 뼈대를 뽑을 수 있다', src.includes("tplBtn('tabs'") && src.includes("tplBtn('popover'"), '');
  ck('★ 뼈대 덮어쓰기는 패널 UI로 확인받는다 (호스트 대화상자는 패널에 가려 못 쓴다)',
    src.includes('tplArm !== kind') && !/\bif \([^)]*!confirm\(/.test(src), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
