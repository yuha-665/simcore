
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

  // ── 생성 모델 슬롯 (내장 AI 생성 전용) ─────────────────────
  // 보조 모델(submodel)은 번역·요약용 싼 모델이 꽂혀 있는 자리인데, 스키마 생성은 이
  // 생태계에서 가장 길고 어려운 출력이다 — 첫 시도가 쓰레기면 기능이 거기서 죽는다 (공홈 피드백).
  // 어느 모델로 생성할지는 봇이 아니라 기기·유저의 속성이므로 pluginStorage(로컬)에 둔다.
  const GEN_MODEL_KEY = 'sim:genmodel'; // JSON { choice:'aux'|'main'|'static', staticId }
  // 메인 모델 경로의 자기 요청 식별표 — beforeRequest가 이걸 보면 주입·정산 없이 통과시킨다.
  // (⟦simcore:N⟧ 마커와 다른 꼴이라 기존 MARKER_RE 제거에 안 걸린다 — 전용 분기에서 지운다)
  const GEN_SENTINEL = '⟦simcore:gen⟧';

  async function getGenModel() {
    try {
      const raw = await Risuai.pluginStorage.getItem(GEN_MODEL_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v && (v.choice === 'aux' || v.choice === 'main' || v.choice === 'static')) {
        return { choice: v.choice, staticId: String(v.staticId || '') };
      }
    } catch { /* 깨진 저장값은 기본값으로 */ }
    return { choice: 'aux', staticId: '' };
  }

  async function setGenModel(v) {
    try {
      await Risuai.pluginStorage.setItem(GEN_MODEL_KEY,
        JSON.stringify({ choice: v && v.choice ? v.choice : 'aux', staticId: (v && v.staticId) || '' }));
    } catch (e) { console.log('[simcore] 생성 모델 저장 실패:', e.message); }
  }

  /**
   * 내장 AI 생성 호출 — 편집기 위층의 generate가 이걸 탄다.
   * - aux(기본): callAuxLLM 그대로 (차단 감지·경로 판정 포함)
   * - main: mode:'model' + GEN_SENTINEL — 우리 beforeRequest는 센티널을 보고 무개입 통과.
   *   ⚠ 센티널 없는 'model' 호출은 여전히 절대 금지 (자기 정산 함정, v0.37.2의 거울상).
   *   [live-test] 다른 플러그인의 'model' 리플레이서는 그대로 탄다 / 응답이 output 핸들러를
   *   타지 않는지(채팅에 안 실리므로 안 탈 것) 확인.
   * - static: mode:'submodel' + staticModel 직접 지정. [live-test] staticModel 지원 범위 —
   *   리수가 무시하면 그냥 보조 모델로 간다 (조용한 폴백, 망가지진 않음).
   */
  // 실패는 { error: '사유' }로 돌려준다 — 편집기가 그대로 화면에 띄운다.
  // "이동은 했는데 아무것도 안 옴"은 디버깅이 불가능한 최악의 실패 모양이다 (실기 제보).
  async function callGenLLM(promptText) {
    const gm = await getGenModel();
    if (gm.choice === 'aux' || (gm.choice === 'static' && !gm.staticId.trim())) {
      const r = await callAuxLLM(promptText, 8000);
      if (r === null) return { error: `보조 경로: ${lastAux.status}` };
      return r; // 문자열 또는 { blocked }
    }
    try {
      const req = gm.choice === 'main'
        ? { mode: 'model',
            messages: [{ role: 'system', content: GEN_SENTINEL + '\n' + promptText }, { role: 'user', content: AUX_NUDGE }],
            allowPlugins: true }
        : { mode: 'submodel', staticModel: gm.staticId.trim(),
            messages: [{ role: 'system', content: promptText }, { role: 'user', content: AUX_NUDGE }],
            allowPlugins: true };
      const res = await Risuai.runLLMModel(req);
      const text = await extractLLMText(res);
      console.log(`[simcore] 생성 호출(${gm.choice}) →`, res?.type,
        text ? text.slice(0, 120) : JSON.stringify(res)?.slice(0, 120));
      if (res && res.type === 'fail') {
        if (text && /blocked by the caller/i.test(text)) return { blocked: true };
        return { error: `${gm.choice === 'main' ? '메인 모델' : '직접 지정'} 호출 실패: ${(text || JSON.stringify(res) || '').slice(0, 140)}` };
      }
      if (typeof text === 'string' && text.trim()) return text;
      return { error: `${gm.choice === 'main' ? '메인 모델' : '직접 지정'} 응답에서 텍스트를 못 뽑음 (${typeof res}): ${JSON.stringify(res)?.slice(0, 120) ?? ''}` };
    } catch (e) {
      console.log('[simcore] 생성 호출 예외:', e.message);
      return { error: `${gm.choice === 'main' ? '메인 모델' : '직접 지정'} 호출 예외: ${e.message}` };
    }
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
