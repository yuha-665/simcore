const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.61 달력 패널 (core/calendar.js)
//
// 핵심 설계: 일정 = list 변수 항목 + `@기한` 규약 재사용 (새 저장소 없음).
// 그래서 검증할 것은 셋 — (1) 날짜↔@D 변환이 expire 식의 시계와 어긋나지 않는가
// (2) 마킹 3종(기념일/일정/기한)이 맞는 칸에 앉는가 (3) 등록/삭제가 목록 규약을 지키는가.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const cal = SC.require('calendar');
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const { MIN_PER_DAY, EPOCH_KEY } = SC.require('time');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;
const clone = (o) => JSON.parse(J(o));

// 공용 픽스처 — 2026-03-02(월) 시작. 3월 1일은 일요일 → 3월 그리드 lead = 6 (월요일 기준).
const BASE = {
  simcore: '0.1',
  meta: { name: '달력 테스트' },
  time: { start: '2026-03-02 08:30', advance: 'explicit' },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 10, min: 0, max: 20 },
    { id: 'plans', label: '약속', type: 'list', init: [], maxItems: 3, itemMaxLength: 20 },
    { id: 'contracts', label: '계약', type: 'list', init: ['양모 계약 @5'] },
    { id: 'skip_day', label: '건너뛴 일수', type: 'int', init: 0, min: 0, max: 30 },
  ],
  rules: { onTurn: [
    { list: 'plans', expire: 'elapsed' },
    { list: 'contracts', expire: 'elapsed' },
  ] },
  updater: { allow: [{ id: 'hp', maxDelta: 5 }] },
  calendar: {
    label: '달력', icon: '📅', list: 'plans',
    marks: [
      { label: '생일', month: 3, dom: 14 },
      { label: '월세', dom: 1 },
      { label: '수업', weekday: '화' },
    ],
  },
};

// ── 1. 검증 ─────────────────────────────────────────────────
{
  const v = validateSchema(BASE);
  ck('★ 정상 달력 검증 통과', v.ok, J(v.errors));

  const noTime = clone(BASE);
  delete noTime.time;
  ck('★ 시간 체계 없으면 오류', validateSchema(noTime).errors.some((e) => /시간 체계/.test(e.msg)), '');

  const badList = clone(BASE);
  badList.calendar.list = 'hp';
  ck('일정 목록이 list가 아니면 오류', validateSchema(badList).errors.some((e) => /list 타입/.test(e.msg)), '');

  const noWhen = clone(BASE);
  noWhen.calendar.marks = [{ label: '언제?' }];
  ck('때가 없는 기념일은 오류', validateSchema(noWhen).errors.some((e) => /month.*dom.*weekday|언제인지/.test(e.msg)), J(validateSchema(noWhen).errors));

  const ghost = clone(BASE);
  ghost.calendar.marks = [{ label: '유령의 날', month: 2, dom: 30 }];
  ck('★ 없는 날짜(2/30)는 오류', validateSchema(ghost).errors.some((e) => /없는 날짜/.test(e.msg)), '');

  const badWd = clone(BASE);
  badWd.calendar.marks = [{ label: '오타', weekday: '회' }];
  ck('★ 요일 오타는 오류 (이 봇의 요일명 대조)', validateSchema(badWd).errors.some((e) => /요일 이름이 아닙/.test(e.msg)), '');

  const noExpire = clone(BASE);
  noExpire.rules.onTurn = [];
  const ne = validateSchema(noExpire);
  ck('만료 규칙 없으면 경고 (오류 아님)', ne.ok && ne.warnings.some((w) => /만료 규칙|저절로 안 지워/.test(w.msg)), J(ne.warnings));

  const noCal = clone(BASE);
  delete noCal.calendar;
  ck('calendar 없는 스키마는 그대로 통과', validateSchema(noCal).ok, '');
}

// ── 2. 버튼 사양 + 월 그리드 ────────────────────────────────
{
  ck('버튼 사양', J(cal.calendarButtonSpec(BASE)) === J({ label: '달력', icon: '📅' }), '');
  ck('calendar 없으면 버튼 null', cal.calendarButtonSpec({ vars: [] }) === null, '');
  const noTime = clone(BASE);
  delete noTime.time;
  ck('시간 없으면 버튼 null (검증과 같은 조건)', cal.calendarButtonSpec(noTime) === null, '');

  const state = engine.initState(BASE);
  const v = cal.monthView(BASE, state);
  ck('★ 오늘이 든 달 (2026년 3월)', v.year === 2026 && v.month === 3 && v.label === '2026년 3월', J([v.year, v.month]));
  ck('3월은 31칸', v.cells.length === 31, String(v.cells.length));
  ck('★ 2026-03-01은 일요일 — lead 6 (월요일 기준)', v.lead === 6, String(v.lead));
  ck('오늘(3/2) 표시', v.cells[1].today === true && v.cells[0].today === false, '');
  ck('달 이동 계산', J(v.prev) === J({ year: 2026, month: 2 }) && J(v.next) === J({ year: 2026, month: 4 }), '');
  const dec = cal.monthView(BASE, state, { year: 2026, month: 12 });
  ck('12월의 next는 이듬해 1월', J(dec.next) === J({ year: 2027, month: 1 }), '');

  // 마킹 3종
  const marksOf = (d) => v.cells[d - 1].marks.map((m) => `${m.kind}:${m.label}`);
  ck('★ 기념일 월+일 (3/14 생일)', marksOf(14).includes('mark:생일'), J(marksOf(14)));
  ck('★ 기념일 일만 = 매달 (3/1 월세)', marksOf(1).includes('mark:월세'), '');
  ck('★ 기념일 요일만 = 매주 (화요일 수업 — 3월에 5번)',
    v.cells.filter((c) => c.marks.some((m) => m.label === '수업')).length === 5
    && marksOf(3).includes('mark:수업'), J(v.cells.filter((c) => c.marks.some((m) => m.label === '수업')).map((c) => c.dom)));
  ck('다른 달에는 생일이 없다 (매년 3/14)',
    !cal.monthView(BASE, state, { year: 2026, month: 4 }).cells.some((c) => c.marks.some((m) => m.label === '생일')), '');
  // ⏳ 기한 — contracts의 @5는 elapsed 시계. 오늘 elapsed=0 → 5일 뒤 = 3/7
  ck('★ 다른 목록 @기한이 자동 표시 (3/7 계약)', marksOf(7).includes('due:양모 계약'), J(marksOf(7)));
}

// ── 3. 일정 등록/삭제 — 날짜↔@D 변환이 expire 시계와 맞물리는가 ──
{
  const state = engine.initState(BASE);
  const r = cal.addPlan(BASE, state, { year: 2026, month: 3, dom: 9, label: '영화 약속' });
  ck('★ 등록 — 3/9는 elapsed 7일', r.ok && r.item === '영화 약속 @7', J(r));
  state.vars.plans = [r.item];
  const v = cal.monthView(BASE, state);
  ck('★ 등록한 일정이 그 칸에 뜬다', v.cells[8].marks.some((m) => m.kind === 'plan' && m.label === '영화 약속'), J(v.cells[8].marks));

  // 시간이 흐른 뒤에도 (epoch 이동) 같은 칸에 남는가 — @D는 절대값이라 어긋나지 않는다
  const later = clone(state);
  later.vars[EPOCH_KEY] = Number(state.vars[EPOCH_KEY]) + 3 * MIN_PER_DAY; // 3일 뒤 (3/5)
  const v2 = cal.monthView(BASE, later);
  ck('★ 3일 지나도 일정은 3/9 그대로', v2.cells[8].marks.some((m) => m.label === '영화 약속'), '');
  ck('오늘 표시도 따라온다 (3/5)', v2.cells[4].today === true, '');

  ck('지난 날짜 거부', !cal.addPlan(BASE, later, { year: 2026, month: 3, dom: 3, label: 'x' }).ok, '');
  ck('빈 내용 거부', !cal.addPlan(BASE, state, { year: 2026, month: 3, dom: 10, label: '  ' }).ok, '');
  ck("'@'는 라벨에서 걷어낸다 (기한 표기 보호)",
    cal.addPlan(BASE, state, { year: 2026, month: 3, dom: 10, label: '약속@집' }).item === '약속집 @8', '');
  ck('없는 날짜 거부 (2월 30일)', !cal.addPlan(BASE, state, { year: 2026, month: 2, dom: 30, label: 'x' }).ok, '');
  state.vars.plans = ['a @7', 'b @8', 'c @9'];
  ck('가득 차면 거부 (maxItems 3)', !cal.addPlan(BASE, state, { year: 2026, month: 3, dom: 20, label: 'd' }).ok, '');
  ck('너무 길면 거부 (coerce가 @D를 자르기 전에)',
    !cal.addPlan(BASE, clone(engine.initState(BASE)), { year: 2026, month: 3, dom: 20, label: '아주아주아주아주아주아주긴약속이름' }).ok, '');

  const rm = cal.removePlan(BASE, state, 'b @8');
  ck('삭제 — 있는 항목만', rm.ok && rm.item === 'b @8', J(rm));
  ck('없는 항목 삭제 거부', !cal.removePlan(BASE, state, '유령 @9').ok, '');

  // 보기 전용 달력 (list 없음)
  const viewOnly = clone(BASE);
  delete viewOnly.calendar.list;
  const vo = cal.monthView(viewOnly, engine.initState(viewOnly));
  ck('list 없으면 등록 불가 표시', vo.canRegister === false, '');
  ck('list 없으면 addPlan 거부', !cal.addPlan(viewOnly, engine.initState(viewOnly), { year: 2026, month: 3, dom: 9, label: 'x' }).ok, '');
}

// ── 4. flat30 달력 + expire 시계 어긋남 케이스 ───────────────
{
  const F = clone(BASE);
  F.time = { start: '0001-01-01 08:00', calendar: 'flat30', advance: 'explicit' };
  F.calendar.marks = [{ label: '축제', month: 1, dom: 15 }];
  ck('flat30 검증 통과', validateSchema(F).ok, J(validateSchema(F).errors));
  const fv = cal.monthView(F, engine.initState(F));
  ck('★ flat30은 한 달 30칸', fv.cells.length === 30, String(fv.cells.length));
  ck('flat30 dom 31 기념일은 오류', (() => {
    const bad = clone(F); bad.calendar.marks = [{ label: 'x', dom: 31 }];
    return validateSchema(bad).errors.some((e) => /1~30/.test(e.msg));
  })(), '');

  // expire 식이 elapsed가 아니라 day_no(= elapsed + 1)여도 날짜가 안 어긋나는가 —
  // 변환이 [오늘 + (D − 식의 현재값)]이라 단위 오프셋이 저절로 상쇄된다.
  const OFF = clone(BASE);
  OFF.derived = [{ id: 'day_no', label: '일차', expr: 'elapsed + 1' }];
  OFF.rules.onTurn = [{ list: 'plans', expire: 'day_no' }];
  const os = engine.initState(OFF);
  const or_ = cal.addPlan(OFF, os, { year: 2026, month: 3, dom: 9, label: '영화' });
  ck('★ day_no 시계로 등록 — @8 (7일 뒤 + 1)', or_.ok && or_.item === '영화 @8', J(or_));
  os.vars.plans = [or_.item];
  ck('★ day_no 시계로도 3/9 칸에 뜬다',
    cal.monthView(OFF, os).cells[8].marks.some((m) => m.label === '영화'), '');
}

// ── 5. 연애 템플릿 — 달력 실물이 실제로 돈다 ────────────────
{
  const t = TEMPLATES.romance?.schema;
  ck('★ 연애 템플릿에 달력 탑재', !!t?.calendar, '');
  if (t?.calendar) {
    const v = validateSchema(t);
    ck('★ 템플릿 검증 통과', v.ok, J(v.errors));
    const state = engine.initState(t);
    const view = cal.monthView(t, state);
    ck('시작 달(2026년 3월)이 뜬다', view.year === 2026 && view.month === 3, '');
    ck('도서부 모임(수요일)이 매주 뜬다',
      view.cells.filter((c) => c.marks.some((m) => m.label === '도서부 모임')).length >= 4, '');
    const r = cal.addPlan(t, state, { year: 2026, month: 3, dom: 8, label: '영화 약속' });
    ck('템플릿에서 일정 등록 동작', r.ok && r.listId === 'plans', J(r));
    ck('plans가 AI 허용 목록에 있다 (서사 등록)', (t.updater.allow || []).some((a) => a.id === 'plans'), '');
    ck('만료 규칙이 있다 (자동 정리)', (t.rules.onTurn || []).some((r2) => r2.list === 'plans' && r2.expire), '');
  }
}

// ── 6. 규격서·패치 경로에 달력이 실렸는가 (v0.60 원칙) ──────
{
  const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
  const M = new Function('validateSchema', 'TEMPLATES', 'timeConfig', 'EXPOSED_LABELS',
    seg + '\nreturn { buildSchemaSpecPrompt, buildPatchExportPrompt, patchIdDigest };')(
    validateSchema, TEMPLATES, SC.require('time').timeConfig, SC.require('time').EXPOSED_LABELS);
  const p = M.buildSchemaSpecPrompt('romance', false);
  ck('★ 규격서 최상위 키에 calendar', p.includes('`calendar`'), '');
  ck('★ 규격서 달력 절 존재', p.includes('## 달력(calendar)') && p.includes('expire'), '');
  const pr = M.buildPatchExportPrompt(TEMPLATES.romance.schema);
  ck('패치 불가 목록에 달력 명시', pr.includes('달력(calendar)'), '');
  ck('★ 다이제스트에 일정 목록 remove 보호', pr.includes('### 달력') && /plans.*remove 금지/.test(pr), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
