const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.78 편집 동선 — 생성 모델 선택이 생성 버튼마다 뜨는가 + 더티 배너에서 바로 적용되는가.
//
// 두 건 다 "기능은 이미 있는데 그 자리에 없어서 없는 것처럼 보이던" 문제다.
// 그래서 검사도 **배선**을 본다: 선택 줄이 세 곳에서 불리는가, 적용 로직이 한 벌인가.
// (DOM을 띄울 수 없는 환경이라 소스 배선으로 고정한다 — 회귀는 여기서 잡힌다)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── 생성 모델 선택 줄 ──
{
  ck('★ buildGenModelRow로 추출됨', src.includes('function buildGenModelRow(compact)'), '');

  const calls = (src.match(/buildGenModelRow\(/g) || []).length;
  // 정의 1 + 호출 3 (AI 어시스턴트 / 에셋 임포터 / 꾸미기)
  ck('★ 생성 지점 세 곳에서 호출 (정의 포함 4회)', calls === 4, `실제 ${calls}회`);

  ck('★ AI 어시스턴트: 넓은 형태(compact=false)', src.includes('buildGenModelRow(false)'), '');
  const compacts = (src.match(/buildGenModelRow\(true\)/g) || []).length;
  ck('★ 에셋 변환 + 꾸미기: 좁은 형태 2곳', compacts === 2, `실제 ${compacts}곳`);

  // 에셋 임포터 안에 있어야 한다 — 팩 변환 프롬프트 근처
  const impAt = src.indexOf('buildPackImportPrompt(assetImportText)');
  const rowBefore = src.lastIndexOf('buildGenModelRow(true)', impAt);
  ck('★ 에셋 팩 변환 버튼과 같은 블록에 선택 줄이 있다',
    impAt > 0 && rowBefore > 0 && impAt - rowBefore < 2500, `거리 ${impAt - rowBefore}`);

  // 꾸미기 컨트롤 안에 있어야 한다
  const cssAt = src.indexOf('runCssGenerate()');
  ck('★ 꾸미기 생성 버튼과 같은 블록에 선택 줄이 있다',
    cssAt > 0 && src.indexOf('buildGenModelRow(true)', cssAt) - cssAt < 800, '');

  // 세 선택지가 살아 있는가 (메인 모델이 고를 수 있어야 한다 — 이 판의 요구 자체)
  ck('★ 메인 모델 선택지 존재', src.includes("['main', '메인 모델 (대화용 그대로)']"), '');
  ck('보조·직접 지정도 그대로', src.includes("['aux', '보조 모델 (기본)']") && src.includes("['static', '직접 지정 (실험적)']"), '');

  // 어느 화면에서 처음 열어도 값을 읽어야 한다 (예전엔 AI 탭을 거쳐야 채워졌다)
  const defAt = src.indexOf('function buildGenModelRow(compact)');
  const endAt = src.indexOf('let aiGen = {', defAt);
  const body = src.slice(defAt, endAt);
  ck('★ 함수 안에서 getGenModel을 스스로 읽는다 (AI 탭 경유 불필요)',
    body.includes('ai.getGenModel()') && body.includes('aiGenModel === undefined'), '');
  ck('선택 즉시 저장된다 (setGenModel)', body.includes('ai.setGenModel({ choice: aiGenModel.choice'), '');

  // 변환·꾸미기는 ai.generate를 타야 설정이 먹는다 — callAuxLLM 직행이면 선택이 무의미해진다
  ck('★ 에셋 변환이 ai.generate 경로', src.includes('await ai.generate(buildPackImportPrompt('), '');
  ck('★ generate가 callGenLLM(모델 선택 반영)에 물려 있다',
    src.includes('generate: (promptText) => callGenLLM(promptText)'), '');
}

// ── 더티 배너에서 바로 적용 ──
{
  ck('★ 설치 로직이 runInstall 한 벌로 추출됨', src.includes('async function runInstall(rep)'), '');
  ck('★ 작업공간 버튼도 같은 함수를 부른다',
    src.includes("document.getElementById('sc-install').onclick = () => runInstall("), '');
  ck('★ 배너에 [지금 적용] 버튼이 있다', src.includes('sc-apply-now') && src.includes('💾 지금 적용'), '');
  ck('★ 배너 버튼이 runInstall을 부른다', src.includes('await runInstall(rep)'), '');

  // 보고는 배너 자기 칸에 — 편집 도구 화면엔 #sc-schema-report가 없다
  ck('★ 배너 자기 보고 칸을 쓴다',
    src.includes("warnEl.querySelector('.sc-apply-report')"), '');
  ck('버튼도 배너에서 다시 찾는다 (innerHTML 재생성 대응)',
    src.includes("warnEl.querySelector('.sc-apply-now')"), '');

  // 안내 문구가 "작업공간으로 가라"에서 "여기서 눌러라"로 바뀌었는지
  ck('★ 안내가 배너 내 적용을 가리킨다', src.includes('아래 [지금 적용]을 누르면 여기서 바로 반영돼요'), '');
  ck('★ 옛 안내(작업공간으로 이동) 잔존 없음',
    !src.includes('변경 내용을 적용하려면 [편집 작업공간]의 [캐릭터에 적용]을 누르세요'), '');

  // v0.85.1 — 적용 직후 되읽기 레이스 방어 + 성공 확인 한 줄
  // (setCharacter 직후의 getCharacter가 옛 캐릭터를 주면 배너가 "미반영"으로 되그려져
  //  [지금 적용]이 안 먹히는 것처럼 보였다 — 실사고)
  ck('★ 설치 후 되읽기를 검증하고 재시도한다', src.includes('설치 되읽기 불일치 — 재시도'), '');
  ck('★ 적용 성공 확인 한 줄을 남긴다 (배너가 흔적 없이 사라지지 않게)',
    src.includes('✓ 캐릭터에 적용됐어요.'), '');
  // v0.85.1 — 프리셋도 스냅샷을 저장한다 (메모리에만 남으면 채팅 전환에 조용히 증발)
  const presetAt = src.indexOf('session.applyPreset(p.id)');
  ck('★ 프리셋 적용이 out 스냅샷을 저장한다',
    presetAt > 0 && src.slice(presetAt, presetAt + 400).includes("session.store.save('out', lastOutIndex"), '');

  // 두 배너 모두에 붙어야 한다 (편집 도구 / 작업공간)
  ck('배너는 편집·작업공간 양쪽', src.includes("document.getElementById('sc-editor-warn'), document.getElementById('sc-work-warn')"), '');

  ck('버튼 레이아웃 CSS 존재', src.includes('.sc-editor-diff-act'), '');
}

// 버전은 여기서 안 잰다 — 판올림마다 이 파일이 깨지고, 그건 이 기능의 회귀가 아니다.
// (버전·표시명 짝 맞춤은 릴리스 체크리스트의 몫)

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
