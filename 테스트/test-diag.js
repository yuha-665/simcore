const __P = (...p) => require('path').resolve(__dirname, ...p);
// 진단 모듈 검증 — "일부러 망가뜨린 스키마에서 그 문제를 정확히 짚는가"가 핵심.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { diagnose, writerMap, bottleneck, pickLoseVar } = SC.require('diagnose');
const { TEMPLATES } = SC.require('templates');
const { validateSchema } = SC.require('validate');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const cp = (o) => JSON.parse(JSON.stringify(o));
const FAST = { turns: 25, runs: 3 };
const expose = (s, id) => { (s.statusUI.groups[0].items = s.statusUI.groups[0].items || []).push({ var: id }); };
const hit = (r, re) => r.findings.filter((f) => re.test(f.text) || re.test(f.tag));
const has = (r, re) => hit(r, re).length > 0;

// ── 모듈이 붙었는가 ──
ck('diagnose 모듈이 로드됨', typeof diagnose === 'function', '');
// v0.47부터 진단은 3층 탭이 아니라 1층(AI에게 맡기기 곁)의 접기로 들어간다
ck('편집기 1층에 진단이 등록됨', src.includes('실전 진단 — 굴려서') && src.includes('tabDiag()'), '');
ck('진단 탭 함수가 있음', src.includes('function tabDiag()'), '');
ck('편집기가 diagnose를 require함', src.includes("require('./diagnose')"), '');

// ── ★ CSS 색상 오타 방지 (전에 #3a4straight 두 번 냈다) ──
{
  const bad = [];
  for (const m of src.matchAll(/#[0-9a-zA-Z]{2,}/g)) {
    const t = m[0].slice(1);
    if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{4}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(t)) continue;
    // 코드 안의 #문자는 색상만 있는 게 아니다 — CSS 속성 뒤에 온 것만 본다
    const before = src.slice(Math.max(0, m.index - 40), m.index);
    if (/(color|background|border|shadow|fill|stroke|outline)\s*:?[^;{}]*$/i.test(before)) bad.push(m[0]);
  }
  ck('★ CSS 색상값에 오타가 없음', bad.length === 0, bad.join(', '));
}

// ── 정상 템플릿에서 헛경보가 안 나야 한다 ──
for (const key of ['survival', 'politics', 'business', 'rpg']) {
  const r = diagnose(TEMPLATES[key].schema, FAST);
  ck(`'${key}' 진단이 완주함`, r.ran, JSON.stringify(r.findings.slice(0, 2)));
  ck(`'${key}'에 검증 오류 없음`, !has(r, /^검증$/), hit(r, /^검증$/).map((f) => f.text).join(' / '));
  ck(`'${key}'에 고정 변수 오탐 없음`, !has(r, /바꾸는 곳이 하나도 없습니다/),
    hit(r, /바꾸는 곳이 하나도 없습니다/).map((f) => f.text).join(' / '));
}

// ── 깨진 스키마는 굴리지 않고 오류만 돌려준다 ──
{
  const bad = cp(TEMPLATES.rpg.schema);
  bad.rules.onTurn.push({ set: 'nope', expr: '1' });
  const r = diagnose(bad, FAST);
  ck('★ 검증 실패면 시뮬을 돌리지 않음', r.ran === false, '');
  ck('그래도 오류는 알려줌', has(r, /nope/), '');
}

// ── ★ 일부러 심은 결함을 잡는가 ──
{
  // (1) 아무도 안 바꾸는 변수 — 림월드 temp_target 사고
  const s = cp(TEMPLATES.survival.schema);
  s.vars.push({ id: 'ghost', label: '유령', type: 'int', min: 0, init: 7 }); expose(s, 'ghost');
  const r = diagnose(s, FAST);
  ck('★ 아무도 안 바꾸는 변수를 잡는다', has(r, /'ghost'.*바꾸는 곳이 하나도 없습니다/), '');
  ck('그 지적이 high 등급', hit(r, /'ghost'/).some((f) => f.sev === 'high'), '');

  // (2) 고정 변수만 참조하는 파생
  const s2 = cp(s);
  s2.derived.push({ id: 'ghost2', label: '유령2', expr: 'ghost * 2' });
  ck('★ 고정 변수만 쓰는 파생을 잡는다',
    has(diagnose(s2, FAST), /파생 'ghost2'.*절대 변하지 않습니다/), '');
}
{
  // (3) 도달 불가능한 이벤트 — 몇 %인지까지 말해야 한다
  const s = cp(TEMPLATES.survival.schema);
  s.rules.events.push({ id: 'impossible', when: 'coal >= 99999', effects: [{ set: 'hope', expr: 'hope' }], notify: 'x' });
  const r = diagnose(s, FAST);
  ck('★ 도달 불가 이벤트를 잡는다', has(r, /'impossible' 미발동/), '');
  ck('★★ 몇까지 도달했는지 수치로 알려준다 (wealth 92%를 짚은 그 기능)',
    has(r, /coal >= 99999.*관측 최고 \d+.*%/), hit(r, /impossible/).map((f) => f.text).join(''));
}
{
  // (4) 한 번도 못 쓰는 액션
  const s = cp(TEMPLATES.survival.schema);
  s.actions.push({ id: 'never', label: '🚀 불가능', mode: 'oneshot', when: 'coal >= 99999',
    inject: 'x', effects: [{ set: 'hope', expr: 'hope' }] });
  const r = diagnose(s, FAST);
  ck('★ 못 쓰는 액션을 잡는다', has(r, /못 쓰는 액션/) && has(r, /불가능/), '');
  ck('그 지적이 high 등급', hit(r, /못 쓰는 액션/).some((f) => f.sev === 'high'), '');
}
{
  // (5) 매 턴 도배되는 이벤트 (조건을 해소하지 않음)
  const s = cp(TEMPLATES.survival.schema);
  s.rules.events.unshift({ id: 'spam', when: 'day >= 1', effects: [{ set: 'hope', expr: 'hope' }], notify: '또' });
  ck('★ 매 턴 도배되는 이벤트를 잡는다', has(diagnose(s, FAST), /'spam'.*도배|'spam'.*매 턴 반복/), '');
}
{
  // (6) 시작값 = 조건 경계 (프로스트펑크 press < 50 사고)
  const s = cp(TEMPLATES.survival.schema);
  s.vars.push({ id: 'gate', label: '문턱', type: 'int', min: 0, init: 5 }); expose(s, 'gate');
  s.rules.events.push({ id: 'edge', when: 'gate < 5', effects: [{ set: 'hope', expr: 'hope' }], notify: 'x' });
  ck('★ 아무도 안 바꾸는 값의 경계값 함정을 잡는다', has(diagnose(s, FAST), /시작값이 정확히 5이고 아무도/), '');

  // 바꾸는 곳이 있으면 '첫 턴에만 거짓'일 뿐 — 고쳐도 안 사라지는 잡음이라 이제 안 띄운다
  const s3 = cp(TEMPLATES.survival.schema);
  const hope = s3.vars.find((v) => v.id === 'hope');
  s3.rules.events.push({ id: 'edge2', when: `hope < ${hope.init}`, effects: [{ set: 'hope', expr: 'hope' }], notify: 'x' });
  ck('★ 바꾸는 곳이 있으면 경계값 잡음을 안 띄운다',
    !diagnose(s3, FAST).findings.some((f) => f.tag === '경계값'), '');

  // >= 는 경계에서 참이므로 함정이 아니다 — 오탐 방지
  const s2 = cp(TEMPLATES.survival.schema);
  s2.rules.events.push({ id: 'fine', when: `hope >= ${hope.init}`, effects: [{ set: 'hope', expr: 'hope' }], notify: 'x' });
  ck('★ >= 경계는 함정으로 오탐하지 않음',
    !diagnose(s2, FAST).findings.some((f) => f.tag === '경계값' && /'fine'/.test(f.text)), '');
}
{
  // (7) 줄기만 하는 자원
  const s = cp(TEMPLATES.survival.schema);
  s.vars.push({ id: 'drain', label: '누수', type: 'int', min: 0, init: 500 }); expose(s, 'drain');
  s.rules.onTurn.push({ set: 'drain', expr: 'max(0, drain - 5)' });
  ck('★ 감소만 하는 자원을 잡는다', has(diagnose(s, FAST), /'drain'.*줄기만 합니다/), '');
}
{
  // (8) 설정으로 갈린 이벤트는 "죽음"이 아니라 "설정 의존"으로 구분해야 한다 (randy_gift 오탐)
  const s = cp(TEMPLATES.survival.schema);
  s.vars.push({ id: 'mode', label: '모드', type: 'enum', enum: ['보통', '지옥'], init: '보통' }); expose(s, 'mode');
  s.actions.push({ id: 'to_hell', label: '😈 지옥 모드', mode: 'oneshot', when: 'mode != "지옥"',
    inject: 'x', effects: [{ set: 'mode', expr: '"지옥"' }] });
  s.rules.events.push({ id: 'hellonly', when: 'mode == "지옥"', effects: [{ set: 'hope', expr: 'hope - 1' }], notify: 'x' });
  const r = diagnose(s, { turns: 25, runs: 3, actionImpact: false });
  const f = r.findings.find((x) => /hellonly/.test(x.text));
  ck('★ 설정 의존 이벤트를 죽은 이벤트로 오판하지 않음', !f || f.tag === '설정 의존', f ? `${f.tag}: ${f.text}` : '언급 없음');
  ck('플레이어가 바꿀 수 있으면 낮은 등급', !f || f.sev === 'low', f ? f.sev : '');
}
{
  // (9) 함정 액션 — 누르면 손해
  const s = cp(TEMPLATES.survival.schema);
  s.actions.push({ id: 'trap', label: '💀 함정', mode: 'hold',
    inject: 'x', effects: [{ set: 'hope', expr: 'max(0, hope - 12)' }, { set: 'discontent', expr: 'min(100, discontent + 12)' }] });
  s.actions.push({ id: 'boon', label: '🎁 순이득', mode: 'oneshot',
    inject: 'x', effects: [{ set: 'coal', expr: 'min(9999, coal + 80)' }, { set: 'hope', expr: 'min(100, hope + 6)' }] });
  const r = diagnose(s, { turns: 40, runs: 4 });
  ck('★ 누르면 손해인 액션을 잡는다', has(r, /함정 액션|'💀 함정'/), '');
  ck('액션 기여도 표가 나온다', (r.stats.actionImpact || []).length > 0, String((r.stats.actionImpact || []).length));
  ck('★ 정책 전환 액션은 평가에서 제외된다 (무작위 봇이 판단 못 함)',
    (r.stats.actionSkipped || []).length > 0 && !(r.stats.actionImpact || []).some((a) => (r.stats.actionSkipped || []).includes(a.label)),
    JSON.stringify(r.stats.actionSkipped));
  ck('★ 순이득 액션은 함정으로 오판하지 않는다',
    !r.findings.some((f) => f.tag === '함정 액션' && /순이득/.test(f.text)), '');
  ck('★ 함정이 표 맨 아래, 순이득이 함정보다 위', (() => {
    const arr = r.stats.actionImpact || [];
    const ti = arr.findIndex((a) => a.id === 'trap'), bi = arr.findIndex((a) => a.id === 'boon');
    return ti === arr.length - 1 && bi >= 0 && bi < ti;
  })(), JSON.stringify((r.stats.actionImpact || []).map((a) => `${a.id}:${a.delta.toFixed(1)}`)));
}
{
  // (9-b) 지속 정책(hold)은 한 번 켜면 계속 켜져 있다. 그런데도 매 턴 그 버튼을 다시 고르면
  //       [있음] 판이 "다른 액션은 하나도 안 쓴 판"이 되어 멀쩡한 hold가 함정으로 신고된다.
  //       비용은 있지만 켜 놓을 만한 정책을 넣고, 함정으로 찍히지 않는지 본다.
  const s = cp(TEMPLATES.survival.schema);
  s.actions.push({ id: 'policy', label: '📋 지속 정책', mode: 'hold',
    inject: 'x', effects: [{ set: 'coal', expr: 'max(0, coal - 4)' }, { set: 'hope', expr: 'min(100, hope + 3)' }] });
  const r = diagnose(s, { turns: 40, runs: 4 });
  ck('★ hold 액션이 무장된 뒤에는 다른 액션도 쓰는 판으로 잰다',
    !r.findings.some((f) => f.tag === '함정 액션' && /지속 정책/.test(f.text)),
    r.findings.filter((f) => f.tag === '함정 액션').map((f) => f.text).join(' / '));
  ck('그래도 hold 액션이 기여도 표에는 들어간다',
    (r.stats.actionImpact || []).some((a) => a.id === 'policy'),
    JSON.stringify((r.stats.actionImpact || []).map((a) => a.id)));
  ck('소스에 그 판정이 실제로 들어감',
    src.includes("(a.mode || 'oneshot') === 'hold' && st.meta?.armed?.[a.id]"), '');

  // 진짜 나쁜 hold는 여전히 잡혀야 한다 (수정이 검출력을 죽이지 않았는지)
  const s2 = cp(TEMPLATES.survival.schema);
  s2.actions.push({ id: 'awful', label: '💀 최악 정책', mode: 'hold',
    inject: 'x', effects: [{ set: 'coal', expr: 'max(0, coal - 60)' }, { set: 'hope', expr: 'max(0, hope - 20)' }] });
  const r2 = diagnose(s2, { turns: 40, runs: 4 });
  ck('★ 진짜 손해인 hold는 여전히 잡는다',
    r2.findings.some((f) => f.tag === '함정 액션' && /최악 정책/.test(f.text)),
    JSON.stringify((r2.stats.actionImpact || []).map((a) => `${a.id}:${a.delta.toFixed(1)}`)));
}
{
  // (9-c) 시드 운을 함정으로 신고하지 않는가.
  //   실측: 120턴짜리 봇에서 6시드 95% 신뢰구간이 ±18턴까지 벌어졌다. 그 폭 안의 값은
  //   부호조차 못 믿는다 — 실제로 "-12턴 함정"으로 신고된 액션이 36시드에서 +25턴으로 뒤집혔다.
  const s = cp(TEMPLATES.survival.schema);
  s.actions.push({ id: 'coinflip', label: '🪙 시드 운', mode: 'oneshot', cooldown: 2,
    inject: 'x', effects: [{ set: 'coal', expr: 'coal + rand(-30, 30)' }] });
  const r = diagnose(s, { turns: 40, runs: 4 });
  const it = (r.stats.actionImpact || []).find((a) => a.id === 'coinflip');
  ck('★ 기여도에 신뢰구간이 함께 나온다', it && typeof it.ci === 'number' && isFinite(it.ci), JSON.stringify(it));
  ck('★ 몇 쌍을 돌렸는지 알려준다', r.stats.impactRuns >= 12, String(r.stats.impactRuns));
  ck('★ 기여도 측정은 다른 진단보다 시드를 더 쓴다 (여기가 제일 시끄럽다)',
    r.stats.impactRuns > r.stats.runs, `${r.stats.impactRuns} vs ${r.stats.runs}`);
  ck('★ 신뢰구간이 0을 걸치면 함정으로 신고하지 않는다',
    !(it && Math.abs(it.delta) <= it.ci
      && r.findings.some((f) => f.tag === '함정 액션' && /시드 운/.test(f.text))),
    it ? `Δ${it.delta.toFixed(1)} ±${it.ci.toFixed(1)}` : '');
  ck('함정 지적문에 ± 폭이 실린다',
    r.findings.filter((f) => f.tag === '함정 액션').every((f) => /±[\d.]+/.test(f.text)),
    r.findings.filter((f) => f.tag === '함정 액션').map((f) => f.text).join(' / '));
  ck('소스에 신뢰구간 게이팅이 실제로 들어감', src.includes('it.delta + it.ci < -trapLine'), '');
  ck('★ 짝지은 시드(공통 난수)를 쓴다 — 두 판이 같은 시드', src.includes('const on = sim(seed, onPick(a));')
    && src.includes('const off = sim(seed, (av, st, i, s) => rest(av, a, s, i));'), '');

  // 의도적으로 대가를 치르게 만든 버튼은 제외할 수 있어야 한다
  const s2 = cp(TEMPLATES.survival.schema);
  s2.actions.push({ id: 'sin', label: '💀 도덕적 비용', mode: 'hold', impactExempt: true,
    inject: 'x', effects: [{ set: 'hope', expr: 'max(0, hope - 25)' }, { set: 'coal', expr: 'max(0, coal - 50)' }] });
  const r2b = diagnose(s2, { turns: 40, runs: 4 });
  ck('★ impactExempt를 달면 함정으로 지적하지 않는다',
    !r2b.findings.some((f) => f.tag === '함정 액션' && /도덕적 비용/.test(f.text)),
    r2b.findings.filter((f) => f.tag === '함정 액션').map((f) => f.text).join(' / '));
  ck('그래도 기여도 표에는 남아 있다 (판단 근거는 봐야 하니까)',
    (r2b.stats.actionImpact || []).some((a) => a.id === 'sin' && a.exempt === true), '');
  ck('지적문이 제외 방법을 알려준다',
    r.findings.filter((f) => f.tag === '함정 액션').every((f) => /impactExempt/.test(f.text))
    || !r.findings.some((f) => f.tag === '함정 액션'), '');
  ck('검증기가 impactExempt를 거부하지 않는다', validateSchema(s2).ok, '');
}
{
  // (9-d) 수명 말고 다른 축 — 천장에 닿은 봇은 수명만으로 구분이 안 된다
  const r = diagnose(TEMPLATES.survival.schema, { turns: 40, runs: 6 });
  ck('★ 결과가 갈리는 폭을 낸다', typeof r.stats.playSpread === 'number' && Array.isArray(r.stats.playRange),
    JSON.stringify([r.stats.playSpread, r.stats.playRange]));
  ck('★ 이벤트 커버리지를 낸다',
    Array.isArray(r.stats.eventCoverage) && r.stats.eventCoverage[1] > 0, JSON.stringify(r.stats.eventCoverage));
  // 커버리지는 "이 판 길이에서 뜬 것"이고, 죽은 이벤트는 "길게 굴려도 안 뜬 것"이라
  // 차이만큼이 후반부 이벤트다
  ck('커버리지 = 죽은 이벤트 + 후반부 이벤트',
    r.stats.eventCoverage[1] - r.stats.eventCoverage[0] === r.stats.deadEvents + (r.stats.lateEvents ?? 0),
    `${JSON.stringify(r.stats.eventCoverage)} vs 죽은 ${r.stats.deadEvents} + 후반부 ${r.stats.lateEvents ?? 0}`);
  ck('★ 붕괴 원인 분포를 낸다', Array.isArray(r.stats.lossCauses), JSON.stringify(r.stats.lossCauses));
  ck('붕괴 원인이 이벤트 통지문으로 읽힌다 (id가 아니라)',
    !r.stats.lossCauses.length || r.stats.lossCauses.every(([k]) => typeof k === 'string' && k.length > 0), '');

  // 한 원인이 8할이면 지적한다
  const only = cp(TEMPLATES.survival.schema);
  const rOnly = diagnose(only, { turns: 40, runs: 6 });
  const tot = rOnly.stats.lossCauses.reduce((s2, [, n]) => s2 + n, 0);
  if (tot >= 4 && rOnly.stats.lossCauses[0][1] / tot >= 0.8) {
    ck('★ 붕괴 원인이 하나로 몰리면 지적한다', rOnly.findings.some((f) => f.tag === '붕괴 편중'), '');
  } else {
    ck('원인이 골고루면 붕괴 편중을 지적하지 않는다', !rOnly.findings.some((f) => f.tag === '붕괴 편중'),
      JSON.stringify(rOnly.stats.lossCauses));
  }
  ck('두 축 다 🔵 등급 (참고용이지 오류가 아님)',
    r.findings.filter((f) => ['붕괴 편중', '이벤트 커버리지'].includes(f.tag)).every((f) => f.sev === 'low'), '');
}
{
  // (10) 판이 짧아서 못 본 것과 영영 못 볼 것을 구분한다.
  //   같은 봇이 60턴에선 "죽은 이벤트 5건", 120턴에선 0건이 나와 사용자가 혼란스러워했다.
  //   굶주림·전멸 같은 조건은 짧은 판에서는 원래 안 온다 — 결함이 아니라 판 길이 문제다.
  const s = cp(TEMPLATES.survival.schema);
  s.rules.events.push({ id: 'late_milestone', once: true, when: 'day >= 55',
    effects: [{ set: 'hope', expr: 'hope' }], notify: '오래 버텼다.' });
  s.rules.events.push({ id: 'never_ever', when: 'coal >= 999999',
    effects: [{ set: 'hope', expr: 'hope' }], notify: 'x' });

  const short = diagnose(s, { turns: 30, runs: 4 });   // 30턴 → day 55는 못 감, 60턴이면 감
  const lateF = short.findings.find((f) => /late_milestone/.test(f.text));
  ck('★ 판이 짧아 못 본 이벤트를 죽은 이벤트로 신고하지 않는다',
    lateF && lateF.tag === '후반부 이벤트', lateF ? `${lateF.tag}: ${lateF.text}` : '언급 없음');
  ck('★ 그건 🔵 등급이다 (고칠 게 아니라 알아둘 것)', !lateF || lateF.sev === 'low', lateF?.sev);
  ck('★ 턴 수를 올리라고 안내한다', !lateF || /턴 수를 올리/.test(lateF.text), lateF?.text);
  ck('★ 몇 턴으로 늘리면 되는지 숫자로 말해준다', !lateF || /60턴으로 늘리면/.test(lateF.text), lateF?.text);
  ck('AI 수정 요청으로는 안 넘긴다 (고칠 게 없으므로)', !lateF || lateF.tab === null, String(lateF?.tab));

  const deadF = short.findings.find((f) => /never_ever/.test(f.text));
  ck('★ 진짜 도달 불가는 여전히 🟡 죽은 이벤트다',
    deadF && deadF.tag === '죽은 이벤트' && deadF.sev === 'mid', deadF ? `${deadF.tag}/${deadF.sev}` : '언급 없음');
  ck('진짜 죽은 이벤트는 규칙 탭으로 넘어간다', !deadF || deadF.tab === 'rules', String(deadF?.tab));

  // 길게 굴리면 후반부 지적 자체가 사라져야 한다
  const long = diagnose(s, { turns: 80, runs: 4 });
  ck('★ 판을 늘리면 그 이벤트는 지적에서 아예 사라진다',
    !long.findings.some((f) => /late_milestone/.test(f.text)),
    long.findings.filter((f) => /late_milestone/.test(f.text)).map((f) => f.tag).join(','));
  ck('길게 굴려도 진짜 죽은 이벤트는 남는다',
    long.findings.some((f) => /never_ever/.test(f.text) && f.tag === '죽은 이벤트'), '');

  // 액션도 같은 처리
  const s2 = cp(TEMPLATES.survival.schema);
  s2.actions.push({ id: 'late_btn', label: '🕰 후반 전용', mode: 'oneshot', when: 'day >= 55',
    inject: 'x', effects: [{ set: 'hope', expr: 'hope' }] });
  const r2 = diagnose(s2, { turns: 30, runs: 4 });
  const laF = r2.findings.find((f) => /후반 전용/.test(f.text));
  ck('★ 후반에만 열리는 액션도 🔴이 아니라 🔵로 안내한다',
    laF && laF.tag === '후반부 액션' && laF.sev === 'low', laF ? `${laF.tag}/${laF.sev}` : '언급 없음');
  ck('진짜 못 쓰는 액션은 여전히 🔴', (() => {
    const s3 = cp(TEMPLATES.survival.schema);
    s3.actions.push({ id: 'nope', label: '🚫 불가', mode: 'oneshot', when: 'coal >= 999999',
      inject: 'x', effects: [{ set: 'hope', expr: 'hope' }] });
    const r3 = diagnose(s3, { turns: 30, runs: 4 });
    const f = r3.findings.find((x) => /불가/.test(x.text));
    return f && f.tag === '못 쓰는 액션' && f.sev === 'high';
  })(), '');

  ck('소스에 긴 판 확인이 실제로 들어감',
    src.includes('const longTurns = turns * 2;') && src.includes('onlyLonger'), '');
  ck('긴 판 확인은 미발동 항목이 있을 때만 돈다 (평소엔 공짜)',
    src.includes('if (firedLong) return;'), '');
}
{
  // (11) 안전장치(값 자르기)는 안 뜨는 게 성공이다.
  //   규격서가 "플레이어에게 알릴 게 없으므로 notify를 넣지 않는다"고 가르치는 패턴인데,
  //   진단이 그걸 죽은 이벤트로 신고하면 우리가 가르친 걸 우리가 결함이라 부르는 셈이다.
  const s = cp(TEMPLATES.survival.schema);
  s.rules.events.push({ id: 'hope_cap', when: 'hope > 100',      // 이미 clamp돼서 영영 거짓
    effects: [{ set: 'hope', expr: '100' }] });                   // notify 없음 = 안전장치
  s.rules.events.push({ id: 'loud_dead', when: 'coal >= 999999',  // notify 있음 = 콘텐츠
    effects: [{ set: 'hope', expr: 'hope' }], notify: '있을 리 없는 일' });
  const r = diagnose(s, { turns: 30, runs: 4 });

  const g = r.findings.find((f) => /hope_cap/.test(f.text));
  ck('★ notify 없는 미발동 이벤트는 안전장치로 분류한다', g && g.tag === '안전장치',
    g ? `${g.tag}/${g.sev}` : '언급 없음');
  ck('★ 안전장치는 🔵 (고칠 게 아님)', !g || g.sev === 'low', g?.sev);
  ck('★ 고치지 말라고 명시한다', !g || /고치지 마세요/.test(g.text), g?.text);
  ck('★ 왜 정상인지 설명한다', !g || /안 뜨는 게 정상/.test(g.text), g?.text);
  ck('AI 수정 요청으로 안 넘긴다', !g || g.tab === null, String(g?.tab));
  ck('죽은 이벤트 집계에서도 빠진다', typeof r.stats.guardEvents === 'number' && r.stats.guardEvents >= 1,
    String(r.stats.guardEvents));

  const d = r.findings.find((f) => /loud_dead/.test(f.text));
  ck('★ notify 있는 미발동 이벤트는 여전히 🟡 죽은 이벤트',
    d && d.tag === '죽은 이벤트' && d.sev === 'mid' && d.tab === 'rules',
    d ? `${d.tag}/${d.sev}/${d.tab}` : '언급 없음');

  // 커버리지 항등식이 안전장치까지 포함해 맞아야 한다
  ck('커버리지 = 죽은 + 후반부 + 안전장치',
    r.stats.eventCoverage[1] - r.stats.eventCoverage[0]
      === r.stats.deadEvents + (r.stats.lateEvents ?? 0) + (r.stats.guardEvents ?? 0),
    `${JSON.stringify(r.stats.eventCoverage)} = ${r.stats.deadEvents} + ${r.stats.lateEvents ?? 0} + ${r.stats.guardEvents ?? 0}`);

  // 실제로 뜨는 안전장치는 미발동 지적 대상이 아니다.
  // (매 턴 뜨면 그건 별개로 '도배'로 잡히는 게 맞다 — 조건을 해소 못 하는 규칙이니까)
  const s2 = cp(TEMPLATES.survival.schema);
  s2.rules.events.push({ id: 'live_guard', when: 'hope >= 0', effects: [{ set: 'hope', expr: 'hope' }] });
  const r2 = diagnose(s2, { turns: 30, runs: 4 });
  ck('뜨는 안전장치는 미발동으로 신고하지 않는다',
    !r2.findings.some((f) => /live_guard/.test(f.text) && ['안전장치', '죽은 이벤트', '후반부 이벤트'].includes(f.tag)),
    r2.findings.filter((f) => /live_guard/.test(f.text)).map((f) => f.tag).join(','));
  ck('매 턴 뜨는 건 도배로 따로 잡힌다 (조건을 해소 못 하므로)',
    r2.findings.some((f) => /live_guard/.test(f.text) && f.tag === '도배'),
    r2.findings.filter((f) => /live_guard/.test(f.text)).map((f) => f.tag).join(','));
}
{
  // (12) 전부 끝까지 살아남으면 기여도 표가 아무것도 구분하지 못한다.
  //   그게 액션 탓인지 판이 짧은 탓인지 구분해 줘야 한다 — 안 그러면 멀쩡한 액션을 의심하게 된다.
  const easy = cp(TEMPLATES.romance.schema);           // 패배 변수는 있는데 잘 안 죽는 봇
  const r = diagnose(easy, { turns: 20, runs: 4 });
  if (r.stats.playSurvive === r.stats.runs && r.stats.actionImpact?.length) {
    ck('★ 전부 생존이면 기여도 표가 포화됐다고 알린다', r.stats.impactSaturated === true,
      `생존 ${r.stats.playSurvive}/${r.stats.runs}, 포화 ${r.stats.impactSaturated}`);
  } else {
    ck('일부라도 죽으면 포화가 아니다', r.stats.impactSaturated !== true, String(r.stats.impactSaturated));
  }
  const hard = diagnose(TEMPLATES.survival.schema, { turns: 40, runs: 6 });
  ck('실제로 판이 끝나는 봇은 포화로 표시하지 않는다', hard.stats.impactSaturated !== true,
    `생존 ${hard.stats.playSurvive}/${hard.stats.runs}`);
  ck('소스에 포화 안내가 실제로 들어감',
    src.includes('impactSaturated') && src.includes('이 표가 아무것도 구분하지 못합니다'), '');
}

// ── 보조 함수 ──
{
  ck('패배 변수 자동 탐지', pickLoseVar(TEMPLATES.survival.schema) === 'collapsed',
    String(pickLoseVar(TEMPLATES.survival.schema)));
  ck('패배 변수가 없으면 null', pickLoseVar({ vars: [{ id: 'x', type: 'int' }] }) === null, '');

  const w = writerMap(TEMPLATES.survival.schema);
  ck('writerMap이 onTurn을 잡음', w.coal?.has('onTurn'), '');
  ck('writerMap이 액션을 잡음', w.heat?.has('액션'), [...(w.heat || [])].join(','));
  ck('writerMap이 AI 허용을 잡음', [...Object.values(w)].some((s) => s.has('AI')), '');

  const b = bottleneck('gold >= 1000 and hp >= 5', { gold: { min: 0, max: 250 }, hp: { min: 1, max: 9 } });
  ck('bottleneck이 가장 안 닿은 항을 고름', b.id === 'gold' && b.need === 1000 && b.got === 250, JSON.stringify(b));
  ck('bottleneck이 진행률을 계산함', b.pct === 25, String(b.pct));
  ck('이미 닿은 조건은 병목이 아님', bottleneck('hp >= 5', { hp: { min: 1, max: 9 } }) === null, '');
  ck('조건이 없으면 null', bottleneck(null, {}) === null, '');
}

// ── 결정성 & 성능 ──
{
  const a = diagnose(TEMPLATES.survival.schema, FAST);
  const b = diagnose(TEMPLATES.survival.schema, FAST);
  ck('★ 같은 입력이면 같은 결과 (시드 고정)',
    JSON.stringify(a.findings) === JSON.stringify(b.findings), '');

  const t0 = Date.now();
  const big = diagnose(TEMPLATES.survival.schema, { turns: 60, runs: 6 });
  const ms = Date.now() - t0;
  console.log(`  [성능] 60턴 × 6시드 + 액션 ${TEMPLATES.survival.schema.actions.length}종 → ${ms}ms`);
  ck('편집기에서 쓸 만한 속도 (3초 미만)', ms < 3000, `${ms}ms`);
  ck('결과에 통계가 담김', big.stats.turns === 60 && big.stats.runs === 6, JSON.stringify(big.stats));
}

// ── 회차 비교 ('고쳐도 계속 비슷하다'의 정체를 밝히는 기능) ──
{
  const { compareDiagnoses, findingKey } = SC.require('diagnose');
  const before = cp(TEMPLATES.survival.schema);
  before.rules.events.push({ id: 'impossible', when: 'coal >= 99999', effects: [{ set: 'hope', expr: 'hope' }], notify: 'x' });
  before.vars.push({ id: 'ghost', label: '유령', type: 'int', min: 0, init: 7 }); expose(before, 'ghost');
  const after = cp(before);
  after.rules.events = after.rules.events.filter((e) => e.id !== 'impossible');  // 하나 고침
  after.rules.onTurn.push({ set: 'ghost', expr: 'ghost' });                       // 고정 변수도 해결

  const r1 = diagnose(before, FAST), r2 = diagnose(after, FAST);
  const c = compareDiagnoses(r1, r2);
  ck('★ 비교 결과가 나온다', !!c, '');
  ck('★ 해결된 지적을 집어낸다', c.fixed.some((f) => /impossible/.test(f.text)), c.fixed.map((f) => f.tag).join(','));
  ck('★ 고정 변수 해결도 잡는다', c.fixed.some((f) => /ghost/.test(f.text)), '');
  ck('해결된 것이 새로 생김에 안 섞임', !c.fresh.some((f) => /impossible/.test(f.text)), '');
  ck('그대로 남은 것도 센다', c.stayed.length > 0, String(c.stayed.length));
  ck('등급 증감을 계산한다', typeof c.delta.high === 'number' && c.delta.mid <= 0, JSON.stringify(c.delta));
  ck('생존율 변화를 같이 준다', !!c.survive && c.survive.idle.length === 2, JSON.stringify(c.survive));

  ck('같은 결과끼리 비교하면 변화 0', (() => {
    const z = compareDiagnoses(r1, diagnose(before, FAST));
    return z.fixed.length === 0 && z.fresh.length === 0;
  })(), '');
  ck('한쪽이 없으면 null', compareDiagnoses(null, r2) === null, '');
  ck('굴리지 못한 결과와는 비교 안 함', compareDiagnoses({ ran: false, findings: [] }, r2) === null, '');
  ck('★ 열쇠는 수치가 바뀌어도 같은 지적으로 알아본다',
    findingKey({ tag: '죽은 이벤트', text: "'x' 미발동 — 관측 최고 100 (10%)" })
    === findingKey({ tag: '죽은 이벤트', text: "'x' 미발동 — 관측 최고 250 (25%)" }), '');
  ck('다른 지적은 다른 열쇠', findingKey({ tag: '죽은 이벤트', text: "'a' x" }) !== findingKey({ tag: '죽은 이벤트', text: "'b' x" }), '');

  ck('편집기가 비교를 배선함', src.includes('compareDiagnoses(diagPrev, diagResult)') && src.includes('📊 직전 진단과 비교'), '');
  ck('턴/시드가 다르면 비교하지 않음', src.includes('before.stats.turns === diagTurns && before.stats.runs === diagRuns'), '');
  ck('★ 🔵는 AI 수정 요청에서 빠진다', src.includes("f.tab === tabKey && f.sev !== 'low'"), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
