// The Checks tab (PRO143), against the real serve.js on a synthetic CH_HOME.
//   D=$(mktemp -d); node dashboard/e2e/checks-page-fixture.js $D
//   CH_HOME=$D PORT=3142 node serve.js &
//   playwright-cli open http://localhost:3142/dashboard/checks
//   playwright-cli run-code --filename=dashboard/e2e/checks-page.e2e.js    (throws on failure)
// Body is a single async function of `page` (playwright-cli run-code contract).
async (page) => {
  const ok = (cond, msg) => { if (!cond) throw new Error(`checks-page e2e: ${msg}`); };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('http://localhost:3142/dashboard/checks');
  await page.evaluate(() => { try { localStorage.removeItem('checks.hideFinished'); } catch { /* ignore */ } });
  await page.reload();
  const li = (id) => page.locator(`#checksMain li[data-ck-id="${id}"]`);
  const ids = () => page.$$eval('#checksMain li[data-ck-id]', ns => ns.map(n => n.dataset.ckId));
  const sw = page.locator('#checksMain .ck-switch');

  await sw.waitFor();
  await li('C-OPEN').waitFor();
  ok((await sw.getAttribute('aria-checked')) === 'true', 'Hide finished is on by default');
  const shown = await ids();
  ok(shown.includes('C-OPEN') && shown.includes('E-PART'), `C-OPEN and E-PART show: ${shown}`);
  ok(!shown.includes('C-DONE'), `C-DONE is hidden: ${shown}`);
  ok((await page.locator('#checksMain h2').innerText()) === 'Checks (2)', 'heading counts the visible tickets');
  ok((await li('C-OPEN').locator('.rp-checks').count()) === 1, 'checks are open by default');

  // The switch is the first Tab stop in the panel (nothing focusable comes before it).
  ok(await page.evaluate(() => {
    const first = document.querySelector('#checksPanel button, #checksPanel input, #checksPanel a[href], #checksPanel [tabindex="0"]');
    return first?.classList.contains('ck-switch');
  }), 'the switch is the first Tab stop in the panel');
  await page.locator('#checksMain .ck-switch').focus();
  await page.keyboard.press('Tab');
  ok(await page.evaluate(() => !!document.activeElement?.closest('#checksMain li')), 'Tab from the switch lands in the list');

  // Switch off: C-DONE shows as finished.
  await sw.click();
  await li('C-DONE').waitFor();
  ok((await li('C-DONE').getAttribute('class')).includes('ck-finished'), 'C-DONE has ck-finished');
  ok((await li('C-DONE').locator('.ck-finished-chip').count()) === 1, 'C-DONE carries the waits-for-notes-run chip');
  ok((await page.locator('#checksMain .ck-switch').getAttribute('aria-checked')) === 'false', 'switch reads off');
  ok(await page.evaluate(() => document.activeElement?.classList.contains('ck-switch')), 'focus returns to the switch');
  ok((await page.$$eval('#checksMain li.ck-finished', ns => ns.length)) === 1, 'only the finished ticket is marked finished');

  // Switch on again, then reload: the choice is remembered.
  await page.locator('#checksMain .ck-switch').click();
  await page.waitForFunction(() => !document.querySelector('#checksMain li[data-ck-id="C-DONE"]'));
  await page.locator('#checksMain .ck-switch').click();
  await li('C-DONE').waitFor();
  await page.reload();
  await li('C-DONE').waitFor();
  ok((await page.locator('#checksMain .ck-switch').getAttribute('aria-checked')) === 'false', 'switch state is remembered after a reload');
  await page.locator('#checksMain .ck-switch').click();
  await page.waitForFunction(() => !document.querySelector('#checksMain li[data-ck-id="C-DONE"]'));
  await page.reload();
  await li('C-OPEN').waitFor();
  ok((await page.locator('#checksMain .ck-switch').getAttribute('aria-checked')) === 'true', 'switch on is remembered too');

  // Arrow keys move between tickets.
  const toggles = page.locator('#checksMain li[data-ck-id] .rp-chip-toggle');
  await toggles.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.activeElement === document.querySelectorAll('#checksMain li[data-ck-id] .rp-chip-toggle')[1]), 'ArrowDown focuses the second ticket');
  await page.keyboard.press('ArrowUp');
  ok(await page.evaluate(() => document.activeElement === document.querySelectorAll('#checksMain li[data-ck-id] .rp-chip-toggle')[0]), 'ArrowUp focuses the first ticket');
  await page.keyboard.press('End');
  ok(await page.evaluate(() => document.activeElement === [...document.querySelectorAll('#checksMain li[data-ck-id] .rp-chip-toggle')].pop()), 'End focuses the last ticket');
  await page.keyboard.press('Home');
  ok(await page.evaluate(() => document.activeElement === document.querySelectorAll('#checksMain li[data-ck-id] .rp-chip-toggle')[0]), 'Home focuses the first ticket');

  // Ticking C-OPEN's last check animates the row out, then removes it.
  await page.evaluate(() => {
    window.__ckLeft = false;
    new MutationObserver(() => {
      if (document.querySelector('#checksMain li.ck-leaving')) window.__ckLeft = true;
    }).observe(document.getElementById('checksMain'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await li('C-OPEN').locator('input[type=checkbox]:not(:checked)').first().check();
  await page.waitForFunction(() => !document.querySelector('#checksMain li[data-ck-id="C-OPEN"]'), null, { timeout: 3000 });
  ok(await page.evaluate(() => window.__ckLeft), 'the row got ck-leaving before it went');
  ok(!(await ids()).includes('C-OPEN') && (await ids()).includes('E-PART'), 'C-OPEN is gone, E-PART stays');
  // The older tabs keep their shortcuts (Home stays Ctrl/Cmd+9); Checks is the 10th, on 0.
  await page.locator('#checksMain .ck-title').click();
  await page.keyboard.press('Control+9');
  ok(await page.evaluate(() => document.getElementById('homePanel')?.classList.contains('active')), 'Ctrl+9 still opens Home');
  await page.keyboard.press('Control+0');
  ok(await page.evaluate(() => document.getElementById('checksPanel')?.classList.contains('active')), 'Ctrl+0 opens Checks');
  ok(errors.length === 0, `page errors: ${errors.join('; ')}`);
}
