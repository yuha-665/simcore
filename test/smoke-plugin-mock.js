// 플러그인 번들을 모의 Risuai API 위에서 통합 스모크 테스트
// 시나리오: 스키마 없는 캐릭터 → 패널에서 설치 → 턴 파이프라인 → 수동 보정 →
//           미러 복원 → 세이브 내보내기까지 형태 검증 (실제 리스 배선은 별도 확인)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// 이 스모크는 일반 턴 파이프라인에 집중 — AI 최초설정은 끈 픽스처 사용
// (세션 0 흐름은 코어 테스트 + 플레이그라운드 스모크에서 검증)
const FIXTURE = JSON.parse(JSON.stringify(require('./fixture-estate')));
FIXTURE.setup.ai.enabled = false;
// mentions 침묵 실패 감지 테스트용: 서사에 절대 안 나올 낱말로 잠근 변수
FIXTURE.vars.push({ id: 'silent_var', label: '침묵변수', type: 'int', init: 0, min: 0, max: 100 });
FIXTURE.updater.allow.push({ id: 'silent_var', maxDelta: 5, mentions: ['잠금테스트낱말'] });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.setContent('<!DOCTYPE html><html><head></head><body></body></html>');
  await page.evaluate(() => {
    const storage = new Map();
    window.__mock = {
      replacers: {}, handlers: {}, buttons: [], settings: [],
      chat: { id: 'mockchat', message: [], scriptstate: {} },
      llmCalls: [], containerShown: false,
      char: { chaId: 'mockchar', name: '테스트영주', globalLore: [], chats: [], chatPage: 0 },
    };
    window.Risuai = {
      getCharacter: async () => window.__mock.char,
      setCharacter: async (c) => { window.__mock.char = c; },
      getCurrentCharacterIndex: async () => 0,
      getCurrentChatIndex: async () => 0,
      getChatFromIndex: async () => window.__mock.chat,
      setChatToIndex: async (ci, chi, chat) => { window.__mock.chat = chat; },
      pluginStorage: {
        getItem: async (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: async (k, v) => { storage.set(k, v); },
        removeItem: async (k) => { storage.delete(k); },
        keys: async () => [...storage.keys()],
      },
      addRisuReplacer: async (name, fn) => { window.__mock.replacers[name] = fn; },
      addRisuScriptHandler: async (mode, fn) => { window.__mock.handlers[mode] = fn; },
      // v0.38 확정 시그니처: runLLMModel({mode,messages,allowPlugins}) → {type:'success'|'fail', result}
      runLLMModel: async (opts) => {
        window.__mock.llmCalls.push(opts);
        if (window.__mock.blockLLM) return { type: 'fail', result: 'Plugin calls are blocked by the caller.' };
        return { type: 'success', result: '{"changes":{"gold":-120,"military":30},"reasons":{"gold":"용병 계약금","military":"용병단 합류"}}' };
      },
      getArgument: async () => window.__mock.arg || 'aux',
      getRootDocument: async () => { throw new Error('mainDom 권한 거부 (모의)'); },
      registerButton: async (meta, cb) => { window.__mock.buttons.push({ meta, cb }); return 'btn1'; },
      registerSetting: async (name, cb) => { window.__mock.settings.push({ name, cb }); return 'set1'; },
      showContainer: async () => { window.__mock.containerShown = true; },
      hideContainer: async () => { window.__mock.containerShown = false; },
      onUnload: async () => {},
    };
  });

  await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../dist/simcore.plugin.js'), 'utf8') });
  await page.waitForTimeout(300);

  const check = async (name, fn) => {
    let ok = false;
    try { ok = await fn(); } catch (e) { errors.push(name + ': ' + e.message); }
    console.log((ok ? '  ✓ ' : '  ✗ ') + name);
    if (!ok) process.exitCode = 1;
  };

  await check('훅/UI 등록', () =>
    page.evaluate(() => !!window.__mock.replacers.beforeRequest && !!window.__mock.handlers.output &&
      !!window.__mock.handlers.display && window.__mock.buttons.length === 1 && window.__mock.settings.length === 1));

  // ── 패널: 스키마 없는 상태에서 열기 → 편집기로 설치 ──
  await check('패널: 스키마 없음 안내 + 탭 표시', async () => {
    await page.evaluate(() => window.__mock.buttons[0].cb());
    await page.waitForTimeout(100);
    const status = await page.textContent('#sc-status');
    const tabs = await page.textContent('.sc-maintabs');
    return status.includes('스키마 없음') && tabs.includes('현황') && tabs.includes('봇 편집') && tabs.includes('세이브');
  });

  await check('패널 배경 불투명 (CSS 수선 확인)', () =>
    page.evaluate(() => {
      const el = document.getElementById('sc-root');
      const bg = getComputedStyle(el).backgroundColor;
      return getComputedStyle(el).position === 'fixed' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    }));

  await check('봇 편집 탭: 블록 편집기 렌더', async () => {
    await page.click('.sc-maintab:has-text("봇 편집")');
    await page.waitForTimeout(100);
    return (await page.textContent('#sc-editor')).includes('변수 추가');
  });

  await check('편집기 JSON 반영 → 설치 → 로드됨', async () => {
    await page.click('#sc-editor .sce-tab:has-text("JSON")');
    await page.fill('#sce-json', JSON.stringify(FIXTURE));
    await page.click('#sc-editor button:has-text("JSON → 편집기 반영")');
    await page.waitForTimeout(100);
    await page.click('#sc-install');
    await page.waitForTimeout(150);
    const status = await page.textContent('#sc-status');
    const lore = await page.evaluate(() => window.__mock.char.globalLore);
    return status.includes('로드됨') && lore.length === 1 && lore[0].comment === '⚙simcore' && lore[0].alwaysActive === false;
  });

  await check('패널 안 팔레트 스와치가 실제 색으로 보임 (CSS 충돌 회귀 방지)', async () => {
    await page.click('#sc-copy'); // 설치된 스키마를 편집기로
    await page.waitForTimeout(100);
    await page.click('#sc-editor .sce-tab:has-text("상태창")');
    await page.waitForTimeout(100);
    const bg = await page.evaluate(() => {
      const sw = document.querySelector('#sc-editor .sce-swatch');
      return sw ? getComputedStyle(sw).backgroundColor : null;
    });
    // 팔레트 첫 색 #e74c3c = rgb(231, 76, 60). 패널 버튼색(#232833)이면 실패
    return bg === 'rgb(231, 76, 60)';
  });

  await check('설치 검증: 깨진 스키마는 거부', async () => {
    await page.click('#sc-editor .sce-tab:has-text("JSON")');
    await page.fill('#sce-json', '{"simcore":"0.1","vars":[{"id":"x","type":"int"}],"derived":[{"id":"d","expr":"ghost+1"}]}');
    await page.click('#sc-editor button:has-text("JSON → 편집기 반영")');
    await page.waitForTimeout(100);
    await page.click('#sc-install');
    await page.waitForTimeout(100);
    const rep = await page.textContent('#sc-schema-report');
    const lore = await page.evaluate(() => window.__mock.char.globalLore.length);
    return rep.includes('ghost') && lore === 1; // 기존 정상 스키마 유지
  });

  // ── 턴 파이프라인 ──
  await check('beforeRequest: 상태 블록 주입', () =>
    page.evaluate(async () => {
      window.__mock.chat.message.push({ role: 'user', data: '영지를 순시한다.' });
      const out = await window.__mock.replacers.beforeRequest([{ role: 'user', content: '영지를 순시한다.' }], 'model');
      const sys = out[out.length - 1];
      return sys.role === 'system' && sys.content.includes('영지 현황');
    }));

  await check('output: 파이프라인 내 차단 감지 → 즉시 경로는 틱만 적용', () =>
    page.evaluate(async () => {
      window.__mock.blockLLM = true; // 리스의 재귀 방지 가드 재현
      const result = await window.__mock.handlers.output('용병단 30명을 고용했다. 계약금 120골드.');
      window.__mock.blockLLM = false; // 파이프라인 종료 → 차단 해제
      window.__mock.chat.message.push({ role: 'char', data: result });
      const ss = window.__mock.chat.scriptstate;
      // 즉시 경로: 델타 없이 정기 틱만 (gold 1000 + 수지 -10 = 990)
      return /⟦simcore:1⟧/.test(result) && ss['$gold'] === '990' && ss['$military'] === '50';
    }));

  await check('지연 호출: 파이프라인 밖에서 델타 소급 적용', async () => {
    await page.waitForTimeout(3500); // 지연 스케줄(1초) + 여유
    return page.evaluate(() => {
      const ss = window.__mock.chat.scriptstate;
      // 소급: 틱 이후 상태에 델타 적용 (990-120=870, 병력 50+30=80)
      return ss['$gold'] === '870' && ss['$military'] === '80';
    });
  });

  await check('display: 마커 → 상태창 HTML', () =>
    page.evaluate(async () => {
      const html = await window.__mock.handlers.display(window.__mock.chat.message[1].data);
      return html.includes('sim-status') && !html.includes('⟦simcore:');
    }));

  // ── 패널 재확인: 수동 보정 / 미러 복원 / 세이브 ──
  await check('패널 수동 보정: gold 9999', async () => {
    await page.evaluate(() => window.__mock.buttons[0].cb());
    await page.waitForTimeout(100);
    await page.click('.sc-maintab:has-text("현황")');
    const goldRow = page.locator('#sc-vars tr', { hasText: '(gold)' });
    await goldRow.locator('input').fill('9999');
    await goldRow.locator('button').click();
    await page.waitForTimeout(100);
    return (await page.evaluate(() => window.__mock.chat.scriptstate['$gold'])) === '9999';
  });

  await check('미러에서 복원', async () => {
    await page.evaluate(() => { window.__mock.chat.scriptstate['$gold'] = '7777'; });
    await page.click('.sc-maintab:has-text("세이브")');
    await page.click('#sc-mirror');
    await page.waitForTimeout(100);
    const rep = await page.textContent('#sc-save-report');
    const row = await page.evaluate(() => document.getElementById('sc-vars').textContent);
    return rep.includes('복원') && row.includes('7777');
  });

  await check('세이브 내보내기 (다운로드 트리거)', async () => {
    const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.click('#sc-export');
    const d = await dl;
    if (!d) return false;
    const p = await d.path();
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data.simcoreSave === 1 && data.current.vars.gold === 7777 && Object.keys(data.snapshots).length > 0;
  });

  await check('액션 무장 토글', async () => {
    await page.click('.sc-maintab:has-text("현황")');
    const patrol = page.locator('#sc-actions button', { hasText: '순찰' });
    await patrol.click();
    await page.waitForTimeout(50);
    return (await patrol.textContent()).includes('●');
  });

  // ── 루아 브리지 (aux_model_mode=lua) ──
  await check('루아 브리지 설치 버튼: 트리거 + LLA 기록', async () => {
    await page.evaluate(() => window.__mock.buttons[0].cb());
    await page.waitForTimeout(100);
    await page.click('.sc-maintab:has-text("봇 편집")');
    await page.click('#sc-luabridge');
    await page.waitForTimeout(100);
    return page.evaluate(() => {
      const c = window.__mock.char;
      const t = (c.triggerscript || []).find((x) => x.comment === 'simcore-bridge');
      return !!t && t.effect[0].type === 'triggerlua' && t.effect[0].code.includes('axLLM')
        && t.effect[0].code.includes('SIMCORE_DELTA_T') && c.lowLevelAccess === true;
    });
  });

  await check('lua 모드: beforeRequest가 브리지 제어 변수 기록', () =>
    page.evaluate(async () => {
      window.__mock.arg = 'lua';
      window.__mock.chat.message.push({ role: 'user', data: '병사들에게 특별 상여금을 준다.' });
      await window.__mock.replacers.beforeRequest([{ role: 'user', content: '상여금' }], 'model');
      const ss = window.__mock.chat.scriptstate;
      return ss['$simcore_bridge'] === 'on' && ss['$simcore_expect'] === 'delta';
    }));

  await check('lua 모드: output은 runLLMModel을 부르지 않고 틱만 적용', () =>
    page.evaluate(async () => {
      const callsBefore = window.__mock.llmCalls.length;
      const result = await window.__mock.handlers.output('상여금이 지급되어 사기가 올랐다.');
      window.__mock.chat.message.push({ role: 'char', data: result });
      window.__mock.luaBaseGold = Number(window.__mock.chat.scriptstate['$gold']);
      window.__mock.luaBaseMil = Number(window.__mock.chat.scriptstate['$military']);
      return /⟦simcore:\d+⟧/.test(result) && window.__mock.llmCalls.length === callsBefore;
    }));

  await check('lua 모드: 브리지 결과 폴링 → 델타 소급 적용', async () => {
    await page.evaluate(() => {
      // 루아 트리거의 setChatVar를 흉내: 결과 + seq 기록
      const ss = window.__mock.chat.scriptstate;
      ss['$simcore_aux_result'] = '{"changes":{"gold":50,"military":-5},"reasons":{"gold":"상여금 회수분","military":"이탈"}}';
      ss['$simcore_aux_seq'] = '1';
    });
    await page.waitForTimeout(2600); // 폴링 주기 1.2초 + 여유
    return page.evaluate(() => {
      const ss = window.__mock.chat.scriptstate;
      return Number(ss['$gold']) === window.__mock.luaBaseGold + 50
        && Number(ss['$military']) === window.__mock.luaBaseMil - 5;
    });
  });

  // ── mentions 침묵 실패 감지 (v0.38.3) ──
  await check('mentions 6턴 연속 미개방 → 패널에 침묵 경고', async () => {
    await page.evaluate(async () => {
      window.__mock.arg = 'aux'; // 직접 호출 경로에서만 추적
      for (let i = 0; i < 6; i++) {
        window.__mock.chat.message.push({ role: 'user', data: '순찰을 돈다.' });
        const out = await window.__mock.handlers.output('영지는 평온했다. 순찰병이 성벽을 돌았다.');
        window.__mock.chat.message.push({ role: 'char', data: out });
      }
      await window.__mock.buttons[0].cb(); // 패널 열기 → renderPanel
    });
    await page.waitForTimeout(150);
    const info = await page.textContent('#sc-info');
    return info.includes('낱말 잠금') && info.includes('silent_var');
  });

  await check('편집기 AI 설정 탭에 액션 잠금 칸 표시', async () => {
    await page.click('.sc-maintab:has-text("봇 편집")');
    await page.click('#sc-copy');
    await page.waitForTimeout(100);
    await page.click('#sc-editor .sce-tab:has-text("AI 설정")');
    await page.waitForTimeout(100);
    return page.evaluate(() => {
      const pairs = [...document.querySelectorAll('#sc-editor .sce-pair')];
      const p = pairs.find((x) => x.querySelector('label')?.textContent === '액션 잠금');
      return !!p && p.title.includes('무장');
    });
  });

  await check('편집기 낱말 칸에 다국어/단위 힌트 표시', async () => {
    await page.click('.sc-maintab:has-text("봇 편집")');
    await page.click('#sc-copy');
    await page.waitForTimeout(100);
    await page.click('#sc-editor .sce-tab:has-text("AI 설정")');
    await page.waitForTimeout(100);
    // 도움말은 pair()의 title 속성으로 들어간다
    const title = await page.evaluate(() => {
      const pairs = [...document.querySelectorAll('#sc-editor .sce-pair')];
      const p = pairs.find((x) => x.querySelector('label')?.textContent === '낱말');
      return p ? p.title : '';
    });
    return title.includes('채팅 언어') && title.includes('단위');
  });

  await check('JS 에러 없음', async () => {
    if (errors.length) console.log('     ' + errors.join('\n     '));
    return errors.length === 0;
  });

  await page.screenshot({ path: path.resolve(__dirname, '../panel-shot.png'), fullPage: false });
  await browser.close();
  console.log('스크린샷: panel-shot.png');
})();
