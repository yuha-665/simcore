const __P = (...p) => require('path').resolve(__dirname, ...p);
// v1.9.12 — 카드 접기: 조건 이벤트·랜덤 이벤트·액션·판정 (+ 모두 접기/펼치기)
// 커뮤니티 제보: "기본 변수·지시문엔 접기가 있는데 이벤트·액션엔 없어 직접 보려면 한참 스크롤"
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

let pass = 0, fail = 0;
const ck = (name, ok, got) => { console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : `→ ${got}`); ok ? pass++ : fail++; };
const count = (needle) => src.split(needle).length - 1;

console.log('── 공용 규약');
{
  ck('접힘 상태는 WeakSet (스키마에 안 남고 다시 그려도 유지)', src.includes('const collapsedCards = new WeakSet();'), '');
  ck('foldBtn — aria-expanded + 접기/펼치기 라벨', src.includes("class: 'sce-btn sce-mini sce-fold-btn'") && src.includes("folded ? '펼치기' : '접기'"), '');
  ck('appendFoldBar — 둘 이상일 때만', src.includes('if (!Array.isArray(list) || list.length < 2) return;') && src.includes("class: 'sce-fold-bar'"), '');
  ck('모두 접기·모두 펼치기 버튼', count("'모두 접기'") >= 3 && count("'모두 펼치기'") >= 3, `${count("'모두 접기'")} / ${count("'모두 펼치기'")}`);
}

console.log('── 카드별');
{
  ck('조건 이벤트: 접힘 클래스 + 몸통 생략', src.includes("class: 'sce-rules-card' + (evFold ? ' is-collapsed' : '')") && src.includes("evFold ? null : h('div', { class: 'sce-rules-card-body' }"), '');
  ck('조건 이벤트: 머리에 접기 버튼 (1회만 옆, 손잡이 앞)', src.includes("foldBtn(ev, ev.id || `조건 이벤트 ${i + 1}`),\n            ruleGrip(schema.rules.events, i),"), '');
  ck('조건 이벤트: 목록 위 모두 접기 줄', src.includes('appendFoldBar(eventsList, schema.rules.events);'), '');
  ck('랜덤 이벤트: 접힘 클래스 + 몸통 생략', src.includes("class: 'sce-rules-card' + (rnFold ? ' is-collapsed' : '')") && src.includes("rnFold ? null : h('div', { class: 'sce-rules-card-body' }"), '');
  ck('랜덤 이벤트: 머리에 접기 버튼', src.includes("foldBtn(ev, ev.id || `랜덤 이벤트 ${i + 1}`), ruleGrip(re.table, i)"), '');
  ck('랜덤 이벤트: 목록 위 모두 접기 줄', src.includes('appendFoldBar(randomList, re.table);'), '');
  ck('액션: 접힘 클래스 + 몸통 통(display:contents)', src.includes("class: 'sce-action-card' + (acFold ? ' is-collapsed' : '')") && src.includes('if (!acFold) card.appendChild(body);'), '');
  ck('액션: 섹션 7개가 전부 통에 담긴다 (카드에 직접 붙는 섹션 0)', count("body.appendChild(h('section', { class: 'sce-action-card-section ") === 7 && count("card.appendChild(h('section', { class: 'sce-action-card-section ") === 0, '');
  ck('액션: 머리에 접기 버튼 (손잡이 앞)', src.includes("foldBtn(a, a.label || `액션 ${i + 1}`),\n        grip(schema.actions, i, rerender)));"), '');
  ck('액션: 목록 위 모두 접기 줄', src.includes('appendFoldBar(wrap, schema.actions);'), '');
  ck('판정: 접힘 클래스 + 몸통 통', src.includes("class: 'sce-check-card' + (ckFold ? ' is-collapsed' : '')") && src.includes('if (!ckFold) block.appendChild(body);'), '');
  ck('판정: 섹션·등급이 전부 통에 담긴다', count("body.appendChild(h('section', { class: 'sce-check-card-section' },") === 2 && src.includes('body.appendChild(grades);') && !src.includes('block.appendChild(grades);'), '');
  ck('판정: 머리에 접기 버튼', src.includes("foldBtn(c, c.label || c.id || `판정 ${i + 1}`),\n        grip(schema.checks, i, rerender)));"), '');
  ck('판정: 목록 위 모두 접기 줄', src.includes('appendFoldBar(wrap, schema.checks);'), '');
  // 파생 변수는 변수 카드와 같은 틀 — 이미 접힌다 (제보의 "파생엔 없음"은 구판)
  ck('파생 변수는 variableCard(접기 있음)로 그려진다', src.includes("derivedList.appendChild(variableCard(d, `파생 변수 ${i + 1}`, schema.derived, i,"), '');
  ck('파생 변수 목록에도 모두 접기(bulkControls)', src.includes("...bulkControls(schema.derived, '$.derived'),"), '');
}

console.log('── CSS');
{
  ck('몸통 통은 display:contents (섹션 경계선 규칙 유지)', src.includes('.sce .sce-card-body-contents { display:contents; }'), '');
  ck('모두 접기 줄 오른쪽 정렬', src.includes('.sce .sce-fold-bar { display:flex; gap:6px; justify-content:flex-end;'), '');
  ck('액션·판정 머리에서 접기 버튼이 손잡이 앞 오른쪽', src.includes('.sce .sce-action-card-head > .sce-fold-btn, .sce .sce-check-card-head > .sce-fold-btn { flex:none; margin-left:auto; }'), '');
  ck('좁은 화면에서는 오른쪽 아래로', src.includes('.sce .sce-action-card-head > .sce-fold-btn, .sce .sce-check-card-head > .sce-fold-btn { margin-left:0; align-self:flex-end; }'), '');
  ck('CSS는 한 번만 (중복 정의 없음)', count('.sce .sce-card-body-contents { display:contents; }') === 1, '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
