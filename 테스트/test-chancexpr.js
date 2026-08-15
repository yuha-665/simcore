const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.89.1 — randomEvents.chancePerTurn 식 지원.
//
// 배경: 베리디아 난이도 프리셋 재설계(희망적/보통/리얼리티). 프리셋은 변수 초기값만 바꾸는데
// chancePerTurn이 숫자 상수라 "프리셋마다 사건 빈도"가 불가능했다 — "난이도로 조절할 값은
// 변수로 빼고 수식이 읽게 한다" 원칙에서 이 상수만 빠져 있었다.
//
// 불변식:
//   · 숫자 봇은 한 글자도 안 변한다 (하위 호환)
//   · 식은 매 추첨마다 현 상태로 평가된다 — 판 중에 hardship이 변하면 빈도도 따라 변한다
//   · 깨진 식은 0으로 강하 (턴이 죽지 않는다) — 대신 검증이 미리 잡는다
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

const mk = (chance) => ({
  simcore: '0.1', meta: { name: '확률식' },
  vars: [
    { id: 'hardship', label: '시련', type: 'int', init: 0, min: 0, max: 100 },
    { id: 'hits', label: '횟수', type: 'int', init: 0, min: 0 },
  ],
  rules: { randomEvents: { chancePerTurn: chance, table: [
    { id: 'tick', effects: [{ set: 'hits', expr: 'hits + 1' }], notify: '똑' },
  ] } },
});

// ── 검증 ──
{
  ck('★ 숫자는 그대로 통과', validateSchema(mk(0.1)).ok, J(validateSchema(mk(0.1)).errors));
  ck('★ 식 통과', validateSchema(mk('0.04 + hardship * 0.0011')).ok,
    J(validateSchema(mk('0.04 + hardship * 0.0011')).errors));
  ck('없는 변수를 읽는 식은 오류', !validateSchema(mk('0.04 + hardshp * 0.001')).ok, '');
  ck('식 안의 rand()는 오류 (추첨 자체가 이미 주사위다)', !validateSchema(mk('rand(0, 1)')).ok, '');
  ck('범위 밖 숫자는 여전히 오류', !validateSchema(mk(1.5)).ok, '');
}

// ── 굴려서 빈도가 실제로 갈리는가 ──
{
  const run = (chance, hardship, turns = 300) => {
    const S = mk(chance);
    let st = engine.initState(S);
    st.meta.setupDone = true;
    st.vars.hardship = hardship;
    for (let i = 0; i < turns; i++) {
      st = engine.outputPhase(S, st, {}, {}, { rng: seededRng('c', i, 'o') }).state;
    }
    return st.vars.hits;
  };
  const lo = run('hardship * 0.01', 0);
  const mid = run('hardship * 0.01', 50);
  const hi = run('hardship * 0.01', 100);
  ck('★ 시련 0 → 안 온다 (300턴)', lo === 0, `hits=${lo}`);
  ck('★ 시련 50 → 절반쯤 (300턴 중 120~180)', mid >= 120 && mid <= 180, `hits=${mid}`);
  ck('★ 시련 100 → 매턴', hi === 300, `hits=${hi}`);
  // 같은 rng 시드에서 숫자 0.5와 식 '0.5'는 같은 판이어야 한다 — 평가 경로만 다를 뿐
  ck('숫자 0.5 == 식 "0.5" (같은 시드)', run(0.5, 0) === run('0.5', 0), '');
  // 깨진 식(0으로 강하) — 검증을 우회해 억지로 넣어도 턴은 살아야 한다
  const S = mk('hardship *');
  let st = engine.initState(S);
  st.meta.setupDone = true;
  let alive = true;
  try { st = engine.outputPhase(S, st, {}, {}, { rng: seededRng('x', 1, 'o') }).state; }
  catch { alive = false; }
  ck('깨진 식은 0으로 강하 — 턴이 죽지 않는다', alive && st.vars.hits === 0, `alive=${alive} hits=${st?.vars?.hits}`);
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
