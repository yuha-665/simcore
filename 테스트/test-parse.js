const __P = (...p) => require('path').resolve(__dirname, ...p);
// extractJsonObject / parseAuxResponse 단독 테스트
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const start = src.indexOf('function extractJsonObject');
const end = src.indexOf('② 응답 단계', start);
const parseAuxStart = src.indexOf('function parseAuxResponse');
const parseAuxEnd = src.indexOf('\n}', src.indexOf('return { changes', parseAuxStart)) + 2;
(0, eval)(src.slice(start, end) + '\n' + src.slice(parseAuxStart, parseAuxEnd));

const tests = [
  // 1. Thoughts 서두 + JSON (이번에 실패한 케이스)
  ['thoughts+json', '<Thoughts>\n**Updating Scenario** I am thinking about {stuff} deeply.\n</Thoughts>\n{"changes":{"hp":-5},"reasons":{"hp":"전투"}}',
    { changes: { hp: -5 }, reasons: { hp: '전투' } }],
  // 2. 코드펜스
  ['fence', '알겠습니다.\n```json\n{"changes":{"gold":10},"reasons":{}}\n```\n이상입니다.',
    { changes: { gold: 10 }, reasons: {} }],
  // 3. 순수 JSON
  ['pure', '{"changes":{"mp":3},"reasons":{}}', { changes: { mp: 3 }, reasons: {} }],
  // 4. 잡담 속 JSON
  ['chatter', '변화는 다음과 같습니다: {"changes":{"st":-2},"reasons":{"st":"피로"}} 입니다.',
    { changes: { st: -2 }, reasons: { st: '피로' } }],
  // 5. thoughts 안에 가짜, 진짜는 뒤에
  ['fake-then-real', '<Thoughts>{"changes":"아직 생각중"}</Thoughts> 최종: {"changes":{"hp":1},"reasons":{}}',
    { changes: { hp: 1 }, reasons: {} }],
  // 6. JSON 없음
  ['none', '변화가 없습니다.', null],
  // 7. 문자열 값에 중괄호/이스케이프
  ['tricky-str', '{"changes":{"note":"괄호} 포함 \\" 텍스트"},"reasons":{}}',
    { changes: { note: '괄호} 포함 " 텍스트' }, reasons: {} }],
  // 8. Thoughts 닫힘 태그 없이 잘린 서두 + JSON (스트리밍 잘림 대비)
  ['thoughts-unclosed', '<Thoughts>생각 중... {메모}\n실제 출력:\n{"changes":{"hp":2},"reasons":{}}',
    { changes: { hp: 2 }, reasons: {} }],
  // 9. changes 키 없는 JSON만 있음 → fallback으로라도 잡되 changes는 빈 객체
  ['no-changes-key', '{"values":{"hp":5}}', { changes: {}, reasons: {} }],
  // 10. 다음 행동 제안(v0.43) — 같은 응답에 suggest 배열이 실려 온다
  ['with-suggest', '{"changes":{"hp":1},"reasons":{},"suggest":["쉰다","싸운다"]}',
    { changes: { hp: 1 }, reasons: {}, suggest: ['쉰다', '싸운다'] }],
];

let pass = 0, fail = 0;
for (const [name, input, expected] of tests) {
  const raw = parseAuxResponse(input);
  // suggest는 v0.43에서 추가된 통과 필드 — 없으면(null) 비교에서 접는다
  const r = raw && { changes: raw.changes, reasons: raw.reasons, ...(raw.suggest != null ? { suggest: raw.suggest } : {}) };
  const ok = JSON.stringify(r) === JSON.stringify(expected);
  console.log((ok ? 'PASS' : 'FAIL'), name.padEnd(18), '→', JSON.stringify(r));
  ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
