// home-registry.js — the one list of Home features. Each feature is its own module that registers
// itself on import (registerHomeView / registerInspectorTab / registerTopBarItem / registerStripItem,
// from home-state.js). To add one: create the module, then add ONE import line below.
// Every zone now has its real feature (the PRO116 placeholders were removed in PRO127); home-state.js still
// lets a `placeholder: true` registration give way to a real one, for a zone a later feature reserves.


import './home-overview-view.js'; // PRO129: Overview view (key 1, id 'overview')

import './home-map.js'; // PRO39: Map view (key 2, id 'map') and the inspector's Work tab

import './home-lanes.js'; // PRO118: Lanes view (key 3, id 'lanes')

import './home-tickets.js'; // PRO119: Tickets view (key 4, id 'tickets') and the inspector's Tickets tab

import './home-how-it-runs-view.js'; // PRO122: How it runs view (key 5, id 'how-it-runs')

import './home-running-strip.js'; // PRO117: Running now strip item (id 'running')

// Other features: one import line each, below.
import './home-usage.js'; // PRO124: usage chip and popover (top bar slot 'usage')
import './home-pages.js'; // PRO126: How it works inspector tab (id 'how')
import './home-notes.js'; // PRO121: Note button + N key (top bar slot 'note') and the Notes inspector tab
import './home-palette.js'; // PRO125: command palette (top bar slots search + palette), ? key sheet, g/[/]/u keys
