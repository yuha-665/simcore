const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.71 서사-시스템 불일치 신고 채널 — **신고 전용, 쓰기 권한 없음** 실측.
//
// 설계 배경: 서사가 시스템 항목(레벨·등급 등 경성 축)의 변화를 선언해도 지금까지는
// 조용히 무시돼 유저가 중재할 순간 자체를 몰랐다. 이 채널은 보조가 그 선언을 "보고만"
// 하게 한다 — 변수에는 절대 반영되지 않고, 통지([이벤트] 줄)로 다음 턴 서사가 스스로
// 물러나게 유도한다. 여기서 지키는 핵심 불변식은 하나다:
//   **conflicts는 어떤 경로로도 vars·changeLog에 닿지 않는다.**
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// 실험대: gold만 서사 조정 허용, level·rank는 시스템 항목 (허용 목록 밖)
const S = {
  simcore: '0.1', meta: { name: '불일치 실험대' },
  vars: [
    { id: 'gold', label: '금화', type: 'int', init: 100, min: 0, max: 9999 },
    { id: 'level', label: '검술 레벨', type: 'int', init: 1, min: 1, max: 10 },
    { id: 'rank', label: '등급', type: 'text', init: 'F', maxLength: 8 },
  ],
  updater: { allow: [{ id: 'gold', maxDelta: 50 }] },
  statusUI: { mode: 'auto', groups: [] },
};
ck('실험대 스키마 유효', validateSchema(S).ok,
  validateSchema(S).errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));

// ── 보조 프롬프트: 시스템 항목이 있어야만 지시가 실린다 ──
{
  const st = engine.initState(S);
  const p = engine.buildAuxPrompt(S, st, '유나가 검을 휘둘렀다.', null);
  ck('★ 시스템 항목 라벨이 지시에 실린다 (검술 레벨·등급)',
    p.includes('시스템 관리 항목(') && p.includes('검술 레벨') && p.includes('등급'), p.slice(0, 0));
  ck('★ 허용 변수(금화)는 시스템 항목 목록에 안 들어간다',
    !/시스템 관리 항목\([^)]*금화/.test(p), '');
  ck('conflicts 보고 형식 지시 존재', p.includes('"conflicts"') && p.includes('한 줄 문자열로 보고'), '');
  ck('선언 없으면 넣지 말라는 지시 (평시 토큰 절약)', p.includes('conflicts를 아예 넣지 마라'), '');

  // 전 변수 허용 봇 — 시스템 항목이 없으니 지시 자체가 안 실린다
  const SAll = { ...S, updater: { allow: S.vars.map((v) => ({ id: v.id })) } };
  const pAll = engine.buildAuxPrompt(SAll, engine.initState(SAll), '서사.', null);
  ck('★ 전 변수 허용이면 지시 없음 (토큰 낭비 0)', !pAll.includes('시스템 관리 항목('), '');

  // 루아 브리지 굽기(allowAll) — 브리지는 changes/reasons만 회수하므로 안 싣는다
  const pBridge = engine.buildAuxPrompt(S, st, '서사.', null, null, { allowAll: true });
  ck('★ 브리지 템플릿 굽기에는 안 실린다', !pBridge.includes('시스템 관리 항목('), '');
}

// ── 파서 ──
{
  const ok = engine.parseAuxResponse('{"changes":{},"reasons":{},"conflicts":["서사가 검술 레벨업을 선언"]}');
  ck('★ conflicts 배열 파싱', Array.isArray(ok.conflicts) && ok.conflicts.length === 1, '');
  const no = engine.parseAuxResponse('{"changes":{},"reasons":{}}');
  ck('conflicts 없으면 null', no.conflicts === null, '');
  const junk = engine.parseAuxResponse('{"changes":{},"reasons":{},"conflicts":"문자열"}');
  ck('배열 아니면 null (형식 방어)', junk.conflicts === null, '');
}

// ── 정제 ──
{
  const s = engine.sanitizeConflicts([' 레벨업  선언 ', 42, '', null, 'a', 'b', 'c']);
  ck('★ 문자열만·공백 정규화·최대 3건', s.length === 3 && s[0] === '레벨업 선언', JSON.stringify(s));
  ck('160자 상한', engine.sanitizeConflicts(['x'.repeat(500)])[0].length === 160, '');
  ck('비배열은 빈 결과', engine.sanitizeConflicts('아무거나').length === 0
    && engine.sanitizeConflicts(null).length === 0, '');
}

// ── 핵심 불변식: 변수·changeLog에 절대 안 닿는다 ──
{
  const st = engine.initState(S);
  const r = engine.outputPhase(S, st, {}, {}, { rng: () => 0.5, conflicts: ['서사가 검술 레벨 5를 선언했다'] });
  ck('★ 변수 무변화 (level 그대로 1)', r.state.vars.level === 1 && r.state.vars.rank === 'F', '');
  ck('★ changeLog 무오염 (신고는 변화가 아니다)', r.changeLog.length === 0, JSON.stringify(r.changeLog));
  ck('★ 통지에 ⚠ 시스템 미확정 줄 합류', r.state.meta.pendingNotifies.some((n) =>
    n.includes('⚠ 시스템 미확정: 서사가 검술 레벨 5를 선언했다') && n.includes('반영되지 않았다')),
    JSON.stringify(r.state.meta.pendingNotifies));

  // 다음 전송에서 [이벤트] 줄로 실려 나간다 — 메인 모델이 되돌릴 근거
  const send = engine.sendPhase(S, r.state, { rng: () => 0.5 });
  ck('★ 다음 턴 상태 블록에 [이벤트] ⚠ 줄', send.promptBlock.includes('[이벤트] ⚠ 시스템 미확정'),
    send.promptBlock.slice(0, 300));
  ck('통지는 1회성 (전송 후 비워짐)', send.state.meta.pendingNotifies.length === 0, '');

  // 신고와 정상 델타가 같이 와도 서로 안 섞인다
  const r2 = engine.outputPhase(S, st, { gold: -30 }, {}, { rng: () => 0.5, conflicts: ['등급 승급 선언'] });
  ck('★ 허용 델타는 정상 적용 + 신고는 통지만', r2.state.vars.gold === 70
    && r2.changeLog.length === 1 && r2.state.meta.pendingNotifies.some((n) => n.includes('등급 승급 선언')), '');
}

// ── 소급 경로 (지연·브리지) ──
{
  const st = engine.initState(S);
  const a = engine.applyChangesToState(S, st, {}, {}, null, null, ['소급 경로 신고']);
  ck('★ applyChangesToState도 통지로만', a.changeLog.length === 0
    && a.state.meta.pendingNotifies.some((n) => n.includes('소급 경로 신고')), '');
  ck('conflicts=null이면 아무 일 없음', engine.applyChangesToState(S, st, {}, {}).state.meta.pendingNotifies.length === 0, '');
}

// ── 번들 배선 ──
{
  ck('★ 어댑터: 즉시 경로가 conflicts를 표면화 (패널+콘솔)',
    src.includes('engine.sanitizeConflicts(r.auxParsed?.conflicts)')
    && src.includes('서사-시스템 불일치 신고'), '');
  ck('★ 어댑터: 지연·브리지 소급 경로도 전달',
    (src.match(/parsed\.suggest, parsed\.conflicts\)/g) || []).length === 2, '');
  ck('세션: onOutput이 outputPhase에 전달', src.includes('conflicts: parsed.conflicts ?? null'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
