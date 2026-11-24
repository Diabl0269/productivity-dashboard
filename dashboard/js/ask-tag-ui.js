// ask-tag-ui.js — AGE220: the tag chip on each For you card (area + what it asks of you) and the filter
// chips above the list. The filter is one setting per browser (localStorage `forYou.tag`), keyboard
// reachable (real buttons, aria-pressed) and shows a count on each chip. Rules: shared/ask-tags.js.

import { tagOfReview, tagText, tagCounts, filterByTag, TAG_ACTIONS } from '../../shared/ask-tags.js';

export const TAG_FILTER_KEY = 'forYou.tag';

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage off: the choice lasts for this visit */ } }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The chosen filter slug ('' = All). */
export const selectedTag = () => safeGet(TAG_FILTER_KEY) || '';
export const setSelectedTag = slug => safeSet(TAG_FILTER_KEY, slug || '');

/** Chip text: the tag ("Marketing · Watch"); a card with no area keeps "Decision" (plus its action). */
export function tagChipText(tag, fallback = 'Decision') {
  if (tag?.area) return tagText(tag);
  return tag?.action ? `${fallback} · ${TAG_ACTIONS[tag.action]}` : fallback;
}

/** The small tag chip of a card. */
export function tagChip(tag, fallback = 'Decision') {
  const chip = el('span', `rp-chip rp-ask-kind rp-tag${tag?.area ? ` rp-tag-${tag.area}` : ''}`, tagChipText(tag, fallback));
  chip.dataset.tag = tag?.area || '';
  if (tag?.action) chip.dataset.action = tag.action;
  chip.title = tag?.overridden ? 'Tag set with ch tasks ask --tag' : 'Worked out from the ticket and what is attached';
  return chip;
}

/** The tag of a review card (ticket with checks): from the doc, its epic and its children. */
export function reviewTag(ctx, item) {
  const tasks = (ctx.doc?.sections || []).flatMap(s => s.tasks || []);
  const task = tasks.find(t => t.id === item.id);
  if (!task) return { area: '', action: '' };
  const epic = tasks.find(t => t.id === task.parentId);
  return tagOfReview(task, epic, tasks.filter(t => t.parentId === task.id));
}

/**
 * Filter row for the For you list: All plus one chip per area present. `redraw` repaints the page.
 * Null when fewer than one tagged card exists (nothing to filter by).
 */
export function renderTagFilter(tags, redraw) {
  const counts = tagCounts(tags);
  if (!counts.length) return null;
  const current = effectiveTag(tags);
  const row = el('div', 'rp-tag-filter');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Filter For you by tag');
  const add = (slug, label, count) => {
    const b = el('button', 'rp-tag-chip', `${label} (${count})`);
    b.type = 'button';
    b.dataset.tagFilter = slug || 'all';
    b.setAttribute('aria-pressed', current === slug ? 'true' : 'false');
    b.addEventListener('click', () => { setSelectedTag(slug); redraw?.(); });
    row.appendChild(b);
  };
  add('', 'All', tags.length);
  counts.forEach(c => add(c.slug, c.label, c.count));
  return row;
}

/** The chosen slug, or '' when no card carries it any more (a stale choice must not hide everything). */
export function effectiveTag(tags) {
  const s = selectedTag();
  return s && tags.some(t => t?.area === s) ? s : '';
}

export { filterByTag };
