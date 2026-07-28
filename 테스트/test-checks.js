const __P = (...p) => require('path').resolve(__dirname, ...p);
// checks(판정) — v0.40 "완벽 주사위" 실물 검증
// 굴림은 엔진이, AI는 서사만. 결과는 vars가 아니라 meta.lastCheck. 시드라 리롤 안정.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { validateSchema } = SimCore.require('validate');
const { renderStatusHtml } = SimCore.require('render');
const { writerMap } = SimCore.require('diagnose');
const { seededRng } = SimCore.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const clone = (o) => JSON.parse(JSON.stringify(o));

const S = {
  simcore: '0.1',
  meta: { name: 'checks-test' },
  vars: [
    { id: 'hp', label: 'HP', type: 'int', init: 20, min: 0, max: 40 },
    { id: 'mp', label: 'MP', type: 'int', init: 5, min: 0, max: 20 },
    { id: 'luck', label: '운', type: 'int', init: 2, min: 0, max: 10 },
    { id: 'flag', label: '깃발', type: 'bool', init: false },
  ],
  derived: [{ id: 'luck_mod', label: '운 보정', expr: 'luck' }],
  rules: {
    onTurn: [],
    events: [
      { id: 'ev_check', when: 'flag', check: 'blessing',
        effects: [{ set: 'flag', expr: '0' }], notify: '하늘이 응답했다.' },
    ],
    randomEvents: { chancePerTurn: 0, table: [] },
  },
  checks: [
    { id: 'basic', label: '기본 판정', roll: 'rand(1, 20)', mod: 'luck_mod', vs: 15,
      grades: [
        { when: 'roll == 20', label: '대성공', inject: '극적으로.', effects: [{ set: 'mp', expr: 'mp + 2' }] },
        { when: 'total >= vs', label: '성공', effects: [{ set: 'mp', expr: 'mp + 1' }] },
        // 실패 효과가 overlay(vs·total)를 산술에 쓴다 — 모자란 만큼 아프다
        { label: '실패', effects: [{ set: 'hp', expr: 'hp - (vs - total)' }] },
      ] },
    { id: 'blessing', label: '가호 판정', roll: 'rand(1, 6)',
      grades: [{ when: 'roll >= 4', label: '성공' }, { label: '실패' }] },
  ],
  actions: [
    { id: 'try', label: '🎲 시도', mode: 'oneshot', check: 'basic',
      inject: '[행동] 시도한다.', effects: [{ set: 'luck', expr: '0' }] },
  ],
  updater: { model: 'aux', allow: [{ id: 'hp', maxDelta: 10 }, { id: 'flag' }] },
  promptState: { includeEvents: true },
  statusUI: { mode: 'template', template: '<div class="lc">{lastcheck}</div>{commands}' },
};

const fresh = () => { const s = engine.initState(S); s.meta.setupDone = true; s.meta.turn = 1; return s; };
const armSend = (st, seed) =>
  engine.sendPhase(S, engine.toggleAction(S, st, 'try').state, { rng: seededRng('t', seed, 'send') });

// ── 검증기: 정상 스키마 ──
{
  const v = validateSchema(S);
  ck('정상 checks 스키마 통과', v.ok, JSON.stringify(v.errors));
}

// ── 검증기: 오류·경고 ──
{
  const bad = (mut) => { const c = clone(S); mut(c); return validateSchema(c); };
  ck('roll 없음 = 오류', !bad((c) => { delete c.checks[0].roll; }).ok);
  ck('mod에 rand = 오류', !bad((c) => { c.checks[0].mod = 'rand(1, 4)'; }).ok);
  ck('등급 when에 rand = 오류', !bad((c) => { c.checks[0].grades[0].when = 'rand(1, 2) == 1'; }).ok);
  ck('grades 비면 = 오류', !bad((c) => { c.checks[0].grades = []; }).ok);
  ck('액션 check 참조가 없으면 = 오류', !bad((c) => { c.actions[0].check = 'nope'; }).ok);
  ck('이벤트 check 참조가 없으면 = 오류', !bad((c) => { c.rules.events[0].check = 'nope'; }).ok);
  ck('판정 id가 변수와 겹치면 = 오류', !bad((c) => { c.checks[0].id = 'hp'; }).ok);
  ck('판정 id 중복 = 오류', !bad((c) => { c.checks[1].id = 'basic'; }).ok);
  ck('vs 없는 판정의 등급이 vs를 쓰면 = 오류', !bad((c) => { c.checks[1].grades[0].when = 'total >= vs'; }).ok);
  ck('등급 효과의 모르는 변수 = 오류', !bad((c) => { c.checks[0].grades[0].effects = [{ set: 'nope', expr: '1' }]; }).ok);
  ck('등급 효과가 total을 쓰는 건 정상', bad((c) => { c.checks[0].grades[0].effects = [{ set: 'mp', expr: 'total' }]; }).ok);
  const wAfter = bad((c) => { c.checks[1].grades.push({ when: 'roll == 6', label: '뒤' }); });
  ck('기본 등급 뒤의 등급 = 경고', wAfter.ok && wAfter.warnings.some((w) => w.msg.includes('영원히 안 나옴')),
    JSON.stringify(wAfter.warnings));
  const wNoCatch = bad((c) => { c.checks[1].grades = [{ when: 'roll >= 4', label: '성공' }]; });
  ck('기본 등급 없음 = 경고', wNoCatch.ok && wNoCatch.warnings.some((w) => w.msg.includes('조건 없는 등급이 없습니다')),
    JSON.stringify(wNoCatch.warnings));
  const wShadow = bad((c) => { c.vars.push({ id: 'roll', label: '굴림', type: 'int', init: 0 }); });
  ck('변수 roll이 판정과 공존 = 가려짐 경고', wShadow.warnings.some((w) => w.msg.includes('가려집니다')),
    JSON.stringify(wShadow.warnings));
}

// ── 액션 판정: 같은 턴 흐름 ──
{
  const s = armSend(fresh(), 11);
  const lc = s.state.meta.lastCheck;
  ck('lastCheck 기록됨', !!lc, JSON.stringify(lc));
  ck('d20 범위', lc.roll >= 1 && lc.roll <= 20, String(lc.roll));
  ck('보정은 굴림 시점 값 (luck=2, 액션 효과로 0 되기 전)', lc.mod === 2, String(lc.mod));
  ck('합계 = 눈 + 보정', lc.total === lc.roll + 2, `${lc.total} vs ${lc.roll}+2`);
  ck('액션 효과는 굴림 뒤 적용 (luck 소모)', s.state.vars.luck === 0, String(s.state.vars.luck));
  const exp = lc.roll === 20 ? '대성공' : (lc.total >= 15 ? '성공' : '실패');
  ck('등급 첫 매치', lc.grade === exp, `${lc.grade} / roll ${lc.roll} total ${lc.total}`);
  ck('[판정] 줄이 프롬프트에 실림', s.promptBlock.includes(`[판정] 기본 판정: ${lc.roll} + 2 = ${lc.total} vs 15 → ${lc.grade}`),
    s.promptBlock);
  ck('판정 규칙 줄 자동 부착', s.promptBlock.includes('뒤집어 서술하지 마라'), s.promptBlock);
  const iAct = s.promptBlock.indexOf('[행동] 시도한다.');
  const iChk = s.promptBlock.indexOf('[판정] 기본 판정');
  ck('의도([행동])가 결과([판정])보다 먼저', iAct >= 0 && iChk > iAct, `${iAct} vs ${iChk}`);
  ck('changeLog에 판정 줄 (source check:)', s.changeLog.some((c) => c.source === 'check:basic' && String(c.to).includes('→')),
    JSON.stringify(s.changeLog));
  ck('리롤 = 같은 눈', armSend(fresh(), 11).state.meta.lastCheck.roll === lc.roll);
}

// ── 등급별 효과가 실제로 갈리는가 ──
{
  let crit = null, hit = null, miss = null;
  for (let i = 0; i < 600 && !(crit && hit && miss); i++) {
    const s = armSend(fresh(), i);
    const g = s.state.meta.lastCheck.grade;
    if (g === '대성공' && !crit) crit = s.state;
    if (g === '성공' && !hit) hit = s.state;
    if (g === '실패' && !miss) miss = s.state;
  }
  ck('세 등급 모두 발생', !!(crit && hit && miss), `${!!crit} ${!!hit} ${!!miss}`);
  if (crit) ck('대성공 효과 (mp +2)', crit.vars.mp === 7, String(crit.vars.mp));
  if (hit) ck('성공 효과 (mp +1)', hit.vars.mp === 6, String(hit.vars.mp));
  if (miss) {
    const lc = miss.meta.lastCheck;
    ck('실패 효과가 overlay 산술 사용 (hp -= vs-total)', miss.vars.hp === 20 - (15 - lc.total),
      `hp ${miss.vars.hp}, total ${lc.total}`);
    ck('실패엔 mp 그대로', miss.vars.mp === 5, String(miss.vars.mp));
  }
}

// ── 이벤트 판정: 결과는 다음 전송에 통지로 ──
{
  const st = fresh(); st.vars.flag = true;
  const out = engine.outputPhase(S, st, {}, {}, { rng: seededRng('t', 77, 'out') });
  ck('이벤트 발동', out.firedEvents.includes('ev_check'), JSON.stringify(out.firedEvents));
  ck('이벤트 효과 적용 (깃발 내림)', out.state.vars.flag === false);
  const pn = out.state.meta.pendingNotifies;
  ck('통지에 서술 + [판정] 줄', pn.length === 2 && pn[0] === '하늘이 응답했다.' && pn[1].startsWith('[판정] 가호 판정:'),
    JSON.stringify(pn));
  const s2 = engine.sendPhase(S, out.state, { rng: seededRng('t', 78, 'send') });
  ck('서술은 [이벤트]로 감싸짐', s2.promptBlock.includes('[이벤트] 하늘이 응답했다.'), s2.promptBlock);
  ck('[판정] 줄은 [이벤트]로 안 감싸짐', s2.promptBlock.includes('\n[판정] 가호 판정:')
    && !s2.promptBlock.includes('[이벤트] [판정]'), s2.promptBlock);
  ck('통지로 온 판정에도 규칙 줄', s2.promptBlock.includes('뒤집어 서술하지 마라'));
}

// ── checkGuide 옵션 ──
{
  const off = clone(S); off.promptState.checkGuide = false;
  const s1 = engine.sendPhase(off, engine.toggleAction(off, fresh(), 'try').state, { rng: seededRng('t', 5, 'send') });
  ck('checkGuide: false → 규칙 줄 없음', !s1.promptBlock.includes('뒤집어 서술하지'), s1.promptBlock);
  const cus = clone(S); cus.promptState.checkGuide = '커스텀 규칙 (HP {hp})';
  const s2 = engine.sendPhase(cus, engine.toggleAction(cus, fresh(), 'try').state, { rng: seededRng('t', 5, 'send') });
  ck('checkGuide: 문자열 → 대체 + 자리표시자', s2.promptBlock.includes('커스텀 규칙 (HP 20)'), s2.promptBlock);
  ck('판정 없는 턴엔 규칙 줄 없음', !engine.sendPhase(S, fresh(), { rng: seededRng('t', 6, 'send') })
    .promptBlock.includes('뒤집어 서술하지'));
}

// ── 상태창: {lastcheck} + 변화 로그 ──
{
  const before = renderStatusHtml(S, fresh(), null, null, { uid: 'x' });
  ck('판정 전 {lastcheck}는 빈 문자열', before.includes('<div class="lc"></div>'), before);
  const s = armSend(fresh(), 11);
  const html = renderStatusHtml(S, s.state, s.changeLog, null, { uid: 'x' });
  const lc = s.state.meta.lastCheck;
  ck('{lastcheck}에 판정 한 줄', html.includes(`기본 판정: ${lc.roll} + 2 = ${lc.total} vs 15 → ${lc.grade}`), html);
  ck('변화 로그에 🎲 줄', html.includes('🎲'), html);
}

// ── rollCheck 방어 ──
{
  const st = fresh();
  const broken = engine.rollCheck(S, st, { id: 'x', label: 'x', roll: 'no_such_var + 1', grades: [{ label: 'x' }] },
    seededRng('t', 1, 'x'), []);
  ck('깨진 굴림식 → null (요청은 안 죽는다)', broken === null);
  const noMatch = engine.rollCheck(S, st, { id: 'y', label: 'y', roll: 'rand(1, 6)',
    grades: [{ when: 'roll > 99', label: '불가' }] }, seededRng('t', 2, 'y'), []);
  ck('아무 등급도 안 맞으면 (등급 없음)', noMatch.line.includes('(등급 없음)'), noMatch.line);
}

// ── 진단 writerMap: 등급 효과도 기록자로 ──
{
  const w = writerMap(S);
  ck('mp의 기록자에 판정', w.mp && w.mp.has('판정'), JSON.stringify([...(w.mp || [])]));
}

// ── 편집기 배선 (v0.35 cmd·v0.37 mentions 3호 사고 방지 — 기능은 반드시 칸과 함께) ──
{
  ck('판정 탭 등록', src.includes("['checks', '판정']"), '');
  ck('탭 디스패치에 tabChecks', src.includes('checks: tabChecks'), '');
  ck('액션 행에 판정 선택 칸', src.includes("pair('판정', bindSelect(a.check"), '');
  ck('액션 버튼 만들기 도우미', src.includes('액션 버튼 만들기'), '');
  ck('AI 내보내기 슬라이스', src.includes("checks: { keys: ['checks'], label: '판정' }"), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
