const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.20 — 🧪 N턴 시험: 헤드리스 N턴, 매 턴 시간 고정, 행동 반복, 턴별 표
// 커뮤니티 제보(에렌샤): "10분·30분·100분 간격으로 굴려 자연 증감을 토큰 없이 보고 싶다"
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
const { runTrialTurns } = require(__P('../core/editor.js'));
const { validateSchema } = require(__P('../core/validate.js'));

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const J = JSON.stringify;

// 시간 체계 + 분 단위 정산 — 허기는 시간 비례(turn_hour), 체력은 매 턴 -1, 100분마다 도는 이벤트
const S = {
  simcore: '0.1', meta: { name: 'N턴' },
  time: { start: '2026-01-01 08:00', expose: ['date', 'clock'] },
  vars: [
    { id: 'hp', label: '체력', type: 'int', init: 100, min: 0, max: 100 },
    { id: 'hunger', label: '허기', type: 'int', init: 0, min: 0, max: 100 },
    { id: 'skip_min', label: '흐른 시간(분)', type: 'int', init: 0, min: 0, max: 1440 },
    { id: 'meals', label: '식사', type: 'int', init: 0, min: 0 },
  ],
  rules: {
    onTurn: [
      { set: 'hp', expr: 'hp - 1' },
      { set: 'hunger', expr: 'hunger + turn_hour * 10' },
    ],
    events: [{ id: 'starving', when: 'hunger >= 50', notify: 'Starving.', effects: [{ set: 'hp', expr: 'hp - 10' }] }],
  },
  actions: [{ id: 'eat', label: '먹기', mode: 'oneshot', effects: [{ set: 'hunger', expr: 'hunger - 30' }, { set: 'meals', expr: 'meals + 1' }] }],
  updater: { allow: [{ id: 'skip_min' }] },
};
ck('표본 스키마 통과', validateSchema(S).ok, J(validateSchema(S).errors));

console.log('── 1턴은 예전과 같다');
{
  const r = runTrialTurns(S, { turns: 1, seed: '1' });
  ck('결과 모양 before/send/out/blocked + rows 1', r.before && r.send && r.out && r.blocked === null && r.rows.length === 1 && r.turns === 1, J(Object.keys(r)));
  ck('hp 100 → 99 (정기 틱 한 번)', r.out.state.vars.hp === 99 && r.rows[0].vars.hp === 99, J(r.rows[0].vars));
}

console.log('── N턴 + 매 턴 시간');
{
  const r = runTrialTurns(S, { turns: 10, everyMin: 30, seed: '1' });
  ck('10행', r.rows.length === 10 && r.rows[9].turn === 10, String(r.rows.length));
  ck('hp는 턴마다 -1', r.rows[4].vars.hp === 95 && r.rows[9].vars.hp <= 90, J(r.rows.map((x) => x.vars.hp)));
  ck('허기는 시간 비례 (30분 = 0.5시간 → +5/턴)', r.rows[0].vars.hunger === 5 && r.rows[1].vars.hunger === 10, J(r.rows.map((x) => x.vars.hunger)));
  ck('시각 열이 30분씩 흐른다', r.rows[0].when.includes('08:30') && r.rows[1].when.includes('09:00'), J(r.rows.slice(0, 2).map((x) => x.when)));
  ck('skip_min은 소비돼 0으로', r.rows.every((x) => x.vars.skip_min === 0), '');
  ck('시간 주의 없음', r.timeNote === null, r.timeNote);
  const r2 = runTrialTurns(S, { turns: 12, everyMin: 60, seed: '1' });
  const firstStarve = r2.rows.findIndex((x) => x.fired.some((f) => f.includes('starving')));
  ck('허기 50 넘는 턴에 이벤트 발동 (60분 → +10/턴 → 5턴째)', firstStarve === 4, String(firstStarve));
  ck('발동 턴에 hp -10 추가', r2.rows[4].vars.hp === r2.rows[3].vars.hp - 11, J([r2.rows[3].vars.hp, r2.rows[4].vars.hp]));
}

console.log('── 행동 반복');
{
  const once = runTrialTurns(S, { turns: 5, action: 'eat', actionEvery: false, seed: '1' });
  const every = runTrialTurns(S, { turns: 5, action: 'eat', actionEvery: true, seed: '1' });
  ck('첫 턴만: 식사 1', once.rows[4].vars.meals === 1, J(once.rows.map((x) => x.vars.meals)));
  ck('매 턴: 식사 5', every.rows[4].vars.meals === 5, J(every.rows.map((x) => x.vars.meals)));
  ck('같은 시드면 같은 결과', J(runTrialTurns(S, { turns: 5, everyMin: 30, seed: '7' }).rows) === J(runTrialTurns(S, { turns: 5, everyMin: 30, seed: '7' }).rows), '');
}

console.log('── 시간 없는 봇·경계');
{
  const noTime = JSON.parse(J(S)); delete noTime.time; noTime.vars = noTime.vars.filter((v) => v.id !== 'skip_min');
  noTime.rules.onTurn = [{ set: 'hp', expr: 'hp - 1' }]; noTime.updater.allow = [];
  const r = runTrialTurns(noTime, { turns: 3, everyMin: 30 });
  ck('시간 체계 없음 → 주의 문구 + 그래도 3턴', r.timeNote && r.timeNote.includes('시간 체계') && r.rows.length === 3, r.timeNote);
  const dayOnly = JSON.parse(J(S)); dayOnly.vars = dayOnly.vars.map((v) => v.id === 'skip_min' ? { ...v, id: 'skip_day', label: '흐른 날', max: 3650 } : v);
  dayOnly.updater.allow = [{ id: 'skip_day' }];
  const rd = runTrialTurns(dayOnly, { turns: 2, everyMin: 1440 });
  ck('skip_day만 있으면 1440분 = 하루', rd.rows[0].when.includes('01-02') && rd.timeNote === null, J([rd.rows[0].when, rd.timeNote]));
  const rd2 = runTrialTurns(dayOnly, { turns: 2, everyMin: 90 });
  ck('skip_day만 있는데 90분 → 주의', rd2.timeNote && rd2.timeNote.includes('skip_min이 없어'), rd2.timeNote);
  ck('턴 수 상한 500·하한 1', runTrialTurns(S, { turns: 9999 }).turns === 500 && runTrialTurns(S, { turns: 0 }).turns === 1 && runTrialTurns(S, { turns: 'x' }).turns === 1, '');
}

console.log('── UI 소스');
{
  ck('입력 줄: 턴 수·매 턴 시간·행동 반복·지켜볼 변수', src.includes("pair('턴 수',") && src.includes("pair('매 턴 시간(분)',") && src.includes("pair('행동 반복',") && src.includes("pair('지켜볼 변수',"), '');
  ck('턴별 표 + 40행 표본', src.includes("class: 'sce-trial-table'") && src.includes('const step = r.rows.length > 40 ? Math.ceil(r.rows.length / 40) : 1;'), '');
  ck('발동 횟수 줄', src.includes("'· 발동 횟수: '"), '');
  ck('runTrial이 순수 함수를 부른다', src.includes('trial.result = runTrialTurns(schema, {'), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
