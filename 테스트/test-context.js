const __P = (...p) => require('path').resolve(__dirname, ...p);
// 보조모델 대화 맥락(1~5턴) 검증 — JS 경로 + 루아 브리지 생성 코드
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { validateSchema } = SimCore.require('validate');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const SCH = {
  simcore: '0.1', meta: { name: 'T' },
  vars: [{ id: 'aff', label: '호감', type: 'int', init: 10, min: 0, max: 100 }],
  statusUI: { mode: 'auto', groups: [] },
  updater: { allow: [{ id: 'aff', maxDelta: 10 }] },
};
const state = engine.initState(SCH);

// ── formatHistory ──
{
  ck('빈 배열 → 빈 문자열', engine.formatHistory([]) === '');
  ck('null → 빈 문자열', engine.formatHistory(null) === '');
  const h = engine.formatHistory([
    { role: 'user', text: '안녕' }, { role: 'char', text: '반가워' }, { role: 'user', text: '  ' },
  ]);
  ck('역할 라벨 붙음', h.includes('유저: 안녕') && h.includes('상대: 반가워'), h);
  ck('빈 발화는 제외', !h.includes('유저:  '), h);
  ck('헤더 포함', h.startsWith('[앞선 대화 흐름 — 참고용]'), h.split('\n')[0]);
}

// ── buildAuxPrompt: 맥락 유무 ──
{
  const p1 = engine.buildAuxPrompt(SCH, state, '서사', '입력');
  ck('맥락 없으면 섹션 자체가 없음', !p1.includes('앞선 대화 흐름'), p1.slice(0, 200));
  ck('맥락 없으면 중복 경고도 없음', !p1.includes('다시 세지 마라'));
  ck('이번 턴 서사는 항상 있음', p1.includes('[이번 턴 서사]') && p1.includes('서사'));

  const hist = engine.formatHistory([{ role: 'user', text: '선물 줄게' }, { role: 'char', text: '고마워' }]);
  const p2 = engine.buildAuxPrompt(SCH, state, '서사', '입력', hist);
  ck('맥락 있으면 섹션 포함', p2.includes('앞선 대화 흐름') && p2.includes('선물 줄게'), '');
  ck('★ 중복 반영 방지 지시 자동 추가', p2.includes('다시 세지 마라'), '');
  ck('맥락이 이번 턴 서사보다 앞에 옴', p2.indexOf('앞선 대화 흐름') < p2.indexOf('[이번 턴 서사]'));
  ck('유저 입력은 여전히 별도 강조', p2.includes('[유저의 행동/발화]'));
}

// ── 검증기: 1~5 범위 ──
{
  const mk = (c) => ({ ...SCH, updater: { ...SCH.updater, contextTurns: c } });
  ck('1 허용', validateSchema(mk(1)).ok);
  ck('5 허용', validateSchema(mk(5)).ok);
  ck('미지정 허용', validateSchema(SCH).ok);
  ck('0 거부', !validateSchema(mk(0)).ok, JSON.stringify(validateSchema(mk(0)).errors));
  ck('6 거부', !validateSchema(mk(6)).ok);
  ck('소수 거부', !validateSchema(mk(2.5)).ok);
  ck('문자열 거부', !validateSchema(mk('3')).ok);
  ck('거부 시 경로 정확', validateSchema(mk(9)).errors.some((e) => e.path === '$.updater.contextTurns'),
    JSON.stringify(validateSchema(mk(9)).errors));
}

// ── 플러그인의 히스토리 수집 로직 (출력 핸들러와 동일한 계산) ──
{
  const clamp = (v) => { const n = Math.round(Number(v)); return isFinite(n) ? Math.min(5, Math.max(1, n)) : 1; };
  ck('clamp: 미지정 → 1', clamp(undefined) === 1);
  ck('clamp: 0 → 1', clamp(0) === 1);
  ck('clamp: 99 → 5', clamp(99) === 5);
  ck('clamp: 3 → 3', clamp(3) === 3);

  const msgs = [
    { role: 'user', data: 'u1' }, { role: 'char', data: 'c1' },
    { role: 'user', data: 'u2' }, { role: 'char', data: 'c2' },
    { role: 'user', data: 'u3' }, { role: 'char', data: 'c3' },
    { role: 'user', data: 'u4' },
  ];
  const lastUserIdx = 6;
  const take = (turns) => {
    if (turns <= 1 || lastUserIdx <= 0) return '';
    const back = (turns - 1) * 2;
    return engine.formatHistory(msgs.slice(Math.max(0, lastUserIdx - back), lastUserIdx)
      .map((m) => ({ role: m.role, text: m.data })));
  };
  ck('1턴 = 맥락 없음', take(1) === '', take(1));
  const h3 = take(3);
  ck('3턴 = 직전 2교환 포함', h3.includes('u2') && h3.includes('c2') && h3.includes('u3') && h3.includes('c3'), h3);
  ck('3턴은 그보다 앞은 제외', !h3.includes('u1'), h3);
  ck('현재 턴 발화는 맥락에 중복되지 않음', !take(5).includes('u4'), take(5));
  ck('5턴은 있는 만큼만 (범위 밖 안전)', take(5).includes('u1'), take(5));
}

// ── 루아 브리지: 생성 코드 문법 + 맥락 배선 ──
{
  // clampContextTurns ~ buildLuaBridgeCode 까지 한 덩어리로 떼어낸다 (서명 함수 등 의존 포함)
  const seg = src.slice(src.indexOf('  function clampContextTurns(v) {'),
    src.indexOf('  function installLuaBridgeOn(char, sch) {'));
  const AUX_NUDGE = (src.match(/const AUX_NUDGE = '([^']*)'/) || [, ''])[1];
  const gen = new Function('engine', 'hasLuaBridge', 'LUA_BRIDGE_COMMENT', 'AUX_NUDGE',
    seg + '\nreturn buildLuaBridgeCode;')(engine, () => false, 'simcore-bridge', AUX_NUDGE);

  // 프롬프트 템플릿 안에 자리표시자가 박혔는지를 본다 (치환 코드 줄은 항상 있고, 자리가 없으면 no-op)
  const deltaTpl = (code) => {
    const m = code.match(/local SIMCORE_DELTA_T = \[(=*)\[\n([\s\S]*?)\n\]\1\]/);
    return m ? m[2] : '';
  };
  const code1 = gen(SCH);
  ck('1턴이면 프롬프트에 HIST 자리 없음', deltaTpl(code1).length > 0 && !deltaTpl(code1).includes('⟦HIST⟧'),
    deltaTpl(code1).slice(0, 120));
  ck('1턴이면 SIMCORE_CTX = 1', /SIMCORE_CTX = 1\b/.test(code1), '');

  const code3 = gen({ ...SCH, updater: { ...SCH.updater, contextTurns: 3 } });
  ck('3턴이면 프롬프트에 HIST 자리 생성', deltaTpl(code3).includes('⟦HIST⟧'), deltaTpl(code3).slice(0, 200));
  ck('3턴이면 중복 반영 방지 지시도 포함', deltaTpl(code3).includes('다시 세지 마라'), '');
  ck('3턴이면 SIMCORE_CTX = 3', /SIMCORE_CTX = 3\b/.test(code3), '');
  ck('루아가 HIST를 치환함', code3.includes("string.gsub(prompt, '⟦HIST⟧'"), '');
  ck('루아가 헤더를 직접 붙임', code3.includes('앞선 대화 흐름'), '');
  ck('루아가 마커를 히스토리에서도 제거', /parts\[#parts \+ 1\] = who \.\. string\.gsub/.test(code3), '');
  // 구글 계열은 system을 systemInstruction으로 빼가므로 system 한 통만 보내면 contents가 빈다
  ck('★ 생성된 axLLM 호출에 user 턴이 실려 있다', AUX_NUDGE.length > 0 && code3.includes(AUX_NUDGE)
    && /role = 'system'[\s\S]{0,120}role = 'user'/.test(code3), AUX_NUDGE || '(AUX_NUDGE 추출 실패)');

  // 루아 문법 검사 (luac 있으면 실행, 없으면 구조 검사)
  const { execSync } = require('child_process');
  let luacOk = null;
  try { execSync('luac -v', { stdio: 'ignore' }); luacOk = true; } catch { luacOk = false; }
  if (luacOk) {
    const tmp = require('path').join(__dirname, '_bridge.lua');
    fs.writeFileSync(tmp, code3, 'utf8');
    let ok = true, msg = '';
    try { execSync(`luac -p "${tmp}"`, { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stderr || e); }
    ck('생성된 루아 코드 문법 통과 (luac)', ok, msg);
  } else {
    // luac 부재 — do/end, for/end, if/end 균형만이라도 확인
    const opens = (code3.match(/\b(function|if|for|while|do)\b/g) || []).length;
    const ends = (code3.match(/\bend\b/g) || []).length;
    ck('루아 블록 균형 (luac 없어 근사 검사)', ends > 0 && Math.abs(opens - ends) <= 4, `open ${opens} / end ${ends}`);
    ck('table.concat 사용 정상', code3.includes("table.concat(parts, '\\n')"), '');
  }
}

// ── 템플릿 회귀: 전부 여전히 유효 ──
{
  const { TEMPLATES } = SimCore.require('templates');
  let bad = null;
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const v = validateSchema(t.schema);
    if (!v.ok) bad = `${k}: ${v.errors[0].path} ${v.errors[0].msg}`;
    const p = engine.buildAuxPrompt(t.schema, engine.initState(t.schema), 'n', 'u');
    if (!p.includes('changes')) bad = `${k}: 프롬프트 생성 실패`;
  }
  ck('전 템플릿 여전히 유효', !bad, bad);
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
