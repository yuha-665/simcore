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

const engine = require('./engine');
const { SnapshotStore, mapLimited } = require('./store');
const IO_CONCURRENCY = 12; // 샌드박스 브리지 동시 요청 수 (너무 키우면 브리지가 밀린다)
const { seededRng, makeUnstableRng } = require('./rng');

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
    this.current = engine.initState(this.schema);
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
  async onSend(sendIndex) {
    const existingPre = await this.store.load('pre', sendIndex);
    const base = existingPre ?? this.current ?? engine.initState(this.schema);
    if (!existingPre) await this.store.save('pre', sendIndex, base);
    const r = engine.sendPhase(this.schema, base, { rng: this._rng(sendIndex, 'send') });
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
    this.current = engine.initState(this.schema);
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
