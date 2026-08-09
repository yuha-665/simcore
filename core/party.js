// 편성표 — 게임 패널 1호 (설계: docs/design-편성표.md)
//
// 원칙: 편성표는 **레코드 없이 지금 재료로** 된다 (design-레코드.md 순서 2).
//   슬롯 = enum 변수 (제작자가 값 목록을 확정 — AI는 명사를 못 만든다),
//   보유 = list 변수 (roster — 영입/이탈은 AI·명령이 목록을 움직인다),
//   표시 = statusUI의 when 분기 (v0.31부터 있던 기능).
// 이 모듈은 순수 로직만 담는다 — DOM은 어댑터(#sc-game)가, 검증은 validate가 맡는다.
//
// v0.56 탭: 롤모델은 칸코레 — 함대가 여럿이고(제1함대/제2함대), 슬롯 없이 버튼만 있는
// 시설 탭(수복·제작)도 있다. 탭의 버튼은 **기존 액션**을 가리킨다 — 액션이 이미
// 이벤트·규칙·판정으로 배선돼 있으므로(effects/check/inject), 새 트리거 기계가 필요 없다.
//
// v0.58 업그레이드(items): 스킬트리·시설 레벨·특성 찍기. 레코드 문서가 "레코드 필요"로
// 분류했던 것인데, "굴린 값을 계산에 안 쓴다"(범위 확정) 뒤에는 지금 재료로 된다 —
// 스킬 = int 변수(레벨), 선행조건 = 조건식(`검술 >= 2`), 찍기 = 포인트 차감 + 레벨 +1.
// max 1짜리 항목이 곧 특성(해금)이다. 비용은 숫자 또는 식(자기 레벨 참조 → 점증 비용).
//
// 왜 슬롯마다 enum이 따로인가: "전위엔 전사만" 같은 슬롯별 제약이 enum 값 목록으로
// 자연스럽게 표현된다. 후보가 같다면 같은 값 목록을 복사하면 될 뿐이다.

/**
 * 탭 정규화 — 단일 탭 축약형(slots/actions를 party에 직접)과 tabs 배열을 한 형태로.
 * 둘 다 쓰면 검증이 막는다 (validate). 반환: [{ id, label, note, roster, slots, actions }]
 */
function partyTabs(schema) {
  const p = schema?.party;
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.tabs) && p.tabs.length) {
    return p.tabs.map((t, i) => ({
      id: t.id ?? `tab${i + 1}`,
      label: t.label ?? `탭${i + 1}`,
      note: t.note ?? null,
      when: t.when ?? null,                   // 표시 조건 (v0.59) — 거짓이면 탭이 뷰에서 숨는다
      roster: t.roster ?? p.roster ?? null,   // 탭별 보유 목록 (수복 후보 따로 등) — 없으면 공용
      points: t.points ?? p.points ?? null,   // 탭별 포인트 자원 (스킬=SP, 시설=골드) — 없으면 공용
      slots: Array.isArray(t.slots) ? t.slots : [],
      actions: Array.isArray(t.actions) ? t.actions : [],
      items: Array.isArray(t.items) ? t.items : [],
    }));
  }
  const slots = Array.isArray(p.slots) ? p.slots : [];
  const actions = Array.isArray(p.actions) ? p.actions : [];
  const items = Array.isArray(p.items) ? p.items : [];
  if (!slots.length && !actions.length && !items.length) return [];
  return [{ id: 'main', label: p.label ?? '편성', note: null, when: null, roster: p.roster ?? null,
    points: p.points ?? null, slots, actions, items }];
}

/** 편성표 설정 (탭이 하나도 없으면 null — 어댑터가 버튼 자체를 안 단다) */
function partyConfig(schema) {
  return partyTabs(schema).length ? schema.party : null;
}

/** 사이드바 버튼 사양 — 어댑터가 registerButton에 그대로 쓴다 */
function partyButtonSpec(schema) {
  const p = partyConfig(schema);
  if (!p) return null;
  return { label: p.label ?? '편성표', icon: p.icon ?? '⚔️' };
}

// roster(보유 목록) 항목 대조 — 목록 규약 흔적을 걷어내고 이름만 본다.
// `@기한`(expire 마커)·끝자리 숫자(sum 규약)가 인명 뒤에 붙어 있어도 같은 사람으로 친다.
function rosterName(item) {
  return String(item).replace(/\s+@.*$/, '').replace(/\s+[+-]?\d+(?:\.\d+)?$/, '').trim();
}
function rosterHas(list, name) {
  return (Array.isArray(list) ? list : []).some((it) => rosterName(it) === name);
}

/** 편성표의 모든 슬롯 (탭 무관 평면 목록) — 검증·중복 자리 계산 공용 */
function allSlots(schema) {
  return partyTabs(schema).flatMap((t) => t.slots);
}

/** 모든 업그레이드 항목 (탭 무관) — 검증·진단 writer 등록 공용 */
function allItems(schema) {
  return partyTabs(schema).flatMap((t) => t.items);
}

// 업그레이드 항목의 현재 모습 한 벌 — 뷰와 applyUpgrade가 같은 판정을 봐야 하므로 한 곳에서.
// 반환: { level, max, maxed, cost, points, canBuy, locked, reason }
function itemState(schema, state, tab, item) {
  const { evaluate, truthy } = require('./expr');
  const { makeLookup } = require('./engine');
  const def = (schema.vars || []).find((v) => v.id === item.var);
  const level = Number(state.vars[item.var] ?? def?.init ?? 0);
  const max = item.max ?? def?.max ?? null;
  const maxed = max != null && level >= max;
  const lookup = makeLookup(schema, state.vars);
  let cost = null, locked = false, reason = '';
  if (!maxed) {
    try {
      cost = typeof item.cost === 'string' ? Math.ceil(Number(evaluate(item.cost, lookup, null))) : (item.cost ?? 0);
      if (!isFinite(cost)) { locked = true; reason = '비용식 결과가 숫자가 아님'; cost = null; }
    } catch (e) { locked = true; reason = `비용식 오류 — ${e.message}`; }
    if (!locked && item.requires) {
      try { if (!truthy(evaluate(item.requires, lookup, null))) { locked = true; reason = item.requiresLabel ?? '선행 조건 미충족'; } }
      catch (e) { locked = true; reason = `조건식 오류 — ${e.message}`; }
    }
  }
  const pointsVar = tab.points;
  const points = pointsVar != null ? Number(state.vars[pointsVar] ?? 0) : null;
  const short = !locked && !maxed && cost != null && points != null && points < cost;
  if (short) { reason = '포인트 부족'; }
  const canBuy = !maxed && !locked && !short && (cost == null || cost === 0 || points != null);
  return { level, max, maxed, cost, points, canBuy, locked, reason };
}

/**
 * 화면에 그릴 재료 한 벌. 상태를 건드리지 않는다.
 * opts.actionStates — 호스트가 주는 액션 상태 배열 [{id,label,armed,disabled,reason}]
 *   (어댑터의 currentActionStates와 같은 출처 — 상태창 범례·조작줄과 짝이 맞아야 한다).
 * 반환: { label, icon, note, empty, unique,
 *         tabs: [{ id, label, note, roster: {var,label,items}|null,
 *                  slots: [{ var, label, value, isEmpty, candidates: [{name, usedBy, locked}] }],
 *                  actions: [{ id, label, armed, disabled, reason }] }] }
 *   usedBy — unique일 때 이 이름이 이미 앉아 있는 다른 슬롯 var (탭이 달라도 — 한 인물은 한 자리).
 *   locked — roster가 있는데 아직 보유하지 않은 이름 (표시는 하되 잠금 — "영입하면 열린다")
 */
function partyView(schema, state, opts = {}) {
  const p = partyConfig(schema);
  if (!p) return null;
  const tabs = partyTabs(schema);
  const unique = p.unique !== false;
  const empty = p.empty ?? null;
  // 초상 (v0.57) — 이름 → 캐릭터 에셋 이름. 한글 함명↔영문 에셋명은 자동 유도가 안 되므로
  // 제작자가 명시한다. 실물 읽기(readImage)는 어댑터 몫 — 여기서는 이름만 얹는다.
  const portraits = (p.portraits && typeof p.portraits === 'object') ? p.portraits : {};
  const byId = {};
  for (const v of schema.vars || []) byId[v.id] = v;
  const stById = {};
  for (const st of opts.actionStates || []) stById[st.id] = st;

  // 자리 지도 — 탭을 가로질러 본다 (칸코레: 한 함선은 한 함대에만)
  const seat = {};
  for (const s of allSlots(schema)) {
    const val = state.vars[s.var];
    if (val != null && val !== empty) seat[val] = s.var;
  }

  // 탭 표시 조건 (v0.59) — 편성 연동 게이트. has(deployed, '이름')을 걸면 편성된 인물의
  // 스킬트리 탭만 목록에 남는다. 숨은 탭의 자리(seat)는 위에서 이미 셌다 — 안 보여도 점유는 유효.
  // 깨진 식은 보이는 쪽으로 넘어진다 (조용히 사라지면 제작자가 원인을 못 찾는다 — 검증이 잡는다).
  let visible = tabs;
  if (tabs.some((t) => t.when)) {
    const { evaluate, truthy } = require('./expr');
    const { makeLookup } = require('./engine');
    const lookup = makeLookup(schema, state.vars);
    visible = tabs.filter((t) => {
      if (!t.when) return true;
      try { return truthy(evaluate(t.when, lookup, null)); } catch { return true; }
    });
  }

  const viewTabs = visible.map((t) => {
    const rosterDef = t.roster ? byId[t.roster] : null;
    const rosterItems = rosterDef ? (state.vars[t.roster] ?? rosterDef.init ?? []) : null;
    const slots = t.slots.map((s) => {
      const def = byId[s.var] || {};
      const value = state.vars[s.var] ?? def.init ?? null;
      const isEmpty = empty != null && value === empty;
      const candidates = (def.enum || [])
        .filter((name) => name !== empty)
        .map((name) => ({
          name,
          usedBy: unique && seat[name] && seat[name] !== s.var ? seat[name] : null,
          locked: rosterItems != null && !rosterHas(rosterItems, name),
          portrait: portraits[name] ?? null,
        }));
      return {
        var: s.var, label: s.label ?? def.label ?? s.var, value, isEmpty, candidates,
        portrait: (!isEmpty && value != null) ? (portraits[value] ?? null) : null,
      };
    });
    // 탭의 액션 버튼 — 모르는 id는 조용히 떨구지 않고 잠긴 채 보여 준다 (제작 실수 가시화)
    const actions = t.actions.map((id) => stById[id]
      ?? { id, label: (schema.actions || []).find((a) => a.id === id)?.label ?? id,
        armed: !!state.meta?.armed?.[id], disabled: false, reason: '' });
    // 업그레이드 항목 (v0.58) — 레벨·비용·잠금을 뷰와 applyUpgrade가 같은 계산으로 본다
    const items = t.items.map((it) => {
      const def = byId[it.var] || {};
      return {
        var: it.var, label: it.label ?? def.label ?? it.var, note: it.note ?? null,
        ...itemState(schema, state, t, it),
      };
    });
    const pointsDef = t.points ? byId[t.points] : null;
    return {
      id: t.id, label: t.label, note: t.note,
      roster: rosterDef
        ? { var: t.roster, label: rosterDef.label ?? t.roster, items: (rosterItems || []).map(rosterName) }
        : null,
      points: pointsDef
        ? { var: t.points, label: pointsDef.label ?? t.points, value: Number(state.vars[t.points] ?? pointsDef.init ?? 0) }
        : null,
      slots, actions, items,
    };
  });

  return {
    label: p.label ?? '편성표', icon: p.icon ?? '⚔️', note: p.note ?? null,
    empty, unique, tabs: viewTabs,
  };
}

/**
 * 슬롯에 값 하나 앉히기. 상태를 바꾸지 않고 **바뀔 값만** 돌려준다 — 적용은 호스트 몫.
 * unique 충돌은 게임 편성표의 표준대로 푼다: 이미 딴 슬롯(딴 탭 포함)에 앉아 있는 이름을
 * 고르면 **이동**(그 슬롯은 비움), 빈값이 없는 스키마면 **맞교환**(단, 상대 enum에 값이 있어야).
 * 반환: { ok, changes: {var: value, ...}, moved?: {from} } | { ok: false, reason }
 */
function applyPartyPick(schema, state, slotVar, value) {
  const view = partyView(schema, state);
  if (!view) return { ok: false, reason: '편성표가 정의되지 않음' };
  const flat = view.tabs.flatMap((t) => t.slots);
  const slot = flat.find((s) => s.var === slotVar);
  if (!slot) return { ok: false, reason: `'${slotVar}'는 편성 슬롯이 아님` };
  const def = (schema.vars || []).find((v) => v.id === slotVar);

  // 비우기 — roster와 무관하게 항상 허용
  if (view.empty != null && value === view.empty) {
    if (slot.value === value) return { ok: true, changes: {} };
    return { ok: true, changes: { [slotVar]: value } };
  }
  if (!def?.enum?.includes(value)) {
    return { ok: false, reason: `'${value}'는 ${slot.label} 후보에 없음` };
  }
  const cand = slot.candidates.find((c) => c.name === value);
  if (cand?.locked) {
    const tab = view.tabs.find((t) => t.slots.some((s) => s.var === slotVar));
    return { ok: false, reason: `'${value}'는 아직 보유하지 않음 (${tab?.roster?.label ?? '보유 목록'}에 없음)` };
  }
  if (slot.value === value) return { ok: true, changes: {} };

  const changes = { [slotVar]: value };
  if (cand?.usedBy) {
    // 이동 또는 맞교환
    const other = flat.find((s) => s.var === cand.usedBy);
    const otherDef = (schema.vars || []).find((v) => v.id === cand.usedBy);
    if (view.empty != null && otherDef?.enum?.includes(view.empty)) {
      changes[cand.usedBy] = view.empty;                    // 이동 — 원래 자리는 비운다
    } else if (slot.value != null && !slot.isEmpty && otherDef?.enum?.includes(slot.value)) {
      changes[cand.usedBy] = slot.value;                    // 맞교환
    } else {
      return { ok: false, reason: `'${value}'는 이미 ${other?.label ?? cand.usedBy}에 편성됨 — 그쪽을 먼저 비우세요` };
    }
    return { ok: true, changes, moved: { from: cand.usedBy } };
  }
  return { ok: true, changes };
}

/**
 * 업그레이드 찍기 (v0.58). 뷰와 같은 판정(itemState)을 거쳐 **바뀔 값만** 돌려준다.
 * 내리기(환불)는 없다 — 게임 표준이고, 포인트 세탁 여지를 만들지 않는다.
 * 반환: { ok, changes: { [item.var]: 레벨+1, [points]: 잔량-비용 } } | { ok: false, reason }
 */
function applyUpgrade(schema, state, itemVar) {
  const tabs = partyTabs(schema);
  for (const t of tabs) {
    const item = t.items.find((it) => it.var === itemVar);
    if (!item) continue;
    const s = itemState(schema, state, t, item);
    if (s.maxed) return { ok: false, reason: '이미 최대 레벨' };
    if (s.locked) return { ok: false, reason: s.reason };
    if (!s.canBuy) return { ok: false, reason: s.reason || '지금은 찍을 수 없음' };
    const changes = { [item.var]: s.level + 1 };
    if (s.cost != null && s.cost > 0 && t.points) changes[t.points] = s.points - s.cost;
    return { ok: true, changes, level: s.level + 1 };
  }
  return { ok: false, reason: `'${itemVar}'는 업그레이드 항목이 아님` };
}

/**
 * 초상 이름 맞추기 — portraits에 적은 이름과 실물 에셋 이름을 짝지운다.
 *
 * 편집기가 "확장자는 생략 가능"이라고 약속하므로 양쪽 다 확장자를 떼고도 본다.
 * ⚠ 실측 사고: `Nakano_Miku.default.avif`처럼 **이름 안에 점이 있는** 에셋에서 짝이 안 맞았다.
 *   꼬리 하나를 떼는 규칙(`\.[a-z0-9]+$`)은 `Nakano_Miku.default`에서 `.default`를 확장자로
 *   착각해 `Nakano_Miku`까지 깎아 버린다. 그래서 "떼고 vs 안 떼고"를 네 가지로 다 맞춰 본다 —
 *   어느 쪽이 확장자를 달고 있는지 모르는 채로 짝을 찾아야 하기 때문이다.
 * @param names 실물 에셋 이름 배열 (또는 [이름, ...] 항목 배열)
 * @param want portraits에 적힌 이름
 * @returns 맞은 항목 (없으면 null)
 */
function matchAssetName(names, want) {
  const strip = (x) => String(x).replace(/\.[a-z0-9]+$/i, '');
  const w = String(want ?? '').trim().toLowerCase();
  if (!w) return null;
  const wBase = strip(w);
  for (const item of names || []) {
    const raw = Array.isArray(item) ? item[0] : (item && typeof item === 'object' ? item.name : item);
    const n = String(raw ?? '').trim().toLowerCase();
    if (!n) continue;
    const nBase = strip(n);
    if (n === w || nBase === w || n === wBase || nBase === wBase) return item;
  }
  return null;
}

module.exports = { partyConfig, partyButtonSpec, partyTabs, allSlots, allItems, partyView, applyPartyPick, applyUpgrade, rosterName, rosterHas, itemState, matchAssetName };
