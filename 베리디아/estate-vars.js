const __P = (...p) => require('path').resolve(__dirname, ...p);
// 베리디아 — 변수 + 상태창만. 이벤트·액션 없음.
//
// 목적 한 줄: AI가 서술하면서 동시에 계산하다 내는 찐빠를 없앤다.
// 그래서 판단 기준은 딱 하나 — "이 값을 AI가 매 턴 머리로 굴려야 하나?"
//   굴려야 한다  → 시스템이 맡는다 (int + onTurn + 파생)
//   서사가 정한다 → AI가 맡는다 (updater.allow + 상한)
//
// 지금 스키마의 가장 큰 문제: 사기·보건·노동력·군사·보안이 전부 text다.
// "열악함"에서 "보통"으로 올릴지를 AI가 매 턴 판단한다 — 정확히 찐빠가 나는 지점이다.
// 숫자로 굴리고, 화면과 프롬프트에는 파생 변수가 만든 서술 척도를 내보낸다.
// 지금의 말투(절망/열악함/매우 취약)를 그대로 쓰면서 판단만 시스템이 가져온다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { diagnose } = SC.require('diagnose');
const engine = SC.require('engine');
const { renderStatusHtml } = SC.require('render');
const { seededRng } = SC.require('rng');

// 숫자 → 그 봇의 말투. 지금 쓰던 어휘를 그대로 가져왔다.
const scale = (id, steps) => steps.slice(0, -1).reduceRight(
  (acc, [n, w]) => `${id} >= ${n} ? ${JSON.stringify(w)} : (${acc})`, JSON.stringify(steps[steps.length - 1][1]));

const POLICY = [
  //             밭    건설  경비  탐사
  ['생존 우선', 0.60, 0.10, 0.20, 0.10],
  ['재건 우선', 0.35, 0.40, 0.20, 0.05],
  ['방비 우선', 0.35, 0.15, 0.45, 0.05],
  ['개척 우선', 0.35, 0.15, 0.20, 0.30],
];
const share = (col) => POLICY.slice(0, -1).reduceRight(
  (acc, p, i) => `labor_policy == ${JSON.stringify(p[0])} ? ${p[col]} : (${acc})`,
  String(POLICY[POLICY.length - 1][col]));

// ── 탐사 ──
// 무엇이 발견되는지는 시스템이 정하지 않는다. 계약과 같은 구조다 —
// 시스템은 '이번에 무엇이 나올 차례인가'만 말하고, 그게 구체적으로 뭔지는 서사가 짓고 목록에 얹는다.
// 표로 박아 두면 판마다 같은 것이 나오고, 20개를 다 쓰면 더 나올 게 없다. 개수만 정하면 둘 다 안 걸린다.
//
// 구역마다 다섯 자리. 그 다섯이 어떤 종류인지가 그 방향의 정체성이다 —
// 남쪽은 땅 자체가 자산이라 '지형'이 둘, 북쪽은 험해서 '위협'이 둘.
//   [방향키, 변수, 지역명, 눈에 보이는 것, [자리 종류 × 5]]
const EXPLORE = [
  ['북 산맥', 'exp_n', '칼날 능선', '가파른 맨바위와 녹지 않는 눈. 몬스터가 내려오는 길이다.',
    ['자원', '위협', '숨은 장소', '자원', '위협']],
  ['서 숲', 'exp_w', '속삭이는 숲', '빛이 바닥까지 닿지 않는 원시림.',
    ['자원', '자원', '숨은 장소', '위협', '지형']],
  ['남 평원', 'exp_s', '잿빛 평원', '지평선까지 굳은 잿빛 껍질. 평평한 것 하나는 확실하다.',
    ['지형', '자원', '지형', '숨은 장소', '위협']],
  ['동 강가', 'exp_e', '강가', '흙탕이 섞여 빠르게 흐르는 물. 배를 댈 자리는 없다.',
    ['지형', '자원', '자원', '위협', '숨은 장소']],
];
// 자리 종류가 뭘 뜻하는지 — 통지에 실려 서사에게 건네진다.
// 목록에 옮기는 건 보조 모델 몫이라 여기선 말하지 않는다. 여기는 "무엇을 지어낼 차례인가"만.
//   [무슨 일이 있었나, 무엇을 정해야 하나, 덧붙일 말]
const CAT = {
  '자원': ['캐거나 베거나 걷어 낼 것이 나왔다', '무엇이고 어디에 쓰는 것인지', ''],
  '지형': ['땅 자체가 쓸모인 자리를 찾았다', '고갯길인지 여울인지 바람 막힌 골짜기인지', ''],
  '숨은 장소': ['사람 손이 닿았던 자리가 나왔다', '누가 만들었고 왜 버려졌는지', ' 버려진 이유가 이 발견의 절반이다.'],
  '위협': ['거기 사는 것과 마주쳤다', '무엇이 몇이나 있는지', ' 위치를 알아낸 것이 이번 성과다 — 당장 쳐들어오지는 않는다.'],
};
// 랜덤 사건이 겹치지 않게 하는 공통 조건 — 이미 곤경 중이면 새 곤경은 안 온다.
const QUIET = 'disaster == "" and route == "없음"';

// ── 난이도 ──
// 프리셋은 변수 초기값만 바꾼다. chancePerTurn 같은 스키마 상수는 못 건드린다.
// 그래서 "나쁜 일이 얼마나 자주 오나"를 변수 하나(hardship)로 옮긴다.
//
// ⚠ 사건을 켜고 끄는 게 아니라 **문턱을 민다.** 노말에서도 역병은 온다 — 정말 앓아누웠을 때만 올 뿐이다.
//   켜고 끄면 노말은 300턴을 굴려도 그 사건을 한 번도 못 보고, 그건 쉬운 게 아니라 판이 좁은 것이다.
//
//   thr('health', '<=', 20, 60)  →  health <= 20 + hardship * 0.4
//     시련 0에서 20, 시련 100에서 60. 노말(35)은 34, 하드(85)는 54 —
//     같은 사건이 하드에선 세 배 넓은 창으로 들어온다.
const thr = (v, op, at0, at100) => {
  const k = +((at100 - at0) / 100).toFixed(4);
  return `${v} ${op} ${at0} ${k < 0 ? '-' : '+'} hardship * ${Math.abs(k)}`;
};

const SPOTS = EXPLORE[0][4].length;
const SPOT_TOTAL = EXPLORE.reduce((a, e) => a + e[4].length, 0);
// 방향 → 그 방향의 발견물 이름(미탐사/탐사중 포함)을 돌려주는 조회식
// 방향 하나의 현황 — 몇 곳 건졌고 지금 얼마나 훑었는지.
// 무엇을 찾았는지는 여기 안 적는다. 그건 이미 자원·시설 목록에 있고, 여러 개라 한 칸에 안 들어간다.
const foundExpr = (v, f, n) =>
  `${f} >= ${n} ? "다 훑음 (${n}곳)" : ((${f} == 0 ? "미탐사" : ${f} + "곳 발견")`
  + ` + (${v} >= 100 ? " · 정리 중" : (${v} > 0 ? " · 훑는 중 " + ${v} + "%" : "")))`;

// ── 연중행사 ──
// 판타지니 모든 달을 30일로 통일했다. 12달 × 30일 = 360일.
// 축일은 "며칠"보다 "이번 달에 뭐가 있나"가 중요하다 — 행사는 준비 기간이 서사를 만든다.
// [달, 일, 이름, 그날이 어떤 날인지]
// ── 이웃 영지 ──
// 로어북 [Heartland Geo-Matrix]에서 "변하는 것"만 떼어 왔다.
// 거리·이름·지형은 안 변하니 로어북이 계속 든다. 여기 있는 건 하나뿐 — 저쪽이 베리디아를 어떻게 보는가.
// 로어북은 그걸 'At the start, Neighboring Lords view Veridia as Non-existent'라고 적어 놨는데,
// 그 한 줄은 첫 턴이 지나는 순간부터 거짓말이 된다. 안 변하는 문서에 변하는 걸 적어 놨으니까.
// 거리는 파생 문자열에 박아 넣는다 — 매 턴 이름 옆에 붙어 나가니 AI가 '4일 거리'를 흘릴 수가 없다.
//   [변수, 방위, 이름, 거리, 초기값]
const NEIGH = [
  ['rel_n',   '북',   '모르웬 백작',   '5일',     0],
  ['rel_e',   '동',   '리아나 백작',   '강 4일·길 7일', 0],   // 로어북에 두 경로가 적혀 있다 — 한쪽만 실으면 어긋난다
  ['rel_s',   '남',   '발레리우스 백작', '3일',    0],
  ['rel_w',   '서',   '실바나 후작',   '6일',     0],
  ['rel_cap', '왕도', '알라릭 여왕',   '14일',   10],   // 세무서와 메이드 학원만, 그것도 서류상
];
const REL_STEPS = [[85, '동맹'], [65, '우호'], [45, '거래 상대'], [25, '관망'], [10, '이름만 앎'], [0, '미인지']];

// ── 인물 호감도 ──
// rel_*(영지)와 다른 축이다. 모르웬의 병사들이 베리디아를 인정해도 모르웬 본인은 남작을 싫어할 수 있다.
//   rel_*  그 영지가 이 땅을 어떻게 보는가 — 공적·행정적
//   b_*    그 사람이 남작을 어떻게 보는가 — 사적
// 배역이 로어북에 통째로 고정되어 있으니 목록이 아니라 변수로 둔다.
// 목록 항목의 숫자는 자주 변하는 값에 안 맞는다 — 바꾸려면 문자열을 글자까지 맞춰 지웠다 다시 넣어야 하니까.
// 0 = 아직 아무 사이도 아님. 음수 = 척졌음. 0인 사람은 프롬프트에도 상태창에도 안 뜬다.
//   [변수 꼬리, 이름, 초기값]
// 두 부류가 섞여 있고 성격이 전혀 다르다.
//   왕족·귀족 — 만나는 상대. 우호로 갈지 적대로 갈지는 플레이가 정한다. 등급 없음.
//   메이드·수녀 — 고용하는 풀. 전원 아카데미/대성당에 있고, 명성과 금화를 치러야 온다.
//     그래서 이쪽은 등급이 곧 값이자 문턱이다 (아래 TIER).
//   [변수 꼬리, 이름, 초기 호감, 등급]
const CAST = {
  '왕가와 동행': [
    ['adere', '아데레', 40, null], ['alaric', '알라릭 여왕', 0, null], ['cassandra', '카산드라', 0, null],
    ['orelia', '오렐리아', 0, null], ['liliana', '릴리아나', 0, null],
  ],
  '귀족': [
    ['eleonora', '엘레오노라', 0, null], ['silvana', '실바나', 0, null], ['valerius', '발레리우스', 0, null],
    ['liana', '리아나', 0, null], ['morwen', '모르웬', 0, null],
  ],
  // 신참 광휘회원은 원래 베리디아 같은 오지에 배정되어 신심을 증명한다 — 스텔라가 현실적인 첫 손이다.
  // 베아트릭스는 주교라 고용 대상이 아니다 — 등급을 안 주면 몸값 체계 밖에 선다.
  // 그래도 호감도는 있다. 지역 최고 권위자이자 왕가 정치 고문이라 만나는 상대이긴 하니까.
  '광휘회': [
    ['stella', '스텔라', 0, 'J'], ['celestia', '셀레스티아', 0, 'I'],
    ['lapis', '라피스', 0, 'S'], ['beatrix', '베아트릭스', 0, null],
  ],
  '메이드군단': [
    ['philia', '필리아', 0, 'J'], ['serie', '세리에', 0, 'J'],
    ['livia', '리비아', 0, 'I'], ['fiora', '피오라', 0, 'I'], ['meryl', '메릴', 0, 'I'],
    ['clarice', '클라리스', 0, 'S'], ['cassia', '카시아', 0, 'S'], ['lulu', '룰루', 0, 'S'], ['lara', '라라', 0, 'S'],
    ['yustina', '유스티나', 0, 'E'], ['algeria', '알제리아', 0, 'E'], ['lirica', '리리카', 0, 'E'],
  ],
};
// [등급키, 표시, 기본 몸값, 명성 문턱, 일 봉급]
// 명성이 문턱이고 금화가 값이다 — 로어북의 "depends on Reputation and the amount of Gold offered" 그대로.
//
// ⚠ 몸값은 문턱일 뿐이고 진짜 비용은 봉급이다. 유지비가 없으면 한 번 부자가 된 순간
//   열여섯을 전부 불러 놓고 게임이 닫힌다. 봉급이 있어야 "정예 하나(30) vs 중급 셋(24)"이 판단이 된다.
//   정예 하나가 한 해 10,800 — 몸값 8,000보다 무겁다. 그게 맞다.
const TIER = [
  ['J', '초급', 400, 0, 4], ['I', '중급', 1200, 25, 8],
  ['S', '상급', 3000, 50, 15], ['E', '정예', 8000, 75, 30],
];
const CAST_ALL = Object.values(CAST).flat();
const RANKNAME = Object.fromEntries(TIER.map(([k, label]) => [k, label]));
// 만난 사람만 이어 붙인다 — 스물여섯을 매 턴 다 내보내면 프롬프트가 인물표가 된다.
// 고용 대상은 이름 옆에 등급을 붙인다 — 값이 얼마인지 바로 읽히게.
const bondLine = (rows) => rows.map(([id, name, , rank]) =>
  `(b_${id} != 0 ? ${JSON.stringify(name + (rank ? `(${RANKNAME[rank]}) ` : ' '))} + b_${id} + " " : "")`).join(' + ');
// 명성이 낮으면 더 부른다. 명성 0에 1.3배, 50에 정가, 100에 0.7배.
// hire_mult는 난이도 손잡이다 — 나중에 프리셋에서 이 하나만 올리면 몸값도 봉급도 같이 오른다.
// 상수로 박아 두면 프리셋이 못 건드린다(프리셋은 변수 초기값만 바꾼다). 그래서 변수로 둔다.
const hireCost = (base) => `round(${base} * hire_mult * 0.01 * (1.3 - fame * 0.006))`;
const hireWage = (w) => `round(${w} * hire_mult * 0.01)`;

const FEST = [
  [1, 15, '한밤절', '한 해에서 밤이 가장 긴 무렵. 불을 끄지 않고 새운다. 이 밤에 화로가 꺼진 집은 한 해 내내 입에 오른다.'],
  [2, 5, '잿날', '겨울에 죽은 이를 태워 보내는 날. 언 땅에 묻지 못한 시신이 이날 한꺼번에 화장된다.'],
  [3, 10, '파종절', '첫 씨앗을 뿌리는 날. 영주가 첫 고랑을 파는 것이 관례다. 남작이 흙을 만지는 걸 사람들이 지켜본다.'],
  [4, 22, '강신제', '봄비를 부르는 날. 강물을 떠다 밭에 뿌린다. 비가 오면 길조, 안 오면 흉흉한 말이 돈다.'],
  [5, 15, '초록절', '겨우내 굶은 뒤 처음 푸른 것을 먹는 날. 나물 한 줌이라도 온 마을이 나눈다.'],
  [6, 8, '성 알드릭 축일', '변경을 지키다 죽은 기사 성인의 날. 무기를 손질하고 젊은 사내들이 겨룬다.'],
  [7, 20, '화톳날', '낮이 가장 긴 날. 밤새 언덕마다 불을 피운다. 불이 크면 그 영지가 산다는 말이 있다.'],
  [8, 12, '기우절', '가뭄이 드는 달, 비를 비는 날. 이날까지 비가 없으면 가을을 포기하는 이야기가 나온다.'],
  [9, 25, '수확제', '한 해 가장 큰 축일. 사흘간 일을 멈춘다. 곳간이 비어 있어도 사람들은 잔치를 기대한다.'],
  [10, 10, '세납일', '백작령에 세를 바치는 날. 축일이 아니라 두려운 날이다. 못 내면 문책이 오고, 그것이 다음 겨울을 정한다.'],
  [11, 1, '위령절', '죽은 자를 기리는 밤. 전쟁에서 죽은 이가 많은 땅이라 이 밤은 유난히 길다.'],
  [12, 28, '긴밤제', '한 해의 끝. 남은 것을 헤아리고 겨울을 셈한다. 이날 곳간을 열어 보이는 것이 관례다.'],
];
// 달을 넣으면 그 달 축일의 [일자 / 이름 / 설명]을 돌려주는 조회식.
const festAt = (monthExpr, col) => FEST.slice(0, -1).reduceRight(
  (acc, f) => `${monthExpr} == ${f[0]} ? ${JSON.stringify(f[col])} : (${acc})`,
  JSON.stringify(FEST[FEST.length - 1][col]));

// 부임일(day=0)이 1499년 3월 1일. 3월 1일 = 그 해의 60번째 날.
const BASE_YEAR = 1499;
const EPOCH = (3 - 1) * 30 + (1 - 1);

const S = {
  simcore: '0.1',
  meta: { name: '베리디아 남작령' },
  vars: [
    // ── 시간·환경 ──
    // 날짜와 계절은 이제 AI가 아니라 day가 정한다(아래 derived).
    // AI가 손댈 수 없으니 "지난주가 4월이었는데 이번 주가 3월"인 사고가 원천봉쇄된다.
    // 시간을 건너뛰는 건 RP에서 당연한 일이다("다음 날 아침", "그로부터 사흘 뒤").
    // 그런데 시스템이 한 턴을 하루로만 세면 서사는 사흘이 지났는데 곳간은 하루치만 준다.
    // AI가 며칠이 지났는지 적어 주면 다음 정산이 그만큼 몰아서 이뤄진다.
    // ⚠ init이 0인 것은 실수가 아니다. 보조 AI가 내는 숫자는 절대값이 아니라 증감값으로 붙는다
    //   (엔진이 from + delta로 적용한다). init을 1로 두면 AI가 "사흘"이라고 3을 써도 1+3=4일이 된다.
    //   0에서 출발해야 AI가 쓴 숫자가 그대로 날수가 되고, 아무 말 안 한 턴은 0 → 아래 span이 1로 받는다.
    { id: 'days_passed', label: '이번에 흐른 날', type: 'int', init: 0, min: 0, max: 14,
      desc: 'Days elapsed this response, if more than one. "Three days later" = 3, "next week" = 7. '
        + 'Leave it alone for a single day. Date and season advance by this on their own.' },
    // 시각·날씨는 종류가 유한하다 → text로 두면 AI가 매번 다른 표기를 만든다. enum이면 못 벗어난다.
    { id: 'time', label: '시각', type: 'enum', init: '🕗아침',
      enum: ['🌅새벽', '🕗아침', '🕛낮', '🕗저녁', '🌙밤'] },
    { id: 'weather', label: '날씨', type: 'enum', init: '☀️맑음',
      enum: ['☀️맑음', '⛅흐림', '🌧비', '⛈폭풍우', '❄️눈', '🌫안개', '🔥폭염', '🥶한파'] },
    { id: 'location', label: '위치', type: 'text', init: '베리디아 성채', maxLength: 24 },
    // 재해는 종류가 무한하니 이름은 text로 두되, "며칠 남았나"는 시스템이 센다.
    // 이 쌍이 있어야 재해가 저절로 끝나고, 진행 중일 때 새 재해가 겹치는 걸 막을 수 있다.
    { id: 'disaster', label: '진행 중인 재해', type: 'text', init: '', maxLength: 40,
      desc: 'Name of the disaster currently underway; empty string if none. Start a new one only when disaster_days is 0.' },
    { id: 'disaster_days', label: '재해 잔여', type: 'int', init: 0, min: 0, max: 30,
      desc: 'How many more days the disaster runs. The system counts it down and clears it at 0. Set it only at the start.' },
    { id: 'day', label: '경과일', type: 'int', init: 0, min: 0,
      desc: '부임 후 며칠째인지. 날짜·계절·축일이 전부 여기서 계산된다. 시스템이 센다. 손대지 말 것.' },

    // ── 달력에 적어 두는 예정 하나 ──
    // "사흘 뒤 백작의 사자가 온다"를 AI가 기억하고 있을 거라 기대하면 안 된다.
    // 적어 두면 시스템이 세어 주고, 그날이 지나면 저절로 지워진다.
    { id: 'appt', label: '예정', type: 'text', init: '', maxLength: 60,
      desc: 'One thing set to happen. e.g. "Count\'s envoy arrives". The system deletes it once the day has passed.' },
    { id: 'appt_in', label: '예정까지', type: 'int', init: 0, min: -1, max: 60,
      desc: 'How many days off appt is. Tomorrow = 1, three days = 3. Do not log something happening today — just narrate it. '
        + 'The system counts down; 0 is the day.' },

    // ── 인구·민생: 시스템이 굴린다 ──
    { id: 'pop', label: '주민', type: 'int', init: 110, min: 0, format: '{v}명' },
    { id: 'health', label: '보건', type: 'int', init: 20, min: 0, max: 100 },
    { id: 'morale', label: '사기', type: 'int', init: 25, min: 0, max: 100 },
    { id: 'labor_policy', label: '노동 배분', type: 'enum', enum: POLICY.map((p) => p[0]), init: '생존 우선' },

    // ── 자원: 시스템이 소비·산출을 굴리고, 거래·사고는 AI가 상한 안에서 ──
    { id: 'food', label: '식량', type: 'int', init: 1200, min: 0,
      desc: 'Unit is person-days; one resident eats 1 per day. The system settles this every turn — do not deduct it yourself.' },
    { id: 'water', label: '식수', type: 'int', init: 500, min: 0, desc: 'Unit is person-days.' },
    { id: 'gold', label: '재정', type: 'int', init: 0, min: 0, format: '{v}G', cmd: '금' },
    // ── 지속 수입원 등록부 ──
    // 어떤 계약을 맺을지는 미리 알 수 없다. 그래서 스키마에 적어 두는 대신 목록을 열어 둔다.
    // AI는 계약이 성사된 그 턴에 한 줄 추가하기만 하면 되고, 매일 더하는 건 시스템이 한다.
    // 파기되면 remove로 빼면 그만 — 사용자도 SimCore 패널에서 ✕로 지울 수 있다.
    { id: 'contracts', label: '지속 수입', type: 'list', init: [], maxItems: 8, itemMaxLength: 48, cmd: '계약',
      desc: 'What comes in or goes out every day: trade deals, market dues, infrastructure revenue, levies. '
        + 'The per-day number MUST come last — "헤세 상단 양모 계약 +12", "제분소 5", "성벽 보수 부담 -4". '
        + 'For a fixed term add "@+days" (a year is 360 days), e.g. a 3-year deal is "@+1080" — the system dates it. '
        + 'No @ means indefinite. No trailing number counts as 0. Never add an entry already listed.' },
    // 계약과 짝을 이루는 목록. 계약은 금화가 오가는 것, 이쪽은 물건이 들어오는 것.
    // 값은 시스템이 매기니 계약에 따로 음수를 적으면 이중 청구가 된다.
    { id: 'supply', label: '수입', type: 'list', init: [], maxItems: 6, itemMaxLength: 32, cmd: '수입',
      desc: 'Standing deliveries of goods coming IN, paid for automatically out of the treasury. '
        + 'Every entry MUST begin with 식량 or 식수 and end with the amount arriving per day — '
        + '"식량 헤세 상단 밀 40", "식수 강물 수레 25". Nothing else belongs here: a one-off purchase '
        + 'moves food or gold directly, and money owed with no goods attached is a contract. '
        + 'Never write the cost — the system prices it. Remove the line when the arrangement ends.' },
    { id: 'stock', label: '보유 물자', type: 'list', init: ['목재 100'], maxItems: 10, cmd: '물자',
      desc: 'Things stacked in store, with how much. Not places — places go in the lists below.' },

    // ── 지은 것 ──
    // 하나로 뭉쳐 두면 AI가 매 턴 "이게 밭인가 건물인가"를 다시 판단한다. 쓰는 순간 갈라 두면 그 일이 없어진다.
    // 갈라 두면 목록마다 숫자를 하나씩 물릴 수 있는 게 더 크다 — 계약이 sum()으로 수입을 내듯,
    // 여기서도 목록이 곧 수치가 된다. 서사에 지은 것과 상태창 숫자가 어긋날 방법이 없어진다.
    //   갈림길은 하나로 고정한다: **먹을 게 나오면 경작지, 팔 게 나오면 자원지, 나머지는 인프라.**
    { id: 'houses', label: '주거', type: 'list', init: ['남은 오두막 90', '성채 헛간 30'],
      maxItems: 8, itemMaxLength: 32, cmd: '주거',
      desc: 'Where people sleep. The number MUST come last and is how many it houses — "장옥 60", "흙집 12". '
        + 'Their sum is the hard ceiling on population: nobody new settles once it is reached.' },
    { id: 'infra', label: '인프라', type: 'list',
      init: ['무너진 병영', '잡초 연병장', '폐허 대장간', '오염된 우물'],
      maxItems: 14, itemMaxLength: 24, cmd: '인프라',
      desc: 'What keeps the holding running — water works, baths, chapel, forge, walls, roads, storage. '
        + 'Name only, no number. Wells and channels belong here; when one is finished raise wells too.' },
    { id: 'farms', label: '경작지', type: 'list', init: ['묵은 밭 4'],
      maxItems: 8, itemMaxLength: 28, cmd: '경작지',
      desc: 'Ground that FEEDS people — fields, orchards, pasture, fishing waters, mushroom caves. '
        + 'The number MUST come last: how much it adds to farmland quality (a cleared plot ~1, a whole '
        + 'reclaimed valley ~4). Their sum drives the harvest, so never write one without a number.' },
    { id: 'sites', label: '자원지', type: 'list', init: [],
      maxItems: 8, itemMaxLength: 28, cmd: '자원지',
      desc: 'Places that yield goods to SELL — mines, quarries, salt flats, clay beds, silk groves. '
        + 'The number MUST come last: gold per day once it is actually being worked, 0 while it is only known about. '
        + 'Their sum is added to daily income.' },
    // ── 길 ──
    // 무역로를 목록으로 두면 "길이 있다"만 적히고 정작 중요한 "지금 막혔나"가 안 잡힌다.
    // 길은 상태가 아니라 사건이다 — 얼고, 무너지고, 도적이 앉고, 다시 뚫린다.
    // disaster와 따로 두는 이유: 역병이 도는 중에 강이 얼 수 있다. 둘은 같은 축이 아니다.
    { id: 'route', label: '막힌 길', type: 'enum', init: '없음',
      enum: ['없음', '북 산길', '동 강길', '남 가도', '서 숲길'],
      desc: 'Which road is impassable right now. Set it back to "없음" the moment the narration says it is cleared '
        + '— soldiers driving off the bandits, a thaw, a bridge rebuilt. It does not have to run its full term.' },
    { id: 'route_days', label: '통행 재개까지', type: 'int', init: 0, min: 0, max: 120,
      desc: 'Days the closure is expected to last. The system counts it down and reopens the road at zero.' },

    // 밭이 상한 정도. arable이 목록의 합이 된 뒤로 재해가 농지를 때릴 방법이 없어졌다 —
    // 목록에서 항목을 빼려면 문자열을 글자까지 맞춰야 하니 이벤트가 못 한다. 그래서 감산 변수를 둔다.
    // 하루 1씩 저절로 아문다. 밭 자체는 그대로 있고 그 해 소출만 죽는 것이다.
    { id: 'blight', label: '농지 피해', type: 'int', init: 0, min: 0, max: 8 },
    { id: 'wells', label: '식수원', type: 'int', init: 0, min: 0, max: 5,
      desc: 'How many usable wells and channels stand. At 0, water must be hauled from the river. '
        + 'Raise it only together with a matching entry in infra.' },

    // ── 탐사 ──
    // 지형 자체(북=산, 서=숲, 남=평원, 동=강)는 영지 중앙에서 눈으로 보인다. 그건 고정이다.
    // 변주되는 것은 그 안에서 "무엇이 나오느냐"다. 그래야 매 판 같은 전개가 안 된다.
    //
    // ⚠ 진척도 변수 하나가 세 가지 일을 겸한다.
    //     0~99    한 번 훑는 중 (척후가 쌓는 값)
    //     100     발견 직전 (다음 정산에서 굴림)
    //     110~114 이번에 나온 결과. 이벤트가 이 값을 보고 딱 한 턴 터진 뒤 0으로 돌아간다.
    //   한 방향을 계속 파도 된다 — 백작령만 한 땅이라 한 번 훑고 끝날 리가 없다.
    //
    // ⚠ 매 회차 새로 굴리면 이미 나온 게 또 걸려서 그 회차가 통째로 빈손이 된다.
    //   실측: 넷째 발견 중앙값 195턴, 다섯째 330턴 — 뒤로 갈수록 못 견디게 늘어졌다.
    //   그래서 굴림은 **첫 회차 한 번뿐**이다(o_*). 그게 그 방향의 시작점이 되고,
    //   나머지는 남은 것을 차례로 채운다. 회차가 헛돌지 않고, 판마다 순서는 여전히 다르다.
    //     o=2 → 2, 0, 1, 3, 4   (대표가 두 번째로 나온다)
    //     o=0 → 0, 1, 2, 3, 4   (33% 확률로 대표부터)
    { id: 'explore_dir', label: '탐사 방향', type: 'enum', cmd: '탐사',
      enum: ['없음', '북 산맥', '서 숲', '남 평원', '동 강가'], init: '없음',
      desc: 'Where the scouts are currently working. Set it when the narration sends them somewhere; '
        + '"없음" means they are kept home.' },
    ...EXPLORE.map(([dir, v]) => ({
      id: v, label: `${dir.slice(0, 1)} 탐사`, type: 'int', init: 0, min: 0, max: 109 + SPOTS,
    })),
    // 방향별 누적 발견 수. 이게 있어야 "몇 곳 건졌나"가 보이고, 다 훑은 방향을 알 수 있다.
    ...EXPLORE.map(([dir, v]) => ({
      id: `f_${v.slice(4)}`, label: `${dir.slice(0, 1)} 발견`, type: 'int', init: 0, min: 0, max: SPOTS,
    })),
    // 그 방향의 시작점. -1 = 아직 안 굴림. 첫 회차에 한 번 정해지고 그 뒤로 안 변한다.
    ...EXPLORE.map(([dir, v]) => ({
      id: `o_${v.slice(4)}`, label: `${dir.slice(0, 1)} 시작점`, type: 'int', init: -1, min: -1, max: SPOTS - 1,
    })),

    // ── 안전 ──
    { id: 'army', label: '상비군', type: 'int', init: 0, min: 0, format: '{v}명' },
    { id: 'unrest', label: '내부 불안', type: 'int', init: 15, min: 0, max: 100 },
    { id: 'threat', label: '외부 위협', type: 'int', init: 40, min: 0, max: 100 },
    { id: 'fame', label: '명성', type: 'int', init: 0, min: 0, max: 100,
      desc: 'Standing among the folk of Veridia itself. What other domains think is rel_* — do not move both for the same event.' },

    // ── 바깥 ──
    // 이 봇의 진짜 진행도다. 폐허를 일으키는 것보다 "아무도 모르는 땅"에서 벗어나는 쪽이 어렵다.
    // 다섯을 따로 두는 이유: 부두를 지으면 강 아래 리아나가 먼저 알고, 세납을 못 내면 왕도만 떨어진다.
    // 하나로 묶으면 그 구분이 사라진다.
    ...NEIGH.map(([id, dir, name, , init]) => ({
      id, label: `${dir} ${name}`, type: 'int', init, min: 0, max: 100,
    })),

    // ── 동행자 ──
    // 캐릭터 시트는 로어북에 있다. 스키마가 들고 있어야 할 것은 로어북이 못 담는 것뿐 —
    // "지금 곁에 있나", "관계가 어떤가". 외모·성격을 여기 또 적으면 두 벌이 어긋나기 시작한다.
    // 이름을 정식 표기로 쓰는 것이 중요하다: 상태창·프롬프트에 실린 이름이 로어북 키워드를 때린다.
    { id: 'ally', label: '동행', type: 'text', init: '아데레', maxLength: 16,
      desc: 'The one who came along from the exile road. Change only if they leave or are replaced.' },
    { id: 'ally_role', label: '직임', type: 'text', init: '책사', maxLength: 12,
      desc: 'The post the companion holds here. e.g. 책사(advisor), 집사(steward), 호위(guard).' },
    // 유대는 로어북이 못 담는 유일한 것 — 매 턴 변하니까. 그래서 시스템이 든다.
    // 동행의 유대는 이제 따로 두지 않는다. 아래 배역표에서 그 사람 것을 끌어다 쓴다(파생 ally_bond).
    // 동행이 바뀌어도 원래 사람의 호감도가 남아 있어야 하니까.
    ...CAST_ALL.map(([id, name, init]) => ({
      id: `b_${id}`, label: name, type: 'int', init, min: -50, max: 100,
    })),
    // ── 난이도 손잡이 둘 ──
    // 둘 다 AI 관할에 안 넣는다. 시세도 시련도 서사가 흔들 값이 아니다.
    // 100 = 기준. 프리셋에서 이 하나만 올리면 몸값도 봉급도 함께 오른다.
    { id: 'hire_mult', label: '고용 시세', type: 'int', init: 100, min: 40, max: 400, format: '{v}%' },
    // 나쁜 일의 문턱을 미는 값. 높을수록 조금만 삐끗해도 사건이 들어온다(위 thr 참고).
    // 좋은 일은 반대로 문턱이 올라간다 — 아무도 모르는 땅에는 행운도 안 굴러온다.
    { id: 'hardship', label: '시련', type: 'int', init: 55, min: 0, max: 100, format: '{v}' },

    // ── 왕위 계승 ──
    // 원래 '왕궁 시종' 판으로 따로 만들려던 것을 남작의 자리에서 다시 짰다.
    // 시종이 아니라 지지자다 — 궁정은 내가 가는 곳이 아니라 나를 찾아오는 것이라,
    // mode 전환이 필요 없고 영지 루프도 안 끊긴다.
    //
    // 세 왕녀의 '평가'는 새로 안 만든다. 배역표의 b_cassandra / b_orelia / b_liliana가 이미 그거다.
    // 여기 있는 건 판세뿐 — 저들끼리의 세력 다툼.
    { id: 'pw_cass', label: '카산드라 세력', type: 'int', init: 52, min: 5, max: 100 },
    { id: 'pw_orel', label: '오렐리아 세력', type: 'int', init: 46, min: 5, max: 100 },
    { id: 'pw_lili', label: '릴리아나 세력', type: 'int', init: 41, min: 5, max: 100 },
    // ⚠ 선두를 파생으로 읽으면 안 된다. 파생은 값 하나가 바뀔 때마다 다시 계산되므로
    //   카산드라를 깎은 직후 선두가 오렐리아로 넘어가 오렐리아까지 연달아 깎인다.
    //   이번 턴의 선두를 변수에 박아 두고 세 줄이 같은 기준을 보게 한다.
    //
    // ⚠⚠ 그리고 숫자가 아니라 **이름**이어야 한다. 처음엔 선두 값(int)을 박고 `>= lead_pw`로 비교했는데,
    //   동률이면 둘이 같이 깎여서 합이 샌다. 셋이 수렴할수록 동률이 잦아지니 결국 셋 다 바닥으로
    //   흘러내렸다(실측 139 → 15). 이름으로 박으면 어느 턴에도 깎이는 건 정확히 하나다.
    { id: 'lead_who', label: '(내부) 이번 턴 선두', type: 'text', init: '카산드라', maxLength: 8 },
    { id: 'stance', label: '지지', type: 'enum', cmd: '지지',
      enum: ['중립', '카산드라', '오렐리아', '릴리아나'], init: '중립',
      desc: 'Which claimant the Baron backs. Change it only when the narration shows him actually committing — '
        + 'a letter sent, a word given before witnesses, levies promised. Wondering aloud is not backing.' },
    { id: 'exposed', label: '드러난 정도', type: 'int', init: 0, min: 0, max: 100,
      desc: 'How widely known his allegiance is. The system moves it; leave it alone unless the narration '
        + 'shows it deliberately announced or deliberately buried.' },
    // 명단 인물과 현지인을 갈라 둔다. 한 목록에 두 형식을 섞으면 AI가 매 턴 "얘는 어느 쪽이지"를
    // 다시 판단하고, 그때마다 표기가 흔들린다 — 경작지·자원지·인프라를 쪼갠 것과 같은 이유다.
    // 그리고 갈라야 봉급을 sum()으로 셀 수 있다. 계약에 섞으면 길이 막혔을 때 인건비까지 깎인다.
    { id: 'corps', label: '군단·수녀', type: 'list', init: [], maxItems: 16, itemMaxLength: 24, cmd: '군단',
      desc: 'Maids and sisters actually serving here, hired from the roster. Format is ONLY "Name wage" with the '
        + 'daily wage last — "리비아 8", "스텔라 4". No role, no description. Their sum is paid out of the treasury '
        + 'every day, so an entry without a number is a free servant and that is wrong.' },
    // 현지인. 이름과 직임만 — 설명은 쓰지 마라, 로어북에 있다.
    { id: 'staff', label: '현지 고용인', type: 'list', init: [], maxItems: 12, itemMaxLength: 30, cmd: '고용',
      desc: 'Local people taken on at the holding — never a maid or a sister, they go in corps. '
        + 'Format is ONLY "Name · role" — "요한 · 목수", "톰 · 마구간지기". No individual wage: their keep is '
        + 'already counted in the daily upkeep. Spell the name exactly as the narration spells it. Do not list passers-by.' },
    // 로어북이 못 하는 유일한 것 — "만났다"는 사실. 설정은 미리 쓸 수 있어도 만남은 플레이가 만든다.
    // 여기 적는 건 명단이지 인물집이 아니다. 생김새·성격을 적기 시작하면 로어북과 두 벌이 되어 어긋난다.
    { id: 'contacts', label: '아는 사람 · 조직', type: 'list', init: [], maxItems: 10, itemMaxLength: 32, cmd: '인맥',
      desc: 'Everyone met OUTSIDE the holding — merchants, envoys, orders, houses, other domains. '
        + 'Format is ONLY "Name · one clause": "헤세 상단 · 곡물", "케빈 상단장 · 강 무역". '
        + 'Never describe appearance or history — the lorebook holds that. Spell names exactly as the narration does; '
        + 'reuse the existing entry rather than adding a second spelling of the same party. '
        + 'Add on first real dealing, not on a name being mentioned. Remove when the tie is broken.' },
    { id: 'focus', label: '집중 목표', type: 'text', init: '사람들을 굶기지 않는 것', maxLength: 60 },
    { id: 'alert', label: '긴급 통지', type: 'text', init: '', maxLength: 120 },
  ],

  derived: [
    // 이번 턴이 며칠어치인가. AI가 아무 말 안 했으면(0) 하루로 친다.
    { id: 'span', label: '흐른 날', expr: 'max(1, days_passed)' },

    // ── 달력: day 하나에서 전부 나온다 ──
    // 12달 × 30일 = 360일. 판타지니 윤달도 28일도 없다 — 대신 AI가 날짜를 절대 못 흘린다.
    { id: 'yday', label: '연중일', expr: `(day + ${EPOCH}) % 360` },
    { id: 'year', label: '연도', expr: `${BASE_YEAR} + floor((day + ${EPOCH}) / 360)` },
    { id: 'month', label: '월', expr: 'floor(yday / 30) + 1' },
    { id: 'dom', label: '일', expr: 'yday % 30 + 1' },
    { id: 'date', label: '날짜', expr: 'year + "년 " + month + "월 " + dom + "일"' },
    // 계절도 달력이 정한다. 이제 계절과 날짜가 어긋날 수가 없다.
    { id: 'season', label: '계절',
      expr: 'month >= 12 or month <= 2 ? "⛄겨울" : (month <= 5 ? "🍀봄" : (month <= 8 ? "🌻여름" : "🍂가을"))' },

    // ── 다음 축일 ──
    // 이번 달 축일이 아직 안 지났으면 그것, 지났으면 다음 달 것.
    { id: 'nmonth', label: '다음 달', expr: 'month % 12 + 1' },
    { id: 'fest_md', label: '이달 축일일', expr: festAt('month', 1) },
    { id: 'fest_nmd', label: '다음달 축일일', expr: festAt('nmonth', 1) },
    { id: 'fest_month', label: '축일 달', expr: 'fest_md >= dom ? month : nmonth' },
    { id: 'fest_dom', label: '축일 날짜', expr: 'fest_md >= dom ? fest_md : fest_nmd' },
    { id: 'fest_in', label: '축일까지', expr: 'fest_md >= dom ? fest_md - dom : 30 - dom + fest_nmd' },
    { id: 'fest', label: '다음 축일', expr: festAt('fest_month', 2) },
    { id: 'fest_desc', label: '축일 설명', expr: festAt('fest_month', 3) },
    { id: 'fest_when', label: '축일 일자', expr: 'fest_month + "월 " + fest_dom + "일"' },
    // ── 탐사 현황 ──
    ...EXPLORE.map(([, v, label, , slots]) => ({
      id: 'found_' + v.slice(4), label, expr: foundExpr(v, `f_${v.slice(4)}`, slots.length),
    })),
    // 영지를 얼마나 알아냈나. 백작령만 한 땅이라 다 채우는 건 긴 이야기가 된다.
    // format은 자리표시자 치환에 안 먹는다 — 프롬프트·상태창 둘 다 template이라 문자열로 만들어 둔다.
    { id: 'finds', label: '발견 총계', expr: EXPLORE.map(([, v]) => `f_${v.slice(4)}`).join(' + ') },
    { id: 'survey', label: '영토 파악', expr: `round(finds * 100 / ${SPOT_TOTAL}) + "%"` },
    { id: 'scouting', label: '탐사 진척',
      expr: EXPLORE.reduceRight(
        (acc, [dir, v]) => `explore_dir == ${JSON.stringify(dir)}`
          + ` ? (f_${v.slice(4)} >= ${SPOTS} ? "훑을 만큼 훑은 곳" : (${v} >= 100 ? "정리 중" : ${v} + "%"))`
          + ` : (${acc})`,
        '"보내지 않음"') },

    // 지금 곁에 있는 사람의 호감도를 배역표에서 끌어온다. 이름이 배역에 없으면(고용인 등) 0.
    { id: 'ally_bond', label: '유대',
      expr: CAST_ALL.reduceRight((acc, [id, name]) =>
        `ally == ${JSON.stringify(name)} ? b_${id} : (${acc})`, '0') },
    { id: 'bond_txt', label: '유대',
      expr: scale('ally_bond', [[80, '한 몸처럼'], [60, '믿는다'], [40, '데면데면'], [20, '서먹함'], [1, '남남'], [-9999, '척졌다']]) },

    // ── 배역 호감도 ──
    // 0인 사람은 아예 안 나온다. 스물여섯을 매 턴 다 실으면 프롬프트가 인물표가 된다.
    ...Object.entries(CAST).flatMap(([group, rows], i) => {
      const key = `bond${i}`;
      return [
        { id: `${key}_raw`, expr: bondLine(rows) },
        { id: key, label: group, expr: `${key}_raw == "" ? "—" : ${key}_raw` },
      ];
    }),
    // format은 자리표시자 치환에 안 먹는다 — 문자열로 만들어 둔다
    // ── 계승 판세 ──
    ...[['cass', '카산드라'], ['orel', '오렐리아'], ['lili', '릴리아나']].map(([k]) => ({
      id: `pw_${k}_txt`,
      expr: scale(`pw_${k}`, [[80, '압도적'], [62, '우세'], [45, '대등'], [28, '열세'], [0, '미미']]),
    })),
    { id: 'frontrunner', label: '선두',
      expr: 'pw_cass >= pw_orel and pw_cass >= pw_lili ? "카산드라"'
        + ' : (pw_orel >= pw_lili ? "오렐리아" : "릴리아나")' },
    // ── 내 지지의 무게 ──
    // 이 봇에서 명성과 군사가 영지 밖에서 값을 하는 첫 자리다.
    // 폐허 남작의 지지는 아무도 안 찾지만(시작값 2), 주민 400에 상비군을 세운 남작이
    // 어느 편에 서느냐는 판세를 흔든다. 두 판을 한 봇으로 묶는 이유가 이 한 줄이다.
    { id: 'my_weight', label: '내 지지의 무게',
      expr: 'min(100, round(fame * 0.45 + min(army, 120) * 0.25 + min(gold, 3000) * 0.006 + rel_cap * 0.15))' },
    { id: 'weight_txt', label: '조정에서의 무게',
      expr: scale('my_weight', [[70, '판을 흔든다'], [45, '셈에 들어간다'], [22, '이름은 나온다'], [8, '변방 하나'], [0, '아무도 안 찾는다']]) },
    { id: 'exposed_txt', label: '알려진 정도',
      expr: 'stance == "중립" ? (exposed >= 40 ? "줄을 안 선다는 것 자체가 알려졌다" : "눈에 안 띈다")'
        + ' : ' + scale('exposed', [[75, '공공연하다'], [45, '소문이 돈다'], [20, '눈치챈 자가 있다'], [0, '아직 조용하다']]) },
    { id: 'court_txt', label: '계승 판세',
      expr: '"카산드라 " + pw_cass_txt + " · 오렐리아 " + pw_orel_txt + " · 릴리아나 " + pw_lili_txt'
        + ' + " | 선두 " + frontrunner + " | 내 지지 " + stance + "(" + weight_txt + ")"' },

    { id: 'bond_known', label: '아는 얼굴',
      expr: `(${CAST_ALL.map(([id]) => `(b_${id} != 0 ? 1 : 0)`).join(' + ')}) + "/${CAST_ALL.length}"` },

    // ── 고용 ──
    // 메이드도 수녀도 저절로 나타나지 않는다. 명성이 문을 열고 금화가 값을 치른다.
    // 이게 있어야 fame이 인구 증가 말고도 쓸 데가 생기고, "왜 돈을 모으는가"에 답이 선다.
    ...TIER.map(([k, , base, , wage]) => [
      { id: `fee_${k}`, expr: hireCost(base) },
      { id: `wage_${k}`, expr: hireWage(wage) },
    ]).flat(),
    { id: 'payroll', label: '봉급 총액', expr: 'sum(corps)' },
    { id: 'hire_open', label: '부를 수 있는 등급',
      expr: TIER.slice().reverse().reduceRight(
        (acc, [, label, , gate]) => `fame >= ${gate} ? ${JSON.stringify(label + '까지')} : (${acc})`,
        '"아무도"') },
    // 몸값과 봉급을 함께 보여 준다 — 둘 중 무거운 쪽이 봉급이라 나란히 놔야 판단이 선다
    { id: 'hire_txt', label: '몸값',
      expr: TIER.map(([k, label, , gate]) => {
        const one = `${JSON.stringify((gate === 0 ? '' : ' · ') + label + ' ')} + fee_${k} + "(일 " + wage_${k} + ")"`;
        return gate === 0 ? one : `(fame >= ${gate} ? ${one} : "")`;
      }).join(' + ') },
    { id: 'retinue', label: '사람', expr: 'count(staff) + 1', format: '{v}명' },
    { id: 'appt_txt', label: '예정',
      expr: 'appt == "" ? "없음" : (appt_in <= 0 ? appt + " — 오늘" : appt + " — " + appt_in + "일 뒤")' },

    // ── 노동력: 총 → 가용 → 배치 ──
    // 노인·여자·부상병이 태반이라 처음엔 절반도 일을 못 한다. 보건이 오르면 나아진다.
    // ── 지은 것이 곧 수치다 ──
    // 예전엔 arable이 AI가 눈대중으로 밀던 정수였다. 이제 밭 목록의 합이라 서사와 어긋날 수가 없고,
    // 유저가 /경작지- 로 하나 빼면 수확이 바로 준다. 상한 12는 수확 공식이 견디는 범위라 남긴다.
    { id: 'arable', label: '경작 적성', expr: 'max(0, min(12, sum(farms)) - blight)' },
    { id: 'farm_txt', label: '경작지 상태',
      expr: 'blight > 0 ? "적성 " + arable + " — 밭이 상했다(-" + blight + ")" : "적성 " + arable' },
    { id: 'extract', label: '자원지 산출', expr: 'sum(sites)' },
    // 인구 상한. 이게 없으면 "마을을 늘려야 한다"는 동기가 서사에 안 생긴다.
    { id: 'cap', label: '수용 한계', expr: 'sum(houses)', format: '{v}명' },
    { id: 'crowd', label: '수용률', expr: 'round(pop * 100 / max(1, cap))' },
    { id: 'crowd_txt', label: '거처',
      expr: scale('crowd', [[130, '터져 나감'], [105, '포화 — 더 못 받는다'], [85, '빠듯함'], [55, '여유'], [0, '텅 빔']]) },

    { id: 'able', label: '가용 노동력', expr: 'round(pop * (0.38 + health * 0.0035))', format: '{v}명' },
    { id: 'farm_men', label: '경작', expr: `round(able * (${share(1)}))`, format: '{v}명' },
    { id: 'build_men', label: '건설', expr: `round(able * (${share(2)}))`, format: '{v}명' },
    { id: 'guard_men', label: '경비', expr: `round(able * (${share(3)}))`, format: '{v}명' },
    { id: 'scout_men', label: '탐사', expr: `round(able * (${share(4)}))`, format: '{v}명' },
    // 먹이고 재운 정도가 곧 능률. "식량 쓰고 쉬면 게이지가 찬다"를 미시관리 없이 흡수한다.
    { id: 'efficiency', label: '능률', expr: 'clamp(35 + health * 0.45 + morale * 0.2, 20, 100)' },

    // 날씨·계절이 이제 enum이라 수치에 물릴 수 있다. text였으면 불가능했던 연결이다.
    { id: 'weather_farm', label: '날씨 영향(경작)',
      expr: 'weather == "⛈폭풍우" ? 0.55 : (weather == "🥶한파" or weather == "❄️눈" ? 0.6'
        + ' : (weather == "🔥폭염" ? 0.75 : (weather == "🌧비" ? 1.1 : (weather == "☀️맑음" ? 1.05 : 0.95))))' },
    { id: 'season_farm', label: '계절 영향',
      expr: 'season == "⛄겨울" ? 0.4 : (season == "🍂가을" ? 1.35 : (season == "🌻여름" ? 1.05 : 0.85))' },
    { id: 'weather_water', label: '날씨 영향(취수)',
      expr: 'weather == "🌧비" or weather == "⛈폭풍우" ? 1.35 : (weather == "🔥폭염" ? 0.8 : 1)' },

    // ── 수급: 이게 이 봇의 심장. AI가 절대 손으로 계산하면 안 되는 부분 ──
    { id: 'harvest', label: '일 수확',
      expr: 'round((farm_men * (2.2 + arable * 0.55) + scout_men * 1.2) * efficiency * 0.01 * weather_farm * season_farm)' },
    { id: 'draw_water', label: '일 취수',
      expr: 'round((wells * 60 * efficiency * 0.01 + pop * 0.9) * weather_water)' },
    { id: 'eaten', label: '일 소비', expr: 'pop + army' },

    // ── 수입 ──
    // 계약 목록은 금화만 나른다. 그래서 "밀 수입 -15"를 계약에 적으면 돈만 나가고 밀은 안 들어왔다.
    // 이 목록은 반대다 — 물건이 들어오고 값은 시스템이 매긴다. 한 줄이 둘을 다 한다.
    // sum()의 필터가 부분일치라 항목에 "식량"/"식수"가 들어 있으면 알아서 갈린다.
    //
    // ⚠ 길이 막히면 0이 된다. 이게 이 구조의 핵심이다 —
    //   밀을 사다 먹던 영지는 강이 어는 순간 기근을 맞는다. 랜덤 사건 다섯 개가 여기서 무게를 얻는다.
    { id: 'sup_food', label: '식량 유입', expr: 'route == "없음" ? sum(supply, "식량") : 0' },
    { id: 'sup_water', label: '식수 유입', expr: 'route == "없음" ? sum(supply, "식수") : 0' },
    // 팔 땐 0.5, 살 땐 0.8. 상인이 떼 가는 몫이고, 자급이 교역보다 낫다는 게 숫자로 성립한다.
    { id: 'import_cost', label: '수입 대금', expr: 'round(sup_food * 0.8 + sup_water * 0.5)' },

    // 자체 생산과 총 수지를 갈라 둔다. 사 온 곡식을 되팔아 손해 보는 고리가 생기지 않게 —
    // 0.8에 사서 0.5에 파는 걸 시스템이 자동으로 해 버리면 금고가 조용히 샌다.
    { id: 'grown', label: '자체 생산 수지', expr: 'harvest - eaten' },
    { id: 'drawn', label: '자체 취수 수지', expr: 'draw_water - eaten' },
    { id: 'surplus', label: '식량 수지', expr: 'grown + sup_food' },
    { id: 'water_bal', label: '식수 수지', expr: 'drawn + sup_water' },
    { id: 'food_days', label: '식량 잔여', expr: 'surplus >= 0 ? 99 : floor(food / max(1, 0 - surplus))' },
    { id: 'water_days', label: '식수 잔여', expr: 'water_bal >= 0 ? 99 : floor(water / max(1, 0 - water_bal))' },

    // ── 재정: 지속 수입은 세 갈래다 ──
    // ① 인구세 — 사람이 곧 세원이라 인구를 늘리는 게 곧 재정 성장이 된다.
    //    단 성난 땅에서는 안 걷힌다. 민심 관리가 숫자로 보상받는 지점.
    { id: 'tax_mult', label: '징세 효율', expr: 'clamp(0.3 + morale * 0.006 + (100 - unrest) * 0.002, 0.2, 1.15)' },
    { id: 'tax', label: '인구세', expr: 'round(pop * 0.2 * tax_mult)' },
    // ② 잉여 판매 — 남는 곡식은 돈이 된다. 농사에 재정적 의미가 생긴다.
    { id: 'sold', label: '잉여 판매', expr: 'grown > 0 ? round(grown * 0.5) : 0' },
    // ③ 계약·시설 — 서사가 만든 것. 여기만 AI 관할이고, 매일 더하는 건 시스템이 한다.
    { id: 'deals', label: '계약 수입', expr: 'sum(contracts)' },
    // 길이 막히면 짐이 안 움직인다. 계약서가 살아 있어도 들어오는 건 절반 아래다 —
    // 계약을 지우지 않는 게 중요하다. 길이 뚫리면 그대로 되살아나야 하니까.
    { id: 'deals_net', label: '실수령 계약', expr: 'route == "없음" ? deals : round(deals * 0.4)' },
    { id: 'income', label: '일 수입', expr: 'tax + sold + deals_net + extract' },
    { id: 'route_txt', label: '길',
      expr: 'route == "없음" ? "모두 열림" : route + " 막힘 (" + route_days + "일)"' },
    // 군대는 공짜가 아니다. 식량만 먹던 army에 급료가 붙는다.
    { id: 'upkeep', label: '일 지출', expr: 'round(army * 1.2) + round(pop * 0.05) + payroll + import_cost' },
    { id: 'net_gold', label: '재정 수지', expr: 'income - upkeep' },
    // 세납일에 바칠 액수 — 이것도 AI가 어림잡을 게 아니라 시스템이 정한다.
    { id: 'tribute', label: '세납액', expr: 'round(pop * 1.5 + fame * 2 + 30)' },
    { id: 'gold_txt', label: '재정 사정',
      expr: 'net_gold < 0 and gold <= 0 ? "빈 금고 — 급료가 밀린다"'
        + ' : (net_gold < 0 ? "축내는 중" : (net_gold > 0 ? "쌓이는 중" : "겨우 맞는다"))' },

    // ── 표시용 척도: 지금 쓰던 말투 그대로 ──
    { id: 'morale_txt', label: '사기',
      expr: scale('morale', [[80, '드높음'], [60, '견실함'], [40, '보통'], [25, '흔들림'], [10, '불안'], [0, '절망']]) },
    { id: 'health_txt', label: '보건',
      expr: scale('health', [[80, '양호'], [60, '무난함'], [40, '보통'], [25, '나쁨'], [0, '열악함']]) },
    { id: 'labor_txt', label: '노동력',
      expr: scale('able', [[300, '풍부'], [150, '넉넉함'], [80, '보통'], [40, '부족'], [15, '태부족'], [0, '없음']]) },
    { id: 'army_txt', label: '군사',
      expr: scale('army', [[200, '강건'], [80, '상당함'], [30, '미약'], [10, '이름뿐'], [0, '없음']]) },
    { id: 'sec_out_txt', label: '외부보안',
      expr: scale('threat', [[75, '매우 취약'], [55, '취약'], [35, '불안'], [15, '보통'], [0, '안정']]) },
    { id: 'sec_in_txt', label: '내부보안',
      expr: scale('unrest', [[75, '매우 취약'], [55, '취약'], [35, '불안'], [15, '보통'], [0, '안정']]) },
    { id: 'fame_txt', label: '명성',
      expr: scale('fame', [[80, '드높음'], [55, '알려짐'], [30, '들리는 정도'], [10, '미미함'], [0, '무명']]) },
    // 어느 프리셋으로 시작했는지 200턴 뒤에도 알아볼 수 있게. 프롬프트엔 안 싣는다 — AI가 알 일이 아니다.
    { id: 'diff_txt', label: '난이도',
      expr: `(${scale('hardship', [[75, '가혹'], [45, '보통'], [0, '온건']])})`
        + ' + " (시련 " + hardship + " · 시세 " + hire_mult + "%)"' },

    // ── 이웃 ──
    ...NEIGH.map(([id]) => ({ id: `${id}_txt`, expr: scale(id, REL_STEPS) })),
    // 지도 한 줄. 이름 · 거리 · 저쪽의 인식이 한 덩어리로 붙어 나간다.
    // 로어북 지도 항목을 상시로 켜 두는 것보다 짧고, 무엇보다 이건 낡지 않는다.
    { id: 'neighbors', label: '이웃',
      expr: NEIGH.map(([id, dir, name, dist]) =>
        `${JSON.stringify(`${dir} ${name} ${dist} `)} + ${id}_txt`).join(' + " | " + ') },
    { id: 'rel_top', label: '가장 아는 쪽',
      expr: `max(max(max(rel_n, rel_e), max(rel_s, rel_w)), rel_cap)` },
    { id: 'food_txt', label: '식량 사정',
      expr: 'food <= 0 ? "바닥 — 오늘 굶는다" : (food_days <= 3 ? "사흘치도 없다" : (surplus >= 0 ? "자급된다" : "축내는 중"))' },
    { id: 'water_txt', label: '식수 사정',
      expr: 'water <= 0 ? "바닥 — 오늘 마실 물이 없다" : (water_days <= 3 ? "사흘치도 없다" : (water_bal >= 0 ? "자급된다" : "축내는 중"))' },
    { id: 'phase', label: '국면',
      expr: 'pop >= 400 ? "번성" : (pop >= 220 ? "성장" : (grown > 0 and drawn > 0 ? "자립" : "연명"))' },
  ],

  // ── 매 턴 자동 정산. AI는 이 계산에 손대지 않는다 ──
  rules: {
    onTurn: [
      // 기한이 다한 계약부터 턴다. 정산보다 먼저여야 끝난 계약이 하루치를 더 받아 가지 않는다.
      // 기준은 'day'가 아니라 'day + span' — 이 턴이 끝나는 날이다.
      // day로 두면 아래에서 day가 올라가기 전 값으로 판정해 한 턴 늦게 빠진다(며칠 건너뛰면 더 늦는다).
      { list: 'contracts', expire: 'day + span' },
      // ⚠ 아래 정산은 전부 span배(=흐른 날수)로 몰아서 이뤄진다.
      //   "사흘 뒤"로 넘어갔으면 사흘치 곡식이 사라져야 서사와 수치가 안 어긋난다.
      { set: 'food', expr: 'max(0, food + surplus * span)' },
      { set: 'water', expr: 'max(0, water + water_bal * span)' },
      { set: 'gold', expr: 'max(0, gold + net_gold * span)' },
      // 굶거나 목마르면 무너지고, 곳간이 있는 동안은 천천히 회복된다.
      // (잉여가 나야 회복되게 짜면 교착이다 — 보건이 낮아 잉여가 안 나는데 잉여가 없어 보건도 안 오른다)
      { set: 'health', expr: 'clamp(health + (food <= 0 or water <= 0 ? -7 : (surplus > 0 ? 2 : 1)) * span, 0, 100)' },
      { set: 'morale', expr: 'clamp(morale + ((food <= 0 ? -6 : 1) - (unrest >= 55 ? 3 : 0) - (disaster != "" ? 2 : 0)) * span, 0, 100)' },
      // 사람이 늘수록 경비가 더 필요하다 — 성장이 곧 새 문제
      // 급료를 못 준 병사가 얌전할 리 없다 — 군대를 키우는 데 재정이 물린다
      { set: 'unrest', expr: 'clamp(unrest + ((guard_men + army < round(pop * 0.10) ? 2 : -3) + (food <= 0 ? 5 : 0)'
        + ' + (gold <= 0 and (army > 0 or count(corps) > 0) ? 3 : 0) + (pop > cap ? 3 : 0)) * span, 0, 100)' },
      // 명성은 "여기 가면 살 수 있다"는 소문
      { set: 'fame', expr: 'clamp(fame + ((surplus > 4 ? 2 : 0) - (unrest >= 60 ? 2 : 0)) * span, 0, 100)' },
      // 굶으면 사람이 줄고, 먹이고 이름이 나면 흘러든다.
      // 인구 변동은 비율이라 열흘치를 한 번에 곱하면 몰살이 된다 — 닷새분까지만 몰아서 친다.
      { set: 'pop', expr: 'max(0, pop + ((surplus > 4 and fame >= 12 and pop < cap ? round(min(surplus * 0.2, 5)) : 0)'
        + ' - (food <= 0 ? round(pop * 0.04) : 0) - (health <= 10 ? round(pop * 0.03) : 0)) * min(span, 5))' },
      // ── 탐사 진척 ──
      // 한 줄이 세 가지를 겸한다: ① 끝난 방향은 손대지 않음 ② 100에 닿으면 결과를 굴림
      // 시작점 굴림. 반드시 진척도 규칙보다 **먼저** — 같은 턴에 진척도가 이 값을 읽는다.
      //   max(0, rand(0, SPOTS) - 1) → 0이 1/3, 나머지가 각 1/6.
      //   대표 결과에 무게를 주지 않으면 "남쪽은 농사 땅"이라는 정체성이 사라진다.
      ...EXPLORE.map(([, v]) => ({
        set: `o_${v.slice(4)}`,
        expr: `o_${v.slice(4)} >= 0 ? o_${v.slice(4)} : (${v} >= 100 ? max(0, rand(0, ${SPOTS}) - 1) : -1)`,
      })),
      // ① 결과가 나온 다음 턴엔 0으로 — 척후가 돌아와 보고하고 다시 나간다. 방향이 소진되지 않는다.
      // ② 100에 닿으면 다음 자리를 연다. 굴림이 아니라 "시작점에서 이어가기"다(위 ⚠ 참고).
      // ③ 그 외에는 척후 인원만큼 쌓음. 건진 게 있는 방향은 지리를 아니까 조금씩 빨라진다.
      ...EXPLORE.map(([dir, v]) => {
        const [f, o] = [`f_${v.slice(4)}`, `o_${v.slice(4)}`];
        return {
          set: v,
          expr: `${v} >= 110 ? 0 : (${v} >= 100 ? 110 + (${f} == 0 ? ${o} : (${f} - 1 < ${o} ? ${f} - 1 : ${f}))`
            + ` : (explore_dir == ${JSON.stringify(dir)}`
            + ` ? min(100, ${v} + round(scout_men * (0.6 + ${f} * 0.1)) * span) : ${v}))`,
        };
      }),
      { set: 'day', expr: 'day + span' },
      // 재해는 저절로 끝난다. AI가 "언제 끝났더라"를 기억할 필요가 없다.
      { set: 'disaster_days', expr: 'max(0, disaster_days - span)' },
      { set: 'blight', expr: 'max(0, blight - span)' },   // 밭은 저절로 아문다
      { set: 'disaster', expr: 'disaster_days <= 0 ? "" : disaster' },
      // 길도 같은 방식으로 저절로 뚫린다. 다만 AI가 route를 "없음"으로 바꾸면 그 즉시 열린다 —
      // 도적을 쳐내는 것도 길을 여는 방법이고, 그건 기다리는 것보다 나은 선택이어야 한다.
      { set: 'route_days', expr: 'route == "없음" ? 0 : max(0, route_days - span)' },
      { set: 'route', expr: 'route_days <= 0 ? "없음" : route' },
      // 예정도 마찬가지. 세어 주고, 지난 건 지운다.
      // 줄인 뒤에 지운다 — 0이 된 날은 "오늘"로 한 번 보여 주고 그다음 턴에 사라진다.
      // 며칠을 건너뛰어 예정일을 지나쳐 버렸으면 음수로 떨어뜨리지 않고 0에 세운다.
      // 그래야 "그날이 왔다"가 최소 한 번은 서사에 노출되고 조용히 증발하지 않는다.
      { set: 'appt_in', expr: 'appt == "" ? 0 : (appt_in > 0 and appt_in - span < 0 ? 0 : max(-1, appt_in - span))' },
      { set: 'appt', expr: 'appt_in < 0 ? "" : appt' },
      { set: 'appt_in', expr: 'appt == "" ? 0 : appt_in' },  // 지운 뒤엔 0으로 — AI의 다음 등록이 밀리지 않게
      // ── 계승 다툼 ──
      // 이 판의 심장. 선두는 나머지 둘의 연합에 눌리고 뒤처진 쪽은 동정표를 얻는다.
      // 이게 없으면 한 명이 달아나 다툼이 서너 턴 만에 끝난다.
      // 며칠을 건너뛰어도 궁정은 그만큼 빨리 안 움직인다 — span을 2일까지만 친다.
      { set: 'lead_who', expr: 'pw_cass >= pw_orel and pw_cass >= pw_lili ? "카산드라"'
        + ' : (pw_orel >= pw_lili ? "오렐리아" : "릴리아나")' },
      // ⚠ 합이 지켜져야 한다. 선두 -3 / 나머지 +1로 짰더니 매 턴 1씩 새서
      //   120턴 뒤 셋 다 바닥(8/6/5)이었다. 판세라는 게 없어진다.
      //   선두 -2 / 나머지 각 +1 이면 합이 0이라 셋이 서로를 붙들고 돈다.
      // 내 지지도 같은 이유로 제로섬이다. 내 편에 +2k, 나머지 둘에 각 -k —
      //   한쪽에만 더해 주면 총량이 불어나 결국 셋 다 천장에 붙는다(실측 88/90/91).
      //   k는 무게의 2.5%라 폐허 남작(무게 8)은 k=0, 아무것도 못 움직인다. 그게 맞다.
      ...[['cass', '카산드라'], ['orel', '오렐리아'], ['lili', '릴리아나']].map(([k, name]) => ({
        set: `pw_${k}`,
        expr: `clamp(pw_${k} + ((lead_who == ${JSON.stringify(name)} ? -2 : 1)`
          + ` + (stance == ${JSON.stringify(name)} ? round(my_weight * 0.05)`
          + ` : (stance == "중립" ? 0 : 0 - round(my_weight * 0.025)))) * min(span, 2), 5, 100)`,
      })),
      // 줄을 서면 나머지 둘이 나를 싫어한다 — 단, 알려진 뒤부터다. 아무도 모르는 지지는 아무도 안 미워한다.
      // 중립은 아무도 미워하지 않지만 아무도 밀어주지 않는다.
      // ⚠ 저절로 흐르는 호감에는 바닥과 천장을 따로 둔다. 안 그러면 표명 한 번으로
      //   반대편 둘이 120턴 만에 -50(최저)에 박혀 그 인물들과의 서사가 통째로 죽는다.
      //   줄을 섰다는 사실만으로 갈 수 있는 건 -20까지. 그보다 미워지려면 서사에 이유가 있어야 한다.
      //   호감도 마찬가지로 +40까지만 저절로 오른다 — 진짜 정은 장면에서 얻는 것이다.
      ...[['cassandra', '카산드라'], ['orelia', '오렐리아'], ['liliana', '릴리아나']].map(([id, name]) => ({
        set: `b_${id}`,
        expr: `clamp(b_${id} + (stance == ${JSON.stringify(name)} ? (b_${id} >= 40 ? 0 : 1)`
          + ` : (stance == "중립" or exposed < 40 ? 0 : (b_${id} <= -20 ? 0 : -1))) * min(span, 2), -50, 100)`,
      })),
      // 표명하면 빠르게 알려지고, 중립이면 천천히 잊힌다 — 다만 오래 버티면 그 침묵이 알려진다.
      // 계승 다툼에서 중립은 안전지대가 아니라 유예기간이다.
      { set: 'exposed',
        expr: 'clamp(exposed + (stance == "중립" ? (day >= 60 ? 1 : -2) : 4) * min(span, 2), 0, 100)' },

      // 반드시 마지막. 위 정산이 끝난 뒤 0으로 돌려놔야
      // AI가 아무 말 안 한 턴이 조용히 사흘씩 흐르지 않는다.
      { set: 'days_passed', expr: '0' },
    ],
    // ── 발견 ──
    // 어느 자리가 열렸는지는 onTurn이 이미 정했다. 여기는 그걸 서사에게 넘기는 자리다.
    // 물건 이름도, 수치 변화도 여기서 안 정한다 — 계약과 같다. 시스템은 "무엇이 나올 차례"까지,
    // 그게 구체적으로 뭔지는 서사가 짓고 보조 모델이 목록에 옮긴다.
    // once: true — 한 자리는 한 번만 열린다. 자리 수를 넘으면 그 방향은 더 나올 게 없다.
    events: EXPLORE.flatMap(([dir, v, place, , slots]) => slots.map((cat, i) => ({
      id: `find_${v.slice(4)}_${i + 1}`,
      once: true,
      when: `${v} == ${110 + i}`,
      effects: [{ set: `f_${v.slice(4)}`, expr: `f_${v.slice(4)} + 1` }],
      notify: `[탐사 · ${dir}] ${place}에서 ${CAT[cat][0]}. ${CAT[cat][1]}를 이번 장면에서 정하고`
        + ` 이름을 붙여라 — 이름이 붙지 않으면 기록에 남지 않는다.${CAT[cat][2]}`,
    }))),

    // ── 굴러 들어오는 것 ──
    // 매 턴 한 번 굴려서, 걸리면 조건을 통과한 것 중 하나만 터진다. 엔진이 하나 뽑고 끝낸다.
    // 조건에 QUIET(재해도 없고 길도 열려 있을 때)를 전부 붙였다 — 곤경이 겹쳐 쌓이면 서사가 수습을 못 한다.
    // 여기 있는 건 전부 "밖에서 오는 것"이다. 안에서 나는 일(곳간이 빈다, 사람이 앓는다)은
    // 이미 onTurn 정산이 만들어 낸다. 그걸 여기 또 넣으면 같은 불행이 두 배로 온다.
    randomEvents: {
      // 발동 확률도 hardship이 민다 (v0.89.1 식 지원) — 희망(10) 4.4% / 보통(45) 5.8% / 리얼리티(100) 8%.
      // when 문턱이 "어떤 사건이 들어오나"를 밀고, 이 식은 "세상이 얼마나 자주 두드리나"를 민다.
      // 상한 8%는 유저 확정(2026-08-15): 아이돌 실플에서 "20턴에 1번(5%)이 적당" 교훈 —
      // 리얼리티도 대화 리듬을 부수지 않는 선. 랜디 맛은 빈도보다 창(thr 세 배)이 낸다.
      // 명중해도 조건 맞는 사건이 없으면 불발이라(QUIET·계절·쿨다운) 체감은 이보다 낮다.
      chancePerTurn: '0.04 + hardship * 0.0004',
      table: [
        // ① 길 — 무역로는 목록이 아니라 사건이다. 얼고, 무너지고, 도적이 앉는다.
        { id: 'road_ice', weight: 2, cooldown: 40,
          when: `${QUIET} and (month >= 12 or month <= 2)`,
          effects: [{ set: 'route', expr: '"동 강길"' }, { set: 'route_days', expr: '10 + rand(0, 8)' }],
          notify: '[강이 얼었다] 나루에 배가 얼어붙었다. 하류에서 오던 것이 이제 안 온다. '
            + '녹기 전까지는 어느 쪽으로도 짐이 못 움직인다.' },
        { id: 'road_snow', weight: 2, cooldown: 40,
          when: `${QUIET} and (month >= 11 or month <= 3)`,
          effects: [{ set: 'route', expr: '"북 산길"' }, { set: 'route_days', expr: '8 + rand(0, 10)' }],
          notify: '[고개가 닫혔다] 밤새 눈이 고개를 메웠다. 북쪽은 봄까지 남의 나라다.' },
        // 로어북의 WorldReactivity 그대로 — 살 만해지면 눈이 붙는다
        { id: 'road_bandit', weight: 3, cooldown: 30,
          when: `${QUIET} and (deals >= 15 or gold >= 300)`
            + ' and guard_men + army * 2 < round(pop * (0.1 + hardship * 0.0012))',
          effects: [{ set: 'route', expr: '"남 가도"' }, { set: 'route_days', expr: '4 + rand(0, 6)' },
            { set: 'unrest', expr: 'clamp(unrest + 6, 0, 100)' }],
          notify: '[가도에 앉았다] 짐수레가 털렸다. 한 무리가 포장도로 길목을 잡고 통행세를 받는다. '
            + '이건 저절로 안 풀린다 — 쫓아내면 그날로 길이 열린다.' },
        { id: 'road_wood', weight: 2, cooldown: 36,
          when: `${QUIET} and ${thr('threat', '>=', 68, 45)}`,
          effects: [{ set: 'route', expr: '"서 숲길"' }, { set: 'route_days', expr: '5 + rand(0, 8)' }],
          notify: '[숲길이 삼켜졌다] 서쪽으로 간 짐꾼이 돌아오지 않았다. 숲이 길을 지운 건지 무언가가 지키는 건지 모른다.' },
        { id: 'road_flood', weight: 2, cooldown: 40,
          when: `${QUIET} and month >= 4 and month <= 8 and weather != "☀️맑음"`,
          effects: [{ set: 'route', expr: '"동 강길"' }, { set: 'route_days', expr: '4 + rand(0, 6)' }],
          notify: '[강이 넘쳤다] 물이 둔치를 삼키고 갈대밭까지 올라왔다. 나루 자리를 다시 찾아야 한다.' },

        // ② 밖에서 오는 사람 — 수용 한계가 있어야 이게 축복이자 부담이 된다
        { id: 'refugees', weight: 3, cooldown: 25,
          // 터져 나가는 게 눈에 보이면 발길이 끊긴다 — 그래도 수용 한계까진 밀고 들어온다
          when: `${QUIET} and ${thr('fame', '>=', 2, 18)} and food > 200 and crowd < 125`,
          effects: [{ set: 'pop', expr: 'pop + min(round(cap * 0.12) + rand(0, 8), 30)' },
            { set: 'morale', expr: 'clamp(morale - 3, 0, 100)' }],
          notify: '[사람이 들어왔다] 남쪽 길로 한 무리가 걸어 들어왔다. 여기가 사람을 받는다는 말을 듣고 왔다고 한다. '
            + '재울 자리가 있는지는 그들이 알 바 아니다.' },
        { id: 'peddler', weight: 3, cooldown: 20,
          when: `${QUIET} and rel_top >= 15`,
          effects: [],
          notify: '[봇짐장수가 들렀다] 길을 잘못 든 장사치 하나가 하룻밤 묵어 간다. '
            + '팔 것과 살 것이 있다면 오늘이다 — 계약이 성사되면 그 조건을 적어라.' },

        // ③ 밖에서 오는 위협
        { id: 'raid', weight: 3, cooldown: 22,
          // 보건이 오르면 가용 노동력이 늘어 경비 인원도 같이 는다 — 예전 기준(pop*0.10)은
          // 자리를 잡은 순간 영원히 안 걸렸다. 상비군을 두 배로 세는 건 훈련된 병사가 척후 몇보다 낫기 때문.
          when: `${QUIET} and ${thr('threat', '>=', 80, 45)} and guard_men + army * 2 < round(pop * 0.15)`,
          effects: [{ set: 'threat', expr: 'clamp(threat + 8, 0, 100)' },
            { set: 'unrest', expr: 'clamp(unrest + 8, 0, 100)' }],
          notify: '[변두리가 털렸다] 외곽 집 몇 채가 밤사이 비었다. 사람이 상했는지 도망친 건지는 아침에 안다. '
            + '경비가 모자라다는 걸 저쪽이 먼저 알아챘다.' },
        { id: 'plague', weight: 2, cooldown: 45,
          when: `${QUIET} and ${thr('health', '<=', 20, 60)} and crowd >= 85`,
          effects: [{ set: 'disaster', expr: '"열병"' }, { set: 'disaster_days', expr: '8 + rand(0, 10)' },
            { set: 'health', expr: 'clamp(health - 10, 0, 100)' }],
          notify: '[열이 돈다] 한 집에서 시작한 것이 사흘 만에 옆집으로 갔다. 사람이 붙어 자니 막을 방법이 없다.' },
        { id: 'drought', weight: 2, cooldown: 60,
          when: `${QUIET} and month >= 6 and month <= 8 and ${thr('wells', '<=', 0, 2)}`,
          effects: [{ set: 'disaster', expr: '"가뭄"' }, { set: 'disaster_days', expr: '12 + rand(0, 14)' }],
          notify: '[비가 그쳤다] 논둑이 갈라지기 시작했다. 강까지 물을 이고 나르는 줄이 길어진다.' },

        // ④ 밖에서 오는 눈길 — 이웃이 이쪽을 처음 쳐다보는 순간
        { id: 'assessor', weight: 3, cooldown: 50,
          when: `${QUIET} and rel_top >= 30 and rel_top < 70`,
          effects: [],
          notify: '[누가 보러 왔다] 이웃 영지 사람이 볼일 없이 마을을 한 바퀴 돌고 갔다. 세는 눈이었다. '
            + '어느 쪽에서 왔고 무엇을 세고 갔는지는 이번 장면에서 정하라.' },

        // ⑤ 하늘이 하는 일 — 막을 수 없고 지나가기를 기다리는 것들.
        //    밭을 때리는 건 blight로, 곳간을 때리는 건 food로 간다. 목록에서 밭을 빼는 건 이벤트가 못 한다.
        { id: 'storm', weight: 3, cooldown: 30,
          when: `${QUIET} and (month >= 3 and month <= 5 or month >= 9 and month <= 11)`,
          effects: [{ set: 'disaster', expr: '"큰바람"' }, { set: 'disaster_days', expr: '2 + rand(0, 3)' },
            { set: 'food', expr: 'max(0, food - round(pop * 0.6))' },
            { set: 'morale', expr: 'clamp(morale - 5, 0, 100)' }],
          notify: '[밤새 바람이 불었다] 사람은 상하지 않았지만 세워 둔 것 몇 가지가 견디지 못했다. '
            + '무엇이 무너지고 무엇이 젖었는지는 이 영지에 실제로 서 있는 것들 중에서 골라라 — '
            + '물길을 냈다면 물길이 넘칠 수도 있고, 아직 아무것도 없다면 없는 대로 무너질 것이 있다.' },
        { id: 'hail', weight: 3, cooldown: 45,
          when: `${QUIET} and month >= 5 and month <= 8 and sum(farms) > 0`,
          effects: [{ set: 'blight', expr: 'min(8, blight + 3 + rand(0, 3))' }],
          notify: '[우박이 왔다] 한나절 만에 이삭이 다 누웠다. 밭이 없어진 건 아니지만 올해 그 자리에서 '
            + '나올 것은 크게 줄었다. 몇 이랑이 살아남았는지는 이번 장면에서 정하라.' },
        { id: 'frost', weight: 2, cooldown: 60,
          when: `${QUIET} and month >= 3 and month <= 4 and sum(farms) > 0`,
          effects: [{ set: 'blight', expr: 'min(8, blight + 2 + rand(0, 3))' }],
          notify: '[늦서리가 내렸다] 파종이 끝난 뒤에 서리가 왔다. 막 나온 싹이 하룻밤에 검게 죽었다.' },
        { id: 'wildfire', weight: 2, cooldown: 50,
          when: `${QUIET} and month >= 6 and month <= 8 and weather == "☀️맑음"`,
          effects: [{ set: 'disaster', expr: '"들불"' }, { set: 'disaster_days', expr: '3 + rand(0, 4)' },
            { set: 'threat', expr: 'clamp(threat - 6, 0, 100)' }],
          notify: '[들에 불이 붙었다] 마른 풀을 타고 번진다. 사람을 붙여 불길을 끊어야 한다. '
            + '탄 자리에서 무엇이 쫓겨 나왔는지는 이번 장면에서 정하라 — 짐승도 불은 피한다.' },
        { id: 'coldsnap', weight: 2, cooldown: 50,
          when: `${QUIET} and (month >= 12 or month <= 2) and crowd >= 90`,
          effects: [{ set: 'disaster', expr: '"한파"' }, { set: 'disaster_days', expr: '4 + rand(0, 5)' },
            { set: 'health', expr: 'clamp(health - 8, 0, 100)' }],
          notify: '[숨이 얼 만큼 춥다] 땔감이 모자라고 방 하나에 너무 여럿이 잔다. 노인과 아이부터 앓기 시작했다.' },

        // ⑥ 병 — 여건이 나빠서 나는 것들이라 조건이 곧 원인이다.
        { id: 'foul_water', weight: 3, cooldown: 35,
          when: `${QUIET} and wells <= 0 and ${thr('health', '<=', 25, 70)}`,
          effects: [{ set: 'disaster', expr: '"배앓이"' }, { set: 'disaster_days', expr: '5 + rand(0, 6)' },
            { set: 'health', expr: 'clamp(health - 7, 0, 100)' }],
          notify: '[강물 탓이다] 마을 절반이 같은 날 배를 잡았다. 오염된 우물을 두고 강물을 길어 온 대가다. '
            + '끓여 먹으라는 말은 지키는 사람만 지킨다.' },
        { id: 'murrain', weight: 2, cooldown: 55,
          when: `${QUIET} and sum(farms) >= 4`,
          effects: [{ set: 'food', expr: 'max(0, food - round(pop * 0.8))' },
            { set: 'morale', expr: 'clamp(morale - 4, 0, 100)' }],
          notify: '[짐승이 쓰러진다] 기르던 것들 사이에 병이 돌아 사흘 만에 퍼졌다. 죽은 것은 먹을 수 없어 태운다. '
            + '무엇을 치던 자리에서 시작됐는지는 경작지 목록에 있는 것 중에서 골라라.' },

        // ⑦ 짐승과 그보다 나쁜 것 — 방향마다 사는 게 다르다(로어북).
        //    경비가 모자랄 때만 온다. 저쪽이 그걸 먼저 안다.
        { id: 'goblin_raid', weight: 2, cooldown: 24,
          when: `${QUIET} and ${thr('threat', '>=', 70, 40)} and guard_men + army * 2 < round(pop * 0.18)`,
          effects: [{ set: 'food', expr: 'max(0, food - round(pop * 0.5))' },
            { set: 'threat', expr: 'clamp(threat + 6, 0, 100)' }],
          notify: '[북쪽에서 내려왔다] 고블린 한 떼가 밤에 곳간을 뒤졌다. 싸움이랄 것도 없이 지고 갔다. '
            + '한 번 성공한 자리는 다시 온다.' },
        { id: 'harpy', weight: 2, cooldown: 40,
          when: `${QUIET} and ${thr('threat', '>=', 75, 45)} and month >= 4 and month <= 9`,
          effects: [{ set: 'pop', expr: 'max(0, pop - (1 + rand(0, 2)))' },
            { set: 'morale', expr: 'clamp(morale - 6, 0, 100)' }],
          notify: '[하늘에서 왔다] 능선 쪽에서 그림자가 돌더니 들에 있던 사람을 채 갔다. 활이 닿지 않는 높이였다. '
            + '누가 없어졌는지는 이번 장면에서 정하라.' },
        { id: 'orc_scout', weight: 2, cooldown: 45,
          when: `${QUIET} and ${thr('threat', '>=', 80, 55)}`,
          effects: [{ set: 'threat', expr: 'clamp(threat + 10, 0, 100)' },
            { set: 'unrest', expr: 'clamp(unrest + 6, 0, 100)' }],
          notify: '[재 너머에서 봤다] 남쪽 평원에 오크 척후가 다녀갔다. 약탈이 아니라 세러 온 것이다. '
            + '세고 갔다는 건 뒤에 본대가 있다는 뜻이다.' },
        { id: 'nest_near', weight: 2, cooldown: 40,
          when: `${QUIET} and ${thr('threat', '>=', 50, 30)}`,
          effects: [{ set: 'threat', expr: 'clamp(threat + 12, 0, 100)' }],
          notify: '[가까이에 자리를 잡았다] 마을에서 반나절도 안 되는 곳에 무언가가 둥지를 틀었다. '
            + '척후가 찾은 먼 곳이 아니라 코앞이다. 무엇이 어디에 자리 잡았는지 이번 장면에서 정하고 이름을 붙여라 — '
            + '치우면 없어지고, 두면 커진다.' },

        // ⑧ 좋은 것 — 곤경만 굴리면 서사가 한 방향으로만 간다.
        //    문턱이 나쁜 일과 반대로 움직인다. 하드에서 행운이 사라지는 게 아니라,
        //    행운이 걸릴 만큼 뭔가를 세워 놓아야 걸린다.
        { id: 'bumper', weight: 3, cooldown: 60,
          when: `${QUIET} and month >= 9 and month <= 10 and ${thr('sum(farms)', '>=', 2, 8)} and blight <= 0`,
          effects: [{ set: 'food', expr: 'food + round(pop * 2.5)' },
            { set: 'morale', expr: 'clamp(morale + 8, 0, 100)' },
            { set: 'fame', expr: 'clamp(fame + 3, 0, 100)' }],
          notify: '[올해는 잘 됐다] 걷어 보니 예상보다 훨씬 많다. 이런 해는 자주 오지 않는다는 걸 늙은이들이 안다.' },
        { id: 'wanderer', weight: 3, cooldown: 30,
          when: `${QUIET} and ${thr('fame', '>=', 4, 22)} and crowd < 110`,
          effects: [],
          notify: '[손을 가진 사람이 왔다] 떠돌던 장인 하나가 여기서 겨울을 나겠다고 한다. 무엇을 다루는 사람이고 '
            + '왜 떠돌았는지 이번 장면에서 정하고, 눌러앉기로 하면 현지 고용인에 올려라.' },
        { id: 'pilgrims', weight: 2, cooldown: 45,
          when: `${QUIET} and fest_in <= 3 and ${thr('fame', '>=', 0, 12)}`,
          effects: [{ set: 'morale', expr: 'clamp(morale + 6, 0, 100)' },
            { set: 'fame', expr: 'clamp(fame + 2, 0, 100)' },
            { set: 'gold', expr: 'gold + 20 + rand(0, 40)' }],
          notify: '[축일을 쇠러 왔다] 인근에서 사람들이 걸어 들어왔다. 폐허라도 축일은 축일이라고. '
            + '쓰고 간 돈보다, 여기가 사람 사는 곳으로 보였다는 게 크다.' },
        { id: 'windfall', weight: 2, cooldown: 60,
          when: `${QUIET} and ${thr('build_men', '>=', 2, 16)}`,
          effects: [{ set: 'gold', expr: 'gold + 120 + rand(0, 260)' }],
          notify: '[땅에서 나왔다] 터를 파던 인부가 항아리를 깼는데 안에 옛 주화가 들어 있었다. '
            + '누가 왜 묻었는지는 아무도 모른다.' },
        // ⑨ 왕도가 이쪽을 보기 시작할 때 — 계승 다툼이 영지까지 닿는다
        { id: 'envoy', weight: 3, cooldown: 40,
          when: `${QUIET} and my_weight >= 15 and stance == "중립"`,
          effects: [],
          notify: '[사절이 왔다] 왕도에서 온 사람이 남작을 따로 청했다. 세 왕녀 중 누가 보냈고 무엇을 약속하는지, '
            + '그리고 그 대가로 무엇을 요구하는지는 이번 장면에서 정하라. 지금 판세와 이쪽의 무게를 보고 '
            + '어울리는 쪽이 보냈을 것이다. 답을 그 자리에서 줄 필요는 없다.' },
        { id: 'leak', weight: 3, cooldown: 30,
          when: `${QUIET} and stance != "중립" and exposed >= 25 and exposed < 75`,
          effects: [{ set: 'exposed', expr: 'clamp(exposed + 20, 0, 100)' }],
          notify: '[말이 돌았다] 남작이 누구 편인지가 이제 궁정 밖에서도 오르내린다. 누구 입에서 나갔는지는 '
            + '이번 장면에서 정하라 — 밀서를 나른 자일 수도, 자랑을 한 식솔일 수도 있다. '
            + '반대편에 선 쪽이 이걸 모를 리 없다.' },
        { id: 'court_turn', weight: 2, cooldown: 55,
          when: `${QUIET} and day >= 40`,
          effects: [{ set: 'pw_cass', expr: 'clamp(pw_cass + rand(0, 16) - 8, 5, 100)' },
            { set: 'pw_orel', expr: 'clamp(pw_orel + rand(0, 16) - 8, 5, 100)' },
            { set: 'pw_lili', expr: 'clamp(pw_lili + rand(0, 16) - 8, 5, 100)' }],
          notify: '[왕도에서 무슨 일이 있었다] 소식이 열흘 늦게 닿았다. 판세가 눈에 띄게 움직였는데 '
            + '무엇 때문인지는 여기까지 정확히 오지 않는다. 어느 쪽이 웃고 어느 쪽이 다쳤는지는 '
            + '위 세력 수치를 보고 읽어라 — 이유는 지어내되 숫자와 어긋나면 안 된다.' },
        { id: 'summons', weight: 2, cooldown: 70,
          when: `${QUIET} and rel_cap >= 35 and my_weight >= 25`,
          effects: [{ set: 'appt', expr: '"왕도 소환 — 알현"' }, { set: 'appt_in', expr: '14 + rand(0, 7)' }],
          notify: '[부름을 받았다] 왕도에서 소환장이 왔다. 길이 십사 일이니 떠날 채비를 해야 하고, '
            + '떠나 있는 동안 영지는 누가 볼 것인지도 정해야 한다. 왜 지금 부르는지는 이번 장면에서 정하라.' },

        { id: 'sister_visit', weight: 2, cooldown: 50,
          when: `${QUIET} and health <= 55 and count(corps) <= 0 and ${thr('rel_cap', '>=', 0, 10)}`,
          effects: [{ set: 'health', expr: 'clamp(health + 10, 0, 100)' },
            { set: 'b_stella', expr: 'clamp(b_stella + 4, -50, 100)' }],
          notify: '[광휘회에서 지나갔다] 순회 중이던 자매 하나가 하루 묵으며 앓는 이들을 봐 주었다. '
            + '고용이 아니라 지나는 길이었고, 내일이면 간다.' },

        // ── ⑧ 등급 사건 (난이도 프리셋 재설계, 2026-08-15) ──
        // 혈전급은 리얼리티에서 창이 세 배 넓지만 어느 판에도 있다 — 켜고 끄지 않는다(원칙).
        // 반대로 순풍급은 시련이 낮을수록 창이 넓다: thr의 기울기를 뒤집으면 된다.
        { id: 'horde', weight: 2, cooldown: 70,
          when: `${QUIET} and ${thr('threat', '>=', 92, 62)} and pop >= 40`,
          effects: [
            { set: 'pop', expr: 'max(pop - 6 - rand(0, 8), 20)' },
            { set: 'army', expr: 'max(army - rand(2, 6), 0)' },
            { set: 'morale', expr: 'clamp(morale - 14, 0, 100)' },
            { set: 'threat', expr: 'clamp(threat + 10, 0, 100)' },
          ],
          notify: '[무리가 내려왔다] 척후가 봤다던 것들이 한꺼번에 왔다. 밤새 싸웠고, 아침에 세어 보니 '
            + '빈자리가 있다. 저들은 물러난 것이지 사라진 게 아니다.' },
        { id: 'granary_rot', weight: 2, cooldown: 60,
          when: `${QUIET} and ${thr('food', '>=', 1400, 600)}`,
          effects: [{ set: 'food', expr: 'max(food - round(food * (0.08 + hardship * 0.0012)), 0)' },
            { set: 'morale', expr: 'clamp(morale - 4, 0, 100)' }],
          notify: '[곳간이 상했다] 밑단 가마니에서 쉰내가 올라왔다. 젖은 채로 쌓은 것이 속에서 썩었다. '
            + '상한 것을 골라내는 데 하루가 갔고, 골라낸 만큼이 줄었다.' },
        { id: 'deserters', weight: 2, cooldown: 45,
          when: `${QUIET} and ${thr('morale', '<=', 6, 28)} and pop >= 40`,
          effects: [{ set: 'pop', expr: 'max(pop - 3 - rand(0, 5), 20)' },
            { set: 'morale', expr: 'clamp(morale - 3, 0, 100)' }],
          notify: '[사람이 떠났다] 새벽에 남쪽 길로 몇 집이 조용히 나갔다. 말리는 사람이 없었다는 것이 '
            + '더 나쁜 소식이다. 남은 이들이 그 빈집을 하루 종일 쳐다봤다.' },
        { id: 'settlers', weight: 2, cooldown: 45,
          when: `${QUIET} and ${thr('fame', '>=', 6, 30)} and pop < cap and health >= 25`,
          effects: [{ set: 'pop', expr: 'pop + 3 + rand(0, 4)' },
            { set: 'morale', expr: 'clamp(morale + 4, 0, 100)' }],
          notify: '[가족이 정착했다] 손에 연장이 있는 가족이 들어와 빈집을 골랐다. 도망 온 것이 아니라 '
            + '골라서 온 것이다 — 이 땅 이야기가 밖에서 그렇게 돈다는 뜻이다.' },
        { id: 'patron', weight: 2, cooldown: 60,
          when: `${QUIET} and ${thr('rel_top', '>=', 25, 60)}`,
          effects: [{ set: 'gold', expr: 'gold + 80 + rand(0, 60)' },
            { set: 'fame', expr: 'clamp(fame + 2, 0, 100)' },
            { set: 'morale', expr: 'clamp(morale + 3, 0, 100)' }],
          notify: '[선물이 왔다] 이웃 영지의 인장이 찍힌 궤짝이 도착했다. 답례를 바라는 선물이라는 걸 '
            + '모르는 사람은 없지만, 당장은 금화가 금화다.' },
      ],
    },
  },

  // ── 상태 지시문 ──
  //
  // 판별 기준 하나로 추렸다: **지시문은 AI가 모르는 것만 말한다.**
  // 아는 것을 어떻게 하라고 시키면 railroading이고, 매 판이 똑같아진다.
  //
  // 통과하는 세 가지:
  //   ① 시스템만 아는 사실 — 세납액, 재해 잔여일, 그 축일이 뭐 하는 날인지
  //   ② 모델이 잊는 것 — 재해가 아직 안 끝났다
  //   ③ 모델의 기본 성향을 거스르는 것 — 연명 단계인데 재건을 말하려 드는 경향
  //
  // 떨어진 것 (25 → 11):
  //   · 상태 블록에 이미 있는 값을 산문으로 되풀이 — food_low, health_bad, unrest_high,
  //     threat_high, winter, harsh_weather, broke, deals_on …
  //     척도(열악함/취약/빈 금고)가 이미 블록에 실려 나간다. 그림은 AI가 그리면 된다.
  //   · 인물이 어떻게 굴어야 하는지 규정 — ally_cold / ally_warm / ally_counsel.
  //     "유대 40"은 변수로 관리할 값이지만 "유대가 낮으면 가시가 섞인다"는 서사다.
  //     게다가 아데레의 성격은 로어북 시트에 있다 — 여기 또 적으면 두 벌이 어긋난다.
  //     상태 블록의 '동행 아데레(책사, 유대 데면데면)' 한 줄이면 모델은 알아서 조절한다.
  //
  // ⚠ 조건이 겹치면 여러 줄이 한꺼번에 나간다. 같은 축은 서로 배타적으로 끊었다.
  directives: [
    // ── 문턱을 넘었다는 신호만. 장면은 안 그린다 ──
    // 상태 블록은 값을 평평하게 늘어놓을 뿐이라 "지금 무엇이 비상인가"가 안 드러난다.
    // 그 우선순위 하나만 준다. 배급 줄이니 곪은 상처니는 AI가 알아서 그린다.
    { id: 'famine', when: 'food <= 0',
      text: '[PRIORITY] The granary is empty and people go hungry today. This is the center of the scene, not background.' },
    { id: 'thirst', when: 'water <= 0',
      text: '[PRIORITY] There is no drinking water. Thirst outruns hunger; this outranks everything else today.' },
    // ③ 모델의 성향을 거스르는 줄. 곳간이 비어 가면 모델은 누군가를 보내려 든다 — 그건 ISOLATION이 막는다.
    // 막기만 하고 대안을 안 주면 모델은 장면을 체념으로 끝낸다. 무엇이 허용되는지 여기서 말한다.
    // 하드 프리셋이 이 상태로 시작하므로 첫 턴부터 이 줄이 붙는다.
    { id: 'starving_soon', when: 'food > 0 and food_days <= 5',
      text: '[HUNGER] {food_days} days of food left and the fields do not cover what is eaten. Nothing is coming from '
        + 'outside. What is left is the ground itself — the river, the woods, roots, snares, whatever the folk of a '
        + 'hungry country already know how to eat. That is work, not luck: it costs hands, it takes days, and someone '
        + 'has to decide who goes. A place that actually starts feeding people is a new entry in the farmland list.' },

    // ── 모델의 기본 성향을 거스르는 것 ──
    { id: 'phase_survive', when: 'phase == "연명"',
      text: '[TONE] Still bare survival. Do not speak of rebuilding or prosperity — getting through today is the whole of it.' },
    { id: 'morale_good', when: 'morale >= 60 and food_days > 10',
      text: '[TONE] Things are genuinely good right now. Do not render it stingily — good days are rare here.' },

    // ── 시스템만 아는 사실 ──
    { id: 'disaster_on', when: 'disaster_days > 0',
      text: '[ONGOING] {disaster} — {disaster_days} more days to run. Do not write it as resolved before it ends.' },
    // 축일이 뭐 하는 날인지는 어디에도 없다. {fest_desc}가 그걸 나른다.
    { id: 'fest_today', when: 'fest_in == 0',
      text: '[TODAY — {fest}] {fest_desc} Build the scene around this day. If the holding is in a bad way, it is observed badly.' },
    { id: 'fest_soon', when: 'fest_in >= 1 and fest_in <= 10',
      text: '[UPCOMING] {fest_when} is {fest} — {fest_in} days out. {fest_desc}' },
    // 세납액은 시스템이 계산한다. 모델은 이 숫자를 알 방법이 없다.
    { id: 'tribute_due', when: 'fest == "세납일" and fest_in <= 12',
      text: '[TRIBUTE] Tribute day is {fest_in} days off. {tribute} is owed; the treasury holds {gold}.' },
    { id: 'appt_due', when: 'appt != "" and appt_in <= 0',
      text: '[SCHEDULED] Today was set aside for this — {appt}. If it is put off, show why.' },
    { id: 'appt_near', when: 'appt != "" and appt_in >= 1 and appt_in <= 3',
      text: '[SCHEDULED] {appt_in} days out — {appt}.' },

    // ── 탐사 ──
    // 시스템만 아는 사실이다 — 척후가 어디까지 훑었는지는 서사 어디에도 안 적혀 있다.
    { id: 'scouting_on', when: 'explore_dir != "없음"',
      text: '[SCOUTING] Scouts are working {explore_dir} — {scouting} of the ground covered. '
        + 'What they bring back is fragments, not answers: a track, a smell on the wind, a shape seen at distance. '
        + 'Do not let them find the thing itself until the system says they have.' },
    { id: 'scouting_close', when: 'explore_dir != "없음" and (exp_n >= 80 or exp_w >= 80 or exp_s >= 80 or exp_e >= 80)',
      text: '[SCOUTING] They are close to whatever is out there. The fragments are starting to line up.' },

    // ── 길 ──
    // 시스템만 아는 사실이다: 어느 길이 며칠째 막혀 있는지는 서사 어디에도 안 적혀 있다.
    { id: 'route_shut', when: 'route != "없음"',
      text: '[ROUTE CLOSED] {route} has been impassable and is expected to stay shut about {route_days} more days. '
        + 'Nothing moves along it in either direction — no cart, no envoy, no letter. Standing trade on that road pays '
        + 'a fraction meanwhile ({deals_net} against {deals} a day). Whoever insists on travelling it takes a real risk. '
        + 'It can be opened early by doing something about the cause, not by waiting.' },

    // ── 고용 ──
    // 시스템만 아는 숫자다. 이 줄이 없으면 모델은 메이드가 그냥 걸어 들어오게 쓴다.
    { id: 'hire_ready', when: `gold >= fee_J`,
      text: '[RECRUITMENT] The treasury could cover a request to the Academy now — {hire_txt} in gold, and at this '
        + 'reputation they will release {hire_open}. Only the named graduates exist; the Corps does not send nameless '
        + 'girls, and nobody arrives until the Baron actually sends the request and the fee. '
        + 'The Sisterhood works the same way but calls the fee a donation.' },
    // 급료가 밀리는 건 시스템만 아는 사실이다. 그리고 이 사람들은 갈 데가 있다.
    { id: 'wages_unpaid', when: 'gold <= 0 and count(corps) > 0',
      text: '[UNPAID] The treasury is empty and {payroll} a day in wages is owed to trained professionals with '
        + 'somewhere else to go. They do not walk out on the first missed day. They notice, and they talk to each other.' },
    { id: 'hire_locked', when: `gold < fee_J and fame < 25`,
      text: '[RECRUITMENT] Neither the Academy nor the Cathedral would send anyone here yet — no name to speak of and '
        + 'nothing in the treasury. A junior would cost about {fee_J}. Anyone who serves at Veridia right now serves for '
        + 'reasons of their own.' },

    // ── 수입 ──
    // 시스템만 아는 사실이다. 곳간이 아직 차 있어서 서사가 위기를 못 알아본다.
    { id: 'supply_cut', when: 'route != "없음" and count(supply) > 0',
      text: '[SUPPLY CUT] The road is shut, so the standing deliveries have stopped — nothing is arriving. '
        + 'The granary is still what it was this morning; the shortfall shows up over the days ahead, not today. '
        + 'People who are used to the carts coming will notice before the figures do.' },

    // ── 거처 ──
    // 수용 한계는 시스템만 아는 숫자다. 이 줄이 없으면 모델은 사람이 계속 흘러드는 것처럼 쓴다.
    { id: 'housing_full', when: 'pop >= cap',
      text: '[HOUSING] Every roof is taken — {pop} people to {cap} places. Nobody new stays, whatever draws them here. '
        + 'The crowding is a daily fact: shared floors, short tempers, sickness moving fast. Building more is the only way out.' },

    // ── 바깥 ──
    // 모델의 제일 센 버릇을 거스르는 줄이다. 곤경에 빠뜨려 두면 모델은 누군가를 보낸다 —
    // 지나가던 상단, 소식을 들은 수도원, 마침 근처였던 기사. 그런 게 올 수 없는 땅이라는 걸
    // 로어북은 첫 턴에나 말해 주고 만다. 이건 조건이 풀릴 때까지 매 턴 말한다.
    { id: 'unknown_land', when: 'rel_top < 25',
      text: '[ISOLATION] No neighbouring domain has any reason to look here — {neighbors}. '
        + 'Nothing arrives by chance: no caravan takes this road, no envoy, no relief. '
        + 'Whoever appears was sent for, is lost, is fleeing, or wants something. Never solve a shortage with a passing stranger.' },
    { id: 'known_land', when: 'rel_top >= 25',
      text: '[OUTSIDE] Veridia is on other maps now — {neighbors}. '
        + 'Attention runs both ways: it brings offers, and it brings people who come to assess what is here.' },

    // ── 메타 ──
    // 통지 하나하나에 "이건 네가 정해라"를 적는 대신 규칙으로 한 번에 준다.
    // 이게 없으면 폭풍이 늘 지붕을 날리고, 수로를 지은 영지에서도 수로가 안 넘친다.
    // 탐사 발견에는 이 원칙을 적용해 놓고 랜덤 사건에는 빠뜨렸던 걸 메우는 줄이다.
    { id: 'event_detail', when: 'day >= 0',
      text: '[EVENT DETAIL] A system notice fixes only two things: what kind of thing happened, and what it already '
        + 'cost in figures. Everything else is yours — which building, which field, whose door, what it looked like '
        + 'and who saw it. Choose from what this holding actually has: the infra, houses, farms, sites and people '
        + 'listed above. Never damage or invoke something that has never been built here. If a channel was dug, a '
        + 'storm can burst it; if there is no channel, the same storm has to find something else to ruin.' },

    // ── 메타: 이건 규칙이라 성향과 무관하게 매 턴 필요하다 ──
    { id: 'no_numbers', when: 'day >= 0',
      text: '[WRITING RULE] The figures above are your basis for judgment only. Never transcribe numbers or tables into the prose. '
        + 'Not "food 781" but "the granary will hold two months" — render them as something a person would feel. '
        + 'Never write against the figures: no feasting while they starve, no one following gladly when morale is on the floor.' },
  ],
  actions: [],

  // ── AI 관할과 그 상한 ──
  // 상한이 없으면 "왕가에서 지원이 왔다"로 식량 5만을 만들어 낸다.
  // 있으면 서사는 자유롭게 두면서 숫자만 현실에 묶인다.
  updater: {
    model: 'aux',
    allow: [
      { id: 'time' }, { id: 'weather' },   // 날짜·계절은 이제 파생이라 손댈 수 없다
      { id: 'location' }, { id: 'disaster' }, { id: 'focus' }, { id: 'alert' },
      { id: 'stock' }, { id: 'corps' }, { id: 'houses' }, { id: 'infra' }, { id: 'farms' }, { id: 'sites' },
      { id: 'staff' }, { id: 'contacts' },
      // 이웃의 인식. 거리가 있으니 하루에 크게 움직일 수 없다 — 상한이 그걸 대신 지킨다.
      ...NEIGH.map(([id]) => ({ id, maxDelta: 8 })),
      { id: 'ally' }, { id: 'ally_role' },
      // 인물 호감도. 사람 마음은 하루에 크게 안 움직인다.
      // ⚠ mentions — 이번 턴 글에 그 사람 이름이 나왔을 때만 연다(label이 곧 이름이라 true면 된다).
      //   스물여섯을 늘 열어 두면 보조 모델이 그걸 전부 "건드려도 되는 것"으로 읽는다.
      //   나오지도 않은 사람의 호감도가 분위기상 ±1씩 밀리는 게 이 봇에서 제일 조용한 사고였다 —
      //   상한은 크기를 막지 빈도를 못 막는다. 아예 안 보여 주는 게 유일한 방법이다.
      ...CAST_ALL.map(([id]) => ({ id: 'b_' + id, maxDelta: 8, mentions: true })),
      { id: 'appt' }, { id: 'appt_in' }, { id: 'contracts' }, { id: 'supply' },
      // contracts를 AI에게 열어 둔 이유 — 위험한 건 "AI가 등록하는 것"이 아니라
      // "AI가 짐작해서 등록하는 것"이다. 이 둘은 전혀 다르다.
      //   짐작  "상단과 이야기를 나눴다" → 계약을 지어냄            ← 막아야 한다
      //   전사  유저가 "매일 12골드씩 60일"이라 씀 → 옮겨 적음      ← 이건 받아쓰기다
      // guide의 STANDING INCOME 항목이 "숫자가 명시됐을 때만"으로 그 선을 긋는다.
      // 그래도 틀리면 /계약- 이나 패널 ✕로 뺀다 — 목록이라 눈에 보이는 게 이 설계의 이점이다.
      { id: 'labor_policy' }, { id: 'disaster_days', maxDelta: 14 }, { id: 'days_passed' },
      { id: 'route' }, { id: 'route_days', maxDelta: 40 },
      { id: 'stance' }, { id: 'exposed', maxDelta: 15 },   // 유저가 배분을 지시하면 반영
      // 방향은 열어 둔다. 계약과 달리 틀려도 복리로 어긋나지 않는다 —
      // 잘못 가리키면 척후 몇 턴을 버리는 게 전부고, 다음 턴에 고치면 그만이다.
      { id: 'explore_dir' },
      { id: 'food', maxGain: 400, maxLoss: 300 },   // 거래·약탈·구호·화재
      { id: 'water', maxGain: 300, maxLoss: 200 },
      // ⚠ 금화만 상한이 비대칭이다. 정예 메이드 몸값이 6800인데 손실 상한이 500이면
      //   보조 모델이 고용비를 못 뺀다 — 사람은 왔는데 금고는 그대로인 상태가 된다. 세납도 같은 문제였다.
      //   느슨하게 풀어도 되는 쪽은 손실이다: min 0이 바닥을 받치고, 다 털려도 다시 벌면 된다.
      //   반대로 수입은 조여야 한다. 지어낸 횡재 한 번이면 경제가 영구히 망가진다.
      { id: 'gold', maxGain: 500, maxLoss: 7000 },
      { id: 'pop', maxDelta: 20 },                  // 사건으로 죽거나 흘러드는 정도
      { id: 'army', maxDelta: 30 },
      { id: 'wells', maxDelta: 1 },
      { id: 'health', maxDelta: 12 }, { id: 'morale', maxDelta: 15 },
      { id: 'unrest', maxDelta: 20 }, { id: 'threat', maxDelta: 20 },
      { id: 'fame', maxDelta: 10 },
    ],
    // 이 문장은 보조 모델 호출마다 **무조건** 나간다 — 조건부인 지시문보다 더 자주 든다.
    // 그래서 여기가 영어화 이득이 제일 크다. 유저는 이 글을 볼 일이 없다.
    guide: 'Adjust figures only by what actually happened in the narration. Daily consumption, harvest and population '
      + 'change are already settled by the system — never touch them. You change only what the story created as an '
      + 'exception: trade, raids, relief, accidents, consequences. If nothing happened, change nothing.\n'
      + 'TIME: if the narration skipped more than a day, put the number of days in days_passed (three days later = 3, '
      + 'next week = 7; leave it alone for a single day). Consumption and harvest settle for that whole span and the '
      + 'date and season advance with it — the date is not yours to write. Do not skip past a feast day or a scheduled '
      + 'appointment; pass through it as a scene.\n'
      + 'WEATHER: pick only what fits the season (no heat wave in winter).\n'
      + 'DISASTER: fill disaster only when a new one begins, and put its duration in disaster_days — the system clears it.\n'
      + 'ROADS: route is whichever road is shut. Set it back to "없음" the moment the narration clears it — bandits '
      + 'driven off, a thaw, another ford found — it does not have to run its term, and clearing it early is the '
      + 'point. Never shut a road yourself; only a system notice does that.\n'
      + 'APPOINTMENTS: when something is set to happen, write one line in appt and how many days off in appt_in '
      + '(tomorrow = 1). The system counts it down and deletes it once past.\n'
      + 'IMPORTS: supply is for goods arriving on a standing arrangement, one line each, beginning with 식량 or 식수 '
      + 'and ending with the amount per day. The system pays for it automatically, so never also write the cost as a '
      + 'contract — that charges twice. A delivery that happens once moves food or gold directly and goes in no list. '
      + 'While a road is shut the deliveries stop on their own; do not remove the lines for it.\n'
      + 'STANDING INCOME: register a standing item ONLY when BOTH are true — the narration or the user names an '
      + 'explicit recurring amount ("12 gold a day", "for sixty days"), AND the arrangement is actually concluded in '
      + 'this turn. An offer, a proposal, or terms still being haggled over is NOT a contract even when it names a '
      + 'number: "the merchant offered twelve a day" registers nothing; "the baron set his seal to it" does. '
      + 'Never infer one from vague talk. A wrong entry compounds every single day afterwards. When it does qualify, add one line to '
      + 'contracts as "name +perDay" — the number MUST come last with no unit after it ("+12", never "+12G"). '
      + 'For a fixed term add "@+days" (a year is 360 days); the system dates it and drops it when due. '
      + 'Touch gold directly only for money that changed hands once (a sale, a raid, a grant). '
      + 'Never add a deal already listed — check the current contents shown above.\n'
      + 'HIRING: fifteen women can be brought here — twelve maids of the Corps and three sisters. All of them start at '
      + 'the Academy and the Cathedral; none of them is here. Bishop Beatrix is NOT one of them and can never be hired '
      + 'at any price; she visits and she judges. '
      + 'One joins corps ONLY when the narration shows the request sent, the fee paid and the arrival made; a request '
      + 'in progress puts nothing in the list. On arrival do three things together: add "Name wage" to corps taking '
      + 'the wage for her rank from the figures above, subtract the one-off fee from gold, and give her a small first '
      + 'regard. Never invent a maid or a sister who is not on the roster, and never let one turn up unpaid for. '
      + 'If one leaves, remove her line — the wage stops with her.\n'
      + 'PEOPLE: in staff write only "Name · role" — never appearance or personality, and spell names exactly as the '
      + 'narration spells them (to remove someone the string must match character for character). '
      + 'contacts is the same format but for parties OUTSIDE the holding, added on the first real dealing. '
      + 'Before adding, read the current contents: one party gets one entry, never a second spelling of it.\n'
      + 'SUCCESSION: the three claimants rise and fall on their own — never touch pw_*. stance is whom the Baron '
      + 'backs, and it changes only when he actually commits: a letter sent, levies promised, a word given before '
      + 'witnesses. Wondering aloud is not backing, and neither is being asked. exposed moves by itself too; touch it '
      + 'only when the narration deliberately announces the allegiance or deliberately buries it.\n'
      + 'REGARD: b_* is how one named person feels about the Baron personally — 0 means nothing has passed between '
      + 'them yet, and it goes negative when they are on bad terms. Move one ONLY when that person actually appeared '
      + 'in this turn and something passed between them; a single polite remark is not worth 20. Meeting someone for '
      + 'the first time is a small number, not a large one. This is separate from rel_*: a countess can respect what '
      + 'Veridia is becoming while disliking its lord, and the reverse.\n'
      + 'NEIGHBOURS: rel_* is how much each neighbouring domain knows and thinks of Veridia, 0 meaning they have never '
      + 'heard of it. Move it only when contact actually reached them — an envoy arrived, a caravan stopped, word '
      + 'carried back. Setting out is not arriving: the travel days shown beside each name are the delay, both ways. '
      + 'One domain hearing something does not inform the others.\n'
      + 'SCOUTS: set explore_dir when the narration sends the scouts somewhere, "없음" when they are pulled back. '
      + 'The system tracks how much ground is covered and announces WHEN something is found and of what kind — '
      + 'it never decides what the thing is. Add nothing from exploration unless a [탐사] notice appeared this turn.\n'
      + 'DISCOVERIES: when a [탐사] notice did appear, the narration names the thing. Copy that name — one short '
      + 'line, the words the narration used — into the list it belongs to (see BUILDING). A found threat is not a '
      + 'place you own: put it in stock as a location note ("고블린 둥지 위치도") and raise threat. Nothing else '
      + 'moves unless the narration says work has begun. If the narration named nothing concrete, add nothing — '
      + 'do not invent a name to fill the slot.\n'
      + 'BUILDING: five separate lists, and the split is fixed. houses = anywhere people sleep, number last = how '
      + 'many it holds. farms = ground that FEEDS (fields, orchards, pasture, fishing water, mushroom caves), '
      + 'number last = how much farmland quality it adds, 1 for a cleared plot and 4 for a whole valley. '
      + 'sites = places that yield goods to SELL (mines, quarries, salt, clay), number last = gold per day, and 0 '
      + 'while it is merely known about rather than worked. infra = everything else that keeps the place running '
      + '(water works, baths, chapel, forge, walls, roads, storage), name only with no number. stock = goods in '
      + 'store, not places. A farm or a site written without a trailing number counts as zero and the work vanishes '
      + '— always write the number. Add an entry only when the narration says the thing exists or is finished, '
      + 'never when it is merely planned.',
  },

  promptState: {
    // 경과일을 내보내는 이유: 기한부 계약의 "@끝나는날"을 AI가 계산하려면 지금 며칠째인지 알아야 한다
    template: '[베리디아 남작령 — {date} {time} · {season} {weather} · {location} · 경과일 {day}]\n'
      + '다음 축일 {fest_when} {fest} (D-{fest_in}) | 예정 {appt_txt}\n'
      + '국면 {phase} | 주민 {pop} (가용 노동력 {able}, 배분 {labor_policy} → 경작 {farm_men}·건설 {build_men}·경비 {guard_men}·탐사 {scout_men})\n'
      + '식량 {food} ({food_txt}, 수지 {surplus}/일) | 식수 {water} ({water_txt}, 수지 {water_bal}/일)\n'
      + '재정 {gold} ({gold_txt}, 수지 {net_gold}/일 — 세 {tax}·판매 {sold}·계약 {deals} vs 지출 {upkeep})\n'
      + '지속 수입 {contracts} | 길 {route_txt}\n'
      + '수입 {supply} (식량 +{sup_food}·식수 +{sup_water}, 대금 {import_cost}/일)\n'
      + '사기 {morale_txt} | 보건 {health_txt} | 군사 {army_txt} | 외부보안 {sec_out_txt} | 내부보안 {sec_in_txt} | 명성 {fame_txt}\n'
      + '탐사 {explore_dir} ({scouting}) · 영토 파악 {survey} — 북 {found_n} · 서 {found_w} · 남 {found_s} · 동 {found_e}\n'
      + '계승 {court_txt}\n'
      + '이웃 {neighbors}\n'
      + '동행 {ally}({ally_role}, 유대 {bond_txt})\n'
      + '군단·수녀 {corps} (봉급 {payroll}/일) | 현지 고용인 {staff}\n'
      + '호감 왕가·동행 {bond0} | 귀족 {bond1} | 광휘회 {bond2} | 메이드 {bond3}\n'
      + '아는 사람 {contacts}\n'
      + '주거 {houses} — 주민 {pop}/{cap} ({crowd_txt})\n'
      + '경작지 {farms} ({farm_txt}) | 자원지 {sites} (산출 {extract}/일)\n'
      + '인프라 {infra} | 물자 {stock}\n'
      + '목표 {focus}{disaster}{alert}',
    includeEvents: true,
  },
  statusUI: { mode: 'template', collapsible: false, templates: [] },
  // ── 시작 프리셋 ──
  // 새 채팅에서 한 번 누르는 버튼. 수식은 못 쓰고 값만 쓴다. 안 적은 변수는 스키마 시작값 그대로 간다.
  //
  // 두 판을 가르는 축은 셋이고, 셋을 **함께** 민다 (한 축만 반토막 내면 어려워지는 게 아니라 판이 짧아진다).
  //   ① 비축 — 곳간에 며칠치가 있나            보통 14일치 / 하드 3일치
  //   ② 국면 — 땅과 사람이 어떤 상태로 남았나   보통 밭이 살아 있고 우물이 하나 / 하드 밭 전멸·우물 오염·집 절반이 탐
  //   ③ 시련 — 나쁜 일의 문턱                   보통 35 / 하드 85 (위 thr)
  //
  // ⚠ 하드의 arable이 0인 건 실수가 아니라 이 판의 전부다.
  //   계산상 밭 없이는 어떤 인구도 자급이 안 된다(적성 5 언저리가 손익분기). 즉 하드의 첫 수는
  //   "아껴 쓴다"가 아니라 "먹을 자리를 새로 만든다"뿐이고, 그걸 못 하면 반드시 무너진다.
  //   그래서 focus와 alert가 그쪽을 가리키고, starving_soon 지시문이 허용된 길을 알려 준다.
  setup: {
    // ── 난이도 3종 (유저 확정, 2026-08-15) ──
    // 희망적 = 하렘 즐기기용 (영지는 배경) / 보통 = 일반적으로 어려움 / 리얼리티 = 랜디식 혈전.
    // 갈리는 축: hardship(사건 창 + 발동 확률 식) · hire_mult(몸값) · fame(고용 문턱) · 개막 자원.
    // ⚠ 프리셋끼리 갈리는 축은 하나도 생략하지 않는다 — 기본값에 기대면 나중에 스키마 시작값을
    //   손대는 순간 사다리가 조용히 뒤집힌다. 같은 값이어도 세 곳 모두에 적어 둔다.
    presets: [
      {
        id: 'hope',
        label: '🌸 희망적 — 좋은 시절',
        // 영지가 저절로 크진 않지만 저절로 죽지도 않는다. fame 26 — 중급 메이드 문턱(25)이
        // 처음부터 열려 있고 몸값은 6할. 사건은 4.4%/턴, 순풍급(settlers·patron) 창이 제일 넓다.
        set: {
          pop: 120, houses: ['성한 오두막 100', '성채 별채 40'],
          food: 2600, water: 2200, gold: 800,
          health: 42, morale: 52, unrest: 6, threat: 18,
          farms: ['살아있는 밭 5', '개울가 채마밭 2'],   // 적성 7 — 곳간이 저절로 마르진 않는다
          wells: 2,
          infra: ['낡은 병영', '연병장', '대장간', '마을 우물', '돌다리'],
          stock: ['목재 150', '보리 씨 40'],
          route: '없음', route_days: 0, rel_cap: 20, fame: 26,
          hardship: 10, hire_mult: 60,
          focus: '좋은 사람들을 곁에 모으는 것',
        },
      },
      {
        id: 'normal',
        label: '🌾 보통 — 그래도 사람이 산다',
        set: {
          pop: 110, houses: ['남은 오두막 90', '성채 헛간 30'],
          food: 1600, water: 1500, gold: 120,          // 열나흘치. 봄엔 축나고 가을에 메운다
          health: 28, morale: 35, unrest: 12, threat: 34,
          farms: ['묵은 밭 4', '개울가 채마밭 1'],      // 적성 5 — 작지만 살아는 있다
          wells: 1,                                     // 쓸 만한 우물 하나. 이게 곧 식수 자립이다
          infra: ['무너진 병영', '잡초 연병장', '폐허 대장간', '마을 우물'],
          stock: ['목재 100', '보리 씨 20'],
          route: '없음', route_days: 0, rel_cap: 10, fame: 0,
          hardship: 45, hire_mult: 100,                // "일반적으로 어려움" — 구 35/80에서 올림
          focus: '겨울이 오기 전에 밭을 늘리는 것',
        },
      },
      {
        id: 'reality',
        label: '🩸 리얼리티 — 랜디의 혈전',
        // 매 인풋이 생사를 가른다 (림월드 랜디랜덤 철인). 구 '절망'의 개막 + hardship 100 —
        // 사건 8%/턴에 혈전급(horde·granary_rot·deserters) 창 최대, 몸값 1.8배.
        set: {
          // 전쟁이 지나간 자리. 사람이 절반으로 줄었고 남은 절반이 굶는다.
          pop: 70, food: 210, water: 210, gold: 0,     // 딱 사흘치
          health: 12, morale: 12, unrest: 30, threat: 80,
          farms: [],                                    // 다 죽었다. 여기서 다시 만들어야 한다
          wells: 0,
          houses: ['성한 오두막 25', '성채 헛간 20'],    // 수용 45에 일흔 — 처음부터 터져 나간다
          infra: ['불탄 병영', '잡초 연병장', '무너진 대장간', '오염된 우물', '메워진 수로'],
          stock: ['그을린 목재 30'],
          // 산길은 몬스터가 내려오는 길이다. 열나흘은 어차피 곳간을 보고 있을 시간이고,
          // 그동안 랜덤 사건이 안 겹치는 게 오히려 낫다 — 길이 열리는 날부터 세상이 때리기 시작한다.
          route: '북 산길', route_days: 14,
          rel_cap: 5, fame: 0,                          // 왕도조차 서류로만 안다
          hardship: 100, hire_mult: 180,
          focus: '사흘 안에 먹을 것을 구하는 것',
          alert: '곳간에 사흘치. 밭은 죽었고 우물은 못 쓴다.',
        },
      },
    ],
    ai: { enabled: false, vars: [] },
  },
};

// ── 상태창: 다이어트판 (리메이크 P2, docs/design-베리디아-리메이크.md) ──
// "오늘 아침 책상 위 한 장" — 매 턴 변하고 매 턴 봐야 하는 것만 남긴다.
// 목록(계약·물자·경작지·인프라)·호감도 26명·계승·주변 영지는 전부 대장 탭(아래 S.party)으로.
// 상태창은 메시지마다 다시 그려지지만 대장은 열었을 때만 그려진다 — 그게 나누는 기준이다.
// 빠진 자리마다 "— 명세는 📖" 같은 길잡이를 남긴다: 어디로 갔는지 화면이 말해야 한다.
const CSS = fs.readFileSync(__P('simcore-save-영지.json'), 'utf8');
const oldCss = JSON.parse(CSS).schema.statusUI.customCSS || '';
S.statusUI.templates = [{
  id: 'estate',
  template: `<style>${oldCss}</style>`
    + '<input type="checkbox" id="sim_status_toggle" class="status-checkbox">'
    + '<label for="sim_status_toggle" class="status-open-label">영지 보고서 확인</label>'
    + '<div class="status-full-overlay"><div class="status-modal-window">'
    + '<label for="sim_status_toggle" class="status-close-label">×</label>'
    + '<div class="status-header"><h1>Veridia Ledger</h1><small>베리디아 남작령 종합 행정 보고서</small></div>'
    + '<div class="status-grid">'
    + '<div class="status-section-title">연대기 및 환경</div>'
    + '<div class="status-entry"><span>연도:</span> <span class="val">{date}</span></div>'
    + '<div class="status-entry"><span>시각:</span> <span class="val">{time}</span></div>'
    + '<div class="status-entry"><span>계절:</span> <span class="val">{season}</span></div>'
    + '<div class="status-entry"><span>날씨:</span> <span class="val">{weather}</span></div>'
    + '<div class="status-entry"><span>위치:</span> <span class="val">{location}</span></div>'
    + '<div class="status-entry"><span>재해:</span> <span class="val">{disaster}</span></div>'
    + '<div class="status-entry status-span2"><span>난이도:</span> <span class="val">{diff_txt}</span></div>'
    + '<div class="status-section-title">🧭 답사</div>'
    + '<div class="status-entry status-span2"><span>척후:</span> '
    + '<span class="val">{explore_dir} ({scouting}) — 영토 파악 {survey}, 지도는 🗺️</span></div>'
    + '<div class="status-section-title">달력</div>'
    + '<div class="status-entry"><span>다음 축일:</span> <span class="val">{fest} ({fest_when}, D-{fest_in})</span></div>'
    + '<div class="status-entry"><span>예정:</span> <span class="val">{appt_txt}</span></div>'
    + '<div class="status-section-title">인구 및 노동</div>'
    + '<div class="status-entry"><span>주민:</span> <span class="val">{pop} / 수용 {cap}</span></div>'
    + '<div class="status-entry"><span>거처:</span> <span class="val">{crowd_txt} ({crowd}%)</span></div>'
    + '<div class="status-entry"><span>국면:</span> <span class="val">{phase}</span></div>'
    + '<div class="status-entry"><span>가용 노동력:</span> <span class="val">{able}</span></div>'
    + '<div class="status-entry"><span>배분:</span> <span class="val">{labor_policy}</span></div>'
    + '<div class="status-entry status-span2"><span>경작/건설/경비/탐사:</span> '
    + '<span class="val">{farm_men} · {build_men} · {guard_men} · {scout_men}</span></div>'
    + '<div class="status-section-title">재정 및 경제 지표</div>'
    + '<div class="status-entry"><span>명성:</span> <span class="val">{fame_txt}</span></div>'
    + '<div class="status-entry"><span>재정:</span> <span class="val">{gold} ({gold_txt})</span></div>'
    + '<div class="status-entry"><span>일 수입:</span> <span class="val">{income} / 지출 {upkeep} (봉급 {payroll})</span></div>'
    + '<div class="status-entry"><span>재정 수지:</span> <span class="val">{net_gold}/일</span></div>'
    + '<div class="status-entry status-span2"><span>통행:</span> <span class="val">{route_txt}</span></div>'
    + '<div class="status-entry status-span2"><span>정기 유입:</span> '
    + '<span class="val">식량 +{sup_food} · 식수 +{sup_water} · 계약 +{deals}/일 — 명세는 📖</span></div>'
    + '<div class="status-entry"><span>식량:</span> <span class="val">{food} ({food_txt})</span></div>'
    + '<div class="status-entry"><span>식수:</span> <span class="val">{water} ({water_txt})</span></div>'
    + '<div class="status-entry"><span>일 수확:</span> <span class="val">{harvest} (+수입 {sup_food}) / 소비 {eaten}</span></div>'
    + '<div class="status-entry"><span>식량 수지:</span> <span class="val">{surplus}/일</span></div>'
    + '<div class="status-entry status-span2"><span>기반:</span> '
    + '<span class="val">경작 {farm_txt} · 자원 산출 {extract}/일 · 식수원 {wells} — 목록은 📖</span></div>'
    + '<div class="status-section-title">민생 및 보안</div>'
    + '<div class="status-entry"><span>사기:</span> <span class="val">{morale_txt}</span></div>'
    + '<div class="status-entry"><span>보건:</span> <span class="val">{health_txt}</span></div>'
    + '<div class="status-entry"><span>노동력:</span> <span class="val">{labor_txt}</span></div>'
    + '<div class="status-entry"><span>군사:</span> <span class="val">{army_txt}</span></div>'
    + '<div class="status-entry"><span>외부보안:</span> <span class="val">{sec_out_txt}</span></div>'
    + '<div class="status-entry"><span>내부보안:</span> <span class="val">{sec_in_txt}</span></div>'
    + '<div class="status-section-title">👯 곁에 있는 사람</div>'
    + '<div class="status-entry"><span>동행:</span> <span class="val">{ally} ({ally_role})</span></div>'
    + '<div class="status-entry"><span>유대:</span> <span class="val">{bond_txt}</span></div>'
    + '<div class="status-entry status-span2"><span>사람들:</span> '
    + '<span class="val">아는 얼굴 {bond_known} · 군단 봉급 {payroll}/일 — 명부는 📋</span></div>'
    + '<div class="status-section-title">현재 집중 목표</div>'
    + '<div class="status-span2" style="text-align:center; padding:8px; font-weight:bold;">{focus}</div>'
    + '<div class="urgent-box"><strong>⚠️ 긴급 통지</strong>{alert}</div>'
    + '<div class="status-span2" style="text-align:center; padding:4px; opacity:.8; font-size:.9em;">'
    + '자세한 장부는 채팅 우상단 버튼 — 📖 영지 대장 · 📋 인물 명부 · 🗺️ 탐사 지도</div>'
    // 명령 이름은 이 스키마가 정한다 — 유저가 그걸 알 곳이 여기뿐이다.
    // 접혀 있어서 평소엔 한 줄이고, 펴면 무엇을 어떻게 고치는지 나온다.
    + '<div class="status-span2">{commands}</div>'
    + '</div></div></div>',
}];

// ── 대장(臺帳) — 게임 패널 (v0.89 template 탭) ──
// 상태창에서 뺀 참고 정보가 전부 여기 산다. 4면: 영지(재정·물자·기반·달력) / 인물(호감도·
// 명부·시세) / 탐사(지도) / 정세(계승·이웃). 자리표시자는 상태창과 같은 파생을 그대로 쓴다 —
// 새 변수 없음, 화면 재배치일 뿐이다. 인물·탐사는 플로팅 버튼(fab)으로 바로 연다.
const sec = (t) => `<div class="vled-sec">${t}</div>`;
const row = (k, v2) => `<div class="vled-row"><span>${k}</span><span class="v">${v2}</span></div>`;
S.party = {
  label: '영지 대장', icon: '📖',
  css: `
.scg-card { background:#f0e5d1; border:5px solid #4a2c2a; border-radius:4px; color:#3d352a;
  width:min(520px,100%); font-family:'Noto Serif KR','Nanum Myeongjo',serif; }
.scg-title { color:#4a2c2a; border-bottom:2px double #bda27e; padding-bottom:6px; }
.scg-title .scg-x { color:#4a2c2a; }
.scg-title .scg-x:hover { background:#e2d3b6; color:#4a2c2a; }
.scg-note { color:#6b5744; }
.scg-tabs { border-bottom:2px solid #bda27e; }
.scg-tab { color:#6b5744; }
.scg-tab.scg-on { background:#4a2c2a; border-color:#bda27e; color:#f0e5d1; }
.scg-notice { color:#8a3a2a; }
.scg-tpl .vled-h { text-align:center; font-size:16px; font-weight:700; letter-spacing:.18em; margin:2px 0 8px; color:#4a2c2a; }
.scg-tpl .vled-h small { display:block; letter-spacing:0; font-size:11.5px; font-weight:400; color:#6b5744; margin-top:2px; }
.scg-tpl .vled-sec { margin:10px 0 4px; padding:3px 9px; background:#4a2c2a; color:#f0e5d1; font-size:12.5px; font-weight:700; border-radius:3px; }
.scg-tpl .vled-row { display:flex; justify-content:space-between; gap:10px; padding:3px 4px; font-size:13px; border-bottom:1px dashed #d8c6a4; }
.scg-tpl .vled-row .v { font-weight:700; text-align:right; }
.scg-tpl .vled-p { padding:2px 6px; font-size:12.5px; color:#5a4c3a; }
.scg-tpl .sim-tag { border:1px solid #bda27e; background:rgba(74,44,42,.06); color:#3d352a; }
.scg-tpl .sim-empty { color:#8a7a60; }`,
  tabs: [
    { id: 'estate', label: '영지', template: ''
      + '<div class="vled-h">영지 대장<small>{date} · {season}</small></div>'
      + sec('재정 — {gold} ({gold_txt})')
      + row('일 수입 / 지출', '{income} / {upkeep} (봉급 {payroll}) → {net_gold}/일')
      + sec('지속 수입 — +{deals}/일') + '{contracts:tags}'
      + sec('정기 수입 — 식량 +{sup_food} · 식수 +{sup_water} (대금 {import_cost}/일)') + '{supply:tags}'
      + row('통행', '{route_txt}')
      + sec('보유 물자') + '{stock:tags}'
      + sec('주거 — 수용 {cap} ({crowd_txt} {crowd}%)') + '{houses:tags}'
      + sec('경작지 — {farm_txt} · 일 수확 {harvest}') + '{farms:tags}'
      + sec('자원지 — 산출 {extract}/일') + '{sites:tags}'
      + sec('인프라 — 식수원 {wells}') + '{infra:tags}'
      + sec('달력')
      + row('다음 축일', '{fest} ({fest_when}, D-{fest_in})')
      + '<div class="vled-p">{fest_desc}</div>' },
    { id: 'people', label: '인물', fab: '📋', template: ''
      + '<div class="vled-h">인물 명부<small>아는 얼굴 {bond_known}</small></div>'
      + sec('아카데미 · 대성당')
      + '<div class="vled-p">{hire_open} 응한다 — {hire_txt}</div>'
      + sec('군단 · 수녀 — 봉급 {payroll}/일') + '{corps:tags}'
      + sec('호감도')
      + row('왕가 · 동행', '{bond0}') + row('귀족', '{bond1}')
      + row('광휘회', '{bond2}') + row('메이드군단', '{bond3}')
      + sec('현지 고용인') + '{staff:tags}'
      + sec('인맥 · 교역 상대') + '{contacts:tags}' },
    { id: 'survey', label: '탐사', fab: '🗺️', template: ''
      + '<div class="vled-h">탐사 지도<small>영토 파악 {survey} ({finds})</small></div>'
      + row('척후 파견', '{explore_dir} ({scouting}) — 인원 {scout_men}')
      + EXPLORE.map(([d, v2, name, desc]) =>
        sec(`${d.slice(0, 1)} · ${name}`) + `<div class="vled-p">${desc}</div>`
        + row('진행', `{found_${v2.slice(4)}}`)).join('') },
    { id: 'court', label: '정세', template: ''
      + '<div class="vled-h">정세 보고<small>{exposed_txt}</small></div>'
      + sec('왕위 계승 — 선두 {frontrunner}')
      + row('카산드라', '{pw_cass_txt}') + row('오렐리아', '{pw_orel_txt}') + row('릴리아나', '{pw_lili_txt}')
      + row('내 지지', '{stance} ({weight_txt})')
      + sec('주변 영지')
      + NEIGH.map(([id, dir, name, dist]) => row(`${dir} · ${name} (${dist})`, `{${id}_txt}`)).join('') },
  ],
};

const v = validateSchema(S);
console.log('검증:', v.ok ? '통과' : '실패');
for (const e of v.errors) console.log('  ✗', e.path, e.msg);
for (const w of v.warnings) console.log('  ⚠', w.path, w.msg);
if (!v.ok) process.exit(1);

// 굴려 본다 — 시스템이 자동 정산하는 부분만 (AI 없음)
let st = engine.initState(S); st.meta.setupDone = true;
console.log('\n━━ 시스템만으로 12일 (AI 개입 없음) ━━');
for (let i = 0; i < 12; i++) {
  const send = engine.sendPhase(S, st, { rng: seededRng('e', i, 's') });
  st = send.state;
  st = engine.outputPhase(S, st, {}, {}, { rng: seededRng('e', i, 'o') }).state;
  const L = engine.makeLookup(S, st.vars);
  if (i % 3 === 2) {
    console.log(`  ${String(i + 1).padStart(2)}일  주민 ${st.vars.pop}  식량 ${String(st.vars.food).padStart(4)}(${L('surplus')}/일)`
      + `  식수 ${String(st.vars.water).padStart(4)}(${L('water_bal')}/일)  보건 ${L('health_txt')}  사기 ${L('morale_txt')}  [${L('phase')}]`);
  }
}

// ── 달력 검증 ──
// 1) 360일이 정확히 한 바퀴인가  2) 계절이 달과 어긋나지 않는가  3) 축일이 빠짐없이 한 번씩 오는가
const at = (d) => { const t = engine.initState(S); t.vars.day = d; return engine.makeLookup(S, t.vars); };
console.log('\n━━ 달력 ━━');
for (const d of [0, 29, 30, 300, 359, 360, 719, 720]) {
  const L = at(d);
  console.log(`  day ${String(d).padStart(3)} → ${L('date')} ${L('season')}  다음 축일 ${L('fest')} (${L('fest_when')}, D-${L('fest_in')})`);
}
const seen = new Map();
let seasonBad = 0;
for (let d = 0; d < 360; d++) {
  const L = at(d);
  if (L('fest_in') === 0) seen.set(L('fest'), (seen.get(L('fest')) || 0) + 1);
  const m = L('month'), s = L('season');
  const want = (m >= 12 || m <= 2) ? '⛄겨울' : m <= 5 ? '🍀봄' : m <= 8 ? '🌻여름' : '🍂가을';
  if (s !== want) seasonBad++;
}
const sameMD = (a, b) => at(a)('month') === at(b)('month') && at(a)('dom') === at(b)('dom');
console.log(`  1년 = ${sameMD(0, 360) && at(360)('year') === at(0)('year') + 1 ? '✓ 360일 만에 같은 월일, 연도만 +1' : '❗ 어긋남'}`
  + ` · 축일 ${seen.size}/12종이 각 ${[...new Set(seen.values())].join(',')}회 · 계절 불일치 ${seasonBad}일`);

// ── 예정(캘린더 등록) 검증 ──
// ⚠ AI의 숫자는 증감값으로 붙는다 — 진짜 AI가 하듯 outputPhase의 changes로 넣어야 의미 있는 검증이다.
// 등록 → 매일 자동 감소 → 그날 하루 알림 → 다음 턴 자동 삭제
const apptRun = (label, plan) => {
  console.log(`\n━━ 예정 — ${label} ━━`);
  let ct = engine.initState(S); ct.meta.setupDone = true;
  for (let i = 0; i < plan.length; i++) {
    const sp = engine.sendPhase(S, ct, { rng: seededRng('c', i, 's') });
    const L = engine.makeLookup(S, sp.state.vars);
    const fired = (sp.promptBlock.match(/\[예정된 일\][^\n.]*/) || [''])[0];
    console.log(`  ${i}턴  ${L('appt_txt').padEnd(22)} ${fired.slice(0, 40)}`);
    ct = engine.outputPhase(S, sp.state, plan[i] || {}, {}, { rng: seededRng('c', i, 'o') }).state;
  }
};
apptRun('평범하게', [{ appt: '백작의 사자 도착', appt_in: 3 }, null, null, null, null, null]);
apptRun('예정일을 건너뛰어 버림', [{ appt: '백작의 사자 도착', appt_in: 3 }, null, { days_passed: 6 }, null, null]);
apptRun('연달아 두 번 등록', [{ appt: '첫 약속', appt_in: 1 }, null, null, { appt: '둘째 약속', appt_in: 2 }, null, null]);

// ── 지속 수입 검증 ── 등록 → 매일 자동 정산 → 파기
console.log('\n━━ 지속 수입 ━━');
let gt = engine.initState(S); gt.meta.setupDone = true;
const script = [
  [1, null, '계약 없음'],
  [1, { contracts: { add: ['헤세 상단 양모 계약 +12'] } }, '양모 계약 체결 (무기한)'],
  [2, null, '(가만히 둔다)'],
  [1, { contracts: { add: ['제분소 5', '겨울 부역 부담 @14 -4'] } }, '제분소 + 부역(14일까지)'],
  [1, { days_passed: 6 }, '엿새 건너뜀 (하루 아닌 6일이어야)'],
  [2, null, '(가만히 둔다)'],
  [1, null, '기한 당일 — 아직 유효해야'],
  [1, null, '기한 하루 뒤 — 부역이 저절로 빠져야'],
  [1, { contracts: { remove: ['헤세 상단 양모 계약 +12'] } }, '양모 계약 파기'],
  [1, { days_passed: 12 }, '열이틀 건너뜀'],
];
for (const [n, ch, why] of script) {
  for (let k = 0; k < n; k++) {
    const sp = engine.sendPhase(S, gt, { rng: seededRng('g', 0, 's') });
    gt = engine.outputPhase(S, sp.state, k === 0 ? (ch || {}) : {}, {}, { rng: seededRng('g', 0, 'o') }).state;
  }
  const L = engine.makeLookup(S, gt.vars);
  console.log(`  ${String(L('day')).padStart(2)}일  재정 ${String(gt.vars.gold).padStart(4)}`
    + `  계약수입 ${String(L('deals')).padStart(3)}  [${gt.vars.contracts.join(' / ') || '없음'}]`
    + `\n         ← ${why}`);
}

// ── 탐사 검증 ──
console.log('\n━━ 탐사 ━━');
{
  // 속도: 배분에 따라 몇 턴 걸리나
  for (const pol of POLICY.map((p) => p[0])) {
    let t = engine.initState(S); t.meta.setupDone = true;
    t.vars.labor_policy = pol; t.vars.explore_dir = '남 평원';
    const men = engine.makeLookup(S, t.vars)('scout_men');   // 붕괴 전 시작 시점 기준
    let turns = 0;
    while (t.vars.exp_s < 100 && turns < 120) {
      t = engine.outputPhase(S, engine.sendPhase(S, t).state, {}, {}, { rng: seededRng('x', turns, 'o') }).state;
      turns++;
    }
    console.log(`  ${pol}  척후 ${String(men).padStart(2)}명 → 남쪽 답사에 ${turns >= 120 ? '120턴+' : turns + '턴'}`);
  }
  // 첫 자리 분포: 그 방향의 대표 종류가 눈에 띄게 자주 먼저 나오는가
  const NAMES = EXPLORE.find(([d]) => d === '남 평원')[4];
  const tally = {};
  for (let seed = 0; seed < 400; seed++) {
    let t = engine.initState(S); t.meta.setupDone = true;
    t.vars.explore_dir = '남 평원'; t.vars.exp_s = 100;
    t = engine.outputPhase(S, engine.sendPhase(S, t).state, {}, {}, { rng: seededRng('r', seed, 'o') }).state;
    const name = NAMES[t.vars.exp_s - 110] || '(굴림 실패)';
    tally[name] = (tally[name] || 0) + 1;
  }
  console.log('  남쪽 첫 발견 400회:', Object.entries(tally).map(([k, v]) => `${k} ${Math.round(v / 4)}%`).join(' · '));

  // 한 방향을 끝까지 파면 몇 턴이 드는가 — 같은 것이 또 걸리는 회차가 늘어난다
  let t = engine.initState(S); t.meta.setupDone = true;
  t.vars.explore_dir = '남 평원'; t.vars.labor_policy = '개척 우선';
  const marks = [];
  for (let i = 1; i <= 400 && t.vars.f_s < SPOTS; i++) {
    const was = t.vars.f_s;
    t = engine.outputPhase(S, engine.sendPhase(S, t).state, {}, {}, { rng: seededRng('f', i, 'o') }).state;
    if (t.vars.f_s > was) marks.push(`${t.vars.f_s}번째 ${i}턴`);
  }
  console.log('  남쪽 하나만 계속 파기:', marks.join(' · ') || '(못 채움)');
}
{
  // 전체 흐름: 남쪽을 끝내고 동쪽으로 옮긴다
  let t = engine.initState(S); t.meta.setupDone = true;
  t.vars.labor_policy = '개척 우선'; t.vars.explore_dir = '남 평원';
  const log = [];
  for (let i = 0; i < 30; i++) {
    const sp = engine.sendPhase(S, t, { rng: seededRng('f', i, 's') });
    const out = engine.outputPhase(S, sp.state, {}, {}, { rng: seededRng('f', i, 'o') });
    t = out.state;
    for (const n of t.meta.pendingNotifies) log.push(`  ${String(t.vars.day).padStart(2)}일  ${n}`);
    if (t.vars.exp_s >= 110 && t.vars.explore_dir === '남 평원') t.vars.explore_dir = '동 강가';
  }
  console.log(log.join('\n') || '  (30턴 내 발견 없음)');
  const L = engine.makeLookup(S, t.vars);
  console.log(`  30턴 후 — 답사 ${L('survey')} · 남 ${L('found_s')} · 동 ${L('found_e')}`);
  console.log(`  경작 적성 ${engine.makeLookup(S,t.vars)("arable")} · 식수원 ${t.vars.wells} · 외부 위협 ${t.vars.threat}`);
  console.log(`  보유 자원 ${JSON.stringify(t.vars.stock)}`);
  console.log(`  경작지 ${JSON.stringify(t.vars.farms)} · 자원지 ${JSON.stringify(t.vars.sites)}`);
  console.log(`  인프라 ${JSON.stringify(t.vars.infra.slice(4))}`);
}

const send = engine.sendPhase(S, st, { rng: seededRng('e', 99, 's') });
console.log('\n━━ 모델에게 가는 블록 ━━\n' + send.promptBlock.split('\n').slice(0, 6).join('\n'));
console.log('\n프롬프트 길이:', send.promptBlock.length, '자');

const html = renderStatusHtml(S, st);
console.log('상태창 렌더:', html.length, '자 · 미치환 자리표시자:', /\{[a-z_]+\}/.test(html.replace(/<style[\s\S]*?<\/style>/, '')) ? '❗ 있음' : '✓ 없음');

// 대장 탭 — 자리표시자 오타는 검증이 잡지만, 조건 분기 속 미치환은 실렌더로만 보인다
const { renderPanelTemplate } = SC.require('render');
for (const t of S.party.tabs) {
  const ph = renderPanelTemplate(S, st, t.template);
  const left = ph.replace(/<style[\s\S]*?<\/style>/, '').match(/\{[a-z_]+\}/g) || [];
  console.log(`대장 [${t.label}] 렌더:`, ph.length, '자 · 미치환:', left.length ? '❗ ' + left.join(' ') : '✓ 없음');
}

// (산출 파일은 러너 맨 끝에서 신안.json 하나로 저장한다 — 한때 v2 별도 파일을 두다
//  중복임을 발견하고 합쳤다. 리수 적용: 편집기 [JSON] 탭에 그 파일을 통째로 붙여넣고 설치.)

const d = diagnose(S, { turns: 60, runs: 6 });
console.log('\n━━ 진단 ━━');
const sev = { high: '🔴', mid: '🟡', low: '🔵' };
for (const f of d.findings) console.log(` ${sev[f.sev]} [${f.tag}] ${f.text.slice(0, 110)}`);

// ── 프리셋 ──
// 라벨에 '절망'이라고 써 놓고 실제로는 더 오래 사는 판이 흔하다. 이름이 아니라 숫자로 줄을 세운다.
{
  const { evaluate, truthy } = SC.require('expr');
  const PRESETS = ['(기본)', ...S.setup.presets.map((p) => p.id)];
  const stOf = (id) => {
    let t = engine.initState(S); t.meta.setupDone = true;
    if (id !== '(기본)') t = engine.applyPreset(S, t, id).state;
    return t;
  };
  const nameOf = (id) => id === '(기본)' ? '(기본)' : S.setup.presets.find((p) => p.id === id).label;

  console.log('\n━━ 프리셋 — 첫날 ━━');
  for (const id of PRESETS) {
    const t = stOf(id); const L = engine.makeLookup(S, t.vars);
    console.log(`  ${nameOf(id).padEnd(20)} 주민 ${String(t.vars.pop).padStart(3)}/${String(L('cap')).padStart(3)}`
      + `  식량 ${String(t.vars.food).padStart(4)}(${String(L('surplus')).padStart(4)}/일, ${L('food_days')}일치)`
      + `  식수 ${String(t.vars.water).padStart(4)}(${String(L('water_bal')).padStart(4)}/일)`
      + `  적성 ${String(L('arable')).padStart(2)}  위협 ${String(t.vars.threat).padStart(2)}`
      + `  ${L('diff_txt')}`);
  }

  // 방치하면 며칠 만에 곳간이 비는가. AI도 유저도 손을 안 대는 최악의 가정이다.
  // ⚠ 400일을 돌린다. 200일은 3월에서 9월까지라 **겨울을 한 번도 안 겪는다** —
  //   이 판에서 계절 계수는 가을 1.35 / 겨울 0.4로 세 배 넘게 벌어지므로, 200일 표는 늘 실제보다 후하게 나온다.
  console.log('\n━━ 프리셋 — 손 놓고 두면 (겨울을 넘겨 400일) ━━');
  for (const id of PRESETS) {
    let t = stOf(id); const pop0 = t.vars.pop; let empty = null, half = null;
    for (let i = 1; i <= 400; i++) {
      t = engine.outputPhase(S, engine.sendPhase(S, t, { rng: seededRng('p', i, 's') }).state,
        {}, {}, { rng: seededRng('p', i, 'o') }).state;
      if (empty === null && t.vars.food <= 0) empty = i;
      if (half === null && t.vars.pop <= pop0 / 2) half = i;
    }
    const L = engine.makeLookup(S, t.vars);
    console.log(`  ${nameOf(id).padEnd(20)} 곳간이 비는 날 ${(empty === null ? '400일+' : empty + '일').padStart(6)}`
      + ` · 사람이 절반 되는 날 ${(half === null ? '400일+' : half + '일').padStart(6)}`
      + ` · 400일 뒤 주민 ${String(t.vars.pop).padStart(3)} [${L('phase')}]`);
  }

  // ⚠ 위 표만 보면 하드는 그냥 고장 난 판이다. 방치하면 반드시 무너지니까.
  //   문제는 "무너지느냐"가 아니라 **손을 쓰면 빠져나올 수 있느냐**다. 그게 없으면 어려운 게 아니라 못 하는 것이다.
  //   그래서 서사가 실제로 할 법한 일만 넣고 다시 굴린다 —
  //   열흘에 한 번 먹을 자리를 하나 만들고(강 어장·숲 채집터), 모자라면 긁어모은다.
  //   보조 모델 상한 안에서만 움직인다(food maxGain 400).
  //
  // ⚠⚠ 곳간을 0으로 떨어뜨리느냐가 이 판의 전부다. 보건은 곳간이 남아 있는 동안 하루 +1,
  //   비는 순간 하루 -7이다. 그리고 손익분기는 밭이 아니라 보건이 정한다(적성 12여도 보건 0이면 적자).
  //   그래서 "바닥나면 그때 구한다"와 "며칠치를 늘 남겨 둔다"는 같은 노력이 아니라 다른 판이다.
  // ⚠⚠⚠ 그리고 진짜 목줄은 식량이 아니라 **식수**다. 우물이 0이면 취수가 인구의 0.9배뿐이라
  //   무슨 짓을 해도 하루 -10%씩 마른다. 그러면 보건 -7이 영구히 걸리고, 밭을 적성 12까지 채워도 못 이긴다.
  //   우물 하나(수로 하나)를 파는 순간 취수가 인구를 넘어선다 — 하드의 첫 두 수는 '먹을 자리'와 '물자리'다.
  //   식량만 대 주는 판(우물 없이)을 같이 굴려서 그게 진짜 목줄인지 확인한다.
  console.log('\n━━ 프리셋 — 손을 쓰면 (열흘에 밭 하나 + 식량 조달, 360일) ━━');
  for (const [tag, cushion, dig] of [['식량만, 우물은 안 팜 ', 12, false], ['식량 + 우물을 판다', 12, true]]) {
    for (const id of PRESETS) {
      let t = stOf(id); let made = 0, starved = 0, dry = 0, got = 0;
      for (let i = 1; i <= 360; i++) {
        const sp = engine.sendPhase(S, t, { rng: seededRng('q', i, 's') });
        const L = engine.makeLookup(S, sp.state.vars);
        const ch = {};
        if (i % 10 === 0 && sp.state.vars.farms.length < 8) ch.farms = { add: [`개간지 ${++made} 2`] };
        if (L('food_days') <= cushion) {
          ch.food = Math.min(400, Math.max(60, Math.round(0 - L('surplus')) * 10));
          got += ch.food;
        }
        // 우물·수로는 하루에 하나씩만 (updater 상한 maxDelta 1). 물이 모자랄 때만 판다.
        if (dig && L('water_days') <= 20 && sp.state.vars.wells < 2) ch.wells = 1;
        t = engine.outputPhase(S, sp.state, ch, {}, { rng: seededRng('q', i, 'o') }).state;
        if (t.vars.food <= 0) starved++;
        if (t.vars.water <= 0) dry++;
      }
      const L = engine.makeLookup(S, t.vars);
      console.log(`  [${tag}] ${nameOf(id).padEnd(20)} 주민 ${String(t.vars.pop).padStart(3)}`
        + `  적성 ${String(L('arable')).padStart(2)}  수지 ${String(L('surplus')).padStart(5)}/일`
        + `  보건 ${L('health_txt').padEnd(4)} [${L('phase')}]`
        + `  굶은 날 ${String(starved).padStart(3)}  목마른 날 ${String(dry).padStart(3)}  조달 ${got}`);
    }
  }

  // 나쁜 일의 문턱이 실제로 갈리는가 — 첫날 판정만 보면 시드 운이 안 섞인다.
  const BAD = new Set(['road_ice', 'road_snow', 'road_bandit', 'road_wood', 'road_flood', 'raid', 'plague',
    'drought', 'storm', 'hail', 'frost', 'wildfire', 'coldsnap', 'foul_water', 'murrain',
    'goblin_raid', 'harpy', 'orc_scout', 'nest_near', 'leak', 'horde', 'granary_rot', 'deserters']);
  const GOOD = new Set(['bumper', 'wanderer', 'pilgrims', 'windfall', 'sister_visit', 'settlers', 'patron']);
  const kind = (id) => BAD.has(id) ? '나쁨' : GOOD.has(id) ? '좋음' : '중립';

  // 한 해를 열흘 간격으로 훑어 사건 후보를 센다. 계절 조건이 섞이므로 시드 운은 안 들어간다.
  // ⚠ '첫날'만 재면 하드는 좋은 일이 0%로 나오고, 그건 "하드엔 행운이 없다"는 오독을 만든다.
  //   좋은 일의 문턱은 명성·밭·왕도 관계라서 **일어서면 열린다.** 그러니 두 시점을 같이 잰다.
  const composition = (label, t0) => {
    const tally = { 나쁨: 0, 좋음: 0, 중립: 0 };
    const names = new Set();
    for (let d = 0; d < 360; d += 10) {
      const t = engine.clone(t0);
      t.vars.day = d; t.vars.route = '없음'; t.vars.route_days = 0; t.vars.disaster = ''; t.vars.disaster_days = 0;
      const L = engine.makeLookup(S, t.vars);
      for (const ev of S.rules.randomEvents.table) {
        if (ev.when && !truthy(evaluate(ev.when, L, null))) continue;
        tally[kind(ev.id)] += ev.weight ?? 1;
        names.add(ev.id);
      }
    }
    const tot = tally.나쁨 + tally.좋음 + tally.중립 || 1;
    const pc = (n) => String(Math.round(n * 100 / tot)).padStart(2) + '%';
    console.log(`  ${label.padEnd(28)} 나쁨 ${pc(tally.나쁨)} · 좋음 ${pc(tally.좋음)} · 중립 ${pc(tally.중립)}`
      + `   (사건 ${String(names.size).padStart(2)}/${S.rules.randomEvents.table.length}종이 후보)`);
  };
  console.log('\n━━ 프리셋 — 한 해에 무엇이 굴러올 수 있나 (길·재해는 열린 것으로 두고) ━━');
  for (const id of PRESETS) composition(nameOf(id) + ' · 첫날', stOf(id));
  // 일어선 뒤: 위 '식량 + 우물' 판이 도달한 곳 — 밭 여덟, 우물 둘, 명성이 붙고 사람이 돌아온 상태.
  for (const id of PRESETS) {
    const t = stOf(id);
    t.vars.wells = 2; t.vars.fame = 40; t.vars.health = 80; t.vars.morale = 70; t.vars.rel_cap = 30;
    t.vars.farms = ['묵은 밭 4', '개간지 2', '개간지 2', '개간지 2'];
    t.vars.houses = ['장옥 120', '오두막 40'];
    composition(nameOf(id) + ' · 일어선 뒤', t);
  }
}

fs.writeFileSync(__P('영지-변수상태창-신안.json'), JSON.stringify(S, null, 2));
console.log('\n저장: ' + __P('영지-변수상태창-신안.json') + '  (변수 ' + S.vars.length + ' · 파생 ' + S.derived.length + ')');
