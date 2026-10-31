#!/usr/bin/env node
// 다리 배포판 — 리포가 비공개라 플러그인 옆에 이 zip을 같이 올린다. 결과: 배포/SimCore-bridge.zip
// 파일을 고치면 다시 만들 것 (test-clibridge가 zip 안의 파일이 소스와 같은지 본다).
// 이름은 ASCII만 — 압축 프로그램에 따라 한글 파일 이름이 깨진다. README.txt는 메모장이 바로 읽게 BOM + CRLF로 담는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const NAME = 'SimCore-bridge';
const OUT = path.resolve(__dirname, '../../배포', `${NAME}.zip`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'simcore-bridge-'));
const dir = path.join(tmp, NAME);
fs.mkdirSync(dir);
for (const f of ['cli-bridge.bat', 'simcore-cli-bridge.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
fs.writeFileSync(path.join(dir, 'README.txt'), '\ufeff' + fs.readFileSync(path.join(__dirname, 'README.txt'), 'utf8').replace(/\r?\n/g, '\r\n'));

fs.rmSync(OUT, { force: true });
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar';
const r = spawnSync(tar, ['-a', '-c', '-f', OUT, '-C', tmp, NAME], { encoding: 'utf8' });
fs.rmSync(tmp, { recursive: true, force: true });
if (r.error || r.status !== 0) { console.error('압축 실패:', r.error?.message || r.stderr); process.exit(1); }
console.log(`${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)}KB)`);
