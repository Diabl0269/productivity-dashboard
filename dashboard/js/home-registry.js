// home-registry.js — the one list of Home features. Each feature is its own module that registers
// itself on import (registerHomeView / registerInspectorTab / registerTopBarItem / registerStripItem,
// from home-state.js). To add one: create the module, then add ONE import line below.
// Placeholders stay listed: a real registration with the same id (or, for the top bar, any real item
// in the same slot) replaces its placeholder whatever the import order.
//
// The planned features have a reserved line each, kept apart by blank lines so tickets built in
// parallel merge cleanly: uncomment yours (keep the file name, or rename it on that line). Anything
// else goes at the end, one line per feature.

import './home-placeholders.js'; // PRO116: quiet stand-ins until each feature lands

// import './home-overview-view.js'; // PRO129: Overview view (key 1, id 'overview')

// import './home-map-view.js'; // PRO39: Map view (key 2, id 'map')

// import './home-lanes-view.js'; // PRO118: Lanes view (key 3, id 'lanes')

// import './home-tickets-view.js'; // PRO119: Tickets view (key 4, id 'tickets')

import './home-how-it-runs-view.js'; // PRO122: How it runs view (key 5, id 'how-it-runs')

import './home-running-strip.js'; // PRO117: Running now strip item (id 'running')

// Other features: one import line each, below.
import './home-usage.js'; // PRO124: usage chip and popover (top bar slot 'usage')
import './home-pages.js'; // PRO126: How it works inspector tab (id 'how')
import './home-notes.js'; // PRO121: Note button + N key (top bar slot 'note') and the Notes inspector tab
import './home-palette.js'; // PRO125: command palette (top bar slots search + palette), ? key sheet, g/[/]/u keys
