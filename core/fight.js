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
//   ⚔ + 짧은 입력("대충 싸웠다")  → 개시 비트까지 시스템이 씀 (맡김)
//   ⚔ + 긴 입력                  → 유저 수는 그대로, 얼마나 먹혔는지(등급)만 굴림
//   ⚔ 없음                       → 자유 장면. 게이지 불변 + "쓰러뜨리지 마라" 상시 줄
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
const DEFAULT_FIGHT_RULE = '시스템이 굴린 결과다. 순서대로, 비트마다 한 문단 이상 — 결과를 바꾸거나 비트를 건너뛰거나 '
  + '합치지 마라. 번호·기호·표는 본문에 쓰지 마라. 기술·무기는 실명으로 써라.';
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

function fightChecks(schema) {
  return (schema?.checks || []).filter((c) => c && c.fight && typeof c.fight === 'object' && !Array.isArray(c.fight));
}
function fightActive(vars) { return Number(vars?.[FIGHT_KEYS.max]) > 0; }

function clearFight(state) {
  const v = state.vars;
  v[FIGHT_KEYS.max] = 0; v[FIGHT_KEYS.gauge] = 0; v[FIGHT_KEYS.round] = 0;
  v[FIGHT_KEYS.foe] = ''; v[FIGHT_KEYS.idle] = 0; v[FIGHT_KEYS.check] = '';
}
// 구세이브·중간에 켠 스키마 — 교전 없음으로 채운다 (reconcileState 규약)
function ensureFightKeys(state) {
  const v = state.vars;
  for (const k of [FIGHT_KEYS.max, FIGHT_KEYS.gauge, FIGHT_KEYS.round, FIGHT_KEYS.idle]) if (typeof v[k] !== 'number') v[k] = 0;
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
};
