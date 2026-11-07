// Metrics tab smoke test against the mock server.
//   PORT=3140 node dashboard/e2e/serve-mock.js &
//   playwright-cli open http://localhost:3140/dashboard/
//   playwright-cli run-code --filename=dashboard/e2e/metrics.e2e.js     (prints "metrics e2e ok" or throws)
// Body is a single async function of `page` (playwright-cli run-code contract).
async (page) => {
  const base = 'http://localhost:3140/dashboard';
  const ok = (cond, msg) => { if (!cond) throw new Error(`metrics e2e: ${msg}`); };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/`);
  await page.click('#metricsTabBtn');
  await page.waitForSelector('.mc-insight');
  ok(await page.getAttribute('#metricsTabBtn', 'aria-selected') === 'true', 'tab button selected');
  ok(page.url().endsWith('/dashboard/metrics'), `url is /metrics, got ${page.url()}`);
  ok((await page.locator('.mc-tile').count()) === 9, '9 headline tiles');
  ok((await page.locator('.mc-stage.is-bottleneck').count()) === 1, 'one bottleneck stage highlighted');
  await page.waitForSelector('.mc-svg');
  ok((await page.locator('.mc-chart .mc-svg').count()) >= 8, 'charts drawn');
  ok((await page.locator('.mc-chart table').count()) >= 8, 'every chart has a hidden table');
  ok((await page.locator('.mc-chart svg[role="img"][aria-label]').count()) >= 8, 'charts are labelled');

  // Range + project persist in the URL; Tasks facets keep their own params.
  await page.click('.mc-seg-btn[data-range="7d"]');
  await page.waitForFunction(() => location.search.includes('mrange=7d'));
  await page.selectOption('#mcProject', 'my-app');
  await page.waitForFunction(() => location.search.includes('mproject=my-app'));
  await page.reload();
  await page.waitForSelector('.mc-insight');
  ok(await page.getAttribute('.mc-seg-btn[data-range="7d"]', 'aria-pressed') === 'true', 'range restored from URL');
  ok(await page.inputValue('#mcProject') === 'my-app', 'project restored from URL');

  await page.waitForSelector('#metricsMain[aria-busy="false"]');
  // Sortable table: Enter on a header button flips aria-sort, focus stays on it.
  await page.focus('#mcRecentHost th:has-text("Stalls") button');
  await page.keyboard.press('Enter');
  const sortVal = await page.getAttribute('#mcRecentHost th:has-text("Stalls")', 'aria-sort');
  ok(sortVal === 'descending', `sorted by stalls desc, got ${sortVal}`);
  await page.keyboard.press('Space');
  ok(await page.getAttribute('#mcRecentHost th:has-text("Stalls")', 'aria-sort') === 'ascending', 'sorted by stalls asc');

  // Ticket link opens the ticket detail (fixtures know T-ids only; an unknown id toasts instead).
  await page.locator('.mc-link').first().focus();
  await page.keyboard.press('Enter');

  // Refresh data shows the busy state, then a note.
  await page.click('#mcRefresh');
  ok(await page.getAttribute('#mcRefresh', 'aria-busy') === 'true', 'refresh busy');
  await page.waitForSelector('.mc-note.ok');

  // Hotkey: Control+8 (Metrics is the last tab) from another tab.
  await page.click('#tasksTabBtn');
  await page.keyboard.press('Control+8');
  await page.waitForSelector('#metricsPanel.active');

  // Narrow viewport: no horizontal page scroll.
  await page.setViewportSize({ width: 420, height: 900 });
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= 421 && document.getElementById('metricsPanel').scrollWidth <= 421), 'no horizontal overflow at 420px');
  ok(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  return 'metrics e2e ok';
}
