const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.29 — 변수 카드 접힘 기억 + 변수 카드에서 보조 AI 허용 (커뮤니티 제보 둘, 2026-09-17)
//
// (1) "변수 접고 AI 가이드 보고 돌아오면 도로 펼쳐져 있다" — 접힘이 카드 객체 열쇠 WeakSet이라 스키마 객체가 갈리면 전부 풀렸다.
//     이제 변수 id 열쇠 + 목록별 기본 모드 + 호스트 uiPrefs 저장.
// (2) "AI 설정 탭이 필수인 줄 알았다" — 허용 목록은 필수가 아니다. 변수 카드 🤖 체크 = updater.allow.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const count = (needle) => src.split(needle).length - 1;

console.log('── (1) 접힘 기억');
{
  ck('변수 카드 접힘은 더는 객체 열쇠 WeakSet이 아니다', !src.includes('const collapsedVariableCards = new WeakSet();'), '');
  ck('id 열쇠 + 목록별 모드 (foldPrefs vars/derived)', src.includes("const foldPrefs = { vars: { mode: 'open', except: new Set() }, derived: { mode: 'open', except: new Set() } };"), '');
  ck('has = (mode closed) XOR 예외', src.includes("return (p.mode === 'closed') !== p.except.has(foldKey(it));"), '');
  ck('파생/기본 구분은 expr 유무 (객체 정체성에 안 기댄다)', src.includes("'expr' in it ? 'derived' : 'vars'"), '');
  ck('[모두 접기] = 기본 모드 closed (앞으로도 접힌 채 시작)', src.includes("onclick: () => { collapsedVariableCards.setMode(list, 'closed'); rerender(); } }, '모두 접기')"), '');
  ck('[모두 펼치기] = 기본 모드 open', src.includes("onclick: () => { collapsedVariableCards.setMode(list, 'open'); rerender(); } }, '모두 펼치기')"), '');
  ck('setMode는 예외를 비우고 저장한다', src.includes("p.mode = mode; p.except.clear(); saveFoldPrefs();"), '');
  ck('새로 만든 카드는 기본이 접기여도 펼친다', src.includes("if (newlyCreated) { createdVariableCard = null; if (collapsedVariableCards.has(item)) collapsedVariableCards.delete(item); }"), '');
  ck('그룹 접힘 토글도 저장한다', src.includes("collapsedVarGroups.add(name || ''); saveFoldPrefs(); rerender();"), '');
  ck('저장은 디바운스 (연타에 저장소 안 두드린다)', src.includes('foldSaveTimer = setTimeout(() => {') && src.includes('}, 250);'), '');
  ck('불러오기 — mode·except·groups 복원 뒤 다시 그린다', src.includes("if (f[k]?.mode === 'closed' || f[k]?.mode === 'open') foldPrefs[k].mode = f[k].mode;") && src.includes('if (Array.isArray(f.groups)) for (const g of f.groups) collapsedVarGroups.add(String(g));'), '');
  ck('불러오기는 편집기가 이미 닫혔으면 무시 (destroyed)', src.includes('if (destroyed || !f) return;'), '');
  ck('검증 리포트 점프(folded?.delete)는 새 API와 호환', src.includes("? collapsedVariableCards\n") && src.includes('folded?.delete(target.item);'), '');
  ck('어댑터: uiPrefs 훅 — 캐릭터별 pluginStorage', src.includes('sim:ui:editor:${currentChaId}') && src.includes('uiPrefs: {'), '');
  ck('편집기: opts.uiPrefs 수용', src.includes('getFirstInstallGuideDismissed, setFirstInstallGuideDismissed, uiPrefs } = opts;'), '');
}

console.log('── (2) 변수 카드 🤖 보조 AI 허용');
{
  ck('카드에 체크 — updater.allow와 같은 목록', src.includes("const allowEntry = schema.updater.allow.find((a) => a && a.id === v.id);") && src.includes("'🤖 서사를 보고 보조 AI가 값을 적음'"), '');
  ck('켜면 {id}(+text maxLength) 추가, 끄면 filter', src.includes("schema.updater.allow = schema.updater.allow.filter((a) => !(a && a.id === v.id));") && src.includes("if (v.type === 'text' && v.maxLength) entry.maxLength = v.maxLength; schema.updater.allow.push(entry);"), '');
  ck('꺼짐 설명 — 규칙·이벤트·액션만 바꾼다 / 이야기 따라 바뀌는 값이면 켜라', src.includes("'꺼짐 — 규칙·이벤트·액션(버튼)만 이 값을 바꿔요. 이야기 흐름에 따라 바뀌어야 하는 값(호감도·평판 같은 것)이면 켜세요.'"), '');
  ck('접힌 요약에 🤖 표시', src.includes("variableSummary(v) + (allowEntry ? ' · 🤖 보조 AI' : '')"), '');
  ck('카드 몸통에 실린다 (설명 뒤)', src.includes("h('div', { class: 'sce-variable-description' }, description), aiAllowRow]"), '');
  ck('AI 설정 탭 설명문 — 허용은 필수가 아니다·카드 체크와 같은 목록', src.includes('허용 목록은 필수가 아니에요') && src.includes('변수 카드의 🤖 체크와 같은 목록'), '');
  ck('옛 설명문(AI 전달 규칙을 조정합니다)은 화면에서 사라졌다 (체인지로그 인용만 남는다)', !src.includes("h('p', {}, 'SimCore가 상태를 요약하고 갱신할 때 사용하는 AI 전달 규칙을 조정합니다."), '');
  ck('만드는 순서 띠 ②도 같은 말', src.includes("변수 카드의 🤖 체크로도 같은 일이 돼요"), '');
  ck('CSS — 카드 안 허용 줄', src.includes('.sce .sce-variable-ai-allow {') && src.includes('.sce .sce-variable-ai-allow.is-on {'), '');
}

console.log('── 버전');
{
  ck('버전 1.9.29', src.includes('//@version 1.9.29'), '');
  ck('체인지로그 v1.9.29', src.includes('// ── v1.9.29 ──'), '');
}

console.log(`\n[test-foldmem] ${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
