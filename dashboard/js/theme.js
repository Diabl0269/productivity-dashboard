// ===== THEME MANAGEMENT =====

export function applyTheme(theme) {
  const toggle = document.getElementById('themeToggle');
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (toggle) toggle.textContent = '🌙';
  } else if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    if (toggle) toggle.textContent = '☀️';
  } else {
    document.documentElement.removeAttribute('data-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (toggle) toggle.textContent = prefersDark ? '🌙' : '☀️';
  }
}

export function initTheme() {
  const toggle = document.getElementById('themeToggle');
  const stored = localStorage.getItem('theme');

  if (stored) {
    applyTheme(stored);
  } else {
    applyTheme('auto');
  }

  toggle.addEventListener('click', () => {
    const current = localStorage.getItem('theme');
    const isDark = current === 'dark' || (!current && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem('theme')) {
      applyTheme('auto');
    }
  });
}
