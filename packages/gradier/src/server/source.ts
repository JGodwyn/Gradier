import { existsSync, statSync } from 'node:fs';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compareGradients, findGradients, parseGradient } from '../core/css-gradient';

/** Files that may contain authored gradients. */
const EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less', '.styl', '.pcss', '.postcss',
  '.html', '.htm', '.vue', '.svelte', '.astro', '.mdx', '.md',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
  '.php', '.erb', '.liquid', '.njk', '.hbs', '.twig', '.ejs', '.pug', '.haml', '.slim', '.cshtml', '.razor',
]);
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'tmp', 'temp',
  '.git', '.next', '.nuxt', '.svelte-kit', '.output', '.vercel', '.netlify', '.turbo', '.cache', '.parcel-cache', '.astro', '.angular',
]);
const MAX_FILES = 20000;
const MAX_SIZE = 2_000_000;

export interface FindRequest {
  /** Gradient strings as the browser sees them (CSSOM specified values, inline style, computed). Most specific first. */
  candidates: string[];
  hints?: {
    /** Source files the element's stylesheets came from (Vite dev ids, link hrefs). */
    files?: string[];
    /** Selectors of CSS rules that apply the gradient. */
    selectors?: string[];
  };
}

export interface SourceMatch {
  file: string;
  line: number;
  column: number;
  start: number;
  end: number;
  text: string;
  quality: 'exact' | 'colors';
  /** CSS selector the gradient sits under, when the file is CSS-like. */
  selector: string | null;
  hinted: boolean;
  score: number;
}

export interface ReplaceEdit {
  file: string;
  start: number;
  end: number;
  /** The text currently at [start, end) — guards against editing a file that changed underneath us. */
  text: string;
  replacement: string;
}

export class SourceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Every source file under root that may contain gradients or markup. */
export const walkSource = (root: string) => walk(root);

async function walk(root: string, out: string[] = [], dir = root): Promise<string[]> {
  if (out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(root, out, path.join(dir, e.name));
    } else if (e.isFile() && EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/** Is `file` inside root and not in an ignored directory? */
export function isEditable(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  if (rel.split(path.sep).some((part) => IGNORE_DIRS.has(part))) return false;
  return EXTENSIONS.has(path.extname(file).toLowerCase());
}

function resolveHint(root: string, hint: string): string | null {
  const clean = decodeURIComponent(hint.split(/[?#]/)[0]!.replace(/^\/@fs/, ''));
  const options = [clean, path.join(root, clean), path.join(root, 'public', clean)];
  for (const p of options) {
    const abs = path.resolve(p);
    if (isEditable(root, abs) && existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
}

/** The selector a CSS declaration at `index` sits under (best effort; ignores comments/strings). */
function selectorAt(text: string, index: number): string | null {
  const open = text.lastIndexOf('{', index);
  if (open === -1) return null;
  if (text.lastIndexOf('}', index) > open) return null;
  const prev = Math.max(text.lastIndexOf('}', open), text.lastIndexOf(';', open), text.lastIndexOf('{', open - 1));
  const sel = text.slice(prev + 1, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  return sel || null;
}

const normSel = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*([>+~,])\s*/g, '$1').trim().toLowerCase();

function lineCol(text: string, index: number) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return { line, column: index - before.lastIndexOf('\n') };
}

export async function findInSource(root: string, req: FindRequest): Promise<SourceMatch[]> {
  const candidates = (req.candidates ?? []).filter((c) => typeof c === 'string' && parseGradient(c)).slice(0, 20);
  if (!candidates.length) return [];
  const hinted = new Set((req.hints?.files ?? []).map((h) => resolveHint(root, h)).filter((x): x is string => !!x));
  const selectors = new Set((req.hints?.selectors ?? []).flatMap((s) => s.split(',')).map(normSel));
  const files = [...hinted, ...(await walk(root)).filter((f) => !hinted.has(f))];
  const matches: SourceMatch[] = [];

  for (const file of files) {
    let text: string;
    try {
      if (statSync(file).size > MAX_SIZE) continue;
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (!/gradient\(/i.test(text)) continue;
    for (const g of findGradients(text)) {
      let quality: SourceMatch['quality'] | null = null;
      let rank = 0;
      for (const [i, c] of candidates.entries()) {
        const q = compareGradients(g.text, c);
        if (q === 'exact') {
          quality = 'exact';
          rank = candidates.length - i;
          break;
        }
        if (q === 'colors' && !quality) quality = 'colors';
      }
      if (!quality) continue;
      const cssLike = /\.(css|scss|sass|less|styl|pcss|postcss|vue|svelte|astro|html?)$/i.test(file);
      const selector = cssLike ? selectorAt(text, g.start) : null;
      const selectorHit = !!selector && selector.split(',').some((s) => selectors.has(normSel(s)));
      const isHinted = hinted.has(file);
      matches.push({
        file: path.relative(root, file),
        ...lineCol(text, g.start),
        start: g.start,
        end: g.end,
        text: g.text,
        quality,
        selector,
        hinted: isHinted,
        score: (quality === 'exact' ? 100 : 0) + (isHinted ? 50 : 0) + (selectorHit ? 40 : 0) + rank,
      });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 50);
}

const SAFE = /^(?:repeating-)?(?:linear|radial|conic)-gradient\([^;{}<>"'`\\]*\)$/i;

function balanced(s: string) {
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** Replace gradient text in source files. Every edit is verified against the current file contents. */
export async function replaceInSource(root: string, edits: ReplaceEdit[]) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 50) throw new SourceError(400, 'Expected 1–50 edits');
  const byFile = new Map<string, ReplaceEdit[]>();
  for (const e of edits) {
    const abs = path.resolve(root, String(e.file));
    if (!isEditable(root, abs)) throw new SourceError(403, `Not an editable source file: ${e.file}`);
    if (typeof e.replacement !== 'string' || !SAFE.test(e.replacement.trim()) || !balanced(e.replacement)) {
      throw new SourceError(400, 'Replacement must be a single CSS gradient');
    }
    if (!e.text?.includes('\n') && e.replacement.includes('\n')) throw new SourceError(400, 'Replacement may not add line breaks');
    byFile.set(abs, [...(byFile.get(abs) ?? []), e]);
  }

  const results: Array<{ file: string; start: number; end: number; text: string; line: number; column: number }> = [];
  for (const [abs, fileEdits] of byFile) {
    let text = await readFile(abs, 'utf8');
    // Locate each edit, tolerating offsets that moved (e.g. the file was edited since the search).
    const located = fileEdits.map((e) => {
      if (text.slice(e.start, e.end) === e.text) return { ...e, start: e.start };
      const hits: number[] = [];
      for (let i = text.indexOf(e.text); i !== -1; i = text.indexOf(e.text, i + 1)) hits.push(i);
      if (!hits.length) throw new SourceError(409, `The gradient in ${e.file} changed since it was found. Pick the element again.`);
      const nearest = hits.reduce((a, b) => (Math.abs(b - e.start) < Math.abs(a - e.start) ? b : a));
      return { ...e, start: nearest, end: nearest + e.text.length };
    });
    located.sort((a, b) => b.start - a.start);
    for (const e of located) text = text.slice(0, e.start) + e.replacement + text.slice(e.start + e.text.length);
    const tmp = `${abs}.${process.pid}.gradier.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, abs);
    // Report new ranges (ascending order; account for earlier edits' length changes).
    let shift = 0;
    for (const e of located.reverse()) {
      const start = e.start + shift;
      shift += e.replacement.length - e.text.length;
      results.push({ file: path.relative(root, abs), start, end: start + e.replacement.length, text: e.replacement, ...lineCol(text, start) });
    }
  }
  return results;
}
