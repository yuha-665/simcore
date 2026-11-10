const __P = (...p) => require('path').resolve(__dirname, ...p);
// 🔀 프로필(v1.24.0) 실기용 번들 — 깡통봇(로어북·정규식 없는 빈 캐릭터)에 [번들 가져와 교체] 한 번이면 판 세 벌이 선다.
//
//   node 프로필시험/make-bundle.js   → 프로필시험-번들.json   ← 리수 💾 세이브 탭 [번들 가져와 교체]
//
// 판
//   기본     — 평범한 여행자: 체력 100 · 금화 30 · 장소 · 소지품, 🏕 휴식
//   마법사   — 체력 70(바뀐 항목) · 마나 50(새 변수) · 🔮 명상(새 버튼) · 마나 바닥 지시문 · 지팡이
//   생존     — 금화 없음(지운 변수) · 배고픔이 매 턴 +1(매 턴 정산) · 🍞 빵 먹기(빵이 있을 때만 뜨는 버튼)
//   깨진 판  — 일부러 못 얹게 만든 판: 고르면 기본 판으로 돌고 🔀 알림이 떠야 정상
// 로어북 '판 안내'는 {{getvar::sim_profile}}로 판마다 다른 글을 메인에 싣는다 — 채팅 변수 미러 시험.
//
// 덧칠은 손으로 안 쓴다 — 판마다 통째 스키마를 만들고 엔진의 profile.diffSchema로 잰다(플러그인이 저장하는 것과 같은 길).
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const P = SC.require('profile');
const { validateSchema } = SC.require('validate');
const { SimSession } = SC.require('session');
const { MapBackend } = SC.require('store');
const cp = (o) => JSON.parse(JSON.stringify(o));

let bad = 0;
const ok = (n, c, got = '') => { console.log(`  ${c ? '✓' : '❗'} ${n}${got ? ' → ' + got : ''}`); if (!c) bad++; };

// ── 기본 판 ──
const BASE = {
  simcore: '0.1',
  meta: { name: '프로필 시험 · 기본', author: 'SimCore', notes: '프로필 실기용 깡통봇 번들 — 프로필시험/make-bundle.js가 만든다' },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 100, min: 0, max: 100, desc: '다치면 줄고, 쉬거나 치료받으면 는다' },
    { id: 'gold', label: '금화', type: 'int', init: 30, min: 0, format: '{v}G', desc: '사고팔거나 보수를 받을 때만 움직인다' },
    { id: 'place', label: '장소', type: 'text', init: '국경 마을 하늘재', maxLength: 40, desc: '주인공이 지금 있는 곳 — 장소를 옮겼을 때만' },
    { id: 'bag', label: '소지품', type: 'list', init: ['빵', '물통'], maxItems: 10, itemMaxLength: 20, desc: '얻으면 넣고 쓰거나 잃으면 뺀다' },
  ],
  rules: {
    onTurn: [],
    events: [
      { id: 'downed', when: 'hp <= 0', once: true, notify: '주인공이 쓰러졌다. 누군가의 도움이 필요하다.' },
    ],
  },
  directives: [
    { id: 'hurt', when: 'hp <= 30', text: '[상태] 크게 다친 몸이다 (체력 {hp}). 움직임과 말에 고통이 묻어나야 한다.' },
  ],
  actions: [
    { id: 'rest', label: '🏕 휴식', mode: 'oneshot', cooldown: 2,
      inject: '[플레이어 액션] 자리를 펴고 한숨 돌린다.',
      effects: [{ set: 'hp', expr: 'min(hp + 30, 100)' }] },
  ],
  updater: {
    model: 'aux',
    allow: [
      { id: 'hp', maxDelta: 40 },
      { id: 'gold', maxDelta: 100 },
      { id: 'place', maxLength: 40 },
      { id: 'bag' },
    ],
    guide: '서사에 명시된 것만 반영한다. 다침·회복·거래·이동·획득이 실제로 일어났을 때만.',
  },
  promptState: {
    position: 'history_end',
    template: '[여행 기록 — {place}]\n체력 {hp}/100 | 금화 {gold}G\n소지품: {bag}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto',
    groups: [
      { label: '여행자', items: [{ var: 'hp', bar: { max: 100 } }, { var: 'gold' }] },
      { label: '소지', items: [{ var: 'place' }, { var: 'bag' }] },
    ],
  },
};

// ── 마법사: 바뀐 항목(hp) · 새 변수(mp) · 새 버튼 · 새 지시문 · 바뀐 시작값(bag) ──
const MAGE = cp(BASE);
MAGE.meta.name = '프로필 시험 · 마법사';
Object.assign(MAGE.vars.find((v) => v.id === 'hp'), { init: 70, max: 70, desc: '몸이 약하다 — 다치면 줄고, 쉬거나 치료받으면 는다' });
MAGE.vars.find((v) => v.id === 'bag').init = ['빵', '물통', '낡은 지팡이'];
MAGE.vars.splice(1, 0, { id: 'mp', label: '마나', type: 'int', init: 50, min: 0, max: 50, desc: '주문을 쓰면 준다 — 주문의 크기만큼' });
MAGE.directives.push({ id: 'no_mana', when: 'mp <= 10', text: '[상태] 마나가 바닥났다 (마나 {mp}). 큰 주문은 쓸 수 없다.' });
MAGE.actions.find((a) => a.id === 'rest').effects = [{ set: 'hp', expr: 'min(hp + 20, 70)' }];
MAGE.actions.push({ id: 'meditate', label: '🔮 명상', mode: 'oneshot', cooldown: 2,
  inject: '[플레이어 액션] 눈을 감고 마나를 가다듬는다.',
  effects: [{ set: 'mp', expr: 'min(mp + 20, 50)' }] });
MAGE.updater.allow.splice(1, 0, { id: 'mp', maxDelta: 30 });
MAGE.promptState.template = '[여행 기록 — {place}]\n체력 {hp}/70 | 마나 {mp}/50 | 금화 {gold}G\n소지품: {bag}';
MAGE.statusUI.groups[0] = { label: '마법사', items: [{ var: 'hp', bar: { max: 70 } }, { var: 'mp', bar: { max: 50 }, color: "'#5b8def'" }, { var: 'gold' }] };

// ── 생존: 지운 변수(gold) · 매 턴 정산 · 조건부 버튼 ──
const SURV = cp(BASE);
SURV.meta.name = '프로필 시험 · 생존';
SURV.vars = SURV.vars.filter((v) => v.id !== 'gold');
SURV.vars.find((v) => v.id === 'bag').init = ['빵', '물통', '부싯돌'];
SURV.vars.splice(1, 0, { id: 'hunger', label: '배고픔', type: 'int', init: 0, min: 0, max: 10, desc: '매 턴 시스템이 1씩 올린다 — 먹었을 때만 내린다' });
SURV.rules.onTurn = [{ set: 'hunger', expr: 'min(hunger + 1, 10)' }];
SURV.directives.push({ id: 'starving', when: 'hunger >= 7', text: '[상태] 몹시 배고프다 (배고픔 {hunger}/10). 먹을 것 생각이 머리를 떠나지 않는다.' });
SURV.actions.push({ id: 'eat', label: '🍞 빵 먹기', mode: 'oneshot', when: "has(bag, '빵')",
  inject: '[플레이어 액션] 빵을 꺼내 먹는다.',
  effects: [{ list: 'bag', remove: ['빵'] }, { set: 'hunger', expr: 'max(hunger - 5, 0)' }] });
SURV.updater.allow = SURV.updater.allow.filter((a) => a.id !== 'gold');
SURV.updater.allow.push({ id: 'hunger', maxDelta: 5 });
SURV.updater.guide = '서사에 명시된 것만 반영한다. 이 세계엔 돈이 없다. 배고픔은 무언가를 먹었을 때만 내린다(오르는 건 시스템 몫).';
SURV.promptState.template = '[생존 기록 — {place}]\n체력 {hp}/100 | 배고픔 {hunger}/10\n소지품: {bag}';
SURV.statusUI.groups[0] = { label: '생존자', items: [{ var: 'hp', bar: { max: 100 } }, { var: 'hunger', bar: { max: 10 }, color: "hunger >= 7 ? '#c0392b' : '#d9a441'" }] };

// ── 깨진 판: 체력을 지웠는데 상태창·지시문·버튼은 그대로 hp를 읽는다 → 검증 실패 ──
const BROKEN = cp(BASE);
BROKEN.meta.name = '프로필 시험 · 깨진 판';
BROKEN.vars = BROKEN.vars.filter((v) => v.id !== 'hp');

console.log('━━ 프로필 시험 번들 ━━');
const vb = validateSchema(BASE);
ok('기본 판 검증', vb.ok, vb.ok ? `경고 ${vb.warnings.length}` : JSON.stringify(vb.errors.slice(0, 3)));

const PROFILES = [
  { name: '마법사', schema: MAGE, desc: '몸이 약한 대신 마나로 주문을 쓴다 — 체력 70 · 마나 50 · 🔮 명상' },
  { name: '생존', schema: SURV, desc: '돈이 없는 세계 — 배고픔이 매 턴 오르고 🍞 빵으로 내린다' },
  { name: '깨진 판', schema: BROKEN, desc: '일부러 깨 둔 판 — 고르면 기본 판으로 돌고 🔀 알림이 떠야 정상' },
];
const entries = [];
for (const p of PROFILES) {
  const overlay = P.diffSchema(BASE, p.schema);
  const lore = { comment: P.profileComment(p.name), key: ' __simcore_never__', secondkey: '', insertorder: 0,
    content: P.entryContent(P.stripOverlayNotes(overlay), { desc: p.desc }), mode: 'normal', alwaysActive: false, selective: false };
  const item = P.readProfile(BASE, lore, validateSchema);   // 플러그인이 로어북을 읽는 길 그대로
  const roundTrip = P.shapeSig(P.applyOverlay(BASE, overlay)) === P.shapeSig(p.schema);
  const sum = P.summarizeOverlay(BASE, overlay).join(' · ');
  if (p.name === '깨진 판') {
    ok(`${p.name} — 못 얹힌다 (검증 실패가 정상)`, !item.ok && item.errors.length > 0, item.errors.slice(0, 2).map((e) => e.msg).join(' / '));
  } else {
    ok(`${p.name} — 얹은 판 검증`, item.ok, item.ok ? `경고 ${item.warnings.length} · ${sum}` : JSON.stringify(item.errors.slice(0, 3)));
  }
  ok(`${p.name} — 덧칠 왕복이 그대로`, roundTrip);
  ok(`${p.name} — 항목이 작다 (통째 사본 아님)`, lore.content.length < JSON.stringify(p.schema).length, `${lore.content.length}바이트 / 통째 ${JSON.stringify(p.schema).length}`);
  entries.push({ lore, item });
}

// ── 판마다 몇 턴 굴려 보기 (세션 그대로 — 상태에 판 이름이 적히는지, 매 턴 정산이 도는지) ──
(async () => {
  for (const { lore, item } of entries.filter((e) => e.item.ok)) {
    const be = new MapBackend();
    const s = new SimSession(item.merged, be, { chatId: 'c', prefix: 'sim:t:c', profile: item.name });
    await s.init(-1); s.current.meta.setupDone = true;
    for (let i = 0; i < 3; i++) { await s.onSend(i * 2); await s.onOutput(i * 2 + 1, '{"changes":{},"reasons":{}}'); }
    const v = s.current.vars;
    ok(`${item.name} — 세 턴 뒤 상태에 판 이름`, v.sim_profile === item.name, String(v.sim_profile));
    if (item.name === '마법사') ok('마법사 — 시작값 (체력 70 · 마나 50 · 지팡이)', v.hp === 70 && v.mp === 50 && v.bag.includes('낡은 지팡이'), JSON.stringify(v));
    if (item.name === '생존') ok('생존 — 금화 없음 · 배고픔이 턴마다 오른다', !('gold' in v) && v.hunger >= 2, JSON.stringify(v));
  }

  // ── 로어북 ──
  const lorebook = [
    { comment: '세계관', key: '', secondkey: '', insertorder: 100, mode: 'normal', alwaysActive: true, selective: false,
      content: '[세계관]\n소박한 판타지 세계. 이야기는 국경 마을 하늘재에서 시작한다. 산길 너머로 옛 왕국의 폐허가 있고, 마을에는 여관 하나와 대장간, 작은 시장이 있다.\n'
        + '{{char}}는 주인공({{user}})의 여행을 그리는 이야기꾼이다. 한 응답에 한 장면만 그리고, 다음 행동은 {{user}}에게 맡긴다.' },
    { comment: '판 안내', key: '', secondkey: '', insertorder: 90, mode: 'normal', alwaysActive: true, selective: false,
      content: '{{#when::{{getvar::sim_profile}}::is::마법사}}[이번 판: 마법사] {{user}}는 견습 마법사다. 주문을 쓸 때마다 마나가 든다. 몸은 약하다.{{/when}}'
        + '{{#when::{{getvar::sim_profile}}::is::생존}}[이번 판: 생존] 이 세계에는 돈이 없다. 먹을 것을 구하는 게 하루의 일이다. 시장은 물물교환뿐이다.{{/when}}' },
    { comment: '⚙simcore', key: ' __simcore_never__', secondkey: '', insertorder: 0, mode: 'normal', alwaysActive: false, selective: false,
      content: JSON.stringify((() => { const s = cp(BASE); delete s.meta.notes; return s; })()) },
    ...entries.map((e) => e.lore),
  ];
  ok('판 안내 — 마법사·생존 둘 다 CBS 분기', /::is::마법사}}/.test(lorebook[1].content) && /::is::생존}}/.test(lorebook[1].content));
  ok('스키마 항목은 절대 안 뜨는 보관함', lorebook.filter((l) => P.isSchemaLore(l)).every((l) => l.alwaysActive === false && /__simcore_never__/.test(l.key)));
  ok('작업 지침(meta.notes)은 번들에서 뺀다', !lorebook.some((l) => /make-bundle\.js가 만든다/.test(l.content)));

  const bundle = { simcoreBundle: 1, name: '프로필 시험 (깡통봇용)', lorebook };
  // 플러그인의 번들 검사·적용을 그대로 — 깡통봇에 적용하면 이 로어북이 된다
  const m = src.match(/function bundleShapeError\(data\) \{[\s\S]*?\n  \}/);
  const a = src.match(/function applyBundleToChar\(char, data\) \{[\s\S]*?\n  \}/);
  const shapeErr = m ? new Function('return ' + m[0])()(bundle) : '검사 함수를 못 찾음';
  ok('플러그인 번들 검사 통과', shapeErr === null, String(shapeErr));
  const blank = a ? new Function('return ' + a[0])()({ name: '깡통', globalLore: [], customscript: [{ comment: '내 정규식' }] }, cp(bundle)) : null;
  ok('깡통봇에 적용 — 로어북 그대로 · 카드 정규식 안 건드림', blank && blank.globalLore.length === lorebook.length && blank.customscript.length === 1, blank ? `${blank.globalLore.length}항목` : '');
  const listed = P.readProfiles(JSON.parse(lorebook[2].content), blank ? blank.globalLore : [], validateSchema);
  ok('적용 뒤 프로필 목록 3개 (얹힘 2 · 못 얹음 1)', listed.length === 3 && listed.filter((p) => p.ok).length === 2, listed.map((p) => `${p.name}:${p.ok ? 'ok' : 'x'}`).join(', '));

  if (bad) { console.log(`\n❗ ${bad}건 — 출력하지 않는다`); process.exit(1); }
  fs.writeFileSync(__P('프로필시험-번들.json'), JSON.stringify(bundle, null, 2));
  console.log(`\n저장: 프로필시험-번들.json (${(fs.statSync(__P('프로필시험-번들.json')).size / 1024).toFixed(1)}KB) ← 깡통봇에서 💾 [번들 가져와 교체]`);
})();
