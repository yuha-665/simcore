const __P = (...p) => require('path').resolve(__dirname, ...p);
// 편집기 동기화(syncEditorToChar / dirty 판정) 검증
// 플러그인 본문의 편집기 절을 그대로 떼어내 목 환경에서 실행한다.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const s = src.indexOf('  let editor = null;\n  let editorChaId');
const e = src.indexOf('  function escapeText(s)');
if (s < 0 || e < 0) { console.log('FAIL: 편집기 절을 못 찾음'); process.exit(1); }
// v0.46부터 ai 옵션이 붙어 호출이 여러 줄 — 닫는 });까지 통째로 목 호출로 치환
const body = src.slice(s, e)
  // ⚠ 닫는 자리는 **줄머리 4칸 들여쓰기의 });** 로 잡는다 (v1.5.2). 그냥 첫 `});`로 자르면
  // ai 블록 안의 `|| {});` 같은 평범한 코드에서 잘려 생성 파일이 깨진다 (실사고).
  .replace(/createSchemaEditor\(document\.getElementById\('sc-editor'\), base, \{[\s\S]*?\n {4}\}\);/,
    'createSchemaEditor(base);');

const TESTS = `
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
schema = parsed; editorChaId = currentChaId; editorBaseSig = sig(parsed); editorLoadedSig = editorSig();   // runInstall과 같은 순서
ck('설치 후 dirty 해제', !editorIsDirty());
ck('설치 후 배너 없음', !editorDiffersFromInstalled());

// 10. ★ v1.21.4 — 빈 칸이 빠진 설치본(생성기 봇: 템플릿 상태창이라 statusUI.groups가 없다)을 번들로 넣고 편집기에 실음.
//     편집기는 실을 때 groups: []를 채운다. 옛 판은 그 차이를 "아직 반영 안 됨"으로 봐서 [지금 적용]을 한 번 더 눌러야 했다
const RAW = { simcore:'0.1', meta:{name:'베리디아'}, vars:[{id:'gold',type:'int'}], statusUI:{mode:'template'} };
schema = RAW; currentChaId = 'chaV';
loadIntoEditor(RAW);
ck('편집기는 빈 칸을 채운다 (목도 진짜처럼)', Array.isArray(editorContent.statusUI.groups) && !('groups' in schema.statusUI));
ck('groups 없는 설치본을 실어도 dirty 아님', !editorIsDirty());
ck('groups 없는 설치본을 실어도 배너 없음', !editorDiffersFromInstalled());
syncEditorToChar();
ck('패널 다시 열어도 그대로 (다시 싣지 않음)', name() === '베리디아' && !editorDiffersFromInstalled());
editor.setSchema(Object.assign({}, editor.getSchema(), { meta:{name:'베리디아 수정'} }));
ck('손대면 배너', editorIsDirty() && editorDiffersFromInstalled());
loadIntoEditor(B);
ck('설치본이 아닌 것을 실으면 배너 (손대지 않아도)', !editorIsDirty() && editorDiffersFromInstalled());
loadIntoEditor(RAW); schema = Object.assign({}, RAW, { meta:{name:'다음 번들'} });
ck('설치본이 바뀌면 배너 (되읽기가 늦을 때)', editorDiffersFromInstalled());
syncEditorToChar();
ck('손대지 않았으면 새 설치본을 따라가고 배너 없음', name() === '다음 번들' && !editorDiffersFromInstalled());

let p=0,f=0;
for (const [ok,n,x] of R) { console.log(ok?'PASS':'FAIL', n, ok?'':'→ '+x); ok?p++:f++; }
console.log('\\n' + p + ' passed, ' + f + ' failed');
process.exit(f?1:0);
`;

const harness = `
let editorContent = null;
// 진짜 편집기처럼 실을 때 빈 칸을 채운다 (editor.js normalize의 statusUI.groups 한 줄만 흉내) — v1.21.4 헛배너 재현용
const fill = (x) => { const c = JSON.parse(JSON.stringify(x)); c.statusUI = c.statusUI || { mode: 'auto', groups: [] }; c.statusUI.groups = c.statusUI.groups || []; return c; };
const createSchemaEditor = (base) => {
  editorContent = fill(base);
  return {
    getSchema: () => JSON.parse(JSON.stringify(editorContent)),
    setSchema: (x) => { editorContent = fill(x); },
  };
};
let schema = null, currentChaId = null;
${body}
${TESTS}
`;
const out = path.join(__dirname, '_editorsync_gen.js');
fs.writeFileSync(out, harness, 'utf8');
require(out);
