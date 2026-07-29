const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.37 mentions — 이번 턴 글에 이름이 나온 변수만 보조 모델에게 연다 (로어북 키워드와 같은 방식)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');

let pass = 0, fail = 0;
const ck = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, '→', got); } };
const eq = (n, got, want) => ck(n, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

const S = {
  simcore: '0.1', meta: { name: 'mentions' },
  vars: [
    { id: 'gold', label: '재정', type: 'int', init: 100, min: 0, max: 9999 },
    { id: 'b_livia', label: '리비아', type: 'int', init: 0, min: -50, max: 100 },
    { id: 'b_liana', label: '리아나', type: 'int', init: 0, min: -50, max: 100 },
    { id: 'b_liliana', label: '릴리아나', type: 'int', init: 0, min: -50, max: 100 },
    { id: 'b_noface', label: '무명', type: 'int', init: 0, min: -50, max: 100 },
  ],
  derived: [], rules: { onTurn: [], events: [] },
  statusUI: { mode: 'auto', groups: [] }, setup: { presets: [] },
  updater: { model: 'aux', allow: [
    { id: 'gold', maxDelta: 500 },
    { id: 'b_livia', maxDelta: 8, mentions: true },
    { id: 'b_liana', maxDelta: 8, mentions: true },
    { id: 'b_liliana', maxDelta: 8, mentions: true },
    { id: 'b_noface', maxDelta: 8, mentions: ['무명', '얼굴 없는 자'] },
  ], guide: 'g' },
};
ck('mentions 쓰는 스키마 검증 통과', validateSchema(S).ok, JSON.stringify(validateSchema(S).errors));

const open = (t) => engine.auxAllowList(S, t).map((a) => a.id);

// ── 기본 ──
{
  eq('아무도 안 나오면 mentions 변수는 전부 닫힌다', open('남작은 곳간을 둘러보았다.'), ['gold']);
  eq('★ 이름이 나온 사람만 열린다', open('리비아가 장부를 들고 왔다.'), ['gold', 'b_livia']);
  eq('mentions 없는 변수는 늘 열려 있다', open('').includes('gold'), true);
  eq('★ text가 null이면 아예 안 거른다 (구버전 호환)', engine.auxAllowList(S, null).length, S.updater.allow.length);
  eq('낱말 배열은 아무거나 걸리면 열린다', open('얼굴 없는 자가 문을 두드렸다.'), ['gold', 'b_noface']);
}

// ── ★ 한국어 이름 겹침 — 여기가 이 기능의 진짜 시험대 ──
// "릴리아나" 안에 "리아나"가 있고, 조사가 붙어 단어 경계도 못 쓴다.
{
  eq('★ 긴 이름이 짧은 이름을 가린다', open('릴리아나가 서찰을 보냈다.'), ['gold', 'b_liliana']);
  eq('★ 짧은 이름 단독은 그대로 걸린다', open('리아나 백작이 왔다.'), ['gold', 'b_liana']);
  eq('★ 둘 다 나오면 둘 다', open('릴리아나와 리아나 백작이 함께 왔다.'), ['gold', 'b_liana', 'b_liliana']);
  eq('가려진 자리가 하나라도 안 가려지면 걸린다', open('릴리아나. 그리고 리아나.'), ['gold', 'b_liana', 'b_liliana']);
}

// ── ★ 안 열어 준 변수는 받지도 않는다 ──
// 프롬프트에 안 실었는데 적용은 해 주면 거르는 의미가 없다.
{
  const st = engine.initState(S);
  const narr = '리비아가 장부를 들고 왔다.';
  const changes = { b_livia: 5, b_liliana: 5, gold: 10 };

  const filtered = engine.applyChangesToState(S, st, changes, {}, narr);
  eq('★ 등장한 사람의 변화는 받는다', filtered.state.vars.b_livia, 5);
  eq('★ 등장 안 한 사람의 변화는 버린다', filtered.state.vars.b_liliana, 0);
  eq('mentions 없는 변수는 그대로', filtered.state.vars.gold, 110);

  const unfiltered = engine.applyChangesToState(S, st, changes, {});
  eq('글을 안 주면 예전처럼 전부 받는다', unfiltered.state.vars.b_liliana, 5);
}

// ── 프롬프트와 적용이 같은 기준을 보는가 ──
{
  const st = engine.initState(S);
  const narr = '릴리아나가 서찰을 보냈다.';
  const p = engine.buildAuxPrompt(S, st, narr, '', '');
  ck('★ 프롬프트에 안 실린 이름', !p.includes('- b_livia') && p.includes('- b_liliana'),
    (p.match(/^- b_\w+/gm) || []).join(' '));
  const r = engine.applyChangesToState(S, st, { b_livia: 5 }, {}, narr);
  ck('★ 프롬프트에 없던 변수는 적용도 안 된다', r.state.vars.b_livia === 0, String(r.state.vars.b_livia));
}

// ── 루아 브리지: 자리표시자로 굽는 템플릿은 거르면 안 된다 ──
{
  const st = engine.initState(S);
  const baked = engine.buildAuxPrompt(S, st, '⟦NARR⟧', '⟦USER⟧', '', { allowAll: true });
  ck('★ allowAll이면 mentions 변수가 전부 실린다',
    ['b_livia', 'b_liana', 'b_liliana', 'b_noface'].every((id) => baked.includes('- ' + id)),
    (baked.match(/^- b_\w+/gm) || []).join(' '));
  const gated = engine.buildAuxPrompt(S, st, '⟦NARR⟧', '⟦USER⟧', '');
  ck('allowAll 없이 구우면 통째로 닫힌다 (그래서 브리지는 켜야 한다)',
    !/^- b_/m.test(gated), (gated.match(/^- b_\w+/gm) || []).join(' '));
}

// ── 검증 ──
{
  const bad = (m) => { const B = JSON.parse(JSON.stringify(S)); B.updater.allow[1].mentions = m; return validateSchema(B); };
  ck('빈 문자열 mentions 거부', !bad('').ok, '');
  ck('빈 배열 mentions 거부', !bad([]).ok, '');
  ck('한 글자는 경고', bad('리').warnings.some((w) => /한 글자/.test(w.msg)), JSON.stringify(bad('리').warnings));

  const N = JSON.parse(JSON.stringify(S));
  N.vars[1].label = '';
  ck('label 없이 mentions:true는 거부', !validateSchema(N).ok, '');

  // v0.44.1 — 낱말 집합이 완전히 같은 변수들은 "인물 묶음"으로 보고 묶음당 경고 1줄로 접는다.
  // (실전: 입주자 8명 × 수치 6개 봇에서 인물당 수십 줄, 총 147줄이 쏟아져 오류를 가렸다)
  const D = JSON.parse(JSON.stringify(S));
  D.updater.allow[2].mentions = ['리비아'];              // b_livia와 같은 낱말 집합
  D.updater.allow[3].mentions = ['리비아'];              // 셋이 같은 집합이어도 —
  const dv = validateSchema(D);
  const clusterWarns = dv.warnings.filter((w) => /같이 씁니다/.test(w.msg));
  ck('★ 똑같은 낱말 집합은 묶음당 경고 1줄 (3개 변수 = 1줄)', clusterWarns.length === 1, JSON.stringify(dv.warnings));
  ck('묶음 경고가 변수 수를 밝힌다', clusterWarns.some((w) => /3개 변수/.test(w.msg)), JSON.stringify(clusterWarns));
  ck('묶음 경고에 "묶음이면 정상" 안내', clusterWarns.some((w) => /묶음이면 정상/.test(w.msg)), '');

  // 서로 다른 묶음에 걸친 낱말 — 이 낱말 하나가 남의 묶음까지 열므로 진짜 겹침으로 경고
  const X = JSON.parse(JSON.stringify(S));
  X.updater.allow[4].mentions = ['무명', '리비아'];       // b_noface가 리비아의 낱말을 침범
  const xv = validateSchema(X);
  ck('★ 묶음 경계를 넘는 낱말은 경고', xv.warnings.some((w) => /걸쳐 있습니다/.test(w.msg)), JSON.stringify(xv.warnings));

  // 겹치는 이름은 가려짐으로 처리되므로 경고하지 않는다 (릴리아나 ⊃ 리아나)
  ck('겹치는 이름은 경고하지 않는다', !validateSchema(S).warnings.some((w) => /안에 들어/.test(w.msg)),
    JSON.stringify(validateSchema(S).warnings));
}

// ── 편집기 배선 (v0.38.1) ──
// 엔진에 있어도 칸이 없으면 JSON을 손으로 고치는 수밖에 없다 (v0.35의 cmd와 같은 사고).
// AI 설정 탭은 규격 내보내기도 없으므로 여기가 유일한 입력 경로다.
{
  const tab = src.slice(src.indexOf('function tabAi()'), src.indexOf('// ── 탭: JSON'));
  ck('★ 허용 변수 행에 [등장할 때만] 체크가 있다', tab.includes("'등장할 때만'"));
  ck('★ 낱말 칸이 있다 (쉼표로 여러 개)', /pair\('낱말'/.test(tab));
  ck('켜고 비우면 true — 변수 이름을 낱말로 쓴다', tab.includes('a.mentions = keys.length ? keys : true'));
  ck('끄면 필드가 삭제된다', tab.includes('else delete a.mentions'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
