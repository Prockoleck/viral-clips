const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE_ERROR: ${err.message}`));
  page.on('response', resp => {
    if (resp.status() >= 400) {
      networkErrors.push(`${resp.status()} ${resp.url()}`);
    }
  });
  
  console.log('=== Navigating to clips page ===');
  await page.goto('https://viral-clips-sandy.vercel.app/clips', { waitUntil: 'networkidle', timeout: 30000 });
  
  // Enter YouTube URL
  console.log('=== Entering YouTube URL ===');
  await page.locator('input[type="url"]').fill('https://youtu.be/90lLQVZe2Nc');
  
  // Click Extract Clips
  console.log('Clicking Extract Clips...');
  await page.locator('button:has-text("Extract Clips")').click();
  
  // Poll for result
  console.log('\n=== Polling for result (max 180s) ===');
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(3000);
    const elapsed = (i + 1) * 3;
    
    // Check for clips
    const clipsVisible = await page.locator('text=Clip #').count();
    if (clipsVisible > 0) {
      console.log(`[${elapsed}s] SUCCESS! Found ${clipsVisible} clips`);
      await page.screenshot({ path: 'test-screenshots/yt-success.png', fullPage: true });
      break;
    }
    
    // Check for error state
    const errorVisible = await page.locator('[class*="border-red"]').count();
    if (errorVisible > 0) {
      const errorText = await page.locator('[class*="border-red"]').first().textContent();
      console.log(`[${elapsed}s] ERROR STATE: ${errorText.substring(0, 500)}`);
      await page.screenshot({ path: 'test-screenshots/yt-error.png', fullPage: true });
      break;
    }
    
    // Check progress text
    const progressText = await page.locator('main').textContent();
    const progressMatch = progressText.match(/(Fetching transcript|Analyzing for viral|Processing|Loading|Preparing clips)/i);
    if (progressMatch && i % 4 === 0) {
      console.log(`[${elapsed}s] Status: ${progressMatch[1]}`);
    }
  }
  
  // Always dump network errors and take final screenshot
  if (networkErrors.length > 0) {
    console.log('\n=== HTTP errors ===');
    networkErrors.forEach(e => console.log('  ', e));
  }
  if (consoleErrors.length > 0) {
    console.log('\n=== Console errors ===');
    consoleErrors.forEach(e => console.log('  ', e.substring(0, 200)));
  }
  
  await page.screenshot({ path: 'test-screenshots/yt-final.png', fullPage: true });
  
  // Dump page text
  const pageText = await page.locator('main').textContent();
  console.log('\n=== Page text (last 500 chars) ===');
  console.log(pageText.substring(pageText.length - 500));
  
  await browser.close();
  console.log('\n=== Done ===');
})();
