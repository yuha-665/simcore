const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.24.0 🔀 프로필 — 편집기가 고치는 판. test-editorsync와 같은 방식으로 플러그인 본문의 편집기 절을 떼어 목 환경에서 돌린다.
// 사고 시나리오(설계 때 짚은 2번): 검사 판을 열어 둔 채 마법사 채팅으로 옮겨 [적용]하면 마법사 판이 검사 판으로 덮인다
//   → 편집기는 연 판(editorProfile)을 붙잡고, 적용은 그 판에만. 손대지 않은 편집기는 채팅이 판을 바꾸면 따라간다.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const s = src.indexOf('  let editor = null;\n  let editorChaId');
const e = src.indexOf('  function escapeText(s)');
if (s < 0 || e < 0) { console.log('FAIL: 편집기 절을 못 찾음'); process.exit(1); }
const body = src.slice(s, e)
  .replace(/createSchemaEditor\(document\.getElementById\('sc-editor'\), base, \{[\s\S]*?\n {4}\}\);/, 'createSchemaEditor(base);');

const TESTS = `
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
ck('[캐릭터에 적용]은 편집기가 고치는 판으로', /const prof = editorProfile;[\\s\\S]{0,80}installSchemaToCurrentChar\\(parsed, prof\\)/.test(${JSON.stringify(body)}));

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
console.log('\\n' + p + ' passed, ' + f + ' failed');
process.exit(f?1:0);
`;

const harness = `
let editorContent = null;
const fill = (x) => { const c = JSON.parse(JSON.stringify(x)); c.statusUI = c.statusUI || { mode: 'auto', groups: [] }; c.statusUI.groups = c.statusUI.groups || []; return c; };
const createSchemaEditor = (base) => {
  editorContent = fill(base);
  return { getSchema: () => JSON.parse(JSON.stringify(editorContent)), setSchema: (x) => { editorContent = fill(x); } };
};
let schema = null, currentChaId = null;
const profileMod = require(${JSON.stringify(path.resolve(__dirname, '../core/profile.js'))});
let profileList = [], currentProfile = null, baseSchema = null;
function installedSchemaFor(name) { if (!name) return baseSchema; const e = profileMod.findProfile(profileList, name); return e ? e.merged : null; }
${body}
${TESTS}
`;
const out = path.join(__dirname, '_profileeditor_gen.js');
fs.writeFileSync(out, harness, 'utf8');
require(out);
