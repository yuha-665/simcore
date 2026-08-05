const __P = (...p) => require('path').resolve(__dirname, ...p);
// v0.76 리수 CBS 통과 — 상태창·프롬프트 템플릿 안의 `{{...}}`는 우리 것이 아니다.
//
// 두 가지 실측 결함을 고정한다:
//  ① 손상: 우리 치환 정규식이 안쪽 한 겹을 물어, CBS 이름이 변수·시간 노출 이름과 겹치면
//     값이 들어가 CBS가 깨졌다 (`{{date}}` → `{3월 12일}`). 겹치지 않는 이름은 evaluate가
//     던져 우연히 살아남았을 뿐 — 이름 운에 맡기던 상태였다.
//  ② 설치 거부: 검증기는 같은 자리에서 하드 오류를 냈다. `{{img::지도}}` 하나만 있어도
//     스키마가 설치되지 않았다 (렌더는 멀쩡했는데도).
// 이게 풀려야 상태창에서 캐릭터 에셋을 배경으로 부르는 작전 지도류가 가능해진다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');
(0, eval)(src.slice(src.indexOf('const SimCore = (() => {'), src.indexOf('(async () => {')) + '\n;globalThis.__SC = SimCore;');
const SC = globalThis.__SC;
const engine = SC.require('engine');
const { renderStatusHtml } = SC.require('render');
const { validateSchema } = SC.require('validate');

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);
const look = (n) => {
  const v = { front: 'ALPHA', date: '3월 12일', hp: 40 };
  if (!(n in v)) throw new Error(n);
  return v[n];
};
const rt = (t) => engine.renderTemplate(t, look);

// ── ① 손상 방지 ──
{
  ck('★ 변수와 이름이 겹치는 CBS가 안 깨진다 ({{front}})', rt('{{front}}') === '{{front}}', rt('{{front}}'));
  ck('★ 시간 노출 이름과 겹쳐도 안전 ({{date}})', rt('{{date}}') === '{{date}}', rt('{{date}}'));
  ck('인자 있는 CBS ({{img::지도}})', rt('{{img::지도}}') === '{{img::지도}}', rt('{{img::지도}}'));
  ck('겹치지 않는 CBS도 그대로 ({{user}})', rt('{{user}}') === '{{user}}', rt('{{user}}'));
  ck('★ 우리 자리표시자는 여전히 치환된다', rt('{front} · {hp}') === 'ALPHA · 40', rt('{front} · {hp}'));
  ck('★ 한 줄에 섞여 있어도 각자 제 갈 길',
    rt('{{img::지도}} {front} {{date}} {hp}') === '{{img::지도}} ALPHA {{date}} 40', rt('{{img::지도}} {front} {{date}} {hp}'));
  ck('수식 자리표시자도 정상', rt("{hp < 50 ? '위험' : '안정'}") === '위험', '');
  ck('모르는 이름은 예전처럼 그대로 남는다', rt('{ghost}') === '{ghost}', '');
}

// ── ② 설치 거부 해소 + 실제 지도 템플릿 왕복 ──
{
  const TPL = `<style>
.map{position:relative}
.pin{position:absolute;transform:translate(-50%,-50%)}
.pin.done{opacity:.45}
</style>
<div class="map">
  {{img::worldmap}}
  <i class="pin {has(cleared,'ORYX') ? 'done' : 'live'}" style="left:57%;top:45%">C ORYX</i>
  <i class="pin {front == 'ALPHA' ? 'hot' : 'live'}" style="left:68%;top:52%">A ALPHA ZONE</i>
</div>
<div>전선 {front} · 확보 {count(cleared)}</div>`;
  const S = {
    simcore: '0.1', meta: { name: '작전 지도' },
    vars: [
      { id: 'front', label: '전선', type: 'enum', enum: ['ALPHA', 'ORYX'], init: 'ALPHA' },
      { id: 'cleared', label: '확보 거점', type: 'list', init: ['ORYX'] },
    ],
    statusUI: { mode: 'template', template: TPL },
  };
  const v = validateSchema(S);
  ck('★ CBS가 든 템플릿도 설치 가능 (예전엔 하드 오류)', v.ok, JSON.stringify(v.errors));

  const html = renderStatusHtml(S, engine.initState(S), []);
  ck('★ 배경 에셋 CBS가 원형 그대로 살아 나간다', html.includes('{{img::worldmap}}'), '');
  ck('★ 조건부 핀 클래스가 상태로 갈린다 (확보=done / 현 전선=hot)',
    html.includes('class="pin done"') && html.includes('class="pin hot"'), html);
  ck('좌표 인라인 스타일 보존', html.includes('style="left:57%;top:45%"'), '');
  ck('본문 자리표시자도 정상', html.includes('전선 ALPHA · 확보 1'), '');

  // 알 수 없는 변수는 여전히 오류여야 한다 — CBS 예외가 검사를 통째로 무르면 안 된다
  const bad = JSON.parse(JSON.stringify(S));
  bad.statusUI.template = '{{img::지도}} {ghost_var}';
  ck('★ CBS 예외가 진짜 오타까지 봐주지는 않는다',
    !validateSchema(bad).ok, JSON.stringify(validateSchema(bad).errors));
}

let p = 0, f = 0;
for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `— ${x}`); ok ? p++ : f++; }
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
