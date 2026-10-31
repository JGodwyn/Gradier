export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --bg: rgba(20, 20, 24, 0.92);
  --fg: #f4f4f5;
  --muted: #a1a1aa;
  --line: rgba(255, 255, 255, 0.1);
  --field: rgba(255, 255, 255, 0.06);
  --accent: #8b5cf6;
  --accent-fg: #fff;
  --warn: #fbbf24;
  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }

.launcher {
  position: fixed; right: 16px; bottom: 16px; z-index: 2;
  display: flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 14px 0 10px; border-radius: 999px;
  background: var(--bg); border: 1px solid var(--line);
  box-shadow: 0 8px 30px rgba(0,0,0,.35); backdrop-filter: blur(12px);
  font-weight: 600; letter-spacing: .01em;
}
.launcher .logo { width: 18px; height: 18px; border-radius: 50%;
  background: conic-gradient(from 200deg, #f472b6, #8b5cf6, #22d3ee, #a3e635, #f472b6); }
.launcher .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warn); }

.panel {
  position: fixed; top: 16px; right: 16px; z-index: 2;
  width: 300px; max-height: calc(100vh - 32px);
  display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,.45); backdrop-filter: blur(16px);
  overflow: hidden;
}
.panel.left { right: auto; left: 16px; }
.head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; border-bottom: 1px solid var(--line); cursor: grab; user-select: none; }
.head .logo { width: 14px; height: 14px; border-radius: 50%;
  background: conic-gradient(from 200deg, #f472b6, #8b5cf6, #22d3ee, #a3e635, #f472b6); }
.head .title { font-weight: 650; flex: 1; }
.body { overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; }
.foot { border-top: 1px solid var(--line); padding: 10px 14px; display: flex; align-items: center; gap: 8px; }
.foot .status { flex: 1; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.foot .status.dirty { color: var(--warn); }

.section { display: flex; flex-direction: column; gap: 8px; }
.label { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
.row { display: flex; align-items: center; gap: 6px; }
.grow { flex: 1; min-width: 0; }

.btn { height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--field); display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
.btn:hover:not(:disabled) { background: rgba(255,255,255,.12); }
.btn:disabled { opacity: .4; cursor: default; }
.btn.primary { background: var(--accent); border-color: transparent; color: var(--accent-fg); font-weight: 600; }
.btn.primary:hover:not(:disabled) { filter: brightness(1.1); background: var(--accent); }
.btn.icon { width: 28px; padding: 0; }
.btn.ghost { background: transparent; border-color: transparent; }
.btn.ghost:hover:not(:disabled) { background: var(--field); }
.btn.small { height: 22px; padding: 0 8px; font-size: 11px; border-radius: 6px; }

select, .text { height: 28px; border-radius: 8px; border: 1px solid var(--line); background: var(--field); padding: 0 8px; outline: none; width: 100%; }
select option { background: #18181b; }
select:focus, .text:focus { border-color: var(--accent); }

.points { display: flex; flex-direction: column; gap: 4px; }
.point { display: flex; align-items: center; gap: 6px; padding: 3px; border-radius: 8px; border: 1px solid transparent; }
.point.active { border-color: var(--accent); background: rgba(139, 92, 246, .12); }
.swatch { position: relative; width: 24px; height: 24px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line); flex: none; }
.swatch input { position: absolute; inset: -6px; width: 40px; height: 40px; border: 0; padding: 0; cursor: pointer; background: none; }
.point .text { height: 24px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.point .coords { color: var(--muted); font-size: 10px; width: 54px; text-align: right; font-variant-numeric: tabular-nums; }

.slider { display: grid; grid-template-columns: 70px 1fr 34px; align-items: center; gap: 8px; }
.slider span:first-child { color: var(--muted); }
.slider output { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); font-size: 11px; }
input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 4px; background: rgba(255,255,255,.15); outline: none; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 0; box-shadow: 0 1px 4px rgba(0,0,0,.4); cursor: pointer; }
input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 0; cursor: pointer; }

.presets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.preset { height: 30px; border-radius: 8px; border: 1px solid var(--line); cursor: pointer; padding: 0; }
.preset:hover { outline: 2px solid var(--accent); outline-offset: 1px; }

.hint { color: var(--muted); font-size: 11px; }
.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: rgba(0,0,0,.35); border: 1px solid var(--line); border-radius: 8px; padding: 8px; white-space: pre-wrap; word-break: break-all; user-select: all; }
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
.handle:hover { transform: scale(1.15); }
.handle.active { box-shadow: 0 0 0 2px var(--accent), 0 0 0 4px #fff, 0 6px 16px rgba(0,0,0,.4); }
.handle.dragging { cursor: grabbing; transform: scale(1.2); }

.toast { position: fixed; top: 16px; left: 50%; z-index: 3; background: #fafafa; color: #18181b; padding: 8px 12px; border-radius: 8px; font-weight: 600;
  box-shadow: 0 8px 24px rgba(0,0,0,.3); opacity: 0; transform: translate(-50%, -6px); transition: opacity .15s, transform .15s; pointer-events: none; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast.error { background: #ef4444; color: #fff; }
`;
