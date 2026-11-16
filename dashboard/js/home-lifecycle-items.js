// home-lifecycle-items.js (PRO122) — the rows under an open stage of the How it runs flow: tickets with the
// Plan page's id button and chips, notes with their ticket and kind. Shared look: rp-link id buttons, rp-chip.

const SECTION_LABELS = {
  inbox: 'Inbox', backlog: 'Backlog', todo: 'To do', 'in-progress': 'In progress', review: 'Ready for review', done: 'Done', archive: 'Archive',
};
const MAX_ROWS = 60;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function chip(text, cls = '') {
  return el('span', `rp-chip hr-item-chip ${cls}`.trim(), text);
}

function ticketRow(item, ctx) {
  const li = el('li', 'hr-item');
  li.dataset.key = `${item.kind}:${item.handle || item.id}`;
  li.appendChild(ctx.idButton(item.id));
  const body = el('div', 'hr-item-body');
  body.appendChild(el('span', 'hr-item-title', item.title || '(no title)'));
  if (item.question) body.appendChild(el('span', 'hr-item-text', item.question));
  if (item.from) body.appendChild(el('span', 'hr-item-text', `from note ${item.from}`));
  if (item.also?.length) body.appendChild(el('span', 'hr-item-text', `also on ${item.also.join(', ')}`));
  li.appendChild(body);
  const chips = el('div', 'hr-item-chips');
  if (item.type === 'epic') chips.appendChild(chip('epic', 'rp-chip-model'));
  if (item.state) chips.appendChild(chip(item.chip, `hr-run-${item.state}`));
  else if (item.chip) chips.appendChild(chip(item.chip, 'rp-chip-ready'));
  if (item.checks && Number.isFinite(item.checks.total) && item.checks.total) chips.appendChild(chip(`${item.checks.done || 0}/${item.checks.total} checks`, 'rp-chip-review'));
  if (item.notes) chips.appendChild(chip(`${item.notes} note${item.notes === 1 ? '' : 's'}`, 'rp-chip-notes'));
  if (!item.state && item.section && !['review', 'done'].includes(item.section) && !item.chip) chips.appendChild(chip(SECTION_LABELS[item.section] || item.section, 'rp-chip-model'));
  if (chips.children.length) li.appendChild(chips);
  return li;
}

function noteRow(item, ctx) {
  const li = el('li', 'hr-item hr-item-note');
  li.dataset.key = `note:${item.handle}`;
  li.appendChild(ctx.idButton(item.id));
  const body = el('div', 'hr-item-body');
  body.appendChild(el('span', 'hr-item-title', item.text || '(a picture only)'));
  body.appendChild(el('span', 'hr-item-text', `${item.handle} on ${item.ticketTitle || item.id}`));
  li.appendChild(body);
  const chips = el('div', 'hr-item-chips');
  chips.appendChild(chip(item.noteKind, item.noteKind === 'fix' ? 'rp-chip-notes' : 'rp-chip-model'));
  li.appendChild(chips);
  return li;
}

/** A stable signature, so a refresh with the same rows leaves the list alone (no flicker, no scroll jump). */
export function itemsSignature(items) {
  return items.map(i => `${i.kind}:${i.handle || i.id}:${i.state || ''}:${i.chip || ''}:${i.title || i.text || ''}:${i.notes || 0}:${i.checks?.done ?? ''}`).join('|');
}

/**
 * Fill `list` with the rows of a stage.
 * @param {HTMLElement} list ul
 * @param {object[]} items rows from shared/lifecycle.js
 * @param {object} ctx Home ctx (idButton)
 * @param {string} emptyText what the empty list says
 */
export function paintItems(list, items, ctx, emptyText) {
  list.textContent = '';
  if (!items.length) {
    list.appendChild(el('li', 'hr-item hr-item-empty', emptyText));
    return;
  }
  for (const item of items.slice(0, MAX_ROWS)) list.appendChild(item.kind === 'note' ? noteRow(item, ctx) : ticketRow(item, ctx));
  if (items.length > MAX_ROWS) list.appendChild(el('li', 'hr-item hr-item-empty', `and ${items.length - MAX_ROWS} more`));
}
