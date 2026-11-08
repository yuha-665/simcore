
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

  // ── 플러그인 설정 두 칸 기억 (v1.22.1) ──────────────────────
  // 리수는 업데이트(🔔 버튼)와 손 임포트 때 @arg 값을 기본값('')으로 되돌린다 (importPlugin이 pluginData를 새로 만든다 — risu-facts).
  // 버튼이 생기면 업데이트가 잦아져서 module_assets=on(이미지가 모듈에 사는 봇)은 업데이트마다 이미지가 사라진다.
  // 그래서 칸에 **적힌** 값을 pluginStorage(업데이트에도 남는다)에 기억해 두고, 칸이 비어 있으면 그 값을 이어 쓴다.
  // 기본값으로 돌아가려면 칸에 기본값(auto·off)을 직접 적는다 — 그것도 기억된다. 모르는 값은 예전처럼 기본값으로 읽고 기억하지 않는다.
  // 목록은 함수 안에 둔다 — 최상위 const는 부팅 순서에 따라 TDZ에 걸린다 (v1.0.7 스코프 사고와 같은 유형).
  function argChoices(key) {
    return key === 'aux_model_mode' ? ['auto', 'aux', 'lua', 'off'] : key === 'module_assets' ? ['off', 'on'] : [''];
  }
  /** @returns {{ value: string, from: 'typed'|'kept'|'default'|'invalid', raw: string }} */
  async function readArg(key) {
    const choices = argChoices(key);
    const saved = (readArg.saved ??= {}); // 이번 실행에서 저장소에 이미 적어 둔 값 — 같은 값이면 저장소를 다시 안 건드린다
    let raw = '';
    try { raw = String((await Risuai.getArgument(key)) ?? '').trim().toLowerCase(); } catch { raw = ''; } // 'Lua '·' lua' 도 (v1.14.10)
    const storeKey = `sim:arg:${key}`;
    if (raw && choices.includes(raw)) {
      if (saved[key] !== raw) {
        try { await Risuai.pluginStorage.setItem(storeKey, raw); saved[key] = raw; } catch { /* 기억 못 해도 이번 값은 쓴다 */ }
      }
      return { value: raw, from: 'typed', raw };
    }
    if (!raw) {
      try {
        const kept = await Risuai.pluginStorage.getItem(storeKey);
        if (kept && choices.includes(kept)) return { value: kept, from: 'kept', raw };
      } catch { /* 저장소를 못 읽으면 기본값 */ }
    }
    return { value: choices[0], from: raw ? 'invalid' : 'default', raw };
  }
  /** 패널 표시용 — 칸이 비어 지난 값을 이어 쓰는 중이면 그렇다고 말한다 */
  function argLabel(r) {
    if (r.from === 'kept') return `${r.value} (칸이 비어 있어 지난 설정을 이어 씀 — 업데이트하면 리수가 칸을 비운다)`;
    if (r.from === 'invalid') return `'${r.raw}'는 모르는 값 → ${r.value}`;
    if (r.from === 'default') return `${r.value}(기본)`;
    return r.value;
  }

  /**
   * 이번 턴에 쓸 경로를 결정한다.
   * 설정값이 aux/lua/off면 그 지시를 따르고, auto(기본)면 판정 결과를 따른다.
   * 아직 판정 전이면 직접 호출을 시도해본다 — 차단이면 그 자리에서 브리지로 굳는다.
   * @returns 'aux' | 'lua' | 'off'
   */
  async function resolveAuxMode() {
    const arg = (await readArg('aux_model_mode')).value; // 칸이 비면 지난 설정 (v1.22.1)
    if (arg === 'aux' || arg === 'lua' || arg === 'off') return arg;
    return (await getAuxPath()) === 'bridge' ? 'lua' : 'aux';
  }

  // ── 생성 모델 슬롯 (내장 AI 생성 전용) ─────────────────────
  // 보조 모델(submodel)은 번역·요약용 싼 모델이 꽂혀 있는 자리인데, 스키마 생성은 이
  // 생태계에서 가장 길고 어려운 출력이다 — 첫 시도가 쓰레기면 기능이 거기서 죽는다 (공홈 피드백).
  // 어느 모델로 생성할지는 봇이 아니라 기기·유저의 속성이므로 pluginStorage(로컬)에 둔다.
  const GEN_MODEL_KEY = 'sim:genmodel'; // JSON { choice:'aux'|'main'|'static'|'cli', staticId, cliUrl, cliModel }
  // 메인 모델 경로의 자기 요청 식별표 — beforeRequest가 이걸 보면 주입·정산 없이 통과시킨다.
  // (⟦simcore:N⟧ 마커와 다른 꼴이라 기존 MARKER_RE 제거에 안 걸린다 — 전용 분기에서 지운다)
  const GEN_SENTINEL = '⟦simcore:gen⟧';

  async function getGenModel() {
    try {
      const raw = await Risuai.pluginStorage.getItem(GEN_MODEL_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v && (v.choice === 'aux' || v.choice === 'main' || v.choice === 'static' || v.choice === 'cli')) {
        return { choice: v.choice, staticId: String(v.staticId || ''),
          cliUrl: String(v.cliUrl || CLI_DEFAULT_URL), cliModel: String(v.cliModel || 'claude-code') };
      }
    } catch { /* 깨진 저장값은 기본값으로 */ }
    return { choice: 'aux', staticId: '', cliUrl: CLI_DEFAULT_URL, cliModel: 'claude-code' };
  }

  async function setGenModel(v) {
    try {
      await Risuai.pluginStorage.setItem(GEN_MODEL_KEY,
        JSON.stringify({ choice: v && v.choice ? v.choice : 'aux', staticId: (v && v.staticId) || '',
          cliUrl: (v && v.cliUrl) || '', cliModel: (v && v.cliModel) || '' }));
    } catch (e) { console.log('[simcore] 생성 모델 저장 실패:', e.message); }
  }

  // ── 이 PC의 Claude Code · Codex (v1.15.0) ─────────────────────────────
  // 편집기 생성을 리수 모델 대신 PC에서 켜 둔 다리(tools/cli-bridge)로 보낸다. 플러그인은 샌드박스라 프로세스를
  // 못 띄우므로 HTTP 한 번이 전부다 — Risuai.nativeFetch (리수 데스크톱은 네이티브, 셀프호스트는 서버 프록시,
  // 웹은 [직접 요청 보내기](usePlainFetch)를 켜야 localhost에 닿는다 — 실험적. 포켓리스는 불가). RP 채팅·상태 갱신은 건드리지 않는다 —
  // callGenLLM만 이 길을 탄다. 다리는 본문을 어디에도 안 남기고, 이쪽도 인증 정보를 모른다.
  const CLI_DEFAULT_URL = 'http://127.0.0.1:5181';
  const cliBase = (url) => String(url || CLI_DEFAULT_URL).trim().replace(/\/+$/, '');
  async function cliFetch(url, init) {
    if (typeof Risuai.nativeFetch !== 'function') throw new Error('이 리수 버전엔 nativeFetch가 없어요 — 리수를 업데이트해 주세요');
    const res = await Risuai.nativeFetch(url, init);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { status: res.status, body, text };
  }
  // 리수 화면에 "plain fetch"라는 이름은 없다 — 한국어 UI는 고급 설정 → [비권장 설정 보이기]를 켜야 나오는 [직접 요청 보내기] (v1.21.2 실기)
  const CLI_WEB_PATH = '고급 설정 → [비권장 설정 보이기]를 켜면 나오는 [직접 요청 보내기]';
  const cliErr = (e) => {
    const m = String(e?.message ?? e);
    if (/fetch|network|ECONNREFUSED|refused|load failed|closed|timeout|timed out/i.test(m)) {
      return `다리에 닿지 못했어요 (${m.slice(0, 80)}) — 이 PC에서 cli-bridge.bat 창이 켜져 있는지, 주소가 맞는지 확인해 주세요. 웹 리수는 ${CLI_WEB_PATH}를 켜야 닿고(브라우저가 로컬 네트워크 접근을 물으면 허용), 포켓리스에서는 쓸 수 없어요.`;
    }
    return m;
  };
  // 웹 리수가 [직접 요청 보내기]를 안 켜면 nativeFetch는 리수 프록시(Cloudflare)로 가고, 프록시가 127.0.0.1을 대신 부르다 막혀
  // 403 "error code: 1003"(Cloudflare — IP 직접 접속 불가)이 온다. 다리엔 아무것도 안 닿는다 — 다리는 이 꼴의 답을 안 낸다.
  // 전엔 "다리가 이상한 답을 했어요 (HTTP 403): error code: 1003"으로 떠 다리를 의심하게 했다 (v1.21.2 실기 — 웹 리수, 다리 창엔 아무 줄도 없음)
  const cliViaWebProxy = (r) => /^\s*error code:\s*1\d{3}\b/i.test(r.text || '');
  const CLI_WEB_PROXY_MSG = `웹 리수가 리수 서버를 거쳐 보내서 이 PC의 다리에 못 닿았어요 — ${CLI_WEB_PATH}를 켜고 다시 확인해 주세요. `
    + '실험적이에요: 리수의 모든 요청이 브라우저에서 바로 나가서 모델에 따라 오류가 날 수 있으니, 다리를 쓸 때만 켜 두세요.';
  // 리수 서버가 대신 접속하는 환경(셀프호스트·RisuBard의 /proxy2, 웹의 리수 프록시)에선 다리에 못 닿은 것이 예외가 아니라
  // 서버의 5xx 응답으로 온다 — {"error":"fetch failed"}(서버 쪽 Node fetch의 ECONNREFUSED). 다리 자신의 오류는 늘 {error:{message}}
  // 객체라 문자열 error로 가른다. 전엔 이게 "다리가 이상한 답을 했어요 (HTTP 500)"로 떠 다리를 의심하게 했다 (v1.20.2 실기 — RisuBard에서 다리를 안 켠 채 확인)
  const cliUnreached = (r) => r.status >= 500 && r.body && typeof r.body.error === 'string'
    && /fetch failed|ECONNREFUSED|refused|connect|timed out|aborted|network/i.test(r.body.error);
  const cliUnreachedMsg = (r) => cliErr(new Error(`리수 서버가 대신 접속하다 실패 — ${r.body.error}`));
  // 연결 확인 — 편집기의 [🔌 연결 확인]. 백엔드 상태와 고를 수 있는 모델 목록을 돌려준다.
  async function probeCli(url) {
    try {
      const r = await cliFetch(cliBase(url) + '/health?refresh=1', { method: 'GET', headers: {} });
      if (cliUnreached(r)) return { error: cliUnreachedMsg(r) };
      if (cliViaWebProxy(r)) return { error: CLI_WEB_PROXY_MSG };
      if (!r.body || !r.body.ok) return { error: `다리가 이상한 답을 했어요 (HTTP ${r.status}): ${r.text.slice(0, 80)}` };
      return { ok: true, version: r.body.version, backends: r.body.backends || {},
        models: Array.isArray(r.body.models) ? r.body.models.map((m) => ({ id: m.id, label: m.label || m.id })) : [] };
    } catch (e) { return { error: cliErr(e) }; }
  }
  async function callCliLLM(gm, messages) {
    try {
      const r = await cliFetch(cliBase(gm.cliUrl) + '/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: gm.cliModel || 'claude-code', messages, stream: false }),
      });
      const text = r.body?.choices?.[0]?.message?.content;
      if (r.status === 200 && typeof text === 'string' && text.trim()) return text;
      if (cliUnreached(r)) return { error: `이 PC의 Claude Code·Codex: ${cliUnreachedMsg(r)}` };
      if (cliViaWebProxy(r)) return { error: `이 PC의 Claude Code·Codex: ${CLI_WEB_PROXY_MSG}` };
      const msg = r.body?.error?.message || r.text.slice(0, 160) || `HTTP ${r.status}`;
      return { error: `이 PC의 Claude Code·Codex: ${msg}` };
    } catch (e) { return { error: `이 PC의 Claude Code·Codex: ${cliErr(e)}` }; }
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
  // [live-test] 리수 DB에서 메인·보조 모델의 내부 id를 읽는다 — 설정 화면은 표시명만 보여줘서
  // 유저가 staticModel에 넣을 id를 알 방법이 없다. 읽기 API가 없는 버전이면 null.
  async function getModelIds() {
    try {
      const db = await (Risuai.getDatabase ? Risuai.getDatabase() : null);
      if (db && (db.aiModel || db.subModel)) {
        return { main: String(db.aiModel || ''), sub: String(db.subModel || '') };
      }
    } catch (e) { console.log('[simcore] 모델 id 읽기 실패:', e.message); }
    return null;
  }

  // 실패는 { error: '사유' }로 돌려준다 — 편집기가 그대로 화면에 띄운다.
  // "이동은 했는데 아무것도 안 옴"은 디버깅이 불가능한 최악의 실패 모양이다 (실기 제보).
  // input: 프롬프트 문자열(단발 생성) 또는 { system, messages:[{role:'user'|'assistant', content}] } (💬 대화, v1.9.0).
  // 대화는 시스템 뒤에 이력이 그대로 붙는다 — 세 경로(보조·메인·직접 지정) 모두 같은 배열을 쓴다.
  async function callGenLLM(input) {
    const chatIn = input && typeof input === 'object' ? input : null;
    const promptText = chatIn ? String(chatIn.system || '') : String(input ?? '');
    const buildMessages = (sys) => chatIn
      ? [{ role: 'system', content: sys }, ...(chatIn.messages || []).map((m) => ({
          role: m.role === 'ai' || m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') }))]
      : [{ role: 'system', content: sys }, { role: 'user', content: AUX_NUDGE }];
    const gm = await getGenModel();
    if (gm.choice === 'cli') return callCliLLM(gm, buildMessages(promptText)); // 이 PC 다리 (v1.15.0) — 리수 모델 안 거침
    if (gm.choice === 'aux' || (gm.choice === 'static' && !gm.staticId.trim())) {
      const r = await callAuxLLM(promptText, 8000, chatIn ? buildMessages(promptText) : null);
      if (r === null) return { error: `보조 경로: ${lastAux.status}` };
      return r; // 문자열 또는 { blocked }
    }
    try {
      const req = gm.choice === 'main'
        ? { mode: 'model', messages: buildMessages(GEN_SENTINEL + '\n' + promptText), allowPlugins: true }
        : { mode: 'submodel', staticModel: gm.staticId.trim(), messages: buildMessages(promptText), allowPlugins: true };
      const res = await Risuai.runLLMModel(req);
      const text = await extractLLMText(res);
      console.log(`[simcore] 생성 호출(${gm.choice}) →`, res?.type,
        text ? text.slice(0, 120) : JSON.stringify(res)?.slice(0, 120));
      if (res && res.type === 'fail') {
        if (text && /blocked by the caller/i.test(text)) return { blocked: true };
        let err = `${gm.choice === 'main' ? '메인 모델' : '직접 지정'} 호출 실패: ${(text || JSON.stringify(res) || '').slice(0, 140)}`;
        // [실기 확정 2026-07-30] mode:'model'은 리수가 유저 API 키를 안 붙인다 (Claude 공식 API에서
        // x-api-key 누락으로 확인). 요청 자체는 나갔으므로 센티널 bypass는 정상 — 인증만 빠짐.
        if (gm.choice === 'main' && /x-api-key|authentication_error|api.?key/i.test(text || '')) {
          err += ' — 이 환경은 플러그인의 메인 모델 호출에 인증이 안 붙습니다. [직접 지정]에 모델 id를 넣어보거나, 리수 설정의 보조 모델을 상위 모델로 바꾸는 것이 확실합니다.';
        }
        return { error: err };
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


  const BRIDGE_GEN = 3;

  function schemaFingerprint(sch) {
    // 지문은 구워지는 것 전부를 덮어야 한다 (v1.14.6) — 전엔 id·type·label·allow·contextTurns뿐이라 enum·desc·상한·guide·suggest를
    // 바꾼 스키마가 노후로 안 잡혀 옛 선택지로 보조를 불렀고, 보조가 고른 옛 값은 coerce에서 조용히 거부됐다. 템플릿 자체를 해시한다
    let t = '';
    try {
      const fake = { vars: Object.fromEntries((sch.vars || []).map((v) => [v.id, '⟦cur:' + v.id + '⟧'])), meta: {} };
      t = engine.buildAuxPrompt(sch, fake, '⟦NARR⟧', '⟦USER⟧', '⟦HIST⟧', { allowAll: true }) + '\n' + engine.buildSetupPrompt(sch, fake, '⟦NARR⟧');
    } catch { t = ''; }
    const src = JSON.stringify({ g: BRIDGE_GEN, v: (sch.vars || []).map((v) => [v.id, v.type, v.label]),
      a: sch.updater?.allow ?? [], c: sch.updater?.contextTurns ?? 1, t });
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


module.exports = { getAuxPath, setAuxPath, resolveAuxMode, schemaFingerprint, bridgeIsStale, bridgeSchemaSig, readArg, argLabel,
  _setArg: (v) => { argValue = v; }, _store: store, _resetCache: () => { auxPathCache = undefined; readArg.saved = {}; } };
