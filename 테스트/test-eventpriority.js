const __P = (...p) => require('path').resolve(__dirname, ...p);
// 이벤트 우선 규칙이 "있는 턴에만" 붙고, 순서/커스터마이즈/끄기가 동작하는지
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { validateSchema } = SimCore.require('validate');
const { seededRng } = SimCore.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const MARK = '유저의 행동은 그대로 "시도"';

function mk(promptState) {
  return {
    simcore: '0.1', meta: { name: 'T' },
    vars: [{ id: 'hp', type: 'int', init: 100, min: 0, max: 100 }, { id: 'hurt', type: 'bool', init: false }],
    rules: { events: [{ id: 'wound', when: 'hp < 50 and not hurt', effects: [{ set: 'hurt', expr: '1' }], notify: '깊은 상처를 입었다.' }] },
    statusUI: { mode: 'auto', groups: [] },
    promptState: promptState,
  };
}

// ── 이벤트 없는 턴 ──
{
  const sch = mk({ template: 'HP {hp}', includeEvents: true });
  ck('스키마 검증 통과', validateSchema(sch).ok, JSON.stringify(validateSchema(sch).errors));
  const st = engine.initState(sch);
  const block = engine.sendPhase(sch, st, { rng: seededRng('t', 0, 's') }).promptBlock;
  ck('이벤트 없는 턴엔 우선 규칙 안 붙음', !block.includes(MARK), block.slice(0, 200));
  ck('이벤트 없는 턴에도 상태는 나감', block.includes('HP 100'));
}

// ── 이벤트 발동한 다음 턴 ──
{
  const sch = mk({ template: 'HP {hp}', includeEvents: true });
  let st = engine.initState(sch);
  st.vars.hp = 30;
  const out = engine.outputPhase(sch, st, {}, {}, { rng: seededRng('t', 1, 'o') });
  ck('이벤트 발동함', out.firedEvents.includes('wound'), JSON.stringify(out.firedEvents));
  const block = engine.sendPhase(sch, out.state, { rng: seededRng('t', 2, 's') }).promptBlock;
  ck('이벤트 통지가 전달됨', block.includes('[이벤트] 깊은 상처를 입었다.'), block);
  ck('우선 규칙이 붙음', block.includes(MARK), block);
  ck('규칙이 이벤트 바로 뒤에 옴', block.indexOf(MARK) > block.indexOf('[이벤트]'), block);
  ck('규칙이 확정 사실임을 명시', block.includes('확정해 수치까지 반영한 사실'), block.slice(0, 300));
  ck('유저 행동 무시 금지도 명시', block.includes('없던 일로 만들지는 마라'), '');
}

// ── 끄기 ──
{
  const sch = mk({ template: 'HP {hp}', includeEvents: true, eventPriority: false });
  let st = engine.initState(sch); st.vars.hp = 30;
  const out = engine.outputPhase(sch, st, {}, {}, { rng: seededRng('t', 1, 'o') });
  const block = engine.sendPhase(sch, out.state, { rng: seededRng('t', 2, 's') }).promptBlock;
  ck('eventPriority:false면 규칙 안 붙음', !block.includes(MARK), block);
  ck('꺼도 이벤트 통지는 그대로', block.includes('[이벤트] 깊은 상처'), block);
}

// ── 커스텀 문구 + 변수 치환 ──
{
  const sch = mk({ template: 'HP {hp}', includeEvents: true,
    eventPriority: '※ 사건 우선. 현재 HP {hp}에 맞게 써라.' });
  const v = validateSchema(sch);
  ck('커스텀 문구도 검증 통과', v.ok, JSON.stringify(v.errors));
  let st = engine.initState(sch); st.vars.hp = 30;
  const out = engine.outputPhase(sch, st, {}, {}, { rng: seededRng('t', 1, 'o') });
  const block = engine.sendPhase(sch, out.state, { rng: seededRng('t', 2, 's') }).promptBlock;
  ck('커스텀 문구로 대체됨', block.includes('※ 사건 우선.') && !block.includes(MARK), block);
  ck('커스텀 문구도 변수 치환됨', block.includes('현재 HP 30'), block);
}

// ── 잘못된 변수 참조는 검증에서 잡히는지 ──
{
  const sch = mk({ template: 'HP {hp}', eventPriority: '{존재하지않는변수} 우선' });
  const v = validateSchema(sch);
  ck('커스텀 문구의 미지의 변수는 검증 실패', !v.ok && v.errors.some((e) => e.path.includes('eventPriority')),
    JSON.stringify(v.errors));
}

// ── includeEvents:false면 통지도 규칙도 없음 ──
{
  const sch = mk({ template: 'HP {hp}', includeEvents: false });
  let st = engine.initState(sch); st.vars.hp = 30;
  const out = engine.outputPhase(sch, st, {}, {}, { rng: seededRng('t', 1, 'o') });
  const block = engine.sendPhase(sch, out.state, { rng: seededRng('t', 2, 's') }).promptBlock;
  ck('통지 끄면 규칙도 안 붙음', !block.includes(MARK) && !block.includes('[이벤트]'), block);
}

// ── 액션 전달문은 이벤트 규칙 뒤에 온다 (사건 → 플레이어 행동 순) ──
{
  const sch = mk({ template: 'HP {hp}', includeEvents: true });
  sch.actions = [{ id: 'brace', label: '버티기', mode: 'oneshot', inject: '[플레이어 행동] 이를 악문다.', effects: [] }];
  let st = engine.initState(sch); st.vars.hp = 30;
  const out = engine.outputPhase(sch, st, {}, {}, { rng: seededRng('t', 1, 'o') });
  const armed = engine.toggleAction(sch, out.state, 'brace');
  const block = engine.sendPhase(sch, armed.state, { rng: seededRng('t', 2, 's') }).promptBlock;
  ck('액션 전달문도 함께 나감', block.includes('[플레이어 행동] 이를 악문다.'), block);
  ck('순서: 이벤트 → 규칙 → 액션', block.indexOf('[이벤트]') < block.indexOf(MARK)
    && block.indexOf(MARK) < block.indexOf('[플레이어 행동]'), block);
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
