// run-plan-reason-text.js: a reason sentence with its ticket ids as buttons (PRO85). No imports, so tests can run it on a fake DOM.

/** `text` with each id in `ids` swapped for a button made by `idButton` (so a ticket named in a reason opens in one click). */
export function textWithIdButtons(text, ids, idButton, className = '') {
  const node = makeSpan(className);
  const uniq = [...new Set(ids)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!uniq.length) { node.textContent = text; return node; }
  const rx = new RegExp(`(${uniq.map(i => i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);
  text.split(rx).forEach(part => {
    node.appendChild(uniq.includes(part) ? idButton(part) : document.createTextNode(part));
  });
  return node;
}

function makeSpan(className) {
  const node = document.createElement('span');
  if (className) node.className = className;
  return node;
}
