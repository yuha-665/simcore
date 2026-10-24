// 가짜 Codex — test-clibridge.js용. login status / debug models / exec --json 세 가지만 흉내 낸다.
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'login' && args[1] === 'status') {
  if (process.env.FAKE_CODEX_LOGGED_OUT) { process.stderr.write('Not logged in\n'); process.exit(1); }
  process.stdout.write('Logged in using ChatGPT\n'); process.exit(0);
}
if (args[0] === 'debug' && args[1] === 'models') {
  process.stdout.write('WARNING: debug output\n{"models":[{"slug":"gpt-5-codex","visibility":"show"},{"slug":"secret-model","visibility":"hide"}]}\n');
  process.exit(0);
}
if (args[0] === 'exec') {
  const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => {
    const echo = { json: args.includes('--json'), ephemeral: args.includes('--ephemeral'), sandbox: at('--sandbox'),
      skipGit: args.includes('--skip-git-repo-check'), cwd: at('-C'), model: at('-m') ?? null, stdinDash: args[args.length - 1] === '-', input };
    const text = 'codex-echo:' + JSON.stringify(echo);
    if (/FAIL_TURN/.test(input)) { process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: '401 unauthorized' } }) + '\n'); process.exit(1); }
    const outFile = at('-o');
    if (outFile) fs.writeFileSync(outFile, text, 'utf8');
    process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\n');
    process.exit(0);
  });
}
