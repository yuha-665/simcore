const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.23 — turn_min/turn_hour/turn_day가 변수 계약표·다이제스트 시간 절에 실린다
// 커뮤니티 제보(에렌샤): "어시스턴트가 turn_hour가 없다고 했다가 있다고 했다가 오락가락" — 표에 없고 문장에만 있었다
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const time = SC.require('time');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const S = {
  simcore: '0.1', meta: { name: '시간' },
  time: { start: '2026-01-01 09:00', expose: ['date', 'clock'] },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 100, min: 0 }, { id: 'skip_min', label: '흐른 분', type: 'int', init: 0, min: 0, max: 1440 }],
  rules: { onTurn: [{ set: 'hp', expr: 'hp - turn_hour * 2' }] },
  updater: { allow: [{ id: 'skip_min' }] },
};
const noTime = clone(S); delete noTime.time; noTime.rules.onTurn = [];

console.log('── 변수 계약표');
{
  const a = src.indexOf('function varContractTable(schema) {');
  const b = src.indexOf('\n}\n', a) + 3;
  const fn = new Function('timeConfig', 'EXPOSED_LABELS', src.slice(a, b) + '\nreturn varContractTable;')(time.timeConfig, time.EXPOSED_LABELS);
  const t = fn(S);
  ck('시간 켜진 봇: turn_min·turn_hour·turn_day 행', t.includes('| `turn_min` |') && t.includes('| `turn_hour` |') && t.includes('| `turn_day` |'), t.split('\n').slice(-6).join(' | '));
  ck('노출 이름(date·clock) 행과 같은 표 안', t.indexOf('| `date` |') < t.indexOf('| `turn_min` |') && t.indexOf('| `turn_min` |') > t.indexOf('읽기 전용'), '');
  ck('"응답마다 0으로 돌아감" 주의', t.includes('0으로 돌아감'), '');
  ck('시간 꺼진 봇: 행 없음', !fn(noTime).includes('turn_hour'), '');
}

console.log('── 다이제스트 시간 절');
{
  const seg = src.slice(src.indexOf('function patchIdDigest'), src.indexOf('function buildPatchExportPrompt'));
  const digest = new Function('varContractTable', 'timeConfig', seg + '\nreturn patchIdDigest;')(() => '(변수표)', time.timeConfig);
  const d = digest(S);
  ck('시간 절에 turn_* 줄 — "실제로 존재하는 내장 이름"', d.includes('`turn_min` `turn_hour` `turn_day`') && d.includes('실제로 존재하는 내장 이름'), d);
  ck('시간 꺼진 봇: 줄 없음', !digest(noTime).includes('turn_hour'), '');
}

console.log('── 엔진·검증은 원래대로');
{
  const { validateSchema } = SC.require('validate');
  ck('onTurn에서 turn_hour 참조가 검증 통과', validateSchema(S).ok, JSON.stringify(validateSchema(S).errors));
  const engine = SC.require('engine');
  const st = engine.initState(S);
  ck('turn_hour는 lookup으로 읽힌다 (0)', engine.makeLookup(S, st.vars)('turn_hour') === 0, '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
