const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.13.2 — 편지는 편지답게: 메신저 medium 'letter' + 답장 인격 발췌의 정확 일치 우선.
//
// 발단: 베리디아 서신. 폰이 없는 세계(아틀리에·베리디아)가 메신저를 편지로 쓰면서 guide로 "단말기가 아니라 편지다"라고
// 덧칠했는데, 엔진이 먼저 "주인공의 단말기"·"문자 말투로 짧게"라고 말해 두 지시가 부딪혔다.
// 불변식:
//   · medium 기본값 'text' — 옛 봇의 프롬프트는 한 글자도 안 바뀐다
//   · 'letter'면 선톡·답장·메인 주입 세 곳에서 단말기·문자 말이 빠지고 편지 말이 들어간다, 한 통 상한 600
//   · 인격 발췌는 제목·키워드 정확 일치가 부분 일치보다 먼저 ("리아나" ≠ "릴리아나")
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const msgr = SC.require('messenger');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

const base = (medium) => ({
  simcore: '0.1', meta: { name: '서신봇' },
  vars: [
    { id: 'pen', label: '서신 상대', type: 'list', init: ['모르웬', '리아나', '알라릭 여왕'], maxItems: 12 },
    { id: 'favors', label: '빚·약속', type: 'list', init: ['모르웬에게 곡물 200 상환'], maxItems: 12 },
  ],
  derived: [],
  messenger: { label: '서신', icon: '✉', contactsVar: 'pen', notesVar: 'favors', firstChance: 1, cooldown: 0,
    guide: '격식 있는 편지', ...(medium ? { medium } : {}) },
});

// ── 검증 ──
{
  ck('★ letter 통과', validateSchema(base('letter')).ok, J(validateSchema(base('letter')).errors));
  ck('text 통과', validateSchema(base('text')).ok, '');
  ck('생략 통과 (기본 text)', validateSchema(base()).ok, '');
  const bad = validateSchema(base('pigeon'));
  ck('★ 모르는 매체는 오류', !bad.ok && bad.errors.some((e) => e.path === '$.messenger.medium'), J(bad.errors));
  ck('설정 정규화 — 기본 text', msgr.msgrConfig(base()).medium === 'text' && msgr.msgrConfig(base('letter')).medium === 'letter', '');
}

// 방 하나 연 상태 (1:1 모르웬 — 첫 방)
const withRoom = (S) => {
  const st = engine.initState(S);
  const r = msgr.createRoom(msgr.msgrConfig(S), st, { kind: 'dm', members: ['모르웬'] });
  return { st, id: r.id };
};

// ── 선톡 (턴 피기백) ──
{
  const L = base('letter'); const T = base();
  const a = withRoom(L); const b = withRoom(T);
  const specL = msgr.auxSpec(L, a.st, engine.makeLookup);
  const specT = msgr.auxSpec(T, b.st, engine.makeLookup);
  ck('선톡이 뜬다 (확률 1)', !!specL && !!specT, '');
  ck('★ 편지 선톡 — 단말기·문자 말이 없다', !/단말기|문자 말투/.test(specL), specL);
  ck('★ 편지 선톡 — 편지 말', specL.includes('먼저 편지를 보낼') && specL.includes('격식과 서명'), specL);
  ck('★ 문자(기본)는 옛 문장 그대로', specT.includes('주인공의 단말기') && specT.includes('문자 말투로 짧게') && specT.includes('먼저 메시지를 보낼'), specT);
  ck('어댑터가 편지 선톡에 출력 상한 가산', src.includes("auxPrompt.includes('먼저 편지를 보낼')"), '');
}

// ── 답장 프롬프트 ──
{
  const L = base('letter');
  const a = withRoom(L);
  msgr.userMsg(L, a.st, a.id, '능선의 고블린 이야기를 들었습니다.');
  const p = msgr.interactionPrompt(L, a.st, a.id, { persona: '◆ 모르웬\n무뚝뚝한 전사', narrative: '남작이 편지를 썼다' });
  ck('★ 답장 — 편지 시뮬레이터', p.includes('서신 시뮬레이터') && p.includes('편지를 보냈다'), p.slice(0, 120));
  ck('★ 답장 — 문자 말 없음', !/문자 말투|메신저 시뮬레이터|즉답/.test(p), p);
  ck('답장 — 늦게 온 답장 · 모르는 사이', p.includes('오가는 시간만큼') && p.includes('모르는 사람에게 쓰듯'), '');
  ck('답장 — 빚·약속이 인물 변화로 (포함 일치)', p.includes('모르웬에게 곡물 200 상환'), '');
  const T = base();
  const b = withRoom(T);
  msgr.userMsg(T, b.st, b.id, 'ㅎㅇ');
  const q = msgr.interactionPrompt(T, b.st, b.id, {});
  ck('문자(기본) 답장은 옛 문장', q.includes('메신저 시뮬레이터') && q.includes('문자 말투로 짧게'), '');
}

// ── 길이 상한 ──
{
  const L = base('letter'); const T = base();
  const long = '가'.repeat(900);
  const a = withRoom(L); msgr.userMsg(L, a.st, a.id, long);
  const b = withRoom(T); msgr.userMsg(T, b.st, b.id, long);
  ck('★ 편지 한 통 600자', a.st.msgr.rooms[0].msgs[0].body.length === 600, String(a.st.msgr.rooms[0].msgs[0].body.length));
  ck('문자 한 통 300자 (그대로)', b.st.msgr.rooms[0].msgs[0].body.length === 300, String(b.st.msgr.rooms[0].msgs[0].body.length));
  msgr.applyDelta(L, a.st, [{ id: a.id, msgs: [{ from: '모르웬', body: long }] }]);
  ck('수신도 600자', a.st.msgr.rooms[0].msgs[1].body.length === 600, '');
  ck('msgLen 노출', msgr.msgLen(msgr.msgrConfig(L)) === 600 && msgr.msgLen(msgr.msgrConfig(T)) === 300, '');
}

// ── 메인 주입 ──
{
  const L = base('letter');
  const a = withRoom(L);
  msgr.userMsg(L, a.st, a.id, '안부를 묻습니다.');
  msgr.setActive(a.st, a.id);
  const m = msgr.mainLine(L, a.st);
  ck('★ 메인 — 오간 서신', m.includes('주고받은 최근 서신') && !m.includes('단말기'), m);
  const T = base();
  const b = withRoom(T);
  msgr.userMsg(T, b.st, b.id, 'ㅎㅇ');
  msgr.setActive(b.st, b.id);
  ck('문자(기본) 메인은 옛 문장', msgr.mainLine(T, b.st).includes('단말기로 나눈 최근 대화'), '');
}

// ── 인격 발췌 — 정확 일치 우선 ──
{
  // 베리디아 로어북 순서 그대로: 릴리아나가 리아나보다 앞에 있다
  const pool = [
    { comment: '캐릭터 간이 리스트', key: '', content: '리아나 · 릴리아나 · 모르웬 ... (전원 요약)' },
    { comment: '여왕', key: ' Queen, Alaric, 여왕,알라릭', content: 'QUEEN' },
    { comment: '카산드라', key: 'Cassandra, Cassandra,First Princess', content: 'CASS' },
    { comment: '릴리아나', key: 'Third Princess, Liliana, 릴리아나', content: 'LILI' },
    { comment: '리아나', key: '리아나, Liana', content: 'LIANA' },
    { comment: '모르웬', key: '모르웬, Morwen', content: 'MORWEN' },
  ];
  const pick = (n) => msgr.personaEntry(pool, n)?.content ?? null;
  ck('★ 리아나 → 리아나 문항 (릴리아나 아님)', pick('리아나') === 'LIANA', String(pick('리아나')));
  ck('릴리아나 → 릴리아나', pick('릴리아나') === 'LILI', '');
  ck('★ 알라릭 여왕 → 여왕 문항 (한 낱말로)', pick('알라릭 여왕') === 'QUEEN', String(pick('알라릭 여왕')));
  ck('★ 요약 문항(부분 일치)보다 제목 일치가 먼저', pick('모르웬') === 'MORWEN', String(pick('모르웬')));
  ck('키워드 칸 정확 일치 (영문)', pick('Liana') === 'LIANA', String(pick('Liana')));
  ck('정확 일치가 없으면 옛 부분 일치로', pick('Cass') === 'CASS', String(pick('Cass')));
  ck('없으면 null', pick('없는사람') === null && msgr.personaEntry(null, '리아나') === null, '');
  ck('어댑터가 personaEntry를 쓴다', src.includes('msgrMod.personaEntry(pool, name)'), '');
}

// ── 편집기 · 어댑터 문구 ──
{
  ck('편집기 매체 선택', src.includes("['letter', '편지 — 한 통 600자, 격식·서명']"), '');
  ck('패널 — 편지면 보내기·답장이 오는 중', src.includes("letter ? '보내기' : '전송'") && src.includes("'⏳ 답장이 오는 중…'"), '');
  ck('패널 입력칸 상한도 매체를 따른다', src.includes('ta.maxLength = msgrMod.msgLen(cfg)'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
