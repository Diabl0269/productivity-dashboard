// home-keep.js — redraw part of Home without a jump: keep the focused control and the scroll offsets.
// The 5 s task poll re-renders Home zones; a zone's content is rebuilt, then the same control (by
// data-hm-key, id, data-ticket, or position) gets focus back and every scrolled box its offset.

function keyOf(el) {
  if (el.dataset?.hmKey) return `[data-hm-key="${CSS.escape(el.dataset.hmKey)}"]`;
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset?.ticket) return `[data-ticket="${CSS.escape(el.dataset.ticket)}"]`;
  return null;
}

/** Child-index path from root to el (fallback when el has no stable key). */
function pathOf(root, el) {
  const path = [];
  for (let n = el; n && n !== root; n = n.parentElement) {
    const parent = n.parentElement;
    if (!parent) return null;
    path.unshift([...parent.children].indexOf(n));
  }
  return path;
}

function byPath(root, path) {
  let n = root;
  for (const i of path) {
    n = n?.children?.[i];
    if (!n) return null;
  }
  return n;
}

function scrolled(root) {
  const out = [];
  const walk = (el) => {
    if (el.scrollTop || el.scrollLeft) out.push({ path: pathOf(root, el), top: el.scrollTop, left: el.scrollLeft });
    for (const c of el.children) walk(c);
  };
  walk(root);
  return out;
}

/**
 * Run `rebuild()` (which replaces root's content) and put focus and scroll back where they were.
 * @param {HTMLElement} root the zone being redrawn
 * @param {() => void} rebuild
 */
export function keepFocusAndScroll(root, rebuild) {
  const active = document.activeElement;
  const inside = active && active !== root && root.contains(active);
  const key = inside ? keyOf(active) : null;
  const path = inside && !key ? pathOf(root, active) : null;
  const selStart = inside && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const offsets = scrolled(root);
  const own = { top: root.scrollTop, left: root.scrollLeft };

  rebuild();

  for (const s of offsets) {
    const el = s.path ? byPath(root, s.path) : null;
    if (el) { el.scrollTop = s.top; el.scrollLeft = s.left; }
  }
  root.scrollTop = own.top;
  root.scrollLeft = own.left;
  if (!inside) return;
  const target = key ? root.querySelector(key) : path ? byPath(root, path) : null;
  if (target && typeof target.focus === 'function') {
    target.focus({ preventScroll: true });
    if (selStart !== null && typeof target.setSelectionRange === 'function') {
      try { target.setSelectionRange(selStart, selStart); } catch { /* not a text input */ }
    }
  }
}
