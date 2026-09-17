const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.28 — 검증 리포트의 "어느 탭 문제인가" 이름표 회귀.
// 계기: 커뮤니티 UI 기여본이 오류 경로(`$.questBoard[0].when`)를 접기 뒤로 숨기고 대신
// "○○에서 확인이 필요해요"를 앞세웠는데, areaLabel이 $.setup·$.liveChoices·$.suggest·$.promptState를
// 놓쳐 그 넷은 "작업본에서 확인이 필요해요"로 뭉개졌다 — 경로까지 숨긴 마당이라 갈 곳을 알 수가 없다.
// 여기서 못 박는 것:
//   · validate가 내는 경로 접두는 **전부** 이름이 있어야 한다 (새 기능이 생기면 여기서 걸린다)
//   · 그 이름은 3층 탭 이름(TABS)이거나 허용된 예외여야 한다 — 없는 탭 이름을 대면 유저가 헤맨다
//   · guidedWorldMode가 보증 문구와 💬 링크를 지우지 않았는가 (이식 때 빠졌던 둘)
//   · 새 CSS가 쓰는 변수가 팔레트에 정의돼 있는가 (기여본이 정의 없이 쓰던 둘)
const fs = require('fs');
const editorSrc = fs.readFileSync(__P('../core/editor.js'), 'utf8');
const validateSrc = fs.readFileSync(__P('../core/validate.js'), 'utf8');
const bundle = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── areaLabel 본문만 떠낸다 ──
const seg = editorSrc.slice(editorSrc.indexOf('const areaLabel = (path)'));
const body = seg.slice(0, seg.indexOf("return '작업본';"));
ck('areaLabel 본문 추출', body.length > 200 && body.includes("startsWith('$.vars"), `${body.length}자`);

// 이름표가 붙은 경로 접두
const labeled = new Set();
for (const m of body.matchAll(/startsWith\('\$\.(\w+)'\)/g)) labeled.add(m[1]);
ck('이름표가 붙은 경로 10종 이상', labeled.size >= 10, `${labeled.size}종`);

// validate가 실제로 내는 경로 접두
const emitted = new Set();
for (const m of validateSrc.matchAll(/'\$\.(\w+)/g)) emitted.add(m[1]);
ck('검증이 내는 경로 접두 추출', emitted.size >= 15, `${emitted.size}종`);

// 이름표가 필요 없는 것 — 탭이 없거나(스키마 머리·내부 토글) 유저가 고칠 칸이 아닌 것
const NO_TAB = new Set(['simcore', 'meta', 'rerollStableRng']);

{
  const missing = [...emitted].filter((k) => !labeled.has(k) && !NO_TAB.has(k));
  ck('★ 검증이 내는 경로에 이름 없는 것이 없다 (있으면 "작업본"으로 뭉개진다)',
    missing.length === 0, missing.join(', '));
}

// ── 이름표가 실제 탭 이름인가 ──
{
  const tabs = new Set();
  const tabSeg = editorSrc.slice(editorSrc.indexOf('const TABS = ['));
  for (const m of tabSeg.slice(0, tabSeg.indexOf('];')).matchAll(/'[a-zA-Z]+', '([^']+)'/g)) tabs.add(m[1]);
  ck('3층 탭 이름 목록 추출 (16개)', tabs.size === 16, `${tabs.size}개: ${[...tabs].join(',')}`);
  // 탭이 아닌 층(에셋 팩)은 예외
  const FLOOR = new Set(['에셋 팩']);
  const names = [...body.matchAll(/return '([^']+)';/g)].map((m) => m[1]);
  const bad = names.filter((n) => !tabs.has(n) && !FLOOR.has(n));
  ck('★ 모든 이름표가 실제 탭(또는 층) 이름이다', bad.length === 0, bad.join(', '));
  // 이식 때 실제로 틀렸던 것들 — 탭은 달력/시간이 따로인데 "시간·달력"으로, 보드는 "커뮤니티 보드"로 불렀다
  ck('달력·시간을 뭉뚱그리지 않는다', names.includes('달력') && names.includes('시간'), names.join(' / '));
  ck('보드는 탭 이름 그대로', names.includes('보드') && !names.includes('커뮤니티 보드'), '');
}

// ── 이식 때 빠졌던 둘이 살아 있는가 ──
{
  ck('★ 직결 생성 안내에 "없는 이름은 지어내지 못한다" 보증이 있다',
    /guidedWorldMode[\s\S]{0,400}이미 있는 변수 목록이 함께 나가서 없는 이름은 지어내지 못해요/.test(editorSrc), '');
  ck('★ 💬 어시스턴트로 가는 jumpRow가 guidedWorldMode에서도 붙는다',
    !/if \(!guidedWorldMode\) exportBox\.appendChild\(jumpRow/.test(editorSrc)
    && /exportBox\.appendChild\(jumpRow/.test(editorSrc), '');
}

// ── 접이식 창구에 "눌러서 펼치기" 힌트 (실기 제보 v1.9.28) ──
// "접이식은 좋은데 숨겨져 있으면 모를 수도 있으니 힌트는 필요하겠다" — 꺾쇠(⌄)만으론 약했다.
// 글자는 DOM이 아니라 CSS ::after가 넣는다 (다시 그리지 않고 펼침/접힘에 따라 뒤집히려면 그 방법뿐).
{
  ck('★ 접이식 AI 창구에 "눌러서 펼치기" 힌트',
    /\.sce-board-ai-toggle::after \{ content:'눌러서 펼치기'; \}/.test(editorSrc), '');
  ck('★ 펼치면 "접기"로 뒤집힌다',
    /\.sce-board-ai\[open\] \.sce-board-ai-toggle::after \{ content:'접기'; \}/.test(editorSrc), '');
  ck('중첩된 "외부 AI로 만들기" 접이식에도 (꺾쇠가 없어 더 안 보인다)',
    /sce-tab-ai-world-fallback > summary \.sce-board-ai-toggle::after \{ content:'· 눌러서 펼치기'; \}/.test(editorSrc), '');
  // 세 탭(의뢰판·메신저 + 원래 있던 보드) 전부 — 하나만 빠지면 그 탭만 안 보인다
  const marks = (editorSrc.match(/class: 'sce-board-ai-toggle'/g) ?? []).length;
  ck('★ 요약줄 네 곳 전부에 붙었다 (의뢰판·메신저·보드 + 외부 AI 폴백)', marks === 4, `${marks}곳`);
  ck('힌트는 꺾쇠와 한 묶음으로 오른쪽에 (space-between이 흩뜨리지 않게)',
    /sce-board-ai-more/.test(editorSrc) && /\.sce-board-ai-more \{ display:flex; flex:none;/.test(editorSrc), '');
}

// ── 새 CSS가 쓰는 변수가 정의돼 있는가 (var()가 무효면 감싼 color-mix까지 죽는다) ──
{
  // 폴백 있는 var(--x, 기본값)은 정의가 없어도 산다 — 폴백 없는 것만 본다
  const used = new Set();
  for (const m of editorSrc.matchAll(/var\(--(sce-[a-z-]+)\)/g)) used.add(m[1]);
  const undef = [...used].filter((v) => !new RegExp(`--${v}\\s*:`).test(editorSrc));
  ck('★ 폴백 없이 쓰는 --sce-* 변수가 전부 정의돼 있다 (무효 var는 선언째 죽인다)',
    undef.length === 0, undef.join(', '));
  for (const v of ['sce-warning-bg', 'sce-success-bg', 'sce-danger-bg']) {
    ck(`팔레트에 --${v}`, new RegExp(`--${v}\\s*:`).test(editorSrc), '');
  }
}

// ── 번들에도 실려 있는가 (build.js CORE 누락 방지) ──
{
  ck('번들에 areaLabel 실림', bundle.includes('const areaLabel = (path)'), '');
  ck('번들에 새 섹션 UI 실림', bundle.includes('sce-board-section') && bundle.includes('sce-tab-ai-world'), '');
  ck('번들에 검증 리포트 카드 실림', bundle.includes('sce-validation-issue'), '');
  // 기여본 머리에 "runtime logic is unchanged"가 붙어 있었는데 사실이 아니었다(네 함수가 다시 쓰였다).
  // 그 줄이 번들에 따라 들어오면 다음 사람이 디프를 건너뛴다 — 안 실렸는지 본다.
  // (체인지로그가 그 문구를 인용하므로 문장이 아니라 **머리 주석 형태**로 찾는다)
  ck('⚠ 기여본 머리의 잘못된 주석 줄은 안 실렸다',
    !bundle.includes('// Local compatibility rebuild'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
