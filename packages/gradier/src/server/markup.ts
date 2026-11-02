import { existsSync, statSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidName } from '../core/types';
import { isEditable, SourceError, walkSource } from './source';

/** Describes an element on the page so its opening tag can be found in source. */
export interface MarkupTarget {
  tag: string;
  id?: string;
  classes?: string[];
  /** Start of the element's visible text, to tell identical elements apart. */
  text?: string;
  /** A source location known to be inside the element's opening tag (e.g. its inline `style` gradient). */
  at?: { file: string; start: number };
}

/** Files that can contain markup (stylesheets can't). */
const MARKUP = /\.(html?|vue|svelte|astro|mdx?|jsx|tsx|js|ts|mjs|cjs|php|erb|liquid|njk|hbs|twig|ejs|cshtml|razor)$/i;
const ATTR = 'data-gradier';

/** End of the opening tag that starts at `start` (`<tag`), skipping quoted strings and JSX braces. */
function tagEnd(text: string, start: number): number {
  let quote = '';
  let depth = 0;
  for (let i = start + 1; i < text.length && i < start + 4000; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth <= 0) return i;
    else if (c === '<' && depth <= 0) return -1;
  }
  return -1;
}

const attrValue = (attrs: string, names: string) =>
  new RegExp(`(?:^|\\s)(?:${names})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*["'\`]([^"'\`]*)["'\`]\\s*\\})`).exec(attrs)?.slice(1).find((v) => v !== undefined);

const visibleText = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();

interface Hit {
  file: string;
  /** Index just after `<tag`. */
  at: number;
  attrs: string;
  attrsStart: number;
  text: string;
}

function tagsIn(text: string, tag: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const re = new RegExp(`<${tag}(?=[\\s/>])`, 'gi');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = tagEnd(text, m.index);
    if (end === -1) continue;
    const at = m.index + 1 + tag.length;
    hits.push({ file, at, attrs: text.slice(at, end), attrsStart: at, text: text.slice(end + 1, end + 400) });
  }
  return hits;
}

/** Write `data-gradier="name"` on the element's opening tag. Returns where. */
export async function addLayerAttribute(root: string, target: MarkupTarget, name: string) {
  if (!isValidName(name)) throw new SourceError(400, 'Invalid gradient name');
  const tag = String(target.tag ?? '').toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new SourceError(400, 'Invalid tag');
  const classes = (target.classes ?? []).filter((c) => typeof c === 'string' && c && !c.startsWith('gradier'));
  const id = typeof target.id === 'string' ? target.id : '';
  const snippet = visibleText(String(target.text ?? '')).slice(0, 40);

  let hit: Hit | undefined;
  // 1. A known location inside the tag (inline style): take the tag that encloses it.
  if (target.at) {
    const abs = path.resolve(root, String(target.at.file));
    if (MARKUP.test(abs) && isEditable(root, abs) && existsSync(abs)) {
      const text = await readFile(abs, 'utf8');
      const open = text.lastIndexOf(`<${tag}`, target.at.start);
      const end = open === -1 ? -1 : tagEnd(text, open);
      if (end > target.at.start) hit = tagsIn(text.slice(0, end + 1), tag, abs).find((x) => x.at === open + 1 + tag.length);
    }
  }
  // 2. Otherwise search markup for a tag with the same id / classes (and text, to break ties).
  if (!hit) {
    if (!classes.length && !id) throw new SourceError(404, 'The element has no class or id to find it by in your source.');
    const hits: Array<Hit & { score: number }> = [];
    for (const file of await walkSource(root)) {
      if (!MARKUP.test(file)) continue;
      let text: string;
      try {
        if (statSync(file).size > 2_000_000) continue;
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      if (id && !text.includes(id)) continue;
      if (!classes.every((c) => text.includes(c))) continue;
      for (const x of tagsIn(text, tag, file)) {
        if (id && attrValue(x.attrs, 'id') !== id) continue;
        const cls = (attrValue(x.attrs, 'class|className') ?? '').split(/\s+/);
        if (!classes.every((c) => cls.includes(c))) continue;
        hits.push({ ...x, score: snippet && visibleText(x.text).startsWith(snippet) ? 1 : 0 });
      }
    }
    const best = hits.filter((x) => x.score === Math.max(...hits.map((y) => y.score)));
    if (!best.length) throw new SourceError(404, `Couldn't find <${tag}${id ? `#${id}` : ''}${classes.map((c) => `.${c}`).join('')}> in your source.`);
    if (best.length > 1) throw new SourceError(409, `Found ${best.length} matching <${tag}> elements in your source, so it isn't clear which one to change.`);
    hit = best[0];
  }
  if (!hit) throw new SourceError(404, `Couldn't find the element's tag in your source.`);

  const text = await readFile(hit.file, 'utf8');
  const existing = new RegExp(`(\\s)${ATTR}\\s*=\\s*("[^"]*"|'[^']*')`).exec(hit.attrs);
  const next = existing
    ? text.slice(0, hit.attrsStart + existing.index) + `${existing[1]}${ATTR}="${name}"` + text.slice(hit.attrsStart + existing.index + existing[0].length)
    : text.slice(0, hit.at) + ` ${ATTR}="${name}"` + text.slice(hit.at);
  const tmp = `${hit.file}.${process.pid}.gradier.tmp`;
  await writeFile(tmp, next, 'utf8');
  await rename(tmp, hit.file);
  return { file: path.relative(root, hit.file), line: text.slice(0, hit.at).split('\n').length };
}
