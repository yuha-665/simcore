const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.73 낱말 게이트 어휘장 — 규격서·편집기·검증기가 "유의어를 걸리는 꼴로" 가르치는지.
//
// 배경: 내장 템플릿 16종에 mentions 실물이 0건이라 규격서가 유일한 교재인데, v0.72까지는
// 규격서에도 한 줄이 없었다. 그리고 개발 중 발밑 확인이 첫 지침의 오류를 잡았다 —
// "어간으로 적어라"는 틀린 조언이다. 부분일치는 음절 단위라 "다치었다"→"다쳤다" 축약에서
// 어간 음절이 사라진다("다치"는 "다쳤다"에 안 걸린다). 옳은 요령은 끝의 '다'만 떼기("다쳤")
// + 자주 나오는 꼴 나열("다쳤, 다친, 다치")이고, 이 파일은 그 사실 자체를 엔진 실측으로
// 고정한다 — 지침이 다시 "어간"으로 돌아가면 여기가 막는다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const engine = SC.require('engine');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const mk = (mentions) => ({
  simcore: '0.1', meta: { name: '어휘장 실험대' },
  vars: [{ id: 'injury', label: '부상', type: 'int', init: 0, min: 0, max: 10 }],
  updater: { allow: [{ id: 'injury', maxDelta: 3, ...(mentions !== undefined ? { mentions } : {}) }] },
});
const conjWarns = (v) => v.warnings.filter((w) => w.msg.includes('그 꼴 그대로'));

// ── 검증기: 문장 종결형 경고 ──
{
  const v = validateSchema(mk(['부상', '다쳤다']));
  ck('★ 종결형 낱말("다쳤다")에 "끝의 다를 떼라" 경고', v.ok && conjWarns(v).length === 1
    && conjWarns(v)[0].msg.includes("끝의 '다'를 떼세요") && conjWarns(v)[0].msg.includes('"다쳤"'),
    JSON.stringify(v.warnings));
  ck('★ 뗀 꼴(다쳤·다친·부상·절뚝)은 경고 없음',
    conjWarns(validateSchema(mk(['부상', '다쳤', '다친', '절뚝']))).length === 0, '');
  ck('★ mentions: true(인물 이름 패턴)는 경고 없음 — "1개뿐 경고" 폐기의 근거',
    conjWarns(validateSchema(mk(true))).length === 0, '');
  ck('명사 "바다"는 안 잡는다 (과거형 축약 음절만)',
    conjWarns(validateSchema(mk(['바다', '항해']))).length === 0, '');
  const one = validateSchema(mk(['부', '다쳤다']));
  ck('한 글자 경고가 우선 (기존 동작 유지)', one.warnings.some((w) => w.msg.includes('한 글자'))
    && conjWarns(one).length === 0, '');
}

// ── 규칙 #5: 템플릿 16종 전수 오탐 0 ──
{
  const keys = Object.keys(TEMPLATES);
  ck('템플릿 16종 로드', keys.length === 16, `${keys.length}종`);
  const bad = keys.filter((k) => conjWarns(validateSchema(TEMPLATES[k].schema)).length > 0);
  ck('★ 종결형 경고 오탐 0 — 전 템플릿', bad.length === 0, bad.join(', '));
}

// ── 발밑 확인: 부분일치의 실제 폭 — 지침의 근거를 엔진 실측으로 고정 ──
{
  const open = (keys, text) => engine.auxAllowList(mk(keys), text).length === 1;
  ck('★ 축약의 증거: "다치"는 "다쳤다"에 안 걸린다 — "어간" 지침이 틀린 이유',
    !open(['다치'], '그녀는 계단에서 다쳤다') && open(['다치'], '더 다치기 전에 물러났다'), '');
  ck('★ 끝의 다를 뗀 "다쳤"은 다쳤다·다쳤고에 걸린다',
    open(['다쳤'], '그녀는 계단에서 다쳤다') && open(['다쳤'], '팔을 다쳤고 걸을 수 없었다'), '');
  ck('꼴 나열이 축약 변형을 덮는다 ("다친")',
    open(['다쳤', '다친', '다치'], '다친 다리를 감쌌다'), '');
  ck('명사 유의어는 그대로 걸린다 ("절뚝")', open(['부상', '절뚝'], '절뚝이며 걸었다'), '');
  ck('무관한 글에는 닫힌다', !open(['부상', '다쳤', '다친'], '무사히 도착했다'), '');
}

// ── 규격서·편집기 배선 ──
{
  ck('★ SCHEMA_ALLOW_RULES 정의 + 통짜·패치 프롬프트 양쪽 배선',
    (src.match(/SCHEMA_ALLOW_RULES/g) || []).length >= 3, '');
  ck('★ 규격서에 낱말 게이트 섹션', src.includes('## 낱말 게이트'), '');
  ck('★ 규격서가 "다 떼기 + 꼴 나열"을 가르친다 (어간 지침 금지)',
    src.includes('유의어 4~8개') && src.includes('"다쳤", "다친", "다치"')
    && !src.includes('어간으로 적으세요'), '');
  ck('규격서: 핵심 수치·단위 말 금지 규칙', src.includes('낱말을 놓친 턴의 변화가 통째로')
    && src.includes('게이트가 무의미해집니다'), '');
  ck('★ 편집기 낱말 칸 도움말에 같은 요령', src.includes('끝의 다를 뗀 "다쳤"으로'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
