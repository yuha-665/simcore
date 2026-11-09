
let editorContent = null;
const fill = (x) => { const c = JSON.parse(JSON.stringify(x)); c.statusUI = c.statusUI || { mode: 'auto', groups: [] }; c.statusUI.groups = c.statusUI.groups || []; return c; };
const createSchemaEditor = (base) => {
  editorContent = fill(base);
  return { getSchema: () => JSON.parse(JSON.stringify(editorContent)), setSchema: (x) => { editorContent = fill(x); } };
};
let schema = null, currentChaId = null;
const profileMod = require("C:\\claude\\simcore\\core\\profile.js");
let profileList = [], currentProfile = null, baseSchema = null;
function installedSchemaFor(name) { if (!name) return baseSchema; const e = profileMod.findProfile(profileList, name); return e ? e.merged : null; }
  let editor = null;
  let editorChaId = null;      // 편집기 내용이 어느 캐릭터 기준인지
  let editorLoadedSig = null;  // 편집기에 불러온 직후, 편집기가 빈 칸을 채운 뒤의 서명 (이후 손댔는지 판정용)
  let editorBaseSig = null;    // 그때 불러온 원본의 서명 (설치본을 불러왔는지 판정용 — 위와 따로 둔다, v1.21.4)
  // 🔀 프로필 (v1.24.0) — 편집기가 고치는 판. [캐릭터에 적용]은 이 판에만 들어간다 (전엔 "지금 채팅의 판"이 받아서,
  // 검사 판을 열어 둔 채 마법사 채팅으로 옮겨 적용하면 마법사 판이 검사 판으로 덮였다)
  let editorProfile = '';      // '' = 기본 판
  let editorChatProfile = '';  // 편집기를 마지막으로 맞출 때 이 채팅의 판 — 채팅이 판을 바꿨는지 알려고
  const BLANK_SCHEMA = () => ({
    simcore: '0.1', meta: { name: '새 시뮬레이션' }, vars: [], statusUI: { mode: 'auto', groups: [] },
  });
  // 스키마 비교 서명 — 모듈 팩(origin:'module')은 걷어내고 잰다 (v1.2.3): 저장본에 안 실리는
  // 손님이라, 세면 설치 되읽기·더티 판정이 모듈 팩 봇에서 영영 안 맞는다 (실사고).
  // 키 순서·편집기 빈 칸은 안 본다 (v1.24.0) — 프로필은 기본 판에 덧칠을 얹어 만드는데, 얹은 판은 기본 판의 키 순서·모양을 따라
  // 편집기 작업본(빈 칸을 채운 것)과 글자로는 늘 달라 "반영 안 된 변경" 배너가 안 꺼졌다. 빈 칸 채우기는 profile.shapeFill = editor normalize
  const sig = (o) => {
    try {
      const c = JSON.parse(JSON.stringify(o));
      if (c && c.assets && Array.isArray(c.assets.packs)) {
        c.assets.packs = c.assets.packs.filter((p) => !p || p.origin !== 'module');
      }
      return profileMod.shapeSig(c);
    } catch { return null; }
  };
  const editorSig = () => { try { return editor ? sig(editor.getSchema()) : null; } catch { return null; } };
  /** 편집기 내용이 불러온 뒤 사용자 손을 탔는가 */
  function editorIsDirty() {
    return !!editor && editorLoadedSig !== null && editorSig() !== editorLoadedSig;
  }
  /** 🔀 이 채팅이 도는 판의 설치본과 이름 — 편집기가 따라갈 기준 (프로필 없는 봇은 예전 그대로 schema) */
  function editorTargetNow() {
    if (!profileList.length) return { profile: '', schema };
    const p = currentProfile ?? '';
    const s = installedSchemaFor(p);
    return s ? { profile: p, schema: s } : { profile: '', schema: baseSchema ?? schema };
  }
  /** 🔀 편집기가 고치는 판의 설치본 (더티 배너의 기준). 그 판이 없어졌으면 null */
  function editorInstalledRef() {
    if (!editorProfile) return profileList.length ? (baseSchema ?? schema) : schema;
    return installedSchemaFor(editorProfile);
  }
  /** 편집기 내용이 설치본과 다른가 (더티 배너) — 손댔거나, 설치본이 아닌 것을 불러왔을 때만.
   *  편집기는 실을 때 빈 칸(statusUI.groups·rules.events …)을 채우므로 편집기 내용과 설치본을 글자로 대면 늘 다르다 (v1.21.4 —
   *  생성기 봇(베리디아)은 번들을 넣을 때마다 [지금 적용]을 한 번 더 눌러야 배너가 사라졌다. 적용은 이미 끝난 뒤였다). */
  function editorDiffersFromInstalled() {
    if (!editor) return false;
    const installed = sig(editorInstalledRef() ?? BLANK_SCHEMA());
    if (editorSig() === installed) return false;
    return editorIsDirty() || editorBaseSig !== installed;
  }
  /** 편집기에 스키마를 싣고 기준선을 갱신. prof를 주면 편집기가 고치는 판도 그것으로 (🔀 v1.24.0) */
  function loadIntoEditor(next, prof) {
    // 캐릭터가 바뀌었으면 편집기를 새로 만든다 (v1.16.3) — 인스턴스가 전역이라 캐릭터별 상태(캐릭터 정보 캐시·보낼 것 선택·설정집·
    // 대화·작업 내역·접힘)가 이전 봇 것으로 남던 것. 사이드바가 가리키는 층은 그대로 복원한다.
    if (editor && editorChaId !== null && editorChaId !== currentChaId) {
      const floorBtn = typeof document !== 'undefined' ? document.querySelector('#sc-root .sc-maintab.on[data-page="edit"]') : null;
      try { editor.destroy(); } catch (e) { console.log('[simcore] 편집기 정리 실패:', e.message); }
      editor = null;
      ensureEditor();
      if (floorBtn && editor) { try { editor.setFloor(floorBtn.dataset.floor || 'top'); } catch { /* 층 복원 실패는 치명적이지 않다 */ } }
    }
    ensureEditor();
    const copy = JSON.parse(JSON.stringify(next));
    editor.setSchema(copy);
    editorChaId = currentChaId;
    if (typeof prof === 'string') editorProfile = prof;
    editorBaseSig = sig(copy);
    editorLoadedSig = editorSig();
  }
  /**
   * 현재 캐릭터에 스키마 설치 (공용 — [설치] 버튼, 세이브 가져오기 부트스트랩).
   * 기존 스키마를 다른 내용으로 덮어쓸 때는 pluginStorage에 자동 백업을 남긴다
   * (캐릭터당 최근 5개, 키: sim:schema-backup:<chaId>:<ts>).
   * ⚠ 스켈레톤(buildPanelSkeleton) 안에 넣지 말 것 (v1.0.7) — renderPanel의 더티 배너
   *   [지금 적용]이 runInstall을 부르는데, 스켈레톤 안이면 바깥에서 참조가 끊겨
   *   "runInstall is not defined"로 죽는다 (실사고 — 번들 첫 실기에서 발견).
   */
  async function installSchemaToCurrentChar(parsed, prof = '', meta = null) {
    const char = await Risuai.getCharacter();
    if (!char) return { ok: false, msg: '캐릭터가 선택되지 않음' };
    char.globalLore = char.globalLore || [];
    let backedUp = false;
    if (prof) {
      // 🔀 프로필 (v1.24.0) — 기본 판에서 달라진 부분만 ⚙simcore:<이름>에. 기본 판은 손대지 않는다
      const baseEntry = char.globalLore.find((l) => l.comment === SCHEMA_LORE_COMMENT);
      if (!baseEntry) return { ok: false, msg: '기본 판(⚙simcore)이 없어 프로필을 저장할 수 없어요 — 기본 판부터 설치하세요' };
      let base;
      try { base = JSON.parse(baseEntry.content); } catch (e) { return { ok: false, msg: '기본 판 JSON 손상: ' + e.message }; }
      const comment = profileMod.profileComment(prof);
      const existing = char.globalLore.find((l) => l.comment === comment);
      let keep = { desc: '', aka: [] };
      if (existing) { const pe = profileMod.parseEntry(existing.content, base); if (!pe.error) keep = { desc: pe.desc, aka: pe.aka }; }
      if (meta && typeof meta.desc === 'string') keep.desc = meta.desc;
      const content = profileMod.entryContent(profileMod.diffSchema(base, parsed), keep);
      if (existing && existing.content !== content) backedUp = await backupProfileEntry(char, existing, '수정');
      if (existing) existing.content = content;
      else char.globalLore.push(schemaLoreEntry(comment, content));
    } else {
      const existing = char.globalLore.find((l) => l.comment === SCHEMA_LORE_COMMENT);
      const content = JSON.stringify(parsed);
      if (existing && existing.content !== content) {
        try {
          const bk = `sim:schema-backup:${char.chaId ?? char.name}:${Date.now()}`;
          await Risuai.pluginStorage.setItem(bk, existing.content);
          const keys = (await Risuai.pluginStorage.keys())
            .filter((k) => k.startsWith(`sim:schema-backup:${char.chaId ?? char.name}:`)).sort();
          for (const k of keys.slice(0, -5)) await Risuai.pluginStorage.removeItem(k);
          backedUp = true;
        } catch (e) { console.log('[simcore] 스키마 백업 실패:', e.message); }
      }
      if (existing) existing.content = content;
      else char.globalLore.push(schemaLoreEntry(SCHEMA_LORE_COMMENT, content));
    }
    // 브리지 자동 동기화 (허용 목록/변수 변경 반영) — 프로필이 있으면 판마다 (v1.24.0)
    if (hasLuaBridge(char)) { const set = bridgeSetForChar(char); if (set) installLuaBridgeOn(char, set); }
    await Risuai.setCharacter(char);
    charKey = null;
    await loadForCurrentChar();
    // 모듈 팩 재확보 (v1.2.3) — 재로드의 자동 스캔은 권한 팝업을 못 띄운다(ask=false).
    // db 권한이 안 잡힌 환경이면 빈손이 되고, 팩 0개면 by:'main' 주입문이 통째로 침묵한다
    // (실사고: "삽입 주체를 메인으로 해도 태그가 안 나옴" — [다시 읽기] 직후엔 되다가
    // 저장하는 순간 사라짐). 설치는 버튼 경로라 권한 팝업을 허용해 한 번 더 스캔한다.
    if (parsed?.assets?.moduleManifests === true) {
      try { await scanModulePacks(true); } catch (e) { console.log('[simcore] 설치 후 모듈 팩 재스캔 실패:', e.message); }
    }
    // 되읽기 레이스 방어 (v0.85.1) — setCharacter 직후의 getCharacter가 아직 옛 캐릭터를
    // 돌려줄 수 있다. 그러면 방금 쓴 스키마 대신 옛 스키마가 다시 로드되고, 더티 배너가
    // "여전히 미반영"으로 되그려져 **적용 버튼이 안 먹히는 것처럼 보인다** (실사고 — 배너의
    // [지금 적용]만 안 먹히는 느낌이고 나중에 누른 [캐릭터에 적용]은 된다는 신고. 시차다).
    // 우리가 무엇을 썼는지는 아니까, 되읽은 것이 그것인지 확인하고 아니면 잠깐 뒤 다시 읽는다.
    // 🔀 대조는 쓴 그 판과 (v1.24.0) — schema는 "이 채팅의 판"이라 다른 판을 고쳤거나 이 채팅이 프로필이면 영영 안 맞는다
    const want = sig(parsed);
    const got = () => sig((prof ? installedSchemaFor(prof) : (profileList.length ? baseSchema : schema)) ?? {});
    for (let i = 0; i < 3 && got() !== want; i++) {
      console.log('[simcore] 설치 되읽기 불일치 — 재시도', i + 1);
      await new Promise((res) => setTimeout(res, 350));
      charKey = null;
      await loadForCurrentChar();
    }
    if (got() !== want) console.log('[simcore] ⚠ 설치 되읽기가 계속 옛 스키마 — 리수 반영 지연');
    return { ok: true, backedUp, brokenProfiles: profileList.filter((p) => !p.ok).map((p) => p.name) };
  }
  /** 🔀 프로필 항목을 바꾸기 전에 남긴다 (v1.24.0) — 캐릭터당 최근 8개, [↶ 되돌리기]가 한 단계씩 쓴다 */
  async function backupProfileEntry(char, entry, why, extra = {}) {
    try {
      const pre = `sim:profile-backup:${char.chaId ?? char.name}:`;
      await Risuai.pluginStorage.setItem(pre + Date.now(), JSON.stringify({ comment: entry.comment, content: entry.content, why, ...extra }));
      const keys = (await Risuai.pluginStorage.keys()).filter((k) => k.startsWith(pre)).sort();
      for (const k of keys.slice(0, -8)) await Risuai.pluginStorage.removeItem(k);
      return true;
    } catch (e) { console.log('[simcore] 프로필 백업 실패:', e.message); return false; }
  }
  // 적용은 두 곳에서 부른다 (v0.78): [편집 작업공간]의 [캐릭터에 적용] 버튼과,
  // 편집 도구 화면 위에 뜨는 더티 배너의 [지금 적용]. 예전엔 작업공간 전용이라
  // 한 칸 고칠 때마다 페이지를 옮겨야 했다 — 배너가 이미 "반영 안 됨"을 알고 있으니
  // 거기서 바로 끝내는 게 맞다. 로직은 한 벌만 둔다.
  async function runInstall(rep) {
    if (!editor) return;
    const parsed = editor.getSchema();
    const v = validateSchema(parsed);
    if (!v.ok) {
      const needsFirstBuild = v.errors.some((x) => x.path === '$.vars' && x.msg === '변수가 하나도 정의되지 않음');
      const title = needsFirstBuild
        ? '작업본을 먼저 만들어 주세요.'
        : `작업본에서 확인할 항목이 ${v.errors.length}개 있어요.`;
      const copy = needsFirstBuild
        ? '아직 설치할 내용이 없어요. [작업도구]의 [AI 어시스턴트]에서 작업본을 만든 뒤 [캐릭터에 적용]을 다시 눌러 주세요.'
        : '세부 내용을 확인해 수정한 뒤 다시 적용해 주세요. [AI 어시스턴트]에서 수정을 요청할 수도 있어요.';
      const details = v.errors.map((x) => '<div class="sc-schema-validation-item">'
        + `<span class="sc-schema-validation-path">${escapeText(x.path)}</span>`
        + `<span class="sc-schema-validation-message">${escapeText(x.msg)}</span>`
        + '</div>').join('');
      rep.innerHTML = `<div class="sc-schema-validation${needsFirstBuild ? ' is-start' : ''}">`
        + `<div class="sc-schema-validation-title">${escapeText(title)}</div>`
        + `<div class="sc-schema-validation-copy">${escapeText(copy)}</div>`
        + `<details><summary>세부 오류 ${v.errors.length}개</summary>${details}</details>`
        + '</div>';
      return;
    }
    const prof = editorProfile; // 🔀 편집기가 고치는 판에만 (v1.24.0)
    const r = await installSchemaToCurrentChar(parsed, prof);
    if (!r.ok) { rep.innerHTML = `<span class="status-bad">${escapeText(r.msg)}</span>`; return; }
    // 방금 설치한 내용 = 이 캐릭터의 설치본 → 편집기 기준선을 여기로 맞춘다 (더 이상 dirty 아님)
    editorChaId = currentChaId;
    editorBaseSig = sig(parsed);
    editorLoadedSig = editorSig();
    const where = prof ? ` — 🔀 '${escapeText(prof)}' 프로필에 (기본 판에서 달라진 부분만 저장)` : (profileList.length ? ' — 기본 판에' : '');
    const broken = !prof && r.brokenProfiles?.length
      ? ` · ⚠ 프로필 ${r.brokenProfiles.length}개(${r.brokenProfiles.slice(0, 3).map(escapeText).join(', ')})가 새 기본 판에 못 얹혀요 — 그 판을 쓰는 채팅은 기본 판으로 돌아요` : '';
    rep.innerHTML = `<span class="status-ok">✓ 설치 완료${where}${v.warnings.length ? ` (경고 ${v.warnings.length}건)` : ''}`
      + `${r.backedUp ? (prof ? ' — 이전 판은 자동 백업됨 ([🔀 프로필 → ↶ 되돌리기])' : ' — 이전 스키마는 자동 백업됨 ([백업 복원]으로 되돌리기 가능)') : ''}${broken}</span>`;
    renderPanel();
  }
  // 편집기 위층(✨ AI에게 맡기기)에 동봉할 봇 컨텍스트.
  // ⚙simcore(스키마) 항목은 뺀다 — 생성 프롬프트에 다이제스트로 이미 실리므로 이중 전송 금지.
  async function getBotContextForEditor() {
    const char = await Risuai.getCharacter();
    if (!char) throw new Error('현재 선택된 캐릭터를 찾지 못했습니다.');
    const all = (char.globalLore || []).filter((l) => !profileMod.isSchemaLore(l)); // 프로필 항목도 (v1.24.0)
    // 📁 폴더 (v1.17.0) — 리수 폴더 = mode:'folder' 항목(key가 폴더 id), 자식은 folder: <그 key>. 봇 제작이 "리수에 있는 폴더"로 보여 주고
    // 그 key로 내보내면 같은 캐릭터로 가져올 때 그 폴더 안으로 들어간다. 폴더 항목은 로어북 목록에서 뺀다(본문이 없다).
    const folders = all.filter((l) => l.mode === 'folder').map((l) => ({ key: String(l.key || ''), name: l.comment || '' })).filter((f) => f.key);
    const nameOf = new Map(folders.map((f) => [f.key, f.name]));
    return {
      name: char.name || '',
      desc: char.desc ?? char.description ?? '', // [live-test] 리수 캐릭터의 설명 필드명
      folders,
      lore: all.filter((l) => l.mode !== 'folder')
        .map((l) => ({ name: l.comment || '', content: l.content || '', ...(l.folder && nameOf.has(l.folder) ? { folder: nameOf.get(l.folder) } : {}) })),
    };
  }

  function ensureEditor() {
    if (editor) return;
    // 🔀 이 채팅이 도는 판의 설치본으로 시작 (v1.24.0 — 못 얹는 프로필도 얹은 모양 그대로: 고치러 연다). 프로필 없는 봇은 예전 그대로 schema
    const target = editorTargetNow();
    editorProfile = target.profile; editorChatProfile = currentProfile ?? '';
    const base = target.schema ? JSON.parse(JSON.stringify(target.schema)) : BLANK_SCHEMA();
    // 모듈 매니페스트로 병합된 팩은 편집·저장 대상이 아니다 — 모듈이 관리한다.
    // 여기서 안 걸러내면 편집기 저장이 스키마에 눌러 붙여 모듈 제거 후에도 유령으로 남는다.
    if (base.assets?.packs) base.assets.packs = base.assets.packs.filter((p) => p.origin !== 'module');
    editor = createSchemaEditor(base);
    editorChaId = currentChaId;
    editorBaseSig = sig(base);
    editorLoadedSig = editorSig();
  }
  /**
   * ⚠ 사고 방지 (2026-07-24 영지봇 스키마 소실 사건): 편집기는 전역이라 캐릭터를 바꾸거나
   * 설치본이 교체돼도(세이브 가져오기 등) 이전 내용이 그대로 남는다. 그 상태로 [설치]를
   * 누르면 현재 캐릭터의 스키마가 엉뚱한 내용으로 덮여 날아간다.
   * - 캐릭터가 바뀌었으면: 무조건 현재 설치본으로 되돌린다 (남의 봇 내용을 들고 있을 이유가 없다).
   * - 같은 캐릭터인데 설치본이 바뀌었으면: 편집기를 손대지 않은 상태일 때만 따라간다.
   *   손댄 상태면 작업물을 지우지 않고, 대신 renderPanel이 경고 배너를 띄운다.
   */
  function syncEditorToChar() {
    if (!editor) return;
    const target = editorTargetNow();
    if (editorChaId !== currentChaId) { loadIntoEditor(target.schema ?? BLANK_SCHEMA(), target.profile); editorChatProfile = currentProfile ?? ''; return; }
    if (editorIsDirty()) return;
    // 🔀 프로필 (v1.24.0) — 손대지 않은 편집기는 채팅이 판을 바꾸면 따라간다. [편집기에 열기]로 일부러 연 다른 판은
    // 채팅이 그대로인 동안 붙잡아 둔다 (늘 "이 채팅의 판"과 대면 열자마자 되돌아간다)
    if (profileList.length && (currentProfile ?? '') !== editorChatProfile) {
      loadIntoEditor(target.schema ?? BLANK_SCHEMA(), target.profile); editorChatProfile = currentProfile ?? ''; return;
    }
    const mine = editorInstalledRef();
    if (editorProfile && !mine) { loadIntoEditor(target.schema ?? BLANK_SCHEMA(), target.profile); editorChatProfile = currentProfile ?? ''; return; } // 고치던 판이 없어졌다
    if (sig(mine ?? BLANK_SCHEMA()) !== editorBaseSig) loadIntoEditor(mine ?? BLANK_SCHEMA());
  }



const P = profileMod;
const BASE = { simcore:'0.1', meta:{name:'봇'}, vars:[{id:'hp',type:'int',label:'체력',init:50}], statusUI:{mode:'auto',groups:[]} };
const MAGE = JSON.parse(JSON.stringify(BASE)); MAGE.vars.push({id:'mana',type:'int',label:'마나',init:30});
const KNIGHT = JSON.parse(JSON.stringify(BASE)); KNIGHT.vars.push({id:'sp',type:'int',label:'기력',init:20});
const entry = (name, sch) => ({ comment: P.profileComment(name), content: P.entryContent(P.diffSchema(BASE, sch)) });
const R = []; const ck = (n,c,x='') => R.push([c,n,x]);
const ids = () => editorContent ? editorContent.vars.map((v) => v.id).join(',') : '';

baseSchema = BASE;
profileList = P.readProfiles(BASE, [entry('마법사', MAGE), entry('검사', KNIGHT)], null);
currentChaId = 'cha'; currentProfile = '마법사'; schema = profileList[0].merged;

// 1. 편집기 최초 생성 = 이 채팅의 판
ensureEditor();
ck('최초 생성 — 이 채팅의 판(마법사)', editorProfile === '마법사' && ids() === 'hp,mana', editorProfile + ' / ' + ids());
ck('★ 얹은 판은 기본 판의 키 순서를 따르는데도 배너 없음 (서명이 키 순서를 안 본다)', !editorDiffersFromInstalled());

// 2. 손대지 않은 편집기 — 채팅이 판을 바꾸면 따라간다
currentProfile = ''; schema = BASE;
syncEditorToChar();
ck('채팅이 기본 판으로 → 편집기도', editorProfile === '' && ids() === 'hp', editorProfile + ' / ' + ids());

// 3. [편집기에 열기]로 다른 판을 일부러 열면 채팅이 그대로인 동안 붙잡는다
loadIntoEditor(installedSchemaFor('검사'), '검사'); editorChatProfile = currentProfile ?? '';
syncEditorToChar();
ck('일부러 연 판은 맞추기가 되돌리지 않는다', editorProfile === '검사' && ids() === 'hp,sp', editorProfile + ' / ' + ids());
ck('연 직후 배너 없음 (그 판의 설치본과 같다)', !editorDiffersFromInstalled());

// 4. ★ 사고 시나리오 — 검사 판을 고치는 중에 채팅이 마법사로 옮겨도 편집기는 검사 판
editor.setSchema(Object.assign({}, editor.getSchema(), { meta:{name:'검사 고침'} }));
currentProfile = '마법사'; schema = profileList[0].merged;
syncEditorToChar();
ck('★ 손댄 편집기는 채팅이 판을 바꿔도 그 판(검사)을 붙잡는다', editorProfile === '검사' && editorContent.meta.name === '검사 고침', editorProfile + ' / ' + editorContent.meta.name);
ck('배너 — 검사 판의 설치본과 다르다', editorDiffersFromInstalled());
ck('[캐릭터에 적용]은 편집기가 고치는 판으로', /const prof = editorProfile;[\s\S]{0,80}installSchemaToCurrentChar\(parsed, prof\)/.test("  let editor = null;\n  let editorChaId = null;      // 편집기 내용이 어느 캐릭터 기준인지\n  let editorLoadedSig = null;  // 편집기에 불러온 직후, 편집기가 빈 칸을 채운 뒤의 서명 (이후 손댔는지 판정용)\n  let editorBaseSig = null;    // 그때 불러온 원본의 서명 (설치본을 불러왔는지 판정용 — 위와 따로 둔다, v1.21.4)\n  // 🔀 프로필 (v1.24.0) — 편집기가 고치는 판. [캐릭터에 적용]은 이 판에만 들어간다 (전엔 \"지금 채팅의 판\"이 받아서,\n  // 검사 판을 열어 둔 채 마법사 채팅으로 옮겨 적용하면 마법사 판이 검사 판으로 덮였다)\n  let editorProfile = '';      // '' = 기본 판\n  let editorChatProfile = '';  // 편집기를 마지막으로 맞출 때 이 채팅의 판 — 채팅이 판을 바꿨는지 알려고\n  const BLANK_SCHEMA = () => ({\n    simcore: '0.1', meta: { name: '새 시뮬레이션' }, vars: [], statusUI: { mode: 'auto', groups: [] },\n  });\n  // 스키마 비교 서명 — 모듈 팩(origin:'module')은 걷어내고 잰다 (v1.2.3): 저장본에 안 실리는\n  // 손님이라, 세면 설치 되읽기·더티 판정이 모듈 팩 봇에서 영영 안 맞는다 (실사고).\n  // 키 순서·편집기 빈 칸은 안 본다 (v1.24.0) — 프로필은 기본 판에 덧칠을 얹어 만드는데, 얹은 판은 기본 판의 키 순서·모양을 따라\n  // 편집기 작업본(빈 칸을 채운 것)과 글자로는 늘 달라 \"반영 안 된 변경\" 배너가 안 꺼졌다. 빈 칸 채우기는 profile.shapeFill = editor normalize\n  const sig = (o) => {\n    try {\n      const c = JSON.parse(JSON.stringify(o));\n      if (c && c.assets && Array.isArray(c.assets.packs)) {\n        c.assets.packs = c.assets.packs.filter((p) => !p || p.origin !== 'module');\n      }\n      return profileMod.shapeSig(c);\n    } catch { return null; }\n  };\n  const editorSig = () => { try { return editor ? sig(editor.getSchema()) : null; } catch { return null; } };\n  /** 편집기 내용이 불러온 뒤 사용자 손을 탔는가 */\n  function editorIsDirty() {\n    return !!editor && editorLoadedSig !== null && editorSig() !== editorLoadedSig;\n  }\n  /** 🔀 이 채팅이 도는 판의 설치본과 이름 — 편집기가 따라갈 기준 (프로필 없는 봇은 예전 그대로 schema) */\n  function editorTargetNow() {\n    if (!profileList.length) return { profile: '', schema };\n    const p = currentProfile ?? '';\n    const s = installedSchemaFor(p);\n    return s ? { profile: p, schema: s } : { profile: '', schema: baseSchema ?? schema };\n  }\n  /** 🔀 편집기가 고치는 판의 설치본 (더티 배너의 기준). 그 판이 없어졌으면 null */\n  function editorInstalledRef() {\n    if (!editorProfile) return profileList.length ? (baseSchema ?? schema) : schema;\n    return installedSchemaFor(editorProfile);\n  }\n  /** 편집기 내용이 설치본과 다른가 (더티 배너) — 손댔거나, 설치본이 아닌 것을 불러왔을 때만.\n   *  편집기는 실을 때 빈 칸(statusUI.groups·rules.events …)을 채우므로 편집기 내용과 설치본을 글자로 대면 늘 다르다 (v1.21.4 —\n   *  생성기 봇(베리디아)은 번들을 넣을 때마다 [지금 적용]을 한 번 더 눌러야 배너가 사라졌다. 적용은 이미 끝난 뒤였다). */\n  function editorDiffersFromInstalled() {\n    if (!editor) return false;\n    const installed = sig(editorInstalledRef() ?? BLANK_SCHEMA());\n    if (editorSig() === installed) return false;\n    return editorIsDirty() || editorBaseSig !== installed;\n  }\n  /** 편집기에 스키마를 싣고 기준선을 갱신. prof를 주면 편집기가 고치는 판도 그것으로 (🔀 v1.24.0) */\n  function loadIntoEditor(next, prof) {\n    // 캐릭터가 바뀌었으면 편집기를 새로 만든다 (v1.16.3) — 인스턴스가 전역이라 캐릭터별 상태(캐릭터 정보 캐시·보낼 것 선택·설정집·\n    // 대화·작업 내역·접힘)가 이전 봇 것으로 남던 것. 사이드바가 가리키는 층은 그대로 복원한다.\n    if (editor && editorChaId !== null && editorChaId !== currentChaId) {\n      const floorBtn = typeof document !== 'undefined' ? document.querySelector('#sc-root .sc-maintab.on[data-page=\"edit\"]') : null;\n      try { editor.destroy(); } catch (e) { console.log('[simcore] 편집기 정리 실패:', e.message); }\n      editor = null;\n      ensureEditor();\n      if (floorBtn && editor) { try { editor.setFloor(floorBtn.dataset.floor || 'top'); } catch { /* 층 복원 실패는 치명적이지 않다 */ } }\n    }\n    ensureEditor();\n    const copy = JSON.parse(JSON.stringify(next));\n    editor.setSchema(copy);\n    editorChaId = currentChaId;\n    if (typeof prof === 'string') editorProfile = prof;\n    editorBaseSig = sig(copy);\n    editorLoadedSig = editorSig();\n  }\n  /**\n   * 현재 캐릭터에 스키마 설치 (공용 — [설치] 버튼, 세이브 가져오기 부트스트랩).\n   * 기존 스키마를 다른 내용으로 덮어쓸 때는 pluginStorage에 자동 백업을 남긴다\n   * (캐릭터당 최근 5개, 키: sim:schema-backup:<chaId>:<ts>).\n   * ⚠ 스켈레톤(buildPanelSkeleton) 안에 넣지 말 것 (v1.0.7) — renderPanel의 더티 배너\n   *   [지금 적용]이 runInstall을 부르는데, 스켈레톤 안이면 바깥에서 참조가 끊겨\n   *   \"runInstall is not defined\"로 죽는다 (실사고 — 번들 첫 실기에서 발견).\n   */\n  async function installSchemaToCurrentChar(parsed, prof = '', meta = null) {\n    const char = await Risuai.getCharacter();\n    if (!char) return { ok: false, msg: '캐릭터가 선택되지 않음' };\n    char.globalLore = char.globalLore || [];\n    let backedUp = false;\n    if (prof) {\n      // 🔀 프로필 (v1.24.0) — 기본 판에서 달라진 부분만 ⚙simcore:<이름>에. 기본 판은 손대지 않는다\n      const baseEntry = char.globalLore.find((l) => l.comment === SCHEMA_LORE_COMMENT);\n      if (!baseEntry) return { ok: false, msg: '기본 판(⚙simcore)이 없어 프로필을 저장할 수 없어요 — 기본 판부터 설치하세요' };\n      let base;\n      try { base = JSON.parse(baseEntry.content); } catch (e) { return { ok: false, msg: '기본 판 JSON 손상: ' + e.message }; }\n      const comment = profileMod.profileComment(prof);\n      const existing = char.globalLore.find((l) => l.comment === comment);\n      let keep = { desc: '', aka: [] };\n      if (existing) { const pe = profileMod.parseEntry(existing.content, base); if (!pe.error) keep = { desc: pe.desc, aka: pe.aka }; }\n      if (meta && typeof meta.desc === 'string') keep.desc = meta.desc;\n      const content = profileMod.entryContent(profileMod.diffSchema(base, parsed), keep);\n      if (existing && existing.content !== content) backedUp = await backupProfileEntry(char, existing, '수정');\n      if (existing) existing.content = content;\n      else char.globalLore.push(schemaLoreEntry(comment, content));\n    } else {\n      const existing = char.globalLore.find((l) => l.comment === SCHEMA_LORE_COMMENT);\n      const content = JSON.stringify(parsed);\n      if (existing && existing.content !== content) {\n        try {\n          const bk = `sim:schema-backup:${char.chaId ?? char.name}:${Date.now()}`;\n          await Risuai.pluginStorage.setItem(bk, existing.content);\n          const keys = (await Risuai.pluginStorage.keys())\n            .filter((k) => k.startsWith(`sim:schema-backup:${char.chaId ?? char.name}:`)).sort();\n          for (const k of keys.slice(0, -5)) await Risuai.pluginStorage.removeItem(k);\n          backedUp = true;\n        } catch (e) { console.log('[simcore] 스키마 백업 실패:', e.message); }\n      }\n      if (existing) existing.content = content;\n      else char.globalLore.push(schemaLoreEntry(SCHEMA_LORE_COMMENT, content));\n    }\n    // 브리지 자동 동기화 (허용 목록/변수 변경 반영) — 프로필이 있으면 판마다 (v1.24.0)\n    if (hasLuaBridge(char)) { const set = bridgeSetForChar(char); if (set) installLuaBridgeOn(char, set); }\n    await Risuai.setCharacter(char);\n    charKey = null;\n    await loadForCurrentChar();\n    // 모듈 팩 재확보 (v1.2.3) — 재로드의 자동 스캔은 권한 팝업을 못 띄운다(ask=false).\n    // db 권한이 안 잡힌 환경이면 빈손이 되고, 팩 0개면 by:'main' 주입문이 통째로 침묵한다\n    // (실사고: \"삽입 주체를 메인으로 해도 태그가 안 나옴\" — [다시 읽기] 직후엔 되다가\n    // 저장하는 순간 사라짐). 설치는 버튼 경로라 권한 팝업을 허용해 한 번 더 스캔한다.\n    if (parsed?.assets?.moduleManifests === true) {\n      try { await scanModulePacks(true); } catch (e) { console.log('[simcore] 설치 후 모듈 팩 재스캔 실패:', e.message); }\n    }\n    // 되읽기 레이스 방어 (v0.85.1) — setCharacter 직후의 getCharacter가 아직 옛 캐릭터를\n    // 돌려줄 수 있다. 그러면 방금 쓴 스키마 대신 옛 스키마가 다시 로드되고, 더티 배너가\n    // \"여전히 미반영\"으로 되그려져 **적용 버튼이 안 먹히는 것처럼 보인다** (실사고 — 배너의\n    // [지금 적용]만 안 먹히는 느낌이고 나중에 누른 [캐릭터에 적용]은 된다는 신고. 시차다).\n    // 우리가 무엇을 썼는지는 아니까, 되읽은 것이 그것인지 확인하고 아니면 잠깐 뒤 다시 읽는다.\n    // 🔀 대조는 쓴 그 판과 (v1.24.0) — schema는 \"이 채팅의 판\"이라 다른 판을 고쳤거나 이 채팅이 프로필이면 영영 안 맞는다\n    const want = sig(parsed);\n    const got = () => sig((prof ? installedSchemaFor(prof) : (profileList.length ? baseSchema : schema)) ?? {});\n    for (let i = 0; i < 3 && got() !== want; i++) {\n      console.log('[simcore] 설치 되읽기 불일치 — 재시도', i + 1);\n      await new Promise((res) => setTimeout(res, 350));\n      charKey = null;\n      await loadForCurrentChar();\n    }\n    if (got() !== want) console.log('[simcore] ⚠ 설치 되읽기가 계속 옛 스키마 — 리수 반영 지연');\n    return { ok: true, backedUp, brokenProfiles: profileList.filter((p) => !p.ok).map((p) => p.name) };\n  }\n  /** 🔀 프로필 항목을 바꾸기 전에 남긴다 (v1.24.0) — 캐릭터당 최근 8개, [↶ 되돌리기]가 한 단계씩 쓴다 */\n  async function backupProfileEntry(char, entry, why, extra = {}) {\n    try {\n      const pre = `sim:profile-backup:${char.chaId ?? char.name}:`;\n      await Risuai.pluginStorage.setItem(pre + Date.now(), JSON.stringify({ comment: entry.comment, content: entry.content, why, ...extra }));\n      const keys = (await Risuai.pluginStorage.keys()).filter((k) => k.startsWith(pre)).sort();\n      for (const k of keys.slice(0, -8)) await Risuai.pluginStorage.removeItem(k);\n      return true;\n    } catch (e) { console.log('[simcore] 프로필 백업 실패:', e.message); return false; }\n  }\n  // 적용은 두 곳에서 부른다 (v0.78): [편집 작업공간]의 [캐릭터에 적용] 버튼과,\n  // 편집 도구 화면 위에 뜨는 더티 배너의 [지금 적용]. 예전엔 작업공간 전용이라\n  // 한 칸 고칠 때마다 페이지를 옮겨야 했다 — 배너가 이미 \"반영 안 됨\"을 알고 있으니\n  // 거기서 바로 끝내는 게 맞다. 로직은 한 벌만 둔다.\n  async function runInstall(rep) {\n    if (!editor) return;\n    const parsed = editor.getSchema();\n    const v = validateSchema(parsed);\n    if (!v.ok) {\n      const needsFirstBuild = v.errors.some((x) => x.path === '$.vars' && x.msg === '변수가 하나도 정의되지 않음');\n      const title = needsFirstBuild\n        ? '작업본을 먼저 만들어 주세요.'\n        : `작업본에서 확인할 항목이 ${v.errors.length}개 있어요.`;\n      const copy = needsFirstBuild\n        ? '아직 설치할 내용이 없어요. [작업도구]의 [AI 어시스턴트]에서 작업본을 만든 뒤 [캐릭터에 적용]을 다시 눌러 주세요.'\n        : '세부 내용을 확인해 수정한 뒤 다시 적용해 주세요. [AI 어시스턴트]에서 수정을 요청할 수도 있어요.';\n      const details = v.errors.map((x) => '<div class=\"sc-schema-validation-item\">'\n        + `<span class=\"sc-schema-validation-path\">${escapeText(x.path)}</span>`\n        + `<span class=\"sc-schema-validation-message\">${escapeText(x.msg)}</span>`\n        + '</div>').join('');\n      rep.innerHTML = `<div class=\"sc-schema-validation${needsFirstBuild ? ' is-start' : ''}\">`\n        + `<div class=\"sc-schema-validation-title\">${escapeText(title)}</div>`\n        + `<div class=\"sc-schema-validation-copy\">${escapeText(copy)}</div>`\n        + `<details><summary>세부 오류 ${v.errors.length}개</summary>${details}</details>`\n        + '</div>';\n      return;\n    }\n    const prof = editorProfile; // 🔀 편집기가 고치는 판에만 (v1.24.0)\n    const r = await installSchemaToCurrentChar(parsed, prof);\n    if (!r.ok) { rep.innerHTML = `<span class=\"status-bad\">${escapeText(r.msg)}</span>`; return; }\n    // 방금 설치한 내용 = 이 캐릭터의 설치본 → 편집기 기준선을 여기로 맞춘다 (더 이상 dirty 아님)\n    editorChaId = currentChaId;\n    editorBaseSig = sig(parsed);\n    editorLoadedSig = editorSig();\n    const where = prof ? ` — 🔀 '${escapeText(prof)}' 프로필에 (기본 판에서 달라진 부분만 저장)` : (profileList.length ? ' — 기본 판에' : '');\n    const broken = !prof && r.brokenProfiles?.length\n      ? ` · ⚠ 프로필 ${r.brokenProfiles.length}개(${r.brokenProfiles.slice(0, 3).map(escapeText).join(', ')})가 새 기본 판에 못 얹혀요 — 그 판을 쓰는 채팅은 기본 판으로 돌아요` : '';\n    rep.innerHTML = `<span class=\"status-ok\">✓ 설치 완료${where}${v.warnings.length ? ` (경고 ${v.warnings.length}건)` : ''}`\n      + `${r.backedUp ? (prof ? ' — 이전 판은 자동 백업됨 ([🔀 프로필 → ↶ 되돌리기])' : ' — 이전 스키마는 자동 백업됨 ([백업 복원]으로 되돌리기 가능)') : ''}${broken}</span>`;\n    renderPanel();\n  }\n  // 편집기 위층(✨ AI에게 맡기기)에 동봉할 봇 컨텍스트.\n  // ⚙simcore(스키마) 항목은 뺀다 — 생성 프롬프트에 다이제스트로 이미 실리므로 이중 전송 금지.\n  async function getBotContextForEditor() {\n    const char = await Risuai.getCharacter();\n    if (!char) throw new Error('현재 선택된 캐릭터를 찾지 못했습니다.');\n    const all = (char.globalLore || []).filter((l) => !profileMod.isSchemaLore(l)); // 프로필 항목도 (v1.24.0)\n    // 📁 폴더 (v1.17.0) — 리수 폴더 = mode:'folder' 항목(key가 폴더 id), 자식은 folder: <그 key>. 봇 제작이 \"리수에 있는 폴더\"로 보여 주고\n    // 그 key로 내보내면 같은 캐릭터로 가져올 때 그 폴더 안으로 들어간다. 폴더 항목은 로어북 목록에서 뺀다(본문이 없다).\n    const folders = all.filter((l) => l.mode === 'folder').map((l) => ({ key: String(l.key || ''), name: l.comment || '' })).filter((f) => f.key);\n    const nameOf = new Map(folders.map((f) => [f.key, f.name]));\n    return {\n      name: char.name || '',\n      desc: char.desc ?? char.description ?? '', // [live-test] 리수 캐릭터의 설명 필드명\n      folders,\n      lore: all.filter((l) => l.mode !== 'folder')\n        .map((l) => ({ name: l.comment || '', content: l.content || '', ...(l.folder && nameOf.has(l.folder) ? { folder: nameOf.get(l.folder) } : {}) })),\n    };\n  }\n\n  function ensureEditor() {\n    if (editor) return;\n    // 🔀 이 채팅이 도는 판의 설치본으로 시작 (v1.24.0 — 못 얹는 프로필도 얹은 모양 그대로: 고치러 연다). 프로필 없는 봇은 예전 그대로 schema\n    const target = editorTargetNow();\n    editorProfile = target.profile; editorChatProfile = currentProfile ?? '';\n    const base = target.schema ? JSON.parse(JSON.stringify(target.schema)) : BLANK_SCHEMA();\n    // 모듈 매니페스트로 병합된 팩은 편집·저장 대상이 아니다 — 모듈이 관리한다.\n    // 여기서 안 걸러내면 편집기 저장이 스키마에 눌러 붙여 모듈 제거 후에도 유령으로 남는다.\n    if (base.assets?.packs) base.assets.packs = base.assets.packs.filter((p) => p.origin !== 'module');\n    editor = createSchemaEditor(base);\n    editorChaId = currentChaId;\n    editorBaseSig = sig(base);\n    editorLoadedSig = editorSig();\n  }\n  /**\n   * ⚠ 사고 방지 (2026-07-24 영지봇 스키마 소실 사건): 편집기는 전역이라 캐릭터를 바꾸거나\n   * 설치본이 교체돼도(세이브 가져오기 등) 이전 내용이 그대로 남는다. 그 상태로 [설치]를\n   * 누르면 현재 캐릭터의 스키마가 엉뚱한 내용으로 덮여 날아간다.\n   * - 캐릭터가 바뀌었으면: 무조건 현재 설치본으로 되돌린다 (남의 봇 내용을 들고 있을 이유가 없다).\n   * - 같은 캐릭터인데 설치본이 바뀌었으면: 편집기를 손대지 않은 상태일 때만 따라간다.\n   *   손댄 상태면 작업물을 지우지 않고, 대신 renderPanel이 경고 배너를 띄운다.\n   */\n  function syncEditorToChar() {\n    if (!editor) return;\n    const target = editorTargetNow();\n    if (editorChaId !== currentChaId) { loadIntoEditor(target.schema ?? BLANK_SCHEMA(), target.profile); editorChatProfile = currentProfile ?? ''; return; }\n    if (editorIsDirty()) return;\n    // 🔀 프로필 (v1.24.0) — 손대지 않은 편집기는 채팅이 판을 바꾸면 따라간다. [편집기에 열기]로 일부러 연 다른 판은\n    // 채팅이 그대로인 동안 붙잡아 둔다 (늘 \"이 채팅의 판\"과 대면 열자마자 되돌아간다)\n    if (profileList.length && (currentProfile ?? '') !== editorChatProfile) {\n      loadIntoEditor(target.schema ?? BLANK_SCHEMA(), target.profile); editorChatProfile = currentProfile ?? ''; return;\n    }\n    const mine = editorInstalledRef();\n    if (editorProfile && !mine) { loadIntoEditor(target.schema ?? BLANK_SCHEMA(), target.profile); editorChatProfile = currentProfile ?? ''; return; } // 고치던 판이 없어졌다\n    if (sig(mine ?? BLANK_SCHEMA()) !== editorBaseSig) loadIntoEditor(mine ?? BLANK_SCHEMA());\n  }\n\n"));

// 5. 고치던 판이 없어지면 (지움) — 손대지 않았다면 이 채팅의 판으로
loadIntoEditor(installedSchemaFor('검사'), '검사'); editorChatProfile = currentProfile ?? '';
profileList = profileList.filter((p) => p.name !== '검사');
syncEditorToChar();
ck('지운 판을 들고 있던 깨끗한 편집기 → 이 채팅의 판', editorProfile === '마법사' && ids() === 'hp,mana', editorProfile + ' / ' + ids());

// 6. 프로필이 하나도 없는 봇은 예전 그대로 (schema 기준)
profileList = []; currentProfile = null; schema = BASE; editorProfile = '';
syncEditorToChar();
ck('프로필 없는 봇 — 예전처럼 schema를 따른다', editorProfile === '' && ids() === 'hp', ids());

let p=0,f=0;
for (const [ok,n,x] of R) { console.log(ok?'PASS':'FAIL', n, ok?'':'→ '+x); ok?p++:f++; }
console.log('\n' + p + ' passed, ' + f + ' failed');
process.exit(f?1:0);

