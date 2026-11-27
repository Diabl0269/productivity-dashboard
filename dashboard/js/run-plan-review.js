// run-plan-review.js — the "For you" block of the Plan page (and Home's Lanes view): review cards with
// their check grids, compact review rows, needs-you lines, decision and interpretation cards.
// Every function takes the page's ctx (run-plan-page.js createPlanCtx) instead of module state.

import { groupChecksByProject, isCompactReview, hiddenAsFinished } from '../../shared/review.js';
import { noteArea, areaOptions } from '../../shared/review-filing.js';
import { resolveNeedsTalLine } from '../../shared/needs-tal-lines.js';
import { linkedCheckKeys } from '../../shared/ask-check-overlap.js';
import { unsentNotes } from '../../shared/review-notes.js';
import { toggleTaskComplete } from './tasks-list.js';
import { buildFreshnessNote } from './build-freshness-note.js';
import { checkBuildChip, noProjectNote } from './check-build-ui.js';
import { projectGroupHeader, playVideoButton, audioPlayer, evidenceUrl, openBranchButton, checkStill } from './check-evidence.js';
import { heldPrChip } from './held-pr-ui.js';
import { branchSiteButton } from './branch-site-ui.js';
import { idButton, textWithIds } from './ticket-id-button.js';
import { appendCheckText } from './check-text.js';
import { toggleReviewCheck, commitReviewChange } from './task-detail.js';
import { reviewNoteRow, reviewNoteAddRow } from './review-notes-ui.js';
import { asksFromState, renderAskCard } from './asks-strip.js';
import { tagChip, reviewTag, renderTagFilter, effectiveTag, filterByTag } from './ask-tag-ui.js';
import { renderInterpretationCard } from './interpretation-card.js';
import { markChanged } from './tasks-io.js';
import { renderFileBar } from './run-plan-notes-bar.js';
import { hideFinished, setHideFinished, buildSwitch, switchGroup, finishedCount } from './hide-finished-switch.js';
import { el, truncate, shortDate, threadAnchor, reviewOfNote, SHIPPED_MAX } from './run-plan-util.js';

const allTasks = ctx => Object.values(ctx.getState?.()?.tasks || {}).flat();

/** Area chip data for a note: its area (own or computed) and the lanes it can move to. */
export function areaFor(ctx, task, note) {
  const docTask = ctx.doc.sections.flatMap(s => s.tasks).find(t => t.id === task.taskId);
  const current = docTask ? noteArea(ctx.doc, docTask, note) : null;
  return { current, options: areaOptions(ctx.doc, current) };
}

/** Note rows for one place on a card (a check, or "not tied to a check"). */
function noteCell(ctx, task, notes, { check, key, placeholder, label }) {
  const cell = el('div', 'rp-check-notes');
  notes.forEach(n => cell.appendChild(reviewNoteRow(task, n, { onChange: commitReviewChange, area: areaFor(ctx, task, n) })));
  cell.appendChild(reviewNoteAddRow(task, { check, key, placeholder, label, onChange: commitReviewChange }));
  return cell;
}

/** The expanded check grid: Pass | What to check | Your note, then a row for general notes. */
export function renderCheckGrid(ctx, task) {
  const grid = el('div', 'rp-checks');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', `${task.taskId}: checks and notes`);
  const head = el('div', 'rp-check-row rp-check-head');
  ['Pass', 'What to check', 'Your note'].forEach(t => head.appendChild(el('div', 'rp-check-h', t)));
  grid.appendChild(head);
  const checks = task.checks || [];
  const unsent = unsentNotes(task);
  // PRO90: a check an open question links shows on that question's card, not as its own row.
  const settledByAsk = linkedCheckKeys(asksFromState(ctx.getState?.()));
  const hidden = (c) => !c.checked && settledByAsk.has(`${task.taskId}\0${c.text}`);
  const addRow = (c, i, projectButtons = []) => {
    const row = el('div', 'rp-check-row');
    const pass = el('div', 'rp-check-pass');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!c.checked;
    cb.setAttribute('aria-label', `Pass check ${i + 1}: ${c.text}`);
    if (c.handedTo) {
      cb.checked = true;
      cb.disabled = true;
      cb.title = `Handed to ${c.handedTo}`;
    } else {
      cb.addEventListener('change', () => toggleReviewCheck(task, c));
    }
    pass.appendChild(cb);
    row.appendChild(pass);
    const what = el('div', 'rp-check-what' + (c.checked ? ' rp-check-done' : ''));
    // FRO2246: ticket ids inside the check open the ticket; a design check links its board.
    appendCheckText(what, c.text || '', id => idButton(id, 'rp-link rp-review-id'), t => textWithIds(t));
    if (c.link?.url) {
      what.appendChild(document.createTextNode(' '));
      const a = el('a', 'rp-canvas-link rp-check-link', `${c.link.label || 'Design board'} ↗`);
      a.href = c.link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = c.link.url;
      what.appendChild(a);
    }
    if (c.handedTo) {
      what.appendChild(document.createTextNode(' → '));
      what.appendChild(idButton(c.handedTo, 'rp-link rp-review-id'));
    }
    if (c.agentVerified) {
      const av = c.agentVerified;
      const failed = av.result === 'fail';
      const when = new Date(av.at);
      const short = isNaN(when) ? '' : ' ' + when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      what.appendChild(document.createTextNode(' '));
      const badge = el('span', 'rp-check-agent' + (failed ? ' rp-check-agent-fail' : ''), failed ? 'Agent: failed' : `Agent verified${short}`);
      badge.title = av.note;
      what.appendChild(badge);
    }
    // AGE162: a held check with no project still gets Open project (the branch's build); the chip owns it.
    const branchButton = c.heldPr && !c.project ? openBranchButton(c.heldPr, c.text) : null;
    if (branchButton) { what.appendChild(document.createTextNode(' ')); what.appendChild(branchButton); }
    // WEB49: a project with a branchSites rule runs the branch's site instead of the app-build Open project.
    const siteProject = task.project || ctx.doc.sections.flatMap(s => s.tasks).find(t => t.id === task.taskId)?.project;
    const siteButton = c.heldPr ? branchSiteButton(c, siteProject) : null;
    if (siteButton) { what.appendChild(document.createTextNode(' ')); what.appendChild(siteButton); siteButton.configured.then(ok => { if (ok) branchButton?.remove(); }); }
    const branchChip = heldPrChip(c, branchButton ? [...projectButtons, branchButton] : projectButtons);
    if (branchChip) {
      what.appendChild(document.createTextNode(' '));
      what.appendChild(branchChip);
    }
    if (c.video) {
      what.appendChild(document.createTextNode(' '));
      what.appendChild(playVideoButton(c, i + 1, what));
    }
    if (c.noVideo) {
      what.appendChild(document.createTextNode(' '));
      what.appendChild(el('span', 'rp-check-muted', `No video: ${c.noVideo}`));
    }
    // PRO100: the exact build the project opens in (and whether it has the change), or why there is no project.
    for (const extra of [checkBuildChip(task, c, allTasks(ctx), ctx.redraw), noProjectNote(c)]) {
      if (extra) { what.appendChild(document.createTextNode(' ')); what.appendChild(extra); }
    }
    if (c.audio) what.appendChild(audioPlayer(c, i + 1));
    if (c.image) what.appendChild(checkStill(c, i + 1));
    if (c.checkedNote) {
      what.appendChild(document.createTextNode(' '));
      what.appendChild(el('span', 'rp-check-muted', c.checkedNote));
    }
    row.appendChild(what);
    row.appendChild(noteCell(ctx, task, unsent.filter(n => n.check === c.text), {
      check: c.text, key: i, placeholder: 'What did you see? Enter saves', label: `Note on check ${i + 1}`,
    }));
    grid.appendChild(row);
  };
  // Checks sharing a saved project sit together under one header; the rest keep their order after.
  for (const group of groupChecksByProject(checks)) {
    if (group.items.every(({ check }) => hidden(check))) continue;
    let header = null;
    if (group.project) { header = projectGroupHeader(group.project, 'rp-check-row ce-group-head'); grid.appendChild(header); }
    const buttons = header ? [...header.querySelectorAll('button')] : [];
    group.items.forEach(({ check, index }) => { if (!hidden(check)) addRow(check, index, check.project ? buttons : []); });
  }
  const texts = new Set(checks.map(c => c.text));
  const general = el('div', 'rp-check-row rp-check-general');
  general.appendChild(el('div', 'rp-check-pass'));
  general.appendChild(el('div', 'rp-check-what rp-check-muted', 'Anything not tied to a check'));
  general.appendChild(noteCell(ctx, task, unsent.filter(n => !n.check || !texts.has(n.check)), {
    key: 'general', placeholder: 'What did you see? Enter saves', label: 'General note',
  }));
  grid.appendChild(general);
  return grid;
}

/**
 * PRO86: the "For you" block above the lanes, one list oldest first with two kinds of item:
 * epics (and standalone tickets) ready for review, their checks inside, and decisions (asks-strip.js
 * cards with option buttons). Every item carries its media.
 */
export function renderReview(ctx, review, openChecks, asks, interps = []) {
  const block = el('section', 'rp-review rp-for-you');
  // AGE240: 'Hide finished' also drops finished review rows (same predicate as the count beside the switch).
  const allAsks = asks;
  const hide = ctx.doc ? hideFinished() : false;
  if (hide) review = review.filter(item => !hiddenAsFinished(item, asks));
  const total = review.length + asks.length + interps.length;
  // AGE220: filter chips by tag; cards with no tag and interpretations hide while a tag is chosen.
  const tagOfReviewItem = item => reviewTag(ctx, item);
  const tags = [...review.map(tagOfReviewItem), ...asks.map(c => c.tag || {})];
  const chosen = effectiveTag(tags);
  if (chosen) {
    review = filterByTag(review, chosen, tagOfReviewItem);
    asks = filterByTag(asks, chosen, c => c.tag);
    interps = [];
  }
  block.setAttribute('aria-label', `For you (${total})`);
  const head = el('div', 'ck-head');
  head.appendChild(el('h2', 'rp-review-title', total ? `For you (${total})` : 'For you'));
  if (ctx.doc) {
    const on = hideFinished();
    const sw = buildSwitch(on, () => { setHideFinished(!on); ctx.redraw(); }, 'forYouHideFinished', 'Same setting as the Checks tab');
    head.appendChild(switchGroup(sw, finishedCount(ctx.doc, allAsks), on));
  }
  block.appendChild(head);
  const fileBar = renderFileBar(ctx);
  if (fileBar) block.appendChild(fileBar);
  const filter = renderTagFilter(tags, ctx.redraw);
  if (filter) block.appendChild(filter);
  if (total) block.appendChild(renderReviewList(ctx, review, asks, interps));
  else block.appendChild(el('p', 'rp-review-empty', 'Nothing waits on you: no epic to review, no decision to make.'));
  if (openChecks.length) {
    const total = openChecks.reduce((sum, item) => sum + item.checks.total - item.checks.done, 0);
    block.appendChild(el('h3', 'rp-review-subtitle', `Checks on epics still in progress (${total})`));
    block.appendChild(el('p', 'rp-review-empty', 'These parts already shipped. The epic stays open for its other tickets.'));
    block.appendChild(renderReviewList(ctx, openChecks));
  }
  return block;
}

/** PRO97: needs-tal Unverified lines of done children, shown under the epic's checks while it is still in progress. */
export function renderNeedsTalLines(ctx, lines, epicId) {
  const box = el('div', 'rp-needs-tal');
  box.appendChild(el('div', 'rp-review-empty', 'Only you can judge these (from finished tickets):'));
  // PRO112: each line is a row like a check: tick box, the line with its media, and a note field on the source ticket.
  const grid = el('div', 'rp-checks rp-needs-tal-list');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Lines only you can judge: tick and notes');
  lines.forEach((l, i) => {
    const source = ctx.findTicket(l.from);
    const row = el('div', 'rp-check-row');
    const pass = el('div', 'rp-check-pass');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.setAttribute('aria-label', `Pass ${l.from}: ${l.text}`);
    cb.addEventListener('change', () => tickNeedsTalLine(ctx, l, epicId));
    pass.appendChild(cb);
    row.appendChild(pass);
    const what = el('div', 'rp-check-what');
    what.appendChild(idButton(l.from, 'rp-link rp-review-id'));
    what.appendChild(document.createTextNode(' '));
    appendCheckText(what, l.text, id => idButton(id, 'rp-link rp-review-id'), t => textWithIds(t));
    const media = l.media || {};
    if (media.project) { what.appendChild(document.createTextNode(' ')); what.appendChild(projectGroupHeader(media.project, 'ce-group-head')); }
    if (media.video) { what.appendChild(document.createTextNode(' ')); what.appendChild(playVideoButton({ video: media.video }, i + 1, what, `${l.from} line ${i + 1}`)); }
    if (media.audio) what.appendChild(audioPlayer({ audio: media.audio }, i + 1, `${l.from} line ${i + 1}`));
    if (media.image) {
      const img = el('img', 'ce-image');
      img.src = evidenceUrl(media.image);
      img.alt = `Image for ${l.from} line ${i + 1}`;
      what.appendChild(img);
    }
    row.appendChild(what);
    if (source) {
      row.appendChild(noteCell(ctx, source, unsentNotes(source).filter(n => n.check === l.text), {
        check: l.text, key: `needs-tal-${i}`, placeholder: 'What did you see? Enter saves', label: `Note on ${l.from}: ${l.text}`,
      }));
    }
    grid.appendChild(row);
  });
  box.appendChild(grid);
  return box;
}

/** PRO112: ticking a needs-tal line resolves it on the source ticket and the epic's rolled-up copy (what `--resolve-unverified` does). */
function tickNeedsTalLine(ctx, line, epicId) {
  const tickets = [ctx.findTicket(line.from), ctx.findTicket(epicId)].filter(Boolean);
  if (!resolveNeedsTalLine(tickets, line.text)) return;
  tickets.forEach(markChanged);
  ctx.redraw();
}

const COMPACT_HINT = "Tick when you've seen it; notes and answers are filed by the next notes run";

/** AGE80: an epic in review with nothing to check, note or answer: id, title and a tick box that moves it to Done (the list view's own toggle). */
function renderCompactReviewRow(ctx, item, task) {
  const openCompactNote = ctx.ui.openCompactNote;
  const li = el('li', 'rp-review-item rp-review-compact');
  const row = el('div', 'rp-row');
  const box = el('button', 'rp-compact-tick');
  box.type = 'button';
  box.setAttribute('role', 'checkbox');
  box.setAttribute('aria-checked', 'false');
  box.setAttribute('aria-label', `Mark ${item.id} reviewed: move to Done`);
  box.title = 'Reviewed: move to Done';
  box.addEventListener('click', () => { toggleTaskComplete(task); ctx.redraw(); });
  row.appendChild(box);
  row.appendChild(idButton(item.id));
  row.appendChild(el('span', 'rp-title', item.title));
  const noteBtn = el('button', 'rp-btn rp-compact-note-btn', 'Note');
  noteBtn.type = 'button';
  noteBtn.setAttribute('aria-label', `Add a note to ${item.id}`);
  noteBtn.setAttribute('aria-expanded', openCompactNote.has(item.id) ? 'true' : 'false');
  row.appendChild(noteBtn);
  li.appendChild(row);
  li.appendChild(el('div', 'rp-compact-hint', COMPACT_HINT));
  const focusInput = (wrap) => requestAnimationFrame(() => wrap.querySelector('.td-review-note-input')?.focus());
  let wrap = null;
  const openNote = () => {
    wrap = el('div', 'rp-compact-note');
    wrap.appendChild(reviewNoteAddRow(task, { key: 'general', placeholder: 'What did you see? Enter saves, Escape closes', label: `Note on ${item.id}`, onChange: commitReviewChange }));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeNote(true); } });
    li.appendChild(wrap);
    openCompactNote.add(item.id);
    noteBtn.setAttribute('aria-expanded', 'true');
    focusInput(wrap);
  };
  const closeNote = (refocus) => {
    wrap?.remove();
    wrap = null;
    openCompactNote.delete(item.id);
    noteBtn.setAttribute('aria-expanded', 'false');
    if (refocus) noteBtn.focus();
  };
  noteBtn.addEventListener('click', () => { if (wrap) closeNote(true); else openNote(); });
  if (openCompactNote.has(item.id)) openNote();
  return li;
}

/** Review items and decision cards in one list, oldest first (a review by when it entered review, a decision by when it was asked). */
export function renderReviewList(ctx, items, asks = [], interps = []) {
  const openReview = ctx.ui.openReview;
  const list = el('ol', 'rp-review-list');
  const when = x => String(x.kind === 'ask' || x.kind === 'interp' ? x.card.at || '' : x.item.enteredAt || '') || '9999';
  const all = [...items.map(item => ({ kind: 'review', item })), ...asks.map(card => ({ kind: 'ask', card })), ...interps.map(card => ({ kind: 'interp', card }))];
  if (asks.length || interps.length) all.sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0));
  for (const entry of all) {
    if (entry.kind === 'ask') { list.appendChild(renderAskCard(ctx.getState(), entry.card, ctx.redraw, ctx.surface)); continue; }
    if (entry.kind === 'interp') { list.appendChild(renderInterpretationCard(ctx.getState(), entry.card, ctx.redraw)); continue; }
    const { item } = entry;
    const task = ctx.findTicket(item.id);
    if (task && isCompactReview(item, asks)) { list.appendChild(renderCompactReviewRow(ctx, item, task)); continue; }
    const open = openReview.has(item.id);
    const li = el('li', 'rp-review-item' + (open ? ' rp-open' : ''));
    const row = el('div', 'rp-row');
    row.appendChild(idButton(item.id));
    const tag = reviewTag(ctx, item);
    if (tag.area || tag.action) row.appendChild(tagChip(tag, 'Review'));
    const since = shortDate(item.enteredAt);
    if (since) row.appendChild(el('span', 'rp-review-since', `since ${since}`));
    const toggle = el('button', 'rp-chip rp-chip-review rp-chip-toggle', `${item.checks.done}/${item.checks.total} checked ${open ? '▴' : '▾'}`);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.title = open ? 'Hide the checks' : 'Show the checks and add notes';
    toggle.addEventListener('click', () => {
      if (open) openReview.delete(item.id); else openReview.add(item.id);
      ctx.redraw();
    });
    row.appendChild(toggle);
    if (item.notes > 0) row.appendChild(el('span', 'rp-chip rp-chip-notes', `${item.notes} note${item.notes > 1 ? 's' : ''} unsent`));
    const thread = threadAnchor(task);
    if (thread) row.appendChild(thread);
    li.appendChild(row);
    li.appendChild(el('div', 'rp-title', item.title));
    const shipped = item.result?.shipped?.[0];
    if (shipped) li.appendChild(el('div', 'rp-why', truncate(shipped, SHIPPED_MAX)));
    const build = buildFreshnessNote(task, allTasks(ctx), ctx.redraw);
    if (build) li.appendChild(build);
    const from = reviewOfNote(item.reviewOf);
    if (from) li.appendChild(from);
    for (const fu of item.followUps) {
      const line = el('div', 'rp-review-of', 'Follow-up: ');
      line.appendChild(idButton(fu.id, 'rp-link rp-review-id'));
      line.appendChild(document.createTextNode(` (${fu.section})`));
      li.appendChild(line);
    }
    if (open && task && (task.checks || []).length) li.appendChild(renderCheckGrid(ctx, task));
    if (open && item.lines?.length) li.appendChild(renderNeedsTalLines(ctx, item.lines, item.id));
    list.appendChild(li);
  }
  return list;
}
