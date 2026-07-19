const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('https://viral-clips-kz3jfx9lw-prockolecks-projects.vercel.app/clips', { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input[type="url"]').fill('https://youtu.be/90lLQVZe2Nc');
  await page.locator('button:has-text("Extract Clips")').click();
  await page.waitForTimeout(15000);
  await page.screenshot({ path: 'test-screenshots/embed-check.png', fullPage: true });
  const iframes = await page.locator('iframe').count();
  console.log('Iframe count:', iframes);
  if (iframes > 0) {
    const src = await page.locator('iframe').first().getAttribute('src');
    console.log('First iframe src:', src);
  }
  if (errors.length) {
    console.log('Console errors:');
    errors.forEach(e => console.log(' ', e.substring(0, 200)));
  }
  await browser.close();
})();
