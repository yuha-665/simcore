const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.25 — ⚙simcore-pack 이름 비교 느슨하게 + 다시 읽기 진단 문구
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const assets = SC.require('assets');
let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };

console.log('── isManifestComment');
{
  const f = assets.isManifestComment;
  ck('정확 일치', f('⚙simcore-pack'), '');
  ck('변형 선택자 붙은 ⚙️', f('⚙\uFE0Fsimcore-pack'), '');
  ck('앞뒤 공백', f('  ⚙simcore-pack '), '');
  ck('대소문자', f('⚙SimCore-Pack'), '');
  ck('다른 이름은 거부', !f('⚙simcore') && !f('simcore-pack') && !f('⚙simcore-pack2') && !f(null) && !f(''), '');
  ck('스키마 로어 ⚙simcore와 구분', !f('⚙simcore'), '');
}

console.log('── 어댑터·편집기 소스');
{
  ck('어댑터가 isManifestComment로 거른다', src.includes('assetsMod.isManifestComment(l.comment)') && !src.includes("l.comment === assetsMod.MANIFEST_COMMENT"), '');
  ck('스캔 결과에 activeCount·entryCount', src.includes('activeCount: activeSeen,') && src.includes('entryCount: entrySeen,'), '');
  ck('문구: 활성 모듈 0개', src.includes("'활성 모듈이 0개예요 — 모듈이 전역(모듈 메뉴의 켜기) 또는 이 채팅에서 켜져 있어야 읽어요."), '');
  ck('문구: N개 훑었는데 항목 M개 — 검증 제외/이름 확인', src.includes('개를 훑었는데 ⚙simcore-pack 항목이 ') && src.includes('전부 검증에서 제외됐어요(아래 ⚠)') && src.includes('이름(코멘트)이 ⚙simcore-pack인지 확인하세요'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
