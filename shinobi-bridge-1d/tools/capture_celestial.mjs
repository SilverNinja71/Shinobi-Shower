import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const artifactDir = '/Users/lin/.gemini/antigravity/brain/5e0300c7-8cb2-455c-a54f-41f28a9ca324';
mkdirSync(artifactDir, { recursive: true });

const server = spawn('node', ['scripts/build.mjs', '--serve'], {
  cwd: '/Users/lin/Games/shinobi-bridge-1d',
  env: { ...process.env, PORT: '5210' },
  stdio: 'ignore',
});

process.on('exit', () => server.kill());
process.on('SIGINT', () => server.kill());

await sleep(2000);

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function takeScreenshot(url, outputPath, waitMs = 1500) {
  console.log(`Capturing: ${url} -> ${outputPath}`);
  const args = [
    '--headless=new',
    '--user-data-dir=/tmp/chrome-profile-capture-celestial',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-webgl',
    '--window-size=1280,720',
    `--virtual-time-budget=${waitMs}`,
    `--screenshot=${outputPath}`,
    url,
  ];

  await new Promise((resolve) => {
    const proc = spawn(chromePath, args);
    proc.on('close', resolve);
  });
}

try {
  await takeScreenshot(
    'http://localhost:5210/?autostart=1&celestial=1&lightblade=1',
    `${artifactDir}/celestial_clash_battle.png`,
    2000
  );
  console.log('Celestial screenshot captured successfully!');
} catch (err) {
  console.error('Error during capture:', err);
} finally {
  server.kill();
  process.exit(0);
}

