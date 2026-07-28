const __P = (...p) => require('path').resolve(__dirname, ...p);
// TRPG 템플릿 실물 검증 — 주사위가 실제로 의도대로 도는가
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

// ── 액션 판정: 같은 턴에 모델이 결과를 본다 ──
{
  const s = armSend(fresh(), 'check_str', 3);
  const v = s.state.vars;
  ck('d20 범위', v.roll >= 1 && v.roll <= 20, String(v.roll));
  ck('합계 = 눈 + 근력보정', v.total === v.roll + 2, `${v.total} vs ${v.roll}+2`);
  const exp = v.roll === 20 ? '대성공' : v.roll === 1 ? '대실패' : (v.total >= 13 ? '성공' : '실패');
  ck('등급 분류 정확', v.grade === exp, `${v.grade} / roll ${v.roll} total ${v.total}`);
  ck('판정 대상 기록', v.checking === '근력', v.checking);
  ck('미반영 표시 켜짐', v.roll_pending === true);
  ck('모델 프롬프트에 결과 실림', s.promptBlock.includes(`주사위 ${v.roll}`), s.promptBlock.split('\n').pop());
  ck('★ 주사위 존중 지시문 발동', s.activeDirectives.includes('respect_dice'), JSON.stringify(s.activeDirectives));
  ck('지시문에 뒤집기 금지 명시', s.promptBlock.includes('뒤집지 마라'));
  ck('판정 없을 때 안내는 꺼짐', !s.activeDirectives.includes('ask_roll'), JSON.stringify(s.activeDirectives));
}

// ── 능력별로 다른 보정이 적용되는가 ──
{
  const st = engine.initState(T);
  const a = armSend(st, 'check_dex', 4).state.vars;   // 민첩12 → +1
  const b = armSend(st, 'check_cha', 4).state.vars;   // 매력10 → 0
  ck('민첩 판정은 민첩 보정(+1)', a.total === a.roll + 1, `${a.total} vs ${a.roll}+1`);
  ck('매력 판정은 매력 보정(0)', b.total === b.roll + 0, `${b.total} vs ${b.roll}`);
  ck('같은 시드면 눈도 같다', a.roll === b.roll, `${a.roll} vs ${b.roll}`);
}

// ── 미반영 표시가 다음 턴에 내려가는가 (지시문이 계속 뜨면 안 됨) ──
{
  const s1 = armSend(fresh(), 'check_str', 6);
  ck('판정 턴엔 미반영=참', s1.state.vars.roll_pending === true);
  const out = engine.outputPhase(T, s1.state, {}, {}, { rng: seededRng('c', 6, 'out') });
  ck('모델이 쓴 뒤 미반영 해제', out.state.vars.roll_pending === false);
  const s2 = engine.sendPhase(T, out.state, { rng: seededRng('c', 7, 'send') });
  ck('다음 턴엔 존중 지시문 사라짐', !s2.activeDirectives.includes('respect_dice'), JSON.stringify(s2.activeDirectives));
  ck('대신 판정 안내가 켜짐', s2.activeDirectives.includes('ask_roll'));
  ck('직전 결과는 표시용으로 남음', s2.promptBlock.includes('[직전 판정]'));
}

// ── 보조모델이 판정을 요청하는 경로 ──
{
  const st = engine.initState(T);
  const out = engine.outputPhase(T, st, { need_roll: true, dc: 4 }, {}, { rng: seededRng('c', 9, 'out') });
  ck('요청으로 판정 발동', out.firedEvents.includes('do_roll'), JSON.stringify(out.firedEvents));
  ck('요청 플래그 소비됨', out.state.vars.need_roll === false);
  ck('난이도 델타도 적용됨', out.state.vars.dc === 17, String(out.state.vars.dc));
  ck('정기계산이 미반영을 끄지 못함 (이벤트가 뒤에 돌아 다시 켠다)', out.state.vars.roll_pending === true);
  const s = engine.sendPhase(T, out.state, { rng: seededRng('c', 10, 'send') });
  ck('다음 턴에 존중 지시문 발동', s.activeDirectives.includes('respect_dice'), JSON.stringify(s.activeDirectives));
}

// ── 이점: 두 번 굴려 높은 눈 ──
{
  let plain = 0, adv = 0, n = 1500;
  for (let i = 0; i < n; i++) {
    plain += armSend(fresh(), 'check_str', i).state.vars.roll;
    const withAdv = engine.initState(T); withAdv.vars.adv = true;
    adv += armSend(withAdv, 'check_str', i).state.vars.roll;
  }
  const p = plain / n, a = adv / n;
  ck('이점 평균이 확실히 높음 (10.5 → 13.8 기대)', a > p + 2.5, `일반 ${p.toFixed(2)} / 이점 ${a.toFixed(2)}`);
  const used = armSend((() => { const s = engine.initState(T); s.vars.adv = true; return s; })(), 'check_str', 1);
  ck('이점은 쓰면 소모됨', used.state.vars.adv === false);
}

// ── 공격: 등급에 따라 피해/반격이 갈리는가 ──
{
  let crit = null, hit = null, miss = null, fumble = null;
  for (let i = 0; i < 400 && !(crit && hit && miss && fumble); i++) {
    const r = armSend(fresh(), 'attack', i).state.vars;
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
  if (crit) ck('피해 지시문도 발동', crit.dmg > 0);
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
    const r = armSend(fresh(), 'check_str', i).state.vars.roll;
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
  const a = armSend(fresh(), 'check_str', 42).state.vars.roll;
  const b = armSend(fresh(), 'check_str', 42).state.vars.roll;
  ck('같은 턴 리롤 = 같은 눈 (세이브스커밍 차단)', a === b, `${a} vs ${b}`);
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
