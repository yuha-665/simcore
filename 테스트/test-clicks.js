const __P = (...p) => require('path').resolve(__dirname, ...p);
// 클릭 조작(v0.42, v0.43에서 수정) — 히트 클래스·해독기·pickChoice 공용·어댑터 배선 + 히트 루프 실구동
// ⚠ v0.42 실기 무반응의 교훈: 플러그인이 받는 DOM 객체는 RPC 프록시라 **모든 메서드가 Promise**다.
//   여기 목은 일부러 비동기 메서드로만 만든다 — await가 하나라도 빠지면 이 테스트가 무너져야 한다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { renderStatusHtml, decodeHitClass } = SimCore.require('render');
const { TEMPLATES } = SimCore.require('templates');
const { seededRng } = SimCore.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── decodeHitClass — 접두 유무 양쪽 + 제안 칩 ──
{
  ck('액션 해독', JSON.stringify(decodeHitClass('sim-action sim-hit sim-hitact-attack')) === '{"kind":"action","id":"attack"}',
    JSON.stringify(decodeHitClass('sim-action sim-hit sim-hitact-attack')));
  ck('x-risu- 접두 붙어도 해독', JSON.stringify(decodeHitClass('x-risu-sim-hit x-risu-sim-hitact-auto_roll'))
    === '{"kind":"action","id":"auto_roll"}');
  ck('선택지 해독', JSON.stringify(decodeHitClass('sim-choice sim-hit sim-hitchoice-2')) === '{"kind":"choice","idx":2}');
  ck('접두 선택지 해독', decodeHitClass('x-risu-sim-choice x-risu-sim-hitchoice-0').idx === 0);
  ck('제안 칩 해독 (v0.43)', JSON.stringify(decodeHitClass('sim-hit sim-hitsug-1')) === '{"kind":"suggest","idx":1}');
  ck('무관한 클래스는 null', decodeHitClass('sim-status sim-row') === null);
  ck('비슷하지만 다른 이름은 null', decodeHitClass('sim-hitactive-x sim-hitchoices-1') === null);
}

// ── 렌더가 히트 클래스를 심는가 (trpg 범례) ──
{
  const T = TEMPLATES.trpg.schema;
  const st = engine.initState(T); st.meta.setupDone = true;
  const states = (T.actions || []).map((a) => ({
    id: a.id, label: a.label, armed: false, disabled: a.id === 'attack', reason: '기력 없음',
  }));
  const html = renderStatusHtml(T, st, null, states, { uid: 'x' });
  ck('범례에 sim-hitact 클래스', html.includes('sim-hitact-auto_roll'), html.slice(html.indexOf('sim-actions'), html.indexOf('sim-actions') + 300));
  ck('잠긴 액션엔 히트 없음', !html.includes('sim-hitact-attack'), '');
  ck('새 안내 문구', html.includes('눌러서 무장'), '');
}

// ── 렌더가 선택지에 히트 클래스를 심는가 (잠긴 항목 제외) ──
{
  const S = {
    simcore: '0.1', meta: { name: 't' },
    vars: [{ id: 'gold', label: '금화', type: 'int', init: 10, min: 0 }],
    rules: { onTurn: [], events: [
      { id: 'ev', when: 'gold >= 0', timeout: 2, choices: [
        { label: '연다' }, { label: '산다', when: 'gold >= 100' }, { label: '지나친다' },
      ] },
    ], randomEvents: { chancePerTurn: 0, table: [] } },
    updater: { model: 'aux', allow: [] },
    statusUI: { mode: 'auto', groups: [] },
  };
  const st = engine.initState(S); st.meta.setupDone = true; st.meta.turn = 1;
  const o = engine.outputPhase(S, st, {}, {}, { rng: seededRng('k', 1, 'out') });
  const html = renderStatusHtml(S, o.state, null, null, { uid: 'x' });
  ck('열린 선택지에 sim-hitchoice', html.includes('sim-hitchoice-0') && html.includes('sim-hitchoice-2'), html);
  ck('잠긴 선택지엔 히트 없음', !html.includes('sim-hitchoice-1'), html);
  ck('안내가 클릭 우선', html.includes('눌러서 고르거나'), html);

  // ── pickChoice — 클릭과 /선택이 같은 눈으로 보는 검증기 ──
  ck('정상 선택 ok', engine.pickChoice(S, o.state, 0).ok && engine.pickChoice(S, o.state, 0).label === '연다');
  ck('잠긴 선택 거부', engine.pickChoice(S, o.state, 1).ok === false && engine.pickChoice(S, o.state, 1).locked === true,
    JSON.stringify(engine.pickChoice(S, o.state, 1)));
  ck('범위 밖 거부', engine.pickChoice(S, o.state, 9).ok === false);
  ck('갈림길 없으면 거부', engine.pickChoice(S, st, 0).ok === false);
  const r = engine.applyChatCommands(S, o.state, '/선택 2');
  ck('/선택도 같은 사유로 거부', r.text.includes('지금 고를 수 없음 🔒') && r.pick === null, r.text);
  const r2 = engine.applyChatCommands(S, o.state, '/선택 1');
  ck('/선택 정상 경로 그대로', r2.pick === 0 && r2.text.includes('(시스템: 선택 — 1. 연다)'), r2.text);
}

// ── ★ 히트 루프 실구동 — 어댑터의 onDocClick을 비동기 RPC 목으로 돌린다 ──
// 번들에서 safeCall~onDocClick 본문을 그대로 뽑아 의존만 주입한다. 코드가 바뀌면 여기가 같이 죈다.
{
  const start = src.indexOf('async function safeCall');
  const end = src.indexOf('// 제안 칩 클릭');
  const body = src.slice(start, end);
  ck('어댑터에서 히트 루프 추출됨', start > 0 && end > start && body.includes('async function onDocClick'), '');

  const makeLoop = (els, hits) => {
    const f = new Function('session', 'schema', 'hitDoc', 'panelVisible',
      'decodeHitClass', 'onActionButton', 'onChoiceClick', 'onSuggestionClick', 'console',
      'let hitLastClick = null;\n' + body + '\nreturn onDocClick;');
    return f({ current: { meta: {} } }, { vars: [] },
      { querySelectorAll: async () => els }, false, decodeHitClass,
      async (id) => hits.push(['action', id]),
      async (i) => hits.push(['choice', i]),
      async (i) => hits.push(['suggest', i]),
      { log: () => {} });
  };
  // RPC 프록시형 목: 전부 "비동기 메서드"다 — 실기와 같은 형태. length()·at()·getClassName() 다 Promise.
  const mkEl = (cls, rect) => ({
    getClassName: async () => cls,
    getBoundingClientRect: async () => rect,
  });
  const mkList = (arr) => ({ length: async () => arr.length, at: async (i) => arr[i] });

  const run = async () => {
    // 좌표 명중 → 액션 디스패치 (첫 명중 하나만)
    let hits = [];
    let els = mkList([
      mkEl('sim-hit sim-hitact-forge', { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }),
      mkEl('sim-hit sim-hitact-forge', { left: 10, top: 100, right: 110, bottom: 130, width: 100, height: 30 }),
    ]);
    await makeLoop(els, hits)({ button: 0, clientX: 50, clientY: 20 });
    ck('★ 비동기 목에서 좌표 명중 → 액션 (v0.42 무반응 회귀)', JSON.stringify(hits) === '[["action","forge"]]', JSON.stringify(hits));

    hits = [];
    await makeLoop(els, hits)({ button: 0, clientX: 500, clientY: 500 });
    ck('빗나가면 디스패치 없음', hits.length === 0, JSON.stringify(hits));

    hits = [];
    els = mkList([mkEl('x-risu-sim-hit x-risu-sim-hitchoice-1', { left: 0, top: 0, right: 50, bottom: 20, width: 50, height: 20 })]);
    await makeLoop(els, hits)({ button: 0, clientX: 5, clientY: 5 });
    ck('접두 붙은 선택지 클릭 → choice', JSON.stringify(hits) === '[["choice",1]]', JSON.stringify(hits));

    hits = [];
    els = mkList([mkEl('sim-hit sim-hitsug-0', { left: 0, top: 0, right: 50, bottom: 20, width: 50, height: 20 })]);
    await makeLoop(els, hits)({ button: 0, clientX: 5, clientY: 5 });
    ck('제안 칩 클릭 → suggest', JSON.stringify(hits) === '[["suggest",0]]', JSON.stringify(hits));

    hits = [];
    els = mkList([mkEl('sim-hit sim-hitact-x', { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })]);
    await makeLoop(els, hits)({ button: 0, clientX: 0, clientY: 0 });
    ck('접힌 요소(0×0)는 제외', hits.length === 0, JSON.stringify(hits));

    hits = [];
    els = mkList([mkEl('sim-hit sim-hitact-y', { left: 0, top: 0, right: 50, bottom: 20, width: 50, height: 20 })]);
    await makeLoop(els, hits)({ button: 2, clientX: 5, clientY: 5 });
    ck('우클릭은 무시', hits.length === 0, JSON.stringify(hits));

    // 실물 DOM형 목(프로퍼티·배열)도 안 죽는다 — safeCall/양쪽 형태 방어
    hits = [];
    const plain = [{ className: 'sim-hit sim-hitact-z', getBoundingClientRect: async () => ({ left: 0, top: 0, right: 9, bottom: 9, width: 9, height: 9 }) }];
    await makeLoop(plain, hits)({ button: 0, clientX: 3, clientY: 3 });
    ck('실물 DOM 형태(length 프로퍼티)도 동작', JSON.stringify(hits) === '[["action","z"]]', JSON.stringify(hits));
  };
  module.exports = run(); // 아래 마무리가 기다린다
}

// ── 어댑터 배선 (기능은 반드시 배선과 함께) ──
{
  ck('getRootDocument 사용', src.includes('Risuai.getRootDocument()'), '');
  ck('문서 클릭 리스너', src.includes("addEventListener('click'"), '');
  ck('★ 캡처 단계 등록 (조작줄처럼 버블이 막히는 영역 면역)', src.includes('onDocClick(ev); }, true)'), '');
  ck('제안 클릭 실패 가시화 (조용한 무반응 금지)', src.includes('sugNotice'), '');
  ck('플러그인 프로바이더 전송 차단 = 클립보드 복사 강등', src.includes("includes('plugin-based model')")
    && src.includes('navigator.clipboard.writeText'), '');
  ck('복사 모드 힌트 + 복사 불가 폴백', src.includes('누르면 복사 — 입력창에 붙여넣기')
    && src.includes('보고 따라 입력'), '');
  ck('제안 갈리면 ✓ 리셋', src.includes('lastSugSig'), '');
  ck('진단에 상태창·조작줄 존재 카운트', src.includes('[data-plugin-chat-panel]'), '');
  ck('히트 셀렉터', src.includes('[class*="sim-hit"]'), '');
  ck('클릭 액션 = 우상단 버튼 경로 재사용', src.includes('onActionButton(hit.id)'), '');
  ck('클릭 선택 = pickChoice 공용', src.includes('engine.pickChoice(schema, session.current, idx)'), '');
  ck('조작줄 setChatPanel', src.includes("id: 'simcore-strip'"), '');
  ck('패널 열림 가드', src.includes('panelVisible'), '');
  ck('★ 패널 열림 중엔 권한 요청을 미룬다 (자동 거부 사고 방지)', src.includes("hitState = 'pending'"), '');
  ck('권한 거부 안내에 방패 아이콘 경로', src.includes('방패 아이콘'), '');
  ck('다시 연결 버튼', src.includes('sc-hitretry'), '');
  ck('제안 칩 = sendChat 경로', src.includes('Risuai.sendChat('), '');

  // ── 상태창 제자리 갱신 (v0.85.4) — 패널 조작이 채팅 속 상태창에 바로 보이게 ──
  ck('★ 제자리 갱신 함수가 있다', src.includes('async function refreshStatusDom()'), '');
  ck('★ 게임 패널 커밋이 제자리 갱신을 부른다',
    /commitPanelChanges[\s\S]{0,900}refreshStatusDom\(\)/.test(src.slice(src.indexOf('async function commitPanelChanges'))), '');
  ck('★ 안 되는 환경에선 안내를 붙인다 (조용한 실패 금지)',
    src.includes('채팅 속 상태창은 다음 메시지에서 갱신돼요'), '');
  ck('★ 루트 손잡이(simst-)로 찾는다', src.includes('simst-'), '');
  ck('되읽어 반영을 확인한다 (프록시가 쓰기를 버리는 환경 대비)',
    src.includes("safeCall(el, 'getInnerHTML', 'innerHTML')"), '');
}

(async () => {
  await module.exports;
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
