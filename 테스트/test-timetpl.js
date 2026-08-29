const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.51 템플릿 시간 체계 전환 — survival·vtuber(perTurn) · daily(explicit+시계) + 프리셋 startAt
//
// 배경: v0.50에서 "예제가 규칙을 이긴다"를 원칙으로 세워 놓고, 정작 템플릿 셋이 여전히
// `onTurn day+1`을 실물로 보여주고 있었다 (docs/ai-mistakes.md #4). 규격서가 금지한 패턴이
// 코퍼스에 남아 있으면 AI는 코퍼스를 베낀다 — 그래서 남은 셋을 전부 걷어냈다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const { diagnose } = SC.require('diagnose');
const engine = SC.require('engine');
const time = SC.require('time');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;
const L = (s, st) => engine.makeLookup(s, st.vars);
const run = (s, st, n, seed = 'z') => {
  for (let i = 0; i < n; i++) {
    st = engine.sendPhase(s, st, { rng: seededRng(seed, i, 'a') }).state;
    st = engine.outputPhase(s, st, {}, {}, { rng: seededRng(seed, i, 'b') }).state;
  }
  return st;
};

// ── 0. 코퍼스 전체 — onTurn에 날짜 카운터가 하나도 없다 ───────
{
  // 규격서가 금지한 것은 **날짜(day) 카운터**다 — 장면 단위 RP를 부수는 것이 그것이라서.
  // business의 `month`(1턴=1개월)·politics의 `week`(1턴=1주)는 표시용 굵은 단위 카운터로,
  // 지금의 time 섹션이 표현할 수 없다(perTurn = 1일/턴 고정). 알려진 한계 — docs/ai-mistakes.md.
  const COARSE = new Set(['business:month', 'politics:week']);
  const bad = [];
  for (const [k, t] of Object.entries(TEMPLATES)) {
    for (const r of (t.schema.rules?.onTurn || [])) {
      const key = `${k}:${r.set}`;
      if (COARSE.has(key)) continue;
      if (/^(day|days|date|clock|hour|minute|elapsed|week|month|year)/.test(r.set || '')) bad.push(key);
    }
  }
  ck('★ 전 템플릿 onTurn에 날짜(day) 카운터 0 (규격서가 금지한 패턴이 코퍼스에 없다)', bad.length === 0, J(bad));
  // 굵은 단위 카운터는 여전히 둘뿐인가 — 늘어나면 이 테스트가 알려 준다
  const coarse = [];
  for (const [k, t] of Object.entries(TEMPLATES)) {
    for (const r of (t.schema.rules?.onTurn || [])) {
      if (/^(week|month|year)$/.test(r.set || '')) coarse.push(`${k}:${r.set}`);
    }
  }
  ck('굵은 단위 카운터는 알려진 둘뿐 (business 개월 · politics 주)',
    coarse.length === 2 && coarse.every((x) => COARSE.has(x)), J(coarse));
  const withTime = Object.entries(TEMPLATES).filter(([, t]) => t.schema.time).map(([k]) => k);
  ck('시간 체계를 쓰는 템플릿이 넷 (survival·vtuber·daily·romance)',
    ['survival', 'vtuber', 'daily', 'romance'].every((k) => withTime.includes(k)), J(withTime));
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const v = validateSchema(t.schema);
    ck(`템플릿 '${k}' 검증 통과 (경고 ${v.warnings.length})`, v.ok, J(v.errors));
  }
}

// ── 1. survival — perTurn이 옛 day+1과 같은 속도 ──────────────
{
  const s = TEMPLATES.survival.schema;
  ck('survival: perTurn', s.time.advance === 'perTurn', J(s.time));
  let st = engine.initState(s);
  ck('시작이 1일차', L(s, st)('day_no') === 1 && L(s, st)('date') === '12월 1일', L(s, st)('date'));
  st = run(s, engine.initState(s), 29, 's1');
  ck('★ 29턴 후 30일차 (옛 `day` 변수와 같은 속도)', L(s, st)('day_no') === 30, String(L(s, st)('day_no')));
  ck('진짜 달력이라 날짜가 맞는다 (12/1 + 29일)', L(s, st)('date') === '12월 30일', L(s, st)('date'));
  ck('요일이 생겼다', typeof L(s, st)('weekday') === 'string' && L(s, st)('weekday').length === 1, '');
  // survived 이벤트가 30일차에 걸린다 (붕괴 안 한 판에서)
  const ev = s.rules.events.find((e) => e.id === 'survived');
  ck('survived 조건이 day_no 기준', ev.when.includes('day_no >= 30'), ev.when);
  ck('survived는 once가 옳은 자리 (다시 안 오는 전개)', ev.once === true, '');
}

// ── 2. vtuber — perTurn ───────────────────────────────────────
{
  const s = TEMPLATES.vtuber.schema;
  ck('vtuber: perTurn', s.time.advance === 'perTurn', '');
  ck('day 변수가 사라짐 (파생으로 대체)', !s.vars.some((v) => v.id === 'day')
    && s.derived.some((d) => d.id === 'day_no'), '');
  let st = run(s, engine.initState(s), 6, 'v1');
  ck('★ 6턴 후 7일차', L(s, st)('day_no') === 7, String(L(s, st)('day_no')));
  ck('시작이 월요일 (요일이 서술 근거가 된다)', L(s, engine.initState(s))('weekday') === '월', '');
  ck('프롬프트에 날짜·요일', s.promptState.template.includes('{date}') && s.promptState.template.includes('{weekday}'), '');
}

// ── 3. daily — 시간대 enum → 진짜 시계 ────────────────────────
{
  const s = TEMPLATES.daily.schema;
  ck('daily: explicit', s.time.advance === 'explicit', '');
  ck('★ 옛 day·time 변수가 사라짐', !s.vars.some((v) => v.id === 'day' || v.id === 'time'), '');
  ck('때(tod)가 시각에서 나오는 파생', s.derived.some((d) => d.id === 'tod' && d.expr.includes('hour')), '');
  ck('★ skip_day가 없다 — 날짜는 버튼으로만 (이 템플릿의 선언)',
    !s.vars.some((v) => v.id === 'skip_day'), '');
  ck('skip_min은 allow에 캡과 함께', (s.updater.allow || []).some((a) => a.id === 'skip_min' && a.maxGain === 240), '');
  ck('진행 규칙이 desc에 산다 (지시문은 메인 전용)',
    (s.vars.find((v) => v.id === 'skip_min')?.desc || '').includes('분'), '');

  let st = engine.initState(s);
  ck('시작: 월요일 아침 08:00', L(s, st)('clock') === '08:00' && L(s, st)('tod') === '아침'
    && L(s, st)('weekday') === '월', `${L(s, st)('clock')} ${L(s, st)('tod')}`);

  // 보조가 장면 시간 보고 → 시계가 분 단위로 흐른다 (옛 enum으로는 불가능했던 것)
  let o = engine.outputPhase(s, st, { skip_min: 90 }, {}, {});
  ck('★ 90분 장면 → 09:30 (분 단위)', L(s, o.state)('clock') === '09:30', L(s, o.state)('clock'));
  ck('때는 그대로 아침', L(s, o.state)('tod') === '아침', '');
  ck('캡 240분 — 한 번에 하루를 못 넘긴다',
    L(s, engine.outputPhase(s, st, { skip_min: 900 }, {}, {}).state)('clock') === '12:00', '');

  // 🕐 시간을 보낸다 = 2시간
  const t1 = engine.toggleAction(s, o.state, 'pass_time');
  const send1 = engine.sendPhase(s, t1.state, {});
  ck('🕐 버튼 = 2시간 (11:30)', L(s, send1.state)('clock') === '11:30', L(s, send1.state)('clock'));
  ck('때가 낮으로 넘어감', L(s, send1.state)('tod') === '낮', L(s, send1.state)('tod'));

  // 늦은 시각 지시문이 hour로 걸린다
  const night = engine.outputPhase(s, engine.outputPhase(s, send1.state, { skip_min: 240 }, {}, {}).state,
    { skip_min: 240 }, {}, {}).state;
  const sendN = engine.sendPhase(s, night, {});
  ck('★ 밤 19:30 → 저녁, late_hour 아직 아님', L(s, sendN.state)('tod') === '저녁'
    && !sendN.activeDirectives.includes('late_hour'), L(s, sendN.state)('clock'));
  const late = engine.sendPhase(s, engine.outputPhase(s, sendN.state, { skip_min: 120 }, {}, {}).state, {});
  ck('21:30 → 밤, late_hour 활성', L(s, late.state)('tod') === '밤'
    && late.activeDirectives.includes('late_hour'), L(s, late.state)('clock'));

  // 💤 (v0.99 하루 경계 넘김) — 깃발 → 보조가 장면의 시간대(wake_at)를 읽어 오면 동기화.
  // "다음으로 돌아오는 그 시간대" 공식이라 밤에 자면 이튿날, 새벽에 자면 같은 날이 된다.
  const t2 = engine.toggleAction(s, late.state, 'end_day');
  let send2 = engine.sendPhase(s, t2.state, {});
  ck('💤 직후 — 시계 유지 + 깃발 (아침 선반영 안 함)', send2.state.vars.day_break === true
    && L(s, send2.state)('clock') === '21:30', L(s, send2.state)('clock'));
  send2 = engine.sendPhase(s, engine.outputPhase(s, send2.state, { wake_at: '아침' }, {}, {}).state, {});
  ck('★ 밤에 💤 + 아침 판독 → 이튿날 08:00', L(s, send2.state)('date') === '5월 19일'
    && L(s, send2.state)('clock') === '08:00', `${L(s, send2.state)('date')} ${L(s, send2.state)('clock')}`);
  // 새벽에 💤 → **같은 날** 아침 (무조건 +1일이면 29시간을 자게 된다 — 옛 공식의 미덕 유지)
  let dawn = engine.outputPhase(s, engine.initState(s), { skip_min: 240 }, {}, {}).state; // 12:00
  for (let i = 0; i < 4; i++) dawn = engine.outputPhase(s, dawn, { skip_min: 180 }, {}, {}).state; // 24:00 → 03:00
  ck('새벽 03:00 상태', L(s, dawn)('clock') === '00:00' || L(s, dawn)('tod') === '새벽', L(s, dawn)('clock'));
  const t3 = engine.toggleAction(s, dawn, 'end_day');
  let send3 = engine.sendPhase(s, t3.state, {});
  send3 = engine.sendPhase(s, engine.outputPhase(s, send3.state, { wake_at: '아침' }, {}, {}).state, {});
  ck('★ 새벽에 💤 + 아침 판독 → 같은 날 아침 08:00 (29시간 수면 방지)',
    L(s, send3.state)('clock') === '08:00', `${L(s, send3.state)('date')} ${L(s, send3.state)('clock')}`);
}

// ── 4. 프리셋 startAt (v0.51 신규) ────────────────────────────
{
  const s = TEMPLATES.daily.schema;
  const at = (pid) => {
    const r = engine.applyPreset(s, engine.initState(s), pid);
    return { d: L(s, r.state)('date'), w: L(s, r.state)('weekday'), c: L(s, r.state)('clock'), st: r.state };
  };
  ck('startAt 없는 프리셋은 기본 시작 시점', at('plain').d === '5월 18일' && at('plain').c === '08:00', J(at('plain')));
  const w = at('weekend');
  ck('★ 주말 프리셋이 토요일 오후에 시작', w.d === '5월 16일' && w.w === '토' && w.c === '13:00', J(w));
  ck('startAt과 set이 함께 적용됨', w.st.vars.money === 120000 && w.st.vars.place === '단골 카페', '');
  const t = at('tight');
  ck('월말 프리셋이 29일에 시작', t.d === '5월 29일' && t.st.vars.money === 7000, J(t));

  // 검증 — 잘못된 startAt은 거부, time 없으면 경고
  const bad = JSON.parse(JSON.stringify(s));
  bad.setup.presets[1].startAt = '2026-02-30';
  ck('실재하지 않는 startAt 거부', !validateSchema(bad).ok, '');
  const noTime = JSON.parse(JSON.stringify(s));
  delete noTime.time;
  noTime.derived = []; noTime.directives = []; noTime.actions = [];
  noTime.promptState = { template: '{money}' };
  noTime.statusUI = { mode: 'auto', groups: [{ label: 'x', items: [{ var: 'money' }] }] };
  noTime.updater.allow = [{ id: 'money', maxDelta: 100 }];
  const vn = validateSchema(noTime);
  ck('★ time 없는데 startAt만 있으면 경고 (조용히 무시되지 않게)',
    vn.warnings.some((x) => x.msg.includes('startAt')), J(vn.warnings.map((x) => x.msg.slice(0, 40))));
}

// ── 5. 노출 이름 충돌 — 메시지가 원인을 말하는가 ──────────────
// 실측: 변수 탭을 통째로 갈아끼우면 새 파생(season/year)이 노출 이름과 부딪히는데,
// 예전엔 "중복된 id: 'season'"이라 파생 목록을 아무리 봐도 짝을 못 찾았다.
{
  const s = JSON.parse(JSON.stringify(TEMPLATES.survival.schema));
  s.derived.push({ id: 'season', label: '계절', expr: '1' });
  const v = validateSchema(s);
  const e = v.errors.find((x) => x.path.startsWith('$.derived'));
  ck('★ 파생↔노출 이름 충돌이 원인을 말한다', e && e.msg.includes('시간 체계가 이미 쓰는 이름'), e ? e.msg.slice(0, 60) : '오류 없음');
  ck('처방 두 갈래 (이름 바꾸기 / 노출 끄기)', e && e.msg.includes('[시간] 탭') && e.msg.includes('노출'), '');
  // 변수와의 충돌은 $.time.expose 쪽에서 알려 준다 (중복 신고 안 함)
  const s2 = JSON.parse(JSON.stringify(TEMPLATES.survival.schema));
  s2.vars.push({ id: 'hour', label: '시', type: 'int', init: 0, min: 0, max: 23 });
  const v2 = validateSchema(s2);
  ck('변수↔노출 충돌은 time.expose 경로로', v2.errors.some((x) => x.path === '$.time.expose' && x.msg.includes('hour')), '');
}

// ── 6. 진단 — 전환이 새 지적을 만들지 않았나 ──────────────────
{
  for (const k of ['survival', 'vtuber', 'daily', 'romance']) {
    const d = diagnose(TEMPLATES[k].schema, { turns: 30, runs: 2, actionImpact: false });
    const noisy = d.findings.filter((f) => /표시 안 됨.*skip_|안 움직임.*skip_/.test(f.text));
    ck(`'${k}': skip 우편함이 지적으로 안 뜬다 (엔진 소비라 늘 0)`, noisy.length === 0, J(noisy.map((f) => f.text.slice(0, 50))));
  }
  // daily는 explicit이라 시간 가정 안내가 뜬다 (정상 — 진단이 자기 가정을 밝힌다)
  const dd = diagnose(TEMPLATES.daily.schema, { turns: 30, runs: 2, actionImpact: false });
  ck('explicit 템플릿은 시간 가정을 밝힌다', dd.findings.some((f) => f.tag === '시간 가정'), '');
  const sd = diagnose(TEMPLATES.survival.schema, { turns: 30, runs: 2, actionImpact: false });
  ck('perTurn 템플릿엔 그 안내가 없다', !sd.findings.some((f) => f.tag === '시간 가정'), '');
}

// ── 7. 번들 — 편집기 예시가 새 패턴을 가르치는가 ──────────────
{
  ck('★ 번들: 이정표 예시가 day_no 기준', src.includes('"when": "day_no >= 30 and not collapsed"'), '');
  ck('번들: 이정표가 once의 한계를 같이 알린다', src.includes('두 번째부터 영영 침묵한다'), '');
  ck('★ 번들: 기한 만료 예시가 elapsed', src.includes('"expire": "elapsed"'), '');
  ck('번들: 프리셋 시작 시점 칸', src.includes('이 프리셋으로 시작할 때의 작중 날짜·시각'), '');
  ck('어댑터 버전이 v0.51 이상', /\/\/@version 0\.(5[1-9]|[6-9]\d)/.test(src), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
