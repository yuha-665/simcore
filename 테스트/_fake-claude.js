// 가짜 Claude Code — test-clibridge.js가 다리에 꽂는 실행 파일. 구독 할당량을 안 쓰고 다리의 배선만 본다.
// 받은 인자·시스템 파일·본문·환경을 "echo:" JSON으로 되돌려 준다. 본문에 든 낱말로 실패를 흉내 낸다.
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('9.9.9 (Claude Code)\n'); process.exit(0); }
const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const sysFile = at('--system-prompt-file');
  const system = sysFile && fs.existsSync(sysFile) ? fs.readFileSync(sysFile, 'utf8') : null;
  const KEEP = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH']);
  const leaked = Object.keys(process.env).filter((k) => (k.toUpperCase().startsWith('CLAUDE') && !KEEP.has(k.toUpperCase())) || /^ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)$/i.test(k));
  const echo = {
    print: args[0] === '-p', streamJson: at('--output-format') === 'stream-json', partial: args.includes('--include-partial-messages'),
    tools: at('--tools'), settingSources: at('--setting-sources'), strictMcp: args.includes('--strict-mcp-config'),
    noSession: args.includes('--no-session-persistence'), noSlash: args.includes('--disable-slash-commands'),
    model: at('--model') ?? null, system, prompt, leakedEnv: leaked, cwd: process.cwd(),
  };
  out({ type: 'system', subtype: 'init', model: at('--model') || 'claude-fake-default' });
  if (/FAIL_LOGIN/.test(prompt)) { out({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in. Please run /login' }); return; }
  if (/FAIL_LIMIT/.test(prompt)) { out({ type: 'result', subtype: 'error', is_error: true, result: "You've hit your limit · resets 3pm" }); return; }
  if (/FAIL_NORESULT/.test(prompt)) { process.stderr.write('boom\n'); process.exit(3); }
  const text = 'echo:' + JSON.stringify(echo);
  const half = Math.ceil(text.length / 2);
  const delay = /SLOW/.test(prompt) ? 1500 : 0;
  setTimeout(() => {
    out({ type: 'stream_event', event: { type: 'message_start', message: { model: at('--model') || 'claude-fake-default' } } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(0, half) } } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(half) } } });
    out({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.12 } } } });
    out({ type: 'result', subtype: 'success', is_error: false, result: text, stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 } });
  }, delay);
});
