const __P = (...p) => require('path').resolve(__dirname, ...p);
// AI 왕복 패치 — add/update/remove 병합, 충돌 3지선다, 개명 파급, 원자성
// (설계: docs/design-ai-왕복-패치.md)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const P = SC.require('patch');
const { validateSchema } = SC.require('validate');
const { renameVar } = SC.require('expr');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// 실험대 스키마 — 변수·파생·이벤트·액션·판정·allow가 다 있는 최소 구성
const BASE = {
  simcore: '0.1', meta: { name: '패치 실험대' },
  vars: [
    { id: 'gold', label: '금화', type: 'int', init: 100, min: 0 },
    { id: 'hope', label: '희망', type: 'int', init: 50, min: 0, max: 100 },
    { id: 'contracts', label: '계약', type: 'list', init: [] },
    { id: 'famine', label: '기근', type: 'bool', init: false },
  ],
  derived: [{ id: 'wealthy', label: '부유함', expr: 'gold >= 500' }],
  rules: {
    events: [
      { id: 'broke', when: 'gold < 1 and not famine', effects: [{ set: 'famine', expr: 'true' }], notify: '금고가 비었다.' },
    ],
  },
  directives: [{ id: 'd_broke', when: 'famine', text: '재정 파탄 상태다. 금화 {gold}.' }],
  actions: [{ id: 'work', label: '⚒ 노역', mode: 'oneshot', effects: [{ set: 'gold', expr: 'gold + 10' }] }],
  checks: [{
    id: 'luck', label: '운수', roll: 'rand(1,20)',
    grades: [{ when: 'roll >= 15', label: '길조', effects: [{ set: 'hope', expr: 'min(100, hope + 5)' }] }, { label: '평범' }],
  }],
  updater: { allow: [{ id: 'gold', maxGain: 100, maxLoss: 500 }] },
  statusUI: { mode: 'auto', groups: [] },
};
ck('실험대 스키마 자체가 유효', validateSchema(BASE).ok,
  validateSchema(BASE).errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));
const snap = () => JSON.parse(JSON.stringify(BASE));
const baseJson = JSON.stringify(BASE);

// ── parsePatch: 입력 관용 + 헛짚음 감지 ──
{
  const frag = '{"add":{"vars":[{"id":"mana","type":"int","init":0}]}}';
  ck('맨 JSON', P.parsePatch(frag).ok, '');
  ck('```json 펜스', P.parsePatch('```json\n' + frag + '\n```').ok, '');
  ck('앞뒤 설명 섞여도', P.parsePatch('만들었습니다:\n```json\n' + frag + '\n```\n확인하세요').ok, '');
  ck('깨진 JSON은 거부', !P.parsePatch('{oops').ok, '');
  ck('배열은 거부 (패치 최상위는 객체)', !P.parsePatch('[1,2]').ok, '');
  ck('patchVersion 1은 허용', P.parsePatch({ patchVersion: 1, add: { vars: [{ id: 'x' }] } }).ok, '');
  ck('patchVersion 2는 거부', !P.parsePatch({ patchVersion: 2, add: { vars: [{ id: 'x' }] } }).ok, '');
  ck('빈 패치는 거부', !P.parsePatch({ add: {} }).ok, '');

  const nested = P.parsePatch({ add: { rules: { events: [{ id: 'e1', when: 'true' }] }, updater: { allow: [{ id: 'gold' }] } } });
  ck('★ 스키마 모양(rules.events)도 받아줌', nested.ok && nested.patch.add.events.length === 1, JSON.stringify(nested.errors));
  ck('★ updater.allow도 평평한 allow로', nested.ok && nested.patch.add.allow.length === 1, '');

  const bad = P.parsePatch({ add: { statusUI: [{ id: 'g' }] } });
  ck('statusUI는 병합 미지원 안내', !bad.ok && bad.errors[0].includes('통 교체'), bad.errors.join(' / '));
  const unk = P.parsePatch({ add: { evnets: [{ id: 'e' }] } });
  ck('오타 섹션은 가능 목록과 함께 거부', !unk.ok && unk.errors[0].includes('가능:'), unk.errors.join(' / '));
  const onTurn = P.parsePatch({ add: { rules: { onTurn: [{ set: 'gold', expr: '1' }] } } });
  ck('onTurn은 무id라 미지원 안내', !onTurn.ok && onTurn.errors[0].includes('onTurn'), '');
  ck('패치 안 중복 id 거부', !P.parsePatch({ add: { vars: [{ id: 'a' }, { id: 'a' }] } }).ok, '');
  const rmObj = P.parsePatch({ remove: { events: [{ id: 'broke' }, 'other'] } });
  ck('remove는 문자열·객체 둘 다', rmObj.ok && rmObj.patch.remove.events.join(',') === 'broke,other', '');
}

// ── planPatch: 충돌·헛짚음 ──
{
  const S = snap();
  const clean = P.parsePatch({ add: { vars: [{ id: 'mana', type: 'int', init: 0 }], events: [{ id: 'e_mana', when: 'mana > 10', effects: [] }] } }).patch;
  const plan = P.planPatch(S, clean);
  ck('깨끗한 add: 충돌·오류 없음', !plan.errors.length && !plan.conflicts.length, JSON.stringify(plan.errors));
  ck('요약 집계', plan.summary.add === 2 && plan.summary.update === 0, JSON.stringify(plan.summary));

  const col = P.planPatch(S, P.parsePatch({ add: { events: [{ id: 'broke', when: 'true', effects: [] }] } }).patch);
  ck('★ add 충돌은 오류가 아니라 충돌로 (조용한 교체 금지)', !col.errors.length && col.conflicts.length === 1, '');
  ck('충돌 선택지 = 교체/개명/건너뛰기', col.conflicts[0].options.join('/') === 'replace/rename/skip', '');
  ck('충돌에 기존 항목 실림 (diff 표시용)', col.conflicts[0].existing.notify === '금고가 비었다.', '');

  const cross = P.planPatch(S, P.parsePatch({ add: { vars: [{ id: 'wealthy', type: 'int', init: 0 }] } }).patch);
  ck('★ 파생과 이름 겹침: 교체 선택지 없음', cross.conflicts.length === 1 && !cross.conflicts[0].options.includes('replace'), JSON.stringify(cross.conflicts));

  const up = P.planPatch(S, P.parsePatch({ update: { vars: [{ id: 'ghost', type: 'int', init: 0 }] } }).patch);
  ck('★ update 헛짚음(없는 id)은 오류', up.errors.length === 1 && up.errors[0].includes('ghost'), up.errors.join(' / '));

  const ty = P.planPatch(S, P.parsePatch({ update: { vars: [{ id: 'gold', label: '금화', type: 'text', init: '' }] } }).patch);
  ck('★ update 타입 변경은 경고 (세이브 충돌 위험)', ty.warnings.length === 1 && ty.warnings[0].includes('int→text'), ty.warnings.join(' / '));

  const rm = P.planPatch(S, P.parsePatch({ remove: { vars: ['ghost'] } }).patch);
  ck('remove 헛짚음은 경고 + 무시', !rm.errors.length && rm.warnings[0].includes('원래 없음') && rm.summary.remove === 0, '');

  const dup = P.planPatch(S, P.parsePatch({ add: { vars: [{ id: 'x', type: 'int', init: 0 }] }, remove: { vars: ['x'] } }).patch);
  ck('같은 id를 add와 remove가 같이 다루면 오류', dup.errors.length === 1, dup.errors.join(' / '));
}

// ── applyPatch: 행복 경로 ──
{
  const S = snap();
  const patch = P.parsePatch({
    add: {
      vars: [{ id: 'raid_alert', label: '산적 경계', type: 'int', init: 0, min: 0, max: 10 }],
      events: [{ id: 'bandit_raid', when: 'raid_alert >= 5 and gold >= 100', effects: [{ set: 'gold', expr: 'max(0, gold - 50)' }], notify: '산적이 들이닥쳤다!' }],
      allow: [{ id: 'raid_alert', maxDelta: 2 }],
    },
  }).patch;
  const r = P.applyPatch(S, patch);
  ck('★ 행복 경로 적용 성공', r.ok, JSON.stringify(r.errors));
  ck('변수·이벤트·allow가 들어감', r.schema.vars.length === 5 && r.schema.rules.events.length === 2 && r.schema.updater.allow.length === 2, '');
  ck('적용 결과가 통짜 검증 통과', validateSchema(r.schema).ok, '');
  ck('★ 원본 스키마는 무변 (깊은 사본)', JSON.stringify(S) === baseJson, '');
  ck('적용 내역 보고', r.applied.added.length === 3 && !r.applied.updated.length, JSON.stringify(r.applied));
}

// ── applyPatch: 충돌 해소 3지선다 ──
{
  const S = snap();
  const mk = () => P.parsePatch({ add: { events: [{ id: 'broke', when: 'gold < 5', effects: [], notify: '새 파산 이벤트' }] } }).patch;

  const un = P.applyPatch(S, mk());
  ck('★ 충돌 미해결이면 정지 (원자성)', !un.ok && un.errors[0].includes('충돌 미해결'), un.errors.join(' / '));

  const rep = P.applyPatch(S, mk(), { 'events:broke': 'replace' });
  ck('교체: 기존 항목이 새것으로', rep.ok && rep.schema.rules.events[0].notify === '새 파산 이벤트', JSON.stringify(rep.errors));
  ck('교체해도 개수 그대로', rep.ok && rep.schema.rules.events.length === 1, '');

  const skip = P.applyPatch(S, mk(), { 'events:broke': 'skip' });
  ck('건너뛰기: 기존 유지', skip.ok && skip.schema.rules.events[0].notify === '금고가 비었다.', '');
  ck('건너뛴 항목 보고', skip.ok && skip.applied.skipped.length === 1, '');

  const badMode = P.applyPatch(S, P.parsePatch({ add: { vars: [{ id: 'wealthy', type: 'int', init: 0 }] } }).patch, { 'vars:wealthy': 'replace' });
  ck('선택지에 없는 해소안은 거부 (파생 충돌에 replace)', !badMode.ok, '');
}

// ── ★ 개명 파급: 새 id가 패치 전체의 참조를 따라간다 ──
{
  const S = snap();
  // hope와 겹치는 변수를 만들고, 패치 안의 다른 항목들이 그 변수를 참조하는 상황
  const patch = P.parsePatch({
    add: {
      vars: [{ id: 'hope', label: '사기', type: 'int', init: 0, min: 0 }],
      events: [{
        id: 'rally', when: 'hope >= 3 and has(contracts, "hope")',
        effects: [{ set: 'hope', expr: 'hope + 1' }],
        choices: [
          { label: '집회를 연다', effects: [{ set: 'hope', expr: 'hope + 2' }] },
          { label: '해산한다', effects: [] },
        ], timeout: 2,
      }],
      directives: [{ id: 'd_rally', when: 'hope > 5', text: '사기가 높다 (사기 {hope}).' }],
      checks: [{ id: 'rally_check', roll: 'rand(1,6)', mod: 'floor(hope / 2)', label: '집회 판정',
        grades: [{ when: 'roll + mod >= 5', label: '성공', effects: [{ set: 'hope', expr: 'hope + 1' }] }, { label: '실패' }] }],
    },
  }).patch;
  const r = P.applyPatch(S, patch, { 'vars:hope': { rename: 'morale' } });
  ck('★ 개명 적용 성공', r.ok, JSON.stringify(r.errors));
  if (r.ok) {
    const ev = r.schema.rules.events.find((e) => e.id === 'rally');
    const dr = r.schema.directives.find((d) => d.id === 'd_rally');
    const chk = r.schema.checks.find((c) => c.id === 'rally_check');
    ck('변수 자체가 개명됨', r.schema.vars.some((v) => v.id === 'morale'), '');
    ck('이벤트 when의 참조 개명', ev.when.includes('morale >= 3'), ev.when);
    ck('★ 문자열 리터럴 "hope"는 안 건드림', ev.when.includes('"hope"'), ev.when);
    ck('effects set 대상 개명', ev.effects[0].set === 'morale' && ev.effects[0].expr === 'morale + 1', '');
    ck('갈림길 effects까지 개명', ev.choices[0].effects[0].set === 'morale', '');
    ck('지시문 when + {자리표시자} 개명', dr.when.includes('morale') && dr.text.includes('{morale}'), dr.text);
    ck('판정 mod·등급 effects 개명', chk.mod === 'floor(morale / 2)' && chk.grades[0].effects[0].set === 'morale', '');
    ck('기존 hope 변수는 그대로', r.schema.vars.some((v) => v.id === 'hope' && v.label === '희망'), '');
    ck('개명 결과가 통짜 검증 통과', validateSchema(r.schema).ok, '');
  }
  const again = P.applyPatch(S, patch, { 'vars:hope': { rename: 'gold' } });
  ck('★ 개명한 id가 또 겹치면 정지', !again.ok, JSON.stringify(again.errors));
  const badId = P.applyPatch(S, patch, { 'vars:hope': { rename: '3급' } });
  ck('개명 id 형식 검사', !badId.ok, '');
}

// ── ★ 원자성: 하나라도 틀리면 전무 ──
{
  const S = snap();
  // 이벤트는 멀쩡한데 그 이벤트가 쓰는 변수 추가를 건너뛰면 → 참조 파손 → 전부 거부
  const patch = P.parsePatch({
    add: {
      vars: [{ id: 'gold', type: 'int', init: 0 }],   // 충돌 예정
      events: [{ id: 'e_need', when: 'sanity > 0', effects: [] }],  // sanity는 어디에도 없음
    },
  }).patch;
  const r = P.applyPatch(S, patch, { 'vars:gold': 'skip' });
  ck('★ 검증 실패 시 전무 적용', !r.ok && r.errors[0].includes('아무것도 적용되지 않음'), r.errors.join(' / '));
  ck('실패 사유에 검증 위치 실림', r.errors.some((e) => e.includes('sanity')), r.errors.join(' / '));

  const bad = P.applyPatch(S, P.parsePatch({ add: { events: [{ id: 'e_bad', when: 'gold +* 3', effects: [] }] } }).patch);
  ck('깨진 식도 병합 후 검증에서 잡힘', !bad.ok, '');
}

// ── update = 항목 통 교체 ──
{
  const S = snap();
  const r = P.applyPatch(S, P.parsePatch({ update: { actions: [{ id: 'work', label: '⚒ 중노동', effects: [{ set: 'gold', expr: 'gold + 30' }] }] } }).patch);
  ck('update 성공', r.ok, JSON.stringify(r.errors));
  ck('항목이 통째로 바뀜 (mode 필드도 사라짐)', r.ok && r.schema.actions[0].mode === undefined && r.schema.actions[0].label === '⚒ 중노동', '');
}

// ── remove ──
{
  const S = snap();
  const r = P.applyPatch(S, P.parsePatch({ remove: { events: ['broke'], directives: ['d_broke'] } }).patch);
  ck('remove 성공', r.ok && r.schema.rules.events.length === 0 && r.schema.directives.length === 0, JSON.stringify(r.errors));
  ck('제거 내역 보고', r.ok && r.applied.removed.length === 2, '');
  const dep = P.applyPatch(S, P.parsePatch({ remove: { vars: ['gold'] } }).patch);
  ck('★ 참조되는 변수 제거는 검증이 막음 (전무)', !dep.ok, JSON.stringify(dep.errors));
}

// ── 판정 개명: check 참조 파급 ──
{
  const S = snap();
  const patch = P.parsePatch({
    add: {
      checks: [{ id: 'luck', label: '새 운수', roll: 'rand(1,10)', grades: [{ label: '기본' }] }],
      actions: [{ id: 'gamble', label: '🎲 도박', check: 'luck', effects: [] }],
    },
  }).patch;
  const r = P.applyPatch(S, patch, { 'checks:luck': { rename: 'luck2' } });
  ck('판정 개명 성공', r.ok, JSON.stringify(r.errors));
  ck('★ 액션의 check 참조가 따라감', r.ok && r.schema.actions.find((a) => a.id === 'gamble').check === 'luck2', '');
  ck('기존 luck 판정 무변', r.ok && r.schema.checks.some((c) => c.id === 'luck' && c.label === '운수'), '');
}

// ── suggestFreeId / renameVar 단위 ──
{
  const S = snap();
  ck('빈자리 제안', P.suggestFreeId(S, { add: {}, update: {}, remove: {} }, 'vars', 'gold') === 'gold2', '');
  const busy = { add: { vars: [{ id: 'gold2' }] }, update: {}, remove: {} };
  ck('패치 안의 id도 피함', P.suggestFreeId(S, busy, 'vars', 'gold') === 'gold3', '');
  ck('renameVar: 단어 경계', renameVar('gold + gold2', 'gold', 'g') === 'g + gold2', renameVar('gold + gold2', 'gold', 'g'));
  ck('renameVar: 문자열 보호', renameVar('has(list, "gold") and gold > 0', 'gold', 'g') === 'has(list, "gold") and g > 0', '');
  ck('renameVar: 깨진 식은 그대로', renameVar('gold +* @', 'gold', 'g') === 'gold +* @', '');
}

// ── ★ 랜덤 이벤트 발동률 (감사에서 잡힌 결함의 회귀) ──
// AI가 스키마 모양대로 chancePerTurn까지 올바르게 보내면 조용히 버려져서,
// "AI가 맞게 해도 검증 실패"라는 최악의 경로가 있었다.
{
  const S = snap();
  delete S.rules.randomEvents;   // 랜덤 이벤트가 없던 봇

  const noChance = P.applyPatch(S, P.parsePatch({ add: { randomEvents: [{ id: 'rnd1', effects: [], notify: 'x' }] } }).patch);
  ck('★ 첫 랜덤인데 발동률 없음 → 해법이 담긴 오류', !noChance.ok && noChance.errors[0].includes('randomEventsChance'), noChance.errors.join(' / '));

  const nested = P.parsePatch({ add: { rules: { randomEvents: { chancePerTurn: 0.25, table: [{ id: 'rnd1', effects: [], notify: 'x' }] } } } });
  ck('★ 스키마 모양의 chancePerTurn을 버리지 않고 받음', nested.ok && nested.patch.randomEventsChance === 0.25, JSON.stringify(nested.patch));
  const r1 = P.applyPatch(S, nested.patch);
  ck('★ 첫 랜덤 + 발동률 동봉 → 적용 성공', r1.ok && r1.schema.rules.randomEvents.chancePerTurn === 0.25 && r1.schema.rules.randomEvents.table.length === 1, JSON.stringify(r1.errors));

  const flat = P.parsePatch({ randomEventsChance: 0.05, add: { randomEvents: [{ id: 'rnd1', effects: [], notify: 'x' }] } });
  ck('평평한 randomEventsChance도 받음', flat.ok && flat.patch.randomEventsChance === 0.05, '');

  const only = P.parsePatch({ randomEventsChance: 0.02 });
  ck('발동률만 바꾸는 패치도 성립', only.ok, JSON.stringify(only.errors));
  const S2 = snap(); S2.rules.randomEvents = { chancePerTurn: 0.3, table: [] };
  const r2 = P.applyPatch(S2, only.patch);
  ck('발동률만 갱신', r2.ok && r2.schema.rules.randomEvents.chancePerTurn === 0.02, '');

  ck('발동률 범위 검사 (1.5 거부)', !P.parsePatch({ randomEventsChance: 1.5 }).ok, '');
}

// ── AI 실수 1순위: add 없이 최상위 섹션 — 안내가 있어야 함 ──
{
  const p = P.parsePatch({ vars: [{ id: 'mana', type: 'int', init: 0 }] });
  ck('★ 최상위 섹션 오류에 add 안내 포함', !p.ok && p.errors[0].includes('add 안에'), p.errors.join(' / '));
}

// ── 편집기 계층: 수정 요청 프롬프트(② 내보내기) — test-tabai와 같은 추출 방식 ──
{
  const { TEMPLATES } = SC.require('templates');
  const seg = src.slice(src.indexOf('const SCHEMA_HARD_RULES = ['), src.indexOf('// 행 이동/삭제 버튼 묶음'));
  const M = new Function('validateSchema', 'TEMPLATES',
    seg + '\nreturn { buildPatchExportPrompt, patchIdDigest };')(validateSchema, TEMPLATES);

  const S = snap();
  S.statusUI = { mode: 'custom', template: '<div>ZZZ_CSS_MARKER</div>', groups: [] };
  const pr = M.buildPatchExportPrompt(S);
  ck('프롬프트: 패치 형식 명세 포함', pr.includes('patchVersion') && pr.includes('"add"'), '');
  ck('프롬프트: add/update/remove 규칙 설명', pr.includes('새 id를 지으세요') && pr.includes('통째로 다시') && pr.includes('명시적으로 지워달라고 한 것만'), '');
  ck('★ 기존 id 다이제스트 동봉 (변수·이벤트·액션·판정)',
    pr.includes('`gold`') && pr.includes('"id":"broke"') && pr.includes('"id":"work"') && pr.includes('"id":"luck"'), '');
  ck('다이제스트에 이벤트 when 실림', pr.includes('gold < 1 and not famine'), '');
  ck('★ 다이제스트에 항목 전문 실림 (effects까지) — update가 장님이 되지 않게 (v0.44.1)',
    pr.includes('"set":"famine"') && pr.includes('"maxGain":100'), '');
  ck('★ 같은 id remove+add 금지 규칙 명시 (v0.44.1)', pr.includes('`remove`와 `add`에 함께 넣지'), '');
  ck('인물 묶음 mentions 공유는 정상이라고 명시 (v0.44.1)', pr.includes('mentions 낱말을 공유'), '');
  ck('★ 상태창 내용은 안 실림 (다이제스트가 가벼운 이유)', !pr.includes('ZZZ_CSS_MARKER'), '');
  ck('미지원 섹션 안내', pr.includes('statusUI') && pr.includes('못 다룹니다'), '');
  ck('평평한 섹션 키 안내', pr.includes('`randomEvents`') && pr.includes('`allow`'), '');
  ck('allow 판단 기준 경고 (판정값·플래그 금지)', pr.includes('allow에 넣지 마세요'), '');
  ck('수식·절대 규칙 동봉', pr.includes('수식 언어') && pr.includes('절대 규칙'), '');
  ck('통짜 규격서보다 가벼움', pr.length < 12 * 1024, (pr.length / 1024).toFixed(1) + 'KB');

  const dg = M.patchIdDigest(S);
  ck('다이제스트: 랜덤·갈림길 표기 준비', typeof dg === 'string' && dg.includes('### 변수'), '');

  // 번들 배선 스모크 — 편집기 ② 섹션이 실제로 실려 있는지 (빌드 누락 감지)
  ck('★ 번들에 ② 섹션 문자열 존재', src.includes('② AI에게 스키마 고치게 하기'), '');
  ck('번들에 패치 검사 버튼 존재', src.includes('🔍 패치 검사'), '');
  ck('★ 번들에 경고 접기(details) 존재 — 경고 벽이 오류를 가리지 않게 (v0.44.1)',
    src.includes('sce-fold') && src.includes('눌러서 펼치기'), '');
  ck('★ 충돌 일괄 버튼 존재 (v0.44.2)',
    src.includes('전부 교체') && src.includes('전부 새 id') && src.includes('전부 건너뛰기'), '');
  ck('충돌 다발 = 낡은 규격 힌트 존재 (v0.44.2)', src.includes('낡은 규격으로 만든 패치일 수'), '');
  ck('삭제 후보 전체 토글 존재 (v0.44.2)', src.includes('전체 체크') && src.includes('전체 해제'), '');
  ck('어댑터 버전 v0.44.2', src.includes('//@version 0.44.2'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
