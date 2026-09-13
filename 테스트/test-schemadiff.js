const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.21 — 작업본 비교(diffSchemas)·줄글(diffText)·패치 노트 요청문(patchNotePrompt) + JSON 관리자 비교 절
// 커뮤니티 제보(에렌샤): "덮어쓰지 말고 비교해서 차이만 AI가 읽으면 패치 노트 초안이 딸칵"
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const P = require(__P('../core/patch.js'));

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));

const A = {
  simcore: '0.1', meta: { name: '봇 0.1' },
  vars: [
    { id: 'gold', label: '금화', type: 'int', init: 100, min: 0 },
    { id: 'fame', label: '명성', type: 'int', init: 0, min: 0 },
    { id: 'hp', label: '체력', type: 'int', init: 100, min: 0, max: 100 },
  ],
  derived: [{ id: 'rich', label: '부자', expr: 'gold >= 500' }],
  rules: { onTurn: [{ set: 'gold', expr: 'gold + 1' }], events: [{ id: 'broke', when: 'gold < 1', notify: 'Broke.' }], randomEvents: { chancePerTurn: 0.1, table: [] } },
  directives: [{ id: 'd1', when: 'true', text: 'Calm.' }],
  actions: [{ id: 'work', label: '노역', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold + 30' }] }],
  updater: { allow: [{ id: 'gold', maxGain: 100 }] },
  statusUI: { mode: 'auto', groups: [] },
};
const B = clone(A);
B.meta.name = '봇 0.2';
B.vars = B.vars.filter((v) => v.id !== 'fame');                                   // 삭제
B.vars.push({ id: 'tax', label: '세금', type: 'int', init: 5, min: 0, group: '경제' }); // 추가
B.vars[0].init = 50; B.vars[0].desc = '시작 금화';                                   // 변경 (init, desc 추가)
B.actions[0].effects[0].expr = 'gold + 40';                                          // 배열 안 변경
B.rules.onTurn.push({ set: 'gold', expr: 'gold - tax' });                            // 통째 영역
B.rules.randomEvents.chancePerTurn = 0.2;
B.updater.allow.push({ id: 'tax' });

console.log('── diffSchemas');
{
  const d = P.diffSchemas(A, B);
  ck('추가: 변수 tax · allow tax', d.added.length === 2 && d.added.some((x) => x.section === 'vars' && x.id === 'tax' && x.name === '세금') && d.added.some((x) => x.section === 'allow' && x.id === 'tax'), J(d.added));
  ck('삭제: 변수 fame', d.removed.length === 1 && d.removed[0].id === 'fame', J(d.removed));
  const g = d.changed.find((x) => x.id === 'gold');
  ck('변경: gold의 init·desc (필드 이름 + 전후값)', g && J(g.fields) === J(['desc', 'init']) && g.before.init === 100 && g.after.init === 50 && g.before.desc === undefined && g.after.desc === '시작 금화', J(g));
  const w = d.changed.find((x) => x.id === 'work');
  ck('변경: 액션 effects (배열 안이 바뀌어도 필드 하나로)', w && J(w.fields) === J(['effects']), J(w));
  ck('변경은 둘뿐 (안 바뀐 hp·rich·broke·d1은 없음)', d.changed.length === 2, J(d.changed.map((x) => x.id)));
  ck('통째 영역: meta · onTurn · 발동률', d.areas.map((x) => x.key).sort().join() === 'meta,onTurn,randomEventsChance', J(d.areas));
  ck('same=false', d.same === false, '');
  const s = P.diffSchemas(A, clone(A));
  ck('같으면 same=true, 목록 전부 빈다', s.same && !s.added.length && !s.removed.length && !s.changed.length && !s.areas.length, J(s));
  ck('한쪽이 비어도 안 죽는다', P.diffSchemas({}, A).added.length === A.vars.length + 1 + 1 + 1 + 1 + 1 && P.diffSchemas(A, {}).removed.length > 0, J(P.diffSchemas({}, A).added.length));
  ck('원본 불변', A.vars.length === 3 && B.vars.length === 3, '');
}

console.log('── diffText · patchNotePrompt');
{
  const d = P.diffSchemas(A, B);
  const t = P.diffText(d, { before: '0.1', after: '0.2', values: false });
  ck('머리·절 제목', t.startsWith('## 0.1 → 0.2 비교') && t.includes('### 추가 2건') && t.includes('### 삭제 1건') && t.includes('### 변경 2건') && t.includes('### 통째로 바뀐 영역 3곳'), t.slice(0, 200));
  ck('항목 줄에 섹션 라벨 + id(이름)', t.includes('- 변수 tax(세금)') && t.includes('- 변수 fame(명성)') && t.includes('- 변수 gold(금화) — desc, init') && t.includes('- 매 턴 정산(onTurn)'), t);
  ck('values:false면 전후값 없음', !t.includes('→ 50'), '');
  const tv = P.diffText(d, { values: true });
  ck('values:true면 전후값', tv.includes('· init: 100 → 50') && tv.includes('· desc: (없음) → "시작 금화"'), tv);
  ck('같으면 한 줄', P.diffText(P.diffSchemas(A, A)).includes('바뀐 것이 없습니다'), '');
  const p = P.patchNotePrompt(d, { before: '지금 작업본(이전 판)', after: '붙여넣은 판(새 판)' });
  ck('패치 노트 요청문: 플레이어 말·⚠·JSON 금지 + 비교 본문(값 포함)', p.includes('플레이어에게 보여줄 패치 노트 초안') && p.includes('⚠') && p.includes('패치 JSON은 붙이지 마세요') && p.includes('## 지금 작업본(이전 판) → 붙여넣은 판(새 판) 비교') && p.includes('· init: 100 → 50'), p.slice(0, 300));
  const long = clone(B); long.vars[0].desc = 'x'.repeat(200);
  ck('긴 값은 80자에서 자른다', P.diffText(P.diffSchemas(A, long), { values: true }).includes('…'), '');
}

console.log('── JSON 관리자 UI 소스');
{
  ck('불러오기 전 확인 상자에 비교 절', src.includes("class: 'sce-fold sce-json-diff'") && src.includes('const d = patchMod.diffSchemas(schema, candidate);'), '');
  ck('어시스턴트 통로: 초안에 넣고 대화 탭으로 (전송은 유저)', src.includes("chat.draft = patchMod.patchNotePrompt(d, { before: '지금 작업본(이전 판)', after: '붙여넣은 판(새 판)' });") && src.includes("activeTab = 'ai'; topTab = 'chat'; rerender();"), '');
  ck('ai 없으면 버튼 없이 복사 위젯만', src.includes("if (ai && ai.generate) {\n            row.appendChild(h('button', { class: 'sce-btn', onclick: () => {\n              chat.draft = patchMod.patchNotePrompt"), '');
  ck('복사 위젯', src.includes("copyWidget('패치 노트 요청문 복사'"), '');
  ck('방향 안내문', src.includes('이전 판 파일을 붙여넣고 "지금 작업본"을 새 판으로 두면 방향이 반대이니'), '');
  ck('CSS', src.includes('.sce .sce-json-diff-text {'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
