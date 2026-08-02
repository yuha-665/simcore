const __P = (...p) => require('path').resolve(__dirname, ...p);
// 실전 검증: AI가 "제안한 변수표"를 실제로 심으면 그 AI가 만든 규칙·이벤트가 통과하는가?
// 가설 — 사용자가 본 300여 개 오류는 전부 "변수가 없어서"이고, 변수만 채우면 0이 된다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');

const frag = JSON.parse(fs.readFileSync(__dirname + '/rimworld-rules.json', 'utf8'));

// ── AI가 직전 답변에서 "이렇게 하자"고 제안한 변수표를 그대로 옮긴다 ──
const VARS = [
  { id: 'day', label: '경과일', type: 'int', min: 1, init: 1 },
  { id: 'temp', label: '기온', type: 'int', min: -60, max: 60, init: 20 },
  { id: 'climate', label: '바이옴', type: 'enum', init: '온대림',
    enum: ['온대림', '한대림', '열대우림', '관목지', '사막', '극한사막', '툰드라', '빙원', '해빙'] },
  { id: 'storyteller', label: '스토리텔러', type: 'enum', init: '카산드라', enum: ['랜디', '카산드라', '드라마'] },
  { id: 'people', label: '정착민', type: 'int', min: 0, init: 5 },
  { id: 'injured', label: '부상자', type: 'int', min: 0, init: 0 },
  { id: 'sick', label: '환자', type: 'int', min: 0, init: 0 },
  { id: 'food', label: '식량', type: 'int', min: 0, init: 300 },
  { id: 'wood', label: '목재', type: 'int', min: 0, init: 250 },
  { id: 'silver', label: '은', type: 'int', min: 0, init: 500 },
  { id: 'medicine', label: '의약품', type: 'int', min: 0, init: 12 },
  { id: 'components', label: '부품', type: 'int', min: 0, init: 20 },
  { id: 'wealth', label: '부', type: 'int', min: 0, init: 1500 },
  { id: 'defense', label: '방어 시설', type: 'int', min: 1, max: 5, init: 1 },
  { id: 'power', label: '전력', type: 'enum', init: '안정', enum: ['정지', '부족', '안정'] },
  { id: 'mood', label: '사기', type: 'int', min: 0, max: 100, init: 65 },
  { id: 'tension', label: '갈등', type: 'int', min: 0, max: 100, init: 10 },
  { id: 'ration', label: '배급', type: 'enum', init: '정상', enum: ['중단', '절반', '정상', '넉넉히'] },
  { id: 'prisoners', label: '포로', type: 'int', min: 0, init: 0 },
  { id: 'animals', label: '가축', type: 'int', min: 0, init: 2 },
  { id: 'condition', label: '지역 이상', type: 'enum', init: '없음',
    enum: ['없음', '일식', '태양플레어', '독성낙진', '화산겨울', '뇌우', '한파', '혹서'] },
  { id: 'condition_left', label: '이상 잔여일', type: 'int', min: 0, init: 0 },
  { id: 'raid_in', label: '습격까지', type: 'int', min: 0, init: 0 },
  { id: 'raid_kind', label: '예고된 습격', type: 'enum', init: '없음',
    enum: ['없음', '부족민', '해적', '공성', '드롭포드', '메카노이드', '벌레', '광란야수'] },
  { id: 'ship_parts', label: '우주선 부품', type: 'int', min: 0, max: 6, init: 0 },
  { id: 'colony_lost', label: '정착지 붕괴', type: 'bool', init: false },
];

const DERIVED = [
  { id: 'workforce', label: '가용 인력', expr: 'max(0, people - sick - injured)' },
  { id: 'season', label: '계절', expr: '((day - 1) % 60) < 15 ? "봄" : (((day - 1) % 60) < 30 ? "여름" : (((day - 1) % 60) < 45 ? "가을" : "겨울"))' },
  { id: 'year', label: '연차', expr: 'floor((day - 1) / 60) + 1' },
  { id: 'food_need', label: '일 식량소모', expr: 'round(people * (ration == "넉넉히" ? 1.5 : (ration == "정상" ? 1 : (ration == "절반" ? 0.5 : 0))) + animals * 0.5)' },
  { id: 'food_left', label: '식량 잔여', expr: 'food_need > 0 ? floor(food / food_need) : 99' },
  // AI가 스스로 "rand는 derived 불가"라고 표시한 자리 — 고정값으로 대체
  { id: 'raid_power', label: '적 전력', expr: 'round(day * 0.6 + (storyteller == "카산드라" ? wealth / 250 : wealth / 600) + (storyteller == "랜디" ? 8 : 0))' },
  { id: 'def_power', label: '방어 전력', expr: 'round(workforce * 3 + defense * 6 + (power == "안정" ? 5 : 0))' },
  { id: 'raid_margin', label: '전력 차', expr: 'def_power - raid_power' },
  { id: 'heat_grade', label: '체감', expr: 'temp > 45 ? "치명적 폭염" : (temp > 32 ? "혹서" : (temp < -20 ? "치명적 한파" : (temp < 0 ? "혹한" : "견딜 만함")))' },
];

const build = (extraVars = [], extraDerived = []) => ({
  simcore: '0.1',
  meta: { name: '림월드 정착지', contextTurns: 6 },
  vars: [...VARS, ...extraVars],
  derived: [...DERIVED, ...extraDerived],
  rules: frag.rules,
  directives: frag.directives,
  actions: [],
  updater: { allow: [{ id: 'mood', maxDelta: 8 }, { id: 'tension', maxDelta: 8 }] },
  statusUI: { mode: 'auto', groups: [{ label: '정착지', vars: ['day', 'people', 'mood', 'tension'] }] },
});

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── 1) 변수를 안 심었을 때 (= 사용자가 실제로 겪은 상황) ──
{
  const bare = build();
  bare.vars = [{ id: 'day', label: '경과', type: 'int', min: 1, init: 1 },
    { id: 'temp', label: '외부 기온', type: 'int', min: -60, max: 10, init: -20 },
    { id: 'coal', label: '석탄', type: 'int', min: 0, init: 400 },
    { id: 'food', label: '식량', type: 'int', min: 0, init: 380 },
    { id: 'people', label: '생존자', type: 'int', min: 0, init: 40 },
    { id: 'sick', label: '환자', type: 'int', min: 0, init: 0 },
    { id: 'hope', label: '희망', type: 'int', min: 0, max: 100, init: 60 }];
  bare.derived = [{ id: 'workforce', label: '가용 인력', expr: 'max(0, people - sick)' }];
  bare.updater = { allow: [] };
  bare.statusUI = { mode: 'auto', groups: [] };
  const v = validateSchema(bare);
  const kinds = {};
  for (const e of v.errors) {
    const k = /알 수 없는 변수/.test(e.msg) ? '없는 변수 참조'
      : /vars에 없음/.test(e.msg) ? 'set 대상 없음' : '그 외';
    kinds[k] = (kinds[k] || 0) + 1;
  }
  console.log('── 변수 탭 없이 규칙만 가져왔을 때 (사용자가 본 화면) ──');
  for (const [k, n] of Object.entries(kinds)) console.log(`   ${k}: ${n}건`);
  ck('★ 변수를 안 심으면 대량 실패한다 (재현됨)', !v.ok && v.errors.length > 150, `${v.errors.length}건`);
  ck('★ 오류가 전부 "변수 없음" 한 부류다 — 문법/구조 오류 0건',
    (kinds['그 외'] || 0) === 0,
    v.errors.filter((e) => !/알 수 없는 변수|vars에 없음/.test(e.msg)).map((e) => `${e.path} ${e.msg}`).join(' / '));
}

// ── 2) AI가 제안한 변수표를 그대로 심으면? ──
{
  const v = validateSchema(build());
  console.log('\n── AI 제안 변수표를 심었을 때 ──');
  for (const e of v.errors) console.log(`   ✗ ${e.path} — ${e.msg}`);
  ck('★ 남은 오류가 손에 꼽는다 (변수만이 문제였음)', v.errors.length <= 3, `${v.errors.length}건`);
  ck('★ 남은 오류는 temp_target 하나뿐 — AI가 자기 표에도 없던 변수를 지어냈다',
    v.errors.every((e) => /temp_target/.test(e.msg)),
    v.errors.map((e) => e.msg).join(' / '));
}

// ── 3) 그 한 개까지 채우면 완전히 통과하는가 ──
{
  const full = build(
    [{ id: 'temp_target', label: '계절 목표기온', type: 'int', min: -60, max: 60, init: 20 }],
    [],
  );
  const v = validateSchema(full);
  console.log('\n── temp_target까지 채웠을 때 ──');
  for (const e of v.errors) console.log(`   ✗ ${e.path} — ${e.msg}`);
  for (const w of v.warnings) console.log(`   ⚠ ${w.path} — ${w.msg}`);
  ck('★★ AI가 만든 규칙·이벤트 JSON이 무수정 통과한다', v.ok, JSON.stringify(v.errors));

  // 규모 확인 — 통과한 게 하찮은 양이 아님을 보인다
  const nOn = full.rules.onTurn.length, nEv = full.rules.events.length;
  const nRnd = full.rules.randomEvents.table.length, nDir = full.directives.length;
  console.log(`   [규모] onTurn ${nOn} / events ${nEv} / randomEvents ${nRnd} / directives ${nDir}`);
  ck('통과 규모가 실전급', nOn >= 12 && nEv >= 17 && nRnd >= 40 && nDir >= 15,
    `${nOn}/${nEv}/${nRnd}/${nDir}`);

  // ── 4) 실제로 굴려본다 (드라이런) — 시드 5개로 편차까지 본다 ──
  const engine = SC.require('engine');
  const { seededRng } = SC.require('rng');
  const TURNS = 60, RUNS = 5;
  const allIds = [...full.rules.events.map((e) => e.id), ...full.rules.randomEvents.table.map((e) => e.id)];
  const everSeen = {}, collapses = [], finals = [];
  const state0 = engine.initState(full).vars;

  for (let run = 0; run < RUNS; run++) {
    let st = engine.initState(full);
    let collapsedAt = null;
    for (let i = 0; i < TURNS; i++) {
      st = engine.sendPhase(full, st, { rng: seededRng(`run${run}`, i, 'send') }).state;
      const o = engine.outputPhase(full, st, {}, {}, { rng: seededRng(`run${run}`, i, 'out') });
      st = o.state;
      for (const id of o.firedEvents) everSeen[id] = (everSeen[id] || 0) + 1;
      if (collapsedAt === null && st.vars.colony_lost) collapsedAt = i + 1;
    }
    collapses.push(collapsedAt);
    finals.push(st.vars);
  }

  console.log(`\n── ${TURNS}턴 × ${RUNS}회 드라이런 ──`);
  console.log(`   붕괴 시점: ${collapses.map((c) => c ?? '생존').join(' / ')}`);
  const f0 = finals[0];
  console.log(`   1회차 최종: day=${f0.day} people=${f0.people} food=${f0.food} wood=${f0.wood} `
    + `silver=${f0.silver} mood=${f0.mood} tension=${f0.tension} wealth=${f0.wealth}`);
  const dead = allIds.filter((id) => !everSeen[id]);
  console.log(`   ${RUNS}회 내내 한 번도 안 뜬 이벤트 ${dead.length}/${allIds.length}: ${dead.join(', ') || '없음'}`);
  const still = Object.keys(state0).filter((k) => finals.every((fv) => JSON.stringify(state0[k]) === JSON.stringify(fv[k])));
  console.log(`   내내 안 변한 변수: ${still.join(', ') || '없음'}`);
  const survived = collapses.filter((c) => c === null).length;
  console.log(`   생존율: ${survived}/${RUNS}`);

  ck('드라이런이 에러 없이 끝까지 돈다', finals.length === RUNS, '');
}

// ── 5) 새 순서대로(변수 → 규칙) 했으면 실제로 됐는가 ──
{
  const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
  const { TEMPLATES } = SC.require('templates');
  const E = new Function('validateSchema', 'TEMPLATES', 'timeConfig', 'EXPOSED_LABELS',
    seg + '\nreturn { buildTabExportPrompt, pickTabFragment };')(validateSchema, TEMPLATES, SC.require('time').timeConfig, SC.require('time').EXPOSED_LABELS);

  console.log('\n── 순서대로 했을 때 (변수 탭 → 규칙 탭) ──');

  // [1단계] 프로스트펑크 스키마의 변수 탭에서 내보내기
  const start = JSON.parse(JSON.stringify(TEMPLATES.survival.schema));
  const varPrompt = E.buildTabExportPrompt(start, 'vars');
  ck('1단계: 변수 탭 프롬프트가 나온다', varPrompt.includes('## 변수는 이 9가지 역할'), '');
  ck('1단계: 기존 변수가 쓰이는 중이라고 경고', varPrompt.includes('지금 다른 탭'), '');

  // [2단계] "AI가 림월드 변수표를 줬다" → 변수 탭에 가져오기
  const afterVars = JSON.parse(JSON.stringify(start));
  Object.assign(afterVars, E.pickTabFragment('vars', {
    vars: [...VARS, { id: 'temp_target', label: '계절 목표기온', type: 'int', min: -60, max: 60, init: 20 }],
    derived: DERIVED,
  }));
  // 장르를 통째로 갈아탈 때는 [시간] 탭도 같이 정리한다 — 이 봇은 자체 60일 달력(day·season·year)을
  // 쓰므로 물려받은 시간 체계의 노출 이름과 부딪힌다. 변수 탭 가져오기는 time 섹션을 안 건드리므로
  // (그게 맞다 — 시간은 [시간] 탭의 것이다) 여기서 끈다. 안 끄면 검증이 그 사실을 정확히 알려 준다.
  delete afterVars.time;
  ck('2단계: 변수가 실제로 갈아끼워짐',
    afterVars.vars.some((v) => v.id === 'wealth') && !afterVars.vars.some((v) => v.id === 'coal'), '');

  // [3단계] 규칙 탭에서 내보내기 → 이제 계약표에 림월드 변수가 실려 나가는가
  const rulePrompt = E.buildTabExportPrompt(afterVars, 'rules');
  const contracted = ['wealth', 'silver', 'mood', 'tension', 'raid_kind', 'condition_left', 'temp_target'];
  ck('★ 3단계: 계약표가 림월드 변수로 바뀌어 나간다',
    contracted.every((id) => rulePrompt.includes(`\`${id}\``)),
    contracted.filter((id) => !rulePrompt.includes(`\`${id}\``)).join(', '));
  ck('3단계: 프로스트펑크 변수는 더 이상 안 나감', !rulePrompt.includes('| `coal` |'), '');
  ck('3단계: 파생도 읽기 전용으로 함께 실림',
    rulePrompt.includes('`raid_margin`') && rulePrompt.includes('읽기 전용'), '');

  // [4단계] 사용자가 실제로 받았던 그 규칙 JSON을 그대로 가져오기
  const done = JSON.parse(JSON.stringify(afterVars));
  Object.assign(done, E.pickTabFragment('rules', frag));
  const v = validateSchema(done);
  const ruleErrs = v.errors.filter((e) => /^\$\.(rules|directives)\b/.test(e.path));
  console.log(`   4단계: 규칙·이벤트 오류 ${ruleErrs.length}건 (전체 ${v.errors.length}건)`);
  ck('★★ 4단계: 사용자가 받았던 그 JSON의 규칙 부분이 그대로 통과한다 (361건 → 0건)',
    ruleErrs.length === 0, ruleErrs.map((e) => `${e.path} ${e.msg}`).join(' / '));

  // [5단계] 남은 오류는 장르를 갈아탔으니 당연히 깨진 나머지 탭들이다.
  //         새 경고가 "어디를 고쳐야 하는지" 정확히 짚어주는지 본다.
  const PATH_TABS = [
    [/^\$\.(rules|directives)\b/, '규칙·이벤트', true],
    [/^\$\.actions\b/, '액션', true],
    [/^\$\.(statusUI|promptState)\b/, '상태창', false],
    [/^\$\.updater\b/, 'AI 설정', false],
    [/^\$\.setup\b/, '새 시작', false],
  ];
  ck('소스의 탭 분류표가 테스트와 같다',
    PATH_TABS.every(([, label]) => src.includes(`'${label}',`)),
    PATH_TABS.map(([, l]) => l).filter((l) => !src.includes(`'${l}',`)).join(', '));

  const varErrs = v.errors.filter((e) => /알 수 없는 변수|vars에 없음|정의되지 않음/.test(e.msg));
  const unclassified = varErrs.filter((e) => !PATH_TABS.some(([re]) => re.test(e.path || '')));
  ck('★ 5단계: 모든 변수 오류가 어느 탭인지 분류된다',
    unclassified.length === 0, [...new Set(unclassified.map((e) => e.path))].join(', '));

  const hitAi = [...new Set(varErrs.filter((e) => PATH_TABS.find(([re, , a]) => re.test(e.path) && a))
    .map((e) => PATH_TABS.find(([re]) => re.test(e.path))[1]))];
  const hitManual = [...new Set(varErrs.filter((e) => PATH_TABS.find(([re, , a]) => re.test(e.path) && !a))
    .map((e) => PATH_TABS.find(([re]) => re.test(e.path))[1]))];
  console.log(`   5단계: 다시 내보내면 되는 탭 [${hitAi.join(', ')}] / 직접 고쳐야 하는 탭 [${hitManual.join(', ')}]`);
  ck('★ 액션 탭이 깨진 것을 짚어낸다', hitAi.includes('액션'), '');
  ck('★ 상태창·AI 설정도 짚어낸다', hitManual.includes('상태창') && hitManual.includes('AI 설정'), '');
  ck('규칙 탭은 이미 고쳤으므로 목록에 없다', !hitAi.includes('규칙·이벤트'), '');

  // [6단계] 안내대로 나머지 탭까지 새 변수에 맞추면 전부 통과하는가
  const finished = JSON.parse(JSON.stringify(done));
  finished.actions = [];
  finished.updater = { model: 'aux', allow: [{ id: 'mood', maxDelta: 8 }, { id: 'tension', maxDelta: 8 }] };
  finished.promptState = { position: 'history_end', template: '', includeEvents: true };
  finished.statusUI = { mode: 'auto', groups: [{ label: '정착지', vars: ['day', 'people', 'mood', 'tension', 'food'] }] };
  finished.setup = { presets: [], ai: { enabled: false, vars: [] } };
  const fv = validateSchema(finished);
  console.log(`   6단계 검증: 오류 ${fv.errors.length}건 / 경고 ${fv.warnings.length}건`);
  for (const e of fv.errors) console.log(`     ✗ ${e.path} — ${e.msg}`);
  ck('★★ 6단계: 안내대로 하면 림월드 봇이 완전히 통과한다', fv.ok,
    fv.errors.map((e) => `${e.path} ${e.msg}`).join(' / '));
}

module.exports = { build, VARS, DERIVED, frag };
let p = 0, f = 0;
console.log('');
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
