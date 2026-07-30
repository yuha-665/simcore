const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.45 변수 정리 — 참조까지 함께 걷어내기 (재귀 캐스케이드 + 원자성) + OR 병목 + 진단 패치 요청
//
// 배경(실측): 남의 봇을 개조하다 로맨스 템플릿의 1인용 층이 잔재로 남았는데, 그 층을 지우려니
// 참조가 규칙·랜덤이벤트·프롬프트 요약·지시문·새 시작에 흩어져 있었다. 그중 셋(onTurn·
// promptState·setup)은 왕복 패치가 못 다루는 영역이라 삭제가 사실상 불가능했다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { referencedVars } = SC.require('expr');
const { TEMPLATES } = SC.require('templates');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// 편집기의 정리 계층만 뽑아 쓴다 (test-tabai·test-patch와 같은 추출 방식)
const purgeSeg = src.slice(src.indexOf('function exprHits'), src.indexOf('/** AI에게'));
const P = new Function('validateSchema', 'referencedVars',
  purgeSeg + '\nreturn { planVarPurge, stripPlaceholders, exprHits };')(validateSchema, referencedVars);

// ── 실험대: 1인용 잔재 층(affection)이 다섯 탭에 뻗어 있는 봇 ──
const BASE = {
  simcore: '0.1', meta: { name: '정리 실험대' },
  vars: [
    { id: 'affection', label: '호감도', type: 'int', init: 10, min: 0, max: 100 },
    { id: 'noz_aff', label: '노조미 호감', type: 'int', init: 25, min: 0, max: 100 },
    { id: 'day', label: '경과', type: 'int', init: 1, min: 1 },
  ],
  derived: [
    { id: 'closeness', label: '친밀도', expr: 'clamp(affection, 0, 100)' },
    { id: 'deep', label: '더 깊이', expr: 'closeness + 1' },      // 2단 캐스케이드
  ],
  rules: {
    onTurn: [{ set: 'affection', expr: 'max(affection - 1, 0)' }, { set: 'day', expr: 'day + 1' }],
    events: [
      { id: 'to_friend', when: 'affection >= 35', notify: '친구가 됐다.', effects: [] },
      { id: 'live', when: 'noz_aff >= 30', notify: '노조미가 웃었다.', effects: [{ set: 'noz_aff', expr: 'noz_aff + 1' }] },
    ],
    randomEvents: { chancePerTurn: 0.2, table: [{ id: 'r1', weight: 1, when: 'affection > 5', notify: '설렌다.', effects: [] }] },
  },
  directives: [
    { id: 'd1', when: 'affection > 50', text: '가깝다.' },
    { id: 'd2', when: 'day > 3', text: '호감 {affection} · 노조미 {noz_aff}' },
  ],
  actions: [
    { id: 'a1', label: '💗 고백', mode: 'oneshot', when: 'affection >= 60', effects: [] },
    { id: 'a2', label: '💬 대화', mode: 'oneshot', effects: [{ set: 'affection', expr: 'affection + 2' }, { set: 'noz_aff', expr: 'noz_aff + 1' }] },
  ],
  statusUI: { mode: 'auto', groups: [
    { label: '관계', items: [{ var: 'affection' }, { var: 'closeness' }] },
    { label: '입주자', items: [{ var: 'noz_aff' }] },
  ] },
  promptState: { template: '[상태]\n호감 {affection} / 친밀 {closeness}\n노조미 {noz_aff}\n경과 {day}일' },
  setup: { ai: { vars: ['affection', 'noz_aff'] }, presets: [{ id: 'p', label: '보통', set: { affection: 10, noz_aff: 25 } }] },
  updater: { allow: [{ id: 'affection', maxDelta: 5 }, { id: 'noz_aff', maxDelta: 5 }] },
};
ck('실험대 스키마 자체가 유효', validateSchema(BASE).ok,
  validateSchema(BASE).errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
const baseJson = JSON.stringify(BASE);

// ── 핵심: 잔재 층 하나를 지우면 다섯 탭이 함께 정리된다 ──
{
  const r = P.planVarPurge(BASE, ['affection']);
  ck('★ 정리 후 검증 통과 (원자성의 전제)', !r.errors.length, r.errors.join(' / '));
  ck('★ 원본 스키마는 무변 (깊은 사본)', JSON.stringify(BASE) === baseJson, '');

  const n = r.schema;
  ck('변수가 빠짐', n.vars.map((v) => v.id).join(',') === 'noz_aff,day', JSON.stringify(n.vars.map((v) => v.id)));
  ck('★ 파생 2단 캐스케이드 (closeness → deep)', !n.derived.length && r.doomed.join(',') === 'affection,closeness,deep', JSON.stringify(r.doomed));
  ck('매 턴 정산에서 그 줄만 빠짐', n.rules.onTurn.length === 1 && n.rules.onTurn[0].set === 'day', JSON.stringify(n.rules.onTurn));
  ck('★ 조건이 그 값을 보는 이벤트는 통째로', n.rules.events.map((e) => e.id).join(',') === 'live', '');
  ck('랜덤 이벤트도 같은 규칙', !n.rules.randomEvents.table.length, '');
  ck('★ 조건이면 통째, 문장이면 자리표시자만', n.directives.map((d) => d.id).join(',') === 'd2'
    && n.directives[0].text.includes('{noz_aff}') && !n.directives[0].text.includes('{affection}'), JSON.stringify(n.directives));
  ck('액션도 조건이면 통째, 효과면 한 줄만', n.actions.map((a) => a.id).join(',') === 'a2'
    && n.actions[0].effects.length === 1, JSON.stringify(n.actions));
  ck('상태창 항목 제거 + 빈 그룹 정리', n.statusUI.groups.length === 1 && n.statusUI.groups[0].label === '입주자', '');
  ck('★ 프롬프트 요약은 값이 안 남는 줄째 (패치가 못 건드리는 영역)',
    !n.promptState.template.includes('{affection}') && !n.promptState.template.includes('친밀')
    && n.promptState.template.includes('{noz_aff}'), JSON.stringify(n.promptState.template));
  ck('★ 새 시작(setup)도 정리 — AI 최초설정·프리셋', n.setup.ai.vars.join(',') === 'noz_aff'
    && !('affection' in n.setup.presets[0].set), JSON.stringify(n.setup));
  ck('AI 허용 변수도 정리', n.updater.allow.map((a) => a.id).join(',') === 'noz_aff', '');
  ck('사람이 읽는 계획이 나옴', r.notes.length >= 10 && r.notes.every((s) => typeof s === 'string'), String(r.notes.length));
}

// ── 안 쓰이는 변수는 계획이 비어 있다 (그냥 지우면 되는 경우) ──
{
  const S = JSON.parse(baseJson);
  S.vars.push({ id: 'lonely', label: '외톨이', type: 'int', init: 0, min: 0, max: 10 });
  const r = P.planVarPurge(S, ['lonely']);
  ck('★ 아무 데도 안 쓰이면 정리할 자리가 없다', !r.notes.length && !r.errors.length, JSON.stringify(r.notes));
}

// ── 판정: 굴림식이 무너지면 판정 통째로 + 그걸 가리키던 연결도 ──
{
  const S = JSON.parse(baseJson);
  S.checks = [{ id: 'ck', label: '운수', roll: 'rand(1, 20)', mod: 'affection', grades: [{ when: 'roll >= 15', label: '길조' }, { label: '평범' }] }];
  S.actions.push({ id: 'a3', label: '🎲 점', mode: 'oneshot', check: 'ck', effects: [] });
  const r = P.planVarPurge(S, ['affection']);
  ck('★ 굴림식이 지울 값을 쓰면 판정 통째로', !r.schema.checks.length, JSON.stringify(r.schema.checks));
  ck('★ 죽은 판정을 가리키던 액션의 연결도 끊는다', !r.schema.actions.some((a) => a.check), JSON.stringify(r.schema.actions.map((a) => a.check)));
  ck('판정까지 정리해도 검증 통과', !r.errors.length, r.errors.join(' / '));
}

// ── 상태창 커스텀 템플릿(HTML)은 줄을 안 버린다 — 여는 태그만 남으면 깨진다 ──
{
  const one = P.stripPlaceholders('<div>\n<b>호감</b> {affection}\n</div>', new Set(['affection']));
  ck('★ HTML은 자리표시자만 걷고 줄은 남긴다', one.text.split('\n').length === 3 && one.hit, JSON.stringify(one.text));
  const prose = P.stripPlaceholders('호감 {affection}\n노조미 {noz_aff}', new Set(['affection']), true);
  ck('★ 요약문은 값이 안 남는 줄을 버린다', prose.text === '노조미 {noz_aff}', JSON.stringify(prose.text));
  const keep = P.stripPlaceholders('호감 {affection} · 노조미 {noz_aff}', new Set(['affection']), true);
  ck('한 줄에 남는 값이 있으면 줄은 살린다', keep.text.includes('{noz_aff}'), JSON.stringify(keep.text));
  ck('문자열 리터럴 속 같은 낱말에 안 속는다', !P.exprHits('mood == "affection"', new Set(['affection'])), '');
}

// ── 전 템플릿: 아무 변수나 지워도 계획이 성립하거나, 못 하면 이유를 낸다 (터지지 않는다) ──
{
  let crashed = 0, planned = 0;
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const sch = t.schema ?? t;
    for (const v of (sch.vars || []).slice(0, 3)) {
      try { const r = P.planVarPurge(sch, [v.id]); planned++; if (!Array.isArray(r.notes)) crashed++; } catch (e) { crashed++; console.log('  터짐', key, v.id, e.message); }
    }
  }
  ck(`★ 템플릿 12종 × 앞 변수 3개(${planned}건) 정리 계획이 터지지 않는다`, crashed === 0, String(crashed));
}

// ── OR 병목 (v0.45): 갈래는 하나만 되면 되므로 가장 가까운 갈래가 병목이다 ──
{
  const dseg = fs.readFileSync(__P('../core/diagnose.js'), 'utf8');
  const D = new Function(dseg.slice(dseg.indexOf('const CMP ='), dseg.indexOf('/** 이 조건이'))
    + '\nreturn { bottleneck, orBranches };')();
  const obs = { noz_aff: { min: 25, max: 25 }, shi_aff: { min: 30, max: 30 }, hei_aff: { min: 5, max: 5 } };
  const or = D.bottleneck('noz_aff >= 60 or shi_aff >= 60 or hei_aff >= 60', obs);
  ck('★ or는 가장 가까운 갈래를 짚는다 (제일 먼 갈래를 짚던 실측 오판)',
    or.id === 'shi_aff' && or.pct === 50 && or.ofBranches === 3, JSON.stringify(or));
  const and = D.bottleneck('noz_aff >= 60 and hei_aff >= 60', obs);
  ck('and는 가장 안 닿은 항 (기존 동작 유지)', and.id === 'hei_aff' && !and.ofBranches, JSON.stringify(and));
  ck('★ 이미 닿은 갈래가 있으면 병목이 아니다', D.bottleneck('noz_aff >= 10 or hei_aff >= 60', obs) === null, '');
  ck('괄호 안의 or는 가르지 않는다', D.orBranches('(a or b) and c >= 5').length === 1, '');
}

// ── 진단 → AI 요청이 패치 경로로 (v0.45) ──
{
  const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
  const M = new Function('validateSchema', 'TEMPLATES', seg + '\nreturn { buildPatchExportPrompt };')(validateSchema, TEMPLATES);
  const findings = [
    { sev: 'high', tag: '고정 변수', text: "'confessed'를 바꾸는 곳이 하나도 없습니다", tab: 'vars' },
    { sev: 'mid', tag: '죽은 이벤트', text: "'to_acq' 미발동", tab: 'rules' },
    { sev: 'low', tag: '참고', text: 'ZZZ_LOW_MARKER', tab: 'vars' },
  ];
  const p = M.buildPatchExportPrompt(BASE, { findings, stats: { turns: 120, runs: 6 } });
  ck('★ 진단 모드: 지적이 패치 요청에 실린다', p.includes('confessed') && p.includes('to_acq'), '');
  ck('★ 🔵(low)는 안 보낸다 (멀쩡한 설계 보호 — v0.28 원칙)', !p.includes('ZZZ_LOW_MARKER'), '');
  ck('턴·시드 수가 실린다', p.includes('120턴 × 6시드'), '');
  ck('★ 보조 AI 없이 굴린 한계를 알려준다', p.includes('안 움직임'), '');
  ck('패치 미지원 영역 안내', p.includes('onTurn') && p.includes('말로 알려주세요'), '');
  ck('패치 형식·다이제스트는 그대로', p.includes('patchVersion') && p.includes('이미 있는 항목'), '');
  const plain = M.buildPatchExportPrompt(BASE);
  ck('평소(진단 아닌) 모드는 안 바뀜', plain.includes('## 내가 원하는 것') && !plain.includes('진단에서 나온'), '');

  ck('★ 번들: 진단 탭에 패치 요청 버튼이 권장으로', src.includes('수정 패치 요청 복사') && src.includes(') — 권장'), '');
  ck('번들: 통 교체는 전면 재작성용이라고 강등', src.includes('예전 방식(탭 통 교체)'), '');
  ck('★ 번들: 변수 탭에 정리 버튼', src.includes('🧹 정리하고 지우기'), '');
  ck('번들: 정리 되돌리기 1슬롯', src.includes('purgeBackup'), '');
  ck('어댑터 버전 v0.47', src.includes('//@version 0.47'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
