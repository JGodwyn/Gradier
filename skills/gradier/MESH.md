# Mesh gradients: format, writing them in code, runtime API

A mesh gradient is a set of 2–12 colour points blended together on the GPU, with optional curves, per-point shaping and a few whole-gradient "look" settings. Gradients are stored by name in a JSON file (default `src/gradients.json`); the editor writes it on save, and you can write it by hand too. Both produce the same thing.

## The file

```json
{
  "hero": {
    "points": [
      { "x": 0.1, "y": 0.2, "color": "#ffb4a2" },
      { "x": 0.8, "y": 0.1, "color": "#8b5cf6" },
      { "x": 0.5, "y": 0.6, "color": "#f472b6" },
      { "x": 0.15, "y": 0.9, "color": "#22d3ee" }
    ],
    "softness": 0.5,
    "warp": 0.3,
    "warpScale": 0.35,
    "grain": 0.08,
    "speed": 0
  }
}
```

Names: letters, numbers, `-` and `_`, starting with a letter or number (`hero`, `pricing-card`).

Everything is validated when loaded: out-of-range numbers are clamped, invalid entries are dropped, and settings equal to their default are left out when the editor saves. Nothing throws, so a typo silently has no effect. Check your values against the tables below.

### Gradient settings

| Field | Range | Default | Effect |
| --- | --- | --- | --- |
| `points` | 2–12 items | | The colour points (below) |
| `softness` | 0–1 | 0.5 | Higher is softer and wider blending; 0 gives crisp regions |
| `warp` | 0–1 | 0.25 | Organic noise distortion of the whole gradient |
| `warpScale` | 0–1 | 0.35 | Size of that distortion: 0 large slow waves, 1 small ripples |
| `grain` | 0–1 | 0.06 | Film grain opacity |
| `speed` | 0–1 | 0 | Animation speed; 0 is static. Animation pauses off-screen and for reduced-motion users |
| `blendMode` | see below | `"oklab"` | How colours mix |
| `grainType` | `"mono"`, `"duo"`, `"multi"` | `"mono"` | Grey, warm/cool, or per-channel colour grain |
| `grainSize` | 1–4 | 1 | Grain cell size in CSS pixels |
| `grainDensity` | 0–2 | 1 | Below 1: fewer grains; above 1: stronger grain |
| `hue` | −180–180 | 0 | Hue rotation in degrees |
| `saturation` | 0–2 | 1 | Colour intensity multiplier |
| `brightness` | 0–2 | 1 | Lightness multiplier |
| `temperature` | −1–1 | 0 | Negative is cooler (bluer), positive warmer |

Blend modes: `"oklab"` (default; vivid, even transitions), `"normal"` (plain sRGB mixing, slightly duller in the middle), `"linear"` (physically linear light, brighter blends), and four that add a contrast curve on top of OKLab mixing: `"screen"` (lighter), `"multiply"` (darker, richer), `"overlay"` (punchier contrast), `"softlight"` (gentle contrast).

### Point fields

| Field | Range | Effect |
| --- | --- | --- |
| `x`, `y` | 0–1 (−0.5–1.5 allowed) | Position relative to the element: `0,0` top-left, `1,1` bottom-right. Points slightly outside pull colour in from the edge |
| `color` | `#rgb` or `#rrggbb` | The colour |
| `radius` | 0.2–5, default 1 | How far this colour reaches |
| `opacity` | 0–1 | How opaque the point's colour is (default 1, omitted). Below 1 the element's background shows through there |
| `softness` | 0–1 | Overrides the gradient's softness for this point |
| `blendMode` | as above | This point's blend mode; it shows around the point and fades into its neighbours |
| `hue`, `saturation`, `brightness`, `temperature` | as above | Filters for this point only, applied on top of the gradient's |
| `arms` | four `[dx, dy]` | Stretch the colour in four directions (below) |
| `shape` | object | Make the colour follow a line, arc or freehand stroke (below) |

### Arms: stretching a point

`arms` is exactly four `[dx, dy]` vectors in units of √(width × height) of the element (so they're the same on wide and tall elements). The default is a cross of length 0.07: `[[0.07, 0], [0, 0.07], [-0.07, 0], [0, -0.07]]`. A longer arm pushes the colour further that way; shorter arms pull it in. Example, a horizontal streak: `[[0.35, 0], [0, 0.02], [-0.35, 0], [0, -0.02]]`. Arms only apply to points without a `shape`.

### Shapes: colour along a curve

The colour spreads along the curve instead of radiating from one spot.

```json
{ "x": 0.5, "y": 0.5, "color": "#facc15", "shape": { "type": "line", "a": { "x": 0.2, "y": 0.7 }, "b": { "x": 0.8, "y": 0.3 } } }
```

- `line`: a straight segment from `a` to `b`. The point's `x`/`y` is its midpoint (recomputed automatically).
- `arc`: a circular arc from `a` **through the point's `x`/`y`** to `b`. Move `x`/`y` to bend it; if the three are in a line it becomes straight.
- `path`: a freehand stroke, `{ "type": "path", "points": [{ "x": …, "y": … }, …] }` with 2–64 points, smoothed into a curve. Put the point's `x`/`y` near the stroke's middle (that's where its handle shows in the editor).
- Optional `ra` / `rb` (0.1–5, default 1): the colour's width at the start / end, for tapered strokes.

## Writing or changing gradients in code

- Edit `src/gradients.json` (or the file passed as `file`) directly. If the dev server is running with the editor open, reload the page to see file edits.
- To change the mood without moving anything, prefer the look settings: warmer → `temperature: 0.3`; muted → `saturation: 0.6`; darker → `brightness: 0.8`; dreamier → raise `softness` and `warp`; crisper → lower `softness`.
- Good colour points: 4–6 points, spread out, with one or two placed near or just past the edges so the corners aren't flat. Neighbouring points with similar lightness blend most smoothly; put one darker point in a corner for depth.
- A soft "aurora" band: a `line` or `path` shape across the element in a bright colour over darker corner points, with `softness` around 0.6 and `warp` 0.3–0.5.
- Keep the user's existing points unless they asked for a new design; changing colours or look settings preserves their layout.
- Starting points ship with the package: `import { PRESETS, randomGradient } from 'gradier'` (`PRESETS.Aurora`, `Peach`, `Ocean`, `Sunset`, `Mono`; `randomGradient(5)`).

## Runtime API

```ts
import {
  registerGradients,   // (map) register gradients by name; call once with the JSON file
  setGradient,         // (name, gradient) add or replace one; mounted elements update live
  getGradient,         // (name)
  getGradients,        // () all registered
  removeGradient,      // (name)
  subscribe,           // (fn(name | null)) -> unsubscribe
  normalizeGradient,   // (anything) -> a valid gradient, with the clamping described above
  gradientToCSS,       // (gradient) -> a CSS background approximation (stacked radial gradients)
  randomGradient,      // (count = 5)
  PRESETS, DEFAULTS, MAX_POINTS,
} from 'gradier';
```

Importing `gradier` defines `<gradier-gradient>`. An element with `name="…"` draws that registered gradient. Instead of a name, you can set data directly: `document.querySelector('gradier-gradient').gradient = { points: [...] }`.

React: `import { Gradient, registerGradients, getGradient } from 'gradier/react'`. `<Gradient name="hero" />` or `<Gradient gradient={{ points: [...] }} />`; it renders the CSS approximation on the server so there's no flash before WebGL starts.

The element is `display: block` with its own stacking context; children render on top of the gradient. Give it a size (height, or content). Without WebGL it shows the CSS approximation.
