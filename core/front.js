// 무대 뒤 (schema.fronts) — 유저가 안 봐도 세상은 움직인다 (설계: docs/design-조퇴악녀.md §15, v1.12.0)
//
// 이야기는 유저만 움직인다고 되는 게 아니다. 신전의 암투·뒷골목의 거래·광산의 한계는 유저가 모르는 사이에도
// 흘러가다가 어느 순간 표면으로 터진다. 지금까지는 이걸 변수+onTurn+이벤트+비밀로 손조립해야 했고, 두 군데로 샜다 —
// 패널 현황 탭이 스키마 변수를 전부 보여 주고(시계가 보인다), 이벤트·선택지가 시계를 건드리면 변화 로그에 찍힌다.
//
// 진영 하나 = 숨은 시계 하나 + 문턱의 사다리.
//   fronts: [{ id, about, label, when, rate, max, init, stages: [{ at, hint, backstage, surface, effects }] }]
//   - 시계는 **작중 시간**으로 흐른다 — 시간 체계가 있으면 하루당 rate(turn_min 기준: 대화만 한 턴은 0, "한 달 뒤"는
//     한 달치), 없으면 턴당 rate. when이 거짓인 동안은 멈춘다. 보조 AI는 못 만진다(예약 키 — allow에 못 올린다).
//   - 유저의 개입은 효과 `{ front: id, add: 식 }` — 줄기의 선택지가 시계를 늦추거나 되돌린다. 시계는 0~max로 잘린다.
//   - 문턱(at)을 넘으면 그 단계가 열린다(한 번 열리면 안 닫힌다 — 비밀과 같은 규약). 단계의 세 겹:
//       hint      징후 — 모델에게 **이유 없이** 매 턴 깔린다("신전 구호소가 자주 닫힌다"). 다음 표면화가 오면 걷힌다.
//       backstage 밑작업 — 무대 뒤에서 벌어진 일. **표면화가 올 때까지 프롬프트 어디에도 없다.** 표면화되는 순간
//                 그 단계까지의 밑작업이 한꺼번에 열려 모델이 앞뒤를 맞춰 쓴다.
//       surface   표면화 — 사건이 터진다. 다음 전송에 통지 한 줄(이벤트와 같은 길).
//       effects   결과 — 세계에 남는 흔적(다른 줄기가 양념으로 읽는 플래그). 문턱을 넘는 턴에 한 번.
//
// 예약 키 (vars에 산다 — scn_idx·sec_*와 같은 계열. 패널 현황 탭은 스키마 vars만 그리므로 안 보이고, 체크포인트
// 되감기가 같이 되감는다 — 회귀하면 세상의 음모도 그 아침으로 돌아간다):
//   fr_<id>   시계 값 (0~max, 실수)      frs_<id>  열린 최고 단계 (−1 = 아직)
// 원장(changeLog) 출처는 `front:<id>` — 변화 로그·하이라이트 카드는 허용 목록이라 안 그리고, 보조 원장에서도 뺀다.

const { evaluate, truthy } = require('./expr');

const FR_PREFIX = 'fr_';
const FRS_PREFIX = 'frs_';
const frKey = (id) => FR_PREFIX + id;
const frsKey = (id) => FRS_PREFIX + id;
const DEFAULT_MAX = 100;
const SOURCE_PREFIX = 'front:';

const str = (x) => (typeof x === 'string' ? x : '');

/** 정규화된 진영 목록 — 없거나 비면 null ("없음 = 꺼짐"). 검증은 validate 몫, 여기는 방어 정규화만 */
function frontsConfig(schema) {
  const arr = Array.isArray(schema?.fronts) ? schema.fronts.filter((f) => f && typeof f === 'object') : [];
  if (!arr.length) return null;
  return arr.map((f, i) => {
    const max = Number.isFinite(Number(f.max)) && Number(f.max) > 0 ? Number(f.max) : DEFAULT_MAX;
    const init = Number.isFinite(Number(f.init)) ? Math.max(0, Math.min(max, Number(f.init))) : 0;
    return {
      id: typeof f.id === 'string' && f.id ? f.id : `front${i + 1}`,
      about: str(f.about).trim(),
      label: str(f.label).trim(),
      when: typeof f.when === 'string' && f.when.trim() ? f.when : '',
      rate: typeof f.rate === 'number' || (typeof f.rate === 'string' && f.rate.trim()) ? f.rate : 0,
      max, init,
      stages: (Array.isArray(f.stages) ? f.stages : []).filter((s) => s && typeof s === 'object').map((s) => ({
        at: Number(s.at),
        hint: str(s.hint).trim(),
        backstage: str(s.backstage).trim(),
        surface: str(s.surface).trim(),
        effects: Array.isArray(s.effects) ? s.effects : [],
      })),
    };
  });
}

/** 예약 이름들 — 검증이 조건식 이름표에 등록하고 변수 id 충돌을 막는다 */
function frontExposedNames(schema) {
  const cfg = frontsConfig(schema);
  return cfg ? cfg.flatMap((f) => [frKey(f.id), frsKey(f.id)]) : [];
}

/** 진행 중 세이브에 나중에 켜도 안전하게 — 없는 키만 시작값으로 */
function ensureFrontKeys(schema, vars) {
  const cfg = frontsConfig(schema);
  if (!cfg) return;
  for (const f of cfg) {
    if (typeof vars[frKey(f.id)] !== 'number') vars[frKey(f.id)] = f.init;
    if (typeof vars[frsKey(f.id)] !== 'number') vars[frsKey(f.id)] = -1;
  }
}

const isFrontEffect = (rule) => !!rule && typeof rule === 'object' && rule.front !== undefined;

function clampVal(f, v) { return Math.max(0, Math.min(f.max, v)); }
// 부동소수 찌꺼기(0.1+0.2) 정리 — 문턱 비교가 30.000000000000004 때문에 어긋나지 않게
const tidy = (v) => Math.round(v * 1e6) / 1e6;

/**
 * 효과 `{ front, add }` — applySets가 부른다. 반환: 원장 항목 또는 null.
 * 문턱 판정은 여기서 안 한다 (단계는 응답 단계 advanceFronts 한 곳에서만 열린다 — 전송 단계 개입도 같은 턴 끝에 반영).
 */
function applyFrontEffect(schema, vars, rule, lookup, rng, source) {
  const f = (frontsConfig(schema) || []).find((x) => x.id === rule.front);
  if (!f) return null;
  let d;
  try { d = Number(evaluate(String(rule.add ?? 0), lookup, rng)); } catch { return null; }
  if (!Number.isFinite(d) || d === 0) return null;
  const k = frKey(f.id);
  const from = Number(vars[k]) || 0;
  const to = tidy(clampVal(f, from + d));
  if (to === from) return null;
  vars[k] = to;
  return { id: k, from, to, source: `${SOURCE_PREFIX}${f.id}:${source || 'effect'}` };
}

/**
 * 한 턴의 무대 뒤 — 시계를 흘리고 넘은 문턱을 연다. 엔진 응답 단계 8.55가 부른다.
 * @param elapsedDays 이번 정산에서 흐른 작중 일수 (시간 체계 없으면 null → 턴당 1)
 * @returns {Array<{ front, from, to, stages: [{ index, stage }], tick }>}
 */
function advanceFronts(schema, vars, lookup, elapsedDays) {
  const cfg = frontsConfig(schema);
  if (!cfg) return [];
  const out = [];
  for (const f of cfg) {
    const k = frKey(f.id), ks = frsKey(f.id);
    const before = Number(vars[k]) || 0;
    // 1. 흘리기 — when이 거짓이면 멈춤, 깨진 식은 멈춤 (검증이 미리 잡는다 — 여기서 던지면 턴이 죽는다)
    let flowing = true;
    if (f.when) { try { flowing = truthy(evaluate(f.when, lookup, null)); } catch { flowing = false; } }
    let tick = 0;
    if (flowing) {
      let rate = 0;
      try { rate = Number(typeof f.rate === 'number' ? f.rate : evaluate(f.rate, lookup, null)); } catch { rate = 0; }
      const span = elapsedDays == null ? 1 : Number(elapsedDays) || 0;
      if (Number.isFinite(rate) && rate !== 0 && span > 0) {
        const to = tidy(clampVal(f, before + rate * span));
        tick = to - before;
        vars[k] = to;
      }
    }
    // 2. 문턱 — 지금 값 이하의 단계 중 아직 안 열린 것 전부, 낮은 순서대로 (한 달을 건너뛰면 여러 단계가 한 턴에 열린다)
    const cur = Number(vars[k]) || 0;
    let opened = Number.isInteger(vars[ks]) ? vars[ks] : -1;
    const stages = [];
    for (let i = opened + 1; i < f.stages.length; i++) {
      if (!(cur >= f.stages[i].at)) break;
      stages.push({ index: i, stage: f.stages[i] });
      opened = i;
    }
    if (stages.length) vars[ks] = opened;
    if (tick !== 0 || stages.length) out.push({ front: f, from: before, to: cur, stages, tick });
  }
  return out;
}

/** 마지막으로 표면화된 단계 번호 (−1 = 아직) */
function lastSurfaced(f, openedIdx) {
  let s = -1;
  for (let i = 0; i <= openedIdx && i < f.stages.length; i++) if (f.stages[i].surface) s = i;
  return s;
}

/**
 * 메인 프롬프트 블록 — **징후(이유 없이) + 표면화된 단계까지의 밑작업만.** 표면화 전의 밑작업은 여기 없다.
 * 이 함수가 은닉 보장의 실체다 (test-front.js가 grep으로 증명). 아무것도 열리지 않았으면 '' — 블록 자체가 신호다.
 * @param render {변수} 치환기 (엔진이 renderTemplate을 물려 준다)
 */
function frontInjectionText(schema, vars, render = (s) => s) {
  const cfg = frontsConfig(schema);
  if (!cfg) return '';
  const hints = [];
  const revealed = [];
  for (const f of cfg) {
    const opened = Number.isInteger(vars?.[frsKey(f.id)]) ? vars[frsKey(f.id)] : -1;
    if (opened < 0) continue;
    const surf = lastSurfaced(f, opened);
    // 징후: 가장 최근에 열린 징후 하나 — 단, 그 뒤로 표면화가 왔으면 걷는다 (터진 일의 징후는 더는 징후가 아니다)
    for (let i = opened; i > surf; i--) {
      if (f.stages[i].hint) { hints.push({ f, text: f.stages[i].hint }); break; }
    }
    if (surf >= 0) {
      const texts = f.stages.slice(0, surf + 1).map((s) => s.backstage).filter(Boolean);
      if (texts.length) revealed.push({ f, texts });
    }
  }
  if (!hints.length && !revealed.length) return '';
  const lines = ['[무대 뒤 — 세상은 유저와 상관없이 움직인다]'];
  if (hints.length) {
    lines.push('징후 — 세상에서 벌어지고 있는 일의 겉모습이다. 이유는 너도 모른다: 이유를 지어내거나 설명하지 말고, '
      + '거리의 분위기·인물의 행동·소문으로 장면 배경에 스치듯 흘려라. 매번 언급할 필요는 없다.');
    for (const { f, text } of hints) lines.push(`- ${f.about ? `${f.about}: ` : ''}${render(text)}`);
  }
  if (revealed.length) {
    lines.push('드러난 일 — 무대 뒤에서 벌어졌고 이제 표면에 나온 일이다. 세상 사람들은 이를 알거나 알아 가는 중이며, '
      + '앞으로의 장면은 이 사실과 어긋나지 않아야 한다.');
    for (const { f, texts } of revealed) {
      lines.push(`- ${f.about || f.label || f.id}:`);
      for (const t of texts) lines.push(`  · ${render(t)}`);
    }
  }
  return lines.join('\n');
}

/** 방치하면 각 단계가 언제 열리나 — 속도가 숫자일 때만 (식이면 null). 편집기 요약이 쓴다 */
function idleSchedule(f) {
  if (typeof f.rate !== 'number' || !(f.rate > 0)) return null;
  return f.stages.map((s) => (Number.isFinite(s.at) ? Math.max(0, Math.ceil((s.at - f.init) / f.rate)) : null));
}

module.exports = {
  FR_PREFIX, FRS_PREFIX, SOURCE_PREFIX, DEFAULT_MAX,
  frKey, frsKey, frontsConfig, frontExposedNames, ensureFrontKeys, isFrontEffect, applyFrontEffect,
  advanceFronts, lastSurfaced, frontInjectionText, idleSchedule,
};
