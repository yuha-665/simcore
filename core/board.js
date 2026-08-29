// 커뮤니티 보드 (v0.95) — 봇 세계 안의 미니 게시판 (얼터헌터 "헌터넷" 흡수가 발단).
//
// 원본(LightBoard류)은 게시판 원문 전체를 메인 모델이 본문과 함께 출력하고 그게 매턴
// 컨텍스트로 재전송되는 구조였다 — "엄청난 토큰 희생"의 실체. 심코어판의 결정들:
//   · 보드 상태는 state.board (스냅샷에 실려 리롤과 함께 되감긴다) — 메인 출력에 안 싣는다
//   · 턴 갱신은 **기존 보조 호출에 얹는다** (추가 호출 0 — suggest·이미지와 같은 원칙)
//   · 패널 인터랙션(글쓰기·댓글·새로고침)만 채팅 없는 전용 보조 호출
//   · 조회수·추천은 AI가 아니라 시스템이 굴린다 (시드 rng — 숫자는 시스템이)
//   · 메인 모델에는 화제 한 줄만 선택 주입 — 서사가 여론을 아는 통로
//   · ⚠ 자체 구현이다: LightBoard(CC BY-NC-SA)의 코드·저장 포맷과 무관하다.
//
// 스키마 (옵트인):
//   board: { label, icon, topics, guide, postsPerTurn?, maxPosts?, mainInject?, when?, css?,
//            categories? }
//
// 카테고리 (v0.98): categories: ['자유','정보','모집'] — 패널이 탭으로 나뉘고 글마다 cat이
// 붙는다 (어휘 밖은 첫 칸 보정 — 상점 카테고리와 같은 규약). 파티 모집판 같은
// "게시판 안의 게시판"이 필요할 때 쓴다.

const { timeConfig, calendarOf, formatDate } = require('./time');
const { evaluate, truthy } = require('./expr');

const CAPS = {
  TITLE: 60, AUTHOR: 20, BODY: 600, RE_BODY: 200,
  RE_PER_POST: 12, NEW_PER_APPLY_MAX: 4, MAX_POSTS_MIN: 4, MAX_POSTS_MAX: 40,
};
const DEFAULTS = { postsPerTurn: 2, maxPosts: 20 };

function boardConfig(schema) {
  const b = schema?.board;
  if (!b || typeof b !== 'object') return null;
  return {
    label: typeof b.label === 'string' && b.label.trim() ? b.label.trim() : '게시판',
    icon: typeof b.icon === 'string' && b.icon.trim() ? b.icon.trim() : '💬',
    topics: typeof b.topics === 'string' ? b.topics : '',
    guide: typeof b.guide === 'string' ? b.guide : '',
    postsPerTurn: Math.max(0, Math.min(CAPS.NEW_PER_APPLY_MAX, b.postsPerTurn ?? DEFAULTS.postsPerTurn)),
    maxPosts: Math.max(CAPS.MAX_POSTS_MIN, Math.min(CAPS.MAX_POSTS_MAX, b.maxPosts ?? DEFAULTS.maxPosts)),
    mainInject: b.mainInject !== false,
    when: typeof b.when === 'string' ? b.when : '',
    css: typeof b.css === 'string' ? b.css : '',
    categories: Array.isArray(b.categories) && b.categories.length
      ? b.categories.map((c) => String(c).slice(0, 12)).slice(0, 6) : null,
  };
}

/** 카테고리 보정 — 어휘 밖은 첫 칸으로 (상점 cat과 같은 규약). 카테고리 없으면 null */
function normCat(cfg, cat) {
  if (!cfg?.categories) return null;
  const c = cut(cat, 12);
  return cfg.categories.includes(c) ? c : cfg.categories[0];
}

function initBoard() { return { seq: 1, posts: [] }; }

/** reconcile 시점에 부착 — 구세이브·스키마에 나중에 켠 경우 */
function ensureBoard(state) {
  if (!state.board || typeof state.board !== 'object' || !Array.isArray(state.board.posts)) {
    state.board = initBoard();
  }
  if (typeof state.board.seq !== 'number' || !isFinite(state.board.seq)) {
    state.board.seq = 1 + state.board.posts.reduce((m, p) => Math.max(m, p.id || 0), 0);
  }
  return state.board;
}

/** when 게이트 — 닫혀 있으면 이번 턴 생성 요청을 안 싣는다 (열람은 항상 가능) */
function boardOpen(cfg, schema, vars, makeLookup) {
  if (!cfg.when) return true;
  try { return truthy(evaluate(cfg.when, makeLookup(schema, vars), null)); }
  catch { return true; }
}

/** 작중 시각 도장 — 시간 체계가 있으면 날짜, 없으면 턴 번호 */
function stampNow(schema, state) {
  const cfg = timeConfig(schema);
  const epoch = state?.vars?.time_epoch;
  if (cfg && typeof epoch === 'number') {
    return formatDate(cfg.dateFmt, calendarOf(epoch, cfg.calendar));
  }
  return `T${(state?.meta?.turn ?? 0) + 1}`;
}

const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function sanitizeReply(r) {
  if (!r || typeof r !== 'object') return null;
  const body = cut(r.body ?? r.content ?? '', CAPS.RE_BODY);
  if (!body) return null;
  return { author: cut(r.author, CAPS.AUTHOR) || 'ㅇㅇ', body };
}

/** 보조가 준 board 델타를 규격으로 거른다 → { posts:[], replies:[] } */
function sanitizeDelta(raw, cfg) {
  const out = { posts: [], replies: [] };
  if (!raw || typeof raw !== 'object') return out;
  const maxNew = cfg?.postsPerTurn ?? DEFAULTS.postsPerTurn;
  for (const p of Array.isArray(raw.new) ? raw.new : []) {
    if (out.posts.length >= maxNew) break;
    if (!p || typeof p !== 'object') continue;
    const title = cut(p.title, CAPS.TITLE);
    const body = cut(p.body ?? p.content ?? '', CAPS.BODY);
    if (!title || !body) continue;
    out.posts.push({
      title, body,
      cat: normCat(cfg, p.cat),
      author: cut(p.author, CAPS.AUTHOR) || 'ㅇㅇ',
      re: (Array.isArray(p.re) ? p.re : []).map(sanitizeReply).filter(Boolean).slice(0, 5),
    });
  }
  for (const r of Array.isArray(raw.re) ? raw.re : []) {
    if (!r || typeof r !== 'object') continue;
    const id = Number(r.id);
    const replies = (Array.isArray(r.re) ? r.re : []).map(sanitizeReply).filter(Boolean).slice(0, 5);
    if (!isFinite(id) || !replies.length) continue;
    out.replies.push({ id, re: replies });
  }
  return out;
}

/**
 * 델타 적용 + 지표 표류. 상태를 제자리 수정한다 (outputPhase의 clone 뒤에서 불린다).
 * @returns { added, replied } 적용 통계
 */
function applyDelta(schema, state, rawDelta, { rng } = {}) {
  const cfg = boardConfig(schema);
  if (!cfg) return { added: 0, replied: 0 };
  const board = ensureBoard(state);
  const delta = sanitizeDelta(rawDelta, cfg);
  const now = stampNow(schema, state);
  const r = rng || (() => 0.5);
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));

  // 기존 글 반응
  let replied = 0;
  for (const rep of delta.replies) {
    const post = board.posts.find((p) => p.id === rep.id);
    if (!post) continue;
    const room = CAPS.RE_PER_POST - post.re.length;
    if (room <= 0) continue;
    post.re.push(...rep.re.slice(0, room));
    replied += Math.min(rep.re.length, room);
    post.up += ri(0, 2); // 댓글이 붙는 글은 눈에 띈다
  }
  // 새 글 — 최신이 위
  for (const p of delta.posts.reverse()) {
    board.posts.unshift({
      id: board.seq++, title: p.title, author: p.author, time: now,
      views: ri(3, 40), up: ri(0, 3), body: p.body, re: p.re,
      ...(p.cat ? { cat: p.cat } : {}),
    });
  }
  // 지표 표류 — 최근 글일수록 많이 돈다 (숫자는 시스템이. AI가 아니라)
  board.posts.forEach((p, i) => {
    p.views += Math.max(0, ri(0, 9 - Math.min(i, 8)));
    if (r() < 0.15) p.up += 1;
  });
  // 보존 상한 — 오래된 글부터 내려간다
  if (board.posts.length > cfg.maxPosts) board.posts.length = cfg.maxPosts;
  return { added: delta.posts.length, replied };
}

/** 유저가 패널에서 쓴 글 — 즉시 등록, 반응은 보조 호출이 이어 받는다. 반환: 글 id */
function applyUserPost(schema, state, { title, author, body, cat }) {
  const board = ensureBoard(state);
  const cfg = boardConfig(schema) || {};
  const nc = normCat(cfg, cat);
  const post = {
    id: board.seq++,
    title: cut(title, CAPS.TITLE) || '(제목 없음)',
    author: cut(author, CAPS.AUTHOR) || 'ㅇㅇ',
    time: stampNow(schema, state),
    views: 1, up: 0,
    body: cut(body, CAPS.BODY),
    re: [],
    ...(nc ? { cat: nc } : {}),
  };
  board.posts.unshift(post);
  if (cfg.maxPosts && board.posts.length > cfg.maxPosts) board.posts.length = cfg.maxPosts;
  return post.id;
}

/** 유저가 단 댓글 — 즉시 부착. 반환: 성공 여부 */
function applyUserComment(state, postId, { author, body }) {
  const board = ensureBoard(state);
  const post = board.posts.find((p) => p.id === postId);
  if (!post || post.re.length >= CAPS.RE_PER_POST) return false;
  const rep = sanitizeReply({ author, body });
  if (!rep) return false;
  post.re.push(rep);
  return true;
}

/** 보조 프롬프트용 현황 요약 — 최근 8개, 본문은 앞머리만 */
function digest(state, n = 8) {
  const posts = state?.board?.posts || [];
  if (!posts.length) return '(게시판이 비어 있다)';
  return posts.slice(0, n).map((p) =>
    `#${p.id}${p.cat ? ` [${p.cat}]` : ''} "${p.title}" — ${p.author}, 추천${p.up}, 댓글${p.re.length}: ${cut(p.body, 60)}`).join('\n');
}

/** 턴 갱신 요청 — 기존 보조 호출에 얹는 지시 (추가 호출 0) */
function auxSpec(schema, state, makeLookup) {
  const cfg = boardConfig(schema);
  if (!cfg) return '';
  if (!boardOpen(cfg, schema, state.vars, makeLookup)) return '';
  return [
    '',
    `[${cfg.label} — 세계 안의 커뮤니티 게시판] (선택 항목)`,
    '현재 게시판:',
    digest(state),
    `- 이번 턴 서사에 게시판이 반응할 만한 일이 있으면 "board" 필드로 새 글 0~${cfg.postsPerTurn}개("new")와 기존 글에 붙는 댓글("re")을 내라. 반응할 일이 없으면 board 필드를 아예 넣지 마라.`,
    cfg.topics ? `- 게시판의 관심사: ${cfg.topics}` : null,
    cfg.categories ? `- 새 글마다 "cat"을 달아라 — 다음 중에서만: ${cfg.categories.join(' | ')}.` : null,
    cfg.guide ? `- ${cfg.guide}` : null,
    '- 글·댓글은 그 커뮤니티 말투 그대로. 게시판 사용자들은 주인공을 전지적으로 알지 못한다 — 목격담·소문·공개 정보 수준까지만.',
    '- 조회수·추천수는 시스템이 계산하니 쓰지 마라.',
    `- board 형식: {"new":[{"title":"제목","author":"닉네임"${cfg.categories ? ',"cat":"칸"' : ''},"body":"본문","re":[{"author":"닉","body":"댓글"}]}],"re":[{"id":글번호,"re":[{"author":"닉","body":"댓글"}]}]}`,
  ].filter((x) => x !== null).join('\n');
}

/** 메인 프롬프트 화제 한 줄 — 서사가 여론을 아는 유일한 통로 */
function mainLine(schema, state) {
  const cfg = boardConfig(schema);
  if (!cfg || !cfg.mainInject) return null;
  const posts = state?.board?.posts || [];
  if (!posts.length) return null;
  const tops = posts.slice(0, 2).map((p) => `"${cut(p.title, 40)}"`).join(', ');
  return `[${cfg.label}] 지금 게시판의 화제: ${tops} — 등장인물들이 이 화제를 알고 있을 수 있다. 게시판 원문을 본문에 옮겨 적지 마라.`;
}

/** 패널 인터랙션 전용 프롬프트 — 채팅 없이 보조만 부른다. 출력은 {"board":{...}} 하나 */
function interactionPrompt(schema, state, kind, payload = {}) {
  const cfg = boardConfig(schema);
  if (!cfg) return null;
  const head = [
    `너는 "${cfg.label}" 게시판 시뮬레이터다. 아래 게시판 현황을 보고 요청된 갱신만 JSON으로 출력하라.`,
    cfg.topics ? `게시판의 관심사: ${cfg.topics}` : null,
    cfg.categories ? `새 글마다 "cat"을 달아라 — 다음 중에서만: ${cfg.categories.join(' | ')}.` : null,
    cfg.guide ? cfg.guide : null,
    '글·댓글은 그 커뮤니티 말투 그대로. 사용자들은 주인공을 전지적으로 알지 못한다 — 목격담·소문·공개 정보 수준까지만. 조회수·추천수는 쓰지 마라.',
    '',
    '[게시판 현황]',
    digest(state, 10),
    payload.narrative ? '' : null,
    payload.narrative ? '[최근 이야기 맥락]' : null,
    payload.narrative ? String(payload.narrative).slice(0, 2400) : null,
    '',
  ];
  const fmt = `출력 형식 (JSON만, 다른 텍스트 금지): {"board":{"new":[{"title","author"${cfg.categories ? ',"cat"' : ''},"body","re":[{"author","body"}]}],"re":[{"id":글번호,"re":[{"author","body"}]}]}}`;
  let task;
  if (kind === 'user_post') {
    task = [
      `[방금 등록된 글] #${payload.postId}${payload.cat ? ` [${payload.cat}]` : ''} "${cut(payload.title, CAPS.TITLE)}" — ${cut(payload.author, CAPS.AUTHOR) || 'ㅇㅇ'}`,
      cut(payload.body, CAPS.BODY),
      '',
      `- 이 글에 대한 다른 사용자들의 댓글 반응을 0~5개 만들어 "re"의 id ${payload.postId}로 담아라 (반응 수는 글의 화제성에 비례).`,
      '- 필요하면 파생 글 0~1개를 "new"로 추가해도 된다. 방금 등록된 글 자체를 "new"로 다시 만들지 마라.',
    ].join('\n');
  } else if (kind === 'user_comment') {
    task = [
      `[방금 달린 댓글] #${payload.postId} 글에 — ${cut(payload.author, CAPS.AUTHOR) || 'ㅇㅇ'}: ${cut(payload.body, CAPS.RE_BODY)}`,
      '',
      `- 이 댓글에 이어지는 다른 사용자들의 반응 0~3개를 "re"의 id ${payload.postId}로 담아라 (없어도 된다 — 그땐 빈 board).`,
    ].join('\n');
  } else { // refresh
    task = `- 시간이 조금 흐른 게시판의 새 소식을 만들어라: 새 글 1~${Math.max(1, cfg.postsPerTurn)}개("new")와 기존 글 댓글 반응("re") 약간. 이야기 맥락과 게시판 관심사에 맞게.`;
  }
  return [...head, task, '', fmt].filter((x) => x !== null).join('\n');
}

/** 인터랙션 응답 파싱 — {"board":{...}}만 회수 (관대) */
function parseInteraction(text, extractJsonObject) {
  const obj = extractJsonObject(text, 'board');
  return obj?.board ?? null;
}

module.exports = {
  CAPS, boardConfig, initBoard, ensureBoard, boardOpen, stampNow, normCat,
  sanitizeDelta, applyDelta, applyUserPost, applyUserComment,
  digest, auxSpec, mainLine, interactionPrompt, parseInteraction,
};
