import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidName, normalizeGradient, type GradientMap } from '../core/types';

export const BASE_PATH = '/__gradier';
export const DEFAULT_FILE = 'src/gradients.json';

export interface GradierServerOptions {
  /** Project root. Defaults to `process.cwd()`. */
  root?: string;
  /** JSON file (relative to root) that gradients are saved to. Defaults to `src/gradients.json`. */
  file?: string;
  /**
   * Extra origins allowed to call the API. Localhost origins and the dev server's own
   * origin are always allowed.
   */
  allowedOrigins?: string[];
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
  const root = path.resolve(options.root ?? process.cwd());
  const extraOrigins = new Set(options.allowedOrigins ?? []);
  let queue: Promise<unknown> = Promise.resolve();

  const originAllowed = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (LOCAL_ORIGIN.test(origin) || extraOrigins.has(origin) || extraOrigins.has('*')) return true;
    try {
      return new URL(origin).host === req.headers.host;
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
      if (route === '/overlay.js' && req.method === 'GET') {
        const src = await readFile(overlayPath(), 'utf8');
        return send(res, 200, src, 'text/javascript; charset=utf-8');
      }
      if (route === '/api' && req.method === 'GET') {
        return send(res, 200, { file: path.relative(root, file), gradients: await readGradients(file) });
      }
      if (route === '/api' && req.method === 'POST') {
        if (!String(req.headers['content-type']).includes('application/json')) {
          throw new HttpError(415, 'Expected application/json');
        }
        let body: SaveRequest;
        try {
          body = JSON.parse(await readBody(req)) as SaveRequest;
        } catch {
          throw new HttpError(400, 'Invalid JSON');
        }
        // Serialise writes so concurrent saves can't clobber each other.
        const result = (queue = queue.catch(() => {}).then(() => applySave(file, body)));
        const gradients = await result;
        return send(res, 200, { file: path.relative(root, file), gradients });
      }
      send(res, 404, { error: 'Not found' });
    };
    handle().catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('[gradier]', err);
      send(res, status, { error: err instanceof Error ? err.message : String(err) });
    });
  };
}
