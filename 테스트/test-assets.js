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

  // 임포터가 "비워 둬라"를 ""로 내는 건 정상 — packOpen(항상 열림)과 같은 해석이어야 한다.
  // 실측: 검증기만 깐깐해서 "표현식 필요" 3연발로 변환 반영이 막혔다 (MIKU&BRS).
  const emptyWhen = snap(); emptyWhen.assets.packs[1].when = '';
  ck('★ 빈 when은 "항상 열림"으로 유효 (표현식 오류 아님)', validateSchema(emptyWhen).ok,
    validateSchema(emptyWhen).errors.map((e) => e.msg).join('/'));

  const overlap = snap(); overlap.assets.packs[2].chars = ['Hiromi'];
  const vo = validateSchema(overlap);
  ck('★ 인물 중복 담당은 경고 + 먼저 선언 우선 안내', vo.ok
    && vo.warnings.some((w) => w.msg.includes('먼저 선언된 팩이 우선')), '');

  // 게이트가 다른 변형 팩(성인/임신 패턴)의 인물 겹침은 의도된 공존 — 경고 없어야 한다.
  // BASE 자체가 그 패턴이다: mansion(상시)과 mansion_nsfw(when)가 같은 인물을 담당.
  ck('★ 게이트 다른 변형 팩 공존은 경고 없음 (성인/임신 변형 패턴)',
    !validateSchema(snap()).warnings.some((w) => w.msg.includes('먼저 선언된 팩이 우선')), '');
  const sameGate = snap(); sameGate.assets.packs[1].when = undefined; // nsfw 게이트 제거 → 진짜 충돌
  ck('게이트까지 같으면 여전히 경고', validateSchema(sameGate).warnings.some((w) => w.msg.includes('먼저 선언된 팩이 우선')), '');

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

  // verify:false (v0.54.6) — 에셋이 모듈에 살아 이름을 못 읽는 환경. 부분 Set(캐릭터만)이
  // 모듈 조합을 전부 걸러버리는 사고를 팩 단위로 끈다.
  const nv = snap(); nv.assets.packs[0].verify = false;
  const rv = AS.resolveImage(nv, { who: 'Hiromi', emo: 'smile' }, assets, L);
  ck('★ verify:false 팩은 부분 Set에 걸러지지 않고 정조합 신뢰', rv.ok && rv.name === 'Hiromi_smile' && !rv.demoted, JSON.stringify(rv));
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

// ── 서사 위치 삽입 (by:'aux_flow', v0.54) — 앵커 탐색 사다리 + 배치 ──
// 위치를 서수가 아니라 본문 인용으로 받는 이유: 실존 대조와 같은 원리 —
// 검증할 수 없는 답은 받지 않는다. 못 찾으면 안 놓으면 그만이다.
{
  const body = '히로미가 방으로 들어왔다.\n\n"뭐 하는 거야?" 세이코가 물었다.\n\n창밖에는 비가 내렸다.';
  ck('앵커 ① 정확 일치', AS.findAnchor(body, '세이코가 물었다') > 0, '');
  ck('앵커 ② 공백 정규화 (줄바꿈 뭉갠 인용)', AS.findAnchor('비가\n내렸다', '비가 내렸다') === 0, '');
  ck('앵커 ③ 앞 12자 축약 (인용 뒷부분 어긋남)', AS.findAnchor(body, '창밖에는 비가 내렸다. 그날따라 유독 세차게') > 0, '');
  ck('★ 없는 인용은 -1', AS.findAnchor(body, '전혀 없는 문장') === -1, '');
  ck('빈 앵커는 -1', AS.findAnchor(body, '') === -1 && AS.findAnchor(body, null) === -1, '');

  const two = AS.placeImages(body, [
    { tag: '<img="Hiromi_angry">', anchor: '히로미가 방으로' },
    { tag: '<img="Seiko_neutral">', anchor: '세이코가 물었다' },
  ]);
  const iH = two.text.indexOf('<img="Hiromi_angry">'), iS = two.text.indexOf('<img="Seiko_neutral">');
  ck('★ 앵커 문단 바로 뒤 삽입, 서사 순서 유지', two.placed === 2 && iH > 0 && iS > iH, two.text);
  ck('문단 경계 유지 (빈 줄로 감싸임)', two.text.includes('들어왔다.\n\n<img="Hiromi_angry">\n\n"뭐'), two.text.slice(0, 80));

  const drop = AS.placeImages(body, [
    { tag: '<img="Hiromi_angry">', anchor: '히로미가 방으로' },
    { tag: '<img="Seiko_neutral">', anchor: '이 인용은 본문에 없다' },
  ]);
  ck('★ 못 찾은 장만 생략, 나머지는 정위치', drop.placed === 1 && drop.dropped === 1 && drop.text.includes('Hiromi_angry'), JSON.stringify(drop));

  const front = AS.placeImages(body, [
    { tag: '<img="Hiromi_angry">', anchor: '없는 문장 하나' },
    { tag: '<img="Seiko_neutral">', anchor: '없는 문장 둘' },
  ]);
  ck('★ 전패 시 첫 장 맨 앞 강등 (이미지 없는 턴 방지)', front.demoted && front.text.startsWith('<img="Hiromi_angry">\n\n히로미'), front.text.slice(0, 50));

  const dup = AS.placeImages(body, [
    { tag: '<img="Hiromi_angry">', anchor: '히로미가 방으로' },
    { tag: '<img="Hiromi_angry">', anchor: '히로미가 방으로' },
  ]);
  ck('같은 태그+앵커 중복 제거', dup.placed === 1, '');
  ck('마지막 문단 앵커는 본문 끝에', AS.placeImages(body, [{ tag: '<T>', anchor: '비가 내렸다' }]).text.endsWith('<T>'), '');
  ck('항목 없으면 본문 그대로', AS.placeImages(body, []).text === body, '');
}

// aux_flow 스펙 + 검증
{
  const S = snap(); S.assets.by = 'aux_flow';
  ck('aux_flow 스키마 유효', validateSchema(S).ok, validateSchema(S).errors.map((e) => e.msg).join('/'));
  const bad = snap(); bad.assets.by = 'ghost';
  ck('잘못된 by 거부', !validateSchema(bad).ok, '');
  const spec = AS.auxImageSpec(S, L);
  ck('★ flow 스펙: images 배열 + 앵커 지시', spec.instruction.includes('"images"') && spec.instruction.includes('anchor'), '');
  ck('flow 스펙: 그대로 베끼라는 지시(verbatim)', spec.instruction.includes('verbatim'), '');
  ck('flow 스펙도 어휘 합집합·게이트 제외 동일', spec.instruction.includes('Hiromi') && !spec.instruction.includes('blush'), '');
  ck('★ aux 단일 스펙에는 images 없음 (모드 혼선 방지)', !AS.auxImageSpec(snap(), L).instruction.includes('"images"'), '');
}

// ── 번들 배선 스모크 ──
{
  ck('★ 번들에 assets 모듈 실림', src.includes("'assets'") || src.includes('resolveImage'), '');
  ck('검증기에 assets 절 존재', src.includes('$.assets.packs') || src.includes('잘못된 팩 id'), '');
}

// ── 배선 (2단계): 엔진 프롬프트 합류 ──
const E = SC.require('engine');
{
  const S = snap(); S.updater = { allow: [{ id: 'nsfw_on' }] };
  const st = E.initState(S);
  const p = E.buildAuxPrompt(S, st, '서사', '유저 발화');
  ck('★ aux 프롬프트에 image 피기백 지시가 실린다 (추가 호출 0)',
    p.includes('"image"') && p.includes('Hiromi'), '');
  ck('닫힌 팩 어휘는 피기백 지시에도 없다', !p.includes('blush'), '');
  const pAll = E.buildAuxPrompt(S, st, '서사', null, null, { allowAll: true });
  ck('★ 브리지 템플릿 굽기(allowAll)에는 안 얹는다 (retro 제약)', !pAll.includes('"image"'), '');

  const Sm = snap(); Sm.assets.by = 'main'; Sm.updater = { allow: [{ id: 'nsfw_on' }] };
  ck('by:main이면 aux 프롬프트에는 없다',
    !E.buildAuxPrompt(Sm, E.initState(Sm), '서사', null).includes('"image"'), '');
  const S0 = snap(); delete S0.assets; S0.updater = { allow: [{ id: 'nsfw_on' }] };
  ck('★ assets 없으면 aux 프롬프트 불변', !E.buildAuxPrompt(S0, E.initState(S0), '서사', null).includes('"image"'), '');

  ck('★ by:main이면 전송 promptBlock에 주입문 합류',
    E.sendPhase(Sm, E.initState(Sm)).promptBlock.includes('[Image tags]'), '');
  ck('by:aux면 promptBlock에는 없다 (이중 지시 방지)',
    !E.sendPhase(S, E.initState(S)).promptBlock.includes('[Image tags]'), '');

  const parsed = E.parseAuxResponse('{"changes":{},"reasons":{},"image":{"who":"Hiromi","emo":"angry"}}');
  ck('★ parseAuxResponse가 image 필드를 통과시킨다', parsed && parsed.image && parsed.image.who === 'Hiromi', JSON.stringify(parsed));
  ck('image 없으면 null', E.parseAuxResponse('{"changes":{}}').image === null, '');

  const pf = E.parseAuxResponse('{"changes":{},"reasons":{},"images":[{"who":"Hiromi","emo":"angry","anchor":"문장"}]}');
  ck('★ parseAuxResponse가 images 배열을 통과시킨다', Array.isArray(pf.images) && pf.images[0].anchor === '문장', JSON.stringify(pf));
  ck('images가 배열이 아니면 null', E.parseAuxResponse('{"changes":{},"images":"x"}').images === null, '');

  const Sf = snap(); Sf.assets.by = 'aux_flow'; Sf.updater = { allow: [{ id: 'nsfw_on' }] };
  ck('★ aux_flow도 보조 프롬프트에 피기백 (추가 호출 0 동일)',
    E.buildAuxPrompt(Sf, E.initState(Sf), '서사', null).includes('"images"'), '');
  ck('aux_flow도 promptBlock에는 없다 (메인 비용 0 유지)',
    !E.sendPhase(Sf, E.initState(Sf)).promptBlock.includes('[Image tags]'), '');
}

// ── 3단계: 🎨 에셋 층 — 감지·커버리지·임포터 (순수 헬퍼) ──
const ED = SC.require('editor');
{
  const det = ED.detectSlotsFromNames(['Hiromi_angry', 'Hiromi_smile', 'Seiko_neutral', 'Hiromi_smile_apron']);
  ck('★ 자동 감지: 구분자', det && det.sep === '_', JSON.stringify(det));
  ck('자동 감지: 칸 어휘 열 단위 합집합', det.cols[0].values.includes('Hiromi') && det.cols[1].values.includes('neutral'), '');
  ck('★ 자동 감지: 넘치는 열은 생략 가능 칸', det.cols[2] && det.cols[2].optional === true, '');
  ck('구분자 없는 무리는 감지 포기 (틀린 초안이 더 해롭다)', ED.detectSlotsFromNames(['alpha', 'beta', 'gamma']) === null, '');
  const draft = ED.packDraftFromDetect(det, 'p1');
  ck('초안 칸 이름 관례 (who/emo)', draft.slots[0].id === 'who' && draft.slots[1].id === 'emo', '');

  const S = snap();
  const cov = ED.packCoverage(S.assets.packs[0], new Set(['Hiromi_angry', 'Hiromi_smile', 'Seiko_neutral']));
  ck('★ 실존 커버리지: 필수 6조합 중 3실존', cov.combos === 6 && cov.exist === 3, JSON.stringify(cov));
  ck('★ 폴백 구제 갈라 세기 (Seiko_angry/smile → Seiko_neutral)', cov.rescued === 2, JSON.stringify(cov));
  ck('예시는 실질 구멍만 (Hiromi_neutral은 폴백 실물도 없음)', cov.missing.join(',') === 'Hiromi_neutral', cov.missing.join(','));
  const noFb = JSON.parse(JSON.stringify(S.assets.packs[0])); delete noFb.slots[1].fallback;
  ck('폴백 없으면 구제 0 (런타임 사다리와 같은 계산)', ED.packCoverage(noFb, new Set(['Hiromi_angry'])).rescued === 0, '');
  ck('대조 불가 환경은 조합 수만', ED.packCoverage(S.assets.packs[0], null).exist === null, '');
  const nvp = JSON.parse(JSON.stringify(S.assets.packs[0])); nvp.verify = false;
  const covS = ED.packCoverage(nvp, new Set(['Hiromi_angry']));
  ck('verify:false 팩은 커버리지 대조 생략(skipped)', covS.skipped === true && covS.exist === null, JSON.stringify(covS));

  const ip = ED.buildPackImportPrompt('인물: A, B / 감정: happy');
  ck('임포터 프롬프트 = 팩 스키마 + 원문', ip.includes('"packs"') && ip.includes('인물: A, B'), '');
  ck('임포터: 지어내기 금지 지시', ip.includes('지어내지 마라'), '');
  ck('임포터: 팩 최소화 기준 (형식·구분자·조건 같으면 합쳐라)', ip.includes('팩 수는 최소로'), '');

  // 추론 모델의 <Thoughts> 서두 — 보조 응답 파서와 같은 추출기로 견뎌야 한다 (실측: 변환 실패)
  const thoughty = '<Thoughts> Analyzing {stuff} deeply... {"note": 1} </Thoughts>\n'
    + '```json\n{"packs": [{"id": "p1", "format": "<img=\\"{name}\\">", "slots": []}]}\n```';
  const ex = SC.require('engine').extractJsonObject(thoughty, 'packs');
  ck('★ 변환 추출기: <Thoughts> 중괄호에 안 걸리고 packs JSON 회수', !!ex && Array.isArray(ex.packs) && ex.packs[0].id === 'p1', JSON.stringify(ex));

  // 비용 추정 (v0.54.1) — "이 기능이 뭘 아끼나"를 숫자로
  ck('토큰 추정: 영문 ~3.5자/tok', ED.estTokens('abcdefg') === 2, String(ED.estTokens('abcdefg')));
  ck('토큰 추정: 한글 ~1.5자/tok', ED.estTokens('가나다') === 2, String(ED.estTokens('가나다')));
  const names = ['Hiromi_angry', 'Hiromi_smile', 'Seiko_neutral', 'Hiromi_smile_apron'];
  const cAux = ED.estAssetCost(S, names);
  ck('★ 비용 추정: aux는 메인 +0, 보조에만 실림', cAux.main === 0 && cAux.aux > 0, JSON.stringify(cAux));
  ck('기준선 = 통짜 목록(실물 이름 전부)', cAux.baseline > 0 && cAux.baseline === ED.estTokens(names.join('\n')), '');
  const Sm2 = snap(); Sm2.assets.by = 'main';
  const cMain = ED.estAssetCost(Sm2, null);
  ck('비용 추정: main은 주입문이 메인에, 보조 +0', cMain.aux === 0 && cMain.main > 0, JSON.stringify(cMain));
  ck('실물 목록 없으면 기준선 null (모르는 건 안 지어냄)', cMain.baseline === null, '');
  const Sf2 = snap(); Sf2.assets.by = 'aux_flow';
  ck('aux_flow도 메인 +0', ED.estAssetCost(Sf2, null).main === 0, '');
}

// 번들 배선 (3단계)
{
  ck('★ 사이드바에 에셋 작업영역', src.includes('data-floor="assets"') && src.includes('🎨 에셋 팩'), '');
  ck('편집기 assets 층 분기', src.includes("floorView === 'assets'"), '');
  ck('★ 호스트 getAssetNames 주입 (output 삽입과 같은 읽기 경로)', src.includes('getAssetNames'), '');
}

// ── 배선 (2단계): 가짜 리스 실부팅 — 보조가 image를 얹어 보내면 본문 맨 앞에 1장 ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function bootLive(mutate) {
  const LORE = src.match(/const SCHEMA_LORE_COMMENT = '([^']+)'/)?.[1];
  const SCHEMA = snap(); SCHEMA.updater = { allow: [{ id: 'nsfw_on' }] };
  if (mutate) mutate(SCHEMA);
  const world = {
    auxResult: '{"changes":{},"reasons":{},"image":{"who":"Hiromi","emo":"angry"}}',
    chars: [{
      chaId: 'c-sim', name: '에셋 봇', triggerscript: [],
      globalLore: [{ comment: LORE, content: JSON.stringify(SCHEMA) }],
      // [live-test] 실제 additionalAssets 항목 형태 확인 — 배열/객체 둘 다 받는다
      additionalAssets: [['Hiromi_angry', 'a.png', 'png'], ['Seiko_neutral', 'b.png', 'png']],
    }],
    chats: { 'c-sim:0': { id: 'ch0', modules: ['m-chat'], message: [{ role: 'user', data: '안녕' }] } },
  };
  const store = new Map();
  global.Risuai = {
    getCharacter: async () => world.chars[0],
    // 모듈봇: 이미지가 모듈의 '추가 에셋'에 사는 경우 (실측: MIKU&BRS 모듈).
    // 활성 = 전역 enabledModules(m-on) ∪ 채팅 chat.modules(m-chat, 봇 개별 활성화).
    // 꺼진 모듈(m-off) 이름은 대조에 안 낀다.
    getDatabase: async (keys) => {
      if (world.dbArgBroken && keys) return null; // includeOnly 인자를 모르는 구버전 흉내
      return {
        enabledModules: ['m-on'],
        modules: [
          { id: 'm-on', name: '노조미 모듈', assets: [['happy', 'n1.png', 'png']] },
          { id: 'm-chat', name: '개별 활성 모듈', assets: [['Seiko_smile', 's1.png', 'png']] },
          { id: 'm-off', name: '꺼진 모듈', assets: [['Hiromi_smile', 'x.png', 'png']] },
        ],
      };
    },
    setCharacter: async (c) => { world.chars[0] = c; },
    getCurrentCharacterIndex: async () => 0,
    getCurrentChatIndex: async () => 0,
    getChatFromIndex: async () => world.chats['c-sim:0'],
    setChatToIndex: async (_a, _b, c) => { world.chats['c-sim:0'] = c; },
    registerButton: async () => {}, unregisterUIPart: async () => {}, registerSetting: async () => {},
    addRisuReplacer: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    addRisuScriptHandler: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
    showContainer: async () => {}, alert: async () => {},
    getArgument: async () => 'aux',            // 보조 직접 호출 강제
    onUnload: async (fn) => { global.__unload = fn; },
    runLLMModel: async () => ({ type: 'success', result: world.auxResult }),
    pluginStorage: {
      getItem: async (k) => (store.has(k) ? store.get(k) : null),
      setItem: async (k, v) => { store.set(k, v); },
      removeItem: async (k) => { store.delete(k); },
      keys: async () => [...store.keys()],
    },
  };
  const el = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    children: [], appendChild() {}, append() {}, remove() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : undefined), set: () => true });
  global.document = { createElement: el, getElementById: () => null, body: el(),
    querySelector: () => null, querySelectorAll: () => [], head: el(), addEventListener() {} };
  global.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  (0, eval)(src);
  await sleep(150);
  return world;
}

(async () => {
  const world = await bootLive();
  const hooks = global.__hooks ?? {};
  ck('실부팅: output 훅 등록', typeof hooks.output === 'function', Object.keys(hooks).join(','));

  // 턴 1: 정조합 적중 → 본문 맨 앞 1장 + 마커 유지
  await hooks.beforeRequest([{ role: 'user', content: '안녕' }], 'model');
  const out1 = await hooks.output('히로미가 화를 냈다.');
  ck('★ 실부팅: 이미지 태그가 본문 맨 앞에 1장', out1.startsWith('<img="Hiromi_angry">\n\n'), out1.slice(0, 60));
  ck('실부팅: 마커는 그대로 뒤에 붙는다', /⟦simcore:1⟧$/.test(out1), out1.slice(-30));

  // 턴 2: 모르는 인물 → 조용히 생략 (깨진 이미지 0)
  world.chats['c-sim:0'].message.push({ role: 'char', data: '첫 응답' }, { role: 'user', data: '다음' });
  world.auxResult = '{"changes":{},"reasons":{},"image":{"who":"Ghost","emo":"angry"}}';
  await hooks.beforeRequest([{ role: 'user', content: '다음' }], 'model');
  const out2 = await hooks.output('낯선 사람이 나타났다.');
  ck('★ 실부팅: 모르는 인물은 태그 없이 본문 그대로', out2.startsWith('낯선 사람이'), out2.slice(0, 60));

  // 턴 3: image:null (장면 초점 없음) → 생략
  world.chats['c-sim:0'].message.push({ role: 'char', data: '둘째 응답' }, { role: 'user', data: '셋' });
  world.auxResult = '{"changes":{},"reasons":{},"image":null}';
  await hooks.beforeRequest([{ role: 'user', content: '셋' }], 'model');
  const out3 = await hooks.output('조용한 오후다.');
  ck('실부팅: image:null이면 생략', out3.startsWith('조용한 오후다'), out3.slice(0, 60));

  // 턴 4: 모듈봇 — 이미지가 켜진 모듈의 '추가 에셋'에 사는 경우 (실측: MIKU&BRS)
  world.chats['c-sim:0'].message.push({ role: 'char', data: '셋째 응답' }, { role: 'user', data: '넷' });
  world.auxResult = '{"changes":{},"reasons":{},"image":{"who":"Nozomi","emo":"happy"}}';
  await hooks.beforeRequest([{ role: 'user', content: '넷' }], 'model');
  const out4 = await hooks.output('노조미가 웃었다.');
  ck('★ 실부팅: 켜진 모듈의 에셋도 대조에 합쳐진다', out4.startsWith('<char-noz emotion="happy">'), out4.slice(0, 60));

  // 턴 5: 꺼진 모듈의 에셋 이름(Hiromi_smile)은 대조에 안 낀다 → 폴백도 실물 없음 → 생략
  world.chats['c-sim:0'].message.push({ role: 'char', data: '넷째 응답' }, { role: 'user', data: '다섯' });
  world.auxResult = '{"changes":{},"reasons":{},"image":{"who":"Hiromi","emo":"smile"}}';
  await hooks.beforeRequest([{ role: 'user', content: '다섯' }], 'model');
  const out5 = await hooks.output('히로미가 미소지었다.');
  ck('★ 실부팅: 꺼진 모듈의 에셋은 실존으로 안 친다 (렌더 안 될 이미지 차단)', out5.startsWith('히로미가'), out5.slice(0, 60));

  // 턴 6: 봇 개별 활성화 모듈(chat.modules) — 전역 enabledModules에 없어도 활성으로 친다 (실측 MIKU&BRS)
  world.chats['c-sim:0'].message.push({ role: 'char', data: '다섯째 응답' }, { role: 'user', data: '여섯' });
  world.auxResult = '{"changes":{},"reasons":{},"image":{"who":"Seiko","emo":"smile"}}';
  await hooks.beforeRequest([{ role: 'user', content: '여섯' }], 'model');
  const out6 = await hooks.output('세이코가 웃었다.');
  ck('★ 실부팅: 채팅 개별 활성 모듈의 에셋도 대조 합류', out6.startsWith('<img="Seiko_smile">'), out6.slice(0, 60));

  // 턴 7: includeOnly 인자를 모르는 구버전 리수 — 무인자 재호출 사다리로 살아남는다
  world.dbArgBroken = true;
  world.chats['c-sim:0'].message.push({ role: 'char', data: '여섯째 응답' }, { role: 'user', data: '일곱' });
  world.auxResult = '{"changes":{},"reasons":{},"image":{"who":"Nozomi","emo":"happy"}}';
  await hooks.beforeRequest([{ role: 'user', content: '일곱' }], 'model');
  const out7 = await hooks.output('노조미가 또 웃었다.');
  ck('★ 실부팅: getDatabase 인자 미지원 버전도 무인자 폴백으로 모듈 읽기', out7.startsWith('<char-noz emotion="happy">'), out7.slice(0, 60));
  world.dbArgBroken = false;

  if (global.__unload) global.__unload();

  // ── 배선: aux_flow 실부팅 — 보조가 images 배열+앵커를 보내면 서사 위치에 여러 장 ──
  {
    const w2 = await bootLive((s) => { s.assets.by = 'aux_flow'; });
    const hk = global.__hooks ?? {};
    w2.chars[0].additionalAssets.push(['Hiromi_neutral', 'c.png', 'png']);
    w2.auxResult = '{"changes":{},"reasons":{},"images":['
      + '{"who":"Hiromi","emo":"angry","anchor":"히로미가 문을 박찼다"},'
      + '{"who":"Seiko","emo":"neutral","anchor":"세이코는 조용히 고개를"},'
      + '{"who":"Hiromi","emo":"angry","anchor":"본문에 없는 인용문"}]}';
    await hk.beforeRequest([{ role: 'user', content: '가자' }], 'model');
    const body = '히로미가 문을 박찼다.\n\n세이코는 조용히 고개를 저었다.\n\n비가 온다.';
    const outF = await hk.output(body);
    const iH = outF.indexOf('<img="Hiromi_angry">'), iS = outF.indexOf('<img="Seiko_neutral">');
    ck('★ 실부팅 flow: 두 장이 앵커 문단 뒤에, 서사 순서대로', iH > 0 && iS > iH, outF.slice(0, 160));
    ck('실부팅 flow: 앵커 문단 바로 뒤 배치', outF.includes('박찼다.\n\n<img="Hiromi_angry">\n\n세이코는'), outF.slice(0, 120));
    ck('실부팅 flow: 못 찾은 인용 장은 생략 (2장만)', (outF.match(/<img=/g) || []).length === 2, '');
    ck('실부팅 flow: 마커 유지', /⟦simcore:1⟧$/.test(outF), outF.slice(-30));

    // 다음 턴: 전부 못 찾는 앵커 → 첫 장 맨 앞 강등
    w2.chats['c-sim:0'].message.push({ role: 'char', data: '첫 응답' }, { role: 'user', data: '다음' });
    w2.auxResult = '{"changes":{},"reasons":{},"images":[{"who":"Hiromi","emo":"angry","anchor":"어디에도 없는 문장"}]}';
    await hk.beforeRequest([{ role: 'user', content: '다음' }], 'model');
    const outD = await hk.output('평화로운 아침이다.');
    ck('★ 실부팅 flow: 전패 시 맨 앞 강등', outD.startsWith('<img="Hiromi_angry">\n\n평화로운'), outD.slice(0, 60));
    if (global.__unload) global.__unload();
  }

  // ── v0.64 에셋 전용 설치 — 변수 0개로도 설치되고, 이미지가 실제로 붙는다 ──
  // 유저 지적: "에셋만 쓸 건데 무조건 변수를 등록하라고 한다". 통행세로 만든 껍데기 변수는
  // 상태창·보조 프롬프트에 평생 따라다닌다.
  {
    const eng = SC.require('engine');
    const { renderStatusHtml } = SC.require('render');
    const { diagnose } = SC.require('diagnose');
    const { schemaIsBlank } = SC.require('editor');

    // 에셋만 쓰는 봇 — 변수·상태창·갱신 허용목록이 통째로 없다
    const ONLY = () => ({
      simcore: '0.1', meta: { name: '에셋만' }, vars: [],
      assets: { by: 'aux', packs: [{
        id: 'p1', source: '모듈A', sep: '_', format: '<img="{name}">',
        slots: [{ id: 'who', values: ['Arin'] }, { id: 'emo', values: ['smile', 'sad'], fallback: 'smile' }],
      }] },
    });

    // ① 설치 — 변수 없이 도는 기능이 켜져 있을 때만 통과. 빈 스키마는 그대로 오류
    const vOnly = validateSchema(ONLY());
    ck('★ 에셋 전용: 변수 0개여도 설치 통과', vOnly.ok, JSON.stringify(vOnly.errors));
    ck('에셋 전용: 대신 경고로 뭐가 안 뜨는지 알려준다',
      vOnly.warnings.some((w) => w.path === '$.vars' && /에셋/.test(w.msg)), JSON.stringify(vOnly.warnings));
    const vEmpty = validateSchema({ simcore: '0.1', vars: [] });
    ck('★ 아무 일도 안 하는 빈 스키마는 여전히 오류',
      !vEmpty.ok && vEmpty.errors.some((e) => e.path === '$.vars'), JSON.stringify(vEmpty.errors));
    const vNoArr = validateSchema({ simcore: '0.1' });
    ck('vars 자체가 없으면 오류 (배열은 있어야 엔진이 돈다)',
      !vNoArr.ok && vNoArr.errors.some((e) => e.path === '$.vars'), JSON.stringify(vNoArr.errors));
    const vSug = validateSchema({ simcore: '0.1', vars: [], suggest: { count: 3 } });
    ck('행동 제안만 켠 봇도 통과 (변수 없이 도는 기능)', vSug.ok, JSON.stringify(vSug.errors));

    // ② 보조 호출 게이트 — 여기가 진짜로 막혀 있던 곳. 개수로 끊으면 이미지가 영영 안 붙는다
    const st0 = eng.initState(ONLY());
    ck('★ auxHasWork: 변수 0개여도 열린 팩이 있으면 부른다', eng.auxHasWork(ONLY(), st0) === true, '');
    ck('auxHasWork: 변수도 팩도 없으면 안 부른다',
      eng.auxHasWork({ vars: [] }, { vars: {}, meta: {} }) === false, '');
    const mainOnly = ONLY(); mainOnly.assets.by = 'main';
    ck("auxHasWork: by:'main'은 본 프롬프트 주입이라 보조와 무관",
      eng.auxHasWork(mainOnly, eng.initState(mainOnly)) === false, '');
    const gated = snap(); gated.assets.packs = gated.assets.packs.filter((p2) => p2.when); gated.updater = { allow: [] };
    ck('auxHasWork: 게이트가 전부 닫힌 턴엔 부를 이유가 없다',
      eng.auxHasWork(gated, eng.initState(gated)) === false, '');
    ck('auxHasWork: 제안만 켜도 부른다',
      eng.auxHasWork({ vars: [], suggest: {} }, { vars: {}, meta: {} }) === true, '');

    // ③ 프롬프트 — 시킬 변수가 없는데 "변화만 출력하라"를 보내면 시킨 일 없는 지시서가 된다
    const pOnly = eng.buildAuxPrompt(ONLY(), st0, '아린이 웃었다', null, '');
    ck('★ 변수 0개 프롬프트: 장면 분석기로 갈아탄다', pOnly.startsWith('너는 장면 분석기다'), pOnly.slice(0, 40));
    ck('변수 0개 프롬프트: 빈 [조정 가능 변수] 목록을 안 붙인다', !pOnly.includes('[조정 가능 변수]'), '');
    ck('변수 0개 프롬프트: 겉껍데기는 유지 (파서 한 갈래)', pOnly.includes('{"changes": {}, "reasons": {}}'), '');
    ck('★ 변수 0개 프롬프트: 이미지 지시는 그대로 실린다',
      pOnly.includes('"image"') && pOnly.includes('who: one of [Arin]'), '');
    const FULL = () => { const s = snap(); s.updater = { allow: [{ id: 'nsfw_on' }] }; return s; };
    const pFull = eng.buildAuxPrompt(FULL(), eng.initState(FULL()), '히로미가 화를 냈다', null, '');
    ck('갱신할 변수가 있는 봇의 프롬프트는 그대로 (회귀 없음)',
      pFull.startsWith('너는 시뮬레이션 상태 관리자다') && pFull.includes('[조정 가능 변수]'), pFull.slice(0, 40));
    // 변수는 있는데 이번 턴에 열린 것이 하나도 없는 경우도 같은 길로 간다 — 빈 목록은 안 보낸다
    const pShut = eng.buildAuxPrompt(snap(), eng.initState(snap()), '조용한 오후다', null, '');
    ck('허용 변수가 비면 변수가 있는 봇도 장면 분석기로 간다', pShut.startsWith('너는 장면 분석기다'), pShut.slice(0, 40));

    // ④ 빈 상자·헛지침 제거
    ck('★ 변수 0개면 상태창 HTML 자체를 안 낸다', renderStatusHtml(ONLY(), st0) === '', renderStatusHtml(ONLY(), st0));
    ck('변수가 있으면 상태창은 그대로 나온다',
      renderStatusHtml(snap(), eng.initState(snap())).includes('sim-status'), '');
    const sendOnly = eng.sendPhase(ONLY(), st0);
    ck('★ 변수 0개면 "수치·상태는 시스템이 관리한다" 기본 지침도 안 붙는다',
      !sendOnly.promptBlock.includes('수치·상태는 시스템이 관리한다'), sendOnly.promptBlock.slice(0, 80));
    ck('변수가 있으면 기본 지침은 그대로',
      eng.sendPhase(snap(), eng.initState(snap())).promptBlock.includes('수치·상태는 시스템이 관리한다'), '');

    // ⑤ 도구가 정상 설계를 벌주지 않게 (v0.52 원칙)
    const dOnly = diagnose(ONLY(), { turns: 10, runs: 1 });
    ck('★ 진단: 에셋 전용 봇을 "패배 변수 없음/프리셋 없음"으로 나무라지 않는다',
      dOnly.findings.every((x) => x.tag === '검증'), JSON.stringify(dOnly.findings.map((x) => x.tag)));
    ck('★ 빈 봇 판정: 팩이 있으면 빈 봇이 아니다 (기능 카드·패치 경로가 열린다)',
      schemaIsBlank(ONLY()) === false && schemaIsBlank({ vars: [] }) === true, '');
  }

  // ── 배선: 변수 0개 봇 실부팅 — 게이트를 개수로 끊던 회귀의 본체 ──
  {
    const w3 = await bootLive((s) => {
      s.vars = [];
      s.updater = { allow: [] };
      s.assets.packs = s.assets.packs.filter((p2) => !p2.when); // 게이트 팩은 변수를 본다
      delete s.statusUI;
    });
    const hk = global.__hooks ?? {};
    w3.auxResult = '{"changes":{},"reasons":{},"image":{"who":"Hiromi","emo":"angry"}}';
    await hk.beforeRequest([{ role: 'user', content: '안녕' }], 'model');
    const outO = await hk.output('히로미가 화를 냈다.');
    ck('★ 실부팅: 변수 0개 봇에서도 이미지가 붙는다 (예전엔 호출 자체를 건너뛰었다)',
      outO.startsWith('<img="Hiromi_angry">\n\n'), outO.slice(0, 60));
    ck('실부팅: 변수 0개여도 마커는 정상', /⟦simcore:1⟧$/.test(outO), outO.slice(-30));
    if (global.__unload) global.__unload();
  }

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
