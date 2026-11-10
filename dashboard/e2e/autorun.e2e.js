// Overview Autorun card smoke test against the mock server.
//   PORT=3140 node dashboard/e2e/serve-mock.js &
//   playwright-cli open http://localhost:3140/dashboard/
//   playwright-cli run-code --filename=dashboard/e2e/autorun.e2e.js     (prints nothing, throws on failure)
// Body is a single async function of `page` (playwright-cli run-code contract).
async (page) => {
  const base = 'http://localhost:3140/dashboard';
  const ok = (cond, msg) => { if (!cond) throw new Error(`autorun e2e: ${msg}`); };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/`);
  await page.waitForSelector('#autorunWidget');
  await page.waitForFunction(() => document.querySelector('#autorunMaxRuns').value !== '');
  ok(await page.locator('#autorunOn').isChecked(), 'switch is on by default');
  ok((await page.inputValue('#autorunMaxRuns')) === '6', 'maxRuns default shown');
  ok((await page.getAttribute('#autorunMaxRuns', 'placeholder')) === '6', 'default shown as placeholder');
  ok((await page.locator('#autorunWidget label.autorun-field').count()) === 6, 'six labelled fields');

  await page.fill('#autorunMaxTotal', '');
  await page.fill('#autorunPaceStop', '0.7');
  await page.click('#autorunSave');
  await page.waitForFunction(() => document.querySelector('#autorunStatus').textContent === 'Saved');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#autorunPaceStop').value !== '');
  ok((await page.inputValue('#autorunPaceStop')) === '0.7', 'paceStop persisted');
  ok((await page.inputValue('#autorunMaxTotal')) === '', 'blank maxTotal (no manual cap) persisted');

  await page.fill('#autorunMaxRuns', '0');
  await page.click('#autorunSave');
  ok((await page.getAttribute('#autorunMaxRuns', 'aria-invalid')) === 'true', 'bad number flagged');
  ok((await page.innerText('#autorunStatus')).includes('maxRuns'), 'error shown');

  await page.reload();
  await page.waitForFunction(() => document.querySelector('#autorunMaxRuns').value !== '');
  await page.uncheck('#autorunOn');
  await page.click('#autorunSave');
  await page.waitForFunction(() => document.querySelector('#autorunStatus').textContent === 'Saved');
  await page.reload();
  await page.waitForSelector('#autorunWidget');
  await page.waitForFunction(() => document.querySelector('#autorunMaxRuns').value !== '');
  ok(!(await page.locator('#autorunOn').isChecked()), 'kill switch persisted');
  ok(errors.length === 0, `page errors: ${errors.join('; ')}`);
}
