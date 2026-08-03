
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

