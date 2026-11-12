// Epic review cards roll up build freshness (AGE35), against the real serve.js on a synthetic CH_HOME.
//   D=$(mktemp -d); node dashboard/e2e/build-freshness-fixture.js $D
//   CH_HOME=$D PORT=3141 node serve.js &
//   playwright-cli open http://localhost:3141/dashboard/plan
//   playwright-cli run-code --filename=dashboard/e2e/build-freshness.e2e.js    (throws on failure)
// Body is a single async function of `page` (playwright-cli run-code contract).
async (page) => {
  const ok = (cond, msg) => { if (!cond) throw new Error(`build-freshness e2e: ${msg}`); };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('http://localhost:3141/dashboard/plan');
  const noteOf = (id) => page.locator('li', { has: page.locator(`button.rp-id:text-is("${id}")`) }).locator('.rp-build').first();
  await page.waitForSelector('.rp-build');
  const stale = noteOf('E-STALE');
  await stale.waitFor();
  const text = await stale.innerText();
  ok(text.includes('needs a newer build'), `stale epic says it needs a newer build: ${text}`);
  ok(text.includes('merged 5 Mar'), `names the merge date: ${text}`);
  ok(text.includes('Behind: C-NEW') && !text.includes('C-OLD'), `names only the stale ticket: ${text}`);
  ok(text.includes('Update: make install'), `shows the update command: ${text}`);
  ok((await noteOf('E-FRESH').innerText()) === 'Your app: in your build', 'current epic says in your build');
  ok((await noteOf('E-LOST').innerText()) === 'No build info for this change', 'epic with no readable state says so');
  ok(errors.length === 0, `page errors: ${errors.join('; ')}`);
}
