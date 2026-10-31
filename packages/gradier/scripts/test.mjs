import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';

const out = mkdtempSync(path.join(tmpdir(), 'gradier-test-'));
const entries = readdirSync('test').filter((f) => f.endsWith('.test.ts')).map((f) => path.join('test', f));
await esbuild.build({ entryPoints: entries, outdir: out, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, logLevel: 'warning' });
const files = readdirSync(out).map((f) => path.join(out, f));
const { status } = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(status ?? 1);
