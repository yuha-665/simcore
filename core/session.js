// SimSession — 호스트(리스 어댑터/플레이그라운드/테스트)가 쓰는 오케스트레이터.
// 파이프라인 시점과 스냅샷 규약을 한 곳에 고정한다:
//
//   [무장 토글]  current.meta.armed 수정 (턴 사이, UI에서)
//   [전송 U]     base = pre:U (있으면=리롤) ?? current
//                pre:U 저장 → sendPhase(base) → send:U 저장 → current 갱신
//   [응답 C=U+1] outputPhase(send:U 상태) → out:C 저장 → current 갱신
//
// 리롤: 같은 U/C 키로 다시 돌므로 base가 같아 멱등. 랜덤은 (chatId, 인덱스) 시드로 고정.
// 삭제: 전송 시 U가 과거로 돌아가면 pre:U가 이미 있어 그 시점 상태로 자연 복원.
//
// ⚠ 유령 시간선 (v1.7.3, 실기 제보 "⟦simcore:456⟧이 한번 박히니 이전 채팅을 지워도 456 차례가 되면
// 옛 상태창을 그대로 불러온다"): pre:U는 out:U-1에서 파생된 **캐시**다. 메시지를 지우고 새로 진행하거나
// 패널로 보정하면 out:U-1이 바뀌는데, 옛 pre:U가 그대로 남아 있으면 리롤과 구분이 안 돼 지워진 시간선이
// 되살아났다. 그래서 전송 때 pre:U와 out:U-1의 혈통을 대조한다 — 다르면 pre:U는 유물이고, 그 번호부터의
// 옛 미래(pre/send/out ≥ U)를 지운 뒤 out:U-1에서 새로 출발한다. 리롤은 out:U-1이 안 바뀌므로 그대로 멱등.

const engine = require('./engine');
const { SnapshotStore, mapLimited } = require('./store');
const IO_CONCURRENCY = 12; // 샌드박스 브리지 동시 요청 수 (너무 키우면 브리지가 밀린다)
const { seededRng, makeUnstableRng } = require('./rng');

/** 키 순서에 안 흔들리는 직렬화 — 스냅샷을 두 경로로 만들면 키 순서가 달라질 수 있다 */
function stableJson(x) {
  if (Array.isArray(x)) return '[' + x.map(stableJson).join(',') + ']';
  if (x && typeof x === 'object') {
    return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + stableJson(x[k])).join(',') + '}';
  }
  return JSON.stringify(x);
}

/**
 * 스냅샷의 혈통 키 (v1.7.3). pre:U는 out:U-1에 턴 사이 무장(meta.armed)만 얹은 것이라, 무장을 빼고
 * 비교하면 같은 시간선인지 알 수 있다. 양쪽 다 reconcile을 통과시켜 구세이브에 빠진 키가 차이로 안 잡히게.
 */
function lineageKey(schema, state) {
  const s = engine.reconcileState(schema, JSON.parse(JSON.stringify(state)));
  const { armed, ...meta } = s.meta || {};
  return stableJson({ ...s, meta });
}

class SimSession {
  /**
   * @param schema 검증된 스키마
   * @param backend 스냅샷 백엔드 (MapBackend | pluginStorage 어댑터)
   * @param opts { chatId, prefix, stableRng=true, random=Math.random }
   */
  constructor(schema, backend, opts = {}) {
    this.schema = schema;
    this.chatId = opts.chatId ?? 'chat';
    this.stableRng = opts.stableRng !== false && schema.rerollStableRng !== false;
    this.random = opts.random ?? Math.random;
    this.store = new SnapshotStore(backend, opts.prefix ?? `sim:${this.chatId}`, opts.keepN ?? 60);
    this.current = null; // 마지막으로 확정된 라이브 상태
  }

  _rng(index, label) {
    return this.stableRng ? seededRng(this.chatId, index, label) : makeUnstableRng(this.random);
  }

  /** 채팅 로드/최초 시작. latestOutIndex = 현재 채팅의 마지막 char 메시지 인덱스 (없으면 -1) */
  async init(latestOutIndex = -1) {
    if (latestOutIndex >= 0) {
      const found = await this.store.latestAtOrBelow('out', latestOutIndex);
      if (found) { this.current = engine.reconcileState(this.schema, found.state); return this.current; }
    }
    // 시작 시각 무작위(v0.80)용 rng — 인덱스를 -1로 둬 어느 턴과도 안 겹치는 시드를 쓴다.
    // 리롤 안정이 켜져 있으면 chatId로만 갈리므로 **이 채팅은 늘 같은 시각**, 새 채팅은 새 시각.
    this.current = engine.initState(this.schema, { rng: this._rng(-1, 'start') });
    return this.current;
  }

  /** 액션 토글 (턴 사이). 반환 { armed, blocked? } */
  toggle(actionId) {
    const r = engine.toggleAction(this.schema, this.current, actionId);
    this.current = r.state;
    return r;
  }

  /**
   * 전송 시점 (beforeRequest). sendIndex = 이번에 추가된 유저 메시지의 인덱스
   * (리롤이면 지난번과 같은 값이 다시 들어온다)
   * 반환 { promptBlock, state, changeLog, consumedActions }
   */
  async onSend(sendIndex, userText = '') {
    const existingPre = await this.store.load('pre', sendIndex);
    let base = existingPre ?? this.current ?? engine.initState(this.schema);
    let branched = false;
    if (existingPre) {
      // 유령 시간선 대조 (v1.7.3) — pre:U는 out:U-1(+턴 사이 무장)에서 파생된 캐시다. 직전 응답이
      // 그 뒤로 바뀌었다면(메시지 삭제 후 새 진행·패널 보정) 이 pre:U는 지워진 시간선의 유물이다.
      // 리롤은 out:U-1이 그대로라 혈통이 같고, 그때는 종전대로 pre:U로 멱등하게 돈다.
      const prevOut = await this.store.load('out', sendIndex - 1);
      if (prevOut) {
        const keyPrev = lineageKey(this.schema, prevOut);
        if (keyPrev !== lineageKey(this.schema, existingPre)) {
          branched = true;
          // current가 out:U-1과 같은 혈통이면(= 거기에 무장만 얹은 상태) 무장을 살려 current로,
          // 아니면 out:U-1로. current를 무조건 쓰면 안 된다 — 리롤 중 패널 보정이면 current는 응답 뒤 상태다.
          base = this.current && lineageKey(this.schema, this.current) === keyPrev ? this.current : prevOut;
          await this.store.pruneFrom(sendIndex);   // 옛 미래(pre/send/out ≥ U)는 여기서 끝난다
        }
      }
    }
    if (!existingPre || branched) await this.store.save('pre', sendIndex, base);
    // userText (v1.6.0): 전투 안무의 맡김/내 수 판단용 — 굴림과 무관하니 리롤 안정성은 그대로
    const r = engine.sendPhase(this.schema, base, { rng: this._rng(sendIndex, 'send'), userText });
    await this.store.save('send', sendIndex, r.state);
    this.current = r.state;
    return r;
  }

  /**
   * 응답 시점 (afterRequest/output). outIndex = 이번 char 메시지 인덱스 (= sendIndex + 1)
   * auxText: 보조 모델의 원문 응답 (null이면 변화 없음으로 처리)
   * 반환 { state, changeLog, firedEvents, auxParsed }
   */
  async onOutput(outIndex, auxText, seenText = null) {
    const sendState = (await this.store.load('send', outIndex - 1)) ?? this.current;
    const parsed = engine.parseAuxResponse(auxText) ?? { changes: {}, reasons: {} };
    const r = engine.outputPhase(this.schema, sendState, parsed.changes, parsed.reasons, {
      rng: this._rng(outIndex, 'output'),
      seenText,   // 프롬프트에 안 실린 변수는 여기서도 안 받는다
      suggest: parsed.suggest ?? null, // 다음 행동 제안 (v0.43) — 같은 응답에 실려 온다
      conflicts: parsed.conflicts ?? null, // 서사-시스템 불일치 신고 (v0.71) — 통지로만
      detected: parsed.detected ?? null, // 감지 신고 (v0.74) — 다음 전송 1회 낱말 해제
      board: parsed.board ?? null, // 커뮤니티 보드 델타 (v0.95) — 같은 응답에 실려 온다
      shop: parsed.shop ?? null,   // 상점 첫 입고 (v0.96) — 같은 응답에 실려 온다
      msgr: parsed.msgr ?? null,   // 메신저 선톡 (v1.2.0) — 같은 응답에 실려 온다
      dayPassed: parsed.dayPassed === true, // 하루 넘김 신고 (v1.7.0) — dayClose 액션을 대신 돌린다
    });
    await this.store.save('out', outIndex, r.state);
    this.current = r.state;
    return { ...r, auxParsed: parsed };
  }

  /** 보조 모델 프롬프트 (호스트가 LLM 호출에 사용). 전송 후 상태 기준 */
  getAuxPrompt(narrative, userText) {
    return engine.buildAuxPrompt(this.schema, this.current, narrative, userText);
  }

  // ── 최초 설정 (세션 0) ──────────────────────────────────

  /** 이번 응답을 최초설정으로 처리해야 하나 (send:U 상태 기준으로 판단) */
  async isSetupTurn(outIndex) {
    const sendState = (await this.store.load('send', outIndex - 1)) ?? this.current;
    return engine.isSetupPending(this.schema, sendState);
  }

  getSetupPrompt(narrative) {
    return engine.buildSetupPrompt(this.schema, this.current, narrative);
  }

  /** 최초설정 응답 처리 — 절대값 적용, 틱 없음. 리롤 규약은 onOutput과 동일 */
  async onSetupOutput(outIndex, auxText) {
    const sendState = (await this.store.load('send', outIndex - 1)) ?? this.current;
    const parsed = engine.parseSetupResponse(auxText) ?? { values: {}, reasons: {} };
    const r = engine.setupPhase(this.schema, sendState, parsed.values, parsed.reasons);
    await this.store.save('out', outIndex, r.state);
    this.current = r.state;
    return { ...r, auxParsed: parsed };
  }

  /** 프리셋 적용 (새 시작 시점에) */
  applyPreset(presetId) {
    const r = engine.applyPreset(this.schema, this.current, presetId);
    this.current = r.state;
    return r.applied;
  }

  /** 완전 초기화: 이 채팅의 스냅샷 전부 삭제 + 초기 상태로 */
  async resetAll(onProgress = null) {
    const prefix = this.store.p + ':';
    const mine = (await this.store.b.keys()).filter((k) => k.startsWith(prefix));
    onProgress?.(0, mine.length, '스냅샷 삭제 중');
    await mapLimited(mine, IO_CONCURRENCY, (k) => this.store.b.remove(k),
      (d, t) => onProgress?.(d, t, '스냅샷 삭제 중'));
    // 초기화는 리롤이 아니라 "판을 지우고 새로 시작"이다 — 시작 시각 무작위를 켰다면
    // **여기서는 새로 굴린다** (chatId 시드를 쓰면 초기화해도 늘 같은 시각이 나온다).
    this.current = engine.initState(this.schema, { rng: makeUnstableRng(this.random) });
    return this.current;
  }

  /**
   * 세이브 데이터 내보내기: 현재 상태 + 이 채팅의 모든 스냅샷
   * @param onProgress (done, total, phase) — 스냅샷이 많으면 오래 걸리므로 진행 보고
   */
  async exportData(lastOutIndex = -1, onProgress = null) {
    const snapshots = {};
    const prefix = this.store.p + ':';
    onProgress?.(0, 1, '스냅샷 목록 확인 중');
    const mine = (await this.store.b.keys()).filter((k) => k.startsWith(prefix));
    onProgress?.(0, mine.length, '스냅샷 읽는 중');
    const vals = await mapLimited(mine, IO_CONCURRENCY, (k) => this.store.b.get(k),
      (d, t) => onProgress?.(d, t, '스냅샷 읽는 중'));
    mine.forEach((k, i) => { snapshots[k.slice(prefix.length)] = vals[i]; });
    return {
      simcoreSave: 1,
      schemaName: this.schema.meta?.name ?? null,
      schema: this.schema, // 스키마 동봉 — 캐릭터의 스키마가 날아가도 세이브만으로 완전 복구 가능
      chatId: this.chatId,
      lastOutIndex,
      current: this.current,
      snapshots,
    };
  }

  /**
   * 세이브 데이터 가져오기.
   * 같은 채팅으로 되돌리는 경우(백업 복원)에는 메시지 인덱스가 그대로 맞으므로 스냅샷 이력을
   * 통째로 되살려 리롤·삭제 복원까지 유지한다.
   * 다른 채팅으로 이식하는 경우에는 저장된 인덱스가 이 채팅의 메시지 번호와 무관하므로
   * 기존 스냅샷을 비우고 현재 채팅의 마지막 char 메시지 위치에 상태를 앵커한다.
   * (안 그러면 이 채팅이 길어져 저장된 인덱스에 도달하는 순간 과거 스냅샷이 되살아나
   *  상태가 통째로 과거로 튄다.)
   * @param anchorIndex 현재 채팅의 마지막 char 메시지 인덱스 (없으면 -1)
   * @param onProgress (done, total, phase)
   */
  async importData(data, anchorIndex = -1, onProgress = null) {
    if (!data || data.simcoreSave !== 1 || !data.current?.vars) return false;
    const sameChat = !!data.chatId && data.chatId === this.chatId;
    const prefix = this.store.p + ':';
    if (sameChat) {
      // 파일이 진실이다 (v1.7.3) — 파일에 없는 스냅샷은 지운다. 병합이면 유저가 파일에서 지운 턴이
      // 저장소에 그대로 남아 채팅이 그 번호에 닿는 순간 되살아난다 (실기 제보: "세이브 내보내서
      // 456 지워도 또 어디서 똑같은 거 긁어온다" — 완전 초기화 뒤 가져와야 비로소 먹혔다).
      const stale = (await this.store.b.keys())
        .filter((k) => k.startsWith(prefix) && /:(pre|send|out):\d+$/.test(k));
      onProgress?.(0, stale.length, '기존 스냅샷 정리 중');
      await mapLimited(stale, IO_CONCURRENCY, (k) => this.store.b.remove(k),
        (d, t) => onProgress?.(d, t, '기존 스냅샷 정리 중'));
      const entries = Object.entries(data.snapshots || {})
        .filter(([suffix]) => /^(pre|send|out):\d+$/.test(suffix));
      onProgress?.(0, entries.length, '스냅샷 복원 중');
      await mapLimited(entries, IO_CONCURRENCY, ([suffix, raw]) => this.store.b.set(prefix + suffix, raw),
        (d, t) => onProgress?.(d, t, '스냅샷 복원 중'));
      this.current = engine.reconcileState(this.schema, JSON.parse(JSON.stringify(data.current)));
    } else {
      onProgress?.(0, 1, '기존 스냅샷 정리 중');
      const mine = (await this.store.b.keys()).filter((k) => k.startsWith(prefix));
      await mapLimited(mine, IO_CONCURRENCY, (k) => this.store.b.remove(k),
        (d, t) => onProgress?.(d, t, '기존 스냅샷 정리 중'));
      this.current = engine.reconcileState(this.schema, JSON.parse(JSON.stringify(data.current)));
      onProgress?.(0, 1, '상태 앵커 저장 중');
      await this.store.save('out', Math.max(0, anchorIndex), this.current);
      onProgress?.(1, 1, '상태 앵커 저장 중');
    }
    return { ok: true, sameChat };
  }

  /**
   * CBS 미러(chat.scriptstate)에서 상태 복구 — 스냅샷이 없는 채팅(다른 기기에서
   * 가져온 채팅 등)용 최후 수단. 변수 값만 복원되고 쿨다운·대기 이벤트는 초기화된다.
   */
  restoreFromMirror(scriptstate) {
    const state = require('./engine').initState(this.schema);
    let restored = 0;
    for (const v of this.schema.vars) {
      const raw = scriptstate?.['$' + v.id];
      if (raw == null || raw === 'null') continue;
      let val = raw;
      if (v.type === 'int' || v.type === 'float') { val = Number(raw); if (!isFinite(val)) continue; }
      else if (v.type === 'bool') val = raw === 'true' || raw === '1';
      const to = require('./engine').coerce(v, val);
      if (to === undefined) continue;
      state.vars[v.id] = to;
      restored++;
    }
    // 엔진 턴 근사: turn 계열 변수가 있으면 그걸 따라감 (없으면 0에서 재시작)
    if (typeof state.vars.turn === 'number') state.meta.turn = Math.max(0, state.vars.turn - 1);
    this.current = state;
    return restored;
  }

  /** 수동 보정 (플러그인 패널). outIndex 스냅샷을 덮어써 리롤과 정합 유지 */
  async manualSet(outIndex, varId, value) {
    const def = this.schema.vars.find((v) => v.id === varId);
    if (!def) return false;
    const to = engine.coerce(def, value);
    if (to === undefined) return false;
    this.current.vars[varId] = to;
    await this.store.save('out', outIndex, this.current);
    return true;
  }
}

module.exports = { SimSession };
