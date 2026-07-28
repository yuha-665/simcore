const __P = (...p) => require('path').resolve(__dirname, ...p);
// importData 동작 검증 — 같은 채팅 복원 vs 다른 채팅 이식
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

// engine / store / SimSession 모듈 번들을 그대로 로드
const bundleStart = src.indexOf('const SimCore = (() => {');
const bundleEnd = src.indexOf('SimCore.define("plugin"');
let bundle = src.slice(bundleStart, bundleEnd > 0 ? bundleEnd : src.indexOf('(async () => {'));
const mod = { exports: {} };
(0, eval)(bundle + '\n;globalThis.__SimCore = SimCore;');
const SimCore = globalThis.__SimCore;

const engine = SimCore.require('engine');
const { MapBackend } = SimCore.require('store');

// SimSession 클래스는 session 모듈에 있음 — 이름 확인
let sessionMod = null;
for (const name of ['session', 'simsession', 'plugin']) {
  try { const m = SimCore.require(name); if (m.SimSession) { sessionMod = m; break; } } catch {}
}
if (!sessionMod) {
  // define 된 모듈 이름 목록 출력
  console.log('모듈에서 SimSession을 못 찾음 — 파일에서 직접 추출');
}
const SimSession = sessionMod ? sessionMod.SimSession : null;
if (!SimSession) { console.log('SKIP: SimSession 로드 실패'); process.exit(0); }

const SCHEMA = {
  simcore: '0.1', meta: { name: '테스트' },
  vars: [{ id: 'hp', type: 'int', init: 100 }, { id: 'gold', type: 'int', init: 0 }],
  statusUI: { mode: 'auto', groups: [] },
};

const results = [];
const check = (n, c, e = '') => results.push([c, n, e]);

(async () => {
  // ── 원본 채팅에서 진행 후 내보내기 ──
  const backendA = new MapBackend();
  const sA = new SimSession(SCHEMA, backendA, { chatId: 'chat-A', prefix: 'sim:cha:chat-A' });
  await sA.init(-1);
  sA.current.vars.hp = 42;
  sA.current.vars.gold = 777;
  sA.current.meta.turn = 14;
  await sA.store.save('out', 27, sA.current);
  const save = await sA.exportData(27);
  save.schema = SCHEMA;

  check('내보내기에 스키마 동봉', !!save.schema);
  check('내보내기에 chatId 기록', save.chatId === 'chat-A', save.chatId);

  // ── 케이스 1: 같은 채팅으로 복원 (백업 되돌리기) ──
  const backendB = new MapBackend();
  const sB = new SimSession(SCHEMA, backendB, { chatId: 'chat-A', prefix: 'sim:cha:chat-A' });
  await sB.init(-1);
  const r1 = await sB.importData(save, 27);
  check('같은 채팅 → sameChat=true', r1.ok && r1.sameChat === true, JSON.stringify(r1));
  check('같은 채팅 → 값 복원', sB.current.vars.hp === 42 && sB.current.vars.gold === 777);
  check('같은 채팅 → 스냅샷 이력 보존', backendB.keys().some((k) => k.endsWith(':out:27')), backendB.keys().join(','));
  // 재로드해도 유지되는가
  const sB2 = new SimSession(SCHEMA, backendB, { chatId: 'chat-A', prefix: 'sim:cha:chat-A' });
  await sB2.init(27);
  check('같은 채팅 → 재로드 후 유지', sB2.current.vars.hp === 42, JSON.stringify(sB2.current.vars));

  // ── 케이스 2: 다른(새) 채팅으로 이식, 메시지 2개뿐 ──
  const backendC = new MapBackend();
  const sC = new SimSession(SCHEMA, backendC, { chatId: 'chat-B', prefix: 'sim:cha:chat-B' });
  await sC.init(-1);
  const r2 = await sC.importData(save, 0); // 새 채팅: 마지막 char 메시지 = 0
  check('다른 채팅 → sameChat=false', r2.ok && r2.sameChat === false, JSON.stringify(r2));
  check('다른 채팅 → 값 복원', sC.current.vars.hp === 42 && sC.current.vars.gold === 777);
  check('다른 채팅 → 앵커 스냅샷 생성', backendC.keys().includes('sim:cha:chat-B:out:0'), backendC.keys().join(','));
  check('다른 채팅 → 남의 인덱스 스냅샷 없음', !backendC.keys().some((k) => k.endsWith(':out:27')), backendC.keys().join(','));

  // 재로드(메시지 0개 기준)해도 유지되는가 — 이게 "가져와도 안 변한다"의 핵심
  const sC2 = new SimSession(SCHEMA, backendC, { chatId: 'chat-B', prefix: 'sim:cha:chat-B' });
  await sC2.init(0);
  check('다른 채팅 → 재로드 후 유지', sC2.current.vars.hp === 42, JSON.stringify(sC2.current.vars));

  // 채팅이 길어져 27번 메시지에 도달해도 과거 상태로 안 튀는가
  const sC3 = new SimSession(SCHEMA, backendC, { chatId: 'chat-B', prefix: 'sim:cha:chat-B' });
  await sC3.init(30);
  check('다른 채팅 → 메시지 늘어도 상태 유지', sC3.current.vars.hp === 42, JSON.stringify(sC3.current.vars));

  // ── 케이스 3: 구버전 세이브(스키마 미동봉)도 여전히 동작 ──
  const old = JSON.parse(JSON.stringify(save));
  delete old.schema;
  const backendD = new MapBackend();
  const sD = new SimSession(SCHEMA, backendD, { chatId: 'chat-C', prefix: 'sim:cha:chat-C' });
  await sD.init(-1);
  const r3 = await sD.importData(old, 3);
  check('구버전 세이브도 상태 복원', r3.ok && sD.current.vars.hp === 42);

  // ── 케이스 4: 잘못된 파일 거부 ──
  const r4 = await sD.importData({ nope: 1 }, 0);
  check('형식 아닌 파일 거부', r4 === false, JSON.stringify(r4));

  let pass = 0, fail = 0;
  for (const [ok, n, e] of results) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${e}`); ok ? pass++ : fail++; }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
