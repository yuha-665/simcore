const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.16.0 봇 제작 — 설정집 대화 (1단계, 쓰기 없음). 설계 docs/design-봇제작-대화.md
// 계기(유저 2026-10-10): "봇 제작 보조 유틸인데 아예 봇 제작에 쓸 수 없냐는 사람들이 있다 — 로어북·캐릭터 시트 손작업, OOC 제작".
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const B = SC.require('bible');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── ① 번들·배선 핀 ──
{
  ck('★ 코어 모듈 bible이 번들에 실린다', typeof B.applyBibleUpdate === 'function' && typeof B.compileLorebook === 'function', '');
  ck('★ 편집기가 bible을 require', src.includes("const bibleMod = require('./bible');"), '');
  ck('★ 층 bible — floorView 분기 + bibleFloor', src.includes("floorView === 'bible'") && src.includes('function bibleFloor()'), '');
  ck('★ 스택형 폴백에도 접기', src.includes("'🧑‍🎨 봇 제작 — 설정집 대화 (로어북·캐릭터 시트 초안)'"), '');
  ck('★ 사이드바 작업도구에 봇 제작 (data-floor="bible")', src.includes('data-floor="bible"') && src.includes('<span>봇 제작</span>'), '');
  ck('★ 층 머리글 FLOOR_HEADS.bible', src.includes("bible: ['봇 제작'"), '');
  ck('★ 내비 색 토큰', src.includes('--sc-nav-bible') && src.includes('.sc-maintab[data-floor="bible"] { --nav:var(--sc-nav-bible); }'), '');
  ck('★ 설정집 저장 통로 — 캐릭터별 pluginStorage (카드·번들에 안 실림)', src.includes('sim:bible:${currentChaId}') && src.includes('loadBible: async') && src.includes('saveBible: async'), '');
  ck('★ 내보내기 버튼 셋', ['📋 로어북 JSON 복사', '⬇ lorebook.json', '📋 캐릭터 시트 복사'].every((t) => src.includes(t)), '');
  ck('★ 💬 어시스턴트에게 보내기 — sim 요청문을 💬 입력칸에', src.includes("'💬 어시스턴트에게 보내기'") && src.includes('chat.draft = bibleMod.simRequestText(bible)'), '');
  ck('★ 번들에 Node 전용 Buffer 참조 없음 (v1.16.2 실사고 — 브라우저엔 Buffer가 없어 봇 제작 층이 비었다)', !/\bBuffer\s*\./.test(src) && src.includes('new TextEncoder().encode(String(s)).length'), '');
  ck('★ 캐릭터가 바뀌면 편집기를 새로 만든다 (v1.16.3 — 캐릭터별 상태가 이전 봇 것으로 남던 것)', src.includes("if (editor && editorChaId !== null && editorChaId !== currentChaId) {") && src.includes("editor = null;\n      ensureEditor();") && src.includes("editor.setFloor(floorBtn.dataset.floor || 'top')"), '');
  ck('★ 고르기 칸에 ↻ 다시 읽기, 이름뿐이어도 칸을 그린다', src.includes("'↻ 다시 읽기'") && (src.match(/if \(aiBotCtx\) \{   \/\/ 이름뿐이어도/g) || []).length === 2, '');
  ck('★ 📁 로어북 폴더 칸 + 카드 폴더 고르기 + 폴더별 묶음 (v1.17.0)', src.includes('📁 로어북 폴더') && src.includes("'+ 폴더 만들기'") && src.includes("'리수에 있는 폴더:'") && src.includes("'aria-label': '폴더'") && src.includes("group('폴더 없음', loose)"), '');
  ck('★ 🪪 시트 형식(OOC) + 📥 원문 적재 + 시트 써 달라기 (v1.17.0)', src.includes("'aria-label': '캐릭터 시트 형식'") && src.includes("'aria-label': '캐릭 설정집 원문'") && src.includes("'🪪 시트 써 달라기'") && src.includes('bibleMod.bibleUserBlocks(bible, bibleSheetFormat).lines'), '');
  ck('★ 어댑터: 캐릭터 정보에 폴더(folders + lore[].folder), 폴더 항목은 목록에서 뺌', src.includes("all.filter((l) => l.mode === 'folder')") && src.includes("all.filter((l) => l.mode !== 'folder')") && src.includes('folders,'), '');
  ck('★ 어댑터: 시트 형식은 기기 공통 prefs (sim:bible:prefs)', src.includes("'sim:bible:prefs'") && src.includes('loadBiblePrefs: async') && src.includes('saveBiblePrefs: async'), '');
  ck('★ 버전 1.17 이상 + display-name', /\/\/@version 1\.(1[7-9]|[2-9][0-9])\./.test(src) && /\/\/@display-name .*v1\.(1[7-9]|[2-9][0-9])\./.test(src), '');
}

// ── ② 1단계 = 쓰기 없음 — bibleFloor 구간은 캐릭터 객체를 건드리지 않는다 ──
{
  const a = src.indexOf('function buildBibleSystemPrompt('), b = src.indexOf('function topFloor()');
  const seg = a > 0 && b > a ? src.slice(a, b) : '';
  ck('★ bible 구간 추출', seg.length > 2000, String(seg.length));
  ck('★ 구간에 setCharacter·globalLore·customscript 없음 (2단계 자리)', !/setCharacter|globalLore|customscript/.test(seg), '');
  ck('★ 구간은 ai.generate만 부른다 (자기 정산 함정 회피 — callGenLLM 재사용)', /ai\.generate\(\{ system, messages: msgs \}\)/.test(seg) && !/runLLMModel|mode: 'model'/.test(seg), '');
  ck('★ 거부되면 오류 첨부 2회 (💬과 같은 규율)', seg.includes('attempt < 2') && seg.includes('방금 붙인 JSON이 형식 검사에서 거부되었습니다'), '');
  ck('★ 적용 전 스냅샷 → 되돌리기', seg.includes('bibleSnapshot();') && seg.includes('bibleUndo.pop()'), '');
}

// ── ③ 코어 — 패치 규율·컴파일·규약 ──
{
  const b0 = B.emptyBible();
  let r = B.applyBibleUpdate(b0, { bible: { premise: '변경 마을 생존', sections: [
    { id: 'arin', kind: 'character', name: '아린', keys: ['아린', '경비대장'], body: '감시탑 문장을 보면 시선을 피한다.' },
    { kind: 'place', name: '감시탑', keys: '감시탑, 탑', always: false, body: '마을 북쪽의 낡은 탑.' },
    { kind: 'style', name: '문체', always: true, body: '3인칭 과거형.' },
  ], sheet: { name: '아린', desc: '경비대장. 말수가 적다.' }, sim: [{ what: '아린 호감도', how: '변수', why: '플레이가 바꾼다' }, { what: '아린의 과거', how: '비밀', why: '밝혀지기 전엔 몰라야' }] } });
  ck('적용 — 추가 3·시트·분담 2', r.ok && r.summary === '항목 추가 3 · 제목·전제 · 캐릭터 시트 · 심코어 분담 2', r.summary + ' ' + r.errors.join('|'));
  const b1 = r.bible;
  ck('id 없는 항목은 이름으로 슬러그', b1.sections.some((s) => s.id === '감시탑') && b1.sections.some((s) => s.id === '문체'), b1.sections.map((s) => s.id).join(','));
  ck('keys 쉼표 문자열도 받는다', b1.sections.find((s) => s.id === '감시탑').keys.join('|') === '감시탑|탑', '');
  r = B.applyBibleUpdate(b1, { bible: { sections: [{ id: 'arin', body: '감시탑 문장을 보면 시선을 피한다. 봉인 이야기가 나오면 화제를 돌린다.' }] } });
  ck('id 덮어쓰기 — 보낸 필드만 교체, 나머지 그대로', r.ok && r.bible.sections[0].keys.length === 2 && r.bible.sections[0].body.includes('봉인') && r.bible.sections.length === 3 && r.bible.sim.length === 2, r.errors.join('|'));
  r = B.applyBibleUpdate(b1, { bible: { sections: [{ id: 'arin', kind: 'villain' }], remove: ['없는-id'], extra: 1 } });
  ck('거부 — 없는 kind·없는 remove·모르는 키, 설정집은 그대로', !r.ok && r.errors.length === 3 && r.bible === b1, r.errors.join('|'));
  r = B.applyBibleUpdate(b1, { bible: { sections: [{ name: '새것' }], sim: [{ what: 'x', how: '마법' }] } });
  ck('거부 — sim how가 없는 종류', !r.ok && r.errors.some((e) => e.includes("how '마법'")), r.errors.join('|'));
  r = B.applyBibleUpdate(b1, { bible: { sections: [{ kind: 'rule' }] } });
  ck('거부 — id도 name도 없는 항목', !r.ok && r.errors.some((e) => e.includes('id도 name도 없습니다')), r.errors.join('|'));

  const lore = B.compileLorebook(b1);
  ck('컴파일 — 리수 가져오기 형식 (type risu · ver 1 · data)', lore.type === 'risu' && lore.ver === 1 && lore.data.length === 3, '');
  ck('컴파일 — 항목 필드 = 리수 loreBook 모양', lore.data.every((e) => ['key', 'comment', 'content', 'mode', 'insertorder', 'alwaysActive', 'secondkey', 'selective'].every((k) => k in e) && e.mode === 'normal'), '');
  ck('컴파일 — 상시는 alwaysActive, key는 쉼표 문자열', lore.data.find((e) => e.comment === '문체').alwaysActive === true && lore.data.find((e) => e.comment === '아린').key === '아린, 경비대장', '');
  ck('컴파일 — 본문 없는 항목은 뺀다', B.compileLorebook(B.normalizeBible({ sections: [{ name: '빈', body: '' }] })).data.length === 0, '');
  ck('시트 — 설명·첫 메시지 글', B.compileSheet(b1).includes('## 캐릭터 설명 (description)\n경비대장. 말수가 적다.') && B.compileSheet(b1).includes('(아직 없음)'), '');
  ck('항목 글 — 제목·낱말·본문', B.sectionText(b1.sections[0]).startsWith('# 아린 (인물)\n낱말: 아린, 경비대장'), '');
  ck('요청문 — sim을 💬에 넘길 글', B.simRequestText(b1).includes('- [비밀] 아린의 과거 — 밝혀지기 전엔 몰라야'), '');

  const d = B.bibleDigest(b1);
  ck('다이제스트 — 머리·항목·시트·sim', d.omitted === 0 && d.text.includes('#### [arin] 인물 · 아린 · 낱말: 아린, 경비대장') && d.text.includes('### 심코어로 갈 것') && d.text.includes('설명(desc): \n경비대장'), '');
  const rules = B.bibleRules().join('\n');
  ck('규약 — 분담·비밀·keys·always·형식', ['로어북 = 안 변하는 것', 'how="비밀"', '2~6개', '필요한 것에만 true', '"bible"', 'id로 덮어쓰기'].every((t) => rules.includes(t)), '');
  ck('규약 — 종류 표에 아홉 종류', B.KINDS.length === 9 && B.KINDS.every((k) => rules.includes(`${k}=${B.KIND_LABEL[k]}`)), '');
  ck('정규화 — 저장소 쓰레기에도 안 던진다', (() => { try { B.normalizeBible({ sections: 'x', sheet: 5, sim: [null, 3] }); B.normalizeBible(42); return true; } catch { return false; } })(), '');
  ck('상한 — 항목 80·낱말 24', (() => { const many = B.normalizeBible({ sections: Array.from({ length: 100 }, (_, i) => ({ name: 'n' + i })) }); const keys = B.normalizeBible({ sections: [{ name: 'k', keys: Array.from({ length: 40 }, (_, i) => 'k' + i) }] }); return many.sections.length === 80 && keys.sections[0].keys.length === 24; })(), '');
  ck('응답 가르기 — 추론 블록 제거 + 마지막 json 펜스', (() => { const s = B.splitBibleResponse('<thoughts>x</thoughts>정리했어요.\n```json\n{"bible":{"premise":"p"}}\n```'); return s.prose === '정리했어요.' && JSON.parse(s.json).bible.premise === 'p'; })(), '');
  ck('비어 있음 판정', B.bibleIsBlank(B.emptyBible()) && !B.bibleIsBlank(b1), '');

  // 📁 폴더 (v1.17.0)
  r = B.applyBibleUpdate(b1, { bible: { folders: [{ id: 'base', name: '기초 설정집' }], sections: [{ id: 'arin', folder: 'base' }, { name: '길드', kind: 'faction', folder: 'nope', body: 'x' }] } });
  ck('폴더 — 없는 폴더 id는 거부 (있는 폴더를 알려 준다)', !r.ok && r.errors.some((e) => e.includes("folder 'nope'") && e.includes('base')), r.errors.join('|'));
  r = B.applyBibleUpdate(b1, { bible: { folders: [{ id: 'base', name: '기초 설정집' }, { name: '지역 설정집' }], sections: [{ id: 'arin', folder: 'base' }, { id: '감시탑', folder: '지역-설정집' }] } });
  ck('폴더 — 추가·배정, 요약에 폴더', r.ok && r.bible.folders.length === 2 && r.bible.sections.find((x) => x.id === 'arin').folder === 'base' && r.summary.includes('폴더 2'), r.errors.join('|') + ' ' + r.summary);
  const withKey = B.normalizeBible({ ...r.bible, folders: [{ id: 'base', name: '기초 설정집', key: B.FOLDER_KEY_PREFIX + 'abc' }, { id: '지역-설정집', name: '지역 설정집' }, { id: 'empty', name: '빈 폴더' }] });
  const l2 = B.compileLorebook(withKey);
  const fold = l2.data.filter((e) => e.mode === 'folder');
  ck('컴파일 — 새 폴더는 mode folder 항목(uuid key), 리수에 있는 폴더(key)는 항목 없이 자식 folder에 key, 빈 폴더는 안 만든다',
    fold.length === 1 && fold[0].comment === '지역 설정집' && /^[0-9a-f-]{36}$/.test(fold[0].key.slice(B.FOLDER_KEY_PREFIX.length))
    && l2.data.find((e) => e.comment === '아린').folder === B.FOLDER_KEY_PREFIX + 'abc' && l2.data.find((e) => e.comment === '감시탑').folder === fold[0].key
    && l2.data.find((e) => e.comment === '문체').folder === undefined, JSON.stringify(l2.data.map((e) => [e.comment, e.mode, e.folder])));
  ck('컴파일 — 순서: 폴더 → 자식 → 폴더 없는 항목', l2.data.map((e) => e.comment).join('|') === '아린|지역 설정집|감시탑|문체', l2.data.map((e) => e.comment).join('|'));
  ck('컴파일 — 새 폴더 key는 내보낼 때마다 새 uuid', B.compileLorebook(withKey).data.find((e) => e.mode === 'folder').key !== fold[0].key, '');
  ck('다이제스트 — 폴더 목록과 항목의 폴더', B.bibleDigest(withKey).text.includes('로어북 폴더') && B.bibleDigest(withKey).text.includes('기초 설정집(base) · 리수에 있음') && B.bibleDigest(withKey).text.includes('· 폴더: base'), '');
  ck('규약 — folders·folder 설명', B.bibleRules().join('\n').includes('"folders"?:') && B.bibleRules().join('\n').includes('없는 폴더 id는 거부') && B.bibleRules().join('\n').includes('캐릭터 시트 형식'), '');
  ck('정규화 — 없는 폴더를 가리키는 항목은 폴더 밖으로, key는 리수 머리일 때만', (() => { const n = B.normalizeBible({ folders: [{ name: 'f', key: 'junk' }], sections: [{ name: 's', folder: 'zzz', body: 'b' }] }); return n.folders[0].key === undefined && n.sections[0].folder === undefined; })(), '');
  // 🪪 시트 형식 · 📥 원문 적재 (v1.17.0) — AI 수정안으로는 못 바꾼다
  const r3 = B.applyBibleUpdate(b1, { bible: { source: 'x' } });
  ck('원문·시트 형식은 수정안 밖 (알 수 없는 키)', !r3.ok && r3.errors.some((e) => e.includes("'source'")), '');
  const ub = B.bibleUserBlocks(B.normalizeBible({ source: '원문 한 덩이' }), '## 시트 양식\n이름/나이/말투');
  ck('사용자 블록 — 시트 형식·적재한 원문', ub.lines.join('\n').includes('## 캐릭터 시트 형식') && ub.lines.join('\n').includes('이름/나이/말투') && ub.lines.join('\n').includes('## 적재한 원문') && ub.lines.join('\n').includes('원문 한 덩이') && ub.source.on && !ub.source.truncated, '');
  ck('사용자 블록 — 동봉 끄면 원문 빠짐, 상한 넘으면 잘림 표시', !B.bibleUserBlocks(B.normalizeBible({ source: 'x', sourceOn: false })).lines.join('\n').includes('## 적재한 원문') && B.bibleUserBlocks(B.normalizeBible({ source: '가'.repeat(30000) })).source.truncated, '');
}

// ── ④ 실제로 그려지는가 — 가짜 DOM에 봇 제작 층을 띄워 대화 한 턴(적용·거부)·되돌리기·내보내기·💬 넘기기를 누른다 ──
// (가짜 DOM은 test-editortabs와 같은 관례 — h()가 쓰는 만큼만, 복제해 둔다)
function makeDom() {
  const mkEl = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(), nodeType: 1, children: [], childNodes: [],
      style: { cssText: '' }, dataset: {}, attrs: {}, _text: '',
      className: '', value: '', checked: false, open: false, disabled: false,
      classList: {
        add(...c) { for (const x of c) if (!el.className.split(' ').includes(x)) el.className = (el.className + ' ' + x).trim(); },
        remove(...c) { el.className = el.className.split(' ').filter((x) => !c.includes(x)).join(' '); },
        contains: (c) => el.className.split(' ').includes(c),
        toggle(c, on) { if (on === false || (on === undefined && el.classList.contains(c))) el.classList.remove(c); else el.classList.add(c); },
      },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'open') el.open = true; if (k === 'disabled') el.disabled = true; },
      getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
      removeAttribute(k) { delete el.attrs[k]; if (k === 'disabled') el.disabled = false; },
      appendChild(c) { el.children.push(c); el.childNodes.push(c); c.parentNode = el; return c; },
      append(...cs) { for (const c of cs) el.appendChild(c); },
      insertBefore(c, ref) { const i = el.children.indexOf(ref); el.children.splice(i < 0 ? el.children.length : i, 0, c); el.childNodes = el.children; c.parentNode = el; return c; },
      removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) { el.children.splice(i, 1); el.childNodes = el.children; } return c; },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, select() {}, click() { el.onclick?.({ preventDefault() {} }); },
      scrollIntoView() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 200, height: 30, bottom: 30, right: 200 }),
      replaceChildren(...cs) { el.children = []; el.childNodes = []; for (const c of cs) el.appendChild(c); },
      prepend(...cs) { el.children.unshift(...cs); el.childNodes = el.children; },
      querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
      cloneNode: () => mkEl(tag),
    };
    Object.defineProperty(el, 'textContent', {
      get() { return el._text + el.children.map((c) => c.textContent ?? '').join(''); },
      set(v) { el._text = String(v); el.children = []; el.childNodes = []; },
    });
    Object.defineProperty(el, 'innerHTML', { get: () => el._html ?? '', set(v) { el._html = String(v); el.children = []; el.childNodes = []; } });
    Object.defineProperty(el, 'firstChild', { get: () => el.children[0] ?? null });
    Object.defineProperty(el, 'lastChild', { get: () => el.children[el.children.length - 1] ?? null });
    return el;
  };
  const doc = {
    createElement: mkEl, createElementNS: (_ns, tag) => mkEl(tag),
    createTextNode: (t) => { const n = mkEl('#text'); n.nodeType = 3; n._text = String(t); return n; },
    createDocumentFragment: () => mkEl('#frag'),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, execCommand: () => true,
  };
  doc.body = mkEl('body'); doc.head = mkEl('head'); doc.documentElement = mkEl('html');
  return doc;
}
function findAll(root, pred, out = []) { for (const c of root.children || []) { if (pred(c)) out.push(c); findAll(c, pred, out); } return out; }
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

(async () => {
  global.document = makeDom();
  global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (f) => f(), setTimeout, clearTimeout };
  const clip = [];   // Node 21+는 globalThis.navigator가 접근자라 대입이 조용히 무시된다 — defineProperty로
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { clip.push(t); } } }, configurable: true, writable: true });
  const { createSchemaEditor } = SC.require('editor');

  const saved = []; let floorReq = null;
  const replies = [];   // 다음 generate가 돌려줄 답 (앞에서부터)
  let lastSystem = '';
  const prefsSaved = [];
  const prefsBible = [];   // 🪪 시트 형식 — 기기 공통 prefs (v1.17.0)
  const ai = {
    generate: async (input) => { lastSystem = String(input && input.system || ''); return replies.length ? replies.shift() : '그냥 말이에요.'; },
    getBotContext: async () => ({ name: '테스트', desc: '설명', lore: [{ name: '옛 항목', content: '옛 로어 본문 (설정집의 옛 본문과 다른 글)' }] }),
    loadBible: async () => ({ title: '불러온 설정집', sections: [{ id: 'old', kind: 'world', name: '옛 세계', keys: ['옛'], body: '옛 본문' }] }),
    saveBible: async (b) => { saved.push(JSON.parse(JSON.stringify(b))); },
    loadBiblePrefs: async () => null,
    saveBiblePrefs: async (p) => { prefsBible.push(JSON.parse(JSON.stringify(p))); },
  };
  const box = document.createElement('div');
  let bootErr = null, ed = null;
  try { ed = createSchemaEditor(box, { simcore: '0.1', meta: { name: 'b' }, vars: [{ id: 'gold', label: '재정', type: 'int', init: 1 }], statusUI: { mode: 'auto', groups: [] } },
    { onChange: () => {}, ai, floor: 'bible', onRequestFloor: (f) => { floorReq = f; }, uiPrefs: { load: async () => null, save: async (p) => { prefsSaved.push(JSON.parse(JSON.stringify(p))); } } }); } catch (e) { bootErr = e; }
  ck('★ 봇 제작 층으로 편집기가 뜬다', !bootErr && !!ed, bootErr && (bootErr.message + ' | ' + (bootErr.stack || '').split('\n')[1]));
  await tick();
  const btn = (label) => findAll(box, (e) => e.tagName === 'BUTTON' && e.textContent.startsWith(label))[0];
  const has = (cls) => findAll(box, (e) => String(e.className).split(' ').includes(cls)).length;
  ck('★ 두 기둥(설정집·대화)이 그려진다', has('sce-bible-cols') === 1 && has('sce-bible-book') === 1 && has('sce-bible-chat') === 1, '');
  ck('★ 저장된 설정집을 불러와 카드로 그린다', has('sce-bible-card') === 1 && box.textContent.includes('옛 세계'), '');
  ck('★ 내보내기·💬·되돌리기·비우기 버튼', ['📋 로어북 JSON 복사', '⬇ lorebook.json', '📋 캐릭터 시트 복사', '💬 어시스턴트에게 보내기', '↩ 되돌리기', '🧹 설정집 비우기'].every((l) => !!btn(l)), '');

  // 대화 한 턴 — 수정안이 자동 적용된다
  const area = () => findAll(box, (e) => e.tagName === 'TEXTAREA' && String(e.className).includes('sce-chat-input'))[0];
  const say = async (text) => { const a = area(); a.value = text; a.oninput(); btn('보내기').click(); for (let i = 0; i < 20; i++) await tick(); };
  replies.push('아린을 정리했어요.\n```json\n{"bible":{"premise":"변경 마을","sections":[{"id":"arin","kind":"character","name":"아린","keys":["아린"],"body":"경비대장."}],"sim":[{"what":"아린 호감도","how":"변수","why":"플레이가 바꾼다"}]}}\n```');
  await say('아린을 정리해줘');
  ck('★ 수정안 자동 적용 — 카드 2개, 말풍선에 반영 요약', has('sce-bible-card') === 2 && box.textContent.includes('✅ 설정집 반영 — 항목 추가 1 · 제목·전제 · 심코어 분담 1'), box.textContent.slice(0, 300));
  ck('★ 적용이 캐릭터별 저장 통로로 간다', saved.length >= 1 && saved[saved.length - 1].sections.some((s) => s.id === 'arin'), String(saved.length));
  ck('★ 심코어로 갈 것 목록이 보인다', has('sce-bible-sim-item') === 1 && box.textContent.includes('아린 호감도'), '');

  // 거부 — 두 번 다 모르는 키면 버리고 설정집은 그대로
  replies.push('넣었어요.\n```json\n{"bible":{"foo":1}}\n```', '```json\n{"bible":{"foo":2}}\n```');
  await say('뭔가 넣어줘');
  ck('★ 형식 불합격 2회 → 버림 + 거부 원문, 설정집 그대로', has('sce-bible-card') === 2 && box.textContent.includes('⚠ 붙은 JSON이 두 번 모두') && box.textContent.includes("알 수 없는 키 'foo'"), '');

  // 논의 턴 — JSON 없음
  await say('아린은 어떤 사람이야?');
  ck('★ 논의 턴은 말풍선만', box.textContent.includes('그냥 말이에요.') && has('sce-bible-card') === 2, '');

  // 📚 보낼 것 고르기 (v1.16.1) — 로어북 항목을 끄면 다음 턴 프롬프트에서 빠지고 선택이 캐릭터별로 저장된다
  ck('★ 전송 정보 카드에 보낼 것 고르기', has('sce-ctx-pick') === 1 && has('sce-ctx-pick-row') === 2, String(has('sce-ctx-pick-row')));
  ck('★ 고르기 전엔 로어북이 프롬프트에 실린다', lastSystem.includes('### 로어북: 옛 항목') && lastSystem.includes('옛 로어 본문') && lastSystem.includes('### 봇 설명'), '');
  { const rowEl = findAll(box, (e) => String(e.className).includes('sce-ctx-pick-row') && e.textContent.includes('옛 항목'))[0];
    const cb = rowEl && rowEl.children[0]; if (cb) { cb.checked = false; cb.onchange(); } }
  await say('한 번 더');
  ck('★ 끈 항목은 프롬프트에서 빠진다 (설명은 그대로 — 설정집의 옛 본문은 다이제스트라 남는다)', !lastSystem.includes('### 로어북: 옛 항목') && !lastSystem.includes('옛 로어 본문') && lastSystem.includes('### 봇 설명') && lastSystem.includes('[old]'), '');
  await tick(400);
  ck('★ 선택이 캐릭터별 uiPrefs(ctx)에 저장된다', prefsSaved.some((p) => p.ctx && p.ctx.desc === true && Array.isArray(p.ctx.off) && p.ctx.off.includes('옛 항목')), JSON.stringify(prefsSaved.slice(-1)));

  // ↻ 다시 읽기 (v1.16.3) — 리수에서 로어북이 늘었으면 목록이 따라온다
  ai.getBotContext = async () => ({ name: '테스트', desc: '설명', lore: [{ name: '옛 항목', content: '옛 로어 본문' }, { name: '새 항목', content: '새 로어 본문' }] });
  btn('↻ 다시 읽기').click(); for (let i = 0; i < 10; i++) await tick();
  ck('★ ↻ 다시 읽기 — 바뀐 로어북 목록을 다시 불러온다 (끈 선택은 유지)', has('sce-ctx-pick-row') === 3 && box.textContent.includes('새 항목')
    && findAll(box, (e) => String(e.className).includes('sce-ctx-pick-row') && e.textContent.includes('옛 항목'))[0].children[0].checked === false, String(has('sce-ctx-pick-row')));

  // 내보내기 — 클립보드에 리수 형식
  btn('📋 로어북 JSON 복사').click(); await tick();
  ck('★ 로어북 JSON 복사 = 리수 가져오기 형식, 항목 2', (() => { try { const j = JSON.parse(clip[clip.length - 1]); return j.type === 'risu' && j.data.length === 2 && j.data.some((e) => e.comment === '아린'); } catch { return false; } })(), String(clip.length));
  btn('⬇ lorebook.json').click(); await tick();
  ck('내려받기가 안 되는 환경이면 안내 (예외 없음)', box.textContent.includes('내려받기가 안 돼요') || box.textContent.includes('내려받음'), '');

  // 💬 넘기기 — 요청문을 💬 입력칸에, 층 이동 요청
  btn('💬 어시스턴트에게 보내기').click(); await tick();
  ck('★ 💬 넘기기 — 호스트에 top 층 요청', floorReq === 'top', String(floorReq));

  // 되돌리기 — 적용 전으로
  ed.setFloor('bible'); await tick();
  btn('↩ 되돌리기').click(); await tick();
  ck('★ 되돌리기 — 카드 1개로', has('sce-bible-card') === 1 && !box.textContent.includes('아린 호감도'), String(has('sce-bible-card')));

  // 비우기 — 두 번 누르기
  btn('🧹 설정집 비우기').click(); await tick();
  ck('비우기 1회는 무장만', has('sce-bible-card') === 1 && !!btn('한 번 더 누르면 설정집을 비워요'), '');
  btn('한 번 더 누르면 설정집을 비워요').click(); await tick();
  ck('★ 비우기 2회 — 빈 설정집, 되돌리기 가능', has('sce-bible-card') === 0 && !!btn('↩ 되돌리기') && !btn('↩ 되돌리기').disabled, '');

  // ── v1.17.0 — 📁 폴더 · 🪪 시트 형식 · 📥 원문 적재 (비운 설정집에서 시작) ──
  ai.getBotContext = async () => ({ name: '테스트', desc: '설명', folders: [{ key: B.FOLDER_KEY_PREFIX + 'abc', name: '기초 설정집' }], lore: [{ name: '옛 항목', content: '옛 로어 본문', folder: '기초 설정집' }] });
  btn('↻ 다시 읽기').click(); for (let i = 0; i < 10; i++) await tick();
  ck('★ 고르기 목록에 폴더 이름이 앞에 붙는다', findAll(box, (e) => String(e.className).includes('sce-ctx-pick-row') && e.textContent.includes('기초 설정집 › 옛 항목')).length === 1, '');
  ck('★ 📁 폴더 칸 + 리수에 있는 폴더 버튼', has('sce-bible-folders') === 1 && !!btn('+ 기초 설정집') && !!btn('+ 폴더 만들기'), '');
  btn('+ 기초 설정집').click(); await tick();
  ck('★ 리수 폴더 가져오기 — key 달린 폴더 칩, 버튼은 ✓로 잠김', has('sce-bible-folder-chip') === 1 && box.textContent.includes('기초 설정집 · 0 · 리수에 있음') && !!btn('✓ 기초 설정집') && btn('✓ 기초 설정집').disabled, '');
  { const inp = findAll(box, (e) => e.tagName === 'INPUT' && e.getAttribute('aria-label') === '새 폴더 이름')[0]; inp.value = '지역 설정집'; inp.oninput(); btn('+ 폴더 만들기').click(); await tick(); }
  ck('★ 새 폴더 만들기 — 칩 2', has('sce-bible-folder-chip') === 2 && box.textContent.includes('지역 설정집 · 0'), '');
  replies.push('넣었어요.\n```json\n{"bible":{"sections":[{"id":"arin","kind":"character","name":"아린","keys":["아린"],"folder":"기초-설정집","body":"경비대장."},{"id":"tower","kind":"place","name":"감시탑","keys":["감시탑"],"folder":"지역-설정집","body":"북쪽 탑."},{"id":"style","kind":"style","name":"문체","always":true,"body":"3인칭."}]}}\n```');
  await say('아린·감시탑·문체를 넣어줘');
  ck('★ 폴더별 묶음으로 그려진다 (📁 기초 설정집 · 1 / 📁 지역 설정집 · 1 / 폴더 없음 · 1)', has('sce-bible-group') === 3 && box.textContent.includes('📁 기초 설정집 · 1') && box.textContent.includes('폴더 없음 · 1'), String(has('sce-bible-group')) + ' ' + box.textContent.slice(0, 200));
  ck('★ 카드마다 폴더 고르기', findAll(box, (e) => e.tagName === 'SELECT' && e.getAttribute('aria-label') === '폴더').length === 3, '');
  btn('📋 로어북 JSON 복사').click(); await tick();
  ck('★ 내보낸 JSON — 새 폴더 항목 1(지역 설정집) + 아린은 리수 폴더 key로 + 문체는 폴더 없음', (() => { try { const j = JSON.parse(clip[clip.length - 1]); const f = j.data.filter((e) => e.mode === 'folder'); return f.length === 1 && f[0].comment === '지역 설정집' && j.data.find((e) => e.comment === '아린').folder === B.FOLDER_KEY_PREFIX + 'abc' && j.data.find((e) => e.comment === '감시탑').folder === f[0].key && !('folder' in j.data.find((e) => e.comment === '문체')); } catch { return false; } })(), String(clip.length));
  ck('★ 내보내기 안내에 새 폴더 수', box.textContent.includes('항목 3 · 새 폴더 1'), '');
  // 🪪 시트 형식(기기 공통 prefs) + 📥 원문 적재(캐릭터별 설정집) → 다음 턴 프롬프트에 실린다
  { const f = findAll(box, (e) => e.tagName === 'TEXTAREA' && e.getAttribute('aria-label') === '캐릭터 시트 형식')[0]; f.value = '## 시트 양식\n이름/나이/말투'; f.onchange(); await tick(); }
  { const sa = findAll(box, (e) => e.tagName === 'TEXTAREA' && e.getAttribute('aria-label') === '캐릭 설정집 원문')[0]; sa.value = '원문: 아린은 스물여섯.'; sa.onchange(); await tick(); }
  await tick(400);
  ck('★ 시트 형식은 기기 공통 prefs로 저장', prefsBible.length >= 1 && prefsBible[prefsBible.length - 1].sheetFormat.includes('이름/나이/말투'), String(prefsBible.length));
  ck('★ 원문은 캐릭터별 설정집에 저장', saved[saved.length - 1].source === '원문: 아린은 스물여섯.' && saved[saved.length - 1].sourceOn === true, JSON.stringify(saved[saved.length - 1]).slice(0, 200));
  ck('★ 시트 접기 머리에 형식 ✓ · 원문 KB', box.textContent.includes('형식 ✓') && box.textContent.includes('원문 0.0KB'), '');
  btn('🪪 시트 써 달라기').click(); await tick();
  ck('★ 시트 써 달라기 — 입력칸에 요청문', area().value.startsWith('시트 형식대로 캐릭터 시트'), area().value);
  await say('시트 써줘');
  ck('★ 프롬프트에 시트 형식·적재한 원문 (설정집 다이제스트 뒤)', lastSystem.includes('## 캐릭터 시트 형식') && lastSystem.includes('이름/나이/말투') && lastSystem.includes('## 적재한 원문') && lastSystem.includes('아린은 스물여섯') && lastSystem.indexOf('## 설정집') < lastSystem.indexOf('## 캐릭터 시트 형식'), '');
  { const cb = findAll(box, (e) => e.tagName === 'INPUT' && e.getAttribute('aria-label') === '원문 동봉')[0]; cb.checked = false; cb.onchange(); await tick(); }
  await say('한 번 더');
  ck('★ 동봉을 끄면 원문이 빠진다 (시트 형식은 남는다)', !lastSystem.includes('## 적재한 원문') && lastSystem.includes('## 캐릭터 시트 형식'), '');
  { const x = findAll(box, (e) => e.tagName === 'BUTTON' && e.getAttribute('aria-label') === '폴더 지역 설정집 지우기')[0]; x.click(); await tick(); }
  ck('★ 폴더 지우기 — 항목은 폴더 밖으로 (칩 1, 폴더 없음 · 2)', has('sce-bible-folder-chip') === 1 && box.textContent.includes('폴더 없음 · 2'), '');

  // 직결 호출이 없는 호스트 — 설정집만
  const box2 = document.createElement('div');
  let e2 = null; try { createSchemaEditor(box2, { simcore: '0.1', meta: { name: 'c' }, vars: [], statusUI: { mode: 'auto', groups: [] } }, { onChange: () => {}, floor: 'bible' }); } catch (e) { e2 = e; }
  ck('★ ai 없는 호스트에서도 층이 뜬다 (대화 없이 설정집만)', !e2 && findAll(box2, (e) => String(e.className).includes('sce-bible-book')).length === 1 && findAll(box2, (e) => String(e.className).includes('sce-bible-chat')).length === 0, e2 && e2.message);

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
