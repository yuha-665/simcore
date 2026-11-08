const __P = (...p) => require('path').resolve(__dirname, ...p);
// 보조모델 경로 자동 판별 + 브리지 노후 감지 검증 (배포 시나리오)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

// 경로 판별 절
const a1 = src.indexOf('  const AUX_PATH_KEY =');
const a2 = src.indexOf('  const sleep = (ms)', a1);
// 브리지 서명 절
const b1 = src.indexOf('  const BRIDGE_GEN =');   // 지문에 섞이는 상수라 슬라이스에 포함시킨다
const b2 = src.indexOf('  function buildLuaBridgeCode(sch)');
if (a1 < 0 || a2 < 0 || b1 < 0 || b2 < 0) { console.log('FAIL: 절 추출 실패'); process.exit(1); }

const harness = `
const store = new Map();
let argValue = '';
const LUA_BRIDGE_COMMENT = 'simcore-bridge';
const hasLuaBridge = (char) => (char && char.triggerscript || []).some((t) => t.comment === LUA_BRIDGE_COMMENT);
const Risuai = {
  pluginStorage: {
    getItem: async (k) => (store.has(k) ? store.get(k) : null),
    setItem: async (k, v) => { store.set(k, v); },
  },
  getArgument: async () => argValue,
  getCharacter: async () => globalThis.__char,
};
let lastAux = { status: '', raw: '', applied: 0 };
${src.slice(a1, a2)}
${src.slice(b1, b2)}
module.exports = { getAuxPath, setAuxPath, resolveAuxMode, schemaFingerprint, bridgeIsStale, bridgeSchemaSig, readArg, argLabel,
  _setArg: (v) => { argValue = v; }, _store: store, _resetCache: () => { auxPathCache = undefined; readArg.saved = {}; } };
`;
const out = require('path').join(__dirname, '_auxpath_gen.js');
fs.writeFileSync(out, harness, 'utf8');
const M = require(out);

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const SCHEMA_A = { vars: [{ id: 'hp', type: 'int', label: 'HP' }], updater: { allow: [{ id: 'hp', maxDelta: 10 }] } };
const SCHEMA_B = { vars: [{ id: 'hp', type: 'int', label: 'HP' }, { id: 'gold', type: 'int', label: '골드' }], updater: { allow: [{ id: 'hp' }] } };

(async () => {
  // ── 경로 판별 ──
  M._setArg('');           // 미설정 = auto
  ck('미설정이면 auto로 취급, 판정 전엔 직접 시도', (await M.resolveAuxMode()) === 'aux');
  ck('판정 전엔 저장값 없음', (await M.getAuxPath()) === null);

  await M.setAuxPath('bridge');   // 차단 감지됨
  ck('차단 판정 후 auto는 lua 경로', (await M.resolveAuxMode()) === 'lua');
  ck('판정이 저장소에 남음', M._store.get('sim:auxpath') === 'bridge');

  await M.setAuxPath('direct');
  ck('직접 가능 판정 후 auto는 aux 경로', (await M.resolveAuxMode()) === 'aux');

  // 명시 설정은 판정을 무시(강제)
  M._setArg('lua');
  ck('lua 강제는 판정 무시', (await M.resolveAuxMode()) === 'lua');
  M._setArg('aux');
  await M.setAuxPath('bridge');
  ck('aux 강제는 차단 판정도 무시', (await M.resolveAuxMode()) === 'aux');
  M._setArg('off');
  ck('off는 그대로 off', (await M.resolveAuxMode()) === 'off');

  // 다시 열었을 때(캐시 비움) 저장된 판정을 읽어오는가 = 배포본에서 한 번 판정하면 유지
  M._setArg('auto');
  M._resetCache();
  ck('재시작 후에도 판정 유지', (await M.resolveAuxMode()) === 'lua');

  // ── 업데이트해도 설정이 남는다 (v1.22.1) — 리수는 업데이트·손 임포트 때 @arg 칸을 비운다 ──
  M._setArg('off');
  await M.resolveAuxMode();
  ck('적힌 값은 저장소에 기억된다', M._store.get('sim:arg:aux_model_mode') === 'off', String(M._store.get('sim:arg:aux_model_mode')));
  M._setArg('');           // 업데이트로 칸이 비었다
  M._resetCache();         // 새 판으로 다시 켜졌다
  ck('★ 칸이 비면 지난 설정(off)을 이어 쓴다', (await M.resolveAuxMode()) === 'off');
  const kept = await M.readArg('aux_model_mode');
  ck('이어 쓰는 중이라고 표시한다', kept.from === 'kept' && M.argLabel(kept).includes('지난 설정'), M.argLabel(kept));
  M._setArg('auto');       // 기본으로 돌아가려면 기본값을 직접 적는다
  await M.resolveAuxMode();
  M._setArg('');
  M._resetCache();
  ck('★ 기본값(auto)을 적으면 그것도 기억 — 비워도 auto', (await M.resolveAuxMode()) === 'lua' && M._store.get('sim:arg:aux_model_mode') === 'auto',
    String(M._store.get('sim:arg:aux_model_mode')));
  M._setArg('luaa');       // 오타
  ck('모르는 값은 예전처럼 기본값(auto)으로, 기억하지 않는다',
    (await M.readArg('aux_model_mode')).value === 'auto' && M._store.get('sim:arg:aux_model_mode') === 'auto', '');
  ck('모르는 값 표시', M.argLabel(await M.readArg('aux_model_mode')).includes("'luaa'는 모르는 값"), '');
  M._setArg(' Lua ');
  ck('대소문자·공백은 예전처럼 너그럽게', (await M.readArg('aux_model_mode')).value === 'lua', '');
  // module_assets — 이미지가 모듈에 사는 봇. 업데이트마다 꺼지던 칸
  M._setArg('on');
  ck('module_assets on 기억', (await M.readArg('module_assets')).value === 'on' && M._store.get('sim:arg:module_assets') === 'on', '');
  M._setArg('');
  M._resetCache();
  ck('★ 업데이트로 칸이 비어도 module_assets는 on 그대로', (await M.readArg('module_assets')).value === 'on', '');
  M._store.delete('sim:arg:module_assets');
  ck('기억이 없으면 기본값 off', (await M.readArg('module_assets')).value === 'off' && (await M.readArg('module_assets')).from === 'default', '');
  M._setArg('auto');
  M._resetCache();

  // ── 브리지 노후 감지 ──
  const sigA = M.schemaFingerprint(SCHEMA_A);
  const sigB = M.schemaFingerprint(SCHEMA_B);
  ck('스키마 다르면 서명 다름', sigA !== sigB, `${sigA} vs ${sigB}`);
  ck('같은 스키마는 서명 동일', M.schemaFingerprint(JSON.parse(JSON.stringify(SCHEMA_A))) === sigA);

  const charWith = (sig) => ({ triggerscript: [{ comment: 'simcore-bridge', effect: [{ type: 'triggerlua', code: `-- SimCore\n-- simcore-schema: ${sig}\nonOutput = 1` }] }] });

  globalThis.__char = charWith(sigA);
  ck('서명 일치 → 노후 아님', M.bridgeIsStale(globalThis.__char, SCHEMA_A) === false);
  ck('서명 불일치 → 노후', M.bridgeIsStale(globalThis.__char, SCHEMA_B) === true);
  ck('서명 파싱 정확', M.bridgeSchemaSig(globalThis.__char) === sigA, M.bridgeSchemaSig(globalThis.__char));

  // 서명 없는 구버전 브리지(배포된 옛 카드) → 노후로 판정해 갱신 유도
  const oldChar = { triggerscript: [{ comment: 'simcore-bridge', effect: [{ type: 'triggerlua', code: '-- SimCore 옛 브리지\nonOutput = 1' }] }] };
  ck('서명 없는 구버전 브리지는 노후', M.bridgeIsStale(oldChar, SCHEMA_A) === true);
  ck('브리지 없으면 노후 아님', M.bridgeIsStale({ triggerscript: [] }, SCHEMA_A) === false);

  // 스키마가 그대로여도 생성되는 루아가 바뀌면 갱신을 유도해야 한다 → 세대 상수가 지문에 섞여야 함
  const fnv = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };
  const sigNoGen = fnv(JSON.stringify({ v: SCHEMA_A.vars.map((v) => [v.id, v.type, v.label]),
    a: SCHEMA_A.updater.allow, c: 1 }));
  ck('★ 브리지 세대가 지문에 섞여 있다 (코드만 바뀌어도 노후로 잡힌다)', sigA !== sigNoGen, `${sigA} vs ${sigNoGen}`);

  // ── 프로바이더 호환: 보조모델에 system 한 통만 보내면 안 된다 ──
  // 구글 계열(버텍스 Gemini)은 system을 systemInstruction으로 빼내 contents가 비고,
  // 리수 요청 빌더가 없는 원소의 role을 읽다 죽는다. OpenAI 호환은 안 죽어서 환경별로 갈렸다.
  const auxCall = src.slice(src.indexOf('async function callAuxLLM'), src.indexOf('  const AUX_PATH_KEY'));
  const roles = (auxCall.match(/role:\s*'(\w+)'/g) || []).map((s) => s.match(/'(\w+)'/)[1]);
  ck('★ 직접 호출은 system + user 두 통', roles.join(',') === 'system,user', roles.join(',') || '(없음)');

  const bridge = src.slice(src.indexOf('  function buildLuaBridgeCode'), src.indexOf('  function installLuaBridgeOn'));
  const luaRoles = (bridge.match(/role\s*=\s*'(\w+)'/g) || []).map((s) => s.match(/'(\w+)'/)[1]);
  ck('★ 루아 브리지 axLLM도 system + user 두 통', luaRoles.join(',') === 'system,user', luaRoles.join(',') || '(없음)');
  ck('덧붙이는 user 턴이 비어 있지 않다', /const AUX_NUDGE = '[^']+'/.test(src));

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
