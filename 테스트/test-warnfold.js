const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.79 지적 접기 — 한 종류의 지적이 인원수만큼 쏟아져 다른 오류를 덮던 문제.
//
// 실측: 145명 명단을 두 팩에 넣자 "인물 'X'는 팩 Y가 먼저 담당합니다"가 **145줄**.
// 낱말 경고가 147줄 쏟아졌던 v0.44.1과 같은 병이고, 처방도 같다 — **묶어서 한 줄**.
// 두 층에서 막는다: ① 검증기가 팩 쌍 단위로 묶고, ② 화면이 어떤 검사가 터지든 접는다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { validateSchema } = SC.require('validate');
const T = SC.require('templates');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const shadowOf = (s) => validateSchema(s).warnings.filter((w) => /먼저 담당|겹칩니다/.test(w.msg));

const NAMES = Array.from({ length: 145 }, (_, i) => `Char_${i + 1}`);
const mkPack = (id, states, who = NAMES, when) => ({
  id, format: '<img src={name}>', ...(when ? { when } : {}),
  slots: [{ id: 'who', label: '인물', values: who }, { id: 'state', label: '상태', values: states }],
});
const mk = (packs) => ({
  simcore: '0.1', meta: { name: '겹침' },
  vars: [{ id: 'nsfw', label: '수위', type: 'bool', init: false }],
  assets: { packs },
});

// ── 검증기: 팩 쌍 단위로 묶는가 ──
{
  const S = mk([mkPack('general_state', ['default', 'smile']), mkPack('nsfw_state', ['a', 'b'])]);
  const sh = shadowOf(S);
  ck('★ 145명 겹침이 한 줄로 접힌다 (예전 145줄)', sh.length === 1, `실제 ${sh.length}줄`);
  ck('★ 몇 명인지 밝힌다', sh.length === 1 && sh[0].msg.includes('145명'), sh[0]?.msg);
  ck('★ 앞 셋을 예시로 준다 (찾아갈 실마리)',
    sh.length === 1 && sh[0].msg.includes("'Char_1', 'Char_2', 'Char_3'"), sh[0]?.msg);
  ck('★ 외 N명으로 나머지를 센다', sh.length === 1 && sh[0].msg.includes('외 142명'), sh[0]?.msg);
  // v0.87.3부터 뒤 팩이 통째로 죽지 않는다 (구조 라우팅) — 문구도 "예비·어휘 확장"으로 바뀜
  ck('★ 결과가 무엇인지 말한다 (뒤 팩은 예비·어휘 확장)',
    sh.length === 1 && sh[0].msg.includes('예비·어휘 확장'), sh[0]?.msg);
  ck('경로는 뒤에 선언된 팩을 가리킨다', sh.length === 1 && sh[0].path === '$.assets.packs[1]', sh[0]?.path);
}

// 한 명만 겹치면 예전 문장 그대로 — 묶을 것이 없으면 묶은 티를 내지 않는다
{
  const S = mk([mkPack('general_state', ['default']), mkPack('nsfw_state', ['a'], ['Char_1'])]);
  const sh = shadowOf(S);
  ck('★ 한 명 겹침은 단수 문장 (묶은 티를 내지 않는다)', sh.length === 1
    && sh[0].msg === "인물 'Char_1'는 팩 'general_state'가 먼저 담당합니다 — 필수 칸 구성이 겹쳐 먼저 선언된 팩이 우선하고, "
      + '이 팩은 앞 팩에 없는 이미지의 예비·어휘 확장으로만 쓰입니다', sh[0]?.msg);
}

// 팩이 셋이면 **가려진 팩마다** 한 줄 — 뭉뚱그려 하나로 만들지도, 쌍마다 부풀리지도 않는다.
// b와 c 둘 다 죽고, 둘 다 실제로 이기는 팩('a')을 가리켜야 한다 (b가 c를 가린 게 아니다).
{
  const S = mk([mkPack('a', ['x']), mkPack('b', ['y']), mkPack('c', ['z'])]);
  const sh = shadowOf(S);
  ck('★ 가려진 팩마다 한 줄 (셋이면 2줄)', sh.length === 2, `실제 ${sh.length}줄`);
  ck('★ 둘 다 실제로 이기는 팩을 가리킨다',
    sh.length === 2 && sh.every((w) => /팩 'a'/.test(w.msg)), sh.map((w) => w.msg).join(' / '));
  ck('경로가 각각 자기 팩', sh.length === 2
    && sh[0].path === '$.assets.packs[1]' && sh[1].path === '$.assets.packs[2]', sh.map((w) => w.path).join(' '));
}

// when 게이트가 다르면 여전히 경고하지 않는다 (성인/임신 팩 패턴 — v0.52 원칙 유지)
{
  const S = mk([mkPack('general_state', ['default']), mkPack('nsfw_state', ['a'], NAMES, 'nsfw')]);
  ck('★ 게이트가 다른 팩은 접기와 무관하게 무경고', shadowOf(S).length === 0, JSON.stringify(shadowOf(S)));
}

// ── 규칙 #5: 내장 템플릿 오탐 0 ──
{
  const list = T.TEMPLATES || T.templates || T.default || T;
  const rows = Array.isArray(list) ? list.map((t, i) => [t.id || i, t]) : Object.entries(list);
  let n = 0, bad = [];
  for (const [id, t] of rows) {
    const sch = t.schema || t;
    if (!sch || !sch.vars) continue;
    n++;
    const r = validateSchema(sch);
    if (!r.ok) bad.push(`${id}:검증실패`);
    if (r.warnings.filter((w) => /먼저 담당|겹칩니다/.test(w.msg)).length) bad.push(`${id}:겹침경고`);
  }
  ck('★ 내장 템플릿 16종 전부 무영향', n >= 16 && !bad.length, `${n}종 / ${bad.join(', ')}`);
}

// ── 화면: 넘치면 접는가 ──
{
  ck('★ 패널이 앞 몇 줄만 펼치고 나머지를 접는다', src.includes('sc-report-more') && src.includes('줄 더 보기'), '');
  ck('★ 오류·경고 둘 다 같은 규칙', src.includes("list(panelStatus.report, 'status-bad', '✗')")
    && src.includes("list(panelStatus.warnings, 'status-warn', '⚠')"), '');
  ck('★ 짧으면 접지 않는다 (SHOW+2 이하는 그대로)', src.includes('items.length <= SHOW + 2'), '');
  ck('지적 본문을 이스케이프한다', src.includes('${escapeText(e.path)} — ${escapeText(e.msg)}'), '');
  ck('접기 요약 CSS 존재', src.includes('.sc-report-more > summary'), '');
  ck('옛 무제한 평면 출력 잔존 없음',
    !src.includes('for (const w of panelStatus.warnings || []) html +='), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
