const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.8 — 보조 출력 예산(auxOutputBudget) · 잘린 JSON 구제(salvageTruncatedJson) · 어댑터 배선
// 실사고: 롤 프로게이머 시뮬(변수 51 · 목록 18) — 경기 턴에 보조 JSON이 상한 400(클램프 1000)에 잘려 통째로 버려짐
const fs = require('fs');
const engine = require(__P('../core/engine.js'));
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };

// ── 롤 시뮬을 본뜬 스키마: 10명짜리 목록 일곱 + 스칼라 열여섯 ──
const ten = (f) => ['우리 탑', '우리 정글', '우리 미드', '우리 원딜', '우리 서폿', '상대 탑', '상대 정글', '상대 미드', '상대 원딜', '상대 서폿'].map(f);
const lists = {
  scoreboard: ten((p) => `${p}: 닉네임(챔피언) 0/0/0`),
  levels: ten((p) => `${p}: Lv.1`),
  skills: ten((p) => `${p}: Q Lv.1 / W Lv.0 / E Lv.0 / R Lv.0`),
  resources: ten((p) => `${p}: HP 100% / MP 100%`),
  spells: ten((p) => `${p}: 점멸(ON) / 텔포(ON)`),
  ults: ten((p) => `${p}: R ON`),
  cs: ten((p) => `${p}: 0 (0.0/분)`),
};
const scalars = ['hp', 'mechanics', 'macro', 'mental', 'fame', 'gold', 'set', 'our', 'enemy', 'wins', 'losses', 'fatigue', 'teamwork', 'pool', 'salary', 'tier_n'];
const big = {
  simcore: 1, meta: { name: 'lol' },
  vars: [
    ...scalars.map((id) => ({ id, label: id, type: 'int', init: 10, min: 0, max: 99999 })),
    { id: 'status', label: '상황', type: 'text', init: '경기 전' },
    { id: 'items', label: '아이템', type: 'list', init: [] },
    ...Object.entries(lists).map(([id, init]) => ({ id, label: id, type: 'list', init, max: 20 })),
  ],
  updater: { allow: [...scalars, 'status', 'items', ...Object.keys(lists)].map((id) => ({ id })) },
  suggest: { count: 3 },
};
const small = {
  simcore: 1, meta: { name: 'toy' },
  vars: [{ id: 'hp', label: 'HP', type: 'int', init: 100 }, { id: 'gold', label: '금화', type: 'int', init: 0 }, { id: 'mood', label: '기분', type: 'text', init: '보통' }],
  updater: { allow: [{ id: 'hp' }, { id: 'gold' }, { id: 'mood' }] },
};

console.log('── 예산');
{
  const st = engine.initState(big);
  const b = engine.auxOutputBudget(big, st, '경기 시작');
  ck('큰 봇(목록 7×10 + 스칼라 16) 예산이 2500 이상', b >= 2500, b);
  ck('예산은 천장 10000 이하', b <= 10000, b);
  const s = engine.auxOutputBudget(small, engine.initState(small), '안녕');
  // 장난감 봇 500 → 클램프(요청분×2, 최소 1000) 뒤엔 예전 400과 똑같이 1000 — 작은 봇의 비용은 안 변한다
  ck('장난감 봇 예산은 500 이하 (클램프 후 1000, 이전과 동일)', s <= 500, s);
  ck('예산은 100 단위 정수', Number.isInteger(b) && b % 100 === 0 && s % 100 === 0, `${b} ${s}`);
  // 낱말 게이트 — 닫힌 목록은 안 센다
  const gated = JSON.parse(JSON.stringify(big));
  for (const a of gated.updater.allow) if (a.id in lists) a.mentions = ['경기중'];
  const closed = engine.auxOutputBudget(gated, engine.initState(gated), '휴식하는 하루');
  const open = engine.auxOutputBudget(gated, engine.initState(gated), '경기중 한타');
  ck('낱말 게이트 닫힌 턴은 목록 몫이 빠진다', closed < 1500 && open >= 2500, `${closed} → ${open}`);
  // 상태를 갈아엎어 항목이 늘면 예산도 는다
  const st2 = engine.initState(big); st2.vars.items = Array.from({ length: 15 }, (_, i) => `아이템 ${i} 긴 이름 표기`);
  ck('목록 항목이 늘면 예산도 는다', engine.auxOutputBudget(big, st2, '경기') > b, '');
  ck('비상태(state null)에서도 죽지 않는다', engine.auxOutputBudget(big, null, '') > 0, '');
}

console.log('── 잘린 JSON 구제');
{
  const full = '{"changes":{"hp":-5,"scoreboard":{"add":["우리 탑: 페이커(아리) 1/0/2"],"remove":["우리 탑: 닉네임(챔피언) 0/0/0"]},"levels":{"add":["우리 탑: Lv.6"],"remove":["우리 탑: Lv.1"]}},"reasons":{"hp":"한타","scoreboard":"킬","levels":"레벨업"},"suggest":["로밍 간다","CS 먹는다","귀환한다"]}';
  const cut = (n) => engine.parseAuxResponse(full.slice(0, n));
  const whole = engine.parseAuxResponse(full);
  ck('온전한 응답은 truncated=false', whole && whole.truncated === false && whole.suggest.length === 3, JSON.stringify(whole));
  const r1 = cut(full.indexOf('"reasons"') + 30);   // reasons 도중
  ck('reasons 도중 잘림 → changes 셋 다 살고 truncated', r1 && r1.truncated && Object.keys(r1.changes).length === 3, JSON.stringify(r1));
  const r2 = cut(full.indexOf('"remove":["우리 탑: Lv.1"') + 10);   // levels의 remove 도중
  ck('목록 연산 도중 잘림 → 그 변수만 빠지고 앞의 둘은 산다', r2 && r2.truncated && Object.keys(r2.changes).join() === 'hp,scoreboard', JSON.stringify(r2 && r2.changes));
  ck('반쪽 목록 연산은 안 들어간다 (add만 있는 levels 없음)', r2 && !('levels' in r2.changes), '');
  const r3 = cut(full.indexOf('"suggest"') + 25);   // suggest 첫 항목 도중
  ck('suggest 도중 잘림 → changes·reasons 온전', r3 && r3.truncated && Object.keys(r3.reasons).length === 3, JSON.stringify(r3));
  const r4 = cut(14);   // {"changes":{"h
  ck('완성된 항목 하나 없으면 null (어댑터가 재시도)', r4 === null, JSON.stringify(r4));
  const r5 = engine.parseAuxResponse('<Thoughts>{"changes":"생각중"} 흠 {메모}</Thoughts>\n' + full.slice(0, full.indexOf('"suggest"') + 25));
  ck('Thoughts 안 가짜 객체·산문 괄호를 지나 뒤의 잘린 진짜를 살린다', r5 && r5.truncated && r5.changes.hp === -5, JSON.stringify(r5));
  const r6 = engine.parseAuxResponse('```json\n' + full.slice(0, full.indexOf('"suggest"') + 25));
  ck('닫히지 않은 코드펜스 안의 잘림도 살린다', r6 && r6.truncated && r6.changes.hp === -5, JSON.stringify(r6));
  const r7 = engine.parseAuxResponse('{"values":{"hp":5}}');
  ck('균형 잡힌 다른 객체는 구제 대상이 아니다 (기존 폴백 유지)', r7 && r7.truncated === false && Object.keys(r7.changes).length === 0, JSON.stringify(r7));
  ck('salvageTruncatedJson 단독: requiredKey 없으면 아무 완성 객체', engine.salvageTruncatedJson('{"a":1,"b":{"c":2},"d":"잘', null)?.b?.c === 2, '');
  ck('salvageTruncatedJson: 문자열 안의 괄호에 안 속는다', engine.salvageTruncatedJson('{"changes":{"note":"괄호} 포함","hp":1},"reasons":{"note":"잘', 'changes')?.changes?.hp === 1, '');
  // 구제된 델타가 실제로 적용되는가 (session과 같은 길)
  const st = engine.initState(big);
  const amended = engine.applyChangesToState(big, st, r2.changes, r2.reasons, '한타', null, null, null);
  ck('구제된 changes가 상태에 들어간다', amended.state.vars.hp === 5 && amended.state.vars.scoreboard.some((x) => x.includes('페이커')), JSON.stringify(amended.state.vars.scoreboard));
}

console.log('── 어댑터 배선');
{
  ck('상한 = max(400, auxOutputBudget)', src.includes('let auxCap = Math.max(400, engine.auxOutputBudget(schema, session.current, seenText));'), '');
  ck('얹힘(상점 첫 입고 등)은 그 위에 더한다', src.includes("if (auxPrompt.includes('시스템 상점 첫 입고')) auxCap += 2400;"), '');
  ck('잘린 응답은 상태줄·콘솔에 ⚠', src.includes('r.auxParsed?.truncated') && src.includes('보조 응답이 출력 상한에 잘려 완성된 항목만 반영'), '');
  ck('파싱 실패 재시도는 긴 원문이면 상한 곱절', src.includes('const retryCap = auxText.length > 200 ? auxCap * 2 : auxCap;'), '');
  ck('지연 경로도 잘림을 알린다', src.includes("if (parsed.truncated) console.log('[simcore] 지연 응답 잘림"), '');
  ck('parseAuxResponse가 truncated를 올린다', src.includes('truncated: obj.__truncated === true'), '');
  ck('클램프는 요청분×2 + 추론 예산 (Gemini는 thinking이 maxOutputTokens 안)', src.includes('auxCapInFlight = Math.max(1000, (Number(maxTokens) || 0) * 2) + AUX_THINK_CAP;'), '');
  ck('추론 예산 2048 (v1.9.9)', src.includes('const AUX_THINK_CAP = 2048;'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
