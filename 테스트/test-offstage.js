const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.5.0 — 막간(actions[].offstage): 주인공이 등장하지 않는 장면.
//
// 계기(유저): "페르소나가 존재하면 억지로 계속 등장시켜서" 조연들끼리 굴러가는 장면이나
// 흑막 쪽 이야기를 볼 수가 없다. 프롬프트 토글에서 페르소나 칸을 빼거나 작가노트에 매번
// 적으면 되지만 그걸 턴마다 하는 게 불편하다 → 버튼 하나로.
//
// 불변식:
//   · 판정 기준은 armed가 아니라 **firedThisSend** — oneshot도 발동한 그 턴엔 걸려야 한다
//   · 지시문은 프롬프트 **맨 끝** (이번 턴 가장 센 제약이라 생성에 제일 가깝게)
//   · 안 켠 턴에는 흔적이 없다 (평턴 토큰 0)
//   · 페르소나 제거는 어댑터 몫이고 실패해도 지시문은 나간다 (2중 안전)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

// ── 어댑터 정적 확인 ──
{
  ck('페르소나 제거는 막간 턴에만', src.includes('if (r.offstage) messages = await stripPersona(messages);'), '');
  ck('db에서 선택된 페르소나를 읽는다', src.includes("Risuai.getDatabase(['personas', 'selectedPersona'])"), '');
  ck('짧은 페르소나는 제거 생략 (남의 문장 보호)', src.includes('txt.length < 24'), '');
  ck('이번 입력(마지막 user)은 안 건드림', src.includes("lastUserIdx = messages.map((m) => m?.role).lastIndexOf('user')"), '');
  ck('빈 껍데기 칸은 통째로 제거', src.includes("messages.filter((m) => !(m && typeof m.content === 'string' && !m.content.trim()))"), '');
  ck('캐릭터 전환 시 캐시 무효화', src.includes('personaCache = null;   // 페르소나는 캐릭터'), '');
  // v1.0.7 스코프 사고와 같은 유형 — 선언이 쓰는 자리 옆이면 부팅 중 TDZ로 죽는다
  ck('캐시 선언이 상태 선언부(charKey 옆)', /let charKey = null;[\s\S]{0,400}?let personaCache = null;/.test(src), '');
  ck('편집기 칸 (규칙 #3)', src.includes('막간 — 켜진 턴엔 주인공(유저 페르소나)이 등장하지 않는다'), '');
}

const S = {
  simcore: '0.1', meta: { name: '막간봇' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 }],
  derived: [],
  actions: [
    { id: 'offstage', label: '🎬 막간', mode: 'hold', offstage: true,
      inject: '[막간] 카메라를 다른 곳으로.' },
    { id: 'rest', label: '휴식', mode: 'oneshot', effects: [{ set: 'hp', expr: 'min(hp + 5, 100)' }] },
  ],
  updater: { allow: [{ id: 'hp', maxDelta: 10 }] },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }] }] },
};

// ── 검증 ──
{
  const v = validateSchema(S);
  ck('★ 정상 스키마 통과', v.ok, J(v.errors));
  const bad = JSON.parse(J(S)); bad.actions[0].offstage = 'yes';
  ck('offstage는 true/false만', !validateSchema(bad).ok, '');
  const one = JSON.parse(J(S)); one.actions[0].mode = 'oneshot';
  const vo = validateSchema(one);
  ck('oneshot 막간은 경고 (한 장면만)', vo.ok && vo.warnings.some((w) => w.msg.includes('한 장면만')), J(vo.warnings));
  const two = JSON.parse(J(S)); two.actions[1].offstage = true;
  ck('막간 액션 2개 이상이면 경고', validateSchema(two).warnings.some((w) => w.msg.includes('하나면 충분')), '');
  const none = JSON.parse(J(S)); delete none.actions[0].offstage;
  ck('offstage 없는 봇은 무영향 (경고도 없음)',
    !validateSchema(none).warnings.some((w) => w.msg.includes('막간')), '');
}

const fresh = () => { const t = engine.initState(S); t.meta.setupDone = true; return t; };
const send = (st, i = 0) => engine.sendPhase(S, st, { rng: seededRng('o', i, 's') });

// ── 안 켠 턴: 흔적 없음 (평턴 토큰 0) ──
{
  const r = send(fresh(), 1);
  ck('★ 평턴 — 지시문 없음', !r.promptBlock.includes('막간') && r.offstage === false, '');
}

// ── hold: 켜 둔 동안 매 턴 ──
{
  let t = fresh();
  t = engine.toggleAction(S, t, 'offstage').state;
  const r1 = send(t, 2);
  ck('★ 막간 발동 — 지시문 + offstage 플래그', r1.offstage === true
    && r1.promptBlock.includes('[막간 — 주인공 부재]'), '');
  ck('★ 지시문이 프롬프트 맨 끝 (생성에 가장 가까이)',
    r1.promptBlock.trimEnd().endsWith('대사로 옮기지 말고 장면으로 만들어라.'), r1.promptBlock.slice(-60));
  ck('★ 유저 입력의 신분을 연출 지시로 바꾼다 (되돌아오는 주인공 방지)',
    r1.promptBlock.includes('"무엇을 비출지" 정하는 연출 지시'), '');
  ck('2인칭 서술까지 금지', r1.promptBlock.includes('2인칭 서술'), '');
  ck('액션 자체 inject도 함께', r1.promptBlock.includes('[막간] 카메라를 다른 곳으로.'), '');
  // hold — 다음 턴에도 그대로
  const r2 = send(r1.state, 3);
  ck('★ hold — 다음 턴에도 유지', r2.offstage === true && r2.promptBlock.includes('[막간 — 주인공 부재]'), '');
  // 끄면 조용
  const off = engine.toggleAction(S, r2.state, 'offstage').state;
  const r3 = send(off, 4);
  ck('★ 끄면 즉시 원래대로', r3.offstage === false && !r3.promptBlock.includes('주인공 부재'), '');
}

// ── oneshot: 발동한 그 턴만 (armed가 아니라 firedThisSend 기준) ──
{
  const S1 = JSON.parse(J(S)); S1.actions[0].mode = 'oneshot';
  let t = engine.initState(S1); t.meta.setupDone = true;
  t = engine.toggleAction(S1, t, 'offstage').state;
  const r1 = engine.sendPhase(S1, t, { rng: seededRng('o', 5, 's') });
  ck('★ oneshot — 발동 턴엔 걸린다 (armed는 이미 풀렸다)',
    r1.offstage === true && r1.promptBlock.includes('주인공 부재')
    && !r1.state.meta.armed.offstage, J(r1.state.meta.armed));
  const r2 = engine.sendPhase(S1, r1.state, { rng: seededRng('o', 6, 's') });
  ck('★ oneshot — 다음 턴엔 없다 (한 장면만)', r2.offstage === false && !r2.promptBlock.includes('주인공 부재'), '');
}

// ── 다른 액션은 막간이 아니다 ──
{
  let t = fresh();
  t = engine.toggleAction(S, t, 'rest').state;
  const r = send(t, 7);
  ck('일반 액션은 무영향', r.offstage === false && !r.promptBlock.includes('주인공 부재')
    && r.state.vars.hp === 55, String(r.state.vars.hp));
}

// ── when으로 잠긴 막간은 발동 안 함 (액션 공통 규약 승계) ──
{
  const S2 = JSON.parse(J(S)); S2.actions[0].when = 'hp > 90';
  let t = engine.initState(S2); t.meta.setupDone = true;
  t.meta.armed.offstage = true;
  const r = engine.sendPhase(S2, t, { rng: seededRng('o', 8, 's') });
  ck('★ 조건 미충족이면 안 걸린다', r.offstage === false && !r.promptBlock.includes('주인공 부재'), '');
}

// ── promptState.offstageGuide — 문구 교체·끄기 (checkGuide와 같은 규약) ──
{
  const S3 = JSON.parse(J(S));
  S3.promptState = { offstageGuide: '주인공은 이 장면에 없다. 체력은 {hp}.' };
  let t = engine.initState(S3); t.meta.setupDone = true;
  t = engine.toggleAction(S3, t, 'offstage').state;
  const r = engine.sendPhase(S3, t, { rng: seededRng('o', 9, 's') });
  ck('★ 문구 교체 + 변수 치환', r.promptBlock.includes('주인공은 이 장면에 없다. 체력은 50.')
    && !r.promptBlock.includes('[막간 — 주인공 부재]'), '');
  const S4 = JSON.parse(J(S)); S4.promptState = { offstageGuide: false };
  let t4 = engine.initState(S4); t4.meta.setupDone = true;
  t4 = engine.toggleAction(S4, t4, 'offstage').state;
  const r4 = engine.sendPhase(S4, t4, { rng: seededRng('o', 10, 's') });
  ck('false면 지시문 없이 플래그만 (페르소나 제거 + 자체 inject만 쓰는 봇)',
    r4.offstage === true && !r4.promptBlock.includes('주인공 부재')
    && r4.promptBlock.includes('[막간] 카메라를'), '');
}

// ── offstageFired 공용 판정 (어댑터와 엔진이 같은 기준을 쓴다) ──
{
  const t = fresh();
  ck('offstageFired — 발동 전 false', engine.offstageFired(S, t) === false, '');
  const r = send(engine.toggleAction(S, t, 'offstage').state, 11);
  ck('offstageFired — 발동 후 true', engine.offstageFired(S, r.state) === true, '');
  ck('offstage 없는 스키마엔 항상 false', (() => {
    const S5 = JSON.parse(J(S)); delete S5.actions[0].offstage;
    return engine.offstageFired(S5, r.state) === false;
  })(), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
