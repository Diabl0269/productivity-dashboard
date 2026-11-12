// next-start-line.js — the Plan page's "Next start: <epic> at <time>" line (PRO75). Text only, plain words.
// The sentence comes from GET /api/next-start (shared/next-start.js decides; the dispatcher's own gates are mirrored there).

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A status paragraph that fills itself in; a failed or missing server leaves it empty (hidden). */
export function renderNextStartLine() {
  const p = el('p', 'rp-aq-next');
  p.setAttribute('role', 'status');
  fetch('/api/next-start', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(out => { if (out && out.line) p.textContent = out.line; })
    .catch(() => { /* no server behind the page (file:// or demo): no line */ });
  return p;
}
