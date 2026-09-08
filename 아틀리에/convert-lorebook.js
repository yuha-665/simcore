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
const BOOK = JSON.parse(fs.readFileSync(__P('조합서.json'), 'utf8')).book;   // atelier-vars.js가 쓴 사이드카
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

// ══════════ 조합서 — 레시피마다 키워드 활성 항목 (2026-09-06) ══════════
// 메인은 조합서의 필요 소재를 못 받는다(패널 전용). 아는 레시피 전부를 지시문으로 실으면 배울수록 매턴 비용이
// 는다 — 만들려는 것의 이름이 채팅에 나올 때만 그 한 벌이 실리는 로어북식이 맞다 (유저 선택).
// 규칙은 항목 안에 같이 싣는다: 조합서에 있는 것은 적힌 소재로만, 없으면 멈춘다. 조합서 밖은 서사에.
const RECIPE_FOLDER = 'folder:simcore-recipes';
out.push({
  key: RECIPE_FOLDER, comment: '조합서 (심코어)', content: '', mode: 'folder', insertorder: 100,
  alwaysActive: false, secondkey: '', selective: false, bookVersion: 2, id: 'lm_simcore_recipes', disabled: false,
});
let recipeN = 0;
// 한 글자 이름("약"·"빵")은 다른 낱말 안에서 매턴 걸린다 — 만드는 문맥의 어구로만 연다
const keysOf = (name) => (name.length >= 2 ? [name] : [`${name}을 만`, `${name}을 빚`, `${name} 조합`, `${name}을 지어`]);
// 분류명 재료(2026-09-08) — "연료"는 고유 소재가 아니라 분류 (燃料) 하나. 구성원을 같이 실어 메인이 소재 목록과 대조할 수 있게.
const { classes: CLASSES = {}, generic: GENERIC = {}, sources: SOURCES = {} } = JSON.parse(fs.readFileSync(__P('조합서.json'), 'utf8'));
// 고유명 재료엔 산지 앞 둘 — 레시피 이름이 나올 때 "어디서 구하나"까지 한 벌에 (산지표 2026-09-08)
const matText = (m) => (GENERIC[m] ? `(${GENERIC[m]} — ${CLASSES[GENERIC[m]].join('·')} 중 하나)`
  : SOURCES[m] ? `${m}[${SOURCES[m].filter((x) => x !== '조합').slice(0, 2).join('·') || '조합'}]` : m);
for (const [cat, list] of Object.entries(BOOK)) {
  for (const [name, lib, tier, effect, mats] of list) {
    out.push({
      key: keysOf(name).join(', '), comment: `📖 ${name}`, folder: RECIPE_FOLDER,
      content: `[조합서] ${name} — ${cat} · ${tier} · 서고 ${lib}단부터\n효과: ${effect}\n필요 소재: ${mats.map(matText).join(' · ')}\n`
        + '소재 목록에 이 이름들이 다 있어야 가마에 불을 넣는다 — 빠진 것이 있으면 판정과 상관없이 무엇이 모자란지 말하고 멈춘다. '
        + '괄호로 적힌 분류 재료는 그 분류의 어느 소재든 되고, 고유명 재료는 같은 분류의 다른 소재로 한 가지까지만 대신할 수 있다. '
        + '배우지 않은 레시피면 먼저 서고에서 읽어야 한다 (서고 단수 미달이면 "아직 읽어낼 수 없다").',
      mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, useRegex: false,
      bookVersion: 2, id: `lm_simcore_recipe_${++recipeN}`, disabled: false,
    });
  }
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
  if (folders !== srcFolders + 1) fail(`폴더가 ${srcFolders}+1(조합서) → ${folders}로 바뀌었다`);
  const recipes = out.filter((e) => e.folder === RECIPE_FOLDER);
  const bookN = Object.values(BOOK).flat().length;
  if (recipes.length !== bookN) fail(`조합서 항목 ${recipes.length} ≠ 도감 ${bookN}`);
  if (recipes.some((e) => e.alwaysActive)) fail('조합서 항목이 always-on이다 — 매턴 비용');
  if (recipes.some((e) => String(e.key).split(',').some((k) => k.trim().length < 2))) fail('조합서 키에 한 글자가 있다 — 매턴 걸린다');
  if (new Set(recipes.map((e) => e.key)).size !== recipes.length) fail('조합서 키가 겹친다');
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
console.log(`\n━━ 조합서 키워드 항목 ${recipeN}개 (레시피 이름이 채팅에 나올 때만 그 한 벌 ≈ ${tok(out.find((e) => e.folder === RECIPE_FOLDER).content)}t) ━━`);
console.log('\n━━ always-on 유지 ━━');
for (const [c, why] of Object.entries(KEEP_ALWAYS)) {
  console.log(`  = ${c} (${tok(out.find((x) => x.comment === c).content)}t) — ${why}`);
}
console.log('\n━━ 매 턴 고정 비용 ━━');
console.log(`  로어북 always-on: ${before}t → ${after}t  (−${before - after}t, ${Math.round((1 - after / before) * 100)}% 절감)`);
console.log(`  항목: ${src.length} → ${out.length} (⚙simcore 1개 포함)`);

if (bad) { console.log(`\n❗ ${bad}건 어긋남 — 출력하지 않는다`); process.exit(1); }

// ══════════ 정규식 — 퍼메에 박힌 원본 카드의 옛 상태 로그를 걷어낸다 ══════════
// 원본 카드 퍼메 17개(기본+대체 16) 본문 끝에 "[아틀리에] 년도: 1 / 날짜: … / 위치: … / 콜: 100 / 아이템 / 소재" 푸터가 박혀 있다
// (원본의 always-on "상태창" 항목이 시키던 형식 — 그 항목은 심코어판에서 빠졌지만 퍼메는 카드 소유라 번들이 못 고친다).
// 남겨 두면 심코어 상태 블록과 두 겹으로 충돌하고, 메인이 히스토리를 모방해 응답 끝마다 같은 형식을 찍는다.
// 그래서 세 층에서 지운다: editprocess(프롬프트로 나가는 채팅 본문) · editdisplay(화면) · editoutput(혹시 모델이 따라 찍은 것).
// 패턴은 "소재:" 줄까지 잡는다 — 스트리밍 도중 조각(소재 줄 전)엔 안 걸려 부분 삭제가 없고, 두 번 돌려도 같다.
// ⚠ 번들 `regex`는 카드의 customscript를 통째로 덮는다 (얼헌식) — 처음에 그걸로 실었다가 유저 카드의 에셋 정규식까지 날렸다
//   (실사고 2026-09-06 "에셋 정규식까지 지워버려서 에셋이 안 나온다"). 그래서 `regexAdd`(v1.7.10) — 카드 정규식은 두고 덧붙인다.
const FOOTER_IN = '\\s*\\[아틀리에\\]\\s*년도:[\\s\\S]*?\\n소재:[^\\n]*';
const REGEX = ['editprocess', 'editdisplay', 'editoutput'].map((type) => ({
  comment: `⚙simcore 옛 상태 로그 제거 (${type})`, type, in: FOOTER_IN, out: '',
}));
{
  const gp = __P('퍼메-원문.json');
  if (fs.existsSync(gp)) {
    const greets = JSON.parse(fs.readFileSync(gp, 'utf8')).filter((t) => t.trim());
    const re = new RegExp(FOOTER_IN, 'g');
    const left = greets.filter((t) => /\[아틀리에\]|년도:/.test(t.replace(re, '')));
    const cut = greets.filter((t) => t.replace(re, '').length < t.length * 0.8);
    if (left.length || cut.length) { console.log(`\n❗ 퍼메 푸터 정규식 어긋남 — 남음 ${left.length} · 과삭 ${cut.length}`); bad++; }
    else console.log(`  퍼메 푸터 정규식: ${greets.length}/${greets.length} 걷어냄 (본문·이미지 요청 태그는 남긴다)`);
  }
}
if (bad) { console.log(`\n❗ ${bad}건 어긋남 — 출력하지 않는다`); process.exit(1); }

// ══════════ 출력 ══════════
const bundle = {
  simcoreBundle: 1,
  name: '아틀리에 — 공방 경영 (심코어판)',
  lorebook: out,
  regexAdd: REGEX,   // 퍼메 푸터 제거 3종 — 카드 정규식은 그대로 두고 덧붙인다 (v1.7.10 계약; `regex`는 통째 교체라 금지)
};
fs.writeFileSync(__P('아틀리에-번들.json'), JSON.stringify(bundle, null, 2));
fs.writeFileSync(__P('아틀리에-로어북.json'), JSON.stringify({ type: SRC.type, ver: SRC.ver, data: out }, null, 2));
const kb = (f) => (fs.statSync(__P(f)).size / 1024).toFixed(1) + 'KB';
console.log(`\n저장: 아틀리에-번들.json (${kb('아틀리에-번들.json')}) ← 이걸 [번들 가져와 교체]`);
console.log(`      아틀리에-로어북.json (${kb('아틀리에-로어북.json')}) ← 예비 (로어북만 임포트할 때)`);
