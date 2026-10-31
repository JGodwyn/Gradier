import { cpSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
rmSync('dist', { recursive: true, force: true });

const common = { bundle: true, sourcemap: true, target: 'es2020', logLevel: 'info' };

const builds = [
  // Runtime (browser, shared chunk so `gradier` and `gradier/react` share code).
  {
    ...common,
    entryPoints: { index: 'src/index.ts', react: 'src/react.ts' },
    outdir: 'dist',
    format: 'esm',
    splitting: true,
    platform: 'neutral',
    external: ['react'],
  },
  // Dev overlay: a standalone script served by the dev server.
  {
    ...common,
    entryPoints: { overlay: 'src/overlay/index.ts' },
    outdir: 'dist',
    format: 'iife',
    platform: 'browser',
    minify: !watch,
  },
  // Node: Vite plugin, middleware, CLI.
  {
    ...common,
    entryPoints: { vite: 'src/vite.ts', cli: 'src/cli.ts', 'server/index': 'src/server/index.ts' },
    outdir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'node18',
    external: ['vite'],
  },
];

// The agent skill ships inside the package (`npx gradier skill`).
cpSync('../../skills/gradier', 'dist/skill', { recursive: true });

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
