// 시나리오레이터 — 이야기의 척추 (설계: docs/design-시나리오레이터.md)
//
// 원칙: 막 전환은 **조건식이** 정한다 — 버튼도, 모델의 눈치도 아니다. 모델은 전체
// 시나리오를 영영 못 본다: 현재 막의 연출 지시(direct)와 이미 열린 막들의 내막(secret)만
// 받는다. 분량 조절 문제가 구조적으로 사라진다 — 모델이 조절할 게 없으니까
// (루아 "자율주행"이 실패한 지점 — 기승전결 통짜 주입은 세 턴 만에 끝났다).
//
// 이벤트와의 분업: 이벤트 = 세상의 리듬(반복·랜덤·조건), 시나리오 = 이야기의 척추(선형·1회).
// 막 해금 조건이 이벤트·판정이 세운 변수를 읽으므로 둘은 자연히 맞물린다.
//
// 내부 상태는 vars의 예약 키 두 칸 (time_epoch과 같은 계열 — 엔진이 관리, 스키마 vars 아님):
//   scn_idx(현재 막 번호) · scn_turns(현재 막에서 보낸 턴). 조건식·상태창에는
//   scn_act(막 id)·scn_label(막 라벨)·scn_turns가 노출된다 — 진행 표시는 라벨만, 스포일러 없이.
//
// 추리 게임은 비목표다 (설계 §5 — S2D.추리가 이미 그 자리의 성숙한 정답).
// 이 모듈은 심코어가 굴리는 봇들(영지·아이돌·연애·무협)에 이야기 페이스를 꽂는다.

const { evaluate, truthy } = require('./expr');

const SCN_IDX = 'scn_idx';
const SCN_TURNS = 'scn_turns';
// 조건식·자리표시자에서 쓸 수 있는 노출 이름. scn_turns는 vars에 직접 살아 lookup의
// `name in vars`에서 잡히고, scn_act/scn_label은 makeLookup이 이 모듈에 물어 계산한다.
const SCN_EXPOSED = ['scn_act', 'scn_label', 'scn_turns'];

// 국면별 기본 연출 문구 — 루아 "중심 사건 생성기 v1.3"의 [연출 지시]에서 출발.
// 양면 어법(금지 + "이건 사고를 잠그는 규칙이 아니다")은 S2D FACT LOCK에서 이식했다 (설계 §5):
// 잠복 막의 "옅게만"이 이야기 전체를 위축시키는 부작용을 뒷문장이 막는다.
const INTENSITIES = {
  잠복: '중심 사건은 아직 수면 아래에 있다. 이 응답에서는 그 실마리를 아주 옅게만 깔아라 — 전면에 내세우지 말 것. '
    + '단, 이것은 이야기를 멈추라는 뜻이 아니다. 현재 장면·일상·관계는 자유롭고 적극적으로 진행하라.',
  전개: '중심 사건이 모습을 드러내기 시작한다. 단서와 조짐을 장면에 실어 나르되, 전모는 아직 감춰라. '
    + '인물들이 각자의 해석과 의심을 말하는 것은 자유다.',
  고조: '긴장을 눈에 띄게 끌어올려라. 중심 사건이 인물들의 선택을 압박하기 시작하고, 되돌리기 어려워진다는 감각을 깔아라.',
  절정: '중심 사건이 전면에 나선다. 더 이상 미루거나 피할 수 없다 — 장면의 중심에 사건을 세우고 정면으로 다뤄라.',
  해소: '사건의 여파를 갈무리하라. 새 갈등을 열지 말고, 인물과 세계에 남은 흔적·변화·감정을 정리하는 데 집중하라.',
};

/**
 * 스키마의 scenario 절 정규화. 없거나 형태가 아니면 null — "없음 = 꺼짐" 불변식.
 * 검증은 validate 몫이고, 여기는 깨진 값에도 안 죽는 방어 정규화만 한다.
 */
function scenarioConfig(schema) {
  const s = schema?.scenario;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const rawActs = Array.isArray(s.acts) ? s.acts : [];
  const acts = [];
  for (let i = 0; i < rawActs.length; i++) {
    const a = rawActs[i];
    if (!a || typeof a !== 'object') continue;
    acts.push({
      id: typeof a.id === 'string' && a.id ? a.id : `act${i + 1}`,
      label: typeof a.label === 'string' ? a.label : '',
      unlock: typeof a.unlock === 'string' && a.unlock.trim() ? a.unlock : null,
      minTurns: Number.isFinite(Number(a.minTurns)) ? Math.max(0, Math.floor(Number(a.minTurns))) : 0,
      direct: typeof a.direct === 'string' ? a.direct : '',
      secret: typeof a.secret === 'string' ? a.secret : '',
      intensity: typeof a.intensity === 'string' && INTENSITIES[a.intensity] ? a.intensity : null,
      onEnter: Array.isArray(a.onEnter) ? a.onEnter : [],
      notify: typeof a.notify === 'string' ? a.notify : '',
    });
  }
  if (!acts.length) return null;
  return { label: typeof s.label === 'string' ? s.label : '', acts };
}

/** 현재 막 번호 — 세이브가 옛 스키마(막이 줄어든)를 만나도 안 죽게 잘라 낸다 */
function currentActIndex(cfg, vars) {
  const raw = Number(vars?.[SCN_IDX]);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(cfg.acts.length - 1, Math.floor(raw)));
}

/** makeLookup 위임 — scn_act(막 id)·scn_label(라벨). 그 외 이름은 undefined(관여 안 함) */
function scenarioExposedVal(schema, vars, name) {
  if (name !== 'scn_act' && name !== 'scn_label') return undefined;
  const cfg = scenarioConfig(schema);
  if (!cfg) return undefined;
  const act = cfg.acts[currentActIndex(cfg, vars)];
  return name === 'scn_act' ? act.id : (act.label || act.id);
}

/**
 * 막 전환 판정 — 순수 결정만. 적용(effects·notify·카운터 리셋)은 엔진 outputPhase 몫.
 * 다음 막 하나만 본다: 조건이 여러 막을 한 번에 넘겨도 **턴당 한 막** — 페이스는 막 단위로 걷는다.
 * minTurns는 unlock과 같은 항목에 산다 — "이 막으로 들어오려면 직전 막에서 최소 N턴".
 * 조건이 먼저 차도 바닥을 깔아 주는 페이스 손잡이다 (설계 §2).
 */
function scenarioTransition(schema, vars, lookup) {
  const cfg = scenarioConfig(schema);
  if (!cfg) return null;
  const idx = currentActIndex(cfg, vars);
  const next = cfg.acts[idx + 1];
  if (!next) return null;                       // 마지막 막 — 유지 (해소 상태)
  if (!next.unlock) return null;                // 해금식 없는 중간 막 — 검증이 잡지만 실행은 방어
  const stayed = Number(vars?.[SCN_TURNS]) || 0;
  if (stayed < next.minTurns) return null;      // 페이스 바닥 — 조건보다 먼저 본다 (평가 비용도 아낌)
  try {
    if (!truthy(evaluate(next.unlock, lookup, null))) return null;
  } catch { return null; }                      // 깨진 식 — 검증이 미리 잡는다. 여기서 던지면 턴이 죽는다
  return { toIndex: idx + 1, act: next };
}

/**
 * 메인 프롬프트 주입 블록 — **현재 막의 지시 + 열린 막들의 secret만.**
 * 전체 시나리오는 여기 없다. 이 함수가 은닉 보장의 실체다 (설계 §3-1).
 * @param render direct·secret 속 {변수} 치환기 — 엔진이 renderTemplate을 물려 준다.
 *   기본은 원문 그대로 (테스트·미리보기용).
 */
function scenarioInjectionText(schema, vars, render = (s) => s) {
  const cfg = scenarioConfig(schema);
  if (!cfg) return '';
  const idx = currentActIndex(cfg, vars);
  const act = cfg.acts[idx];
  const lines = [];
  const head = [cfg.label, act.label || act.id].filter(Boolean).join(' · ');
  lines.push(`[이야기 지침] ${head} (${idx + 1}/${cfg.acts.length}막)`);
  if (act.intensity) lines.push(INTENSITIES[act.intensity]);
  if (act.direct) lines.push(render(act.direct));
  // 내막 — 열린 막까지 누적 공개. 밝혀진 진실은 잊히지 않는다 (설계 §2 secret).
  // 하나도 안 열렸으면 절 자체를 안 만든다 — "미공개 내막이 있다"는 신호도 스포일러다.
  const secrets = cfg.acts.slice(0, idx + 1).map((a) => a.secret).filter(Boolean);
  if (secrets.length) {
    // "미공개 = 거짓이 아니라 아직" 어법 — S2D PUBLIC STATE 계약에서 이식 (설계 §5).
    // 모델이 빈칸을 창작으로 메우거나, 반대로 아는 척 결말을 당겨 오는 것을 양쪽에서 막는다.
    lines.push('[밝혀진 내막] 아래는 이야기 안에서 이미 성립한 진실이다. 여기 없는 내막은 거짓이 아니라 아직 밝혀지지 않은 것이다 — 빈칸을 창작으로 메우지 말고, 아직 밝혀지지 않은 결말을 안다고 서술하지 마라.');
    for (const sec of secrets) lines.push(`- ${render(sec)}`);
  }
  return lines.join('\n');
}

module.exports = {
  SCN_IDX, SCN_TURNS, SCN_EXPOSED, INTENSITIES,
  scenarioConfig, currentActIndex, scenarioExposedVal, scenarioTransition, scenarioInjectionText,
};
