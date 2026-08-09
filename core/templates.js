// 내장 스키마 템플릿 — "새 스키마" 시작점. 전부 validateSchema를 통과해야 한다 (테스트로 보장).

const BLANK = {
  simcore: '0.1',
  meta: { name: '새 시뮬레이션' },
  vars: [{ id: 'hp', label: '체력', type: 'int', init: 100, min: 0, max: 100 }],
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp', bar: { max: 100 } }] }] },
  promptState: { position: 'history_end', template: '[상태] 체력 {hp}/100', includeEvents: true },
  updater: { model: 'aux', allow: [{ id: 'hp', maxDelta: 30 }] },
};

const RPG = {
  simcore: '0.1',
  meta: { name: 'RPG 모험 기록' },
  vars: [
    { id: 'level', label: '레벨', type: 'int', init: 1, min: 1, format: 'Lv.{v}' },
    { id: 'exp', label: '경험치', type: 'int', init: 0, min: 0 },
    { id: 'hp', label: 'HP', type: 'int', init: 100, min: 0 },
    { id: 'mp', label: 'MP', type: 'int', init: 50, min: 0 },
    { id: 'gold', label: '골드', type: 'int', init: 50, min: 0, format: '{v}G' },
    { id: 'weapon', label: '무기', type: 'text', init: '낡은 단검', maxLength: 30 },
    { id: 'armor', label: '방어구', type: 'text', init: '여행자 옷', maxLength: 30 },
    { id: 'inventory', label: '소지품', type: 'list', init: ['빵', '물통'], maxItems: 15, itemMaxLength: 30 },
    { id: 'location', label: '위치', type: 'text', init: '시작 마을', maxLength: 50 },
    { id: 'condition', label: '상태', type: 'text', init: '건강함', maxLength: 40 },
    // 편성표 재료 (v0.55 배울 점): 후보는 enum이 확정하고(제작자가 정한 인물만 — AI는 명사를 못 만든다),
    // 보유는 list가 움직인다 (영입·이탈은 보조 AI 몫). 편성 자체는 우상단 [⚔️ 편성] 버튼의 팝업에서.
    { id: 'allies', label: '동료', type: 'list', init: ['아린'], maxItems: 6, itemMaxLength: 12,
      desc: '동행 중인 동료 이름 목록. 서사에서 동료를 영입하면 추가, 떠나면 제거.' },
    { id: 'front', label: '전위', type: 'enum', init: '없음', enum: ['없음', '아린', '바크', '셀레네'] },
    { id: 'rear', label: '후위', type: 'enum', init: '없음', enum: ['없음', '아린', '바크', '셀레네'] },
    // 수련 재료 (v0.58 배울 점): 스킬 = int 변수(레벨), 포인트는 레벨업 이벤트가 준다.
    // 찍기는 [⚔️ 편성] 팝업의 수련 탭 — 선행 조건(requires)은 그냥 조건식이다.
    { id: 'sp', label: '수련 포인트', type: 'int', init: 1, min: 0, max: 99,
      desc: '레벨 업 때마다 1씩 쌓인다. 수련 탭에서 스킬을 찍는 데 쓴다.' },
    { id: 'skill_sword', label: '검술', type: 'int', init: 0, min: 0, max: 5 },
    { id: 'skill_heal', label: '치유술', type: 'int', init: 0, min: 0, max: 3 },
  ],
  derived: [
    { id: 'max_hp', label: '최대 HP', expr: '80 + level * 20' },
    { id: 'max_mp', label: '최대 MP', expr: '40 + level * 10' },
    { id: 'exp_need', label: '필요 경험치', expr: 'level * 100' },
  ],
  rules: {
    onTurn: [],
    events: [
      {
        id: 'levelup',
        when: 'exp >= exp_need',
        effects: [
          { set: 'exp', expr: 'exp - exp_need' },
          { set: 'level', expr: 'level + 1' },
          { set: 'hp', expr: 'max_hp' },
          { set: 'mp', expr: 'max_mp' },
          { set: 'sp', expr: 'min(sp + 1, 99)' },
        ],
        notify: '레벨 업! 몸에 힘이 차오르며 상처가 아문다. 수련 포인트를 1 얻었다.',
      },
      { id: 'hp_cap', when: 'hp > max_hp', effects: [{ set: 'hp', expr: 'max_hp' }] },
      { id: 'mp_cap', when: 'mp > max_mp', effects: [{ set: 'mp', expr: 'max_mp' }] },
      {
        id: 'downed',
        when: 'hp <= 0',
        effects: [{ set: 'condition', expr: "'빈사 — 즉시 치료가 필요하다'" }],
        notify: '치명상을 입고 쓰러졌다. 이대로면 위험하다.',
      },
    ],
    randomEvents: {
      chancePerTurn: 0.15,
      table: [
        { id: 'find_item', weight: 2, cooldown: 4,
          effects: [{ list: 'inventory', add: ['반짝이는 돌'] }],
          notify: '길가에서 무언가 반짝이는 것을 주웠다.' },
        { id: 'wanderer', weight: 2, cooldown: 5,
          notify: '수상한 방랑 상인이 말을 걸어온다.' },
        { id: 'ambush', weight: 1, cooldown: 6,
          notify: '적의 기습이다! 전투를 피할 수 없다.' },
      ],
    },
  },
  directives: [
    {
      id: 'badly_hurt',
      when: 'hp <= max_hp * 0.25',
      text: '[상태] 심각한 부상 상태다 (HP {hp}/{max_hp}). 모든 행동과 대사에 고통과 쇠약함이 묻어나야 한다.',
    },
    {
      id: 'broke',
      when: 'gold <= 10',
      text: '[상태] 수중에 돈이 거의 없다 ({gold}G). 궁핍함이 선택지에 영향을 줘야 한다.',
    },
    // 편성 연동 (v0.59) — deployed(편성 슬롯에 앉은 이름들)로 편성 사실을 서사에 잇는다.
    // 상태창 showWhen·이벤트 조건·업그레이드 requires에도 같은 식이 그대로 통한다.
    {
      id: 'arin_in_party',
      when: "has(deployed, '아린')",
      text: '[편성] 아린이 전열(전위/후위)에 편성돼 있다. 이동·전투·야영 장면에서 아린이 곁에 있음이 서사에 드러나야 한다.',
    },
  ],
  updater: {
    model: 'aux',
    allow: [
      { id: 'hp', maxDelta: 60 },
      { id: 'mp', maxDelta: 40 },
      { id: 'exp', maxDelta: 80 },
      { id: 'gold', maxDelta: 300 },
      { id: 'weapon', maxLength: 30 },
      { id: 'armor', maxLength: 30 },
      { id: 'inventory' },
      { id: 'location', maxLength: 50 },
      { id: 'condition', maxLength: 40 },
      { id: 'allies' },
    ],
    guide: '전투·획득·상실이 서사에 명시된 경우만 반영. 경험치는 전투/성취의 규모에 비례하게. '
      + '동료(allies)는 서사에서 정식으로 합류/이탈했을 때만 움직여라 — 편성(전위/후위)은 유저가 정한다.',
  },
  promptState: {
    position: 'history_end',
    template: '[모험 기록 — Lv.{level} · {location}]\nHP {hp}/{max_hp} | MP {mp}/{max_mp} | EXP {exp}/{exp_need} | {gold}G\n장비: {weapon} / {armor}\n소지품: {inventory}\n동료: {allies} | 편성: 전위 {front} / 후위 {rear}\n수련: 검술 {skill_sword} · 치유술 {skill_heal} (SP {sp})\n상태: {condition}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto',
    theme: 'card',
    collapsible: true,
    groups: [
      { label: '전투', items: [
        { var: 'hp', bar: { max: 'max_hp' }, color: "hp < max_hp * 0.3 ? '#c0392b' : '#e74c3c'" },
        { var: 'mp', bar: { max: 'max_mp' }, color: "'#5b8def'" },
        { var: 'condition' },
      ]},
      { label: '성장', items: [
        { var: 'level' },
        { var: 'exp', bar: { max: 'exp_need' }, color: "'#8b5bef'" },
      ]},
      { label: '소지', items: [
        { var: 'gold' }, { var: 'weapon' }, { var: 'armor' }, { var: 'inventory' },
      ]},
      // 편성 결과가 상태창에 보이는 자리 — showWhen으로 "편성했을 때만" 분기 (v0.31 기능 그대로)
      { label: '편성', items: [
        { var: 'front', showWhen: 'front != "없음"' },
        { var: 'rear', showWhen: 'rear != "없음"' },
        { var: 'allies' },
      ]},
      { label: '수련', items: [
        { var: 'skill_sword', showWhen: 'skill_sword > 0', bar: { max: 5 } },
        { var: 'skill_heal', showWhen: 'skill_heal > 0', bar: { max: 3 } },
        { var: 'sp', showWhen: 'sp > 0' },
      ]},
      { label: '위치', items: [{ var: 'location' }] },
    ],
    // 가죽 장정 모험일지 — 어두운 갈색 가죽에 황동 각인
    customCSS: `.sim-status { background:linear-gradient(180deg,#241a12,#1a120c); border:1px solid #6b4f2a; border-radius:6px; color:#e3d5bd; font-family:Georgia,'Nanum Myeongjo',serif; box-shadow:inset 0 0 24px rgba(0,0,0,.5); }
.sim-status summary { color:#d9a441; letter-spacing:.05em; }
.sim-group { background:transparent; border-top:1px solid #3b2b19; padding:6px 0 0; border-radius:0; }
.sim-group-label { color:#c08b3e; letter-spacing:.1em; }
.sim-label { color:#a08c6c; opacity:1; }
.sim-value { color:#f3e6cc; font-weight:700; }
.sim-badge, .sim-tag { background:#332415; color:#e0b76a; border:1px solid #6b4f2a; border-radius:3px; }
.sim-bar { background:#150e08; border:1px solid #3b2b19; height:10px; border-radius:2px; }
.sim-action { border-color:#6b4f2a; color:#e0b76a; border-radius:3px; background:#2a1d11; }
.sim-action.sim-armed { border-color:#d9a441; background:#3b2b19; }
.sim-log { color:#8a7657; }`,
  },
  // 편성표 (v0.55~) — 우상단 [⚔️ 편성] 버튼 → 팝업. 슬롯 = enum 변수, 보유 = allies 목록.
  // 저장은 그냥 변수라 위 statusUI showWhen·promptState가 그대로 읽는다. 새 표시 문법 없음.
  // tabs(v0.56): 탭 = 편성 하나 또는 시설 하나 (칸코레식 함대/수복/제작).
  // items(v0.58): 업그레이드 탭 — 스킬 = int 변수, 찍기 = 포인트 차감 + 레벨 +1.
  //   선행 조건(requires)은 그냥 조건식이고, 비용은 숫자 또는 식(점증 비용)이다.
  party: {
    label: '편성', icon: '⚔️', empty: '없음', roster: 'allies',
    note: '동료를 영입하면(동료 목록) 편성할 수 있다.',
    tabs: [
      { id: 'main', label: '편성',
        slots: [
          { var: 'front', label: '전위' },
          { var: 'rear', label: '후위' },
        ],
        actions: ['rest'] },
      { id: 'train', label: '수련', points: 'sp',
        items: [
          { var: 'skill_sword', cost: 1, note: '검을 다루는 기술 — 레벨업으로 얻은 포인트로 찍는다.' },
          { var: 'skill_heal', cost: 1, requires: 'skill_sword >= 2', requiresLabel: '검술 2 필요',
            note: '몸을 다스리는 법은 검을 다룬 뒤에야 보인다.' },
        ],
        note: '레벨 업으로 얻은 수련 포인트를 쓴다. 한 번 찍으면 되돌릴 수 없다.' },
    ],
  },
  actions: [
    {
      id: 'rest', label: '🏕 휴식', mode: 'oneshot', cooldown: 2,
      inject: '[플레이어 액션] 모닥불을 피우고 휴식을 취한다.',
      effects: [
        { set: 'hp', expr: 'min(hp + round(max_hp * 0.5), max_hp)' },
        { set: 'mp', expr: 'min(mp + round(max_mp * 0.5), max_mp)' },
      ],
    },
    {
      id: 'potion', label: '🧪 회복약 사용', mode: 'oneshot', when: "has(inventory, '회복약')",
      inject: '[플레이어 액션] 회복약을 마신다.',
      effects: [
        { list: 'inventory', remove: ['회복약'] },
        { set: 'hp', expr: 'min(hp + 50, max_hp)' },
      ],
    },
  ],
  setup: {
    presets: [
      { id: 'novice', label: '신참 모험가', set: {} },
      { id: 'veteran', label: '베테랑 용병', set: {
        level: 5, gold: 500, weapon: '강철 장검', armor: '사슬 갑옷',
        inventory: ['회복약', '회복약', '낡은 지도'],
      } },
    ],
    ai: {
      enabled: true,
      vars: ['level', 'gold', 'weapon', 'armor', 'inventory', 'location', 'condition'],
      instruction: '[최초 설정 진행 중] 아직 모험이 시작되지 않았다. 유저와 함께 캐릭터의 배경(출신, 직업, 장비, 시작 장소 등)을 정하는 대화를 하라. 충분히 정해지면 시작 장면을 서술하라.',
      guide: '유저가 명시한 설정은 그대로, 나머지는 배경에 어울리게. 시작 소지품은 3~6개가 적당.',
    },
  },
};

// 영지 시뮬 (설계 문서 8절 예제) — 테스트 픽스처와 공유
const ESTATE = {
  simcore: '0.1',
  meta: { name: '변경백령 시뮬레이션', author: 'Yu' },
  vars: [
    { id: 'turn', label: '경과', type: 'int', init: 1, min: 1, format: '{v}개월차' },
    { id: 'gold', label: '자금', type: 'int', init: 1000, min: 0, format: '{v}G' },
    { id: 'food', label: '식량', type: 'int', init: 500, min: 0 },
    { id: 'population', label: '인구', type: 'int', init: 300, min: 0 },
    { id: 'loyalty', label: '민심', type: 'int', init: 50, min: 0, max: 100 },
    { id: 'military', label: '병력', type: 'int', init: 50, min: 0 },
    { id: 'famine', label: '기근', type: 'bool', init: false },
    { id: 'situation', label: '정세', type: 'text', init: '평온함', maxLength: 80 },
    { id: 'season', label: '계절', type: 'enum', init: '봄', enum: ['봄', '여름', '가을', '겨울'] },
  ],
  derived: [
    { id: 'net_income', label: '월 수지', expr: 'round(population * 0.3) - military * 2' },
    { id: 'food_need', label: '식량 소비', expr: 'round(population * 0.2)' },
  ],
  rules: {
    onTurn: [
      { set: 'turn', expr: 'turn + 1' },
      { set: 'gold', expr: 'gold + net_income' },
      { set: 'food', expr: 'food - food_need' },
    ],
    events: [
      {
        id: 'famine_start',
        when: 'food <= 0 and not famine',
        effects: [
          { set: 'famine', expr: '1' },
          { set: 'loyalty', expr: 'loyalty - 10' },
          { set: 'population', expr: 'population - round(population * 0.05)' },
        ],
        notify: '식량이 바닥나 기근이 시작되었다. 민심이 떨어지고 주민이 영지를 떠나고 있다.',
      },
      {
        id: 'famine_end',
        when: 'food > food_need * 2 and famine',
        effects: [{ set: 'famine', expr: '0' }],
        notify: '식량 사정이 나아져 기근이 끝났다.',
      },
      {
        id: 'revolt',
        when: 'loyalty <= 10',
        effects: [{ set: 'loyalty', expr: '25' }, { set: 'military', expr: 'military - 10' }],
        notify: '민심이 바닥나 폭동이 일어났다! 진압 과정에서 병력을 잃었다.',
      },
    ],
    randomEvents: {
      chancePerTurn: 0.25,
      table: [
        { id: 'bandits', weight: 3, when: 'military < 150', cooldown: 6,
          effects: [{ set: 'gold', expr: 'gold - rand(50, 150)' }],
          notify: '산적 무리가 상단을 습격해 자금을 약탈해 갔다.' },
        { id: 'merchant', weight: 2, cooldown: 4,
          notify: '이국의 대상단이 영지를 방문했다. 교역의 기회다.' },
      ],
    },
  },
  setup: {
    presets: [
      { id: 'standard', label: '평범한 변경백', set: {} },
      { id: 'rich', label: '부유한 상업령', set: { gold: 5000, food: 800, population: 500, military: 30, situation: '상인들로 붐빔' } },
      { id: 'ruined', label: '몰락한 폐허령', set: { gold: 100, food: 100, population: 80, loyalty: 25, military: 10, situation: '폐허 속 재건 시작' } },
    ],
    ai: {
      enabled: true,
      vars: ['gold', 'food', 'population', 'loyalty', 'military', 'situation', 'season'],
      instruction: '[최초 설정 진행 중] 아직 영지 시뮬레이션이 시작되지 않았다. 유저와 함께 영지의 배경(지역, 재정, 인구, 병력 등)을 정하는 대화를 하라. 유저의 묘사가 충분하면 확정된 시작 상황을 정리해 서술하라.',
      guide: '유저가 명시한 값은 그대로, 나머지는 배경 서사에 어울리게 정하라.',
    },
  },
  directives: [
    {
      id: 'famine_mood',
      when: 'famine',
      text: '[상태] 기근이 계속되고 있다. 거리의 굶주림, 흉흉한 민심, 영주를 향한 원망이 묘사에 배어나야 한다.',
    },
    {
      id: 'low_treasury',
      when: 'gold < 100',
      text: '[상태] 금고가 거의 바닥났다 ({gold}G). 지출이 필요한 상황에서 재정 압박이 드러나야 한다.',
    },
  ],
  updater: {
    model: 'aux',
    allow: [
      { id: 'gold', maxDelta: 500 },
      { id: 'food', maxDelta: 300 },
      { id: 'population', maxDelta: 50 },
      { id: 'loyalty', maxDelta: 15 },
      { id: 'military', maxDelta: 100 },
      { id: 'situation', maxLength: 80 },
      { id: 'season' },
    ],
    guide: '서사에 명시된 변화만 반영. 정기 수입/소비는 시스템이 따로 계산하니 중복 반영 금지.',
  },
  promptState: {
    position: 'history_end',
    template: "[영지 현황 — {turn}개월차 · {season}]\n자금 {gold}G (월 수지 {net_income}G) | 식량 {food} (월 소비 {food_need}) | 인구 {population} | 민심 {loyalty}/100 | 병력 {military}\n정세: {situation}{famine ? ' | ⚠ 기근 진행 중' : ''}",
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto',
    theme: 'clean',
    collapsible: true,
    groups: [
      { label: '내정', items: [
        { var: 'turn' }, { var: 'gold' },
        { var: 'food', bar: { max: 'food_need * 5' } },
        { var: 'loyalty', bar: { max: 100 }, color: "loyalty < 30 ? '#c0392b' : '#27ae60'" },
        { var: 'population' },
      ]},
      { label: '군사', items: [{ var: 'military' }] },
      { label: '상황', items: [{ var: 'season' }, { var: 'situation' }, { var: 'famine', showWhen: 'famine' }] },
    ],
    // 석조 집무실 — 이끼 낀 화강암에 밀랍 인장
    customCSS: `.sim-status { background:#1b201c; border:1px solid #3d4a3f; border-radius:4px; color:#d2dbd2; }
.sim-status summary { color:#9cb79f; letter-spacing:.06em; }
.sim-group { border-left:3px solid #3d4a3f; padding-left:10px; }
.sim-group-label { color:#a8bda9; font-size:.8em; letter-spacing:.12em; }
.sim-label { color:#8b9a8c; opacity:1; }
.sim-value { color:#eef3ee; font-weight:700; }
.sim-badge, .sim-tag { background:#252c26; color:#b6c9b7; border:1px solid #3d4a3f; border-radius:2px; }
.sim-bar { background:#141814; height:9px; border-radius:1px; border:1px solid #2c352d; }
.sim-bar-fill { border-radius:0; }
.sim-action { border-color:#4a5a4c; color:#b6c9b7; border-radius:2px; }
.sim-action.sim-armed { border-color:#8c2f22; background:#2a1c19; color:#e0a99f; }
.sim-log { color:#7b8a7c; }`,
  },
  actions: [
    {
      id: 'tax', label: '💰 특별 징세', mode: 'oneshot', when: 'turn >= 2', cooldown: 3,
      inject: '[플레이어 액션] 영주는 이번 달 특별 징세를 단행한다.',
      effects: [
        { set: 'gold', expr: 'gold + round(population * 0.5)' },
        { set: 'loyalty', expr: 'loyalty - 5' },
      ],
    },
    {
      id: 'patrol', label: '🛡 순찰 강화', mode: 'hold',
      inject: '[지속 정책] 병사들이 순찰을 강화하고 있다.',
      effects: [{ set: 'gold', expr: 'gold - 20' }],
    },
  ],
};

// ── 추리 ──────────────────────────────────────────────────────
// 배울 점: ① 목록(list) 변수를 단서 수집에 쓰는 법  ② 파생 변수로 진척도를 만드는 법
//          ③ 지시문으로 "스포일러 금지" 같은 연출 규칙을 거는 법
//          ④ 상태창에는 숨기고 모델에게만 알려주는 변수(truth) 다루는 법
const MYSTERY = {
  simcore: '0.1',
  meta: { name: '추리 — 사건 수사', author: 'SimCore 템플릿' },
  vars: [
    { id: 'scene', label: '경과', type: 'int', init: 1, min: 1, format: '{v}번째 장면' },
    { id: 'clues', label: '확보 단서', type: 'list', init: [], maxItems: 12, itemMaxLength: 40,
      desc: '수사로 확인된 사실만. 추측이나 가설은 넣지 않는다.' },
    { id: 'suspects', label: '용의선상', type: 'list', init: [], maxItems: 8, itemMaxLength: 24,
      desc: '현재 의심받는 인물. 혐의가 풀리면 remove로 뺀다.' },
    { id: 'trust', label: '조력자 신뢰', type: 'int', init: 50, min: 0, max: 100,
      desc: '주변 인물이 주인공에게 협조하는 정도.' },
    { id: 'pressure', label: '외압', type: 'int', init: 10, min: 0, max: 100,
      desc: '시간·윗선의 압박. 100에 닿으면 수사가 무너진다.' },
    { id: 'place', label: '현재 장소', type: 'text', init: '사건 현장', maxLength: 40 },
    { id: 'phase', label: '국면', type: 'enum', init: '조사', enum: ['조사', '추궁', '대치', '해결'] },
    { id: 'truth', label: '진상(비공개)', type: 'text', init: '', maxLength: 200,
      desc: '범인과 수법. 유저 상태창에는 띄우지 않고 모델에게만 넘긴다.' },
    { id: 'solved', label: '해결', type: 'bool', init: false },
  ],
  // 파생 변수 = 다른 변수로 그때그때 계산되는 읽기 전용 값. 저장되지 않고 set 할 수도 없다.
  derived: [
    { id: 'clue_count', label: '단서 수', expr: 'count(clues)' },
    { id: 'progress', label: '수사 진척', expr: 'clamp(round(clue_count * 100 / 8), 0, 100)' },
  ],
  rules: {
    // onTurn = 매 턴 무조건 실행되는 정기 계산 (시간 경과, 자연 증감)
    onTurn: [
      { set: 'scene', expr: 'scene + 1' },
      { set: 'pressure', expr: 'pressure + 3' },
    ],
    // events = 조건(when)이 참이 되는 순간 발동. once:true면 딱 한 번만.
    // ⚠ notify가 이 이벤트에서 메인 모델로 가는 유일한 통로다. 없으면 모델은 발동 사실을 모른다.
    events: [
      { id: 'to_press', once: true, when: 'phase == "조사" and clue_count >= 3',
        effects: [{ set: 'phase', expr: '"추궁"' }],
        notify: '단서가 어느 정도 모였다. 이제 관계자를 직접 추궁할 수 있다.' },
      { id: 'to_face', once: true, when: 'phase == "추궁" and clue_count >= 6',
        effects: [{ set: 'phase', expr: '"대치"' }],
        notify: '결정적 정황이 드러났다. 범인과 마주할 때다.' },
      { id: 'solve', once: true, when: 'clue_count >= 8 and not solved',
        effects: [{ set: 'phase', expr: '"해결"' }, { set: 'solved', expr: '1' }],
        notify: '흩어져 있던 단서가 하나로 이어졌다. 진상을 밝힐 수 있다.' },
      { id: 'forced_end', once: true, when: 'pressure >= 100 and not solved',
        effects: [{ set: 'trust', expr: 'trust - 20' }],
        notify: '외압이 한계를 넘었다. 수사가 강제로 덮일 위기다.' },
    ],
    // randomEvents = 매 턴 chancePerTurn 확률로 "무언가 일어날지" 먼저 굴리고,
    // 일어나면 조건을 통과한 항목들 중 weight에 비례해 하나를 뽑는다.
    // weight 3은 weight 1보다 3배 자주 뽑힌다 (확률이 아니라 상대 비중).
    randomEvents: {
      chancePerTurn: 0.3,
      table: [
        { id: 'witness', weight: 3, cooldown: 3,
          effects: [{ set: 'trust', expr: 'trust + 5' }],
          notify: '뜻밖의 목격자가 나타나 진술을 남겼다.' },
        { id: 'tamper', weight: 2, when: 'clue_count >= 2', cooldown: 4,
          effects: [{ set: 'pressure', expr: 'pressure + 12' }],
          notify: '누군가 증거에 손을 댔다. 수사가 한층 어려워졌다.' },
        { id: 'anon_tip', weight: 2, cooldown: 5,
          notify: '익명의 제보가 도착했다. 내용을 확인해야 한다.' },
        { id: 'reporters', weight: 1, when: 'pressure < 80', cooldown: 6,
          effects: [{ set: 'pressure', expr: 'pressure + 8' }, { set: 'trust', expr: 'trust - 5' }],
          notify: '기자들이 몰려들어 사건이 세간에 퍼졌다.' },
      ],
    },
  },
  // 지시문 = 조건이 참인 동안 매 턴 메인 모델에게 주는 연출 지침. 추리물의 핵심 장치.
  directives: [
    { id: 'no_spoiler', when: 'not solved',
      text: '[연출 지시] 진상을 직접 서술하지 마라. 단서는 묘사·대사·정황으로만 흘리고 추론은 유저가 하게 둔다.' },
    { id: 'pressure_high', when: 'pressure >= 70',
      text: '[분위기] 외압 {pressure}/100. 시간이 없다는 감각, 윗선의 간섭, 초조함이 장면에 배어야 한다.' },
    { id: 'face_off', when: 'phase == "대치"',
      text: '[국면] 대치 단계다. 확보한 단서 {clue_count}개를 근거로 범인을 몰아붙이는 긴장된 대화를 중심에 둔다.' },
    { id: 'low_trust', when: 'trust <= 20',
      text: '[관계] 주변이 비협조적이다. 질문에 얼버무리거나 말을 돌리는 반응을 보여라.' },
  ],
  actions: [
    { id: 'interrogate', label: '🔍 추궁', mode: 'oneshot', when: 'phase != "조사"', cooldown: 2,
      inject: '[플레이어 행동] 주인공이 상대를 정면으로 추궁한다.',
      effects: [{ set: 'pressure', expr: 'pressure + 5' }, { set: 'trust', expr: 'trust - 3' }] },
    { id: 'resurvey', label: '🕯 현장 재조사', mode: 'oneshot', cooldown: 3,
      inject: '[플레이어 행동] 주인공이 현장을 다시 살핀다. 놓친 것이 있을지도 모른다.',
      effects: [{ set: 'pressure', expr: 'pressure + 2' }] },
    { id: 'ask_help', label: '🤝 조력 요청', mode: 'oneshot', cooldown: 4,
      inject: '[플레이어 행동] 주인공이 조력자에게 도움을 청한다.',
      effects: [{ set: 'trust', expr: 'trust + 8' }] },
  ],
  updater: {
    allow: [
      { id: 'clues' }, { id: 'suspects' },
      { id: 'trust', maxDelta: 15 }, { id: 'pressure', maxDelta: 15 },
      { id: 'place', maxLength: 40 }, { id: 'phase' },
    ],
    guide: '단서는 서사에서 실제로 확인된 것만 add하라. 주인공의 추측·가설은 넣지 마라.',
  },
  promptState: {
    template: '[수사 현황 — {scene}번째 장면 · {phase}]\n'
      + '장소 {place} | 단서 {clue_count}개 (진척 {progress}%) | 조력자 신뢰 {trust}/100 | 외압 {pressure}/100\n'
      + '확보 단서: {clues:tags}\n용의선상: {suspects:tags}\n'
      + '[진상 — 절대 직접 서술 금지] {truth}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '수사', items: [
        { var: 'scene' }, { var: 'phase' },
        { var: 'progress', bar: { max: 100 } },
        { var: 'clues' },
      ] },
      { label: '인물', items: [
        { var: 'trust', bar: { max: 100 }, color: 'trust < 30 ? "#c0392b" : "#27ae60"' },
        { var: 'suspects' },
      ] },
      { label: '상황', items: [
        { var: 'place' },
        { var: 'pressure', bar: { max: 100 }, color: 'pressure >= 70 ? "#c0392b" : "#5b8def"' },
      ] },
    ],
    // 사건 파일 — 누렇게 뜬 서류에 타자기 활자, 붉은 스탬프
    customCSS: `.sim-status { background:#efe8d8; border:1px solid #b5a888; border-radius:2px; color:#2e2a22; font-family:'Courier New',ui-monospace,monospace; box-shadow:2px 3px 0 rgba(0,0,0,.18); }
.sim-status summary { color:#7a2e22; letter-spacing:.1em; }
.sim-group { border-bottom:1px dashed #b5a888; padding-bottom:6px; }
.sim-group-label { color:#7a2e22; letter-spacing:.14em; }
.sim-label { color:#5c5344; opacity:1; }
.sim-value { color:#1d1a14; font-weight:700; }
.sim-badge, .sim-tag { background:#e0d6bd; color:#4a3b28; border:1px solid #a3906f; border-radius:0; }
.sim-bar { background:#ddd3ba; border:1px solid #b5a888; height:8px; border-radius:0; }
.sim-bar-fill { border-radius:0; }
.sim-action { border-color:#8c7f63; color:#4a3b28; border-radius:0; background:#e6dcc6; }
.sim-action.sim-armed { border-color:#7a2e22; color:#7a2e22; background:#f0dcd6; }
.sim-log { color:#6b6152; }`,
  },
  setup: {
    presets: [
      { id: 'locked_room', label: '밀실 살인', set: { place: '잠긴 서재', pressure: 20 } },
      { id: 'missing', label: '실종 사건', set: { place: '마지막 목격 장소', pressure: 35, trust: 40 } },
      { id: 'serial', label: '연쇄 사건', set: { place: '세 번째 현장', pressure: 55, trust: 35 } },
    ],
    ai: {
      enabled: true,
      vars: ['place', 'suspects', 'truth', 'trust', 'pressure'],
      instruction: '[최초 설정] 아직 수사가 시작되지 않았다. 유저와 함께 사건의 배경(피해자, 현장, 관계자)을 정하는 대화를 하라. 윤곽이 잡히면 확정된 사건 개요를 정리해 서술하라.',
      guide: 'truth에는 범인과 수법을 구체적으로 적되, 서술에는 절대 드러내지 마라.',
    },
  },
};

// ── 경영 ──────────────────────────────────────────────────────
// 배울 점: ① 파생 변수를 이어 붙여 경제 공식을 만드는 법 (수요→판매→매출→순익)
//          ② onTurn으로 매달 정산을 자동화하는 법  ③ 선택지(enum)가 수치에 영향을 주게 하는 법
const BUSINESS = {
  simcore: '0.1',
  meta: { name: '경영 — 가게 운영', author: 'SimCore 템플릿' },
  vars: [
    { id: 'month', label: '경과', type: 'int', init: 1, min: 1, format: '{v}개월차' },
    { id: 'cash', label: '자금', type: 'int', init: 3000, format: '{v}만원' },
    { id: 'staff', label: '직원', type: 'int', init: 2, min: 0, max: 20, format: '{v}명' },
    { id: 'reputation', label: '평판', type: 'int', init: 40, min: 0, max: 100 },
    { id: 'stock', label: '재고', type: 'int', init: 80, min: 0 },
    { id: 'price', label: '판매가', type: 'int', init: 12, min: 1, max: 100, format: '{v}천원',
      desc: '올리면 마진이 늘지만 수요가 준다.' },
    { id: 'quality', label: '품질', type: 'int', init: 55, min: 0, max: 100 },
    { id: 'district', label: '상권', type: 'enum', init: '변두리', enum: ['변두리', '번화가', '역세권'],
      desc: '유동인구와 임대료를 동시에 결정한다.' },
    { id: 'signature', label: '대표 상품', type: 'text', init: '', maxLength: 40 },
    { id: 'crisis', label: '자금난', type: 'bool', init: false },
  ],
  // 파생 변수는 서로를 참조할 수 있다 (순환만 아니면 된다).
  // foot_traffic → demand → sold → revenue → profit 으로 이어지는 계산 사슬.
  derived: [
    { id: 'foot_traffic', label: '유동인구', expr: 'district == "역세권" ? 60 : (district == "번화가" ? 40 : 15)' },
    { id: 'rent', label: '월 임대료', expr: 'district == "역세권" ? 900 : (district == "번화가" ? 600 : 300)' },
    { id: 'demand', label: '월 수요', expr: 'clamp(round(reputation * 1.5 + quality * 0.5 + foot_traffic - (price - 10) * 4), 0, 250)' },
    { id: 'sold', label: '판매량', expr: 'min(demand, stock)' },
    { id: 'revenue', label: '매출', expr: 'sold * price' },
    { id: 'wages', label: '인건비', expr: 'staff * 220' },
    { id: 'profit', label: '월 순익', expr: 'revenue - wages - rent' },
  ],
  rules: {
    // 순서가 중요하다 — 규칙은 위에서부터 차례로 적용되고, 그때마다 파생 변수가 다시 계산된다.
    // 재고를 먼저 깎으면 판매량(sold)이 달라져 매출이 틀어지므로 자금 정산을 먼저 한다.
    onTurn: [
      { set: 'cash', expr: 'cash + profit' },
      { set: 'stock', expr: 'stock - sold' },
      { set: 'reputation', expr: 'clamp(reputation + (quality >= 65 ? 3 : (quality <= 35 ? -4 : 0)), 0, 100)' },
      { set: 'month', expr: 'month + 1' },
    ],
    events: [
      { id: 'stockout', when: 'stock <= 0',
        effects: [{ set: 'reputation', expr: 'reputation - 3' }],
        notify: '재고가 바닥났다. 헛걸음한 손님들이 발길을 돌린다.' },
      { id: 'deficit', when: 'cash < 0 and not crisis',
        effects: [{ set: 'crisis', expr: '1' }],
        notify: '통장이 마이너스로 돌아섰다. 자금난이 시작됐다.' },
      { id: 'recovered', when: 'cash >= 1000 and crisis',
        effects: [{ set: 'crisis', expr: '0' }],
        notify: '자금 사정이 안정을 되찾았다.' },
      { id: 'famous', once: true, when: 'reputation >= 85',
        notify: '가게가 지역 명소로 자리 잡았다. 줄이 늘어서기 시작한다.' },
    ],
    randomEvents: {
      chancePerTurn: 0.3,
      table: [
        { id: 'influencer', weight: 3, when: 'quality >= 60', cooldown: 5,
          effects: [{ set: 'reputation', expr: 'reputation + 12' }],
          notify: '인플루언서가 다녀간 뒤 후기가 퍼졌다.' },
        { id: 'inspection', weight: 2, when: 'quality < 50', cooldown: 6,
          effects: [{ set: 'cash', expr: 'cash - 300' }, { set: 'reputation', expr: 'reputation - 8' }],
          notify: '위생 점검에서 지적을 받아 과태료를 물었다.' },
        { id: 'rush', weight: 3, cooldown: 3,
          effects: [{ set: 'cash', expr: 'cash + round(price * 8)' }, { set: 'stock', expr: 'stock - 8' }],
          notify: '단체 손님이 몰려 잠깐 정신없이 바빴다.' },
        { id: 'quit', weight: 2, when: 'staff >= 2', cooldown: 6,
          effects: [{ set: 'staff', expr: 'staff - 1' }],
          notify: '직원 하나가 그만두겠다는 말을 남겼다.' },
      ],
    },
  },
  directives: [
    { id: 'crisis_mood', when: 'crisis',
      text: '[상태] 자금난이다 (잔고 {cash}만원). 결제 압박, 미뤄둔 대금, 초조함이 장면에 드러나야 한다.' },
    { id: 'empty_shelf', when: 'stock <= 0',
      text: '[상태] 팔 물건이 없다. 빈 진열대와 돌아서는 손님을 묘사하라.' },
    { id: 'busy', when: 'reputation >= 75',
      text: '[상태] 평판이 높아 손님이 붐빈다 (월 수요 {demand}). 활기와 바쁨이 배경에 깔려야 한다.' },
  ],
  actions: [
    { id: 'restock', label: '📦 발주', mode: 'oneshot', cooldown: 1,
      inject: '[경영 결정] 재고를 채워 넣는다.',
      effects: [{ set: 'stock', expr: 'stock + 60' }, { set: 'cash', expr: 'cash - 360' }] },
    { id: 'promote', label: '📣 홍보', mode: 'oneshot', cooldown: 3,
      inject: '[경영 결정] 홍보에 예산을 쓴다.',
      effects: [{ set: 'cash', expr: 'cash - 400' }, { set: 'reputation', expr: 'reputation + 6' }] },
    { id: 'hire', label: '🧑‍🍳 채용', mode: 'oneshot', when: 'cash >= 500', cooldown: 4,
      inject: '[경영 결정] 사람을 새로 뽑는다.',
      effects: [{ set: 'staff', expr: 'staff + 1' }, { set: 'cash', expr: 'cash - 500' }] },
    { id: 'improve', label: '⭐ 품질 개선', mode: 'oneshot', cooldown: 2,
      inject: '[경영 결정] 재료와 공정에 더 신경을 쓴다.',
      effects: [{ set: 'quality', expr: 'quality + 8' }, { set: 'cash', expr: 'cash - 300' }] },
  ],
  updater: {
    allow: [
      { id: 'cash', maxDelta: 500 }, { id: 'reputation', maxDelta: 12 },
      { id: 'stock', maxDelta: 50 }, { id: 'quality', maxDelta: 10 },
      { id: 'staff', maxDelta: 2 }, { id: 'signature', maxLength: 40 },
    ],
    guide: '월 정산(매출·인건비·임대료)은 시스템이 자동 계산하니 중복 반영하지 마라. 서사에 나온 돌발 수입·지출만 반영하라.',
  },
  promptState: {
    template: '[가게 현황 — {month}개월차 · {district}]\n'
      + '자금 {cash}만원 (월 순익 {profit}) | 재고 {stock} | 판매가 {price}천원 | 품질 {quality} | 평판 {reputation}/100 | 직원 {staff}명\n'
      + '이번 달 예상: 수요 {demand} → 판매 {sold} → 매출 {revenue} (인건비 {wages}, 임대료 {rent})\n'
      + '대표 상품: {signature}{crisis ? " | ⚠ 자금난" : ""}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '재무', items: [
        { var: 'month' }, { var: 'cash' }, { var: 'profit' },
        { var: 'crisis', showWhen: 'crisis' },
      ] },
      { label: '영업', items: [
        { var: 'stock' }, { var: 'price' }, { var: 'demand' },
        { var: 'quality', bar: { max: 100 } },
        { var: 'reputation', bar: { max: 100 }, color: 'reputation < 30 ? "#c0392b" : "#27ae60"' },
      ] },
      { label: '가게', items: [{ var: 'district' }, { var: 'staff' }, { var: 'signature' }] },
    ],
    // 회계 장부 — 크림색 장부지에 초록 괘선
    customCSS: `.sim-status { background:#f4f6ef; border:1px solid #b9c4ac; border-radius:3px; color:#26301f; }
.sim-status summary { color:#2f6b3a; letter-spacing:.05em; }
.sim-group { border-bottom:1px solid #d8e0cf; padding-bottom:6px; }
.sim-group-label { color:#2f6b3a; font-size:.82em; letter-spacing:.1em; }
.sim-label { color:#5d6b53; opacity:1; }
.sim-value { color:#16210f; font-weight:700; }
.sim-badge, .sim-tag { background:#e4ebd9; color:#3a5c2e; border:1px solid #b9c4ac; border-radius:2px; }
.sim-bar { background:#e0e6d6; height:8px; border-radius:2px; }
.sim-action { border-color:#8fa683; color:#2f6b3a; border-radius:3px; background:#eaf0e2; }
.sim-action.sim-armed { border-color:#2f6b3a; background:#dce9d3; }
.sim-log { color:#6a7860; }`,
  },
  setup: {
    presets: [
      { id: 'small', label: '변두리 소자본', set: { cash: 3000, staff: 1, district: '변두리', quality: 50 } },
      { id: 'mid', label: '번화가 진입', set: { cash: 6000, staff: 3, district: '번화가', reputation: 50 } },
      { id: 'allin', label: '역세권 올인', set: { cash: 9000, staff: 4, district: '역세권', quality: 70, reputation: 30 } },
    ],
    ai: {
      enabled: true,
      vars: ['cash', 'staff', 'district', 'signature', 'quality', 'price'],
      instruction: '[최초 설정] 아직 개업 전이다. 유저와 함께 업종, 상권, 대표 상품, 초기 자본을 정하는 대화를 하라. 정해지면 개업 직전 상황을 정리해 서술하라.',
      guide: '유저가 말한 업종과 컨셉에 맞게 값을 정하라.',
    },
  },
};

// ── 연애 ──────────────────────────────────────────────────────
// 배울 점: ① enum으로 관계 단계를 만들고 이벤트로 전이시키는 법
//          ② maxGain/maxLoss를 비대칭으로 줘서 "천천히 쌓이고 빨리 식게" 만드는 법
//          ③ 단계마다 다른 지시문으로 모델의 호칭·거리감을 통제하는 법
//          ④ 시간 체계(time) — 장면 단위 RP에서 날짜·시각을 다루는 표준형 (v0.50).
//             예전의 `onTurn day+1`은 출력 하나 = 하루가 되어 장면 RP를 부쉈다.
//          ⑤ 에셋 팩(assets) — 감정 이미지 자동 삽입의 표준형 (v0.53). 곱셈 목록(인물×감정)을
//             칸 선언(인물+감정)으로 바꾸고, 조합·실존 대조·폴백은 시스템이 한다.
//             예시 팩은 꺼진 채(enabled: false) 실려 있다 — 어휘를 자기 에셋 이름에 맞춘 뒤 켠다.
//          ⑥ 달력(calendar, v0.61) — 기념일 marks(월+일=매년·요일=매주) + 약속 목록(plans).
//             일정 = list 항목 + @기한 규약이라 만료 정리·AI의 @+N 등록이 기존 기계로 돈다.
const ROMANCE = {
  simcore: '0.1',
  meta: { name: '연애 — 관계 시뮬', author: 'SimCore 템플릿' },
  // 개학 직후의 월요일 아침. 진행은 명시적 — 보조가 장면의 흐른 시간을 보고하고,
  // 하루는 🌙 버튼 또는 "다음 날" 도약(skip_day)으로만 넘어간다.
  time: {
    start: '2026-03-02 08:30',
    advance: 'explicit',
    format: { date: 'M월 D일', clock: 'HH:mm' },
  },
  // 달력 (v0.61) — [📅] 버튼 → 월 그리드. 기념일은 marks가, 약속은 plans 목록이,
  // 계약·버프의 @기한은 자동으로 표시된다. 날짜 클릭 → 약속 등록.
  calendar: {
    label: '달력', icon: '📅', list: 'plans',
    note: '날짜를 누르면 약속을 등록할 수 있다.',
    marks: [
      { label: '상대 생일', month: 5, dom: 14, note: '잊으면 큰일 난다.' },
      { label: '도서부 모임', weekday: '수' },
    ],
  },
  vars: [
    { id: 'affection', label: '호감도', type: 'int', init: 10, min: 0, max: 100 },
    { id: 'tension', label: '설렘', type: 'int', init: 0, min: 0, max: 100,
      desc: '순간적인 두근거림. 시간이 지나면 가라앉는다.' },
    { id: 'jealousy', label: '질투', type: 'int', init: 0, min: 0, max: 100 },
    { id: 'stage', label: '관계', type: 'enum', init: '타인', enum: ['타인', '지인', '친구', '썸', '연인'] },
    { id: 'mood', label: '상대 기분', type: 'enum', init: '보통', enum: ['가라앉음', '보통', '밝음'] },
    { id: 'place', label: '장소', type: 'text', init: '학교 복도', maxLength: 40 },
    { id: 'memories', label: '함께한 기억', type: 'list', init: [], maxItems: 15, itemMaxLength: 40,
      desc: '둘 사이에 실제로 있었던 일. 나중에 대화에서 다시 꺼내 쓴다.' },
    { id: 'confessed', label: '고백함', type: 'bool', init: false },
    // 일정 (v0.61 달력) — 달력 팝업에서 날짜를 눌러 등록하고, AI도 서사에서 잡는다(allow).
    // 항목은 "내용 @경과일" — onTurn expire 규칙이 지난 약속을 스스로 지운다.
    { id: 'plans', label: '약속', type: 'list', init: [], maxItems: 10, itemMaxLength: 30,
      desc: '앞으로 잡힌 약속. 서사에서 새 약속이 잡히면 "내용 @+N"(N일 뒤)으로 추가하라. 날짜가 지나면 자동으로 지워진다.' },
    // 시간 진행 입구 — 엔진이 매 턴 소비 후 0으로 되돌린다. 규칙은 desc에 산다
    // (지시문은 메인 전용이라 상태를 갱신하는 보조 AI가 못 읽는다 — 실측 사고).
    { id: 'skip_day', label: '건너뛴 일수', type: 'int', init: 0, min: 0, max: 30,
      desc: '며칠 통째로 지났나. 같은 날 안이면 0. 자고 일어나 이튿날이면 1. 2 이상은 "며칠 뒤"처럼 명시적으로 건너뛴 만큼만.' },
    { id: 'skip_min', label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 1440,
      desc: '이번 장면에서 흐른 시간(분). 대화 한 토막이면 5~20, 데이트·수업이면 60~180. 날짜가 넘어가면 skip_day를 올리고 여기엔 그날 안에서 흐른 분만.' },
  ],
  derived: [
    { id: 'closeness', label: '친밀도', expr: 'clamp(round(affection * 0.7 + count(memories) * 3), 0, 100)' },
  ],
  rules: {
    // ⚠ onTurn에 day+1을 넣지 않는다 — 날짜는 time 섹션이 관리한다.
    //   설렘·질투 감쇠는 "장면이 넘어가면 가라앉는다"라 턴 단위가 맞다.
    onTurn: [
      { set: 'tension', expr: 'max(tension - 3, 0)' },
      { set: 'jealousy', expr: 'max(jealousy - 2, 0)' },
      // 지난 약속 자동 정리 — @경과일이 elapsed보다 과거인 항목을 스스로 뺀다 (v0.61 달력)
      { list: 'plans', expire: 'elapsed' },
    ],
    // 관계 단계는 호감도가 문턱을 넘을 때 자동으로 올라간다.
    // once를 쓰지 않은 이유: 사이가 나빠져 단계가 내려갔다가 다시 올라올 수 있어야 하기 때문.
    events: [
      { id: 'to_acq', when: 'affection >= 15 and stage == "타인"',
        effects: [{ set: 'stage', expr: '"지인"' }],
        notify: '이제 서로 얼굴과 이름을 아는 사이가 되었다.' },
      { id: 'to_friend', when: 'affection >= 35 and stage == "지인"',
        effects: [{ set: 'stage', expr: '"친구"' }],
        notify: '스스럼없이 말을 걸 수 있는 사이가 되었다.' },
      { id: 'to_crush', when: 'affection >= 60 and stage == "친구"',
        effects: [{ set: 'stage', expr: '"썸"' }],
        notify: '친구라 부르기엔 애매한 공기가 흐르기 시작했다.' },
      { id: 'ready', once: true, when: 'affection >= 75 and not confessed',
        notify: '마음을 전해도 좋을 만큼 분위기가 무르익었다.' },
      { id: 'to_lover', when: 'confessed and stage != "연인"',
        effects: [{ set: 'stage', expr: '"연인"' }],
        notify: '두 사람은 마침내 연인이 되었다.' },
      { id: 'drift', when: 'affection <= 5 and stage != "타인"',
        effects: [{ set: 'stage', expr: '"지인"' }, { set: 'mood', expr: '"가라앉음"' }],
        notify: '사이가 눈에 띄게 서먹해졌다.' },
    ],
    randomEvents: {
      chancePerTurn: 0.35,
      table: [
        { id: 'rain', weight: 2, cooldown: 5,
          effects: [{ set: 'tension', expr: 'tension + 15' }],
          notify: '갑작스러운 비로 좁은 처마 밑에 둘만 남았다.' },
        { id: 'interrupt', weight: 2, when: 'tension >= 30', cooldown: 4,
          effects: [{ set: 'tension', expr: 'tension - 15' }],
          notify: '결정적인 순간에 친구가 끼어들어 분위기가 흩어졌다.' },
        { id: 'gift_recv', weight: 2, when: 'stage != "타인"', cooldown: 6,
          effects: [{ set: 'affection', expr: 'affection + 5' }, { set: 'mood', expr: '"밝음"' }],
          notify: '상대가 작은 선물을 건넸다.' },
        { id: 'rival', weight: 1, when: 'affection >= 40', cooldown: 8,
          effects: [{ set: 'jealousy', expr: 'jealousy + 25' }],
          notify: '상대의 곁에 낯선 사람이 보였다.' },
      ],
    },
  },
  // 단계별 지시문 — 연애 시뮬의 핵심. 모델이 관계 단계를 건너뛰고 들이대는 걸 막는다.
  directives: [
    { id: 'stage_stranger', when: 'stage == "타인" or stage == "지인"',
      text: '[관계 지시] 아직 가까운 사이가 아니다. 존댓말 혹은 서먹한 말투, 조심스러운 거리감을 유지하라. 스킨십·애칭 금지.' },
    { id: 'stage_crush', when: 'stage == "썸"',
      text: '[관계 지시] 연인은 아니다. 확신 대신 망설임, 우연을 가장한 접근, 말끝을 흐리는 여운으로 그려라.' },
    { id: 'stage_lover', when: 'stage == "연인"',
      text: '[관계 지시] 연인 사이다. 호칭과 말투에 편안함과 애정이 묻어나야 한다.' },
    { id: 'high_tension', when: 'tension >= 60',
      text: '[분위기] 설렘 {tension}/100. 시선이 오래 머물고 말이 자꾸 끊기는, 공기가 달아오른 장면으로.' },
    { id: 'jealous', when: 'jealousy >= 50',
      text: '[감정] 질투가 짙다. 티내지 않으려다 새어 나오는 가시 돋친 말투를 섞어라.' },
    { id: 'recall', when: 'count(memories) >= 3',
      text: '[연속성] 함께한 기억({memories:tags})을 대화에서 자연스럽게 다시 꺼내 쓰라.' },
  ],
  actions: [
    { id: 'talk', label: '💬 말 걸기', mode: 'oneshot', cooldown: 1,
      inject: '[플레이어 행동] 먼저 말을 건넨다.',
      effects: [{ set: 'tension', expr: 'tension + 3' }] },
    { id: 'give_gift', label: '🎁 선물', mode: 'oneshot', cooldown: 3,
      inject: '[플레이어 행동] 준비해 온 선물을 건넨다.',
      effects: [{ set: 'affection', expr: 'affection + 5' }, { set: 'mood', expr: '"밝음"' }] },
    { id: 'confess', label: '💗 고백', mode: 'oneshot', when: 'affection >= 70 and not confessed',
      inject: '[플레이어 행동] 용기를 내어 마음을 고백한다.',
      effects: [{ set: 'confessed', expr: '1' }, { set: 'tension', expr: '100' }] },
    // 하루 마무리 — 지금이 몇 시든 "다음 08:00까지"를 분으로 계산해 굳힌다.
    // 자정 전에 누르면 이튿날 아침, 새벽에 누르면 같은 날 아침이 된다.
    { id: 'end_day', label: '🌙 하루를 마친다', mode: 'oneshot', cooldown: 1,
      inject: '[시간] 오늘은 여기까지다. 다음 장면은 이튿날 아침에서 시작하라.',
      effects: [{ set: 'skip_min', expr: '((1919 - hour * 60 - minute) % 1440) + 1' }] },
  ],
  updater: {
    allow: [
      // 호감은 천천히 오르고 빨리 식는다 — maxGain보다 maxLoss를 크게 준다.
      { id: 'affection', maxGain: 8, maxLoss: 15 },
      { id: 'tension', maxDelta: 20 },
      { id: 'jealousy', maxDelta: 20 },
      { id: 'memories' }, { id: 'mood' }, { id: 'place', maxLength: 40 },
      { id: 'plans' },   // 서사에서 잡힌 약속 — "@+N"은 시스템이 절대 날짜로 굳힌다 (v0.61)
      // 시간 진행 보고 — 캡이 도약 폭을 묶는다 ("3일 뒤"까지는 되고 한 달 점프는 안 된다)
      { id: 'skip_day', maxGain: 7 }, { id: 'skip_min', maxGain: 720 },
    ],
    guide: '기억(memories)에는 실제로 있었던 사건만 한 줄로 add하라. 호감도는 상대의 반응이 뚜렷할 때만 움직여라.',
  },
  promptState: {
    template: '[관계 현황 — {date} ({weekday}) {clock} · {stage}]\n'
      + '장소 {place} | 호감 {affection}/100 | 설렘 {tension} | 친밀 {closeness} | 상대 기분 {mood}'
      + '{jealousy >= 30 ? " | 질투 " + jealousy : ""}\n'
      + '함께한 기억: {memories:tags}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '관계', items: [
        { var: 'date' }, { var: 'clock' }, { var: 'stage' },
        { var: 'affection', bar: { max: 100 }, color: 'affection >= 60 ? "#e0559b" : "#5b8def"' },
        { var: 'closeness', bar: { max: 100 } },
      ] },
      { label: '감정', items: [
        { var: 'tension', bar: { max: 100 } },
        { var: 'jealousy', bar: { max: 100 }, showWhen: 'jealousy > 0' },
        { var: 'mood' },
      ] },
      { label: '기록', items: [{ var: 'place' }, { var: 'memories' }] },
    ],
    // 노을 편지지 — 크림빛 종이에 로즈 잉크
    customCSS: `.sim-status { background:linear-gradient(180deg,#fff6f3,#fdeae6); border:1px solid #f0c4bb; border-radius:14px; color:#5a3b3a; box-shadow:0 3px 10px rgba(214,146,140,.18); }
.sim-status summary { color:#d0687a; letter-spacing:.04em; }
.sim-group { background:rgba(255,255,255,.55); border-radius:10px; padding:7px 9px; }
.sim-group-label { color:#c2596c; font-size:.83em; letter-spacing:.08em; }
.sim-label { color:#8a6b6b; opacity:1; }
.sim-value { color:#4a2c2c; font-weight:700; }
.sim-badge, .sim-tag { background:#fce0e4; color:#b04b60; border:1px solid #f2c3cb; }
.sim-bar { background:#f7dcdc; height:9px; }
.sim-bar-fill { background:linear-gradient(90deg,#f4a6b8,#e0559b); }
.sim-action { border-color:#eeb6bd; color:#c2596c; background:#fff2f3; }
.sim-action.sim-armed { border-color:#e0559b; background:#fbdde5; }
.sim-log { color:#9b7d7d; }`,
  },
  // 에셋 팩 — 감정 이미지 자동 삽입의 실물 예시 (설계: docs/design-에셋-슬롯.md).
  // 매 턴 손으로 싣던 이미지 지침(인물×감정 곱셈 목록)이 이 선언 하나로 대체된다.
  // by: 'aux'(기본) = 보조 AI가 상태 갱신에 얹어 인물·감정만 고르고(추가 호출 0),
  // 조합·실존 대조·폴백 사다리는 시스템 몫 — 없는 조합은 폴백 감정으로 강등되거나 조용히 생략된다.
  // ⚠ 꺼진 채 실려 있다: 어휘가 실물 에셋 이름과 같아야 작동하므로, 캐릭터에 Hana_smile 형태의
  // 에셋을 넣고 값을 맞춘 뒤(또는 편집기 🎨 층의 [🔍 에셋에서 자동 감지]로 새 팩을 만든 뒤) 켠다.
  assets: {
    packs: [
      { id: 'partner', source: '이 봇 자체', enabled: false, sep: '_',
        // format = 봇의 표시 규약 그대로. {name}에 조합 결과(예: Hana_smile)가 들어간다.
        format: '<img="{name}">',
        slots: [
          // who 칸의 값 = 에셋 이름 앞부분이자 이 팩의 담당 인물. 인물이 늘면 값만 늘린다 —
          // 감정 축은 공용이라 목록은 곱셈(인물×감정)이 아니라 덧셈(인물+감정)으로 는다.
          { id: 'who', label: '인물', values: ['Hana'] },
          // fallback: 정조합(Hana_shy)이 실물에 없을 때 이 값(Hana_normal)으로 강등해 재시도.
          // 인물마다 감정 이미지 개수가 달라도 합집합 한 번만 선언하면 되는 이유.
          { id: 'emo', label: '감정', fallback: 'normal',
            values: ['normal', 'smile', 'shy', 'angry', 'sad', 'surprised'] },
        ] },
    ],
  },
  setup: {
    presets: [
      { id: 'classmate', label: '같은 반 친구', set: { stage: '지인', affection: 20, place: '교실' } },
      { id: 'firstmeet', label: '초면', set: { stage: '타인', affection: 5, place: '거리' } },
      { id: 'reunion', label: '재회', set: { stage: '친구', affection: 40, place: '오랜만의 약속 장소' } },
      // startAt (v0.51) — 시계도 시작값의 일부. 진행 중 채팅에서 눌러도 시계가 이 시점으로
      // 점프한다 ("작중은 10월인데 상태창이 3월" 지원 사례의 처방 — /날짜 명령과 짝).
      { id: 'autumn', label: '2학기 — 가을부터', set: { stage: '지인', affection: 25, place: '교실' },
        startAt: '2026-10-05 08:30' },
    ],
    ai: {
      enabled: true,
      vars: ['place', 'affection', 'stage', 'mood'],
      instruction: '[최초 설정] 아직 이야기가 시작되지 않았다. 유저와 함께 상대 인물과 두 사람의 관계, 첫 장면의 배경을 정하는 대화를 하라. 정해지면 첫 만남 직전 상황을 정리해 서술하라.',
      guide: '유저가 정한 관계 설정에 맞는 단계와 호감도로 시작하라.',
    },
  },
};

// ── TRPG ──────────────────────────────────────────────────────
// 배울 점: ① checks(판정)로 주사위를 일급으로 쓰는 법 — 굴림·보정·등급·연출 지시가 한 덩어리
//          ② "주사위 상시 활성화" — 지속형(hold) 액션에 check를 달면 켜 둔 동안 매 턴 굴린다.
//             어느 능력으로 구르는지는 enum 변수(check_stat) 하나가 정한다: 보정식이 그걸 읽고,
//             보조 AI가 장면에 맞게 유지하며, /능력 명령으로 즉석 지정도 된다 (명령은 전송 시점에
//             먼저 적용되므로 같은 턴 굴림에 반영). 버튼 4개를 1개로 줄이는 통합 패턴
//          ③ 소모성 변수(이점 adv)는 굴림식이 읽고, 끄는 건 액션 effects에 두는 분업
//          ④ 이벤트에 check를 달면 "AI가 판정이 필요하다고 하면 시스템이 대신 굴리는" 배선이 된다
//          ⑤ 판정 결과는 변수가 아니라 시스템 기록(meta)이라 보조 AI가 뒤집을 방법이 없다
//          (v0.39까지는 roll/total/grade 변수 5개 + 규칙으로 손조립했다 — 그 패턴의 일급화)
const TRPG = {
  simcore: '0.1',
  meta: { name: 'TRPG — 주사위 판정', author: 'SimCore 템플릿' },
  vars: [
    { id: 'str', label: '근력', type: 'int', init: 14, min: 3, max: 20 },
    { id: 'dex', label: '민첩', type: 'int', init: 12, min: 3, max: 20 },
    { id: 'wit', label: '지력', type: 'int', init: 10, min: 3, max: 20 },
    { id: 'cha', label: '매력', type: 'int', init: 10, min: 3, max: 20 },
    { id: 'hp', label: 'HP', type: 'int', init: 20, min: 0, max: 40 },
    { id: 'stamina', label: '기력', type: 'int', init: 6, min: 0, max: 10 },
    { id: 'dc', label: '난이도', type: 'int', init: 13, min: 5, max: 30,
      desc: '이번 상황의 판정 난이도. 쉬우면 10, 보통 13, 어려우면 17, 지극히 어려우면 20.' },
    { id: 'dmg', label: '피해량', type: 'int', init: 0, min: 0, max: 99,
      desc: '이번 공격이 입힌 피해. 판정이 정하고, 다음 턴에 0으로 돌아간다.' },
    { id: 'adv', label: '이점 대기', type: 'bool', init: false,
      desc: '켜져 있으면 다음 판정을 두 번 굴려 높은 눈을 쓴다. 쓰면 꺼진다.' },
    { id: 'check_stat', label: '판정 능력', type: 'enum', init: '근력', enum: ['근력', '민첩', '지력', '매력'], cmd: '능력',
      desc: '상시 판정이 어느 능력으로 구르는지. 지금 장면의 시도에 맞는 능력으로 유지하라 — 힘쓰기는 근력, 재빠른 움직임은 민첩, 추리·지식은 지력, 설득·언변은 매력.' },
    { id: 'need_roll', label: '판정 요청', type: 'bool', init: false,
      desc: '서사상 판정이 필요한데 유저가 버튼을 누르지 않았을 때 켠다. 시스템이 대신 굴린다.' },
    { id: 'conditions', label: '상태', type: 'list', init: [], maxItems: 6, itemMaxLength: 20 },
  ],
  // 능력 보정 = (능력치 - 10) / 2 를 내림. D&D식 계산을 한 줄로 못 박아 둔다.
  derived: [
    { id: 'str_mod', label: '근력 보정', expr: 'floor((str - 10) / 2)' },
    { id: 'dex_mod', label: '민첩 보정', expr: 'floor((dex - 10) / 2)' },
    { id: 'wit_mod', label: '지력 보정', expr: 'floor((wit - 10) / 2)' },
    { id: 'cha_mod', label: '매력 보정', expr: 'floor((cha - 10) / 2)' },
  ],
  // 판정 — 굴림·보정·목표치·등급이 한 덩어리. 결과 줄([판정])과 등급 연출 지시는 엔진이 주입한다.
  // 굴림식이 adv(이점)를 읽는다 — 끄는 건 각 액션의 effects 몫 (굴림이 끝난 뒤에 적용되므로 안전).
  checks: [
    // 자유 판정 — 어느 능력으로 구를지는 check_stat(enum)이 정한다. 보정식이 그걸 읽으므로
    // 버튼 하나로 네 능력을 다 감당한다. 능력은 보조 AI가 장면 따라 유지 + /능력 으로 즉석 지정.
    { id: 'ck_free', label: '판정', roll: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)',
      mod: 'check_stat == "근력" ? str_mod : (check_stat == "민첩" ? dex_mod : (check_stat == "지력" ? wit_mod : cha_mod))',
      vs: 'dc',
      grades: [
        { when: 'roll == 20', label: '대성공', inject: '기대 이상의 성과다 — 극적으로 그려라.' },
        { when: 'roll == 1', label: '대실패', inject: '단순한 실패가 아니라 상황을 악화시키는 대실패로 그려라.' },
        { when: 'total >= vs', label: '성공' },
        { label: '실패' },
      ] },
    // 공격은 등급 효과로 피해 주사위(2d8/1d8)와 대실패 반격까지 굴린다 — roll/total을 효과에서도 쓸 수 있다
    { id: 'ck_attack', label: '공격 판정', roll: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)',
      mod: 'str_mod', vs: 'dc',
      grades: [
        { when: 'roll == 20', label: '대성공', inject: '압도적인 일격이다 — 극적으로 그려라.',
          effects: [{ set: 'dmg', expr: 'rand(1, 8) + rand(1, 8) + str_mod' }] },
        { when: 'roll == 1', label: '대실패', inject: '빈틈을 내주고 반격까지 허용한 대실패로 그려라.',
          effects: [{ set: 'hp', expr: 'hp - rand(1, 4)' }] },
        { when: 'total >= vs', label: '성공',
          effects: [{ set: 'dmg', expr: 'rand(1, 8) + str_mod' }] },
        { label: '실패' },
      ] },
  ],
  rules: {
    // 피해량은 판정이 정한 그 턴에만 의미가 있다 — 다음 턴 정산에서 0으로 되돌린다.
    onTurn: [
      { set: 'dmg', expr: '0' },
      { set: 'stamina', expr: 'min(stamina + 1, 10)' },
    ],
    events: [
      // 보조 모델이 "판정이 필요하다"고 판단하면 need_roll을 켠다 → 시스템이 대신 굴린다.
      // check를 달면 굴림·등급은 판정이 처리하고, 이벤트 effects는 뒷정리(이점 소모·깃발 내리기)만 한다.
      // (능력은 check_stat 기준 — 결과 줄은 다음 전송에 통지로 합류한다)
      { id: 'do_roll', when: 'need_roll', check: 'ck_free',
        effects: [
          { set: 'adv', expr: '0' },
          { set: 'need_roll', expr: '0' },
        ],
        notify: '판정이 필요한 상황이라 주사위를 굴렸다.' },
      { id: 'downed', when: 'hp <= 0',
        effects: [{ list: 'conditions', add: ['빈사'] }, { set: 'hp', expr: '1' }],
        notify: '치명상을 입고 쓰러졌다. 간신히 숨만 붙어 있다.' },
      { id: 'exhausted', when: 'stamina <= 0',
        effects: [{ list: 'conditions', add: ['탈진'] }],
        notify: '기력이 바닥났다. 몸이 말을 듣지 않는다.' },
    ],
    randomEvents: {
      chancePerTurn: 0.22,
      table: [
        { id: 'ambush', weight: 3, cooldown: 4,
          effects: [{ set: 'hp', expr: 'hp - rand(1, 6)' }],
          notify: '기습을 당했다. 미처 피하지 못하고 한 대 맞았다.' },
        { id: 'find', weight: 2, cooldown: 5,
          effects: [{ set: 'stamina', expr: 'min(stamina + 3, 10)' }],
          notify: '쉴 만한 자리를 찾아 잠시 숨을 돌렸다.' },
        { id: 'omen', weight: 1, cooldown: 8,
          effects: [{ set: 'adv', expr: '1' }],
          notify: '기묘한 행운의 조짐이 스쳤다. 다음 시도가 유리하게 풀릴 것 같다.' },
      ],
    },
  },
  // "판정 결과를 따르라"는 지시문이 아니라 엔진이 붙인다 — [판정] 줄이 있는 턴에만 판정 규칙 줄이 따라온다.
  directives: [
    { id: 'dmg_note', when: 'dmg > 0',
      text: '[피해] 이번 공격으로 {dmg}의 피해를 입혔다. 수치를 본문에 적지 말고 타격의 무게로 묘사하라.' },
    { id: 'hurt', when: 'hp <= 6',
      text: '[상태] HP {hp}/40. 숨이 가쁘고 시야가 흐려지는, 한 대만 더 맞으면 무너질 몸 상태를 묘사하라.' },
    { id: 'ask_roll', when: 'not need_roll',
      text: '[판정 안내] 성패가 갈릴 행동인데 [판정] 결과가 함께 제시되지 않았다면, 결과를 임의로 정하지 말고 '
        + '판정이 필요하다는 것만 드러내라. 수치 판정은 시스템이 처리한다.' },
  ],
  // 판정 달린 액션 — 굴림·등급은 check가 맡고, effects에는 뒷정리(이점 소모·기력 소비)만 남는다.
  // 액션 effects는 굴림이 끝난 뒤 적용되므로 여기서 adv를 꺼도 이번 굴림에는 이미 반영돼 있다.
  actions: [
    // 상시 판정 — 켜 두면 매 전송마다 굴린다 ("행동마다 주사위"). 순수 대화 턴엔 꺼 두면 된다.
    // 능력 선택은 check_stat 몫이라 버튼은 하나면 된다.
    { id: 'auto_roll', label: '🎲 상시 판정', mode: 'hold', check: 'ck_free',
      inject: '[행동] 이번 시도를 판정에 부친다.',
      effects: [{ set: 'adv', expr: '0' }] },
    { id: 'attack', label: '⚔ 공격', mode: 'oneshot', when: 'stamina >= 1', check: 'ck_attack',
      inject: '[행동] 무기를 들어 공격한다.',
      effects: [{ set: 'stamina', expr: 'stamina - 1' }, { set: 'adv', expr: '0' }] },
    { id: 'focus', label: '✨ 집중 (다음 판정 이점)', mode: 'oneshot', when: 'not adv', cooldown: 4,
      inject: '[행동] 호흡을 가다듬고 다음 순간에 집중한다.',
      effects: [{ set: 'adv', expr: '1' }, { set: 'stamina', expr: 'stamina - 1' }] },
  ],
  updater: {
    allow: [
      { id: 'dc', maxDelta: 8 }, { id: 'need_roll' }, { id: 'check_stat' },
      { id: 'hp', maxDelta: 10 }, { id: 'stamina', maxDelta: 3 },
      { id: 'conditions' },
    ],
    guide: '주사위 판정은 시스템이 굴린다 — 결과를 절대 정하지 마라. '
      + '판정 능력(check_stat)은 지금 장면의 시도에 맞게 유지하라 (힘쓰기 근력 / 몸놀림 민첩 / 추리 지력 / 언변 매력). '
      + '서사에 성패가 갈릴 시도가 나왔는데 아직 판정이 없으면 need_roll을 true로, dc는 상황 난이도에 맞게 정하라.',
  },
  promptState: {
    template: '[캐릭터] HP {hp}/40 | 기력 {stamina}/10 | 근력 {str}({str_mod}) 민첩 {dex}({dex_mod}) 지력 {wit}({wit_mod}) 매력 {cha}({cha_mod})\n'
      + '상태: {conditions:tags}{adv ? " | ✨이점 대기" : ""} | 난이도 {dc}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '판정', items: [
        { var: 'check_stat' },
        { var: 'dc' },
        { var: 'adv', showWhen: 'adv' },
      ] },
      { label: '상태', items: [
        { var: 'hp', bar: { max: 40 }, color: 'hp <= 8 ? "#c0392b" : "#27ae60"' },
        { var: 'stamina', bar: { max: 10 } },
        { var: 'conditions' },
      ] },
      { label: '능력치', visibility: 'collapsed', items: [
        { var: 'str' }, { var: 'dex' }, { var: 'wit' }, { var: 'cha' },
      ] },
    ],
    // 룰북 석판 — 짙은 남보라 위에 주사위 금색
    customCSS: `.sim-status { background:#15121f; border:1px solid #3d3357; border-radius:5px; color:#d6d0e6; }
.sim-status summary { color:#c9a84c; letter-spacing:.08em; }
.sim-group { border-left:2px solid #3d3357; padding-left:9px; }
.sim-group-label { color:#a08ad0; font-size:.8em; letter-spacing:.13em; }
.sim-label { color:#8b83a6; opacity:1; }
.sim-value { color:#f2ecff; font-weight:700; }
.sim-badge, .sim-tag { background:#221c33; color:#c9a84c; border:1px solid #3d3357; border-radius:3px; }
.sim-bar { background:#100d18; height:9px; border:1px solid #2a2340; border-radius:2px; }
.sim-action { border-color:#4a3f6b; color:#bda6f0; border-radius:3px; background:#1d1830; }
.sim-action.sim-armed { border-color:#c9a84c; background:#2a2136; color:#e8cf86; }
.sim-log { color:#7a7291; }`,
  },
  setup: {
    presets: [
      { id: 'fighter', label: '전사 (근력형)', set: { str: 16, dex: 12, wit: 9, cha: 10, hp: 26, stamina: 8 } },
      { id: 'rogue', label: '도적 (민첩형)', set: { str: 10, dex: 16, wit: 13, cha: 12, hp: 18, stamina: 7 } },
      { id: 'mage', label: '학자 (지력형)', set: { str: 8, dex: 11, wit: 17, cha: 13, hp: 14, stamina: 5 } },
      { id: 'bard', label: '유랑객 (매력형)', set: { str: 10, dex: 13, wit: 12, cha: 16, hp: 16, stamina: 6 } },
    ],
    ai: {
      enabled: true,
      vars: ['str', 'dex', 'wit', 'cha', 'hp'],
      instruction: '[최초 설정] 아직 모험이 시작되지 않았다. 유저와 함께 캐릭터(직업, 성격, 특기)와 첫 장면을 정하는 대화를 하라. 정해지면 능력치를 배분하고 상황을 정리해 서술하라.',
      guide: '능력치 합이 대략 46~50이 되게 배분하라. 주력 능력은 16 이상, 약점은 10 이하로 뚜렷하게 만들어라.',
    },
  },
};

// ── 생존 ──────────────────────────────────────────────────────
// 배울 점: ① 소비가 생산을 앞지르는 "고갈 압박"을 수치로 세우는 법
//          ② 정책(enum) 하나가 파생 사슬 전체를 흔들게 배선하는 법 (난방 → 실내온도 & 연료소모 동시에)
//          ③ 파국(붕괴)을 이벤트로 잠가서 AI가 얼버무리지 못하게 만드는 법
//          ④ **1턴 = 1일이 장르 문법인 봇**의 시간 처리 — `advance: "perTurn"` (v0.51).
//             옛 `onTurn day+1`과 동작은 같지만 날짜가 epoch 하나에서 나와 어긋날 수 없고,
//             진짜 달력이라 요일·월이 덤으로 생긴다. 표시용 "N일차"는 파생으로 만든다.
const SURVIVAL = {
  simcore: '0.1',
  meta: { name: '생존 — 혹한의 정착지', author: 'SimCore 템플릿' },
  // 초겨울에 정착. 일지 한 장 = 하루라 진행은 perTurn — 이 장르에서는 그게 옳다.
  time: { start: '2026-12-01 07:00', advance: 'perTurn', format: { date: 'M월 D일' } },
  vars: [
    { id: 'temp', label: '외부 기온', type: 'int', init: -20, min: -60, max: 10, format: '{v}°C',
      desc: '매일 1도씩 떨어진다. 한파가 오면 더 내려간다.' },
    { id: 'coal', label: '석탄', type: 'int', init: 400, min: 0 },
    { id: 'food', label: '식량', type: 'int', init: 380, min: 0 },
    { id: 'people', label: '생존자', type: 'int', init: 40, min: 0, format: '{v}명' },
    { id: 'sick', label: '환자', type: 'int', init: 0, min: 0, format: '{v}명' },
    { id: 'hope', label: '희망', type: 'int', init: 60, min: 0, max: 100 },
    { id: 'discontent', label: '불만', type: 'int', init: 15, min: 0, max: 100 },
    { id: 'heat', label: '난방 출력', type: 'enum', init: '보통', enum: ['정지', '약', '보통', '최대'],
      desc: '올리면 따뜻하지만 석탄이 훨씬 빨리 준다.' },
    { id: 'ration', label: '배급', type: 'enum', init: '정상', enum: ['중단', '절반', '정상', '넉넉히'],
      desc: '줄이면 식량이 오래 가지만 불만과 환자가 는다.' },
    { id: 'shelter', label: '단열', type: 'int', init: 1, min: 1, max: 5, format: '{v}단계' },
    { id: 'laws', label: '시행 법령', type: 'list', init: [], maxItems: 6 },
    { id: 'collapsed', label: '통제 붕괴', type: 'bool', init: false },
  ],
  // 난방 정책 하나가 실내온도와 석탄소모를 동시에 흔든다 — 이게 트레이드오프의 뼈대다.
  derived: [
    // 표시·조건용 "N일차" — 시작일이 elapsed 0이므로 +1. 파생이라 읽기 전용이고,
    // 값이 epoch 하나에서 나오므로 옛 day 변수처럼 따로 놀 수가 없다.
    { id: 'day_no', label: '경과', expr: 'elapsed + 1', format: '{v}일차' },
    { id: 'heat_out', label: '화로 출력', expr: 'heat == "최대" ? 3 : (heat == "보통" ? 2 : (heat == "약" ? 1 : 0))' },
    { id: 'indoor', label: '실내 온도', expr: 'temp + heat_out * 9 + shelter * 2', format: '{v}°C' },
    { id: 'cold_grade', label: '체감',
      expr: 'indoor < -15 ? "치명적" : (indoor < -5 ? "혹한" : (indoor < 5 ? "쌀쌀함" : "견딜 만함"))' },
    { id: 'coal_burn', label: '일 석탄소모', expr: 'heat_out * 14 + 5' },
    { id: 'food_need', label: '일 식량소모',
      expr: 'round(people * (ration == "넉넉히" ? 1.5 : (ration == "정상" ? 1 : (ration == "절반" ? 0.5 : 0))))' },
    { id: 'coal_left', label: '석탄 잔여', expr: 'coal_burn > 0 ? floor(coal / coal_burn) : 99', format: '{v}일분' },
    { id: 'food_left', label: '식량 잔여', expr: 'food_need > 0 ? floor(food / food_need) : 99', format: '{v}일분' },
    { id: 'workforce', label: '가용 인력', expr: 'max(0, people - sick)', format: '{v}명' },
  ],
  rules: {
    // 순서 주의 — 소모를 먼저 반영한 뒤 그 결과(추위·굶주림)로 사람이 상한다.
    onTurn: [
      { set: 'coal', expr: 'max(0, coal - coal_burn)' },
      { set: 'food', expr: 'max(0, food - food_need)' },
      { set: 'sick', expr: 'clamp(sick + (indoor < -15 ? round(people * 0.10) : (indoor < -5 ? round(people * 0.04) : -2)), 0, people)' },
      { set: 'discontent', expr: 'clamp(discontent + (ration == "중단" ? 9 : (ration == "절반" ? 4 : (ration == "넉넉히" ? -3 : 0))) + (indoor < -5 ? 3 : 0), 0, 100)' },
      { set: 'hope', expr: 'clamp(hope + (((cold_grade == "견딜 만함") and (food > 0)) ? 2 : -3), 0, 100)' },
      { set: 'temp', expr: 'max(-60, temp - 1)' },
      // ⚠ 여기에 day+1을 두지 않는다 — 날짜는 time 섹션(perTurn)이 스스로 넘긴다.
    ],
    events: [
      { id: 'fuel_out', when: 'coal <= 0 and heat != "정지"',
        effects: [{ set: 'heat', expr: '"정지"' }],
        notify: '석탄이 바닥났다. 화로가 꺼지고 온기가 빠르게 빠져나간다.' },
      { id: 'starving', when: 'food <= 0',
        effects: [{ set: 'discontent', expr: 'discontent + 7' }, { set: 'hope', expr: 'hope - 5' }],
        notify: '배급할 식량이 없다. 빈 그릇을 든 줄이 말없이 흩어진다.' },
      { id: 'freeze_death', when: 'indoor < -20 and people > 0',
        effects: [{ set: 'people', expr: 'max(0, people - max(1, round(people * 0.05)))' },
                  { set: 'hope', expr: 'hope - 8' }],
        notify: '밤사이 얼어 죽은 사람이 나왔다.' },
      // 효과가 조건 자체를 해소하도록 짜면 쿨다운 없이도 매턴 반복되지 않는다.
      { id: 'epidemic', when: 'people > 0 and sick >= round(people * 0.35)',
        effects: [{ set: 'people', expr: 'max(0, people - 2)' },
                  { set: 'sick', expr: 'round(sick * 0.5)' },
                  { set: 'discontent', expr: 'discontent + 10' }],
        notify: '환자가 너무 많다. 병이 정착지 전체로 번지고 있다.' },
      { id: 'riot', when: 'discontent >= 85 and not collapsed',
        effects: [{ set: 'collapsed', expr: '1' }],
        notify: '군중이 화로 앞을 점거했다. 통제가 무너졌다.' },
      { id: 'despair', when: 'hope <= 0 and not collapsed',
        effects: [{ set: 'collapsed', expr: '1' }],
        notify: '아무도 더는 명령을 듣지 않는다. 정착지가 스스로 무너졌다.' },
      // once가 맞는 자리 — "겨울을 넘겼다"는 다시 오지 않는 일회성 전개다.
      // (오르내리는 게이지의 문턱이면 once가 아니라 경보 플래그 래치 짝을 쓴다)
      { id: 'survived', once: true, when: 'day_no >= 30 and not collapsed',
        effects: [{ set: 'hope', expr: 'min(100, hope + 20)' }],
        notify: '기온이 처음으로 올라갔다. 최악의 겨울을 넘겼다.' },
    ],
    randomEvents: {
      chancePerTurn: 0.35,
      table: [
        { id: 'coldsnap', weight: 3, cooldown: 4,
          effects: [{ set: 'temp', expr: 'max(-60, temp - rand(4, 9))' }],
          notify: '한파가 몰아쳤다. 창틀에 서리가 두껍게 앉는다.' },
        { id: 'refugees', weight: 2, when: 'people < 80', cooldown: 5,
          effects: [{ set: 'people', expr: 'people + rand(3, 8)' }, { set: 'food', expr: 'max(0, food - 20)' }],
          notify: '얼어붙은 지평선에서 생존자 무리가 걸어 들어왔다.' },
        { id: 'salvage', weight: 3, cooldown: 3,
          effects: [{ set: 'coal', expr: 'coal + rand(40, 90)' }],
          notify: '무너진 창고 아래에서 쓸 만한 석탄을 파냈다.' },
        { id: 'breakdown', weight: 2, when: 'heat != "정지"', cooldown: 4,
          effects: [{ set: 'coal', expr: 'max(0, coal - rand(30, 70))' }, { set: 'discontent', expr: 'discontent + 5' }],
          notify: '증기 배관이 터졌다. 수리하는 동안 석탄이 헛되이 탔다.' },
        { id: 'sermon', weight: 2, when: 'hope < 60', cooldown: 5,
          effects: [{ set: 'hope', expr: 'min(100, hope + 10)' }, { set: 'discontent', expr: 'max(0, discontent - 6)' }],
          notify: '누군가 사람들 앞에서 봄 이야기를 했다. 오랜만에 웃음이 돌았다.' },
      ],
    },
  },
  directives: [
    { id: 'deadly_cold', when: 'indoor < -15',
      text: '[상태] 실내조차 {indoor}°C다. 입김, 성에, 곱은 손가락 — 추위가 장면의 전면에 나와야 한다.' },
    { id: 'hungry', when: 'food <= 0',
      text: '[상태] 식량이 없다. 배고픔과 그로 인한 다툼이 드러나야 한다.' },
    { id: 'unrest', when: 'discontent >= 65 and not collapsed',
      text: '[상태] 불만 {discontent}. 대놓고 항의하는 사람이 생겼고, 시선이 곱지 않다.' },
    { id: 'broken', when: 'collapsed',
      text: '[상태] 통제가 무너졌다. 명령이 먹히지 않는다는 사실을 전제로 서술하라.' },
  ],
  actions: [
    { id: 'stoke', label: '🔥 화로 최대', mode: 'oneshot', when: 'coal > 0',
      inject: '[결정] 화로 출력을 최대로 올린다.',
      effects: [{ set: 'heat', expr: '"최대"' }] },
    { id: 'save_fuel', label: '🧊 화로 절약', mode: 'oneshot',
      inject: '[결정] 화로 출력을 낮춘다. 추위를 견디기로 했다.',
      effects: [{ set: 'heat', expr: '"약"' }] },
    { id: 'mine', label: '⛏ 채탄 작업', mode: 'oneshot', cooldown: 2, when: 'workforce >= 5',
      inject: '[결정] 인력을 채탄에 투입한다. 추위 속 노동이다.',
      effects: [{ set: 'coal', expr: 'coal + round(workforce * 2.5)' },
                { set: 'sick', expr: 'min(people, sick + 2)' },
                { set: 'discontent', expr: 'discontent + 3' }] },
    { id: 'insulate', label: '🏠 단열 보강', mode: 'oneshot', cooldown: 3, when: 'shelter < 5 and coal >= 60',
      inject: '[결정] 거주구 단열을 보강한다.',
      effects: [{ set: 'shelter', expr: 'shelter + 1' }, { set: 'coal', expr: 'coal - 60' }] },
    { id: 'half_ration', label: '🥣 배급 절반', mode: 'oneshot',
      inject: '[결정] 배급을 절반으로 줄인다.',
      effects: [{ set: 'ration', expr: '"절반"' }] },
    { id: 'full_ration', label: '🍖 배급 정상화', mode: 'oneshot',
      inject: '[결정] 배급을 정상으로 되돌린다.',
      effects: [{ set: 'ration', expr: '"정상"' }] },
  ],
  updater: {
    allow: [
      { id: 'hope', maxDelta: 10 }, { id: 'discontent', maxDelta: 10 },
      { id: 'sick', maxDelta: 5 }, { id: 'people', maxDelta: 3 },
      { id: 'coal', maxDelta: 60 }, { id: 'food', maxDelta: 60 },
      { id: 'temp', maxDelta: 8 }, { id: 'laws' },
    ],
    guide: '매일의 석탄·식량 소모와 기온 하락은 시스템이 자동 계산한다 — 절대 중복 반영하지 마라. '
      + '서사에서 새로 벌어진 일(발견한 물자, 사고, 새 법령, 사망)만 반영하라.',
  },
  promptState: {
    template: '[정착지 — {date} · {day_no}일차]\n'
      + '외부 {temp}°C / 실내 {indoor}°C ({cold_grade}) | 난방 {heat} | 배급 {ration} | 단열 {shelter}\n'
      + '석탄 {coal} ({coal_left} 남음) | 식량 {food} ({food_left} 남음)\n'
      + '생존자 {people}명 (환자 {sick}) | 희망 {hope}/100 | 불만 {discontent}/100{collapsed ? " | ⚠ 통제 붕괴" : ""}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '기온', items: [
        { var: 'date' }, { var: 'day_no' }, { var: 'temp' }, { var: 'indoor' }, { var: 'cold_grade' },
      ] },
      { label: '비축', items: [
        { var: 'coal' }, { var: 'coal_left' }, { var: 'food' }, { var: 'food_left' },
      ] },
      { label: '사람', items: [
        { var: 'people' }, { var: 'sick' },
        { var: 'hope', bar: { max: 100 }, color: 'hope <= 25 ? "#c0392b" : "#27ae60"' },
        { var: 'discontent', bar: { max: 100 }, color: 'discontent >= 70 ? "#c0392b" : "#5b8def"' },
      ] },
      { label: '정책', visibility: 'collapsed', items: [
        { var: 'heat' }, { var: 'ration' }, { var: 'shelter' }, { var: 'laws' },
      ] },
    ],
    customCSS: `.sim-status { background:linear-gradient(180deg,#0e141b,#141b24); border:1px solid #2c3d4d; color:#c6d4e0; }
.sim-status summary { color:#7fb3d5; letter-spacing:.06em; }
.sim-group { border-left:2px solid #2c3d4d; padding-left:9px; }
.sim-group-label { color:#8fa9bd; font-size:.78em; letter-spacing:.14em; }
.sim-label { color:#8296a8; opacity:1; }
.sim-value { color:#e6f0f8; font-weight:700; }
.sim-badge, .sim-tag { background:#1b2733; color:#9ec9e2; border:1px solid #2c3d4d; border-radius:3px; }
.sim-bar { background:#161f29; border:1px solid #24323f; border-radius:2px; height:9px; }
.sim-bar-fill { border-radius:0; }
.sim-action { border-color:#365068; color:#9ec9e2; border-radius:3px; }
.sim-action.sim-armed { border-color:#7fb3d5; background:#1b2733; }
.sim-log { color:#6d8296; }`,
  },
  setup: {
    presets: [
      { id: 'early', label: '초겨울 — 여유 있게 시작', set: { temp: -12, coal: 500, food: 480, people: 45, hope: 70 } },
      { id: 'harsh', label: '한겨울 — 이미 빠듯함', set: { temp: -28, coal: 260, food: 230, people: 38, hope: 50, discontent: 30 } },
      { id: 'ruin', label: '폐허 — 남은 게 거의 없음', set: { temp: -34, coal: 120, food: 90, people: 22, sick: 5, hope: 30, discontent: 45 } },
    ],
    ai: {
      enabled: true,
      vars: ['people', 'coal', 'food', 'temp', 'hope', 'laws'],
      instruction: '[최초 설정] 아직 정착지가 자리 잡지 않았다. 유저와 함께 이곳이 어디이고 왜 여기 모였는지, 누가 이끄는지를 정하는 대화를 하라. 윤곽이 잡히면 정착지의 상황을 정리해 서술하라.',
      guide: '생존자는 20~50명 사이로 잡아라. 물자는 넉넉하게 주지 마라 — 이 시뮬은 부족한 상태에서 시작해야 의미가 있다.',
    },
  },
};

// ── 정치 ──────────────────────────────────────────────────────
// 배울 점: ① 여러 세력의 지지를 따로 굴리고 하나로 묶어 판단 근거를 만드는 법
//          ② 확률(파생)과 주사위(변수)를 비교해 가결/부결을 내는 2단 구조
//          ③ 리스크가 조용히 쌓이다 터지는 "시한폭탄" 패턴
const POLITICS = {
  simcore: '0.1',
  meta: { name: '정치 — 지지율과 파벌', author: 'SimCore 템플릿' },
  vars: [
    { id: 'week', label: '경과', type: 'int', init: 1, min: 1, format: '{v}주차' },
    { id: 'approval', label: '지지율', type: 'int', init: 45, min: 0, max: 100, format: '{v}%' },
    { id: 'capital', label: '정치 자본', type: 'int', init: 50, min: 0, max: 100,
      desc: '설득·무마에 쓰는 소모 자원. 쓰면 줄고 시간이 지나면 회복된다.' },
    { id: 'funds', label: '정치 자금', type: 'int', init: 300, min: 0, format: '{v}백만' },
    { id: 'biz', label: '재계', type: 'int', init: 40, min: 0, max: 100 },
    { id: 'labor', label: '노동계', type: 'int', init: 40, min: 0, max: 100 },
    { id: 'press', label: '언론', type: 'int', init: 50, min: 0, max: 100 },
    { id: 'party', label: '당내', type: 'int', init: 55, min: 0, max: 100 },
    { id: 'econ', label: '경제 기조', type: 'enum', init: '균형', enum: ['성장 우선', '균형', '분배 우선'],
      desc: '어느 쪽으로 기울든 반대편이 등을 돌린다.' },
    { id: 'risk', label: '스캔들 리스크', type: 'int', init: 10, min: 0, max: 100 },
    { id: 'bill', label: '추진 법안', type: 'text', init: '', maxLength: 40 },
    { id: 'bill_roll', label: '표결 주사위', type: 'int', init: 0, min: 0, max: 100 },
    { id: 'bill_result', label: '표결 결과', type: 'enum', init: '없음', enum: ['없음', '가결', '부결'] },
    { id: 'pledges', label: '공약', type: 'list', init: [], maxItems: 8 },
    { id: 'in_scandal', label: '스캔들 진행 중', type: 'bool', init: false },
    { id: 'ousted', label: '실각', type: 'bool', init: false },
  ],
  derived: [
    { id: 'coalition', label: '연합 지지', expr: 'round((biz + labor + press + party) / 4)' },
    { id: 'bill_odds', label: '가결선',
      expr: 'clamp(round(coalition * 0.55 + capital * 0.3 + approval * 0.15), 5, 95)', format: '{v}%' },
    { id: 'standing', label: '입지',
      expr: 'approval >= 65 ? "탄탄함" : (approval >= 45 ? "무난함" : (approval >= 25 ? "흔들림" : "붕괴 직전"))' },
    // 가장 낮은 세력을 이름으로 되돌려준다 — AI에게 "어디를 달래야 하는지" 알려주는 힌트.
    { id: 'weakest', label: '가장 냉담한 쪽',
      expr: 'min(biz, labor, press, party) == biz ? "재계" : (min(biz, labor, press, party) == labor ? "노동계"'
        + ' : (min(biz, labor, press, party) == press ? "언론" : "당내"))' },
  ],
  rules: {
    onTurn: [
      // 지지율은 세력 연합 쪽으로 천천히 끌려간다 — 여론은 관성이 있다.
      { set: 'approval', expr: 'clamp(approval + (coalition > approval ? 2 : -2) + (in_scandal ? -3 : 0), 0, 100)' },
      { set: 'capital', expr: 'clamp(capital + (in_scandal ? -2 : 3), 0, 100)' },
      // 아무것도 안 해도 20주쯤이면 터진다 — 뇌관은 시간이지, 실수가 아니다.
      { set: 'risk', expr: 'clamp(risk + (in_scandal ? 0 : (econ == "성장 우선" ? 4 : (econ == "분배 우선" ? 2 : 3))), 0, 100)' },
      { set: 'week', expr: 'week + 1' },
    ],
    events: [
      { id: 'scandal_breaks', when: 'risk >= 70 and not in_scandal',
        effects: [{ set: 'in_scandal', expr: '1' }, { set: 'approval', expr: 'approval - 12' },
                  { set: 'press', expr: 'press - 10' }, { set: 'risk', expr: '55' }],
        notify: '의혹이 1면에 터졌다. 해명 요구가 빗발친다.' },
      { id: 'scandal_over', when: 'in_scandal and capital >= 70',
        effects: [{ set: 'in_scandal', expr: '0' }, { set: 'capital', expr: 'capital - 25' },
                  { set: 'risk', expr: 'max(0, risk - 35)' }],
        notify: '정치 자본을 쏟아부어 의혹을 덮었다. 대가는 적지 않았다.' },
      // 표결 결과를 소비하고 "없음"으로 되돌린다 — 안 그러면 매턴 다시 발동한다.
      { id: 'bill_passed', when: 'bill_result == "가결"',
        effects: [{ set: 'capital', expr: 'min(100, capital + 10)' },
                  { set: 'approval', expr: 'clamp(approval + 4, 0, 100)' },
                  { set: 'bill_result', expr: '"없음"' }],
        notify: '법안이 본회의를 통과했다.' },
      { id: 'bill_failed', when: 'bill_result == "부결"',
        effects: [{ set: 'capital', expr: 'max(0, capital - 8)' },
                  { set: 'party', expr: 'max(0, party - 6)' },
                  { set: 'bill_result', expr: '"없음"' }],
        notify: '법안이 부결됐다. 당내에서 책임론이 나온다.' },
      { id: 'no_confidence', when: 'approval < 20 and party < 30 and not ousted',
        effects: [{ set: 'ousted', expr: '1' }],
        notify: '당이 등을 돌렸다. 사퇴 요구가 공식화됐다.' },
      { id: 'landslide', once: true, when: 'approval >= 75',
        effects: [{ set: 'capital', expr: 'min(100, capital + 15)' }],
        notify: '지지율이 압도적이다. 반대파가 목소리를 낮췄다.' },
    ],
    randomEvents: {
      chancePerTurn: 0.35,
      table: [
        { id: 'expose', weight: 3, when: 'press < 60', cooldown: 4,
          effects: [{ set: 'risk', expr: 'min(100, risk + rand(10, 25))' }],
          notify: '한 매체가 뒤를 캐고 다닌다는 말이 들려온다.' },
        { id: 'strike', weight: 2, when: 'labor < 45', cooldown: 5,
          effects: [{ set: 'approval', expr: 'max(0, approval - rand(3, 8))' },
                    { set: 'biz', expr: 'max(0, biz - 4)' }],
          notify: '총파업이 시작됐다. 도심이 멈췄다.' },
        { id: 'donation', weight: 2, when: 'biz >= 50', cooldown: 5,
          effects: [{ set: 'funds', expr: 'funds + rand(80, 200)' }, { set: 'risk', expr: 'min(100, risk + 8)' }],
          notify: '재계에서 후원이 들어왔다. 받는 순간 약점도 같이 생겼다.' },
        { id: 'poll_bump', weight: 3, cooldown: 3,
          effects: [{ set: 'approval', expr: 'clamp(approval + rand(2, 7), 0, 100)' }],
          notify: '여론조사에서 반등이 나왔다.' },
        { id: 'gaffe', weight: 2, cooldown: 4,
          effects: [{ set: 'approval', expr: 'max(0, approval - rand(2, 6))' },
                    { set: 'press', expr: 'max(0, press - 5)' }],
          notify: '실언이 잘려 나가 온종일 돌아다녔다.' },
      ],
    },
  },
  directives: [
    { id: 'scandal_mode', when: 'in_scandal',
      text: '[상태] 스캔들 한복판이다. 어디를 가도 카메라와 질문이 따라붙고, 참모들은 방어 논리를 짜고 있다.' },
    { id: 'collapsing', when: 'approval < 25 and not ousted',
      text: '[상태] 지지율 {approval}%. 당내에서도 등을 돌리는 기색이 역력하고, 사람들이 거리를 두기 시작했다.' },
    { id: 'bill_verdict', when: 'bill_result != "없음"',
      text: '[표결] 법안 "{bill}" — 주사위 {bill_roll} vs 가결선 {bill_odds} → {bill_result}. '
        + '이 결과는 이미 확정됐다. 뒤집지 말고 그대로 묘사하라.' },
    { id: 'courting', when: 'coalition < 40',
      text: '[상태] 어느 쪽도 확실한 우군이 아니다. 특히 {weakest} 쪽이 가장 냉담하다.' },
    { id: 'fallen', when: 'ousted',
      text: '[상태] 실각했다. 더 이상 권한이 없다는 사실을 전제로 서술하라.' },
  ],
  actions: [
    { id: 'presser', label: '📢 기자회견', mode: 'oneshot', cooldown: 2, when: 'capital >= 10',
      inject: '[정치 행동] 직접 카메라 앞에 선다.',
      effects: [{ set: 'approval', expr: 'clamp(approval + 5, 0, 100)' },
                { set: 'press', expr: 'min(100, press + 4)' },
                { set: 'capital', expr: 'capital - 10' }] },
    { id: 'meet_biz', label: '🤝 재계 회동', mode: 'oneshot', cooldown: 3,
      inject: '[정치 행동] 재계 인사들과 자리를 갖는다.',
      effects: [{ set: 'biz', expr: 'min(100, biz + 10)' }, { set: 'labor', expr: 'max(0, labor - 6)' },
                { set: 'funds', expr: 'funds + 60' }, { set: 'risk', expr: 'min(100, risk + 5)' }] },
    { id: 'meet_labor', label: '✊ 노동계 회동', mode: 'oneshot', cooldown: 3,
      inject: '[정치 행동] 노동계 대표들을 만난다.',
      effects: [{ set: 'labor', expr: 'min(100, labor + 10)' }, { set: 'biz', expr: 'max(0, biz - 6)' },
                { set: 'approval', expr: 'clamp(approval + 2, 0, 100)' }] },
    { id: 'whip', label: '🏛 당내 단속', mode: 'oneshot', cooldown: 3, when: 'capital >= 12',
      inject: '[정치 행동] 당내 반발을 직접 눌러 앉힌다.',
      effects: [{ set: 'party', expr: 'min(100, party + 12)' }, { set: 'capital', expr: 'capital - 12' }] },
    // rand()는 조건식엔 못 쓴다 → 굴려서 변수에 담고, 그 변수로 등급을 매기는 2단 구조.
    { id: 'submit_bill', label: '📜 법안 표결', mode: 'oneshot', cooldown: 3, when: 'capital >= 15',
      inject: '[정치 행동] 법안을 본회의에 올린다. 표결 결과는 상태창의 판정을 따르라.',
      effects: [{ set: 'bill_roll', expr: 'rand(1, 100)' },
                { set: 'bill_result', expr: 'bill_roll <= bill_odds ? "가결" : "부결"' },
                { set: 'capital', expr: 'capital - 15' }] },
    { id: 'spend', label: '💰 자금 투입', mode: 'oneshot', cooldown: 4, when: 'funds >= 150',
      inject: '[정치 행동] 자금을 조직 정비와 홍보에 쏟는다.',
      effects: [{ set: 'funds', expr: 'funds - 150' }, { set: 'capital', expr: 'min(100, capital + 14)' },
                { set: 'risk', expr: 'min(100, risk + 6)' }] },
  ],
  updater: {
    allow: [
      { id: 'approval', maxDelta: 10 }, { id: 'capital', maxDelta: 12 },
      { id: 'biz', maxDelta: 10 }, { id: 'labor', maxDelta: 10 },
      { id: 'press', maxDelta: 10 }, { id: 'party', maxDelta: 10 },
      { id: 'risk', maxDelta: 15 }, { id: 'funds', maxDelta: 200 },
      { id: 'bill', maxLength: 40 }, { id: 'pledges' },
    ],
    guide: '주간 지지율 수렴·정치자본 회복·리스크 누적은 시스템이 자동 계산한다. 중복 반영하지 마라. '
      + '표결 결과는 절대 바꾸지 마라. 서사에서 새로 벌어진 일만 반영하라.',
  },
  promptState: {
    template: '[정국 — {week}주차]\n'
      + '지지율 {approval}% ({standing}) | 정치 자본 {capital} | 자금 {funds}백만 | 스캔들 리스크 {risk}\n'
      + '재계 {biz} · 노동계 {labor} · 언론 {press} · 당내 {party} (연합 {coalition}, 가결선 {bill_odds})\n'
      + '기조 {econ} | 추진 법안: {bill}{in_scandal ? " | ⚠ 스캔들 진행 중" : ""}{ousted ? " | ⚠ 실각" : ""}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '여론', items: [
        { var: 'week' },
        { var: 'approval', bar: { max: 100 }, color: 'approval < 30 ? "#c0392b" : "#27ae60"' },
        { var: 'standing' },
        { var: 'risk', bar: { max: 100 }, color: 'risk >= 65 ? "#c0392b" : "#5b8def"' },
      ] },
      { label: '세력', items: [
        { var: 'biz', bar: { max: 100 } }, { var: 'labor', bar: { max: 100 } },
        { var: 'press', bar: { max: 100 } }, { var: 'party', bar: { max: 100 } },
        { var: 'weakest' },
      ] },
      { label: '자원', items: [
        { var: 'capital', bar: { max: 100 } }, { var: 'funds' }, { var: 'econ' },
      ] },
      { label: '입법', visibility: 'collapsed', items: [
        { var: 'bill' }, { var: 'bill_odds' },
        { var: 'bill_result', showWhen: 'bill_result != "없음"' },
        { var: 'pledges' },
      ] },
    ],
    customCSS: `.sim-status { background:#0f131c; border:1px solid #2a3550; color:#d3dae8; }
.sim-status summary { color:#c9a227; letter-spacing:.08em; }
.sim-group { border-bottom:1px solid #1e2740; padding-bottom:7px; }
.sim-group-label { color:#c9a227; font-size:.78em; letter-spacing:.14em; }
.sim-label { color:#8792ab; opacity:1; }
.sim-value { color:#f0f3f9; font-weight:700; }
.sim-badge, .sim-tag { background:#1a2136; color:#d8c07a; border:1px solid #3a4560; }
.sim-bar { background:#161c2c; height:8px; border-radius:1px; }
.sim-bar-fill { border-radius:1px; }
.sim-action { border-color:#3d4a6b; color:#d8c07a; border-radius:2px; }
.sim-action.sim-armed { border-color:#c9a227; background:#1a2136; }
.sim-log { color:#6f7c96; }`,
  },
  setup: {
    presets: [
      { id: 'rookie', label: '초선 — 기반이 없음', set: { approval: 38, capital: 35, funds: 150, biz: 30, labor: 45, press: 45, party: 40 } },
      { id: 'incumbent', label: '현직 — 무난한 출발', set: { approval: 52, capital: 55, funds: 400, biz: 50, labor: 40, press: 50, party: 60 } },
      { id: 'crisis', label: '위기 — 이미 흔들리는 중', set: { approval: 27, capital: 30, funds: 200, biz: 35, labor: 30, press: 25, party: 35, risk: 45 } },
    ],
    ai: {
      enabled: true,
      vars: ['bill', 'pledges', 'econ', 'approval', 'press'],
      instruction: '[최초 설정] 아직 임기가 시작되지 않았다. 유저와 함께 어떤 자리이고 어떤 나라·도시이며 무엇을 걸고 당선됐는지 정하는 대화를 하라. 정해지면 정국 상황을 정리해 서술하라.',
      guide: '공약은 3~5개로 구체적으로 잡아라. 서로 충돌하는 공약을 최소 하나는 넣어라 — 그래야 선택이 아프다.',
    },
  },
};

// ── 버튜버 ────────────────────────────────────────────────────
// 배울 점: ① 랜덤 숫자(trend_seed)를 굴리고 파생으로 이름을 붙여
//             "매 턴 판이 바뀌는 외부 환경"을 만드는 법 — enum에 직접 랜덤 대입할 방법이 없을 때의 정석
//          ② 절대량이 아니라 비율(engagement)로 판정해, 채널이 커져도 압박이 그대로 유지되게 하는 법
//          ③ 지속 정책(hold)에 `when` 안전장치를 걸어 켜 놓고 잊은 플레이어가 그대로 죽지 않게 하는 법
//          ④ 액션 비용을 조건부로 줘서(편집자 유무) 같은 버튼의 값이 상황에 따라 달라지게 하는 법
const VTUBER = {
  simcore: '0.1',
  meta: { name: '버튜버 — 방송 운영', author: 'SimCore 템플릿' },
  // 한 턴 = 하루치 방송이라 perTurn. 진짜 달력이라 요일이 생긴다 —
  // "주말 방송", "월요일 새벽 편집" 같은 서술의 근거가 공짜로 따라온다.
  time: { start: '2026-03-02 20:00', advance: 'perTurn', format: { date: 'M월 D일' } },
  vars: [
    { id: 'nickname', label: '활동명', type: 'text', init: '', maxLength: 20 },
    { id: 'subs', label: '구독자', type: 'int', init: 120, min: 0, format: '{v}명' },
    { id: 'funds', label: '수익금', type: 'int', init: 50, min: 0, format: '{v}만원' },
    { id: 'hype', label: '화제성', type: 'int', init: 20, min: 0, max: 100,
      desc: '알고리즘 노출도. 가만두면 매일 식는다.' },
    { id: 'energy', label: '체력', type: 'int', init: 80, min: 0, max: 100 },
    { id: 'mental', label: '멘탈', type: 'int', init: 70, min: 0, max: 100 },
    { id: 'heat', label: '논란 지수', type: 'int', init: 5, min: 0, max: 100,
      desc: '조용히 쌓이다 45를 넘으면 터진다.' },
    { id: 'stream_hours', label: '방송 시간', type: 'int', init: 4, min: 3, max: 10, format: '{v}시간' },
    { id: 'editor', label: '편집자', type: 'int', init: 0, min: 0, max: 3, format: '{v}명' },
    { id: 'concept', label: '내 컨셉', type: 'enum', init: '잡담',
      enum: ['잡담', '게임', '노래', 'ASMR', '버라이어티'] },
    { id: 'trend_seed', label: '유행 주사위', type: 'int', init: 2, min: 1, max: 5,
      desc: '알고리즘이 미는 장르. 랜덤 이벤트가 굴린다.' },
    { id: 'catchphrase', label: '인사말', type: 'text', init: '', maxLength: 40 },
    { id: 'regulars', label: '단골', type: 'list', init: [], maxItems: 8 },
    { id: 'burnout', label: '번아웃', type: 'bool', init: false },
    { id: 'in_scandal', label: '논란 진행 중', type: 'bool', init: false },
    { id: 'career_over', label: '활동 종료', type: 'bool', init: false },
  ],
  derived: [
    // 표시용 "N일차" — 날짜는 epoch 하나가 굴리고, 세는 이름만 파생으로 붙인다
    { id: 'day_no', label: '경과', expr: 'elapsed + 1', format: '{v}일차' },
    // enum에는 랜덤을 직접 넣을 수 없다. 숫자를 굴리고(trend_seed) 여기서 이름을 붙인다.
    { id: 'trend', label: '이번 유행',
      expr: 'trend_seed == 1 ? "잡담" : (trend_seed == 2 ? "게임" : (trend_seed == 3 ? "노래" : (trend_seed == 4 ? "ASMR" : "버라이어티")))' },
    { id: 'fit', label: '유행 적중', expr: 'concept == trend ? 30 : 8' },
    { id: 'condition', label: '컨디션', expr: 'round((energy + mental) / 2)' },
    // 컨디션은 더하기가 아니라 곱하기다 — 그래야 채널이 커져도 몸 상태가 계속 아프다.
    { id: 'ccv', label: '동시 접속',
      expr: 'clamp(round(subs * (0.04 + hype * 0.0012 + fit * 0.002) * (0.5 + condition * 0.01) * (burnout ? 0.55 : 1) + stream_hours * 0.5), 0, 999999)' },
    // 구독자 대비 동접률. 채널이 커져도 이 값은 안 커진다 —
    // "지금 잘 하고 있나"를 규모와 무관하게 재는 지표라, 멘탈 판정의 기준이 된다.
    { id: 'engagement', label: '시청률', expr: 'round(ccv * 100 / max(subs, 1))' },
    // 동접은 "지금 몇 명이 보고 있나", 후원은 "오늘 총 얼마"다 — 그래서 방송 시간에 비례한다.
    { id: 'donation', label: '오늘 후원', expr: 'round(ccv * 0.2 * stream_hours / 4)' },
    { id: 'cost', label: '오늘 지출', expr: '12 + editor * 20 + round(subs * 0.006)' },
    { id: 'net', label: '오늘 순익', expr: 'donation - cost' },
    { id: 'tier', label: '채널 규모',
      expr: 'subs >= 5000 ? "대형" : (subs >= 1000 ? "중견" : (subs >= 300 ? "소형" : "신입"))' },
  ],
  rules: {
    // 순서가 중요하다 — 정산(funds)과 유입(subs)을 먼저 끝내야 그 턴의 동접 기준으로 계산된다.
    onTurn: [
      { set: 'funds', expr: 'funds + net' },
      { set: 'subs', expr: 'subs + round(ccv * 0.25 * (0.5 + stream_hours / 8)) - round(subs * 0.012)' },
      { set: 'energy', expr: 'clamp(energy - round(stream_hours * 1.4) - (editor == 0 ? 5 : 1) + 12, 0, 100)' },
      // 멘탈이 유일한 패배 경로다. 깎는 축이 셋(반응 없음 / 논란 / 생활고)이라
      // 채널이 아무리 커져도 관리를 놓으면 무너진다.
      { set: 'mental', expr: 'clamp(mental + (engagement < 8 ? -4 : (engagement >= 15 ? 2 : 0))'
        + ' + (heat >= 40 ? -4 : 0) + (funds <= 0 ? -3 : 0) - (burnout ? 4 : 0), 0, 100)' },
      { set: 'hype', expr: 'clamp(hype - 4 + editor * 2, 0, 100)' },
      { set: 'heat', expr: 'clamp(heat - 1, 0, 100)' },
      { set: 'stream_hours', expr: 'max(stream_hours - 2, 3)' },
      // ⚠ day+1 없음 — 날짜는 time 섹션(perTurn)이 넘긴다
    ],
    events: [
      // 번아웃은 방송 시간을 강제로 최소치로 되돌린다 — 안 그러면 빠져나올 길이 없다.
      { id: 'burnout_on', when: 'energy <= 20 and not burnout',
        effects: [{ set: 'burnout', expr: '1' }, { set: 'stream_hours', expr: '3' }],
        notify: '눈을 떠도 몸이 안 움직인다. 방송 켜는 것 자체가 버거워졌다.' },
      { id: 'burnout_off', when: 'energy >= 40 and burnout',
        effects: [{ set: 'burnout', expr: '0' }],
        notify: '오랜만에 푹 자고 일어났다. 다시 마이크를 켤 만해졌다.' },
      { id: 'scandal_start', when: 'heat >= 45 and not in_scandal',
        effects: [{ set: 'in_scandal', expr: '1' }, { set: 'mental', expr: 'mental - 12' },
          { set: 'hype', expr: 'hype + 18' }, { set: 'subs', expr: 'subs - round(subs * 0.06)' }],
        notify: '논란이 커뮤니티 메인에 걸렸다. 알림이 멈추지 않는다.' },
      { id: 'scandal_end', when: 'heat <= 20 and in_scandal',
        effects: [{ set: 'in_scandal', expr: '0' }],
        notify: '화제가 식었다. 채팅창이 다시 평소로 돌아왔다.' },
      { id: 'first_300', once: true, when: 'subs >= 300',
        notify: '구독자 300명. 이름을 아는 사람들이 생기기 시작했다.' },
      { id: 'first_1k', once: true, when: 'subs >= 1000',
        notify: '구독자 1000명을 넘겼다. 이제 취미라고 말하기 어려워졌다.' },
      { id: 'quit', when: 'mental <= 0 and not career_over',
        effects: [{ set: 'career_over', expr: '1' }],
        notify: '더는 못 하겠다. 마지막 방송을 켤 힘도 남지 않았다.' },
    ],
    randomEvents: {
      chancePerTurn: 0.4,
      table: [
        // 판을 통째로 흔드는 이벤트. 내 컨셉과 맞으면 노출이 뛰고, 어긋나면 채팅이 한산해진다.
        { id: 'trend_shift', weight: 4, cooldown: 3,
          effects: [{ set: 'trend_seed', expr: 'rand(1, 5)' }],
          notify: '알고리즘이 미는 장르가 바뀌었다. 추천란 풍경이 달라졌다.' },
        { id: 'raid', weight: 3, when: 'subs >= 200', cooldown: 5,
          effects: [{ set: 'hype', expr: 'hype + 15' }, { set: 'subs', expr: 'subs + round(subs * 0.04)' }],
          notify: '방송을 마친 다른 스트리머가 시청자를 통째로 몰아줬다.' },
        { id: 'clip_viral', weight: 2, when: 'hype >= 45', cooldown: 6,
          effects: [{ set: 'subs', expr: 'subs + round(subs * 0.12) + 20' }, { set: 'hype', expr: 'hype + 20' }],
          notify: '잘라 올린 클립 하나가 알고리즘을 탔다.' },
        { id: 'troll', weight: 3, cooldown: 3,
          effects: [{ set: 'mental', expr: 'mental - 6' }, { set: 'heat', expr: 'heat + 10' }],
          notify: '악질 채팅이 붙었다. 지워도 계속 새 계정으로 들어온다.' },
        { id: 'editor_quit', weight: 2, when: 'editor >= 1', cooldown: 6,
          effects: [{ set: 'editor', expr: 'editor - 1' }, { set: 'hype', expr: 'hype - 5' }],
          notify: '편집자가 그만두겠다고 연락해 왔다. 밀린 영상이 그대로 남았다.' },
        { id: 'whale', weight: 2, cooldown: 4,
          effects: [{ set: 'funds', expr: 'funds + round(20 + ccv * 0.5)' }, { set: 'mental', expr: 'mental + 4' }],
          notify: '익명의 큰 후원이 들어왔다. 읽어주는 목소리가 떨렸다.' },
        { id: 'tech_fail', weight: 2, cooldown: 5,
          effects: [{ set: 'funds', expr: 'funds - 40' }, { set: 'hype', expr: 'hype - 6' }],
          notify: '장비가 말썽이다. 방송이 끊기고 수리비가 나갔다.' },
        { id: 'sponsor', weight: 2, when: 'subs >= 500 and heat < 40', cooldown: 8,
          effects: [{ set: 'funds', expr: 'funds + round(subs * 0.06)' }],
          notify: '광고 제안 메일이 왔다. 조건이 나쁘지 않다.' },
        { id: 'slander', weight: 2, when: 'heat >= 25', cooldown: 7,
          effects: [{ set: 'heat', expr: 'heat + 18' }, { set: 'mental', expr: 'mental - 9' },
            { set: 'hype', expr: 'hype + 12' }],
          notify: '저격 영상이 올라왔다. 조회수만 빠르게 오르고 있다.' },
      ],
    },
  },
  directives: [
    { id: 'trend_hit', when: 'concept == trend',
      text: '[분위기] 지금 유행({trend})이 내 컨셉과 맞아떨어졌다. 채팅이 빠르게 올라가고 처음 보는 닉네임이 계속 들어온다.' },
    { id: 'trend_miss', when: 'concept != trend',
      text: '[분위기] 유행은 {trend} 쪽에 가 있고 내 방송은 {concept}이다. 동접 {ccv}명, 채팅은 한산하다.' },
    { id: 'low_energy', when: 'energy <= 25',
      text: '[상태] 체력이 바닥이다. 목소리에 힘이 없고 리액션이 반 박자 늦으며 말이 자꾸 끊긴다.' },
    { id: 'burnt', when: 'burnout',
      text: '[상태] 번아웃이다. 방송 켜는 것 자체가 버겁고, 즐거운 척하는 게 티가 난다.' },
    { id: 'scandal_dir', when: 'in_scandal',
      text: '[상태] 논란 진행 중(논란 지수 {heat}). 채팅창에 해명 요구와 저격이 섞여 올라온다. 실수 하나가 바로 캡처된다.' },
    { id: 'big_name', when: 'subs >= 5000',
      text: '[위치] 대형 채널이다. 말 한마디가 커뮤니티에 옮겨지고 기사가 된다. 방송 밖에서도 알아보는 사람이 있다.' },
    { id: 'call_regulars', when: 'count(regulars) >= 3',
      text: '[연속성] 매번 오는 단골들({regulars:tags})의 닉네임을 읽어주고 지난 방송 이야기를 이어가라.' },
  ],
  actions: [
    // 지속 정책(hold): 켜 두면 매 턴 적용된다. onTurn이 매 턴 시간을 되돌리므로
    // 켜면 서서히 늘고 끄면 서서히 줄어든다. `when`이 안전장치다 — 번아웃이 오면
    // 켜져 있어도 효과가 멈춰, 켜 놓고 잊은 플레이어가 그대로 죽지 않는다.
    { id: 'go_hard', label: '🔴 풀타임 방송', mode: 'hold', when: 'not burnout',
      inject: '[지속 정책] 잠을 줄이고 방송 시간을 계속 늘리고 있다.',
      effects: [{ set: 'stream_hours', expr: 'min(stream_hours + 3, 10)' },
        { set: 'energy', expr: 'energy - 4' }] },
    { id: 'rest_day', label: '💤 휴방', mode: 'oneshot', cooldown: 2,
      inject: '[플레이어 행동] 오늘은 방송을 쉰다.',
      effects: [{ set: 'energy', expr: 'energy + 28' }, { set: 'mental', expr: 'mental + 10' },
        { set: 'hype', expr: 'hype - 6' }] },
    // 비용이 조건부다 — 편집자를 뽑아 두면 같은 버튼이 훨씬 싸진다.
    { id: 'make_clips', label: '✂️ 클립 편집', mode: 'oneshot', cooldown: 3,
      inject: '[플레이어 행동] 하이라이트를 잘라 숏폼으로 올린다.',
      effects: [{ set: 'hype', expr: 'hype + 16' },
        { set: 'energy', expr: 'energy - (editor >= 1 ? 2 : 6)' }] },
    // 화제성을 논란과 맞바꾸는 버튼 — 이게 있어야 사과 방송이 쓸모를 갖는다.
    // `when`으로 스스로를 막는다: 이미 논란 중이면 더 세게 못 지른다.
    // 이 조건이 없으면 눌리는 대로 논란이 쌓여 결국 "누르면 손해인 버튼"이 된다.
    { id: 'edgy', label: '🌶 자극적인 방송', mode: 'oneshot', when: 'heat < 30', cooldown: 4,
      inject: '[플레이어 행동] 선을 살짝 넘는 콘텐츠로 화제를 만든다.',
      effects: [{ set: 'hype', expr: 'hype + 26' }, { set: 'subs', expr: 'subs + round(subs * 0.04)' },
        { set: 'funds', expr: 'funds + round(ccv * 0.5)' },
        { set: 'heat', expr: 'heat + 11' }] },
    { id: 'collab', label: '🤝 합방', mode: 'oneshot', when: 'subs >= 150', cooldown: 5,
      inject: '[플레이어 행동] 다른 스트리머와 합방을 잡는다.',
      effects: [{ set: 'hype', expr: 'hype + 18' }, { set: 'subs', expr: 'subs + round(subs * 0.05) + 10' },
        { set: 'energy', expr: 'energy - 6' }, { set: 'mental', expr: 'mental + 3' },
        { set: 'heat', expr: 'heat + 4' }] },
    // 파생 값(trend)을 그대로 변수에 대입한다 — 유행을 좇는 대신 기존 팬을 잃는다.
    { id: 'switch_concept', label: '🎯 컨셉 전환', mode: 'oneshot', when: 'concept != trend', cooldown: 6,
      inject: '[플레이어 행동] 지금 뜨는 장르로 방송 컨셉을 갈아탄다.',
      effects: [{ set: 'concept', expr: 'trend' }, { set: 'hype', expr: 'hype + 8' },
        { set: 'subs', expr: 'subs - round(subs * 0.05)' }] },
    { id: 'hire_editor', label: '🧑‍💻 편집자 고용', mode: 'oneshot', when: 'funds >= 80 and editor < 3', cooldown: 4,
      inject: '[플레이어 행동] 편집을 맡길 사람을 구한다.',
      effects: [{ set: 'editor', expr: 'editor + 1' }, { set: 'funds', expr: 'funds - 80' }] },
    { id: 'apologize', label: '🙇 사과 방송', mode: 'oneshot', when: 'heat >= 25', cooldown: 4,
      inject: '[플레이어 행동] 카메라 앞에서 고개를 숙인다.',
      effects: [{ set: 'heat', expr: 'heat - 40' }, { set: 'mental', expr: 'mental - 6' },
        { set: 'hype', expr: 'hype + 6' }] },
  ],
  updater: {
    // 구독자·동접은 allow에 넣지 않는다 — 시스템이 계산하는 결과값이라
    // 모델이 손대면 사슬 전체가 어긋난다. 서사가 흔들 수 있는 건 감정과 평판뿐이다.
    allow: [
      { id: 'mental', maxDelta: 12 }, { id: 'energy', maxDelta: 15 },
      { id: 'heat', maxDelta: 18 }, { id: 'hype', maxDelta: 12 },
      { id: 'funds', maxDelta: 60 },
      { id: 'regulars' }, { id: 'catchphrase', maxLength: 40 }, { id: 'nickname', maxLength: 20 },
    ],
    guide: '구독자·동접·후원액은 시스템이 계산하니 절대 건드리지 마라. 방송 중 실제로 벌어진 일(악플, 실언, 응원, 큰 후원)만 멘탈·논란 지수에 반영하라. 단골(regulars)에는 여러 번 등장한 시청자 닉네임만 add하라.',
  },
  promptState: {
    template: '[방송 현황 — {date}({weekday}) · {day_no}일차 · {tier} 채널 · {nickname}]\n'
      + '구독자 {subs}명 | 오늘 동접 {ccv}명 | 화제성 {hype}/100 | 수익금 {funds}만원 (오늘 {net})\n'
      + '컨셉 {concept} / 유행 {trend}{concept == trend ? " ✅적중" : " ❌빗나감"} | 방송 {stream_hours}시간'
      + '{editor > 0 ? " | 편집자 " + editor + "명" : ""}\n'
      + '체력 {energy} | 멘탈 {mental} | 논란 {heat}/100'
      + '{in_scandal ? " ⚠논란 중" : ""}{burnout ? " 🔥번아웃" : ""}\n'
      + '단골: {regulars:tags}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '채널', items: [
        { var: 'date' }, { var: 'day_no' }, { var: 'tier' }, { var: 'subs' }, { var: 'ccv' },
      ] },
      { label: '방송', items: [
        { var: 'concept' }, { var: 'trend' }, { var: 'stream_hours' },
        { var: 'hype', bar: { max: 100 }, color: 'hype >= 50 ? "#ff2d95" : "#5f6bff"' },
      ] },
      { label: '컨디션', items: [
        { var: 'energy', bar: { max: 100 }, color: 'energy <= 25 ? "#ff4d4d" : "#20e3b2"' },
        { var: 'mental', bar: { max: 100 }, color: 'mental <= 30 ? "#ff4d4d" : "#20e3b2"' },
        { var: 'heat', bar: { max: 100 }, color: 'heat >= 50 ? "#ff4d4d" : "#8a93b8"' },
        { var: 'burnout', showWhen: 'burnout' },
        { var: 'in_scandal', showWhen: 'in_scandal' },
        { var: 'career_over', showWhen: 'career_over' },
      ] },
      { label: '수익', visibility: 'collapsed', items: [
        { var: 'funds' }, { var: 'net' }, { var: 'donation' }, { var: 'editor' },
      ] },
      { label: '팬', visibility: 'collapsed', items: [
        { var: 'nickname' }, { var: 'catchphrase' }, { var: 'regulars' },
      ] },
    ],
    // 방송 오버레이 — 자정의 모니터 불빛. 남색 바탕에 네온 핑크
    customCSS: `.sim-status { background:#0f1020; border:1px solid #2a2d55; border-radius:10px; color:#e6e8ff; }
.sim-status summary { color:#ff2d95; letter-spacing:.08em; text-transform:uppercase; }
.sim-group-label { color:#5f6bff; font-size:.78em; letter-spacing:.12em; }
.sim-label { color:#8a93b8; opacity:1; }
.sim-value { color:#ffffff; font-weight:700; }
.sim-badge, .sim-tag { background:#1b1d3a; color:#ff8ec6; border:1px solid #3a3f75; border-radius:999px; }
.sim-bar { background:#1b1d3a; height:6px; border-radius:999px; }
.sim-action { border-color:#3a3f75; color:#c9cdf0; border-radius:999px; background:#171935; }
.sim-action.sim-armed { border-color:#ff2d95; background:#2a1030; color:#ff8ec6; }
.sim-log { color:#6f76a8; }`,
  },
  setup: {
    presets: [
      { id: 'rookie', label: '신입 — 방구석에서 시작', set: { subs: 120, funds: 50, hype: 20, concept: '잡담', energy: 80, mental: 70 } },
      { id: 'gamer', label: '게임 채널 — 이미 자리는 잡음', set: { subs: 900, funds: 200, hype: 35, concept: '게임', trend_seed: 2 } },
      { id: 'comeback', label: '복귀 — 과거 논란이 남아 있음', set: { subs: 4000, funds: 300, hype: 15, mental: 45, heat: 35, concept: '노래' } },
    ],
    ai: {
      enabled: true,
      vars: ['nickname', 'catchphrase', 'concept', 'subs', 'regulars'],
      instruction: '[최초 설정] 아직 데뷔 전이다. 유저와 함께 활동명, 캐릭터 컨셉(외형·설정·말투), 주력 콘텐츠, 첫 인사말을 정하는 대화를 하라. 정해지면 데뷔 방송 직전 상황을 정리해 서술하라.',
      guide: '구독자는 처음이면 100~300명 사이로 잡아라. 단골(regulars)은 데뷔 전이면 비워 두고, 이미 활동 중인 설정이면 2~3명만 넣어라.',
    },
  },
};

// 일상물 — 가장 가벼운 템플릿. 관리할 수치가 없는 봇(현대 일상·학원·동거물)에 그대로 얹는 용도.
// 다른 템플릿과 달리 "이기고 지는 판"이 없다. 그래서 설계가 반대로 간다:
//   · 매 턴 자동 처리(틱)를 아예 두지 않는다. 일상물에서 한 턴은 하루도 한 시간도 아니다 —
//     카페에서 세 턴을 떠들었다고 저녁이 되면 안 된다.
//   · 대신 시간·날짜는 **유저가 버튼으로** 넘긴다(액션). 카운터를 AI에게 안 맡기는 원칙은 지키되,
//     넘기는 시점만 사람이 정하는 것이다.
//   · 랜덤 이벤트는 수치를 굴리는 게 아니라 **서사에 소재를 던지는** 쪽에 가깝다.
//
// v0.51: 시간대 enum(새벽~밤)을 **진짜 시계**로 바꿨다. 옛 구조는 "낮"에서 "저녁"으로 가는 데
// 버튼을 눌러야 했고 그 사이의 두 시간을 표현할 방법이 없었다. 이제 분 단위로 흐르고,
// 때(새벽·아침·낮·저녁·밤)는 시각에서 파생된다 — 세는 곳이 하나면 어긋날 수가 없다.
const DAILY = {
  simcore: '0.1',
  meta: { name: '일상 — 하루의 기록', author: 'SimCore 템플릿' },
  // 명시적 진행 — 저절로 흐르지 않는다. 장면이 실제로 소비한 시간만 보조가 보고하고,
  // 하루는 [💤] 버튼으로만 넘어간다 (이 템플릿의 원래 원칙 그대로).
  time: {
    start: '2026-05-18 08:00',
    advance: 'explicit',
    format: { date: 'M월 D일', clock: 'HH:mm' },
  },
  vars: [
    { id: 'weather', label: '날씨', type: 'enum', init: '맑음', enum: ['맑음', '흐림', '비', '눈', '바람'] },
    { id: 'place', label: '위치', type: 'text', init: '집', maxLength: 40 },
    { id: 'money', label: '소지금', type: 'int', init: 50000, min: 0, format: '{v}원' },
    { id: 'bag', label: '소지품', type: 'list', init: ['지갑', '휴대폰', '열쇠'],
      maxItems: 15, itemMaxLength: 30 },
    // 시간 진행 입구 — 엔진이 매 턴 소비하고 0으로 되돌린다. 규칙은 여기 desc에 쓴다
    // (지시문은 메인 모델 전용이라 상태를 갱신하는 보조 AI가 못 읽는다).
    // skip_day를 안 두는 것이 이 템플릿의 선언이다 — 날짜는 버튼으로만 넘어간다.
    { id: 'skip_min', label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 1440,
      desc: '이번 장면에서 실제로 흐른 시간(분). 대화 한 토막이면 5~20, 식사·이동이면 30~90, '
        + '반나절을 보냈으면 240까지. 아무 일도 없었으면 0. 하루를 넘기지는 마라 — 그건 [💤] 버튼의 몫이다.' },
  ],
  derived: [
    // 때는 시각에서 나온다 — 옛 enum 변수를 대체. 세는 곳이 하나뿐이라 시각과 어긋날 수 없다.
    { id: 'tod', label: '때',
      expr: 'hour < 5 ? "새벽" : (hour < 11 ? "아침" : (hour < 17 ? "낮" : (hour < 21 ? "저녁" : "밤")))' },
  ],
  rules: {
    // 틱 없음 — 위 주석 참고. 시간이 저절로 흐르면 대화가 성립하지 않는다.
    onTurn: [],
    events: [],
    randomEvents: {
      chancePerTurn: 0.3,
      table: [
        // ── 사람 ──
        { id: 'meet_known', weight: 3, cooldown: 3,
          notify: '아는 얼굴과 마주쳤다. 반가운 쪽일 수도, 피하고 싶은 쪽일 수도 있다.' },
        { id: 'meet_stranger', weight: 2, cooldown: 4,
          notify: '낯선 사람이 말을 걸어온다. 길을 묻는 것일 수도, 다른 용건일 수도 있다.' },
        { id: 'someone_calls', weight: 2, cooldown: 4,
          notify: '연락이 왔다. 누구에게서 온 것인지는 이 장면의 흐름에 맞게 정하라.' },
        // ── 가벼운 사건 ──
        { id: 'small_trouble', weight: 2, cooldown: 3,
          notify: '사소한 소동이 벌어졌다. 크게 위험하지는 않지만 그냥 지나치기도 애매하다.' },
        { id: 'small_find', weight: 2, cooldown: 4,
          notify: '뭔가를 얻게 되었다. 주웠거나, 받았거나, 사게 되었다 — 소지품에 남을 만한 것.' },
        { id: 'small_spend', weight: 2, cooldown: 3, when: 'money >= 5000',
          effects: [{ set: 'money', expr: 'max(money - rand(1000, 9000), 0)' }],
          notify: '예상 못 한 지출이 생겼다. 얼마가 나갔는지는 상태창에 이미 반영되어 있다.' },
        { id: 'small_gain', weight: 1, cooldown: 6,
          effects: [{ set: 'money', expr: 'money + rand(3000, 15000)' }],
          notify: '돈이 조금 생겼다. 받은 것인지 찾은 것인지는 장면에 맞게 정하라.' },
        // ── 갈림길(choices) 예시 — 터지면 유저가 /선택으로 고를 때까지 기다린다 (v0.41).
        //    마지막 항목은 조건 없이 — 2턴 안에 안 고르면 그게 자동 결정된다.
        { id: 'stray_cat', weight: 1, cooldown: 8, timeout: 2,
          notify: '골목에서 야윈 길고양이가 따라온다. 어떻게 할지 정할 때까지 계속 곁을 맴돈다.',
          choices: [
            { label: '쓰다듬어 준다', inject: '손끝에 닿은 고양이가 낯을 가리면서도 떠나지 않는다.' },
            { label: '먹이를 사서 준다', when: 'money >= 3000',
              effects: [{ set: 'money', expr: 'money - 3000' }] },
            { label: '모른 척 지나친다' },
          ] },
        // ── 날씨 ── 바뀔 때만 후보에 오르게 when으로 막는다 (같은 날씨로 "바뀌었다"고 알리면 이상하다)
        { id: 'sky_rain', weight: 2, cooldown: 5, when: 'weather != "비" and weather != "눈"',
          effects: [{ set: 'weather', expr: '"비"' }],
          notify: '빗방울이 떨어지기 시작했다.' },
        { id: 'sky_clear', weight: 3, cooldown: 4, when: 'weather != "맑음"',
          effects: [{ set: 'weather', expr: '"맑음"' }],
          notify: '구름이 걷히고 볕이 든다.' },
        { id: 'sky_cloud', weight: 2, cooldown: 4, when: 'weather != "흐림"',
          effects: [{ set: 'weather', expr: '"흐림"' }],
          notify: '하늘이 무겁게 흐려졌다.' },
        { id: 'sky_wind', weight: 1, cooldown: 6, when: 'weather != "바람"',
          effects: [{ set: 'weather', expr: '"바람"' }],
          notify: '바람이 세게 불기 시작했다.' },
      ],
    },
  },
  directives: [
    { id: 'bad_weather', when: 'weather == "비" or weather == "눈"',
      text: '[상태] 궂은 날씨({weather})다. 젖은 옷, 우산, 실내로 피하는 선택 같은 것이 묘사에 배어나야 한다.' },
    { id: 'late_hour', when: 'hour >= 21 or hour < 5',
      text: '[상태] 늦은 시각({clock}, {tod})이다. 문을 닫은 가게, 인적이 드문 거리, 피로 같은 것을 고려하라.' },
    { id: 'broke', when: 'money < 5000',
      text: '[상태] 수중에 {money}원밖에 없다. 돈이 드는 선택은 부담스럽게 다뤄라.' },
  ],
  actions: [
    { id: 'pass_time', label: '🕐 시간을 보낸다', mode: 'oneshot',
      inject: '[플레이어 액션] 두어 시간이 흘렀다. 그 사이에 있었던 일부터 이어서 그려라.',
      effects: [{ set: 'skip_min', expr: '120' }] },
    // 지금이 몇 시든 **다음 08:00까지**를 분으로 계산한다 — 새벽 3시에 눌러도 같은 날 아침이 된다.
    // (`skip_day = 1`로 하면 시각이 그대로라 새벽에 잠들면 이튿날도 새벽에 깬다)
    { id: 'end_day', label: '💤 하루를 마친다', mode: 'oneshot',
      inject: '[플레이어 액션] 하루를 마치고 잠자리에 든다. 다음 장면은 이튿날 아침부터 시작한다.',
      effects: [{ set: 'skip_min', expr: '((1919 - hour * 60 - minute) % 1440) + 1' }] },
  ],
  updater: {
    model: 'aux',
    // 날짜를 넘기는 권한은 일부러 안 준다 — skip_day 변수 자체가 없다. AI에게 열어 두면
    // 서사가 "며칠 뒤"라고 흘리는 순간 날짜가 튀고, 그 뒤로는 며칠째인지 아무도 못 맞춘다.
    // 대신 **그날 안에서 흐른 분**은 보고하게 한다 — 그건 서사만 아는 정보다.
    allow: [
      { id: 'skip_min', maxGain: 240 },
      { id: 'weather' },
      { id: 'place', maxLength: 40 },
      { id: 'money', maxGain: 50000, maxLoss: 50000 },
      { id: 'bag' },
    ],
    guide: '서사에 실제로 나온 변화만 반영하라. 흐른 시간은 장면이 실제로 소비한 만큼만 보고하고, '
      + '"조금 뒤" 정도면 10~20분이다. 소지품은 손에 넣거나 잃은 것이 서술됐을 때만 add/remove 하라.',
  },
  promptState: {
    template: '[{date}({weekday}) {clock} · {tod} · {weather}]\n위치 {place} | 소지금 {money}원\n소지품: {bag:tags}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '지금', items: [{ var: 'date' }, { var: 'weekday' }, { var: 'clock' }, { var: 'tod' },
        { var: 'weather' }, { var: 'place' }] },
      { label: '소지', items: [{ var: 'money' }, { var: 'bag' }] },
    ],
    // 모눈 메모지 — 옅은 종이에 연필 선
    customCSS: `.sim-status { background:#fbfaf6; border:1px solid #ddd8c8; border-radius:6px; color:#4a4740;
  background-image:linear-gradient(#eae5d6 1px,transparent 1px); background-size:100% 1.9em; }
.sim-status summary { color:#8a7f66; letter-spacing:.06em; }
.sim-group-label { color:#9a8f76; font-size:.82em; letter-spacing:.1em; }
.sim-label { color:#6b665a; }
.sim-value { color:#3d3a33; }
.sim-badge { background:#ece7d8; color:#5c5749; }
.sim-tag { background:#f3efe2; border-color:#ddd8c8; color:#5c5749; }`,
  },
  setup: {
    // startAt — 시간 체계가 켜져 있으면 **시작 시각도 배경의 일부**다.
    // 시계는 예약 키라 set으로 못 건드리므로 이 칸이 통로 (v0.51).
    presets: [
      { id: 'plain', label: '평범한 하루', set: {} },
      { id: 'weekend', label: '여유로운 주말', startAt: '2026-05-16 13:00',
        set: { place: '단골 카페', money: 120000, weather: '맑음' } },
      { id: 'tight', label: '빠듯한 월말', startAt: '2026-05-29 08:00',
        set: { money: 7000, weather: '비', place: '자취방' } },
    ],
    ai: {
      enabled: true,
      vars: ['weather', 'place', 'money', 'bag'],
      instruction: '[최초 설정 진행 중] 유저와 짧게 대화하며 오늘이 어떤 날인지 정하라. '
        + '어디서 시작하는지, 주머니 사정은 어떤지 정도면 충분하다. 길게 끌지 마라. '
        + '시각은 시스템이 관리하니 정하려 들지 마라 — 시작 시각은 [새 시작] 프리셋이 정한다.',
      guide: '유저가 말한 것은 그대로 반영하고, 말하지 않은 것은 그 장면에 자연스러운 값으로 정하라. '
        + '소지품은 그 사람이 당연히 들고 다닐 만한 것 서너 개면 된다.',
    },
  },
};

// ── 대장간 ──────────────────────────────────────────────────
// v0.39~0.42 신기능 총집합 — 새 기능을 실기로 만져 볼 때 이 템플릿 하나면 된다.
// 배울 점: ① whenArmed(액션 잠금)로 이중 장부를 구조로 막는 법 — 금고는 입금/출금 버튼이
//             눌린 턴에만 열리고, 평소 서사의 돈은 전부 지갑으로 귀속된다
//          ② 액션 판정(벼려낸다)과 이벤트 판정(밤샘 주문)이 check 하나(ck_forge)를 나눠 쓰는 법
//          ③ 갈림길 두 결 — 조건 이벤트(귀족 의뢰: 잠긴 선택지·타임아웃 3, 조건 이벤트엔
//             쿨다운이 없으므로 문턱 변수 noble_next를 스스로 올려 재발동을 제어)와
//             랜덤 이벤트(떠돌이 행상: 타임아웃 2, 안 고르면 마지막 항목)
//          ④ 등급 effects가 roll/total을 읽어 "얼마나 잘 굴렸는지"가 값(공임)이 되게 하는 법
//          ⑤ 상태창 범례·선택지는 v0.42 클릭 조작으로 그대로 버튼이 된다 — 별도 설정 없음
//          ⑥ suggest(다음 행동 제안, v0.43) — 매 턴 보조 AI가 다음 인풋 후보를 조작줄에 띄운다
const SMITH = {
  simcore: '0.1',
  meta: { name: '대장간 — 무쇠와 장부', author: 'SimCore 템플릿' },
  // 다음 행동 제안 (v0.43) — 상태 갱신과 같은 보조 호출에 얹혀 온다. 입력창 위 조작줄에 칩으로 뜬다.
  suggest: { count: 3, guide: '공방 일과에 어울리는 행동으로, 하나는 뜻밖의 것을 섞어라.' },
  vars: [
    { id: 'money', label: '지갑', type: 'int', init: 800, min: 0, format: '{v}G',
      desc: '품속의 돈. 서사에서 벌고 쓰는 돈은 전부 여기다.' },
    { id: 'vault', label: '공방 금고', type: 'int', init: 200, min: 0, format: '{v}G',
      desc: '공방 운영비. 입금/출금 버튼이 눌린 턴에만 기록이 열린다 — 평소 오간 돈은 지갑 쪽이다.' },
    { id: 'iron', label: '무쇠', type: 'int', init: 6, min: 0, max: 20 },
    { id: 'skill', label: '솜씨', type: 'int', init: 12, min: 3, max: 20 },
    { id: 'stamina', label: '체력', type: 'int', init: 8, min: 0, max: 10 },
    { id: 'fame', label: '평판', type: 'int', init: 0, min: 0, max: 100 },
    { id: 'noble_next', label: '다음 귀족 의뢰', type: 'int', init: 25, min: 0, format: '평판 {v}',
      desc: '평판이 이 문턱을 넘으면 귀족 의뢰가 온다. 의뢰를 처리하면 문턱이 다시 올라간다.' },
    { id: 'dc', label: '난이도', type: 'int', init: 13, min: 5, max: 30,
      desc: '지금 맡은 일감의 제작 난이도. 편자면 10, 보통 주문 13, 까다로우면 17, 명장급 20.' },
    { id: 'stoked', label: '화로 달굼', type: 'bool', init: false,
      desc: '켜져 있으면 다음 단조를 두 번 굴려 좋은 눈을 쓴다. 한 번 벼려내면 식는다.' },
    { id: 'queue', label: '주문서', type: 'list', init: [], maxItems: 8, itemMaxLength: 24,
      desc: '맡아 둔 주문. 완성해 넘겼으면 지워라.' },
    { id: 'masterwork', label: '대표작', type: 'text', init: '', maxLength: 40,
      desc: '공방의 이름을 알린 물건. 걸작이 나왔을 때만 적는다.' },
  ],
  derived: [
    { id: 'skill_mod', label: '솜씨 보정', expr: 'floor((skill - 10) / 2)' },
    { id: 'rank', label: '공방 등급', expr: 'fame >= 80 ? "명장" : (fame >= 50 ? "장인" : (fame >= 20 ? "숙련공" : "견습"))' },
    { id: 'queue_n', label: '밀린 주문', expr: 'count(queue)' },
  ],
  // 단조 판정 하나를 액션(벼려낸다)과 랜덤 이벤트(밤샘 주문)가 나눠 쓴다.
  // 굴림식이 stoked(화로 달굼)를 읽고, 끄는 건 각 사용처의 effects 몫 — 굴림 뒤에 적용되므로 안전.
  checks: [
    { id: 'ck_forge', label: '단조 판정', roll: 'stoked ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)',
      mod: 'skill_mod', vs: 'dc',
      grades: [
        { when: 'roll == 20', label: '대성공', inject: '손이 기억하는 것 이상의 물건이 나왔다 — 걸작의 탄생을 극적으로 그려라.',
          effects: [{ set: 'fame', expr: 'min(fame + 3, 100)' }, { set: 'money', expr: 'money + 100 + total * 2' }] },
        { when: 'roll == 1', label: '대실패', inject: '쇠가 갈라지고 불똥이 튄다 — 재료를 하나 더 날리고 소문까지 나는 대실패로 그려라.',
          effects: [{ set: 'iron', expr: 'max(iron - 1, 0)' }, { set: 'fame', expr: 'max(fame - 1, 0)' }] },
        { when: 'total >= vs', label: '성공',
          effects: [{ set: 'money', expr: 'money + 30 + total * 2' }, { set: 'fame', expr: 'min(fame + 1, 100)' }] },
        { label: '실패', inject: '두들길수록 모양이 어긋난다. 오늘 화로는 대답이 없다.' },
      ] },
  ],
  rules: {
    onTurn: [
      { set: 'stamina', expr: 'min(stamina + 1, 10)' },
    ],
    events: [
      // 갈림길(조건 이벤트) — 평판이 문턱(noble_next)을 넘으면 열린다. 두 번째 선택지는
      // 평판 50까지 잠겨(🔒) 있고, 3턴 안에 안 고르면 마지막 항목(정중히 거절)이 자동 결정된다.
      // 조건 이벤트에 쿨다운은 없다 — 재발동 제어는 조건을 스스로 닫는 것으로 한다:
      // 어느 쪽을 골라도(타임아웃 포함) 문턱이 현재 평판 +25로 올라가 다음 의뢰가 밀려난다.
      { id: 'noble_offer', when: 'fame >= noble_next', timeout: 3,
        notify: '남작가의 시종이 공방 문을 두드린다. 예장검 한 자루 — 맡을지 정할 때까지 대답을 기다리겠다고 한다.',
        choices: [
          { label: '의뢰를 받는다', inject: '격이 다른 일감이다. 실패가 허락되지 않는다.',
            effects: [{ list: 'queue', add: ['남작가의 예장검'] }, { set: 'dc', expr: '17' }, { set: 'noble_next', expr: 'fame + 25' }] },
          { label: '웃돈을 부른다', when: 'fame >= 50', inject: '시종의 눈썹이 올라가지만, 명성이 값을 증명한다.',
            effects: [{ set: 'money', expr: 'money + 150' }, { list: 'queue', add: ['남작가의 예장검'] }, { set: 'dc', expr: '19' }, { set: 'noble_next', expr: 'fame + 25' }] },
          { label: '정중히 거절한다',
            effects: [{ set: 'noble_next', expr: 'fame + 25' }] },
        ] },
      // 문턱이 0이 아니라 1인 이유: 매 턴 회복(+1)이 이벤트 판정보다 먼저 돌아서
      // 액션으로 0까지 떨어져도 판정 시점엔 이미 1이다 — 0으로 걸면 영영 안 터진다.
      // (재발동 제어도 조건 자신이 한다 — 회복 효과가 조건을 닫는다)
      { id: 'burnout', when: 'stamina <= 1',
        effects: [{ set: 'stamina', expr: '3' }],
        notify: '팔이 완전히 풀렸다. 망치를 놓고 한참을 주저앉아 쉬었다.' },
    ],
    randomEvents: {
      chancePerTurn: 0.25,
      table: [
        // 갈림길(랜덤 이벤트) — 2턴 안에 안 고르면 마지막 항목(손을 내젓는다)으로 흘러간다.
        { id: 'peddler', weight: 2, cooldown: 6, timeout: 2,
          notify: '떠돌이 행상이 공방 앞에 수레를 세운다. 무쇠 두 덩이를 싸게 넘기겠다고 한다.',
          choices: [
            { label: '무쇠 두 덩이를 산다', when: 'money >= 80',
              effects: [{ set: 'money', expr: 'max(money - 80, 0)' }, { set: 'iron', expr: 'min(iron + 2, 20)' }] },
            { label: '소문을 듣는다', inject: '행상이 이웃 마을 소식과 철값 이야기를 늘어놓는다.' },
            { label: '손을 내젓는다' },
          ] },
        // 이벤트 판정 — check를 달면 그 자리에서 굴리고 [판정] 줄이 다음 전송에 통지로 합류한다.
        { id: 'rush_order', weight: 1, cooldown: 8, when: 'iron >= 1', check: 'ck_forge',
          effects: [{ set: 'iron', expr: 'max(iron - 1, 0)' }, { set: 'stamina', expr: 'max(stamina - 1, 0)' }, { set: 'stoked', expr: '0' }],
          notify: '한밤중에 문을 두드리는 급한 주문 — 부러진 편자를 그 자리에서 두들겨 냈다.' },
        // 새 일감이 들어오면 주문서가 늘고 난이도가 새로 잡힌다 (동네 주문은 벼려낼 때 하나씩 지워진다)
        { id: 'walk_in', weight: 2, cooldown: 4, when: 'queue_n < 6',
          effects: [{ list: 'queue', add: ['동네 주문'] }, { set: 'dc', expr: 'rand(9, 16)' }],
          notify: '동네 손님이 주문을 맡기고 갔다. 주문서가 한 장 늘었다.' },
        { id: 'iron_scrap', weight: 1, cooldown: 7, when: 'iron < 20',
          effects: [{ set: 'iron', expr: 'min(iron + 1, 20)' }],
          notify: '헐린 헛간에서 쓸 만한 무쇠 조각을 주워 왔다.' },
        { id: 'ember_luck', weight: 1, cooldown: 6, when: 'not stoked',
          effects: [{ set: 'stoked', expr: '1' }],
          notify: '밤새 화로의 불씨가 살아 있었다. 첫 망치질이 가볍게 나갈 것 같다.' },
        // 소문은 평판을 올리고 귀족의 관심(다음 의뢰 문턱)을 조금 앞당긴다 — 문턱이 오르기만 하면
        // 평판이 상한에 붙은 뒤 의뢰가 영영 끊긴다. 이 역방향이 있어야 장기전에서도 의뢰가 돈다.
        { id: 'praise', weight: 2, cooldown: 5,
          effects: [{ set: 'fame', expr: 'min(fame + 2, 100)' }, { set: 'noble_next', expr: 'max(noble_next - 1, 25)' }],
          notify: '지난번 손님이 공방 소문을 내고 다닌다. 어깨가 조금 펴진다.' },
      ],
    },
  },
  directives: [
    { id: 'craft_rule', when: 'iron >= 1',
      text: '[제작] 물건의 완성도는 [판정]이 정한다. 판정 줄이 없는 턴에 결과를 단정하지 말고, 화로 앞의 긴장만 그려라.' },
    { id: 'tired', when: 'stamina <= 2',
      text: '[상태] 체력 {stamina}/10. 망치를 드는 팔이 무겁다 — 지친 기색이 묘사에 배어나야 한다.' },
    { id: 'backlog', when: 'queue_n >= 3',
      text: '[압박] 주문이 {queue_n}건 밀려 있다. 손님의 독촉이 장면 어딘가에 묻어나야 한다.' },
  ],
  actions: [
    // 벼려내면 동네 주문이 하나 지워진다 — 남작가의 예장검 같은 특별 주문은 보조 AI가 지운다(queue desc).
    { id: 'forge', label: '🔨 벼려낸다', mode: 'oneshot', when: 'iron >= 1 and stamina >= 2', check: 'ck_forge',
      inject: '[행동] 화로 앞에 서서 쇠를 두들긴다.',
      effects: [{ set: 'iron', expr: 'max(iron - 1, 0)' }, { set: 'stamina', expr: 'max(stamina - 2, 0)' },
        { set: 'stoked', expr: '0' }, { list: 'queue', remove: ['동네 주문'] }] },
    { id: 'stoke', label: '🔥 화로를 달군다', mode: 'oneshot', when: 'not stoked and money >= 10', cooldown: 3,
      inject: '[행동] 숯을 들이붓고 풀무를 밟아 화로를 하얗게 달군다.',
      effects: [{ set: 'stoked', expr: '1' }, { set: 'money', expr: 'max(money - 10, 0)' }, { set: 'stamina', expr: 'max(stamina - 1, 0)' }] },
    { id: 'polish', label: '🪞 다듬질', mode: 'hold', when: 'stamina >= 2',
      inject: '[지속] 틈틈이 진열품을 다듬어 광을 낸다.',
      effects: [{ set: 'fame', expr: 'min(fame + 1, 100)' }, { set: 'stamina', expr: 'max(stamina - 1, 0)' }] },
    // 입금/출금 — 효과가 없다. 액수는 장면이 정하고 기록은 보조 AI가 한다.
    // 대신 이 버튼이 눌린 턴에만 금고(vault)의 기록이 열린다 (updater.allow의 whenArmed).
    { id: 'deposit', label: '💰 금고에 넣는다', mode: 'oneshot', when: 'money >= 1',
      inject: '[행동] 지갑의 돈을 금고로 옮긴다. 얼마를 옮겼는지 장면에서 정해 말하라.' },
    { id: 'withdraw', label: '💸 금고에서 꺼낸다', mode: 'oneshot', when: 'vault >= 1',
      inject: '[행동] 금고에서 돈을 꺼내 지갑에 챙긴다. 얼마를 꺼냈는지 장면에서 정해 말하라.' },
  ],
  updater: {
    allow: [
      { id: 'money', maxGain: 300, maxLoss: 300 },
      // 액션 잠금(v0.39) — 입금/출금이 무장·발동된 턴에만 이 변수가 보조 AI에게 열린다
      { id: 'vault', maxDelta: 500, whenArmed: ['deposit', 'withdraw'] },
      { id: 'iron', maxDelta: 4 },
      { id: 'stamina', maxDelta: 3 },
      { id: 'fame', maxDelta: 5 },
      { id: 'dc', maxDelta: 8 },
      { id: 'queue' },
      { id: 'masterwork', maxLength: 40 },
    ],
    guide: '돈은 장부가 둘이다 — 서사에서 벌고 쓴 돈은 전부 지갑(money)에 적어라. '
      + '금고(vault)는 입금/출금 행동이 있던 턴에만 열리며, 그때는 옮긴 액수만큼 지갑과 금고를 함께 움직여라. '
      + '물건의 완성도는 판정이 정한다 — 성패를 네가 정하지 마라.',
  },
  promptState: {
    template: '[공방] 지갑 {money}G | 금고 {vault}G | 무쇠 {iron} | 체력 {stamina}/10\n'
      + '솜씨 {skill}({skill_mod}) | 평판 {fame} ({rank}) | 난이도 {dc}{stoked ? " | 🔥화로 달궈짐" : ""}\n'
      + '주문서: {queue:tags}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '장부', items: [
        { var: 'money' },
        { var: 'vault' },
      ] },
      { label: '공방', items: [
        { var: 'iron', bar: { max: 20 } },
        { var: 'stamina', bar: { max: 10 }, color: 'stamina <= 2 ? "#c0392b" : "#27ae60"' },
        { var: 'stoked', showWhen: 'stoked' },
        { var: 'dc' },
      ] },
      { label: '명성', items: [
        { var: 'fame', bar: { max: 100 } },
        { var: 'rank' },
        { var: 'noble_next', showWhen: 'fame < noble_next' },
        { var: 'queue' },
        { var: 'masterwork', showWhen: 'masterwork != ""' },
      ] },
    ],
    // 화로가 있는 어둠 — 그을린 쇠 위에 잉걸불 주황
    customCSS: `.sim-status { background:#191310; border:1px solid #513c28; border-radius:5px; color:#e3d5c4; }
.sim-status summary { color:#e08840; letter-spacing:.07em; }
.sim-group { border-left:2px solid #513c28; padding-left:9px; }
.sim-group-label { color:#b08968; font-size:.8em; letter-spacing:.12em; }
.sim-label { color:#95826d; opacity:1; }
.sim-value { color:#f6ead9; font-weight:700; }
.sim-badge, .sim-tag { background:#2a1f16; color:#e0a558; border:1px solid #513c28; border-radius:3px; }
.sim-bar { background:#120d0a; height:9px; border:1px solid #3a2b1d; border-radius:2px; }
.sim-action { border-color:#6b4a2c; color:#e8b47c; border-radius:3px; background:#241a12; }
.sim-action.sim-armed { border-color:#e08840; background:#38220f; color:#ffc98a; }
.sim-log { color:#8a7563; }`,
  },
  setup: {
    presets: [
      { id: 'novice', label: '견습 공방', set: {} },
      { id: 'famed', label: '이름난 공방', set: { skill: 16, fame: 45, money: 1500, vault: 800, iron: 12, stamina: 10 } },
      { id: 'broke', label: '맨주먹 재기', set: { skill: 14, fame: 10, money: 60, vault: 0, iron: 2 } },
    ],
    ai: {
      enabled: true,
      vars: ['skill', 'money', 'iron', 'fame'],
      instruction: '[최초 설정] 아직 공방의 첫 장면이 정해지지 않았다. 유저와 짧게 대화하며 어떤 대장간인지(전문 분야, 솜씨, 형편)를 정하고, 정해지면 상황을 정리해 서술하라.',
      guide: '유저가 말한 형편에 맞게 솜씨(10~16)와 재산을 정하라. 화려한 시작보다 두들길 이유가 있는 시작이 좋다.',
    },
  },
};

// ── 함대 — 편성과 출격 ────────────────────────────────────────
// 배울 점 (v0.56 편성 탭의 표준 예제 — 실봇 변환 1호에서 구조만 일반화):
//   ① 편성 탭 여러 개 — 출격 편성(슬롯) / 정비창(슬롯) / 보급(시설: 슬롯 없이 버튼만)
//   ② 탭별 roster — 정비창은 '손상' 목록에 오른 함만 입거 (출격 탭은 공용 '가동' 목록)
//   ③ 가동↔손상 목록은 보조 AI가 서사 따라 옮긴다 → 편성표 잠금이 저절로 따라온다
//      ("한 함 = 한 자리"라 정비 중인 함은 출격 편성에 못 앉는다)
//   ④ 편성 게이트 액션 — "기함을 정해야 출격"(when이 슬롯 변수를 봄). 진단은 이걸
//      '편성 담당 문턱'으로 안내한다 (시뮬은 편성을 못 하므로 — 조건을 낮추지 말 것)
//   ⑤ 함명은 enum이 확정한다 — AI는 명단 밖 이름을 만들 수 없다 (제작자가 후보를 정한다)
//   ⑥ 편성 연동 (v0.59) — 정비창 탭은 when으로 "볼 일이 있을 때만" 보인다 (손상함이 있거나
//      아직 입거 중인 함이 남았을 때). 편성 여부 자체는 deployed 가상 목록으로 어디서든
//      읽는다 — has(deployed, '미리내'). 지시문 실물 예는 RPG 템플릿(아린 편성)에 있다
const FLEET = {
  simcore: '0.1',
  meta: { name: '함대 — 편성과 출격', author: 'SimCore 템플릿' },
  vars: [
    { id: 'fuel', label: '연료', type: 'int', init: 600, min: 0, max: 999 },
    { id: 'ammo', label: '탄약', type: 'int', init: 600, min: 0, max: 999 },
    { id: 'parts', label: '자재', type: 'int', init: 40, min: 0, max: 99 },
    { id: 'alert', label: '경계태세', type: 'enum', init: '평시', enum: ['평시', '경계', '전투'], cmd: '태세',
      desc: '기지의 경계 단계. 적 함영이 보고되면 경계, 교전이 벌어지면 전투로.' },
    { id: 'active', label: '가동', type: 'list', cmd: '가동', maxItems: 8, itemMaxLength: 12,
      init: ['미리내', '놀', '해무', '별찌', '가람', '든바다'],
      desc: '출격 가능한 함. 손상당하면 여기서 빼서 손상 목록으로 옮긴다.' },
    { id: 'damaged', label: '손상', type: 'list', cmd: '손상', init: [], maxItems: 8, itemMaxLength: 12,
      desc: '수리가 필요한 함. 수리가 끝나면 가동 목록으로 되돌린다.' },
    { id: 'flag', label: '기함', type: 'enum', init: '없음',
      enum: ['없음', '미리내', '놀', '해무', '별찌', '가람', '든바다'] },
    { id: 'ship2', label: '2번함', type: 'enum', init: '없음',
      enum: ['없음', '미리내', '놀', '해무', '별찌', '가람', '든바다'] },
    { id: 'ship3', label: '3번함', type: 'enum', init: '없음',
      enum: ['없음', '미리내', '놀', '해무', '별찌', '가람', '든바다'] },
    { id: 'dock1', label: '정비석', type: 'enum', init: '없음',
      enum: ['없음', '미리내', '놀', '해무', '별찌', '가람', '든바다'] },
  ],
  party: {
    label: '편성', icon: '⚓', empty: '없음', roster: 'active',
    note: '정비 중인 함은 출격 편성에 앉힐 수 없다 (한 함 = 한 자리).',
    tabs: [
      { id: 'sortie', label: '출격 편성',
        slots: [{ var: 'flag', label: '기함' }, { var: 'ship2' }, { var: 'ship3' }],
        actions: ['sortie'],
        note: '가동 중인 함만 편성할 수 있다.' },
      { id: 'dock', label: '정비창', roster: 'damaged',
        // 표시 조건 (v0.59) — 손상함이 없고 입거 중인 함도 없으면 탭 자체가 숨는다.
        // dock1 조건을 같이 보는 이유: 수리가 끝나 손상 목록이 비어도 함이 아직 정비석에
        // 앉아 있는 동안은 탭이 보여야 비울 수 있다 (조용히 사라지면 자리가 잠긴 채 남는다).
        when: "count(damaged) > 0 or dock1 != '없음'",
        slots: [{ var: 'dock1' }],
        actions: ['repair'],
        note: '손상 목록에 오른 함만 입거할 수 있다.' },
      { id: 'supply', label: '보급', actions: ['resupply'],
        note: '본부에 보급을 요청한다.' },
    ],
  },
  actions: [
    { id: 'sortie', label: '⚓ 출격', mode: 'oneshot',
      when: "flag != '없음'",
      inject: '[명령] 편성된 함대에 출격 명령이 떨어졌다. 임무 해역으로 향한다.',
      effects: [
        { set: 'fuel', expr: 'max(0, fuel - 40)' },
        { set: 'ammo', expr: 'max(0, ammo - 40)' },
      ] },
    { id: 'repair', label: '🔧 수리 개시', mode: 'oneshot',
      when: "parts >= 10 and dock1 != '없음'",
      inject: '[명령] 정비창에 입거한 함의 수리를 개시한다. 자재를 소모해 손상부를 복구한다.',
      effects: [{ set: 'parts', expr: 'max(0, parts - 10)' }] },
    { id: 'resupply', label: '📦 보급 요청', mode: 'oneshot', cooldown: 6,
      inject: '[명령] 본부에 보급을 요청했다. 며칠 안에 물자가 도착한다.',
      effects: [
        { set: 'fuel', expr: 'min(999, fuel + 250)' },
        { set: 'ammo', expr: 'min(999, ammo + 250)' },
        { set: 'parts', expr: 'min(99, parts + 15)' },
      ] },
  ],
  rules: {
    onTurn: [],
    events: [],
    randomEvents: {
      chancePerTurn: 0.12,
      table: [
        { id: 'contact', weight: 2, cooldown: 5,
          effects: [{ set: 'alert', expr: "'경계'" }],
          notify: '초계에서 미확인 함영 보고 — 경계태세로 전환했다.' },
        { id: 'supply_ship', weight: 2, cooldown: 6,
          effects: [{ set: 'fuel', expr: 'min(999, fuel + 80)' }],
          notify: '순회 보급선이 기지에 들러 연료를 나눠 주고 갔다.' },
      ],
    },
  },
  directives: [
    { id: 'has_damaged', when: 'count(damaged) > 0',
      text: '[상태] 수리 대기 중인 함이 있다: {damaged}. 손상의 여파와 빈 자리가 부대 분위기에 묻어나야 한다.' },
    { id: 'low_fuel', when: 'fuel <= 120',
      text: '[상태] 연료 잔량 {fuel} — 보급이 끊기면 발이 묶인다. 물자 부족의 긴장이 판단에 영향을 줘야 한다.' },
  ],
  updater: {
    model: 'aux',
    allow: [
      { id: 'fuel', maxDelta: 100 },
      { id: 'ammo', maxDelta: 100 },
      { id: 'parts', maxDelta: 12 },
      { id: 'alert' },
      { id: 'active' },
      { id: 'damaged' },
    ],
    guide: '전투·손상·수리·보급이 서사에 명시된 경우에만 반영하라. 함이 손상당하면 가동 목록에서 빼서 '
      + '손상 목록에 넣고, 수리가 끝나면 되돌려라. 함명은 명단 그대로 쓰고 새 이름을 만들지 마라. '
      + '출격 편성(기함·번함)은 지휘관이 정한다 — 바꾸지 마라.',
  },
  promptState: {
    position: 'history_end',
    template: '[함대 현황] 경계태세 {alert} | 연료 {fuel} · 탄약 {ammo} · 자재 {parts}\n'
      + '출격 편성: 기함 {flag} / {ship2} / {ship3}\n정비창: {dock1} | 손상: {damaged}\n가동: {active}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '출격 편성', items: [
        { var: 'flag', showWhen: "flag != '없음'" },
        { var: 'ship2', showWhen: "ship2 != '없음'" },
        { var: 'ship3', showWhen: "ship3 != '없음'" },
      ] },
      { label: '정비창', items: [
        { var: 'dock1', showWhen: "dock1 != '없음'" },
        { var: 'damaged', showWhen: 'count(damaged) > 0' },
      ] },
      { label: '자원', items: [
        { var: 'fuel', bar: { max: 999 }, color: "fuel <= 120 ? '#c0392b' : '#4a7a5a'" },
        { var: 'ammo', bar: { max: 999 }, color: "'#8a6d45'" },
        { var: 'parts', bar: { max: 99 }, color: "'#5a7a8a'" },
      ] },
      { label: '태세', items: [{ var: 'alert' }, { var: 'active' }] },
    ],
    // 강철 관제실 — 짙은 강철색에 신호등 계기
    customCSS: `.sim-status { background:#14181d; border:1px solid #3a4148; border-radius:3px; color:#c9cdd2; }
.sim-status summary { color:#6fa8dc; letter-spacing:.12em; font-weight:700; }
.sim-group { border-left:2px solid #3a4148; padding-left:9px; }
.sim-group-label { color:#8a9199; letter-spacing:.16em; font-size:.8em; }
.sim-label { color:#7a828a; opacity:1; }
.sim-value { color:#e8ebee; font-weight:700; }
.sim-badge, .sim-tag { background:#1d2329; color:#8fc1e8; border:1px solid #3a4148; border-radius:2px; }
.sim-bar { background:#0d1013; height:9px; border:1px solid #2a3138; border-radius:1px; }
.sim-action { border-color:#4a5158; color:#c9cdd2; border-radius:2px; background:#1d2329; }
.sim-action.sim-armed { border-color:#6fa8dc; background:#1b2733; color:#a8d0f0; }
.sim-log { color:#6a727a; }`,
  },
  setup: {
    presets: [
      { id: 'first', label: '제1전대 선발 (미리내 기함)',
        set: { flag: '미리내', ship2: '놀', ship3: '해무' } },
      { id: 'blank', label: '미편성 — 직접 편성', set: {} },
      { id: 'hard', label: '보급 끊긴 전선', set: { fuel: 200, ammo: 150, parts: 10 } },
    ],
  },
};

// ── 미궁 탐사 ────────────────────────────────────────────────
// 원정형 · 무한 깊이. 지상(depth 0)과 지하를 오간다.
//
// 이 템플릿이 가르치는 것 (다른 12종에 없는 것들):
// - statusUI.layout: 'tabs'  — v0.38 기능인데 지금까지 어느 템플릿도 안 썼다.
//   층·진형·소지·기록이 한 화면에 다 쌓이면 못 읽는다. 탭이 필요한 첫 템플릿.
// - 판정 둘이 서로 다른 굴림 규칙을 쓴다 (어둠이면 불리 / 함정은 문턱이 더 높다)
// - 편성 슬롯이 **전투력에 직접 들어간다** (fleet은 출격 자격, 여기는 판정 보정)
// - whenArmed 두 번째 사용처 — 동료 영입 턴에만 명단을 연다 (smith의 금고와 같은 규율)
//
// 설계의 축: **노획물(haul)은 귀환해야 금화가 된다.**
// 목록으로 하면 통째로 비울 방법이 없고(add/remove/expire뿐), 무엇보다 숫자여야
// "지금 돌아갈까, 한 층 더 갈까"가 매 턴 저울질이 된다. 쓰러지면 haul을 잃는다 —
// 원정형이라 캐릭터는 안 죽지만, 잃을 것이 없으면 깊이가 무섭지 않다.
const DELVE = {
  simcore: '0.1',
  meta: { name: '미궁 탐사 기록', author: 'SimCore 템플릿' },
  suggest: { count: 3, guide: '지금 있는 층과 남은 보급으로 할 수 있는 행동. 하나는 물러설 여지를 남겨라.' },
  vars: [
    // ── 탐사 ──
    { id: 'depth', label: '층', type: 'int', init: 0, min: 0, max: 99,
      desc: '0이면 지상(마을). 1층부터가 미궁 안이다. 시스템이 관리하니 서사로 바꾸지 마라.' },
    { id: 'torch', label: '횃불', type: 'int', init: 10, min: 0, max: 30,
      desc: '지하에서 매 턴 하나씩 탄다. 0이 되면 어둠 속이라 모든 판정이 불리해진다.' },
    { id: 'rations', label: '식량', type: 'int', init: 12, min: 0, max: 40,
      desc: '지하에서 매 턴 하나씩 준다. 떨어지면 굶주려 체력이 깎인다.' },
    { id: 'stairs', label: '계단', type: 'bool', init: false,
      desc: '이 층의 내려가는 계단을 찾았는지. 시스템 플래그라 서사로 바꾸지 마라.' },
    { id: 'anchor', label: '귀환 지점', type: 'int', init: 1, min: 1, max: 99, format: '{v}층',
      desc: '살아서 돌아온 가장 깊은 층. 다음 잠행은 여기서 시작한다. 시스템이 관리하니 서사로 바꾸지 마라.' },
    // ── 파티 ──
    { id: 'hp', label: '체력', type: 'int', init: 60, min: 0, max: 999,
      desc: '일행 전체의 여력. 0이 되면 간신히 기어나와 지상으로 돌아가고 노획물을 잃는다.' },
    { id: 'wound', label: '부상', type: 'int', init: 0, min: 0, max: 5,
      desc: '누적 상처. 하나당 판정이 2씩 불리해진다. 지상에서 돈을 들여야만 낫는다.' },
    { id: 'morale', label: '사기', type: 'int', init: 70, min: 0, max: 100 },
    { id: 'front1', label: '전열 1', type: 'enum', init: '가르한',
      enum: ['없음', '가르한', '이슬비', '노루', '무명', '바위손', '실솔'] },
    { id: 'front2', label: '전열 2', type: 'enum', init: '없음',
      enum: ['없음', '가르한', '이슬비', '노루', '무명', '바위손', '실솔'] },
    { id: 'back1', label: '후열 1', type: 'enum', init: '이슬비',
      enum: ['없음', '가르한', '이슬비', '노루', '무명', '바위손', '실솔'] },
    { id: 'back2', label: '후열 2', type: 'enum', init: '없음',
      enum: ['없음', '가르한', '이슬비', '노루', '무명', '바위손', '실솔'] },
    { id: 'roster', label: '동료', type: 'list', init: ['가르한', '이슬비'], maxItems: 6, itemMaxLength: 12,
      desc: '함께 내려갈 수 있는 사람들. 술집에서 새로 구했을 때만 이름을 더해라 — 명단에 없는 사람은 진형에 앉힐 수 없다.' },
    // ── 소지 ──
    { id: 'gold', label: '금화', type: 'int', init: 120, min: 0, max: 99999, format: '{v}닢' },
    { id: 'haul', label: '노획', type: 'int', init: 0, min: 0, max: 9999, format: '{v}닢어치',
      desc: '이번 잠행에서 주운 것. 지상으로 살아 돌아가야 금화가 된다. 쓰러지면 전부 잃는다.' },
    { id: 'relics', label: '유물', type: 'list', init: [], maxItems: 8, itemMaxLength: 20,
      desc: '깊은 곳에서만 나오는 물건. 쓰러져도 잃지 않는다.' },
    // ── 기록 ──
    { id: 'best_depth', label: '최고 도달', type: 'int', init: 0, min: 0, max: 99, format: '{v}층',
      desc: '기록이다. 시스템이 갱신하니 서사로 바꾸지 마라.' },
    { id: 'hall', label: '지금 있는 곳', type: 'text', init: '지상 — 미궁 입구의 마을', maxLength: 60,
      desc: '이 층의 생김새를 한 줄로. 층을 옮기거나 방을 옮기면 갱신하라.' },
  ],
  derived: [
    // 동료가 늘면 버틸 힘도 늘어난다 — 영입에 값을 치를 이유
    { id: 'max_hp', label: '최대 체력', expr: '40 + count(roster) * 12' },
    // 편성이 곧 전투력이다. 전열이 더 크게 실린다 — 앞에 세울 사람을 고르게 만든다
    { id: 'power', label: '전투력',
      expr: "(front1 != '없음' ? 3 : 0) + (front2 != '없음' ? 3 : 0)"
        + " + (back1 != '없음' ? 2 : 0) + (back2 != '없음' ? 2 : 0)" },
    // 무한 미궁의 유일한 난이도 곡선 — 층이 곧 문턱
    { id: 'danger', label: '위험도', expr: '8 + depth' },
    { id: 'light', label: '시야', expr: "torch > 0 ? '밝음' : '어둠'" },
  ],
  checks: [
    // 어둠이면 두 번 굴려 낮은 쪽 — 횃불을 아끼다 판정이 무너지는 걸 몸으로 알게 한다
    { id: 'ck_delve', label: '탐색 판정',
      roll: "light == '어둠' ? min(rand(1, 20), rand(1, 20)) : rand(1, 20)",
      mod: 'power - wound * 2', vs: 'danger',
      grades: [
        { when: 'roll == 20', label: '대발견',
          inject: '벽 너머에 손대지 않은 방이 있었다 — 이 층에서 가장 값진 것을 찾아낸 순간으로 그려라.',
          effects: [
            { set: 'haul', expr: 'haul + 60 + depth * 20' },
            { set: 'morale', expr: 'min(morale + 8, 100)' },
            { list: 'relics', add: ['이름 없는 유물'] },
          ] },
        { when: 'roll == 1', label: '참사',
          inject: '발밑이 무너지거나 잘못된 것을 건드렸다 — 일행이 크게 다치는 참사로 그려라.',
          effects: [
            { set: 'hp', expr: 'max(hp - (10 + depth * 3), 0)' },
            { set: 'wound', expr: 'min(wound + 1, 5)' },
            { set: 'morale', expr: 'max(morale - 12, 0)' },
          ] },
        { when: 'total >= vs', label: '수확',
          effects: [
            { set: 'haul', expr: 'haul + 20 + depth * 8' },
            { set: 'morale', expr: 'min(morale + 3, 100)' },
          ] },
        { label: '허탕',
          effects: [
            { set: 'hp', expr: 'max(hp - (5 + depth), 0)' },
            { set: 'morale', expr: 'max(morale - 4, 0)' },
          ] },
      ] },
    // 함정은 전투력이 덜 먹는다 — 눈썰미의 영역이라 문턱만 높다
    { id: 'ck_trap', label: '함정 판정',
      roll: 'rand(1, 20)', mod: 'power - wound * 2', vs: 'danger + 3',
      grades: [
        { when: 'total >= vs', label: '간파',
          inject: '먼저 알아채고 피했다 — 아슬아슬하게 비켜선 순간으로 짧게 그려라.' },
        { label: '적중',
          inject: '피할 새가 없었다 — 함정이 일행을 덮치는 장면으로 그려라.',
          effects: [
            { set: 'hp', expr: 'max(hp - (8 + depth * 2), 0)' },
            { set: 'wound', expr: 'min(wound + 1, 5)' },
          ] },
      ] },
  ],
  actions: [
    // ── 지하 ──
    { id: 'delve', label: '⛏ 파헤친다', mode: 'oneshot',
      when: 'depth > 0', check: 'ck_delve',
      inject: '[행동] 이 층을 더 뒤진다. 벽을 두드리고 문을 열어 본다.' },
    { id: 'descend', label: '🪜 더 내려간다', mode: 'oneshot',
      when: 'depth > 0 and stairs',
      inject: '[행동] 찾아낸 계단으로 한 층 더 내려간다. 공기가 달라진다.',
      effects: [
        { set: 'depth', expr: 'min(depth + 1, 99)' },
        { set: 'stairs', expr: '0' },
        { set: 'morale', expr: 'max(morale - 3, 0)' },
      ] },
    { id: 'camp', label: '🏕 야영한다', mode: 'oneshot',
      when: 'depth > 0 and rations >= 2',
      inject: '[행동] 막다른 방을 골라 불을 피우고 눈을 붙인다.',
      effects: [
        { set: 'rations', expr: 'max(rations - 2, 0)' },
        { set: 'hp', expr: 'min(hp + round(max_hp * 0.3), max_hp)' },
        { set: 'morale', expr: 'min(morale + 6, 100)' },
      ] },
    { id: 'retreat', label: '⬆ 지상으로 돌아간다', mode: 'oneshot',
      when: 'depth > 0',
      inject: '[행동] 왔던 길을 되짚어 올라간다. 이번 잠행은 여기까지다.',
      effects: [
        { set: 'gold', expr: 'min(gold + haul, 99999)' },
        { set: 'haul', expr: '0' },
        { set: 'anchor', expr: 'max(anchor, depth)' },
        { set: 'depth', expr: '0' },
        { set: 'stairs', expr: '0' },
        { set: 'hall', expr: "'지상 — 미궁 입구의 마을'" },
        { set: 'morale', expr: 'min(morale + 8, 100)' },
      ] },
    // ── 지상 ──
    { id: 'enter', label: '🕳 미궁으로 내려간다', mode: 'oneshot',
      when: 'depth == 0 and torch > max(anchor - 1, 0)',
      inject: '[행동] 입구의 찬 공기를 지나 지난번 돌아온 깊이까지 익숙한 길로 내려간다.',
      effects: [
        { set: 'depth', expr: 'max(anchor, 1)' },
        { set: 'torch', expr: 'max(torch - max(anchor - 1, 0), 0)' },
        { set: 'stairs', expr: '0' },
      ] },
    // ⚠ 교착 방지 — 이게 없으면 판이 죽는다.
    // 실측: 횃불 0 · 금화 28에서 영구 정지했다. 보급은 50이 필요하고, 금화는 내려가야 벌리고,
    // 내려가려면 횃불이 필요하다. 어느 프리셋의 문제가 아니라 누구나 빠질 수 있는 구멍이었다.
    // 조건 없이 언제나 눌리는 소액 수입을 지상에 하나 둬서 바닥을 받친다.
    { id: 'odd_job', label: '🪣 삯일을 한다', mode: 'oneshot',
      when: 'depth == 0',
      inject: '[행동] 하루 품을 판다. 짐을 나르거나 허드렛일을 하고 몇 닢을 받는다.',
      effects: [
        { set: 'gold', expr: 'min(gold + 20, 99999)' },
        { set: 'morale', expr: 'max(morale - 2, 0)' },
      ] },
    { id: 'supply', label: '🛒 보급한다', mode: 'oneshot',
      when: 'depth == 0 and gold >= 50',
      inject: '[행동] 잡화점에서 횃불과 마른 식량을 사들인다.',
      effects: [
        { set: 'gold', expr: 'max(gold - 50, 0)' },
        { set: 'torch', expr: 'min(torch + 8, 30)' },
        { set: 'rations', expr: 'min(rations + 8, 40)' },
      ] },
    { id: 'heal', label: '🩹 상처를 돌본다', mode: 'oneshot',
      when: 'depth == 0 and wound >= 1 and gold >= 80',
      inject: '[행동] 의원을 찾아 상처를 제대로 꿰맨다.',
      effects: [
        { set: 'gold', expr: 'max(gold - 80, 0)' },
        { set: 'wound', expr: 'max(wound - 1, 0)' },
        { set: 'hp', expr: 'max_hp' },
      ] },
    // 누가 오는지는 서사가 정한다 — 그래서 효과가 없고, 명단은 이 턴에만 열린다(whenArmed)
    { id: 'recruit', label: '🍺 술집에서 사람을 구한다', mode: 'oneshot', cooldown: 4,
      when: 'depth == 0 and gold >= 120 and count(roster) < 6',
      inject: '[행동] 술집 구석에 앉아 함께 내려갈 사람을 찾는다. '
        + '누가 응했는지 장면에서 정하고, 그 이름을 동료 명단에 올려라 (명단에 없는 이름은 진형에 앉지 못한다).',
      effects: [{ set: 'gold', expr: 'max(gold - 120, 0)' }] },
  ],
  rules: {
    // 지하에서만 타고 준다. 규칙엔 조건이 없으니 식 안에서 층을 본다
    onTurn: [
      { set: 'torch', expr: 'depth > 0 ? max(torch - 1, 0) : torch' },
      { set: 'rations', expr: 'depth > 0 ? max(rations - 1, 0) : rations' },
      { set: 'hp', expr: 'depth > 0 and rations <= 0 ? max(hp - 6, 0) : hp' },
      { set: 'morale', expr: "depth > 0 and light == '어둠' ? max(morale - 5, 0) : morale" },
      { set: 'best_depth', expr: 'max(best_depth, depth)' },
    ],
    events: [
      // 원정형이라 죽지 않는다 — 대신 노획물을 통째로 잃고 기어나온다.
      // hp를 1로 올려 조건을 스스로 닫는다 (안 그러면 매 턴 재발동)
      { id: 'crawl_out', when: 'hp <= 0',
        notify: '더는 서 있을 수 없었다. 주운 것을 죄다 버리고 왔던 길로 기어 올라간다.',
        effects: [
          { set: 'hp', expr: '1' },
          { set: 'haul', expr: '0' },
          { set: 'anchor', expr: 'max(anchor - 2, 1)' },
          { set: 'wound', expr: 'min(wound + 1, 5)' },
          { set: 'morale', expr: 'max(morale - 20, 0)' },
          { set: 'depth', expr: '0' },
          { set: 'stairs', expr: '0' },
          { set: 'hall', expr: "'지상 — 미궁 입구의 마을'" },
        ] },
    ],
    randomEvents: {
      chancePerTurn: 0.4,
      table: [
        { id: 'find_stairs', weight: 4, when: 'depth > 0 and not stairs',
          effects: [{ set: 'stairs', expr: '1' }],
          notify: '내려가는 계단을 찾았다. 더 깊이 갈 수 있다.' },
        { id: 'trap', weight: 3, when: 'depth > 0', cooldown: 3, check: 'ck_trap',
          notify: '바닥의 돌 하나가 다른 소리를 냈다.' },
        { id: 'spring', weight: 2, when: 'depth > 0 and hp < max_hp', cooldown: 5,
          effects: [{ set: 'hp', expr: 'min(hp + 12, max_hp)' }],
          notify: '벽을 타고 흐르는 맑은 물을 찾았다. 잠시 숨을 돌린다.' },
        { id: 'cache', weight: 2, when: 'depth > 0', cooldown: 4,
          effects: [{ set: 'torch', expr: 'min(torch + 2, 30)' }],
          notify: '앞서 내려간 누군가의 짐이 남아 있다. 쓸 만한 횃불을 챙겼다.' },
        // 갈림길 — 큰 놈. 마지막 선택지가 타임아웃 기본값이라 조건을 달지 않는다
        { id: 'big_one', weight: 2, when: 'depth >= 2', cooldown: 6, timeout: 2,
          notify: '통로 저편에서 무언가 큰 것이 이쪽을 보고 있다. 아직 움직이지는 않는다.',
          choices: [
            { label: '맞선다',
              inject: '물러설 곳이 없다고 판단했다 — 정면으로 부딪치는 싸움으로 그려라.',
              effects: [
                { set: 'hp', expr: 'max(hp - (12 + depth * 2 - power), 0)' },
                { set: 'haul', expr: 'haul + 40 + depth * 15' },
                { set: 'morale', expr: 'min(morale + 6, 100)' },
              ] },
            { label: '식량을 던져 주고 물러선다', when: 'rations >= 3',
              inject: '먹을 것을 던져 시선을 돌리고 그 틈에 빠져나간다.',
              effects: [
                { set: 'rations', expr: 'max(rations - 3, 0)' },
                { set: 'morale', expr: 'max(morale - 4, 0)' },
              ] },
            { label: '불을 크게 피워 쫓는다',
              inject: '가진 불을 한꺼번에 태워 몰아낸다 — 밝기와 열기로 밀어내는 장면으로.',
              effects: [
                { set: 'torch', expr: 'max(torch - 3, 0)' },
                { set: 'morale', expr: 'max(morale - 2, 0)' },
              ] },
          ] },
      ],
    },
  },
  directives: [
    { id: 'in_dark', when: "depth > 0 and light == '어둠'",
      text: '[상태] 횃불이 다 탔다. 손끝으로 벽을 짚어야 걷는 어둠이다. 방향 감각과 소리에 기대는 묘사가 배어나야 한다.' },
    { id: 'starving', when: 'depth > 0 and rations <= 0',
      text: '[상태] 먹을 것이 떨어졌다. 배고픔과 탈진이 판단과 말수에 드러나야 한다.' },
    { id: 'battered', when: 'wound >= 3',
      text: '[상태] 상처가 {wound}겹으로 쌓였다. 성한 데가 없어 움직임 하나하나가 굼뜨다.' },
    { id: 'deep', when: 'depth >= 5',
      text: '[상태] 지금 {depth}층이다. 위쪽과는 공기도 소리도 다르다 — 깊이가 주는 압박을 장면에 실어라.' },
    { id: 'topside', when: 'depth == 0',
      text: '[상태] 지금은 지상의 마을이다. 미궁의 위험은 없고, 보급·치료·사람 구하기를 할 수 있다.' },
  ],
  updater: {
    model: 'aux',
    allow: [
      { id: 'hp', maxDelta: 25 },
      { id: 'morale', maxDelta: 15 },
      { id: 'torch', maxDelta: 4 },
      { id: 'rations', maxDelta: 4 },
      { id: 'haul', maxGain: 40 },
      { id: 'relics' },
      { id: 'hall' },
      // 명단은 술집에서 사람을 구한 턴에만 열린다 — 아무 때나 열어 두면
      // 서사가 스쳐 지나간 사람까지 동료로 올린다 (smith의 금고와 같은 규율)
      { id: 'roster', whenArmed: ['recruit'] },
    ],
    guide: '탐색·조우·야영이 서사에 명시된 경우에만 반영하라. 층·계단·부상·금화·최고 기록은 시스템이 관리하니 '
      + '건드리지 마라. 노획은 실제로 무엇을 주웠는지 장면에 나왔을 때만 올려라. '
      + '진형(전열·후열)은 탐색자가 정한다 — 바꾸지 마라. 동료 이름은 명단에 있는 것만 쓰고 새로 지어내지 마라.',
  },
  promptState: {
    position: 'history_end',
    template: '[탐사 현황] {hall}\n'
      + '{depth}층 · 시야 {light} (횃불 {torch}) · 식량 {rations}\n'
      + '체력 {hp}/{max_hp} · 부상 {wound} · 사기 {morale} · 전투력 {power}\n'
      + '전열 {front1} / {front2} · 후열 {back1} / {back2}\n'
      + '노획 {haul} · 금화 {gold} · 최고 {best_depth}',
    includeEvents: true,
  },
  party: {
    label: '진형', icon: '🗡', empty: '없음', roster: 'roster',
    note: '전열은 앞에서 맞고 후열은 뒤에서 거든다 — 전열이 전투력에 더 크게 실린다. 한 사람은 한 자리에만.',
    tabs: [
      { id: 'formation', label: '진형',
        slots: [
          { var: 'front1', label: '전열 1' },
          { var: 'front2', label: '전열 2' },
          { var: 'back1', label: '후열 1' },
          { var: 'back2', label: '후열 2' },
        ],
        actions: ['enter', 'retreat'],
        note: '명단에 오른 동료만 앉힐 수 있다.' },
      { id: 'town', label: '지상', when: 'depth == 0',
        actions: ['odd_job', 'supply', 'heal', 'recruit'],
        note: '미궁 밖에서만 할 수 있는 일들.' },
    ],
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    // 탭 배치의 첫 사용처 — 네 갈래를 한 번에 쌓으면 상태창이 화면을 다 먹는다
    layout: 'tabs',
    groups: [
      { label: '탐사', items: [
        { var: 'depth' },
        { var: 'hall' },
        { var: 'torch', bar: { max: 30 }, color: "torch <= 0 ? '#7a3b2e' : (torch <= 2 ? '#a8763a' : '#b8863a')" },
        { var: 'rations', bar: { max: 40 }, color: "rations <= 0 ? '#7a3b2e' : '#6a7a4a'" },
        { var: 'light' },
        { var: 'stairs', showWhen: 'stairs' },
        { var: 'anchor' },
      ] },
      { label: '일행', items: [
        { var: 'hp', bar: { max: 'max_hp' }, color: "hp <= max_hp * 0.3 ? '#8a3b3b' : '#5a7a5a'" },
        { var: 'wound', showWhen: 'wound > 0' },
        { var: 'morale', bar: { max: 100 }, color: "morale <= 30 ? '#7a3b2e' : '#5a6a8a'" },
        { var: 'power' },
        { var: 'front1', showWhen: "front1 != '없음'" },
        { var: 'front2', showWhen: "front2 != '없음'" },
        { var: 'back1', showWhen: "back1 != '없음'" },
        { var: 'back2', showWhen: "back2 != '없음'" },
      ] },
      { label: '소지', items: [
        { var: 'haul', showWhen: 'haul > 0' },
        { var: 'gold' },
        { var: 'relics', showWhen: 'count(relics) > 0' },
        { var: 'roster' },
      ] },
      { label: '기록', items: [
        { var: 'best_depth' },
        { var: 'danger' },
      ] },
    ],
    // 돌과 그을음 — 횃불 하나로 읽는 화면
    customCSS: `.sim-status { background:#15120f; border:1px solid #3b322a; border-radius:2px; color:#cbbfae; }
.sim-status summary { color:#c89a4a; letter-spacing:.14em; font-weight:700; }
.sim-group-label { color:#8a7a63; letter-spacing:.18em; font-size:.78em; }
.sim-label { color:#8a7a63; opacity:1; }
.sim-value { color:#efe4d2; font-weight:700; }
.sim-badge, .sim-tag { background:#201b16; color:#c89a4a; border:1px solid #4a3d30; border-radius:2px; }
.sim-bar { background:#0d0b09; height:8px; border:1px solid #33291f; border-radius:1px; }
.sim-action { border-color:#4a3d30; color:#cbbfae; border-radius:2px; background:#201b16; }
.sim-action.sim-armed { border-color:#c89a4a; background:#2c2318; color:#f0d9a8; }
.sim-log { color:#6d6052; }`,
  },
  setup: {
    presets: [
      { id: 'first', label: '첫 잠행 — 둘이서 내려간다',
        set: { front1: '가르한', back1: '이슬비' } },
      { id: 'veteran', label: '숙련 탐색자 — 넷을 갖췄다',
        set: {
          roster: ['가르한', '이슬비', '노루', '무명', '바위손'],
          front1: '가르한', front2: '바위손', back1: '이슬비', back2: '무명',
          gold: 400, torch: 16, rations: 20, best_depth: 4, anchor: 4, wound: 1,
        } },
      { id: 'debt', label: '빚에 쫓겨 — 혼자 내려간다',
        set: { roster: ['가르한'], front1: '가르한', back1: '없음',
          gold: 0, torch: 3, rations: 4, wound: 2, morale: 45 } },
    ],
  },
};

// ── 좀비 아포칼립스 ──────────────────────────────────────────
// 낮에 나가서 뒤지고, 밤에 은신처에서 버틴다.
//
// survival(혹한의 정착지)과 겹치지 않게 축을 다르게 잡았다.
// 저쪽은 턴이 곧 하루고 자원이 고갈되는 이야기, 이쪽은 **시계가 실제로 흐르고
// 모든 행동에 소음이라는 대가가 붙는** 이야기다.
//
// 손댈 자리를 알아보기 쉽게 축을 셋만 뒀다 — 이 셋만 이해하면 개조가 된다:
//   ① 소음(noise)  모든 행동에 붙는 대가. 밤 습격 확률의 유일한 입력.
//   ② 감염(bitten) 물리면 시작되는 시한. 밤을 넘길 때마다 1씩 는다. 약으로만 되돌린다.
//   ③ 낮과 밤       낮엔 나가고, 밤엔 못 나간다. 🌙로 밤을 넘기며 하루가 정산된다.
//
// ⚠ 개조할 때 알아 둘 것 — 진단을 돌리면 "액션을 쓸수록 더 빨리 죽습니다"가 뜬다.
// 결함이 아니라 시계가 명시적(explicit)이어서다. 진단의 "방치" 쪽은 아무 버튼도 안 누르니
// 시간이 아예 안 흐르고, 시간이 안 흐르면 굶지도 감염이 진행되지도 않는다 — 영원히 산다.
// 실제로는 밤을 넘겨야 판이 굴러가므로 이 비교 자체가 성립하지 않는다.
// 이 템플릿의 난이도는 test-zombie.js가 실제 하루 리듬으로 굴려서 잰다.
//
// 여기에만 있는 것: **패배 조건이 bool 변수 하나(dead)로 명시돼 있다.**
// 그래야 진단이 생존율과 프리셋 난이도를 자동으로 잰다 — 미궁 템플릿은 이게 없어서
// "판이 끝나는 조건이 있어야 어느 쪽이 더 어려운지를 잴 수 있습니다" 경고가 떴다.
const ZOMBIE = {
  simcore: '0.1',
  meta: { name: '아포칼립스 생존 기록', author: 'SimCore 템플릿' },
  suggest: { count: 3, guide: '지금 시각과 남은 물자로 할 수 있는 행동. 하나는 소리를 덜 내는 쪽으로.' },
  // 시계가 진짜로 흐른다. 밤에는 나갈 수 없으므로 낮의 길이가 곧 하루의 예산이다.
  time: {
    start: '2026-08-14 07:00', advance: 'explicit',
    format: { date: 'M월 D일', clock: 'HH:mm' },
    calendar: 'gregorian',
  },
  vars: [
    // ── 지금 ──
    { id: 'place', label: '장소', type: 'enum', init: '은신처',
      enum: ['은신처', '주택가', '상가', '주유소', '병원'],
      cmd: '장소',
      desc: '지금 있는 곳. 나가기·돌아오기는 버튼이 하고, 어느 건물인지는 서사나 /장소 명령이 정한다. 병원일수록 약이 많지만 위험하다.' },
    { id: 'noise', label: '소음', type: 'int', init: 10, min: 0, max: 100,
      desc: '내가 낸 소리가 쌓인 값. 밤에 이만큼 몰려온다. 총을 쏘면 크게 오르고, 하루가 지나면 가라앉는다.' },
    { id: 'skip_min', label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 480,
      desc: '이번 응답에서 흐른 시간(분). 짧은 대화는 0~10, 이동이나 수색은 30~120. 밤을 넘기는 건 버튼이 한다.' },
    // ── 몸 ──
    { id: 'hp', label: '체력', type: 'int', init: 70, min: 0, max: 100 },
    { id: 'bitten', label: '감염', type: 'int', init: 0, min: 0, max: 5,
      desc: '물린 뒤 진행된 정도. 0이면 멀쩡하다. 밤을 넘길 때마다 1씩 오르고 5가 되면 끝이다. 약으로만 되돌린다.' },
    { id: 'hope', label: '희망', type: 'int', init: 60, min: 0, max: 100 },
    { id: 'dead', label: '끝', type: 'bool', init: false,
      desc: '판이 끝났는지. 시스템이 정하니 서사로 바꾸지 마라.' },
    // ── 물자 ──
    { id: 'food', label: '식량', type: 'int', init: 6, min: 0, max: 60, format: '{v}끼' },
    { id: 'med', label: '약품', type: 'int', init: 1, min: 0, max: 20 },
    { id: 'ammo', label: '탄약', type: 'int', init: 4, min: 0, max: 60, format: '{v}발' },
    { id: 'loot', label: '주운 것', type: 'list', init: [], maxItems: 10, itemMaxLength: 20,
      desc: '수색에서 건진 잡동사니. 물자로 안 잡히는 것들 — 라디오, 지도, 사진 같은 것.' },
    // ── 은신처 ──
    { id: 'barricade', label: '방벽', type: 'int', init: 50, min: 0, max: 100,
      desc: '은신처를 막아 둔 정도. 밤 습격을 여기서 받아낸다. 습격마다 깎이고 보강으로 올린다.' },
    // ── 사람 ──
    { id: 'crew', label: '동료', type: 'list', init: ['정한', '미주'], maxItems: 6, itemMaxLength: 12,
      desc: '함께 있는 사람들. 새로 받아들였을 때만 이름을 더해라 — 명단에 없는 사람은 조에 넣을 수 없다.' },
    { id: 'scout1', label: '탐색조 1', type: 'enum', init: '정한',
      enum: ['없음', '정한', '미주', '노경', '태식', '유리', '봄이'] },
    { id: 'scout2', label: '탐색조 2', type: 'enum', init: '없음',
      enum: ['없음', '정한', '미주', '노경', '태식', '유리', '봄이'] },
    { id: 'guard1', label: '보초', type: 'enum', init: '미주',
      enum: ['없음', '정한', '미주', '노경', '태식', '유리', '봄이'] },
  ],
  derived: [
    // daily와 같은 방식 — 때를 hour에서 파생한다. 세는 곳이 하나면 어긋날 수가 없다
    { id: 'tod', label: '때',
      expr: "hour < 5 ? '새벽' : (hour < 11 ? '아침' : (hour < 17 ? '낮' : (hour < 20 ? '해질녘' : '밤')))" },
    { id: 'is_night', label: '밤인가', expr: 'hour >= 20 or hour < 5' },
    // 탐색조가 많을수록 수색이 잘 되고, 보초가 있어야 밤을 버틴다
    { id: 'scouts', label: '탐색조',
      expr: "(scout1 != '없음' ? 1 : 0) + (scout2 != '없음' ? 1 : 0)" },
    { id: 'watch', label: '경계', expr: "guard1 != '없음' ? 20 : 0" },
    // 밤에 몰려오는 양 — 소음이 유일한 입력이다. 여기 식 하나가 이 판의 난이도다
    { id: 'horde', label: '예상 습격', expr: 'round(noise * 0.6)' },
  ],
  checks: [
    // 장소가 문턱이고 탐색조가 보정이다. 밤에 나가면 크게 불리하다
    { id: 'ck_scavenge', label: '수색 판정',
      roll: "is_night ? min(rand(1, 20), rand(1, 20)) : rand(1, 20)",
      mod: 'scouts * 3 - round(bitten * 1.5)',
      vs: "place == '병원' ? 15 : (place == '주유소' ? 13 : (place == '상가' ? 11 : 9))",
      grades: [
        { when: 'roll == 20', label: '노다지',
          inject: '손대지 않은 창고를 찾았다 — 오늘을 며칠로 늘려 준 발견으로 그려라.',
          effects: [
            { set: 'food', expr: 'min(food + 6, 60)' },
            { set: 'med', expr: 'min(med + 2, 20)' },
            { set: 'ammo', expr: 'min(ammo + 4, 60)' },
            { set: 'hope', expr: 'min(hope + 10, 100)' },
            { list: 'loot', add: ['쓸 만한 물건'] },
          ] },
        { when: 'roll == 1', label: '물렸다',
          inject: '어디서 나왔는지 알 수 없는 손이 팔을 붙잡았다 — 물리는 순간으로 그려라. 이건 되돌릴 수 없다.',
          effects: [
            { set: 'hp', expr: 'max(hp - 18, 0)' },
            { set: 'bitten', expr: 'max(bitten, 1)' },
            { set: 'noise', expr: 'min(noise + 20, 100)' },
            { set: 'hope', expr: 'max(hope - 15, 0)' },
          ] },
        { when: 'total >= vs', label: '수확',
          effects: [
            { set: 'food', expr: 'min(food + 3, 60)' },
            { set: 'med', expr: "min(med + (place == '병원' ? 2 : 0), 20)" },
            { set: 'noise', expr: 'min(noise + 8, 100)' },
          ] },
        { label: '빈손',
          effects: [
            { set: 'hp', expr: 'max(hp - 5, 0)' },
            { set: 'noise', expr: 'min(noise + 12, 100)' },
            { set: 'hope', expr: 'max(hope - 4, 0)' },
          ] },
      ] },
  ],
  actions: [
    // ── 낮에 밖에서 ──
    { id: 'scavenge', label: '🔦 뒤진다', mode: 'oneshot',
      when: "place != '은신처' and not dead", check: 'ck_scavenge',
      inject: '[행동] 이 건물을 뒤진다. 문을 열 때마다 숨을 죽인다.',
      effects: [{ set: 'skip_min', expr: 'skip_min + 90' }] },
    // 나가고 돌아오는 것만 버튼이 확정한다. **어느 건물인지는 서사가 정한다** —
    // 목적지까지 버튼으로 만들면 액션이 다섯 개로 늘고, AI에게 맡기면 아예 못 나간다.
    // 가운데를 택했다: 나가면 일단 주택가고, /장소 명령이나 서사로 옮겨 간다.
    { id: 'go_out', label: '🚶 나간다', mode: 'oneshot',
      when: "place == '은신처' and not dead",
      inject: '[행동] 문을 열고 밖으로 나선다. 어디로 향하는지 정하라 — 주택가·상가·주유소·병원 중 하나이고, '
        + '그 장소를 상태에 반영하라. 아무 말이 없으면 가까운 주택가다.',
      effects: [
        { set: 'place', expr: "'주택가'" },
        { set: 'skip_min', expr: 'skip_min + 60' },
        { set: 'noise', expr: 'min(noise + 5, 100)' },
      ] },
    { id: 'go_home', label: '🏚 은신처로 돌아간다', mode: 'oneshot',
      when: "place != '은신처' and not dead",
      inject: '[행동] 왔던 길로 돌아간다. 짐을 안고 문을 두드리는 장면으로.',
      effects: [
        { set: 'place', expr: "'은신처'" },
        { set: 'skip_min', expr: 'skip_min + 60' },
      ] },
    { id: 'shoot', label: '🔫 쏜다', mode: 'oneshot',
      when: 'ammo >= 1 and not dead',
      inject: '[행동] 총을 쓴다. 확실하지만 소리가 멀리 간다.',
      effects: [
        { set: 'ammo', expr: 'max(ammo - 1, 0)' },
        { set: 'noise', expr: 'min(noise + 25, 100)' },
        { set: 'skip_min', expr: 'skip_min + 10' },
      ] },
    // ── 은신처에서 ──
    { id: 'fortify', label: '🔨 방벽을 보강한다', mode: 'oneshot',
      when: "place == '은신처' and not dead",
      inject: '[행동] 판자와 못으로 문과 창을 다시 막는다.',
      effects: [
        { set: 'barricade', expr: 'min(barricade + 20, 100)' },
        { set: 'noise', expr: 'min(noise + 10, 100)' },
        { set: 'skip_min', expr: 'skip_min + 120' },
      ] },
    { id: 'treat', label: '💊 약을 쓴다', mode: 'oneshot',
      when: 'med >= 1 and (bitten >= 1 or hp < 60) and not dead',
      inject: '[행동] 남은 약을 쓴다. 물린 자리를 다시 소독하고 붕대를 간다.',
      effects: [
        { set: 'med', expr: 'max(med - 1, 0)' },
        { set: 'bitten', expr: 'max(bitten - 2, 0)' },
        { set: 'hp', expr: 'min(hp + 20, 100)' },
        { set: 'skip_min', expr: 'skip_min + 30' },
      ] },
    { id: 'rest', label: '☕ 숨을 돌린다', mode: 'oneshot',
      when: 'not dead',
      inject: '[행동] 잠깐 앉아 숨을 고른다. 아무 일도 하지 않는 시간이 필요할 때가 있다.',
      effects: [
        { set: 'hope', expr: 'min(hope + 6, 100)' },
        { set: 'skip_min', expr: 'skip_min + 60' },
      ] },
    // ── 하루를 닫는다 ──
    // daily의 💤과 같은 계산 — 지금이 몇 시든 **다음 날 07:00**으로 간다.
    // 감염·허기·소음 감쇠가 전부 여기서 하루치로 정산된다. 이 버튼이 이 템플릿의 심장이다.
    { id: 'nightfall', label: '🌙 밤을 넘긴다', mode: 'oneshot', impactExempt: true,
      when: 'not dead',
      inject: '[행동] 불을 끄고 아침까지 버틴다. 밤에 무슨 소리를 들었는지 짧게 그려라.',
      effects: [
        { set: 'skip_min', expr: 'skip_min + ((1859 - hour * 60 - minute) % 1440) + 1' },
        { set: 'food', expr: 'max(food - 2, 0)' },
        { set: 'hp', expr: 'food <= 1 ? max(hp - 10, 0) : min(hp + 5, 100)' },
        { set: 'bitten', expr: 'bitten >= 1 ? min(bitten + 1, 5) : 0' },
        // 방벽과 보초가 습격을 받아낸다. 남은 몫이 사람에게 온다
        { set: 'hp', expr: 'max(hp - max(horde - barricade - watch, 0), 0)' },
        { set: 'barricade', expr: 'max(barricade - round(horde * 0.5), 0)' },
        { set: 'noise', expr: 'max(round(noise * 0.4), 0)' },
        { set: 'hope', expr: 'max(hope - 3, 0)' },
      ] },
  ],
  rules: {
    onTurn: [],
    events: [
      // 판을 끝내는 두 길. bool 하나로 명시해야 진단이 난이도를 잰다
      { id: 'turned', when: 'bitten >= 5 and not dead',
        notify: '열이 가라앉고 시야가 또렷해진다. 배가 고프지 않다. 이제 아무것도 무섭지 않다.',
        effects: [{ set: 'dead', expr: '1' }] },
      { id: 'bled_out', when: 'hp <= 0 and not dead',
        notify: '더는 일어설 수 없다. 문 밖의 소리가 점점 가까워진다.',
        effects: [{ set: 'dead', expr: '1' }] },
      // 방벽이 무너지면 은신처를 잃는다 — 죽지는 않지만 밤이 훨씬 위험해진다
      { id: 'breached', when: 'barricade <= 0 and hope > 0',
        notify: '막아 둔 것이 다 무너졌다. 오늘 밤은 아무것도 우리를 가려 주지 않는다.',
        effects: [{ set: 'hope', expr: 'max(hope - 20, 0)' }] },
    ],
    randomEvents: {
      chancePerTurn: 0.3,
      table: [
        { id: 'radio', weight: 2, cooldown: 8, when: 'not dead',
          effects: [{ set: 'hope', expr: 'min(hope + 8, 100)' }],
          notify: '라디오에서 사람 목소리가 잡혔다. 몇 초뿐이었지만 분명히 살아 있는 사람이었다.' },
        { id: 'rain', weight: 2, cooldown: 6, when: 'not dead',
          effects: [{ set: 'noise', expr: 'max(noise - 10, 0)' }],
          notify: '비가 쏟아진다. 빗소리가 다른 모든 소리를 덮어 준다.' },
        { id: 'rot', weight: 2, cooldown: 5, when: 'food >= 2 and not dead',
          effects: [{ set: 'food', expr: 'max(food - 2, 0)' }],
          notify: '더위에 남은 음식이 상했다. 여름은 아무것도 오래 두지 못하게 한다.' },
        // ── 갈림길 둘 — 마지막 선택지는 조건 없이 둬야 타임아웃 자동 결정이 된다 ──
        { id: 'stranger', weight: 3, cooldown: 10, timeout: 2,
          when: "not dead and count(crew) < 6 and place == '은신처'",
          notify: '문 두드리는 소리. 사람이다 — 혼자고, 다치지는 않은 것 같다. 들여보낼지 정해야 한다.',
          choices: [
            { label: '들인다',
              inject: '문을 연다. 사람이 하나 늘면 손도 늘지만 먹을 입도 는다. '
                + '이름을 정하고 동료 명단에 올려라.',
              effects: [
                { set: 'hope', expr: 'min(hope + 10, 100)' },
                { set: 'food', expr: 'max(food - 1, 0)' },
              ] },
            { label: '물자만 쥐여 보낸다', when: 'food >= 2',
              inject: '문틈으로 먹을 것을 밀어 준다. 미안하지만 여기까지다.',
              effects: [
                { set: 'food', expr: 'max(food - 2, 0)' },
                { set: 'hope', expr: 'max(hope - 2, 0)' },
              ] },
            { label: '숨을 죽이고 기다린다',
              inject: '아무 소리도 내지 않는다. 발소리가 멀어질 때까지.',
              effects: [{ set: 'hope', expr: 'max(hope - 8, 0)' }] },
          ] },
        { id: 'the_horde', weight: 3, cooldown: 6, timeout: 2,
          when: "not dead and place != '은신처'",
          notify: '길 끝에서 무리가 이쪽으로 흘러온다. 아직 우리를 못 봤다.',
          choices: [
            { label: '조용히 물러선다',
              inject: '한 걸음씩, 등을 보이지 않고 뒤로.',
              effects: [{ set: 'skip_min', expr: 'skip_min + 45' }] },
            { label: '뚫는다', when: 'ammo >= 2',
              inject: '길이 하나뿐이다. 쏘면서 지나간다 — 소리가 멀리 갈 것이다.',
              effects: [
                { set: 'ammo', expr: 'max(ammo - 2, 0)' },
                { set: 'noise', expr: 'min(noise + 35, 100)' },
                { set: 'hp', expr: 'max(hp - 8, 0)' },
              ] },
            { label: '뭔가를 던져 시선을 돌린다',
              inject: '먼 쪽으로 무언가를 던진다. 소리가 나는 쪽으로 무리가 돌아선다.',
              effects: [
                { set: 'noise', expr: 'min(noise + 10, 100)' },
                { set: 'skip_min', expr: 'skip_min + 20' },
              ] },
          ] },
      ],
    },
  },
  directives: [
    { id: 'is_bitten', when: 'bitten >= 1 and not dead',
      text: '[상태] 물린 자리가 낫지 않는다 (감염 {bitten}/5). 열과 오한, 숨기려는 태도가 묘사에 배어나야 한다. '
        + '밤을 넘길 때마다 나빠진다는 걸 본인도 안다.' },
    { id: 'loud', when: 'noise >= 60 and not dead',
      text: '[상태] 오늘 너무 시끄러웠다 (소음 {noise}). 어둠이 오기 전에 뭐라도 해야 한다는 초조함이 있어야 한다.' },
    { id: 'starving', when: 'food <= 1 and not dead',
      text: '[상태] 먹을 것이 거의 없다. 배고픔이 판단을 흐리고 말수를 줄인다.' },
    { id: 'night_out', when: "is_night and place != '은신처' and not dead",
      text: '[상태] 밤인데 밖에 있다. 보이는 게 거의 없고 소리에만 의지한다 — 가장 위험한 시간이다.' },
    { id: 'ended', when: 'dead',
      text: '[상태] 이 이야기는 끝났다. 새로 시작하지 말고, 남은 사람들의 시점이나 뒤에 남은 흔적으로 마무리하라.' },
  ],
  updater: {
    model: 'aux',
    allow: [
      { id: 'skip_min', maxGain: 240 },
      { id: 'place' },
      { id: 'hp', maxDelta: 20 },
      { id: 'hope', maxDelta: 15 },
      { id: 'noise', maxDelta: 25 },
      { id: 'food', maxDelta: 4 },
      { id: 'med', maxDelta: 2 },
      { id: 'ammo', maxDelta: 4 },
      { id: 'loot' },
      // 새 사람은 문을 열어 준 턴에만 명단에 오른다 — 아무 때나 열면 스쳐 간 사람까지 동료가 된다
      { id: 'crew', whenArmed: ['nightfall'] },
    ],
    guide: '장면에 실제로 나온 것만 반영하라. 감염(bitten)·방벽·끝남 여부는 시스템이 관리하니 건드리지 마라. '
      + '흐른 시간은 장면 길이에 맞춰라 — 짧은 대화 0~10분, 이동이나 수색은 30~120분. '
      + '밤을 넘기는 것은 버튼이 하니 시간으로 하루를 넘기지 마라. '
      + '조 편성(탐색조·보초)은 플레이어가 정한다 — 바꾸지 마라. 동료 이름은 명단에 있는 것만 써라.',
  },
  promptState: {
    position: 'history_end',
    template: '[생존 현황] {date} {clock} ({tod}) · {place}\n'
      + '체력 {hp} · 감염 {bitten}/5 · 희망 {hope}\n'
      + '식량 {food} · 약품 {med} · 탄약 {ammo} · 방벽 {barricade}\n'
      + '소음 {noise} (오늘 밤 예상 {horde}) · 탐색조 {scout1}/{scout2} · 보초 {guard1}\n'
      + '함께: {crew}',
    includeEvents: true,
  },
  party: {
    label: '편성', icon: '🧟', empty: '없음', roster: 'crew',
    note: '탐색조는 수색 판정을 올리고, 보초는 밤 습격을 받아낸다. 한 사람은 한 자리에만.',
    tabs: [
      { id: 'day', label: '탐색조',
        slots: [{ var: 'scout1', label: '탐색조 1' }, { var: 'scout2', label: '탐색조 2' }],
        actions: ['go_out', 'scavenge', 'go_home'],
        note: '명단에 오른 사람만 넣을 수 있다.' },
      { id: 'night', label: '밤',
        slots: [{ var: 'guard1', label: '보초' }],
        actions: ['fortify', 'nightfall'],
        note: '보초가 있으면 밤에 오는 것을 20만큼 더 받아낸다.' },
    ],
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    layout: 'accordion',
    groups: [
      { label: '지금', items: [
        { var: 'place' }, { var: 'tod' },
        { var: 'noise', bar: { max: 100 }, color: "noise >= 60 ? '#8a3b2e' : (noise >= 30 ? '#8a7340' : '#4a5a4a')" },
        { var: 'horde' },
      ] },
      { label: '몸', items: [
        { var: 'hp', bar: { max: 100 }, color: "hp <= 30 ? '#8a3b3b' : '#5a7a5a'" },
        { var: 'bitten', showWhen: 'bitten >= 1', bar: { max: 5 }, color: "'#7a3b5a'" },
        { var: 'hope', bar: { max: 100 }, color: "hope <= 25 ? '#7a3b2e' : '#5a6a8a'" },
      ] },
      { label: '물자', items: [
        { var: 'food' }, { var: 'med' }, { var: 'ammo' },
        { var: 'barricade', bar: { max: 100 }, color: "barricade <= 20 ? '#8a3b2e' : '#6a6a5a'" },
        { var: 'loot', showWhen: 'count(loot) > 0' },
      ] },
      { label: '사람', items: [
        { var: 'crew' },
        { var: 'scout1', showWhen: "scout1 != '없음'" },
        { var: 'scout2', showWhen: "scout2 != '없음'" },
        { var: 'guard1', showWhen: "guard1 != '없음'" },
      ] },
    ],
    // 형광등 꺼진 복도 — 바랜 초록과 녹
    customCSS: `.sim-status { background:#12150f; border:1px solid #2f3a2a; border-radius:2px; color:#c2c8b8; }
.sim-status summary { color:#8fae6a; letter-spacing:.14em; font-weight:700; }
.sim-group-label { color:#77855f; letter-spacing:.18em; font-size:.78em; }
.sim-label { color:#77855f; opacity:1; }
.sim-value { color:#e6ead9; font-weight:700; }
.sim-badge, .sim-tag { background:#1a1f15; color:#9ab86f; border:1px solid #3a462f; border-radius:2px; }
.sim-bar { background:#0a0c08; height:8px; border:1px solid #2a3323; border-radius:1px; }
.sim-action { border-color:#3a462f; color:#c2c8b8; border-radius:2px; background:#1a1f15; }
.sim-action.sim-armed { border-color:#8fae6a; background:#232b1a; color:#d6e6ae; }
.sim-log { color:#66705a; }`,
  },
  setup: {
    presets: [
      { id: 'day3', label: '사흘째 — 아직 물자가 있다',
        set: {} },
      { id: 'lucky', label: '운이 좋았다 — 창고를 찾았다',
        set: { food: 18, med: 4, ammo: 14, barricade: 80, hope: 75,
          crew: ['정한', '미주', '노경'], scout2: '노경' } },
      { id: 'bitten', label: '이미 물렸다 — 약이 한 대 남았다',
        set: { bitten: 3, hp: 45, food: 3, med: 1, ammo: 1, barricade: 30, hope: 30 } },
    ],
  },
};

// ── 아이돌 프로듀스 ──────────────────────────────────────────
// 셋짜리 유닛을 맡아 스케줄을 굴린다.
//
// 다른 열다섯과 안 겹치는 자리: **달력이 게임 루프의 한가운데 있다.**
// vtuber(1인 방송)는 턴이 곧 하루라 일정이 필요 없었고, romance의 달력은 약속을
// 적어 두는 수첩이었다. 여기서는 **받아 둔 일감에 날짜가 박히고, 그날 무대에 서지
// 않으면 펑크가 난다** — 달력이 읽는 물건이 아니라 눌러야 하는 시계다.
//
// 손댈 자리를 알아보기 쉽게 축을 셋만 뒀다 — 이 셋만 이해하면 개조가 된다:
//   ① 일감(job)     D-day가 박힌다. 그날 🎤를 안 누르고 날을 넘기면 펑크로 남는다.
//   ② 컨디션        체력과 멘탈의 평균. 무대 판정의 보정이고, 스케줄이 이걸 태운다.
//   ③ 자금 ↔ 등급   등급이 큰 일감을 열고, 큰 일감이 자금이고, 자금이 레슨이다.
//
// 멤버 블록(m1_*/m2_*/m3_*)은 일곱 줄이 한 벌로 완전히 똑같다. 넷째를 들이려면
// 일곱 줄을 복사해 m4_로 바꾸고, 슬롯 셋의 enum에 이름을 더하고, 파생 p4를 한 줄
// 만들면 된다 — 유닛 능력치 식(u_vo 등)은 항이 하나씩만 늘어난다. 이름을 바꿀 때는
// 라벨 스물한 줄과 슬롯 enum 셋, 그리고 파생 p1~p3의 문자열이 짝이다.
//
// 레슨은 액션이 아니라 **편성표의 업그레이드 항목(items)**이다 — 자금으로 찍고,
// 비용이 자기 레벨을 보고 오른다. 성장을 액션에서 떼어 놔야 하루가 무대와 사람에게 쓰인다.
//
// zombie와 같은 규율: **패배 조건이 bool 하나(closed)로 명시돼 있다.** 그래야 진단이
// 생존율과 프리셋 난이도를 스스로 잰다. 여기서 판을 끝내는 건 빚이 아니라 사람이다 —
// 멘탈이 0이 된 멤버가 나오면 유닛이 활동을 멈춘다. 무리한 스케줄이 곧 패배다.
//
// v0.82 — 일감이 사다리가 되면서 판정이 열 개로 늘었다. 모양이 완전히 같고 vs만 다르므로
// 표 하나와 찍어 내는 함수 하나로 둔다. **손으로 열 번 복사하면 반드시 한 군데가 어긋나고**,
// 어긋난 판정은 굴러가긴 해서 아무도 모른다 — 밸런스만 조용히 틀어진다.
// 산출물은 평범한 객체라 JSON 내보내기·편집기에서는 손으로 쓴 것과 구별되지 않는다.
const PITCH_TIERS = [
  ['radio', '지역 라디오 영업', 11],
  ['mag', '잡지 화보 영업', 14],
  ['ltv', '지방 방송국 영업', 17],
  ['cable', '케이블 영업', 18],
  ['net', '지상파 영업', 24],
  ['gold', '골든타임 영업', 28],
];
const pitchCheck = (id, label, vs) => ({
  id: `ck_${id}`, label, roll: 'rand(1, 20)', mod: 'pitch_mod', vs,
  grades: [
    { when: 'roll == 20', label: '대어',
      inject: '기대도 안 한 자리에서 더 큰 이야기가 나왔다 — 명함을 건네받는 순간으로 짧게 그려라.',
      effects: [
        { set: 'pitch_won', expr: '2' },
        { set: 'awareness', expr: 'min(awareness + max(1, round((100 - awareness) * 0.03)), 100)' },
      ] },
    { when: 'total >= vs', label: '수주', effects: [{ set: 'pitch_won', expr: '1' }] },
    { label: '헛걸음',
      inject: '명함만 두고 나왔다. 이런 날이 더 많다는 걸 서로 안다.',
      effects: [{ set: 'pitch_won', expr: '0' }, { set: 'buzz', expr: 'max(buzz - 2, 0)' }] },
  ],
});
const SHADY_TIERS = [
  ['night', '심야 행사 설득', 10],
  ['spon', '스폰서 자리 설득', 15],
  ['gravure', '수위 화보 설득', 19],
  ['adult', '성인 영상 설득', 24],
];
const shadyCheck = (id, label, vs) => ({
  id: `ck_${id}`, label, roll: 'rand(1, 20)', mod: 'shady_mod', vs,
  grades: [
    { when: 'total >= vs', label: '받아들였다', effects: [{ set: 'shady_ok', expr: '1' }] },
    { label: '거절했다',
      inject: '아무도 먼저 입을 열지 않았다. 그 침묵이 대답이었다 — 프로듀서가 말을 거두는 장면으로 그려라.',
      effects: [
        { set: 'shady_ok', expr: '0' },
        { set: 'm1_love', expr: 'max(m1_love - 5, 0)' },
        { set: 'm2_love', expr: 'max(m2_love - 5, 0)' },
        { set: 'm3_love', expr: 'max(m3_love - 5, 0)' },
        { set: 'm1_me', expr: 'max(m1_me - 4, 0)' },
        { set: 'm2_me', expr: 'max(m2_me - 4, 0)' },
        { set: 'm3_me', expr: 'max(m3_me - 4, 0)' },
      ] },
  ],
});

const IDOL = {
  simcore: '0.1',
  meta: { name: '아이돌 프로듀스 기록', author: 'SimCore 템플릿' },
  suggest: { count: 3, guide: '남은 날짜와 멤버 컨디션으로 지금 할 수 있는 것. 하나는 사람을 챙기는 쪽으로.' },
  // 시각은 안 쓴다 — 이 판의 단위는 하루다. 날짜와 요일만 있으면 스케줄이 선다.
  time: {
    start: '2026-04-06', advance: 'explicit',
    format: { date: 'M월 D일' },
    calendar: 'gregorian',
  },
  // 달력이 이 템플릿의 중심이다. 고정 일정은 marks가, 손으로 적는 예정은 schedule이,
  // 받아 둔 일감의 D-day는 상태창이 맡는다.
  calendar: {
    label: '스케줄', icon: '📅', list: 'schedule',
    note: '날짜를 눌러 예정을 적어 둘 수 있다. 받아 둔 일감이 며칠 남았는지는 위쪽 상태창에 뜬다.',
    marks: [
      { label: '주간 라디오', weekday: '금', note: '고정 코너가 있는 날.' },
      { label: '월말 정산', dom: 28, note: '빚에 이자가 붙는다.' },
    ],
  },
  vars: [
    // ── 프로덕션 ──
    { id: 'rank', label: '프로덕션 등급', type: 'enum', init: 'F', enum: ['F', 'E', 'D', 'C', 'B', 'A', 'S'],
      desc: '업계가 이 사무소를 어떻게 보는가. 큰 일감을 여는 열쇠다. 인지도에 따라 시스템이 올리니 서사로 바꾸지 마라.' },
    { id: 'awareness', label: '인지도', type: 'int', init: 12, min: 0, max: 100,
      desc: '이름을 아는 사람이 얼마나 되는가. 천천히 오르고 잘 안 내린다.' },
    { id: 'buzz', label: '화제성', type: 'int', init: 20, min: 0, max: 100,
      desc: '지금 이 순간 얼마나 회자되는가. 무대 뒤에 치솟고 며칠이면 가라앉는다.' },
    { id: 'fans', label: '팬 수', type: 'int', init: 800, min: 0, max: 9999999, format: '{v}명' },
    { id: 'sales', label: '음반 판매량', type: 'int', init: 0, min: 0, max: 9999999, format: '{v}장',
      desc: '지금까지 팔린 누계. 수록이나 투어를 잘 마쳤을 때만 늘어난다.' },
    { id: 'funds', label: '운용자금', type: 'int', init: 400, min: 0, max: 9999999, format: '{v}만원' },
    { id: 'debt', label: '빚', type: 'int', init: 1200, min: 0, max: 9999999, format: '{v}만원',
      desc: '월말마다 이자가 붙는다. 자금이 바닥나면 융자로 버틸 수 있지만 이자가 함께 커진다.' },
    // ── 장부 ──
    // 수입만 직접 적고 지출은 잔고 차이로 역산한다. 지출을 하나하나 적으면 반드시 빠지는
    // 데가 생기는데, 실제로 여기 하나 있었다 — **레슨비는 편성표가 자금을 직접 쓰기 때문에
    // 액션 효과로는 잡을 방법이 없다.** 기초 잔고를 기억해 두면 어디로 나갔든 다 걸린다.
    // 수입은 **갈래별로** 적는다 (v0.81). 한 칸이던 시절에는 "이 달에 얼마 벌었나"는 알아도
    // "무엇이 벌어다 줬나"를 몰라서, 라이브를 늘릴지 굿즈를 찍을지 판단할 근거가 없었다.
    // 총합 income은 파생이라 새 갈래를 더해도 장부가 저절로 맞는다 (예전엔 갈래를 늘릴 때마다
    // income에도 같이 적어야 했고, 그게 빠지면 지출이 부풀어 보였다).
    { id: 'inc_stage', label: '무대 보수', type: 'int', init: 0, min: 0, max: 9999999, format: '{v}만원',
      desc: '일감·라이브를 치르고 받은 돈. 월말 정산에 0으로 돌아간다. 시스템이 관리하니 서사로 바꾸지 마라.' },
    { id: 'inc_ticket', label: '티켓 수입', type: 'int', init: 0, min: 0, max: 9999999, format: '{v}만원',
      desc: '라이브 티켓이 팔려 들어온 돈. 시스템이 관리하니 서사로 바꾸지 마라.' },
    { id: 'inc_goods', label: '굿즈 수입', type: 'int', init: 0, min: 0, max: 9999999, format: '{v}만원',
      desc: '공연장에서 굿즈가 팔려 들어온 돈. 시스템이 관리하니 서사로 바꾸지 마라.' },
    { id: 'inc_album', label: '음반 수입', type: 'int', init: 0, min: 0, max: 9999999, format: '{v}만원',
      desc: '음반이 팔려 들어온 돈. 시스템이 관리하니 서사로 바꾸지 마라.' },
    { id: 'month_open', label: '이 달 기초 잔고', type: 'int', init: 400, min: 0, max: 9999999, format: '{v}만원',
      desc: '이 달을 시작할 때의 운용자금. 지출은 이것과 지금 잔고의 차이로 역산한다. '
        + '융자와 상환은 벌거나 쓴 게 아니라 돈의 자리만 옮긴 것이라 여기도 같이 움직여 수지에서 빠진다. 시스템이 관리한다.' },
    // 미납 — 사람이 떠나는 세 번째 길 (v0.82). 빚은 참을 수 있어도 월급은 못 참는다.
    // 한 달은 사정이 있는 것이고 두 달은 사정이 아니다.
    { id: 'unpaid', label: '월급 미납', type: 'int', init: 0, min: 0, max: 12, format: '{v}개월',
      desc: '월급을 연달아 못 준 달 수. 한 번이라도 제대로 주면 0으로 돌아간다. 시스템이 정하니 서사로 바꾸지 마라.' },
    { id: 'settled', label: '정산한 달', type: 'int', init: 0, min: 0, max: 12,
      desc: '월말 정산을 끝낸 달. 같은 달에 두 번 정산되지 않게 잡아 두는 빗장이다. 서사로 바꾸지 마라.' },
    // ⚠ 이름에 over가 들어가야 진단이 이걸 패배 변수로 알아본다 (dead/lost/over/fail/… 중 하나).
    // 뜻이 통하는 한국어 라벨은 따로 달면 되고, 이름만 이 규약을 지키면 생존율과 프리셋
    // 난이도를 진단이 스스로 재 준다 — 미궁 템플릿은 이게 없어서 못 쟀다.
    { id: 'unit_over', label: '활동 중단', type: 'bool', init: false,
      desc: '유닛이 멈췄는지. 시스템이 정하니 서사로 바꾸지 마라.' },
    // ── 일감 ──
    // 축이 둘이다 (v0.81) — 업무와 라이브는 **동시에 하나씩** 들고 있을 수 있다.
    // 한 칸이던 시절에는 "다음 주 라이브 전에 화보를 하나 끼울까" 같은 저울질이 성립하지 않았다.
    //
    // v0.82: 일감이 **사다리**가 됐다. 거리에서 시작해 지역 라디오·지방 방송국·케이블을 거쳐
    // 지상파와 골든타임까지, 자리마다 여는 문턱(인지도·등급)과 영업 성사율이 따로 있다.
    // 전에는 버튼 두 개가 등급을 보고 알아서 자리를 골라 줬는데, 그러면 플레이어가 하는 일이
    // "누른다"밖에 없다. 자리를 **고르게** 만들어야 프로듀서 노릇이 된다.
    { id: 'job', label: '잡힌 업무', type: 'enum', init: '없음',
      enum: ['없음', '거리 홍보', '지역 라디오', '잡지 화보', '지방 방송국', '케이블 음악방송', '지상파 음악방송', '골든타임 특집'],
      desc: '수주해 둔 일. 시스템이 정하니 서사로 바꾸지 마라 — 어떤 현장이었는지는 서사가 그린다.' },
    { id: 'job_days', label: '업무까지', type: 'int', init: 0, min: 0, max: 30, format: '{v}일',
      desc: '업무까지 며칠 남았나. 0이면 오늘이다. 시스템이 관리한다.' },
    // 영업 판정이 남기고 가는 쪽지. 판정은 액션 효과보다 **먼저** 굴러서 "어느 자리를 노렸나"를
    // 알 수 없다 — 그래서 판정은 이겼는지만 적고, 자리를 넣는 건 각 액션의 효과가 한다.
    { id: 'pitch_won', label: '영업 결과', type: 'int', init: 0, min: 0, max: 2,
      desc: '직전 영업 판정의 결과(0 헛걸음·1 수주·2 대어). 시스템이 쓰고 바로 읽는 임시 값이니 서사로 건드리지 마라.' },
    { id: 'shady_ok', label: '설득 결과', type: 'int', init: 0, min: 0, max: 1,
      desc: '직전 음지 설득의 결과(0 거절·1 수락). 시스템이 쓰고 바로 읽는 임시 값이니 서사로 건드리지 마라.' },
    { id: 'live', label: '잡힌 라이브', type: 'enum', init: '없음',
      enum: ['없음', '라이브하우스', '시민회관', '합동 페스티벌', '단독 공연', '전국 투어'],
      desc: '잡아 둔 공연. 시스템이 정하니 서사로 바꾸지 마라.' },
    { id: 'live_days', label: '라이브까지', type: 'int', init: 0, min: 0, max: 60, format: '{v}일',
      desc: '공연일까지 며칠 남았나. 0이면 오늘이다. 시스템이 관리한다.' },
    { id: 'late', label: '펑크', type: 'int', init: 0, min: 0, max: 99,
      desc: '약속한 날 무대에 서지 못한 횟수. 업계에서 신용이 여기서 깎이고, 판정에 그대로 붙는다.' },
    { id: 'schedule', label: '일정', type: 'list', init: [], maxItems: 12, itemMaxLength: 30,
      desc: '달력에 적어 둔 예정. 서사에서 새 일정이 잡히면 "내용 @+N"(N일 뒤)으로 추가하라. 날짜가 지나면 자동으로 지워진다.' },
    // 예약 목록 — 지금 잡힌 것 말고 **그 다음**. 항목은 "내용 @+N"(N일 뒤) 규약이라
    // 달력에 그대로 뜬다. ⚠ 남은 날을 항목에 적으면 안 된다 (끝자리 숫자는 안 변하는 값 전용).
    { id: 'job_queue', label: '다음 업무', type: 'list', init: [], maxItems: 6, itemMaxLength: 30,
      desc: '앞으로 잡힌 업무. 서사에서 새 일이 정해지면 "내용 @+N"(N일 뒤)으로 올려라. 날짜가 지나면 자동으로 지워진다.' },
    { id: 'live_queue', label: '다음 라이브', type: 'list', init: [], maxItems: 6, itemMaxLength: 30,
      desc: '앞으로 잡힌 공연. "내용 @+N"(N일 뒤)으로 올려라. 날짜가 지나면 자동으로 지워진다.' },
    { id: 'songs', label: '보유곡', type: 'list', init: [], maxItems: 20, itemMaxLength: 24,
      desc: '유닛이 가진 곡. 수록을 마치면 곡 이름을 지어 올려라. 곡이 많을수록 라이브가 유리하다.' },
    { id: 'wardrobe', label: '보유 의상', type: 'list', init: [], maxItems: 12, itemMaxLength: 24,
      desc: '맞춰 둔 무대의상. 새로 맞추면 어떤 옷인지 이름을 지어 올려라.' },
    { id: 'costume', label: '착용 의상', type: 'enum', init: '기본 무대의상',
      enum: ['연습복', '기본 무대의상', '제작 의상', '특별 의상', '특주 의상'],
      desc: '무대에 입고 서는 것. 좋을수록 판정이 유리하다. 맞추는 건 자금이 든다.' },
    // ── 제작 의뢰 ── (v0.82)
    // 의상과 음반은 **사서 쓰는 것**이 아니라 **주문해서 만드는 것**이다. 위로 갈수록 비싸고,
    // 돈만으로는 안 되고 이름값이 따라와야 한다 — 무명 유닛에는 좋은 사람이 안 붙는다.
    { id: 'album', label: '낸 음반', type: 'enum', init: '없음', enum: ['없음', '싱글', '미니 앨범', '정규 앨범'],
      desc: '지금까지 낸 것 중 가장 큰 것. 월말마다 인세가 들어온다. 시스템이 정하니 서사로 바꾸지 마라.' },
    // ── 음지 ── (v0.82)
    // 급할 때 손이 가는 쪽. 한 번 담그면 다음이 쉬워지고(문턱이 열리고), 대신 양지의
    // 큰 자리가 닫힌다. 되돌아오는 길은 있지만 느리다 — 하루에 1씩만 빠진다.
    { id: 'corrupt', label: '타락도', type: 'int', init: 0, min: 0, max: 100,
      desc: '음지 일감에 얼마나 발을 담갔는가. 오르면 음지가 더 열리고 지상파·골든타임이 닫힌다. 시스템이 정하니 서사로 바꾸지 마라.' },
    // ── 유닛 자리 ──
    { id: 'center', label: '센터', type: 'enum', init: '유나', enum: ['없음', '유나', '세리', '린'] },
    { id: 'side1', label: '사이드 1', type: 'enum', init: '세리', enum: ['없음', '유나', '세리', '린'] },
    { id: 'side2', label: '사이드 2', type: 'enum', init: '린', enum: ['없음', '유나', '세리', '린'] },
    // ── 멤버 ① 유나 ── (일곱 줄이 한 벌. 넷째를 들이려면 이 일곱 줄을 m4_로 복사한다)
    { id: 'm1_vo', label: '유나 · 보컬', type: 'int', init: 34, min: 0, max: 100 },
    { id: 'm1_da', label: '유나 · 댄스', type: 'int', init: 20, min: 0, max: 100 },
    { id: 'm1_vi', label: '유나 · 비주얼', type: 'int', init: 26, min: 0, max: 100 },
    { id: 'm1_st', label: '유나 · 체력', type: 'int', init: 70, min: 0, max: 100 },
    { id: 'm1_me', label: '유나 · 멘탈', type: 'int', init: 62, min: 0, max: 100,
      desc: '0이 되면 더 못 선다. 무대가 깎고, 쉬거나 이야기를 나누면 돌아온다.' },
    { id: 'm1_love', label: '유나 · 호감도', type: 'int', init: 30, min: 0, max: 100,
      desc: '프로듀서를 얼마나 믿는가. 높으면 힘든 날에도 버텨 준다.' },
    { id: 'm1_fan', label: '유나 · 개별 인기', type: 'int', init: 300, min: 0, max: 9999999, format: '{v}명' },
    // ── 멤버 ② 세리 ──
    { id: 'm2_vo', label: '세리 · 보컬', type: 'int', init: 18, min: 0, max: 100 },
    { id: 'm2_da', label: '세리 · 댄스', type: 'int', init: 38, min: 0, max: 100 },
    { id: 'm2_vi', label: '세리 · 비주얼', type: 'int', init: 24, min: 0, max: 100 },
    { id: 'm2_st', label: '세리 · 체력', type: 'int', init: 78, min: 0, max: 100 },
    { id: 'm2_me', label: '세리 · 멘탈', type: 'int', init: 55, min: 0, max: 100,
      desc: '0이 되면 더 못 선다. 무대가 깎고, 쉬거나 이야기를 나누면 돌아온다.' },
    { id: 'm2_love', label: '세리 · 호감도', type: 'int', init: 22, min: 0, max: 100,
      desc: '프로듀서를 얼마나 믿는가. 높으면 힘든 날에도 버텨 준다.' },
    { id: 'm2_fan', label: '세리 · 개별 인기', type: 'int', init: 260, min: 0, max: 9999999, format: '{v}명' },
    // ── 멤버 ③ 린 ──
    { id: 'm3_vo', label: '린 · 보컬', type: 'int', init: 22, min: 0, max: 100 },
    { id: 'm3_da', label: '린 · 댄스', type: 'int', init: 19, min: 0, max: 100 },
    { id: 'm3_vi', label: '린 · 비주얼', type: 'int', init: 41, min: 0, max: 100 },
    { id: 'm3_st', label: '린 · 체력', type: 'int', init: 62, min: 0, max: 100 },
    { id: 'm3_me', label: '린 · 멘탈', type: 'int', init: 48, min: 0, max: 100,
      desc: '0이 되면 더 못 선다. 무대가 깎고, 쉬거나 이야기를 나누면 돌아온다.' },
    { id: 'm3_love', label: '린 · 호감도', type: 'int', init: 16, min: 0, max: 100,
      desc: '프로듀서를 얼마나 믿는가. 높으면 힘든 날에도 버텨 준다.' },
    { id: 'm3_fan', label: '린 · 개별 인기', type: 'int', init: 420, min: 0, max: 9999999, format: '{v}명' },
    // ── 진행 ──
    // 하루를 넘기는 입구는 🌙 하나뿐이다 (updater allow에도 없다) — 시계 입구가 둘이면
    // 하루가 두 번 흐른다. 좀비 템플릿에서 같은 규율을 썼다.
    { id: 'skip_day', label: '건너뛴 일수', type: 'int', init: 0, min: 0, max: 30,
      desc: '며칠 통째로 지났나. 같은 날 안이면 0. 날을 넘기는 것은 🌙 버튼이 하니 서사로 날짜를 넘기지 마라.' },
  ],
  derived: [
    // 자리 배수 — 멤버마다 한 줄. 슬롯 쪽에서 사람을 찾으면 3×3 항이 되지만,
    // 사람 쪽에서 자리를 찾으면 한 줄로 끝난다. 넷째 멤버는 여기 p4 한 줄만 붙는다
    { id: 'p1', label: '유나 자리', expr: "center == '유나' ? 1.3 : ((side1 == '유나' or side2 == '유나') ? 1 : 0)" },
    { id: 'p2', label: '세리 자리', expr: "center == '세리' ? 1.3 : ((side1 == '세리' or side2 == '세리') ? 1 : 0)" },
    { id: 'p3', label: '린 자리', expr: "center == '린' ? 1.3 : ((side1 == '린' or side2 == '린') ? 1 : 0)" },
    { id: 'stand', label: '무대 인원', expr: '(p1 > 0 ? 1 : 0) + (p2 > 0 ? 1 : 0) + (p3 > 0 ? 1 : 0)' },
    // 유닛 능력치 — 센터가 1.3배로 실린다. 누구를 가운데 세우느냐가 곧 편성이다
    { id: 'u_vo', label: '유닛 보컬', expr: 'round(m1_vo * p1 + m2_vo * p2 + m3_vo * p3)' },
    { id: 'u_da', label: '유닛 댄스', expr: 'round(m1_da * p1 + m2_da * p2 + m3_da * p3)' },
    { id: 'u_vi', label: '유닛 비주얼', expr: 'round(m1_vi * p1 + m2_vi * p2 + m3_vi * p3)' },
    // 컨디션 = 몸과 마음의 평균. 개별로 보이고, 무대에는 선 사람들의 것만 실린다
    { id: 'c1', label: '유나 컨디션', expr: 'round((m1_st + m1_me) / 2)' },
    { id: 'c2', label: '세리 컨디션', expr: 'round((m2_st + m2_me) / 2)' },
    { id: 'c3', label: '린 컨디션', expr: 'round((m3_st + m3_me) / 2)' },
    { id: 'u_cond', label: '유닛 컨디션',
      expr: 'stand > 0 ? round((c1 * p1 + c2 * p2 + c3 * p3) / (p1 + p2 + p3)) : 0' },
    // 유닛 지표 — 프로덕션(사무소)의 이름값과 별개로 **이 유닛이 얼마나 컸는가**.
    // 인기도는 소속 전원의 개별 인기 합이다 (무대에 안 선 멤버의 팬도 유닛의 팬이다).
    { id: 'u_fan', label: '유닛 인기도', expr: 'm1_fan + m2_fan + m3_fan' },
    { id: 'u_pow', label: '유닛 종합', expr: 'u_vo + u_da + u_vi' },
    // ⚠ 문턱은 **합계** 기준이다. u_pow는 셋의 능력치를 자리 배수로 더한 값이라 만점이 990
    //   (센터 1.3 + 사이드 1 + 사이드 1) × 100 × 세 항. 처음 이 줄을 260/200/150으로 썼을 때는
    //   한 사람 기준으로 잡은 숫자였고, 그래서 **시작하자마자 S등급**이 떴다(시작 u_pow 266).
    //   랭크가 첫 턴에 천장이면 성장이 화면에 안 보인다. 만점 대비 비율로 다시 잡았다.
    { id: 'u_rank', label: '유닛 랭크',
      expr: "u_pow >= 800 ? 'S' : (u_pow >= 620 ? 'A' : (u_pow >= 450 ? 'B' : (u_pow >= 300 ? 'C' : (u_pow >= 180 ? 'D' : 'E'))))" },
    { id: 'rank_n', label: '등급 수치',
      expr: "rank == 'S' ? 6 : (rank == 'A' ? 5 : (rank == 'B' ? 4 : (rank == 'C' ? 3 : (rank == 'D' ? 2 : (rank == 'E' ? 1 : 0)))))" },
    { id: 'dress', label: '의상 보정',
      expr: "costume == '특주 의상' ? 8 : (costume == '특별 의상' ? 5"
        + " : (costume == '제작 의상' ? 3 : (costume == '기본 무대의상' ? 0 : -4)))" },
    { id: 'album_n', label: '음반 급수',
      expr: "album == '정규 앨범' ? 3 : (album == '미니 앨범' ? 2 : (album == '싱글' ? 1 : 0))" },
    // 일감표는 이 두 줄이 전부다 — 새 일감을 넣으려면 enum과 여기 두 줄에만 더하면 된다
    { id: 'job_vs', label: '업무 난이도',
      expr: "job == '골든타임 특집' ? 26 : (job == '지상파 음악방송' ? 22 : (job == '케이블 음악방송' ? 19"
        + " : (job == '지방 방송국' ? 16 : (job == '잡지 화보' ? 13 : (job == '지역 라디오' ? 12 : (job == '거리 홍보' ? 10 : 0))))))" },
    { id: 'job_pay', label: '업무 보수',
      expr: "job == '골든타임 특집' ? 2600 : (job == '지상파 음악방송' ? 1500 : (job == '케이블 음악방송' ? 900"
        + " : (job == '지방 방송국' ? 560 : (job == '잡지 화보' ? 300 : (job == '지역 라디오' ? 200 : (job == '거리 홍보' ? 120 : 0))))))" },
    // 라이브표 — 업무와 같은 모양의 두 줄 + 정원. 새 공연을 넣으려면 enum과 여기 세 줄에만 더한다
    { id: 'live_vs', label: '라이브 난이도',
      expr: "live == '전국 투어' ? 27 : (live == '단독 공연' ? 23 : (live == '합동 페스티벌' ? 19"
        + " : (live == '시민회관' ? 15 : (live == '라이브하우스' ? 12 : 0))))" },
    { id: 'live_pay', label: '라이브 개런티',
      expr: "live == '전국 투어' ? 2400 : (live == '단독 공연' ? 1400 : (live == '합동 페스티벌' ? 800"
        + " : (live == '시민회관' ? 420 : (live == '라이브하우스' ? 260 : 0))))" },
    { id: 'live_cap', label: '공연장 정원',
      expr: "live == '전국 투어' ? 9000 : (live == '단독 공연' ? 3000 : (live == '합동 페스티벌' ? 1500"
        + " : (live == '시민회관' ? 600 : (live == '라이브하우스' ? 200 : 0))))", format: '{v}석' },
    // 팔릴 표 — 정원이 천장이다. 팬이 많아도 작은 데서 하면 그만큼만 팔린다(= 큰 자리를 노릴 이유).
    // 거꾸로, 정원이 예상 티켓보다 훨씬 크면 대관료만 날리는 빈 객석이 된다(= 무리하지 말 이유).
    { id: 'live_tickets', label: '예상 티켓',
      expr: 'live_cap > 0 ? min(live_cap, round(fans * 0.3 + buzz * 12 + u_fan / 30)) : 0', format: '{v}장' },
    { id: 'live_fill', label: '예상 객석',
      expr: 'live_cap > 0 ? round(live_tickets * 100 / live_cap) : 0', format: '{v}%' },
    // ── 영업 성사율 ── (v0.82)
    // 판정을 굴리기 전에 **확률이 보여야** 저울질이 된다. 20면 주사위라 눈 하나가 5%p고,
    // 대성공(20)이 늘 있으니 바닥은 5%, 천장은 100%다. 자리마다 vs만 다르고 식은 같다 —
    // pitch_mod 한 줄이 여섯 자리의 공통 분모다(고칠 데가 하나여야 어긋나지 않는다).
    // ⚠ 상한 20 — 캡이 없으면 인지도 90쯤부터 여섯 자리가 전부 100%가 되어 판정이 장식이 된다.
    //   펑크는 캡 **밖에서** 깎는다: 신용은 아무리 커져도 계속 아파야 한다.
    { id: 'pitch_mod', label: '영업 보정', expr: 'min(20, round(awareness / 7) + round(buzz / 8) + rank_n) - late * 2' },
    { id: 'od_radio', label: '지역 라디오 성사율', expr: 'min(100, max(5, (21 - 11 + pitch_mod) * 5))', format: '{v}%' },
    { id: 'od_mag', label: '잡지 화보 성사율', expr: 'min(100, max(5, (21 - 14 + pitch_mod) * 5))', format: '{v}%' },
    { id: 'od_ltv', label: '지방 방송국 성사율', expr: 'min(100, max(5, (21 - 17 + pitch_mod) * 5))', format: '{v}%' },
    { id: 'od_cable', label: '케이블 성사율', expr: 'min(100, max(5, (21 - 18 + pitch_mod) * 5))', format: '{v}%' },
    { id: 'od_net', label: '지상파 성사율', expr: 'min(100, max(5, (21 - 24 + pitch_mod) * 5))', format: '{v}%' },
    { id: 'od_gold', label: '골든타임 성사율', expr: 'min(100, max(5, (21 - 28 + pitch_mod) * 5))', format: '{v}%' },
    // 음지 수락률 — 셋이 받아들이느냐다. 타락도가 오를수록 쉬워지고(그게 이 길의 무서운 점),
    // 호감이 높아도 쉬워진다(믿으니까 따라온다). 여기에 "거절"의 뜻이 그대로 들어 있다.
    { id: 'u_love', label: '평균 호감', expr: 'round((m1_love + m2_love + m3_love) / 3)' },
    { id: 'shady_mod', label: '설득 보정', expr: 'min(20, round(corrupt / 5) + round(u_love / 9) + (funds < 100 ? 3 : 0))' },
    { id: 'od_night', label: '심야 행사 수락률', expr: 'min(100, max(5, (21 - 10 + shady_mod) * 5))', format: '{v}%' },
    { id: 'od_spon', label: '스폰서 자리 수락률', expr: 'min(100, max(5, (21 - 15 + shady_mod) * 5))', format: '{v}%' },
    { id: 'od_gravure', label: '수위 화보 수락률', expr: 'min(100, max(5, (21 - 19 + shady_mod) * 5))', format: '{v}%' },
    { id: 'od_adult', label: '성인 영상 수락률', expr: 'min(100, max(5, (21 - 24 + shady_mod) * 5))', format: '{v}%' },
    // 장부 두 줄 — 수지는 잔고 차이고, 지출은 "번 것 중 안 남은 것"이다.
    // 이렇게 두면 레슨비처럼 편성표에서 바로 나가는 돈도 자동으로 지출에 들어온다
    // 총합은 파생이다 — 갈래를 늘려도 여기 한 줄만 항이 붙고 장부가 저절로 맞는다
    { id: 'income', label: '이번 달 수입', expr: 'inc_stage + inc_ticket + inc_goods + inc_album' },
    // 월급은 등급이 오르면 같이 오른다 — 커진 유닛은 유지비도 커야 자금 압박이 안 사라진다.
    // ⚠ 배수 90은 진단으로 고른 값이다: 45면 "아무것도 안 해도 전부 생존"(긴장 없음),
    //   140이면 "액션을 쓸수록 더 빨리 죽는다"(플레이가 손해). 90에서만 파산이 살아나고
    //   난이도 지적이 사라진다. 이 판의 압박은 이자가 아니라 **사람 유지비**에서 나온다.
    { id: 'salary', label: '멤버 월급', expr: '(rank_n + 3) * 60' },
    // 사무소 임대료 (v0.82) — 월말에 한 번 나가는 고정비. 하루 유지비(🌙의 25만원)만으로는
    // **날을 안 넘기는 판**에 아무 압박이 없었다: 진단이 "아무것도 안 해도 전부 생존"이라고
    // 신고한 게 이 구멍이다. 달마다 오는 청구서는 손을 놓고 있어도 온다.
    { id: 'rent', label: '사무소 임대료', expr: '100 + rank_n * 30' },
    { id: 'balance', label: '이번 달 수지', expr: 'funds - month_open' },
    { id: 'spend', label: '이번 달 지출', expr: 'max(income - balance, 0)' },
    // 랭킹은 낮을수록 위다. 인지도가 크게, 팬 수와 화제성이 거들어 밀어 올린다
    { id: 'ranking', label: '아이돌 랭킹',
      expr: 'max(1, 300 - round(awareness * 1.6) - round(fans / 400) - round(buzz * 0.6))' },
  ],
  checks: [
    // 무대 판정 — 능력치·의상·컨디션·신용이 전부 여기로 모인다.
    // 컨디션은 60을 기준으로 갈린다: 잘 쉬면 보정이 붙고 무리하면 깎인다.
    { id: 'ck_stage', label: '무대 판정',
      roll: 'rand(1, 20)',
      mod: 'round((u_vo + u_da + u_vi) / 30) + dress + round((u_cond - 60) / 12) - late',
      vs: 'job_vs',
      grades: [
        { when: 'roll == 20', label: '전설의 무대',
          inject: '그 자리에 있던 사람 전부가 오래 기억할 무대가 되었다 — 객석의 공기가 바뀌는 순간으로 그려라.',
          effects: [
            { set: 'buzz', expr: 'min(buzz + 35, 100)' },
            { set: 'awareness', expr: 'min(awareness + max(2, round((100 - awareness) * 0.08)), 100)' },
            { set: 'fans', expr: 'min(fans + round(job_pay * 3), 9999999)' },
            { set: 'funds', expr: 'min(funds + round(job_pay * 1.6), 9999999)' },
            { set: 'inc_stage', expr: 'min(inc_stage + round(job_pay * 1.6), 9999999)' },
            { set: 'm1_fan', expr: 'min(m1_fan + round(job_pay * p1 * 1.2), 9999999)' },
            { set: 'm2_fan', expr: 'min(m2_fan + round(job_pay * p2 * 1.2), 9999999)' },
            { set: 'm3_fan', expr: 'min(m3_fan + round(job_pay * p3 * 1.2), 9999999)' },
            { set: 'm1_me', expr: 'min(m1_me + round(p1 * 10), 100)' },
            { set: 'm2_me', expr: 'min(m2_me + round(p2 * 10), 100)' },
            { set: 'm3_me', expr: 'min(m3_me + round(p3 * 10), 100)' },
            // 음반은 낸 게 있어야 팔린다 — 무대가 잘되면 그날 판이 밀린다(없으면 밀 게 없다)
            { set: 'sales', expr: 'min(sales + round(fans * album_n * 0.12), 9999999)' },
            // ⚠ 장부에만 적고 자금에 안 넣으면 유령 지출이 된다 (지출 = 수입 − 잔고차이).
            // 실제로 한 번 밟았다 — 음반 수입 32만원이 그대로 "쓴 돈"으로 잡혔다.
            { set: 'inc_album', expr: 'min(inc_album + round(fans * album_n * 0.06), 9999999)' },
            { set: 'funds', expr: 'min(funds + round(fans * album_n * 0.06), 9999999)' },
            { set: 'job', expr: "'없음'" },
            { set: 'job_days', expr: '0' },
          ] },
        { when: 'roll == 1', label: '사고',
          inject: '무대 위에서 무언가 어긋났다 — 음이 밀렸든 발이 걸렸든, 그 순간이 길게 느껴지는 장면으로 그려라.',
          effects: [
            { set: 'buzz', expr: 'min(buzz + 8, 100)' },
            { set: 'funds', expr: 'min(funds + round(job_pay * 0.3), 9999999)' },
            { set: 'inc_stage', expr: 'min(inc_stage + round(job_pay * 0.3), 9999999)' },
            { set: 'm1_me', expr: 'max(m1_me - round(p1 * 14), 0)' },
            { set: 'm2_me', expr: 'max(m2_me - round(p2 * 14), 0)' },
            { set: 'm3_me', expr: 'max(m3_me - round(p3 * 14), 0)' },
            { set: 'm1_love', expr: 'max(m1_love - 3, 0)' },
            { set: 'm2_love', expr: 'max(m2_love - 3, 0)' },
            { set: 'm3_love', expr: 'max(m3_love - 3, 0)' },
            { set: 'job', expr: "'없음'" },
            { set: 'job_days', expr: '0' },
          ] },
        { when: 'total >= vs', label: '성공',
          effects: [
            { set: 'buzz', expr: 'min(buzz + 18, 100)' },
            { set: 'awareness', expr: 'min(awareness + max(1, round((100 - awareness) * 0.03)), 100)' },
            { set: 'fans', expr: 'min(fans + job_pay, 9999999)' },
            { set: 'funds', expr: 'min(funds + job_pay, 9999999)' },
            { set: 'inc_stage', expr: 'min(inc_stage + job_pay, 9999999)' },
            { set: 'm1_fan', expr: 'min(m1_fan + round(job_pay * p1 * 0.4), 9999999)' },
            { set: 'm2_fan', expr: 'min(m2_fan + round(job_pay * p2 * 0.4), 9999999)' },
            { set: 'm3_fan', expr: 'min(m3_fan + round(job_pay * p3 * 0.4), 9999999)' },
            { set: 'm1_me', expr: 'min(m1_me + round(p1 * 4), 100)' },
            { set: 'm2_me', expr: 'min(m2_me + round(p2 * 4), 100)' },
            { set: 'm3_me', expr: 'min(m3_me + round(p3 * 4), 100)' },
            { set: 'sales', expr: 'min(sales + round(fans * album_n * 0.06), 9999999)' },
            // ⚠ 장부에만 적고 자금에 안 넣으면 유령 지출이 된다 (지출 = 수입 − 잔고차이).
            // 실제로 한 번 밟았다 — 음반 수입 32만원이 그대로 "쓴 돈"으로 잡혔다.
            { set: 'inc_album', expr: 'min(inc_album + round(fans * album_n * 0.03), 9999999)' },
            { set: 'funds', expr: 'min(funds + round(fans * album_n * 0.03), 9999999)' },
            { set: 'job', expr: "'없음'" },
            { set: 'job_days', expr: '0' },
          ] },
        { label: '아쉬움',
          inject: '나쁘지 않았지만 아무도 오래 이야기하지 않을 무대였다.',
          effects: [
            { set: 'buzz', expr: 'min(buzz + 4, 100)' },
            { set: 'funds', expr: 'min(funds + round(job_pay * 0.6), 9999999)' },
            { set: 'inc_stage', expr: 'min(inc_stage + round(job_pay * 0.6), 9999999)' },
            { set: 'm1_me', expr: 'max(m1_me - round(p1 * 6), 0)' },
            { set: 'm2_me', expr: 'max(m2_me - round(p2 * 6), 0)' },
            { set: 'm3_me', expr: 'max(m3_me - round(p3 * 6), 0)' },
            { set: 'job', expr: "'없음'" },
            { set: 'job_days', expr: '0' },
          ] },
      ] },
    // 영업 판정 — 큰 자리는 굽신거려서 얻는다. 펑크가 여기에 그대로 붙는다
    // 라이브 판정 — 무대 판정과 같은 축에 **곡 수**가 하나 더 붙는다.
    // 티켓과 굿즈가 여기서만 들어오므로, 라이브를 안 하면 수입이 개런티뿐이다.
    { id: 'ck_live', label: '라이브 판정',
      roll: 'rand(1, 20)',
      mod: 'round((u_vo + u_da + u_vi) / 30) + dress + round((u_cond - 60) / 12) + count(songs) - late',
      vs: 'live_vs',
      grades: [
        { when: 'total >= vs + 6', label: '만석',
          inject: '표가 남지 않았다. 앙코르가 끝나고도 사람들이 자리를 안 떴다 — 객석의 열기로 그려라.',
          effects: [
            { set: 'inc_stage', expr: 'min(inc_stage + live_pay, 9999999)' },
            { set: 'inc_ticket', expr: 'min(inc_ticket + round(live_tickets * 0.8), 9999999)' },
            { set: 'inc_goods', expr: 'min(inc_goods + round(live_tickets * 0.35), 9999999)' },
            { set: 'funds', expr: 'min(funds + live_pay + round(live_tickets * 1.15), 9999999)' },
            { set: 'fans', expr: 'min(fans + round(live_tickets * 0.5), 9999999)' },
            { set: 'buzz', expr: 'min(buzz + 24, 100)' },
            { set: 'awareness', expr: 'min(awareness + max(1, round((100 - awareness) * 0.05)), 100)' },
            { set: 'm1_st', expr: 'max(m1_st - round(p1 * 16), 0)' },
            { set: 'm2_st', expr: 'max(m2_st - round(p2 * 16), 0)' },
            { set: 'm3_st', expr: 'max(m3_st - round(p3 * 16), 0)' },
            { set: 'm1_me', expr: 'min(m1_me + round(p1 * 8), 100)' },
            { set: 'm2_me', expr: 'min(m2_me + round(p2 * 8), 100)' },
            { set: 'm3_me', expr: 'min(m3_me + round(p3 * 8), 100)' },
            { set: 'live', expr: "'없음'" },
          ] },
        { when: 'total >= vs', label: '성공',
          inject: '무대는 끝났고 사람들은 만족해서 돌아갔다.',
          effects: [
            { set: 'inc_stage', expr: 'min(inc_stage + live_pay, 9999999)' },
            { set: 'inc_ticket', expr: 'min(inc_ticket + round(live_tickets * 0.5), 9999999)' },
            { set: 'inc_goods', expr: 'min(inc_goods + round(live_tickets * 0.18), 9999999)' },
            { set: 'funds', expr: 'min(funds + live_pay + round(live_tickets * 0.68), 9999999)' },
            { set: 'fans', expr: 'min(fans + round(live_tickets * 0.25), 9999999)' },
            { set: 'buzz', expr: 'min(buzz + 12, 100)' },
            { set: 'm1_st', expr: 'max(m1_st - round(p1 * 18), 0)' },
            { set: 'm2_st', expr: 'max(m2_st - round(p2 * 18), 0)' },
            { set: 'm3_st', expr: 'max(m3_st - round(p3 * 18), 0)' },
            { set: 'live', expr: "'없음'" },
          ] },
        { label: '빈 객석',
          inject: '비어 있는 자리가 무대에서도 보였다. 끝까지 해냈지만 모두가 그걸 알았다.',
          effects: [
            { set: 'inc_stage', expr: 'min(inc_stage + round(live_pay * 0.4), 9999999)' },
            { set: 'inc_ticket', expr: 'min(inc_ticket + round(live_tickets * 0.15), 9999999)' },
            { set: 'funds', expr: 'min(funds + round(live_pay * 0.4) + round(live_tickets * 0.2), 9999999)' },
            { set: 'buzz', expr: 'max(buzz - 8, 0)' },
            { set: 'm1_me', expr: 'max(m1_me - round(p1 * 12), 0)' },
            { set: 'm2_me', expr: 'max(m2_me - round(p2 * 12), 0)' },
            { set: 'm3_me', expr: 'max(m3_me - round(p3 * 12), 0)' },
            { set: 'm1_st', expr: 'max(m1_st - round(p1 * 14), 0)' },
            { set: 'm2_st', expr: 'max(m2_st - round(p2 * 14), 0)' },
            { set: 'm3_st', expr: 'max(m3_st - round(p3 * 14), 0)' },
            { set: 'live', expr: "'없음'" },
          ] },
      ] },
    // ── 영업 판정 여섯 ── (v0.82)
    // ⚠ 왜 하나가 아니라 여섯인가: 엔진은 **판정을 액션 효과보다 먼저** 굴린다. 그래서 판정은
    // "어느 자리를 노렸는가"를 알 수 없다 — vs를 자리에 맞춰 바꿀 방법이 없다는 뜻이다.
    // 대신 판정은 이겼는지만 pitch_won에 적고, **자리를 job에 넣는 건 각 액션의 효과**가 한다.
    // 모양이 똑같아서 표로 찍어 낸다 (아래 pitchCheck). 새 자리를 늘릴 때 손댈 곳은
    // ① job enum ② job_vs/job_pay 두 줄 ③ 성사율 파생 한 줄 ④ 이 표 한 줄 ⑤ 액션 하나다.
    ...PITCH_TIERS.map(([id, label, vs]) => pitchCheck(id, label, vs)),
    // ── 음지 수락 판정 넷 ── (v0.82)
    // 이건 "일이 잡히느냐"가 아니라 **셋이 받아들이느냐**다. 그래서 실패가 헛걸음이 아니라
    // 거절이고, 거절은 호감을 깎는다 — 물어본 것 자체가 남는다.
    // 영업과 같은 이유로 자리마다 하나씩이다 (판정이 액션보다 먼저 굴러서 vs를 못 고른다).
    ...SHADY_TIERS.map(([id, label, vs]) => shadyCheck(id, label, vs)),
  ],
  actions: [
    // ── 일감 사다리 ── (v0.82)
    // 자리마다 버튼 하나다. 못 여는 자리도 편성표에는 **잠긴 채로 보인다** — 무엇이 다음
    // 목표인지가 화면에 있어야 성장이 성장으로 느껴진다. 여는 조건은 인지도와 등급이고,
    // 영업비는 위로 갈수록 비싸다(헛걸음이면 그 돈만 날린다 = 성사율을 볼 이유).
    //
    // 각 액션의 job 배정식이 같은 모양인 이유: 판정이 먼저 굴러 pitch_won만 남기므로
    // **자리 이름을 아는 건 액션뿐**이다. 대어(2)면 한 칸 위를 물고 온다.
    //
    // ⚠ 여는 축은 **인지도 하나**다. 등급(rank)은 인지도가 문턱을 넘을 때 따라 오르는
    // 값이라, `rank_n >= 4`를 같이 걸면 같은 말을 두 번 하는 것이다. 게다가 진단은
    // 인지도가 보조 AI 담당인 건 알아도 등급이 그 얼굴인 건 몰라서 "못 쓰는 액션"으로
    // 오해한다 — 조건을 겹쳐 걸면 있지도 않은 결함이 세 건 생긴다.
    //
    // ⚠ 거리 홍보만 판정이 없다 — 교착 방지의 바닥이다. 자금 0에 일감도 없으면 판이 죽는데,
    // 미궁 템플릿에서 실제로 밟았던 구멍이라 여기도 조건 없이 잡히는 일을 하나 남겨 뒀다.
    { id: 'take_street', label: '📋 거리에서 뛴다', mode: 'oneshot',
      when: "job == '없음' and not unit_over",
      inject: '[행동] 전단을 들고 사람 많은 데로 나간다. 돈은 안 되지만 거절당할 일도 없다.',
      effects: [
        { set: 'job', expr: "'거리 홍보'" },
        { set: 'job_days', expr: '1 + rand(0, 1)' },
      ] },
    { id: 'take_radio', label: '📻 지역 라디오에 넣는다', mode: 'oneshot',
      when: "job == '없음' and awareness >= 8 and funds >= 10 and not unit_over", check: 'ck_radio',
      inject: '[행동] 동네 방송국에 전화를 건다. 담당자 이름은 이미 외우고 있다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 10, 0)' },
        { set: 'job', expr: "pitch_won >= 2 ? '잡지 화보' : (pitch_won >= 1 ? '지역 라디오' : job)" },
        { set: 'job_days', expr: 'pitch_won >= 1 ? 2 + rand(0, 2) : job_days' },
      ] },
    { id: 'take_mag', label: '📖 잡지사를 돈다', mode: 'oneshot',
      when: "job == '없음' and awareness >= 18 and funds >= 20 and not unit_over", check: 'ck_mag',
      inject: '[행동] 편집부 문 앞에서 기다린다. 지면 한 쪽이 걸린 자리다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 20, 0)' },
        { set: 'job', expr: "pitch_won >= 2 ? '지방 방송국' : (pitch_won >= 1 ? '잡지 화보' : job)" },
        { set: 'job_days', expr: 'pitch_won >= 1 ? 3 + rand(0, 2) : job_days' },
      ] },
    { id: 'take_ltv', label: '📡 지방 방송국을 노린다', mode: 'oneshot', cooldown: 2,
      when: "job == '없음' and awareness >= 32 and funds >= 40 and not unit_over", check: 'ck_ltv',
      inject: '[행동] 기차를 타고 지방 방송국을 돈다. 이쪽에서 먼저 고개를 숙여야 하는 자리다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 40, 0)' },
        { set: 'job', expr: "pitch_won >= 2 ? '케이블 음악방송' : (pitch_won >= 1 ? '지방 방송국' : job)" },
        { set: 'job_days', expr: 'pitch_won >= 1 ? 4 + rand(0, 3) : job_days' },
      ] },
    { id: 'take_cable', label: '📺 케이블 음악방송을 노린다', mode: 'oneshot', cooldown: 2,
      when: "job == '없음' and awareness >= 46 and funds >= 70 and not unit_over", check: 'ck_cable',
      inject: '[행동] 편성 담당과 마주 앉는다. 자리는 하나고 기다리는 유닛은 여럿이다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 70, 0)' },
        { set: 'job', expr: "pitch_won >= 2 ? '지상파 음악방송' : (pitch_won >= 1 ? '케이블 음악방송' : job)" },
        { set: 'job_days', expr: 'pitch_won >= 1 ? 5 + rand(0, 3) : job_days' },
      ] },
    // ⚠ 위 두 자리는 타락도가 문을 닫는다 — 음지로 간 유닛은 지상파가 안 받는다.
    // 이게 이 판의 갈림길이다: 음지는 오늘의 돈을, 지상파는 내일의 이름을 준다.
    { id: 'take_net', label: '🏙 지상파 음악방송을 노린다', mode: 'oneshot', cooldown: 3,
      when: "job == '없음' and awareness >= 62 and corrupt <= 45 and funds >= 120 and not unit_over",
      check: 'ck_net',
      inject: '[행동] 본사 로비에서 한참을 기다린다. 여기까지 온 것만으로도 몇 년이 걸렸다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 120, 0)' },
        { set: 'job', expr: "pitch_won >= 2 ? '골든타임 특집' : (pitch_won >= 1 ? '지상파 음악방송' : job)" },
        { set: 'job_days', expr: 'pitch_won >= 1 ? 6 + rand(0, 4) : job_days' },
      ] },
    { id: 'take_gold', label: '🌟 골든타임 특집을 노린다', mode: 'oneshot', cooldown: 4,
      when: "job == '없음' and awareness >= 80 and corrupt <= 25 and funds >= 200 and not unit_over",
      check: 'ck_gold',
      inject: '[행동] 국장실까지 올라간다. 이 자리는 실력만으로 오는 게 아니라는 걸 서로 안다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 200, 0)' },
        { set: 'job', expr: "pitch_won >= 1 ? '골든타임 특집' : job" },
        { set: 'job_days', expr: 'pitch_won >= 1 ? 8 + rand(0, 5) : job_days' },
      ] },
    // ── 대관 ── (v0.82)
    // 공연장은 **빌리는 것**이라 판정이 없다 — 돈만 있으면 잡힌다. 대신 정원이 천장이고
    // 대관료가 선불이라, 못 채우면 그대로 손해다. "잡을 수 있는가"와 "채울 수 있는가"가
    // 다른 질문이라는 것이 이 축의 전부다 (일감 탭의 예상 객석이 그 답이다).
    { id: 'hall_small', label: '🎪 라이브하우스를 빌린다', mode: 'oneshot', cooldown: 4,
      when: "live == '없음' and funds >= 60 and not unit_over",
      inject: '[행동] 지하 라이브하우스와 날을 잡는다. 백 명이 차면 꽉 찬 것처럼 보이는 곳이다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 60, 0)' },
        { set: 'live', expr: "'라이브하우스'" }, { set: 'live_days', expr: '5 + rand(0, 4)' },
      ] },
    { id: 'hall_civic', label: '🏛 시민회관을 빌린다', mode: 'oneshot',
      when: "live == '없음' and fans >= 3000 and funds >= 150 and not unit_over",
      inject: '[행동] 시민회관 대관 신청서를 낸다. 무대가 넓어서 셋이 서면 허전할 수도 있다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 150, 0)' },
        { set: 'live', expr: "'시민회관'" }, { set: 'live_days', expr: '7 + rand(0, 5)' },
      ] },
    { id: 'hall_fest', label: '🎡 합동 페스티벌에 낀다', mode: 'oneshot',
      when: "live == '없음' and fans >= 5000 and u_pow >= 300 and funds >= 300 and not unit_over",
      inject: '[행동] 여러 유닛이 서는 무대의 한 칸을 산다. 앞뒤로 누가 서는지가 중요한 자리다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 300, 0)' },
        { set: 'live', expr: "'합동 페스티벌'" }, { set: 'live_days', expr: '9 + rand(0, 6)' },
      ] },
    { id: 'hall_solo', label: '🎭 단독 공연을 건다', mode: 'oneshot',
      when: "live == '없음' and fans >= 15000 and u_pow >= 450 and funds >= 700 and not unit_over",
      inject: '[행동] 이름 하나로 홀을 채워야 하는 날을 잡는다. 포스터에 다른 이름이 없다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 700, 0)' },
        { set: 'live', expr: "'단독 공연'" }, { set: 'live_days', expr: '12 + rand(0, 8)' },
      ] },
    { id: 'hall_tour', label: '🚌 전국 투어를 올린다', mode: 'oneshot',
      when: "live == '없음' and fans >= 25000 and u_pow >= 620 and funds >= 1600 and not unit_over",
      inject: '[행동] 도시 이름이 줄줄이 적힌 일정표를 짠다. 돌아올 때 셋이 어떤 얼굴일지는 아무도 모른다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 1600, 0)' },
        { set: 'live', expr: "'전국 투어'" }, { set: 'live_days', expr: '16 + rand(0, 10)' },
      ] },
    // ── 무대 ──
    { id: 'live_show', label: '🎫 라이브에 선다', mode: 'oneshot',
      when: "live != '없음' and live_days <= 0 and stand >= 1 and not unit_over", check: 'ck_live',
      inject: '[행동] 객석이 찼다. 조명이 꺼지고 첫 음이 나가기 직전부터 그려라.' },
    { id: 'perform', label: '🎤 업무를 치른다', mode: 'oneshot',
      when: "job != '없음' and job_days <= 0 and stand >= 1 and not unit_over", check: 'ck_stage',
      inject: '[행동] 오늘이 그날이다. 대기실에서 무대까지의 몇 걸음부터 그려라.',
      effects: [
        { set: 'm1_st', expr: 'max(m1_st - round(p1 * 16), 0)' },
        { set: 'm2_st', expr: 'max(m2_st - round(p2 * 16), 0)' },
        { set: 'm3_st', expr: 'max(m3_st - round(p3 * 16), 0)' },
      ] },
    // ── 사람 ──
    { id: 'rest_day', label: '☕ 쉬게 한다', mode: 'oneshot', cooldown: 2,
      when: 'funds >= 20 and not unit_over',
      inject: '[행동] 오늘은 아무 일정도 잡지 않는다. 셋을 각자 쉬게 둔다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 20, 0)' },
        { set: 'm1_st', expr: 'min(m1_st + 25, 100)' }, { set: 'm2_st', expr: 'min(m2_st + 25, 100)' }, { set: 'm3_st', expr: 'min(m3_st + 25, 100)' },
        { set: 'm1_me', expr: 'min(m1_me + 12, 100)' }, { set: 'm2_me', expr: 'min(m2_me + 12, 100)' }, { set: 'm3_me', expr: 'min(m3_me + 12, 100)' },
        { set: 'buzz', expr: 'max(buzz - 3, 0)' },
      ] },
    { id: 'talk', label: '💬 이야기를 나눈다', mode: 'oneshot', cooldown: 3,
      when: 'not unit_over',
      inject: '[행동] 연습실에 남아 셋과 이야기한다. 무슨 말이 오갔는지는 장면이 정한다.',
      effects: [
        { set: 'm1_me', expr: 'min(m1_me + 10, 100)' }, { set: 'm2_me', expr: 'min(m2_me + 10, 100)' }, { set: 'm3_me', expr: 'min(m3_me + 10, 100)' },
        { set: 'm1_love', expr: 'min(m1_love + 6, 100)' }, { set: 'm2_love', expr: 'min(m2_love + 6, 100)' }, { set: 'm3_love', expr: 'min(m3_love + 6, 100)' },
      ] },
    // ── 사무소 ──
    { id: 'promo', label: '📣 홍보를 돈다', mode: 'oneshot', cooldown: 3,
      when: 'funds >= 30 and not unit_over',
      inject: '[행동] 전단과 SNS와 발품. 이름을 한 사람이라도 더 알게 만드는 일이다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 30, 0)' },
        { set: 'awareness', expr: 'min(awareness + max(1, round((100 - awareness) * 0.05)), 100)' },
        { set: 'buzz', expr: 'min(buzz + 8, 100)' },
        // 발품은 그날 바로 팬으로도 돌아온다 — 인지도만 주면 돌아오는 데 너무 오래 걸린다.
        // ⚠ 체력 3·쿨다운 3은 진단으로 고른 값이다: 6·2였을 때 이 버튼은 **있는 것 자체가
        //   손해**였다(빼면 33턴 더 삶). 월급이 자금을 조이자 드러난 함정이라, 발품 값을
        //   낮춰 균형을 되돌렸다.
        { set: 'fans', expr: 'min(fans + 40 + round(fans * 0.04), 9999999)' },
        { set: 'm1_st', expr: 'max(m1_st - 3, 0)' }, { set: 'm2_st', expr: 'max(m2_st - 3, 0)' }, { set: 'm3_st', expr: 'max(m3_st - 3, 0)' },
      ] },
    // ── 제작 의뢰 ── (v0.82)
    // 돈만으로는 안 된다. 위 등급일수록 **이름값을 요구한다** — 무명 유닛에는 좋은 사람이
    // 안 붙는다는 게 이 문턱의 뜻이다. 새로 맞춘 옷 이름은 서사가 짓고 보조 AI가 wardrobe에 올린다.
    { id: 'make_dress1', label: '👗 무대의상을 맞춘다', mode: 'oneshot',
      when: "funds >= 150 and costume != '제작 의상' and costume != '특별 의상' and costume != '특주 의상' and not unit_over",
      inject: '[행동] 동네 의상실에 셋을 데려간다. 치수를 재는 동안 아무도 말이 없다.',
      effects: [{ set: 'funds', expr: 'max(funds - 150, 0)' }, { set: 'costume', expr: "'제작 의상'" }] },
    { id: 'make_dress2', label: '✨ 특별 의상을 의뢰한다', mode: 'oneshot',
      when: "funds >= 500 and awareness >= 35 and costume != '특별 의상' and costume != '특주 의상' and not unit_over",
      inject: '[행동] 이름 있는 디자이너를 찾아간다. 도면부터 그리는 자리다.',
      effects: [{ set: 'funds', expr: 'max(funds - 500, 0)' }, { set: 'costume', expr: "'특별 의상'" }] },
    { id: 'make_dress3', label: '💎 특주 의상을 올린다', mode: 'oneshot',
      when: "funds >= 1400 and awareness >= 65 and costume != '특주 의상' and not unit_over",
      inject: '[행동] 이 무대만을 위한 옷을 짓는다. 다시는 안 입을 옷이라는 걸 모두가 안다.',
      effects: [{ set: 'funds', expr: 'max(funds - 1400, 0)' }, { set: 'costume', expr: "'특주 의상'" }] },
    // 음반은 한 번 내면 **매달 인세가 들어온다** — 이 판에서 유일하게 손을 놓아도 도는 돈이라
    // 값이 비싸고 인지도를 요구한다. 곡 이름은 서사가 짓고 보조 AI가 songs에 올린다.
    { id: 'make_single', label: '💿 싱글을 낸다', mode: 'oneshot',
      when: "funds >= 600 and awareness >= 20 and album == '없음' and not unit_over",
      inject: '[행동] 작은 스튜디오를 빌려 두 곡을 녹음한다. 첫 음반이다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 600, 0)' }, { set: 'album', expr: "'싱글'" },
        { set: 'buzz', expr: 'min(buzz + 10, 100)' },
        { set: 'sales', expr: 'min(sales + round(fans * 0.3), 9999999)' },
      ] },
    { id: 'make_mini', label: '📀 미니 앨범을 낸다', mode: 'oneshot',
      when: "funds >= 1400 and awareness >= 40 and album == '싱글' and not unit_over",
      inject: '[행동] 다섯 곡짜리를 짠다. 곡 순서를 놓고 밤을 새우는 장면이 어울린다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 1400, 0)' }, { set: 'album', expr: "'미니 앨범'" },
        { set: 'buzz', expr: 'min(buzz + 16, 100)' },
        { set: 'sales', expr: 'min(sales + round(fans * 0.5), 9999999)' },
      ] },
    { id: 'make_full', label: '🏆 정규 앨범을 낸다', mode: 'oneshot',
      when: "funds >= 3000 and awareness >= 65 and album == '미니 앨범' and not unit_over",
      inject: '[행동] 정규 한 장을 만든다. 이걸로 이 유닛이 어떤 유닛인지가 정해진다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 3000, 0)' }, { set: 'album', expr: "'정규 앨범'" },
        { set: 'buzz', expr: 'min(buzz + 24, 100)' },
        { set: 'awareness', expr: 'min(awareness + 4, 100)' },
        { set: 'sales', expr: 'min(sales + round(fans * 0.8), 9999999)' },
      ] },
    // ── 음지 ── (v0.82)
    // 돈이 급할 때 손이 가는 쪽. 넷 다 **그날 밤에 끝난다**(D-day가 없다) — 급전이라는 게
    // 이 축의 성질이라 일정표에 안 올린다. 위로 갈수록 벌이가 크고 셋이 잃는 것도 크다.
    // 문턱은 자금이 아니라 **타락도**다: 한 번 담근 만큼만 다음이 열린다.
    // ⚠ impactExempt — 진단이 "쓰면 손해인 함정 액션"으로 잡는 게 맞는 버튼이다. 손해인 걸
    //   알면서 누르는 자리라서 지적에서 뺀다 (융자와 같은 규율).
    { id: 'shady_night', label: '🌃 심야 행사를 받는다', mode: 'oneshot', cooldown: 2, impactExempt: true,
      when: 'not unit_over', check: 'ck_night',
      inject: '[행동] 이름을 안 밝히는 쪽 행사다. 끝나면 현금으로 준다고 했다.',
      effects: [
        { set: 'funds', expr: 'min(funds + (shady_ok >= 1 ? 200 : 0), 9999999)' },
        { set: 'inc_stage', expr: 'min(inc_stage + (shady_ok >= 1 ? 200 : 0), 9999999)' },
        { set: 'corrupt', expr: 'min(corrupt + (shady_ok >= 1 ? 4 : 0), 100)' },
        { set: 'm1_st', expr: 'max(m1_st - (shady_ok >= 1 ? 10 : 0), 0)' },
        { set: 'm2_st', expr: 'max(m2_st - (shady_ok >= 1 ? 10 : 0), 0)' },
        { set: 'm3_st', expr: 'max(m3_st - (shady_ok >= 1 ? 10 : 0), 0)' },
        { set: 'm1_me', expr: 'max(m1_me - (shady_ok >= 1 ? 6 : 0), 0)' },
        { set: 'm2_me', expr: 'max(m2_me - (shady_ok >= 1 ? 6 : 0), 0)' },
        { set: 'm3_me', expr: 'max(m3_me - (shady_ok >= 1 ? 6 : 0), 0)' },
      ] },
    { id: 'shady_spon', label: '🥂 스폰서 자리에 앉힌다', mode: 'oneshot', cooldown: 3, impactExempt: true,
      when: 'corrupt >= 10 and not unit_over', check: 'ck_spon',
      inject: '[행동] 술자리에 셋을 앉힌다. 무대 이야기는 한 마디도 안 나오는 자리다.',
      effects: [
        { set: 'funds', expr: 'min(funds + (shady_ok >= 1 ? 650 : 0), 9999999)' },
        { set: 'inc_stage', expr: 'min(inc_stage + (shady_ok >= 1 ? 650 : 0), 9999999)' },
        { set: 'corrupt', expr: 'min(corrupt + (shady_ok >= 1 ? 9 : 0), 100)' },
        { set: 'm1_me', expr: 'max(m1_me - (shady_ok >= 1 ? 12 : 0), 0)' },
        { set: 'm2_me', expr: 'max(m2_me - (shady_ok >= 1 ? 12 : 0), 0)' },
        { set: 'm3_me', expr: 'max(m3_me - (shady_ok >= 1 ? 12 : 0), 0)' },
        { set: 'm1_love', expr: 'max(m1_love - (shady_ok >= 1 ? 5 : 0), 0)' },
        { set: 'm2_love', expr: 'max(m2_love - (shady_ok >= 1 ? 5 : 0), 0)' },
        { set: 'm3_love', expr: 'max(m3_love - (shady_ok >= 1 ? 5 : 0), 0)' },
      ] },
    { id: 'shady_gravure', label: '📷 수위 있는 화보를 찍는다', mode: 'oneshot', cooldown: 4, impactExempt: true,
      when: 'corrupt >= 28 and not unit_over', check: 'ck_gravure',
      inject: '[행동] 어디까지 벗길지를 놓고 흥정한다. 셋에게는 마지막에 말한다.',
      effects: [
        { set: 'funds', expr: 'min(funds + (shady_ok >= 1 ? 1500 : 0), 9999999)' },
        { set: 'inc_goods', expr: 'min(inc_goods + (shady_ok >= 1 ? 1500 : 0), 9999999)' },
        { set: 'corrupt', expr: 'min(corrupt + (shady_ok >= 1 ? 13 : 0), 100)' },
        { set: 'buzz', expr: 'min(buzz + (shady_ok >= 1 ? 20 : 0), 100)' },
        { set: 'fans', expr: 'min(fans + (shady_ok >= 1 ? round(fans * 0.08) + 300 : 0), 9999999)' },
        { set: 'm1_me', expr: 'max(m1_me - (shady_ok >= 1 ? 16 : 0), 0)' },
        { set: 'm2_me', expr: 'max(m2_me - (shady_ok >= 1 ? 16 : 0), 0)' },
        { set: 'm3_me', expr: 'max(m3_me - (shady_ok >= 1 ? 16 : 0), 0)' },
        { set: 'm1_love', expr: 'max(m1_love - (shady_ok >= 1 ? 8 : 0), 0)' },
        { set: 'm2_love', expr: 'max(m2_love - (shady_ok >= 1 ? 8 : 0), 0)' },
        { set: 'm3_love', expr: 'max(m3_love - (shady_ok >= 1 ? 8 : 0), 0)' },
      ] },
    { id: 'shady_adult', label: '🔞 성인 영상으로 돌린다', mode: 'oneshot', cooldown: 6, impactExempt: true,
      when: 'corrupt >= 55 and not unit_over', check: 'ck_adult',
      inject: '[행동] 이 계약서에 도장을 찍으면 돌아올 길이 없다는 걸 양쪽 다 안다. 현장은 그리지 말고 계약 자리까지만 그려라.',
      effects: [
        { set: 'funds', expr: 'min(funds + (shady_ok >= 1 ? 3800 : 0), 9999999)' },
        { set: 'inc_goods', expr: 'min(inc_goods + (shady_ok >= 1 ? 3800 : 0), 9999999)' },
        { set: 'corrupt', expr: 'min(corrupt + (shady_ok >= 1 ? 18 : 0), 100)' },
        { set: 'buzz', expr: 'min(buzz + (shady_ok >= 1 ? 30 : 0), 100)' },
        { set: 'fans', expr: 'min(fans + (shady_ok >= 1 ? round(fans * 0.2) + 1200 : 0), 9999999)' },
        // 이름값이 깎인다 — 팬은 늘어도 업계가 등을 돌린다. 이게 지상파가 닫히는 이유다
        { set: 'awareness', expr: 'max(awareness - (shady_ok >= 1 ? 6 : 0), 0)' },
        { set: 'm1_me', expr: 'max(m1_me - (shady_ok >= 1 ? 22 : 0), 0)' },
        { set: 'm2_me', expr: 'max(m2_me - (shady_ok >= 1 ? 22 : 0), 0)' },
        { set: 'm3_me', expr: 'max(m3_me - (shady_ok >= 1 ? 22 : 0), 0)' },
        { set: 'm1_love', expr: 'max(m1_love - (shady_ok >= 1 ? 12 : 0), 0)' },
        { set: 'm2_love', expr: 'max(m2_love - (shady_ok >= 1 ? 12 : 0), 0)' },
        { set: 'm3_love', expr: 'max(m3_love - (shady_ok >= 1 ? 12 : 0), 0)' },
      ] },
    // 융자는 일부러 손해인 버튼이다 — 오늘을 사고 내일을 판다. 진단의 '함정 액션'
    // 지적에서 빼되(impactExempt), 정말 급할 때만 열리게 자금 문턱을 걸어 둔다.
    { id: 'borrow', label: '🏦 융자를 받는다', mode: 'oneshot', cooldown: 5, impactExempt: true,
      when: 'funds < 150 and not unit_over',
      inject: '[행동] 은행 창구에 앉는다. 숫자를 적고 도장을 찍는 짧은 장면으로.',
      effects: [
        { set: 'funds', expr: 'min(funds + 500, 9999999)' },
        // 급전은 갈수록 조건이 나빠진다 — 이미 진 빚에 비례해 얹힌다. 정액(+560)이던 시절에는
        // 돌려막기가 영원히 가능해서 파산이 **한 번도 안 떴다**(진단의 '죽은 이벤트'). 이제
        // 1200 → 1880 → 2668 → 3535로 불어나 다섯 번째 융자가 파산선을 넘는다.
        { set: 'debt', expr: 'min(debt + 560 + round(debt * 0.1), 9999999)' },
        // 융자는 번 돈이 아니라 자리를 옮긴 돈이다 — 기초 잔고를 같이 올려 수지에서 뺀다
        { set: 'month_open', expr: 'min(month_open + 500, 9999999)' },
      ] },
    { id: 'repay', label: '💴 빚을 갚는다', mode: 'oneshot',
      when: 'funds >= 200 and debt >= 1 and not unit_over',
      inject: '[행동] 장부의 숫자를 조금 줄인다. 아무도 안 보는 곳에서 하는 일이다.',
      effects: [
        { set: 'funds', expr: 'max(funds - 200, 0)' },
        { set: 'debt', expr: 'max(debt - 200, 0)' },
        // 상환도 마찬가지 — 손해를 본 게 아니라 빚이 줄었을 뿐이라 수지에는 안 잡힌다
        { set: 'month_open', expr: 'max(month_open - 200, 0)' },
      ] },
    // ── 하루를 닫는다 ──
    // 이 버튼이 이 템플릿의 심장이다. D-day가 여기서 줄고, 펑크도 여기서 확정된다.
    // 안 누를 수가 없는 버튼이라 진단의 "함정 액션" 지적에서 뺀다(impactExempt).
    { id: 'next_day', label: '🌙 하루를 마친다', mode: 'oneshot', impactExempt: true,
      when: 'not unit_over',
      inject: '[행동] 사무소의 불을 끄고 하루를 접는다. 오늘 남은 것 하나를 짧게 그려라.',
      effects: [
        { set: 'skip_day', expr: 'skip_day + 1' },
        // ⚠ 순서가 중요하다 — 펑크 판정이 job_days를 읽으므로 감소는 맨 뒤다
        { set: 'late', expr: "job != '없음' and job_days <= 0 ? min(late + 1, 99) : late" },
        { set: 'buzz', expr: "job != '없음' and job_days <= 0 ? max(buzz - 12, 0) : max(round(buzz * 0.88), 0)" },
        { set: 'job', expr: "job != '없음' and job_days <= 0 ? '없음' : job" },
        // 라이브도 같은 규율 — 잡아 두고 안 서면 펑크다 (공연은 표를 판 자리라 더 크게 깎인다)
        { set: 'late', expr: "live != '없음' and live_days <= 0 ? min(late + 2, 99) : late" },
        { set: 'buzz', expr: "live != '없음' and live_days <= 0 ? max(buzz - 18, 0) : buzz" },
        { set: 'live', expr: "live != '없음' and live_days <= 0 ? '없음' : live" },
        { set: 'funds', expr: 'max(funds - 25, 0)' },
        { set: 'm1_st', expr: 'min(m1_st + 10, 100)' }, { set: 'm2_st', expr: 'min(m2_st + 10, 100)' }, { set: 'm3_st', expr: 'min(m3_st + 10, 100)' },
        { set: 'm1_me', expr: 'min(m1_me + 4, 100)' }, { set: 'm2_me', expr: 'min(m2_me + 4, 100)' }, { set: 'm3_me', expr: 'min(m3_me + 4, 100)' },
        // 잊힘 — 쌓이기만 하는 자원을 두면 손 놓아도 안 줄어든다. 하루 1%씩 빠져서
        // "계속 뭔가 하고 있어야 유지된다"가 성립한다. 인지도는 화제가 아예 없는 날에만 준다
        { set: 'fans', expr: 'max(fans - round(fans * 0.01), 0)' },
        { set: 'm1_fan', expr: 'max(m1_fan - round(m1_fan * 0.01), 0)' },
        { set: 'm2_fan', expr: 'max(m2_fan - round(m2_fan * 0.01), 0)' },
        { set: 'm3_fan', expr: 'max(m3_fan - round(m3_fan * 0.01), 0)' },
        { set: 'awareness', expr: 'buzz <= 8 ? max(awareness - 1, 0) : awareness' },
        { set: 'job_days', expr: 'max(job_days - 1, 0)' },
        { set: 'live_days', expr: 'max(live_days - 1, 0)' },
      ] },
  ],
  rules: {
    onTurn: [
      // 지난 일정 자동 정리 — @경과일이 지난 항목을 스스로 뺀다 (달력 규약)
      { list: 'schedule', expire: 'elapsed' },
      { list: 'job_queue', expire: 'elapsed' },
      { list: 'live_queue', expire: 'elapsed' },
    ],
    events: [
      // 등급은 인지도가 문턱을 넘을 때 올라간다. once를 안 쓴 이유는 romance와 같다 —
      // 조건이 계속 참이면 한 번만 발동하고, 내려갔다 올라와도 다시 맞춰진다
      { id: 'rank_e', when: "rank == 'F' and awareness >= 20", effects: [{ set: 'rank', expr: "'E'" }],
        notify: '업계 명부에 사무소 이름이 실렸다. E등급이다.' },
      { id: 'rank_d', when: "rank == 'E' and awareness >= 32", effects: [{ set: 'rank', expr: "'D'" }],
        notify: '전화가 먼저 걸려 오기 시작했다. D등급이다.' },
      { id: 'rank_c', when: "rank == 'D' and awareness >= 46", effects: [{ set: 'rank', expr: "'C'" }],
        notify: '이름을 대면 알아듣는 사람이 늘었다. C등급이다.' },
      { id: 'rank_b', when: "rank == 'C' and awareness >= 60", effects: [{ set: 'rank', expr: "'B'" }],
        notify: '지상파 편성표에 유닛 이름이 올랐다. B등급이다.' },
      { id: 'rank_a', when: "rank == 'B' and awareness >= 76", effects: [{ set: 'rank', expr: "'A'" }],
        notify: '이제 이쪽에서 자리를 고른다. A등급이다.' },
      { id: 'rank_s', when: "rank == 'A' and awareness >= 92", effects: [{ set: 'rank', expr: "'S'" }],
        notify: '올해를 이야기할 때 이 이름이 빠지지 않게 되었다. S등급이다.' },
      // 월말 정산 — 시간 등호에는 반드시 빗장이 필요하다. 조건이 참인 동안 매 턴 발동하지
      // 않도록 효과가 조건 변수(settled)를 직접 닫는다 (v0.50 린트가 요구하는 짝)
      { id: 'settle', when: 'dom >= 28 and settled != month and not unit_over',
        notify: '월말이다. 장부를 펴고 이자와 밀린 것들을 셈한다.',
        effects: [
          { set: 'settled', expr: 'month' },
          // 펑크도 달이 바뀌면 하나씩 잊힌다 — 안 그러면 한 번 무너진 신용이 영영 안 돌아온다
          { set: 'late', expr: 'max(late - 1, 0)' },
          // ⚠ 순서 — 장부를 먼저 닫고 이자를 낸다. 이자를 먼저 빼면 그 달에도 다음 달에도
          // 안 잡히는 돈이 된다. 이자는 새 달 1일에 나가는 첫 지출로 잡힌다.
          // 타락은 달이 바뀌면 조금 잊힌다 — 되돌아오는 길이 아주 없으면 그건 갈림길이 아니다.
          // 하루 단위로 빼면 음지 루트 자체가 유지되지 않아서(문턱이 계속 닫힌다) 달 단위로 둔다
          { set: 'corrupt', expr: 'max(corrupt - 3, 0)' },
          { set: 'inc_stage', expr: '0' }, { set: 'inc_ticket', expr: '0' },
          { set: 'inc_goods', expr: '0' }, { set: 'inc_album', expr: '0' },
          { set: 'month_open', expr: 'funds' },
          // 인세 — 낸 음반이 있으면 손을 놓아도 도는 유일한 돈이다. 새 달의 첫 수입으로 잡는다
          // (month_open을 닫은 뒤라야 이 달 수입에 들어간다). 장부와 자금을 **같이** 올린다
          { set: 'inc_album', expr: 'min(inc_album + round(fans * album_n * 0.005), 9999999)' },
          { set: 'funds', expr: 'min(funds + round(fans * album_n * 0.005), 9999999)' },
          // 월급 — 새 달의 첫 지출. 못 주면 그만큼 빚이 된다 (이자와 같은 규율)
          // ⚠ 순서 — 사람에게 가는 값은 **자금을 빼기 전에** 재야 한다. 뒤로 옮기면
          //   funds가 이미 0이라 늘 미지급으로 잡힌다.
          // 월급을 못 준 달은 사람이 먼저 안다. 이게 없으면 손 놓고 있어도 아무도 안 무너져서
          // "아무것도 안 해도 전부 생존"이 된다 — 진단이 그렇게 신고했다. 무너지는 건 빚이
          // 아니라 사람이라는 이 판의 규율을, 아무 일도 안 한 판에도 똑같이 적용한 것이다.
          { set: 'unpaid', expr: 'funds < salary ? min(unpaid + 1, 12) : 0' },
          { set: 'm1_me', expr: 'funds < salary ? max(m1_me - 10, 0) : m1_me' },
          { set: 'm2_me', expr: 'funds < salary ? max(m2_me - 10, 0) : m2_me' },
          { set: 'm3_me', expr: 'funds < salary ? max(m3_me - 10, 0) : m3_me' },
          { set: 'm1_love', expr: 'funds < salary ? max(m1_love - 12, 0) : m1_love' },
          { set: 'm2_love', expr: 'funds < salary ? max(m2_love - 12, 0) : m2_love' },
          { set: 'm3_love', expr: 'funds < salary ? max(m3_love - 12, 0) : m3_love' },
          { set: 'debt', expr: 'min(debt + max(salary - funds, 0), 9999999)' },
          { set: 'funds', expr: 'max(funds - salary, 0)' },
          // 임대료 — 월급 다음으로 나간다. 못 내면 역시 빚이 된다.
          // ⚠ 여기엔 사람 값을 안 붙인다: 월급과 임대료 양쪽에 멘탈을 걸었더니 자금이
          //   잠깐 마르는 것만으로 유닛이 무너져 정상 플레이 생존율이 38%까지 떨어졌다.
          //   못 받은 건 월급이지 사무실이 아니다 — 사람에게 가는 값은 월급 쪽에만 둔다.
          { set: 'debt', expr: 'min(debt + max(rent - funds, 0), 9999999)' },
          { set: 'funds', expr: 'max(funds - rent, 0)' },
          { set: 'debt', expr: 'min(debt + max(round(debt * 0.05) - funds, 0), 9999999)' },
          { set: 'funds', expr: 'max(funds - round(debt * 0.05), 0)' },
        ] },
      // 판을 끝내는 두 길. 빚이 아니라 사람이 먼저다 — 무리한 스케줄이 곧 패배다
      { id: 'burnout', when: 'not unit_over and (m1_me <= 0 or m2_me <= 0 or m3_me <= 0)',
        notify: '연습실에 아무도 나오지 않은 아침이 있었다. 더 굴릴 수 없다는 걸 모두가 안다.',
        effects: [{ set: 'unit_over', expr: '1' }] },
      // 사람이 떠나는 두 번째 길 — 빚보다 먼저 오는 쪽이다. 석 달 연속 월급을 못 주면
      // 아무도 붙잡지 않는다.
      // ⚠ 두 달로 뒀더니 정상 플레이가 8/8 전멸했다 — 이 판은 자금이 늘 0 근처를 걷기
      //   때문에 한두 번 미끄러지는 건 예사다. 석 달은 '사정'이 아니라 '못 하는 것'이다
      { id: 'walkout', when: 'unpaid >= 3 and not unit_over',
        notify: '석 달째다. 아무도 화를 내지 않았고, 그래서 더 분명했다 — 셋은 각자 갈 곳을 찾았다.',
        effects: [{ set: 'unit_over', expr: '1' }] },
      { id: 'bankrupt', when: 'debt >= 4500 and not unit_over',
        notify: '더는 돌려막을 곳이 없다. 사무소 문에 종이 한 장이 붙었다.',
        effects: [{ set: 'unit_over', expr: '1' }] },
    ],
    randomEvents: {
      chancePerTurn: 0.35,
      table: [
        { id: 'fan_letter', weight: 3, cooldown: 6, when: 'not unit_over',
          effects: [
            { set: 'm1_me', expr: 'min(m1_me + 6, 100)' }, { set: 'm2_me', expr: 'min(m2_me + 6, 100)' }, { set: 'm3_me', expr: 'min(m3_me + 6, 100)' },
          ],
          notify: '사무소로 편지가 왔다. 손글씨였고, 아주 오래 쓴 티가 났다.' },
        { id: 'cold', weight: 2, cooldown: 5, when: 'not unit_over',
          effects: [
            { set: 'm1_st', expr: 'max(m1_st - 12, 0)' }, { set: 'm2_st', expr: 'max(m2_st - 12, 0)' }, { set: 'm3_st', expr: 'max(m3_st - 12, 0)' },
          ],
          notify: '연습실에 감기가 돌았다. 셋 다 목이 가라앉았다.' },
        // 음지의 청구서 — 돈은 그날 받고 값은 나중에 치른다. 이 이벤트가 없으면 타락 루트가
        // 그냥 "돈 더 주는 버튼"이 되어 갈림길이 안 된다
        { id: 'leak', weight: 3, cooldown: 10, when: 'not unit_over and corrupt >= 40',
          effects: [
            { set: 'awareness', expr: 'max(awareness - 5, 0)' },
            { set: 'buzz', expr: 'min(buzz + 15, 100)' },
            { set: 'm1_me', expr: 'max(m1_me - 8, 0)' }, { set: 'm2_me', expr: 'max(m2_me - 8, 0)' }, { set: 'm3_me', expr: 'max(m3_me - 8, 0)' },
          ],
          notify: '음지 쪽 사진이 돌고 있다는 이야기가 들어왔다. 아직은 소문이지만, 소문은 늘 먼저 도착한다.' },
        { id: 'interview', weight: 2, cooldown: 7, when: 'not unit_over and awareness >= 20',
          effects: [
            { set: 'awareness', expr: 'min(awareness + 3, 100)' },
            { set: 'buzz', expr: 'min(buzz + 5, 100)' },
          ],
          notify: '작은 잡지에서 인터뷰 요청이 왔다. 두 쪽짜리지만 지면은 지면이다.' },
        // ── 갈림길 둘 — 마지막 선택지는 조건 없이 둬야 타임아웃 자동 결정이 된다 ──
        { id: 'scandal', weight: 3, cooldown: 9, timeout: 2, when: 'not unit_over and buzz >= 35',
          notify: '기자 하나가 사진 몇 장을 들고 왔다. 아직 어디에도 안 실렸다.',
          choices: [
            { label: '정면으로 밝힌다',
              inject: '숨기지 않기로 했다 — 셋을 앞에 세우지 않고 프로듀서가 먼저 말하는 장면으로.',
              effects: [
                { set: 'buzz', expr: 'min(buzz + 20, 100)' },
                { set: 'awareness', expr: 'min(awareness + 4, 100)' },
                { set: 'm1_love', expr: 'min(m1_love + 8, 100)' }, { set: 'm2_love', expr: 'min(m2_love + 8, 100)' }, { set: 'm3_love', expr: 'min(m3_love + 8, 100)' },
                { set: 'm1_me', expr: 'max(m1_me - 8, 0)' }, { set: 'm2_me', expr: 'max(m2_me - 8, 0)' }, { set: 'm3_me', expr: 'max(m3_me - 8, 0)' },
              ] },
            { label: '값을 치르고 덮는다', when: 'funds >= 300',
              inject: '봉투가 오간다. 아무 일도 없었던 것으로 한다 — 셋은 이 일을 모른다.',
              effects: [
                { set: 'funds', expr: 'max(funds - 300, 0)' },
                { set: 'buzz', expr: 'max(buzz - 4, 0)' },
              ] },
            { label: '아무 말도 하지 않는다',
              inject: '대응하지 않기로 했다. 기사는 나가고, 며칠 시끄럽다가 가라앉을 것이다.',
              effects: [
                { set: 'buzz', expr: 'min(buzz + 12, 100)' },
                { set: 'm1_me', expr: 'max(m1_me - 12, 0)' }, { set: 'm2_me', expr: 'max(m2_me - 12, 0)' }, { set: 'm3_me', expr: 'max(m3_me - 12, 0)' },
                { set: 'm1_love', expr: 'max(m1_love - 6, 0)' }, { set: 'm2_love', expr: 'max(m2_love - 6, 0)' }, { set: 'm3_love', expr: 'max(m3_love - 6, 0)' },
              ] },
          ] },
        { id: 'sudden_offer', weight: 3, cooldown: 8, timeout: 2, when: "not unit_over and job == '없음'",
          notify: '내일모레 자리 하나가 비었다는 연락이 왔다. 급하지만 큰 자리다.',
          choices: [
            { label: '잡는다',
              inject: '일정을 뒤엎고 받기로 한다. 준비할 시간이 거의 없다.',
              effects: [
                { set: 'job', expr: "rank_n >= 3 ? '케이블 음악방송' : '잡지 화보'" },
                { set: 'job_days', expr: '2' },
                { set: 'm1_st', expr: 'max(m1_st - 8, 0)' }, { set: 'm2_st', expr: 'max(m2_st - 8, 0)' }, { set: 'm3_st', expr: 'max(m3_st - 8, 0)' },
              ] },
            // ⚠ 여기 오래 있던 버그가 있었다 — job에 '지역 라이브'(라이브 쪽 값)를 넣고 있었다.
            //   enum에 없는 값이라 난이도·보수 표가 전부 0으로 떨어져 **공짜로 치르는 무대**가 됐다.
            //   표현식 안의 문자열은 검증이 못 보니, 축이 둘인 스키마에서는 눈으로 짝을 맞출 것.
            { label: '조건을 걸고 받는다', when: 'awareness >= 40',
              inject: '이쪽 조건을 먼저 말한다. 받아들여지면 그건 이 유닛이 아쉬운 쪽이 아니라는 뜻이다.',
              effects: [
                { set: 'job', expr: "'지방 방송국'" },
                { set: 'job_days', expr: '4' },
                { set: 'awareness', expr: 'min(awareness + 2, 100)' },
              ] },
            { label: '거절한다',
              inject: '무리라고 판단했다. 셋에게는 나중에 말하거나, 말하지 않는다.',
              effects: [
                { set: 'm1_love', expr: 'min(m1_love + 4, 100)' }, { set: 'm2_love', expr: 'min(m2_love + 4, 100)' }, { set: 'm3_love', expr: 'min(m3_love + 4, 100)' },
                { set: 'buzz', expr: 'max(buzz - 2, 0)' },
              ] },
          ] },
      ],
    },
  },
  directives: [
    { id: 'dday', when: "job != '없음' and job_days <= 0 and not unit_over",
      text: '[상태] 오늘이 그날이다 — {job}. 아침부터 공기가 다르고, 대기실 밖의 소리가 계속 들어온다.' },
    { id: 'soon', when: "job != '없음' and job_days >= 1 and not unit_over",
      text: '[상태] {job}까지 {job_days}일 남았다. 준비하는 시간의 초조함이 장면에 배어나야 한다.' },
    { id: 'worn', when: 'u_cond <= 35 and not unit_over',
      text: '[상태] 무대에 서는 사람들이 지쳐 있다 (유닛 컨디션 {u_cond}). 웃는 얼굴 뒤가 비치는 묘사를 넣어라.' },
    { id: 'red', when: 'balance < 0 and not unit_over',
      text: '[상태] 이 달은 적자다 (수입 {income} · 지출 {spend}). 프로듀서가 장부를 덮어 두는 장면이 어울린다.' },
    { id: 'heavy', when: 'debt >= 3000 and not unit_over',
      text: '[상태] 빚이 {debt}만원이다. 프로듀서는 이걸 셋에게 말하지 않고 있다.' },
    { id: 'shade', when: 'corrupt >= 25 and corrupt < 55 and not unit_over',
      text: '[상태] 이 유닛은 이미 밝은 데만 다니지 않는다 (타락도 {corrupt}). 셋의 표정에 전에 없던 것이 섞여 있어야 한다.' },
    { id: 'sunk', when: 'corrupt >= 55 and not unit_over',
      text: '[상태] 돌아갈 자리가 거의 남지 않았다 (타락도 {corrupt}). 프로듀서도 셋도 그걸 알면서 말하지 않는다. 수위 있는 장면은 암시까지만 하고 넘겨라.' },
    { id: 'hot', when: 'buzz >= 70 and not unit_over',
      text: '[상태] 지금 화제의 한가운데다 (화제성 {buzz}). 어디를 가도 알아보고, 그게 부담이기도 하다.' },
    { id: 'ended', when: 'unit_over',
      text: '[상태] 이 이야기는 끝났다. 새로 시작하지 말고, 흩어진 뒤의 시점이나 남은 것들로 마무리하라.' },
  ],
  updater: {
    model: 'aux',
    allow: [
      { id: 'buzz', maxDelta: 12 },
      { id: 'awareness', maxDelta: 4 },
      { id: 'fans', maxGain: 500 },
      { id: 'm1_me', maxDelta: 8 }, { id: 'm2_me', maxDelta: 8 }, { id: 'm3_me', maxDelta: 8 },
      { id: 'm1_love', maxDelta: 6 }, { id: 'm2_love', maxDelta: 6 }, { id: 'm3_love', maxDelta: 6 },
      { id: 'schedule' },
      { id: 'job_queue' }, { id: 'live_queue' },
      // 곡·의상 이름은 시스템이 못 짓는다 — "무엇이 나올 차례인가"까지만 시스템이 정하고
      // 그게 무엇인지는 서사가 짓는다 (계약·발견 목록과 같은 규약)
      { id: 'songs' }, { id: 'wardrobe' },
    ],
    guide: '장면에 실제로 나온 것만 반영하라. 등급·일감·D-day·자금·빚·의상·음반·타락도·활동 중단은 시스템이 관리하니 건드리지 마라. '
      + '능력치(보컬·댄스·비주얼)는 레슨으로만 오르니 바꾸지 마라. 편성(센터·사이드)은 프로듀서가 정한다. '
      + '날짜를 넘기는 것은 🌙 버튼이 하니 시간으로 하루를 넘기지 마라. '
      + '일정은 서사에서 새 예정이 잡혔을 때만 "내용 @+N" 형태로 더하라.',
  },
  promptState: {
    position: 'history_end',
    template: '[프로덕션] {date} ({weekday}) · {rank}등급 · 랭킹 {ranking}위\n'
      + '인지도 {awareness} · 화제성 {buzz} · 팬 {fans} · 누적 판매 {sales}\n'
      + '자금 {funds} · 빚 {debt} · 펑크 {late}회\n'
      + '이번 달 수입 {income} · 지출 {spend} · 수지 {balance}\n'
      + '업무 {job} (남은 {job_days}일) · 라이브 {live} (남은 {live_days}일)\n'
      + '의상 {costume} · 음반 {album} · 타락도 {corrupt}\n'
      + '센터 {center} / 사이드 {side1} · {side2} · 유닛 컨디션 {u_cond}\n'
      + '유나 {m1_vo}/{m1_da}/{m1_vi} 컨디션 {c1} 호감 {m1_love}\n'
      + '세리 {m2_vo}/{m2_da}/{m2_vi} 컨디션 {c2} 호감 {m2_love}\n'
      + '린 {m3_vo}/{m3_da}/{m3_vi} 컨디션 {c3} 호감 {m3_love}',
    includeEvents: true,
  },
  party: {
    label: '유닛', icon: '🎤', empty: '없음', points: 'funds',
    note: '센터는 능력치가 1.3배로 실리고 개별 인기도 그만큼 더 가져간다. 한 사람은 한 자리에만.',
    tabs: [
      { id: 'unit', label: '편성',
        slots: [
          { var: 'center', label: '센터' },
          { var: 'side1', label: '사이드 1' },
          { var: 'side2', label: '사이드 2' },
        ],
        actions: ['perform', 'live_show'],
        note: '자리를 비워 두면 그 사람은 이번 무대에 안 선다 — 컨디션을 아낄 수 있다.' },
      // 레슨은 편성표의 업그레이드 항목이다. 비용이 자기 레벨을 보고 올라 스스로 브레이크가 된다
      { id: 'lesson', label: '레슨',
        items: [
          { var: 'm1_vo', label: '유나 · 보컬', max: 100, cost: 'round(m1_vo * m1_vo / 25) + 30' },
          { var: 'm1_da', label: '유나 · 댄스', max: 100, cost: 'round(m1_da * m1_da / 25) + 30' },
          { var: 'm1_vi', label: '유나 · 비주얼', max: 100, cost: 'round(m1_vi * m1_vi / 25) + 30' },
          { var: 'm2_vo', label: '세리 · 보컬', max: 100, cost: 'round(m2_vo * m2_vo / 25) + 30' },
          { var: 'm2_da', label: '세리 · 댄스', max: 100, cost: 'round(m2_da * m2_da / 25) + 30' },
          { var: 'm2_vi', label: '세리 · 비주얼', max: 100, cost: 'round(m2_vi * m2_vi / 25) + 30' },
          { var: 'm3_vo', label: '린 · 보컬', max: 100, cost: 'round(m3_vo * m3_vo / 25) + 30' },
          { var: 'm3_da', label: '린 · 댄스', max: 100, cost: 'round(m3_da * m3_da / 25) + 30' },
          { var: 'm3_vi', label: '린 · 비주얼', max: 100, cost: 'round(m3_vi * m3_vi / 25) + 30' },
        ],
        note: '운용자금으로 찍는다. 한 칸 올릴 때마다 다음 한 칸이 비싸진다.' },
      // ── 의뢰판 ── (v0.82)
      // 못 여는 자리도 **잠긴 채로 보인다** — 편성표는 실행할 수 없는 액션을 지우지 않고
      // 이유와 함께 흐리게 남긴다. 그게 "다음 목표"를 화면에 두는 유일한 자리다.
      { id: 'jobs', label: '일감',
        actions: ['take_street', 'take_radio', 'take_mag', 'take_ltv', 'take_cable', 'take_net', 'take_gold'],
        note: '자리마다 여는 문턱과 성사율이 다르다. 성사율은 상태창 [일감] 탭에서 본다 — 헛걸음이어도 영업비는 나간다.' },
      { id: 'halls', label: '무대',
        actions: ['hall_small', 'hall_civic', 'hall_fest', 'hall_solo', 'hall_tour', 'live_show'],
        note: '공연장은 판정 없이 빌린다. 대신 대관료가 선불이고 정원이 천장이다 — 못 채우면 그대로 손해다.' },
      { id: 'make', label: '제작',
        actions: ['make_dress1', 'make_dress2', 'make_dress3', 'make_single', 'make_mini', 'make_full'],
        note: '돈만으로는 안 된다. 위 등급일수록 이름값을 요구한다. 음반은 한 번 내면 매달 인세가 들어온다.' },
      // 탭 자체에 조건이 걸린다 — 돈이 마르기 전에는 이런 게 있다는 것도 모르는 편이 낫다.
      // 한 번이라도 담갔으면(타락도 ≥ 1) 형편이 나아져도 계속 보인다
      { id: 'shade', label: '음지', when: 'funds < 250 or corrupt >= 1',
        actions: ['shady_night', 'shady_spon', 'shady_gravure', 'shady_adult'],
        note: '오늘의 돈을 내일의 이름과 바꾸는 자리. 셋이 거절할 수 있고, 타락도가 오를수록 거절이 줄어든다. '
          + '타락도가 높으면 지상파와 골든타임이 닫힌다.' },
      { id: 'office', label: '사무소',
        actions: ['rest_day', 'talk', 'promo', 'borrow', 'repay', 'next_day'],
        note: '하루를 쓰는 일들. 다 하고 나면 🌙로 날을 넘긴다.' },
    ],
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    layout: 'tabs',
    groups: [
      // 장부를 프로덕션 탭에 합쳐 둔다 — 등급·인지도를 보는 눈과 돈을 보는 눈이 같아서,
      // 갈라 두면 "이 인지도를 사려고 얼마를 썼나"를 두 탭을 오가며 봐야 했다.
      // 프로덕션과 유닛을 한 탭에 (v0.81) — 이 판은 사무소에 유닛이 **하나**다. 갈라 두면
      // "우리가 어디까지 왔나"를 두 탭을 오가며 봐야 했다. 유닛을 여럿 굴리는 봇으로 개조할
      // 때는 여기서 다시 쪼개고 유닛마다 탭을 하나씩 두면 된다.
      { label: '프로덕션', items: [
        { var: 'rank' },
        { var: 'ranking' },
        { var: 'awareness', bar: { max: 100 }, color: "'#c86a9a'" },
        { var: 'buzz', bar: { max: 100 }, color: "buzz >= 70 ? '#d4506a' : (buzz <= 10 ? '#4a4a5a' : '#8a5a8a')" },
        { var: 'fans' },
        { var: 'sales', showWhen: 'sales > 0' },
        { var: 'late', showWhen: 'late > 0' },
        { var: 'center' },
        { var: 'side1', showWhen: "side1 != '없음'" },
        { var: 'side2', showWhen: "side2 != '없음'" },
        { var: 'u_rank' },
        { var: 'u_fan' },
        { var: 'u_cond', bar: { max: 100 }, color: "u_cond <= 35 ? '#a8443a' : '#6a8a7a'" },
        { var: 'u_vo' }, { var: 'u_da' }, { var: 'u_vi' },
        { var: 'costume' },
        { var: 'album', showWhen: "album != '없음'" },
        { var: 'songs', showWhen: 'count(songs) > 0' },
        { var: 'wardrobe', showWhen: 'count(wardrobe) > 0' },
      ] },
      // 장부는 갈래가 넷이 되면서 자기 탭을 얻었다 — 어디서 벌었는지가 다음 수를 정한다
      { label: '장부', items: [
        { var: 'funds' },
        { var: 'income' },
        { var: 'inc_stage', showWhen: 'inc_stage > 0' },
        { var: 'inc_ticket', showWhen: 'inc_ticket > 0' },
        { var: 'inc_goods', showWhen: 'inc_goods > 0' },
        { var: 'inc_album', showWhen: 'inc_album > 0' },
        { var: 'salary' },
        { var: 'spend' },
        { var: 'balance', color: "balance < 0 ? '#a8443a' : '#6a8a7a'" },
        { var: 'debt', color: "debt >= 3000 ? '#a8443a' : '#6a5a7a'" },
      ] },
      // 일감 탭 = 의뢰판. 지금 잡힌 것 둘(업무·라이브)이 각각 일정·난이도·보수를 달고,
      // 그 아래에 다음 차례가 줄을 선다.
      // v0.82: **일감이 비어 있을 때만** 성사율 표가 펼쳐진다. 이미 잡아 둔 일이 있으면
      // 볼 이유가 없는 숫자고, 늘 떠 있으면 지금 무엇이 중요한지가 안 보인다.
      { label: '일감', items: [
        { var: 'job' },
        { var: 'job_days', showWhen: "job != '없음'" },
        { var: 'job_vs', showWhen: "job != '없음'" },
        { var: 'job_pay', showWhen: "job != '없음'" },
        { var: 'od_radio', showWhen: "job == '없음' and awareness >= 8" },
        { var: 'od_mag', showWhen: "job == '없음' and awareness >= 18" },
        { var: 'od_ltv', showWhen: "job == '없음' and awareness >= 32" },
        { var: 'od_cable', showWhen: "job == '없음' and awareness >= 46" },
        { var: 'od_net', showWhen: "job == '없음' and awareness >= 62 and corrupt <= 45" },
        { var: 'od_gold', showWhen: "job == '없음' and awareness >= 80 and corrupt <= 25" },
        { var: 'live' },
        { var: 'live_days', showWhen: "live != '없음'" },
        { var: 'live_vs', showWhen: "live != '없음'" },
        { var: 'live_pay', showWhen: "live != '없음'" },
        { var: 'live_cap', showWhen: "live != '없음'" },
        { var: 'live_tickets', showWhen: "live != '없음'" },
        // 예상 객석 — 대관을 무리했는지가 여기 한 줄에 다 나온다. 60% 아래면 붉게 뜬다
        { var: 'live_fill', showWhen: "live != '없음'", bar: { max: 100 },
          color: "live_fill < 60 ? '#a8443a' : '#6a8a7a'" },
        { var: 'job_queue', showWhen: 'count(job_queue) > 0' },
        { var: 'live_queue', showWhen: 'count(live_queue) > 0' },
        { var: 'schedule', showWhen: 'count(schedule) > 0' },
      ] },
      // 음지 탭 — 발을 담근 뒤에만 뜬다. 안 간 판에서는 이런 게 있다는 것도 안 보인다
      { label: '음지', showWhen: 'corrupt >= 1', items: [
        { var: 'corrupt', bar: { max: 100 },
          color: "corrupt >= 55 ? '#8a2a3a' : (corrupt >= 25 ? '#a8443a' : '#6a5a7a')" },
        { var: 'u_love', bar: { max: 100 }, color: "'#c86a9a'" },
        { var: 'od_night' },
        { var: 'od_spon', showWhen: 'corrupt >= 10' },
        { var: 'od_gravure', showWhen: 'corrupt >= 28' },
        { var: 'od_adult', showWhen: 'corrupt >= 55' },
      ] },
      { label: '유나', items: [
        { var: 'm1_vo' }, { var: 'm1_da' }, { var: 'm1_vi' },
        { var: 'm1_st', bar: { max: 100 }, color: "m1_st <= 25 ? '#a8443a' : '#6a8a7a'" },
        { var: 'c1', bar: { max: 100 }, color: "c1 <= 30 ? '#a8443a' : '#6a8a7a'" },
        { var: 'm1_me', bar: { max: 100 }, color: "m1_me <= 20 ? '#a8443a' : '#7a6a9a'" },
        { var: 'm1_love', bar: { max: 100 }, color: "'#c86a9a'" },
        { var: 'm1_fan' },
      ] },
      { label: '세리', items: [
        { var: 'm2_vo' }, { var: 'm2_da' }, { var: 'm2_vi' },
        { var: 'm2_st', bar: { max: 100 }, color: "m2_st <= 25 ? '#a8443a' : '#6a8a7a'" },
        { var: 'c2', bar: { max: 100 }, color: "c2 <= 30 ? '#a8443a' : '#6a8a7a'" },
        { var: 'm2_me', bar: { max: 100 }, color: "m2_me <= 20 ? '#a8443a' : '#7a6a9a'" },
        { var: 'm2_love', bar: { max: 100 }, color: "'#c86a9a'" },
        { var: 'm2_fan' },
      ] },
      { label: '린', items: [
        { var: 'm3_vo' }, { var: 'm3_da' }, { var: 'm3_vi' },
        { var: 'm3_st', bar: { max: 100 }, color: "m3_st <= 25 ? '#a8443a' : '#6a8a7a'" },
        { var: 'c3', bar: { max: 100 }, color: "c3 <= 30 ? '#a8443a' : '#6a8a7a'" },
        { var: 'm3_me', bar: { max: 100 }, color: "m3_me <= 20 ? '#a8443a' : '#7a6a9a'" },
        { var: 'm3_love', bar: { max: 100 }, color: "'#c86a9a'" },
        { var: 'm3_fan' },
      ] },
    ],
    // 무대 조명 — 어두운 객석과 자홍빛 핀조명
    customCSS: `.sim-status { background:#14101a; border:1px solid #352b42; border-radius:3px; color:#cfc4d8; }
.sim-status summary { color:#e07aa8; letter-spacing:.14em; font-weight:700; }
.sim-group-label { color:#8a7a9a; letter-spacing:.18em; font-size:.78em; }
.sim-label { color:#8a7a9a; opacity:1; }
.sim-value { color:#f4eaf6; font-weight:700; }
.sim-badge, .sim-tag { background:#1e1728; color:#e0a94a; border:1px solid #453352; border-radius:3px; }
.sim-bar { background:#0c0910; height:8px; border:1px solid #2c2436; border-radius:2px; }
.sim-action { border-color:#453352; color:#cfc4d8; border-radius:3px; background:#1e1728; }
.sim-action.sim-armed { border-color:#e07aa8; background:#2c1f38; color:#f8d4e6; }
.sim-log { color:#6f6478; }`,
  },
  setup: {
    presets: [
      { id: 'rookie', label: '신인 셋 — 아직 아무도 모른다',
        set: {} },
      { id: 'hit', label: '한 번 터졌다 — 다음이 어렵다',
        set: {
          rank: 'C', awareness: 46, buzz: 62, fans: 14000, sales: 3200, funds: 1500, month_open: 1500, debt: 600,
          costume: '제작 의상',
          m1_vo: 52, m1_da: 40, m1_vi: 44, m1_love: 48, m1_fan: 5200,
          m2_vo: 36, m2_da: 58, m2_vi: 42, m2_love: 40, m2_fan: 4100,
          m3_vo: 40, m3_da: 38, m3_vi: 61, m3_love: 34, m3_fan: 4700,
        } },
      // ⚠ 프리셋은 **두 축 이상**을 함께 밀어야 난이도가 된다. 자금만 조금 줄이고 빚만 조금
      //   늘렸을 때는 진단이 "이름만 다르고 판은 같다"고 신고했다 — 실제로 세 프리셋의 수명이
      //   1~2턴 차이였다. 비축(자금)·부채(파산선까지의 거리)·완충(멘탈)을 같이 민다.
      { id: 'debtor', label: '빚에 눌려 — 셋을 지킬 수 있을까',
        set: {
          funds: 260, month_open: 260, debt: 3000, late: 2, buzz: 8,
          costume: '연습복',
          m1_st: 48, m1_me: 40, m1_love: 18,
          m2_st: 52, m2_me: 36, m2_love: 14,
          m3_st: 44, m3_me: 30, m3_love: 10,
        } },
    ],
  },
};

const TEMPLATES = {
  blank: { label: '빈 스키마 (최소)', schema: BLANK },
  daily: { label: '일상 — 하루의 기록 (날짜·시간·날씨·소지품)', schema: DAILY },
  rpg: { label: 'RPG 모험 기록 (HP/MP·레벨·인벤토리)', schema: RPG },
  estate: { label: '영지 시뮬레이션 (자원 관리)', schema: ESTATE },
  mystery: { label: '추리 — 사건 수사 (단서·용의자·스포일러 차단)', schema: MYSTERY },
  business: { label: '경영 — 가게 운영 (수요·매출·정산 자동화)', schema: BUSINESS },
  survival: { label: '생존 — 혹한의 정착지 (자원 고갈·정책 트레이드오프)', schema: SURVIVAL },
  politics: { label: '정치 — 지지율과 파벌 (세력 관리·법안 표결)', schema: POLITICS },
  romance: { label: '연애 — 관계 시뮬 (호감도·단계 전이·기억)', schema: ROMANCE },
  trpg: { label: 'TRPG — 주사위 판정 (상시 판정·능력 연동·이점)', schema: TRPG },
  vtuber: { label: '버튜버 — 방송 운영 (동접·화제성·번아웃·논란)', schema: VTUBER },
  smith: { label: '대장간 — 무쇠와 장부 (금고 잠금·단조 판정·주문 갈림길)', schema: SMITH },
  fleet: { label: '함대 — 편성과 출격 (편성 탭·정비창·시설 버튼)', schema: FLEET },
  delve: { label: '미궁 탐사 — 원정과 귀환 (탭 상태창·진형 판정·노획 도박)', schema: DELVE },
  zombie: { label: '아포칼립스 — 낮의 수색과 밤의 습격 (소음·감염 시한·은신처)', schema: ZOMBIE },
  idol: { label: '아이돌 프로듀스 — 스케줄과 무대 (달력 중심·유닛 편성·레슨 트리)', schema: IDOL },
};

module.exports = { TEMPLATES, IDOL, DELVE, ZOMBIE, BLANK, RPG, ESTATE, MYSTERY, BUSINESS, SURVIVAL, POLITICS, ROMANCE, TRPG, VTUBER, SMITH, FLEET };
