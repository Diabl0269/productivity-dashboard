// check-text.js: a check's text with its leading ticket id as a button (PRO135). No browser-module imports,
// so tests can run it on a fake DOM; callers pass the id-button and text builders.
import { splitLeadingTicketId } from '../../shared/leading-ticket-id.js';

/**
 * Append `text` to `parent`. A leading "<ID>: " becomes `makeButton(id)` followed by ": " and the rest;
 * ids elsewhere stay in the text (`makeText` may link them). Returns `parent`.
 */
export function appendCheckText(parent, text, makeButton, makeText) {
  const lead = splitLeadingTicketId(text);
  if (!lead) { parent.appendChild(makeText(String(text ?? ''))); return parent; }
  parent.appendChild(makeButton(lead.id));
  parent.appendChild(document.createTextNode(': '));
  parent.appendChild(makeText(lead.rest));
  return parent;
}
