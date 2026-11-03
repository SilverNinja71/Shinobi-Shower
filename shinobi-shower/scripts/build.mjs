// Bundles the game. `--serve` runs a dev server with three bundled locally.
// A plain build writes two pages to dist/:
//   index.html            a complete page you can host or open directly
//   shinobi-artifact.html the same page without the document wrapper
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js';
const serve = process.argv.includes('--serve');
const dist = join(root, 'dist');

const threeGlobal = {
  name: 'three-global',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'three-global' }));
    b.onLoad({ filter: /.*/, namespace: 'three-global' }, () => ({
      contents: 'module.exports = window.THREE;',
    }));
  },
};

const shared = {
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2021',
  logLevel: 'info',
};

const wrap = (fragment) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;

await mkdir(dist, { recursive: true });
await cp(join(root, 'assets'), join(dist, 'assets'), { recursive: true });
const template = await readFile(join(root, 'src/page.html'), 'utf8');

if (serve) {
  const page = template.replace('<!--SCRIPTS-->', '<script src="/game.js"></script>');
  await writeFile(join(dist, 'index.html'), wrap(page));
  const ctx = await context({
    ...shared,
    outfile: join(dist, 'game.js'),
    sourcemap: true,
    define: { __DEV__: 'true' },
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: dist, port: 5198 });
  console.log(`Shinobi Shower dev server: http://localhost:${port}`);
} else {
  const out = await build({
    ...shared,
    write: false,
    minify: true,
    plugins: [threeGlobal],
    define: { __DEV__: 'false' },
  });
  const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const page = template.replace(
    '<!--SCRIPTS-->',
    () => `<script src="${THREE_CDN}"></script>\n<script>${js}</script>`,
  );
  await writeFile(join(dist, 'shinobi-artifact.html'), page);
  await writeFile(join(dist, 'index.html'), wrap(page));
  console.log(`Wrote dist/ (${(page.length / 1024).toFixed(0)} KB)`);
}
