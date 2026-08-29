// 얼헌 임포트용 변환기 — 참고용 원본(얼헌 개조용/)에서 심코어판 로어북·정규식 JSON을 만든다.
//
// 하는 일:
//   1. 로어북: 심코어가 대체한 항목 삭제 (P1 상태창·시스템 메시지·측정불가 / P2 NPC List·
//      Hostile 2종 / P3 이벤트 트리거 20종·퓨처 플랜) + 빈 폴더 정리
//   2. 남은 항목의 죽은 CBS 조건 굽기 — 루아·시작변수가 사라지면 {{getvar::lang}} 등이
//      'null'을 돌려줘 조건 블록이 통째로 사라진다. 원본 기본값(한국어판)으로 정적 평가해
//      평문으로 만든다. (lang=1 한국어, lore=1 스토어 세계관 켬, faction=1, stats=1)
//      · lore=1 (v0.97): 알터 스토어가 심코어 상점이 됐으니 코인·블랙 마켓·스토어 세계관을
//        복원한다. 단 알터 스토어 항목은 always → 키워드 활성으로 내린다 (운영 규칙은
//        alter_store 지시문이 store_on일 때 이미 깔린다 — 상시 이중 전송 방지).
//      · economy=0 유지: 블랙 마켓 가격표(무기 500~2k코인 등)는 원작 스케일이라
//        심코어판 코인 경제(E킬 1~5C, 밴드 1~3000)와 충돌 — 표는 굽어서 뺀다.
//        환율 캐논(1코인 ≈ ₩1,000)은 상점 환전 창구·지시문이 대신 말한다.
//   3. 정규식: 상태창·시스템 메시지·설정 패널·퓨처 플랜·구 언어 설정 계열 제거,
//      에셋·커맨드·이름 교정 계열은 존치 (에셋은 P5 팩 이식 때까지)
//
// 실행: cd 얼헌 && node convert-import.js
// 산출: 얼헌-로어북-심코어판.json · 얼헌-정규식-심코어판.json (리수에 그대로 임포트)
const fs = require('fs');
const path = require('path');
const SRC = (f) => path.resolve(__dirname, '..', '얼헌 개조용', f);
const OUT = (f) => path.resolve(__dirname, f);

// ── 원본 시작 변수 (봇설정.txt) — lang만 1(한국어)로, 나머지는 원본 기본값 ──
const VARS = {
  lang: '1', status_type: '0', status_model: '2', lore: '1', stats: '1', fold: '1',
  LowSpec: '0', faction: '1', unmeasurable: '0', economy: '0', scenario: '0',
  event: '1', FuturePlans: '1', clock: '0', sysmsg: '1', metaprompt: '0',
};
// NPC 플래그 48종 — 전부 1 (개별 항목은 키워드 활성화가 담당, 목록 숨김은 P2가 대체)
const NPC_FLAGS = ['Kang Min-hyuk', 'Kang Yoo-ra', 'Kim Min-soo', 'Rivea', 'Min Chae-rin', 'Baek Hwi-Sung',
  'Sasaki Yua', 'Seo Ji-han', 'Song Ha-neul', 'Alice Croft', 'Isabelle Hayes', 'Im Jin-tae', 'Lim Seol-hee',
  'Lee Ha-eun', 'Joo Ah-ram', 'Jake Miller', 'Choi Min-jun', 'Choi Tae-joon', 'Choi Yu-na', 'Ha Wol-young',
  'Han Ji-won', 'Han Seo-yeon', 'Haru Ito', 'Go Eun-bi', 'Yoon Mirae', 'Choi Yoo-jin', 'Na Sun-young',
  'Jang Eun-seo', 'Yoo Jin-hyuk', 'Oh Ha-na', 'Jin So-hee', 'Park Jun-ho', 'Kang Woo-seok', 'Kwon Jae-hyun',
  'Park So-won', 'Ahn Do-hyun', 'Yoo Sun-hwa', 'Yoo Jin-seong', 'Lee Ji-hye', 'Yoon Ji-ho', 'Kang Tae-shik',
  'Kwon Do-yoon', 'Shin Woo-hyun', 'Chae Ha-yoon', 'Baek Eun-ha', 'Park Hye-in', 'Lee So-yoon', 'Choi Tae-hyun'];
for (const n of NPC_FLAGS) VARS[n] = '1';

// ── CBS 굽기 — getvar 치환 → equal 평가 → 안쪽 블록부터 접기, 고정점까지 ──
function bake(text) {
  let s = String(text);
  for (let pass = 0; pass < 40; pass++) {
    const before = s;
    // {{getvar::x}} → 값 ('null'은 리수의 미정의 반환값 규약)
    s = s.replace(/\{\{getvar::([^}]+)\}\}/g, (_, k) => VARS[k.trim()] ?? 'null');
    // {{equal::a::b}} → 1/0 (안쪽 중괄호가 다 풀린 것만)
    s = s.replace(/\{\{equal::([^{}]*)::([^{}]*)\}\}/g, (_, a, b) => a.trim() === b.trim() ? '1' : '0');
    s = s.replace(/\{\{not_equal::([^{}]*)::([^{}]*)\}\}/g, (_, a, b) => a.trim() !== b.trim() ? '1' : '0');
    // 안쪽에 다른 블록이 없는 {{#if(_pure) COND}}...{{/if(_pure)}} 접기
    s = s.replace(/\{\{#if(_pure)?\s+([^{}]*?)\s*\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if(_pure)?\}\}/g,
      (_, __, cond, body) => {
        const c = cond.trim();
        return (c === '1' || c === 'true') ? body : '';
      });
    if (s === before) break;
  }
  // 굽고 남은 빈 줄 정리 (3연속 이상 → 2)
  return s.replace(/\n{3,}/g, '\n\n').replace(/^\s+$/gm, '');
}

// ── 로어북 ──
const lore = JSON.parse(fs.readFileSync(SRC('얼헌 로어북.json'), 'utf8'));
const REMOVE = new Set([
  '상태창', '시스템 메시지', '측정 불가 방지',           // P1 — 심코어 상태창·systemGuide·지시문
  '퓨처 플랜',                                           // P3 — 백로그 (원하면 나중에 복원)
  'NPC List', 'Hostile NPC', 'Hostile Factions List',    // P2 — 랭크 게이팅 지시문
]);
const removed = [], emptied = [];
let kept = [];
for (const e of lore.data) {
  const name = String(e.comment || '');
  if (REMOVE.has(name) || name.startsWith('🌟')) { removed.push(name); continue; }
  if (e.mode === 'folder') { kept.push(e); continue; }
  const baked = bake(e.content || '');
  // 원래 내용이 있었는데 굽고 나니 빈 항목 (꺼진 토글 전용 내용이 사라진 경우 등)
  if ((e.content || '').trim() && !baked.trim()) { emptied.push(name); continue; }
  const entry = { ...e, content: baked };
  // 알터 스토어 세계관은 키워드 활성으로 (key: Store, 스토어) — 운영 규칙은 alter_store
  // 지시문이 담당, 이 항목은 유저가 스토어를 입에 올릴 때만 기원·규정 상세를 꺼낸다
  if (name === '알터 스토어') entry.alwaysActive = false;
  kept.push(entry);
}
// 자식이 하나도 안 남은 폴더 정리
const usedFolders = new Set(kept.filter((e) => e.mode !== 'folder' && e.folder).map((e) => e.folder));
const emptyFolders = kept.filter((e) => e.mode === 'folder' && !usedFolders.has(e.key)).map((e) => e.comment);
kept = kept.filter((e) => e.mode !== 'folder' || usedFolders.has(e.key));

const loreOut = { ...lore, data: kept };
fs.writeFileSync(OUT('얼헌-로어북-심코어판.json'), JSON.stringify(loreOut, null, 1));

// ── 정규식 ──
const rx = JSON.parse(fs.readFileSync(SRC('얼헌 정규식json.json'), 'utf8'));
const RX_REMOVE = new Set([
  // 상태창 계열 — 심코어 statusUI가 대체
  '---상태창---', '스탯 상태창', '경량 상태창', '## 상태창 찐빠 제거', '상태창 쉼표 찐빠 제거',
  '상태창 괄호 찐빠 제거', '상태창 대괄호 찐빠 제거', '상태창 출력 제거',
  // 시스템 메시지 계열 — 심코어 통지·systemGuide가 대체
  '---시스템 메시지---', '시스템 메시지 CSS', '시스템 메시지 글자 크기 설정 [PC]',
  '시스템 메시지 글자 크기 설정 [모바일]', '시스템 메시지 CSS 색깔 정상화',
  '시스템 메시지 찐빠 수정', '시스템 메시지 찐빠 수정2',
  // 설정 패널 — 기능 토글이 심코어 변수·프리셋·명령으로 이동
  '---설정 패널---', '설정 패널 디스플레이', '설정 패널 디스플레이2', '설정 패널 리퀘스트',
  // 퓨처 플랜 — 백로그
  '---퓨처 플랜---', '퓨처 플랜 디스플레이', '퓨처 플랜 리퀘스트', '# 퓨처 플랜 찐빠 제거', '퓨처 플랜 버전 호환',
  // 구 언어 설정 — 이미 disabled, 한국어 단일화로 소멸
  '---(구)언어 설정---', '언어 설정 디스플레이', '언어 설정 리퀘스트',
]);
const rxRemoved = [], rxKept = [];
for (const s of rx.data) {
  if (RX_REMOVE.has(String(s.comment || ''))) rxRemoved.push(s.comment);
  else rxKept.push(s);
}
const rxOut = { ...rx, data: rxKept };
fs.writeFileSync(OUT('얼헌-정규식-심코어판.json'), JSON.stringify(rxOut, null, 1));

// ── 검증 보고 ──
const size = (o) => Math.round(JSON.stringify(o).length / 1024) + 'KB';
const chars = (d) => d.reduce((n, e) => n + (e.content || '').length, 0);
console.log('━━ 로어북 ━━');
console.log(`  항목 ${lore.data.length} → ${kept.length} (삭제 ${removed.length} · 구워서 빈 것 ${emptied.length} · 빈 폴더 ${emptyFolders.length})`);
console.log(`  본문 ${Math.round(chars(lore.data) / 1024)}K자 → ${Math.round(chars(kept) / 1024)}K자 · 파일 ${size(lore)} → ${size(loreOut)}`);
if (emptied.length) console.log('  구워서 빈 항목:', emptied.join(', '));
if (emptyFolders.length) console.log('  정리된 폴더:', emptyFolders.join(', '));
const leftover = kept.filter((e) => /\{\{(getvar|#if|equal)/.test(e.content || ''));
console.log(`  잔여 조건 CBS: ${leftover.length ? '❗ ' + leftover.map((e) => e.comment).join(', ') : '✓ 없음'}`);
const alwaysChars = kept.filter((e) => e.alwaysActive).reduce((n, e) => n + (e.content || '').length, 0);
console.log(`  always-on 본문: ${Math.round(chars(lore.data.filter((e) => e.alwaysActive)) / 1024)}K자 → ${Math.round(alwaysChars / 1024)}K자`);
console.log('━━ 정규식 ━━');
console.log(`  스크립트 ${rx.data.length} → ${rxKept.length} (삭제 ${rxRemoved.length})`);
console.log(`  삭제: ${rxRemoved.join(' · ')}`);
if (leftover.length) process.exit(1);
console.log('\n저장: 얼헌-로어북-심코어판.json · 얼헌-정규식-심코어판.json');
