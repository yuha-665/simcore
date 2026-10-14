#!/usr/bin/env node
// simcore-cli-bridge — 이 PC에 깔린 Claude Code(구독 로그인) · Codex(ChatGPT 로그인)를 HTTP로 내어 준다.
//
// 왜: SimCore 편집기의 AI 어시스턴트(스키마 생성·💬 대화)는 리수의 API 모델을 탔다. 클로드 코드·코덱스
// 구독자에겐 API 키를 따로 사는 길이라 나쁜 길이다. 플러그인은 리수 샌드박스 안이라 프로세스를 못 띄우므로,
// PC에서 이 파일 하나를 켜 두고 플러그인이 http://127.0.0.1:5181 로 묻는다 (Risuai.nativeFetch).
//
// 사용: node simcore-cli-bridge.js   (또는 cli-bridge.bat 더블클릭)   — 의존 패키지 없음, Node 18 이상
//   SIMCORE_CLI_PORT=5181  SIMCORE_CLI_HOST=127.0.0.1  (바깥에서 열고 싶으면 0.0.0.0 — 권장하지 않음)
//   SIMCORE_CLI_CLAUDE_BIN / SIMCORE_CLI_CODEX_BIN  실행 파일 직접 지정 (테스트용 가짜도 여기로)
//
// 엔드포인트 (OpenAI 호환 — 리수 데스크톱의 커스텀 모델로도 그대로 꽂힌다):
//   GET  /health                → { ok, backends: { 'claude-code': {found, from, version}, codex: {found, from, loggedIn} } }
//   GET  /v1/models             → { data: [{ id, label, backend }] }   id = 'claude-code' | 'claude-code:opus' | 'codex' | 'codex:<slug>'
//   POST /v1/chat/completions   → { model, messages:[{role, content}], stream? }  → OpenAI 모양 응답 (stream이면 SSE)
//
// 격리 (노벨 스튜디오 claudeCode.ts와 같은 선택 — 사용자의 Claude Code 환경과 섞이지 않게):
//   --tools ""  --setting-sources ""  --strict-mcp-config  --no-session-persistence  --disable-slash-commands
//   로그인은 Claude Code가 하던 그대로 쓴다. 이 파일은 인증 정보를 읽지도 저장하지도 않는다.
//   --bare는 로그인(OAuth)까지 건너뛰어 "Not logged in"이 되므로 쓰지 않는다.
//   시스템 프롬프트는 파일로, 본문은 표준 입력으로 (명령줄 길이 제한 회피).
// Codex: 빈 임시 폴더에서 읽기 전용(--sandbox read-only)·기록 없이(--ephemeral). 지시문 옵션이 없어 본문 앞에 붙인다.
//
// 이 다리는 요청·응답 본문을 어디에도 남기지 않는다. 콘솔에는 시각·백엔드·소요·토큰만 찍는다.

'use strict';
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const VERSION = '1.0.0';
const PORT = Number(process.env.SIMCORE_CLI_PORT ?? 5181);
const HOST = process.env.SIMCORE_CLI_HOST || '127.0.0.1';
const WORK = path.join(os.tmpdir(), 'simcore-cli-bridge');
const REQUEST_TIMEOUT_MS = 10 * 60_000;
const MAX_BODY = 8 * 1024 * 1024;

// ── 실행 파일 찾기 ─────────────────────────────────────────────────────
const CLAUDE_EXE = process.platform === 'win32' ? 'claude.exe' : 'claude';
const CODEX_EXE = process.platform === 'win32' ? 'codex.exe' : 'codex';
/** 편집기 확장 폴더 — Claude Code 확장은 실행 파일을 확장 안에 넣어 둔다 */
const EXTENSION_DIRS = [
  ['.vscode', 'VS Code'], ['.vscode-insiders', 'VS Code Insiders'], ['.cursor', 'Cursor'], ['.windsurf', 'Windsurf'],
].map(([d, label]) => [path.join(os.homedir(), d, 'extensions'), `${label} 확장`]);

/** 폴더 아래에서 이름이 같은 파일을 찾는다 (깊이 제한) */
function findUnder(dir, name, depth) {
  if (depth < 0) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === name);
  if (hit) return path.join(dir, hit.name);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = findUnder(path.join(dir, e.name), name, depth - 1);
    if (found) return found;
  }
  return null;
}

const pathDirs = () => (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);

/** 확장 폴더에서 접두사가 맞는 최신 버전 폴더 안의 실행 파일 */
function findInExtensions(prefixRe, exe, depth) {
  for (const [base, label] of EXTENSION_DIRS) {
    let names;
    try { names = fs.readdirSync(base); } catch { continue; }
    const found = names.filter((n) => prefixRe.test(n))
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
      .map((n) => findUnder(path.join(base, n), exe, depth))
      .find(Boolean);
    if (found) return { bin: found, from: label };
  }
  return null;
}

/** 찾는 순서: 직접 지정 → PATH → 기본 설치 위치 → npm 전역 설치 → VS Code·Cursor 확장(최신 버전) */
function findClaudeCode() {
  const custom = process.env.SIMCORE_CLI_CLAUDE_BIN;
  if (custom) return fs.existsSync(custom) ? { bin: custom, from: '직접 지정' } : null;
  const dirs = pathDirs();
  for (const dir of dirs) {
    const f = path.join(dir, CLAUDE_EXE);
    if (fs.existsSync(f)) return { bin: f, from: 'PATH' };
  }
  const local = path.join(os.homedir(), '.local', 'bin', CLAUDE_EXE);
  if (fs.existsSync(local)) return { bin: local, from: '기본 설치' };
  // npm 전역 설치(npm i -g): PATH의 claude.cmd는 셸 스크립트라 패키지 안의 실제 파일을 쓴다
  const npmDirs = [
    ...dirs.filter((d) => fs.existsSync(path.join(d, 'claude.cmd'))),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
  ];
  for (const d of npmDirs) {
    const pkg = path.join(d, 'node_modules', '@anthropic-ai', 'claude-code');
    if (!fs.existsSync(pkg)) continue;
    const exe = findUnder(pkg, CLAUDE_EXE, 3);
    if (exe) return { bin: exe, from: 'npm 설치' };
    const cli = path.join(pkg, 'cli.js');
    if (fs.existsSync(cli)) return { bin: cli, from: 'npm 설치' };
  }
  return findInExtensions(/^anthropic\.claude-code-/, CLAUDE_EXE, 4);
}

/** 찾는 순서: 직접 지정 → PATH의 codex.exe → npm 전역(@openai/codex) → VS Code 확장(openai.chatgpt) */
function findCodex() {
  const custom = process.env.SIMCORE_CLI_CODEX_BIN;
  if (custom) return fs.existsSync(custom) ? { bin: custom, from: '직접 지정' } : null;
  const dirs = pathDirs();
  for (const dir of dirs) {
    const f = path.join(dir, CODEX_EXE);
    if (fs.existsSync(f)) return { bin: f, from: 'PATH' };
  }
  const npmDirs = [
    ...dirs.filter((d) => fs.existsSync(path.join(d, 'codex.cmd'))),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
  ];
  for (const d of npmDirs) {
    const found = findUnder(path.join(d, 'node_modules', '@openai'), CODEX_EXE, 7);
    if (found) return { bin: found, from: 'npm 설치' };
  }
  return findInExtensions(/^openai\.chatgpt-/, CODEX_EXE, 4);
}

// ── 프로세스 ──────────────────────────────────────────────────────────
/** 앱을 Claude Code 안에서 켰을 때 묻어오는 세션 변수와, 구독 대신 API 키로 돌게 만드는 변수는 뺀다 */
const KEEP = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH']);
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    const u = k.toUpperCase();
    if ((u.startsWith('CLAUDE') && !KEEP.has(u)) || /^ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)$/.test(u)) delete env[k];
  }
  return env;
}

function launch(bin, args, cwd) {
  const opts = { cwd, env: cleanEnv(), windowsHide: true };
  // npm 설치본(cli.js)이나 테스트용 가짜는 node로 돌린다
  return /\.(c|m)?js$/i.test(bin) ? spawn(process.execPath, [bin, ...args], opts) : spawn(bin, args, opts);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* 아래 kill로 */ }
  }
  try { child.kill(); } catch { /* 이미 끝남 */ }
}

/** 잠깐 띄워 출력만 받는다 (버전 확인·로그인 상태·모델 목록) */
function runOnce(bin, args, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    let child;
    try { child = launch(bin, args, os.tmpdir()); } catch (e) { resolve({ code: -1, out: '', err: e.message }); return; }
    let out = ''; let err = '';
    const timer = setTimeout(() => killTree(child), timeoutMs);
    child.stdout?.setEncoding('utf8').on('data', (c) => { out += c; });
    child.stderr?.setEncoding('utf8').on('data', (c) => { err += c; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: '', err: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const clean = err.split('\n').map((l) => l.trim()).filter((l) => l && !/^WARNING:|^\d{4}-\d\d-\d\dT/.test(l)).join(' ');
      resolve({ code, out, err: clean });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });
}

// ── 백엔드 상태 (켤 때 한 번, /health?refresh=1 로 다시) ───────────────
const state = { claude: null, codex: null, checkedAt: 0 };

async function refreshBackends() {
  const c = findClaudeCode();
  const claude = { found: !!c, from: c?.from ?? null, version: null, error: null };
  if (c) {
    const r = await runOnce(c.bin, ['--version'], 15_000);
    const v = r.out.trim().split('\n')[0]?.trim();
    if (r.code === 0 && v) claude.version = v.replace(/\s*\(Claude Code\)\s*$/i, '');
    else claude.error = r.err || `종료 코드 ${r.code}`;
  }
  const x = findCodex();
  const codex = { found: !!x, from: x?.from ?? null, loggedIn: null, models: [], error: null };
  if (x) {
    // `codex login status`는 로그인이 안 됐으면 종료 코드 1과 "Not logged in". exec는 로그인 없이도 401로
    // 수십 초 재시도하다 실패하므로, 부르기 전에 이것으로 먼저 거른다.
    const s = await runOnce(x.bin, ['login', 'status']);
    const detail = `${s.out} ${s.err}`.trim();
    codex.loggedIn = s.code === 0 && !/not logged in/i.test(detail);
    if (!codex.loggedIn) codex.error = detail || `종료 코드 ${s.code}`;
    const m = await runOnce(x.bin, ['debug', 'models']);
    try {
      const body = JSON.parse(m.out.slice(m.out.indexOf('{')));
      codex.models = (body.models || []).filter((mm) => mm.slug && mm.visibility !== 'hide').map((mm) => mm.slug);
    } catch { codex.models = []; }
  }
  state.claude = { ...claude, bin: c?.bin ?? null };
  state.codex = { ...codex, bin: x?.bin ?? null };
  state.checkedAt = Date.now();
}

const publicBackends = () => ({
  'claude-code': state.claude ? { found: state.claude.found, from: state.claude.from, version: state.claude.version, error: state.claude.error } : null,
  codex: state.codex ? { found: state.codex.found, from: state.codex.from, loggedIn: state.codex.loggedIn, error: state.codex.error } : null,
});

function modelList() {
  const data = [];
  if (state.claude?.found) {
    data.push({ id: 'claude-code', label: 'Claude Code (기본 모델)', backend: 'claude-code' });
    for (const m of ['opus', 'sonnet']) data.push({ id: `claude-code:${m}`, label: `Claude Code · ${m}`, backend: 'claude-code' });
  }
  if (state.codex?.found) {
    data.push({ id: 'codex', label: 'Codex (기본 모델)', backend: 'codex' });
    for (const m of state.codex.models) data.push({ id: `codex:${m}`, label: `Codex · ${m}`, backend: 'codex' });
  }
  return data.map((d) => ({ object: 'model', owned_by: d.backend, ...d }));
}

// ── 메시지 평탄화 ─────────────────────────────────────────────────────
// Claude Code는 messages 배열이 아니라 프롬프트 하나를 받는다. system은 파일로, 나머지는 하나의 본문으로.
function flatten(messages) {
  const sys = []; const rest = [];
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n') : String(m.content ?? '');
    if (m.role === 'system') sys.push(content);
    else rest.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  const system = sys.join('\n\n');
  if (rest.length === 0) return { system, prompt: '(위 지시에 따라 답하라.)' };
  if (rest.length === 1 && rest[0].role === 'user') return { system, prompt: rest[0].content };
  const body = rest.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n\n');
  return { system, prompt: `${body}\n\n(위는 지금까지의 대화다. 마지막 user에게 assistant로서 답하라 — 답만 쓴다.)` };
}

function parseModel(id) {
  const s = String(id || 'claude-code').trim();
  const i = s.indexOf(':');
  const backend = i < 0 ? s : s.slice(0, i);
  const model = i < 0 ? '' : s.slice(i + 1).trim();
  if (backend !== 'claude-code' && backend !== 'codex') return null;
  return { backend, model };
}

// ── 오류 문구 ─────────────────────────────────────────────────────────
const clip = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);
function claudeErrorText(result, stderr) {
  const raw = String(result?.result ?? result?.error ?? '').trim()
    || stderr.trim().split('\n').slice(-3).join(' ').trim() || '내용 없음';
  if (/not logged in|\/login|invalid api key|oauth|authenticat/i.test(raw)) {
    return `Claude Code에 로그인되어 있지 않아요. 이 PC의 터미널이나 VS Code에서 Claude Code에 한 번 로그인해 주세요. (${clip(raw)})`;
  }
  if (/limit/i.test(raw) && /reach|exceed|hit|resets/i.test(raw)) {
    return `구독 사용 한도에 걸렸어요. 한도가 다시 찰 때까지 기다리거나 생성 모델을 보조 모델로 돌려 주세요. (${clip(raw)})`;
  }
  if (result?.api_error_status === 529 || /overloaded/i.test(raw)) return 'Anthropic 서버가 바빠요. 잠시 뒤에 다시 해 주세요.';
  if (/model/i.test(raw) && /not (found|available|supported)|invalid|unknown/i.test(raw)) {
    return `Claude Code가 이 모델을 쓸 수 없대요. 다른 모델을 골라 주세요. (${clip(raw)})`;
  }
  return `Claude Code 오류: ${clip(raw, 300)}`;
}

// ── 백엔드 호출 ───────────────────────────────────────────────────────
/** @returns {Promise<{text, model, usage, stop}>}  onText는 스트리밍 조각 */
function runClaude({ system, prompt, model, onText, signal }) {
  const bin = state.claude?.bin;
  if (!bin) return Promise.reject(new BridgeError(503, '이 PC에서 Claude Code를 찾지 못했어요. VS Code 확장이나 CLI를 설치하고 로그인해 주세요.'));
  fs.mkdirSync(WORK, { recursive: true });
  const sysFile = path.join(WORK, `system-${randomBytes(6).toString('hex')}.md`);
  fs.writeFileSync(sysFile, system || '', 'utf8');
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands',
    '--system-prompt-file', sysFile,
  ];
  if (model) args.push('--model', model);
  return new Promise((resolve, reject) => {
    const child = launch(bin, args, WORK);
    let settled = false; let got = ''; let result = null; let stderr = ''; let buf = ''; let usedModel = '';
    const finish = (fn) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fs.rm(sysFile, { force: true }, () => {});
      fn();
    };
    const timer = setTimeout(() => { killTree(child); finish(() => reject(new BridgeError(504, 'Claude Code 응답이 10분 안에 오지 않았어요'))); }, REQUEST_TIMEOUT_MS);
    const onAbort = () => { killTree(child); finish(() => reject(new BridgeError(499, '중지됨'))); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const handle = (line) => {
      if (!line.trim()) return;
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'system' && ev.subtype === 'init' && typeof ev.model === 'string') usedModel = ev.model;
      else if (ev.type === 'stream_event') {
        const e = ev.event;
        if (e?.type === 'message_start' && e.message?.model) usedModel = e.message.model;
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') { got += e.delta.text; onText?.(e.delta.text); }
      } else if (ev.type === 'result') result = ev;
    };
    child.stdout?.setEncoding('utf8').on('data', (chunk) => {
      buf += chunk; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    });
    child.stderr?.setEncoding('utf8').on('data', (c) => { stderr = (stderr + c).slice(-8000); });
    child.on('error', (e) => finish(() => reject(new BridgeError(500, `Claude Code를 실행하지 못했어요: ${e.message}`))));
    child.on('close', (code) => {
      handle(buf);
      finish(() => {
        if (!result) { reject(new BridgeError(502, `Claude Code가 답 없이 끝났어요 (종료 코드 ${code}). ${clip(stderr.trim().split('\n').slice(-3).join(' '), 300)}`)); return; }
        if (result.is_error || /^error/.test(result.subtype ?? '')) { reject(new BridgeError(502, claudeErrorText(result, stderr))); return; }
        const text = typeof result.result === 'string' && result.result ? result.result : got;
        const u = result.usage ?? {};
        resolve({
          text, model: usedModel || model || 'claude-code',
          usage: { prompt_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), completion_tokens: u.output_tokens ?? 0 },
          stop: String(result.stop_reason ?? 'end_turn'),
        });
      });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(prompt);
  });
}

function runCodex({ system, prompt, model, signal }) {
  const bin = state.codex?.bin;
  if (!bin) return Promise.reject(new BridgeError(503, '이 PC에서 Codex를 찾지 못했어요. codex CLI를 설치하고 codex login을 해 주세요.'));
  if (state.codex.loggedIn === false) return Promise.reject(new BridgeError(502, `Codex에 로그인되어 있지 않아요. 터미널에서 codex login을 한 번 실행해 주세요. (${clip(state.codex.error || '')})`));
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'simcore-cli-codex-'));
  const work = path.join(base, 'work'); const answerFile = path.join(base, 'answer.md');
  fs.mkdirSync(work);
  return new Promise((resolve, reject) => {
    const args = ['exec', '--json', '--color', 'never', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '-C', work, '-o', answerFile];
    if (model) args.push('-m', model);
    args.push('-'); // 지시문은 표준 입력으로
    const child = launch(bin, args, work);
    let lastMessage = ''; let failure = ''; let lastError = ''; let err = ''; let settled = false; let buf = '';
    const cleanup = () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* close 때 다시 */ } };
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); cleanup(); fn(); };
    const timer = setTimeout(() => { killTree(child); finish(() => reject(new BridgeError(504, 'Codex 응답이 10분 안에 오지 않았어요'))); }, REQUEST_TIMEOUT_MS);
    const onAbort = () => { killTree(child); finish(() => reject(new BridgeError(499, '중지됨'))); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const handle = (line) => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') lastMessage = ev.item.text || '';
      else if (ev.type === 'turn.failed') failure = ev.error?.message || '실패';
      else if (ev.type === 'error') lastError = ev.message || '';
    };
    child.stdout?.setEncoding('utf8').on('data', (chunk) => {
      buf += chunk; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    });
    child.stderr?.setEncoding('utf8').on('data', (c) => { err = (err + c).slice(-8000); });
    child.on('error', (e) => finish(() => reject(new BridgeError(500, `Codex를 실행하지 못했어요: ${e.message}`))));
    child.on('close', (code) => {
      if (buf) handle(buf);
      if (settled) { cleanup(); return; }
      let text = lastMessage;
      try { if (fs.existsSync(answerFile)) text = fs.readFileSync(answerFile, 'utf8') || text; } catch { /* 진행 기록의 답을 쓴다 */ }
      if (!failure && text.trim()) { finish(() => resolve({ text: text.trim(), model: model || 'codex', usage: null, stop: 'end_turn' })); return; }
      const stderr = err.split('\n').map((l) => l.trim()).filter((l) => l && !/^WARNING:/.test(l)).slice(-3).join(' ');
      const detail = failure || lastError || stderr || '내용 없음';
      if (/401|unauthorized|not logged in/i.test(detail)) { finish(() => reject(new BridgeError(502, `Codex에 로그인되어 있지 않아요. 터미널에서 codex login을 한 번 실행해 주세요. (${clip(detail)})`))); return; }
      finish(() => reject(new BridgeError(502, `Codex 오류 (종료 코드 ${code}): ${clip(detail, 300)}`)));
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(system ? `${system}\n\n---\n\n${prompt}` : prompt);
  });
}

class BridgeError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ── HTTP ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new BridgeError(413, '본문이 너무 커요 (8MB)')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const now = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(`[${now()}]`, ...a);

async function handleChat(req, res) {
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) { throw e instanceof BridgeError ? e : new BridgeError(400, 'JSON 본문이 아니에요'); }
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length) throw new BridgeError(400, 'messages 배열이 필요해요');
  const pm = parseModel(body.model);
  if (!pm) throw new BridgeError(404, `모르는 모델이에요: ${clip(String(body.model))} — claude-code, claude-code:opus, codex, codex:<모델> 중 하나`);
  const { system, prompt } = flatten(messages);
  const stream = body.stream === true;
  const id = `chatcmpl-${randomBytes(8).toString('hex')}`;
  const started = Date.now();
  const ac = new AbortController();
  req.on('close', () => { if (!res.writableEnded) ac.abort(); });

  if (stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...CORS });
    const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    const chunk = (delta, finish = null) => ({ id, object: 'chat.completion.chunk', created: Math.floor(started / 1000), model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] });
    send(chunk({ role: 'assistant', content: '' }));
    try {
      const r = pm.backend === 'codex'
        ? await runCodex({ system, prompt, model: pm.model, signal: ac.signal })
        : await runClaude({ system, prompt, model: pm.model, signal: ac.signal, onText: (t) => send(chunk({ content: t })) });
      if (pm.backend === 'codex') send(chunk({ content: r.text })); // codex는 끝에 한 덩어리
      send({ ...chunk({}, 'stop'), usage: r.usage ?? undefined });
      if (!res.writableEnded) res.write('data: [DONE]\n\n');
      log(`${pm.backend}${pm.model ? ':' + pm.model : ''} stream ${Date.now() - started}ms`, r.usage ? `in=${r.usage.prompt_tokens} out=${r.usage.completion_tokens}` : '');
    } catch (e) {
      // 스트림은 머리를 이미 보냈다 — 오류를 본문에 실어 보내고 닫는다 (OpenAI 클라이언트들이 읽는 모양)
      send({ error: { message: e.message, type: 'bridge_error', code: e.status ?? 500 } });
      log(`${pm.backend} stream 실패 ${Date.now() - started}ms: ${e.message}`);
    }
    res.end();
    return;
  }
  const r = pm.backend === 'codex'
    ? await runCodex({ system, prompt, model: pm.model, signal: ac.signal })
    : await runClaude({ system, prompt, model: pm.model, signal: ac.signal });
  log(`${pm.backend}${pm.model ? ':' + pm.model : ''} ${Date.now() - started}ms`, r.usage ? `in=${r.usage.prompt_tokens} out=${r.usage.completion_tokens}` : '');
  json(res, 200, {
    id, object: 'chat.completion', created: Math.floor(started / 1000), model: r.model,
    choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: r.stop === 'max_tokens' ? 'length' : 'stop' }],
    usage: r.usage ? { ...r.usage, total_tokens: r.usage.prompt_tokens + r.usage.completion_tokens } : undefined,
    simcore_bridge: { backend: pm.backend, ms: Date.now() - started },
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      if (url.searchParams.get('refresh') === '1' || !state.checkedAt) await refreshBackends();
      json(res, 200, { ok: true, name: 'simcore-cli-bridge', version: VERSION, node: process.version, backends: publicBackends(), models: modelList() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') { json(res, 200, { object: 'list', data: modelList() }); return; }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') { await handleChat(req, res); return; }
    json(res, 404, { error: { message: `없는 경로: ${req.method} ${url.pathname}`, type: 'not_found' } });
  } catch (e) {
    const status = e instanceof BridgeError ? e.status : 500;
    if (!res.headersSent) json(res, status === 499 ? 499 : status, { error: { message: e.message, type: 'bridge_error', code: status } });
    else res.end();
    if (status !== 499) log(`오류 ${status}: ${e.message}`);
  }
});

if (require.main === module) {
  refreshBackends().then(() => {
    server.listen(PORT, HOST, () => {
      const addr = server.address();
      const base = `http://${HOST}:${addr.port}`;
      console.log(`simcore-cli-bridge v${VERSION}  →  ${base}   (이 창을 닫으면 꺼져요)`);
      const c = state.claude; const x = state.codex;
      console.log(`  Claude Code: ${c.found ? `${c.version || '버전 확인 실패'} (${c.from})${c.error ? ' ⚠ ' + c.error : ''}` : '없음'}`);
      console.log(`  Codex:       ${x.found ? `${x.loggedIn ? '로그인됨' : '로그인 안 됨'} (${x.from})${x.models.length ? ' · 모델 ' + x.models.length + '종' : ''}` : '없음'}`);
      console.log(`  SimCore 편집기 → 생성 모델 → [이 PC의 Claude Code · Codex] → 주소 ${base} → [🔌 연결 확인]`);
      console.log(`LISTENING ${base}`);
    });
    server.on('error', (e) => { console.error(`포트 ${PORT}를 못 열었어요: ${e.message}`); process.exit(1); });
  });
}

module.exports = { flatten, parseModel, findClaudeCode, findCodex, claudeErrorText, server, refreshBackends, modelList };
