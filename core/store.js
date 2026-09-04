// 스냅샷 저장소 — 리롤/삭제 안전성의 기반.
// backend: { get(k)->string|null, set(k,v), remove(k), keys()->string[] } (전부 동기 or Promise)
// 리스 어댑터에서는 pluginStorage, 테스트/플레이그라운드에서는 Map 백엔드.

class MapBackend {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  set(k, v) { this.m.set(k, v); }
  remove(k) { this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}

class SnapshotStore {
  /** prefix 예: `sim:${chaId}:${chatId}` */
  constructor(backend, prefix, keepN = 60) {
    this.b = backend;
    this.p = prefix;
    this.keepN = keepN;
  }

  _k(phase, index) { return `${this.p}:${phase}:${index}`; }

  async save(phase, index, state) {
    await this.b.set(this._k(phase, index), JSON.stringify(state));
    await this._prune();
  }

  async load(phase, index) {
    const raw = await this.b.get(this._k(phase, index));
    return raw ? JSON.parse(raw) : null;
  }

  /** index 이하에서 가장 최근의 해당 phase 스냅샷 (메시지 삭제 복구용) */
  async latestAtOrBelow(phase, index) {
    const re = new RegExp(`^${escapeRe(this.p)}:${phase}:(\\d+)$`);
    let best = -1;
    for (const k of await this.b.keys()) {
      const m = k.match(re);
      if (m) {
        const i = parseInt(m[1], 10);
        if (i <= index && i > best) best = i;
      }
    }
    return best >= 0 ? { index: best, state: await this.load(phase, best) } : null;
  }

  /**
   * index 이상의 pre/send/out 스냅샷을 지운다 — 시간선이 갈라진 지점부터 "지워진 미래"를 치운다 (v1.7.3).
   * 메시지를 지우고 새로 진행하면 옛 턴의 스냅샷이 저장소에 남아 채팅이 그 번호에 다시 닿는 순간
   * 되살아났다 (실기 제보: ⟦simcore:456⟧). 반환: 지운 키 수
   */
  async pruneFrom(index) {
    const re = new RegExp(`^${escapeRe(this.p)}:(pre|send|out):(\\d+)$`);
    const doomed = [];
    for (const k of await this.b.keys()) {
      const m = k.match(re);
      if (m && parseInt(m[2], 10) >= index) doomed.push(k);
    }
    await mapLimited(doomed, 12, (k) => this.b.remove(k));
    return doomed.length;
  }

  async _prune() {
    const re = new RegExp(`^${escapeRe(this.p)}:(pre|send|out):(\\d+)$`);
    const entries = [];
    for (const k of await this.b.keys()) {
      const m = k.match(re);
      if (m) entries.push({ k, index: parseInt(m[2], 10) });
    }
    if (entries.length <= this.keepN * 3) return;
    entries.sort((a, b) => b.index - a.index);
    const cutoff = new Set(entries.slice(0, this.keepN * 3).map((e) => e.k));
    for (const e of entries) if (!cutoff.has(e.k)) await this.b.remove(e.k);
  }
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * 항목을 limit개씩 동시에 처리한다 (진행 콜백 지원).
 * 리스 어댑터에서 백엔드 호출 하나하나가 샌드박스 iframe 왕복이라, 순차로 돌리면
 * 스냅샷 수에 비례해 눈에 띄게 느려진다. 묶어서 동시에 던지면 왕복 지연이 겹쳐 사라진다.
 */
async function mapLimited(items, limit, fn, onTick) {
  const out = [];
  let done = 0;
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const res = await Promise.all(chunk.map((it) => fn(it)));
    out.push(...res);
    done += chunk.length;
    if (onTick) onTick(done, items.length);
  }
  return out;
}

module.exports = { SnapshotStore, MapBackend, mapLimited };
