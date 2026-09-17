const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.10.0 비밀 (core/secret.js, 설계 docs/design-비밀.md) — "모르는 건 말할 수 없다".
//
// 검증 축 = 설계의 약속 넷:
//  ① 은닉 보장 — 안 열린 단계의 text는 프롬프트 문자열 어디에도 없다. grep으로 증명한다 (모델 확률이 아니라 구조).
//  ② 존재 알림 — tell:exists면 "숨기는 게 있다"만 나가고, tell:none·반전은 신호도 없다.
//  ③ 단계 열기 — 참인 가장 높은 단계까지 누적으로, 한 번 열리면 안 내려간다.
//  ④ 옵트인 — secrets가 없으면 아무것도 바뀌지 않는다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const sec = SC.require('secret');
const engine = SC.require('engine');
const render = SC.require('render');
const { validateSchema } = SC.require('validate');
const { diagnose } = SC.require('diagnose');
const { TEMPLATES } = SC.require('templates');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const cp = (o) => JSON.parse(JSON.stringify(o));

// 단계 글 — 은닉 검사에서 "이 글자가 프롬프트에 있는가"로 쓴다. 다른 어디에도 안 나오는 문장으로.
const T0 = '궁정 예법에 익숙하다. 왕가 문장을 보면 움찔한다.';
const T1 = '수도를 나쁜 사정으로 떠났다.';
const T2 = '추방된 왕녀다. 동생이 왕위를 찬탈했다.';
const R1 = '유적은 신전이 아니라 봉인 장치다.';
const TW = '의뢰인이 곧 범인이다.';

const BASE = {
  simcore: '0.1', meta: { name: '비밀 테스트' },
  vars: [
    { id: 'affinity', label: '호감', type: 'int', init: 0, min: 0, max: 100, desc: '리나가 주인공을 신뢰하는 정도' },
    { id: 'letter_found', label: '편지 발견', type: 'bool', init: false },
    { id: 'explored', label: '탐사', type: 'int', init: 0, min: 0, max: 10 },
    // 아무도 안 세우는 변수 — 진단의 "닫힌 비밀"을 재현할 때 쓴다 (allow에 있으면 'AI 담당 문턱'으로 낮춰진다)
    { id: 'depth', label: '깊이', type: 'int', init: 0, min: 0, max: 10 },
  ],
  rules: { events: [] },
  // changes는 델타다 — maxDelta가 작으면 60을 보내도 30에서 잘려 조건이 안 찬다 (테스트 함정)
  updater: { allow: [{ id: 'affinity', maxDelta: 100 }, { id: 'letter_found' }, { id: 'explored', maxDelta: 10 }] },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'affinity' }] }] },
  secrets: [
    { id: 'lina', kind: 'person', about: '리나', label: '리나의 과거',
      tiers: [
        { text: T0 },
        { when: 'affinity >= 60', text: T1, notify: '[비밀] 리나가 수도를 떠난 사정을 조금 털어놓았다.' },
        { when: 'letter_found', text: T2, notify: '[비밀] 리나의 정체가 밝혀졌다.' },
      ] },
    { id: 'ruins', kind: 'world', about: '고대 유적', label: '유적의 정체',
      tiers: [{ when: 'explored >= 3', text: R1 }] },
    { id: 'twist', kind: 'plot', label: '진상',
      tiers: [{ when: 'explored >= 5', text: TW }] },
  ],
};

// 한 턴 굴리기 — sendPhase → outputPhase (보조 changes 포함)
function turn(schema, state, changes = {}) {
  const rng = () => 0.99;
  const sp = engine.sendPhase(schema, state, { armedActions: [] });
  const op = engine.outputPhase(schema, sp.state, changes, {}, { rng });
  return { state: op.state, prompt: sp.promptBlock, fired: op.firedEvents, log: op.changeLog };
}

// ── ④ 정규화·옵트인 ──
{
  ck('secrets 없으면 null (없음 = 꺼짐)', sec.secretsConfig({ vars: [] }) === null, '');
  ck('빈 배열도 null', sec.secretsConfig({ secrets: [] }) === null, '');
  const cfg = sec.secretsConfig(BASE);
  ck('★ 정규화: 비밀 3개', cfg.length === 3, String(cfg.length));
  ck('종류 기본 = person', sec.secretsConfig({ secrets: [{ id: 'x', tiers: [{ text: 'a' }] }] })[0].kind === 'person', '');
  ck('★ 인물·세계는 존재 알림 기본 exists', cfg[0].tell === 'exists' && cfg[1].tell === 'exists', `${cfg[0].tell}/${cfg[1].tell}`);
  ck('★ 반전은 존재 알림 기본 none (신호가 곧 예고)', cfg[2].tell === 'none', cfg[2].tell);
  ck('1단계 when 생략 = true (처음부터 열린 낌새)', cfg[0].tiers[0].when === 'true', cfg[0].tiers[0].when);
  ck('예약 이름 sec_<id>', JSON.stringify(sec.secretExposedNames(BASE)) === JSON.stringify(['sec_lina', 'sec_ruins', 'sec_twist']), '');
  const st0 = engine.initState(cp(BASE));
  // 1단계 when이 'true'(낌새)면 처음부터 열려 있어야 첫 프롬프트에 복선이 실린다 — 조건 있는 1단계는 -1(아직)
  ck('★ initState: 낌새 있는 비밀은 0, 조건부는 -1', st0.vars.sec_lina === 0 && st0.vars.sec_ruins === -1 && st0.vars.sec_twist === -1, JSON.stringify([st0.vars.sec_lina, st0.vars.sec_ruins, st0.vars.sec_twist]));
  ck('initialTier: 앞에서부터 true인 단계만', sec.initialTier(cfg[0]) === 0 && sec.initialTier(cfg[1]) === -1, '');
  const noSec = cp(BASE); delete noSec.secrets;
  const stN = engine.initState(noSec);
  ck('★ secrets 없는 스키마엔 예약 키가 없다', !('sec_lina' in stN.vars), '');
  ck('없는 봇의 프롬프트에 [비밀 블록 없음', !turn(noSec, stN).prompt.includes('[비밀'), '');
}

// ── ① 은닉 보장 — 프롬프트 문자열에 실리는 것과 안 실리는 것 ──
{
  const schema = cp(BASE);
  const st = engine.initState(schema);
  const t1 = turn(schema, st);
  const p = t1.prompt;
  ck('★ 머리글 + 미공개 어법 ("거짓이 아니라 아직")', p.includes('[비밀 — 밝혀진 만큼만]') && p.includes('거짓이 아니라 아직'), '');
  ck('★ 1단계(낌새)는 처음부터 실린다', p.includes(T0), '');
  ck('★★ 안 열린 2·3단계 text는 프롬프트 어디에도 없다 — 은닉의 실체', !p.includes(T1) && !p.includes(T2), '');
  ck('★ 낌새만 열렸으면 "전부는 아니다" 표시', p.includes('전부는 아니다'), '');
  ck('★ 세계 비밀(exists): 존재만 알린다 — 내용은 없다', p.includes('고대 유적에 관해 아직 드러나지 않은 사실') && !p.includes(R1), '');
  ck('★ 존재 알림에 "지어내지 마라" 동봉', p.includes('지어내지 마라'), '');
  ck('★★ 반전(plot, none): text도 없고 이름·신호도 없다', !p.includes(TW) && !p.includes('진상'), '');
  ck('★ 통지 문구도 열리기 전엔 없다', !p.includes('정체가 밝혀졌다') && !p.includes('조금 털어놓았다'), '');
  // 존재도 안 알리는 비밀만 있고 하나도 안 열렸으면 블록 자체가 없다 — "비밀이 있다"는 신호도 스포일러
  const onlyPlot = cp(BASE); onlyPlot.secrets = [BASE.secrets[2]];
  const tp = turn(onlyPlot, engine.initState(onlyPlot));
  ck('★ 반전만 있고 안 열렸으면 [비밀 블록 자체가 없다', !tp.prompt.includes('[비밀'), '');
  // 보조 프롬프트에는 아무것도 안 간다 (있으면 검사, 시그니처가 다르면 건너뜀)
  let aux = null;
  try { aux = typeof engine.buildAuxPrompt === 'function' ? engine.buildAuxPrompt(schema, st, '유저가 편지를 찾았다') : null; } catch { aux = null; }
  ck('보조 프롬프트에 비밀 내용 없음 (buildAuxPrompt가 있으면 검사)', typeof aux !== 'string' || (!aux.includes(T0) && !aux.includes(T1) && !aux.includes(T2) && !aux.includes(R1) && !aux.includes(TW)), '');
  // 보조 프롬프트 빌더 본문을 중괄호로 잘라 그 안에 비밀 관련 호출이 없음을 본다 (근처 다른 함수에 걸리지 않게)
  {
    const start = src.indexOf('function buildAuxPrompt(');
    // 시그니처의 `opts = {}`에 걸리지 않게 본문 여는 괄호(') {')부터 센다
    let depth = 0, i = src.indexOf(') {', start) + 2, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
    }
    const body = start >= 0 && end > 0 ? src.slice(start, end) : '';
    ck('★ 보조 프롬프트 빌더 본문에 비밀 주입이 없다 (정적)', body.length > 200 && !/secret/i.test(body), `${body.length}자`);
  }
}

// ── ③ 단계 열기 — 누적·단조·전환 원장 ──
{
  const schema = cp(BASE);
  let st = engine.initState(schema);
  for (let i = 0; i < 2; i++) st = turn(schema, st).state;
  ck('★ 조건 미충족이면 낌새(0)에 머문다', st.vars.sec_lina === 0, String(st.vars.sec_lina));
  let r = turn(schema, st, { affinity: 60 });
  st = r.state;
  ck('★ affinity 60 → 2단계 열림 (sec_lina = 1)', st.vars.sec_lina === 1, String(st.vars.sec_lina));
  ck('★ 통지가 다음 전송에 실린다', st.meta.pendingNotifies.some((n) => n.includes('조금 털어놓았다')), '');
  ck('★ firedEvents 창구 secret:lina', r.fired.includes('secret:lina'), r.fired.join(','));
  const lg = (r.log || []).find((c) => c.source === 'secret:lina');
  ck('★ 원장에 라벨·단계만 (내용 없음)', !!lg && lg.id === '리나의 과거' && lg.to === '2/3단계' && !JSON.stringify(lg).includes(T1), JSON.stringify(lg));
  const t2 = turn(schema, st);
  ck('★ 2단계 열린 뒤: 1·2단계 text 누적, 3단계는 여전히 없음', t2.prompt.includes(T0) && t2.prompt.includes(T1) && !t2.prompt.includes(T2), '');
  ck('열린 뒤엔 "말 못 할 사정" 존재 알림이 아니라 내용이 나간다', !t2.prompt.includes('리나에게는 말 못 할 사정'), '');
  st = t2.state;
  // 조건이 다시 거짓 — 열린 건 안 내려간다
  st = turn(schema, st, { affinity: 0 }).state;
  ck('★ 단조 — affinity 0으로 떨어져도 sec_lina 유지', st.vars.sec_lina === 1, String(st.vars.sec_lina));
  st = turn(schema, st, { letter_found: true }).state;
  ck('★ 편지 발견 → 3단계 (sec_lina = 2)', st.vars.sec_lina === 2, String(st.vars.sec_lina));
  const t3 = turn(schema, st);
  ck('★ 전모: 세 단계 전부 실리고 "전부는 아니다"가 사라진다', t3.prompt.includes(T2) && !t3.prompt.includes('전부는 아니다'), '');
  // 건너뛰기 — 3단계 조건이 먼저 참이면 2단계도 함께 (누적 사다리)
  let s2 = engine.initState(cp(BASE));
  s2 = turn(cp(BASE), s2, { letter_found: true }).state;
  ck('★ 누적 — 3단계 조건만 참이어도 sec_lina = 2', s2.vars.sec_lina === 2, String(s2.vars.sec_lina));
  const tj = turn(cp(BASE), s2);
  ck('★ 건너뛴 2단계 text도 함께 실린다', tj.prompt.includes(T1) && tj.prompt.includes(T2), '');
  // 반전 — 열리면 실린다
  let s3 = engine.initState(cp(BASE));
  s3 = turn(cp(BASE), s3, { explored: 5 }).state;
  ck('★ 반전 열림 (sec_twist = 0)', s3.vars.sec_twist === 0, String(s3.vars.sec_twist));
  ck('★ 세계 비밀도 같은 턴에 (explored 5 ≥ 3)', s3.vars.sec_ruins === 0, String(s3.vars.sec_ruins));
  const tt = turn(cp(BASE), s3);
  ck('★ 열린 반전은 "밝혀진 내막"으로 실린다', tt.prompt.includes(TW) && tt.prompt.includes('밝혀진 내막'), '');
  // sec_* 를 조건식이 읽는다
  const withDir = cp(BASE);
  withDir.directives = [{ id: 'after', when: 'sec_lina >= 1', text: '[연출] 리나는 이제 과거를 숨기지 않는다.' }];
  ck('★ 지시문 when이 sec_lina를 읽는다 (검증 통과)', validateSchema(withDir).ok, JSON.stringify(validateSchema(withDir).errors));
  let s4 = engine.initState(withDir);
  s4 = turn(withDir, s4, { affinity: 70 }).state;
  ck('★ sec_lina >= 1 지시문이 열린 뒤 실린다', turn(withDir, s4).prompt.includes('과거를 숨기지 않는다'), '');
  // 진행 중 세이브에 나중에 켠 경우
  const late = cp(BASE); delete late.secrets;
  let s5 = engine.initState(late); s5 = turn(late, s5).state;
  const t5 = turn(cp(BASE), s5);
  ck('★ 나중에 켠 세이브: 낌새(0)에서 시작하고 낌새만 실린다', t5.state.vars.sec_lina === 0 && t5.prompt.includes(T0) && !t5.prompt.includes(T1), '');
}

// ── 검증 ──
{
  const errs = (s) => validateSchema(s).errors.map((e) => `${e.path}: ${e.msg}`).join(' | ');
  const warns = (s) => validateSchema(s).warnings.map((e) => `${e.path}: ${e.msg}`).join(' | ');
  ck('기본 스키마 유효', validateSchema(BASE).ok, errs(BASE));
  const c1 = cp(BASE); c1.vars.push({ id: 'sec_lina', label: 'x', type: 'int', init: 0 });
  ck('★ 예약 이름 충돌(sec_lina 변수) = 오류', /예약 이름/.test(errs(c1)), errs(c1));
  const c2 = cp(BASE); c2.secrets[0].tiers[1].when = 'nope >= 1';
  ck('★ 여는 조건의 없는 변수 = 오류', /알 수 없는 변수 'nope'/.test(errs(c2)), errs(c2));
  const c3 = cp(BASE); delete c3.secrets[0].tiers[1].when;
  ck('★ 뒷단계 when 없음 = 오류 (영영 안 열림)', /영영 안 열립니다/.test(errs(c3)), errs(c3));
  const c4 = cp(BASE); c4.secrets[0].tiers[2].text = '  ';
  ck('★ 빈 text = 오류', /text.*비어/.test(errs(c4)), errs(c4));
  const c5 = cp(BASE); c5.secrets[0].kind = 'rumor';
  ck('kind 오타 = 오류', /kind는/.test(errs(c5)), errs(c5));
  const c6 = cp(BASE); c6.secrets[0].tiers[1].when = 'rand() < 0.5';
  ck('★ when에 rand() = 오류 (공개는 결정적)', /rand\(\)/.test(errs(c6)), errs(c6));
  const c7 = cp(BASE); c7.secrets[2].tell = 'exists';
  ck('★ 반전 + exists = 경고 (예고)', /반전\(plot\) 비밀에 tell: exists/.test(warns(c7)), warns(c7));
  const c8 = cp(BASE); delete c8.secrets[1].about; delete c8.secrets[1].label;
  ck('exists인데 about 없음 = 경고', /about\(누구·무엇\)이 비어/.test(warns(c8)), warns(c8));
  const c9 = cp(BASE); c9.secrets.push({ id: 'lina', tiers: [{ text: 'x' }] });
  ck('중복 비밀 id = 오류', /중복 비밀 id/.test(errs(c9)), errs(c9));
  const c10 = cp(BASE); c10.vars.push({ id: 'secrets', label: 'x', type: 'int', init: 0 });
  ck('변수 id "secrets"는 자리표시자 경고', /자리표시자/.test(warns(c10)), warns(c10));
  const c11 = cp(BASE); c11.statusUI = { mode: 'template', template: '<div>{secrets}{affinity}</div>' };
  ck('★ 템플릿 {secrets} 자리표시자 허용', validateSchema(c11).ok, errs(c11));
  const c12 = cp(BASE); c12.secrets[0].tiers[0].text = '{nope}는 움찔한다';
  ck('text의 {변수} 참조 검사', /nope/.test(errs(c12)), errs(c12));
}

// ── 상태창 칩 — 유저 눈에도 은닉 ──
{
  const st = engine.initState(cp(BASE));
  const chip = sec.secretChipHtml(BASE, st.vars, (s) => String(s));
  // 진행은 "밝혀낸 것"만 — 처음부터 열린 낌새는 발견이 아니다 (리나 = 낌새 + 조건 2단계 → 0/2)
  ck('★ 인물·세계 비밀은 🔒 칩 (0/2, 0/1)', chip.includes('🔒 리나의 과거') && chip.includes('0/2') && chip.includes('유적의 정체') && chip.includes('0/1'), chip);
  ck('★★ 반전은 칩에도 없다', !chip.includes('진상'), chip);
  const noneWorld = cp(BASE); noneWorld.secrets[1].tell = 'none';
  ck('★ tell:none이고 안 열렸으면 칩도 없다 (신호가 스포일러)', !sec.secretChipHtml(noneWorld, st.vars).includes('유적의 정체'), '');
  st.vars.sec_lina = 2;
  const open = sec.secretChipHtml(BASE, st.vars, (s) => String(s));
  ck('전부 열리면 🔓 + is-open (2/2)', open.includes('🔓 리나의 과거') && open.includes('is-open') && open.includes('2/2'), open);
  // 낌새뿐인 비밀은 밝혀낼 게 없다 — 칩도 없다
  const hintOnly = cp(BASE); hintOnly.secrets = [{ id: 'h', kind: 'person', about: '아무개', tiers: [{ text: '눈을 자주 깜빡인다.' }] }];
  ck('낌새뿐인 비밀은 칩을 안 그린다', sec.secretChipHtml(hintOnly, engine.initState(hintOnly).vars) === '', '');
  const html = render.renderStatusHtml(BASE, engine.initState(cp(BASE)), null, null, { includeStyle: true });
  ck('★ 그룹 모드 상태창 머리에 자물쇠 칩이 선다', html.includes('sim-secs') && html.includes('🔒'), '');
  ck('★★ 상태창 HTML에 단계 text가 없다', !html.includes(T0) && !html.includes(T1) && !html.includes(TW), '');
  ck('칩 CSS가 기본 스타일에 있다', src.includes('.sim-sec{') && src.includes('.sim-sec.is-open'), '');
}

// ── 하이라이트 카드 — 열리는 순간이 머리기사, 내용은 카드에도 없다 ──
{
  const schema = cp(BASE);
  let st = engine.initState(schema);
  const r = turn(schema, st, { affinity: 60 });
  const html = render.renderStatusHtml(schema, r.state, r.log, null, { includeStyle: true });
  ck('★ 🔓 카드가 선다', html.includes('🔓') && html.includes('리나의 과거'), '');
  ck('★★ 카드에 내용 없음', !html.includes(T1), '');
}

// ── 진단 — 닫힌 비밀 ──
{
  const FAST = { turns: 25, runs: 3 };
  // 사다리는 첫 안 열린 단계 하나만 짚는다 — 2단계(affinity, AI 담당)를 빼서 depth 단계가 첫 안 열린 단계가 되게 한다
  const bad = cp(BASE); bad.secrets[0].tiers.splice(1, 1); bad.secrets[0].tiers[1].when = 'depth >= 3';   // depth는 아무도 안 세운다 → 진짜 결함
  const rb = diagnose(bad, FAST);
  ck('★ 영영 안 열리는 단계를 "닫힌 비밀"로 짚는다', rb.findings.some((f) => f.tag === '닫힌 비밀' && f.sev === 'mid' && /리나의 과거/.test(f.text) && /2단계/.test(f.text)),
    rb.findings.map((f) => `${f.tag}:${f.sev}`).join(', '));
  // 보조 AI가 세우는 변수(allow)라면 "문턱을 내리지 마라"로 낮춘다
  const ai = cp(BASE); ai.secrets[0].tiers[1].when = 'affinity >= 60'; ai.secrets[0].tiers.splice(2, 1);
  const ra = diagnose(ai, FAST);
  ck('AI 담당 변수는 결함이 아니라 low', !ra.findings.some((f) => f.tag === '닫힌 비밀'), ra.findings.map((f) => `${f.tag}:${f.sev}`).join(', '));
}

// ── 템플릿 실물 예시 — rpg '아린의 과거' ──
{
  const rpg = cp(TEMPLATES.rpg?.schema ?? TEMPLATES.rpg);
  ck('rpg 템플릿에 secrets', Array.isArray(rpg.secrets) && rpg.secrets[0].id === 'arin', '');
  ck('★ rpg 템플릿 유효', validateSchema(rpg).ok, JSON.stringify(validateSchema(rpg).errors));
  const rd = diagnose(rpg, { turns: 30, runs: 2 });
  ck('★ rpg 예시는 진단에서 닫힌 비밀이 아니다 (막이 열리면 같이 열린다)', !rd.findings.some((f) => f.tag === '닫힌 비밀'), rd.findings.map((f) => `${f.tag}:${f.sev}`).join(', '));
  let st = engine.initState(rpg);
  st.meta.setupDone = true;   // rpg는 AI 최초설정이 켜진 봇 — 세션 0 동안은 지시문·시나리오·비밀이 전부 빠진다 (설계상 정상)
  const p0 = turn(rpg, st).prompt;
  ck('★ rpg 1막: 낌새만, 감시탑 출신·스승 배신은 없다', p0.includes('시선을 피한다') && !p0.includes('감시탑 출신이다') && !p0.includes('스승이 있었다'), '');
  for (let i = 0; i < 12; i++) st = turn(rpg, st).state;   // shadow 막(scn_turns >= 8) 지나감
  const p1 = turn(rpg, st).prompt;
  ck('★ rpg 2막(shadow)에서 2단계가 열린다', st.vars.sec_arin >= 1 && p1.includes('감시탑 출신이다'), `sec_arin=${st.vars.sec_arin}`);
}

// ── 편집기·규격 배선 (정적) ──
{
  ck('TABS에 [비밀]', src.includes("['secrets', '비밀']"), '');
  ck('[진행] 묶음에 secrets', /\['진행', \['rules', 'scenario', 'secrets'/.test(src), '');
  ck('TAB_SLICES.secrets', src.includes("secrets: { keys: ['secrets'], label: '비밀' }"), '');
  ck('SCHEMA_SECRET_RULES가 통짜 규격서에 합류', src.includes("'## 비밀(secrets) — 밝혀지기 전엔 모델이 몰라야 하는 것이 있는 봇이면 (선택)'"), '');
  ck('최상위 키 목록에 secrets', /최상위 키:[^\n]*`secrets`/.test(src), '');
  ck('탭 규격서 분기', src.includes("tabKey === 'secrets'") && src.includes("'## 비밀 규격'"), '');
  ck('🔒 기능 카드', src.includes("id: 'secrets', icon: '🔒', label: '비밀'"), '');
  ck('areaLabel $.secrets → 비밀', src.includes("if (p.startsWith('$.secrets')) return '비밀';"), '');
  ck('PATH_TABS $.secrets', src.includes("[/^\\$\\.secrets\\b/, '비밀', true]"), '');
  ck('대화 편집기 지도에 [비밀] 탭', src.includes('[비밀] 탭'), '');
  ck('다이제스트 참조 절 (내용은 안 싣는다)', src.includes("'### 비밀 (secrets) — 패치로 못 다룹니다"), '');
  ck('★ 다이제스트가 단계 text를 싣지 않는다 (정적)', !/### 비밀 \(secrets\)[\s\S]{0,1200}\.text/.test(src.slice(src.indexOf("'### 비밀 (secrets)"))), '');
  ck('tabSecrets 존재 + 카드·페르소나 이동 안내', src.includes('function tabSecrets()') && src.includes('그쪽에서 잘라 내고 여기로 옮겨야'), '');
  ck('normalize: 비밀 0개면 secrets 키를 걷는다', src.includes('if (Array.isArray(schema.secrets) && !schema.secrets.length) delete schema.secrets;'), '');
  ck('build.js CORE에 secret (patch 앞)', src.includes('SimCore.define("secret"')
    && src.indexOf('SimCore.define("secret"') < src.indexOf('SimCore.define("patch"'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
