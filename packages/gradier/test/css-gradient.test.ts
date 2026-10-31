import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildConfig,
  compareGradients,
  findGradients,
  parseColor,
  parseConfig,
  parseGradient,
  serializeGradient,
} from '../src/core/css-gradient';
import { findInSource, replaceInSource } from '../src/server/source';

test('findGradients finds calls in CSS and JSX, skipping vendor prefixes', () => {
  const css = `.a{background:-webkit-linear-gradient(top, red, blue);background:linear-gradient(to right, #fff 0%, rgba(0,0,0,.5) 100%), url(x.png)}
  const s = { background: 'radial-gradient(circle at 20% 30%, var(--a), transparent)' };
  .b { background-image: repeating-conic-gradient(from 45deg, red 0 10%, blue 10% 20%); }`;
  const found = findGradients(css).map((g) => g.text);
  assert.deepEqual(found, [
    'linear-gradient(to right, #fff 0%, rgba(0,0,0,.5) 100%)',
    'radial-gradient(circle at 20% 30%, var(--a), transparent)',
    'repeating-conic-gradient(from 45deg, red 0 10%, blue 10% 20%)',
  ]);
});

test('parse + serialize round-trips', () => {
  for (const g of [
    'linear-gradient(to right, #fff 0%, rgba(0, 0, 0, 0.5) 100%)',
    'radial-gradient(circle at 20% 30%, var(--a), transparent)',
    'repeating-conic-gradient(from 45deg, red 0 10%, blue 10% 20%)',
    'linear-gradient(red, 30%, blue)',
  ]) {
    assert.equal(serializeGradient(parseGradient(g)!), g);
  }
  const multi = 'linear-gradient(\n    135deg,\n    #ff0080,\n    #7928ca\n  )';
  assert.equal(serializeGradient(parseGradient(multi)!), multi);
});

test('config parsing and building', () => {
  assert.equal(parseConfig('linear', 'to right').angle, 90);
  assert.equal(parseConfig('linear', '0.5turn').angle, 180);
  assert.equal(parseConfig('linear', 'to top left').corner, 'top left');
  const r = parseConfig('radial', 'circle closest-side at top right');
  assert.deepEqual([r.shape, r.size, r.x, r.y], ['circle', 'closest-side', 100, 0]);
  assert.equal(buildConfig('radial', { ...r, x: 50, y: 50 }), 'circle closest-side');
  assert.equal(buildConfig('linear', parseConfig('linear', null)), null);
  assert.equal(buildConfig('conic', { ...parseConfig('conic', null), angle: 90, x: 25 }), 'from 90deg at 25% 50%');
});

test('colours', () => {
  assert.deepEqual(parseColor('#f00'), [255, 0, 0, 1]);
  assert.deepEqual(parseColor('rgb(255 0 0 / 50%)'), [255, 0, 0, 0.5]);
  assert.deepEqual(parseColor('hsl(120, 100%, 50%)'), [0, 255, 0, 1]);
  assert.deepEqual(parseColor('rebeccapurple'), [102, 51, 153, 1]);
  assert.equal(parseColor('oklch(70% 0.1 200)'), null);
});

test('compareGradients matches authored source against computed values', () => {
  assert.equal(compareGradients('linear-gradient(#FFF, red)', 'linear-gradient(rgb(255, 255, 255), rgb(255, 0, 0))'), 'exact');
  assert.equal(compareGradients('linear-gradient(to bottom, white, red)', 'linear-gradient(rgb(255, 255, 255), rgb(255, 0, 0))'), 'exact');
  assert.equal(compareGradients('linear-gradient(90deg, white, red)', 'linear-gradient(to right, rgb(255, 255, 255), rgb(255, 0, 0))'), 'exact');
  assert.equal(compareGradients('linear-gradient(45deg, white, red)', 'linear-gradient(rgb(255, 255, 255), rgb(255, 0, 0))'), 'colors');
  assert.equal(compareGradients('linear-gradient(white, blue)', 'linear-gradient(white, red)'), null);
  assert.equal(compareGradients('radial-gradient(at center, red, blue)', 'radial-gradient(red, blue)'), 'exact');
  assert.equal(compareGradients('linear-gradient(var(--a), red)', 'linear-gradient(var(--a), rgb(255, 0, 0))'), 'exact');
});

test('findInSource + replaceInSource', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gradier-'));
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'node_modules'));
  writeFileSync(path.join(root, 'src/a.css'), '.hero {\n  background: linear-gradient(90deg, #ff0080, #7928ca);\n}\n.other { background: linear-gradient(90deg, #ff0080, #7928ca); }\n');
  writeFileSync(path.join(root, 'src/App.jsx'), `export const A = () => <div style={{ background: 'linear-gradient(90deg, #ff0080, #7928ca)' }} />;\n`);
  writeFileSync(path.join(root, 'node_modules/x.css'), '.x{background:linear-gradient(90deg, #ff0080, #7928ca)}');

  const matches = await findInSource(root, {
    candidates: ['linear-gradient(90deg, rgb(255, 0, 128), rgb(121, 40, 202))'],
    hints: { files: ['/src/a.css'], selectors: ['.hero'] },
  });
  assert.equal(matches.length, 3);
  assert.equal(matches[0]!.file, path.join('src', 'a.css'));
  assert.equal(matches[0]!.selector, '.hero');
  assert.equal(matches[0]!.line, 2);

  const m = matches[0]!;
  const [res] = await replaceInSource(root, [{ file: m.file, start: m.start, end: m.end, text: m.text, replacement: 'linear-gradient(45deg, #000, #fff)' }]);
  const css = readFileSync(path.join(root, 'src/a.css'), 'utf8');
  assert.match(css, /\.hero \{\n  background: linear-gradient\(45deg, #000, #fff\);/);
  assert.match(css, /\.other \{ background: linear-gradient\(90deg, #ff0080, #7928ca\); \}/);
  assert.equal(res!.text, 'linear-gradient(45deg, #000, #fff)');

  await assert.rejects(replaceInSource(root, [{ ...m, file: 'src/a.css', text: res!.text, start: res!.start, end: res!.end, replacement: "linear-gradient(red, blue)'; alert(1)" }]));
  await assert.rejects(replaceInSource(root, [{ file: '../etc/passwd.css', start: 0, end: 1, text: 'x', replacement: 'linear-gradient(red, blue)' }]));
  await assert.rejects(replaceInSource(root, [{ file: 'node_modules/x.css', start: 0, end: 1, text: 'x', replacement: 'linear-gradient(red, blue)' }]));
});
