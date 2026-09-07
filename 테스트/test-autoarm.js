const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.7.7 낱말 자동 무장 — 유저 글에 액션 낱말이 있으면 버튼 없이 그 턴에 무장한다.
// 계기(아틀리에 실기): 판정 액션(채집·조합·납품·교전)은 버튼이 유일한 통로라 "버튼 안 누르면
// 서사로만 지나가 주사위가 안 구른다". 유저가 글로 밝힌 의도가 곧 버튼이어야 한다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');

let pass = 0, fail = 0;
const ck = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, '→', got); } };
const clone = (x) => JSON.parse(JSON.stringify(x));

const S = {
  simcore: '0.1', meta: { name: '낱말 무장' },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 },
    { id: 'place', label: '위치', type: 'enum', enum: ['마을', '들판'], init: '마을' },
  ],
  actions: [
    { id: 'gather', label: '⛏ 채집', mode: 'oneshot', when: "place == '들판'", keywords: ['채집하', '캐러', '뜯'],
      effects: [{ set: 'hp', expr: 'hp - 5' }] },
    // "조합한다"는 "조합하"를 안 품는다 (한 ≠ 하 — 음절 단위) — 활용형은 따로따로 적어야 한다
    { id: 'synth', label: '🧪 조합', mode: 'oneshot', keywords: ['조합하', '조합한다', '만든다'], cooldown: 2,
      effects: [{ set: 'hp', expr: 'hp - 1' }] },
    { id: 'rest', label: '😴 휴식', mode: 'oneshot', keywords: ['쉰다'], effects: [{ set: 'hp', expr: 'hp + 10' }] },
    { id: 'plain', label: '버튼만', mode: 'oneshot', effects: [{ set: 'hp', expr: 'hp + 1' }] },
  ],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
};
ck('검증 통과', validateSchema(S).ok, JSON.stringify(validateSchema(S).errors));

const fresh = () => { const t = engine.initState(S); t.meta.setupDone = true; return t; };

// ── 낱말 → 무장 ──
{
  const t = fresh(); t.vars.place = '들판';
  const r = engine.autoArmActions(S, t, '오늘은 들판에서 약초를 채집하러 간다');
  ck('글에 낱말이 있으면 무장', r.armed.join(',') === 'gather' && r.state.meta.armed.gather === true, JSON.stringify(r));
  ck('원본 상태는 안 건드린다 (사본)', !t.meta.armed.gather, '');
  const r2 = engine.autoArmActions(S, t, '조합서를 펼쳐 본다');
  ck('"조합서"엔 "조합하"가 안 걸린다 (활용형 낱말)', r2.armed.length === 0, JSON.stringify(r2.armed));
  const r3 = engine.autoArmActions(S, t, '약을 조합한다. 그리고 쉰다.');
  ck('한 글에 둘이면 둘 다 무장', r3.armed.join(',') === 'synth,rest', JSON.stringify(r3.armed));
  const r4 = engine.autoArmActions(S, t, '그냥 걷는다');
  ck('낱말 없으면 아무 일도 없다', r4.armed.length === 0 && r4.skipped.length === 0 && r4.state === t, '');
  const r5 = engine.autoArmActions(S, t, '');
  ck('빈 글도 아무 일도 없다', r5.armed.length === 0 && r5.state === t, '');
}

// ── 조건·쿨다운·이미 무장 ──
{
  const t = fresh();                                     // 마을 — gather when 거짓
  const r = engine.autoArmActions(S, t, '채집하러 간다');
  ck('조건 미충족이면 무장 안 되고 이유가 남는다', r.armed.length === 0 && r.skipped[0]?.id === 'gather' && /조건/.test(r.skipped[0].reason), JSON.stringify(r.skipped));
  let u = fresh(); u.meta.armed.rest = true;
  const r2 = engine.autoArmActions(S, u, '쉰다');
  ck('이미 무장이면 손대지 않는다 (토글로 끄지 않음)', r2.armed.length === 0 && r2.state.meta.armed.rest === true, JSON.stringify(r2));
  // 쿨다운 — synth를 한 번 쓰고 나면 2턴 동안 낱말이 와도 안 켜진다
  u = fresh(); u = engine.toggleAction(S, u, 'synth').state;
  const send = engine.sendPhase(S, u, {}); const out = engine.outputPhase(S, send.state, {}, {}, {});
  const r3 = engine.autoArmActions(S, out.state, '또 조합한다');
  ck('쿨다운 중엔 건너뛴다', r3.armed.length === 0 && /쿨다운/.test(r3.skipped[0]?.reason ?? ''), JSON.stringify(r3.skipped));
}

// ── 무장된 것이 실제로 그 턴에 발동한다 (버튼과 같은 길) ──
{
  const t = fresh(); t.vars.place = '들판';
  const r = engine.autoArmActions(S, t, '채집하러 간다');
  const send = engine.sendPhase(S, r.state, {});
  ck('전송 단계에서 효과가 굴러간다 (hp 50 → 45)', send.state.vars.hp === 45, String(send.state.vars.hp));
  ck('발동 뒤 무장이 풀린다 (oneshot)', !send.state.meta.armed.gather, '');
}

// ── 검증 ──
{
  const bad = clone(S); bad.actions[0].keywords = '채집';
  ck('keywords는 배열', validateSchema(bad).errors.some((e) => e.path === '$.actions[0].keywords'), '');
  const bad2 = clone(S); bad2.actions[0].keywords = ['채집', ''];
  ck('빈 낱말 오류', validateSchema(bad2).errors.some((e) => e.path === '$.actions[0].keywords'), '');
  const w1 = clone(S); w1.actions[0].keywords = ['채', '캐러'];
  ck('한 글자 낱말은 경고', validateSchema(w1).ok && validateSchema(w1).warnings.some((e) => e.path === '$.actions[0].keywords'), '');
  const w2 = clone(S); w2.actions[2].keywords = ['쉰다', '채집하'];
  ck('두 액션에 같은 낱말이면 경고', validateSchema(w2).warnings.some((e) => /채집하.*gather/.test(e.msg)), JSON.stringify(validateSchema(w2).warnings));
  const none = clone(S); for (const a of none.actions) delete a.keywords;
  ck('keywords 없는 스키마는 그대로 통과', validateSchema(none).ok, '');
}

// ── 어댑터·편집기 배선 (소스 정적) ──
{
  ck('input 훅이 낱말 무장을 부른다', src.includes('engine.autoArmActions(schema, session.current, content)'), '');
  ck("'/' 없는 글도 보되 keywords 없는 스키마면 바로 돌려준다", src.includes("if (!hasCmd) { await loadForCurrentChar(); if (!(schema?.actions || []).some((a) => Array.isArray(a.keywords) && a.keywords.length)) return content; }"), '');
  ck('무장만 됐어도 저장·미러·패널 갱신', src.includes('if (!hasCmd) { if (touched) await persist(); return content; }'), '');
  ck('편집기 액션 칸에 자동 무장 낱말', /(?:pair|field)\('자동 무장 낱말'/.test(src), '');   // v1.7.13 개조본 field()
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
