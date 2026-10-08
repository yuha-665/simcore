// 상태창 미리보기 — 생성된 조퇴악녀-스키마.json을 실제 SimCore 렌더러로 그린다 (시점 셋 + 5장 심판, 탭은 눌러 볼 수 있다).
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
        quests: ['[1장] 데뷔탕트를 무사히 넘긴다', '[원작 이행] 모두 앞에서 엘리시아에게 질투를 드러내라', '[서브] 로니카의 도발을 받아넘긴다'],
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
    id: 'servant', open: 0, title: '시종 시점',
    caption: '2장 다과회 · 회귀 2회차 — 막기·돕기·돌리기 (신뢰가 모자라 돌린다는 🔒)',
    build() {
      const st = start('servant');
      Object.assign(st.vars, {
        scn_idx: 2, scn_turns: 5, cleared: 1, loop: 2, rosetta: 27, doom: 44, rep: -38, elicia: 36, anna: 90,
        location: '카르디온 공작저 온실', quests: ['[2장] 다과회를 무사히 넘긴다', '[서브] 악소문의 출처를 알아낸다'],
        memories: ['로제타는 동정받는 걸 가장 싫어한다', '1장에서 막기만 하면 로제타가 등을 돌린다'],
        skills: ['원작 지식', '재봉'], items: ['안나가 준 열쇠'],
      });
      st.meta.pendingChoice = { id: 'tea_servant', turn: st.meta.turn };
      return { st, changeLog: [{ id: 'rosetta', from: 33, to: 27, source: 'llm' }] };
    },
  },
  {
    id: 'special', open: 0, title: '빙의자 로제타 시점',
    caption: '1장 · 유저는 곁의 기사 — 평소 장면의 능력치 선택지 (킹덤컴식)',
    build() {
      const st = start('special');
      Object.assign(st.vars, {
        scn_idx: 1, scn_turns: 2, doom: 34, rep: -28, health: 55, elicia: 32, ert: 12, rical: 8, duke: 5, anna: 80, rosetta: 41,
        location: '카르디온 공작저 정원', role: '에버렛 후작가 기사',
        quests: ['[1장] 데뷔탕트를 무사히 넘긴다', '[서브] 서랍 속 작은 병의 정체'],
        ties: ['로니카 — 로제타를 비웃는 영애'], items: ['후작가 문장 단검'],
        possessor: '서른 살 사회부 기자. 냉소적이고 말이 빠르다',
        st_sword: 38, st_talk: 22, st_charm: 30,
      });
      // 평소 장면의 능력치 선택지 (보조가 쓰는 갈림길 'stat' 벌 — 킹덤컴식)
      st.meta.pendingChoice = { id: '@live', turn: st.meta.turn, live: { cfg: 'stat', desc: '로니카가 부채 너머로 로제타를 비웃는다',
        items: [{ label: '로니카의 말을 정중하게 되받아친다', tag: '화술' }, { label: '못 들은 척 로제타를 정원 안쪽으로 모신다', tag: '그냥' },
          { label: '검집을 가볍게 울려 무례를 경고한다', tag: '검술' }] } };
      return { st, changeLog: [{ id: 'rosetta', from: 35, to: 41, source: 'llm' }] };
    },
  },
  {
    id: 'verdict', open: 0, title: '5장 · 심판',
    caption: '시종 시점 · 회귀 3회차 — 잠긴 선택지(🔒)가 무엇이 로제타를 살릴 수 있었는지 보여 준다',
    build() {
      const st = start('servant');
      Object.assign(st.vars, {
        role: '로제타 전속 시종', scn_idx: 5, scn_turns: 4, cleared: 4, loop: 3,
        doom: 58, rep: -52, health: 41, elicia: 63, ert: 34, rical: 47, duke: 22, anna: 91, rosetta: 74,
        location: '황궁 심판정', quests: ['[5장] 심판에서 살아남는다', '[서브] 심판정에서 편에 서 줄 사람을 찾는다'],
        memories: ['4장 저녁 모임의 쪽지는 로제타의 필체가 아니다', '리칼은 약을 보낸 일을 숨긴다'],
        skills: ['원작 지식', '재봉', '독 감별'], items: ['로제타 필체가 아닌 쪽지'],
        st_sword: 34, st_talk: 41, st_house: 38,
      });
      st.meta.pendingChoice = { id: 'verdict_servant', turn: st.meta.turn };
      return { st, changeLog: [{ id: 'elicia', from: 57, to: 63, source: 'llm' }] };
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
.wrap{max-width:1180px; margin:0 auto; padding-inline:16px; padding-block:28px 40px}
.top{display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:16px 24px; border-bottom:1px solid var(--line); padding-bottom:18px}
h1{font-family:var(--serif); font-weight:700; font-size:1.9rem; margin:0; letter-spacing:.02em; text-wrap:balance}
.lede{margin:.4rem 0 0; color:var(--muted); max-width:62ch}
.toggle{display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:3px; background:var(--panel)}
.toggle button{font:inherit; font-size:.85rem; border:0; background:transparent; color:var(--muted); padding:.35rem .9rem; border-radius:999px; cursor:pointer}
.toggle button[aria-pressed="true"]{background:var(--accent); color:#fff}
.toggle button:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr)); gap:28px; margin-top:26px; align-items:start}
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
      <p class="lede">밤의 무도회 + 두 장(현황 | 나), 시점 셋과 5장 심판. SimCore 렌더러가 실제 스키마로 그린 화면이고, 탭은 눌러서 넘길 수 있습니다.</p>
    </div>
    <div class="toggle" role="group" aria-label="채팅 배경">
      <button type="button" id="bg-dark" aria-pressed="true">어두운 채팅</button>
      <button type="button" id="bg-light" aria-pressed="false">밝은 채팅</button>
    </div>
  </div>
  <div class="grid">${cards}
  </div>
  <div class="notes">
    <p><b>현황</b> — [ 퀘스트 ] 시스템 창 · 로제타(파멸도·평판·몸) · 관계(호감 + 그 밖의 관계) · 진행(장소·퀘스트).</p>
    <p><b>나</b> — 신상(신분·회귀) · 가진 것(능력·소지품) · 회귀의 기억. 능력과 기억은 회귀해도 남고, 소지품과 신분은 세상과 함께 되감깁니다.</p>
    <p><b>1부</b> — 서장 → 1장 데뷔탕트 → 2장 다과회 → 3장 계단과 과자 → 4장 파국의 밤 → 5장 심판 → 원작 이후. 장마다 절정 갈림길(안 고르면 원작대로) — 로제타 시점은 원작 이행(정해진 악행을 치르되 비튼다), 시종 시점은 막기·돕기·돌리기(신뢰가 문을 연다). 심판은 관계가 여는 잠긴 선택지와 "받아들인다 = 처형 → 회귀".</p>
    <p><b>능력치</b> — 검술·마법·화술·매력·가사. 판정 달린 선택지 옆에 🎲 성공률이 뜨고, 성공하면 +1. 수련 버튼으로 작중 두 시간에 +1~3. 회귀해도 남습니다.</p>
    <p>능력·소지품은 보조 모델이 서사에 실제로 나온 것만 적고, 메인 모델도 매 턴 "유저: 신분 · 능력 · 소지품" 한 줄로 받습니다. 빙의자 로제타 시점에선 로제타 호감 줄이 보이고, 빙의자 설정은 상태창이 아니라 프롬프트로만 갑니다.</p>
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
