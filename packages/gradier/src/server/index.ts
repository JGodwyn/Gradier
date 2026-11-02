import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidName, normalizeGradient, type GradientMap } from '../core/types';
import { addLayerAttribute, type MarkupTarget } from './markup';
import { findInSource, replaceInSource, SourceError, type FindRequest, type ReplaceEdit } from './source';

export { findInSource, replaceInSource, type FindRequest, type ReplaceEdit, type SourceMatch } from './source';

export const BASE_PATH = '/__gradier';
export const DEFAULT_FILE = 'src/gradients.json';

export interface GradierServerOptions {
  /** Project root. Defaults to `process.cwd()`. */
  root?: string;
  /** JSON file (relative to root) that gradients are saved to. Defaults to `src/gradients.json`. */
  file?: string;
  /**
   * Extra origins allowed to call the API. Localhost origins and the dev server's own
   * origin are always allowed. `*` is a wildcard, e.g. `https://*.app.github.dev`.
   */
  allowedOrigins?: string[];
  /**
   * JSON file for your saved-gradients library (shared across projects). Defaults to
   * `~/.gradier/library.json`.
   */
  libraryFile?: string;
}

export type Middleware = (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;

/** Body accepted by `POST /__gradier/api`. */
export interface SaveRequest {
  save?: Record<string, unknown>;
  delete?: string[];
  rename?: Array<{ from: string; to: string }>;
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(:\d+)?$/;

const overlayPath = () => {
  // This module is bundled into dist/server/index.js, dist/vite.js and dist/cli.js.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, 'overlay.js'), path.resolve(here, '..', 'overlay.js')];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
};

export function resolveGradientsFile(options: GradierServerOptions = {}): string {
  return path.resolve(options.root ?? process.cwd(), options.file ?? DEFAULT_FILE);
}

export async function readGradients(file: string): Promise<GradientMap> {
  if (!existsSync(file)) return {};
  const text = await readFile(file, 'utf8');
  if (!text.trim()) return {};
  const data = JSON.parse(text) as Record<string, unknown>;
  const out: GradientMap = {};
  for (const [name, g] of Object.entries(data)) out[name] = normalizeGradient(g);
  return out;
}

async function writeGradients(file: string, data: GradientMap) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/** One gradient in the saved-gradients library. */
export interface LibraryItem {
  id: string;
  gradient: unknown;
  savedAt: number;
}

export const MAX_LIBRARY = 200;

export function resolveLibraryFile(options: GradierServerOptions = {}): string {
  return options.libraryFile ? path.resolve(options.libraryFile) : path.join(os.homedir(), '.gradier', 'library.json');
}

export async function readLibrary(file: string): Promise<LibraryItem[]> {
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as { items?: unknown };
    return cleanLibrary(data.items);
  } catch {
    return [];
  }
}

function cleanLibrary(items: unknown): LibraryItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is LibraryItem => !!i && typeof i === 'object' && typeof (i as LibraryItem).id === 'string' && !!(i as LibraryItem).gradient)
    .slice(0, MAX_LIBRARY)
    .map((i) => ({ id: i.id.slice(0, 64), gradient: normalizeGradient(i.gradient), savedAt: Number(i.savedAt) || 0 }));
}

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/** Apply a save request to the gradients file. Returns the new contents. */
export async function applySave(file: string, body: SaveRequest): Promise<GradientMap> {
  // Keep the file's key order stable so diffs stay small.
  const data = await readGradients(file);
  for (const { from, to } of body.rename ?? []) {
    if (!isValidName(from) || !isValidName(to)) throw new HttpError(400, `Invalid gradient name`);
    if (!(from in data)) continue;
    if (to in data && to !== from) throw new HttpError(409, `A gradient named "${to}" already exists`);
    const entries = Object.entries(data).map(([k, v]) => [k === from ? to : k, v] as const);
    for (const k of Object.keys(data)) delete data[k];
    for (const [k, v] of entries) data[k] = v;
  }
  for (const name of body.delete ?? []) delete data[name];
  for (const [name, g] of Object.entries(body.save ?? {})) {
    if (!isValidName(name)) throw new HttpError(400, `Invalid gradient name "${name}"`);
    data[name] = normalizeGradient(g);
  }
  await writeGradients(file, data);
  return data;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/**
 * Connect/Express-style middleware that serves the editor overlay and the save API.
 * Works with Vite (`server.middlewares.use`), Express, webpack-dev-server `setupMiddlewares`, etc.
 */
export function createGradierMiddleware(options: GradierServerOptions = {}): Middleware {
  const file = resolveGradientsFile(options);
  const libraryFile = resolveLibraryFile(options);
  const root = path.resolve(options.root ?? process.cwd());
  const extraOrigins = (options.allowedOrigins ?? []).map(
    (o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`, 'i'),
  );
  let queue: Promise<unknown> = Promise.resolve();

  const originAllowed = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (LOCAL_ORIGIN.test(origin) || extraOrigins.some((re) => re.test(origin))) return true;
    try {
      // Same origin as the dev server, also behind a proxy/tunnel that sets X-Forwarded-Host.
      const host = new URL(origin).host;
      const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0]!.trim();
      return host === req.headers.host || (!!forwarded && host === forwarded);
    } catch {
      return false;
    }
  };

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith(`${BASE_PATH}/`)) return next ? next() : send(res, 404, { error: 'Not found' });

    if (!originAllowed(req)) return send(res, 403, { error: 'Origin not allowed' });
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    const route = url.pathname.slice(BASE_PATH.length);
    const handle = async () => {
      if (route === '/overlay.js' && (req.method === 'GET' || req.method === 'HEAD')) {
        const src = await readFile(overlayPath(), 'utf8');
        return send(res, 200, src, 'text/javascript; charset=utf-8');
      }
      if (route === '/api' && (req.method === 'GET' || req.method === 'HEAD')) {
        return send(res, 200, { file: path.relative(root, file), gradients: await readGradients(file) });
      }
      if (route === '/library' && (req.method === 'GET' || req.method === 'HEAD')) {
        return send(res, 200, { items: await readLibrary(libraryFile) });
      }
      if (req.method === 'POST' && (route === '/api' || route === '/library' || route === '/markup/layer' || route.startsWith('/css/'))) {
        if (!String(req.headers['content-type']).includes('application/json')) {
          throw new HttpError(415, 'Expected application/json');
        }
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          throw new HttpError(400, 'Invalid JSON');
        }
        // Serialise writes so concurrent saves can't clobber each other.
        const serial = <T>(fn: () => Promise<T>): Promise<T> => {
          const result = queue.catch(() => {}).then(fn);
          queue = result;
          return result;
        };
        if (route === '/api') {
          const gradients = await serial(() => applySave(file, body as SaveRequest));
          return send(res, 200, { file: path.relative(root, file), gradients });
        }
        if (route === '/library') {
          const items = cleanLibrary((body as { items?: unknown }).items);
          await serial(() => writeJson(libraryFile, { items }));
          return send(res, 200, { items });
        }
        if (route === '/markup/layer') {
          const { element, name } = body as { element: MarkupTarget; name: string };
          return send(res, 200, await serial(() => addLayerAttribute(root, element ?? ({} as MarkupTarget), name)));
        }
        if (route === '/css/find') {
          return send(res, 200, { matches: await findInSource(root, body as FindRequest) });
        }
        if (route === '/css/replace') {
          const edits = (body as { edits: ReplaceEdit[] }).edits;
          return send(res, 200, { results: await serial(() => replaceInSource(root, edits)) });
        }
      }
      send(res, 404, { error: 'Not found' });
    };
    handle().catch((err: unknown) => {
      const status = err instanceof HttpError || err instanceof SourceError ? err.status : 500;
      if (status === 500) console.error('[gradier]', err);
      send(res, status, { error: err instanceof Error ? err.message : String(err) });
    });
  };
}
