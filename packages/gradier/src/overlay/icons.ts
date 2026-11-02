// Icons from Phosphor (https://phosphoricons.com, MIT), regular weight, inlined at build time.
import arrowsOut from '@phosphor-icons/core/regular/arrows-out.svg';
import bookmark from '@phosphor-icons/core/regular/bookmark-simple.svg';
import caretDown from '@phosphor-icons/core/regular/caret-down.svg';
import caretLeft from '@phosphor-icons/core/regular/caret-left.svg';
import cornersIn from '@phosphor-icons/core/regular/corners-in.svg';
import cornersOut from '@phosphor-icons/core/regular/corners-out.svg';
import crosshair from '@phosphor-icons/core/regular/crosshair-simple.svg';
import eye from '@phosphor-icons/core/regular/eye.svg';
import eyeSlash from '@phosphor-icons/core/regular/eye-slash.svg';
import lineSegment from '@phosphor-icons/core/regular/line-segment.svg';
import navigationArrow from '@phosphor-icons/core/regular/navigation-arrow.svg';
import pencil from '@phosphor-icons/core/regular/pencil-simple.svg';
import plus from '@phosphor-icons/core/regular/plus.svg';
import reset from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg';
import shuffle from '@phosphor-icons/core/regular/shuffle.svg';
import sidebar from '@phosphor-icons/core/regular/sidebar-simple.svg';
import trash from '@phosphor-icons/core/regular/trash.svg';
import undo from '@phosphor-icons/core/regular/arrow-u-up-left.svg';
import redo from '@phosphor-icons/core/regular/arrow-u-up-right.svg';
import x from '@phosphor-icons/core/regular/x.svg';

/** Phosphor has no plain arc or "ring with a centre dot", so these two are drawn on the same 256 grid and stroke weight. */
const custom = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const arc = custom('<path d="M56 164a72 72 0 0 1 144 0"/><circle cx="56" cy="188" r="20"/><circle cx="200" cy="188" r="20"/>');
const node = custom('<circle cx="128" cy="128" r="88"/><circle cx="128" cy="128" r="14" fill="currentColor" stroke="none"/>');

export const ICONS = {
  plus,
  close: x,
  trash,
  edit: pencil,
  undo,
  redo,
  dock: sidebar,
  pick: crosshair,
  back: caretLeft,
  chevron: caretDown,
  reset,
  expand: cornersOut,
  collapse: cornersIn,
  bookmark,
};

export const TOOL_GLYPHS = {
  select: navigationArrow,
  line: lineSegment,
  arc,
  node,
  pencil,
  shuffle,
  scatter: arrowsOut,
  eye,
  eyeOff: eyeSlash,
};
