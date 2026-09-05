const __P = (...p) => require('path').resolve(__dirname, ...p);
// 아틀리에 로어북 정리 → 개조 번들 (docs/design-아틀리에.md §7)
//
// 리수에는 로어북 일괄삭제가 없다. 그래서 "원본에서 하나씩 지우세요"가 아니라
// **번들 한 파일로 통째 교체**한다 (adapter §개조 번들 v1.0.5 — 💾 세이브 페이지 [번들 가져와 교체]).
// 스키마(⚙simcore)도 로어북에 실려 함께 가므로 세이브 파일조차 따로 필요 없다.
//
// 하는 일:
//   1. 심코어와 충돌하는 항목 삭제 (상태창 이중 표시·캐스트 맵 이중 전송)
//   2. 심코어나 다른 항목이 이미 하는 일을 always-on으로 또 하는 항목을 키워드 활성으로 강등
//   3. ⚙simcore 스키마 항목 첨부
//   4. 번들 + (예비용) 로어북 단독 JSON 출력
//
// 실행: node 아틀리에/convert-lorebook.js
const fs = require('fs');

const SRC = JSON.parse(fs.readFileSync(__P('lorebook_export.json'), 'utf8'));
const SCHEMA = JSON.parse(fs.readFileSync(__P('공방-아틀리에.json'), 'utf8'));
const src = SRC.data;

const tok = (s) => Math.round(String(s || '').length / 3.2);   // 로어북 표시와 같은 어림
let bad = 0;
const fail = (msg) => { console.log('  ❗ ' + msg); bad++; };

// ══════════ 정리 계획 ══════════
// 삭제 — 남겨 두면 심코어와 정면으로 부딪힌다
const DROP = {
  'npc 리스트': '심코어 지시문 8벌(origin별)로 구워졌다 — 남기면 3,792t가 이중으로 실린다',
  상태창: '심코어 상태창이 대체 — 남기면 본문 아래에 상태 블록이 두 개 뜬다',
  '상태창/인벤토리 운영 규칙': 'updater.guide + 변수 desc로 이관됐다',
};
// 강등 (always-on → 키워드 활성) — 대체재가 있는 것만. 내용은 그대로 둔다
const DEMOTE = {
  '아이템 목록': '38~43·45~48이 같은 어휘를 더 자세히 들고 있다',
  '소재 목록': '51~58이 같은 어휘를 지역별로 들고 있다',
  '의뢰 퀘스트 구조': '61~65 + 심코어 quests·board가 대체',
  '난이도 보상 실패 처리': '심코어 updater.guide·shop.bands·의뢰 만료 이벤트가 대체',
};
// 키가 어구뿐이라("아이템 목록") 강등하면 영영 안 뜨는 항목 — 자연어 낱말을 보탠다.
// "연금술"처럼 이 봇에서 매 턴 나오는 낱말은 넣지 않는다 (그러면 강등한 뜻이 없다).
const ADD_KEYS = { '아이템 목록': ['조합', '레시피', '아이템'] };
// always-on 유지 — 대체하는 것이 없다
const KEEP_ALWAYS = {
  이방인: '이방인이 란타르나를 덮어쓰지 않게 하는 **규칙**이다 (어휘가 아니라). 계열 시작이 이 봇의 축이라 상시가 맞다',
  퓨처플랜: '[💡Request Profile] 프로필 호출 장치 — 심코어가 대체하지 않는다',
};

// ══════════ 변환 ══════════
const before = src.filter((e) => e.alwaysActive).reduce((n, e) => n + tok(e.content), 0);
const out = [];
const report = { dropped: [], demoted: [], kept: 0 };

// 순서는 원본 그대로 둔다 — 폴더 소속이 위치로 정해지므로 재배열하면 안 된다
for (const e of src) {
  const c = String(e.comment || '');
  if (DROP[c]) { report.dropped.push([c, tok(e.content), DROP[c]]); continue; }
  const item = { ...e };
  if (DEMOTE[c]) {
    if (!item.alwaysActive) fail(`'${c}'는 이미 always-on이 아니다 — 계획이 원본과 어긋났다`);
    item.alwaysActive = false;
    if (ADD_KEYS[c]) {
      const have = String(item.key || '').split(',').map((s) => s.trim());
      const add = ADD_KEYS[c].filter((k) => !have.includes(k));
      if (add.length) item.key = `${add.join(', ')}, ${item.key}`;
    }
    report.demoted.push([c, tok(e.content), DEMOTE[c]]);
  }
  out.push(item);
  report.kept++;
}

// ⚙simcore — 절대 안 뜨는 보관함 (adapter installSchemaToCurrentChar와 같은 모양)
out.push({
  key: ' __simcore_never__', comment: '⚙simcore', content: JSON.stringify(SCHEMA),
  mode: 'normal', insertorder: 0, alwaysActive: false, secondkey: '', selective: false,
  bookVersion: 2, id: 'lm_simcore_schema', disabled: false,
});

const after = out.filter((e) => e.alwaysActive).reduce((n, e) => n + tok(e.content), 0);

// ══════════ 확인 ══════════
console.log('━━ 정리 확인 ━━');
for (const c of Object.keys(DROP)) {
  if (!report.dropped.some(([n]) => n === c)) fail(`삭제 대상 '${c}'을 원본에서 못 찾았다`);
}
for (const c of Object.keys(DEMOTE)) {
  if (!report.demoted.some(([n]) => n === c)) fail(`강등 대상 '${c}'을 원본에서 못 찾았다`);
}
for (const c of Object.keys(KEEP_ALWAYS)) {
  const e = out.find((x) => x.comment === c);
  if (!e) fail(`유지 대상 '${c}'이 사라졌다`);
  else if (!e.alwaysActive) fail(`'${c}'의 always-on이 꺼졌다`);
}
{
  const folders = out.filter((e) => e.mode === 'folder').length;
  const srcFolders = src.filter((e) => e.mode === 'folder').length;
  if (folders !== srcFolders) fail(`폴더가 ${srcFolders} → ${folders}로 바뀌었다`);
  const vault = out.find((e) => e.comment === '⚙simcore');
  if (!vault) fail('⚙simcore 항목이 없다');
  else {
    if (vault.alwaysActive !== false || vault.key !== ' __simcore_never__') fail('⚙simcore가 발화 가능한 모양이다');
    try {
      const back = JSON.parse(vault.content);
      if (back.meta?.name !== SCHEMA.meta.name || back.vars.length !== SCHEMA.vars.length) fail('⚙simcore 스키마가 왕복에서 깨졌다');
    } catch { fail('⚙simcore 내용이 JSON이 아니다'); }
  }
  // 강등해도 뜰 수 있나 — 키에 한국어 낱말이 하나라도 있어야 한국어 채팅에서 열린다
  for (const [c] of report.demoted) {
    const e = out.find((x) => x.comment === c);
    const words = String(e.key || '').split(',').map((s) => s.trim()).filter((s) => /^[가-힣]+$/.test(s) && s.length >= 2);
    if (!words.length) fail(`'${c}'에 한국어 낱말 키가 없다 — 강등하면 한국어 채팅에서 영영 안 뜬다`);
  }
}
if (!bad) console.log('  ✓ 삭제·강등·유지·폴더·스키마·키워드 전부 계획대로');

// ══════════ 보고 ══════════
console.log('\n━━ 삭제 (심코어와 충돌) ━━');
for (const [c, t, why] of report.dropped) console.log(`  − ${c} (${t}t) — ${why}`);
console.log('\n━━ 강등: always-on → 키워드 활성 (내용은 그대로) ━━');
for (const [c, t, why] of report.demoted) {
  const e = out.find((x) => x.comment === c);
  const added = ADD_KEYS[c] ? `  [키 보강: ${ADD_KEYS[c].join(', ')}]` : '';
  console.log(`  ↓ ${c} (${t}t) — ${why}${added}`);
  if (added) console.log(`      key: ${String(e.key).slice(0, 70)}…`);
}
console.log('\n━━ always-on 유지 ━━');
for (const [c, why] of Object.entries(KEEP_ALWAYS)) {
  console.log(`  = ${c} (${tok(out.find((x) => x.comment === c).content)}t) — ${why}`);
}
console.log('\n━━ 매 턴 고정 비용 ━━');
console.log(`  로어북 always-on: ${before}t → ${after}t  (−${before - after}t, ${Math.round((1 - after / before) * 100)}% 절감)`);
console.log(`  항목: ${src.length} → ${out.length} (⚙simcore 1개 포함)`);

if (bad) { console.log(`\n❗ ${bad}건 어긋남 — 출력하지 않는다`); process.exit(1); }

// ══════════ 출력 ══════════
const bundle = {
  simcoreBundle: 1,
  name: '아틀리에 — 공방 경영 (심코어판)',
  lorebook: out,
  // regex는 일부러 뺀다 — 원본 카드의 정규식을 건드리지 않기 위해서다.
  // (applyBundleToChar는 regex가 배열일 때만 customscript를 덮는다)
};
fs.writeFileSync(__P('아틀리에-번들.json'), JSON.stringify(bundle, null, 2));
fs.writeFileSync(__P('아틀리에-로어북.json'), JSON.stringify({ type: SRC.type, ver: SRC.ver, data: out }, null, 2));
const kb = (f) => (fs.statSync(__P(f)).size / 1024).toFixed(1) + 'KB';
console.log(`\n저장: 아틀리에-번들.json (${kb('아틀리에-번들.json')}) ← 이걸 [번들 가져와 교체]`);
console.log(`      아틀리에-로어북.json (${kb('아틀리에-로어북.json')}) ← 예비 (로어북만 임포트할 때)`);
