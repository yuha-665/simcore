const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.13 — 🔒 보호(keep): AI 패치가 못 건드리는 항목
// 커뮤니티 제보: "바이브 코딩이 기억력 한계로 기존 작업을 날리는 경우가 왕왕 — 절대 건드리지 말 것을 유저가 체크"
const fs = require('fs');
const P = require(__P('../core/patch.js'));
const { validateSchema } = require(__P('../core/validate.js'));
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));

const S = {
  simcore: '0.1', meta: { name: '보호' },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 100, min: 0, max: 100, keep: true },
    { id: 'gold', label: '금화', type: 'int', init: 0, min: 0 },
    { id: 'fame', label: '명성', type: 'int', init: 0, min: 0 },
  ],
  derived: [{ id: 'rich', label: '부자', expr: 'gold >= 100', keep: true }],
  checks: [{ id: 'atk', label: '공격', roll: 'rand(1, 20)', vs: 10, grades: [{ label: '성공' }], keep: true }],
  rules: {
    events: [{ id: 'bankrupt', when: 'gold <= 0', effects: [{ set: 'fame', expr: 'fame - 1' }], keep: true },
      { id: 'boom', when: 'gold >= 500', effects: [] }],
    randomEvents: { chancePerTurn: 0.1, table: [{ id: 'rain', weight: 1, keep: true }] },
  },
  directives: [{ id: 'tone', when: 'true', text: '담담하게', keep: true }],
  actions: [{ id: 'work', label: '노역', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold + 10' }], keep: true },
    { id: 'rest', label: '휴식', mode: 'oneshot', effects: [] }],
  updater: { allow: [{ id: 'hp' }, { id: 'gold' }, { id: 'fame' }] },
};
const patch = (o) => P.parsePatch(J({ patchVersion: 1, ...o })).patch;

console.log('── 검증');
{
  const v = validateSchema(S);
  ck('표본 스키마 통과', v.ok, J(v.errors));
  const b = clone(S); b.vars[0].keep = 'yes';
  ck('keep 비불린 → 오류', validateSchema(b).errors.some((e) => e.path === '$.vars[0].keep'), J(validateSchema(b).errors));
  const c = clone(S); c.actions[0].keep = 1;
  ck('액션 keep 비불린 → 오류', validateSchema(c).errors.some((e) => e.path === '$.actions[0].keep'), '');
}

console.log('── 패치 계획');
{
  ck('isKept: 변수', P.isKept(S, 'vars', 'hp') && !P.isKept(S, 'vars', 'gold'), '');
  ck('isKept: 보호 변수의 allow 항목도 보호', P.isKept(S, 'allow', 'hp') && !P.isKept(S, 'allow', 'gold'), '');
  ck('keptEntries 7 + allow 1', P.keptEntries(S).length === 8, J(P.keptEntries(S)));
  const plan = P.planPatch(S, patch({
    update: { vars: [{ id: 'hp', label: '체력', type: 'int', init: 50 }, { id: 'gold', label: '금화', type: 'int', init: 5 }] },
    remove: { events: ['bankrupt', 'boom'], actions: ['work'], directives: ['tone'], checks: ['atk'], derived: ['rich'], randomEvents: ['rain'], allow: ['hp'] },
  }));
  ck('오류 없음 (보호는 오류가 아니라 건너뜀)', plan.errors.length === 0, J(plan.errors));
  ck('보호 항목 8건 건너뜀', plan.protected.length === 8 && plan.summary.protected === 8, J(plan.protected));
  ck('나머지는 그대로 계획: gold update + boom remove', plan.ops.length === 2 && plan.ops.some((o) => o.op === 'update' && o.id === 'gold') && plan.ops.some((o) => o.op === 'remove' && o.id === 'boom'), J(plan.ops.map((o) => o.op + ':' + o.id)));
  ck('경고에 🔒 사유 (풀려면 편집기에서 해제)', plan.warnings.filter((w) => w.startsWith('🔒 보호된 항목')).length === 8 && plan.warnings.some((w) => /풀려면 편집기에서 🔒 해제/.test(w)), J(plan.warnings));
  const add = P.planPatch(S, patch({ add: { vars: [{ id: 'hp', label: '체력2', type: 'int', init: 1 }, { id: 'new_v', label: '새', type: 'int', init: 0 }] } }));
  ck('보호 id와 같은 add(교체)는 충돌이 아니라 건너뜀', add.conflicts.length === 0 && add.protected.length === 1 && add.protected[0].op === 'add' && add.ops.length === 1 && add.ops[0].id === 'new_v', J({ c: add.conflicts.length, p: add.protected, ops: add.ops.map((o) => o.id) }));
  const dup = P.planPatch(S, patch({ add: { vars: [{ id: 'gold', label: '금화2', type: 'int', init: 1 }] } }));
  ck('보호 아닌 id의 add 충돌은 전처럼 충돌', dup.conflicts.length === 1 && dup.protected.length === 0, '');
}

console.log('── 패치 적용');
{
  const r = P.applyPatch(S, patch({
    update: { vars: [{ id: 'hp', label: '체력', type: 'int', init: 50 }, { id: 'gold', label: '금화', type: 'int', init: 5 }] },
    remove: { actions: ['work', 'rest'] },
  }));
  ck('적용 성공', r.ok, J(r.errors));
  ck('보호 변수 hp는 원본(init 100)', r.schema.vars.find((v) => v.id === 'hp').init === 100 && r.schema.vars.find((v) => v.id === 'hp').keep === true, '');
  ck('보호 아닌 gold는 바뀜(init 5)', r.schema.vars.find((v) => v.id === 'gold').init === 5, '');
  ck('보호 액션 work는 남고 rest는 지워짐', r.schema.actions.some((a) => a.id === 'work') && !r.schema.actions.some((a) => a.id === 'rest'), J(r.schema.actions.map((a) => a.id)));
  ck('applied.protected 보고', r.applied.protected.length === 2 && r.applied.protected.includes('vars:hp (update)') && r.applied.protected.includes('actions:work (remove)'), J(r.applied.protected));
  ck('경고에 🔒 줄이 실려 온다', r.warnings.some((w) => w.startsWith('🔒 보호된 항목')), '');
}

console.log('── 통짜 교체 되살리기');
{
  const next = clone(S);
  next.vars = next.vars.filter((v) => v.id !== 'hp');                 // 빠뜨림
  next.actions[0] = { id: 'work', label: '노역(개조)', mode: 'hold', effects: [] };   // 고쳐 옴
  next.actions[0].keep = true;
  next.derived = [];                                                      // 빠뜨림
  next.rules.events[0].when = 'gold < 0';                                 // 고쳐 옴
  delete next.updater.allow.find((a) => a.id === 'gold').id;             // (무관) 잡음 — 되살리기 대상 아님
  next.updater.allow = next.updater.allow.filter((a) => a.id !== 'hp'); // 보호 변수의 allow도 빠뜨림
  const r = P.restoreKept(S, next);
  ck('빠진 보호 항목은 되살아난다 (vars:hp · derived:rich · allow:hp)', r.restored.includes('vars:hp') && r.restored.includes('derived:rich') && r.restored.includes('allow:hp'), J(r.restored));
  ck('고쳐 온 보호 항목은 원본으로 (actions:work · events:bankrupt)', r.reverted.includes('actions:work') && r.reverted.includes('events:bankrupt'), J(r.reverted));
  ck('원본 전문 그대로', J(r.schema.actions.find((a) => a.id === 'work')) === J(S.actions[0]) && r.schema.rules.events[0].when === 'gold <= 0', '');
  ck('안 바뀐 보호 항목은 보고에 없다 (checks:atk · directives:tone · randomEvents:rain)', !r.reverted.includes('checks:atk') && !r.restored.includes('checks:atk') && !r.reverted.includes('directives:tone'), J(r));
  ck('next는 안 건드린다 (사본)', !next.vars.some((v) => v.id === 'hp'), '');
  ck('보호가 하나도 없으면 그대로', J(P.restoreKept({ vars: [{ id: 'a' }] }, next).schema) === J(next), '');
}

console.log('── 편집기·프롬프트');
{
  ck('keepBtn 헬퍼 (🔓 / 🔒 보호, aria-pressed)', src.includes("class: 'sce-btn sce-mini sce-keep-btn' + (on ? ' is-on' : '')") && src.includes("on ? '🔒 보호' : '🔓'"), '');
  ck('토글: 켜면 keep:true, 끄면 필드 삭제', src.includes('onclick: () => { if (on) delete item.keep; else item.keep = true; rerender(); }'), '');
  const n = src.split('keepBtn(').length - 1;
  ck('버튼이 변수·파생(공용)·조건·랜덤·액션·판정·지시문 카드에 (호출 6곳)', n === 6, n);
  ck('접힌 변수 카드 제목에 🔒', src.includes("(item.keep === true ? '🔒 ' : '') + title"), '');
  ck('다이제스트 맨 위 보호 목록', src.includes("'### 🔒 보호 항목 — update/remove 금지, 같은 id로 add 금지 (참조만)"), '');
  ck('패치 규격 규칙 한 줄', src.includes('**🔒 보호 항목은 절대 update/remove 하지 마세요.**'), '');
  ck('대화 규약 한 줄 (잠겨 있으니 풀어 달라)', src.includes('잠겨 있으니 편집기에서 🔒를 풀어 달라'), '');
  ck('통짜 반영이 restoreKept를 거친다', src.includes('const kept = patchMod.restoreKept(schema, aiFull.schema);') && src.includes('🔒 보호 항목 유지 —'), '');
  ck('CSS 켜진 버튼 강조', src.includes('.sce .sce-keep-btn.is-on {'), '');
  // 다이제스트 실물 — 편집기 모듈에서 직접
  const editor = require(__P('../core/editor.js'));
  const fn = editor.buildPatchExportPrompt || editor.__test?.buildPatchExportPrompt;
  if (fn) {
    const txt = fn(S);
    ck('다이제스트에 `vars:hp` 등 보호 id', txt.includes('`vars:hp`') && txt.includes('`actions:work`') && txt.includes('`directives:tone`'), '');
  } else ck('(buildPatchExportPrompt 미노출 — 문자열 검사로 갈음)', true, '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
