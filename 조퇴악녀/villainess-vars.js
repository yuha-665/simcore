const __P = (...p) => require('path').resolve(__dirname, ...p);
// 조기퇴장 악녀에 빙의해버렸다 — 원작 탈출 사망회귀 시나리오 (docs/design-조퇴악녀.md)
//
// 원본 봇: 세계관 + 인물 사전 27명 + 원작 줄거리 요약 4막(상시 로어북, 기본 꺼짐). 숫자 상태 0개.
// 이 생성기가 그 위에 진행 장치를 얹는다 — 1차 범위 = **1부 서장 + 1장(데뷔탕트)**. 2장부터는 막을 뒤에 덧붙인다(세이브 안 깨짐).
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
  when: 'scn_act != "prologue"', rate: 2,
  stages: [
    { at: 15, hint: '하인들이 로제타가 지나가면 입을 다물고, 등 뒤에서 수군거린다.' },
    { at: 35, backstage: '로니카가 데뷔탕트를 앞두고 로제타의 첫 데뷔탕트 망신을 다시 퍼뜨리며, 돌아온 에버렛 영애와 나란히 비교하고 있다.' },
    { at: 50, surface: '사교계에 "카르디온의 악녀가 에버렛 영애의 데뷔탕트를 망치려 한다"는 소문이 퍼졌다.',
      effects: [{ set: 'doom', expr: 'doom + 10' }, { set: 'rep', expr: 'rep - 5' }] },
    { at: 80, hint: '로제타 앞으로 오던 다과회 초대장이 하나둘 끊기기 시작했다.' },
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
const Q_DEBUT = '[1장] 데뷔탕트를 무사히 넘긴다';
const Q_SUBS_1 = ['[서브] 서랍 속 작은 병의 정체', '[서브] 로니카의 도발을 받아넘긴다'];

// 데뷔탕트 — 제국력 472년 3월 10일 밤 황궁 대연회장 [초안: 날짜·장소]
const DEBUT_YMD = 4720310;

const doneTag = (t) => [{ set: 'iv_q', expr: 'iv_q + 1' }, { set: 'iv_asking', expr: 'false' }, ...(t ? [{ set: 'iv_score', expr: `iv_score + ${t}` }] : [])];
const gameOver = [{ set: 'loop', expr: 'loop + 1' }, { checkpoint: 'load' }];

// 1장 절정 — 시점마다 한 벌. 맨 끝 = 원작대로(안 고르면 그리로 흘러간다) [초안]
const debutClose = [{ set: 'cleared', expr: 'max(cleared, 1)' }, { set: 'on_stage', expr: 'false' }, { list: 'quests', remove: [Q_DEBUT] }];
const DEBUT_CHOICES = {
  rosetta: [
    { label: '엘리시아에게 먼저 다가가 데뷔를 축하한다', effects: [{ set: 'doom', expr: 'doom - 10' }, { set: 'elicia', expr: 'elicia + 15' }, { set: 'rep', expr: 'rep + 5' }, { front: 'canon', add: '-20' }],
      inject: '로제타가 원작과 달리 엘리시아에게 먼저 손을 내민다. 연회장의 시선이 술렁인다.' },
    { label: '질투가 치밀기 전에 무도회장을 빠져나온다', effects: [{ set: 'doom', expr: 'doom - 5' }, { set: 'rep', expr: 'rep - 3' }, { front: 'canon', add: '-10' }],
      inject: '로제타는 원작의 장면이 시작되기 전에 자리를 뜬다. 뒤에서 "도망쳤다"는 수군거림이 따라붙는다.' },
    { label: '황태자에게 대놓고 춤을 청한다', effects: [{ set: 'doom', expr: 'doom + 5' }, { set: 'ert', expr: 'ert + 5' }, { set: 'elicia', expr: 'elicia - 5' }],
      inject: '로제타가 엘리시아 앞에서 황태자에게 춤을 청한다. 원작과는 다르지만, 누군가에겐 선전포고로 보인다.' },
    { label: '치미는 질투를 그대로 쏟아낸다', effects: [{ set: 'doom', expr: 'doom + 15' }, { set: 'rep', expr: 'rep - 10' }, { set: 'elicia', expr: 'elicia - 10' }, { front: 'canon', add: '15' }],
      inject: '원작 그대로 — 로제타의 질투가 연회장 한가운데서 터진다.' },
  ],
  servant: [
    { label: '아가씨의 손을 잡고 발코니로 모신다', effects: [{ set: 'doom', expr: 'doom - 10' }, { set: 'rosetta', expr: 'rosetta + 10' }, { front: 'canon', add: '-20' }],
      inject: '시종이 질투가 터지기 직전의 로제타를 발코니로 데려간다. 원작의 장면이 비켜 간다.' },
    { label: '엘리시아 쪽 시녀에게 먼저 말을 걸어 두 사람을 잇는다', effects: [{ set: 'doom', expr: 'doom - 5' }, { set: 'elicia', expr: 'elicia + 10' }, { front: 'canon', add: '-10' }],
      inject: '시종이 엘리시아 곁의 시녀와 말을 트며, 두 영애가 부딪치기 전에 다른 판을 깐다.' },
    { label: '아가씨 대신 내가 욕을 먹는다', effects: [{ set: 'doom', expr: 'doom - 5' }, { set: 'rosetta', expr: 'rosetta + 5' }, { set: 'rep', expr: 'rep - 2' }],
      inject: '시종이 일부러 실수해 연회장의 시선을 자기에게로 돌린다. 로제타의 표정이 복잡해진다.' },
    { label: '지켜본다', effects: [{ set: 'doom', expr: 'doom + 15' }, { set: 'rep', expr: 'rep - 10' }, { front: 'canon', add: '15' }],
      inject: '원작 그대로 — 시종이 지켜보는 앞에서 로제타의 질투가 연회장 한가운데서 터진다.' },
  ],
  // 빙의자 로제타 [원본 모드 2 = Special, 유저 2026-09-25 "프리셋에 하나 넣자"] — 로제타 안의 빙의자도 이 장면을 안다. 그래도 원작이 떠민다
  special: [
    { label: '로제타의 손을 잡고 발코니로 이끈다', effects: [{ set: 'doom', expr: 'doom - 10' }, { set: 'rosetta', expr: 'rosetta + 10' }, { front: 'canon', add: '-20' }],
      inject: '유저가 흔들리는 로제타를 발코니로 데려간다. 로제타 안의 빙의자가 처음으로 누군가에게 기댄다.' },
    { label: '엘리시아에게 먼저 말을 걸어 두 사람을 잇는다', effects: [{ set: 'doom', expr: 'doom - 5' }, { set: 'elicia', expr: 'elicia + 10' }, { front: 'canon', add: '-10' }],
      inject: '유저가 엘리시아에게 먼저 다가가 로제타 쪽으로 대화를 이끈다. 두 영애가 부딪치기 전에 다른 판이 깔린다.' },
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

// ══════════ 스키마 ══════════
const S = {
  simcore: '0.1',
  meta: { name: '조기퇴장 악녀 — 원작 탈출', description: '로제타(또는 로제타의 시종)에 빙의해 원작의 처형 결말을 비튼다. 챕터·퀘스트·강제 선택지·사망 회귀.' },
  time: {
    start: '0472-03-01 08:00', advance: 'explicit', calendar: 'gregorian',
    format: { date: 'M월 D일', clock: 'HH:mm' },
    seasons: ['봄', '여름', '가을', '겨울'],
    expose: ['date', 'clock', 'year', 'month', 'dom', 'hour', 'minute', 'elapsed', 'season'],
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
    { id: 'on_stage', label: '무대에 도착', type: 'bool', init: false,
      desc: '지금 장의 무대에 유저가 도착하면 true — 1장: 엘리시아의 데뷔탕트 무도회장(황궁 대연회장). 무대의 사건은 시스템이 연다.' },
    { id: 'dead', label: '사망', type: 'bool', init: false,
      desc: '유저가 연기하는 인물이 서사 안에서 죽었을 때만 true. 시종·빙의자 로제타 시점이면 로제타가 죽었을 때도 true. 부상·기절은 아니다.' },
    { id: 'quests', label: '퀘스트', type: 'list', init: [Q_ROSETTA], maxItems: 8, itemMaxLength: 48,
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
    // 시스템 전용 — 보조 allow 밖
    { id: 'cleared', label: '결판난 장', type: 'int', init: 0, min: 0, max: 6 },
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
  rules: {
    events: [
      // 판의 첫 저장 — 서장의 체크포인트 (첫 막은 onEnter가 안 돈다)
      { id: 'cp_open', when: 'true', once: true, effects: [{ checkpoint: 'save' }] },
      // 게임오버 — 사실 기록(dead)·원작 확정(doom 100)·면접 탈락. 보조에게 "벗어났나"를 판단시키지 않는다 [설계 §12]
      { id: 'go_dead', when: 'dead', effects: gameOver, notify: '[게임오버] 죽음이 찾아왔다.' },
      { id: 'go_doom', when: 'doom >= 100', effects: gameOver, notify: '[게임오버] 원작의 결말이 굳었다 — 로제타는 처형대로 끌려간다.' },
      // 면접 — 질문을 부탁한다 (다음 응답에 로제타의 질문 → 그 뒤 보조가 답변지를 쓴다)
      { id: 'iv_ask', when: `pov == "servant" and scn_act == "prologue" and not hired and not iv_asking and iv_q < ${IV.questions}`,
        effects: [{ set: 'iv_asking', expr: 'true' }], liveChoices: true,
        notify: '[면접] 로제타가 다음 질문을 던질 차례다 — 이번 응답에서 로제타의 질문 하나를 대사로 분명히 써라. 질문으로 장면을 끝내고, 지원자의 대답은 쓰지 마라.' },
      { id: 'iv_pass', when: `pov == "servant" and scn_act == "prologue" and not hired and iv_q >= ${IV.questions} and iv_score >= ${IV.pass}`,
        effects: [{ set: 'hired', expr: 'true' }, { set: 'role', expr: '"로제타 전속 시종"' }, { set: 'rosetta', expr: 'rosetta + 10' }, { list: 'quests', remove: [Q_SERVANT] }],
        notify: '[면접 결과] 합격 — 로제타가 지원자를 전속 시종으로 들인다. 로제타답게, 칭찬 대신 조건을 붙여서.' },
      { id: 'iv_fail', when: `pov == "servant" and scn_act == "prologue" and not hired and iv_q >= ${IV.questions} and iv_score < ${IV.pass}`,
        effects: gameOver, notify: '[게임오버] 면접에서 떨어졌다 — 로제타 곁에 설 길이 닫혔고, 원작은 그대로 흘러간다.' },
      // 1장 절정 — 데뷔탕트 무도회. 무대 도착 · 그날 밤 · 또는 이 장에서 오래 머물면 원작이 찾아온다 [설계 §2 원작의 강제력]
      ...['rosetta', 'servant', 'special'].map((pov) => ({
        id: `debut_${pov}`, once: true, strict: 'last',
        when: `pov == "${pov}" and scn_act == "debut" and cleared < 1 and (on_stage or ymd >= ${DEBUT_YMD} or scn_turns >= 14)`,
        notify: DEBUT_NOTIFY[pov],
        choices: DEBUT_CHOICES[pov].map((c, i, arr) => ({ ...c, effects: [...c.effects, ...debutClose] })),
      })),
    ],
  },
  fronts: [CANON],
  secrets: SECRETS,
  checkpoint: {
    keep: ['loop', 'memories', 'skills'], // 영혼에 붙은 것은 남고, 몸·세상에 붙은 것(소지품·신분)은 되감긴다
    notify: '[회귀 {loop}회차] 눈을 뜨면 다시 그날이다 — {scn_label}이(가) 시작되던 그 시점. 세상과 사람들은 아무것도 기억하지 못하고, 유저만 이전 판을 기억한다. '
      + '되돌아온 그 장면에서 다시 시작하라. 유저가 기억하는 것: {memories}',
  },
  liveChoices: {
    label: '면접', icon: '📝',
    when: 'pov == "servant" and scn_act == "prologue" and not hired',
    chance: 0, count: [3, 3],
    tags: [
      { id: '정답', desc: '로제타의 속내(버려질까 두려움·쓸모를 증명하려는 조급함)를 꿰뚫되 동정하지 않는 답', effects: doneTag(2) },
      { id: '무난', desc: '흠잡을 데 없지만 로제타의 눈에 띄지 않는 모범 답안', effects: doneTag(1) },
      { id: '실언', desc: '로제타의 역린(무능·사생아 출신·분홍 머리)을 건드리거나 동정하는 답', effects: doneTag(0) },
    ],
    worst: '실언', strict: false, timeout: 3,
    guide: '방금 서사에서 로제타가 던진 면접 질문에 대한 지원자(유저)의 답변 후보를 쓴다. 답변은 지원자의 대사 한 줄로. '
      + '로제타는 오만하지만 버려질까 두려워하고, 동정을 가장 싫어하고, 쓸모를 증명하고 싶어 한다 — 이 성격을 근거로 세 답의 무게를 가려라. 세 답이 서로 뚜렷이 달라야 한다.',
    desc: '로제타의 질문에 뭐라고 답할까',
    showTags: false,
  },
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
    { id: 'minors', when: 'true',
      text: '[금지] 드미트리샤(17)와 엘시(16)는 미성년자다. 이 둘과의 관계는 우정·보호로만 그리고, 연애·성적 묘사는 어떤 경우에도 쓰지 않는다.' },
    { id: 'loop', when: 'loop >= 1',
      text: '[회귀 {loop}회차] 유저는 이미 한 번 이상 죽고 되돌아왔다. 이전 판을 기억하는 건 유저뿐이고, 세상과 다른 인물은 모든 걸 처음 겪는다. 유저가 기억하는 것: {memories}' },
    { id: 'after_debut', when: 'scn_act == "debut" and cleared >= 1',
      text: '[1장 이후] 데뷔탕트의 밤이 지나갔다. 원작 2장(다과회와 소문)은 아직 준비 중이다 — 무도회의 여파와 일상을 자유롭게 이어 가라.' },
  ],
  promptState: {
    template: '지금: 제국력 {year}년 {date} {clock} · {location}\n진행 중인 일: {quests}\n유저: {role} · 능력: {skills} · 소지품: {items}',
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
      ] },
      { tab: '나', label: '신상', items: [
        { var: 'role', label: '신분', showWhen: 'role != ""' },
        { var: 'loop', label: '회귀', showWhen: 'loop >= 1' },
      ] },
      { tab: '나', label: '가진 것', items: [
        { var: 'skills', label: '능력' },
        { var: 'items', label: '소지품' },
      ] },
      { tab: '나', label: '회귀의 기억', showWhen: 'count(memories) > 0', items: [{ var: 'memories', label: '기억' }] },
    ],
  },
  setup: {
    presets: [
      { id: 'rosetta', label: '💎 로제타 빙의 — 원작 악녀 본인으로', set: { pov: 'rosetta', quests: [Q_ROSETTA] }, startAt: '0472-03-01 08:00' },
      { id: 'servant', label: '🕊️ 로제타의 시종 빙의 — 면접부터', set: { pov: 'servant', quests: [Q_SERVANT], location: '카르디온 공작저 응접실', role: '전속 시종 지원자' }, startAt: '0472-02-24 09:00' },
      { id: 'special', label: '🌹 빙의자 로제타 — 로제타 곁의 누군가로', set: { pov: 'special', quests: [Q_SPECIAL], role: '', skills: [] }, startAt: '0472-03-01 08:00' },
    ],
    // 최초 설정은 프리셋이 정한 값(신분·능력)을 못 본다 — 보조 창구엔 스키마 init만 뜨고 값은 절대값으로 덮이니, 프리셋마다 다른 칸은 싣지 않는다
    ai: {
      enabled: true, vars: ['location', 'items', 'possessor'],
      guide: '소지품은 첫 장면에 실제로 나온 것만 — 안 나왔으면 values에 넣지 마라. '
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
  st.meta.pendingChoicePick = ['정답', '무난', '실언'].indexOf(tag);
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
  st = engine.setupPhase(S, st, { possessor: '서른 살 사회부 기자. 냉소적이고 말이 빠르다', skills: ['원작 지식'] }, {}).state;
  ok('최초 설정: 빙의자 설정만 받고 능력은 안 받는다 (프리셋 값 보호)', st.vars.possessor.startsWith('서른 살') && st.vars.skills.length === 0, JSON.stringify(st.vars.skills));
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
  ok('징후는 깔리고 시계·밑작업은 없다', p1.includes('하인들이 로제타가 지나가면') && !p1.includes('로니카가 데뷔탕트를') && !/fr_canon/.test(p1), '');
  ok('상태창에 원작의 흐름이 안 보인다', !/원작의 흐름|fr_canon/.test(SC.require('render').renderStatusHtml(S, st, t.o.changeLog)), '');
  debutState = cp(st);
  t = turn(st, { on_stage: true }); st = t.st;
  ok('무도회장 도착 → 절정 갈림길', st.meta.pendingChoice?.id === 'debut_rosetta', JSON.stringify(st.meta.pendingChoice));
  st.meta.pendingChoicePick = 0;
  const s = send(st);
  ok('엘리시아에게 손을 내민다: 파멸도 −10 · 엘리시아 +15 · 흐름 −20', s.state.vars.doom === 30 && s.state.vars.elicia === 45 && s.state.vars.fr_canon === 0,
    JSON.stringify({ d: s.state.vars.doom, e: s.state.vars.elicia, c: s.state.vars.fr_canon }));
  ok('1장 결판', s.state.vars.cleared === 1 && !s.state.vars.quests.includes(Q_DEBUT) && s.state.vars.on_stage === false, JSON.stringify(s.state.vars.quests));
  ok('선택이 그 턴 프롬프트에', s.promptBlock.includes('[선택] 엘리시아에게 먼저 다가가'), '');
  st = out(s.state).state;
  ok('1장 이후 안내', send(st).promptBlock.includes('[1장 이후]'), '');
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
  ok('50 → 표면화: 소문 통지 · 밑작업 공개 · 파멸도 +10 · 평판 −5', p.includes('카르디온의 악녀가 에버렛 영애의 데뷔탕트를') && p.includes('로니카가 데뷔탕트를 앞두고')
    && st.vars.doom === 50 && st.vars.rep === -45, JSON.stringify({ d: st.vars.doom, r: st.vars.rep }));
}

console.log('\n━━ 호감 — 낱말 게이트 ━━');
{
  const allow = engine.auxAllowList(S, '엘리시아가 웃었다.', start('rosetta'));
  const ids = allow.map((a) => a.id || a);
  ok('엘리시아가 나온 턴: 엘리시아 칸만 열림', ids.includes('elicia') && !ids.includes('rical') && !ids.includes('ert'), JSON.stringify(ids));
}

if (fails) { console.log(`\n❗ ${fails}건 실패 — 저장하지 않는다`); process.exit(1); }
fs.writeFileSync(__P('조퇴악녀-스키마.json'), JSON.stringify(S, null, 2));
console.log(`\n저장: ${__P('조퇴악녀-스키마.json')}  (변수 ${S.vars.length} · 이벤트 ${S.rules.events.length} · 비밀 ${S.secrets.length} · 막 ${S.scenario.acts.length})`);
