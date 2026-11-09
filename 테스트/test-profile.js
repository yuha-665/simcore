const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.24.0 🔀 프로필 — 한 봇에 판 여러 벌, 채팅마다 하나.
// 커뮤니티 요청(2026-11-09): "한 봇에서 가끔 다른 능력으로 — 스키마를 채팅별로 따로, 프리셋처럼".
// 기본 판 = ⚙simcore, 프로필 = ⚙simcore:<이름>(기본 판에서 달라진 부분만), 이 채팅의 판 = 상태 예약 키 sim_profile.
//   ① 덧칠 — 차이 계산·얹기 왕복, 제작자 업데이트 위에 다시 얹기, 요약·notes 빼기
//   ② 항목 — 이름 검사, 표식/통째 스키마/깨진 글, 옛 이름(aka)
//   ③ 세션 — 이름 적기·엿보기·판 갈아 끼우기, 리롤은 마지막 선택, 되감기는 칸의 판으로
//   ④ 검증 — sim_profile은 예약 키
//   ⑤ 가짜 리수 — 채팅마다 판, 과거 상태창은 그때 판, 새 채팅의 판, 프로필 설치는 덧칠만, 못 얹으면 기본 판, 브리지는 판마다
//   ⑥ 번들 — 유저가 만든 프로필은 남긴다
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const P = SC.require('profile');
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');
const { TEMPLATES } = SC.require('templates');
const { SimSession } = SC.require('session');
const { MapBackend } = SC.require('store');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cp = (o) => JSON.parse(JSON.stringify(o));

const BASE = {
  simcore: '0.1', meta: { name: '프로필 시험' },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100, desc: '다치면 줄고 쉬면 는다' },
    { id: 'gold', label: '금화', type: 'int', init: 10, min: 0 },
  ],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }, { var: 'gold' }] }] },
  updater: { allow: [{ id: 'hp', maxDelta: 10 }, { id: 'gold', maxDelta: 50 }] },
};
const MAGE = cp(BASE);
MAGE.vars.push({ id: 'mana', label: '마나', type: 'int', init: 30, min: 0, max: 100, desc: '주문을 쓰면 준다' });
MAGE.vars[0].max = 80;                                  // 마법사는 몸이 약하다
MAGE.statusUI.groups[0].items.push({ var: 'mana' });
MAGE.updater.allow.push({ id: 'mana', maxDelta: 20 });

// ── ① 덧칠 ──
{
  const all = Object.values(TEMPLATES).map((t) => t.schema || t);
  let bad = 0, n = 0;
  for (const a of all) for (const b of all) { n++; if (P.shapeSig(P.applyOverlay(a, P.diffSchema(a, b))) !== P.shapeSig(b)) bad++; }
  ck(`템플릿 ${all.length}종 서로 덧칠 왕복이 그대로 (${n}쌍 — 편집기 빈 칸 모양까지 같게 재서)`, bad === 0, `${bad}쌍 어긋남`);
  // 편집기 모양 = editor.js normalize — 둘을 같은 입력에 돌려 댄다 (한쪽만 고치면 덧칠에 빈 절이 다시 실린다)
  {
    const ed = fs.readFileSync(__P('../core/editor.js'), 'utf8');
    const a0 = ed.indexOf('  function normalize() {'), b0 = ed.indexOf('\n  normalize();', a0);
    const norm = a0 > 0 && b0 > a0 ? new Function('schema', ed.slice(a0, b0) + '\nnormalize(); return schema;') : null;
    const samples = [...all, {}, { vars: [] }, { assets: { packs: [] } }, { assets: { packs: [], moduleManifests: true } }, { scenario: { acts: [] } }, { secrets: [], fronts: [] },
      { rules: { events: [{ id: 'e' }] } }, { statusUI: { mode: 'template' } }, { setup: { presets: [{ id: 'p' }] } }, { updater: { allow: [{ id: 'x' }] } }];
    const diffs = norm ? samples.filter((x) => P.stable(norm(cp(x))) !== P.stable(P.shapeFill(cp(x)))).length : -1;
    ck(`편집기 모양 = editor normalize (${samples.length}가지 입력)`, diffs === 0, `어긋남 ${diffs}`);
    // 실측 사고: 기본 판을 편집기에 실어 그대로 새 프로필로 저장 → 편집기가 채운 빈 절 일곱 개가 덧칠에 $set으로
    const filled = norm ? norm(cp(BASE)) : P.shapeFill(cp(BASE));
    ck('★ 편집기가 채운 빈 칸은 덧칠이 아니다 (복제 = 빈 덧칠)', JSON.stringify(P.diffSchema(BASE, filled)) === '{}', JSON.stringify(P.diffSchema(BASE, filled)).slice(0, 200));
    const later = cp(BASE); later.directives = [{ id: 'd1', text: '제작자가 나중에 넣은 지시문' }];
    const filledMage = norm ? norm(cp(MAGE)) : P.shapeFill(cp(MAGE));
    ck('★ 그래서 제작자가 나중에 넣은 지시문이 프로필에도 닿는다', (P.applyOverlay(later, P.diffSchema(BASE, filledMage)).directives || []).length === 1, '');
  }
  try {
    const at = JSON.parse(fs.readFileSync(__P('../아틀리에/공방-아틀리에.json'), 'utf8'));
    const at2 = cp(at); at2.vars.push({ id: 'mana', label: '마나', type: 'int', init: 1 }); at2.vars[0].label = '바뀐 이름';
    const ov = P.diffSchema(at, at2);
    ck('큰 봇(아틀리에) — 덧칠은 바뀐 것만이라 작다', JSON.stringify(ov).length < 2000 && JSON.stringify(at).length > 200000,
      `${JSON.stringify(ov).length} / ${JSON.stringify(at).length}`);
    ck('큰 봇 왕복', P.shapeSig(P.applyOverlay(at, ov)) === P.shapeSig(at2), '');
  } catch (e) { ck('아틀리에 스키마 읽기', false, e.message); }

  const ov = P.diffSchema(BASE, MAGE);
  ck('덧칠 모양 — vars는 $list (put 2: mana 새것·hp 바뀜)', ov.vars?.$list?.put?.length === 2 && !ov.vars.$list.del && !ov.vars.$list.order, JSON.stringify(ov.vars));
  ck('같으면 빈 덧칠', JSON.stringify(P.diffSchema(BASE, cp(BASE))) === '{}', '');
  ck('요약 — 변수 +1 ~1 · 상태창 · 보조 AI', JSON.stringify(P.summarizeOverlay(BASE, ov)) === JSON.stringify(['변수 +1 ~1', '상태창', '보조 AI']), JSON.stringify(P.summarizeOverlay(BASE, ov)));
  const re = cp(MAGE); re.vars.reverse();
  ck('순서만 바꿔도 order로 남는다', JSON.stringify(P.diffSchema(BASE, re).vars.$list.order) === JSON.stringify(['mana', 'gold', 'hp']), JSON.stringify(P.diffSchema(BASE, re).vars));
  const withCp = Object.assign(cp(BASE), { checkpoint: { keep: ['gold'] } });
  ck('없어진 키는 $del', JSON.stringify(P.diffSchema(withCp, BASE).$del) === '["checkpoint"]', JSON.stringify(P.diffSchema(withCp, BASE)));
  const gone = cp(BASE); delete gone.updater;
  ck('편집기 모양 절(updater)은 지워도 빈 모양 — 허용 목록을 비운 것으로', JSON.stringify(P.diffSchema(BASE, gone)) === '{"updater":{"model":{"$set":"aux"},"allow":{"$list":{"del":["hp","gold"]}}}}', JSON.stringify(P.diffSchema(BASE, gone)));
  ck('얹기는 기본 판을 안 바꾼다', (() => { const b = cp(BASE); P.applyOverlay(b, ov); return P.stable(b) === P.stable(BASE); })(), '');

  // 제작자 업데이트 — 기본 판이 바뀌어도 덧칠이 그 위에 다시 얹힌다
  const BASE2 = cp(BASE);
  BASE2.vars.push({ id: 'day', label: '날짜', type: 'int', init: 1, min: 1 });   // 제작자가 새 변수
  BASE2.vars[1].desc = '돈 — 제작자가 설명을 고쳤다';                              // 프로필이 안 건드린 항목 수정
  BASE2.vars[0].desc = '제작자가 체력 설명도 고쳤다';                               // 프로필이 고친 항목(hp)
  const M2 = P.applyOverlay(BASE2, ov);
  const byId = Object.fromEntries(M2.vars.map((v) => [v.id, v]));
  ck('업데이트 — 제작자의 새 변수가 프로필에도 생긴다', !!byId.day, M2.vars.map((v) => v.id).join(','));
  ck('업데이트 — 프로필이 안 건드린 항목은 제작자 수정이 닿는다', byId.gold.desc === '돈 — 제작자가 설명을 고쳤다', byId.gold.desc);
  ck('업데이트 — 프로필이 고친 항목은 프로필 것이 이긴다 (통째)', byId.hp.max === 80 && byId.hp.desc === '다치면 줄고 쉬면 는다', JSON.stringify(byId.hp));
  ck('업데이트 — 프로필 변수도 그대로', byId.mana?.init === 30, '');
  ck('업데이트 뒤에도 검증 통과', validateSchema(M2).ok, JSON.stringify(validateSchema(M2).errors.slice(0, 2)));

  // notes 빼기 (배포 번들)
  const withNotes = cp(MAGE); withNotes.meta.notes = '제작 메모';
  const on = P.diffSchema(BASE, withNotes);
  const st = P.stripOverlayNotes(on);
  ck('번들 — 덧칠 속 📌 작업 지침(meta.notes)을 뺀다', on.meta?.notes && !st.meta, JSON.stringify(st.meta));
}

// ── ② 항목 ──
{
  ck('이름 — 빈칸 거부', !!P.checkProfileName(''), '');
  ck("이름 — '기본' 거부", !!P.checkProfileName('기본'), '');
  ck('이름 — 중괄호 거부 (CBS와 헷갈린다)', !!P.checkProfileName('{{x}}'), '');
  ck('이름 — 21자 거부', !!P.checkProfileName('가'.repeat(21)), '');
  ck('이름 — 겹침 거부', !!P.checkProfileName('마법사', ['마법사']), '');
  ck('이름 — 콜론·빈칸 든 이름은 된다', P.checkProfileName('검사: 2회차') === null, '');
  ck('항목 판별 — ⚙simcore·⚙simcore:이름은 스키마, ⚙simcore-pack은 아님',
    P.isSchemaLore({ comment: '⚙simcore' }) && P.isSchemaLore({ comment: '⚙simcore:마법사' }) && !P.isSchemaLore({ comment: '⚙simcore-pack' }), '');
  ck('이름 꺼내기', P.profileNameOf({ comment: '⚙simcore:검사: 2회차' }) === '검사: 2회차' && P.profileNameOf({ comment: '⚙simcore' }) === null, '');
  const ok = P.readProfile(BASE, { comment: '⚙simcore:마법사', content: P.entryContent(P.diffSchema(BASE, MAGE), { desc: '마나를 쓰는 판' }) }, validateSchema);
  ck('읽기 — 표식 항목은 얹고 검증까지', ok.ok && ok.desc === '마나를 쓰는 판' && ok.merged.vars.some((v) => v.id === 'mana'), JSON.stringify(ok.errors));
  const full = P.readProfile(BASE, { comment: '⚙simcore:통째', content: JSON.stringify(MAGE) }, validateSchema);
  ck('읽기 — 통째 스키마를 붙여 넣어도 받는다 (덧칠로 계산)', full.ok && full.full && P.shapeSig(full.merged) === P.shapeSig(MAGE), '');
  const broken = P.readProfile(BASE, { comment: '⚙simcore:깨짐', content: '{broken' }, validateSchema);
  ck('읽기 — 깨진 글은 이유와 함께 못 얹음', !broken.ok && /JSON/.test(broken.error), broken.error);
  const badRef = cp(BASE); badRef.directives = [{ id: 'd1', when: 'mana > 10', text: '마나가 넘친다' }];
  const dangling = P.readProfile(BASE, { comment: '⚙simcore:헛참조', content: P.entryContent(P.diffSchema(BASE, badRef)) }, validateSchema);
  ck('읽기 — 없는 변수를 읽으면 검증 실패로 못 얹음', !dangling.ok && dangling.errors.length > 0, JSON.stringify(dangling.errors.slice(0, 1)));
  const aka = P.readProfiles(BASE, [{ comment: '⚙simcore:대마법사', content: P.entryContent({}, { aka: ['마법사'] }) }, { comment: '⚙simcore:대마법사', content: '{}' }], null);
  ck('같은 이름 항목이 둘이면 앞의 것', aka.length === 1, String(aka.length));
  ck('옛 이름(aka)으로도 찾는다 — 이름을 바꿔도 그 이름을 적어 둔 채팅이 이어진다', P.findProfile(aka, '마법사')?.name === '대마법사', '');
}

// ── ③ 세션 ──
(async () => {
  {
    const be = new MapBackend();
    const s = new SimSession(BASE, be, { chatId: 'c1', prefix: 'sim:t:c1' });
    await s.init(-1);
    ck('프로필 없는 봇 — 상태에 sim_profile을 안 적는다', !('sim_profile' in s.current.vars), JSON.stringify(s.current.vars));
    const s2 = new SimSession(MAGE, be, { chatId: 'c2', prefix: 'sim:t:c2', profile: '마법사' });
    await s2.init(-1);
    ck('프로필 세션 — 시작 상태에 판 이름', s2.current.vars.sim_profile === '마법사' && s2.current.vars.mana === 30, JSON.stringify(s2.current.vars));
    await s2.store.save('boot', 0, s2.current);
    ck('엿보기 — 정합 없이 날것 (boot)', (await s2.peekState(-1))?.vars?.sim_profile === '마법사', '');
    ck('엿보기 — 아무것도 없으면 null', (await new SimSession(BASE, be, { prefix: 'sim:t:none' }).peekState(3)) === null, '');
    s2.useSchema(BASE, '');
    s2.current = engine.reconcileState(BASE, s2.current); s2.stampProfile();
    ck('판 갈아 끼우기 — 이름이 바뀌고 옛 판 변수는 남는다 (돌아오면 이어진다)', s2.current.vars.sim_profile === '' && s2.current.vars.mana === 30, JSON.stringify(s2.current.vars));

    // 리롤은 유저의 마지막 선택 — 판을 바꾼 직후 리롤하면 pre:U는 옛 판 이름을 들고 있다
    const s3 = new SimSession(BASE, be, { chatId: 'c3', prefix: 'sim:t:c3', profile: '' });
    await s3.init(-1); s3.current.meta.setupDone = true;
    await s3.onSend(0); await s3.onOutput(1, '{"changes":{"hp":5},"reasons":{"hp":"x"}}');
    s3.useSchema(MAGE, '마법사'); s3.current = s3.stampProfile(engine.reconcileState(MAGE, s3.current));
    await s3.onSend(0);                                   // 같은 번호 = 리롤
    ck('리롤 — 옛 pre:U(기본 판)가 아니라 지금 판으로 돈다', s3.current.vars.sim_profile === '마법사' && s3.current.vars.mana === 30, JSON.stringify(s3.current.vars));

    // 되감기 — 칸에 실린 판으로 돌아간다 (어댑터가 그 자리에서 판을 갈아 끼운다)
    const CP = { simcore: '0.1', meta: { name: '되감기' },
      vars: [{ id: 'hp', label: '체력', type: 'int', init: 10, min: 0, max: 10 }, { id: 'go', label: '저장', type: 'bool', init: false }, { id: 'dead', label: '사망', type: 'bool', init: false }],
      updater: { allow: [{ id: 'go' }, { id: 'dead' }] },
      rules: { events: [{ id: 'sv', when: 'go', once: true, effects: [{ checkpoint: 'save' }] }, { id: 'over', when: 'dead', once: true, effects: [{ checkpoint: 'load' }] }] },
      statusUI: { mode: 'auto', groups: [] } };
    ck('되감기 시험 스키마 검증', validateSchema(CP).ok, JSON.stringify(validateSchema(CP).errors.slice(0, 2)));
    const s4 = new SimSession(CP, be, { chatId: 'c4', prefix: 'sim:t:c4', profile: '검사' });
    await s4.init(-1); s4.current.meta.setupDone = true;
    await s4.onSend(0); await s4.onOutput(1, '{"changes":{"go":true},"reasons":{"go":"x"}}');
    s4.useSchema(CP, '마법사'); s4.stampProfile();
    await s4.onSend(2);
    ck('되감기 전 — 지금 판은 마법사', s4.current.vars.sim_profile === '마법사', '');
    await s4.onOutput(3, '{"changes":{"dead":true},"reasons":{"dead":"x"}}');
    ck('되감기 — 칸의 판(검사)으로 돌아간다', s4.current.vars.sim_profile === '검사', JSON.stringify(s4.current.vars));
    ck('어댑터 — 출력 뒤 판이 바뀌었으면 그 자리에서 갈아 끼운다', src.includes('if (typeof pNow === \'string\' && pNow !== session.profile) {')
      && src.includes('try { await applyProfileInPlace(pNow); await session.store.save(\'out\', outIndex, session.current); }'), '');
  }

  // ── ④ 검증 ──
  {
    const bad = cp(BASE); bad.vars.push({ id: 'sim_profile', label: '판', type: 'text', init: '' });
    const v = validateSchema(bad);
    ck('sim_profile은 변수 id로 못 쓴다 (예약 키)', !v.ok && v.errors.some((e) => /sim_profile/.test(e.msg)), JSON.stringify(v.errors.slice(0, 1)));
  }

  // ── ⑥ 번들 — 유저가 만든 프로필은 남긴다 (순수 함수를 소스에서 떼어) ──
  {
    const m = src.match(/function applyBundleToChar\(char, data\) \{[\s\S]*?\n  \}/);
    const apply = m ? new Function('return ' + m[0])() : null;
    const char = { globalLore: [{ comment: '⚙simcore', content: '{}' }, { comment: '⚙simcore:내 판', content: 'A' }, { comment: '⚙simcore:마법사', content: '옛것' }, { comment: '옛 로어' }], customscript: [] };
    const out = apply && apply(char, { simcoreBundle: 1, lorebook: [{ comment: '⚙simcore', content: '{"v":2}' }, { comment: '⚙simcore:마법사', content: '새것' }, { comment: '새 로어' }] });
    const names = out ? out.globalLore.map((l) => l.comment) : [];
    ck('번들 — 번들에 없는 내 프로필은 남는다', names.includes('⚙simcore:내 판'), JSON.stringify(names));
    ck('번들 — 같은 이름은 번들 것 (중복 없음)', names.filter((x) => x === '⚙simcore:마법사').length === 1 && out.globalLore.find((l) => l.comment === '⚙simcore:마법사').content === '새것', '');
    ck('번들 — 그 밖의 로어는 여전히 통째 교체', !names.includes('옛 로어') && names.includes('새 로어'), '');
  }

  // ── ⑤ 가짜 리수 ──
  const LORE_BASE = { comment: '⚙simcore', key: ' __simcore_never__', content: JSON.stringify(BASE) };
  const LORE_MAGE = { comment: '⚙simcore:마법사', key: ' __simcore_never__', content: P.entryContent(P.diffSchema(BASE, MAGE), { desc: '마나를 쓰는 판' }) };
  const mk = (hp, turn, extra = {}) => JSON.stringify({ vars: { hp, gold: 10, ...extra },
    meta: { turn, setupDone: true, armed: {}, actionLastUsed: {}, eventLastFired: {}, firedOnce: {}, pendingNotifies: [] } });
  const world = {
    chaIdx: 0, chatIdx: 0,
    chars: [
      { chaId: 'c-plain', name: '스키마 없는 봇', globalLore: [], triggerscript: [] },
      { chaId: 'c-sim', name: '프로필 봇', globalLore: [], triggerscript: [] },
    ],
    chats: {
      'c-plain:0': { id: 'p0', message: [] },
      'c-sim:0': { id: 'ch1', message: [{ role: 'char', data: '첫 장면 ⟦simcore:0⟧' }, { role: 'user', data: '진행' }, { role: 'char', data: '두 번째 장면 ⟦simcore:2⟧' }] },
      'c-sim:1': { id: 'ch2', message: [] },
      'c-sim:2': { id: 'ch3', message: [] },
    },
  };
  const store = new Map(Object.entries({
    'sim:c-sim:ch1:out:0': mk(90, 1),                                   // 기본 판 시절
    'sim:c-sim:ch1:out:2': mk(30, 2, { mana: 7, sim_profile: '마법사' }), // 마법사로 바꾼 뒤
  }));
  const cur = () => world.chars[world.chaIdx];
  const chatKey = () => `${cur().chaId}:${world.chatIdx}`;
  global.Risuai = {
    getCharacter: async () => cp(cur()),
    setCharacter: async (c) => { world.chars[world.chaIdx] = cp(c); },
    getCurrentCharacterIndex: async () => world.chaIdx,
    getCurrentChatIndex: async () => world.chatIdx,
    getChatFromIndex: async () => cp(world.chats[chatKey()] ?? { id: 'x', message: [] }),
    setChatToIndex: async (_a, _b, c) => { world.chats[chatKey()] = cp(c); },
    registerButton: async () => {}, unregisterUIPart: async () => {}, registerSetting: async () => {},
    addRisuReplacer: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    addRisuScriptHandler: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    showContainer: async () => {}, alert: async () => {}, getArgument: async () => 'off',
    onUnload: async (fn) => { global.__unload = fn; }, runLLMModel: async () => ({ success: false }),
    pluginStorage: {
      getItem: async (k) => (store.has(k) ? store.get(k) : null),
      setItem: async (k, v) => { store.set(k, v); },
      removeItem: async (k) => { store.delete(k); },
      keys: async () => [...store.keys()],
    },
  };
  const el = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    children: [], appendChild() {}, append() {}, remove() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : undefined), set: () => true });
  global.document = { createElement: el, getElementById: () => null, body: el(), querySelector: () => null, querySelectorAll: () => [], head: el(), addEventListener() {} };
  global.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  (0, eval)(src);
  await sleep(120);
  const H = globalThis.__simcoreProfile;
  ck('테스트 배수구 __simcoreProfile', !!H && typeof H.switchProfile === 'function', '');
  world.chars[1].globalLore = [LORE_BASE, LORE_MAGE, { comment: '세계관', content: '평범한 로어' }];
  world.chaIdx = 1;
  await sleep(2400);

  let S = H.state();
  ck('로드 — 이 채팅의 최신 스냅샷이 적은 판(마법사)으로', S.currentProfile === '마법사' && S.schema.vars.some((v) => v.id === 'mana'), `${S.currentProfile} / ${S.schema?.vars?.map((v) => v.id)}`);
  ck('로드 — 값은 그대로 (hp 30 · mana 7)', S.session.current.vars.hp === 30 && S.session.current.vars.mana === 7, JSON.stringify(S.session.current.vars));
  ck('로드 — 프로필 목록 1개, 얹힘', S.profileList.length === 1 && S.profileList[0].ok, JSON.stringify(S.profileList.map((p) => [p.name, p.ok, p.error])));
  ck('기본 판은 그대로 따로', S.baseSchema && !S.baseSchema.vars.some((v) => v.id === 'mana'), '');
  const disp = global.__hooks?.display;
  const now = String(disp('두 번째 장면 ⟦simcore:2⟧') ?? '');
  const old = String(disp('첫 장면 ⟦simcore:0⟧') ?? '');
  const body = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/\s+/g, ' ');
  ck('★ 최신 상태창 = 마법사 판 (마나 7)', now.includes('마나') && /\b7\b|>7</.test(now), body(now).slice(0, 300));
  ck('★ 과거 상태창 = 그때 판 (기본 — 마나 칸 없음, hp 90)', !old.includes('마나') && /90/.test(old), body(old).slice(0, 400));

  // 새 채팅 — 저장된 "새 채팅의 판"이 없으면 기본 판
  world.chatIdx = 1;
  await sleep(1800);
  S = H.state();
  ck('새 채팅 — 고른 적 없으면 기본 판', S.currentProfile === '' && !S.schema.vars.some((v) => v.id === 'mana'), String(S.currentProfile));
  await H.switchProfile('마법사');
  S = H.state();
  ck('시작 전 판 바꾸기 — 새 판의 시작값으로 (mana 30, hp 50)', S.currentProfile === '마법사' && S.session.current.vars.mana === 30 && S.session.current.vars.hp === 50, JSON.stringify(S.session.current.vars));
  ck('상태에 판 이름', S.session.current.vars.sim_profile === '마법사', '');
  ck('시작 전 슬롯(boot)에 저장', JSON.parse(store.get('sim:c-sim:ch2:boot:0') || '{}')?.vars?.sim_profile === '마법사', String(store.get('sim:c-sim:ch2:boot:0')).slice(0, 120));
  ck('"새 채팅의 판"으로 캐릭터에 저장', store.get('sim:start-profile:c-sim') === '"마법사"', String(store.get('sim:start-profile:c-sim')));
  ck('채팅 변수 미러 $sim_profile (로어북 CBS가 읽는다)', world.chats['c-sim:1'].scriptstate?.$sim_profile === '마법사', JSON.stringify(world.chats['c-sim:1'].scriptstate));
  world.chatIdx = 2;
  await sleep(1800);
  S = H.state();
  ck('다른 새 채팅 — 마지막으로 고른 판으로 시작', S.currentProfile === '마법사' && S.session.current.vars.mana === 30, String(S.currentProfile));

  // 프로필에 설치 — 덧칠만, 기본 판은 안 바뀐다. 브리지가 있으면 판마다 굽는다
  world.chars[1].triggerscript = [{ comment: 'simcore-bridge', type: 'output', effect: [{ type: 'triggerlua', code: '-- old' }] }];
  const MAGE2 = cp(MAGE); MAGE2.vars.find((v) => v.id === 'mana').max = 200;
  const baseBefore = world.chars[1].globalLore.find((l) => l.comment === '⚙simcore').content;
  const r = await H.install(MAGE2, '마법사');
  const entry = world.chars[1].globalLore.find((l) => l.comment === '⚙simcore:마법사');
  const parsed = JSON.parse(entry.content);
  ck('프로필 설치 성공', r.ok, JSON.stringify(r));
  ck('프로필 항목 = 표식 + 덧칠 (작다)', parsed.simcoreProfile === 1 && entry.content.length < 1500, `${entry.content.length}바이트`);
  ck('설명(desc)은 지킨다', parsed.desc === '마나를 쓰는 판', parsed.desc);
  ck('기본 판은 그대로', world.chars[1].globalLore.find((l) => l.comment === '⚙simcore').content === baseBefore, '');
  ck('설치본 되읽기 — 마나 최대 200', H.installedSchemaFor('마법사')?.vars?.find((v) => v.id === 'mana')?.max === 200, '');
  ck('바꾸기 전 판을 백업 (↶ 되돌리기)', [...store.keys()].some((k) => k.startsWith('sim:profile-backup:c-sim:')), '');
  const code = world.chars[1].triggerscript[0].effect[0].code;
  ck('루아 브리지 — 판마다 굽는다 (sim_profile로 고름)', code.includes('local SIMCORE_P = {') && code.includes('n = "마법사"') && code.includes('simcorePick(id)'), code.slice(0, 200));
  ck('설치 뒤에도 이 채팅은 마법사 판', H.state().currentProfile === '마법사', '');

  // 못 얹는 판 — 기본 판으로 돌고 알린다 (이름은 지킨다)
  world.chars[1].globalLore.push({ comment: '⚙simcore:깨짐', key: ' __simcore_never__', content: '{broken' });
  await H.install(BASE, '');                                  // 재로드 (기본 판 같은 내용으로)
  await H.applyProfileInPlace('깨짐');
  S = H.state();
  ck('못 얹는 판 — 기본 판으로 돈다', S.currentProfile === '깨짐' && !S.schema.vars.some((v) => v.id === 'mana'), String(S.currentProfile));
  ck('못 얹는 판 — 알림', /못 얹었어요/.test(S.profileNote || ''), String(S.profileNote));
  await H.applyProfileInPlace('');
  ck('기본 판으로 — 알림이 걷힌다', H.state().profileNote === null && H.state().currentProfile === '', '');

  // 배선 (정적)
  ck('패널 — 현황 새 시작 카드에 판 고르기 자리', src.includes('<div id="sc-profiles" class="sc-card-body sc-profile-box" style="display:none"></div>'), '');
  ck('패널 — 작업공간 🔀 프로필 카드', src.includes('<div id="sc-profile-manage" class="sc-card-body">-</div>'), '');
  ck('진행 중 판 바꾸기는 두 번 누르기 (규칙 #6)', src.includes("if (!fresh && !armed) { profileArm = { name: it.name, until: Date.now() + 8000 }; renderPanel(); return; }"), '');
  ck('[캐릭터에 적용]은 편집기가 고치는 판에만', src.includes('const prof = editorProfile; // 🔀 편집기가 고치는 판에만 (v1.24.0)')
    && src.includes('const r = await installSchemaToCurrentChar(parsed, prof);'), '');
  ck('편집기 생성 맥락·인물 찾기에서 프로필 항목을 뺀다', src.includes('const all = (char.globalLore || []).filter((l) => !profileMod.isSchemaLore(l));')
    && src.includes('const pool = lore.filter((l) => l && !profileMod.isSchemaLore(l));'), '');
  ck('세이브 가져오기 — 세이브의 판으로 먼저', (src.match(/if \(session && sp !== null && sp !== \(currentProfile \?\? ''\)\) await applyProfileInPlace\(sp\);/g) || []).length === 2, '');
  ck('제거 — 프로필은 남기고 알린다', src.includes('🔀 프로필 ${keptProfiles}개는 로어북에 남겨 뒀어요'), '');

  try { await global.__unload?.(); } catch { /* 정리 실패는 결과와 무관 */ }
  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
