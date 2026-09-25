const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.11.0 체크포인트 (core/checkpoint.js, 설계 docs/design-조퇴악녀.md §12) — 되감기.
//
// 검증 축 = 약속 다섯:
//  ① 되감기는 변수 전부 — 예약 키(날짜 time_epoch·막 scn_idx)까지 저장 시점으로 돌아간다.
//  ② 기억은 남는다 — keep 변수와 (기본) 열린 비밀은 되감아도 지금 값.
//  ③ 사건은 다시 일어난다 — once·쿨다운 기록도 되감긴다. 되감기 전 세계의 갈림길은 걷힌다.
//  ④ 순서 무관 — 같은 효과 목록의 `loop + 1`은 되감기 앞에 있든 뒤에 있든 산다 (줄만 세우고 단계 끝에 처리).
//  ⑤ 옵트인 — 효과를 안 쓰면 아무것도 안 바뀐다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const cpMod = SC.require('checkpoint');
const choiceMod = SC.require('choice');
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const cp = (o) => JSON.parse(JSON.stringify(o));

const BASE = {
  simcore: '0.1', meta: { name: '체크포인트 테스트' },
  time: { start: '2026-04-01 08:00', advance: 'explicit', expose: ['date', 'clock', 'elapsed'] },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 10, min: 0, max: 10 },
    { id: 'rep', label: '평판', type: 'int', init: 0, min: -100, max: 100, desc: '사교계 평판' },
    { id: 'dead', label: '사망', type: 'bool', init: false, desc: '주인공이 서사에서 죽었으면 true' },
    { id: 'loop', label: '회귀', type: 'int', init: 0, min: 0, max: 999 },
    { id: 'memories', label: '기억', type: 'list', init: [] },
    { id: 'cleared', label: '결판', type: 'int', init: 0, min: 0, max: 5, desc: '챕터 결판 수' },
    { id: 'skip_day', label: '일 진행', type: 'int', init: 0, min: 0 },
    { id: 'skip_min', label: '분 진행', type: 'int', init: 0, min: 0, max: 1440 },
  ],
  updater: { allow: [{ id: 'rep', maxDelta: 200 }, { id: 'dead' }, { id: 'cleared', maxDelta: 5 },
    { id: 'hp', maxDelta: 10 }, { id: 'skip_day', maxDelta: 3650 }, { id: 'skip_min', maxDelta: 1440 }] },
  scenario: { label: '회귀', acts: [
    { id: 'pro', label: '서장', intensity: '잠복' },
    { id: 'ch1', label: '1장', unlock: 'cleared >= 1', intensity: '전개', onEnter: [{ checkpoint: 'save' }] },
  ] },
  rules: { events: [
    { id: 'ambush', when: 'scn_act == "ch1" and rep >= 10', once: true, effects: [{ set: 'hp', expr: 'hp - 3' }], notify: '매복' },
    { id: 'gameover', when: 'dead', effects: [{ set: 'loop', expr: 'loop + 1' }, { checkpoint: 'load' }], notify: '당신은 죽었다.' },
  ] },
  checkpoint: { keep: ['loop', 'memories'], notify: '[회귀 {loop}회차] 다시 그 아침.' },
  secrets: [{ id: 's1', kind: 'person', about: '안나', label: '안나의 비밀',
    tiers: [{ text: '기침 소리에 시선을 피한다.' }, { when: 'rep >= 50', text: '가루를 알고 있다.' }] }],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
  promptState: { template: '지금: {date} {clock}' },
};

const RNG = () => 0.99;
function send(schema, st, opts = {}) { return engine.sendPhase(schema, st, { rng: RNG, ...opts }); }
function out(schema, st, changes = {}) { return engine.outputPhase(schema, st, changes, {}, { rng: RNG }); }
function turn(schema, st, changes = {}) { const s = send(schema, st); const o = out(schema, s.state, changes); return { s, o, st: o.state }; }
const L = (schema, st, n) => engine.makeLookup(schema, st.vars)(n);

// ── ⑤ 옵트인 ──
{
  const plain = cp(BASE); delete plain.checkpoint;
  plain.scenario.acts[1].onEnter = []; plain.rules.events[1].effects = [{ set: 'loop', expr: 'loop + 1' }];
  const v = validateSchema(plain);
  ck('옵트인: 효과 없으면 검증 깨끗', v.errors.length === 0, JSON.stringify(v.errors));
  let st = engine.initState(plain); st.meta.setupDone = true;
  st = turn(plain, st, { cleared: 1 }).st;
  ck('옵트인: 칸 저장소가 생기지 않는다', st.checkpoints === undefined, JSON.stringify(st.checkpoints));
  ck('옵트인: 줄도 비어 있다', !(st.meta.cpQueue || []).length, '');
}

// ── 검증 ──
{
  const v = validateSchema(cp(BASE));
  ck('기본 스키마 검증 오류 0', v.errors.length === 0, JSON.stringify(v.errors));
  ck('기본 스키마 체크포인트 경고 0', !v.warnings.some((w) => /체크포인트|되감기|checkpoint/.test(w.msg + w.path)), JSON.stringify(v.warnings));
  const bad = (mut, re, name) => {
    const s = cp(BASE); mut(s);
    const r = validateSchema(s);
    ck(name, r.errors.some((e) => re.test(e.msg)), JSON.stringify(r.errors));
  };
  bad((s) => { s.rules.events[1].effects[1] = { checkpoint: 'rewind' }; }, /'save' 또는 'load'/, '검증: 없는 동작 오류');
  bad((s) => { s.rules.events[1].effects[1] = { checkpoint: 'load', slot: '1장 시작' }; }, /slot은 영문 식별자/, '검증: 칸 이름 오류');
  bad((s) => { s.rules.events[1].effects[1] = { checkpoint: 'load', set: 'hp', expr: '1' }; }, /set\/list를 같이/, '검증: set 겸용 오류');
  bad((s) => { s.rules.onTurn = [{ checkpoint: 'load' }]; }, /매 턴 되감겨/, '검증: onTurn 되감기 오류');
  bad((s) => { s.checkpoint.keep = ['loop', 'nope']; }, /keep의 'nope'/, '검증: keep 없는 변수 오류');
  bad((s) => { s.checkpoint.notify = '{nope}'; }, /nope/, '검증: notify 변수 참조 오류');
  {
    const s = cp(BASE); s.scenario.acts[1].onEnter = [];
    const r = validateSchema(s);
    ck('검증: 저장 없는 되감기 경고', r.warnings.some((w) => /저장하는 효과가 없습니다/.test(w.msg)), JSON.stringify(r.warnings));
  }
  {
    const s = cp(BASE); s.scenario.acts[1].onEnter = []; s.rules.events[1].effects = [];
    const r = validateSchema(s);
    ck('검증: 효과 없는 설정 경고', r.warnings.some((w) => /효과가 하나도 없습니다/.test(w.msg)), JSON.stringify(r.warnings));
  }
  {
    const s = cp(BASE); s.rules.onTurn = [{ checkpoint: 'save', slot: 'auto' }];
    const r = validateSchema(s);
    ck('검증: onTurn 자동 저장은 허용', r.errors.length === 0, JSON.stringify(r.errors));
  }
  // 내장 템플릿은 이 기능을 안 쓴다 — 새 검증이 오탐을 내면 안 된다 (금지 #5)
  const hits = [];
  for (const [id, t] of Object.entries(TEMPLATES)) {
    const r = validateSchema(cp(t.schema || t));
    for (const m of [...r.errors, ...r.warnings]) if (/체크포인트|되감기|checkpoint/.test(m.msg + m.path)) hits.push(`${id}: ${m.msg}`);
  }
  ck('내장 템플릿 체크포인트 오탐 0', hits.length === 0, hits.join(' / '));
}

// ── ①②③ 응답 단계 되감기 (게임오버 이벤트) ──
let startDate;
{
  const S = cp(BASE);
  let st = engine.initState(S); st.meta.setupDone = true;
  startDate = L(S, st, 'date');
  // T1: 결판 → 1장 진입 → onEnter 저장
  let t = turn(S, st, { cleared: 1 }); st = t.st;
  ck('1장 진입', L(S, st, 'scn_act') === 'ch1', L(S, st, 'scn_act'));
  const snap = st.checkpoints?.main;
  ck('onEnter가 저장했다', !!snap && snap.vars.scn_idx === 1 && snap.vars.scn_turns === 0, JSON.stringify(snap && snap.vars));
  ck('저장은 원장에 한 줄', t.o.changeLog.some((c) => c.id === '체크포인트' && /저장 \(main\)/.test(c.to)), JSON.stringify(t.o.changeLog));
  ck('저장한 칸엔 칸 저장소가 안 들어간다', !('checkpoints' in (snap?.vars || {})), '');
  // T2: 이틀 흐르고 평판 60 → 매복(once) · 비밀 2단계
  t = turn(S, st, { rep: 60, skip_day: 2 }); st = t.st;
  ck('T2 매복 발동', st.meta.firedOnce.ambush === true && st.vars.hp === 7, `${st.vars.hp}`);
  ck('T2 비밀 2단계 열림', st.vars.sec_s1 === 1, String(st.vars.sec_s1));
  ck('T2 날짜가 흘렀다', L(S, st, 'date') !== startDate, L(S, st, 'date'));
  st.vars.memories = ['3장 과자에 독이 있다']; // 보조가 적은 기억 대신
  const turnBefore = st.meta.turn;
  // T3: 죽음 → 게임오버 이벤트: loop+1, 되감기
  t = turn(S, st, { dead: true }); st = t.st;
  ck('① 날짜가 저장 시점으로', L(S, st, 'date') === startDate, L(S, st, 'date'));
  ck('① 막은 1장 그대로 (저장 시점의 막)', L(S, st, 'scn_act') === 'ch1' && st.vars.scn_turns === 0, `${L(S, st, 'scn_act')} ${st.vars.scn_turns}`);
  ck('① 평판·체력·사망 되감김', st.vars.rep === 0 && st.vars.hp === 10 && st.vars.dead === false, JSON.stringify(st.vars));
  ck('② loop는 남고 +1', st.vars.loop === 1, String(st.vars.loop));
  ck('② 기억 목록은 남는다', JSON.stringify(st.vars.memories) === JSON.stringify(['3장 과자에 독이 있다']), JSON.stringify(st.vars.memories));
  ck('② 열린 비밀은 안 닫힌다', st.vars.sec_s1 === 1, String(st.vars.sec_s1));
  ck('③ once 기록 되감김 (매복이 다시 일어날 수 있다)', !st.meta.firedOnce.ambush, JSON.stringify(st.meta.firedOnce));
  ck('턴 번호는 앞으로만', st.meta.turn === turnBefore + 1, `${st.meta.turn}`);
  ck('되감기 원장 한 줄', t.o.changeLog.some((c) => c.id === '체크포인트' && /되감기 \(main\) — \d+턴 전으로/.test(c.to)), JSON.stringify(t.o.changeLog.filter((c) => c.id === '체크포인트')));
  ck('안내 통지 ({loop} 치환)', st.meta.pendingNotifies.includes('[회귀 1회차] 다시 그 아침.'), JSON.stringify(st.meta.pendingNotifies));
  ck('죽음 통지도 같이 간다', st.meta.pendingNotifies.includes('당신은 죽었다.'), '');
  ck('게임오버가 재발동하지 않는다 (dead가 되감겼다)', !t.o.firedEvents.filter((e) => e === 'gameover').slice(1).length, '');
  // T4: 다음 전송 — 되감긴 날짜와 안내가 프롬프트에
  const s4 = send(S, st);
  ck('다음 프롬프트: 되감긴 날짜', s4.promptBlock.includes(`지금: ${startDate}`), s4.promptBlock.slice(0, 200));
  ck('다음 프롬프트: 회귀 안내', s4.promptBlock.includes('[회귀 1회차] 다시 그 아침.'), '');
  // T4 계속: 다시 평판 60 → 매복이 한 번 더 (once가 되감겼다)
  const o4 = out(S, s4.state, { rep: 60 });
  ck('③ 매복 재발동', o4.firedEvents.includes('ambush') && o4.state.vars.hp === 7, JSON.stringify(o4.firedEvents));
  // 두 번째 죽음 → 2회차
  const t5 = turn(S, o4.state, { dead: true });
  ck('두 번째 회귀 2회차', t5.st.vars.loop === 2 && t5.st.meta.pendingNotifies.includes('[회귀 2회차] 다시 그 아침.'), String(t5.st.vars.loop));
  // 리롤 안정 — 같은 전송 상태에서 응답 단계를 두 번 돌리면 같은 결과
  const again = out(S, s4.state, { rep: 60 });
  ck('리롤 안정', JSON.stringify(again.state) === JSON.stringify(o4.state), '');
}

// keepSecrets:false — 비밀도 되감긴다
{
  const S = cp(BASE); S.checkpoint.keepSecrets = false;
  let st = engine.initState(S); st.meta.setupDone = true;
  st = turn(S, st, { cleared: 1 }).st;
  st = turn(S, st, { rep: 60 }).st;
  ck('keepSecrets:false 전 — 2단계', st.vars.sec_s1 === 1, String(st.vars.sec_s1));
  st = turn(S, st, { dead: true }).st;
  ck('keepSecrets:false — 저장 시점 단계로', st.vars.sec_s1 === 0, String(st.vars.sec_s1));
}

// ④ 순서 무관
{
  const S = cp(BASE); S.rules.events[1].effects = [{ checkpoint: 'load' }, { set: 'loop', expr: 'loop + 1' }];
  let st = engine.initState(S); st.meta.setupDone = true;
  st = turn(S, st, { cleared: 1 }).st;
  st = turn(S, st, { dead: true }).st;
  ck('④ 되감기 뒤에 둔 loop + 1도 산다', st.vars.loop === 1 && st.vars.dead === false, JSON.stringify(st.vars));
}

// 저장 안 된 칸
{
  const S = cp(BASE); S.rules.events[1].effects = [{ set: 'loop', expr: 'loop + 1' }, { checkpoint: 'load', slot: 'other' }];
  let st = engine.initState(S); st.meta.setupDone = true;
  st = turn(S, st, { cleared: 1 }).st;
  const t = turn(S, st, { dead: true, rep: 30 });
  ck('없는 칸: 되감지 않는다', t.st.vars.rep === 30 && t.st.vars.dead === true, JSON.stringify(t.st.vars));
  ck('없는 칸: 실패 원장', t.o.changeLog.some((c) => /되감기 실패/.test(String(c.to))), '');
  ck('없는 칸: 안내 없음', !t.st.meta.pendingNotifies.some((n) => /회귀/.test(n)), '');
}

// 전송 단계 되감기 — 강제 갈림길의 최악 = 게임오버. 고른 그 턴 프롬프트가 되감긴 상태로 나간다
{
  const S = cp(BASE);
  S.rules.events.push({ id: 'trial', when: 'rep <= -50', once: true, strict: 'last', notify: '심판대',
    choices: [{ label: '도망친다', effects: [{ set: 'rep', expr: '0' }] },
      { label: '받아들인다', effects: [{ set: 'loop', expr: 'loop + 1' }, { checkpoint: 'load' }] }] });
  const v = validateSchema(S);
  ck('갈림길 게임오버 스키마 검증', v.errors.length === 0, JSON.stringify(v.errors));
  let st = engine.initState(S); st.meta.setupDone = true;
  st = turn(S, st, { cleared: 1 }).st;
  let t = turn(S, st, { rep: -60, skip_day: 3 }); st = t.st;
  ck('갈림길 걸림', st.meta.pendingChoice?.id === 'trial', JSON.stringify(st.meta.pendingChoice));
  const s = send(S, st, { userText: '아무 말' });
  ck('강제 결정 = 받아들인다', s.forcedChoice?.label === '받아들인다', JSON.stringify(s.forcedChoice));
  ck('같은 턴에 되감김: 날짜', L(S, s.state, 'date') === startDate, L(S, s.state, 'date'));
  ck('같은 턴에 되감김: 평판', s.state.vars.rep === 0 && s.state.vars.loop === 1, JSON.stringify(s.state.vars));
  ck('같은 턴 프롬프트에 회귀 안내', s.promptBlock.includes('[회귀 1회차] 다시 그 아침.'), s.promptBlock);
  ck('같은 턴 프롬프트의 날짜도 되감긴 날', s.promptBlock.includes(`지금: ${startDate}`), '');
  ck('갈림길 걷힘', s.state.meta.pendingChoice === null, '');
  ck('once 되감김 (심판대 기록도 저장 전)', !s.state.meta.firedOnce.trial, JSON.stringify(s.state.meta.firedOnce));
}

// 액션으로 저장 → 나중에 되감기 (칸 둘)
{
  const S = cp(BASE);
  S.actions = [{ id: 'bookmark', label: '📌 여기 기억', effects: [{ checkpoint: 'save', slot: 'pin' }] }];
  S.rules.events[1].effects = [{ set: 'loop', expr: 'loop + 1' }, { checkpoint: 'load', slot: 'pin' }];
  let st = engine.initState(S); st.meta.setupDone = true;
  st = turn(S, st, { rep: 5 }).st;
  st = engine.toggleAction(S, st, 'bookmark').state;
  const s = send(S, st);
  ck('액션 저장 (전송 단계)', s.state.checkpoints?.pin?.vars.rep === 5, JSON.stringify(s.state.checkpoints));
  st = out(S, s.state, { rep: 40 }).state;
  st = turn(S, st, { dead: true }).st;
  ck('액션 칸으로 되감기', st.vars.rep === 5 && st.vars.loop === 1, JSON.stringify(st.vars));
}

// 보조 갈림길 태그 효과에도 실린다
{
  const S = cp(BASE);
  S.liveChoices = { label: '운명', chance: 0, count: [2, 3], strict: 'last', worst: '파멸',
    tags: [{ id: '생존', desc: '산다' }, { id: '파멸', desc: '죽는다', effects: [{ set: 'loop', expr: 'loop + 1' }, { checkpoint: 'load' }] }] };
  const ev = choiceMod.synthEvent(S, { id: '@live', turn: 0, live: { desc: 'x', items: [{ label: '산다', tag: '생존' }, { label: '죽는다', tag: '파멸' }] } });
  ck('liveChoices 태그의 체크포인트 효과가 살아남는다', ev.choices[1].effects.some((e) => e.checkpoint === 'load'), JSON.stringify(ev.choices[1].effects));
  const v = validateSchema(S);
  ck('liveChoices 게임오버 스키마 검증', v.errors.length === 0, JSON.stringify(v.errors));
}

// 옛 칸이 새 스키마를 만났을 때 — 저장 뒤에 생긴 변수는 init으로
{
  const S = cp(BASE);
  let st = engine.initState(S); st.meta.setupDone = true;
  st = turn(S, st, { cleared: 1 }).st;
  const S2 = cp(S); S2.vars.push({ id: 'newbie', type: 'int', init: 7, min: 0, max: 10 });
  st = turn(S2, st, { dead: true }).st;
  ck('새 변수 init 채움', st.vars.newbie === 7, String(st.vars.newbie));
}

// 번들·편집기 (정적)
{
  ck('build.js CORE에 checkpoint (engine 앞)', src.includes('SimCore.define("checkpoint"')
    && src.indexOf('SimCore.define("checkpoint"') < src.indexOf('SimCore.define("engine"'), '');
  ck('편집기: 체크포인트 효과 줄', src.includes('sce-effect-checkpoint'), '');
  ck('편집기: 시나리오 탭 되감기 카드', src.includes('sce-scenario-checkpoint'), '');
  ck('다이제스트/카탈로그 표기', src.includes('체크포인트 저장') && src.includes('체크포인트 되감기'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
