const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.14 — 변수 그룹(group): 편집기에서 화면만 묶는다. 저장 순서·동작·패치는 그대로
// 커뮤니티 제보: "변수가 늘수록 순서가 뒤죽박죽 — 상태창처럼 그룹으로 묶고 싶다"
const fs = require('fs');
const { validateSchema } = require(__P('../core/validate.js'));
const engine = require(__P('../core/engine.js'));
const P = require(__P('../core/patch.js'));
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));

const S = {
  simcore: '0.1', meta: { name: '그룹' },
  vars: [
    { id: 'gold', label: '금화', type: 'int', init: 0, min: 0, group: '경제' },
    { id: 'hp', label: '체력', type: 'int', init: 100, min: 0, max: 100 },
    { id: 'tax', label: '세금', type: 'int', init: 10, min: 0, group: '경제' },
    { id: 'liana_aff', label: '리아나 호감', type: 'int', init: 0, group: '인물-리아나' },
  ],
  derived: [{ id: 'rich', label: '부자', expr: 'gold >= 100', group: '경제' }],
  updater: { allow: [{ id: 'gold' }, { id: 'hp' }] },
};

console.log('── 검증');
{
  const v = validateSchema(S);
  ck('표본 통과 · 경고 없음', v.ok && v.warnings.length === 0, J(v.errors.concat(v.warnings)));
  const b = clone(S); b.vars[0].group = 3;
  ck('group 비문자열 → 오류', validateSchema(b).errors.some((e) => e.path === '$.vars[0].group'), '');
  const c = clone(S); c.vars[0].group = '   ';
  ck('빈 group → 경고', validateSchema(c).warnings.some((w) => w.path === '$.vars[0].group'), '');
  const d = clone(S); d.derived[0].group = 'x'.repeat(41);
  ck('40자 초과 → 경고 (파생도)', validateSchema(d).warnings.some((w) => w.path === '$.derived[0].group'), '');
  const e = clone(S); e.vars.forEach((x) => delete x.group); delete e.derived[0].group;
  ck('그룹 없는 스키마는 그대로 통과', validateSchema(e).ok, '');
}

console.log('── 엔진·패치는 group을 모른다 (보기용)');
{
  const st = engine.initState(S);
  ck('initState에 group이 새지 않는다', !('group' in st.vars) && st.vars.gold === 0, J(Object.keys(st.vars)));
  const r = P.applyPatch(S, P.parsePatch(J({ patchVersion: 1, update: { vars: [{ id: 'hp', label: '체력', type: 'int', init: 90, group: '전투' }] } })).patch);
  ck('패치 update가 group을 실어 오면 그대로 남는다', r.ok && r.schema.vars.find((v) => v.id === 'hp').group === '전투', J(r.errors));
  const r2 = P.applyPatch(S, P.parsePatch(J({ patchVersion: 1, update: { vars: [{ id: 'gold', label: '금화', type: 'int', init: 5 }] } })).patch);
  ck('update가 group을 빠뜨리면 풀린다 (전문 교체 계약 — 규격이 빠뜨리지 말라고 경고)', r2.ok && r2.schema.vars.find((v) => v.id === 'gold').group === undefined, '');
  ck('저장 순서는 그룹과 무관하게 그대로', r.schema.vars.map((v) => v.id).join() === 'gold,hp,tax,liana_aff', '');
}

console.log('── 편집기');
{
  ck('그룹 접힘 Set (이름 키)', src.includes('const collapsedVarGroups = new Set();'), '');
  ck('groupField — 카드의 [그룹] 칸 + datalist 제안', src.includes("return variableField('그룹', inp,") && src.includes("inp.setAttribute('list', groupDl);") && src.includes("h('datalist', { id: groupDl }"), '');
  ck('빈 값이면 group 필드를 지운다', src.includes('const t = String(x).trim(); if (t) item.group = t; else delete item.group; rerender();'), '');
  ck('변수·파생 카드 둘 다 그룹 칸', src.includes('groupField(v));') && src.includes('groupField(d)), derivedNow(d)'), '');
  ck('groupedAppend — 그룹 없으면 평면 그대로', src.includes('if (!names.length) { cards.forEach((c) => container.appendChild(c)); return; }'), '');
  ck('그룹 없음은 맨 아래 점선 절', src.includes("if (none.length) container.appendChild(section('', none));") && src.includes('.sce .sce-var-group.is-none { border-style:dashed; }'), '');
  ck('절 머리: 이름 칸(그룹 전부 개명)·개수·모두 접기/펼치기·절 접기', src.includes("list.forEach((it) => { if (it && it.group === name) { if (t) it.group = t; else delete it.group; } });")
    && src.includes("rows.forEach((r) => collapsedVariableCards.add(r.it)); rerender(); } }, '모두 접기')")
    && src.includes("if (folded) collapsedVarGroups.delete(name || ''); else collapsedVarGroups.add(name || ''); rerender();"), '');
  ck('변수·파생 목록이 groupedAppend를 거친다', src.includes('groupedAppend(variableList, schema.vars, varCards);') && src.includes('groupedAppend(derivedList, schema.derived, derivedCards);'), '');
  ck('순서 이동은 저장 순서 기준 힌트', src.includes('그룹은 보기용이에요. 순서 이동(⠿·위/아래)은 저장 순서 기준으로 움직입니다.'), '');
  ck('CSS 그룹 절', src.includes('.sce .sce-var-group {') && src.includes('.sce .sce-var-group-tools { display:flex; gap:6px; margin-left:auto; }'), '');
}

console.log('── 규격서·다이제스트');
{
  ck('변수 필드 표에 group 행', src.includes("'| `group` | (선택) 편집기에서 묶어 보여 주는 그룹 이름"), '');
  ck('패치 규칙: 새 변수엔 가장 가까운 그룹, update 때 유지', src.includes('새 변수·파생에는 `group`을 붙이세요') && src.includes('기존 `group`을 빠뜨리지 마세요'), '');
  ck('변수 계약표 아래 그룹 한 줄 코드', src.includes("out.push('', '그룹(`group`, 편집기 묶음 — 새 항목엔 가장 가까운 그룹을 붙이고 update 때 유지): '"), '');
  // 실물 — 계약표 함수를 번들에서 잘라 실행 (timeConfig·EXPOSED_LABELS 주입)
  const start = src.indexOf('function varContractTable(schema) {');
  const end = src.indexOf('\n}\n', start) + 3;
  const time = require(__P('../core/time.js'));
  const fn = new Function('timeConfig', 'EXPOSED_LABELS', src.slice(start, end) + '\nreturn varContractTable;')(time.timeConfig, time.EXPOSED_LABELS);
  const txt = fn(S);
  ck('계약표 실물: 그룹 줄에 경제(gold, tax, rich) · 인물-리아나(liana_aff)', txt.includes('**경제**(gold, tax, rich)') && txt.includes('**인물-리아나**(liana_aff)'), txt.split('\n').slice(-3).join(' | '));
  ck('계약표 실물: hp는 어느 그룹에도 없다', !/\(([^)]*\bhp\b[^)]*)\)/.test(txt.split('그룹(')[1] || ''), '');
  const none = clone(S); none.vars.forEach((x) => delete x.group); delete none.derived[0].group;
  ck('그룹 없으면 그룹 줄이 없다', !fn(none).includes('그룹(`group`'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
