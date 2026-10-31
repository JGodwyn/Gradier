import { h } from './dom';

export type Tool = 'select' | 'line' | 'arc' | 'node' | 'pencil';

const svg = (body: string) =>
  `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const TOOL_ICONS: Record<Tool | 'shuffle' | 'scatter' | 'eye' | 'eyeOff', string> = {
  select: svg('<path d="M3.5 4.5l13 5.2-5.6 1.6-3.3 4.9z"/>'),
  line: svg('<path d="M4 15.5L16 6"/><circle cx="4" cy="15.5" r=".9" fill="currentColor"/><circle cx="16" cy="6" r=".9" fill="currentColor"/>'),
  arc: svg('<path d="M3.5 14a6.5 6.5 0 0113 0"/><circle cx="3.5" cy="14" r=".9" fill="currentColor"/><circle cx="16.5" cy="14" r=".9" fill="currentColor"/>'),
  node: svg('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r=".9" fill="currentColor"/>'),
  pencil: svg('<path d="M13.2 4.3l2.5 2.5-8.6 8.6-3.3.8.8-3.3z"/><path d="M11.6 5.9l2.5 2.5"/>'),
  shuffle: svg('<path d="M3 6.5h2.5c3.5 0 5.5 7 9 7H17"/><path d="M3 13.5h2.5c1.4 0 2.5-1.1 3.4-2.4M11.1 8.9c.9-1.3 2-2.4 3.4-2.4H17"/><path d="M15 4.5l2 2-2 2M15 11.5l2 2-2 2"/>'),
  scatter: svg('<circle cx="5" cy="15" r="2"/><circle cx="15.5" cy="4.5" r="2"/><path d="M6.6 13.4l6-6"/><path d="M9.6 7.4h3v3"/>'),
  eye: svg('<path d="M2.5 12.5C4.5 9 7 7.5 10 7.5s5.5 1.5 7.5 5"/><circle cx="10" cy="12" r="1.8"/>'),
  eyeOff: svg('<path d="M2.5 12.5C4.5 9 7 7.5 10 7.5s5.5 1.5 7.5 5"/><circle cx="10" cy="12" r="1.8"/><path d="M4 4l12 12"/>'),
};

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

  const patch = (s: ToolbarState) => {
    for (const [id, b] of toolButtons) b.classList.toggle('on', id === s.tool);
    eye.innerHTML = s.handlesHidden ? TOOL_ICONS.eyeOff : TOOL_ICONS.eye;
    eye.append(h('span', { className: 'tip' }, s.handlesHidden ? 'Show points' : 'Hide points', h('kbd', {}, ACTION_KEYS.eye)));
    eye.setAttribute('aria-label', `${s.handlesHidden ? 'Show' : 'Hide'} points (${ACTION_KEYS.eye})`);
    eye.classList.toggle('off', s.handlesHidden);
  };

  return { el, patch };
}
