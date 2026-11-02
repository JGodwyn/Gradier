# Using the Gradier editor

Use this to answer "how do I…" questions. The editor appears on the user's dev site as a **Gradier** pill in the bottom-right corner.

## Opening it

- **Alt+G** (or click the pill): open or close the editor for mesh gradients.
- **Alt+P** (or the crosshair button in the panel): pick any CSS gradient on the page, then click it. **Esc** cancels.

## CSS gradients

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

## Mesh gradients

### The page

Each `<gradier-gradient>` gets a label; click it to edit that gradient (a yellow `name · click to create` label creates a missing one). The selected gradient shows its colour points as handles.

- **Click a node** to select it. **Click empty space** or press **Esc** to deselect.
- **Drag a node** to move it (**Shift** snaps to a grid).
- A selected plain node shows a **dashed circle** (its area) with a **curved grip**: drag the grip to grow or shrink how far the colour reaches. It also shows **four arms**: drag any arm to stretch the colour that way.
- **Delete** removes the selected node.

### The toolbar (bottom of the screen)

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

### The panel

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

Sections collapse with their chevron. The panel floats at the top right: drag it by its header to move it (double-click the header to snap it back); the header has undo and redo, the CSS-gradient picker, expand, a button to snap the panel to a side, and close.

**Colours:** each colour field is a swatch, its hex, and its opacity. Click the swatch for the picker (a saturation/brightness square, a hue bar, and the value as HEX, RGB or HSL); type a hex directly; set opacity by typing, with the arrow keys, or by dragging the ◐ icon. A mesh point below 100% lets the page show through.

### Saving

Edits are saved to the gradients file (default `src/gradients.json`) automatically, half a second after you stop changing things. **⌘/Ctrl+S** saves right away. **⌘/Ctrl+Z** / **⌘/Ctrl+Shift+Z** undo and redo.

### Saved gradients and the expanded view

**Saved** (between Gradient and Points, always visible) is your own library: **+ Save** keeps the current gradient; select any gradient and click a swatch to apply it; hover a swatch to remove it. The library is stored in `~/.gradier/library.json`, so it follows you across projects.

**F** or the expand button in the header shows the gradient large in the middle of the screen, at the element's aspect ratio, with all the handles and tools. **F**, **Esc** or a click outside returns to the page.
