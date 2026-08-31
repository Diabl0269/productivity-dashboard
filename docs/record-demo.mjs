// Screencast script for README demo.gif — run via:
//   PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
//   playwright-cli run-code --filename docs/record-demo.mjs
// Target: ~22s wall-clock → readable GIF without heavy speedup.

async (page) => {
  const outPath = 'docs/demo-raw.webm';
  const W = 1280;
  const H = 720;

  await page.setViewportSize({ width: W, height: H });
  await page.goto('http://localhost:3000/dashboard/', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.getByRole('tab', { name: 'Tasks' }).click();
  await page.waitForSelector('.task-card', { timeout: 8000 });
  await page.waitForTimeout(300);

  await page.screencast.start({ path: outPath, size: { width: W, height: H } });

  await page.screencast.showChapter('Productivity Dashboard', {
    description: 'Task modal · hierarchy · colors',
    duration: 1400,
  });

  // Board with callout
  const boardCallout = await page.screencast.showOverlay(`
    <div style="position:absolute;top:72px;left:24px;padding:10px 14px;
      background:rgba(15,15,18,0.88);border:1px solid rgba(217,119,87,0.55);
      border-radius:10px;font:600 14px/1.35 system-ui,sans-serif;color:#f5f5f4;
      box-shadow:0 8px 24px rgba(0,0,0,0.35);max-width:300px;">
      Type badges · parent links · custom colors
    </div>
  `);
  await page.waitForTimeout(1600);
  await boardCallout.dispose();

  const hierarchyCard = page.locator('.task-card').filter({ hasText: 'Hierarchy on the board' }).first();
  await hierarchyCard.scrollIntoViewIfNeeded();
  const hc = await hierarchyCard.boundingBox();
  if (hc) {
    await page.screencast.showOverlay(`
      <div style="position:absolute;top:${hc.y - 4}px;left:${hc.x - 4}px;
        width:${hc.width + 8}px;height:${hc.height + 8}px;
        border:2px solid #F59E0B;border-radius:12px;
        box-shadow:0 0 0 4px rgba(245,158,11,0.25);"></div>
      <div style="position:absolute;top:${hc.y + hc.height + 8}px;left:${hc.x}px;
        padding:7px 11px;background:rgba(15,15,18,0.92);border-radius:8px;
        font:600 13px system-ui,sans-serif;color:#fbbf24;
        border:1px solid rgba(245,158,11,0.5);">
        Custom color · child of epic T1
      </div>
    `, { duration: 1500 });
  }

  // Task detail modal
  await page.screencast.showChapter('Task Detail Modal', {
    description: 'Type, parent, color & checklist',
    duration: 1100,
  });

  await hierarchyCard.click();
  await page.waitForSelector('#taskDetailOverlay.visible', { timeout: 5000 });
  await page.waitForTimeout(500);

  const modalCallout = await page.screencast.showOverlay(`
    <div style="position:absolute;top:56px;right:28px;padding:10px 14px;
      background:rgba(15,15,18,0.9);border:1px solid rgba(139,92,246,0.55);
      border-radius:10px;font:600 13px/1.4 system-ui,sans-serif;color:#e9e7ff;
      max-width:260px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
      Full task editor in one place
    </div>
  `);
  await page.waitForTimeout(1600);

  const parentLink = page.locator('#taskDetailOverlay .task-parent-link').first();
  if (await parentLink.count()) {
    const pl = await parentLink.boundingBox();
    if (pl) {
      await page.screencast.showOverlay(`
        <div style="position:absolute;top:${pl.y - 5}px;left:${pl.x - 5}px;
          width:${pl.width + 10}px;height:${pl.height + 10}px;
          border:2px solid #8B5CF6;border-radius:8px;"></div>
      `, { duration: 900 });
    }
    await parentLink.click();
    await page.waitForTimeout(1100);
  }
  await modalCallout.dispose();

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // Create with hierarchy
  await page.screencast.showChapter('Create with Hierarchy', {
    description: 'Parent + inherited color',
    duration: 1100,
  });

  await page.locator('button[data-add="todo"]').first().click();
  await page.waitForSelector('#taskCreateOverlay.visible', { timeout: 5000 });
  await page.waitForTimeout(300);

  const titleEl = page.locator('#tcTitle');
  await titleEl.click();
  await titleEl.fill('');
  await titleEl.pressSequentially('Nested under epic', { delay: 28 });
  await page.waitForTimeout(250);

  const parentSelect = page.locator('#taskCreateOverlay select[aria-label="Parent ticket"]').first();
  if (await parentSelect.count()) {
    try { await parentSelect.selectOption('T1'); } catch (_) {}
    await page.waitForTimeout(500);
  }

  await page.screencast.showOverlay(`
    <div style="position:absolute;top:64px;right:32px;padding:10px 14px;
      background:rgba(15,15,18,0.9);border:1px solid rgba(59,130,246,0.55);
      border-radius:10px;font:600 13px/1.4 system-ui,sans-serif;color:#dbeafe;
      max-width:240px;">
      Color inherits from parent
    </div>
  `, { duration: 1200 });

  await page.locator('#tcCreate').click();
  await page.waitForTimeout(700);
  if (await page.locator('#taskCreateOverlay.visible').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // Settings ticket types
  await page.screencast.showChapter('Ticket Types', {
    description: 'Epic → Task → Subtask colors',
    duration: 1100,
  });

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.waitForTimeout(700);

  const settingsBox = page.locator('#settingsTicketTypesList').first();
  const sb = await settingsBox.boundingBox();
  if (sb) {
    await page.screencast.showOverlay(`
      <div style="position:absolute;top:${sb.y - 8}px;left:${sb.x - 8}px;
        width:${Math.min(sb.width + 16, 720)}px;height:${Math.min(sb.height + 16, 320)}px;
        border:2px solid #8B5CF6;border-radius:14px;
        box-shadow:0 0 0 4px rgba(139,92,246,0.2);"></div>
    `, { duration: 1800 });
  }

  await page.getByRole('tab', { name: 'Tasks' }).click();
  await page.waitForTimeout(900);

  await page.screencast.showChapter('Local-first · Claude-ready', {
    description: 'Live sync with tasks.json',
    duration: 1300,
  });

  await page.screencast.stop();
}
