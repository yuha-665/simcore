const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.23.0 — 🗺️ 지도 (유저 2026-11-09, 교토 전도 스샷: "심코어에도 이렇게 지도 그리는 기능" → "지도를 완성해 가면서 채워지는 기믹").
// 못 박는 것:
//   ① 그리기 재료 — 장소·구역·이정표·분류, 안개 없는 지도는 다 보인다
//   ② 안개 — known(처음부터/식/가 봐야) · 발자취 · 지금 여기 · 구역은 가 봐야 걷힌다
//   ③ 찾아낸 곳 — "이름 (구역)"이 그 구역 안에 꽂히고 같은 이름은 같은 자리, 못 찾으면 버리지 않고 알린다
//   ④ 정산 — 위치가 장소·구역을 가리키면 시스템이 발자취에 적는다 (보조 몫이 아니다), 꽉 차면 안 민다
//   ⑤ 그림 — 이스케이프 · 분류 거르기 · 고른 것의 사정 · 이정표 나눠 놓기
//   ⑥ 검증 — 오류·경고 (위치 선택지에 없는 장소 = 영영 안개)
//   ⑦ 배선 — 번들·어댑터 패널·편집기 탭·기능 지도·패치 거부·활성 절
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const MAP = SC.require('map');
const engine = SC.require('engine');
const { validateSchema, activeSections } = SC.require('validate');
const { seededRng } = SC.require('rng');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

function makeDom() {
  const mkEl = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(), nodeType: 1, children: [], childNodes: [],
      style: { cssText: '' }, dataset: {}, attrs: {}, _text: '',
      className: '', value: '', checked: false, open: false, disabled: false,
      classList: {
        add(...c) { for (const x of c) if (!el.className.split(' ').includes(x)) el.className = (el.className + ' ' + x).trim(); },
        remove(...c) { el.className = el.className.split(' ').filter((x) => !c.includes(x)).join(' '); },
        contains: (c) => el.className.split(' ').includes(c),
        toggle(c, on) { if (on === false || (on === undefined && el.classList.contains(c))) el.classList.remove(c); else el.classList.add(c); },
      },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'open') el.open = true; if (k === 'disabled') el.disabled = true; },
      getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
      removeAttribute(k) { delete el.attrs[k]; },
      appendChild(c) { el.children.push(c); el.childNodes.push(c); c.parentNode = el; return c; },
      append(...cs) { for (const c of cs) el.appendChild(c); },
      insertBefore(c, ref) { const i = el.children.indexOf(ref); el.children.splice(i < 0 ? el.children.length : i, 0, c); el.childNodes = el.children; c.parentNode = el; return c; },
      removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) { el.children.splice(i, 1); el.childNodes = el.children; } return c; },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() { el.onclick?.({ preventDefault() {} }); },
      scrollIntoView() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 200, height: 30, bottom: 30, right: 200 }),
      setPointerCapture() {}, releasePointerCapture() {},
      replaceChildren(...cs) { el.children = []; el.childNodes = []; for (const c of cs) el.appendChild(c); },
      prepend(...cs) { el.children.unshift(...cs); el.childNodes = el.children; },
      querySelector: () => null, querySelectorAll: () => [],
      closest: () => null, contains: () => false,
      cloneNode: () => mkEl(tag),
    };
    Object.defineProperty(el, 'textContent', {
      get() { return el._text + el.children.map((c) => c.textContent ?? '').join(''); },
      set(v) { el._text = String(v); el.children = []; el.childNodes = []; },
    });
    Object.defineProperty(el, 'innerHTML', { get: () => el._html ?? '', set(v) { el._html = String(v); el.children = []; el.childNodes = []; } });
    Object.defineProperty(el, 'firstChild', { get: () => el.children[0] ?? null });
    Object.defineProperty(el, 'lastChild', { get: () => el.children[el.children.length - 1] ?? null });
    return el;
  };
  const doc = {
    createElement: mkEl, createElementNS: (_ns, tag) => mkEl(tag),
    createTextNode: (t) => { const n = mkEl('#text'); n.nodeType = 3; n._text = String(t); return n; },
    createDocumentFragment: () => mkEl('#frag'),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  doc.body = mkEl('body'); doc.head = mkEl('head'); doc.documentElement = mkEl('html');
  return doc;
}
function findAll(root, pred, out = []) {
  for (const c of root.children || []) { if (pred(c)) out.push(c); findAll(c, pred, out); }
  return out;
}
const btn = (root, label) => findAll(root, (e) => e.tagName === 'BUTTON' && (e.textContent || '').includes(label))[0];

const BASE = {
  simcore: '0.1', meta: { name: '교토' },
  vars: [
    { id: 'location', label: '위치', type: 'enum', enum: ['어소', '기온', '시마바라', '가모가와 동안', '에도'], init: '어소' },
    { id: 'visited', label: '발자취', type: 'list', init: [], maxItems: 20 },
    { id: 'rumors', label: '소문', type: 'list', init: [] },
    { id: 'finds', label: '찾아낸 곳', type: 'list', init: [] },
  ],
  map: {
    label: '교토 전도', ratio: 1.1, locVar: 'location', seenVar: 'visited', listVar: 'finds',
    categories: [{ label: '권력', color: '#b3392f' }, { label: '유흥' }],
    zones: [{ label: '가모가와 동안', x: 60, y: 5, w: 35, h: 80, desc: '강 건너' }, { label: '서쪽 들판', x: 0, y: 60, w: 30, h: 40, match: ['들판'] }],
    places: [
      { name: '어소', sub: '御所', cat: '권력', x: 40, y: 20, desc: '천황의 거처', known: true },
      { name: '기온', cat: '유흥', x: 75, y: 45, desc: '등불 거리', rumor: '밤새 불이 안 꺼진다는', known: 'has(rumors, "기온")' },
      { name: '시마바라', cat: '유흥', x: 15, y: 70, desc: '유곽', alias: ['島原'] },
    ],
    exits: [{ label: '에도', dir: 'e' }, { label: '도카이도', dir: 'e' }, { label: '오사카', dir: 'sw' }, { label: '구라마', dir: 'n' }],
  },
};

(async () => {
  console.log('── ① 그리기 재료 (안개 없음)');
  {
    const s = clone(BASE);
    const st = engine.initState(s);
    const v = MAP.mapView(s, st, engine.makeLookup);
    ck('안개가 없으면 known 없는 곳도 보임', v.places[2].state === 'known' && v.places[0].state === 'seen', v.places.map((p) => p.state).join(','));
    ck('★ 안개가 없어도 known 식이 거짓이면 숨는다 (조건부로 생기는 곳)', v.places[1].state === 'hidden', v.places[1].state);
    ck('지금 여기 = 어소 (장소)', v.here?.kind === 'place' && v.here.name === '어소', JSON.stringify(v.here));
    ck('구역 둘 다 열림', v.zones.every((z) => z.open), '');
    ck('분류 색 — 없으면 팔레트', v.cats[0].color === '#b3392f' && /^#/.test(v.cats[1].color), JSON.stringify(v.cats));
    ck('장소 색 = 분류 색', v.places[0].color === '#b3392f', v.places[0].color);
    ck('기온의 구역 = 가모가와 동안 (좌표로)', v.places[1].zone === v.zones[0].key, v.places[1].zone);
    const right = v.exits.filter((e) => e.edge === 'right');
    ck('★ 같은 변의 이정표는 고르게 나눈다 (겹치지 않는다)', right.length === 2 && right[0].at !== right[1].at, right.map((e) => e.at).join(','));
    ck('남서 이정표는 왼쪽 변 아래', v.exits.find((e) => e.label === '오사카').edge === 'left' && v.exits.find((e) => e.label === '오사카').at === 90, '');
    ck('비율', v.ratio === 1.1, v.ratio);
  }

  console.log('── ② 안개');
  {
    const s = clone(BASE); s.map.fog = true;
    let st = engine.initState(s);
    let v = MAP.mapView(s, st, engine.makeLookup);
    const by = (n) => v.places.find((p) => p.name === n);
    ck('known:true 어소는 보임 (지금 여기라 seen)', by('어소').state === 'seen', by('어소').state);
    ck('★ 식이 거짓이면 기온은 안 보임', by('기온').state === 'hidden', by('기온').state);
    ck('★ known 없는 시마바라는 가 봐야 보임', by('시마바라').state === 'hidden', by('시마바라').state);
    ck('구역은 가 봐야 걷힘', v.zones.every((z) => !z.open), v.zones.map((z) => z.open).join(','));
    ck('셈: 장소 1/3 · 지역 0/2', v.counts.seen === 1 && v.counts.places === 3 && v.counts.open === 0, JSON.stringify(v.counts));
    st.vars.rumors = ['기온'];
    v = MAP.mapView(s, st, engine.makeLookup);
    ck('★ 소문이 돌면 기온은 "아는 곳" (안 가 봄)', by('기온').state === 'known', by('기온').state);
    ck('아는 곳이어도 구역은 아직 안개', !v.zones[0].open, '');
    const d = MAP.detailOf(v, by('기온').key);
    ck('★ 안 가 본 곳은 desc 대신 rumor', d.text === '밤새 불이 안 꺼진다는' && d.badge === '소문으로만 아는 곳', JSON.stringify(d));
    st.vars.visited = ['島原'];
    v = MAP.mapView(s, st, engine.makeLookup);
    ck('★ 발자취(별칭으로 적혀도) → 시마바라 보임', by('시마바라').state === 'seen', by('시마바라').state);
    ck('★ 가 본 장소가 있는 구역은 걷힘', v.zones[1].open, '');
    st.vars.location = '가모가와 동안';
    v = MAP.mapView(s, st, engine.makeLookup);
    ck('지금 여기 = 구역', v.here?.kind === 'zone' && v.zones[0].here && v.zones[0].open, JSON.stringify(v.here));
    const rv = MAP.mapView(s, st, engine.makeLookup, { reveal: true });
    ck('편집기 "안개 걷은 모습"은 전부 보임', rv.places.every((p) => p.state === 'seen') && rv.zones.every((z) => z.open) && !rv.fog, '');
  }

  console.log('── ③ 찾아낸 곳');
  {
    const s = clone(BASE); s.map.fog = true;
    const st = engine.initState(s);
    st.vars.finds = ['버려진 갱도 (서쪽 들판)', '야사카 탑 (가모가와 동안) @12', '들판 끝 우물', '어딘가 이상한 곳 (달나라)'];
    const v = MAP.mapView(s, st, engine.makeLookup);
    ck('괄호 꼬리표 → 그 구역', v.pins[0].zone === v.zones[1].key && v.pins[0].name === '버려진 갱도', JSON.stringify(v.pins[0]));
    ck('기한 표기(@12)는 떼고 이름만', v.pins[1].name === '야사카 탑' && v.pins[1].zone === v.zones[0].key, JSON.stringify(v.pins[1]));
    ck('꼬리표가 없으면 글에 든 구역 이름(match 포함)', v.pins[2]?.zone === v.zones[1].key, JSON.stringify(v.pins[2]));
    ck('★ 못 찾으면 버리지 않고 stray로', v.stray.length === 1 && v.stray[0].raw.includes('달나라'), JSON.stringify(v.stray));
    const z = v.zones[1];
    ck('★ 핀은 그 구역 안', v.pins.filter((p) => p.zone === z.key).every((p) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h), '');
    ck('★ 핀이 있으면 안개 구역도 걷힘', v.zones.every((q) => q.open), '');
    const v2 = MAP.mapView(s, st, engine.makeLookup);
    ck('같은 이름은 늘 같은 자리', v2.pins[0].x === v.pins[0].x && v2.pins[0].y === v.pins[0].y, '');
    // 많이 꽂아도 겹침이 적다 (같은 구역 12개)
    st.vars.finds = Array.from({ length: 12 }, (_, i) => `동굴 ${i} (가모가와 동안)`);
    const v3 = MAP.mapView(s, st, engine.makeLookup);
    const tooClose = v3.pins.filter((a, i) => v3.pins.some((b, j) => j > i && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2)).length;
    ck('12개를 꽂아도 거의 안 겹친다', tooClose <= 1, String(tooClose));
    st.vars.location = '야사카 탑';
    st.vars.finds = ['야사카 탑 (가모가와 동안)'];
    const v4 = MAP.mapView(s, st, engine.makeLookup);
    ck('지금 여기 = 찾아낸 곳', v4.here?.kind === 'pin', JSON.stringify(v4.here));
  }

  console.log('── ④ 정산이 발자취를 적는다');
  {
    const s = clone(BASE); s.map.fog = true;
    let st = engine.initState(s);
    let o = engine.outputPhase(s, st, {}, {}, { rng: seededRng('m', 1, 'o') });
    ck('★ 첫 정산 — 출발지 어소가 발자취에', JSON.stringify(o.state.vars.visited) === '["어소"]', JSON.stringify(o.state.vars.visited));
    ck('원장에 남는다 (source map)', o.changeLog.some((c) => c.id === 'visited' && c.source === 'map'), '');
    st = o.state; st.vars.location = '시마바라';
    o = engine.outputPhase(s, st, {}, {}, { rng: seededRng('m', 2, 'o') });
    ck('옮기면 그곳도', JSON.stringify(o.state.vars.visited) === '["어소","시마바라"]', JSON.stringify(o.state.vars.visited));
    o = engine.outputPhase(s, o.state, {}, {}, { rng: seededRng('m', 3, 'o') });
    ck('같은 곳은 두 번 안 적는다', o.state.vars.visited.length === 2 && !o.changeLog.some((c) => c.source === 'map'), '');
    st = o.state; st.vars.location = '시마바라'; st.vars.location = '가모가와 동안';
    o = engine.outputPhase(s, st, {}, {}, { rng: seededRng('m', 4, 'o') });
    ck('구역도 적는다', o.state.vars.visited.includes('가모가와 동안'), JSON.stringify(o.state.vars.visited));
    st = o.state; st.vars.location = '에도';
    o = engine.outputPhase(s, st, {}, {}, { rng: seededRng('m', 5, 'o') });
    ck('지도 밖(에도)은 안 적는다', !o.state.vars.visited.includes('에도'), '');
    const v = MAP.mapView(s, o.state, engine.makeLookup);
    ck('★ 떠나도 가 본 곳은 보인다', v.places.find((p) => p.name === '시마바라').state === 'seen' && v.zones[0].open, '');
    // 꽉 찬 목록은 밀어내지 않는다 (밀면 지도가 도로 안개에 덮인다)
    const s2 = clone(BASE); s2.map.fog = true; s2.vars[1].maxItems = 1;
    let t = engine.initState(s2); t.vars.visited = ['기온'];
    o = engine.outputPhase(s2, t, {}, {}, { rng: seededRng('m', 6, 'o') });
    ck('★ 꽉 차면 안 적고 안 민다', JSON.stringify(o.state.vars.visited) === '["기온"]', JSON.stringify(o.state.vars.visited));
    // 발자취가 없는 지도는 아무것도 안 건드린다
    const s3 = clone(BASE); delete s3.map.seenVar;
    o = engine.outputPhase(s3, engine.initState(s3), {}, {}, { rng: seededRng('m', 7, 'o') });
    ck('seenVar 없으면 조용', !o.changeLog.some((c) => c.source === 'map') && o.state.vars.visited.length === 0, '');
    // 조건식이 읽는다 — 지도를 채운 만큼 열리는 이벤트
    const s4 = clone(BASE); s4.map.fog = true;
    s4.vars.push({ id: 'cartographer', type: 'bool', init: false });
    s4.rules = { events: [{ id: 'mapper', when: 'count(visited) >= 2', effects: [{ set: 'cartographer', expr: 'true' }], once: true }] };
    t = engine.initState(s4); t.vars.visited = ['어소']; t.vars.location = '시마바라';
    o = engine.outputPhase(s4, t, {}, {}, { rng: seededRng('m', 8, 'o') });
    o = engine.outputPhase(s4, o.state, {}, {}, { rng: seededRng('m', 9, 'o') });
    ck('★ count(visited)로 여는 이벤트', o.state.vars.cartographer === true, String(o.state.vars.cartographer));
  }

  console.log('── ⑤ 그림');
  {
    const s = clone(BASE); s.map.fog = true;
    s.map.places.push({ name: '<b>나쁜</b>"이름', x: 50, y: 50, known: true, desc: '<script>x</script>' });
    const st = engine.initState(s); st.vars.rumors = ['기온'];
    const v = MAP.mapView(s, st, engine.makeLookup);
    const html = MAP.renderMapHtml(v, {});
    ck('★ 이름·설명 이스케이프', !html.includes('<b>나쁜') && html.includes('&lt;b&gt;나쁜&lt;/b&gt;&quot;이름'), '');
    ck('숨은 곳은 안 그린다 (시마바라)', !html.includes('시마바라'), '');
    ck('아는 곳은 ? 표시', html.includes('기온 ?') && html.includes('scm-st-known'), '');
    ck('지금 여기 표시', html.includes('현재 위치') && html.includes('scm-here'), '');
    // v1.24.1 아틀리에 실기 — 점 밑에 따로 단 "현재 위치"가 바로 아래 장소(별의 고치 카페)의 이름표에 덮였다
    ck('★ 현재 위치는 이름표 안에 (점 밑 따로 달기 금지)', /<span class="scm-name">[^<]*<b class="scm-now">현재 위치<\/b><\/span><\/button>/.test(html)
      && !/<\/span><span class="scm-now">/.test(html), '');
    ck('★ 현재 위치 핀은 이웃 핀 위에 그린다', MAP.MAP_CSS.includes('.scm-pin.scm-here{z-index:4}') && !/\.scm-now\{position:absolute/.test(MAP.MAP_CSS), '');
    ck('안개 구역은 ？', html.includes('scm-fog') && html.includes('>？<'), '');
    ck('분류 단추 (전체 + 둘)', (html.match(/data-scm-cat=/g) || []).length === 3, '');
    ck('비율 → padding', html.includes('--scm-ratio:110%'), '');
    const f = MAP.renderMapHtml(v, { cat: '권력' });
    ck('분류 거르기 — 다른 분류는 흐리게', /scm-pin[^"]*scm-dim[^"]*" data-scm="p1"/.test(f) && !/scm-dim[^"]*" data-scm="p0"/.test(f), '');
    const sel = MAP.renderMapHtml(v, { sel: 'p0' });
    ck('★ 고르면 사정 카드 (desc·부제·뱃지)', sel.includes('scm-detail') && sel.includes('천황의 거처') && sel.includes('御所') && sel.includes('지금 여기'), '');
    const bad = MAP.renderMapHtml(MAP.mapView(s, st, engine.makeLookup, { reveal: true }), { sel: 'p3' });
    ck('★ 설명도 이스케이프', !bad.includes('<script>') && bad.includes('&lt;script&gt;'), '');
    const s2 = clone(BASE); s2.map.categories[0].color = 'red;background:url(x)';
    const h2 = MAP.renderMapHtml(MAP.mapView(s2, engine.initState(s2), engine.makeLookup), {});
    ck('★ 색 칸으로 CSS 주입 안 됨', !h2.includes('url(x)'), '');
    st.vars.finds = ['외딴 곳 (없는 구역)'];
    ck('자리 못 찾은 곳 안내', MAP.renderMapHtml(MAP.mapView(s, st, engine.makeLookup), {}).includes('자리를 못 찾은 곳'), '');
    st.vars.location = '에도';
    ck('지도 밖 위치', MAP.renderMapHtml(MAP.mapView(s, st, engine.makeLookup), {}).includes('(지도 밖)'), '');
    ck('기본 모양에 안개·핀·이정표·움직임 줄이기', ['.scm-fog', '.scm-dot', '.scm-exit', 'prefers-reduced-motion'].every((k) => MAP.MAP_CSS.includes(k)), '');
  }

  console.log('── ⑥ 검증');
  {
    const ok = validateSchema(clone(BASE));
    ck('기본 예시 오류 0', ok.errors.length === 0, JSON.stringify(ok.errors));
    const mapWarn = ok.warnings.filter((w) => w.path.startsWith('$.map'));
    ck('기본 예시 지도 경고 0', mapWarn.length === 0, JSON.stringify(mapWarn));
    const errs = (patch) => { const s = clone(BASE); patch(s.map, s); return validateSchema(s); };
    const has = (r, path, word) => [...r.errors, ...r.warnings].some((e) => e.path.startsWith(path) && e.msg.includes(word));
    ck('좌표 범위', has(errs((m) => { m.places[0].x = 140; }), '$.map.places[0].x', '0~100'), '');
    ck('위치 변수 없음 = 오류', has(errs((m) => { m.locVar = 'nope'; }), '$.map.locVar', '없음'), '');
    ck('위치 변수가 list면 오류', has(errs((m) => { m.locVar = 'rumors'; }), '$.map.locVar', '하나'), '');
    ck('발자취는 list', has(errs((m) => { m.seenVar = 'location'; }), '$.map.seenVar', 'list'), '');
    ck('이름 겹침 (장소·구역·별칭)', has(errs((m) => { m.places[2].alias = ['기온']; }), '$.map.places[2]', '겹칩니다'), '');
    ck('이정표 방향', has(errs((m) => { m.exits[0].dir = 'up'; }), '$.map.exits[0].dir', 'n·ne'), '');
    ck('공개 조건 식 검사', has(errs((m) => { m.places[1].known = 'has(nope, "x")'; }), '$.map.places[1].known', "알 수 없는 변수 'nope'"), '');
    ck('없는 분류 경고', has(errs((m) => { m.places[0].cat = '종교'; }), '$.map.places[0].cat', 'categories에 없습니다'), '');
    ck('구역 0 크기', has(errs((m) => { m.zones[0].w = 0; }), '$.map.zones[0]', '0보다'), '');
    ck('구역 지도 밖 경고', has(errs((m) => { m.zones[0].w = 60; }), '$.map.zones[0]', '밖으로'), '');
    ck('발자취 크기 경고', has(errs((m, s) => { s.vars[1].maxItems = 3; }), '$.map.seenVar', 'maxItems'), '');
    ck('★ 안개 지도: 위치 선택지에 없고 known도 없는 장소 = 영영 안개', has(errs((m) => { m.fog = true; m.places.push({ name: '니조성', x: 30, y: 30 }); }), '$.map.places', '니조성'), '');
    ck('known이 있으면 그 경고 없음', !has(errs((m) => { m.fog = true; m.places.push({ name: '니조성', x: 30, y: 30, known: true }); }), '$.map.places', '니조성'), '');
    ck('locVar 없음 경고', has(errs((m) => { delete m.locVar; }), '$.map.locVar', '현재 위치'), '');
    ck('찾아낸 곳인데 구역 없음 경고', has(errs((m) => { delete m.zones; }), '$.map.listVar', '구역'), '');
    ck('ratio 범위', has(errs((m) => { m.ratio = 9; }), '$.map.ratio', '0.4~2.5'), '');
    ck('★ 활성 절에 지도 — 변수 없이도 설치 통과 목록', activeSections({ map: {} }).includes('지도'), '');
  }

  console.log('── ⑦ 배선');
  {
    ck('번들 CORE에 map', /const CORE = \[[^\]]*'map'/.test(fs.readFileSync(__P('../build.js'), 'utf8')), '');
    ck('어댑터 — 버튼·패널·CSS·열 때 초기화', ["kind: 'map'", "gameKind === 'map') renderMapPanel(root)", 'function renderMapPanel(root)', "gameKind === 'map' ? schema?.map?.css", 'mapUi = { cat: null, sel: null };   // 지도는 열 때마다', 'mapMod.MAP_CSS'].every((k) => src.includes(k)), '');
    ck('어댑터 패널은 data-* 위임 클릭', /closest\('\[data-scm-cat\],\[data-scm\]'\)/.test(src), '');
    const E = SC.require('editor');
    ck('기능 지도 표에 지도', E.FEATURE_MAP.some((f) => f.id === 'map' && f.keys.includes('map') && f.where === '[지도] 탭' && f.on({ map: {} }) && !f.on({})), '');
    ck('편집기 탭 목록·묶음·본문', src.includes("['map', '지도']") && src.includes("'quest', 'map']]") && src.includes('map: tabMap'), '');
    const PM = SC.require('patch');
    ck('패치 거부 문구 → [지도] 탭', PM.UNSUPPORTED_HINT.map === '[지도] 탭', '');
    ck('규격서 절', src.includes("'## 지도(map) — 장소를 오가는 봇이면 (선택)'"), '');
    ck('편집기 미리보기도 같은 기본 모양', src.includes('CSS + mapMod.MAP_CSS'), '');
  }

  console.log('── ⑧ 편집기 [지도] 탭 — 만들기 · 미리보기 · 찍기');
  {
    global.document = makeDom();
    global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (f) => f(), setTimeout, clearTimeout };
    global.navigator = { clipboard: { writeText: async () => {} } };
    global.confirm = () => true;
    const E = SC.require('editor');
    const openMapTab = (schema) => {
      const box = document.createElement('div');
      let last = null;
      const ed = E.createSchemaEditor(box, clone(schema), { onChange: (x) => { last = x; }, floor: 'deep' });
      const tab = findAll(box, (e) => e.tagName === 'BUTTON' && String(e.className).includes('sce-tab') && e.textContent === '지도')[0];
      let err = null; try { tab.click(); } catch (e) { err = e; }
      return { box, ed, err, last: () => last, tab };
    };
    const noMap = clone(BASE); delete noMap.map;
    let t = openMapTab(noMap);
    ck('탭 목록에 [지도]', !!t.tab, '');
    ck('빈 지도 탭 렌더 예외 없음', !t.err, t.err && t.err.message);
    const mk = btn(t.box, '지도 만들기');
    ck('[지도 만들기] 단추', !!mk, '');
    mk.click();
    const made = t.last()?.map;
    ck('★ 만들면 위치 변수가 연결되고 선택지 이름으로 장소가 깔린다 (찍기로 옮기면 됨)', made && made.locVar === 'location' && made.places.length === 5 && made.places.every((p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100), JSON.stringify(made));
    t = openMapTab(BASE);
    ck('지도 탭 렌더 예외 없음', !t.err, t.err && t.err.message);
    const art = () => findAll(t.box, (e) => String(e._html || '').includes('scm-surface'))[0];
    ck('★ 미리보기 = 패널과 같은 그림 (핀·구역·이정표)', !!art() && art()._html.includes('어소') && art()._html.includes('가모가와 동안') && art()._html.includes('에도'), '');
    btn(t.box, '＋ 장소 찍어 넣기').click();
    ck('찍기 대기 안내', (t.box.textContent || '').includes('새 장소를 놓을 자리를 누르세요') && art()._html.includes('scm-picking'), '');
    const a = art();
    a.querySelector = () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 220 }) });
    a.onclick({ clientX: 50, clientY: 110, target: a });
    const after = t.last()?.map?.places || [];
    const np = after[after.length - 1];
    ck('★ 미리보기를 누르면 그 자리에 새 장소 (25%, 50%)', after.length === 4 && np.x === 25 && np.y === 50, JSON.stringify(np));
    // 구역 두 번 찍기
    const zb = findAll(t.box, (e) => e.tagName === 'BUTTON' && e.textContent === '📍 두 번 찍기')[0];
    zb.click();
    let a2 = art(); a2.querySelector = a.querySelector;
    a2.onclick({ clientX: 20, clientY: 22, target: a2 });
    a2 = art(); a2.querySelector = a.querySelector;
    a2.onclick({ clientX: 100, clientY: 110, target: a2 });
    const z0 = t.last()?.map?.zones?.[0];
    ck('★ 구역은 두 모서리로 (10,10 ~ 50,50)', z0 && z0.x === 10 && z0.y === 10 && z0.w === 40 && z0.h === 40, JSON.stringify(z0));
    // 안개를 켜면 공개 조건 칸이 생긴다
    const fogged = clone(BASE); fogged.map.fog = true;
    t = openMapTab(fogged);
    ck('안개 지도: 공개 조건 고르기가 장소마다', (t.box.textContent || '').includes('가 봐야 보임') && (t.box.textContent || '').includes('처음부터 보임'), '');
    const small = clone(fogged); small.vars[1].maxItems = 3;
    t = openMapTab(small);
    ck('검증 경고가 탭 머리에 (발자취 크기)', (t.box.textContent || '').includes('seenVar — 발자취 목록'), '');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
