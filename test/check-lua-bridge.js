// 생성된 루아 브리지 코드의 문법 검증 (luaparse, Lua 5.3 문법)
// 실제 설치 산출물을 얻기 위해 모의 Risuai 위에서 설치 버튼까지 누른다.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const luaparse = require('luaparse');

const FIXTURE = JSON.parse(JSON.stringify(require('./fixture-estate')));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><head></head><body></body></html>');
  await page.evaluate(() => {
    const storage = new Map();
    window.__mock = { char: { chaId: 'c', name: '루아검증', globalLore: [], chats: [], chatPage: 0 } };
    window.Risuai = {
      getCharacter: async () => window.__mock.char,
      setCharacter: async (c) => { window.__mock.char = c; },
      getCurrentCharacterIndex: async () => 0,
      getCurrentChatIndex: async () => 0,
      getChatFromIndex: async () => ({ id: 'ch', message: [], scriptstate: {} }),
      setChatToIndex: async () => {},
      pluginStorage: {
        getItem: async (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: async (k, v) => { storage.set(k, v); },
        removeItem: async (k) => { storage.delete(k); },
        keys: async () => [...storage.keys()],
      },
      addRisuReplacer: async () => {}, addRisuScriptHandler: async () => {},
      runLLMModel: async () => ({ content: '{}' }),
      getArgument: async () => 'lua',
      getRootDocument: async () => { throw new Error('거부'); },
      registerButton: async (m, cb) => { window.__mock.panelCb = cb; return 'b'; },
      registerSetting: async () => 's',
      showContainer: async () => {}, hideContainer: async () => {}, onUnload: async () => {},
    };
  });
  await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../dist/simcore.plugin.js'), 'utf8') });
  await page.waitForTimeout(300);

  // 스키마 설치 → 브리지 설치
  await page.evaluate(async (fixture) => {
    await window.__mock.panelCb();
  }, FIXTURE);
  await page.waitForTimeout(150);
  await page.click('.sc-maintab:has-text("봇 편집")');
  await page.click('#sc-editor .sce-tab:has-text("JSON")');
  await page.fill('#sce-json', JSON.stringify(FIXTURE));
  await page.click('#sc-editor button:has-text("JSON → 편집기 반영")');
  await page.waitForTimeout(100);
  await page.click('#sc-install');
  await page.waitForTimeout(150);
  await page.click('#sc-luabridge');
  await page.waitForTimeout(100);

  const code = await page.evaluate(() => {
    const t = (window.__mock.char.triggerscript || []).find((x) => x.comment === 'simcore-bridge');
    return t ? t.effect[0].code : null;
  });
  await browser.close();

  if (!code) { console.log('  ✗ 브리지 코드 추출 실패'); process.exit(1); }
  fs.writeFileSync(path.resolve(__dirname, 'generated-bridge.lua'), code);
  try {
    luaparse.parse(code, { luaVersion: '5.3' });
    console.log('  ✓ 생성된 루아 브리지 문법 검증 통과 (' + code.length + '자, test/generated-bridge.lua에 저장)');
  } catch (e) {
    console.log('  ✗ 루아 문법 오류: ' + e.message);
    process.exit(1);
  }
  // 내용 검증: 템플릿에 자리표시가 온전히 들어갔는지
  const must = ['⟦cur:gold⟧', '⟦NARR⟧', '⟦USER⟧', 'simcore_aux_seq', 'axLLM', 'SIMCORE_SETUP_T'];
  const missing = must.filter((m) => !code.includes(m));
  if (missing.length) { console.log('  ✗ 브리지 코드에 누락:', missing.join(', ')); process.exit(1); }
  console.log('  ✓ 브리지 코드 구성 요소 확인 (자리표시/제어 변수/axLLM)');
})();
