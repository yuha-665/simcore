const __P = (...p) => require('path').resolve(__dirname, ...p);
// NPC 동료 영입이 자동으로 도는지 — RP 없이 확인할 수 있는 것 전부
//
// 실제 모델의 "판단"은 못 본다. 하지만 그 앞뒤는 전부 재현된다:
//   ① 보조 모델이 staff에 대해 정확히 무슨 지시를 받는가 (프롬프트 원문)
//   ② 모델이 뱉을 법한 응답들이 실제로 반영되는가 (허술한 응답 포함)
//   ③ 반영된 것이 상태창에 어떻게 보이는가 (렌더 결과)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { renderStatusHtml } = SC.require('render');
const S = JSON.parse(fs.readFileSync(__P('../베리디아/영지-변수상태창-신안.json'), 'utf8'));

const line = (t) => console.log('\n━━ ' + t + ' ━━');

// ── ① 보조 모델이 staff에 대해 받는 지시 원문 ──
line('보조 모델이 받는 지시 (목록 변수만 발췌)');
let st = engine.initState(S); st.meta.setupDone = true;
const up = engine.buildAuxPrompt
  ? engine.buildAuxPrompt(S, st, [])
  : (() => {                                    // 이름이 다르면 모듈에서 찾아 쓴다
    const k = Object.keys(engine).find((n) => /updater|Updater/.test(n) && typeof engine[n] === 'function');
    return k ? engine[k](S, st) : null;
  })();
if (typeof up === 'string') {
  for (const l of up.split('\n')) if (/^- (staff|ally|ally_role|ally_bond) /.test(l.trim())) console.log('  ' + l.trim());
} else {
  console.log('  (buildUpdaterPrompt를 못 찾음 — 아래에서 export 확인)');
  console.log('  engine exports:', Object.keys(engine).join(', '));
}

// ── ② 모델이 뱉을 법한 응답들 ──
// 잘 쓴 것, 대충 쓴 것, 규격을 벗어난 것을 섞는다 — 실전에서 다 나온다.
line('영입 → 이탈 흐름');
const turns = [
  [{ staff: { add: ['유스티나 · 시녀장'] } }, '규격대로'],
  [{ staff: { add: ['요한 · 목수', '톰 · 마구간지기'] } }, '한 턴에 둘'],
  [{ staff: { add: ['알제리아 — 은발 머리를 올려 묶은 근위 메이드, 집착이 심하다'] } }, '⚠ 설명까지 씀 (로어북 중복)'],
  [{ staff: ['통째로', '갈아치우기'] }, '⚠ 배열 통짜 제시 (연산 아님)'],
  [{ staff: { remove: ['요한 · 목수'] } }, '요한 이탈'],
  [{ staff: { remove: ['요한'] } }, '⚠ 표기가 다른 remove'],
  [{ ally_bond: 30 }, '⚠ 유대를 한 번에 30 올리려 시도'],
  [{ ally_bond: -4 }, '유대 -4 (정상 폭)'],
];
for (const [ch, why] of turns) {
  const sp = engine.sendPhase(S, st);
  const out = engine.outputPhase(S, sp.state, ch, {});
  st = out.state;
  const cl = out.changeLog.filter((c) => c.id === 'staff' || c.id === 'ally_bond');
  const shown = ch.ally_bond !== undefined ? `유대 ${st.vars.ally_bond}` : `[${st.vars.staff.join(' / ') || '비어 있음'}]`;
  console.log(`  ${cl.length ? '✓' : '·'} ${why.padEnd(30)} → ${shown}`);
}

// ── ③ 상한이 실제로 걸리는가 ──
line('상한');
const def = S.vars.find((v) => v.id === 'staff');
console.log(`  스키마: maxItems ${def.maxItems ?? '(기본 20)'} · itemMaxLength ${def.itemMaxLength ?? '(기본 40)'}`);
{
  let t = engine.initState(S); t.meta.setupDone = true;
  const many = Array.from({ length: 15 }, (_, i) => `고용인${i + 1}`);
  t = engine.outputPhase(S, engine.sendPhase(S, t).state, { staff: { add: many } }, {}).state;
  console.log(`  15명 한 번에 → ${t.vars.staff.length}명만 남음 ${t.vars.staff.length === (def.maxItems ?? 20) ? '✓' : '❗'}`);
  const long = '에리스 폰 베리디아 — 몰락 기사가문의 마지막 종자이며 남작을 어릴 적부터 섬겨 온 인물';
  let u = engine.initState(S); u.meta.setupDone = true;
  u = engine.outputPhase(S, engine.sendPhase(S, u).state, { staff: { add: [long] } }, {}).state;
  console.log(`  ${long.length}자 항목 → ${u.vars.staff[0].length}자로 잘림`);
  console.log(`    "${u.vars.staff[0]}"`);
}

// ── ④ 상태창에 어떻게 보이는가 ──
line('상태창 렌더');
const html = renderStatusHtml(S, st);
const grab = (title) => {
  const i = html.indexOf(title);
  if (i < 0) return '(섹션 못 찾음)';
  return html.slice(i, i + 700).replace(/<[^>]+>/g, '|').replace(/\|{2,}/g, ' | ').slice(0, 260);
};
console.log('  고용인:', grab('메이드 및 핵심 고용인'));
console.log('  지속수입:', grab('지속 수입'));
{
  const empty = engine.initState(S);
  const h2 = renderStatusHtml(S, empty);
  const i = h2.indexOf('메이드 및 핵심 고용인');
  console.log('  빈 목록일 때:', h2.slice(i, i + 260).replace(/<[^>]+>/g, '|').replace(/\|{2,}/g, ' | ').slice(0, 140));
}

// ── ⑤ 프롬프트에 실리는 모습 ──
line('모델에게 가는 상태 블록');
console.log(engine.sendPhase(S, st).promptBlock.split('\n').filter((l) => /고용인|자원|시설/.test(l)).join('\n'));
