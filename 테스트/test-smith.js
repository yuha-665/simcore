const __P = (...p) => require('path').resolve(__dirname, ...p);
// 대장간 템플릿 — v0.39~0.42 신기능 총집합의 실물 배선 검증
// 금고는 버튼 턴에만 열리고(whenArmed), 단조는 판정이 정하고(check), 갈림길은 고르거나 흘러간다(choices).
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { validateSchema } = SimCore.require('validate');
const { renderStatusHtml } = SimCore.require('render');
const { writerMap } = SimCore.require('diagnose');
const { TEMPLATES } = SimCore.require('templates');
const { seededRng } = SimCore.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const clone = (o) => JSON.parse(JSON.stringify(o));

const SCH = TEMPLATES.smith.schema;
const fresh = () => engine.initState(SCH);

// ── 등록·검증·배선 지도 ──
{
  ck('템플릿 등록', !!TEMPLATES.smith && TEMPLATES.smith.label.includes('대장간'), TEMPLATES.smith?.label);
  const v = validateSchema(SCH);
  ck('검증 통과', v.ok, v.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
  ck('경고 0건', v.warnings.length === 0, v.warnings.map((w) => `${w.path}: ${w.msg}`).join(' / '));
  const wm = writerMap(SCH);
  ck('금고는 AI 전용 (버튼이 문지기)', [...wm.vault].every((w) => w === 'AI' || w === '새 시작'), JSON.stringify([...wm.vault]));
  ck('지갑은 판정·선택·액션이 함께 쓴다', wm.money.has('판정') && wm.money.has('선택') && wm.money.has('액션'));
  ck('주문서는 랜덤이 넣고 액션이 지운다', wm.queue.has('랜덤') && wm.queue.has('액션') && wm.queue.has('선택'));
}

// ── whenArmed(액션 잠금): 금고는 입금/출금 턴에만 열린다 ──
{
  const st = fresh();
  const idsOf = (s) => engine.auxAllowList(SCH, null, s).map((a) => a.id);
  ck('평소엔 금고가 닫혀 있다', !idsOf(st).includes('vault') && idsOf(st).includes('money'), JSON.stringify(idsOf(st)));
  const dep = clone(st); dep.meta.armed.deposit = true;
  ck('입금 무장 → 금고 개방', idsOf(dep).includes('vault'));
  const wd = clone(st); wd.meta.armed.withdraw = true;
  ck('출금 무장 → 금고 개방', idsOf(wd).includes('vault'));
  // 변수 명세 줄('- vault (')로 본다 — guide 산문에도 vault가 언급되므로 통짜 검색은 안 된다
  const p0 = engine.buildAuxPrompt(SCH, st, '서사', '입력');
  const p1 = engine.buildAuxPrompt(SCH, dep, '서사', '입력');
  ck('보조 프롬프트: 평소엔 vault 명세 없음', !p0.includes('- vault ('), p0.split('\n').filter((l) => l.includes('vault')).join(' | '));
  ck('보조 프롬프트: 무장 턴엔 vault 명세 있음', p1.includes('- vault ('));
}

// ── 액션 판정: 벼려낸다 → 단조 판정이 그 자리에서 구른다 ──
{
  const grades = new Set();
  let bad = null;
  for (let i = 0; i < 200 && !bad; i++) {
    const st = fresh(); st.meta.armed.forge = true;
    const send = engine.sendPhase(SCH, st, { rng: seededRng('sm', i, 'send') });
    const lc = send.state.meta.lastCheck;
    if (!lc || lc.id !== 'ck_forge') { bad = `턴 ${i}: lastCheck ${JSON.stringify(lc)}`; break; }
    grades.add(lc.grade);
    const { money, iron, stamina } = send.state.vars;
    // 등급-효과 일관성: 성공은 공임, 대실패는 재료 하나 더
    if ((lc.grade === '성공' || lc.grade === '대성공') && !(money > 800)) bad = `턴 ${i}: ${lc.grade}인데 money ${money}`;
    if (lc.grade === '실패' && money !== 800) bad = `턴 ${i}: 실패인데 money ${money}`;
    if (lc.grade === '대실패' && iron !== 4) bad = `턴 ${i}: 대실패인데 iron ${iron}`;
    if (lc.grade !== '대실패' && iron !== 5) bad = `턴 ${i}: iron ${iron}`;
    if (stamina !== 6) bad = `턴 ${i}: stamina ${stamina}`;
    if (!send.promptBlock.includes('[판정] 단조 판정')) bad = `턴 ${i}: promptBlock에 판정 줄 없음`;
  }
  ck('200시드 등급-효과 일관', !bad, bad || '');
  ck('네 등급 모두 관측', ['대성공', '성공', '실패', '대실패'].every((g) => grades.has(g)), [...grades].join(','));
  // 화로 달굼은 소모품 — 굴림이 읽고, 벼려내면 식는다
  const st = fresh(); st.vars.stoked = true; st.meta.armed.forge = true;
  const send = engine.sendPhase(SCH, st, { rng: seededRng('sm', 7, 'send') });
  ck('벼려내면 화로가 식는다', send.state.vars.stoked === false);
  // 같은 시드 = 같은 굴림 (리롤 안정)
  const a = engine.sendPhase(SCH, (() => { const s = fresh(); s.meta.armed.forge = true; return s; })(), { rng: seededRng('sm', 42, 'send') });
  const b = engine.sendPhase(SCH, (() => { const s = fresh(); s.meta.armed.forge = true; return s; })(), { rng: seededRng('sm', 42, 'send') });
  ck('같은 시드 = 같은 판정', a.state.meta.lastCheck.roll === b.state.meta.lastCheck.roll
    && a.state.vars.money === b.state.vars.money);
  // 숯값 — 화로 달구기는 지갑에서 나간다
  const sk = fresh(); sk.meta.armed.stoke = true;
  const s2 = engine.sendPhase(SCH, sk, { rng: seededRng('sm', 3, 'send') });
  ck('화로 달구기 = 숯값 10G', s2.state.vars.money === 790 && s2.state.vars.stoked === true, String(s2.state.vars.money));
}

// ── 갈림길: 귀족 의뢰 (조건 이벤트 · 잠긴 선택지 · 타임아웃) ──
// 랜덤 이벤트를 꺼서 결정적으로 만든다 — 갈림길 자리는 하나뿐이라 행상이 끼면 순서가 흔들린다.
const SCH2 = clone(SCH); SCH2.rules.randomEvents.chancePerTurn = 0;
{
  const st = fresh(); st.vars.fame = 45;
  const o = engine.outputPhase(SCH2, st, {}, {}, { rng: seededRng('nb', 1, 'out') });
  ck('평판 25 → 귀족 의뢰 발동', o.state.meta.pendingChoice?.id === 'noble_offer', JSON.stringify(o.state.meta.pendingChoice));
  ck('통지에 남작가', o.state.meta.pendingNotifies.some((n) => n.includes('남작가')), JSON.stringify(o.state.meta.pendingNotifies));
  const html = renderStatusHtml(SCH2, o.state, null, null, { uid: 'x' });
  ck('선택지 렌더', html.includes('의뢰를 받는다') && html.includes('정중히 거절한다'));
  ck('평판 45: 웃돈은 잠김(🔒)', html.includes('🔒'), html.slice(0, 200));
  ck('잠긴 항목엔 클릭 히트 없음', html.includes('sim-hitchoice-0') && !html.includes('sim-hitchoice-1') && html.includes('sim-hitchoice-2'));
  // 공용 검증기 — /선택과 클릭이 같은 문을 지난다
  const pv = (i, s) => engine.pickChoice(SCH2, { meta: s.meta, vars: s.vars }, i);
  ck('잠긴 선택지 거부', pv(1, o.state).ok === false && pv(1, o.state).locked === true, JSON.stringify(pv(1, o.state)));
  ck('열린 선택지 허용', pv(0, o.state).ok === true && pv(0, o.state).label === '의뢰를 받는다');
  const rich = clone(o.state); rich.vars.fame = 55;
  ck('평판 50 넘으면 웃돈 개방', pv(1, rich).ok === true);
  // 고르면 다음 전송에서 집행된다
  const picked = clone(o.state); picked.meta.pendingChoicePick = 0;
  const send = engine.sendPhase(SCH2, picked, { rng: seededRng('nb', 2, 'send') });
  ck('집행: 주문서에 예장검', send.state.vars.queue.includes('남작가의 예장검'), JSON.stringify(send.state.vars.queue));
  ck('집행: 난이도 17', send.state.vars.dc === 17);
  ck('집행: 다음 의뢰 문턱 상승 (재발동 제어)', send.state.vars.noble_next === 70, String(send.state.vars.noble_next));
  ck('집행: [선택] 줄 주입', send.promptBlock.includes('[선택] 의뢰를 받는다'));
  ck('집행 후 대기 해소', send.state.meta.pendingChoice === null && send.state.meta.pendingChoicePick === null);
}

// ── 타임아웃: 3턴 안 고르면 마지막 항목(정중히 거절)으로 흘러간다 ──
{
  let st = fresh(); st.vars.fame = 45;
  st = engine.outputPhase(SCH2, st, {}, {}, { rng: seededRng('to', 1, 'out') }).state;
  const notified = [];
  for (let i = 2; i <= 5; i++) {
    st = engine.sendPhase(SCH2, st, { rng: seededRng('to', i, 'send') }).state;
    st = engine.outputPhase(SCH2, st, {}, {}, { rng: seededRng('to', i, 'out') }).state;
    notified.push(...st.meta.pendingNotifies);
  }
  ck('타임아웃으로 해소', st.meta.pendingChoice?.id !== 'noble_offer', JSON.stringify(st.meta.pendingChoice));
  ck('자동 결정 = 정중히 거절', notified.some((n) => n.includes('정중히 거절한다')), JSON.stringify(notified));
  ck('거절이라 주문서는 그대로', !st.vars.queue.includes('남작가의 예장검'), JSON.stringify(st.vars.queue));
}

// ── 이벤트 판정·과로·주문서 회전 ──
{
  const rush = SCH.rules.randomEvents.table.find((e) => e.id === 'rush_order');
  ck('밤샘 주문이 단조 판정을 나눠 쓴다', rush?.check === 'ck_forge');
  // 과로 — 회복(+1)이 먼저 돌므로 문턱은 1이다 (0이면 영영 안 터진다)
  let st = fresh(); st.vars.stamina = 0;
  const o = engine.outputPhase(SCH2, st, {}, {}, { rng: seededRng('bo', 1, 'out') });
  ck('과로 이벤트 발동 → 강제 휴식 3', o.state.vars.stamina === 3
    && o.state.meta.pendingNotifies.some((n) => n.includes('팔이')), JSON.stringify(o.state.vars.stamina));
  // 벼려내면 동네 주문이 하나 지워진다
  const q = fresh(); q.vars.queue = ['동네 주문', '동네 주문']; q.meta.armed.forge = true;
  const s = engine.sendPhase(SCH, q, { rng: seededRng('qu', 1, 'send') });
  ck('벼려내기 = 동네 주문 1건 처리', s.state.vars.queue.length === 1, JSON.stringify(s.state.vars.queue));
  // 프리셋
  const p = engine.applyPreset(SCH, fresh(), 'famed');
  ck('프리셋 famed 적용', p.applied && p.state.vars.fame === 45 && p.state.vars.vault === 800);
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
