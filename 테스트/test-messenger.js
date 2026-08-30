const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.2.0 — 메신저: 단말기 문자 (유저 제안: "연락처 교환한 상대와 문자를 주고받는 메신저").
//
// 불변식:
//   · 방은 유저만 판다 — 연락처 풀(contactsVar)에 있는 인물과만. AI는 방을 못 만든다
//   · 1:1 최대 5방, 단체방 최대 2방 (NPC 4 + 유저 = 파티 5인 캡)
//   · **활성 방 하나만** 메인 프롬프트에 실린다 — 비활성 방은 순수 패널 전용 (서사가 모름)
//   · 선톡은 시드 해시 (Math.random 금지) — 같은 턴 = 같은 결과 (리롤 안정)
//   · 방·대화는 state.msgr — 스냅샷에 실려 리롤과 함께 되감긴다
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const msgr = SC.require('messenger');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

const S = {
  simcore: '0.1', meta: { name: '단말기봇' },
  vars: [
    { id: 'allies', label: '동료', type: 'list', init: ['김민수', '서지한', '이하늘', '정예린', '박도윤', '최강토', '한서라'], maxItems: 12 },
    { id: 'npc_notes', label: '인물 변화', type: 'list', init: [], maxItems: 12 },
    { id: 'in_gate', label: '게이트 안', type: 'bool', init: false },
    { id: 'fame', label: '명성', type: 'int', init: 0, min: 0, max: 100 },
  ],
  derived: [],
  updater: { allow: [{ id: 'fame', maxDelta: 10 }] },
  messenger: {
    label: '단말기', icon: '📱', contactsVar: 'allies', notesVar: 'npc_notes',
    firstChance: 0.25, cooldown: 3, guide: '짧은 문자 말투', when: 'not in_gate',
  },
};

// ── 어댑터 정적 확인 ──
{
  // 버전 단언은 test-bundle이 원본 — 여기선 모듈 동봉만 본다 (패치 범프마다 두 곳 고치지 않게)
  ck('messenger 모듈 번들 동봉', src.includes('SimCore.define("messenger"'), '');
  ck('패널 배선 — renderMsgrPanel + gameKind msgr', src.includes('renderMsgrPanel(root)')
    && src.includes("gameKind === 'msgr'"), '');
  ck('유틸 버튼 — msgrConfig가 있는 봇만', src.includes("specs.push({ key: 'msgr'"), '');
  ck('선톡 턴 출력 상한 가산', src.includes("auxPrompt.includes('먼저 메시지를 보낼')"), '');
  ck('지연 경로에서도 msgr 적용', src.includes('parsed.msgr && msgrMod.msgrConfig(schema)'), '');
  ck('로어북 persona 발췌 (품질 리스크 대응)', src.includes('buildMsgrPersona'), '');
  ck('나가기 두 번 누르기 (규칙 #6)', src.includes('confirmLeave'), '');
  ck('css 체인에 messenger', src.includes("gameKind === 'msgr' ? schema?.messenger?.css"), '');
}

// ── 검증 ──
{
  const v = validateSchema(S);
  ck('★ 정상 스키마 통과', v.ok, J(v.errors));
  const bad = JSON.parse(J(S)); bad.messenger.contactsVar = 'ghost';
  ck('없는 연락처 변수 오류', !validateSchema(bad).ok, '');
  const bad2 = JSON.parse(J(S)); bad2.messenger.contactsVar = 'fame';
  ck('연락처가 list 아니면 오류', !validateSchema(bad2).ok, '');
  const bad3 = JSON.parse(J(S)); bad3.messenger.firstChance = 2;
  ck('선톡 확률 범위 오류', !validateSchema(bad3).ok, '');
  const warn = JSON.parse(J(S)); delete warn.messenger.guide;
  ck('guide 없으면 경고', validateSchema(warn).warnings.some((w) => w.path === '$.messenger'), '');
}

const cfg = msgr.msgrConfig(S);
const fresh = () => { const t = engine.initState(S); t.meta.setupDone = true; return t; };

// ── 방 생성 — 유저 전용, 연락처·개수 캡 ──
{
  const t = fresh();
  ck('★ 메신저가 상태에 부착', t.msgr && Array.isArray(t.msgr.rooms) && t.msgr.seq === 1, J(t.msgr));
  ck('연락처 밖 인물 거부', !msgr.createRoom(cfg, t, { kind: 'dm', members: ['외부인'] }).ok, '');
  const r1 = msgr.createRoom(cfg, t, { kind: 'dm', members: ['김민수'] });
  ck('★ 1:1 생성 — 방 이름 = 상대', r1.ok && t.msgr.rooms[0].name === '김민수', J(t.msgr.rooms[0]));
  ck('같은 상대 중복 방 거부', !msgr.createRoom(cfg, t, { kind: 'dm', members: ['김민수'] }).ok, '');
  for (const n of ['서지한', '이하늘', '정예린', '박도윤']) msgr.createRoom(cfg, t, { kind: 'dm', members: [n] });
  ck('★ 1:1 최대 5개 — 6번째 거부', !msgr.createRoom(cfg, t, { kind: 'dm', members: ['최강토'] }).ok, '');
  const g1 = msgr.createRoom(cfg, t, { kind: 'group', members: ['김민수', '서지한'], name: '레이드방' });
  ck('★ 단체방 생성 (상대 2~4명)', g1.ok, J(g1));
  ck('상대 5명 거부 (본인 포함 5인 캡)', !msgr.createRoom(cfg, t,
    { kind: 'group', members: ['김민수', '서지한', '이하늘', '정예린', '박도윤'] }).ok, '');
  msgr.createRoom(cfg, t, { kind: 'group', members: ['이하늘', '정예린'] });
  ck('★ 단체방 최대 2개 — 3번째 거부', !msgr.createRoom(cfg, t, { kind: 'group', members: ['김민수', '이하늘'] }).ok, '');
  ck('방 나가기 — 대화째 소멸', msgr.leaveRoom(t, g1.id) && !t.msgr.rooms.some((r) => r.id === g1.id), '');
}

// ── 발신·답장 델타 — from 위조 차단, 안읽음, 롤링 ──
{
  const t = fresh();
  const { id } = msgr.createRoom(cfg, t, { kind: 'dm', members: ['김민수'] });
  ck('★ 유저 발신 즉시 등록', msgr.userMsg(S, t, id, '  내일 게이트 갈래?  ')
    && t.msgr.rooms[0].msgs[0].body === '내일 게이트 갈래?', J(t.msgr.rooms[0].msgs));
  const r = msgr.applyDelta(S, t, [{ id, msgs: [
    { from: '김민수', body: 'ㅇㅋ' },
    { from: 'me', body: '주인공 위조' },
    { from: '외부인', body: '비멤버' },
    { from: '김민수', body: '몇 시?' },
  ] }]);
  ck('★ 멤버만 통과 (me·비멤버 위조 차단)', r.received === 2
    && t.msgr.rooms[0].msgs.every((m) => m.from === 'me' || m.from === '김민수'), J(t.msgr.rooms[0].msgs));
  ck('★ 비활성 방 안읽음 +2', t.msgr.rooms[0].unread === 2, String(t.msgr.rooms[0].unread));
  msgr.markRead(t, id);
  ck('열람 — 안읽음 소거', t.msgr.rooms[0].unread === 0, '');
  msgr.setActive(t, id);
  msgr.applyDelta(S, t, [{ id, msgs: [{ from: '김민수', body: '활성 중 수신' }] }]);
  ck('활성 방 수신은 안읽음 안 쌓임', t.msgr.rooms[0].unread === 0, '');
  for (let i = 0; i < 70; i++) msgr.userMsg(S, t, id, `채우기 ${i}`);
  ck('★ 방당 60개 롤링', t.msgr.rooms[0].msgs.length === 60
    && t.msgr.rooms[0].msgs[59].body === '채우기 69', String(t.msgr.rooms[0].msgs.length));
  ck('없는 방 델타 무시', msgr.applyDelta(S, t, [{ id: 999, msgs: [{ from: '김민수', body: 'x' }] }]).received === 0, '');
}

// ── 활성 방 주입 — 유저 설계의 핵심 ──
{
  const t = fresh();
  const { id } = msgr.createRoom(cfg, t, { kind: 'dm', members: ['김민수'] });
  msgr.userMsg(S, t, id, '비밀 대화 원문 42');
  msgr.applyDelta(S, t, [{ id, msgs: [{ from: '김민수', body: '답장 원문 43' }] }]);
  const pb0 = engine.sendPhase(S, t, { rng: seededRng('i', 1, 's') }).promptBlock;
  ck('★ 비활성 — 서사가 대화를 모른다', !pb0.includes('비밀 대화 원문') && !pb0.includes('답장 원문'), '');
  msgr.setActive(t, id);
  const pb1 = engine.sendPhase(S, t, { rng: seededRng('i', 2, 's') }).promptBlock;
  ck('★ 활성 — 대화 원문 + 반영 지시', pb1.includes('[단말기]') && pb1.includes('비밀 대화 원문 42')
    && pb1.includes('답장 원문 43') && pb1.includes('원문을 본문에 옮겨 적지 마라'), '');
  msgr.setActive(t, null);
  ck('비활성 전환 — 다시 조용', !engine.sendPhase(S, t, { rng: seededRng('i', 3, 's') }).promptBlock.includes('[단말기]'), '');
  ck('방 나가면 활성 해제', (() => { msgr.setActive(t, id); msgr.leaveRoom(t, id); return t.msgr.active === null; })(), '');
}

// ── 선톡 — 시드 해시 (리롤 안정) + 쿨다운 + when 게이트 ──
{
  const t = fresh();
  const r1 = msgr.createRoom(cfg, t, { kind: 'dm', members: ['김민수'] });
  msgr.createRoom(cfg, t, { kind: 'group', members: ['서지한', '이하늘'], name: '레이드 준비방' });
  // 실측: 이 방 구성에서 turn 3 → 김민수 방 (해시 고정 — 코드가 바뀌면 여기도 갈린다)
  t.meta.turn = 3;
  const hit = msgr.firstContactRoom(cfg, t);
  ck('★ 선톡 발동 + 재현 (같은 턴 = 같은 방)', hit?.id === r1.id
    && msgr.firstContactRoom(cfg, t)?.id === r1.id, J(hit));
  const aux = engine.buildAuxPrompt(S, t, '거리', null);
  ck('★ 선톡 요청 — 그 턴만 얹힘', aux.includes('[단말기 — 주인공의 단말기]')
    && aux.includes('첫 연락이다') && aux.includes(`"id":${r1.id}`), '');
  t.meta.turn = 2;
  ck('안 뜨는 턴 — 요청 없음 (평턴 비용 0)', !engine.buildAuxPrompt(S, t, '거리', null).includes('[단말기'), '');
  t.meta.turn = 3;
  t.msgr.rooms[0].lastIn = 2;   // 방금 수신 — 쿨다운 3턴
  ck('★ 쿨다운 — 최근 수신 방은 선톡 제외', msgr.firstContactRoom(cfg, t)?.id !== r1.id, '');
  t.msgr.rooms[0].lastIn = null;
  t.vars.in_gate = true;
  ck('★ when 닫힘 — 선톡 요청 빠짐 (통신 두절)', !engine.buildAuxPrompt(S, t, '거리', null).includes('[단말기'), '');
  t.vars.in_gate = false;
  const zero = { ...cfg, firstChance: 0 };
  ck('firstChance 0 — 선톡 없음', msgr.firstContactRoom(zero, t) === null, '');
  // outputPhase 경유 — 파서가 msgr를 회수하고 적용까지 흐른다
  const parsed = engine.parseAuxResponse(`{"changes":{},"reasons":{},"msgr":[{"id":${r1.id},"msgs":[{"from":"김민수","body":"뭐해"}]}]}`);
  ck('파싱 — msgr 필드 회수', Array.isArray(parsed.msgr), '');
  const out = engine.outputPhase(S, t, {}, {}, { rng: seededRng('f', 1, 'o'), msgr: parsed.msgr });
  ck('★ outputPhase 경유 적용', out.state.msgr.rooms[0].msgs.some((m) => m.body === '뭐해'), '');
}

// ── 답장 프롬프트 — 인격 컨텍스트 (품질 리스크의 본체) ──
{
  const t = fresh();
  const { id } = msgr.createRoom(cfg, t, { kind: 'group', members: ['김민수', '서지한'], name: '레이드방' });
  msgr.userMsg(S, t, id, '다들 내일 시간 돼?');
  t.vars.npc_notes = ['김민수 — D급 승급', '무관자 — 은퇴'];
  const ip = msgr.interactionPrompt(S, t, id, { persona: '◆ 김민수\n무뚝뚝, 창잡이', narrative: '맥락' });
  ck('★ persona·notes·guide·대화·형식 전부 실림', ip.includes('무뚝뚝, 창잡이')
    && ip.includes('김민수 — D급 승급') && !ip.includes('무관자')
    && ip.includes('짧은 문자 말투') && ip.includes('다들 내일 시간 돼?') && ip.includes(`{"msgr":[{"id":${id}`), ip.slice(0, 0));
  ck('단체방 — 전원 답장 강제 아님 명시', ip.includes('말할 사람만'), '');
  ck('전지적 정보 금지', ip.includes('전지적으로 알지 못한다'), '');
  const parsed = msgr.parseInteraction(`잡담 {"msgr":[{"id":${id},"msgs":[{"from":"서지한","body":"ㄱㄱ"}]}]} 끝`, engine.extractJsonObject);
  ck('인터랙션 응답 관대 파싱', parsed && parsed[0].id === id, J(parsed));
  ck('없는 방 프롬프트 null', msgr.interactionPrompt(S, t, 999, {}) === null, '');
}

// ── 리롤 되감기 — pre 스냅샷 재현 (보드와 같은 규약) ──
{
  const { SimSession } = SC.require('session');
  class MB { constructor() { this.m = new Map(); } async get(k) { return this.m.get(k) ?? null; }
    async set(k, v) { this.m.set(k, v); } async remove(k) { this.m.delete(k); }
    async keys() { return [...this.m.keys()]; } }
  (async () => {
    const ses = new SimSession(S, new MB(), { chatId: 'c1' });
    await ses.init(-1);
    ses.current.meta.setupDone = true;
    const { id } = msgr.createRoom(cfg, ses.current, { kind: 'dm', members: ['김민수'] });
    await ses.onSend(0);
    await ses.onOutput(1, `{"changes":{},"reasons":{},"msgr":[{"id":${id},"msgs":[{"from":"김민수","body":"1턴 문자"}]}]}`);
    ck('세션 경유 수신', ses.current.msgr.rooms[0].msgs.some((m) => m.body === '1턴 문자'), '');
    await ses.onSend(2);
    await ses.onOutput(3, `{"changes":{},"reasons":{},"msgr":[{"id":${id},"msgs":[{"from":"김민수","body":"2턴 문자"}]}]}`);
    await ses.onSend(2);   // 리롤 — pre:2 스냅샷으로 되감김
    ck('★ 리롤 — 2턴 문자가 되감김', !ses.current.msgr.rooms[0].msgs.some((m) => m.body === '2턴 문자')
      && ses.current.msgr.rooms[0].msgs.some((m) => m.body === '1턴 문자'),
    J(ses.current.msgr.rooms[0].msgs.map((m) => m.body)));

    let p = 0, f = 0;
    for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
    console.log(`\n${p} passed, ${f} failed`);
    process.exit(f ? 1 : 0);
  })();
}
