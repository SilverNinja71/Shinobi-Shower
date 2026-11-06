import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const artifactDir = '/Users/lin/.gemini/antigravity/brain/5e0300c7-8cb2-455c-a54f-41f28a9ca324';
mkdirSync(artifactDir, { recursive: true });

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const distDir = '/Users/lin/Games/shinobi-bridge-1d/dist';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.stl': 'application/octet-stream',
};

// Start static file server
const server = createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = join(distDir, urlPath === '/' ? 'index.html' : urlPath);
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise((res) => server.listen(0, res));
const port = server.address().port;
console.log(`Server listening on port ${port}`);

async function takeScreenshot(url, outputPath, waitMs = 2000) {
  console.log(`Capturing: ${url} -> ${outputPath}`);
  const args = [
    '--headless=new',
    '--user-data-dir=/tmp/chrome-profile-sandbox-' + Math.floor(Math.random() * 10000),
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
  // 1. Cutscene: Soldier's soul floating through the clouds & stopping on the white-and-gold staircase
  await takeScreenshot(
    `http://127.0.0.1:${port}/?autostart=1&seed=7&level=50&cutscene=1&cuttime=6.62&freeze=1`,
    `${artifactDir}/celestial_soul_staircase.png`,
    3500,
  );

  // 2. Celestial Clash: Photorealistic White & Gold Staircase + Bridge, MakerWorld Guardians, and Rigged Demons pushing the soldier down
  await takeScreenshot(
    `http://127.0.0.1:${port}/?autostart=1&seed=7&level=50&celestial=1&lightblade=1&freeze=1`,
    `${artifactDir}/celestial_clash_realistic.png`,
    3500,
  );
} finally {
  server.close();
}
