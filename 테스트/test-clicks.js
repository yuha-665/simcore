const __P = (...p) => require('path').resolve(__dirname, ...p);
// 클릭 조작(v0.42) — 히트 클래스·해독기·pickChoice 공용 검증·어댑터 배선
// (실제 좌표 히트테스트는 브라우저 DOM 위라 여기선 재료(클래스·사각형 대조에 쓰는 해독기)와
//  경로 공유(클릭=명령과 같은 검증)를 잰다)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { renderStatusHtml, decodeHitClass } = SimCore.require('render');
const { TEMPLATES } = SimCore.require('templates');
const { seededRng } = SimCore.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── decodeHitClass — 접두 유무 양쪽 ──
{
  ck('액션 해독', JSON.stringify(decodeHitClass('sim-action sim-hit sim-hitact-attack')) === '{"kind":"action","id":"attack"}',
    JSON.stringify(decodeHitClass('sim-action sim-hit sim-hitact-attack')));
  ck('x-risu- 접두 붙어도 해독', JSON.stringify(decodeHitClass('x-risu-sim-hit x-risu-sim-hitact-check_str'))
    === '{"kind":"action","id":"check_str"}');
  ck('선택지 해독', JSON.stringify(decodeHitClass('sim-choice sim-hit sim-hitchoice-2')) === '{"kind":"choice","idx":2}');
  ck('접두 선택지 해독', decodeHitClass('x-risu-sim-choice x-risu-sim-hitchoice-0').idx === 0);
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
  ck('범례에 sim-hitact 클래스', html.includes('sim-hitact-check_str'), html.slice(html.indexOf('sim-actions'), html.indexOf('sim-actions') + 300));
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
  // /선택 명령이 같은 검증기를 쓰는지 — 잠긴 항목의 거부 메시지가 pickChoice 사유와 일치
  const r = engine.applyChatCommands(S, o.state, '/선택 2');
  ck('/선택도 같은 사유로 거부', r.text.includes('지금 고를 수 없음 🔒') && r.pick === null, r.text);
  const r2 = engine.applyChatCommands(S, o.state, '/선택 1');
  ck('/선택 정상 경로 그대로', r2.pick === 0 && r2.text.includes('(시스템: 선택 — 1. 연다)'), r2.text);
}

// ── 어댑터 배선 (기능은 반드시 배선과 함께) ──
{
  ck('getRootDocument 사용', src.includes('Risuai.getRootDocument()'), '');
  ck('문서 클릭 리스너', src.includes("addEventListener('click'"), '');
  ck('사각형 대조', src.includes('getBoundingClientRect()'), '');
  ck('히트 셀렉터', src.includes('[class*="sim-hit"]'), '');
  ck('클릭 액션 = 우상단 버튼 경로 재사용', src.includes('onActionButton(hit.id)'), '');
  ck('클릭 선택 = pickChoice 공용', src.includes('engine.pickChoice(schema, session.current, idx)'), '');
  ck('조작줄 setChatPanel', src.includes("setChatPanel(null, { id: 'simcore-strip' })") || src.includes("id: 'simcore-strip'"), '');
  ck('패널 열림 가드', src.includes('panelVisible'), '');
  ck('권한 거부 시 안내', src.includes('mainDom 권한 없음'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
