// Builds Shinobi Bridge.
//   npm run dev     serves http://localhost:$PORT (default 5200) with the debug hook on and sound muted,
//                   rebuilding on save. Assets are served live from ./assets.
//   npm run build   writes dist/index.html (a complete page), dist/bridge-artifact.html (the same page
//                   without the document wrapper, for publishing) and dist/assets/.
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serve = process.argv.includes('--serve');
const port = Number(process.env.PORT || 5200);
const out = join(root, serve ? 'dist-dev' : 'dist');

const shared = {
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2021',
  logLevel: 'warning',
  loader: { '.vert': 'text', '.frag': 'text', '.glsl': 'text' },
};
const wrap = (fragment) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;

await mkdir(out, { recursive: true });
const template = await readFile(join(root, 'index.html'), 'utf8');

if (serve) {
  const link = join(out, 'assets');
  if (!existsSync(link)) await symlink(join(root, 'assets'), link, 'dir');
  // Re-read the page template on every request so index.html edits show without a restart.
  const ctx = await context({
    ...shared,
    outfile: join(out, 'game.js'),
    sourcemap: true,
    define: { __DEV__: 'true' },
    plugins: [
      {
        name: 'page',
        setup(b) {
          b.onEnd(async () => {
            const page = (await readFile(join(root, 'index.html'), 'utf8')).replace('<!--SCRIPTS-->', '<script src="/game.js"></script>');
            await writeFile(join(out, 'index.html'), wrap(page));
          });
        },
      },
    ],
  });
  await ctx.watch();
  const server = await ctx.serve({ servedir: out, port });
  console.log(`Shinobi Bridge: http://localhost:${server.port}`);
} else {
  const result = await build({ ...shared, write: false, minify: true, define: { __DEV__: 'false' } });
  const js = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const page = template.replace('<!--SCRIPTS-->', () => `<script>${js}</script>`);
  await rm(join(out, 'assets'), { recursive: true, force: true });
  await cp(join(root, 'assets'), join(out, 'assets'), { recursive: true });
  await writeFile(join(out, 'bridge-artifact.html'), page);
  await writeFile(join(out, 'index.html'), wrap(page));
  console.log(`Wrote dist/ (page ${(page.length / 1024).toFixed(0)} KB, plus assets/)`);
}
