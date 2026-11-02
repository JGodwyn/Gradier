# Gradier

Point at **any gradient on your running site**, edit it visually, and save the change straight back into your source code. The editor only runs in development and never ships to production.

**Edit existing CSS gradients.** Press <kbd>Alt</kbd>+<kbd>P</kbd> and click any gradient on the page: `linear-`, `radial-`, `conic-` or `repeating-*`, on an element or its `::before`/`::after`, in any layer of a multi-layer background. Drag its colour stops, change colours, angle and type, and watch the page update live. Your edits save automatically: Gradier finds where that gradient is written in your project, whether a CSS/SCSS/Less file, a CSS Module, a `<style>` block, an HTML `style=""`, a JSX `style={{…}}` or a template, and rewrites **just that gradient** in place. If it can't be traced to one string in source (Tailwind classes, values built at runtime), **Copy for AI agent** hands the change to your coding agent.

**Design mesh gradients.** Drop `<gradier-gradient name="hero">` anywhere and press <kbd>Alt</kbd>+<kbd>G</kbd>. Shape it with colour nodes, lines, arcs and freehand strokes; tune softness, blend mode, grain and filters per node or for the whole gradient; export it as PNG or JPG; and save it to `src/gradients.json`. The mesh runtime is the one part that ships: about 11 kB gzipped, WebGL with a CSS fallback.

## Quick start

1. Install it in your project:

   ```bash
   npm i gradier
   ```

   Only editing existing CSS gradients? Use `npm i -D gradier`: then nothing from Gradier ships. If you use mesh gradients, keep it a normal dependency, because their runtime ships with your site.

2. Connect it to your dev server. With Vite it's one line in `vite.config.js`:

   ```js
   import gradier from 'gradier/vite';

   export default {
     plugins: [gradier({ file: 'src/gradients.json' })],
   };
   ```

   Other setups (React, Next.js, Nuxt, Astro, SvelteKit, Rails, Laravel, Django, plain HTML…) are below.

3. Run your dev server as usual and look for the **Gradier** pill in the bottom-right corner. Press <kbd>Alt</kbd>+<kbd>P</kbd> to edit a CSS gradient, or <kbd>Alt</kbd>+<kbd>G</kbd> for mesh gradients.

Using an AI coding agent? Run `npx gradier skill` and ask it to set Gradier up for you; see [AI agent skill](#ai-agent-skill).

## Set up

### Vite single-page apps (React, Vue, Svelte, Solid, vanilla…)

```js
// vite.config.js
import gradier from 'gradier/vite';

export default {
  plugins: [gradier({ file: 'src/gradients.json' })],
};
```

That's all you need for CSS gradients. For mesh gradients, also register your saved gradients:

```js
// main.js
import { registerGradients } from 'gradier';
import gradients from './gradients.json';

registerGradients(gradients);
```

```html
<gradier-gradient name="hero" style="height: 60vh">
  <h1>Content sits on top of the gradient</h1>
</gradier-gradient>
```

The plugin uses `apply: 'serve'`, so `vite build` contains no editor code.

### React

```jsx
import { Gradient, registerGradients } from 'gradier/react';
import gradients from './gradients.json';

registerGradients(gradients);

export function Hero() {
  return <Gradient name="hero" style={{ height: '60vh' }}>…</Gradient>;
}
```

`<Gradient>` also renders a CSS approximation on the server (SSR), so the page never flashes before WebGL kicks in.

### Anything else (Next.js, Nuxt, Astro, SvelteKit, Rails, Django, Laravel, static HTML…)

Run the standalone save server next to your dev server:

```bash
npx gradier serve --file src/gradients.json   # port 4747; --root to scan another dir, --origin to allow a non-localhost dev URL
```

and add the overlay script to your page **in development only**:

```html
<script src="http://localhost:4747/__gradier/overlay.js" defer></script>
```

For example, in a Next.js `app/layout.tsx`:

```jsx
import Script from 'next/script';
// inside <body>
{process.env.NODE_ENV === 'development' && (
  <Script src="http://localhost:4747/__gradier/overlay.js" strategy="afterInteractive" />
)}
```

The [skill](https://github.com/JGodwyn/Gradier/blob/main/skills/gradier/SKILL.md) has snippets for Nuxt, Astro, SvelteKit, Remix, Angular, Laravel, Rails and Django.

Express / webpack-dev-server users can mount the middleware directly:

```js
import { createGradierMiddleware } from 'gradier/server';
app.use(createGradierMiddleware({ file: 'src/gradients.json' }));
```

## Using the editor

When your dev server is running, the editor appears as a **Gradier** pill in the bottom-right corner of your site.

### Opening it

- **Alt+G** (or click the pill): open or close the editor for mesh gradients.
- **Alt+P** (or the crosshair button in the panel): pick any CSS gradient on the page, then click it. **Esc** cancels.

### CSS gradients

After picking a gradient, the panel shows its stops and settings, and the page updates live.

| Task | How |
| --- | --- |
| Add a stop | Click the gradient bar, or **+ Add** |
| Move a stop | Drag its marker, or type a position |
| Change a colour | The swatch, type any CSS colour, or the **Opacity** slider |
| Remove a stop | Select it and press **Delete**, or the bin icon |
| Type | Linear, radial or conic |
| Angle / centre | Drag the handles on the page (**Shift** snaps), or the sliders |
| Save to source | Automatic: changes are written back shortly after you stop editing (HTML and server templates, which reload the page, are written when you move on to another gradient). **⌘/Ctrl+S** writes right away. The **Source** row shows the file and line; if several places match, choose one or update all |
| Expand | **F** or the expand button in the header: edit the gradient large in the middle of the screen. **F**, **Esc** or a click outside goes back |
| Can't save automatically | **Copy CSS**, or **Copy for AI agent** (an edit request for a coding agent) |
| Make it a mesh gradient | **Make it a mesh gradient** turns the element into a mesh gradient seeded from its colours (or start from one of your saved gradients), so you can add points, curves, grain and filters. Gradier adds `data-gradier="name"` to the element's tag in your source; the page needs the Gradier runtime (`import { registerGradients } from 'gradier'` plus your gradients file) for it to show outside the editor |

### Mesh gradients

#### The page

Each `<gradier-gradient>` gets a label; click it to edit that gradient (a yellow `name · click to create` label creates a missing one). The selected gradient shows its colour points as handles.

- **Click a node** to select it. **Click empty space** or press **Esc** to deselect.
- **Drag a node** to move it (**Shift** snaps to a grid).
- A selected plain node shows a **dashed circle** (its area) with a **curved grip**: drag the grip to grow or shrink how far the colour reaches. It also shows **four arms**: drag any arm to stretch the colour that way.
- **Delete** removes the selected node.

#### The toolbar (bottom of the screen)

| Tool | Key | What it does |
| --- | --- | --- |
| Select | V | Select and drag nodes (Esc also returns here) |
| Line | L | Drag across the gradient to draw a line; the colour spreads along it. Drag its ends to reshape |
| Arc | A | Drag to draw an arc; drag its colour point to bend it |
| Node | N | Click to add a node; it takes the colour under the cursor |
| Pencil | P | Draw a freehand stroke; the colour follows it. Drag the middle handle to move it, an end to bend it, and an end's grip to make the colour wider or narrower there |
| Shuffle | X | Shuffle the nodes' colours |
| Scatter | R | Move the nodes to random positions |
| Eye | H | Hide or show the handles, to see the clean gradient |

Double-clicking the gradient also adds a node.

#### The panel

| Section | Controls |
| --- | --- |
| Gradient | Pick which gradient to edit; rename, delete, or create one |
| Points | By default shows only the selected node; open the dropdown to see all. Change colours by swatch or hex; remove nodes |
| Blend | **Softness** (higher is softer), **Blend mode** (drag through Normal, Linear, OKLab, Screen, Multiply, Overlay, Soft light), **Warp**, **Warp size**, **Motion** |
| Grain | **Mono**, **Duo** or **Multi**; **Opacity**, **Grain size**, **Density** |
| Filter | **Hue**, **Saturation**, **Brightness**, **Temperature**, and a reset button |
| Presets | Ready-made gradients; **Randomize**, **Shuffle colors** |
| Export | Size 1×–4× of the element, then **JPG**, **PNG**, or **Copy** (a PNG on the clipboard) |
| Use in code | Copy the HTML tag, a CSS approximation, or the JSON |

**Selected node vs all nodes:** with a node selected, Softness, Blend mode and the Filter sliders change only that node (the section shows a "Node N" chip). With nothing selected they change every node ("All nodes").

Sections collapse with their chevron. The panel floats at the top right: drag it by its header to move it (double-click the header to snap it back); the header has the CSS-gradient picker, expand, a button to snap the panel to a side, and close. Undo/redo sit in the footer.

**Colours:** each colour field is a swatch, its hex, and its opacity. Click the swatch for the picker (a saturation/brightness square, a hue bar, and the value as HEX, RGB or HSL); type a hex directly; set opacity by typing, with the arrow keys, or by dragging the ◐ icon. A mesh point below 100% lets the page show through.

#### Saving

Edits are saved to the gradients file (default `src/gradients.json`) automatically, half a second after you stop changing things; the footer shows the status. **⌘/Ctrl+S** saves right away. **⌘/Ctrl+Z** / **⌘/Ctrl+Shift+Z** undo and redo.

#### Saved gradients and the expanded view

**Saved** (between Gradient and Points, always visible) is your own library: **+ Save** keeps the current gradient; select any gradient and click a swatch to apply it; hover a swatch to remove it. The library is stored in `~/.gradier/library.json`, so it follows you across projects.

**F** or the expand button in the header shows the gradient large in the middle of the screen, at the element's aspect ratio, with all the handles and tools. **F**, **Esc** or a click outside returns to the page.

### Any element as a mesh gradient

Add `data-gradier="name"` to any element and the runtime puts that mesh gradient behind its content, following its rounded corners, without changing the tag:

```html
<button class="cta" data-gradier="cta">Get started</button>
```

This is what **Make it a mesh gradient** writes for you. When the gradient came from a `::before`/`::after`, it also writes `data-gradier-replaces="before"` (or `after`), which hides that pseudo-element's gradient so the mesh takes its place.

## Gradient format

Mesh gradients are stored by name in one JSON file (default `src/gradients.json`). The editor writes it when you save, and you can edit it by hand:

```json
{
  "hero": {
    "points": [
      { "x": 0.1, "y": 0.2, "color": "#ffb4a2" },
      { "x": 0.8, "y": 0.1, "color": "#8b5cf6" },
      { "x": 0.5, "y": 0.9, "color": "#22d3ee" }
    ],
    "softness": 0.5,
    "warp": 0.3,
    "warpScale": 0.35,
    "grain": 0.08,
    "speed": 0
  }
}
```

`x`/`y` are relative to the element (0–1). Higher `softness` gives softer, wider blends; `speed > 0` animates the gradient (paused off-screen and for reduced-motion users). Colours blend in OKLab by default, which keeps transitions vivid instead of muddy.

The editor also writes optional fields, left out when unchanged: per-point `radius`, `arms`, `shape` (line, arc or freehand stroke), and per-point or whole-gradient `softness`, `blendMode`, `hue`, `saturation`, `brightness` and `temperature`, plus `grainType`, `grainSize` and `grainDensity`. Every field, with ranges and examples, is in [`skills/gradier/MESH.md`](https://github.com/JGodwyn/Gradier/blob/main/skills/gradier/MESH.md).

## Runtime API

```ts
import {
  registerGradients, // (map) register gradients by name
  setGradient,       // (name, gradient) update one live
  getGradient,
  gradientToCSS,     // (gradient) -> CSS background string
  randomGradient,
  PRESETS,
} from 'gradier';

// Inline data, no name lookup:
document.querySelector('gradier-gradient').gradient = { points: [...] };
```

## AI agent skill

Gradier ships a skill that teaches coding agents (Claude Code, or any agent that reads skills) to use it. Install it in your project:

```bash
npx gradier skill            # writes .claude/skills/gradier/
npx gradier skill --print    # or print it to paste elsewhere
```

With it, an agent can:
- detect your framework, install Gradier and wire it up behind development-only guards, then verify the setup,
- apply the edit requests from **Copy for AI agent**, including Tailwind and design-token cases,
- write or adjust mesh gradients directly in `gradients.json`,
- explain any editor control, and troubleshoot.

The skill lives in [`skills/gradier/`](https://github.com/JGodwyn/Gradier/blob/main/skills/gradier/): [`SKILL.md`](https://github.com/JGodwyn/Gradier/blob/main/skills/gradier/SKILL.md) (setup, saving, edit requests, troubleshooting), [`MESH.md`](https://github.com/JGodwyn/Gradier/blob/main/skills/gradier/MESH.md) (the gradient format and runtime) and [`EDITOR.md`](https://github.com/JGodwyn/Gradier/blob/main/skills/gradier/EDITOR.md) (every control).

## Security

The save API only accepts requests from localhost origins and the dev server's own origin. Pass `--origin https://my.local.dev` to allow another dev origin. The CLI binds to `127.0.0.1`.

It writes only two kinds of thing:
- the mesh JSON file, after validating every gradient,
- gradient text in source files inside the project root, outside `node_modules` and build directories.

A CSS rewrite must replace text that is still a gradient with a single gradient function containing no quotes, braces, semicolons or angle brackets. It can't inject anything into your code.

## Working on Gradier itself

```
packages/gradier       the npm package
skills/gradier         the agent skill (shipped in the package)
examples/vite-vanilla  plain HTML + Vite: mesh and CSS gradients
examples/vite-react    React + Vite
```

### Live preview while developing

```bash
git clone -b main https://github.com/JGodwyn/Gradier.git
cd Gradier
npm install
npm run live
```

`npm run live` builds the editor and starts the example at http://localhost:5173. It also checks GitHub's `main` every 15 seconds and pulls new changes. After a pull, it rebuilds, runs `npm install` if dependencies changed, and restarts the server, so you only need to refresh the browser. It only ever fast-forwards: if your own edits are in the way, it tells you and doesn't touch them.

Variants:
- `npm run live:react` runs the React example instead.
- `npm run sync` pulls without running anything.
- `--interval 30` changes how often it checks.

No local setup needed:

- **GitHub Codespaces** (recommended, a full Linux VM): [open in Codespaces](https://codespaces.new/JGodwyn/Gradier). It installs, builds and starts the example. When port 5173 opens in a new tab, press <kbd>Alt</kbd>+<kbd>P</kbd> and click a gradient. Saves land in the codespace's files, and you can watch them change in the editor.
- **StackBlitz** (runs in your browser tab): [open in StackBlitz](https://stackblitz.com/github/JGodwyn/Gradier).

The examples already allow these preview domains. For your own project in a cloud environment, allow its domain too: `gradier({ allowedOrigins: ['https://*.app.github.dev'] })` or `gradier serve --origin 'https://*.app.github.dev'`.

### Develop

```bash
npm install
npm run example         # builds the package, starts examples/vite-vanilla
npm run example:react
npm run dev             # rebuild the package on change
npm test -w gradier     # tests
```

### Publish to npm

From an up-to-date `main`:

```bash
npm login
```

```bash
npm publish -w gradier
```

Publishing builds the package, copies this README into it, and runs the type check and tests first; it stops if any of them fail. For later releases, bump the version first (`npm version patch -w gradier`), then publish again.
