const __P = (...p) => require('path').resolve(__dirname, ...p);
// 상태창 꾸미기 — 디자인 지침·재질 프리셋·봇 정보 동봉 (v1.22.0)
// 유저(2026-11-08): "꾸미기를 시키면 CSS가 AI가 딴 것처럼 딱딱하다." 고친 것 넷(봇 정보·빈 요청 문구·지침·계획 주석)과
// 재질 10종의 바닥선(글자 대비 4.5:1 · 채팅이 통째로 버리는 문법 없음 · 있는 클래스만)을 잰다. 새 재질을 넣으면 여기서 같이 검사된다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SimCore = globalThis.__SC;
const engine = SimCore.require('engine');
const { validateSchema, cssChatProblems } = SimCore.require('validate');
const { TEMPLATES } = SimCore.require('templates');
const render = SimCore.require('render');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const seg = src.slice(src.indexOf('const CSS_SPEC_CLASSES = ['), src.indexOf('const SCHEMA_HARD_RULES = ['));
const M = new Function('validateSchema', 'renderStatusHtml', 'engine', 'pickTemplate',
  seg + '\nreturn { buildCssSpecPrompt, buildLayoutSpecPrompt, STATUS_MATERIALS, STATUS_DESIGN_GUIDE, STATUS_DESIGN_LAYOUT, designCtxText, CSS_SPEC_CLASSES };')(
  validateSchema, render.renderStatusHtml, engine, render.pickTemplate);
const cp = (x) => JSON.parse(JSON.stringify(x));

// ── 색 대비 (WCAG 2.x) ──
const hex = (s) => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(s || '').trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) : null;
};
const lum = (c) => {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rules = (css) => [...String(css).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
  sels: m[1].split(',').map((s) => s.trim()),
  decl: Object.fromEntries(m[2].split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; })),
}));
const get = (rs, sel, prop) => { for (const r of rs) if (r.sels.includes(sel) && r.decl[prop] != null) return r.decl[prop]; return null; };

// 쓸 수 있는 클래스 = 규격서 목록 + 기본 CSS에 있는 것 (렌더러가 실제로 찍는 이름)
const baseAt = src.indexOf('const BASE_CSS = `');
const BASE = src.slice(baseAt, src.indexOf('`;', baseAt));
const allowed = new Set([
  ...M.CSS_SPEC_CLASSES.flatMap(([sel]) => sel.match(/\.[a-z][\w-]*/gi) || []).map((s) => s.slice(1)),
  ...(BASE.match(/\.[a-z][\w-]*/gi) || []).map((s) => s.slice(1)),
]);

// ── 재질 프리셋 ──
{
  const MAT = M.STATUS_MATERIALS;
  ck('재질 10종', MAT.length === 10, String(MAT.length));
  ck('재질 id 중복 없음', new Set(MAT.map((m) => m.id)).size === MAT.length, '');
  for (const m of MAT) {
    const tag = `재질 ${m.name}`;
    ck(`${tag}: 이름·출처·어울림·설명`, !!(m.id && m.name && m.from && m.fit && m.brief && m.brief.length > 40), '');
    const css = m.css;
    const chat = cssChatProblems(css);
    ck(`${tag}: 리수 채팅이 버리는 문법 없음`, !chat.kill.length && !chat.dead.length, [...chat.kill, ...chat.dead].join(' · '));
    ck(`${tag}: 외부 리소스·위치 지정·블러·!important 없음`,
      !/@import|url\(|backdrop-filter|position\s*:|!important/i.test(css), (css.match(/@import|url\(|backdrop-filter|position\s*:|!important/i) || [''])[0]);
    const used = [...new Set((css.replace(/\{[^}]*\}/g, '').match(/\.[a-z][\w-]*/gi) || []).map((s) => s.slice(1)))];
    const unknown = used.filter((c) => !allowed.has(c));
    ck(`${tag}: 있는 클래스만`, !unknown.length, unknown.join(', '));

    const rs = rules(css);
    const bg = hex(get(rs, '.sim-status', 'background'));
    const fg = hex(get(rs, '.sim-status', 'color'));
    ck(`${tag}: 상자에 바탕색·글자색을 같이 (테마 무관하게 읽히게)`, !!(bg && fg), '');
    if (!bg || !fg) continue;
    const surfaces = [['상자', bg]];
    const gb = hex(get(rs, '.sim-group', 'background'));
    if (gb) surfaces.push(['그룹 칸', gb]);
    const worst = (color, own) => {
      const c = hex(color) || fg;
      const ss = own ? [['제 바탕', own]] : surfaces;
      return ss.map(([n, s]) => [n, contrast(c, s)]).sort((a, b) => a[1] - b[1])[0];
    };
    for (const sel of ['.sim-status', '.sim-status summary', '.sim-group-label', '.sim-label', '.sim-value', '.sim-log',
      '.sim-log-diff.plus', '.sim-log-diff.minus']) {
      const [n, r] = worst(get(rs, sel, 'color'), null);
      ck(`${tag}: ${sel} 글자 대비 ≥ 4.5`, r >= 4.5, `${n} ${r.toFixed(2)}`);
    }
    for (const sel of ['.sim-tag', '.sim-action', '.sim-action.sim-armed']) {
      const own = hex(get(rs, sel, 'background'));
      const [n, r] = worst(get(rs, sel, 'color'), own);
      ck(`${tag}: ${sel} 글자 대비 ≥ 4.5`, r >= 4.5, `${n} ${r.toFixed(2)}`);
    }
    const pb = hex(get(rs, '.sim-status', '--sim-pop-bg')), pf = hex(get(rs, '.sim-status', '--sim-pop-fg'));
    ck(`${tag}: 팝업 바탕·글자도 재질을 따른다`, !!(pb && pf) && contrast(pb, pf) >= 4.5, pb && pf ? contrast(pb, pf).toFixed(2) : '선언 없음');
    ck(`${tag}: 고른 탭 색도 재질을 따른다`, !!get(rs, '.sim-status', '--sim-tab-on-bg') && !!get(rs, '.sim-status', '--sim-tab-on-line'), '');
    ck(`${tag}: 흐린 글자를 opacity로 두지 않음 (색으로 흐리게)`,
      ['.sim-label', '.sim-group-label', '.sim-log'].every((s) => get(rs, s, 'opacity') === '1'), '');

    // 실제 렌더 — 스코핑 뒤에도 전부 .sim-status 안쪽이고, 채팅 파트가 멀쩡한가
    const S = cp(TEMPLATES.survival.schema);
    S.statusUI.customCSS = css;
    const parts = render.statusCssParts(S, 7);
    ck(`${tag}: 스코핑 뒤 전부 상태창 안쪽`, !/(^|\})\s*\.sim-(?!status)/.test(parts.custom) && parts.custom.includes('.sim-status'), parts.custom.slice(0, 80));
    ck(`${tag}: 스코핑 뒤에도 채팅 문법 그대로`, !cssChatProblems(parts.custom).kill.length, '');
  }
}

// ── 규격서 — 스킨 ──
{
  const S = TEMPLATES.survival.schema;
  const ctx = designCtxCase();
  function designCtxCase() {
    return M.designCtxText({ name: '베리디아', desc: '무너진 변경 영지를 다시 일으키는 경영 시뮬레이션.',
      lore: [{ name: '⚙simcore', content: '{...}' }, { name: '영지 연대기' }, { name: '주민 명부' }] }, S);
  }
  ck('봇 정보: 이름·설명·로어북 이름', ctx.includes('이름: 베리디아') && ctx.includes('변경 영지') && ctx.includes('영지 연대기, 주민 명부'), ctx);
  ck('봇 정보: 심코어 스키마 항목은 빼고', !ctx.includes('⚙simcore'), ctx);

  const gen = M.buildCssSpecPrompt(cp(S), '', true, { gen: true, botCtx: ctx, material: 'kiln' });
  ck('★ 생성: 봇 정보가 실린다', gen.includes('## 이 봇 (자동') && gen.includes('이름: 베리디아'), '');
  ck('★ 생성: 빈 요청에 예시 문구("낡은 신문지")를 싣지 않는다', !gen.includes('낡은 신문지') && gen.includes('따로 적지 않았습니다'), '');
  ck('★ 생성: 디자인 지침 (소재·계획 주석·흔한 기본값·바닥선)', ['## 디자인 지침', '### 1. 소재부터', '계획 주석', '흔한 기본값', '4.5:1', 'tabular-nums']
    .every((s) => gen.includes(s)), '');
  ck('생성: 기기 글꼴만 안내 (웹폰트 링크 없음)', gen.includes('"Malgun Gothic"') && !/fonts\.googleapis|@font-face/.test(gen), '');
  ck('★ 생성: 출발 재질의 설명과 예시 CSS', gen.includes('출발 재질 — "가마"') && gen.includes(M.STATUS_MATERIALS.find((m) => m.id === 'kiln').css.slice(0, 60)), '');
  const at = (s) => gen.indexOf(s);
  ck('생성: 순서 — 분위기 → 봇 → 재질 → 지침 → 규칙 → 구조',
    at('## 내가 원하는 분위기') < at('## 이 봇 (자동') && at('## 이 봇 (자동') < at('## 출발 재질') && at('## 출발 재질') < at('## 디자인 지침')
    && at('## 디자인 지침') < at('## 반드시 지킬 것') && at('## 반드시 지킬 것') < at('## 이 봇의 실제 상태창 구조'), '');
  ck('생성: 옛 규칙은 그대로 (CSS만·없는 클래스 금지·중첩 금지)',
    gen.includes('**CSS만** 출력') && gen.includes('없는 클래스는 만들지 마세요') && gen.includes('중첩 CSS'), '');
  ck('생성: CSS 변수(팝업·탭)를 알려 준다', gen.includes('--sim-pop-bg') && gen.includes('--sim-tab-on-bg'), '');
  ck('생성: 프롬프트 크기 상식선 (< 20000자)', gen.length < 20000, String(gen.length));

  const copy = M.buildCssSpecPrompt(cp(S), '');
  ck('복사 옆문: 빈 요청이면 예시 자리표시 그대로 (사람이 고쳐 쓴다)', copy.includes('낡은 신문지') && copy.includes('## 디자인 지침'), '');
  ck('복사 옆문: 봇 정보·재질을 안 주면 그 절이 없다', !copy.includes('## 이 봇 (자동') && !copy.includes('## 출발 재질'), '');
  const off = M.buildCssSpecPrompt(cp(S), '붉은 도장', false, { gen: true, botCtx: ctx });
  ck('지침 끄면 지침만 빠진다 (봇 정보·요청은 남음)', !off.includes('## 디자인 지침') && off.includes('## 이 봇 (자동') && off.includes('붉은 도장'), '');
  ck('없는 재질 id는 조용히 무시', !M.buildCssSpecPrompt(cp(S), '', true, { material: 'nope' }).includes('## 출발 재질'), '');
}

// ── 규격서 — 배치 ──
{
  const S = TEMPLATES.survival.schema;
  const lay = M.buildLayoutSpecPrompt(cp(S), '', true, { gen: true, material: 'ledger' });
  ck('★ 배치: 배치 절과 계획 주석 자리(<style> 맨 위)', lay.includes('### 6. 배치') && lay.includes('`<style>` 블록 맨 위'), '');
  ck('배치: 빈 요청엔 봇 정보·자리표시자에서 고르라고', lay.includes('따로 적지 않았습니다') && !lay.includes('왼쪽에 칭호 칸'), '');
  ck('배치: 출발 재질은 클래스명을 옮겨 쓰라고', lay.includes('출발 재질 — "기록부"') && lay.includes('클래스명에 맞게'), '');
  ck('배치: 자리표시자 계약은 그대로', lay.includes('## 쓸 수 있는 자리표시자') && lay.includes('{uid}'), '');
  const layCopy = M.buildLayoutSpecPrompt(cp(S), '');
  ck('배치 복사 옆문: 예시 자리표시 그대로', layCopy.includes('왼쪽에 칭호 칸'), '');
}

// ── 봇 정보 요약 ──
{
  const long = 'ㄱ'.repeat(5000);
  const t = M.designCtxText({ name: 'X', desc: long, lore: Array.from({ length: 40 }, (_, i) => ({ name: `항목${i}` })) }, {});
  ck('설명은 앞부분만 (1200자)', t.length < 1700 && t.includes(' …'), String(t.length));
  ck('로어북 이름은 30개까지 + 남은 수', t.includes('항목29') && !t.includes('항목30') && t.includes('외 10개'), '');
  ck('봇 정보 없음 + 기본 이름 → 빈 문자열', M.designCtxText(null, { meta: { name: '새 시뮬레이션' } }) === '', '');
  ck('봇 정보 없음 → 스키마 이름만', M.designCtxText(null, { meta: { name: '변경백령' } }) === '이름: 변경백령', '');
}

// ── 번들 배선 ──
{
  ck('★ 번들: 내장 생성이 봇 정보를 읽어 넘긴다', /designOpts\(aiCtxOn \? await fetchBotCtx\(\)/.test(src) && src.includes('gen: true }'), '');
  ck('번들: 복사 옆문도 읽어 둔 봇 정보를 쓴다', src.includes('designOpts(aiBotCtx)'), '');
  ck('번들: 봇 정보는 📚 고르기·동봉 끄기를 따른다', src.includes('aiCtxOn && ctx ? filterBotCtx(ctx, botCtxPick) : null'), '');
  ck('★ 번들: 상태창 탭 버튼이 재질 프리셋 (옛 레시피 다섯 제거)', src.includes('applyMaterial(m)') && !src.includes('const RECIPES = [') && !src.includes("['한밤 유리'"), '');
  ck('번들: 출발 재질 고르기 + 그대로 입히기', src.includes("'자동 — 봇 설정을 보고 정하기'") && src.includes("'그대로 입히기'"), '');
  ck('번들: 그대로 입히기도 되돌리기 칸을 남긴다', /function applyMaterial\(m\) \{\s*snapshotCss\(\);/.test(src), '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
