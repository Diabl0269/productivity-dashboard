// home-ai-path.js (AGE199) — the small second map on How it runs: where an AI answer comes from, as boxes joined
// by lines (the app -> the backend -> Anthropic, or a local Ollama), each box one short line. Boxes and lines come
// from the config's `lifecycle.ai` ({ nodes: [{ id, name, what, box? }], edges: [{ from, to, label? }] }); a box
// with a `box` opens that place's handbook page. Wires are an SVG drawn from the boxes' real positions, like the
// flow above it. Nothing is drawn when the config has no `lifecycle.ai`.

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Column of each node: the longest way from a node nothing points at (no loops: a node already placed stays). */
export function aiColumns(nodes, edges) {
  const col = new Map(nodes.map(n => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const e of edges) {
      if (col.get(e.to) < col.get(e.from) + 1 && col.get(e.from) + 1 < nodes.length) { col.set(e.to, col.get(e.from) + 1); moved = true; }
    }
    if (!moved) break;
  }
  return col;
}

/**
 * @param {HTMLElement} host
 * @param {object} ctx Home ctx
 * @returns {{ update(): void, dispose(): void }}
 */
export function buildAiPath(host, ctx) {
  const wrap = el('section', 'hr-ai-wrap');
  wrap.setAttribute('aria-labelledby', 'hrAiTitle');
  const title = el('h3', 'hr-h3', 'Where an AI answer comes from');
  title.id = 'hrAiTitle';
  const grid = el('div', 'hr-ai');
  const wires = document.createElementNS(SVG_NS, 'svg');
  wires.setAttribute('class', 'hr-wires');
  wires.setAttribute('aria-hidden', 'true');
  const labels = el('div', 'hr-ai-labels');
  grid.append(wires, labels);
  wrap.append(title, grid);
  host.appendChild(wrap);
  let shown = '';
  const boxes = new Map();
  let ai = null;

  function draw() {
    if (!ai || !grid.isConnected) return;
    const g = grid.getBoundingClientRect();
    if (!g.width) return;
    wires.setAttribute('width', g.width);
    wires.setAttribute('height', g.height);
    wires.textContent = '';
    labels.textContent = '';
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = '<marker id="hrAiArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="hr-arrow"/></marker>';
    wires.appendChild(defs);
    for (const e of ai.edges) {
      const a = boxes.get(e.from)?.getBoundingClientRect();
      const b = boxes.get(e.to)?.getBoundingClientRect();
      if (!a || !b) continue;
      const x1 = a.right - g.left + 2;
      const y1 = (a.top + a.bottom) / 2 - g.top;
      const x2 = b.left - g.left - 3;
      const y2 = (b.top + b.bottom) / 2 - g.top;
      const mid = (x1 + x2) / 2;
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', `M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
      p.setAttribute('class', 'hr-wire hr-wire-flow');
      p.setAttribute('marker-end', 'url(#hrAiArrow)');
      wires.appendChild(p);
      if (e.label) {
        const t = el('span', 'hr-ai-label', e.label);
        // A straight line is labelled above its middle; a line that bends down is labelled above its arrow end.
        const flat = Math.abs(y1 - y2) < 4;
        t.classList.toggle('hr-ai-label-end', !flat);
        Object.assign(t.style, { left: `${flat ? mid : x2 - 6}px`, top: `${flat ? y1 : y2}px` });
        labels.appendChild(t);
      }
    }
  }

  function build() {
    grid.querySelectorAll('.hr-ai-node').forEach(n => n.remove());
    boxes.clear();
    const col = aiColumns(ai.nodes, ai.edges);
    const rowIn = new Map();
    const cols = Math.max(...col.values(), 0) + 1;
    grid.style.setProperty('--hr-ai-cols', cols);
    for (const n of ai.nodes) {
      const c = col.get(n.id);
      const r = (rowIn.get(c) || 0) + 1;
      rowIn.set(c, r);
      const node = n.box ? el('button', 'hr-ai-node hr-ai-link') : el('div', 'hr-ai-node');
      if (n.box) {
        node.type = 'button';
        node.dataset.hmKey = `ai-${n.id}`;
        node.addEventListener('click', () => { ctx.setSelection(n.box); document.querySelector('.hm-insp-tab[data-id="how"]')?.click(); });
      }
      node.dataset.node = n.id;
      node.append(el('span', 'hr-label', n.name), el('span', 'hr-what', n.what));
      node.style.gridColumn = String(c + 1);
      node.style.gridRow = String(r);
      grid.appendChild(node);
      boxes.set(n.id, node);
    }
    requestAnimationFrame(draw);
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null;
  ro?.observe(grid);

  function update() {
    ai = ctx.config()?.lifecycle?.ai || null;
    wrap.hidden = !ai || !ai.nodes.length;
    title.textContent = ai?.title || 'Where an AI answer comes from';
    const sig = JSON.stringify(ai);
    if (wrap.hidden || sig === shown) { if (!wrap.hidden) requestAnimationFrame(draw); return; }
    shown = sig;
    build();
  }
  update();
  return { update, dispose() { ro?.disconnect(); } };
}
