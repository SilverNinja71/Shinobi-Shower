import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const artifactDir = '/Users/lin/.gemini/antigravity/brain/5e0300c7-8cb2-455c-a54f-41f28a9ca324';
mkdirSync(artifactDir, { recursive: true });

console.log('Starting dev server on port 5210...');
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
    '--user-data-dir=/tmp/chrome-profile-capture',
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
  // 1. Atomic Cleave: Macro zoom on Water Droplet & Nucleus
  await takeScreenshot(
    'http://localhost:5210/?autostart=1&cutscene=1&cuttime=2.4',
    `${artifactDir}/atomic_cleave_nucleus.png`,
    1500
  );

  // 2. Atomic Cleave: The Fission Slice
  await takeScreenshot(
    'http://localhost:5210/?autostart=1&cutscene=1&cuttime=3.5',
    `${artifactDir}/atomic_cleave_slice.png`,
    1500
  );

  // 3. Atomic Cleave: Nuclear Fireball & Bridge Shatter
  await takeScreenshot(
    'http://localhost:5210/?autostart=1&cutscene=1&cuttime=5.2',
    `${artifactDir}/atomic_cleave_explosion.png`,
    1500
  );

  // 4. Celestial Clash: Golden Cloud Arena with Demon & Angel & Light Blade
  await takeScreenshot(
    'http://localhost:5210/?autostart=1&celestial=1&lightblade=1',
    `${artifactDir}/celestial_clash_battle.png`,
    2000
  );

  console.log('All screenshots captured successfully!');
} catch (err) {
  console.error('Error during capture:', err);
} finally {
  server.kill();
  process.exit(0);
}
