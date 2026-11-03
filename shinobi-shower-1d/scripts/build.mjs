// Bundles the game into one page, so it can be opened or shared as a single file.
//   dist/index.html             a complete page
//   dist/shinobi-1d-artifact.html the same page without the document wrapper
// `--serve` rebuilds on save at http://localhost:5199, with the debug hook on and sound off.
import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serve = process.argv.includes('--serve');
const dist = join(root, serve ? 'dist-dev' : 'dist');

const shared = {
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2021',
  logLevel: 'warning',
};
const wrap = (fragment) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;

await mkdir(dist, { recursive: true });
const template = await readFile(join(root, 'index.html'), 'utf8');

if (serve) {
  await writeFile(join(dist, 'index.html'), wrap(template.replace('<!--SCRIPTS-->', '<script src="/game.js"></script>')));
  const ctx = await context({ ...shared, outfile: join(dist, 'game.js'), sourcemap: true, define: { __DEV__: 'true' } });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: dist, port: 5199 });
  console.log(`Shinobi Shower 1D: http://localhost:${port}`);
} else {
  const out = await build({ ...shared, write: false, minify: true, define: { __DEV__: 'false' } });
  const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const page = template.replace('<!--SCRIPTS-->', () => `<script>${js}</script>`);
  await writeFile(join(dist, 'shinobi-1d-artifact.html'), page);
  await writeFile(join(dist, 'index.html'), wrap(page));
  console.log(`Wrote dist/ (${(page.length / 1024).toFixed(0)} KB)`);
}
