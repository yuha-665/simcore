const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.7.1 — 목록 기한 환산. 항목의 `@450`은 "끝나는 시점"(절대 경과값)이라 저장에는 맞지만
// 읽는 쪽에는 아무 뜻이 없다. 유저는 상태창 칩에서 `집중 +2 @450`을 봤고, 메인 모델은
// `진행 중 퀘스트: 고블린 소탕 @455`를 받아 며칠 남았는지 알 길이 없었다.
// 화면·프롬프트에만 `(3일)`로 환산한다 — 저장값과 보조 AI 계약표는 원문 그대로.
const E = require(__P('../core/engine.js'));
const R = require(__P('../core/render.js'));
const C = require(__P('../core/calendar.js'));

const R_ = []; const ok = (n, c, x = '') => R_.push([c, n, x]);

const SCHEMA = {
  simcore: '0.1', meta: { name: '기한 테스트' },
  vars: [
    { id: 'buffs', label: '상태 효과', type: 'list', init: [], cmd: '상태' },
    { id: 'dead', label: '시계 없는 목록', type: 'list', init: [] },
    { id: 'day', label: '경과일', type: 'int', init: 0 },
  ],
  rules: { onTurn: [{ list: 'buffs', expire: 'day' }] },   // dead에는 expire 규칙이 없다
  updater: { allow: [{ id: 'buffs' }] },
  promptState: { template: '상태 효과: {buffs}' },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'buffs' }, { var: 'dead' }] }] },
};
const mk = (vars) => ({ vars: { day: 447, buffs: [], dead: [], ...vars }, meta: {} });

console.log('\n━━ 환산 규칙 ━━');
{
  const now = 447;
  ok('절대 기한 → 남은 일수', E.dueText('집중 +2 @450', now) === '집중 +2 (3일)', E.dueText('집중 +2 @450', now));
  ok('오늘이 마지막 날 → (오늘)', E.dueText('출혈 @447', now) === '출혈 (오늘)', E.dueText('출혈 @447', now));
  // 만료 정리는 e >= now를 남긴다 — 지난 항목은 다음 onTurn에 빠지지만 그 사이 한 번은 보인다
  ok('이미 지난 기한 → (지남)', E.dueText('각성 @446', now) === '각성 (지남)', E.dueText('각성 @446', now));
  ok('음수 기한도 지남', E.dueText('유령 일정 @-22', now) === '유령 일정 (지남)', E.dueText('유령 일정 @-22', now));
  ok('기한 없는 항목은 그대로', E.dueText('상시 특성', now) === '상시 특성', '');
  // @+N은 아직 안 굳은 상대 기한 — 그 자체가 "N일 뒤"라 시계를 몰라도 읽힌다
  ok('상대 기한 @+N은 시계 없이도 환산', E.dueText('신규 의뢰 @+5', null) === '신규 의뢰 (5일)', E.dueText('신규 의뢰 @+5', null));
  ok('상대 기한은 시계가 있어도 그대로 N일', E.dueText('신규 의뢰 @+5', 447) === '신규 의뢰 (5일)', '');
  // 시계를 모르면(expire 규칙이 없으면) @D는 아무 일도 안 하는 죽은 글자다
  ok('시계 없는 절대 기한은 떼기만', E.dueText('죽은 기한 @999', null) === '죽은 기한', E.dueText('죽은 기한 @999', null));
  ok('내용이 기한뿐이면 꼬리만', E.dueText('@450', 447) === '(3일)', E.dueText('@450', 447));
  ok('겹공백 정리', E.dueText('집중  @450  +2', 447) === '집중 +2 (3일)', E.dueText('집중  @450  +2', 447));
  ok('소수 기한도 반올림', E.dueText('빙결 @449.6', 447) === '빙결 (3일)', E.dueText('빙결 @449.6', 447));
}

console.log('\n━━ 시계 — 목록의 expire 식이 지금 가리키는 값 ━━');
{
  const st = mk({});
  ok('expire 규칙이 있으면 그 식의 값', E.listClockNow(SCHEMA, st, 'buffs') === 447, String(E.listClockNow(SCHEMA, st, 'buffs')));
  ok('규칙 없는 목록은 null', E.listClockNow(SCHEMA, st, 'dead') === null, '');
  ok('없는 변수도 null (터지지 않음)', E.listClockNow(SCHEMA, st, 'nope') === null, '');
  ok('식이 깨져도 null', E.listClockNow({ rules: { onTurn: [{ list: 'x', expire: '있지도않은변수' }] }, vars: [] },
    st, 'x') === null, '');
  // 상태창은 같은 목록을 여러 칸에 꽂는다 — 목록마다 한 번만 굴린다
  const clk = E.dueClock(SCHEMA, st);
  ok('dueClock 캐시', clk('buffs') === 447 && clk('buffs') === 447 && clk('dead') === null, '');
}

console.log('\n━━ 상태창 — 그룹 모드 칩 ━━');
{
  const st = mk({ buffs: ['[버프] 집중 +2 @450', '[디버프] 출혈 @447', '상시 특성'], dead: ['죽은 기한 @999'] });
  const html = String(R.renderStatusHtml(SCHEMA, st, {}));
  const chips = (html.match(/<span class="sim-tag">([^<]*)/g) || []).map((s) => s.replace(/.*">/, ''));
  ok('★ 칩에 @숫자가 안 보인다', !chips.some((c) => /@\d/.test(c)), chips.join(' | '));
  ok('버프는 남은 일수로', chips.includes('[버프] 집중 +2 (3일)'), chips.join(' | '));
  ok('오늘 끝나는 디버프', chips.includes('[디버프] 출혈 (오늘)'), '');
  ok('기한 없는 특성은 그대로', chips.includes('상시 특성'), '');
  ok('시계 없는 목록은 기한만 떨어짐', chips.includes('죽은 기한'), chips.join(' | '));
}

console.log('\n━━ 상태창 — 템플릿 모드 {목록:tags} ━━');
{
  const S2 = { ...SCHEMA, statusUI: { mode: 'template',
    template: '<div>버프 {buffs:tags:[버프]}</div><div>디버프 {buffs:tags:[디버프]}</div><div>평문 {buffs}</div>' } };
  const st = mk({ buffs: ['[버프] 집중 +2 @450', '[디버프] 출혈 @445'] });
  const html = String(R.renderStatusHtml(S2, st, {}));
  ok('tags 칩도 환산', html.includes('[버프] 집중 +2 (3일)'), '');
  // 필터는 저장된 원문에 건다 — 걸러내는 낱말이 기한 표기와 엮이면 안 된다
  ok('★ 필터는 환산 전 원문에', html.includes('[디버프] 출혈 (지남)')
    && html.split('디버프 ')[1].split('</div>')[0].includes('출혈'), '');
  ok('필터가 남의 항목을 안 물어옴', (html.match(/집중/g) || []).length === 2, String((html.match(/집중/g) || []).length));
  ok('템플릿 평문 자리도 환산', html.includes('집중 +2 (3일), [디버프] 출혈 (지남)'), '');
  ok('템플릿 어디에도 @숫자 없음', !/@\d/.test(html), html.slice(0, 120));
}

console.log('\n━━ 메인 AI 상태 블록 — @455로는 며칠 남았는지 못 읽는다 ━━');
{
  const st = mk({ buffs: ['집중 +2 @450'] });
  st.meta = { turn: 1, armed: {}, pendingNotifies: [], actionLastUsed: {}, firedThisSend: {} };
  const block = E.sendPhase(SCHEMA, st, {}).promptBlock;
  ok('★ 상태 블록이 남은 일수로 나간다', block.includes('집중 +2 (3일)'), block.slice(0, 140));
  ok('상태 블록에 @숫자 없음', !/@\d/.test(block), block);
}

console.log('\n━━ ⚠ 보조 AI 계약표는 원문 그대로 — 목록 remove가 완전일치다 ━━');
{
  const st = mk({ buffs: ['집중 +2 @450'] });
  const aux = E.buildAuxPrompt(SCHEMA, st, '집중이 끊겼다', { allowAll: false });
  const text = typeof aux === 'string' ? aux : JSON.stringify(aux);
  ok('★ 계약표는 저장 원문 (@450 유지)', text.includes('@450'), text.slice(0, 80));
  ok('계약표에 환산 글자가 새지 않음', !text.includes('(3일)'), '');
  // 실제로 그 원문으로 지워지는가 — 환산 글자를 보여줬다면 여기서 조용히 실패했을 것
  const st2 = mk({ buffs: ['집중 +2 @450'] });
  st2.meta = { turn: 1, armed: {}, pendingNotifies: [], actionLastUsed: {}, firedThisSend: {} };
  const out = E.outputPhase(SCHEMA, st2, { buffs: { remove: ['집중 +2 @450'] } }, {}, {});
  ok('★ 원문으로 remove 성공', (out.state.vars.buffs || []).length === 0, JSON.stringify(out.state.vars.buffs));
}

console.log('\n━━ 저장값은 안 건드린다 ━━');
{
  const st = mk({ buffs: ['집중 +2 @450'] });
  R.renderStatusHtml(SCHEMA, st, {});
  ok('★ 렌더는 상태를 안 바꾼다', st.vars.buffs[0] === '집중 +2 @450', st.vars.buffs[0]);
}

console.log('\n━━ 변화 카드·로그 ━━');
{
  const st = mk({ buffs: ['집중 +2 @450'] });
  const log = [{ id: 'buffs', from: [], to: ['집중 +2 @450'], source: 'llm' }];
  const html = String(R.renderStatusHtml({ ...SCHEMA, statusUI: { ...SCHEMA.statusUI, changeLog: 'open' } }, st, log));
  ok('하이라이트 카드도 환산', html.includes('+집중 +2 (3일)'), (html.match(/\+집중[^<]*/) || [''])[0]);
  ok('카드·로그 어디에도 @숫자 없음', !/@\d/.test(html), (html.match(/.{0,30}@\d.{0,20}/) || [''])[0]);
}

console.log('\n━━ 달력 — 같은 시계를 본다 ━━');
{
  // planLabel은 달력 칸 글자. 음수 기한(이미 지난 것)도 떼야 '-22'가 안 남는다
  ok('planLabel 양수 기한', C.planLabel('회의 @450') === '회의', C.planLabel('회의 @450'));
  ok('planLabel 상대 기한', C.planLabel('회의 @+5') === '회의', C.planLabel('회의 @+5'));
  ok('★ planLabel 음수 기한', C.planLabel('유령 일정 @-22') === '유령 일정', C.planLabel('유령 일정 @-22'));
  // 제작자가 단위를 붙여 쓰는 '@3일' — 숫자만 떼면 '회의 일'이 남는다. dueText와 같은 규칙으로 문다
  ok('★ planLabel 단위 붙은 기한', C.planLabel('회의 @3일') === '회의', C.planLabel('회의 @3일'));
  ok('dueText도 같은 규칙', E.dueText('회의 @3일', null) === '회의', E.dueText('회의 @3일', null));
}

console.log('\n━━ 실물 봇 — 얼헌 퀘스트 ━━');
{
  // hunter-vars.js는 생성 스크립트라 export가 없다 — 산출물 JSON을 읽는다
  let S = null;
  try { S = JSON.parse(require('fs').readFileSync(__P('../얼헌/헌터-신안.json'), 'utf8')); } catch { /* 없으면 건너뜀 */ }
  if (S && S.vars) {
    const qs = (S.rules?.onTurn || []).filter((r) => r && r.expire).map((r) => r.list);
    ok('기한 목록에 expire 시계가 달려 있다', qs.includes('quests') && qs.includes('gates'), qs.join(','));
    ok('상태 블록이 그 목록을 싣는다', String(S.promptState?.template || '').includes('{quests}'), '');
  } else {
    ok('얼헌 스키마 로드 (건너뜀)', true, '');
    ok('얼헌 상태 블록 (건너뜀)', true, '');
  }
}

let p = 0, f = 0;
for (const [c, n, x] of R_) { console.log(c ? '  ✓' : '  ✗', n, c ? '' : `→ ${x}`); c ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
