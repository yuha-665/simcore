const __P = (...p) => require('path').resolve(__dirname, ...p);
// 생존/정치 템플릿 실물 검증 + AI CSS 규격서 생성 검증
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { validateSchema } = SimCore.require('validate');
const { TEMPLATES } = SimCore.require('templates');
const { scopeCss } = SimCore.require('render');
const { seededRng } = SimCore.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const S = TEMPLATES.survival.schema;
const P = TEMPLATES.politics.schema;

// 정상 플레이 상태로 N턴 굴린다 (전송 → 응답 한 쌍이 1턴)
function run(T, turns, deltasFor = null, initVars = null) {
  let st = engine.initState(T);
  st.meta.setupDone = true;
  if (initVars) Object.assign(st.vars, initVars);
  const fired = [];
  const firedTurn = {}; // 이벤트가 "몇 턴째에" 처음 터졌는지 (누적 압박 검증용)
  for (let i = 0; i < turns; i++) {
    st = engine.sendPhase(T, st, { rng: seededRng('c', i, 'send') }).state;
    const o = engine.outputPhase(T, st, deltasFor ? deltasFor(st, i) : {}, {}, { rng: seededRng('c', i, 'out') });
    st = o.state;
    fired.push(...o.firedEvents);
    for (const id of o.firedEvents) if (firedTurn[id] === undefined) firedTurn[id] = i + 1;
  }
  return { st, fired, firedTurn, L: engine.makeLookup(T, st.vars) };
}
const armSend = (T, st, id, seed) =>
  engine.sendPhase(T, engine.toggleAction(T, st, id).state, { rng: seededRng('c', seed, 'send') });

// ── 신규 2종 스키마 유효성 ──
for (const [key, T] of [['생존', S], ['정치', P]]) {
  const v = validateSchema(T);
  ck(`${key}: 스키마 검증 통과`, v.ok, v.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
  ck(`${key}: 경고 없음`, v.warnings.length === 0, v.warnings.map((w) => `${w.path}: ${w.msg}`).join(' / '));
}

// ── 전 템플릿 스킨 일괄 검증 (기본 제공 CSS는 스스로 규격을 지켜야 한다) ──
{
  const SKINNED = Object.entries(TEMPLATES).filter(([k]) => k !== 'blank');
  ck('★ 빈 스키마 외 전 템플릿이 스킨을 동봉함',
    SKINNED.every(([, t]) => !!t.schema.statusUI?.customCSS),
    SKINNED.filter(([, t]) => !t.schema.statusUI?.customCSS).map(([k]) => k).join(', '));
  ck('빈 스키마는 일부러 맨몸 (시작점이므로)', !TEMPLATES.blank.schema.statusUI.customCSS, '');

  const seen = new Map();
  for (const [key, t] of SKINNED) {
    const css = t.schema.statusUI.customCSS;
    const scoped = scopeCss(css);
    ck(`${key}: 상태창 범위로 갇힘`,
      !/(^|\})\s*\.sim-(?!status)/.test(scoped) && scoped.includes('.sim-status'), scoped.slice(0, 100));
    ck(`${key}: 바깥 선택자 없음 (body/html/*)`, !/(^|\})\s*(body|html|\*|:root)\b/.test(css), '');
    ck(`${key}: 외부 리소스 없음`, !/@import|url\(\s*['"]?http/i.test(css), '');
    const hexes = css.match(/#[0-9a-zA-Z]*/g) || [];
    ck(`${key}: 색상 표기 전부 유효`,
      hexes.every((c) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)),
      hexes.filter((c) => !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)).join(' '));
    ck(`${key}: position:fixed/absolute 없음`, !/position\s*:\s*(fixed|absolute)/i.test(css), '');
    // 배경만 칠하고 글자색을 안 주면 반대 테마에서 안 읽힌다
    const root = (css.match(/\.sim-status\s*\{([^}]*)\}/) || [, ''])[1];
    ck(`${key}: 배경과 글자색을 함께 지정 (명암 테마 대응)`,
      /background/.test(root) && /(^|;)\s*color\s*:/.test(root), root.slice(0, 90));
    ck(`${key}: 스킨이 다른 템플릿과 겹치지 않음`, !seen.has(css), `${key} = ${seen.get(css)}`);
    seen.set(css, key);
  }

  // 실제 렌더에 스킨이 실려 나가는가
  for (const [key, t] of SKINNED) {
    const html = SimCore.require('render').renderStatusHtml(
      t.schema, engine.initState(t.schema), null, null, { includeStyle: true });
    const marker = (t.schema.statusUI.customCSS.match(/#[0-9a-fA-F]{6}/) || [''])[0];
    ck(`${key}: 렌더 결과에 스킨이 포함됨`, html.includes('<style>') && html.includes(marker), marker);
  }
}

// ── 생존: 파생 사슬이 정책에 반응하는가 ──
{
  const base = engine.initState(S);
  const L = (st) => engine.makeLookup(S, st.vars);
  ck('기본(보통): 실내 = -20 + 18 + 2 = 0', L(base)('indoor') === 0, String(L(base)('indoor')));
  ck('기본 체감은 쌀쌀함', L(base)('cold_grade') === '쌀쌀함', L(base)('cold_grade'));

  const hot = engine.initState(S); hot.vars.heat = '최대';
  const off = engine.initState(S); off.vars.heat = '정지';
  ck('난방 최대 → 실내 상승', L(hot)('indoor') > L(base)('indoor'), `${L(hot)('indoor')} vs ${L(base)('indoor')}`);
  ck('난방 정지 → 실내 급락', L(off)('indoor') === -18, String(L(off)('indoor')));
  ck('★ 트레이드오프: 따뜻할수록 석탄 소모 큼',
    L(hot)('coal_burn') > L(base)('coal_burn') && L(base)('coal_burn') > L(off)('coal_burn'),
    `${L(hot)('coal_burn')} / ${L(base)('coal_burn')} / ${L(off)('coal_burn')}`);
  ck('난방 정지는 체감이 치명적', L(off)('cold_grade') === '치명적', L(off)('cold_grade'));

  const thick = engine.initState(S); thick.vars.shelter = 5;
  ck('단열이 실내온도를 올림', L(thick)('indoor') > L(base)('indoor'), String(L(thick)('indoor')));

  const starve = engine.initState(S); starve.vars.ration = '중단';
  ck('배급 중단 → 식량 소모 0', L(starve)('food_need') === 0, String(L(starve)('food_need')));
  ck('배급 절반 = 정상의 절반', (() => {
    const h2 = engine.initState(S); h2.vars.ration = '절반';
    return L(h2)('food_need') === L(base)('food_need') / 2;
  })(), '');
  ck('잔여일 계산 정상', L(base)('coal_left') === Math.floor(400 / 33), String(L(base)('coal_left')));
}

// ── 생존: 방치하면 실제로 무너지는가 (압박이 실재하는지) ──
{
  const { st, fired, L } = run(S, 30);
  ck('★ 방치 30일 → 석탄 고갈', st.vars.coal === 0, String(st.vars.coal));
  ck('★ 방치 30일 → 식량 고갈', st.vars.food === 0, String(st.vars.food));
  ck('연료 소진 이벤트 발동', fired.includes('fuel_out'), JSON.stringify([...new Set(fired)]));
  ck('★ enum을 수식으로 바꿔치기 성공 (heat → 정지)', st.vars.heat === '정지', st.vars.heat);
  ck('굶주림 이벤트 발동', fired.includes('starving'), '');
  ck('★ 방치의 결말은 붕괴', st.vars.collapsed === true, JSON.stringify(st.vars));
  ck('붕괴는 즉시가 아니라 서서히 (8일은 버팀)',
    run(S, 8).st.collapsed !== true, '');
}

// ── 생존: 아껴 쓰면 더 오래 버티는가 ──
{
  // 난방·배급은 updater.allow에 없다(=보조모델이 못 건드림). 플레이어 결정이므로 초기 상태로 준다.
  const a = run(S, 14);
  const b = run(S, 14, null, { heat: '약', ration: '절반' });
  ck('정책 변수는 보조모델이 못 바꾼다 (플레이어 전용)',
    run(S, 2, () => ({ heat: '최대', ration: '넉넉히' })).st.vars.heat === '보통', '');
  ck('★ 아껴 쓰면 물자가 더 남는다',
    (b.st.vars.coal + b.st.vars.food) > (a.st.vars.coal + a.st.vars.food),
    `절약 ${b.st.vars.coal}+${b.st.vars.food} vs 방치 ${a.st.vars.coal}+${a.st.vars.food}`);
  ck('단, 아끼면 불만이 더 쌓인다', b.st.vars.discontent >= a.st.vars.discontent,
    `절약 ${b.st.vars.discontent} vs 방치 ${a.st.vars.discontent}`);
}

// ── 생존: 액션이 실제로 상태를 바꾸는가 ──
{
  let st = engine.initState(S); st.meta.setupDone = true;
  const s = armSend(S, st, 'insulate', 3);
  ck('단열 보강 → 등급 상승 + 석탄 지불', s.state.vars.shelter === 2 && s.state.vars.coal === 340,
    `${s.state.vars.shelter} / ${s.state.vars.coal}`);
  const s2 = armSend(S, st, 'stoke', 4);
  ck('화로 최대 액션이 enum을 바꿈', s2.state.vars.heat === '최대', s2.state.vars.heat);
  const s3 = armSend(S, st, 'mine', 5);
  ck('채탄 → 석탄 증가, 환자 증가', s3.state.vars.coal > 400 && s3.state.vars.sick === 2,
    `${s3.state.vars.coal} / ${s3.state.vars.sick}`);

  const noFuel = engine.initState(S); noFuel.vars.coal = 0;
  ck('석탄 0이면 화로 최대 잠김',
    engine.actionAvailability(S, noFuel, S.actions.find((a) => a.id === 'stoke')).ok === false, '');
  const weak = engine.initState(S); weak.vars.sick = 38;
  ck('인력 없으면 채탄 잠김',
    engine.actionAvailability(S, weak, S.actions.find((a) => a.id === 'mine')).ok === false, '');
}

// ── 정치: 법안 표결 2단 구조 ──
{
  let st = engine.initState(P); st.meta.setupDone = true;
  const L0 = engine.makeLookup(P, st.vars);
  ck('연합 지지 = 4세력 평균', L0('coalition') === Math.round((40 + 40 + 50 + 55) / 4), String(L0('coalition')));
  ck('가결선이 5~95로 갇힘', L0('bill_odds') >= 5 && L0('bill_odds') <= 95, String(L0('bill_odds')));

  let 가결 = null, 부결 = null;
  for (let i = 0; i < 200 && !(가결 && 부결); i++) {
    const r = armSend(P, st, 'submit_bill', i).state.vars;
    if (r.bill_result === '가결' && !가결) 가결 = r;
    if (r.bill_result === '부결' && !부결) 부결 = r;
  }
  ck('가결·부결 양쪽 다 발생', !!(가결 && 부결), `가결${!!가결} 부결${!!부결}`);
  const one = armSend(P, st, 'submit_bill', 7).state.vars;
  ck('주사위 범위 1~100', one.bill_roll >= 1 && one.bill_roll <= 100, String(one.bill_roll));
  ck('★ 결과가 가결선과 정확히 일치',
    one.bill_result === (one.bill_roll <= L0('bill_odds') ? '가결' : '부결'),
    `roll ${one.bill_roll} vs odds ${L0('bill_odds')} → ${one.bill_result}`);
  ck('표결에 정치자본 소모', one.capital === 35, String(one.capital));
  ck('표결 지시문이 모델에 나감',
    armSend(P, st, 'submit_bill', 7).promptBlock.includes('뒤집지 말고'), '');

  // 결과가 다음 응답에서 소비되어 되돌아가는가 (안 그러면 매턴 재발동)
  const after = engine.outputPhase(P, armSend(P, st, 'submit_bill', 7).state, {}, {},
    { rng: seededRng('c', 1, 'out') });
  ck('표결 결과가 이벤트로 소비됨', after.state.vars.bill_result === '없음', after.state.vars.bill_result);
  ck('가결/부결 이벤트가 실제로 발동',
    after.firedEvents.includes('bill_passed') || after.firedEvents.includes('bill_failed'),
    JSON.stringify(after.firedEvents));
  const twice = engine.outputPhase(P, after.state, {}, {}, { rng: seededRng('c', 2, 'out') });
  ck('★ 다음 턴엔 재발동하지 않음',
    !twice.firedEvents.includes('bill_passed') && !twice.firedEvents.includes('bill_failed'),
    JSON.stringify(twice.firedEvents));
}

// ── 정치: 시한폭탄(스캔들) ──
{
  const { fired, firedTurn } = run(P, 25);
  ck('★ 리스크가 쌓여 스캔들이 터짐', fired.includes('scandal_breaks'), JSON.stringify([...new Set(fired)]));
  ck('★ 초반엔 안 터진다 — 뇌관이 쌓일 시간이 필요', firedTurn.scandal_breaks >= 8,
    `${firedTurn.scandal_breaks}주차에 발동`);

  // 자본이 충분하면 수습되는가
  let s2 = engine.initState(P); s2.meta.setupDone = true;
  s2.vars.risk = 75; s2.vars.capital = 90;
  const o1 = engine.outputPhase(P, s2, {}, {}, { rng: seededRng('c', 1, 'out') });
  ck('리스크 70 넘으면 즉시 터짐', o1.firedEvents.includes('scandal_breaks'), JSON.stringify(o1.firedEvents));
  ck('터지면 지지율·언론이 함께 빠짐', o1.state.vars.approval < 45 && o1.state.vars.press < 50,
    `${o1.state.vars.approval} / ${o1.state.vars.press}`);
  const o2 = engine.outputPhase(P, o1.state, {}, {}, { rng: seededRng('c', 2, 'out') });
  ck('자본이 넉넉하면 수습됨', o2.state.vars.in_scandal === false, JSON.stringify(o2.firedEvents));
  ck('수습에 자본을 크게 씀', o2.state.vars.capital < 90, String(o2.state.vars.capital));
}

// ── 정치: 가장 냉담한 세력 판별 ──
{
  const mk = (o) => { const s = engine.initState(P); Object.assign(s.vars, o); return engine.makeLookup(P, s.vars)('weakest'); };
  ck('재계가 최저면 재계', mk({ biz: 10 }) === '재계', mk({ biz: 10 }));
  ck('노동계가 최저면 노동계', mk({ labor: 10 }) === '노동계', mk({ labor: 10 }));
  ck('언론이 최저면 언론', mk({ press: 10 }) === '언론', mk({ press: 10 }));
  ck('당내가 최저면 당내', mk({ party: 10 }) === '당내', mk({ party: 10 }));
}

// ── 정치: 세력 회동은 반대편을 잃게 되어 있는가 ──
{
  let st = engine.initState(P); st.meta.setupDone = true;
  const b = armSend(P, st, 'meet_biz', 1).state.vars;
  ck('★ 재계를 얻으면 노동계를 잃는다', b.biz > 40 && b.labor < 40, `재계 ${b.biz} / 노동계 ${b.labor}`);
  const l = armSend(P, st, 'meet_labor', 1).state.vars;
  ck('★ 반대도 성립', l.labor > 40 && l.biz < 40, `노동계 ${l.labor} / 재계 ${l.biz}`);
  ck('재계 회동은 리스크를 남김', b.risk > 10, String(b.risk));
}

// ── AI CSS 규격서 ──
{
  const seg = src.slice(src.indexOf('const CSS_SPEC_CLASSES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
  const build = new Function('validateSchema', 'renderStatusHtml', 'engine',
    seg + '\nreturn buildCssSpecPrompt;')(validateSchema, SimCore.require('render').renderStatusHtml, engine);

  const spec = build(S);
  ck('규격서: 채워 넣을 자리가 있음', spec.includes('내가 원하는 분위기'), '');
  ck('규격서: CSS만 출력하라고 못박음', spec.includes('**CSS만** 출력'), '');
  ck('규격서: 스코핑 사실을 알려줌', spec.includes('.sim-status` 안쪽으로 제한'), '');
  ck('규격서: 외부 리소스 금지 명시', spec.includes('@import'), '');
  ck('규격서: fixed 금지 명시', spec.includes('position: fixed'), '');
  ck('규격서: keyframes는 허용이라고 알려줌', spec.includes('@keyframes'), '');
  for (const cls of ['.sim-status', '.sim-bar-fill', '.sim-badge', '.sim-action', '.sim-log'])
    ck(`규격서: ${cls} 설명 포함`, spec.includes(cls), '');
  ck('규격서: 목록 밖 클래스 금지 경고', spec.includes('없는 클래스는 만들지 마세요'), '');
  ck('★ 규격서: 이 봇의 실제 골격이 들어감',
    spec.includes('class="sim-status"') && spec.includes('생존자'), '');
  ck('규격서: 골격에 CSS가 딸려오지 않음 (규격만 깔끔히)', !spec.includes('<style>'), '');
  ck('규격서: 액션 버튼도 골격에 포함', spec.includes('sim-action'), '');

  const blank = build(SimCore.require('templates').BLANK);
  ck('빈 스키마여도 규격서는 생성됨', blank.includes('.sim-status'), '');
  const broken = build({ simcore: '0.1', meta: {}, vars: [{ id: '!!', type: 'nope' }] });
  ck('깨진 스키마여도 터지지 않음', typeof broken === 'string' && broken.includes('.sim-status'), '');
}

// ── 전 템플릿 회귀 ──
{
  let bad = null;
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const v = validateSchema(t.schema);
    if (!v.ok) bad = `${k}: ${v.errors[0].path} ${v.errors[0].msg}`;
    if (v.warnings.length) bad = `${k}: 경고 ${v.warnings[0].path} ${v.warnings[0].msg}`;
  }
  ck('전 템플릿 유효 + 무경고', !bad, bad);
  ck('신규 2종이 목록에 등록됨', !!TEMPLATES.survival && !!TEMPLATES.politics, '');
  ck('템플릿 총 16종 (v0.69 아이돌 프로듀스 추가)', Object.keys(TEMPLATES).length === 16, String(Object.keys(TEMPLATES).length));
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
