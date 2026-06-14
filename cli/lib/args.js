/**
 * cli/lib/args.js
 * Tiny wrapper around node:util parseArgs.
 *
 * Usage:
 *   import { parse } from './args.js';
 *
 *   const { values, positionals } = parse(argv, {
 *     json:   { type: 'boolean', short: 'j' },
 *     filter: { type: 'string',  short: 'f' },
 *     count:  { type: 'string',  short: 'n' },  // numbers come in as strings
 *   });
 *
 * Options spec keys map to node:util parseArgs `options` shape:
 *   { type: 'boolean' | 'string', short?: string, multiple?: boolean, default?: any }
 *
 * Returns { values, positionals } from parseArgs.
 * Throws (exits 1) on unknown flags — wraps parseArgs TypeError for user-friendly output.
 *
 * Exports:
 *   parse(argv, optionsSpec): {values: Record<string,any>, positionals: string[]}
 */

import { parseArgs } from 'node:util';

/**
 * Parse argv using the given options spec.
 *
 * @param {string[]} argv - argument list (already sliced past command name)
 * @param {Record<string, {type: string, short?: string, multiple?: boolean, default?: any}>} optionsSpec
 * @returns {{ values: Record<string,any>, positionals: string[] }}
 */
export function parse(argv, optionsSpec = {}) {
  try {
    return parseArgs({
      args: argv,
      options: optionsSpec,
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    // parseArgs throws TypeError for unknown flags; surface cleanly
    process.stderr.write(`arg error: ${e.message}\n`);
    process.exit(1);
  }
}
