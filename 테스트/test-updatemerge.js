const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.17 — 패치 update 병합: 보낸 필드만 덮고, null은 삭제, 배열·객체는 통째
// 커뮤니티 제보(에렌샤): "패치 적용 때 변경 확인 항목이 모두 오류" — AI가 바꿀 필드만 보내 필수 필드가 증발
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const P = require(__P('../core/patch.js'));

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const J = JSON.stringify;

const S = {
  simcore: '0.1', meta: { name: '병합' },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 100, min: 0, max: 100, group: '전투', desc: '맞으면 준다' },
    { id: 'gold', label: '금화', type: 'int', init: 0, min: 0 },
  ],
  derived: [{ id: 'low', label: '위험', expr: 'hp < 30' }],
  rules: { events: [{ id: 'hit', when: 'hp < 50', once: true, notify: 'Ouch.', effects: [{ set: 'gold', expr: 'gold + 1' }] }] },
  directives: [{ id: 'd1', when: 'low', text: 'Danger.' }],
  actions: [{ id: 'rest', label: '쉬기', mode: 'oneshot', effects: [{ set: 'hp', expr: 'hp + 10' }], inject: 'Rest.' }],
  checks: [{ id: 'dodge', label: '회피', roll: 'rand(1,20)', mod: '0', grades: [{ id: 'ok', label: '성공', when: 'roll >= 10', effects: [] }, { id: 'ng', label: '실패', effects: [{ set: 'hp', expr: 'hp - 5' }] }] }],
  updater: { allow: [{ id: 'hp', maxGain: 20, maxLoss: 50 }, { id: 'gold' }] },
};
const apply = (p) => P.applyPatch(S, P.parsePatch(J({ patchVersion: 1, ...p })).patch);
const find = (r, sec, id) => (sec === 'events' ? r.schema.rules.events : sec === 'allow' ? r.schema.updater.allow : r.schema[sec]).find((x) => x.id === id);

console.log('── 병합');
{
  const r = apply({ update: { vars: [{ id: 'hp', init: 80 }] } });
  ck('init만 보내면 나머지(type·min·max·group·desc) 그대로', r.ok && J(find(r, 'vars', 'hp')) === J({ ...S.vars[0], init: 80 }), J(r.ok ? find(r, 'vars', 'hp') : r.errors));
  const r2 = apply({ update: { vars: [{ id: 'hp', max: null, desc: null }] } });
  ck('null은 필드 삭제', r2.ok && !('max' in find(r2, 'vars', 'hp')) && !('desc' in find(r2, 'vars', 'hp')) && find(r2, 'vars', 'hp').min === 0, J(r2.errors));
  const r3 = apply({ update: { vars: [{ id: 'hp', label: '생명', id2: 1, id: 'hp' }] } });
  ck('id는 못 바꾼다 (항상 기존 id)', r3.ok && find(r3, 'vars', 'hp').id === 'hp', '');
  const r3n = P.parsePatch(J({ patchVersion: 1, update: { vars: [{ id: 'hp', label: 'x' }] } })).patch;
  const merged = P.mergeUpdate(S.vars[0], { id: null, label: 'x' });
  ck('id: null 이어도 id 유지', merged.id === 'hp' && merged.label === 'x', J(merged));
  ck('원본 항목은 안 건드린다', S.vars[0].label === '체력' && S.vars[0].max === 100 && r3n.update.vars[0].label === 'x', '');
}

console.log('── 배열·객체는 통째');
{
  const r = apply({ update: { actions: [{ id: 'rest', effects: [{ set: 'hp', expr: 'hp + 25' }] }] } });
  const a = r.ok && find(r, 'actions', 'rest');
  ck('effects 배열은 통째 교체, label·mode·inject 유지', a && a.effects.length === 1 && a.effects[0].expr === 'hp + 25' && a.mode === 'oneshot' && a.inject === 'Rest.', J(a || r.errors));
  const r2 = apply({ update: { checks: [{ id: 'dodge', grades: [{ id: 'ok', label: '성공', when: 'roll >= 5', effects: [] }, { id: 'ng', label: '실패', effects: [] }] }] } });
  const c = r2.ok && find(r2, 'checks', 'dodge');
  ck('grades 통째 교체, roll·mod·label 유지', c && c.grades[0].when === 'roll >= 5' && c.roll === 'rand(1,20)' && c.label === '회피', J(c || r2.errors));
  const r3 = apply({ update: { events: [{ id: 'hit', notify: 'Ow!' }] } });
  const e = r3.ok && find(r3, 'events', 'hit');
  ck('이벤트 notify만 바꾸면 when·once·effects 유지', e && e.notify === 'Ow!' && e.when === 'hp < 50' && e.once === true && e.effects.length === 1, J(e || r3.errors));
  const r4 = apply({ update: { allow: [{ id: 'hp', maxGain: 30 }] } });
  const al = r4.ok && find(r4, 'allow', 'hp');
  ck('allow maxGain만 바꾸면 maxLoss 유지', al && al.maxGain === 30 && al.maxLoss === 50, J(al || r4.errors));
}

console.log('── 제보 재현: 바꿀 필드만 보낸 패치가 통째로 살아난다');
{
  const r = apply({ update: {
    vars: [{ id: 'hp', init: 90 }, { id: 'gold', label: '골드' }],
    events: [{ id: 'hit', notify: 'Ow!' }],
    directives: [{ id: 'd1', text: 'Careful.' }],
    actions: [{ id: 'rest', label: '휴식' }],
  } });
  ck('다섯 항목 전부 적용 (오류 0)', r.ok && r.applied.updated.length === 5, J(r.ok ? r.applied : r.errors));
  ck('지시문 when 유지 · 이벤트 when 유지', r.ok && find(r, 'directives', 'd1').when === 'low' && find(r, 'events', 'hit').when === 'hp < 50', '');
  ck('경고 없음 (when 채움 경고도 없다)', r.ok && r.applied.warnings.length === 0, J(r.ok && r.applied.warnings));
  const plan = P.planPatch(S, P.parsePatch(J({ patchVersion: 1, update: { vars: [{ id: 'hp', init: 90 }] } })).patch);
  ck('변경 계획의 entry도 병합본 (미리보기가 전문을 보여 준다)', plan.ops[0].entry.type === 'int' && plan.ops[0].entry.init === 90 && plan.ops[0].previous.init === 100, J(plan.ops[0]));
  const ty = apply({ update: { vars: [{ id: 'hp', type: 'text', init: '' }] } });
  ck('타입 변경 경고는 그대로', ty.ok && ty.applied.warnings.some((w) => w.includes('int→text')), J(ty.ok ? ty.applied.warnings : ty.errors));
}

console.log('── 규격');
{
  ck('패치 규칙: 보낸 필드만 덮고 나머지 그대로', src.includes('**보낸 필드만 덮고 나머지 필드는 그대로** 남습니다'), '');
  ck('패치 규칙: null 삭제 + 배열은 통째', src.includes('필드를 없애려면 `"max": null`처럼 null을 주세요') && src.includes('같은 배열·객체 필드는 **통째로** 바뀌니'), '');
  ck('옛 문구(통째로 다시 씁니다) 없음', !src.includes('항목을 **통째로 다시** 씁니다'), '');
  ck('다이제스트 머리: 바꿀 필드만', src.includes('update로 고칠 땐 바꿀 필드만 보내면 됩니다'), '');
  ck('mergeUpdate가 번들에', src.includes('function mergeUpdate(cur, e)'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
