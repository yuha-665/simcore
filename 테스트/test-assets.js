const __P = (...p) => require('path').resolve(__dirname, ...p);
// 에셋 슬롯/팩 코어 — 검증·라우팅·조합·실존 대조·폴백 사다리·두 모드 지시문
// (설계: docs/design-에셋-슬롯.md — 1단계: 순수 로직, UI·배선 없음)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const AS = SC.require('assets');
const { validateSchema } = SC.require('validate');
const { compile } = SC.require('expr');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// 간이 lookup — 엔진 makeLookup 대역 (게이트 평가용)
const mkLookup = (vars) => (name) => {
  if (!(name in vars)) throw new Error(`unknown var ${name}`);
  return vars[name];
};

// 실험대 — 맨션봇 축소판: 시뮬 팩(who 칸) + 성인 게이트 팩 + 단일 캐릭 모듈 팩(chars, 다른 방언)
const BASE = {
  simcore: '0.1', meta: { name: '에셋 실험대' },
  vars: [{ id: 'nsfw_on', label: '성인', type: 'bool', init: false }],
  statusUI: { mode: 'auto', groups: [] },
  assets: {
    by: 'aux',
    packs: [
      { id: 'mansion', source: '맨션봇', sep: '_', format: '<img="{name}">',
        slots: [
          { id: 'who', label: '인물', values: ['Hiromi', 'Seiko'] },
          { id: 'emo', label: '감정', values: ['angry', 'smile', 'neutral'], fallback: 'neutral' },
          { id: 'wear', label: '의상', optional: true, values: ['apron', 'coat'] },
        ] },
      { id: 'mansion_nsfw', source: '맨션봇', sep: '_', format: '<img="{name}">', when: 'nsfw_on',
        slots: [
          { id: 'who', values: ['Hiromi', 'Seiko'] },
          { id: 'emo', values: ['blush'] },
        ] },
      { id: 'noz', source: '노조미 모듈 v1.2', sep: '-', chars: ['Nozomi'],
        format: '<char-noz emotion="{emo}">',
        slots: [{ id: 'emo', label: '감정', values: ['happy', 'sad'] }] },
    ],
  },
};
const snap = () => JSON.parse(JSON.stringify(BASE));
const L = mkLookup({ nsfw_on: false });
const Lon = mkLookup({ nsfw_on: true });

// ── 검증 ──
{
  const v = validateSchema(BASE);
  ck('실험대 스키마 유효', v.ok, v.errors.map((e) => `${e.path}: ${e.msg}`).join(' / '));

  const noAssets = snap(); delete noAssets.assets;
  ck('★ assets 없으면 아무 영향 없음', validateSchema(noAssets).ok, '');

  const dup = snap(); dup.assets.packs[1].id = 'mansion';
  ck('중복 팩 id 거부', !validateSchema(dup).ok, '');

  const badFmt = snap(); badFmt.assets.packs[0].format = '<img="{nam}">';
  ck('★ format의 정체불명 자리표시자 거부', !validateSchema(badFmt).ok, '');

  const noSlots = snap(); noSlots.assets.packs[0].slots = [];
  ck('칸 0개 거부', !validateSchema(noSlots).ok, '');

  const badWhen = snap(); badWhen.assets.packs[1].when = 'ghost_var > 3';
  ck('게이트 조건의 없는 변수 거부', !validateSchema(badWhen).ok, '');

  const overlap = snap(); overlap.assets.packs[2].chars = ['Hiromi'];
  const vo = validateSchema(overlap);
  ck('★ 인물 중복 담당은 경고 + 먼저 선언 우선 안내', vo.ok
    && vo.warnings.some((w) => w.msg.includes('먼저 선언된 팩이 우선')), '');

  const orphan = snap(); delete orphan.assets.packs[2].chars;
  ck('담당 인물 없는 팩은 경고 (라우팅 불가)', validateSchema(orphan).warnings.some((w) => w.msg.includes('라우팅되지')), '');

  const noSrc = snap(); delete noSrc.assets.packs[2].source;
  ck('source 없으면 고아 경고', validateSchema(noSrc).warnings.some((w) => w.msg.includes('고아')), '');

  const badFb = snap(); badFb.assets.packs[0].slots[1].fallback = 'ghost';
  ck('values에 없는 fallback 경고', validateSchema(badFb).warnings.some((w) => w.msg.includes('fallback')), '');
}

// ── 게이트 ──
{
  const S = snap();
  ck('닫힌 게이트 팩 제외', AS.openPacks(S, L).map((p) => p.id).join(',') === 'mansion,noz', '');
  ck('★ 게이트 열리면 포함', AS.openPacks(S, Lon).map((p) => p.id).join(',') === 'mansion,mansion_nsfw,noz', '');
  ck('★ lookup 없으면 when 팩은 닫힘 (모르는 상태에서 성인 팩 안 엶)',
    AS.openPacks(S, null).map((p) => p.id).join(',') === 'mansion,noz', '');
  const off = snap(); off.assets.packs[0].enabled = false;
  ck('enabled:false 토글 제외 (삭제가 아니라 끄기)', !AS.openPacks(off, L).some((p) => p.id === 'mansion'), '');
}

// ── 라우팅 ──
{
  const S = snap();
  ck('who 칸 값으로 라우팅', AS.routePack(S, 'Hiromi', L)?.id === 'mansion', '');
  ck('★ chars 팩으로 라우팅 (단일 캐릭 모듈)', AS.routePack(S, 'Nozomi', L)?.id === 'noz', '');
  ck('모르는 인물은 null', AS.routePack(S, 'Ghost', L) === null, '');
  ck('who 없으면 null', AS.routePack(S, null, L) === null, '');
  const overlap = snap(); overlap.assets.packs[2].chars = ['Hiromi', 'Nozomi'];
  ck('★ 겹치면 먼저 선언된 팩 우선', AS.routePack(overlap, 'Hiromi', L)?.id === 'mansion', '');
  ck('게이트 닫힌 팩으로는 라우팅 안 됨 — blush는 nsfw 전용',
    AS.routePack(snap(), 'Hiromi', L)?.id === 'mansion', '');
}

// ── 조합·태그 ──
{
  const S = snap();
  const pk = S.assets.packs[0];
  ck('기본 조합', AS.composeName(pk, { who: 'Hiromi', emo: 'angry' }) === 'Hiromi_angry', '');
  ck('optional 칸 포함 조합', AS.composeName(pk, { who: 'Hiromi', emo: 'angry', wear: 'apron' }) === 'Hiromi_angry_apron', '');
  ck('★ 필수 칸 빠지면 조합 불가', AS.composeName(pk, { who: 'Hiromi' }) === null, '');
  ck('dropOptional은 값 있어도 뺌', AS.composeName(pk, { who: 'Hiromi', emo: 'angry', wear: 'apron' }, true) === 'Hiromi_angry', '');
  const noz = S.assets.packs[2];
  ck('팩마다 다른 구분자', AS.composeName(noz, { emo: 'happy' }) === 'happy', '');
  ck('{name} 태그', AS.renderTag(pk, 'Hiromi_angry', {}) === '<img="Hiromi_angry">', '');
  ck('★ 칸 자리표시자 방언 (모듈 규약 흡수)', AS.renderTag(noz, 'happy', { emo: 'happy' }) === '<char-noz emotion="happy">', '');
}

// ── 실존 대조 + 폴백 사다리 ──
{
  const S = snap();
  const assets = new Set(['Hiromi_angry', 'Hiromi_neutral', 'Hiromi_smile_apron', 'Seiko_neutral']);
  const r1 = AS.resolveImage(S, { who: 'Hiromi', emo: 'angry' }, assets, L);
  ck('① 정조합 적중', r1.ok && r1.name === 'Hiromi_angry' && !r1.demoted, JSON.stringify(r1));
  ck('태그까지 조립', r1.tag === '<img="Hiromi_angry">', r1.tag);

  const r2 = AS.resolveImage(S, { who: 'Hiromi', emo: 'smile', wear: 'coat' }, assets, L);
  ck('② 의상 조합이 없으면... 폴백 경로로 생존', r2.ok, JSON.stringify(r2));

  const r3 = AS.resolveImage(S, { who: 'Seiko', emo: 'angry' }, assets, L);
  ck('★ ③ 같은 인물의 폴백 감정으로 강등 (Seiko_angry 없음 → neutral)',
    r3.ok && r3.name === 'Seiko_neutral' && r3.demoted, JSON.stringify(r3));

  const r4 = AS.resolveImage(S, { who: 'Hiromi', emo: 'blush' }, assets, L);
  ck('게이트 닫힌 어휘는 폴백으로 강등돼 생존 (mansion 팩의 neutral)', r4.ok && r4.name === 'Hiromi_neutral' && r4.demoted, JSON.stringify(r4));

  const r5 = AS.resolveImage(S, { who: 'Ghost', emo: 'angry' }, assets, L);
  ck('담당 팩 없으면 no-pack', !r5.ok && r5.reason === 'no-pack', '');

  const empty = AS.resolveImage(S, { who: 'Seiko', emo: 'angry' }, new Set(), L);
  ck('★ 전부 실패면 삽입 생략 (깨진 이미지 0)', !empty.ok && empty.reason === 'no-asset', '');

  const noSet = AS.resolveImage(S, { who: 'Hiromi', emo: 'angry' }, null, L);
  ck('대조 불가 환경(Set 없음)은 정조합 그대로', noSet.ok && noSet.name === 'Hiromi_angry' && !noSet.demoted, '');
}

// ── main 주입문 (Σ 덧셈 + 게이트 절감 + 생략 지시) ──
{
  const S = snap(); S.assets.by = 'main';
  const t = AS.mainInjectionText(S, L);
  ck('★ 주입문에 어휘가 덧셈으로 실림', t.includes('Hiromi, Seiko') && t.includes('angry, smile, neutral'), '');
  ck('★ 닫힌 성인 팩은 통째로 빠짐 (최대 절감)', !t.includes('blush'), '');
  ck('게이트 열리면 실림', AS.mainInjectionText(S, Lon).includes('blush'), '');
  ck('모듈 방언 format 안내', t.includes('<char-noz'), '');
  ck('★ 확신 없으면 생략 지시 상시', t.includes('omit the tag'), '');
  ck('영어로 나감 (모델용 문구 규칙)', !/[가-힣]/.test(t), '');
  ck('aux 모드에서는 주입문 없음', AS.mainInjectionText(snap(), L) === '', '');
  const bare = { assets: { by: 'main', packs: [] } };
  ck('팩 없으면 빈 문자열', AS.mainInjectionText(bare, L) === '', '');
}

// ── aux 지시 조각 (보조는 인물·감정만 — 팩 선택은 SimCore 몫) ──
{
  const S = snap();
  const spec = AS.auxImageSpec(S, L);
  ck('★ who 후보 = 열린 팩들의 담당 합집합', spec.whoValues.join(',') === 'Hiromi,Seiko,Nozomi', spec.whoValues.join(','));
  ck('감정 어휘 합집합 (칸 id 기준)', spec.slotIds.includes('emo') && spec.instruction.includes('happy'), '');
  ck('★ 팩 id는 지시에 안 나옴 (보조에게 팩을 고르게 하지 않는다)',
    !spec.instruction.includes('mansion') && !spec.instruction.includes('noz'), '');
  ck('닫힌 팩 어휘 제외', !spec.instruction.includes('blush'), '');
  ck('장면 초점 없으면 null 지시', spec.instruction.includes('"image": null'), '');
  ck('main 모드에서는 빈 스펙', AS.auxImageSpec({ assets: { by: 'main', packs: BASE.assets.packs } }, L).instruction === '', '');
}

// ── 번들 배선 스모크 ──
{
  ck('★ 번들에 assets 모듈 실림', src.includes("'assets'") || src.includes('resolveImage'), '');
  ck('검증기에 assets 절 존재', src.includes('$.assets.packs') || src.includes('잘못된 팩 id'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
