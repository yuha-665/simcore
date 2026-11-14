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

  // ── ② 판정 · 계획 · 적용 ──
  const HOST = {
    simcore: '0.1', meta: { name: '받는 봇' },
    vars: [
      { id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100 },
      { id: 'gold', label: '금화', type: 'int', init: 10, min: 0 },
    ],
    derived: [{ id: 'rich', label: '부자', expr: 'gold > 100' }],
    rules: { onTurn: [{ set: 'hp', expr: 'hp - 1' }], events: [] },
    promptState: { position: 'history_end', template: '지금: 체력 {hp}', includeEvents: true },
    statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'hp' }, { var: 'gold' }] }] },
    updater: { allow: [{ id: 'hp', maxDelta: 10 }] },
  };
  const MAPPIECE = () => ({
    vars: [
      { id: 'location', label: '위치', type: 'enum', enum: ['길드', '던전', '바벨'], init: '길드' },
      { id: 'visited', label: '발자취', type: 'list', init: [], maxItems: 20 },
      { id: 'finds', label: '찾아낸 곳', type: 'list', init: [] },
    ],
    updater: { allow: [{ id: 'location' }] },
    map: {
      label: '오라리오', locVar: 'location', seenVar: 'visited', listVar: 'finds',
      places: [{ name: '길드', x: 40, y: 20 }, { name: '던전', x: 50, y: 50 }, { name: '바벨', x: 50, y: 40 }],
    },
  });
  const FOLDER = 'folder:u1';
  const piece = (rev, edit) => {
    const d = { simcoreBundle: 2, id: 'b_map00001', rev, name: '오라리오 지도', note: '원작 링크 · 허락받고 배포',
      lorebook: [{ comment: '📁 지리', mode: 'folder', key: FOLDER, content: '' }, { comment: '던전', folder: FOLDER, key: '던전', content: '던전 설명' }],
      regex: [{ comment: '지도 태그', type: 'editdisplay', in: 'x', out: 'y' }, { comment: '지도 태그2', type: 'editdisplay', in: 'x2', out: 'y2' }],
      schema: MAPPIECE() };
    if (edit) edit(d);
    return d;
  };
  const hostChar = (schema = HOST) => ({ chaId: 'c1', name: '봇',
    globalLore: [{ comment: '⚙simcore', key: ' __simcore_never__', content: JSON.stringify(schema) }, { comment: '세계관', content: '내 세계관' }, { comment: '인물', content: '내 인물' }],
    customscript: [{ comment: '에셋 표시', type: 'editdisplay', in: 'a', out: 'b' }] });
  const schemaOf = (char) => JSON.parse(char.globalLore.find((l) => l.comment === '⚙simcore').content);
  const editSchema = (char, fn) => { const e = char.globalLore.find((l) => l.comment === '⚙simcore'); const s = JSON.parse(e.content); fn(s); e.content = JSON.stringify(s); };
  const line = (plan, key) => plan.lines.find((l) => l.key === key);
  const install = (char, data, base, opts = {}) => {
    const plan = B.planPiece({ char, data, base, ...opts });
    if (!plan.ok || plan.schemaErrors.length) throw new Error('설치 실패: ' + (plan.error || plan.schemaErrors.join(' / ')));
    B.applyPlanToChar(char, plan);
    return { rev: data.rev, units: plan.fingerprint };
  };
  {
    ck('픽스처 — 받는 봇 스키마가 검증 통과', validateSchema(cp(HOST)).ok, JSON.stringify(validateSchema(cp(HOST)).errors));

    // 첫 설치
    const c0 = hostChar();
    const before = JSON.stringify(c0);
    const p1 = B.planPiece({ char: c0, data: piece(1), base: null });
    ck('첫 설치 — 계획 성공 · 검증 통과', p1.ok && !p1.schemaErrors.length, p1.error || (p1.schemaErrors || []).join(' / '));
    ck('첫 설치 — 계획은 캐릭터를 안 바꾼다(순수)', JSON.stringify(c0) === before, '');
    ck('첫 설치 — 번들 단위가 전부 "추가" 줄', p1.lines.length === Object.keys(p1.fingerprint).length && p1.lines.every((l) => l.kind === 'add' && l.choice === 'bundle'),
      p1.lines.map((l) => `${l.kind}:${l.key}`).join(' | '));
    ck('첫 설치 — 내 것(세계관·hp)은 줄에 없다', !line(p1, 'lore:세계관#0') && !line(p1, 'schema:vars[hp]'), '');
    ck('요약 — 이름·rev·추가 개수', B.summaryText(p1) === `'오라리오 지도' r1 — 추가 ${p1.lines.length}`, B.summaryText(p1));
    B.applyPlanToChar(c0, p1);
    const s1 = schemaOf(c0);
    ck('첫 설치 — 지도와 딸린 변수가 들어갔다', s1.map && s1.map.locVar === 'location' && s1.vars.some((v) => v.id === 'finds') && s1.updater.allow.some((a) => a.id === 'location'), '');
    ck('★ 내 변수 순서 그대로, 새 항목은 끝', s1.vars.map((v) => v.id).join(',') === 'hp,gold,location,visited,finds', s1.vars.map((v) => v.id).join(','));
    const filled = P.shapeFill(cp(HOST));
    ck('★ 지도 조각이 promptState·statusUI·rules.onTurn·meta를 안 건드린다', P.stable(s1.promptState) === P.stable(filled.promptState) && P.stable(s1.statusUI) === P.stable(filled.statusUI)
      && P.stable(s1.rules.onTurn) === P.stable(filled.rules.onTurn) && s1.meta.name === '받는 봇', JSON.stringify([s1.promptState, s1.statusUI, s1.rules.onTurn]));
    ck('병합 결과가 검증 통과', validateSchema(s1).ok, JSON.stringify(validateSchema(s1).errors));
    ck('★ 내 로어 순서 그대로, 새 항목은 끝', c0.globalLore.map((l) => l.comment).join(',') === '⚙simcore,세계관,인물,📁 지리,던전', c0.globalLore.map((l) => l.comment).join(','));
    ck('★ 내 정규식 순서 그대로, 새 것은 끝', c0.customscript.map((r) => r.comment).join(',') === '에셋 표시,지도 태그,지도 태그2', c0.customscript.map((r) => r.comment).join(','));
    const base1 = { rev: 1, units: p1.fingerprint };

    // 같은 판을 다시 — 바뀌는 것 없음, ⚙simcore 글 그대로. 로어에 id가 붙어도 같음
    const cSame = cp(c0);
    cSame.globalLore.find((l) => l.comment === '던전').id = 'uuid-risu-1';
    const contentBefore = cSame.globalLore[0].content;
    const pSame = B.planPiece({ char: cSame, data: piece(1), base: base1 });
    ck('같은 판 다시 — 줄 없음 (로어 id가 붙어도 "같음")', pSame.ok && pSame.lines.length === 0, pSame.lines.map((l) => `${l.kind}:${l.key}`).join(' | '));
    B.applyPlanToChar(cSame, pSame);
    ck('같은 판 다시 — ⚙simcore 글이 원문 그대로', cSame.globalLore[0].content === contentBefore && pSame.result.schemaChanged === false, '');
    ck('요약 — 바뀌는 것이 없으면 그렇게 말한다', /바뀌는 것이 없어요/.test(B.summaryText(pSame)), B.summaryText(pSame));

    // 판정 표 — r2: 제작자가 고친 것 / 받는 사람이 고친 것
    const c2 = cp(c0);
    editSchema(c2, (s) => {
      s.vars.find((v) => v.id === 'finds').maxItems = 9;            // 6: 둘 다 고침
      s.vars.find((v) => v.id === 'visited').label = '내 발자취';   // 8: 제작자는 빼고 나는 고침
      s.updater.allow = s.updater.allow.filter((a) => a.id !== 'location'); // 10: 나는 지우고 제작자는 고침
    });
    c2.globalLore.find((l) => l.comment === '던전').content = '내가 고친 던전';   // 5: 나만 고침
    c2.customscript = c2.customscript.filter((r) => r.comment !== '지도 태그2'); // 9: 나는 지웠고 제작자는 그대로
    const r2 = piece(2, (d) => {
      d.schema.map.label = '오라리오 전도';                          // 4: 제작자만 고침
      d.schema.vars.find((v) => v.id === 'finds').maxItems = 30;     // 6
      d.schema.vars = d.schema.vars.filter((v) => v.id !== 'visited'); delete d.schema.map.seenVar; // 8 + 7(seenVar)
      d.schema.vars.push({ id: 'depth', label: '층', type: 'int', init: 1, min: 1 }); // 1: 새 항목
      d.schema.updater.allow[0].maxDelta = 1;                        // 10
      d.regex = d.regex.filter((r) => r.comment !== '지도 태그');    // 7: 제작자가 뺌
    });
    const p2 = B.planPiece({ char: c2, data: r2, base: base1 });
    const kinds = (k) => { const l = line(p2, k); return l ? `${l.kind}/${l.def}/${l.choice}` : '(줄 없음)'; };
    ck('판정 1 (–,–,I) 추가', kinds('schema:vars[depth]') === 'add/bundle/bundle', kinds('schema:vars[depth]'));
    ck('판정 2 (–,C,–) 내 것 — 줄 없음', kinds('lore:세계관#0') === '(줄 없음)' && kinds('schema:vars[hp]') === '(줄 없음)', '');
    ck('판정 4 (B,C=B,I≠B) 번들 수정', kinds('schema:map.label') === 'update/bundle/bundle', kinds('schema:map.label'));
    ck('판정 5 (B,C≠B,I=B) 내 수정 유지', kinds('lore:던전#0') === 'mineEdit/mine/mine', kinds('lore:던전#0'));
    ck('판정 6 (B,C≠B,I≠B) 충돌 — 기본 번들 것', kinds('schema:vars[finds]') === 'conflict/bundle/bundle', kinds('schema:vars[finds]'));
    ck('판정 7 (B,C=B,–) 제작자 삭제', kinds('regex:지도 태그|editdisplay#0') === 'removed/bundle/bundle' && kinds('schema:map.seenVar') === 'removed/bundle/bundle', kinds('regex:지도 태그|editdisplay#0'));
    ck('판정 8 (B,C≠B,–) 충돌 — 기본 내 것', kinds('schema:vars[visited]') === 'conflict/mine/mine', kinds('schema:vars[visited]'));
    ck('판정 9 (B,–,I=B) 내가 지움 — 지운 채로', kinds('regex:지도 태그2|editdisplay#0') === 'iDeleted/mine/mine', kinds('regex:지도 태그2|editdisplay#0'));
    ck('판정 10 (B,–,I≠B) 충돌 — 기본 번들 것(되살림)', kinds('schema:updater.allow[location]') === 'conflict/bundle/bundle', kinds('schema:updater.allow[location]'));
    ck('판정 11 같음 — 줄 없음', kinds('schema:vars[location]') === '(줄 없음)' && kinds('lore:📁 지리#0') === '(줄 없음)', '');
    ck('개수', p2.counts.add === 1 && p2.counts.update === 1 && p2.counts.mineEdit === 1 && p2.counts.removed === 2 && p2.counts.conflict === 3 && p2.counts.iDeleted === 1 && p2.counts.locked === 0, JSON.stringify(p2.counts));
    ck('요약 — 갈래별 개수와 설치된 판', B.summaryText(p2) === "'오라리오 지도' r2 (설치된 판 r1) — 추가 1 · 번들 수정 1 · 내 수정 유지 1 · 제작자 삭제 2 · 내가 지움 1 · 충돌 3", B.summaryText(p2));
    ck('r2 — 검증 통과', p2.ok && !p2.schemaErrors.length, (p2.schemaErrors || []).join(' / '));
    const c2a = B.applyPlanToChar(cp(c2), p2);
    const s2 = schemaOf(c2a);
    ck('r2 적용 — 번들 수정·충돌(번들)·되살림', s2.map.label === '오라리오 전도' && s2.vars.find((v) => v.id === 'finds').maxItems === 30 && s2.updater.allow.find((a) => a.id === 'location').maxDelta === 1, '');
    ck('r2 적용 — 내 수정·충돌(내 것) 유지', c2a.globalLore.find((l) => l.comment === '던전').content === '내가 고친 던전' && s2.vars.find((v) => v.id === 'visited').label === '내 발자취', '');
    ck('r2 적용 — 제작자 삭제는 지우고, 내가 지운 것은 지운 채', !c2a.customscript.some((r) => r.comment === '지도 태그' || r.comment === '지도 태그2') && !('seenVar' in s2.map)
      && c2a.customscript.some((r) => r.comment === '에셋 표시'), JSON.stringify(c2a.customscript.map((r) => r.comment)));
    ck('r2 적용 — 지문은 번들이 준 것(I)', P.stable(p2.fingerprint) === P.stable(B.fingerprintOf(r2)), '');

    // 줄 바꾸기
    const p2b = B.planPiece({ char: c2, data: r2, base: base1, choices: { 'schema:map.label': 'mine', 'lore:던전#0': 'bundle', 'schema:vars[visited]': 'bundle', 'regex:지도 태그2|editdisplay#0': 'bundle', 'schema:vars[depth]': 'mine' } });
    const c2b = B.applyPlanToChar(cp(c2), p2b);
    const s2b = schemaOf(c2b);
    ck('줄 바꾸기 — 번들 수정을 [내 것]으로, 내 수정을 [번들 것]으로', s2b.map.label === '오라리오' && c2b.globalLore.find((l) => l.comment === '던전').content === '던전 설명', '');
    ck('줄 바꾸기 — 충돌(기본 내 것)을 [번들 것]으로 = 지움, 내가 지운 것을 되살림, 추가를 안 넣음', !s2b.vars.some((v) => v.id === 'visited') && c2b.customscript.some((r) => r.comment === '지도 태그2')
      && !s2b.vars.some((v) => v.id === 'depth'), JSON.stringify(s2b.vars.map((v) => v.id)));
    ck('줄 바꾸기 — 줄에 고른 값이 남는다', line(p2b, 'schema:map.label').choice === 'mine' && line(p2b, 'schema:map.label').def === 'bundle', '');

    // fresh — 지문을 무시하고 첫 설치 길로
    const pF = B.planPiece({ char: c2, data: r2, base: base1, fresh: true });
    ck('처음부터 다시 넣기 — 내가 지운 것이 "추가"로, 제작자가 뺀 것은 줄 없음', line(pF, 'regex:지도 태그2|editdisplay#0')?.kind === 'add' && !line(pF, 'regex:지도 태그|editdisplay#0')
      && pF.installedRev === 1, pF.lines.map((l) => `${l.kind}:${l.key}`).join(' | '));

    // 🔒
    const cL = cp(c0);
    editSchema(cL, (s) => { s.vars.find((v) => v.id === 'finds').keep = true; });
    const pL = B.planPiece({ char: cL, data: r2, base: base1, choices: { 'schema:vars[finds]': 'bundle' } });
    ck('🔒 — 보호 항목은 내 것으로 고정(고르기 무시) · 개수', line(pL, 'schema:vars[finds]')?.kind === 'locked' && line(pL, 'schema:vars[finds]').choice === 'mine' && line(pL, 'schema:vars[finds]').locked === true && pL.counts.locked === 1,
      JSON.stringify(line(pL, 'schema:vars[finds]')));
    const sL = schemaOf(B.applyPlanToChar(cp(cL), pL));
    ck('🔒 — 적용해도 그대로(keep 포함)', sL.vars.find((v) => v.id === 'finds').maxItems === undefined && sL.vars.find((v) => v.id === 'finds').keep === true, JSON.stringify(sL.vars.find((v) => v.id === 'finds')));

    // 한 이름 공간 겹침 — 조각의 변수 depth ↔ 내 파생 depth
    const hostNs = cp(HOST); hostNs.derived.push({ id: 'depth', label: '층(파생)', expr: 'hp' });
    const cN = hostChar(hostNs);
    const withDepth = piece(1, (d) => { d.schema.vars.push({ id: 'depth', label: '층', type: 'int', init: 1, min: 1 }); });
    const pN = B.planPiece({ char: cN, data: withDepth, base: null });
    const lN = line(pN, 'schema:vars[depth]');
    ck('★ 이름 공간 겹침 — 충돌 줄 하나로 (내 파생을 밀어낸다고 알린다)', lN && lN.kind === 'conflict' && lN.oust === 'schema:derived[depth]' && lN.choice === 'bundle' && pN.counts.conflict === 1, JSON.stringify(lN));
    const sN = schemaOf(B.applyPlanToChar(cp(cN), pN));
    ck('이름 공간 겹침 — [번들 것] = 내 파생을 빼고 변수를 넣는다 (검증 통과)', sN.vars.some((v) => v.id === 'depth') && !sN.derived.some((d) => d.id === 'depth') && !pN.schemaErrors.length, pN.schemaErrors.join(' / '));
    const pN2 = B.planPiece({ char: cN, data: withDepth, base: null, choices: { 'schema:vars[depth]': 'mine' } });
    const sN2 = schemaOf(B.applyPlanToChar(cp(cN), pN2));
    ck('이름 공간 겹침 — [내 것] = 안 넣는다', !sN2.vars.some((v) => v.id === 'depth') && sN2.derived.some((d) => d.id === 'depth') && !pN2.schemaErrors.length, pN2.schemaErrors.join(' / '));

    // 첫 설치인데 같은 id의 다른 변수가 이미 있다 — 판정 3
    const hostDup = cp(HOST); hostDup.vars.push({ id: 'location', label: '내 위치', type: 'text', init: '집' });
    const cD = hostChar(hostDup);
    const pD = B.planPiece({ char: cD, data: piece(1), base: null });
    ck('판정 3 (–,C,I≠) 충돌 — 기본 번들 것', line(pD, 'schema:vars[location]')?.kind === 'conflict' && line(pD, 'schema:vars[location]').def === 'bundle', JSON.stringify(line(pD, 'schema:vars[location]')));
    const sD = schemaOf(B.applyPlanToChar(cp(cD), pD));
    ck('판정 3 — 번들 것이 제자리에 (순서 유지)', sD.vars.map((v) => v.id).join(',') === 'hp,gold,location,visited,finds' && sD.vars[2].type === 'enum', sD.vars.map((v) => v.id).join(','));

    // 조각 둘 공존
    const shop = (rev, edit) => { const d = { simcoreBundle: 2, id: 'b_shop0001', rev, name: '코인 조각',
      schema: { vars: [{ id: 'coin', label: '코인', type: 'int', init: 0, min: 0 }], directives: [{ id: 'coin_rule', when: 'coin > 0', text: '코인이 있다' }] } }; if (edit) edit(d); return d; };
    const cT = cp(c0);
    const baseShop = install(cT, shop(1), null);
    const pA2 = B.planPiece({ char: cT, data: piece(2, (d) => { d.schema.map.label = '새 이름'; }), base: base1 });
    const sT = schemaOf(B.applyPlanToChar(cp(cT), pA2));
    ck('★ 조각 공존 — 지도 조각 r2가 코인 조각의 단위를 안 건드린다', sT.vars.some((v) => v.id === 'coin') && sT.directives.some((d) => d.id === 'coin_rule') && sT.map.label === '새 이름'
      && !pA2.lines.some((l) => /coin/.test(l.key)), pA2.lines.map((l) => l.key).join(' | '));
    const pS2 = B.planPiece({ char: cT, data: shop(2, (d) => { delete d.schema.directives; }), base: baseShop });
    const sT2 = schemaOf(B.applyPlanToChar(cp(cT), pS2));
    ck('★ 조각 공존 — 코인 조각 r2는 자기 지시문만 지운다 (지도는 그대로)', !sT2.directives.some((d) => d.id === 'coin_rule') && sT2.map && sT2.vars.some((v) => v.id === 'location')
      && pS2.lines.length === 1 && pS2.lines[0].kind === 'removed', pS2.lines.map((l) => `${l.kind}:${l.key}`).join(' | '));

    // 병합 스키마 검증 실패 — 아무것도 안 바뀐다
    const badPiece = piece(1, (d) => { d.schema.map.locVar = 'nowhere'; });
    const cBad = hostChar();
    const beforeBad = JSON.stringify(cBad);
    const pBad = B.planPiece({ char: cBad, data: badPiece, base: null });
    let threw = false;
    try { B.applyPlanToChar(cBad, pBad); } catch { threw = true; }
    ck('★ 검증 실패 — 오류를 싣고 적용을 거부, 캐릭터 무변화', pBad.ok && pBad.schemaErrors.length > 0 && threw && JSON.stringify(cBad) === beforeBad, (pBad.schemaErrors || []).join(' / '));
    ck('검증 실패 — 오류에 나온 자리의 줄을 가리킨다', pBad.errorKeys.includes('schema:map.locVar'), JSON.stringify(pBad.errorKeys));

    // ⚙simcore 없는 봇 — 조각의 스키마가 첫 스키마
    const cPlain = { chaId: 'c9', name: '빈 봇', globalLore: [{ comment: '원래 로어', content: 'x' }], customscript: [] };
    const pP = B.planPiece({ char: cPlain, data: piece(1), base: null });
    ck('빈 봇 — 검증 통과 (지도만으로 설치)', pP.ok && !pP.schemaErrors.length, pP.error || pP.schemaErrors.join(' / '));
    B.applyPlanToChar(cPlain, pP);
    const eP = cPlain.globalLore.find((l) => l.comment === '⚙simcore');
    ck('빈 봇 — ⚙simcore 항목이 꺼진 키로 생긴다 · 제목은 조각 이름', !!eP && eP.key === ' __simcore_never__' && eP.alwaysActive === false && JSON.parse(eP.content).meta.name === '오라리오 지도'
      && validateSchema(JSON.parse(eP.content)).ok, eP && eP.content.slice(0, 120));

    // 로어·정규식만 든 조각 — ⚙simcore를 읽지도 않는다 (깨져 있어도 들어간다)
    const loreOnly = { simcoreBundle: 2, id: 'b_lore0001', rev: 1, name: '지리 로어', lorebook: [{ comment: '오라리오', content: '도시' }] };
    const cBroken = hostChar(); cBroken.globalLore[0].content = '{깨짐';
    const pLo = B.planPiece({ char: cBroken, data: loreOnly, base: null });
    ck('검토 초점 1 — 로어만 든 조각은 깨진 ⚙simcore에도 들어간다 (글 그대로)', pLo.ok && B.applyPlanToChar(cp(cBroken), pLo).globalLore[0].content === '{깨짐', pLo.error || '');
    const pBr = B.planPiece({ char: cBroken, data: piece(1), base: null });
    ck('검토 초점 1 — 스키마 든 조각은 깨진 ⚙simcore에서 거절, 이유를 말한다', pBr.ok === false && /깨져/.test(pBr.error || ''), pBr.error || '');

    // 같은 이름 로어 — 지문에 없는 내 항목은 안 지워진다
    const note = (rev, has) => ({ simcoreBundle: 2, id: 'b_note0001', rev, name: '노트', lorebook: has ? [{ comment: '노트', content: 'P' }] : [{ comment: '다른 것', content: 'Q' }] });
    const cNt = hostChar();
    const baseNt = install(cNt, note(1, true), null);
    cNt.globalLore = cNt.globalLore.filter((l) => !(l.comment === '노트' && l.content === 'P'));
    cNt.globalLore.push({ comment: '노트', content: '내 노트' });
    const pNt = B.planPiece({ char: cNt, data: note(2, false), base: baseNt });
    const cNt2 = B.applyPlanToChar(cp(cNt), pNt);
    ck('검토 초점 2 — 번호가 밀려도 내가 쓴 같은 이름 항목은 기본으로 안 지워진다 (충돌 · 기본 내 것)', cNt2.globalLore.some((l) => l.content === '내 노트')
      && line(pNt, 'lore:노트#0')?.kind === 'conflict' && line(pNt, 'lore:노트#0').def === 'mine', JSON.stringify(pNt.lines));

    // meta·simcore가 든 조각 — 무시
    const pM = B.planPiece({ char: hostChar(), data: piece(1, (d) => { d.schema.meta = { name: '덮지 마' }; d.schema.simcore = '9.9'; }), base: null });
    const sM = schemaOf(B.applyPlanToChar(hostChar(), pM));
    ck('검토 초점 3 — 조각의 meta·simcore는 무시 (받는 봇 제목·버전 표식 유지)', sM.meta.name === '받는 봇' && sM.simcore === '0.1' && !pM.lines.some((l) => /meta|schema:simcore/.test(l.key)), sM.meta.name);

    // 낮은 rev
    const pDown = B.planPiece({ char: c0, data: piece(1), base: { rev: 3, units: p1.fingerprint } });
    ck('검토 초점 5 — 낮은 rev는 경고만 (막지 않는다)', pDown.ok && pDown.downgrade === true && pDown.installedRev === 3 && p2.downgrade === false, '');

    // 형식 검사
    ck('형식 — 조각이 아니면 이유', /simcoreBundle: 2/.test(B.pieceShapeError({ simcoreBundle: 1 }) || ''), String(B.pieceShapeError({ simcoreBundle: 1 })));
    ck('형식 — id 없음 · 빈 조각 · 배열 아님', !!B.pieceShapeError({ simcoreBundle: 2, lorebook: [{}] }) && !!B.pieceShapeError({ simcoreBundle: 2, id: 'b_x1234567' })
      && !!B.pieceShapeError({ simcoreBundle: 2, id: 'b_x1234567', lorebook: {} }) && !!B.pieceShapeError({ simcoreBundle: 2, id: 'b_x1234567', schema: [] }), '');
    ck('형식 — 맞는 조각은 null · 스키마만 있어도 된다', B.pieceShapeError(piece(1)) === null && B.pieceShapeError({ simcoreBundle: 2, id: 'b_x1234567', schema: { vars: [{ id: 'a' }] } }) === null, '');
    ck('계획 — 형식이 틀리면 ok:false', B.planPiece({ char: hostChar(), data: { simcoreBundle: 2 }, base: null }).ok === false, '');
    ck('스키마 파일 안내 — 번들 칸에 스키마 JSON', /JSON 관리자/.test(B.schemaFileHint(cp(HOST)) || '') && B.schemaFileHint(piece(1)) === null && B.schemaFileHint({ simcoreBundle: 1, lorebook: [] }) === null && B.schemaFileHint(null) === null, String(B.schemaFileHint(cp(HOST))));
  }

  // ── ③ 조각 만들기 (제작자 쪽) ──
  const AUTH = {
    simcore: '0.1', meta: { name: '오라리오', notes: '제작자 메모 — 배포본에 싣지 않는다' },
    time: { start: '2026-03-02 08:30', advance: 'explicit', format: { date: 'M월 D일', clock: 'HH:mm' } },
    vars: [
      { id: 'hp', label: '체력', type: 'int', init: 50, min: 0, max: 100, keep: true },
      { id: 'gold', label: '금화', type: 'int', init: 10, min: 0, cmd: '돈' },
      { id: 'location', label: '위치', type: 'enum', enum: ['길드', '던전', '바벨'], init: '길드' },
      { id: 'visited', label: '발자취', type: 'list', init: [], maxItems: 20 },
      { id: 'finds', label: '찾아낸 곳', type: 'list', init: [] },
      { id: 'str', label: '근력', type: 'int', init: 10, min: 0 },
      { id: 'luck', label: '행운', type: 'int', init: 1, min: 0 },
    ],
    derived: [{ id: 'power', label: '전투력', expr: 'str * 2 + bonus' }, { id: 'bonus', label: '보너스', expr: 'luck' }],
    checks: [{ id: 'atk', label: '공격 판정', roll: 'rand(1, 20)', mod: 'power', vs: '12',
      grades: [{ when: 'total >= vs', label: '성공', inject: '맞혔다.', effects: [{ set: 'gold', expr: 'gold + 1' }] }, { when: 'true', label: '실패', inject: '빗나갔다.' }] }],
    actions: [{ id: 'strike', label: '⚔ 공격', mode: 'oneshot', check: 'atk', inject: '[행동] 공격한다.' }],
    directives: [{ id: 'd_late', when: 'hour >= 22', text: '밤이 깊었다.' }, { id: 'd_poor', when: 'gold < 5', text: '돈이 없다.' }],
    rules: { onTurn: [{ set: 'hp', expr: 'max(hp - 1, 0)' }], events: [{ id: 'e_dead', when: 'hp <= 0', notify: '쓰러졌다', once: true }] },
    statusUI: { mode: 'auto', layout: 'tabs', customCSS: '.mine{color:red}', groups: [{ label: '상태', items: [{ var: 'hp' }, { var: 'gold' }] }] },
    setup: { presets: [{ id: 'rich', label: '부자', set: { gold: 500 } }], ai: { enabled: false, vars: [] } },
    updater: { allow: [{ id: 'hp', maxDelta: 10 }, { id: 'location' }, { id: 'gold', maxDelta: 5 }, { id: 'luck', maxDelta: 1 }] },
    map: { label: '오라리오', locVar: 'location', seenVar: 'visited', listVar: 'finds',
      places: [{ name: '길드', x: 40, y: 20 }, { name: '던전', x: 50, y: 50, known: 'luck > 0' }, { name: '바벨', x: 50, y: 40 }] },
  };
  const authChar = () => ({ chaId: 'c-auth', name: '제작자 봇',
    globalLore: [
      { comment: '⚙simcore', key: ' __simcore_never__', content: JSON.stringify(AUTH) },
      { comment: '📁 오라리오 지리', mode: 'folder', key: 'folder:geo', content: '' },
      { comment: '길드', folder: 'folder:geo', key: '길드', content: '모험가 길드', id: 'chat-local-1', loreCache: { x: 1 } },
      { comment: '던전', folder: 'folder:geo', key: '던전', content: '지하 미궁' },
      { comment: '📁 페르소나', mode: 'folder', key: 'folder:me', content: '' },
      { comment: '내 능력', folder: 'folder:me', key: '능력', content: '비공개' },
      { comment: '세계관', key: '세계', content: '신들의 도시' },
      { comment: '⚙simcore:마법사', key: ' __simcore_never__', content: '{"simcoreProfile":1,"overlay":{}}' },
    ],
    customscript: [{ comment: '에셋 표시', type: 'editdisplay', in: 'a', out: 'b' }, { comment: '지도 태그', type: 'editdisplay', in: 'x', out: 'y' }] });
  const INFO = { id: 'b_map00001', rev: 1, name: '오라리오 지도', note: '원작 링크' };
  {
    const av = validateSchema(cp(AUTH));
    ck('픽스처 — 제작자 봇 스키마가 검증 통과', av.ok, JSON.stringify(av.errors));
    ck('newBundleId — b_ + 8글자, 부를 때마다 다르다', /^b_[0-9a-z]{8}$/.test(B.newBundleId()) && B.newBundleId() !== B.newBundleId() && B.newBundleId(() => 0) === 'b_00000000', B.newBundleId());
    ck('stripKeep — id 있는 항목의 keep만 걷는다 (원본은 그대로)', (() => { const src = { vars: [{ id: 'a', keep: true, x: 1 }], rule: { keepOverdue: true } }; const o = B.stripKeep(src);
      return !('keep' in o.vars[0]) && o.vars[0].x === 1 && o.rule.keepOverdue === true && src.vars[0].keep === true; })(), '');

    const pk = B.pickables(authChar());
    ck('고를 것 — 탭 목록에 지도가 켜져 있고 명령 탭은 없다', pk.hasSchema && pk.tabs.some((t) => t.key === 'map' && t.on && t.label === '지도') && !pk.tabs.some((t) => t.key === 'commands')
      && pk.tabs.some((t) => t.key === 'shop' && !t.on), JSON.stringify(pk.tabs.map((t) => [t.key, t.on])));
    ck('고를 것 — id 목록 일곱 갈래와 항목 이름', pk.lists.map((l) => l.key).join(',') === 'vars,derived,checks,actions,directives,events,randomEvents'
      && pk.lists[0].items.some((i) => i.id === 'hp' && /체력/.test(i.label)) && pk.lists[5].items[0].id === 'e_dead', pk.lists.map((l) => `${l.key}:${l.items.length}`).join(','));
    ck('고를 것 — 로어는 폴더 아래 자식, 기본 판·프로필은 없다', (() => { const f = pk.lore.find((l) => l.isFolder && /오라리오 지리/.test(l.label));
      return !!f && f.children.length === 2 && pk.lore.some((l) => l.label === '세계관') && !pk.lore.some((l) => /⚙simcore/.test(l.label) || /⚙simcore/.test(l.key))
        && !pk.lore.some((l) => l.label === '길드'); })(), JSON.stringify(pk.lore.map((l) => [l.label, (l.children || []).length])));
    ck('고를 것 — 정규식', pk.regex.length === 2 && pk.regex[1].key === 'regex:지도 태그|editdisplay#0', JSON.stringify(pk.regex));

    // 지도 탭만 골라도 딸린 변수 셋 + allow가 따라온다 (known 식이 읽는 luck까지)
    const geoKey = pk.lore.find((l) => l.isFolder && /오라리오 지리/.test(l.label)).key;
    const picks = { tabs: ['map'], items: {}, lore: [geoKey], regex: ['regex:지도 태그|editdisplay#0'] };
    const built = B.buildPiece(authChar(), picks, INFO);
    const d = built.data;
    ck('★ 지도 조각 — 혼자 검증 통과', built.errors.length === 0, built.errors.join(' / '));
    ck('★ 딸린 것 — 위치·발자취·찾아낸 곳 + 공개 조건이 읽는 luck', ['location', 'visited', 'finds', 'luck'].every((id) => d.schema.vars.some((v) => v.id === id)) && d.schema.vars.length === 4, d.schema.vars.map((v) => v.id).join(','));
    ck('★ 딸린 것 — 그 변수들의 AI 허용 줄만', d.schema.updater.allow.map((a) => a.id).sort().join(',') === 'location,luck', JSON.stringify(d.schema.updater.allow));
    ck('딸린 것 목록(auto) — 화면의 회색 줄 재료', built.auto.vars.sort().join(',') === 'finds,location,luck,visited' && built.auto.allow.sort().join(',') === 'location,luck', JSON.stringify(built.auto));
    ck('조각 형식 — 2 · id · rev · 이름 · 설명', d.simcoreBundle === 2 && d.id === 'b_map00001' && d.rev === 1 && d.name === '오라리오 지도' && d.note === '원작 링크' && B.pieceShapeError(d) === null, '');
    ck('조각 — meta·simcore·상태 요약·상태창은 안 실린다', !('meta' in d.schema) && !('simcore' in d.schema) && !('promptState' in d.schema) && !('statusUI' in d.schema) && !('rules' in d.schema), Object.keys(d.schema).join(','));
    ck('조각 — 변수는 원본 순서', d.schema.vars.map((v) => v.id).join(',') === 'location,visited,finds,luck', d.schema.vars.map((v) => v.id).join(','));
    ck('로어 — 폴더를 고르면 자식 전부, 다른 폴더·세계관은 없다', d.lorebook.map((l) => l.comment).join(',') === '📁 오라리오 지리,길드,던전', d.lorebook.map((l) => l.comment).join(','));
    ck('로어 — 채팅별 표식(id·loreCache)은 뺀다', !d.lorebook.some((l) => 'id' in l || 'loreCache' in l), '');
    ck('정규식 — 고른 것만', d.regex.length === 1 && d.regex[0].comment === '지도 태그', '');

    // 자식 하나만 골라도 폴더가 따라온다
    const childKey = pk.lore.find((l) => l.isFolder && /오라리오 지리/.test(l.label)).children[1].key;
    const bChild = B.buildPiece(authChar(), { tabs: [], items: {}, lore: [childKey], regex: [] }, INFO);
    ck('로어 — 자식만 골라도 그 폴더 항목이 같이', bChild.data.lorebook.map((l) => l.comment).join(',') === '📁 오라리오 지리,던전' && !('schema' in bChild.data) && bChild.errors.length === 0, bChild.data.lorebook.map((l) => l.comment).join(','));

    // 액션 → 판정 → 파생 → 변수 (고정점) · keep 걷기
    const bAct = B.buildPiece(authChar(), { tabs: [], items: { actions: ['strike'], vars: ['hp'] }, lore: [], regex: [] }, INFO);
    const sa = bAct.data.schema;
    ck('★ 액션 check → 판정 → 파생 → 변수까지 고정점', sa.actions[0].id === 'strike' && sa.checks[0].id === 'atk' && sa.derived.map((x) => x.id).sort().join(',') === 'bonus,power'
      && ['str', 'luck', 'gold', 'hp'].every((id) => sa.vars.some((v) => v.id === id)) && bAct.errors.length === 0, JSON.stringify([sa.vars.map((v) => v.id), sa.derived.map((x) => x.id), bAct.errors]));
    ck('직접 고른 것은 auto에 없다 (hp는 고른 것, gold는 딸린 것)', !bAct.auto.vars.includes('hp') && bAct.auto.vars.includes('gold') && bAct.auto.checks.join() === 'atk', JSON.stringify(bAct.auto));
    ck('★ 🔒 keep은 실리지 않는다', !sa.vars.some((v) => 'keep' in v), JSON.stringify(sa.vars.find((v) => v.id === 'hp')));
    ck('변수의 cmd는 변수와 같이 간다', sa.vars.find((v) => v.id === 'gold').cmd === '돈', '');

    // 탭의 부분 규칙
    const bSt = B.buildPiece(authChar(), { tabs: ['status', 'presets'], items: {}, lore: [], regex: [] }, INFO);
    ck('상태창 탭 — groups + layout만 (customCSS·mode는 안 실린다)', P.stable(Object.keys(bSt.data.schema.statusUI).sort()) === P.stable(['groups', 'layout']) && bSt.data.schema.statusUI.layout === 'tabs', JSON.stringify(bSt.data.schema.statusUI));
    ck('시작 프리셋 탭 — setup.presets만 (setup.ai는 안 실린다)', P.stable(Object.keys(bSt.data.schema.setup)) === P.stable(['presets']) && bSt.data.schema.setup.presets[0].id === 'rich', JSON.stringify(bSt.data.schema.setup));
    ck('상태창이 쓰는 변수도 딸려 온다', ['hp', 'gold'].every((id) => bSt.data.schema.vars.some((v) => v.id === id)) && bSt.errors.length === 0, bSt.errors.join(' / '));

    // 혼자 검증 안 되는 조각 — 시간 절 없이 hour를 읽는 지시문
    const bLate = B.buildPiece(authChar(), { tabs: [], items: { directives: ['d_late'] }, lore: [], regex: [] }, INFO);
    ck('★ 혼자 검증 안 되는 조각은 오류를 돌려준다 (내보내기 거부 재료)', bLate.errors.length > 0 && /hour/.test(bLate.errors.join(' ')), bLate.errors.join(' / '));
    const bLate2 = B.buildPiece(authChar(), { tabs: ['time'], items: { directives: ['d_late'] }, lore: [], regex: [] }, INFO);
    ck('시간 탭을 같이 고르면 통과', bLate2.errors.length === 0 && !!bLate2.data.schema.time, bLate2.errors.join(' / '));

    // 빈 조각 · note 자르기
    const bEmpty = B.buildPiece(authChar(), { tabs: [], items: {}, lore: [], regex: [] }, INFO);
    ck('아무것도 안 고르면 오류', bEmpty.errors.length > 0, JSON.stringify(bEmpty));
    const bNote = B.buildPiece(authChar(), picks, { ...INFO, note: 'ㄱ'.repeat(300), name: '' });
    ck('설명은 200자까지 · 이름이 비면 봇 이름', bNote.data.note.length === 200 && bNote.data.name === '오라리오', `${bNote.data.note.length} / ${bNote.data.name}`);

    // 지난번에 낸 파일에서 구성 되살리기
    const again = B.buildPiece(authChar(), B.picksFromPiece(d), INFO);
    ck('★ 지난 파일로 구성 되살리기 — 같은 조각이 다시 나온다', P.stable(again.data) === P.stable(d), JSON.stringify(B.picksFromPiece(d)));
    const pkAct = B.picksFromPiece(bAct.data);
    ck('되살린 구성 — id 목록은 항목으로', pkAct.items.actions.join() === 'strike' && pkAct.items.checks.join() === 'atk' && pkAct.tabs.length === 0, JSON.stringify(pkAct));

    // 만든 조각이 빈 봇에 실제로 들어간다 (①②③ 맞물림)
    const blank = { chaId: 'c-blank', name: '빈 봇', globalLore: [], customscript: [] };
    const pIn = B.planPiece({ char: blank, data: d, base: null });
    ck('★ 만든 지도 조각이 빈 봇에 설치된다', pIn.ok && !pIn.schemaErrors.length && pIn.lines.every((l) => l.kind === 'add'), pIn.error || (pIn.schemaErrors || []).join(' / '));
  }

  // ── ⑦ 최종 검토에서 나온 것 (코어) ──
  {
    // 치명 — 남이 준 조각의 __proto__ 키가 Object.prototype을 고친다 (파일을 고르기만 해도)
    const evil1 = JSON.parse('{"simcoreBundle":2,"id":"b_evil0001","schema":{"__proto__":{"keep":true}}}');
    const evil2 = JSON.parse('{"simcoreBundle":2,"id":"b_evil0002","schema":{"map":{"__proto__":{"polluted":1}},"vars":[{"id":"zz","type":"int","init":0}]}}');
    const evil3 = JSON.parse('{"simcoreBundle":2,"id":"b_evil0003","schema":{"vars":[{"id":"zz","type":"int","init":0,"constructor":{"prototype":{"polluted":1}}}]}}');
    let pe1, pe2, pe3;
    try { pe1 = B.planPiece({ char: hostChar(), data: evil1, base: null }); pe2 = B.planPiece({ char: hostChar(), data: evil2, base: null }); pe3 = B.planPiece({ char: hostChar(), data: evil3, base: null }); } catch (e) { pe1 = pe1 || { threw: e.message }; }
    const clean = ({}).keep === undefined && ({}).polluted === undefined;
    delete Object.prototype.keep; delete Object.prototype.polluted;
    ck('★★ __proto__ 키가 든 조각 — Object.prototype을 안 건드린다', clean, '오염됨');
    ck('★★ __proto__·constructor·prototype 키가 든 조각은 거절한다 (깊은 곳도)', pe1 && pe1.ok === false && pe2 && pe2.ok === false && pe3 && pe3.ok === false && /못 쓰는 키/.test(pe1.error || ''), JSON.stringify([pe1, pe2 && pe2.error, pe3 && pe3.error]));
    ck('위험한 id는 거절', !!B.pieceShapeError({ simcoreBundle: 2, id: '__proto__', lorebook: [{ comment: 'x' }] }) && !!B.pieceShapeError({ simcoreBundle: 2, id: 'constructor', lorebook: [{ comment: 'x' }] })
      && B.validBundleId('b_ok000001') && !B.validBundleId('a b') && !B.validBundleId('__proto__'), '');
    const pLoreProto = B.planPiece({ char: hostChar(), data: { simcoreBundle: 2, id: 'b_lp000001', rev: 1, name: 'n', lorebook: [{ comment: '__proto__', content: 'x' }, { comment: 'constructor', content: 'y' }] }, base: null,
      choices: JSON.parse('{"__proto__":"mine"}') });
    ck('로어 이름이 __proto__여도 평범한 단위로 다룬다', pLoreProto.ok && pLoreProto.lines.length === 2 && pLoreProto.lines.every((l) => l.kind === 'add' && l.choice === 'bundle') && ({}).polluted === undefined, JSON.stringify(pLoreProto.lines));
    const fpProto = B.fingerprintOf({ simcoreBundle: 2, id: 'b_lp000001', lorebook: [{ comment: '__proto__', content: 'x' }] });
    ck('지문 — __proto__ 이름도 자기 열쇠로', Object.keys(fpProto).length === 1 && Object.getPrototypeOf(fpProto) === null || Object.prototype.hasOwnProperty.call(fpProto, 'lore:__proto__#0'), JSON.stringify(Object.keys(fpProto)));

    // 중요 — 모양이 어긋난 조각이 절을 통째로 비운다
    const shapeBad = (schema) => { try { return B.planPiece({ char: hostChar(), data: { simcoreBundle: 2, id: 'b_shape001', rev: 1, name: 'n', schema }, base: null }); } catch (e) { return { threw: e.message }; } };
    ck('★ 모양 어긋남 — rules: null / statusUI: 5 / updater: 7 / rules: "x"는 거절 (던지지 않는다)', [{ rules: null, vars: [{ id: 'a', type: 'int', init: 0 }] }, { statusUI: 5 }, { updater: 7 }, { rules: 'x' }, { setup: 'x' }]
      .every((s) => { const r = shapeBad(s); return r.ok === false && /모양/.test(r.error || ''); }), JSON.stringify([shapeBad({ rules: null, vars: [{ id: 'a', type: 'int', init: 0 }] }), shapeBad({ statusUI: 5 }), shapeBad({ rules: 'x' })]));
    ck('★ 모양 어긋남 — id 목록 자리에 id 없는 항목·null·겹친 id', [[{ id: 'a', type: 'int', init: 0 }, null], [{ label: 'id 없음' }], [{ id: 'a', type: 'int', init: 0 }, { id: 'a', type: 'int', init: 1 }], 'x']
      .every((vars) => { const r = shapeBad({ vars }); return r.ok === false && /모양/.test(r.error || ''); }), JSON.stringify(shapeBad({ vars: [{ id: 'a' }, null] })));
    ck('모양 — 객체 ↔ 배열 둘 다 되는 자리(liveChoices)는 충돌 줄로 받는다', (() => { const h = cp(HOST); h.liveChoices = { when: 'hp > 0', tags: [] };
      const r = B.planPiece({ char: hostChar(h), data: { simcoreBundle: 2, id: 'b_shape002', rev: 1, name: 'n', schema: { liveChoices: [{ when: 'hp > 1', tags: [] }] } }, base: null });
      return r.ok === true && r.lines.length === 1 && r.lines[0].kind === 'conflict'; })(), '');

    // 중요 — 같은 이름 로어의 #n 짝짓기
    const twoNotes = (rev, a, b) => ({ simcoreBundle: 2, id: 'b_two00001', rev, name: '노트 둘', lorebook: [{ comment: '노트', content: a }, { comment: '노트', content: b }] });
    { // 경우 A — 받는 사람이 앞 것을 지웠고 제작자는 앞 것만 고쳤다
      const c = hostChar();
      const base = install(c, twoNotes(1, 'A', 'B'), null);
      c.globalLore = c.globalLore.filter((l) => !(l.comment === '노트' && l.content === 'A'));
      const p = B.planPiece({ char: c, data: twoNotes(2, 'A2', 'B'), base });
      const out = B.applyPlanToChar(cp(c), p);
      ck('★ 같은 이름 둘 — 안 건드린 뒤 것이 앞 것의 새 판에 덮이지 않는다', out.globalLore.some((l) => l.comment === '노트' && l.content === 'B') && !p.lines.some((l) => l.key === 'lore:노트#1'),
        JSON.stringify([p.lines.map((l) => `${l.kind}:${l.key}`), out.globalLore.filter((l) => l.comment === '노트').map((l) => l.content)]));
      ck('같은 이름 둘 — 내가 지운 앞 것은 "내가 지웠는데 제작자가 고침" 줄', p.lines.length === 1 && p.lines[0].key === 'lore:노트#0' && p.lines[0].kind === 'conflict' && p.lines[0].def === 'bundle', JSON.stringify(p.lines));
    }
    { // 경우 B — 내가 쓴 같은 이름 항목이 조각 항목보다 앞에 있다
      const c = hostChar();
      const one = (rev, a) => ({ simcoreBundle: 2, id: 'b_one00001', rev, name: '노트 하나', lorebook: [{ comment: '노트', content: a }] });
      const base = install(c, one(1, 'A'), null);
      c.globalLore.splice(1, 0, { comment: '노트', content: '내가 쓴 노트' });   // 조각 항목보다 앞에
      const p = B.planPiece({ char: c, data: one(2, 'A2'), base });
      const out = B.applyPlanToChar(cp(c), p);
      const notes = out.globalLore.filter((l) => l.comment === '노트').map((l) => l.content);
      ck('★ 같은 이름 — 내가 쓴 항목은 그대로, 조각 것만 새 판으로', notes.join('|') === '내가 쓴 노트|A2' && p.lines.length === 1 && p.lines[0].kind === 'update', JSON.stringify([p.lines.map((l) => `${l.kind}:${l.key}`), notes]));
    }
    { // 정규식도 같은 규칙
      const c = hostChar();
      const rx = (rev, o) => ({ simcoreBundle: 2, id: 'b_rx000001', rev, name: '정규식', regex: [{ comment: '에셋 표시', type: 'editdisplay', in: 'p', out: o }] });
      const base = install(c, rx(1, 'P1'), null);   // 카드에 같은 이름·종류가 이미 있다(in:'a') → 충돌, 기본 번들 것으로 덮였다
      c.customscript.unshift({ comment: '에셋 표시', type: 'editdisplay', in: 'mine', out: 'mine' });
      const p = B.planPiece({ char: c, data: rx(2, 'P2'), base });
      const out = B.applyPlanToChar(cp(c), p);
      ck('같은 이름 정규식 — 앞에 끼운 내 것은 그대로', out.customscript[0].in === 'mine' && out.customscript.some((r) => r.out === 'P2'), JSON.stringify(out.customscript));
    }

    // 중요 — 전체 번들(형식 1)의 지문을 조각이 쓰지 않는다
    const wholeBase = { format: 1, rev: 7, units: { 'lore:세계관#0': B.unitHash({ comment: '세계관', content: '내 세계관' }, 'lore'), 'schema:meta.name': 'x', 'regex:에셋 표시|editdisplay#0': B.unitHash({ comment: '에셋 표시', type: 'editdisplay', in: 'a', out: 'b' }, 'regex') } };
    const pWB = B.planPiece({ char: hostChar(), data: { simcoreBundle: 2, id: 'b_whole001', rev: 8, name: '가짜 조각', lorebook: [{ comment: '새 로어', content: 'n' }] }, base: wholeBase });
    ck('★ 전체 번들의 지문은 조각 판정에 안 쓴다 (내 로어·정규식이 "제작자 삭제"로 안 뜬다)', pWB.ok && pWB.lines.length === 1 && pWB.lines[0].kind === 'add' && pWB.installedRev === null, JSON.stringify(pWB.lines));

    // 사소 — 🔒 변수의 AI 허용 줄을 조각이 새로 넣지 않는다
    const hostLk = cp(HOST); hostLk.vars.push({ id: 'location', label: '위치', type: 'enum', enum: ['길드', '던전', '바벨'], init: '길드', keep: true });
    const pLk = B.planPiece({ char: hostChar(hostLk), data: piece(1), base: null });
    ck('🔒 변수의 AI 허용 줄 — 내 판에 없어도 조각이 새로 넣지 않는다', line(pLk, 'schema:updater.allow[location]')?.kind === 'locked' && line(pLk, 'schema:updater.allow[location]').choice === 'mine', JSON.stringify(line(pLk, 'schema:updater.allow[location]')));

    // 사소 — 조각 로어에 든 프로필 항목은 받지 않는다
    const pPf = B.planPiece({ char: hostChar(), data: { simcoreBundle: 2, id: 'b_pf000001', rev: 1, name: 'n', lorebook: [{ comment: '⚙simcore:마법사', content: '{}' }, { comment: '⚙simcore', content: '{}' }, { comment: '평범', content: 'x' }] }, base: null });
    ck('조각의 로어에 든 ⚙simcore·프로필 항목은 무시', pPf.ok && pPf.lines.length === 1 && pPf.lines[0].key === 'lore:평범#0' && Object.keys(pPf.fingerprint).join() === 'lore:평범#0', JSON.stringify(pPf.lines.map((l) => l.key)));

    // 사소 — 검증 오류가 번호로만 와도 그 줄을 짚는다
    const pIdx = B.planPiece({ char: hostChar(), data: { simcoreBundle: 2, id: 'b_idx00001', rev: 1, name: 'n', schema: { directives: [{ id: 'd_bad', when: 'hp >', text: 'x' }] } }, base: null });
    ck('검증 오류의 [번호]를 그 항목의 줄로', pIdx.schemaErrors.length > 0 && pIdx.errorKeys.includes('schema:directives[d_bad]'), JSON.stringify([pIdx.schemaErrors, pIdx.errorKeys]));

    // 순서 — 스키마 목록의 새 항목은 번들에서 바로 앞이던 항목 뒤에
    const dirs = (rev, ids) => ({ simcoreBundle: 2, id: 'b_dir00001', rev, name: '지시문', schema: { directives: ids.map((id) => ({ id, when: 'hp > 0', text: id })) } });
    const hostDir = cp(HOST); hostDir.directives = [{ id: 'mine1', when: 'hp > 0', text: 'm1' }];
    const cDir = hostChar(hostDir);
    const baseDir = install(cDir, dirs(1, ['a1', 'a3']), null);
    editSchema(cDir, (s) => { s.directives.push({ id: 'mine2', when: 'hp > 0', text: 'm2' }); });
    install(cDir, dirs(2, ['a1', 'a2', 'a3']), baseDir);
    ck('★ 스키마 목록 — 새 항목은 번들에서 바로 앞이던 항목 뒤에 (내 순서는 그대로)', schemaOf(cDir).directives.map((d) => d.id).join(',') === 'mine1,a1,a2,a3,mine2', schemaOf(cDir).directives.map((d) => d.id).join(','));

    // 제작자 쪽 — 사라진 고르기 · 같은 이름 로어 되살리기 · 랜덤 이벤트 항목만
    const bMiss = B.buildPiece(authChar(), { tabs: ['map', 'nope_tab'], items: { vars: ['hp', 'gone_var'] }, lore: ['lore:세계관#0', 'lore:없어진 로어#0'], regex: ['regex:없음|x#0'] }, INFO);
    ck('★ 못 찾은 고르기 — 말없이 빼지 않고 missing과 오류로', bMiss.missing.length === 4 && bMiss.errors.some((e) => /못 찾/.test(e)) && ['gone_var', '없어진 로어', '없음', 'nope_tab'].every((w) => bMiss.missing.some((m) => m.includes(w))), JSON.stringify(bMiss.missing));
    ck('못 찾은 고르기 — 다 찾으면 missing은 빈다', B.buildPiece(authChar(), { tabs: ['map'], items: {}, lore: ['lore:세계관#0'], regex: [] }, INFO).missing.length === 0, '');
    const dupChar = authChar();
    dupChar.globalLore.push({ comment: '던전', key: '던전2', content: '비공개가 아닌 배포용 던전' });   // 폴더 안 '던전'(#0)과 같은 이름, 뒤에 하나 더
    const bDup = B.buildPiece(dupChar, { tabs: [], items: {}, lore: ['lore:던전#1'], regex: [] }, INFO);
    const backPicks = B.picksFromPiece(bDup.data, dupChar);
    ck('★ 지난 파일로 되살리기 — 같은 이름 로어는 내용으로 찾는다 (조각 안 번호 #0이 아니라 내 봇의 #1)', bDup.data.lorebook.length === 1 && backPicks.lore.join() === 'lore:던전#1', JSON.stringify(backPicks.lore));
    const sigs = B.pickSigs(dupChar, { lore: ['lore:던전#1'], regex: ['regex:지도 태그|editdisplay#0'] });
    const shifted = cp(dupChar);
    shifted.globalLore.splice(1, 0, { comment: '던전', key: '던전0', content: '새로 끼운 같은 이름' });   // 앞에 하나 더 — 번호가 밀린다
    const moved = B.relocatePicks(shifted, { tabs: [], items: {}, lore: ['lore:던전#1'], regex: ['regex:지도 태그|editdisplay#0'] }, sigs);
    ck('★ 저장된 구성 — 같은 이름이 앞에 끼어 번호가 밀려도 내용으로 따라간다', moved.lore.join() === 'lore:던전#2' && moved.regex.join() === 'regex:지도 태그|editdisplay#0', JSON.stringify(moved));
    const authRe = cp(AUTH); authRe.rules.randomEvents = { chancePerTurn: 0.1, table: [{ id: 're_rain', notify: '비가 온다', weight: 1 }] };
    const reChar = authChar(); reChar.globalLore[0].content = JSON.stringify(authRe);
    ck('픽스처 — 랜덤 이벤트 든 스키마 검증 통과', validateSchema(cp(authRe)).ok, JSON.stringify(validateSchema(cp(authRe)).errors));
    const bRe = B.buildPiece(reChar, { tabs: [], items: { randomEvents: ['re_rain'] }, lore: [], regex: [] }, INFO);
    ck('랜덤 이벤트 항목만 골라도 내보낼 수 있다 (발동 확률은 받는 봇 것)', bRe.errors.length === 0 && !('chancePerTurn' in bRe.data.schema.rules.randomEvents), JSON.stringify(bRe.errors));
  }

  // ── ④ 가짜 리수 — 넣기 · 되돌리기 · 지문 (빌드된 simcore.plugin.js를 굴린다) ──
  const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
  const world = { char: null };
  const store = new Map();
  let failBaseWrites = false, failKeys = false;
  {
    world.char = { ...hostChar(), chaId: 'c-recv', triggerscript: [] };
    global.Risuai = {
      getCharacter: async () => cp(world.char),
      setCharacter: async (c) => { world.char = cp(c); },
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
      getChatFromIndex: async () => ({ id: 'ch1', message: [] }), setChatToIndex: async () => {},
      registerButton: async () => {}, unregisterUIPart: async () => {}, registerSetting: async () => {},
      addRisuReplacer: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
      addRisuScriptHandler: async (k, fn) => { (global.__hooks ??= {})[k] = fn; },
      registerBodyIntercepter: async () => ({ id: 'x' }),
      showContainer: async () => {}, alert: async () => {}, getArgument: async () => 'off',
      onUnload: async (fn) => { global.__unload = fn; }, runLLMModel: async () => ({ success: false }),
      pluginStorage: {
        getItem: async (k) => (store.has(k) ? store.get(k) : null),
        setItem: async (k, v) => { if (failBaseWrites && k.startsWith('sim:bundle-base:')) throw new Error('저장소 가득'); store.set(k, v); },
        removeItem: async (k) => { store.delete(k); },
        keys: async () => { if (failKeys) throw new Error('저장소 응답 없음'); return [...store.keys()]; },
      },
    };
    const el = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
      children: [], appendChild() {}, append() {}, remove() {}, setAttribute() {}, addEventListener() {},
      querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : undefined), set: () => true });
    global.document = { createElement: el, getElementById: () => null, body: el(), querySelector: () => null, querySelectorAll: () => [], head: el(), addEventListener() {} };
    global.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
    (0, eval)(src);
    await sleep(150);
    const H = globalThis.__simcoreBundle;
    ck('배수구 — 넣기 흐름 함수들', !!H && ['planFor', 'pieceApply', 'wholeApply', 'revert', 'bases', 'kindOf', 'planHtml'].every((k) => typeof H[k] === 'function'), H ? Object.keys(H).join(',') : '없음');
    const baseKeys = () => [...store.keys()].filter((k) => k.startsWith('sim:bundle-base:c-recv:'));
    const bkKeys = () => [...store.keys()].filter((k) => k.startsWith('sim:bundle-backup:c-recv:')).sort();
    const wSchema = () => schemaOf(world.char);

    // 형식 가리기
    ck('번들 칸 — 조각 / 전체 / 스키마 파일 / 엉뚱한 파일', H.kindOf(piece(1)).kind === 'piece' && H.kindOf({ simcoreBundle: 1, lorebook: [{ comment: 'x' }] }).kind === 'whole'
      && /JSON 관리자/.test(H.kindOf(cp(HOST)).error || '') && /개조 번들 파일이 아님/.test(H.kindOf({ a: 1 }).error || ''), JSON.stringify([H.kindOf(cp(HOST)), H.kindOf({ a: 1 })]));

    // 조각 넣기
    const plan1 = await H.planFor(piece(1));
    ck('계획 — 캐릭터를 읽어 세운다 (전부 추가, 아직 아무것도 안 바뀜)', plan1.ok && plan1.lines.every((l) => l.kind === 'add') && !world.char.globalLore.some((l) => l.comment === '던전') && !baseKeys().length, '');
    const html1 = H.planHtml(plan1, {});
    ck('요약 화면 — 요약 줄(이름·rev·갈래 개수)', html1.includes('오라리오 지도') && html1.includes('r1') && html1.includes('추가 ' + plan1.lines.length), html1.slice(0, 200));
    ck('요약 화면 — 설명과 단추', html1.includes('원작 링크') && html1.includes('data-bkey="schema:map.locVar"') && html1.includes('data-bpick="mine"') && html1.includes('번들 넣기'), html1.slice(0, 300));
    const r1 = await H.pieceApply(piece(1));
    ck('★ 조각 넣기 — 캐릭터에 병합', r1.ok && world.char.globalLore.some((l) => l.comment === '던전') && wSchema().map?.locVar === 'location' && world.char.customscript.length === 3, r1.html);
    ck('★ 조각 넣기 — 기준 지문 저장 (rev·단위 해시)', (() => { const k = 'sim:bundle-base:c-recv:b_map00001'; if (!store.has(k)) return false; const b = JSON.parse(store.get(k));
      return b.id === 'b_map00001' && b.rev === 1 && b.name === '오라리오 지도' && typeof b.units['schema:map.locVar'] === 'string' && typeof b.at === 'number'; })(), baseKeys().join(','));
    ck('조각 넣기 — 적용 전 백업(지문 사본 포함)', bkKeys().length === 1 && (() => { const b = JSON.parse(store.get(bkKeys()[0])); return Array.isArray(b.lorebook) && b.bases && typeof b.bases === 'object' && !Object.keys(b.bases).length; })(), bkKeys().join(','));
    ck('조각 넣기 — 시스템이 병합된 판으로 돈다 (지도 버튼 재료)', (await H.bases())['b_map00001']?.rev === 1 && /넣기 완료/.test(r1.html), r1.html);

    // r2 — 내 수정은 남고 번들 수정만
    world.char.globalLore.find((l) => l.comment === '던전').content = '내가 고친 던전';
    const beforeR2 = cp(world.char);
    const r2x = await H.pieceApply(piece(2, (d) => { d.schema.map.label = '오라리오 전도'; }));
    ck('★ r2 — 번들 수정만 반영, 내 수정 유지, 지문 rev 2', r2x.ok && wSchema().map.label === '오라리오 전도' && world.char.globalLore.find((l) => l.comment === '던전').content === '내가 고친 던전'
      && JSON.parse(store.get('sim:bundle-base:c-recv:b_map00001')).rev === 2, r2x.html);
    ck('r2 — 요약에 설치된 판', /설치된 판 r1/.test(r2x.html) && /번들 수정 1/.test(r2x.html) && /내 수정 유지 1/.test(r2x.html), r2x.html);

    // 되돌리기 — 로어북·정규식·지문
    const rv = await H.revert();
    ck('★ 되돌리기 — 로어북·정규식이 r2 전으로', rv.ok && P.stable(world.char.globalLore) === P.stable(beforeR2.globalLore) && P.stable(world.char.customscript) === P.stable(beforeR2.customscript), rv.html);
    ck('★ 되돌리기 — 지문도 r1으로', JSON.parse(store.get('sim:bundle-base:c-recv:b_map00001')).rev === 1 && bkKeys().length === 1, baseKeys().join(','));

    // 검증 실패 조각 — 무변화
    const snapBad = JSON.stringify(world.char); const bkN = bkKeys().length;
    const rBad = await H.pieceApply({ ...piece(1, (d) => { d.schema.map.locVar = 'nowhere'; }), id: 'b_bad00001' });
    ck('★ 검증 실패 조각 — 캐릭터·백업·지문 무변화, 오류를 보여 준다', rBad.ok === false && JSON.stringify(world.char) === snapBad && bkKeys().length === bkN && !store.has('sim:bundle-base:c-recv:b_bad00001') && /nowhere/.test(rBad.html), rBad.html);

    // 지문 저장 실패 — 적용은 되고 알린다
    failBaseWrites = true;
    const rFp = await H.pieceApply({ simcoreBundle: 2, id: 'b_fp000001', rev: 1, name: '로어만', lorebook: [{ comment: '추가 로어', content: 'x' }] });
    failBaseWrites = false;
    ck('검토 초점 4 — 지문 저장이 실패해도 적용은 되고 알린다', rFp.ok && world.char.globalLore.some((l) => l.comment === '추가 로어') && /처음 넣는 것처럼/.test(rFp.html) && !store.has('sim:bundle-base:c-recv:b_fp000001'), rFp.html);

    // id 없는 옛 번들 — 결과는 applyBundleToChar와 글자까지 같고, 조각 지문은 지워진다(백업에 사본)
    const oldBundle = { simcoreBundle: 1, name: '옛 번들', lorebook: [{ comment: '⚙simcore', key: ' __simcore_never__', content: JSON.stringify(HOST) }, { comment: '새 세계관', content: 'N' }],
      regex: [{ comment: '교체 정규식', type: 'editdisplay', in: 'q', out: 'w' }] };
    const expectOld = H.applyBundleToChar(cp(world.char), cp(oldBundle));
    const rOld = await H.wholeApply(cp(oldBundle));
    ck('★ 옛 번들(id 없음) — 캐릭터 결과가 지금 동작과 글자까지 같다', rOld.ok && JSON.stringify(world.char.globalLore) === JSON.stringify(expectOld.globalLore)
      && JSON.stringify(world.char.customscript) === JSON.stringify(expectOld.customscript), rOld.html);
    ck('★ 옛 번들 — 지문을 만들지 않고, 통째 교체라 조각 지문은 지운다', baseKeys().length === 0, baseKeys().join(','));
    ck('옛 번들 — 백업에 지워진 지문의 사본', (() => { const b = JSON.parse(store.get(bkKeys()[bkKeys().length - 1])); return b.bases && b.bases['b_map00001'] && b.bases['b_map00001'].rev === 1; })(), '');
    ck('옛 번들 — 보고 문구는 그대로', /교체 완료/.test(rOld.html) && /시스템 인식됨/.test(rOld.html), rOld.html);

    // 통째 교체 뒤 같은 조각이 다시 들어간다
    const pAgain = await H.planFor(piece(1));
    ck('★ 통째 교체 뒤 조각 다시 넣기 — "내가 지움"이 아니라 추가', pAgain.lines.length > 0 && pAgain.lines.every((l) => l.kind === 'add'), pAgain.lines.map((l) => l.kind).join(','));
    const rAgain = await H.pieceApply(piece(1));
    ck('통째 교체 뒤 조각 다시 넣기 — 들어간다', rAgain.ok && wSchema().map?.locVar === 'location', rAgain.html);

    // 되돌리기가 지워진 지문을 살린다 (통째 교체 되돌리기)
    await H.wholeApply(cp(oldBundle));
    ck('통째 교체 — 다시 지문이 비고', baseKeys().length === 0, '');
    await H.revert();
    ck('★ 통째 교체 되돌리기 — 조각 지문이 돌아온다', store.has('sim:bundle-base:c-recv:b_map00001') && wSchema().map?.locVar === 'location', baseKeys().join(','));

    // id 있는 전체 번들 — 지문 저장 (1단계는 저장만, 결과는 통째 교체)
    const rW = await H.wholeApply({ ...cp(oldBundle), id: 'b_whole001', rev: 5 });
    ck('★ id 있는 전체 번들 — 통째 교체 + 자기 지문만 남는다', rW.ok && baseKeys().join(',') === 'sim:bundle-base:c-recv:b_whole001' && (() => { const b = JSON.parse(store.get(baseKeys()[0]));
      return b.rev === 5 && typeof b.units['schema:vars[hp]'] === 'string' && typeof b.units['lore:새 세계관#0'] === 'string' && typeof b.units['regex:교체 정규식|editdisplay#0'] === 'string'; })(), baseKeys().join(','));
    ck('백업은 최근 3개까지', bkKeys().length <= 3, String(bkKeys().length));

    // 정적 핀 — 화면 쪽
    ck('단추 이름 [번들 넣기] · 옛 이름 없음', src.includes('<button id="sc-bundle-apply">번들 넣기</button>') && !src.includes('>번들 가져와 교체<'), '');
    ck('[처음부터 다시 넣기] · 더티 작업본 멈춤 단추', src.includes('처음부터 다시 넣기') && src.includes('작업본 버리고 계속') && src.includes('editorDiffersFromInstalled()'), '');
    ck('[캐릭터에서 제거]가 번들 지문을 지운다', /sc-uninstall'\)\.onclick[\s\S]{0,1600}clearBundleBases\(char\)/.test(src), '');
    ck('낮은 rev 경고 문구', src.includes('설치된 판보다 낮은 판이에요'), '');

    // ── ⑤ 내보내기 — 전체 번들 id·rev · 조각 레시피 ──
    ck('배수구 — 내보내기 함수들', ['exportWhole', 'exportPiece', 'recipes', 'recipeFromFile', 'chooserHtml', 'pickerHtml'].every((k) => typeof H[k] === 'function'), Object.keys(H).join(','));
    await H.pieceApply(piece(1));
    { // 제작자 메모(🔒·📌)를 걸어 둔다 — 배포본엔 안 실려야 한다
      const e = world.char.globalLore.find((l) => l.comment === '⚙simcore'); const s = JSON.parse(e.content);
      s.vars.find((v) => v.id === 'hp').keep = true; s.meta.notes = '제작자 메모'; e.content = JSON.stringify(s);
    }
    const w1 = await H.exportWhole();
    const w2 = await H.exportWhole();
    ck('★ 전체 내보내기 — 형식 1 그대로 + id + rev', w1.data.simcoreBundle === 1 && /^b_[0-9a-z]{8}$/.test(w1.data.id) && w1.data.rev === 1 && Array.isArray(w1.data.lorebook) && Array.isArray(w1.data.regex)
      && H.bundleShapeError(w1.data) === null, JSON.stringify(Object.keys(w1.data)));
    ck('★ 전체 내보내기 — 다시 내면 같은 id에 rev +1', w2.data.id === w1.data.id && w2.data.rev === 2, `${w2.data.id} r${w2.data.rev}`);
    const wS = JSON.parse(w1.data.lorebook.find((l) => l.comment === '⚙simcore').content);
    ck('★ 전체 내보내기 — 🔒 keep·📌 지침은 안 실린다 (캐릭터의 것은 그대로)', !wS.vars.some((v) => 'keep' in v) && wS.meta.notes === undefined && wSchema().vars.find((v) => v.id === 'hp').keep === true, JSON.stringify(wS.vars.find((v) => v.id === 'hp')));
    ck('전체 내보내기 — 레시피에 남는다', (await H.recipes()).some((r) => r.kind === 'whole' && r.id === w1.data.id && r.rev === 2), JSON.stringify(await H.recipes()));

    const picksMap = { tabs: ['map'], items: {}, lore: ['lore:📁 지리#0'], regex: [] };
    const e1 = await H.exportPiece(picksMap, { name: '지도 조각', note: '원작 링크' });
    ck('★ 조각 내보내기 — 형식 2 · 새 id · r1 · 딸린 변수', e1.errors.length === 0 && e1.data.simcoreBundle === 2 && /^b_[0-9a-z]{8}$/.test(e1.data.id) && e1.data.rev === 1 && e1.data.name === '지도 조각'
      && e1.data.schema.vars.some((v) => v.id === 'location') && e1.data.lorebook.length === 2, JSON.stringify(e1.errors));
    const e2 = await H.exportPiece(picksMap, { id: e1.data.id, name: '지도 조각', note: '원작 링크' });
    ck('★ 조각 다시 내보내기 — 같은 id에 rev +1 (받는 쪽이 업데이트로 본다)', e2.data.id === e1.data.id && e2.data.rev === 2, `${e2.data.id} r${e2.data.rev}`);
    const rc = (await H.recipes()).find((r) => r.id === e1.data.id);
    ck('조각 레시피 — 구성·이름·설명·rev', !!rc && rc.kind === 'piece' && rc.rev === 2 && rc.name === '지도 조각' && rc.note === '원작 링크' && rc.picks.tabs.join() === 'map' && rc.picks.lore.join() === 'lore:📁 지리#0', JSON.stringify(rc));
    const eBad = await H.exportPiece({ tabs: [], items: {}, lore: [], regex: [] }, { id: e1.data.id, name: '지도 조각' });
    ck('★ 혼자 검증 안 되는(빈) 조각 — 내보내기 거부, rev는 안 오른다', eBad.errors.length > 0 && (await H.recipes()).find((r) => r.id === e1.data.id).rev === 2, JSON.stringify(eBad.errors));

    // 기기를 옮겨 레시피가 없다 — 지난 파일로 되살린다
    store.delete('sim:bundle-recipe:c-recv');
    const back = await H.recipeFromFile(cp(e2.data));
    ck('★ 지난 파일로 구성 되살리기 — 같은 id·rev·구성', back.recipe && back.recipe.id === e1.data.id && back.recipe.rev === 2 && back.recipe.kind === 'piece' && back.recipe.picks.tabs.join() === 'map'
      && (await H.recipes()).length === 1, JSON.stringify(back));
    const e3 = await H.exportPiece(back.recipe.picks, { id: back.recipe.id, name: back.recipe.name, note: back.recipe.note });
    ck('되살린 구성으로 내보내기 — r3', e3.errors.length === 0 && e3.data.rev === 3 && e3.data.id === e1.data.id, `${e3.data.rev}`);
    ck('지난 파일 — 전체 번들도 id를 잇는다 · 엉뚱한 파일은 이유', (await H.recipeFromFile(cp(w2.data))).recipe?.id === w1.data.id && !!(await H.recipeFromFile({ simcoreBundle: 1, lorebook: [{ comment: 'x' }] })).error, '');

    // 화면 재료
    const recipesNow = await H.recipes();
    const ch = H.chooserHtml(recipesNow);
    ck('내보내기 고르기 — 전체 / 조각 고르기 / 지난 조각 / 파일로 되살리기', ch.includes('data-bexp="whole"') && ch.includes('data-bexp="piece"') && ch.includes('지도 조각') && ch.includes(`data-bexp-recipe="${e1.data.id}"`) && ch.includes('data-bexp="file"'), ch.slice(0, 300));
    const pkNow = B.pickables(world.char);
    const builtNow = B.buildPiece(world.char, picksMap, { id: e1.data.id, rev: 4, name: '지도 조각' });
    const ph = H.pickerHtml(pkNow, builtNow, { picks: picksMap, name: '지도 조각', note: '', rev: 4, open: [] });
    ck('조각 고르기 화면 — 탭·목록·로어 체크, 딸린 것은 회색(disabled), 검증 결과, 내보내기 단추', ph.includes('data-ptab="map"') && ph.includes('data-plist="vars"') && ph.includes('data-pid="location"')
      && /data-pid="location"[^>]*disabled/.test(ph) && ph.includes('data-plore="lore:📁 지리#0"') && ph.includes('이 조각만으로 설치돼요') && ph.includes('내보내기 r4') && ph.includes('같이 따라가는 것'), ph.slice(0, 400));
    const phBad = H.pickerHtml(pkNow, B.buildPiece(world.char, { tabs: [], items: {}, lore: [], regex: [] }, { id: 'b_x0000000', rev: 1, name: 'x' }), { picks: { tabs: [], items: {}, lore: [], regex: [] }, name: 'x', note: '', rev: 1, open: [] });
    ck('조각 고르기 화면 — 검증에 막히면 이유를 보이고 내보내기 단추가 잠긴다', phBad.includes('고른 것이 없어요') && /id="sc-piece-export"[^>]*disabled/.test(phBad), phBad.slice(-300));

    // 정적 핀 — 안내문
    ck('번들 카드 안내문 — 조각·내 것 남기기 설명', src.includes('🧩 조각') && src.includes('원하는 것만 골라') && !src.includes('[가져와 교체] 한 번으로'), '');
    ck('JSON 관리자에 번들을 넣으면 번들 칸을 가리킨다', src.includes('번들 파일이에요 — 여기(스키마 JSON)가 아니라'), '');

    // ── ⑥ 패널 배선 — 번들 카드의 단추·위임을 가짜 DOM에서 눌러 본다 (배선 구간을 소스에서 떼어 돌린다, 규칙 #8) ──
    {
      const a = src.indexOf('    // ── 개조 번들 (v1.0.5) · 🧩 조각 (v1.25.0) ──');
      const b = src.lastIndexOf('\n  }\n', src.indexOf('  // 블록 편집기 (봇 편집 탭 첫 진입 시 생성)'));
      ck('배선 구간을 소스에서 찾음', a > 0 && b > a, `${a}..${b}`);
      const els = {};
      const mkEl = (id) => { const el = { id, innerHTML: '', dataset: {}, listeners: {}, value: '', clicks: 0,
        addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
        querySelector: () => null, querySelectorAll: () => [], click() { el.clicks++; } }; return el; };
      const downloads = [];
      const doc = { getElementById: (id) => (els[id] = els[id] || mkEl(id)),
        createElement: () => { const x = { click() { downloads.push(x.download); } }; return x; } };
      const fire = async (id, type, target) => { for (const fn of (els[id].listeners[type] || [])) await fn({ target }); };
      const btn = (dataset, id = '') => { const t = { id, dataset, closest: (sel) => (sel === 'button' ? t : null) }; return t; };
      const fileEv = (obj) => ({ target: { files: [{ text: async () => JSON.stringify(obj) }], value: 'x' } });
      let dirty = false, panelRenders = 0;
      const names = ['document', 'Risuai', 'bundleMod', 'profileMod', 'validateSchema', 'SCHEMA_LORE_COMMENT', 'escapeText', 'schema', 'renderPanel', 'editorDiffersFromInstalled',
        'bundleKindOf', 'bundlePlanFor', 'bundlePieceApply', 'bundleWholeApply', 'bundleRevert', 'bundlePlanHtml', 'bundleChooserHtml', 'bundlePickerHtml',
        'bundleRecipes', 'bundleExportWhole', 'bundleExportPiece', 'bundleRecipeFromFile', 'bundleBases'];
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      new Function(...names, src.slice(a, b))(doc, global.Risuai, B, P, validateSchema, '⚙simcore', esc, wSchema(), () => { panelRenders++; }, () => dirty,
        H.kindOf, H.planFor, H.pieceApply, H.wholeApply, H.revert, H.planHtml, H.chooserHtml, H.pickerHtml,
        () => H.recipes(), () => H.exportWhole(), (_c, picks, info) => H.exportPiece(picks, info), (_c, data) => H.recipeFromFile(data), () => H.bases());
      const rep = () => els['sc-bundle-report'].innerHTML;
      const picker = () => els['sc-bundle-picker'].innerHTML;

      await els['sc-bundle-export'].onclick();
      ck('배선 — [번들 내보내기] → 고르기가 뜬다 (바로 내려받지 않는다)', rep().includes('data-bexp="piece"') && rep().includes('data-bexp="whole"') && downloads.length === 0, rep().slice(0, 120));
      await fire('sc-bundle-report', 'click', btn({ bexp: 'piece' }));
      ck('배선 — [조각 고르기] → 고르기 화면', picker().includes('🧩 조각 고르기') && picker().includes('data-ptab="map"') && /id="sc-piece-export"[^>]*disabled/.test(picker()), picker().slice(0, 160));
      await fire('sc-bundle-picker', 'change', { type: 'checkbox', checked: true, dataset: { ptab: 'map' } });
      ck('배선 — 탭을 체크하면 다시 그리고 딸린 것·검증이 따라온다', /data-ptab="map" checked/.test(picker()) && picker().includes('이 조각만으로 설치돼요') && /data-pid="location"[^>]*disabled/.test(picker()), picker().slice(0, 200));
      await fire('sc-bundle-picker', 'change', { type: 'checkbox', checked: true, dataset: { plist: 'vars', pid: 'gold' } });
      await fire('sc-bundle-picker', 'change', { type: 'checkbox', checked: false, dataset: { plist: 'vars', pid: 'gold' } });
      ck('배선 — 항목 체크를 켰다 끄면 원래대로', !/data-pid="gold" checked/.test(picker()), '');
      await fire('sc-bundle-picker', 'click', btn({}, 'sc-piece-export'));
      ck('배선 — [내보내기] → 파일 이름에 rev · 다음 단추는 r2', downloads.length === 1 && /^simcore-piece-.+-r1\.json$/.test(downloads[0]) && rep().includes('조각 내보내기 완료') && picker().includes('내보내기 r2'), `${downloads[0]} / ${rep().slice(0, 100)}`);
      await fire('sc-bundle-picker', 'click', btn({}, 'sc-piece-close'));
      ck('배선 — [닫기]', picker() === '', picker().slice(0, 50));
      await fire('sc-bundle-report', 'click', btn({ bexp: 'whole' }));
      ck('배선 — [전체 번들] → 내려받기와 보고', downloads.length === 2 && /^simcore-bundle-/.test(downloads[1]) && /내보내기 완료 \(r\d+\)/.test(rep()), rep().slice(0, 100));
      await fire('sc-bundle-report', 'click', btn({ bexp: 'file' }));
      ck('배선 — [지난 파일에서 구성 되살리기] → 파일 고르기', els['sc-bundle-recipe-file'].clicks === 1, '');
      await els['sc-bundle-recipe-file'].onchange(fileEv(e3.data));
      ck('배선 — 지난 조각 파일 → 구성이 열린다 (다음 rev)', rep().includes('구성을 되살렸어요') && picker().includes('내보내기 r4') && /data-ptab="map" checked/.test(picker()), rep().slice(0, 100));
      await fire('sc-bundle-picker', 'click', btn({}, 'sc-piece-close'));

      // 넣기 — 요약 → 줄 바꾸기 → 한 번 더
      els['sc-bundle-apply'].onclick();
      ck('배선 — [번들 넣기] 첫 클릭은 파일 고르기', els['sc-bundle-file'].clicks === 1, '');
      const r9 = piece(9, (d) => { d.schema.map.label = '배선 시험'; });
      await els['sc-bundle-file'].onchange(fileEv(r9));
      ck('배선 — 조각 파일 → 요약 화면', rep().includes('오라리오 지도') && rep().includes('data-bkey="schema:map.label"') && rep().includes('처음부터 다시 넣기'), rep().slice(0, 160));
      await fire('sc-bundle-report', 'click', btn({ bkey: 'schema:map.label', bpick: 'mine' }));
      ck('배선 — 줄을 [내 것]으로 바꾸면 다시 계획한다', /data-bkey="schema:map.label" data-bpick="mine" style="[^"]*font-weight:700/.test(rep()), rep().slice(0, 200));
      const labelBefore = wSchema().map.label;
      await els['sc-bundle-apply'].onclick();
      ck('배선 — 한 번 더 누르면 넣는다 (고른 대로: 지도 이름은 내 것)', rep().includes('넣기 완료') && wSchema().map.label === labelBefore && panelRenders >= 1
        && JSON.parse(store.get('sim:bundle-base:c-recv:b_map00001')).rev === 9, rep().slice(0, 120));
      await els['sc-bundle-file'].onchange(fileEv(r9));
      await fire('sc-bundle-report', 'click', btn({ bfresh: '1' }));
      ck('배선 — [처음부터 다시 넣기] → 지문 없이 다시 계획 · 돌아가기 단추', rep().includes('data-bfresh="0"') && rep().includes('처음 넣는 것처럼'), rep().slice(-260));

      // 더티 작업본 멈춤
      dirty = true;
      await els['sc-bundle-file'].onchange(fileEv(r9));
      ck('배선 — 적용 안 한 작업본이 있으면 멈추고 묻는다', rep().includes('작업본 버리고 계속') && !rep().includes('data-bkey'), rep().slice(0, 120));
      await fire('sc-bundle-report', 'click', btn({ bdiscard: '1' }));
      ck('배선 — [작업본 버리고 계속] → 요약으로 이어진다', rep().includes('data-bkey="schema:map.label"'), rep().slice(0, 120));
      dirty = false;

      // 형식이 다른 파일 · 전체 번들 안내 · 되돌리기
      await els['sc-bundle-file'].onchange(fileEv(cp(HOST)));
      ck('배선 — 스키마 JSON을 넣으면 JSON 관리자를 가리킨다', rep().includes('JSON 관리자'), rep().slice(0, 120));
      await els['sc-bundle-file'].onchange(fileEv(cp(oldBundle)));
      ck('배선 — 전체 번들 요약: 통째 교체 안내 + 따로 넣은 조각 경고', rep().includes('로어북 전체와 정규식이 교체') && /따로 넣은 조각 \d+개/.test(rep()) && rep().includes('[번들 넣기]를 한 번 더'), rep().slice(0, 200));
      await els['sc-bundle-revert'].onclick();
      ck('배선 — [교체 되돌리기]', rep().includes('교체 전 상태로 복구'), rep().slice(0, 100));

      // 최종 검토 — 검증에 막힌 계획에서 한 번 더 눌러도 고른 줄이 안 날아간다
      const badP = { ...piece(1, (d) => { d.schema.map.locVar = 'nowhere'; }), id: 'b_badwire1' };
      await els['sc-bundle-file'].onchange(fileEv(badP));
      ck('배선 — 검증에 막힌 계획은 이유를 보인다', rep().includes('검증을 못 넘어요') && rep().includes('nowhere'), rep().slice(0, 160));
      const snapW = JSON.stringify(world.char);
      await els['sc-bundle-apply'].onclick();
      ck('★ 배선 — 막힌 채 한 번 더 눌러도 무변화 · 요약과 고르기 단추가 남는다', JSON.stringify(world.char) === snapW && rep().includes('data-bkey=') && rep().includes('검증을 못 넘어'), rep().slice(0, 200));
      // 최종 검토 — 요약을 본 뒤 캐릭터가 바뀌면 넣지 않는다
      const okP = { simcoreBundle: 2, id: 'b_swap0001', rev: 1, name: '바꿔치기 시험', lorebook: [{ comment: '바꿔치기 로어', content: 'x' }] };
      await els['sc-bundle-file'].onchange(fileEv(okP));
      const keepId = world.char.chaId; world.char.chaId = 'c-other';
      await els['sc-bundle-apply'].onclick();
      ck('★ 배선 — 요약을 본 뒤 캐릭터가 바뀌면 넣지 않고 알린다 (조각)', rep().includes('캐릭터가 바뀌었어요') && !world.char.globalLore.some((l) => l.comment === '바꿔치기 로어'), rep().slice(0, 160));
      world.char.chaId = keepId;
      await els['sc-bundle-file'].onchange(fileEv(cp(oldBundle)));
      world.char.chaId = 'c-other';
      const snapO = JSON.stringify(world.char.globalLore);
      await els['sc-bundle-apply'].onclick();
      ck('★ 배선 — 요약을 본 뒤 캐릭터가 바뀌면 넣지 않고 알린다 (전체 번들)', rep().includes('캐릭터가 바뀌었어요') && JSON.stringify(world.char.globalLore) === snapO, rep().slice(0, 160));
      world.char.chaId = keepId;
      // 최종 검토 — 요약을 본 뒤 로어북이 바뀌면 새 계획을 다시 보여 준다
      await els['sc-bundle-file'].onchange(fileEv(okP));
      world.char.globalLore.push({ comment: '바꿔치기 로어', content: '그 사이 내가 만든 같은 이름' });
      await els['sc-bundle-apply'].onclick();
      ck('★ 배선 — 그 사이 내 봇이 바뀌면 바로 넣지 않고 새 요약(충돌 줄)을 보여 준다', rep().includes('바뀌었어요') && rep().includes('data-bkey="lore:바꿔치기 로어#0"')
        && world.char.globalLore.find((l) => l.comment === '바꿔치기 로어').content === '그 사이 내가 만든 같은 이름', rep().slice(0, 200));
      await fire('sc-bundle-report', 'click', btn({ bkey: 'lore:바꿔치기 로어#0', bpick: 'mine' }));
      await els['sc-bundle-apply'].onclick();
      ck('배선 — 새 요약에서 고르고 다시 누르면 들어간다 (내 것 유지)', rep().includes('넣기 완료') && world.char.globalLore.find((l) => l.comment === '바꿔치기 로어').content === '그 사이 내가 만든 같은 이름', rep().slice(0, 160));

      // 최종 검토 — 고르기 화면은 그릴 때마다 캐릭터를 다시 읽는다 · 못 찾은 고르기
      await fire('sc-bundle-report', 'click', btn({ bexp: 'piece' }));
      world.char.globalLore.push({ comment: '방금 만든 로어', content: 'new' });
      await fire('sc-bundle-picker', 'change', { type: 'checkbox', checked: true, dataset: { plore: 'lore:방금 만든 로어#0' } });
      ck('★ 배선 — 고르기 화면이 뜬 뒤 만든 로어도 보이고 고를 수 있다', picker().includes('방금 만든 로어') && /data-plore="lore:방금 만든 로어#0" checked/.test(picker()) && picker().includes('이 조각만으로 설치돼요'), picker().slice(-400));
      world.char.globalLore = world.char.globalLore.filter((l) => l.comment !== '방금 만든 로어');
      await fire('sc-bundle-picker', 'change', { type: 'checkbox', checked: true, dataset: { plore: 'lore:바꿔치기 로어#0' } });
      ck('★ 배선 — 고른 항목이 사라지면 말없이 빼지 않고 알린다 · 내보내기 잠금', picker().includes('못 찾았어요') && picker().includes('id="sc-piece-prune"') && /id="sc-piece-export"[^>]*disabled/.test(picker()), picker().slice(-500));
      await fire('sc-bundle-picker', 'click', btn({}, 'sc-piece-prune'));
      ck('배선 — [못 찾은 항목 빼기] → 다시 내보낼 수 있다', !picker().includes('못 찾았어요') && !/id="sc-piece-export"[^>]*disabled/.test(picker()), picker().slice(-300));
      world.char.chaId = 'c-other';
      await fire('sc-bundle-picker', 'change', { type: 'checkbox', checked: true, dataset: { ptab: 'map' } });
      ck('배선 — 캐릭터가 바뀌면 고르기 화면을 닫는다', picker().includes('캐릭터가 바뀌어') && !picker().includes('sc-piece-export'), picker().slice(0, 120));
      world.char.chaId = keepId;
    }

    // ── ⑦ 최종 검토에서 나온 것 (흐름) ──
    {
      const pz = (rev, content) => ({ simcoreBundle: 2, id: 'b_flow0001', rev, name: '흐름 시험', lorebook: [{ comment: '흐름 로어', content }] });
      const r1f = await H.pieceApply(pz(1, 'v1'));
      ck('지문에 형식을 적는다 (조각 = 2)', r1f.ok && JSON.parse(store.get('sim:bundle-base:c-recv:b_flow0001')).format === 2, r1f.html);
      // 바뀌는 것이 없는 계획 — 백업 칸을 안 쓴다
      const bkBefore = bkKeys().join(',');
      const rSame = await H.pieceApply(pz(2, 'v1'));
      ck('★ 바뀌는 것이 없으면 백업을 안 뜨고 설치 기록만 맞춘다', rSame.ok && bkKeys().join(',') === bkBefore && /바뀌는 것이 없어요/.test(rSame.html) && JSON.parse(store.get('sim:bundle-base:c-recv:b_flow0001')).rev === 2, rSame.html);
      // 지문 읽기 실패 — 첫 설치로 떨어뜨리지 않고 멈춘다
      world.char.globalLore.find((l) => l.comment === '흐름 로어').content = '내가 고친 것';
      const snapF = JSON.stringify(world.char);
      failKeys = true;
      const rKeys = await H.pieceApply(pz(3, 'v1'));
      const pKeys = await H.planFor(pz(3, 'v1'));
      failKeys = false;
      ck('★ 설치 기록을 못 읽으면 멈춘다 (내 수정을 "충돌 · 번들 것"으로 덮지 않는다)', rKeys.ok === false && /설치 기록/.test(rKeys.html) && JSON.stringify(world.char) === snapF && pKeys.ok === false, rKeys.html);
      // 기대한 계획과 다르면 넣지 않는다
      const planNow = await H.planFor(pz(3, 'v3'));
      const rOther = await H.pieceApply(pz(3, 'v3'), { expect: { chaId: 'c-someone-else', sig: B.planSig(planNow) } });
      const rStale = await H.pieceApply(pz(3, 'v3'), { expect: { chaId: 'c-recv', sig: 'stale' } });
      ck('★ 기대한 캐릭터·계획과 다르면 넣지 않고 새 계획을 돌려준다', rOther.ok === false && rOther.changed === true && rStale.ok === false && rStale.changed === true && rStale.plan.ok && JSON.stringify(world.char) === snapF, JSON.stringify([rOther.html, rStale.html]));
      const rGood = await H.pieceApply(pz(3, 'v3'), { expect: { chaId: planNow.chaId, sig: B.planSig(planNow) } });
      ck('기대와 같으면 넣는다 (충돌 — 기본 번들 것)', rGood.ok && world.char.globalLore.find((l) => l.comment === '흐름 로어').content === 'v3' && planNow.chaId === 'c-recv', rGood.html);
      // 전체 번들 — 이상한 id는 저장소 열쇠로 안 쓴다 · 지문 형식 1
      await H.wholeApply({ ...cp(oldBundle), id: 'a b/..', rev: 2 });
      ck('전체 번들의 id가 이상하면 지문을 안 남긴다', baseKeys().length === 0, baseKeys().join(','));
      await H.wholeApply({ ...cp(oldBundle), id: 'b_whole002', rev: 2 });
      ck('전체 번들의 지문 형식 = 1', JSON.parse(store.get('sim:bundle-base:c-recv:b_whole002')).format === 1, '');
      const pFake = await H.planFor({ simcoreBundle: 2, id: 'b_whole002', rev: 3, name: '같은 id의 가짜 조각', lorebook: [{ comment: '가짜', content: 'x' }] });
      ck('★ 전체 번들과 같은 id의 조각 — 봇 전체가 "제작자 삭제"로 안 뜬다', pFake.ok && pFake.lines.length === 1 && pFake.lines[0].kind === 'add', JSON.stringify(pFake.lines.map((l) => l.kind + ':' + l.key)));
      // 레시피에 내용 해시
      await H.pieceApply(piece(1));
      const eS = await H.exportPiece({ tabs: [], items: {}, lore: ['lore:던전#0'], regex: [] }, { name: '해시 시험' });
      const rcS = (await H.recipes()).find((r) => r.id === eS.data.id);
      // 남이 준 글자는 화면에 그대로 안 나간다
      const nasty = { simcoreBundle: 2, id: 'b_xss00001', rev: 1, name: '<img src=x onerror=1>', note: '"><script>alert(1)</script>', lorebook: [{ comment: '"><b onmouseover=1>', content: 'x' }] };
      const nh = H.planHtml(await H.planFor(nasty), {});
      ck('★ 요약 화면 — 번들이 준 이름·설명·로어 이름은 전부 이스케이프', !/<img|<script|<b onmouseover/.test(nh) && nh.includes('&lt;img') && nh.includes('&lt;script&gt;') && !/data-bkey="[^"]*"><b/.test(nh), nh.slice(0, 300));
      ck('조각 레시피에 고른 로어의 내용 해시를 같이 적는다', eS.errors.length === 0 && rcS && rcS.sigs && typeof rcS.sigs.lore['lore:던전#0'] === 'string', JSON.stringify(rcS && rcS.sigs));
    }

    try { await global.__unload?.(); } catch { /* 무관 */ }
  }

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.log('FAIL 테스트 본문이 던짐 →', e && e.stack || e); console.log('\n0 passed, 1 failed'); process.exit(1); });
