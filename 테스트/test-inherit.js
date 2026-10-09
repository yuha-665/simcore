const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.14.13 복사·분기 채팅 상속 — 리수가 채팅을 복사·분기하면 새 chat.id를 줘 스냅샷 접두가 달라지고 상태가 초기값으로 시작했다.
// 분기 주석(포켓리스 1.8.1 Chat.svelte) / 글자 그대로 같은 형제(SideChatList.svelte 복사)로 원본을 찾아 스냅샷을 잘라 베낀다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const { SimSession, detectInheritSource } = SC.require('session');
const { MapBackend } = SC.require('store');

let pass = 0, fail = 0;
const ck = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, '→', got); } };
const mk = (role, data) => ({ role, data });

(async () => {
  // ── 원본 찾기 ──
  const A = { id: 'A', message: [mk('user', 'u0'), mk('char', 'c1 ⟦simcore:1⟧'), mk('user', 'u2'), mk('char', 'c3 ⟦simcore:3⟧')] };
  const branch = { id: 'B', message: [...A.message.slice(0, 2), mk('char', '{{specialcomment::branchedfrom::A::원본 이름::m-id::}}')] };
  ck('분기 주석 → 원본 id·자른 번호(주석 앞)', JSON.stringify(detectInheritSource(branch, [])) === JSON.stringify({ srcId: 'A', cut: 1, how: '분기' }), JSON.stringify(detectInheritSource(branch, [])));
  const mid = { id: 'B2', message: [...branch.message, mk('user', 'u3'), mk('char', 'c4')] };
  ck('분기 뒤 대화가 이어졌어도 주석 앞까지만', detectInheritSource(mid, []).cut === 1, '');
  const copy = { id: 'C', message: A.message.map((m) => ({ ...m })) };
  ck('복사 — 글자 그대로 같은 형제', JSON.stringify(detectInheritSource(copy, [A])) === JSON.stringify({ srcId: 'A', cut: 3, how: '복사' }), '');
  ck('자리표시 사본(_placeholder)은 비교 못 한다', detectInheritSource(copy, [{ id: 'A', _placeholder: true, message: [] }]) === null, '');
  const diff = { id: 'D', message: [...A.message.slice(0, 3), mk('char', '다른 글 ⟦simcore:3⟧')] };
  ck('한 글자라도 다르면 원본이 아니다', detectInheritSource(diff, [A]) === null, '');
  ck('빈 채팅은 아무것도 아니다', detectInheritSource({ id: 'E', message: [] }, [A]) === null, '');
  ck('주석만 있는 채팅(0번이 주석)은 거부', detectInheritSource({ id: 'F', message: [mk('char', '{{specialcomment::branchedfrom::A::x::y::}}')] }, []) === null, '');

  // ── 스냅샷 베끼기 ──
  const S = { simcore: '0.1', meta: { name: 'x' }, vars: [{ id: 'gold', label: '금', type: 'int', init: 1000, min: 0 }],
    rules: { onTurn: [{ set: 'gold', expr: 'gold - 10' }] }, updater: { allow: [{ id: 'gold', maxDelta: 1000 }] } };
  const be = new MapBackend();
  const a = new SimSession(S, be, { chatId: 'A', prefix: 'sim:ch:A' });
  await a.init(-1); a.current.meta.setupDone = true;
  await a.onSend(0); await a.onOutput(1, '{"changes":{"gold":-100},"reasons":{"gold":"x"}}');
  await a.onSend(2); await a.onOutput(3, '{"changes":{"gold":-100},"reasons":{"gold":"x"}}');
  await be.set('sim:ch:A:realign', '{"5":3}');
  const b = new SimSession(S, be, { chatId: 'B', prefix: 'sim:ch:B' });
  ck('새 채팅엔 스냅샷이 없다', (await b.hasSnapshots()) === false, '');
  const n = await b.inheritFrom('sim:ch:A', 1);
  ck('1번까지 베낀다 (pre:0 send:0 out:1)', n === 3 && !!(await b.store.load('out', 1)) && (await b.store.load('out', 3)) === null, String(n));
  ck('재정렬 이동 기록도 따라온다', (await be.get('sim:ch:B:realign')) === '{"5":3}', String(await be.get('sim:ch:B:realign')));
  await b.init(2);
  ck('복원하면 원본 1번 상태', b.current.vars.gold === 890 && b.current.meta.turn === 1, `${b.current.vars.gold}/${b.current.meta.turn}`);
  ck('원본은 그대로', !!(await a.store.load('out', 3)), '');
  const c = new SimSession(S, be, { chatId: 'C', prefix: 'sim:ch:C' });
  ck('전부 베끼기 (복사)', (await c.inheritFrom('sim:ch:A', 3)) === 6, '');
  await c.init(3);
  ck('복사본은 원본 최신 상태', c.current.vars.gold === 780, String(c.current.vars.gold));

  // ── 어댑터 배선 (정적) ──
  ck('어댑터가 detectInheritSource를 받는다', src.includes("const { SimSession, detectInheritSource } = SimCore.require('session');"), '');
  ck('로드에서 재정렬·복원보다 먼저 상속', src.indexOf('inherited = await inheritFromSibling(sess, chat, chaIdx, char.chaId)') < src.indexOf("await realignTimeline(chat, lastCharIdx, '로드'"), '');
  ck('스냅샷이 있으면 손대지 않는다', src.includes('if (!msgs.length || !chaId || await sess.hasSnapshots()) return false;'), '');
  ck('형제는 마커가 있는 채팅에서만, 스냅샷 있는 id만', src.includes("if (!found && msgs.some((m) => typeof m?.data === 'string' && m.data.includes('⟦simcore:')))"), '');
  ck('상속했으면 미러를 그 자리 값으로', src.includes('if (inherited) { try { await mirrorVars(chaIdx, chatIdx); } catch {} }'), '');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
