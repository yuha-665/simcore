const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.10.1 — 현황 탭 목록 변수 칩의 ✕가 잘려 지울 수 없던 회귀.
// 계기(커뮤니티 제보, 2026-09-17): "현황 탭에서 리스트로 된 변수들, 좀만 길어도 잘려서
// x 버튼 안 보이고 삭제도 안 된다".
// 원인은 둘이 겹친 것:
//   ① .chip 이 white-space:nowrap → 항목 길이만큼 칸 밖으로 자란다
//   ② 감싼 .sc-var-current 가 overflow-x:hidden → 칸 밖을 잘라 낸다 (가로 스크롤조차 없다)
// ✕는 칩의 맨 끝이라 가장 먼저 잘리고, 보이지 않는 버튼은 없는 버튼이다.
//
// 여기서 못 박는 것 — **잘라 내는 상자 안에 조작 버튼을 두지 마라**:
//   · 칩은 접힌다 (white-space가 nowrap이 아니고, max-width가 칸을 안 넘는다)
//   · ✕·숫자·기한은 안 쪼개진다 (flex:0 0 auto) — 접히는 건 글자뿐이어야 한다
//   · 자르는 상자(overflow-x:hidden)는 그대로 둔다. 자르기를 없애는 게 아니라 넘칠 일을 없앤다
//   · 목록 행은 현재값 칸이 colSpan으로 넓다 (18% 고정 칸에 접어 넣으면 두세 글자마다 줄바꿈)
//   · .sc-var-current 는 td가 아니라 안쪽 div다 — 아니면 추가 입력까지 스크롤 상자에 갇힌다
const fs = require('fs');
const src = fs.readFileSync(__P('../adapter/risu-plugin.js'), 'utf8');
const bundle = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── 캐스케이드를 흉내 낸다 ───────────────────────────────────────
// 패널 스타일시트엔 같은 선택자가 여러 번 나온다 — 옛 하드코딩 팔레트, v1.9.x 토큰 되묶음,
// 그리고 좁은 화면 @media. "마지막 규칙 하나"를 보면 @media의 min-height만 집어 온다.
// 선언을 소스 순서로 훑어 **마지막 값**을 남기는 게 실제로 먹는 값이다.
const RX = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function cascade(sel, prop) {
  let val = null, n = 0;
  for (const m of src.matchAll(new RegExp(RX(sel) + '\\s*\\{([^}]*)\\}', 'g'))) {
    n++;
    for (const d of m[1].matchAll(new RegExp('(?:^|;)\\s*' + RX(prop) + '\\s*:\\s*([^;!}]+)', 'g'))) {
      val = d[1].trim();
    }
  }
  return { val, n };
}
ck('패널에 .chip 규칙이 있다', cascade('#sc-root .chip', 'display').n >= 2,
  `${cascade('#sc-root .chip', 'display').n}개`);

ck('★ 칩이 nowrap이 아니다 — 칸 밖으로 자라면 ✕부터 잘린다',
  cascade('#sc-root .chip', 'white-space').val !== 'nowrap',
  String(cascade('#sc-root .chip', 'white-space').val));
ck('★ 칩이 칸을 안 넘는다 (max-width:100%)',
  cascade('#sc-root .chip', 'max-width').val === '100%',
  String(cascade('#sc-root .chip', 'max-width').val));
ck('칩이 flex 아이템으로 줄어들 수 있다 (min-width:0)',
  cascade('#sc-root .chip', 'min-width').val === '0',
  String(cascade('#sc-root .chip', 'min-width').val));
ck('여러 줄이 돼도 안 뭉개지는 반지름 (999px 아님)',
  cascade('#sc-root .chip', 'border-radius').val !== '999px',
  String(cascade('#sc-root .chip', 'border-radius').val));

// ── 접히는 건 글자뿐 ─────────────────────────────────────────────
for (const [label, sel] of [['✕ 버튼', '#sc-root .chip button'],
  ['숫자', '#sc-root .chip .num'], ['기한·숫자없음', '#sc-root .chip .nonum']]) {
  const c = cascade(sel, 'flex');
  ck(`${label}는 안 쪼개진다 (flex:0 0 auto)`, c.val === '0 0 auto', String(c.val));
}
ck('숫자·기한은 제 안에서 줄바꿈 안 한다 (nowrap 유지)',
  cascade('#sc-root .chip .num', 'white-space').val === 'nowrap'
  && cascade('#sc-root .chip .nonum', 'white-space').val === 'nowrap', '');
ck('글자 칸만 아무 데서나 접힌다 (overflow-wrap:anywhere)',
  cascade('#sc-root .chip > span:first-child', 'overflow-wrap').val === 'anywhere', '');

// ── 자르는 상자는 그대로 둔다 ────────────────────────────────────
// overflow-x:hidden을 없애는 것으로 "고쳤다"고 하면 이번엔 가로 스크롤이 생겨 ✕가
// 화면 밖으로 간다. 자르기를 없애는 게 아니라 **넘칠 일을 없애는** 쪽이 맞다.
ck('현재값 상자는 여전히 가로를 자른다 (해법은 넘칠 일을 없애는 것)',
  /\.sc-var-current \{[^}]*overflow-x\s*:\s*hidden/.test(src), '');

// ── 목록 행의 구조 ───────────────────────────────────────────────
const listSeg = src.slice(src.indexOf("if (v.type === 'list') {"));
const listBody = listSeg.slice(0, listSeg.indexOf('table.appendChild(tr);'));
ck('목록 행 본문 추출', listBody.length > 400 && listBody.includes("className = 'chips'"), `${listBody.length}자`);

ck('★ 목록 행의 현재값 칸이 colSpan으로 넓다 — 18% 칸엔 칩이 안 들어간다',
  /tdCur\.colSpan\s*=\s*3/.test(listBody), '');
ck('.sc-var-current 가 td가 아니라 안쪽 div다 (스칼라 행과 같은 모양)',
  /curBox\.className = 'sc-var-current'/.test(listBody)
  && !/tdCur\.className = 'sc-var-current'/.test(listBody), '');
ck('추가 입력은 스크롤 상자 밖이다 — 안에 두면 칩과 같이 스크롤된다',
  listBody.indexOf("tdCur.appendChild(curBox)") < listBody.indexOf("addRow.className = 'sc-var-add'")
  || /tdCur\.appendChild\(addRow\)/.test(listBody), '');
ck('추가 줄이 칩 아래 한 줄로 내려갔다',
  /addRow\.className = 'sc-var-add'/.test(listBody) && /tdCur\.appendChild\(addRow\)/.test(listBody), '');
ck('옛 2칸 구조(tdAdd·tdAddBtn)가 남아 있지 않다',
  !/tdAddBtn/.test(listBody) && !/const tdAdd = /.test(listBody), '');
ck('항목 삭제 버튼은 그대로 있다', /x\.title = '이 항목 제거'/.test(listBody), '');
ck('.sc-var-add 스타일이 정의돼 있다',
  /#sc-root #sc-vars \.sc-var-add \{/.test(src), '');
ck('.sc-var-add 입력이 남는 폭을 먹는다 (flex:1 1 auto)',
  /#sc-root #sc-vars \.sc-var-add input \{[^}]*flex\s*:\s*1 1 auto/.test(src), '');

// ── 번들 반영 ────────────────────────────────────────────────────
ck('번들에 칩 접힘 규칙이 실렸다',
  bundle.includes('#sc-root .chip > span:first-child'), '');
ck('번들에 목록 행 colSpan이 실렸다', bundle.includes('tdCur.colSpan = 3'), '');
ck('번들에 .sc-var-add 가 실렸다', bundle.includes("addRow.className = 'sc-var-add'"), '');

// ── 버전 ─────────────────────────────────────────────────────────
ck('버전이 v1.10.1 이상', /\/\/@version 1\.1[0-9]\.([1-9]|\d\d)/.test(src), '');
ck('체인지로그에 v1.10.1 항목', src.includes('── v1.10.1 ─'), '');

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
