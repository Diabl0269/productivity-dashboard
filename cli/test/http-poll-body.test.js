// The tasks.json poll must always read the response body, even when it then skips the update.
// An unread 9 MB body keeps its connection busy; a few of them fill the browser's connection pool
// and the save that follows an edit (a review note on the Plan) waits behind them forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('a skipped poll still reads the body, and polls never overlap', async () => {
  const http = await import(join(dir, 'http-loader.js'));
  let started = 0;
  let bodiesRead = 0;
  let editing = false;
  globalThis.fetch = async () => {
    started++;
    editing = true; // the user starts an edit while the response is on its way
    await sleep(2500); // a slow, big response: longer than one poll interval
    return { ok: true, text: async () => { bodiesRead++; return '{}'; } };
  };
  let applied = 0;
  http.startHttpTaskWatching(() => { applied++; }, { shouldSkip: () => editing });
  await sleep(2300);
  assert.equal(started, 1, 'first poll started');
  await sleep(2600); // second interval fires while the first poll is still running, then the first ends
  assert.equal(started, 1, 'no second poll while one is in flight');
  assert.equal(bodiesRead, 1, 'skipped poll still read its body');
  assert.equal(applied, 0, 'and did not apply it');
  http.stopHttpTaskWatching();
});
