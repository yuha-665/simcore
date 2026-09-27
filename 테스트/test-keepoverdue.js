const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.13.1 — 목록 규칙 keepOverdue: expire 식을 **시계로만** 쓰고 지난 항목을 안 지운다.
// 계기(베리디아 점검, 2026-09-27): 빚·약속(favors)은 "이행하거나 파기하기 전엔 안 사라진다"가 설계라 만료 규칙을
// 일부러 안 달았다. 그러면 `@+30`이 굳지 않고, v1.7.1 환산이 그걸 `(30일)`로 보여 줘 영영 안 줄어드는 남은 일수가 됐다.
const E = require(__P('../core/engine.js'));
const { validateSchema } = require(__P('../core/validate.js'));

const R_ = []; const ok = (n, c, x = '') => R_.push([c, n, x]);

const mkSchema = (rule) => ({
  simcore: '0.1', meta: { name: '약속 장부' },
  vars: [
    { id: 'day', label: '경과일', type: 'int', init: 0 },
    { id: 'favors', label: '빚·약속', type: 'list', init: [] },
  ],
  // 날짜는 테스트가 직접 민다(adv) — 손 카운터를 onTurn에서 올리면 굳히기(보조 변화 단계)가 그보다 먼저라 하루 어긋난다(규격서의 그 함정)
  rules: { onTurn: rule ? [rule] : [] },
  updater: { allow: [{ id: 'favors' }] },
  promptState: { template: '빚·약속 {favors}' },
});
const KEEP = mkSchema({ list: 'favors', expire: 'day', keepOverdue: true });
const DROP = mkSchema({ list: 'favors', expire: 'day' });
const NONE = mkSchema(null);

// 턴 하나: 보내고 → 보조 변화 → 받는다
const turn = (S, st, changes = {}) => E.outputPhase(S, E.sendPhase(S, st, {}).state, changes, {}, {}).state;
const adv = (S, st, n = 1) => { st.vars.day += n; return turn(S, st); };
const block = (S, st) => E.sendPhase(S, st, {}).promptBlock;
const ITEM = '모르웬에게 곡물 200 상환 @+3';

console.log('\n━━ 검증 ━━');
{
  const errs = (S) => validateSchema(S).errors || [];
  const warns = (S) => JSON.stringify(validateSchema(S).warnings || []);
  ok('정상 규칙은 오류 없음', errs(KEEP).length === 0, JSON.stringify(errs(KEEP)));
  ok('불린 아니면 오류', errs(mkSchema({ list: 'favors', expire: 'day', keepOverdue: 'yes' })).some((e) => String(JSON.stringify(e)).includes('keepOverdue')), '');
  ok('expire 없이 쓰면 경고', warns(mkSchema({ list: 'favors', add: [], keepOverdue: true })).includes('keepOverdue'), '');
  ok('옛 봇(키 없음)은 경고도 없음', !warns(DROP).includes('keepOverdue'), '');
}

console.log('\n━━ 굳히기와 세기 — 시계를 읽는 쪽은 expire를 그대로 본다 ━━');
{
  let st = E.initState(KEEP);
  st = turn(KEEP, st, { favors: { add: [ITEM] } });
  const saved = st.vars.favors[0];
  ok('★ @+3이 절대 기한으로 굳었다', /@\d+$/.test(saved) && !saved.includes('@+'), saved);
  ok('listClockNow가 keepOverdue 규칙을 시계로 찾는다', E.listClockNow(KEEP, st, 'favors') === st.vars.day, String(E.listClockNow(KEEP, st, 'favors')));
  const b0 = block(KEEP, st);
  ok('처음엔 (3일)', b0.includes('모르웬에게 곡물 200 상환 (3일)'), b0);
  st = adv(KEEP, st, 2);
  ok('★ 이틀 뒤엔 (1일) — 줄어든다', block(KEEP, st).includes('상환 (1일)'), block(KEEP, st));
  st = adv(KEEP, st);
  ok('기한 당일 (오늘)', block(KEEP, st).includes('상환 (오늘)'), block(KEEP, st));
  st = adv(KEEP, st, 2);
  ok('★ 지나도 목록에 남는다', st.vars.favors.length === 1 && st.vars.favors[0] === saved, JSON.stringify(st.vars.favors));
  ok('★ 지난 항목은 (지남)', block(KEEP, st).includes('상환 (지남)'), block(KEEP, st));
  st = turn(KEEP, st, { favors: { remove: [saved] } });
  ok('이행하면 보조가 저장 원문 그대로 지운다', st.vars.favors.length === 0, JSON.stringify(st.vars.favors));
}

console.log('\n━━ 대조군 ━━');
{
  let st = E.initState(DROP);
  st = turn(DROP, st, { favors: { add: [ITEM] } });
  st = adv(DROP, st, 5);
  ok('keepOverdue 없는 expire는 지난 항목을 지운다 (예전 그대로)', st.vars.favors.length === 0, JSON.stringify(st.vars.favors));

  let sn = E.initState(NONE);
  sn = turn(NONE, sn, { favors: { add: [ITEM] } });
  sn = adv(NONE, sn, 5);
  ok('규칙이 없으면 @+3이 안 굳는다 (이 기능이 고치는 것)', sn.vars.favors[0] === ITEM, sn.vars.favors[0]);
  ok('…그래서 닷새가 지나도 (3일)로 멈춰 있다', block(NONE, sn).includes('상환 (3일)'), block(NONE, sn));
}

let p = 0, f = 0;
for (const [c, n, x] of R_) { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : `→ ${x}`); c ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
