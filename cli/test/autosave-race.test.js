// An edit made while a save is in flight must not be marked clean by that save finishing:
// that silently dropped notes. The follow-up save has to write the newer edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const el = () => new Proxy(function () {}, {
  get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : k === 'style' ? {} : () => el(),
  set: () => true,
  apply: () => el(),
});

test('edit during an in-flight save is saved, not dropped', async () => {
  globalThis.document = { getElementById: () => el(), createElement: () => el(), body: el() };
  globalThis.window = globalThis;
  const io = await import(join(dir, 'tasks-io.js'));
  const st = { hasChanges: false, sections: [], tasks: {}, ticketTypes: [], meta: {} };
  let writes = 0;
  st.taskFileHandle = {
    createWritable: async () => ({ write: async () => { await sleep(300); writes++; }, close: async () => {} }),
    getFile: async () => ({ lastModified: 1 }),
  };
  io.setIOCallbacks({ stateFn: () => st, renderFn: () => () => {}, parseFn: () => () => {} });

  io.markChanged();
  await sleep(700); // autosave (500ms debounce) is now mid-write
  io.markChanged(); // edit lands mid-save
  await sleep(1500);

  assert.equal(writes, 2);
  assert.equal(st.hasChanges, false);
});
