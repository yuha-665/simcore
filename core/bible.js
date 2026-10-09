'use strict';
// ── 봇 제작 설정집 (v1.16.0) ─────────────────────────────────────────────
// 설계: docs/design-봇제작-대화.md. 발단(유저, 2026-10-10): "봇 제작 보조 유틸인데 아예 봇 제작에 쓸 수 없냐고 하는 사람들이
// 있다 — 로어북·캐릭터 시트를 일일이 손작업하고, 제작 위치가 리수 봇 컨텍스트에서 OOC로 주고받는 식뿐이라".
//
// 설정집(bible) = 대화로 정리해 가는 **구조화된 중간 작업본**. 로어북·캐릭터 시트는 이것을 컴파일한 결과다.
// 대화 이력에 설정을 누적하면 몇 턴 안에 컨텍스트가 터지므로, 스키마 작업본처럼 설정집을 객체로 들고 매 턴 다이제스트로 싣는다.
//
// 1단계(이 판)는 **쓰기 없음** — 로어북 JSON(리수 가져오기 형식)·캐릭터 시트를 복사/내려받기로 내보낸다. 캐릭터 객체에는 글자 하나
// 안 쓴다. 2단계(항목 단위 적용·백업)·3단계(설명·정규식)는 설계 문서 §단계.
//
// 심코어식 분담이 이 도구의 차별점이다 (memory simcore-bot-design): 로어북 = 안 변하는 것(설정·이유·어휘), 변수 = 플레이가 남긴 흔적.
// 설정집을 받으면 로어북에 갈 것과 심코어(변수·이벤트·비밀…)로 갈 것을 `sim` 목록으로 나눠 준다 — 그 목록은 💬 어시스턴트에게
// 요청문으로 넘긴다.
//
// 이 모듈은 순수 함수만 — 리수도, DOM도, 다른 코어 모듈도 모른다 (편집기가 쓰고 테스트가 단독으로 부른다).
//
// v1.17.0 (유저 제안, 실기 스샷 "흠 잘 불러오네" 뒤): ① 📁 로어북 폴더 — 리수 로어북의 그룹. folders[{id,name,key?}] + sections[].folder.
// 리수 폴더 = mode:'folder' 항목(key 머리 FOLDER_KEY_PREFIX) + 자식의 folder(=그 key)이고 가져오기가 그대로 push하니 JSON에 폴더째 실린다.
// ② 🪪 시트 형식(OOC 명령어) — 사용자가 붙여 넣은 양식대로 sheet.desc를 쓴다(기기 공통, 편집기 prefs). ③ 📥 캐릭 설정집 원문 적재 — source.

const BIBLE_V = 1;
const KINDS = ['world', 'character', 'place', 'faction', 'rule', 'term', 'plot', 'style', 'other'];
const KIND_LABEL = { world: '세계', character: '인물', place: '장소', faction: '세력', rule: '규칙', term: '용어', plot: '줄거리', style: '문체', other: '기타' };
const SIM_HOW = ['변수', '이벤트', '액션', '판정', '비밀', '무대 뒤', '시나리오', '갈림길', '기타'];
const LIMITS = { sections: 80, keys: 24, keyChars: 40, nameChars: 80, bodyChars: 6000, sheetChars: 8000, sim: 40, simChars: 300, premiseChars: 600, folders: 24, sourceChars: 40000, sheetFormatChars: 6000 };
const SOURCE_CAP = 48 * 1024;   // 바이트 — 적재한 원문을 프롬프트에 싣는 상한 (넘치면 앞부분만 + 표시. v1.17.0)
const FOLDER_KEY_PREFIX = String.fromCharCode(0xf000) + 'folder:';   // 리수 로어북 폴더 항목의 key 머리 (database.svelte.ts addLorebookFolder — 자식은 folder: <그 key>)
const DIGEST_CAP = 24 * 1024;   // 바이트 — 시스템 프롬프트에 싣는 설정집 상한 (본문은 앞 항목부터, 넘치면 id만)
const UPDATE_KEYS = ['title', 'premise', 'folders', 'sections', 'remove', 'sheet', 'sim'];
const SECTION_KEYS = ['id', 'kind', 'name', 'keys', 'always', 'body', 'order', 'folder'];
const FOLDER_KEYS = ['id', 'name', 'key'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);
const str = (v, n) => clip(typeof v === 'string' ? v : (v == null ? '' : String(v)), n);
// ⚠ 브라우저에는 Buffer가 없다 (v1.16.1 실사고 — 봇 제작 층이 ReferenceError로 비었다). TextEncoder는 노드·브라우저 둘 다 있다.
const byteLen = (s) => new TextEncoder().encode(String(s)).length;

function slugify(name, fallback = 'sec') {
  const s = String(name ?? '').toLowerCase().replace(/[^a-z0-9가-힣_-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || fallback;
}

function emptyBible() {
  // folders(v1.17.0) = 로어북 폴더 [{ id, name, key? }] — key가 있으면 리수에 이미 있는 폴더(그 안으로 들어간다), 없으면 내보낼 때 새 폴더를 만든다.
  // source/sourceOn(v1.17.0) = 사용자가 붙여 넣은 캐릭 설정집 원문과 동봉 여부 — AI 수정안으로는 못 바꾼다(UPDATE_KEYS 밖).
  return { v: BIBLE_V, title: '', premise: '', folders: [], sections: [], sheet: { name: '', desc: '', first: '' }, sim: [], source: '', sourceOn: true };
}

/** 낱말 목록 — 배열이든 쉼표 문자열이든 받는다. 빈 것·중복 제거, 상한 */
function normKeys(v) {
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[,\n]/) : []);
  const out = [];
  for (const k of arr) {
    const t = str(k, LIMITS.keyChars).trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= LIMITS.keys) break;
  }
  return out;
}

function normSection(raw, used) {
  if (!isObj(raw)) return null;
  const name = str(raw.name, LIMITS.nameChars).trim();
  let id = slugify(raw.id != null && String(raw.id).trim() ? raw.id : name, '');
  if (!id) return null;
  if (used) { let base = id, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); }
  const order = Number.isInteger(raw.order) ? raw.order : undefined;
  const folder = raw.folder != null && String(raw.folder).trim() ? slugify(raw.folder, '') : '';
  return {
    id, kind: KINDS.includes(raw.kind) ? raw.kind : 'other', name: name || id,
    keys: normKeys(raw.keys), always: raw.always === true, body: str(raw.body, LIMITS.bodyChars),
    ...(order !== undefined ? { order } : {}),
    ...(folder ? { folder } : {}),
  };
}

/** 로어북 폴더 하나 (v1.17.0) — id(슬러그)·name·key(리수에 이미 있는 폴더면 그 key — 머리가 FOLDER_KEY_PREFIX일 때만 믿는다) */
function normFolder(raw, used) {
  if (!isObj(raw)) return null;
  const name = str(raw.name, LIMITS.nameChars).trim();
  let id = slugify(raw.id != null && String(raw.id).trim() ? raw.id : name, '');
  if (!id) return null;
  if (used) { let base = id, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); }
  const key = typeof raw.key === 'string' && raw.key.startsWith(FOLDER_KEY_PREFIX) ? raw.key : '';
  return { id, name: name || id, ...(key ? { key } : {}) };
}

function normSim(raw) {
  if (!isObj(raw)) return null;
  const what = str(raw.what, LIMITS.simChars).trim();
  if (!what) return null;
  return { what, how: SIM_HOW.includes(raw.how) ? raw.how : '기타', why: str(raw.why, LIMITS.simChars).trim() };
}

/** 저장소·AI에서 온 것을 믿지 않는다 — 모양을 맞추고 상한을 자른다. 절대 던지지 않는다 */
function normalizeBible(raw) {
  const b = emptyBible();
  if (!isObj(raw)) return b;
  b.title = str(raw.title, LIMITS.nameChars).trim();
  b.premise = str(raw.premise, LIMITS.premiseChars).trim();
  const usedF = new Set();
  for (const f of Array.isArray(raw.folders) ? raw.folders : []) {
    const fo = normFolder(f, usedF);
    if (fo) b.folders.push(fo);
    if (b.folders.length >= LIMITS.folders) break;
  }
  const used = new Set();
  for (const s of Array.isArray(raw.sections) ? raw.sections : []) {
    const sec = normSection(s, used);
    if (sec) b.sections.push(sec);
    if (b.sections.length >= LIMITS.sections) break;
  }
  const folderIds = new Set(b.folders.map((f) => f.id));
  for (const s of b.sections) if (s.folder && !folderIds.has(s.folder)) delete s.folder;   // 없는 폴더를 가리키면 조용히 폴더 밖으로
  if (isObj(raw.sheet)) {
    b.sheet.name = str(raw.sheet.name, LIMITS.nameChars).trim();
    b.sheet.desc = str(raw.sheet.desc, LIMITS.sheetChars);
    b.sheet.first = str(raw.sheet.first, LIMITS.sheetChars);
  }
  for (const s of Array.isArray(raw.sim) ? raw.sim : []) {
    const it = normSim(s);
    if (it) b.sim.push(it);
    if (b.sim.length >= LIMITS.sim) break;
  }
  b.source = str(raw.source, LIMITS.sourceChars);
  b.sourceOn = raw.sourceOn !== false;
  return b;
}

function bibleIsBlank(b) {
  return !b || (!b.sections.length && !b.premise && !b.title && !b.sheet.desc && !b.sheet.first && !b.sim.length && !(b.folders || []).length && !String(b.source || '').trim());
}

/**
 * AI가 붙인 수정안을 설정집에 적용 — 패치 규율(섹션은 id로 덮어쓰기, 안 보낸 것은 그대로). 거부되면 설정집은 안 변한다.
 * upd = { bible: {...} } 또는 {...} 직접. 돌려주는 것: { ok, bible, errors, summary }
 */
function applyBibleUpdate(bible, upd) {
  const errors = [];
  let u = upd;
  if (isObj(u) && isObj(u.bible)) u = u.bible;
  if (!isObj(u)) return { ok: false, errors: ['수정안은 { "bible": { … } } 객체여야 합니다'], bible, summary: '' };
  for (const k of Object.keys(u)) if (!UPDATE_KEYS.includes(k)) errors.push(`알 수 없는 키 '${k}' (쓸 수 있는 키: ${UPDATE_KEYS.join(', ')})`);
  const next = normalizeBible(bible);
  const stats = { add: 0, upd: 0, del: 0, sheet: false, sim: null, head: false, folders: 0 };

  if (u.title !== undefined) { if (typeof u.title !== 'string') errors.push('title은 문자열'); else { next.title = str(u.title, LIMITS.nameChars).trim(); stats.head = true; } }
  if (u.premise !== undefined) { if (typeof u.premise !== 'string') errors.push('premise는 문자열'); else { next.premise = str(u.premise, LIMITS.premiseChars).trim(); stats.head = true; } }

  if (u.folders !== undefined) {   // 📁 폴더 (v1.17.0) — id로 덮어쓰기(이름만), 없으면 추가. key(리수에 있는 폴더)는 AI가 못 정한다 — 사용자가 가져온다
    if (!Array.isArray(u.folders)) errors.push('folders는 { id, name } 배열');
    else u.folders.forEach((raw, i) => {
      if (!isObj(raw)) { errors.push(`folders[${i}]는 객체여야 합니다`); return; }
      for (const k of Object.keys(raw)) if (!FOLDER_KEYS.includes(k) || k === 'key') errors.push(`folders[${i}] 알 수 없는 키 '${k}' (쓸 수 있는 키: id, name)`);
      const id = raw.id != null && String(raw.id).trim() ? slugify(raw.id, '') : slugify(raw.name, '');
      if (!id) { errors.push(`folders[${i}]에 id도 name도 없습니다`); return; }
      const cur = next.folders.find((f) => f.id === id);
      if (cur) { if (raw.name !== undefined) cur.name = str(raw.name, LIMITS.nameChars).trim() || cur.name; stats.folders++; return; }
      if (!String(raw.name ?? '').trim()) { errors.push(`folders[${i}] 새 폴더 '${id}'에 name이 없습니다`); return; }
      if (next.folders.length >= LIMITS.folders) { errors.push(`폴더가 ${LIMITS.folders}개를 넘습니다`); return; }
      const fo = normFolder({ id, name: raw.name }, null);
      if (fo) { next.folders.push(fo); stats.folders++; }
    });
  }
  if (u.sections !== undefined) {
    if (!Array.isArray(u.sections)) errors.push('sections는 배열');
    else u.sections.forEach((raw, i) => {
      if (!isObj(raw)) { errors.push(`sections[${i}]는 객체여야 합니다`); return; }
      for (const k of Object.keys(raw)) if (!SECTION_KEYS.includes(k)) errors.push(`sections[${i}] 알 수 없는 키 '${k}' (쓸 수 있는 키: ${SECTION_KEYS.join(', ')})`);
      if (raw.kind !== undefined && !KINDS.includes(raw.kind)) errors.push(`sections[${i}] kind '${raw.kind}'는 없는 종류 (${KINDS.join(' | ')})`);
      if (raw.body !== undefined && typeof raw.body !== 'string') errors.push(`sections[${i}] body는 문자열`);
      if (raw.keys !== undefined && !Array.isArray(raw.keys) && typeof raw.keys !== 'string') errors.push(`sections[${i}] keys는 문자열 배열`);
      if (raw.always !== undefined && typeof raw.always !== 'boolean') errors.push(`sections[${i}] always는 true/false`);
      if (raw.folder != null && String(raw.folder).trim() && !next.folders.some((f) => f.id === slugify(raw.folder, ''))) errors.push(`sections[${i}] folder '${raw.folder}'는 없는 폴더 (있는 폴더: ${next.folders.map((f) => f.id).join(', ') || '없음'} — 먼저 folders에 추가)`);
      const id = raw.id != null && String(raw.id).trim() ? slugify(raw.id, '') : slugify(raw.name, '');
      if (!id) { errors.push(`sections[${i}]에 id도 name도 없습니다`); return; }
      const cur = next.sections.find((s) => s.id === id);
      if (cur) {
        if (raw.name !== undefined) cur.name = str(raw.name, LIMITS.nameChars).trim() || cur.name;
        if (raw.kind !== undefined && KINDS.includes(raw.kind)) cur.kind = raw.kind;
        if (raw.keys !== undefined) cur.keys = normKeys(raw.keys);
        if (raw.always !== undefined) cur.always = raw.always === true;
        if (typeof raw.body === 'string') cur.body = str(raw.body, LIMITS.bodyChars);
        if (Number.isInteger(raw.order)) cur.order = raw.order;
        if (raw.folder !== undefined) { const fid = raw.folder != null && String(raw.folder).trim() ? slugify(raw.folder, '') : ''; if (fid) cur.folder = fid; else delete cur.folder; }
        stats.upd++;
      } else {
        if (!String(raw.name ?? '').trim()) { errors.push(`sections[${i}] 새 항목 '${id}'에 name이 없습니다`); return; }
        if (next.sections.length >= LIMITS.sections) { errors.push(`항목이 ${LIMITS.sections}개를 넘습니다`); return; }
        const sec = normSection({ ...raw, id }, null);
        if (sec) { next.sections.push(sec); stats.add++; }
      }
    });
  }
  if (u.remove !== undefined) {
    if (!Array.isArray(u.remove)) errors.push('remove는 id 배열');
    else for (const r of u.remove) {
      const id = slugify(r, '');
      const i = next.sections.findIndex((s) => s.id === id);
      if (i < 0) errors.push(`remove: 없는 항목 '${r}'`);
      else { next.sections.splice(i, 1); stats.del++; }
    }
  }
  if (u.sheet !== undefined) {
    if (!isObj(u.sheet)) errors.push('sheet는 객체 { name, desc, first }');
    else {
      for (const k of Object.keys(u.sheet)) if (!['name', 'desc', 'first'].includes(k)) errors.push(`sheet 알 수 없는 키 '${k}' (name, desc, first)`);
      for (const k of ['name', 'desc', 'first']) if (u.sheet[k] !== undefined) {
        if (typeof u.sheet[k] !== 'string') errors.push(`sheet.${k}는 문자열`);
        else { next.sheet[k] = k === 'name' ? str(u.sheet[k], LIMITS.nameChars).trim() : str(u.sheet[k], LIMITS.sheetChars); stats.sheet = true; }
      }
    }
  }
  if (u.sim !== undefined) {
    if (!Array.isArray(u.sim)) errors.push('sim은 { what, how, why } 배열');
    else {
      const list = [];
      u.sim.forEach((raw, i) => {
        if (!isObj(raw)) { errors.push(`sim[${i}]는 객체`); return; }
        if (raw.how !== undefined && !SIM_HOW.includes(raw.how)) errors.push(`sim[${i}] how '${raw.how}'는 없는 종류 (${SIM_HOW.join(' | ')})`);
        const it = normSim(raw);
        if (!it) { errors.push(`sim[${i}]에 what이 없습니다`); return; }
        if (list.length < LIMITS.sim) list.push(it);
      });
      next.sim = list; stats.sim = list.length;
    }
  }
  if (errors.length) return { ok: false, errors, bible, summary: '' };
  const parts = [];
  if (stats.add) parts.push(`항목 추가 ${stats.add}`);
  if (stats.upd) parts.push(`교체 ${stats.upd}`);
  if (stats.del) parts.push(`삭제 ${stats.del}`);
  if (stats.folders) parts.push(`폴더 ${stats.folders}`);
  if (stats.head) parts.push('제목·전제');
  if (stats.sheet) parts.push('캐릭터 시트');
  if (stats.sim != null) parts.push(`심코어 분담 ${stats.sim}`);
  return { ok: true, errors: [], bible: next, summary: parts.join(' · ') || '변화 없음' };
}

/** 설정집 다이제스트 — 시스템 프롬프트에 매 턴 싣는다. 머리·항목 머리줄은 전부, 본문은 상한 안에서 앞 항목부터 */
function bibleDigest(bible, cap = DIGEST_CAP) {
  const b = normalizeBible(bible);
  const out = ['## 설정집 — 지금까지 정리된 것 (이것이 작업본입니다. 수정안은 이 id를 기준으로)'];
  if (b.title) out.push(`제목: ${b.title}`);
  if (b.premise) out.push(`전제: ${b.premise}`);
  if (b.folders.length) out.push(`로어북 폴더 (sections[].folder에 id로): ${b.folders.map((f) => `${f.name}(${f.id})${f.key ? ' · 리수에 있음' : ''}`).join(' · ')}`);
  if (!b.sections.length) out.push('(항목 없음 — 아직 아무것도 정리되지 않았습니다)');
  let used = byteLen(out.join('\n'));
  const bodies = [];
  let omitted = 0;
  for (const s of b.sections) {
    const head = `#### [${s.id}] ${KIND_LABEL[s.kind]} · ${s.name}${s.keys.length ? ` · 낱말: ${s.keys.join(', ')}` : ''}${s.always ? ' · 상시' : ''}${s.folder ? ` · 폴더: ${s.folder}` : ''}`;
    const body = s.body.trim() ? s.body.trim() : '(본문 없음)';
    const cost = byteLen(head) + byteLen(body) + 2;
    if (used + cost > cap) { bodies.push(head + '\n(본문 생략 — 상한)'); omitted++; used += byteLen(head) + 16; continue; }
    bodies.push(head + '\n' + body); used += cost;
  }
  if (b.sections.length) out.push('', '### 항목', ...bodies.flatMap((x) => [x, '']));
  out.push('### 캐릭터 시트',
    `이름: ${b.sheet.name || '(없음)'}`,
    `설명(desc): ${b.sheet.desc.trim() ? (used + byteLen(b.sheet.desc) > cap ? '(있음 — 상한으로 생략)' : '\n' + b.sheet.desc.trim()) : '(없음)'}`,
    `첫 메시지(first): ${b.sheet.first.trim() ? (used + byteLen(b.sheet.first) > cap * 1.2 ? '(있음 — 상한으로 생략)' : '\n' + b.sheet.first.trim()) : '(없음)'}`,
    '', '### 심코어로 갈 것 (sim — 로어북이 아니라 시스템이 쥘 것)',
    ...(b.sim.length ? b.sim.map((x) => `- [${x.how}] ${x.what}${x.why ? ` — ${x.why}` : ''}`) : ['(없음)']));
  return { text: out.join('\n'), omitted };
}

/** 봇 제작 대화 규약 — 시스템 프롬프트 머리 (📌 작업 지침 뒤). 출력 형식과 로어북·분담 규칙 */
function bibleRules() {
  return [
    '## 대화 규약 — 이 대화에서 답하는 방식',
    '- 당신은 RisuAI 캐릭터 봇 제작 어시스턴트입니다. 사용자와 **대화하며** 봇의 설정집을 함께 정리합니다. 답은 먼저 **사람에게 하는 말**(제안·되묻기·정리)입니다.',
    '- 설정집을 **바꿔야 할 때만** 답 끝에 JSON 코드펜스(```json … ```) **하나**를 붙입니다. 논의·질문만이면 붙이지 마세요. 사용자가 "정리해줘·반영해·넣어줘·만들어줘"라고 하면 붙입니다.',
    '- 코드펜스 앞에 무엇을 왜 정리했는지 짧게 적고, 코드펜스 뒤에는 아무 말도 쓰지 않습니다. 모르는 설정은 지어내지 말고 묻되, 한 턴에 질문은 셋 이내.',
    '',
    '### 수정안 형식 (코드펜스 안)',
    '{ "bible": { "title"?: "…", "premise"?: "한 줄 전제", "folders"?: [ { "id": "슬러그", "name": "폴더 이름" } ], "sections"?: [ { "id": "슬러그", "kind": "world|character|place|faction|rule|term|plot|style|other", "name": "이름", "keys": ["낱말", …], "always": false, "folder": "폴더 id (없으면 생략)", "body": "본문" } ], "remove"?: ["id"], "sheet"?: { "name"?: "…", "desc"?: "캐릭터 설명란 글", "first"?: "첫 메시지" }, "sim"?: [ { "what": "무엇", "how": "변수|이벤트|액션|판정|비밀|무대 뒤|시나리오|갈림길|기타", "why": "왜" } ] } }',
    '- sections는 **id로 덮어쓰기**입니다 — 있는 id면 보낸 필드만 교체, 없는 id면 추가. 안 보낸 항목은 그대로 남습니다. 설정집 전체를 다시 보내지 마세요. 지울 때만 remove.',
    '- sim은 보낼 때마다 목록 전체로 교체됩니다. sheet는 보낸 칸만 교체.',
    '- folders는 **로어북 폴더**(리수 로어북의 그룹)입니다 — id로 덮어쓰기(이름만 바뀝니다). 설정집에 폴더가 있으면 새 항목은 알맞은 폴더 id를 folder에 적고, 맞는 폴더가 없으면 folders에 새 폴더를 같이 제안하세요. 없는 폴더 id는 거부됩니다. 사용자가 폴더를 하나도 안 만들었으면 억지로 만들지 마세요.',
    `- kind: ${KINDS.map((k) => `${k}=${KIND_LABEL[k]}`).join(' · ')}`,
    '',
    '### 로어북 항목 쓰는 법 (sections → 리수 로어북 한 항목씩)',
    '- 항목 하나 = 주제 하나(인물 하나·장소 하나·규칙 하나). 본문은 모델이 장면을 쓸 때 읽는 **정보**입니다 — 현재형 사실·관계·말투·금기를 간결하게. 독자용 설명 산문이나 "이 항목은…" 같은 메타 문장은 넣지 않습니다.',
    '- keys(낱말)는 그 본문이 필요한 장면에 **실제로 등장할 말**(이름·별칭·장소명·물건) 2~6개. "그", "집"처럼 흔한 말은 안 됩니다 — 매 턴 걸립니다.',
    '- always(상시)는 세계 전제·문체·핵심 규칙처럼 **늘** 필요한 것에만 true. 상시 항목은 매 턴 토큰을 먹습니다.',
    '- 이미 있는 캐릭터 정보(아래 "현재 캐릭터")가 있으면 그것을 기준으로 보완·정리하고, 같은 내용을 새 항목으로 복제하지 않습니다.',
    '',
    '### 심코어식 분담 — 로어북에 적으면 안 되는 것',
    '- **로어북 = 안 변하는 것**(설정·이유·어휘·관계의 바탕). **플레이가 바꾸는 것**(호감·소지금·체력·관계 단계·진행도·날짜·"현재 ~한 상태")은 로어북에 적지 말고 sim 목록에 { what, how, why }로 올립니다 — 심코어가 변수·이벤트·액션·판정으로 쥐고 상태창에 보여 줍니다.',
    '- 본문에 "At the start…", "처음엔…", "현재…"가 들어가면 그건 변수 자리입니다. 문장으로 적지 말고 sim으로 보내세요.',
    '- **밝혀지기 전엔 모델이 몰라야 하는 것**(정체·반전·숨은 과거)은 로어북에 적으면 샙니다. sim에 how="비밀"로 올리고 로어북 본문에는 "숨기는 사람"의 행동만 적습니다.',
    '- 유저가 안 보는 사이 진행되는 음모·세력의 움직임은 how="무대 뒤", 장(막) 단위 전개는 how="시나리오", 상황별 선택지는 how="갈림길".',
    '',
    '### 캐릭터 시트 (sheet)',
    '- desc = 리수 캐릭터 설명란에 넣을 글: 인물 핵심·외양·말투·관계·금기. 상태 숫자·현재 상황은 적지 않습니다(심코어 상태창이 보여 줍니다). first = 첫 메시지 초안(장면·말투 견본). 사용자가 달라고 할 때 채웁니다.',
    '- 아래에 "캐릭터 시트 형식"이 있으면 desc는 **그 형식의 항목·순서·어조를 그대로** 따릅니다(형식 안의 지시문은 시트를 쓰는 법이지 사용자에게 할 말이 아닙니다). "적재한 원문"이 있으면 그것이 정리의 재료입니다 — 설정집에 아직 없는 것을 항목으로 정리하고 시트를 쓸 때도 참고하되, 이미 정리된 설정집과 겹치면 설정집을 기준으로.',
    '',
  ];
}

/** 새 폴더 key — 리수 addLorebookFolder와 같은 모양(FOLDER_KEY_PREFIX + uuid v4). crypto.randomUUID은 브라우저·Node 19+ 둘 다 있다 */
function newFolderKey() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  const u = c && typeof c.randomUUID === 'function' ? c.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = (Math.random() * 16) | 0; return (ch === 'x' ? r : ((r & 3) | 8)).toString(16); });
  return FOLDER_KEY_PREFIX + u;
}

/**
 * 로어북 컴파일 — 리수 로어북 가져오기 형식 { type:'risu', ver:1, data:[…] }. 본문 없는 항목은 뺀다.
 * 폴더(v1.17.0): 쓰이는 폴더만 — key가 있으면(리수에 이미 있는 폴더) 폴더 항목을 만들지 않고 자식의 folder에 그 key를 적는다(같은 캐릭터로
 * 가져올 때 그 폴더 안으로). key가 없으면 mode:'folder' 항목을 새로 만든다(내보낼 때마다 새 uuid — 두 번 가져오면 폴더도 둘, 가져오기가 덧붙임이라).
 * 순서 = 폴더 항목 → 그 폴더의 자식 → 다음 폴더 … → 폴더 없는 항목. insertorder는 원래 자리 번호라 우선순위는 안 바뀐다.
 */
function compileLorebook(bible) {
  const b = normalizeBible(bible);
  const secs = b.sections.map((s, i) => ({ s, i })).filter((x) => x.s.body.trim());
  const entry = ({ s, i }, folderKey) => ({
    key: s.keys.join(', '), comment: s.name, content: s.body.trim(), mode: 'normal',
    insertorder: Number.isInteger(s.order) ? 100 + s.order : 100 + i,
    alwaysActive: s.always, secondkey: '', selective: false,
    ...(folderKey ? { folder: folderKey } : {}),
  });
  const data = [];
  for (const f of b.folders) {
    const mine = secs.filter((x) => x.s.folder === f.id);
    if (!mine.length) continue;   // 빈 폴더는 만들지 않는다
    let key = f.key;
    if (!key) {
      key = newFolderKey();
      data.push({ key, comment: f.name, content: '', mode: 'folder', insertorder: 100, alwaysActive: false, secondkey: '', selective: false });
    }
    for (const x of mine) data.push(entry(x, key));
  }
  const folderIds = new Set(b.folders.map((f) => f.id));
  for (const x of secs) if (!x.s.folder || !folderIds.has(x.s.folder)) data.push(entry(x, ''));
  return { type: 'risu', ver: 1, data };
}

/** 항목 하나를 손으로 붙여 넣을 때의 글 */
function sectionText(sec) {
  const s = normSection(sec, null);
  if (!s) return '';
  return [`# ${s.name} (${KIND_LABEL[s.kind]})`, `낱말: ${s.keys.join(', ') || '(없음)'}${s.always ? ' · 상시' : ''}${s.folder ? ` · 폴더: ${s.folder}` : ''}`, '', s.body.trim()].join('\n');
}

/** 캐릭터 시트 — 설명란·첫 메시지에 붙여 넣을 글 */
function compileSheet(bible) {
  const b = normalizeBible(bible);
  const out = [];
  if (b.sheet.name) out.push(`## 이름\n${b.sheet.name}`);
  out.push(`## 캐릭터 설명 (description)\n${b.sheet.desc.trim() || '(아직 없음 — 대화에서 "캐릭터 시트 정리해줘"라고 하세요)'}`);
  out.push(`## 첫 메시지\n${b.sheet.first.trim() || '(아직 없음)'}`);
  return out.join('\n\n');
}

/** 💬 어시스턴트에게 넘길 요청문 — 심코어로 갈 것(sim)을 작업본 반영 요청으로 */
function simRequestText(bible) {
  const b = normalizeBible(bible);
  if (!b.sim.length) return '';
  return ['봇 제작 설정집에서 "심코어로 갈 것"으로 분류한 항목들이에요. 작업본에 어떻게 넣을지 제안하고, 합의되면 반영해 주세요.',
    ...(b.premise ? [`(봇 전제: ${b.premise})`] : []),
    ...b.sim.map((x) => `- [${x.how}] ${x.what}${x.why ? ` — ${x.why}` : ''}`)].join('\n');
}

/** 응답을 사람 말 + JSON(마지막 ```json 펜스, 없으면 통째 JSON)으로 — 추론 블록은 뗀다 (편집기 splitChatResponse와 같은 규율) */
const THOUGHT_TAG_RE = /<(thoughts?|thinking|think|reasoning)>[\s\S]*?<\/\1>\s*/gi;
function splitBibleResponse(raw) {
  const text = String(raw ?? '').replace(THOUGHT_TAG_RE, '').trim();
  const re = /```(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)```/g;
  let m, last = null;
  while ((m = re.exec(text))) {
    const body = m[1].trim();
    if (body.startsWith('{')) last = { index: m.index, len: m[0].length, body };
  }
  if (last) {
    const before = text.slice(0, last.index).trim(), after = text.slice(last.index + last.len).trim();
    return { prose: before && after ? before + '\n' + after : before || after, json: last.body };
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    try { JSON.parse(text); return { prose: '', json: text }; } catch (_) { /* 산문 취급 */ }
  }
  return { prose: text, json: null };
}

function bibleStats(bible) {
  const b = normalizeBible(bible);
  return {
    sections: b.sections.length, always: b.sections.filter((s) => s.always).length,
    bodyBytes: b.sections.reduce((a, s) => a + byteLen(s.body), 0), sim: b.sim.length,
    sheet: !!(b.sheet.desc.trim() || b.sheet.first.trim()),
    folders: b.folders.length, sourceBytes: byteLen(b.source.trim()),
  };
}

/** 바이트 상한으로 자르기 — 앞부분만 (assembleBotContext와 같은 방식) */
function clipBytes(s, cap) { let t = String(s); while (byteLen(t) > cap) t = t.slice(0, Math.floor(t.length * 0.9)); return t; }

/**
 * 사용자 입력 블록 (v1.17.0) — 설정집 다이제스트 뒤에 싣는다. 유저 제안: "원하는 캐릭터 시트 OOC 명령어를 붙여 넣는 곳 + 그 아래 캐릭 설정집 적재".
 * sheetFormat = 시트 형식(OOC 명령어·양식, 기기 공통 — 편집기가 prefs로 들고 온다), bible.source = 적재한 원문(캐릭터별), sourceOn = 동봉 여부.
 * 돌려주는 것: { lines, source: { bytes, on, truncated } }
 */
function bibleUserBlocks(bible, sheetFormat = '', cap = SOURCE_CAP) {
  const b = normalizeBible(bible);
  const lines = [];
  const fmt = str(sheetFormat, LIMITS.sheetFormatChars).trim();
  if (fmt) lines.push('## 캐릭터 시트 형식 — 사용자가 지정한 OOC 명령어·양식 (sheet.desc는 이 형식을 그대로 따릅니다)', fmt, '');
  const src = b.source.trim();
  const source = { bytes: byteLen(src), on: b.sourceOn && !!src, truncated: false };
  if (source.on) {
    const t = clipBytes(src, cap);
    source.truncated = t.length < src.length;
    lines.push('## 적재한 원문 — 사용자가 붙여 넣은 캐릭 설정집 원문 (정리의 재료 — 설정집에 아직 없는 것을 항목으로, 시트를 쓸 때도 참고)',
      t + (source.truncated ? '\n(… 상한으로 뒷부분 생략 — 사용자가 원문을 줄이거나 나눠 넣어야 합니다)' : ''), '');
  }
  return { lines, source };
}

module.exports = {
  BIBLE_V, KINDS, KIND_LABEL, SIM_HOW, LIMITS, DIGEST_CAP, SOURCE_CAP, UPDATE_KEYS, SECTION_KEYS, FOLDER_KEYS, FOLDER_KEY_PREFIX,
  emptyBible, normalizeBible, bibleIsBlank, applyBibleUpdate, bibleDigest, bibleRules, bibleUserBlocks, newFolderKey,
  compileLorebook, compileSheet, sectionText, simRequestText, splitBibleResponse, bibleStats, slugify,
};
