const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.6.0 전투 안무 (checks[].fight) — 설계·규약은 core/fight.js 머리말.
// 계기(유저): 액션씬이 "이얍 공격 → 끄앙 → 이겼다". 결착은 게이지가 정하고, 라운드 입구는 ⚔ 하나.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const fight = SC.require('fight');
const { validateSchema } = SC.require('validate');
const { renderStatusHtml } = SC.require('render');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;
const clone = (o) => JSON.parse(JSON.stringify(o));

const S = {
  simcore: '0.1', meta: { name: 'fight-test' },
  vars: [
    { id: 'hp', label: 'HP', type: 'int', init: 100, min: 0, max: 100 },
    { id: 'foe', label: '상대', type: 'enum', init: '없음', enum: ['없음', 'C', 'S'] },
    { id: 'fame', label: '명성', type: 'int', init: 0, min: 0, max: 100 },
  ],
  derived: [{ id: 'foe_n', label: '상대 수치', expr: 'foe == "S" ? 6 : (foe == "C" ? 3 : 1)' }],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }, { var: 'foe' }] }] },
  actions: [
    { id: 'atk', label: '⚔ 교전', mode: 'oneshot', check: 'clash' },
    { id: 'run', label: '🏃 이탈', mode: 'oneshot', when: 'fight_on', check: 'dodge', fightEnd: true },
  ],
  directives: [{ id: 'd_fight', when: 'fight_on', text: '교전 지시문 {fight_foe} {fight_gauge}/{fight_max}' }],
  rules: { events: [{ id: 'ev_clash', when: 'foe == "S"', check: 'clash', notify: '이벤트 굴림' }] },
  checks: [
    { id: 'clash', label: '전투 판정', roll: 'rand(1, 20)', mod: '2', vs: '10 + foe_n * 2',
      fight: { gauge: '20 + foe_n * 20', reply: 'dodge', foe: '{foe}급 상대',
        win: { effects: [{ set: 'fame', expr: 'fame + 5' }, { set: 'foe', expr: '"없음"' }], inject: '승리 연출.' },
        lose: { when: 'hp <= 0', inject: '패배 연출.' }, idleTurns: 3 },
      grades: [
        { when: 'total >= vs + 7', label: '압도', gain: 50, inject: '압도 연출' },
        { when: 'total >= vs', label: '우세', gain: 25 },
        { label: '고전', gain: 10 },
      ] },
    { id: 'dodge', label: '회피 판정', roll: 'rand(1, 20)', vs: '12',
      grades: [
        { when: 'total >= vs', label: '회피' },
        { label: '피격', effects: [{ set: 'hp', expr: 'max(hp - 30, 0)' }], inject: '맞았다.' },
      ] },
  ],
  updater: { allow: [{ id: 'hp', maxDelta: 30 }, { id: 'foe' }] },
};

const K = fight.FIGHT_KEYS;
const rng = (i, l) => seededRng('f', i, l);
const fresh = () => { const st = engine.initState(S); st.meta.setupDone = true; return st; };
// 버튼 누르고 전송 — 무장 → sendPhase(userText) → outputPhase(보조 변화 없음)
const press = (st, actionId, i, userText = '') => {
  const armed = actionId ? engine.toggleAction(S, st, actionId).state : st;
  const send = engine.sendPhase(S, armed, { rng: rng(i, 's'), userText });
  const out = engine.outputPhase(S, send.state, {}, {}, { rng: rng(i, 'o') });
  return { st: out.state, pb: send.promptBlock, send };
};

// ── 1. 검증 ──
{
  const v = validateSchema(S);
  ck('표본 스키마 통과', v.ok, J(v.errors));
  ck('경고 없음 (fight_on when·{fight_*} 자리표시자 통과)', v.warnings.length === 0, J(v.warnings));
  const bad1 = clone(S); bad1.vars.push({ id: 'fight_max', label: 'x', type: 'int', init: 0 });
  ck('예약 이름 fight_max를 변수로 → 오류', !validateSchema(bad1).ok && validateSchema(bad1).errors.some((e) => e.msg.includes('예약 이름')), '');
  const bad2 = clone(S); bad2.checks[0].grades.forEach((g) => { delete g.gain; });
  ck('gain>0 등급 없음 → 오류', validateSchema(bad2).errors.some((e) => e.msg.includes('gain > 0')), '');
  const bad3 = clone(S); bad3.checks[0].fight.reply = 'clash';
  ck('반격이 자기 자신 → 오류', validateSchema(bad3).errors.some((e) => e.path.endsWith('.fight.reply')), '');
  const bad4 = clone(S); delete bad4.checks[0].fight.gauge;
  ck('gauge 없음 → 오류', validateSchema(bad4).errors.some((e) => e.path.endsWith('.fight.gauge')), '');
  const bad5 = clone(S); bad5.checks[0].grades[0].gain = -1;
  ck('gain 음수 → 오류', validateSchema(bad5).errors.some((e) => e.path.includes('.gain')), '');
  const warn1 = clone(S); delete warn1.checks[0].fight.reply;
  ck('reply 없음 → 경고 (주인공만 때리는 전투)', validateSchema(warn1).ok && validateSchema(warn1).warnings.some((w) => w.msg.includes('반격')), '');
  const warn2 = { ...clone(S), checks: [S.checks[1]], actions: [{ id: 'run', label: '🏃', mode: 'oneshot', fightEnd: true }], directives: [], rules: {} };
  ck('fightEnd인데 fight 판정 없음 → 경고', validateSchema(warn2).warnings.some((w) => w.path.endsWith('.fightEnd')), J(validateSchema(warn2).warnings));
}

// ── 2. 라운드 하나 — 맡김 / 내 수 ──
{
  let st = fresh(); st.vars.foe = 'C';
  // 예약 키는 첫 페이즈(reconcileState)에서 채워진다 — 그 전엔 없어도 fight_on은 거짓 (구세이브와 같은 경로)
  ck('개전 전: fight_on 거짓, 예약 키 0/없음', !engine.makeLookup(S, st.vars)('fight_on') && (st.vars[K.max] ?? 0) === 0, J(st.vars));
  const r1 = press(st, 'atk', 1, '벤다');   // 짧은 글(맡김 — 개시 비트) + 낱말 '벤다'(공격)
  ck('★ ⚔ + 짧은 입력 → 안무 시트 머리 (C급 게이지 80)', r1.pb.includes('[전투 안무 — 1라운드 · 상대: C급 상대 · 누적 0→') && r1.st.vars[K.max] === 80, r1.pb);
  ck('맡김 모드: ① 개시 비트가 시스템 것', r1.pb.includes('① 개시 —'), '');
  ck('② 주인공의 공격 = 판정 등급 + 요약 + 게이지 가산', /② 주인공 — 공격: (압도|우세|고전) \(\d+ \+ 2 = \d+ vs 16\) · 상대 누적 \+\d+/.test(r1.pb), r1.pb);
  ck('③ 상대의 수 = 시스템이 뽑은 수 (공격·밀어붙이기·수세·탐색)', /③ 상대 — (공격|밀어붙이기|수세|탐색)/.test(r1.pb), r1.pb);
  ck('④ 라운드 끝 — 여기서 멈춰라 (결착 아님)', r1.pb.includes('④ 라운드 끝 — 상대는 아직 쓰러지지 않는다'), '');
  ck('시트 규칙 줄 (번호·기호 본문 금지)', r1.pb.includes('번호·기호·표는 본문에 쓰지 마라'), '');
  ck('[판정] 줄·판정 규칙 줄은 시트에 흡수 (이중 지시 없음)', !r1.pb.includes('[판정]') && !r1.pb.includes('※ 위 [판정]'), '');
  ck('게이지·라운드 예약 키', r1.st.vars[K.round] === 1 && [10, 25, 50].includes(r1.st.vars[K.gauge]) && r1.st.vars[K.foe] === 'C급 상대' && r1.st.vars[K.check] === 'clash', J(r1.st.vars));
  ck('lastCheck = 공격 굴림 + 교전 요약 (반격 라벨 병기)', r1.st.meta.lastCheck.id === 'clash' && r1.st.meta.lastCheck.fight.round === 1 && r1.st.meta.lastCheck.fight.move === 'attack' && typeof r1.st.meta.lastCheck.fight.foeMove === 'string', J(r1.st.meta.lastCheck));
  ck('변화 로그에 개전 줄 (source fight:)', r1.send.changeLog.some((c) => c.source === 'fight:clash' && String(c.to).startsWith('개전')), J(r1.send.changeLog));
  ck('지시문 when fight_on + {fight_*} 렌더', r1.pb.includes('교전 지시문 C급 상대') && /교전 지시문 C급 상대 \d+\/80/.test(r1.pb), '');
  // 내 수 모드 — 같은 시드, 긴 입력
  const r1b = press(st, 'atk', 1, '상대의 왼쪽 어깨가 열린 순간을 놓치지 않고 파고들어 목을 벤다 — 망설임은 없다');
  ck('★ ⚔ + 긴 입력 → 개시 비트 없이 "유저가 쓴 수를 그대로"', !r1b.pb.includes('① 개시 —') && r1b.pb.includes('① 주인공 — 공격') && r1b.pb.includes('유저가 쓴 수를 그대로 쓰되'), r1b.pb);
  ck('입력 길이는 눈금을 안 흔든다 (같은 시드 → 같은 게이지·HP)', r1b.st.vars[K.gauge] === r1.st.vars[K.gauge] && r1b.st.vars.hp === r1.st.vars.hp, '');
  ck('리롤 안정 — 같은 시드 두 번 = 같은 시트', press(st, 'atk', 1, '벤다').pb === r1.pb, '');
  // 상태창
  const html = renderStatusHtml(S, r1.st, r1.send.changeLog);
  ck('상태창 머리에 교전 칩 (⚔ 상대 · 게이지 바 · 라운드)', html.includes('sim-fight') && html.includes('⚔ <b>C급 상대</b>') && /\/80 · 1R/.test(html), '');
  ck('변화 로그에 ⚔ 개전 줄', html.includes('⚔ 개전 — C급 상대'), '');
}

// ── 3. ⚔ 없는 턴 — 상시 줄, 게이지 불변, 방치 정리 ──
{
  let st = fresh(); st.vars.foe = 'C';
  let r = press(st, 'atk', 10, '싸운다');
  const g = r.st.vars[K.gauge];
  r = press(r.st, null, 11, '검을 겨눈 채 상대를 노려본다');
  ck('★ ⚔ 없는 턴 → [교전 중] 상시 줄 (상대·누적·라운드)', r.pb.includes(`[교전 중 — 상대: C급 상대 · 누적 ${g}/80 · 1라운드 지남]`), r.pb);
  ck('상시 줄은 맨 끝자락 (systemGuide 바로 앞)', r.pb.indexOf('[교전 중') > r.pb.indexOf('교전 지시문'), '');
  ck('게이지·라운드 불변, idle 1', r.st.vars[K.gauge] === g && r.st.vars[K.round] === 1 && r.st.vars[K.idle] === 1, J(r.st.vars));
  ck('시트 없음 ([전투 안무] 안 뜸)', !r.pb.includes('[전투 안무'), '');
  r = press(r.st, null, 12, '대화를 시도한다');
  ck('idle 2 — 아직 유지', r.st.vars[K.idle] === 2 && fight.fightActive(r.st.vars), '');
  r = press(r.st, null, 13, '…');
  ck('★ idleTurns(3) 도달 → [교전 종료] 방치 정리, fight_on 거짓', r.pb.includes('[교전 종료] 공방 없이') && !fight.fightActive(r.st.vars) && !r.pb.includes('[교전 중'), r.pb);
  ck('정리 뒤엔 상시 줄도 지시문도 없다', !press(r.st, null, 14, 'x').pb.includes('교전'), '');
  // ⚔를 다시 누르면 idle이 0으로 (라운드가 곧 활동)
  let s2 = fresh(); s2.vars.foe = 'C';
  let q = press(s2, 'atk', 20, '싸운다'); q = press(q.st, null, 21, '…'); q = press(q.st, 'atk', 22, '싸운다');
  ck('라운드가 굴려지면 idle 리셋', q.st.vars[K.idle] === 0 && q.st.vars[K.round] === 2, J(q.st.vars));
}

// ── 4. 결착 — 게이지가 정한다 ──
{
  // 승리 — 게이지 직전에서 한 라운드 (어느 등급이든 gain ≥ 10)
  let st = fresh(); st.vars.foe = 'C';
  let r = press(st, 'atk', 30, '싸운다');
  r.st.vars[K.gauge] = 75;
  const w = press(r.st, 'atk', 31, '마무리로 벤다');
  ck('★ 게이지 만땅 → 결착 비트 (win inject 병기), 반격 비트 생략', w.pb.includes('결착 — 상대는 더 싸울 수 없다') && w.pb.includes('승리 연출.') && !/상대 — (공격|밀어붙이기|수세|탐색)/.test(w.pb), w.pb);
  ck('머리줄 → 결착', w.pb.includes('/80 → 결착]'), '');
  ck('win effects 적용 (명성 +5, foe 리셋) + 교전 닫힘', w.st.vars.fame === 5 && w.st.vars.foe === '없음' && !fight.fightActive(w.st.vars), J(w.st.vars));
  ck('변화 로그 결착 줄', w.send.changeLog.some((c) => c.source === 'fight:clash' && String(c.to).startsWith('결착')), '');
  ck('결착 다음 턴 — 상시 줄 없음', !press(w.st, null, 32, 'x').pb.includes('[교전 중'), '');
  // 패배 — hp가 0에 닿는 반격
  let l = fresh(); l.vars.foe = 'S'; l.vars.hp = 1;
  let lost = null;
  for (let i = 40; i < 60 && !lost; i++) { const q = press(l, 'atk', i, '버틴다'); l = q.st; if (q.pb.includes('주인공 붕괴')) lost = q.pb; }
  ck('★ lose.when(hp <= 0) → 주인공 붕괴 결착 (lose inject 병기)', !!lost && lost.includes('결착 — 주인공 쪽이 무너진다') && lost.includes('패배 연출.'), lost ?? '(20라운드 안에 안 남)');
  ck('붕괴 뒤 교전 닫힘, 명성 그대로', !fight.fightActive(l.vars) && l.vars.fame === 0, '');
  // 한 응답 결착 없음 — C급(80)은 압도(50) 한 방으로 못 끝난다
  let c1 = fresh(); c1.vars.foe = 'C';
  ck('★ 1라운드에 결착 불가 (게이지 80 > 최대 gain 50)', !press(c1, 'atk', 70, '싸운다').pb.includes('결착'), '');
}

// ── 5. 이탈 (fightEnd) ──
{
  let st = fresh(); st.vars.foe = 'C';
  let r = press(st, 'atk', 80, '싸운다');
  ck('이탈 버튼은 교전 중에만 무장된다 (when fight_on)', engine.toggleAction(S, r.st, 'run').state.meta.armed.run === true
    && !engine.toggleAction(S, fresh(), 'run').state.meta.armed.run, '');
  const q = press(r.st, 'run', 81, '도망친다');
  ck('★ 🏃 → [판정] 회피 줄 + [교전 종료] 이탈, 교전 닫힘', q.pb.includes('[판정] 회피 판정') && q.pb.includes('[교전 종료] 유저가 교전에서 이탈') && !fight.fightActive(q.st.vars), q.pb);
  ck('이탈 판정엔 판정 규칙 줄이 붙는다 (평판정)', q.pb.includes('※ 위 [판정]'), '');
}

// ── 5b. 종료 (fightEnd 문자열, v1.9.5) — 판정 없이 교전만 닫고 안내 줄을 봇이 정한다 ──
{
  const S2 = clone(S);
  S2.actions.push({ id: 'settle', label: '🏳 교전 종료', mode: 'oneshot', when: 'fight_on', fightEnd: '[교전 종료] 유저가 교전을 닫았다 — 새 공방을 쓰지 마라.' });
  ck('fightEnd 문자열은 검증 통과', validateSchema(S2).ok, J(validateSchema(S2).errors));
  const bad = clone(S2); bad.actions[bad.actions.length - 1].fightEnd = 7;
  ck('fightEnd 숫자는 오류', !validateSchema(bad).ok, '');
  let st = fresh(); st.vars.foe = 'C';
  let r = engine.outputPhase(S2, engine.sendPhase(S2, engine.toggleAction(S2, st, 'atk').state, { rng: rng(85, 's'), userText: '싸운다' }).state, {}, {}, { rng: rng(85, 'o') }).state;
  ck('교전 중', fight.fightActive(r.vars), '');
  const hpBefore = r.vars.hp;
  const send = engine.sendPhase(S2, engine.toggleAction(S2, r, 'settle').state, { rng: rng(86, 's'), userText: '싸움은 끝났다' });
  ck('★ 🏳 → 교전 닫힘 + 봇이 정한 [교전 종료] 줄, 기본 이탈 안내는 없음', !fight.fightActive(send.state.vars) && send.promptBlock.includes('[교전 종료] 유저가 교전을 닫았다') && !send.promptBlock.includes('유저가 교전에서 이탈'), send.promptBlock);
  ck('판정이 없으니 [판정] 줄도 피해도 없다', !send.promptBlock.includes('[판정]') && send.state.vars.hp === hpBefore, '');
  ck('변화 로그에 종료', send.changeLog.some((c) => c.id === '교전' && c.to === '종료'), J(send.changeLog));
  ck('교전 중이 아니면 안 열린다', !engine.toggleAction(S2, fresh(), 'settle').state.meta.armed.settle, '');
}

// ── 6. 이벤트 굴림은 평판정 — 교전을 열지 않는다 ──
{
  let st = fresh(); st.vars.foe = 'S';
  const send = engine.sendPhase(S, st, { rng: rng(90, 's') });
  const out = engine.outputPhase(S, send.state, {}, {}, { rng: rng(90, 'o') });
  ck('events[].check가 fight 판정을 굴려도 fight_on 거짓, [판정] 통지', !fight.fightActive(out.state.vars) && out.state.meta.pendingNotifies.some((n) => String(n).startsWith('[판정] 전투 판정')), J(out.state.meta.pendingNotifies));
}

// ── 7. 구세이브 호환 — 예약 키 없는 상태도 굴러간다 ──
{
  let st = fresh(); st.vars.foe = 'C';
  for (const k of Object.values(K)) delete st.vars[k];
  const r = press(st, 'atk', 95, '싸운다');
  ck('예약 키 없던 세이브 → reconcile이 채우고 개전', r.st.vars[K.max] === 80 && r.st.vars[K.round] === 1, J(r.st.vars));
}

// ── 편집기 칸 (v1.14.15, 정적) — 전엔 JSON 관리자로만 ──
{
  ck('편집기: 판정 카드에 전투 안무 절', src.includes('sce-check-fight') && src.includes("addBtn('⚔ 전투 안무 켜기'"), '');
  ck('편집기: 켜면 gain 없는 등급에 10을 준다 (결착 보장)', src.includes('if (g0) g0.gain = 10;'), '');
  ck('편집기: 등급 유효량(gain) 칸은 전투 안무 판정만', src.includes("checkField('유효량 (gain)'"), '');
  ck('편집기: 반격 판정 셀렉트는 전투 안무 없는 판정만', src.includes('o !== c && !fightOn(o)'), '');
  ck('편집기: 승리 효과·패배 조건·이탈 버튼·끄기', src.includes("'🏆 승리 — 상태 효과") && src.includes("checkField('패배 조건'") && src.includes("'🚪 이탈 버튼 만들기 (교전만 닫음)'") && src.includes('delete c.fight; rerender();'), '');
  ck('편집기: ⚔ 액션 버튼 라벨', src.includes("'⚔ 액션 버튼 만들기'"), '');
}

// ── 7. 수 유형 (v1.15.0) — 주인공 수는 글에서, 상대 수는 시스템이 판세로. 턴제처럼 무조건 주고받지 않는다 ──
{
  const C = S.checks[0].fight;
  ck('낱말 분류: 마지막 낱말이 이긴다 (막고 반격 → 공격)', fight.classifyMove(C, '일격을 막고 반격한다') === 'attack', String(fight.classifyMove(C, '일격을 막고 반격한다')));
  ck('낱말 분류: 수비·견제·기술', fight.classifyMove(C, '몸을 낮춰 피했다') === 'guard' && fight.classifyMove(C, '거리를 재며 틈을 본다') === 'probe' && fight.classifyMove(C, '검기를 날린다') === 'skill', '');
  ck('낱말 없음 → null', fight.classifyMove(C, '그를 바라본다') === null, '');
  ck('스키마 낱말표가 그 유형의 기본을 대신한다', fight.classifyMove({ moves: { guard: ['꾹'] } }, '꾹 참고 막는다') === 'guard', '');
  ck('이점 = 굴림 폭의 15% (d20 → 3, d6 → 1, rand 없음 → 1)', fight.advantageOf({ roll: 'rand(1, 20)' }) === 3 && fight.advantageOf({ roll: 'rand(1, 6)' }) === 1 && fight.advantageOf({ roll: '7' }) === 1, '');
  ck('withMod — mod 식에 보정을 얹는다', fight.withMod({ mod: 'str' }, 3).mod === '(str) + (3)' && fight.withMod({}, -2).mod === '-2' && fight.withMod({ mod: 'x' }, 0).mod === 'x', '');
  // 수비 라운드 — 공격 굴림 없음, 게이지 불변, 상대가 들어오면 반응 판정에 이점
  let st = fresh(); st.vars.foe = 'C';
  const g = press(st, 'atk', 100, '정면의 일격을 방패로 막아낸다 — 반격 없이 그대로 버틴다');
  ck('★ 수비 — 공격 비트 없음, 게이지 불변', g.pb.includes('주인공 — 수비') && g.st.vars[K.gauge] === 0 && g.pb.includes('이점 +3'), g.pb);
  ck('수비 라운드의 상대: 들어오면 이점 표기, 아니면 공방 없음', /상대 — (공격|밀어붙이기): .*(수비 이점 \+3|\(판정)/.test(g.pb) || /상대 — (수세|탐색)/.test(g.pb) || /상대 — 밀어붙이기: .*\)/.test(g.pb), g.pb);
  ck('수비 라운드의 lastCheck는 반응 굴림 또는 굴림 없음', g.st.meta.lastCheck.fight.move === 'guard' && (g.st.meta.lastCheck.id === 'dodge' || g.st.meta.lastCheck.summary === '굴림 없음'), J(g.st.meta.lastCheck));
  // 견제 → 반값 누적 + 다음 공격 이점
  let pr = fresh(); pr.vars.foe = 'C';
  let found = null;
  for (let i = 110; i < 140 && !found; i++) { const q = press(pr, 'atk', i, '거리를 재며 틈을 노린다'); if (q.st.vars[K.edge] === 1) found = q; }
  ck('★ 견제 성공 → fight_edge 1 · 상대 누적 반값(5·13·25) · 이점 예고', !!found && /주인공 — 견제: .* · 상대 누적 \+(5|13|25) \(견제 ×0\.5\) · 다음 공격에 이점/.test(found.pb), found ? found.pb : '30시드 안에 성공 없음');
  if (found) { const nx = press(found.st, 'atk', 141, '이점을 살려 베어 들어간다'); ck('다음 공격에 이점 +3 표기, 이점 소진', nx.pb.includes(', 견제 이점 +3)') && nx.st.vars[K.edge] === 0, nx.pb); }
  // 기술 ×1.5 (빗나가면 빈틈)
  let k = fresh(); k.vars.foe = 'C';
  const kq = press(k, 'atk', 150, '비기를 펼친다');
  ck('★ 기술 — 누적 ×1.5 (15·38·75) / 빗나가면 빈틈', /주인공 — 기술: .*(상대 누적 \+(15|38|75) \(기술 ×1\.5\)|빈틈이 생겼다)/.test(kq.pb) && kq.st.meta.lastCheck.fight.move === 'skill', kq.pb);
  // 상대 수세 → 다음 공격 반감
  let gq = fresh(); gq.vars.foe = 'C';
  let guarded = null;
  for (let i = 160; i < 220 && !guarded; i++) { const q = press(gq, 'atk', i, '벤다'); if (q.st.vars[K.guard] === 1) guarded = q; }
  ck('상대 수세 비트 → fight_guard 1', !!guarded && guarded.pb.includes('상대 — 수세'), guarded ? '' : '60시드 안에 수세 없음');
  if (guarded) { const nx = press(guarded.st, 'atk', 221, '벤다'); ck('다음 공격 반감 표기 (상대가 또 수세면 guard는 다시 선다)', nx.pb.includes('(상대가 자세를 잡고 있어 반감)'), nx.pb); }
  // 상대 가중치 — 전부 탐색이면 반응 판정이 안 구른다 (턴제 강제 주고받기 없음)
  const S2 = clone(S); S2.checks[0].fight.foeMoves = { attack: 0, press: 0, guard: 0, probe: 1 };
  ck('foeMoves 검증 통과', validateSchema(S2).ok, J(validateSchema(S2).errors));
  let t = engine.initState(S2); t.meta.setupDone = true; t.vars.foe = 'C';
  const tq = engine.sendPhase(S2, engine.toggleAction(S2, t, 'atk').state, { rng: rng(230, 's'), userText: '벤다' }).promptBlock;
  ck('★ 상대가 탐색만 하면 반응 판정이 안 구른다', tq.includes('상대 — 탐색') && !tq.includes('회피 판정'), tq);
  // 검증·규칙 줄·편집기
  const bad = clone(S); bad.checks[0].fight.moves = { punch: ['x'] }; bad.checks[0].fight.foeMoves = { attack: -1 };
  ck('moves/foeMoves 검증 — 모르는 유형·음수 오류', validateSchema(bad).errors.some((x) => x.path.endsWith('.fight.moves.punch')) && validateSchema(bad).errors.some((x) => x.path.endsWith('.fight.foeMoves.attack')), J(validateSchema(bad).errors));
  ck('시트 규칙 줄 — 번갈아 주고받기를 강제하지 않는다', g.pb.includes('꼭 번갈아 주고받을 필요는 없다') && !g.pb.includes('순서대로, 비트마다'), '');
  ck('구세이브 — 새 예약 키 없어도 0으로 채워진다', (() => { const o = fresh(); delete o.vars[K.edge]; delete o.vars[K.guard]; fight.ensureFightKeys(o); return o.vars[K.edge] === 0 && o.vars[K.guard] === 0; })(), '');
  ck('편집기: 수 낱말·상대 가중치 칸', src.includes('`주인공 수 낱말 — ${fightMod.MOVE_LABEL[k]}`') && src.includes('`상대 수 가중치 — ${fightMod.FOE_LABEL[k]}`'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
