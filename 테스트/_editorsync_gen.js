
let editorContent = null;
const createSchemaEditor = (base) => {
  editorContent = JSON.parse(JSON.stringify(base));
  return {
    getSchema: () => JSON.parse(JSON.stringify(editorContent)),
    setSchema: (x) => { editorContent = JSON.parse(JSON.stringify(x)); },
  };
};
let schema = null, currentChaId = null;
  let editor = null;
  let editorChaId = null;      // 편집기 내용이 어느 캐릭터 기준인지
  let editorLoadedSig = null;  // 편집기에 불러온 시점의 내용 서명 (이후 손댔는지 판정용)
  const BLANK_SCHEMA = () => ({
    simcore: '0.1', meta: { name: '새 시뮬레이션' }, vars: [], statusUI: { mode: 'auto', groups: [] },
  });
  const sig = (o) => { try { return JSON.stringify(o); } catch { return null; } };
  const editorSig = () => { try { return editor ? sig(editor.getSchema()) : null; } catch { return null; } };
  /** 편집기 내용이 불러온 뒤 사용자 손을 탔는가 */
  function editorIsDirty() {
    return !!editor && editorLoadedSig !== null && editorSig() !== editorLoadedSig;
  }
  /** 편집기에 스키마를 싣고 기준선을 갱신 */
  function loadIntoEditor(next) {
    ensureEditor();
    const copy = JSON.parse(JSON.stringify(next));
    editor.setSchema(copy);
    editorChaId = currentChaId;
    editorLoadedSig = sig(copy);
  }
  /**
   * 현재 캐릭터에 스키마 설치 (공용 — [설치] 버튼, 세이브 가져오기 부트스트랩).
   * 기존 스키마를 다른 내용으로 덮어쓸 때는 pluginStorage에 자동 백업을 남긴다
   * (캐릭터당 최근 5개, 키: sim:schema-backup:<chaId>:<ts>).
   * ⚠ 스켈레톤(buildPanelSkeleton) 안에 넣지 말 것 (v1.0.7) — renderPanel의 더티 배너
   *   [지금 적용]이 runInstall을 부르는데, 스켈레톤 안이면 바깥에서 참조가 끊겨
   *   "runInstall is not defined"로 죽는다 (실사고 — 번들 첫 실기에서 발견).
   */
  async function installSchemaToCurrentChar(parsed) {
    const char = await Risuai.getCharacter();
    if (!char) return { ok: false, msg: '캐릭터가 선택되지 않음' };
    char.globalLore = char.globalLore || [];
    const existing = char.globalLore.find((l) => l.comment === SCHEMA_LORE_COMMENT);
    const content = JSON.stringify(parsed);
    let backedUp = false;
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
    else char.globalLore.push({
      comment: SCHEMA_LORE_COMMENT, key: ' __simcore_never__', secondkey: '',
      insertorder: 0, content, mode: 'normal', alwaysActive: false, selective: false,
    });
    if (hasLuaBridge(char)) installLuaBridgeOn(char, parsed); // 브리지 자동 동기화 (허용 목록/변수 변경 반영)
    await Risuai.setCharacter(char);
    charKey = null;
    await loadForCurrentChar();
    // 되읽기 레이스 방어 (v0.85.1) — setCharacter 직후의 getCharacter가 아직 옛 캐릭터를
    // 돌려줄 수 있다. 그러면 방금 쓴 스키마 대신 옛 스키마가 다시 로드되고, 더티 배너가
    // "여전히 미반영"으로 되그려져 **적용 버튼이 안 먹히는 것처럼 보인다** (실사고 — 배너의
    // [지금 적용]만 안 먹히는 느낌이고 나중에 누른 [캐릭터에 적용]은 된다는 신고. 시차다).
    // 우리가 무엇을 썼는지는 아니까, 되읽은 것이 그것인지 확인하고 아니면 잠깐 뒤 다시 읽는다.
    const want = sig(parsed);
    for (let i = 0; i < 3 && sig(schema ?? {}) !== want; i++) {
      console.log('[simcore] 설치 되읽기 불일치 — 재시도', i + 1);
      await new Promise((res) => setTimeout(res, 350));
      charKey = null;
      await loadForCurrentChar();
    }
    if (sig(schema ?? {}) !== want) console.log('[simcore] ⚠ 설치 되읽기가 계속 옛 스키마 — 리수 반영 지연');
    return { ok: true, backedUp };
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
    const r = await installSchemaToCurrentChar(parsed);
    if (!r.ok) { rep.innerHTML = `<span class="status-bad">${escapeText(r.msg)}</span>`; return; }
    // 방금 설치한 내용 = 이 캐릭터의 설치본 → 편집기 기준선을 여기로 맞춘다 (더 이상 dirty 아님)
    editorChaId = currentChaId;
    editorLoadedSig = sig(parsed);
    rep.innerHTML = `<span class="status-ok">✓ 설치 완료${v.warnings.length ? ` (경고 ${v.warnings.length}건)` : ''}${r.backedUp ? ' — 이전 스키마는 자동 백업됨 ([백업 복원]으로 되돌리기 가능)' : ''}</span>`;
    renderPanel();
  }
  // 편집기 위층(✨ AI에게 맡기기)에 동봉할 봇 컨텍스트.
  // ⚙simcore(스키마) 항목은 뺀다 — 생성 프롬프트에 다이제스트로 이미 실리므로 이중 전송 금지.
  async function getBotContextForEditor() {
    const char = await Risuai.getCharacter();
    if (!char) throw new Error('현재 선택된 캐릭터를 찾지 못했습니다.');
    return {
      name: char.name || '',
      desc: char.desc ?? char.description ?? '', // [live-test] 리수 캐릭터의 설명 필드명
      lore: (char.globalLore || [])
        .filter((l) => l.comment !== SCHEMA_LORE_COMMENT)
        .map((l) => ({ name: l.comment || '', content: l.content || '' })),
    };
  }

  function ensureEditor() {
    if (editor) return;
    const base = schema ? JSON.parse(JSON.stringify(schema)) : BLANK_SCHEMA();
    // 모듈 매니페스트로 병합된 팩은 편집·저장 대상이 아니다 — 모듈이 관리한다.
    // 여기서 안 걸러내면 편집기 저장이 스키마에 눌러 붙여 모듈 제거 후에도 유령으로 남는다.
    if (base.assets?.packs) base.assets.packs = base.assets.packs.filter((p) => p.origin !== 'module');
    editor = createSchemaEditor(base);
    editorChaId = currentChaId;
    editorLoadedSig = sig(base);
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
    if (editorChaId !== currentChaId) { loadIntoEditor(schema ?? BLANK_SCHEMA()); return; }
    if (!editorIsDirty() && sig(schema ?? BLANK_SCHEMA()) !== editorLoadedSig) {
      loadIntoEditor(schema ?? BLANK_SCHEMA());
    }
  }



const A = { simcore:'0.1', meta:{name:'영지'},  vars:[{id:'food',type:'int'}], statusUI:{mode:'auto',groups:[]} };
const B = { simcore:'0.1', meta:{name:'RPG'},   vars:[{id:'hp',type:'int'}],   statusUI:{mode:'auto',groups:[]} };
const C = { simcore:'0.1', meta:{name:'다른봇'}, vars:[{id:'x',type:'int'}],    statusUI:{mode:'auto',groups:[]} };
const R = []; const ck = (n,c,x='') => R.push([c,n,x]);
const name = () => editorContent && editorContent.meta.name;

// 1. 캐릭터 A에서 편집기 최초 생성
schema = A; currentChaId = 'chaA';
ensureEditor();
ck('최초 생성 시 설치본 로드', name() === '영지', name());
ck('갓 로드된 편집기는 dirty 아님', !editorIsDirty());

// 2. 템플릿을 편집기에 불러옴 (설치는 안 함)
editor.setSchema(JSON.parse(JSON.stringify(B)));
ck('템플릿 로드하면 dirty', editorIsDirty());
ck('설치본은 그대로', schema.meta.name === '영지');

// 3. 같은 캐릭터에서 패널 재오픈 → 작업물 보존
syncEditorToChar();
ck('dirty면 패널 재오픈해도 작업물 보존', name() === 'RPG', name());

// 4. ★ 사용자 시나리오: 세이브 가져오기로 설치본이 영지로 복원됨
schema = A;
loadIntoEditor(schema);
ck('스키마 복원 시 편집기도 복원본', name() === '영지', name());
ck('복원 직후 dirty 아님', !editorIsDirty());

// 5. 편집기 깨끗한 상태에서 설치본만 바뀜 → 따라감
schema = B;
syncEditorToChar();
ck('편집기 깨끗하면 설치본 변경을 따라감', name() === 'RPG', name());

// 6. 편집기 손댄 상태에서 설치본 바뀜 → 작업물 보존
editor.setSchema(Object.assign({}, B, { meta:{name:'작업중'} }));
schema = A;
syncEditorToChar();
ck('편집기 dirty면 설치본 바뀌어도 보존', name() === '작업중', name());

// 7. ★ 어제 사고 재현 방지: 다른 캐릭터로 전환 → 남의 내용 강제 폐기
currentChaId = 'chaB'; schema = C;
syncEditorToChar();
ck('캐릭터 전환 시 남의 편집 내용 폐기', name() === '다른봇', name());
ck('전환 후 dirty 아님', !editorIsDirty());

// 8. 스키마 없는 캐릭터로 전환
currentChaId = 'chaC'; schema = null;
syncEditorToChar();
ck('스키마 없는 캐릭터 → 빈 스키마', name() === '새 시뮬레이션' && editorContent.vars.length === 0, name());

// 9. [설치] 버튼 경로: 설치 후 기준선 갱신 → dirty 해제
schema = A; currentChaId = 'chaA';
loadIntoEditor(A);
editor.setSchema(Object.assign({}, A, { meta:{name:'영지v2'} }));
ck('수정하면 dirty', editorIsDirty());
const parsed = editor.getSchema();
schema = parsed; editorChaId = currentChaId; editorLoadedSig = sig(parsed);
ck('설치 후 dirty 해제', !editorIsDirty());

let p=0,f=0;
for (const [ok,n,x] of R) { console.log(ok?'PASS':'FAIL', n, ok?'':'→ '+x); ok?p++:f++; }
console.log('\n' + p + ' passed, ' + f + ' failed');
process.exit(f?1:0);

