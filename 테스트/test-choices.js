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

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
