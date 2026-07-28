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
        ],
        notify: '레벨 업! 몸에 힘이 차오르며 상처가 아문다.',
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
    ],
    guide: '전투·획득·상실이 서사에 명시된 경우만 반영. 경험치는 전투/성취의 규모에 비례하게.',
  },
  promptState: {
    position: 'history_end',
    template: '[모험 기록 — Lv.{level} · {location}]\nHP {hp}/{max_hp} | MP {mp}/{max_mp} | EXP {exp}/{exp_need} | {gold}G\n장비: {weapon} / {armor}\n소지품: {inventory}\n상태: {condition}',
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
const ROMANCE = {
  simcore: '0.1',
  meta: { name: '연애 — 관계 시뮬', author: 'SimCore 템플릿' },
  vars: [
    { id: 'day', label: '경과', type: 'int', init: 1, min: 1, format: '{v}일차' },
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
  ],
  derived: [
    { id: 'closeness', label: '친밀도', expr: 'clamp(round(affection * 0.7 + count(memories) * 3), 0, 100)' },
  ],
  rules: {
    onTurn: [
      { set: 'day', expr: 'day + 1' },
      { set: 'tension', expr: 'max(tension - 3, 0)' },
      { set: 'jealousy', expr: 'max(jealousy - 2, 0)' },
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
  ],
  updater: {
    allow: [
      // 호감은 천천히 오르고 빨리 식는다 — maxGain보다 maxLoss를 크게 준다.
      { id: 'affection', maxGain: 8, maxLoss: 15 },
      { id: 'tension', maxDelta: 20 },
      { id: 'jealousy', maxDelta: 20 },
      { id: 'memories' }, { id: 'mood' }, { id: 'place', maxLength: 40 },
    ],
    guide: '기억(memories)에는 실제로 있었던 사건만 한 줄로 add하라. 호감도는 상대의 반응이 뚜렷할 때만 움직여라.',
  },
  promptState: {
    template: '[관계 현황 — {day}일차 · {stage}]\n'
      + '장소 {place} | 호감 {affection}/100 | 설렘 {tension} | 친밀 {closeness} | 상대 기분 {mood}'
      + '{jealousy >= 30 ? " | 질투 " + jealousy : ""}\n'
      + '함께한 기억: {memories:tags}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '관계', items: [
        { var: 'day' }, { var: 'stage' },
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
  setup: {
    presets: [
      { id: 'classmate', label: '같은 반 친구', set: { stage: '지인', affection: 20, place: '교실' } },
      { id: 'firstmeet', label: '초면', set: { stage: '타인', affection: 5, place: '거리' } },
      { id: 'reunion', label: '재회', set: { stage: '친구', affection: 40, place: '오랜만의 약속 장소' } },
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
//          ② 소모성 변수(이점 adv)는 굴림식이 읽고, 끄는 건 액션 effects에 두는 분업
//          ③ 이벤트에 check를 달면 "AI가 판정이 필요하다고 하면 시스템이 대신 굴리는" 배선이 된다
//          ④ 판정 결과는 변수가 아니라 시스템 기록(meta)이라 보조 AI가 뒤집을 방법이 없다
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
    { id: 'ck_str', label: '근력 판정', roll: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)',
      mod: 'str_mod', vs: 'dc',
      grades: [
        { when: 'roll == 20', label: '대성공', inject: '기대 이상의 성과다 — 극적으로 그려라.' },
        { when: 'roll == 1', label: '대실패', inject: '단순한 실패가 아니라 상황을 악화시키는 대실패로 그려라.' },
        { when: 'total >= vs', label: '성공' },
        { label: '실패' },
      ] },
    { id: 'ck_dex', label: '민첩 판정', roll: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)',
      mod: 'dex_mod', vs: 'dc',
      grades: [
        { when: 'roll == 20', label: '대성공', inject: '기대 이상의 성과다 — 극적으로 그려라.' },
        { when: 'roll == 1', label: '대실패', inject: '단순한 실패가 아니라 상황을 악화시키는 대실패로 그려라.' },
        { when: 'total >= vs', label: '성공' },
        { label: '실패' },
      ] },
    { id: 'ck_wit', label: '지력 판정', roll: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)',
      mod: 'wit_mod', vs: 'dc',
      grades: [
        { when: 'roll == 20', label: '대성공', inject: '기대 이상의 성과다 — 극적으로 그려라.' },
        { when: 'roll == 1', label: '대실패', inject: '단순한 실패가 아니라 상황을 악화시키는 대실패로 그려라.' },
        { when: 'total >= vs', label: '성공' },
        { label: '실패' },
      ] },
    { id: 'ck_cha', label: '매력 판정', roll: 'adv ? max(rand(1, 20), rand(1, 20)) : rand(1, 20)',
      mod: 'cha_mod', vs: 'dc',
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
      // (예전처럼 근력 기준으로 굴린다 — 결과 줄은 다음 전송에 통지로 합류한다)
      { id: 'do_roll', when: 'need_roll', check: 'ck_str',
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
    { id: 'check_str', label: '💪 근력 판정', mode: 'oneshot', check: 'ck_str',
      inject: '[행동] 힘으로 밀어붙인다.',
      effects: [{ set: 'adv', expr: '0' }] },
    { id: 'check_dex', label: '🤸 민첩 판정', mode: 'oneshot', check: 'ck_dex',
      inject: '[행동] 재빠르게 움직인다.',
      effects: [{ set: 'adv', expr: '0' }] },
    { id: 'check_wit', label: '🧠 지력 판정', mode: 'oneshot', check: 'ck_wit',
      inject: '[행동] 상황을 읽고 머리를 쓴다.',
      effects: [{ set: 'adv', expr: '0' }] },
    { id: 'check_cha', label: '💬 매력 판정', mode: 'oneshot', check: 'ck_cha',
      inject: '[행동] 말과 태도로 상대를 움직인다.',
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
      { id: 'dc', maxDelta: 8 }, { id: 'need_roll' },
      { id: 'hp', maxDelta: 10 }, { id: 'stamina', maxDelta: 3 },
      { id: 'conditions' },
    ],
    guide: '주사위 판정은 시스템이 굴린다 — 결과를 절대 정하지 마라. '
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
const SURVIVAL = {
  simcore: '0.1',
  meta: { name: '생존 — 혹한의 정착지', author: 'SimCore 템플릿' },
  vars: [
    { id: 'day', label: '경과', type: 'int', init: 1, min: 1, format: '{v}일차' },
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
      { set: 'day', expr: 'day + 1' },
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
      { id: 'survived', once: true, when: 'day >= 30 and not collapsed',
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
    template: '[정착지 — {day}일차]\n'
      + '외부 {temp}°C / 실내 {indoor}°C ({cold_grade}) | 난방 {heat} | 배급 {ration} | 단열 {shelter}\n'
      + '석탄 {coal} ({coal_left} 남음) | 식량 {food} ({food_left} 남음)\n'
      + '생존자 {people}명 (환자 {sick}) | 희망 {hope}/100 | 불만 {discontent}/100{collapsed ? " | ⚠ 통제 붕괴" : ""}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '기온', items: [
        { var: 'day' }, { var: 'temp' }, { var: 'indoor' }, { var: 'cold_grade' },
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
  vars: [
    { id: 'day', label: '경과', type: 'int', init: 1, min: 1, format: '{v}일차' },
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
      { set: 'day', expr: 'day + 1' },
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
    template: '[방송 현황 — {day}일차 · {tier} 채널 · {nickname}]\n'
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
        { var: 'day' }, { var: 'tier' }, { var: 'subs' }, { var: 'ccv' },
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
const DAILY = {
  simcore: '0.1',
  meta: { name: '일상 — 하루의 기록', author: 'SimCore 템플릿' },
  vars: [
    { id: 'day', label: '날짜', type: 'int', init: 1, min: 1, format: '{v}일차',
      desc: '[💤 하루를 마친다] 버튼으로만 넘어간다. AI는 못 건드린다.' },
    { id: 'time', label: '시간', type: 'enum', init: '아침', enum: ['새벽', '아침', '낮', '저녁', '밤'] },
    { id: 'weather', label: '날씨', type: 'enum', init: '맑음', enum: ['맑음', '흐림', '비', '눈', '바람'] },
    { id: 'place', label: '위치', type: 'text', init: '집', maxLength: 40 },
    { id: 'money', label: '소지금', type: 'int', init: 50000, min: 0, format: '{v}원' },
    { id: 'bag', label: '소지품', type: 'list', init: ['지갑', '휴대폰', '열쇠'],
      maxItems: 15, itemMaxLength: 30 },
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
    { id: 'late_hour', when: 'time == "밤" or time == "새벽"',
      text: '[상태] 늦은 시각({time})이다. 문을 닫은 가게, 인적이 드문 거리, 피로 같은 것을 고려하라.' },
    { id: 'broke', when: 'money < 5000',
      text: '[상태] 수중에 {money}원밖에 없다. 돈이 드는 선택은 부담스럽게 다뤄라.' },
  ],
  actions: [
    { id: 'pass_time', label: '🕐 시간을 보낸다', mode: 'oneshot',
      inject: '[플레이어 액션] 시간이 흘러 다음 때가 되었다.',
      effects: [{ set: 'time',
        expr: 'time == "새벽" ? "아침" : time == "아침" ? "낮" : time == "낮" ? "저녁" : time == "저녁" ? "밤" : "새벽"' }] },
    { id: 'end_day', label: '💤 하루를 마친다', mode: 'oneshot',
      inject: '[플레이어 액션] 하루를 마치고 잠자리에 든다. 다음 장면은 이튿날 아침부터 시작한다.',
      effects: [{ set: 'day', expr: 'day + 1' }, { set: 'time', expr: '"아침"' }] },
  ],
  updater: {
    model: 'aux',
    // day는 일부러 뺐다 — 날짜는 버튼으로만 넘어간다. AI에게 열어 두면 서사가 "며칠 뒤"라고
    // 흘리는 순간 날짜가 튀고, 그 뒤로는 며칠째인지 아무도 못 맞춘다.
    allow: [
      { id: 'time' },
      { id: 'weather' },
      { id: 'place', maxLength: 40 },
      { id: 'money', maxGain: 50000, maxLoss: 50000 },
      { id: 'bag' },
    ],
    guide: '서사에 실제로 나온 변화만 반영하라. 시간대는 장면이 분명히 넘어갔을 때만 옮기고, '
      + '"조금 뒤" 정도로는 옮기지 마라. 소지품은 손에 넣거나 잃은 것이 서술됐을 때만 add/remove 하라.',
  },
  promptState: {
    template: '[{day}일차 · {time} · {weather}]\n위치 {place} | 소지금 {money}원\n소지품: {bag:tags}',
    includeEvents: true,
  },
  statusUI: {
    mode: 'auto', collapsible: true,
    groups: [
      { label: '지금', items: [{ var: 'day' }, { var: 'time' }, { var: 'weather' }, { var: 'place' }] },
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
    presets: [
      { id: 'plain', label: '평범한 하루', set: {} },
      { id: 'weekend', label: '여유로운 주말', set: { time: '낮', place: '단골 카페', money: 120000, weather: '맑음' } },
      { id: 'tight', label: '빠듯한 월말', set: { money: 7000, weather: '비', place: '자취방' } },
    ],
    ai: {
      enabled: true,
      vars: ['time', 'weather', 'place', 'money', 'bag'],
      instruction: '[최초 설정 진행 중] 유저와 짧게 대화하며 오늘이 어떤 날인지 정하라. '
        + '어디서 시작하는지, 지금 몇 시쯤인지, 주머니 사정은 어떤지 정도면 충분하다. 길게 끌지 마라.',
      guide: '유저가 말한 것은 그대로 반영하고, 말하지 않은 것은 그 장면에 자연스러운 값으로 정하라. '
        + '소지품은 그 사람이 당연히 들고 다닐 만한 것 서너 개면 된다.',
    },
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
  trpg: { label: 'TRPG — 주사위 판정 (d20·능력보정·이점)', schema: TRPG },
  vtuber: { label: '버튜버 — 방송 운영 (동접·화제성·번아웃·논란)', schema: VTUBER },
};

module.exports = { TEMPLATES, BLANK, RPG, ESTATE, MYSTERY, BUSINESS, SURVIVAL, POLITICS, ROMANCE, TRPG, VTUBER };
