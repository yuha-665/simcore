// 전투 안무 (v1.6.0, checks[].fight) — 상수·예약 키·상태 헬퍼·검증·상태창 칩.
// 라운드 굴림(rollFightRound)은 engine.js에 산다 — rollCheck·applySets를 쓰므로 순환 require를 피한다.
//
// 계기(유저 2026-09-02): 액션씬이 "이얍 공격 → 끄앙 당했다 → 이겼다"로 밋밋하다. 유저가 디테일하게
// 적어주면 잘 쓴다 = 모델에 없는 **재료**(기술·무기·상대·장소)와 **구조**(공방 순서·끝나는 지점)를
// 유저가 손으로 채우는 것. 판정은 지금껏 결과 하나만 줬다 — 결과에 이르는 과정(비트)을 시스템이
// 굴려 안무 시트로 준다. "숫자는 시스템, 묘사는 LLM"을 전투 안으로.
//
// 결착은 시트에 박지 않는다 (유저 판정: 한 응답에 전투가 끝나 버린다). 공격 등급의 gain이 상대
// 게이지에 쌓이고, 찼을 때만 결착 비트가 뜬다 — 라운드 수는 등급 대 굴림에서 저절로(육성 체감).
// 라운드 입구는 ⚔ 액션을 매 라운드 누르는 것 하나뿐 (hold ❌):
//   ⚔ + 짧은 입력("대충 싸웠다")  → 개시 비트까지 시스템이 씀 (맡김 — 낱말이 없으면 주인공 수도 시스템이 뽑는다)
//   ⚔ + 긴 입력                  → 유저 수는 그대로, 얼마나 먹혔는지(등급)만 굴림 (낱말이 없으면 '자유 수')
//   ⚔ 없음                       → 자유 장면. 게이지 불변 + "쓰러뜨리지 마라" 상시 줄
// 수 유형 (v1.15.0): 라운드가 "주인공의 공격 → 상대의 반격 → 끝"으로 고정돼 턴제 게임처럼 무조건 주고받았다 (유저: "막고 피하고 때리는
// 상호작용이 주체에 따라 적절히"). 이제 유저 글의 낱말로 주인공의 수(공격·기술·수비·견제)를 읽고, 상대의 수(공격·밀어붙이기·수세·탐색)는
// 시스템이 판세(몰림·주인공의 수·라운드)를 보고 가중치로 뽑는다 — 리롤에 안정적이고 진단이 굴릴 수 있다. 수비는 공격을 굴리지 않고 상대가
// 들어올 때 반응 판정(reply)에 이점, 견제는 반값 누적 + 다음 공격에 이점, 기술은 ×1.5 (빗나가면 빈틈), 상대 수세는 다음 공격 반감.
// 결과(먹힘·막힘·피함)는 시스템이, 묘사는 모델이 — 시트는 각본이 아니라 결과 제약이다.
// 결착은 ⚔에서만 나온다 — 모델이 혼자 전투를 끝낼 길이 구조적으로 없다.
//
// 상태는 예약 키(fight_*)로 vars에 산다 — time_epoch·scn_idx와 같은 계열: when·상태창·지시문이
// 그대로 읽고, 스냅샷·리롤에 같이 되감긴다. 보조 allow에 올릴 형태가 아니라 AI가 못 만진다.

const FIGHT_KEYS = {
  max: 'fight_max',       // 게이지 크기. 0 = 교전 없음
  gauge: 'fight_gauge',   // 누적 유효량
  round: 'fight_round',   // 굴린 라운드 수
  foe: 'fight_foe',       // 상대 라벨 (개전 때 굳음)
  idle: 'fight_idle',     // ⚔ 없이 지나간 전송 수 — idleTurns에 닿으면 정리
  check: 'fight_check',   // 개전한 판정 id
  edge: 'fight_edge',     // 견제가 준 이점 — 다음 공격·기술·자유 수에 한 번 (v1.15.0)
  guard: 'fight_guard',   // 상대가 자세를 잡았다 — 다음 공격 반감 (v1.15.0)
};
// 노출 이름 fight_on(엔진 lookup이 계산)까지 예약 — 변수/파생이 이 이름을 쓰면 검증 오류
const FIGHT_RESERVED = [...Object.values(FIGHT_KEYS), 'fight_on'];

const FIGHT_SHORT_INPUT = 40;   // 이 길이 미만의 유저 입력 = "맡김" (개시 비트까지 시스템이)
const FIGHT_IDLE_DEFAULT = 8;   // ⚔ 없이 이만큼 지나면 교전 정리 — 상시 줄이 영영 남는 사고 방지

// 맡김 모드의 개시 비트 — 굴림이 아니라 "재료를 쓰게 하는" 요구. 시드 rng로 하나를 고른다.
const DEFAULT_FIGHT_FLAVOR = [
  '상대의 기술·습성이 드러나는 수 하나 — 이 상대가 어떤 놈인지 몸으로 보여 줘라',
  '지형·주변 사물을 쓰는 수 — 장소가 전투에 개입한다',
  '감각 하나를 골라 파고들어라 — 소리·냄새·시야·통증 중 하나가 장면을 지배한다',
  '한순간의 정적 — 서로를 재는 호흡, 그 뒤에야 움직임',
  '주인공의 몸 상태가 수에 묻어난다 — 숨·다리·쥔 손, 지친 만큼 거칠게',
];
const DEFAULT_FIGHT_RULE = '시스템이 굴린 결과다. 비트의 결과(먹힘·막힘·피함·빗나감·공방 없음)는 바꾸거나 건너뛰지 마라 — 그 결과에 '
  + '어떻게 이르는지는 네가 쓴다, 비트마다 한 문단 이상. 공방을 꼭 번갈아 주고받을 필요는 없다: 시트에 없는 공격·피해를 보태지 마라. '
  + '번호·기호·표는 본문에 쓰지 마라. 기술·무기는 실명으로 써라.';
const DEFAULT_FIGHT_ROUND_END = '라운드 끝 — 상대는 아직 쓰러지지 않는다. 다음 수는 유저가 정한다. 여기서 멈춰라.';
const DEFAULT_FIGHT_WIN = '결착 — 상대는 더 싸울 수 없다. 도주·항복·전투 불능 중 하나로 이 라운드 안에서 마무리하라. '
  + '전리품·정산은 다음 장면의 몫이다.';
const DEFAULT_FIGHT_LOSE = '결착 — 주인공 쪽이 무너진다. 이 라운드 안에서 쓰러지는 장면으로 끝내라. '
  + '그 뒤의 일(구조·포획·도주 허용)은 다음 장면의 몫이다.';
// ⚔ 없이 교전이 열려 있는 전송마다 — 맨 끝자락(생성에 가깝게). {fight_*}는 예약 키 그대로 읽힌다
const DEFAULT_FIGHT_HOLD = '[교전 중 — 상대: {fight_foe} · 누적 {fight_gauge}/{fight_max} · {fight_round}라운드 지남] '
  + '이 턴엔 공방이 굴려지지 않았다 — 상대는 쓰러지지 않고 결착도 나지 않는다. 대치·대화·이동·준비처럼 '
  + '유저가 쓴 구도를 그리되 전투를 끝내지 마라. 공방은 유저가 교전 버튼을 눌러야 굴려진다.';
const DEFAULT_FIGHT_IDLE_END = '[교전 종료] 공방 없이 오래 이어져 시스템이 교전을 정리했다 — 상대와의 싸움은 '
  + '흐지부지 끝난 것으로 다뤄라.';
const DEFAULT_FIGHT_LEAVE = '[교전 종료] 유저가 교전에서 이탈했다 — 상대와의 공방은 여기서 끝난다. '
  + '어떻게 빠져나갔는지는 위 판정을 따르라.';

// ── 수 유형 (v1.15.0) ─────────────────────────────────────
const MOVE_TYPES = ['attack', 'skill', 'guard', 'probe'];
const MOVE_LABEL = { attack: '공격', skill: '기술', guard: '수비', probe: '견제', free: '자유 수' };
// 부분 일치 — 활용형으로 적는다('막는'·'막아'·'막고'). 글에서 **가장 뒤에 나온** 낱말의 유형이 그 턴의 수 ("막고 반격한다" = 공격)
const DEFAULT_MOVES = {
  attack: ['공격', '벤다', '베어', '베고', '베기', '찌른', '찔러', '찌르', '때린', '때려', '내리친', '내려친', '후려', '휘두', '쏜다', '쏘아', '쏴',
    '가격', '반격', '일격', '주먹', '발길', '걷어차', '덤빈', '덤벼', '달려든', '달려들', '내지른', '내질러', '꽂'],
  skill: ['기술', '필살', '비기', '오의', '절기', '마법', '주문', '시전', '스킬', '검기', '장풍'],
  guard: ['막는', '막아', '막고', '막았', '받아낸', '받아내', '방어', '가드', '피한', '피했', '피하', '회피', '물러', '빠져나', '버틴', '버티', '튕겨',
    '흘린', '흘려', '흘리', '웅크', '방패'],
  probe: ['견제', '거리', '탐색', '살핀', '살피', '노린', '노려', '틈을', '간을', '잰다', '재며', '재면서', '흔든', '흔들어', '페인트', '속임', '유인',
    '도발', '위협', '겨눈', '겨누'],
};
const FOE_MOVES = ['attack', 'press', 'guard', 'probe'];
const FOE_LABEL = { attack: '공격', press: '밀어붙이기', guard: '수세', probe: '탐색' };
const DEFAULT_FOE_MOVES = { attack: 50, press: 10, guard: 15, probe: 25 };
const DELEGATE_MOVES = { attack: 60, probe: 20, skill: 10, guard: 10 };   // 맡김(짧은 글에 낱말 없음) — 주인공 수도 시스템이

function movesTable(cfg) {
  const t = {};
  for (const k of MOVE_TYPES) {
    const own = Array.isArray(cfg?.moves?.[k]) ? cfg.moves[k].filter((x) => typeof x === 'string' && x.trim()) : null;
    t[k] = own && own.length ? own : DEFAULT_MOVES[k];
  }
  return t;
}
/** 유저 글 → 주인공의 수 ('attack'|'skill'|'guard'|'probe') | null. 가장 뒤의 낱말이 이긴다 — 마지막 동작이 그 턴의 수다 */
function classifyMove(cfg, text) {
  const str = String(text || '');
  if (!str.trim()) return null;
  const table = movesTable(cfg);
  let best = null;
  for (const type of MOVE_TYPES) for (const kw of table[type]) {
    const i = str.lastIndexOf(kw);
    if (i >= 0 && (!best || i > best.i)) best = { type, i };
  }
  return best ? best.type : null;
}
/** 가중 추첨 — { 키: 가중치 }에서 하나. 전부 0이면 첫 키 */
function pickWeighted(weights, rng) {
  const keys = Object.keys(weights);
  const total = keys.reduce((a, k) => a + Math.max(0, Number(weights[k]) || 0), 0);
  if (!(total > 0)) return keys[0];
  let r = rng() * total;
  for (const k of keys) { r -= Math.max(0, Number(weights[k]) || 0); if (r < 0) return k; }
  return keys[keys.length - 1];
}
/**
 * 상대의 수 — 기본 비율(cfg.foeMoves로 대체 가능)에 판세를 얹는다.
 * ctx: { round, ratio(누적/최대), myMove, skillFailed, bigHit }
 */
function pickFoeMove(cfg, ctx, rng) {
  const w = {};
  for (const k of FOE_MOVES) w[k] = Math.max(0, Number(cfg?.foeMoves?.[k] ?? DEFAULT_FOE_MOVES[k]) || 0);
  const add = (k, n) => { w[k] = Math.max(0, w[k] + n); };
  if (ctx.round === 1) add('probe', 15);                                   // 첫 라운드는 서로 잰다
  if (ctx.ratio >= 0.7) { add('guard', 15); add('press', 10); add('probe', -15); } // 몰리면 수세 아니면 필사
  if (ctx.myMove === 'guard') { add('attack', 20); add('probe', -10); }     // 주인공이 자세를 잡으면 들어온다
  if (ctx.myMove === 'probe') { add('probe', 15); add('attack', -10); }     // 견제엔 견제
  if (ctx.skillFailed) { add('attack', 25); add('press', 10); }             // 빗나간 기술 = 빈틈
  if (ctx.bigHit) { add('guard', 15); add('attack', -10); }                 // 크게 맞으면 물러선다
  return pickWeighted(w, rng);
}
/** 이점·불리의 크기 — 굴림 폭의 15% (d20 → 3, d6 → 1, d100 → 15). rand()가 없으면 1 */
function advantageOf(check) {
  const m = /rand\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/.exec(String(check?.roll || ''));
  if (!m) return 1;
  return Math.max(1, Math.round((Math.abs(Number(m[2]) - Number(m[1])) + 1) * 0.15));
}
/** 판정 사본에 보정을 얹는다 — rollCheck는 mod 식을 그대로 평가한다 */
function withMod(check, delta) {
  if (!delta) return check;
  const has = check.mod != null && String(check.mod).trim() !== '';
  return { ...check, mod: has ? `(${check.mod}) + (${delta})` : String(delta) };
}

function fightChecks(schema) {
  return (schema?.checks || []).filter((c) => c && c.fight && typeof c.fight === 'object' && !Array.isArray(c.fight));
}
function fightActive(vars) { return Number(vars?.[FIGHT_KEYS.max]) > 0; }

function clearFight(state) {
  const v = state.vars;
  v[FIGHT_KEYS.max] = 0; v[FIGHT_KEYS.gauge] = 0; v[FIGHT_KEYS.round] = 0;
  v[FIGHT_KEYS.foe] = ''; v[FIGHT_KEYS.idle] = 0; v[FIGHT_KEYS.check] = '';
  v[FIGHT_KEYS.edge] = 0; v[FIGHT_KEYS.guard] = 0;
}
// 구세이브·중간에 켠 스키마 — 교전 없음으로 채운다 (reconcileState 규약)
function ensureFightKeys(state) {
  const v = state.vars;
  for (const k of [FIGHT_KEYS.max, FIGHT_KEYS.gauge, FIGHT_KEYS.round, FIGHT_KEYS.idle, FIGHT_KEYS.edge, FIGHT_KEYS.guard]) if (typeof v[k] !== 'number') v[k] = 0;
  for (const k of [FIGHT_KEYS.foe, FIGHT_KEYS.check]) if (typeof v[k] !== 'string') v[k] = '';
}

/** 검증 — validate.js가 판정 루프 안에서 부른다 (checkExpr/checkSet은 그쪽 것을 빌려 쓴다) */
function checkFightConfig(c, p, { err, warn, checkExpr, checkSet, checkIds, allIds, fightIds }) {
  const f = c.fight;
  const fp = `${p}.fight`;
  if (typeof f !== 'object' || f === null || Array.isArray(f)) {
    err(fp, 'fight는 객체 { gauge, reply?, foe?, flavor?, win?, lose?, idleTurns?, rule?, hold? }');
    return;
  }
  if (f.gauge == null) err(`${fp}.gauge`, '게이지 크기(gauge) 필요 — 숫자 또는 식 (예: "30 + opp_n * 25")');
  else if (typeof f.gauge === 'number') { if (!(f.gauge >= 1)) err(`${fp}.gauge`, 'gauge는 1 이상'); }
  else checkExpr(String(f.gauge), `${fp}.gauge`, allIds, err, { allowRand: false });
  if (f.reply != null) {
    if (typeof f.reply !== 'string' || !checkIds.has(f.reply)) err(`${fp}.reply`, `반격 판정 '${f.reply}'가 checks에 없음`);
    else if (f.reply === c.id) err(`${fp}.reply`, '반격 판정이 자기 자신 — 회피 같은 다른 판정을 가리켜야 함');
    else if (fightIds.has(f.reply)) err(`${fp}.reply`, `반격 판정 '${f.reply}'에도 fight가 달려 있음 — 반격은 평판정이어야 함`);
  } else {
    warn(`${fp}.reply`, '반격 판정(reply)이 없습니다 — 상대가 되받아치는 비트가 안 생겨 주인공만 때리는 전투가 됩니다');
  }
  if (f.foe != null && typeof f.foe !== 'string') err(`${fp}.foe`, 'foe는 문자열 템플릿 ({변수} 가능)');
  if (f.flavor != null && (!Array.isArray(f.flavor) || !f.flavor.length
      || f.flavor.some((s) => typeof s !== 'string' || !s.trim())))
    err(`${fp}.flavor`, 'flavor는 비어있지 않은 문자열 배열 (맡김 모드의 개시 비트 후보)');
  if (f.idleTurns != null && (!Number.isInteger(f.idleTurns) || f.idleTurns < 1)) err(`${fp}.idleTurns`, 'idleTurns는 1 이상의 정수');
  for (const k of ['rule', 'hold']) if (f[k] != null && typeof f[k] !== 'string') err(`${fp}.${k}`, `${k}는 문자열`);
  // 수 유형 (v1.15.0)
  if (f.moves != null) {
    if (typeof f.moves !== 'object' || Array.isArray(f.moves)) err(`${fp}.moves`, 'moves는 { attack, skill, guard, probe: [낱말…] } — 비우면 기본 낱말표');
    else for (const [k, arr] of Object.entries(f.moves)) {
      if (!MOVE_TYPES.includes(k)) err(`${fp}.moves.${k}`, `모르는 수 유형 '${k}' — attack(공격)/skill(기술)/guard(수비)/probe(견제)`);
      else if (!Array.isArray(arr) || arr.some((x) => typeof x !== 'string' || !x.trim())) err(`${fp}.moves.${k}`, '낱말은 비어 있지 않은 문자열 배열');
    }
  }
  if (f.foeMoves != null) {
    if (typeof f.foeMoves !== 'object' || Array.isArray(f.foeMoves)) err(`${fp}.foeMoves`, 'foeMoves는 { attack, press, guard, probe: 가중치(0 이상 숫자) }');
    else for (const [k, n] of Object.entries(f.foeMoves)) {
      if (!FOE_MOVES.includes(k)) err(`${fp}.foeMoves.${k}`, `모르는 상대 수 '${k}' — attack(공격)/press(밀어붙이기)/guard(수세)/probe(탐색)`);
      else if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) err(`${fp}.foeMoves.${k}`, '가중치는 0 이상 숫자');
    }
  }
  if (f.win != null) {
    if (typeof f.win !== 'object' || f.win === null || Array.isArray(f.win)) err(`${fp}.win`, 'win은 { effects?, inject? }');
    else {
      (f.win.effects || []).forEach((r, j) => checkSet(r, `${fp}.win.effects[${j}]`));
      if (f.win.inject != null && typeof f.win.inject !== 'string') err(`${fp}.win.inject`, 'inject는 문자열');
    }
  }
  if (f.lose != null) {
    if (typeof f.lose !== 'object' || f.lose === null || Array.isArray(f.lose) || typeof f.lose.when !== 'string')
      err(`${fp}.lose`, 'lose는 { when, inject? } — when은 조건식 (예: "hp <= 0")');
    else {
      checkExpr(f.lose.when, `${fp}.lose.when`, allIds, err, { allowRand: false });
      if (f.lose.inject != null && typeof f.lose.inject !== 'string') err(`${fp}.lose.inject`, 'inject는 문자열');
    }
  }
  const grades = Array.isArray(c.grades) ? c.grades : [];
  grades.forEach((g, gi) => {
    if (g.gain != null && (typeof g.gain !== 'number' || g.gain < 0))
      err(`${p}.grades[${gi}].gain`, 'gain은 0 이상의 숫자 (이 등급이 상대 게이지에 쌓는 유효량)');
  });
  if (!grades.some((g) => Number(g.gain) > 0))
    err(fp, '등급 중 gain > 0이 하나도 없음 — 게이지가 영영 안 차 결착이 나지 않는다');
}

/** 상태창 칩 — 교전 중일 때만. 그룹 모드는 머리에 붙고, 템플릿 모드는 {fight} 자리에 나온다 */
function fightChipHtml(vars, esc) {
  if (!fightActive(vars)) return '';
  const max = Number(vars[FIGHT_KEYS.max]) || 0;
  const g = Math.max(0, Math.min(max, Number(vars[FIGHT_KEYS.gauge]) || 0));
  const pct = max > 0 ? (g / max) * 100 : 0;
  return `<div class="sim-card sim-fight">⚔ <b>${esc(String(vars[FIGHT_KEYS.foe] || '상대'))}</b> `
    + `<span class="sim-bar"><span class="sim-bar-fill" style="width:${pct.toFixed(1)}%"></span></span> `
    + `${g}/${max} · ${Number(vars[FIGHT_KEYS.round]) || 0}R</div>`;
}

module.exports = {
  FIGHT_KEYS, FIGHT_RESERVED, FIGHT_SHORT_INPUT, FIGHT_IDLE_DEFAULT,
  DEFAULT_FIGHT_FLAVOR, DEFAULT_FIGHT_RULE, DEFAULT_FIGHT_ROUND_END, DEFAULT_FIGHT_WIN, DEFAULT_FIGHT_LOSE,
  DEFAULT_FIGHT_HOLD, DEFAULT_FIGHT_IDLE_END, DEFAULT_FIGHT_LEAVE,
  fightChecks, fightActive, clearFight, ensureFightKeys, checkFightConfig, fightChipHtml,
  MOVE_TYPES, MOVE_LABEL, DEFAULT_MOVES, FOE_MOVES, FOE_LABEL, DEFAULT_FOE_MOVES, DELEGATE_MOVES,
  classifyMove, pickWeighted, pickFoeMove, advantageOf, withMod,
};
