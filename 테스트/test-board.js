const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.95 — 커뮤니티 보드: 세계 안의 미니 게시판 (얼터헌터 헌터넷 흡수).
//
// 불변식:
//   · 보드 상태는 state.board — 스냅샷에 실려 리롤과 함께 되감긴다 (pre 스냅샷 재현)
//   · 턴 갱신은 기존 보조 호출에 얹힘 ("board" 필드) — 별도 호출 없음
//   · 조회수·추천은 시스템이 굴린다 (시드 rng → 리롤 안정)
//   · 메인에는 화제 한 줄만 — 게시판 원문은 promptBlock에 절대 실리지 않는다
//   · when 게이트가 닫히면 생성 요청이 빠진다 (열람은 별개)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const board = SC.require('board');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

const S = {
  simcore: '0.1', meta: { name: '보드봇' },
  time: { start: '2026-03-02 08:00', advance: 'explicit', expose: ['date', 'elapsed'] },
  vars: [
    { id: 'skip_day', label: '흐른 날', type: 'int', init: 0, min: 0, max: 14 },
    { id: 'in_gate', label: '게이트 안', type: 'bool', init: false },
    { id: 'fame', label: '명성', type: 'int', init: 0, min: 0, max: 100 },
  ],
  derived: [],
  updater: { allow: [{ id: 'fame', maxDelta: 10 }, { id: 'skip_day', maxGain: 14 }, { id: 'in_gate' }] },
  board: {
    label: '헌터넷', icon: '🌐', topics: '게이트 소식, 헌터 소문', guide: '익명 말투',
    postsPerTurn: 2, maxPosts: 6, when: 'not in_gate',
  },
};

// ── 검증 ──
{
  const v = validateSchema(S);
  ck('★ 정상 스키마 통과', v.ok, J(v.errors));
  const bad = JSON.parse(J(S)); bad.board.postsPerTurn = 9;
  ck('postsPerTurn 범위 오류', !validateSchema(bad).ok, '');
  const bad2 = JSON.parse(J(S)); bad2.board.when = 'ghost_var > 0';
  ck('when 미지 변수 오류', !validateSchema(bad2).ok, '');
  const warn = JSON.parse(J(S)); delete warn.board.topics; delete warn.board.guide;
  const vw = validateSchema(warn);
  ck('topics·guide 둘 다 없으면 경고', vw.ok && vw.warnings.some((w) => w.path === '$.board'), J(vw.warnings));
}

const fresh = () => { const t = engine.initState(S); t.meta.setupDone = true; return t; };
const turn = (st, changes = {}, opts = {}, i = 0) => {
  const send = engine.sendPhase(S, st, { rng: seededRng('b', i, 's') });
  const out = engine.outputPhase(S, send.state, changes, {}, { rng: seededRng('b', i, 'o'), ...opts });
  return { st: out.state, prompt: send.promptBlock };
};

// ── 초기화·부착 ──
{
  const t = fresh();
  ck('★ 보드가 상태에 부착', t.board && Array.isArray(t.board.posts) && t.board.seq === 1, J(t.board));
  const noBoard = { ...S }; delete noBoard.board;
  const t2 = engine.initState(noBoard);
  ck('board 없는 스키마엔 안 붙음', t2.board === undefined, '');
}

// ── 델타 적용 (턴 갱신 경로) ──
{
  let t = fresh();
  const delta = {
    new: [
      { title: '동북권에 D급 떴다는데?', author: '고인물', body: '협회 앱 알림 옴. 위치 아는 사람?', re: [{ author: 'ㅇㅇ', body: '노원쪽이라던데' }] },
      { title: '오늘 시세 왜 이럼', body: '마정석 또 떨어짐' },
      { title: '상한 초과분', body: '이건 잘려야 함' },
    ],
    re: [{ id: 999, re: [{ author: 'x', body: '없는 글' }] }],
  };
  ({ st: t } = turn(t, {}, { board: delta }, 1));
  ck('★ 새 글 2건 (postsPerTurn 캡)', t.board.posts.length === 2, String(t.board.posts.length));
  ck('★ 최신 글이 맨 위 + id 부여', t.board.posts[0].id === 2 && t.board.posts[1].id === 1,
    J(t.board.posts.map((p) => p.id)));
  ck('작중 날짜 도장', t.board.posts[0].time === '2026-03-02', t.board.posts[0].time);
  ck('없는 글 반응은 무시', !t.board.posts.some((p) => p.re.some((r) => r.body === '없는 글')), '');
  ck('시드 지표 — 조회수 양수', t.board.posts.every((p) => p.views > 0), J(t.board.posts.map((p) => p.views)));
  // 순서 규약: new[]의 첫 항목이 맨 위(가장 최신, 가장 큰 id)에 온다
  ck('익명 기본 닉', t.board.posts.find((p) => p.id === 2).author === '고인물'
    && t.board.posts.find((p) => p.id === 1).author === 'ㅇㅇ', '');

  // 기존 글 반응 + 날짜 진행 도장
  ({ st: t } = turn(t, { skip_day: 1 }, { board: { re: [{ id: 2, re: [{ author: '헌터A', body: '방금 지나감' }] }] } }, 2));
  const p2 = t.board.posts.find((p) => p.id === 2);
  ck('★ 기존 글에 댓글 부착', p2.re.length === 2 && p2.re[1].author === '헌터A', J(p2.re));
  ({ st: t } = turn(t, {}, { board: { new: [{ title: '다음날 글', body: '어제 그 게이트 정리됨' }] } }, 3));
  ck('★ 새 날짜 도장 (skip 소비 후)', t.board.posts[0].time === '2026-03-03', t.board.posts[0].time);
}

// ── 보존 상한 (maxPosts 6) ──
{
  let t = fresh();
  for (let i = 0; i < 5; i++) {
    ({ st: t } = turn(t, {}, { board: { new: [{ title: `글${i}a`, body: 'x' }, { title: `글${i}b`, body: 'y' }] } }, 10 + i));
  }
  // new[]의 첫 항목이 맨 위 규약 — 마지막 턴의 '글4a'가 최상단
  ck('★ 상한 6 유지 + 최신 생존', t.board.posts.length === 6 && t.board.posts[0].title === '글4a',
    `${t.board.posts.length} ${t.board.posts[0]?.title}`);
}

// ── when 게이트 + 프롬프트 계약 ──
{
  const t = fresh();
  const aux = engine.buildAuxPrompt(S, t, '서사', null);
  ck('★ 보조 프롬프트에 보드 요청 실림', aux.includes('헌터넷') && aux.includes('"board"'), '');
  ck('관심사·지침 실림', aux.includes('게이트 소식') && aux.includes('익명 말투'), '');
  t.vars.in_gate = true;
  const aux2 = engine.buildAuxPrompt(S, t, '서사', null);
  ck('★ when 닫히면 보드 요청 빠짐', !aux2.includes('"board"'), '');
  // 게이트 안에서 델타가 와도… 적용은 된다 (게이트는 "요청"의 문 — 방어는 프롬프트 계약)
  ck('파싱 — board 필드 통과', engine.parseAuxResponse('{"changes":{},"reasons":{},"board":{"new":[{"title":"t","body":"b"}]}}').board != null, '');
}

// ── 메인 주입 — 화제 한 줄뿐, 원문 금지 ──
{
  let t = fresh();
  ({ st: t } = turn(t, {}, { board: { new: [{ title: '길드 스카웃 후기', body: '비밀 본문 내용 12345' }] } }, 20));
  const { prompt } = turn(t, {}, {}, 21);
  ck('★ 화제 한 줄 주입', prompt.includes('[헌터넷]') && prompt.includes('길드 스카웃 후기'), '');
  ck('★ 게시판 본문은 메인에 안 실림', !prompt.includes('비밀 본문 내용'), '');
  // 빈 보드면 그 줄 자체가 없다
  const { prompt: p0 } = turn(fresh(), {}, {}, 22);
  ck('빈 보드 — 화제 줄 없음', !p0.includes('[헌터넷]'), '');
}

// ── 유저 인터랙션 (패널 경로) ──
{
  const t = fresh();
  const id = board.applyUserPost(S, t, { title: '  내가 쓴 글  ', author: '', body: '본문' });
  ck('★ 유저 글 즉시 등록 + 익명 기본', t.board.posts[0].id === id && t.board.posts[0].author === 'ㅇㅇ'
    && t.board.posts[0].title === '내가 쓴 글', J(t.board.posts[0]));
  ck('★ 유저 댓글 부착', board.applyUserComment(t, id, { author: '닉', body: '댓글' })
    && t.board.posts[0].re.length === 1, '');
  ck('없는 글 댓글 거부', board.applyUserComment(t, 999, { author: '', body: 'x' }) === false, '');
  const ip = board.interactionPrompt(S, t, 'user_post', { postId: id, title: '내가 쓴 글', author: '', body: '본문', narrative: '맥락' });
  ck('★ 인터랙션 프롬프트 — 글 id·맥락·형식', ip.includes(`id ${id}`) && ip.includes('맥락') && ip.includes('{"board"'), '');
  const parsed = board.parseInteraction('앞잡담 {"board":{"re":[{"id":' + id + ',"re":[{"author":"a","body":"b"}]}]}} 뒷잡담', engine.extractJsonObject);
  ck('인터랙션 응답 관대 파싱', parsed && parsed.re[0].id === id, J(parsed));
}

// ── 리롤 되감기 — pre 스냅샷 재현 (세션 규약) ──
{
  const { SimSession } = SC.require('session');
  const { MapBackend } = (() => {
    // store.js의 MapBackend가 export 안 돼 있으면 즉석 구현 (Map 기반)
    try { const st = SC.require('store'); if (st.MapBackend) return st; } catch {}
    class MB { constructor() { this.m = new Map(); } async get(k) { return this.m.get(k) ?? null; }
      async set(k, v) { this.m.set(k, v); } async remove(k) { this.m.delete(k); }
      async keys() { return [...this.m.keys()]; } }
    return { MapBackend: MB };
  })();
  (async () => {
    const ses = new SimSession(S, new MapBackend(), { chatId: 'c1' });
    await ses.init(-1);
    ses.current.meta.setupDone = true;
    await ses.onSend(0);
    await ses.onOutput(1, '{"changes":{},"reasons":{},"board":{"new":[{"title":"1턴 글","body":"x"}]}}');
    const afterFirst = J(ses.current.board.posts.map((p) => p.title));
    await ses.onSend(2);
    await ses.onOutput(3, '{"changes":{},"reasons":{},"board":{"new":[{"title":"2턴 글","body":"y"}]}}');
    ck('2턴 뒤 글 2건', ses.current.board.posts.length === 2, J(ses.current.board.posts.map((p) => p.title)));
    // 리롤: 같은 sendIndex로 다시 — pre:2 스냅샷 기준이라 "2턴 글"이 사라진 상태에서 재생성
    await ses.onSend(2);
    ck('★ 리롤 — 보드가 pre 시점으로 되감김', J(ses.current.board.posts.map((p) => p.title)) === afterFirst,
      J(ses.current.board.posts.map((p) => p.title)));
    await ses.onOutput(3, '{"changes":{},"reasons":{},"board":{"new":[{"title":"2턴 다른 글","body":"z"}]}}');
    ck('★ 리롤 후 새 델타로 재구성', ses.current.board.posts[0].title === '2턴 다른 글'
      && ses.current.board.posts.length === 2, J(ses.current.board.posts.map((p) => p.title)));

    let p = 0, f = 0;
    for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
    console.log(`\n${p} passed, ${f} failed`);
    process.exit(f ? 1 : 0);
  })();
}
