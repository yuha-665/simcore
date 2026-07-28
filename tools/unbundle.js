// 번들(simcore.plugin.js) → 소스(core/*, adapter/risu-plugin.js) 역추출
// 로컬에서 번들을 직접 수정한 판본을 소스 트리로 되돌릴 때 사용.
// 사용: node tools/unbundle.js <번들 경로>
// 검증: 역추출 후 node build.js 산출물이 입력 번들과 바이트 단위로 일치해야 한다.
//
// 번들 조립 규약 (build.js와 1:1 대응):
//   out   = header + '\n\n' + SHIM2 + wraps.join('\n') + '\n' + body
//   wrap  = 'SimCore.define("name", function (require, module, exports) {\n' + code + '\n});\n'
//   body  = 어댑터 파일에서 선두 '//' 헤더를 뗀 나머지 (선두 공백행 포함)
const fs = require('fs');
const path = require('path');

const bundlePath = process.argv[2];
if (!bundlePath) { console.error('사용: node tools/unbundle.js <번들 경로>'); process.exit(1); }
const src = fs.readFileSync(bundlePath, 'utf8');

// 1) 헤더 / 심 경계
const shimMark = '\n\n\nconst SimCore = (() => {';
const shimIdx = src.indexOf(shimMark);
if (shimIdx < 0) { console.error('심(SimCore 셔틀)을 찾지 못함 — 번들 구조가 바뀐 듯'); process.exit(1); }
const header = src.slice(0, shimIdx);

// 2) 어댑터 본문 시작점 (줄 시작의 유일한 IIFE)
const anchorRe = /^\(async \(\) => \{$/m;
const am = anchorRe.exec(src);
if (!am) { console.error('어댑터 본문((async () => {)을 찾지 못함'); process.exit(1); }
const adapterAnchor = am.index;

// 3) 모듈 추출
const defRe = /^SimCore\.define\("([A-Za-z0-9_-]+)", function \(require, module, exports\) \{$/gm;
const defs = [];
let m;
while ((m = defRe.exec(src))) defs.push({ name: m[1], start: m.index, codeStart: m.index + m[0].length + 1 });
if (!defs.length) { console.error('모듈 define을 찾지 못함'); process.exit(1); }

const shim = src.slice(shimIdx + 2, defs[0].start); // SHIM2 원문 (선두 \n 포함)

const SEP = '\n});\n\n'; // 래퍼 닫힘(\n});\n) + 다음 조각과의 이음(\n)
const modules = [];
for (let i = 0; i < defs.length; i++) {
  const d = defs[i];
  const searchEnd = i + 1 < defs.length ? defs[i + 1].start : adapterAnchor;
  const closeIdx = src.lastIndexOf(SEP, searchEnd);
  if (closeIdx < d.codeStart) { console.error(`모듈 ${d.name}의 닫힘을 찾지 못함`); process.exit(1); }
  modules.push({ name: d.name, code: src.slice(d.codeStart, closeIdx), end: closeIdx + SEP.length });
}
const adapterBody = src.slice(modules[modules.length - 1].end); // 선두 공백행부터가 body

// 4) 쓰기
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'core'), { recursive: true });
fs.mkdirSync(path.join(root, 'adapter'), { recursive: true });
for (const mod of modules) {
  fs.writeFileSync(path.join(root, 'core', mod.name + '.js'), mod.code);
  console.log(`core/${mod.name}.js  (${mod.code.length}자)`);
}
fs.writeFileSync(path.join(root, 'adapter', 'risu-plugin.js'), header + '\n' + adapterBody);
console.log(`adapter/risu-plugin.js  (헤더 ${header.length}자 + 본문 ${adapterBody.length}자)`);
fs.writeFileSync(path.join(root, 'tools', 'extracted-shim.txt'), shim);
console.log('심 원문 → tools/extracted-shim.txt (build.js SHIM2와 대조용)');
console.log('모듈 순서:', modules.map((x) => x.name).join(', '));
