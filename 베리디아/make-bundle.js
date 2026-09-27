const __P = (...p) => require('path').resolve(__dirname, ...p);
// 베리디아 개조 번들 — 카드에서 내보낸 번들(원본)의 ⚙simcore만 생성기 산출물로 갈아 끼운다 (2026-09-27).
//
//   node 베리디아/estate-vars.js   → 영지-변수상태창-신안.json (스키마)
//   node 베리디아/make-bundle.js   → 베리디아-번들.json          ← 리수 💾 [번들 가져와 교체]
//
// - 원본 = simcore-bundle-베리디아_남작령.json — 유저 카드에서 💾 [번들 내보내기]로 뜬 것. 카드 로어북이 바뀌면 다시 뜬다.
// - ⚙simcore 말고는 한 글자도 안 바꾼다 (항목 순서·id·폴더·키까지). 바꾼 게 있으면 출력하지 않는다.
// - 정규식은 싣지 않는다 — 번들에 regex가 없으면 적용이 카드 정규식을 안 건드린다. 에셋 태그(<🏰|…>·<🏰💕|…>)를
//   그리는 건 카드 정규식 '에셋'·'야스에셋'이라 그대로 살아 있어야 한다 (`regex`는 통째 교체 — 아틀리에 2026-09-06 실사고).
// - 이미지 지침은 모듈 로어북(감정 에셋·NSFW 에셋)에 있던 것을 스키마 assets 팩으로 옮겼다 — 모듈 로어북이 켜져 있으면
//   지침이 두 벌 실린다. 카드에 이미지가 전부 있으니(1995장, 모듈에만 있는 건 번호 붙은 옛 이름뿐) 모듈은 꺼도 된다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const { validateSchema } = globalThis.__SC.require('validate');

const ORIG = JSON.parse(fs.readFileSync(__P('simcore-bundle-베리디아_남작령.json'), 'utf8'));
const SCHEMA = JSON.parse(fs.readFileSync(__P('영지-변수상태창-신안.json'), 'utf8'));
let bad = 0;
const ok = (n, c, got = '') => { console.log(`  ${c ? '✓' : '❗'} ${n}${got ? ' → ' + got : ''}`); if (!c) bad++; };

console.log('━━ 베리디아 번들 ━━');
ok('원본이 번들 형식', ORIG.simcoreBundle === 1 && Array.isArray(ORIG.lorebook), `로어북 ${ORIG.lorebook?.length}항목 · 정규식 ${ORIG.regex?.length ?? 0}개`);
const v = validateSchema(SCHEMA);
ok('스키마 검증', v.ok, v.ok ? `경고 ${v.warnings.length}` : JSON.stringify(v.errors.slice(0, 3)));

const idx = ORIG.lorebook.findIndex((l) => l.comment === '⚙simcore');
ok('원본에 ⚙simcore 항목이 하나', idx >= 0 && ORIG.lorebook.filter((l) => l.comment === '⚙simcore').length === 1, `#${idx}`);
const lorebook = ORIG.lorebook.map((l, i) => (i === idx ? { ...l, content: JSON.stringify(SCHEMA) } : { ...l }));

// ⚙simcore 말고는 원본 그대로인가
const same = lorebook.every((l, i) => i === idx || JSON.stringify(l) === JSON.stringify(ORIG.lorebook[i]));
ok('⚙simcore 밖은 원본과 한 글자도 안 다르다', same && lorebook.length === ORIG.lorebook.length);
ok('⚙simcore는 절대 안 뜨는 보관함 그대로', lorebook[idx].alwaysActive === false && /__simcore_never__/.test(lorebook[idx].key), JSON.stringify(lorebook[idx].key));
// 이미지 지침이 로어북에 남아 있으면 스키마 주입문과 두 벌이 된다 (지금 카드엔 없다 — 모듈 쪽이다)
const dup = lorebook.filter((l, i) => i !== idx && /<🏰💕?\|/.test(l.content || ''));
ok('카드 로어북에 옛 이미지 지침 없음', dup.length === 0, dup.map((l) => l.comment).join(', '));

const before = JSON.parse(ORIG.lorebook[idx].content);
const kinds = Object.keys(SCHEMA).filter((k) => JSON.stringify(SCHEMA[k]) !== JSON.stringify(before[k]));
console.log(`  · 스키마에서 바뀐 절: ${kinds.join(', ') || '(없음)'}`);

if (bad) { console.log(`\n❗ ${bad}건 — 출력하지 않는다`); process.exit(1); }
const bundle = {
  simcoreBundle: 1,
  name: '베리디아 남작령 (심코어판)',
  lorebook,
  // regex 없음 — 카드 정규식(상태창·요약·에셋 표시 둘)을 그대로 둔다
};
fs.writeFileSync(__P('베리디아-번들.json'), JSON.stringify(bundle, null, 2));
console.log(`\n저장: 베리디아-번들.json (${(fs.statSync(__P('베리디아-번들.json')).size / 1024).toFixed(1)}KB) ← 이걸 [번들 가져와 교체]`);
