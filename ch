#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
import(join(here, 'cli', 'index.js'))
  .then(m => m.run(process.argv.slice(2)))
  .catch(e => { console.error(e?.message || e); process.exit(2); });
