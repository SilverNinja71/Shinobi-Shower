import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';

const artifactDir = '/Users/lin/.gemini/antigravity/brain/5e0300c7-8cb2-455c-a54f-41f28a9ca324';
mkdirSync(artifactDir, { recursive: true });

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function capture(url, outputFile, waitTime = 2500) {
  const port = 9222 + Math.floor(Math.random() * 100);
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1280,720',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    url,
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        const list = await res.json();
        if (list && list[0] && list[0].webSocketDebuggerUrl) {
          wsUrl = list[0].webSocketDebuggerUrl;
          break;
        }
      } catch {}
    }

    if (!wsUrl) throw new Error('Could not connect to Chrome debugging port');

    const ws = new WebSocket(wsUrl);
    await new Promise((res) => (ws.onopen = res));

    // Wait for scene/animation to progress
    await sleep(waitTime);

    // Call Page.captureScreenshot
    const id = 1;
    const msgPromise = new Promise((resolve) => {
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.id === id) resolve(data.result.data);
      };
    });

    ws.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    const base64 = await msgPromise;
    ws.close();

    writeFileSync(outputFile, Buffer.from(base64, 'base64'));
    console.log(`Saved screenshot: ${outputFile} (${Math.round(base64.length * 0.75 / 1024)} KB)`);
  } finally {
    chrome.kill();
  }
}

// Start dev server if not running
console.log('Starting dev server on port 5210...');
const server = spawn('node', ['scripts/build.mjs', '--serve'], {
  cwd: '/Users/lin/Games/shinobi-bridge-1d',
  env: { ...process.env, PORT: '5210' },
  stdio: 'inherit',
});

await sleep(2500);

try {
  // 1. Bridge Gameplay (Wave 1)
  await capture('http://localhost:5210/?autostart=1&seed=3', `${artifactDir}/shinobi_bridge_gameplay.png`, 2000);

  // 2. Atomic Cleave: Nucleus & Electron Shells (Macro Zoom)
  await capture('http://localhost:5210/?autostart=1&cutscene=1&cuttime=2.2&freeze=1', `${artifactDir}/atomic_cleave_nucleus.png`, 1500);

  // 3. Atomic Cleave: The Fission Cleave & Whiteout
  await capture('http://localhost:5210/?autostart=1&cutscene=1&cuttime=4.1&freeze=1', `${artifactDir}/atomic_cleave_fission.png`, 1500);

  // 4. Atomic Cleave: Nuclear Fireball & Bridge Shatter
  await capture('http://localhost:5210/?autostart=1&cutscene=1&cuttime=5.0&freeze=1', `${artifactDir}/atomic_cleave_explosion.png`, 1500);

  // 5. Celestial Clash: Golden Cloud Arena with Demon, Angel & Light Blade
  await capture('http://localhost:5210/?autostart=1&celestial=1&lightblade=1&freeze=1', `${artifactDir}/celestial_clash_battle.png`, 2000);

  console.log('All screenshots captured successfully!');
} catch (err) {
  console.error('Capture error:', err);
} finally {
  server.kill();
  process.exit(0);
}

