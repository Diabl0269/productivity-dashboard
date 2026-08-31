// ===== THEME MANAGEMENT =====

const SUN_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="5"/>
  <line x1="12" y1="1" x2="12" y2="3"/>
  <line x1="12" y1="21" x2="12" y2="23"/>
  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
  <line x1="1" y1="12" x2="3" y2="12"/>
  <line x1="21" y1="12" x2="23" y2="12"/>
  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
</svg>`;

const MOON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
</svg>`;

const MONITOR_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="2" y="3" width="20" height="14" rx="2"/>
  <line x1="8" y1="21" x2="16" y2="21"/>
  <line x1="12" y1="17" x2="12" y2="21"/>
</svg>`;

const VALID_MODES = ['light', 'dark', 'system'];
const CYCLE_ORDER = ['light', 'dark', 'system'];

// Resolve a mode to a concrete 'light' or 'dark' value
function resolveTheme(mode) {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function applyTheme(mode) {
  const toggle = document.getElementById('themeToggle');
  const resolved = resolveTheme(mode);

  document.documentElement.setAttribute('data-theme', resolved);

  if (toggle) {
    if (mode === 'light') {
      toggle.innerHTML = SUN_SVG;
      toggle.setAttribute('aria-label', 'Theme: Light (click to cycle)');
      toggle.setAttribute('title', 'Theme: Light (click to cycle)');
    } else if (mode === 'dark') {
      toggle.innerHTML = MOON_SVG;
      toggle.setAttribute('aria-label', 'Theme: Dark (click to cycle)');
      toggle.setAttribute('title', 'Theme: Dark (click to cycle)');
    } else {
      // system
      toggle.innerHTML = MONITOR_SVG;
      toggle.setAttribute('aria-label', 'Theme: System (click to cycle)');
      toggle.setAttribute('title', 'Theme: System (click to cycle)');
    }
    toggle.removeAttribute('aria-pressed');
  }
}

export function initTheme() {
  const toggle = document.getElementById('themeToggle');
  const stored = localStorage.getItem('theme');
  const mode = VALID_MODES.includes(stored) ? stored : 'dark';

  // Ensure localStorage reflects the validated mode
  localStorage.setItem('theme', mode);
  applyTheme(mode);

  toggle.addEventListener('click', () => {
    const current = localStorage.getItem('theme');
    const idx = CYCLE_ORDER.indexOf(VALID_MODES.includes(current) ? current : 'dark');
    const next = CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
    localStorage.setItem('theme', next);
    applyTheme(next);
  });

  // Re-apply when OS preference changes and mode is 'system'
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentMode = localStorage.getItem('theme');
    if (currentMode === 'system') {
      applyTheme('system');
    }
  });
}
