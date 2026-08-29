const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.70 메뉴 재편성 + 세션 시계 — 이용자 피드백 채택분의 번들 배선 실측.
//
// 피드백 4건의 처분이 이 파일의 구조다:
//   ① 메뉴 범주화(작업도구/파일관리) → 채택, 여기서 지킨다
//   ② 현황 탭 세션 시계 표시·수정 → 채택, 여기서 지킨다
//   ③ ⟦simcore:N⟧ 건너뛰기 → 버그가 아니라 설계(마커 = 메시지 인덱스 = 스냅샷 키).
//      고치면 리롤 멱등이 깨진다 — 도움말 설명으로 처분, 그 설명의 존재를 여기서 지킨다
//   ④ 글노덮 대행 → 보류 (유저 판단 유보)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const timeMod = SC.require('time');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── ① 사이드 내비 범주화 ──
{
  ck('★ 범주 캡션 2개 (작업도구·파일관리)',
    src.includes('<div class="sc-navcat">작업도구</div>') && src.includes('<div class="sc-navcat">파일관리</div>'), '');
  ck('★ 작업도구 4항목 — 새 소제목', ['✨ AI 어시스턴트', '🧾 JSON 관리자', '🎨 에셋 관리자', '🧰 세부 편집기']
    .every((s) => src.includes(s)), '');
  // 옛 소제목이 사이드바 버튼에 남아 있으면 이름만 반쪽 개편된 것
  ck('★ 사이드바에 옛 소제목 없음', !/data-floor="top">✨ AI에게 맡기기|data-floor="json">🧾 JSON 작업대|data-floor="assets">🎨 에셋 팩|data-floor="deep">🧰 심층 편집/.test(src), '');
  ck('동사구 "AI에게 맡기기"는 살아 있다 (탭 이름이 아니라 행위 설명)',
    src.includes('만 AI에게 맡기기'), '');
  ck('범주 캡션은 좁은 화면에서 숨김 (가로 탭에서 자리만 먹는다)',
    /#sc-root \.sc-navcat \{ display:none; \}/.test(src), '');
}

// ── ①-2 편집 작업공간 독립 페이지 ──
{
  ck('★ 작업공간 페이지 존재 (sc-page-work)', src.includes('id="sc-page-work"')
    && src.includes('data-page="work"'), '');
  const workAt = src.indexOf('id="sc-page-work"');
  const editAt = src.indexOf('id="sc-page-edit"');
  const editEnd = src.indexOf('id="sc-page-save"');
  const editSlice = src.slice(editAt, workAt > editAt ? workAt : editEnd);
  ck('★ 편집 페이지에서 설치 카드 사라짐 (중복 노출 해소)',
    !editSlice.includes('캐릭터 설치 관리') && !editSlice.includes('템플릿에서 시작'), '');
  const workSlice = src.slice(workAt, editEnd);
  ck('★ 설치 관리·템플릿·루아 브리지가 작업공간에', ['캐릭터 설치 관리', '템플릿에서 시작', 'Lua 브리지']
    .every((s) => workSlice.includes(s)), '');
  ck('★ 작업공간 직행에도 편집기 준비 (적용 버튼이 editor를 읽는다)',
    src.includes("if (tab.dataset.page === 'work') ensureEditor();"), '');
  ck('★ 편집 페이지 머리글은 층별 제목 (FLOOR_HEADS)',
    src.includes('const FLOOR_HEADS') && src.includes("document.getElementById('sc-edit-title')"), '');
  ck('★ 더티 배너는 편집·작업공간 양쪽에 (sc-work-warn)',
    src.includes('id="sc-work-warn"') && src.includes("document.getElementById('sc-work-warn')"), '');
  ck('세이브 페이지의 백업 복원 안내가 여전히 작업공간을 가리킨다',
    src.includes('편집 작업공간의 백업 복원으로 되돌릴 수 있어요'), '');
}

// ── ② 세션 시계 카드 ──
{
  ck('★ 시계 카드 존재 (기본 숨김 — time 없는 스키마)',
    src.includes('id="sc-clock-card" style="display:none"') && src.includes('세션 시계'), '');
  ck('★ 렌더가 time 모듈의 같은 산술을 쓴다 (timeConfig·calendarOf·formatDate)',
    src.includes('timeMod.timeConfig(schema)') && src.includes('timeMod.calendarOf(epoch')
    && src.includes('timeMod.formatDate(tcfg.dateFmt'), '');
  ck('★ 수정은 변수 수동 보정과 같은 규약 (EPOCH_KEY 갱신 → commitVars)',
    src.includes('session.current.vars[timeMod.EPOCH_KEY] = next') && src.includes('await commitVars()'), '');
  ck('★ 직접 지정은 parseStart 해석 — 없는 날짜는 검증과 같은 기준으로 거부',
    src.includes('timeMod.parseStart(') && src.includes('timeMod.epochFrom(parts, tcfg.calendar)'), '');
  ck('빠른 조정 ±1일/±1시간', src.includes("['−1일', -1440]") && src.includes("['+1시간', 60]"), '');
  // 렌더가 기대는 time API가 실제로 그 모양인지 — 문자열 검사의 발밑 확인
  const cfg = timeMod.timeConfig({ time: { start: '2026-08-15 08:00' } });
  ck('time API 발밑: timeConfig가 시작 시각을 해석', cfg && cfg.startEpoch === timeMod.epochFrom({ y: 2026, m: 8, d: 15, h: 8, mi: 0 }), '');
  const cal = timeMod.calendarOf(cfg.startEpoch, cfg.calendar);
  ck('time API 발밑: calendarOf → formatDate 왕복', timeMod.formatDate('YYYY-MM-DD', cal) === '2026-08-15', '');
  ck('time API 발밑: 존재하지 않는 날짜는 parseStart가 null', timeMod.parseStart('2026-02-30 10:00') === null, '');
}

// ── ③ 마커 번호 설명 (도움말) ──
{
  ck('★ 도움말에 ⟦simcore:N⟧ 번호 설명 존재',
    src.includes('⟦simcore:N⟧ 번호는 턴 순번이 아니라') && src.includes('건너뛰는 게 정상'), '');
  // 설명이 거짓말이 아니어야 한다 — 마커 번호가 정말 메시지 인덱스(스냅샷 키)인지
  // (v1.0.1: 스트리밍은 char 메시지가 미리 push돼 있어 length-1, 비스트리밍은 length)
  ck('설명의 근거: outIndex = 메시지 인덱스 (유저 메시지도 번호를 먹는다)',
    src.includes('let outIndex = msgs.length;') && src.includes('outIndex = msgs.length - 1;'), '');
}

// ── 안내 문구 정합 — 옛 행선지가 남으면 유저가 없는 메뉴를 찾아 헤맨다 ──
{
  ck('★ [봇 편집] 행선지 안내 없음 (유저용 문구 기준)',
    !src.includes('[봇 편집]의 [루아 브리지') && !src.includes('[봇 편집]에서 [루아 브리지')
    && !src.includes('먼저 [봇 편집]에서'), '');
  ck('★ 루아 브리지 안내는 [편집 작업공간]으로', src.includes('[편집 작업공간]의 [루아 브리지 설치'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
