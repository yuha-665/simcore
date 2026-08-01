// 스키마를 실제로 N턴 굴려 "문법은 맞지만 게임이 안 되는" 문제를 찾는다.
// 검증기(validate)는 형태만 본다. 여기서 보는 건 도달 가능성·균형·죽은 콘텐츠다.
//
// 순수 함수라 DOM이 필요 없다 — 편집기·테스트·플레이그라운드 어디서든 같은 결과가 나온다.

const engine = require('./engine');
const { validateSchema } = require('./validate');
const { seededRng } = require('./rng');
const { timeConfig, MIN_PER_DAY, EPOCH_KEY, SKIP_DAY, SKIP_MIN } = require('./time');
const { evaluate, truthy } = require('./expr');

const ID_TOKEN = /[a-zA-Z_][a-zA-Z0-9_]*/g;
// `wealth >= 2000` 같은 "수치 문턱"만 뽑는다. 문자열 비교(enum)는 별도로 다룬다.
const CMP = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)/g;

/** 검증 오류 경로 → 그 문제를 고칠 탭 */
function tabOfPath(path) {
  const p = String(path || '');
  if (/^\$\.(vars|derived)\b/.test(p)) return 'vars';
  if (/^\$\.(rules|directives)\b/.test(p)) return 'rules';
  if (/^\$\.actions\b/.test(p)) return 'actions';
  if (/^\$\.(statusUI|promptState)\b/.test(p)) return 'status';
  if (/^\$\.setup\.presets\b/.test(p)) return 'presets';
  return null;
}

/** 붕괴 판정에 쓸 변수 고르기 — 스키마가 패배 조건을 선언하지 않으므로 관례로 찾는다 */
function pickLoseVar(schema) {
  const b = schema.vars.find((v) => v.type === 'bool' && /lost|collapse|dead|over|fail|ruin|defeat|gameover/i.test(v.id));
  return b ? b.id : null;
}

/** 그 변수를 바꾸는 주체들 (onTurn/이벤트/랜덤/액션/AI/최초설정) */
function writerMap(schema) {
  const w = {};
  const add = (id, who) => { if (id) (w[id] = w[id] || new Set()).add(who); };
  for (const r of (schema.rules?.onTurn || [])) add(r.set ?? r.list, 'onTurn');
  for (const e of (schema.rules?.events || [])) for (const f of (e.effects || [])) add(f.set ?? f.list, '이벤트');
  for (const e of (schema.rules?.randomEvents?.table || [])) for (const f of (e.effects || [])) add(f.set ?? f.list, '랜덤');
  for (const a of (schema.actions || [])) for (const f of (a.effects || [])) add(f.set ?? f.list, '액션');
  for (const c of (schema.checks || [])) for (const g of (c.grades || [])) for (const f of (g.effects || [])) add(f.set ?? f.list, '판정');
  for (const e of [...(schema.rules?.events || []), ...(schema.rules?.randomEvents?.table || [])])
    for (const c of (e.choices || [])) for (const f of (c.effects || [])) add(f.set ?? f.list, '선택');
  for (const a of (schema.updater?.allow || [])) add(a.id, 'AI');
  for (const id of (schema.setup?.ai?.vars || [])) add(id, '최초설정');
  for (const p of (schema.setup?.presets || [])) for (const id of Object.keys(p.set || {})) add(id, '새 시작');
  // 편성표(v0.55) — 슬롯 변수는 유저가 팝업에서 바꾼다. 시뮬은 못 움직이지만
  // "바꾸는 곳이 없다"는 말은 거짓이므로 고정 변수·안 움직임 오탐에서 뺀다.
  for (const s of (schema.party?.slots || [])) add(s.var, '편성');
  return w;
}

/**
 * 보조 AI(updater.allow)가 이 값을 **그 방향으로** 밀 수 있는가.
 *
 * 시뮬레이션에는 보조 AI가 없다. 그래서 AI가 움직이는 값에 걸린 문턱은 시작값 근처에서 멈춘
 * 채로 관측되고, 진단은 그걸 "죽은 이벤트, 문턱을 내리세요"라고 신고한다 — 그대로 따르면
 * 실제 플레이에서 관계가 폭주한다.
 *
 * 셋을 같이 본다.
 *   **방향** — `maxGain: 0`(시설 게이지는 깎이기만)처럼 한쪽만 열린 값이 흔하다.
 *              깎이기만 하는 값의 `>= 45`는 AI도 못 만든다.
 *   **범위** — 선언한 상·하한 밖의 문턱(상한 100인 값의 `> 100`)은 누가 밀어도 안 닿는다.
 *   **사거리** — 한 턴에 미는 한도가 선언돼 있으면 판 길이만큼 곱해 본다. `coal >= 99999`는
 *              maxDelta 60으로 25턴을 다 써도 1500이라, AI가 있어도 영영 못 가는 진짜 죽은 조건이다.
 */
function inRange(schema, id, op, need) {
  const x = schema.vars.find((v) => v.id === id);
  if (!x) return true;
  if (op === '>=') return x.max == null || need <= x.max;
  if (op === '>') return x.max == null || need < x.max;
  if (op === '<=') return x.min == null || need >= x.min;
  if (op === '<') return x.min == null || need > x.min;
  return true;
}

function aiGated(schema, b, turns) {
  if (!b) return false;
  const a = (schema.updater?.allow || []).find((x) => x.id === b.id);
  if (!a) return false;
  const up = b.op === '>=' || b.op === '>';
  const cap = (up ? a.maxGain : a.maxLoss) ?? a.maxDelta;
  if (cap === 0) return false;
  if (!inRange(schema, b.id, b.op, b.need)) return false;
  if (typeof cap === 'number' && isFinite(cap) && Math.abs(b.need - b.got) > Math.abs(cap) * turns) return false;
  return true;
}

/**
 * `when`이 이 변수 **하나 때문에** 막혀 있는가 — 그 값만 뒤집으면 참이 되는가.
 *
 * 이름이 조건에 나오는지만 보면 `not flag`(막지 않음)와 `flag`(막음)를 구분하지 못한다.
 * 래치 짝에서는 위기 쪽이 `not 경보`, 회복 쪽이 `경보`라 같은 이름을 정반대로 쓰므로,
 * 문자열로 판단하면 위기 이벤트까지 "경보에 막혔다"고 오인한다. 그래서 실제로 굴려서 본다.
 */
function blockedBy(when, states, schema, v) {
  if (!when) return false;
  for (const vars of states) {
    let look;
    try { look = engine.makeLookup(schema, vars); } catch (e) { continue; }
    let cur;
    try { cur = look(v.id); } catch (e) { continue; }
    let other;
    if (typeof cur === 'boolean') other = !cur;
    else if (v.type === 'enum') other = (v.enum || []).find((x) => x !== cur);
    else continue;
    if (other === undefined || other === cur) continue;
    try {
      if (truthy(evaluate(when, look, null))) continue;                    // 이미 참이면 막힌 게 아니다
      if (truthy(evaluate(when, (n) => (n === v.id ? other : look(n)), null))) return true;
    } catch (e) { continue; }
  }
  return false;
}

/** 괄호 깊이 0의 ` or `로 조건을 갈라낸다 — 서로 대안인 갈래들 */
function orBranches(when) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < when.length; i++) {
    const c = when[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && when.startsWith(' or ', i)) {
      out.push(when.slice(start, i));
      i += 3; start = i + 1;
    }
  }
  out.push(when.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * 조건이 왜 안 걸렸는지 수치로 설명한다.
 * `wealth >= 2000` 인데 관측 최고가 1833이면 "92%까지만 도달" 이라고 말해 준다.
 *
 * `and`로 묶인 항은 전부 만족해야 하므로 **가장 안 닿은 항**이 병목이다.
 * 반대로 `or`로 갈린 갈래는 하나만 되면 되므로 **가장 가까운 갈래**가 병목이다 —
 * 여기를 구분하지 않으면 8인 봇의 `a >= 60 or b >= 60 or …`에서 제일 먼 사람을 짚고
 * "얘 호감을 올리세요"라고 엉뚱한 처방을 낸다 (실측 사고, v0.45).
 */
function bottleneck(when, obs) {
  if (!when) return null;
  const branches = orBranches(when);
  if (branches.length > 1) {
    let best = null;
    for (const b of branches) {
      const r = bottleneck(b, obs);
      if (!r) return null;                       // 이미 닿은 갈래가 있다 — 병목이 아니다
      if (!best || (r.pct != null && (best.pct == null || r.pct > best.pct))) best = r;
    }
    if (best) best.ofBranches = branches.length;
    return best;
  }
  let worst = null;
  CMP.lastIndex = 0;
  let m;
  while ((m = CMP.exec(when))) {
    const [, id, op, numS] = m;
    const o = obs[id];
    if (!o || !isFinite(o.max)) continue;
    const need = Number(numS);
    const got = (op === '>=' || op === '>') ? o.max : o.min;
    const reached = (op === '>=') ? got >= need : (op === '>') ? got > need
      : (op === '<=') ? got <= need : got < need;
    if (reached) continue;
    // 진행률: 큰 값을 향하는 조건은 got/need, 작은 값을 향하는 조건은 여유분 기준
    const pct = (op === '>=' || op === '>')
      ? (need === 0 ? 0 : Math.max(0, Math.round((got / need) * 100)))
      : null;
    const cand = { id, op, need, got, pct };
    if (!worst || (pct != null && worst.pct != null && pct < worst.pct) || worst.pct == null) worst = cand;
  }
  return worst;
}

/** 이 조건이 "한 번도 안 바뀐 enum/설정값"에 갇혀 있는가 (죽은 게 아니라 다른 설정에서만 뜨는 것) */
/**
 * @param selfSets 이 이벤트가 스스로 세우는 값들. 반드시 빼야 한다 —
 *   규격서가 가르치는 '임계 돌파' 패턴(`when: "... and not collapsed"` + `effects: collapsed = 1`)에서,
 *   이벤트가 안 뜨면 그 플래그도 안 움직인다. 그걸 근거로 "이 플래그 때문에 안 뜬다"고 하면
 *   원인과 결과가 뒤집힌 채 순환한다. 그 플래그는 false로 시작하므로 막고 있는 게 아니다.
 */
function gatedBySetting(when, schema, writers, moved, selfSets = null) {
  if (!when) return null;
  for (const v of schema.vars) {
    if (v.type !== 'enum' && v.type !== 'bool') continue;
    if (moved.has(v.id)) continue;                       // 실제로 값이 변했다면 게이트가 아니다
    if (selfSets && selfSets.has(v.id)) continue;        // 자기가 세우는 플래그는 자기를 막지 못한다
    if (!new RegExp(`\\b${v.id}\\b`).test(when)) continue;
    const who = writers[v.id] || new Set();
    const byPlayer = [...who].some((s) => s === '액션' || s === '새 시작' || s === '최초설정');
    // 보조 AI가 세우는 값이면 "바꿀 수단이 없다"는 말은 사실이 아니다 — 시뮬에 AI가 없을 뿐이다.
    return { id: v.id, label: v.label ?? v.id, init: v.init, byPlayer, byAI: who.has('AI') };
  }
  return null;
}

/**
 * @param schema 검증을 통과한 스키마
 * @param opts { turns=60, runs=6, actionImpact=true }
 * @returns { ran, findings:[{sev,tag,text}], stats }
 */
function diagnose(schema, opts = {}) {
  const turns = Math.max(5, opts.turns ?? 60);
  const runs = Math.max(1, opts.runs ?? 6);
  const findings = [];
  // tab: 이 문제를 고칠 탭. 진단 결과를 그 탭의 AI 수정 요청에 그대로 실어 보내는 데 쓴다.
  const add = (sev, tag, text, tab = null) => findings.push({ sev, tag, text, tab });
  const stats = { turns, runs };

  // ── 0. 형태 검증부터 ──
  const v = validateSchema(schema);
  for (const e of v.errors) add('high', '검증', `${e.path} — ${e.msg}`, tabOfPath(e.path));
  for (const w of v.warnings) add('mid', '검증', `${w.path} — ${w.msg}`, tabOfPath(w.path));
  if (!v.ok) return { ran: false, findings, stats };

  const ACT = schema.actions || [];
  const EV = schema.rules?.events || [];
  const RND = schema.rules?.randomEvents?.table || [];
  const allEv = [...EV, ...RND];
  const writers = writerMap(schema);
  const loseVar = pickLoseVar(schema);
  stats.loseVar = loseVar;

  // 한 효과 묶음 안에서 세웠다가 **같은 묶음에서 시작값으로 되돌리는** 계산용 임시 변수.
  // (맨션봇 `pay_tmp`: 여덟 집을 도는 수금 액션이 min(미납, 소지금)을 담았다가 마지막에 0으로.)
  // 턴이 끝난 뒤의 스냅샷에는 되돌린 값만 남으므로 '안 움직임'이 원리적으로 오탐이다.
  const SCRATCH = new Set();
  for (const g of [
    ...(schema.rules?.events || []).map((e) => e.effects || []),
    ...(schema.rules?.randomEvents?.table || []).map((e) => e.effects || []),
    ...(schema.actions || []).map((a) => a.effects || []),
  ]) {
    const count = {}, last = {};
    for (const f of g) { if (!f.set) continue; count[f.set] = (count[f.set] || 0) + 1; last[f.set] = f; }
    for (const [id, n] of Object.entries(count)) {
      if (n < 2 || last[id].expr == null) continue;
      const x = schema.vars.find((y) => y.id === id);
      if (x && String(last[id].expr).trim() === JSON.stringify(x.init)) SCRATCH.add(id);
    }
  }
  stats.scratchVars = SCRATCH.size;

  // ── 1. 아무도 안 바꾸는 변수 ──
  const frozen = schema.vars.filter((x) => !writers[x.id]);
  for (const x of frozen) {
    add('high', '고정 변수',
      `'${x.id}'(${x.label ?? ''})를 바꾸는 곳이 하나도 없습니다 — 시작값 ${JSON.stringify(x.init)}에서 영원히 고정됩니다. `
      + '계산으로 정해지는 값이면 파생 변수로 빼고, 아니면 규칙·액션·새 시작 중 한 곳에서 set 하세요.', 'vars');
  }
  const frozenIds = new Set(frozen.map((x) => x.id));
  for (const d of (schema.derived || [])) {
    const refs = [...new Set(String(d.expr).match(ID_TOKEN) || [])].filter((n) => schema.vars.some((x) => x.id === n));
    if (refs.length && refs.every((n) => frozenIds.has(n))) {
      add('mid', '고정 변수', `파생 '${d.id}'는 고정 변수(${refs.join(', ')})만 참조합니다 — 값이 절대 변하지 않습니다.`, 'vars');
    }
  }

  // 시간 체계(explicit) 봇 — 시뮬에는 보조 AI가 없어 skip_day가 영영 0이고, 그대로 두면
  // 월세(dom == 1)·계절 이벤트가 전부 "죽은 이벤트"로 오탐된다 (설계 문서의 가장 중요한 함정).
  // 그래서 진단은 **턴마다 하루**가 지난다고 가정하고 굴린다.
  const TCFG = timeConfig(schema);
  if (TCFG && TCFG.advance === 'explicit') {
    stats.timeAssumed = '1일/턴';
    add('low', '시간 가정',
      '시간 진행이 명시적(explicit)이라 시뮬레이션에서는 시간이 저절로 안 흐릅니다 — '
      + '이 진단은 턴마다 하루가 지난다고 가정하고 굴렸습니다. 실제 플레이 속도가 다르면 '
      + '날짜 조건 이벤트의 발동 시점도 그만큼 다릅니다.', null);
  }

  // ── 2. 실제로 굴린다 ──
  const obs = {};                          // id → {min,max}  (vars + derived 전부)
  const trackIds = [...schema.vars.map((x) => x.id), ...(schema.derived || []).map((d) => d.id),
    ...(TCFG ? TCFG.expose : [])];
  const note = (id, n) => {
    if (typeof n !== 'number' || !isFinite(n)) return;
    const o = obs[id] || (obs[id] = { min: Infinity, max: -Infinity });
    if (n < o.min) o.min = n;
    if (n > o.max) o.max = n;
  };
  const moved = new Set();                 // 값이 한 번이라도 변한 변수

  // 패배 변수를 실제로 세우는 이벤트들 — 붕괴 원인을 이름으로 돌려주기 위해 미리 뽑아 둔다
  const loseSetters = new Set(loseVar
    ? allEv.filter((e) => (e.effects || []).some((f) => f.set === loseVar)).map((e) => e.id) : []);

  // once 오남용 관측 — once 이벤트가 발동한 뒤 조건이 풀렸다가 **다시 참이 되면**(재교차)
  // 그건 일회성 전개가 아니라 반복 상태 알림이다. 두 번째부터 조용히 눌린다 (실측: 맨션봇
  // 시설 위기 — once라 재고장이 침묵). 계속 참인 채로 머무는 건 정상(달성 이정표)이라 안 센다.
  const ONCE_EVS = allEv.filter((e) => e.once && e.when);
  const onceRecross = {};                  // id → 재교차 관측 횟수 (기준 판 전체 합산)

  /**
   * @param opts.preset 이 프리셋을 적용하고 시작한다 (난이도 비교용)
   * @param opts.quiet  관측 범위(obs)와 '값이 움직였다'(moved) 집계에 넣지 않는다.
   *   프리셋 판과 두 배로 늘린 판은 기준 판이 아니다. 여기서 본 값을 섞으면
   *   "그 조건은 60턴 안에 안 온다"는 진단이 조용히 틀어진다.
   */
  function sim(seed, policy, nTurns = turns, opts = {}) {
    let st = engine.initState(schema);
    if (opts.preset) {
      const p = engine.applyPreset(schema, st, opts.preset);
      if (p.applied) st = p.state;
    }
    const start = { ...st.vars };
    const fired = {}, everAvail = {};
    const onceSeen = {};                 // once 재교차 추적 — 판마다 새로 (직전 참/거짓 상태)
    let lost = null, lostBy = null, lostAt = null;
    const hist = [{ ...st.vars }];
    for (let i = 0; i < nTurns; i++) {
      let avail = [];
      try { avail = ACT.filter((a) => engine.actionAvailability(schema, st, a).ok); } catch (e) { /* 조건 평가 실패는 무시 */ }
      for (const a of avail) everAvail[a.id] = true;
      const pick = policy ? policy(avail, st, i, seed) : null;
      if (pick) { const t = engine.toggleAction(schema, st, pick.id); if (t.armed) st = t.state; }
      st = engine.sendPhase(schema, st, { rng: seededRng(seed, i, 'send') }).state;
      const o = engine.outputPhase(schema, st, {}, {}, { rng: seededRng(seed, i, 'out') });
      st = o.state;
      // 명시적 시간 진행의 하루/턴 가정 — outputPhase 뒤에 굳혀야 다음 턴의 이벤트가 새 날짜를 본다
      if (TCFG && TCFG.advance === 'explicit') {
        st.vars[EPOCH_KEY] = (typeof st.vars[EPOCH_KEY] === 'number' ? st.vars[EPOCH_KEY] : TCFG.startEpoch) + MIN_PER_DAY;
      }
      // once 재교차 관측 — 발동 후 조건이 거짓→참으로 다시 넘어오는 순간을 센다 (기준 판만)
      if (!opts.quiet && ONCE_EVS.length) {
        const look = engine.makeLookup(schema, st.vars);
        for (const ev of ONCE_EVS) {
          if (!st.meta.firedOnce[ev.id]) continue;
          let t = false;
          try { t = truthy(evaluate(ev.when, look, null)); } catch (e) { continue; }
          if (ev.id in onceSeen) {
            if (!onceSeen[ev.id] && t) onceRecross[ev.id] = (onceRecross[ev.id] || 0) + 1;
          }
          onceSeen[ev.id] = t; // 첫 관측(발동 직후)은 기준선만 기록 — 이어지는 참은 정상
        }
      }
      for (const id of o.firedEvents) fired[id] = (fired[id] || 0) + 1;
      if (!opts.quiet) {
        const look = engine.makeLookup(schema, st.vars);
        for (const id of trackIds) {
          let n; try { n = look(id); } catch (e) { continue; }
          note(id, n);
          if (id in start && JSON.stringify(st.vars[id]) !== JSON.stringify(start[id])) moved.add(id);
        }
      }
      hist.push({ ...st.vars });
      if (lost === null && loseVar && st.vars[loseVar]) {
        lost = i + 1;
        lostBy = o.firedEvents.find((id) => loseSetters.has(id)) ?? null;
        // 붕괴 순간에 바닥까지 간 자원 — "무엇이 떨어져서 죽었나".
        // 처음부터 min이던 값(습격까지 0, 부상자 0 같은 대기 카운터)은 고갈이 아니라 평상시다.
        lostAt = schema.vars
          .filter((x) => (x.type === 'int' || x.type === 'float')
            && x.min != null && x.init !== x.min && st.vars[x.id] <= x.min)
          .map((x) => x.label ?? x.id);
      }
    }
    return { st, fired, everAvail, hist, lost, lostBy, lostAt };
  }

  // 정책 전환 버튼(효과가 enum/bool만 바꾸는 것 — 노동력 배분, 난방 출력 같은 것)은
  // 매 턴 눌러 대면 플레이가 아니라 고장이다. 배분을 하루걸러 통째로 뒤집는 영지는 굶어 죽는다.
  // 그대로 두면 "액션을 쓸수록 빨리 죽는다"가 뜨는데, 그건 액션 탓이 아니라 자동 플레이어 탓이다.
  // 국면 전환은 가끔 하는 것이므로 5턴에 한 번만 후보에 넣는다.
  const NUMERIC_IDS = new Set(schema.vars.filter((x) => x.type !== 'enum' && x.type !== 'bool').map((x) => x.id));
  const isPolicySwitch = (a) => (a.effects || []).length > 0
    && (a.effects || []).every((f) => !NUMERIC_IDS.has(f.set ?? f.list));
  const POLICY_IDS = new Set(ACT.filter(isPolicySwitch).map((a) => a.id));
  const randomPolicy = (av, st, i, seed) => {
    const pool = (i % 5 === 0) ? av : av.filter((a) => !POLICY_IDS.has(a.id));
    const use = pool.length ? pool : av;
    return use.length ? use[Math.floor(seededRng(seed, i, 'pick')() * use.length)] : null;
  };
  let idle, play;
  try {
    idle = Array.from({ length: runs }, (_, k) => sim(`idle${k}`, null));
    play = ACT.length ? Array.from({ length: runs }, (_, k) => sim(`play${k}`, randomPolicy)) : idle;
  } catch (e) {
    add('high', '실행', `시뮬레이션이 중단됐습니다 — ${e.message}`);
    return { ran: false, findings, stats };
  }

  const survOf = (rs) => rs.filter((r) => r.lost === null).length;
  const lifeOf = (rs) => rs.reduce((s, r) => s + (r.lost ?? turns), 0) / rs.length;
  stats.idleSurvive = survOf(idle);
  stats.playSurvive = survOf(play);
  stats.idleLife = lifeOf(idle);
  stats.playLife = lifeOf(play);

  // 수명 하나로는 "천장에 닿았다"는 것밖에 못 본다. 시드마다 딴판인 게 정상인 봇에서
  // 정말 봐야 할 건 결과가 갈리는 폭과, 무엇 때문에 무너지는지의 분포다.
  {
    const lives = play.map((r) => r.lost ?? turns);
    const m = lives.reduce((s, x) => s + x, 0) / lives.length;
    stats.playSpread = Math.sqrt(lives.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, lives.length - 1));
    stats.playRange = [Math.min(...lives), Math.max(...lives)];

    // 원인을 두 가지로 묶어 보고 더 잘게 갈리는 쪽을 쓴다.
    // 패배 이벤트가 하나뿐인 봇(멘탈 0 = 은퇴 같은)에서는 이벤트 이름이 아무것도 말해주지 않는다.
    // 그럴 땐 "그 순간 무엇이 바닥이었나"가 진짜 원인이다.
    const dead = [...idle, ...play].filter((r) => r.lost !== null);
    const tally = (keyOf) => {
      const c = {};
      for (const r of dead) { const k = keyOf(r); c[k] = (c[k] || 0) + 1; }
      return Object.entries(c).sort((a, b) => b[1] - a[1]);
    };
    const byEvent = tally((r) => (r.lostBy
      ? (allEv.find((e) => e.id === r.lostBy)?.notify?.slice(0, 30) ?? r.lostBy) : '원인 불명'));
    const byDrain = tally((r) => (r.lostAt?.length ? `${r.lostAt.slice(0, 2).join('·')} 바닥` : '원인 불명'));
    stats.lossCauses = byDrain.length > byEvent.length ? byDrain : byEvent;

    const everFiredAll = new Set([...idle, ...play].flatMap((r) => Object.keys(r.fired)));
    stats.eventCoverage = allEv.length ? [everFiredAll.size, allEv.length] : null;

    // 한 원인이 8할이면 나머지 위협은 장식이다.
    // 단, 애초에 패배 경로를 하나만 만든 봇(멘탈 0 = 은퇴)은 정상 설계이므로 건드리지 않는다 —
    // "다른 위협이 판을 못 끝낸다"는 말은 다른 위협이 있을 때만 성립한다.
    const totalLosses = stats.lossCauses.reduce((s, [, n]) => s + n, 0);
    if (loseSetters.size >= 2 && totalLosses >= 4 && stats.lossCauses[0][1] / totalLosses >= 0.8) {
      add('low', '붕괴 편중',
        `무너지는 이유가 사실상 하나뿐입니다 — "${stats.lossCauses[0][0]}"가 ${stats.lossCauses[0][1]}/${totalLosses}. `
        + '다른 위협들은 실제로는 판을 끝내지 못하고 있습니다.');
    }
    if (stats.eventCoverage && stats.eventCoverage[0] / stats.eventCoverage[1] < 0.6) {
      add('low', '이벤트 커버리지',
        `이벤트 ${stats.eventCoverage[1]}개 중 ${stats.eventCoverage[0]}개만 실제로 떴습니다 `
        + `(${Math.round(stats.eventCoverage[0] / stats.eventCoverage[1] * 100)}%). 나머지는 플레이어가 볼 일이 거의 없습니다.`);
    }
  }

  if (loseVar) {
    if (stats.playSurvive === 0 && ACT.length) {
      add('high', '난이도', `액션을 눌러도 ${runs}시드 전부 붕괴했습니다 (평균 ${stats.playLife.toFixed(0)}턴). `
        + '플레이어가 이길 방법이 없습니다 — 자원 생산을 늘리거나 위협을 낮추세요.');
    } else if (stats.idleSurvive === runs && stats.playSurvive === runs) {
      add('mid', '난이도', '아무것도 안 해도 전부 생존합니다 — 긴장이 없습니다. 매 턴 소모나 위협을 키우세요.');
    }
    if (ACT.length && stats.playLife < stats.idleLife - turns * 0.05) {
      add('mid', '난이도', `액션을 쓸수록 더 빨리 죽습니다 (방치 ${stats.idleLife.toFixed(0)}턴 → 플레이 ${stats.playLife.toFixed(0)}턴). `
        + '아래 액션별 기여도에서 🔴 표시된 것들을 보세요.');
    }
  } else {
    add('low', '난이도', '패배를 나타내는 bool 변수를 찾지 못해 생존율을 재지 못했습니다 (예: collapsed, colony_lost).'
      + ((schema.setup?.presets || []).length >= 2
        ? ' 프리셋 난이도도 같은 이유로 못 쟀습니다 — 판이 끝나는 조건이 있어야 "어느 쪽이 더 어려운지"를 잴 수 있습니다.' : ''));
  }

  // ── 2.4 프리셋이 정말 난이도인가 ──
  // 라벨에 '어려움'이라고 써 놓고 실제로는 더 오래 사는 판이 흔하다. 시작값을 여러 개 동시에
  // 미는 순간 사람 머리로는 합이 안 잡히기 때문이다. 이름이 아니라 실제 수명으로 줄을 세운다.
  {
    const PRESETS = schema.setup?.presets || [];
    stats.presetCount = PRESETS.length;

    // (a) 시뮬레이션 없이 잡히는 것 — 시작값이 완전히 같은 두 프리셋.
    //     ⚠ "어떤 프리셋에만 있는 키"는 결함이 아니다. 안 적은 칸은 기본 시작값으로 간다는 뜻이고,
    //     기준선 프리셋을 `set: {}`로 두거나 '폐허'에서만 환자 수를 세우는 건 멀쩡한 설계다.
    //     그걸 구멍이라고 신고하면 규격서가 권하는 형태를 규격서가 나무라는 꼴이 된다.
    //     시작값 차이가 진짜 의미 있는지는 아래에서 실제로 굴려서 잰다.
    if (PRESETS.length >= 2) {
      const seen = new Map();
      const dups = [];
      for (const p of PRESETS) {
        const key = JSON.stringify(Object.entries(p.set || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
        if (seen.has(key)) dups.push([seen.get(key), p.label ?? p.id]);
        else seen.set(key, p.label ?? p.id);
      }
      if (dups.length) {
        add('mid', '프리셋 중복',
          dups.map(([a, b]) => `'${a}'와 '${b}'`).join(', ')
          + '가 시작값이 한 글자도 다르지 않습니다 — 이름만 둘이고 판은 하나입니다.', 'presets');
      }
    }

    // (b) 실제로 굴려 본다. 시드를 프리셋 전체에 재사용하는 게 핵심 —
    //     같은 난수를 맞고 시작값만 다르게 하지 않으면 시드 운이 차이를 통째로 덮는다.
    if (loseVar && PRESETS.length >= 2) {
      const probe = PRESETS.slice(0, 6);
      if (probe.length < PRESETS.length) {
        add('low', '시작 프리셋', `프리셋이 ${PRESETS.length}개라 앞 6개만 굴려 봤습니다 `
          + `(${PRESETS.slice(6).map((p) => `'${p.label ?? p.id}'`).join(', ')}는 확인하지 않았습니다).`, null);
      }
      const measure = (policy, tag) => probe.map((p) => {
        const lives = Array.from({ length: runs }, (_, k) =>
          sim(`preset${tag}${k}`, policy, turns, { preset: p.id, quiet: true }))
          .map((r) => r.lost ?? turns);
        const m = lives.reduce((s, x) => s + x, 0) / lives.length;
        const sd = Math.sqrt(lives.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, lives.length - 1));
        return {
          id: p.id, label: p.label ?? p.id, life: m,
          ci: lives.length > 1 ? 1.96 * sd / Math.sqrt(lives.length) : Infinity,
          survive: lives.filter((x) => x >= turns).length,
        };
      });
      try {
        stats.presetMode = 'play';
        stats.presetLives = measure(ACT.length ? randomPolicy : null, 'p');
        // 아무 프리셋으로도 안 죽으면 수명이 전부 최대치로 붙어 비교가 성립하지 않는다.
        // 그럴 땐 방치 기준으로 다시 잰다 — "손 놓고 있었을 때 얼마나 버티는 시작인가"도
        // 어엿한 난이도이고, 이쪽에서는 갈리는 봇이 많다.
        if (ACT.length && stats.presetLives.every((r) => r.survive === runs)) {
          const idleLives = measure(null, 'i');
          if (idleLives.some((r) => r.survive < runs)) {
            stats.presetLives = idleLives;
            stats.presetMode = 'idle';
          }
        }
      } catch (e) { stats.presetLives = null; }
      const MODE = stats.presetMode === 'idle' ? '방치했을 때 기준' : '액션을 쓰며 놀았을 때 기준';

      const L = stats.presetLives;
      if (L && L.length >= 2) {
        // 라벨에서 의도한 난이도 순서를 읽는다. 이름을 안 붙였으면 순서를 따질 근거가 없으므로 넘어간다.
        const RANK = [
          [/악몽|지옥|파멸|불가능|nightmare|impossible|extreme/i, 4],
          [/어려|하드|hard|혹독|가혹|고난|험난|극한/i, 3],
          [/보통|노멀|normal|표준|기본|standard/i, 2],
          [/쉬|이지|easy|입문|평화|관대|여유|casual|무난/i, 1],
        ];
        const rankOf = (s) => (RANK.find(([re]) => re.test(String(s)))?.[1]) ?? 0;
        const ranked = L.map((r) => ({ ...r, rank: rankOf(r.label) })).filter((r) => r.rank);
        const flips = [];
        for (const a of ranked) for (const b of ranked) {
          if (a.rank >= b.rank) continue;            // a가 더 쉬운 쪽이어야 한다
          const gap = b.life - a.life;               // 어려운 쪽이 더 오래 버티면 역전
          if (gap > a.ci + b.ci && gap >= 1) flips.push([a, b, gap]);
        }
        if (flips.length) {
          add('mid', '난이도 역전',
            flips.map(([a, b, gap]) => `'${b.label}'(${b.life.toFixed(0)}턴)이 '${a.label}'(${a.life.toFixed(0)}턴)보다 `
              + `${gap.toFixed(0)}턴 더 오래 버팁니다`).join(', ')
            + ` — 이름과 실제가 뒤집혔습니다 (${MODE}, ${runs}시드 짝비교). `
            + '시작값을 여러 개 동시에 밀면 합이 반대로 나오는 일이 흔합니다. '
            + '어려운 쪽의 비축·완충을 더 깎거나, 쉬운 쪽에 준 페널티를 되돌리세요.', 'presets');
        }

        // 전부 끝까지 살아남는 판에서는 수명이 전부 최대치라 비교 자체가 성립하지 않는다.
        // 그건 프리셋 탓이 아니라 판이 안 끝나는 탓이고, 이미 위에서 '난이도'로 신고했다.
        const anyLoss = L.some((r) => r.survive < runs);
        const hi = L.reduce((a, b) => (a.life >= b.life ? a : b));
        const lo = L.reduce((a, b) => (a.life <= b.life ? a : b));
        if (anyLoss && hi.life - lo.life <= Math.max(hi.ci, lo.ci, 1)) {
          add('mid', '프리셋 무의미',
            `프리셋 ${L.length}개의 수명이 사실상 같습니다 — ${MODE} (`
            + L.map((r) => `${r.label} ${r.life.toFixed(0)}턴±${r.ci === Infinity ? '?' : r.ci.toFixed(1)}`).join(' / ')
            + '). 이름만 다르고 판은 같습니다 — 한 축만 조금 밀어서는 차이가 안 납니다. '
            + '비축(자원 시작량)·완충(게이지 여유)·국면(enum/bool을 나쁜 쪽으로 시작) 중 최소 두 축을 함께 미세요.', 'presets');
        }
      }
    }

    if (!PRESETS.length && !schema.setup?.ai?.enabled) {
      add('low', '시작 프리셋',
        '시작 프리셋이 없습니다 — 모든 플레이어가 똑같은 시작값으로 시작합니다. '
        + '난이도나 배경을 2~3개 만들어 두면 새 채팅 시작 시 패널에서 골라 누를 수 있습니다.', 'presets');
    }
  }

  // ── 2.5 판을 두 배로 늘려 한 번 더 굴려 본다 ──
  // 굶주림·전멸·부 2900 같은 조건은 60턴 안에 갈 일이 없다. 그런데 진단은 그걸
  // "죽은 이벤트"라고 부르며 결함처럼 신고했다 — 같은 봇이 60턴에선 5건, 120턴에선 0건.
  // 판이 짧아서 안 닿은 것과 영영 못 닿는 것은 전혀 다른 얘기이므로 구분해서 말해야 한다.
  // 시드는 적게(2개), 대신 판을 길게. 미발동 항목이 있을 때만 돌린다.
  const longTurns = turns * 2;
  let firedLong = null, availLong = null;
  const probeLong = () => {
    if (firedLong) return;
    firedLong = new Set(); availLong = new Set();
    try {
      const rs = [sim('long0', null, longTurns, { quiet: true }),
        ...(ACT.length ? [sim('long1', randomPolicy, longTurns, { quiet: true })] : [])];
      for (const r of rs) {
        for (const id of Object.keys(r.fired)) firedLong.add(id);
        for (const id of Object.keys(r.everAvail)) availLong.add(id);
      }
    } catch (e) { /* 길게 굴리다 터지면 그냥 확인 없이 간다 */ }
  };
  // 짧은 판에서 못 본 것을 긴 판에서는 봤는가
  const onlyLonger = (id, kind) => {
    probeLong();
    return kind === 'action' ? availLong.has(id) : firedLong.has(id);
  };
  const laterNote = `${turns}턴 안에는 여기까지 가지 않을 뿐이고, ${longTurns}턴으로 늘리면 실제로 뜹니다 — `
    + '판이 짧아서지 결함이 아닙니다. 이 봇의 후반부까지 보려면 진단 턴 수를 올리세요.';

  // ── 3. 죽은 이벤트 ──
  const everFired = new Set([...idle, ...play].flatMap((r) => Object.keys(r.fired)));
  // 안 뜬 이벤트**만이** 세우는 값 — 그 값에 걸린 것들은 별개의 문제가 아니라 같은 문제의 그림자다.
  // 래치 짝을 제대로 만든 봇일수록 손해를 본다: 위기가 안 뜨면 → 경보가 안 켜지고 → 회복도 안 뜨고
  // → 경보 변수도 '안 움직임'. 하나짜리 원인이 지적 셋이 된다 (실측: 맨션봇 시설 4종 = 12건).
  const finalStates = [...idle, ...play].map((r) => r.st.vars);
  const deadOnlyVars = new Set(schema.vars.filter((x) => {
    const w = writers[x.id];
    if (!w || w.size !== 1 || !w.has('이벤트')) return false;
    const setters = allEv.filter((o) => (o.effects || []).some((f) => (f.set ?? f.list) === x.id));
    return setters.length > 0 && setters.every((o) => !everFired.has(o.id));
  }).map((x) => x.id));
  stats.deadEvents = 0;
  for (const e of allEv) {
    if (everFired.has(e.id)) continue;
    stats.deadEvents++;
    const selfSets = new Set((e.effects || []).map((f) => f.set ?? f.list).filter(Boolean));
    const gate = gatedBySetting(e.when, schema, writers, moved, selfSets);
    if (gate) {
      const excused = gate.byPlayer || gate.byAI;
      add(excused ? 'low' : 'mid', '설정 의존',
        `'${e.id}'는 ${gate.label}이(가) ${JSON.stringify(gate.init)}인 동안 뜨지 않습니다`
        + (gate.byPlayer ? ' (다른 설정에서는 뜹니다 — 정상)'
          : gate.byAI ? ' — 이 값은 보조 AI가 서사를 보고 세웁니다. 시뮬레이션에는 AI가 없어 '
            + '영영 시작값인 것이고, 결함이 아닙니다.'
            : ' — 그런데 그 값을 바꿀 수단이 없습니다.'), excused ? null : 'vars');
      continue;
    }
    // 안 뜬 이벤트가 세워 줘야 하는 플래그에 막혀 있다 — 원인은 그쪽 하나다.
    const via = schema.vars.find((x) => deadOnlyVars.has(x.id) && blockedBy(e.when, finalStates, schema, x));
    if (via) {
      stats.deadEvents--;
      stats.cascadeEvents = (stats.cascadeEvents ?? 0) + 1;
      const src = allEv.filter((o) => o.id !== e.id && (o.effects || []).some((f) => (f.set ?? f.list) === via.id));
      add('low', '연쇄', `'${e.id}'는 ${via.label ?? via.id}이(가) 켜져야 뜨는데, 그 값을 세우는 `
        + `${src.length ? `이벤트(${src.map((o) => `'${o.id}'`).join(', ')})가` : '이벤트가'} 안 떴습니다 — `
        + '따로 고칠 것이 아니라 그쪽 하나가 원인입니다.', null);
      continue;
    }
    const b = bottleneck(e.when, obs);
    const where = b
      ? `\`${b.id} ${b.op} ${b.need}\` 인데 관측 ${b.op === '>=' || b.op === '>' ? '최고' : '최저'} ${b.got}`
        + (b.pct != null ? ` (${b.pct}%)` : '')
        + (b.ofBranches ? ` — ${b.ofBranches}갈래(or) 중 가장 가까운 것` : '')
      : `조건: ${e.when ?? '(없음)'}`;
    if (onlyLonger(e.id, 'event')) {
      stats.deadEvents--;                        // 죽은 게 아니라 아직 안 온 것
      stats.lateEvents = (stats.lateEvents ?? 0) + 1;
      add('low', '후반부 이벤트', `'${e.id}'는 ${turns}턴 안에 안 떴습니다 — ${where}. ${laterNote}`, null);
      continue;
    }
    // notify 없는 이벤트는 규격서가 가르치는 "값 자르기" — 범위를 벗어난 값을 되돌리는 안전장치다.
    // 이건 안 뜨는 게 성공이다. 뜬다는 건 다른 규칙이 말도 안 되는 값을 만들었다는 뜻이니까.
    // 우리가 쓰라고 가르친 패턴을 우리가 결함으로 신고하면 안 된다.
    if (!e.notify) {
      stats.deadEvents--;
      stats.guardEvents = (stats.guardEvents ?? 0) + 1;
      add('low', '안전장치', `'${e.id}'는 한 번도 안 떴습니다 — ${where}. `
        + '통지문(notify)이 없는 걸로 보아 값을 되돌리는 안전장치입니다. '
        + '이런 건 안 뜨는 게 정상입니다 (뜬다면 다른 규칙이 범위 밖 값을 만들었다는 뜻). 고치지 마세요.', null);
      continue;
    }
    // 문턱에 걸린 값을 보조 AI가 그 방향으로 밀 수 있는가 — 그렇다면 관측 범위가 증거가 못 된다.
    // 안전장치·후반부 판정 뒤에 둔다: 그쪽이 더 구체적인 설명이고, 여기서 가로채면 안 된다.
    if (aiGated(schema, b, turns)) {
      stats.deadEvents--;
      stats.aiGated = (stats.aiGated ?? 0) + 1;
      add('low', 'AI 담당 문턱', `'${e.id}' 미발동 — ${where}. 다만 '${b.id}'은(는) 보조 AI가 `
        + '서사에 따라 움직이는 값이라, AI 없이 굴리는 이 진단에서는 시작값 근처에 머뭅니다 — '
        + '**문턱을 내리지 마세요.** 실제 플레이에서 정말 안 뜨는지는 채팅을 몇 턴 돌려서 보세요.', null);
      continue;
    }
    add('mid', '죽은 이벤트', `'${e.id}' 미발동 — ${where}`
      + (b ? '. 문턱을 내리거나 그 값을 올릴 경로를 주세요.' : ''), 'rules');
  }

  // ── 4. 도배되는 이벤트 ──
  for (const e of EV) {
    if (e.once) continue;
    const avg = idle.reduce((s, r) => s + (r.fired[e.id] || 0), 0) / runs;
    if (avg > turns * 0.5) {
      add('mid', '도배', `'${e.id}'이 평균 ${avg.toFixed(0)}/${turns}턴 발동합니다 — `
        + '효과가 조건을 해소하지 못해 매 턴 반복됩니다. 효과에서 조건 변수를 되돌리거나 `once: true`를 쓰세요.', 'rules');
    }
  }

  // ── 4.5 once에 눌린 재발 ──
  // 발동 후 조건이 풀렸다가 다시 참이 된 once 이벤트 — 반복 상황인데 두 번째부터 침묵한다.
  // "계속 참"(달성 이정표)은 안 세므로 survived·ready류 정상 설계는 안 걸린다.
  for (const [id, n] of Object.entries(onceRecross)) {
    add('mid', 'once 재발 눌림',
      `'${id}'는 once인데, 발동한 뒤 조건이 풀렸다가 다시 참이 되는 것이 ${n}회 관측됐습니다 — `
      + '두 번째부터는 아무 알림 없이 눌립니다. 반복될 수 있는 상태 알림이면 once 대신 '
      + '경보 플래그 래치 짝(터질 때 플래그 켬 · 회복 이벤트가 끔)을 쓰세요.', 'rules');
  }

  // ── 5. 액션 ──
  if (ACT.length) {
    const everAvail = new Set([...idle, ...play].flatMap((r) => Object.keys(r.everAvail)));
    for (const a of ACT) {
      if (everAvail.has(a.id)) continue;
      const b = bottleneck(a.when, obs);
      const where = b
        ? `\`${b.id} ${b.op} ${b.need}\` 인데 관측 ${b.op === '>=' || b.op === '>' ? '최고' : '최저'} ${b.got}`
          + (b.pct != null ? ` (${b.pct}%)` : '')
          + (b.ofBranches ? ` — ${b.ofBranches}갈래(or) 중 가장 가까운 것` : '')
        : `조건: ${a.when ?? '(없음)'}`;
      if (onlyLonger(a.id, 'action')) {
        stats.lateActions = (stats.lateActions ?? 0) + 1;
        add('low', '후반부 액션',
          `'${a.label ?? a.id}'는 ${turns}턴 안에 열리지 않았습니다 — ${where}. ${laterNote}`, null);
        continue;
      }
      if (aiGated(schema, b, turns)) {
        stats.aiGated = (stats.aiGated ?? 0) + 1;
        add('low', 'AI 담당 문턱', `'${a.label ?? a.id}'가 한 번도 안 열렸습니다 — ${where}. `
          + `다만 '${b.id}'은(는) 보조 AI가 서사에 따라 움직이는 값이라, AI 없이 굴리는 이 진단에서는 `
          + '시작값 근처에 머뭅니다 — **여는 조건을 낮추지 마세요.**', null);
        continue;
      }
      add('high', '못 쓰는 액션',
        `'${a.label ?? a.id}'를 한 번도 쓸 수 없었습니다 — ${where}`, 'actions');
    }

    if (opts.actionImpact !== false && loseVar && ACT.length > 1) {
      // 기여도는 "그 액션만 계속 쓰기 vs 방치"로 재면 안 된다.
      // 한 버튼만 누르는 건 플레이 방식 자체를 왜곡해서, 방치가 강한 봇에서는
      // 멀쩡한 액션도 전부 함정으로 나오고 숫자가 ±20턴씩 튄다.
      // → 대신 "이 버튼이 있을 때 vs 이 버튼만 빼고 나머지는 그대로일 때"를 잰다.
      //   그게 '이 버튼이 있어서 이득인가'라는 질문에 실제로 답하는 방식이다.
      // 두 판을 나란히 돌린다. 나머지 액션은 양쪽 다 똑같이 쓰고, 이 버튼의 유무만 다르다.
      //   [있음] 쓸 수 있으면 이 버튼을 쓰고, 못 쓰면 나머지 중 하나
      //   [없음] 이 버튼은 아예 없고 나머지 중 하나
      // 순수 leave-one-out은 이 버튼이 1/N 확률로만 눌려 신호가 묻힌다. 이렇게 하면
      // 주변 플레이는 현실적으로 유지하면서 이 버튼의 영향만 또렷해진다.
      const rest = (av, a, seed, i) => {
        const ok = av.filter((x) => x.id !== a.id);
        return ok.length ? ok[Math.floor(seededRng(seed, i, 'pick')() * ok.length)] : null;
      };
      // 정책 전환 액션(효과가 enum/bool만 바꾸는 것)은 이 방식으로 평가할 수 없다.
      // 가치가 전적으로 "언제 누르냐"에 달려 있는데 자동 플레이어는 그 판단을 못 한다.
      // 넣어 두면 멀쩡한 작업 배분 버튼이 전부 함정으로 신고된다.

      // 지속 정책(hold)은 한 번 켜면 계속 켜져 있다. 그런데도 매 턴 그 버튼을 다시 고르면
      // [있음] 판이 "40턴 내내 이 버튼만 누르고 다른 액션은 하나도 안 쓴 판"이 되어,
      // 멀쩡한 hold 액션이 전부 함정으로 신고된다. 무장된 뒤로는 평소처럼 놀게 둔다.
      const onPick = (a) => (av, st, i, seed) => {
        if ((a.mode || 'oneshot') === 'hold' && st.meta?.armed?.[a.id]) return rest(av, a, seed, i);
        return av.find((x) => x.id === a.id) || rest(av, a, seed, i);
      };

      // 시드 운이 그대로 숫자로 새어 나온다. 실측하면 6시드일 때 95% 신뢰구간이 ±7턴쯤이라,
      // "10턴 손해"라는 지적이 사실은 시드 운인 경우가 흔했다. 두 가지로 막는다.
      //   ① 이 측정만 시드를 더 쓴다 (다른 진단은 6시드로 충분하다).
      //   ② 짝지은 차이의 신뢰구간을 같이 내고, 구간이 0쪽으로 걸치면 지적하지 않는다.
      // 두 판이 같은 시드(`on${k}`)를 쓰는 건 공통 난수(paired) 기법이다 — 시드 운이
      // 양쪽에서 상쇄돼 분산이 최대 9배까지 줄어든다. 이건 예전부터 이렇게 돌고 있었다.
      const impactRuns = Math.max(runs, opts.impactRuns ?? 12);
      const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const ci95 = (xs) => {
        if (xs.length < 2) return Infinity;
        const m = mean(xs);
        const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
        return 1.96 * sd / Math.sqrt(xs.length);
      };

      const impact = [];
      for (const a of ACT) {
        if (ACT.length < 2) break;
        if (isPolicySwitch(a)) continue;
        let paired;
        try {
          paired = Array.from({ length: impactRuns }, (_, k) => {
            const seed = `on${k}`;
            const on = sim(seed, onPick(a));
            const off = sim(seed, (av, st, i, s) => rest(av, a, s, i));
            return (on.lost ?? turns) - (off.lost ?? turns);
          });
        } catch (e) { continue; }
        impact.push({ id: a.id, label: a.label ?? a.id, delta: mean(paired), ci: ci95(paired),
          n: impactRuns, exempt: !!a.impactExempt });
      }
      impact.sort((p, q) => q.delta - p.delta);
      stats.actionImpact = impact;
      stats.impactRuns = impactRuns;
      // 전부 끝까지 살아남으면 두 판의 수명이 똑같이 `turns`라 차이가 0으로 깔린다.
      // 표가 전부 "구분 안 됨"으로 나오는 게 액션 탓이 아니라 판이 짧아서라는 걸 알려야 한다.
      stats.impactSaturated = stats.playSurvive === runs
        && impact.length > 0 && impact.every((it) => Math.abs(it.delta) <= it.ci);
      stats.actionSkipped = ACT.filter(isPolicySwitch).map((a) => a.label ?? a.id);
      // 짧은 판에서 시드 편차를 함정으로 오인하지 않도록 최소 3턴 + 판 길이의 8%를 넘어야 지적한다.
      const trapLine = Math.max(3, turns * 0.08);
      for (const it of impact) {
        // 의도적으로 대가를 치르게 만든 버튼(장기 적출 같은)은 수명으로 재면 영영 🔴다.
        // 스키마에서 `impactExempt: true`를 달아 두면 표에는 남기되 지적은 하지 않는다.
        if (it.exempt) continue;
        // 신뢰구간의 낙관적인 끝(delta + ci)까지 손해여야 지적한다.
        // 이 한 줄이 "고쳐도 다음 진단에 또 뜨는" 유령 지적의 대부분을 없앤다.
        if (it.delta + it.ci < -trapLine) {
          add('mid', '함정 액션',
            `'${it.label}'를 빼면 오히려 ${(-it.delta).toFixed(1)}턴(±${it.ci.toFixed(1)}) 더 오래 삽니다 — `
            + '이 버튼은 있는 것 자체가 손해입니다. 반대급부를 줄이거나, 이득을 키우거나, 쓸 조건을 좁히세요. '
            + '일부러 대가를 치르게 만든 버튼이면 스키마에 `impactExempt: true`를 달아 이 지적을 끄세요.', 'actions');
        }
      }
    }
  }

  // ── 6. 수치의 움직임 ──
  // 시뮬레이션에는 보조 AI가 없다. 그래서 AI(updater.allow)나 최초설정만이 건드리는 값은
  // 여기서 절대 안 움직이는 게 당연하다 — 그걸 결함으로 신고하면, 서술을 AI에게 맡긴 봇일수록
  // 보고서가 오탐으로 뒤덮인다(실측: 33건 중 20건). 안 움직이는 게 아니라 잴 수가 없는 것이다.
  // ⚠ '새 시작'(시작 프리셋)도 여기서 빼야 한다. 최초설정과 똑같이 **시작값만** 정하는 곳이지
  // 플레이 중에 값을 움직이는 곳이 아니다. 남겨 두면 프리셋에서 한 번 정하고 그 뒤로는 AI만
  // 만지는 값(장소·장비·능력치)이 전부 "안 움직임"으로 신고된다 — 실측 6개 템플릿 12개 변수.
  // 시뮬레이션이 실제로 굴릴 수 있는 건 매 턴 처리·이벤트·랜덤·액션뿐이다.
  const IN_PLAY = new Set(['onTurn', '이벤트', '랜덤', '액션', '판정', '선택']);
  const simCanMove = (id) => [...(writers[id] || [])].some((who) => IN_PLAY.has(who));
  let aiOnlyStill = 0, cascadeStill = 0;
  for (const x of schema.vars) {
    if (frozenIds.has(x.id)) continue;
    // 시간 진행 입구는 엔진이 매 턴 소비 후 0으로 되돌리는 우편함 — 관측 시점엔 늘 0이라
    // "안 움직임"이 원리적으로 오탐이다. 실제 배선은 시간 흐름(날짜 이벤트)으로 이미 검증된다.
    if (TCFG && (x.id === SKIP_DAY || x.id === SKIP_MIN)) continue;
    // 효과 안에서 세웠다 되돌리는 계산용 임시 변수도 같은 이유로 잴 수 없다.
    if (SCRATCH.has(x.id)) { aiOnlyStill++; continue; }
    const series = [...idle, ...play].flatMap((r) => r.hist.map((h) => h[x.id]));
    if (new Set(series.map((s) => JSON.stringify(s))).size === 1) {
      if (!simCanMove(x.id)) { aiOnlyStill++; continue; }
      // 안 뜬 이벤트만이 세우는 플래그 — 원인은 그 이벤트 쪽이고 이미 3번에서 말했다.
      if (deadOnlyVars.has(x.id)) { cascadeStill++; continue; }
      const w = [...(writers[x.id] || [])];
      const aiToo = w.includes('AI');
      add(aiToo ? 'low' : 'mid', '안 움직임', `'${x.id}'가 ${turns}턴 내내 ${JSON.stringify(x.init)}에서 안 변했습니다 — `
        + `바꾸는 곳(${w.join(', ')})의 조건이 한 번도 안 걸렸습니다.`
        + (aiToo ? ' 다만 보조 AI도 이 값을 바꾸는데 시뮬레이션에는 AI가 없으니, 실제 플레이에서는 움직일 수 있습니다.' : ''),
      aiToo ? null : (w.every((who) => who === '액션') ? 'actions' : 'rules'));
      continue;
    }
    if (!simCanMove(x.id)) continue; // 아래 단조 검사도 마찬가지 이유로 성립하지 않는다
    if (x.type !== 'int' && x.type !== 'float') continue;
    if (/^(day|turn|week|month|year|round)$/i.test(x.id)) continue;
    let down = true, up = true;
    for (const r of [...idle, ...play]) {
      for (let i = 1; i < r.hist.length; i++) {
        if (r.hist[i][x.id] > r.hist[i - 1][x.id]) down = false;
        if (r.hist[i][x.id] < r.hist[i - 1][x.id]) up = false;
      }
    }
    if (down) add('mid', '단조 자원', `'${x.id}'(${x.label ?? ''})가 줄기만 합니다 — 늘리는 경로가 없어 반드시 바닥납니다.`, 'rules');
    else if (up) add('low', '단조 자원', `'${x.id}'(${x.label ?? ''})가 늘기만 합니다 — 줄어드는 경로가 없어 무한히 커집니다.`, 'rules');
    // 끝에 어디 있느냐보다 "판의 대부분을 그 끝에서 보내느냐"가 문제다.
    // 시작값이 곧 하한인 자원(포로 0 등)이 매번 지적으로 뜨면 고쳐도 안 사라지는 잡음이 된다.
    const all = [...idle, ...play].flatMap((r) => r.hist.map((h) => h[x.id]));
    const frac = (n) => all.filter((v2) => v2 === n).length / all.length;
    if (x.max != null && frac(x.max) > 0.8) {
      add('low', '눌어붙음', `'${x.id}'가 판의 ${Math.round(frac(x.max) * 100)}%를 최대치 ${x.max}에서 보냅니다 — 그 구간에서 수치가 의미를 잃습니다.`, 'rules');
    }
    if (x.min != null && x.init !== x.min && frac(x.min) > 0.8) {
      add('low', '눌어붙음', `'${x.id}'가 판의 ${Math.round(frac(x.min) * 100)}%를 최소치 ${x.min}에서 보냅니다 — 그 구간에서 수치가 의미를 잃습니다.`, 'rules');
    }
  }
  // 건너뛴 걸 말하지 않으면 "전부 확인했다"로 읽힌다.
  stats.aiOnlyVars = aiOnlyStill;
  if (aiOnlyStill) {
    add('low', '측정 불가',
      `변수 ${aiOnlyStill}개는 보조 AI·최초설정·시작 프리셋만 값을 정하거나 효과 안에서만 쓰이는 항목이라 `
      + '이 진단으로는 움직임을 잴 수 없습니다 (시뮬레이션에는 AI가 없습니다). '
      + '결함이라는 뜻이 아니라 확인 대상이 아니라는 뜻입니다 — '
      + '실제로 갱신되는지는 채팅을 몇 턴 돌려서 눈으로 보세요.', null);
  }
  stats.cascadeVars = cascadeStill;
  if (cascadeStill) {
    add('low', '연쇄', `변수 ${cascadeStill}개는 위에서 '안 떴다'고 신고한 이벤트만이 세우는 값이라 `
      + '함께 안 움직였습니다 — 따로 고칠 것이 아니라 그 이벤트가 뜨면 같이 풀립니다.', null);
  }

  // ── 7. 시작값 = 조건 경계 ──
  const initOf = Object.fromEntries(schema.vars.map((x) => [x.id, x.init]));
  const scan = (when, where, tab) => {
    if (!when) return;
    CMP.lastIndex = 0;
    let m;
    while ((m = CMP.exec(when))) {
      const [, id, op, numS] = m;
      const n = Number(numS);
      if (typeof initOf[id] !== 'number' || initOf[id] !== n) continue;
      if ((op !== '<' && op !== '>')) continue;                 // <= / >= 는 경계에서 참이라 함정이 아니다
      // 바꾸는 곳이 있으면 "첫 턴에만 거짓"일 뿐이다. `prisoners > 0`에 시작값 0처럼
      // 지극히 정상적인 설계가 매번 지적으로 뜨면, 고쳐도 사라지지 않는 잡음이 된다.
      if ((writers[id]?.size ?? 0) > 0) continue;
      add('high', '경계값',
        `${where}: \`${id} ${op} ${n}\` 인데 시작값이 정확히 ${n}이고 아무도 그 값을 바꾸지 않습니다 — 영영 거짓입니다.`, tab);
    }
  };
  for (const e of EV) scan(e.when, `이벤트 '${e.id}'`, 'rules');
  for (const e of RND) scan(e.when, `랜덤 '${e.id}'`, 'rules');
  for (const a of ACT) scan(a.when, `액션 '${a.id}'`, 'actions');
  for (const d of (schema.directives || [])) scan(d.when, `지시문 '${d.id}'`, 'rules');

  // ── 8. 상태창 노출 ──
  // 그룹은 { items:[{var}] } 형태다. 옛 { vars:[id] } 형태도 함께 받아 준다.
  const shown = new Set((schema.statusUI?.groups || []).flatMap((g) => [
    ...(g.items || []).map((it) => (typeof it === 'string' ? it : it?.var)),
    ...(g.vars || []),
  ]).filter(Boolean));
  const tmpl = JSON.stringify(schema.statusUI ?? {}) + (schema.promptState?.template ?? '');
  const inTmpl = new Set((tmpl.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g) || []).map((s) => s.slice(1, -1)));
  // 시간 진행 입구는 엔진이 소비 후 0으로 되돌리는 우편함이라 상태창에 늘 0으로만 뜬다 —
  // "안 보인다"가 아니라 보일 값이 아니다 ('안 움직임' 면제와 같은 이유).
  const hidden = schema.vars.filter((x) => !shown.has(x.id) && !inTmpl.has(x.id)
    && !(TCFG && (x.id === SKIP_DAY || x.id === SKIP_MIN)));
  if (hidden.length) {
    add('low', '표시 안 됨', `상태창에 안 보이는 변수 ${hidden.length}개: ${hidden.map((x) => x.id).join(', ')} — `
      + '내부용이면 정상이고, 플레이어가 알아야 할 값이면 상태창 탭에서 추가하세요.', 'status');
  }

  stats.high = findings.filter((f) => f.sev === 'high').length;
  stats.mid = findings.filter((f) => f.sev === 'mid').length;
  stats.low = findings.filter((f) => f.sev === 'low').length;
  return { ran: true, findings, stats };
}

/** 지적 하나를 회차 사이에서 같은 것으로 알아보기 위한 열쇠 (수치는 매번 달라지므로 뺀다) */
function findingKey(f) {
  const id = /'([^']+)'/.exec(f.text);
  return `${f.tag}|${id ? id[1] : f.text.slice(0, 30)}`;
}

/**
 * 두 진단 결과를 비교한다.
 * "고쳐도 비슷하게 나온다"는 느낌의 정체를 밝혀 준다 — 실제로 뭐가 사라지고 뭐가 남았는지.
 */
function compareDiagnoses(prev, curr) {
  if (!prev?.ran || !curr?.ran) return null;
  const pk = new Set(prev.findings.map(findingKey));
  const ck = new Set(curr.findings.map(findingKey));
  const fixed = prev.findings.filter((f) => !ck.has(findingKey(f)));
  const fresh = curr.findings.filter((f) => !pk.has(findingKey(f)));
  const stayed = curr.findings.filter((f) => pk.has(findingKey(f)));
  const d = (k) => (curr.stats[k] ?? 0) - (prev.stats[k] ?? 0);
  return {
    fixed, fresh, stayed,
    delta: { high: d('high'), mid: d('mid'), low: d('low'), deadEvents: d('deadEvents') },
    survive: prev.stats.loseVar && curr.stats.loseVar
      ? { idle: [prev.stats.idleSurvive, curr.stats.idleSurvive],
        play: [prev.stats.playSurvive, curr.stats.playSurvive],
        idleLife: [prev.stats.idleLife, curr.stats.idleLife],
        playLife: [prev.stats.playLife, curr.stats.playLife] }
      : null,
  };
}

module.exports = { diagnose, writerMap, bottleneck, pickLoseVar, findingKey, compareDiagnoses };
