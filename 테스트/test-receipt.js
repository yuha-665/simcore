const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.72 변화 로그 영수증 모드 — statusUI.changeLog: open | collapsed(기본) | off.
//
// 이 로그는 엔진 changeLog에서 그려지는 "실제 커밋된 변화"의 영수증이다 — 모델이 직접
// 쓰는 텍스트 영수증(주장)과 출처가 반대라는 게 핵심 가치라, 여기서는 표시 3모드와
// 색 규칙(숫자 델타만 색 — 텍스트·목록에 칠하면 거짓말)을 지킨다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { renderStatusHtml } = SC.require('render');
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const mk = (changeLogOpt) => ({
  simcore: '0.1', meta: { name: '영수증 실험대' },
  vars: [
    { id: 'gold', label: '금화', type: 'int', init: 100, min: 0, max: 9999 },
    { id: 'food', label: '식자재', type: 'int', init: 10, min: 0, max: 99 },
    { id: 'mood', label: '분위기', type: 'text', init: '평온', maxLength: 20 },
  ],
  statusUI: { mode: 'auto', groups: [], ...(changeLogOpt ? { changeLog: changeLogOpt } : {}) },
});
const LOG = [
  { id: 'gold', from: 100, to: 145, source: 'llm', reason: '저녁 장사 3인분 판매' },
  { id: 'food', from: 10, to: 7, source: 'llm', reason: '모험가 3인 식사' },
  { id: 'mood', from: '평온', to: '북적임', source: 'event:rush' },
];
const st = (S) => engine.initState(S);

// ── 기본(collapsed) — 기존 동작 유지 ──
{
  const S = mk(null);
  ck('실험대 유효', validateSchema(S).ok, '');
  const html = renderStatusHtml(S, st(S), LOG);
  ck('★ 기본은 접힌 details (open 속성 없음)',
    html.includes('<details class="sim-log">') && !html.includes('sim-log-open'), '');
  ck('★ 라벨·델타·사유가 구조화된 span으로', html.includes('<span class="sim-log-name">금화</span>')
    && html.includes('sim-log-reason">저녁 장사 3인분 판매'), '');
  ck('★ 숫자 증가는 plus, 감소는 minus', html.includes('sim-log-diff plus">+45')
    && html.includes('sim-log-diff minus">-3'), '');
  ck('★ 텍스트 교체는 무색 (색을 칠하면 거짓말)', /sim-log-diff">평온 → 북적임/.test(html), '');
}

// ── open — 영수증처럼 항상 펼침 ──
{
  const S = mk('open');
  ck('open 스키마 유효', validateSchema(S).ok, '');
  const html = renderStatusHtml(S, st(S), LOG);
  ck('★ open이면 <details ... open> + 영수증 클래스',
    html.includes('<details class="sim-log sim-log-open" open>'), '');
}

// ── off — 로그 자체를 안 그림 ──
{
  const S = mk('off');
  ck('off 스키마 유효', validateSchema(S).ok, '');
  const html = renderStatusHtml(S, st(S), LOG);
  ck('★ off면 변화 로그 없음', !html.includes('이번 턴 변화') && !html.includes('sim-log'), '');
}

// ── 검증 + 방어 ──
{
  const bad = mk('receipt');
  const v = validateSchema(bad);
  ck('★ 틀린 값은 검증 오류 (open|collapsed|off)', !v.ok
    && v.errors.some((e) => e.path === '$.statusUI.changeLog'), JSON.stringify(v.errors));
  // 검증을 우회해 이상값이 들어와도 렌더는 기본(collapsed)으로 — 조용히 깨지지 않는다
  const html = renderStatusHtml(bad, st(bad), LOG);
  ck('렌더 방어: 이상값 → 기본 접힘', html.includes('<details class="sim-log">')
    && !html.includes('sim-log-open'), '');
}

// ── 편집기·CSS 배선 ──
{
  ck('★ 편집기 상태창 탭에 [변화 로그] 선택 칸 (규칙 #3)',
    src.includes("statusField('변화 로그'") && src.includes('영수증처럼 항상 표시'), '');
  ck('기본값은 스키마에 안 남긴다', src.includes("ui.changeLog = x === 'collapsed' ? undefined : x"), '');
  ck('★ 영수증 CSS — 색·오른쪽 정렬 사유·행 구분선', src.includes('.sim-log-diff.plus{color:')
    && src.includes('.sim-log-reason{margin-left:auto') && src.includes('.sim-log-open .sim-log-item{padding:'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
