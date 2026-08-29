const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.50 AI 제작 다듬기 — 규격서 once/래치·시간 절 + 린트 2종 + once 재교차 진단 + romance time 실물
//
// 배경(실측, docs/ai-mistakes.md): 맨션봇 시설 패치에서 AI가 반복 게이지 위기에 once를 써
// 두 번째 고장부터 침묵 — 원인은 규격서 문장이 해법으로 once만 이름을 댄 것. 급여일 이벤트는
// 래치가 없어 그 날 내내 매 턴 지급 — 진단 시뮬은 하루=1턴 가정이라 원리적으로 못 보는 사각지대.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { diagnose } = SC.require('diagnose');
const { TEMPLATES } = SC.require('templates');
const engine = SC.require('engine');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 1. 린트: 시간 등호 + 래치 없음 (explicit 전용) ─────────────
const BASE = {
  simcore: '0.1', meta: {},
  time: { start: '2026-04-01', advance: 'explicit' },
  vars: [
    { id: 'cash', label: '현금', type: 'int', init: 0, min: 0 },
    { id: 'paid_m', label: '지급 월', type: 'int', init: 0, min: 0, max: 12 },
    { id: 'billed', label: '청구됨', type: 'bool', init: false },
    { id: 'skip_day', label: '일', type: 'int', init: 0, min: 0, max: 30 },
  ],
  updater: { allow: [{ id: 'skip_day', maxGain: 7 }] },
  rules: {
    events: [
      { id: 'wage_bad', when: 'dom == 5', effects: [{ set: 'cash', expr: 'cash + 100' }], notify: 'w' },
      { id: 'wage_latch', when: 'dom == 5 and paid_m != month', effects: [{ set: 'cash', expr: 'cash + 100' }, { set: 'paid_m', expr: 'month' }], notify: 'w' },
      { id: 'bill_latch', when: 'dom == 1 and not billed', effects: [{ set: 'billed', expr: 'true' }], notify: 'b' },
      { id: 'wage_once', when: 'dom == 5', once: true, effects: [], notify: 'w' },
    ],
    randomEvents: { chancePerTurn: 0.2, table: [
      { id: 'season_mood', when: 'season == "겨울"', weight: 1, cooldown: 5, effects: [], notify: 's' },
    ] },
  },
};
{
  const v = validateSchema(BASE);
  const eq = v.warnings.filter((w) => w.msg.includes('시간 등호'));
  ck('★ 무래치 시간 등호만 잡는다 (wage_bad)', eq.length === 1 && eq[0].msg.includes('wage_bad'), J(eq.map((w) => w.msg.slice(0, 50))));
  ck('래치 패턴(월 기록·bool 플래그)은 통과', !eq.some((w) => w.msg.includes('wage_latch') || w.msg.includes('bill_latch')), '');
  ck('once는 이 린트에서 제외 (재발은 진단 몫)', !eq.some((w) => w.msg.includes('wage_once')), '');
  ck('랜덤 표의 계절 분위기는 안 잡는다 (추첨+쿨다운이 빈도 조절)', !eq.some((w) => w.msg.includes('season_mood')), '');

  const pt = clone(BASE);
  pt.time.advance = 'perTurn';
  ck('perTurn(1턴=1일)은 등호 린트 없음', !validateSchema(pt).warnings.some((w) => w.msg.includes('시간 등호')), '');
  const nt = clone(BASE);
  delete nt.time;
  ck('time 없는 봇은 등호 린트 없음', !validateSchema(nt).warnings.some((w) => w.msg.includes('시간 등호')), '');
}

// ── 2. 린트: 지시문이 보조 담당 변수를 지목 ───────────────────
{
  const s = clone(BASE);
  s.directives = [
    { id: 'gate', when: 'cash >= 0', text: 'When a night passes, set the flag skip_day to 1 exactly once.' },
    { id: 'shows', when: 'cash >= 0', text: 'Narrate the morning. Days skipped so far: {skip_day}.' },
    { id: 'prose', when: 'cash >= 0', text: 'Write the scene in continuous prose without headers.' },
  ];
  const v = validateSchema(s);
  const dw = v.warnings.filter((w) => w.msg.includes('보조 AI 담당 변수'));
  ck('★ 지시문의 보조 변수 조작 지시를 잡는다 (gate)', dw.length === 1 && dw[0].msg.includes("'skip_day'"), J(dw.map((w) => w.msg.slice(0, 60))));
  ck('{자리표시자} 표시용은 통과', !dw.some((w) => w.msg.includes('shows')), '');
  ck('desc/guide로 옮기라는 처방 포함', dw[0] && dw[0].msg.includes('desc'), '');
  // 일반 영단어 id는 오탐 방지로 제외 — 'stage'가 산문에 나와도 침묵
  const s2 = clone(BASE);
  s2.vars.push({ id: 'stage', label: '단계', type: 'enum', enum: ['a', 'b'], init: 'a' });
  s2.updater.allow.push({ id: 'stage' });
  s2.directives = [{ id: 'tier', when: 'cash >= 0', text: 'Advance the stage of the relationship only after the narrative crossed the line.' }];
  ck("일반 영단어 id('_' 없음)는 안 잡는다", !validateSchema(s2).warnings.some((w) => w.msg.includes('보조 AI 담당 변수')), '');
}

// ── 3. 진단: once 재발 눌림 (재교차 관측) ─────────────────────
{
  const s = {
    simcore: '0.1', meta: {},
    vars: [{ id: 'g', label: '게이지', type: 'int', init: 50, min: 0, max: 100 }],
    rules: {
      onTurn: [{ set: 'g', expr: 'g - 7' }],
      events: [
        { id: 'crisis_once', once: true, when: 'g <= 20', effects: [{ set: 'g', expr: '80' }], notify: 'c' },
        { id: 'reset', when: 'g <= 5', effects: [{ set: 'g', expr: '80' }], notify: 'r' },
      ],
    },
  };
  const d = diagnose(s, { turns: 40, runs: 2, actionImpact: false });
  ck('★ 재교차하는 once를 잡는다', d.findings.some((f) => f.tag === 'once 재발 눌림' && f.text.includes('crisis_once')), '');
  ck('처방은 래치 짝', d.findings.find((f) => f.tag === 'once 재발 눌림')?.text.includes('래치'), '');

  // 단조 도달 이정표(계속 참)는 안 잡는다 — survived류 정상 설계 보호
  const s2 = {
    simcore: '0.1', meta: {},
    vars: [{ id: 'g', label: '게이지', type: 'int', init: 0, min: 0, max: 100 }],
    rules: { onTurn: [{ set: 'g', expr: 'min(g + 5, 100)' }],
      events: [{ id: 'milestone', once: true, when: 'g >= 30', effects: [], notify: 'm' }] },
  };
  const d2 = diagnose(s2, { turns: 40, runs: 2, actionImpact: false });
  ck('★ 계속 참인 이정표는 안 잡는다', !d2.findings.some((f) => f.tag === 'once 재발 눌림'), '');
}

// ── 4. 규격서 — 문장이 실수를 가르치지 않는가 ─────────────────
{
  ck('★ 번들: once는 일회성 전개 전용 명시', src.includes('일회성 전개 전용') && src.includes('두 번째 위기부터 영영 침묵'), '');
  ck('번들: 래치 짝 예제 실물', src.includes('boiler_crisis') && src.includes('boiler_ok') && src.includes('boiler_alert'), '');
  ck('번들: 조건 이벤트에 쿨다운 없음 명시', src.includes('조건 이벤트에는 쿨다운이 없습니다'), '');
  ck('★ 번들: 옛 문구("once 없이 조건만 두면") 제거', !src.includes('once` 없이 조건만 두면'), '');
  ck('★ 번들: 시간 진행 절 — onTurn day+1 금지', src.includes('onTurn에 `day + 1`을 넣지 마세요'), '');
  ck('번들: skip 규칙은 desc (지시문은 메인 전용)', src.includes('메인 모델 전용이라 상태를 갱신하는 보조 AI가 못 읽습니다'), '');
  ck('번들: 시간 등호 래치 규칙', src.includes('시간 등호 조건은 래치가 필요합니다'), '');
}

// ── 5. 패치 다이제스트 — 시간 체계 동봉 ───────────────────────
{
  const seg = src.slice(src.indexOf('function patchIdDigest'), src.indexOf('function buildPatchExportPrompt'));
  const M = new Function('varContractTable', 'timeConfig', seg + '\nreturn patchIdDigest;')(
    () => '(변수표)', SC.require('time').timeConfig);
  const dig = M(BASE);
  ck('★ 다이제스트에 시간 체계 블록', dig.includes('시간 체계') && dig.includes('`dom`') && dig.includes('편집기 [시간] 탭 전용'), '');
  const noTime = clone(BASE); delete noTime.time;
  ck('time 없으면 다이제스트에 블록 없음', !M(noTime).includes('시간 체계'), '');
}

// ── 6. romance 템플릿 — time 실물 채택 ────────────────────────
{
  const r = TEMPLATES.romance.schema;
  ck('★ romance: onTurn에 day+1 없음', !(r.rules.onTurn || []).some((x) => x.set === 'day'), '');
  ck('romance: time 섹션 (explicit)', r.time && r.time.advance === 'explicit', '');
  ck('romance: 진행 입구 skip_day·skip_min + desc', r.vars.some((v) => v.id === 'skip_day' && v.desc) && r.vars.some((v) => v.id === 'skip_min' && v.desc), '');
  ck('romance: allow에 skip 캡', (r.updater.allow || []).some((a) => a.id === 'skip_day' && a.maxGain), '');
  ck('romance: 🌙 하루 마무리 액션', (r.actions || []).some((a) => a.id === 'end_day'), '');
  const v = validateSchema(r);
  ck('★ romance 검증 통과 경고 0', v.ok && v.warnings.length === 0, J(v.warnings));
  // 실동작 (v0.99 하루 경계 넘김): 08:30 시작 → 90분 장면 → 🌙(깃발만) → 보조가
  // "아침" 장면으로 읽어 오면 동기화 → 이튿날 08:00
  let st = engine.initState(r);
  st.meta.setupDone = true; // 세션 0 건너뜀
  let o = engine.outputPhase(r, st, { skip_min: 90 }, {}, {});
  const L = (s2) => engine.makeLookup(r, s2.vars);
  ck('romance: 장면 90분 흐름', L(o.state)('clock') === '10:00', L(o.state)('clock'));
  const t = engine.toggleAction(r, o.state, 'end_day');
  let send = engine.sendPhase(r, t.state, {});
  ck('★ romance: 🌙 직후 — 시계 유지 + 깃발 (아침 선반영 안 함)',
    L(send.state)('clock') === '10:00' && send.state.vars.day_break === true,
    L(send.state)('clock') + ' ' + String(send.state.vars.day_break));
  const o2 = engine.outputPhase(r, send.state, { wake_at: '아침' }, {}, {});
  send = engine.sendPhase(r, o2.state, {});
  ck('★ romance: 🌙 + 아침 판독 → 이튿날 08:00', L(send.state)('clock') === '08:00' && L(send.state)('date') === '3월 3일',
    L(send.state)('date') + ' ' + L(send.state)('clock'));
}

// ── 7. 전 템플릿 오탐 0 — 새 린트·진단이 정상 설계를 안 잡는가 ──
{
  let bad = [];
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const v = validateSchema(t.schema);
    for (const w of v.warnings) {
      if (w.msg.includes('시간 등호') || w.msg.includes('보조 AI 담당 변수')) bad.push(`${k}:${w.msg.slice(0, 40)}`);
    }
    const d = diagnose(t.schema, { turns: 30, runs: 2, actionImpact: false });
    for (const f of d.findings) if (f.tag === 'once 재발 눌림') bad.push(`${k}:${f.text.slice(0, 40)}`);
  }
  ck('★ 전 템플릿에 새 지적 0', bad.length === 0, J(bad));
  ck('어댑터 버전은 0.50 이상', /\/\/@version 0\.(5[0-9]|[6-9]\d)/.test(src), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
