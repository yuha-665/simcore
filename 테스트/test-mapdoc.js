const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.77 지도 규격 — 배치 규격서가 지도·도해 패턴을 가르치는지 + 그 패턴이 실제로 도는지.
//
// 소전봇(Frontline Crawler 1.5) 분석에서 확정한 두 기법을 우리 문법으로 고정한다:
//  ① 영역 색칠 = 같은 크기 투명 PNG 레이어 겹치기, 이름을 {{img::지역_{변수}}}로 조립
//     (소전봇은 모델이 매 턴 "drazni_usro" 토큰을 재출력 — 우리는 변수가 대신 든다)
//  ② 지점 핀 = relative 컨테이너 + absolute % 좌표 + 조건부 클래스
// 전제가 둘이다: v0.76 CBS 통과(두 겹 보존), 그리고 배치 규격서의 absolute 금지 해제.
// 금지 해제는 **배치 규격만**이다 — 스킨 규격(CSS만, 마크업 통제 불가)은 금지가 맞다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { renderStatusHtml } = SC.require('render');
const { validateSchema } = SC.require('validate');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

// ── 규격서 배선 (배치 프롬프트가 가르치는 것) ──
{
  ck('★ 배치 규격: absolute를 relative 컨테이너 내부로 허용',
    src.includes('`position: relative` 컨테이너 내부에서만'), '');
  ck('★ 스킨 규격: absolute 금지는 그대로 (마크업 통제 불가)',
    src.includes('`position: fixed` / `position: absolute`는 피하세요'), '');
  ck('★ 수식·조건부 클래스 교육', src.includes('class 속성 안에 넣으면 조건부 스타일'), '');
  ck('★ CBS 이미지 교육 (두 겹 보존)', src.includes('중괄호 **두 겹**)은 건드리지 않고'), '');
  ck('★ 이름 조립 교육', src.includes('{{img::지역A_{region_a}}}'), '');
  ck('★ 지도·도해 패턴 절 (핀 + 레이어)', src.includes('## 지도·도해 패턴')
    && src.includes('translate(-50%,-50%)') && src.includes('inset:0'), '');
  ck('에셋 이름 지어내기 금지', src.includes('존재하지 않는 에셋 이름을 지어내지 마세요'), '');
  ck('접이식 지도의 {uid} 경고', src.includes('접었다 펴는 지도는 체크박스'), '');
  ck('요청 칸 안내문에 지도 예시', src.includes('작전 지도: 배경 에셋 worldmap 위에 거점 핀'), '');
}

// ── 실전 왕복: 소전봇 구조 그대로의 전황판이 검증→렌더를 통과하는가 ──
{
  const TPL = `<style>
.warmap{position:relative;border:2px solid #333;overflow:hidden}
.layer{position:absolute;inset:0;width:100%;pointer-events:none}
.pin{position:absolute;transform:translate(-50%,-50%);font-size:11px}
.pin.hostile{color:#f55;animation:blink 1.5s infinite}
@keyframes blink{50%{opacity:.4}}
</style>
<div class="warmap">
  {{img::worldmap}}
  <span class="layer">{{img::drazni_{drazni}}}</span>
  <span class="layer">{{img::ostoria_{ostoria}}}</span>
  <i class="pin {drazni == 'hostile' ? 'hostile' : ''}" style="left:31%;top:22%">DRAZNI</i>
  <i class="pin {ostoria == 'hostile' ? 'hostile' : ''}" style="left:64%;top:41%">OSTORIA</i>
</div>`;
  const S = {
    simcore: '0.1', meta: { name: '전황판' },
    vars: [
      { id: 'drazni', label: '드라즈니', type: 'enum', enum: ['ally', 'neutral', 'hostile'], init: 'hostile' },
      { id: 'ostoria', label: '오스토리아', type: 'enum', enum: ['ally', 'neutral', 'hostile'], init: 'neutral' },
    ],
    statusUI: { mode: 'template', template: TPL },
  };
  const v = validateSchema(S);
  ck('★ 전황판 템플릿 설치 가능', v.ok, JSON.stringify(v.errors));
  const html = renderStatusHtml(S, engine.initState(S), []);
  ck('★ 레이어 이름이 변수로 조립된다 (모델 재출력 없이)',
    html.includes('{{img::drazni_hostile}}') && html.includes('{{img::ostoria_neutral}}'), html);
  ck('★ 핀 클래스가 세력 따라 갈린다', html.includes('class="pin hostile"') && html.includes('class="pin "'), '');
  ck('배경 CBS 원형 보존', html.includes('{{img::worldmap}}'), '');

  // 변수만 바꿔 다시 렌더 — 이게 소전봇 대비 핵심 이득이다 (지도 갱신 = 변수 갱신)
  const st2 = engine.initState(S); st2.vars.drazni = 'ally';
  const html2 = renderStatusHtml(S, st2, []);
  ck('★ 변수 갱신만으로 레이어·핀이 함께 바뀐다',
    html2.includes('{{img::drazni_ally}}') && !html2.includes('class="pin hostile" style="left:31%'), '');

  // 조립 자리의 오타는 여전히 잡혀야 한다 — CBS 예외가 안쪽 한 겹까지 봐주면 안 된다
  const bad = JSON.parse(JSON.stringify(S));
  bad.statusUI.template = '{{img::zone_{ghost_region}}}';
  ck('★ 조립 안쪽의 미지 변수는 오류', !validateSchema(bad).ok, '');
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
