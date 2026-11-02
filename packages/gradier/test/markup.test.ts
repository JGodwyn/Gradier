import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { addLayerAttribute } from '../src/server/markup';

const project = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'gradier-markup-'));
  for (const [f, text] of Object.entries(files)) writeFileSync(path.join(root, f), text);
  return root;
};

test('adds data-gradier to the element found by class', async () => {
  const root = project({ 'index.html': '<div class="a">x</div>\n<div class="card big">Hi</div>', 'style.css': '.card{}' });
  const res = await addLayerAttribute(root, { tag: 'div', classes: ['card'] }, 'card');
  assert.equal(res.file, 'index.html');
  assert.equal(res.line, 2);
  assert.equal(readFileSync(path.join(root, 'index.html'), 'utf8'), '<div class="a">x</div>\n<div data-gradier="card" class="card big">Hi</div>');
});

test('uses the inline style location and JSX className', async () => {
  const src = 'const A = () => <div className="row"><div style={{ background: "linear-gradient(red, blue)" }}>A</div></div>;';
  const root = project({ 'App.jsx': src });
  const at = { file: 'App.jsx', start: src.indexOf('linear-gradient') };
  await addLayerAttribute(root, { tag: 'div', at }, 'inline');
  assert.match(readFileSync(path.join(root, 'App.jsx'), 'utf8'), /<div data-gradier="inline" style=/);
});

test('breaks ties by text, refuses when still ambiguous, replaces an existing value', async () => {
  const root = project({ 'index.html': '<p class="t">One</p><p class="t">Two</p>' });
  await addLayerAttribute(root, { tag: 'p', classes: ['t'], text: 'Two' }, 'two');
  assert.equal(readFileSync(path.join(root, 'index.html'), 'utf8'), '<p class="t">One</p><p data-gradier="two" class="t">Two</p>');
  await addLayerAttribute(root, { tag: 'p', classes: ['t'], text: 'Two' }, 'again');
  assert.match(readFileSync(path.join(root, 'index.html'), 'utf8'), /<p data-gradier="again" class="t">Two/);
  await assert.rejects(addLayerAttribute(root, { tag: 'p', classes: ['t'] }, 'x'), /2 matching/);
});
