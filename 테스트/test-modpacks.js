const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.94 — 모듈 팩 매니페스트: 에셋 애드온 모듈이 로어북 항목(⚙simcore-pack)으로 팩 정의를
// 실어 나르고, 옵트인(assets.moduleManifests)한 스키마에 런타임 병합된다.
//
// 배경(실사고): 이미지는 module_assets로 모듈에서 읽는데 팩 정의(에셋 지침)는 스키마 전용이라
// 에셋 애드온을 모듈로 배포할 방법이 없었다 — "에셋지침을 심코어로 해서 배포할 방법이 안 보이네".
//
// 불변식:
//   · 병합된 팩은 origin:'module' 표시 — 편집기·저장 경로가 걸러낸다 (유령 팩 방지)
//   · 후보는 스키마 위에 얹어 validateSchema 통과분만 — 깨진 매니페스트가 봇을 못 죽인다
//   · id 충돌은 스키마 팩·먼저 온 모듈 팩 우선 (검증의 중복 id가 잡는다)
//   · source가 비면 모듈 이름 자동 (고아 팩 추적)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const assets = SC.require('assets');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const J = JSON.stringify;

const PACK = (id, extra = {}) => ({
  id, format: `<img="{name}">`, source: '테스트',
  chars: ['리무'],
  slots: [{ id: 'who', values: ['리무'] }, { id: 'emo', values: ['기쁨', '슬픔'] }],
  ...extra,
});

const SCHEMA = {
  simcore: '0.1', meta: { name: '모듈팩' },
  vars: [{ id: 'nsfw_on', label: '성인', type: 'bool', init: false }],
  assets: { by: 'aux', moduleManifests: true, packs: [PACK('base')] },
};

// ── 매니페스트 파싱 ──
{
  ck('★ 상수 export', assets.MANIFEST_COMMENT === '⚙simcore-pack', assets.MANIFEST_COMMENT);
  ck('단일 객체', assets.parseManifest(J(PACK('a'))).packs.length === 1, '');
  ck('배열', assets.parseManifest(J([PACK('a'), PACK('b')])).packs.length === 2, '');
  ck('{packs:[...]} 꼴', assets.parseManifest(J({ packs: [PACK('a')] })).packs.length === 1, '');
  ck('깨진 JSON은 오류 메시지', assets.parseManifest('{oops').error !== null, '');
  ck('숫자 따위는 거부', assets.parseManifest('42').error !== null, '');
}

// ── 병합 ──
{
  const r = assets.mergeModulePacks(SCHEMA, [
    { label: 'NSFW 에셋', content: J(PACK('nsfw', { when: 'nsfw_on', source: '' })) },
  ], validateSchema);
  ck('★ 정상 팩 병합', r.packs.length === 1 && r.packs[0].id === 'nsfw', J(r.warnings));
  ck('★ origin 표시', r.packs[0]?.origin === 'module', '');
  ck('★ 빈 source는 모듈 이름으로', r.packs[0]?.source === '모듈 NSFW 에셋', r.packs[0]?.source);

  // id 충돌 — 스키마 팩 우선, 후보 탈락 + 경고
  const r2 = assets.mergeModulePacks(SCHEMA, [
    { label: 'M', content: J(PACK('base')) },
  ], validateSchema);
  ck('★ 스키마 팩과 id 충돌 → 탈락', r2.packs.length === 0 && r2.warnings.length === 1, J(r2.warnings));

  // 모듈끼리 충돌 — 먼저 온 쪽 우선
  const r3 = assets.mergeModulePacks(SCHEMA, [
    { label: 'M1', content: J(PACK('dup')) },
    { label: 'M2', content: J(PACK('dup')) },
  ], validateSchema);
  ck('모듈끼리 충돌 → 먼저 온 쪽', r3.packs.length === 1 && r3.packs[0].source === '테스트'
    && r3.warnings.some((w) => w.includes('M2')), J(r3.warnings));

  // 깨진 팩(없는 변수 when) — 그 팩만 탈락, 옆 팩은 산다
  const r4 = assets.mergeModulePacks(SCHEMA, [
    { label: 'M', content: J([PACK('ok1'), PACK('bad', { when: 'ghost_var > 0' }), PACK('ok2')]) },
  ], validateSchema);
  ck('★ 깨진 팩만 탈락, 옆 팩 생존', r4.packs.map((p) => p.id).join(',') === 'ok1,ok2'
    && r4.warnings.some((w) => w.includes('bad')), J([r4.packs.map((p) => p.id), r4.warnings]));

  // 상한
  const many = Array.from({ length: 10 }, (_, i) => PACK('p' + i));
  const r5 = assets.mergeModulePacks(SCHEMA, [{ label: 'M', content: J(many) }], validateSchema);
  ck('상한 8 + 경고', r5.packs.length === 8 && r5.warnings.some((w) => w.includes('상한')), r5.packs.length);

  // 기존 모듈 팩이 이미 스키마에 병합돼 있어도(재스캔) 이중 계산 안 함
  const merged = { ...SCHEMA, assets: { ...SCHEMA.assets, packs: [PACK('base'), { ...PACK('old'), origin: 'module' }] } };
  const r6 = assets.mergeModulePacks(merged, [{ label: 'M', content: J(PACK('old')) }], validateSchema);
  ck('★ 재스캔 시 기존 모듈 팩과 충돌 안 남', r6.packs.length === 1 && r6.packs[0].id === 'old', J(r6.warnings));
}

// ── 검증기 — moduleManifests 필드 ──
{
  ck('★ moduleManifests: true 통과', validateSchema(SCHEMA).ok, J(validateSchema(SCHEMA).errors));
  const bad = { ...SCHEMA, assets: { ...SCHEMA.assets, moduleManifests: 'yes' } };
  ck('불리언 아니면 오류', !validateSchema(bad).ok, '');
}

// ── 병합된 팩이 실제로 라우팅·해석에 잡히는가 ──
{
  const r = assets.mergeModulePacks(SCHEMA, [
    { label: 'M', content: J(PACK('extra', { chars: ['제타'], slots: [{ id: 'who', values: ['제타'] }, { id: 'emo', values: ['웃음'] }] })) },
  ], validateSchema);
  const live = { ...SCHEMA, assets: { ...SCHEMA.assets, packs: [...SCHEMA.assets.packs, ...r.packs] } };
  const routed = assets.routePack(live, '제타', null);
  ck('★ 병합 팩으로 라우팅', routed && routed.id === 'extra', routed && routed.id);
  const res = assets.resolveImage(live, { who: '제타', emo: '웃음' }, new Set(['제타_웃음']), null);
  ck('★ 병합 팩으로 이미지 해석', res.ok && res.name === '제타_웃음', J(res));
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
