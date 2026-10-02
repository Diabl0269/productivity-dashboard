// claude-deeplink.js — build the Claude desktop app URL that opens a new Claude Code session
// with a prompt typed in and a working folder chosen. The app reads `prompt` (or `q`, capped at
// 14336 characters) and repeatable `folder`; it has no model parameter, so the model is picked
// in the app.

export const MAX_PROMPT_CHARS = 14336;

/** @returns {string|null} the claude://code/new URL, or null when there is nothing to send. */
export function claudeCodeSessionUrl(prompt, folder) {
  const text = typeof prompt === 'string' ? prompt.trim().slice(0, MAX_PROMPT_CHARS) : '';
  if (!text) return null;
  const params = new URLSearchParams();
  params.set('prompt', text);
  if (typeof folder === 'string' && folder.trim()) params.set('folder', folder.trim());
  return `claude://code/new?${params.toString().replace(/\+/g, '%20')}`;
}
