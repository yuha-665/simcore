const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.32 지속 효과 등록부 — sum() + 항목 파싱 + 목록 왕복
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { evaluate, itemValue, itemExpiry, ExprError } = SC.require('expr');
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, '→', got); } };
const eq = (name, got, want) => ck(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

// ── ① 항목 파싱 규칙: 숫자는 반드시 맨 끝 ──
eq('끝의 +숫자', itemValue('헤세 상단 양모 계약 +12'), 12);
eq('끝의 숫자', itemValue('제분소 5'), 5);
eq('끝의 음수', itemValue('흉작 부담금 -6'), -6);
eq('소수', itemValue('통행세 3.5'), 3.5);
eq('숫자만', itemValue('12'), 12);
eq('뒤 공백 허용', itemValue('제분소 5  '), 5);
eq('숫자 없음 → null', itemValue('물레방아 (건설중)'), null);
// ★ 이게 핵심: "아무 데나 있는 마지막 숫자"였다면 30을 집었을 것 — 조용히 틀리는 대신 드러나게 실패한다
eq('★ 중간 숫자는 안 집는다', itemValue('양모 계약 12 (30일)'), null);
eq('단위 접미사도 안 집는다', itemValue('제분소 5/일'), null);

// ── ② sum() ──
const L = (n) => ({
  contracts: ['헤세 상단 양모 계약 +12', '제분소 5', '교역로 통행세 +8', '흉작 부담금 -6', '물레방아 (건설중)'],
  empty: [], txt: 'abc', num: 7,
}[n]);
eq('sum 합계', evaluate('sum(contracts)', L), 19);
eq('sum 거르개', evaluate('sum(contracts, "교역")', L), 8);
eq('거르개 무매치 → 0', evaluate('sum(contracts, "없는말")', L), 0);
eq('빈 목록 → 0', evaluate('sum(empty)', L), 0);
eq('목록이 아니면 0', evaluate('sum(txt)', L), 0);
eq('숫자 인자도 0', evaluate('sum(num)', L), 0);
eq('식 안에서 합성', evaluate('round(sum(contracts) * 1.5)', L), 29);
eq('count와 공존', evaluate('count(contracts) - sum(contracts)', L), -14);

// 인자 개수 검사 (파스 타임)
const arity = (e) => { try { evaluate(e, L); return 'ok'; } catch (err) { return err instanceof ExprError ? 'ExprError' : 'other'; } };
eq('sum() 무인자 거부', arity('sum()'), 'ExprError');
eq('sum(a,b,c) 거부', arity('sum(contracts, "a", "b")'), 'ExprError');

// ── ③ 예약어 ──
{
  const s = { simcore: '0.1', meta: { name: 't' }, vars: [{ id: 'sum', label: 's', type: 'int', init: 0 }] };
  const v = validateSchema(s);
  ck('sum은 변수 id로 못 쓴다', !v.ok && v.errors.some((e) => /예약어/.test(e.msg)), JSON.stringify(v.errors));
}

// ── ④ 스키마 왕복: 등록 → 매턴 정산 → 파기 ──
const S = {
  simcore: '0.1', meta: { name: '계약 테스트' },
  vars: [
    { id: 'gold', label: '금', type: 'int', init: 0, min: 0 },
    { id: 'contracts', label: '계약', type: 'list', init: [], maxItems: 8 },
  ],
  derived: [{ id: 'income', label: '수입', expr: 'sum(contracts)' }],
  rules: { onTurn: [{ set: 'gold', expr: 'max(0, gold + income)' }], events: [] },
  updater: { allow: [{ id: 'contracts' }] },
  statusUI: { mode: 'auto', groups: [] }, setup: { presets: [] },
};
{
  const v = validateSchema(S);
  ck('sum 쓰는 스키마 검증 통과', v.ok, JSON.stringify(v.errors));
}
{
  let st = engine.initState(S); st.meta.setupDone = true;
  const turn = (changes) => {
    st = engine.sendPhase(S, st).state;
    st = engine.outputPhase(S, st, changes || {}, {}).state;
    return st.vars.gold;
  };
  eq('계약 없으면 수입 0', turn(), 0);
  // AI가 목록 연산으로 등록 — 새 프로토콜 없이 기존 add/remove 그대로
  eq('등록한 턴부터 붙는다', turn({ contracts: { add: ['헤세 상단 양모 계약 +12'] } }), 12);
  eq('다음 턴도 자동으로', turn(), 24);
  eq('둘째 계약 추가', turn({ contracts: { add: ['제분소 5'] } }), 41);
  eq('숫자 없는 항목은 0 기여', turn({ contracts: { add: ['물레방아 (건설중)'] } }), 58);
  // 파기 — remove 하나로 그 뒤 전부 반영
  eq('파기하면 즉시 빠진다', turn({ contracts: { remove: ['헤세 상단 양모 계약 +12'] } }), 63);
  eq('파기 후 유지', turn(), 68);
  eq('남은 목록', st.vars.contracts, ['제분소 5', '물레방아 (건설중)']);
}

// ── ⑤ 카탈로그 패턴이 실제로 동작하는가 ──
{
  const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
  const M = new Function('validateSchema', 'TEMPLATES', seg + '\nreturn { VAR_PATTERNS, SCHEMA_EXPR_RULES };')(validateSchema, {});
  const p = M.VAR_PATTERNS.find((x) => x[0].includes('지속 효과 등록부'));
  ck('카탈로그에 수록', !!p, '');
  ck('예시가 JSON', !!p && (() => { try { JSON.parse('[' + p[2] + ']'); return true; } catch { return false; } })(), '');
  ck('표현식 규칙에 sum 문서화', M.SCHEMA_EXPR_RULES.some((r) => r.includes('sum(목록')), '');
}

// ── ⑥ 기한 `@숫자` ──
eq('기한 파싱', itemExpiry('헤세 양모 계약 @1080 +12'), 1080);
eq('기한 없으면 null', itemExpiry('제분소 5'), null);
eq('기한 있어도 값은 끝 숫자', itemValue('헤세 양모 계약 @1080 +12'), 12);
eq('음수 값 + 기한', itemValue('성벽 부역 @450 -4'), -4);
// ★ 기한만 있고 금액이 없는 항목 — 제일 흔하고 제일 위험한 경우
eq('★ 기한만 있으면 값은 null', itemValue('성벽 부역 @450'), null);
eq('★ 기한만 있는 항목은 합산 0', evaluate('sum(x)', () => ['성벽 부역 @450', '제분소 5']), 5);

{
  // expire 효과: 기한이 지난 것만 빠지고, @ 없는 무기한은 남는다
  const E = {
    simcore: '0.1', meta: { name: '기한' },
    vars: [
      { id: 'day', label: '일', type: 'int', init: 0, min: 0 },
      { id: 'gold', label: '금', type: 'int', init: 0, min: 0 },
      { id: 'deals', label: '계약', type: 'list', maxItems: 8,
        init: ['무기한 양모 +10', '겨울 부역 @5 -3', '3년 대여 @1080 +20'] },
    ],
    derived: [{ id: 'income', label: '수입', expr: 'sum(deals)' }],
    rules: {
      onTurn: [
        { list: 'deals', expire: 'day' },        // 정산 전에 먼저 턴다
        { set: 'gold', expr: 'max(0, gold + income)' },
        { set: 'day', expr: 'day + 1' },
      ], events: [],
    },
    statusUI: { mode: 'auto', groups: [] }, setup: { presets: [] },
  };
  const v = validateSchema(E);
  ck('expire 쓰는 스키마 검증 통과', v.ok, JSON.stringify(v.errors));

  let st = engine.initState(E); st.meta.setupDone = true;
  const step = () => {
    st = engine.sendPhase(E, st).state;
    st = engine.outputPhase(E, st, {}, {}).state;
    return engine.makeLookup(E, st.vars)('income');
  };
  eq('기한 전엔 셋 다 산다', step(), 27);
  eq('day 1', step(), 27);
  step(); step(); step();                       // 여기까지 day 5 — @5는 5일까지 유효하다
  eq('기한 당일까지는 유효', step(), 27);
  eq('★ 기한이 지나면 빠진다', step(), 30);
  eq('무기한과 장기 계약은 남는다', st.vars.deals, ['무기한 양모 +10', '3년 대여 @1080 +20']);

  // 날짜를 통째로 건너뛰어도 절대값이라 저절로 맞는다
  let sk = engine.initState(E); sk.meta.setupDone = true;
  sk.vars.day = 900;
  sk = engine.outputPhase(E, engine.sendPhase(E, sk).state, {}, {}).state;
  eq('건너뛰어도 아직 유효', sk.vars.deals.length, 2);
  sk.vars.day = 2000;
  sk = engine.outputPhase(E, engine.sendPhase(E, sk).state, {}, {}).state;
  eq('★ 크게 건너뛰면 그만큼 만료', sk.vars.deals, ['무기한 양모 +10']);
}

// ── ⑦ 상대 기한 @+N 이 등록 시점에 절대값으로 굳는가 ──
{
  const R = {
    simcore: '0.1', meta: { name: '상대기한' },
    vars: [
      { id: 'day', label: '일', type: 'int', init: 0, min: 0 },
      { id: 'deals', label: '계약', type: 'list', init: [], maxItems: 8, itemMaxLength: 40 },
    ],
    derived: [{ id: 'income', label: '수입', expr: 'sum(deals)' }],
    rules: { onTurn: [{ list: 'deals', expire: 'day + 1' }, { set: 'day', expr: 'day + 1' }], events: [] },
    updater: { allow: [{ id: 'deals' }] },
    statusUI: { mode: 'auto', groups: [] }, setup: { presets: [] },
  };
  ck('상대기한 스키마 검증 통과', validateSchema(R).ok, '');
  let st = engine.initState(R); st.meta.setupDone = true;
  st.vars.day = 12;
  // 보조 AI가 "3년 계약"을 @+1080으로만 적는다 — 산술 없음
  st = engine.outputPhase(R, engine.sendPhase(R, st).state, { deals: { add: ['양모 계약 @+1080 +12'] } }, {}).state;
  eq('★ @+1080이 절대값으로 굳는다', st.vars.deals, ['양모 계약 @1093 +12']);   // day 12 + span 1 + 1080
  eq('굳은 뒤 값은 그대로', evaluate('sum(deals)', (n) => st.vars[n]), 12);
  // 절대값 표기도 그대로 통한다 (하위 호환)
  st = engine.outputPhase(R, engine.sendPhase(R, st).state, { deals: { add: ['단기 부역 @20 -3'] } }, {}).state;
  ck('절대 표기는 안 건드린다', st.vars.deals.includes('단기 부역 @20 -3'), JSON.stringify(st.vars.deals));
  // 굳은 기한이 실제로 만료까지 이어지는가
  st.vars.day = 25;
  st = engine.outputPhase(R, engine.sendPhase(R, st).state, {}, {}).state;
  eq('★ 굳은 기한대로 단기만 만료', st.vars.deals, ['양모 계약 @1093 +12']);
  // expire 규칙이 없으면 손대지 않는다 (안전한 실패 — 무기한이 될 뿐)
  const N = JSON.parse(JSON.stringify(R)); N.rules.onTurn = [{ set: 'day', expr: 'day + 1' }];
  let nt = engine.initState(N); nt.meta.setupDone = true;
  nt = engine.outputPhase(N, engine.sendPhase(N, nt).state, { deals: { add: ['양모 @+1080 +12'] } }, {}).state;
  eq('expire 규칙 없으면 그대로 둔다', nt.vars.deals, ['양모 @+1080 +12']);
  eq('굳지 않은 @+N은 기한 없음 취급', itemExpiry('양모 @+1080 +12'), null);
  eq('굳지 않아도 금액은 읽힌다', itemValue('양모 @+1080 +12'), 12);
}

// expire 검증: 수식이 아니면 거부
{
  const bad = {
    simcore: '0.1', meta: { name: 'b' },
    vars: [{ id: 'lst', label: 'l', type: 'list', init: [] }],
    rules: { onTurn: [{ list: 'lst', expire: 30 }], events: [] },
    statusUI: { mode: 'auto', groups: [] }, setup: { presets: [] },
  };
  const v = validateSchema(bad);
  ck('expire에 숫자를 주면 거부', !v.ok && v.errors.some((e) => /expire는 수식/.test(e.msg)), JSON.stringify(v.errors));
}
{
  const bad = {
    simcore: '0.1', meta: { name: 'b' },
    vars: [{ id: 'lst', label: 'l', type: 'list', init: [] }],
    rules: { onTurn: [{ list: 'lst', expire: 'nosuchvar' }], events: [] },
    statusUI: { mode: 'auto', groups: [] }, setup: { presets: [] },
  };
  const v = validateSchema(bad);
  ck('expire 수식의 없는 변수도 잡는다', !v.ok, JSON.stringify(v.errors));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
