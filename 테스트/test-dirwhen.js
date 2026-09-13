const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.15 — 지시문 when 누락: 패치가 true로 채우고 경고 · 규격에 필수 명시
// 커뮤니티 제보(에렌샤): 어시스턴트 패치가 when 없는 지시문을 보내 "검증 실패, 실질 적용이 안 된다"
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const P = require(__P('../core/patch.js'));
const { validateSchema } = require(__P('../core/validate.js'));
const engine = require(__P('../core/engine.js'));

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const J = JSON.stringify;

const S = {
  simcore: '0.1', meta: { name: '지시문' },
  vars: [{ id: 'iron', label: '철', type: 'int', init: 0, min: 0 }],
  directives: [{ id: 'd_old', when: 'iron > 5', text: '철이 넉넉하다.' }],
  updater: { allow: [{ id: 'iron' }] },
};
const apply = (p) => P.applyPatch(S, P.parsePatch(J({ patchVersion: 1, ...p })).patch);

console.log('── 패치');
{
  const r = apply({ add: { directives: [{ id: 'd_new', text: 'Always keep the forge hot.' }] } });
  ck('when 없는 지시문 add → 적용된다', r.ok, J(r.errors));
  const d = r.ok && r.schema.directives.find((x) => x.id === 'd_new');
  ck('when이 "true"로 채워진다', d && d.when === 'true', J(d));
  ck('경고가 붙는다', r.ok && r.applied.warnings.some((w) => w.includes("add.directives 'd_new'") && w.includes('항상 켜짐')), J(r.ok && r.applied.warnings));
  ck('원본 스키마는 그대로', S.directives.length === 1, '');
  const r2 = apply({ update: { directives: [{ id: 'd_old', text: '철 이야기.' }] } });
  ck('update가 when을 빠뜨려도 적용 + true', r2.ok && r2.schema.directives[0].when === 'true' && r2.schema.directives[0].text === '철 이야기.', J(r2.errors));
  ck('update 경고', r2.ok && r2.applied.warnings.some((w) => w.includes("update.directives 'd_old'")), '');
  const r3 = apply({ add: { directives: [{ id: 'd_blank', when: '   ', text: 'x' }] } });
  ck('공백 when도 채운다', r3.ok && r3.schema.directives.find((x) => x.id === 'd_blank').when === 'true', J(r3.errors));
  const r4 = apply({ add: { directives: [{ id: 'd_cond', when: 'iron >= 3', text: 'y' }] } });
  ck('when이 있으면 그대로', r4.ok && r4.schema.directives.find((x) => x.id === 'd_cond').when === 'iron >= 3' && !r4.applied.warnings.some((w) => w.includes('d_cond')), '');
  const r5 = apply({ add: { events: [{ id: 'e_nowhen', effects: [{ set: 'iron', expr: 'iron + 1' }] }] } });
  ck('이벤트 when 누락은 채우지 않고 거부', !r5.ok && J(r5.errors).includes('when'), J(r5.errors));
}

console.log('── 엔진');
{
  const r = apply({ add: { directives: [{ id: 'd_new', text: 'Always keep the forge hot.' }] } });
  const v = validateSchema(r.schema);
  ck('채운 스키마가 검증 통과', v.ok, J(v.errors));
  const st = engine.initState(r.schema);
  const sp = engine.sendPhase(r.schema, st, { userText: 'go' });
  ck('true 지시문이 매 턴 활성', sp.activeDirectives.includes('d_new') && !sp.activeDirectives.includes('d_old'), J(sp.activeDirectives));
  ck('본문에 지시문 텍스트', J(sp).includes('Always keep the forge hot.'), '');
}

console.log('── 규격');
{
  ck('패치 규칙: directives 셋 필수 + when true', src.includes('항목은 `id`·`when`·`text` 셋이 **전부 필수**입니다. 항상 켜 둘 지시문은 `"when": "true"`'), '');
  ck('규칙 탭 규격: when 필수', src.includes('`when`은 필수 — 항상 켜 둘 지시문은 `"when": "true"`.'), '');
  ck('공용 규격: directives[].when 필수', src.includes('`directives[].when`은 필수입니다 (항상 켜 둘 지시문은 `"true"`)'), '');
  ck('patch.js fillDirectiveWhen이 번들에', src.includes('function fillDirectiveWhen(section, e, op, warn)'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
