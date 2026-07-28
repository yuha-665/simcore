const __P = (...p) => require('path').resolve(__dirname, ...p);
// 변수 탭을 AI에게 맡기는 경로 검증.
// 핵심: 카탈로그 예시가 전부 실제 검증기를 통과해야 한다 (AI에게 틀린 걸 가르치면 안 됨).
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const engine = SC.require('engine');
const { seededRng } = SC.require('rng');

// editor 모듈은 DOM이 필요하므로 순수 함수 구간만 떼어 실행한다
const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
const E = new Function('validateSchema', 'TEMPLATES',
  seg + '\nreturn { buildTabExportPrompt, pickTabFragment, TAB_SLICES, VAR_PATTERNS, '
  + 'VAR_BALANCE_RULES, VAR_FIELD_SPEC, idsUsedElsewhere, varContractTable };')(validateSchema, TEMPLATES);

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const kb = (s) => (s.length / 1024).toFixed(1) + 'KB';
const S = TEMPLATES.survival.schema;

// ── 슬라이스 등록 ──
{
  ck('vars 탭이 등록됨', !!E.TAB_SLICES.vars, '');
  ck('vars 슬라이스가 derived까지 가져감',
    JSON.stringify(E.TAB_SLICES.vars.keys) === '["vars","derived"]', JSON.stringify(E.TAB_SLICES.vars.keys));
  // ★ 겹치면 안 되는 건 **갈아끼우는** 슬라이스끼리다. merge 슬라이스(명령)는 vars를 공유하지만
  //   배열을 바꾸지 않고 속성만 얹으므로 서로를 덮어쓸 수가 없다.
  ck('갈아끼우는 탭끼리는 키가 겹치지 않음', (() => {
    const all = Object.values(E.TAB_SLICES).filter((s) => !s.merge).flatMap((s) => s.keys);
    return new Set(all).size === all.length;
  })(), JSON.stringify(Object.values(E.TAB_SLICES).filter((s) => !s.merge).map((s) => s.keys)));
  ck('명령 탭은 merge 슬라이스', E.TAB_SLICES.commands?.merge === 'cmd', JSON.stringify(E.TAB_SLICES.commands));
}

// ── 명령 탭: 변수를 날리지 않고 cmd만 얹는가 ──
// 여기가 이 슬라이스의 존재 이유다. 다른 탭처럼 통째로 갈아끼우면
// 명령 하나 붙이려다 변수·파생이 통째로 사라진다.
{
  const base = JSON.parse(JSON.stringify(S));
  base.vars[0].cmd = '옛것';
  const ids = base.vars.map((v) => v.id);
  const got = E.pickTabFragment('commands', { commands: [{ var: ids[1], cmd: '새것' }] }, base);

  ck('★ vars 배열이 통째로 살아 있음', got.vars.length === base.vars.length, `${got.vars.length} vs ${base.vars.length}`);
  ck('★ derived를 건드리지 않음', got.derived === undefined, JSON.stringify(Object.keys(got)));
  ck('지정한 변수에 명령이 붙음', got.vars[1].cmd === '새것', got.vars[1].cmd);
  ck('★ 목록에서 빠진 변수는 명령이 떨어짐', got.vars[0].cmd === undefined, String(got.vars[0].cmd));
  ck('나머지 속성은 그대로', got.vars[1].type === base.vars[1].type && got.vars[1].init === base.vars[1].init, '');

  ck('배열만 던져도 받아 준다', E.pickTabFragment('commands', [{ var: ids[0], cmd: 'ㄱ' }], base).vars[0].cmd === 'ㄱ', '');
  let threw = '';
  try { E.pickTabFragment('commands', { commands: [{ var: '없는변수', cmd: 'ㄴ' }] }, base); }
  catch (e) { threw = e.message; }
  ck('★ 없는 변수는 거부하고 이유를 말함', threw.includes('없는변수'), threw);

  const p = E.buildTabExportPrompt(base, 'commands');
  ck('명령 프롬프트라고 밝힘', p.includes('**명령** 부분만'), '');
  ck('현재 배정만 내보낸다 (vars 원문 아님)', p.includes('"commands"') && !p.includes('"derived"'), '');
  ck('★ 수식 규칙을 안 실어 보낸다', !p.includes('## 수식 규칙'), '');
  ck('변수 계약표는 실려 나간다', p.includes('| id | 이름 | 타입'), '');
}

// ── 내보내기 프롬프트 ──
{
  const p = E.buildTabExportPrompt(S, 'vars');

  ck('변수 탭 프롬프트라고 밝힘', p.includes('**변수** 부분만'), '');
  ck('봇 설명을 채울 자리가 있음', p.includes('## 내가 원하는 것'), '');
  ck('변수 탭 전용 안내 문구', p.includes('무엇을 수치로 굴리고 싶은지'), '');
  ck('최상위 키 두 개 제시', p.includes('`"vars"`') && p.includes('`"derived"`'), '');
  ck('전체 목록을 달라고 못박음',
    p.includes('나머지가 전부 사라집니다') && /- `vars` \*\*\d+개\*\*/.test(p) && /- `derived` \*\*\d+개\*\*/.test(p), '');

  // ★ 변수 탭은 계약을 "받는" 게 아니라 "만드는" 탭 — 제약표가 아니라 규격을 줘야 한다
  ck('★ 계약표(이것만 써라)를 주지 않음', !p.includes('여기 있는 것만'), '');
  ck('★ 대신 필드 규격표를 줌', p.includes('## 변수 하나는 이렇게 생겼습니다') && p.includes('| `id` |'), '');
  ck('id 영문 규칙 명시', p.includes('영문자로 시작'), '');
  ck('label은 한국어로 지시', p.includes('한국어로'), '');
  ck('6가지 타입 명시', ['int', 'float', 'text', 'bool', 'enum', 'list'].every((t) => p.includes('`' + t + '`')), '');
  ck('format 자리표시자 설명', p.includes('{v}'), '');
  ck('derived가 읽기 전용임을 명시', p.includes('읽기 전용') && p.includes('`set` 대상이 될 수 없'), '');

  // ★ 기존 참조 보호 — 변수를 갈아끼우면 다른 탭이 깨진다
  ck('★ 다른 탭이 쓰는 변수를 경고함', p.includes('다른 탭(규칙·액션·상태창)이 쓰고 있는 변수'), '');
  for (const id of ['coal', 'heat', 'food', 'hope', 'discontent']) {
    ck(`실제 사용 중인 '${id}'가 보호 목록에 있음`, p.includes('`' + id + '`'), '');
  }

  // 패턴 카탈로그
  ck('9가지 역할 카탈로그', p.includes('## 변수는 이 9가지 역할 중 하나입니다'), '');
  ck('카탈로그 개수가 실제와 일치', E.VAR_PATTERNS.length === 9, String(E.VAR_PATTERNS.length));
  for (const [name] of E.VAR_PATTERNS) ck(`패턴 '${name}' 수록`, p.includes(`### ${name}`), '');
  ck('★ 지속 상태가 2개 한 쌍임을 가르침', p.includes('condition_left'), '');
  ck('★ 파생 사슬을 가장 중요하다고 강조', p.includes('파생 사슬 — 가장 중요합니다'), '');

  // ★ 이번 림월드 사고에서 얻은 교훈이 실제로 들어갔는가
  ck('★ set 안 되는 변수 금지 (temp_target 교훈)', p.includes('어디서도 값이 바뀌지 않는 변수를 만들지 마세요'), '');
  ck('★ 그 교훈에 실제 사고 사례를 붙임', p.includes('60턴 내내 시작값에서 1도 움직이지'), '');
  ck('★ 감소만 하는 자원 금지 (wealth 교훈)', p.includes('줄어들기만 하는 자원은 반드시 무너집니다'), '');
  ck('★ 경계값 함정 경고 (cold_snap 교훈)', p.includes('시작값을 조건 경계와 똑같이 두지 마세요'), '');
  ck('★ 변수 개수 지침', p.includes('10~15개로 시작하세요'), '');
  ck('min/max 권장', p.includes('`min`/`max`를 주세요'), '');

  // ★ 드리프트 방지 — 순서와 "대화를 잇지 말 것"
  ck('★ 다음 단계 안내가 있음', p.includes('## 이 다음에 할 일 (중요)'), '');
  ck('★ 액션·규칙 탭을 다시 내보내라고 안내', p.includes('액션 탭') && p.includes('규칙·이벤트 탭'), '');
  ck('★★ 대화를 이어 쓰지 말라고 못박음 (temp_target이 생긴 원인)',
    p.includes('이 대화를 이어서 쓰지 말고'), '');
  ck('그 이유까지 설명', p.includes('기억에 의존해 표에 없는 변수를 슬쩍'), '');

  // 현재 내용
  ck('현재 변수가 출발점으로 실림', p.includes('지금 이 봇의 변수 (여기서 출발하세요)') && p.includes('"coal"'), '');
  ck('현재 파생도 함께 실림', p.includes('"coal_burn"'), '');

  // 다른 탭은 종전 그대로여야 한다
  const pa = E.buildTabExportPrompt(S, 'actions');
  const pr = E.buildTabExportPrompt(S, 'rules');
  ck('액션 탭은 여전히 계약표를 받음', pa.includes('여기 있는 것만'), '');
  ck('규칙 탭도 여전히 계약표를 받음', pr.includes('여기 있는 것만'), '');
  ck('★ 변수 패턴이 다른 탭에 새지 않음',
    !pa.includes('9가지 역할') && !pr.includes('9가지 역할'), '');
  ck('★ 변수 탭에 이벤트/액션 패턴이 새지 않음',
    !p.includes('7가지 형태') && !p.includes('6가지 형태'), '');
  ck('★ 변수 탭에 다음 단계가, 다른 탭엔 없음',
    !pa.includes('## 이 다음에 할 일') && !pr.includes('## 이 다음에 할 일'), '');

  console.log(`  [크기] 변수 ${kb(p)} / 액션 ${kb(pa)} / 규칙 ${kb(pr)}`);
  ck('붙여넣기 가능한 크기 (20KB 미만)', p.length < 20 * 1024, kb(p));

  // 빈 스키마에서도 죽지 않아야 한다 (완전 신규 봇)
  const blank = JSON.parse(JSON.stringify(TEMPLATES.blank.schema));
  const pb = E.buildTabExportPrompt(blank, 'vars');
  ck('빈 스키마에서도 프롬프트가 나옴', pb.length > 1000, kb(pb));
  ck('쓰는 데가 없으면 보호 경고를 안 띄움',
    E.idsUsedElsewhere(blank).length === 0 ? !pb.includes('지금 다른 탭') : true,
    JSON.stringify(E.idsUsedElsewhere(blank)));
}

// ── ★ 카탈로그 예시가 전부 진짜로 유효한가 (가장 중요한 검사) ──
{
  for (const [name, , ex] of E.VAR_PATTERNS) {
    // 예시는 vars 항목 또는 derived 항목 — 둘 중 무엇이든 통째로 심어 검증한다
    let items;
    try { items = JSON.parse('[' + ex + ']'); }
    catch (e) { ck(`예시 '${name}' 파싱`, false, e.message); continue; }
    ck(`예시 '${name}' 파싱`, true, '');

    const isDerived = items.every((it) => it.expr !== undefined);
    const t = JSON.parse(JSON.stringify(TEMPLATES.survival.schema));
    // id 충돌 회피: 같은 id가 이미 있으면 그 자리를 대체한다
    for (const it of items) {
      const list = isDerived ? t.derived : t.vars;
      const at = list.findIndex((x) => x.id === it.id);
      if (at >= 0) list[at] = it;
      else if (isDerived) t.derived.push(it);
      else t.vars.push(it);
    }
    const v = validateSchema(t);
    ck(`★ 예시 '${name}'이 검증기를 통과`, v.ok,
      v.errors.map((e) => `${e.path} ${e.msg}`).join(' / '));
  }
}

// ── 가져오기 ──
{
  const pick = (f) => E.pickTabFragment('vars', f);
  const V = [{ id: 'gold', label: '금', type: 'int', min: 0, init: 100 }];
  const D = [{ id: 'rich', label: '부유', expr: 'gold > 500' }];

  ck('정상 형태', JSON.stringify(pick({ vars: V, derived: D })) === JSON.stringify({ vars: V, derived: D }), '');
  ck('vars만 줘도 받음', JSON.stringify(pick({ vars: V })) === JSON.stringify({ vars: V }), '');
  ck('배열만 던져도 vars로 받음', JSON.stringify(pick(V)) === JSON.stringify({ vars: V }), '');
  ck('스키마를 통째로 줘도 이 탭 몫만 뽑음', (() => {
    const p2 = pick({ simcore: '0.1', meta: { name: 'x' }, vars: V, derived: D, rules: { onTurn: [] }, actions: [] });
    return JSON.stringify(Object.keys(p2)) === '["vars","derived"]';
  })(), '');
  const bad = (f, why) => {
    let threw = false;
    try { pick(f); } catch (e) { threw = true; }
    ck(why, threw, '');
  };
  bad({ rules: {} }, '규칙만 주면 거부 (탭이 섞이지 않음)');
  bad({ actions: [] }, '액션만 주면 거부');
  bad('문자열', '객체가 아니면 거부');
  bad(null, 'null 거부');

  // 코드펜스 벗기기 (UI와 같은 정규식)
  const strip = (raw0) => {
    const raw = String(raw0).trim();
    const f2 = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return f2 ? f2[1] : raw;
  };
  const body = JSON.stringify({ vars: V, derived: D });
  ck('맨 JSON 파싱', JSON.parse(strip(body)).vars.length === 1, '');
  ck('```json 펜스 파싱', JSON.parse(strip('```json\n' + body + '\n```')).vars.length === 1, '');
  ck('앞뒤 설명이 붙어도 파싱',
    JSON.parse(strip('네, 변수표입니다:\n```json\n' + body + '\n```\n수정할 게 있으면 말해주세요')).vars.length === 1, '');
}

// ── ★ 왕복: "AI가 준 변수표"를 심고 실제로 굴린다 ──
{
  // 림월드 사고의 축소판 — 계약을 지킨 새 변수표로 갈아끼운다
  const t = JSON.parse(JSON.stringify(TEMPLATES.survival.schema));
  const before = E.idsUsedElsewhere(t);
  ck('★ 기존 참조 탐지가 실제로 동작', before.length >= 8, `${before.length}개: ${before.join(', ')}`);
  ck('쓰이지 않는 변수는 목록에 없음', !before.includes('없는변수'), '');

  // 변수를 통째로 갈아끼우면 규칙이 깨지는 것을 검증기가 잡는가
  const wiped = JSON.parse(JSON.stringify(t));
  Object.assign(wiped, E.pickTabFragment('vars', {
    vars: [{ id: 'water', label: '물', type: 'int', min: 0, init: 50 }],
    derived: [],
  }));
  const wv = validateSchema(wiped);
  ck('★ 변수를 갈아끼우면 다른 탭이 깨지고, 그게 잡힌다', !wv.ok && wv.errors.length > 10, `${wv.errors.length}건`);
  const miss = new Set();
  for (const e of wv.errors) {
    if (!/알 수 없는 변수|vars에 없음/.test(e.msg)) continue;
    const m = /'([a-zA-Z_][a-zA-Z0-9_]*)'/.exec(e.msg);
    if (m) miss.add(m[1]);
  }
  ck('★ 사라진 이름을 UI가 뽑아낼 수 있다 (경고 문구용)', miss.size >= 5, [...miss].join(', '));
  ck('사라진 목록이 실제로 쓰이던 것들', [...miss].every((id) => before.includes(id)),
    [...miss].filter((id) => !before.includes(id)).join(', '));

  // 반대로 계약을 지킨 확장(추가만)은 아무것도 깨지 않아야 한다
  const grown = JSON.parse(JSON.stringify(t));
  Object.assign(grown, E.pickTabFragment('vars', {
    vars: [...t.vars,
      { id: 'morale_flag', label: '사기 저하', type: 'bool', init: false },
      { id: 'storm', label: '폭풍', type: 'enum', enum: ['없음', '진행중'], init: '없음' },
      { id: 'storm_left', label: '폭풍 잔여', type: 'int', min: 0, init: 0 }],
    derived: [...t.derived, { id: 'crowded', label: '과밀', expr: 'people > 60' }],
  }));
  const gv = validateSchema(grown);
  ck('★ 추가만 하는 변경은 아무것도 깨지 않음', gv.ok, JSON.stringify(gv.errors));

  // 심은 변수로 실제 시뮬이 도는가
  let st = engine.initState(grown);
  ck('새 변수가 시작 상태에 들어옴',
    st.vars.storm === '없음' && st.vars.morale_flag === false && st.vars.storm_left === 0,
    JSON.stringify({ s: st.vars.storm, m: st.vars.morale_flag, l: st.vars.storm_left }));
  // 수식 언어는 참/거짓을 1/0으로 돌려준다 (생존자 40명 < 60 이므로 0)
  const look = engine.makeLookup(grown, st.vars);
  ck('새 파생이 계산됨', look('crowded') === 0, JSON.stringify(look('crowded')));
  ck('새 파생이 조건에 반응함', engine.makeLookup(grown, { ...st.vars, people: 80 })('crowded') === 1, '');
  for (let i = 0; i < 12; i++) {
    st = engine.sendPhase(grown, st, { rng: seededRng('v', i, 's') }).state;
    st = engine.outputPhase(grown, st, {}, {}, { rng: seededRng('v', i, 'o') }).state;
  }
  ck('★ 12턴을 에러 없이 돈다', st.vars.day === 13, `day=${st.vars.day}`);
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
