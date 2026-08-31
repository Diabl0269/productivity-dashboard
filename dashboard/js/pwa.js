// pwa.js — Register service worker + optional Install button (Chrome/Edge).

import { showStatus } from './state.js';

let deferredPrompt = null;

function updateInstallUi() {
  const btn = document.getElementById('pwaInstallBtn');
  const desc = document.getElementById('pwaInstallDesc');
  if (!btn) return;

  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (standalone) {
    btn.hidden = true;
    if (desc) {
      desc.textContent = 'Running as an installed app. Shell assets work offline; tasks/memory still need the local server when online.';
    }
    return;
  }

  if (deferredPrompt) {
    btn.hidden = false;
    if (desc) {
      desc.textContent = 'Install opens the dashboard in its own window (like a native app). Capture and timers stay on this machine.';
    }
  } else {
    btn.hidden = true;
    if (desc) {
      desc.textContent = 'Install this dashboard like a desktop/phone app — own window, home-screen icon, offline shell. Chrome/Edge: menu → Install app. Safari (iOS): Share → Add to Home Screen. Requires http://localhost via node serve.js.';
    }
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    // Prefer updated SW when available
    reg.update?.().catch(() => {});
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

export function initPwa() {
  registerServiceWorker();

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallUi();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateInstallUi();
    showStatus('App installed');
  });

  const btn = document.getElementById('pwaInstallBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch { /* ignore */ }
      deferredPrompt = null;
      updateInstallUi();
    });
  }

  updateInstallUi();
}
