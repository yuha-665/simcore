const __P = (...p) => require('path').resolve(__dirname, ...p);
// 플로팅 액션 버튼의 아이콘 글리프 추출 검증
// (아이콘 칸이 글리프 1개 폭이라 라벨 전체를 넣으면 세로로 쏟아진다)
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
// actionGlyph는 render 모듈이 갖고 있다 (우상단 버튼과 상태창 범례가 같은 글리프를 써야 하므로)
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const { actionGlyph } = globalThis.__SC.require('render');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const len = (s) => [...s].length;

// ── 템플릿에 실제로 쓰인 라벨들 ──
const REAL = [
  ['🔥 화로 최대', '🔥'], ['🧊 화로 절약', '🧊'], ['⛏ 채탄 작업', '⛏'],
  ['🏠 단열 보강', '🏠'], ['🥣 배급 절반', '🥣'], ['🍖 배급 정상화', '🍖'],
  ['📢 기자회견', '📢'], ['🤝 재계 회동', '🤝'], ['✊ 노동계 회동', '✊'],
  ['🏛 당내 단속', '🏛'], ['📜 법안 표결', '📜'], ['💰 자금 투입', '💰'],
  ['📦 발주', '📦'], ['📣 홍보', '📣'], ['⭐ 품질 개선', '⭐'],
  ['🎲 공격', '🎲'], ['🔍 현장 조사', '🔍'],
];
for (const [label, want] of REAL) {
  const got = actionGlyph(label);
  ck(`'${label}' → ${want}`, got === want, `받은 값 '${got}'`);
}
ck('★ 템플릿 라벨은 전부 글리프 1개로 압축됨',
  REAL.every(([l]) => len(actionGlyph(l)) === 1),
  REAL.filter(([l]) => len(actionGlyph(l)) !== 1).map(([l]) => l).join(', '));

// ── 이모지 없는 라벨 (유저가 직접 만든 것) ──
{
  ck('★ 스크린샷 사례: "테스트 버튼" → "테" 한 글자', actionGlyph('테스트 버튼') === '테', actionGlyph('테스트 버튼'));
  ck('영문도 첫 글자만', actionGlyph('Rest and recover') === 'R', actionGlyph('Rest and recover'));
  ck('한글 라벨 세로로 안 쏟아짐', len(actionGlyph('영지 보고서 확인')) === 1, actionGlyph('영지 보고서 확인'));
  ck('숫자 시작도 안전', actionGlyph('1번 창고') === '1', actionGlyph('1번 창고'));
  ck('앞뒤 공백 무시', actionGlyph('   휴식  ') === '휴', actionGlyph('   휴식  '));
}

// ── 결합 이모지가 쪼개지지 않는가 ──
{
  ck('ZWJ 결합(요리사)이 통째로 유지', actionGlyph('🧑‍🍳 채용') === '🧑‍🍳', actionGlyph('🧑‍🍳 채용'));
  ck('변이 선택자 유지', actionGlyph('⚙️ 설정') === '⚙️', JSON.stringify(actionGlyph('⚙️ 설정')));
  ck('키캡 유지', actionGlyph('1️⃣ 첫째 제대') === '1️⃣', JSON.stringify(actionGlyph('1️⃣ 첫째 제대')));
  ck('깃발(지역표시자)도 통째로', len(actionGlyph('🏳️ 항복')) <= 2, JSON.stringify(actionGlyph('🏳️ 항복')));
}

// ── 빈 값·이상값 방어 ──
{
  for (const [v, name] of [[undefined, 'undefined'], [null, 'null'], ['', '빈 문자열'], ['   ', '공백만']]) {
    ck(`${name} → 기본 글리프`, actionGlyph(v) === '•', JSON.stringify(actionGlyph(v)));
  }
  ck('숫자를 줘도 안 터짐', actionGlyph(123) === '1', String(actionGlyph(123)));
}

// ── 버튼에 실제로 들어가는 최종 문자열 ──
// 아이콘 칸은 글리프 하나만 담는다. 두 글자를 넣으면 둘째 글자가 알약 밖으로 흘러나온다.
{
  // 실제 소스와 어긋나지 않게 못을 박아둔다
  ck('★ 소스의 아이콘 조립식이 이 테스트와 같음',
    src.includes("const icon = st.disabled ? '🔒' : (st.armed ? '✅' : actionGlyph(st.label));"),
    '소스가 바뀌었으면 아래 mirror도 같이 고칠 것');
  const icon = (label, armed, ok) => (!ok ? '🔒' : (armed ? '✅' : actionGlyph(label)));

  // 화면에 몇 칸으로 보이는가 = 자소 묶음(grapheme) 수.
  // 🧑‍🍳는 코드포인트 3개지만 한 칸이고, '● 🔥'는 세 칸이다.
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const glyphs = (s) => [...seg.segment(String(s))].length;

  ck('평상시 = 라벨의 대표 글리프', icon('🔥 화로 최대', false, true) === '🔥', icon('🔥 화로 최대', false, true));
  ck('발동 대기 = ✅로 교체', icon('🔥 화로 최대', true, true) === '✅', icon('🔥 화로 최대', true, true));
  ck('잠김 = 🔒로 교체', icon('🔥 화로 최대', false, false) === '🔒', icon('🔥 화로 최대', false, false));
  ck('잠김이 무장보다 우선', icon('🔥 화로', true, false) === '🔒', icon('🔥 화로', true, false));

  const cases = [...REAL.map(([l]) => l), '테스트 버튼', '영지 보고서 확인', 'Rest', '🧑‍🍳 채용', '⚙️ 설정', '1️⃣ 제대'];
  const overflow = [];
  for (const l of cases) {
    for (const armed of [true, false]) {
      for (const ok of [true, false]) {
        if (glyphs(icon(l, armed, ok)) !== 1) overflow.push(`${l}/${armed}/${ok} → ${icon(l, armed, ok)}`);
      }
    }
  }
  ck('★ 어떤 라벨·어떤 상태에서도 글리프는 정확히 1개', overflow.length === 0, overflow.join(' , '));
  ck('★ 아이콘에 공백이 절대 없음 (줄바꿈 유발 요인 제거)',
    cases.every((l) => [true, false].every((a) => !icon(l, a, true).includes(' '))), '');
}

// ── 회귀: 예전 두 방식이 왜 깨졌는지 못박아 둔다 ──
{
  ck('v0.23 방식(라벨 통째)은 6글자 — 세로로 쏟아지던 원인', len('테스트 버튼') === 6, '');
  ck('v0.24 방식(● + 글리프)은 3글자 — 알약 밖으로 흘러나오던 원인', len('● ' + actionGlyph('테스트 버튼')) === 3, '');
  ck('현재 방식은 1글자', len(actionGlyph('테스트 버튼')) === 1, '');
}

// ── 상태창 범례 ↔ 우상단 버튼이 짝이 맞는가 (이게 핵심) ──
{
  const SC = globalThis.__SC;
  const { renderStatusHtml } = SC.require('render');
  const engine = SC.require('engine');
  const { TEMPLATES } = SC.require('templates');
  const T = TEMPLATES.survival.schema;
  const st = engine.initState(T);

  const mk = (over = {}) => (T.actions || []).map((a, i) => ({
    id: a.id, label: a.label, armed: false, disabled: false, reason: '', ...(over[i] || {}),
  }));
  const html = renderStatusHtml(T, st, null, mk(), { includeStyle: false });

  ck('범례가 상태창에 렌더됨', html.includes('sim-actions'), '');
  ck('안내 문구가 붙음', html.includes('화면 우상단 버튼으로 실행'), '');
  ck('★ 범례에 라벨 전체가 나옴 (아이콘 뜻을 알 수 있음)',
    html.includes('화로 최대') && html.includes('채탄 작업') && html.includes('단열 보강'), '');
  ck('★ 범례 글리프가 우상단 버튼 글리프와 같음',
    (T.actions || []).every((a) => html.includes(`<span class="sim-action-glyph">${actionGlyph(a.label)}</span>`)),
    (T.actions || []).map((a) => actionGlyph(a.label)).join(''));
  ck('★ 아이콘이 본문에서 중복되지 않음 (🔥 🔥 화로 최대 방지)',
    !html.includes('>🔥 화로 최대<') && html.includes('>화로 최대<'),
    (html.match(/sim-action-glyph">.<\/span>[^<]*/g) || []).join(' | '));

  // 이모지가 없는 라벨은 버튼에 첫 글자가 뜬다 → 배지를 또 달면 '휴 휴식'이 된다
  {
    const plain = [{ id: 'rest', label: '휴식', armed: false, disabled: false, reason: '' }];
    const ph = renderStatusHtml(T, st, null, plain, { includeStyle: false });
    ck('★ 이모지 없는 라벨엔 배지를 안 붙임 ("휴 휴식" 방지)', !ph.includes('sim-action-glyph'), ph.slice(-260));
    ck('이모지 없는 라벨도 전체가 보임', ph.includes('휴식'), '');
    const pa = renderStatusHtml(T, st, null, [{ ...plain[0], armed: true }], { includeStyle: false });
    ck('이모지 없어도 무장 배지는 붙음', pa.includes('<span class="sim-action-glyph">✅</span>휴식'), pa.slice(-260));
  }

  // 기본 템플릿은 우리 조언대로 전부 이모지로 시작해야 한다
  {
    const bad = [];
    for (const [key, t] of Object.entries(TEMPLATES)) {
      for (const a of (t.schema.actions || [])) {
        if (!SC.require('render').actionGlyph(a.label).codePointAt(0)) continue;
        const g = SC.require('render').actionGlyph(a.label);
        const cp = g.codePointAt(0);
        const pict = (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf)
          || (cp >= 0x2b00 && cp <= 0x2bff) || (cp >= 0x2190 && cp <= 0x21ff);
        if (!pict) bad.push(`${key}:${a.label}`);
      }
    }
    ck('★ 기본 템플릿의 액션 라벨은 전부 이모지로 시작', bad.length === 0, bad.join(', '));
  }
  ck('★ 죽은 <button>이 더는 없음 (눌러도 안 되던 것)', !/<button/.test(html), html.slice(0, 200));
  ck('예전의 x-sim-action 잔재도 없음', !html.includes('x-sim-action'), '');

  const armed = renderStatusHtml(T, st, null, mk({ 0: { armed: true } }), { includeStyle: false });
  ck('무장 시 범례도 ✅ (버튼과 동일)', armed.includes('<span class="sim-action-glyph">✅</span>'), '');
  ck('무장 시 상태 문구 표시', armed.includes('발동 대기'), '');
  ck('무장 항목에 sim-armed 클래스', armed.includes('sim-armed'), '');

  const locked = renderStatusHtml(T, st, null, mk({ 1: { disabled: true, reason: '쿨다운 2턴 남음' } }),
    { includeStyle: false });
  ck('잠김 시 범례도 🔒 (버튼과 동일)', locked.includes('<span class="sim-action-glyph">🔒</span>'), '');
  ck('잠김 사유가 보임', locked.includes('쿨다운 2턴 남음'), '');
  ck('잠김 항목에 sim-disabled 클래스', locked.includes('sim-disabled'), '');

  ck('액션을 안 넘기면 범례도 없음',
    !renderStatusHtml(T, st, null, null, { includeStyle: false }).includes('sim-actions'), '');

  // 스킨이 범례를 계속 꾸며주는가 (.sim-action 규칙을 8종이 이미 갖고 있다)
  const styled = renderStatusHtml(T, st, null, mk(), { includeStyle: true });
  ck('스킨의 .sim-action 규칙이 범례에 그대로 적용됨',
    styled.includes('.sim-action') && styled.includes('sim-action-glyph'), '');
  ck('범례 기본 CSS도 포함', styled.includes('.sim-action-glyph{') && styled.includes('.sim-action-hint{'), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
