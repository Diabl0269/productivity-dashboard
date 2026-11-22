// home-pages-overlay.js — the centred reading overlay ("Open wide") and the large diagram view.
// Both are native modal <dialog>s: the browser traps focus and gives it back, and Esc (animated
// here) closes only the topmost one. Opening grows from the thing that was clicked; closing shrinks
// back to it.

const MOTION_MS = 180;

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A modal shell: scrim + card with a title bar and a body.
 * @returns {{ dialog, body, close() }}
 */
export function shell({ title, className, trigger, wide }) {
  const dialog = el('dialog', `hp-dialog ${className}`);
  dialog.setAttribute('aria-label', title);
  const scrim = el('div', 'hp-scrim');
  const card = el('div', `hp-card${wide ? ' hp-card-wide' : ''}`);
  const head = el('div', 'hp-dlg-head');
  const h = el('h2', 'hp-dlg-title', title);
  const x = el('button', 'hp-dlg-btn hp-dlg-close', 'Close');
  x.type = 'button';
  x.title = 'Close (Esc)';
  const tools = el('div', 'hp-dlg-tools');
  head.append(h, tools, x);
  const body = el('div', 'hp-dlg-body');
  body.tabIndex = 0;
  card.append(head, body);
  dialog.append(scrim, card);

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    dialog.classList.remove('hp-in');
    const done = () => {
      dialog.close();
      dialog.remove();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
    if (reducedMotion()) done(); else setTimeout(done, MOTION_MS + 20);
  };
  x.addEventListener('click', close);
  scrim.addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
  document.body.appendChild(dialog);
  dialog.showModal();
  const from = trigger?.getBoundingClientRect?.();
  if (from && from.width) { // grow from (and shrink back to) the thing that was clicked
    const at = card.getBoundingClientRect();
    card.style.transformOrigin = `${from.left + from.width / 2 - at.left}px ${from.top + from.height / 2 - at.top}px`;
  }
  void dialog.offsetWidth;
  dialog.classList.add('hp-in');
  body.focus({ preventScroll: true });
  return { dialog, body, tools, close };
}

/** A modal form dialog on the same shell. `build(body, close)` fills it; `onClose()` runs once it is gone. */
export function openDialog({ title, trigger, className = 'hp-form', build, onClose }) {
  const s = shell({ title, className, trigger, wide: false });
  if (onClose) s.dialog.addEventListener('close', onClose, { once: true });
  build(s.body, s.close);
  return s;
}

/** Show a page in the centred reading overlay. `build(root, close)` fills it with the rendered page. */
export function openReader({ title, trigger, build }) {
  const s = shell({ title, className: 'hp-reader', trigger, wide: true });
  s.body.classList.add('hp-doc');
  build(s.body, s.close);
  return s;
}

/** Show one diagram large, with zoom to fit, 100% and steps; + - 0 keys. */
export function openDiagram({ src, alt, trigger }) {
  const s = shell({ title: alt || 'Diagram', className: 'hp-diagram', trigger, wide: true });
  s.body.classList.add('hp-zoom');
  s.body.setAttribute('aria-label', 'Diagram, scrollable when zoomed');
  const img = el('img', 'hp-zoom-img');
  img.alt = alt || '';
  img.draggable = false;
  const frame = el('div', 'hp-frame hp-zoom-frame');
  frame.appendChild(img);
  s.body.appendChild(frame);

  let scale = 'fit';
  const natural = () => ({ w: img.naturalWidth || 960, h: img.naturalHeight || 540 });
  const fitScale = () => {
    const n = natural();
    const pad = 32;
    return Math.max(0.1, Math.min((s.body.clientWidth - pad) / n.w, (s.body.clientHeight - pad) / n.h));
  };
  const apply = () => {
    const n = natural();
    const k = scale === 'fit' ? fitScale() : scale;
    img.style.width = `${Math.round(n.w * k)}px`;
    img.style.height = `${Math.round(n.h * k)}px`;
    label.textContent = scale === 'fit' ? 'Fit' : `${Math.round(k * 100)}%`;
    for (const [b, on] of [[fitBtn, scale === 'fit'], [oneBtn, scale === 1]]) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  const step = (dir) => {
    const cur = scale === 'fit' ? fitScale() : scale;
    scale = Math.min(4, Math.max(0.25, +(cur * (dir > 0 ? 1.25 : 0.8)).toFixed(3)));
    apply();
  };
  const btn = (text, title, fn) => {
    const b = el('button', 'hp-dlg-btn', text);
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', fn);
    s.tools.appendChild(b);
    return b;
  };
  btn('−', 'Zoom out (-)', () => step(-1)).setAttribute('aria-label', 'Zoom out');
  const label = el('span', 'hp-zoom-label', 'Fit');
  label.setAttribute('aria-live', 'polite');
  s.tools.appendChild(label);
  btn('+', 'Zoom in (+)', () => step(1)).setAttribute('aria-label', 'Zoom in');
  const fitBtn = btn('Fit', 'Zoom to fit (0)', () => { scale = 'fit'; apply(); });
  const oneBtn = btn('100%', 'Actual size (1)', () => { scale = 1; apply(); });

  s.dialog.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); step(1); }
    else if (e.key === '-') { e.preventDefault(); step(-1); }
    else if (e.key === '0') { e.preventDefault(); scale = 'fit'; apply(); }
    else if (e.key === '1') { e.preventDefault(); scale = 1; apply(); }
  });
  const onResize = () => { if (scale === 'fit') apply(); };
  window.addEventListener('resize', onResize);
  s.dialog.addEventListener('close', () => window.removeEventListener('resize', onResize));
  img.addEventListener('load', apply);
  img.src = src;
  apply();
  return s;
}
