const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.18.0 🎲 추첨 효과 — 후보 풀에서 N개를 중복 없이 목록 변수에. 설계 docs/design-추첨.md
// 발단(커뮤니티 피드백 2026-10-10): "거주지 N명 로스터를 처음 만들 때 가챠풀에 같은 이름을 수백 번". 유저 결정: 노브는 affinity·max, 난수는 효과마다 고정/새로.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const M = SC.require('sample');
const { validateSchema } = SC.require('validate');
const { SimSession } = SC.require('session');
const { MapBackend } = SC.require('store');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── ① 번들·배선 핀 ──
{
  ck('★ 코어 모듈 sample이 번들에', typeof M.applySampleEffect === 'function' && typeof M.drawSample === 'function' && typeof M.validatePools === 'function', '');
  ck('★ 엔진 applySets에 sample 분기', src.includes('sampleMod.isSampleEffect(rule)') && src.includes('sampleMod.applySampleEffect(schema, state, rule, lk(), rng, changeLog, source)'), '');
  ck('★ 세션 rng에 .stable/.free (효과마다 고정/새로)', src.includes('rng.stable = stable; rng.free = free;'), '');
  ck('★ 검증 — checkSet sample 분기 + validatePools', src.includes('sampleMod.validateSampleEffect(rule, p, {') && src.includes('sampleMod.validatePools(schema, { err, warn, ids: allIds })'), '');
  ck('★ 필드 사전 — effects 설명·pools 행', src.includes('{sample,into,n,leader?,exclude?,stable?,append?}') && src.includes("pools: [['id', '']"), '');
  ck('★ 편집기 — 🎲 줄 두 편집기 + [+ 🎲 추첨] ×2 + [변수] 탭 후보 풀 접기', (src.match(/appendChild\(sampleEffectRow\(schema, ef, /g) || []).length === 2 && (src.match(/'\+ 🎲 추첨'/g) || []).length === 2 && src.includes('function poolsSection(schema, rerender)') && src.includes('wrap.appendChild(poolsSection(schema, rerender));'), String((src.match(/'\+ 🎲 추첨'/g) || []).length));
  ck('★ 편집기 — 난수 셋 중 하나(전역 따름/고정/새로)', src.includes("['', '난수: 전역 따름'], ['true', '고정 — 리롤해도 같은 명단'], ['false', '리롤마다 새로']"), '');
  ck('★ 진단 writerMap — 추첨 대상(into·leader)이 쓰기 경로', src.includes("require('./sample').effectTargets(f)") && (src.match(/for \(const _w of effTargets\(/g) || []).length >= 10, String((src.match(/for \(const _w of effTargets\(/g) || []).length));
  ck('★ 패치 — pools 힌트·비교 영역·변수 이름 바꾸기', src.includes("pools: '[변수] 탭 🎲 후보 풀 (v1.18.0)'") && src.includes("['pools', (s) => s?.pools, '후보 풀(pools)']") && src.includes("for (const k of ['sample', 'into', 'leader', 'exclude']) if (r[k] === from) r[k] = to;"), '');
  ck('★ AI 규격서 — 추첨 효과·후보 풀 설명', src.includes('목록을 **무작위로 채우려면** 추첨 효과'), '');
  ck('★ 버전 1.18.x + display-name', /\/\/@version 1\.(1[8-9]|[2-9][0-9])\./.test(src) && /\/\/@display-name .*v1\.(1[8-9]|[2-9][0-9])\./.test(src), '');
}

// ── ② 검증 ──
const NAMES = ['아린', '브란', '세실', '단', '엘라'];
const S = () => ({ simcore: '0.1', meta: { name: 't' },
  vars: [{ id: 'residents', label: '주민', type: 'list', init: [], maxItems: 10 }, { id: 'present', label: '지금 자리', type: 'list', init: [] }, { id: 'gone', type: 'list', init: [] },
    { id: 'mayor', type: 'text', init: '' }, { id: 'pick', type: 'enum', enum: ['아린', '브란'], init: '아린' }, { id: 'gold', type: 'int', init: 0 }],
  pools: [{ id: 'npc_pool', label: '주민 후보', items: [{ name: '아린', weight: 2, group: '경비대' }, '브란', { name: '세실', group: '상인' }, { name: '단', group: '경비대' }, { name: '엘라', group: '상인' }],
    groups: { '경비대': { affinity: 1.5, max: 2 }, '상인': { affinity: 0.5 } } }],
  rules: { events: [{ id: 'seed', when: 'count(residents) == 0', once: true, effects: [{ sample: 'npc_pool', into: 'residents', n: 4, leader: 'mayor', stable: true }], notify: '마을 사람들' }] },
  actions: [{ id: 'market', label: '🏪 시장', effects: [{ sample: 'residents', into: 'present', n: 2, stable: false, exclude: 'gone' }] }],
  statusUI: { mode: 'auto', groups: [] } });
{
  const ok = validateSchema(S());
  ck('★ 검증 — 정상 스키마 통과 (풀 + once 이벤트 + 액션)', ok.ok, JSON.stringify(ok.errors));
  const bad = S(); bad.rules.events[0].effects = [{ sample: 'nope', into: 'gold', leader: 'gold', exclude: 'gold', stable: 'yes' }];
  const r = validateSchema(bad);
  ck('★ 검증 — 없는 풀·into 목록 아님·n 없음·leader 타입·exclude·stable 전부 오류', !r.ok && ['.sample', '.into', '.n', '.leader', '.exclude', '.stable'].every((k) => r.errors.some((e) => e.path.endsWith(k))), r.errors.map((e) => e.path + ' ' + e.msg).join(' | '));
  const bad2 = S(); bad2.rules.events[0].effects = [{ sample: 'npc_pool', into: 'residents', n: 1, leader: 'pick' }];
  const r2 = validateSchema(bad2);
  ck('★ 검증 — leader enum에 풀 후보가 없으면 오류 (세실·단·엘라)', !r2.ok && r2.errors.some((e) => e.msg.includes('세실')), r2.errors.map((e) => e.msg).join('|'));
  const bad3 = S(); bad3.pools[0].id = 'gold';
  ck('★ 검증 — 풀 id가 변수와 겹치면 오류', validateSchema(bad3).errors.some((e) => e.msg.includes('겹칩니다')), '');
  const bad4 = S(); bad4.pools[0].items.push('아린'); bad4.pools[0].groups['없는그룹'] = { max: 1 };
  const r4 = validateSchema(bad4);
  ck('★ 검증 — 중복 후보 오류 + 빈 그룹 경고', r4.errors.some((e) => e.msg.includes("중복 후보: '아린'")) && r4.warnings.some((w) => w.msg.includes("'없는그룹' 그룹에 속한 후보가 없습니다")), '');
  const bad5 = S(); bad5.rules.events[0].effects = [{ sample: 'npc_pool', into: 'residents', n: 1, set: 'gold', expr: '1' }];
  ck('★ 검증 — set과 같이 쓰면 오류', validateSchema(bad5).errors.some((e) => e.msg.includes('같이 쓸 수 없음')), '');
  const bad6 = S(); bad6.rules.events[0].effects = [{ sample: 'npc_pool', into: 'residents', n: 'count(nope) + 1' }];
  ck('★ 검증 — n 식의 모르는 이름은 오류', !validateSchema(bad6).ok, '');
  const w = S(); w.pools[0].foo = 1; w.rules.events[0].effects[0].bar = 1;
  const rw = validateSchema(w);
  ck('검증 — 알 수 없는 키는 경고 (풀·효과)', rw.ok && rw.warnings.some((x) => x.msg.includes("'foo'")) && rw.warnings.some((x) => x.msg.includes("'bar'")), rw.warnings.map((x) => x.msg).join('|'));
}

// ── ③ 추첨 자체 ──
{
  const cands = [{ name: 'a', weight: 1 }, { name: 'b', weight: 1 }, { name: 'c', weight: 0 }, { name: 'd', weight: 5 }];
  const r1 = M.drawSample(cands, 3, {}, seededRng('c', 1, 's')), r2 = M.drawSample(cands, 3, {}, seededRng('c', 1, 's'));
  ck('★ 추첨 — 중복 없이 n개, 가중치 0은 안 뽑힘, 같은 시드면 같은 명단', JSON.stringify(r1) === JSON.stringify(r2) && r1.length === 3 && new Set(r1).size === 3 && !r1.includes('c'), JSON.stringify(r1));
  ck('추첨 — 후보가 모자라면 있는 만큼', M.drawSample(cands, 10, {}, seededRng('c', 2, 's')).length === 3, '');
  const grp = [{ name: 'g1', group: 'g' }, { name: 'g2', group: 'g' }, { name: 'g3', group: 'g' }, { name: 'h1', group: 'h' }, { name: 'h2', group: 'h' }];
  let capOk = true;
  for (let i = 0; i < 40; i++) { const r = M.drawSample(grp, 4, { g: { max: 1 } }, seededRng('m', i, 's')); if (r.filter((x) => x[0] === 'g').length > 1 || r.length !== 3) capOk = false; }
  ck('★ 추첨 — 그룹 max 상한 (g 1 + h 2 = 3명에서 멈춘다)', capOk, '');
  let together = 0;
  for (let i = 0; i < 200; i++) { const r = M.drawSample(grp, 2, { g: { affinity: 100 }, h: { affinity: 100 } }, seededRng('a', i, 's')); if (r[0][0] === r[1][0]) together++; }
  ck('★ 추첨 — affinity가 크면 같은 그룹이 같이 (200번 중 180번 넘게)', together > 180, String(together));
  let apart = 0;
  for (let i = 0; i < 200; i++) { const r = M.drawSample(grp, 2, { g: { affinity: 0.01 }, h: { affinity: 0.01 } }, seededRng('b', i, 's')); if (r[0][0] !== r[1][0]) apart++; }
  ck('★ 추첨 — affinity가 1 아래면 흩어진다 (감쇠)', apart > 180, String(apart));
  // 효과 — 목록 변수가 후보 + exclude + maxItems + leader + append
  const st = { vars: { residents: ['아린', '브란', '세실', '단'], present: [], gone: ['브란'], mayor: '', pick: '아린', gold: 0 } };
  const log = [];
  M.applySampleEffect(S(), st, { sample: 'residents', into: 'present', n: 'count(residents) + 5', exclude: 'gone', leader: 'pick' }, (n) => st.vars[n], seededRng('x', 1, 'y'), log, 't');
  ck('★ 효과 — 목록 변수가 후보, exclude 제외, n은 식, 변화 원장', st.vars.present.length === 3 && !st.vars.present.includes('브란') && log.some((c) => c.id === 'present' && c.source === 't'), JSON.stringify(st.vars.present));
  ck('★ 효과 — enum leader는 enum에 있을 때만', (st.vars.present[0] === '아린' ? st.vars.pick === '아린' : st.vars.pick === '아린'), st.vars.pick);
  const sc = S(); sc.vars[1].maxItems = 2;
  const st2 = { vars: { residents: [], present: ['x'], gone: [], mayor: '', pick: '아린', gold: 0 } };
  M.applySampleEffect(sc, st2, { sample: 'npc_pool', into: 'present', n: 9, append: true, leader: 'mayor' }, (n) => st2.vars[n], seededRng('x', 2, 'y'), [], 't');
  ck('★ 효과 — append는 뒤에 덧붙이고 maxItems까지만, leader는 첫 당첨', st2.vars.present.length === 2 && st2.vars.present[0] === 'x' && NAMES.includes(st2.vars.present[1]) && st2.vars.mayor === st2.vars.present[1], JSON.stringify(st2.vars.present));
  const base = () => 0.1, stb = () => 0.2, fr = () => 0.3; base.stable = stb; base.free = fr;
  const bare = () => 0.5;
  ck('★ 난수 고르기 — stable true→.stable, false→.free, 없음→받은 것, 안 달렸으면 받은 것', M.pickRng(base, true) === stb && M.pickRng(base, false) === fr && M.pickRng(base, undefined) === base && M.pickRng(bare, true) === bare && M.pickRng(bare, false) === bare, '');
}

// ── ④ 세션 끝까지 — once 이벤트가 첫 정산에 풀에서 뽑고, 리롤(같은 채팅·같은 턴)에서 stable:true면 같은 명단, false면 주입 random을 쓴다 ──
(async () => {
  const run = async (schema, chatId, random) => {
    const ses = new SimSession(schema, new MapBackend(), { chatId, random });
    await ses.init(-1);
    await ses.onSend(0);
    await ses.onOutput(1, '{"changes":{},"reasons":{}}');
    return ses;
  };
  const a = await run(S(), 'c1');
  const v = a.current.vars;
  ck('★ 세션 — once 이벤트가 첫 정산에 풀에서 4명 (중복 없이, 풀 이름만)', Array.isArray(v.residents) && v.residents.length === 4 && new Set(v.residents).size === 4 && v.residents.every((x) => NAMES.includes(x)), JSON.stringify(v.residents));
  ck('★ 세션 — 경비대 max 2', v.residents.filter((x) => x === '아린' || x === '단').length <= 2, '');
  ck('★ 세션 — leader = 첫 당첨', v.mayor === v.residents[0], String(v.mayor));
  const b = await run(S(), 'c1');
  ck('★ 리롤 안정 — 같은 채팅·같은 턴이면 같은 명단 (stable: true)', JSON.stringify(b.current.vars.residents) === JSON.stringify(v.residents), JSON.stringify(b.current.vars.residents));
  const S2 = () => { const s = S(); s.rules.events[0].effects[0].stable = false; return s; };
  const d1 = await run(S2(), 'c3', () => 0);
  const d2 = await run(S2(), 'c3', () => 0.999);
  ck('★ 리롤마다 새로 — stable:false는 자유 난수(주입 random)를 쓴다 (0이면 앞에서, 0.999면 뒤에서)',
    JSON.stringify(d1.current.vars.residents) === '["아린","브란","세실","단"]' && JSON.stringify(d2.current.vars.residents) === '["엘라","단","세실","브란"]',
    JSON.stringify(d1.current.vars.residents) + ' ' + JSON.stringify(d2.current.vars.residents));
  const S3 = () => { const s = S(); s.rerollStableRng = false; return s; };   // 전역 꺼짐 + 효과 stable:true → 그래도 고정
  const e1 = await run(S3(), 'c4', () => 0), e2 = await run(S3(), 'c4', () => 0.999);
  ck('★ 전역 리롤 안정이 꺼져도 효과의 stable:true는 고정', JSON.stringify(e1.current.vars.residents) === JSON.stringify(e2.current.vars.residents), '');

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
