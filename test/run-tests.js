// SimCore 테스트 — 모의 리스 파이프라인 포함
// 실행: node test/run-tests.js

const assert = require('assert');
const { evaluate, referencedVars, ExprError } = require('../core/expr');
const { seededRng } = require('../core/rng');
const { validateSchema } = require('../core/validate');
const engine = require('../core/engine');
const { SimSession } = require('../core/session');
const { MapBackend } = require('../core/store');
const { renderStatusHtml, scopeCss, buildStatusCss } = require('../core/render');
const FIXTURE = require('./fixture-estate');

// 큐 기반 하네스 — async 테스트를 순차 실행
const queue = [];
function test(name, fn) { queue.push({ kind: 'test', name, fn }); }
function section(name) { queue.push({ kind: 'section', name }); }
const deep = (a, b, msg) => assert.deepStrictEqual(a, b, msg);
const eq = (a, b, msg) => assert.strictEqual(a, b, msg);
const throws = (fn, msg) => assert.throws(fn, msg);

// 스키마는 매 테스트에서 오염 없이 쓰도록 클론 헬퍼
const fx = () => JSON.parse(JSON.stringify(FIXTURE));

// ═══════════════════════ 1. 표현식 ═══════════════════════
section('표현식 파서/평가기');

const L = (env) => (name) => env[name];

test('산술과 우선순위', () => {
  eq(evaluate('2 + 3 * 4', L({})), 14);
  eq(evaluate('(2 + 3) * 4', L({})), 20);
  eq(evaluate('10 % 3', L({})), 1);
  eq(evaluate('-5 + 3', L({})), -2);
});

test('비교/논리/3항', () => {
  eq(evaluate('3 > 2 and 1 <= 1', L({})), 1);
  eq(evaluate('not (1 == 1)', L({})), 0);
  eq(evaluate("food <= 0 and not famine", L({ food: 0, famine: false })), 1);
  eq(evaluate("loyalty < 30 ? 'low' : 'ok'", L({ loyalty: 10 })), 'low');
});

test('문자열 비교/연결', () => {
  eq(evaluate("season == '봄'", L({ season: '봄' })), 1);
  eq(evaluate("'계절: ' + season", L({ season: '여름' })), '계절: 여름');
});

test('함수: round/clamp/min/max', () => {
  eq(evaluate('round(2.5)', L({})), 3);
  eq(evaluate('clamp(150, 0, 100)', L({})), 100);
  eq(evaluate('min(3, 7, 1)', L({})), 1);
  eq(evaluate('max(3, 7)', L({})), 7);
});

test('rand는 시드 결정적', () => {
  const a = evaluate('rand(1, 100)', L({}), seededRng('c1', 5, 'x'));
  const b = evaluate('rand(1, 100)', L({}), seededRng('c1', 5, 'x'));
  const c = evaluate('rand(1, 100)', L({}), seededRng('c1', 6, 'x'));
  eq(a, b, '같은 시드 = 같은 값');
  assert.notStrictEqual(a, c, '다른 인덱스 = 다른 값(확률적이지만 이 시드에선 상이)');
  assert.ok(a >= 1 && a <= 100);
});

test('알 수 없는 변수/함수는 에러', () => {
  throws(() => evaluate('ghost + 1', L({})));
  throws(() => evaluate('hack("x")', L({})));
});

test('referencedVars 추출', () => {
  deep(referencedVars('round(population * 0.3) - military * 2').sort(), ['military', 'population']);
});

test('0 나눗셈은 0 (봇 생존)', () => {
  eq(evaluate('10 / 0', L({})), 0);
});

// ═══════════════════════ 2. 스키마 검증 ═══════════════════════
section('스키마 검증');

test('픽스처는 오류 없이 통과', () => {
  const r = validateSchema(fx());
  deep(r.errors, [], JSON.stringify(r.errors));
  eq(r.ok, true);
});

test('알 수 없는 변수 참조 검출 (위치 포함)', () => {
  const s = fx();
  s.derived.push({ id: 'bad', expr: 'ghost * 2' });
  const r = validateSchema(s);
  eq(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '$.derived[2].expr' && e.msg.includes('ghost')));
});

test('enum init 오류 / 중복 id / when의 rand 금지', () => {
  const s = fx();
  s.vars.push({ id: 'weather', type: 'enum', enum: ['맑음', '비'], init: '눈' });
  s.vars.push({ id: 'gold', type: 'int', init: 0 });
  s.rules.events[0].when = 'rand(1,2) > 1';
  const r = validateSchema(s);
  assert.ok(r.errors.some((e) => e.msg.includes('눈')));
  assert.ok(r.errors.some((e) => e.msg.includes('중복')));
  assert.ok(r.errors.some((e) => e.msg.includes('rand')));
});

test('허용 목록 캡 누락: 범위(min/max)가 있으면 경고 없음, 둘 다 없으면 경고', () => {
  // v0.38 동작: min/max 범위나 maxDelta 중 하나라도 있으면 통제 가능으로 본다
  const s = fx();
  delete s.updater.allow[0].maxDelta; // gold는 min:0이 있음 → 경고 없어야 함
  const r = validateSchema(s);
  eq(r.ok, true);
  assert.ok(!r.warnings.some((w) => w.path.includes('allow[0]')), 'min이 있으면 경고 없음');
  // 범위도 한도도 없는 변수는 경고
  s.vars.push({ id: 'freeval', type: 'int', init: 0, label: '자유값' });
  s.updater.allow.push({ id: 'freeval' });
  const r2 = validateSchema(s);
  eq(r2.ok, true);
  assert.ok(r2.warnings.some((w) => w.msg.includes('maxDelta')), '무제한 변수는 경고');
});

test('mentions 낱말이 표시 형식(format)에 포함되면 경고 — 대장간 사고 재현', () => {
  const s = fx();
  // gold의 format "{v}G"에 "G"가 아니라, 실측 사고 그대로: format에 단위 낱말
  s.vars.find((v) => v.id === 'gold').format = '{v}골드';
  s.updater.allow[0].mentions = ['입금', '골드'];
  const r = validateSchema(s);
  eq(r.ok, true);
  assert.ok(r.warnings.some((w) => w.msg.includes('표시 형식')), '단위 낱말 경고');
  // 거래 표현만 남기면 경고 없음
  s.updater.allow[0].mentions = ['입금', '출금'];
  const r2 = validateSchema(s);
  assert.ok(!r2.warnings.some((w) => w.msg.includes('표시 형식')), '정상 낱말은 통과');
});

test('mentions format 린트: 내장 템플릿 11종 오탐 0', () => {
  const { TEMPLATES } = require('../core/templates');
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const r = validateSchema(t.schema);
    const hits = r.warnings.filter((w) => w.msg.includes('표시 형식'));
    eq(hits.length, 0, `${key} 템플릿에서 오탐: ${hits.map((h) => h.msg).join(' / ')}`);
  }
});

// ── whenArmed (액션 잠금) — v0.39 ──
function armFx() {
  return {
    simcore: '0.1', meta: { name: '액션잠금' },
    vars: [{ id: 'money', label: '금고', type: 'int', init: 100, min: 0 }],
    actions: [
      { id: 'pay', label: '지불', mode: 'oneshot' },
      { id: 'guard', label: '경계', mode: 'hold' },
    ],
    updater: { allow: [{ id: 'money', maxDelta: 1000, whenArmed: 'pay' }] },
    statusUI: { mode: 'auto', groups: [] },
  };
}

test('whenArmed: 검증 통과 + 없는 액션 id는 에러', () => {
  const s = armFx();
  eq(validateSchema(s).ok, true);
  s.updater.allow[0].whenArmed = 'ghost';
  const r = validateSchema(s);
  eq(r.ok, false);
  assert.ok(r.errors.some((e) => e.msg.includes('ghost')));
});

test('whenArmed: 액션 없이는 델타 무시 (게이트 닫힘)', () => {
  const s = armFx();
  const send = engine.sendPhase(s, engine.initState(s), {});
  const out = engine.outputPhase(s, send.state, { money: -50 }, {});
  eq(out.state.vars.money, 100, '잠긴 변수는 안 움직임');
});

test('whenArmed: oneshot 발동 턴 개방 → 지연 소급도 개방 → 다음 턴 폐쇄', () => {
  const s = armFx();
  const st = engine.initState(s);
  st.meta.armed.pay = true;
  const send = engine.sendPhase(s, st, {});
  eq(send.state.meta.armed.pay, undefined, 'oneshot은 전송 시 무장 해제');
  eq(send.state.meta.firedThisSend.pay, true, '발동 기록 남음');
  const out = engine.outputPhase(s, send.state, { money: -50 }, {});
  eq(out.state.vars.money, 50, '발동 턴에는 적용');
  // 지연/브리지 소급: turn++ 이후에도 다음 전송 전까지는 발동 기록이 살아 있다
  const late = engine.applyChangesToState(s, out.state, { money: -10 }, {});
  eq(late.state.vars.money, 40, '소급 적용도 개방');
  // 다음 턴: 발동 기록 리셋 → 다시 닫힘
  const send2 = engine.sendPhase(s, late.state, {});
  const out2 = engine.outputPhase(s, send2.state, { money: -50 }, {});
  eq(out2.state.vars.money, 40, '다음 턴은 폐쇄');
});

test('whenArmed: hold 무장 중엔 계속 개방, 해제하면 폐쇄', () => {
  const s = armFx();
  s.updater.allow[0].whenArmed = 'guard';
  const st = engine.initState(s);
  st.meta.armed.guard = true;
  let cur = st;
  for (let i = 0; i < 2; i++) {
    const send = engine.sendPhase(s, cur, {});
    cur = engine.outputPhase(s, send.state, { money: -10 }, {}).state;
  }
  eq(cur.vars.money, 80, '무장 유지 2턴 연속 적용');
  delete cur.meta.armed.guard;
  const send3 = engine.sendPhase(s, cur, {});
  eq(engine.outputPhase(s, send3.state, { money: -10 }, {}).state.vars.money, 80, '해제 후 폐쇄');
});

test('whenArmed: 닫힌 턴에는 보조 프롬프트에서도 빠짐 (프롬프트=적용 동일 기준)', () => {
  const s = armFx();
  const st = engine.initState(s);
  const closed = engine.buildAuxPrompt(s, engine.sendPhase(s, st, {}).state, '서사', null);
  assert.ok(!closed.includes('- money'), '닫힌 턴엔 항목 제외');
  st.meta.armed.guard = true;
  s.updater.allow[0].whenArmed = ['pay', 'guard']; // 여럿 중 하나만 열려도 개방
  const open = engine.buildAuxPrompt(s, engine.sendPhase(s, st, {}).state, '서사', null);
  assert.ok(open.includes('- money'), '무장 턴엔 포함');
});

// ═══════════════════════ 3. 엔진: 전송 단계 ═══════════════════════
section('엔진: 전송 단계 (무장 액션)');

test('oneshot 액션: effects 결정 적용 + inject + 자동 해제', () => {
  const s = fx();
  let st = engine.initState(s);
  st.vars.turn = 3; // when: turn >= 2 통과
  st.meta.turn = 5;
  st.meta.armed.tax = true;
  const r = engine.sendPhase(s, st, {});
  eq(r.state.vars.gold, 1000 + Math.round(300 * 0.5)); // +150
  eq(r.state.vars.loyalty, 45);
  assert.ok(r.promptBlock.includes('특별 징세'));
  eq(r.state.meta.armed.tax, undefined, 'oneshot은 소비 후 해제');
  eq(r.state.meta.actionLastUsed.tax, 5, '쿨다운 기준 기록');
  deep(r.consumedActions, ['tax']);
});

test('hold 액션: 유지 + 매 전송 effects', () => {
  const s = fx();
  let st = engine.initState(s);
  st.meta.armed.patrol = true;
  let r = engine.sendPhase(s, st, {});
  eq(r.state.vars.gold, 980);
  eq(r.state.meta.armed.patrol, true, 'hold는 유지');
  r = engine.sendPhase(s, r.state, {});
  eq(r.state.vars.gold, 960, '두 번째 전송에도 적용');
});

test('when 미충족 액션은 무장돼 있어도 발동 안 함', () => {
  const s = fx();
  let st = engine.initState(s); // turn=1, when: turn>=2 실패
  st.meta.armed.tax = true;
  const r = engine.sendPhase(s, st, {});
  eq(r.state.vars.gold, 1000);
  deep(r.consumedActions, []);
});

test('쿨다운 중 재무장 차단', () => {
  const s = fx();
  let st = engine.initState(s);
  st.vars.turn = 3;
  st.meta.turn = 5;
  st.meta.actionLastUsed.tax = 4; // 1턴 전 사용, cooldown 3
  const r = engine.toggleAction(s, st, 'tax');
  eq(r.armed, false);
  assert.ok(r.blocked.includes('쿨다운'));
});

test('promptBlock에 상태·시스템 지침 포함', () => {
  const s = fx();
  const r = engine.sendPhase(s, engine.initState(s), {});
  assert.ok(r.promptBlock.includes('1개월차'));
  assert.ok(r.promptBlock.includes('자금 1,000G') === false, '템플릿은 원시값(1000)');
  assert.ok(r.promptBlock.includes('자금 1000G'));
  assert.ok(r.promptBlock.includes('상태창'), '시스템 지침 포함');
});

// ═══════════════════════ 4. 엔진: 응답 단계 ═══════════════════════
section('엔진: 응답 단계 (델타 캡·규칙·이벤트)');

test('델타 캡과 min clamp', () => {
  const s = fx();
  s.rules = {}; // 규칙 끄고 델타만 검증
  const st = engine.initState(s);
  const r = engine.outputPhase(s, st, { gold: -9999 }, {}, {});
  eq(r.state.vars.gold, 500, '캡 500 적용: 1000-500');
  const r2 = engine.outputPhase(s, r.state, { gold: -9999 }, {}, {});
  eq(r2.state.vars.gold, 0, 'min 0 clamp');
});

test('허용 밖 변수·enum 밖 값·비숫자 델타는 무시', () => {
  const s = fx();
  s.rules = {};
  const st = engine.initState(s);
  const r = engine.outputPhase(s, st, { turn: 99, season: '우기', gold: 'abc', famine: true }, {}, {});
  eq(r.state.vars.turn, 1, 'turn은 allow에 없음');
  eq(r.state.vars.season, '봄', 'enum 밖 값 거부');
  eq(r.state.vars.gold, 1000, '비숫자 델타 무시');
  eq(r.state.vars.famine, false, 'famine은 allow에 없음');
});

test('text 전체 재작성 + maxLength 캡', () => {
  const s = fx();
  s.rules = {};
  const st = engine.initState(s);
  const long = '아'.repeat(200);
  const r = engine.outputPhase(s, st, { situation: long }, {}, {});
  eq(r.state.vars.situation.length, 80);
});

test('enum 정상 교체', () => {
  const s = fx();
  s.rules = {};
  const st = engine.initState(s);
  const r = engine.outputPhase(s, st, { season: '여름' }, { season: '두 달이 지났다' }, {});
  eq(r.state.vars.season, '여름');
  eq(r.changeLog[0].reason, '두 달이 지났다');
});

test('onTurn 틱: 수지·소비 반영', () => {
  const s = fx();
  const st = engine.initState(s);
  // net_income = round(300*0.3) - 50*2 = 90-100 = -10 / food_need = 60
  const r = engine.outputPhase(s, st, {}, {}, {});
  eq(r.state.vars.turn, 2);
  eq(r.state.vars.gold, 990);
  eq(r.state.vars.food, 440);
});

test('기근 이벤트 체인: 발동→통지→해제', () => {
  const s = fx();
  let st = engine.initState(s);
  st.vars.food = 30; // 소비 60 → 0 이하로
  let r = engine.outputPhase(s, st, {}, {}, {});
  eq(r.state.vars.famine, true);
  eq(r.state.vars.loyalty, 40);
  assert.ok(r.firedEvents.includes('famine_start'));
  assert.ok(r.state.meta.pendingNotifies[0].includes('기근'));
  // 다음 전송에 통지 실림 + 큐 비워짐
  const send = engine.sendPhase(s, r.state, {});
  assert.ok(send.promptBlock.includes('[이벤트]'));
  deep(send.state.meta.pendingNotifies, []);
  // 식량 회복 → 기근 해제 (2회 출력: 첫 회는 여전히 부족)
  let st2 = engine.clone(send.state);
  st2.vars.food = 500;
  const r2 = engine.outputPhase(s, st2, {}, {}, {});
  eq(r2.state.vars.famine, false);
  assert.ok(r2.firedEvents.includes('famine_end'));
});

test('폭동 이벤트: 민심 바닥 시 발동, 회복 수치 적용', () => {
  const s = fx();
  let st = engine.initState(s);
  st.vars.loyalty = 5;
  const r = engine.outputPhase(s, st, {}, {}, {});
  eq(r.state.vars.loyalty, 25);
  eq(r.state.vars.military, 40);
});

test('랜덤 이벤트: 시드 결정적 + 쿨다운', () => {
  const s = fx();
  s.rules.onTurn = [];
  s.rules.events = [];
  s.rules.randomEvents.chancePerTurn = 1.0;
  const st = engine.initState(s);
  const rngA = () => seededRng('chatX', 7, 'output');
  const a = engine.outputPhase(s, st, {}, {}, { rng: rngA() });
  const b = engine.outputPhase(s, st, {}, {}, { rng: rngA() });
  deep(a.firedEvents, b.firedEvents, '같은 시드 = 같은 이벤트');
  deep(a.state.vars, b.state.vars, '같은 시드 = 같은 수치');
  assert.ok(a.firedEvents.length === 1);
  // 쿨다운: 방금 발동한 이벤트는 즉시 재발동 불가
  const fired = a.firedEvents[0];
  const c = engine.outputPhase(s, a.state, {}, {}, { rng: seededRng('chatX', 9, 'output') });
  if (c.firedEvents.length) {
    assert.notStrictEqual(c.firedEvents[0], fired, '쿨다운 중 동일 이벤트 재발동 금지');
  }
});

// ═══════════════════════ 4.5 최초 설정 (세션 0) ═══════════════════════
section('최초 설정 (프리셋 + AI 세팅)');

test('프리셋 적용: 값 덮어쓰기 + coerce', () => {
  const s = fx();
  let st = engine.initState(s);
  const r = engine.applyPreset(s, st, 'ruined');
  eq(r.applied, true);
  eq(r.state.vars.gold, 100);
  eq(r.state.vars.loyalty, 25);
  eq(r.state.vars.situation, '폐허 속 재건 시작');
  eq(engine.applyPreset(s, st, 'ghost').applied, false);
});

test('setupPhase: 절대값 적용, 틱 없음, 범위 clamp', () => {
  const s = fx();
  const st = engine.initState(s);
  const r = engine.setupPhase(s, st, { gold: 150, loyalty: 999, season: '가을', turn: 50 }, {});
  eq(r.state.vars.gold, 150, '절대값 (델타 아님)');
  eq(r.state.vars.loyalty, 100, 'max clamp');
  eq(r.state.vars.season, '가을');
  eq(r.state.vars.turn, 1, 'setup.ai.vars 밖 변수는 거부');
  eq(r.state.vars.food, 500, '언급 없는 변수는 init 유지 (틱 안 돎)');
  eq(r.state.meta.setupDone, true);
  eq(r.state.meta.turn, 0, '설정 턴은 턴 카운트 안 함');
});

test('isSetupPending: ai.enabled + turn 0 + 미완료일 때만', () => {
  const s = fx();
  let st = engine.initState(s);
  eq(engine.isSetupPending(s, st), true);
  const done = engine.setupPhase(s, st, {}, {});
  eq(engine.isSetupPending(s, done.state), false);
  const s2 = fx();
  s2.setup.ai.enabled = false;
  eq(engine.isSetupPending(s2, engine.initState(s2)), false);
});

test('설정 대기 중 promptBlock에 최초설정 지침 포함', () => {
  const s = fx();
  const r = engine.sendPhase(s, engine.initState(s), {});
  assert.ok(r.promptBlock.includes('최초 설정 진행 중'));
  const done = engine.setupPhase(s, r.state, {}, {});
  const r2 = engine.sendPhase(s, done.state, {});
  assert.ok(!r2.promptBlock.includes('최초 설정 진행 중'));
});

test('buildSetupPrompt: 절대값 명세 + 범위', () => {
  const s = fx();
  const p = engine.buildSetupPrompt(s, engine.initState(s), '몰락한 변경백이다.');
  assert.ok(p.includes('절대값'));
  assert.ok(p.includes('최대 100'), 'loyalty 범위');
  assert.ok(p.includes('"values"'));
  assert.ok(!p.includes('turn ('), 'setup.ai.vars 밖 변수는 명세에 없음');
});

test('세션: 설정 턴 → 일반 턴 전환 + 설정 리롤 멱등', async () => {
  const s = fx();
  s.rules.randomEvents.chancePerTurn = 0;
  const sess = new SimSession(s, new MapBackend(), { chatId: 'setup1' });
  await sess.init();
  const send0 = await sess.onSend(0);
  eq(await sess.isSetupTurn(1), true);
  const setup = await sess.onSetupOutput(1, '{"values":{"gold":150,"military":15},"reasons":{}}');
  eq(setup.state.vars.gold, 150);
  eq(setup.state.vars.turn, 1, '틱 없음');
  // 설정 리롤: 다른 값으로 다시 → 교체 (누적 아님)
  await sess.onSend(0);
  eq(await sess.isSetupTurn(1), true, '리롤 시 pre 스냅샷 복원으로 다시 설정 턴');
  const setup2 = await sess.onSetupOutput(1, '{"values":{"gold":5000},"reasons":{}}');
  eq(setup2.state.vars.gold, 5000);
  eq(setup2.state.vars.military, 50, '이전 설정값은 리셋 (init 기준 재적용)');
  // 다음 턴은 일반 경로
  await sess.onSend(2);
  eq(await sess.isSetupTurn(3), false);
  const t1 = await sess.onOutput(3, '{"changes":{"gold":-100},"reasons":{}}');
  eq(t1.state.vars.turn, 2, '이제 틱 돎');
});

test('resetAll: 스냅샷 삭제 + 초기 상태 + 설정 대기 부활', async () => {
  const s = fx();
  s.rules.randomEvents.chancePerTurn = 0;
  const backend = new MapBackend();
  const sess = new SimSession(s, backend, { chatId: 'reset1' });
  await sess.init();
  await sess.onSend(0);
  await sess.onSetupOutput(1, '{"values":{"gold":9000},"reasons":{}}');
  assert.ok(backend.keys().length > 0);
  await sess.resetAll();
  eq(backend.keys().length, 0);
  eq(sess.current.vars.gold, 1000);
  eq(engine.isSetupPending(s, sess.current), true);
});

test('setup 검증: 프리셋 오류 검출', () => {
  const s = fx();
  s.setup.presets.push({ id: 'bad', label: 'x', set: { ghost: 1, loyalty: '많이', season: '우기' } });
  const r = validateSchema(s);
  eq(r.ok, false);
  assert.ok(r.errors.some((e) => e.msg.includes('ghost')));
  assert.ok(r.errors.some((e) => e.msg.includes('loyalty')));
  assert.ok(r.errors.some((e) => e.msg.includes('우기')));
});

// ═══════════════════════ 4.7 목록(list) 타입 ═══════════════════════
section('목록(list) 타입 — 인벤토리');

const { TEMPLATES } = require('../core/templates');
const rpg = () => JSON.parse(JSON.stringify(TEMPLATES.rpg.schema));

test('expr: count/has가 목록을 다룸', () => {
  const env = (n) => ({ inventory: ['빵', '회복약', '회복약'], hp: 10 }[n]);
  eq(evaluate('count(inventory)', env), 3);
  eq(evaluate("has(inventory, '회복약')", env), 1);
  eq(evaluate("has(inventory, '검')", env), 0);
  eq(evaluate("count(inventory) > 2 and has(inventory, '빵')", env), 1);
});

test('coerce: 개수 캡·글자 캡·문자열 분해', () => {
  const def = { type: 'list', maxItems: 3, itemMaxLength: 4 };
  deep(engine.coerce(def, ['하나', '둘', '셋', '넷']), ['하나', '둘', '셋']);
  deep(engine.coerce(def, '가, 나 , 다'), ['가', '나', '다']);
  deep(engine.coerce(def, ['아주아주긴아이템']), ['아주아주']);
});

test('보조 모델 델타: add/remove 연산만 허용, 전체 교체 거부', () => {
  const s = rpg();
  s.rules = {};
  const st = engine.initState(s); // inventory: ['빵','물통']
  const r = engine.outputPhase(s, st, { inventory: { add: ['회복약', '지도'], remove: ['빵'] } }, {}, {});
  deep(r.state.vars.inventory, ['물통', '회복약', '지도']);
  const r2 = engine.outputPhase(s, r.state, { inventory: ['전부', '교체'] }, {}, {});
  deep(r2.state.vars.inventory, ['물통', '회복약', '지도'], '배열 직접 제시(전체 교체)는 무시');
});

test('중복 아이템: 같은 것 2개 소지, 하나만 제거', () => {
  const def = { type: 'list' };
  const a = engine.applyListOps(def, ['회복약'], { add: ['회복약'] });
  deep(a, ['회복약', '회복약']);
  const b = engine.applyListOps(def, a, { remove: ['회복약'] });
  deep(b, ['회복약']);
});

test('maxItems 초과 add는 잘림', () => {
  const s = rpg();
  s.rules = {};
  const st = engine.initState(s);
  st.vars.inventory = Array.from({ length: 14 }, (_, i) => '아이템' + i);
  const r = engine.outputPhase(s, st, { inventory: { add: ['A', 'B', 'C'] } }, {}, {});
  eq(r.state.vars.inventory.length, 15, 'maxItems 15 캡');
});

test('액션의 아이템 효과: 회복약 사용 (제거 + HP 회복)', () => {
  const s = rpg();
  let st = engine.initState(s);
  st.vars.inventory = ['회복약', '빵'];
  st.vars.hp = 30;
  st.meta.armed.potion = true;
  const r = engine.sendPhase(s, st, {});
  deep(r.state.vars.inventory, ['빵']);
  eq(r.state.vars.hp, 80, '30 + 50');
});

test("액션 when: has()로 소지 조건 — 없으면 무장 차단", () => {
  const s = rpg();
  const st = engine.initState(s); // 회복약 없음
  const r = engine.toggleAction(s, st, 'potion');
  eq(r.armed, false);
  st.vars.inventory.push('회복약');
  eq(engine.toggleAction(s, st, 'potion').armed, true);
});

test('상태창 렌더: 아이템 칩 + 빈 목록 + 변화 로그', () => {
  const s = rpg();
  const st = engine.initState(s);
  const html = renderStatusHtml(s, st, [
    { id: 'inventory', from: ['빵', '물통'], to: ['물통', '회복약'], source: 'llm', reason: '상점 구매' },
  ]);
  assert.ok(html.includes('sim-tag'));
  assert.ok(html.includes('빵'));
  assert.ok(html.includes('+회복약'));
  assert.ok(html.includes('-빵'));
  st.vars.inventory = [];
  assert.ok(renderStatusHtml(s, st).includes('비어 있음'));
});

test('검증: list 오류 검출 (init/수식 set/예약어)', () => {
  const s = rpg();
  s.vars.push({ id: 'bad', type: 'list', init: '문자열' });
  s.rules.onTurn = [{ set: 'inventory', expr: '1' }];
  s.vars.push({ id: 'count', type: 'int', init: 0 });
  const r = validateSchema(s);
  eq(r.ok, false);
  assert.ok(r.errors.some((e) => e.msg.includes('배열')));
  assert.ok(r.errors.some((e) => e.msg.includes('수식 set 불가')));
  assert.ok(r.errors.some((e) => e.msg.includes('예약어')));
});

test('세션 0 + 프리셋: 목록 절대값 설정', () => {
  const s = rpg();
  const st = engine.initState(s);
  const pr = engine.applyPreset(s, st, 'veteran');
  deep(pr.state.vars.inventory, ['회복약', '회복약', '낡은 지도']);
  const su = engine.setupPhase(s, st, { inventory: ['목검', '수통'] }, {});
  deep(su.state.vars.inventory, ['목검', '수통']);
});

test('레벨업 이벤트 체인 (RPG 템플릿)', () => {
  const s = rpg();
  s.rules.randomEvents.chancePerTurn = 0;
  let st = engine.initState(s);
  st.vars.hp = 40;
  const r = engine.outputPhase(s, st, { exp: 80, hp: -20 }, {}, {});
  // exp 80 → 80 < 100 미달 / 한 번 더
  const r2 = engine.outputPhase(s, r.state, { exp: 80 }, {}, {});
  eq(r2.state.vars.level, 2, '누적 160 >= 100 → 레벨업');
  eq(r2.state.vars.exp, 60);
  eq(r2.state.vars.hp, 120, '레벨업 시 최대 HP(80+40)로 회복');
  assert.ok(r2.state.meta.pendingNotifies.some((n) => n.includes('레벨 업')));
});

section('상태 지시문 (directives)');

test('조건 만족 시 매 턴 주입 + 자리표시자', () => {
  const s = fx();
  s.directives = [
    { id: 'cold', when: 'loyalty < 30', text: '민심이 흉흉하다 (현재 {loyalty}). 백성들이 차갑게 대한다.' },
    { id: 'ok', when: 'loyalty >= 30', text: '영지는 안정적이다.' },
  ];
  s.setup.ai.enabled = false;
  let st = engine.initState(s); // loyalty 50
  let r = engine.sendPhase(s, st, {});
  assert.ok(r.promptBlock.includes('안정적'));
  assert.ok(!r.promptBlock.includes('흉흉'));
  deep(r.activeDirectives, ['ok']);
  st.vars.loyalty = 10;
  r = engine.sendPhase(s, st, {});
  assert.ok(r.promptBlock.includes('흉흉하다 (현재 10)'));
  assert.ok(!r.promptBlock.includes('안정적'));
});

test('세션 0 중에는 지시문 미주입', () => {
  const s = fx();
  s.directives = [{ id: 'always', when: 'true', text: '항상 나오는 지시문' }];
  const r = engine.sendPhase(s, engine.initState(s), {}); // setup pending
  assert.ok(!r.promptBlock.includes('항상 나오는 지시문'));
  const done = engine.setupPhase(s, engine.initState(s), {}, {});
  const r2 = engine.sendPhase(s, done.state, {});
  assert.ok(r2.promptBlock.includes('항상 나오는 지시문'));
});

test('지시문 검증: 미지 변수/rand/빈 내용', () => {
  const s = fx();
  s.directives = [
    { id: 'a', when: 'ghost > 1', text: 'x' },
    { id: 'b', when: 'rand(1,2) > 1', text: 'x' },
    { id: 'a', when: 'true', text: '' },
  ];
  const r = validateSchema(s);
  eq(r.ok, false);
  assert.ok(r.errors.some((e) => e.msg.includes('ghost')));
  assert.ok(r.errors.some((e) => e.msg.includes('rand')));
  assert.ok(r.errors.some((e) => e.msg.includes('중복 지시문')));
  assert.ok(r.errors.some((e) => e.msg.includes('내용')));
});

test('RPG 템플릿 지시문: 중상 상태에서 발동', () => {
  const s = JSON.parse(JSON.stringify(TEMPLATES.rpg.schema));
  s.setup.ai.enabled = false;
  s.rules.randomEvents.chancePerTurn = 0;
  let st = engine.initState(s);
  st.vars.hp = 20; // max_hp 100의 25% 이하
  const r = engine.sendPhase(s, st, {});
  assert.ok(r.promptBlock.includes('심각한 부상'));
  assert.ok(r.promptBlock.includes('(HP 20/100)'));
});

section('증감 한도 (비대칭 캡)');

test('maxGain/maxLoss 비대칭 캡: +5천만 사태 방지', () => {
  const s = fx();
  s.rules = {};
  s.updater.allow = [{ id: 'gold', maxGain: 100, maxLoss: 1000 }];
  const st = engine.initState(s);
  const up = engine.outputPhase(s, st, { gold: 50000000 }, {}, {});
  eq(up.state.vars.gold, 1100, '고대 유적 +5천만 → +100만 적용');
  const down = engine.outputPhase(s, st, { gold: -50000 }, {}, {});
  eq(down.state.vars.gold, 0, '-5만 → -1000 캡 후 min 0 clamp');
});

test('maxDelta는 양방향 폴백으로 유지 (기존 카드 호환)', () => {
  const s = fx();
  s.rules = {};
  // 픽스처 gold: maxDelta 500
  const st = engine.initState(s);
  eq(engine.outputPhase(s, st, { gold: 9999 }, {}, {}).state.vars.gold, 1500);
  eq(engine.outputPhase(s, st, { gold: -9999 }, {}, {}).state.vars.gold, 500);
  // maxGain만 지정하면 증가는 그걸, 감소는 maxDelta를 따름
  s.updater.allow[0] = { id: 'gold', maxGain: 50, maxDelta: 500 };
  eq(engine.outputPhase(s, st, { gold: 9999 }, {}, {}).state.vars.gold, 1050);
  eq(engine.outputPhase(s, st, { gold: -9999 }, {}, {}).state.vars.gold, 500);
});

test('보조 모델 프롬프트에 비대칭 한도 명세', () => {
  const s = fx();
  s.updater.allow = [{ id: 'gold', maxGain: 100, maxLoss: 1000 }];
  const p = engine.buildAuxPrompt(s, engine.initState(s), '서사');
  assert.ok(p.includes('증가 최대 +100'));
  assert.ok(p.includes('감소 최대 -1000'));
});

test('검증: 음수 한도 거부', () => {
  const s = fx();
  s.updater.allow.push({ id: 'food', maxGain: -5 });
  const r = validateSchema(s);
  assert.ok(r.errors.some((e) => e.msg.includes('maxGain')));
});

section('봇 업데이트 호환 (reconcile)');

test('구버전 세이브에 새 변수 추가돼도 안 죽음', () => {
  const s = fx();
  s.setup.ai.enabled = false;
  // 구버전 세이브: hunger가 없던 시절의 스냅샷 흉내
  const oldState = engine.initState(s);
  s.vars.push({ id: 'hunger', label: '허기', type: 'int', init: 80, min: 0, max: 100 });
  s.rules.onTurn.push({ set: 'hunger', expr: 'hunger - 5' });
  s.directives = [{ id: 'starving', when: 'hunger <= 20', text: '매우 배가 고픈 상태다.' }];
  // 새 스키마로 구 세이브를 그대로 돌려도 동작해야 함
  const send = engine.sendPhase(s, oldState, {});
  eq(send.state.vars.hunger, 80, '새 변수는 init으로 채워짐');
  const out = engine.outputPhase(s, send.state, {}, {}, {});
  eq(out.state.vars.hunger, 75, '새 규칙도 즉시 동작');
});

test('스키마에서 사라진 변수는 보존·무시', () => {
  const s = fx();
  s.setup.ai.enabled = false;
  const oldState = engine.initState(s);
  oldState.vars.legacy_var = 42; // 옛 스키마의 잔재
  const r = engine.outputPhase(s, oldState, {}, {}, {});
  eq(r.state.vars.legacy_var, 42, '파괴적 삭제 금지');
});

test('세션 로드 시에도 reconcile 적용', async () => {
  const s = fx();
  s.rules.randomEvents.chancePerTurn = 0;
  const backend = new MapBackend();
  const sess = new SimSession(s, backend, { chatId: 'mig1' });
  await sess.init();
  await sess.onSend(0);
  await sess.onOutput(1, '{"changes":{},"reasons":{}}');
  // 봇 v2: 변수 추가된 스키마로 재로드
  const s2 = fx();
  s2.vars.push({ id: 'fame', label: '명성', type: 'int', init: 10 });
  const sess2 = new SimSession(s2, backend, { chatId: 'mig1' });
  await sess2.init(1);
  eq(sess2.current.vars.fame, 10);
  eq(sess2.current.vars.gold, 990, '기존 값은 유지 (1000 + 턴 수지 -10)');
});

test('buildAuxPrompt: 유저 입력 포함', () => {
  const s = fx();
  const p = engine.buildAuxPrompt(s, engine.initState(s), '영주는 고개를 끄덕였다.', '국고에서 500골드를 백성들에게 나눠준다');
  assert.ok(p.includes('[유저의 행동/발화]'));
  assert.ok(p.includes('500골드를 백성들에게'));
  const p2 = engine.buildAuxPrompt(s, engine.initState(s), '영주는 고개를 끄덕였다.');
  assert.ok(!p2.includes('[유저의 행동/발화]'), '유저 입력 없으면 섹션 생략');
});

section('템플릿');

test('모든 내장 템플릿이 검증 통과', () => {
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const r = validateSchema(t.schema);
    deep(r.errors, [], `${key}: ${JSON.stringify(r.errors)}`);
  }
});

test('템플릿 프롬프트 렌더: 목록 join', () => {
  const s = rpg();
  const st = engine.initState(s);
  const send = engine.sendPhase(s, st, {});
  assert.ok(send.promptBlock.includes('소지품: 빵, 물통'));
});

// ═══════════════════════ 5. 보조 모델 인터페이스 ═══════════════════════
section('보조 모델 프롬프트/파싱');

test('buildAuxPrompt: 허용 변수 명세 포함', () => {
  const s = fx();
  const p = engine.buildAuxPrompt(s, engine.initState(s), '용병단을 고용했다.');
  assert.ok(p.includes('gold'));
  assert.ok(p.includes('증가 최대 +500'));
  assert.ok(p.includes('봄 | 여름'));
  assert.ok(p.includes('용병단'));
  assert.ok(p.includes('"changes"'));
});

test('parseAuxResponse: 정상/코드펜스/잡담/쓰레기', () => {
  deep(engine.parseAuxResponse('{"changes":{"gold":-100},"reasons":{}}').changes, { gold: -100 });
  deep(engine.parseAuxResponse('결과입니다:\n```json\n{"changes":{"gold":-100},"reasons":{}}\n```').changes, { gold: -100 });
  eq(engine.parseAuxResponse('모르겠어요'), null);
  eq(engine.parseAuxResponse(null), null);
});

// ═══════════════════════ 6. 세션: 모의 파이프라인 + 리롤 ═══════════════════════
section('세션: 모의 리스 파이프라인');

// 모의 채팅: 메시지 배열 흉내. 유저 msg 인덱스 = 짝수, char = 홀수 (greeting 없는 단순화)
async function playTurn(session, chatLen, auxText) {
  const send = await session.onSend(chatLen);          // 유저 메시지 인덱스
  const out = await session.onOutput(chatLen + 1, auxText); // char 메시지 인덱스
  return { send, out };
}

test('3턴 진행 + 상태 연속성', async () => {
  const s = fx();
  s.rules.randomEvents.chancePerTurn = 0; // 랜덤 제외
  const sess = new SimSession(s, new MapBackend(), { chatId: 'c1' });
  await sess.init();
  const t1 = await playTurn(sess, 0, '{"changes":{"gold":-100},"reasons":{"gold":"용병 고용"}}');
  eq(t1.out.state.vars.gold, 1000 - 100 - 10); // 델타 후 onTurn(-10)
  const t2 = await playTurn(sess, 2, '{"changes":{},"reasons":{}}');
  eq(t2.out.state.vars.gold, 890 - 10);
  eq(t2.out.state.vars.turn, 3);
});

test('리롤 멱등성: 같은 인덱스 재실행 시 이중 적용 없음', async () => {
  const s = fx();
  s.rules.randomEvents.chancePerTurn = 0;
  const sess = new SimSession(s, new MapBackend(), { chatId: 'c2' });
  await sess.init();
  await playTurn(sess, 0, '{"changes":{"gold":-100},"reasons":{}}');
  const gold1 = sess.current.vars.gold;
  // 리롤: 같은 인덱스로 send/output 재실행 (보조 모델이 같은 델타 반환 가정)
  const re = await playTurn(sess, 0, '{"changes":{"gold":-100},"reasons":{}}');
  eq(re.out.state.vars.gold, gold1, '리롤해도 같은 결과 (이중 적용 없음)');
  // 보조 모델이 다른 델타를 내면: base가 같으므로 "교체"지 "누적"이 아님
  const re2 = await playTurn(sess, 0, '{"changes":{"gold":-300},"reasons":{}}');
  eq(re2.out.state.vars.gold, 1000 - 300 - 10, '베이스 기준 재계산');
});

test('리롤 시 무장 액션도 멱등 (pre 스냅샷 복원)', async () => {
  const s = fx();
  s.rules.randomEvents.chancePerTurn = 0;
  const sess = new SimSession(s, new MapBackend(), { chatId: 'c3' });
  await sess.init();
  await playTurn(sess, 0, '{"changes":{},"reasons":{}}'); // turn=2가 됨
  sess.toggle('tax'); // 무장
  const t2 = await playTurn(sess, 2, '{"changes":{},"reasons":{}}');
  const goldAfter = t2.out.state.vars.gold;
  assert.ok(t2.send.consumedActions.includes('tax'));
  // 리롤: pre 스냅샷에 무장 상태가 있으므로 다시 발동되지만 이중 적용은 아님
  const re = await playTurn(sess, 2, '{"changes":{},"reasons":{}}');
  eq(re.out.state.vars.gold, goldAfter, '징세 효과가 정확히 1회분');
  assert.ok(re.send.consumedActions.includes('tax'), '리롤에서도 같은 액션 재현');
});

test('리롤 안정 랜덤: 같은 턴 리롤 = 같은 이벤트', async () => {
  const s = fx();
  s.rules.randomEvents.chancePerTurn = 1.0;
  const sess = new SimSession(s, new MapBackend(), { chatId: 'c4' });
  await sess.init();
  const a = await playTurn(sess, 0, '{"changes":{},"reasons":{}}');
  const b = await playTurn(sess, 0, '{"changes":{},"reasons":{}}'); // 리롤
  deep(a.out.firedEvents, b.out.firedEvents);
  deep(a.out.state.vars, b.out.state.vars);
});

test('메시지 삭제 복구: 과거 인덱스로 돌아가면 그 시점 상태', async () => {
  const s = fx();
  s.rules.randomEvents.chancePerTurn = 0;
  const sess = new SimSession(s, new MapBackend(), { chatId: 'c5' });
  await sess.init();
  await playTurn(sess, 0, '{"changes":{"gold":-100},"reasons":{}}');
  const goldT1 = sess.current.vars.gold;
  await playTurn(sess, 2, '{"changes":{"gold":-200},"reasons":{}}');
  assert.notStrictEqual(sess.current.vars.gold, goldT1);
  // 유저가 턴2 메시지 2개 삭제 → 다음 전송이 다시 인덱스 2로
  const re = await playTurn(sess, 2, '{"changes":{},"reasons":{}}');
  eq(re.send.state.vars.gold, goldT1, '턴1 종료 시점에서 재개');
});

test('채팅 재로드: 스냅샷에서 current 복원', async () => {
  const s = fx();
  s.rules.randomEvents.chancePerTurn = 0;
  const backend = new MapBackend();
  const sess = new SimSession(s, backend, { chatId: 'c6' });
  await sess.init();
  await playTurn(sess, 0, '{"changes":{"gold":-100},"reasons":{}}');
  const snapshotGold = sess.current.vars.gold;
  // 앱 재시작 흉내: 새 세션, 같은 backend
  const sess2 = new SimSession(s, backend, { chatId: 'c6' });
  await sess2.init(1); // 마지막 char 메시지 인덱스
  eq(sess2.current.vars.gold, snapshotGold);
});

// ═══════════════════════ 7. 렌더 ═══════════════════════
section('상태창 렌더');

test('auto 모드: 라벨·게이지·뱃지·포맷', () => {
  const s = fx();
  const st = engine.initState(s);
  const html = renderStatusHtml(s, st, null, [
    { id: 'tax', label: '특별 징세', armed: false, disabled: true, reason: '조건 미충족' },
    { id: 'patrol', label: '순찰 강화', armed: true },
  ]);
  assert.ok(html.includes('자금'));
  assert.ok(html.includes('1,000G'), '표시용 포맷 적용');
  assert.ok(html.includes('sim-bar-fill'));
  assert.ok(html.includes('#27ae60'), '민심 50 → 녹색');
  // v0.38 동작: 상태창 속 액션은 표시 전용 (리스가 메시지 내 클릭 target을 안 넘겨줌)
  assert.ok(html.includes('sim-action'), '액션 표시');
  assert.ok(!html.includes('x-sim-action'), '메시지 내 클릭 속성 제거됨 (표시 전용)');
  assert.ok(html.includes('sim-disabled'), '조건 미충족 표시');
  assert.ok(html.includes('sim-armed'), 'hold 무장 표시');
  assert.ok(html.includes('평온함'));
});

test('변화 로그 렌더', () => {
  const s = fx();
  const st = engine.initState(s);
  const html = renderStatusHtml(s, st, [
    { id: 'gold', from: 1000, to: 880, source: 'llm', reason: '용병단 고용' },
    { id: 'turn', from: 1, to: 2, source: 'onTurn' }, // onTurn은 로그 미표시
  ]);
  assert.ok(html.includes('용병단 고용'));
  assert.ok(html.includes('-120'));
  assert.ok(!html.includes('경과 +1'), '정기 틱은 로그에서 제외');
});

test('XSS 이스케이프', () => {
  const s = fx();
  const st = engine.initState(s);
  st.vars.situation = '<script>alert(1)</script>';
  const html = renderStatusHtml(s, st);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('그룹 표시 모드: 숨김(내부용)·접힘', () => {
  const s = fx();
  s.vars.push({ id: 'danger', label: '위험도', type: 'int', init: 3 });
  s.statusUI.groups.push({ label: '내부', visibility: 'hidden', items: [{ var: 'danger' }] });
  s.statusUI.groups.push({ label: '세부', visibility: 'collapsed', items: [{ var: 'military' }] });
  const st = engine.initState(s);
  const html = renderStatusHtml(s, st);
  assert.ok(!html.includes('위험도'), '숨김 그룹은 채팅 상태창에 없음');
  assert.ok(html.includes('<details class="sim-group"><summary'), '접힘 그룹은 details');
  assert.ok(html.includes('세부'));
  // 숨김이어도 규칙·프롬프트에서는 살아있음
  s.rules.events.push({ id: 'danger_up', when: 'danger >= 3', effects: [{ set: 'danger', expr: 'danger + 1' }] });
  const r = engine.outputPhase(s, st, {}, {}, {});
  eq(r.state.vars.danger, 4);
  const v = validateSchema(s);
  deep(v.errors, []);
  s.statusUI.groups[3].visibility = '이상한값';
  assert.ok(!validateSchema(s).ok);
});

test('조건부 표시(showWhen): 항목·그룹 등장/퇴장', () => {
  const s = fx();
  s.vars.push({ id: 'curse', label: '저주', type: 'int', init: 0, min: 0 });
  s.statusUI.groups.push({
    label: '재난', showWhen: 'famine or curse > 0',
    items: [
      { var: 'famine', showWhen: 'famine' },
      { var: 'curse', showWhen: 'curse > 0', bar: { max: 10 } },
    ],
  });
  const st = engine.initState(s);
  let html = renderStatusHtml(s, st);
  assert.ok(!html.includes('재난'), '평시엔 그룹 자체가 없음');
  st.vars.curse = 3;
  html = renderStatusHtml(s, st);
  assert.ok(html.includes('재난'), '저주 걸리면 그룹 등장');
  assert.ok(html.includes('저주'));
  assert.ok(!html.includes('기근'), '기근 항목은 아직 조건 미달로 숨김');
  st.vars.famine = true;
  html = renderStatusHtml(s, st);
  assert.ok(html.includes('기근'));
  // 검증: 미지 변수 showWhen
  s.statusUI.groups[3].showWhen = 'ghost > 1';
  assert.ok(!validateSchema(s).ok);
});

test('영지 템플릿: 기근 항목은 기근일 때만 표시', () => {
  const s = fx();
  const st = engine.initState(s);
  assert.ok(!renderStatusHtml(s, st).includes('기근'));
  st.vars.famine = true;
  assert.ok(renderStatusHtml(s, st).includes('기근'));
});

test('템플릿 모드: {id} 치환 + {list:tags} 칩 + 검증', () => {
  const s = fx();
  s.vars.push({ id: 'facilities', label: '시설', type: 'list', init: ['무너진 병영', '오염된 수로'] });
  s.statusUI = { mode: 'template', collapsible: false,
    template: '<div class="ledger">재정 {gold}G / 사기 {loyalty}<ul>{facilities:tags}</ul></div>' };
  const st = engine.initState(s);
  const html = renderStatusHtml(s, st);
  assert.ok(html.includes('재정 1000G'));
  assert.ok(html.includes('<span class="sim-tag">무너진 병영</span>'));
  deep(validateSchema(s).errors, []);
  s.statusUI.template = '{ghost} {facilities:tags}';
  assert.ok(validateSchema(s).errors.some((e) => e.msg.includes('ghost')));
  s.statusUI.template = '';
  assert.ok(validateSchema(s).errors.some((e) => e.msg.includes('비어')));
});

test('tags 필터: XSS 이스케이프', () => {
  const s = fx();
  s.vars.push({ id: 'items', label: '아이템', type: 'list', init: ['<img onerror=x>'] });
  s.statusUI = { mode: 'template', template: '{items:tags}' };
  const html = renderStatusHtml(s, engine.initState(s));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('scopeCss: @keyframes/@media/주석 대응', () => {
  const css = `
/* 주석 { 중괄호 함정 } */
.vl-panel { color: red; }
@keyframes rise { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 520px) { .vl-panel { width: 94vw; } .vl-grid { gap: 0; } }
`;
  const out = scopeCss(css);
  assert.ok(out.includes('.sim-status .vl-panel{color: red;}'), '일반 셀렉터 스코핑');
  assert.ok(out.includes('from{opacity: 0;}'), 'keyframes 내부는 스코핑 금지');
  assert.ok(!out.includes('.sim-status from'), 'from에 접두사 없어야 함');
  assert.ok(out.includes('@media (max-width: 520px){.sim-status .vl-panel{'), 'media 내부는 스코핑');
  assert.ok(!out.includes('/*'), '주석 제거');
  // 중괄호 짝 검증
  const opens = (out.match(/\{/g) || []).length;
  const closes = (out.match(/\}/g) || []).length;
  eq(opens, closes, '중괄호 균형');
});

test('통짜 붙여넣기: 템플릿 속 <style> 자동 분리', () => {
  const s = fx();
  s.statusUI = { mode: 'template', collapsible: false,
    template: '<style>.vl-x { color: gold; } @keyframes f { from { opacity: 0; } }</style><div class="vl-x">재정 {gold}G</div>' };
  deep(validateSchema(s).errors, [], 'CSS 중괄호를 자리표시자로 오인하지 않음');
  const st = engine.initState(s);
  const html = renderStatusHtml(s, st);
  assert.ok(html.includes('재정 1000G'));
  assert.ok(!html.includes('<style>.vl-x'), '본문에서 style 제거됨');
  const css = buildStatusCss(s);
  assert.ok(css.includes('.sim-status .vl-x{color: gold;}'), '분리된 CSS가 스코핑되어 포함');
});

test('customCSS 스코핑', () => {
  const out = scopeCss('.sim-bar-fill { background: gold; } button, .x { color: red; }');
  assert.ok(out.includes('.sim-status .sim-bar-fill'));
  assert.ok(out.includes('.sim-status button'));
  assert.ok(out.includes('.sim-status .x'));
});

// ═══════════════════════ 실행 & 결과 ═══════════════════════
(async () => {
  let passed = 0, failed = 0;
  const failures = [];
  for (const item of queue) {
    if (item.kind === 'section') { console.log(`\n■ ${item.name}`); continue; }
    try {
      await item.fn();
      passed++;
      console.log(`  ✓ ${item.name}`);
    } catch (e) {
      failed++;
      failures.push({ name: item.name, e });
      console.log(`  ✗ ${item.name}\n     ${e.message}`);
    }
  }
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`통과 ${passed} / 실패 ${failed}`);
  if (failed > 0) {
    console.log('\n실패 상세:');
    for (const f of failures) console.log(`- ${f.name}:\n  ${f.e.stack?.split('\n').slice(0, 4).join('\n  ')}`);
    process.exit(1);
  }
})();
