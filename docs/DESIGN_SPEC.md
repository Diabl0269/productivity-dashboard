# Productivity Dashboard — Final Design Spec

**Base direction:** Refined Editorial Minimalism (Direction 1)
**Grafted:** D3 glassy sticky header, D3 fade-in tab animation, D3 elevation naming, D3 sort-button HTML extraction, D2 warm-umber surfaces, D2 Georgia h1, D2 sage-green progress bar, D2 max-height add-note transition, D1 box-shadow focus ring, D1 priority legend, D1 semantic progress-fill token

---

## 0. Design Principles

**Warm near-monochrome layered surfaces.** Depth comes from a five-step elevation ladder (surface-0 through surface-4) with warm-umber undertones — not gradients or decorative fills. Cards float on the page through hairline borders and single-layer shadows at low opacity.

**Crisp confident type scale with real size contrast.** Five levels. Georgia for the app title only — one serif moment, maximum personality return, zero network cost. Everything else is system-ui sans-serif.

**Accent reserved for true interaction.** Terracotta (#CF6A43 dark / #C05A30 light) appears only on: focused inputs, primary buttons, active tab underlines, priority HIGH dots, and inline links. Stat numbers, column headers, section labels, and decorative elements do not use it.

**Dark is default.** The dark palette is primary. Light is the secondary theme. Both are excellent.

**Quiet precision.** Transitions at 120ms (hover) and 200ms (structural). No bounce, no blur transitions. Box-shadow focus rings — never outline — to avoid layout shifts on elements with complex border-radius.

---

## 1. Design Tokens — Full CSS Custom Property Set

### 1.1 Color — Dark Theme (Default `:root`)

The backgrounds carry a warm umber undertone (10-15% warmer than pure charcoal) making them immediately distinctive from generic dark SaaS.

```css
:root {
  /* ── Surfaces (elevation ladder, darkest → lightest) ── */
  --surface-0: #141210;   /* page background — warm near-black          */
  --surface-1: #1c1917;   /* header, sidebar — warm charcoal            */
  --surface-2: #252220;   /* column backgrounds, widget cards           */
  --surface-3: #2e2b28;   /* task cards, memory cards, list items       */
  --surface-4: #3a3734;   /* hover states on surface-3, dropdowns       */

  /* Legacy aliases kept for JS coupling compatibility */
  --bg-base:       var(--surface-0);
  --bg-raised:     var(--surface-2);
  --bg-overlay:    var(--surface-3);
  --bg-hover:      var(--surface-4);

  /* ── Text — four semantic levels ── */
  --text-primary:   #f0ede8;   /* warm off-white                        */
  --text-secondary: #a8a49e;   /* warm stone                            */
  --text-tertiary:  #6e6a65;   /* muted hints, placeholders             */
  --text-disabled:  #3e3c3a;   /* disabled controls                     */

  /* ── Borders ── */
  --border:        #3a3734;   /* card edges, separators                 */
  --border-subtle: #2a2724;   /* inner dividers                         */

  /* ── Accent — terracotta, reserved for interaction ── */
  --accent:        #CF6A43;
  --accent-hover:  #E07A50;
  --accent-muted:  rgba(207, 106, 67, 0.12);

  /* ── Semantic Status Colors ── */
  --status-todo:        #4A9EFF;
  --status-inprogress:  #CF6A43;   /* = accent — active work */
  --status-done:        #5DAF7A;   /* sage green — accomplished */
  --status-backlog:     #6e6a65;   /* muted — parked */
  --status-blocked:     #E05C5C;   /* red — attention */

  /* ── Priority Colors (distinct, fully variable) ── */
  --priority-low:    #4A9EFF;   /* blue — calm */
  --priority-medium: #C99A30;   /* amber — attention */
  --priority-high:   #E05C5C;   /* red — urgent */

  /* ── Progress Bar ── */
  --progress-fill:  #5DAF7A;   /* sage green — accomplishment-coded */

  /* ── Deadline Urgency ── */
  --urgency-today:     #E05C5C;
  --urgency-soon:      #C99A30;
  --urgency-today-bg:  rgba(224, 92, 92, 0.08);
  --urgency-soon-bg:   rgba(201, 154, 48, 0.08);

  /* ── Workshop Status ── */
  --workshop-planned:       var(--text-tertiary);
  --workshop-inprogress:    #C99A30;
  --workshop-done:          #5DAF7A;
  --workshop-planned-bg:    rgba(110, 106, 101, 0.15);
  --workshop-inprogress-bg: rgba(201, 154, 48, 0.12);
  --workshop-done-bg:       rgba(93, 175, 122, 0.12);

  /* ── Type Badge Palette (Global Memory) ── */
  --badge-user-bg:       rgba(74, 158, 255, 0.12);  --badge-user-fg:      #4A9EFF;
  --badge-feedback-bg:   rgba(201, 154, 48, 0.12);  --badge-feedback-fg:  #C99A30;
  --badge-project-bg:    rgba(93, 175, 122, 0.12);  --badge-project-fg:   #5DAF7A;
  --badge-reference-bg:  rgba(160, 100, 240, 0.12); --badge-reference-fg: #A064F0;
  --badge-unknown-bg:    var(--surface-4);           --badge-unknown-fg:   var(--text-tertiary);

  /* ── Shadows ── */
  --shadow-sm:   0 1px 3px rgba(0, 0, 0, 0.32);
  --shadow-md:   0 4px 16px rgba(0, 0, 0, 0.40);
  --shadow-lg:   0 16px 48px rgba(0, 0, 0, 0.56);

  /* ── Drag / Drop ── */
  --drag-over-bg: rgba(207, 106, 67, 0.07);

  /* ── Modal ── */
  --modal-overlay-bg: rgba(0, 0, 0, 0.68);

  /* ── Glassy Header ── */
  --header-bg:      rgba(20, 18, 16, 0.88);
  --header-border:  rgba(255, 255, 255, 0.06);

  /* ── Status Bar ── */
  --status-bar-bg:  var(--surface-4);
  --status-bar-fg:  var(--text-primary);

  /* ── Focus Ring — box-shadow, never outline ── */
  --focus-ring: 0 0 0 2px var(--accent);
}
```

### 1.2 Light Theme Override

```css
[data-theme="light"] {
  --surface-0: #f5f1ea;   /* cream paper */
  --surface-1: #efe9de;   /* parchment */
  --surface-2: #fdfbf7;   /* near-white warm */
  --surface-3: #ffffff;
  --surface-4: #ede8e0;

  --bg-base:    var(--surface-0);
  --bg-raised:  var(--surface-2);
  --bg-overlay: var(--surface-3);
  --bg-hover:   var(--surface-4);

  --text-primary:   #1a1713;
  --text-secondary: #5c5249;
  --text-tertiary:  #8c8278;
  --text-disabled:  #c8c4be;

  --border:        #ddd5c8;
  --border-subtle: #e8e2d8;

  --accent:       #C05A30;
  --accent-hover: #A84A22;
  --accent-muted: rgba(192, 90, 48, 0.10);

  --status-todo:       #1d78d4;
  --status-inprogress: #C05A30;
  --status-done:       #1e8a58;
  --status-backlog:    #8c8278;
  --status-blocked:    #c43030;

  --priority-low:    #1d78d4;
  --priority-medium: #a07820;
  --priority-high:   #c43030;

  --progress-fill:  #1e8a58;

  --urgency-today:     #c43030;
  --urgency-soon:      #a07820;
  --urgency-today-bg:  rgba(196, 48, 48, 0.06);
  --urgency-soon-bg:   rgba(160, 120, 32, 0.06);

  --workshop-planned:       var(--text-tertiary);
  --workshop-inprogress:    #a07820;
  --workshop-done:          #1e8a58;
  --workshop-planned-bg:    rgba(140, 130, 120, 0.12);
  --workshop-inprogress-bg: rgba(160, 120, 32, 0.08);
  --workshop-done-bg:       rgba(30, 138, 88, 0.08);

  --badge-user-bg:       rgba(29, 120, 212, 0.08);  --badge-user-fg:      #1d78d4;
  --badge-feedback-bg:   rgba(160, 120, 32, 0.08);  --badge-feedback-fg:  #a07820;
  --badge-project-bg:    rgba(30, 138, 88, 0.08);   --badge-project-fg:   #1e8a58;
  --badge-reference-bg:  rgba(120, 60, 200, 0.08);  --badge-reference-fg: #7830c8;
  --badge-unknown-bg:    var(--surface-4);           --badge-unknown-fg:   var(--text-tertiary);

  --shadow-sm:   0 1px 3px rgba(0, 0, 0, 0.07);
  --shadow-md:   0 4px 16px rgba(0, 0, 0, 0.10);
  --shadow-lg:   0 16px 48px rgba(0, 0, 0, 0.16);

  --drag-over-bg:     rgba(192, 90, 48, 0.05);
  --modal-overlay-bg: rgba(0, 0, 0, 0.40);

  --header-bg:      rgba(239, 233, 222, 0.92);
  --header-border:  rgba(0, 0, 0, 0.07);

  --status-bar-bg:  var(--surface-4);
  --status-bar-fg:  var(--text-primary);

  --focus-ring: 0 0 0 2px var(--accent);
}
```

### 1.3 System-Dark Auto-Detect

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* :root is already dark — this block is a no-op but kept for
       explicit documentation of the dark-default intent */
  }
}
```

### 1.4 Spacing Scale

```css
:root {
  --space-1:  4px;
  --space-2:  8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;
}
```

### 1.5 Radius Scale

```css
:root {
  --radius-sm:   4px;    /* badges, chips, date pills */
  --radius-md:   8px;    /* cards, buttons, inputs */
  --radius-lg:  12px;    /* major containers, modals, panels */
  --radius-xl:  16px;    /* header, overlay panels */
  --radius-pill: 9999px; /* status pills, count badges */
}
```

### 1.6 Type Scale

```css
:root {
  /* Families */
  --font-sans:  -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-serif: Georgia, "Times New Roman", serif;  /* app title only */
  --font-mono:  ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;

  /* Sizes */
  --text-xs:  11px;   /* badges, counts, keyboard hints, dates */
  --text-sm:  13px;   /* metadata, notes, captions, nav labels */
  --text-md:  15px;   /* body text, task titles, widget body */
  --text-lg:  17px;   /* card titles, modal h3, column names */
  --text-xl:  22px;   /* sprint name, section headings */
  --text-2xl: 28px;   /* stat numbers — largest type on the page */
  --text-2xs: 10px;   /* keyboard shortcut badge */

  /* Checkbox size drives indentation calculations */
  --checkbox-size:   18px;
  --checkbox-indent: calc(var(--checkbox-size) + 10px); /* 28px */

  /* Weights */
  --weight-regular:  400;
  --weight-medium:   500;
  --weight-semibold: 600;

  /* Letter-spacing */
  --tracking-tight:  -0.018em;  /* headings */
  --tracking-normal:  0em;
  --tracking-wide:    0.04em;   /* only for sidebar section labels */

  /* Line-heights */
  --leading-tight:   1.3;
  --leading-normal:  1.5;
  --leading-relaxed: 1.65;
}
```

### 1.7 Transitions

```css
:root {
  --transition-fast:   120ms ease;
  --transition-normal: 200ms ease;
  --transition-slow:   300ms ease;
}
```

---

## 2. Typography System

**Font:** `var(--font-sans)` everywhere. Exception: `h1` (app title) uses `var(--font-serif)` — Georgia 22px/600 — the single serif moment, maximum personality at zero network cost. `var(--font-mono)` only for code blocks, raw file paths, modal textarea.

**No ALL-CAPS labels anywhere.** Column headers, widget h3s, and stat labels use title-case or sentence-case at appropriate weight. The only approved uppercase: sidebar nav category labels at `var(--text-xs)` with `letter-spacing: var(--tracking-wide)` — used sparingly as structural group markers.

**No network font loading.** The `<link>` tags for Google Fonts Inter in `index.html` (lines 8-10) must be removed. The system-ui stack delivers Inter on Apple devices, Segoe UI on Windows — both excellent, zero network cost, offline capable.

| Level | Family | Size | Weight | Line-height | Tracking | Usage |
|---|---|---|---|---|---|---|
| App title | `--font-serif` | `--text-xl` 22px | 600 | 1.2 | `--tracking-tight` | `h1` only |
| Section heading | `--font-sans` | `--text-xl` 22px | 600 | `--leading-tight` | `--tracking-tight` | Sprint name, stat section title |
| Stat number | `--font-sans` | `--text-2xl` 28px | 700 | 1.0 | `--tracking-tight` | Overview summary stats — largest type on the page |
| Title | `--font-sans` | `--text-lg` 17px | 600 | `--leading-tight` | 0 | Column headers, widget h3, modal h3 |
| Body | `--font-sans` | `--text-md` 15px | 400 | `--leading-normal` | 0 | Task titles on board, body prose |
| Caption | `--font-sans` | `--text-sm` 13px | 400 | `--leading-normal` | 0 | Notes, dates, subtasks, nav labels |
| Micro | `--font-sans` | `--text-xs` 11px | 500 | 1.3 | 0 | Badges, counts, shortcut hints |

---

## 3. Header / Navigation Shell

### 3.1 Glassy Sticky Header

```css
header {
  background: var(--header-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--header-border);
  position: sticky;
  top: 0;
  z-index: 50;
  padding: var(--space-2) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex-shrink: 0;
}
```

`body` padding becomes `0` at root; each `.tab-panel` handles its own `padding: var(--space-5) var(--space-6)`.

### 3.2 App Title

```css
h1 {
  font-family: var(--font-serif);
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
  line-height: 1.2;
}
```

### 3.3 File Path Subtitle

```css
.file-path {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-top: 1px;
}
/* Collapse when empty — JS adds/removes .has-path on .header-left */
.header-left:not(.has-path) .file-path {
  display: none;
}
```

**JS change in `state.js`:** In `switchMainTab()` (and wherever `filePath.textContent` is set), toggle `headerLeft.classList.toggle('has-path', !!filePath.textContent)`.

### 3.4 Logo SVG

In `index.html`, replace all hardcoded fill attributes on the logo `<path>` elements with `style="fill: var(--surface-3)"` / `style="fill: var(--accent)"` / `style="fill: var(--text-tertiary)"`. Remove the brittle attribute-selector block from `misc.css`. Remove `style="margin-right: 12px"` inline style; move gap to `.header-left { gap: var(--space-2) }` in CSS.

### 3.5 Navigation Tabs (`#mainTabToggle`)

```css
#mainTabToggle {
  display: flex;
  align-items: center;
  gap: 0;
  border-bottom: none;
  padding: var(--space-1) 0 0;
}

/* The .view-toggle pill container wraps the four main tabs */
.view-toggle {
  display: flex;
  gap: var(--space-1);
  background: var(--surface-2);
  padding: 3px;
  border-radius: var(--radius-lg);
}

.view-toggle button {
  background: transparent;
  border: none;
  padding: 6px 14px;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-tertiary);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
  white-space: nowrap;
  font-family: var(--font-sans);
}

.view-toggle button:hover {
  color: var(--text-primary);
  background: var(--surface-4);
}

.view-toggle button.active {
  background: var(--surface-4);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.view-toggle button:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
```

**ARIA (JS change in `state.js` + `index.html`):** Add `role="tablist"` to `#mainTabToggle`. Add `role="tab"`, `aria-selected="true/false"`, `aria-controls="<panelId>"` to each button. Tab panels get `role="tabpanel"` and `aria-labelledby`. `switchMainTab()` must toggle `aria-selected` alongside `.active`.

### 3.6 Sort Priority Button — Extracted from .view-toggle

**HTML change in `index.html`:** Move `#sortPriorityBtn` outside `#taskViewToggle` as a sibling in `.header-nav`. It must no longer inherit `.view-toggle button` styles.

```css
.sort-action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 4px 10px;
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
  font-family: var(--font-sans);
}
.sort-action-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-muted);
}
.sort-action-btn:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
```

**JS change in `state.js`:** The `style.display` toggle for `sortPriorityBtn` currently ties to the `#taskViewToggle` container. After the HTML extraction, manage the button's visibility independently with the same trigger (Tasks tab active). Use `btn.classList.toggle('hidden', !show)` with CSS `.hidden { display: none }` rather than `style.display`.

### 3.7 Theme Toggle

Replace emoji with SVG. In `index.html`:

```html
<button id="themeToggle" aria-label="Switch to light mode" aria-pressed="false" title="Toggle theme">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <!-- Sun rays (shown in dark mode — clicking switches to light) -->
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
</button>
```

```css
#themeToggle {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}
#themeToggle:hover {
  background: var(--surface-4);
  color: var(--text-primary);
  border-color: var(--border);
}
#themeToggle:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
```

**JS change in `theme.js`:**
1. `initTheme()`: when no stored preference, `localStorage.setItem('theme', 'dark')` and call `applyTheme('dark')` — dark is the explicit default.
2. `applyTheme()`: update `toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')` and `toggle.setAttribute('aria-pressed', theme === 'dark' ? 'false' : 'true')`.
3. Replace `toggle.textContent = '🌙'/'☀️'` with SVG innerHTML swap — maintain two SVG strings (sun for dark mode, moon crescent for light mode) and swap on `applyTheme()`.

### 3.8 Action Buttons

```css
/* Save button */
button#saveBtn, button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
  padding: var(--space-2) var(--space-4);
  height: 34px;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  border-radius: var(--radius-md);
}
button#saveBtn:hover, button.primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
button#saveBtn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Secondary buttons */
button#openTaskBtn, button#openMemoryBtn {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  height: 34px;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  border-radius: var(--radius-md);
}
button#openTaskBtn:hover, button#openMemoryBtn:hover {
  background: var(--surface-4);
}
```

### 3.9 Unified Search

```css
.unified-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  min-width: 180px;
  max-width: 300px;
  flex: 1;
  margin-left: auto;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  height: 34px;
  box-sizing: border-box;
}
.unified-search:focus-within {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
.unified-search input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  outline: none;
  min-width: 0;
}
.unified-search input::placeholder {
  color: var(--text-tertiary);
}
.unified-search-shortcut {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  background: var(--surface-0);
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-family: var(--font-sans);
  letter-spacing: 0.03em;
  flex-shrink: 0;
  pointer-events: none;
}

/* Hide ⌘F on mobile — keyboard shortcut is meaningless there */
@media (max-width: 640px) {
  .unified-search-shortcut { display: none; }
}
```

### 3.10 Tab Panel Transitions

Using `@keyframes fade-in` triggered on `.active` — works with the existing JS `display:none`/`display:flex` toggle without requiring the fragile `position:absolute` approach:

```css
.tab-panel {
  display: none;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}
.tab-panel.active {
  display: flex;
  animation: tab-fade-in var(--transition-fast);
}
@keyframes tab-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

No JS change required for the transition itself.

---

## 4. Overview Tab

### 4.1 Grid

```css
.tab-panel#overviewPanel {
  padding: var(--space-5) var(--space-6);
}

.overview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-5);
  max-width: 1120px;
}

@media (max-width: 900px) {
  .overview-grid { grid-template-columns: 1fr; }
}
```

### 4.2 Widget Card Shell

```css
.widget-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
}

.widget-card h3 {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  margin-bottom: var(--space-4);
  letter-spacing: 0;
  text-transform: none;  /* Remove ALL-CAPS — title-case only */
}
```

### 4.3 Sprint Info Widget

```css
.sprint-name {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
  margin-bottom: var(--space-1);
}

.sprint-days {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: var(--space-3);
}

.progress-bar {
  height: 6px;
  background: var(--surface-4);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--progress-fill);  /* Sage green — accomplishment-coded, not danger */
  border-radius: var(--radius-pill);
  transition: width var(--transition-slow);
  min-width: 2px;  /* Always show a sliver at 0% */
}

.progress-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  text-align: right;
  display: block;
  margin-top: var(--space-1);
}
```

**JS change in `overview.js`:** After setting `progressFill.style.width`, emit `progressLabel.textContent = Math.round(pct) + '%'` on a sibling `<span class="progress-label">`.

### 4.4 Task Summary Widget

```css
.task-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
}

.summary-stat {
  text-align: center;
  padding: var(--space-3) var(--space-2);
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast), box-shadow var(--transition-fast);
}
.summary-stat:hover {
  background: var(--surface-4);
  box-shadow: var(--shadow-sm);
}
.summary-stat:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}

/* Stat numbers are 28px/700 — the largest type on the overview page */
.stat-number {
  font-size: var(--text-2xl);
  font-weight: 700;
  line-height: 1;
  margin-bottom: var(--space-1);
}

.stat-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-tertiary);
  text-transform: none;  /* Remove uppercase */
  letter-spacing: 0;
}

/* Semantic color per stat — NOT all accent */
#statInProgress .stat-number { color: var(--status-inprogress); }
#statTodo       .stat-number { color: var(--text-secondary); }
#statDone       .stat-number { color: var(--status-done); }
#statBlocked    .stat-number { color: var(--status-blocked); }
```

**JS change in `overview.js`:** Add `role="button"` + `tabindex="0"` + `aria-label="Show N in-progress tasks"` to each `.summary-stat`. (The existing `id` attributes `statInProgress` etc. drive the CSS without JS changes.)

### 4.5 Quick Links Widget

```css
.quick-links-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.quick-link {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 9px var(--space-3);
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  text-decoration: none;
  font-size: var(--text-sm);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.quick-link:hover {
  background: var(--surface-4);
  border-color: var(--border);
  /* No translateX — it reads as fidgety in a daily-use tool */
}
.quick-link:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
.quick-link-icon {
  font-size: var(--text-md);
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}

.quick-links-empty {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  text-align: center;
  padding: var(--space-7) var(--space-4);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
}
```

### 4.6 1:1 Topics Widget

```css
.topics-empty {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  text-align: center;
  padding: var(--space-7) var(--space-4);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-3);
}

.topic-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  margin-bottom: var(--space-2);
}

.topic-delete:hover { color: var(--status-blocked); }

.topic-input {
  flex: 1;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.topic-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
```

### 4.7 Upcoming Deadlines Widget

All colors come from semantic tokens — no hardcoded hex.

```css
.deadline-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  font-size: var(--text-sm);
  margin-bottom: var(--space-2);
}

.deadline-item.deadline-today {
  border-left: 3px solid var(--urgency-today);
  background: var(--urgency-today-bg);
}

.deadline-item.deadline-soon {
  border-left: 3px solid var(--urgency-soon);
  background: var(--urgency-soon-bg);
}

.deadline-badge {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  white-space: nowrap;
}

.deadline-today .deadline-badge {
  background: rgba(224, 92, 92, 0.15);
  color: var(--urgency-today);
}
.deadline-soon .deadline-badge {
  background: rgba(201, 154, 48, 0.15);
  color: var(--urgency-soon);
}
```

**JS change in `overview.js`:** Remove all hardcoded `#ef4444` / `#f59e0b` string assignments. Use `el.classList.add('deadline-today')` / `'deadline-soon'` class additions only. Set `item.title = task.title` for overflow tooltip.

### 4.8 Workshops Widget

```css
.workshop-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-2);
}

.ws-status--planned    { background: var(--workshop-planned-bg);    color: var(--workshop-planned); }
.ws-status--inprogress { background: var(--workshop-inprogress-bg); color: var(--workshop-inprogress); }
.ws-status--done       { background: var(--workshop-done-bg);       color: var(--workshop-done); }

.workshop-status-select {
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  cursor: pointer;
  font-family: var(--font-sans);
  appearance: none;
  -webkit-appearance: none;
}
.workshop-status-select:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
```

**JS change in `overview.js`:** Replace `select.style.background = '#f59e0b22'` and similar inline style hex assignments with class assignments: `select.className = 'workshop-status-select ws-status--' + statusKey` where `statusKey` is `'planned'|'inprogress'|'done'`.

---

## 5. Tasks Board

### 5.1 Board Container

```css
.board {
  display: flex;
  gap: var(--space-5);
  overflow-x: auto;
  overflow-y: hidden;
  padding: var(--space-5) var(--space-6) var(--space-6);
  flex: 1;
  min-height: 0;
  align-items: flex-start;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.board::-webkit-scrollbar { height: 6px; }
.board::-webkit-scrollbar-track { background: transparent; }
.board::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: var(--radius-pill);
}
.board::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }
```

### 5.2 Priority Legend

Inject once above `.board` — solves "unexplained priority dots" without per-card cost:

```html
<!-- Injected once by tasks-main.js above .board -->
<div class="priority-legend" aria-label="Priority colour key">
  <span class="priority-dot priority-low" aria-hidden="true"></span><span>Low</span>
  <span class="priority-dot priority-medium" aria-hidden="true"></span><span>Medium</span>
  <span class="priority-dot priority-high" aria-hidden="true"></span><span>High</span>
</div>
```

```css
.priority-legend {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-6) var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
.priority-legend .priority-dot {
  pointer-events: none;
  cursor: default;
}
```

**JS change in `tasks-main.js`:** Inject the priority legend div once before `.board`.

### 5.3 Columns

```css
.column {
  flex: 0 0 auto;
  width: clamp(300px, 22vw, 360px);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 160px);
  box-shadow: var(--shadow-sm);
}

/* Column identity stripe — set via --col-color CSS custom property from JS */
.column-header {
  border-top: 3px solid var(--col-color, var(--border));
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}
```

**JS change in `tasks-board.js`:** In `createColumn()`, set `col.style.setProperty('--col-color', colorForSection(id))`. Mapping:
- `in-progress` / `in progress` → `var(--status-inprogress)`
- `done` / `completed` → `var(--status-done)`
- `todo` / `to do` → `var(--status-todo)`
- `backlog` → `var(--status-backlog)`
- `archive` → `var(--text-tertiary)`
- default (unknown name) → `var(--border)` — graceful fallback, never wrong semantic

### 5.4 Column Header

```css
.column-header {
  padding: var(--space-3) var(--space-4);
  cursor: grab;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.column-header:active { cursor: grabbing; }

.column-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-tight);
  text-transform: none;  /* No uppercase */
  cursor: text;
  transition: color var(--transition-fast);
}
.column-title:hover {
  color: var(--accent);
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

.count {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-tertiary);
  background: var(--surface-3);
  border: 1px solid var(--border);
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
}
```

### 5.5 Task Card

```css
.task-card {
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-2);
  cursor: grab;
  box-shadow: var(--shadow-sm);
  position: relative;
  transition: border-color var(--transition-fast),
              box-shadow var(--transition-fast),
              transform var(--transition-fast);
  overflow: hidden;
}
.task-card:hover {
  background: var(--surface-4);
  border-color: var(--border);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.task-card:active { cursor: grabbing; }
.task-card.dragging {
  transform: rotate(1.5deg) scale(1.02);
  opacity: 0.55;
  box-shadow: var(--shadow-lg);
}

.card-title {
  font-size: var(--text-md);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  line-height: var(--leading-normal);
  overflow-wrap: break-word;
}

.card-note {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-top: var(--space-1);
  line-height: var(--leading-relaxed);
  overflow-wrap: break-word;
  margin-left: var(--checkbox-indent);  /* 28px — replaces hardcoded 30px */
}

.card-subtasks {
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-left: var(--checkbox-indent);
}
```

**JS change in `tasks-board.js`:** Replace `style.marginLeft = '30px'` on card-note and card-subtasks wrapper divs with `className` assignment; CSS `var(--checkbox-indent)` drives it.

### 5.6 Priority Dots

```css
.priority-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  cursor: pointer;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
.priority-dot:hover {
  transform: scale(1.5);
  box-shadow: 0 0 0 3px var(--accent-muted);
}
.priority-dot:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}

/* Replace the overloaded var(--accent) fallback with dedicated variables */
.priority-low    { background: var(--priority-low); }
.priority-medium { background: var(--priority-medium); }
.priority-high   { background: var(--priority-high); }
```

**JS change in `tasks-board.js` and `tasks-list.js`:** Add `role="button"`, `tabindex="0"`, `aria-label="Priority: low — click to cycle"` to priority dot spans. Remove any `style` attribute setting color. Set `dot.title = 'Priority: ' + priority + ' — click to cycle'`.

### 5.7 Checkboxes

```css
.checkbox {
  width: var(--checkbox-size);
  height: var(--checkbox-size);
  min-width: var(--checkbox-size);
  min-height: var(--checkbox-size);
  flex-shrink: 0;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast);
  background: var(--surface-3);
  position: relative;
}
.checkbox:hover { border-color: var(--accent); }
.checkbox.checked {
  background: var(--accent);
  border-color: var(--accent);
}
.checkbox.checked::after {
  content: '';
  width: 5px;
  height: 9px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-bottom: 2px;
}
.checkbox:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
```

**JS change in `tasks-board.js` and `tasks-list.js`:** Add `role="checkbox"`, `aria-checked="true/false"`, `tabindex="0"` to checkbox spans. Add keydown handler for `Enter`/`Space` on focused checkbox.

### 5.8 Delete Button

```css
.delete-btn {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity var(--transition-fast), visibility var(--transition-fast);
  background: var(--surface-4);
  color: var(--text-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  cursor: pointer;
}
.task-card:hover .delete-btn {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
.delete-btn:hover {
  color: var(--status-blocked);
  border-color: var(--status-blocked);
}
.delete-btn:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
```

**JS change:** Add `aria-label="Delete task"` to delete buttons.

### 5.9 Task ID and Date Badges

```css
.task-id {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-tertiary);
  background: var(--surface-4);
  border: 1px solid var(--border-subtle);
  padding: 1px var(--space-1);
  border-radius: var(--radius-sm);
  /* Remove stacking opacity:0.7 — token colors handle muting */
}

.date-badge {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: var(--surface-4);
  border: 1px solid var(--border-subtle);
  padding: 1px 7px;
  border-radius: var(--radius-sm);
  margin-top: var(--space-1);
  display: inline-block;
  white-space: nowrap;
}
```

### 5.10 Inline Edit Inputs (JS-generated)

**Replace all `style.cssText` with class assignments in `tasks-board.js`.**

```css
.inline-edit-input,
.inline-edit-textarea {
  background: var(--surface-3);
  border: 2px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-md);
  font-family: var(--font-sans);
  color: var(--text-primary);
  width: 100%;
  box-sizing: border-box;
  box-shadow: var(--focus-ring);
  outline: none;
}
.inline-edit-textarea {
  resize: none;
  line-height: var(--leading-normal);
  font-size: var(--text-sm);
  min-height: 60px;
}
```

**JS change in `tasks-board.js`:** In `startEditingTitle()`, `startEditingNote()`, `startEditingSubtask()`, `startAddingSubtask()`, `startEditingColumnTitle()` — replace every `input.style.cssText = '...'` with `input.className = 'inline-edit-input'` (or `inline-edit-textarea` for textareas).

### 5.11 Add Task Button

```css
.add-card {
  padding: var(--space-2) var(--space-3) var(--space-3);
}
.add-card button {
  width: 100%;
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--text-tertiary);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  font-family: var(--font-sans);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}
.add-card button:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-muted);
}
.add-card button:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
```

### 5.12 Add Section Phantom Column

**JS change in `tasks-board.js`:** Change `phantom.className = 'column'` to `phantom.className = 'column-add-section'`. Remove all inline style overrides on that element.

```css
.column-add-section {
  flex: 0 0 auto;
  width: clamp(200px, 14vw, 240px);
  min-height: 80px;
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  font-family: var(--font-sans);
  align-self: flex-start;
  background: transparent;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}
.column-add-section:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-muted);
}
.column-add-section:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
```

### 5.13 Empty Column State

**JS change in `tasks-board.js`:** In `createColumn()`, when `sectionTasks.length === 0`, append to `.cards`:

```js
cardsContainer.innerHTML = '<div class="column-empty-state">Drop tasks here<br>or click + Add task</div>';
```

```css
.column-empty-state {
  padding: var(--space-7) var(--space-4);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}
```

### 5.14 Archive Column & Toggle

```css
.archive-column { opacity: 0.80; }
.archive-column:hover { opacity: 0.92; transition: opacity var(--transition-normal); }
.backlog-column { opacity: 0.85; }

/* CSS class-driven toggle — JS adds/removes .open instead of textContent swap */
.archive-toggle {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--text-tertiary);
  border-left: none;
  border-bottom: none;
  transform: rotate(45deg);
  transition: transform var(--transition-fast);
  margin-left: var(--space-2);
  flex-shrink: 0;
}
.archive-column.open .archive-toggle {
  transform: rotate(135deg);
}
```

**JS change in `tasks-board.js`:** Replace `archiveToggle.textContent = '▶'/'▼'` with `col.classList.toggle('open')`. Keep the toggle `<span class="archive-toggle">` empty — CSS draws it.

**JS change:** Add `aria-expanded="true/false"` to `.archive-header` button, toggled alongside the class.

### 5.15 Drag States

```css
.cards.drag-over {
  background: var(--drag-over-bg);
  border-radius: var(--radius-md);
}

.drop-indicator {
  height: 2px;
  background: var(--accent);
  border-radius: var(--radius-pill);
  margin: var(--space-1) 0;
  box-shadow: 0 0 6px var(--accent-muted);  /* Subtle glow = active insertion point */
}

.column-drop-indicator {
  width: 3px;
  background: var(--accent);
  border-radius: var(--radius-pill);
  margin: 0 -2px;
  min-height: 100px;
  box-shadow: 0 0 8px var(--accent-muted);
}
```

---

## 6. Tasks List View

### 6.1 Section Headers

```css
.list-section-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0 var(--space-2);
  margin-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

.section-title {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  text-transform: none;  /* No uppercase */
}

.list-section-header .count {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-tertiary);
  background: var(--surface-3);
  border: 1px solid var(--border);
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
}
```

### 6.2 Task Rows

```css
.list-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-1);
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  cursor: grab;
  position: relative;
  transition: border-color var(--transition-fast),
              box-shadow var(--transition-fast),
              transform var(--transition-fast),
              background var(--transition-fast);
}
.list-item:hover {
  background: var(--surface-4);
  border-color: var(--border);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.list-item:active { cursor: grabbing; }
.list-item.dragging {
  opacity: 0.4;
  background: var(--surface-2);
}

.list-item-title {
  font-size: var(--text-md);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  line-height: var(--leading-normal);
  cursor: text;
  transition: text-decoration-color var(--transition-fast);
  text-decoration: underline dotted transparent;
  text-underline-offset: 3px;
}
.list-item-title:hover {
  text-decoration-color: var(--text-tertiary);
}
.list-item-title.checked {
  color: var(--text-tertiary);
  text-decoration: line-through;
  text-decoration-style: solid;
}
```

### 6.3 Add-Note Reveal — Max-Height Transition

```css
.list-item-note.add-note {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  transition: max-height var(--transition-normal),
              opacity var(--transition-fast),
              visibility var(--transition-fast);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-top: 0;
}

.list-item:hover .list-item-note.add-note {
  max-height: 80px;
  opacity: 1;
  visibility: visible;
  margin-top: var(--space-1);
}

.list-item-note:not(.add-note) {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-top: var(--space-1);
  line-height: var(--leading-relaxed);
}
```

### 6.4 Checked Subtask Text

**JS change in `tasks-list.js`:** Replace `stText.style.textDecoration = 'line-through'; stText.style.color = '...'` with `stText.classList.add('subtask-text--done')`.

```css
.subtask-text--done {
  color: var(--text-tertiary);
  text-decoration: line-through;
}
```

### 6.5 Quick-Add Bar

**JS change in `tasks-list.js`:** Remove `quickAdd.style.cssText = '...'` inline override. CSS owns all spacing.

```css
.quick-add {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  margin-bottom: var(--space-5);
  border-bottom: 1px solid var(--border);
}

.quick-add-input {
  flex: 1;
  background: transparent;
  border: none;
  font-size: var(--text-md);
  color: var(--text-primary);
  font-family: var(--font-sans);
  outline: none;
}
.quick-add-input::placeholder { color: var(--text-tertiary); }

.checkbox--ghost { opacity: 0.3; }
```

**JS change:** Replace `opacity: 0.3` inline style on ghost checkbox with `className += ' checkbox--ghost'`.

### 6.6 Empty Section State

**JS change in `tasks-list.js`:** When `sectionTasks.length === 0`:

```js
container.innerHTML = '<div class="list-section-empty">No tasks — press Enter in the quick-add bar to add one</div>';
```

```css
.list-section-empty {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  padding: var(--space-5) var(--space-4);
  text-align: center;
  font-style: italic;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
}
```

---

## 7. Memory Tab

### 7.1 Two-Pane Layout

**HTML change in `index.html`:** Restructure `#memoryMainContent` to hold a sidebar and content area:

```html
<div id="memoryMainContent" style="display: none; flex-direction: row; flex: 1; min-height: 0; gap: 0; overflow: hidden;">
  <nav id="memoryTabsContainer" class="memory-sidebar" role="tablist" aria-label="Memory files"></nav>
  <div class="memory-content-area" id="memoryContentContainer"></div>
</div>
```

```css
.memory-sidebar {
  width: 220px;
  min-width: 220px;
  flex-shrink: 0;
  background: var(--surface-1);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: var(--space-3) 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.memory-sidebar-group-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-tertiary);
  padding: var(--space-3) var(--space-4) var(--space-1);
  margin-top: var(--space-2);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  /* This is the ONE approved use of uppercase — sidebar structural labels only */
}

.memory-content-area {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-5) var(--space-6);
  background: var(--surface-0);
}
```

### 7.2 Memory Nav Items (`.memory-tab`)

The class name `.memory-tab` is preserved for JS coupling compatibility. Only its visual treatment changes.

```css
.memory-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  background: transparent;
  color: var(--text-secondary);
  padding: 7px var(--space-4);
  margin: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  border-left: 2px solid transparent;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  font-family: var(--font-sans);
  transition: background var(--transition-fast), color var(--transition-fast);
  text-align: left;
  width: calc(100% - var(--space-4));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.memory-tab:hover {
  background: var(--accent-muted);
  color: var(--text-primary);
}
.memory-tab.active {
  background: var(--accent-muted);
  color: var(--accent);
  border-left-color: var(--accent);
  font-weight: var(--weight-semibold);
}
.memory-tab:focus-visible {
  box-shadow: inset 0 0 0 2px var(--accent);
  outline: none;
}

.memory-tab .count {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-tertiary);
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}
.memory-tab.active .count {
  background: var(--accent-muted);
  color: var(--accent);
  border-color: var(--accent);
}
```

**JS change in `memory-renderer.js`:**
- `renderMemoryTabs()` must build the vertical sidebar instead of horizontal pill strip.
- Group nav items: "Core" (MEMORY, CLAUDE.md, Glossary, Pending-Gaps, Archived), "Feedback" (files with `feedback_` prefix), "Reference" (files with `reference_` prefix), "Directories" (Context, People, Projects, Archived sub-items).
- Format display names: replace `_` with space, capitalize first letter: `feedback_memory_gap_detection` → "Memory Gap Detection". Underlying `data-file` attribute carries original name unchanged.
- Emit `.memory-sidebar-group-label` spans as section headers.
- Add `role="tab"` and `aria-selected="true/false"` to each `.memory-tab` button.

### 7.3 File Card Content — Critical Monospace Fix

**CSS change in `memory.css`:** Remove `font-family: monospace` and `white-space: pre-wrap` from `.file-card-content`. These defeat the markdown rendering.

```css
.file-card-content {
  /* REMOVE: font-family: monospace; */
  /* REMOVE: white-space: pre-wrap; */
  padding: var(--space-4) var(--space-5);
  overflow: hidden;
  max-height: 0;
}
.file-card-content.expanded {
  max-height: none;
  display: block;
}

/* Raw files (non-markdown) use the --raw modifier */
.file-card-content--raw {
  font-family: var(--font-mono);
  white-space: pre-wrap;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
}
```

**JS change in `memory-renderer.js`:** Only add `file-card-content--raw` for plain-text files. Do NOT add it when rendering `.markdown-content`.

### 7.4 Markdown Content Styling

```css
.markdown-content {
  font-family: var(--font-sans);
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
  color: var(--text-primary);
  white-space: normal;  /* Explicit override — ensures inherited pre-wrap cannot propagate */
}

.markdown-content h1 {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
  margin: var(--space-6) 0 var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: var(--space-2);
}
.markdown-content h2 {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  margin: var(--space-5) 0 var(--space-2);
}
.markdown-content h3 {
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin: var(--space-4) 0 var(--space-2);
}
.markdown-content p {
  margin-bottom: var(--space-3);
  line-height: var(--leading-relaxed);
}
.markdown-content ul, .markdown-content ol {
  margin: var(--space-2) 0 var(--space-3) var(--space-5);
}
.markdown-content li { margin: 3px 0; }
.markdown-content a { color: var(--accent); text-decoration: none; }
.markdown-content a:hover { text-decoration: underline; }

/* Code spans — note: accent at ~3.4:1 is AA for UI components but fails for
   inline prose. Use text-secondary for inline code text instead. */
.markdown-content code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  padding: 2px var(--space-1);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);  /* NOT accent — avoids WCAG AA fail at 13px */
}
.markdown-content pre {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  overflow-x: auto;
  margin: var(--space-3) 0;
}
.markdown-content pre code {
  background: transparent;
  border: none;
  padding: 0;
  color: var(--text-secondary);
}
.markdown-content table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  margin: var(--space-4) 0;
}
.markdown-content th {
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  padding: var(--space-2) var(--space-3);
  text-align: left;
  text-transform: none;  /* Remove uppercase from table headers */
}
.markdown-content td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}
.markdown-content tr:last-child td { border-bottom: none; }
.markdown-content tr:hover td { background: var(--surface-2); }
```

### 7.5 Memory Card Grid

```css
.memory-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
}

.memory-card {
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  cursor: pointer;
  transition: border-color var(--transition-fast),
              box-shadow var(--transition-fast),
              transform var(--transition-fast);
  box-shadow: var(--shadow-sm);
}
.memory-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.memory-card:focus-visible {
  box-shadow: var(--focus-ring), var(--shadow-md);
  outline: none;
}

.memory-card-title {
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}
.memory-card-preview {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  line-clamp: 3;
  line-height: var(--leading-relaxed);
}
```

**JS change in `memory-renderer.js`:** Add `tabindex="0"`, `role="button"`, `aria-label="Open [filename]"` to `.memory-card` divs. Add `keydown` handler for `Enter`/`Space`.

### 7.6 Inline Edit (Context Page)

```css
[data-editable] {
  cursor: text;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}
[data-editable]:hover {
  background: var(--surface-3);
  outline: 1px dashed var(--border);
  outline-offset: 1px;
}
[data-editable].editing {
  outline: 2px solid var(--accent);
  background: var(--surface-3);
}

.inline-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1);
  margin-top: var(--space-1);
}
.inline-edit-save,
.inline-edit-cancel {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  min-height: 28px;  /* WCAG minimum touch target */
  font-family: var(--font-sans);
}
.inline-edit-save {
  background: var(--accent);
  color: white;
  border: none;
}
.inline-edit-save:hover { background: var(--accent-hover); }
.inline-edit-cancel {
  background: var(--surface-3);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.inline-edit-cancel:hover { background: var(--surface-4); }

/* Save/error flash feedback */
.inline-edit-success { animation: flash-success 0.8s ease-out; }
.inline-edit-error   { animation: flash-error   0.8s ease-out; }

@keyframes flash-success {
  0%   { background: rgba(93, 175, 122, 0.20); }
  100% { background: transparent; }
}
@keyframes flash-error {
  0%   { background: rgba(224, 92, 92, 0.20); }
  100% { background: transparent; }
}
```

**JS change in `inline-edit.js`:** In `saveEdit()`, on success: `td.classList.add('inline-edit-success'); setTimeout(() => td.classList.remove('inline-edit-success'), 800)`. On error: same with `inline-edit-error`.

### 7.7 Overview Stats Bar

```css
.stats {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
  flex-wrap: wrap;
}
.stat {
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-5);
  min-width: 100px;
  text-align: center;
  box-shadow: var(--shadow-sm);
}
.stat-value {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);  /* NOT accent — file counts are neutral data */
  line-height: 1;
}
.stat-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-tertiary);
  margin-top: var(--space-1);
  text-transform: none;
}
```

---

## 8. Global Memory Tab

### 8.1 Sub-Tab Bar

```css
#globalMemorySubTabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  padding: 0 var(--space-6);
  background: transparent;
  flex-shrink: 0;
}

.gm-sub-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast);
  position: relative;
  bottom: -1px;
  font-family: var(--font-sans);
}
.gm-sub-tab:hover { color: var(--text-secondary); }
.gm-sub-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
}
.gm-sub-tab:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
.gm-sub-tab .count {
  background: var(--surface-3);
  border: 1px solid var(--border);
  font-size: var(--text-xs);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  margin-left: var(--space-1);
  color: var(--text-tertiary);
}
```

**JS change in `global-memory.js`:** Add `role="tablist"` to `#globalMemorySubTabs`. Add `role="tab"` + `aria-selected` to each `.gm-sub-tab`.

### 8.2 Filter Pills

```css
.gm-filter-pill {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-sans);
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}
.gm-filter-pill:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}
.gm-filter-pill.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
.gm-filter-pill.active .count {
  background: rgba(255, 255, 255, 0.22);
  color: white;
  /* Replaces hardcoded rgba(255,255,255,0.3) */
}
.gm-filter-pill:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
```

**JS change in `global-memory.js`:** Add `aria-pressed="true/false"` to filter pills.

### 8.3 Memory Cards

Same treatment as `.memory-card` in §7.5 — `hover lift + accent border + focus ring`.

**JS change in `global-memory.js`:** Add `tabindex="0"`, `role="button"`, `aria-label`, `keydown` handler to `.gm-card` elements.

### 8.4 Type Badges

```css
.gm-type-badge {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
}
.gm-type-user      { background: var(--badge-user-bg);      color: var(--badge-user-fg); }
.gm-type-feedback  { background: var(--badge-feedback-bg);  color: var(--badge-feedback-fg); }
.gm-type-project   { background: var(--badge-project-bg);   color: var(--badge-project-fg); }
.gm-type-reference { background: var(--badge-reference-bg); color: var(--badge-reference-fg); }
.gm-type-default   { background: var(--badge-unknown-bg);   color: var(--badge-unknown-fg); }
/* Removes all hardcoded hex and [data-theme="dark"] overrides — variables handle both themes */
```

**JS change in `global-memory.js`:** When type is unknown, use `gm-type-default` instead of `gm-type-${unknown}`.

### 8.5 CLAUDE.md View/Edit Panel — Connected Card Fix

```css
.gm-view-pane,
.gm-edit-pane {
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.gm-view-toolbar,
.gm-edit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  flex-shrink: 0;
  /* top corners only — container clips bottom corners */
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.gm-claude-md-content {
  padding: var(--space-5) var(--space-6);
  flex: 1;
  overflow-y: auto;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.gm-editor {
  flex: 1;
  min-height: 200px;
  max-height: calc(100vh - 280px);
  resize: vertical;
  background: var(--surface-3);
  border: none;
  padding: var(--space-4) var(--space-5);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: var(--leading-relaxed);
  outline: none;
}
.gm-editor:focus {
  box-shadow: inset 0 0 0 2px var(--accent);
}
```

**JS change in `global-memory.js`:** Wrap `.gm-view-toolbar` + `.gm-claude-md-content` in `<div class="gm-view-pane">`. Wrap `.gm-edit-toolbar` + `.gm-editor` in `<div class="gm-edit-pane">`. Remove individual border-radius from child elements.

---

## 9. Modals

```css
.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: var(--modal-overlay-bg);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 200;
  align-items: center;
  justify-content: center;
  animation: overlay-in var(--transition-fast);
}
.modal-overlay.visible { display: flex; }

@keyframes overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.modal {
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  max-width: 680px;
  width: calc(100% - var(--space-8));
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  animation: modal-in var(--transition-normal);
}

@keyframes modal-in {
  from { transform: scale(0.97) translateY(8px); opacity: 0.6; }
  to   { transform: scale(1)    translateY(0);   opacity: 1; }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  flex-shrink: 0;
}
.modal-header h3 {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-tight);
}

.modal-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--text-md);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.modal-close:hover {
  background: var(--surface-4);
  color: var(--status-blocked);
}
.modal-close:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}

.modal-body {
  padding: var(--space-5);
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  flex-shrink: 0;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.form-group { margin-bottom: var(--space-4); }
.form-group label {
  display: block;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  margin-bottom: var(--space-1);
  text-transform: none;
  letter-spacing: 0;
}

.form-group textarea,
.form-input {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: var(--leading-relaxed);
  resize: vertical;
  min-height: 180px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.form-group textarea:focus,
.form-input:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
  outline: none;
}
```

**HTML change in `index.html`:** Add `aria-label="Close"` to `#modalClose`. Replace `&times;` with an SVG X icon.

**JS change in `memory-modal.js`:**
- Extract filename input inline styles to `class="form-input"`.
- Implement focus trap: on modal open, collect all focusable children (`button, input, textarea, [tabindex]:not([tabindex="-1"])`), intercept `Tab`/`Shift+Tab` to cycle within them. Restore focus to triggering element on close.

---

## 10. Status Bar / Toasts

```css
.status-bar {
  position: fixed;
  bottom: var(--space-6);
  left: 50%;
  transform: translateX(-50%);
  background: var(--status-bar-bg);
  color: var(--status-bar-fg);
  border: 1px solid var(--border);
  padding: var(--space-2) var(--space-5);
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  box-shadow: var(--shadow-md);
  opacity: 0;
  transition: opacity var(--transition-fast);
  pointer-events: none;
  white-space: nowrap;
  z-index: 300;
}
.status-bar.visible { opacity: 1; }
```

---

## 11. Empty States

```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8) var(--space-5);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}
.empty-state-icon {
  font-size: 32px;
  margin-bottom: var(--space-3);
  opacity: 0.4;
}
.empty-state-title {
  font-size: var(--text-md);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  margin-bottom: var(--space-1);
}
.empty-state--panel {
  background: var(--surface-2);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--border);
}
```

---

## 12. Buttons (Global)

```css
button {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface-3);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--transition-fast),
              border-color var(--transition-fast),
              color var(--transition-fast);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
button:hover { background: var(--surface-4); }
button:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
}
button.primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
button.primary:disabled {
  background: var(--accent);
  opacity: 0.35;
}

/* Utility class replacing style.display toggle */
.hidden { display: none !important; }
```

---

## 13. Motion & Interaction

| State | Property | Duration | Notes |
|---|---|---|---|
| Hover background | `background` | 120ms | All cards, rows, buttons |
| Hover border | `border-color` | 120ms | Cards, inputs |
| Card hover lift | `transform: translateY(-1px)` + `box-shadow` | 120ms | Task cards, list items, memory cards |
| Focus ring | `box-shadow` | 120ms | Box-shadow ring, never outline |
| Tab panel fade | `opacity` 0→1 via `@keyframes` | 120ms | Works with existing display toggle |
| Progress fill | `width` | 300ms ease | Sprint progress bar |
| Priority dot hover | `transform: scale(1.5)` + `box-shadow` | 120ms | Dot hover |
| Drag card | `rotate(1.5deg) scale(1.02)` + `opacity: 0.55` | instant | Applied via `.dragging` class |
| Modal appear | `scale(0.97→1) + translateY(8px→0)` | 200ms | `.modal` animation |
| Archive toggle | `rotate(45deg→135deg)` | 120ms | CSS class `.open` on column |
| Status bar | `opacity` 0→1 | 120ms | `.status-bar.visible` |
| Add-note reveal | `max-height` + `opacity` | 200ms | `.add-note` on parent hover |
| Inline edit flash | `background` fade | 800ms | Success (green) / error (red) |
| Drop indicator glow | `box-shadow` | instant | Signals active insertion point |

**No spring physics, no bounce, no blur transitions.** All transitions are eased property fades. Focus rings use `box-shadow` exclusively — never `outline` — to avoid layout shifts on elements with complex `border-radius`.

---

## 14. Responsive Plan

### Breakpoints

| Name | Width | Changes |
|---|---|---|
| Wide | > 1100px | Full 2-col overview grid, full board columns |
| Mid | 760px – 1100px | Overview 1-col; board horizontal scroll preserved; memory sidebar 180px |
| Narrow | 480px – 760px | Header: title shrinks; search shortcut hidden; memory sidebar collapses |
| Mobile | < 480px | All single-column; sidebar becomes horizontal scroll strip |

```css
/* ── Mid ── */
@media (max-width: 1100px) {
  .overview-grid { grid-template-columns: 1fr; }
  .memory-sidebar { width: 180px; min-width: 180px; }
}

/* ── Narrow ── */
@media (max-width: 760px) {
  .unified-search-shortcut { display: none; }
  .memory-sidebar { width: 160px; min-width: 160px; }
}

/* ── Mobile ── */
@media (max-width: 480px) {
  body { padding: 0; }
  header { padding: var(--space-2) var(--space-3); }
  h1 { font-size: var(--text-md); }

  .unified-search-shortcut { display: none; }
  .buttons { gap: var(--space-1); }
  button { padding: var(--space-1) var(--space-2); }

  /* Memory sidebar collapses to horizontal scrolling tab strip */
  #memoryMainContent {
    flex-direction: column !important;
  }
  .memory-sidebar {
    width: 100%;
    min-width: 0;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: var(--space-2) var(--space-3);
    gap: var(--space-1);
  }
  .memory-sidebar-group-label { display: none; }
  .memory-tab {
    flex-shrink: 0;
    width: auto;
    border-left: none;
    border-bottom: 2px solid transparent;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    margin: 0;
    padding: var(--space-2) var(--space-3);
  }
  .memory-tab.active {
    border-bottom-color: var(--accent);
    border-left-color: transparent;
    background: var(--accent-muted);
  }

  /* Board: single column visible at a time via horizontal scroll (intentional for kanban) */
  .column { width: clamp(260px, 80vw, 320px); }

  /* Overview stats: 2×2 grid */
  .task-summary-grid { grid-template-columns: repeat(2, 1fr); }
}
```

---

## 15. Implementation Map

### `dashboard/index.html`

1. **Remove lines 8-10:** Delete the Google Fonts `<link>` tags for Inter. The system-ui stack covers all platforms.
2. **Logo SVG:** Replace `fill="#..."` attributes on `<path>` elements with `style="fill: var(--surface-3)"` / `style="fill: var(--accent)"` / `style="fill: var(--text-tertiary)"`. Remove `style="margin-right: 12px"` inline style; move to `.header-left { gap: var(--space-2) }` in CSS.
3. **Theme toggle `#themeToggle`:** Replace emoji text node with SVG markup. Add `aria-label="Switch to light mode"` and `aria-pressed="false"`.
4. **Sort Priority button `#sortPriorityBtn`:** Move outside `#taskViewToggle` div as a sibling in `.header-nav`. Add `class="sort-action-btn"`.
5. **Modal close `#modalClose`:** Add `aria-label="Close"`. Replace `&times;` with SVG X icon (16px, `currentColor` stroke).
6. **Main tab toggle `#mainTabToggle`:** Add `role="tablist"`. Add `role="tab"`, `aria-selected="true/false"`, `aria-controls="<panelId>"` to each button.
7. **Tab panels:** Add `role="tabpanel"` and `aria-labelledby="<tabBtnId>"` to each `.tab-panel`.
8. **`#memoryMainContent`:** Restructure to contain `<nav id="memoryTabsContainer" class="memory-sidebar">` and `<div class="memory-content-area" id="memoryContentContainer">` as per §7.1.

### `dashboard/styles/base.css`

- Replace entire `:root` and `[data-theme="light"]` blocks with the token set from §1.
- Remove `body { padding: 20px 24px }` — panels handle their own padding.
- Add `@media (prefers-color-scheme: dark)` no-op block (§1.3).
- Add header glass styles (§3.1).
- Add `h1` Georgia serif rule (§3.2).
- Add `.header-left:not(.has-path) .file-path { display: none }` (§3.3).
- Rewrite `#themeToggle` (§3.7).
- Rewrite `.view-toggle` button styles (§3.5).
- Add `.sort-action-btn` (§3.6).
- Rewrite `button`, `button.primary`, `button:disabled` (§12).
- Add `.hidden { display: none !important }`.
- Add `.unified-search` + media query for shortcut badge (§3.9).
- Add `@keyframes tab-fade-in` and `.tab-panel` / `.tab-panel.active` animation rule (§3.10).
- Add `.inline-edit-input`, `.inline-edit-textarea` classes (§5.10).
- Add `.priority-legend` (§5.2).
- Add all responsive breakpoints (§14).
- Remove stale `margin-left: 16px` on `.view-toggle`.

### `dashboard/styles/tasks.css`

- Replace `.priority-low`, `.priority-medium`, `.priority-high` background values with `var(--priority-low/medium/high)`. Remove `var(--accent, #3b82f6)` fallback.
- Add `.priority-dot:hover` glow via `box-shadow`.
- Update `.column` width to `clamp(300px, 22vw, 360px)`.
- Add `.column-header { border-top: 3px solid var(--col-color, var(--border)) }`.
- Remove `text-transform: uppercase` and `letter-spacing` from `.column-header`.
- Update `.task-card` hover (translateY + surface-4 bg).
- Add `var(--checkbox-indent)` to `.card-note`, `.card-subtasks` in place of hardcoded 30px.
- Remove `opacity: 0.7` from `.task-id`.
- Add `.column-add-section` (§5.12).
- Add `.column-empty-state` (§5.13).
- Add `.archive-toggle` CSS-class-rotation rules (§5.14).
- Update `.archive-column`, `.backlog-column` (§5.14–5.15).
- Update `.drag-over`, `.drop-indicator`, `.column-drop-indicator` (§5.15).
- Update `.add-card button` (§5.11).
- Update `.list-section-header`, `.section-title` (§6.1 — remove uppercase).
- Update `.list-item` hover (§6.2).
- Add `.list-item-title`, `.list-item-title.checked` (§6.2).
- Add `.list-item-note.add-note` max-height transition (§6.3).
- Add `.subtask-text--done` (§6.4).
- Add `.quick-add` (§6.5).
- Add `.checkbox--ghost` (§6.5).
- Add `.list-section-empty` (§6.6).

### `dashboard/styles/overview.css`

- Remove `text-transform: uppercase` and `letter-spacing` from `.widget-card h3`.
- Remove blanket `color: var(--accent)` from `.stat-number`.
- Add `#statInProgress .stat-number` etc. semantic color selectors (§4.4).
- Update `.summary-stat` (§4.4).
- Update `.progress-bar`, `.progress-fill` to use `var(--progress-fill)` sage green (§4.3).
- Add `.progress-label` (§4.3).
- Remove hardcoded `#ef4444`, `#f59e0b` from deadline classes — CSS variables only (§4.7).
- Add `.quick-links-empty` (§4.5).
- Add `.ws-status--planned/inprogress/done` (§4.8).
- Update `.workshop-status-select` focus-visible.
- Update `.sprint-name` font-size to `var(--text-xl)`.
- Update `.task-summary-grid` gap.

### `dashboard/styles/memory.css`

- **CRITICAL:** Remove `font-family: monospace` and `white-space: pre-wrap` from `.file-card-content` (§7.3).
- Add `.file-card-content--raw` modifier class (§7.3).
- Add `.memory-sidebar`, `.memory-sidebar-group-label` (§7.1).
- Update `.memory-tab` for vertical sidebar style (§7.2).
- Add `.memory-content-area` (§7.1).
- Add full `.markdown-content` hierarchy styles (§7.4) — including explicit `white-space: normal`.
- Update `.memory-grid`, `.memory-card` (§7.5).
- Add `[data-editable]` styles and inline-edit flash animations (§7.6).
- Update `.stats`, `.stat-value` (§7.7 — remove accent from stat-value).
- Fix `.memory-tab.active .count` contrast: use `var(--accent-muted)` bg, `var(--accent)` text.
- Increase `.inline-edit-actions button` min-height to 28px.
- Remove dead `.search-box` and `.memory-card-meta` rules.

### `dashboard/styles/global-memory.css`

- Replace all hardcoded badge hex values with `var(--badge-*-bg/fg)` (§8.4).
- Remove `[data-theme="dark"] .gm-type-*` overrides.
- Add `.gm-type-default` fallback (§8.4).
- Update `.gm-sub-tab` to underline-indicator style (§8.1).
- Fix `.gm-view-toolbar` border-radius top-only (§8.5).
- Wrap view/edit panes in `.gm-view-pane`, `.gm-edit-pane` (§8.5).
- Add `.gm-editor` `flex: 1; min-height: 200px` (§8.5).
- Replace hardcoded `rgba(255,255,255,0.3)` on active pill count with `0.22` (§8.2).
- Add `:focus-visible` to `.gm-card`, `.gm-filter-pill`, `.gm-sub-tab`.
- Remove dead expand-in-place CSS block.

### `dashboard/styles/modal.css`

- Full replacement with §9 styles.
- Add `@keyframes overlay-in` and `@keyframes modal-in`.
- Add `backdrop-filter: blur(4px)` to `.modal-overlay`.
- Add `.form-input` class.

### `dashboard/styles/misc.css`

- **Delete** the brittle SVG fill attribute-selector dark mode override block (lines that match `[data-theme="dark"] svg path[fill='...']`).
- Update `.file-path` rule to use `.header-left:not(.has-path) .file-path { display: none }` (move from per-file to base.css is acceptable; keep misc.css as the home if preferred).
- Keep scrollbar styles.

### `dashboard/js/theme.js`

1. `initTheme()`: when no stored preference, `localStorage.setItem('theme', 'dark')` then `applyTheme('dark')`. Remove `applyTheme('auto')` branch.
2. `applyTheme(theme)`: update `toggle.setAttribute('aria-label', ...)` and `toggle.setAttribute('aria-pressed', ...)`.
3. Replace `toggle.textContent = '🌙'/'☀️'` with SVG innerHTML swap (sun SVG for dark mode, moon crescent SVG for light mode).

### `dashboard/js/state.js`

1. `switchMainTab()` and wherever `filePath.textContent` is set: `headerLeft.classList.toggle('has-path', !!filePath.textContent.trim())`.
2. Tab switching: alongside `.active` class, toggle `aria-selected="true"/"false"` on each tab button.
3. `#sortPriorityBtn` show/hide: after HTML extraction to sibling, update reference and use `btn.classList.toggle('hidden', !show)` instead of `style.display`. (No longer tied to `#taskViewToggle` container.)
4. Replace any `panel.style.display = 'none'/'flex'` with `panel.classList.remove/add('active')` ONLY IF the tab-fade-in animation proves unreliable — the `@keyframes` approach should not need this. Do not change unless tested.

### `dashboard/js/tasks-board.js`

1. `createColumn()`: `col.style.setProperty('--col-color', colorForSection(sectionName))` using the name-to-variable mapping in §5.3, with `var(--border)` as the default fallback.
2. `createColumn()`: when `sectionTasks.length === 0`, append `.column-empty-state` to `.cards` (§5.13).
3. `createCard()`: Replace `style.marginLeft = '30px'` on note/subtask wrappers with class-based margin driven by `var(--checkbox-indent)`.
4. `createCard()`: Replace all `input.style.cssText = '...'` in `startEditingTitle()`, `startEditingNote()`, `startEditingSubtask()`, `startAddingSubtask()`, `startEditingColumnTitle()` with `input.className = 'inline-edit-input'` or `'inline-edit-textarea'`.
5. `createCard()`: Add `role="checkbox"`, `aria-checked="true/false"`, `tabindex="0"` to checkbox spans. Add keydown handler.
6. `createCard()`: Add `role="button"`, `tabindex="0"`, `aria-label="Priority: [low/medium/high] — click to cycle"`, `title="Priority: [x] — click to cycle"` to priority dot spans.
7. `createCard()`: Add `aria-label="Delete task"` to delete button.
8. Archive toggle: Replace `archiveToggle.textContent = '▶'/'▼'` with `col.classList.toggle('open')`. Add `aria-expanded` to the archive header button.
9. Add Section button: Change `phantom.className = 'column'` to `phantom.className = 'column-add-section'`. Remove inline style overrides.

### `dashboard/js/tasks-list.js`

1. Remove `quickAdd.style.cssText = '...'` — CSS class `.quick-add` owns all styling.
2. Replace ghost checkbox `opacity: 0.3` inline style with `el.classList.add('checkbox--ghost')`.
3. `startEditingListNote()`: Replace `<input type="text">` with `<textarea rows="2" class="inline-edit-textarea">`.
4. Replace `stText.style.textDecoration = 'line-through'; stText.style.color = '...'` with `stText.classList.add('subtask-text--done')`.
5. Add `role="checkbox"`, `aria-checked`, `tabindex="0"` to list checkbox spans.
6. Add `role="button"`, `tabindex="0"`, `aria-label` to list priority dots.
7. Add empty-state rendering when `sectionTasks.length === 0` (§6.6).

### `dashboard/js/tasks-main.js`

1. Inject `.priority-legend` div once before `.board` on initialization (§5.2).

### `dashboard/js/overview.js`

1. Remove hardcoded `#ef4444` / `#f59e0b` hex strings from deadline rendering. Use `el.classList.add('deadline-today')` / `'deadline-soon'` only. Set `item.title = task.title`.
2. Remove `select.style.background = '...'` / `select.style.color = '...'` workshop inline styles. Replace with `select.className = 'workshop-status-select ws-status--' + key`.
3. Add `<span class="progress-label">` sibling to progress fill; set `progressLabel.textContent = Math.round(pct) + '%'`.
4. Add `role="button"` + `tabindex="0"` + `aria-label` to `.summary-stat` elements.

### `dashboard/js/memory-renderer.js`

1. `renderMemoryTabs()`: Rebuild to emit vertical grouped sidebar per §7.1–7.2. Use `.memory-sidebar-group-label` for group headers. Format snake_case names for display. Emit `role="tab"` and `aria-selected` on each button.
2. Add `tabindex="0"`, `role="button"`, `aria-label="Open [filename]"`, keydown handler to `.memory-card` elements.
3. `stat-value`: remove `color: var(--accent)` — value should be `var(--text-primary)`.
4. When rendering markdown content, do NOT add `file-card-content--raw` modifier class.

### `dashboard/js/memory-modal.js`

1. Extract filename input `style.cssText` to `class="form-input"`.
2. Add `aria-label="Close"` to `#modalClose`.
3. Implement focus trap: on modal open, `const focusable = modal.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])')`. Intercept `Tab` (forward) and `Shift+Tab` (backward) to cycle within `focusable`. Restore triggering element focus on close.

### `dashboard/js/global-memory.js`

1. Wrap view pane elements in `<div class="gm-view-pane">` (§8.5).
2. Wrap edit pane elements in `<div class="gm-edit-pane">` (§8.5).
3. Add `role="tablist"` to `#globalMemorySubTabs`. Add `role="tab"`, `aria-selected` to `.gm-sub-tab` buttons.
4. Add `aria-pressed="true/false"` to filter pills.
5. Add `tabindex="0"`, `role="button"`, `aria-label`, keydown handler to `.gm-card` elements.
6. When type is unknown, use `gm-type-default` class instead of dynamic `gm-type-${unknownType}`.

### `dashboard/js/inline-edit.js`

1. In `saveEdit()`, on success: `td.classList.add('inline-edit-success'); setTimeout(() => td.classList.remove('inline-edit-success'), 800)`.
2. On error: same with `'inline-edit-error'`.

---

## 16. Coupling Risk Checklist

All class names referenced in both CSS and JS are preserved unless explicitly renamed below. No class renames outside the two documented below.

| Class / attribute | Action |
|---|---|
| `.task-card`, `.archive-card`, `.backlog-card`, `.dragging` | Preserved |
| `.column`, `.dragging-column`, `.drag-over`, `.drop-indicator`, `.column-drop-indicator` | Preserved |
| `.add-on-hover`, `.archive-column`, `.backlog-column`, `.archive-header`, `.archive-toggle` | Preserved |
| `.card-title`, `.card-note`, `.card-subtasks`, `.subtask`, `.checkbox`, `.checked` | Preserved |
| `.priority-dot`, `.priority-low`, `.priority-medium`, `.priority-high` | Preserved — colors changed via new token variables, class names unchanged |
| `.task-id`, `.date-badge`, `.column-header`, `.count`, `.column-title` | Preserved |
| `.new-task-input`, `.add-card` | Preserved |
| `.list-item`, `.list-item-title`, `.list-item-note`, `.add-note` | Preserved |
| `.list-section`, `.list-section-header`, `.archive-section`, `.backlog-section` | Preserved |
| `.memory-tab`, `.memory-tab.active` | **Preserved** — visual treatment changes, class name stays for JS coupling |
| `.column` phantom button | **Renamed to `.column-add-section`** — JS change in `tasks-board.js` |
| `.deadline-today`, `.deadline-soon` | Preserved — inline hex removed from JS, class assignments kept |
| `.has-value` on `#unifiedSearch` | Preserved — `search.js` manages this class |
| `data-theme="dark"` on `documentElement` | Preserved |
| `.tab-panel.active` | Preserved — JS display toggle unchanged; CSS adds `@keyframes tab-fade-in` |
| `.modal-overlay.visible` | Preserved |
| `[data-editable]`, `[data-editable].editing`, `.inline-editing` | Preserved |
| `.gm-sub-tab.active`, `.gm-filter-pill.active`, `.gm-card` | Preserved |
| `modalOverlay.dataset.type` | Preserved |

**New classes introduced (both CSS and JS changes occur together):**
- `.column-add-section` — replaces `.column` on Add Section phantom; CSS §5.12 + JS `tasks-board.js`
- `.inline-edit-input`, `.inline-edit-textarea` — CSS §5.10 + JS `tasks-board.js`, `tasks-list.js`
- `.subtask-text--done` — CSS §6.4 + JS `tasks-list.js`
- `.has-path` — CSS `base.css` + JS `state.js`
- `.open` on `.archive-column` — CSS §5.14 + JS `tasks-board.js` (replaces textContent swap)
- `.ws-status--*` — CSS §4.8 + JS `overview.js`
- `.memory-sidebar`, `.memory-sidebar-group-label`, `.memory-content-area` — CSS §7.1 + JS `memory-renderer.js` + HTML
- `.gm-view-pane`, `.gm-edit-pane` — CSS §8.5 + JS `global-memory.js`
- `.gm-type-default` — CSS §8.4 + JS `global-memory.js`
- `.sort-action-btn` — CSS §3.6 + HTML change
- `.checkbox--ghost` — CSS §6.5 + JS `tasks-list.js`
- `.column-empty-state`, `.list-section-empty` — CSS §5.13/6.6 + JS `tasks-board.js`, `tasks-list.js`
- `.inline-edit-success`, `.inline-edit-error` — CSS §7.6 + JS `inline-edit.js`
- `.priority-legend` — CSS §5.2 + JS `tasks-main.js`
- `.hidden` — CSS §12 + JS `state.js`

---

## 17. Accessibility Checklist

| Item | Where | What |
|---|---|---|
| Focus ring | Global | `box-shadow: var(--focus-ring)` on all `:focus-visible`; never `outline: auto` |
| Tab role | `#mainTabToggle`, `#taskViewToggle`, `#memoryTabsContainer`, `#globalMemorySubTabs` | `role="tablist"` + `role="tab"` + `aria-selected` |
| Tab panels | All `.tab-panel` | `role="tabpanel"` + `aria-labelledby` |
| Modal close | `#modalClose` | `aria-label="Close"` |
| Modal focus trap | `memory-modal.js` | Cycle Tab within `.modal`; restore focus on close |
| Theme toggle | `#themeToggle` | `aria-label="Switch to [light/dark] mode"` + `aria-pressed` |
| Checkboxes | All board + list | `role="checkbox"` + `aria-checked` + `tabindex="0"` + keyboard handler |
| Priority dots | All board + list | `role="button"` + `aria-label="Priority: [x] — click to cycle"` + `tabindex="0"` |
| Memory cards | `.memory-card`, `.gm-card` | `role="button"` + `tabindex="0"` + `aria-label` + keydown |
| Stat cells | `.summary-stat` | `role="button"` + `tabindex="0"` + `aria-label` |
| Archive toggle | `.archive-header` | `aria-expanded="true/false"` |
| Delete buttons | `.delete-btn` | `aria-label="Delete task"` |
| Filter pills | `.gm-filter-pill` | `aria-pressed="true/false"` |
| WCAG AA contrast (dark) | All token pairs | `--text-primary` (#f0ede8) on `--surface-3` (#2e2b28): ~13:1. `--text-secondary` (#a8a49e) on `--surface-3`: ~5.1:1. `--accent` (#CF6A43) on `--surface-3`: ~3.5:1 — passes AA for UI components (3:1 required) and large text; NOT used for body text (code spans use `--text-secondary` per §7.4 to avoid this). |
| WCAG AA contrast (light) | All token pairs | `--text-primary` (#1a1713) on `--surface-3` (#ffffff): ~18:1. `--text-secondary` (#5c5249) on `--surface-3`: ~6.2:1. `--accent` (#C05A30) on `--surface-3`: ~4.2:1 — passes AA for all use cases in light mode. |
