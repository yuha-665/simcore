const __P = (...p) => require('path').resolve(__dirname, ...p);
// AI에게 스키마를 맡기는 왕복 경로 검증 (규격서 + 오류 되돌려주기 + 코드펜스 벗기기)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');

// editor 모듈은 DOM이 필요하므로 프롬프트 빌더만 떼어내 실행한다
const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
const { buildSchemaSpecPrompt, buildFixPrompt } = new Function('validateSchema', 'TEMPLATES',
  seg + '\nreturn { buildSchemaSpecPrompt, buildFixPrompt };')(validateSchema, TEMPLATES);

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const kb = (s) => (s.length / 1024).toFixed(1) + 'KB';

// ── 규격서 ──
{
  const p = buildSchemaSpecPrompt('business', true);

  ck('봇 설명을 채울 자리가 있음', p.includes('## 내가 만들 봇'), '');
  ck('JSON만 내라고 못박음', p.includes('**JSON 하나만**'), '');
  ck('최상위 키 목록 제시', p.includes('`simcore`') && p.includes('`statusUI`'), '');

  // 언어 규칙 — 이 기능의 핵심 이득
  ck('★ 화면용 필드는 한국어로 지시', p.includes('플레이어') && p.includes('한국어'), '');
  ck('★ 모델용 필드는 영어로 지시', p.includes('영어 권장'), '');
  ck('★ 영어 지시여도 한국어로 서술된다고 안심시킴', p.includes('모델은 한국어로 서술'), '');
  ck('★ 액션 라벨은 이모지로 시작하라고 명시', p.includes('이모지 하나로 시작'), '');
  ck('id는 영문 필수라고 명시', p.includes('영문 필수'), '');

  // 절대 규칙 — 실제 검증기가 잡는 것들
  for (const [needle, why] of [
    ['영문자로 시작', 'id 규칙'], ['enum', 'enum 2개 이상'], ['list', '목록 대입 금지'],
    ['derived', '파생은 set 불가'], ['maxDelta', '증감 한도'], ['contextTurns', '맥락 턴'],
    ['주석', 'JSON 주석 금지'],
  ]) ck(`절대 규칙에 ${why} 포함`, p.includes(needle), '');

  // 수식 언어
  ck('함수 목록 제공', p.includes('clamp(값,최소,최대)') && p.includes('has(목록'), '');
  ck('★ rand는 효과에서만이라고 못박음', p.includes('`rand()`는 효과(effects)에서만'), '');
  ck('2단 구조 안내', p.includes('2단 구조'), '');
  ck('배열 인덱싱 없음을 명시', p.includes('배열 인덱싱은 없습니다'), '');

  // 편성표 (v0.60) — 검증기 원문만으로는 AI가 party 존재를 모른다. 규격서가 직접 알린다.
  ck('★ 최상위 키 목록에 party', p.includes('`party`'), '');
  ck('★ 편성표 절 존재 (탭·deployed·when)', p.includes('## 편성표(party)') && p.includes('deployed') && p.includes('tabs[].when'), '');
  ck('★ 포인트 수입 경로를 함께 만들라고 못박음', p.includes('포인트 수입 경로'), '');
  ck('portraits·css는 사람 몫이라고 명시', p.includes('portraits') && p.includes('만들지 마세요'), '');
  ck('편성표가 선택임을 명시 (아무 봇에나 넣지 않게)', p.includes('빼세요'), '');

  // 밸런스 — 검증기가 못 잡는 부분
  ck('★ 도달 가능성 역산을 요구', p.includes('역산'), '');
  ck('★ 경계값 함정 경고 (내가 실제로 겪은 버그)', p.includes('시작값이 조건 경계와 같으면'), '');
  ck('★ once 없는 이벤트 반복 발동 경고', p.includes('매 턴 발동'), '');
  ck('반대급부 요구', p.includes('반대급부'), '');
  ck('파생 사슬 권장', p.includes('계산 사슬'), '');

  // 예제 + 검증기 원문
  ck('예제 템플릿이 통째로 실림', p.includes('"simcore": "0.1"') && p.includes('foot_traffic'), '');
  ck('예제가 JSON 코드펜스 안에', p.includes('```json'), '');
  ck('★ 검증기 원문 첨부됨', p.includes('function validateSchema') && p.includes('```js'), '');
  ck('검증기가 정답이라고 못박음', p.includes('이 코드가 정답'), '');

  const noSrc = buildSchemaSpecPrompt('business', false);
  ck('검증기 첨부는 끌 수 있음', !noSrc.includes('function validateSchema'), '');
  ck('끄면 확실히 짧아짐', noSrc.length < p.length - 5000, `${kb(noSrc)} vs ${kb(p)}`);

  // 예제 교체
  for (const key of Object.keys(TEMPLATES)) {
    if (key === 'blank') continue;
    const q = buildSchemaSpecPrompt(key, false);
    ck(`예제 '${key}' 선택 가능`, q.includes(TEMPLATES[key].schema.meta.name), '');
  }
  ck('모르는 예제 키는 경영으로 대체', buildSchemaSpecPrompt('없는키', false).includes('가게 운영'), '');

  // 크기 — 웹 UI에 붙여넣을 수 있어야 의미가 있다.
  // 상한은 무한 성장 방지용 가드레일 — v0.58에서 편성표 검증(party)이 검증기 원문에
  // 합류하며 60KB를 넘어 72KB로 조정, v0.88에서 에셋 구조 공존·쓰임새(usage) 검증이
  // 더해져 76KB로, v0.90에서 시나리오(scenario) 검증이 더해져 80KB로,
  // v0.95에서 커뮤니티 보드(board) 검증이 더해져 84KB로 조정
  // (실제 붙여넣기 한계는 수백 KB라 여유가 크다).
  const full = buildSchemaSpecPrompt('politics', true);
  ck('★ 규격서가 붙여넣기 가능한 크기 (84KB 미만)', full.length < 84 * 1024, kb(full));
  ck('전체 소스(251KB)보다 훨씬 작음', full.length < src.length / 4, `${kb(full)} vs ${kb(src)}`);
  console.log(`  [크기] 최소 ${kb(buildSchemaSpecPrompt('rpg', false))} / 기본 ${kb(p)} / 최대 ${kb(full)}`);
}

// ── 오류 되돌려주기 ──
{
  const broken = JSON.parse(JSON.stringify(TEMPLATES.rpg.schema));
  broken.actions[0].effects.push({ set: 'hp', expr: '' });          // 빈 수식
  broken.vars.push({ id: '한글아이디', type: 'int', init: 0 });      // 한글 id
  broken.rules.events = [{ id: 'bad', when: 'rand(1,2) > 1', effects: [], notify: 'x' }]; // 조건에 rand
  const v = validateSchema(broken);
  ck('일부러 깨뜨린 스키마가 검증 실패', !v.ok, '');

  const f = buildFixPrompt(broken, v);
  ck('전체를 다시 달라고 요구', f.includes('전체 JSON을 다시'), '');
  ck('일부만 주지 말라고 못박음', f.includes('일부만 주지 말고'), '');
  ck('★ 오류가 경로째로 전달됨', v.errors.every((e) => f.includes(e.path)),
    v.errors.map((e) => e.path).filter((p2) => !f.includes(p2)).join(', '));
  ck('★ 오류 메시지도 그대로 전달', v.errors.every((e) => f.includes(e.msg)), '');
  ck('경로 읽는 법을 설명해 줌',
    f.includes('경로 표기는 JSON 위치입니다') && f.includes('$.actions[0].effects[1].expr'), '');
  ck('현재 스키마가 통째로 동봉됨', f.includes('"simcore": "0.1"') && f.includes('```json'), '');
  ck('빈 수식 오류가 실제로 잡힘', f.includes('표현식 필요'), '');
  ck('한글 id 오류가 실제로 잡힘', /잘못된 id/.test(f), '');
  ck('조건의 rand 오류가 실제로 잡힘', /rand\(\) 사용 불가/.test(f), '');

  // 유효한 스키마여도 동작해야 한다 (개선 제안 받기)
  const okV = validateSchema(TEMPLATES.survival.schema);
  const okF = buildFixPrompt(TEMPLATES.survival.schema, okV);
  ck('유효해도 프롬프트가 나옴', okF.length > 100, '');
  ck('유효하면 오류 절이 없음', !okF.includes('## 오류'), '');
  ck('유효하면 개선 제안을 요청', okF.includes('개선할 점만 제안'), '');

  // 경고만 있는 경우.
  // 범위(min/max)도 증감 한도(maxDelta)도 없는 변수만 경고한다 — 범위가 있으면 이미 묶여 있으므로
  // 경고하지 않는다(안 그러면 숫자 변수 수만큼 경고가 쏟아져 진짜 지적이 묻힌다).
  const warned = JSON.parse(JSON.stringify(TEMPLATES.rpg.schema));
  warned.vars.push({ id: 'freefloat', label: '무한', type: 'int', init: 0 }); // min/max 둘 다 없음
  warned.updater.allow = [{ id: 'freefloat' }];
  const wv = validateSchema(warned);
  const wf = buildFixPrompt(warned, wv);
  ck('경고만 있어도 전달됨', wv.warnings.length > 0 && wf.includes('## 경고'), JSON.stringify(wv.warnings));
  ck('★ 범위도 한도도 없으면 경고한다', wv.warnings.some((w) => /freefloat/.test(w.msg)), '');

  const bounded = JSON.parse(JSON.stringify(TEMPLATES.rpg.schema));
  bounded.updater.allow = [{ id: 'gold' }, { id: 'hp' }]; // maxDelta 없지만 vars에 범위가 있다
  ck('★ 범위가 있으면 한도가 없어도 경고하지 않는다 (경고 폭탄 방지)',
    !validateSchema(bounded).warnings.some((w) => /증감 한도|어떤 값으로도/.test(w.msg)),
    JSON.stringify(validateSchema(bounded).warnings));

  const capped = JSON.parse(JSON.stringify(warned));
  capped.updater.allow = [{ id: 'freefloat', maxDelta: 5 }];
  ck('한도를 주면 범위가 없어도 경고가 사라진다',
    !validateSchema(capped).warnings.some((w) => /freefloat/.test(w.msg)), '');
}

// ── 붙여넣기: AI가 코드펜스를 붙여도 파싱되는가 ──
{
  // tabJson의 펜스 벗기기 로직과 같은 식
  const strip = (raw0) => {
    const raw = String(raw0).trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return fenced ? fenced[1] : raw;
  };
  const obj = { simcore: '0.1', meta: { name: 'T' }, vars: [], statusUI: { mode: 'auto', groups: [] } };
  const bare = JSON.stringify(obj);
  ck('맨 JSON 그대로 파싱', JSON.parse(strip(bare)).simcore === '0.1', '');
  ck('★ ```json 펜스가 붙어와도 파싱', JSON.parse(strip('```json\n' + bare + '\n```')).simcore === '0.1', '');
  ck('★ 언어 표기 없는 펜스도 파싱', JSON.parse(strip('```\n' + bare + '\n```')).simcore === '0.1', '');
  ck('★ 앞뒤에 설명이 붙어와도 파싱',
    JSON.parse(strip('여기 스키마입니다:\n```json\n' + bare + '\n```\n필요하면 말씀하세요')).simcore === '0.1', '');
  ck('소스에 펜스 벗기기가 실제로 들어감',
    src.includes('const fenced = raw.match(/```(?:json)?\\s*([\\s\\S]*?)```/);'), '');
}

// ── 왕복이 실제로 수렴하는가 (AI 대신 우리가 고쳐본다) ──
{
  const broken = JSON.parse(JSON.stringify(TEMPLATES.business.schema));
  broken.vars.push({ id: 'bad-id', type: 'int', init: 0 });
  let v = validateSchema(broken);
  ck('1회차: 실패', !v.ok, '');
  ck('1회차 프롬프트에 그 오류가 있음', buildFixPrompt(broken, v).includes('bad-id'), '');
  broken.vars.pop(); // "AI가 고쳐 왔다"
  v = validateSchema(broken);
  ck('2회차: 통과 (왕복이 수렴함)', v.ok, JSON.stringify(v.errors));
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
