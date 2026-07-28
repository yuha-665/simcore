const __P = (...p) => require('path').resolve(__dirname, ...p);
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC, engine = SC.require('engine'), { seededRng } = SC.require('rng');
const schema = JSON.parse(fs.readFileSync('E:/0.리수봇/simcore-save-림월드 테스트.json', 'utf8')).schema;

// 붕괴 직전 8턴을 이벤트와 함께 재생한다
for (const seed of ['x2', 'x5']) {
  let st = engine.initState(schema), log = [];
  for (let i = 0; i < 60; i++) {
    st = engine.sendPhase(schema, st, { rng: seededRng(seed, i, 'send') }).state;
    const o = engine.outputPhase(schema, st, {}, {}, { rng: seededRng(seed, i, 'out') });
    st = o.state;
    const L = engine.makeLookup(schema, st.vars);
    log.push({ t: i + 1, ev: o.firedEvents, v: st.vars, m: L('raid_margin'), dp: L('def_power'), rp: L('raid_power') });
    if (st.vars.colony_lost) break;
  }
  const end = log[log.length - 1];
  console.log(`\n[시드 ${seed}] ${end.v.colony_lost ? `${end.t}턴에 붕괴` : '60턴 생존'}`);
  for (const r of log.slice(-9)) {
    console.log(`  ${String(r.t).padStart(2)}턴 people=${String(r.v.people).padStart(2)} sick=${String(r.v.sick).padStart(2)}`
      + ` inj=${String(r.v.injured).padStart(2)} food=${String(r.v.food).padStart(4)} med=${String(r.v.medicine).padStart(3)}`
      + ` mood=${String(r.v.mood).padStart(3)} tension=${String(r.v.tension).padStart(3)}`
      + ` 방어${String(r.dp).padStart(3)}vs적${String(r.rp).padStart(3)}(${r.m >= 0 ? '+' : ''}${r.m})`
      + (r.ev.length ? '  ▶ ' + r.ev.join(', ') : ''));
  }
}
// 붕괴 조건이 뭔지
console.log('\ncolony_lost를 켜는 이벤트:');
for (const e of schema.rules.events) for (const f of (e.effects || []))
  if (f.set === 'colony_lost') console.log(`  '${e.id}' ← ${e.when}`);
