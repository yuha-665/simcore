// 얼헌 DLC 호환 표 — 남이 만든 DLC 모듈을 심코어판에서 쓰기 위한 이름·명단 (docs/design-얼헌-개조.md §P11)
//
// 모듈은 고치지 않고 우리가 배포하지도 않는다 — 받는 사람이 작성자 배포처에서 받아 그대로 켠다.
// 여기 있는 건 호환에 필요한 것뿐이다: 이미지 태그를 만들 이름(에셋 이름과 1:1)과 명단 한 줄.
// hunter-vars.js(팩·지시문·슬롯)와 convert-import.js(정규식 이름 검사)가 같이 읽는다 — 두 곳에 손으로 적지 말 것.

// ── ✨한국의 추가 헌터들 1.3 — 인물당 스탠딩 1장, 태그는 이름만 ──
// 명단은 없다: 모듈의 상시 로어북(Additional Guild / Organization Member Lists)이 이름·랭크·소속을
// 변수 조건 없이 이미 말한다. 여기 또 실으면 같은 표가 두 벌이다.
const KR_HUNTERS = [ // 파티 후보 = 랭크가 있는 헌터 (기본 명단 PARTY_NAMES와 같은 기준)
  ['한소미', 'Han So-mi'], ['주대현', 'Joo Dae-hyeon'], ['오세빈', 'Oh Se-bin'], ['윤채원', 'Yoon Chae-won'],
  ['백지호', 'Baek Ji-ho'], ['권해지', 'Kwon Hae-ji'], ['서태린', 'Seo Tae-rin'], ['민재욱', 'Min Jae-uk'],
  ['리나 박', 'Rina Park'], ['이휘찬', 'Lee Hwi-chan'], ['최나겸', 'Choi Na-gyeom'], ['박루나', 'Park Ru-na'],
  ['유태선', 'Yoo Tae-seon'], ['강소령', 'Kang So-ryeong'], ['안명수', 'Ahn Myeong-su'], ['류나은', 'Ryu Na-eun'],
  ['장규호', 'Jang Gyu-ho'], ['손미라', 'Son Mi-ra'], ['임도윤', 'Im Do-yun'], ['장혜미', 'Jang Hye-mi'],
  ['고석진', 'Go Seok-jin'], ['송민아', 'Song Min-a'], ['허준', 'Heo Joon'], ['김보라', 'Kim Bo-ra'],
  ['백도훈', 'Baek Do-hoon'], ['모세연', 'Mo Se-yeon'], ['강현주', 'Kang Hyeon-ju'],
];
const KR_OTHERS = [ // 협회 직원 5·적대 4 — 이미지만 (파티 후보 아님)
  ['서범준', 'Seo Beom-jun'], ['진애리', 'Jin Ae-ri'], ['현지수', 'Hyeon Ji-su'], ['류진아', 'Ryu Jin-ah'], ['오민규', 'Oh Min-gyu'],
  ['마도진', 'Ma Do-jin'], ['유현아', 'Yoo Hyeon-a'], ['장필수', 'Jang Pil-su'], ['클라라 서', 'Clara Seo'],
];

// ── 👥 더 많은 헌터들 어나더 — 인물당 감정 약 50장 (에셋은 본 모듈 + 추가 에셋 모듈 둘에 나뉜다) ──
// 모듈 명단은 인물마다 기본변수를 붙여 넣어야 나오고, 붙이면 상시 2만 자다 — 여기 한 줄씩을
// 기본 명단과 같은 랭크 게이트로 싣는다. 성격·외모는 이름이 나오면 모듈 시트가 키워드로 뜬다.
const MORE_BAND = {
  E: [
    '원지희 Won Ji-hee (20/F): E-Rank Hunter, aspiring chef',
    '유수이 Yoo Sui (20/F): E-Rank Supporter',
    '이가설 Lee Ga-seol (28/F): E-Rank Supporter',
    '하세미 Ha Se-mi (19/F): E-Rank Supporter',
    '박경율 Park Gyung-yul (23/M): E-Rank Tank/Dealer',
    '최지빈 Choi Ji-bin (19/F): E-Rank Dealer',
    '안동규 Ahn Dong-gyu (20/M): E-Rank Dealer',
    '고순욱 Go Soon-uk (22/M): E-Rank Supporter',
    '최성규 Choi Sung-gyu (22/M): E-Rank Supporter',
    '유승연 Yoo Seung-yeon (19/F): E-Rank Dealer',
    '황주희 Hwang Ju-hee (20/F): E-Rank Technician',
    '반시윤 Ban Si-yoon (18/F): E-Rank dungeon porter, abused by her father',
    '엘버 멕클레인 Elber McClain (18/M): E-Rank Alchemist, Academy 2nd-year',
    '박지희 Park Ji-hee (18/F): E-Rank Scout, Academy 2nd-year',
    '신라니 Shin Ra-ni (18/F): E-Rank Archer, Academy 2nd-year',
  ],
  D: [
    '박인준 Park In-joon (24/M): D-Rank Archer',
    '변지환 Byun Ji-hwan (22/M): D-Rank Dealer',
    '조영민 Jo Yeong-min (21/M): D-Rank Dealer',
    '한하얀 Han Ha-yan (17/F): D-Rank Dealer',
    '안송윤 Ahn Song-yoon (20/F): D-Rank Tank/Dealer',
    '염효상 Yeom Hyo-sang (23/M): D-Rank Dealer',
    '채산호 Chae San-ho (22/F): D-Rank Dealer',
    '김유영 Kim Yoo-young (23/F): D-Rank Dealer',
    '장화진 Jang Hwa-jin (24/F): D-Rank Dealer/Tank',
    '유예설 Yoo Ye-seol (26/F): D-Rank Dealer',
    '신수현 Shin Su-hyun (22/M): D-Rank Dealer',
    '이지유 Lee Ji-yoo (18/F): D-Rank Dealer',
    '황주혁 Hwang Ju-hyeok (20/M): D-Rank Technician',
    '사라 코트니 Sara Courtney (22/F): D-Rank Warrior, magic-material appraiser', // 모듈 명단에 빠진 인물 — 시트 기준
    '장유리 Jang Yu-ri (18/F): D-Rank Bruiser, Academy 2nd-year',
    '류지향 Ryu Ji-hyang (18/F): D-Rank Guardian, Academy 2nd-year',
    '위준혁 Wi Jun-hyuk (18/M): D-Rank Esper, Academy 2nd-year',
  ],
  C: [
    '이가윤 Lee Ga-yoon (24/F): C-Rank Tank',
    '주 환 Ju Hwan (25/M): C-Rank Dealer',
    '설다실 Seol Da-sil (29/F): C-Rank Tank/Dealer',
    '신유오 Shin Yu-oh (26/M): C-Rank Supporter',
    '지재희 Ji Jae-hee (23/F): C-Rank Dealer',
    '연시원 Yeon Si-won (24/F): C-Rank Assassin',
    '양주혜 Yang Ju-hye (27/F): C-Rank Supporter',
    '예시화 Ye Shi-hwa (24/F): C-Rank Supporter',
    '정민재 Jeong Min-jae (22/M): C-Rank Infighter, Jujak Institute top disciple',
    '주미르 Ju Mireu (21/F): C-Rank Swordswoman, young Hwarang Dojo master',
    '강채호 Kang Chae-ho (21/F): C-Rank Striker, Hwarang pupil',
  ],
  B: [
    '안예빈 Ahn Ye-bin (26/F): B-Rank Supporter',
    '이승주 Lee Seung-ju (26/F): B-Rank Dealer, Association rescue duty',
    '윤이화 Yoon Yi-hwa (27/F): B-Rank Dealer, model influencer',
    '한래연 Han Rae-yeon (27/F): B-Rank Dealer/Supporter',
    '정태린 Jeong Tae-rin (24/F): B-Rank Supporter/Dealer',
    '강비성 Kang Bi-seong (25/M): B-Rank Dealer, Association investigator',
    '에릭 칼튼 Eric Carlton (42/M): B-Rank Tanker',
    '양소율 Yang So-yul (26/F): B-Rank Healer, Academy medic',
  ],
  A: [
    '양재희 Yang Jae-hee (45/F): A-Rank Dealer',
    '곽덕팔 Gwak Deok-pal (32/M): A-Rank Hunter',
    '원유준 Won Yu-jun (38/M): A-Rank Berserker registered as B, Academy instructor',
  ],
  S: [
    '한하성 Han Ha-seong (26/M): S-Rank Dealer',
    '김향숙 Kim Hyang-sook (82/F): hidden first-generation S-Rank Sword Saint, former Hwarang Dojo master',
  ],
};
const MORE_STAFF = [
  '류해연 Ryu Hae-yeon (20/F): Hunter Association intern',
  '한수희 Han Soo-hee (20/F): non-Awakened Behemoth survivor, Han Ro-a\'s maid',
];
const MORE_HOSTILE = [
  '박선형 Park Seon-hyeong (26/M): former A-Rank, terrorist',
  '도진우 Do Jin-woo (23/M): C-Rank Necromancer (A-level threat), serial murderer',
  '안가은 Ahn Ga-eun (23/F): D-Rank Assassin, obsessive stalker',
  '반재혁 Ban Jae-hyuk (42/M): ex-C-Rank, license revoked, abuses daughter 반시윤',
  '허서연 Heo Seo-yeon (24/F): E-Rank Debuffer, extorts settlement money',
  '염연우 Yeom Yeon-woo (27/M): C-Rank party leader, gaslights rookies',
  '백문석 Baek Moon-seok (66/M): wanted bioterrorist, creator of Behemoth',
  '구재만 Gu Jae-man (43/M): Behemoth survivor (upper B power), 백문석\'s enforcer',
  '추하준 Choo Ha-jun (26/M): non-Awakened swindler, fake guild scout',
  '맹태오 Maeng Tae-oh (47/M): corrupt Association evaluation team leader',
];
// 해외 인물 22명 — 명단에 안 싣는다 (한국 무대에 평소 안 나온다, 나오면 모듈 시트·이벤트가 소개한다). 이미지 이름만.
const MORE_OVERSEAS = [
  'Cole Graves', 'Ella Miller', 'Han Ro-a', 'Li Weicheng', 'Saeki Yuzuki', 'Trixie Flynn', 'Dorian Pierce',
  'Isaac Robinson', 'Leon Jackson', 'Sienna Hayes', 'Silas', 'Azariette', 'Belfiora', 'Caraha', 'Greta',
  'Gwendolyn Drake', 'Livia Albescu', 'Raya Sinclair', 'Theo Allan', 'Aria White', 'Seria Winters', 'Vincent Clark',
];

// 어나더 이벤트 26종 — 모듈 항목 이름과 원래 확률 문턱 N (`{{roll::500}}<=N`). 합 160이라 턴당 27.5%가 뜬다.
const MORE_EVENTS = [
  ['마룡 게이트 재발생', 9], ['시에나 탈취 시도', 8], ['프릭스 클럽 경매 개장', 8], ['베헤모스 실험체 회수', 6],
  ['아카데미 게이트 내부 습격', 7], ['리온 잭슨의 테러', 7], ['카라하의 습격', 3], ['그웬돌린의 테러', 3],
  ['테스키오 디 푸오코의 숙청 작전', 6], ['속삭임의 마녀 조우', 3], ['화랑도장 도장깨기', 3], ['실적 가로채기', 7],
  ['가정폭력 목격', 8], ['관리기구 한국 연락관 한로아의 접촉', 7], ['특무 수사관 엘라 밀러와의 현장 조우', 7],
  ['관리기구 국장 세리아 윈터스의 호출', 7], ['미국 연락관 트릭시 플린의 미행 발각', 7],
  ['유럽 연락관 아리아 화이트의 초대', 7], ['콜 그레이브스의 투입', 4], ['테오 알란 조우', 10], ['마녀에 대한 소식', 7],
  ['미국 내 주요 위험 각성자 단일 브리핑', 7], ['시에나 헤이즈 조우', 6], ['도리안 피어스의 경고', 5],
  ['아이작의 범행발각', 4], ['빈센트 클라크의 초대', 4],
];
// 턴당 5% 이하 (유저 기준: 20턴에 1번, 채팅이 길어서 그 이상이면 이벤트를 끝없이 보게 된다) — 3200이면 4.9%
const MORE_EVENT_ROLL = 3200;

const enName = (s) => s.match(/ ([A-Z][A-Za-z -]*?) \(/)[1];
const koName = (s) => s.match(/^[가-힣]+(?: [가-힣]+)*/)[0];
const moreRows = [...Object.values(MORE_BAND).flat(), ...MORE_STAFF, ...MORE_HOSTILE];
const krRows = [...KR_HUNTERS, ...KR_OTHERS];

// ── 모듈 손질 — 번들 로어북에 얹는 @@inject_lore 항목 ──
// 리수 데코레이터: 카드 로어북 항목이 이름(comment)으로 활성 항목을 찾아, 프롬프트에 들어가기 전에
// 그 원문을 고친다. 고치는 항목 자신은 프롬프트에 안 실리고, 대상이 없으면(모듈을 안 켠 판) 아무 일도 없다.
// CBS는 그 뒤에 평가되므로 {{roll}}·{{#if}}까지 손댈 수 있다 — 모듈 파일을 안 고치고 동작만 고치는 자리.
const uuid = (s) => require('crypto').createHash('sha1').update(s).digest('hex')
  .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
const FOLDER = `folder:${uuid('얼헌 DLC 호환')}`;
const entry = (comment, fields) => ({
  key: '', comment, content: '', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '',
  selective: false, bookVersion: 2, id: uuid(comment), folder: FOLDER, useRegex: false, ...fields,
});
function dlcLore() {
  // 이벤트 — 문턱은 그대로 두고 주사위만 키운다 (이벤트끼리의 비중이 유지된다)
  const events = MORE_EVENTS.map(([title]) => entry(`이벤트 빈도 ${title}`, {
    alwaysActive: true,
    content: `@@inject_lore 🌟 이벤트 - ${title}\n@@inject_replace {{roll::500}}\n{{roll::${MORE_EVENT_ROLL}}}`,
  }));
  // 한국 헌터 시트 — 키가 전체 이름·한글 이름 + 성·이름 낱개라서, `Im`이 <img에 `Ma`가 Male에 `Go`가
  // Go Eun-bi에 걸려 한 턴에 무관한 시트가 3만 자씩 뜬다. 낱개 키로만 걸린 판에 시트를 {{#if 0}}로 감싸 비운다.
  // 활성화는 못 막으니(inject는 활성 뒤) 내용을 지운다 — 앞뒤 두 항목이 같은 조건이라 항상 짝으로 붙는다.
  const sheets = krRows.flatMap(([ko, en]) => {
    const when = { key: en.split(' ').join(',') };
    const guard = `@@exclude_keys ${en},${ko}`;
    return [
      entry(`시트 오발화 ${ko} 앞`, { ...when, content: `@@inject_lore 👤${ko}\n@@inject_prepend\n${guard}\n{{#if 0}}` }),
      entry(`시트 오발화 ${ko} 뒤`, { ...when, content: `@@inject_lore 👤${ko}\n${guard}\n{{/if}}` }),
    ];
  });
  const folder = {
    key: FOLDER, comment: '🧩 DLC 호환 — 고치지 마세요', content: '', mode: 'folder', insertorder: 100,
    alwaysActive: false, secondkey: '', selective: false, bookVersion: 2, id: uuid('얼헌 DLC 호환 폴더'),
  };
  return [folder, ...events, ...sheets];
}

module.exports = {
  MORE_BAND, MORE_STAFF, MORE_HOSTILE, MORE_EVENTS, MORE_EVENT_ROLL, dlcLore,
  KR_NAMES: krRows.map((r) => r[1]),                              // 에셋 이름 36
  MORE_NAMES: [...moreRows.map(enName), ...MORE_OVERSEAS],        // 에셋 이름 90
  DLC_PARTY_NAMES: [...KR_HUNTERS.map((r) => r[0]),               // 파티 후보 — 동료 명부와 같은 한글 이름
    ...Object.values(MORE_BAND).flat().map(koName)],
};
