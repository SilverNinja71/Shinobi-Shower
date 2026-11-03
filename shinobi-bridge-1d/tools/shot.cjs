// Screenshots the running dev build in headless Chromium (software WebGL, so allow a few seconds).
// Usage: node tools/shot.cjs <out.png> [query] [waitMs] [width] [height]
//   query examples: "autostart=1&level=40&wave=9&t=20"   (see the debug hook in src/main.ts)
// Prints console errors and page errors, and exits non-zero if there were any.
const { chromium } = require('playwright');
(async () => {
  const [out = 'shot.png', query = '', wait = '4000', width = '1280', height = '720'] = process.argv.slice(2);
  const port = process.env.PORT || 5200;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://localhost:${port}/?${query}`);
  await page.waitForTimeout(Number(wait));
  await page.screenshot({ path: out });
  const fps = await page.evaluate(() => (window.bridgeDebug ? window.bridgeDebug.fps : null)).catch(() => null);
  console.log(JSON.stringify({ out, fps, errors }));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
