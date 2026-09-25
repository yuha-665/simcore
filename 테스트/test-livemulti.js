const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.13.0 — 보조 갈림길 여러 벌 · 섞기 · 판정 확률 칩 · 최초 설정이 프리셋 값을 본다.
// 발단: 조퇴악녀 "면접은 면접대로, 평소엔 능력치 판정 선택지(킹덤컴처럼)" + 면접 실기 "실언은 늘 3번, 정답은 늘 1번".
//
// 불변식:
//   · 한 벌(객체) 봇은 예전과 한 글자도 다르지 않다 — 깃발 true, worst 맨 끝, "마지막 항목" 안내
//   · 여러 벌(배열)은 배열 순서대로 추첨, 깃발은 첫 벌 true · 그 뒤 id, 걸린 것엔 벌 id가 산다
//   · 섞는 벌은 안 고르면(타임아웃·strict last) 자리 대신 worst 태그 항목으로 떨어진다
//   · 판정 달린 항목엔 "🎲 판정 N%" — 성공 = total ≥ vs, 렌더마다 같은 숫자, 상태를 안 건드린다
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const choice = SC.require('choice');
const { renderStatusHtml } = SC.require('render');
const { seededRng } = SC.require('rng');
const { TEMPLATES } = SC.require('templates');
const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
const { buildSchemaSpecPrompt } = new Function('validateSchema', 'TEMPLATES', seg + '\nreturn { buildSchemaSpecPrompt };')(validateSchema, TEMPLATES);

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;
const clone = (o) => JSON.parse(JSON.stringify(o));

const S = {
  simcore: '0.1', meta: { name: '여러 벌' },
  vars: [
    { id: 'talk', label: '화술', type: 'int', init: 30, min: 0, max: 100 },
    { id: 'score', label: '점수', type: 'int', init: 0, min: 0, max: 10 },
    { id: 'ask', label: '면접 중', type: 'bool', init: false },
    { id: 'ok', label: '판정 성공', type: 'bool', init: false },
  ],
  checks: [
    { id: 'c_talk', label: '화술', roll: 'rand(1, 20)', mod: 'floor(talk / 10)', vs: '12',
      grades: [{ when: 'total >= vs', label: '성공', effects: [{ set: 'ok', expr: 'true' }] }, { label: '실패', effects: [{ set: 'ok', expr: 'false' }] }] },
    { id: 'c_free', label: '운', roll: 'rand(1, 20)', grades: [{ label: '그냥' }] },
  ],
  rules: { events: [{ id: 'iv', when: 'ask', once: true, liveChoices: 'interview' }] },
  updater: { allow: [{ id: 'score' }] },
  statusUI: { mode: 'auto', groups: [{ label: '나', items: [{ var: 'talk' }] }] },
  liveChoices: [
    { id: 'interview', label: '면접', icon: '📝', when: 'ask', chance: 0, count: [3, 3], shuffle: true, worst: '무난', timeout: 1, showTags: false,
      tags: [{ id: '정답', effects: [{ set: 'score', expr: 'score + 2' }] }, { id: '무난', effects: [{ set: 'score', expr: 'score + 1' }] }, { id: '실언' }] },
    { id: 'stat', label: '능력치', icon: '🎲', when: 'not ask', chance: 1, count: [2, 3], shuffle: true, worst: '그냥', timeout: 2,
      tags: [{ id: '화술', check: 'c_talk' }, { id: '그냥' }] },
  ],
};
const fresh = (Sx = S) => { const s = engine.initState(Sx); s.meta.setupDone = true; s.meta.turn = 1; return s; };
const send = (Sx, st, seed, userText = '') => engine.sendPhase(Sx, st, { rng: seededRng('m', seed, 'send'), userText });
const out = (Sx, st, seed, choices = null) => engine.outputPhase(Sx, st, {}, {}, { rng: seededRng('m', seed, 'out'), choices });
const IV = { desc: '로제타의 질문', items: [{ label: '정답 같은 말', tag: '정답' }, { label: '무난한 말', tag: '무난' }, { label: '실언', tag: '실언' }] };
const ST = { desc: '문지기가 막아선다', items: [{ label: '말로 구슬린다', tag: '화술' }, { label: '돌아간다', tag: '그냥' }] };

console.log('━━ 검증 ━━');
{
  const v = validateSchema(S);
  ck('여러 벌 스키마 통과', v.ok, J(v.errors));
  ck('경고 없음 (liveChoices)', !v.warnings.some((w) => w.path.startsWith('$.liveChoices')), J(v.warnings));
  const bad = (mut) => { const c = clone(S); mut(c); return validateSchema(c); };
  ck('★ 배열인데 id 없으면 오류', bad((c) => { delete c.liveChoices[1].id; }).errors.some((e) => e.path === '$.liveChoices[1].id'), '');
  ck('벌 id 중복 = 오류', bad((c) => { c.liveChoices[1].id = 'interview'; }).errors.some((e) => /중복 벌/.test(e.msg)), '');
  ck('★ 트리거가 없는 벌 id를 부르면 오류', bad((c) => { c.rules.events[0].liveChoices = 'nope'; }).errors.some((e) => /그 id의 보조 갈림길 벌이 없/.test(e.msg)), '');
  ck('shuffle 불 아니면 오류', !bad((c) => { c.liveChoices[0].shuffle = 'yes'; }).ok, '');
  ck('섞는데 worst 없으면 경고', bad((c) => { delete c.liveChoices[1].worst; }).warnings.some((w) => w.path === '$.liveChoices[1].shuffle'), '');
  ck('트리거로만 여는 벌(chance 0)은 경고 없음 — id 트리거를 센다', !validateSchema(S).warnings.some((w) => w.path === '$.liveChoices[0].chance'), '');
}

console.log('━━ 한 벌 봇은 그대로 ━━');
{
  const one = clone(S); one.liveChoices = clone(S.liveChoices[1]); delete one.liveChoices.id; delete one.liveChoices.shuffle;
  delete one.rules;
  ck('한 벌 통과', validateSchema(one).ok, J(validateSchema(one).errors));
  const s = send(one, fresh(one), 1);
  ck('★ 한 벌 깃발은 예전 그대로 true', s.state.meta.liveAsk === true, J(s.state.meta.liveAsk));
  const o = out(one, s.state, 1, ST);
  ck('걸린 것에 벌 id(main)', o.state.meta.pendingChoice?.live?.cfg === 'main', J(o.state.meta.pendingChoice));
  ck('★ 안 섞는 벌은 worst가 맨 끝', o.state.meta.pendingChoice.live.items.at(-1).tag === '그냥', '');
  const html = renderStatusHtml(one, o.state, null, null, { uid: 1 });
  ck('안 섞는 벌 안내는 예전 문구 (마지막 항목)', html.includes('2턴 안에 안 고르면 마지막 항목으로'), html.slice(html.indexOf('sim-choices-hint'), html.indexOf('sim-choices-hint') + 120));
}

console.log('━━ 여러 벌 추첨 · 트리거 ━━');
{
  const s = send(S, fresh(), 1);
  ck('★ 둘째 벌이 붙으면 깃발 = 그 id', s.state.meta.liveAsk === 'stat', J(s.state.meta.liveAsk));
  const p = engine.buildAuxPrompt(S, s.state, '문지기가 창을 가로막았다.', null, '');
  ck('보조 지시는 그 벌 것 (능력치 태그)', p.includes('[능력치 — 선택지 쓰기]') && p.includes('화술') && !p.includes('[면접 — 선택지 쓰기]'), '');
  // 면접 벌은 chance 0 — 이벤트 트리거로만
  let st = fresh(); st.vars.ask = true;
  const s2 = send(S, st, 2);
  ck('when 거짓인 벌은 추첨 안 함 (면접 중엔 능력치 벌 닫힘)', !s2.state.meta.liveAsk, J(s2.state.meta.liveAsk));
  const o2 = out(S, s2.state, 2);
  ck('★ 이벤트 트리거 liveChoices: "interview" → 깃발 = 첫 벌이라 true', o2.state.meta.liveAsk === true && o2.firedEvents.includes('iv'), J(o2.state.meta.liveAsk));
}

console.log('━━ 섞기 · 떨어질 자리 ━━');
{
  let lastTags = new Set();
  let firstTags = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const st = fresh(); st.vars.ask = true; st.meta.liveAsk = true;
    const o = out(S, st, seed, IV);
    const items = o.state.meta.pendingChoice?.live?.items || [];
    if (items.length === 3) { lastTags.add(items[2].tag); firstTags.add(items[0].tag); }
  }
  ck('★ 섞는 벌: 맨 끝 자리가 매번 같은 태그가 아니다 (24 시드)', lastTags.size >= 2, J([...lastTags]));
  ck('★ 맨 앞 자리도 섞인다', firstTags.size >= 2, J([...firstTags]));
  const a = out(S, Object.assign(fresh(), { vars: { ...fresh().vars, ask: true } }), 7, IV);
  const st7 = fresh(); st7.vars.ask = true; st7.meta.liveAsk = true;
  const b1 = out(S, clone(st7), 7, IV).state.meta.pendingChoice.live.items.map((x) => x.tag).join();
  const b2 = out(S, clone(st7), 7, IV).state.meta.pendingChoice.live.items.map((x) => x.tag).join();
  ck('같은 시드 = 같은 순서 (리롤 안정)', b1 === b2, `${b1} / ${b2}`);
  void a;
  // 타임아웃 1 — 안 고르고 직접 답하면 다음 응답 단계에서 worst(무난) 항목
  const st = fresh(); st.vars.ask = true; st.meta.liveAsk = true;
  let o = out(S, st, 3, IV);
  const pos = o.state.meta.pendingChoice.live.items.findIndex((x) => x.tag === '무난');
  st.meta = o.state.meta; let cur = o.state;
  cur = send(S, cur, 4, '저는 아가씨의 쓸모를 증명해 드리고 싶습니다.').state;
  o = out(S, cur, 4);
  ck('★ 타임아웃: 섞여 있어도 worst(무난) 항목이 적용된다 (+1점)', o.state.vars.score === 1 && !o.state.meta.pendingChoice, `score ${o.state.vars.score} · 무난 자리 ${pos + 1}`);
  // fallbackIndex 단위
  const ev = { worst: '무난', choices: [{ tag: '무난' }, { tag: '정답' }, { tag: '실언' }] };
  ck('fallbackIndex: worst 태그 자리', choice.fallbackIndex(ev) === 0 && choice.fallbackIndex({ choices: [{}, {}, {}] }) === 2, '');
  ck('fallbackIndex: 열린 것 중에서만', choice.fallbackIndex(ev, [1, 2]) === 2, '');
  // strict last도 worst로
  const SS = clone(S); SS.liveChoices[0].strict = 'last'; delete SS.liveChoices[0].timeout;
  const s0 = fresh(); s0.vars.ask = true; s0.meta.liveAsk = true;
  let oo = out(SS, s0, 5, IV);
  const f = send(SS, oo.state, 6, '아무 말');
  ck('★ strict last: 섞여 있어도 worst 태그 항목으로 강제', f.forcedChoice?.label === '무난한 말' && f.state.vars.score === 1, J(f.forcedChoice));
  const html = renderStatusHtml(S, out(S, Object.assign(fresh(), {}), 1).state, null, null, { uid: 2 });
  void html;
  const s9 = fresh(); s9.vars.ask = true; s9.meta.liveAsk = true;
  const h9 = renderStatusHtml(S, out(S, s9, 9, IV).state, null, null, { uid: 9 });
  ck('섞고 태그 숨긴 벌 안내: 자리를 말하지 않는다', h9.includes('1턴 안에 안 고르면 시스템이 정한 항목으로') && !h9.includes('마지막 항목'), h9.slice(h9.indexOf('sim-choices-hint'), h9.indexOf('sim-choices-hint') + 140));
}

console.log('━━ 판정 확률 칩 ━━');
{
  const st = fresh();
  const odds = engine.checkOdds(S, st, S.checks[0]);
  ck('★ d20 + 3 ≥ 12 → 60%', odds?.pct === 60 && odds.label === '화술', J(odds));
  st.vars.talk = 0;
  ck('d20 + 0 ≥ 12 → 45%', engine.checkOdds(S, st, S.checks[0]).pct === 45, J(engine.checkOdds(S, st, S.checks[0])));
  st.vars.talk = 100;
  ck('d20 + 10 ≥ 12 → 95%', engine.checkOdds(S, st, S.checks[0]).pct === 95, '');
  ck('vs 없는 판정은 확률 없음', engine.checkOdds(S, st, S.checks[1]) === null, '');
  const before = J(st);
  engine.checkOdds(S, st, S.checks[0]);
  ck('상태를 안 건드린다', J(st) === before, '');
  const s = fresh(); s.meta.liveAsk = 'stat';
  const o = out(S, s, 1, ST);
  const html = renderStatusHtml(S, o.state, null, null, { uid: 3 });
  ck('★ 판정 달린 항목에 🎲 화술 60% 칩', html.includes('🎲 화술 60%'), html.slice(html.indexOf('sim-choices'), html.indexOf('sim-choices') + 600));
  ck('판정 칩이 있으면 태그 꼬리표는 안 단다 · 판정 없는 항목은 태그', !html.includes('sim-choice-tag">화술') && html.includes('sim-choice-tag">그냥'), '');
  ck('태그 보이는 섞는 벌 안내: worst 태그 이름으로', html.includes("'그냥' 항목으로 흘러간다"), '');
  // 고르면 판정 → 등급 효과가 ok를 세운다 (선택지 효과가 읽을 수 있게)
  const i = o.state.meta.pendingChoice.live.items.findIndex((x) => x.tag === '화술');
  o.state.meta.pendingChoicePick = i;
  const f = send(S, o.state, 11);
  ck('고르면 판정이 굴러 [판정] 줄 + 등급 효과', f.promptBlock.includes('[판정] 화술:') && typeof f.state.vars.ok === 'boolean', f.promptBlock.slice(0, 300));
}

console.log('━━ 최초 설정은 프리셋 값을 기본으로 본다 ━━');
{
  const P = clone(S);
  P.setup = { presets: [{ id: 'hi', label: '화술가', set: { talk: 70 } }], ai: { enabled: true, vars: ['talk'] } };
  let st = engine.initState(P);
  st = engine.applyPreset(P, st, 'hi').state;
  const sp = engine.buildSetupPrompt(P, st, '첫 장면');
  ck('★ 기본값 = 프리셋이 정한 값 (70, 스키마 init 30 아님)', sp.includes('기본값 70') && !sp.includes('기본값 30'), sp.split('\n').find((l) => l.includes('talk')));
}

console.log('━━ 규격서 · 편집기 ━━');
{
  const spec = buildSchemaSpecPrompt('politics', true);
  const body = spec.slice(spec.indexOf('```js'));
  ck('★ 규격서 검증기: 코드는 실리고 주석만 있는 줄은 없다', body.includes('function validateSchema') && !/\n\s*\/\/[^\n]*\n/.test(body.slice(0, body.indexOf('\n```', 5))), '');
  ck('규격서가 여러 벌·섞기를 가르친다', src.includes('"liveChoices": [{ "id": "interview"') && src.includes('"shuffle": true'), '');
  ck('편집기: 벌마다 편집 · 한 벌 더 · 섞기 체크', src.includes('function liveSetEditor') && src.includes('+ 갈림길 한 벌 더') && src.includes('항목 순서 섞기'), '');
  ck('편집기: 여러 벌이면 트리거가 고르기', src.includes('발동하면 여는 보조 갈림길'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
