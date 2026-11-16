// home-commands.js — the registry of Home commands (no DOM; re-exported by home-state.js).
//
//   registerHomeCommand({ id, title, hint?, keys?, group, run(ctx), when?(ctx), keywords? })
//
// A command shows in the palette (group "Commands" unless `group` says otherwise), is listed on the
// `?` sheet when it has `keys` ("n", "g x", "Mod+J"), and runs on that key while the Home tab shows.
// `when(ctx)` hides it while it does not apply. Registering an id twice keeps the first; a key that
// another key of the page already uses is refused (the command stays, without its key).

import { keyTable, findKeyClashes } from '../../shared/home-keymap.js';

const commands = new Map();
let ctxRef = null;

export function registerHomeCommand(def) {
  if (!def || typeof def.id !== 'string' || !def.id) throw new Error('registerHomeCommand: "id" is required');
  if (typeof def.title !== 'string' || !def.title) throw new Error(`registerHomeCommand "${def.id}": "title" is required`);
  if (typeof def.run !== 'function') throw new Error(`registerHomeCommand "${def.id}": "run(ctx)" is required`);
  if (typeof def.group !== 'string' || !def.group) throw new Error(`registerHomeCommand "${def.id}": "group" is required`);
  if (commands.has(def.id)) {
    console.warn(`Home command "${def.id}" is registered twice; the first one is kept.`);
    return;
  }
  const keys = [].concat(def.keys || []).filter(k => typeof k === 'string' && k);
  const entry = { ...def, keys };
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(key => ({ id: `key${key}`, key, label: '' })); // number keys belong to views
  const clash = findKeyClashes(keyTable({ views: digits, commands: [...commands.values(), entry] }));
  const bad = new Set(clash.flatMap(c => (c.ids.includes(`cmd-${def.id}`) ? [c.chord] : [])));
  if (bad.size) {
    console.warn(`Home command "${def.id}": key ${[...bad].join(', ')} is already used; the command stays without it.`);
    entry.keys = keys.filter(k => !bad.has(k));
  }
  commands.set(def.id, Object.freeze(entry));
}

/** Registered commands in registration order. */
export function homeCommands() { return [...commands.values()]; }

/** The ctx commands run with: the palette's top bar item sets it when it mounts. */
export function setCommandCtx(ctx) { ctxRef = ctx; }
export function getCommandCtx() { return ctxRef; }
