#!/usr/bin/env node
import { createServer } from 'node:http';
import { createGradierMiddleware, resolveGradientsFile, BASE_PATH, DEFAULT_FILE } from './server/index';

const HELP = `
gradier – live mesh-gradient editor for your dev site

Usage
  npx gradier serve [--file ${DEFAULT_FILE}] [--port 4747] [--origin http://my.dev:3000]

Then add this to your page in development only:
  <script src="http://localhost:4747${BASE_PATH}/overlay.js" defer></script>

Using Vite? Use the plugin instead:  import gradier from 'gradier/vite'
`;

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const cmd = process.argv[2];
if (cmd !== 'serve') {
  console.log(HELP);
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0);
}

const port = Number(arg('port', '4747'));
const file = arg('file', DEFAULT_FILE);
const origins = process.argv.flatMap((a, i) => (a === '--origin' ? [process.argv[i + 1]!] : []));
const middleware = createGradierMiddleware({ file, allowedOrigins: origins });

createServer((req, res) => middleware(req, res)).listen(port, '127.0.0.1', () => {
  console.log(`\n  ◐ gradier  saving to ${resolveGradientsFile({ file })}`);
  console.log(`\n  Add to your page (dev only):`);
  console.log(`  <script src="http://localhost:${port}${BASE_PATH}/overlay.js" defer></script>\n`);
});
