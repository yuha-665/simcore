// 보조가 쓰는 갈림길 (v1.8.0) — liveChoices. 갈림길 확장 셋의 셋째 조각 (docs/design-갈림길-확장.md).
//
// 스키마 갈림길(events[].choices)은 제작자가 미리 적은 고정 선택지다 — "이 순간의 갈림길"로는 맞지만,
// "지금 곁에 있는 사람·지금 장면에 걸맞은 선택지"는 미리 적을 수 없다. 노우코메(내 뇌내 선택지가…)류
// 봇이 그 벽에서 실패했다: 선택지를 모델이 내고 강제도 모델이 하니, 유저가 무시하면 모델도 따라갔다.
//
// 의뢰판(quest)과 같은 규약으로 푼다 — **보조가 쓰고 시스템이 쥔다**:
//   · 전송 단계에서 "이번 응답 뒤 선택지를 부탁할지"를 추첨(chance, 시드 rng) → meta.liveAsk
//   · 보조 호출에 얹혀 간다(추가 호출 0). 보조는 라벨 + 태그만 쓴다 — 결과(판정·효과·전달문)는 태그가 정한다.
//     태그 어휘가 스키마에 고정돼 있어 라벨이 즉석이어도 결과는 시스템 손에 남는다
//   · 응답 단계에서 정제해 pendingChoice로 건다 (id '@live', 항목은 상태에 산다 — 스냅샷과 함께 되감김)
//   · 그 뒤는 스키마 갈림길과 같은 기계: /선택·클릭·타임아웃·strict(강제)·allow 동결
//   · worst 태그: 그 항목을 맨 끝에 둔다 — 타임아웃·strict 'last'의 "안 고르면 최악" 규약과 맞물린다
//
// 스키마 (옵트인):
//   liveChoices: { label?, icon?, when?, chance?, count?, tags?, worst?, strict?, timeout?, guide?, desc?, showTags? }
//   · chance: 0~1 숫자 또는 식 — 매 전송 추첨. 0이면 이벤트 트리거(events[].liveChoices: true)로만 연다
//   · tags: [{ id, desc?, check?, effects?, inject? }] — 보조가 항목마다 붙이는 어휘. 없으면 라벨만(결과는 서사)
//   · strict: true('last') | 'last' | 'random' | false — 고르지 않고 보내면 시스템이 정한다

const { evaluate, truthy } = require('./expr');

const LIVE_ID = '@live';
const CAPS = { LABEL: 60, DESC: 160, TAG: 16, TAGS_MAX: 8, COUNT_MIN: 2, COUNT_MAX: 4, GUIDE: 600 };

const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const effectsOf = (raw) => (Array.isArray(raw) ? raw : [])
  .filter((e) => e && typeof e === 'object' && ((typeof e.set === 'string' && e.set) || (typeof e.list === 'string' && e.list)));

/** strict 값 → 모드. true는 'last'(맨 끝 = 최악 규약). 그 밖은 null(강제 아님) */
function strictMode(v) {
  if (v === true || v === 'last') return 'last';
  if (v === 'random') return 'random';
  return null;
}

function liveConfig(schema) {
  const L = schema?.liveChoices;
  if (!L || typeof L !== 'object' || Array.isArray(L)) return null;
  let count = [CAPS.COUNT_MIN, 3];
  if (Array.isArray(L.count) && L.count.length === 2 && L.count.every((n) => Number.isInteger(n))) {
    const a = Math.max(CAPS.COUNT_MIN, Math.min(CAPS.COUNT_MAX, L.count[0]));
    const b = Math.max(CAPS.COUNT_MIN, Math.min(CAPS.COUNT_MAX, L.count[1]));
    count = [Math.min(a, b), Math.max(a, b)];
  }
  const tags = (Array.isArray(L.tags) ? L.tags : [])
    .filter((t) => t && typeof t === 'object' && typeof t.id === 'string' && t.id.trim())
    .slice(0, CAPS.TAGS_MAX)
    .map((t) => ({
      id: cut(t.id, CAPS.TAG),
      desc: typeof t.desc === 'string' ? cut(t.desc, 120) : '',
      check: typeof t.check === 'string' && t.check ? t.check : null,
      effects: effectsOf(t.effects),
      inject: typeof t.inject === 'string' && t.inject.trim() ? t.inject : null,
    }));
  const worst = typeof L.worst === 'string' && tags.some((t) => t.id === L.worst) ? L.worst : null;
  return {
    label: typeof L.label === 'string' && L.label.trim() ? L.label.trim() : '선택지',
    icon: typeof L.icon === 'string' && L.icon.trim() ? L.icon.trim() : '⌛',
    when: typeof L.when === 'string' ? L.when : '',
    chance: (typeof L.chance === 'number' || typeof L.chance === 'string') ? L.chance : 0,
    count,
    tags,
    worst,
    strict: strictMode(L.strict),
    timeout: Number.isInteger(L.timeout) && L.timeout >= 1 ? L.timeout : null,
    guide: typeof L.guide === 'string' ? L.guide.slice(0, CAPS.GUIDE) : '',
    desc: typeof L.desc === 'string' && L.desc.trim() ? L.desc.trim() : '',
    showTags: L.showTags !== false,
  };
}

function liveOpen(cfg, schema, vars, makeLookup) {
  if (!cfg.when) return true;
  try { return truthy(evaluate(cfg.when, makeLookup(schema, vars), null)); }
  catch { return false; }
}

/** 이번 전송의 부탁 확률 — 숫자 또는 식(0~1 스케일). 깨진 식은 0 (검증이 미리 잡는다) */
function liveChance(cfg, schema, vars, makeLookup) {
  let c = 0;
  if (typeof cfg.chance === 'string') {
    try { c = Number(evaluate(cfg.chance, makeLookup(schema, vars), null)); } catch { c = 0; }
  } else c = Number(cfg.chance) || 0;
  return isFinite(c) ? Math.max(0, Math.min(1, c)) : 0;
}

/**
 * 전송 단계 추첨 — "이번 응답 뒤 보조에게 선택지를 부탁할까". 깃발만 세운다 (meta.liveAsk).
 * rng는 설정이 있을 때만 소비한다 — 없는 봇의 리롤 시드 순서를 흔들지 않는다.
 * 이미 깃발이 서 있으면(이벤트 트리거) 추첨하지 않는다.
 */
function rollAsk(schema, state, rng, makeLookup) {
  const cfg = liveConfig(schema);
  if (!cfg || !rng) return false;
  const m = state.meta;
  if (m.liveAsk || m.pendingChoice) return false;
  if (!liveOpen(cfg, schema, state.vars, makeLookup)) return false;
  const p = liveChance(cfg, schema, state.vars, makeLookup);
  if (p <= 0) return false;
  if (rng() < p) { m.liveAsk = true; return true; }
  return false;
}

/** 보조가 준 선택지를 규격으로 거른다 — 라벨 길이·태그 어휘·중복·개수. worst 태그는 맨 끝으로 */
function sanitizeItems(cfg, raw) {
  const out = { desc: '', items: [], rejected: [] };
  if (!raw || typeof raw !== 'object') return out;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : Array.isArray(raw.choices) ? raw.choices : [];
  out.desc = Array.isArray(raw) ? '' : cut(raw.desc, CAPS.DESC);
  const seen = new Set();
  const tagIds = new Set(cfg.tags.map((t) => t.id));
  for (const it of list) {
    if (out.items.length >= cfg.count[1]) break;
    const label = typeof it === 'string' ? cut(it, CAPS.LABEL) : cut(it?.label, CAPS.LABEL);
    if (!label) continue;
    const key = label.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) { out.rejected.push(`${label} (중복)`); continue; }
    let tag = typeof it === 'object' && it && it.tag != null ? cut(it.tag, CAPS.TAG) : '';
    if (cfg.tags.length) {
      if (!tagIds.has(tag)) {
        // 어휘 밖 태그 — 앞머리·부분 일치로 한 번 구제한다 (보조가 "굴욕적"처럼 꼬리를 붙이는 일이 잦다)
        const hit = cfg.tags.filter((t) => tag && (tag.startsWith(t.id) || t.id.startsWith(tag) || tag.includes(t.id)));
        if (hit.length === 1) tag = hit[0].id;
        else { out.rejected.push(`${label} (태그 '${tag || '없음'}')`); continue; }
      }
    } else tag = '';
    seen.add(key);
    out.items.push({ label, tag });
  }
  if (out.items.length < cfg.count[0]) { out.rejected.push(`(항목 ${out.items.length}개 — 최소 ${cfg.count[0]})`); out.items = []; return out; }
  // worst는 하나만, 맨 끝으로 — 여럿이면 첫째만 남기고 나머지는 태그를 지운다(라벨은 산다)
  if (cfg.worst) {
    const ws = out.items.filter((x) => x.tag === cfg.worst);
    if (ws.length) {
      const rest = out.items.filter((x) => x.tag !== cfg.worst);
      ws.slice(1).forEach((x) => { x.tag = cfg.tags.find((t) => t.id !== cfg.worst)?.id ?? ''; });
      out.items = [...rest, ...ws.slice(1), ws[0]];
    }
  }
  return out;
}

/**
 * 응답 단계 — 부탁했던 턴(liveAsk)에 온 것을 건다. 깃발은 여기서 소비된다.
 * 다른 갈림길이 걸려 있으면 깃발을 **남긴다** (auxSpec도 그때는 안 물었다 — 다음 턴에 다시).
 */
function applyLive(schema, state, raw) {
  const cfg = liveConfig(schema);
  if (!cfg) return { posted: 0 };
  const m = state.meta;
  if (!m.liveAsk) return { posted: 0 };
  if (m.pendingChoice) return { posted: 0, deferred: true };
  m.liveAsk = false;
  const clean = sanitizeItems(cfg, raw);
  if (!clean.items.length) return { posted: 0, rejected: clean.rejected };
  m.pendingChoice = { id: LIVE_ID, turn: m.turn, live: { desc: clean.desc || cfg.desc || '', items: clean.items } };
  m.pendingChoicePick = null;
  return { posted: clean.items.length, rejected: clean.rejected };
}

/**
 * 걸린 보조 갈림길을 이벤트 모양으로 합성한다 — 엔진의 갈림길 기계(집행·타임아웃·동결·렌더)가
 * 스키마 갈림길과 같은 코드로 돌게. 항목의 판정·효과·전달문은 태그에서 온다.
 */
function synthEvent(schema, pc) {
  const cfg = liveConfig(schema);
  if (!cfg || !pc || pc.id !== LIVE_ID || !pc.live || !Array.isArray(pc.live.items)) return null;
  const byTag = Object.fromEntries(cfg.tags.map((t) => [t.id, t]));
  const choices = pc.live.items.map((it) => {
    const t = it.tag ? byTag[it.tag] : null;
    return { label: it.label, tag: it.tag || null, effects: t?.effects || [], inject: t?.inject || null, check: t?.check || null };
  });
  if (!choices.length) return null;
  return { id: LIVE_ID, live: true, label: cfg.label, icon: cfg.icon, notify: pc.live.desc || '',
    timeout: cfg.timeout, strict: cfg.strict, showTags: cfg.showTags, choices };
}

/** 보조 지시 본문 — 부탁한 턴에만 얹힌다 (평턴 비용 0) */
function auxSpec(schema, state, makeLookup) {
  const cfg = liveConfig(schema);
  if (!cfg) return '';
  const m = state?.meta;
  if (!m?.liveAsk || m.pendingChoice) return '';
  if (!liveOpen(cfg, schema, state.vars, makeLookup)) return '';
  const n = cfg.count;
  const tagLine = cfg.tags.length
    ? `- 항목마다 태그(tag)를 다음 중 하나로만 붙여라: ${cfg.tags.map((t) => t.desc ? `${t.id}(${t.desc})` : t.id).join(' | ')}. 그 밖의 태그는 시스템이 버린다.`
    : null;
  const worstLine = cfg.worst
    ? `- 그중 정확히 하나는 태그 '${cfg.worst}' — 유저가 고르지 않으면 그 항목으로 흘러가는 최악의 길이다.`
    : null;
  return ['',
    `[${cfg.label} — 선택지 쓰기] (필수 항목)`,
    `- "choices" 필드로 지금 이 장면의 유저에게 내밀 선택지 ${n[0]}~${n[1]}개를 써라. 각각 유저 시점의 행동 한 줄(${CAPS.LABEL}자 이내), 서로 다른 방향으로. 지금 곁에 있는 인물·방금 벌어진 일에 맞춰라 — 일반론은 금지.`,
    tagLine, worstLine,
    cfg.guide ? `- ${cfg.guide}` : null,
    '- "desc"는 이 선택이 무엇에 대한 것인지 한 줄 (선택지 자체를 되풀이하지 마라). 유저가 골라야 진행되니, 서사에서 고른 척하지 마라.',
    `- choices 형식: {"desc":"한 줄","items":[{"label":"행동 한 줄"${cfg.tags.length ? ',"tag":"태그"' : ''}}]}`,
  ].filter((x) => x !== null).join('\n');
}

/** 강제 결정 때 모델에게 보일 유저 턴 대체문 — 어댑터가 마지막 유저 메시지 본문을 이걸로 바꾼다 */
function overrideText(forced) {
  return `[선택 강제] ${forced.idx + 1}. ${forced.label} — 유저는 선택지 밖의 행동을 적었고, 시스템이 이 항목으로 정했다.`;
}

module.exports = { LIVE_ID, CAPS, strictMode, liveConfig, liveOpen, liveChance, rollAsk, sanitizeItems, applyLive, synthEvent, auxSpec, overrideText };
