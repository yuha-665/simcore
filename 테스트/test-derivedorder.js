const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.16 — 파생 순서 무관: 검증이 뒤의 파생도 알고, 순환만 오류. 엔진은 원래 지연 계산
// 커뮤니티 제보(에렌샤): 어시스턴트가 맨 아래 붙인 파생을 위의 표시용 파생이 "알 수 없는 변수"로 거부
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const { validateSchema } = require(__P('../core/validate.js'));
const engine = require(__P('../core/engine.js'));

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));

const S = {
  simcore: '0.1', meta: { name: '파생 순서' },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 40, min: 0, max: 100 },
    { id: 'buff_atk', label: '공격 버프', type: 'int', init: 3, min: 0 },
  ],
  derived: [
    // 기존(위) 표시용 파생이 아래에 새로 붙은 파생을 읽는다 — 제보의 바로 그 모양
    { id: 'char1_display_status', label: '표시', expr: 'hp_state + " / 버프 " + buff_total' },
    { id: 'hp_state', label: '체력 상태', expr: 'hp < 30 ? "위험" : "양호"' },
    { id: 'buff_total', label: '버프 합', expr: 'buff_atk * 2' },
  ],
  updater: { allow: [{ id: 'hp' }] },
};

console.log('── 검증');
{
  const v = validateSchema(S);
  ck('앞 파생이 뒤 파생을 읽어도 통과', v.ok, J(v.errors));
  const a = clone(S); a.derived.push({ id: 'ghost_user', label: 'x', expr: 'ghost * 2' });
  const va = validateSchema(a);
  ck('진짜 없는 변수는 여전히 오류', !va.ok && va.errors.some((e) => e.path === '$.derived[3].expr' && e.msg.includes('ghost')), J(va.errors));
  const c = clone(S); c.derived.push({ id: 'a1', label: 'a', expr: 'b1 + 1' }, { id: 'b1', label: 'b', expr: 'a1 + 1' });
  const vc = validateSchema(c);
  ck('순환 a→b→a는 오류 (한 번만 보고)', !vc.ok && vc.errors.filter((e) => e.msg.includes('파생 순환 참조')).length === 1
    && vc.errors.some((e) => e.msg.includes('a1 → b1 → a1')), J(vc.errors));
  const s2 = clone(S); s2.derived.push({ id: 'self', label: 's', expr: 'self + 1' });
  const vs = validateSchema(s2);
  ck('자기 참조도 순환 오류', !vs.ok && vs.errors.some((e) => e.path === '$.derived[3].expr' && e.msg.includes('self → self')), J(vs.errors));
  const d = clone(S); d.derived.push({ id: 'hp_state', label: '중복', expr: '1' });
  ck('중복 id는 그대로 오류', validateSchema(d).errors.some((e) => e.msg.includes('중복된 id')), '');
  const e = clone(S); e.derived.push({ id: 'bad id', label: 'x', expr: '1' }, { id: 'ok2', label: 'y', expr: 'hp_state' });
  const ve = validateSchema(e);
  ck('잘못된 id가 섞여도 나머지는 정상 검사', ve.errors.some((x) => x.msg.includes('잘못된 id')) && !ve.errors.some((x) => x.path === '$.derived[4].expr'), J(ve.errors));
}

console.log('── 엔진');
{
  const st = engine.initState(S);
  const L = engine.makeLookup(S, st.vars);
  ck('위 파생이 아래 파생 값을 제대로 얻는다', L('char1_display_status') === '양호 / 버프 6', J(L('char1_display_status')));
  const rev = clone(S); rev.derived.reverse();
  const L2 = engine.makeLookup(rev, engine.initState(rev).vars);
  ck('순서를 뒤집어도 같은 값', L2('char1_display_status') === '양호 / 버프 6', '');
  const c = clone(S); c.derived.push({ id: 'a1', label: 'a', expr: 'b1 + 1' }, { id: 'b1', label: 'b', expr: 'a1 + 1' });
  let threw = '';
  try { engine.makeLookup(c, engine.initState(c).vars)('a1'); } catch (e) { threw = e.message; }
  ck('엔진 순환 감지는 그대로', threw.includes('순환'), threw);
}

console.log('── 규격');
{
  ck('규격: 파생은 순서 무관', src.includes('파생 변수는 **목록 순서와 무관하게** 다른 파생을 읽을 수 있습니다'), '');
  ck('검증 순환 메시지가 번들에', src.includes('파생 순환 참조: '), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
