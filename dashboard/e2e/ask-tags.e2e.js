// The For you tags and filter chips (AGE220), against the real serve.js on a synthetic CH_HOME.
//   D=$(mktemp -d); node dashboard/e2e/ask-tags-fixture.js $D
//   CH_HOME=$D PORT=3143 node serve.js &
//   playwright-cli open http://localhost:3143/dashboard/plan
//   playwright-cli run-code --filename=dashboard/e2e/ask-tags.e2e.js    (throws on failure)
async (page) => {
  const ok = (cond, msg) => { if (!cond) throw new Error(`ask-tags e2e: ${msg}`); };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('http://localhost:3143/dashboard/plan');
  await page.evaluate(() => { try { localStorage.removeItem('forYou.tag'); } catch { /* ignore */ } });
  await page.reload();
  const card = (h) => page.locator(`.rp-for-you li[data-ask="${h}"]`);
  await card('MK1#1').waitFor();
  const chips = () => page.$$eval('.rp-tag-filter .rp-tag-chip', ns => ns.map(n => n.textContent));
  const handles = () => page.$$eval('.rp-for-you .rp-review-list > li', ns => ns.map(n => n.dataset.ask || n.querySelector('button.rp-id, button')?.textContent));

  ok((await card('MK1#1').locator('.rp-tag').innerText()) === 'Marketing · Pick', 'marketing ask reads "Marketing · Pick"');
  ok((await card('CODE1#1').locator('.rp-tag').innerText()) === 'Merge', 'merge ask reads "Merge"');
  ok((await page.locator('.rp-for-you li:has(button:text("RV1")) .rp-tag').innerText()) === 'Taste', 'taste check card reads "Taste"');
  const shown = await chips();
  ok(shown.join('|') === 'All (3)|Merge (1)|Marketing (1)|Taste (1)', `chips with counts: ${shown}`);

  await page.locator('.rp-tag-chip[data-tag-filter="marketing"]').click();
  ok((await page.locator('.rp-tag-chip[data-tag-filter="marketing"]').getAttribute('aria-pressed')) === 'true', 'Marketing chip is pressed');
  ok((await handles()).length === 1 && (await card('MK1#1').count()) === 1, `only the marketing card is left: ${await handles()}`);
  await page.reload();
  await card('MK1#1').waitFor();
  ok((await handles()).length === 1, 'the filter survives a reload');

  // Keyboard: focus the All chip and press Enter.
  await page.locator('.rp-tag-chip[data-tag-filter="all"]').focus();
  await page.keyboard.press('Enter');
  ok((await handles()).length === 3, 'All shows every card again, by keyboard');
  ok(errors.length === 0, `page errors: ${errors}`);
}
