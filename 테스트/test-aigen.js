const __P = (...p) => require('path').resolve(__dirname, ...p);
// 내장 AI 생성 (위층) — 모드 자동 판별, 봇 컨텍스트 조립(상한·제외), 생성 프롬프트 조합
// (설계: docs/design-내장-AI-생성.md, 이층 구조: docs/design-접근성.md §2)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// 편집기 계층 추출 — test-patch와 같은 방식
const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
const M = new Function('validateSchema', 'TEMPLATES',
  seg + '\nreturn { schemaIsBlank, assembleBotContext, buildAiRequestPrompt, buildPatchExportPrompt, buildSchemaSpecPrompt };')(validateSchema, TEMPLATES);

// 실험대 — 항목이 있는 스키마 (패치 모드 판별용)
const BASE = {
  simcore: '0.1', meta: { name: '위층 실험대' },
  vars: [{ id: 'gold', label: '금화', type: 'int', init: 100, min: 0 }],
  rules: { events: [{ id: 'broke', when: 'gold < 1', notify: '금고가 비었다.' }] },
  actions: [{ id: 'work', label: '⚒ 노역', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold + 10' }] }],
  statusUI: { mode: 'auto', groups: [] },
};
ck('실험대 스키마 자체가 유효', validateSchema(BASE).ok,
  validateSchema(BASE).errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));

// ── 모드 자동 판별: schemaIsBlank ──
{
  ck('null은 빈 스키마', M.schemaIsBlank(null), '');
  ck('{}는 빈 스키마', M.schemaIsBlank({}), '');
  // normalize()가 만드는 뼈대만 있는 상태 — 새 캐릭터의 실제 초기 모습
  const husk = {
    simcore: '0.1', meta: {}, vars: [], derived: [], directives: [],
    rules: { onTurn: [], events: [], randomEvents: { chancePerTurn: 0, table: [] } },
    updater: { model: 'aux', allow: [] }, actions: [], checks: [],
    statusUI: { mode: 'auto', groups: [] }, setup: { presets: [], ai: { enabled: false, vars: [] } },
  };
  ck('★ 뼈대만 있는 스키마도 빈 것으로 (새 캐릭터 → 통짜 생성 모드)', M.schemaIsBlank(husk), '');
  ck('항목이 있으면 빈 것 아님 (→ 패치 모드)', !M.schemaIsBlank(BASE), '');
  ck('랜덤 이벤트만 있어도 빈 것 아님',
    !M.schemaIsBlank({ rules: { randomEvents: { chancePerTurn: 0.1, table: [{ id: 'r' }] } } }), '');
  ck('프리셋만 있어도 빈 것 아님', !M.schemaIsBlank({ setup: { presets: [{ label: 'x' }] } }), '');
}

// ── 봇 컨텍스트 조립: 제외·상한·실측 ──
{
  const empty = M.assembleBotContext(null);
  ck('컨텍스트 없음 → 빈 결과', empty.text === '' && empty.bytes === 0 && !empty.truncated, '');

  const ctx = {
    name: '베리디아', desc: '겨울 영지 경영 시뮬레이션.',
    lore: [
      { name: '세계관', content: '북부 변경백령. 혹한이 6개월 이어진다.' },
      { name: '⚙simcore', content: '{"simcore":"0.1"}' },
      { name: '빈 항목', content: '   ' },
      { name: '인물', content: '집사 로렌츠 — 충직하나 잔소리꾼.' },
    ],
  };
  const a = M.assembleBotContext(ctx);
  ck('이름·설명·로어북이 각각 실림',
    a.text.includes('### 봇 이름') && a.text.includes('### 봇 설명') && a.text.includes('### 로어북: 세계관') && a.text.includes('로렌츠'), '');
  ck('★ ⚙simcore 항목은 제외 (다이제스트로 이미 실림 — 이중 전송 금지)', !a.text.includes('"simcore"'), '');
  ck('빈 내용 로어북은 건너뜀', !a.text.includes('빈 항목'), '');
  ck('바이트 실측이 실제 크기와 일치', a.bytes === Buffer.byteLength(a.text, 'utf8'), `${a.bytes}`);
  ck('상한 안이면 truncated 아님', !a.truncated, '');

  // 상한 방어 — 수십 KB 로어북 봇
  const big = { name: 'X', desc: 'D', lore: [
    { name: '큰책1', content: 'ㄱ'.repeat(9000) },  // 한글 3바이트 → 27KB
    { name: '큰책2', content: 'ㄴ'.repeat(9000) },
  ] };
  const b = M.assembleBotContext(big);
  ck('★ 상한(20KB) 초과분은 잘리고 표시됨', b.truncated && b.bytes <= 20 * 1024, `${b.bytes}`);
  ck('상한 안에서 앞 항목은 살아있음', b.text.includes('### 봇 이름'), '');

  // 설명 혼자 상한 초과 — 앞부분만 싣는다
  const hugeDesc = M.assembleBotContext({ desc: 'ㄷ'.repeat(12000), lore: [] });
  ck('설명 혼자 초과 → 앞부분만 + truncated', hugeDesc.truncated && hugeDesc.bytes <= 20 * 1024 && hugeDesc.text.includes('ㄷ'), `${hugeDesc.bytes}`);
}

// ── 생성 프롬프트 조합: 요청·컨텍스트 주입 ──
{
  const req = '산적 습격 이벤트 추가해줘. 경계가 5 이상이면 발동';
  const ctxText = '### 봇 설명\n겨울 영지 경영.';

  // 빈 스키마 → 통짜 생성 모드
  const full = M.buildAiRequestPrompt({}, req, ctxText);
  ck('빈 스키마 → 통짜 규격서 기반', full.includes('아래 규격에 맞는 시뮬레이션 스키마'), '');
  ck('★ 요청이 "내가 만들 봇" 자리에 들어감', full.includes(req), '');
  ck('★ placeholder는 사라짐', !full.includes('(여기를 채우세요'), '');
  ck('봇 컨텍스트 자동 동봉', full.includes('자동 동봉') && full.includes('겨울 영지 경영.'), '');

  // 항목 있는 스키마 → 패치 모드
  const patch = M.buildAiRequestPrompt(BASE, req, ctxText);
  ck('항목 있으면 패치 형식 기반', patch.includes('patchVersion') && patch.includes('바꿀 부분만'), '');
  ck('★ 요청이 "내가 원하는 것" 자리에 들어감', patch.includes('## 내가 원하는 것') && patch.includes(req), '');
  ck('패치 모드도 placeholder 사라짐', !patch.includes('(여기를 채우세요'), '');
  ck('패치 모드에도 컨텍스트 동봉 + 다이제스트 유지',
    patch.includes('겨울 영지 경영.') && patch.includes('이미 있는 항목'), '');
  ck('다이제스트에 기존 id 실림', patch.includes('`gold`') && patch.includes('"id":"work"'), '');

  // 회귀 — 복붙 경로(옆문·기존 ①②)는 안 바뀌어야 한다
  const plain = M.buildPatchExportPrompt(BASE);
  ck('★ 회귀: 인자 없는 ② 프롬프트는 placeholder 유지', plain.includes('(여기를 채우세요'), '');
  ck('회귀: 인자 없는 ②에 동봉 섹션 없음', !plain.includes('자동 동봉'), '');
  const spec = M.buildSchemaSpecPrompt('business', false);
  ck('★ 회귀: 인자 없는 ① 규격서도 placeholder 유지', spec.includes('(여기를 채우세요'), '');
}

// ── 번들 배선 스모크 — 위층·이층·어댑터 주입이 실제로 실려 있는지 ──
{
  ck('★ 번들: 위층 "✨ AI에게 맡기기" 존재', src.includes('✨ AI에게 맡기기'), '');
  ck('번들: 생성 버튼 + 취소 존재', src.includes("'✨ 생성'") && src.includes('✋ 취소'), '');
  ck('★ 번들: 복붙 옆문 병행', src.includes('📋 복사해서 다른 AI에게'), '');
  ck('★ 번들: 아래층 접기 존재', src.includes('🧰 직접 만지기'), '');
  ck('번들: 계획 UI 공유 함수 (planBoxUI)', src.includes('function planBoxUI'), '');
  ck('번들: 형식 불합격 1회 재시도 문구', src.includes('방금 응답이 형식 검사에서 거부되었습니다'), '');
  ck('번들: 차단 환경 → 옆문 안내', src.includes('LLM 직접 호출이 차단되어'), '');
  ck('번들: 통짜 반영 확인·되돌리기', src.includes('편집기에 반영') && src.includes('↩ 되돌리기 (반영 전으로)'), '');
  ck('★ 어댑터: getBotContext 배선 + ⚙simcore 제외', src.includes('getBotContextForEditor')
    && src.includes('.filter((l) => l.comment !== SCHEMA_LORE_COMMENT)'), '');
  ck('★ 어댑터: 생성은 callGenLLM 경유 — 자기 정산 함정 가드',
    src.includes('generate: (promptText) => callGenLLM(promptText)'), '');
  ck('어댑터 버전 v0.47', src.includes('//@version 0.47'), '');

  // ── 삼층 구조 + 사이드바 (v0.47) ──
  ck('★ 번들: 2층 JSON 작업대 존재', src.includes('🧾 JSON 작업대'), '');
  ck('★ 번들: 3층에서 진단·JSON 탭 제거 (바디 맵 기준)',
    !src.includes('diag: tabDiag') && !src.includes('json: tabJson'), '');
  ck('★ 번들: 1층 내부 3탭 (창작/결과/진단)', src.includes('✍ 창작') && src.includes('👁 결과') && src.includes('🔬 진단'), '');
  ck('★ 번들: 진단 → 바로 고쳐달라기 직결 버튼', src.includes('이 결과로 바로 고쳐달라기'), '');
  ck('번들: 직결 경로도 findings 모드 프롬프트', src.includes('findings: diag.findings'), '');
  ck('★ 패널: 사이드바 + 반응형 폴백', src.includes('sc-side') && src.includes('@media (min-width: 920px)'), '');

  // ── 1층 결과 창구 (v0.47.1~2) — 미리보기·CSS 직결·도감 ──
  ck('★ 번들: 결과 탭 미리보기 안내', src.includes('지금 스키마가 그리는 상태창'), '');
  ck('번들: 미리보기 렌더러 공유 (statusPreviewEl)', src.includes('function statusPreviewEl'), '');
  ck('★ 번들: CSS 직결 생성 + 되돌리기', src.includes('runCssGenerate') && src.includes('↩ 꾸미기 되돌리기'), '');
  ck('번들: CSS 응답 방어 (펜스·style 껍데기 제거)', src.includes("css.replace(/<\\/?style[^>]*>/g, '')"), '');
  ck('★ 번들: 만들어진 것들 도감', src.includes('📖 만들어진 것들') && src.includes('function catalogView'), '');
  ck('번들: CSS 규격서에 분위기 문구 주입', src.includes('buildCssSpecPrompt(schema, cssReq)'), '');

  // ── 꾸미기 2모드 (v0.47.3) — 스킨 / 배치까지 ──
  ck('★ 번들: 스킨·배치 모드 선택', src.includes('🎨 스킨만') && src.includes('🖼 배치까지'), '');
  ck('★ 번들: 배치 규격서 (자리표시자 계약 + uid 격리)',
    src.includes('function buildLayoutSpecPrompt') && src.includes('id="tab1-{uid}"'), '');
  ck('★ 번들: 배치 적용은 원자적 (새 오류 → 통째 되돌림)',
    src.includes('생성된 템플릿이 검증에서 거부됐습니다'), '');
  ck('번들: 되돌리기는 mode·template·customCSS 세 값 복원', src.includes('↩ 꾸미기 되돌리기'), '');
  ck('번들: 커스텀 봇에서 스킨 헛손질 경고', src.includes('스킨 CSS(자동 배치 클래스 기준)가 힘을 못'), '');

  // ── 층 = 사이드 내비 (v0.47.4) ──
  ck('★ 패널: 편집 3항목 사이드 내비 (data-floor)', src.includes('data-floor="top"')
    && src.includes('data-floor="json"') && src.includes('data-floor="deep"'), '');
  ck('★ 편집기: setFloor API + 층 전환 배선', src.includes('setFloor: (f)') && src.includes('editor.setFloor(tab.dataset.floor'), '');
  ck('번들: 스택형 폴백 유지 (플레이그라운드용 접기 2·3층)', src.includes('🧾 JSON 작업대 — 통짜 생성')
    && src.includes('🧰 직접 만지기 — 심층 편집 탭'), '');

  // ── 실패 사유 표면화 (v0.47.5) ──
  ck('★ 어댑터: 생성 실패가 { error: 사유 }로', src.includes('보조 경로: ${lastAux.status}')
    && src.includes('호출 예외: ${e.message}'), '');
  ck('★ 편집기: 실패 사유를 화면에 그대로', src.includes('생성 호출 실패 — ') && src.includes('fatal.msg'), '');
  ck('★ 어댑터: 메인 경로 인증 실패 정조준 안내 (실기 확정)',
    src.includes('x-api-key|authentication_error') && src.includes('인증이 안 붙습니다'), '');
  ck('★ 모델 id 자동 읽기 (v0.47.7)', src.includes('async function getModelIds')
    && src.includes('🔎 리수에서 id 읽기'), '');
  ck('★ 패널: 편집기 탭 선택 표시 오버라이드 (v0.47.8)',
    src.includes('#sc-root .sce .sce-tab.on') && src.includes('#sc-root .sce .sce-btn.sce-danger'), '');
  ck('★ 말로 시키기 점프 (v0.47.9) — 2·3층 → 1층 한 클릭', src.includes('function jumpToMake')
    && src.includes('✨ 말로 시키기') && src.includes('onRequestFloor: (f)'), '');
  ck('점프 안내: 3층엔 패치가 더 안전 명시', src.includes('통 교체는 AI가 하나만 빠뜨려도 그게 삭제'), '');

  // ── 생성 모델 슬롯 (v0.46.1) — "submodel로 스키마 생성하면 망한다" 공홈 피드백 ──
  ck('★ 번들: 생성 모델 선택 UI (보조/메인/직접)', src.includes('생성 모델:')
    && src.includes('메인 모델 (대화용 그대로)') && src.includes('직접 지정 (실험적)'), '');
  ck('번들: 모델 선택은 기기 로컬 저장 (sim:genmodel)', src.includes("'sim:genmodel'"), '');
  ck('★ 번들: 메인 경로는 GEN_SENTINEL + 무개입 통과 분기',
    src.includes('⟦simcore:gen⟧') && src.includes('m.content.split(GEN_SENTINEL)'), '');
  ck('번들: 기본값은 여전히 보조 (검증 안 된 경로를 기본으로 안 씀)',
    src.includes("{ choice: 'aux', staticId: '' }"), '');
  ck('번들: static 빈 id는 보조로 폴백', src.includes("gm.choice === 'static' && !gm.staticId.trim()"), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
