const __P = (...p) => require('path').resolve(__dirname, ...p);
// syncActionButtons / onActionButton 동작 검증 (리스 API 목)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

const s = src.indexOf('  function safeAvailability(a) {');
const e = src.indexOf('  // ── CBS 호환 미러링');
const body = src.slice(s, e);

// ── 목 환경 ──
const registered = new Map(); // id -> {icon, cb}
const alerts = [];
const Risuai = {
  async registerButton(arg, cb) { registered.set(arg.id, { icon: arg.icon, name: arg.name, location: arg.location, cb }); return { id: arg.id }; },
  async unregisterUIPart(id) { registered.delete(id); },
  async alert(msg) { alerts.push(msg); },
};
const engine = {
  actionAvailability(schema, state, a) {
    if (a.cooldown != null) {
      const last = state.meta.actionLastUsed[a.id];
      if (last != null && state.meta.turn - last < a.cooldown) return { ok: false, reason: `쿨다운 (${a.cooldown - (state.meta.turn - last)}턴 남음)` };
    }
    if (a.when === 'false') return { ok: false, reason: '조건 미충족' };
    return { ok: true };
  },
};
const escapeText = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 런타임은 render 모듈의 actionGlyph를 쓴다 (상태창 범례와 같은 글리프여야 하므로)
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const { actionGlyph } = globalThis.__SC.require('render');
let panelBuilt = false;
const renderPanel = () => {};

let schema = null, session = null;
const ACTION_BTN_PREFIX = 'simcore:act:';
let actionBtnIds = new Set();
let actionBtnSig = null;

eval(body);

// ── 시나리오 ──
const results = [];
const check = (name, cond, extra = '') => { results.push([cond, name, extra]); };
const icons = () => [...registered.values()].map((v) => v.icon).sort().join(' | ');

(async () => {
  // 1. 세션 없음 → 버튼 0개
  await syncActionButtons();
  check('세션 없으면 버튼 없음', registered.size === 0, `size=${registered.size}`);

  // 2. 스키마 로드 → 액션 3개 (1개는 조건 미충족)
  schema = { actions: [
    { id: 'repair', label: '대장간 수리' },
    { id: 'tax', label: '특별 징세' },
    { id: 'reclaim', label: '개간', when: 'false' },
  ] };
  session = { current: { meta: { turn: 5, armed: {}, actionLastUsed: {} } },
    toggle(id) {
      const a = schema.actions.find((x) => x.id === id);
      if (session.current.meta.armed[id]) { delete session.current.meta.armed[id]; return { armed: false }; }
      const av = engine.actionAvailability(schema, session.current, a);
      if (!av.ok) return { armed: false, blocked: av.reason };
      session.current.meta.armed[id] = true;
      return { armed: true };
    } };
  await syncActionButtons();
  check('액션 3개 등록', registered.size === 3, `size=${registered.size}`);
  check('조건 미충족은 🔒 표시', icons().includes('🔒'), icons());
  check('location=action', [...registered.values()].every((v) => v.location === 'action'));

  // 아이콘 칸은 글리프가 딱 하나 들어간다 — 두 글자면 알약 밖으로 삐져나온다
  // 화면에 몇 칸으로 보이는가 = 자소 묶음(grapheme) 수
  const _seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const glyphLen = (s) => [..._seg.segment(String(s))].length;
  check('★ 모든 아이콘이 글리프 1개',
    [...registered.values()].every((v) => glyphLen(v.icon) === 1),
    [...registered.values()].map((v) => `${v.icon}(${glyphLen(v.icon)})`).join(' | '));
  check('★ 아이콘에 라벨이 섞여 들어가지 않음',
    [...registered.values()].every((v) => !v.icon.includes('대장간') && !v.icon.includes(' ')), icons());
  check('★ 전체 라벨은 name으로 보존 (툴팁용)',
    [...registered.values()].map((v) => v.name).sort().join(' | ') === '개간 | 대장간 수리 | 특별 징세',
    [...registered.values()].map((v) => v.name).join(' | '));

  // 3. 사용 가능한 액션 클릭 → 무장 ✅로 교체
  await registered.get('simcore:act:repair').cb();
  check('무장 시 ✅로 바뀜', registered.get('simcore:act:repair').icon === '✅',
    registered.get('simcore:act:repair').icon);
  check('무장해도 여전히 글리프 1개', glyphLen(registered.get('simcore:act:repair').icon) === 1, '');
  check('무장해도 name은 그대로', registered.get('simcore:act:repair').name === '대장간 수리',
    registered.get('simcore:act:repair').name);
  check('무장 클릭은 알림 없음', alerts.length === 0, JSON.stringify(alerts));

  // 4. 같은 버튼 재클릭 → 해제
  await registered.get('simcore:act:repair').cb();
  check('재클릭 시 해제', !icons().includes('대장간 수리 ●'), icons());

  // 5. 조건 미충족 액션 클릭 → 알림, 무장 안 됨
  await registered.get('simcore:act:reclaim').cb();
  check('차단 시 알림 표시', alerts.length === 1 && alerts[0].includes('조건 미충족'), JSON.stringify(alerts));
  check('차단 시 무장 안 됨', !session.current.meta.armed.reclaim);

  // 6. 변화 없을 때 재등록 생략 (서명 기반)
  let calls = 0;
  const orig = Risuai.registerButton;
  Risuai.registerButton = async (...a) => { calls++; return orig(...a); };
  await syncActionButtons();
  await syncActionButtons();
  check('변화 없으면 재등록 생략', calls === 0, `calls=${calls}`);
  Risuai.registerButton = orig;

  // 7. 쿨다운 진입 → 🔒로 바뀜 (서명이 달라지므로 재등록됨)
  schema.actions[1].cooldown = 3;
  session.current.meta.actionLastUsed.tax = 5;
  await syncActionButtons();
  check('쿨다운 시 🔒로 바뀜', registered.get('simcore:act:tax').icon === '🔒',
    registered.get('simcore:act:tax').icon);
  check('쿨다운 버튼도 글리프 1개', glyphLen(registered.get('simcore:act:tax').icon) === 1, '');

  // 8. 캐릭터 전환(액션 1개짜리 스키마) → 사라진 버튼 정리
  schema = { actions: [{ id: 'rest', label: '휴식' }] };
  session.current.meta.armed = {};
  await syncActionButtons();
  check('사라진 액션 버튼 제거', registered.size === 1 && registered.has('simcore:act:rest'), [...registered.keys()].join(','));

  // 9. 세션 종료(캐릭터에 스키마 없음) → 전부 정리
  session = null; schema = null;
  await syncActionButtons();
  check('스키마 없으면 전부 해제', registered.size === 0, `size=${registered.size}`);

  let pass = 0, fail = 0;
  for (const [ok, name, extra] of results) {
    console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `→ ${extra}`);
    ok ? pass++ : fail++;
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
