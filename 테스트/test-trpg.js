const __P = (...p) => require('path').resolve(__dirname, ...p);
// TRPG 템플릿 실물 검증 — v0.40에서 checks(판정) 기반으로 재작성됨.
// 마지막 절은 v0.39까지의 손조립 판정(변수 5개+규칙)과 같은 시드에서 같은 값이 나오는지 재는 회귀다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { TEMPLATES } = SimCore.require('templates');
const { seededRng } = SimCore.require('rng');
const T = TEMPLATES.trpg.schema;

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
// 최초설정이 끝난 뒤의 정상 플레이 상태 (설정 중에는 지시문이 의도적으로 억제된다)
const fresh = () => { const s = engine.initState(T); s.meta.setupDone = true; s.meta.turn = 1; return s; };
const armSend = (st, id, seed) =>
  engine.sendPhase(T, engine.toggleAction(T, st, id).state, { rng: seededRng('c', seed, 'send') });

// ── 능력 보정 ──
{
  const st = engine.initState(T);
  const L = engine.makeLookup(T, st.vars);
  ck('근력14 → 보정 +2', L('str_mod') === 2, String(L('str_mod')));
  ck('지력10 → 보정 0', L('wit_mod') === 0, String(L('wit_mod')));
}

// ── 판정 결과 변수가 정말 없는가 (v0.40의 요점) ──
{
  const gone = ['roll', 'total', 'grade', 'checking', 'roll_pending'];
  ck('손조립 판정 변수 5개 삭제됨', gone.every((id) => !T.vars.some((v) => v.id === id)),
    T.vars.map((v) => v.id).join(','));
  ck('allow에도 판정 결과가 없다 (구조적으로 불가능)',
    !T.updater.allow.some((a) => gone.includes(a.id)), JSON.stringify(T.updater.allow));
  ck('판정 5종 정의됨', (T.checks || []).length === 5, String((T.checks || []).length));
}

// ── 액션 판정: 같은 턴에 모델이 결과를 본다 ──
{
  const s = armSend(fresh(), 'check_str', 3);
  const lc = s.state.meta.lastCheck;
  ck('d20 범위', lc.roll >= 1 && lc.roll <= 20, String(lc.roll));
  ck('합계 = 눈 + 근력보정', lc.total === lc.roll + 2, `${lc.total} vs ${lc.roll}+2`);
  const exp = lc.roll === 20 ? '대성공' : lc.roll === 1 ? '대실패' : (lc.total >= 13 ? '성공' : '실패');
  ck('등급 분류 정확', lc.grade === exp, `${lc.grade} / roll ${lc.roll} total ${lc.total}`);
  ck('모델 프롬프트에 [판정] 결과 실림',
    s.promptBlock.includes(`[판정] 근력 판정: ${lc.roll} + 2 = ${lc.total} vs 13 → ${lc.grade}`), s.promptBlock);
  ck('★ 판정 규칙 줄 자동 부착 (뒤집기 금지)', s.promptBlock.includes('뒤집어 서술하지 마라'), s.promptBlock);
  ck('의도([행동])가 결과([판정])보다 먼저',
    s.promptBlock.indexOf('[행동] 힘으로 밀어붙인다.') < s.promptBlock.indexOf('[판정] 근력 판정'), s.promptBlock);
}

// ── 능력별로 다른 보정이 적용되는가 ──
{
  const st = engine.initState(T);
  const a = armSend(st, 'check_dex', 4).state.meta.lastCheck;   // 민첩12 → +1
  const b = armSend(st, 'check_cha', 4).state.meta.lastCheck;   // 매력10 → 0
  ck('민첩 판정은 민첩 보정(+1)', a.total === a.roll + 1, `${a.total} vs ${a.roll}+1`);
  ck('매력 판정은 매력 보정(0)', b.total === b.roll + 0, `${b.total} vs ${b.roll}`);
  ck('같은 시드면 눈도 같다', a.roll === b.roll, `${a.roll} vs ${b.roll}`);
}

// ── 판정 규칙 줄은 판정 턴에만 ──
{
  const s1 = armSend(fresh(), 'check_str', 6);
  const out = engine.outputPhase(T, s1.state, {}, {}, { rng: seededRng('c', 6, 'out') });
  const s2 = engine.sendPhase(T, out.state, { rng: seededRng('c', 7, 'send') });
  ck('다음 턴엔 규칙 줄 사라짐', !s2.promptBlock.includes('뒤집어 서술하지'), s2.promptBlock);
  ck('판정 안내 지시문은 상시', s2.activeDirectives.includes('ask_roll'), JSON.stringify(s2.activeDirectives));
}

// ── 보조모델이 판정을 요청하는 경로 (need_roll → 이벤트가 check를 굴린다) ──
{
  const st = engine.initState(T);
  const out = engine.outputPhase(T, st, { need_roll: true, dc: 4 }, {}, { rng: seededRng('c', 9, 'out') });
  ck('요청으로 판정 발동', out.firedEvents.includes('do_roll'), JSON.stringify(out.firedEvents));
  ck('요청 플래그 소비됨', out.state.vars.need_roll === false);
  ck('난이도 델타도 적용됨', out.state.vars.dc === 17, String(out.state.vars.dc));
  const pn = out.state.meta.pendingNotifies;
  ck('통지에 서술 + [판정] 줄', pn.some((n) => n === '판정이 필요한 상황이라 주사위를 굴렸다.')
    && pn.some((n) => n.startsWith('[판정] 근력 판정:')), JSON.stringify(pn));
  const s = engine.sendPhase(T, out.state, { rng: seededRng('c', 10, 'send') });
  ck('다음 턴 프롬프트에 결과 + 규칙 줄',
    s.promptBlock.includes('[판정] 근력 판정:') && s.promptBlock.includes('뒤집어 서술하지 마라'), s.promptBlock);
}

// ── 이점: 두 번 굴려 높은 눈 ──
{
  let plain = 0, adv = 0, n = 1500;
  for (let i = 0; i < n; i++) {
    plain += armSend(fresh(), 'check_str', i).state.meta.lastCheck.roll;
    const withAdv = fresh(); withAdv.vars.adv = true;
    adv += armSend(withAdv, 'check_str', i).state.meta.lastCheck.roll;
  }
  const p = plain / n, a = adv / n;
  ck('이점 평균이 확실히 높음 (10.5 → 13.8 기대)', a > p + 2.5, `일반 ${p.toFixed(2)} / 이점 ${a.toFixed(2)}`);
  const used = (() => { const s = fresh(); s.vars.adv = true; return armSend(s, 'check_str', 1); })();
  ck('이점은 쓰면 소모됨 (액션 효과 — 굴림 뒤에 적용)', used.state.vars.adv === false);
}

// ── 공격: 등급 효과로 피해/반격이 갈리는가 ──
{
  let crit = null, hit = null, miss = null, fumble = null;
  for (let i = 0; i < 400 && !(crit && hit && miss && fumble); i++) {
    const s = armSend(fresh(), 'attack', i);
    const r = { ...s.state.vars, grade: s.state.meta.lastCheck.grade };
    if (r.grade === '대성공' && !crit) crit = r;
    if (r.grade === '성공' && !hit) hit = r;
    if (r.grade === '실패' && !miss) miss = r;
    if (r.grade === '대실패' && !fumble) fumble = r;
  }
  ck('네 등급이 모두 발생', !!(crit && hit && miss && fumble),
    `대성공${!!crit} 성공${!!hit} 실패${!!miss} 대실패${!!fumble}`);
  if (crit) ck('대성공 = 2d8+보정 (4~18)', crit.dmg >= 4 && crit.dmg <= 18, String(crit.dmg));
  if (hit) ck('성공 = 1d8+보정 (3~10)', hit.dmg >= 3 && hit.dmg <= 10, String(hit.dmg));
  if (miss) ck('실패 = 피해 0', miss.dmg === 0, String(miss.dmg));
  if (fumble) ck('대실패 = 자신이 반격당함', fumble.hp < 20, `hp ${fumble.hp}`);
  if (hit) ck('공격은 기력을 소모', hit.stamina === 5, String(hit.stamina));
}

// ── 피해량은 다음 턴 정산에서 0으로 (지시문이 눌어붙지 않게) ──
{
  let s = null;
  for (let i = 0; i < 200 && !s; i++) {
    const t = armSend(fresh(), 'attack', i);
    if (t.state.vars.dmg > 0) s = t;
  }
  ck('공격 턴엔 피해 지시문', !!s && s.activeDirectives.includes('dmg_note'), s && JSON.stringify(s.activeDirectives));
  if (s) {
    const out = engine.outputPhase(T, s.state, {}, {}, { rng: seededRng('c', 999, 'out') });
    ck('다음 턴 정산에서 dmg = 0', out.state.vars.dmg === 0, String(out.state.vars.dmg));
  }
}

// ── 기력 없으면 공격 잠김 ──
{
  const st = engine.initState(T); st.vars.stamina = 0;
  const av = engine.actionAvailability(T, st, T.actions.find((a) => a.id === 'attack'));
  ck('기력 0이면 공격 불가', av.ok === false, JSON.stringify(av));
}

// ── 분포 균등성 ──
{
  const c = {};
  for (let i = 0; i < 4000; i++) {
    const r = armSend(fresh(), 'check_str', i).state.meta.lastCheck.roll;
    c[r] = (c[r] || 0) + 1;
  }
  const faces = Object.keys(c).map(Number).sort((a, b) => a - b);
  const vals = Object.values(c);
  ck('1~20 전부 출현', faces.length === 20 && faces[0] === 1 && faces[19] === 20, faces.join(','));
  ck('분포 균등 (기대 200)', Math.min(...vals) > 130 && Math.max(...vals) < 270,
    `min ${Math.min(...vals)} / max ${Math.max(...vals)}`);
}

// ── 리롤 안정성 ──
{
  const a = armSend(fresh(), 'check_str', 42).state.meta.lastCheck.roll;
  const b = armSend(fresh(), 'check_str', 42).state.meta.lastCheck.roll;
  ck('같은 턴 리롤 = 같은 눈 (세이브스커밍 차단)', a === b, `${a} vs ${b}`);
}

// ── ★ 구판 회귀: v0.39 손조립과 같은 시드에서 같은 값 ──
// 설계 문서의 완료 조건 — "trpg 템플릿을 checks로 재작성해서 회귀 확인 (같은 분포가 나와야 함)".
// 분포 비교보다 강하게, 시드별 동일값(굴림·등급·피해·반격·기력)을 그대로 잰다.
{
  const OLD = {
    simcore: '0.1', meta: { name: 'old-trpg' },
    vars: [
      { id: 'str', label: '근력', type: 'int', init: 14, min: 3, max: 20 },
      { id: 'hp', label: 'HP', type: 'int', init: 20, min: 0, max: 40 },
      { id: 'stamina', label: '기력', type: 'int', init: 6, min: 0, max: 10 },
      { id: 'dc', label: '난이도', type: 'int', init: 13, min: 5, max: 30 },
      { id: 'roll', label: '주사위', type: 'int', init: 0, min: 0, max: 20 },
      { id: 'total', label: '판정값', type: 'int', init: 0, min: 0, max: 60 },
      { id: 'grade', label: '판정 결과', type: 'enum', init: '없음', enum: ['없음', '대성공', '성공', '실패', '대실패'] },
      { id: 'dmg', label: '피해량', type: 'int', init: 0, min: 0, max: 99 },
      { id: 'adv', label: '이점 대기', type: 'bool', init: false },
    ],
    derived: [{ id: 'str_mod', label: '근력 보정', expr: 'floor((str - 10) / 2)' }],
    rules: { onTurn: [], events: [], randomEvents: { chancePerTurn: 0, table: [] } },
    actions: [
      { id: 'attack', label: '⚔ 공격', mode: 'oneshot', when: 'stamina >= 1',
        effects: [
          { set: 'roll', expr: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)' },
          { set: 'total', expr: 'roll + str_mod' },
          { set: 'grade', expr: 'roll == 20 ? "대성공" : (roll == 1 ? "대실패" : (total >= dc ? "성공" : "실패"))' },
          { set: 'dmg', expr: 'grade == "대성공" ? rand(1, 8) + rand(1, 8) + str_mod : (grade == "성공" ? rand(1, 8) + str_mod : 0)' },
          { set: 'hp', expr: 'grade == "대실패" ? hp - rand(1, 4) : hp' },
          { set: 'stamina', expr: 'stamina - 1' },
          { set: 'adv', expr: '0' },
        ] },
    ],
    updater: { model: 'aux', allow: [] },
  };
  const oldFresh = () => { const s = engine.initState(OLD); s.meta.setupDone = true; s.meta.turn = 1; return s; };
  let same = 0, diff = '', N = 800;
  for (let i = 0; i < N; i++) {
    const useAdv = i % 3 === 0; // 이점 굴림(주사위 2개 소비)도 스트림이 어긋나지 않는지 섞어서 잰다
    const so = oldFresh(); if (useAdv) so.vars.adv = true;
    const o = engine.sendPhase(OLD, engine.toggleAction(OLD, so, 'attack').state,
      { rng: seededRng('c', i, 'send') }).state.vars;
    const sn = fresh(); if (useAdv) sn.vars.adv = true;
    const s = armSend(sn, 'attack', i);
    const lc = s.state.meta.lastCheck;
    const eq = o.roll === lc.roll && o.grade === lc.grade && o.dmg === s.state.vars.dmg
      && o.hp === s.state.vars.hp && o.stamina === s.state.vars.stamina;
    if (eq) same++;
    else if (!diff) diff = `seed ${i}${useAdv ? '(이점)' : ''}: 구 ${o.roll}/${o.grade}/${o.dmg}/${o.hp} vs 신 ${lc.roll}/${lc.grade}/${s.state.vars.dmg}/${s.state.vars.hp}`;
  }
  ck(`★ 구판과 시드별 동일값 (${N}/${N})`, same === N, diff || `${same}/${N}`);
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
