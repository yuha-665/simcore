const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.8.0 — 보조가 쓰는 갈림길 (liveChoices). 노우코메("내 뇌내 선택지가 …")류 봇의 절대선택이 실측 대상.
//
// 불변식:
//   · 보조가 쓰고 시스템이 쥔다 — 라벨은 즉석, 결과(판정·효과·전달문)는 태그가 정한다 (어휘 밖 태그는 거른다)
//   · 부탁은 전송 단계 추첨(chance, 시드 rng) 또는 이벤트 트리거로 깃발(liveAsk) → 보조 호출에 얹힘 → 응답 단계에서 걸림
//   · 걸린 뒤는 스키마 갈림길과 같은 기계 — /선택·클릭·타임아웃·strict·allow 동결 (pendingChoiceEvent가 합성)
//   · worst 태그 항목은 맨 끝 — 타임아웃·strict 'last'의 "안 고르면 최악"과 맞물린다
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const choice = SC.require('choice');
const { renderStatusHtml } = SC.require('render');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;
const clone = (o) => JSON.parse(JSON.stringify(o));

const S = {
  simcore: '0.1', meta: { name: '절대선택봇' },
  vars: [
    { id: 'curse_on', label: '저주', type: 'bool', init: true },
    { id: 'curse', label: '저주 강도', type: 'int', init: 100, min: 0, max: 100 },
    { id: 'shame', label: '수치', type: 'int', init: 0, min: 0, max: 100 },
    { id: 'sanity', label: '정신력', type: 'int', init: 50, min: 0, max: 100 },
    { id: 'love', label: '호감', type: 'int', init: 10, min: 0, max: 100 },
  ],
  derived: [],
  checks: [{ id: 'humiliate', label: '망신', roll: 'rand(1, 20)', mod: '0',
    grades: [{ label: '대참사', when: 'total <= 5', effects: [{ set: 'shame', expr: 'shame + 15' }], inject: '최악의 형태로 망신을 당했다.' },
      { label: '망신', effects: [{ set: 'shame', expr: 'shame + 5' }] }] }],
  rules: { onTurn: [], events: [
    { id: 'god_call', when: 'sanity < 20', once: true, notify: '신의 목소리가 들렸다.', liveChoices: true },
  ], randomEvents: { chancePerTurn: 0, table: [] } },
  actions: [],
  updater: { model: 'aux', allow: [{ id: 'shame', maxDelta: 10 }, { id: 'sanity', maxDelta: 10 }, { id: 'love', maxDelta: 10 }] },
  promptState: { includeEvents: true },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'sanity' }] }] },
  liveChoices: {
    label: '절대선택', icon: '⚡', when: 'curse_on', chance: 'curse / 100', count: [2, 3],
    strict: 'last', worst: '최악', timeout: 2,
    tags: [
      { id: '굴욕', desc: '남 앞에서 망신당하는 행동', check: 'humiliate', effects: [{ set: 'love', expr: 'love - 2' }] },
      { id: '멀쩡', desc: '드물게 섞이는 정상적인 길', effects: [{ set: 'love', expr: 'love + 3' }] },
      { id: '최악', desc: '가장 처참한 길', effects: [{ set: 'sanity', expr: 'sanity - 10' }], inject: '최악의 길로 떠밀렸다.' },
    ],
    guide: '둘 다 개막장이어야 한다 — 멀쩡한 길은 열에 하나.',
    desc: '머릿속에 선택지가 떠올랐다 — 고를 때까지 두통이 멎지 않는다.',
  },
};

const fresh = (Sx = S) => { const s = engine.initState(Sx); s.meta.setupDone = true; s.meta.turn = 1; return s; };
const send = (Sx, st, seed, userText = '') => engine.sendPhase(Sx, st, { rng: seededRng('h', seed, 'send'), userText });
const out = (Sx, st, seed, opts = {}) => engine.outputPhase(Sx, st, {}, {}, { rng: seededRng('h', seed, 'out'), ...opts });
const RAW = { desc: '히로인 둘이 노려보고 있다', items: [
  { label: '둘 다 안으며 "내 것이 되어라"라고 외친다', tag: '굴욕' },
  { label: '조용히 사과한다', tag: '멀쩡' },
  { label: '바지를 벗고 교가를 부른다', tag: '최악' },
] };

console.log('━━ 검증 ━━');
{
  const v = validateSchema(S);
  ck('기본 스키마 통과', v.ok, J(v.errors));
  ck('경고 없음', !v.warnings.some((w) => w.path.startsWith('$.liveChoices') || w.path.includes('events')), J(v.warnings));
  const bad = (mut) => { const c = clone(S); mut(c); return validateSchema(c); };
  ck('strict 어휘 밖 = 오류', !bad((c) => { c.liveChoices.strict = 'always'; }).ok, '');
  ck('worst가 tags에 없으면 오류', !bad((c) => { c.liveChoices.worst = '없는태그'; }).ok, '');
  ck('태그 id 중복 = 오류', !bad((c) => { c.liveChoices.tags[1].id = '굴욕'; }).ok, '');
  ck('태그 check 참조 오류', !bad((c) => { c.liveChoices.tags[0].check = 'nope'; }).ok, '');
  ck('태그 효과의 모르는 변수 = 오류', !bad((c) => { c.liveChoices.tags[0].effects = [{ set: 'nope', expr: '1' }]; }).ok, '');
  ck('count 범위 밖 = 오류', !bad((c) => { c.liveChoices.count = [1, 9]; }).ok, '');
  ck('chance 식의 모르는 변수 = 오류', !bad((c) => { c.liveChoices.chance = 'nope / 2'; }).ok, '');
  ck('chance 숫자 범위 밖 = 오류', !bad((c) => { c.liveChoices.chance = 2; }).ok, '');
  const w1 = bad((c) => { delete c.liveChoices.chance; delete c.rules.events[0].liveChoices; });
  ck('chance 없고 트리거도 없으면 경고', w1.ok && w1.warnings.some((w) => w.path === '$.liveChoices.chance'), J(w1.warnings));
  const w2 = bad((c) => { delete c.liveChoices.timeout; delete c.liveChoices.strict; });
  ck('timeout·strict 둘 다 없으면 경고', w2.ok && w2.warnings.some((w) => w.path === '$.liveChoices.timeout'), J(w2.warnings));
  const w3 = bad((c) => { c.liveChoices.tags = []; delete c.liveChoices.worst; });
  ck('태그 없으면 경고 (서사만 갈린다)', w3.ok && w3.warnings.some((w) => w.path === '$.liveChoices.tags'), J(w3.warnings));
  const w4 = bad((c) => { delete c.liveChoices; });
  ck('설정 없이 이벤트 트리거만 = 경고', w4.ok && w4.warnings.some((w) => w.msg.includes('liveChoices 설정이 없')), J(w4.warnings));
  ck('트리거 값이 불이 아니면 오류', !bad((c) => { c.rules.events[0].liveChoices = 'yes'; }).ok, '');
  const w5 = bad((c) => { c.statusUI = { mode: 'template', template: '<div>{sanity}</div>' }; });
  ck('템플릿 모드에 {choices} 없으면 경고 (보조 갈림길도 같은 자리)', w5.warnings.some((w) => w.msg.includes('{choices}')), J(w5.warnings));
}

console.log('━━ 설정 읽기 · 추첨 ━━');
{
  const cfg = choice.liveConfig(S);
  ck('liveConfig — strict last · worst · count', cfg.strict === 'last' && cfg.worst === '최악' && cfg.count[0] === 2 && cfg.count[1] === 3, J(cfg));
  ck('strictMode: true→last · random · 그밖은 null', choice.strictMode(true) === 'last' && choice.strictMode('random') === 'random' && choice.strictMode(false) === null && choice.strictMode('x') === null);
  const s = send(S, fresh(), 1);
  ck('chance 100% → 전송 단계에 liveAsk', s.state.meta.liveAsk === true, '');
  const off = fresh(); off.vars.curse_on = false;
  ck('when 거짓이면 추첨 안 함', send(S, off, 1).state.meta.liveAsk === false, '');
  const zero = fresh(); zero.vars.curse = 0;
  ck('chance 0이면 추첨 안 함', send(S, zero, 1).state.meta.liveAsk === false, '');
  const setup = fresh(); setup.meta.setupDone = false; setup.meta.turn = 0;
  const S0 = clone(S); S0.setup = { ai: { enabled: true, instruction: 'x' } };
  ck('세션 0(최초설정)엔 추첨 안 함', send(S0, setup, 1).state.meta.liveAsk === false, '');
  // 리롤 안정 — 같은 시드면 같은 깃발 (chance 50%로 여러 시드)
  const S50 = clone(S); S50.liveChoices.chance = 0.5;
  const flags = [1, 2, 3, 4, 5, 6].map((i) => send(S50, fresh(S50), i).state.meta.liveAsk);
  const flags2 = [1, 2, 3, 4, 5, 6].map((i) => send(S50, fresh(S50), i).state.meta.liveAsk);
  ck('추첨은 시드에 고정 (리롤 = 같은 깃발)', J(flags) === J(flags2) && flags.some(Boolean) && !flags.every(Boolean), J(flags));
  // 설정 없는 봇은 rng를 안 소비한다 — 같은 시드의 rand 효과값이 그대로
  const SN = clone(S); delete SN.liveChoices; delete SN.rules.events[0].liveChoices;
  SN.actions = [{ id: 'roll', label: '굴림', effects: [{ set: 'shame', expr: 'rand(1, 100)' }] }];
  const SW = clone(SN); SW.liveChoices = { ...S.liveChoices, when: 'false' }; // 설정은 있지만 문이 닫힘 — rng 안 먹어야 한다
  const armed = () => { const st = fresh(SN); st.meta.armed.roll = true; return st; };
  const n1 = send(SN, armed(), 7).state.vars.shame;
  const w1 = send(SW, engine.reconcileState(SW, armed()), 7).state.vars.shame;
  ck('추첨을 안 하는 턴은 rng를 안 먹는다 (설정 없음 = when 닫힘, 같은 시드 같은 눈)', n1 === w1, `${n1} / ${w1}`);
  ck('설정 없는 봇의 sendPhase에 liveAsk 깃발은 false', send(SN, armed(), 7).state.meta.liveAsk === false, '');
}

console.log('━━ 보조 부탁 · 정제 · 걸기 ━━');
{
  const s = send(S, fresh(), 1);
  const ap = engine.buildAuxPrompt(S, s.state, '본문', '유저');
  ck('깃발이 선 턴 보조 프롬프트에 부탁이 얹힌다', ap.includes('[절대선택 — 선택지 쓰기]') && ap.includes('"choices" 필드'), ap.slice(-900));
  ck('태그 어휘·최악·지침이 실린다', ap.includes('굴욕(남 앞에서') && ap.includes("태그 '최악'") && ap.includes('열에 하나'), '');
  ck('형식 줄에 tag', ap.includes('"tag":"태그"'), '');
  const SA = clone(S); SA.updater.allow = []; // allow가 비어야 깃발만으로 판가름이 난다
  const idle = fresh();
  ck('auxHasWork — 깃발이 선 턴만 참 (allow 없는 봇)', engine.auxHasWork(SA, s.state) && !engine.auxHasWork(SA, idle) && engine.auxHasWork(SA, null), '');
  ck('깃발 없는 턴은 부탁 없음', !engine.buildAuxPrompt(S, idle, '본문', '유저').includes('선택지 쓰기'), '');
  const parsed = engine.parseAuxResponse(`{"changes":{},"reasons":{},"choices":${J(RAW)}}`);
  ck('parseAuxResponse가 choices를 뽑는다', parsed.choices && parsed.choices.items.length === 3, J(parsed.choices));
  // 걸기
  const o = out(S, s.state, 2, { choices: RAW });
  const pc = o.state.meta.pendingChoice;
  ck('응답 단계에 pendingChoice @live', pc?.id === '@live' && pc.live.items.length === 3, J(pc));
  ck('깃발 소비', o.state.meta.liveAsk === false, '');
  ck('desc 보존', pc.live.desc === '히로인 둘이 노려보고 있다', '');
  ck('worst 항목이 맨 끝', pc.live.items[2].tag === '최악' && pc.live.items[2].label.includes('교가'), J(pc.live.items));
  ck('changeLog에 선택지 게시', o.changeLog.some((c) => c.source === 'liveChoices' && String(c.to).includes('3개')), J(o.changeLog));
  // 정제
  const cfg = choice.liveConfig(S);
  const dirty = choice.sanitizeItems(cfg, { items: [
    { label: '  둘 다   안는다 ', tag: '굴욕적' },            // 태그 앞머리 구제
    { label: '둘 다 안는다', tag: '굴욕' },                   // 중복 라벨(공백 무시)
    { label: '도망친다', tag: '비겁' },                       // 어휘 밖 → 버림
    { label: '바지를 벗는다', tag: '최악' },
    { label: '교가를 부른다', tag: '최악' },                   // 최악 둘 → 둘째는 태그 갈아끼움
    { label: 'x'.repeat(200), tag: '멀쩡' },
  ] });
  ck('정제 — 앞머리 구제·중복·어휘 밖 버림', dirty.items.length === 3 && dirty.items[0].tag === '굴욕' && dirty.rejected.length === 2
    && dirty.rejected.some((r) => r.includes('중복')) && dirty.rejected.some((r) => r.includes("'비겁'")), J(dirty));
  ck('정제 — 상한 count[1]=3 · 최악은 하나만 맨 끝', dirty.items.filter((x) => x.tag === '최악').length === 1 && dirty.items[2].tag === '최악', J(dirty.items));
  const few = choice.sanitizeItems(cfg, { items: [{ label: '하나', tag: '굴욕' }] });
  ck('최소 개수 미달이면 비운다', few.items.length === 0 && few.rejected.some((r) => r.includes('최소')), J(few));
  const arr = choice.sanitizeItems(cfg, ['A', 'B']);
  ck('태그 어휘가 있는데 태그가 없으면 버림', arr.items.length === 0, J(arr));
  const noTag = choice.liveConfig({ liveChoices: { tags: [] } });
  ck('태그 어휘가 없으면 문자열 배열도 받는다', choice.sanitizeItems(noTag, ['A', 'B']).items.length === 2, '');
  // 안 부탁한 턴에 온 choices는 무시
  const o2 = out(S, fresh(), 2, { choices: RAW });
  ck('부탁 안 한 턴의 choices는 무시', o2.state.meta.pendingChoice === null, '');
  // 다른 갈림길이 걸려 있으면 깃발 유지(deferred)
  const busy = clone(s.state); busy.meta.pendingChoice = { id: 'other', turn: 1 };
  const SB = clone(S); SB.rules.events.push({ id: 'other', when: 'false', choices: [{ label: 'a' }, { label: 'b' }], timeout: 2 });
  const o3 = out(SB, busy, 2, { choices: RAW });
  ck('다른 갈림길 대기 중이면 깃발 유지', o3.state.meta.liveAsk === true && o3.state.meta.pendingChoice?.id === 'other', J(o3.state.meta));
  ck('대기 중엔 부탁도 안 얹는다', !engine.buildAuxPrompt(SB, o3.state, '본문', '유저').includes('선택지 쓰기'), '');
}

console.log('━━ 걸린 뒤 — 합성 이벤트 · 상태창 · 명령 · 집행 ━━');
{
  const s = send(S, fresh(), 1);
  const o = out(S, s.state, 2, { choices: RAW });
  const ev = engine.pendingChoiceEvent(S, o.state);
  ck('pendingChoiceEvent 합성 — live · strict · timeout · 태그 효과', ev?.live === true && ev.strict === 'last' && ev.timeout === 2
    && ev.choices[0].check === 'humiliate' && ev.choices[2].inject === '최악의 길로 떠밀렸다.' && ev.choices[1].effects[0].set === 'love', J(ev));
  const html = renderStatusHtml(S, o.state, null, null, { uid: 'x' });
  ck('상태창 — 제목 아이콘+이름 · desc · 태그 꼬리표', html.includes('⚡ 절대선택') && html.includes('히로인 둘이') && html.includes('sim-choice-tag">굴욕'), html.slice(html.indexOf('sim-choices'), html.indexOf('sim-choices') + 700));
  ck('상태창 — 강제 안내', html.includes('마지막 항목으로 흘러간다') && html.includes('없었던 일'), '');
  ck('상태창 — 히트 클래스 3개', (html.match(/sim-hitchoice-\d/g) || []).length === 3, '');
  const S2 = clone(S); S2.liveChoices.showTags = false;
  ck('showTags: false면 꼬리표 없음', !renderStatusHtml(S2, o.state, null, null, { uid: 'x' }).includes('sim-choice-tag'), '');
  // allow 동결 — 태그 효과 변수만
  const allow = engine.auxAllowList(S, null, o.state).map((a) => a.id);
  ck('대기 중 allow에서 태그 효과 변수(love·sanity) 제외, shame은 남음', !allow.includes('love') && !allow.includes('sanity') && allow.includes('shame'), allow.join(','));
  // /선택
  const r = engine.applyChatCommands(S, o.state, '/선택 2');
  ck('/선택 2 — 확인 문구', r.text.includes('2. 조용히 사과한다') && r.pick === 1, r.text);
  const r2 = engine.applyChatCommands(S, o.state, '/선택 교가');
  ck('/선택 이름 매칭', r2.pick === 2, r2.text);
  ck('pickChoice 검증 (클릭 경로)', engine.pickChoice(S, o.state, 0).ok && !engine.pickChoice(S, o.state, 5).ok, '');
  // 집행 — 굴욕 (판정 + 태그 효과)
  const st = clone(o.state); st.meta.pendingChoicePick = 0;
  const x = send(S, st, 3);
  ck('집행 — [선택] 라벨 · [판정] 망신 · 태그 효과 love -2', x.promptBlock.includes('[선택] 둘 다 안으며') && x.promptBlock.includes('[판정] 망신:')
    && x.state.vars.love === 8 && x.state.meta.pendingChoice === null, x.promptBlock);
  ck('changeLog 출처 choice:@live', x.changeLog.some((c) => c.source === 'choice:@live'), J(x.changeLog));
  ck('리롤 = 같은 눈', send(S, st, 3).state.meta.lastCheck.roll === x.state.meta.lastCheck.roll, '');
  // 강제 — 고르지 않고 보냄 → 최악(맨 끝)
  const f = send(S, clone(o.state), 3, '나는 그냥 교실을 나간다');
  ck('강제 — 안 고르면 최악 항목 · sanity -10 · 전달문', f.forcedChoice?.idx === 2 && f.state.vars.sanity === 40
    && f.promptBlock.includes('최악의 길로 떠밀렸다.') && f.promptBlock.includes('[선택 강제]'), f.promptBlock);
  ck('강제 — 유저 글 대체문', f.userTextOverride.includes('[선택 강제] 3. 바지를 벗고'), f.userTextOverride);
  // 집행 뒤엔 새 추첨이 다시 돈다 (chance 100%)
  ck('집행한 전송에 다음 부탁 깃발 (chance 100%)', f.state.meta.liveAsk === true, '');
  // 타임아웃 (strict 없는 설정) — cfg.timeout
  const ST = clone(S); delete ST.liveChoices.strict;
  const sT = send(ST, fresh(ST), 1);
  const oT = out(ST, sT.state, 2, { choices: RAW });
  const late = clone(oT.state); late.meta.turn = 10;
  const oT2 = out(ST, late, 3);
  ck('타임아웃 — 마지막(최악) 자동 · 통지', oT2.state.meta.pendingChoice === null && oT2.state.vars.sanity === 40
    && oT2.state.meta.pendingNotifies.some((n) => n.includes('정하지 않아')), J(oT2.state.meta.pendingNotifies));
  const wait = send(ST, clone(oT.state), 3);
  ck('강제 아니면 [선택 대기] 줄 · 대체문 없음', wait.promptBlock.includes('[선택 대기]') && wait.userTextOverride === null && wait.state.meta.pendingChoice?.id === '@live', '');
  // 설정이 사라지면 걸린 갈림길은 방어적으로 풀린다
  const SG = clone(S); delete SG.liveChoices;
  const gone = send(SG, engine.reconcileState(SG, clone(o.state)), 3);
  ck('설정이 사라지면 걸린 것 정리', gone.state.meta.pendingChoice === null, '');
}

console.log('━━ 이벤트 트리거 ━━');
{
  const S2 = clone(S); S2.liveChoices.chance = 0;
  const st = fresh(S2); st.vars.sanity = 10;
  const o = out(S2, st, 1);
  ck('이벤트(god_call) 발동 → liveAsk', o.firedEvents.includes('god_call') && o.state.meta.liveAsk === true, J(o.state.meta));
  const s = send(S2, o.state, 2);
  ck('다음 전송은 추첨 없이 깃발 유지', s.state.meta.liveAsk === true, '');
  ck('그 턴 보조 프롬프트에 부탁', engine.buildAuxPrompt(S2, s.state, '본문', '유저').includes('선택지 쓰기'), '');
  const o2 = out(S2, s.state, 3, { choices: RAW });
  ck('응답 단계에 걸림 · 깃발 소비', o2.state.meta.pendingChoice?.id === '@live' && o2.state.meta.liveAsk === false, '');
}

console.log('━━ 편집기 · 어댑터 배선 ━━');
{
  ck('[규칙·이벤트] 05 보조가 쓰는 갈림길 섹션', src.includes("'보조가 쓰는 갈림길',") && src.includes('function liveChoicesEditor'), '');
  ck('만들기 버튼 + 태그 편집 + 떼기', src.includes('보조가 쓰는 갈림길 만들기') && src.includes("'+ 태그'") && src.includes('최악 태그'), '');
  ck('이벤트 블록에 트리거 체크', src.includes('보조가 쓰는 갈림길(') && src.includes('ev.liveChoices = true'), '');
  ck('AI 내보내기 안내', src.includes('## 보조가 쓰는 갈림길 (최상위 liveChoices'), '');
  ck('오류 경로 → 탭 매핑', src.includes('(rules|directives|liveChoices)'), '');
  ck('어댑터 조작줄이 pendingChoiceEvent를 쓴다', src.includes('engine.pendingChoiceEvent(schema, session.current)'), '');
  ck('진단 writerMap에 태그 효과', src.includes("schema.liveChoices?.tags || [])) for (const f of (t?.effects || [])) add("), '');
  ck('빌드 순서에 choice 모듈', src.includes('SimCore.define("choice"'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n[test-livechoices] ${p}/${p + f} 통과`);
process.exit(f ? 1 : 0);
