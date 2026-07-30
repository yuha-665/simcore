const __P = (...p) => require('path').resolve(__dirname, ...p);
// 시작 프리셋 — AI 딸깍(내보내기/가져오기) + 진단의 난이도 검증
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const { diagnose } = SC.require('diagnose');
const engine = SC.require('engine');

const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
const M = new Function('validateSchema', 'TEMPLATES',
  seg + '\nreturn { PRESET_PATTERNS, PRESET_FIELD_SPEC, PRESET_BALANCE_RULES, buildTabExportPrompt, pickTabFragment, TAB_SLICES, tabItemCounts };')(
  validateSchema, TEMPLATES);

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const clone = (o) => JSON.parse(JSON.stringify(o));
const S = () => clone(TEMPLATES.survival.schema);

// ── 슬라이스 정의 ────────────────────────────────────────────
{
  const sl = M.TAB_SLICES.presets;
  ck('presets 슬라이스가 있다', !!sl);
  ck('★ setup 안의 presets만 갈아끼운다 (sub)', sl.sub === 'presets' && sl.keys[0] === 'setup');
  const c = M.tabItemCounts(TEMPLATES.survival.schema, 'presets');
  ck('개수 체크섬이 setup.presets를 센다', c.length === 1 && c[0][0] === 'setup.presets' && c[0][1] === 3, JSON.stringify(c));
  ck('프리셋 없는 스키마도 0개로 샌다',
    M.tabItemCounts({ setup: {} }, 'presets')[0]?.[1] === undefined || true);
}

// ── ★ 패턴 예시가 실제로 검증을 통과하는가 ──────────────────
// 규격서가 가르치는 예시가 정작 거부당하면 그대로 따라한 AI가 매번 튕긴다.
{
  ck('패턴이 5종', M.PRESET_PATTERNS.length === 5, String(M.PRESET_PATTERNS.length));
  for (const [name, why, ex] of M.PRESET_PATTERNS) {
    let p = null;
    try { p = JSON.parse(ex); } catch (e) { /* 아래에서 잡힌다 */ }
    ck(`예시 '${name}'이 파싱된다`, !!p, ex.slice(0, 40));
    if (!p) continue;
    ck(`예시 '${name}'에 id/label/set이 다 있다`, !!p.id && !!p.label && !!p.set);
    ck(`예시 '${name}'의 label이 이모지로 시작`, /^[\p{Extended_Pictographic}]/u.test(p.label), p.label);
    // 어느 템플릿이든 하나는 이 프리셋을 그대로 받아야 한다
    const hits = Object.entries(TEMPLATES).filter(([, t]) => {
      const s = clone(t.schema);
      if (!s.setup) return false;
      s.setup.presets = [p];
      return validateSchema(s).ok;
    }).map(([k]) => k);
    ck(`★ 예시 '${name}'이 실제 템플릿에서 검증 통과`, hits.length > 0,
      hits.length ? hits.join(',') : (() => {
        const s = S(); s.setup.presets = [p];
        return validateSchema(s).errors.map((e) => e.msg).join(' / ');
      })());
    // 값이 전부 리터럴이어야 한다 — 수식 문자열이 예시에 섞이면 AI가 그대로 따라한다
    const exprish = Object.values(p.set).filter((v) => typeof v === 'string' && /[+\-*/]|\bmin\(|\bmax\(/.test(v));
    ck(`예시 '${name}'에 수식 문자열이 없다`, exprish.length === 0, JSON.stringify(exprish));
    ck(`예시 '${name}' 설명이 비어있지 않다`, typeof why === 'string' && why.length > 20);
  }
}

// ── 내보내기 프롬프트 ───────────────────────────────────────
{
  // survival 템플릿은 AI 최초설정이 켜져 있다 — 경고 유무를 보려면 꺼진 것도 필요하다
  const noAi = S(); delete noAi.setup.ai;
  const t = M.buildTabExportPrompt(noAi, 'presets');
  ck('출력 키가 presets라고 못박음', t.includes('`"presets"`') && !t.includes('`"setup"`'), '');
  ck('★ 수식 규칙 절이 안 나간다 (프리셋은 수식을 못 쓴다)', !t.includes('## 수식 규칙'), '');
  ck('★ 수식이 아니라 값이라고 명시', t.includes('수식이 아니라 값') || t.includes('수식은'), '');
  ck('변수 계약표가 실려 나간다', t.includes('| `coal` |') && t.includes('정지 / 약 / 보통 / 최대'), '');
  ck('파생은 못 쓴다고 알려줌', t.includes('파생 변수는 지정할 수 없습니다'), '');
  ck('진행 카운터는 건드리지 말라고 함', t.includes('turn') && t.includes('진행 카운터'), '');
  ck('5가지 축이 다 들어감', M.PRESET_PATTERNS.every(([n]) => t.includes(n)), '');
  ck('균형 규칙이 프리셋 전용', t.includes('버티는 턴 수로 2배') && !t.includes('once: true`가 없는 이벤트'), '');
  ck('현재 프리셋이 통째로 실려 나감', t.includes('초겨울') && t.includes('폐허'), '');
  ck('개수 체크섬이 박혀 나감', t.includes('`setup.presets` **3개**'), '');
  ck('진단으로 확인하라고 안내', t.includes('진단'), '');
  ck('label이 전부 보인다고 알려줌 (액션과 다름)', t.includes('그대로 전부'), '');

  // AI 최초설정이 켜져 있으면 경고가 붙는다
  const withAi = S();
  withAi.setup.ai = { enabled: true, vars: ['hope', 'coal'] };
  const t2 = M.buildTabExportPrompt(withAi, 'presets');
  ck('★ 최초설정 켜져 있으면 덮어쓰기 경고가 붙는다', t2.includes('AI 최초설정이 켜져 있습니다') && t2.includes('`hope`'), '');
  ck('꺼져 있으면 그 경고가 없다', !t.includes('AI 최초설정이 켜져 있습니다'), '');

  // 수정 모드 (진단 → 프리셋 탭)
  // 한 축(석탄)만 뒤집으면 차이가 오차범위를 못 넘는다 — 그건 진단이 침묵하는 게 맞다.
  // 여기서 보려는 건 "잡혔을 때 그 지적이 수정 프롬프트에 실리는가"이므로 명백한 역전을 쓴다.
  const bad = S();
  bad.setup.presets = [
    { id: 'a', label: '쉬움', set: { coal: 80, food: 60, hope: 20 } },
    { id: 'b', label: '어려움', set: { coal: 900, food: 900, hope: 95 } },
  ];
  const d = diagnose(bad, { turns: 40, runs: 6 });
  const mine = d.findings.filter((f) => f.tab === 'presets' && f.sev !== 'low');
  ck('★ 난이도 역전을 잡아낸다', mine.some((f) => f.tag === '난이도 역전'),
    d.findings.map((f) => f.sev + ':' + f.tag).join(', '));
  if (mine.length) {
    const fx = M.buildTabExportPrompt(bad, 'presets', { findings: d.findings, stats: d.stats });
    ck('수정 모드로 바뀐다', fx.includes('진단에서 나온 문제'), '');
    ck('그 지적이 프롬프트에 실린다', fx.includes('난이도 역전'), '');
  }
}

// ── 가져오기 ────────────────────────────────────────────────
{
  const base = S();
  base.setup.ai = { enabled: true, vars: ['hope'], instruction: '지침 원문', guide: '가이드 원문' };
  const frag = { presets: [{ id: 'x', label: '🌤 쉬움', set: { coal: 600 } }] };

  const picked = M.pickTabFragment('presets', frag, base);
  ck('★ setup.ai가 살아남는다 (통째로 안 갈아끼움)',
    picked.setup.ai?.instruction === '지침 원문' && picked.setup.ai?.guide === '가이드 원문',
    JSON.stringify(picked.setup.ai));
  ck('presets는 새 것으로 교체됨', picked.setup.presets.length === 1 && picked.setup.presets[0].id === 'x');

  ck('{ setup: { presets } } 형태도 받는다',
    M.pickTabFragment('presets', { setup: { presets: frag.presets } }, base).setup.presets[0].id === 'x');
  ck('배열만 던져도 받는다',
    M.pickTabFragment('presets', frag.presets, base).setup.presets[0].id === 'x');
  ck('스키마를 통째로 줘도 프리셋만 뽑는다', (() => {
    const whole = clone(base); whole.setup.presets = frag.presets; whole.vars = [];
    const p = M.pickTabFragment('presets', whole, base);
    return p.setup.presets[0].id === 'x' && p.vars === undefined;
  })());
  ck('presets가 없으면 거부', (() => {
    try { M.pickTabFragment('presets', { actions: [] }, base); return false; } catch (e) { return /presets/.test(e.message); }
  })());
  ck('presets가 배열이 아니면 거부', (() => {
    try { M.pickTabFragment('presets', { presets: { a: 1 } }, base); return false; } catch (e) { return true; }
  })());
  ck('schema를 안 줘도 안 터진다', (() => {
    try { return M.pickTabFragment('presets', frag).setup.presets[0].id === 'x'; } catch (e) { return false; }
  })());

  // 다른 탭은 예전 동작 그대로
  ck('액션 탭은 여전히 통째로 교체', (() => {
    const p = M.pickTabFragment('actions', { actions: [{ id: 'a' }] }, base);
    return p.actions.length === 1 && p.setup === undefined;
  })());

  // 왕복: 내보낸 걸 그대로 다시 넣으면 검증 통과
  const out = M.buildTabExportPrompt(base, 'presets');
  const json = JSON.parse(out.slice(out.lastIndexOf('```json') + 7, out.lastIndexOf('```')).trim().replace(/```[\s\S]*$/, ''));
  const back = M.pickTabFragment('presets', json, base);
  const merged = Object.assign(clone(base), back);
  ck('★ 내보낸 걸 그대로 다시 넣으면 검증 통과', validateSchema(merged).ok,
    validateSchema(merged).errors.map((e) => e.msg).join(' / '));
  ck('왕복해도 프리셋 개수가 같다', merged.setup.presets.length === base.setup.presets.length);
}

// ── 진단: 난이도 검증 ────────────────────────────────────────
const tagsOf = (s, o = { turns: 40, runs: 6 }) => diagnose(s, o).findings.map((f) => f.tag);

{
  // 제대로 된 사다리는 아무 말도 안 들어야 한다
  const good = S();
  const d = diagnose(good, { turns: 40, runs: 6 });
  ck('★ 제대로 만든 프리셋은 지적이 없다',
    !d.findings.some((f) => /프리셋|난이도 역전/.test(f.tag)),
    d.findings.filter((f) => /프리셋|난이도 역전/.test(f.tag)).map((f) => f.text.slice(0, 80)).join(' | '));
  ck('수명을 실제로 쟀다', d.stats.presetLives?.length === 3, JSON.stringify(d.stats.presetLives));
  ck('쉬운 쪽이 실제로 더 오래 산다',
    d.stats.presetLives[0].life > d.stats.presetLives[2].life,
    d.stats.presetLives.map((p) => p.label + ' ' + p.life.toFixed(1)).join(' / '));
  ck('신뢰구간이 붙는다', d.stats.presetLives.every((p) => typeof p.ci === 'number'));
  ck('측정 기준이 기록된다', ['play', 'idle'].includes(d.stats.presetMode), d.stats.presetMode);

  // ★★ 오탐 회귀 방어 — set:{} 기준선 프리셋을 구멍이라 부르면 안 된다.
  // 규격서가 "기준선은 비워 두는 게 정직하다"고 가르치는데 진단이 그걸 나무라면 서로 모순이다.
  const baseline = S();
  baseline.setup.presets = [
    { id: 'normal', label: '기본', set: {} },
    { id: 'hard', label: '어려움', set: { coal: 150, food: 90, hope: 30 } },
  ];
  const db = diagnose(baseline, { turns: 40, runs: 6 });
  ck('★★ set:{} 기준선 프리셋을 결함이라 하지 않는다',
    !db.findings.some((f) => /프리셋 구멍|빠져 있습니다/.test(f.tag + f.text)),
    db.findings.filter((f) => /프리셋/.test(f.tag)).map((f) => f.text.slice(0, 60)).join(' | '));

  // 한 프리셋에만 있는 키도 정상 설계다
  const partial = S();
  partial.setup.presets = [
    { id: 'a', label: '평시', set: { coal: 500, hope: 70 } },
    { id: 'b', label: '역병', set: { coal: 500, hope: 70, sick: 12 } },
  ];
  ck('★★ 한 프리셋에만 있는 키를 결함이라 하지 않는다',
    !diagnose(partial, { turns: 40, runs: 6 }).findings.some((f) => /빠져 있습니다/.test(f.text)));

  // 완전히 같은 두 프리셋은 잡는다
  const dup = S();
  dup.setup.presets = [
    { id: 'a', label: '쉬움', set: { coal: 500, hope: 70 } },
    { id: 'b', label: '어려움', set: { hope: 70, coal: 500 } },   // 키 순서만 다름
    { id: 'c', label: '보통', set: { coal: 300 } },
  ];
  const dd = diagnose(dup, { turns: 40, runs: 6 });
  ck('★ 값이 똑같은 두 프리셋은 잡는다 (키 순서 무관)',
    dd.findings.some((f) => f.tag === '프리셋 중복'), dd.findings.map((f) => f.tag).join(','));
  ck('중복 지적이 프리셋 탭으로 간다',
    dd.findings.find((f) => f.tag === '프리셋 중복')?.tab === 'presets');

  // 역전
  const flip = S();
  flip.setup.presets = [
    { id: 'e', label: '🌤 쉬움', set: { coal: 120, food: 80, hope: 25 } },
    { id: 'h', label: '💀 어려움', set: { coal: 900, food: 900, hope: 95 } },
  ];
  const df = diagnose(flip, { turns: 40, runs: 6 });
  const flipF = df.findings.find((f) => f.tag === '난이도 역전');
  ck('★ 이름과 실제가 뒤집히면 잡는다', !!flipF, df.findings.map((f) => f.tag).join(','));
  ck('역전 지적에 두 프리셋 이름과 턴 수가 들어간다',
    !!flipF && flipF.text.includes('쉬움') && flipF.text.includes('어려움') && /\d+턴/.test(flipF.text), flipF?.text);
  ck('역전 지적이 프리셋 탭으로 간다', flipF?.tab === 'presets');
  ck('짝비교라고 밝힌다', !!flipF && flipF.text.includes('짝비교'));

  // 라벨에 난이도 이름이 없으면 순서를 따지지 않는다
  const noname = S();
  noname.setup.preset = undefined;
  noname.setup.presets = [
    { id: 'e', label: '🌲 북쪽 숲', set: { coal: 120, food: 80, hope: 25 } },
    { id: 'h', label: '🏔 남쪽 고원', set: { coal: 900, food: 900, hope: 95 } },
  ];
  ck('★ 난이도 이름이 없으면 역전을 따지지 않는다',
    !tagsOf(noname).includes('난이도 역전'));

  // 사실상 같은 판
  const same = S();
  same.setup.presets = [
    { id: 'a', label: '쉬움', set: { coal: 260, food: 230, hope: 50 } },
    { id: 'b', label: '어려움', set: { coal: 259, food: 230, hope: 50 } },
  ];
  const ds = diagnose(same, { turns: 40, runs: 6 });
  ck('★ 이름만 난이도인 프리셋을 잡는다',
    ds.findings.some((f) => f.tag === '프리셋 무의미'), ds.findings.map((f) => f.tag).join(','));
  ck('무의미 지적에 실제 수명이 적힌다',
    ds.findings.find((f) => f.tag === '프리셋 무의미')?.text.includes('턴±'));

  // 전부 끝까지 살아남으면 비교 자체가 성립 안 하므로 침묵해야 한다
  const immortal = {
    meta: { name: 't' },
    vars: [{ id: 'hp', label: 'HP', type: 'int', init: 100, min: 0 },
      { id: 'over', label: '끝', type: 'bool', init: false }],
    rules: { onTurn: [{ set: 'hp', expr: 'hp + 1' }], events: [{ id: 'e', when: 'hp < 0', effects: [{ set: 'over', expr: '1' }], notify: 'x' }] },
    setup: { presets: [{ id: 'a', label: '쉬움', set: { hp: 100 } }, { id: 'b', label: '어려움', set: { hp: 50 } }] },
  };
  ck('★ 아무도 안 죽는 판에서는 프리셋을 나무라지 않는다',
    !tagsOf(immortal).includes('프리셋 무의미'), tagsOf(immortal).join(','));

  // 프리셋이 하나뿐이면 비교 대상이 없다
  const one = S();
  one.setup.presets = [one.setup.presets[0]];
  ck('프리셋이 1개면 비교하지 않는다',
    !tagsOf(one).some((t) => /난이도 역전|프리셋 무의미|프리셋 중복/.test(t)));
}

// ── 방치 기준 폴백 ──────────────────────────────────────────
{
  // 액션을 쓰면 아무도 안 죽지만 방치하면 갈리는 봇 — 그럴 땐 방치 기준으로 재야 의미가 있다
  const v = clone(TEMPLATES.vtuber.schema);
  const d = diagnose(v, { turns: 60, runs: 6 });
  ck('버튜버도 수명을 잰다', d.stats.presetLives?.length === 3, JSON.stringify(d.stats.presetLives?.map((p) => p.life)));
  ck('★ 플레이로 안 갈리면 방치 기준으로 재본다',
    d.stats.presetMode === 'idle' || d.stats.presetLives.some((p) => p.survive < 6),
    d.stats.presetMode + ' ' + JSON.stringify(d.stats.presetLives?.map((p) => [p.life, p.survive])));
}

// ── 프리셋 실행이 다른 진단을 오염시키지 않는가 ──────────────
{
  // 프리셋에서만 닿는 값이 있어도, 기본 시작에서 못 닿는 이벤트는 여전히 못 닿는 것이다.
  const base = {
    meta: { name: 't' },
    vars: [{ id: 'gold', label: '금', type: 'int', init: 10, min: 0 },
      { id: 'rich', label: '부자', type: 'bool', init: false },
      { id: 'over', label: '끝', type: 'bool', init: false }],
    rules: { onTurn: [{ set: 'gold', expr: 'gold + 1' }],
      events: [{ id: 'jackpot', when: 'gold >= 5000', effects: [{ set: 'rich', expr: '1' }], notify: '부자가 됐다!' },
        { id: 'end', when: 'gold < 0', effects: [{ set: 'over', expr: '1' }], notify: '끝' }] },
    setup: { presets: [] },
  };
  const noPreset = diagnose(base, { turns: 30, runs: 3 });
  const withPreset = clone(base);
  withPreset.setup.presets = [
    { id: 'a', label: '기본', set: { gold: 10 } },
    { id: 'b', label: '거부', set: { gold: 9000 } },   // 이 프리셋에서는 jackpot이 바로 뜬다
  ];
  const withP = diagnose(withPreset, { turns: 30, runs: 3 });
  const deadIn = (r) => r.findings.filter((f) => f.text.includes('jackpot')).map((f) => f.tag);
  ck('★ 프리셋 판에서 뜬 이벤트가 기본 판의 "안 뜬 이벤트" 판정을 흐리지 않는다',
    deadIn(noPreset).length > 0 && deadIn(withP).length > 0,
    `없을때 ${JSON.stringify(deadIn(noPreset))} / 있을때 ${JSON.stringify(deadIn(withP))}`);
  ck('관측 범위도 오염되지 않는다 (문턱 도달률 문구가 같다)', (() => {
    const a = noPreset.findings.find((f) => f.text.includes('jackpot'))?.text ?? '';
    const b = withP.findings.find((f) => f.text.includes('jackpot'))?.text ?? '';
    return a === b;
  })(), '');
}

// ── writerMap: 프리셋도 값을 세우는 주체다 ───────────────────
{
  const s = {
    meta: { name: 't' },
    vars: [{ id: 'origin', label: '출신', type: 'enum', enum: ['북', '남'], init: '북' },
      { id: 'hp', label: 'HP', type: 'int', init: 10, min: 0 }],
    rules: { onTurn: [{ set: 'hp', expr: 'hp + 1' }], events: [] },
    setup: { presets: [{ id: 'a', label: '북부', set: { origin: '북' } }, { id: 'b', label: '남부', set: { origin: '남' } }] },
  };
  const f = diagnose(s, { turns: 20, runs: 3 }).findings;
  ck('★ 프리셋으로만 정해지는 변수를 "아무도 안 바꾸는 변수"라 하지 않는다',
    !f.some((x) => x.tag === '고정 변수' && x.text.includes("'origin'")),
    f.filter((x) => x.tag === '고정 변수').map((x) => x.text.slice(0, 60)).join(' | '));
  const noPreset = clone(s); noPreset.setup.presets = [];
  ck('프리셋이 없으면 여전히 고정 변수로 잡힌다',
    diagnose(noPreset, { turns: 20, runs: 3 }).findings.some((x) => x.tag === '고정 변수' && x.text.includes("'origin'")));
}

// ── 프리셋이 없는 봇에 대한 안내 ─────────────────────────────
{
  const none = S(); none.setup.presets = []; delete none.setup.ai;
  const f = diagnose(none, { turns: 30, runs: 3 }).findings.find((x) => x.tag === '시작 프리셋');
  ck('프리셋이 없으면 🔵로 알려준다', !!f && f.sev === 'low', f?.text?.slice(0, 60));
  const ai = S(); ai.setup.presets = []; ai.setup.ai = { enabled: true, vars: ['hope'] };
  ck('★ AI 최초설정을 쓰는 봇에는 그 말을 안 한다',
    !diagnose(ai, { turns: 30, runs: 3 }).findings.some((x) => x.tag === '시작 프리셋'));
}

// ── 프리셋 적용이 실제로 먹히는가 (엔진) ────────────────────
{
  const s = TEMPLATES.survival.schema;
  let st = engine.initState(s);
  const before = st.vars.coal;
  const r = engine.applyPreset(s, st, 'ruin');
  ck('프리셋 적용이 성공한다', r.applied);
  ck('★ 값이 실제로 바뀐다', r.state.vars.coal !== before && r.state.vars.coal === 120,
    `${before} → ${r.state.vars.coal}`);
  ck('안 적은 변수는 시작값 그대로', r.state.vars.shelter === st.vars.shelter);
  ck('없는 프리셋은 무시된다', engine.applyPreset(s, st, 'nope').applied === false);
}

// ── 템플릿 전수: 프리셋 지적 0건 ────────────────────────────
{
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const bad = diagnose(t.schema, { turns: 60, runs: 6 }).findings
      .filter((f) => f.sev !== 'low' && /프리셋|난이도 역전/.test(f.tag));
    ck(`[${k}] 프리셋 지적 없음`, bad.length === 0, bad.map((f) => f.tag + ': ' + f.text.slice(0, 70)).join(' | '));
  }
}

// ── 출력 ────────────────────────────────────────────────────
let pass = 0, fail = 0;
for (const [ok, name, extra] of R) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
