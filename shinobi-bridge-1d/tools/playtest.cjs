// Plays the dev build for a while with scripted input and reports errors, frame rate and draw calls.
// Usage: node tools/playtest.cjs <outDir> [query] [seconds] [width] [height]
//   e.g. node tools/playtest.cjs /tmp/pt "autostart=1&level=40&wave=6&t=2&invincible=1" 40
// Every 5 seconds it saves a screenshot. It holds a run direction, slashes on a rhythm, and now and
// then dashes or kicks, so most systems get exercised. Exits non-zero on any page or console error.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const [outDir = 'playtest', query = 'autostart=1&invincible=1', seconds = '30', width = '1280', height = '720'] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const port = process.env.PORT || 5200;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  await page.goto(`http://localhost:${port}/?${query}`);
  await page.waitForFunction(() => window.bridgeDebug && window.bridgeDebug.view, null, { timeout: 60000 });
  const samples = [];
  const total = Number(seconds) * 1000;
  const start = Date.now();
  let dir = 'KeyD';
  let shot = 0;
  await page.keyboard.down(dir);
  while (Date.now() - start < total) {
    const t = Date.now() - start;
    // Turn around every ~3 s, slash every ~0.45 s, dash and kick now and then.
    if (Math.floor(t / 3000) % 2 === 1 && dir === 'KeyD') {
      await page.keyboard.up(dir);
      dir = 'KeyA';
      await page.keyboard.down(dir);
    } else if (Math.floor(t / 3000) % 2 === 0 && dir === 'KeyA') {
      await page.keyboard.up(dir);
      dir = 'KeyD';
      await page.keyboard.down(dir);
    }
    await page.keyboard.press('KeyJ');
    if (Math.random() < 0.08) await page.keyboard.press('Space');
    if (Math.random() < 0.08) await page.keyboard.press('KeyS');
    if (t > shot * 5000) {
      await page.screenshot({ path: path.join(outDir, `t${String(shot * 5).padStart(3, '0')}.png`) });
      const s = await page.evaluate(() => {
        const d = window.bridgeDebug;
        const info = d.view.renderer.info;
        return {
          fps: d.fps,
          calls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs ? info.programs.length : null,
          phase: d.game.phase,
          wave: d.game.waves.wave,
          drops: d.game.storm.drops.length,
        };
      });
      samples.push({ t: Math.round(t / 1000), ...s });
      shot++;
    }
    await page.waitForTimeout(450);
  }
  await page.keyboard.up(dir);
  console.log(JSON.stringify({ samples, errors }, null, 1));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
