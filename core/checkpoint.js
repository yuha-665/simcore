// 체크포인트 — 되감기 (설계: docs/design-조퇴악녀.md §12, v1.11.0)
//
// 회귀물·로그라이크·타임루프의 "죽으면 그 아침으로" — 지금까지는 스키마로 만들 수 없었다.
// 효과(set)는 스키마 vars만 대상이라 예약 키(time_epoch 날짜·scn_idx 현재 막·sec_* 비밀)를 못 돌리고,
// 막은 앞으로만 가고, 시간은 음수 진행을 무시한다. 이 모듈이 그 셋을 한 번에 되감는 통로다.
//
// 효과 두 가지 (효과를 받는 곳이면 어디든 — 이벤트·선택지·액션·판정 등급·막 onEnter·보조 갈림길 태그):
//   { checkpoint: 'save', slot?: 'main' }   지금 상태를 칸에 적는다 (막 onEnter가 정석 — "챕터 시작")
//   { checkpoint: 'load', slot?: 'main' }   그 칸으로 되감는다 (게임오버 이벤트·선택지)
// 설정 (선택):
//   checkpoint: { keep: ['loop', 'memories'], keepSecrets: true, notify: '…' }
//
// 되감기는 **변수 전부**(예약 키 포함)와 이벤트의 once·쿨다운 기록을 저장 시점으로 돌린다.
// 남는 것은 keep 변수와 (기본) 열린 비밀 — 회귀자의 기억이다. 턴 번호·채팅·보드·상점·메신저는 그대로 간다
// (메시지 스냅샷은 앞으로만 쌓인다 — 되감기는 "이야기 안의 시간"이지 채팅 되돌리기가 아니다. 그건 메시지 삭제가 한다).
//
// 적용 시점: applySets는 **줄만 세우고**(meta.cpQueue), 단계 끝에서 한 번에 처리한다 — 전송 단계는 액션·선택지 뒤
// (되감긴 상태로 이번 프롬프트가 나간다), 응답 단계는 이벤트·막 전환·비밀 뒤. 그래서 같은 효과 목록 안의
// `loop + 1`은 순서와 무관하게 살아남고(keep이면), 막 onEnter의 저장은 그 턴의 막 전환·진입 효과까지 담는다.
//
// 칸은 state.checkpoints[slot]에 산다 — 메시지 스냅샷에 같이 실려 리롤·삭제에 같이 되감긴다.

const CP_OPS = ['save', 'load'];
const DEFAULT_SLOT = 'main';
const SLOT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;
const QUEUE_MAX = 16; // 한 단계에 쌓일 줄 상한 — 식이 이상해도 무한히 늘지 않게

const DEFAULT_LOAD_NOTIFY = '[되감기] 시간이 체크포인트 시점으로 되돌아갔다. 세상과 사람들은 그때 그대로다 — 그 뒤에 벌어진 일은 '
  + '일어나지 않은 일이 됐고, 아무도 기억하지 못한다. 기억하는 것은 위 상태에 남은 것뿐이다. 되돌아온 그 시점의 장면에서 다시 시작하라.';

/** 설정 정규화 — 효과를 안 써도 호출돼도 된다 (keep 빈 배열, 비밀 유지) */
function checkpointConfig(schema) {
  const c = schema?.checkpoint && typeof schema.checkpoint === 'object' && !Array.isArray(schema.checkpoint) ? schema.checkpoint : {};
  return {
    keep: Array.isArray(c.keep) ? c.keep.filter((x) => typeof x === 'string' && x) : [],
    keepSecrets: c.keepSecrets !== false,
    notify: typeof c.notify === 'string' ? c.notify : '',
  };
}

const isCheckpointEffect = (rule) => !!rule && typeof rule === 'object' && rule.checkpoint !== undefined;
const slotOf = (rule) => (typeof rule?.slot === 'string' && rule.slot.trim() ? rule.slot.trim() : DEFAULT_SLOT);

/** applySets가 부른다 — 적용하지 않고 줄만 세운다 */
function queueOp(state, rule, source) {
  if (!CP_OPS.includes(rule.checkpoint)) return;
  const m = state.meta;
  if (!Array.isArray(m.cpQueue)) m.cpQueue = [];
  if (m.cpQueue.length >= QUEUE_MAX) return;
  m.cpQueue.push({ op: rule.checkpoint, slot: slotOf(rule), source: source || '' });
}

const copy = (x) => JSON.parse(JSON.stringify(x ?? null));

function snapshot(state) {
  return {
    vars: copy(state.vars),
    firedOnce: copy(state.meta.firedOnce || {}),
    eventLastFired: copy(state.meta.eventLastFired || {}),
    turn: state.meta.turn,
  };
}

/**
 * 되감기 — 칸의 변수로 갈아끼우되 keep 변수와 (keepSecrets면) 열린 비밀은 지금 값을 들고 간다.
 * @param isSecretKey 예약 키 판별 (secret 모듈을 여기서 require하지 않는다 — 순서 의존 없이 엔진이 물려 준다)
 */
function restore(schema, state, snap, isSecretKey = () => false) {
  const cfg = checkpointConfig(schema);
  const cur = state.vars;
  const next = copy(snap.vars) || {};
  for (const id of cfg.keep) if (id in cur) next[id] = copy(cur[id]);
  if (cfg.keepSecrets) {
    for (const k of Object.keys(cur)) {
      if (!isSecretKey(k)) continue;
      const a = Number(cur[k]), b = Number(next[k]);
      next[k] = Number.isFinite(b) ? Math.max(a, b) : cur[k]; // 밝혀진 진실은 되감아도 안 닫힌다
    }
  }
  state.vars = next;
  state.meta.firedOnce = copy(snap.firedOnce) || {};
  state.meta.eventLastFired = copy(snap.eventLastFired) || {};
  // 되감기 전 세계가 내민 갈림길은 되감긴 세계에 없다
  state.meta.pendingChoice = null;
  state.meta.pendingChoicePick = null;
}

/**
 * 세워 둔 줄을 순서대로 처리한다. 엔진이 단계 끝에서 부른다.
 * @returns {{ saved: string[], loaded: {slot, turn}|null, missing: string[] }}
 */
function flush(schema, state, isSecretKey) {
  const q = Array.isArray(state.meta.cpQueue) ? state.meta.cpQueue : [];
  state.meta.cpQueue = [];
  const out = { saved: [], loaded: null, missing: [] };
  if (!q.length) return out;
  if (!state.checkpoints || typeof state.checkpoints !== 'object') state.checkpoints = {};
  for (const it of q) {
    if (it.op === 'save') {
      state.checkpoints[it.slot] = snapshot(state);
      out.saved.push(it.slot);
    } else if (it.op === 'load') {
      const snap = state.checkpoints[it.slot];
      if (!snap || !snap.vars) { out.missing.push(it.slot); continue; }
      restore(schema, state, snap, isSecretKey);
      out.loaded = { slot: it.slot, turn: snap.turn };
    }
  }
  return out;
}

/** 스키마 안의 모든 효과 목록 — 검증(저장 없는 되감기)과 편집기 요약이 같이 쓴다 */
function allEffectLists(schema) {
  const out = [];
  const push = (arr, path) => { if (Array.isArray(arr)) out.push({ path, effects: arr }); };
  const r = schema?.rules || {};
  push(r.onTurn, '$.rules.onTurn');
  (r.events || []).forEach((e, i) => {
    push(e?.effects, `$.rules.events[${i}].effects`);
    (e?.choices || []).forEach((c, j) => push(c?.effects, `$.rules.events[${i}].choices[${j}].effects`));
  });
  (r.randomEvents?.table || []).forEach((e, i) => {
    push(e?.effects, `$.rules.randomEvents.table[${i}].effects`);
    (e?.choices || []).forEach((c, j) => push(c?.effects, `$.rules.randomEvents.table[${i}].choices[${j}].effects`));
  });
  (schema?.actions || []).forEach((a, i) => push(a?.effects, `$.actions[${i}].effects`));
  (schema?.checks || []).forEach((c, i) => (c?.grades || []).forEach((g, j) => push(g?.effects, `$.checks[${i}].grades[${j}].effects`)));
  (schema?.scenario?.acts || []).forEach((a, i) => push(a?.onEnter, `$.scenario.acts[${i}].onEnter`));
  (schema?.liveChoices?.tags || []).forEach((t, i) => push(t?.effects, `$.liveChoices.tags[${i}].effects`));
  return out;
}

/** 스키마가 쓰는 칸 — { save: Set, load: Set } */
function slotsUsed(schema) {
  const save = new Set(), load = new Set();
  for (const { effects } of allEffectLists(schema)) {
    for (const f of effects) {
      if (!isCheckpointEffect(f)) continue;
      (f.checkpoint === 'save' ? save : f.checkpoint === 'load' ? load : new Set()).add(slotOf(f));
    }
  }
  return { save, load };
}

module.exports = {
  CP_OPS, DEFAULT_SLOT, SLOT_RE, DEFAULT_LOAD_NOTIFY,
  checkpointConfig, isCheckpointEffect, slotOf, queueOp, snapshot, restore, flush, allEffectLists, slotsUsed,
};
