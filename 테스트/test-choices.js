const __P = (...p) => require('path').resolve(__dirname, ...p);
// choices(갈림길) — v0.41 실물 검증
// 이벤트가 터지면 선택지를 내밀고 기다린다. /선택은 기록만, 집행은 전송 단계. 동시 1개. 타임아웃은 마지막 항목.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { validateSchema } = SimCore.require('validate');
const { renderStatusHtml } = SimCore.require('render');
const { writerMap } = SimCore.require('diagnose');
const { TEMPLATES } = SimCore.require('templates');
const { seededRng } = SimCore.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const clone = (o) => JSON.parse(JSON.stringify(o));

const S = {
  simcore: '0.1',
  meta: { name: 'choices-test' },
  vars: [
    { id: 'gold', label: '금화', type: 'int', init: 200, min: 0, cmd: '금' },
    { id: 'military', label: '병력', type: 'int', init: 50, min: 0 },
    { id: 'mood', label: '기분', type: 'int', init: 50, min: 0, max: 100 },
    { id: 'raided', label: '습격 겪음', type: 'bool', init: false },
  ],
  derived: [],
  rules: {
    onTurn: [],
    events: [
      { id: 'raid', when: 'not raided', timeout: 3,
        notify: '산적이 마을 어귀에 나타났다.',
        effects: [{ set: 'raided', expr: '1' }],
        choices: [
          { label: '토벌대를 보낸다', effects: [{ set: 'military', expr: 'military - 20' }] },
          { label: '금화로 무마한다', when: 'gold >= 100',
            effects: [{ set: 'gold', expr: 'gold - 100' }], inject: '값비싼 평화를 샀다.' },
          { label: '외면한다', effects: [{ set: 'mood', expr: 'mood - 10' }] },
        ] },
      { id: 'raid2', when: 'raided', timeout: 2,
        notify: '두 번째 갈림길.',
        choices: [{ label: 'A' }, { label: 'B' }] },
      { id: 'plain', when: 'mood < 100',
        effects: [{ set: 'mood', expr: 'min(mood + 1, 100)' }] },
    ],
    randomEvents: { chancePerTurn: 0, table: [] },
  },
  actions: [],
  updater: { model: 'aux',
    allow: [{ id: 'gold', maxDelta: 50 }, { id: 'military', maxDelta: 10 }, { id: 'mood', maxDelta: 10 }] },
  promptState: { includeEvents: true },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'gold' }] }] },
};

const fresh = () => { const s = engine.initState(S); s.meta.setupDone = true; s.meta.turn = 1; return s; };
const out = (st, seed, changes = {}) => engine.outputPhase(S, st, changes, {}, { rng: seededRng('h', seed, 'out') });
const send = (st, seed) => engine.sendPhase(S, st, { rng: seededRng('h', seed, 'send') });

// ── 검증기 ──
{
  const v = validateSchema(S);
  ck('정상 갈림길 스키마 통과 (경고 0)', v.ok && v.warnings.length === 0, JSON.stringify(v.warnings));
  const bad = (mut) => { const c = clone(S); mut(c); return validateSchema(c); };
  ck('choices 빈 배열 = 오류', !bad((c) => { c.rules.events[0].choices = []; }).ok);
  ck('label 없는 선택지 = 오류', !bad((c) => { delete c.rules.events[0].choices[0].label; }).ok);
  ck('선택지 when에 rand = 오류', !bad((c) => { c.rules.events[0].choices[1].when = 'rand(1, 2) == 1'; }).ok);
  ck('선택지 효과의 모르는 변수 = 오류', !bad((c) => { c.rules.events[0].choices[0].effects = [{ set: 'nope', expr: '1' }]; }).ok);
  ck('timeout 0 = 오류', !bad((c) => { c.rules.events[0].timeout = 0; }).ok);
  const w1 = bad((c) => { c.rules.events[0].choices = [{ label: '하나' }]; });
  ck('선택지 하나 = 경고', w1.ok && w1.warnings.some((w) => w.msg.includes('갈림길이 아닙')), JSON.stringify(w1.warnings));
  const w2 = bad((c) => { c.rules.events[0].choices[2].when = 'gold >= 0'; });
  ck('마지막 선택지에 when = 경고', w2.warnings.some((w) => w.msg.includes('마지막')), JSON.stringify(w2.warnings));
  const w3 = bad((c) => { delete c.rules.events[0].timeout; });
  ck('timeout 없음 = 경고', w3.warnings.some((w) => w.msg.includes('timeout이 없습니다')));
  const w4 = bad((c) => { c.vars[0].cmd = '선택'; });
  ck("변수 cmd '선택' = 경고", w4.warnings.some((w) => w.msg.includes('/선택')), JSON.stringify(w4.warnings));
  const w5 = bad((c) => { c.statusUI = { mode: 'template', template: '<div>{gold}</div>' }; });
  ck('템플릿 모드에 {choices} 없음 = 경고', w5.warnings.some((w) => w.msg.includes('{choices}')), JSON.stringify(w5.warnings));
  const w6 = bad((c) => { c.rules.events[2].timeout = 3; });
  ck('choices 없는 이벤트의 timeout = 경고', w6.warnings.some((w) => w.msg.includes('무시')), JSON.stringify(w6.warnings));
}

// ── 발동 → pending / 동시 1개 / 일반 이벤트는 정상 ──
{
  const o = out(fresh(), 1);
  ck('갈림길 발동', o.firedEvents.includes('raid'), JSON.stringify(o.firedEvents));
  ck('이벤트 자체 효과는 즉시 (raided)', o.state.vars.raided === true);
  ck('pending 진입', o.state.meta.pendingChoice?.id === 'raid', JSON.stringify(o.state.meta.pendingChoice));
  ck('다른 갈림길은 대기 (raid2 안 터짐)', !o.firedEvents.includes('raid2'), JSON.stringify(o.firedEvents));
  ck('일반 이벤트는 정상 (plain)', o.firedEvents.includes('plain'));
  const o2 = out(o.state, 2);
  ck('pending 중 같은 갈림길 재발동 금지', !o2.firedEvents.includes('raid') && !o2.firedEvents.includes('raid2'),
    JSON.stringify(o2.firedEvents));
}

// ── 대기 중: 프롬프트 줄 + aux 변수 제외 ──
{
  const o = out(fresh(), 1);
  const s = send(o.state, 3);
  ck('[이벤트] 통지 + [선택 대기] 줄', s.promptBlock.includes('[이벤트] 산적이')
    && s.promptBlock.includes('[선택 대기]'), s.promptBlock);
  ck('대기 줄에 선택지 내용은 없음 (모델이 대신 고르지 못하게)', !s.promptBlock.includes('토벌대'), s.promptBlock);
  const allow = engine.auxAllowList(S, null, s.state).map((a) => a.id);
  ck('선택지가 만질 변수만 aux에서 제외', !allow.includes('gold') && !allow.includes('military') && !allow.includes('mood'),
    allow.join(','));
  // mood는 raid의 외면한다가 만진다 — 셋 다 빠지고, 안 만지는 변수는 남아야 한다. 이 스키마엔 남는 게 없으니
  // 하나 추가해 확인한다.
  const S2 = clone(S); S2.vars.push({ id: 'fame', label: '명성', type: 'int', init: 0 });
  S2.updater.allow.push({ id: 'fame', maxDelta: 5 });
  const st2 = engine.reconcileState(S2, clone(s.state));
  const allow2 = engine.auxAllowList(S2, null, st2).map((a) => a.id);
  ck('선택과 무관한 변수는 얼지 않음 (fame 유지)', allow2.includes('fame'), allow2.join(','));
  ck('적용 시점도 같은 기준 (gold 델타 거부)',
    engine.applyChangesToState(S2, st2, { gold: 30, fame: 3 }, {}).state.vars.fame === 3
    && engine.applyChangesToState(S2, st2, { gold: 30 }, {}).state.vars.gold === s.state.vars.gold);
}

// ── /선택 명령: 기록만 / 집행은 전송 단계 ──
{
  const o = out(fresh(), 1);
  const r = engine.applyChatCommands(S, o.state, '/선택 2');
  ck('선택 확인 문구', r.text.includes('(시스템: 선택 — 2. 금화로 무마한다)'), r.text);
  ck('기록만 (pick=1, vars 그대로)', r.pick === 1 && r.vars.gold === 200, `pick ${r.pick} gold ${r.vars.gold}`);
  const st = clone(o.state); st.meta.pendingChoicePick = r.pick;
  const s = send(st, 4);
  ck('전송 단계에서 집행 (금화 -100)', s.state.vars.gold === 100, String(s.state.vars.gold));
  ck('[선택] 줄 + 추가 전달문', s.promptBlock.includes('[선택] 금화로 무마한다')
    && s.promptBlock.includes('값비싼 평화를 샀다.'), s.promptBlock);
  ck('changeLog에 choice: 출처', s.changeLog.some((c) => c.source === 'choice:raid'), JSON.stringify(s.changeLog));
  ck('pending 해소', s.state.meta.pendingChoice === null && s.state.meta.pendingChoicePick === null);
  ck('해소 뒤엔 대기 줄 없음', !s.promptBlock.includes('[선택 대기]'));
  const s2 = send(st, 4);
  ck('리롤 = 같은 집행', s2.state.vars.gold === 100);
}

// ── /선택 매칭·거부 경로 ──
{
  const o = out(fresh(), 1);
  const t = (line, st = o.state) => engine.applyChatCommands(S, st, line);
  ck('이름 앞머리 매칭', t('/선택 토벌').pick === 0, JSON.stringify(t('/선택 토벌')));
  ck('범위 밖 번호 = 안내', t('/선택 9').text.includes('이렇게 고르세요'), t('/선택 9').text);
  ck('인자 없음 = 안내 (전체 목록)', t('/선택').text.includes('/선택 1'), t('/선택').text);
  const poor = clone(o.state); poor.vars.gold = 50;
  ck('잠긴 선택지 거부 (🔒)', t('/선택 2', poor).text.includes('🔒'), t('/선택 2', poor).text);
  ck('잠겨도 기록 안 됨', t('/선택 2', poor).pick === null);
  const idle = fresh();
  ck('갈림길 없을 때 = 안내', t('/선택 1', idle).text.includes('지금 고를 선택지가 없음'), t('/선택 1', idle).text);
  const both = t('/선택 1\n/금 +10');
  ck('변수 명령과 한 입력에 공존', both.pick === 0 && both.vars.gold === 210, JSON.stringify(both));
}

// ── 타임아웃: 마지막 항목 자동 ──
{
  let st = out(fresh(), 1).state;            // turn 1에서 발동 (pending.turn = 1)
  st = out(st, 2).state;                     // turn 2
  ck('타임아웃 전엔 유지', st.meta.pendingChoice?.id === 'raid', JSON.stringify(st.meta.pendingChoice));
  st = out(st, 3).state;                     // turn 3
  st = out(st, 4).state;                     // turn 4 시작 시 경과 3 ≥ timeout 3 → 자동 결정
  ck('타임아웃으로 해소', st.meta.pendingChoice === null || st.meta.pendingChoice.id !== 'raid',
    JSON.stringify(st.meta.pendingChoice));
  ck('마지막 항목(외면한다) 효과 적용', st.vars.mood < 53, String(st.vars.mood));
  ck('자동 결정 통지', st.meta.pendingNotifies.some((n) => n.includes('[선택] 외면한다')),
    JSON.stringify(st.meta.pendingNotifies));
  // 잠긴 마지막 항목이면 효과 없이 지나간다
  const S3 = clone(S); S3.rules.events[0].choices[2].when = 'gold >= 999999';
  let s3 = engine.outputPhase(S3, fresh(), {}, {}, { rng: seededRng('h', 1, 'out') }).state;
  const moodBefore = s3.vars.mood;
  for (const seed of [2, 3, 4]) s3 = engine.outputPhase(S3, s3, {}, {}, { rng: seededRng('h', seed, 'out') }).state;
  // 타임아웃으로 자리가 비면 같은 정산에서 대기하던 다음 갈림길(raid2)이 곧장 그 자리를 차지한다
  ck('잠긴 마지막 = 효과 없이 지나감 (자리는 다음 갈림길에게)', s3.meta.pendingChoice?.id !== 'raid'
    && s3.meta.pendingNotifies.some((n) => n.includes('선택의 순간이 지나갔다')), JSON.stringify(s3.meta.pendingNotifies));
  ck('잠긴 마지막 = mood 안 깎임', s3.vars.mood >= moodBefore, `${moodBefore} → ${s3.vars.mood}`);
}

// ── 상태창: 번호·잠김·자리표시자 ──
{
  const o = out(fresh(), 1);
  const poor = clone(o.state); poor.vars.gold = 50;
  const html = renderStatusHtml(S, poor, null, null, { uid: 'x' });
  ck('선택지 블록 (제목·항목)', html.includes('선택의 순간') && html.includes('1. 토벌대를 보낸다'), html);
  ck('잠긴 항목 🔒 + 번호 유지', html.includes('2. 금화로 무마한다 🔒'), html);
  ck('/선택 안내 + 타임아웃 안내', html.includes('/선택 번호') && html.includes('3턴'), html);
  const done = fresh();
  ck('갈림길 없으면 블록 없음', !renderStatusHtml(S, done, null, null, { uid: 'x' }).includes('선택의 순간'));
  const S4 = clone(S); S4.statusUI = { mode: 'template', template: '<div class="cc">{choices}</div>' };
  const h4 = renderStatusHtml(S4, o.state, null, null, { uid: 'x' });
  ck('템플릿 {choices} 자리에 렌더', h4.includes('선택의 순간'), h4);
}

// ── 진단 writerMap ──
{
  const w = writerMap(S);
  ck('military 기록자에 선택', w.military && w.military.has('선택'), JSON.stringify([...(w.military || [])]));
}

// ── daily 템플릿의 예시 ──
{
  const D = TEMPLATES.daily.schema;
  const cat = D.rules.randomEvents.table.find((e) => e.id === 'stray_cat');
  ck('daily에 갈림길 예시 (길고양이)', !!cat && cat.choices.length === 3 && cat.timeout === 2, JSON.stringify(cat?.choices?.map((c) => c.label)));
  ck('daily 검증 여전히 통과', validateSchema(D).ok, JSON.stringify(validateSchema(D).errors));
  ck('마지막 항목은 조건 없음', cat && !cat.choices[cat.choices.length - 1].when);
}

// ── 편집기 배선 (기능은 반드시 칸과 함께) ──
{
  ck('갈림길로 만들기 버튼', src.includes('갈림길로 만들기'), '');
  ck('이벤트 블록에 choiceEditor', src.includes('choiceEditor(ev)'), '');
  ck('AI 내보내기에 갈림길 안내', src.includes('갈림길 (이벤트에 choices 달기'), '');
}

// ═══ v1.8.0 — 선택지 판정 (choices[].check) ═══
// 고른 선택지가 판정을 굴린다. 액션과 같은 순서(굴림 먼저, 선택지 효과 나중), [판정] 줄은 같은 턴.
{
  const S3 = clone(S);
  S3.checks = [{ id: 'persuade', label: '설득', roll: 'rand(1, 20)', mod: '0',
    grades: [{ label: '성공', when: 'total >= 10', effects: [{ set: 'mood', expr: 'mood + 5' }], inject: '설득이 먹혔다.' },
      { label: '실패', effects: [{ set: 'mood', expr: 'mood - 5' }], inject: '설득은 통하지 않았다.' }] }];
  S3.rules.events[0].choices[0].check = 'persuade';
  const v = validateSchema(S3);
  ck('[판정] 선택지 check 참조 통과', v.ok, JSON.stringify(v.errors));
  const badRef = clone(S3); badRef.rules.events[0].choices[0].check = 'nope';
  ck('[판정] 없는 판정 id = 오류', !validateSchema(badRef).ok, '');
  const fresh3 = () => { const s = engine.initState(S3); s.meta.setupDone = true; s.meta.turn = 1; return s; };
  const o = engine.outputPhase(S3, fresh3(), {}, {}, { rng: seededRng('h', 1, 'out') });
  const st = clone(o.state); st.meta.pendingChoicePick = 0;
  const s = engine.sendPhase(S3, st, { rng: seededRng('h', 4, 'send') });
  ck('[판정] 고르면 굴린다 — [판정] 줄이 같은 턴 프롬프트에', s.promptBlock.includes('[판정] 설득:'), s.promptBlock);
  ck('[판정] [선택] 줄도 함께', s.promptBlock.includes('[선택] 토벌대를 보낸다'), '');
  const grade = s.state.meta.lastCheck?.grade;
  ck('[판정] lastCheck 기록', grade === '성공' || grade === '실패', JSON.stringify(s.state.meta.lastCheck));
  const expectMood = grade === '성공' ? 56 : 46; // plain 이벤트가 응답 단계에 +1 (50 → 51) 한 뒤 ±5
  ck('[판정] 등급 효과 적용 + 선택지 효과(병력 -20)', s.state.vars.mood === expectMood && s.state.vars.military === 30,
    `mood ${s.state.vars.mood} mil ${s.state.vars.military}`);
  ck('[판정] 등급 전달문', s.promptBlock.includes(grade === '성공' ? '설득이 먹혔다.' : '설득은 통하지 않았다.'), '');
  ck('[판정] 리롤 = 같은 눈', engine.sendPhase(S3, st, { rng: seededRng('h', 4, 'send') }).state.meta.lastCheck.roll === s.state.meta.lastCheck.roll);
  // 타임아웃 자동 결정도 굴린다 — 마지막 항목에 check를 달아 본다 (통지로 다음 전송)
  const S4 = clone(S3); S4.rules.events[0].choices[2].check = 'persuade'; S4.rules.events[0].timeout = 1;
  const o4 = engine.outputPhase(S4, fresh3(), {}, {}, { rng: seededRng('h', 1, 'out') });
  const st4 = clone(o4.state); st4.meta.turn = 5;
  const o5 = engine.outputPhase(S4, st4, {}, {}, { rng: seededRng('h', 2, 'out') });
  // raid가 풀리자 같은 턴에 raid2가 새로 걸린다 — raid는 끝났고 [판정] 줄이 통지에 있으면 된다
  ck('[판정] 타임아웃 자동 결정도 굴린다 (통지에 [판정])', o5.state.meta.pendingChoice?.id !== 'raid'
    && o5.state.meta.pendingNotifies.some((n) => n.startsWith('[판정] 설득')), JSON.stringify(o5.state.meta.pendingNotifies));
  ck('[판정] 편집기: 선택지 칸에 판정 드롭다운', src.includes("pair('판정', bindSelect(c.check"), '');
}

// ═══ v1.8.0 — 강제 갈림길 (events[].strict) ═══
// 고르지 않고 보내면 그 자리에서 시스템이 정한다. 'last' = 열린 것 중 맨 끝, 'random' = 열린 것 중 무작위(시드).
// 유저 글은 어댑터가 대체문으로 바꾼다 (userTextOverride).
{
  const S5 = clone(S); S5.rules.events[0].strict = true; delete S5.rules.events[0].timeout;
  const v = validateSchema(S5);
  ck('[강제] strict true 통과 · timeout 없어도 경고 없음', v.ok && !v.warnings.some((w) => w.msg.includes('timeout이 없습니다')), JSON.stringify(v.warnings));
  const badS = clone(S5); badS.rules.events[0].strict = 'always';
  ck('[강제] strict 어휘 밖 = 오류', !validateSchema(badS).ok, '');
  const orphan = clone(S); orphan.rules.events[2].strict = true;
  ck('[강제] choices 없는 이벤트의 strict = 경고', validateSchema(orphan).warnings.some((w) => w.msg.includes('strict는 choices')), '');
  const fresh5 = () => { const s = engine.initState(S5); s.meta.setupDone = true; s.meta.turn = 1; return s; };
  const o = engine.outputPhase(S5, fresh5(), {}, {}, { rng: seededRng('h', 1, 'out') });
  ck('[강제] 발동 → pending', o.state.meta.pendingChoice?.id === 'raid', '');
  // 고르지 않고 보냄 — 마지막(외면한다)으로
  const s = engine.sendPhase(S5, clone(o.state), { rng: seededRng('h', 4, 'send'), userText: '나는 산적 두목과 술을 마신다' });
  ck('[강제] 안 고르면 마지막 항목 집행 (mood 51 -10)', s.state.vars.mood === 41 && s.state.meta.pendingChoice === null, `mood ${s.state.vars.mood}`);
  ck('[강제] forcedChoice 반환', s.forcedChoice?.idx === 2 && s.forcedChoice.label === '외면한다' && s.forcedChoice.mode === 'last', JSON.stringify(s.forcedChoice));
  ck('[강제] 유저 글 대체문', typeof s.userTextOverride === 'string' && s.userTextOverride.includes('[선택 강제] 3. 외면한다'), s.userTextOverride);
  ck('[강제] [선택] 줄에 "시스템이 정했다" + [선택 강제] 안내', s.promptBlock.includes('[선택] 외면한다 (유저가 고르지 않아 시스템이 정했다)')
    && s.promptBlock.includes('[선택 강제]'), s.promptBlock);
  ck('[강제] 대기 줄은 없음', !s.promptBlock.includes('[선택 대기]'), '');
  ck('[강제] changeLog에 시스템 결정', s.changeLog.some((c) => c.id === '갈림길' && String(c.to).includes('시스템 결정')), JSON.stringify(s.changeLog));
  // 골랐으면 그대로 — 강제 아님
  const picked = clone(o.state); picked.meta.pendingChoicePick = 0;
  const s2 = engine.sendPhase(S5, picked, { rng: seededRng('h', 4, 'send') });
  ck('[강제] 골랐으면 그 항목 · 대체문 없음', s2.state.vars.military === 30 && !s2.forcedChoice && s2.userTextOverride === null, '');
  // 마지막이 잠겨 있으면 그 앞의 열린 것 — 'last'는 "열린 것 중 맨 끝"
  const S6 = clone(S5); S6.rules.events[0].choices[2].when = 'gold >= 999';
  const o6 = engine.outputPhase(S6, (() => { const st = engine.initState(S6); st.meta.setupDone = true; st.meta.turn = 1; return st; })(), {}, {}, { rng: seededRng('h', 1, 'out') });
  const s6 = engine.sendPhase(S6, clone(o6.state), { rng: seededRng('h', 4, 'send') });
  ck("[강제] 'last'는 열린 것 중 맨 끝 (잠긴 마지막은 건너뜀 → 금화로 무마)", s6.forcedChoice?.idx === 1 && s6.state.vars.gold === 100, JSON.stringify(s6.forcedChoice));
  // random — 시드 안정
  const S7 = clone(S5); S7.rules.events[0].strict = 'random';
  const o7 = engine.outputPhase(S7, (() => { const st = engine.initState(S7); st.meta.setupDone = true; st.meta.turn = 1; return st; })(), {}, {}, { rng: seededRng('h', 1, 'out') });
  const a = engine.sendPhase(S7, clone(o7.state), { rng: seededRng('h', 4, 'send') });
  const b = engine.sendPhase(S7, clone(o7.state), { rng: seededRng('h', 4, 'send') });
  ck("[강제] 'random' — 열린 것 중 하나, 리롤 = 같은 결정", a.forcedChoice && a.forcedChoice.mode === 'random' && a.forcedChoice.idx === b.forcedChoice.idx, JSON.stringify(a.forcedChoice));
  // 상태창 안내 문구
  const html = renderStatusHtml(S5, o.state, null, null, { uid: 'x' });
  ck('[강제] 상태창 안내 — "선택지 밖의 행동은 없었던 일"', html.includes('마지막 항목으로 흘러간다') && html.includes('없었던 일'), '');
  ck('[강제] 편집기: 강제 드롭다운 + 어댑터 대체 배선', src.includes("pair('강제', bindSelect(ev.strict") && src.includes('lastUser.content = r.userTextOverride'), '');
  // promptState.forcedChoiceGuide 끄기·교체
  const S8 = clone(S5); S8.promptState.forcedChoiceGuide = false;
  const s8 = engine.sendPhase(S8, clone(o.state), { rng: seededRng('h', 4, 'send') });
  ck('[강제] forcedChoiceGuide: false면 안내 줄 없음 (대체문은 그대로)', !s8.promptBlock.includes('[선택 강제]') && s8.userTextOverride, '');
  const S9 = clone(S5); S9.promptState.forcedChoiceGuide = '떠밀렸다: {mood}';
  const s9 = engine.sendPhase(S9, clone(o.state), { rng: seededRng('h', 4, 'send') });
  ck('[강제] forcedChoiceGuide 문자열 = 템플릿 교체', s9.promptBlock.includes('떠밀렸다: 41'), s9.promptBlock);
}

// ═══ v1.9.4 — 본문으로 고르기 (라벨을 복사해 그대로 보내는 습관) ═══
{
  const choiceMod = SimCore.require('choice');
  const ev = { choices: [{ label: '토벌대를 보낸다' }, { label: '금화로 무마한다.', tag: '굴욕' }, { label: '외면한다' }] };
  const M = (t) => choiceMod.matchTypedChoice(ev, t);
  ck('[본문] 라벨 그대로', M('외면한다') === 2 && M('토벌대를 보낸다') === 0, '');
  ck('[본문] "N. 라벨" · "N) 라벨" · "N 라벨"', M('3. 외면한다') === 2 && M('1) 토벌대를 보낸다') === 0 && M('3 외면한다') === 2, '');
  ck('[본문] 번호만', M('2') === 1 && M('3.') === 2 && M('4') === null && M('0') === null, '');
  ck('[본문] 태그 꼬리표·✅🔒·끝 마침표·공백 무시', M('2. 금화로 무마한다 굴욕') === 1 && M('✅ 2. 금화로 무마한다') === 1 && M('  외면한다.  ') === 2 && M('금화로 무마한다') === 1, '');
  ck('[본문] 덧붙인 말·일부만·빈 글은 null (회색지대는 안 받는다)', M('외면한다 그리고 술을 마신다') === null && M('외면') === null && M('') === null && M('나는 산적 두목과 술을 마신다') === null, '');

  // 엔진 왕복 — 강제 갈림길에서 라벨을 그대로 보내면 최악에 떠밀리지 않는다
  const S5 = clone(S); S5.rules.events[0].strict = true; delete S5.rules.events[0].timeout;
  const st0 = (() => { const x = engine.initState(S5); x.meta.setupDone = true; x.meta.turn = 1; return x; })();
  const o = engine.outputPhase(S5, st0, {}, {}, { rng: seededRng('h', 1, 'out') });
  const s1 = engine.sendPhase(S5, clone(o.state), { rng: seededRng('h', 4, 'send'), userText: '1. 토벌대를 보낸다' });
  ck('★ [본문] 강제 갈림길 — 항목 글 그대로 = 고른 것 (military 30 · 강제 아님 · 대체문 없음)',
    s1.state.vars.military === 30 && !s1.forcedChoice && s1.userTextOverride === null && s1.typedChoice?.idx === 0, JSON.stringify({ m: s1.state.vars.military, f: s1.forcedChoice, t: s1.typedChoice }));
  ck('[본문] [선택] 줄은 유저가 고른 꼴 · changeLog "본문으로 선택"', s1.promptBlock.includes('[선택] 토벌대를 보낸다') && !s1.promptBlock.includes('시스템이 정했다')
    && s1.changeLog.some((c) => c.id === '갈림길' && String(c.to).includes('본문으로 선택')), s1.promptBlock);
  const s1b = engine.sendPhase(S5, clone(o.state), { rng: seededRng('h', 4, 'send'), userText: '1. 토벌대를 보낸다' });
  ck('[본문] 리롤 = 같은 결정', s1b.state.vars.military === 30 && s1b.typedChoice?.idx === 0, '');
  const s2 = engine.sendPhase(S5, clone(o.state), { rng: seededRng('h', 4, 'send'), userText: '토벌대를 보낸다, 그리고 나도 따라간다' });
  ck('[본문] 덧붙인 말은 여전히 안 고른 것 → 강제(최악)', s2.forcedChoice?.idx === 2 && s2.state.vars.mood === 41 && !s2.typedChoice, JSON.stringify(s2.forcedChoice));
  const S6 = clone(S5); S6.rules.events[0].choices[1].when = 'gold >= 999';
  const o6 = engine.outputPhase(S6, (() => { const x = engine.initState(S6); x.meta.setupDone = true; x.meta.turn = 1; return x; })(), {}, {}, { rng: seededRng('h', 1, 'out') });
  const s6 = engine.sendPhase(S6, clone(o6.state), { rng: seededRng('h', 4, 'send'), userText: '금화로 무마한다' });
  ck('[본문] 잠긴 항목 글은 안 고른 것 (strict는 strict다) → 최악', s6.forcedChoice?.idx === 2 && s6.state.vars.gold === 200 && !s6.typedChoice, JSON.stringify(s6.forcedChoice));
  const picked = clone(o.state); picked.meta.pendingChoicePick = 2;
  const s7 = engine.sendPhase(S5, picked, { rng: seededRng('h', 4, 'send'), userText: '1. 토벌대를 보낸다' });
  ck('[본문] 예약(클릭·/선택)이 있으면 예약이 이긴다', s7.state.vars.mood === 41 && s7.state.vars.military === 50 && !s7.typedChoice, '');
  // 일반(비강제) 갈림길도 같은 길 — 효과가 굴러가고 대기가 풀린다
  const oN = out(fresh(), 1);
  const sN = engine.sendPhase(S, clone(oN.state), { rng: seededRng('h', 4, 'send'), userText: '외면한다' });
  ck('★ [본문] 일반 갈림길 — 라벨 그대로 보내면 집행 + 대기 해제 (예전엔 효과 없이 계속 열려 있었다)', sN.state.vars.mood === 41 && sN.state.meta.pendingChoice === null && !sN.promptBlock.includes('[선택 대기]'), `mood ${sN.state.vars.mood}`);
  const html = renderStatusHtml(S, oN.state, null, null, { uid: 'x' });
  ck('[본문] 상태창 안내 — "항목 글을 그대로 보내도 된다"', html.includes('항목 글을 그대로 보내도 된다'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
