const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.7.2 — 게시판 사생활 누출 + 삭제/비우기 (실기 제보).
//
// 제보: "스토커 붙은 것마냥 자유 게시판에 자꾸 누가 내 행동을 라이브로 중계한다.
//        우리 파티끼리만 들어가서 사냥 중인데 생중계되고, 협회에서 마나 스캔 중에
//        나눈 대화까지 어디서 들었다며 올라온다."
//
// 뿌리: 자율형 지시문의 "이번 턴 서사와 닿는 글은 … 최대 1개"가 **상시 허가**로 읽혔다.
// 모델은 허가를 초대로 받아 매턴 1개씩 썼고, 그게 쌓여 실시간 중계가 됐다.
// → 원칙을 뒤집는다: 주인공 글감은 금지가 기본, 공개 목격만 예외. 못 쓸 자리를 이름으로 못박고,
//   "어떻게 알았는지 답할 수 없으면 쓰지 마라"는 출처 규칙을 공통 줄에 추가.
//
// 그리고 이미 오염된 게시판을 치우는 수단: 글 삭제(묘비) · 게시판 비우기.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const B = SC.require('board');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const S = {
  simcore: '0.1', meta: { name: '게시판' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50 }],
  board: { label: '헌터넷', postsPerTurn: [4, 5], maxPosts: 20, mainInject: true,
    categories: ['자유', '정보'] },
  statusUI: { mode: 'auto', groups: [] },
};
const st = engine.initState(S); st.meta.setupDone = true;

// ── ① 지시문 — 사생활 누출을 구조로 막는다 ──
const spec = B.auxSpec(S, st, engine.makeLookup);
ck('★ 주인공 글감은 금지가 원칙 (허가가 아니다)',
  spec.includes('주인공 일행과 무관한 것이 원칙') && spec.includes('글감으로 삼지 마라'), spec.slice(0, 200));
ck('★ 못 쓸 자리를 이름으로 못박음 (닫힌 공간·1:1·비공개 절차)',
  spec.includes('닫힌 공간') && spec.includes('1:1 대화') && spec.includes('절차상 비공개'), '');
ck('★ 실시간 중계 자체를 오답으로 명시', spec.includes('실시간 중계처럼') && spec.includes('감시하지 않는다'), '');
ck('★ 출처 규칙 — 어떻게 알았는지 답할 수 없으면 쓰지 마라',
  spec.includes('어떻게 알았는지'), '');
ck('공개 목격 예외는 남아 있다 (세계가 주인공을 아주 모르진 않는다)',
  spec.includes('불특정 다수가 있는 공개 장소'), '');

// ── ② 삭제 — 자리는 남고 내용만 지워진다 ──
B.applyDelta(S, st, { new: [
  { title: '사냥 후기', body: '오늘 게이트 다녀옴', author: 'ㅇㅇ', re: [{ author: 'ㄱㄱ', body: '고생' }, { author: 'ㄴㄴ', body: 'ㅋㅋ' }] },
  { title: '남길 글', body: '이건 남는다', author: 'ㅁㅁ' },
] }, {});
const [p1, p2] = [st.board.posts[0], st.board.posts[1]];
const idKeep = p2.id, id1 = p1.id, time1 = p1.time;
ck('전제 — 글 2개 · 댓글 2개', st.board.posts.length === 2 && p1.re.length === 2, '');

ck('★ 삭제 — 번호·시각은 남고 내용만 비워진다', (() => {
  const okDel = B.deletePost(st, id1);
  const p = st.board.posts.find((x) => x.id === id1);
  return okDel && p && p.del === true && p.id === id1 && p.time === time1 && !p.title && !p.body;
})(), JSON.stringify(st.board.posts[0]).slice(0, 120));
ck('딸린 댓글도 함께 묘비 (원글 없는 댓글은 없다)',
  st.board.posts.find((x) => x.id === id1).re.every((r) => r.del === true && !r.body), '');
ck('두 번 지워지지 않는다', B.deletePost(st, id1) === false, '');
ck('남긴 글은 그대로', st.board.posts.find((x) => x.id === idKeep).title === '남길 글', '');

// ── ③ 지워진 글은 보조·서사에서 사라진다 (다시 물지 않게) ──
ck('★ digest에서 빠짐 — 보조가 묘비를 못 본다',
  !B.digest(st).includes('사냥 후기') && B.digest(st).includes('남길 글'), B.digest(st));
ck('★ mainLine 화제에서도 빠짐', !String(B.mainLine(S, st) || '').includes('사냥 후기'), String(B.mainLine(S, st)));
ck('묘비엔 유저 댓글이 안 붙는다', B.applyUserComment(st, id1, { author: 'ㅇ', body: '?' }) === false, '');
const before = st.board.posts.find((x) => x.id === id1).re.length;
B.applyDelta(S, st, { re: [{ id: id1, re: [{ author: 'AI', body: '보조 댓글' }] }] }, {});
ck('묘비엔 보조 댓글도 안 붙는다', st.board.posts.find((x) => x.id === id1).re.length === before, '');

// ── ④ 댓글 하나만 삭제 ──
const keep = st.board.posts.find((x) => x.id === idKeep);
B.applyUserComment(st, idKeep, { author: '나', body: '지울 댓글' });
B.applyUserComment(st, idKeep, { author: '나', body: '남길 댓글' });
ck('★ 댓글 개별 삭제 — 그 자리만 묘비', (() => {
  const okDel = B.deleteReply(st, idKeep, 0);
  return okDel && keep.re[0].del === true && !keep.re[0].body && keep.re[1].body === '남길 댓글';
})(), JSON.stringify(keep.re));
ck('같은 댓글 두 번 삭제 안 됨', B.deleteReply(st, idKeep, 0) === false, '');

// ── ⑤ 비우기 — 통째로. 번호는 이어 간다 ──
const seqBefore = st.board.seq;
const wiped = B.resetBoard(st);
ck('★ 비우기 — 글이 통째로 사라짐 (묘비도 없음)', wiped === 2 && st.board.posts.length === 0, String(wiped));
ck('★ 번호는 되돌리지 않는다 (겹치면 댓글이 엉뚱한 글에 붙는다)', st.board.seq === seqBefore, `${st.board.seq} vs ${seqBefore}`);
B.applyDelta(S, st, { new: [{ title: '새 글', body: 'x', author: 'ㅇㅇ' }] }, {});
ck('비운 뒤 새 글은 새 번호로', st.board.posts[0].id >= seqBefore, String(st.board.posts[0].id));

// ── ⑥ 어댑터 배선 (정적) ──
ck('패널: 글 삭제 두 번 누르기', src.includes("boardDelArm === post.id ? '🗑 한 번 더 누르면 삭제' : '🗑 글 삭제'"), '');
ck('패널: 비우기 두 번 누르기', src.includes("boardWipeArm ? '🧹 한 번 더 누르면 비웁니다' : '🧹 비우기'"), '');
ck('패널: 묘비 문구', src.includes("'삭제된 게시글입니다'") && src.includes("'삭제된 댓글입니다'"), '');
ck('패널: 삭제된 글엔 댓글 입력·버튼 없음',
  src.includes('if (!post.del) card.appendChild(ci);') && src.includes("if (!post.del) bar2.appendChild(btn('댓글 달기'"), '');

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
