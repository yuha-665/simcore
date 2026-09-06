const __P = (...p) => require('path').resolve(__dirname, ...p);
// 아틀리에 레슬레리아나 — 채집·연금·경영 시뮬 P1 (docs/design-아틀리에.md)
//
// 원본 봇의 always-on 로어북(상태창 지시 740t + 인벤토리 운영 규칙 340t + npc 리스트 3,792t)과
// "AI가 매번 알아서 정하던 난이도"를 이 스키마 하나가 대체한다.
//
// 관통 원칙 — **매번 정하지 않는다**:
//   · 흔들리면 안 되는 난이도는 스키마에 박는다 (location enum → area_tier 파생)
//   · 스키마에 못 박는 것(레시피 이름은 무한)은 판단 기준표를 desc에 고정해 재량을 없앤다
//   · 돈은 계약액(결정적), 평판은 솜씨(판정) — 보조는 숫자를 옮겨 적을 뿐 짓지 않는다
//
// P1 범위: 변수·파생·판정·액션·시간·달력·설비·상태창·최초설정.
// P2(상점·게시판)·로어북 캐스트 맵 분할은 별도.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const { diagnose } = SC.require('diagnose');
const engine = SC.require('engine');
const { seededRng } = SC.require('rng');

// 중첩 3항을 괄호로 안전하게 — [[조건, 값], ...] + 마지막 기본값
const chain = (pairs, last) => pairs.reduceRight((acc, [c, v]) => `(${c} ? ${v} : ${acc})`, last);

// ══════════ 지형표 — 난이도는 여기서 한 번만 정해진다 ══════════
// 로어북 15(던전과 채집지)·58(지역별 소재 배치)이 고유명사가 아니라 **지형으로** 써 놨다.
// 그래서 enum도 지형·권역으로 잡는다 — 어느 계열에서 시작하든 그대로 쓰인다.
// 서사는 원하는 이름을 쓴다("잊혀진 평원 깊은 곳") — enum이 '숲'이면 그만이다.
const PLACES = [
  ['공방', 0], ['왕도', 0], ['별의 고치 카페', 0], ['왕도 뒷골목', 0], ['지방 도시', 0],
  ['왕도 주변 들판', 1], ['프리겐·시골', 1],
  ['숲', 2], ['꽃밭·초원', 2], ['강가·폭포', 2], ['해안', 2],
  ['습지·늪', 3], ['광산·동굴', 3],
  ['설산 능선', 4], ['사막', 4], ['유적·마나 이상 지대', 4],
  ['세계의 끝', 5],
];

// ══════════ 지도 탭 — 지형표에서 그대로 굽는다 (표와 어긋날 수 없다) ══════════
// 새 패널이 아니라 공방 패널의 대장 템플릿 탭 (얼헌 서울 지도와 같은 문법).
// 격(0~5)별 사다리에 지형을 놓고, 가 본 곳(areas)은 `{areas:tags:지형}` 필터로 제 칸에 꽂힌다 —
// 그래서 areas 항목은 "이름 (지형)" 꼴이어야 한다 (desc가 그렇게 시킨다).
const TIER_NAME = ['마을 · 채집 없음', '근교', '들과 물가', '땅속과 늪', '오지', '세계의 끝'];
const MAP_TEMPLATE = (() => {
  const rows = [];
  for (let t = 0; t <= 5; t++) {
    const cells = PLACES.filter(([, tier]) => tier === t).map(([p]) => t === 0
      ? `<span class="amap-town">${p}</span>`
      : `<div class="amap-cell"><div class="amap-pn">${p}</div>{areas:tags:${p}}</div>`).join('');
    rows.push(`<div class="amap-row amap-t${t}"><div class="amap-tier"><b>격 ${t}</b><span>${TIER_NAME[t]}</span></div>`
      + `<div class="amap-cells">${cells}</div></div>`);
  }
  return `
<div class="amap">
  <div class="amap-head">란타르나 채집 지도<span class="amap-now">지금 {location} · 격 {area_tier}</span></div>
  ${rows.join('\n  ')}
  <div class="amap-foot">채집 목표치 = 8 + 격×2 · 탐사는 격 2부터 · 가 본 곳은 "이름 (지형)"으로 적혀야 제 칸에 든다</div>
</div>
<style>
/* 게임 패널 바탕은 다크네이비다 — 양피지 갈색이 아니라 어두운 바탕 위의 밝은 글자로 */
.amap { font-family: Georgia, 'Nanum Myeongjo', serif; color: #ece2cc; }
.amap-head { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; font-size: 14px;
  letter-spacing: .06em; color: #f0c674; border-bottom: 1px solid rgba(240,198,116,.35); padding-bottom: 5px; margin-bottom: 8px; }
.amap-now { font-size: 12px; font-weight: 400; color: #ffe4a8; }
.amap-row { display: grid; grid-template-columns: 80px 1fr; gap: 8px; padding: 7px 0; border-bottom: 1px dashed rgba(240,198,116,.18); }
.amap-tier { display: flex; flex-direction: column; color: #f0c674; }
.amap-tier b { font-size: 13px; } .amap-tier span { font-size: 11px; color: #c9b58a; }
.amap-cells { display: flex; flex-wrap: wrap; gap: 6px; }
.amap-town { font-size: 12px; color: #e0d3b8; background: rgba(240,198,116,.10); border: 1px solid rgba(240,198,116,.22); border-radius: 6px; padding: 2px 8px; }
.amap-cell { min-width: 120px; flex: 1 1 120px; border: 1px solid rgba(240,198,116,.28); border-radius: 8px;
  padding: 6px 8px; background: rgba(240,198,116,.07); }
.amap-pn { font-size: 12.5px; font-weight: 700; color: #ffe4a8; margin-bottom: 3px; }
.amap-cell .sim-tag { display: block; width: fit-content; max-width: 100%; margin: 2px 0; font-size: 11.5px;
  background: rgba(240,198,116,.14); border: 1px solid rgba(240,198,116,.45); border-radius: 6px; padding: 1px 7px; color: #fff4dc; }
.amap-cell .sim-empty { font-size: 11px; color: #9a8c70; }
.amap-t3 .amap-cell { background: rgba(140,120,90,.16); border-color: rgba(200,170,120,.32); }
.amap-t4 .amap-cell { background: rgba(170,90,60,.16); border-color: rgba(230,140,100,.35); }
.amap-t4 .amap-pn { color: #ffc9a8; }
.amap-t5 .amap-cell { background: rgba(120,80,170,.18); border-color: rgba(190,150,240,.45); }
.amap-t5 .amap-pn { color: #e2ccff; }
.amap-foot { margin-top: 8px; font-size: 11px; color: #c9b58a; }
</style>`;
})();

// ══════════ 조합서 — 로어북 상세 항목(공격·회복·중간재·음식)을 도감으로 굽는다 ══════════
// 컬렉션 탭. 배운 것(recipes)은 has()로 해금, 필요 소재는 보관고(materials)에 있으면 밝게.
// ⚠ has()는 저장 문자열 완전일치 — recipes·materials desc가 "도감 이름 그대로, 수량·수식어 없이"를 시킨다.
// [이름, 서고 단수(0~5 — 이 단부터 배울 수 있다), 등급(synth_tier 어휘 — 판정 목표치), 효과 한 줄, 필요 소재]
// 서고 단수가 곧 진행 사다리다 (유저: "각 탭마다 서고 1~5단 올라가는 느낌") — 분야마다 0~5단에 항목이 깔린다.
// 도구 5종은 서고 1~5단 업그레이드 사슬 (앞 단계 도구가 재료). 로어북에 없는 것은 도구 사슬·요리 일부뿐.
const RECIPE_BOOK = {
  폭탄: [
    ['프람', 0, '기초', '불 폭탄 — 식물·짐승·얼음 장애물', ['연료', '화약', '불의 돌', '중화제 적']],
    ['유니백', 0, '기초', '초보용 투척물 — 소형 몬스터·교란', ['유니', '천', '화약']],
    ['레헤른', 1, '기초', '얼음 폭탄 — 불 속성 적·냉각 의뢰', ['맑은 물', '얼음 결정', '중화제 청']],
    ['크래프트', 1, '기초', '물리 폭발 — 갑옷 몬스터·바위 벽', ['화약', '금속 조각', '단단한 껍질']],
    ['연막탄', 1, '기초', '연기로 시야를 가린다 — 도주·교란', ['화약', '숯', '천']],
    ['도나 스톤', 2, '기초', '번개 돌 — 젖은 적·기계·골렘 마비', ['번개 돌', '광석', '중화제 황']],
    ['루프트', 2, '기초', '바람 폭탄 — 비행 몬스터·독가스 걷기', ['깃털', '바람 돌', '중화제 녹']],
    ['독병', 2, '기초', '던지는 독 — 서서히 약해진다', ['독액', '유리병', '중화제 녹']],
    ['테라 봄', 3, '고급', '대형 폭발 — 큰 몬스터·성벽·잔해', ['고급 화약', '희귀 광석', '폭발 촉매']],
    ['에이스 아이스 봄', 3, '고급', '강화 얼음 폭탄 — 화염 유적·용암 근처', ['고급 얼음 결정', '정제수', '중화제 청']],
    ['오메가 크래프트', 3, '고급', '강화 물리 폭발 — 갑옷 파괴', ['고급 화약', '고급 잉곳', '몬스터 껍질']],
    ['타우전트 블리츠', 4, '고급', '연쇄 번개 — 기계·골렘·무리 마비', ['번개 결정', '희귀 번개 광석', '전도 금속']],
    ['메테오 봄', 4, '고급', '하늘에서 돌을 부른다 — 보스 준비', ['희귀 광석', '별의 조각', '고급 화약']],
    ['글로브', 4, '고급', '별의 힘을 담은 구체 폭탄', ['보석', '고급 화약', '강력 촉매']],
    ['드라코 봄', 5, '비전', '용의 불 — 맹렬한 화염과 방어 약화', ['드래곤 비늘', '강력 화약', '불의 돌']],
    ['차원 폭탄', 5, '비전', '공간이 뒤틀리는 폭발 — 이야기가 허락할 때만', ['희귀 결정', '별의 조각', '고급 화약']],
    ['서리 폭탄', 3, '고급', '겨울 한정 — 서리 결정으로 빚는 냉기 폭탄', ['서리 결정', '화약', '중화제 청']],
  ],
  약품: [
    ['힐링 살브', 0, '기초', '바르는 약 — 베임·타박·화상', ['약초', '기름', '맑은 물', '밀랍']],
    ['약', 0, '기초', '마시는 약 — 기력·통증·잔병', ['약초', '맑은 물', '꿀', '중화제 적']],
    ['해독제', 1, '기초', '독·마비·수면·동상 해제', ['쓴 풀', '해독 버섯', '맑은 물']],
    ['의료 붕대', 1, '기초', '여행자용 붕대 — 기사·현장 노동자', ['천', '실', '힐링 살브']],
    ['상태 치료약', 1, '기초', '화상·동상·저림 같은 이상 상태', ['쓴 풀', '맑은 물', '중화제 청']],
    ['힐링 아로마', 2, '기초', '향으로 치유 — 무리·피로·불면', ['향기 꽃', '향나무 껍질', '기름']],
    ['영양제', 2, '기초', '허약한 사람·환자의 기운을 돋운다', ['활력 약초', '꿀', '우유']],
    ['힐링 클라우드', 3, '고급', '치유 안개 — 단체전 뒤·독가스', ['정제수', '향기 꽃', '약초', '중화제 청']],
    ['SP 메디슨', 3, '고급', '기력·집중 회복 — 전투 지구력', ['활력 약초', '꿀', '향신료', '정제수']],
    ['넥타르', 3, '고급', '강한 회복 — 중상·소생 근처', ['희귀 꽃', '정제수', '꿀', '정제 촉매']],
    ['엘릭서', 4, '비전', '고위 만능약 — 여러 병을 한 번에', ['희귀 약초', '정제수', '정령석', '현자의 소재']],
    ['생명의 컵', 4, '비전', '쓰러진 사람을 일으키는 응급약', ['성수', '넥타르', '희귀 꽃']],
    ['엔젤 파우더', 4, '비전', '기적의 가루 — 중상·탈진', ['희귀 꽃', '빛의 소재', '정제수']],
    ['드래곤즈 시크릿', 5, '비전', '용의 힘으로 극심한 피로를 걷는다', ['드래곤 비늘', '희귀 약초', '정제수']],
    ['홀리 챌리스', 5, '비전', '정화의 잔 — 저주·맹독·의식 치유', ['성수', '은', '순백 천', '생명의 꽃']],
    ['둔켈하이트 영약', 5, '비전', '전설의 꽃으로 빚는 약 — 대가 없이 죽음을 되돌리지 않는다', ['둔켈하이트', '넥타르', '정제수']],
    ['꽃맞이 향수', 1, '기초', '봄 한정 — 봄꽃 이슬로 빚는 향수, 꽃맞이제에 잘 팔린다', ['봄꽃 이슬', '일곱빛 꽃', '기름']],
    ['냉각 물약', 2, '기초', '여름 한정 — 얼음꽃과 만년설 물, 더위 먹은 사람에게', ['얼음꽃', '만년설 물', '중화제 청']],
  ],
  중간재: [
    ['중화제 적', 0, '기초', '붉은 안정제 — 불 계열 레시피의 바탕', ['맑은 물', '이름 모를 풀', '연료']],
    ['보충제', 0, '기초', '분야를 잇는 단순 재료 — 초보의 연습', ['이름 모를 풀', '맑은 물', '돌']],
    ['증류수', 0, '기초', '불순물 없는 물 — 약·중화제·엘릭서', ['맑은 물', '여과지']],
    ['중화제 청', 1, '기초', '푸른 안정제 — 물·얼음 계열의 바탕', ['맑은 물', '이름 모를 풀', '얼음 결정']],
    ['중화제 황', 1, '기초', '노란 안정제 — 번개·광물 계열의 바탕', ['맑은 물', '이름 모를 풀', '광석']],
    ['제텔', 1, '기초', '연금 종이 — 레시피·부적·도면', ['식물 섬유', '맑은 물', '풀 접착제']],
    ['화약', 1, '기초', '폭탄의 바탕 — 조심히 다룬다', ['연료', '유황', '숯']],
    ['중화제 녹', 2, '기초', '푸른빛 안정제 — 바람·식물 계열의 바탕', ['맑은 물', '이름 모를 풀', '깃털']],
    ['잉곳', 2, '기초', '가공 금속 — 도구·무기·부품', ['광석', '연료', '연마제']],
    ['클로스', 2, '기초', '가공 천 — 가방·붕대·천막', ['실', '식물 섬유', '털가죽']],
    ['연마제', 2, '기초', '갈고 닦는 가루 — 보석·금속·유리', ['모래', '돌가루', '조개껍질']],
    ['고급 잉곳', 3, '고급', '희귀 금속 — 고급 도구·갑옷', ['희귀 광석', '연료', '연마제', '내열 촉매']],
    ['고급 클로스', 3, '고급', '희귀 섬유 천 — 고급 장비', ['희귀 섬유', '몬스터 털', '염료']],
    ['고급 화약', 3, '고급', '고위 폭탄의 바탕', ['화약', '불의 모래', '초석']],
    ['마나 촉매', 4, '고급', '마나를 머금은 촉매 — 마법 도구의 심장', ['마나 결정', '정제수', '중화제 황']],
    ['현자의 촉매', 5, '비전', '비전 조합의 열쇠', ['현자의 소재', '마나 촉매', '별가루']],
    ['봄 이슬 증류수', 1, '기초', '봄 한정 — 봄꽃 이슬로 내린 물, 고급 약의 바탕', ['봄꽃 이슬', '여과지']],
  ],
  // 도구 — 로어북엔 이름만 있다. 5종 × (기본 + 서고 1~5단 업그레이드). 격 k 지형에 맞는 도구 = k단
  도구: [
    ['곡괭이', 0, '기초', '광석 채집 — 낫으론 캘 수 없다', ['잉곳', '목재', '가죽']],
    ['낫', 0, '기초', '약초·풀 채집', ['잉곳', '목재']],
    ['낚싯대', 0, '기초', '물가 채집 — 생선·조개', ['목재', '실', '갈고리']],
    ['채집망', 0, '기초', '벌레·작은 것·물속 채집', ['클로스', '목재', '실']],
    ['램프', 0, '기초', '동굴·밤 채집', ['잉곳', '기름', '유리']],
    ['튼튼한 곡괭이', 1, '기초', '격 1 광맥 — 날이 잘 안 나간다', ['곡괭이', '잉곳', '연마제']],
    ['튼튼한 낫', 1, '기초', '격 1 들판 — 질긴 풀도 벤다', ['낫', '잉곳', '연마제']],
    ['튼튼한 낚싯대', 1, '기초', '격 1 물가 — 큰 고기가 걸려도 안 부러진다', ['낚싯대', '목재', '가죽']],
    ['튼튼한 채집망', 1, '기초', '격 1 — 찢어지지 않는 그물', ['채집망', '클로스', '실']],
    ['튼튼한 램프', 1, '기초', '격 1 — 바람에 안 꺼진다', ['램프', '유리', '잉곳']],
    ['강철 곡괭이', 2, '기초', '격 2 — 단단한 암반', ['튼튼한 곡괭이', '잉곳', '숯']],
    ['강철 낫', 2, '기초', '격 2 — 덩굴·가시덤불', ['튼튼한 낫', '잉곳', '숯']],
    ['강철 낚싯대', 2, '기초', '격 2 — 급류·깊은 물', ['튼튼한 낚싯대', '잉곳', '실']],
    ['비단 채집망', 2, '기초', '격 2 — 여린 것도 상하지 않게', ['튼튼한 채집망', '고급 클로스', '실']],
    ['강철 램프', 2, '기초', '격 2 — 물속·젖은 동굴', ['튼튼한 램프', '잉곳', '기름']],
    ['마나 곡괭이', 3, '고급', '격 3 — 마나가 스민 광맥', ['강철 곡괭이', '마나 결정', '고급 잉곳']],
    ['마나 낫', 3, '고급', '격 3 — 마나 식물', ['강철 낫', '마나 결정', '고급 잉곳']],
    ['마나 낚싯대', 3, '고급', '격 3 — 마나가 흐르는 물', ['강철 낚싯대', '마나 결정', '고급 클로스']],
    ['마나 채집망', 3, '고급', '격 3 — 정령 곤충·마나 조각', ['비단 채집망', '마나 결정', '고급 클로스']],
    ['마나 램프', 3, '고급', '격 3 — 어둠 속 유적', ['강철 램프', '마나 결정', '유리']],
    ['별의 곡괭이', 4, '고급', '격 4 — 별의 조각이 박힌 오지 광맥', ['마나 곡괭이', '별가루', '고급 잉곳']],
    ['별의 낫', 4, '고급', '격 4 — 밤에만 피는 꽃', ['마나 낫', '별가루', '고급 잉곳']],
    ['별의 낚싯대', 4, '고급', '격 4 — 별빛 호수', ['마나 낚싯대', '별가루', '고급 클로스']],
    ['별의 채집망', 4, '고급', '격 4 — 요정·별가루', ['마나 채집망', '별가루', '고급 클로스']],
    ['별의 램프', 4, '고급', '격 4 — 스스로 빛나는 등', ['마나 램프', '별가루', '마나 촉매']],
    ['용린 곡괭이', 5, '비전', '격 5 — 세계의 끝 광맥', ['별의 곡괭이', '드래곤 비늘', '현자의 촉매']],
    ['용린 낫', 5, '비전', '격 5 — 둔켈하이트를 상하지 않게 벤다', ['별의 낫', '드래곤 비늘', '현자의 촉매']],
    ['용린 낚싯대', 5, '비전', '격 5 — 심연의 것을 낚는다', ['별의 낚싯대', '드래곤 비늘', '현자의 촉매']],
    ['용린 채집망', 5, '비전', '격 5 — 정령을 담는다', ['별의 채집망', '드래곤 비늘', '현자의 촉매']],
    ['용린 램프', 5, '비전', '격 5 — 극야를 밝힌다', ['별의 램프', '드래곤 하트', '현자의 촉매']],
    ['나침반', 2, '고급', '길 찾기 — 오지·유적', ['잉곳', '마나 결정', '유리']],
    ['다우징 로드', 3, '고급', '숨은 소재·수맥 찾기', ['목재', '정령석']],
    ['반딧불 램프', 2, '기초', '여름 한정 — 반딧불 풀을 넣은 등, 밤 채집이 밝다', ['램프', '반딧불 풀', '유리']],
  ],
  음식: [
    ['빵', 0, '기초', '기본 양식 — 카페·여행', ['밀가루', '맑은 물', '우유']],
    ['차', 0, '기초', '약초차 — 피로·손님 접대', ['약초', '맑은 물']],
    ['파이', 1, '기초', '따뜻한 장면의 단골', ['밀가루', '과일', '꿀']],
    ['쿠키', 1, '기초', '선물·카페 곁들이', ['밀가루', '꿀', '우유']],
    ['휴대식량', 1, '기초', '여행·던전용 보존식', ['밀가루', '말린 고기', '소금']],
    ['사탕', 2, '기초', '아이들·선물', ['설탕', '과일', '꿀']],
    ['잼', 2, '기초', '과일을 오래 — 빵·파이의 짝', ['과일', '설탕', '맑은 물']],
    ['보존식', 2, '기초', '고기를 오래 — 긴 원정', ['고기', '소금', '향신료']],
    ['애플 타르트', 3, '고급', '카페 간판 메뉴', ['밀가루', '사과', '꿀', '우유']],
    ['수프', 3, '고급', '여행 뒤 회복 — 온기', ['고기', '버섯', '향신료']],
    ['도시락', 3, '고급', '채집 나가기 전 한 끼 — 동행이 좋아한다', ['빵', '보존식', '과일']],
    ['벌꿀 술', 3, '고급', '축제·거래·환심', ['꿀', '맑은 물', '과일']],
    ['축제 과자', 4, '고급', '수확제·행사용 — 명성이 오른다', ['밀가루', '설탕', '별가루']],
    ['약초 스튜', 4, '고급', '먹는 약 — 환자·노인', ['약초', '고기', '우유']],
    ['로로나식 파이', 5, '비전', '아를란드 전설의 파이 — 먹은 사람이 웃는다', ['파이', '희귀 꽃', '꿀']],
    ['별빛 케이크', 5, '비전', '혜성의 밤에만 굽는 케이크', ['밀가루', '별가루', '우유']],
    ['수확제 잼', 1, '기초', '가을 한정 — 가을 열매로 조린 잼, 수확제 대목', ['가을 열매', '설탕', '꿀']],
    ['설화차', 2, '기초', '겨울 한정 — 설산의 설화를 우린 차, 몸이 녹는다', ['설화', '약초', '맑은 물']],
  ],
  비전: [
    ['마도 제텔', 4, '비전', '마법 도면 종이 — 고대 문헌 복원', ['제텔', '마법 페이지', '별가루']],
    ['정령석 정제', 4, '비전', '정령석의 잡티를 걷어 촉매로', ['정령석', '정제수', '마나 촉매']],
    ['현자의 돌', 5, '비전', '잊혀진 연금술의 정점', ['현자의 소재', '영원의 결정', '드래곤 하트']],
    ['에테르널 크리스탈', 5, '비전', '영원의 결정 — 고위 촉매', ['영원의 결정', '마나 결정', '별가루']],
    ['기적의 약', 5, '비전', '죽음 직전을 되돌리는 약 — 대가가 따른다', ['둔켈하이트', '엘릭서', '성수']],
    ['혜성석 촉매', 5, '비전', '백색 혜성의 흔적 — 세계의 끝으로 가는 열쇠', ['혜성석', '별가루', '현자의 촉매']],
    ['고대 파편 복원', 5, '비전', '극야의 연금당이 남긴 것을 읽어낸다', ['고대 파편', '마도 제텔', '마나 촉매']],
    ['연금 지팡이', 5, '비전', '연금술사의 상징 — 조합·채집 양쪽에 손이 간다', ['고급 잉곳', '현자의 촉매', '마나 결정']],
    ['혜성 가루 정제', 5, '비전', '세계의 끝 여름 한정 — 혜성석 가루를 정제한 촉매', ['혜성석 가루', '별가루', '현자의 촉매']],
  ],
};
const BOOK_ALL = Object.values(RECIPE_BOOK).flat();
const BOOK_CATS = Object.keys(RECIPE_BOOK);
// 서고 단수별 묶음 머리 — "이 단부터 열린다"가 곧 진행 사다리
const LIB_NAME = ['처음부터', '서고 1단', '서고 2단', '서고 3단', '서고 4단', '서고 5단'];
const BOOK_TEMPLATE = (() => {
  const q = (x) => `'${x}'`;
  const known = (list) => list.map(([n]) => `has(recipes,${q(n)})`).join(' + ');
  // 탭은 CSS만으로 — 라디오 + 라벨 + :checked ~ 페이지. 패널은 우리 화면이라 input이 살아남는다.
  // ⚠ 다시 그릴 때(상태 변화마다) 첫 탭으로 돌아온다 — 엔진이 템플릿 안 UI 상태를 기억하지 않는다.
  const radios = BOOK_CATS.map((c, i) => `<input type="radio" name="abk-{uid}" id="abk-{uid}-${i}" class="abk-r abk-r${i}"${i === 0 ? ' checked' : ''}>`).join('');
  const labels = BOOK_CATS.map((c, i) => `<label for="abk-{uid}-${i}" class="abk-tab">${c}<span>{${known(RECIPE_BOOK[c])}}/${RECIPE_BOOK[c].length}</span></label>`).join('');
  const pages = BOOK_CATS.map((c, i) => {
    const list = RECIPE_BOOK[c];
    const groups = [];
    for (let lv = 0; lv <= 5; lv++) {
      const inLv = list.filter(([, lib]) => lib === lv);
      if (!inLv.length) continue;
      const rows = inLv.map(([name, lib, tier, eff, mats]) => {
        const on = `has(recipes,${q(name)})`;
        const lock = lib > 0 ? `{${on} ? '' : (library < ${lib} ? '🔒 서고 ${lib}단' : '미습득')}` : `{${on} ? '' : '미습득'}`;
        const chips = mats.map((m) => `<i class="abk-m {has(materials,${q(m)}) ? 'have' : ''}">${m}</i>`).join('');
        return `<div class="abk-row {${on} ? 'on' : 'off'}" title="${eff} · 필요: ${mats.join(', ')}">`
          + `<span class="abk-ico">{${on} ? '✦' : '·'}</span>`
          + `<span class="abk-nm">${name}</span><span class="abk-tier abk-${tier}">${tier}</span>`
          + `<span class="abk-lock">${lock}</span>`
          + `<div class="abk-eff">${eff}</div><div class="abk-mats">${chips}</div></div>`;
      }).join('');
      groups.push(`<div class="abk-lv {library >= ${lv} ? 'open' : 'shut'}"><div class="abk-lh">${LIB_NAME[lv]}`
        + `<span>{${known(inLv)}}/${inLv.length}${lv > 0 ? ` · {library >= ${lv} ? '열림' : '🔒'}` : ''}</span></div>${rows}</div>`);
    }
    return `<div class="abk-page abk-p${i}">${groups.join('')}</div>`;
  }).join('\n  ');
  const css = BOOK_CATS.map((c, i) => `.abk .abk-r${i}:checked ~ .abk-tabs .abk-tab:nth-child(${i + 1}) { background: rgba(240,198,116,.22); color: #fff4dc; border-color: rgba(240,198,116,.6); }\n`
    + `.abk .abk-r${i}:checked ~ .abk-p${i} { display: block; }`).join('\n');
  return `
<div class="abk">
  ${radios}
  <div class="abk-head">조합서<span class="abk-prog">{${known(BOOK_ALL)}} / ${BOOK_ALL.length} · 서고 {library}단</span></div>
  <div class="abk-tabs">${labels}</div>
  ${pages}
  <div class="abk-foot">✦ 배운 것 · 밝은 소재는 보관고에 있는 것 · 묶음 머리의 서고 단부터 배울 수 있다 · 도감 밖 레시피는 목록에만 남는다</div>
</div>
<style>
.abk { font-family: Georgia, 'Nanum Myeongjo', serif; color: #ece2cc; }
.abk .abk-r { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.abk-head { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; font-size: 14px;
  letter-spacing: .06em; color: #f0c674; border-bottom: 1px solid rgba(240,198,116,.35); padding-bottom: 5px; margin-bottom: 8px; }
.abk-prog { font-size: 12px; font-weight: 400; color: #ffe4a8; }
.abk-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.abk-tab { cursor: pointer; font-size: 12px; padding: 3px 9px; border-radius: 999px; color: #c9b58a;
  border: 1px solid rgba(240,198,116,.25); background: rgba(240,198,116,.06); user-select: none; }
.abk-tab span { margin-left: 4px; font-size: 10.5px; opacity: .8; }
.abk-tab:hover { background: rgba(240,198,116,.14); }
.abk-page { display: none; }
${css}
.abk-lv { margin-bottom: 8px; border-left: 2px solid rgba(240,198,116,.35); padding-left: 8px; }
.abk-lv.shut { border-left-color: rgba(240,198,116,.12); }
.abk-lh { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: #ffe4a8; padding: 2px 0 4px; }
.abk-lv.shut .abk-lh { color: #9a8c70; }
.abk-lh span { font-weight: 400; color: #c9b58a; font-size: 11px; }
.abk-row { display: grid; grid-template-columns: 16px 1fr auto auto; column-gap: 6px; align-items: baseline;
  padding: 4px 6px; border-radius: 6px; margin: 2px 0; cursor: help; }
.abk-row.on { background: rgba(240,198,116,.10); border: 1px solid rgba(240,198,116,.30); }
.abk-row.off { opacity: .5; border: 1px solid transparent; }
.abk-row:hover { background: rgba(240,198,116,.16); opacity: 1; }
.abk-ico { color: #f0c674; font-size: 12px; }
.abk-nm { font-size: 12.5px; font-weight: 700; color: #fff4dc; }
.abk-tier { font-size: 10px; padding: 0 5px; border-radius: 4px; border: 1px solid rgba(240,198,116,.35); color: #c9b58a; }
.abk-고급 { border-color: rgba(230,140,100,.5); color: #ffc9a8; }
.abk-비전 { border-color: rgba(190,150,240,.5); color: #e2ccff; }
.abk-lock { font-size: 10.5px; color: #9a8c70; }
.abk-eff { grid-column: 2 / -1; font-size: 11px; color: #c9b58a; }
.abk-mats { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }
.abk-m { font-style: normal; font-size: 10.5px; padding: 0 6px; border-radius: 5px; color: #7f7360;
  border: 1px solid rgba(240,198,116,.18); background: rgba(0,0,0,.15); }
.abk-m.have { color: #fff4dc; border-color: rgba(240,198,116,.55); background: rgba(240,198,116,.16); }
.abk-foot { margin-top: 8px; font-size: 11px; color: #c9b58a; }
</style>`;
})();

// ══════════ 에셋 이름표 — 카드 "Image Command Instructions" 그대로 (소문자, 순서 유지) ══════════
const ASSET_FEMALE = ['reisalin', 'klaudia', 'lila', 'sophie', 'plachta', 'lydie', 'suelle', 'firis', 'resna', 'izana',
  'marlone', 'judith', 'cuderia', 'totooria', 'rorolina', 'viorate', 'mimi', 'wilbell', 'marion', 'merurulince',
  'piana', 'miruca', 'elmerulia', 'heidi', 'flocke', 'corneria', 'ilmeria', 'nio', 'odelia', 'shallotte',
  'shallistera', 'escha', 'nelke', 'lionela', 'yumia', 'patricia', 'isla', 'serri', 'liane', 'eva',
  'ayesha', 'elfir', 'pamela', 'tess', 'valeria'];
const ASSET_MALE = ['roman', 'logix', 'sterkenburg'];
const ASSET_PLAIN = ['antje', 'criselda', 'crow', 'geron', 'iksel', 'johanna', 'juna', 'keithgriff', 'lanze', 'lara',
  'oskar', 'puni', 'walther'];
const ASSET_STATUS = ['default', 'standing', 'angry', 'annoyed', 'aroused', 'blushing shyly', 'coughing', 'confused',
  'contemptuous', 'curious', 'crying with eyes closed', 'crying with eyes open', 'dazed', 'depressed', 'disappointed',
  'disgusted', 'embarrassed', 'flustered', 'fidgeting shyly', 'full-face blush', 'giggling', 'guilty', 'indifferent',
  'joyful', 'lovestruck', 'laughing', 'looking away shyly', 'nervous', 'proud', 'sad', 'scared', 'serious', 'shocked',
  'sleepy', 'smug', 'surprised', 'thinking', 'worried', 'comforted', 'childlike whining', 'excited', 'admiring',
  'sniggering', 'suspicious', 'relieved', 'lustful', 'seductive smiling', 'crazy smiling', 'playful winking',
  'evil smiling', 'smiling', 'pouting', 'nervous pouting', 'happy smiling', 'bored', 'determined', 'jealous',
  'pleading', 'exhausted', 'happy tears', 'forced smiling'];
const ASSET_NSFW = ['Cowgirl-Normal', 'Cowgirl-Hard', 'Cowgirl-Cum', 'Doggystyle-Normal', 'Doggystyle-Hard', 'Doggystyle-Cum',
  'Missionary-Normal', 'Missionary-Hard', 'Missionary-Cum', 'Handjob-Normal', 'Handjob-Hard', 'Handjob-Cum',
  'Blowjob-Normal', 'Blowjob-Hard', 'Blowjob-Cum', 'Paizuri-Normal', 'Paizuri-Hard', 'Paizuri-Cum',
  'Deep Kiss-Normal', 'Deep Kiss-Hard', 'Seduction-Normal', 'Seduction-Hard', 'Smelling penis',
  'Smelling penis masturbation', 'Smelling underwear masturbation', 'Lonely Masturbation', 'Masturbation-Cum',
  'after sex', 'cleanup fellatio', 'after fellatio', 'Breast massage'];

// ══════════ 특산표 — 지형 × 계절 (유저: "지역마다 계절·날씨에 따라 채집 가능한 특수 재료") ══════════
// 로어북엔 지역별 소재 배치만 있고 계절은 없다 → 계절·날씨 층은 창작. 한 표에서 (지형,계절) 지시문 48개와
// 날씨 지시문 6개가 나온다 — 활성은 한 번에 지형 1 + 날씨 1이라 토큰은 두 줄뿐. 이름은 계절 레시피와 짝.
const SEASONS = ['봄', '여름', '가을', '겨울'];
const SPECIALS = {
  '왕도 주변 들판': [['봄꽃 이슬', '민들레'], ['밀 이삭', '반딧불 풀'], ['가을 열매', '마른 풀'], ['겨울 뿌리', '서리 풀']],
  '프리겐·시골': [['사과꽃'], ['햇밀'], ['호박'], ['훈제용 향나무']],
  '숲': [['새순', '송진'], ['매미 허물', '숲 버섯'], ['도토리', '붉은 버섯'], ['겨우살이', '설목 껍질']],
  '꽃밭·초원': [['일곱빛 꽃', '벌꿀'], ['해바라기 씨', '나비 비늘'], ['들국화'], ['얼음꽃']],
  '강가·폭포': [['은어', '물이끼'], ['반딧불 조개', '여름 폭포수'], ['연어', '낙엽 물'], ['얼음 결정', '겨울 송어']],
  '해안': [['바다 유리', '봄 김'], ['진주조개', '산호 조각'], ['폭풍 유목'], ['겨울 소금', '서리 조개']],
  '습지·늪': [['늪 연꽃'], ['반딧불 이끼', '독개구리 점액'], ['늪 버섯', '검은 물'], ['얼어붙은 진흙']],
  '광산·동굴': [['푸른 광석'], ['불의 돌', '유황'], ['번개 돌'], ['서리 결정', '얼음 광석']],
  '설산 능선': [['설화'], ['만년설 물'], ['설산 약초'], ['영원의 결정 조각', '눈꽃 결정']],
  '사막': [['사막 장미'], ['불의 모래', '사막 선인장'], ['별의 모래'], ['밤 사막 이슬']],
  '유적·마나 이상 지대': [['마나 새싹'], ['마나 결정'], ['고대 파편'], ['별가루']],
  '세계의 끝': [['둔켈하이트 봉오리'], ['혜성석 가루'], ['드래곤 비늘'], ['영원의 결정']],
};
const WEATHER_SPECIALS = {
  '비': '이슬 버섯·빗물 — 비 온 뒤에만 돋는 것',
  '안개': '안개 이끼 — 안개 속 바위에만 낀다',
  '눈': '눈꽃 결정 — 눈이 그치기 전에 주워야 한다',
  '바람': '바람 돌·떨어진 깃털 — 바람이 실어다 준 것',
  '흐림': '그늘 버섯 — 해가 없는 날 그늘에서',
  '맑음': '햇빛 꽃 — 해가 쨍한 날 활짝 핀 것',
};

// ══════════ 축제표 — 로어북엔 이름 붙은 축제가 없다 ("축제 물품·노점·마을 축제"와 혜성 설정뿐) ══════════
// 그래서 계절·로어에서 지었다. 한 표에서 달력 표식 + 사흘 전 준비 지시문 + 당일 이벤트(연 1회)가 나온다.
// [id, 이름, 월, 일, 달력 note, 준비 지시문(D-3~D), 당일 통지, 당일 효과]
// ⚠ 일(dom)은 4 이상 — 준비 창(dom >= D-3)이 달을 넘지 않게. 한 달에 하나 — 래치가 year*100+month라서.
const FESTIVALS = [
  ['blossom', '꽃맞이제', 4, 7, '왕도 거리에 꽃을 건다 — 향·꽃 소재가 귀해진다',
    '꽃맞이제(4월 7일)가 다가온다. 왕도가 꽃과 향으로 단장한다 — 향기 꽃·기름·향나무 껍질을 찾는 사람이 늘고, 카페는 쿠키·도시락 주문이 밀린다.',
    '꽃맞이제 당일. 거리마다 꽃, 광장에 노점, 사람들이 손에 향낭을 들었다. 연금술사의 향과 과자가 팔리기 좋은 날이다.', null],
  ['starmarket', '한여름 별시장', 6, 21, '가장 긴 밤 — 광장에 밤장이 선다',
    '한여름 별시장(6월 21일)이 다가온다. 가장 긴 밤에 광장 밤장이 선다 — 램프·기름·얼음 폭탄(더위 식히기)·사탕이 잘 나가고, 뜨내기 상인이 희귀 소재를 들고 온다.',
    '한여름 별시장의 밤. 등불이 광장을 메우고 밤새 장이 선다. 진열대 앞에 사람이 끊이지 않는다.', null],
  ['founding', '왕도 건국제', 8, 8, '기사단 행진과 불꽃 — 협회 의뢰가 몰린다',
    '왕도 건국제(8월 8일)가 다가온다. 기사단 행진과 불꽃놀이 — 협회가 불꽃용 폭탄·의료 붕대·휴대식량을 대량 주문하고, 경비가 늘어 뒷골목은 조용해진다.',
    '왕도 건국제. 기사단이 행진하고 밤에는 불꽃이 오른다. 연금술이 "쓸모 있는 것"으로 보이기 좋은 자리다.', null],
  ['harvest', '수확제', 9, 15, '들판의 결실 — 카페 대목',
    '수확제(9월 15일)가 다가온다. 들판이 결실을 맺고 카페는 파이·잼·벌꿀 술 주문으로 대목이다 — 과일·꿀·밀가루가 소재 시장에 넘친다.',
    '수확제. 광장에 수확물이 쌓이고 파이 굽는 냄새가 난다. 별의 고치 카페가 하루 종일 붐빈다.', null],
  ['lantern', '첫눈 등불제', 11, 11, '첫눈을 기다리며 등을 건다 — 램프·기름 수요',
    '첫눈 등불제(11월 11일)가 다가온다. 집집이 등을 걸고 첫눈을 기다린다 — 램프·기름·약초차·약초 스튜를 찾는다. 추위에 앓는 사람이 늘어 약 의뢰도 는다.',
    '첫눈 등불제의 밤. 등불이 골목마다 흔들리고, 사람들이 첫눈을 기다리며 따뜻한 것을 찾는다.', null],
  ['comet', '혜성 관측일', 12, 24, '백색 혜성이 사라진 날 — 마나가 흔들린다',
    '혜성 관측일(12월 24일)이 다가온다. 백색 혜성이 사라진 날 — 학자·노인들이 옛 이야기를 꺼내고, 잊혀진 연금술을 묻는 사람이 생긴다. 밤하늘을 보러 오지로 나가는 이도 있다.',
    '혜성 관측일 밤. 혜성이 사라진 하늘을 사람들이 올려다본다 — 그리고 마나가 이상하게 출렁였다. 잊혀진 연금술의 흔적일지도 모른다.',
    [{ set: 'clues', expr: 'clues + 1' }]],
];

// ══════════ 분야표 — 로어북 38~48이 이미 갈라 놓은 그대로 ══════════
const CATS = [
  ['폭탄', 'sk_bomb', '폭탄·투척', '로어북 38·45 (프람·레헤른·크래프트·도나 스톤)'],
  ['약품', 'sk_med', '약품·회복', '로어북 39·46 (힐링 살브·네크타르·엘릭서)'],
  ['중간재', 'sk_mat', '중간재', '로어북 40·47 (중화제·체텔·클로스·잉곳·화약)'],
  ['도구', 'sk_tool', '도구·장비', '로어북 41·48 (곡괭이·낫·낚싯대·나침반)'],
  ['음식', 'sk_food', '음식·생활', '로어북 42 (파이·여행 식량·차·과자)'],
  ['비전', 'sk_arcane', '비전', '로어북 43 (현자의 돌·에테르널 크리스탈)'],
];

// 분야별 숙련 증가 — set은 변수 하나를 지목하므로 6줄을 깔고 조건으로 고른다
const skillGain = (n) => CATS.map(([label, id]) =>
  ({ set: id, expr: `synth_cat == '${label}' ? ${id} + ${n} : ${id}` }));

// ══════════ 캐스트 맵 — 로어북 144(always-on 3,792t)를 origin으로 쪼갠다 ══════════
// 손으로 옮기지 않고 **빌드 때 원본에서 잘라 굽는다** — 로어북이 바뀌면 여기가 먼저 깨진다.
// 인물 줄의 영/한/일 이름 병기를 그대로 살린다: 모델이 그 이름을 쓰면 개별 로어북 항목이 뜬다.
const LORE = JSON.parse(fs.readFileSync(__P('lorebook_export.json'), 'utf8')).data;
const npcEntry = LORE.find((e) => String(e.content || '').startsWith('<NPC List>'));
if (!npcEntry) { console.log('❗ 로어북에서 <NPC List> 항목을 못 찾았다 — 캐스트 맵을 구울 수 없다'); process.exit(1); }
const CAST = {};
npcEntry.content.split(/^### /m).slice(1).forEach((chunk) => {
  const nl = chunk.indexOf('\n');
  CAST[chunk.slice(0, nl).trim()] = chunk.slice(nl).replace(/<\/NPC List>/g, '').trim();
});
const cast = (section) => {
  if (!CAST[section]) { console.log(`❗ 캐스트 구간 '${section}'을 못 찾았다 — 로어북 144의 ### 머리글이 바뀌었다`); process.exit(1); }
  return CAST[section];
};

// origin은 "어느 세계냐"가 아니라 **"이 판의 동행이 어느 계열이냐"**다. 세계는 언제나 란타르나.
// 값 구성은 로어북 144가 스스로 묶어 놓은 구간을 그대로 따른다 (잘부르그·그람나트가 한 구간,
// 비밀·추억·기타가 한 구간) — 원본과 다르게 쪼개면 구울 때 어긋난다.
const ORIGIN_CAST = {
  '잘부르그·그람나트': 'Salburg / Gramnad Wanderers',
  아를란드: 'Arland Wanderers',
  황혼: 'Dusk Wanderers',
  신비: 'Mysterious Wanderers',
  '비밀·추억': 'Secret / Memories / Other Wanderers',
};
const ORIGINS = ['란타르나', ...Object.keys(ORIGIN_CAST)];

const CAST_HEAD = '아래 인물들은 각자의 일정·목표·관계·소속·아는 범위에 따라 자연스럽게 드나든다. '
  + '늘 전원이 무대에 있을 필요는 없다. 영어·한국어·일본어 이름을 상황에 맞게 그대로 써라.';

// ══════════════════ 스키마 ══════════════════
const S = {
  simcore: '0.1',
  meta: {
    name: '아틀리에 — 공방 경영',
    desc: '란타르나의 잊혀진 연금술. 채집하고, 조합하고, 의뢰를 받아 공방을 키운다.',
  },

  vars: [
    // ── 정체성: 최초설정(세션 0)이 첫 응답을 읽고 한 번 굳힌다. allow에 없다 ──
    { id: 'atelier_name', label: '공방 이름', type: 'text', init: '이름 없는 공방', maxLength: 40,
      cmd: '공방', desc: '첫 장면에서 정해진 공방의 이름. 한 번 정해지면 유지한다.' },
    { id: 'atelier_place', label: '공방 자리', type: 'text', init: '어느 뒷골목의 셋방', maxLength: 60,
      desc: '공방이 있는 곳 (왕도 뒷골목의 셋방, 자스키아의 이공간 아틀리에 …).' },
    { id: 'mentor', label: '스승', type: 'text', init: '없음', maxLength: 40,
      desc: '연금술을 가르쳐 준 사람. 없으면 "없음".' },
    { id: 'origin', label: '동행 계열', type: 'enum', enum: ORIGINS, init: '란타르나',
      desc: '첫 장면의 동행이 어느 아틀리에 계열인가. 세계는 언제나 란타르나다 — 이건 "누구와 시작했나"일 뿐.' },

    // ── 위치·시간 ──
    { id: 'location', label: '위치', type: 'enum', enum: PLACES.map(([p]) => p), init: '공방', cmd: '위치',
      desc: '지금 있는 곳의 **지형**. 고유명사가 아니라 이 중 하나를 고른다 — 서사는 원하는 이름으로 불러도 된다. '
        + '이동하면 반드시 갱신. 채집 난이도가 여기서 자동으로 나온다.' },
    { id: 'skip_day', label: '넘긴 날', type: 'int', init: 0, min: 0, max: 3650,
      desc: '이번 응답에서 지나간 **날 수**. 하루가 지났으면 1, "사흘 뒤"면 3, "한 달 뒤"면 30. 같은 날 안이면 0.' },
    { id: 'skip_min', label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 1440,
      desc: '그날 안에서 흐른 **분**. 대화 10~30, 이동 60~180, 반나절 240. 날이 바뀌었으면 skip_day를 쓴다.' },

    // ── 연금술사 ──
    { id: 'renown', label: '평판', type: 'int', init: 30, min: 1, max: 1000,
      desc: '세상이 나를 얼마나 믿는가. 의뢰를 완수하면 오르고, 실패·기한 초과로 내린다. 솜씨 자체는 분야 숙련이 따로 잰다.' },
    { id: 'stamina', label: '체력', type: 'int', init: 100, min: 0, max: 100, format: '{v}/100',
      desc: '컨디션. 채집·조합·이동·피격이 깎고 휴식·식사·수면이 올린다. 0이면 쓰러진다.' },
    { id: 'synth_cat', label: '조합 분야', type: 'enum', enum: CATS.map(([c]) => c), init: '약품', cmd: '분야',
      desc: '지금 만들려는 것이 어느 분야인가. ' + CATS.map(([c, , , src]) => `${c}=${src}`).join(' · ') },
    { id: 'synth_tier', label: '레시피 난이도', type: 'enum', enum: ['기초', '고급', '비전'], init: '기초', cmd: '난이도',
      desc: '만들려는 레시피의 격. **로어북 문단이 곧 등급이다** — "Common ~" 문단이면 기초, '
        + '"Advanced ~" 문단이면 고급, "희귀와 고위 연금술"이면 비전. 임의로 정하지 말고 그 아이템이 실린 문단을 따른다.' },
    ...CATS.map(([label, id, short]) => ({
      id, label: `${short} 숙련`, type: 'int', init: 0, min: 0, max: 100,
      desc: `${label} 분야를 얼마나 손에 익혔나. 조합할 때마다 시스템이 올린다.`,
    })),
    { id: 'last_quality', label: '직전 조합 품질', type: 'enum', enum: ['—', '걸작', '상품', '보통', '조잡', '실패'], init: '—',
      desc: '판정이 세운다. 직접 고치지 마라.' },
    { id: 'foe_tier', label: '상대의 격', type: 'int', init: 1, min: 1, max: 5,
      desc: '교전 상대의 격. 보통은 지금 지형의 격과 같다 — 푸니·작은 짐승 1, 늑대·유령 2, 골렘·강한 무리 3, 와이번·정예 4, 드래곤·강적 5.' },
    { id: 'foe_name', label: '상대', type: 'text', init: '상대', maxLength: 30,
      desc: '교전이 시작될 때 상대의 이름. 개전 시점에 굳는다.' },
    { id: 'bombs', label: '투척 아이템', type: 'int', init: 0, min: 0, max: 20, format: '{v}개',
      desc: '지금 던질 수 있는 폭탄류의 **개수**. 조합으로 늘고 던질 때마다 준다. 이름은 아이템 목록이 들고 간다.' },
    { id: 'clues', label: '단서', type: 'int', init: 0, min: 0, max: 99,
      desc: '잊혀진 연금술·백색 혜성의 실마리. 탐사 판정이 올린다 — 직접 고치지 마라.' },
    { id: 'quest_pay', label: '정산 대기', type: 'int', init: 0, min: 0, max: 15000,
      desc: '의뢰를 납품했을 때, **그 의뢰 항목에 박힌 숫자를 그대로 옮겨 적는다.** 새로 정하지 마라. '
        + '지급은 시스템이 하고 곧바로 0으로 돌아간다.' },
    { id: 'quest_n', label: '의뢰 수(기준)', type: 'int', init: 0, min: 0, max: 3 },
    { id: 'quest_lost', label: '만료된 의뢰', type: 'int', init: 0, min: 0, max: 3 },

    // ── 자원 ──
    { id: 'cole', label: '소지금', type: 'int', init: 300, min: 0, max: 99999999, format: '{v}콜',
      desc: '돈. 의뢰 보수·판매로 늘고 구매·숙박·수리로 준다. 의뢰 보수는 직접 더하지 말고 quest_pay를 쓴다.' },
    { id: 'materials', label: '소재', type: 'list', init: ['맑은 물', '이름 모를 풀'], maxItems: 99, itemMaxLength: 30,
      desc: '보유 소재. 채집·구매·선물로 늘고 조합·판매로 준다. 지금 있는 지형에서 날 만한 것만 (로어북 "지역별 소재 배치"). '
        + '**이름만** 적는다 — 수량·수식어 없이 ("약초", "약초 3개"·"신선한 약초" 금지). 같은 것이 여럿이면 한 항목. '
        + '보관고 용량(mat_cap)을 넘긴 만큼은 상한다 — "보관고가 넘친다" 통지가 오면 상한 것을 빼라. '
        + '씨앗·모종·미끼도 소재다 (상점에서 사면 여기로 온다). 씨앗을 심으면 여기서 빼고 field에 올린다; 낚시에 미끼를 쓰면 하나 뺀다.' },
    // 밭 — 씨앗 상사에서 산 씨앗을 심으면 "작물 @+익는날"로 여기 온다. 익는 날 (오늘)로 보이고, 지나면 시든다(expire)
    { id: 'field', label: '밭', type: 'list', init: [], maxItems: 10, itemMaxLength: 30,
      desc: '약초밭에 심은 것. **형식: "작물 @+익는날"** (예: "약초 @+3", "향기 꽃 @+5") — 씨앗 이름에서 "씨앗/모종"을 뗀 작물 이름으로. '
        + '익는 날: 조악·보통 씨앗 2~3일, 상등 4~5일, 희귀 7일 이상, 비료를 쓰면 하루 빠르게. 심을 때 씨앗은 materials에서 뺀다. '
        + '**(오늘)로 표시된 것은 익었다** — 거둬 materials에 작물 이름으로 올리고 여기서 저장 원문 그대로 remove. 밭 칸(field_cap)을 넘겨 심지 마라.' },
    { id: 'items', label: '아이템', type: 'list', init: [], maxItems: 20, itemMaxLength: 34,
      desc: '만들거나 얻은 완성품. 품질이 좋으면 이름에 얹는다 ("고품질 힐링 살브").' },
    { id: 'recipes', label: '레시피', type: 'list', init: ['중화제 적'], maxItems: 30, itemMaxLength: 30,
      desc: '배운 조합법. 배우지 않은 것은 만들 수 없다. **괄호 숫자는 배울 수 있는 서고(library) 단수** — 서고가 그보다 낮으면 올리지 마라 (없으면 처음부터). '
        + '**도감에 있는 것은 도감 이름 그대로** 적는다 (조합서와 짝을 맞춘다): '
        + Object.entries(RECIPE_BOOK).map(([c, l]) => `${c}=${l.map(([n, lib]) => n + (lib ? `(${lib})` : '')).join('/')}`).join(' · ')
        + '. 도감 밖 창작 레시피도 올릴 수 있다.' },
    { id: 'tools', label: '채집 도구', type: 'list', init: ['채집 바구니'], maxItems: 8, itemMaxLength: 24,
      desc: '가진 채집 도구 (곡괭이·낫·낚싯대·채집망·폭탄 망치…). 도구 수가 곧 채집 보정이다.' },
    { id: 'areas', label: '아는 채집지', type: 'list', init: ['왕도 근교 (왕도 주변 들판)'], maxItems: 12, itemMaxLength: 40,
      desc: '가 본 채집지. **"이름 (지형)" 꼴**로 적는다 — 지형은 위치 목록의 값 그대로 '
        + '(예: "잊혀진 평원 (왕도 주변 들판)", "버려진 갱도 (광산·동굴)"). 지형이 붙어야 지도의 제 칸에 들어간다. '
        + '난이도는 시스템이 지형에서 뽑는다.' },
    { id: 'quests', label: '수주 의뢰', type: 'list', init: [], maxItems: 3, itemMaxLength: 80,
      desc: '받은 의뢰. **최대 3개** — 꽉 차면 새 의뢰를 받지 마라. '
        + '형식: "의뢰인 · 내용 (등급) @+기한일 +보수". 보수는 반드시 맨 끝. 예) "별의 고치 카페 · 감기약 3병 (중급) @+5 +800". '
        + '납품·포기로 지울 때는 여기 적힌 원문 그대로 remove 한다.' },
    { id: 'allies', label: '동행', type: 'list', init: [], maxItems: 8, itemMaxLength: 24,
      desc: '지금 함께 다니거나 가깝게 지내는 사람들. 이름만 적는다 — 서신을 주고받을 수 있는 상대가 된다.' },
    { id: 'ally_notes', label: '사람 소식', type: 'list', init: [], maxItems: 12, itemMaxLength: 60,
      desc: '"이름 — 달라진 것" 꼴로 한 줄씩. 그 사람에게 생긴 변화만 적는다 '
        + '(예: "하이디 — 셋방 월세가 밀렸다", "이자나 — 기사 시험에 떨어졌다"). 서신을 쓸 때 근거가 된다.' },

    { id: 'weather', label: '날씨', type: 'enum', enum: ['맑음', '흐림', '비', '바람', '안개', '눈'], init: '맑음',
      desc: '장면의 날씨. 서사에 날씨가 나오면 따라 적는다 — 계절에 맞게 (봄·가을 비·바람, 여름 맑음·비, 겨울 눈·안개). 실내 장면이면 바깥 날씨를 유지한다.' },

    // ── 시세 (경영) — 날씨·외부 사건이 상점 값을 밀고 당긴다. 시스템 소유 (allow 밖), 랜덤 이벤트가 세우고 기한이 오면 평시 ──
    { id: 'market_state', label: '시세', type: 'enum', init: '평시',
      enum: ['평시', '약초 풍년', '약초 품귀', '광석 품귀', '상단 도착', '흉년', '축제 특수'] },
    { id: 'market_until', label: '시세 기한', type: 'int', init: 0, min: 0, max: 99999999 },

    // 수위 — 성애 이미지 팩의 게이트. 카드 규약(Image Command Instructions)이 NSFW를 지원하므로 기본 켬. /수위 0
    { id: 'nsfw_on', label: '수위', type: 'bool', init: true, cmd: '수위',
      desc: '성애 장면 이미지 허용. 유저가 /수위 로 끈다 — 보조는 손대지 않는다.' },

    // 축제 래치 — 연 1회 발화. year*100+month (한 달에 축제 하나)
    { id: 'fest_seen', label: '지난 축제', type: 'int', init: 0, min: 0, max: 99999999 },

    // ── 공방 설비: 편성표 탭이 관리한다. allow에 없다 ──
    { id: 'cauldron', label: '가마', type: 'int', init: 1, min: 1, max: 5, format: '{v}단' },
    { id: 'library', label: '서고', type: 'int', init: 0, min: 0, max: 5, format: '{v}단' },
    { id: 'storage', label: '보관고', type: 'int', init: 0, min: 0, max: 5, format: '{v}단' },
    { id: 'garden', label: '약초밭', type: 'int', init: 0, min: 0, max: 5, format: '{v}단' },
    // 🌙 하루 마무리가 밭의 단수를 여기 옮겨 적고, 조건 이벤트가 다음 아침 수확 장면으로 바꾼다.
    // (효과에는 조건이 없어 "밭이 있을 때만"을 직접 못 쓴다 — 래치가 그 조건이다)
    { id: 'harvest_due', label: '수확 대기', type: 'int', init: 0, min: 0, max: 5 },
    // ── 진열대 (경영) — 내놓은 물건이 며칠 안에 팔려 돈이 된다. 의뢰 기한과 같은 기계(@+N 굳힘 → expire) ──
    { id: 'display', label: '진열대', type: 'int', init: 0, min: 0, max: 5, format: '{v}단' },
    { id: 'shelf', label: '진열 상품', type: 'list', init: [], maxItems: 18, itemMaxLength: 40,
      desc: '진열대에 내놓은 상품. **형식: "이름 @+팔릴날 가격"** — 가격은 반드시 맨 끝 숫자, 상점 밴드 안에서 '
        + '(조악 5~60 · 보통 40~200 · 상등 150~800 · 희귀 800~5000). 팔릴 날: 기초 1~3일 · 고급 3~6일 · 비전 5~10일, '
        + '고품질이면 하루 빠르게, 평판 600 이상이면 하루 빠르게. 예) "힐링 살브 @+2 120". '
        + '진열은 items에서 빼서 여기로 옮긴다. **팔리는 것은 시스템이 한다 — 팔렸다고 여기서 지우지 마라.** '
        + '거둬들일 때만 저장 원문 그대로 remove 하고 items에 되돌린다. 진열 칸(shelf_cap)을 넘기면 거둬들여라.' },
    { id: 'shelf_prev', label: '진열 합계(전)', type: 'int', init: 0, min: 0, max: 99999999 },
    { id: 'shelf_sold', label: '오늘 매출', type: 'int', init: 0, min: 0, max: 99999999, format: '{v}콜' },
  ],

  derived: [
    // 로어북 149의 5단 구간 그대로 — 숫자 대응표 린트를 피해 문자열을 직접 반환한다
    { id: 'alch_tier', label: '연금 등급',
      expr: chain([['renown <= 150', "'견습'"], ['renown <= 350', "'기초'"],
        ['renown <= 600', "'중급'"], ['renown <= 800', "'상급'"]], "'명인'") },
    // 채집 난이도의 유일한 출처. 파생이라 AI도 규칙도 못 건드린다
    { id: 'area_tier', label: '지형의 격',
      expr: chain(PLACES.slice(0, -1).map(([p, t]) => [`location == '${p}'`, String(t)]),
        String(PLACES[PLACES.length - 1][1])) },
    { id: 'sk_now', label: '이 분야 숙련',
      expr: chain(CATS.slice(0, -1).map(([label, id]) => [`synth_cat == '${label}'`, id]),
        CATS[CATS.length - 1][1]) },
    { id: 'synth_vs', label: '조합 목표치',
      expr: chain([["synth_tier == '기초'", '10'], ["synth_tier == '고급'", '15']], '20') },
    { id: 'quest_slot', label: '남은 의뢰 칸', expr: '3 - count(quests)', format: '{v}칸' },
    // 보관고 = 용량. 목록 상한(maxItems)은 숫자만 받아 식이 안 되므로 파생 용량 + 넘침 이벤트로 만든다.
    // 널널하게 — 5단이면 목록 상한(99)과 같다 (유저 판정).
    { id: 'mat_cap', label: '보관 용량',
      expr: chain([['storage <= 0', '10'], ['storage == 1', '20'], ['storage == 2', '35'],
        ['storage == 3', '55'], ['storage == 4', '75']], '99'), format: '{v}칸' },
    { id: 'mat_n', label: '보관 중', expr: 'count(materials)', format: '{v}종' },
    // 진열대 = 칸 수. 0단은 창가 선반 3칸 — 사기 전에도 장사는 된다
    { id: 'shelf_cap', label: '진열 칸',
      expr: chain([['display <= 0', '3'], ['display == 1', '6'], ['display == 2', '9'],
        ['display == 3', '12'], ['display == 4', '15']], '18'), format: '{v}칸' },
    { id: 'shelf_n', label: '진열 중', expr: 'count(shelf)', format: '{v}개' },
    // 약초밭 = 밭 칸. 0단이면 심을 데가 없다 — 씨앗을 사기 전에 밭부터
    { id: 'field_cap', label: '밭 칸', expr: 'garden * 2', format: '{v}칸' },
    { id: 'field_n', label: '심은 것', expr: 'count(field)', format: '{v}개' },
    // 상점 when과 같은 표 — 버튼이 안 보이는 이유를 상태창이 말해 준다
    { id: 'shops_here', label: '여기 가게',
      expr: chain([["location == '왕도'", "'상점가·씨앗 상사·미끼 상점'"], ["location == '지방 도시'", "'상점가·씨앗 상사'"],
        ["location == '왕도 뒷골목'", "'뒷골목 거래처'"], ["location == '프리겐·시골'", "'씨앗 상사'"],
        ["location == '강가·폭포' or location == '해안'", "'미끼 상점'"]], "'없음 — 왕도로 가면 열린다'") },
    { id: 'year_no', label: '여정', expr: 'year - 1399', format: '{v}년차' },
  ],

  time: {
    start: '1400-04-01 08:00',   // 중세 판타지 감각 — 유저 지정 (1400년 4월)
    advance: 'explicit',
    calendar: 'gregorian',
    format: { date: 'YYYY년 M월 D일', clock: 'HH:mm' },
    weekdays: ['월', '화', '수', '목', '금', '토', '일'],
    seasons: ['봄', '여름', '가을', '겨울'],
    expose: ['date', 'clock', 'weekday', 'season', 'year', 'month', 'dom', 'elapsed'],
  },

  rules: {
    // 순서가 곧 설계다 — 만료가 먼저 떨어지고, 그 차이를 재고, 기준을 새로 잡는다.
    // applySets가 효과를 순차 적용하므로 뒤 효과가 앞 결과를 본다.
    onTurn: [
      // ⚠ expire 식은 만료 기준이자 **`@+N`을 굳히는 시계이자 화면 환산의 기준**이다 (셋이 같은 식).
      // 그래서 'elapsed - 2' 같은 유예 오프셋은 세 곳에서 똑같이 상쇄돼 아무 일도 안 한다 —
      // 유예를 두려면 시계를 갈라야 하는데 그런 통로가 없다. 그냥 정직하게 elapsed를 쓴다:
      // 기한 당일까지 살아 있고((오늘)로 보인다) 그 다음 날 떨어진다.
      { list: 'quests', expire: 'elapsed' },
      // 납품으로 빠진 것(quest_pay > 0)은 만료가 아니다 — 보조 델타는 5단계, 이 틱은 6단계라 이미 빠져 있다
      { set: 'quest_lost', expr: 'max(quest_n - count(quests) - (quest_pay > 0 ? 1 : 0), 0)' },
      { set: 'quest_n', expr: 'count(quests)' },
      // ── 진열대 정산: 합계를 적고 → 기한 온 것을 떨구고 → 줄어든 값이 곧 매출. 돈과 물건이 어긋날 수 없다 ──
      { list: 'field', expire: 'elapsed' },          // 익은 날(오늘)까지 살아 있고, 안 거두면 다음 날 시든다
      { set: 'market_state', expr: "market_state != '평시' and elapsed > market_until ? '평시' : market_state" },
      { set: 'shelf_prev', expr: 'sum(shelf)' },
      { list: 'shelf', expire: 'elapsed' },
      { set: 'shelf_sold', expr: 'max(shelf_prev - sum(shelf), 0)' },
      { set: 'cole', expr: 'cole + shelf_sold' },
    ],

    events: [
      // 정산은 이벤트여야 한다 — 액션 효과는 전송 단계(장면 전)라 보조가 적은 액수를 못 본다
      { id: 'quest_paid', when: 'quest_pay > 0',
        effects: [{ set: 'cole', expr: 'cole + quest_pay' }, { set: 'quest_pay', expr: '0' }],
        notify: '약속된 보수를 받았다. 장부가 맞았다.' },
      { id: 'quest_expired', when: 'quest_lost > 0',
        effects: [{ set: 'renown', expr: 'max(renown - 15 * quest_lost, 1)' }, { set: 'quest_lost', expr: '0' }],
        notify: '기한을 넘긴 의뢰가 취소됐다. 의뢰인이 남긴 말을 전해 들은 참이다 — 실망, 체념, 혹은 다음을 기약하는 한마디.' },
      // 보관고 넘침 — 용량을 넘기는 동안 매 턴 되풀이된다 (치울 때까지). 옛 랜덤 spoil을 대체.
      { id: 'overflow', when: 'mat_n > mat_cap',
        notify: '보관고가 넘친다 — 용량을 넘긴 만큼 소재가 상했다. 무엇이 못 쓰게 됐는지 서사가 정하고 넘친 수만큼 목록에서 빼라. 보관고를 늘리기 전엔 되풀이된다.' },
      // 아침 밭 확인 — 🌙가 harvest_due에 밭 단수를 적어 두면 다음 아침에 한 번. 심은 게 있을 때만
      { id: 'garden_harvest', when: 'harvest_due > 0 and count(field) > 0',
        effects: [{ set: 'harvest_due', expr: '0' }],
        notify: '아침, 밭에 나가 본다. 상태 블록의 밭 목록에서 (오늘)인 작물은 익었다 — 거둬 소재로 올리고 밭에서 빼라. 아직인 것은 자라는 모습만.' },
      { id: 'garden_idle', when: 'harvest_due > 0 and count(field) == 0',
        effects: [{ set: 'harvest_due', expr: '0' }] },
      { id: 'field_over', when: 'field_n > field_cap',
        notify: '밭이 좁다 — 칸을 넘겨 심은 것은 자라지 못한다. 넘친 만큼 뽑아 씨앗으로 되돌리거나 버려라.' },
      // 진열대 매출 — 액수는 상태 블록의 소지금 변화로 드러난다 (통지는 값을 못 싣는다)
      { id: 'shelf_sale', when: 'shelf_sold > 0',
        effects: [{ set: 'renown', expr: 'min(renown + 1, 1000)' }],
        notify: '진열대의 물건이 팔렸다 — 장부에 값이 들어왔다(소지금 변화만큼). 누가 무엇을 사 갔는지 한 줄로 그려라. 팔린 물건은 이미 진열에서 빠져 있다.' },
      { id: 'shelf_over', when: 'shelf_n > shelf_cap',
        notify: '진열대가 좁다 — 칸을 넘긴 물건은 팔리지 않고 자리만 차지한다. 넘친 만큼 거둬들여 아이템으로 되돌려라.' },
      // 축제 당일 — 표에서 굽는다. 래치가 같은 해 재발화를 막는다
      ...FESTIVALS.map(([id, , m, d, , , notify, effects]) => ({
        id: `fest_${id}`, when: `month == ${m} and dom == ${d} and fest_seen != year * 100 + ${m}`,
        effects: [{ set: 'fest_seen', expr: `year * 100 + ${m}` },
          { set: 'market_state', expr: "'축제 특수'" }, { set: 'market_until', expr: 'elapsed + 2' },   // 축제 이틀은 음식·완성품이 비싸게 팔린다
          ...(effects || [])], notify,
      })),
      { id: 'collapse', when: 'stamina <= 0',
        effects: [{ set: 'stamina', expr: '25' }, { set: 'location', expr: "'공방'" },
          { set: 'skip_min', expr: 'skip_min + 480' }],
        notify: '체력이 바닥나 쓰러졌다. 누군가 공방까지 데려다 놓았고, 반나절이 그대로 날아갔다.' },
      { id: 'first_name', when: 'renown >= 150', once: true,
        notify: '연금술사로서 이름이 조금씩 오르내리기 시작했다. 잊혀진 기술이 아니라 "쓸모 있는 것"으로 불리기 시작한 참이다.' },
      { id: 'known_name', when: 'renown >= 600', once: true,
        notify: '이제 왕도에서 이 공방의 이름을 모르는 사람이 드물다. 그만큼 성가신 눈길도 늘었다.' },
    ],

    randomEvents: {
      chancePerTurn: 0.22,
      table: [
        // ── 시세 사건 (v1.7.8 priceMul과 짝) — 날씨·계절이 조건, 기한은 며칠 ──
        { id: 'caravan', weight: 2, cooldown: 12, when: "area_tier == 0 and market_state == '평시'",
          effects: [{ set: 'market_state', expr: "'상단 도착'" }, { set: 'market_until', expr: 'elapsed + 5' }],
          notify: '큰 상단이 왕도에 들어왔다 — 닷새 동안 소재·도구·서적이 싸다. 상인들이 광장에 천막을 쳤다.' },
        { id: 'herb_glut', weight: 2, cooldown: 15, when: "weather == '비' and season != '겨울' and market_state == '평시'",
          effects: [{ set: 'market_state', expr: "'약초 풍년'" }, { set: 'market_until', expr: 'elapsed + 7' }],
          notify: '비가 흡족히 내려 약초가 지천이다 — 이레 동안 소재 값이 뚝 떨어졌다. 채집꾼들이 바구니째 들고 온다.' },
        { id: 'herb_short', weight: 2, cooldown: 15, when: "(season == '겨울' or weather == '눈') and market_state == '평시'",
          effects: [{ set: 'market_state', expr: "'약초 품귀'" }, { set: 'market_until', expr: 'elapsed + 7' }],
          notify: '추위에 들판이 말라 약초가 귀하다 — 이레 동안 소재 값이 올랐다. 약국 앞에 줄이 선다.' },
        { id: 'ore_short', weight: 1, cooldown: 20, when: "market_state == '평시'",
          effects: [{ set: 'market_state', expr: "'광석 품귀'" }, { set: 'market_until', expr: 'elapsed + 10' }],
          notify: '광산 갱도가 무너져 광석이 끊겼다 — 열흘 동안 광석·도구 값이 뛰고, 뒷골목이 광석을 비싸게 부른다.' },
        { id: 'famine', weight: 1, cooldown: 25, when: "(season == '가을' or season == '겨울') and market_state == '평시'",
          effects: [{ set: 'market_state', expr: "'흉년'" }, { set: 'market_until', expr: 'elapsed + 14' }],
          notify: '흉년이다 — 보름 동안 식재료 값이 치솟았다. 카페는 메뉴를 줄이고, 먹을 것 의뢰가 는다.' },
        { id: 'peddler', weight: 3, cooldown: 6, when: 'area_tier == 0',
          notify: '행상인이 공방 문을 두드렸다 — 흔치 않은 소재를 몇 가지 펼쳐 보인다.' },
        { id: 'puni', weight: 3, cooldown: 5, when: 'area_tier >= 1 and area_tier <= 2',
          notify: '푸니 떼가 길을 막고 통통거린다. 위험하진 않지만 성가시다.' },
        { id: 'squall', weight: 3, cooldown: 4, when: 'area_tier >= 1',
          notify: '날씨가 갑자기 돌아섰다. 채집을 접든지, 젖은 채로 계속하든지.' },
        { id: 'cafe_regular', weight: 2, cooldown: 7, when: 'area_tier == 0 and renown >= 100',
          notify: '카페 단골이 다급하게 부탁을 들고 왔다. 정식 의뢰는 아니지만 거절하기 어려운 부탁이다.' },
        { id: 'mana_flux', weight: 1, cooldown: 10, when: 'area_tier >= 3',
          effects: [{ set: 'clues', expr: 'clues + 1' }],
          notify: '마나가 이상하게 출렁였다. 잊혀진 연금술의 흔적일지도 모른다.' },
        { id: 'cauldron_trouble', weight: 2, cooldown: 9, when: "location == '공방' and cauldron <= 2",
          notify: '가마가 이상한 소리를 낸다. 손을 봐야 할 때다.' },
      ],
    },
  },

  directives: [
    { id: 'quest_board', when: 'count(quests) > 0',
      text: '수주 중인 의뢰: {quests} — 기한이 임박한 것은 의뢰인의 재촉·소문·초조함으로 드러내라. 남은 날짜를 직접 읊지 마라.' },
    { id: 'quest_full', when: 'count(quests) >= 3',
      text: '의뢰 수첩이 가득 찼다(3건). 새 의뢰가 들어오면 정중히 거절하거나 하나를 끝낸 뒤로 미루게 하라 — 받아 놓고 잊는 일은 없다.' },
    { id: 'field', when: 'area_tier >= 1',
      text: '지금은 {location}이다. 여기서 날 만한 소재·마주칠 만한 것만 등장시켜라. 격에 맞지 않는 희귀 소재를 흘리지 마라.' },
    { id: 'town', when: "area_tier == 0 and location != '공방'",
      text: '지금은 사람이 사는 곳이다. 채집이 아니라 사람·거래·의뢰·소문이 벌어지는 자리로 그려라.' },
    { id: 'workshop', when: 'true',
      text: '공방 설비는 서사에 실체가 있다 — 가마 {cauldron}단(3단 미만이면 비전 조합은 무리), 서고 {library}단(조합서의 묶음 머리에 적힌 단부터 배울 수 있다 — 대략 기초 0~2·고급 3~4·비전 5), '
        + '보관고 {mat_n}/{mat_cap}(넘치면 상한다), 약초밭 {garden}단(밭 2칸/단 — 심은 것이 익는 날 소재가 된다). '
        + '새 레시피를 배우는 장면은 서고 단수를 보고 미달이면 "아직 읽어낼 수 없다"로 막아라. 설비를 올리면 그 변화를 공방 풍경으로 보여라.' },
    { id: 'shelf_dir', when: 'count(shelf) > 0',
      text: '진열대에 물건이 나가 있다: {shelf} — 며칠 안에 팔릴지는 시스템이 정한다. 손님이 사 가는 장면을 지어내 돈을 더하지 마라; '
        + '"팔렸다" 통지가 왔을 때만 그 장면을 그린다. 진열대 앞을 기웃거리는 손님·흥정·구경은 자유다.' },
    // 축제 준비 창 — 사흘 전부터 당일까지. 표에서 굽는다
    ...FESTIVALS.map(([id, , m, d, , text]) => ({
      id: `prep_${id}`, when: `month == ${m} and dom >= ${d - 3} and dom <= ${d}`, text,
    })),
    { id: 'field_dir', when: 'count(field) > 0',
      text: '밭: {field} — (오늘)로 표시된 작물은 익었다: 거두면 소재가 된다. 지나면 시든다. 익는 날은 시스템이 센다 — 앞당겨 거두지 마라.' },
    { id: 'bait_dir', when: "(location == '강가·폭포' or location == '해안') and (has(materials,'지렁이 미끼') or has(materials,'반짝이 미끼') or has(materials,'향미끼') or has(materials,'마나 미끼'))",
      text: '미끼가 있다 — 낚시가 잘 된다(채집 판정 +3). 낚시를 하면 쓴 미끼 하나를 소재에서 빼라. 마나 미끼는 마나가 흐르는 물에서만 값을 한다.' },
    { id: 'market_dir', when: "market_state != '평시'",
      text: '시세가 평시가 아니다 — {market_state}. 상점 값이 그에 맞게 올라 있거나 내려 있다(값은 시스템이 정한다). 상인·손님·게시판이 그 얘기를 한다. 기한이 오면 저절로 평시로 돌아온다.' },
    // 특산 — (지형, 계절) 48개 중 한 번에 하나만 켜진다. 채집 만재 등급의 "하나는 이 자리에서만"과 맞물린다
    ...Object.entries(SPECIALS).flatMap(([place, bySeason]) => bySeason.map((names, si) => ({
      id: `sp_${Object.keys(SPECIALS).indexOf(place)}_${si}`,
      when: `location == '${place}' and season == '${SEASONS[si]}'`,
      text: `${SEASONS[si]}의 ${place} 특산: ${names.join('·')} — 이 계절에만 난다. 채집이 잘되면(만재·성과) 하나는 이것으로 하고, 소재 목록에 이 이름 그대로 올린다.`,
    }))),
    ...Object.entries(WEATHER_SPECIALS).map(([w, text], i) => ({
      id: `wsp_${i}`, when: `area_tier >= 1 and weather == '${w}'`,
      text: `날씨 특산(${w}): ${text}. 채집 장면에 한 줄 끼워 넣을 수 있다 — 얻으면 소재 목록에 그 이름으로.`,
    })),
    { id: 'tired', when: 'stamina <= 25',
      text: '몸이 무겁다. 손이 떨리고 집중이 흩어진다 — 무리한 조합이나 먼 길은 그 대가를 보여라.' },
    { id: 'broke', when: 'cole < 100',
      text: '주머니가 거의 비었다. 재료를 사는 것도, 끼니도 계산이 필요하다.' },
    { id: 'unknown_art', when: 'renown <= 150',
      text: '연금술은 이 나라에서 잊혀진 기술이다. 처음 보는 사람은 신기해하거나, 의심하거나, 무서워한다 — 당연하게 받아들이지 않는다.' },
    { id: 'trusted_art', when: 'renown >= 600',
      text: '이제 연금술은 "저 사람이 하는 것"으로 통한다. 도움을 청하는 사람도, 견제하는 눈도 함께 늘었다.' },
    { id: 'board_quest', when: "area_tier == 0 and count(quests) < 3",
      text: '게시판 「의뢰」 칸의 공고는 아직 수주한 것이 아니다 — 유저가 받겠다고 해야 수첩에 오른다. '
        + '오를 때는 공고에 적힌 보수와 기한을 그대로 옮긴다.' },
    // ── 캐스트 맵 (P3) — 로어북 144의 always-on 3,792t를 조건부로 쪼갠 것 ──
    // 코어는 늘, 적대 세력은 이야기가 거기까지 갔을 때, 이방인은 이 판의 계열만.
    { id: 'cast_core', when: 'true', text: `[란타르나의 사람들]\n${CAST_HEAD}\n\n${cast("Resna's Party / Lantarna Core")}` },
    { id: 'cast_shadow', when: 'renown >= 100 or clues >= 1',
      text: `[월영회 — 왕도의 그늘]\n${cast('Moonlight Society')}` },
    { id: 'cast_polar', when: 'clues >= 2 or renown >= 300',
      text: `[극야의 연금당 — 아직 그림자로만]\n${cast('Polar Night Alchemists')}` },
    ...Object.entries(ORIGIN_CAST).map(([o, section]) => ({
      id: `cast_${section.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}`,
      when: `origin == '${o}'`,
      text: `[이방인 — ${o} 계열]\n이 판의 동행이 이 계열이다. 다른 계열 인물은 이름이 직접 불릴 때만 등장한다.\n\n${cast(section)}`,
    })),
    { id: 'clue_trail', when: 'clues >= 3',
      text: '모아 둔 실마리가 하나의 그림을 향한다. 백색 혜성과 잊혀진 연금술의 조각을 조금씩, 답이 아니라 다음 질문의 형태로 흘려라.' },
  ],

  // keywords(v1.7.7) — 유저 글에 이 낱말이 있으면 버튼 없이 무장. "버튼 안 누르면 판정 없이 서사로만 지나간다"(실기)의 답.
  // 활용형으로 적는다 — 어간만 두면 "조합서"·"채집지" 같은 명사에 오발한다.
  actions: [
    { id: 'act_gather', label: '⛏ 채집', mode: 'oneshot', keywords: ['채집하', '채집한다', '캐러', '캔다', '뜯는다', '줍는다', '낚시한다', '낚시를'], check: 'gather',
      when: 'area_tier >= 1 and not fight_on',
      inject: '채집에 나선다. 얼마나 거뒀는지는 판정이 정한다.',
      effects: [{ set: 'skip_min', expr: 'skip_min + 240' }, { set: 'stamina', expr: 'stamina - 15' }] },
    { id: 'act_survey', label: '🔍 탐사', mode: 'oneshot', keywords: ['탐사하', '탐사한다', '조사하', '조사한다', '살펴본다'], check: 'survey',
      when: 'area_tier >= 2 and not fight_on',
      inject: '유적·이상 지대를 살핀다.',
      effects: [{ set: 'skip_min', expr: 'skip_min + 300' }, { set: 'stamina', expr: 'stamina - 20' }] },
    { id: 'act_synth', label: '🧪 조합', mode: 'oneshot', keywords: ['조합하', '조합한다', '조합을', '만든다', '만들어', '빚는다', '조제하'], check: 'synth', when: 'not fight_on',
      inject: '가마 앞에 선다. 재료를 넣고 마나를 흘린다.',
      effects: [{ set: 'skip_min', expr: 'skip_min + 180' }, { set: 'stamina', expr: 'stamina - 12' }] },
    { id: 'act_deliver', label: '📮 납품', mode: 'oneshot', keywords: ['납품하', '납품한다', '가져다준다', '전달하', '건네준다'], check: 'deliver',
      when: 'count(quests) > 0 and area_tier == 0 and not fight_on',
      inject: '완성한 물건을 들고 의뢰인을 찾아간다.',
      effects: [{ set: 'skip_min', expr: 'skip_min + 90' }] },
    { id: 'act_fight', label: '⚔ 교전', mode: 'oneshot', keywords: ['싸운다', '공격하', '공격한다', '던진다', '맞선다', '덤빈다'], check: 'battle',
      inject: '맞선다.' },
    { id: 'act_flee', label: '🏃 이탈', mode: 'oneshot', keywords: ['도망친다', '도망간다', '물러난다', '달아난다', '빠져나간다'], fightEnd: true, check: 'guard', when: 'fight_on',
      inject: '물러날 자리를 찾는다.' },
    // ── 이동 — 버튼이 곧 안내다: 상점은 when으로 열려서 위치를 안 옮기면 버튼조차 안 보인다 (실기 제보) ──
    { id: 'go_home', label: '🏠 공방으로', mode: 'oneshot', keywords: ['공방으로 돌아', '공방으로 간다', '공방에 돌아'], when: "location != '공방' and not fight_on",
      inject: '공방으로 돌아온다. 오는 길과 문을 열었을 때의 공방 풍경 한 줄.',
      effects: [{ set: 'location', expr: "'공방'" }, { set: 'skip_min', expr: 'skip_min + 60' }] },
    { id: 'go_town', label: '🏙 왕도로', mode: 'oneshot', keywords: ['왕도로 간다', '왕도로 나간다', '왕도로 향한다', '왕도에 간다'], when: "location != '왕도' and not fight_on",
      inject: '왕도로 향한다. 도착한 거리의 풍경 — 상점가·씨앗 상사·어시장 좌판·별의 고치 카페가 있는 곳이다. 살 것과 팔 것이 여기 있다.',
      effects: [{ set: 'location', expr: "'왕도'" }, { set: 'skip_min', expr: 'skip_min + 90' }, { set: 'stamina', expr: 'stamina - 3' }] },
    { id: 'go_shade', label: '🌑 뒷골목으로', mode: 'oneshot', keywords: ['뒷골목으로', '뒷골목에 간다'],
      when: "location != '왕도 뒷골목' and not fight_on and (renown >= 100 or clues >= 1)",
      inject: '왕도 뒷골목으로 든다 — 월영회의 그늘, 출처를 묻지 않는 거래처가 있는 곳. 낮에도 어둡다.',
      effects: [{ set: 'location', expr: "'왕도 뒷골목'" }, { set: 'skip_min', expr: 'skip_min + 60' }] },
    { id: 'go_field', label: '🌿 들판으로', mode: 'oneshot', keywords: ['들판으로', '들판에 간다', '근교로'], when: "location != '왕도 주변 들판' and not fight_on",
      inject: '왕도 근교 들판으로 나선다 — 약초·풀·꽃이 나는 곳, 푸니 정도가 어슬렁거린다. 더 깊이 갈지는 여기서 정한다.',
      effects: [{ set: 'location', expr: "'왕도 주변 들판'" }, { set: 'skip_min', expr: 'skip_min + 90' }, { set: 'stamina', expr: 'stamina - 5' }] },
    { id: 'go_river', label: '🌊 강가로', mode: 'oneshot', keywords: ['강가로', '강으로 간다', '폭포로'], when: "location != '강가·폭포' and not fight_on",
      inject: '강가로 나선다 — 물 소재와 낚시, 낚시꾼 오두막(미끼 상점)이 있는 곳. 미끼가 있으면 값을 한다.',
      effects: [{ set: 'location', expr: "'강가·폭포'" }, { set: 'skip_min', expr: 'skip_min + 120' }, { set: 'stamina', expr: 'stamina - 8' }] },
    { id: 'act_rest', label: '😴 휴식', mode: 'oneshot', keywords: ['쉰다', '휴식한다', '숨을 돌린다', '눕는다'], when: 'not fight_on',
      inject: '숨을 돌린다.',
      effects: [{ set: 'skip_min', expr: 'skip_min + 240' }, { set: 'stamina', expr: 'stamina + 35' }] },
    { id: 'act_day', label: '🌙 하루를 마친다', mode: 'oneshot', keywords: ['잠든다', '자러 간다', '하루를 마친다', '잠자리에'], dayClose: true, when: 'not fight_on',
      inject: '하루를 접는다. 다음 장면은 하루가 지난 뒤 — 시각은 문맥이 정한다.',
      effects: [{ set: 'skip_day', expr: 'skip_day + 1' }, { set: 'stamina', expr: 'stamina + 45' },
        { set: 'location', expr: "'공방'" }, { set: 'harvest_due', expr: 'garden' }] },
  ],

  checks: [
    { id: 'gather', label: '채집',
      roll: 'rand(1, 20)',
      mod: 'floor(renown / 100) + count(tools) + (stamina < 30 ? -3 : 0) + garden'
        + " + ((location == '강가·폭포' or location == '해안') and (has(materials,'지렁이 미끼') or has(materials,'반짝이 미끼') or has(materials,'향미끼') or has(materials,'마나 미끼')) ? 3 : 0)",
      vs: '8 + area_tier * 2',
      grades: [
        { when: 'total >= vs + 8', label: '만재',
          inject: '바구니가 넘친다. 이 지형에서 날 만한 소재를 **5종** 골라 서사에 명시하고 목록에 올려라. 그중 하나는 이 자리에서만 나는 것으로.' },
        { when: 'total >= vs', label: '성과',
          inject: '쓸 만큼 거뒀다. 이 지형에 맞는 소재를 **3종** 골라 명시하고 목록에 올려라.' },
        { when: 'total >= vs - 4', label: '빈손에 가깝다',
          inject: '별로 없다. 소재를 **1종**만 명시하고 목록에 올려라. 왜 없었는지도 한 줄.' },
        { label: '헛수고', effects: [{ set: 'stamina', expr: 'stamina - 5' }],
          inject: '허탕이다. 소재는 얻지 못했다 — 시간과 기운만 썼다. 아무것도 목록에 올리지 마라.' },
      ] },

    { id: 'survey', label: '탐사',
      roll: 'rand(1, 20)', mod: 'floor(renown / 80) + library',
      vs: '10 + area_tier * 2',
      grades: [
        { when: 'total >= vs + 7', label: '발견',
          effects: [{ set: 'clues', expr: 'clues + 1' }],
          inject: '찾아냈다. 잊혀진 연금술의 조각 — 답이 아니라 **다음 질문**의 형태로 내놓아라. 새 채집지를 알게 됐다면 지도에 올려라.' },
        { when: 'total >= vs', label: '흔적',
          inject: '흔적은 잡았다. 확신할 만한 것은 아니다 — 정황과 어긋난 조각 하나.' },
        { when: 'total >= vs - 5', label: '허탕',
          inject: '헛걸음이다. 발길을 돌릴 이유만 하나 생겼다.' },
        { label: '사고', effects: [{ set: 'stamina', expr: 'stamina - 15' }],
          inject: '무너지거나, 빠지거나, 잘못 건드렸다. 다치지는 않았지만 값을 치렀다.' },
      ] },

    { id: 'synth', label: '조합',
      roll: 'rand(1, 20)',
      // 분야 숙련(0~8) + 공방 도구(0~10) + 평판(0~6) — 설계 §4.3
      // 설비가 열쇠다 — 서고 없이 고급, 서고·가마 없이 비전은 주사위로 안 넘어간다 (설비 개편)
      mod: 'floor(sk_now / 12) + cauldron * 2 + floor(renown / 150) + (stamina < 30 ? -3 : 0)'
        + " + (location == '공방' ? 0 : -4)"
        + " + (synth_tier == '고급' and library < 3 ? -4 : 0)"
        + " + (synth_tier == '비전' and (library < 5 or cauldron < 3) ? -6 : 0)",
      vs: 'synth_vs',
      grades: [
        { when: 'total >= vs + 8', label: '걸작',
          effects: [{ set: 'last_quality', expr: "'걸작'" }, { set: 'renown', expr: 'renown + 6' }, ...skillGain(3)],
          inject: '가마가 맑게 울리고 빛이 갠다. 기대 이상이다 — 완성품 이름 앞에 "고품질"을 얹어 목록에 올리고, 무엇이 이렇게까지 잘 됐는지 재료로 설명하라.' },
        { when: 'total >= vs + 3', label: '상품',
          effects: [{ set: 'last_quality', expr: "'상품'" }, { set: 'renown', expr: 'renown + 3' }, ...skillGain(2)],
          inject: '잘 나왔다. 팔아도 부끄럽지 않은 물건이다. 목록에 올려라.' },
        { when: 'total >= vs', label: '보통',
          effects: [{ set: 'last_quality', expr: "'보통'" }, { set: 'renown', expr: 'renown + 1' }, ...skillGain(1)],
          inject: '쓸 만하게 됐다. 자랑할 것은 없지만 제 몫은 한다. 목록에 올려라.' },
        { when: 'total >= vs - 4', label: '조잡',
          effects: [{ set: 'last_quality', expr: "'조잡'" }, ...skillGain(1)],
          inject: '되긴 됐는데 어딘가 어설프다 — 색이 탁하거나, 냄새가 나거나, 오래 못 갈 물건. 이름 앞에 "조잡한"을 얹어 목록에 올려라.' },
        { label: '실패',
          effects: [{ set: 'last_quality', expr: "'실패'" }, { set: 'stamina', expr: 'stamina - 8' }, ...skillGain(1)],
          inject: '실패다. **아틀리에답게 희극으로 그려라** — 가마가 뻥 하고, 거품이 넘치고, 검댕을 뒤집어쓰고, 이상한 냄새가 나고, 쓸모없는 덩어리가 남는다. '
            + '쓴 소재는 목록에서 빼고 완성품은 올리지 마라. 위험한 레시피(비전)일 때만 진짜 사고로 그린다 — 그래도 죽거나 영구 손상은 없다.' },
      ] },

    { id: 'deliver', label: '납품',
      roll: 'rand(1, 20)', mod: 'floor(renown / 70) + floor(sk_now / 20)', vs: '12',
      grades: [
        { when: 'total >= vs + 6', label: '대만족',
          effects: [{ set: 'renown', expr: 'renown + 12' }],
          inject: '기대를 넘었다. 의뢰인이 고마움을 표현하는 방식을 보여라 — 다음 일감, 소개, 덤, 혹은 그냥 말 한마디.' },
        { when: 'total >= vs', label: '만족',
          effects: [{ set: 'renown', expr: 'renown + 6' }],
          inject: '약속대로 해냈다. 담백하게 마무리하라.' },
        { when: 'total >= vs - 5', label: '미흡',
          effects: [{ set: 'renown', expr: 'renown + 1' }],
          inject: '받아 주긴 했지만 아쉬움이 남는다. 의뢰인의 표정에 그게 비친다.' },
        { label: '불만', effects: [{ set: 'renown', expr: 'max(renown - 8, 1)' }],
          inject: '기대에 못 미쳤다. 보수는 약속대로 나가지만 신용에는 금이 간다.' },
      ] },

    { id: 'battle', label: '교전',
      roll: 'rand(1, 20)',
      mod: 'floor(renown / 80) + min(bombs, 3) + (stamina < 30 ? -3 : 0)',
      vs: '10 + foe_tier * 2',
      fight: {
        gauge: '25 + foe_tier * 20',
        reply: 'guard',
        foe: '{foe_name}',
        idleTurns: 8,
        rule: '연금술사의 싸움이다 — 검이 아니라 준비한 물건과 지형으로 푼다. 던진 폭탄은 개수에서 뺀다.',
        win: {
          effects: [{ set: 'renown', expr: 'renown + 5' }],
          inject: '결착이다. 쓰러뜨렸거나 물러가게 했다. 몬스터 소재를 얻었다면 무엇인지 명시하고 목록에 올려라.',
        },
        lose: { when: 'stamina <= 0',
          inject: '더는 버티지 못한다. 쓰러지거나, 누군가에게 끌려 나오거나 — 죽지는 않지만 값은 치른다.' },
        flavor: [
          '거리를 재며 첫 수를 고른다.',
          '준비해 온 것을 꺼내 든다.',
          '지형을 먼저 본다 — 발밑, 등 뒤, 물러날 곳.',
          '상대의 버릇을 한 박자 읽는다.',
          '숨을 고르고 손이 먼저 움직인다.',
        ],
      },
      grades: [
        { when: 'total >= vs + 8', label: '정확히 먹혔다', gain: 22,
          inject: '노린 곳에 정확히 들어갔다.' },
        { when: 'total >= vs', label: '통했다', gain: 14,
          inject: '유효타다. 상대가 흔들린다.' },
        { when: 'total >= vs - 4', label: '스쳤다', gain: 6,
          inject: '얕게 들어갔다. 판을 뒤집을 정도는 아니다.' },
        { label: '빗나갔다', gain: 0,
          inject: '헛손질이다. 그 틈이 그대로 상대 차례가 된다.' },
      ] },

    { id: 'guard', label: '대응',
      roll: 'rand(1, 20)', mod: 'floor(stamina / 20)', vs: '10 + foe_tier * 2',
      grades: [
        { when: 'total >= vs + 5', label: '회피', inject: '완전히 피했다.' },
        { when: 'total >= vs', label: '스침', effects: [{ set: 'stamina', expr: 'stamina - 6' }],
          inject: '스쳤다. 아프지만 움직일 수 있다.' },
        { when: 'total >= vs - 5', label: '피격', effects: [{ set: 'stamina', expr: 'stamina - 15' }],
          inject: '제대로 맞았다.' },
        { label: '직격', effects: [{ set: 'stamina', expr: 'stamina - 25' }],
          inject: '크게 당했다. 시야가 흔들린다.' },
      ] },
  ],

  suggest: { count: 3, guide: '공방 일과·채집·조합·의뢰·사람 만나기 중에서. 하나는 뜻밖의 것을 섞어라.' },

  updater: {
    contextTurns: 2,
    allow: [
      { id: 'location' },
      { id: 'synth_cat' }, { id: 'synth_tier' }, { id: 'weather' },
      { id: 'renown', maxGain: 20, maxLoss: 30 },
      { id: 'stamina', maxDelta: 40 },
      { id: 'cole', maxGain: 15000, maxLoss: 15000 },
      { id: 'bombs', maxDelta: 8 },
      { id: 'foe_tier', maxDelta: 4 }, { id: 'foe_name', maxLength: 30 },
      { id: 'quest_pay', maxGain: 15000 },
      { id: 'materials' }, { id: 'items' }, { id: 'recipes' }, { id: 'tools' }, { id: 'shelf' }, { id: 'field' },
      { id: 'areas' }, { id: 'quests' }, { id: 'allies' },
      { id: 'skip_day', maxGain: 3650 }, { id: 'skip_min', maxGain: 1440 },
    ],
    guide: [
      '의뢰 보수는 위험과 품에 맞춘다 — 심부름·간단한 채집 50~200 / 기초 약품·흔한 소재 150~500 /',
      '평범한 필드 의뢰·호위·소규모 토벌 500~1,500 / 위험한 유적·희귀 소재·급한 약 1,500~5,000 /',
      '중대한 위협·정치적 사안 5,000~15,000. 사소한 일에 큰 돈을 매기지 마라.',
      '의뢰 보수는 cole에 직접 더하지 말고 quest_pay에 옮겨 적는다 — 지급은 시스템이 한다.',
      '소재·아이템은 서사에 실제로 나온 것만 올린다. 근거 없이 생기지 않는다.',
      '진열은 items에서 빼 shelf로 옮긴다("이름 @+팔릴날 가격"). 팔리는 것은 시스템이 하니 shelf에서 지우지 마라.',
    ].join(' '),
  },

  promptState: {
    template: [
      '지금: {date}({weekday}) {clock} · {season} · {weather} · 여정 {year_no}년차 · {location}',
      '공방 「{atelier_name}」 — {atelier_place} · 스승 {mentor}',
      // 상태 블록은 변수 format을 안 입힌다 — 단위는 여기 직접 쓴다
      '설비: 가마 {cauldron}단 · 서고 {library}단 · 보관고 {mat_n}/{mat_cap} · 약초밭 {garden}단',
      '평판 {renown}({alch_tier}) · 소지금 {cole} · 체력 {stamina} · 투척 {bombs}',
      '소재: {materials}',
      '아이템: {items} · 레시피: {recipes}',
      '진열대({shelf_n}/{shelf_cap}): {shelf}',
      '밭({field_n}/{field_cap}): {field}',
      '여기 가게: {shops_here} · 시세 {market_state}',
      '의뢰({quest_slot} 남음): {quests}',
      '도구: {tools} · 동행: {allies} · 단서 {clues} · 아는 채집지: {areas}',
      '숙련: 폭탄 {sk_bomb} · 약품 {sk_med} · 중간재 {sk_mat} · 도구 {sk_tool} · 음식 {sk_food} · 비전 {sk_arcane}',
    ].join('\n'),
    systemGuide: '수치·소지품·날짜는 시스템이 관리한다 — 임의로 지어내거나 되풀이해 적지 마라. '
      + '지금 이 자리에서 벌어지는 일을 끝까지 그리고 거기서 멈춰라. 장면을 넘길지는 유저가 정한다.',
  },

  statusUI: {
    mode: 'auto',
    layout: 'tabs',
    theme: 'parchment',
    changeLog: 'collapsed',
    groups: [
      // 날짜·시각·날씨·위치 — 유저 요청 ("상태창에 날짜 시간 날씨 현재 위치"). date/clock/weekday/season은 time.expose 이름
      { label: '지금', visibility: 'show', items: [
        { var: 'date' }, { var: 'weekday' }, { var: 'clock' }, { var: 'season' }, { var: 'weather' }, { var: 'location' },
        { var: 'shops_here' }, { var: 'market_state' },
      ] },
      { label: '공방', visibility: 'show', items: [
        { var: 'atelier_name' }, { var: 'atelier_place' }, { var: 'mentor' },
        { var: 'cauldron' }, { var: 'library' }, { var: 'garden' }, { var: 'display' },
        // 찬 정도 — 막대의 max가 설비 파생값. 값은 "12종", 막대가 용량 대비 비율 (bar.max는 식을 받는다)
        { var: 'storage' }, { var: 'mat_n', bar: { max: 'mat_cap' }, color: "'#b08968'" }, { var: 'mat_cap' },
        { var: 'shelf_n', bar: { max: 'shelf_cap' }, color: "'#c9a24a'" }, { var: 'shelf_cap' },
        { var: 'field_n', bar: { max: 'field_cap' }, color: "'#7fa87f'" }, { var: 'field_cap' },
      ] },
      { label: '연금술사', visibility: 'show', items: [
        { var: 'renown', bar: { max: 1000 }, color: "'#b08968'" },
        { var: 'alch_tier' },
        { var: 'stamina', bar: { max: 100 }, color: "'#7fa87f'" },
        ...CATS.map(([, id]) => ({ var: id, bar: { max: 100 } })),
      ] },
      { label: '소지', visibility: 'show', items: [
        { var: 'cole' }, { var: 'bombs' }, { var: 'materials' }, { var: 'items' }, { var: 'shelf' }, { var: 'field' },
        { var: 'recipes' }, { var: 'tools' },
      ] },
      { label: '여정', visibility: 'show', items: [
        { var: 'area_tier' }, { var: 'areas' },
        { var: 'allies' }, { var: 'clues' },
      ] },
      { label: '의뢰', visibility: 'show', items: [
        { var: 'quests' }, { var: 'quest_slot' },
      ] },
    ],
  },

  calendar: {
    label: '달력', icon: '📅', list: 'quests',
    marks: [
      { label: '장날', weekday: '토', note: '왕도 광장에 좌판이 선다' },
      { label: '별의 고치 정기시', dom: 1, note: '카페 앞에 의뢰가 몰린다' },
      ...FESTIVALS.map(([, label, month, dom, note]) => ({ label, month, dom, note })),
    ],
  },

  party: {
    label: '공방', icon: '🏠', nav: 'tabs',
    wide: true,   // 조합서 분야 탭 6개·지도 사다리 — 440px에선 탭이 두 줄로 꺾인다 (실기 제보, v1.7.6)
    tabs: [
      // ⚠ fab을 달지 않는다 — 탭이 하나뿐인데 fab을 달면 패널 버튼(🏠 공방)과
      // 탭 버튼(🏠 설비)이 같은 곳을 여는 버튼 두 개가 된다 (실기 제보).
      // fab은 탭이 여럿일 때 특정 탭으로 바로 가는 지름길이다.
      { id: 'facility', label: '설비', points: 'cole',
        items: [
          // note는 "다음 단에서 뭐가 달라지나"를 탭에서 바로 읽게 한다 — 보이지 않는 +N은 안 산다 (유저 제보)
          { var: 'cauldron', max: 5, cost: 'cauldron * 3000',
            note: '단마다 조합 +2 · 2단 이하면 가마 고장 소동 · 3단부터 비전 조합이 현실적 (서고 5단과 짝)',
            requires: 'cauldron < 3 or (cauldron < 4 and renown > 350) or renown > 600',
            requiresLabel: '4단은 중급, 5단은 상급 연금술사부터' },
          { var: 'library', max: 5, cost: '(library + 1) * 2000',
            note: '단마다 탐사 +1 · 단마다 조합서의 새 묶음이 열린다 (고급은 3단, 비전은 5단이 주력)',
            requires: 'library < 2 or (library < 4 and renown > 150) or renown > 350',
            requiresLabel: '3단은 기초, 5단은 중급 연금술사부터' },
          { var: 'storage', max: 5, cost: '(storage + 1) * 1500',
            note: '소재 용량 10 → 20 → 35 → 55 → 75 → 99 · 넘치면 상한다' },
          { var: 'garden', max: 5, cost: '(garden + 1) * 1800',
            note: '단마다 채집 +1 · 밭 2칸/단 — 씨앗 상사에서 씨앗을 사 심으면 익는 날 소재가 된다 (0단은 심을 데가 없다)',
            requires: 'garden < 3 or renown > 150', requiresLabel: '4단부터는 기초 연금술사부터' },
          { var: 'display', max: 5, cost: '(display + 1) * 2500',
            note: '진열 칸 3 → 6 → 9 → 12 → 15 → 18 · 내놓은 물건은 며칠 안에 팔려 돈이 된다 (하루를 넘길수록 장사가 된다)' },
        ] },
      // 지도 — 새 패널이 아니라 이 패널의 둘째 탭. fab은 달지 않는다 (버튼은 🏠 하나).
      { id: 'map', label: '지도', template: MAP_TEMPLATE },
      // 조합서 — 컬렉션. 도감은 생성기에 굽고, 해금은 recipes의 has()로, 소재 보유는 materials의 has()로 본다.
      { id: 'book', label: '조합서', template: BOOK_TEMPLATE },
    ],
  },

  // ══════════ P2 경영 — 상점 2곳 ══════════
  // 가격 감각은 로어북 150(경제와 보상 규칙)을 밴드로 옮긴 것. 어휘 밖 등급은 거부되고
  // 밴드 밖 가격은 클램프되므로, "AI가 지어낸 터무니없는 가격"이 구조적으로 안 나온다.
  shops: [
    {
      id: 'market', label: '왕도 상점가', icon: '🛒',
      currency: 'cole', buyTo: 'materials', sellFrom: 'items',
      categories: ['소재', '도구', '식재료', '서적'],
      grades: ['조악', '보통', '상등', '희귀', '전설'],
      bands: { 조악: [5, 60], 보통: [40, 200], 상등: [150, 800], 희귀: [800, 5000], 전설: [4000, 20000] },
      sellRate: 0.45, maxStock: 20, perCat: [3, 5],
      when: "location == '왕도' or location == '지방 도시'",
      // 시세 (v1.7.8) — 원가는 보조가 밴드 안에서, 배율은 시세 상태·날씨가. '*'는 매입(완성품 팔 때)
      priceMul: {
        '소재': "market_state == '약초 풍년' ? 0.6 : market_state == '약초 품귀' ? 1.6 : market_state == '광석 품귀' ? 1.4 : market_state == '상단 도착' ? 0.8 : 1",
        '도구': "market_state == '상단 도착' ? 0.8 : market_state == '광석 품귀' ? 1.3 : 1",
        '식재료': "market_state == '흉년' ? 1.8 : market_state == '축제 특수' ? 1.3 : weather == '눈' ? 1.2 : 1",
        '서적': "market_state == '상단 도착' ? 0.7 : 1",
        '*': "market_state == '축제 특수' ? 1.3 : market_state == '흉년' ? 0.9 : 1",
      },
      guide: '란타르나 왕도의 평범한 상점가. 연금술 전문점이 아니라 잡화·약재·철물·식료를 파는 가게들이다. '
        + '소재 칸은 흔한 약초·맑은 물·광석·꽃·조개 같은 것 (조악 5~60, 보통 40~200), 상등품은 상인이 어디선가 들여온 것. '
        + '도구 칸은 곡괭이·낫·낚싯대·채집망·나침반·램프 (보통 40~200, 상등 150~800). '
        + '식재료 칸은 밀가루·기름·꿀·우유·달걀·향신료. 서적 칸은 초본지·지도·옛 문헌 필사본 — 드물게 레시피 조각. '
        + '전설 등급은 거의 들어오지 않는다 — 들어온다면 왜 여기 있는지 note에 한 줄. '
        + '완성품은 사들이지만 정가를 다 쳐주지 않는다.',
    },
    {
      id: 'shade', label: '뒷골목 거래처', icon: '🌑',
      currency: 'cole', buyTo: 'materials', sellFrom: 'materials',
      categories: ['희귀 소재', '수상한 물건'],
      grades: ['상등', '희귀', '전설'],
      bands: { 상등: [300, 1200], 희귀: [1500, 8000], 전설: [6000, 30000] },
      sellRate: 0.65, maxStock: 8, perCat: [2, 4],
      when: "location == '왕도 뒷골목'",
      priceMul: { '*': "market_state == '광석 품귀' ? 1.5 : market_state == '상단 도착' ? 1.1 : 1" },   // 품귀엔 뒷골목이 웃는다
      guide: '월영회의 그늘에 있는 거래처. 정규 상점에 없는 것만 소량으로 놓인다 — 드래곤 소재 조각, '
        + '마석, 별의 파편, 던켈하이트 같은 것, 출처를 묻지 않는 물건. 값은 비싸고 흥정은 없다. '
        + '대신 무엇이든 사 준다 — 소재를 넘길 때 어디서 났는지 캐묻지 않는 것이 이곳의 값어치다. '
        + '진열은 적게(2~4개씩), 하나쯤은 note에 수상한 내력을 붙인다.',
    },
    // 씨앗 상사 — 약초밭(설비)의 입구. 산 씨앗은 소재로 오고, 심으면 field로 옮겨 익는 날 작물이 된다
    {
      id: 'seeds', label: '씨앗 상사', icon: '🌱',
      currency: 'cole', buyTo: 'materials',
      categories: ['씨앗', '모종', '비료'],
      grades: ['조악', '보통', '상등', '희귀'],
      bands: { 조악: [5, 30], 보통: [20, 80], 상등: [80, 300], 희귀: [400, 2000] },
      sellRate: 0.3, maxStock: 12, perCat: [2, 4],
      when: "location == '왕도' or location == '지방 도시' or location == '프리겐·시골'",
      priceMul: { '*': "market_state == '흉년' ? 1.4 : season == '봄' ? 0.8 : season == '겨울' ? 1.5 : 1" },   // 흉년이 계절보다 먼저 — 씨앗은 봄에 싸고 겨울에 귀하다
      guide: '농사꾼 상대 씨앗 가게 — 연금술사가 오는 건 드물어 신기해한다. 씨앗 칸은 "약초 씨앗"·"이름 모를 풀 씨앗"·"밀 씨앗"(조악·보통), '
        + '"향기 꽃 씨앗"·"활력 약초 씨앗"·"쓴 풀 씨앗"(상등), "희귀 꽃 씨앗"·"생명의 꽃 씨앗"(희귀). 모종 칸은 "사과 모종"·"과일 모종"·"향나무 모종". '
        + '비료 칸은 "비료"(보통)·"마나 비료"(상등, 익는 날 하루 단축). 이름은 반드시 "X 씨앗"/"X 모종" 꼴 — 심으면 X가 작물 이름이 된다. '
        + '계절에 맞는 씨앗이 앞에 온다 (봄 꽃·여름 과일·가을 밀·겨울엔 물건이 적다).',
    },
    // 미끼 상점 — 물가 채집(낚시)의 짝. 미끼가 있으면 물가 채집 +3, 쓰면 하나 빠진다
    {
      id: 'bait', label: '미끼 상점', icon: '🎣',
      currency: 'cole', buyTo: 'materials', sellFrom: 'materials',
      categories: ['미끼', '낚시 도구', '물고기'],
      grades: ['조악', '보통', '상등', '희귀'],
      bands: { 조악: [3, 20], 보통: [15, 60], 상등: [50, 200], 희귀: [300, 1500] },
      sellRate: 0.5, maxStock: 10, perCat: [2, 3],
      when: "location == '왕도' or location == '강가·폭포' or location == '해안'",
      priceMul: { '미끼': "weather == '비' ? 0.8 : 1", '물고기': "weather == '비' ? 0.7 : market_state == '축제 특수' ? 1.3 : 1", '*': "market_state == '축제 특수' ? 1.2 : 1" },   // 비 오면 미끼·생선이 싸다
      guide: '강가·해안의 낚시꾼 오두막, 왕도에선 어시장 구석 좌판. 미끼 칸은 정확히 이 이름으로 — "지렁이 미끼"(조악), "반짝이 미끼"(보통), '
        + '"향미끼"(상등), "마나 미끼"(희귀, 마나가 흐르는 물에서만). 낚시 도구 칸은 "갈고리"·"실"·"낚싯대"(보통). '
        + '물고기 칸은 그날 잡힌 것 — "생선"·"조개"·"진주"(희귀). 생선·조개는 사 주기도 한다(sellFrom). 주인은 말수가 적고 날씨 얘기만 한다.',
    },
  ],

  // ══════════ P2 경영 — 게시판 (의뢰판 + 연금술사들의 자리) ══════════
  // board는 단수 전용이라 카페 의뢰판과 "연금넷"을 한 판의 칸으로 나눈다.
  // 자율형 [2,3] — 반응형이면 매턴 주인공 서사가 박제돼 세계가 죽는다 (얼헌 v1.1.0 실사고).
  board: {
    label: '별의 고치 게시판', icon: '📋',
    topics: '카페 벽에 붙는 의뢰 공고, 왕도와 근교의 소문, 몬스터·길 사정 목격담, 소재 시세와 물물교환, '
      + '연금술 문의와 실패담, 분실물과 사람 찾기, 장날·축제 공지, 손님들의 잡담',
    guide: '란타르나 왕도, 별의 고치 카페 벽에 붙는 **손글씨 벽보**다. 인터넷이 아니다 — '
      + '줄임말·이모티콘·인터넷 밈·"ㅋㅋ" 금지. 존댓말과 반말이 섞이고, 서명은 이름이나 별명 '
      + '(밀밭집 둘째, 이름 없는 손님, S., 삼거리 대장간). 연금술은 이 나라에서 잊혀진 기술이라 '
      + '신기해하거나, 의심하거나, 사기라고 몰아붙이는 글이 섞인다. '
      + '"의뢰" 칸 글은 반드시 [의뢰인 · 무엇을 · 보수 · 기한] 넷을 담는다 — 보수는 심부름 50~200, '
      + '기초 약품 150~500, 필드 의뢰 500~1,500, 위험한 일 1,500~5,000, 중대사 5,000~15,000 콜. '
      + '"연금" 칸은 연금술을 아는 소수(약제사·학자·떠돌이 연금술사)가 서로 묻고 답하는 자리다 — '
      + '레시피 조각, 실패담, 소재 대체안, 옛 문헌 인용. 답을 다 주지 말고 다음 질문을 남겨라. '
      + '글이 다 진실일 필요는 없다 — 헛소문·과장·허풍도 게시판의 결이다. '
      + '주인공 이야기는 공개적으로 목격된 것만 오른다.',
    categories: ['의뢰', '소문', '연금', '거래', '잡담'],
    postsPerTurn: [2, 3], maxPosts: 20,
    hot: {
      label: '요즘 이야기', every: 5,
      guide: '카페 주인이 정리해 붙이는 소식지 한 편 (담백한 존댓말, 벽보 반말과 구분된다). '
        + '소재 로테이션: 왕실·백야의 기사 동향, 근교 몬스터 사정, 장날·축제, 어느 의뢰의 뒷이야기, '
        + '떠돌이 연금술사 목격담, 마나 이상 현상, 이방인 소문.',
    },
    when: 'area_tier == 0',
  },

  // ══════════ P3 — 이야기의 척추 ══════════
  // 캐논 타임라인(로어북 147)을 따라가지 않는다. 그건 참고 자료고 레일이 아니다.
  // 이 척추는 **유저 자신의 연금술 부흥**이라 어느 계열에서 시작하든 그대로 선다.
  // 해금은 renown(세상의 신용)과 clues(잊혀진 기술의 실마리)가 민다 — 모델의 눈치가 아니다.
  scenario: {
    label: '잊혀진 기술',
    acts: [
      { id: 'act1', label: '이름 없는 공방', intensity: '잠복',
        direct: '연금술은 잊힌 기술이다. 사람들은 그게 뭔지 모르거나, 사기라고 생각하거나, 옛이야기로 안다. '
          + '작은 일부터 시작하라 — 감기약, 망가진 도구, 밭을 망치는 벌레. 세상을 구하는 이야기가 아니다.' },
      { id: 'act2', label: '쓸모 있는 것', unlock: 'renown >= 150 or scn_turns >= 20', minTurns: 8,
        intensity: '전개',
        direct: '이제 몇몇은 안다 — "저 사람에게 부탁하면 된다". 의뢰가 이름을 타고 들어오기 시작한다. '
          + '아직 존경은 아니고, 편리함에 가깝다.',
        secret: '연금술을 반기지 않는 사람들이 있다. 아직은 뒷말 정도다.',
        notify: '문 두드리는 손이 늘었다. 이름을 대고 찾아오는 사람이 생겼다.' },
      { id: 'act3', label: '소문이 돈다', unlock: 'renown >= 350 or (clues >= 2 and scn_turns >= 15)', minTurns: 10,
        intensity: '전개',
        direct: '왕도에서 공방 이름이 오르내린다. 좋은 쪽으로도, 아닌 쪽으로도. '
          + '기사단·상인·카페 손님이 각자의 이유로 관심을 보인다.',
        secret: '월영회가 이 공방을 장부에 올렸다. 아직 손대지는 않았다.',
        notify: '모르는 사람이 공방 앞을 서성이다 갔다.' },
      { id: 'act4', label: '눈길', unlock: 'renown >= 600 or clues >= 4', minTurns: 10,
        intensity: '고조',
        direct: '이제 이 공방은 무시할 수 없는 것이 됐다. 도움을 청하는 손과 견제하는 눈이 같이 는다. '
          + '선택에 대가가 붙기 시작한다 — 누구 편을 드느냐가 남는다.',
        secret: '극야의 연금당은 연금술을 되살리려는 게 아니라 독점하려 한다. 그들에게 이 공방은 표본이거나 걸림돌이다.',
        notify: '피할 수 없는 자리에 불려 갔다.' },
      { id: 'act5', label: '혜성의 자취', unlock: 'clues >= 7 or renown >= 850', minTurns: 12,
        intensity: '절정',
        direct: '모은 조각이 하나를 가리킨다 — 백색 혜성이 왜 사라졌는가, 마나는 어디로 갔는가. '
          + '답을 통째로 내주지 마라. 확인할 때마다 값을 치르게 하라.',
        secret: '혜성은 사라진 것이 아니라 무언가에 쓰였다. 잊혀진 것은 기술이 아니라 그 대가다.',
        notify: '조각들이 맞물렸다. 이제 확인하러 갈 차례다.' },
    ],
  },

  // ══════════ P3 — 서신 (아틀리에엔 단말기가 없다) ══════════
  // 메신저 모듈을 편지 왕래로 쓴다. 방은 유저만 열고, AI는 방을 만들지도 없애지도 못한다.
  messenger: {
    label: '서신', icon: '✉',
    contactsVar: 'allies',
    notesVar: 'ally_notes',
    firstChance: 0.2, cooldown: 4,
    when: 'area_tier == 0',
    guide: '단말기가 아니라 **편지**다. 심부름꾼·행상인(플로케 같은)·카페 주인이 전해 준다. '
      + '한 통은 짧은 쪽지에서 한 문단까지 — 실시간 대화처럼 주고받지 마라. '
      + '줄임말·이모티콘 금지. 사람마다 글씨와 말투가 다르다: 이자나는 크고 급하게, '
      + '자스키아는 짧고 건조하게, 하이디는 용건보다 잡담이 길게, 플로케는 정중하고 꼼꼼하게. '
      + '급한 일은 편지로 오지 않는다 — 그건 사람이 직접 뛰어온다. '
      + '편지는 그 사람이 지금 아는 것까지만 담는다.',
  },

  // ══════════ P3 — 에셋 팩 (뼈대만, 꺼진 채로 출고) ══════════
  // ⚠ 카드에 실제로 실린 에셋 이름을 모르는 채로 켜면 조합이 전부 대조 실패해 **이미지 0장**(조용한 실패)이다.
  // 카드의 에셋 이름을 확인하고 who 값·sep·format을 맞춘 뒤 enabled: true로 켠다.
  // ══════════ 에셋 — 카드 "Image Command Instructions" 이식 (2026-09-06, 유저 제공) ══════════
  // 규약: <img="[name]_[Status]"> / <img="[name]_[NSFW Scene]"> · 이름은 소문자 영문 · 구분자 '_'.
  // 인물 셋: 여성 45(감정+성애) · 남성 3(감정만) · 기본 전용 13(default만). 유저 이미지는 내지 않는다.
  // by:'main' — 원본이 "등장·주목·발화마다 인물별 1장"이라 메인이 서사 자리에 여러 장을 낸다 (얼헌과 같은 결정).
  // verify:false — 이 환경은 에셋 이름 목록 대조가 안 된다 (얼헌과 같은 이유). 규약이 곧 실존.
  assets: {
    by: 'main',
    packs: [
      {
        id: 'emotion', source: '아틀리에 카드 Image Command Instructions — Status',
        sep: '_', format: '<img="{name}">', verify: false,
        usage: '인물이 등장·주목·발화할 때마다 대화문 앞 1장 — 이름_지금감정(영문 status). 인물마다 따로. 못 고르겠으면 이름_default. 주인공(유저) 이미지는 내지 않는다.',
        slots: [
          { id: 'who', label: '인물', values: [...ASSET_FEMALE, ...ASSET_MALE] },
          { id: 'status', label: '감정', values: ASSET_STATUS, fallback: 'default' },
        ],
      },
      {
        id: 'nsfw', source: '아틀리에 카드 Image Command Instructions — NSFW Scene',
        sep: '_', format: '<img="{name}">', verify: false,
        when: 'nsfw_on',   // /수위 0 이면 팩째 닫힌다
        usage: '성애 장면에서만 — 여성 인물 이름_장면(체위-국면). 남성·기본 전용 인물은 감정/기본 이미지만. 장면 밖에선 감정 팩을 쓴다.',
        slots: [
          { id: 'who', label: '인물', values: ASSET_FEMALE },
          { id: 'scene', label: '장면', values: ASSET_NSFW, fallback: 'after sex' },
        ],
      },
      {
        id: 'plain', source: '아틀리에 카드 Image Command Instructions — Default-Only',
        sep: '_', format: '<img="{name}">', verify: false,
        usage: '이 인물들은 기본 이미지 한 장뿐 — 등장할 때 이름_default. 감정·성애 접미사를 붙이지 않는다.',
        slots: [
          { id: 'who', label: '인물', values: ASSET_PLAIN },
          { id: 'status', label: '기본', values: ['default'], fallback: 'default' },
        ],
      },
    ],
  },

    setup: {
    presets: [
      { id: 'gentle', label: '따뜻한 여정 — 밑천이 있다', set: { cole: 1200, renown: 60, cauldron: 2 } },
      { id: 'standard', label: '보통 — 갓 물려받은 공방', set: {} },
      { id: 'harsh', label: '잊혀진 기술 — 맨손에서', set: { cole: 60, renown: 5 } },
    ],
    ai: {
      enabled: true,
      vars: ['atelier_name', 'atelier_place', 'mentor', 'origin', 'location', 'allies', 'recipes', 'tools', 'materials'],
      instruction: '[첫 장면] 지금 응답이 이 판의 시작이다. 앞의 도입부와 유저의 첫 입력을 근거로, '
        + '공방의 이름과 자리·스승·함께 있는 사람들을 장면 안에서 자연스럽게 확정하라. '
        + '목록으로 나열하거나 설정을 설명하지 말고, 장면으로 보여 준 뒤 거기서 멈춰라.',
      guide: 'origin은 함께 시작한 인물이 어느 아틀리에 계열인지로 고른다 (란타르나 본편 인물뿐이면 "란타르나"). '
        + 'location은 지형 목록에서 고르되 공방 안이면 "공방". 첫 장면에 나온 것만 적고, 안 나온 것은 기본값을 둔다.',
    },
  },

  rerollStableRng: true,
};

// ══════════════════ 검증 ══════════════════
const v = validateSchema(S);
console.log('검증:', v.ok ? '통과' : '실패');
for (const e of v.errors) console.log('  ✗', e.path, e.msg);
for (const w of v.warnings) console.log('  ⚠', w.path, w.msg);
if (!v.ok) process.exit(1);

const d = diagnose(S);
const dHigh = (d.issues || d || []).filter?.((i) => i.severity !== 'low') ?? [];
console.log('진단:', dHigh.length ? `지적 ${dHigh.length}건` : '깨끗');
for (const i of dHigh) console.log('  •', i.severity, i.title || i.msg, '—', (i.detail || '').slice(0, 140));

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ❗ ') + name + (cond ? '' : ` — ${extra}`));
  if (!cond) fails++;
};

const turn = (st, changes = {}, i = 0) => {
  const send = engine.sendPhase(S, st, { rng: seededRng('a', i, 's') });
  const out = engine.outputPhase(S, send.state, changes, {}, { rng: seededRng('a', i, 'o') });
  return { st: out.state, prompt: send.promptBlock, fired: out.firedEvents || [] };
};
const fresh = () => { const t = engine.initState(S); t.meta.setupDone = true; return t; };
const look = (st) => engine.makeLookup(S, st.vars);
const canAct = (st, id) => engine.actionAvailability(S, st, S.actions.find((a) => a.id === id)).ok;

console.log('\n━━ 지형 → 난이도 (파생이 유일 출처) ━━');
{
  const t = fresh();
  let allOk = true;
  for (const [place, tier] of PLACES) {
    t.vars.location = place;
    const got = look(t)('area_tier');
    if (got !== tier) { allOk = false; console.log(`    ${place}: ${got} ≠ ${tier}`); }
  }
  ok(`지형 ${PLACES.length}종 전부 표대로`, allOk, '');
  t.vars.location = '공방';
  ok('도시(격 0)에서 채집 버튼 잠김', !canAct(t, 'act_gather'), '');
  t.vars.location = '광산·동굴';
  ok('광산(격 3)에서 채집 열림', canAct(t, 'act_gather'), '');
  ok('광산 채집 목표치 = 8 + 3*2 = 14', look(t)('area_tier') === 3, '');
}

console.log('\n━━ 분야 숙련 (조합할 때 그 분야만 오른다) ━━');
{
  let t = fresh();
  t.vars.location = '공방';
  t.vars.synth_cat = '약품';
  t.vars.synth_tier = '기초';
  ok('기초 목표치 10', look(t)('synth_vs') === 10, String(look(t)('synth_vs')));
  t.vars.synth_tier = '비전';
  ok('비전 목표치 20', look(t)('synth_vs') === 20, String(look(t)('synth_vs')));
  t.vars.synth_tier = '기초';
  t.vars.cauldron = 5; t.vars.renown = 900;   // mod +16 → 기초(10)는 확실히 넘는다
  t = engine.toggleAction(S, t, 'act_synth').state;
  const r = turn(t, {}, 1);
  const after = r.st.vars;
  ok('약품 숙련만 올랐다', after.sk_med > 0 && after.sk_bomb === 0 && after.sk_arcane === 0,
    CATS.map(([, id]) => `${id}=${after[id]}`).join(' '));
  ok('품질이 기록됐다', after.last_quality !== '—', after.last_quality);
  ok('조합에 3시간 (skip_min 소비 → 시각 이동)', r.prompt.includes('11:00'), r.prompt.split('\n')[0]);
}

console.log('\n━━ 의뢰 — 3칸 상한 · 정산 · 만료 ━━');
{
  // ① 4번째는 조용히 잘린다 → 그래서 거절 지시문이 필요하다
  let t = fresh();
  ({ st: t } = turn(t, { changes: {} }, 10));
  ({ st: t } = turn(t, { quests: { add: ['A · 가 (하급) @+5 +200', 'B · 나 (하급) @+5 +300', 'C · 다 (중급) @+5 +800', 'D · 라 (상급) @+5 +2000'] } }, 11));
  ok('의뢰는 3개까지만 들어간다', t.vars.quests.length === 3, JSON.stringify(t.vars.quests));
  const dirs = engine.sendPhase(S, t, { rng: seededRng('a', 12, 's') }).promptBlock;
  ok('꽉 찼을 때 거절 지시문이 뜬다', dirs.includes('의뢰 수첩이 가득 찼다'), '');
  ok('기한이 (N일)로 환산돼 나간다', /\(\d+일\)/.test(dirs), dirs.split('\n').find((l) => l.includes('수주 중')) || '');

  // ② 납품 정산 — 보조는 숫자를 옮겨 적기만, 지급은 이벤트가.
  // remove는 **저장 원문 완전일치**라 굳은 기한(@5)으로 지운다 — 보조 계약표도 원문 그대로 보여 준다
  const stored = t.vars.quests.find((q) => q.startsWith('C ·'));
  ok('상대 기한이 절대값으로 굳었다', /@\d+/.test(stored), stored);
  t.vars.renown = 200;
  const before = t.vars.cole;
  ({ st: t } = turn(t, { quest_pay: 800, quests: { remove: [stored] } }, 13));
  ok('보수 800이 지급됐다', t.vars.cole === before + 800, `${before} → ${t.vars.cole}`);
  ok('정산 대기는 0으로 돌아갔다', t.vars.quest_pay === 0, String(t.vars.quest_pay));
  ok('납품은 만료로 세지 않는다 (평판 감점 없음)', t.vars.renown === 200, String(t.vars.renown));
  ok('남은 의뢰 2건', t.vars.quests.length === 2, JSON.stringify(t.vars.quests));

  // ③ 기한 당일까지는 살아 있다 — (오늘)로 보이는 마지막 하루
  const onDue = turn(t, { skip_day: 5 }, 14);
  ok('기한 당일에는 아직 목록에 있다', onDue.st.vars.quests.length === 2, JSON.stringify(onDue.st.vars.quests));
  const duePrompt = engine.sendPhase(S, onDue.st, { rng: seededRng('a', 15, 's') }).promptBlock;
  ok('기한 당일은 (오늘)로 보인다', duePrompt.includes('(오늘)'),
    duePrompt.split('\n').find((l) => l.includes('수주 중')) || '');

  // ④ 다음 날 떨어지면서 통지 + 평판 감점
  const rBefore = onDue.st.vars.renown;
  const r = turn(onDue.st, { skip_day: 1 }, 16);
  ok('기한이 지나면 만료된다', r.st.vars.quests.length === 0, JSON.stringify(r.st.vars.quests));
  ok('만료 2건만큼 평판이 깎였다', r.st.vars.renown === rBefore - 30, `${rBefore} → ${r.st.vars.renown}`);
  ok('만료 카운터는 스스로 0으로', r.st.vars.quest_lost === 0, String(r.st.vars.quest_lost));
  const nextPrompt = engine.sendPhase(S, r.st, { rng: seededRng('a', 17, 's') }).promptBlock;
  ok('만료 통지가 다음 전송에 실린다', nextPrompt.includes('기한을 넘긴 의뢰'), '');
}

console.log('\n━━ 시간 · 하루 넘김 ━━');
{
  let t = fresh();
  ok('시작은 1400년 4월 1일 08:00', look(t)('date') === '1400년 4월 1일' && look(t)('clock') === '08:00',
    `${look(t)('date')} ${look(t)('clock')}`);
  ok('여정 1년차', look(t)('year_no') === 1, String(look(t)('year_no')));
  // 상태창 "지금" 그룹 — 날짜·요일·시각·계절·날씨·위치
  {
    const html = SC.require('render').renderStatusHtml(S, t, null, null, { uid: 9 });
    ok('상태창에 날짜·시각·날씨·위치가 뜬다', html.includes('1400년 4월 1일') && html.includes('08:00') && html.includes('맑음') && html.includes('공방'),
      html.replace(/<[^>]+>/g, ' ').replace(/s+/g, ' ').slice(0, 200));
    ok('첫 그룹이 지금', S.statusUI.groups[0].label === '지금', S.statusUI.groups[0].label);
    ok('날씨는 보조가 적는다 (allow) · 어휘 밖은 거부', S.updater.allow.some((a) => a.id === 'weather')
      && turn(t, { weather: '비' }, 60).st.vars.weather === '비' && turn(t, { weather: '산성비' }, 61).st.vars.weather === '맑음', '');
    const p = engine.sendPhase(S, t, { rng: seededRng('a', 62, 's') }).promptBlock;
    ok('상태 블록 첫 줄에 날씨 · 여정 1년차', (p.split('\n').find((l) => l.startsWith('지금:')) ?? '').includes('맑음 · 여정 1년차'),
      p.split('\n').find((l) => l.startsWith('지금:')) ?? '');
  }
  // 버튼을 안 눌러도 서사가 하루를 넘기면 dayClose가 대신 돈다
  const r = turn(t, {}, 20);
  const st2 = engine.outputPhase(S, engine.sendPhase(S, r.st, { rng: seededRng('a', 21, 's') }).state,
    {}, {}, { rng: seededRng('a', 21, 'o'), dayPassed: true });
  ok('dayClose 대리 정산 — 날짜가 넘어간다', look(st2.state)('date') === '1400년 4월 3일' || look(st2.state)('date') === '1400년 4월 2일',
    look(st2.state)('date'));
  ok('대리 정산으로 체력도 회복', st2.state.vars.stamina >= 100, String(st2.state.vars.stamina));
  // 유저 주도 도약 — 캡이 없다
  const far = turn(fresh(), { skip_day: 90 }, 22);
  ok('90일 도약이 그대로 실린다', look(far.st)('elapsed') === 90, String(look(far.st)('elapsed')));
}

console.log('\n━━ 전투 — 결착은 게이지에서만 ━━');
{
  let t = fresh();
  t.vars.location = '숲'; t.vars.foe_tier = 2; t.vars.foe_name = '자그드 울프';
  t.vars.renown = 400; t.vars.bombs = 5;
  let rounds = 0, won = false;
  for (let i = 0; i < 12 && !won; i++) {
    t = engine.toggleAction(S, t, 'act_fight').state;
    const r = turn(t, {}, 30 + i);
    t = r.st; rounds++;
    if (r.prompt.includes('결착') || (t.vars.fight_gauge ?? 0) >= (t.vars.fight_max ?? 1)) won = true;
    if (!t.vars.fight_max) break;
  }
  ok('한 응답에 안 끝난다 (2라운드 이상)', rounds >= 2, `${rounds}라운드`);
  ok('게이지는 25 + 2*20 = 65로 굳었다', (t.vars.fight_max ?? 0) === 65 || won, String(t.vars.fight_max));
  // 이탈
  let f = fresh();
  f.vars.foe_tier = 1;
  f = engine.toggleAction(S, f, 'act_fight').state;
  f = turn(f, {}, 50).st;
  ok('교전 중 이탈 버튼이 열린다', canAct(f, 'act_flee'), '');
  ok('교전 중 채집 버튼은 잠긴다', !canAct(f, 'act_gather'), '');
}

console.log('\n━━ 최초설정 (세션 0) — 첫 응답이 공방을 정한다 ━━');
{
  const t0 = engine.initState(S);
  ok('첫 생성 응답이 설정 턴', engine.isSetupPending(S, t0), '');
  const mainPrompt = engine.sendPhase(S, t0, { rng: seededRng('a', 60, 's') }).promptBlock;
  ok('메인에 첫 장면 지시가 실린다', mainPrompt.includes('[첫 장면]'), '');
  ok('설정 턴엔 이야기 지시문이 안 붙는다', !mainPrompt.includes('연금술은 이 나라에서 잊혀진 기술'), '');
  const setupPrompt = engine.buildSetupPrompt(S, t0, '(첫 장면)');
  ok('설정 대상에 공방 이름·계열이 있다',
    setupPrompt.includes('atelier_name') && setupPrompt.includes('origin'), '');
  ok('설정 대상에 평판·소지금은 없다',
    !setupPrompt.includes('- renown') && !setupPrompt.includes('- cole'), '');
  const r = engine.setupPhase(S, t0, { atelier_name: '별빛 공방', origin: '신비', location: '공방' }, {});
  ok('첫 응답이 공방 이름을 굳혔다', r.state.vars.atelier_name === '별빛 공방', r.state.vars.atelier_name);
  ok('설정은 절대값이다 (델타 아님)', r.state.vars.origin === '신비', r.state.vars.origin);
  // 그 뒤로 보조는 손댈 수 없다
  const after = turn(r.state, { atelier_name: '엉뚱한 공방', origin: '비밀' }, 61);
  ok('보조는 공방 이름을 못 바꾼다', after.st.vars.atelier_name === '별빛 공방', after.st.vars.atelier_name);
  ok('보조는 계열도 못 바꾼다', after.st.vars.origin === '신비', after.st.vars.origin);
}

console.log('\n━━ 메인이 값을 받는 통로 ━━');
{
  const t = fresh();
  const p = engine.sendPhase(S, t, { rng: seededRng('a', 70, 's') }).promptBlock;
  ok('promptState.template이 실린다', p.includes('공방 「') && p.includes('평판 30'), '');
  ok('날짜·위치가 실린다', p.includes('4월 1일') && p.includes('공방'), '');
  ok('진행 폭 앵커가 끝자락에', p.includes('장면을 넘길지는 유저가 정한다'), '');
}

console.log('\n━━ 상태창 자리표시자 ━━');
{
  const t = fresh();
  const html = SC.require('render').renderStatusHtml(S, t, null, null, { uid: 7 });
  const leftover = (html.match(/\{[a-z_]+\}/g) || []).filter((m) => !m.includes(':'));
  ok('미치환 자리표시자 없음', leftover.length === 0, leftover.join(' '));
  ok('탭 레이아웃이 uid를 섞는다', html.includes('7'), '');
}

console.log('\n━━ 허용 경계 (잠근 것은 잠겨 있나) ━━');
{
  const t = fresh();
  const locked = ['cauldron', 'library', 'storage', 'garden', 'harvest_due', 'display', 'shelf_prev', 'shelf_sold', 'fest_seen', 'market_state', 'market_until', 'clues', 'last_quality',
    'quest_n', 'quest_lost', 'atelier_name', 'atelier_place', 'mentor', 'origin',
    ...CATS.map(([, id]) => id)];
  const allowed = new Set(S.updater.allow.map((a) => a.id));
  ok('설비·판정 산물·카운터·정체성은 allow 밖', locked.every((id) => !allowed.has(id)),
    locked.filter((id) => allowed.has(id)).join(' '));
  const r = turn(t, { cauldron: 4, clues: 9, sk_bomb: 50 }, 80);
  ok('보조가 설비를 못 올린다', r.st.vars.cauldron === 1, String(r.st.vars.cauldron));
  ok('보조가 단서를 못 올린다', r.st.vars.clues === 0, String(r.st.vars.clues));
  ok('보조가 숙련을 못 올린다', r.st.vars.sk_bomb === 0, String(r.st.vars.sk_bomb));
  const big = turn(t, { cole: 999999 }, 81);
  ok('수입 상한이 뇌절을 막는다', big.st.vars.cole === 300 + 15000, String(big.st.vars.cole));
}

console.log('\n━━ 설비 — 단이 오르면 세계가 바뀐다 (보이지 않는 +N은 안 산다) ━━');
{
  const party = SC.require('party');
  const expr = SC.require('expr');
  const tab = party.partyTabs(S).find((t) => t.id === 'facility');
  const item = (id) => tab.items.find((i) => i.var === id);
  ok('설비 4종 전부 설명(note)이 있다', tab.items.every((i) => typeof i.note === 'string' && i.note.length > 10), '');

  // 보관고 → 용량
  let t = fresh();
  ok('보관고 0단 용량 10', look(t)('mat_cap') === 10, String(look(t)('mat_cap')));
  t.vars.storage = 5;
  ok('보관고 5단 용량 99 = 목록 상한', look(t)('mat_cap') === 99 && S.vars.find((v) => v.id === 'materials').maxItems === 99, '');
  t.vars.storage = 0;
  t.vars.materials = Array.from({ length: 12 }, (_, i) => '소재' + i);
  let r = turn(t, {}, 200);
  ok('용량(10)을 넘기면 넘침 이벤트', r.fired.some((e) => (e.id ?? e) === 'overflow'), JSON.stringify(r.fired));
  const pOver = engine.sendPhase(S, r.st, { rng: seededRng('a', 201, 's') }).promptBlock;
  ok('다음 장면에 "보관고가 넘친다" 통지 + 상태 블록 12/10', pOver.includes('보관고가 넘친다') && pOver.includes('보관고 12/10'),
    pOver.split('\n').find((l) => l.includes('설비')) ?? '');
  t.vars.storage = 1;
  r = turn(t, {}, 202);
  ok('보관고를 올리면(20) 같은 짐도 안 넘친다', !r.fired.some((e) => (e.id ?? e) === 'overflow'), '');
  ok('옛 랜덤 spoil은 없다', !S.rules.randomEvents.table.some((e) => e.id === 'spoil'), '');

  // 약초밭 → 아침 수확
  t = fresh(); t.vars.garden = 2; t.vars.location = '공방';
  t = engine.toggleAction(S, t, 'act_day').state;
  r = turn(t, {}, 210);
  t.vars.field = ['약초 @+2'];
  r = turn(t, {}, 210);
  ok('🌙 하루 마무리 + 심은 게 있으면 아침 밭 확인 이벤트', r.fired.some((e) => (e.id ?? e) === 'garden_harvest'), JSON.stringify(r.fired));
  ok('래치는 되돌아간다', r.st.vars.harvest_due === 0, String(r.st.vars.harvest_due));
  const pMorn = engine.sendPhase(S, r.st, { rng: seededRng('a', 211, 's') }).promptBlock;
  ok('다음 아침에 밭 확인 지시가 실린다', pMorn.includes('밭에 나가 본다'), '');
  t = fresh(); t.vars.garden = 0; t.vars.location = '공방';
  t = engine.toggleAction(S, t, 'act_day').state;
  r = turn(t, {}, 212);
  ok('심은 게 없으면 밭 확인도 없다 (래치만 풀린다)', !r.fired.some((e) => (e.id ?? e) === 'garden_harvest') && r.st.vars.harvest_due === 0, '');

  // 서고·가마 → 등급 열쇠 (조합 보정)
  const synthMod = S.checks.find((c) => c.id === 'synth').mod;
  const modAt = (vars) => { const u = fresh(); Object.assign(u.vars, { location: '공방', stamina: 80, ...vars }); return Number(expr.evaluate(synthMod, look(u), null)); };
  ok('고급 레시피는 서고 3단 없이 -4', modAt({ synth_tier: '고급', library: 0 }) === modAt({ synth_tier: '고급', library: 3 }) - 4, '');
  ok('비전은 서고 5단·가마 3단 없이 -6 (가마 한 단 = +2 별도)',
    modAt({ synth_tier: '비전', library: 5, cauldron: 2 }) === modAt({ synth_tier: '비전', library: 5, cauldron: 3 }) - 6 - 2, '');
  ok('기초는 설비 벌점이 없다', modAt({ synth_tier: '기초', library: 0 }) === modAt({ synth_tier: '기초', library: 5 }), '');

  // 선행 조건 사다리 — 돈만으로는 못 산다
  t = fresh(); t.vars.cole = 999999; t.vars.cauldron = 3; t.vars.renown = 100;
  let st = party.itemState(S, t, tab, item('cauldron'));
  ok('가마 4단은 견습(평판 100)에게 잠김', st.locked && st.reason.includes('중급'), JSON.stringify(st));
  t.vars.renown = 400;
  st = party.itemState(S, t, tab, item('cauldron'));
  ok('중급(평판 400)이면 열린다', !st.locked && st.canBuy, JSON.stringify(st));
  t.vars.cauldron = 1; t.vars.renown = 1;
  ok('가마 2단은 아무나 산다', party.itemState(S, t, tab, item('cauldron')).canBuy, '');
  t.vars.storage = 4;
  ok('보관고는 조건 없이 돈만 (널널하게)', party.itemState(S, t, tab, item('storage')).canBuy, '');

  // 메인이 설비를 안다
  const p0 = engine.sendPhase(S, fresh(), { rng: seededRng('a', 220, 's') }).promptBlock;
  ok('상태 블록에 설비 줄', p0.includes('설비: 가마 1단 · 서고 0단 · 보관고 2/10 · 약초밭 0단'),
    p0.split('\n').find((l) => l.includes('설비')) ?? '');
  ok('설비 지시문이 실린다 (서고 단수로 레시피를 막는다)', p0.includes('아직 읽어낼 수 없다'), '');
  // {name}은 에셋 팩 포맷 본보기(<img="{name}">)라 모델에게 그대로 보여 주는 게 맞다 — 미치환이 아니다
  const left = (p0.match(/\{[a-z_]+\}/g) || []).filter((x) => x !== '{name}');
  ok('프롬프트에 미치환 자리표시자 없음', left.length === 0, left.join(' '));
}

console.log('\n━━ 진열대 — 기한이 온 것이 팔린 것, 돈과 물건이 어긋나지 않는다 ━━');
{
  let t = fresh();
  ok('진열대 0단도 창가 3칸', look(t)('shelf_cap') === 3, String(look(t)('shelf_cap')));
  t.vars.display = 5;
  ok('5단이면 18칸 = 목록 상한', look(t)('shelf_cap') === 18 && S.vars.find((v) => v.id === 'shelf').maxItems === 18, '');
  t.vars.display = 0;
  const cole0 = t.vars.cole;
  ({ st: t } = turn(t, { shelf: { add: ['힐링 살브 @+2 120', '약 @+1 60'] } }, 300));
  ok('보조가 진열을 올린다 (allow) · 기한이 절대값으로 굳는다', t.vars.shelf.length === 2 && t.vars.shelf.every((x) => /@\d+ \d+$/.test(x)), JSON.stringify(t.vars.shelf));
  ok('올린 턴에는 매출이 없다', t.vars.cole === cole0 && t.vars.shelf_sold === 0, cole0 + ' → ' + t.vars.cole);
  const p1 = engine.sendPhase(S, t, { rng: seededRng('a', 301, 's') }).promptBlock;
  ok('상태 블록에 진열대 2/3 + (N일) 환산', p1.includes('진열대(2/3)') && /힐링 살브 120 \(2일\)/.test(p1),
    p1.split('\n').find((l) => l.includes('진열대')) ?? '');
  ok('진열 지시문이 "지어내 팔지 마라"를 건다', p1.includes('며칠 안에 팔릴지는 시스템이 정한다'), '');
  // 이틀 뒤 — 약(@+1)은 팔리고 힐링 살브(@+2)는 당일이라 아직
  let r = turn(t, { skip_day: 2 }, 302);
  ok('약이 팔렸다 — 소지금 +60, 진열엔 힐링 살브만', r.st.vars.cole === cole0 + 60 && r.st.vars.shelf.length === 1 && r.st.vars.shelf[0].startsWith('힐링 살브'),
    cole0 + ' → ' + r.st.vars.cole + ' · ' + JSON.stringify(r.st.vars.shelf));
  ok('매출 이벤트가 떴다', r.fired.some((e) => (e.id ?? e) === 'shelf_sale'), JSON.stringify(r.fired));
  const p2 = engine.sendPhase(S, r.st, { rng: seededRng('a', 303, 's') }).promptBlock;
  ok('다음 장면에 "팔렸다" 통지', p2.includes('진열대의 물건이 팔렸다'), '');
  // 보조가 도로 거둔 것은 매출이 아니다
  const back = r.st.vars.shelf[0];
  const r2 = turn(r.st, { shelf: { remove: [back] }, items: { add: ['힐링 살브'] } }, 304);
  ok('거둬들인 것은 돈이 안 된다', r2.st.vars.cole === cole0 + 60 && r2.st.vars.shelf.length === 0 && r2.st.vars.shelf_sold === 0,
    r2.st.vars.cole + ' · sold ' + r2.st.vars.shelf_sold);
  ok('거둔 턴엔 매출 이벤트가 없다', !r2.fired.some((e) => (e.id ?? e) === 'shelf_sale'), '');
  // 칸 넘침
  t = fresh();
  ({ st: t } = turn(t, { shelf: { add: ['a @+3 10', 'b @+3 10', 'c @+3 10', 'd @+3 10'] } }, 310));
  ok('3칸에 4개면 넘침 통지', t.vars.shelf.length === 4 && engine.sendPhase(S, t, { rng: seededRng('a', 311, 's') }).promptBlock.includes('진열대가 좁다'), '');
  // 설비 탭에 진열대
  const tab = SC.require('party').partyTabs(S).find((x) => x.id === 'facility');
  ok('설비 탭 다섯째가 진열대 (설명 있음)', tab.items.length === 5 && tab.items[4].var === 'display' && tab.items[4].note.includes('팔려'), '');
}

console.log('\n━━ 상점 — 어디서 열리나 · 뇌절이 막히나 ━━');
{
  const shopMod = SC.require('shop');
  const open = (st, id) => shopMod.shopOpen(shopMod.shopConfigs(S).find((c) => c.id === id),
    S, st.vars, engine.makeLookup);
  const t = fresh();
  t.vars.location = '왕도';
  ok('왕도 — 상점가만 열린다', open(t, 'market') && !open(t, 'shade'), '');
  t.vars.location = '왕도 뒷골목';
  ok('뒷골목 — 거래처만 열린다', !open(t, 'market') && open(t, 'shade'), '');
  t.vars.location = '숲';
  ok('들판에선 둘 다 닫힌다', !open(t, 'market') && !open(t, 'shade'), '');
  // 씨앗 상사 · 미끼 상점 (유저 요청) — 상점 4개 = 상한
  ok('상점 4곳 (상한)', S.shops.length === 4 && S.shops.some((x) => x.id === 'seeds') && S.shops.some((x) => x.id === 'bait'), '');
  t.vars.location = '프리겐·시골';
  ok('시골에선 씨앗 상사만', open(t, 'seeds') && !open(t, 'bait') && !open(t, 'market'), '');
  t.vars.location = '해안';
  ok('해안에선 미끼 상점만', open(t, 'bait') && !open(t, 'seeds'), '');
  t.vars.location = '왕도';
  ok('왕도에선 상점가·씨앗·미끼 셋', open(t, 'market') && open(t, 'seeds') && open(t, 'bait') && !open(t, 'shade'), '');

  // 어휘 밖 등급 거부 + 밴드 클램프 (로어북 150의 가격 감각을 시스템이 강제한다)
  t.vars.location = '왕도';
  const r = shopMod.applyStock(S, t, {
    id: 'market',
    stock: [
      { cat: '소재', name: '이름 모를 풀', grade: '조악', price: 9999 },   // 밴드 초과 → 60으로
      { cat: '도구', name: '낡은 곡괭이', grade: '보통', price: 120 },      // 정상
      { cat: '서적', name: '금서', grade: '신화', price: 500 },             // 어휘 밖 → 거부
    ],
    buying: [{ name: '푸니 구슬', price: 12 }],
  }, 'market');
  const stock = shopMod.shopStateOf(t, shopMod.shopConfig(S, 'market')).stock;
  ok('어휘 밖 등급은 거부된다', r.stocked === 2 && r.rejected.length === 1, JSON.stringify(r));
  ok('밴드 밖 가격은 클램프된다 (9999 → 60)',
    stock.find((x) => x.name === '이름 모를 풀')?.price === 60,
    JSON.stringify(stock.map((x) => [x.name, x.price])));

  // 구매 — 결제·잔액·목록 합류 전부 엔진 (보조 호출 0)
  t.vars.cole = 500;
  const pick = stock.find((x) => x.name === '낡은 곡괭이');
  const bought = shopMod.buy(S, t, pick.id, 'market');
  ok('구매 정산 — 잔액 차감 + 소재 목록 합류', bought.ok && t.vars.cole === 380
    && t.vars.materials.some((m) => m.includes('낡은 곡괭이')),
    `${t.vars.cole} / ${JSON.stringify(t.vars.materials)}`);
  const poor = { ...t, vars: { ...t.vars, cole: 5 } };
  ok('잔액 부족이면 거부', !shopMod.buy(S, poor, stock[0].id, 'market').ok, '');

  // 시세판 매입 — 상점가는 완성품만, 뒷골목은 소재를 받는다
  t.vars.items.push('푸니 구슬');
  const sold = shopMod.sell(S, t, '푸니 구슬', 'market');
  ok('시세판 매입 — 완성품 목록에서 빠지고 값이 들어온다',
    sold.ok && !t.vars.items.includes('푸니 구슬'), JSON.stringify({ sold: sold.ok, items: t.vars.items }));
  ok('두 상점의 매입 대상이 다르다',
    shopMod.shopConfig(S, 'market').sellFrom === 'items'
    && shopMod.shopConfig(S, 'shade').sellFrom === 'materials', '');
}

console.log('\n━━ 게시판 — 의뢰판 + 연금술사의 자리 ━━');
{
  const t = fresh();
  t.vars.location = '별의 고치 카페';
  const after = engine.outputPhase(S, t, {}, {}, {
    rng: seededRng('a', 90, 'o'),
    board: { new: [
      { title: '감기약을 구합니다', author: '밀밭집 둘째', cat: '의뢰',
        body: '아이가 기침이 심합니다. 약을 지어 주실 분, 사례 800콜. 닷새 안에 부탁드립니다.' },
      { title: '중화제 색이 안 잡힙니다', author: 'S.', cat: '연금',
        body: '적을 만들려는데 자꾸 탁해집니다. 물을 바꿔야 할까요.' },
      { title: '아무 칸', author: '손님', cat: '없는칸', body: '어휘 밖 카테고리' },
    ] },
  });
  const posts = after.state.board.posts;
  ok('게시글이 등록된다', posts.length === 3, String(posts.length));
  ok('의뢰 칸·연금 칸이 나뉜다',
    posts.some((p) => p.cat === '의뢰') && posts.some((p) => p.cat === '연금'),
    JSON.stringify(posts.map((p) => p.cat)));
  ok('어휘 밖 카테고리는 첫 칸으로 보정', posts.every((p) => S.board.categories.includes(p.cat)),
    JSON.stringify(posts.map((p) => p.cat)));

  const p = engine.sendPhase(S, after.state, { rng: seededRng('a', 91, 's') }).promptBlock;
  ok('메인엔 화제 한 줄만 (본문 원문 금지)',
    p.includes('감기약을 구합니다') && !p.includes('아이가 기침이 심합니다'), '');
  ok('수주 안내 지시문이 뜬다', p.includes('아직 수주한 것이 아니다'), '');

  // 자율형이라 매턴 세계의 글이 돈다 — 반응형이면 주인공 서사만 박제된다
  const aux = engine.buildAuxPrompt(S, after.state, '서사', null);
  ok('보조에 자율형 갱신 요청이 실린다', aux.includes('board'), '');
  const field = { ...after.state, vars: { ...after.state.vars, location: '숲' } };
  ok('들판에선 게시판 갱신이 빠진다 (열람은 그대로)',
    !engine.buildAuxPrompt(S, field, '서사', null).includes('"board"'), '');
}

console.log('\n━━ 우상단 버튼 — 중복 없이 하나씩 ━━');
{
  // 실기 제보: 공방 버튼이 2개 떴다. 원인은 탭이 하나뿐인데 그 탭에 fab을 단 것 —
  // 패널 버튼과 탭 지름길이 같은 곳을 열었다. 어댑터 syncUtilButtons와 같은 순서로 모아 본다.
  const partyMod = SC.require('party');
  const shopMod = SC.require('shop');
  const btns = [];
  const pb = partyMod.partyButtonSpec(S);
  if (pb) btns.push(['party', pb.label, pb.icon]);
  for (const f of partyMod.partyFabSpecs(S)) btns.push([`partytab_${f.id}`, f.label, f.icon]);
  const cb = SC.require('calendar').calendarButtonSpec(S);
  if (cb) btns.push(['calendar', cb.label, cb.icon]);
  if (SC.require('board').boardConfig(S)) btns.push(['board', S.board.label, S.board.icon]);
  for (const sh of shopMod.shopConfigs(S)) btns.push([`shop_${sh.id}`, sh.label, sh.icon]);

  const tabs = partyMod.partyTabs(S);
  ok('탭이 하나뿐인 편성표엔 fab을 달지 않는다',
    !(tabs.length === 1 && tabs[0].fab), `탭 ${tabs.length}개, fab ${tabs[0]?.fab || '없음'}`);
  const icons = btns.map((b) => b[2]);
  ok('버튼 글리프가 서로 겹치지 않는다', new Set(icons).size === icons.length,
    JSON.stringify(btns.map((b) => `${b[2]} ${b[1]}`)));
  const labels = btns.map((b) => b[1]);
  ok('버튼 이름도 겹치지 않는다', new Set(labels).size === labels.length, JSON.stringify(labels));
  console.log('    → ' + btns.map((b) => `${b[2]} ${b[1]}`).join(' · '));
}

console.log('\n━━ 지도 탭 — 지형표에서 구운 격 사다리 ━━');
{
  const partyMod = SC.require('party');
  const tabs = partyMod.partyTabs(S);
  const map = tabs.find((t) => t.id === 'map');
  ok('공방 패널 둘째 탭이 지도다 (새 버튼 없음)', !!map && map.template && !map.fab, JSON.stringify(tabs.map((t) => t.id)));
  const t = fresh();
  t.vars.location = '광산·동굴';
  t.vars.areas = ['왕도 근교 (왕도 주변 들판)', '버려진 갱도 (광산·동굴)', '잊혀진 평원 (왕도 주변 들판)', '지형 안 붙인 곳'];
  const html = SC.require('render').renderPanelTemplate(S, t, map.template);
  // CSS 블록({display: flex; …})은 자리표시자가 아니다 — <style>을 떼고 본다
  const body = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  const leftover = (body.match(/\{[a-z_]+(?::[^}]*)?\}/g) || []);
  ok('미치환 자리표시자 없음', leftover.length === 0, leftover.join(' '));
  ok('지금 위치·격이 머리에', html.includes('지금 광산·동굴 · 격 3'), '');
  ok('지형 17종이 전부 그려진다', PLACES.every(([p]) => html.includes(p)), '');
  // 가 본 곳이 제 칸에 — 광산 칸 안에 갱도 칩이, 들판 칸 안에 평원 칩이
  const cellOf = (p) => { const i = html.indexOf(`<div class="amap-pn">${p}</div>`); return html.slice(i, html.indexOf('</div></div>', i) + 12); };
  ok('"버려진 갱도 (광산·동굴)"이 광산·동굴 칸에', cellOf('광산·동굴').includes('버려진 갱도'), cellOf('광산·동굴').slice(0, 200));
  ok('들판 칸엔 두 곳 (근교 + 평원)', cellOf('왕도 주변 들판').includes('왕도 근교') && cellOf('왕도 주변 들판').includes('잊혀진 평원'), '');
  ok('갱도는 들판 칸에 안 든다', !cellOf('왕도 주변 들판').includes('갱도'), '');
  ok('지형 안 붙인 항목은 어느 칸에도 안 든다 (상태창 여정 탭에는 그대로 있다)',
    !html.includes('지형 안 붙인 곳') && t.vars.areas.includes('지형 안 붙인 곳'), '');
  ok('CSS가 #sc-game 범위로 갇힌다', html.includes('#sc-game .amap'), '');
}

console.log('\n━━ 상태창 찬 정도 · 상태 블록 누락분 ━━');
{
  const t = fresh(); t.vars.storage = 2; t.vars.materials = Array.from({ length: 14 }, (_, i) => '소재' + i);
  const html = SC.require('render').renderStatusHtml(S, t, null, null, { uid: 11 });
  const pane = html.slice(html.indexOf('보관 중'), html.indexOf('보관 용량'));
  ok('공방 그룹에 "보관 중 14종" + 용량 대비 막대(14/35 = 40%)', pane.includes('14종') && /width:40\.0%/.test(pane), pane.slice(0, 200));
  ok('진열·밭도 막대', html.includes('진열 중') && html.includes('심은 것') && (html.match(/sim-bar-fill/g) || []).length >= 3, '');
  const p = engine.sendPhase(S, t, { rng: seededRng('a', 700, 's') }).promptBlock;
  ok('상태 블록에 도구·동행·단서·채집지 줄', /도구: .*채집 바구니.*동행: .*단서 0.*아는 채집지: .*왕도 근교/.test(p), p.split('\n').find((l) => l.startsWith('도구')) ?? '');
  ok('상태 블록에 숙련 6종', /숙련: 폭탄 0 · 약품 0 · 중간재 0 · 도구 0 · 음식 0 · 비전 0/.test(p), p.split('\n').find((l) => l.startsWith('숙련')) ?? '');
}

console.log('\n━━ 낱말 자동 무장 — 버튼을 안 눌러도 글이 곧 버튼 ━━');
{
  ok('액션 13개 전부 낱말이 있다', S.actions.every((a) => Array.isArray(a.keywords) && a.keywords.length >= 2), S.actions.filter((a) => !a.keywords).map((a) => a.id).join(' '));
  let t = fresh(); t.vars.location = '왕도 주변 들판';
  let r = engine.autoArmActions(S, t, '바구니를 들고 약초를 채집하러 나선다');
  ok('"채집하러" → ⛏ 채집 무장', r.armed.join(',') === 'act_gather', JSON.stringify(r));
  r = engine.autoArmActions(S, fresh(), '조합서를 펼쳐 레시피를 훑어본다');
  ok('"조합서"엔 조합이 안 걸린다', r.armed.length === 0, JSON.stringify(r.armed));
  r = engine.autoArmActions(S, fresh(), '가마 앞에서 힐링 살브를 조합한다');
  ok('"조합한다" → 🧪 조합 무장', r.armed.join(',') === 'act_synth', JSON.stringify(r.armed));
  r = engine.autoArmActions(S, fresh(), '짐을 꾸려 왕도로 간다');
  ok('"왕도로 간다" → 🏙 왕도로 무장', r.armed.join(',') === 'go_town', JSON.stringify(r.armed));
  r = engine.autoArmActions(S, fresh(), '공방에서 채집한다');
  ok('공방(격 0)에선 채집이 조건 미충족으로 건너뛴다', r.armed.length === 0 && r.skipped[0]?.id === 'act_gather', JSON.stringify(r.skipped));
  const v = validateSchema(S);
  ok('낱말이 액션끼리 안 겹친다 (경고 없음)', !v.warnings.some((w) => /keywords/.test(w.path)), JSON.stringify(v.warnings.filter((w) => /keywords/.test(w.path))));
}

console.log('\n━━ 이동 — 버튼이 곧 안내 (상점이 있는지도 모르는 문제) ━━');
{
  const shopMod = SC.require('shop');
  const openIds = (st) => shopMod.shopConfigs(S).filter((c) => shopMod.shopOpen(c, S, st.vars, engine.makeLookup)).map((c) => c.id);
  let t = fresh();
  ok('이동 액션 5 (공방·왕도·뒷골목·들판·강가)', ['go_home', 'go_town', 'go_shade', 'go_field', 'go_river'].every((id) => S.actions.some((a) => a.id === id)), '');
  ok('공방에 있으면 공방으로 버튼은 숨고 왕도로는 열린다', !canAct(t, 'go_home') && canAct(t, 'go_town'), '');
  ok('뒷골목은 평판 100 또는 단서가 있어야 (월영회의 그늘)', !canAct(t, 'go_shade'), '');
  ok('시작(공방)엔 열린 가게가 없다 — 상태창이 이유를 말한다', openIds(t).length === 0 && look(t)('shops_here').includes('왕도로 가면'), look(t)('shops_here'));
  t = engine.toggleAction(S, t, 'go_town').state;
  let r = turn(t, {}, 600);
  ok('왕도로 → 위치가 왕도, 1시간 반 지남', r.st.vars.location === '왕도' && r.prompt.includes('09:30'), r.st.vars.location + ' ' + r.prompt.split('\n')[0]);
  ok('도착하면 상점가·씨앗·미끼 셋이 열린다', openIds(r.st).join(',') === 'market,seeds,bait', openIds(r.st).join(','));
  ok('상태 블록에 "여기 가게" 줄', engine.sendPhase(S, r.st, { rng: seededRng('a', 601, 's') }).promptBlock.includes('여기 가게: 상점가·씨앗 상사·미끼 상점'), '');
  ok('왕도에선 왕도로 버튼이 숨고 공방으로가 열린다', !canAct(r.st, 'go_town') && canAct(r.st, 'go_home'), '');
  r.st.vars.clues = 1;
  ok('단서가 생기면 뒷골목이 열린다', canAct(r.st, 'go_shade'), '');
  t = engine.toggleAction(S, r.st, 'go_river').state;
  r = turn(t, {}, 602);
  ok('강가로 → 미끼 상점만', r.st.vars.location === '강가·폭포' && openIds(r.st).join(',') === 'bait', openIds(r.st).join(','));
  t = fresh(); t.vars.fight_max = 50; t.vars.fight_gauge = 0;
  ok('교전 중엔 이동 못 한다', !canAct(t, 'go_town') || !look(t)('fight_on'), '');
}

console.log('\n━━ 밭·미끼 — 씨앗은 심어야 작물이 되고, 미끼는 물가에서만 값을 한다 ━━');
{
  const expr = SC.require('expr');
  let t = fresh();
  ok('약초밭 0단이면 밭 칸 0 (씨앗을 사도 심을 데가 없다)', look(t)('field_cap') === 0, '');
  t.vars.garden = 2;
  ok('2단이면 4칸', look(t)('field_cap') === 4, '');
  ({ st: t } = turn(t, { field: { add: ['약초 @+2', '향기 꽃 @+4'] } }, 500));
  ok('심은 것이 절대 날짜로 굳는다', t.vars.field.length === 2 && t.vars.field.every((x) => /@\d+$/.test(x)), JSON.stringify(t.vars.field));
  const p1 = engine.sendPhase(S, t, { rng: seededRng('a', 501, 's') }).promptBlock;
  ok('상태 블록 밭 줄 (2/4) + (N일) 환산 + 밭 지시문', p1.includes('밭(2/4)') && /약초 \(2일\)/.test(p1) && p1.includes('앞당겨 거두지 마라'),
    p1.split('\n').find((l) => l.startsWith('밭')) ?? '');
  let r = turn(t, { skip_day: 2 }, 502);
  const p2 = engine.sendPhase(S, r.st, { rng: seededRng('a', 503, 's') }).promptBlock;
  ok('익는 날엔 (오늘)로 보이고 아직 밭에 있다', r.st.vars.field.length === 2 && /약초 \(오늘\)/.test(p2), p2.split('\n').find((l) => l.startsWith('밭')) ?? '');
  r = turn(r.st, { skip_day: 1 }, 504);
  ok('안 거두면 다음 날 시든다 (expire) — 향기 꽃만 남는다', r.st.vars.field.length === 1 && r.st.vars.field[0].startsWith('향기 꽃'), JSON.stringify(r.st.vars.field));
  t = fresh(); t.vars.garden = 1;
  ({ st: t } = turn(t, { field: { add: ['a @+3', 'b @+3', 'c @+3'] } }, 505));
  ok('2칸에 3개면 넘침 통지', engine.sendPhase(S, t, { rng: seededRng('a', 506, 's') }).promptBlock.includes('밭이 좁다'), '');
  // 미끼 — 물가에서만 +3
  const gm = S.checks.find((c) => c.id === 'gather').mod;
  const modAt = (vars) => { const u = fresh(); Object.assign(u.vars, { stamina: 80, ...vars }); return Number(expr.evaluate(gm, look(u), null)); };
  ok('해안 + 미끼 = 채집 +3', modAt({ location: '해안', materials: ['반짝이 미끼'] }) === modAt({ location: '해안', materials: [] }) + 3, '');
  ok('숲에선 미끼가 소용없다', modAt({ location: '숲', materials: ['반짝이 미끼'] }) === modAt({ location: '숲', materials: [] }), '');
  t = fresh(); t.vars.location = '강가·폭포'; t.vars.materials = ['향미끼'];
  ok('물가에 미끼가 있으면 지시문 (쓴 미끼는 빼라)', engine.sendPhase(S, t, { rng: seededRng('a', 507, 's') }).promptBlock.includes('쓴 미끼 하나를 소재에서 빼라'), '');
}

console.log('\n━━ 시세 · 특산 — 날씨와 사건이 값을 밀고, 계절이 소재를 정한다 ━━');
{
  const shopMod = SC.require('shop');
  const mk = engine.makeLookup;
  const cfgOf = (id) => shopMod.shopConfigs(S).find((c) => c.id === id);
  // 특산 지시문 — (지형, 계절) 한 번에 하나
  ok('특산표 12지형 × 4계절, 이름 중복 없음', Object.keys(SPECIALS).length === 12 && Object.values(SPECIALS).every((b) => b.length === 4)
    && new Set(Object.values(SPECIALS).flat(2)).size === Object.values(SPECIALS).flat(2).length, '');
  ok('특산 이름이 계절 레시피 재료와 짝 (봄꽃 이슬·얼음꽃·가을 열매·설화·서리 결정·반딧불 풀·혜성석 가루)',
    ['봄꽃 이슬', '얼음꽃', '가을 열매', '설화', '서리 결정', '반딧불 풀', '혜성석 가루'].every((n) => Object.values(SPECIALS).flat(2).includes(n) && BOOK_ALL.some(([, , , , m]) => m.includes(n))), '');
  let t = fresh(); t.vars.location = '숲';                       // 4월 = 봄
  let p = engine.sendPhase(S, t, { rng: seededRng('a', 800, 's') }).promptBlock;
  ok('봄의 숲 특산(새순·송진)만 실린다 — 여름 것은 안 실린다', p.includes('봄의 숲 특산: 새순·송진') && !p.includes('매미 허물'), '');
  ok('특산 지시문은 한 번에 하나 (48개 중)', (p.match(/의 .* 특산: /g) || []).length === 1, String((p.match(/의 .* 특산: /g) || []).length));
  t.vars.weather = '비';
  p = engine.sendPhase(S, t, { rng: seededRng('a', 801, 's') }).promptBlock;
  ok('비 오는 들판이면 날씨 특산도 한 줄', p.includes('날씨 특산(비): 이슬 버섯'), '');
  t.vars.location = '공방';
  p = engine.sendPhase(S, t, { rng: seededRng('a', 802, 's') }).promptBlock;
  ok('공방(격 0)에선 특산·날씨 특산 둘 다 없다', !p.includes('특산:') && !p.includes('날씨 특산'), '');
  // 시세 — 사건이 세우고 기한이 내린다, 값은 상점이 본다
  t = fresh();
  ok('시작은 평시, 상점가 소재 배율 1', look(t)('market_state') === '평시' && shopMod.priceMulFor(cfgOf('market'), '소재', mk(S, t.vars)) === 1, '');
  t.vars.market_state = '약초 풍년'; t.vars.market_until = 99999;
  ok('약초 풍년 — 소재 ×0.6, 도구는 그대로', shopMod.priceMulFor(cfgOf('market'), '소재', mk(S, t.vars)) === 0.6 && shopMod.priceMulFor(cfgOf('market'), '도구', mk(S, t.vars)) === 1, '');
  t.vars.market_state = '흉년';
  ok('흉년 — 식재료 ×1.8, 완성품 매입 ×0.9, 씨앗 ×1.4', shopMod.priceMulFor(cfgOf('market'), '식재료', mk(S, t.vars)) === 1.8
    && shopMod.priceMulFor(cfgOf('market'), '*', mk(S, t.vars)) === 0.9 && shopMod.priceMulFor(cfgOf('seeds'), '씨앗', mk(S, t.vars)) === 1.4, '');
  t.vars.market_state = '광석 품귀';
  ok('광석 품귀 — 뒷골목 ×1.5', shopMod.priceMulFor(cfgOf('shade'), '희귀 소재', mk(S, t.vars)) === 1.5, '');
  t.vars.market_state = '평시'; t.vars.weather = '비';
  ok('비 — 미끼 ×0.8 · 생선 ×0.7 (시세와 무관한 날씨 배율)', shopMod.priceMulFor(cfgOf('bait'), '미끼', mk(S, t.vars)) === 0.8 && shopMod.priceMulFor(cfgOf('bait'), '물고기', mk(S, t.vars)) === 0.7, '');
  p = engine.sendPhase(S, t, { rng: seededRng('a', 803, 's') }).promptBlock;
  ok('평시엔 시세 지시문 없음, 상태 블록엔 시세 평시', !p.includes('시세가 평시가 아니다') && p.includes('시세 평시'), '');
  // 기한 — 사건이 세운 시세는 며칠 뒤 평시로
  t = fresh(); t.vars.market_state = '상단 도착'; t.vars.market_until = look(t)('elapsed') + 2;
  p = engine.sendPhase(S, t, { rng: seededRng('a', 804, 's') }).promptBlock;
  ok('시세가 평시가 아니면 지시문이 붙는다', p.includes('시세가 평시가 아니다 — 상단 도착'), '');
  let r = turn(t, { skip_day: 1 }, 805);
  ok('기한 전엔 유지', r.st.vars.market_state === '상단 도착', r.st.vars.market_state);
  r = turn(r.st, { skip_day: 2 }, 806);
  ok('기한이 지나면 평시로 (onTurn)', r.st.vars.market_state === '평시', r.st.vars.market_state);
  // 축제 당일 → 축제 특수 이틀
  t = fresh();
  r = turn(t, { skip_day: 6 }, 807);                             // 4/7 꽃맞이제
  ok('축제 당일 시세가 축제 특수로 (완성품 매입 ×1.3)', r.st.vars.market_state === '축제 특수' && shopMod.priceMulFor(cfgOf('market'), '*', mk(S, r.st.vars)) === 1.3, r.st.vars.market_state);
  r = turn(r.st, { skip_day: 3 }, 808);
  // 같은 턴에 랜덤 시세 사건(상단 도착 등)이 새로 설 수 있다 — "축제 특수가 걷혔나"만 본다
  ok('사흘 뒤 축제 특수는 걷힌다', r.st.vars.market_state !== '축제 특수', r.st.vars.market_state);
  // 사건 — 비 오는 봄 들판이면 약초 풍년이 뽑힐 수 있다 (조건이 맞아야만)
  const tbl = S.rules.randomEvents.table;
  ok('시세 사건 5종 · 전부 평시일 때만', ['caravan', 'herb_glut', 'herb_short', 'ore_short', 'famine'].every((id) => tbl.find((e) => e.id === id)?.when.includes("market_state == '평시'")), '');
  ok('시세는 보조가 못 만진다', !S.updater.allow.some((a) => a.id === 'market_state' || a.id === 'market_until'), '');
}

console.log('\n━━ 축제 — 달력 표식·준비 창·당일 이벤트가 한 표에서 ━━');
{
  ok('축제 6개 · 달마다 하나 · 일은 4 이상 (준비 창이 달을 안 넘는다)',
    FESTIVALS.length === 6 && new Set(FESTIVALS.map((x) => x[2])).size === 6 && FESTIVALS.every((x) => x[3] >= 4), '');
  ok('달력 표식에 축제 6 + 장날 + 정기시', S.calendar.marks.length === 8 && S.calendar.marks.some((m) => m.label === '한여름 별시장' && m.month === 6 && m.dom === 21), String(S.calendar.marks.length));
  let t = fresh();                                         // 4월 1일
  const p0 = engine.sendPhase(S, t, { rng: seededRng('a', 400, 's') }).promptBlock;
  ok('4월 1일엔 꽃맞이제 준비 지시가 아직 없다', !p0.includes('꽃맞이제(4월 7일)가 다가온다'), '');
  ({ st: t } = turn(t, { skip_day: 3 }, 401));            // 4월 4일 = D-3
  const p1 = engine.sendPhase(S, t, { rng: seededRng('a', 402, 's') }).promptBlock;
  ok('4월 4일부터 준비 지시가 실린다', p1.includes('꽃맞이제(4월 7일)가 다가온다'), p1.split('\n').find((l) => l.includes('꽃맞이제')) ?? '');
  let r = turn(t, { skip_day: 3 }, 403);                   // 4월 7일 = 당일
  ok('당일에 축제 이벤트가 뜬다', r.fired.some((e) => (e.id ?? e) === 'fest_blossom'), JSON.stringify(r.fired));
  ok('래치가 그 해로 굳는다', r.st.vars.fest_seen === 1400 * 100 + 4, String(r.st.vars.fest_seen));
  const p2 = engine.sendPhase(S, r.st, { rng: seededRng('a', 404, 's') }).promptBlock;
  ok('다음 장면에 당일 통지', p2.includes('꽃맞이제 당일'), '');
  r = turn(r.st, {}, 405);                                 // 같은 날 다음 턴
  ok('같은 날 다음 턴엔 다시 안 뜬다', !r.fired.some((e) => (e.id ?? e) === 'fest_blossom'), '');
  ({ st: t } = turn(r.st, { skip_day: 1 }, 406));         // 4월 8일
  const p3 = engine.sendPhase(S, t, { rng: seededRng('a', 407, 's') }).promptBlock;
  ok('지나가면 준비 지시도 걷힌다', !p3.includes('꽃맞이제(4월 7일)가 다가온다'), '');
  ({ st: t } = turn(t, { skip_day: 364 }, 408));          // 이듬해 4월 7일
  r = turn(t, {}, 409);
  ok('이듬해 같은 날엔 다시 뜬다 (연 1회)', look(t)('month') === 4 && look(t)('dom') === 7 && (t.vars.fest_seen === 1401 * 100 + 4 || r.st.vars.fest_seen === 1401 * 100 + 4),
    look(t)('date') + ' · ' + t.vars.fest_seen);
  // 혜성 관측일은 단서를 준다
  t = fresh(); const c0 = t.vars.clues;
  r = turn(t, { skip_day: 267 }, 410);                     // 4/1 + 267 = 12/24
  ok('12월 24일 혜성 관측일 — 단서 +1', look(r.st)('month') === 12 && look(r.st)('dom') === 24 && r.st.vars.clues === c0 + 1, look(r.st)('date') + ' · clues ' + r.st.vars.clues);
  ok('축제 래치는 보조가 못 만진다', !S.updater.allow.some((a) => a.id === 'fest_seen'), '');
}

console.log('\n━━ 조합서 탭 — 분야 탭 × 서고 단 묶음, 컬렉션은 has()로 채워진다 ━━');
{
  const partyMod = SC.require('party');
  const book = partyMod.partyTabs(S).find((t) => t.id === 'book');
  ok('공방 패널 셋째 탭이 조합서다 (버튼은 여전히 하나)', !!book && book.template && !book.fab, '');
  ok('공방 패널은 넓게(640px) — 분야 탭 6개가 한 줄', S.party.wide === true, '');
  ok('도감 112종 (계절 한정 8 포함) · 이름 중복 없음', BOOK_ALL.length === 112 && new Set(BOOK_ALL.map(([n]) => n)).size === 112, String(BOOK_ALL.length));
  ok('분야 6 · 도구 33(5종×6단계+2+계절 1) · 음식 18', BOOK_CATS.length === 6 && RECIPE_BOOK.도구.length === 33 && RECIPE_BOOK.음식.length === 18,
    BOOK_CATS.map((c) => c + RECIPE_BOOK[c].length).join(' '));
  ok('서고 단수 0~5 · 등급은 synth_tier 어휘', BOOK_ALL.every(([, lib, t]) => lib >= 0 && lib <= 5 && ['기초', '고급', '비전'].includes(t)), '');
  ok('분야마다 서고 1~5단에 항목이 깔린다 (단이 오르면 열리는 느낌)',
    BOOK_CATS.filter((c) => c !== '비전').every((c) => [1, 2, 3, 4, 5].every((lv) => RECIPE_BOOK[c].some(([, lib]) => lib === lv))), '');
  ok('시작 레시피(중화제 적)는 처음부터(0단)', BOOK_ALL.some(([n, lib]) => n === '중화제 적' && lib === 0), '');
  ok('도구 사슬은 앞 단계가 재료다 (낚싯대 → 튼튼한 낚싯대 → … → 용린 낚싯대)',
    ['튼튼한 낚싯대', '강철 낚싯대', '마나 낚싯대', '별의 낚싯대', '용린 낚싯대'].every((n, i, arr) => {
      const prev = i === 0 ? '낚싯대' : arr[i - 1]; const e = RECIPE_BOOK.도구.find(([x]) => x === n); return e && e[4][0] === prev && e[1] === i + 1;
    }), '');

  const t = fresh();
  t.vars.recipes = ['중화제 적', '힐링 살브', '내 맘대로 만든 비약'];
  t.vars.materials = ['맑은 물', '약초', '기름'];
  const render = (st) => SC.require('render').renderPanelTemplate(S, st, book.template);
  const html = render(t);
  const body = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  const leftover = (body.match(/\{[^{}]+\}/g) || []);
  ok('미치환 자리표시자 없음', leftover.length === 0, leftover.slice(0, 3).join(' '));
  ok('진행도 2 / 112 · 서고 0단', html.includes('2 / 112 · 서고 0단'), '');
  // 분야 탭 — CSS 라디오. 스크롤 압박을 끊는다 (유저 제보)
  ok('분야 탭 6개 (라디오 + 라벨), 첫 탭이 켜져 있다', (html.match(/type="radio"/g) || []).length === 6 && (html.match(/class="abk-tab"/g) || []).length === 6
    && html.includes('id="abk-scg-0" class="abk-r abk-r0" checked'), '');
  ok('탭 라벨에 분야 진행도 (약품 1/18)', html.includes('약품<span>1/18</span>'), '');
  ok('페이지는 기본 숨김, 켜진 탭만 보인다 (CSS)', html.includes('#sc-game .abk-page{') && html.includes('.abk-r0:checked ~ .abk-p0{'), '');
  // 서고 단 묶음
  ok('묶음 머리 "처음부터"·"서고 1단"…', html.includes('처음부터') && html.includes('서고 1단<span>') && html.includes('서고 5단<span>'), '');
  ok('서고 0단이면 1단 묶음부터 잠김(shut)', /abk-lv shut"><div class="abk-lh">서고 1단/.test(html) && /abk-lv open"><div class="abk-lh">처음부터/.test(html), '');
  const rowOf = (h, n) => { const i = h.indexOf('<span class="abk-nm">' + n + '</span>'); return h.slice(h.lastIndexOf('<div class="abk-row', i), i + 400); };
  ok('배운 힐링 살브는 on', rowOf(html, '힐링 살브').includes('abk-row on') && rowOf(html, '힐링 살브').includes('✦'), rowOf(html, '힐링 살브').slice(0, 120));
  ok('안 배운 0단 프람은 off · 미습득', rowOf(html, '프람').includes('abk-row off') && rowOf(html, '프람').includes('미습득'), '');
  ok('1단 레헤른은 🔒 서고 1단, 3단 테라 봄은 🔒 서고 3단', rowOf(html, '레헤른').includes('🔒 서고 1단') && rowOf(html, '테라 봄').includes('🔒 서고 3단'), '');
  t.vars.library = 3;
  const html3 = render(t);
  ok('서고 3단이면 1~3단 자물쇠가 풀리고(미습득) 4·5단만 남는다',
    rowOf(html3, '테라 봄').includes('미습득') && !html3.includes('🔒 서고 1단') && html3.includes('🔒 서고 4단') && html3.includes('🔒 서고 5단'), '');
  ok('묶음 머리도 열린다 (서고 3단 열림 / 4단 🔒)', /서고 3단<span>[^<]*열림/.test(html3) && /서고 4단<span>[^<]*🔒/.test(html3), '');
  ok('보관고에 있는 소재(약초·기름)는 밝게, 없는 것(밀랍)은 흐리게',
    rowOf(html, '힐링 살브').includes('abk-m have">약초') && rowOf(html, '힐링 살브').includes('abk-m have">기름') && rowOf(html, '힐링 살브').includes('abk-m ">밀랍'), '');
  ok('도감 밖 창작 레시피는 책에 안 뜬다 (목록에는 남는다)', !html.includes('내 맘대로') && t.vars.recipes.includes('내 맘대로 만든 비약'), '');
  ok('툴팁(title)에 효과·필요 소재', html.includes('title="바르는 약 — 베임·타박·화상 · 필요: 약초, 기름, 맑은 물, 밀랍"'), '');
  ok('CSS가 #sc-game 범위로 갇힌다', html.includes('#sc-game .abk'), '');
  const rd = S.vars.find((v) => v.id === 'recipes').desc;
  ok('레시피 desc가 도감 이름표 + 서고 단수를 싣는다 (보조가 이름·문턱을 맞춘다)',
    rd.includes('폭탄=프람/유니백/레헤른(1)') && rd.includes('용린 낚싯대(5)'), rd.slice(0, 160));
  ok('소재 desc가 "이름만"을 시킨다 (has 완전일치)', S.vars.find((v) => v.id === 'materials').desc.includes('이름만'), '');
}

console.log('\n━━ 캐스트 맵 — 3,792토큰을 origin으로 쪼갠다 ━━');
{
  const SECTIONS = ["Resna's Party / Lantarna Core", 'Moonlight Society', 'Polar Night Alchemists',
    ...Object.values(ORIGIN_CAST)];
  ok(`로어북 구간 ${SECTIONS.length}개를 전부 구웠다`, SECTIONS.every((s) => CAST[s] && CAST[s].length > 50),
    SECTIONS.filter((s) => !CAST[s]).join(' '));
  const castDirs = S.directives.filter((d) => d.id.startsWith('cast_'));
  ok('캐스트 지시문 8벌 (코어 + 적대 2 + 계열 5)', castDirs.length === 8, String(castDirs.length));

  // 실제 절감 — 원본은 항상 통째로 실렸다. 지금은 조건에 걸린 것만 실린다.
  const tok = (s) => Math.round(s.length / 3.2);          // 로어북 표시와 같은 어림
  const whole = tok(npcEntry.content);
  const activeCast = (st) => S.directives.filter((d) => d.id.startsWith('cast_'))
    .filter((d) => {
      const p = engine.sendPhase(S, st, { rng: seededRng('a', 100, 's') }).promptBlock;
      return p.includes(d.text.split('\n')[0]);
    }).reduce((n, d) => n + tok(d.text), 0);

  const early = fresh();                                   // 초반: 코어만
  const earlyTok = activeCast(early);
  ok(`초반 always-on ${earlyTok}t < 원본 ${whole}t (${Math.round((1 - earlyTok / whole) * 100)}% 절감)`,
    earlyTok < whole * 0.5, `${earlyTok} / ${whole}`);

  const late = fresh();                                    // 후반 최악: 코어 + 적대 2 + 계열 1
  late.vars.renown = 700; late.vars.clues = 5; late.vars.origin = '아를란드';
  const lateTok = activeCast(late);
  ok(`후반 최악도 ${lateTok}t < 원본 ${whole}t (${Math.round((1 - lateTok / whole) * 100)}% 절감)`,
    lateTok < whole, `${lateTok} / ${whole}`);

  // 계열 격리 — 아를란드로 시작하면 황혼 인물이 안 실린다 (이름을 부르면 개별 로어북이 뜬다)
  const p = engine.sendPhase(S, late, { rng: seededRng('a', 101, 's') }).promptBlock;
  ok('내 계열은 실린다 (아를란드 — 로로나)', p.includes('Rorolina'), '');
  ok('남의 계열은 안 실린다 (황혼 — 아샤 / 신비 — 소피)',
    !p.includes('Ayesha Altugle') && !p.includes('Sophie Neuenmuller'), '');
  ok('란타르나 코어는 계열과 무관하게 늘 실린다', p.includes('Resna Sternenlicht'), '');

  // 적대 세력은 이야기가 거기까지 갔을 때만
  const p0 = engine.sendPhase(S, fresh(), { rng: seededRng('a', 102, 's') }).promptBlock;
  ok('초반엔 극야가 안 실린다', !p0.includes('Criselda'), '');
  ok('진척이 있으면 극야가 실린다', p.includes('Criselda'), '');
}

console.log('\n━━ 시나리오 — 척추는 조건식이 민다 ━━');
{
  let t = fresh();
  ok('1막에서 시작', look(t)('scn_act') === 'act1', String(look(t)('scn_act')));
  const p = engine.sendPhase(S, t, { rng: seededRng('a', 110, 's') }).promptBlock;
  ok('현재 막의 연출 지시만 실린다', p.includes('연금술은 잊힌 기술이다'), '');
  ok('앞으로의 막은 안 보인다 (모델은 전체 시나리오를 모른다)',
    !p.includes('혜성이 왜 사라졌는가') && !p.includes('극야의 연금당은'), '');

  // 문턱만으로는 안 넘어간다 — minTurns가 페이스 바닥을 깐다
  t.vars.renown = 400;
  ({ st: t } = turn(t, {}, 111));
  ok('문턱을 넘겨도 minTurns 전엔 안 넘어간다', look(t)('scn_act') === 'act1',
    `${look(t)('scn_act')} (${look(t)('scn_turns')}턴)`);
  for (let i = 0; i < 12; i++) ({ st: t } = turn(t, {}, 120 + i));
  ok('턴이 차면 넘어간다', look(t)('scn_act') !== 'act1', `${look(t)('scn_act')} ${look(t)('scn_label')}`);
  ok('전환은 턴당 한 막 (2막을 건너뛰지 않는다)', look(t)('scn_act') === 'act2', String(look(t)('scn_act')));
  const p2 = engine.sendPhase(S, t, { rng: seededRng('a', 140, 's') }).promptBlock;
  ok('열린 막의 내막이 누적 공개된다', p2.includes('연금술을 반기지 않는 사람들'), '');
  ok('상태창에 진행 칩이 선다',
    SC.require('render').renderStatusHtml(S, t, null, null, { uid: 3 }).includes('쓸모 있는 것'), '');
}

console.log('\n━━ 서신 — 편지지 단말기가 아니다 ━━');
{
  const msgr = SC.require('messenger');
  ok('연락처는 동행 명단', S.messenger.contactsVar === 'allies', '');
  ok('사람 소식이 답장 근거로 붙는다', S.messenger.notesVar === 'ally_notes', '');
  const cfg = msgr.msgrConfig(S);
  const t = fresh();
  t.vars.allies = ['이자나', '하이디'];
  ok('연락처는 동행 목록에서 그대로 나온다',
    msgr.contacts(cfg, t).join(',') === '이자나,하이디', JSON.stringify(msgr.contacts(cfg, t)));
  t.vars.location = '왕도';
  ok('도시에선 서신이 오간다', msgr.msgrOpen(cfg, S, t.vars, engine.makeLookup) === true, '');
  t.vars.location = '숲';
  ok('들판에선 발신·선톡이 멈춘다 (열람은 그대로)',
    msgr.msgrOpen(cfg, S, t.vars, engine.makeLookup) === false, '');
  ok('편지 지침이 단말기 말투를 막는다',
    S.messenger.guide.includes('단말기가 아니라') && S.messenger.guide.includes('이모티콘 금지'), '');
}

console.log('\n━━ 에셋 — 카드 규약 이식 (이름_상태 · 이름_장면 · 기본 전용) ━━');
{
  const packs = S.assets.packs;
  ok('팩 3 (감정·성애·기본 전용), 전부 켜짐, by main', packs.length === 3 && packs.every((p) => p.enabled !== false) && S.assets.by === 'main', '');
  ok('여성 45 · 남성 3 · 기본 전용 13 · 상태 61 · 장면 31',
    ASSET_FEMALE.length === 45 && ASSET_MALE.length === 3 && ASSET_PLAIN.length === 13 && ASSET_STATUS.length === 61 && ASSET_NSFW.length === 31,
    [ASSET_FEMALE.length, ASSET_MALE.length, ASSET_PLAIN.length, ASSET_STATUS.length, ASSET_NSFW.length].join(' '));
  ok('이름이 세 집합에 겹치지 않는다', new Set([...ASSET_FEMALE, ...ASSET_MALE, ...ASSET_PLAIN]).size === 61, '');
  ok('남성은 감정 팩에만, 성애 팩에 없다', packs[0].slots[0].values.includes('roman') && !packs[1].slots[0].values.includes('roman'), '');
  ok('기본 전용은 감정·성애 팩 어디에도 없다', !packs[0].slots[0].values.includes('puni') && !packs[1].slots[0].values.includes('puni') && packs[2].slots[0].values.includes('puni'), '');
  ok('구분자 _ · 포맷 <img="{name}"> · verify 끔 (이름 목록 대조 불가 환경)', packs.every((p) => p.sep === '_' && p.format === '<img="{name}">' && p.verify === false), '');
  ok('usage가 매 응답 의무 꼴 (콜드 스타트 방지)', packs[0].usage.includes('때마다'), packs[0].usage);
  const t = fresh();
  const p = engine.sendPhase(S, t, { rng: seededRng('a', 150, 's') }).promptBlock;
  ok('메인 프롬프트에 이미지 규약이 실린다 (reisalin · flustered · Cowgirl-Normal)', p.includes('reisalin') && p.includes('flustered') && p.includes('Cowgirl-Normal'), '');
  t.vars.nsfw_on = false;
  const p2 = engine.sendPhase(S, t, { rng: seededRng('a', 151, 's') }).promptBlock;
  ok('/수위 0 이면 성애 팩이 닫힌다 (감정 팩은 그대로)', !p2.includes('Cowgirl-Normal') && p2.includes('flustered'), '');
  ok('수위는 보조가 못 만진다', !S.updater.allow.some((a) => a.id === 'nsfw_on'), '');
  ok('규약 예시가 조합으로 나온다 (reisalin_flustered · klaudia_Deep Kiss-Hard · lara_default)', (() => {
    const assets = SC.require('assets');
    const combos = [];
    for (const pk of packs) for (const w of pk.slots[0].values) for (const v of pk.slots[1].values) combos.push(w + '_' + v);
    return ['reisalin_flustered', 'klaudia_Deep Kiss-Hard', 'lara_default', 'roman_serious'].every((x) => combos.includes(x)) && !combos.includes('roman_Cowgirl-Normal') && !combos.includes('lara_smiling') && typeof assets === 'object';
  })(), '');
}

if (fails) { console.log(`\n❗ ${fails}건 실패`); process.exit(1); }

fs.writeFileSync(__P('공방-아틀리에.json'), JSON.stringify(S, null, 2));
console.log('\n저장: ' + __P('공방-아틀리에.json')
  + `  (변수 ${S.vars.length} · 파생 ${S.derived.length} · 판정 ${S.checks.length} · 액션 ${S.actions.length})`);
