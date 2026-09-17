// 비밀 (schema.secrets) — 모르는 건 말할 수 없다 (설계: docs/design-비밀.md)
//
// 왜 LLM은 비밀을 못 지키나: 프롬프트에 있는 건 전부 "아는 것"이고, "말하지 마라"는 그 정보
// 옆에 붙은 또 하나의 텍스트일 뿐이다. 확률을 낮출 뿐 100턴이면 한 번은 샌다.
// 확실한 방법은 하나 — **프롬프트에 없으면 못 샌다.** 시나리오레이터의 secret(막이 열려야
// 실린다)이 이미 그 원칙인데, 막에 묶여 있고 켜짐/꺼짐 둘뿐이었다. 이 모듈은 그 원칙을
// 막 없이·단계별로 일반화한다.
//
// 비밀 하나 = 단계(tiers)의 사다리. 각 단계는 조건(when)이 참이 되는 순간 열리고, 열린 단계까지의
// text만 프롬프트에 실린다. 안 열린 단계는 프롬프트 어디에도 없다 — 이 파일의 secretInjectionText가
// 은닉 보장의 실체다. 한 번 열린 단계는 되돌아가지 않는다 (조건이 다시 거짓이 돼도) — 밝혀진
// 진실은 잊히지 않는다.
//
// 두 가지 발명:
//  ① 복선은 **이유 없는 행동**으로 — 0단계에 "왕가 문장을 보면 움찔한다"만 주고 왜는 안 준다.
//     배우는 극본 결말을 몰라도 "뭔가 숨기는 사람"을 연기할 수 있다.
//  ② 존재는 알리되 내용은 안 준다(tell:'exists') — "X에 관한 말 못 할 사정이 있다. 너도 내용은
//     모른다. 캐물으면 회피하고, 지어내지 마라." 없으면 모델이 빈칸을 아무 설정으로 메운다.
//     반전(kind:'plot')은 반대로 존재 신호 자체가 스포일러라 기본이 tell:'none'이다.
//
// 종류(kind)는 기계가 아니라 **어법과 기본값**만 가른다: 세계(world)/인물(person)/반전(plot).
// 내부 상태는 vars의 예약 키 `sec_<id>` = 열린 최고 단계 번호(-1 = 아직) — scn_idx와 같은 계열
// (엔진이 관리, 스키마 vars 아님, allow에 못 올림 = 보조가 못 만짐). 조건식·상태창에서 읽을 수 있다.
//
// 보조 모델은 비밀 내용을 볼 필요가 없다 — 변수만 세우면 된다. 그래서 보조 프롬프트엔 아무것도 안 간다.

const { evaluate, truthy } = require('./expr');

const KINDS = ['world', 'person', 'plot'];
const TELLS = ['exists', 'none'];
const SEC_PREFIX = 'sec_';

const secKey = (id) => SEC_PREFIX + id;

// 종류별 기본 존재 알림 — 인물·세계는 알려야 연기가 되고, 반전은 알리면 죽는다
function defaultTell(kind) { return kind === 'plot' ? 'none' : 'exists'; }

/**
 * 정규화된 비밀 목록 — 없거나 비면 null ("없음 = 꺼짐").
 * 단계 0의 when이 비면 'true'(처음부터 열림 = 복선). 나머지 단계는 검증이 when을 요구한다.
 */
function secretsConfig(schema) {
  const arr = Array.isArray(schema?.secrets) ? schema.secrets.filter((s) => s && typeof s === 'object') : [];
  if (!arr.length) return null;
  return arr.map((s, i) => {
    const kind = KINDS.includes(s.kind) ? s.kind : 'person';
    const tiers = (Array.isArray(s.tiers) ? s.tiers : []).filter((t) => t && typeof t === 'object')
      .map((t, j) => ({
        when: typeof t.when === 'string' && t.when.trim() ? t.when : (j === 0 ? 'true' : ''),
        text: typeof t.text === 'string' ? t.text : '',
        notify: typeof t.notify === 'string' && t.notify.trim() ? t.notify : '',
      }));
    return {
      id: typeof s.id === 'string' && s.id ? s.id : `secret${i + 1}`,
      kind,
      about: typeof s.about === 'string' ? s.about.trim() : '',
      label: typeof s.label === 'string' ? s.label.trim() : '',
      tell: TELLS.includes(s.tell) ? s.tell : defaultTell(kind),
      tiers,
    };
  });
}

/** 예약 키 이름들 — 검증이 조건식 이름표에 등록하고, 변수 id 충돌을 막는다 */
function secretExposedNames(schema) {
  const cfg = secretsConfig(schema);
  return cfg ? cfg.map((s) => secKey(s.id)) : [];
}

/** 열린 최고 단계 번호 (-1 = 아직 하나도) */
function openedTier(secret, vars) {
  const v = Number(vars?.[secKey(secret.id)]);
  return Number.isInteger(v) ? Math.max(-1, Math.min(v, secret.tiers.length - 1)) : -1;
}

/**
 * 시작 단계 — 앞에서부터 when이 문자 그대로 'true'인 단계는 처음부터 열려 있다 (1단계 낌새의 기본).
 * 첫 프롬프트부터 낌새가 실려야 한다: 정산(outputPhase)을 한 번 거친 뒤에야 열리면 첫 응답에 복선이 없다.
 */
function initialTier(secret) {
  let t = -1;
  for (const tier of secret.tiers) { if (tier.when === 'true') t++; else break; }
  return t;
}

/** 진행 중 세이브에 비밀을 나중에 켜도 안전하게 — 없는 키만 시작 단계로 (밝혀진 것은 소급하지 않는다) */
function ensureSecretKeys(schema, vars) {
  const cfg = secretsConfig(schema);
  if (!cfg) return;
  for (const s of cfg) if (typeof vars[secKey(s.id)] !== 'number') vars[secKey(s.id)] = initialTier(s);
}

/**
 * 단계 열기 — 이번 턴 상태로 조건을 보고, 참인 **가장 높은** 단계까지 연다.
 * 단계는 누적 공개라 높은 단계가 열리면 그 아래는 함께 열린 것이다 (편지를 찾았으면 낌새 단계는 지나갔다).
 * 한 번 열린 건 절대 안 내려간다. 돌아오는 것은 전환 목록 — 원장·통지·fired 창구가 쓴다.
 * @param lookup 조건식 변수 조회 (engine.makeLookup)
 */
function advanceSecrets(schema, vars, lookup) {
  const cfg = secretsConfig(schema);
  if (!cfg) return [];
  const out = [];
  for (const s of cfg) {
    const cur = openedTier(s, vars);
    let top = cur;
    for (let i = s.tiers.length - 1; i > cur; i--) {
      const w = s.tiers[i].when;
      if (!w) continue;
      let ok = false;
      try { ok = truthy(evaluate(w, lookup, null)); } catch { ok = false; } // 깨진 식은 검증이 미리 잡는다
      if (ok) { top = i; break; }
    }
    if (top > cur) {
      vars[secKey(s.id)] = top;
      out.push({ secret: s, from: cur, to: top,
        notifies: s.tiers.slice(cur + 1, top + 1).map((t) => t.notify).filter(Boolean) });
    }
  }
  return out;
}

const KIND_WORD = { world: '세계', person: '인물', plot: '이야기' };
const OPEN_HEAD = {
  world: '밝혀진 사실',
  person: '털어놓은 것 · 드러난 것',
  plot: '밝혀진 내막',
};

/**
 * 메인 프롬프트 주입 블록 — **열린 단계의 text + (tell:'exists'면) 존재 알림만.**
 * 안 열린 단계의 text는 여기 없다. 이 함수가 은닉 보장의 실체다.
 * 전부 tell:'none'이고 하나도 안 열렸으면 '' — "비밀이 있다"는 신호도 스포일러다 (시나리오와 같은 원칙).
 * @param render text 속 {변수} 치환기 (엔진이 renderTemplate을 물려 준다). 기본은 원문 그대로.
 */
function secretInjectionText(schema, vars, render = (s) => s) {
  const cfg = secretsConfig(schema);
  if (!cfg) return '';
  const opened = [];   // 열린 게 있는 비밀
  const hinted = [];   // 하나도 안 열렸지만 존재는 알리는 비밀
  for (const s of cfg) {
    const t = openedTier(s, vars);
    if (t >= 0) opened.push({ s, t });
    else if (s.tell === 'exists') hinted.push(s);
  }
  if (!opened.length && !hinted.length) return '';
  const lines = ['[비밀 — 밝혀진 만큼만] 아래에 없는 것은 거짓이 아니라 아직 밝혀지지 않은 것이다. '
    + '빈칸을 창작으로 메우지 말고, 밝혀지지 않은 것을 안다고 서술하지 마라.'];
  for (const { s, t } of opened) {
    const who = s.about || s.label || s.id;
    const more = t < s.tiers.length - 1;
    lines.push(`- ${who} (${OPEN_HEAD[s.kind]}${more ? ' — 전부는 아니다' : ''}):`);
    for (let i = 0; i <= t; i++) {
      const txt = String(s.tiers[i].text || '').trim();
      if (txt) lines.push(`  · ${render(txt)}`);
    }
  }
  for (const s of hinted) {
    const who = s.about || s.label || s.id;
    lines.push(s.kind === 'person'
      ? `- ${who}에게는 말 못 할 사정이 있다. 너도 그 내용은 모른다 — 숨기는 사람답게 굴되(말을 돌리고, 캐물으면 회피하고), `
        + '내용을 지어내지 마라. 밝혀지는 순간이 오면 따로 알려 준다.'
      : `- ${who}에 관해 아직 드러나지 않은 사실이 있다. 너도 그 내용은 모른다 — 소문·흔적·이상한 정황으로만 다루고 `
        + '실체를 지어내지 마라. 밝혀지는 순간이 오면 따로 알려 준다.');
  }
  return lines.join('\n');
}

/**
 * 상태창 칩 — 유저 눈에도 은닉. 인물·세계 비밀만 자물쇠로 보이고(수집 요소), 반전은 아예 안 보인다.
 * tell:'none'인데 하나도 안 열린 비밀은 신호 자체가 스포일러라 안 그린다.
 * @param esc HTML 이스케이프 (render.js가 물려 준다)
 */
function secretChipHtml(schema, vars, esc = (s) => String(s)) {
  const cfg = secretsConfig(schema);
  if (!cfg) return '';
  const items = [];
  for (const s of cfg) {
    if (s.kind === 'plot') continue;
    const t = openedTier(s, vars);
    if (t < 0 && s.tell !== 'exists') continue;
    // 진행은 "밝혀낸 것"만 센다 — 처음부터 열린 낌새(initialTier)는 발견이 아니다. 낌새뿐인 비밀은 밝혀낼 게 없으니 안 그린다
    const base = initialTier(s);
    const total = s.tiers.length - 1 - base;
    if (total <= 0) continue;
    const name = s.label || s.about || s.id;
    const found = Math.max(0, t - base);
    const done = found >= total;
    items.push(`<span class="sim-sec${done ? ' is-open' : ''}" title="${esc(KIND_WORD[s.kind])} 비밀 — 밝혀진 정도">`
      + `${done ? '🔓' : '🔒'} ${esc(name)}<span class="sim-sec-prog">${found}/${total}</span></span>`);
  }
  return items.length ? `<span class="sim-secs">${items.join(' ')}</span>` : '';
}

module.exports = {
  KINDS, TELLS, SEC_PREFIX, KIND_WORD,
  secKey, defaultTell, secretsConfig, secretExposedNames, openedTier, initialTier, ensureSecretKeys,
  advanceSecrets, secretInjectionText, secretChipHtml,
};
