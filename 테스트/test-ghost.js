const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.7.3 — 유령 시간선. 실기 제보: "⟦simcore:456⟧이 한번 박히고 나니 이전 채팅을 지워도 456 차례가 되면
// 이전 상태창을 그대로 불러오고, 세이브 내보내서 456을 지워도 또 어디서 똑같은 걸 긁어온다."
// 출처가 셋이었다 — ① 전송 때 옛 pre:U가 현재보다 우선 ② 세이브 가져오기가 교체가 아니라 병합
// ③ 어댑터 램 캐시(histStates). ①②는 여기서, ③은 어댑터 정적 확인으로 잡는다.
const fs = require('fs');
const { SimSession } = require(__P('../core/session.js'));
const { MapBackend } = require(__P('../core/store.js'));

const R = []; const ok = (n, c, x = '') => R.push([c, n, x]);
const J = (x) => JSON.stringify(x);

const S = {
  simcore: '0.1', meta: { name: '유령 테스트' },
  vars: [{ id: 'gold', label: '금화', type: 'int', init: 1000, min: 0 }],
  rules: { onTurn: [{ set: 'gold', expr: 'gold - 10' }] },
  actions: [{ id: 'tax', label: '징세', effects: [{ set: 'gold', expr: 'gold + 100' }] }],
  updater: { allow: [{ id: 'gold', maxDelta: 1000 }] },
  statusUI: { mode: 'auto', groups: [{ label: '상태', items: [{ var: 'gold' }] }] },
};
const aux = (d) => `{"changes":{"gold":${d}},"reasons":{"gold":"x"}}`;
async function turn(ses, u, d) { await ses.onSend(u); return ses.onOutput(u + 1, aux(d)); }
const keysOf = (ses) => (ses.store.b.keys()).filter((k) => k.startsWith(ses.store.p + ':')).map((k) => k.slice(ses.store.p.length + 1)).sort();

(async () => {
  console.log('\n━━ 리롤은 종전대로 멱등 (out:U-1이 안 바뀌면 pre:U 그대로) ━━');
  {
    const ses = new SimSession(S, new MapBackend(), { chatId: 'c1' });
    await ses.init(-1); ses.current.meta.setupDone = true;
    await turn(ses, 0, -100);          // out:1 = 890
    ses.toggle('tax');                 // 무장은 current에만 (코어 흐름 — 호스트가 out에 안 얹어도 된다)
    const t = await turn(ses, 2, 0);   // out:3 = 890 + 100 - 10 = 980
    ok('징세 1회 반영', t.state.vars.gold === 980, String(t.state.vars.gold));
    let pruned = 0; const orig = ses.store.pruneFrom.bind(ses.store);
    ses.store.pruneFrom = async (i) => { pruned++; return orig(i); };
    const re = await turn(ses, 2, 0);  // 리롤
    ok('★ 리롤 = 같은 결과 (이중 적용 없음)', re.state.vars.gold === 980, String(re.state.vars.gold));
    ok('★ 리롤에서도 무장 액션 재현 — 무장은 혈통 비교에서 제외', (await ses.onSend(2)).consumedActions.includes('tax'), '');
    ok('★ 리롤은 갈래가 아니다 — 정리 안 함', pruned === 0, String(pruned));
  }

  console.log('\n━━ 리로드 뒤 리롤 — reconcile을 거쳐도 혈통이 같다 ━━');
  {
    const b = new MapBackend();
    const ses = new SimSession(S, b, { chatId: 'c2' });
    await ses.init(-1); ses.current.meta.setupDone = true;
    await turn(ses, 0, -100); await turn(ses, 2, -50);   // out:3 = 830
    const ses2 = new SimSession(S, b, { chatId: 'c2' });  // 채팅 다시 열기
    await ses2.init(3);
    let pruned = 0; const orig = ses2.store.pruneFrom.bind(ses2.store);
    ses2.store.pruneFrom = async (i) => { pruned++; return orig(i); };
    const re = await turn(ses2, 2, -50);
    ok('리로드 뒤 리롤도 같은 결과', re.state.vars.gold === 830, String(re.state.vars.gold));
    ok('리로드 뒤 리롤도 갈래 아님', pruned === 0, String(pruned));
  }

  console.log('\n━━ ★ 제보 재현: 지우고 → 패널 보정 → 다시 보내면 옛 pre가 되살아났다 ━━');
  {
    const b = new MapBackend();
    const ses = new SimSession(S, b, { chatId: 'c3' });
    await ses.init(-1); ses.current.meta.setupDone = true;
    for (let u = 0; u < 8; u += 2) await turn(ses, u, -100);   // out:1..7, pre:0..6
    ok('7턴까지 스냅샷 있음', keysOf(ses).includes('pre:6') && keysOf(ses).includes('out:7'), J(keysOf(ses)));
    // 유저가 4·5·6·7 메시지를 지우고 채팅을 다시 열었다 → out:3에서 복원
    const ses2 = new SimSession(S, b, { chatId: 'c3' });
    await ses2.init(3);
    // 패널에서 금화를 999로 보정 — 어댑터 규약: out:lastOutIndex(=3)에 저장
    ses2.current.vars.gold = 999;
    await ses2.store.save('out', 3, ses2.current);
    // 새 메시지 전송 = 인덱스 4 (옛 pre:4가 저장소에 있다)
    const r = await ses2.onSend(4);
    ok('★ 보정값에서 출발 (옛 pre:4 무시)', r.state.vars.gold === 999, String(r.state.vars.gold));
    const out = await ses2.onOutput(5, aux(0));
    ok('★ 응답 상태창도 새 시간선', out.state.vars.gold === 989, String(out.state.vars.gold));
    const ks = keysOf(ses2);
    ok('★ 옛 미래(pre:6·out:7) 정리됨', !ks.includes('pre:6') && !ks.includes('out:7') && !ks.includes('send:6'), J(ks));
    ok('과거(out:1·out:3)는 그대로', ks.includes('out:1') && ks.includes('out:3'), J(ks));
    ok('pre:4는 새 혈통으로 다시 씀', JSON.parse(b.get(ses2.store.p + ':pre:4')).vars.gold === 999, '');
  }

  console.log('\n━━ 깊게 지우고 새로 진행 — 새 시간선이 옛 번호에 닿아도 안 튄다 ━━');
  {
    const b = new MapBackend();
    const ses = new SimSession(S, b, { chatId: 'c4' });
    await ses.init(-1); ses.current.meta.setupDone = true;
    for (let u = 0; u < 8; u += 2) await turn(ses, u, -100);   // 옛 시간선: out:7 = 1000-4*110 = 560
    const ses2 = new SimSession(S, b, { chatId: 'c4' });
    await ses2.init(1);                                        // 1번까지만 남기고 지움 (out:1 = 890)
    const a = await turn(ses2, 2, 0);                          // 새 시간선 — 델타가 다르다
    ok('새 2턴은 옛 pre:2와 다른 결과', a.state.vars.gold === 880, String(a.state.vars.gold));
    const c = await turn(ses2, 4, 0);
    ok('★ 4턴에서 옛 시간선으로 안 튐', c.state.vars.gold === 870, String(c.state.vars.gold));
    const e = await turn(ses2, 6, 0);
    ok('★ 6턴도 새 시간선 (옛 560이 아님)', e.state.vars.gold === 860, String(e.state.vars.gold));
    const ses3 = new SimSession(S, b, { chatId: 'c4' });
    await ses3.init(7);
    ok('★ 다시 열어도 새 시간선', ses3.current.vars.gold === 860, String(ses3.current.vars.gold));
  }

  console.log('\n━━ 첫 턴·연속 유저 메시지 — out:U-1이 없으면 종전 규칙 ━━');
  {
    const ses = new SimSession(S, new MapBackend(), { chatId: 'c5' });
    await ses.init(-1); ses.current.meta.setupDone = true;
    const a = await ses.onSend(1);          // 인사말 뒤 첫 전송 — out:0 없음
    const b = await ses.onSend(1);          // 리롤
    ok('첫 턴 리롤 멱등', J(a.state.vars) === J(b.state.vars), '');
  }

  console.log('\n━━ ★ 세이브 가져오기(같은 채팅) = 교체 — 파일에서 지운 턴은 저장소에서도 사라진다 ━━');
  {
    const b = new MapBackend();
    const ses = new SimSession(S, b, { chatId: 'c6' });
    await ses.init(-1); ses.current.meta.setupDone = true;
    for (let u = 0; u < 8; u += 2) await turn(ses, u, -100);
    const data = await ses.exportData(7);
    ok('내보내기에 out:7 있음', 'out:7' in data.snapshots, '');
    // 유저가 파일에서 6·7번을 지웠다
    for (const k of ['pre:6', 'send:6', 'out:7']) delete data.snapshots[k];
    data.current = JSON.parse(data.snapshots['out:5']); data.lastOutIndex = 5;
    const res = await ses.importData(data, 5);
    ok('같은 채팅으로 인식', res.ok && res.sameChat, J(res));
    const ks = keysOf(ses);
    ok('★ 파일에 없는 out:7·pre:6·send:6이 저장소에서도 사라짐', !ks.includes('out:7') && !ks.includes('pre:6') && !ks.includes('send:6'), J(ks));
    ok('파일에 있던 out:5는 복원', ks.includes('out:5'), '');
    ok('current도 파일대로', ses.current.vars.gold === JSON.parse(data.snapshots['out:5']).vars.gold, '');
  }

  console.log('\n━━ 어댑터 — 램 캐시(histStates)의 세 번째 출처 ━━');
  {
    const src = fs.readFileSync(__P('../adapter/risu-plugin.js'), 'utf8');
    ok('pruneFrom 래퍼가 캐시를 같이 비운다', src.includes('session.store.pruneFrom = async (index) =>') && src.includes('histStates.delete(k)'), '');
    ok('완전 초기화 뒤 캐시 비움', /session\.resetAll\(progress\)\);\n\s*histStates = new Map\(\); histPending\.clear\(\);/.test(src), '');
    ok('세이브 가져오기 뒤 캐시 비움', /data\.lastOutIndex : anchor;\n(.*\n){0,3}\s*histStates = new Map\(\); histPending\.clear\(\);/.test(src), '');
    ok('버전 1.7.3', src.includes('//@version 1.7.3'), '');
  }

  let p = 0, f = 0;
  for (const [c, n, x] of R) { console.log(c ? '  ✓' : '  ✗', n, c ? '' : `→ ${x}`); c ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
