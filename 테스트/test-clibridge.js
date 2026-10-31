const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.15.0 — 이 PC의 Claude Code · Codex로 편집기 생성 (tools/cli-bridge + 어댑터 cli 경로).
//
// 다리를 가짜 실행 파일(_fake-claude.js · _fake-codex.js)로 띄워 진짜 구독 할당량 없이 본다:
//   ① 다리: /health · /v1/models · 채팅(격리 플래그·시스템 파일·평탄화·환경 정리) · 스트리밍 · 오류 문구 · CORS · Codex
//   ② 플러그인: 번들에서 생성 모델 절을 잘라 가짜 Risuai(nativeFetch = 진짜 fetch)로 callGenLLM을 다리에 실제로 꽂는다
//   ③ 편집기 배선: 선택지·연결 확인·모델 고르기·라벨이 소스에 있는가
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const http = require('http');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const BRIDGE = __P('../tools/cli-bridge/simcore-cli-bridge.js');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// cli-bridge.bat — 유저 실기(2026-10-31): LF + 한글이면 cmd.exe가 줄을 잘못 읽어 '?리'를 명령으로 실행하고 pause 전에 죽는다.
// 더블클릭하면 창만 깜빡이고 다리는 안 켜진다. 아래 startBridge는 js를 직접 띄워서 이 길을 못 본다 — 그래서 실제 cmd.exe로 읽힌다
{
  const bat = fs.readFileSync(__P('../tools/cli-bridge/cli-bridge.bat'));
  ck('★ cli-bridge.bat은 ASCII뿐', bat.every((b) => b < 0x80), '');
  ck('★ cli-bridge.bat은 CRLF', !/(^|[^\r])\n/.test(bat.toString('latin1')), '');
  ck('.gitattributes가 배치를 CRLF로 고정', /^\*\.bat\s+text\s+eol=crlf/m.test(fs.readFileSync(__P('../.gitattributes'), 'utf8')), '');
  if (process.platform === 'win32') {
    const tmp = path.join(os.tmpdir(), `simcore-bat-${process.pid}.bat`);
    fs.writeFileSync(tmp, bat.toString('latin1').replace('node simcore-cli-bridge.js', 'echo REACHED-END'), 'latin1');
    const r = spawnSync('cmd.exe', ['/c', `"${tmp}"`], { encoding: 'latin1', windowsHide: true, windowsVerbatimArguments: true });
    fs.unlinkSync(tmp);
    ck('★ 실제 cmd.exe가 마지막 줄까지 읽는다', r.status === 0 && r.stdout.includes('REACHED-END'), `${r.status} ${r.stdout}${r.stderr}`.slice(0, 200));

    // 배포판 — 옛 파일이 다시 나가면 위 사고가 그대로 되풀이된다. zip은 gitignore라 만들어 둔 PC에서만 본다
    const zip = __P('../배포/SimCore-bridge.zip');
    if (fs.existsSync(zip)) {
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      const inZip = (f) => spawnSync(tar, ['-xOf', zip, `SimCore-bridge/${f}`], { maxBuffer: 1 << 24 }).stdout;
      ck('★ 배포 zip의 파일이 소스와 같다 (다르면 node tools/cli-bridge/pack.js)', ['cli-bridge.bat', 'simcore-cli-bridge.js'].every((f) => Buffer.compare(inZip(f) || Buffer.alloc(0), fs.readFileSync(__P('../tools/cli-bridge', f))) === 0), '');
      const usage = (inZip('README.txt') || Buffer.alloc(0)).toString('utf8');
      ck('배포 zip에 사용법 — 메모장용 BOM + CRLF', usage.startsWith('\ufeff') && usage.includes('쓰는 법') && !/(^|[^\r])\n/.test(usage), usage.slice(0, 40));
    }
  }
}

function startBridge(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, SIMCORE_CLI_PORT: '0', SIMCORE_CLI_CLAUDE_BIN: __P('_fake-claude.js'), SIMCORE_CLI_CODEX_BIN: __P('_fake-codex.js'), ...extraEnv },
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('다리가 15초 안에 안 떴다: ' + out)); }, 15000);
    child.stdout.setEncoding('utf8').on('data', (c) => {
      out += c;
      const m = out.match(/LISTENING (http:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); resolve({ child, base: m[1], out: () => out }); }
    });
    child.stderr.setEncoding('utf8').on('data', (c) => { out += c; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`다리가 바로 꺼졌다 (code ${code}): ${out}`)); });
  });
}
const getJ = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.json(), headers: r.headers }; };
const postJ = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { } return { status: r.status, body: j, text: t }; };
const echoOf = (text) => JSON.parse(String(text).replace(/^echo:/, ''));
// 브라우저처럼 Origin·Host를 직접 싣는다 (fetch는 Host를 못 바꾼다)
const rawReq = (base, method, p, headers, body) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const data = body ? JSON.stringify(body) : undefined;
  const req = http.request({ host: u.hostname, port: u.port, method, path: p, headers: { ...headers, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let text = '';
    res.setEncoding('utf8').on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, acao: res.headers['access-control-allow-origin'] ?? null, text }));
  });
  req.on('error', reject);
  req.end(data);
});

(async () => {
  const br = await startBridge();
  const B = br.base;
  try {
    console.log('── ① 다리');
    {
      const h = await getJ(B + '/health');
      ck('/health ok', h.status === 200 && h.body.ok === true && h.body.name === 'simcore-cli-bridge', JSON.stringify(h.body).slice(0, 120));
      ck('Claude Code 찾음 + 버전', h.body.backends['claude-code'].found && h.body.backends['claude-code'].version === '9.9.9', JSON.stringify(h.body.backends));
      ck('Codex 찾음 + 로그인됨', h.body.backends.codex.found && h.body.backends.codex.loggedIn === true, JSON.stringify(h.body.backends.codex));
      ck('실행 파일 경로는 바깥에 안 낸다', !JSON.stringify(h.body).includes('_fake-claude.js'), '');
      ck('Origin 없는 호출엔 CORS 허용 헤더를 안 붙인다', h.headers.get('access-control-allow-origin') === null, h.headers.get('access-control-allow-origin'));
      const m = await getJ(B + '/v1/models');
      const ids = m.body.data.map((x) => x.id);
      ck('모델 목록: claude-code 기본 + opus/sonnet + codex 기본 + 보이는 codex 모델', ['claude-code', 'claude-code:opus', 'claude-code:sonnet', 'codex', 'codex:gpt-5-codex'].every((id) => ids.includes(id)), ids.join(','));
      ck('숨긴 codex 모델은 목록에 없다', !ids.includes('codex:secret-model'), '');
      const pre = await fetch(B + '/v1/chat/completions', { method: 'OPTIONS' });
      ck('프리플라이트 204 + 메서드 헤더', pre.status === 204 && /POST/.test(pre.headers.get('access-control-allow-methods') || ''), String(pre.status));
    }
    {
      // 유저 PC 실측(2026-10-31): 허용 헤더가 *이고 호출자 검사가 없어 아무 사이트나 다리를 불렀고, Codex는 디스크의 미끼 파일을 읽어 돌려줬다
      const post = (headers, base = B) => rawReq(base, 'POST', '/v1/chat/completions', headers, { model: 'claude-code', messages: [{ role: 'user', content: 'hi' }] });
      for (const origin of ['https://evil.example', 'null', 'https://risuai.xyz.evil.example', 'https://evil-risuai.xyz', 'http://risuai.xyz', 'http://localhost.evil.example']) {
        const r = await post({ Origin: origin });
        ck(`★ ${origin} → 403, 허용 헤더 없음`, r.status === 403 && r.acao === null, `${r.status} ${r.acao}`);
      }
      const pf = await rawReq(B, 'OPTIONS', '/v1/chat/completions', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' });
      ck('★ 낯선 사이트의 프리플라이트도 거절', pf.status === 403 && pf.acao === null, `${pf.status} ${pf.acao}`);
      const he = await rawReq(B, 'GET', '/health', { Origin: 'https://evil.example' });
      ck('★ 낯선 사이트는 /health도 못 읽는다', he.status === 403 && he.acao === null, `${he.status} ${he.acao}`);
      const reb = await rawReq(B, 'GET', '/health', { Host: 'evil.example:5181' });
      ck('★ DNS 리바인딩 — Host가 이 PC가 아니면 거절', reb.status === 403, String(reb.status));
      for (const origin of ['https://risuai.xyz', 'tauri://localhost', 'http://tauri.localhost', 'http://127.0.0.1:7777', 'http://localhost:6001']) {
        const r = await post({ Origin: origin });
        ck(`${origin} → 200, 그 주소만 허용`, r.status === 200 && r.acao === origin, `${r.status} ${r.acao}`);
      }
      const plain = await post({});
      ck('Origin 없는 호출(데스크톱·셀프호스트 프록시) → 200', plain.status === 200 && plain.acao === null, `${plain.status} ${plain.acao}`);
      const extra = await startBridge({ SIMCORE_CLI_ORIGINS: 'https://my-risu.example, https://other.example' });
      try {
        const ok = await post({ Origin: 'https://other.example' }, extra.base);
        ck('SIMCORE_CLI_ORIGINS로 주소를 더한다', ok.status === 200 && ok.acao === 'https://other.example', `${ok.status} ${ok.acao}`);
        const no = await post({ Origin: 'https://evil.example' }, extra.base);
        ck('더한 주소 말고는 그대로 거절', no.status === 403, String(no.status));
      } finally { extra.child.kill(); }
    }
    {
      const r = await postJ(B + '/v1/chat/completions', { model: 'claude-code', messages: [{ role: 'system', content: '너는 심코어 어시스턴트다' }, { role: 'user', content: '위 지시에 따라 답하라.' }] });
      ck('채팅 200 + OpenAI 모양', r.status === 200 && r.body.object === 'chat.completion' && typeof r.body.choices[0].message.content === 'string', r.text.slice(0, 160));
      const e = echoOf(r.body.choices[0].message.content);
      ck('-p + stream-json + 부분 메시지', e.print && e.streamJson && e.partial, JSON.stringify(e).slice(0, 120));
      ck('격리 플래그 다섯: tools "" · setting-sources "" · strict-mcp · no-session · no-slash', e.tools === '' && e.settingSources === '' && e.strictMcp && e.noSession && e.noSlash, JSON.stringify([e.tools, e.settingSources, e.strictMcp, e.noSession, e.noSlash]));
      ck('system은 파일로 · 본문은 표준 입력으로', e.system === '너는 심코어 어시스턴트다' && e.prompt === '위 지시에 따라 답하라.', JSON.stringify([e.system, e.prompt]));
      ck('모델 미지정이면 --model 없음', e.model === null, String(e.model));
      ck('CLAUDE*·ANTHROPIC_* 환경변수를 자식에 안 넘긴다', e.leakedEnv.length === 0, e.leakedEnv.join(','));
      ck('빈 작업 폴더에서 띄운다 (리포가 아니다)', /simcore-cli-bridge/.test(e.cwd), e.cwd);
      ck('usage 환산: prompt = input + cache', r.body.usage.prompt_tokens === 15 && r.body.usage.completion_tokens === 20, JSON.stringify(r.body.usage));
      ck('응답 model = 실제 쓴 모델', r.body.model === 'claude-fake-default', r.body.model);
    }
    {
      const r = await postJ(B + '/v1/chat/completions', { model: 'claude-code:opus', messages: [
        { role: 'system', content: 'S' }, { role: 'user', content: '첫 질문' }, { role: 'assistant', content: '첫 답' }, { role: 'user', content: '둘째 질문' }] });
      const e = echoOf(r.body.choices[0].message.content);
      ck('claude-code:opus → --model opus', e.model === 'opus', String(e.model));
      ck('다턴은 <user>/<assistant> 태그로 평탄화 + 마지막 지시', /<user>\n첫 질문\n<\/user>/.test(e.prompt) && /<assistant>\n첫 답\n<\/assistant>/.test(e.prompt) && /<user>\n둘째 질문\n<\/user>/.test(e.prompt) && /마지막 user에게 assistant로서 답하라/.test(e.prompt), e.prompt.slice(0, 160));
      const r2 = await postJ(B + '/v1/chat/completions', { model: 'claude-code', messages: [{ role: 'system', content: 'A' }, { role: 'system', content: 'B' }, { role: 'user', content: 'q' }] });
      ck('system 여럿은 이어 붙여 한 파일', echoOf(r2.body.choices[0].message.content).system === 'A\n\nB', '');
    }
    {
      const r = await fetch(B + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: 'hi' }] }) });
      const t = await r.text();
      const events = t.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
      const deltas = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e)).map((o) => o.choices?.[0]?.delta?.content || '').join('');
      ck('스트리밍: SSE + 조각 합치면 전체 + [DONE]', r.headers.get('content-type').startsWith('text/event-stream') && /^echo:/.test(deltas) && events[events.length - 1] === '[DONE]', t.slice(0, 200));
      ck('스트리밍 마지막 조각 finish_reason=stop', events.slice(0, -1).map((e) => JSON.parse(e)).some((o) => o.choices?.[0]?.finish_reason === 'stop'), '');
    }
    {
      const login = await postJ(B + '/v1/chat/completions', { model: 'claude-code', messages: [{ role: 'user', content: 'FAIL_LOGIN' }] });
      ck('로그인 안 됨 → 502 + 한국어 안내', login.status === 502 && /로그인되어 있지 않아요/.test(login.body.error.message), login.text.slice(0, 160));
      const limit = await postJ(B + '/v1/chat/completions', { model: 'claude-code', messages: [{ role: 'user', content: 'FAIL_LIMIT' }] });
      ck('한도 → 사용 한도 안내', limit.status === 502 && /사용 한도/.test(limit.body.error.message), limit.text.slice(0, 160));
      const nores = await postJ(B + '/v1/chat/completions', { model: 'claude-code', messages: [{ role: 'user', content: 'FAIL_NORESULT' }] });
      ck('답 없이 끝남 → 종료 코드 + stderr 꼬리', nores.status === 502 && /종료 코드 3/.test(nores.body.error.message) && /boom/.test(nores.body.error.message), nores.text.slice(0, 160));
      const bad = await postJ(B + '/v1/chat/completions', { model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] });
      ck('모르는 모델 → 404', bad.status === 404 && /모르는 모델/.test(bad.body.error.message), bad.text.slice(0, 120));
      const empty = await postJ(B + '/v1/chat/completions', { model: 'claude-code' });
      ck('messages 없음 → 400', empty.status === 400, String(empty.status));
      const nf = await fetch(B + '/nope');
      ck('없는 경로 → 404', nf.status === 404, String(nf.status));
    }
    {
      const r = await postJ(B + '/v1/chat/completions', { model: 'codex:gpt-5-codex', messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'ask' }] });
      ck('Codex 채팅 200', r.status === 200 && /^codex-echo:/.test(r.body.choices[0].message.content), r.text.slice(0, 160));
      const e = JSON.parse(r.body.choices[0].message.content.replace(/^codex-echo:/, ''));
      ck('codex exec --json --ephemeral --sandbox read-only --skip-git-repo-check, 표준 입력', e.json && e.ephemeral && e.sandbox === 'read-only' && e.skipGit && e.stdinDash, JSON.stringify(e).slice(0, 160));
      ck('★ Codex 도구를 끈다 — 셸·코드 실행·앱·컴퓨터 사용 (샌드박스는 읽기를 안 막는다)', ['shell_tool', 'unified_exec', 'code_mode_host', 'apps', 'plugins', 'computer_use', 'browser_use', 'multi_agent'].every((f) => e.off.includes(f)), e.off.join(','));
      ck('★ Codex 사용자 설정·규칙을 안 읽고 웹 검색을 끈다', e.ignoreUserConfig && e.ignoreRules && e.webOff, JSON.stringify([e.ignoreUserConfig, e.ignoreRules, e.webOff]));
      const old = await postJ(B + '/v1/chat/completions', { model: 'codex', messages: [{ role: 'user', content: 'FAIL_OLD' }] });
      ck('옵션을 모르는 옛 Codex → 도구를 켠 채 돌지 않고 업데이트 안내', old.status === 502 && /업데이트/.test(old.body.error.message), old.text.slice(0, 160));
      ck('codex:<slug> → -m', e.model === 'gpt-5-codex', String(e.model));
      ck('지시문은 본문 앞에 --- 로', e.input === 'SYS\n\n---\n\nask', JSON.stringify(e.input));
      ck('빈 임시 폴더', /simcore-cli-codex-/.test(e.cwd), e.cwd);
      const f = await postJ(B + '/v1/chat/completions', { model: 'codex', messages: [{ role: 'user', content: 'FAIL_TURN' }] });
      ck('turn.failed 401 → 로그인 안내', f.status === 502 && /codex login/.test(f.body.error.message), f.text.slice(0, 160));
    }

    console.log('── ② 플러그인 cli 경로 (번들 절 추출 + 진짜 fetch)');
    {
      const a1 = src.indexOf("  const GEN_MODEL_KEY = 'sim:genmodel';");
      const a2 = src.indexOf('  // ── mentions 침묵 실패 감지', a1);
      ck('생성 모델 절 추출', a1 > 0 && a2 > a1, `${a1},${a2}`);
      const harness = `
const store = new Map();
const Risuai = {
  pluginStorage: { getItem: async (k) => (store.has(k) ? store.get(k) : null), setItem: async (k, v) => { store.set(k, v); } },
  nativeFetch: async (url, init) => {
    globalThis.__lastFetch = { url, init };
    if (!globalThis.__viaProxy) return fetch(url, init);
    // 셀프호스트·RisuBard의 /proxy2 흉내 — 서버가 대신 fetch하다 못 닿으면 예외가 아니라 500 {"error": err.message} (v1.20.2 실기)
    try { return await fetch(url, init); }
    catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
  },
  runLLMModel: async () => ({ type: 'success', result: 'from-risu-model' }),
};
const AUX_NUDGE = '위 지시에 따라 답하라.';
let lastAux = { status: '', raw: '', applied: 0 };
let auxCalls = 0;
async function callAuxLLM() { auxCalls++; return 'from-aux'; }
async function extractLLMText(res) { return res && res.result; }
${src.slice(a1, a2)}
module.exports = { getGenModel, setGenModel, callGenLLM, probeCli, _auxCalls: () => auxCalls, _store: store };
`;
      const out = path.join(__dirname, '_clibridge_gen.js');
      fs.writeFileSync(out, harness, 'utf8');
      const M = require(out);
      ck('기본 선택은 보조 + cli 기본값이 채워진다', JSON.stringify(await M.getGenModel()) === JSON.stringify({ choice: 'aux', staticId: '', cliUrl: 'http://127.0.0.1:5181', cliModel: 'claude-code' }), JSON.stringify(await M.getGenModel()));
      ck('cli 아닐 땐 보조로 (다리 안 부름)', (await M.callGenLLM('p')) === 'from-aux' && M._auxCalls() === 1 && !globalThis.__lastFetch, '');
      await M.setGenModel({ choice: 'cli', cliUrl: B + '/', cliModel: 'claude-code:sonnet' });
      const gm = await M.getGenModel();
      ck('cli 선택 저장·복원 (뒤 슬래시 포함 그대로)', gm.choice === 'cli' && gm.cliUrl === B + '/' && gm.cliModel === 'claude-code:sonnet', JSON.stringify(gm));
      const pr = await M.probeCli(B + '/');
      ck('probeCli: ok + 모델 목록 + 백엔드 (뒤 슬래시 정리)', pr.ok && pr.models.some((m) => m.id === 'claude-code:opus') && pr.backends['claude-code'].found && /\/health\?refresh=1$/.test(globalThis.__lastFetch.url) && !/\/\/health/.test(globalThis.__lastFetch.url), JSON.stringify(pr).slice(0, 160));
      const r1 = await M.callGenLLM('규격서를 만들어라');
      ck('단발 생성: 문자열로 돌아온다', typeof r1 === 'string' && /^echo:/.test(r1), JSON.stringify(r1).slice(0, 120));
      const e1 = echoOf(r1);
      ck('단발: 프롬프트가 system 파일로, 본문은 AUX_NUDGE', e1.system === '규격서를 만들어라' && e1.prompt === '위 지시에 따라 답하라.' && e1.model === 'sonnet', JSON.stringify([e1.system, e1.prompt, e1.model]));
      ck('POST JSON + 모델 id 그대로', globalThis.__lastFetch.init.method === 'POST' && JSON.parse(globalThis.__lastFetch.init.body).model === 'claude-code:sonnet' && JSON.parse(globalThis.__lastFetch.init.body).stream === false, globalThis.__lastFetch.init.body.slice(0, 120));
      const r2 = await M.callGenLLM({ system: 'SYS', messages: [{ role: 'user', content: 'q1' }, { role: 'ai', content: 'a1' }, { role: 'user', content: 'q2' }] });
      const e2 = echoOf(r2);
      ck('💬 대화: ai 역할이 assistant로, 다턴 평탄화', e2.system === 'SYS' && /<assistant>\na1\n<\/assistant>/.test(e2.prompt) && /<user>\nq2\n<\/user>/.test(e2.prompt), e2.prompt.slice(0, 160));
      ck('보조 경로는 안 불렸다', M._auxCalls() === 1, String(M._auxCalls()));
      const bad = await M.callGenLLM({ system: 'S', messages: [{ role: 'user', content: 'FAIL_LOGIN' }] });
      ck('다리의 오류 문구가 { error }로 편집기까지', bad && /로그인되어 있지 않아요/.test(bad.error) && /이 PC의 Claude Code·Codex/.test(bad.error), JSON.stringify(bad));
      await M.setGenModel({ choice: 'cli', cliUrl: 'http://127.0.0.1:1', cliModel: 'claude-code' });
      const down = await M.callGenLLM('p');
      ck('다리가 꺼져 있으면 켜라는 안내', down && /cli-bridge\.bat/.test(down.error), JSON.stringify(down));
      const pdown = await M.probeCli('http://127.0.0.1:1');
      ck('연결 확인도 같은 안내', pdown.error && /cli-bridge\.bat/.test(pdown.error), JSON.stringify(pdown));
      // 리수 서버가 대신 접속하는 환경 (v1.20.2 실기 — RisuBard에서 다리를 안 켠 채 확인하니 "다리가 이상한 답을 했어요 (HTTP 500): {"error":"fetch failed"}")
      globalThis.__viaProxy = true;
      const pp = await M.probeCli('http://127.0.0.1:1');
      ck('★ 프록시 환경 — 500 {"error":"fetch failed"}도 "닿지 못했어요" + 켜라는 안내 (다리를 의심하게 하던 "이상한 답" 아님)',
        pp.error && /닿지 못했어요/.test(pp.error) && /리수 서버가 대신 접속하다 실패/.test(pp.error) && /cli-bridge\.bat/.test(pp.error) && !/이상한 답/.test(pp.error), JSON.stringify(pp));
      const cp = await M.callGenLLM('p');
      ck('프록시 환경 — 생성 호출도 같은 안내', cp && /닿지 못했어요/.test(cp.error) && /리수 서버가 대신/.test(cp.error), JSON.stringify(cp));
      await M.setGenModel({ choice: 'cli', cliUrl: B + '/', cliModel: 'claude-code' });
      const okp = await M.probeCli(B + '/');
      ck('프록시 환경 — 켜진 다리는 그대로 ok', okp.ok === true, JSON.stringify(okp).slice(0, 120));
      const badp = await M.callGenLLM({ system: 'S', messages: [{ role: 'user', content: 'FAIL_LOGIN' }] });
      ck('다리 자신의 오류({error:{message}})는 못 닿음으로 오인하지 않는다', badp && /로그인되어 있지 않아요/.test(badp.error) && !/닿지 못했어요/.test(badp.error), JSON.stringify(badp));
      globalThis.__viaProxy = false;
      try { fs.unlinkSync(out); } catch { }
    }

    console.log('── ③ 편집기 배선 (소스)');
    {
      ck('생성 모델 선택지에 cli', src.includes("['cli', '이 PC의 Claude Code · Codex (구독)']"), '');
      ck('연결 확인 버튼 → ai.probeCli', src.includes("'🔌 연결 확인'") && src.includes('ai.probeCli(aiGenModel.cliUrl)'), '');
      ck('모델 고르기는 다리가 준 목록으로', src.includes('bindSelect(aiGenModel.cliModel, models.map((m) => [m.id, m.label || m.id])'), '');
      ck('저장에 cliUrl·cliModel 포함', src.includes('ai.setGenModel({ choice: aiGenModel.choice, staticId: aiGenModel.staticId, cliUrl: aiGenModel.cliUrl, cliModel: aiGenModel.cliModel })'), '');
      ck('어댑터 ai 객체에 probeCli', src.includes('probeCli: (url) => probeCli(url)'), '');
      // 창작 runAiGenerate · 💬 runChatSend · 🗂 runChatExtract(v1.16.0) — 셋
      ck('생성 라벨에 cli (세 곳)', (src.match(/aiGenModel\?\.choice === 'cli' \? '이 PC의 Claude Code·Codex'/g) || []).length === 3, String((src.match(/aiGenModel\?\.choice === 'cli' \? '이 PC의 Claude Code·Codex'/g) || []).length));
      ck('안내문: RP는 그대로 리수 모델', src.includes('RP 채팅은 그대로 리수 모델이에요'), '');
      ck('nativeFetch 없는 리수 → 안내', src.includes("이 리수 버전엔 nativeFetch가 없어요"), '');
      // 버전 핀은 test-bundle.js 한 곳에서만 — 여기선 v1.15.0 이상 + 체인지로그 항목만 (v1.15.1에서 핀이 깨졌다)
      ck('버전 1.15.0 이상 + 체인지로그', /\/\/@version (1\.(1[5-9]|[2-9]\d)\.\d+|[2-9]\.\d+\.\d+)/.test(src) && src.includes('// ── v1.15.0 ──'), '');
    }
  } finally {
    br.child.kill();
    await sleep(100);
  }
  console.log(`\n[test-clibridge] ${pass}/${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL 예외:', e.stack || e); process.exit(1); });
