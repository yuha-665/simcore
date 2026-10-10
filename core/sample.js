'use strict';
// ── 추첨 효과 (v1.18.0) ─────────────────────────────────────────────────────
// 발단(커뮤니티 피드백, 2026-10-10): "일상용 봇에 NPC 목록·캐릭터 풀을 두고 거주지에 N명, 장소 이동 때 몇 명, 등장 인물 4명 제한 같은 걸
// 변수로 하는데, 거주지 N명 로스터를 처음 만들 때 기존 방식은 가챠풀(랜덤 이벤트 표)이라 같은 이름을 수백 번 넣게 된다".
// 목록 효과의 add는 글자 그대로라 추첨이 없었다 — 이 모듈이 그 자리다. 설계 docs/design-추첨.md.
//
// - 후보 풀 = 최상위 pools[] { id, label?, items: [{ name, weight?, group? } | '이름'], groups?: { 그룹: { affinity?, max? } } } — 스키마(안 변하는 것).
//   뽑힌 목록 = list 변수(플레이 흔적). 이름은 풀에 있는 것만 — 엔진이 쓰고 LLM은 안 낀다.
// - 효과 { sample: 풀id | list 변수id, into: list 변수, n: 수|식, leader?: text/enum 변수, exclude?: list 변수, append?: bool, stable?: bool }
//   sample이 list 변수면 그 목록의 항목이 후보(가중치·그룹은 풀들에서 이름으로 찾는다 — "로스터 30명 중 지금 자리에 4명").
// - 추첨 = 가중 비복원 순차. 하나 뽑을 때마다 같은 그룹 후보의 가중치 × affinity(1 위면 함께 뽑히기 쉽고 아래면 어렵다), 그룹 max에 닿으면
//   그 그룹은 0. 확률 보정이지 강제 묶음이 아니다. 총 가중치가 0이면 거기서 멈춘다(n보다 적게 뽑힐 수 있다). 가중치 0은 안 뽑힌다.
// - 난수: stable true = 고정(시드 — 리롤해도 같은 명단), false = 리롤마다 새로(자유), 없음 = 전역 rerollStableRng를 따른다.
//   세션이 rng에 .stable/.free를 달아 준다(session._rng). 안 달려 있으면(진단 시뮬·직접 호출) 받은 rng 그대로 — 진단은 결정적이어야 한다.
// - leader = 첫 당첨(이미 무작위)을 text/enum 변수에. enum이면 그 값이 enum에 있을 때만 쓴다(검증이 풀 이름 전부를 대조).
// - append = 있는 항목 뒤에 덧붙인다(이미 있는 이름·exclude 목록의 이름은 안 뽑는다). 아니면 into를 통째로 새 명단으로 바꾼다.
// - into의 maxItems를 넘지 않는다(append면 남은 칸만큼).
// 이 모듈은 리수도 DOM도 모른다 — expr만 쓴다.

const { evaluate } = require('./expr');

const ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const EFFECT_KEYS = ['sample', 'into', 'n', 'leader', 'exclude', 'stable', 'append'];
const POOL_KEYS = ['id', 'label', 'items', 'groups'];
const ITEM_KEYS = ['name', 'weight', 'group'];
const GROUP_KEYS = ['affinity', 'max'];
const LIMITS = { pools: 40, items: 400, nameChars: 60 };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isSampleEffect = (rule) => isObj(rule) && rule.sample !== undefined;

/** 후보 하나 — 문자열이면 이름만(가중치 1). 이름이 없으면 null */
function normItem(raw) {
  if (typeof raw === 'string') { const name = raw.trim(); return name ? { name, weight: 1 } : null; }
  if (!isObj(raw)) return null;
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  const w = raw.weight == null ? 1 : Number(raw.weight);
  const it = { name, weight: Number.isFinite(w) && w >= 0 ? w : 1 };
  const g = raw.group == null ? '' : String(raw.group).trim();
  if (g) it.group = g;
  return it;
}

/** 풀 설정 — 너그럽게(엔진·편집기용). 엄격한 검사는 validatePools */
function poolsConfig(schema) {
  const raw = Array.isArray(schema?.pools) ? schema.pools : [];
  const out = [];
  for (const p of raw) {
    if (!isObj(p) || typeof p.id !== 'string' || !ID_RE.test(p.id)) continue;
    const items = (Array.isArray(p.items) ? p.items : []).map(normItem).filter(Boolean);
    const groups = {};
    if (isObj(p.groups)) {
      for (const [g, cfg] of Object.entries(p.groups)) {
        if (!isObj(cfg)) continue;
        const o = {};
        if (cfg.affinity != null && Number.isFinite(Number(cfg.affinity)) && Number(cfg.affinity) >= 0) o.affinity = Number(cfg.affinity);
        if (cfg.max != null && Number.isFinite(Number(cfg.max)) && Number(cfg.max) >= 0) o.max = Math.floor(Number(cfg.max));
        groups[g] = o;
      }
    }
    out.push({ id: p.id, label: typeof p.label === 'string' ? p.label : '', items, groups });
  }
  return out;
}

/** 풀별 이름 목록 (검증용) */
function poolNames(schema) {
  return new Map(poolsConfig(schema).map((p) => [p.id, p.items.map((it) => it.name)]));
}

/** 후보와 그룹 설정 — sample이 풀 id면 그 풀, list 변수면 그 목록의 항목(가중치·그룹은 풀들에서 이름으로) */
function candidatesFor(schema, vars, rule) {
  const pools = poolsConfig(schema);
  const pool = pools.find((p) => p.id === rule.sample);
  if (pool) return { cands: pool.items.slice(), groups: pool.groups };
  const list = Array.isArray(vars?.[rule.sample]) ? vars[rule.sample] : [];
  const byName = new Map();
  const groups = {};
  for (const p of pools) {
    for (const it of p.items) if (!byName.has(it.name)) byName.set(it.name, it);
    Object.assign(groups, p.groups);
  }
  const seen = new Set();
  const cands = [];
  for (const raw of list) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    cands.push(byName.get(name) || { name, weight: 1 });
  }
  return { cands, groups };
}

/** 가중 비복원 순차 추첨 — 같은 그룹이 이미 뽑혔으면 × affinity, max에 닿으면 0. 총 가중치 0이면 멈춘다 */
function drawSample(cands, n, groups, rng) {
  const picked = [];
  const count = {};
  const left = cands.slice();
  while (picked.length < n && left.length) {
    const ws = left.map((c) => {
      let w = Math.max(0, Number(c.weight ?? 1) || 0);
      const cfg = c.group ? groups?.[c.group] : null;
      if (cfg) {
        const have = count[c.group] || 0;
        if (cfg.max != null && have >= cfg.max) w = 0;
        else if (have > 0 && cfg.affinity != null) w *= cfg.affinity;
      }
      return w;
    });
    const total = ws.reduce((a, b) => a + b, 0);
    if (!(total > 0)) break;
    let r = rng() * total;
    let i = 0;
    for (; i < ws.length; i++) { r -= ws[i]; if (r < 0) break; }
    if (i >= ws.length) { i = ws.length - 1; while (i > 0 && !(ws[i] > 0)) i--; }
    const c = left.splice(i, 1)[0];
    picked.push(c.name);
    if (c.group) count[c.group] = (count[c.group] || 0) + 1;
  }
  return picked;
}

/** stable 칸에 따라 난수 고르기 — 세션이 rng.stable/rng.free를 달아 준다. 없으면 받은 것 */
function pickRng(rng, stable) {
  if (stable === true) return (rng && rng.stable) || rng;
  if (stable === false) return (rng && rng.free) || rng;
  return rng;
}

/** 효과 적용 — 바뀐 것은 changeLog에 { id, from, to, source }. 대상이 목록 변수가 아니면 아무것도 안 한다(검증 몫) */
function applySampleEffect(schema, state, rule, lookup, rng, changeLog, source) {
  const varById = Object.fromEntries((schema.vars || []).map((v) => [v.id, v]));
  const into = varById[rule.into];
  if (!into || into.type !== 'list') return;
  const r = pickRng(rng, rule.stable) || Math.random;
  let n;
  if (typeof rule.n === 'number') n = rule.n;
  else { try { n = Number(evaluate(String(rule.n ?? 1), lookup, r)); } catch { n = 0; } }
  n = Number.isFinite(n) ? Math.floor(n) : 0;
  const current = Array.isArray(state.vars[rule.into]) ? state.vars[rule.into] : [];
  const excl = new Set();
  if (rule.exclude && Array.isArray(state.vars[rule.exclude])) for (const x of state.vars[rule.exclude]) excl.add(String(x));
  if (rule.append) for (const x of current) excl.add(String(x));
  const { cands, groups } = candidatesFor(schema, state.vars, rule);
  const pool = cands.filter((c) => !excl.has(c.name));
  if (into.maxItems != null) n = Math.min(n, Math.max(0, Number(into.maxItems) - (rule.append ? current.length : 0)));
  const picked = n > 0 ? drawSample(pool, n, groups, r) : [];
  const to = rule.append ? [...current, ...picked] : picked;
  if (JSON.stringify(to) !== JSON.stringify(current)) {
    state.vars[rule.into] = to;
    if (changeLog) changeLog.push({ id: rule.into, from: current, to, source });
  }
  if (rule.leader && picked.length) {
    const def = varById[rule.leader];
    if (def && (def.type === 'text' || def.type === 'enum')) {
      const v = picked[0];
      if (def.type !== 'enum' || (Array.isArray(def.enum) && def.enum.includes(v))) {
        const from = state.vars[rule.leader];
        if (v !== from) { state.vars[rule.leader] = v; if (changeLog) changeLog.push({ id: rule.leader, from, to: v, source }); }
      }
    }
  }
}

/** 효과 한 줄이 건드리는 변수 — 진단(writerMap)·편집기 삭제 영향 */
function effectTargets(rule) {
  if (!isSampleEffect(rule)) return [];
  return [rule.into, rule.leader].filter((x) => typeof x === 'string' && x);
}

/** 검증 — pools (엄격). ctx = { err, warn, ids(변수·파생 id Set) } */
function validatePools(schema, ctx) {
  const { err, warn, ids } = ctx;
  if (schema.pools == null) return;
  if (!Array.isArray(schema.pools)) { err('$.pools', 'pools는 배열이어야 함 — [{ id, items: [{ name, weight?, group? }], groups? }]'); return; }
  const seen = new Set();
  if (schema.pools.length > LIMITS.pools) err('$.pools', `후보 풀은 ${LIMITS.pools}개까지`);
  schema.pools.forEach((p, i) => {
    const pp = `$.pools[${i}]`;
    if (!isObj(p)) { err(pp, '후보 풀은 객체여야 함'); return; }
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) err(pp, `잘못된 풀 id: '${p.id}' (영문자로 시작, 영문·숫자·_만)`);
    else {
      if (seen.has(p.id)) err(pp, `중복 풀 id: '${p.id}'`);
      seen.add(p.id);
      if (ids && ids.has(p.id)) err(pp, `풀 id '${p.id}'가 변수·파생 id와 겹칩니다 — 추첨 효과의 sample이 풀인지 목록인지 가를 수 없습니다`);
    }
    for (const k of Object.keys(p)) if (!POOL_KEYS.includes(k) && !k.startsWith('_')) warn(pp, `알 수 없는 키 '${k}' — 엔진이 읽지 않습니다 (후보 풀이 쓰는 키: ${POOL_KEYS.join(', ')})`);
    if (p.label != null && typeof p.label !== 'string') err(pp, 'label은 문자열');
    if (!Array.isArray(p.items)) { err(pp, 'items는 배열이어야 함 — [{ name, weight?, group? }] 또는 이름 문자열'); return; }
    if (!p.items.length) warn(pp, '후보가 없습니다 — 이 풀로는 아무것도 안 뽑힙니다');
    if (p.items.length > LIMITS.items) err(pp, `후보는 ${LIMITS.items}개까지`);
    const names = new Set();
    const groupsUsed = new Set();
    p.items.forEach((it, j) => {
      const ip = `${pp}.items[${j}]`;
      if (typeof it === 'string') {
        const nm = it.trim();
        if (!nm) err(ip, '이름이 비어 있습니다');
        else if (names.has(nm)) err(ip, `중복 후보: '${nm}'`);
        names.add(nm);
        return;
      }
      if (!isObj(it)) { err(ip, '후보는 { name, weight?, group? } 또는 이름 문자열'); return; }
      for (const k of Object.keys(it)) if (!ITEM_KEYS.includes(k) && !k.startsWith('_')) warn(ip, `알 수 없는 키 '${k}' (후보가 쓰는 키: ${ITEM_KEYS.join(', ')})`);
      const name = String(it.name ?? '').trim();
      if (!name) { err(ip, 'name(이름)이 비어 있습니다'); return; }
      if (name.length > LIMITS.nameChars) warn(ip, `이름이 ${LIMITS.nameChars}자를 넘습니다 — 목록 항목으로 길어요`);
      if (names.has(name)) err(ip, `중복 후보: '${name}'`);
      names.add(name);
      if (it.weight != null && (!Number.isFinite(Number(it.weight)) || Number(it.weight) < 0)) err(ip, `weight는 0 이상 숫자 (현재: '${it.weight}')`);
      if (it.group != null) { if (typeof it.group !== 'string' || !it.group.trim()) err(ip, 'group은 비지 않은 문자열'); else groupsUsed.add(it.group.trim()); }
    });
    if (p.groups != null) {
      if (!isObj(p.groups)) err(pp, 'groups는 { 그룹이름: { affinity?, max? } } 객체');
      else {
        for (const [g, cfg] of Object.entries(p.groups)) {
          const gp = `${pp}.groups.${g}`;
          if (!isObj(cfg)) { err(gp, '그룹 설정은 { affinity?, max? } 객체'); continue; }
          for (const k of Object.keys(cfg)) if (!GROUP_KEYS.includes(k) && !k.startsWith('_')) warn(gp, `알 수 없는 키 '${k}' (그룹이 쓰는 키: ${GROUP_KEYS.join(', ')})`);
          if (cfg.affinity != null && (!Number.isFinite(Number(cfg.affinity)) || Number(cfg.affinity) < 0))
            err(gp, `affinity는 0 이상 숫자 — 1보다 크면 함께 뽑히기 쉽고, 작으면 어렵다 (현재: '${cfg.affinity}')`);
          if (cfg.max != null && (!Number.isInteger(Number(cfg.max)) || Number(cfg.max) < 0))
            err(gp, `max는 0 이상 정수 — 그 그룹에서 뽑히는 상한 (현재: '${cfg.max}')`);
          if (!groupsUsed.has(g)) warn(gp, `'${g}' 그룹에 속한 후보가 없습니다`);
        }
      }
    }
  });
}

/** 검증 — 효과 한 줄. ctx = { err, warn, listIds, poolIds, poolNames(Map), varDefs(Map id→def), checkExpr(src, path) } */
function validateSampleEffect(rule, p, ctx) {
  const { err, warn, listIds, poolIds, varDefs, checkExpr } = ctx;
  for (const k of Object.keys(rule)) {
    if (EFFECT_KEYS.includes(k) || k.startsWith('_')) continue;
    if (['set', 'list', 'front', 'gauge', 'checkpoint'].includes(k)) err(p, `sample 효과에 ${k}를 같이 쓸 수 없음 — 효과를 두 줄로 나누세요`);
    else warn(p, `알 수 없는 키 '${k}' (추첨 효과가 쓰는 키: ${EFFECT_KEYS.join(', ')})`);
  }
  const src = rule.sample;
  const fromPool = typeof src === 'string' && poolIds.has(src);
  const fromList = typeof src === 'string' && listIds.has(src);
  if (!fromPool && !fromList) {
    err(p + '.sample', `sample '${src}'은 후보 풀(pools) id도 목록(list) 변수도 아님${poolIds.size ? ` (풀: ${[...poolIds].join(', ')})` : ' — 최상위 pools[]에 풀을 만드세요'}`);
  }
  if (typeof rule.into !== 'string' || !listIds.has(rule.into)) err(p + '.into', `into '${rule.into}'은 목록(list) 변수가 아님 — 뽑힌 이름이 들어갈 list 변수`);
  else if (fromList && rule.into === src && rule.append) warn(p, 'sample과 into가 같은 목록인데 append — 이미 있는 이름은 안 뽑으니 아무것도 안 늘어납니다');
  if (rule.n == null || rule.n === '') err(p + '.n', 'n(뽑을 개수)이 필요함 — 숫자 또는 식');
  else if (typeof rule.n === 'number') { if (!Number.isInteger(rule.n) || rule.n < 0) err(p + '.n', `n은 0 이상 정수 (현재: ${rule.n})`); }
  else if (typeof rule.n === 'string') checkExpr(rule.n, p + '.n');
  else err(p + '.n', 'n은 숫자 또는 식 문자열');
  if (rule.leader != null) {
    const def = varDefs.get(rule.leader);
    if (!def || !['text', 'enum'].includes(def.type)) err(p + '.leader', `leader '${rule.leader}'은 text 또는 enum 변수여야 함 (첫 당첨 이름이 들어간다)`);
    else if (def.type === 'enum' && fromPool && ctx.poolNames) {
      const miss = (ctx.poolNames.get(src) || []).filter((nm) => !(def.enum || []).includes(nm));
      if (miss.length) err(p + '.leader', `leader enum '${rule.leader}'에 풀 '${src}'의 후보가 없음: ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? ' …' : ''}`);
    } else if (def.type === 'enum' && fromList) warn(p + '.leader', 'leader가 enum인데 후보가 목록 변수라 값이 enum에 있는지 미리 못 봅니다 — 없으면 그 턴엔 안 바뀝니다');
  }
  if (rule.exclude != null && (typeof rule.exclude !== 'string' || !listIds.has(rule.exclude))) err(p + '.exclude', `exclude '${rule.exclude}'은 목록(list) 변수가 아님`);
  if (rule.stable != null && typeof rule.stable !== 'boolean') err(p + '.stable', 'stable은 true(고정)/false(리롤마다 새로) — 비우면 전역 설정');
  if (rule.append != null && typeof rule.append !== 'boolean') err(p + '.append', 'append는 true/false');
}

module.exports = {
  EFFECT_KEYS, POOL_KEYS, ITEM_KEYS, GROUP_KEYS, LIMITS,
  isSampleEffect, normItem, poolsConfig, poolNames, candidatesFor, drawSample, pickRng, applySampleEffect, effectTargets,
  validatePools, validateSampleEffect,
};
