/**
 * shared/ask-tags.js — AGE220: the tag on every decision card and review card in the Plan page's
 * "For you" list: an area (Marketing, Design, Merge, Taste, Account step) and an action (Watch,
 * Listen, Read, Pick, Sign in). Both are derived from the ticket and what is attached, never typed;
 * `ch tasks ask --tag <slug>` overrides the area. Pure: no I/O, runs in the CLI and the dashboard.
 */

import { isPickGate } from './pick-gate.js';

/** Areas in priority order (first match wins when several apply). */
export const TAG_AREAS = [
  { slug: 'merge', label: 'Merge' },
  { slug: 'account', label: 'Account step' },
  { slug: 'marketing', label: 'Marketing' },
  { slug: 'design', label: 'Design' },
  { slug: 'taste', label: 'Taste' },
];
export const TAG_SLUGS = TAG_AREAS.map(a => a.slug);
export const TAG_ACTIONS = { watch: 'Watch', listen: 'Listen', read: 'Read', pick: 'Pick', 'sign-in': 'Sign in' };

const MARKETING_LANES = ['marketing', 'brand'];
const lower = v => String(v ?? '').trim().toLowerCase();

/** Label text of an area slug ('' for an unknown one). */
export const areaLabel = slug => TAG_AREAS.find(a => a.slug === slug)?.label || '';

/** Error text for a bad `--tag` value, or ''. */
export function tagError(value) {
  return TAG_SLUGS.includes(lower(value)) ? '' : `--tag must be one of ${TAG_SLUGS.join(', ')}: ${value}`;
}

const hasLabel = (task, name) => (task?.labels || []).some(l => lower(l) === name);

/** Is this ticket (or its epic) marketing work: project marketing, or lane marketing / brand? */
function isMarketing(...tasks) {
  return tasks.some(t => t && (lower(t.project) === 'marketing' || MARKETING_LANES.includes(lower(t.lane))));
}

/** Check text that is a taste judgement: "Taste: ..." with an optional ticket id before it. */
export const isTasteCheckText = text => /^\s*(?:[A-Za-z]{1,8}\d+:\s*)?taste\b/i.test(String(text ?? ''));

/** Does an open check or a needs-tal line of this ticket ask for a taste call? */
function hasTasteCheck(task) {
  if ((task?.checks || []).some(c => c && !c.checked && isTasteCheckText(c.text))) return true;
  return (task?.result?.unverified || []).some(u => /needs-tal\s*:\s*taste\b/i.test(String(u)));
}

/**
 * Area slug of a ticket (with its epic): '' when none applies.
 * @param {object} task  doc-shaped ticket: project, lane, labels, title, checks, result
 * @param {object} [epic]  its epic, when it has one
 */
export function areaOfTicket(task, epic) {
  if (isPickGate(task)) return 'account';
  if (isMarketing(task, epic)) return 'marketing';
  if (hasLabel(task, 'design') || hasLabel(epic, 'design')) return 'design';
  if (hasTasteCheck(task)) return 'taste';
  return '';
}

/** Action slug from what a decision card carries: video, sound, picture / board, or only options. */
export function actionOfMedia(media = {}, { options = [], account = false } = {}) {
  if (account) return 'sign-in';
  if (media.video) return 'watch';
  if (media.audio) return 'listen';
  if (media.image || media.board) return 'read';
  return options.length ? 'pick' : '';
}

/**
 * The tag of one decision row: { area, action, overridden }. A stored `tag` wins; a merge ask is Merge;
 * otherwise the ticket decides. A --board link makes the ask Design when nothing else applies.
 */
export function tagOfAsk(row, task, epic) {
  const own = lower(row?.tag);
  const valid = TAG_SLUGS.includes(own);
  let area = valid ? own : '';
  if (!area && row?.mergePr) area = 'merge';
  if (!area) area = areaOfTicket(task, epic) || (row?.media?.board ? 'design' : '');
  const action = area === 'merge' ? '' : actionOfMedia(row?.media, { options: row?.options, account: area === 'account' });
  return { area, action, overridden: valid };
}

/** The tag of a review card (a ticket or epic with checks): area from the ticket and its children, action from the open checks' attachments. */
export function tagOfReview(task, epic, children = []) {
  let area = areaOfTicket(task, epic);
  if (!area) {
    const found = new Set(children.map(c => areaOfTicket(c, task)).filter(Boolean));
    area = TAG_SLUGS.find(s => s !== 'merge' && found.has(s)) || '';
  }
  const open = (task?.checks || []).filter(c => c && !c.checked);
  const media = {};
  for (const k of ['video', 'audio', 'image']) if (open.some(c => c[k])) media[k] = true;
  return { area, action: actionOfMedia(media, { account: area === 'account' }), overridden: false };
}

/** "Marketing · Watch" / "Marketing" / "Watch" / '' for a tag. */
export function tagText(tag) {
  return [areaLabel(tag?.area), TAG_ACTIONS[tag?.action]].filter(Boolean).join(' · ');
}

/** Chip data for the filter row: [{ slug, label, count }] for the areas present in `tags`, in area order. */
export function tagCounts(tags) {
  return TAG_AREAS.map(a => ({ ...a, count: tags.filter(t => t?.area === a.slug).length })).filter(c => c.count > 0);
}

/** Keep the items whose tag area is `slug` ('' or 'all' keeps everything). `tagOf(item)` returns the tag. */
export function filterByTag(items, slug, tagOf) {
  const s = lower(slug);
  return !s || s === 'all' ? items : items.filter(i => tagOf(i)?.area === s);
}
