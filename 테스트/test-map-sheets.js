const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.26.0 — 🗺️ 지도 여러 장 (설계: docs/design-지도-여러장.md · 계획: docs/plans/2026-11-15-지도-여러장.md)
// 못 박는 것:
//   ① 코어 — sheets 없는 옛 지도는 v1.25.1 황금본과 글자까지 같다 · 장 고르기 · 지금 여기(종류 먼저) · 발자취 · 구경은 상태를 안 바꾼다 · 가림 · 띠 · 문
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const MAP = SC.require('map');
const engine = SC.require('engine');
const { validateSchema } = SC.require('validate');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const J = (x) => JSON.stringify(x);
const noThrow = (fn) => { try { fn(); return null; } catch (e) { return e; } };

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
/** 장 둘 — 첫 장(교토) + 안개 낀 지하 수로. 어소 핀과 '에도' 이정표에 수로로 가는 문 */
const TWO = (() => {
  const s = clone(BASE);
  s.vars[0].enum.push('수문', '망루 밑');
  s.map.places[0].to = 'under';
  s.map.exits[0].to = 'under';
  s.map.sheets = [{
    id: 'under', label: '지하 수로', fog: true, bg: '수로도', ratio: 0.8, note: '물소리가 난다',
    zones: [{ label: '북쪽 수로', x: 5, y: 5, w: 40, h: 40 }],
    places: [{ name: '수문', x: 20, y: 20, desc: '녹슨 문' }, { name: '망루 밑', x: 60, y: 60, known: true }],
    exits: [{ label: '지상으로', dir: 'n', to: 'main' }],
  }];
  return s;
})();
const st = (schema, vars = {}) => { const s = engine.initState(schema); Object.assign(s.vars, vars); return s; };
const view = (schema, vars, opts) => MAP.mapView(schema, st(schema, vars), engine.makeLookup, opts);

(async () => {
  console.log('── ① 코어 — 장 · 지금 여기 · 구경 · 가림 · 띠 · 문');
  {
    const G = JSON.parse(fs.readFileSync(__P('fixtures/map-golden-v1.25.1.json'), 'utf8'));
    for (const c of G.cases) {
      const v = MAP.mapView(c.schema, c.state, c.engine ? engine.makeLookup : undefined);
      const now = clone(v);
      const diff = Object.keys(c.view).filter((k) => J(now[k]) !== J(c.view[k]));
      ck(`★ 황금본 — 옛 재료가 글자까지 같다 (${c.name})`, diff.length === 0, diff.join(','));
      const bad = [];
      for (const k of Object.keys(c.html)) {
        const html = k === 'cat' ? MAP.renderMapHtml(v, { cat: v.cats[0] ? v.cats[0].label : null, sel: null }, { bgUrl: 'blob:x' })
          : MAP.renderMapHtml(v, { sel: k === '-' ? null : k }, {});
        if (html !== c.html[k]) bad.push(k);
      }
      ck(`★ 황금본 — 그림 HTML이 글자까지 같다 (${c.name})`, bad.length === 0, bad.join(','));
      ck(`황금본 — 장 하나짜리는 multi 아님·띠 없음·main (${c.name})`, v.multi === false && J(v.strip) === '[]' && v.sheet === 'main' && v.veiled === false && v.peek === false, J([v.multi, v.strip, v.sheet]));
    }

    ck('sheetsOf — 첫 장 + 더한 장', (() => { const a = MAP.sheetsOf(TWO.map); return a.length === 2 && a[0].id === 'main' && a[0].main === true && a[0].label === '교토 전도' && a[0].fog === false
      && a[1].id === 'under' && a[1].label === '지하 수로' && a[1].fog === true && a[1].bg === '수로도' && a[1].ratio === 0.8; })(), J(MAP.sheetsOf(TWO.map).map((x) => [x.id, x.fog])));
    ck('sheetsOf — 장의 안개는 없으면 지도 설정을 따른다', (() => { const s = clone(TWO); s.map.fog = true; delete s.map.sheets[0].fog; const a = MAP.sheetsOf(s.map); return a[0].fog === true && a[1].fog === true; })(), '');

    let v = view(TWO, {});
    ck('처음(어소) — 첫 장이 뜨고 띠에 안 가 본 안개 장은 없다', v.sheet === 'main' && v.multi === true && v.hereSheet === 'main' && v.hereOn === true && v.peek === false
      && J(v.strip.map((x) => x.id)) === '["main"]' && v.strip[0].here === true && v.strip[0].on === true, J(v.strip));
    ck('문 — 장소·이정표의 to = { id, label }', J(v.places[0].to) === J({ id: 'under', label: '지하 수로' }) && J(v.exits.find((e) => e.label === '에도').to) === J({ id: 'under', label: '지하 수로' })
      && v.places[1].to === undefined && v.exits.find((e) => e.label === '구라마').to === undefined, J([v.places[0].to, v.exits.map((e) => e.to)]));
    ck('문 — 없는 장·자기 장을 가리키면 문이 아니다', (() => { const s = clone(TWO); s.map.places[0].to = 'nope'; s.map.places[1].to = 'main'; s.map.places[2].to = 5; const w = view(s, {});
      return w.places[0].to === undefined && w.places[1].to === undefined && w.places[2].to === undefined; })(), '');

    v = view(TWO, { location: '수문' });
    ck('★ 위치가 둘째 장의 장소 → 그 장이 뜬다', v.sheet === 'under' && v.hereSheet === 'under' && v.hereOn === true && v.label === '지하 수로' && v.ratio === 0.8 && v.note === '물소리가 난다'
      && v.places.find((p) => p.name === '수문').here === true && v.here.kind === 'place' && v.here.name === '수문', J([v.sheet, v.here]));
    ck('둘째 장 — 띠에 두 장, 지금 여기는 수로', J(v.strip.map((x) => [x.id, x.here, x.on])) === J([['main', false, false], ['under', true, true]]), J(v.strip));
    ck('둘째 장의 문 — 지상으로 = 첫 장', J(v.exits[0].to) === J({ id: 'main', label: '교토 전도' }), J(v.exits[0]));
    {
      const s2 = st(TWO, { location: '수문' });
      const got = MAP.recordVisit(TWO, s2, engine.makeLookup);
      ck('★ recordVisit — 둘째 장의 장소 이름이 발자취에', got === '수문' && J(s2.vars.visited) === '["수문"]', J([got, s2.vars.visited]));
    }

    {
      const s2 = st(TWO, {}); const before = J(s2);
      const p = MAP.mapView(TWO, s2, engine.makeLookup, { sheet: 'under' });
      ck('★ 구경 — 상태가 그대로다', J(s2) === before, '');
      ck('구경 — 보는 장은 수로, 지금 여기는 첫 장', p.sheet === 'under' && p.hereSheet === 'main' && p.hereOn === false && p.peek === true && p.here && p.here.name === '어소'
        && !p.places.some((x) => x.here) && !p.zones.some((x) => x.here), J([p.sheet, p.hereSheet, p.peek]));
      ck('★ 구경 — 안개 낀 장에서 안 가 본 곳은 숨고, 아는 곳만', p.places.find((x) => x.name === '수문').state === 'hidden' && p.places.find((x) => x.name === '망루 밑').state === 'known'
        && !p.zones[0].open, J(p.places.map((x) => [x.name, x.state])));
      ck('구경 — 띠에 구경 중인 장이 뜬다', J(p.strip.map((x) => [x.id, x.here, x.on])) === J([['main', true, false], ['under', false, true]]), J(p.strip));
      ck('★ 가림 — 발 안 디딘 안개 장은 그림을 안 준다', p.veiled === true && p.bg === null, J([p.veiled, p.bg]));
      const q = view(TWO, {}, { sheet: 'nope' });
      ck('없는 장을 구경하려 하면 지금 여기의 장', q.sheet === 'main' && q.peek === false, q.sheet);
      const same = view(TWO, {}, { sheet: 'main' });
      ck('지금 여기의 장을 고른 것은 구경이 아니다', same.sheet === 'main' && same.peek === false && same.hereOn === true, J([same.peek, same.hereOn]));
    }
    v = view(TWO, { visited: ['수문'] }, { sheet: 'under' });
    ck('가림 — 한 번 발 디디면 그림이 깔린다', v.veiled === false && v.bg === '수로도' && J(v.strip.map((x) => x.id)) === '["main","under"]', J([v.veiled, v.bg, v.strip]));
    ck('가림 — bgAlways면 처음부터', (() => { const s = clone(TWO); s.map.sheets[0].bgAlways = true; const w = view(s, {}, { sheet: 'under' }); return w.veiled === false && w.bg === '수로도'; })(), '');
    ck('가림 — 안개 걷은 모습(reveal)엔 늘 그림', (() => { const w = view(TWO, {}, { sheet: 'under', reveal: true }); return w.veiled === false && w.bg === '수로도' && w.strip.length === 2; })(), '');
    ck('가림 — 안개 없는 더한 장은 안 가린다 · 띠에도 처음부터', (() => { const s = clone(TWO); s.map.sheets[0].fog = false; const w = view(s, {}); const p = view(s, {}, { sheet: 'under' });
      return w.strip.length === 2 && p.veiled === false && p.bg === '수로도'; })(), '');
    ck('★ 첫 장은 안개여도 가리지 않는다', (() => { const s = clone(TWO); s.map.fog = true; s.map.bg = '교토도'; const w = view(s, { location: '수문', visited: ['수문'] }, { sheet: 'main' });
      return w.sheet === 'main' && w.veiled === false && w.bg === '교토도'; })(), '');

    v = view(TWO, { finds: ['뒷문 (북쪽 수로)', '폐사 (가모가와 동안)'] });
    ck('찾아낸 곳 — 구역이 있는 장에 꽂힌다', v.pins.length === 1 && v.pins[0].name === '폐사' && v.stray.length === 0, J(v.pins.map((p) => p.name)));
    v = view(TWO, { finds: ['뒷문 (북쪽 수로)', '폐사 (가모가와 동안)'] }, { sheet: 'under' });
    ck('찾아낸 곳 — 둘째 장의 핀 · 핀이 꽂힌 장은 발 디딘 장', v.pins.length === 1 && v.pins[0].name === '뒷문' && v.veiled === false && v.zones[0].open === true, J([v.pins.map((p) => p.name), v.veiled]));
    v = view(TWO, { finds: ['어딘가'] }, { sheet: 'under' });
    ck('자리를 못 찾은 곳은 어느 장을 보든 아래에', v.stray.length === 1 && v.stray[0].name === '어딘가', J(v.stray));

    v = view(TWO, { finds: ['수문 (가모가와 동안)'], location: '수문' });
    ck('★ 찾아낸 곳 이름 = 다른 장의 장소 이름 → 장소가 이긴다', v.here && v.here.kind === 'place' && v.sheet === 'under', J([v.here, v.sheet]));
    {
      const s2 = st(TWO, { finds: ['수문 (가모가와 동안)'], location: '수문' });
      ck('★ 그때도 발자취가 적힌다', MAP.recordVisit(TWO, s2, engine.makeLookup) === '수문', J(s2.vars.visited));
    }
    v = view(TWO, { location: '북쪽 수로' });
    ck('둘째 장의 구역이 지금 여기', v.sheet === 'under' && v.here.kind === 'zone' && v.zones[0].here === true, J([v.sheet, v.here]));

    {
      const s = clone(TWO);
      s.map.sheets = [null, {}, { id: 'main', label: 'x' }, { id: 'a b' }, 7, { id: 'under', label: '수로', places: [null, 5, { name: '수문', x: 1, y: 1, to: 9 }], zones: 'x', exits: [{ label: '위', dir: 'n', to: {} }] }, { id: 'under', label: '겹침' }];
      let w = null;
      const e = noThrow(() => { w = view(s, { location: '수문' }); MAP.renderMapHtml(w, {}, {}); MAP.recordVisit(s, st(s, { location: '수문' }), engine.makeLookup); view(s, {}, { sheet: 'under' }); });
      ck('★ 깨진 sheets에 던지지 않는다 — 쓸 수 있는 장만 (첫 장 + under 하나)', !e && MAP.sheetsOf(s.map).length === 2 && w.sheet === 'under' && w.label === '수로', e ? e.stack : J(MAP.sheetsOf(s.map).map((x) => x.id)));
      const many = clone(BASE); many.map.sheets = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, label: `장 ${i}` }));
      ck('장은 첫 장 포함 12장까지', MAP.sheetsOf(many.map).length === 12, String(MAP.sheetsOf(many.map).length));
      const ns = clone(BASE); ns.map.sheets = 'x';
      ck('sheets가 배열이 아니어도 첫 장은 돈다', !noThrow(() => view(ns, {})) && view(ns, {}).multi === false, '');
    }
  }

  console.log('── ② 검증 — 장');
  {
    const iss = (patch, base = TWO) => { const s = clone(base); patch(s.map, s); return validateSchema(s); };
    const has = (r, path, word, kind) => (kind === 'err' ? r.errors : kind === 'warn' ? r.warnings : [...r.errors, ...r.warnings]).some((e) => e.path.startsWith(path) && e.msg.includes(word));
    const mapOnly = (r) => ({ errors: r.errors.filter((e) => String(e.path).startsWith('$.map')).map((e) => ({ path: e.path, msg: e.msg })),
      warnings: r.warnings.filter((e) => String(e.path).startsWith('$.map')).map((e) => ({ path: e.path, msg: e.msg })) });
    const ok = mapOnly(validateSchema(clone(TWO)));
    ck('장 둘 예시 — 지도 오류 0 · 경고 0', ok.errors.length === 0 && ok.warnings.length === 0, J(ok));
    const G = JSON.parse(fs.readFileSync(__P('fixtures/map-golden-v1.25.1.json'), 'utf8'));
    for (const c of G.cases.filter((x) => x.issues)) ck(`★ 황금본 — 검증 결과가 그대로 (${c.name})`, J(mapOnly(validateSchema(clone(c.schema)))) === J(c.issues), J(mapOnly(validateSchema(clone(c.schema)))));

    ck('sheets는 배열', has(iss((m) => { m.sheets = {}; }), '$.map.sheets', '배열', 'err'), '');
    ck('장은 객체', has(iss((m) => { m.sheets[0] = 5; }), '$.map.sheets[0]', '객체', 'err'), '');
    ck('장 id 없음', has(iss((m) => { delete m.sheets[0].id; m.places[0].to = undefined; m.exits[0].to = undefined; }), '$.map.sheets[0].id', '장 id', 'err'), '');
    ck('장 id 형식', has(iss((m) => { m.sheets[0].id = 'a b'; }), '$.map.sheets[0].id', '장 id', 'err'), '');
    ck('장 id main은 못 쓴다', has(iss((m) => { m.sheets[0].id = 'main'; }), '$.map.sheets[0].id', 'main', 'err'), '');
    ck('장 id 중복', has(iss((m) => { m.sheets.push({ id: 'under', label: '또' }); }), '$.map.sheets[1].id', '중복', 'err'), '');
    ck('장은 12장까지', has(iss((m) => { for (let i = 0; i < 11; i++) m.sheets.push({ id: `s${i}`, label: `장${i}`, fog: false }); }), '$.map.sheets', '12', 'err'), '');
    ck('11장 더한 것(합 12)은 통과', !has(iss((m) => { for (let i = 0; i < 10; i++) m.sheets.push({ id: `s${i}`, label: `장${i}`, fog: false }); }), '$.map.sheets', '12', 'err'), '');
    ck('★ 문이 없는 장을 가리킴', has(iss((m) => { m.places[1].to = 'nope'; }), '$.map.places[1].to', '없는 지도', 'err'), '');
    ck('문이 글자가 아님', has(iss((m) => { m.places[1].to = 5; }), '$.map.places[1].to', '장 id', 'err'), '');
    ck('★ 문이 자기 장을 가리킴 (더한 장 · 첫 장)', has(iss((m) => { m.sheets[0].exits[0].to = 'under'; }), '$.map.sheets[0].exits[0].to', '자기', 'err')
      && has(iss((m) => { m.places[1].to = 'main'; }), '$.map.places[1].to', '자기', 'err'), '');
    ck('★ 장을 넘어 이름이 겹침', has(iss((m) => { m.sheets[0].places[0].name = '어소'; }), '$.map.sheets[0].places[0]', '겹칩니다', 'err')
      && has(iss((m) => { m.sheets[0].zones[0].match = ['들판']; }), '$.map.sheets[0].zones[0]', '겹칩니다', 'err'), '');
    ck('장의 fog·bgAlways · 지도의 addPlace는 true/false', has(iss((m) => { m.sheets[0].fog = 'yes'; }), '$.map.sheets[0].fog', 'true/false', 'err')
      && has(iss((m) => { m.sheets[0].bgAlways = 1; }), '$.map.sheets[0].bgAlways', 'true/false', 'err') && has(iss((m) => { m.addPlace = 'on'; }), '$.map.addPlace', 'true/false', 'err'), '');
    ck('장의 이름·배경·비율', has(iss((m) => { m.sheets[0].bg = 5; }), '$.map.sheets[0].bg', '문자열', 'err') && has(iss((m) => { m.sheets[0].label = 5; }), '$.map.sheets[0].label', '문자열', 'err')
      && has(iss((m) => { m.sheets[0].ratio = 9; }), '$.map.sheets[0].ratio', '0.4~2.5', 'err'), '');
    ck('장 안의 좌표·방향·식·분류는 첫 장과 같은 검사 (경로만 장)', has(iss((m) => { m.sheets[0].places[0].x = 140; }), '$.map.sheets[0].places[0].x', '0~100', 'err')
      && has(iss((m) => { m.sheets[0].exits[0].dir = 'up'; }), '$.map.sheets[0].exits[0].dir', 'n·ne', 'err')
      && has(iss((m) => { m.sheets[0].places[0].known = 'has(nope, "x")'; }), '$.map.sheets[0].places[0].known', "알 수 없는 변수 'nope'", 'err')
      && has(iss((m) => { m.sheets[0].places[0].cat = '종교'; }), '$.map.sheets[0].places[0].cat', 'categories에 없습니다', 'warn')
      && has(iss((m) => { m.sheets[0].zones = 'x'; }), '$.map.sheets[0].zones', '배열', 'err'), '');

    ck('★ 발자취 크기 경고는 전 장 합계로 (첫 장 5 + 수로 3 = 8)', has(iss((m, s) => { s.vars[1].maxItems = 6; }), '$.map.seenVar', '장소+구역 수(8)', 'warn')
      && !has(iss((m, s) => { s.vars[1].maxItems = 6; }, BASE), '$.map.seenVar', 'maxItems'), '');
    ck('★ 안개 낀 장 — 위치 선택지에 없고 known도 없는 장소', has(iss((m, s) => { s.vars[0].enum = s.vars[0].enum.filter((x) => x !== '수문'); }), '$.map.sheets[0].places', '안개 속', 'warn'), '');
    ck('안개 없는 장이면 그 경고 없음', !has(iss((m, s) => { s.vars[0].enum = s.vars[0].enum.filter((x) => x !== '수문'); m.sheets[0].fog = false; }), '$.map.sheets[0].places', '안개 속'), '');
    const lost = (m) => { m.sheets.push({ id: 'lost', label: '잃어버린 곳', fog: true, places: [{ name: '섬', x: 10, y: 10, known: true }] }); };
    ck('★ 아무도 못 보는 장 (문도 없고 위치 선택지에도 없는 안개 장)', has(iss(lost), '$.map.sheets[1]', '아무도', 'warn'), '');
    ck('문이 있으면 그 경고 없음', !has(iss((m) => { lost(m); m.places[2].to = 'lost'; }), '$.map.sheets[1]', '아무도'), '');
    ck('위치 선택지에 있으면 없음', !has(iss((m, s) => { lost(m); s.vars[0].enum.push('섬'); }), '$.map.sheets[1]', '아무도'), '');
    ck('안개 없는 장이면 없음 (띠에 뜬다)', !has(iss((m) => { lost(m); m.sheets[1].fog = false; }), '$.map.sheets[1]', '아무도'), '');
    ck('찾아낸 곳 목록 없이 장소 적기를 켬', has(iss((m) => { m.addPlace = true; delete m.listVar; }), '$.map.addPlace', '찾아낸 곳', 'warn') && !has(iss((m) => { m.addPlace = true; }), '$.map.addPlace', '찾아낸 곳'), '');
    ck('찾아낸 곳인데 구역 없음 경고는 전 장 기준', !has(iss((m) => { delete m.zones; }), '$.map.listVar', '구역') && has(iss((m) => { delete m.zones; delete m.sheets[0].zones; }), '$.map.listVar', '구역', 'warn'), '');
  }

  console.log('── ③ 그리기 — 띠 · 문 · 가림');
  {
    const html = (schema, vars, opts, ui = {}, ropts = {}) => MAP.renderMapHtml(view(schema, vars, opts), ui, ropts);
    let h = html(TWO, {});
    ck('띠 — 장 이름 단추 (안 가 본 안개 장은 없다 · 구경 중이 아니면 돌아가기 없음)', h.includes('class="scm-sheets"') && /<button type="button" class="scm-sbtn scm-on" data-scm-sheet="main">📍 교토 전도<\/button>/.test(h)
      && !h.includes('data-scm-sheet="under"') && !h.includes('scm-back'), h.slice(0, 400));
    ck('★ 문 달린 이정표는 단추, 문 없는 이정표는 글자 그대로', /<button type="button" class="scm-exit scm-door scm-edge-right" data-scm-go="under" style="top:[\d.]+%">→ 에도<\/button>/.test(h)
      && /<span class="scm-exit scm-edge-right" style="top:[\d.]+%">→ 도카이도<\/span>/.test(h), (h.match(/<[a-z]+[^>]*scm-exit[^>]*>[^<]*<\/[a-z]+>/g) || []).join('\n'));
    h = html(TWO, { location: '수문' });
    ck('띠 — 지금 여기의 장에 📍·켜짐', /<button type="button" class="scm-sbtn scm-on" data-scm-sheet="under">📍 지하 수로<\/button>/.test(h) && /<button type="button" class="scm-sbtn" data-scm-sheet="main">교토 전도<\/button>/.test(h), h.slice(0, 400));
    h = html(TWO, {}, { sheet: 'under' }, {}, { bgUrl: 'blob:x' });
    ck('구경 중 — [📍 내 위치로]', /<button type="button" class="scm-sbtn scm-back" data-scm-sheet="">📍 내 위치로<\/button>/.test(h), h.slice(0, 500));
    ck('★ 가림 — 문구가 뜨고 그림은 안 깐다 (그림 주소를 받아도)', h.includes('<div class="scm-veil">아직 가 보지 않은 곳이에요</div>') && !h.includes('scm-bg'), '');
    ck('★ 구경 — 안 가 본 곳은 그림에도 없다', !h.includes('수문') && h.includes('망루 밑'), '');
    ck('구경 중 아래 줄 — 지금 여기의 장 이름 ("지도 밖"이 아니다)', h.includes('📍 <b>어소</b> <span class="scm-off">(교토 전도)</span>') && !h.includes('지도 밖'), (h.match(/<div class="scm-hereline">.*?<\/div>/) || [''])[0]);
    h = html(TWO, { visited: ['수문'] }, { sheet: 'under' }, {}, { bgUrl: 'blob:x' });
    ck('발 디딘 장은 그림이 깔리고 가림 문구가 없다', h.includes('class="scm-bg"') && !h.includes('scm-veil'), '');
    h = html(TWO, { location: '에도' });
    ck('어느 장에도 없는 위치는 지금처럼 (지도 밖)', h.includes('<span class="scm-off">(지도 밖)</span>'), (h.match(/<div class="scm-hereline">.*?<\/div>/) || [''])[0]);
    h = html(TWO, {}, undefined, { sel: 'p0' });
    ck('★ 문 달린 장소 — 카드에 [지도 펼치기]', h.includes('<button type="button" class="scm-dt-go" data-scm-go="under">🗺 지하 수로 지도 펼치기</button>') && h.includes('천황의 거처'), (h.match(/<div class="scm-detail">.*$/) || [''])[0].slice(0, 400));
    ck('문 없는 장소 카드엔 단추 없음', !html(TWO, {}, undefined, { sel: 'p2' }).includes('scm-dt-go'), '');
    const d0 = MAP.detailOf(view(TWO, {}), 'p0');
    ck('detailOf — go', J(d0.go) === J({ id: 'under', label: '지하 수로' }) && MAP.detailOf(view(TWO, {}), 'p2').go == null, J(d0.go));
    const dp = MAP.detailOf(view(TWO, { finds: ['폐사 (가모가와 동안)'] }), 'd0');
    ck('detailOf — 찾아낸 곳은 own·raw', dp.own === true && dp.raw === '폐사 (가모가와 동안)' && !MAP.detailOf(view(TWO, {}), 'p0').own, J(dp));
    {
      const s = clone(TWO); s.map.sheets[0].label = '<script>alert(1)</script>'; s.map.sheets[0].fog = false; s.map.exits[0].label = '<img src=x>';
      const x = html(s, {}, undefined, { sel: 'p0' });
      ck('★ 장 이름·문 이름표는 이스케이프', !x.includes('<script>') && !x.includes('<img src=x>') && x.includes('&lt;script&gt;alert(1)&lt;/script&gt; 지도 펼치기') && x.includes('&lt;img src=x&gt;'), '');
    }
    ck('MAP_CSS — 띠·문·가림·카드 단추 모양', ['.scm-sheets', '.scm-sbtn', '.scm-back', '.scm-exit.scm-door', '.scm-veil', '.scm-dt-go'].every((c) => MAP.MAP_CSS.includes(c)), '');
    ck('문 단추는 눌린다 (이정표 기본은 pointer-events:none)', /\.scm-exit\.scm-door\{[^}]*pointer-events:auto/.test(MAP.MAP_CSS), '');
  }

  console.log('── ④ 패널 — 문 · 따라가기 (renderMapPanel 구간을 소스에서 떼어 가짜 DOM으로, 규칙 #8)');
  const panelRig = (schema0, vars0 = {}) => {
    const a = src.indexOf('  function renderMapPanel(root) {');
    const b = src.indexOf('\n  }\n', a) + 4;
    const mk = (tag) => {
      const el = { tag, children: [], listeners: {}, className: '', _html: '', isConnected: true, textContent: '',
        addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
        appendChild(c) { el.children.push(c); return c; }, append(...c) { el.children.push(...c); },
        insertBefore(c) { el.children.unshift(c); return c; }, querySelector: (sel) => (sel === '.scm-surface' ? (el._surf = el._surf || mk('surf')) : null) };
      Object.defineProperty(el, 'innerHTML', { get: () => el._html, set(v) { el._html = String(v); el.children = []; } });
      return el;
    };
    const root = mk('root');
    const session = { current: st(schema0, vars0) };
    const asked = [];
    const commits = [];
    const cache = new Map();   // 진짜 resolvePortraitUrl처럼 읽은 그림을 캐시에 넣는다
    const rig = { root, session, asked, commits, turnBusy: false, notice: null };
    const names = ['document', 'mapMod', 'engine', 'schema', 'session', 'mapUi', 'closeGamePanel', 'currentChaId', 'portraitCache', 'resolvePortraitUrl', 'renderGamePanel', 'gameNotice',
      'commitPanelChanges', 'turnBusyNow', 'TURN_BUSY_MSG'];
    const api = new Function(...names, src.slice(a, b)
      + '\nreturn { renderMapPanel, ui: () => mapUi, setUi: (v) => { mapUi = v; }, setSchema: (v) => { schema = v; }, notice: () => gameNotice, setNotice: (v) => { gameNotice = v; } };')(
      { createElement: mk }, MAP, engine, clone(schema0), session, { cat: null, sel: null, sheet: null }, () => {}, 'c1', cache,
      (name) => { asked.push(name); cache.set('c1:' + name, 'blob:' + name); return Promise.resolve('blob:' + name); }, () => api.renderMapPanel(root), null,
      async (changes, what) => { commits.push({ changes: clone(changes), what }); Object.assign(session.current.vars, changes); api.renderMapPanel(root); }, () => rig.turnBusy, '턴 진행 중');
    rig.api = api;
    rig.render = () => api.renderMapPanel(root);
    rig.body = () => root.children[0].children.find((c) => c.listeners.click && String(c._html).includes('class="scm'));
    rig.html = () => rig.body()._html;
    rig.click = async (attrs, extra = {}) => {
      const t = { hasAttribute: (k) => k in attrs, getAttribute: (k) => (k in attrs ? attrs[k] : null), ...extra };
      const body = rig.body();
      for (const fn of body.listeners.click) await fn({ target: { closest: () => t } });
    };
    return rig;
  };
  {
    ck('패널 구간을 소스에서 찾음', src.indexOf('  function renderMapPanel(root) {') > 0, '');
    const withBg = clone(TWO); withBg.map.bg = '교토도';
    const R = panelRig(withBg);
    R.render();
    ck('패널 — 처음엔 지금 여기의 장 (첫 장) · 그 장의 그림을 읽는다', R.html().includes('data-scm-sheet="main"') && R.html().includes('data-scm-go="under"') && J(R.asked) === '["교토도"]', J(R.asked));
    await R.click({ 'data-scm': 'p0' });
    ck('패널 — 장소를 고르면 카드', R.api.ui().sel === 'p0' && R.html().includes('scm-dt-go'), J(R.api.ui()));
    const before = J(R.session.current);
    await R.click({ 'data-scm-go': 'under' });
    ck('★ 문을 누르면 그 장이 그려진다 (고른 것은 놓는다)', R.api.ui().sheet === 'under' && R.api.ui().sel === null && R.html().includes('scm-veil') && R.html().includes('scm-back')
      && /class="scm-sbtn scm-on" data-scm-sheet="under"/.test(R.html()), J(R.api.ui()));
    ck('★ 문을 눌러도 상태는 그대로', J(R.session.current) === before, '');
    ck('★ 가려진 장의 그림은 읽지도 않는다', J(R.asked) === '["교토도"]', J(R.asked));
    R.session.current.vars.location = '기온'; R.render();
    ck('★ 구경 중 위치가 바뀌어도(같은 장 안) 보던 장에 머문다', R.api.ui().sheet === 'under' && /class="scm-sbtn scm-on" data-scm-sheet="under"/.test(R.html()), J(R.api.ui()));
    await R.click({ 'data-scm-sheet': '' });
    ck('[📍 내 위치로] → 따라가기', R.api.ui().sheet === null && /class="scm-sbtn scm-on" data-scm-sheet="main"/.test(R.html()) && !R.html().includes('scm-back'), J(R.api.ui()));
    await R.click({ 'data-scm-go': 'under' });
    R.session.current.vars.location = '수문'; R.session.current.vars.visited = ['수문']; R.render();
    ck('보던 장이 지금 여기의 장이 되면 구경이 끝난다 (따라가기로)', R.api.ui().sheet === null && R.html().includes('data-scm-sheet="under">📍 지하 수로') && !R.html().includes('scm-back'), J(R.api.ui()));
    ck('발 디딘 장은 그림을 읽는다', J(R.asked) === '["교토도","수로도"]', J(R.asked));
    await R.click({ 'data-scm': 'p0' });
    R.session.current.vars.location = '어소'; R.render();
    ck('★ 따라가다 장이 바뀌면 고른 것을 놓는다 (다른 장의 같은 열쇠가 열리지 않게)', R.api.ui().sel === null && /class="scm-sbtn scm-on" data-scm-sheet="main"/.test(R.html()), J(R.api.ui()));
    await R.click({ 'data-scm-sheet': 'under' });
    ck('띠의 장 이름을 눌러도 구경', R.api.ui().sheet === 'under', J(R.api.ui()));
    R.api.setSchema(clone(BASE));
    const e = noThrow(() => R.render());
    ck('★ 보던 장이 스키마에서 사라지면 던지지 않고 따라가기로', !e && R.api.ui().sheet === null && !R.html().includes('scm-sheets'), e ? e.stack : J(R.api.ui()));
    await R.click({ 'data-scm-cat': '유흥' });
    ck('분류 단추는 그대로', R.api.ui().cat === '유흥', J(R.api.ui()));
    ck('어댑터 — 열 때 장 고르기도 초기화 · 위임 선택자', src.includes("mapUi = { cat: null, sel: null, sheet: null };") && src.includes("closest('[data-scm-act],[data-scm-go],[data-scm-sheet],[data-scm-cat],[data-scm]')"), '');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => { console.log('FAIL 테스트 본문이 던짐 →', e && e.stack || e); console.log('\n0 passed, 1 failed'); process.exit(1); });
