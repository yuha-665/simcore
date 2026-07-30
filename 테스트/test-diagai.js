const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.52 진단 오탐 억제 — "보조 AI가 움직이는 값"과 "안 뜬 이벤트의 그림자"를 결함으로 신고하지 않는가.
//
// 배경: 맨션봇 진단이 47건을 냈는데 그중 29건이 시뮬레이션의 구조적 사각지대였다.
// 더 나쁜 건 **올바른 수정이 지적을 늘렸다는 것** — 래치 짝(위기/회복 + 경보 플래그)을
// 제대로 넣자 위기 미발동 1건이 위기·회복·플래그 3건으로 불어났다. 진단이 좋은 설계를 벌줬다.
// 여기서 재현하는 건 그 봇의 골격이다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { diagnose } = SC.require('diagnose');
const { validateSchema } = SC.require('validate');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const cp = (o) => JSON.parse(JSON.stringify(o));
const FAST = { turns: 25, runs: 3 };
const hit = (r, re) => r.findings.filter((f) => re.test(f.text) || re.test(f.tag));
const has = (r, re) => hit(r, re).length > 0;
const about = (r, id) => r.findings.filter((f) => new RegExp(`'${id}'`).test(f.text));

// ── 맨션봇 골격 ────────────────────────────────────────────
// aff/confessed = AI가 서사로 움직이는 값 · gauge = AI가 깎기만 하는 시설 게이지 +
// 래치 짝 · pay_tmp = 효과 안에서 세웠다 되돌리는 계산용 임시 변수.
const BASE = {
  simcore: '0.1',
  meta: { id: 'diagai', title: '진단 오탐 표본', version: 1 },
  vars: [
    { id: 'aff', label: '호감도', type: 'int', min: 0, max: 100, init: 10 },
    { id: 'confessed', label: '고백함', type: 'bool', init: false },
    { id: 'gauge', label: '보일러', type: 'int', min: 0, max: 100, init: 60 },
    { id: 'hall', label: '복도 조명', type: 'int', min: 0, max: 100, init: 60 },
    { id: 'hall_alert', label: '조명 경보', type: 'bool', init: false },
    { id: 'money', label: '통장', type: 'int', min: 0, max: 999999, init: 1000 },
    { id: 'owed', label: '미납', type: 'int', min: 0, max: 999999, init: 300 },
    { id: 'pay_tmp', label: '수금 계산용', type: 'int', min: 0, max: 999999, init: 0 },
  ],
  rules: {
    onTurn: [{ set: 'owed', expr: 'min(999999, owed + 5)' }],
    events: [
      // (1) AI만이 올릴 수 있는 문턱 — 시뮬에서는 영영 10에 머문다
      { id: 'to_friend', when: 'aff >= 35', once: true, notify: '친구가 되었다.', effects: [] },
      // (2) AI만이 세우는 bool에 걸린 이벤트 — "바꿀 수단이 없다"는 말이 사실이 아니다
      { id: 'ready', when: 'confessed', once: true, notify: '연인이 되었다.', effects: [] },
      // (3) 래치 짝 — 위기가 안 뜨면 경보도 안 켜지고 회복도 못 뜬다 (연쇄).
      //     복도 조명은 일부러 allow에 **안** 넣었다 — 여기가 이 표본의 진짜 원인이어야 한다.
      { id: 'h_crisis', when: 'hall <= 15 and not hall_alert', notify: '복도가 캄캄해졌다.',
        effects: [{ set: 'hall_alert', expr: 'true' }] },
      { id: 'h_ok', when: 'hall >= 45 and hall_alert', notify: '불이 들어왔다.',
        effects: [{ set: 'hall_alert', expr: 'false' }] },
    ],
    randomEvents: { chancePerTurn: 0.3, table: [
      { id: 'shock', weight: 1, cooldown: 3, notify: '설비가 덜컹였다.',
        effects: [{ set: 'gauge', expr: 'max(0, gauge - rand(1, 3))' },
          { set: 'hall', expr: 'max(0, hall - rand(1, 3))' }] },
    ] },
  },
  actions: [
    // (4) 계산용 임시 변수 — 같은 효과 묶음에서 세웠다가 0으로 되돌린다
    { id: 'collect', label: '📥 수금', mode: 'oneshot', effects: [
      { set: 'pay_tmp', expr: 'min(owed, 200)' },
      { set: 'owed', expr: 'owed - pay_tmp' },
      { set: 'money', expr: 'money + pay_tmp' },
      { set: 'pay_tmp', expr: '0' },
    ], inject: 'Collect rent.' },
    { id: 'repair', label: '🔧 보수', mode: 'oneshot', cooldown: 2, effects: [
      { set: 'gauge', expr: 'min(100, gauge + 8)' },
      { set: 'hall', expr: 'min(100, hall + 8)' },
    ], inject: 'Repair.' },
    // (5) AI만이 열 수 있는 액션
    { id: 'confess', label: '💗 고백', mode: 'oneshot', when: 'aff >= 60', effects: [], inject: 'Confess.' },
  ],
  updater: { enabled: true, contextTurns: 2, allow: [
    { id: 'aff', maxGain: 6, maxLoss: 12 },
    { id: 'confessed' },
    { id: 'gauge', maxGain: 0, maxLoss: 15 },   // 시설 게이지는 깎이기만 한다
  ] },
  statusUI: { groups: [{ label: '상태', items: [
    { var: 'aff' }, { var: 'confessed' }, { var: 'gauge' }, { var: 'hall' }, { var: 'hall_alert' },
    { var: 'money' }, { var: 'owed' }, { var: 'pay_tmp' },
  ] }] },
  promptState: { template: '[상태] 호감 {aff} · 보일러 {gauge} · 통장 {money}' },
};

{
  const v = validateSchema(BASE);
  ck('표본 스키마가 검증을 통과함', v.ok, v.errors.map((e) => `${e.path} ${e.msg}`).join(' / '));
}

const r = diagnose(cp(BASE), FAST);
ck('진단이 완주함', r.ran, JSON.stringify(r.findings.slice(0, 2)));

// ── 1. 설정 의존이 allow를 본다 (틀린 문장 제거) ────────────
{
  const f = about(r, 'ready').find((x) => x.tag === '설정 의존');
  ck('★ AI가 세우는 bool에 걸린 이벤트를 설정 의존으로 짚음', !!f,
    about(r, 'ready').map((x) => x.tag).join(','));
  ck('★ "바꿀 수단이 없습니다"라고 하지 않음', !!f && !/바꿀 수단이 없습니다/.test(f.text), f?.text ?? '');
  ck('보조 AI가 세운다고 말해 줌', !!f && /보조 AI/.test(f.text), f?.text ?? '');
  ck('등급이 low로 내려가 수정 요청에 안 실림', f?.sev === 'low', f?.sev ?? '(없음)');
  ck('탭 배정이 없어 변수 탭 요청에도 안 실림', f?.tab == null, String(f?.tab));
}

// 반례 — 정말로 아무도 안 세우는 bool이면 예전 문장 그대로여야 한다
{
  const s = cp(BASE);
  s.updater.allow = s.updater.allow.filter((a) => a.id !== 'confessed');
  const r2 = diagnose(s, FAST);
  const f = about(r2, 'ready').find((x) => x.tag === '설정 의존');
  ck('★ 반례: 아무도 안 세우면 여전히 "바꿀 수단이 없습니다"', !!f && /바꿀 수단이 없습니다/.test(f.text), f?.text ?? '');
  ck('반례: 등급도 mid로 유지', f?.sev === 'mid', f?.sev ?? '(없음)');
}

// ── 2. AI 담당 문턱 — 죽은 이벤트·못 쓰는 액션 ──────────────
{
  const f = about(r, 'to_friend').find((x) => x.tag === 'AI 담당 문턱');
  ck('★ AI가 올리는 값의 문턱을 "죽은 이벤트"라 하지 않음', !!f,
    about(r, 'to_friend').map((x) => `${x.tag}/${x.sev}`).join(','));
  ck('문턱을 내리지 말라고 말해 줌', !!f && /문턱을 내리지 마세요/.test(f.text), f?.text ?? '');
  ck('등급 low', f?.sev === 'low', f?.sev ?? '(없음)');
  ck('죽은 이벤트 집계에서도 빠짐', !about(r, 'to_friend').some((x) => x.tag === '죽은 이벤트'), '');
}
{
  const f = r.findings.find((x) => x.tag === 'AI 담당 문턱' && /고백/.test(x.text));
  ck('★ AI가 올리는 값이 여는 액션을 "못 쓰는 액션"이라 하지 않음', !!f,
    r.findings.filter((x) => /고백/.test(x.text)).map((x) => `${x.tag}/${x.sev}`).join(','));
  ck('못 쓰는 액션(🔴)으로 중복 신고하지 않음', !r.findings.some((x) => x.tag === '못 쓰는 액션' && /고백/.test(x.text)), '');
}

// 반례 — 방향이 반대면(AI가 깎기만 하는 값의 상승 문턱) 면제하지 않는다
{
  const s = cp(BASE);
  s.rules.events.push({ id: 'g_full', when: 'gauge >= 95', once: true, notify: '새 보일러.', effects: [] });
  const r2 = diagnose(s, FAST);
  const f = about(r2, 'g_full')[0];
  ck('★ 반례: maxGain 0인 값의 상승 문턱은 AI 담당이 아님', f && f.tag !== 'AI 담당 문턱',
    f ? `${f.tag}/${f.sev}` : '(지적 없음)');
}

// ── 3. 죽은 이벤트의 연쇄 — 래치 짝이 지적을 세 배로 늘리지 않는다 ──
{
  const ok = about(r, 'h_ok');
  ck('★ 회복 이벤트를 연쇄로 접음', ok.some((x) => x.tag === '연쇄'), ok.map((x) => `${x.tag}/${x.sev}`).join(','));
  ck('회복 이벤트를 죽은 이벤트로 중복 신고하지 않음', !ok.some((x) => x.tag === '죽은 이벤트'), '');
  ck('원인 이벤트 이름을 짚어 줌', ok.some((x) => /h_crisis/.test(x.text)), ok.map((x) => x.text).join(' / '));
  // ★★ 위기 쪽은 접히면 안 된다 — `not 경보`는 막는 조건이 아니다.
  //    문자열로 "조건에 경보가 나온다"만 봤다면 여기서 원인까지 사라진다.
  const cr = about(r, 'h_crisis');
  ck('★★ 원인(위기) 이벤트는 그대로 신고됨', cr.some((x) => x.tag === '죽은 이벤트'),
    cr.map((x) => `${x.tag}/${x.sev}`).join(','));
}
{
  ck('★ 경보 플래그를 "안 움직임"으로 또 신고하지 않음',
    !about(r, 'hall_alert').some((x) => x.tag === '안 움직임'),
    about(r, 'hall_alert').map((x) => x.tag).join(','));
  ck('대신 연쇄로 한 줄 요약함', has(r, /^연쇄$/), '');
}

// ── 4. 효과 안에서 되돌리는 계산용 임시 변수 ────────────────
{
  ck('★ pay_tmp를 "안 움직임"으로 신고하지 않음',
    !about(r, 'pay_tmp').some((x) => x.tag === '안 움직임'),
    about(r, 'pay_tmp').map((x) => x.tag).join(','));
  ck('임시 변수로 인식했다고 통계에 남김', r.stats.scratchVars >= 1, String(r.stats.scratchVars));
}
// 반례 — 마지막 대입이 시작값이 아니면 임시 변수가 아니다 (누적되는 진짜 자원)
{
  const s = cp(BASE);
  s.actions[0].effects[3] = { set: 'pay_tmp', expr: 'pay_tmp + 1' };
  const r2 = diagnose(s, FAST);
  ck('★ 반례: 되돌리지 않으면 임시 변수로 안 봄', (r2.stats.scratchVars ?? 0) === 0, String(r2.stats.scratchVars));
}

// ── 5. AI도 함께 바꾸는 값의 "안 움직임"은 low로 ─────────────
{
  const s = cp(BASE);
  // 액션이 만지지만 조건 때문에 실제로는 안 움직이는 값 + AI도 담당
  s.vars.push({ id: 'her_cash', label: '소지금', type: 'int', min: 0, max: 999999, init: 0 });
  s.statusUI.groups[0].items.push({ var: 'her_cash' });
  s.actions[0].effects.push({ set: 'her_cash', expr: 'her_cash - min(her_cash, 10)' });
  s.updater.allow.push({ id: 'her_cash', maxGain: 3000, maxLoss: 8000 });
  const r2 = diagnose(s, FAST);
  const f = about(r2, 'her_cash').find((x) => x.tag === '안 움직임');
  ck('★ AI도 담당하는 값의 안 움직임은 low', !f || f.sev === 'low', f ? `${f.sev}` : '(지적 없음)');
  ck('AI 때문에 못 잰다고 덧붙임', !f || /보조 AI도/.test(f.text), f?.text ?? '');
}

// ── 6. 총량 — 같은 봇에서 수정 요청에 실리는 지적이 줄었는가 ──
{
  const fixable = r.findings.filter((f) => f.sev !== 'low');
  ck('★ 이 표본에서 수정 요청에 실리는 지적은 원인 하나뿐', fixable.length === 1,
    fixable.map((f) => `${f.tag}: ${f.text.slice(0, 40)}`).join(' / '));
  ck('그 하나가 진짜 원인(위기 이벤트)임', fixable[0] && /h_crisis/.test(fixable[0].text),
    fixable[0]?.text ?? '');
}

// ── 7. 어댑터 버전 ─────────────────────────────────────────
ck('어댑터 버전이 0.52 이상', /\/\/@version 0\.(5[2-9]|[6-9]\d)/.test(src), '');

const bad = R.filter(([c]) => !c);
for (const [c, n, x] of R) if (!c) console.log(`  ✗ ${n}${x ? ` — ${x}` : ''}`);
console.log(`\n[test-diagai] ${R.length - bad.length}/${R.length} 통과`);
process.exit(bad.length ? 1 : 0);
