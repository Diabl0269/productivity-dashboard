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

/** Compact JSON output to stdout. */
export function jsonOut(obj) {
  console.log(JSON.stringify(obj));
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
