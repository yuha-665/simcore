const __P = (...p) => require('path').resolve(__dirname, ...p);
// 진단 → AI 수정 요청 경로. 핵심은 "고친 것만 돌려주면 나머지가 날아간다"를 막는 장치들.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const { diagnose } = SC.require('diagnose');

const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
const E = new Function('validateSchema', 'TEMPLATES',
  seg + '\nreturn { buildTabExportPrompt, pickTabFragment, tabItemCounts, TAB_SLICES };')(validateSchema, TEMPLATES);

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const cp = (o) => JSON.parse(JSON.stringify(o));
const S = TEMPLATES.survival.schema;

// ── 항목 개수 세기 ──
{
  const c = Object.fromEntries(E.tabItemCounts(S, 'rules'));
  ck('규칙 탭 개수: onTurn', c['rules.onTurn'] === S.rules.onTurn.length, JSON.stringify(c));
  ck('규칙 탭 개수: events', c['rules.events'] === S.rules.events.length, '');
  ck('규칙 탭 개수: randomEvents', c['rules.randomEvents.table'] === S.rules.randomEvents.table.length, '');
  ck('규칙 탭 개수: directives', c['directives'] === S.directives.length, '');
  const cv = Object.fromEntries(E.tabItemCounts(S, 'vars'));
  ck('변수 탭 개수', cv.vars === S.vars.length && cv.derived === S.derived.length, JSON.stringify(cv));
  ck('액션 탭 개수', E.tabItemCounts(S, 'actions')[0][1] === S.actions.length, '');
}

// ── ★ 전체를 달라는 경고가 모든 프롬프트에 있는가 ──
for (const key of ['vars', 'actions', 'rules']) {
  const p = E.buildTabExportPrompt(S, key);
  ck(`'${key}': 통째로 갈아끼운다고 알림`, p.includes('통째로 갈아끼웁니다'), '');
  ck(`★ '${key}': 일부만 주면 나머지가 사라진다고 못박음`, p.includes('나머지가 전부 사라집니다'), '');
  ck(`★ '${key}': 한 세트로 달라고 요구`, p.includes('한 세트로 돌려주세요'), '');
  ck(`★ '${key}': 현재 개수를 체크섬으로 제시`, /- `[\w.]+` \*\*\d+개\*\*/.test(p), '');
  ck(`'${key}': 출력 전 세어보라고 지시`, p.includes('출력하기 전에 세어서 맞는지 확인하세요'), '');
  ck(`'${key}': 의도적 증감은 허용`, p.includes('의도적으로 추가하거나 지운 만큼은 달라져도'), '');
}
{
  const p = E.buildTabExportPrompt(S, 'rules');
  for (const [path, n] of E.tabItemCounts(S, 'rules')) {
    ck(`규칙 프롬프트에 '${path} ${n}개'가 실제로 박힘`, p.includes(`\`${path}\` **${n}개**`), '');
  }
}

// ── 수정 모드 ──
{
  // 결함을 심고 진단 → 그 결과로 수정 프롬프트를 만든다
  const s = cp(S);
  s.rules.events.push({ id: 'impossible', when: 'coal >= 99999', effects: [{ set: 'hope', expr: 'hope' }], notify: 'x' });
  s.actions.push({ id: 'never', label: '🚀 불가', mode: 'oneshot', when: 'coal >= 99999',
    inject: 'x', effects: [{ set: 'hope', expr: 'hope' }] });
  s.vars.push({ id: 'ghost', label: '유령', type: 'int', min: 0, init: 7 });
  const r = diagnose(s, { turns: 25, runs: 3 });
  ck('진단이 돌았다', r.ran, '');

  const byTab = {};
  for (const f of r.findings) if (f.tab) (byTab[f.tab] = byTab[f.tab] || []).push(f);
  ck('★ 지적에 고칠 탭이 붙는다', Object.keys(byTab).length >= 3, JSON.stringify(Object.keys(byTab)));
  ck("죽은 이벤트 → 규칙 탭", byTab.rules?.some((f) => /impossible/.test(f.text)), '');
  ck("못 쓰는 액션 → 액션 탭", byTab.actions?.some((f) => /불가/.test(f.text)), '');
  ck("고정 변수 → 변수 탭", byTab.vars?.some((f) => /ghost/.test(f.text)), '');
  ck('탭이 안 붙는 지적은 난이도 같은 교차 사안뿐',
    // '측정 불가'는 고칠 게 없다는 통지다 — 보조 AI만 건드리는 값은 시뮬로 움직임을 잴 수 없다
    r.findings.filter((f) => !f.tab).every((f) => ['난이도', '설정 의존', '측정 불가'].includes(f.tag)),
    r.findings.filter((f) => !f.tab).map((f) => f.tag).join(', '));

  const fix = E.buildTabExportPrompt(s, 'rules', { findings: r.findings, stats: r.stats });
  ck('★ 수정 모드로 제목이 바뀐다', fix.includes('아래 문제들을 고쳐 주세요'), '');
  ck('★ 문제 목록이 번호로 실린다', /1\. (🔴|🟡|🔵) \*\*\[/.test(fix), '');
  ck('★ 실제 측정값이 실린다', fix.includes('impossible') && /관측 최고 \d+/.test(fix), '');
  ck('★ 몇 턴 × 몇 시드였는지 알려줌', fix.includes('25턴 × 3시드'), '');
  ck('생존율도 함께 넘김', /생존 \d+\/3/.test(fix), '');
  ck('★ 이 탭 밖의 문제면 알려달라고 함', fix.includes('JSON 대신 그 사실을 먼저 알려주세요'), '');
  ck('추가 요청란이 있음', fix.includes('## 추가 요청'), '');
  ck('수정 모드에도 개수 체크섬이 있음', /- `rules\.events` \*\*\d+개\*\*/.test(fix), '');

  // ★ 다른 탭 지적이 새어들어가면 안 된다.
  //   문제 목록은 `**[태그]**` 형태로만 실리므로 그 형태로 확인한다
  //   (설명문에도 "죽은 이벤트" 같은 낱말이 나오므로 맨 문자열 검사는 오탐).
  const tags = (t) => [...t.matchAll(/\*\*\[([^\]]+)\]\*\*/g)].map((m) => m[1]);
  ck('★ 규칙 프롬프트에는 규칙 지적만', tags(fix).every((t) => ['죽은 이벤트', '도배', '경계값', '단조 자원', '눌어붙음', '안 움직임', '검증'].includes(t)),
    [...new Set(tags(fix))].join(', '));
  const fixA = E.buildTabExportPrompt(s, 'actions', { findings: r.findings, stats: r.stats });
  ck('★ 액션 프롬프트에는 액션 지적만', tags(fixA).length > 0 && tags(fixA).every((t) => ['못 쓰는 액션', '함정 액션', '경계값', '안 움직임', '검증'].includes(t)),
    [...new Set(tags(fixA))].join(', '));
  const fixV = E.buildTabExportPrompt(s, 'vars', { findings: r.findings, stats: r.stats });
  ck('★ 변수 프롬프트에는 변수 지적만', /ghost/.test(fixV) && tags(fixV).every((t) => ['고정 변수', '설정 의존', '검증'].includes(t)),
    [...new Set(tags(fixV))].join(', '));
  ck('세 프롬프트의 지적이 서로 겹치지 않음', (() => {
    const a = new Set(tags(fix)), b = new Set(tags(fixA)), c = new Set(tags(fixV));
    return ![...a].some((t) => b.has(t) && t !== '경계값' && t !== '검증' && t !== '안 움직임')
      && ![...a].some((t) => c.has(t));
  })(), '');

  // 수정 모드도 계약·패턴·현재내용을 그대로 유지해야 한다
  ck('수정 모드에도 변수 계약표가 실림', fix.includes('여기 있는 것만'), '');
  ck('수정 모드에도 패턴 카탈로그가 실림', fix.includes('7가지 형태'), '');
  ck('수정 모드에도 현재 내용이 실림', fix.includes('여기서 출발하세요') && fips(fix), '');
  function fips(t) { return t.includes('"fuel_out"'); }
  ck('변수 수정 모드에도 9가지 역할이 실림', fixV.includes('9가지 역할'), '');

  // 지적이 없으면 평소 모드
  const none = E.buildTabExportPrompt(S, 'rules', { findings: [], stats: r.stats });
  ck('지적이 없으면 평소 "만들어 주세요" 모드', none.includes('부분만 만들어 주세요') && none.includes('## 내가 원하는 것'), '');
  ck('opts 없이 불러도 평소 모드', E.buildTabExportPrompt(S, 'rules').includes('## 내가 원하는 것'), '');
}

// ── ★ 개수 급감 감지 (AI가 고친 것만 준 상황) ──
{
  // UI와 같은 판정식
  const dropped = (before, after) => before
    .map(([p, n], i) => [p, n, after[i]?.[1] ?? 0])
    .filter(([, was, now]) => was >= 4 && now < was * 0.6);

  const full = cp(S);
  const partial = cp(S);
  partial.rules.events = partial.rules.events.slice(0, 2);   // "고친 2개만 돌려줌"
  ck('★ 이벤트가 확 줄면 감지된다',
    dropped(E.tabItemCounts(full, 'rules'), E.tabItemCounts(partial, 'rules')).some(([p]) => p === 'rules.events'), '');

  const oneMore = cp(S);
  oneMore.rules.events.push({ id: 'x', when: 'day > 0', effects: [], notify: 'y' });
  ck('정상적인 한두 개 증감은 경고하지 않음',
    dropped(E.tabItemCounts(full, 'rules'), E.tabItemCounts(oneMore, 'rules')).length === 0, '');

  const oneLess = cp(S);
  oneLess.rules.events.pop();
  ck('의도적으로 하나 지운 것도 경고하지 않음',
    dropped(E.tabItemCounts(full, 'rules'), E.tabItemCounts(oneLess, 'rules')).length === 0, '');

  const tiny = { vars: [{ id: 'a', type: 'int', init: 0 }, { id: 'b', type: 'int', init: 0 }], derived: [] };
  ck('원래 항목이 적으면(<4) 경고하지 않음 — 오탐 방지',
    dropped(E.tabItemCounts(tiny, 'vars'), E.tabItemCounts({ vars: [{ id: 'a', type: 'int', init: 0 }], derived: [] }, 'vars')).length === 0, '');

  ck('소스에 그 판정이 실제로 들어감',
    src.includes('was >= 4 && now < was * 0.6') && src.includes('AI가 고친 것만 돌려준 것 같습니다'), '');
}

// ── UI 배선 ──
{
  ck('진단 탭에 탭별 복사 버튼이 있음', src.includes('수정 요청 복사'), '');
  ck('복사 버튼이 findings와 stats를 넘김',
    src.includes('buildTabExportPrompt(schema, key, { findings, stats: diagResult.stats })'), '');
  ck('진단 결과 전체 글 복사도 있음', src.includes('📋 진단 결과 전체를 글로 복사'), '');
  ck('AI로 못 넘기는 지적은 따로 안내', src.includes('직접 고쳐야 합니다'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
