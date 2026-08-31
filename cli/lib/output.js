/**
 * cli/lib/output.js
 * Output helpers for the ch CLI.
 *
 * Exports:
 *   print(s): void       — write to stdout (with newline)
 *   printErr(s): void    — write to stderr (with newline)
 *   jsonOut(obj): void   — compact JSON to stdout
 *   ok(s): void          — terse success line to stdout
 *   die(msg, code=1): never — printErr(msg) + process.exit(code)
 */

/** Write a line to stdout. */
export function print(s) {
  process.stdout.write(String(s) + '\n');
}

/** Write a line to stderr. */
export function printErr(s) {
  process.stderr.write(String(s) + '\n');
}

/**
 * Pretty-printed JSON output to stdout.
 * Indented (not compact) so large payloads span multiple lines — a single
 * giant line is unreadable/unpaginatable by line-oriented tools (e.g. an
 * agent's file-reading tool can only page by line offset). Still valid JSON
 * for any consumer that does JSON.parse() on the full captured output.
 */
export function jsonOut(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

/** Terse success line to stdout. */
export function ok(s) {
  print(s);
}

/**
 * Print error message to stderr and exit.
 * @param {string} msg
 * @param {number} code - exit code (default 1 = user error)
 * @returns {never}
 */
export function die(msg, code = 1) {
  printErr(msg);
  process.exit(code);
}
