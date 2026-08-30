// 메신저 (v1.2.0) — 헌터 단말기형 1:1/단체 문자 (유저 제안: "헌터넷 소스를 살려서
// 연락처 교환한 상대와 문자를 주고받는 메신저").
//
// 보드(board.js) 인프라의 이식이지만 결정들이 다르다:
//   · 방은 **유저만 판다** (패널에서 연락처 골라서) — AI가 방을 만들거나 없애지 않는다
//   · 연락처 풀 = contactsVar(list 변수, 얼헌은 동료 명부 allies) — "파티를 맺을 정도면
//     연락처는 안다" (유저 결정: 별도 연락처 변수 없이 파티 축과 같이 움직인다)
//   · 선톡: 매턴 확률(시드 해시 — 리롤 안정) + 방별 쿨다운으로 상대가 먼저 문자를 보낼
//     수 있다 — 그 턴만 보조 요청에 얹힘 (평턴 비용 0)
//   · **핵심: 활성 방 하나만 메인 프롬프트에 실린다** (유저 설계). 비활성 방은 순수
//     패널 전용 대화 — 서사는 모른다. 토큰 문제를 구조로 풀었다.
//   · 패널 발신(답장 생성)은 채팅 턴 없는 전용 보조 호출 — 인격 컨텍스트(로어북 발췌
//     persona + notesVar 델타)를 실어야 "누구세요" 답장을 막는다 (품질 리스크의 본체)
//
// 스키마 (옵트인):
//   messenger: { contactsVar(필수), label?, icon?, notesVar?, firstChance?, cooldown?,
//                guide?, when?, css? }
//
// 상태: state.msgr = { seq, active, rooms: [{ id, kind:'dm'|'group', name, members,
//   msgs: [{from('me'=주인공), body, time}], unread, lastIn }] } — 스냅샷에 실려
//   리롤과 함께 되감긴다 (⚠ 리롤하면 그 턴의 패널 대화도 되감김 — 보드와 같은 규약).

const { stampNow } = require('./board');
const { evaluate, truthy } = require('./expr');

const CAPS = {
  DM_MAX: 5, GROUP_MAX: 2, GROUP_MEMBERS: 4,     // 단체방 NPC 4 + 유저 = 파티 5인 캡
  MSGS_PER_ROOM: 60, MSG_LEN: 300, ROOM_NAME: 20,
  IN_PER_TURN: 3, INJECT_N: 10, INJECT_LEN: 120,
};
const DEFAULTS = { firstChance: 0.25, cooldown: 3 };

function msgrConfig(schema) {
  const m = schema?.messenger;
  if (!m || typeof m !== 'object') return null;
  if (typeof m.contactsVar !== 'string' || !m.contactsVar) return null;
  return {
    label: typeof m.label === 'string' && m.label.trim() ? m.label.trim() : '메신저',
    icon: typeof m.icon === 'string' && m.icon.trim() ? m.icon.trim() : '📱',
    contactsVar: m.contactsVar,
    notesVar: typeof m.notesVar === 'string' && m.notesVar ? m.notesVar : null,
    firstChance: (typeof m.firstChance === 'number' && m.firstChance >= 0 && m.firstChance <= 1)
      ? m.firstChance : DEFAULTS.firstChance,
    cooldown: Number.isInteger(m.cooldown) && m.cooldown >= 0 && m.cooldown <= 20
      ? m.cooldown : DEFAULTS.cooldown,
    guide: typeof m.guide === 'string' ? m.guide : '',
    when: typeof m.when === 'string' ? m.when : '',
    css: typeof m.css === 'string' ? m.css : '',
  };
}

function initMsgr() { return { seq: 1, active: null, rooms: [] }; }

/** reconcile 시점에 부착 — 구세이브·스키마에 나중에 켠 경우 */
function ensureMsgr(state) {
  if (!state.msgr || typeof state.msgr !== 'object' || !Array.isArray(state.msgr.rooms)) {
    state.msgr = initMsgr();
  }
  if (typeof state.msgr.seq !== 'number' || !isFinite(state.msgr.seq)) {
    state.msgr.seq = 1 + state.msgr.rooms.reduce((m, r) => Math.max(m, r.id || 0), 0);
  }
  return state.msgr;
}

/** when 게이트 — 닫히면 선톡·발신이 멈춘다 (게이트 안 통신 두절). 열람은 항상 가능 */
function msgrOpen(cfg, schema, vars, makeLookup) {
  if (!cfg.when) return true;
  try { return truthy(evaluate(cfg.when, makeLookup(schema, vars), null)); }
  catch { return true; }
}

const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** 연락처 풀 — contactsVar(list)의 이름들. 방 파기의 유일한 근거 */
function contacts(cfg, state) {
  const v = state?.vars?.[cfg.contactsVar];
  return Array.isArray(v) ? v.map((x) => cut(x, CAPS.ROOM_NAME)).filter(Boolean) : [];
}

/**
 * 방 생성 — 유저 전용 (패널 경로). AI는 방을 만들지 않는다.
 * @returns {ok, id} | {ok:false, reason}
 */
function createRoom(cfg, state, { kind, members, name }) {
  const msgr = ensureMsgr(state);
  const k = kind === 'group' ? 'group' : 'dm';
  const ms = [...new Set((Array.isArray(members) ? members : [])
    .map((x) => cut(x, CAPS.ROOM_NAME)).filter(Boolean))];
  const pool = contacts(cfg, state);
  const outsider = ms.find((m) => !pool.includes(m));
  if (outsider) return { ok: false, reason: `'${outsider}'은(는) 연락처에 없어요 — 연락처는 ${cfg.contactsVar} 목록과 함께 움직입니다` };
  if (k === 'dm') {
    if (ms.length !== 1) return { ok: false, reason: '1:1 방은 상대 한 명을 골라 주세요' };
    if (msgr.rooms.filter((r) => r.kind === 'dm').length >= CAPS.DM_MAX) {
      return { ok: false, reason: `1:1 방은 최대 ${CAPS.DM_MAX}개예요 — 안 쓰는 방을 나가 주세요` };
    }
    if (msgr.rooms.some((r) => r.kind === 'dm' && r.members[0] === ms[0])) {
      return { ok: false, reason: `${ms[0]}와의 방이 이미 있어요` };
    }
  } else {
    if (ms.length < 2 || ms.length > CAPS.GROUP_MEMBERS) {
      return { ok: false, reason: `단체방은 상대 2~${CAPS.GROUP_MEMBERS}명이에요 (본인 포함 ${CAPS.GROUP_MEMBERS + 1}인 — 파티 정원과 같음)` };
    }
    if (msgr.rooms.filter((r) => r.kind === 'group').length >= CAPS.GROUP_MAX) {
      return { ok: false, reason: `단체방은 최대 ${CAPS.GROUP_MAX}개예요` };
    }
  }
  const room = {
    id: msgr.seq++, kind: k,
    name: cut(name, CAPS.ROOM_NAME) || (k === 'dm' ? ms[0] : ms.join('·').slice(0, CAPS.ROOM_NAME)),
    members: ms, msgs: [], unread: 0, lastIn: null,
  };
  msgr.rooms.push(room);
  return { ok: true, id: room.id };
}

/** 방 나가기 — 대화가 통째로 사라진다 (유저 확인은 패널 몫) */
function leaveRoom(state, roomId) {
  const msgr = ensureMsgr(state);
  const i = msgr.rooms.findIndex((r) => r.id === roomId);
  if (i < 0) return false;
  msgr.rooms.splice(i, 1);
  if (msgr.active === roomId) msgr.active = null;
  return true;
}

/** 활성 방 지정 — **하나만** (다음 인풋에 그 대화가 서사로 전달된다). null = 전부 비활성 */
function setActive(state, roomId) {
  const msgr = ensureMsgr(state);
  msgr.active = (roomId != null && msgr.rooms.some((r) => r.id === roomId)) ? roomId : null;
  return msgr.active;
}

/** 방 열람 — 안읽음 소거 (패널이 방을 그릴 때 부른다) */
function markRead(state, roomId) {
  const room = ensureMsgr(state).rooms.find((r) => r.id === roomId);
  if (room) room.unread = 0;
}

function pushMsg(schema, state, room, from, body) {
  room.msgs.push({ from, body, time: stampNow(schema, state) });
  if (room.msgs.length > CAPS.MSGS_PER_ROOM) room.msgs.splice(0, room.msgs.length - CAPS.MSGS_PER_ROOM);
}

/** 주인공 발신 — 즉시 등록 (답장은 전용 보조 호출이 이어 받는다) */
function userMsg(schema, state, roomId, body) {
  const room = ensureMsgr(state).rooms.find((r) => r.id === roomId);
  const b = cut(body, CAPS.MSG_LEN);
  if (!room || !b) return false;
  pushMsg(schema, state, room, 'me', b);
  return true;
}

/**
 * 보조가 준 msgr 델타 적용 — [{id, msgs:[{from, body}]}]. 턴 피기백(선톡)과 패널 답장이
 * 같은 규격. from은 그 방 멤버만 (주인공 'me' 위조·비멤버는 버림). 상태 제자리 수정.
 */
function applyDelta(schema, state, rawDelta) {
  const cfg = msgrConfig(schema);
  if (!cfg || !Array.isArray(rawDelta)) return { received: 0 };
  const msgr = ensureMsgr(state);
  let received = 0;
  for (const d of rawDelta) {
    if (!d || typeof d !== 'object') continue;
    const room = msgr.rooms.find((r) => r.id === Number(d.id));
    if (!room) continue;
    let n = 0;
    for (const m of Array.isArray(d.msgs) ? d.msgs : []) {
      if (n >= CAPS.IN_PER_TURN) break;
      const from = cut(m?.from, CAPS.ROOM_NAME);
      const body = cut(m?.body, CAPS.MSG_LEN);
      if (!body || !room.members.includes(from)) continue;   // 'me'·비멤버 위조 차단
      pushMsg(schema, state, room, from, body);
      n++;
    }
    if (n) {
      received += n;
      room.lastIn = state?.meta?.turn ?? 0;
      if (msgr.active !== room.id) room.unread += n;
    }
  }
  return { received };
}

/** 시드 해시 [0,1) — Math.random 금지 지대 (리롤 안정). 같은 턴 = 같은 결과 */
function hash01(...parts) {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** 이번 턴 선톡이 뜰 방 — 쿨다운 지난 방 중 확률에 든 것 하나 (턴당 최대 1방). null 가능 */
function firstContactRoom(cfg, state) {
  const msgr = state?.msgr;
  if (!msgr?.rooms?.length || !cfg.firstChance) return null;
  const turn = state?.meta?.turn ?? 0;
  const hits = msgr.rooms
    .filter((r) => r.lastIn == null || (turn - r.lastIn) >= cfg.cooldown)
    .map((r) => ({ r, h: hash01('first', turn, r.id, r.name) }))
    .filter((x) => x.h < cfg.firstChance)
    .sort((a, b) => a.h - b.h);
  return hits.length ? hits[0].r : null;
}

const tail = (room, n, len = 80) => room.msgs.slice(-n)
  .map((m) => `${m.from === 'me' ? '나' : m.from}: "${cut(m.body, len)}"`).join(' / ');

/** 턴 갱신 요청 — 선톡이 뜬 턴만 기존 보조 호출에 얹는다 (평턴 비용 0) */
function auxSpec(schema, state, makeLookup) {
  const cfg = msgrConfig(schema);
  if (!cfg) return '';
  if (!msgrOpen(cfg, schema, state.vars, makeLookup)) return '';
  const room = firstContactRoom(cfg, state);
  if (!room) return '';
  return [
    '',
    `[${cfg.label} — 주인공의 단말기] (선택 항목)`,
    `- 이번 턴, "${room.name}" 방(멤버: ${room.members.join(', ')})의 상대가 주인공에게 먼저 메시지를 보낼 자연스러운 순간이다. 서사 흐름상 어색하면 안 보내도 된다.`,
    room.msgs.length ? `- 이 방의 최근 대화: ${tail(room, 5)}` : '- 이 방은 아직 대화가 없다 — 첫 연락이다.',
    cfg.guide ? `- ${cfg.guide}` : null,
    `- msgr 형식: {"msgr":[{"id":${room.id},"msgs":[{"from":"이름","body":"내용"}]}]} — 1~${CAPS.IN_PER_TURN}통, 문자 말투로 짧게. from은 멤버 이름만.`,
  ].filter((x) => x !== null).join('\n');
}

/**
 * 메인 프롬프트 주입 — **활성 방 하나만** (유저 설계의 핵심: 토큰은 유저가 고른 방만 쓴다).
 * 비활성 방 대화는 서사가 모른다 (순수 패널 전용).
 */
function mainLine(schema, state) {
  const cfg = msgrConfig(schema);
  if (!cfg) return null;
  const msgr = state?.msgr;
  const room = msgr?.rooms?.find((r) => r.id === msgr.active);
  if (!room || !room.msgs.length) return null;
  const lines = room.msgs.slice(-CAPS.INJECT_N)
    .map((m) => `  ${m.from === 'me' ? '나' : m.from}: ${cut(m.body, CAPS.INJECT_LEN)}`);
  return [
    `[${cfg.label}] 주인공이 단말기로 나눈 최근 대화 — "${room.name}"${room.kind === 'group' ? ` (단체방: ${room.members.join(', ')})` : ''}:`,
    ...lines,
    '— 이 대화는 이미 오간 사실이다. 서사에 자연스럽게 반영하되, 원문을 본문에 옮겨 적지 마라.',
  ].join('\n');
}

/**
 * 패널 발신 답장 프롬프트 — 전용 보조 호출 (채팅 턴 소모 없음).
 * payload.persona = 어댑터가 로어북에서 발췌한 인물 정보 (품질 리스크 대응의 본체),
 * payload.narrative = 최근 서사 맥락. notesVar 델타는 여기서 직접 붙인다.
 */
function interactionPrompt(schema, state, roomId, payload = {}) {
  const cfg = msgrConfig(schema);
  const room = state?.msgr?.rooms?.find((r) => r.id === roomId);
  if (!cfg || !room) return null;
  // notesVar("이름 — 변화" 꼴 list) — 방 멤버 것만 발췌
  const notes = cfg.notesVar && Array.isArray(state.vars?.[cfg.notesVar])
    ? state.vars[cfg.notesVar].filter((x) => room.members.some((m) => String(x).includes(m)))
    : [];
  return [
    `너는 "${cfg.label}" 메신저 시뮬레이터다. 주인공이 방금 "${room.name}" 방에 메시지를 보냈다. 상대의 답장만 JSON으로 출력하라.`,
    `방 멤버 (주인공 제외): ${room.members.join(', ')}`,
    payload.persona ? `[인물 정보 — 이 말투와 설정 그대로]\n${String(payload.persona).slice(0, 2800)}` : null,
    notes.length ? `[인물 최근 변화] ${notes.slice(0, 8).join(' · ')}` : null,
    cfg.guide ? cfg.guide : null,
    payload.narrative ? `[최근 이야기 맥락]\n${String(payload.narrative).slice(0, 1600)}` : null,
    '',
    '[이 방의 최근 대화]',
    tail(room, 15, CAPS.MSG_LEN) || '(첫 대화)',
    '',
    `- 답장 1~${CAPS.IN_PER_TURN}통${room.kind === 'group' ? ' — 단체방이니 말할 사람만 말한다 (전원 답장 강제 아님)' : ''}. from은 멤버 이름 중에서만.`,
    '- 문자 말투로 짧게. 즉답이 어색한 상황(전투 중, 새벽)이면 뜸 들인 한 통이나 짧은 반응도 좋다.',
    '- 상대는 주인공을 전지적으로 알지 못한다 — 직접 겪었거나 들은 것까지만.',
    `출력 형식 (JSON만, 다른 텍스트 금지): {"msgr":[{"id":${room.id},"msgs":[{"from":"이름","body":"내용"}]}]}`,
  ].filter((x) => x !== null).join('\n');
}

/** 인터랙션 응답 파싱 — {"msgr":[...]}만 회수 (관대) */
function parseInteraction(text, extractJsonObject) {
  const obj = extractJsonObject(text, 'msgr');
  return Array.isArray(obj?.msgr) ? obj.msgr : null;
}

module.exports = {
  CAPS, msgrConfig, initMsgr, ensureMsgr, msgrOpen, contacts,
  createRoom, leaveRoom, setActive, markRead, userMsg,
  applyDelta, firstContactRoom, auxSpec, mainLine, interactionPrompt, parseInteraction,
};
