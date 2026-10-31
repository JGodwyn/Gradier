#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGradierMiddleware, resolveGradientsFile, BASE_PATH, DEFAULT_FILE } from './server/index';

const HELP = `
gradier – edit gradients live on your dev site and save them to source

Usage
  npx gradier serve [--root .] [--file ${DEFAULT_FILE}] [--port 4747] [--origin http://my.dev:3000]
      Start the save server for sites not served by Vite. Then add this to your page in development only:
      <script src="http://localhost:4747${BASE_PATH}/overlay.js" defer></script>

  npx gradier skill [--dir .claude/skills] [--print]
      Install the Gradier setup skill for AI coding agents (or print it).

Using Vite? Use the plugin instead:  import gradier from 'gradier/vite'
`;

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const cmd = process.argv[2];

if (cmd === 'serve') {
  const root = path.resolve(arg('root', process.cwd())!);
  const port = Number(arg('port', '4747'));
  const file = arg('file', DEFAULT_FILE);
  const origins = process.argv.flatMap((a, i) => (a === '--origin' ? [process.argv[i + 1]!] : []));
  const middleware = createGradierMiddleware({ root, file, allowedOrigins: origins });

  createServer((req, res) => middleware(req, res))
    .on('error', (err) => {
      console.error(`[gradier] ${err.message}`);
      process.exit(1);
    })
    .listen(port, '127.0.0.1', () => {
      console.log(`\n  ◐ gradier  project ${root}`);
      console.log(`             mesh gradients saved to ${resolveGradientsFile({ root, file })}`);
      console.log(`\n  Add to your page (dev only):`);
      console.log(`  <script src="http://localhost:${port}${BASE_PATH}/overlay.js" defer></script>\n`);
    });
} else if (cmd === 'skill') {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = [path.join(here, 'skill', 'SKILL.md'), path.join(here, '..', 'skill', 'SKILL.md')].find((p) => existsSync(p));
  if (!src) {
    console.error('[gradier] SKILL.md not found in the package.');
    process.exit(1);
  }
  if (process.argv.includes('--print')) {
    process.stdout.write(await readFile(src, 'utf8'));
  } else {
    const dir = path.resolve(arg('dir', '.claude/skills')!, 'gradier');
    await mkdir(dir, { recursive: true });
    await copyFile(src, path.join(dir, 'SKILL.md'));
    console.log(`Installed the Gradier skill to ${path.relative(process.cwd(), path.join(dir, 'SKILL.md'))}`);
  }
} else {
  console.log(HELP);
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0);
}
