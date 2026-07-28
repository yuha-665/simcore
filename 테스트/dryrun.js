const __P = (...p) => require('path').resolve(__dirname, ...p);
// 스키마 정밀 진단 — 검증기가 못 잡는 "문법은 맞지만 게임이 안 되는" 문제를 찾는다.
// 드라이런 리포트 기능의 시제품. 사용법: node dryrun.js <스키마 또는 세이브 json> [턴수] [시드수]
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const { seededRng } = SC.require('rng');

const file = process.argv[2];
const TURNS = Number(process.argv[3] || 60);
const RUNS = Number(process.argv[4] || 8);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = raw.schema ?? raw;

const H = (t) => console.log(`\n\x1b[1m── ${t} ──\x1b[0m`);
const findings = [];
const say = (sev, msg) => { findings.push([sev, msg]); console.log(`   ${sev === 'high' ? '🔴' : sev === 'mid' ? '🟡' : '🔵'} ${msg}`); };
const ok = (msg) => console.log(`   ✅ ${msg}`);

console.log(`\x1b[1m${schema.meta?.name ?? '(이름 없음)'}\x1b[0m  —  ${TURNS}턴 × ${RUNS}시드`);
console.log(`변수 ${schema.vars.length} / 파생 ${(schema.derived || []).length} / 액션 ${(schema.actions || []).length}`
  + ` / onTurn ${(schema.rules?.onTurn || []).length} / 이벤트 ${(schema.rules?.events || []).length}`
  + ` / 랜덤 ${(schema.rules?.randomEvents?.table || []).length} / 지시문 ${(schema.directives || []).length}`);

// ── 1. 정적 검증 ──────────────────────────────────────────
H('검증기');
const v = validateSchema(schema);
if (v.ok) ok('오류 0건');
else for (const e of v.errors) say('high', `${e.path} — ${e.msg}`);
for (const w of v.warnings) say('mid', `${w.path} — ${w.msg}`);

// ── 2. 누가 이 변수를 바꾸는가 ────────────────────────────
H('변수를 바꾸는 주체');
const ACT = schema.actions || [];
const EV = schema.rules?.events || [];
const RND = schema.rules?.randomEvents?.table || [];
const ON = schema.rules?.onTurn || [];
const writers = {}; // id -> Set(주체)
const addW = (id, who) => { if (!id) return; (writers[id] = writers[id] || new Set()).add(who); };
for (const r of ON) addW(r.set ?? r.list, 'onTurn');
for (const e of EV) for (const f of (e.effects || [])) addW(f.set ?? f.list, '이벤트');
for (const e of RND) for (const f of (e.effects || [])) addW(f.set ?? f.list, '랜덤');
for (const a of ACT) for (const f of (a.effects || [])) addW(f.set ?? f.list, '액션');
for (const a of (schema.updater?.allow || [])) addW(a.id, 'AI');
for (const id of (schema.setup?.ai?.vars || [])) addW(id, '최초설정');

const neverSet = schema.vars.filter((x) => !writers[x.id]);
if (!neverSet.length) ok('모든 변수에 값을 바꾸는 주체가 있음');
for (const x of neverSet) {
  say('high', `'${x.id}'(${x.label ?? ''})를 바꾸는 곳이 하나도 없음 — 시작값 ${JSON.stringify(x.init)}에서 영원히 고정. `
    + '파생 변수로 빼거나, 규칙·액션에서 set 하도록 만들어야 함');
}
// 파생이 고정 변수만 참조하면 파생도 고정이다
const fixedIds = new Set(neverSet.map((x) => x.id));
for (const d of (schema.derived || [])) {
  const refs = (d.expr.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || []).filter((n) => schema.vars.some((x) => x.id === n));
  if (refs.length && refs.every((n) => fixedIds.has(n))) say('mid', `파생 '${d.id}'는 고정 변수만 참조 — 값이 절대 안 변함`);
}

// ── 3. 드라이런 ───────────────────────────────────────────
const allEvIds = [...EV.map((e) => e.id), ...RND.map((e) => e.id)];
function run(seedTag, play) {
  let st = engine.initState(schema);
  const fired = {}, actUsed = {}, actEver = {}, hist = [st.vars];
  let collapseTurn = null;
  for (let i = 0; i < TURNS; i++) {
    if (play) { // 플레이어처럼: 쓸 수 있는 액션 중 하나를 무장
      const avail = ACT.filter((a) => engine.actionAvailability(schema, st, a).ok);
      for (const a of avail) actEver[a.id] = true;
      if (avail.length) {
        const pick = avail[Math.floor(seededRng(seedTag, i, 'pick')() * avail.length)];
        const t = engine.toggleAction(schema, st, pick.id);
        if (t.armed) { st = t.state; actUsed[pick.id] = (actUsed[pick.id] || 0) + 1; }
      }
    } else {
      for (const a of ACT) if (engine.actionAvailability(schema, st, a).ok) actEver[a.id] = true;
    }
    st = engine.sendPhase(schema, st, { rng: seededRng(seedTag, i, 'send') }).state;
    const o = engine.outputPhase(schema, st, {}, {}, { rng: seededRng(seedTag, i, 'out') });
    st = o.state;
    for (const id of o.firedEvents) fired[id] = (fired[id] || 0) + 1;
    hist.push(st.vars);
    if (collapseTurn === null) {
      for (const x of schema.vars) if (x.type === 'bool' && /lost|collapse|dead|over|fail|end/i.test(x.id) && st.vars[x.id]) collapseTurn = i + 1;
    }
  }
  return { st, fired, actUsed, actEver, hist, collapseTurn };
}

for (const play of [false, true]) {
  H(play ? '드라이런 — 플레이 (매 턴 액션 하나씩)' : '드라이런 — 방치 (액션 안 씀)');
  const runs = Array.from({ length: RUNS }, (_, k) => run(`s${k}${play ? 'p' : 'i'}`, play));
  const cols = runs.map((r) => r.collapseTurn);
  const survived = cols.filter((c) => c === null).length;
  console.log(`   붕괴: ${cols.map((c) => c ?? '생존').join(' / ')}   → 생존 ${survived}/${RUNS}`);
  if (!play) {
    if (survived === RUNS) say('mid', '액션 없이 방치해도 아무도 안 죽음 — 위기감이 없다 (매 턴 소모를 늘리거나 위협을 강하게)');
    if (survived === 0) say('mid', '방치하면 100% 붕괴 — 정상이지만, 아래 플레이 결과와 비교해 액션이 실제로 구제하는지 보라');
  } else {
    if (survived === 0) say('high', '액션을 써도 100% 붕괴 — 플레이어가 이길 방법이 없다. 자원 생산량이나 위협 강도를 조정해야 함');
    else if (survived === RUNS) say('mid', '액션만 누르면 100% 생존 — 난이도가 없다');
    else ok(`액션을 쓰면 ${survived}/${RUNS} 생존 — 난이도가 갈린다`);
  }

  // 죽은 이벤트
  const everFired = new Set(runs.flatMap((r) => Object.keys(r.fired)));
  const dead = allEvIds.filter((id) => !everFired.has(id));
  if (!dead.length) ok(`이벤트 ${allEvIds.length}종 전부 발동함`);
  else {
    console.log(`   한 번도 안 뜬 이벤트 ${dead.length}/${allEvIds.length}:`);
    for (const id of dead) {
      const e = [...EV, ...RND].find((x) => x.id === id);
      const w = e?.when ?? '(조건 없음)';
      // enum 고정값으로 갈린 것은 "이 설정에서만 안 뜸" — 오탐 구분
      const gated = (schema.vars || []).some((x) => x.type === 'enum' && !writers[x.id]?.size
        && new RegExp(`\\b${x.id}\\b`).test(w));
      say(gated ? 'low' : 'mid',
        `${gated ? '[설정 의존] ' : ''}'${id}' 안 뜸 — 조건: ${w}`);
    }
  }

  // 매 턴 도배되는 이벤트
  for (const id of everFired) {
    const avg = runs.reduce((s2, r) => s2 + (r.fired[id] || 0), 0) / RUNS;
    const e = [...EV, ...RND].find((x) => x.id === id);
    if (e && !e.once && avg > TURNS * 0.5 && EV.some((x) => x.id === id)) {
      say('mid', `'${id}'이 평균 ${avg.toFixed(0)}/${TURNS}턴 발동 — 효과가 조건을 해소하지 않아 도배됨`);
    }
  }

  // 액션 도달 가능성
  if (play) {
    const everAvail = new Set(runs.flatMap((r) => Object.keys(r.actEver)));
    const neverAvail = ACT.filter((a) => !everAvail.has(a.id));
    if (!neverAvail.length) ok(`액션 ${ACT.length}종 전부 한 번은 눌 수 있었음`);
    for (const a of neverAvail) say('high', `액션 '${a.id}'(${a.label ?? ''})를 한 번도 쓸 수 없었음 — 조건: ${a.when ?? '(없음)'}`);
  }

  // 변수 움직임
  const stuck = [], mono = [], pinned = [];
  for (const x of schema.vars) {
    const series = runs.flatMap((r) => r.hist.map((h) => h[x.id]));
    const uniq = new Set(series.map((s2) => JSON.stringify(s2)));
    if (uniq.size === 1) { stuck.push(x); continue; }
    if (x.type !== 'int' && x.type !== 'float') continue;
    let down = true, up = true;
    for (const r of runs) for (let i = 1; i < r.hist.length; i++) {
      if (r.hist[i][x.id] > r.hist[i - 1][x.id]) down = false;
      if (r.hist[i][x.id] < r.hist[i - 1][x.id]) up = false;
    }
    if (down) mono.push([x, '감소만']);
    if (up && x.id !== 'day' && !/day|turn|week|month|year/i.test(x.id)) mono.push([x, '증가만']);
    // 범위 끝에 눌어붙었는가
    const last = runs.map((r) => r.hist[r.hist.length - 1][x.id]);
    if (x.max != null && last.every((n) => n === x.max)) pinned.push([x, `최대 ${x.max}`]);
    if (x.min != null && last.every((n) => n === x.min)) pinned.push([x, `최소 ${x.min}`]);
  }
  for (const x of stuck) if (!fixedIds.has(x.id)) say('mid', `'${x.id}'가 ${TURNS}턴 내내 ${JSON.stringify(x.init)}에서 안 움직임 — 바꾸는 곳(${[...(writers[x.id] || [])].join(',')})의 조건이 안 걸림`);
  for (const [x, dir] of mono) say('mid', `'${x.id}'(${x.label ?? ''})가 ${dir} — ${dir === '감소만' ? '늘리는 경로가 없어 반드시 바닥난다' : '줄어드는 경로가 없어 무한히 커진다'}`);
  for (const [x, where] of pinned) say('mid', `'${x.id}'가 끝에 ${where}에 눌어붙음 — 그 구간에서 수치가 의미를 잃음`);

  const f0 = runs[0].hist[runs[0].hist.length - 1];
  console.log('   1시드 최종: ' + schema.vars.slice(0, 12).map((x) => `${x.id}=${JSON.stringify(f0[x.id])}`).join(' '));
}

// ── 4. 경계값 함정 ────────────────────────────────────────
H('시작값 = 조건 경계 (죽은 조건)');
const initOf = Object.fromEntries(schema.vars.map((x) => [x.id, x.init]));
let traps = 0;
const scan = (when, where) => {
  if (!when) return;
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(when))) {
    const [, id, op, numS] = m; const n = Number(numS);
    if (!(id in initOf) || typeof initOf[id] !== 'number') continue;
    const init = initOf[id];
    const falseAtInit = (op === '<' && init === n) || (op === '>' && init === n);
    if (falseAtInit && (writers[id]?.size ?? 0) === 0) {
      traps++; say('high', `${where}: \`${id} ${op} ${n}\` 인데 시작값이 정확히 ${n}이고 아무도 안 바꿈 — 영영 거짓`);
    } else if (falseAtInit) {
      traps++; say('low', `${where}: \`${id} ${op} ${n}\` 이고 시작값이 정확히 ${n} — 첫 턴에는 거짓 (의도인지 확인)`);
    }
  }
};
for (const e of EV) scan(e.when, `이벤트 '${e.id}'`);
for (const e of RND) scan(e.when, `랜덤 '${e.id}'`);
for (const a of ACT) scan(a.when, `액션 '${a.id}'`);
for (const d of (schema.directives || [])) scan(d.when, `지시문 '${d.id}'`);
if (!traps) ok('경계값 함정 없음');

// ── 5. 상태창에 안 보이는 변수 ────────────────────────────
H('상태창 노출');
const shown = new Set((schema.statusUI?.groups || []).flatMap((g) => g.vars || []));
const tmplRefs = new Set((JSON.stringify(schema.statusUI) + (schema.promptState?.template || ''))
  .match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)?.map((s2) => s2.slice(1, -1)) || []);
const hidden = schema.vars.filter((x) => !shown.has(x.id) && !tmplRefs.has(x.id));
if (!hidden.length) ok('모든 변수가 상태창에 노출됨');
else say('low', `상태창에 안 보이는 변수 ${hidden.length}개: ${hidden.map((x) => x.id).join(', ')} `
  + '(의도된 내부 변수면 정상 — 플레이어가 알아야 할 값이면 추가)');

// ── 요약 ──────────────────────────────────────────────────
const n = (s2) => findings.filter((f) => f[0] === s2).length;
console.log(`\n\x1b[1m요약\x1b[0m  🔴 ${n('high')}  🟡 ${n('mid')}  🔵 ${n('low')}`);
