import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';

const artifactDir = '/Users/lin/.gemini/antigravity/brain/5e0300c7-8cb2-455c-a54f-41f28a9ca324';
mkdirSync(artifactDir, { recursive: true });

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function capture(url, outputFile, waitTime = 2500) {
  const port = 9320 + Math.floor(Math.random() * 80);
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
    for (let i = 0; i < 35; i++) {
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

    await sleep(waitTime);

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

console.log('Starting dev server on port 5218...');
const server = spawn('node', ['scripts/build.mjs', '--serve'], {
  cwd: '/Users/lin/Games/shinobi-bridge-1d',
  env: { ...process.env, PORT: '5218' },
  stdio: 'inherit',
});

await sleep(2000);

try {
  // 1. Mountain Peak Gameplay with pure white slashable rain (background rain gone)
  await capture('http://localhost:5218/?autostart=1&seed=3&wave=2&t=10', `${artifactDir}/pure_white_rain_peak.png`, 2500);

  // 2. Upgraded Celestial Heaven with golden dawn sky dome, fluffy cloud sea, and soft god rays
  await capture('http://localhost:5218/?autostart=1&celestial=1&lightblade=1', `${artifactDir}/celestial_heaven_overhaul.png`, 2800);

  console.log('Screenshots captured successfully!');
} catch (err) {
  console.error('Capture error:', err);
} finally {
  server.kill();
  process.exit(0);
}

