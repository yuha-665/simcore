const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.7.9 — 의뢰판: 세계 안의 시스템 퀘스트 보드 (아틀리에 "벽보 의뢰 수주가 애매하다"가 발단).
//
// 불변식:
//   · 뇌절 방지 — 등급 어휘 밖 게시 거부, 보수는 밴드로 클램프, 게시 마감은 시스템이 정한다
//   · 수락·취소는 보조 호출 0 — 목록 변수 항목은 봇의 format 그대로, 효과는 결정적
//   · 통지는 pendingNotifies로 다음 전송 1회 (의뢰인·제목·보수·기한·내용이 메인에 간다)
//   · 첫 게시만 즉시 피기백 — 그 뒤엔 minOffers 아래 + refillEvery턴일 때만 (평턴 비용 0)
//   · 게시 마감은 매 턴 outputPhase가 걷는다 (시간 체계면 경과일, 없으면 턴)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const engine = SC.require('engine');
const quest = SC.require('quest');
const { seededRng } = SC.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

const S = {
  simcore: '0.1', meta: { name: '의뢰판봇' },
  time: { start: '1400-04-01 08:00', advance: 'explicit' },
  vars: [
    { id: 'renown', label: '평판', type: 'int', init: 30, min: 0, max: 1000 },
    { id: 'stamina', label: '체력', type: 'int', init: 100, min: 0, max: 100 },
    { id: 'quests', label: '수주 의뢰', type: 'list', init: [], maxItems: 3, itemMaxLength: 80 },
    { id: 'in_town', label: '도시', type: 'bool', init: true },
    { id: 'skip_day', label: '날 넘김', type: 'int', init: 0, min: 0, max: 3650 },
  ],
  derived: [],
  rules: { onTurn: [{ list: 'quests', expire: 'elapsed' }] },
  updater: { allow: [{ id: 'renown', maxGain: 20 }, { id: 'quests' }, { id: 'skip_day', maxGain: 3650 }] },
  questBoard: {
    label: '별의 고치 의뢰판', icon: '📜', listVar: 'quests', unit: '콜',
    grades: ['심부름', '기초', '필드', '위험'],
    bands: { 심부름: [50, 200], 기초: [150, 500], 필드: [500, 1500], 위험: [1500, 5000] },
    days: [2, 14], postDays: [3, 5], maxOffers: 6, minOffers: 2, refillEvery: 3,
    accept: [{ set: 'stamina', expr: 'stamina - 1' }],
    cancel: [{ set: 'renown', expr: "max(renown - (grade == '위험' ? 6 : 3) - floor(pay / 1000), 0)" }],
    when: 'in_town',
    guide: '카페 벽에 붙는 부탁 — 감기약·벌레·잃은 물건.',
  },
};

console.log('━━ 검증 ━━');
{
  const v = validateSchema(S);
  ck('기본 스키마 통과', v.ok, J(v.errors));
  ck('경고 없음 (listVar가 allow에 있고 시간 체계 있음)', !v.warnings.some((w) => w.path.startsWith('$.questBoard')), J(v.warnings));
  const bad = validateSchema({ ...S, questBoard: { ...S.questBoard, listVar: 'renown' } });
  ck('listVar가 list가 아니면 오류', !bad.ok && bad.errors.some((e) => e.path === '$.questBoard.listVar'), J(bad.errors));
  const noList = validateSchema({ ...S, questBoard: { ...S.questBoard, listVar: undefined } });
  ck('listVar 없으면 오류', !noList.ok, '');
  const fx = validateSchema({ ...S, questBoard: { ...S.questBoard, cancel: [{ set: 'quests', expr: 'x' }] } });
  ck('효과가 목록 변수를 겨냥하면 오류', fx.errors.some((e) => e.path === '$.questBoard.cancel[0].set'), J(fx.errors));
  const fx2 = validateSchema({ ...S, questBoard: { ...S.questBoard, cancel: [{ set: 'renown', expr: 'renown - nope' }] } });
  ck('효과 식의 모르는 변수는 오류 (pay·days·grade는 허용)', fx2.errors.some((e) => e.path === '$.questBoard.cancel[0].expr'), J(fx2.errors));
  const band = validateSchema({ ...S, questBoard: { ...S.questBoard, bands: { 심부름: [200, 50] } } });
  ck('밴드 최소>최대 오류', band.errors.some((e) => e.path === '$.questBoard.bands.심부름'), '');
  const orphan = validateSchema({ ...S, questBoard: { ...S.questBoard, bands: { ...S.questBoard.bands, 전설: [1, 2] } } });
  ck('어휘 밖 등급 밴드는 경고', orphan.ok && orphan.warnings.some((w) => w.path === '$.questBoard.bands.전설'), J(orphan.warnings));
  const noAllow = validateSchema({ ...S, updater: { allow: [{ id: 'renown' }] } });
  ck('listVar가 allow에 없으면 경고 (완료·납품은 보조 몫)', noAllow.ok && noAllow.warnings.some((w) => w.path === '$.questBoard.listVar'), J(noAllow.warnings));
  const noTime = validateSchema({ ...S, time: undefined, rules: {} });
  ck('시간 체계 없이 @+{days} 형식이면 경고', noTime.ok && noTime.warnings.some((w) => w.path === '$.questBoard.format'), J(noTime.warnings));
  const minmax = validateSchema({ ...S, questBoard: { ...S.questBoard, minOffers: 9, maxOffers: 6 } });
  ck('minOffers > maxOffers 오류', minmax.errors.some((e) => e.path === '$.questBoard.minOffers'), '');
}

console.log('━━ 구성·상태 ━━');
const cfg = quest.questConfig(S);
{
  ck('구성 기본값 (format 기본 · maxOffers 6 · minOffers 2)', cfg.format === quest.DEFAULT_FORMAT && cfg.maxOffers === 6 && cfg.minOffers === 2, J(cfg));
  ck('questBoard 없으면 null', quest.questConfig({ vars: [] }) === null, '');
  const st = engine.initState(S);
  ck('initState가 의뢰판 상태를 만든다', st.questBoard && Array.isArray(st.questBoard.offers) && st.questBoard.stocked === false, J(st.questBoard));
  const now = quest.nowOf(S, st, engine.makeLookup);
  ck('시간 체계면 경과일 기준', now.kind === 'day' && now.value === 0, J(now));
  const S2 = { ...S, time: undefined, rules: {} };
  const st2 = engine.initState(S2);
  ck('시간 체계 없으면 턴 기준', quest.nowOf(S2, st2, engine.makeLookup).kind === 'turn', '');
}

console.log('━━ 게시 정제 ━━');
{
  const st = engine.initState(S);
  const now = quest.nowOf(S, st, engine.makeLookup);
  const raw = { new: [
    { client: '별의 고치 카페', title: '감기약 3병', grade: '기초', pay: 800, days: 5, note: '손님들이 콜록거린다' },
    { client: '밀밭집 둘째', title: '밭 벌레 퇴치', grade: '심부름', pay: 9999, days: 99 },   // 밴드·기한 클램프
    { client: '수상한 자', title: '드래곤 토벌', grade: '전설', pay: 50000, days: 3 },        // 어휘 밖 → 거부
    { client: '', title: '', pay: 100 },                                                      // 제목 없음 → 무시
    { title: '보수 불명', grade: '기초', pay: 'many' },                                        // 보수 불명 → 거부
  ] };
  const r = quest.sanitizeOffers(cfg, raw, now, () => 0.5);
  ck('정상 2건 + 거부 2건', r.offers.length === 2 && r.rejected.length === 2, J(r));
  ck('보수 밴드 클램프 (심부름 9999 → 200)', r.offers[1].pay === 200, String(r.offers[1].pay));
  ck('기한 범위 클램프 (99 → 14)', r.offers[1].days === 14, String(r.offers[1].days));
  ck('의뢰인 없으면 이름 없는 의뢰인', r.offers[1].client === '밀밭집 둘째' && quest.sanitizeOffers(cfg, { new: [{ title: 'x', grade: '기초', pay: 200 }] }, now).offers[0].client === '이름 없는 의뢰인', '');
  ck('게시 마감은 시스템이 postDays 안에서 (3~5 → 4)', r.offers[0].until === 4, String(r.offers[0].until));
  ck('등급 없으면 첫 등급', quest.sanitizeOffers(cfg, { new: [{ title: 'x', pay: 100 }] }, now).offers[0].grade === '심부름', '');

  const a = quest.applyOffers(S, st, raw, { now, rng: () => 0.5 });
  ck('첫 게시 적용 → stocked · id 부여', a.posted === 2 && st.questBoard.stocked && st.questBoard.offers.every((o) => typeof o.id === 'number'), J(st.questBoard));
  // 보충 — 같은 제목은 안 겹치고, 상한까지만
  const b = quest.applyOffers(S, st, { new: [{ title: '감기약 3병', grade: '기초', pay: 300 }, { title: '새 의뢰', grade: '기초', pay: 300 }] }, { now, rng: () => 0.5 });
  ck('보충: 같은 제목 스킵 · 새 것만 추가', b.posted === 2 && st.questBoard.offers.length === 3, J(st.questBoard.offers.map((o) => o.title)));
  const c = quest.applyOffers(S, st, { new: [{ title: '교체', grade: '기초', pay: 300 }] }, { replace: true, now });
  ck('replace는 통째 교체', c.posted === 1 && st.questBoard.offers.length === 1 && st.questBoard.offers[0].title === '교체', '');
}

console.log('━━ 수락 ━━');
{
  const st = engine.initState(S);
  const now = quest.nowOf(S, st, engine.makeLookup);
  quest.applyOffers(S, st, { new: [
    { client: '별의 고치 카페', title: '감기약 3병', grade: '기초', pay: 400, days: 5, note: '손님들이 콜록거린다' },
    { client: 'A', title: 'a', grade: '심부름', pay: 100, days: 2 },
    { client: 'B', title: 'b', grade: '심부름', pay: 100, days: 2 },
    { client: 'C', title: 'c', grade: '심부름', pay: 100, days: 2 },
  ] }, { now, rng: () => 0 });
  const id0 = st.questBoard.offers[0].id;
  const r = quest.accept(S, st, id0, engine.makeLookup);
  ck('수락 성공', r.ok, J(r));
  ck('목록 항목이 format 그대로 + @+5는 절대 경과값으로 굳는다 (elapsed 0 → @5)', st.vars.quests[0] === '별의 고치 카페 · 감기약 3병 (기초) @5 +400', st.vars.quests[0]);
  ck('게시에서 빠진다', !st.questBoard.offers.some((o) => o.id === id0), '');
  ck('accept 효과 (체력 -1)', st.vars.stamina === 99, String(st.vars.stamina));
  ck('changes에 목록·효과 변수', Array.isArray(r.changes.quests) && r.changes.stamina === 99, J(Object.keys(r.changes)));
  const n = st.meta.pendingNotifies;
  ck('통지 한 줄에 의뢰인·제목·보수·기한·내용', n.length === 1 && n[0].includes('별의 고치 카페 · 감기약 3병') && n[0].includes('400콜') && n[0].includes('기한 5일') && n[0].includes('콜록'), n[0]);
  ck('원장(lastChanges)에도 (보조 이중 계산 방지)', (st.meta.lastChanges || []).some((x) => x.includes('감기약')), '');
  ck('패널 로그', st.questBoard.log.length === 1, '');
  ck('없는 게시 id는 거절', !quest.accept(S, st, 9999, engine.makeLookup).ok, '');
  // 수첩 상한 (maxItems 3)
  const ids = st.questBoard.offers.map((o) => o.id);
  quest.accept(S, st, ids[0], engine.makeLookup); quest.accept(S, st, ids[1], engine.makeLookup);
  const full = quest.accept(S, st, ids[2], engine.makeLookup);
  ck('수첩이 가득 차면 거절 (maxItems)', !full.ok && /가득/.test(full.reason) && st.vars.quests.length === 3, J(full));
  // 다음 전송에 통지가 실리고 소거된다
  const sp = engine.sendPhase(S, st, { rng: seededRng('t', 1, 's') });
  ck('sendPhase 프롬프트에 통지가 실린다', sp.promptBlock.includes('감기약 3병'), '');
  ck('통지는 1회용 (소거)', (sp.state.meta.pendingNotifies || []).length === 0, '');
}

console.log('━━ 취소 ━━');
{
  const st = engine.initState(S);
  st.vars.renown = 30;
  st.vars.quests = ['별의 고치 카페 · 감기약 3병 (기초) @+5 +800', '길드 · 와이번 (위험) @+10 +3000'];
  const r = quest.cancel(S, st, '길드 · 와이번 (위험) @+10 +3000', engine.makeLookup);
  ck('취소 성공 → 목록에서 원문 그대로 빠진다', r.ok && st.vars.quests.length === 1 && st.vars.quests[0].startsWith('별의 고치'), J(st.vars.quests));
  // cancel 효과 — 항목에서 pay(끝수)·days(@+N)만 되읽는다, grade는 빈 문자열 → 3 + floor(3000/1000) = 6
  ck('cancel 효과가 pay를 읽는다 (30 - 3 - 3 = 24)', st.vars.renown === 24, String(st.vars.renown));
  ck('취소 통지', st.meta.pendingNotifies.some((x) => x.includes('의뢰 취소')), J(st.meta.pendingNotifies));
  ck('없는 항목은 거절', !quest.cancel(S, st, '없는 것', engine.makeLookup).ok, '');
  ck('굳힌 기한(@12)은 남은 일수로 되읽는다', (() => { const u = engine.initState(S); u.vars.quests = ['x @12 +100']; const rr = quest.cancel({ ...S, questBoard: { ...S.questBoard, cancel: [{ set: 'stamina', expr: 'days' }] } }, u, 'x @12 +100', engine.makeLookup); return rr.ok && u.vars.stamina === 12; })(), '');
  ck('효과는 min을 지킨다', (() => { st.vars.renown = 1; quest.cancel(S, st, st.vars.quests[0], engine.makeLookup); return st.vars.renown === 0; })(), String(st.vars.renown));
}

console.log('━━ 턴 피기백 · 마감 ━━');
{
  let st = engine.initState(S);
  const spec0 = quest.auxSpec(S, st, engine.makeLookup);
  ck('첫 게시는 즉시 요청', spec0.includes('의뢰판 첫 게시]') && spec0.includes('"quests"'), spec0.slice(0, 80));
  ck('요청에 등급·밴드·기한 범위', spec0.includes('심부름 | 기초') && spec0.includes('심부름 50~200') && spec0.includes('2~14일'), '');
  ck('보조 프롬프트에 얹힌다', engine.buildAuxPrompt(S, st, '', {}).includes('의뢰판 첫 게시]'), '');
  ck('auxHasWork', engine.auxHasWork({ ...S, updater: { allow: [] } }, st), '');
  st.vars.in_town = false;
  ck('when이 닫히면 요청 없음', quest.auxSpec(S, st, engine.makeLookup) === '', '');
  st.vars.in_town = true;

  // outputPhase가 게시를 적용한다
  const rng = seededRng('q', 1, 'o');
  let r = engine.outputPhase(S, st, {}, {}, { rng, quests: { new: [
    { client: 'A', title: 'a', grade: '심부름', pay: 100, days: 2 }, { client: 'B', title: 'b', grade: '기초', pay: 300, days: 3 }, { client: 'C', title: 'c', grade: '기초', pay: 300, days: 3 },
  ] } });
  st = r.state;
  ck('outputPhase가 게시를 적용', st.questBoard.stocked && st.questBoard.offers.length === 3, J(st.questBoard.offers.map((o) => o.title)));
  ck('게시가 minOffers 이상이면 요청 없음', quest.auxSpec(S, st, engine.makeLookup) === '', '');
  // 두 건 수락 → 1건 남음 (< minOffers 2) 그러나 refillEvery 3턴 전
  quest.accept(S, st, st.questBoard.offers[0].id, engine.makeLookup);
  quest.accept(S, st, st.questBoard.offers[0].id, engine.makeLookup);
  ck('minOffers 아래여도 refillEvery 전이면 요청 없음', quest.auxSpec(S, st, engine.makeLookup) === '', String(st.meta.turn));
  st.meta.turn = st.questBoard.lastFill + 3;
  const spec1 = quest.auxSpec(S, st, engine.makeLookup);
  ck('refillEvery가 지나면 보충 요청 (1~5개)', spec1.includes('의뢰판 보충 게시]') && spec1.includes('1~5개'), spec1.slice(0, 60));

  // 마감 — 경과일이 until에 닿으면 시스템이 걷는다 (postDays 3~5)
  const before = st.questBoard.offers.length;
  r = engine.outputPhase(S, st, { skip_day: 10 }, {}, { rng: seededRng('q', 2, 'o') });
  ck('열흘 지나면 게시가 걷힌다', before === 1 && r.state.questBoard.offers.length === 0, J(r.state.questBoard.offers));
  ck('changeLog에 마감 기록', r.changeLog.some((c) => c.id === 'questBoard'), J(r.changeLog.map((c) => c.id)));
  // 시간 체계 없는 봇 — 턴 기준 마감
  const S2 = { ...S, time: undefined, rules: {}, questBoard: { ...S.questBoard, postDays: [2, 2] } };
  let t2 = engine.initState(S2);
  t2 = engine.outputPhase(S2, t2, {}, {}, { rng: seededRng('q', 3, 'o'), quests: { new: [{ title: 'x', grade: '기초', pay: 200 }] } }).state;
  ck('턴 기준: 게시 턴(0) + 2 = 2 (turn++는 게시 뒤)', t2.questBoard.offers[0].until === 2 && t2.meta.turn === 1, J([t2.questBoard.offers[0].until, t2.meta.turn]));
}

console.log('━━ 새로고침 프롬프트 · 파싱 ━━');
{
  const st = engine.initState(S);
  const p = quest.interactionPrompt(S, st, 'refresh', { narrative: '비가 온다.' });
  ck('새로고침 프롬프트에 규격·맥락·출력 형식', p.includes('별의 고치 의뢰판') && p.includes('비가 온다') && p.includes('{"quests":{"new":[...]}}'), '');
  const parsed = quest.parseInteraction('생각중... {"quests":{"new":[{"title":"t","grade":"기초","pay":200,"days":3}]}}', engine.extractJsonObject);
  ck('파싱', parsed && parsed.new.length === 1, J(parsed));
  ck('parseAuxResponse가 quests를 넘긴다', engine.parseAuxResponse('{"changes":{},"reasons":{},"quests":{"new":[]}}').quests !== null, '');
  ck('formatEntry: 빈 등급 괄호 제거', quest.formatEntry({ ...cfg, format: '{title} ({grade}) +{pay}' }, { title: 't', grade: null, pay: 5 }) === 't +5', '');
}

console.log('━━ 어댑터 · 편집기 정적 ━━');
{
  ck('버튼 사양 (kind quest, when 게이트)', src.includes("specs.push({ key: 'quest', kind: 'quest', tab: null, label: qb.label, icon: qb.icon });"), '');
  ck('렌더 분기', src.includes("else if (gameKind === 'quest') renderQuestPanel(root);"), '');
  ck('지연 경로 적용', src.includes('questMod.applyOffers(schema, session.current, parsed.quests'), '');
  ck('보조 출력 상한 가산 (첫 게시·보충 +900)', src.includes("auxPrompt.includes('의뢰판 첫 게시]') || auxPrompt.includes('의뢰판 보충 게시]')) auxCap += 900"), '');
  ck('취소는 두 번 누르기 (alertConfirm 금지 규약)', src.includes("questView.confirm !== itemText"), '');
  ck('수락 뒤 commitPanelChanges (저장·미러·상태창 갱신)', src.includes("await commitPanelChanges(r.changes, '의뢰 수락')"), '');
  ck('편집기 탭', src.includes("['quest', '의뢰판']") && src.includes('quest: tabQuest'), '');
  ck('편집기 슬라이스', src.includes("quest: { keys: ['questBoard'], label: '의뢰판' }"), '');
  ck('AI 규격 문장', src.includes('const SCHEMA_QUEST_RULES'), '');
  ck('CORE 순서에 quest', src.indexOf("'quest'") > 0, '');
}

const pass = R.filter(([c]) => c).length;
for (const [c, n, x] of R) if (!c) console.log(`  ✗ ${n}${x ? ` — ${x}` : ''}`);
console.log(`[test-quest] ${pass}/${R.length} 통과`);
process.exit(pass === R.length ? 0 : 1);
