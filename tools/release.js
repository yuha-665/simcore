#!/usr/bin/env node
// 플러그인 배포 — 공개 리포 yuha-665/simcore-release에 번들을 올린다 (v1.21.5). 다리 zip도 같이 (v1.22.1).
// 사용자 리수는 설정 → 플러그인 화면을 열 때 그 리포의 raw 파일 앞 512바이트로 `//@version`을 대 보고 초록 업데이트 버튼을 띄운다.
// 올리는 순간 모든 사용자에게 버튼이 뜬다 — **집 실기(리수에서 돌려 봄) 뒤에만** 돌릴 것.
//
//   node tools/release.js                빌드 → 바이트 대조 → 머리말·버전 확인 → (다리가 바뀌었으면 zip도) → 복사 → 커밋 → 푸시
//   node tools/release.js --dry          확인만 (복사·커밋·푸시 안 함)
//   node tools/release.js --no-push      커밋까지만
//   node tools/release.js --bridge-only  다리 zip만 (플러그인 버전 확인·복사 생략 — 다리 파일이 바뀌었을 때만)
//
// 다리(tools/cli-bridge)는 플러그인과 버전이 따로다 — bat·js·README.txt가 바뀌었을 때만 zip을 새로 묶어 bridge/에 올린다.
// 바뀌었는지는 bridge/MANIFEST.txt(파일별 sha256)로 본다. zip을 매번 다시 묶으면 시각이 달라져 바뀐 게 없어도 커밋이 생긴다.
// 프로톤에 따로 올리던 것을 그만두려고 붙였다 (유저 2026-11-08). 공지의 다리 링크는 README의 다리 절 또는 아래 BRIDGE_URL.
//
// 배포 리포는 이 리포 옆 폴더(../simcore-release)에 clone해 둔다. 다른 자리면 SIMCORE_RELEASE_DIR.
//   git clone https://github.com/yuha-665/simcore-release.git ../simcore-release
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REL = process.env.SIMCORE_RELEASE_DIR || path.resolve(ROOT, '..', 'simcore-release');
const FILE = 'simcore.plugin.js';
const UPDATE_URL = 'https://raw.githubusercontent.com/yuha-665/simcore-release/main/simcore.plugin.js';
const BRIDGE_SRC = path.join(ROOT, 'tools', 'cli-bridge');
const BRIDGE_FILES = ['cli-bridge.bat', 'simcore-cli-bridge.js', 'README.txt']; // pack.js가 zip에 담는 것
const BRIDGE_ZIP = 'SimCore-bridge.zip';
const BRIDGE_URL = 'https://github.com/yuha-665/simcore-release/raw/main/bridge/SimCore-bridge.zip';
const DRY = process.argv.includes('--dry');
const NO_PUSH = process.argv.includes('--no-push');
const BRIDGE_ONLY = process.argv.includes('--bridge-only');

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) die(`${cmd} ${args.join(' ')} 실패\n${(r.stderr || r.stdout || '').trim()}`);
  return (r.stdout || '').trim();
};
// E: 드라이브 리포는 소유자 SID가 달라 dubious ownership으로 막힌다 — 전역 설정은 안 건드리고 명령마다 연다
const git = (...args) => run('git', ['-c', `safe.directory=${REL.replace(/\\/g, '/')}`, ...args], REL);
const head = (src, key) => { const l = src.split('\n').find((x) => x.startsWith(`//@${key} `)); return l ? l.slice(key.length + 4).trim() : ''; };
const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
// 테스트 하나를 돌려 통과를 확인한다 — 집계 줄이 마지막 줄, 형식이 둘이다("N passed, 0 failed" / "[test-x] N/N 통과")
const testOk = (file) => {
  const r = spawnSync(process.execPath, [path.join('테스트', file)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const tail = (r.stdout || '').trim().split('\n').pop();
  if (r.status !== 0 || !(/ 0 failed/.test(tail) || /(\d+)\/\1 통과/.test(tail))) die(`테스트/${file} 실패 — ${tail}`);
};

let ver = '', name = '', prev = '';
if (!BRIDGE_ONLY) {
  // ① 번들 = 소스의 빌드 산출물인가 (소스를 고치고 cp를 빠뜨리면 옛 번들이 나간다)
  run(process.execPath, ['build.js'], ROOT);
  const built = fs.readFileSync(path.join(ROOT, 'dist', FILE));
  const bundle = fs.readFileSync(path.join(ROOT, FILE));
  if (!built.equals(bundle)) die(`${FILE}이 빌드 산출물과 다르다 — cp dist/${FILE} ${FILE} 했나?`);
  if (bundle.indexOf(0) !== -1) die('번들에 NUL 바이트가 있다');

  // ② 머리말 — 리수가 거부하는 꼴이면 업데이트 버튼이 실패로 끝난다
  const src = bundle.toString('utf8');
  ver = head(src, 'version'); name = head(src, 'display-name');
  if (!ver) die('//@version 없음');
  if (head(src, 'update-url') !== UPDATE_URL) die(`//@update-url이 ${UPDATE_URL}가 아님`);
  if (!name.includes(`v${ver}`)) die(`display-name에 v${ver}가 없다 — 둘을 같이 올릴 것`);
  testOk('test-bundle.js');
}

// ③ 배포 리포 — 최신으로 받고, 올라가 있는 판보다 버전이 높아야 한다 (같으면 사용자 버튼이 안 뜬다)
if (!fs.existsSync(path.join(REL, '.git'))) die(`배포 리포가 없다: ${REL}\n  git clone https://github.com/yuha-665/simcore-release.git "${REL}"`);
if (git('status', '--porcelain')) die(`배포 리포에 커밋 안 한 변경이 있다: ${REL}`);
// 추적 브랜치가 있을 때만 받는다 — 첫 배포(원격 리포를 만들기 전)엔 없다
const tracked = spawnSync('git', ['-c', `safe.directory=${REL.replace(/\\/g, '/')}`, 'rev-parse', '--abbrev-ref', '@{u}'], { cwd: REL, encoding: 'utf8' }).status === 0;
if (!DRY && tracked) git('pull', '--ff-only', '-q');
const relPath = path.join(REL, FILE);
if (!BRIDGE_ONLY) {
  prev = fs.existsSync(relPath) ? head(fs.readFileSync(relPath, 'utf8'), 'version') : '';
  if (prev && !newer(ver, prev)) die(`버전이 안 올랐다 — 배포본 v${prev}, 이번 v${ver}`);
}

// ④ 다리 — 소스 파일의 지문이 배포본 MANIFEST와 다를 때만 다시 묶는다
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const bridgeJs = fs.readFileSync(path.join(BRIDGE_SRC, 'simcore-cli-bridge.js'), 'utf8');
const bridgeVer = (bridgeJs.match(/^const VERSION = '([^']+)'/m) || [])[1];
if (!bridgeVer) die('다리 버전(const VERSION)을 못 찾았다 — tools/cli-bridge/simcore-cli-bridge.js');
const manifest = [`SimCore-bridge ${bridgeVer}`,
  ...BRIDGE_FILES.map((f) => `${sha(fs.readFileSync(path.join(BRIDGE_SRC, f)))}  ${f}`)].join('\n') + '\n';
const relBridge = path.join(REL, 'bridge');
const relManifest = path.join(relBridge, 'MANIFEST.txt');
const prevManifest = fs.existsSync(relManifest) ? fs.readFileSync(relManifest, 'utf8') : '';
const prevBridgeVer = (prevManifest.match(/^SimCore-bridge (\S+)/) || [])[1] || '';
const bridgeChanged = manifest !== prevManifest;
if (BRIDGE_ONLY && !bridgeChanged) die(`다리가 배포본과 같다 (다리 ${bridgeVer}) — 올릴 것이 없다`);

if (!BRIDGE_ONLY) {
  console.log(`✓ 빌드 바이트 일치 · 머리말 · test-bundle 통과 — v${prev || '(첫 배포)'} → v${ver}`);
  console.log(`  ${name}`);
}
console.log(bridgeChanged
  ? `✓ 다리 ${prevBridgeVer ? `${prevBridgeVer} → ` : '(첫 배포) '}${bridgeVer} — 파일이 바뀌어 zip을 새로 묶는다`
  : `  다리 ${bridgeVer} — 배포본과 같다 (안 올림)`);
if (DRY) { console.log('  --dry: 여기서 멈춤'); process.exit(0); }

// ⑤ 올리기
if (!BRIDGE_ONLY) {
  fs.copyFileSync(path.join(ROOT, FILE), relPath);
  git('add', FILE);
}
if (bridgeChanged) {
  run(process.execPath, [path.join('tools', 'cli-bridge', 'pack.js')], ROOT);   // → 배포/SimCore-bridge.zip
  testOk('test-clibridge.js');   // zip 안의 bat·js가 소스와 같고 README가 메모장용(BOM·CRLF)인지 — 옛 파일이 다시 나가면 안 된다
  fs.mkdirSync(relBridge, { recursive: true });
  fs.copyFileSync(path.join(ROOT, '배포', BRIDGE_ZIP), path.join(relBridge, BRIDGE_ZIP));
  fs.writeFileSync(relManifest, manifest);
  git('add', 'bridge');
}
const what = name.replace(/^SimCore \(시뮬 엔진\) v[\d.]+\s*/, '');
git('commit', '-q', '-m', BRIDGE_ONLY
  ? `다리 ${bridgeVer} — ${BRIDGE_ZIP}`
  : `SimCore v${ver} — ${what}${bridgeChanged ? ` · 다리 ${bridgeVer}` : ''}`);
if (NO_PUSH) { console.log('✓ 커밋까지 (--no-push)'); process.exit(0); }
git('push', '-q', ...(tracked ? [] : ['-u']), 'origin', 'HEAD');
console.log(`✓ 푸시 완료${BRIDGE_ONLY ? '' : ` — ${UPDATE_URL}`}`);
if (bridgeChanged) console.log(`  다리: ${BRIDGE_URL}`);
console.log('  raw 파일은 GitHub 캐시로 몇 분 늦게 바뀔 수 있다. 사용자 쪽은 설정 → 플러그인 화면을 다시 열면 버튼이 뜬다.');
