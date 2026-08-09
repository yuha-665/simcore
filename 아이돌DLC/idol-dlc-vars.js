const __P = (...p) => require('path').resolve(__dirname, ...p);
// 미소녀 유니버스 — 아이돌 프로듀스 DLC 생성기
//
// 남의 봇에 얹는 DLC다. 원본 봇에는 등장인물이 84명(이미지 규격 기준: 기본 일러만 있는
// 40명 + 의상 변형이 있는 44명) 있고, 그중 **누구로 유닛을 짜도 상관없어야** 한다.
// 프리셋으로는 못 한다 — 프리셋은 "이 사람들로 시작한다"고 못 박는 것이고, 여기서 필요한 건
// "채팅 시작 전에 편성표에서 다섯을 고른다"이기 때문이다. 그래서 **편성표 슬롯의 후보 명단**이다.
//
// ── 설계 한 줄: 능력치는 사람이 아니라 **자리**에 붙는다 ──
//   44명 × 일곱 줄(보컬·댄스·비주얼·체력·멘탈·호감·개별인기)이면 변수가 308개다. 리수가
//   못 버티기도 하지만, 그보다 **한 판에서 실제로 쓰는 건 다섯 명뿐**이라 나머지 300개는
//   영원히 0인 채로 프롬프트 무게만 늘린다. 그래서 자리 다섯에 스탯을 붙이고, 누가 그 자리에
//   앉는지는 슬롯 enum이 정한다.
//   ⚠ 대가: 사람을 바꾸면 그 자리의 숫자를 **이어받는다**. 채팅 시작 전에 유닛을 짜고 그대로
//   가는 이 DLC의 쓰임새에는 맞지만, 중간에 멤버를 갈아 끼우는 봇으로 개조할 때는 이 결정부터
//   다시 봐야 한다.
//
// 나머지(일감 사다리·대관·제작 의뢰·음지·장부·이벤트)는 내장 아이돌 템플릿 v0.82를 그대로
// 쓴다. 여기서 손대는 건 **사람 쪽**뿐이다 — 그래야 본체 템플릿이 나아질 때 같이 나아진다.
const fs = require('fs');
const { TEMPLATES } = require(__P('../core/templates.js'));
const { validateSchema } = require(__P('../core/validate.js'));
const engine = require(__P('../core/engine.js'));
const { seededRng } = require(__P('../core/rng.js'));
const { partyTabs } = require(__P('../core/party.js'));

// ── 명단 ── [한글 표기, 이미지 규격 이름]
//
// 편성표·상태창에 뜨는 건 **한글**이고, 원본 봇의 이미지 태그가 쓰는 건 **영문**이다.
// 화면에 Kurokawa_Akane라고 뜨면 누군지 알아보는 데 한 박자가 걸린다 — 그렇다고 값을
// 한글로만 두면 AI가 `<img="...">`에 뭘 넣어야 할지 모른다. 그래서 **값은 한글, 병기는 파생**:
// 슬롯 값은 한글이고, 아래 NAME_MAP을 뒤집은 파생(id1~id5)이 영문 이름을 프롬프트에 같이 실어
// 보낸다. 초상화를 붙일 때 쓰는 party.portraits도 이 표에서 자동으로 만들어진다.
//
// ⚠ 한글 표기는 **음차**다 — 정식 번역명과 다를 수 있다. 원작 표기가 따로 있으면 여기 왼쪽
//   칸만 고치면 된다(오른쪽 영문은 이미지 규격이라 절대 건드리지 말 것).
//
// 여기 44명은 원본이 **의상 변형까지 가진** 쪽이다 — 무대에 세울 사람들이라 그렇다.
// (기본 일러만 있는 40명은 주변 인물이라 유닛 후보에서 뺐다. 필요하면 아래 표에 더하면 된다.)
const NAME_MAP = [
  ['이이노 미코', 'Iino_Miko'], ['시이나 마히루', 'Shiina_Mahiru'],
  ['코야스 츠바메', 'Koyasu_Tsubame'], ['시라누이 프릴', 'Shiranui_Frill'],
  ['스가야 노와', 'Sugaya_Nowa'], ['이누이 신주', 'Inui_Shinju'],
  ['이누이 사쥬나', 'Inui_Sajuna'], ['키타가와 마린', 'Kitagawa_Marin'],
  ['야마다 료', 'Yamada_Ryo'], ['이지치 니지카', 'Ijichi_Nijika'],
  ['키타 이쿠요', 'Kita_Ikuyo'], ['고토 히토리', 'Gotoh_Hitori'],
  ['코토부키 미나미', 'Kotobuki_Minami'], ['시조 마키', 'Shijo_Maki'],
  ['카시와기 나기사', 'Kashiwagi_Nagisa'], ['스미 유키', 'Sumi_Yuki'],
  ['하야사카 아이', 'Hayasaka_Ai'], ['호시노 아이', 'Hoshino_Ai'],
  ['멤쵸', 'Memcho'], ['쿠로카와 아카네', 'Kurokawa_Akane'],
  ['시로가네 케이', 'Shirogane_Kei'], ['아리마 카나', 'Arima_Kana'],
  ['호시노 루비', 'Hoshino_Ruby'], ['후지와라 치카', 'Fujiwara_Chika'],
  ['시노미야 카구야', 'Shinomiya_Kaguya'], ['니시키기 치사토', 'Nishikigi_Chisato'],
  ['쿠루미', 'Kurumi'], ['이노우에 타키나', 'Inoue_Takina'],
  ['이와시타 시마', 'Iwashita_Shima'], ['시미즈 엘리자', 'Shimizu_Eliza'],
  ['이지치 세이카', 'Ijichi_Seika'], ['히로이 키쿠리', 'Hiroi_Kikuri'],
  ['PA씨', 'PA-san'], ['사이토 미야코', 'Saitou_Miyako'],
  ['호리 쿄코', 'Hori_Kyouko'], ['쿠죠 알리사', 'Alisa_Mikhailovna_Kujou'],
  ['쿠죠 마리야', 'Mariya_Mikhailovna_Kujou'], ['스오우 유키', 'Suou_Yuki'],
  ['사쿠라지마 마이', 'Sakurajima_Mai'], ['나카노 이치카', 'Nakano_Ichika'],
  ['나카노 이츠키', 'Nakano_Itsuki'], ['나카노 요츠바', 'Nakano_Yotsuba'],
  ['나카노 미쿠', 'Nakano_Miku'], ['나카노 니노', 'Nakano_Nino'],
];
const CAST = NAME_MAP.map(([ko]) => ko);
const ASSET = Object.fromEntries(NAME_MAP);
const EMPTY = '빈 자리';
const N = 5;                                   // 자리 다섯 — 센터 하나 + 사이드 넷
const SEAT = ['센터', '사이드 1', '사이드 2', '사이드 3', '사이드 4'];

const S = JSON.parse(JSON.stringify(TEMPLATES.idol.schema));
S.meta = {
  name: '미소녀 유니버스 — 아이돌 프로듀스',
  desc: '누구로 유닛을 짜도 되는 아이돌 프로듀싱 판. 편성표에서 다섯을 고르고 시작한다.',
  author: 'SimCore 템플릿 (아이돌 v0.82 기반)',
};

// ── 1. 사람 쪽 변수 갈아 끼우기 ──
// 내장 템플릿의 유나·세리·린 세 벌(m1_~m3_)과 센터/사이드 둘을 걷어내고 자리 다섯을 세운다.
const isMemberVar = (id) => /^m[1-3]_/.test(id) || ['center', 'side1', 'side2'].includes(id);
const keptVars = S.vars.filter((v) => !isMemberVar(v.id));

// 기본 편성 — **예시일 뿐이고 편성표에서 통째로 갈아 끼운다.**
// 빈 채로 내보내면 임포트 직후 아무것도 안 굴러가고(무대에 설 사람이 없다), 진단도 액션 절반을
// "못 쓰는 액션"으로 신고한다 — 편성은 유저가 팝업에서 하는 것이라 시뮬레이션에서는 영영 빈다.
// 원작에서 실제로 한 유닛인 다섯을 앉혀 뒀다. 임포트하자마자 굴러가고, 바꾸는 건 한 번의 클릭이다.
const DEFAULT_LINEUP = ['호시노 아이', '아리마 카나', '호시노 루비', '멤쵸', '쿠로카와 아카네'];

const slotVars = Array.from({ length: N }, (_, i) => ({
  id: `slot${i + 1}`, label: SEAT[i], type: 'enum', init: DEFAULT_LINEUP[i] ?? EMPTY, enum: [EMPTY, ...CAST],
  desc: i === 0
    ? '가운데 서는 사람. 능력치가 1.3배로 실리고 개별 인기도 그만큼 더 가져간다. 프로듀서가 정하니 서사로 바꾸지 마라.'
    : '무대에 함께 서는 사람. 비워 두면 이번 무대에 안 선다. 프로듀서가 정하니 서사로 바꾸지 마라.',
}));

// 한 자리가 일곱 줄이다. 시작값은 전원 같게 둔다 — 원작 캐릭터마다 능력치를 미리 매겨 두면
// "이 애는 원래 노래를 못한다"를 시스템이 못 박게 되는데, 그건 남의 2차창작에 손대는 짓이다.
// 어떤 애가 무엇을 잘하는지는 레슨과 서사가 정하게 둔다.
// ⚠ 시작 10은 실측으로 고른 값이다. 이 판의 무대 판정은 유닛 종합을 보므로 시작값이
//   곧 초반 성공률이다 (자리 다섯 기준, 아래 나눔값 48로 잰 것):
//     시작  1 → 거리 55% · 지역 라디오 43% · 잡지 37% · 지방 22% · 케이블 8%
//     시작 10 → 거리 70% · 지역 라디오 58% · 잡지 55% · 지방 37% · 케이블 22%
//     시작 25 → 거리 94% · 지역 라디오 83% · 잡지 78% · 지방 63% · 케이블 49%
//   1은 **바닥이 바닥 노릇을 못 한다** — 거리 홍보는 교착 방지용으로 늘 잡히는 일인데
//   절반이 실패하면 그 장치가 무너진다. 25는 사다리 전체가 첫날부터 거의 확정이라
//   자리를 고르는 재미가 없다. 10에서만 "바닥은 되고 위는 도박"이 성립한다.
const STATS = [
  ['vo', '보컬', 10, 100], ['da', '댄스', 10, 100], ['vi', '비주얼', 10, 100],
  ['st', '체력', 70, 100], ['me', '멘탈', 60, 100], ['love', '호감도', 20, 100],
];
const memberVars = [];
for (let i = 1; i <= N; i++) {
  for (const [k, name, init, max] of STATS) {
    memberVars.push({
      id: `m${i}_${k}`, label: `${SEAT[i - 1]} · ${name}`, type: 'int', init, min: 0, max,
      ...(k === 'me' ? { desc: '0이 되면 더 못 선다. 무대가 깎고, 쉬거나 이야기를 나누면 돌아온다.' } : {}),
      ...(k === 'love' ? { desc: '프로듀서를 얼마나 믿는가. 높으면 힘든 날에도 버텨 주고, 음지 설득도 쉬워진다.' } : {}),
    });
  }
  memberVars.push({ id: `m${i}_fan`, label: `${SEAT[i - 1]} · 개별 인기`, type: 'int', init: 200, min: 0, max: 9999999, format: '{v}명' });
}
S.vars = [...keptVars, ...slotVars, ...memberVars];

// ── 2. 파생: 자리 다섯을 보는 식으로 다시 쓴다 ──
// 자리에 스탯이 붙어 있으므로 "이 자리에 사람이 있는가(oK)" 한 줄이면 배수가 나온다.
// 내장 템플릿은 사람 쪽에서 자리를 찾느라 슬롯 이름을 세 번 비교했는데, 여기서는 그럴 일이 없다.
// 만점과 문턱 — 자리가 늘면 천장도 는다. 비율은 내장 템플릿(세 자리 990 → 800/620/450/300/180)과 같다
const MAXPOW = Math.round((1.3 + (N - 1)) * 100 * 3);
const TIERS = [['S', 0.81], ['A', 0.63], ['B', 0.45], ['C', 0.30], ['D', 0.18]];
const cut = (r) => Math.round(MAXPOW * r / 10) * 10;
// ⚠ 낮은 등급부터 감싸야 한다 — 높은 쪽부터 접으면 A 조건이 S보다 먼저 걸려 S가 영영 안 나온다
const RANK_EXPR = [...TIERS].reverse()
  .reduce((acc, [g, r]) => `u_pow >= ${cut(r)} ? '${g}' : (${acc})`, "'E'");

// 한글 값 하나를 영문 이름으로 옮기는 식. 조건이 서로 배타적이라 순서는 상관없다
const assetExpr = (v) => NAME_MAP.reduceRight((acc, [ko, en]) => `${v} == '${ko}' ? '${en}' : (${acc})`, "''");

const memberDerivedIds = new Set(['p1', 'p2', 'p3', 'stand', 'u_vo', 'u_da', 'u_vi',
  'c1', 'c2', 'c3', 'u_cond', 'u_fan', 'u_pow', 'u_love', 'u_rank']);
const keptDerived = S.derived.filter((d) => !memberDerivedIds.has(d.id));
const seq = (f, join = ' + ') => Array.from({ length: N }, (_, i) => f(i + 1)).join(join);

const newDerived = [
  ...Array.from({ length: N }, (_, i) => ({
    id: `o${i + 1}`, label: `${SEAT[i]} 착석`, expr: `slot${i + 1} != '${EMPTY}' ? 1 : 0`,
  })),
  // 센터만 1.3배. 자리에 아무도 없으면 0이라 그 자리 숫자는 어디에도 안 실린다
  ...Array.from({ length: N }, (_, i) => ({
    id: `p${i + 1}`, label: `${SEAT[i]} 배수`, expr: i === 0 ? 'o1 * 1.3' : `o${i + 1}`,
  })),
  // 표기(한글) → 이미지 규격 이름(영문). 화면에는 안 쓰고 **프롬프트에 병기**하는 데만 쓴다 —
  // 원본 봇의 이미지 태그가 영문 이름을 요구하는데, 슬롯 값은 한글이라 그대로는 못 넘긴다.
  // 44갈래 삼항이라 길지만 식은 프롬프트에 안 실린다(값만 실린다). 사람이 읽을 자리가 아니다.
  ...Array.from({ length: N }, (_, i) => ({
    id: `id${i + 1}`, label: `${SEAT[i]} 에셋 이름`, expr: assetExpr(`slot${i + 1}`),
  })),
  { id: 'stand', label: '무대 인원', expr: seq((i) => `o${i}`) },
  { id: 'u_vo', label: '유닛 보컬', expr: `round(${seq((i) => `m${i}_vo * p${i}`)})` },
  { id: 'u_da', label: '유닛 댄스', expr: `round(${seq((i) => `m${i}_da * p${i}`)})` },
  { id: 'u_vi', label: '유닛 비주얼', expr: `round(${seq((i) => `m${i}_vi * p${i}`)})` },
  ...Array.from({ length: N }, (_, i) => ({
    id: `c${i + 1}`, label: `${SEAT[i]} 컨디션`, expr: `round((m${i + 1}_st + m${i + 1}_me) / 2)`,
  })),
  { id: 'u_cond', label: '유닛 컨디션',
    expr: `stand > 0 ? round((${seq((i) => `c${i} * p${i}`)}) / (${seq((i) => `p${i}`)})) : 0` },
  // 빈 자리의 팬은 안 센다 — 앉은 사람 것만 유닛의 것이다
  { id: 'u_fan', label: '유닛 인기도', expr: seq((i) => `m${i}_fan * o${i}`) },
  { id: 'u_pow', label: '유닛 종합', expr: 'u_vo + u_da + u_vi' },
  // ⚠ 랭크 문턱은 **자리 수에 따라 다시 잡아야 한다.** u_pow는 합계라 자리가 늘면 천장도
  //   같이 오른다 (세 자리 990 → 다섯 자리 1290). 내장 템플릿의 숫자를 그대로 쓰면 다섯을
  //   앉히는 순간 시작부터 S등급이 뜬다 — 실제로 밟았다(시작 u_pow 399로 S).
  //   그래서 만점 대비 비율(0.81/0.63/0.45/0.30/0.18)로 다시 만든다.
  { id: 'u_rank', label: '유닛 랭크', expr: RANK_EXPR },
  // 평균 호감 — 앉은 사람들의 평균이다. 빈 자리를 0으로 세면 셋만 세운 유닛이 늘 불리해진다
  { id: 'u_love', label: '평균 호감',
    expr: `stand > 0 ? round((${seq((i) => `m${i}_love * o${i}`)}) / stand) : 0` },
];
// 순서를 지킨다 — 내장 템플릿의 파생은 위에서 아래로 서로를 참조한다(u_pow → u_rank 등).
// 사람 쪽 파생을 통째로 맨 앞에 두면 그 관계가 깨지지 않는다.
S.derived = [...newDerived, ...keptDerived];

// ── 3. 효과 줄 늘리기 ──
// 내장 템플릿은 멤버마다 한 줄씩 세 줄이 한 벌이다(`m1_me` `m2_me` `m3_me`). 자리가 다섯이니
// **m3 줄을 본떠 m4·m5를 만든다**. 문자열을 통째로 뒤지지 않고 m3 줄만 복제하는 이유는,
// 그래야 "세 줄 한 벌"이라는 규약을 지키는 자리만 정확히 늘어나기 때문이다 —
// m1만 나오는 식(예: burnout 조건)은 아래에서 따로 다시 쓴다.
let cloned = 0;
const growEffects = (arr) => {
  if (!Array.isArray(arr)) return arr;
  const out = [];
  for (const f of arr) {
    out.push(f);
    const m = /^m3_(\w+)$/.exec(f.set || '');
    if (!m) continue;
    for (let i = 4; i <= N; i++) {
      out.push({ ...f, set: `m${i}_${m[1]}`, expr: String(f.expr).replace(/\bm3_/g, `m${i}_`).replace(/\bp3\b/g, `p${i}`) });
      cloned++;
    }
  }
  return out;
};
const walk = (node) => {
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.effects)) node.effects = growEffects(node.effects);
  for (const v of Object.values(node)) walk(v);
};
walk(S.checks); walk(S.actions); walk(S.rules);

// 대관 문턱의 u_pow도 같은 자로 다시 잰다 — 내장 템플릿은 세 자리(만점 990) 기준이라
// 다섯을 앉히면 페스티벌부터 전부 첫날에 열린다
for (const [id, ratio] of [['hall_fest', 0.30], ['hall_solo', 0.45], ['hall_tour', 0.63]]) {
  const a = S.actions.find((x) => x.id === id);
  a.when = a.when.replace(/u_pow >= \d+/, `u_pow >= ${cut(ratio)}`);
}

// 무대·라이브 판정의 능력치 항도 자리 수로 다시 잰다 — 내장 템플릿의 `/ 30`은 세 자리
// (만점 990) 기준이라, 다섯을 앉히면 같은 능력치로도 보정이 1.6배가 된다. 그대로 두면
// 사다리 위쪽까지 첫날부터 뚫린다(실측: 시작 25에서 케이블 72%).
{
  const div = Math.round(30 * MAXPOW / 990);
  for (const c of S.checks) {
    if (typeof c.mod === 'string') c.mod = c.mod.replace('(u_vo + u_da + u_vi) / 30', `(u_vo + u_da + u_vi) / ${div}`);
  }
  // 배틀 보정(v_mod)은 파생에 산다 — 판정 mod와 승률 표시가 같은 줄을 읽도록 묶었기 때문.
  // 파생 쪽도 같은 자로 다시 재지 않으면 화면의 승률만 1.6배 기준이 된다 (v0.84)
  for (const d of S.derived) {
    if (typeof d.expr === 'string') d.expr = d.expr.replace('(u_vo + u_da + u_vi) / 30', `(u_vo + u_da + u_vi) / ${div}`);
  }
}

// 번아웃 — 다섯 자리 전부를 본다. 빈 자리는 멘탈이 0이어도 판을 끝내면 안 되므로 착석을 같이 본다
const burnout = S.rules.events.find((e) => e.id === 'burnout');
burnout.when = `not unit_over and (${seq((i) => `(o${i} > 0 and m${i}_me <= 0)`, ' or ')})`;

// ── 4. 편성표 ──
const tabs = S.party.tabs;
const unit = tabs.find((t) => t.id === 'unit');
unit.slots = Array.from({ length: N }, (_, i) => ({ var: `slot${i + 1}`, label: SEAT[i] }));
unit.note = '채팅을 시작하기 전에 다섯을 고른다 — 지금 앉아 있는 다섯은 예시일 뿐이다. '
  + '자리를 비워 두면 그 사람은 무대에 안 선다. '
  + '⚠ 능력치는 사람이 아니라 자리에 붙는다 — 중간에 사람을 바꾸면 그 자리의 숫자를 이어받는다.';
// 레슨 — 자리 다섯 × 세 스탯. 비용식은 내장 템플릿과 같은 모양(자기 레벨을 보고 오른다)
tabs.find((t) => t.id === 'lesson').items = Array.from({ length: N }, (_, i) =>
  ['vo', 'da', 'vi'].map((k, j) => ({
    var: `m${i + 1}_${k}`, label: `${SEAT[i]} · ${['보컬', '댄스', '비주얼'][j]}`, max: 100,
    cost: `round(m${i + 1}_${k} * m${i + 1}_${k} / 25) + 30`,
  }))).flat();
S.party.label = '유닛';
S.party.empty = EMPTY;
// 후보가 44명이라 탭 바로는 안 된다 — 셀렉트+검색으로 고르게 한다
S.party.nav = 'select';
S.party.note = '센터는 능력치가 1.3배로 실리고 개별 인기도 그만큼 더 가져간다. 한 사람은 한 자리에만.';
S.party.unique = true;   // 같은 사람을 두 자리에 앉힐 수 없다
// 초상화 — 편성표 슬롯·후보 칩에 얼굴이 뜬다. 값은 **리수 에셋 이름**(확장자 뺀 파일명)이다.
// 원본 봇의 기본 일러가 `Nakano_Miku.default.avif`이므로 에셋 이름은 `Nakano_Miku.default`.
// ⚠ 봇마다 다르다. 편집기 [편성표] 층 → 🖼 초상 매핑 → [🔎 에셋 이름 불러오기]를 눌러
//   실제 이름을 보고, 다르면 아래 꼬리표만 고쳐서 다시 돌리면 44명이 한 번에 맞춰진다.
//   (44칸을 손으로 채우지 않으려고 여기서 만든다 — 편집기 UI는 몇 명 고칠 때 쓰는 자리다.)
const PORTRAIT_SUFFIX = '.default';
const WITH_PORTRAITS = true;
if (WITH_PORTRAITS) {
  S.party.portraits = Object.fromEntries(NAME_MAP.map(([ko, en]) => [ko, en + PORTRAIT_SUFFIX]));
}

// ── 5. 상태창 ──
// 자리 탭은 **사람이 앉았을 때만** 뜬다. 다섯 칸을 늘 펼쳐 두면 빈 자리 숫자가 화면의 절반이다
const memberPaneLabels = new Set(['유나', '세리', '린']);
S.statusUI.groups = S.statusUI.groups.filter((g) => !memberPaneLabels.has(g.label));
const prod = S.statusUI.groups.find((g) => g.label === '프로덕션');
prod.items = prod.items.filter((it) => !['center', 'side1', 'side2'].includes(it.var));
prod.items.splice(prod.items.findIndex((it) => it.var === 'u_rank'), 0,
  ...Array.from({ length: N }, (_, i) => ({ var: `slot${i + 1}`, showWhen: `o${i + 1} > 0` })));
S.statusUI.groups.push(...Array.from({ length: N }, (_, i) => {
  const k = i + 1;
  return {
    label: `${SEAT[i]}`, showWhen: `o${k} > 0`,
    items: [
      { var: `slot${k}` },
      { var: `m${k}_vo` }, { var: `m${k}_da` }, { var: `m${k}_vi` },
      { var: `m${k}_st`, bar: { max: 100 }, color: `m${k}_st <= 25 ? '#a8443a' : '#6a8a7a'` },
      { var: `c${k}`, bar: { max: 100 }, color: `c${k} <= 30 ? '#a8443a' : '#6a8a7a'` },
      { var: `m${k}_me`, bar: { max: 100 }, color: `m${k}_me <= 20 ? '#a8443a' : '#7a6a9a'` },
      { var: `m${k}_love`, bar: { max: 100 }, color: "'#c86a9a'" },
      { var: `m${k}_fan` },
    ],
  };
}));

// ── 6. 프롬프트 상태 블록 ──
// 이름은 슬롯 값이 그대로 들어간다. 빈 자리는 '빈 자리'로 찍히므로 AI가 헷갈리지 않는다.
// 한글 이름 옆에 이미지 규격 이름을 괄호로 병기한다 — "서사는 한글로, 이미지 태그는 영문으로"를
// 줄 하나가 다 말한다. 이게 없으면 AI가 상태창의 '호시노 아이'로 <img> 이름을 지어낸다.
S.promptState.template = '[프로덕션] {date} ({weekday}) · {rank}등급 · 랭킹 {ranking}위\n'
  + '인지도 {awareness} · 화제성 {buzz} · 팬 {fans} · 누적 판매 {sales}\n'
  + '자금 {funds} · 빚 {debt} · 펑크 {late}회 · 타락도 {corrupt}\n'
  + '이번 달 수입 {income} · 지출 {spend} · 수지 {balance}\n'
  + '업무 {job} (남은 {job_days}일) · 라이브 {live} (남은 {live_days}일)\n'
  + '비너스 배틀 {v_disp} ({v_stage})\n'
  + '의상 {costume} · 음반 {album}\n'
  + `유닛 {u_rank}등급 · 인원 {stand}명 · 컨디션 {u_cond} · 인기도 {u_fan}\n`
  + Array.from({ length: N }, (_, i) => {
    const k = i + 1;
    return `${SEAT[i]} {slot${k}}({id${k}}) — {m${k}_vo}/{m${k}_da}/{m${k}_vi} 컨디션 {c${k}} 호감 {m${k}_love}`;
  }).join('\n');

// ── 7. 보조 AI에게 여는 것 ──
// 편성(누가 어느 자리)은 프로듀서 몫이라 안 연다. 자리 다섯의 멘탈·호감만 연다
S.updater.allow = [
  ...S.updater.allow.filter((a) => !/^m[1-3]_/.test(a.id)),
  ...Array.from({ length: N }, (_, i) => [
    { id: `m${i + 1}_me`, maxDelta: 8 }, { id: `m${i + 1}_love`, maxDelta: 6 },
  ]).flat(),
];
S.updater.guide = S.updater.guide.replace('편성(센터·사이드)은 프로듀서가 정한다.',
  '편성(다섯 자리)은 프로듀서가 정한다 — 슬롯을 건드리지 마라. '
  + '등장인물 이름은 편성표에 앉은 사람만 쓴다.');

// ── 8. 지시문 하나 추가 — 누가 무대에 서는지를 AI가 알아야 한다 ──
S.directives.unshift({
  id: 'lineup', when: 'stand >= 1 and not unit_over',
  text: '[유닛] 지금 이 유닛은 {stand}명이다 — 센터 {slot1}. 편성표에 앉은 사람만 유닛 멤버로 다뤄라. '
    + '앉지 않은 인물은 등장시킬 수 있어도 유닛의 일원으로는 쓰지 마라. '
    + '이미지 태그에는 이름의 괄호 안 영문 표기를 써라 ({slot1} → {id1}).',
});
S.directives.unshift({
  id: 'empty_unit', when: 'stand == 0 and not unit_over',
  text: '[유닛] 아직 유닛이 없다. 편성표(🎤)에서 다섯 자리를 채우기 전까지는 무대 이야기를 시작하지 마라 — '
    + '누구를 모을지 고르는 장면으로 끌어라.',
});

// ── 8.5 세계관 — 봇 설명에 안 적어도 스키마가 직접 전제를 깔아 준다 (v0.84) ──
// 지시문은 "조건이 참인 동안 매 턴 주입"이라 when: '1'이면 상시 로어가 된다.
// 로어북 없이 카드+세이브만 옮겨도 세계의 상식이 함께 간다.
S.directives.push({
  id: 'world', when: '1',
  text: '[세계관] 이 세계에서 아이돌은 모든 여성의 우상이자 권력이고 목표다. 최고의 아이돌로 '
    + '스카우트되는 것은 더없는 영광이며, 소녀들은 정점에 서기 위해서라면 무엇이든 한다. '
    + '유닛 사이의 공인 서열은 비너스 배틀 — 같은 무대에서 라이브로 맞붙어 관객이 승부를 '
    + '가르는 순위 결전 — 으로 정해진다. 이것을 세계의 상식으로 깔고 서사를 진행하라.',
});

// ── 9. 프리셋 — 신규 데뷔 × 난이도 (v0.85) ──
// 넷 다 같은 출발점이다: 이름 없음(인지도·화제성·팬·판매 전부 0) · 능력치 1레벨.
// 다른 건 **형편과 세상**뿐 — 자금·빚, 그리고 hard가 미는 이자율·팬 획득·영업 성사율·
// 시설 비용·독촉 문턱. "프리셋으로 인물을 안 박는다"는 원칙은 그대로다(사람은 편성표에서).
// ⚠ 체력·멘탈은 0으로 두지 않는다 — 멘탈 0은 그 자리에서 번아웃 패배다. 시작은 몸 성한 무명이다.
const DEBUT = {
  awareness: 0, buzz: 0, fans: 0, sales: 0, costume: '연습복',
  ...Object.fromEntries(Array.from({ length: N }, (_, i) => [
    [`m${i + 1}_vo`, 1], [`m${i + 1}_da`, 1], [`m${i + 1}_vi`, 1], [`m${i + 1}_fan`, 0],
  ]).flat()),
};
S.setup.presets = [
  { id: 'easy', label: '신규 데뷔 · 쉬움 — 든든한 출발',
    set: { ...DEBUT, hard: '쉬움', funds: 600, month_open: 600, debt: 0 } },
  { id: 'normal', label: '신규 데뷔 · 보통 — 맨몸과 사무소 하나',
    set: { ...DEBUT, hard: '보통', funds: 400, month_open: 400, debt: 800 } },
  { id: 'harsh', label: '신규 데뷔 · 어려움 — 빚으로 시작하는 꿈',
    set: { ...DEBUT, hard: '어려움', funds: 250, month_open: 250, debt: 2000 } },
  { id: 'reality', label: '신규 데뷔 · 리얼리티 — 업계의 밑바닥',
    set: { ...DEBUT, hard: '리얼리티', funds: 150, month_open: 150, debt: 3000 } },
];

// ── 검증 ──
const v = validateSchema(S);
console.log(v.ok ? '검증: 통과' : '검증: 실패');
for (const e of v.errors) console.log('  오류 ', e.path, e.msg);
for (const w of v.warnings) console.log('  경고 ', w.path, w.msg);
if (!v.ok) process.exit(1);

// 미치환 확인 — 내장 템플릿에서 물려온 옛 이름이 남아 있으면 여기서 잡힌다
const dump = JSON.stringify({ ...S, party: S.party, statusUI: S.statusUI });
const ghosts = ['유나', '세리', '· 린', '"center"', '"side1"', '"side2"'].filter((g) => dump.includes(g));
// 자리 다섯이 실제로 다 배선됐는가 — m3 줄만 복제하는 방식이라 마지막 자리가 빠지면 조용히 셋만 굴러간다
if (!dump.includes(`m${N}_me`) || !dump.includes(`slot${N}`)) ghosts.push(`자리 ${N} 미배선`);
// 비너스 배틀 (v0.84) — 세계관 지시문이 실려 있고, 배틀 보정(파생)도 자리 수의 자로 재졌는가.
// 판정 mod만 바꾸고 파생을 빼먹으면 화면의 승률만 세 자리 기준(1.6배)이 된다.
if (!S.directives.some((d) => d.id === 'world' && d.when === '1')) ghosts.push('세계관 지시문 없음');
if (!/\/ 48/.test(S.derived.find((d) => d.id === 'v_mod').expr)) ghosts.push('v_mod 나눔수 미조정');
if (!JSON.stringify(S.checks.find((c) => c.id === 'ck_venus')).includes(`m${N}_me`)) ghosts.push('배틀 효과 자리 미배선');
// 난이도 프리셋 (v0.85) — 넷이고, 빚 사다리가 오르고, 전부 1레벨 무명 데뷔인가
if (S.setup.presets.length !== 4) ghosts.push('프리셋 4종 아님');
{
  const debts = S.setup.presets.map((p) => p.set.debt);
  if (!debts.every((d, i) => i === 0 || d > debts[i - 1])) ghosts.push('빚 사다리 역전');
  if (!S.setup.presets.every((p) => p.set[`m${N}_vo`] === 1 && p.set.fans === 0 && p.set.hard)) ghosts.push('데뷔 초기화 불완전');
}
// 시설(관리 탭)도 다섯 자리로 배선됐는가 — m3 줄 복제 방식의 상시 함정
if (!JSON.stringify(S.actions.find((a) => a.id === 'meal'))?.includes(`m${N}_st`)) ghosts.push('시설 효과 자리 미배선');
console.log(ghosts.length ? `⚠ 옛 이름이 남음: ${ghosts.join(', ')}` : '미치환: 없음');

// ── 실제로 굴러가는가 ──
// 편성표는 진단이 못 만지는 자리다. 다섯을 앉히고 며칠 굴려서 무대가 서는지 눈으로 본다.
{
  let st = engine.initState(S); st.meta.setupDone = true;
  const picked = [...DEFAULT_LINEUP];
  picked.forEach((name, i) => { st.vars[`slot${i + 1}`] = name; });
  const L = () => engine.makeLookup(S, st.vars);
  console.log(`\n편성: ${picked.join(' · ')}`);
  console.log(`  무대 인원 ${L()('stand')}명 · 유닛 종합 ${L()('u_pow')} (${L()('u_rank')}등급)`
    + ` · 컨디션 ${L()('u_cond')} · 인기도 ${L()('u_fan')}명`);

  let stages = 0, nights = 0;
  for (let t = 1; t <= 120 && nights < 40; t++) {
    if (st.vars.unit_over) break;
    const w = st.vars;
    let want;
    if (w.job !== '없음' && w.job_days <= 0) want = ['perform', 'next_day'];
    else if (L()('u_cond') < 55) want = ['rest_day', 'talk', 'next_day'];
    else if (w.job === '없음') want = ['take_ltv', 'take_mag', 'take_radio', 'take_street', 'next_day'];
    else want = ['next_day'];
    if (w.live !== '없음' && w.live_days <= 0) want = ['live_show', ...want];
    if (w.live === '없음' && w.funds >= 400) want = ['hall_small', ...want];
    for (const a of want) {
      const r = engine.toggleAction(S, st, a);
      if (r.armed) { st = r.state; if (a === 'perform') stages++; if (a === 'next_day') nights++; break; }
    }
    st = engine.sendPhase(S, st, { rng: seededRng('dlc', t, 'a') }).state;
    st = engine.outputPhase(S, st, {}, {}, { rng: seededRng('dlc', t, 'o') }).state;
  }
  console.log(`  40일: 무대 ${stages}회 · 자금 ${st.vars.funds}만원 · 빚 ${st.vars.debt}만원`
    + ` · 인지도 ${st.vars.awareness} · 팬 ${st.vars.fans}명 · ${st.vars.unit_over ? '중단됨' : '굴러감'}`);
}

fs.writeFileSync(__P('미소녀유니버스-아이돌.json'), JSON.stringify(S, null, 2));
console.log('\n저장: ' + __P('미소녀유니버스-아이돌.json')
  + `\n  명단 ${CAST.length}명 · 자리 ${N} · 변수 ${S.vars.length} · 파생 ${S.derived.length}`
  + ` · 판정 ${S.checks.length} · 액션 ${S.actions.length} · 효과 복제 ${cloned}줄`);
