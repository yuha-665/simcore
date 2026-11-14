const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.25.0 — 🧩 번들 조각 · 업데이트 병합 (설계: docs/design-번들-조각.md)
//   ① 단위·해시·지문  ② 판정·계획·적용  ③ 조각 만들기(딸린 것 묶기·혼자 검증)  ④⑤ 가짜 리수 — 넣기·되돌리기·내보내기
const fs = require('fs');
const R = []; const ck = (n, c, x = '') => R.push([!!c, n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cp = (x) => JSON.parse(JSON.stringify(x));

(async () => {
  const B = require(__P('../core/bundle.js'));
  const P = require(__P('../core/profile.js'));
  const { validateSchema } = require(__P('../core/validate.js'));

  // ── ① 단위 · 해시 · 지문 ──
  {
    ck('hash53 — 같은 글은 같은 값, 다른 글은 다른 값', B.hash53('가나다') === B.hash53('가나다') && B.hash53('가나다') !== B.hash53('가나라'), B.hash53('가나다'));
    ck('hash53 — 32비트보다 길다 (36진 8자 이상이 나온다)', ['a', 'b', 'c', 'd', 'e', 'f'].some((s) => B.hash53(s).length >= 8), B.hash53('a'));
    ck('unitHash — 키 순서에 안 흔들린다', B.unitHash({ a: 1, b: [1, 2] }, 'schema') === B.unitHash({ b: [1, 2], a: 1 }, 'schema'), '');
    ck('unitHash — 로어의 id·loreCache는 안 잰다', B.unitHash({ comment: 'x', content: 'y' }, 'lore')
      === B.unitHash({ comment: 'x', content: 'y', id: 'uuid-1', loreCache: { k: 1 } }, 'lore'), '');
    ck('unitHash — 스키마 항목의 keep은 안 잰다', B.unitHash({ id: 'hp', init: 1 }, 'schema') === B.unitHash({ id: 'hp', init: 1, keep: true }, 'schema'), '');
    ck('sameUnit — 같은 필드를 빼고 비교', B.sameUnit({ comment: 'x', id: 'a' }, { comment: 'x', id: 'b' }, 'lore')
      && !B.sameUnit({ comment: 'x' }, { comment: 'z' }, 'lore'), '');

    const lore = [
      { comment: '⚙simcore', content: '{}' },
      { comment: '세계관', content: 'A' }, { comment: '세계관', content: 'B' },
      { comment: '', key: '검, 칼', content: 'C' }, { comment: '', key: '', content: 'D' },
      { comment: '📁 지리', mode: 'folder', key: 'folder:u1', content: '' },
      { comment: '⚙simcore:마법사', content: '{}' },
    ];
    const lu = B.loreUnits(lore);
    const keys = lu.map((u) => u.key);
    ck('로어 — ⚙simcore(기본 판)는 단위가 아니다', !keys.some((k) => k === 'lore:⚙simcore#0'), keys.join(' | '));
    ck('로어 — 같은 이름은 나온 순서 #n', keys.includes('lore:세계관#0') && keys.includes('lore:세계관#1'), keys.join(' | '));
    ck('로어 — comment가 비면 key, 그것도 비면 내용 해시', keys.includes('lore:~k:검, 칼#0') && keys.some((k) => /^lore:~h:[0-9a-z]+#0$/.test(k)), keys.join(' | '));
    ck('로어 — 폴더·프로필도 한 단위', keys.includes('lore:📁 지리#0') && keys.includes('lore:⚙simcore:마법사#0'), '');
    ck('로어 — 단위가 원래 자리(index)를 안다', lu.find((u) => u.key === 'lore:세계관#1').index === 2, '');
    const ru = B.regexUnits([{ comment: '에셋', type: 'editdisplay', in: 'a' }, { comment: '에셋', type: 'editdisplay', in: 'b' }, { comment: '에셋', type: 'editprocess' }]);
    ck('정규식 — comment|type#n', ru.map((u) => u.key).join(' ') === 'regex:에셋|editdisplay#0 regex:에셋|editdisplay#1 regex:에셋|editprocess#0', ru.map((u) => u.key).join(' '));

    const S = { vars: [{ id: 'hp', init: 10 }, { id: 'gold', init: 0 }], derived: [],
      map: { locVar: 'loc', places: [{ name: '길드', x: 1 }, { name: '던전', x: 2 }], zones: [] },
      rules: { onTurn: [{ set: 'hp', expr: 'hp-1' }], events: [{ id: 'e1', when: 'hp<1' }] }, promptState: { template: '' }, meta: {} };
    const su = B.schemaUnits(S);
    const sk = su.map((u) => u.key);
    ck('스키마 — id 목록은 항목마다', sk.includes('schema:vars[hp]') && sk.includes('schema:vars[gold]') && sk.includes('schema:rules.events[e1]'), sk.join(' | '));
    ck('스키마 — 객체는 키마다', sk.includes('schema:map.locVar') && sk.includes('schema:promptState.template'), sk.join(' | '));
    ck('스키마 — id 없는 배열은 통째 한 단위 (places·onTurn)', sk.includes('schema:map.places') && sk.includes('schema:rules.onTurn')
      && !sk.some((k) => k.startsWith('schema:map.places[')), sk.join(' | '));
    ck('스키마 — 빈 배열·빈 객체는 단위가 아니다', !sk.includes('schema:derived') && !sk.includes('schema:map.zones') && !sk.includes('schema:meta'), sk.join(' | '));
    ck('스키마 — 단위가 경로와 id를 안다', (() => { const u = su.find((x) => x.key === 'schema:rules.events[e1]'); return u.path.join('/') === 'rules/events' && u.id === 'e1'; })(), '');

    // 함께 걷기 — 모양이 어긋나면 그 자리가 잎 하나
    const pr = B.pairUnits({ liveChoices: { when: 'a', n: 1 }, vars: [], shop: { currency: 'gold' } },
      { liveChoices: [{ when: 'b' }], vars: [{ id: 'x' }], shop: { currency: 'coin', buyTo: 'bag' } });
    ck('함께 걷기 — 객체 ↔ 배열은 잎 하나씩', pr.c.has('schema:liveChoices') && pr.i.has('schema:liveChoices') && !pr.c.has('schema:liveChoices.when'), [...pr.c.keys()].join(' | '));
    ck('함께 걷기 — 빈 목록 ↔ id 목록은 항목 단위', !pr.c.has('schema:vars') && pr.i.has('schema:vars[x]'), [...pr.i.keys()].join(' | '));
    ck('함께 걷기 — 둘 다 객체면 키마다', pr.c.has('schema:shop.currency') && pr.i.has('schema:shop.currency') && pr.i.has('schema:shop.buyTo') && !pr.c.has('schema:shop.buyTo'), '');

    const fp2 = B.fingerprintOf({ simcoreBundle: 2, id: 'b_test0001', rev: 1, name: 'n',
      lorebook: [{ comment: '지리', content: 'g' }], regex: [{ comment: 'r', type: 'editdisplay' }],
      schema: { simcore: '0.1', meta: { name: '무시' }, vars: [{ id: 'loc', type: 'text' }], map: { locVar: 'loc' } } });
    ck('지문(조각) — 로어·정규식·스키마 단위의 해시', typeof fp2['lore:지리#0'] === 'string' && typeof fp2['regex:r|editdisplay#0'] === 'string'
      && typeof fp2['schema:vars[loc]'] === 'string' && typeof fp2['schema:map.locVar'] === 'string', Object.keys(fp2).join(' | '));
    ck('지문(조각) — meta·simcore는 안 실린다 · 채우지 않는다(promptState 없음)', !Object.keys(fp2).some((k) => k.startsWith('schema:meta') || k === 'schema:simcore' || k.startsWith('schema:promptState')), Object.keys(fp2).join(' | '));
    const fp1 = B.fingerprintOf({ simcoreBundle: 1, id: 'b_whole001', rev: 1, name: 'n',
      lorebook: [{ comment: '⚙simcore', content: JSON.stringify({ simcore: '0.1', meta: { name: 'x' }, vars: [{ id: 'hp', type: 'number', init: 1 }] }) }, { comment: '세계관', content: 'w' }],
      regexAdd: [{ comment: 'ra', type: 'editdisplay' }] });
    ck('지문(전체) — ⚙simcore는 풀어서 schema: 단위로, 채운 모양으로', typeof fp1['schema:vars[hp]'] === 'string' && typeof fp1['schema:promptState.position'] === 'string'
      && !fp1['lore:⚙simcore#0'] && typeof fp1['lore:세계관#0'] === 'string' && typeof fp1['regex:ra|editdisplay#0'] === 'string', Object.keys(fp1).join(' | '));
  }

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.log('FAIL 테스트 본문이 던짐 →', e && e.stack || e); console.log('\n0 passed, 1 failed'); process.exit(1); });
