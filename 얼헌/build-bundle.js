// 얼헌 배포 번들 조립 — 정본 스키마·정규식을 번들 한 벌로 묶는다 (docs/design-얼헌-개조.md §P11)
//
// 번들은 원래 리수에서 [번들 내보내기]로 뽑았다. 로어북 본문은 이 리포와 같고 달라지는 건
// ⚙simcore(스키마)와 정규식뿐이라 리수 없이 여기서 만든다. 틀은 기존 번들 — 로어북 항목의 id·순서를 그대로 둔다.
// 형식은 플러그인 bundleFromChar와 같다: { simcoreBundle: 1, name, lorebook, regex } (regex = 통째 교체).
// DLC 모듈 손질 항목(hunter-dlc.js dlcLore)은 여기서 로어북 끝에 얹는다 — 리포 로어북 JSON엔 없는 번들 전용 항목.
//
// 실행 순서: node 얼헌/hunter-vars.js → (cd 얼헌 && node convert-import.js) → node 얼헌/build-bundle.js
const fs = require('fs');
const __P = (...p) => require('path').resolve(__dirname, ...p);
const { dlcLore } = require('./hunter-dlc');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const TEMPLATE = __P('../얼헌 개조용/배포용/simcore-bundle-얼터헌터.json');
const OUT = __P('../얼헌 개조용/배포용/simcore-bundle-얼터헌터(DLC 호환).json');
const SCHEMA_COMMENT = '⚙simcore';

const bundle = readJson(TEMPLATE);
const schema = readJson(__P('헌터-신안.json'));
const lore = readJson(__P('얼헌-로어북-심코어판.json')).data;
const regex = readJson(__P('얼헌-정규식-심코어판.json')).data;

// 틀의 로어북이 리포 정본에서 벗어나면 조용히 옛 본문을 싣게 된다 — 만들지 않고 멈춘다
const repo = new Map(lore.map((e) => [e.comment, e.content || '']));
const drift = bundle.lorebook.filter((e) => e.comment !== SCHEMA_COMMENT && repo.get(e.comment) !== (e.content || ''));
if (drift.length || bundle.lorebook.length !== lore.length + 1) {
  console.error('❗ 틀 번들과 리포 로어북이 다르다:', drift.map((e) => e.comment).join(', ') || `항목 수 ${bundle.lorebook.length}`);
  process.exit(1);
}

const slot = bundle.lorebook.find((e) => e.comment === SCHEMA_COMMENT);
slot.content = JSON.stringify(schema);
bundle.lorebook.push(...dlcLore());
bundle.regex = regex;
fs.writeFileSync(OUT, JSON.stringify(bundle, null, 2));
console.log(`저장: ${OUT}  (로어북 ${bundle.lorebook.length} · 정규식 ${bundle.regex.length} · 스키마 ${slot.content.length}자)`);
