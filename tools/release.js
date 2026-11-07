#!/usr/bin/env node
// 플러그인 배포 — 공개 리포 yuha-665/simcore-release에 번들을 올린다 (v1.21.5).
// 사용자 리수는 설정 → 플러그인 화면을 열 때 그 리포의 raw 파일 앞 512바이트로 `//@version`을 대 보고 초록 업데이트 버튼을 띄운다.
// 올리는 순간 모든 사용자에게 버튼이 뜬다 — **집 실기(리수에서 돌려 봄) 뒤에만** 돌릴 것.
//
//   node tools/release.js            빌드 → 바이트 대조 → 머리말·버전 확인 → 복사 → 커밋 → 푸시
//   node tools/release.js --dry      확인만 (복사·커밋·푸시 안 함)
//   node tools/release.js --no-push  커밋까지만
//
// 배포 리포는 이 리포 옆 폴더(../simcore-release)에 clone해 둔다. 다른 자리면 SIMCORE_RELEASE_DIR.
//   git clone https://github.com/yuha-665/simcore-release.git ../simcore-release
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REL = process.env.SIMCORE_RELEASE_DIR || path.resolve(ROOT, '..', 'simcore-release');
const FILE = 'simcore.plugin.js';
const UPDATE_URL = 'https://raw.githubusercontent.com/yuha-665/simcore-release/main/simcore.plugin.js';
const DRY = process.argv.includes('--dry');
const NO_PUSH = process.argv.includes('--no-push');

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

// ① 번들 = 소스의 빌드 산출물인가 (소스를 고치고 cp를 빠뜨리면 옛 번들이 나간다)
run(process.execPath, ['build.js'], ROOT);
const built = fs.readFileSync(path.join(ROOT, 'dist', FILE));
const bundle = fs.readFileSync(path.join(ROOT, FILE));
if (!built.equals(bundle)) die(`${FILE}이 빌드 산출물과 다르다 — cp dist/${FILE} ${FILE} 했나?`);
if (bundle.indexOf(0) !== -1) die('번들에 NUL 바이트가 있다');

// ② 머리말 — 리수가 거부하는 꼴이면 업데이트 버튼이 실패로 끝난다
const src = bundle.toString('utf8');
const ver = head(src, 'version'), name = head(src, 'display-name');
if (!ver) die('//@version 없음');
if (head(src, 'update-url') !== UPDATE_URL) die(`//@update-url이 ${UPDATE_URL}가 아님`);
if (!name.includes(`v${ver}`)) die(`display-name에 v${ver}가 없다 — 둘을 같이 올릴 것`);
const testBundle = spawnSync(process.execPath, [path.join('테스트', 'test-bundle.js')], { cwd: ROOT, encoding: 'utf8' });
const tail = (testBundle.stdout || '').trim().split('\n').pop();
if (testBundle.status !== 0 || !/ 0 failed/.test(tail)) die(`테스트/test-bundle.js 실패 — ${tail}`);

// ③ 배포 리포 — 최신으로 받고, 올라가 있는 판보다 버전이 높아야 한다 (같으면 사용자 버튼이 안 뜬다)
if (!fs.existsSync(path.join(REL, '.git'))) die(`배포 리포가 없다: ${REL}\n  git clone https://github.com/yuha-665/simcore-release.git "${REL}"`);
if (git('status', '--porcelain')) die(`배포 리포에 커밋 안 한 변경이 있다: ${REL}`);
// 추적 브랜치가 있을 때만 받는다 — 첫 배포(원격 리포를 만들기 전)엔 없다
const tracked = spawnSync('git', ['-c', `safe.directory=${REL.replace(/\\/g, '/')}`, 'rev-parse', '--abbrev-ref', '@{u}'], { cwd: REL, encoding: 'utf8' }).status === 0;
if (!DRY && tracked) git('pull', '--ff-only', '-q');
const relPath = path.join(REL, FILE);
const prev = fs.existsSync(relPath) ? head(fs.readFileSync(relPath, 'utf8'), 'version') : '';
if (prev && !newer(ver, prev)) die(`버전이 안 올랐다 — 배포본 v${prev}, 이번 v${ver}`);

console.log(`✓ 빌드 바이트 일치 · 머리말 · test-bundle 통과 — v${prev || '(첫 배포)'} → v${ver}`);
console.log(`  ${name}`);
if (DRY) { console.log('  --dry: 여기서 멈춤'); process.exit(0); }

// ④ 올리기
fs.copyFileSync(path.join(ROOT, FILE), relPath);
git('add', FILE);
git('commit', '-q', '-m', `SimCore v${ver} — ${name.replace(/^SimCore \(시뮬 엔진\) v[\d.]+\s*/, '')}`);
if (NO_PUSH) { console.log('✓ 커밋까지 (--no-push)'); process.exit(0); }
git('push', '-q', ...(tracked ? [] : ['-u']), 'origin', 'HEAD');
console.log(`✓ 푸시 완료 — ${UPDATE_URL}`);
console.log('  raw 파일은 GitHub 캐시로 몇 분 늦게 바뀔 수 있다. 사용자 쪽은 설정 → 플러그인 화면을 다시 열면 버튼이 뜬다.');
