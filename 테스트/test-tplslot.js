const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.7.4 — 커스텀 템플릿 봇에서 AI 창구가 헛돌던 문제 (실기 제보).
//
// 제보: "특성 변수를 추가하고 상태창에도 넣었는데 표시가 안 된다. 얼헌은 조건부 스타일에
//        넣어야 적용되더라. AI 작업은 조건부 스타일을 안 건드리는 것 같고, 메인에서
//        작업을 다 끝내도 실질적으로 안 보였다 — 조건부 스타일이 덮어버리니까."
//
// 뿌리는 하나가 아니라 넷이었다. 렌더러는 템플릿 모드면 groups 분기를 아예 안 도는데,
//  ① 상태창 탭 AI 창구는 groups만 쓴다 → 편집기엔 추가돼 보이고 화면엔 없다.
//  ② 배치 규격서가 `ui.template`만 봐서, templates[]에만 있는 봇엔 "자동 배치를 쓰고 있습니다"로 나갔다.
//  ③ 그 결과도 `ui.template`에 꽂혔다 — pickTemplate은 templates[]를 먼저 보므로 영영 안 그려진다.
//     ("✅ 적용됐습니다"가 뜨는데 화면은 그대로" = 제보자가 겪은 그 증상)
//  ④ 진단은 groups를 '보이는 것'으로 세서 조용했다 — 거짓 안심이 가장 오래 헤매게 만든다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const ed = SC.require('editor');
const { diagnose } = SC.require('diagnose');
const { TEMPLATES } = SC.require('templates');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const base = (statusUI) => ({
  simcore: '0.1', meta: { name: '틀' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50 },
    { id: 'trait', label: '특성', type: 'list', init: [] }],
  statusUI,
});

// ── ① 지금 그려지는 칸을 짚는다 — 렌더러와 같은 자리여야 한다 ──
const uncond = base({ mode: 'template', templates: [{ id: 'main', template: '<div>{hp}</div>' }] });
ck('★ templates[]에만 있는 봇 — 그 칸을 짚는다 (자동 배치라고 하지 않는다)', (() => {
  const s = ed.activeTemplateSlot(uncond);
  return s && s.kind === 'templates' && s.i === 0 && s.id === 'main' && s.text.includes('{hp}');
})(), JSON.stringify(ed.activeTemplateSlot(uncond)));

const legacy = base({ mode: 'template', template: '<div>구버전 {hp}</div>' });
ck('구버전 template 칸만 있으면 그쪽', (() => {
  const s = ed.activeTemplateSlot(legacy);
  return s && s.kind === 'template' && s.text.includes('구버전');
})(), '');

const cond = base({ mode: 'template', templates: [
  { id: 'war', when: 'hp < 10', template: '<div>전시 {hp}</div>' },
  { id: 'calm', template: '<div>평시 {hp}</div>' }] });
ck('★ 조건부 여러 장 — 시작 상태에서 실제로 그려질 장을 고른다 (hp 50 → 평시)', (() => {
  const s = ed.activeTemplateSlot(cond);
  return s && s.id === 'calm' && s.count === 2;
})(), JSON.stringify(ed.activeTemplateSlot(cond)?.id));

ck('템플릿 모드지만 아무것도 안 채워졌으면 null (렌더러도 그룹으로 되돌아간다)',
  ed.activeTemplateSlot(base({ mode: 'template', templates: [] })) === null, '');
ck('자동 구성 봇은 null (그룹 창구가 정상이다)',
  ed.activeTemplateSlot(base({ mode: 'auto', groups: [] })) === null, '');

// ── ② 배치 규격서 — 보여주는 것과 들어가는 칸이 같아야 한다 ──
const pUncond = ed.buildLayoutSpecPrompt(uncond, '위쪽에 체력 게이지');
ck('★ 규격서에 지금 쓰는 템플릿이 실린다', pUncond.includes('## 지금 쓰는 템플릿')
  && pUncond.includes('<div>{hp}</div>'), pUncond.slice(-200));
ck('★ "자동 배치를 쓰고 있습니다" 오안내가 사라졌다 (AI가 백지에서 새로 짜던 원인)',
  !pUncond.includes('지금은 자동 배치를 쓰고 있습니다'), '');
const pCond = ed.buildLayoutSpecPrompt(cond, '위쪽에 체력 게이지');
ck('★ 여러 장이면 어느 장을 고치는지 이름으로 못박는다',
  pCond.includes('조건부 템플릿 2장') && pCond.includes('`calm`'), '');
ck('자동 구성 봇에는 종전대로 자유 구성을 안내',
  ed.buildLayoutSpecPrompt(base({ mode: 'auto', groups: [] }), '')
    .includes('지금은 자동 배치를 쓰고 있습니다'), '');

// ── ③ 상태창 탭 요청서 — 헛도는 창구라는 걸 먼저 말한다 ──
const tabTpl = ed.buildTabExportPrompt(uncond, 'status');
ck('★ 템플릿 모드면 "groups는 그려지지 않는다"를 첫머리에 못박는다',
  tabTpl.includes('이 봇의 상태창은 커스텀 템플릿입니다')
  && tabTpl.includes('화면에 그려지지 않습니다'), '');
ck('배치를 맡을 다른 창구를 이름으로 알려준다', tabTpl.includes('배치까지'), '');
ck('자동 구성 봇에는 그 경고가 없다 (오탐)',
  !ed.buildTabExportPrompt(base({ mode: 'auto', groups: [] }), 'status')
    .includes('이 봇의 상태창은 커스텀 템플릿입니다'), '');

// ── ④ 진단 — 거짓 안심을 없앤다 ──
const ghost = base({ mode: 'template',
  templates: [{ id: 'main', template: '<div>{hp}</div>' }],
  groups: [{ label: '특성', items: [{ var: 'trait' }] }] });
const gf = (sc) => (diagnose(sc, { turns: 30, runs: 2 }).findings || []).filter((f) => /표시 그룹에/.test(f.text));
ck('★ 템플릿 모드인데 그룹에 넣어둔 변수 — 안 나온다고 알려준다 (제보 재현)', (() => {
  const hits = gf(ghost);
  return hits.length === 1 && hits[0].text.includes('trait') && hits[0].tab === 'status';
})(), JSON.stringify(gf(ghost).map((f) => f.text)));
ck('템플릿 HTML 안에 들어 있는 변수는 지적하지 않는다', gf(base({ mode: 'template',
  templates: [{ id: 'main', template: '<div>{hp} {trait:tags}</div>' }],
  groups: [{ label: 'x', items: [{ var: 'trait' }, { var: 'hp' }] }] })).length === 0, '');
ck('자동 구성 봇은 지적하지 않는다',
  gf(base({ mode: 'auto', groups: [{ label: 'x', items: [{ var: 'trait' }, { var: 'hp' }] }] })).length === 0, '');
ck('★ 내장 템플릿 16종 오탐 0 (규칙 #5)', (() => {
  let fired = 0;
  for (const t of Object.values(TEMPLATES)) {
    const sc = JSON.parse(JSON.stringify(typeof t.schema === 'function' ? t.schema() : t.schema));
    if (gf(sc).length) fired++;
  }
  return fired === 0;
})(), '');

// ── ⑤ 실물 얼헌 — 제보가 난 그 봇 ──
const hunterPath = __P('../얼헌/헌터-신안.json');
if (fs.existsSync(hunterPath)) {
  const hunter = JSON.parse(fs.readFileSync(hunterPath, 'utf8'));
  const hs = ed.activeTemplateSlot(hunter);
  ck('★ 얼헌 — templates[0] "hunter"를 짚는다', hs && hs.kind === 'templates' && hs.i === 0 && hs.id === 'hunter',
    JSON.stringify(hs && { kind: hs.kind, id: hs.id }));
  const hp = ed.buildLayoutSpecPrompt(hunter, '가호 배너를 위로');
  ck('★ 얼헌 — 규격서가 원본 템플릿을 통째로 싣는다 (백지에서 새로 짜지 않는다)',
    hp.includes(hs.text.slice(0, 80)), '');
  ck('얼헌 — 상태창 탭 요청서에 템플릿 모드 경고', ed.buildTabExportPrompt(hunter, 'status')
    .includes('이 봇의 상태창은 커스텀 템플릿입니다'), '');
} else {
  ck('얼헌 스키마 없음 — 건너뜀', true, '');
}

// ── ⑥ 적용 경로 (정적) — 규격서가 보여준 그 칸에 넣는다 ──
ck('★ 생성 결과를 templates[] 그 칸에 쓴다',
  src.includes("if (slot && slot.kind === 'templates') ui.templates[slot.i].template = tpl;"), '');
ck('★ 되돌리기가 templates[]까지 떠 놓는다',
  src.includes('templates: ui.templates ? JSON.parse(JSON.stringify(ui.templates)) : undefined')
  && src.includes('if (cssBackup.templates) schema.statusUI.templates = JSON.parse(JSON.stringify(cssBackup.templates));'), '');
ck('★ 검증 실패 롤백도 templates[]를 되돌린다',
  src.includes('const restoreBackup = () =>') && src.includes('      restoreBackup();\n      cssBackup = null;'), '');
ck('상태창 탭 창구에 사람이 읽는 경고 배너',
  src.includes("if (tabKey === 'status' && activeTemplateSlot(schema)) {")
  && src.includes('여기서 만드는 표시 그룹은 화면에 그려지지 않아요'), '');

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
