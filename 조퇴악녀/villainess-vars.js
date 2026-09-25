const __P = (...p) => require('path').resolve(__dirname, ...p);
// 조기퇴장 악녀에 빙의해버렸다 — 원작 탈출 사망회귀 시나리오 (docs/design-조퇴악녀.md)
//
// 원본 봇: 세계관 + 인물 사전 27명 + 원작 줄거리 요약 4막(상시 로어북, 기본 꺼짐). 숫자 상태 0개.
// 이 생성기가 그 위에 진행 장치를 얹는다 — 1부 = 서장 + 원작 4막(1~4장) + 5장 심판 + 원작 이후. 2부는 막을 뒤에 덧붙인다(세이브 안 깨짐).
//
// 출처 꼬리표 (설계 §11~16):
//   [원본] 로어북에 적힌 사실 — 원작 사건 순서·인물 성격·비밀 내용
//   [유저] 2026-09-25 결정 — 시점 둘, 시종 면접, 사망 회귀, 호감은 성별 무관·결말 인물만, 시종은 페르소나
//   [초안] 진행 장치 — 수치·선택지·면접 채점·무대 뒤 문턱 문장·데뷔탕트 날짜
//
// 실행: node 조퇴악녀/villainess-vars.js  →  조퇴악녀-스키마.json (+ 자체 시험). 번들은 convert-lorebook.js
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const { seededRng } = SC.require('rng');

// ══════════ 인물 — 호감 칸은 "줄기의 문·결말 선택지를 여는 인물"만 [유저 §16] ══════════
// 관계의 거리 하나(0~100). 우정·충성·연애 중 어디로 자랄지는 유저가 정한다 — 성별로 짐작하지 않는다.
// mentions = 낱말 게이트: 보조는 그 인물이 등장한 턴에만 그 칸을 본다 (인물이 늘어도 평턴 비용 0).
const PEOPLE = [
  // id, 라벨, 초기, 낱말, 비고
  ['elicia', '엘리시아', 30, ['엘리시아', '리샤'], '원작 여주. 남들이 움츠러드는 로제타의 적의 밑에서 상처를 알아보는 사람 [원본]'],
  ['ert', '에르테미안', 10, ['에르테미안', '엘테', '황태자'], '황태자. 원작에서 엘리시아에게 호의를 보이고 4막에서 로제타를 제압한다 [원본]'],
  ['rical', '리칼', 5, ['리칼'], '이복오빠. 로제타를 가문의 수치라 부른다 [원본]'],
  ['duke', '카르디온 공작', 5, ['카르디온 공작', '공작 전하', '공작님', '아버지'], '로제타를 유리창 보듯 지나쳐 본다 [원본]'],
  ['anna', '안나', 85, ['안나'], '열 살 때부터 로제타를 돌본 전속 시녀. 로제타가 가면을 벗는 유일한 사람 [원본]'],
  ['rosetta', '로제타', 15, ['로제타', '로즈', '아가씨'], '시종·빙의자 로제타 시점 전용 — 로제타가 유저를 믿는 정도'],
];

// ══════════ 원작의 흐름 — 무대 뒤 진영 시계 [초안, 씨앗은 원본: 로니카의 조롱·로제타의 첫 데뷔탕트 망신] ══════════
const CANON = {
  id: 'canon', about: '사교계', label: '원작의 흐름',
  // 1부 내내 흐른다(원작 이후엔 멈춘다). 문턱 문장은 어느 장에서 넘어도 맞게 — 단계엔 장 조건이 없다
  when: 'scn_act != "prologue" and scn_act != "after"', rate: 2,
  stages: [
    { at: 15, hint: '하인들이 로제타가 지나가면 입을 다물고, 등 뒤에서 수군거린다.' },
    { at: 35, backstage: '로니카가 로제타의 첫 데뷔탕트 망신을 다시 입에 올리며, 돌아온 에버렛 영애와 나란히 비교하고 있다.' },
    { at: 50, surface: '사교계에 "카르디온의 악녀가 돌아온 에버렛 영애를 노린다"는 소문이 퍼졌다.',
      effects: [{ set: 'doom', expr: 'doom + 10' }, { set: 'rep', expr: 'rep - 5' }] },
    { at: 65, hint: '로제타 앞으로 오던 초대장이 하나둘 끊기기 시작했다.' },
    { at: 80, backstage: '사교계의 귀가 전부 로제타의 다음 악행을 기다린다 — 무슨 일이 생기면 사람들은 증거보다 먼저 로제타를 본다.' },
    { at: 95, surface: '카르디온 공작이 로제타의 외출을 금했다 — 사교계는 이미 로제타를 원작 속 악녀로 못 박았다.',
      effects: [{ set: 'doom', expr: 'doom + 10' }, { set: 'duke', expr: 'duke - 5' }] },
  ],
};

// ══════════ 비밀 — 로어북에서 잘라 옮긴다 (convert-lorebook.js가 원본 줄을 지운다) [내용 원본, 단계·조건 초안] ══════════
const SECRETS = [
  { id: 'power', kind: 'plot', label: '권능', tiers: [
    { text: '로제타 곁에서 마도구 불빛이 이유 없이 흔들리거나 꺼질 때가 있다.' },
    { when: 'awaken >= 1', text: '로제타는 권능이 없는 게 아니다 — 무언가를 지우는 힘이 로제타 안에서 움직이고 있다. 본인도 가문도 아직 모른다.',
      notify: '[비밀] 로제타에게서 설명할 수 없는 힘의 흔적이 드러났다.' },
    { when: 'awaken >= 2', text: '로제타의 파괴 권능은 여덟 살 각성식 때 이미 깨어났다. 권능·신성력·마력을 닿는 순간 지우는 힘이라 겉으로 아무것도 '
      + '나타나지 않았고, 가문은 실패작이라 불렀다. 로제타가 마석 가루를 삼키고도 사는 건 그 권능이 들어온 마력을 몸이 망가지기 전에 지우기 때문이다.',
      notify: '[비밀] 로제타의 권능의 정체가 밝혀졌다.' },
  ] },
  { id: 'powder', kind: 'world', about: '로제타의 몸', label: '서랍 속 작은 병', tiers: [
    { text: '로제타는 가끔 기침이 멎지 않는다. 화장대 서랍 안쪽에 늘 잠겨 있는 칸이 있다.' },
    { when: 'bottle_found', text: '서랍 속 작은 병에는 마석 가루가 들어 있다. 로제타는 권능을 억지로 깨우려고 몰래 사서 삼켜 왔다 — 몸을 망가뜨리는 독이라 자주 피를 토한다.',
      notify: '[비밀] 서랍 속 작은 병의 정체가 밝혀졌다.' },
  ] },
  { id: 'anna', kind: 'person', about: '안나', label: '안나의 침묵', tiers: [
    { text: '안나는 로제타가 기침할 때마다 시선을 피하고, 밤이면 방 앞을 오래 서성인다.' },
    { when: 'anna >= 90 or sec_powder >= 1', text: '안나는 로제타가 마석 가루를 삼키고 피를 토한다는 걸 알고 있다. 자존심이 부서질까 봐, 해 줄 게 없어서, '
      + '입 밖에 내면 정말이 될까 무서워서 모른 척해 왔다.', notify: '[비밀] 안나가 알고 있던 것을 털어놓았다.' },
  ] },
  { id: 'rical', kind: 'person', about: '리칼', label: '리칼의 약', tiers: [
    { text: '리칼은 로제타를 경멸한다고 말하면서도 로제타의 방 앞을 괜히 지나간다.' },
    { when: 'rical >= 40', text: '리칼은 전에 쓰러져 피를 토하는 로제타를 보고, 이름을 숨긴 채 하인 편으로 약을 보낸 적이 있다. 소란을 막으려던 것뿐이라고 스스로에게 말했다.',
      notify: '[비밀] 리칼이 숨겨 온 일이 드러났다.' },
  ] },
  { id: 'elicia', kind: 'person', about: '엘리시아', label: '엘리시아의 손수건', tiers: [
    { text: '엘리시아는 가끔 이유 없이 창백해지고, 손수건을 급히 입가에 댄다.' },
    { when: 'elicia >= 50', text: '엘리시아의 통찰 권능에는 대가가 있다 — 오래 쓰거나 불길한 미래를 보면 두통과 코피가 터진다. 아무도 모르게 닦아 낸다.',
      notify: '[비밀] 엘리시아가 숨겨 온 대가가 드러났다.' },
  ] },
];

// ══════════ 면접 (시종 시점 서장) [유저: 첫 퀘스트, 채점은 초안] ══════════
// 로제타의 질문 3개 — 질문마다 보조가 로제타 성격에 맞춰 답변지를 쓰고, 태그가 점수를 쥔다. 6점 만점, 4점 이상 합격.
const IV = { questions: 3, pass: 4 };
const Q_SERVANT = '[서장] 로제타의 시종 면접에 합격하라';
const Q_ROSETTA = '[서장] 지금이 원작의 어디쯤인지 알아낸다';
const Q_SPECIAL = '[서장] 소문과 다른 악녀, 로제타를 만난다'; // 빙의자 로제타 시점 [초안]
// 1부 메인 퀘스트 — 막 onEnter가 넣고 절정 결판이 지운다 [설계 §3]
const Q = {
  debut: '[1장] 데뷔탕트를 무사히 넘긴다',
  tea: '[2장] 다과회를 무사히 넘긴다',
  stairs: '[3장] 계단의 사고를 막는다',
  night: '[4장] 파국의 밤을 넘긴다',
  verdict: '[5장] 심판에서 살아남는다',
};
// 서브 — 인물의 Goal·Secret을 부탁으로 [씨앗 원본, 문장 초안]. 다음 장에 들어서면 걷힌다(작은 병만 풀릴 때까지 남는다)
const SUBS = {
  debut: ['[서브] 서랍 속 작은 병의 정체', '[서브] 로니카의 도발을 받아넘긴다'],
  tea: ['[서브] 악소문의 출처를 알아낸다', '[서브] 공작가의 저녁 식탁에 로제타의 자리를 만든다'],
  stairs: ['[서브] 로제타의 기침을 봐 줄 의사를 찾는다'],
  night: ['[서브] 리칼에게 쓸모를 증명한다', '[서브] 저녁 모임 전에 엘리시아와 이야기한다'],
  verdict: ['[서브] 심판정에서 편에 서 줄 사람을 찾는다'],
};
const SUB_SWEETS = '[서브] 과자 상자를 보낸 사람을 찾는다'; // 3장 과자 상자 사건이 넣는다
const Q_DEBUT = Q.debut;
const Q_SUBS_1 = SUBS.debut;

// 데뷔탕트 — 제국력 472년 3월 10일 밤 황궁 대연회장 [초안: 날짜·장소]
const DEBUT_YMD = 4720310;

const doneTag = (t) => [{ set: 'iv_q', expr: 'iv_q + 1' }, { set: 'iv_asking', expr: 'false' }, ...(t ? [{ set: 'iv_score', expr: `iv_score + ${t}` }] : [])];
const gameOver = [{ set: 'loop', expr: 'loop + 1' }, { checkpoint: 'load' }];

// ══════════ 능력치 [유저 2026-09-26 "시종에도 스테이터스 — 검술·마법·화술·매력·가사, 킹덤컴 선택지처럼"] ══════════
// 0~100. 판정 = d20 + 능력치/10 ≥ 보통 12 · 어려움 16 (화술 30 → 보통 60% · 어려움 40%). 시스템(판정 성공·수련)만 올린다 — 보조 allow 밖.
// 회귀해도 남는다(checkpoint.keep) — "죽을수록 강해지는" 회귀물. 시작값은 시점별 프리셋, 페르소나 배경은 최초 설정이 조정.
const STATS = [
  // id, 라벨, 무엇, 수련 버튼 아이콘, 수련 낱말 [초안]
  ['sword', '검술', '검·몸싸움·호위 — 몸으로 막고 싸우는 솜씨', '🗡️', ['검술 수련', '검술 연습', '검술 훈련']],
  ['magic', '마법', '주문·마력 다루기·마도구', '📖', ['마법 공부', '마법 수련', '마법 연습']],
  ['talk', '화술', '설득·협상·거짓말·말로 빠져나가기', '🗣️', ['화술 연습', '화술 수련', '말하기 연습']],
  ['charm', '매력', '몸가짐·미소·분위기로 마음을 사는 힘', '🌹', ['몸가짐 연습', '예법 연습', '매력 수련']],
  ['house', '가사', '차·요리·바느질·청소·살림 눈썰미', '🧺', ['가사 연습', '살림 연습', '요리 연습', '바느질 연습']],
];
const st = (id) => `st_${id}`;
// 로제타의 몸 [원본: 체력 약함·상황 판단 빠름·엄격한 교육·각성식 "권능 없음" → 마법 0] / 시종·빙의자 로제타 = 평범한 시종 [초안]
const ROSETTA_STATS = { st_sword: 5, st_magic: 0, st_talk: 45, st_charm: 60, st_house: 5 };
const PLAIN_STATS = { st_sword: 10, st_magic: 5, st_talk: 15, st_charm: 15, st_house: 25 };

// 로제타의 몸은 마력이 모이기도 전에 흩어진다 — 권능(비밀 power)의 흔적 [원본 비밀의 내용, 판정 연결은 초안]
const MAGIC_FIZZLE = { when: 'pov == "rosetta"', label: '흩어짐', effects: [{ set: 'chk_ok', expr: 'false' }, { set: 'awaken', expr: 'max(awaken, 1)' }],
  inject: '로제타가 마력을 모으려 해도 손끝에서 이유 없이 흩어진다 — 주문은 발동하지 않는다. 왜인지는 로제타도 모른다.' };
// 판정 — 보통(c_*)·어려움(c_*_h). 등급 효과가 chk_ok를 세워 선택지 효과가 성패로 갈린다 (굴림 → 등급 → 선택지 효과 순서)
const statCheck = ([id, label], hard) => ({
  id: `c_${id}${hard ? '_h' : ''}`, label: hard ? `${label}(어려움)` : label, roll: 'rand(1, 20)',
  mod: id === 'magic' ? `pov == "rosetta" ? -20 : floor(${st(id)} / 10)` : `floor(${st(id)} / 10)`,
  vs: hard ? '16' : '12',
  grades: [
    ...(id === 'magic' ? [MAGIC_FIZZLE] : []),
    { when: 'total >= vs + 8', label: '대성공', effects: [{ set: 'chk_ok', expr: 'true' }, { set: st(id), expr: `min(${st(id)} + 2, 100)` }],
      inject: '대성공 — 기대 이상으로 해냈다. 주변의 반응까지 그려라.' },
    { when: 'total >= vs', label: '성공', effects: [{ set: 'chk_ok', expr: 'true' }, { set: st(id), expr: `min(${st(id)} + 1, 100)` }],
      inject: '성공 — 시도가 통했다.' },
    { when: 'total >= vs - 6', label: '실패', effects: [{ set: 'chk_ok', expr: 'false' }],
      inject: '실패 — 어긋났다. 상황이 조금 꼬인다.' },
    { label: '대실패', effects: [{ set: 'chk_ok', expr: 'false' }],
      inject: '대실패 — 크게 어긋났다. 오해나 망신이 따른다 (죽거나 되돌릴 수 없는 일은 아니다).' },
  ],
});
// 수련 — 늘 조금은 는다. 높을수록 크게 늘기 어렵다 (목표 8 + 능력치/10). 한 번에 작중 2시간 (time.pins)
const trainCheck = ([id, label]) => ({
  id: `t_${id}`, label: `${label} 수련`, roll: 'rand(1, 20)', vs: `8 + floor(${st(id)} / 10)`,
  grades: [
    ...(id === 'magic' ? [{ ...MAGIC_FIZZLE, effects: [{ set: 'awaken', expr: 'max(awaken, 1)' }] }] : []),
    { when: 'total >= vs + 6', label: '큰 진전', effects: [{ set: st(id), expr: `min(${st(id)} + 3, 100)` }],
      inject: '수련이 잘 풀렸다 — 확실히 몸에 붙는 게 느껴진다. 무엇을 깨달았는지 한 가지를 그려라.' },
    { when: 'total >= vs', label: '진전', effects: [{ set: st(id), expr: `min(${st(id)} + 2, 100)` }],
      inject: '땀 흘린 만큼 늘었다.' },
    { label: '조금', effects: [{ set: st(id), expr: `min(${st(id)} + 1, 100)` }],
      inject: '더디다. 그래도 헛수고는 아니다.' },
  ],
});
const STAT_CHECKS = [...STATS.map((s) => statCheck(s, false)), ...STATS.map((s) => statCheck(s, true)), ...STATS.map(trainCheck)];
// 판정 달린 선택지의 효과 — 성공/실패 두 값 (chk_ok는 방금 굴린 판정의 등급이 세웠다)
const ok2 = (v, a, b) => ({ set: v, expr: `${v} + (chk_ok ? ${a} : ${b})` });
const d = (v, n) => ({ set: v, expr: `${v} ${n < 0 ? '-' : '+'} ${Math.abs(n)}` });
const fr = (n) => ({ front: 'canon', add: String(n) });
const frOk = (a, b) => ({ front: 'canon', add: `chk_ok ? ${a} : ${b}` });

// 1장 절정 — 시점마다 한 벌. 맨 끝 = 원작대로(안 고르면 그리로 흘러간다) [초안]
// 판정 달린 항목(check)은 성공/실패로 결과가 갈린다 — 상태창에 "🎲 화술 60%"가 떠서 고르기 전에 무게를 잰다 (v1.13.0)
const DEBUT_CHOICES = {
  rosetta: [
    { label: '엘리시아에게 먼저 다가가 데뷔를 축하한다', check: 'c_talk_h',
      effects: [ok2('doom', -10, -3), ok2('elicia', 15, 5), ok2('rep', 5, -3), { front: 'canon', add: 'chk_ok ? -20 : -5' }],
      inject: '로제타가 원작과 달리 엘리시아에게 먼저 손을 내민다. 그 말이 어떻게 받아들여지는지는 판정이 정한다.' },
    { label: '질투가 치밀기 전에 무도회장을 빠져나온다', effects: [{ set: 'doom', expr: 'doom - 5' }, { set: 'rep', expr: 'rep - 3' }, { front: 'canon', add: '-10' }],
      inject: '로제타는 원작의 장면이 시작되기 전에 자리를 뜬다. 뒤에서 "도망쳤다"는 수군거림이 따라붙는다.' },
    { label: '황태자에게 대놓고 춤을 청한다', check: 'c_charm',
      effects: [ok2('doom', 3, 8), ok2('ert', 8, 0), ok2('rep', 0, -5), { set: 'elicia', expr: 'elicia - 5' }],
      inject: '로제타가 엘리시아 앞에서 황태자에게 춤을 청한다. 받아 줄지, 모두 앞에서 거절당할지는 판정이 정한다.' },
    { label: '치미는 질투를 그대로 쏟아낸다', effects: [{ set: 'doom', expr: 'doom + 15' }, { set: 'rep', expr: 'rep - 10' }, { set: 'elicia', expr: 'elicia - 10' }, { front: 'canon', add: '15' }],
      inject: '원작 그대로 — 로제타의 질투가 연회장 한가운데서 터진다.' },
  ],
  servant: [
    { label: '아가씨의 손을 잡고 발코니로 모신다', check: 'c_charm',
      effects: [ok2('doom', -10, 5), ok2('rosetta', 10, -5), { front: 'canon', add: 'chk_ok ? -20 : 5' }],
      inject: '시종이 질투가 터지기 직전의 로제타에게 손을 내민다. 로제타가 그 손을 잡을지 뿌리칠지는 판정이 정한다.' },
    { label: '엘리시아 쪽 시녀에게 먼저 말을 걸어 두 사람을 잇는다', check: 'c_talk',
      effects: [ok2('doom', -8, -2), ok2('elicia', 10, 3), { front: 'canon', add: 'chk_ok ? -15 : -5' }],
      inject: '시종이 엘리시아 곁의 시녀와 말을 튼다. 두 영애가 부딪치기 전에 다른 판을 깔 수 있을지는 판정이 정한다.' },
    { label: '아가씨 대신 내가 욕을 먹는다', effects: [{ set: 'doom', expr: 'doom - 5' }, { set: 'rosetta', expr: 'rosetta + 5' }, { set: 'rep', expr: 'rep - 2' }],
      inject: '시종이 일부러 실수해 연회장의 시선을 자기에게로 돌린다. 로제타의 표정이 복잡해진다.' },
    { label: '지켜본다', effects: [{ set: 'doom', expr: 'doom + 15' }, { set: 'rep', expr: 'rep - 10' }, { front: 'canon', add: '15' }],
      inject: '원작 그대로 — 시종이 지켜보는 앞에서 로제타의 질투가 연회장 한가운데서 터진다.' },
  ],
  // 빙의자 로제타 [원본 모드 2 = Special, 유저 2026-09-25 "프리셋에 하나 넣자"] — 로제타 안의 빙의자도 이 장면을 안다. 그래도 원작이 떠민다
  special: [
    { label: '로제타의 손을 잡고 발코니로 이끈다', check: 'c_charm',
      effects: [ok2('doom', -10, 5), ok2('rosetta', 10, -5), { front: 'canon', add: 'chk_ok ? -20 : 5' }],
      inject: '유저가 흔들리는 로제타에게 손을 내민다. 로제타 안의 빙의자가 그 손에 기댈지는 판정이 정한다.' },
    { label: '엘리시아에게 먼저 말을 걸어 두 사람을 잇는다', check: 'c_talk',
      effects: [ok2('doom', -8, -2), ok2('elicia', 10, 3), { front: 'canon', add: 'chk_ok ? -15 : -5' }],
      inject: '유저가 엘리시아에게 먼저 다가가 로제타 쪽으로 대화를 이끈다. 두 영애 사이에 다른 판이 깔릴지는 판정이 정한다.' },
    { label: '로제타 대신 소란의 한가운데로 나선다', effects: [{ set: 'doom', expr: 'doom - 5' }, { set: 'rosetta', expr: 'rosetta + 5' }, { set: 'rep', expr: 'rep - 2' }],
      inject: '유저가 일부러 소란을 일으켜 연회장의 시선을 자기에게로 돌린다. 로제타가 유저를 다시 본다.' },
    { label: '지켜본다', effects: [{ set: 'doom', expr: 'doom + 15' }, { set: 'rep', expr: 'rep - 10' }, { front: 'canon', add: '15' }],
      inject: '원작 그대로 — 빙의자가 버티려 애쓰지만, 로제타의 입에서 원작의 대사가 흘러나온다.' },
  ],
};
const DEBUT_NOTIFY = {
  rosetta: '[1장 · 데뷔탕트] 엘리시아가 연회장에 들어서고, 황태자의 시선이 그녀에게 머문다. 원작이라면 지금 로제타의 질투가 터진다.',
  servant: '[1장 · 데뷔탕트] 엘리시아가 연회장에 들어서고, 황태자의 시선이 그녀에게 머문다. 원작이라면 지금 로제타의 질투가 터진다.',
  special: '[1장 · 데뷔탕트] 엘리시아가 연회장에 들어서고, 황태자의 시선이 그녀에게 머문다. 로제타 안의 빙의자도 이 장면을 안다 — 그런데도 원작의 흐름이 로제타를 질투 쪽으로 떠민다.',
};

// ══════════ 2~4장 절정 [사건 원본: 원작 타임라인 2~4막 / 선택지·수치 초안] ══════════
// 원작의 사건은 범인이 바뀔 수 있다 — 로제타가 안 하면 다른 누군가가 한다. 절정은 그 사건이 "일어나려는 순간"이다 [설계 §2]
const TEA_CHOICES = {
  rosetta: [
    { label: '쟁반을 든 하녀를 불러 세워 다른 심부름을 시킨다', check: 'c_talk',
      effects: [ok2('doom', -10, -3), ok2('elicia', 8, 3), frOk(-15, -5)],
      inject: '로제타가 차를 엎으려는 하녀를 먼저 불러 세운다. 하녀가 말을 따를지, 쟁반이 결국 기울지는 판정이 정한다.' },
    { label: '엘리시아를 핑계 대고 다과회에서 빼낸다', effects: [d('doom', -5), d('rep', -5), d('elicia', 5), fr(-10)],
      inject: '로제타가 무례를 무릅쓰고 엘리시아를 자리에서 데리고 나간다. 뒤에서 "또 악녀가 판을 깼다"는 수군거림이 따라붙는다.' },
    { label: '차를 뒤집어쓴 엘리시아에게 제 숄을 둘러 준다', check: 'c_charm',
      effects: [ok2('doom', -8, -2), ok2('elicia', 12, 5), ok2('rep', 5, -3), frOk(-10, -3)],
      inject: '차는 이미 쏟아졌다. 로제타가 모두의 시선 속에서 엘리시아에게 숄을 둘러 준다. 호의로 보일지 조롱으로 보일지는 판정이 정한다.' },
    { label: '원작대로 하녀에게 눈짓한다', effects: [d('doom', 15), d('rep', -10), d('elicia', -10), fr(15)],
      inject: '원작 그대로 — 로제타의 눈짓에 찻잔이 기울고, 엘리시아의 드레스가 젖는다. 웃음소리가 번진다.' },
  ],
  servant: [
    { label: '하녀의 쟁반을 내가 먼저 받아 든다', check: 'c_house',
      effects: [ok2('doom', -10, -4), ok2('rosetta', 5, 0), ok2('rep', 0, -2), frOk(-15, -5)],
      inject: '시종이 하녀의 쟁반을 가로채 받아 든다. 찻잔 하나 흘리지 않을지, 쟁반이 기울어 제 옷을 적실지는 판정이 정한다.' },
    { label: '급한 전갈이 왔다며 아가씨를 모셔 나온다', check: 'c_talk',
      effects: [ok2('doom', -6, -2), ok2('rosetta', 3, -5), frOk(-10, -3)],
      inject: '시종이 거짓 전갈로 로제타를 다과회에서 빼낸다. 로제타가 속아 줄지, 시종을 매섭게 노려볼지는 판정이 정한다.' },
    { label: '차를 쏟는 척 내 옷에 붓는다', effects: [d('doom', -6), d('rosetta', 6), d('rep', -2), fr(-8)],
      inject: '시종이 스스로 찻잔을 엎어 제 옷을 적신다. 웃음거리는 시종이 되고 엘리시아의 드레스는 무사하다. 로제타가 시종을 오래 본다.' },
    { label: '지켜본다', effects: [d('doom', 15), d('rep', -10), fr(15)],
      inject: '원작 그대로 — 시종이 지켜보는 앞에서 찻잔이 기울고, 엘리시아의 드레스가 젖는다. 모두의 눈이 로제타를 향한다.' },
  ],
  special: [
    { label: '쟁반을 든 하녀에게 말을 걸어 발을 붙잡는다', check: 'c_talk',
      effects: [ok2('doom', -10, -3), ok2('elicia', 5, 0), frOk(-15, -5)],
      inject: '유저가 하녀를 붙잡고 말을 건다. 하녀의 발이 멈출지, 쟁반이 결국 엘리시아 쪽으로 갈지는 판정이 정한다.' },
    { label: '로제타 곁에 앉아 떨리는 손을 붙잡는다', check: 'c_charm',
      effects: [ok2('doom', -8, -2), ok2('rosetta', 10, -3), frOk(-10, -3)],
      inject: '빙의자 로제타의 손끝이 원작의 눈짓을 하려는 듯 떨린다. 유저가 그 손을 붙잡는다. 로제타가 버텨 낼지는 판정이 정한다.' },
    { label: '제 잔을 엎어 판을 깬다', effects: [d('doom', -6), d('rosetta', 5), d('rep', -2), fr(-8)],
      inject: '유저가 일부러 제 찻잔을 엎는다. 소란의 중심이 유저로 옮겨 가고, 로제타가 유저를 다시 본다.' },
    { label: '지켜본다', effects: [d('doom', 15), d('rep', -10), fr(15)],
      inject: '원작 그대로 — 빙의자가 버티려 애쓰지만 로제타의 눈짓에 찻잔이 기울고, 엘리시아의 드레스가 젖는다.' },
  ],
};
const STAIRS_CHOICES = {
  rosetta: [
    { label: '계단 아래로 달려가 엘리시아를 받아 낸다', check: 'c_sword',
      effects: [ok2('doom', -12, -4), ok2('elicia', 12, 5), ok2('health', -3, -12), frOk(-20, -5)],
      inject: '로제타가 드레스 자락을 걷어쥐고 계단 아래로 뛴다. 떨어지는 엘리시아를 받아 낼지, 함께 굴러떨어질지는 판정이 정한다.' },
    { label: '매수된 하인을 먼저 찾아 두 배를 쥐여 준다', check: 'c_talk',
      effects: [ok2('doom', -10, 3), ok2('rep', 0, -5), frOk(-15, 5)],
      inject: '로제타가 하인을 구석으로 불러 더 큰 돈을 내민다. 하인이 손을 뗄지, "악녀가 입막음을 하려 했다"는 말이 돌지는 판정이 정한다.' },
    { label: '엘리시아를 계단에서 먼 곳으로 불러낸다', effects: [d('doom', -5), d('elicia', 3), fr(-5)],
      inject: '로제타가 핑계를 만들어 엘리시아를 계단에서 떼어 놓는다. 사고는 일어나지 않았지만, 하인은 아직 그 자리에 있다.' },
    { label: '원작대로 하인에게 약속한 돈을 건넨다', effects: [d('doom', 15), d('rep', -10), d('elicia', -10), fr(15)],
      inject: '원작 그대로 — 로제타의 돈을 받은 하인이 엘리시아의 등을 민다. 엘리시아는 가벼운 상처로 그쳤지만, 사람들의 눈은 이미 로제타를 향한다.' },
  ],
  servant: [
    { label: '계단 아래로 달려가 엘리시아를 받아 낸다', check: 'c_sword',
      effects: [ok2('doom', -12, -4), ok2('elicia', 10, 4), ok2('rep', 3, -2), frOk(-20, -5)],
      inject: '시종이 몸을 날려 계단 아래로 뛴다. 떨어지는 엘리시아를 받아 낼지, 함께 굴러떨어질지는 판정이 정한다.' },
    { label: '매수된 하인의 소매를 붙잡고 따진다', check: 'c_talk',
      effects: [ok2('doom', -10, 2), frOk(-15, 3)],
      inject: '시종이 하인을 붙잡는다. 누구에게 돈을 받았는지 털어놓을지, 오히려 "카르디온 시종이 협박했다"며 소리칠지는 판정이 정한다.' },
    { label: '아가씨를 사람 많은 곳으로 모셔 알리바이를 만든다', effects: [d('doom', -6), d('rosetta', 3), fr(-5)],
      inject: '시종이 로제타를 사람들 한가운데로 모신다. 무슨 일이 일어나도 로제타는 계단 근처에 없었다 — 그걸 본 눈이 많다.' },
    { label: '지켜본다', effects: [d('doom', 15), d('rep', -10), fr(15)],
      inject: '원작 그대로 — 매수된 하인이 엘리시아의 등을 민다. 엘리시아는 가벼운 상처로 그쳤지만, 사람들의 눈은 이미 로제타를 향한다.' },
  ],
  special: [
    { label: '계단 아래로 달려가 엘리시아를 받아 낸다', check: 'c_sword',
      effects: [ok2('doom', -12, -4), ok2('elicia', 10, 4), ok2('rep', 3, -2), frOk(-20, -5)],
      inject: '유저가 몸을 날려 계단 아래로 뛴다. 떨어지는 엘리시아를 받아 낼지, 함께 굴러떨어질지는 판정이 정한다.' },
    { label: '매수된 하인의 소매를 붙잡고 따진다', check: 'c_talk',
      effects: [ok2('doom', -10, 2), frOk(-15, 3)],
      inject: '유저가 하인을 붙잡는다. 누구에게 돈을 받았는지 털어놓을지, 오히려 소란만 키울지는 판정이 정한다.' },
    { label: '로제타를 사람 많은 곳으로 이끌어 알리바이를 만든다', effects: [d('doom', -6), d('rosetta', 3), fr(-5)],
      inject: '유저가 로제타를 사람들 한가운데로 이끈다. 무슨 일이 일어나도 로제타는 계단 근처에 없었다 — 그걸 본 눈이 많다.' },
    { label: '지켜본다', effects: [d('doom', 15), d('rep', -10), fr(15)],
      inject: '원작 그대로 — 빙의자 로제타가 막으려 했지만 한발 늦었다. 매수된 하인이 엘리시아의 등을 밀고, 사람들의 눈은 로제타를 향한다.' },
  ],
};
const NIGHT_CHOICES = {
  rosetta: [
    { label: '칼을 든 손목을 쳐낸다', check: 'c_sword_h',
      effects: [ok2('doom', -15, 5), ok2('elicia', 15, 5), ok2('ert', 10, 0), ok2('rep', 5, -10), frOk(-25, 10)],
      inject: '로제타가 어둠 속 칼날로 몸을 던진다. 칼을 쳐낼지, 칼자루를 쥔 채 붙잡히는 게 로제타가 될지는 판정이 정한다.' },
    { label: '목청껏 소리쳐 사람들을 부른다', effects: [d('doom', -8), d('rep', -3), fr(-10)],
      inject: '로제타가 소리친다. 사람들이 몰려오고 칼은 어둠 속으로 사라진다 — 남은 건 그 자리에 선 로제타와 엘리시아뿐이다.' },
    { label: '엘리시아의 손을 잡고 연회장으로 달린다', effects: [d('doom', -10), d('elicia', 8), d('health', -5), fr(-10)],
      inject: '로제타가 엘리시아의 손을 잡아끌고 불빛 쪽으로 달린다. 약한 몸이라 숨이 턱까지 차오른다.' },
    { label: '원작대로 칼을 든다', effects: [d('doom', 25), d('rep', -20), d('elicia', -15), fr(20)],
      inject: '원작 그대로 — 로제타의 손에 칼이 들린다. 칼끝이 엘리시아에게 닿기 전에 황태자가 로제타를 제압한다.' },
  ],
  servant: [
    { label: '칼 앞을 몸으로 막아선다', check: 'c_sword_h',
      effects: [ok2('doom', -15, -5), ok2('rosetta', 10, 5), ok2('elicia', 10, 5), frOk(-25, -5)],
      inject: '시종이 칼 앞으로 몸을 던진다. 칼을 쳐낼지, 칼끝이 시종의 팔을 긋고 지나갈지는 판정이 정한다 (죽지는 않는다).' },
    { label: '아가씨를 연회장 한가운데로 모셔 알리바이를 만든다', effects: [d('doom', -10), d('rosetta', 3), fr(-10)],
      inject: '시종이 로제타를 불빛 한가운데 붙잡아 둔다. 칼이 번뜩인 그 시각, 로제타는 모두의 눈앞에 있었다.' },
    { label: '목청껏 소리쳐 사람들을 부른다', effects: [d('doom', -8), fr(-10)],
      inject: '시종이 소리친다. 사람들이 몰려오고 칼은 어둠 속으로 사라진다.' },
    { label: '지켜본다', effects: [d('doom', 25), d('rep', -20), fr(20)],
      inject: '원작 그대로 — 칼을 든 로제타가 황태자에게 제압당한다. 시종은 그 장면을 멀리서 본다.' },
  ],
  special: [
    { label: '칼 앞을 몸으로 막아선다', check: 'c_sword_h',
      effects: [ok2('doom', -15, -5), ok2('rosetta', 10, 5), ok2('elicia', 10, 5), frOk(-25, -5)],
      inject: '유저가 칼 앞으로 몸을 던진다. 칼을 쳐낼지, 칼끝이 유저의 팔을 긋고 지나갈지는 판정이 정한다 (죽지는 않는다).' },
    { label: '로제타를 연회장 한가운데 붙잡아 둔다', effects: [d('doom', -10), d('rosetta', 3), fr(-10)],
      inject: '유저가 로제타를 불빛 한가운데 붙잡아 둔다. 칼이 번뜩인 그 시각, 로제타는 모두의 눈앞에 있었다.' },
    { label: '목청껏 소리쳐 사람들을 부른다', effects: [d('doom', -8), fr(-10)],
      inject: '유저가 소리친다. 사람들이 몰려오고 칼은 어둠 속으로 사라진다.' },
    { label: '지켜본다', effects: [d('doom', 25), d('rep', -20), fr(20)],
      inject: '원작 그대로 — 빙의자가 버티려 애쓰지만 로제타의 손에 칼이 들리고, 황태자가 로제타를 제압한다.' },
  ],
};

// ══════════ 5장 심판 — 결말 갈림길 [사건 원본: 파양·처형 / 잠긴 선택지 설계 §6 / 수치 초안] ══════════
// 잠긴 선택지(🔒)가 보인다 — 무엇이 로제타를 살릴 수 있었는지가 보이게. 맨 끝 = 받아들인다(원작 결말 = 죽음 → 회귀)
const ending = (t) => ({ set: 'ending', expr: JSON.stringify(t) });
const verdictChoices = (pov) => [
  { label: '리칼이 증언대에 선다', when: 'rical >= 60', effects: [ending('리칼의 증언'), d('rical', 5), d('duke', 5)],
    inject: '리칼이 증언대에 선다 — 가문의 수치라 부르던 이복동생을 위해. 그가 무엇을 봤는지 말한다.' },
  { label: '엘리시아가 로제타를 감싼다', when: 'elicia >= 60', effects: [ending('엘리시아의 변호'), d('elicia', 5), d('rep', 10)],
    inject: '피해자로 불려 나온 엘리시아가 로제타를 감싼다. 통찰의 권능을 지닌 그녀의 말에 심판정이 술렁인다.' },
  { label: '황태자가 재심을 청한다', when: 'ert >= 70', effects: [ending('황태자의 재심 청원'), d('ert', 5), d('rep', 10)],
    inject: '황태자 에르테미안이 일어나 재심을 청한다. 원작에서 로제타를 제압했던 그 사람이다.' },
  { label: '공작이 가문의 이름으로 막아선다', when: 'duke >= 60', effects: [ending('공작의 이름'), d('duke', 10)],
    inject: '카르디온 공작이 파양 대신 가문의 이름을 건다. 로제타를 유리창 보듯 지나쳐 보던 눈이 처음으로 로제타에게 머문다.' },
  ...(pov === 'rosetta' ? [] : [
    { label: '내가 대신 죄를 쓴다', when: 'rosetta >= 70',
      effects: [ending('대신 진 죄'), { set: 'role', expr: '"수도에서 추방된 몸"' }, d('rosetta', 20)],
      inject: '유저가 모든 죄를 자기가 꾸몄다고 자백한다. 로제타는 풀려나고, 유저는 수도에서 추방된다. 로제타가 그 뒷모습을 본다.' },
  ]),
  { label: '스스로 결백을 밝힌다', when: 'doom <= 30', effects: [ending('스스로 밝힌 결백'), d('rep', 10)],
    inject: '엇갈린 증거의 틈을 로제타 편이 파고든다. 원작의 결말이 로제타를 놓친다.' },
  { label: pov === 'rosetta' ? '심판정을 빠져나가 도망친다' : '로제타를 데리고 도망친다',
    effects: [ending('도주'), { set: 'role', expr: '"쫓기는 몸"' }, d('rep', -30)],
    inject: pov === 'rosetta' ? '로제타가 심판정을 빠져나가 수도를 등진다. 살았지만, 이제 쫓기는 몸이다.'
      : '유저가 로제타의 손을 잡고 심판정을 빠져나간다. 둘 다 살았지만, 이제 쫓기는 몸이다.' },
  { label: pov === 'rosetta' ? '받아들인다' : '아무것도 하지 못한다', effects: gameOver,
    inject: '원작 그대로 — 카르디온 공작가가 로제타를 파양하고, 처형대가 기다린다. 칼날이 떨어지는 순간 세상이 어두워진다.' },
];
const VERDICT_NOTIFY = '[5장 · 심판] 심판정. 카르디온 공작이 입을 연다 — 원작이라면 지금 파양이 선언되고, 처형이 뒤따른다.';

// 장 한 벌 = 막 + 절정 갈림길 × 시점 셋. 절정은 무대 도착(on_stage) · 그날(1장만 날짜) · 장에 오래 머묾 중 먼저 오는 것 — "원작의 강제력"
// 결판이 cleared를 올리고, 다음 장은 여파 3턴 뒤(clear_at)에 열린다 [초안]
const CHAPTERS = [
  { id: 'debut', n: 1, choices: DEBUT_CHOICES, notify: DEBUT_NOTIFY, when: `on_stage or ymd >= ${DEBUT_YMD} or scn_turns >= 14` },
  { id: 'tea', n: 2, choices: TEA_CHOICES, when: 'on_stage or scn_turns >= 14', notify: {
    rosetta: '[2장 · 다과회] 찻잔이 돌고, 쟁반을 든 하녀가 엘리시아 쪽으로 걸음을 옮긴다. 원작이라면 지금 로제타의 눈짓 하나에 엘리시아의 드레스에 차가 쏟아진다.',
    servant: '[2장 · 다과회] 찻잔이 돌고, 쟁반을 든 하녀가 엘리시아 쪽으로 걸음을 옮긴다. 원작이라면 지금 로제타의 눈짓 하나에 엘리시아의 드레스에 차가 쏟아진다.',
    special: '[2장 · 다과회] 찻잔이 돌고, 쟁반을 든 하녀가 엘리시아 쪽으로 걸음을 옮긴다. 로제타 안의 빙의자도 이 장면을 안다 — 그런데도 원작의 흐름이 로제타의 시선을 하녀 쪽으로 떠민다.' } },
  { id: 'stairs', n: 3, choices: STAIRS_CHOICES, when: 'on_stage or scn_turns >= 14', notify: {
    rosetta: '[3장 · 계단] 계단 위, 매수된 하인이 엘리시아의 뒤를 바싹 따른다. 원작이라면 지금 엘리시아가 계단에서 떨어지고 — 사람들은 로제타를 본다.',
    servant: '[3장 · 계단] 계단 위, 매수된 하인이 엘리시아의 뒤를 바싹 따른다. 원작이라면 지금 엘리시아가 계단에서 떨어지고 — 사람들은 로제타를 본다.',
    special: '[3장 · 계단] 계단 위, 매수된 하인이 엘리시아의 뒤를 바싹 따른다. 로제타 안의 빙의자도 이 장면을 안다 — 원작이라면 지금 엘리시아가 떨어지고, 사람들은 로제타를 본다.' } },
  { id: 'night', n: 4, choices: NIGHT_CHOICES, when: 'on_stage or scn_turns >= 14', notify: {
    rosetta: '[4장 · 파국의 밤] 연회장 뒤편 인적 없는 곳 — 엘리시아가 로제타의 이름으로 된 쪽지를 들고 서 있다. 어둠 속에서 칼날이 번뜩인다. 원작이라면 지금 로제타가 칼을 들고, 황태자에게 제압당한다.',
    servant: '[4장 · 파국의 밤] 연회장 뒤편 인적 없는 곳 — 엘리시아가 로제타의 이름으로 된 쪽지를 들고 서 있다. 어둠 속에서 칼날이 번뜩인다. 원작이라면 지금 로제타가 칼을 들고, 황태자에게 제압당한다.',
    special: '[4장 · 파국의 밤] 연회장 뒤편 인적 없는 곳 — 엘리시아가 로제타의 이름으로 된 쪽지를 들고 서 있다. 어둠 속에서 칼날이 번뜩인다. 로제타 안의 빙의자도 이 장면을 안다 — 원작이라면 지금 로제타가 칼을 든다.' } },
  { id: 'verdict', n: 5, when: 'on_stage or scn_turns >= 6', notify: { rosetta: VERDICT_NOTIFY, servant: VERDICT_NOTIFY, special: VERDICT_NOTIFY },
    choices: { rosetta: verdictChoices('rosetta'), servant: verdictChoices('servant'), special: verdictChoices('special') } },
];
const POVS = ['rosetta', 'servant', 'special'];
const chClose = (c) => [{ set: 'cleared', expr: `max(cleared, ${c.n})` }, { set: 'on_stage', expr: 'false' }, { set: 'clear_at', expr: 'scn_turns' },
  { list: 'quests', remove: [Q[c.id]] }];
// 결판 — 원작 결말(받아들인다)은 회귀라 결판 효과를 안 붙인다 (되감기가 어차피 덮는다)
const closeOf = (c, ch) => (ch.effects.some((e) => e.checkpoint === 'load') ? ch.effects : [...ch.effects, ...chClose(c)]);
const CLIMAX_EVENTS = CHAPTERS.flatMap((c) => POVS.map((pov) => ({
  id: `${c.id}_${pov}`, once: true, strict: 'last',
  when: `pov == "${pov}" and scn_act == "${c.id}" and cleared < ${c.n} and (${c.when})`,
  notify: c.notify[pov],
  choices: c.choices[pov].map((ch) => ({ ...ch, effects: closeOf(c, ch) })),
})));
// 다음 장에 들어서면 — 메인·서브 교체, 무대 초기화, 체크포인트. 작은 병 서브만 풀릴 때까지 남는다
const enterCh = (id, prevSubs) => [
  { list: 'quests', remove: prevSubs.filter((q) => q !== SUBS.debut[0]), add: [Q[id], ...SUBS[id]] },
  { set: 'on_stage', expr: 'false' },
  { checkpoint: 'save' },
];
const nextUnlock = (n) => `cleared >= ${n} and scn_turns >= clear_at + 4`; // 고른 턴 + 여파 3턴

// ══════════ 원작 보정력 — 평소 장면에서 원작이 스스로를 되돌리려는 순간 [설계 §4-② / 빈도·수치 초안] ══════════
// 파멸도가 30을 넘으면 뜨기 시작해 원작에 가까울수록 잦아진다 (파멸도 40 → 4% · 60 → 12% · 80 → 20%/턴)
const CANON_LIVE = {
  id: 'canon', label: '원작 보정력', icon: '📖',
  when: 'scn_act != "prologue" and scn_act != "verdict" and scn_act != "after"',
  chance: 'max(0, doom - 30) / 250', count: [3, 3], shuffle: true, worst: '타협', strict: false, timeout: 1,
  tags: [
    { id: '이탈', desc: '원작의 흐름을 거스르는 행동 — 원작 속 로제타라면 하지 않았을 일', effects: [d('doom', -4), fr(-5)] },
    { id: '타협', desc: '원작을 거스르지도 따르지도 않는 무난한 행동', effects: [d('doom', -1)] },
    { id: '원작', desc: '원작 속 악녀 로제타의 길로 되돌아가는 행동 — 로제타가 직접 하거나, 유저가 돕거나 눈감는다', effects: [d('doom', 6), fr(5)] },
  ],
  // 안 고르고 직접 쓰면 타협 — 면접의 "직접 답 = 무난"과 같은 규약 [유저 2026-09-26]
  guide: '지금 장면에서 원작이 스스로를 되돌리려는 순간을 잡아, 유저가 할 수 있는 서로 다른 행동 셋을 쓴다 — 원작 속 악녀 로제타다운 길(원작), 그 길을 거스르는 길(이탈), 그 사이(타협). '
    + '원작의 다음 사건을 미리 말하지 말고, 지금 장면 안의 행동만.',
  desc: '원작이 이야기를 되돌리려 한다',
};

// ══════════ 스키마 ══════════
const S = {
  simcore: '0.1',
  meta: { name: '조기퇴장 악녀 — 원작 탈출', description: '로제타(또는 로제타의 시종)에 빙의해 원작의 처형 결말을 비튼다. 챕터·퀘스트·강제 선택지·사망 회귀.' },
  time: {
    start: '0472-03-01 08:00', advance: 'explicit', calendar: 'gregorian',
    format: { date: 'M월 D일', clock: 'HH:mm' },
    seasons: ['봄', '여름', '가을', '겨울'],
    expose: ['date', 'clock', 'year', 'month', 'dom', 'hour', 'minute', 'elapsed', 'season'],
    pins: STATS.map(([id, label]) => ({ label: `${label} 수련`, action: `train_${id}`, min: 120 })),
  },
  vars: [
    { id: 'pov', label: '시점', type: 'enum', enum: ['rosetta', 'servant', 'special'], init: 'rosetta' },
    // 빙의자 로제타 시점의 빙의자 설정 — 원본은 로어북 "Possessor Profile" 칸을 채웠다. 번들을 다시 적용하면 로어북이 통째로
    // 바뀌어 적은 게 지워지므로 채팅 상태(변수)로 옮겼다: 패널에서 적거나, 첫 메시지에 밝히면 최초 설정이 옮겨 적는다
    { id: 'possessor', label: '빙의자 설정', type: 'text', init: '', maxLength: 400,
      desc: '빙의자 로제타 시점 전용 — 로제타의 몸에 들어온 현대인의 설정(원래 나이·직업·성격·말투). 유저가 첫 메시지에서 밝혔을 때만 옮겨 적는다.' },
    { id: 'location', label: '장소', type: 'text', init: '카르디온 공작저', desc: '지금 장면이 벌어지는 곳 (예: 카르디온 공작저 로제타의 방, 황궁 대연회장). 장소가 바뀌면 고쳐 적는다.' },
    { id: 'doom', label: '파멸도', type: 'int', init: 40, min: 0, max: 100,
      desc: '원작 수렴도 — 로제타가 원작의 처형 결말로 끌려가는 정도. 원작의 악행과 같은 방향의 행동(엘리시아를 향한 공개적 적의·괴롭힘·사교계 추문)이 서사에 실제로 나오면 +1~3, '
        + '원작을 비트는 행동이면 −1~3. 큰 변화는 시스템(선택지)이 한다 — 짐작으로 움직이지 마라.' },
    { id: 'rep', label: '평판', type: 'int', init: -40, min: -100, max: 100,
      desc: '로제타의 사교계 평판(−100 악녀 ~ +100 존경). 사교 자리에서 로제타를 보는 시선이 실제로 바뀌는 장면이 있을 때만 ±1~8.' },
    { id: 'health', label: '로제타의 몸', type: 'int', init: 60, min: 0, max: 100,
      desc: '로제타의 몸 상태. 각혈·쓰러짐·밤샘이면 −, 쉬고 치료받으면 +. 서사에 몸의 변화가 나올 때만.' },
    ...PEOPLE.map(([id, label, init, , note]) => ({ id, label, type: 'int', init, min: 0, max: 100,
      desc: `${label}${id === 'rosetta' ? '가' : '이(가)'} 유저를 향한 호감 — 관계의 거리. ${note}. 우정·충성·연애 중 무엇인지는 따지지 말고, `
        + '서사에서 실제로 가까워지거나 멀어진 만큼만 ±1~8.' })),
    { id: 'awaken', label: '권능의 흔적', type: 'int', init: 0, min: 0, max: 2,
      desc: '로제타가 닿자 마법·신성력·마도구가 꺼지거나 사라지는 장면이 서사에 **실제로** 나왔을 때만 +1. 짐작·암시만으로는 올리지 마라.' },
    { id: 'bottle_found', label: '작은 병을 찾음', type: 'bool', init: false,
      desc: '유저가 화장대 서랍 속 작은 병을 직접 손에 넣거나 열어 봤으면 true.' },
    // 보조는 지금이 몇 장인지 모른다 — 장에 매이지 않게: 원작의 사건은 늘 두 사람이 한자리에 모이는 공식 자리에서 터진다
    { id: 'on_stage', label: '무대에 도착', type: 'bool', init: false,
      desc: '유저가 엘리시아와 로제타가 함께 있는 공식 자리(무도회·다과회·연회·저녁 모임)나 심판정에 도착하면 true. 무대의 사건은 시스템이 연다.' },
    { id: 'dead', label: '사망', type: 'bool', init: false,
      desc: '유저가 연기하는 인물이 서사 안에서 죽었을 때만 true. 시종·빙의자 로제타 시점이면 로제타가 죽었을 때도 true. 부상·기절은 아니다.' },
    { id: 'quests', label: '퀘스트', type: 'list', init: [Q_ROSETTA], maxItems: 10, itemMaxLength: 48,
      desc: '진행 중인 퀘스트. "[서브]" 항목은 서사에서 그 일이 이뤄졌을 때만 원문 그대로 지워라. "[서장]"·"[1장]" 같은 메인 항목은 시스템이 지우니 건드리지 마라. '
        + '서사 속 인물이 유저에게 직접 부탁한 일이 생기면 "[서브] …"로 추가(서브는 최대 5개).' },
    { id: 'memories', label: '회귀의 기억', type: 'list', init: [], maxItems: 8, itemMaxLength: 60,
      desc: '유저가 이번 판에서 알게 된 결정적 사실 — 다음 회귀에도 가져갈 만한 것만 한 줄씩 (예: "로제타는 동정받는 걸 가장 싫어한다"). 회귀해도 남는다.' },
    { id: 'ties', label: '그 밖의 관계', type: 'list', init: [], maxItems: 10, itemMaxLength: 40,
      desc: '호감 칸이 없는 인물과의 관계 한 줄 (예: "로니카 — 공공연한 앙숙"). 숫자 없이. 관계가 바뀌면 지우고 새로 적어라.' },
    // 빙의자 탭 [유저 2026-09-25 "소지품이나 능력 관리는 페르소나 전용 탭이 제일 좋아 보인다"]
    { id: 'role', label: '신분', type: 'text', init: '카르디온 공녀',
      desc: '유저의 지금 신분·자리 한 줄. 비어 있으면 서사에 드러난 유저의 자리를 적고, 그 뒤로는 신분이 실제로 바뀌었을 때만 고친다 (해고·승격·약혼 등). 시종 면접 합격은 시스템이 적는다.' },
    { id: 'skills', label: '능력', type: 'list', init: ['원작 지식'], maxItems: 10, itemMaxLength: 30,
      desc: '유저가 할 수 있는 것 — 서사에서 실제로 해 보이거나 새로 익힌 것만 한 줄씩 (예: "궁정 예법", "독 감별"). 설정·짐작만으로 늘리지 마라. 회귀해도 남는다.' },
    { id: 'items', label: '소지품', type: 'list', init: [], maxItems: 12, itemMaxLength: 30,
      desc: '유저가 지니고 다니거나 따로 챙겨 둔 물건. 서사에서 손에 넣으면 추가, 쓰거나 잃거나 남에게 주면 원문 그대로 지운다. '
        + '늘 걸치는 옷·평범한 장신구는 적지 말고 이야기에 쓰일 만한 것만. 회귀하면 세상과 함께 되감긴다.' },
    // 능력치 — 시스템(판정 성공·수련)만 올린다. 최초 설정만 페르소나 배경으로 조정한다
    ...STATS.map(([id, label, what]) => ({ id: st(id), label, type: 'int', init: PLAIN_STATS[st(id)], min: 0, max: 100,
      desc: `유저의 ${label} 솜씨 0~100 (${what}). 평범한 사람 10~20 · 숙련 40~60 · 달인 80 이상. `
        + '유저가 첫 메시지에서 밝힌 배경(기사 집안·마법 학교 등)이 있을 때만 조정하고, 그 뒤는 시스템이 올린다.' })),
    // 시스템 전용 — 보조 allow 밖
    { id: 'chk_ok', label: '방금 판정 성공', type: 'bool', init: false }, // 판정 등급이 세우고 선택지 효과가 읽는다
    { id: 'cleared', label: '결판난 장', type: 'int', init: 0, min: 0, max: 6 },
    { id: 'clear_at', label: '결판 턴', type: 'int', init: 0, min: 0, max: 9999 }, // 결판 때의 scn_turns — 다음 장은 여파 3턴 뒤
    { id: 'ending', label: '결말', type: 'text', init: '' }, // 5장 심판이 적는다
    { id: 'loop', label: '회귀', type: 'int', init: 0, min: 0, max: 999 },
    { id: 'hired', label: '채용', type: 'bool', init: false },
    { id: 'iv_q', label: '면접 질문', type: 'int', init: 0, min: 0, max: IV.questions, format: '{v}/3' },
    { id: 'iv_score', label: '면접 점수', type: 'int', init: 0, min: 0, max: IV.questions * 2 },
    { id: 'iv_asking', label: '질문 대기', type: 'bool', init: false },
    { id: 'skip_day', label: '일 진행', type: 'int', init: 0, min: 0, max: 3650,
      desc: '서사에서 흐른 날짜 수. "사흘 뒤"면 3, 잠들어 다음 날이면 1. 같은 날 안이면 0.' },
    { id: 'skip_min', label: '분 진행', type: 'int', init: 0, min: 0, max: 1440,
      desc: '같은 날 안에서 흐른 분. 대화 한 장면이면 10~30, 식사·산책이면 60 안팎, 무도회 한 밤이면 240.' },
  ],
  derived: [
    { id: 'ymd', label: '날짜 숫자', expr: 'year * 10000 + month * 100 + dom' },
    // 지금 몇 장 — 서장 0 · 1~5장 · 원작 이후 6
    { id: 'chapter', label: '장', expr: 'scn_act == "debut" ? 1 : scn_act == "tea" ? 2 : scn_act == "stairs" ? 3 : scn_act == "night" ? 4 : scn_act == "verdict" ? 5 : scn_act == "after" ? 6 : 0' },
  ],
  updater: {
    allow: [
      { id: 'location', maxLength: 40 },
      { id: 'doom', maxDelta: 3 },
      { id: 'rep', maxDelta: 8 },
      { id: 'health', maxDelta: 10 },
      ...PEOPLE.map(([id, , , words]) => ({ id, maxDelta: 8, mentions: words })),
      { id: 'awaken', maxGain: 1, maxLoss: 0 },
      { id: 'bottle_found' },
      { id: 'on_stage' },
      { id: 'dead' },
      { id: 'quests' },
      { id: 'memories' },
      { id: 'ties' },
      { id: 'role', maxLength: 30 },
      { id: 'skills' },
      { id: 'items' },
      { id: 'skip_day', maxDelta: 3650 },
      { id: 'skip_min', maxDelta: 1440 },
    ],
    guide: '너는 기록자다 — 서사에 실제로 일어난 일만 옮겨 적는다. 원작이 어떻게 흘러가야 하는지, 퀘스트가 성공했는지는 시스템이 정한다. '
      + '호감은 관계의 거리일 뿐 연애 여부를 뜻하지 않는다.',
  },
  checks: STAT_CHECKS,
  // 수련 — 누르거나 채팅에 "검술 수련"처럼 쓰면 무장된다. 시종은 합격 뒤부터 (면접 중엔 수련할 틈이 없다)
  actions: STATS.map(([id, label, , icon, words]) => ({
    id: `train_${id}`, label: `${icon} ${label} 수련`, mode: 'oneshot', check: `t_${id}`, keywords: words,
    when: 'not (pov == "servant" and not hired)',
    inject: `유저가 ${label}을(를) 수련한다 — 작중 두 시간쯤. 누구에게 배우는지·어디서 하는지는 지금까지의 서사를 따른다.`,
  })),
  rules: {
    events: [
      // 판의 첫 저장 — 서장의 체크포인트 (첫 막은 onEnter가 안 돈다)
      { id: 'cp_open', when: 'true', once: true, effects: [{ checkpoint: 'save' }] },
      // 게임오버 — 사실 기록(dead)·원작 확정(doom 100)·면접 탈락. 보조에게 "벗어났나"를 판단시키지 않는다 [설계 §12]
      { id: 'go_dead', when: 'dead', effects: gameOver, notify: '[게임오버] 죽음이 찾아왔다.' },
      { id: 'go_doom', when: 'doom >= 100', effects: gameOver, notify: '[게임오버] 원작의 결말이 굳었다 — 로제타는 처형대로 끌려간다.' },
      // 면접 — 질문을 부탁한다 (다음 응답에 로제타의 질문 → 그 뒤 보조가 답변지를 쓴다)
      { id: 'iv_ask', when: `pov == "servant" and scn_act == "prologue" and not hired and not iv_asking and iv_q < ${IV.questions}`,
        effects: [{ set: 'iv_asking', expr: 'true' }], liveChoices: 'interview',
        notify: '[면접] 로제타가 다음 질문을 던질 차례다 — 이번 응답에서 로제타의 질문 하나를 대사로 분명히 써라. 질문으로 장면을 끝내고, 지원자의 대답은 쓰지 마라.' },
      { id: 'iv_pass', when: `pov == "servant" and scn_act == "prologue" and not hired and iv_q >= ${IV.questions} and iv_score >= ${IV.pass}`,
        effects: [{ set: 'hired', expr: 'true' }, { set: 'role', expr: '"로제타 전속 시종"' }, { set: 'rosetta', expr: 'rosetta + 10' }, { list: 'quests', remove: [Q_SERVANT] }],
        notify: '[면접 결과] 합격 — 로제타가 지원자를 전속 시종으로 들인다. 로제타답게, 칭찬 대신 조건을 붙여서.' },
      { id: 'iv_fail', when: `pov == "servant" and scn_act == "prologue" and not hired and iv_q >= ${IV.questions} and iv_score < ${IV.pass}`,
        effects: gameOver, notify: '[게임오버] 면접에서 떨어졌다 — 로제타 곁에 설 길이 닫혔고, 원작은 그대로 흘러간다.' },
      // 1~5장 절정 — 무대 도착 · 그날(1장) · 또는 이 장에서 오래 머물면 원작이 찾아온다 [설계 §2 원작의 강제력]
      ...CLIMAX_EVENTS,
      // 3장 — 과자 상자. 원작에선 로제타가 독 과자를 보낸다. 이번엔 누가 보냈는지 서사가 정한다 [사건 원본, 범인 공백 초안]
      { id: 'sweets', once: true, when: 'scn_act == "stairs" and cleared < 3 and scn_turns >= 3',
        effects: [{ list: 'quests', add: [SUB_SWEETS] }, fr(10)],
        notify: '[3장] 로제타의 이름이 적힌 "화해의 선물" 과자 상자가 에버렛가에 도착했다. 원작이라면 그 과자에는 약한 독이 들어 있고, 엘리시아는 통찰로 악의를 알아채 먹지 않는다. '
          + '이번에 누가 보냈는지는 지금까지의 서사가 정한다.' },
    ],
  },
  fronts: [CANON],
  secrets: SECRETS,
  checkpoint: {
    keep: ['loop', 'memories', 'skills', ...STATS.map(([id]) => st(id))], // 영혼에 붙은 것(기억·능력·능력치)은 남고, 몸·세상에 붙은 것(소지품·신분)은 되감긴다
    notify: '[회귀 {loop}회차] 눈을 뜨면 다시 그날이다 — {scn_label}이(가) 시작되던 그 시점. 세상과 사람들은 아무것도 기억하지 못하고, 유저만 이전 판을 기억한다. '
      + '되돌아온 그 장면에서 다시 시작하라. 유저가 기억하는 것: {memories}',
  },
  // 보조 갈림길 세 벌 (v1.13.0) — ① 면접 답변지(이벤트가 부른다) ② 원작 보정력(파멸도 30↑) ③ 평소 장면의 능력치 판정 선택지(킹덤컴식, 턴당 10%)
  // 추첨은 배열 순서 — 원작 보정력이 능력치 선택지보다 먼저
  liveChoices: [{
    id: 'interview', label: '면접', icon: '📝',
    when: 'pov == "servant" and scn_act == "prologue" and not hired',
    chance: 0, count: [3, 3],
    tags: [
      { id: '정답', desc: '로제타의 속내(버려질까 두려움·쓸모를 증명하려는 조급함)를 꿰뚫되 동정하지 않는 답', effects: doneTag(2) },
      { id: '무난', desc: '흠잡을 데 없지만 로제타의 눈에 띄지 않는 모범 답안', effects: doneTag(1) },
      { id: '실언', desc: '로제타의 역린(무능·사생아 출신·분홍 머리)을 건드리거나 동정하는 답', effects: doneTag(0) },
    ],
    // 섞는다 — 모델은 좋은 답을 먼저 쓰고 최악은 늘 끝이라 자리만 봐도 답이 보였다 (실기). 안 고르고 직접 답하면 무난(1점)으로 친다 [유저 2026-09-26]
    shuffle: true, worst: '무난', strict: false, timeout: 1,
    guide: '방금 서사에서 로제타가 던진 면접 질문에 대한 지원자(유저)의 답변 후보를 쓴다. 답변은 지원자의 대사 한 줄로. '
      + '로제타는 오만하지만 버려질까 두려워하고, 동정을 가장 싫어하고, 쓸모를 증명하고 싶어 한다 — 이 성격을 근거로 세 답의 무게를 가려라. 세 답이 서로 뚜렷이 달라야 한다.',
    desc: '로제타의 질문에 뭐라고 답할까',
    showTags: false,
  }, CANON_LIVE, {
    id: 'stat', label: '어떻게 할까', icon: '🎲',
    when: 'not (pov == "servant" and not hired)',
    chance: 0.1, count: [2, 3], shuffle: true, worst: '그냥', timeout: 2,
    tags: [
      ...STATS.map(([id, label, what]) => ({ id: label, desc: `${label} 판정이 걸린 도전 — ${what}`, check: `c_${id}` })),
      { id: '그냥', desc: '판정 없이 무난하게 넘기는 길' },
    ],
    guide: '지금 장면에서 유저가 해 볼 만한 서로 다른 행동을 쓴다. 능력치를 시험하는 행동에는 그 능력 태그를 붙인다 — 성공할 수도 실패할 수도 있는 도전이어야 한다 '
      + '(예: 무례한 손님을 말로 돌려보낸다=화술, 떨어지는 쟁반을 받아 낸다=가사, 취객의 손목을 비튼다=검술). 하나는 태그 "그냥". 이미 끝난 일·일반론은 금지.',
    desc: '어떻게 할까',
  }],
  scenario: {
    label: '원작 탈출',
    acts: [
      { id: 'prologue', label: '서장 · 빙의', intensity: '잠복',
        direct: '원작 <사랑받는 후작 영애의 조건>의 초반이다. 엘리시아가 12년 만에 에버렛 후작가로 돌아왔고, 그녀의 데뷔탕트가 코앞이다. '
          + '로제타는 아직 원작의 악행을 하나도 저지르지 않았다. 지금은 빙의자가 자기 처지를 파악하는 시간이다.' },
      { id: 'debut', label: '1장 · 데뷔탕트', intensity: '전개',
        unlock: '(pov != "servant" and scn_turns >= 3) or hired',
        direct: '원작이라면 이 장에서: 제국력 472년 3월 10일 밤 황궁 대연회장에서 엘리시아가 화려하게 데뷔하고, 황태자 에르테미안이 그녀에게 호의를 보인다. '
          + '로제타는 자신의 비참했던 데뷔탕트가 떠올라 질투에 불탄다. 원작의 이 사건은 어떤 형태로든 일어나려 한다 — 누가, 어떻게는 지금까지의 서사가 정한다. '
          + '무도회 전까지는 준비·소문·만남으로 그날을 향해 조여 가라.',
        onEnter: [
          { list: 'quests', remove: [Q_ROSETTA, Q_SERVANT, Q_SPECIAL], add: [Q_DEBUT, ...Q_SUBS_1] },
          { checkpoint: 'save' },
        ],
        notify: '[1장] 엘리시아의 데뷔탕트가 다가온다 — 3월 10일 밤, 황궁 대연회장.' },
      // ── 2장부터 [사건 원본: 원작 타임라인 2~4막·파양·처형 / 해금·여파·문장 초안] — 막은 덧붙이기 전용(세이브의 scn_idx는 번호) ──
      { id: 'tea', label: '2장 · 다과회와 소문', intensity: '전개', unlock: nextUnlock(1),
        direct: '원작이라면 이 장에서: 로제타가 다과회에 엘리시아를 초대하고, 하녀를 시켜 엘리시아의 드레스에 차를 쏟게 해 모두 앞에서 망신을 준다. '
          + '로제타는 "에버렛 영애가 실종된 동안 천한 곳에서 자랐다"는 악소문을 사교계에 퍼뜨린다. 그사이 인물들이 하나씩 엘리시아와 얽힌다 — '
          + '에르테미안은 연회 파트너로 그녀를 고르고, 리칼은 우연히 그녀와 마주치고, 유온은 동방의 왕자로 다가오고, 테리안은 상단 일로 엇갈린다. '
          + '원작의 이 사건들은 어떤 형태로든 일어나려 한다 — 누가, 어떻게는 지금까지의 서사가 정한다. 다과회 전까지는 초대장·소문·만남으로 그 자리를 향해 조여 가라.',
        onEnter: enterCh('tea', [...SUBS.debut]),
        notify: '[2장] 다과회 초대장이 돌기 시작한다 — 사교계가 돌아온 에버렛 영애를 두고 수군거린다.' },
      { id: 'stairs', label: '3장 · 계단과 과자', intensity: '고조', unlock: nextUnlock(2),
        direct: '원작이라면 이 장에서: 로제타가 하인을 매수해 엘리시아를 계단에서 떨어뜨린다(엘리시아는 근처의 도움으로 가벼운 상처에 그친다). '
          + '로제타는 화해하는 척 약한 독을 넣은 과자를 보내지만, 엘리시아는 통찰의 권능으로 악의를 알아채 먹지 않는다. '
          + '에르테미안과 엘리시아는 부쩍 가까워지고, 로제타는 사교계에서 고립되며 카르디온가의 냉대도 깊어진다. '
          + '원작의 이 사건들은 어떤 형태로든 일어나려 한다 — 누가, 어떻게는 지금까지의 서사가 정한다.',
        onEnter: enterCh('stairs', SUBS.tea),
        notify: '[3장] 사교계의 공기가 달라졌다 — 엘리시아 곁엔 사람이 늘고, 로제타 곁엔 줄어든다.' },
      { id: 'night', label: '4장 · 파국의 밤', intensity: '절정', unlock: nextUnlock(3),
        direct: '원작이라면 이 장에서: 저녁 모임 날, 로제타가 엘리시아를 인적 없는 곳으로 꾀어내 칼로 해치려다 황태자 에르테미안을 비롯한 이들에게 그 자리에서 제압당한다. '
          + '원작의 이 사건은 어떤 형태로든 일어나려 한다 — 로제타가 칼을 들지 않아도, 원작은 칼을 든 누군가와 로제타의 이름을 준비해 둔다. '
          + '누가, 어떻게는 지금까지의 서사가 정한다. 저녁 모임 전까지는 초대·불안·엇갈림으로 그 밤을 향해 조여 가라.',
        onEnter: enterCh('night', [...SUBS.stairs, SUB_SWEETS]),
        notify: '[4장] 저녁 모임의 초대장이 왔다. 원작이라면 그 밤이 로제타의 마지막 밤이다.' },
      { id: 'verdict', label: '5장 · 심판', intensity: '절정', unlock: nextUnlock(4),
        direct: '원작이라면 이 장에서: 카르디온 공작가가 로제타를 가문에서 파양하고, 공작도 리칼도 로제타를 버린다. 로제타는 처형된다 — 원작 속 로제타의 결말이다. '
          + '심판의 날까지 며칠이 남았다. 누가 로제타의 편에 설지는 지금까지 쌓은 관계가 정한다 — 면회·편지·설득으로 그날을 향해 조여 가라.',
        onEnter: enterCh('verdict', SUBS.night),
        notify: '[5장] 로제타가 에버렛 영애를 해치려 했다는 고발이 황궁에 올라갔다 — 심판의 날이 잡혔다.' },
      // 원작 이후 — 2부(진영 줄기·무대 뒤, 설계 §15)는 여기 뒤에 덧붙인다
      { id: 'after', label: '원작 이후', intensity: '해소', unlock: 'cleared >= 5',
        direct: '원작의 마지막 장이 지나갔다 — 로제타는 처형대에 서지 않았다(결말: {ending}). 빙의자의 원작 지식은 여기서 끝난다. 이제부터는 누구도 모르는 이야기다. '
          + '인물들의 풀리지 않은 목표·두려움·비밀이 새 사건의 씨앗이다 — 결말이 남긴 것(도주라면 추격, 추방이라면 떨어진 거리)을 이어 가라.',
        onEnter: [{ list: 'quests', remove: SUBS.verdict }, { set: 'on_stage', expr: 'false' }, { checkpoint: 'save' }],
        notify: '[원작 이후] 처형대는 비어 있다. 원작이 끝난 세계 — 여기서부터는 아무도 모르는 이야기다.' },
    ],
  },
  directives: [
    { id: 'pov_rosetta', when: 'pov == "rosetta"',
      text: '[시점] 유저는 로제타 비올라 카르디온의 몸에 빙의한 현대인이다. 모든 서술·대사에서 유저를 로제타로 부르고, 주변 인물은 유저를 로제타로 대한다. '
        + '유저의 원래 이름이나 "플레이어"·"유저" 같은 말은 본문에 쓰지 마라. 빙의자는 원작 소설을 읽었다.' },
    { id: 'pov_servant', when: 'pov == "servant"',
      text: '[시점] 유저는 원작에 이름 한 줄 없는 인물의 몸에 빙의한 현대인이다 — 이름·성별·출신은 페르소나를 따른다. 빙의자는 원작 소설을 읽었다. '
        + '로제타는 빙의되지 않은 원래의 로제타다. 유저의 자리: 로제타 전속 시종(합격 전에는 지원자).' },
    // 빙의자 로제타 [원본 Special Scenario + Possessor Profile을 옮김] — 빙의자는 유저가 아니라 로제타 안의 다른 사람
    { id: 'pov_special', when: 'pov == "special"',
      text: '[시점] 유저는 로제타가 아니다 — 이름·성별·신분은 페르소나를 따른다. 로제타 비올라 카르디온의 몸에는 현대 한국에서 온 다른 영혼(빙의자)이 들어 있다. '
        + '빙의자는 원작 소설 <사랑받는 후작 영애의 조건>을 읽어 앞으로 올 일과 로제타의 비참한 결말을 안다. 빙의자 로제타는 유저가 움직이지 않는 인물이다 — '
        + '처형을 피하려고 스스로 움직이고, 빙의 사실은 쉽게 털어놓지 않는다. 로제타답게 굴려 애쓰지만 원작의 로제타와 어긋나는 틈이 드러난다.' },
    { id: 'possessor', when: 'pov == "special" and possessor != ""',
      text: '[빙의자 설정] 로제타 안의 빙의자: {possessor}' },
    { id: 'interview', when: 'pov == "servant" and scn_act == "prologue" and not hired',
      text: '[면접] 지금은 카르디온 공작저에서 로제타 전속 시종 면접이 열리는 날이다. 로제타의 곁은 오래 버티는 사람이 없어 자리가 자주 빈다. '
        + '로제타가 직접 면접관이다 — 오만하고 날카롭게, 한 번에 질문 하나씩. 합격·탈락은 시스템이 정하니 서사가 먼저 결론을 내지 마라.' },
    { id: 'bond', when: 'true',
      text: '[관계] 호감은 관계의 거리다. 그 관계가 우정·충성·연애 중 어디로 자랄지는 유저의 행동과 페르소나가 정한다 — 인물의 성별로 연애 여부를 짐작하지 마라.' },
    { id: 'stats', when: 'true',
      text: '[능력치] 유저의 솜씨는 상태의 능력치(0~100 — 평범 10~20 · 숙련 40~60 · 달인 80 이상)를 따른다. 판정이 없는 장면에서도 그 수준에 맞게 그려라.' },
    { id: 'minors', when: 'true',
      text: '[금지] 드미트리샤(17)와 엘시(16)는 미성년자다. 이 둘과의 관계는 우정·보호로만 그리고, 연애·성적 묘사는 어떤 경우에도 쓰지 않는다.' },
    { id: 'loop', when: 'loop >= 1',
      text: '[회귀 {loop}회차] 유저는 이미 한 번 이상 죽고 되돌아왔다. 이전 판을 기억하는 건 유저뿐이고, 세상과 다른 인물은 모든 걸 처음 겪는다. 유저가 기억하는 것: {memories}' },
    // 결판과 다음 장 사이의 여파 3턴
    { id: 'aftermath', when: 'chapter >= 1 and chapter <= 4 and cleared >= chapter',
      text: '[여파] 이 장의 원작 사건이 지나갔다. 다음 원작 사건은 아직 오지 않았다 — 여파와 일상을 자유롭게 이어 가라.' },
    // 5장 — 파멸도가 낮으면 심판이 아니라 해명의 자리 [설계 §6]
    { id: 'verdict_trial', when: 'scn_act == "verdict" and cleared < 5 and doom > 30',
      text: '[심판] 로제타는 에버렛 영애를 해치려 한 혐의를 받고 있다. 증거보다 소문이 먼저 심판정에 도착해 있고, 원작의 결말이 로제타를 기다린다.' },
    { id: 'verdict_hearing', when: 'scn_act == "verdict" and cleared < 5 and doom <= 30',
      text: '[해명] 로제타에게 혐의가 씌워졌지만 증거가 엇갈린다 — 심판이라기보다 해명의 자리다. 원작의 결말은 아직 로제타를 놓지 않았지만, 틈이 있다.' },
  ],
  promptState: {
    template: '지금: 제국력 {year}년 {date} {clock} · {location}\n진행 중인 일: {quests}\n유저: {role} · 능력: {skills} · 소지품: {items}\n능력치: 검술 {st_sword} · 마법 {st_magic} · 화술 {st_talk} · 매력 {st_charm} · 가사 {st_house}',
    systemGuide: '한 응답 = 한 장면. 지금 이 자리에서 벌어지는 일을 끝까지 그리고 거기서 멈춰라 — 장면을 넘길지는 유저가 정한다. '
      + '수치·퀘스트·회귀는 시스템이 관리하니 숫자를 본문에 쓰지 마라.',
  },
  // 상태창 — 두 장: 현황(원작·관계·진행) | 나(신상·가진 것·기억 — 유저 "페르소나 전용 탭"). 꾸밈은 "밤의 무도회" [유저 2026-09-25 세 시안 중 선택]
  // 둘째 장 이름은 "빙의자"였다가 "나"로 — 빙의자 로제타 시점에선 빙의자가 유저가 아니라 로제타다
  statusUI: {
    mode: 'auto', layout: 'tabs', theme: 'clean', changeLog: 'collapsed',
    customCSS: fs.readFileSync(__P('상태창/밤의무도회.css'), 'utf8'),
    groups: [
      { tab: '현황', label: '면접', showWhen: 'pov == "servant" and scn_act == "prologue" and not hired', items: [{ var: 'iv_q', label: '질문' }] },
      { tab: '현황', label: '로제타', items: [
        { var: 'doom', label: '파멸도', bar: { max: 100 }, color: "doom >= 70 ? '#e36b7d' : doom >= 40 ? '#d4b26a' : '#9fc79a'" },
        { var: 'rep', label: '평판' },
        { var: 'health', label: '로제타의 몸', bar: { max: 100 }, color: "health <= 30 ? '#e36b7d' : '#b9a3e0'" },
      ] },
      { tab: '현황', label: '관계', items: [
        ...PEOPLE.map(([id, label]) => ({ var: id, label, bar: { max: 100 }, ...(id === 'rosetta' ? { showWhen: 'pov != "rosetta"' } : {}) })),
        { var: 'ties', label: '그 밖의 관계', showWhen: 'count(ties) > 0' },
      ] },
      { tab: '현황', label: '진행', items: [
        { var: 'location', label: '장소' },
        { var: 'quests', label: '퀘스트' },
        { var: 'ending', label: '결말', showWhen: 'ending != ""' },
      ] },
      { tab: '나', label: '신상', items: [
        { var: 'role', label: '신분', showWhen: 'role != ""' },
        { var: 'loop', label: '회귀', showWhen: 'loop >= 1' },
      ] },
      { tab: '나', label: '능력치', items: STATS.map(([id, label]) => ({ var: st(id), label, bar: { max: 100 } })) },
      { tab: '나', label: '가진 것', items: [
        { var: 'skills', label: '능력' },
        { var: 'items', label: '소지품' },
      ] },
      { tab: '나', label: '회귀의 기억', showWhen: 'count(memories) > 0', items: [{ var: 'memories', label: '기억' }] },
    ],
  },
  setup: {
    presets: [
      { id: 'rosetta', label: '💎 로제타 빙의 — 원작 악녀 본인으로', set: { pov: 'rosetta', quests: [Q_ROSETTA], ...ROSETTA_STATS }, startAt: '0472-03-01 08:00' },
      { id: 'servant', label: '🕊️ 로제타의 시종 빙의 — 면접부터', set: { pov: 'servant', quests: [Q_SERVANT], location: '카르디온 공작저 응접실', role: '전속 시종 지원자' }, startAt: '0472-02-24 09:00' },
      { id: 'special', label: '🌹 빙의자 로제타 — 로제타 곁의 누군가로', set: { pov: 'special', quests: [Q_SPECIAL], role: '', skills: [] }, startAt: '0472-03-01 08:00' },
    ],
    // 최초 설정은 프리셋이 정한 값(신분·능력)을 못 본다 — 보조 창구엔 스키마 init만 뜨고 값은 절대값으로 덮이니, 프리셋마다 다른 칸은 싣지 않는다
    ai: {
      enabled: true, vars: ['location', 'items', 'skills', 'possessor', ...STATS.map(([id]) => st(id))],
      guide: '소지품·능력은 첫 장면에 실제로 나온 것만 기본값에 덧붙인다 — 안 나왔으면 values에 넣지 마라. '
        + '능력치(st_*)는 유저가 첫 메시지에서 자기 배경을 밝혔을 때만 기본값에서 ±30 안으로 조정한다 — 로제타의 몸에 빙의한 판(거울 속 분홍 머리)이면 넣지 마라. '
        + 'possessor(빙의자 설정)는 유저가 첫 메시지에서 로제타 안의 빙의자를 설명했을 때만 그 설명을 옮겨 적는다 — 없으면 넣지 마라.',
      instruction: '[첫 장면] 지금 응답이 이 판의 첫 장면이다. 위 [시점] 지시를 따라 장면을 연다 — 로제타 시점이면 거울 앞에서 깨어난 직후를 이어서, '
        + '시종 시점이면 카르디온 공작저에서 로제타 전속 시종 면접을 기다리는 자리에서, 빙의자 로제타 시점이면 유저가 첫 메시지에 밝힌 자리에서 '
        + '소문과 다른 로제타와 엇갈리는 순간을 향해. 목록으로 나열하지 말고 장면으로.',
    },
  },
};

// ══════════ 시험 ══════════
let fails = 0;
const ok = (name, cond, extra = '') => { if (cond) console.log('  ✓ ' + name); else { console.log('  ❗ ' + name + (extra ? ' → ' + extra : '')); fails++; } };
const cp = (o) => JSON.parse(JSON.stringify(o));

console.log('━━ 검증 ━━');
const v = validateSchema(S);
ok('검증 오류 0', v.errors.length === 0, JSON.stringify(v.errors, null, 1));
for (const w of v.warnings) console.log(`  · 경고 ${w.path}: ${w.msg}`);

let seedN = 0;
const RNG = (tag) => seededRng('villainess', ++seedN, tag);
const start = (preset) => { let st = engine.initState(S); st = engine.applyPreset(S, st, preset).state; st.meta.setupDone = true; return st; };
const send = (st, opt = {}) => engine.sendPhase(S, st, { rng: RNG('s'), ...opt });
const out = (st, ch = {}, opt = {}) => engine.outputPhase(S, st, ch, {}, { rng: RNG('o'), ...opt });
const turn = (st, ch = {}, opt = {}) => { const s = send(st, opt.send || {}); const o = out(s.state, ch, opt.out || {}); return { s, o, st: o.state }; };
const L = (st, n) => engine.makeLookup(S, st.vars)(n);
const ANSWERS = (tags) => ({ desc: '로제타의 질문', items: [{ label: '당신은 버려질까 두려운 게 아니라, 쓸모를 증명하고 싶은 겁니다.', tag: '정답' },
  { label: '성실히 모시겠습니다.', tag: '무난' }, { label: '분홍 머리가 참 예쁘시네요, 가엾게도.', tag: '실언' }].filter((x) => tags.includes(x.tag)) });
// 면접 한 문항: 질문 부탁(앞 턴) → 보조 답변지 → 유저 선택
function answer(st, tag) {
  let t = turn(st, {}, { out: { choices: ANSWERS(['정답', '무난', '실언']) } });
  st = t.st;
  if (st.meta.pendingChoice?.id !== '@live') return { st, err: '답변지가 안 걸렸다 ' + JSON.stringify(st.meta.pendingChoice) };
  st.meta.pendingChoicePick = st.meta.pendingChoice.live.items.findIndex((x) => x.tag === tag); // 섞여 있다 (v1.13.0) — 자리 말고 태그로
  t = turn(st);
  return { st: t.st, t };
}

console.log('\n━━ 시종 시점 — 면접 합격 ━━');
{
  let st = start('servant');
  ok('시작: 2월 24일 · 면접 퀘스트 · 서장', L(st, 'date') === '2월 24일' && st.vars.quests[0] === Q_SERVANT && L(st, 'scn_act') === 'prologue', `${L(st, 'date')} ${st.vars.quests}`);
  const p0 = send(st).promptBlock;
  ok('프롬프트: 시종 시점 · 면접 지시 · 금지 줄', p0.includes('로제타 전속 시종') && p0.includes('[면접]') && p0.includes('미성년자'), '');
  ok('프롬프트: 제국력 472년', p0.includes('제국력 472년 2월 24일'), p0.slice(0, 120));
  let t = turn(st); st = t.st; // 첫 장면 → 저장 + 첫 질문 부탁
  ok('첫 턴: 체크포인트 저장 · 질문 부탁', st.checkpoints?.main && st.vars.iv_asking === true && st.meta.liveAsk === true, JSON.stringify({ a: st.vars.iv_asking, l: st.meta.liveAsk }));
  ok('질문 부탁이 다음 프롬프트에', send(st).promptBlock.includes('[면접] 로제타가 다음 질문을'), '');
  for (const tag of ['정답', '정답', '무난']) { const r = answer(st, tag); if (r.err) { ok('면접 진행', false, r.err); break; } st = r.st; }
  ok('3문항 뒤 합격 → 1장', st.vars.hired === true && L(st, 'scn_act') === 'debut', JSON.stringify({ q: st.vars.iv_q, s: st.vars.iv_score, act: L(st, 'scn_act') }));
  ok('1장 퀘스트로 교체', st.vars.quests.includes(Q_DEBUT) && !st.vars.quests.includes(Q_SERVANT) && Q_SUBS_1.every((q) => st.vars.quests.includes(q)), JSON.stringify(st.vars.quests));
  ok('로제타 호감 +10', st.vars.rosetta === 25, String(st.vars.rosetta));
  ok('1장 체크포인트 = 1장 시작', st.checkpoints.main.vars.scn_idx === 1, '');
  ok('신분: 지원자 → 전속 시종', st.vars.role === '로제타 전속 시종' && st.checkpoints.main.vars.role === '로제타 전속 시종', st.vars.role);
  // 상태창 두 장 — 현황 | 빙의자
  const html = SC.require('render').renderStatusHtml(S, st, null, null, { uid: 9 });
  const tabs = (html.match(/<label class="sim-tab[^>]*>[^<]*<\/label>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));
  const persona = html.slice(html.indexOf('sim-panel-1'));
  ok('★ 상태창 탭 두 장: 현황 | 나', tabs.join('|') === '현황|나', tabs.join('|'));
  ok('나 장: 신분·능력·소지품, 현황 수치는 없다', persona.includes('로제타 전속 시종') && persona.includes('원작 지식') && persona.includes('>소지품<') && !persona.includes('파멸도'), persona.slice(0, 300));
  ok('프롬프트에 유저 한 줄', send(st).promptBlock.includes('유저: 로제타 전속 시종 · 능력: 원작 지식 · 소지품: (없음)'), '');
}

console.log('\n━━ 능력치 — 수련 · 판정 선택지 · 회귀 ━━');
{
  // 면접 중엔 수련 잠김
  let st = start('servant');
  ok('면접 전 시종은 수련 잠김', engine.toggleAction(S, st, 'train_talk').blocked != null, JSON.stringify(engine.toggleAction(S, st, 'train_talk')));
  // 합격한 시종 — 수련 한 번 = 두 시간, 능력치 +1~3
  st.vars.hired = true; st.vars.scn_idx = 1;
  const clock0 = L(st, 'clock');
  st = engine.toggleAction(S, st, 'train_talk').state;
  const talk0 = st.vars.st_talk;
  const t = turn(st, { skip_min: 15 });
  ok('★ 수련: 화술 +1~3 · [판정] 화술 수련', t.st.vars.st_talk >= talk0 + 1 && t.st.vars.st_talk <= talk0 + 3 && t.s.promptBlock.includes('[판정] 화술 수련:'),
    `${talk0} → ${t.st.vars.st_talk}`);
  ok('수련은 작중 두 시간 (보조 추정 15분은 버린다)', L(t.st, 'clock') === '11:00' && clock0 === '09:00', `${clock0} → ${L(t.st, 'clock')}`);
  ok('채팅 낱말로도 무장 ("검술 수련")', engine.autoArmActions(S, t.st, '오늘은 검술 수련을 하러 연무장에 간다').state.meta.armed.train_sword === true, '');
  // 로제타의 몸 — 마법은 흩어지고 권능의 흔적이 선다
  let r = start('rosetta');
  r = engine.toggleAction(S, r, 'train_magic').state;
  const rt = turn(r);
  ok('★ 로제타 마법 수련: 흩어짐 — 마법 0 그대로 · 권능 흔적 1 · 비밀 2단계', rt.st.vars.st_magic === 0 && rt.st.vars.awaken === 1 && rt.st.vars.sec_power >= 1
    && rt.s.promptBlock.includes('손끝에서 이유 없이 흩어진다'), JSON.stringify({ m: rt.st.vars.st_magic, a: rt.st.vars.awaken, p: rt.st.vars.sec_power }));
  ok('로제타 시점 마법 판정은 0%', engine.checkOdds(S, rt.st, S.checks.find((c) => c.id === 'c_magic')).pct === 0, '');
  // 평소 장면의 능력치 선택지 (킹덤컴식)
  let q = start('rosetta');
  q.meta.liveAsk = 'stat';
  const qa = engine.buildAuxPrompt(S, q, '로니카가 부채 너머로 비웃는다.', null, '');
  ok('보조 지시: 능력치 벌 — 태그 다섯 + 그냥', qa.includes('[어떻게 할까 — 선택지 쓰기]') && ['검술', '마법', '화술', '매력', '가사', '그냥'].every((x) => qa.includes(x)), '');
  const qo = out(q, {}, { choices: { desc: '로니카의 도발', items: [{ label: '부채를 접으며 받아친다', tag: '화술' }, { label: '미소로 무시한다', tag: '매력' }, { label: '자리를 뜬다', tag: '그냥' }] } });
  const qh = SC.require('render').renderStatusHtml(S, qo.state, null, null, { uid: 6 });
  ok('★ 상태창: 🎲 판정 칩 (로제타 화술 45 → 65% · 매력 60 → 75%) · 그냥은 태그 · 안 고르면 그냥', qh.includes('🎲 화술 65%') && qh.includes('🎲 매력 75%') && qh.includes('sim-choice-tag">그냥') && qh.includes("'그냥' 항목으로"),
    (qh.match(/🎲[^<]*|'그냥' 항목으로/g) || []).join(' · '));
  // 회귀해도 능력치는 남는다
  let g = start('servant');
  g = turn(g).st;
  g.vars.st_talk = 44;
  for (const tag of ['실언', '실언', '실언']) { const a = answer(g, tag); if (a.err) break; g = a.st; }
  ok('★ 회귀해도 능력치는 남는다', g.vars.loop === 1 && g.vars.st_talk === 44, JSON.stringify({ loop: g.vars.loop, talk: g.vars.st_talk }));
  // 면접에서 직접 답하면 무난(1점)
  let f = start('servant');
  f = turn(f).st;
  f = turn(f, {}, { out: { choices: ANSWERS(['정답', '무난', '실언']) } }).st;
  const f2 = turn(f, {}, { send: { userText: '저는 아가씨가 가진 걸 증명하도록 곁에서 돕고 싶습니다.' } });
  ok('★ 면접에서 직접 답하면 무난(1점) — 다음 응답 단계에서 바로', f2.st.vars.iv_q === 1 && f2.st.vars.iv_score === 1 && !f2.st.meta.pendingChoice,
    JSON.stringify({ q: f2.st.vars.iv_q, s: f2.st.vars.iv_score }));
}

console.log('\n━━ 빙의자 로제타 시점 (원본 Special) ━━');
{
  let st = start('special');
  ok('시작: 3월 1일 · 서장 · 빙의자 로제타 퀘스트 · 신분·능력 빈칸', L(st, 'date') === '3월 1일' && st.vars.quests[0] === Q_SPECIAL && st.vars.role === '' && st.vars.skills.length === 0,
    JSON.stringify({ q: st.vars.quests, r: st.vars.role, s: st.vars.skills }));
  let p = send(st).promptBlock;
  ok('프롬프트: 로제타 안의 다른 영혼 · 유저는 로제타가 아니다 · 면접·로제타 빙의 지시 없음',
    p.includes('유저는 로제타가 아니다') && p.includes('다른 영혼(빙의자)') && !p.includes('[면접]') && !p.includes('로제타 비올라 카르디온의 몸에 빙의한 현대인'), '');
  ok('빙의자 설정이 비면 설정 줄도 없다', !p.includes('[빙의자 설정]'), '');
  // 최초 설정이 첫 메시지의 빙의자 설명을 옮겨 적는다
  // 최초 설정 창구는 프리셋 값을 기본으로 보인다 (엔진 v1.13.0) — 빙의자 로제타의 유저는 능력 빈칸·평범한 능력치에서 출발
  const sp = engine.buildSetupPrompt(S, st, '첫 장면');
  ok('★ 최초 설정 창구: 능력 기본 [] (원작 지식 아님) · 능력치 기본 = 평범한 시종', /skills \(능력, 목록\)[^\n]*기본 \[\]/.test(sp) && /st_house[^\n]*기본값 25/.test(sp),
    sp.split('\n').filter((l) => /skills|st_house/.test(l)).join(' / '));
  st = engine.setupPhase(S, st, { possessor: '서른 살 사회부 기자. 냉소적이고 말이 빠르다' }, {}).state;
  ok('최초 설정: 빙의자 설정을 옮겨 적는다', st.vars.possessor.startsWith('서른 살') && st.vars.skills.length === 0, JSON.stringify(st.vars.skills));
  p = send(st).promptBlock;
  ok('빙의자 설정이 프롬프트에', p.includes('[빙의자 설정] 로제타 안의 빙의자: 서른 살 사회부 기자'), '');
  const html = SC.require('render').renderStatusHtml(S, st, null, null, { uid: 3 });
  ok('상태창: 로제타 호감 줄이 보이고, 빈 신분 줄은 숨는다', html.includes('>로제타</span>') && !html.includes('>신분<'), '');
  for (let i = 0; i < 3; i++) st = turn(st, { skip_min: 30 }).st;
  st = turn(st).st;
  ok('서장 3턴 → 1장 · 퀘스트 교체', L(st, 'scn_act') === 'debut' && !st.vars.quests.includes(Q_SPECIAL) && st.vars.quests.includes(Q_DEBUT), JSON.stringify(st.vars.quests));
  st = turn(st, { on_stage: true }).st;
  ok('무도회장 → 빙의자 로제타 절정 갈림길', st.meta.pendingChoice?.id === 'debut_special', JSON.stringify(st.meta.pendingChoice));
  ok('절정 통지: 빙의자도 이 장면을 안다', send(st).promptBlock.includes('로제타 안의 빙의자도 이 장면을 안다'), '');
}

console.log('\n━━ 시종 시점 — 면접 탈락 → 회귀 ━━');
{
  let st = start('servant');
  st = turn(st).st;
  st.vars.memories = ['로제타는 동정받는 걸 가장 싫어한다'];
  st.vars.skills = ['원작 지식', '독 감별'];
  st.vars.items = ['낡은 추천서'];
  let last;
  for (const tag of ['실언', '무난', '실언']) { const r = answer(st, tag); if (r.err) { ok('면접 진행', false, r.err); break; } st = r.st; last = r.t; }
  ok('탈락 → 회귀 1회차 · 면접 처음부터', st.vars.loop === 1 && st.vars.iv_q === 0 && st.vars.iv_score === 0 && !st.vars.hired && L(st, 'scn_act') === 'prologue',
    JSON.stringify({ loop: st.vars.loop, q: st.vars.iv_q, act: L(st, 'scn_act') }));
  ok('기억은 남는다', st.vars.memories[0] === '로제타는 동정받는 걸 가장 싫어한다', JSON.stringify(st.vars.memories));
  ok('능력은 남고 소지품·신분은 되감긴다', st.vars.skills.includes('독 감별') && st.vars.items.length === 0 && st.vars.role === '전속 시종 지원자',
    JSON.stringify({ s: st.vars.skills, i: st.vars.items, r: st.vars.role }));
  ok('날짜도 되감김 (2월 24일)', L(st, 'date') === '2월 24일', L(st, 'date'));
  const p = send(st).promptBlock;
  ok('게임오버 + 회귀 안내 + 기억이 프롬프트에', p.includes('[게임오버] 면접에서 떨어졌다') && p.includes('[회귀 1회차]') && p.includes('동정받는 걸'), p.slice(0, 400));
  // 회귀한 판에서 다시 면접이 열린다
  st = turn(st).st;
  ok('회귀 뒤 질문 부탁이 다시 선다', st.vars.iv_asking === true, '');
}

console.log('\n━━ 로제타 시점 — 서장 → 1장 → 데뷔탕트 ━━');
let debutState;
{
  let st = start('rosetta');
  ok('시작: 3월 1일 · 서장', L(st, 'date') === '3월 1일' && L(st, 'scn_act') === 'prologue', L(st, 'date'));
  const p0 = send(st).promptBlock;
  ok('프롬프트: 로제타 시점 · 면접 없음', p0.includes('로제타 비올라 카르디온의 몸에 빙의') && !p0.includes('[면접]'), '');
  ok('★ 비밀: 낌새만, 전모 없음', p0.includes('마도구 불빛') && !p0.includes('여덟 살 각성식') && !p0.includes('마석 가루를 삼키고 피를') && !p0.includes('코피'), '');
  for (let i = 0; i < 3; i++) st = turn(st, { skip_min: 30 }).st;
  st = turn(st).st;
  ok('서장 3턴 → 1장', L(st, 'scn_act') === 'debut', L(st, 'scn_act'));
  ok('면접은 안 열린다', !st.vars.iv_asking && st.vars.iv_q === 0, '');
  // 무도회까지 며칠 — 무대 뒤가 흐른다
  let t = turn(st, { skip_day: 8 }); st = t.st;
  ok('원작의 흐름: 1장부터 흐른다 (8일 × 2 + 전환 턴 30분)', Math.floor(st.vars.fr_canon) === 16 && st.vars.frs_canon === 0, `${st.vars.fr_canon} ${st.vars.frs_canon}`);
  const p1 = send(st).promptBlock;
  ok('징후는 깔리고 시계·밑작업은 없다', p1.includes('하인들이 로제타가 지나가면') && !p1.includes('로니카가 로제타의') && !/fr_canon/.test(p1), '');
  ok('상태창에 원작의 흐름이 안 보인다', !/원작의 흐름|fr_canon/.test(SC.require('render').renderStatusHtml(S, st, t.o.changeLog)), '');
  debutState = cp(st);
  t = turn(st, { on_stage: true }); st = t.st;
  ok('무도회장 도착 → 절정 갈림길', st.meta.pendingChoice?.id === 'debut_rosetta', JSON.stringify(st.meta.pendingChoice));
  // 킹덤컴식 — 판정 달린 항목에 성공률 (로제타의 몸: 화술 45 → 어려움 45% · 매력 60 → 보통 75%)
  const ch = SC.require('render').renderStatusHtml(S, st, null, null, { uid: 4 });
  ok('★ 절정 선택지에 🎲 성공률 칩 (화술(어려움) 45% · 매력 75%)', ch.includes('🎲 화술(어려움) 45%') && ch.includes('🎲 매력 75%'), (ch.match(/🎲[^<]*/g) || []).join(' · '));
  st.meta.pendingChoicePick = 0;
  const talk0 = st.vars.st_talk;
  const s = send(st);
  const won = s.state.vars.chk_ok === true;
  ok(`엘리시아에게 손을 내민다 — 판정 ${won ? '성공: 파멸도 −10 · 엘리시아 +15 · 흐름 −20' : '실패: 파멸도 −3 · 엘리시아 +5 · 흐름 −5'}`,
    s.promptBlock.includes('[판정] 화술(어려움):') && (won
      ? s.state.vars.doom === 30 && s.state.vars.elicia === 45 && s.state.vars.fr_canon === 0 && s.state.vars.st_talk > talk0
      : s.state.vars.doom === 37 && s.state.vars.elicia === 35 && Math.abs(s.state.vars.fr_canon - 11.04) < 0.01 && s.state.vars.st_talk === talk0),
    JSON.stringify({ ok: s.state.vars.chk_ok, d: s.state.vars.doom, e: s.state.vars.elicia, c: s.state.vars.fr_canon, t: s.state.vars.st_talk }));
  ok('1장 결판', s.state.vars.cleared === 1 && !s.state.vars.quests.includes(Q_DEBUT) && s.state.vars.on_stage === false, JSON.stringify(s.state.vars.quests));
  ok('선택이 그 턴 프롬프트에', s.promptBlock.includes('[선택] 엘리시아에게 먼저 다가가'), '');
  st = out(s.state).state;
  ok('1장 이후 여파 안내', send(st).promptBlock.includes('[여파]'), '');
}

console.log('\n━━ 강제 — 안 고르면 원작대로 ━━');
{
  let st = cp(debutState);
  st = turn(st, { on_stage: true }).st;
  const s = send(st, { userText: '(아무것도 안 고르고 보낸다)' });
  ok('강제 결정 = 원작대로', s.forcedChoice?.label === '치미는 질투를 그대로 쏟아낸다' && s.state.vars.doom === 55, JSON.stringify({ f: s.forcedChoice, d: s.state.vars.doom }));
}

console.log('\n━━ 파멸도 100 → 회귀 (1장 시작으로) ━━');
{
  let st = cp(debutState);
  st.vars.doom = 99; st.vars.loop = 0;
  const t = turn(st, { doom: 3, skip_day: 1 }); st = t.st;
  ok('게임오버 → 1장 시작 시점', st.vars.loop === 1 && st.vars.doom === 40 && L(st, 'scn_act') === 'debut' && st.vars.fr_canon < 1,
    JSON.stringify({ loop: st.vars.loop, doom: st.vars.doom, act: L(st, 'scn_act'), c: st.vars.fr_canon }));
  ok('무대 뒤도 되감김', st.vars.frs_canon === -1, String(st.vars.frs_canon));
}

console.log('\n━━ 비밀 — 관측 가능한 행동이 연다 ━━');
{
  let st = start('rosetta');
  st = turn(st, { bottle_found: true }).st;
  const p = send(st).promptBlock;
  ok('작은 병을 열면 → 마석 가루 공개 · 안나도 같은 턴(sec_powder >= 1)', st.vars.sec_powder === 1 && st.vars.sec_anna === 1 && p.includes('마석 가루가 들어 있다'), `${st.vars.sec_powder} ${st.vars.sec_anna}`);
  ok('권능의 전모는 아직', !p.includes('여덟 살 각성식'), '');
}

console.log('\n━━ 무대 뒤 — 방치하면 소문이 표면화 ━━');
{
  let st = cp(debutState);
  st = turn(st, { skip_day: 17 }).st; // 16 + 34 = 50
  const p = send(st).promptBlock;
  ok('50 → 표면화: 소문 통지 · 밑작업 공개 · 파멸도 +10 · 평판 −5', p.includes('카르디온의 악녀가 돌아온 에버렛 영애를 노린다') && p.includes('로니카가 로제타의 첫 데뷔탕트 망신을')
    && st.vars.doom === 50 && st.vars.rep === -45, JSON.stringify({ d: st.vars.doom, r: st.vars.rep }));
}

console.log('\n━━ 호감 — 낱말 게이트 ━━');
{
  const allow = engine.auxAllowList(S, '엘리시아가 웃었다.', start('rosetta'));
  const ids = allow.map((a) => a.id || a);
  ok('엘리시아가 나온 턴: 엘리시아 칸만 열림', ids.includes('elicia') && !ids.includes('rical') && !ids.includes('ert'), JSON.stringify(ids));
}

console.log('\n━━ 1부 척추 — 2장 → 3장 → 4장 → 5장 심판 → 원작 이후 (로제타 시점) ━━');
// 막이 바뀔 때까지 턴을 돌린다 — 몇 턴 걸렸는지 돌려준다
const advance = (st, act, max = 8) => { for (let i = 1; i <= max; i++) { st = turn(st, { skip_min: 30 }).st; if (L(st, 'scn_act') === act) return { st, n: i }; } return { st, n: -1 }; };
const pickBy = (st, label) => { st.meta.pendingChoicePick = S.rules.events.find((e) => e.id === st.meta.pendingChoice.id).choices.findIndex((c) => c.label === label); return st; };
let verdictState;
{
  let st = cp(debutState);
  st = turn(st, { on_stage: true }).st;
  st = turn(pickBy(st, '질투가 치밀기 전에 무도회장을 빠져나온다')).st;
  ok('1장 결판 → 여파 (다음 장은 아직)', st.vars.cleared === 1 && L(st, 'scn_act') === 'debut' && send(st).promptBlock.includes('[여파]'), L(st, 'scn_act'));
  let a = advance(st, 'tea'); st = a.st;
  ok('★ 여파 3턴 → 2장 · 메인 교체 · 로니카 서브는 걷히고 작은 병은 남는다 · 체크포인트 = 2장 시작',
    a.n === 3 && st.vars.quests.includes(Q.tea) && st.vars.quests.includes(SUBS.debut[0]) && !st.vars.quests.includes(SUBS.debut[1])
    && SUBS.tea.every((q) => st.vars.quests.includes(q)) && st.checkpoints.main.vars.scn_idx === 2, JSON.stringify({ n: a.n, q: st.vars.quests }));
  const p2 = send(st).promptBlock;
  ok('★ 2장 프롬프트: 다과회 원작만 — 3장(계단)·4장(칼)은 없다', p2.includes('하녀를 시켜 엘리시아의 드레스에') && !p2.includes('계단에서 떨어뜨린다') && !p2.includes('칼로 해치려') && !p2.includes('[여파]'), '');
  st = turn(st, { on_stage: true }).st;
  ok('다과회 도착 → 2장 절정', st.meta.pendingChoice?.id === 'tea_rosetta', JSON.stringify(st.meta.pendingChoice));
  st = turn(pickBy(st, '엘리시아를 핑계 대고 다과회에서 빼낸다')).st;
  ok('2장 결판', st.vars.cleared === 2 && !st.vars.quests.includes(Q.tea), JSON.stringify(st.vars.quests));
  a = advance(st, 'stairs'); st = a.st;
  ok('→ 3장 · 2장 서브 걷힘', a.n === 3 && st.vars.quests.includes(Q.stairs) && !SUBS.tea.some((q) => st.vars.quests.includes(q)), JSON.stringify(st.vars.quests));
  // 과자 상자 — 3턴째 · 무대 없이 14턴이면 원작이 찾아온다
  let sweetsSeen = false, n = 0;
  while (!st.meta.pendingChoice && n < 20) { st = turn(st, { skip_min: 30 }).st; n++; if (send(st).promptBlock.includes('"화해의 선물" 과자 상자')) sweetsSeen = true; }
  ok('★ 과자 상자 사건 (3턴째) — 서브 추가 · 통지', sweetsSeen && st.vars.quests.includes(SUB_SWEETS), JSON.stringify(st.vars.quests));
  ok('★ 무대에 안 가도 14턴이면 3장 절정 (원작의 강제력)', st.meta.pendingChoice?.id === 'stairs_rosetta' && st.vars.scn_turns >= 14, `${n}턴 · scn_turns ${st.vars.scn_turns}`);
  const doom0 = st.vars.doom;
  const s = send(st, { userText: '(아무것도 안 고르고 보낸다)' });
  ok('안 고르면 원작대로 — 하인에게 돈을 건넨다 (파멸도 +15)', s.forcedChoice?.label === '원작대로 하인에게 약속한 돈을 건넨다' && s.state.vars.doom === doom0 + 15 && s.state.vars.cleared === 3,
    JSON.stringify({ f: s.forcedChoice?.label, d: s.state.vars.doom }));
  st = out(s.state).state;
  a = advance(st, 'night'); st = a.st;
  ok('→ 4장 · 과자 상자 서브 걷힘', st.vars.quests.includes(Q.night) && !st.vars.quests.includes(SUB_SWEETS) && SUBS.night.every((q) => st.vars.quests.includes(q)), JSON.stringify(st.vars.quests));
  st = turn(st, { on_stage: true }).st;
  ok('저녁 모임 → 4장 절정 · 칼', st.meta.pendingChoice?.id === 'night_rosetta' && send(st).promptBlock.includes('칼날이 번뜩인다'), '');
  st = turn(pickBy(st, '엘리시아의 손을 잡고 연회장으로 달린다')).st;
  a = advance(st, 'verdict'); st = a.st;
  ok('→ 5장 심판 · 체크포인트 = 5장 시작', st.vars.quests.includes(Q.verdict) && st.checkpoints.main.vars.scn_idx === 5, JSON.stringify(st.vars.quests));
  verdictState = cp(st);
}

console.log('\n━━ 5장 심판 — 잠긴 선택지 · 원작 결말 = 회귀 · 결말 → 원작 이후 ━━');
{
  let st = cp(verdictState);
  Object.assign(st.vars, { doom: 50, elicia: 65, rical: 10, ert: 10, duke: 5 });
  ok('파멸도 50 → [심판] (해명 아님)', send(st).promptBlock.includes('[심판] 로제타는') && !send(st).promptBlock.includes('[해명]'), '');
  st = turn(st, { on_stage: true }).st;
  ok('심판정 → 결말 갈림길', st.meta.pendingChoice?.id === 'verdict_rosetta', JSON.stringify(st.meta.pendingChoice));
  const html = SC.require('render').renderStatusHtml(S, st, null, null, { uid: 11 });
  const rows = (html.match(/<div class="sim-choice[^"]*">.*?<\/div>/g) || []);
  const locked = (label) => rows.some((r) => r.includes(label) && r.includes('🔒'));
  ok('★ 잠긴 선택지가 보인다: 리칼·황태자·공작·결백 🔒 · 엘리시아는 열림 · 로제타 시점엔 "대신 죄"가 없다',
    ['리칼이 증언대에', '황태자가 재심을', '공작이 가문의', '스스로 결백을'].every(locked) && !locked('엘리시아가 로제타를') && !html.includes('내가 대신 죄를'),
    rows.map((x) => x.replace(/<[^>]+>/g, '')).join(' | ').slice(0, 500));
  // 원작 결말 = 죽음 → 5장 시작으로 회귀
  const loop0 = st.vars.loop;
  const s = send(st, { userText: '(아무것도 안 고르고 보낸다)' });
  ok('★ 안 고르면 받아들인다 → 처형 → 5장 시작으로 회귀', s.forcedChoice?.label === '받아들인다' && s.state.vars.loop === loop0 + 1 && L(s.state, 'scn_act') === 'verdict'
    && s.state.vars.cleared === 4 && s.state.vars.ending === '' && s.promptBlock.includes('[회귀'), JSON.stringify({ f: s.forcedChoice?.label, loop: s.state.vars.loop, c: s.state.vars.cleared }));
  st = out(s.state).state;
  // 다시 — 이번엔 엘리시아가 감싼다
  st.vars.elicia = 65;
  st = turn(st, { on_stage: true }).st;
  ok('회귀한 판에서 심판이 다시 열린다', st.meta.pendingChoice?.id === 'verdict_rosetta', JSON.stringify(st.meta.pendingChoice));
  st = turn(pickBy(st, '엘리시아가 로제타를 감싼다')).st;
  ok('결말: 엘리시아의 변호 · 5장 결판', st.vars.ending === '엘리시아의 변호' && st.vars.cleared === 5, st.vars.ending);
  if (L(st, 'scn_act') !== 'after') st = turn(st).st;
  const pa = send(st).promptBlock;
  ok('★ 원작 이후 — 결말이 막 지시에 · 원작 지식은 끝', L(st, 'scn_act') === 'after' && pa.includes('결말: 엘리시아의 변호') && pa.includes('원작 지식은 여기서 끝난다'), L(st, 'scn_act'));
  const fr0 = st.vars.fr_canon;
  st = turn(st, { skip_day: 10 }).st;
  ok('원작 이후엔 원작의 흐름이 멈춘다 · 원작 보정력도 닫힌다', st.vars.fr_canon === fr0 && !SC.require('choice').liveOpen(S.liveChoices.find((c) => c.id === 'canon'), S, st.vars, engine.makeLookup), `${fr0} → ${st.vars.fr_canon}`);
  ok('상태창에 결말', SC.require('render').renderStatusHtml(S, st, null, null, { uid: 12 }).includes('엘리시아의 변호'), '');
}
{
  // 파멸도가 낮으면 해명의 자리 — 결백 선택지가 열린다
  let st = cp(verdictState);
  st.vars.doom = 25;
  ok('파멸도 25 → [해명]', send(st).promptBlock.includes('[해명]'), '');
  st = turn(st, { on_stage: true }).st;
  st = turn(pickBy(st, '스스로 결백을 밝힌다')).st;
  ok('해명 → 결말: 스스로 밝힌 결백', st.vars.ending === '스스로 밝힌 결백' && st.vars.cleared === 5, st.vars.ending);
}
{
  // 시종 시점 — "내가 대신 죄를 쓴다" (로제타 호감 70↑)
  let st = start('servant');
  Object.assign(st.vars, { hired: true, cleared: 4, scn_idx: 5, scn_turns: 0, rosetta: 75, doom: 60 });
  st = turn(st, { on_stage: true }).st;
  ok('시종 심판 갈림길', st.meta.pendingChoice?.id === 'verdict_servant', JSON.stringify(st.meta.pendingChoice));
  st = turn(pickBy(st, '내가 대신 죄를 쓴다')).st;
  ok('★ 대신 죄를 쓴다 → 추방 · 로제타 호감 +20', st.vars.ending === '대신 진 죄' && st.vars.role === '수도에서 추방된 몸' && st.vars.rosetta >= 95, JSON.stringify({ e: st.vars.ending, r: st.vars.role, ro: st.vars.rosetta }));
}

console.log('\n━━ 원작 보정력 — 파멸도가 부른다 ━━');
{
  const choiceMod = SC.require('choice');
  const canon = S.liveChoices.find((c) => c.id === 'canon');
  let st = start('rosetta');
  Object.assign(st.vars, { scn_idx: 2, doom: 30 });
  ok('파멸도 30 → 0% · 60 → 12% · 80 → 20%', choiceMod.liveChance(canon, S, st.vars, engine.makeLookup) === 0
    && Math.abs(choiceMod.liveChance(canon, S, { ...st.vars, doom: 60 }, engine.makeLookup) - 0.12) < 1e-9
    && Math.abs(choiceMod.liveChance(canon, S, { ...st.vars, doom: 80 }, engine.makeLookup) - 0.2) < 1e-9, '');
  st.vars.doom = 70;
  const probe = cp(st);
  choiceMod.rollAsk(S, probe, () => 0.05, engine.makeLookup);
  ok('추첨 순서: 원작 보정력이 능력치 선택지보다 먼저', probe.meta.liveAsk === 'canon', String(probe.meta.liveAsk));
  st.meta.liveAsk = 'canon';
  const qa = engine.buildAuxPrompt(S, st, '엘리시아가 넘어질 뻔하자 영애들이 로제타를 쳐다본다.', null, '');
  ok('보조 지시: 원작 보정력 — 이탈·타협·원작', qa.includes('[원작 보정력 — 선택지 쓰기]') && ['이탈', '타협', '원작'].every((x) => qa.includes(x)), '');
  const o = out(st, {}, { choices: { desc: '원작이 되돌리려 한다', items: [{ label: '비웃으며 지나친다', tag: '원작' }, { label: '손을 내민다', tag: '이탈' }, { label: '못 본 척한다', tag: '타협' }] } });
  const h = SC.require('render').renderStatusHtml(S, o.state, null, null, { uid: 13 });
  ok('상태창: 태그가 보이고, 안 고르면 타협', h.includes('>원작<') && h.includes("'타협' 항목으로"), (h.match(/'[^']+' 항목으로/g) || []).join(''));
  const f = send(o.state, { userText: '로제타는 잠시 멈춰 서서 엘리시아를 내려다본다.' });
  const f2 = out(f.state);
  ok('★ 직접 쓰면 타협 (파멸도 −1)', f2.state.vars.doom === 69 && !f2.state.meta.pendingChoice, JSON.stringify({ d: f2.state.vars.doom, p: f2.state.meta.pendingChoice?.id }));
}

if (fails) { console.log(`\n❗ ${fails}건 실패 — 저장하지 않는다`); process.exit(1); }
fs.writeFileSync(__P('조퇴악녀-스키마.json'), JSON.stringify(S, null, 2));
console.log(`\n저장: ${__P('조퇴악녀-스키마.json')}  (변수 ${S.vars.length} · 이벤트 ${S.rules.events.length} · 비밀 ${S.secrets.length} · 막 ${S.scenario.acts.length})`);
