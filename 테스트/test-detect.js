const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.74 감지 신고 채널 — 연성 축의 신고 채널 (v0.71 conflicts의 쌍둥이).
//
// 핵심 불변식: **신고 자체는 어떤 경로로도 값을 못 바꾼다.** 신고 턴의 changes 밀반입은
// 게이트에 걸러지고, 효과는 "다음 전송 한 번만 낱말 필터 우회"뿐이다. 우회는 낱말 필터
// 한정 — whenArmed(액션 잠금)·갈림길 동결 같은 결정적 잠금은 신고로도 안 열린다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const mk = (extra = {}) => ({
  simcore: '0.1', meta: { name: '감지 실험대' },
  vars: [
    { id: 'injury', label: '부상', type: 'int', init: 0, min: 0, max: 10 },
    { id: 'gold', label: '금화', type: 'int', init: 100, min: 0, max: 9999 },
  ],
  updater: {
    allow: [
      { id: 'injury', maxDelta: 3, mentions: ['부상', '다쳤', '다친'] },
      { id: 'gold', maxDelta: 50 },
    ],
    ...extra,
  },
});
const PARA = '그녀는 계단에서 발을 헛디뎠고, 일어서지 못했다.'; // 부상 계열 낱말 0개
const st = (S) => engine.initState(S);

// ── 프롬프트: 잠김 목록 지시 ──
{
  const S = mk();
  const p = engine.buildAuxPrompt(S, st(S), PARA, null, null);
  ck('★ 낱말 미등장 → 잠김 목록에 label(id)로 실림', p.includes('이번 턴 잠겨 있다: 부상(injury)'), '');
  ck('★ 잠김 목록 지시: detected 보고 + changes 금지', p.includes('"detected" 배열로 보고')
    && p.includes('changes에는 넣지 마라'), '');
  ck('잠긴 변수는 [조정 가능 변수]에는 없다', !p.includes('- injury (부상'), '');
  const p2 = engine.buildAuxPrompt(S, st(S), '전투에서 팔을 다쳤다.', null, null);
  ck('★ 낱말이 등장한 턴에는 잠김 목록에 안 실린다', !p2.includes('이번 턴 잠겨 있다')
    && p2.includes('- injury (부상'), '');
  ck('mentions 없는 변수(gold)는 잠김 목록과 무관', !p.includes('금화(gold)'), '');
  const pAll = engine.buildAuxPrompt(S, st(S), '⟦나중에 채움⟧', null, null, { allowAll: true });
  ck('★ 브리지 굽기(allowAll)에는 잠김 목록 없음', !pAll.includes('이번 턴 잠겨 있다'), '');
  const SOff = mk({ wordDetect: false });
  ck('★ wordDetect:false면 잠김 목록 없음',
    !engine.buildAuxPrompt(SOff, st(SOff), PARA, null, null).includes('이번 턴 잠겨 있다'), '');
}

// ── 파서·정제 ──
{
  const parsed = engine.parseAuxResponse('{"changes":{},"reasons":{},"detected":["injury"]}');
  ck('★ 파서: detected 배열 회수', JSON.stringify(parsed.detected) === '["injury"]', '');
  ck('파서: 배열 아니면 null', engine.parseAuxResponse('{"changes":{},"detected":"injury"}').detected === null, '');
  const S = mk();
  ck('★ 정제: 게이트 없는 변수(gold)·미지 id는 걸러진다',
    JSON.stringify(engine.sanitizeDetected(S, ['injury', 'gold', 'ghost', 'injury'])) === '["injury"]', '');
  ck('정제: 4개 상한 + 문자열만', engine.sanitizeDetected(S, [1, {}, 'injury']).length === 1, '');
}

// ── 핵심 불변식: 신고 턴에는 아무것도 안 변한다 ──
{
  const S = mk();
  const r = engine.outputPhase(S, st(S), { injury: 3 }, {}, {
    rng: () => 0.5, seenText: PARA, detected: ['injury'],
  });
  ck('★ 신고 턴 changes 밀반입은 게이트에 걸러진다 (injury 불변)', r.state.vars.injury === 0, '');
  ck('★ changeLog도 무오염', r.changeLog.every((c) => c.id !== 'injury'), JSON.stringify(r.changeLog));
  ck('★ 해제 표 기록: meta.wordUnlock', JSON.stringify(r.state.meta.wordUnlock) === '{"injury":true}', '');

  // ── 다음 전송: 낱말 없이 열리고, 예외 지시가 붙는다 ──
  const p = engine.buildAuxPrompt(S, r.state, '치료사가 도착했다.', null, null);
  ck('★ 다음 턴: 낱말 없이 [조정 가능 변수]에 열림', p.includes('- injury (부상'), '');
  ck('★ "지난 턴 서사의 변화를 반영하라" 예외 지시', p.includes('지난 턴 감지 신고로 이번 턴만 열렸다'), '');
  ck('열린 턴에는 잠김 목록에 중복으로 안 실린다', !p.includes('이번 턴 잠겨 있다'), '');

  // ── 열린 전송의 적용: 반영되고, 상한도 그대로 ──
  const r2 = engine.outputPhase(S, r.state, { injury: 9 }, { injury: '낙상' }, {
    rng: () => 0.5, seenText: '치료사가 도착했다.',
  });
  ck('★ 열린 턴 적용 + maxDelta 상한 유지 (9 제안 → +3)', r2.state.vars.injury === 3, `${r2.state.vars.injury}`);
  ck('★ 해제 표는 한 전송 뒤 소멸 (신고 없으면 삭제)', r2.state.meta.wordUnlock === undefined, '');
  const p3 = engine.buildAuxPrompt(S, r2.state, PARA, null, null);
  ck('★ 그다음 턴은 다시 잠김 (1회성)', p3.includes('이번 턴 잠겨 있다: 부상(injury)'), '');
}

// ── 결정적 잠금은 신고로 못 연다 ──
{
  const S = mk();
  S.actions = [{ id: 'treat', label: '💊 치료', mode: 'oneshot', effects: [] }];
  S.updater.allow[0].whenArmed = 'treat';
  const s0 = st(S);
  s0.meta.wordUnlock = { injury: true }; // 신고가 통과됐다 치고
  ck('★ whenArmed 잠금은 wordUnlock으로 안 열린다 (액션 미무장)',
    engine.auxAllowList(S, PARA, s0).every((a) => a.id !== 'injury'), '');
  const S2 = mk();
  ck('whenArmed 잠긴 변수는 애초에 잠김 목록(감지 대상)에도 없다',
    (() => { const T = mk(); T.actions = S.actions; T.updater.allow[0].whenArmed = 'treat';
      return !engine.buildAuxPrompt(T, st(T), PARA, null, null).includes('부상(injury)'); })(), '');
  // 소급 경로는 얹기만 — 빈 신고가 기존 해제 표를 안 밟는다
  const prev = st(S2); prev.meta.wordUnlock = { injury: true };
  const am = engine.applyChangesToState(S2, prev, {}, {}, null, null, null, null);
  ck('★ 소급 경로: 빈 신고는 기존 해제 표 보존', JSON.stringify(am.state.meta.wordUnlock) === '{"injury":true}', '');
  const am2 = engine.applyChangesToState(S2, st(S2), {}, {}, null, null, null, ['injury']);
  ck('소급 경로: 신고 얹기 작동', JSON.stringify(am2.state.meta.wordUnlock) === '{"injury":true}', '');
}

// ── 끄기 스위치: 엔진이 신고를 버린다 ──
{
  const S = mk({ wordDetect: false });
  const r = engine.outputPhase(S, st(S), {}, {}, { rng: () => 0.5, seenText: PARA, detected: ['injury'] });
  ck('★ wordDetect:false → 신고가 와도 해제 표 없음', r.state.meta.wordUnlock === undefined, '');
}

// ── 검증·편집기·어댑터 배선 ──
{
  const v = validateSchema(mk({ wordDetect: 'yes' }));
  ck('★ 검증: wordDetect 이상값은 오류', !v.ok && v.errors.some((e) => e.path === '$.updater.wordDetect'), '');
  ck('검증: false는 유효', validateSchema(mk({ wordDetect: false })).ok, '');
  ck('★ 편집기 AI 설정 탭에 감지 신고 토글 (규칙 #3)', src.includes('잠긴 변수 감지 신고')
    && src.includes("schema.updater.wordDetect = on ? undefined : false"), '');
  ck('★ 어댑터: 패널 요약 + 소급 2경로 전달', src.includes('잠긴 변수 감지')
    && (src.match(/parsed\.suggest, parsed\.conflicts, parsed\.detected\)/g) || []).length === 2, '');
  ck('규격서: 안전망 한 줄', src.includes('낱말을 놓쳐도 안전망이 있습니다'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
