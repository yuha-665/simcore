const __P = (...p) => require('path').resolve(__dirname, ...p);
// 가져오기 핸들러의 '스키마 복원 결정' 흐름 검증 (DOM/Risuai 목).
// 이 경로가 두 번 연속 실패했으므로(스키마 미복원) 분기 자체를 실행해 확인한다.
const fs = require('fs');
const src = fs.readFileSync(__P('../simcore.plugin.js'), 'utf8');

// 핸들러 본문만 추출 (onchange 콜백 내부)
const start = src.indexOf("document.getElementById('sc-import-file').onchange");
const end = src.indexOf("document.getElementById('sc-mirror').onclick");
if (start < 0 || end < 0) { console.log('FAIL: 핸들러를 못 찾음'); process.exit(1); }
let handler = src.slice(start, end);

const R = []; const ck = (n, c, x = '') => R.push([c, n, x]);

const SAVE_SCHEMA = {
  simcore: '0.1', meta: { name: '영지' },
  vars: [{ id: 'food', type: 'int', init: 0 }, { id: 'water', type: 'int', init: 0 }],
  statusUI: { mode: 'auto', groups: [] },
};
const RPG_SCHEMA = {
  simcore: '0.1', meta: { name: 'RPG' },
  vars: [{ id: 'hp', type: 'int', init: 100 }],
  statusUI: { mode: 'auto', groups: [] },
};
const SAVE = {
  simcoreSave: 1, schemaName: '영지', schema: SAVE_SCHEMA,
  chatId: 'chat-1', lastOutIndex: 9,
  current: { vars: { food: 42, water: 7 }, meta: { turn: 5, armed: {}, actionLastUsed: {}, eventLastFired: {}, firedOnce: {}, pendingNotifies: [], setupDone: false } },
  snapshots: {},
};

async function runImport({ checkboxChecked, installedSchema }) {
  const log = { installed: null, editorLoaded: null, reportHtml: '', imported: null };

  // ── 목 환경 ──
  const els = {
    'sc-save-report': { innerHTML: '' },
    'sc-import-schema': { checked: checkboxChecked },
  };
  const document = {
    getElementById: (id) => els[id] || { innerHTML: '', checked: false },
  };
  let schema = installedSchema;
  let session = installedSchema ? {
    current: { vars: {}, meta: { turn: 0 } },
    async importData(data, anchor) { log.imported = { anchor, turn: data.current.meta.turn }; this.current = JSON.parse(JSON.stringify(data.current)); return { ok: true, sameChat: data.chatId === 'chat-1' }; },
  } : null;
  let editor = {}; // 편집기 존재
  let lastOutIndex = -1;
  const validateSchema = () => ({ ok: true, errors: [], warnings: [] });
  const escapeText = (s) => String(s);
  const loadIntoEditor = (x) => { log.editorLoaded = x.meta.name; };
  const installSchemaToCurrentChar = async (parsed) => {
    log.installed = parsed.meta.name;
    schema = parsed;
    session = session || { current: { vars: {}, meta: { turn: 0 } }, async importData(d) { this.current = d.current; return { ok: true, sameChat: true }; } };
    session.importData = async (data, anchor) => { log.imported = { anchor, turn: data.current.meta.turn }; session.current = JSON.parse(JSON.stringify(data.current)); return { ok: true, sameChat: data.chatId === 'chat-1' }; };
    return { ok: true, backedUp: true };
  };
  const Risuai = {
    getCurrentCharacterIndex: async () => 0,
    getCurrentChatIndex: async () => 0,
    alertConfirm: async () => { throw new Error('fullscreen 패널에 가려 못 뜸'); }, // 실제 환경 재현
  };
  const lastCharIndex = async () => 3;
  const mirrorVars = async () => {};
  const syncControls = async () => {};
  const renderPanel = () => {};
  const withProgress = async (_rep, _btns, _title, fn) => fn(() => {});
  const SAVE_BTNS = [];
  const ev = { target: { files: [{ text: async () => JSON.stringify(SAVE) }], value: '' } };

  const fn = new Function(
    'document', 'schemaRef', 'sessionRef', 'editor', 'validateSchema', 'escapeText',
    'loadIntoEditor', 'installSchemaToCurrentChar', 'Risuai', 'lastCharIndex', 'mirrorVars',
    'syncControls', 'renderPanel', 'withProgress', 'SAVE_BTNS', 'ev', 'log',
    `let schema = schemaRef.get(), session = sessionRef.get(), lastOutIndex = -1;
     const _install = installSchemaToCurrentChar;
     installSchemaToCurrentChar = async (p) => { const r = await _install(p); schema = schemaRef.get(); session = sessionRef.get(); return r; };
     ${handler.replace("document.getElementById('sc-import-file').onchange = async (ev) => {", 'const __h = async (ev) => {').replace(/\};\s*$/, '};')}
     return __h(ev);`
  );

  await fn(document, { get: () => schema }, { get: () => session }, editor, validateSchema, escapeText,
    loadIntoEditor, installSchemaToCurrentChar, Risuai, lastCharIndex, mirrorVars,
    syncControls, renderPanel, withProgress, SAVE_BTNS, ev, log);

  log.reportHtml = els['sc-save-report'].innerHTML;
  return log;
}

(async () => {
  // ① 체크됨 + 다른 스키마 설치됨 → 스키마 복원되어야 함 (유저가 겪은 실패 케이스)
  const a = await runImport({ checkboxChecked: true, installedSchema: RPG_SCHEMA });
  ck('체크 시 동봉 스키마 설치됨', a.installed === '영지', `installed=${a.installed}`);
  ck('체크 시 편집기도 복원본', a.editorLoaded === '영지', `editor=${a.editorLoaded}`);
  ck('체크 시 상태도 가져옴', a.imported && a.imported.turn === 5, JSON.stringify(a.imported));
  ck('체크 시 결과에 복원 표기', /복원됨/.test(a.reportHtml), a.reportHtml.slice(0, 120));
  ck('alertConfirm 실패해도 진행됨', !/스키마는 현재 것 유지/.test(a.reportHtml), a.reportHtml.slice(0, 120));

  // ② 체크 해제 → 스키마 유지 + 불일치 경고
  const b = await runImport({ checkboxChecked: false, installedSchema: RPG_SCHEMA });
  ck('해제 시 스키마 설치 안 함', b.installed === null, `installed=${b.installed}`);
  ck('해제 시 상태는 가져옴', b.imported && b.imported.turn === 5, JSON.stringify(b.imported));
  ck('해제 시 불일치 경고 표시', /현재 스키마에 없어/.test(b.reportHtml), b.reportHtml.slice(0, 200));

  // ③ 스키마 없는 캐릭터 → 무조건 부트스트랩
  const c = await runImport({ checkboxChecked: false, installedSchema: null });
  ck('스키마 없으면 체크 무관 설치', c.installed === '영지', `installed=${c.installed}`);
  ck('부트스트랩 후 상태 가져옴', c.imported && c.imported.turn === 5, JSON.stringify(c.imported));

  let p = 0, f = 0;
  for (const [ok, n, x] of R) { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${x}`); ok ? p++ : f++; }
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
