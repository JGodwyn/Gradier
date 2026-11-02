export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --bg: #232323;
  --fg: #ececec;
  --muted: #8f8f8f;
  --line: rgba(255, 255, 255, 0.08);
  --line-strong: rgba(255, 255, 255, 0.14);
  --field: #2b2b2b;
  --field-hover: #303030;
  --fill: #3a3a3a;
  --accent: #8b5cf6;
  --accent-fg: #fff;
  --action: #2f45b0;
  --action-line: #5068d8;
  --warn: #fbbf24;
  /* Motion tokens (curves from Emil Kowalski's animation guidelines). */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }

.launcher {
  position: fixed; right: 16px; bottom: 16px; z-index: 2;
  display: flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 14px 0 10px; border-radius: 999px;
  background: var(--bg); border: 1px solid var(--line-strong);
  box-shadow: 0 8px 30px rgba(0,0,0,.35);
  font-weight: 600; letter-spacing: .01em;
}
.launcher .logo, .head .logo { width: 18px; height: 18px; border-radius: 50%; flex: none;
  background: conic-gradient(from 200deg, #f472b6, #8b5cf6, #22d3ee, #a3e635, #f472b6); }
.launcher .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warn); }

/* A floating window at the top right (or left), as tall as its content up to the viewport. */
.panel {
  position: fixed; top: 12px; right: 12px; z-index: 2;
  width: min(312px, calc(100vw - 24px)); max-height: calc(100vh - 24px);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); border: 1px solid var(--line-strong); border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.25);
}
/* The panel grows out of the launcher pill and shrinks back into it (Web Animations, see morph() in index.ts). */
.launcher { transform-origin: 100% 100%; transition: transform 200ms var(--ease-out), opacity 200ms var(--ease-out), background-color 150ms ease; }
.launcher.from { opacity: 0; transform: scale(0.95); }
.launcher:active { transform: scale(0.97); }
.toolbar.from { opacity: 0; transform: translate(-50%, 12px) scale(0.97); }
.panel.left { right: auto; left: 12px; }
.head { display: flex; align-items: center; gap: 4px; height: 52px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--line); user-select: none; flex: none; }
.head { cursor: grab; }
.head .btn { cursor: pointer; }
.panel.moving, .panel.moving .head { cursor: grabbing; user-select: none; }
.head .logo { width: 16px; height: 16px; margin-right: 4px; }
.head .title { font-weight: 650; flex: 1; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--line-strong); }
.body { overflow-y: auto; padding: 4px 16px 20px; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; scrollbar-width: thin; scrollbar-color: #444 transparent; }
.foot { border-top: 1px solid var(--line); padding: 10px 16px; display: flex; align-items: center; gap: 8px; flex: none; }
.foot .status { flex: 1; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.foot .status.dirty { color: var(--warn); }

.section { display: flex; flex-direction: column; padding: 18px 0 6px; }
.section.closed:not(.compact) { padding-bottom: 0; }
/* Collapsible blocks: height/opacity are animated from JS (measured), the end state lives here. */
.sbody, .pwrap { overflow: hidden; }
.sbody.shut, .pwrap.shut { height: 0; opacity: 0; }
.sbody { margin: 0 -6px; }
.sinner { display: flex; flex-direction: column; gap: 10px; padding: 10px 6px 6px; }
.label .act { display: flex; transition: opacity 150ms ease; }
.section.closed:not(.compact) .label .act:not(.keep) { opacity: 0; pointer-events: none; }
.label { display: flex; align-items: center; gap: 6px; min-height: 24px; color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .09em; font-weight: 600; }
.label.toggle { cursor: pointer; }
.label.toggle:hover { color: var(--fg); }
.label .chev { display: grid; place-items: center; width: 18px; height: 18px; transition: transform 200ms var(--ease-out); }
.label .chev svg { width: 14px; height: 14px; }
.section.closed .label .chev { transform: rotate(-90deg); }
.label .btn { text-transform: none; letter-spacing: 0; font-weight: 500; }
.scope { text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,.06); color: var(--muted); }
.scope.node { background: rgba(80,104,216,.22); color: #c7d0ff; }
.row { display: flex; align-items: center; gap: 8px; }
.grow { flex: 1; min-width: 0; }

.btn { height: 38px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--field); display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; transition: background-color 150ms ease, transform 160ms var(--ease-out); }
.btn:active:not(:disabled), .seg button:active, .preset:active, .tool:active { transform: scale(0.97); }
.btn svg { width: 18px; height: 18px; flex: none; }
.head .btn.icon svg { width: 20px; height: 20px; }
.btn.small svg { width: 15px; height: 15px; }
.btn:hover:not(:disabled) { background: var(--field-hover); }
.btn:disabled { opacity: .4; cursor: default; }
.btn.primary, .btn.action { background: var(--action); border-color: var(--action-line); color: #fff; font-weight: 600; }
.btn.primary:hover:not(:disabled), .btn.action:hover:not(:disabled) { background: #3a52c4; }
.btn.icon { width: 38px; padding: 0; }
.btn.ghost { background: transparent; border-color: transparent; color: #d4d4d4; }
.btn.ghost:hover:not(:disabled) { background: rgba(255,255,255,.07); }
.btn.small { height: 26px; padding: 0 10px; font-size: 12px; border-radius: 7px; }
.btn.icon.small { width: 26px; padding: 0; }

select, .text { height: 38px; border-radius: 8px; border: 1px solid var(--line-strong); background-color: var(--field); padding: 0 12px; outline: none; width: 100%; }
/* Own chevron, inset from the edge (the native arrow sits too close to it). */
select { -webkit-appearance: none; appearance: none; padding-right: 40px; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='%23bdbdbd'%3E%3Cpath d='M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 14px center; background-size: 14px; }
select option { background: #232323; }
select:focus, .text:focus { border-color: var(--action-line); }
.field { height: 38px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--field); padding: 0 12px; display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
.field span { font-family: ui-sans-serif, system-ui, sans-serif; color: var(--muted); }
.field.readonly { color: #a3a3a3; background: transparent; }

.points { display: flex; flex-direction: column; }
/* Compact points list: rows other than the selected one fold away. */
.pwrap > .clip { display: flow-root; }
.pwrap > .clip > * { margin: 2px 0; }
.point { display: flex; align-items: center; gap: 6px; padding: 3px; border-radius: 9px; border: 1px solid transparent; }
.point.active { border-color: var(--line-strong); background: rgba(255,255,255,.05); }
.swatch { position: relative; width: 30px; height: 30px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line-strong); flex: none; }
.swatch input { position: absolute; inset: -6px; width: 40px; height: 40px; border: 0; padding: 0; cursor: pointer; background: none; }
.point .text { height: 32px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.point .coords { color: var(--muted); font-size: 10px; width: 50px; text-align: right; font-variant-numeric: tabular-nums; }

/* Field slider: the whole field is the control; the darker part fills up to the value. */
.slider { position: relative; display: block; height: 38px; border-radius: 8px; background: var(--field); border: 1px solid var(--line); overflow: hidden; cursor: ew-resize; }
.slider:hover { border-color: var(--line-strong); }
.slider span, .slider output { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; pointer-events: none; z-index: 1; }
.slider span { left: 14px; color: #e4e4e4; }
.slider output { right: 14px; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; color: #e4e4e4; }
.slider input[type=range] { -webkit-appearance: none; appearance: none; position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0;
  background: transparent; outline: none; overflow: hidden; cursor: ew-resize; border-radius: 0; }
.slider input[type=range]::-webkit-slider-runnable-track { height: 100%; background: transparent; }
.slider input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 1px; height: 38px; border: 0; border-radius: 0; background: rgba(255,255,255,.22);
  box-shadow: -4000px 0 0 4000px var(--fill); cursor: ew-resize; }
.slider input[type=range]::-moz-range-track { height: 100%; background: transparent; }
.slider input[type=range]::-moz-range-progress { height: 100%; background: var(--fill); }
.slider input[type=range]::-moz-range-thumb { width: 1px; height: 38px; border: 0; border-radius: 0; background: rgba(255,255,255,.22); }
.slider input[type=range]:focus-visible { box-shadow: inset 0 0 0 1px var(--action-line); }
input[type=range] { accent-color: #fff; }

.presets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.preset { height: 38px; border-radius: 8px; border: 1px solid var(--line-strong); cursor: pointer; padding: 0; }
.preset:hover { outline: 2px solid #fff; outline-offset: 1px; }
.preset:focus-visible { outline: 2px solid var(--action-line); outline-offset: 1px; }
/* Saved gradients: a swatch with a remove button that appears on hover. */
.saved { position: relative; display: grid; }
.saved .preset { width: 100%; }
.saved .remove { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; padding: 0; border-radius: 50%; border: 0;
  background: rgba(0,0,0,.6); color: #fff; opacity: 0; transition: opacity 150ms ease, transform 160ms var(--ease-out); }
.saved .remove svg { width: 10px; height: 10px; }
.saved:hover .remove, .saved .remove:focus-visible { opacity: 1; }
@media (hover: none) { .saved .remove { opacity: 1; } }

/* Expanded view: the gradient, large, in the free space beside the panel. Handles stay on the stage above it. */
.expand { position: fixed; inset: 0; z-index: 1; pointer-events: auto; }
.expand .backdrop { position: absolute; inset: 0; background: rgba(8, 8, 10, .78); transition: opacity 200ms var(--ease-out); }
.expand-box { position: fixed; display: block; border-radius: 12px; overflow: hidden;
  box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 30px 80px rgba(0,0,0,.55); }

.hint { color: var(--muted); font-size: 12px; }
.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: #1b1b1b; border: 1px solid var(--line); border-radius: 8px; padding: 8px; white-space: pre-wrap; word-break: break-all; user-select: all; }
/* CSS editor sections have no collapsible body, so they space their own rows. */
.section.flat { gap: 10px; }
.section.flat > .label > .btn { margin-left: auto; }
.section.flat .points { gap: 4px; }
.section.flat .bar { margin: 6px 0; }
/* Colour field: [swatch | HEX] [◐ 100 %]. */
.cf { display: flex; gap: 6px; flex: 1; min-width: 0; }
.cf-color, .cf-opacity { height: 34px; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--field); transition: border-color 150ms ease; }
.cf-color { display: flex; flex: 1; min-width: 0; overflow: hidden; }
.cf-color:focus-within, .cf-opacity:focus-within { border-color: var(--action-line); }
.cf-swatch { position: relative; width: 34px; flex: none; border: 0; padding: 0; cursor: pointer;
  background: repeating-conic-gradient(#555 0 25%, #333 0 50%) 0 0 / 8px 8px; }
.cf-chip { position: absolute; inset: 0; }
.cf-hex, .cf-alpha { border: 0; background: transparent; outline: none; min-width: 0; padding: 0; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
.cf-hex { flex: 1; padding: 0 10px; letter-spacing: .02em; }
.cf-opacity { display: flex; align-items: center; gap: 5px; width: 76px; flex: none; padding: 0 8px; cursor: text; }
.cf-icon { display: grid; place-items: center; flex: none; color: #d4d4d4; cursor: ew-resize; touch-action: none; }
.cf-icon svg { width: 15px; height: 15px; }
/* Always room for three digits ("100"), so the value is never clipped. */
.cf-alpha { flex: 1; width: 0; min-width: 3ch; }
.cf-unit { color: var(--muted); font-size: 12px; }
/* CSS stops also have a position box, so their colour fields are a little tighter. */
.section.flat .point { gap: 4px; }
.section.flat .point .text.pos { width: 46px; height: 34px; padding: 0 6px; }
.section.flat .cf { gap: 4px; }
.section.flat .cf-opacity { width: 72px; padding: 0 6px; gap: 4px; }
.section.flat .cf-swatch { width: 30px; }
.section.flat .cf-hex { padding: 0 8px; }

/* Colour picker popover. */
.cpick { position: fixed; z-index: 4; width: 264px; padding: 12px; display: flex; flex-direction: column; gap: 14px;
  border-radius: 16px; background: #262626; border: 1px solid var(--line-strong); box-shadow: 0 20px 50px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3); }
.cp-sv { position: relative; height: 176px; border-radius: 12px; cursor: crosshair; touch-action: none; }
.cp-sv-white, .cp-sv-black { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.cp-sv-white { background: linear-gradient(to right, #fff, rgba(255,255,255,0)); }
.cp-sv-black { background: linear-gradient(to top, #000, rgba(0,0,0,0)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
.cp-thumb { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 5px solid #fff; background: currentColor;
  box-shadow: 0 0 0 1px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.35); outline: none; }
.cp-thumb:focus-visible { box-shadow: 0 0 0 1px rgba(0,0,0,.18), 0 0 0 3px var(--action-line); }
.cp-hue { position: relative; height: 12px; margin: 0 2px; border-radius: 999px; cursor: pointer; touch-action: none;
  background: linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00); }
.cp-hue .cp-thumb { top: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px; }
.cp-row { display: flex; align-items: center; gap: 6px; height: 38px; padding: 0 8px 0 2px; border-radius: 10px; background: var(--field); }
select.cp-format { width: auto; height: 30px; border: 0; padding: 0 22px 0 8px; background-color: transparent; background-position: right 4px center; background-size: 11px;
  color: #bdbdbd; font-size: 12px; font-weight: 500; }
.cp-div { width: 1px; height: 18px; background: var(--line-strong); flex: none; }
.cp-value { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; padding: 0 4px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.cp-preview { width: 22px; height: 22px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1px rgba(255,255,255,.15); }

kbd { font: 10px ui-monospace, monospace; padding: 1px 4px; border-radius: 4px; border: 1px solid var(--line); color: var(--muted); }

.stage { position: fixed; inset: 0; pointer-events: none; z-index: 1; }
.frame { position: fixed; border: 1.5px solid var(--accent); border-radius: 2px; pointer-events: none; }
.frame.dim { border: 1px dashed rgba(255,255,255,.55); }
.chip { position: fixed; pointer-events: auto; transform: translateY(-100%); margin-top: -4px; height: 20px; padding: 0 7px; border-radius: 6px; border: 0;
  background: var(--accent); color: #fff; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.chip.dim { background: rgba(20,20,24,.85); color: #e4e4e7; }
.chip.missing { background: var(--warn); color: #1c1917; }
.handle { position: fixed; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; border: 2.5px solid #fff; pointer-events: auto; cursor: grab;
  box-shadow: 0 0 0 1px rgba(0,0,0,.25), 0 4px 12px rgba(0,0,0,.35); transition: transform .08s; touch-action: none; }
@media (hover: hover) and (pointer: fine) { .handle:hover { transform: scale(1.15); } .knob:hover { transform: scale(1.3); } }
.handle.active { box-shadow: 0 0 0 2px var(--accent), 0 0 0 4px #fff, 0 6px 16px rgba(0,0,0,.4); }
.handle.dragging { cursor: grabbing; transform: scale(1.2); }

.toast { position: fixed; top: 16px; left: 50%; z-index: 3; background: #fafafa; color: #18181b; padding: 8px 12px; border-radius: 8px; font-weight: 600;
  box-shadow: 0 8px 24px rgba(0,0,0,.3); opacity: 0; transform: translate(-50%, -6px); transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out); pointer-events: none; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast.error { background: #ef4444; color: #fff; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hint.warn { color: var(--warn); }
.btn.on { background: rgba(255,255,255,.12); color: #fff; }
.check { display: flex; align-items: center; gap: 6px; color: var(--muted); cursor: pointer; }
.check input { accent-color: var(--accent); margin: 0; }
.seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; }
.seg button { height: 38px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: #d4d4d4;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 160ms var(--ease-out); }
.seg button:hover { background: var(--field); }
.seg button.on { background: var(--fill); border-color: var(--line-strong); color: #fff; }
.point .text.pos { width: 64px; flex: none; }
.bar { position: relative; height: 26px; border-radius: 7px; border: 1px solid var(--line); cursor: copy; margin: 4px 0 6px; }
.marker { position: absolute; top: 50%; width: 14px; height: 30px; margin: -15px 0 0 -7px; border-radius: 5px; border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.4); cursor: ew-resize; touch-action: none; }
.marker.active { box-shadow: 0 0 0 2px var(--accent), 0 2px 8px rgba(0,0,0,.5); }

.shield { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; }
.pick-box { position: fixed; display: none; pointer-events: none; border: 2px solid var(--accent); background: rgba(139, 92, 246, .08); border-radius: 2px; }
.pick-label { position: fixed; display: none; pointer-events: none; height: 22px; line-height: 22px; padding: 0 8px; border-radius: 6px; background: var(--accent); color: #fff;
  font: 600 11px/22px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
.pick-tip { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); pointer-events: none; padding: 8px 14px; border-radius: 999px;
  background: var(--bg); border: 1px solid var(--line); color: var(--fg); font-weight: 600; box-shadow: 0 8px 30px rgba(0,0,0,.35); }
.chip.static { pointer-events: none; background: var(--accent); }
.rotor-line { position: fixed; height: 2px; margin-top: -1px; background: #fff; transform-origin: 0 50%; pointer-events: none; box-shadow: 0 0 0 1px rgba(0,0,0,.25); }
.rotor, .center-handle { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; pointer-events: auto; cursor: grab; touch-action: none;
  border: 2.5px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.3), 0 4px 12px rgba(0,0,0,.35); }
.rotor { background: var(--accent); }
.center-handle { background: #18181b; width: 22px; height: 22px; margin: -11px 0 0 -11px; }

.toolbar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 2;
  transition: transform 220ms var(--ease-out), opacity 220ms var(--ease-out);
  display: flex; align-items: center; gap: 2px; height: 44px; padding: 0 6px; border-radius: 12px;
  background: rgba(44, 44, 46, 0.94); border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 10px 30px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06); backdrop-filter: blur(16px); }
.tool { position: relative; width: 42px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 8px;
  background: transparent; color: #f4f4f5; padding: 0; transition: background .1s, color .1s; }
.tool:hover { background: rgba(255,255,255,.08); }

.tool.on { color: var(--tool-color, var(--accent)); }
.tool.off { color: var(--muted); }
.tool svg { display: block; width: 22px; height: 22px; pointer-events: none; }
.tool-sep { width: 1px; height: 18px; margin: 0 6px; background: rgba(255,255,255,.18); }
.tool .tip { position: absolute; left: 50%; bottom: calc(100% + 12px); transform: translate(-50%, 4px); pointer-events: none;
  display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 6px 0 12px; border-radius: 8px; white-space: nowrap;
  background: #1c1c1e; border: 1px solid rgba(255,255,255,.12); color: #e4e4e7; font-size: 12px; font-weight: 500; letter-spacing: .02em;
  box-shadow: 0 6px 18px rgba(0,0,0,.35); opacity: 0; transition: opacity .12s, transform .12s; }
.tool .tip kbd { min-width: 18px; height: 18px; display: grid; place-items: center; padding: 0 4px; border: 0; border-radius: 4px;
  background: rgba(255,255,255,.1); color: #d4d4d8; font-size: 10px; }
.tool:hover .tip { opacity: 1; transform: translate(-50%, 0); transition-delay: .3s; }
.toolbar.warm .tool:hover .tip { transition-delay: 0s; transition-duration: 0s; }
.canvas { position: fixed; pointer-events: auto; cursor: crosshair; touch-action: none; }

.guides { position: fixed; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.guides .curve { fill: none; stroke: #fff; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 1px rgba(0,0,0,.35)); }
.guides .curve.preview { stroke-opacity: .85; }
.guides .area { fill: none; stroke: rgba(255,255,255,.75); stroke-width: 1; stroke-dasharray: 2 3; }
.guides .arm { stroke: #fff; stroke-width: 1.5; stroke-linecap: round; filter: drop-shadow(0 0 1px rgba(0,0,0,.35)); }
.guides .grip { fill: none; stroke: #fff; stroke-width: 2.5; stroke-linecap: round; opacity: .9; filter: drop-shadow(0 0 1px rgba(0,0,0,.35)); }
.guides .grip.on { stroke-width: 3.5; opacity: 1; }
.guides .grip-hit { fill: none; stroke: transparent; stroke-width: 18; stroke-linecap: round; pointer-events: stroke; cursor: nwse-resize; touch-action: none; }
.knob { position: fixed; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: #fff; pointer-events: auto; cursor: grab; touch-action: none;
  box-shadow: 0 0 0 1px rgba(0,0,0,.25), 0 2px 6px rgba(0,0,0,.35); transition: transform .08s; }
.knob::before { content: ''; position: absolute; inset: -6px; border-radius: 50%; }
.knob.dragging { cursor: grabbing; transform: scale(1.4); }

/* Reduced motion: keep fades (they aid comprehension), drop movement. */
@media (prefers-reduced-motion: reduce) {
  .toolbar.from { transform: translateX(-50%); }
  .launcher.from, .launcher:active { transform: none; }
  .btn:active:not(:disabled), .seg button:active, .preset:active, .tool:active { transform: none; }
  .tool .tip, .toast { transform: translate(-50%, 0) !important; }
  .label .chev { transition-duration: 0ms; }
}
`;
