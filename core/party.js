// 편성표 — 게임 패널 1호 (설계: docs/design-편성표.md)
//
// 원칙: 편성표는 **레코드 없이 지금 재료로** 된다 (design-레코드.md 순서 2).
//   슬롯 = enum 변수 (제작자가 값 목록을 확정 — AI는 명사를 못 만든다),
//   보유 = list 변수 (roster — 영입/이탈은 AI·명령이 목록을 움직인다),
//   표시 = statusUI의 when 분기 (v0.31부터 있던 기능).
// 이 모듈은 순수 로직만 담는다 — DOM은 어댑터(#sc-game)가, 검증은 validate가 맡는다.
//
// 왜 슬롯마다 enum이 따로인가: "전위엔 전사만" 같은 슬롯별 제약이 enum 값 목록으로
// 자연스럽게 표현된다. 후보가 같다면 같은 값 목록을 복사하면 될 뿐이다.

/** 편성표 설정 (없거나 슬롯이 비면 null — 어댑터가 버튼 자체를 안 단다) */
function partyConfig(schema) {
  const p = schema?.party;
  if (!p || typeof p !== 'object') return null;
  if (!Array.isArray(p.slots) || !p.slots.length) return null;
  return p;
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

/**
 * 화면에 그릴 재료 한 벌. 상태를 건드리지 않는다.
 * 반환: { label, icon, note, empty, unique, roster: {var,label,items}|null,
 *         slots: [{ var, label, value, isEmpty, candidates: [{name, usedBy, locked}] }] }
 *   usedBy — unique일 때 이 이름이 이미 앉아 있는 다른 슬롯 var (고르면 그쪽에서 이동해 온다)
 *   locked — roster가 있는데 아직 보유하지 않은 이름 (표시는 하되 잠금 — "영입하면 열린다")
 */
function partyView(schema, state) {
  const p = partyConfig(schema);
  if (!p) return null;
  const unique = p.unique !== false;
  const empty = p.empty ?? null;
  const byId = {};
  for (const v of schema.vars || []) byId[v.id] = v;
  const rosterDef = p.roster ? byId[p.roster] : null;
  const rosterItems = rosterDef ? (state.vars[p.roster] ?? rosterDef.init ?? []) : null;
  const seat = {}; // 이름 → 앉아 있는 슬롯 var
  for (const s of p.slots) {
    const val = state.vars[s.var];
    if (val != null && val !== empty) seat[val] = s.var;
  }
  const slots = p.slots.map((s) => {
    const def = byId[s.var] || {};
    const value = state.vars[s.var] ?? def.init ?? null;
    const isEmpty = empty != null && value === empty;
    const candidates = (def.enum || [])
      .filter((name) => name !== empty)
      .map((name) => ({
        name,
        usedBy: unique && seat[name] && seat[name] !== s.var ? seat[name] : null,
        locked: rosterItems != null && !rosterHas(rosterItems, name),
      }));
    return { var: s.var, label: s.label ?? def.label ?? s.var, value, isEmpty, candidates };
  });
  return {
    label: p.label ?? '편성표', icon: p.icon ?? '⚔️', note: p.note ?? null,
    empty, unique,
    roster: rosterDef
      ? { var: p.roster, label: rosterDef.label ?? p.roster, items: (rosterItems || []).map(rosterName) }
      : null,
    slots,
  };
}

/**
 * 슬롯에 값 하나 앉히기. 상태를 바꾸지 않고 **바뀔 값만** 돌려준다 — 적용은 호스트 몫.
 * unique 충돌은 게임 편성표의 표준대로 푼다: 이미 딴 슬롯에 앉아 있는 이름을 고르면
 * **이동**(그 슬롯은 비움), 빈값이 없는 스키마면 **맞교환**(단, 상대 enum에 값이 있어야).
 * 반환: { ok, changes: {var: value, ...}, moved?: {from} } | { ok: false, reason }
 */
function applyPartyPick(schema, state, slotVar, value) {
  const view = partyView(schema, state);
  if (!view) return { ok: false, reason: '편성표가 정의되지 않음' };
  const slot = view.slots.find((s) => s.var === slotVar);
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
  if (cand?.locked) return { ok: false, reason: `'${value}'는 아직 보유하지 않음 (${view.roster?.label ?? '보유 목록'}에 없음)` };
  if (slot.value === value) return { ok: true, changes: {} };

  const changes = { [slotVar]: value };
  if (cand?.usedBy) {
    // 이동 또는 맞교환
    const other = view.slots.find((s) => s.var === cand.usedBy);
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

module.exports = { partyConfig, partyButtonSpec, partyView, applyPartyPick, rosterName, rosterHas };
