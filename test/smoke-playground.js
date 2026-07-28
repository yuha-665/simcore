// 플레이그라운드 헤드리스 스모크 테스트 (Playwright)
// 플로우: 스키마 적용 → 세션 0 (AI 최초설정) → 프리셋 확인 → 일반 턴 → 리롤 멱등
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../playground.html'));
  await page.waitForTimeout(300);

  const check = async (name, fn) => {
    let ok = false;
    try { ok = await fn(); } catch (e) { errors.push(name + ': ' + e.message); }
    console.log((ok ? '  ✓ ' : '  ✗ ') + name);
    if (!ok) process.exitCode = 1;
  };

  await check('스키마 자동 적용 (유효 표시)', async () =>
    (await page.textContent('#report')).includes('스키마 유효'));

  // ── 블록 편집기 ──
  await check('편집기: 변수 탭 렌더 (자금 행)', async () =>
    (await page.textContent('#editor')).includes('변수 추가'));

  await check('편집기: 변수 행 추가 → JSON 반영', async () => {
    await page.click('#editor button:has-text("+ 변수 추가")');
    await page.click('#editor .sce-tab:has-text("JSON")');
    return (await page.inputValue('#sce-json')).includes('var10');
  });

  await check('타입 전환 시 init 자동 변환 (정수→텍스트, 검증 에러 없음)', async () => {
    await page.click('#editor .sce-tab:has-text("변수")');
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('#editor .sce-block')];
      const b = blocks.find((x) => x.querySelector('input')?.value === 'var10');
      const sel = b.querySelector('select');
      sel.value = 'text';
      sel.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(100);
    const report = await page.textContent('#editor .sce-report');
    // 다시 정수로 되돌려도 무사해야 함
    await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('#editor .sce-block')];
      const b = blocks.find((x) => x.querySelector('input')?.value === 'var10');
      const sel = b.querySelector('select');
      sel.value = 'int';
      sel.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(100);
    const report2 = await page.textContent('#editor .sce-report');
    return report.includes('스키마 유효') && report2.includes('스키마 유효');
  });

  await check('편집기: 상태창 탭 미리보기 + 커스텀 CSS 입력칸', async () => {
    await page.click('#editor .sce-tab:has-text("상태창")');
    const txt = await page.textContent('#editor');
    const pv = await page.innerHTML('#editor .sce-preview');
    return txt.includes('커스텀 CSS') && pv.includes('자금') && pv.includes('sim-bar');
  });

  await check('자동 배치: 빠진 변수(파생 포함) 한 방에 추가', async () => {
    // 미배치: 파생 2개(net_income, food_need) + 앞 단계에서 추가한 var10
    const btn = page.locator('#editor button:has-text("자동 배치")');
    const label = await btn.textContent();
    if (!/\d+개/.test(label)) return false;
    await btn.click();
    await page.waitForTimeout(150);
    const pv = await page.innerHTML('#editor .sce-preview');
    const done = await page.locator('#editor button:has-text("자동 배치")').textContent();
    return pv.includes('월 수지') && done.includes('이미 배치됨');
  });

  await check('편집기: 라이브 검증 리포트 (유효)', async () =>
    (await page.textContent('#editor .sce-report')).includes('스키마 유효'));

  await check('색 빌더: 기존 수식 파싱 (민심 → 위험 전환) + 스와치 렌더', async () => {
    // 상태창 탭은 이미 열려 있음. 민심 게이지의 colorbox에서 모드가 '위험 전환'으로 파싱됐는지
    const boxes = page.locator('#editor .sce-colorbox');
    const n = await boxes.count();
    let found = false;
    for (let i = 0; i < n; i++) {
      const sel = boxes.nth(i).locator('select').first();
      if (await sel.inputValue() === 'threshold') { found = true; break; }
    }
    const swatches = await page.locator('#editor .sce-swatch').count();
    return found && swatches >= 10;
  });

  await check('색 빌더: 수식(고급) 모드 선택이 유지됨', async () => {
    // 민심(위험 전환으로 파싱된) colorbox에서 수식 모드로 전환 → 튕기지 않고 유지 + 입력칸 표시
    const boxes = page.locator('#editor .sce-colorbox');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      const sel = boxes.nth(i).locator('select').first();
      if (await sel.inputValue() === 'threshold') {
        await sel.selectOption('expr');
        await page.waitForTimeout(100);
        const boxes2 = page.locator('#editor .sce-colorbox');
        const sel2 = boxes2.nth(i).locator('select').first();
        const stays = (await sel2.inputValue()) === 'expr';
        const hasInput = await boxes2.nth(i).locator('input[type=text], input:not([type])').count() > 0;
        // 원상복구 (뒤 테스트에 영향 없게)
        await sel2.selectOption('threshold');
        await page.waitForTimeout(100);
        return stays && hasInput;
      }
    }
    return false;
  });

  await check('색 빌더: 스와치 딸깍 → 수식 생성', async () => {
    // 첫 번째 colorbox(식량 게이지, 기본색)를 단색으로 바꾸고 스와치 클릭
    const box = page.locator('#editor .sce-colorbox').first();
    await box.locator('select').first().selectOption('solid');
    await page.waitForTimeout(100);
    await page.locator('#editor .sce-colorbox').first().locator('.sce-swatch').nth(3).click(); // #f1c40f
    await page.waitForTimeout(100);
    await page.click('#editor .sce-tab:has-text("JSON")');
    const json = await page.inputValue('#sce-json');
    await page.click('#editor .sce-tab:has-text("상태창")');
    return json.includes("'#f1c40f'");
  });

  await page.click('#apply'); // 편집 내용 적용 + 세션 리셋
  await page.waitForTimeout(150);

  await check('세션 0 안내 + 프리셋 버튼 표시', async () => {
    const presets = await page.textContent('#presets');
    const title = await page.textContent('#turn-title');
    return presets.includes('최초설정 대기') && presets.includes('몰락한 폐허령') && title.includes('세션 0');
  });

  await check('프리셋 적용 (부유한 상업령 → 5,000G)', async () => {
    await page.click('#presets button:has-text("부유한 상업령")');
    return (await page.innerHTML('#status-live')).includes('5,000G');
  });

  // 세션 0: 예시 버튼이 설정 예시를 채움 → 턴 진행 = 절대값 세팅
  await check('세션 0 진행: 절대값 적용 + 틱 없음 (150G, 가을, 1개월차)', async () => {
    await page.click('#fill-example');
    await page.click('#turn');
    await page.waitForTimeout(200);
    const html = await page.innerHTML('#status-live');
    return html.includes('150G') && html.includes('가을') && html.includes('1개월차');
  });

  await check('세션 0 후 일반 턴 모드로 전환', async () =>
    !(await page.textContent('#turn-title')).includes('세션 0'));

  // 순찰 무장 + 일반 턴 (용병 예시)
  await check('일반 턴: 델타+틱 (2개월차, 병력 45, 자금 0)', async () => {
    await page.click('#actions button[data-action="patrol"]'); // v0.38: 상태창 액션은 표시 전용 → 별도 버튼줄
    await page.click('#fill-example'); // 일반 예시 1번: 용병 -120/+30
    await page.click('#turn');
    await page.waitForTimeout(200);
    const html = await page.innerHTML('#status-live');
    return html.includes('2개월차') && html.includes('>45<') && html.includes('>0G<');
  });

  await check('리롤 멱등 (자금 여전히 0G)', async () => {
    await page.click('#reroll');
    await page.waitForTimeout(200);
    const html = await page.innerHTML('#status-live');
    return html.includes('2개월차') && html.includes('>0G<');
  });

  await check('JS 에러 없음', async () => {
    if (errors.length) console.log('     ' + errors.join('\n     '));
    return errors.length === 0;
  });

  await page.screenshot({ path: path.resolve(__dirname, '../playground-shot.png'), fullPage: false });
  await browser.close();
  console.log('스크린샷: playground-shot.png');
})();
