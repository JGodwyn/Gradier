#!/usr/bin/env node
// Keeps your local copy in sync with GitHub while you test.
//
//   npm run live            pull main every 15s, rebuild when needed, and run the example (restarting it after updates)
//   npm run sync            the same, without running the example
//
// Options: --interval <seconds>  --example <workspace dir under examples/>  --once
//
// It only ever fast-forwards. If you have local edits that conflict (e.g. you saved test
// gradients into the examples), it tells you and waits instead of touching your files.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : fallback;
};
const BRANCH = 'main';
const interval = Number(opt('interval', '15')) * 1000;
const exampleName = opt('example', 'vite-vanilla');
const runExample = args.includes('--run');
const once = args.includes('--once');

const time = () => new Date().toLocaleTimeString();
const log = (msg) => console.log(`\x1b[35m[live ${time()}]\x1b[0m ${msg}`);
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const npm = (...a) =>
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', a, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

let example = null;
function startExample() {
  const cwd = path.join(root, 'examples', exampleName);
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(cwd) || !existsSync(vite)) return log(`Can't start examples/${exampleName} (run npm install first).`);
  example = spawn(process.execPath, [vite], { cwd, stdio: 'inherit' });
  example.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && code) log(`Example server exited with code ${code}.`);
  });
}
function restartExample() {
  if (!runExample) return;
  if (example && example.exitCode === null) {
    example.once('exit', startExample);
    example.kill('SIGTERM');
  } else startExample();
}

function build() {
  log('Building the gradier package…');
  try {
    npm('run', 'build');
    return true;
  } catch {
    log('Build failed (see above). Keeping the previous build; will retry on the next update.');
    return false;
  }
}

let warnedBranch = false;
let warnedConflict = '';
function tick() {
  try {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    if (branch !== BRANCH) {
      if (!warnedBranch) log(`You're on "${branch}", not "${BRANCH}". Run: git checkout ${BRANCH}`);
      warnedBranch = true;
      return;
    }
    warnedBranch = false;
    git('fetch', '--quiet', 'origin', BRANCH);
    const before = git('rev-parse', 'HEAD');
    const remote = git('rev-parse', `origin/${BRANCH}`);
    if (before === remote) return;
    if (git('merge-base', before, remote) !== before) {
      log(`Your local "${BRANCH}" has commits that aren't on GitHub, so it can't fast-forward. Push or reset them first.`);
      return;
    }
    try {
      git('merge', '--ff-only', '--quiet', remote);
    } catch (err) {
      const msg = String(err.stderr || err.message);
      if (warnedConflict !== remote) {
        log('New changes are on GitHub, but your local edits are in the way:');
        console.log(msg.split('\n').filter((l) => /^\s+\S/.test(l)).join('\n') || msg);
        log('Keep them with "git stash", or throw away test edits with "git checkout -- examples". I\'ll retry automatically.');
      }
      warnedConflict = remote;
      return;
    }
    warnedConflict = '';
    const changed = git('diff', '--name-only', before, remote).split('\n').filter(Boolean);
    log(`Pulled ${git('rev-list', '--count', `${before}..${remote}`)} update(s):`);
    console.log(git('log', '--format=  • %s', `${before}..${remote}`));
    if (changed.some((f) => /(^|\/)package(-lock)?\.json$/.test(f))) {
      log('Dependencies changed. Running npm install…');
      npm('install');
    }
    if (changed.some((f) => f.startsWith('packages/') || f.startsWith('skills/'))) build();
    if (changed.some((f) => f.startsWith('packages/') || f.startsWith('examples/') || f.endsWith('package.json'))) {
      if (runExample) log('Restarting the example server. Refresh your browser.');
      restartExample();
    } else if (runExample) log('Refresh your browser to see the changes.');
  } catch (err) {
    log(`Sync failed (will retry): ${String(err.stderr || err.message).trim().split('\n')[0]}`);
  }
}

if (!existsSync(path.join(root, 'packages', 'gradier', 'dist', 'overlay.js'))) build();
tick();
if (once) process.exit(0);
if (runExample) startExample();
log(`Watching GitHub "${BRANCH}" every ${interval / 1000}s. Ctrl+C to stop.`);
setInterval(tick, interval);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    example?.kill('SIGTERM');
    process.exit(0);
  });
}
