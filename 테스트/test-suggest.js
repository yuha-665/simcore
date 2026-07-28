const __P = (...p) => require('path').resolve(__dirname, ...p);
// 다음 행동 제안(v0.43) — 보조 응답 피기백 → meta.suggestions → 조작줄 칩.
// 요점: ① 추가 호출 없음(같은 aux 응답에 "suggest" 배열) ② 결과는 vars가 아니라 meta
//       ③ 전송하면 소거(낡은 제안 방지) ④ 스키마 옵트인 — 없으면 프롬프트도 그대로다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { validateSchema } = SimCore.require('validate');
const { TEMPLATES } = SimCore.require('templates');
const { seededRng } = SimCore.require('rng');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const clone = (o) => JSON.parse(JSON.stringify(o));

const SM = TEMPLATES.smith.schema; // suggest 실물 예시 (count 3)

// ── 스키마·검증 ──
{
  ck('smith에 suggest 탑재', SM.suggest && SM.suggest.count === 3, JSON.stringify(SM.suggest));
  const v = validateSchema(SM);
  ck('smith 검증 여전히 0경고', v.ok && v.warnings.length === 0,
    v.warnings.map((w) => `${w.path}: ${w.msg}`).join(' / '));
  const bad = clone(SM); bad.suggest = { count: 9 };
  ck('개수 범위(2~4) 밖은 오류', validateSchema(bad).errors.some((e) => e.path === '$.suggest.count'));
  const bad2 = clone(SM); bad2.suggest = [1, 2];
  ck('배열은 오류 (객체여야)', validateSchema(bad2).errors.some((e) => e.path === '$.suggest'));
  const orphan = {
    simcore: '0.1', meta: { name: 'o' }, suggest: { count: 3 },
    vars: [{ id: 'x', label: 'x', type: 'int', init: 0, min: 0, max: 9 }],
    rules: { onTurn: [], events: [], randomEvents: { chancePerTurn: 0, table: [] } },
    statusUI: { mode: 'auto', groups: [] },
  };
  ck('보조 AI 없는 봇의 suggest는 경고', validateSchema(orphan).warnings.some((w) => w.path === '$.suggest'),
    JSON.stringify(validateSchema(orphan).warnings));
}

// ── 보조 프롬프트 피기백 ──
{
  const st = engine.initState(SM);
  const p = engine.buildAuxPrompt(SM, st, '서사', '입력');
  ck('제안 지시가 실린다', p.includes('"suggest"') && p.includes('3개'), p.slice(-400));
  ck('출력 형식에 suggest 예시', p.includes('"suggest": ["행동 제안"'), p.slice(-300));
  ck('스키마 지침도 합류', p.includes('뜻밖의 것'), '');
  const daily = TEMPLATES.daily.schema;
  const p2 = engine.buildAuxPrompt(daily, engine.initState(daily), '서사', '입력');
  ck('suggest 없는 봇 프롬프트는 그대로', !p2.includes('suggest'), '');
}

// ── 파싱·정리 ──
{
  const parsed = engine.parseAuxResponse('{"changes":{},"reasons":{},"suggest":["화로를 살핀다"," 손님과   흥정한다 ",42,""]}');
  ck('suggest 배열 추출', Array.isArray(parsed.suggest) && parsed.suggest.length === 4, JSON.stringify(parsed.suggest));
  const clean = engine.sanitizeSuggestions(SM, parsed.suggest);
  ck('문자열만 + 공백 정리', JSON.stringify(clean) === '["화로를 살핀다","손님과 흥정한다"]', JSON.stringify(clean));
  const many = engine.sanitizeSuggestions(SM, ['a', 'b', 'c', 'd', 'e']);
  ck('개수 상한 = count(3)', many.length === 3, JSON.stringify(many));
  const long = engine.sanitizeSuggestions(SM, ['x'.repeat(200)]);
  ck('길이 80자 상한', long[0].length === 80, String(long[0].length));
  ck('suggest 없는 스키마는 무조건 빈 배열 (옵트인)',
    engine.sanitizeSuggestions(TEMPLATES.daily.schema, ['a']).length === 0, '');
  ck('suggest 없는 응답은 null', engine.parseAuxResponse('{"changes":{},"reasons":{}}').suggest === null, '');
}

// ── 상태 흐름: output에 실리고 send에 소거된다 ──
{
  let st = engine.initState(SM); st.meta.setupDone = true; st.meta.turn = 1;
  const o = engine.outputPhase(SM, st, {}, {}, { rng: seededRng('sg', 1, 'out'), suggest: ['쇠를 두들긴다', '금고를 연다'] });
  ck('outputPhase가 meta.suggestions에 싣는다', JSON.stringify(o.state.meta.suggestions) === '["쇠를 두들긴다","금고를 연다"]',
    JSON.stringify(o.state.meta.suggestions));
  ck('변수가 아니라 meta다 (allow 통제 밖)', !('suggestions' in o.state.vars), '');
  const s = engine.sendPhase(SM, o.state, { rng: seededRng('sg', 2, 'send') });
  ck('전송하면 소거 (낡은 제안 방지)', s.state.meta.suggestions.length === 0, JSON.stringify(s.state.meta.suggestions));
  // 소급 경로(브리지·지연)도 같은 자리에 싣는다
  const a = engine.applyChangesToState(SM, o.state, {}, {}, null, ['새 제안']);
  ck('applyChangesToState 소급 경로도 동일', JSON.stringify(a.state.meta.suggestions) === '["새 제안"]',
    JSON.stringify(a.state.meta.suggestions));
  ck('suggest=null이면 기존 제안 유지', JSON.stringify(engine.applyChangesToState(SM, o.state, {}, {}).state.meta.suggestions)
    === '["쇠를 두들긴다","금고를 연다"]', '');
}

// ── 세션 왕복 (파싱→적용까지 한 줄로) ──
{
  const auxText = '{"changes":{"fame":2},"reasons":{"fame":"소문"},"suggest":["명장을 찾아간다","가게 문을 닫는다"]}';
  const parsed = engine.parseAuxResponse(auxText);
  let st = engine.initState(SM); st.meta.setupDone = true; st.meta.turn = 1;
  const o = engine.outputPhase(SM, st, parsed.changes, parsed.reasons, { rng: seededRng('sg', 3, 'out'), suggest: parsed.suggest });
  ck('변화와 제안이 한 응답에서 함께 적용', o.state.vars.fame === 2 && o.state.meta.suggestions.length === 2,
    `fame ${o.state.vars.fame} / ${JSON.stringify(o.state.meta.suggestions)}`);
}

// ── 어댑터 배선 ──
{
  ck('세션이 suggest를 outputPhase에 넘긴다', src.includes('suggest: parsed.suggest'), '');
  ck('조작줄에 제안 칩', src.includes('sim-hitsug-') && src.includes('💡 다음 행동'), '');
  ck('칩 클릭 = 공식 sendChat', src.includes('Risuai.sendChat(text)'), '');
  ck('전송 거부 시 표시 전용 안내', src.includes('sendChatDenied'), '');
  ck('브리지 소급에도 suggest', src.includes('parsed.reasons, null, parsed.suggest'), '');
  ck('편집기 AI 설정 탭에 켜기', src.includes('다음 행동 제안 켜기'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
