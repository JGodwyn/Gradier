import { h } from './dom';
import { TOOL_GLYPHS } from './icons';

export type Tool = 'select' | 'line' | 'arc' | 'node' | 'pencil';

export const TOOL_ICONS: Record<Tool | 'shuffle' | 'scatter' | 'eye' | 'eyeOff', string> = TOOL_GLYPHS;

export const TOOLS: Array<{ id: Tool; label: string; key: string; color: string }> = [
  { id: 'select', label: 'Select', key: 'V', color: '#facc15' },
  { id: 'line', label: 'Line', key: 'L', color: '#38bdf8' },
  { id: 'arc', label: 'Arc', key: 'A', color: '#a3e635' },
  { id: 'node', label: 'Node', key: 'N', color: '#a78bfa' },
  { id: 'pencil', label: 'Pencil', key: 'P', color: '#fb923c' },
];

export const ACTION_KEYS = { shuffle: 'X', scatter: 'R', eye: 'H' } as const;

export type ToolbarState = { tool: Tool; handlesHidden: boolean };

export type ToolbarActions = {
  setTool: (tool: Tool) => void;
  shuffle: () => void;
  scatter: () => void;
  toggleHandles: () => void;
};

/** The floating control bar at the bottom of the viewport. */
export function createToolbar(actions: ToolbarActions) {
  const item = (icon: string, label: string, key: string, onclick: () => void, color?: string) => {
    const b = h('button', { className: 'tool', type: 'button', onclick, 'aria-label': `${label} (${key})` });
    if (color) b.style.setProperty('--tool-color', color);
    b.innerHTML = icon;
    b.append(h('span', { className: 'tip' }, label, h('kbd', {}, key)));
    return b;
  };
  const sep = () => h('span', { className: 'tool-sep' });

  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOLS) toolButtons.set(t.id, item(TOOL_ICONS[t.id], t.label, t.key, () => actions.setTool(t.id), t.color));
  const shuffle = item(TOOL_ICONS.shuffle, 'Shuffle colors', ACTION_KEYS.shuffle, actions.shuffle);
  const scatter = item(TOOL_ICONS.scatter, 'Scatter points', ACTION_KEYS.scatter, actions.scatter);
  const eye = item(TOOL_ICONS.eye, 'Hide points', ACTION_KEYS.eye, actions.toggleHandles);

  const [select, ...draw] = [...toolButtons.values()];
  const el = h('div', { className: 'toolbar', role: 'toolbar' }, select!, sep(), ...draw, sep(), shuffle, scatter, sep(), eye);
  el.style.pointerEvents = 'auto';
  // Once one tooltip has shown, the rest appear instantly while the pointer stays on the toolbar.
  let warmTimer = 0;
  el.addEventListener('pointerenter', () => {
    clearTimeout(warmTimer);
    warmTimer = window.setTimeout(() => el.classList.add('warm'), 400);
  });
  el.addEventListener('pointerleave', () => {
    clearTimeout(warmTimer);
    warmTimer = window.setTimeout(() => el.classList.remove('warm'), 250);
  });

  const patch = (s: ToolbarState) => {
    for (const [id, b] of toolButtons) b.classList.toggle('on', id === s.tool);
    eye.innerHTML = s.handlesHidden ? TOOL_ICONS.eyeOff : TOOL_ICONS.eye;
    eye.append(h('span', { className: 'tip' }, s.handlesHidden ? 'Show points' : 'Hide points', h('kbd', {}, ACTION_KEYS.eye)));
    eye.setAttribute('aria-label', `${s.handlesHidden ? 'Show' : 'Hide'} points (${ACTION_KEYS.eye})`);
    eye.classList.toggle('off', s.handlesHidden);
  };

  return { el, patch };
}
