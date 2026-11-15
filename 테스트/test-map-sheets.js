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
    ck('찾아낸 곳 — 둘째 장의 핀 · 핀이 꽂힌 장은 띠에 뜨고 구역이 걷힌다 (그림 가림은 발자취·지금 여기만 푼다)', v.pins.length === 1 && v.pins[0].name === '뒷문' && v.veiled === true && v.zones[0].open === true && v.strip.some((x) => x.id === 'under'), J([v.pins.map((p) => p.name), v.veiled]));
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
      'commitPanelChanges', 'turnBusy', 'TURN_BUSY_MSG'];
    const api = new Function(...names, src.slice(a, b)
      + '\nreturn { renderMapPanel, ui: () => mapUi, setUi: (v) => { mapUi = v; }, setSchema: (v) => { schema = v; }, notice: () => gameNotice, setNotice: (v) => { gameNotice = v; }, setBusy: (v) => { turnBusy = v; } };')(
      { createElement: mk }, MAP, engine, clone(schema0), session, { cat: null, sel: null, sheet: null }, () => {}, 'c1', cache,
      (name) => { asked.push(name); cache.set('c1:' + name, 'blob:' + name); return Promise.resolve('blob:' + name); }, () => api.renderMapPanel(root), null,
      async (changes, what) => { commits.push({ changes: clone(changes), what }); Object.assign(session.current.vars, changes); api.renderMapPanel(root); }, false, '턴 진행 중');
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

  console.log('── ⑤ [＋ 장소] — 플레이 중에 적어 넣기');
  {
    const ADD = clone(TWO); ADD.map.addPlace = true;
    const html = (schema, vars, opts, ui = {}) => MAP.renderMapHtml(view(schema, vars, opts), ui, {});
    ck('기본은 꺼짐 — 찾아낸 곳 목록이 있어도 단추가 하나도 없다', view(TWO, {}).canAdd === false && !html(TWO, { finds: ['폐사 (가모가와 동안)'] }, undefined, { sel: 'd0' }).includes('data-scm-act'), '');
    ck('켜면 [＋ 장소 적기] · 적을 수 있는 구역 = 보고 있는 장의 걷힌 구역', view(ADD, {}).canAdd === true && J(view(ADD, {}).addZones) === J(['가모가와 동안', '서쪽 들판'])
      && html(ADD, {}).includes('<button type="button" class="scm-abtn" data-scm-act="add-open">＋ 장소 적기</button>'), J(view(ADD, {}).addZones));
    ck('목록 변수가 없으면 켜도 안 생긴다', (() => { const s = clone(ADD); delete s.map.listVar; return view(s, {}).canAdd === false; })(), '');
    ck('안개에 가린 구역은 고를 수 없다', J(view(ADD, {}, { sheet: 'under' }).addZones) === '[]' && J(view(ADD, { visited: ['북쪽 수로'] }, { sheet: 'under' }).addZones) === J(['북쪽 수로']), '');

    const s0 = st(ADD, {}); const before = J(s0);
    const r = MAP.addFind(ADD, s0, engine.makeLookup, { name: '  새   굴 ', zone: '가모가와 동안', sheet: 'main' });
    ck('★ 적기 — "이름 (구역)"이 목록 끝에, 상태는 그대로 (적는 건 부르는 쪽)', r.ok === true && r.listId === 'finds' && r.item === '새 굴 (가모가와 동안)' && J(r.next) === J(['새 굴 (가모가와 동안)']) && J(s0) === before, J(r));
    const no = (schema, vars, arg) => { const x = MAP.addFind(schema, st(schema, vars), engine.makeLookup, { zone: '가모가와 동안', sheet: 'main', ...arg }); return x.ok ? '(통과)' : x.reason; };
    ck('거절 — 빈 이름', no(ADD, {}, { name: '   ' }) === '이름을 적어 주세요', no(ADD, {}, { name: '   ' }));
    ck('거절 — 쉼표 (채팅 변수 미러가 목록을 쉼표로 잇는다 — 되읽으면 둘로 갈린다)', no(ADD, {}, { name: '굴, 뒷문' }) === '이름에 괄호·@·쉼표는 쓸 수 없어요', no(ADD, {}, { name: '굴, 뒷문' }));
    ck('거절 — 괄호·@', no(ADD, {}, { name: '굴(북)' }) === '이름에 괄호·@·쉼표는 쓸 수 없어요' && no(ADD, {}, { name: '굴@3' }) === '이름에 괄호·@·쉼표는 쓸 수 없어요', no(ADD, {}, { name: '굴(북)' }));
    ck('★ 거절 — 이미 있는 이름 (장소·별칭·구역·다른 이름·다른 장의 장소·찾아낸 곳)', ['기온', '島原', '서쪽 들판', '들판', '수문', '폐사'].every((n) => no(ADD, { finds: ['폐사 (서쪽 들판)'] }, { name: n }) === `'${n}'은(는) 이미 지도에 있는 이름이에요`),
      ['기온', '島原', '서쪽 들판', '들판', '수문', '폐사'].map((n) => no(ADD, { finds: ['폐사 (서쪽 들판)'] }, { name: n })).join(' / '));
    ck('거절 — 구역을 안 골랐거나 걷힌 구역이 아니다', no(ADD, {}, { name: '굴', zone: '' }) === '적어 넣을 구역을 골라 주세요' && no(ADD, {}, { name: '굴', zone: '없는 곳' }) === '적어 넣을 구역을 골라 주세요'
      && no(ADD, {}, { name: '굴', zone: '북쪽 수로', sheet: 'under' }) === '적어 넣을 구역을 골라 주세요', no(ADD, {}, { name: '굴', zone: '북쪽 수로', sheet: 'under' }));
    ck('거절 — 목록이 꽉 참', (() => { const s = clone(ADD); s.vars[3].maxItems = 1; return no(s, { finds: ['폐사 (서쪽 들판)'] }, { name: '굴' }); })() === '목록이 꽉 찼어요 (1칸)', '');
    ck('거절 — 너무 긴 이름 (구역 이름까지 40자)', no(ADD, {}, { name: '가'.repeat(35) }) === '이름이 너무 길어요 (구역 이름까지 40자)' && no(ADD, {}, { name: '가'.repeat(20) }) === '(통과)', no(ADD, {}, { name: '가'.repeat(35) }));
    ck('거절 — 안 켠 지도', no(TWO, {}, { name: '굴' }) === '이 지도는 장소 적기를 쓰지 않아요', no(TWO, {}, { name: '굴' }));

    const rn = MAP.renameFind(ADD, st(ADD, { finds: ['가 (서쪽 들판)', '폐사 (가모가와 동안) @12'] }), engine.makeLookup, { raw: '폐사 (가모가와 동안) @12', name: '옛 절' });
    ck('★ 고치기 — 그 자리의 이름만, 꼬리표·기한은 남는다', rn.ok && rn.item === '옛 절 (가모가와 동안) @12' && J(rn.next) === J(['가 (서쪽 들판)', '옛 절 (가모가와 동안) @12']), J(rn));
    ck('고치기 — 겹치는 이름은 거절, 제 이름 그대로는 통과', MAP.renameFind(ADD, st(ADD, { finds: ['가 (서쪽 들판)', '나 (서쪽 들판)'] }), engine.makeLookup, { raw: '나 (서쪽 들판)', name: '가' }).reason === "'가'은(는) 이미 지도에 있는 이름이에요"
      && MAP.renameFind(ADD, st(ADD, { finds: ['가 (서쪽 들판)'] }), engine.makeLookup, { raw: '가 (서쪽 들판)', name: '가' }).ok === true, '');
    ck('고치기 — 목록에 없는 항목', /목록에 없어요/.test(MAP.renameFind(ADD, st(ADD, {}), engine.makeLookup, { raw: '없음 (서쪽 들판)', name: '가' }).reason || ''), '');
    const rm = MAP.removeFind(ADD, st(ADD, { finds: ['가 (서쪽 들판)', '가 (서쪽 들판)', '나 (서쪽 들판)'] }), { raw: '가 (서쪽 들판)' });
    ck('★ 지우기 — 같은 항목이 둘이어도 하나만', rm.ok && rm.listId === 'finds' && J(rm.next) === J(['가 (서쪽 들판)', '나 (서쪽 들판)']), J(rm));
    ck('지우기 — 안 켠 지도·없는 항목은 거절', MAP.removeFind(TWO, st(TWO, { finds: ['가 (서쪽 들판)'] }), { raw: '가 (서쪽 들판)' }).ok === false && MAP.removeFind(ADD, st(ADD, {}), { raw: 'x' }).ok === false, '');

    let h = html(ADD, {}, undefined, { form: { kind: 'add', name: '"><b>굴', zone: '서쪽 들판', error: '<i>오류</i>' } });
    ck('★ 적기 칸 — 이름·구역 고르기·적기·취소, 받은 글자는 이스케이프', h.includes('class="scm-in-name"') && h.includes('value="&quot;&gt;&lt;b&gt;굴"') && /<option value="서쪽 들판" selected>서쪽 들판<\/option>/.test(h)
      && h.includes('<option value="가모가와 동안">가모가와 동안</option>') && h.includes('data-scm-act="add-save"') && h.includes('data-scm-act="form-cancel"')
      && h.includes('&lt;i&gt;오류&lt;/i&gt;') && !h.includes('<i>오류</i>') && !h.includes('data-scm-act="add-open"'), (h.match(/<div class="scm-form">.*$/) || [''])[0].slice(0, 500));
    h = html(ADD, {}, { sheet: 'under' }, { form: { kind: 'add', name: '', zone: '', error: '' } });
    ck('적기 칸 — 걷힌 구역이 없으면 그렇다고 알린다', h.includes('아직 적어 넣을 수 있는 구역이 없어요') && !h.includes('data-scm-act="add-save"'), '');
    h = html(ADD, { finds: ['<img src=x> (가모가와 동안)'] }, undefined, { sel: 'd0' });
    ck('★ 찾아낸 곳 카드 — [이름 고치기]·[지우기], 이름은 이스케이프', h.includes('data-scm-act="rename-open"') && h.includes('data-scm-act="del"') && h.includes('>지우기<') && !h.includes('<img src=x>'), (h.match(/<div class="scm-detail">.*$/) || [''])[0].slice(0, 400));
    h = html(ADD, { finds: ['폐사 (가모가와 동안)'] }, undefined, { sel: 'd0', armDel: '폐사 (가모가와 동안)' });
    ck('지우기 무장 — 한 번 더 누르면 지워요', h.includes('한 번 더 누르면 지워요'), '');
    h = html(ADD, { finds: ['폐사 (가모가와 동안)'] }, undefined, { sel: 'd0', form: { kind: 'rename', raw: '폐사 (가모가와 동안)', name: '폐사', error: '' } });
    ck('고치기 칸 — 이름 칸과 [고치기]', h.includes('class="scm-in-name"') && h.includes('value="폐사"') && h.includes('data-scm-act="rename-save"') && !h.includes('scm-in-zone'), '');
    ck('★ 제작자의 장소 카드엔 고치기·지우기가 없다', !html(ADD, {}, undefined, { sel: 'p0' }).includes('rename-open') && !html(ADD, {}, undefined, { sel: 'p0' }).includes('data-scm-act="del"'), '');

    // 패널 — 달력 일정 등록과 같은 길(commitPanelChanges)
    const R = panelRig(ADD);
    R.render();
    const typeName = (v) => { for (const fn of (R.body().listeners.input || [])) fn({ target: { classList: { contains: (c) => c === 'scm-in-name' }, value: v } }); };
    await R.click({ 'data-scm-act': 'add-open' });
    ck('패널 — [＋ 장소 적기] → 칸이 열린다 (구역은 첫 걷힌 구역)', R.api.ui().form && R.api.ui().form.kind === 'add' && R.api.ui().form.zone === '가모가와 동안' && R.html().includes('scm-in-name'), J(R.api.ui().form));
    typeName('새 굴');
    ck('패널 — 치는 글자는 화면 상태에 남는다 (다시 그려도 안 날아간다)', R.api.ui().form.name === '새 굴' && (R.render(), R.html().includes('value="새 굴"')), J(R.api.ui().form));
    R.api.setBusy(true);
    await R.click({ 'data-scm-act': 'add-save' });
    ck('★ 턴이 도는 중이면 안 적고 알린다', R.commits.length === 0 && R.api.ui().form && R.api.ui().form.error === '턴 진행 중' && R.api.ui().form.name === '새 굴', J(R.api.ui().form));
    R.api.setBusy(false);
    await R.click({ 'data-scm-act': 'add-save' });
    ck('★ 적기 → 목록 변수에 한 줄, 칸이 닫힌다', R.commits.length === 1 && J(R.commits[0].changes) === J({ finds: ['새 굴 (가모가와 동안)'] }) && R.commits[0].what === '지도 장소 적기'
      && R.api.ui().form == null && R.html().includes('새 굴') && /적었어요/.test(R.api.notice() || ''), J([R.commits, R.api.ui().form]));
    await R.click({ 'data-scm-act': 'add-open' });
    typeName('기온');
    await R.click({ 'data-scm-act': 'add-save' });
    ck('거절은 칸 아래에 이유 (안 적는다)', R.commits.length === 1 && /이미 지도에 있는/.test(R.api.ui().form.error) && R.html().includes('이미 지도에 있는'), J(R.api.ui().form));
    await R.click({ 'data-scm-act': 'form-cancel' });
    ck('[취소] → 칸이 닫힌다', R.api.ui().form == null && R.html().includes('data-scm-act="add-open"'), '');
    await R.click({ 'data-scm': 'd0' });
    await R.click({ 'data-scm-act': 'rename-open' });
    ck('패널 — [이름 고치기] → 지금 이름이 든 칸', R.api.ui().form && R.api.ui().form.kind === 'rename' && R.api.ui().form.name === '새 굴' && R.api.ui().form.raw === '새 굴 (가모가와 동안)', J(R.api.ui().form));
    typeName('옛 굴');
    await R.click({ 'data-scm-act': 'rename-save' });
    ck('★ 고치기 → 그 줄만 바뀐다', R.commits.length === 2 && J(R.commits[1].changes) === J({ finds: ['옛 굴 (가모가와 동안)'] }) && R.commits[1].what === '지도 장소 이름 고치기', J(R.commits[1]));
    await R.click({ 'data-scm': 'd0' });
    await R.click({ 'data-scm-act': 'del' });
    ck('★ 지우기 한 번은 무장만 (리수 확인창을 안 쓴다 — 규칙 #6)', R.commits.length === 2 && R.html().includes('한 번 더 누르면 지워요'), '');
    R.api.setBusy(true);
    await R.click({ 'data-scm-act': 'del' });
    ck('턴이 도는 중이면 안 지운다', R.commits.length === 2 && R.api.notice() === '턴 진행 중', J(R.api.notice()));
    R.api.setBusy(false);
    await R.click({ 'data-scm-act': 'del' });
    ck('★ 한 번 더 → 지운다', R.commits.length === 3 && J(R.commits[2].changes) === J({ finds: [] }) && R.commits[2].what === '지도 장소 지우기' && R.api.ui().sel === null, J(R.commits[2]));
    await R.click({ 'data-scm-act': 'add-open' });
    await R.click({ 'data-scm-go': 'under' });
    ck('장을 옮기면 열어 둔 칸은 닫힌다', R.api.ui().form == null && R.api.ui().sheet === 'under', J(R.api.ui()));
    ck('어댑터 — 지우기 무장은 60초', /armDel: \{ raw: [^}]*until: Date\.now\(\) \+ 60000 \}/.test(src), '');
  }

  console.log('── ⑥ 편집기 [지도] 탭 — 장 줄 · 문 고르기 · 미리보기 그림 · 적기 켜기');
  {
    // 가짜 DOM — test-map.js ⑧과 같은 것 (편집기는 createElement·onchange·onclick만 쓴다)
    const makeDom = () => {
      const mkEl = (tag) => {
        const el = { tagName: String(tag).toUpperCase(), nodeType: 1, children: [], childNodes: [], style: { cssText: '' }, dataset: {}, attrs: {}, _text: '',
          className: '', value: '', checked: false, open: false, disabled: false,
          classList: { add(...c) { for (const x of c) if (!el.className.split(' ').includes(x)) el.className = (el.className + ' ' + x).trim(); },
            remove(...c) { el.className = el.className.split(' ').filter((x) => !c.includes(x)).join(' '); }, contains: (c) => el.className.split(' ').includes(c),
            toggle(c, on) { if (on === false || (on === undefined && el.classList.contains(c))) el.classList.remove(c); else el.classList.add(c); } },
          setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'open') el.open = true; if (k === 'disabled') el.disabled = true; },
          getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null), removeAttribute(k) { delete el.attrs[k]; },
          appendChild(c) { el.children.push(c); el.childNodes.push(c); c.parentNode = el; return c; }, append(...cs) { for (const c of cs) el.appendChild(c); },
          insertBefore(c, ref) { const i = el.children.indexOf(ref); el.children.splice(i < 0 ? el.children.length : i, 0, c); el.childNodes = el.children; c.parentNode = el; return c; },
          removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) { el.children.splice(i, 1); el.childNodes = el.children; } return c; },
          remove() { if (el.parentNode) el.parentNode.removeChild(el); },
          addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() { el.onclick?.({ preventDefault() {} }); },
          scrollIntoView() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 200, height: 30, bottom: 30, right: 200 }), setPointerCapture() {}, releasePointerCapture() {},
          replaceChildren(...cs) { el.children = []; el.childNodes = []; for (const c of cs) el.appendChild(c); }, prepend(...cs) { el.children.unshift(...cs); el.childNodes = el.children; },
          querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false, cloneNode: () => mkEl(tag) };
        Object.defineProperty(el, 'textContent', { get() { return el._text + el.children.map((c) => c.textContent ?? '').join(''); }, set(v) { el._text = String(v); el.children = []; el.childNodes = []; } });
        Object.defineProperty(el, 'innerHTML', { get: () => el._html ?? '', set(v) { el._html = String(v); el.children = []; el.childNodes = []; } });
        Object.defineProperty(el, 'firstChild', { get: () => el.children[0] ?? null });
        Object.defineProperty(el, 'lastChild', { get: () => el.children[el.children.length - 1] ?? null });
        return el;
      };
      const doc = { createElement: mkEl, createElementNS: (_ns, tag) => mkEl(tag), createTextNode: (t) => { const n = mkEl('#text'); n.nodeType = 3; n._text = String(t); return n; },
        createDocumentFragment: () => mkEl('#frag'), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
      doc.body = mkEl('body'); doc.head = mkEl('head'); doc.documentElement = mkEl('html');
      return doc;
    };
    const findAll = (root, pred, out = []) => { for (const c of root.children || []) { if (pred(c)) out.push(c); findAll(c, pred, out); } return out; };
    const btn = (root, label) => findAll(root, (e) => e.tagName === 'BUTTON' && (e.textContent || '').includes(label))[0];
    global.document = makeDom();
    global.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (f) => f(), setTimeout, clearTimeout };
    global.navigator = { clipboard: { writeText: async () => {} } };
    let confirmSaid = ''; global.confirm = (msg) => { confirmSaid = String(msg); return true; };
    const E = SC.require('editor');
    const open = (schema, extra = {}) => {
      const box = document.createElement('div');
      let last = null;
      E.createSchemaEditor(box, clone(schema), { onChange: (x) => { last = x; }, floor: 'deep', ...extra });
      const tab = findAll(box, (e) => e.tagName === 'BUTTON' && String(e.className).includes('sce-tab') && e.textContent === '지도')[0];
      let err = null; try { tab.click(); } catch (e) { err = e; }
      const T = { box, err, last: () => last };
      T.tagged = (name) => findAll(box, (e) => e.attrs && e.attrs['data-map'] === name);
      T.set = (el, v) => { el.value = v; el.onchange(); };
      T.check = (label, on) => { const cb = label.children[0]; cb.checked = on; cb.onchange(); };
      T.art = () => findAll(box, (e) => String(e._html || '').includes('scm-surface'))[0];
      T.hasInput = (v) => findAll(box, (e) => e.tagName === 'INPUT' && e.value === v).length > 0;
      T.pickAt = (x, y) => { const a = T.art(); a.querySelector = () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) }); a.onclick({ clientX: x, clientY: y, target: a }); };
      return T;
    };

    let t = open(TWO);
    ck('장 둘 지도 탭 — 예외 없이 열린다', !t.err, t.err && t.err.stack);
    const sel = () => t.tagged('sheet')[0];
    ck('장 고르기 — 첫 장과 더한 장', !!sel() && J(sel().children.map((o) => o.attrs.value)) === J(['main', 'under']) && sel().value === 'main', sel() ? J(sel().children.map((o) => o.attrs.value)) : '없음');
    ck('첫 장을 고른 동안 06은 첫 장의 장소', t.hasInput('어소') && !t.hasInput('수문'), '');
    t.set(sel(), 'under');
    ck('★ 장을 고르면 06·05·07이 그 장의 것', t.hasInput('수문') && t.hasInput('북쪽 수로') && t.hasInput('지상으로') && !t.hasInput('어소'), '');
    ck('더한 장의 칸 — 이름·id·안개·그림 보이기', t.hasInput('지하 수로') && t.tagged('sheet-id')[0]?.value === 'under' && t.tagged('sheet-fog')[0]?.value === 'on' && t.tagged('bg-always').length === 1, '');
    btn(t.box, '＋ 장소 찍어 넣기').click();
    t.pickAt(50, 100);
    ck('★ 찍기는 고른 장에 놓인다 (첫 장은 그대로)', t.last().map.sheets[0].places.length === 3 && t.last().map.places.length === 3 && t.last().map.sheets[0].places[2].x === 25 && t.last().map.sheets[0].places[2].y === 50,
      J([t.last().map.sheets[0].places.length, t.last().map.places.length]));
    const doors = () => t.tagged('door');
    ck('문 고르기 — 자기 장은 선택지에 없다', doors().length >= 3 && J(doors()[0].children.map((o) => o.attrs.value)) === J(['', 'main']), doors().length ? J(doors()[0].children.map((o) => o.attrs.value)) : '없음');
    t.set(doors()[0], 'main');
    ck('★ 문을 고르면 장소에 to', t.last().map.sheets[0].places[0].to === 'main', J(t.last().map.sheets[0].places[0]));
    t.set(doors()[0], '');
    ck('문을 빼면 키가 없다', !('to' in t.last().map.sheets[0].places[0]), J(t.last().map.sheets[0].places[0]));
    t.set(t.tagged('sheet-fog')[0], 'off');
    ck('장 안개 — 끔 / 따름', t.last().map.sheets[0].fog === false && (t.set(t.tagged('sheet-fog')[0], ''), !('fog' in t.last().map.sheets[0])), J(t.last().map.sheets[0].fog));
    t.set(t.tagged('sheet-fog')[0], 'on');
    t.check(t.tagged('bg-always')[0], true);
    ck('가 보기 전에도 그림 보이기 → bgAlways', t.last().map.sheets[0].bgAlways === true && (t.check(t.tagged('bg-always')[0], false), !('bgAlways' in t.last().map.sheets[0])), '');
    for (const bad of ['a b', 'main', '']) t.set(t.tagged('sheet-id')[0], bad);
    ck('장 id — 형식 밖·main·빈 값은 안 받는다', t.last().map.sheets[0].id === 'under', t.last().map.sheets[0].id);
    t.set(t.tagged('sheet-id')[0], 'sewer');
    ck('★ 장 id를 고치면 가리키던 문이 같이 바뀐다', t.last().map.sheets[0].id === 'sewer' && t.last().map.places[0].to === 'sewer' && t.last().map.exits[0].to === 'sewer' && sel().value === 'sewer',
      J([t.last().map.sheets[0].id, t.last().map.places[0].to, t.last().map.exits[0].to]));
    btn(t.box, '＋ 장').click();
    ck('★ ＋ 장 — 새 장이 생기고 그 장이 골라진다', t.last().map.sheets.length === 2 && J(t.last().map.sheets[1]) === J({ id: 'sheet3', label: '새 지도 3' }) && sel().value === 'sheet3', J(t.last().map.sheets[1]));
    btn(t.box, '장 지우기').click();
    ck('장 지우기 — 고른 장만', t.last().map.sheets.length === 1 && t.last().map.sheets[0].id === 'sewer' && sel().value === 'main', J(t.last().map.sheets.map((x) => x.id)));
    t.set(sel(), 'sewer');
    btn(t.box, '장 지우기').click();
    ck('★ 장을 지우면 가리키던 문이 빠지고, 지우기 전에 몇 개인지 알린다', !('sheets' in t.last().map) && !('to' in t.last().map.places[0]) && !('to' in t.last().map.exits[0]) && /문 2개/.test(confirmSaid), confirmSaid);
    ck('첫 장엔 [장 지우기]가 없다', !btn(t.box, '장 지우기'), '');

    t = open(TWO);
    t.check(t.tagged('add-place')[0], true);
    ck('★ 적기 켜기 → addPlace:true / 끄면 키가 없다', t.last().map.addPlace === true && (t.check(t.tagged('add-place')[0], false), !('addPlace' in t.last().map)), J(t.last().map.addPlace));
    {
      const a = t.art();
      a.onclick({ target: { closest: (s) => (s.includes('data-scm-go') ? { hasAttribute: (k) => k === 'data-scm-go', getAttribute: (k) => (k === 'data-scm-go' ? 'under' : null) } : null) } });
      ck('★ 미리보기의 문을 누르면 그 장으로 넘어간다', sel().value === 'under' && t.hasInput('수문'), sel().value);
      ck('미리보기 띠 — 안개 걷은 모습엔 전 장', t.art()._html.includes('data-scm-sheet="main"') && t.art()._html.includes('data-scm-sheet="under"'), '');
    }

    {
      const withBg = clone(TWO); withBg.map.bg = '교토도';
      const asked = [];
      const tb = open(withBg, { assetUrl: (name) => { asked.push(name); return Promise.resolve('blob:' + name); } });
      ck('★ 미리보기 배경 — 훅이 그 장의 그림 이름으로 불린다', !tb.err && J(asked) === '["교토도"]', tb.err ? tb.err.stack : J(asked));
      await new Promise((res) => setTimeout(res, 5));
      tb.set(tb.tagged('sheet')[0], 'under');
      await new Promise((res) => setTimeout(res, 5));
      ck('장을 바꾸면 그 장의 그림을 읽는다 (같은 그림은 한 번만)', J(asked) === '["교토도","수로도"]', J(asked));
      tb.set(tb.tagged('sheet')[0], 'main');
      ck('★ 읽은 그림이 미리보기에 깔린다', tb.art()._html.includes('class="scm-bg" src="blob:교토도"') && J(asked) === '["교토도","수로도"]', (tb.art()._html.match(/<img[^>]*>/) || ['그림 없음'])[0]);
      const tn = open(withBg);
      ck('훅이 없으면 예외 없이 종이 바탕', !tn.err && !tn.art()._html.includes('scm-bg'), tn.err && tn.err.stack);
      const tf = open(withBg, { assetUrl: () => Promise.reject(new Error('x')) });
      await new Promise((res) => setTimeout(res, 5));
      ck('훅이 던져도 탭은 멀쩡하다', !tf.err && !!tf.art(), tf.err && tf.err.stack);
      ck('배경 그림 도움말 — "미리보기엔 안 보여요"를 뺐다', !(tb.box.textContent || '').includes('미리보기엔 안 보여요'), '');
    }

    {
      const s = clone(TWO); s.map.sheets[0].places[0].known = 'has(rumors, "수문")';
      const idx = E.varReferenceIndex(s);
      ck('★ 변수 참조 색인 — 더한 장의 공개 조건 식', (idx.get('rumors') || []).some((r) => r.where === '지도' && /수문/.test(r.what)), J(idx.get('rumors')));
      const plan = E.planVarPurge(s, ['rumors']);
      ck('★ 변수 지우기 — 더한 장의 공개 조건에서도 빼낸다', !('known' in plan.schema.map.sheets[0].places[0]) && !('known' in plan.schema.map.places[1]) && plan.errors.length === 0, J([plan.schema.map.sheets[0].places[0], plan.errors]));
    }
    {
      const tn = open(BASE);
      btn(tn.box, '＋ 장').click();
      btn(tn.box, '＋ 장소 찍어 넣기').click(); tn.pickAt(20, 20);
      btn(tn.box, '＋ 장').click();
      btn(tn.box, '＋ 장소 찍어 넣기').click(); tn.pickAt(40, 40);
      const m = tn.last().map;
      const names = [...m.places, ...m.sheets.flatMap((x) => x.places || [])].map((p) => p.name);
      ck('★ 새 장에서 찍은 장소의 기본 이름이 다른 장과 안 겹친다 (검토 중요 2)', m.sheets.length === 2 && new Set(names).size === names.length && !validateSchema(tn.last()).errors.some((e) => /겹칩니다/.test(e.msg)), J(names));
      const tz = open(BASE);
      btn(tz.box, '＋ 장').click(); btn(tz.box, '＋ 구역').click();
      btn(tz.box, '＋ 장').click(); btn(tz.box, '＋ 구역').click();
      const zn = [...tz.last().map.zones, ...tz.last().map.sheets.flatMap((x) => x.zones || [])].map((z) => z.label);
      ck('★ 새 장에 더한 구역의 기본 이름도 안 겹친다', tz.last().map.sheets.every((x) => (x.zones || []).length === 1) && new Set(zn).size === zn.length, J(zn));
      ck('기능 지도 표 — 지도 줄에 여러 장·문 (설계 §7)', /여러 장/.test(E.FEATURE_MAP.find((x) => x.id === 'map').what) && /문/.test(E.FEATURE_MAP.find((x) => x.id === 'map').what), E.FEATURE_MAP.find((x) => x.id === 'map').what);
    }
    {
      const ML = clone(BASE); ML.vars.push({ id: 'ores', label: '광맥', type: 'list', init: [] }, { id: 'ruins', label: '폐허', type: 'list', init: [] });
      const tm = open(ML);
      const boxes = () => tm.tagged('more-list');
      ck('★ 편집기 — 함께 읽을 목록 칸: 찾아낸 곳·발자취로 안 쓰는 list 변수마다 하나', !tm.err && boxes().length === 3 && boxes().every((b) => b.children[0].checked === false), tm.err ? tm.err.stack : String(boxes().length));
      const boxOf = (word) => boxes().find((b) => (b.textContent || '').includes(word));
      tm.check(boxOf('ores'), true); tm.check(boxOf('ruins'), true);
      ck('★ 켜면 moreLists에 변수 순서대로', J(tm.last().map.moreLists) === J(['ores', 'ruins']), J(tm.last().map.moreLists));
      tm.check(boxOf('ores'), false);
      ck('끄면 빠진다 · 다 끄면 키가 없다', J(tm.last().map.moreLists) === J(['ruins']) && (tm.check(boxOf('ruins'), false), !('moreLists' in tm.last().map)), J(tm.last().map.moreLists));
      const s2 = clone(ML); s2.map.moreLists = ['ores'];
      ck('변수 쓰임 색인 — 함께 읽는 목록도 지도가 쓴다', (E.varReferenceIndex(s2).get('ores') || []).some((r) => r.where === '지도'), J(E.varReferenceIndex(s2).get('ores')));
      const plan = E.planVarPurge(s2, ['ores']);
      ck('변수 지우기 계획 — 함께 읽는 목록은 지도에서 빼낸다(막지 않는다)', !('moreLists' in plan.schema.map) && plan.errors.length === 0, J([plan.schema.map.moreLists, plan.errors]));
      const tx = open(s2);
      tx.set(tx.tagged('seen-var')[0], 'ores');
      ck('★ 발자취로 고른 목록은 함께 읽을 목록에서 빠진다 (검토 — 칸이 숨어 뺄 길이 없었다)', tx.last().map.seenVar === 'ores' && !('moreLists' in tx.last().map), J([tx.last().map.seenVar, tx.last().map.moreLists]));
      const ty = open(s2);
      ty.set(ty.tagged('list-var')[0], 'ores');
      ck('★ 찾아낸 곳으로 고른 목록도 빠진다', ty.last().map.listVar === 'ores' && !('moreLists' in ty.last().map), J([ty.last().map.listVar, ty.last().map.moreLists]));
      ck('규격서 — moreLists 줄', src.includes('- `moreLists`: ['), '');
    }
    ck('규격서 — 장·문·적기 줄', src.includes('**지도 여러 장**') && src.includes('`addPlace: true`'), '');
    ck('기능 현황 — 장 수를 싣는다', /sheets: fmN\(M\.sheets\)/.test(src), '');
    ck('어댑터 — 편집기에 그림 읽는 훅을 넘긴다', src.includes('assetUrl: (name) => resolvePortraitUrl(name)'), '');
  }

  console.log('── ⑦ 번들 조각 — 장 하나가 단위 하나 · 배경 그림 안내');
  {
    const B = SC.require('bundle');
    const THREE = clone(TWO);
    THREE.map.bg = '교토도';
    THREE.map.sheets.push({ id: 'deep', label: '깊은 수로', fog: true, bg: '수로도', places: [{ name: '물밑 문', x: 30, y: 30, known: true }], exits: [{ label: '위로', dir: 'n', to: 'under' }] });
    THREE.map.sheets[0].exits.push({ label: '더 아래로', dir: 's', to: 'deep' });
    THREE.vars[0].enum.push('물밑 문');
    const HOST = { simcore: '0.1', meta: { name: '받는 봇' }, vars: [{ id: 'hp', label: '체력', type: 'int', init: 5, min: 0, max: 10 }], statusUI: { mode: 'auto', groups: [] } };
    const charOf = (schema, assets = []) => ({ chaId: 'c1', name: '봇', additionalAssets: assets, customscript: [],
      globalLore: [{ comment: '⚙simcore', key: ' __simcore_never__', content: JSON.stringify(schema) }] });
    const schemaOf = (char) => JSON.parse(char.globalLore.find((l) => l.comment === '⚙simcore').content);
    const piece = (rev, edit) => { const d = { simcoreBundle: 2, id: 'b_maps0001', rev, name: '교토 지도 묶음', schema: { vars: clone(THREE.vars), map: clone(THREE.map) } }; if (edit) edit(d.schema.map); return d; };

    const fp = B.fingerprintOf(piece(1));
    ck('★ 단위 — 장 하나가 열쇠 하나 (sheets 통째가 아니다)', typeof fp['schema:map.sheets[under]'] === 'string' && typeof fp['schema:map.sheets[deep]'] === 'string' && !('schema:map.sheets' in fp), Object.keys(fp).filter((k) => k.includes('sheets')).join(','));
    const fpOld = B.fingerprintOf({ simcoreBundle: 2, id: 'b_old00001', rev: 1, name: '한 장', schema: { vars: clone(BASE.vars), map: clone(BASE.map) } });
    ck('장 없는 조각의 열쇠는 그대로 (첫 장의 장소·구역은 통째 단위)', 'schema:map.places' in fpOld && 'schema:map.zones' in fpOld && !Object.keys(fpOld).some((k) => k.startsWith('schema:map.sheets')), Object.keys(fpOld).filter((k) => k.startsWith('schema:map')).join(','));

    const char = charOf(HOST);
    const p1 = B.planPiece({ char, data: piece(1) });
    ck('조각 r1 — 받는 봇에 들어간다', p1.ok && p1.schemaErrors.length === 0, p1.ok ? J(p1.schemaErrors) : p1.error);
    B.applyPlanToChar(char, p1);
    ck('r1 — 장 둘이 순서대로', J(schemaOf(char).map.sheets.map((x) => x.id)) === J(['under', 'deep']), J(schemaOf(char).map.sheets?.map((x) => x.id)));
    // 받는 사람이 깊은 수로의 이름을 고친다 → 제작자의 r2는 지하 수로만 고쳤다
    { const e = char.globalLore[0]; const sc = JSON.parse(e.content); sc.map.sheets[1].label = '내가 붙인 이름'; e.content = JSON.stringify(sc); }
    const p2 = B.planPiece({ char, data: piece(2, (m) => { m.sheets[0].label = '지하 수로 (개정)'; }), base: { id: 'b_maps0001', format: 2, rev: 1, units: fp } });
    const kindOf = (key) => (p2.lines.find((l) => l.key === key) || {}).kind;
    ck('★ r2 — 제작자가 고친 장은 번들 수정, 내가 고친 장은 내 수정 유지', p2.ok && kindOf('schema:map.sheets[under]') === 'update' && kindOf('schema:map.sheets[deep]') === 'mineEdit', p2.ok ? J(p2.lines.map((l) => [l.key, l.kind])) : p2.error);
    B.applyPlanToChar(char, p2);
    ck('★ r2 뒤 — 둘 다 산다', schemaOf(char).map.sheets[0].label === '지하 수로 (개정)' && schemaOf(char).map.sheets[1].label === '내가 붙인 이름', J(schemaOf(char).map.sheets.map((x) => x.label)));
    const pBad = B.planPiece({ char: charOf(HOST), data: piece(1, (m) => { m.sheets.push({ label: 'id 없는 장' }); }) });
    ck('★ id 없는 장이 든 조각 — 모양이 어긋난 조각으로 거절한다 (받는 봇에 장이 없어도)', pBad.ok === false && /모양/.test(pBad.error) && /map.sheets/.test(pBad.error), J(pBad.ok ? pBad.schemaErrors : pBad.error));

    ck('mapBgNames — 첫 장 + 장들의 그림 이름 (겹침 없이)', J(B.mapBgNames(THREE)) === J(['교토도', '수로도']) && J(B.mapBgNames(BASE)) === '[]' && J(B.mapBgNames(null)) === '[]' && J(B.mapBgNames({ map: { bg: 5, sheets: [null, { bg: ' ' }] } })) === '[]', J(B.mapBgNames(THREE)));
    ck('★ 계획 — 받는 봇에 없는 배경 그림을 알려 준다', J(B.planPiece({ char: charOf(HOST), data: piece(1) }).bgMissing) === J(['교토도', '수로도'])
      && J(B.planPiece({ char: charOf(HOST, [['교토도.png', 'a1', 'png'], ['수로도', 'a2', 'webp']]), data: piece(1) }).bgMissing) === '[]'
      && J(B.planPiece({ char: charOf(HOST, [['교토도', 'a1', 'png']]), data: piece(1) }).bgMissing) === J(['수로도']), J(B.planPiece({ char: charOf(HOST), data: piece(1) }).bgMissing));

    // 화면 — 어댑터의 두 함수를 소스에서 떼어 돌린다
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const cut = (head) => { const a = src.indexOf(head); return src.slice(a, src.indexOf('\n  }\n', a) + 4); };
    const planHtml = new Function('bundleMod', 'escapeText', cut('  function bundlePlanHtml(plan, opts = {}) {') + '\nreturn bundlePlanHtml;')(B, esc);
    const pickerHtml = new Function('bundleMod', 'escapeText', cut('  function bundlePickerHtml(pk, built, st) {') + '\nreturn bundlePickerHtml;')(B, esc);
    const hMiss = planHtml(B.planPiece({ char: charOf(HOST), data: piece(1, (m) => { m.bg = '<b>도</b>'; }) }), {});
    ck('★ 요약 화면 — 없는 배경 그림 줄 (이름 이스케이프)', hMiss.includes('배경 그림 2장') && hMiss.includes('&lt;b&gt;도&lt;/b&gt;') && !hMiss.includes('<b>도</b>') && hMiss.includes('수로도'), (hMiss.match(/🖼[^<]*/) || ['줄 없음'])[0]);
    ck('요약 화면 — 그림이 다 있으면 줄 없음', !planHtml(B.planPiece({ char: charOf(HOST, [['교토도', 'a', 'png'], ['수로도', 'b', 'png']]), data: piece(1) }), {}).includes('🖼'), '');
    const author = charOf(clone(THREE));
    const picks = { tabs: ['map'], items: {}, lore: [], regex: [] };
    const built = B.buildPiece(author, picks, { name: '교토 지도' });
    ck('조각 만들기 — 지도 탭에 장이 같이 실린다', built.errors.length === 0 && J(built.data.schema.map.sheets.map((x) => x.id)) === J(['under', 'deep']), J(built.errors));
    const hPick = pickerHtml(B.pickables(author), built, { picks, open: [], name: '교토 지도', note: '', rev: 1 });
    ck('★ 고르기 화면 — 배경 그림은 파일에 안 들어간다고 알린다', hPick.includes('배경 그림 2장') && hPick.includes('교토도') && hPick.includes('수로도') && hPick.includes('파일에 안 들어가요'), (hPick.match(/🖼[^<]*/) || ['줄 없음'])[0]);
    const noMap = B.buildPiece(author, { tabs: [], items: { vars: ['location'] }, lore: [], regex: [] }, { name: 'x' });
    ck('지도를 안 고르면 그 줄이 없다', !pickerHtml(B.pickables(author), noMap, { picks: { tabs: [], items: { vars: ['location'] }, lore: [], regex: [] }, open: [], name: 'x', note: '', rev: 1 }).includes('🖼'), '');
  }

  console.log('── ⑧ 최종 검토에서 나온 것');
  {
    const ADD = clone(TWO); ADD.map.addPlace = true; ADD.map.sheets[0].zones[0].known = true;   // 수로 구역은 소문으로 안다(걷혀 있다)
    let v = view(ADD, {}, { sheet: 'under' });
    const tryAdd = MAP.addFind(ADD, st(ADD, {}), engine.makeLookup, { name: '아무거나', zone: '북쪽 수로', sheet: 'under' });
    ck('★ 가려진 장에는 적어 넣을 수 없다 — 적어서 가림을 스스로 풀지 못하게 (검토 중요 1)', v.veiled === true && J(v.addZones) === '[]' && tryAdd.ok === false, J([v.veiled, v.addZones, tryAdd]));
    v = view(ADD, { finds: ['북쪽 수로에서 흘러온 병', '뒷문 (북쪽 수로)'] }, { sheet: 'under' });
    ck('★ 찾아낸 곳이 꽂혀도 그림 가림은 안 풀린다 (보조가 적은 것도) — 띠에는 뜬다', v.veiled === true && v.bg === null && v.pins.length === 2 && v.strip.some((x) => x.id === 'under'), J([v.veiled, v.bg, v.pins.length]));
    v = view(ADD, { visited: ['북쪽 수로'] }, { sheet: 'under' });
    ck('구역에 발 디딘 것도 가림을 푼다 · 그 뒤엔 적을 수 있다', v.veiled === false && v.bg === '수로도' && J(v.addZones) === J(['북쪽 수로']), J([v.veiled, v.addZones]));
    let h = MAP.renderMapHtml(view(TWO, {}, { sheet: 'under' }), {}, {});
    ck('★ 가려진 장 — 안개 구역 사각형·채운 정도·아래 설명을 안 그린다 (설계 §4-5: 한 줄과 아는 곳·이정표만)', !h.includes('scm-fog') && !h.includes('scm-count') && !h.includes('물소리가 난다') && h.includes('망루 밑') && h.includes('지상으로') && h.includes('scm-veil'),
      (h.match(/class="scm-(count|note|zone[^"]*)"/g) || []).join(' '));
    h = MAP.renderMapHtml(view(TWO, { visited: ['수문'] }, { sheet: 'under' }), {}, {});
    ck('발 디딘 뒤엔 지금처럼 다 그린다', h.includes('scm-count') && h.includes('물소리가 난다') && h.includes('scm-zone'), '');
    h = MAP.renderMapHtml(view(TWO, { finds: ['어딘가'] }, { sheet: 'under' }), {}, {});
    ck('★ "자리를 못 찾은 곳" 안내가 가린 구역 이름을 예시로 내보내지 않는다', h.includes('자리를 못 찾은 곳') && !h.includes('북쪽 수로'), (h.match(/<div class="scm-stray">.*?<\/div>/) || [''])[0]);

    const PAR = clone(TWO); PAR.map.addPlace = true; PAR.map.zones[0].label = '강 건너 (동안)';
    ck('★ 이름에 괄호가 든 구역에는 적어 넣을 수 없다 — 고를 수 없고, 넣으려 해도 거절 (검토 중요 3)', J(view(PAR, {}).addZones) === J(['서쪽 들판'])
      && /구역 이름에 괄호/.test(MAP.addFind(PAR, st(PAR, {}), engine.makeLookup, { name: '샘', zone: '강 건너 (동안)', sheet: 'main' }).reason || ''), J(view(PAR, {}).addZones));
    const rnBad = MAP.renameFind(PAR, st(PAR, { finds: ['샘 (강 건너 (동안))', '서쪽 들판에서 주운 병'] }), engine.makeLookup, { raw: '샘 (강 건너 (동안))', name: '맑은 샘' });
    const rnBad2 = MAP.renameFind(PAR, st(PAR, { finds: ['서쪽 들판에서 주운 병'] }), engine.makeLookup, { raw: '서쪽 들판에서 주운 병', name: '병' });
    ck('★ 이름과 구역을 가를 수 없는 항목은 고치지 않는다 (고치면 구역이 떨어져 손댈 수 없게 된다)', rnBad.ok === false && /가를 수 없/.test(rnBad.reason) && rnBad2.ok === false, J([rnBad, rnBad2]));
    const hasW = (schema, path, word) => validateSchema(clone(schema)).warnings.some((e) => e.path.startsWith(path) && e.msg.includes(word));
    ck('장소 적기를 켠 지도에서 괄호 든 구역 이름은 경고 (안 켠 지도는 그대로)', hasW(PAR, '$.map.zones[0]', '적어 넣을 수 없') && (() => { const o = clone(PAR); delete o.map.addPlace; return !hasW(o, '$.map.zones[0]', '적어 넣을 수 없'); })(), '');

    const one = clone(BASE); one.map.places[0].to = '에도 성'; one.map.exits[0].to = 'main';
    const r1 = validateSchema(one);
    ck('★ 장이 없는 옛 지도에 우연히 있던 to는 오류가 아니라 경고 (옛 봇의 설치를 막지 않는다)', !r1.errors.some((e) => e.path.startsWith('$.map')) && r1.warnings.filter((w) => /\.to$/.test(w.path)).length === 2,
      J([r1.errors.filter((e) => e.path.startsWith('$.map')), r1.warnings.filter((w) => /\.to$/.test(w.path))]));
    ck('그런 to는 문이 되지도 않는다', view(one, {}).places[0].to === undefined && !MAP.renderMapHtml(view(one, {}), {}, {}).includes('data-scm-go'), '');

    const THREE = clone(TWO); THREE.map.sheets.push({ id: 'deep', label: '깊은 수로', fog: false, places: [{ name: '물밑 문', x: 30, y: 30 }] }); THREE.vars[0].enum.push('물밑 문');
    const R = panelRig(THREE);
    R.render();
    await R.click({ 'data-scm-go': 'under' });
    R.session.current.vars.location = '물밑 문'; R.render();
    ck('★ 구경 중 위치가 다른 장으로 가도 보던 장에 머문다 — 아래 줄에 지금 여기의 장 이름 (검토 초점 2)', R.api.ui().sheet === 'under' && /class="scm-sbtn scm-on" data-scm-sheet="under"/.test(R.html())
      && R.html().includes('(깊은 수로)') && R.html().includes('scm-back'), J(R.api.ui()));
  }

  console.log('── ⑨ 찾아낸 곳 목록 여러 개 (moreLists, v1.26.1)');
  {
    const ML = clone(TWO); ML.map.addPlace = true;
    ML.vars.push({ id: 'ores', label: '광맥', type: 'list', init: [] }, { id: 'ruins', label: '폐허', type: 'list', init: [] });
    ML.map.moreLists = ['ores', 'ruins'];
    const vars = { finds: ['뒷문 (서쪽 들판)'], ores: ['철광 (가모가와 동안)', '어딘가의 은'], ruins: ['옛 탑 (들판)', '물밑 사당 (북쪽 수로)'] };
    let v = view(ML, vars);
    ck('★ 세 목록의 항목이 다 핀으로 — 찾아낸 곳 목록 먼저, 그 뒤 moreLists 순서', J(v.pins.map((p) => p.name)) === J(['뒷문', '철광', '옛 탑']), J(v.pins.map((p) => p.name)));
    ck('★ 핀이 어느 목록 것인지 안다 — 고칠 수 있는 건 찾아낸 곳 목록 것뿐', J(v.pins.map((p) => [p.list ?? null, p.own !== false])) === J([[null, true], ['ores', false], ['ruins', false]]), J(v.pins.map((p) => [p.list, p.own])));
    ck('자리를 못 찾은 항목은 어느 목록 것이든 알림으로', J(v.stray.map((x) => x.name)) === J(['어딘가의 은']), J(v.stray));
    ck('다른 장의 구역에 꽂히는 것도 같다 (핀이 꽂힌 장은 띠에)', J(view(ML, vars, { sheet: 'under' }).pins.map((p) => p.name)) === J(['물밑 사당']) && v.strip.some((x) => x.id === 'under'), J(view(ML, vars, { sheet: 'under' }).pins));
    v = view(ML, { ...vars, location: '철광' });
    ck('위치 값이 함께 읽는 목록의 핀이면 지금 여기', v.here && v.here.kind === 'pin' && v.here.name === '철광', J(v.here));
    const FOG = clone(ML); FOG.map.fog = true;
    ck('안개 — 함께 읽는 목록의 핀이 꽂혀도 구역이 걷힌다', view(FOG, { ores: ['철광 (가모가와 동안)'] }).zones.find((z) => z.label === '가모가와 동안').open === true
      && !view(FOG, {}).zones.find((z) => z.label === '가모가와 동안').open, '');
    const only = clone(ML); delete only.map.listVar; delete only.map.addPlace;
    ck('찾아낸 곳 목록 없이 moreLists만 — 핀은 꽂히고 고칠 수 있는 건 없다', J(view(only, vars).pins.map((p) => [p.name, p.own])) === J([['철광', false], ['옛 탑', false]]) && view(only, vars).canAdd === false, J(view(only, vars).pins.map((p) => [p.name, p.own])));
    const many = { finds: Array.from({ length: 50 }, (_, i) => `굴${i} (서쪽 들판)`), ores: Array.from({ length: 50 }, (_, i) => `광${i} (가모가와 동안)`) };
    ck('상한 80은 목록을 합쳐서 센다', view(ML, many).pins.length === 80, String(view(ML, many).pins.length));
    const dup = clone(ML); dup.map.moreLists = ['finds', 'ores', 'ores'];
    ck('같은 목록을 두 번 적어도 한 번만 읽는다', J(view(dup, vars).pins.map((p) => p.name)) === J(['뒷문', '철광']), J(view(dup, vars).pins.map((p) => p.name)));

    v = view(ML, vars);
    const keyOf = (name) => v.pins.find((p) => p.name === name).key;
    const card = (name) => MAP.renderMapHtml(v, { sel: keyOf(name) }, {});
    ck('★ 카드 — 찾아낸 곳 목록의 핀에만 [이름 고치기]·[지우기]', card('뒷문').includes('data-scm-act="rename-open"') && !card('철광').includes('data-scm-act="rename-open"') && !card('철광').includes('data-scm-act="del"'),
      (card('철광').match(/data-scm-act="[^"]+"/g) || []).join(' '));
    const rm = MAP.removeFind(ML, st(ML, vars), { raw: '철광 (가모가와 동안)' });
    const rn = MAP.renameFind(ML, st(ML, vars), engine.makeLookup, { raw: '철광 (가모가와 동안)', name: '쇠' });
    ck('함께 읽는 목록의 항목은 지우기·고치기가 거절된다 (그 목록은 보조·시스템의 것)', rm.ok === false && rn.ok === false, J([rm, rn]));
    const nameDup = MAP.addFind(ML, st(ML, vars), engine.makeLookup, { name: '철광', zone: '서쪽 들판', sheet: 'main' });
    ck('★ 적어 넣을 때 함께 읽는 목록의 이름과도 안 겹친다', nameDup.ok === false && /이미 지도에 있는 이름/.test(nameDup.reason), J(nameDup));

    const errs = (schema) => validateSchema(clone(schema)).errors.filter((e) => e.path.startsWith('$.map.moreLists')).map((e) => e.msg);
    const warns = (schema) => validateSchema(clone(schema)).warnings.filter((e) => e.path.startsWith('$.map.moreLists')).map((e) => e.msg);
    ck('검증 — 바른 moreLists는 조용하다', errs(ML).length === 0 && warns(ML).length === 0, J([errs(ML), warns(ML)]));
    const bad = (val) => { const o = clone(ML); o.map.moreLists = val; return errs(o); };
    ck('검증 — 배열이 아니면 오류', bad('ores').length === 1, J(bad('ores')));
    ck('검증 — 없는 변수·list가 아닌 변수는 오류', bad(['nope']).length === 1 && bad(['location']).length === 1 && bad([3]).length === 1, J([bad(['nope']), bad(['location']), bad([3])]));
    ck('검증 — 9개부터 오류 (8개까지)', (() => { const o = clone(ML); for (let i = 0; i < 9; i++) o.vars.push({ id: 'l' + i, type: 'list', init: [] }); o.map.moreLists = Array.from({ length: 9 }, (_, i) => 'l' + i); return errs(o).some((m) => m.includes('8')); })(), '');
    const w1 = (() => { const o = clone(ML); o.map.moreLists = ['finds', 'visited']; return warns(o); })();
    ck('검증 — 찾아낸 곳 목록·발자취와 겹치면 경고 (두 번 읽지 않는다 / 발자취는 장소 이름이라 핀이 겹친다)', w1.length === 2, J(w1));
    ck('moreLists가 없는 지도의 핀은 글자 하나 안 바뀐다 — list·own 키가 없다 (황금본)', (() => { const p = view(TWO, { finds: ['폐사 (가모가와 동안)'] }).pins[0]; return p.name === '폐사' && !('list' in p) && !('own' in p); })(), '');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => { console.log('FAIL 테스트 본문이 던짐 →', e && e.stack || e); console.log('\n0 passed, 1 failed'); process.exit(1); });
