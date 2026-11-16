// home-map-zoom.js — the Home map's zoom (PRO39): one continuous camera move between two levels.
// Zooming in, the old level grows around the clicked box until that box fills the view while the new level
// (already laid out at full size, so its text is crisp when it lands) grows out of the same box. Zooming out is
// the same move backwards: the level shrinks back into its box. 180 ms, ease-out; reduced motion: a short fade.

export const ZOOM_MS = 180;
const EASE = 'cubic-bezier(0.22, 0.6, 0.36, 1)';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The transform that puts the whole W x H view into rect r (uniform scale, centred on r). */
function into(r, W, H) {
  const k = Math.max(0.01, Math.min(r.w / W, r.h / H));
  const tx = r.x + r.w / 2 - (k * W) / 2;
  const ty = r.y + r.h / 2 - (k * H) / 2;
  return `translate(${tx}px, ${ty}px) scale(${k})`;
}

/** The inverse: the transform that makes rect r fill the view. */
function outOf(r, W, H) {
  const k = Math.max(0.01, Math.min(r.w / W, r.h / H));
  const s = 1 / k;
  const tx = W / 2 - (r.x + r.w / 2) * s;
  const ty = H / 2 - (r.y + r.h / 2) * s;
  return `translate(${tx}px, ${ty}px) scale(${s})`;
}

const live = new WeakMap(); // stage -> { anims, old }

/** Jump any move still running on this stage to its end (a second zoom, a refresh or a resize mid-move). */
export function settle(stage) {
  const m = live.get(stage);
  if (!m) return;
  live.delete(stage);
  for (const a of m.anims) { try { a.finish(); } catch { /* already done */ } }
  m.old.remove();
}

/**
 * Swap `oldLayer` for `newLayer` (already in the stage).
 * @param {'in'|'out'|'fade'} dir
 * @param {{x,y,w,h}|null} anchor in => the clicked box in the old level; out => the box we leave, in the new level
 */
export function swapLayers(stage, oldLayer, newLayer, dir, anchor, W, H) {
  settle(stage);
  if (!oldLayer) return;
  oldLayer.inert = true;
  oldLayer.classList.add('hmm-leaving');
  const anims = [];
  const opts = { duration: ZOOM_MS, easing: EASE };
  if (reduced() || dir === 'fade' || !anchor || !W || !H) {
    const d = reduced() ? 120 : ZOOM_MS;
    anims.push(oldLayer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d, easing: 'ease', fill: 'forwards' }));
    anims.push(newLayer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d, easing: 'ease' }));
  } else if (dir === 'in') {
    stage.insertBefore(oldLayer, newLayer); // the new level comes up above the old one
    anims.push(oldLayer.animate([{ transform: 'none', opacity: 1 }, { transform: outOf(anchor, W, H), opacity: 0 }], { ...opts, fill: 'forwards' }));
    anims.push(newLayer.animate([{ transform: into(anchor, W, H), opacity: 0 }, { transform: 'none', opacity: 1 }], opts));
  } else {
    stage.appendChild(oldLayer); // the level we leave shrinks above the one we go back to
    anims.push(oldLayer.animate([{ transform: 'none', opacity: 1 }, { transform: into(anchor, W, H), opacity: 0 }], { ...opts, fill: 'forwards' }));
    anims.push(newLayer.animate([{ transform: outOf(anchor, W, H), opacity: 0.2 }, { transform: 'none', opacity: 1 }], opts));
  }
  const entry = { anims, old: oldLayer };
  live.set(stage, entry);
  anims[0].onfinish = () => { if (live.get(stage) === entry) { live.delete(stage); oldLayer.remove(); } };
  setTimeout(() => { if (live.get(stage) === entry) settle(stage); }, ZOOM_MS + 250);
}
