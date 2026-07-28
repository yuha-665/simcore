const __P = (...p) => require('path').resolve(__dirname, ...p);
// 버튜버 템플릿 실물 검증 — 이 템플릿이 가르치려는 네 가지가 실제로 작동하는가
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const { diagnose } = SC.require('diagnose');
const { renderStatusHtml } = SC.require('render');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const cp = (o) => JSON.parse(JSON.stringify(o));
const V = TEMPLATES.vtuber.schema;

// 전송 → 응답 한 쌍이 1턴
function run(T, turns, { vars, policy } = {}) {
  let st = engine.initState(T);
  st.meta.setupDone = true;
  if (vars) Object.assign(st.vars, vars);
  const fired = [], hist = [];
  for (let i = 0; i < turns; i++) {
    if (policy) {
      const id = policy(st, i);
      if (id) { const t = engine.toggleAction(T, st, id); if (t.armed) st = t.state; }
    }
    st = engine.sendPhase(T, st, { rng: seededRng('v', i, 'send') }).state;
    const o = engine.outputPhase(T, st, {}, {}, { rng: seededRng('v', i, 'out') });
    st = o.state;
    fired.push(...o.firedEvents);
    hist.push({ ...st.vars });
  }
  return { st, fired, hist, L: engine.makeLookup(T, st.vars) };
}

// ── 등록 & 형태 ──
{
  ck('템플릿 목록에 등록됨', !!TEMPLATES.vtuber, Object.keys(TEMPLATES).join(','));
  ck('라벨에 장르가 드러남', /버튜버/.test(TEMPLATES.vtuber.label), TEMPLATES.vtuber.label);
  const v = validateSchema(V);
  ck('검증 통과 + 무경고', v.ok && v.warnings.length === 0,
    [...v.errors, ...v.warnings].map((e) => e.path + ' ' + e.msg).join('; '));
  ck('CSS 스킨이 있음', !!V.statusUI.customCSS, '');
  // #3a4straight 같은 오타를 세 번 냈다 — 이제 자동으로 잡는다
  const badHex = (V.statusUI.customCSS.match(/#[0-9a-zA-Z]+/g) || []).filter((h) => !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h));
  ck('CSS 색상값이 전부 유효한 hex', badHex.length === 0, badHex.join(', '));
  ck('액션 라벨이 전부 이모지로 시작',
    V.actions.every((a) => /^\p{Extended_Pictographic}/u.test(a.label)),
    V.actions.filter((a) => !/^\p{Extended_Pictographic}/u.test(a.label)).map((a) => a.label).join(', '));
}

// ── ① 랜덤 숫자 + 파생 이름 = 매 턴 바뀌는 외부 환경 ──
{
  const seed = V.vars.find((x) => x.id === 'trend_seed');
  const trend = V.derived.find((d) => d.id === 'trend');
  const concept = V.vars.find((x) => x.id === 'concept');
  ck('★ 유행은 숫자로 굴리고 파생으로 이름을 붙인다', !!seed && !!trend && seed.type === 'int', '');
  ck('굴림 범위가 컨셉 가짓수와 정확히 일치', seed.min === 1 && seed.max === concept.enum.length,
    `${seed.min}~${seed.max} vs enum ${concept.enum.length}개`);

  // 파생이 내는 이름이 전부 concept enum 안에 있어야 switch_concept이 성립한다
  const names = new Set();
  for (let n = seed.min; n <= seed.max; n++) {
    const st = engine.initState(V);
    st.vars.trend_seed = n;
    names.add(engine.makeLookup(V, st.vars)('trend'));
  }
  ck('★ 굴림값 5가지가 서로 다른 이름 5개로 매핑됨', names.size === 5, [...names].join(','));
  ck('★ 그 이름들이 전부 컨셉 enum 안에 있음 (컨셉 전환이 성립하는 조건)',
    [...names].every((n) => concept.enum.includes(n)),
    [...names].filter((n) => !concept.enum.includes(n)).join(','));

  // 실제로 굴러서 값이 바뀌는가
  const { hist } = run(V, 60);
  ck('60턴 안에 유행이 실제로 여러 번 바뀐다',
    new Set(hist.map((h) => h.trend_seed)).size >= 3,
    [...new Set(hist.map((h) => h.trend_seed))].join(','));

  // 컨셉 전환 액션은 파생 값을 그대로 변수에 대입한다
  const sw = V.actions.find((a) => a.id === 'switch_concept');
  ck('★ 컨셉 전환이 파생 값을 그대로 대입', sw.effects.some((f) => f.set === 'concept' && f.expr === 'trend'), '');
  const st2 = engine.initState(V);
  st2.meta.setupDone = true;
  st2.vars.trend_seed = 4;                        // ASMR
  const armed = engine.toggleAction(V, st2, 'switch_concept');
  const after = engine.sendPhase(V, armed.state, { rng: seededRng('v', 0, 's') }).state;
  ck('★ 눌렀더니 컨셉이 유행을 따라간다 (enum 대입이 실제로 통과)', after.vars.concept === 'ASMR', after.vars.concept);
  ck('대신 기존 팬을 잃는다', after.vars.subs < st2.vars.subs, `${st2.vars.subs} → ${after.vars.subs}`);
}

// ── ② 비율 지표라서 규모가 커져도 압박이 유지된다 ──
{
  const look = (vars) => engine.makeLookup(V, { ...engine.initState(V).vars, ...vars });
  const small = look({ subs: 120, hype: 0 });
  const huge = look({ subs: 50000, hype: 0 });
  ck('★ 동접은 규모를 따라 커진다', huge('ccv') > small('ccv') * 100, `${small('ccv')} vs ${huge('ccv')}`);
  ck('★ 시청률은 규모와 무관하다 (멘탈 판정이 대형 채널에서 무력해지지 않는 이유)',
    Math.abs(huge('engagement') - small('engagement')) <= 2,
    `소형 ${small('engagement')}% vs 대형 ${huge('engagement')}%`);

  const hyped = look({ subs: 50000, hype: 100 });
  ck('시청률은 화제성에는 반응한다', hyped('engagement') > huge('engagement') + 5,
    `화제0 ${huge('engagement')}% → 화제100 ${hyped('engagement')}%`);

  // 컨디션은 곱하기라 대형 채널에서도 아프다
  const wrecked = look({ subs: 50000, hype: 60, energy: 0, mental: 10 });
  const fresh = look({ subs: 50000, hype: 60, energy: 100, mental: 100 });
  ck('★ 컨디션이 동접을 곱으로 깎는다 (더하기였다면 대형 채널에서 무시됐을 것)',
    wrecked('ccv') < fresh('ccv') * 0.75, `망가짐 ${wrecked('ccv')} vs 멀쩡 ${fresh('ccv')}`);
}

// ── ③ hold 액션의 `when` 안전장치 ──
{
  const go = V.actions.find((a) => a.id === 'go_hard');
  ck('풀타임 방송은 지속 정책(hold)', go.mode === 'hold', go.mode);
  ck('★ 번아웃이면 효과가 멈추는 조건이 걸려 있음', go.when === 'not burnout', String(go.when));

  // 켜 두면 방송 시간이 오르고, 무리하면 번아웃이 와서 스스로 되돌아온다.
  // (최종값이 아니라 궤적으로 봐야 한다 — 8턴이면 이미 안전장치가 돌아간 뒤다)
  const on = run(V, 10, { policy: () => 'go_hard' });
  const hrs = on.hist.map((h) => h.stream_hours);
  ck('★ 켜 두면 방송 시간이 실제로 늘어난다',
    Math.max(...hrs) > engine.initState(V).vars.stream_hours, hrs.join(','));
  ck('★ 계속 켜 두면 번아웃까지 간다', on.fired.includes('burnout_on'), hrs.join(','));
  ck('★ 번아웃이 오면 방송 시간이 스스로 최소치로 돌아온다',
    hrs[hrs.length - 1] === 3 && Math.max(...hrs) >= 8, hrs.join(','));

  // 번아웃 상태에서는 켜져 있어도 시간이 안 오른다
  let st = engine.initState(V);
  st.meta.setupDone = true;
  st = engine.toggleAction(V, st, 'go_hard').state;
  st.vars.burnout = true;
  st.vars.stream_hours = 3;
  const blocked = engine.sendPhase(V, st, { rng: seededRng('v', 0, 's') }).state;
  ck('★ 번아웃 중에는 켜져 있어도 시간이 안 오른다 (켜 놓고 잊어도 안 죽는 이유)',
    blocked.vars.stream_hours === 3, String(blocked.vars.stream_hours));
  ck('무장 상태는 유지된다 (회복하면 알아서 재개)', !!blocked.meta.armed.go_hard, '');

  // 번아웃 자체에 탈출구가 있는가
  const bo = V.rules.events.find((e) => e.id === 'burnout_on');
  ck('★ 번아웃이 방송 시간을 강제로 되돌린다 (탈출구)',
    bo.effects.some((f) => f.set === 'stream_hours'), JSON.stringify(bo.effects));
  const off = V.rules.events.find((e) => e.id === 'burnout_off');
  ck('회복 문턱이 진입 문턱보다 높다 (깜빡임 방지)',
    Number(/\d+/.exec(off.when)[0]) > Number(/\d+/.exec(bo.when)[0]),
    `${bo.when} / ${off.when}`);
}

// ── ④ 조건부 비용 ──
{
  const clips = V.actions.find((a) => a.id === 'make_clips');
  const e = clips.effects.find((f) => f.set === 'energy');
  ck('★ 클립 편집 비용이 편집자 유무로 갈린다', /editor/.test(e.expr), e.expr);

  const cost = (editor) => {
    let st = engine.initState(V);
    st.meta.setupDone = true;
    st.vars.editor = editor;
    st.vars.energy = 80;
    const before = st.vars.energy;
    st = engine.sendPhase(V, engine.toggleAction(V, st, 'make_clips').state, { rng: seededRng('v', 0, 's') }).state;
    return before - st.vars.energy;
  };
  ck('★ 편집자가 있으면 실제로 더 싸다', cost(1) < cost(0), `없음 -${cost(0)} vs 있음 -${cost(1)}`);
  ck('편집자를 잃을 수도 있다 (단조 자원 방지)',
    V.rules.randomEvents.table.some((x) => x.effects?.some((f) => f.set === 'editor' && /-/.test(f.expr))), '');
}

// ── 자원 사슬이 실제로 이어지는가 ──
{
  const L = engine.makeLookup(V, engine.initState(V).vars);
  for (const id of ['trend', 'fit', 'condition', 'ccv', 'engagement', 'donation', 'cost', 'net', 'tier'])
    ck(`파생 '${id}' 계산됨`, typeof L(id) === 'number' || typeof L(id) === 'string', String(L(id)));
  ck('순익 = 후원 - 지출', L('net') === L('donation') - L('cost'), `${L('donation')} - ${L('cost')} = ${L('net')}`);
  ck('유행이 맞으면 적중 보너스가 크다',
    engine.makeLookup(V, { ...engine.initState(V).vars, concept: '게임', trend_seed: 2 })('fit')
    > engine.makeLookup(V, { ...engine.initState(V).vars, concept: '게임', trend_seed: 3 })('fit'), '');

  // 유행 적중이 동접으로 이어지는가
  const hit = engine.makeLookup(V, { ...engine.initState(V).vars, subs: 3000, concept: '게임', trend_seed: 2 })('ccv');
  const miss = engine.makeLookup(V, { ...engine.initState(V).vars, subs: 3000, concept: '게임', trend_seed: 3 })('ccv');
  ck('★ 유행 적중이 동접을 실제로 끌어올린다', hit > miss * 1.2, `적중 ${hit} vs 빗나감 ${miss}`);
}

// ── 난이도: 방치하면 죽고 놀면 산다 ──
{
  const r = diagnose(V, { turns: 40, runs: 6 });
  ck('진단이 끝까지 돈다', r.ran, '');
  ck('★ 방치하면 은퇴한다 (긴장이 있다)', r.stats.idleSurvive === 0, `${r.stats.idleSurvive}/6`);
  ck('★ 액션을 쓰면 살아남는다 (이길 방법이 있다)', r.stats.playSurvive === 6, `${r.stats.playSurvive}/6`);
  ck('패배 변수를 진단이 찾아냄', r.stats.loseVar === 'career_over', String(r.stats.loseVar));
  ck('★ 죽은 이벤트 없음 (전부 실제로 발동)', r.stats.deadEvents === 0, String(r.stats.deadEvents));
  ck('★ 함정 액션 없음', r.findings.filter((f) => f.tag === '함정 액션').length === 0,
    r.findings.filter((f) => f.tag === '함정 액션').map((f) => f.text).join(' / '));
  ck('★ 못 쓰는 액션 없음', r.findings.filter((f) => f.tag === '못 쓰는 액션').length === 0,
    r.findings.filter((f) => f.tag === '못 쓰는 액션').map((f) => f.text).join(' / '));
  ck('🔴 없음', r.findings.filter((f) => f.sev === 'high').length === 0,
    r.findings.filter((f) => f.sev === 'high').map((f) => f.text).join(' / '));
  // 남는 지적은 AI가 채우는 텍스트 변수뿐 — 모든 템플릿이 공유하는 한계다
  ck('남은 🟡는 AI가 채우는 변수 지적뿐',
    r.findings.filter((f) => f.sev === 'mid').every((f) => f.tag === '안 움직임'),
    r.findings.filter((f) => f.sev === 'mid' && f.tag !== '안 움직임').map((f) => f.tag).join(', '));
  ck('휴방이 생존에 가장 크게 기여한다', r.stats.actionImpact[0].id === 'rest_day',
    r.stats.actionImpact.map((a) => `${a.id}:${a.delta.toFixed(1)}`).join(' '));
}

// ── 프리셋 3종 ──
{
  for (const p of V.setup.presets) {
    const s = cp(V);
    let missing = null;
    for (const [id, val] of Object.entries(p.set)) {
      const v = s.vars.find((x) => x.id === id);
      if (!v) { missing = id; continue; }
      v.init = val;
    }
    ck(`프리셋 '${p.id}' 대상 변수가 전부 존재`, !missing, String(missing));
    const vv = validateSchema(s);
    ck(`프리셋 '${p.id}' 적용해도 유효`, vv.ok && vv.warnings.length === 0,
      [...vv.errors, ...vv.warnings].map((e) => e.msg).join('; '));
    const r = diagnose(s, { turns: 40, runs: 6 });
    ck(`프리셋 '${p.id}' 🔴 없음`, r.findings.filter((f) => f.sev === 'high').length === 0,
      r.findings.filter((f) => f.sev === 'high').map((f) => f.text).join(' / '));
    ck(`프리셋 '${p.id}' 플레이하면 대체로 산다`, r.stats.playSurvive >= 5, `${r.stats.playSurvive}/6`);
  }
  ck('★ 프리셋 난이도가 서로 다르다 (방치 생존율로 확인)', (() => {
    const s = cp(V);
    for (const [id, val] of Object.entries(V.setup.presets[1].set)) {
      const v = s.vars.find((x) => x.id === id); if (v) v.init = val;
    }
    return diagnose(s, { turns: 40, runs: 6 }).stats.idleSurvive > diagnose(V, { turns: 40, runs: 6 }).stats.idleSurvive;
  })(), '');
}

// ── AI에게 주는 권한 ──
{
  const allowed = new Set(V.updater.allow.map((a) => a.id));
  for (const id of ['subs', 'ccv', 'day', 'editor', 'career_over'])
    ck(`★ '${id}'는 AI에게 안 준다 (시스템이 계산하는 결과값)`, !allowed.has(id), '');
  for (const id of ['mental', 'heat', 'hype', 'regulars'])
    ck(`'${id}'는 AI가 서사에 맞춰 흔들 수 있다`, allowed.has(id), '');
  ck('숫자 권한에 전부 한도가 걸려 있음',
    V.updater.allow.filter((a) => V.vars.find((x) => x.id === a.id)?.type === 'int')
      .every((a) => a.maxDelta != null || a.maxGain != null || a.maxLoss != null),
    V.updater.allow.filter((a) => V.vars.find((x) => x.id === a.id)?.type === 'int' && a.maxDelta == null)
      .map((a) => a.id).join(', '));
  ck('가이드가 결과값을 건드리지 말라고 못박음', /절대 건드리지 마라/.test(V.updater.guide), '');
}

// ── 렌더 ──
{
  const { st } = run(V, 12, { vars: { nickname: '별밤', catchphrase: '오늘도 별 보러 오셨나요', regulars: ['달토끼', '새벽3시', '고양이집사'] } });
  const send = engine.sendPhase(V, st, { rng: seededRng('v', 99, 's') });
  ck('프롬프트 블록에 미치환 자리표시자가 없음',
    !/\{[a-z_]+\}/.test(send.promptBlock), (send.promptBlock.match(/\{[a-z_]+\}/g) || []).join(','));
  ck('프롬프트에 NaN/undefined 없음', !/NaN|undefined/.test(send.promptBlock), '');
  ck('유행 적중/빗나감이 한쪽은 반드시 뜬다', /✅적중|❌빗나감/.test(send.promptBlock), '');
  ck('단골 지시문이 3명부터 붙는다', /단골들/.test(send.promptBlock), '');

  const html = renderStatusHtml(V, st);
  ck('상태창 렌더 정상', html.length > 500 && !/NaN|undefined/.test(html), String(html.length));
  ck('상태창에 미치환 자리표시자 없음', !/\{[a-z_]+\}/.test(html), '');
  ck('접히는 그룹이 있음 (수익/팬은 기본 접힘)',
    V.statusUI.groups.filter((g) => g.visibility === 'collapsed').length === 2, '');
  const shown = new Set(V.statusUI.groups.flatMap((g) => g.items.map((i) => i.var)));
  ck('패배 상태가 상태창에 뜬다', shown.has('career_over'), '');
  ck('굴림값(trend_seed)은 안 보여준다 — 이름만 보여준다', !shown.has('trend_seed') && shown.has('trend'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
