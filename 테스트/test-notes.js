const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.18 — 📌 작업 지침(meta.notes): 대화 프롬프트 맨 앞·요청서 동봉·개조 번들 제외·검증
// 커뮤니티 제보(에렌샤): "AI 가이드에게 매번 되풀이하는 지침을 저장해 두고 답하기 전에 보게"
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const { estTokens } = SC.require('editor');
const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
const M = new Function('validateSchema', 'TEMPLATES', 'timeConfig', 'estTokens',
  seg + '\nreturn { notesLines, buildChatSystemPrompt, buildPatchExportPrompt, buildTabExportPrompt };',
)(validateSchema, TEMPLATES, SC.require('time').timeConfig, estTokens);

const NOTES = '- 실제 제작은 내가 "반영해줘"라고 할 때만.\n- 이번 작업에서 HP는 손대지 말 것.';
const BASE = {
  simcore: '0.1', meta: { name: '지침 실험대', notes: NOTES },
  vars: [{ id: 'gold', label: '금화', type: 'int', init: 100, min: 0 }],
  rules: { events: [{ id: 'broke', when: 'gold < 1', notify: '금고가 비었다.' }] },
  actions: [{ id: 'work', label: '⚒ 노역', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold + 10' }] }],
  statusUI: { mode: 'auto', groups: [] },
};
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── 검증
{
  const v = validateSchema(BASE);
  ck('notes 문자열은 통과·경고 없음', v.ok && !v.warnings.some((w) => w.path === '$.meta.notes'), JSON.stringify(v.errors.concat(v.warnings)));
  const b = clone(BASE); b.meta.notes = 3;
  ck('notes 비문자열 → 오류', validateSchema(b).errors.some((e) => e.path === '$.meta.notes'), '');
  const c = clone(BASE); c.meta.notes = 'x'.repeat(4001);
  ck('4000자 초과 → 경고', validateSchema(c).warnings.some((w) => w.path === '$.meta.notes'), '');
  const d = clone(BASE); delete d.meta.notes;
  ck('없어도 그대로 통과', validateSchema(d).ok, '');
}

// ── 프롬프트
{
  const head = '## 📌 사용자 작업 지침 — 답하기 전에 먼저 읽고 따르세요';
  ck('notesLines: 머리 + 본문 + 빈 줄', M.notesLines(BASE).length === 3 && M.notesLines(BASE)[0].startsWith(head) && M.notesLines(BASE)[1] === NOTES, JSON.stringify(M.notesLines(BASE)));
  ck('notesLines: 비었으면 []', M.notesLines({ meta: { notes: '   ' } }).length === 0 && M.notesLines({}).length === 0, '');
  const sys = M.buildChatSystemPrompt(BASE, '', null);
  ck('대화 시스템 프롬프트 맨 앞이 지침', sys.startsWith(head) && sys.indexOf(NOTES) < sys.indexOf('## 내가 원하는 것'), sys.slice(0, 120));
  ck('대화 프롬프트에 지침이 한 번만 (패치 요청서 쪽 중복 없음)', sys.split(head).length - 1 === 1, String(sys.split(head).length - 1));
  const noN = clone(BASE); delete noN.meta.notes;
  const sys0 = M.buildChatSystemPrompt(noN, '', null);
  ck('지침 없으면 프롬프트에 절이 없다', !sys0.includes(head) && !sys0.startsWith('\n'), sys0.slice(0, 60));
  const pe = M.buildPatchExportPrompt(BASE, { request: '노역 보상을 30으로' });
  ck('패치 요청서: 내가 원하는 것 다음에 지침', pe.includes(head) && pe.indexOf('## 내가 원하는 것') < pe.indexOf(head) && pe.indexOf(head) < pe.indexOf('## 이미 있는 항목'), '');
  const te = M.buildTabExportPrompt(BASE, 'rules');
  ck('탭 요청서(규칙)에도 지침', te.includes(head) && te.includes(NOTES), '');
  const te0 = M.buildTabExportPrompt(noN, 'rules');
  ck('탭 요청서: 지침 없으면 절 없음', !te0.includes(head), '');
}

// ── 개조 번들 — 어댑터 순수 함수 둘을 잘라 실행
{
  const a = src.indexOf('  function stripNotesFromLore(l) {');
  const b = src.indexOf('  /** 번들 형식 검사', a);
  const fn = new Function('SCHEMA_LORE_COMMENT', src.slice(a, b) + '\nreturn bundleFromChar;')('⚙simcore');
  const char = { name: '봇', globalLore: [
    { comment: '⚙simcore', content: JSON.stringify(BASE), key: ' __simcore_never__' },
    { comment: '세계관', content: '{"notes":"이건 로어 원문"}' },
  ], customscript: [] };
  const out = fn(char, '봇');
  const sch = JSON.parse(out.lorebook[0].content);
  ck('번들 스키마 로어에서 notes만 빠진다', sch.meta.notes === undefined && sch.meta.name === '지침 실험대' && sch.vars.length === 1, JSON.stringify(sch.meta));
  ck('다른 로어는 원문 그대로', out.lorebook[1].content === '{"notes":"이건 로어 원문"}' && out.lorebook[1].comment === '세계관', '');
  ck('원본 캐릭터는 안 건드린다', JSON.parse(char.globalLore[0].content).meta.notes === NOTES, '');
  const plain = fn({ name: 'x', globalLore: [{ comment: '⚙simcore', content: '{broken' }], customscript: [] }, 'x');
  ck('깨진 JSON이어도 그대로 싣는다 (안전한 실패)', plain.lorebook[0].content === '{broken', '');
}

// ── 편집기 UI 소스 확인
{
  ck('대화 탭에 📌 작업 지침 접이식 칸', src.includes("class: 'sce-fold sce-chat-notes'") && src.includes("class: 'sce-chat-notes-input'"), '');
  ck('onchange에만 저장 + 빈 값이면 필드 삭제', src.includes('if (v.trim()) schema.meta.notes = v; else delete schema.meta.notes;'), '');
  ck('CSS', src.includes('.sce .sce-chat-notes-input {'), '');
}

let pass = 0, fail = 0;
for (const [c, n, x] of R) { console.log((c ? 'PASS' : 'FAIL'), n, c ? '' : `→ ${x}`); c ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
