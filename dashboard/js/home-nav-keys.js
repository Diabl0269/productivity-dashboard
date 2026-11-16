// home-nav-keys.js — Home's key engine for the keys that are not 1-9 or Esc (those stay in home-keys.js):
//   /   open the palette (unless the view's root has data-hm-claims-slash: it keeps `/` for its own search)
//   ?   the key sheet            g then o/m/l/t/r   jump to a view
//   [ ] the previous / next place on the same level   u   one level up
// plus the `keys` of registered commands (single keys, "g x" sequences, "Mod+J" chords).
// Nothing fires while typing (input, textarea, select, contenteditable), while a modal is open, while the
// palette or the sheet is open, or off the Home tab. The key list shown on `?` is shared/home-keymap.js.

import {
  GO_KEYS, chordFromEvent,
} from '../../shared/home-keymap.js';
import {
  setView, homeCommands, getHomeConfig, selectedBoxId, setSelection, clearSelection,
} from './home-state.js';
import { getCommandCtx } from './home-commands.js';
import { boxPath, childBoxes } from '../../shared/home-areas.js';
import { isTypingTarget, somethingOnTop } from './home-keys.js';
import { isHelpOpen } from './home-help.js';

const SEQUENCE_MS = 1500;

/** Step the selection among the boxes on its level (wrapping); with nothing selected, start at the first or last group. */
export function stepPlace(dir) {
  const config = getHomeConfig();
  if (!config) return;
  const id = selectedBoxId();
  const path = id ? boxPath(config, id) : [];
  const parent = path.length > 1 ? path[path.length - 2].id : null;
  const siblings = childBoxes(config, parent);
  if (!siblings.length) return;
  const at = siblings.findIndex(b => b.id === id);
  const next = at < 0 ? (dir > 0 ? 0 : siblings.length - 1) : (at + dir + siblings.length) % siblings.length;
  setSelection(siblings[next].id);
}

/** One level up; from a group, back to "no place". */
export function upPlace() {
  const config = getHomeConfig();
  const id = selectedBoxId();
  if (!config || !id) return;
  const path = boxPath(config, id);
  if (path.length > 1) setSelection(path[path.length - 2].id);
  else clearSelection();
}

export function installNavKeys({ openPalette, openHelp, isPaletteOpen, signal, isShowing }) {
  let pending = null;
  let timer = 0;
  const reset = () => { pending = null; clearTimeout(timer); };

  const runCommand = (chord) => {
    const ctx = getCommandCtx();
    const cmd = homeCommands().find(c => c.keys.includes(chord));
    if (!cmd || !ctx) return false;
    try { if (cmd.when && cmd.when(ctx) === false) return false; } catch { return false; }
    try { cmd.run(ctx); } catch (err) { console.error(`Home command "${cmd.id}" failed`, err); ctx.toast?.(`That did not work: ${err.message}`); }
    return true;
  };
  const isPrefix = (chord) => chord === 'g' || homeCommands().some(c => c.keys.some(k => k.startsWith(`${chord} `)));

  document.addEventListener('keydown', (e) => {
    if (!isShowing() || e.defaultPrevented) return;
    if (isPaletteOpen() || isHelpOpen() || isTypingTarget(e.target) || somethingOnTop()) { reset(); return; }
    if (e.altKey) return;
    const chord = chordFromEvent(e);
    if (!chord) return;
    const mod = chord.startsWith('Mod+');
    if (mod && chord === 'Mod+K') return; // the palette's own listener
    if (pending) {
      const seq = `${pending} ${chord}`;
      const first = pending;
      reset();
      const go = first === 'g' && GO_KEYS.find(g => g.letter === chord);
      if (go) { e.preventDefault(); setView(go.view); return; }
      if (runCommand(seq)) { e.preventDefault(); return; }
    }
    if (!mod && isPrefix(chord)) {
      e.preventDefault();
      pending = chord;
      timer = setTimeout(reset, SEQUENCE_MS);
      return;
    }
    if (!mod) {
      const done = () => { e.preventDefault(); };
      if (chord === '?') { done(); openHelp(); return; }
      if (chord === '/') {
        if (document.querySelector('.hm-view[data-hm-claims-slash]')) return;
        done(); openPalette(); return;
      }
      if (chord === '[') { done(); stepPlace(-1); return; }
      if (chord === ']') { done(); stepPlace(1); return; }
      if (chord === 'u') { done(); upPlace(); return; }
    }
    if (runCommand(chord)) e.preventDefault();
  }, { signal });
}
