// Bundles the game into a single page with its art inside, so it can be opened or shared as one file.
//   dist/index.html            a complete page
//   dist/shinobi-artifact.html the same page without the document wrapper
// `--serve` rebuilds on save at http://localhost:5196, with the debug hook on and sound off.
import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serve = process.argv.includes('--serve');
const dist = join(root, 'dist');

const dataUri = async (path, type) => `data:${type};base64,${(await readFile(join(root, path))).toString('base64')}`;
const art = {
  ninja: await dataUri('sprites/ninja.png', 'image/png'),
  props: await dataUri('sprites/props.png', 'image/png'),
  tile: await dataUri('assets/world/tile_d.jpg', 'image/jpeg'),
  wall: await dataUri('assets/world/wall_d.jpg', 'image/jpeg'),
};
const atlas = JSON.parse(await readFile(join(root, 'sprites/ninja.json'), 'utf8'));

const shared = {
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2021',
  logLevel: 'warning',
};
const define = (dev) => ({ __DEV__: String(dev), __ART__: JSON.stringify(art), __ATLAS__: JSON.stringify(atlas) });
const wrap = (fragment) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;

await mkdir(dist, { recursive: true });
const template = await readFile(join(root, 'src/page.html'), 'utf8');

if (serve) {
  await writeFile(join(dist, 'index.html'), wrap(template.replace('<!--SCRIPTS-->', '<script src="/game.js"></script>')));
  const ctx = await context({ ...shared, outfile: join(dist, 'game.js'), sourcemap: true, define: define(true) });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: dist, port: 5196 });
  console.log(`Shinobi Shower 2D: http://localhost:${port}`);
} else {
  const out = await build({ ...shared, write: false, minify: true, define: define(false) });
  const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const page = template.replace('<!--SCRIPTS-->', () => `<script>${js}</script>`);
  await writeFile(join(dist, 'shinobi-artifact.html'), page);
  await writeFile(join(dist, 'index.html'), wrap(page));
  console.log(`Wrote dist/ (${(page.length / 1024).toFixed(0)} KB)`);
}
