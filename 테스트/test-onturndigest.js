const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.22 — 어시스턴트 다이제스트에 매 턴 정산(onTurn) 참조 절
// 커뮤니티 제보(에렌샤): "onTurn으로 이식한 HP·MP 차감 공식을 어시스턴트가 없다고 한다"
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const seg = src.slice(src.indexOf('function patchIdDigest'), src.indexOf('function buildPatchExportPrompt'));
const digest = new Function('varContractTable', 'timeConfig', seg + '\nreturn patchIdDigest;')(() => '(변수표)', SC.require('time').timeConfig);

const S = {
  simcore: '0.1', meta: { name: '정산' },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 100, min: 0, max: 100 },
    { id: 'mp', label: '마나', type: 'int', init: 50, min: 0, max: 50 },
    { id: 'quests', label: '의뢰', type: 'list', init: [] },
  ],
  rules: {
    onTurn: [
      { set: 'hp', expr: 'hp - 2' },
      { set: 'mp', expr: 'min(mp + 5, 50)' },
      { list: 'quests', expire: 'day', remove: ['끝난 의뢰'] },
      { list: 'quests', add: ['새 의뢰@+3'] },
    ],
    events: [],
  },
  updater: { allow: [{ id: 'hp' }] },
};

console.log('── 다이제스트');
{
  const d = digest(S);
  ck('매 턴 정산 절이 있다 (참조만·패치 불가)', d.includes('### 매 턴 정산 (rules.onTurn)') && d.includes('**패치로 못 다룹니다**') && d.includes('참조만'), d.slice(0, 200));
  ck('set 규칙 전문: 줄 번호 + id = 식', d.includes('1. `hp` = `hp - 2`') && d.includes('2. `mp` = `min(mp + 5, 50)`'), d);
  ck('목록 규칙 전문: expire·remove', d.includes('3. 목록 `quests`: remove ["끝난 의뢰"] · expire `day`'), d);
  ck('목록 규칙 전문: add', d.includes('4. 목록 `quests`: add ["새 의뢰@+3"]'), d);
  ck('"없다고 하지 마세요" + 편집기 자리 안내', d.includes('"없다"고 하지 마세요') && d.includes('[규칙·이벤트] 탭 첫 절'), '');
  const order = ['### 변수', '### 매 턴 정산'].map((k) => d.indexOf(k));
  ck('변수 표 뒤에 온다', order[0] >= 0 && order[1] > order[0], JSON.stringify(order));
  const none = clone(S); none.rules.onTurn = [];
  ck('onTurn이 비면 절이 없다', !digest(none).includes('매 턴 정산'), '');
  const junk = clone(S); junk.rules.onTurn = [null, 'x', { set: 'hp', expr: 'hp' }];
  ck('깨진 항목은 건너뛰고 번호는 유효 항목 기준', digest(junk).includes('1. `hp` = `hp`') && !digest(junk).includes('2. '), digest(junk));
}

console.log('── 규칙 문구');
{
  ck('패치 규칙: onTurn 전문은 다이제스트에 있으니 읽고 답하라', src.includes('단 onTurn(매 턴 정산)의 전문은 아래 다이제스트에 있으니 읽고 답하세요'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
