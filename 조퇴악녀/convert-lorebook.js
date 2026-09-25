const __P = (...p) => require('path').resolve(__dirname, ...p);
// 조퇴악녀 로어북 정리 → 개조 번들 (docs/design-조퇴악녀.md §7·§8)
//
// 원본 카드는 남의 것이다 — 카드는 각자 받고, 이 번들 한 파일로 로어북만 통째 교체한다
// (💾 세이브 페이지 [번들 가져와 교체], 아틀리에·얼헌과 같은 계약). 스키마(⚙simcore)도 로어북에 실려 간다.
//
// 하는 일:
//   1. 심코어가 대체하는 항목 삭제 — 상태창(심코어 상태창)·원작 타임라인(시나리오 막)·빙의 지침(시점 지시문)·Special Scenario(범위 밖)
//   2. **비밀 잘라 내기** — 인물 항목에 적힌 비밀은 이름만 나오면 모델이 본다. 심코어 secrets로 옮긴 줄을 원본에서 지운다
//   3. ⚙simcore 스키마 항목 첨부
//   4. 정규식은 `regexAdd`로 하나만 — 카드의 ⚙️ 설정 패널(원작 로어북·상태창 ON/OFF)을 같은 comment로 갈아 끼워 끈다.
//      그 스위치가 켜고 끄던 로어북 항목은 1에서 지웠다 (유저 실기 2026-09-25 "기존 상태창이랑 시나리오 로어북 쓰는 거야? CSS가 남아 있어서").
//      `regex`(통째 교체)는 금지 — 카드의 에셋 정규식을 지킨다
//
// 실행: node 조퇴악녀/villainess-vars.js && node 조퇴악녀/convert-lorebook.js
const fs = require('fs');

const SRC = JSON.parse(fs.readFileSync(__P('원본-로어북.json'), 'utf8'));
const SCHEMA = JSON.parse(fs.readFileSync(__P('조퇴악녀-스키마.json'), 'utf8'));
const src = SRC.data;

const tok = (s) => Math.round(String(s || '').length / 3.2);
let bad = 0;
const fail = (msg) => { console.log('  ❗ ' + msg); bad++; };

// ══════════ 정리 계획 ══════════
const DROP = {
  상태창: '심코어 상태창이 대체 — 남기면 <StatusWindow> 블록과 상태창이 두 겹',
  '원작 타임라인': '시나리오 막(direct)으로 쪼개 옮겼다 — 남기면 4막 전체가 한꺼번에 보여 모델이 앞질러 간다',
  '빙의 지침': '심코어 시점 지시문(pov_rosetta·pov_servant)이 대체',
  'Special Scenario': '🌹 빙의자 로제타 프리셋(pov_special 지시문 + possessor 변수)이 대체 — Possessor Profile을 로어북에 적으면 번들을 다시 적용할 때 지워진다',
};

// 비밀 잘라 내기 — [인물 항목, 지울 것, 바꿀 것]. 지울 것은 정규식(줄바꿈·들여쓰기 무관), 바꿀 것이 없으면 통째 삭제.
// "- Secret:" 블록 = 그 줄부터 다음 "- 항목:"·"###"·빈 줄 앞까지 (들여쓴 이어짐 줄 포함).
const SECRET_BLOCK = /\n- Secret:[\s\S]*?(?=\n- [A-Z][A-Za-z ]*:|\n#|\n\s*\n|$)/;
const CUTS = [
  ['로제타 비올라 카르디온', SECRET_BLOCK, '', '마석 가루 (→ secrets.powder)'],
  ['로제타 비올라 카르디온', /\n\s+- Authority of Destruction \(Unawakened\):[\s\S]*?(?=\n- Trivia)/,
    '\n    - Authority of Destruction (Unawakened): At her Awakening Ceremony at age eight, the authority\n      produced no visible manifestation. The household declared her a failure.',
    '권능의 진실 (→ secrets.power)'],
  ['안나 그웬', SECRET_BLOCK, '', '가루를 알고 있음 (→ secrets.anna)'],
  ['리칼 이시스 카르디온', SECRET_BLOCK, '', '이름 없이 보낸 약 (→ secrets.rical)'],
  ['엘리시아 트리샤 에버렛', SECRET_BLOCK, '', '통찰의 대가 (→ secrets.elicia)'],
  ['엘리시아 트리샤 에버렛', /Interpretation demands caution, and overuse punishes her body\s+with migraines and nosebleeds she keeps hidden\./,
    'Interpretation demands caution.', '통찰의 대가 — 능력 칸의 한 줄 (→ secrets.elicia)'],
];
// 정리 뒤 인물 항목에 남으면 안 되는 낱말 — 새는 줄이 하나라도 남았는지 본다 (번역 노트의 용어표는 대상 아님)
const LEAKS = [/powder/i, /already awakened/i, /coughs? up blood|coughing blood/i, /nosebleed/i, /\n- Secret:/];
const LEAK_SCOPE = ['로제타 비올라 카르디온', '안나 그웬', '리칼 이시스 카르디온', '엘리시아 트리샤 에버렛'];

// ══════════ 변환 ══════════
const before = src.filter((e) => e.alwaysActive).reduce((n, e) => n + tok(e.content), 0);
const out = [];
const report = { dropped: [], cut: [] };
for (const e of src) {
  const c = String(e.comment || '');
  if (DROP[c]) { report.dropped.push([c, tok(e.content), DROP[c]]); continue; }
  const item = { ...e };
  for (const [who, re, to, why] of CUTS) {
    if (who !== c) continue;
    const next = String(item.content).replace(re, to);
    if (next === item.content) fail(`'${c}'에서 잘라 낼 줄(${why})을 못 찾았다 — 원본이 바뀌었나`);
    else report.cut.push([c, tok(item.content) - tok(next), why]);
    item.content = next;
  }
  out.push(item);
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
for (const c of Object.keys(DROP)) if (!report.dropped.some(([n]) => n === c)) fail(`삭제 대상 '${c}'을 원본에서 못 찾았다`);
for (const who of LEAK_SCOPE) {
  const e = out.find((x) => x.comment === who);
  if (!e) { fail(`'${who}' 항목이 사라졌다`); continue; }
  for (const re of LEAKS) if (re.test(e.content)) fail(`'${who}'에 비밀이 남았다: ${re}`);
}
// 잘라 낸 뒤에도 인물 항목의 뼈대는 남아야 한다 (지나치게 먹지 않았나)
for (const who of LEAK_SCOPE) {
  const a = src.find((x) => x.comment === who), b = out.find((x) => x.comment === who);
  if (b && b.content.length < a.content.length * 0.85) fail(`'${who}'가 너무 많이 잘렸다 (${a.content.length} → ${b.content.length})`);
  for (const h of ['### Profile', '### Personality', '### Preference']) if (b && !b.content.includes(h)) fail(`'${who}'의 ${h} 절이 사라졌다`);
}
{
  const folders = out.filter((e) => e.mode === 'folder').length;
  if (folders !== src.filter((e) => e.mode === 'folder').length) fail('폴더 수가 바뀌었다');
  const vault = out.find((e) => e.comment === '⚙simcore');
  if (!vault || vault.alwaysActive !== false || vault.key !== ' __simcore_never__') fail('⚙simcore가 없거나 발화 가능한 모양이다');
  else {
    try { const back = JSON.parse(vault.content); if (back.meta?.name !== SCHEMA.meta.name || back.vars.length !== SCHEMA.vars.length) fail('⚙simcore 왕복이 깨졌다'); }
    catch { fail('⚙simcore 내용이 JSON이 아니다'); }
  }
  // 심코어 비밀 문장이 로어북에 새로 생기지 않았나 (옮긴 쪽 원문이 로어북에 남으면 은닉이 헛일)
  const lore = out.filter((e) => e.comment !== '⚙simcore').map((e) => e.content).join('\n');
  for (const s of SCHEMA.secrets) for (const t of s.tiers.slice(1)) if (lore.includes(t.text.slice(0, 20))) fail(`비밀 '${s.id}' 문장이 로어북에 있다`);
}
// ⚙️ 설정 패널 끄기 — in·flag는 원본 그대로 두고 out만 비운다: 퍼메의 ※ 자리는 비고, 다른 메시지 끝($)엔 빈 글자가 붙을 뿐.
// 패널의 두 스위치(original_mode·status_window)를 읽던 항목은 DROP의 상태창·원작 타임라인뿐이다 — 번들에 남았으면 끄면 안 된다.
const RGX = JSON.parse(fs.readFileSync(__P('원본-정규식.json'), 'utf8'));
const panel = (Array.isArray(RGX) ? RGX : (RGX.data || RGX.customscript || [])).find((r) => r.comment === '설정 패널');
if (!panel) fail("카드 정규식에서 '설정 패널'을 못 찾았다 — 원본이 바뀌었나");
if (/original_mode|status_window/.test(JSON.stringify(out))) fail('번들 로어북이 아직 설정 패널 스위치를 읽는다 — 패널을 끄면 안 된다');
const regexAdd = panel ? [{ ...panel, out: '' }] : [];
if (!bad) console.log('  ✓ 삭제·잘라 내기·유출 검사·폴더·스키마·설정 패널 끄기 전부 계획대로');

console.log('\n━━ 삭제 ━━');
for (const [c, t, why] of report.dropped) console.log(`  − ${c} (${t}t) — ${why}`);
console.log('\n━━ 비밀 잘라 내기 (→ 심코어 secrets) ━━');
for (const [c, t, why] of report.cut) console.log(`  ✂ ${c} (−${t}t) — ${why}`);
console.log('\n━━ 매 턴 고정 비용 ━━');
console.log(`  로어북 always-on: ${before}t → ${after}t  (−${before - after}t)`);
console.log(`  항목: ${src.length} → ${out.length} (⚙simcore 1개 포함)`);
if (bad) { console.log(`\n❗ ${bad}건 어긋남 — 출력하지 않는다`); process.exit(1); }

// ══════════ 출력 ══════════
const bundle = {
  simcoreBundle: 1,
  name: '조기퇴장 악녀 — 원작 탈출 (심코어판)',
  lorebook: out,
  // regexAdd = 같은 comment만 교체, 나머지 카드 정규식(에셋 표시·운명의 선택 버튼·옛 <StatusWindow> 그리기)은 그대로.
  // `regex`는 통째 교체라 금지 (아틀리에 2026-09-06 실사고). 되돌리기: 💾 [교체 되돌리기]
  regexAdd,
};
fs.writeFileSync(__P('조퇴악녀-번들.json'), JSON.stringify(bundle, null, 2));
fs.writeFileSync(__P('조퇴악녀-로어북.json'), JSON.stringify({ type: SRC.type, ver: SRC.ver, data: out }, null, 2));
const kb = (f) => (fs.statSync(__P(f)).size / 1024).toFixed(1) + 'KB';
console.log(`\n저장: 조퇴악녀-번들.json (${kb('조퇴악녀-번들.json')}) ← 이걸 [번들 가져와 교체]`);
console.log(`      조퇴악녀-로어북.json (${kb('조퇴악녀-로어북.json')}) ← 예비 (로어북만 임포트할 때)`);
