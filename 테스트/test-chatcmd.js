const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.35 채팅 명령 — 배포받은 유저가 패널 없이 상태를 고치는 통로
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
  simcore: '0.1', meta: { name: '명령' },
  vars: [
    { id: 'day', label: '경과일', type: 'int', init: 12, min: 0 },
    { id: 'gold', label: '재정', type: 'int', init: 100, min: 0, max: 9999, cmd: '금' },
    { id: 'deals', label: '지속 수입', type: 'list', init: [], maxItems: 5, itemMaxLength: 40, cmd: '계약' },
    { id: 'note', label: '메모', type: 'text', init: '', maxLength: 20, cmd: '메모' },
    { id: 'mode', label: '모드', type: 'enum', enum: ['영지', '왕궁'], init: '영지', cmd: '판' },
    { id: 'plain', label: '명령없음', type: 'int', init: 0 },
  ],
  derived: [{ id: 'income', label: '수입', expr: 'sum(deals)' }],
  rules: { onTurn: [{ list: 'deals', expire: 'day + 1' }], events: [] },
  statusUI: { mode: 'auto', groups: [] }, setup: { presets: [] },
};
ck('cmd 쓰는 스키마 검증 통과', validateSchema(S).ok, JSON.stringify(validateSchema(S).errors));

const st = engine.initState(S);
const run = (text, base) => engine.applyChatCommands(S, base ? { vars: base } : st, text);

// ── 목록 등록/제거 ──
{
  const r = run('/계약 헤세 상단 양모 +12');
  eq('목록 등록', r.vars.deals, ['헤세 상단 양모 +12']);
  eq('★ 명령 줄이 확인 문구로 바뀐다', r.text, '(시스템: 지속 수입 등록 — 헤세 상단 양모 +12)');
  const r2 = run('/계약- 헤세 상단 양모 +12', { ...st.vars, deals: ['헤세 상단 양모 +12', '제분소 5'] });
  eq('목록 제거', r2.vars.deals, ['제분소 5']);
}
// ── ★ 제거는 앞머리만 쳐도 찾는다 ──
// 유저는 항목을 글자까지 외우고 있지 않고, `@1093` 같은 건 시스템이 굳힌 값이라 알 방법도 없다.
// 완전일치만 받던 시절엔 사람이 목록에서 아무것도 못 지웠다.
{
  const 목록 = ['헤세 상단 양모 +12 @1093', '제분소 5', '헤세 상단 아마 +6'];
  const rm = (t) => run(t, { ...st.vars, deals: [...목록] });
  eq('★ 앞머리만 쳐도 지워진다', rm('/계약- 헤세 상단 양모').vars.deals,
    ['제분소 5', '헤세 상단 아마 +6']);
  eq('★ 지워진 항목을 통째로 되돌려 준다', rm('/계약- 제분소').text,
    '(시스템: 지속 수입 제거 — 제분소 5)');
  eq('가운데 토막으로도 찾는다', rm('/계약- 양모').vars.deals, ['제분소 5', '헤세 상단 아마 +6']);
  const many = rm('/계약- 헤세 상단');
  ck('★ 여럿 걸리면 안 지우고 후보를 보여준다', many.vars.deals.length === 3
    && many.text.includes('여럿이 걸립니다') && many.text.includes('헤세 상단 아마 +6'), many.text);
  eq('여럿 걸리면 적용 0건', many.applied.length, 0);
}
// ★ 상대 기한이 유저 입력에서도 굳는다 (day 12 + expire식 'day + 1' = 13)
{
  const r = run('/계약 3년 대여 @+1080 +20');
  eq('★ 유저가 친 @+1080도 절대값으로', r.vars.deals, ['3년 대여 @1093 +20']);
}
// ── 숫자: 부호 있으면 증감, 없으면 지정 ──
{
  eq('증감 (+)', run('/금 +500').vars.gold, 600);
  eq('증감 (-)', run('/금 -30').vars.gold, 70);
  eq('지정 (부호 없음)', run('/금 250').vars.gold, 250);
  eq('min 아래로는 안 간다', run('/금 -9999').vars.gold, 0);
  eq('max 위로도 안 간다', run('/금 99999').vars.gold, 9999);
  eq('숫자가 아니면 명령 아님', run('/금 사백원').text, '/금 사백원');
}
// ── 텍스트 / enum ──
{
  eq('텍스트 지정', run('/메모 우물 파는 중').vars.note, '우물 파는 중');
  eq('maxLength 적용', run('/메모 ' + '가'.repeat(40)).vars.note.length, 20);
  eq('enum 지정', run('/판 왕궁').vars.mode, '왕궁');
  eq('★ enum 밖은 왜 거부됐는지 알려준다', run('/판 지하실').text, "(시스템: 모드 — '지하실' 거부됨, 영지 | 왕궁 중 하나여야 함)");
}
// ── 유저 글을 잡아먹지 않는가 (가장 중요) ──
{
  eq('★ 모르는 명령은 그대로', run('/공격 고블린을 친다').text, '/공격 고블린을 친다');
  eq('★ cmd 없는 변수는 명령이 안 된다', run('/plain +5').text, '/plain +5');
  eq('★ 슬래시 없는 평문', run('계약을 맺자고 했다').text, '계약을 맺자고 했다');
  eq('★ 문장 중간의 슬래시', run('그는 계약/합의를 원했다').text, '그는 계약/합의를 원했다');
  eq('빈 인자 목록은 명령 아님', run('/계약').text, '/계약');
  const mixed = run('남작은 상단과 만났다.\n/계약 헤세 상단 양모 +12\n그리고 밤이 깊었다.');
  eq('★ 명령 줄만 바뀌고 서사는 남는다', mixed.text,
    '남작은 상단과 만났다.\n(시스템: 지속 수입 등록 — 헤세 상단 양모 +12)\n그리고 밤이 깊었다.');
  eq('적용 1건', mixed.applied.length, 1);
}
// ── 한 메시지에 여러 명령 ──
{
  const r = run('/금 +500\n/메모 성벽 보수\n/계약 제분소 5');
  eq('세 개 동시 적용', [r.vars.gold, r.vars.note, r.vars.deals], [600, '성벽 보수', ['제분소 5']]);
  eq('applied 3건', r.applied.length, 3);
}
// ── 값이 안 바뀌면 알려준다 (조용히 삼키지 않는다) ──
{
  const r = run('/계약- 없는계약');
  eq('없는 항목 제거는 왜 안 됐는지 알려준다', r.text, "(시스템: 지속 수입 — '없는계약'와 맞는 항목이 없음)");
  eq('적용 0건', r.applied.length, 0);
}
// ── cmd 검증 ──
const bad = (cmd) => {
  const B = JSON.parse(JSON.stringify(S));
  B.vars[1].cmd = cmd;
  return validateSchema(B);
};
ck('공백 든 cmd 거부', !bad('내 금').ok, '');
ck("'-' 든 cmd 거부", !bad('금-').ok, '');
ck('빈 cmd 거부', !bad('').ok, '');
{
  const D = JSON.parse(JSON.stringify(S));
  D.vars[2].cmd = '금';                       // gold와 중복
  const v = validateSchema(D);
  ck('중복 cmd 거부', !v.ok && v.errors.some((e) => /중복된 cmd/.test(e.msg)), JSON.stringify(v.errors));
}
// ── cmd가 하나도 없으면 아무 일도 안 한다 ──
{
  const N = JSON.parse(JSON.stringify(S));
  for (const v of N.vars) delete v.cmd;
  const r = engine.applyChatCommands(N, engine.initState(N), '/금 +500');
  eq('cmd 없는 스키마는 통과', r.text, '/금 +500');
}

// ── ★ 명령 모음집 — 유저가 "이 봇에 무슨 명령이 있나"를 아는 유일한 통로 ──
// 명령 이름은 제작자가 정하므로, 이 목록이 없으면 유저는 명령의 존재조차 모른다.
{
  const specs = engine.commandSpecs(S);
  eq('cmd 붙은 변수만 나온다', specs.map((s) => s.cmd), ['금', '계약', '메모', '판']);
  ck('★ 문법은 변수 타입이 정한다 — 목록은 등록/제거 두 줄',
    specs[1].usage.length === 2 && specs[1].usage[0][0] === '/계약 내용' && specs[1].usage[1][0] === '/계약- 내용 일부',
    JSON.stringify(specs[1].usage));
  ck('숫자는 증감/지정 두 줄', specs[0].usage.length === 2 && specs[0].usage[0][0] === '/금 +5', JSON.stringify(specs[0].usage));
  ck('★ enum은 선택지를 그대로 보여준다', specs[3].usage[0][0] === '/판 영지 / 왕궁', specs[3].usage[0][0]);
  ck('라벨을 쓴다 (id 아님)', specs[1].label === '지속 수입', specs[1].label);
  {
    const N = JSON.parse(JSON.stringify(S));
    for (const v of N.vars) delete v.cmd;
    eq('명령이 없으면 빈 목록', engine.commandSpecs(N), []);
  }
}

// ── ★ 상태창 {commands} 자리표시자 ──
{
  const { renderStatusHtml } = SC.require('render');
  const T = JSON.parse(JSON.stringify(S));
  T.statusUI = { mode: 'template', templates: [{ id: 'main', template: '<div>재정 {gold}</div>{commands}' }] };
  const html = renderStatusHtml(T, engine.initState(T));
  ck('★ 자리표시자가 명령 목록으로 바뀐다', html.includes('sim-cmds') && html.includes('/계약- 내용 일부'), html.slice(0, 200));
  ck('네 가지라고 세어 준다', html.includes('명령 4가지'), '');
  ck('평소엔 AI가 한다는 걸 먼저 말한다', html.includes('서사가 알아서 반영'), '');
  ck('★ 미치환 자리표시자가 안 남는다', !/\{commands\}/.test(html), '');
  // ★ <code>는 리스 메시지 렌더의 마크다운/테마 CSS가 자기 색을 먹인다. 배경만 칠해 둔 칩에
  //   그 색이 얹히면 배경과 겹쳐 글자가 통째로 사라진다 — 실제로 그렇게 났다.
  ck('★ 채팅에 나가는 상태창에 <code>를 쓰지 않는다', !/<code[\s>]/.test(html), (html.match(/<code[^>]*>/) || [''])[0]);
  ck('★ 배경을 칠한 칩은 글자색도 정한다', /\.sim-cmd-syntax\{[^}]*color:inherit/.test(SC.require('render').BASE_CSS),
    (SC.require('render').BASE_CSS.match(/\.sim-cmd-syntax\{[^}]*\}/) || [''])[0]);

  // 안 박으면 안 나온다 — 제작자가 자리와 노출을 정한다
  const T2 = JSON.parse(JSON.stringify(T));
  T2.statusUI.templates[0].template = '<div>재정 {gold}</div>';
  ck('★ 자리표시자를 안 박으면 안 나온다', !renderStatusHtml(T2, engine.initState(T2)).includes('sim-cmds'), '');

  // 그룹 모드는 배치를 플러그인이 정하므로 자동으로 붙는다
  const G = JSON.parse(JSON.stringify(S));
  G.statusUI = { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'gold' }] }] };
  ck('그룹 모드는 자동으로 붙는다', renderStatusHtml(G, engine.initState(G)).includes('sim-cmds'), '');

  // 명령이 없는 봇에 자리표시자만 박힌 경우 — 빈 껍데기가 남으면 안 된다
  const E0 = JSON.parse(JSON.stringify(T));
  for (const v of E0.vars) delete v.cmd;
  const h0 = renderStatusHtml(E0, engine.initState(E0));
  ck('★ 명령이 없으면 껍데기도 안 그린다', !h0.includes('sim-cmds') && !/\{commands\}/.test(h0), '');
}

// ── 'commands'라는 변수를 만들면 자리표시자를 가린다 ──
{
  const C = JSON.parse(JSON.stringify(S));
  C.vars.push({ id: 'commands', label: '겹침', type: 'int', init: 0 });
  const v = validateSchema(C);
  ck('★ 이름이 겹치면 경고한다', v.warnings.some((w) => /commands/.test(w.msg)), JSON.stringify(v.warnings));
  ck('경고일 뿐 막지는 않는다', v.ok, JSON.stringify(v.errors));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
