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

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.log('FAIL 테스트 본문이 던짐 →', e && e.stack || e); console.log('\n0 passed, 1 failed'); process.exit(1); });
