// 챕터요약-onOutput.lua 기능 실측 5케이스. wasmoon 필요: npm i --no-save wasmoon 후 node 모듈/test-챕터요약.js
// (정규 스위프 대상 아님 — 테스트/ 밖에 두는 이유. wasmoon이 없으면 조용히 스킵한다)
// ⚠ 실측된 함정: 엔트리 스크립트가 E: 드라이브면 wasmoon WASM이 Aborted로 죽는다 (C: 엔트리 +
//   E: node_modules는 정상. 샌드박스 무관, 원인 불명). 그래서 시스템 임시폴더로 자기 복제 후 재실행한다.
const path = require('path'), os = require('os'), cp = require('child_process');
if (path.parse(__filename).root.toLowerCase() !== path.parse(os.tmpdir()).root.toLowerCase()) {
  const self = path.join(os.tmpdir(), 'test-chsum-relocated.js');
  require('fs').copyFileSync(__filename, self);
  const r = cp.spawnSync(process.execPath, [self], { stdio: 'inherit', env: { ...process.env, CHSUM_LUA: path.resolve(__dirname, '챕터요약-onOutput.lua'), CHSUM_NM: path.resolve(__dirname, '..', 'node_modules') } });
  process.exit(r.status ?? 1);
}
let LuaFactory;
try { ({ LuaFactory } = require(require('path').join(process.env.CHSUM_NM, 'wasmoon'))); }
catch { console.log('wasmoon 없음 — 스킵 (리포에서 npm i --no-save wasmoon)'); process.exit(0); }
const fs = require('fs');
(async () => {
  const lua = await (new LuaFactory()).createEngine();
  const script = fs.readFileSync(process.env.CHSUM_LUA, 'utf8');
  await lua.doString(`
    SET = nil; LOGS = {}
    function async(f) return f end
    function log(s) table.insert(LOGS, s) end
    function getFullChat(id) return CHAT end
    function axLLM(id, p) AX_PROMPT = p; return { success = true, result = AX_RESULT } end
    function setChat(id, idx, v) SET = { idx = idx, v = v } end
  `);
  await lua.doString(script);
  const run = async (setup) => {
    await lua.doString('SET = nil; LOGS = {}\nfunction getFullChat(id) return CHAT end\n' + setup);
    await lua.global.get('onOutput')(1);
    return { set: lua.global.get('SET'), logs: lua.global.get('LOGS') };
  };
  const TS = '\u23F1\uFE0F';   // ⏱️
  const MK = '\u2B25';          // ⬥

  // ① 이어 쓰기: 직전 요약 Ep2-Ch7 → Ch8, 새 본문의 "마지막" 타임스탬프 사용
  let r = await run(`
CHAT = {
  { role = 'user', data = '가자' },
  { role = 'char', data = [=[
옛 본문 ${TS}[1499-03-02 (Tue) 08:00 AM] 장면

${MK} Episode 2 - Current Chapter 7 | ${TS}[1499-03-02 (Tue) 10:00 AM]: Old events here.]=] },
  { role = 'user', data = '다음' },
  { role = 'char', data = '새 응답 ${TS}[1499-03-03 (Wed) 09:00 AM] 아침 ${TS}[1499-03-03 (Wed) 09:00 PM] 밤 끝' },
}
AX_RESULT = [=[
EVENTS: She rode north. The bridge held.
NOTES: none]=]
`);
  console.log('① idx=' + (r.set && r.set.idx));
  console.log('   ' + (r.set ? r.set.v.split('\n').slice(-1)[0] : '❗ 스킵'));

  // ② 첫 요약 (직전 없음, 타임스탬프 없음 → ----) + NOTES 실림
  r = await run(`
CHAT = {
  { role = 'user', data = '시작' },
  { role = 'char', data = '첫 응답, 타임스탬프 없음' },
}
AX_RESULT = [=[
EVENTS: They arrived at the keep.
NOTES: found the old map, promised to pay 200 gold]=]
`);
  console.log('② ' + (r.set ? r.set.v.split('\n').slice(-2).join('\n   ') : '❗ 스킵'));

  // ③ NOTES 줄이 아예 없는 보조 응답 (형식 관용)
  r = await run(`
CHAT = { { role = 'char', data = '본문뿐' } }
AX_RESULT = 'EVENTS: A single line only.'
`);
  console.log('③ ' + (r.set ? r.set.v.split('\n').slice(-1)[0] : '❗ 스킵됨'));

  // ④ 리롤 가드: 쓰기 직전 본문이 달라짐 → 버려야 한다
  r = await run(`
STEP = 0
function getFullChat(id)
  STEP = STEP + 1
  if STEP == 1 then return { { role = 'char', data = '원래 본문' } } end
  return { { role = 'char', data = '리롤로 바뀐 본문' } }
end
AX_RESULT = [=[
EVENTS: X.
NOTES: none]=]
`);
  console.log('④ SET=' + (r.set == null ? 'nil (가드 작동 ✓)' : '❗ 썼다'));

  // ⑤ 심코어 마커가 보조 호출 중 끼어든 경우 → 마커 보존 + 요약은 그 뒤에
  r = await run(`
STEP = 0
function getFullChat(id)
  STEP = STEP + 1
  if STEP == 1 then return { { role = 'char', data = '본문입니다' } } end
  return { { role = 'char', data = [=[
본문입니다

\u{27E6}simcore:4\u{27E7}]=] } }
end
AX_RESULT = [=[
EVENTS: Y.
NOTES: none]=]
`);
  const ok5 = r.set && r.set.v.includes('simcore:4') && r.set.v.indexOf('simcore') < r.set.v.indexOf('Episode');
  console.log('⑤ ' + (ok5 ? '마커 보존 + 요약 뒤에 ✓' : '❗ ' + (r.set ? JSON.stringify(r.set.v) : '스킵')));

  // lua.global.close()는 노드 종료 시 libuv 단언(UV_HANDLE_CLOSING)을 유발할 수 있다 — 즉시 종료로 회피
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
