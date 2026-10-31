---
name: gradier
description: Set up and use Gradier, a dev-only tool that lets someone point at any gradient on their running website, edit it visually, and save the change straight back into the source code. Use when the user asks to install or configure Gradier, add a visual gradient editor to their dev site, troubleshoot the Gradier overlay or save server, apply a "Gradier edit request" they pasted, or add Gradier mesh gradients (`<gradier-gradient>`) to a page.
---

# Gradier

Gradier injects an editor overlay into a website **in development only**:

- **Pick any CSS gradient** (<kbd>Alt</kbd>+<kbd>P</kbd>): `linear-`, `radial-`, `conic-` and `repeating-*` gradients on any element or its `::before`/`::after`, including multi-layer backgrounds. The user edits stops, colours, angle, type and position on the page, then saves. Gradier finds where that gradient is written in the project (CSS/SCSS/Less, `<style>`, HTML, inline `style`, JSX/TSX/Vue/Svelte/Astro string literals) and rewrites **only that gradient's text** in place.
- **Mesh gradients** (<kbd>Alt</kbd>+<kbd>G</kbd>): an optional WebGL `<gradier-gradient name="…">` web component whose data lives in a JSON file (default `src/gradients.json`) that the overlay writes to.

It has two parts that must both be wired up:

1. **The overlay script**: `/__gradier/overlay.js`, loaded into the page during development.
2. **The save server**: HTTP endpoints under `/__gradier/` that read and write project files. Either the Vite plugin provides them on the Vite dev server, or the standalone CLI (`gradier serve`, default `http://localhost:4747`) does.

Never ship either part to production. Only the optional mesh runtime (`import 'gradier'`) is meant for production.

## 1. Inspect the project first

Before changing anything, work out:

| Question | How to check |
| --- | --- |
| Package manager | Lockfile: `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb`/`bun.lock` → bun |
| Dev server / framework | `package.json` deps & `scripts.dev`; config files: `vite.config.*`, `next.config.*`, `nuxt.config.*`, `astro.config.*`, `svelte.config.*`, `angular.json`, `webpack.config.*`, `remix.config.*`, `Gemfile`, `manage.py`, `composer.json` |
| Who serves the HTML in dev? | Vite SPA (an `index.html` that Vite serves) vs. a framework/server that renders HTML (Next, Nuxt, Astro, SvelteKit, Remix/React Router, Laravel, Rails, Django, PHP, static site generators) |
| Where styles live | `src/**/*.css`, Tailwind config, CSS-in-JS. This sets expectations for what can be auto-saved (see §5) |
| Monorepo? | Workspaces in root `package.json`, `pnpm-workspace.yaml`, `turbo.json`. Decide which directory Gradier should scan (`root`) |

## 2. Install the package

Install as a **dev dependency** unless the project will use mesh gradients in production (then a regular dependency):

```bash
npm i -D gradier        # or: pnpm add -D gradier / yarn add -D gradier / bun add -d gradier
```

If `npm view gradier version` fails (not published yet), build it from source:

```bash
git clone https://github.com/jgodwyn/gradier /tmp/gradier-src
cd /tmp/gradier-src && npm install && npm run build && cd packages/gradier && npm pack
# then, in the user's project:
npm i -D /tmp/gradier-src/packages/gradier/gradier-*.tgz
```

## 3. Wire it up (pick ONE path)

### Path A: Vite single-page apps (Vite serves `index.html`)

Covers vanilla, React, Preact, Vue, Svelte, Solid and Lit apps created with Vite. Add the plugin; it injects the overlay into `index.html` and serves the API on the same origin. It is `apply: 'serve'`, so `vite build` is untouched.

```js
// vite.config.(js|ts)
import { defineConfig } from 'vite';
import gradier from 'gradier/vite';

export default defineConfig({
  plugins: [
    // keep existing plugins
    gradier({ file: 'src/gradients.json' }), // file = where mesh gradients are stored
  ],
});
```

Nothing else is required to edit CSS gradients. The plugin scans Vite's `root` for source files; override it with `gradier({ root: '..' })`.

### Path B: everything else (Next.js, Nuxt, Astro, SvelteKit, Remix/React Router, Angular, webpack, Laravel, Rails, Django, PHP, static HTML…)

Run the standalone save server from the **project root** next to the normal dev server, and load the overlay from it in development only.

1. Add a script to `package.json` (don't rewrite the user's existing `dev` script unless they ask):

   ```json
   "scripts": {
     "gradier": "gradier serve --file src/gradients.json"
   }
   ```

   Options: `--root <dir>` (directory to scan and write; default cwd), `--port 4747`, `--file <json>`, `--origin <url>` (repeatable; needed when the dev site isn't on `localhost`/`127.0.0.1`/`*.localhost`, e.g. `--origin http://myapp.test`).

   If the project already uses `concurrently` or `npm-run-all`, you may offer to add Gradier to the dev command. Otherwise tell the user to run `npm run gradier` in a second terminal.

2. Load the overlay **only in development**, near the end of `<body>` in the root layout:

   **Next.js App Router** (`app/layout.tsx`):
   ```tsx
   import Script from 'next/script';
   // …inside <body>, after {children}:
   {process.env.NODE_ENV === 'development' && (
     <Script src="http://localhost:4747/__gradier/overlay.js" strategy="afterInteractive" />
   )}
   ```

   **Next.js Pages Router** (`pages/_app.tsx`): the same `<Script>` element, rendered next to `<Component {...pageProps} />`.

   **Nuxt** (`nuxt.config.ts`):
   ```ts
   app: { head: { script: process.env.NODE_ENV === 'development' ? [{ src: 'http://localhost:4747/__gradier/overlay.js', defer: true }] : [] } }
   ```

   **Astro** (base layout):
   ```astro
   {import.meta.env.DEV && <script is:inline src="http://localhost:4747/__gradier/overlay.js" defer></script>}
   ```

   **SvelteKit** (`src/routes/+layout.svelte`):
   ```svelte
   <script>import { dev } from '$app/environment';</script>
   <svelte:head>{#if dev}<script src="http://localhost:4747/__gradier/overlay.js" defer></script>{/if}</svelte:head>
   ```

   **Remix / React Router v7** (`app/root.tsx`): in `<body>`, `{import.meta.env.DEV && <script src="http://localhost:4747/__gradier/overlay.js" defer />}`.

   **Laravel Blade**: `@env('local') <script src="http://localhost:4747/__gradier/overlay.js" defer></script> @endenv`
   **Rails ERB**: `<% if Rails.env.development? %><script src="http://localhost:4747/__gradier/overlay.js" defer></script><% end %>`
   **Django**: `{% if debug %}<script src="http://localhost:4747/__gradier/overlay.js" defer></script>{% endif %}` (needs `django.template.context_processors.debug` and `INTERNAL_IPS`)

   **Any JS entry point** (Angular `main.ts`, webpack apps, etc.):
   ```js
   if (process.env.NODE_ENV === 'development') { // Angular: isDevMode(); Vite: import.meta.env.DEV
     const s = document.createElement('script');
     s.src = 'http://localhost:4747/__gradier/overlay.js';
     document.head.append(s);
   }
   ```

   **Plain static HTML**: add the tag and remind the user to remove it before deploying, or serve it only from a dev-only include.

Alternatives in Path B: an Express or webpack-dev-server setup can mount the API on its own origin instead of running the CLI:

```js
import { createGradierMiddleware } from 'gradier/server';
app.use(createGradierMiddleware({ root: process.cwd(), file: 'src/gradients.json' }));          // Express (dev only)
// webpack-dev-server: setupMiddlewares: (mws, devServer) => { devServer.app.use(createGradierMiddleware()); return mws; }
```

Then load `/__gradier/overlay.js` from that same origin.

### Monorepos

The server only scans and writes inside `root`, and skips `node_modules`, `dist`, `build`, `.next`, `.git`, and other build or hidden directories. If shared styles live in another workspace package (e.g. `packages/ui`), widen the root: `gradier({ root: '../..' })` for the Vite plugin (relative to Vite's root), or `gradier serve --root <repo root>` for the CLI. Note that `file` is resolved against that root.

## 4. Verify the setup (do this every time)

1. Start the dev server (and `npm run gradier` for Path B).
2. `curl -sI <overlay URL>` returns `200` with `text/javascript`. The URL is `http://localhost:<vite port>/__gradier/overlay.js` (A) or `http://localhost:4747/__gradier/overlay.js` (B).
3. `curl -s <base>/__gradier/api` returns JSON like `{"file":"src/gradients.json","gradients":{}}`.
4. If a browser tool is available (e.g. Playwright), open the page and check that `document.getElementById('gradier-overlay')` exists and the console has no `[gradier]` errors. Otherwise tell the user to look for the **Gradier** pill in the bottom-right corner.
5. Production safety: for Vite, run the build and confirm `grep -r "__gradier" dist/` finds nothing. For other frameworks, confirm the script tag is behind a dev-only condition.

Tell the user how to use it: **Alt+P** (or the crosshair button) to pick a gradient, edit it, then **Save** or **⌘/Ctrl+S**. The panel's Source row shows the file and line it will write to.

## 5. What auto-save can and cannot handle

Gradier matches the gradient the browser shows against gradient text in source files semantically: `#fff` matches `rgb(255, 255, 255)`, `to bottom` matches the default direction, and `var(--x)` matches `var(--x)`. It ranks matches by the stylesheet the rule came from and by the CSS selector. When several places match, the panel lets the user choose one or update all identical copies.

Works: plain CSS / SCSS / Less / PostCSS files, CSS Modules, `<style>` blocks, Vue/Svelte/Astro SFC styles, HTML `style=""`, JSX `style={{ background: '…' }}`, gradient strings in JS/TS (styled-components/emotion **without** `${}` interpolation inside the gradient), and server templates (ERB, Blade, Twig, Jinja/Django, Liquid, Handlebars, EJS, Pug).

Doesn't auto-save. The panel shows "not found" and the user clicks **Copy for AI agent**, which sends the request to you (see §6):
- Tailwind gradient utilities (`bg-gradient-to-r from-… via-… to-…`, v4 `bg-linear-*`, `bg-radial`, `bg-conic`).
- Gradients assembled at runtime (template interpolation, string concatenation, Sass functions/mixins that generate them, JS theme objects split into parts).
- Gradients from `node_modules` / third-party CSS, or CSS served from another origin.
- Colours or stops coming from a CSS variable that holds the whole gradient (`background: var(--hero-bg)` where the variable is defined elsewhere). Gradier can find the variable's definition only if its text matches; otherwise use §6.

When the matched source uses `var(--…)` colours, any colour the user changes is written as a literal value. Untouched stops keep their variables.

## 6. Applying a "Gradier edit request" (pasted by the user)

The overlay's **Copy for AI agent** button produces text like:

```
Gradier edit request: update this gradient in the source code.

Page: http://localhost:5173/pricing
Element: main > section.pricing > div.card.featured::before
Element classes: card featured
Background layer: 1 of 2
Source: src/styles/cards.css:42:15 (selector ".card.featured::before")
Current gradient (as written in source): linear-gradient(135deg, #ff0080, #7928ca)
New gradient: linear-gradient(120deg, #ff0080 0%, #ffb800 55%, #7928ca 100%)
```

To apply it:

1. If `Source:` names a file, open it at that line and replace the **current** gradient text with the **new** one exactly. Keep the surrounding declaration, other background layers, `!important`, fallbacks and formatting.
2. If the source wasn't found, locate the element. Search for the classes and IDs in `Element:` / `Element classes:` (`rg -n "featured" src`), the component that renders it, and any CSS rule matching the selector path. `Background layer: N of M` says which comma-separated layer of `background`/`background-image` to change. A trailing `::before`/`::after` means the rule is on that pseudo-element.
3. **Tailwind**: replace only the gradient utilities on that element, and keep variant prefixes (`md:`, `hover:`, `dark:`) on any you change. Two ways to write the new gradient:
   - Arbitrary value, which always works and is exact: `bg-[linear-gradient(120deg,#ff0080_0%,#ffb800_55%,#7928ca_100%)]`. Spaces become `_`, and there must be no spaces inside the brackets.
   - Utilities, which are more idiomatic when the gradient fits them. v3: `bg-gradient-to-r from-[#ff0080] via-[#ffb800] via-55% to-[#7928ca]`. v4: `bg-linear-120 from-[#ff0080] via-[#ffb800] via-55% to-[#7928ca]`, with `bg-radial-[at_25%_25%]` and `bg-conic-180` for the other types. Prefer theme colours (`from-pink-500`) only when the hex matches the theme exactly.
4. **CSS variables / design tokens**: if the old gradient used `var(--token)`, update the token's value only if `rg` shows it isn't used elsewhere. Otherwise change this usage.
5. **CSS-in-JS with interpolation**: update the underlying constants or theme values so the rendered result equals the new gradient.
6. Verify: reload the page (or rely on HMR) and confirm the computed `background-image` of the element matches. If you have a browser tool, use `getComputedStyle(el, '::before').backgroundImage`.

## 7. Mesh gradients (optional)

A mesh gradient is a WebGL-rendered set of colour points, with a CSS fallback for SSR and no-WebGL. This path needs `gradier` as a regular **dependency**.

```js
import { registerGradients } from 'gradier';        // defines <gradier-gradient>
import gradients from './gradients.json';           // the file the overlay saves to
registerGradients(gradients);
```

```html
<gradier-gradient name="hero" style="display:block;min-height:60vh">…content on top…</gradier-gradient>
```

React: `import { Gradient, registerGradients } from 'gradier/react'`, then `<Gradient name="hero" style={{ minHeight: '60vh' }} />`. It renders a CSS fallback on the server, so put it in a client component in Next.js (`'use client'`). TypeScript needs `"resolveJsonModule": true` to import the JSON. If `src/gradients.json` doesn't exist yet, create it with `{}`. A gradient name that isn't in the file shows up in the overlay as a yellow "click to create" label.

Gradient JSON shape: `{ "<name>": { "points": [{ "x": 0–1, "y": 0–1, "color": "#rrggbb" }, …2–12], "softness": 0–1, "warp": 0–1, "warpScale": 0–1, "grain": 0–1, "speed": 0–1 } }`. You can edit this file directly. `gradientToCSS(g)` (from `gradier`) gives a pure-CSS approximation.

## 8. HTTP API (for scripting or debugging)

Base: `<origin>/__gradier`. Requests must come from a localhost origin, the server's own origin, or an `--origin`/`allowedOrigins` entry. POST bodies are JSON (`Content-Type: application/json`).

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /overlay.js` | | The overlay script |
| `GET /api` | | `{ file, gradients }` mesh gradients |
| `POST /api` | `{ save?: {name: gradient}, delete?: [name], rename?: [{from,to}] }` | `{ file, gradients }` |
| `POST /css/find` | `{ candidates: [gradient strings], hints?: { files?: [path], selectors?: [css selector] } }` | `{ matches: [{ file, line, column, start, end, text, quality: "exact"\|"colors", selector, score }] }` |
| `POST /css/replace` | `{ edits: [{ file, start, end, text, replacement }] }` | `{ results: [{ file, start, end, text, line, column }] }` |

`/css/replace` refuses a replacement that isn't a single gradient function, that contains `; { } < > " ' \` or a backtick, that adds line breaks to a one-line gradient, or whose target is outside `root` or inside an ignored directory. It also checks that `text` is still at `[start, end)` and relocates it if the file shifted.

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| No Gradier pill | Overlay not loaded. Check the script tag is rendered (view source), the dev condition is true, and the overlay URL returns 200. With Vite SSR frameworks the plugin can't inject into `index.html`, so use Path B. |
| Panel says "Can't reach the save server" | The CLI isn't running or uses a different port, or the page's origin isn't allowed. Add `--origin <page origin>` (a 403 in the network tab confirms this). |
| Script blocked | A CSP on the dev site: allow `http://localhost:4747` in `script-src` and `connect-src` in development. |
| "Not found in source" | See §5. Use **Copy for AI agent** and apply it with §6. In a monorepo, check `--root`. |
| Saved, but the page still shows the old gradient | The dev server didn't hot-reload that file type. Reload the page. Gradier keeps a preview override until the new value appears. |
| Page reloads on every mesh save | Path B or a non-Vite bundler is watching the JSON file. This is harmless, or exclude the file from the watcher. |
| Wrong match chosen | Pick the right one in the Source dropdown, or untick "Update all identical gradients". |
| Port 4747 in use | `gradier serve --port 4848` and update the script URL. |

## 10. Removing Gradier

Delete the Vite plugin entry or the overlay script tag/snippet, the `gradier` package script, and uninstall the package. Keep `src/gradients.json` and the runtime import only if mesh gradients are still in use.

## Rules for agents

- Never load the overlay or mount the API in production builds. Every script tag and middleware must sit behind a development-only condition.
- Don't modify the user's existing `dev`/`build` scripts or CI without asking. Add a separate `gradier` script.
- Don't commit to Git or push on the user's behalf unless asked. Gradier edits are normal file changes the user reviews.
- After setup, always run the verification steps in §4 and report what you checked.
