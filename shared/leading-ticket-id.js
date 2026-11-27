/**
 * shared/leading-ticket-id.js: a check that starts with a ticket id ("BAC76: After the next deploy ...")
 * names the ticket it is about; the Plan page and the ticket modal show that id as a button (PRO135).
 */

const LEADING_ID_RE = /^([A-Z]{2,5}\d+):\s+/;

/** {id, rest} when `text` starts with "<ID>: " (capitals, digits, colon, a space); otherwise null. */
export function splitLeadingTicketId(text) {
  const m = LEADING_ID_RE.exec(String(text ?? ''));
  return m ? { id: m[1], rest: String(text).slice(m[0].length) } : null;
}
