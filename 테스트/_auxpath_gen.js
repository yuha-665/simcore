
const store = new Map();
let argValue = '';
const LUA_BRIDGE_COMMENT = 'simcore-bridge';
const hasLuaBridge = (char) => (char && char.triggerscript || []).some((t) => t.comment === LUA_BRIDGE_COMMENT);
const Risuai = {
  pluginStorage: {
    getItem: async (k) => (store.has(k) ? store.get(k) : null),
    setItem: async (k, v) => { store.set(k, v); },
  },
  getArgument: async () => argValue,
  getCharacter: async () => globalThis.__char,
};
let lastAux = { status: '', raw: '', applied: 0 };
  const AUX_PATH_KEY = 'sim:auxpath';
  let auxPathCache = undefined; // 'direct' | 'bridge' | null(미판정)

  async function getAuxPath() {
    if (auxPathCache === undefined) {
      try { auxPathCache = (await Risuai.pluginStorage.getItem(AUX_PATH_KEY)) || null; }
      catch { auxPathCache = null; }
    }
    return auxPathCache;
  }

  async function setAuxPath(v) {
    if (auxPathCache === v) return;
    auxPathCache = v;
    try { await Risuai.pluginStorage.setItem(AUX_PATH_KEY, v); } catch {}
    console.log('[simcore] 보조모델 경로 판정:', v === 'bridge' ? '차단 → 루아 브리지' : '직접 호출 가능');
  }

  /**
   * 이번 턴에 쓸 경로를 결정한다.
   * 설정값이 aux/lua/off면 그 지시를 따르고, auto(기본)면 판정 결과를 따른다.
   * 아직 판정 전이면 직접 호출을 시도해본다 — 차단이면 그 자리에서 브리지로 굳는다.
   * @returns 'aux' | 'lua' | 'off'
   */
  async function resolveAuxMode() {
    const arg = (await Risuai.getArgument('aux_model_mode')) || 'auto';
    if (arg === 'aux' || arg === 'lua' || arg === 'off') return arg;
    return (await getAuxPath()) === 'bridge' ? 'lua' : 'aux';
  }

  // ── mentions 침묵 실패 감지 ────────────────────────────────
  // 한국어 낱말 + 영어 채팅처럼 낱말이 채팅 언어와 어긋나면 그 변수는 조용히 영영 안 열린다.
  // 에러가 없는 실패라 원인 찾기가 제일 힘든 유형 → 연속 미개방을 세서 패널에서 소리 나게 한다.
  // (aux 직접 호출 경로 전용 — 루아 브리지는 mentions 필터를 안 쓰므로 셀 것도 없다)
  const MENTION_WARN_TURNS = 6;
  let mentionGate = { turns: 0, opened: {} }; // opened[id] = 열린 횟수 (세션 로드마다 리셋)

  function trackMentionGates(seenText) {
    try {
      const gated = (schema?.updater?.allow || []).filter((a) => a.mentions);
      if (!gated.length || seenText == null) return;
      mentionGate.turns++;
      const open = new Set(engine.auxAllowList(schema, seenText).map((a) => a.id));
      for (const a of gated) if (open.has(a.id)) mentionGate.opened[a.id] = (mentionGate.opened[a.id] || 0) + 1;
    } catch (e) { console.log('[simcore] mentions 추적 실패:', e.message); }
  }

  function mentionGateWarning() {
    const gated = (schema?.updater?.allow || []).filter((a) => a.mentions);
    if (!gated.length || mentionGate.turns < MENTION_WARN_TURNS) return '';
    // whenArmed(액션 잠금)가 같이 걸린 변수는 제외 — 액션을 안 눌러서 닫혀 있는 건 정상이다
    const silent = gated.filter((a) => !a.whenArmed && !(mentionGate.opened[a.id] > 0)).map((a) => a.id);
    if (!silent.length) return '';
    return `\n⚠ 낱말 잠금(mentions) 변수 ${silent.join(', ')} — 최근 ${mentionGate.turns}턴 동안 한 번도 안 열림.`
      + ` 낱말이 채팅 언어와 맞는지 확인할 것 (영챗이면 '골드' 대신 'gold'도 병기)`;
  }


  const BRIDGE_GEN = 2;

  function schemaFingerprint(sch) {
    const src = JSON.stringify({ g: BRIDGE_GEN, v: (sch.vars || []).map((v) => [v.id, v.type, v.label]),
      a: sch.updater?.allow ?? [], c: sch.updater?.contextTurns ?? 1 });
    let h = 2166136261 >>> 0;
    for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  const BRIDGE_SIG_RE = /--\s*simcore-schema:\s*([0-9a-z]+)/;

  /** 설치된 브리지가 현재 스키마로 구워진 것인지 (없으면 null) */
  function bridgeSchemaSig(char) {
    const t = (char?.triggerscript || []).find((x) => x.comment === LUA_BRIDGE_COMMENT);
    const code = t?.effect?.[0]?.code;
    const m = typeof code === 'string' ? code.match(BRIDGE_SIG_RE) : null;
    return m ? m[1] : null;
  }

  function bridgeIsStale(char, sch) {
    if (!hasLuaBridge(char) || !sch) return false;
    const got = bridgeSchemaSig(char);
    return got === null || got !== schemaFingerprint(sch); // 서명 없는 구버전 브리지도 노후로 본다
  }


module.exports = { getAuxPath, setAuxPath, resolveAuxMode, schemaFingerprint, bridgeIsStale, bridgeSchemaSig,
  _setArg: (v) => { argValue = v; }, _store: store, _resetCache: () => { auxPathCache = undefined; } };
