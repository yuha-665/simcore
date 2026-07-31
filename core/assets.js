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
 * 실존 대조 + 폴백 사다리 (팩 단위) — 슬롯 방식의 유일한 약점(비어 있는 칸 조합)을 흡수한다.
 * 인물별 이미지 개수·감정 목록이 달라도 팩은 합집합 한 번만 선언하면 되는 이유.
 *
 * assetSet: 실물 에셋 이름 Set. null이면 대조 불가 환경 — 사다리 없이 정조합을 그대로 믿는다.
 * 사다리: ① 정조합 → ② optional 칸 제거 → ③ 폴백값 치환(칸의 fallback, who 제외)
 *         → ④ 폴백값 치환 + optional 제거 → 전부 실패면 null (삽입 생략).
 * demoted = 정조합이 아닌 걸로 살아남았다는 표시 (폴백률 진단용).
 * 라우팅과 분리해 둔 이유: 편집기 커버리지가 "이 빠진 조합, 폴백으로 구제되나"를 같은
 * 사다리로 미리 재기 위해 (구제 여부가 다르게 계산되면 표시가 거짓말이 된다).
 */
function resolveInPack(pack, choice, assetSet) {
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
  return name == null ? null : { name, used, demoted };
}

/** 라우팅 + 사다리 + 태그 렌더 — aux 모드의 한 장 해소 경로 */
function resolveImage(schema, choice, assetSet, lookup) {
  const who = choice && choice.who;
  const pack = routePack(schema, who, lookup);
  if (!pack) return { ok: false, reason: 'no-pack', who: who ?? null };
  const r = resolveInPack(pack, choice, assetSet);
  if (!r) return { ok: false, reason: 'no-asset', who, pack: pack.id };
  return { ok: true, name: r.name, tag: renderTag(pack, r.name, r.used), pack: pack.id, demoted: r.demoted };
}

// ── 서사 위치 삽입 (by: 'aux_flow') ──────────────────────────
// 위치를 서수("3번째 문단 뒤")가 아니라 본문 인용(앵커)으로 받는다 — 실존 대조와 같은 원리로,
// 검증할 수 없는 답은 받지 않는다. 인용은 본문에서 찾아지거나, 못 찾으면 놓지 않으면 그만이다.

/**
 * 앵커 탐색 사다리 — ① 정확 일치 → ② 공백 정규화(보조가 줄바꿈을 뭉개 인용하는 경우)
 * → ③ 정규화 앞 12자(인용 뒷부분이 어긋난 경우). 전부 실패면 -1.
 */
function findAnchor(content, anchor) {
  if (!content || anchor == null) return -1;
  const a = String(anchor).trim();
  if (!a) return -1;
  let i = content.indexOf(a);
  if (i >= 0) return i;
  const norm = (s) => s.replace(/\s+/g, ' ');
  const nc = norm(content), na = norm(a);
  i = nc.indexOf(na);
  if (i < 0 && na.length >= 6) i = nc.indexOf(na.slice(0, 12));
  return i < 0 ? -1 : mapNormIndex(content, i);
}

/** 공백 정규화된 문자열의 인덱스를 원본 인덱스로 역매핑 */
function mapNormIndex(content, target) {
  let n = 0, prevWs = false;
  for (let i = 0; i < content.length; i++) {
    const ws = /\s/.test(content[i]);
    if (ws && prevWs) continue;
    if (n === target) return i;
    n++;
    prevWs = ws;
  }
  return content.length;
}

/**
 * 항목마다 앵커를 찾아 그 문단 바로 뒤에 태그를 놓는다.
 * items = [{ tag, anchor }] (이미 resolveImage를 통과한 태그만).
 * 못 찾은 항목은 생략하되, 한 장도 못 놓았는데 살아남은 항목이 있으면
 * 첫 장을 맨 앞에 놓는다 (aux 단일 모드로 강등 — 이미지가 아예 없는 턴 방지).
 * 반환 { text, placed, dropped, demoted } — demoted = 맨 앞 강등이 일어났다는 표시.
 */
function placeImages(content, items) {
  const seen = new Set();
  const uniq = (items || []).filter((x) => x && x.tag).slice(0, 4).filter((x) => {
    const k = x.tag + '\n' + (x.anchor ?? ''); // 태그에 개행이 없으니 안전한 구분자
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const points = [];
  let dropped = 0;
  uniq.forEach((it, idx) => {
    const i = findAnchor(content, it.anchor);
    if (i < 0) { dropped++; return; }
    const para = content.indexOf('\n\n', i); // 앵커가 든 문단의 끝 (없으면 본문 끝)
    points.push({ at: para >= 0 ? para : content.length, tag: it.tag, idx });
  });
  if (!points.length) {
    if (uniq.length) return { text: uniq[0].tag + '\n\n' + content, placed: 1, dropped: uniq.length - 1, demoted: true };
    return { text: content, placed: 0, dropped, demoted: false };
  }
  // 뒤에서부터 삽입해야 앞 인덱스가 안 밀린다. 같은 지점은 선언 순서가 본문 순서가 되게 역순 처리
  points.sort((a, b) => b.at - a.at || b.idx - a.idx);
  let text = content;
  for (const p of points) text = text.slice(0, p.at) + '\n\n' + p.tag + text.slice(p.at);
  return { text, placed: points.length, dropped, demoted: false };
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
 * aux 계열 모드용 지시 조각 — 보조 응답 JSON에 이미지 필드를 얹어 받기 위한 스펙.
 * 보조는 인물·감정만 고른다 (팩 선택·조합·대조는 SimCore 몫 — 고를 것이 늘면 틀릴 것도 는다).
 * by:'aux'      → "image" 단일 객체 (맨 앞 1장)
 * by:'aux_flow' → "images" 배열 + 앵커(본문 인용) — 위치까지 고르되 검증 가능한 형태로만
 * 반환: { instruction, whoValues, slotIds } — 팩이 없으면 instruction ''.
 */
function auxImageSpec(schema, lookup) {
  const by = schema?.assets?.by ?? 'aux';
  if (by !== 'aux' && by !== 'aux_flow') return { instruction: '', whoValues: [], slotIds: [] };
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
  const vocab = [
    `who: one of [${whoValues.join(', ')}]`,
    ...[...slotVals.entries()].map(([k, set]) => `${k}: one of [${[...set].join(', ')}]`),
  ];
  const lines = by === 'aux_flow'
    ? [
      `Also include "images": [{ ${fields.join(', ')}, "anchor": <quote> }] — up to 3 entries in narrative order, one per beat where the visual focus changes.`,
      'anchor: a short quote (10-25 chars) copied EXACTLY, verbatim, from the narrative above. The image is inserted right after the paragraph containing it; if the quote is not found verbatim, that image is dropped.',
      ...vocab,
      'If no clear scene focus, set "images": [].',
    ]
    : [
      `Also include "image": { ${fields.join(', ')} } for the main character of this scene.`,
      ...vocab,
      'If no clear scene focus, set "image": null.',
    ];
  return { instruction: lines.join('\n'), whoValues, slotIds: [...slotVals.keys()] };
}

module.exports = {
  packOpen, openPacks, packChars, whoSlot, routePack,
  composeName, renderTag, resolveInPack, resolveImage, findAnchor, placeImages,
  mainInjectionText, auxImageSpec,
};
