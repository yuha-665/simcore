// 상태창 미리보기 — 생성된 조퇴악녀-스키마.json을 실제 SimCore 렌더러로 그린다 (시점 둘, 탭은 눌러 볼 수 있다).
// 시안 셋(장미서신·밤의무도회·로제타.css) 비교를 거쳐 밤의 무도회로 확정 [유저 2026-09-25]. 다른 두 CSS는 참고로 남겨 둔다.
// 실행: node 조퇴악녀/villainess-vars.js && node 조퇴악녀/상태창/build-preview.js <출력.html>
const fs = require('fs');
const path = require('path');
const here = (...p) => path.resolve(__dirname, ...p);
const src = fs.readFileSync(here('../../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const render = SC.require('render');
const S = JSON.parse(fs.readFileSync(here('../조퇴악녀-스키마.json'), 'utf8'));

function start(preset) {
  let st = engine.initState(S);
  st = engine.applyPreset(S, st, preset).state;
  st.meta.setupDone = true;
  return st;
}

const SCENES = [
  {
    id: 'rosetta', open: 0, title: '로제타 시점',
    caption: '1장 데뷔탕트 · 회귀 1회차 · 무도회 절정 선택지 대기 중',
    build() {
      const st = start('rosetta');
      Object.assign(st.vars, {
        scn_idx: 1, scn_turns: 6, doom: 52, rep: -35, health: 48, elicia: 45, ert: 18, rical: 12, duke: 5, anna: 88,
        loop: 1, location: '황궁 대연회장',
        quests: ['[1장] 데뷔탕트를 무사히 넘긴다', '[서브] 로니카의 도발을 받아넘긴다'],
        memories: ['로제타는 동정받는 걸 가장 싫어한다', '무도회 전날 로니카가 소문을 퍼뜨린다'],
        skills: ['원작 지식', '궁정 예법'], items: ['서랍 속 작은 병', '데뷔탕트 초대장'],
        sec_powder: 1,
      });
      st.meta.pendingChoice = { id: 'debut_rosetta', turn: st.meta.turn };
      return { st, changeLog: [
        { id: 'elicia', from: 39, to: 45, source: 'llm' },
        { id: 'items', from: ['서랍 속 작은 병'], to: ['서랍 속 작은 병', '데뷔탕트 초대장'], source: 'llm' },
      ] };
    },
  },
  {
    id: 'servant', open: 1, title: '시종 시점',
    caption: '서장 · 면접 두 번째 질문 · 회귀 2회차 — 빙의자 장을 펼친 채',
    build() {
      const st = start('servant');
      Object.assign(st.vars, {
        iv_q: 1, iv_score: 2, loop: 2, rosetta: 15,
        memories: ['로제타는 동정받는 걸 가장 싫어한다', '"성실히 모시겠습니다"로는 눈에 안 띈다'],
        skills: ['원작 지식', '재봉'], items: ['낡은 추천서'],
      });
      return { st, changeLog: null };
    },
  },
];

const samples = SCENES.map((sc) => {
  const { st, changeLog } = sc.build();
  let html = render.renderStatusHtml(S, st, changeLog, null, { uid: sc.id });
  if (sc.open) { // 미리보기 전용 — 둘째 장을 펼쳐 둔다 (리수에서는 늘 첫 장부터)
    html = html.replace(/(id="simtab-[^"]+-0") checked/, '$1').replace(new RegExp(`(id="simtab-${sc.id}-${sc.open}")`), '$1 checked');
  }
  return { ...sc, html, css: render.buildStatusCss(S) };
});

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cards = samples.map((v) => `
    <article class="variant">
      <header class="variant-head">
        <h2>${esc(v.title)}</h2>
        <p>${esc(v.caption)}</p>
      </header>
      <div class="stage"><div class="sample" data-v="${v.id}"></div></div>
    </article>`).join('');
const data = Object.fromEntries(samples.map((v) => [v.id, { css: v.css, html: v.html }]));

const page = `<title>악녀의 상태창</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&display=swap">
<style>
:root{
  --bg:#f5f1f2; --ink:#2b2226; --muted:#75676d; --line:#e2d7da; --accent:#9b2c3d; --panel:#fbf9fa;
  --chat-dark:#1d1b21; --chat-light:#ecebee;
  --serif:'Gowun Batang','Nanum Myeongjo','AppleMyungjo','Batang',serif;
  --sans:'Pretendard','Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',system-ui,sans-serif;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){ --bg:#151217; --ink:#ece5e8; --muted:#a3959c; --line:#2d262c; --accent:#e58a9a; --panel:#1b171d; color-scheme:dark; }
}
:root[data-theme="dark"]{ --bg:#151217; --ink:#ece5e8; --muted:#a3959c; --line:#2d262c; --accent:#e58a9a; --panel:#1b171d; color-scheme:dark; }
body{background:var(--bg); color:var(--ink); font-family:var(--sans); font-size:15px; line-height:1.6}
.wrap{max-width:1040px; margin:0 auto; padding-inline:16px; padding-block:28px 40px}
.top{display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:16px 24px; border-bottom:1px solid var(--line); padding-bottom:18px}
h1{font-family:var(--serif); font-weight:700; font-size:1.9rem; margin:0; letter-spacing:.02em; text-wrap:balance}
.lede{margin:.4rem 0 0; color:var(--muted); max-width:62ch}
.toggle{display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:3px; background:var(--panel)}
.toggle button{font:inherit; font-size:.85rem; border:0; background:transparent; color:var(--muted); padding:.35rem .9rem; border-radius:999px; cursor:pointer}
.toggle button[aria-pressed="true"]{background:var(--accent); color:#fff}
.toggle button:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr)); gap:28px; margin-top:26px; align-items:start}
.variant{display:flex; flex-direction:column; gap:12px; min-width:0}
.variant-head h2{font-family:var(--serif); font-size:1.3rem; margin:0}
.variant-head p{margin:.15rem 0 0; color:var(--muted); font-size:.9rem}
.stage{background:var(--chat-dark); border-radius:12px; padding:18px 14px; transition:background .2s}
.light-chat .stage{background:var(--chat-light)}
.notes{margin-top:30px; border-top:1px solid var(--line); padding-top:16px; color:var(--muted); font-size:.86rem; display:grid; gap:6px; max-width:78ch}
.notes b{color:var(--ink); font-weight:600}
@media (prefers-reduced-motion: reduce){ .stage{transition:none} }
</style>
<div class="wrap" id="page">
  <div class="top">
    <div>
      <h1>악녀의 상태창</h1>
      <p class="lede">밤의 무도회 + 두 장(현황 | 빙의자). SimCore 렌더러가 실제 스키마로 그린 화면이고, 탭은 눌러서 넘길 수 있습니다.</p>
    </div>
    <div class="toggle" role="group" aria-label="채팅 배경">
      <button type="button" id="bg-dark" aria-pressed="true">어두운 채팅</button>
      <button type="button" id="bg-light" aria-pressed="false">밝은 채팅</button>
    </div>
  </div>
  <div class="grid">${cards}
  </div>
  <div class="notes">
    <p><b>현황</b> — 면접(시종 시점, 합격 전) · 로제타(파멸도·평판·몸) · 관계(호감 + 그 밖의 관계) · 진행(장소·퀘스트).</p>
    <p><b>빙의자</b> — 신상(신분·회귀) · 가진 것(능력·소지품) · 회귀의 기억. 능력과 기억은 회귀해도 남고, 소지품과 신분은 세상과 함께 되감깁니다.</p>
    <p>능력·소지품은 보조 모델이 서사에 실제로 나온 것만 적고, 메인 모델도 매 턴 "빙의자: 신분 · 능력 · 소지품" 한 줄로 받습니다.</p>
  </div>
</div>
<script>
(function(){
  var DATA = ${JSON.stringify(data)};
  document.querySelectorAll('.sample').forEach(function(host){
    var d = DATA[host.getAttribute('data-v')];
    if (!d) return;
    var root = host.attachShadow({mode:'open'});
    root.innerHTML = '<style>:host{display:block;font-size:15px;color:#ddd}' + d.css + '</style>' + d.html;
  });
  var page = document.getElementById('page');
  var dark = document.getElementById('bg-dark'), light = document.getElementById('bg-light');
  function set(isLight){
    page.classList.toggle('light-chat', isLight);
    dark.setAttribute('aria-pressed', String(!isLight));
    light.setAttribute('aria-pressed', String(isLight));
  }
  dark.addEventListener('click', function(){ set(false); });
  light.addEventListener('click', function(){ set(true); });
})();
</script>
`;
const outPath = process.argv[2] || here('미리보기.html');
fs.writeFileSync(outPath, page);
console.log('저장:', outPath, (page.length / 1024).toFixed(1) + 'KB');
