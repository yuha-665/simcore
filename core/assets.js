// 에셋 슬롯/팩 — 이미지 태그 자동화의 순수 로직 (설계: docs/design-에셋-슬롯.md)
//
// 핵심: 조합(C×E)을 슬롯(C+E)으로 — 목록이 곱셈에서 덧셈이 된다.
// emit을 SimCore가 소유하므로 AI는 어떤 모듈의 사설 규약도 배울 필요가 없다.
// 팩(pack)이 관리 단위: 모듈마다 출력 방언(format)·구분자(sep)·어휘가 달라도 팩이 흡수한다.
// 표시(정규식/CSS)는 건드리지 않는다 — 팩 format이 그 봇의 방언 그대로 내보내므로
// 기존 표시 계층이 손대지 않아도 작동한다 (디스플레이 자동화는 v1.1 후보, [live-test] 뒤).
//
// 게이트(when) 평가는 lookup(엔진 makeLookup)을 받아서 한다. lookup이 없으면(상태 미상)
// when 있는 팩은 닫힌 것으로 취급 — 모르는 상태에서 성인 팩을 여는 사고가 없게.

const { evaluate, truthy } = require('./expr');

/** 팩의 게이트가 열려 있나 (enabled 토글 + when 조건) */
function packOpen(pack, lookup) {
  if (!pack || pack.enabled === false) return false;
  if (pack.when == null || pack.when === '') return true;
  if (!lookup) return false;
  try { return truthy(evaluate(pack.when, lookup, null)); } catch { return false; }
}

/** 게이트가 열린 팩들 (선언 순서 유지) */
function openPacks(schema, lookup) {
  return (schema?.assets?.packs || []).filter((p) => packOpen(p, lookup));
}

function whoSlot(pack) {
  return (pack.slots || []).find((s) => s.id === 'who') || null;
}

/** 이 팩이 담당하는 인물 목록 — who 칸 값 ∪ 팩 레벨 chars */
function packChars(pack) {
  const ws = whoSlot(pack);
  return [...(pack.chars || []), ...(ws ? ws.values || [] : [])];
}

/**
 * 라우팅 — 인물을 담당하는 팩을 찾는다. 먼저 선언된 팩 우선 (조용한 덮어쓰기 금지,
 * 왕복 패치의 충돌 원칙과 같다). 보조에게 팩 id를 고르게 하지 않는 이유가 이 함수다.
 */
function routePack(schema, who, lookup) {
  if (!who) return null;
  for (const p of openPacks(schema, lookup)) {
    if (packChars(p).includes(who)) return p;
  }
  return null;
}

/**
 * 칸 값들을 팩 규약대로 조합해 에셋 이름을 만든다.
 * choice = { 칸id: 값 } — 필수 칸이 비면 null (조합 불가), optional 칸은 빠져도 된다.
 * dropOptional = true면 optional 칸을 값이 있어도 뺀다 (폴백 사다리용).
 */
function composeName(pack, choice, dropOptional = false) {
  const parts = [];
  for (const s of pack.slots || []) {
    const v = choice ? choice[s.id] : undefined;
    if (v == null || v === '') {
      if (s.optional) continue;
      return null;
    }
    if (s.optional && dropOptional) continue;
    parts.push(String(v));
  }
  return parts.length ? parts.join(pack.sep ?? '_') : null;
}

/** 팩 format의 {name}·{칸id} 자리표시자를 채워 출력 태그를 만든다 */
function renderTag(pack, name, choice) {
  return String(pack.format || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    if (key === 'name') return name ?? '';
    const v = choice ? choice[key] : undefined;
    return v == null ? '' : String(v);
  });
}

/**
 * 실존 대조 + 폴백 사다리 — 슬롯 방식의 유일한 약점(비어 있는 칸 조합)을 흡수한다.
 * 인물별 이미지 개수·감정 목록이 달라도 팩은 합집합 한 번만 선언하면 되는 이유.
 *
 * assetSet: 실물 에셋 이름 Set. null이면 대조 불가 환경 — 사다리 없이 정조합을 그대로 믿는다.
 * 사다리: ① 정조합 → ② optional 칸 제거 → ③ 폴백값 치환(칸의 fallback, who 제외)
 *         → ④ 폴백값 치환 + optional 제거 → 전부 실패면 삽입 생략(null).
 * demoted = 정조합이 아닌 걸로 살아남았다는 표시 (폴백률 진단용).
 */
function resolveImage(schema, choice, assetSet, lookup) {
  const who = choice && choice.who;
  const pack = routePack(schema, who, lookup);
  if (!pack) return { ok: false, reason: 'no-pack', who: who ?? null };

  const tryName = (c, dropOpt) => {
    const name = composeName(pack, c, dropOpt);
    if (!name) return null;
    if (assetSet && !assetSet.has(name)) return null;
    return name;
  };

  let name = tryName(choice, false);
  let demoted = false;
  let used = choice;
  if (name == null) {
    name = tryName(choice, true);
    if (name != null) demoted = true;
  }
  if (name == null) {
    // 폴백값 치환 — who는 그대로 (같은 인물의 폴백 감정으로 강등)
    const fb = { ...choice };
    let has = false;
    for (const s of pack.slots || []) {
      if (s.id === 'who' || s.fallback == null) continue;
      fb[s.id] = s.fallback; has = true;
    }
    if (has) {
      name = tryName(fb, false) ?? tryName(fb, true);
      if (name != null) { demoted = true; used = fb; }
    }
  }
  if (name == null) return { ok: false, reason: 'no-asset', who, pack: pack.id };
  return { ok: true, name, tag: renderTag(pack, name, used), pack: pack.id, demoted };
}

/**
 * main 모드 주입문 — 지금 손으로 쓰던 이미지 지침 블록을 SimCore가 대신 쓴다.
 * 곱셈이 덧셈이 되고(Σ 인물+감정), 닫힌 팩은 통째로 빠진다. 모델에게 가는 문구라 영어.
 * 대조가 불가능한 모드라 "확신 없으면 태그 생략"을 항상 깐다.
 */
function mainInjectionText(schema, lookup) {
  if ((schema?.assets?.by ?? 'aux') !== 'main') return '';
  const packs = openPacks(schema, lookup);
  if (!packs.length) return '';
  const out = ['[Image tags] You may insert image tags in the narration.',
    'Compose tag names ONLY from the values below. If unsure a combination exists, omit the tag entirely.'];
  for (const p of packs) {
    const order = (p.slots || []).map((s) => s.optional ? `[${s.id}]` : s.id).join(` ${p.sep ?? '_'} `);
    out.push(`- pack "${p.id}": format ${p.format} · name = ${order}`);
    for (const s of p.slots || []) {
      out.push(`  ${s.id}${s.optional ? ' (optional)' : ''}: ${(s.values || []).join(', ')}`);
    }
    if (p.chars && p.chars.length) out.push(`  for characters: ${p.chars.join(', ')}`);
  }
  return out.join('\n');
}

/**
 * aux 모드용 지시 조각 — 보조 응답 JSON에 "image" 필드를 얹어 받기 위한 스펙.
 * 보조는 인물·감정만 고른다 (팩 선택·조합·대조는 SimCore 몫 — 고를 것이 늘면 틀릴 것도 는다).
 * 반환: { instruction, whoValues, slotIds } — 팩이 없으면 instruction ''.
 */
function auxImageSpec(schema, lookup) {
  if ((schema?.assets?.by ?? 'aux') !== 'aux') return { instruction: '', whoValues: [], slotIds: [] };
  const packs = openPacks(schema, lookup);
  if (!packs.length) return { instruction: '', whoValues: [], slotIds: [] };
  const whoValues = [...new Set(packs.flatMap((p) => packChars(p)))];
  const slotVals = new Map(); // 칸 id → 값 합집합 (who 제외)
  for (const p of packs) {
    for (const s of p.slots || []) {
      if (s.id === 'who') continue;
      const set = slotVals.get(s.id) || new Set();
      for (const v of s.values || []) set.add(v);
      slotVals.set(s.id, set);
    }
  }
  const fields = ['"who": <character>', ...[...slotVals.keys()].map((k) => `"${k}": <${k}>`)];
  const lines = [
    `Also include "image": { ${fields.join(', ')} } for the main character of this scene.`,
    `who: one of [${whoValues.join(', ')}]`,
    ...[...slotVals.entries()].map(([k, set]) => `${k}: one of [${[...set].join(', ')}]`),
    'If no clear scene focus, set "image": null.',
  ];
  return { instruction: lines.join('\n'), whoValues, slotIds: [...slotVals.keys()] };
}

module.exports = {
  packOpen, openPacks, packChars, whoSlot, routePack,
  composeName, renderTag, resolveImage, mainInjectionText, auxImageSpec,
};
