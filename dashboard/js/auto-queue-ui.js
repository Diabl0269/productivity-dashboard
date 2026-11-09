// auto-queue-ui.js — the Plan page's "Auto queue": every epic with Auto on, grouped High / Normal / Low,
// reordered by drag (project-drag.js) or Alt+ArrowUp/Down. Order rules and moves: shared/auto-queue.js.

import { autoQueue, groupQueue, moveInQueue, stepTarget } from '../../shared/auto-queue.js';
import { bindReorderDrag, playFlip } from './project-drag.js';

const GROUPS = [['high', 'High'], ['normal', 'Normal'], ['low', 'Low']];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Set by a keyboard move before the Plan page redraws; the redraw slides rows from here and refocuses.
let pending = null;

/**
 * @param {object[]} readiness  plan.readiness
 * @param {{ idButton: (id: string) => HTMLElement,
 *           openTicket: (id: string) => void,
 *           apply: (changes: {id: string, priority: string, autoRank: number}[], note: string) => void,
 *           redraw: () => void }} ctx
 */
export function renderAutoQueue(readiness, ctx) {
  const queue = autoQueue(readiness);
  const sec = el('section', 'rp-aq');
  sec.setAttribute('aria-label', 'Auto queue');
  sec.appendChild(el('h3', 'rp-aq-title', 'Auto queue'));
  if (!queue.length) {
    sec.appendChild(el('p', 'rp-aq-empty', "No epics on Auto. Tick Auto in an epic's window."));
    return sec;
  }
  sec.appendChild(el('p', 'rp-ready-note',
    'Epics start from the top. Drag a row, or focus it and press Alt+Up / Alt+Down; moving it into another group changes its priority.'));
  const live = el('p', 'rp-aq-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  sec.appendChild(live);

  const groups = groupQueue(queue);
  const lists = [];
  const move = (id, target) => {
    const { changes } = moveInQueue(queue, id, target);
    if (!changes.length) return false;
    const label = GROUPS.find(g => g[0] === target.priority)[1];
    ctx.apply(changes, `${id} moved to ${label}, place ${target.index + 1}`);
    return true;
  };

  for (const [key, label] of GROUPS) {
    const group = el('div', 'rp-aq-group');
    group.appendChild(el('h4', 'rp-aq-group-title', `${label} (${groups[key].length})`));
    const list = el('ul', 'rp-aq-list');
    list.dataset.priority = key;
    list.setAttribute('aria-label', `${label} priority`);
    for (const r of groups[key]) {
      const li = el('li', `rp-aq-row ${r.ready ? 'rp-ready-yes' : 'rp-ready-no'}`);
      li.dataset.epic = r.id;
      li.draggable = true;
      li.tabIndex = 0;
      li.setAttribute('aria-label', `${r.id} ${r.title}, ${label} priority, place ${groups[key].indexOf(r) + 1} of ${groups[key].length}. Alt plus arrow keys move it, Enter opens it.`);
      li.appendChild(el('span', 'rp-aq-grip', '⋮⋮')).setAttribute('aria-hidden', 'true');
      li.appendChild(ctx.idButton(r.id));
      li.appendChild(el('span', 'rp-ready-name', r.title));
      li.appendChild(el('span', 'rp-aq-lane', r.lane || 'no lane'));
      li.appendChild(el('span', 'rp-ready-state', r.ready ? 'Ready' : 'Not ready'));
      li.addEventListener('keydown', (e) => {
        if (e.target !== li) return;
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          const target = stepTarget(queue, r.id, e.key === 'ArrowUp' ? -1 : 1);
          if (!target) { live.textContent = `${r.id} is already ${e.key === 'ArrowUp' ? 'first' : 'last'}.`; return; }
          pending = {
            id: r.id,
            rects: new Map([...sec.querySelectorAll('[data-epic]')].map(x => [x.dataset.epic, x.getBoundingClientRect()])),
          };
          if (!move(r.id, target)) pending = null;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          ctx.openTicket(r.id);
        }
      });
      list.appendChild(li);
    }
    group.appendChild(list);
    sec.appendChild(group);
    lists.push(list);
  }

  bindReorderDrag(lists, {
    onDrop: (id, listEl, index) => { move(id, { priority: listEl.dataset.priority, index }); },
    onCancel: () => ctx.redraw(),
  });

  // After a keyboard move the page redrew: slide rows from their old places and keep focus on the row.
  if (pending) {
    const { id, rects } = pending;
    pending = null;
    requestAnimationFrame(() => {
      const rows = [...sec.querySelectorAll('[data-epic]')];
      playFlip(rows, rects);
      sec.querySelector(`[data-epic="${CSS.escape(id)}"]`)?.focus({ preventScroll: false });
    });
  }
  return sec;
}
