const __P = (...p) => require('path').resolve(__dirname, ...p);
// 전 템플릿이 검증기를 통과하고, 실제로 여러 턴 굴러가는지 확인
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const { validateSchema } = SimCore.require('validate');
const { TEMPLATES } = SimCore.require('templates');
const engine = SimCore.require('engine');
const { renderStatusHtml } = SimCore.require('render');
const { seededRng } = SimCore.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

for (const [key, t] of Object.entries(TEMPLATES)) {
  const v = validateSchema(t.schema);
  ck(`[${key}] 스키마 검증 통과`, v.ok, v.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
  ck(`[${key}] 경고 없음`, v.warnings.length === 0, v.warnings.map((w) => `${w.path}: ${w.msg}`).join(' / '));
  if (!v.ok) continue;

  const sch = t.schema;
  // 30턴 굴려서 예외/NaN이 안 나는지
  let state = engine.initState(sch);
  let err = null, notifies = 0, badVal = null;
  try {
    for (let i = 0; i < 30; i++) {
      const send = engine.sendPhase(sch, state, { rng: seededRng('t', i, 'send') });
      state = send.state;
      if (typeof send.promptBlock !== 'string' || !send.promptBlock.length) throw new Error('promptBlock 비어 있음');
      if (/\bundefined\b|\bNaN\b/.test(send.promptBlock)) throw new Error('promptBlock에 undefined/NaN: ' + send.promptBlock.slice(0, 200));
      const out = engine.outputPhase(sch, state, {}, {}, { rng: seededRng('t', i, 'out') });
      state = out.state;
      notifies += out.state.meta.pendingNotifies.length;
      for (const [id, val] of Object.entries(state.vars)) {
        if (typeof val === 'number' && !isFinite(val)) badVal = `${id}=${val}`;
      }
    }
  } catch (e) { err = e; }
  ck(`[${key}] 30턴 진행 중 예외 없음`, !err, err && err.message);
  ck(`[${key}] 숫자 변수 정상 (NaN/Infinity 없음)`, !badVal, badVal);

  // 상태창 렌더
  let rerr = null, html = '';
  try {
    const actions = (sch.actions || []).map((a) => ({ id: a.id, label: a.label, armed: false, disabled: false }));
    html = renderStatusHtml(sch, state, [], actions, { includeStyle: false });
  } catch (e) { rerr = e; }
  ck(`[${key}] 상태창 렌더 정상`, !rerr && html.length > 0, rerr && rerr.message);

  // 액션 조건식
  let aerr = null;
  try { for (const a of sch.actions || []) engine.actionAvailability(sch, state, a); } catch (e) { aerr = e; }
  ck(`[${key}] 액션 조건식 평가 정상`, !aerr, aerr && aerr.message);

  // 프리셋 전부 적용 가능한지
  let perr = null;
  for (const p of sch.setup?.presets || []) {
    try {
      const r = engine.applyPreset(sch, engine.initState(sch), p.id);
      if (!r.applied) perr = `프리셋 '${p.id}' 적용 실패`;
    } catch (e) { perr = `${p.id}: ${e.message}`; }
  }
  ck(`[${key}] 프리셋 전부 적용됨`, !perr, perr);

  // 보조모델 프롬프트 생성
  let berr = null, prompt = '';
  try { prompt = engine.buildAuxPrompt(sch, state, '테스트 서사', '테스트 입력'); } catch (e) { berr = e; }
  ck(`[${key}] 보조모델 프롬프트 생성`, !berr && prompt.includes('changes'), berr && berr.message);
}

// 신규 템플릿 3종이 실제로 등록됐는지
for (const k of ['mystery', 'business', 'romance']) {
  ck(`신규 템플릿 '${k}' 등록됨`, !!TEMPLATES[k], Object.keys(TEMPLATES).join(','));
}

// 추리: 진상(truth)이 모델 프롬프트에는 있고 유저 상태창에는 없어야 한다
{
  const sch = TEMPLATES.mystery.schema;
  const st = engine.initState(sch);
  st.vars.truth = '집사가 범인. 독을 탔다.';
  const block = engine.sendPhase(sch, st, { rng: seededRng('t', 0, 's') }).promptBlock;
  const html = renderStatusHtml(sch, st, [], null, { includeStyle: false });
  ck('[mystery] 진상이 모델 프롬프트에는 전달됨', block.includes('집사가 범인'), block.slice(0, 150));
  ck('[mystery] 진상이 유저 상태창에는 안 보임', !html.includes('집사가 범인'));
}

// 경영: 파생 계산 사슬이 실제로 맞물리는지
{
  const sch = TEMPLATES.business.schema;
  const st = engine.initState(sch);
  const look = engine.makeLookup(sch, st.vars);
  const demand = look('demand'), sold = look('sold'), profit = look('profit');
  ck('[business] 수요 계산됨', typeof demand === 'number' && demand > 0, String(demand));
  ck('[business] 판매량 = min(수요, 재고)', sold === Math.min(demand, st.vars.stock), `${sold} vs ${Math.min(demand, st.vars.stock)}`);
  ck('[business] 순익 = 매출-인건비-임대료', profit === look('revenue') - look('wages') - look('rent'), String(profit));
}

// 연애: 호감도가 오르면 단계가 전이되는지
{
  const sch = TEMPLATES.romance.schema;
  let st = engine.initState(sch);
  st.vars.affection = 40;
  const out = engine.outputPhase(sch, st, {}, {}, { rng: seededRng('t', 0, 'o') });
  ck('[romance] 호감 40 → 친구 단계 전이', out.state.vars.stage === '친구', out.state.vars.stage);
  ck('[romance] 전이 시 통지 발생', out.state.meta.pendingNotifies.length > 0, JSON.stringify(out.state.meta.pendingNotifies));
}

// 연애: 에셋 팩 실물 예시 — 꺼진 채 실려 있고, 꺼진 동안은 보조 프롬프트에 흔적이 없어야 한다
{
  const sch = TEMPLATES.romance.schema;
  const pk = sch.assets?.packs?.[0];
  ck('[romance] 에셋 팩 예시 존재', !!pk && pk.slots.some((s) => s.id === 'who'), JSON.stringify(pk));
  ck('[romance] 예시 팩은 꺼진 상태로 배송', pk && pk.enabled === false, String(pk && pk.enabled));
  const st = engine.initState(sch);
  const prompt = engine.buildAuxPrompt(sch, st, '서사', '입력');
  ck('[romance] 꺼진 팩은 보조 프롬프트에 안 실림', !prompt.includes('"image"'), prompt.slice(0, 200));
  // 켜면 image 스펙이 합류한다 (원본은 안 건드리게 복제)
  const on = JSON.parse(JSON.stringify(sch));
  delete on.assets.packs[0].enabled;
  const prompt2 = engine.buildAuxPrompt(on, engine.initState(on), '서사', '입력');
  ck('[romance] 켜면 image 스펙 합류', prompt2.includes('"image"') && prompt2.includes('Hana'), prompt2.slice(-300));
}

// 하루 경계 넘김 (v0.99) — 🌙는 깃발만, 시각은 장면이 정하고 시스템이 분을 계산한다.
// 유저 실전 피드백: "다음날 아침 고정"은 군대물·야간 서사에서 어긋난다.
// ⚠ 시간대는 enum(wake_at)이다 — int로 받으면 보조 changes가 델타로 적용돼 값이 어긋난다 (실측).
{
  const { evaluate } = SimCore.require('expr');
  const at = (sch, st, name) => evaluate(name, engine.makeLookup(sch, st.vars), null);
  for (const key of ['romance', 'daily']) {
    const sch = TEMPLATES[key].schema;
    let st = engine.initState(sch); st.meta.setupDone = true;
    // 밤 22:40으로 옮겨 놓고 (야간 작전 시나리오 재현) 🌙를 무장
    st.vars.skip_min = (22 - at(sch, st, 'hour')) * 60 + (40 - at(sch, st, 'minute'));
    st = engine.outputPhase(sch, st, {}, {}, { rng: seededRng('d', 0, 'o') }).state;
    st = engine.toggleAction(sch, st, 'end_day').state;
    const day0 = at(sch, st, 'elapsed');
    const send = engine.sendPhase(sch, st, { rng: seededRng('d', 1, 's') });
    st = send.state;
    ck(`[${key}] 🌙 — 시계는 안 돌고 깃발만`, at(sch, st, 'elapsed') === day0 && st.vars.day_break === true,
      `elapsed ${at(sch, st, 'elapsed')} day_break ${st.vars.day_break}`);
    ck(`[${key}] 🌙 inject·지시문 — 아침 단정 금지`, send.promptBlock.includes('시각은 문맥이 정한다')
      && send.promptBlock.includes('아침으로 단정하지 마라'), '');
    // 보조가 "다음날 새벽" 장면으로 읽어 옴 → sync 이벤트가 분을 계산·깃발 해제
    st = engine.outputPhase(sch, st, { wake_at: '새벽' }, {}, { rng: seededRng('d', 2, 'o') }).state;
    ck(`[${key}] sync — 깃발·시간대 되돌림 (자가 회복 래치)`, st.vars.day_break === false && st.vars.wake_at === '미정',
      `day_break ${st.vars.day_break} wake_at ${st.vars.wake_at}`);
    // 다음 전송에서 소비 — 다음 날 새벽 05:00 정각
    st = engine.sendPhase(sch, st, { rng: seededRng('d', 3, 's') }).state;
    ck(`[${key}] ★ 익일 새벽 05:00 도착 (22:40 → +380분)`, at(sch, st, 'elapsed') === day0 + 1
      && at(sch, st, 'hour') === 5 && at(sch, st, 'minute') === 0,
      `elapsed ${at(sch, st, 'elapsed')} ${at(sch, st, 'hour')}:${at(sch, st, 'minute')}`);
    // 새벽 03:00에 잠들어 "아침" — 무조건 +1일이 아니라 **같은 날** 아침 (29시간 수면 방지.
    // 옛 "다음 08:00" 공식의 미덕을 next-occurrence 공식이 지킨다)
    let st2 = engine.initState(sch); st2.meta.setupDone = true;
    st2.vars.skip_min = ((3 - at(sch, st2, 'hour') + 24) * 60 - at(sch, st2, 'minute')) % 1440;
    st2 = engine.outputPhase(sch, st2, {}, {}, { rng: seededRng('d', 4, 'o') }).state;
    const day2 = at(sch, st2, 'elapsed');
    st2 = engine.toggleAction(sch, st2, 'end_day').state;
    st2 = engine.sendPhase(sch, st2, { rng: seededRng('d', 5, 's') }).state;
    st2 = engine.outputPhase(sch, st2, { wake_at: '아침' }, {}, { rng: seededRng('d', 6, 'o') }).state;
    st2 = engine.sendPhase(sch, st2, { rng: seededRng('d', 7, 's') }).state;
    ck(`[${key}] ★ 새벽 03:00 취침 → 같은 날 아침 08:00 (29시간 수면 방지)`, at(sch, st2, 'elapsed') === day2
      && at(sch, st2, 'hour') === 8, `elapsed ${at(sch, st2, 'elapsed')} hour ${at(sch, st2, 'hour')}`);
    // 심야 — "자정 넘김"은 달력상 다음 날 01:00 (22:40에 누르면 같은 밤의 연장)
    let st4 = engine.initState(sch); st4.meta.setupDone = true;
    st4.vars.skip_min = (22 - at(sch, st4, 'hour')) * 60 + (40 - at(sch, st4, 'minute'));
    st4 = engine.outputPhase(sch, st4, {}, {}, { rng: seededRng('d', 11, 'o') }).state;
    const day4 = at(sch, st4, 'elapsed');
    st4 = engine.toggleAction(sch, st4, 'end_day').state;
    st4 = engine.sendPhase(sch, st4, { rng: seededRng('d', 12, 's') }).state;
    st4 = engine.outputPhase(sch, st4, { wake_at: '심야' }, {}, { rng: seededRng('d', 13, 'o') }).state;
    st4 = engine.sendPhase(sch, st4, { rng: seededRng('d', 14, 's') }).state;
    ck(`[${key}] 심야 = 달력상 다음 날 01:00`, at(sch, st4, 'elapsed') === day4 + 1
      && at(sch, st4, 'hour') === 1, `elapsed ${at(sch, st4, 'elapsed')} hour ${at(sch, st4, 'hour')}`);
    // 보조가 wake_at을 못 적은 턴 — 깃발이 남아 지시문 유지 (다음 턴 재시도)
    let st3 = engine.initState(sch); st3.meta.setupDone = true;
    st3 = engine.toggleAction(sch, st3, 'end_day').state;
    st3 = engine.sendPhase(sch, st3, { rng: seededRng('d', 8, 's') }).state;
    st3 = engine.outputPhase(sch, st3, {}, {}, { rng: seededRng('d', 9, 'o') }).state;
    const send3 = engine.sendPhase(sch, st3, { rng: seededRng('d', 10, 's') });
    ck(`[${key}] 보조 무응답 턴 — 깃발 유지 + 지시문 재주입`, st3.vars.day_break === true
      && send3.promptBlock.includes('아침으로 단정하지 마라'), '');
  }
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
