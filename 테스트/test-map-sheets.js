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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => { console.log('FAIL 테스트 본문이 던짐 →', e && e.stack || e); console.log('\n0 passed, 1 failed'); process.exit(1); });
