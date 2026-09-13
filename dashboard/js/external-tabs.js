// external-tabs.js — renders user-configured tabs (config.json `externalTabs`) that
// point at an external URL, either embedded in the main area (mode: "iframe") or
// opened in a new browser tab (mode: "link"). Generic and product-agnostic: config
// supplies label/url/mode only, nothing here assumes what the URL serves.

import { registerExternalTab, switchMainTab } from './state.js';
import { registerRoutableTab } from './routing.js';
import { isValidEntry, slugify } from './external-tabs-validate.js';

/**
 * Read `window.dashboardConfig.externalTabs`, validate each entry, and wire up a tab
 * button per entry (plus an iframe panel for "iframe"-mode entries). Malformed entries
 * are skipped. No-op when the config key is absent or empty.
 */
export function initExternalTabs() {
  const raw = (window.dashboardConfig && window.dashboardConfig.externalTabs) || [];
  if (!Array.isArray(raw) || raw.length === 0) return;

  const tabToggle = document.getElementById('mainTabToggle');
  if (!tabToggle) return;

  raw.forEach((entry, index) => {
    if (!isValidEntry(entry)) {
      console.warn('Skipping malformed externalTabs entry:', entry);
      return;
    }

    const id = slugify(entry.label, index);
    const btn = document.createElement('button');
    btn.id = `${id}TabBtn`;
    btn.textContent = entry.label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.classList.add('external-tab-btn');

    if (entry.mode === 'link') {
      btn.classList.add('external-tab-btn-link');
      btn.title = `Opens ${entry.url} in a new tab`;
      btn.addEventListener('click', () => {
        window.open(entry.url, '_blank', 'noopener,noreferrer');
      });
      tabToggle.appendChild(btn);
      return;
    }

    // mode === 'iframe': embed the URL in a panel that participates in tab
    // switching and deep-link routing just like the built-in tabs.
    const panelId = `${id}Panel`;
    btn.setAttribute('aria-controls', panelId);
    tabToggle.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'tab-panel external-tab-panel';
    panel.id = panelId;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', btn.id);

    const iframe = document.createElement('iframe');
    iframe.className = 'external-tab-iframe';
    iframe.src = entry.url;
    iframe.title = entry.label;
    panel.appendChild(iframe);

    document.body.appendChild(panel);

    registerExternalTab(id, { btn, panel });
    registerRoutableTab(id);

    btn.addEventListener('click', () => switchMainTab(id));
  });
}
