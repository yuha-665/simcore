const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.55 사이드바 유틸 버튼 (syncControls/syncUtilButtons) + 액션 토글(onActionButton) 검증 (리스 API 목)
//
// 역사: v0.11~v0.54는 이 자리(location:'action')에 액션별 플로팅 버튼이 있었다.
// v0.55에서 걷어내고 게임 패널(편성표 등) 여는 유틸 버튼에 내줬다 — 액션 토글은
// 상태창 범례 클릭·/액션 명령(test-party.js에서 검증)·편집기 패널이 담당한다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const s = src.indexOf('  function safeAvailability(a) {');
const e = src.indexOf('  // ── CBS 호환 미러링');
const body = src.slice(s, e);

// ── 목 환경 ──
const registered = new Map(); // id -> {icon, name, location, cb}
const alerts = [];
const Risuai = {
  async registerButton(arg, cb) { registered.set(arg.id, { icon: arg.icon, name: arg.name, location: arg.location, cb }); return { id: arg.id }; },
  async unregisterUIPart(id) { registered.delete(id); },
  async alert(msg) { alerts.push(msg); },
  async setChatPanel() {},
};
const engine = {
  // 목 — 조건을 평가하지 않고 when이 달려 있으면 차단한다 (이 파일의 검사 대상은
  // 조건 평가가 아니라 버튼 배선·알림 경로다. 평가 자체는 코어 테스트가 본다)
  actionAvailability(schema, state, a) {
    if (a.when) return { ok: false, reason: '조건 미충족' };
    return { ok: true };
  },
  findChoiceEvent() { return null; },
};
const escapeText = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const { actionGlyph } = globalThis.__SC.require('render'); // 슬라이스가 참조 — 실물 사용
const partyMod = globalThis.__SC.require('party');
const calendarMod = globalThis.__SC.require('calendar');
const boardMod = globalThis.__SC.require('board'); // v0.95 — syncUtilButtons가 보드 버튼도 본다
const shopMod = globalThis.__SC.require('shop');   // v0.96 — 상점 버튼도
const engine2 = globalThis.__SC.require('engine'); // shop when 평가용 makeLookup
if (!engine.makeLookup) engine.makeLookup = engine2.makeLookup;
let panelBuilt = false;
const renderPanel = () => {};
const loadForCurrentChar = async () => {};

let schema = null, session = null;
const UTIL_BTN_PREFIX = 'simcore:util:';
let utilBtnIds = new Set();
let utilBtnSig = null;
let gameBuilt = false;
let gameVisible = false;
let gameKind = null;
let gameNotice = null;
let gameOpenSlot = null;

eval(body);

const results = [];
const check = (name, cond, extra = '') => { results.push([cond, name, extra]); };

(async () => {
  // 1. 세션 없음 → 버튼 0개
  await syncControls();
  check('세션 없으면 버튼 없음', registered.size === 0, `size=${registered.size}`);

  // 2. 편성표 없는 스키마 → 여전히 버튼 0개 (액션이 있어도! — 플로팅 액션 버튼은 v0.55에서 제거)
  schema = { vars: [], actions: [{ id: 'repair', label: '대장간 수리' }] };
  session = { current: { vars: {}, meta: { turn: 5, armed: {}, actionLastUsed: {} } },
    toggle(id) {
      const a = schema.actions.find((x) => x.id === id);
      if (session.current.meta.armed[id]) { delete session.current.meta.armed[id]; return { armed: false }; }
      const av = engine.actionAvailability(schema, session.current, a);
      if (!av.ok) return { armed: false, blocked: av.reason };
      session.current.meta.armed[id] = true;
      return { armed: true };
    } };
  await syncControls();
  check('★ 액션만 있으면 버튼 없음 (플로팅 액션 버튼 제거 확인)', registered.size === 0, `size=${registered.size}`);

  // 3. 편성표 달린 스키마 → 유틸 버튼 1개
  schema.vars = [{ id: 'front', label: '전위', type: 'enum', init: '없음', enum: ['없음', '아린'] }];
  schema.party = { label: '편성', icon: '⚔️', empty: '없음', slots: [{ var: 'front' }] };
  await syncControls();
  check('★ 편성표 버튼 등록', registered.size === 1 && registered.has('simcore:util:party'), [...registered.keys()].join(','));
  const btn = registered.get('simcore:util:party');
  check('버튼 이름·위치', btn.name === '편성' && btn.location === 'action', JSON.stringify({ name: btn.name, loc: btn.location }));
  // 아이콘 칸은 글리프 하나 (v0.11 교훈 — 두 글자는 알약 밖으로 삐져나온다)
  const _seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const glyphLen = (x) => [..._seg.segment(String(x))].length;
  check('아이콘은 글리프 1개', glyphLen(btn.icon) === 1, `${btn.icon}(${glyphLen(btn.icon)})`);

  // 4. 변화 없으면 재등록 생략 (사양 서명 기반)
  let calls = 0;
  const orig = Risuai.registerButton;
  Risuai.registerButton = async (...a) => { calls++; return orig(...a); };
  await syncControls();
  await syncControls();
  check('변화 없으면 재등록 생략', calls === 0, `calls=${calls}`);

  // 5. 버튼 사양이 바뀌면 재등록
  schema.party.label = '함대 편성';
  await syncControls();
  check('사양 변경 시 재등록', calls > 0 && registered.get('simcore:util:party').name === '함대 편성',
    registered.get('simcore:util:party').name);
  Risuai.registerButton = orig;

  // 6. 편성표를 떼면 버튼도 사라진다
  delete schema.party;
  await syncControls();
  check('★ 편성표 제거 시 버튼 정리', registered.size === 0, `size=${registered.size}`);

  // 7. 액션 토글은 버튼 없이도 산다 — onActionButton (범례 클릭·편집기 패널이 부르는 경로)
  await onActionButton('repair');
  check('★ 토글 경로 생존 — 무장', session.current.meta.armed.repair === true, '');
  await onActionButton('repair');
  check('재호출 시 해제', !session.current.meta.armed.repair, '');
  schema.actions.push({ id: 'reclaim', label: '개간', when: 'false' });
  await onActionButton('reclaim');
  check('차단 시 알림 + 무장 안 됨', alerts.length === 1 && alerts[0].includes('조건 미충족') && !session.current.meta.armed.reclaim,
    JSON.stringify(alerts));

  // 7.5 게임 패널이 떠 있는 동안의 차단 — 호스트 알림은 전체화면 iframe 뒤에 떠서 안 보인다
  // (규칙 #6, v0.84.1 실사고: 패널의 잠긴 액션을 누르면 문구 없는 유령 알림이 떴다)
  gameVisible = true;
  await onActionButton('reclaim');
  check('★ 패널 위에서는 호스트 알림을 안 부른다', alerts.length === 1, JSON.stringify(alerts));
  check('★ 대신 패널 공지줄에 잠금 이유가 뜬다',
    String(gameNotice).includes('🔒') && String(gameNotice).includes('조건 미충족'), String(gameNotice));
  // v0.85.3 — 조건을 사람 말로: 변수 id가 라벨로 치환되어 보인다
  // (실사고: 업무가 잡혀 있어 거리 홍보가 잠긴 것을 난이도 설정 미스로 오해)
  // ⚠ 이 하네스의 engine은 목이라 조건을 실제로 평가하지 않는다 (when이 있으면 차단).
  // 검사 대상은 humanCond — 조건문의 변수 id(front)가 라벨(전위)로 바뀌어 보이는가다.
  schema.actions.push({ id: 'sortie', label: '출격', when: "front != '없음'" });
  await onActionButton('sortie');
  check('★ 잠금 이유가 조건을 사람 말로 보여준다 (front → 전위)',
    String(gameNotice).includes('전위') && !String(gameNotice).includes('front'), String(gameNotice));
  await onActionButton('repair');
  check('성공 토글이 잠금 공지를 지운다 (낡은 이유가 계속 떠 있지 않게)', gameNotice === null, String(gameNotice));
  gameVisible = false;

  // 8. 세션 종료 → 전부 정리
  schema = { vars: [{ id: 'front', label: '전위', type: 'enum', init: '없음', enum: ['없음', '아린'] }] };
  schema.party = { slots: [{ var: 'front' }], empty: '없음' };
  await syncControls();
  check('(준비) 버튼 재등록', registered.size === 1, `size=${registered.size}`);
  session = null; schema = null;
  await syncControls();
  check('스키마 없으면 전부 해제', registered.size === 0, `size=${registered.size}`);

  let pass = 0, fail = 0;
  for (const [ok, name, extra] of results) {
    console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `→ ${extra}`);
    ok ? pass++ : fail++;
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
