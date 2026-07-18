const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE_ERROR: ${err.message}`));
  
  console.log('=== Navigating to clips page ===');
  await page.goto('https://viral-clips-sandy.vercel.app/clips', { waitUntil: 'networkidle', timeout: 30000 });
  
  const title = await page.textContent('h1');
  console.log('Page title:', title);
  
  // Enter YouTube URL
  console.log('\n=== Entering YouTube URL ===');
  await page.locator('input[type="url"]').fill('https://youtu.be/90lLQVZe2Nc');
  
  // Click Extract Clips
  console.log('Clicking Extract Clips...');
  await page.locator('button:has-text("Extract Clips")').click();
  
  // Poll for result
  console.log('\n=== Polling for result (max 120s) ===');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(3000);
    const mainText = await page.locator('main').textContent();
    
    const hasError = mainText.includes('Error') || mainText.includes('Invalid');
    const hasProcessing = mainText.includes('Processing') || mainText.includes('Fetching') || mainText.includes('Loading') || mainText.includes('Analyzing');
    const hasClips = mainText.includes('Clip #') || mainText.includes('Download MP4');
    
    const elapsed = (i + 1) * 3;
    
    if (hasClips) {
      const clipCount = (mainText.match(/Clip #/g) || []).length;
      console.log(`[${elapsed}s] SUCCESS! Found ${clipCount} clips`);
      
      // Get clip details
      const clipTexts = await page.locator('div:has-text("Score:")').allTextContents();
      for (let j = 0; j < Math.min(clipTexts.length, 5); j++) {
        const preview = clipTexts[j].substring(0, 150);
        console.log(`  Clip ${j+1}: ${preview}`);
      }
      break;
    }
    
    if (hasError && !hasProcessing) {
      // Find the actual error message
      const errorDiv = await page.locator('div').filter({ hasText: /error|invalid/i }).last();
      const errorText = await errorDiv.textContent().catch(() => 'unknown');
      console.log(`[${elapsed}s] ERROR: ${errorText.substring(0, 300)}`);
      break;
    }
    
    if (i % 5 === 0) {
      console.log(`[${elapsed}s] Processing...`);
    }
  }
  
  // Check console errors
  if (consoleErrors.length > 0) {
    console.log('\n=== Browser console errors ===');
    consoleErrors.slice(0, 10).forEach(e => console.log('  ', e.substring(0, 200)));
  }
  
  await browser.close();
  console.log('\n=== Done ===');
})();
