const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.12.0 무대 뒤 (core/front.js, 설계 docs/design-조퇴악녀.md §15) — 유저가 안 봐도 세상은 움직인다.
//
// 검증 축 = 약속 다섯:
//  ① 작중 시간으로 흐른다 — 하루당 rate(시간 체계), 대화만 한 턴은 0, when이 거짓이면 멈춤, 없으면 턴당.
//  ② 은닉 — 시계 값·표면화 전 밑작업은 메인 프롬프트 어디에도 없다(grep). 변화 로그·하이라이트·보조 원장에도 없다.
//  ③ 문턱 — 넘으면 열리고 안 닫힌다. 한 번에 여러 문턱을 넘으면 낮은 순서대로 전부. 결과 효과는 한 번.
//  ④ 표면화 — 통지 한 줄 + 그 단계까지의 밑작업이 열린다. 앞선 징후는 걷힌다.
//  ⑤ 개입·되감기 — { front, add }가 시계를 민다(0~max). 체크포인트 되감기가 시계도 되감는다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const render = SC.require('render');
const frontMod = SC.require('front');
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const cp = (o) => JSON.parse(JSON.stringify(o));

// 단계 글 — 은닉 검사에서 "이 글자가 프롬프트에 있는가"로 쓴다. 다른 어디에도 안 나오는 문장으로.
const HINT1 = '신전 앞 구호소가 요즘 자주 문을 닫는다.';
const BACK2 = '대신관이 구호 자금을 빼돌려 추기경단을 매수했다.';
const SURF3 = '성녀를 이단 심문에 회부한다는 공고가 대신전 앞에 붙었다.';
const BACK3 = '심문의 증거는 대신관이 꾸민 것이다.';
const HINT4 = '성기사들이 밤마다 대신전을 드나든다.';

const BASE = {
  simcore: '0.1', meta: { name: '진영 시계 테스트' },
  time: { start: '2026-04-01 08:00', advance: 'explicit', expose: ['date', 'clock', 'elapsed'] },
  vars: [
    { id: 'awake', label: '각성', type: 'bool', init: true },
    { id: 'exiled', label: '성녀 축출', type: 'bool', init: false },
    { id: 'rep', label: '평판', type: 'int', init: 0, min: -100, max: 100 },
    { id: 'dead', label: '사망', type: 'bool', init: false },
    { id: 'loop', label: '회귀', type: 'int', init: 0, min: 0, max: 99 },
    { id: 'skip_day', label: '일 진행', type: 'int', init: 0, min: 0 },
    { id: 'skip_min', label: '분 진행', type: 'int', init: 0, min: 0, max: 1440 },
  ],
  updater: { allow: [{ id: 'rep', maxDelta: 100 }, { id: 'dead' }, { id: 'skip_day', maxDelta: 3650 }, { id: 'skip_min', maxDelta: 1440 }] },
  fronts: [{
    id: 'temple', about: '대신전', label: '신전의 암투', when: 'awake', rate: 2, stages: [
      { at: 10, hint: HINT1 },
      { at: 30, backstage: BACK2 },
      { at: 50, surface: SURF3, backstage: BACK3, effects: [{ set: 'exiled', expr: 'true' }] },
      { at: 70, hint: HINT4 },
    ] }],
  rules: { events: [
    { id: 'gameover', when: 'dead', effects: [{ set: 'loop', expr: 'loop + 1' }, { checkpoint: 'load' }] },
    { id: 'bookmark', when: 'rep == 1', once: true, effects: [{ checkpoint: 'save' }] },
  ] },
  checkpoint: { keep: ['loop'] },
  secrets: [{ id: 'dianne', kind: 'person', about: '디안느', tiers: [{ text: '대신관 이야기에 입술을 깨문다.' }, { when: 'frs_temple >= 2', text: '대신관을 끌어내릴 증거를 모으고 있었다.' }] }],
  statusUI: { mode: 'auto', changeLog: 'open', groups: [{ label: '상태', items: [{ var: 'rep' }] }] },
  promptState: { template: '지금: {date}' },
};

const RNG = () => 0.5;
const send = (S, st) => engine.sendPhase(S, st, { rng: RNG });
const out = (S, st, ch = {}) => engine.outputPhase(S, st, ch, {}, { rng: RNG });
const turn = (S, st, ch = {}) => { const s = send(S, st); const o = out(S, s.state, ch); return { s, o, st: o.state }; };
const fresh = (S) => { const st = engine.initState(S); st.meta.setupDone = true; return st; };

// ── 옵트인 ──
{
  const S = cp(BASE); delete S.fronts; S.secrets[0].tiers[1].when = 'rep >= 50';
  const st = fresh(S);
  ck('옵트인: fronts 없으면 예약 키 없음', !Object.keys(st.vars).some((k) => k.startsWith('fr_') || k.startsWith('frs_')), JSON.stringify(Object.keys(st.vars)));
  ck('옵트인: 프롬프트 블록 없음', !send(S, st).promptBlock.includes('무대 뒤'), '');
}

// ── 검증 ──
{
  const v = validateSchema(cp(BASE));
  ck('기본 스키마 오류 0', v.errors.length === 0, JSON.stringify(v.errors));
  ck('기본 스키마 무대 뒤 경고 0', !v.warnings.some((w) => /fronts|무대 뒤|시계|문턱|밑작업/.test(w.path + w.msg)), JSON.stringify(v.warnings));
  const bad = (mut, re, name) => { const S = cp(BASE); mut(S); const r = validateSchema(S); ck(name, r.errors.some((e) => re.test(e.msg)), JSON.stringify(r.errors)); };
  bad((S) => { S.fronts[0].stages[1].at = 5; }, /앞 단계보다 커야/, '검증: 문턱 순서 오류');
  bad((S) => { S.fronts[0].stages[3].at = 150; }, /이하의 숫자/, '검증: max 초과 문턱 오류');
  bad((S) => { S.vars.push({ id: 'fr_temple', type: 'int', init: 0 }); }, /예약 이름/, '검증: 예약 이름 충돌 오류');
  bad((S) => { S.fronts[0].id = '1temple'; }, /잘못된 진영 id/, '검증: id 오류');
  bad((S) => { S.rules.events.push({ id: 'x', when: 'rep > 5', effects: [{ front: 'palace', add: '-5' }] }); }, /fronts에 없음/, '검증: 없는 진영 개입 오류');
  bad((S) => { S.rules.events.push({ id: 'x', when: 'rep > 5', effects: [{ front: 'temple' }] }); }, /add/, '검증: add 없는 개입 오류');
  bad((S) => { S.fronts[0].when = 'rand(1,2) > 1'; }, /rand/, '검증: when rand 금지');
  bad((S) => { S.fronts[0].stages = []; }, /최소 1개/, '검증: 문턱 없음 오류');
  const warnOf = (mut, re, name) => { const S = cp(BASE); mut(S); const r = validateSchema(S); ck(name, r.warnings.some((w) => re.test(w.msg)), JSON.stringify(r.warnings)); };
  warnOf((S) => { S.fronts[0].rate = 0; }, /영영 안 흐릅니다/, '검증: 안 흐르는 시계 경고');
  warnOf((S) => { S.fronts[0].stages[3].backstage = '숨은 일'; }, /영영 모델에게 안 갑니다/, '검증: 표면화 없는 밑작업 경고');
  warnOf((S) => { S.fronts[0].stages.push({ at: 90 }); }, /아무 일도 안 일어납니다/, '검증: 빈 문턱 경고');
  warnOf((S) => { S.promptState.template = '{date} {fr_temple}'; }, /숨은 진행을 알게/, '검증: 프롬프트 노출 경고');
  warnOf((S) => { S.statusUI.groups[0].items.push({ var: 'fr_temple' }); }, /유저가 숨은 진행을 봅니다/, '검증: 상태창 노출 경고');
  {
    const S = cp(BASE); S.fronts[0].rate = 0; S.rules.events.push({ id: 'x', when: 'rep > 5', once: true, effects: [{ front: 'temple', add: '20' }] });
    const r = validateSchema(S);
    ck('검증: 효과로만 움직이는 시계는 경고 없음', !r.warnings.some((w) => /영영 안 흐릅니다/.test(w.msg)), JSON.stringify(r.warnings));
  }
  const hits = [];
  for (const [id, t] of Object.entries(TEMPLATES)) {
    const r = validateSchema(cp(t.schema || t));
    for (const m of [...r.errors, ...r.warnings]) if (/fronts|무대 뒤|진영|front/.test(m.msg + m.path)) hits.push(`${id}: ${m.msg}`);
  }
  ck('내장 템플릿 무대 뒤 오탐 0', hits.length === 0, hits.join(' / '));
}

// ── ① 흐름 ──
{
  const S = cp(BASE);
  let st = fresh(S);
  ck('예약 키 시작값', st.vars.fr_temple === 0 && st.vars.frs_temple === -1, JSON.stringify(st.vars));
  st = turn(S, st, {}).st;
  ck('① 대화만 한 턴은 안 흐른다', st.vars.fr_temple === 0, String(st.vars.fr_temple));
  st = turn(S, st, { skip_day: 3 }).st;
  ck('① 사흘이면 +6', st.vars.fr_temple === 6, String(st.vars.fr_temple));
  st = turn(S, st, { skip_min: 720 }).st;
  ck('① 반나절이면 +1', st.vars.fr_temple === 7, String(st.vars.fr_temple));
  st.vars.awake = false;
  st = turn(S, st, { skip_day: 10 }).st;
  ck('① when 거짓이면 멈춤', st.vars.fr_temple === 7, String(st.vars.fr_temple));
  const S2 = cp(BASE); delete S2.time; S2.vars = S2.vars.filter((v) => !v.id.startsWith('skip_')); S2.updater.allow = S2.updater.allow.filter((a) => !a.id.startsWith('skip_'));
  let s2 = fresh(S2);
  s2 = turn(S2, s2).st; s2 = turn(S2, s2).st;
  ck('① 시간 체계 없으면 턴당', s2.vars.fr_temple === 4, String(s2.vars.fr_temple));
}

// ── ②③④ 문턱·은닉·표면화 ──
{
  const S = cp(BASE);
  let st = fresh(S);
  let t = turn(S, st, { skip_day: 5 }); st = t.st; // 10 → 1단계(징후)
  ck('③ 1단계 열림', st.vars.frs_temple === 0, String(st.vars.frs_temple));
  let p = send(S, st).promptBlock;
  ck('② 징후는 프롬프트에 (진영 이름과 함께)', p.includes(`대전 ${HINT1}`) || p.includes(`대신전: ${HINT1}`), p);
  ck('② 징후엔 "이유를 지어내지 마라"', p.includes('이유는 너도 모른다'), '');
  ck('② 시계 값은 프롬프트에 없다', !/fr_temple|frs_temple/.test(p) && !p.includes('신전의 암투'), '');
  t = turn(S, st, { skip_day: 10 }); st = t.st; // 30 → 2단계(밑작업, 아직 비공개)
  p = send(S, st).promptBlock;
  ck('③ 2단계 열림', st.vars.frs_temple === 1, String(st.vars.frs_temple));
  ck('★ 표면화 전 밑작업은 프롬프트 어디에도 없다', !p.includes(BACK2) && !p.includes(BACK3), p);
  ck('② 징후는 아직 깔려 있다', p.includes(HINT1), '');
  ck('② 보조 원장에 무대 뒤 없음', !(st.meta.lastChanges || []).some((l) => /fr_|무대 뒤/.test(l)), JSON.stringify(st.meta.lastChanges));
  const html = render.renderStatusHtml(S, st, t.o.changeLog);
  ck('② 변화 로그·하이라이트에 무대 뒤 없음', !/fr_temple|무대 뒤|신전의 암투/.test(html), '');
  ck('비밀은 아직 1단계', st.vars.sec_dianne === 0, String(st.vars.sec_dianne));
  t = turn(S, st, { skip_day: 10 }); st = t.st; // 50 → 3단계 표면화
  ck('③ 3단계 열림 + 결과 플래그', st.vars.frs_temple === 2 && st.vars.exiled === true, JSON.stringify(st.vars));
  ck('④ 표면화 통지', st.meta.pendingNotifies.includes(SURF3), JSON.stringify(st.meta.pendingNotifies));
  ck('비밀이 같은 턴 표면화를 읽는다 (frs_temple >= 2)', st.vars.sec_dianne === 1, String(st.vars.sec_dianne));
  ck('fired 창구', t.o.firedEvents.includes('front:temple:2'), JSON.stringify(t.o.firedEvents));
  p = send(S, st).promptBlock;
  ck('④ 표면화 후 밑작업 누적 공개 (2·3단계)', p.includes(BACK2) && p.includes(BACK3), p);
  ck('④ 표면화 통지가 프롬프트에', p.includes(SURF3), '');
  ck('④ 앞선 징후는 걷힌다', !p.includes(HINT1), '');
  ck('② 표면화 로그도 유저 화면엔 없다', !/무대 뒤|신전의 암투/.test(render.renderStatusHtml(S, st, t.o.changeLog)), '');
}

// ③ 한 번에 여러 문턱 (한 달 도약)
{
  const S = cp(BASE);
  let st = fresh(S);
  const t = turn(S, st, { skip_day: 40 }); st = t.st; // 80 → 4단계 전부
  ck('③ 한 달 도약: 전 단계 열림', st.vars.frs_temple === 3 && st.vars.fr_temple === 80, JSON.stringify(st.vars));
  ck('③ 결과 효과 한 번', st.vars.exiled === true && t.o.changeLog.filter((c) => c.id === 'exiled').length === 1, '');
  const p = send(S, st).promptBlock;
  ck('④ 표면화 뒤 새 징후는 다시 깔린다', p.includes(HINT4) && !p.includes(HINT1), p);
  // 리롤 안정
  const s1 = send(S, fresh(S)).state;
  ck('리롤 안정', JSON.stringify(out(S, s1, { skip_day: 40 }).state) === JSON.stringify(out(S, s1, { skip_day: 40 }).state), '');
}

// ⑤ 개입 — 선택지가 시계를 늦춘다. 열린 단계는 안 닫힌다
{
  const S = cp(BASE);
  S.rules.events.push({ id: 'intervene', when: 'rep >= 30', once: true, strict: 'last',
    choices: [{ label: '성녀를 돕는다', effects: [{ front: 'temple', add: '-25' }] }, { label: '외면한다' }] });
  const v = validateSchema(S);
  ck('개입 스키마 검증', v.errors.length === 0, JSON.stringify(v.errors));
  let st = fresh(S);
  st = turn(S, st, { skip_day: 10, rep: 30 }).st; // 20, 1단계 열림, 갈림길 걸림
  ck('갈림길 걸림', st.meta.pendingChoice?.id === 'intervene', JSON.stringify(st.meta.pendingChoice));
  st.meta.pendingChoicePick = 0;
  const s = send(S, st);
  ck('⑤ 개입: 20 → 0 (바닥에서 잘림)', s.state.vars.fr_temple === 0, String(s.state.vars.fr_temple));
  ck('⑤ 열린 단계는 안 닫힌다', s.state.vars.frs_temple === 0, String(s.state.vars.frs_temple));
  const o = out(S, s.state, {});
  ck('⑤ 개입도 유저 화면엔 안 보인다', !/fr_temple|무대 뒤/.test(render.renderStatusHtml(S, o.state, [...s.changeLog, ...o.changeLog])), '');
}

// ⑤ 되감기 — 회귀하면 세상의 음모도 그 아침으로
{
  const S = cp(BASE);
  let st = fresh(S);
  st = turn(S, st, { skip_day: 5, rep: 1 }).st; // 10, 저장
  ck('저장 시점 시계', st.checkpoints?.main?.vars.fr_temple === 10, JSON.stringify(st.checkpoints?.main?.vars));
  st = turn(S, st, { skip_day: 25 }).st; // 60 → 표면화
  ck('되감기 전: 표면화됨', st.vars.exiled === true && st.vars.frs_temple === 2, '');
  st = turn(S, st, { dead: true }).st;
  ck('⑤ 되감기: 시계·단계·결과 전부 저장 시점', st.vars.fr_temple === 10 && st.vars.frs_temple === 0 && st.vars.exiled === false, JSON.stringify(st.vars));
  ck('⑤ 되감긴 뒤 밑작업은 다시 비공개', !send(S, st).promptBlock.includes(BACK2), '');
}

// 방치 일정 (편집기 요약)
{
  ck('방치 일정: 5·15·25·35일째', JSON.stringify(engine.frontIdleSchedule(BASE.fronts[0])) === JSON.stringify([5, 15, 25, 35]),
    JSON.stringify(engine.frontIdleSchedule(BASE.fronts[0])));
  ck('방치 일정: 식이면 null', engine.frontIdleSchedule({ ...BASE.fronts[0], rate: 'rep / 10' }) === null, '');
}

// 번들·편집기 (정적)
{
  ck('build.js CORE에 front (engine 앞)', src.includes('SimCore.define("front"') && src.indexOf('SimCore.define("front"') < src.indexOf('SimCore.define("engine"'), '');
  ck('편집기: tabFronts', src.includes('function tabFronts()'), '');
  ck('편집기: 개입 효과 줄', src.includes('sce-effect-front'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
