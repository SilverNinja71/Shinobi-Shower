// Serves the sprite baker and writes what it posts into sprites/.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = await build({ entryPoints: [join(root, 'tools/bake/bake.ts')], bundle: true, format: 'iife', write: false, logLevel: 'warning' });
const js = out.outputFiles[0].text;
const types = { '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary' };
createServer(async (req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/save/')) {
    const parts = [];
    for await (const c of req) parts.push(c);
    await writeFile(join(root, 'sprites', req.url.slice(6).replace(/[^\w.-]/g, '')), Buffer.concat(parts));
    res.end('ok');
  } else if (req.url === '/') {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><body><script>${js.replaceAll('</script', '<\\/script')}</script>`);
  } else {
    try {
      const data = await readFile(join(root, decodeURIComponent(req.url.split('?')[0])));
      res.setHeader('content-type', types[extname(req.url)] ?? 'application/octet-stream');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  }
}).listen(5197, () => console.log('baker on http://localhost:5197'));
