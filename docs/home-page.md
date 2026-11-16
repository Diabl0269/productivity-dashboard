# Home page

The Home tab shows one project on one page: a top bar, the active view in the centre, an inspector on
the right and a strip at the bottom. One selected place ("where": a group, area or part of the
project's map) is kept across every view and in the address, so a link opens the same view and place.

```
/dashboard/home/<view>?where=<box id>&hproject=<project slug>
```

Views, in order, with their number keys: Overview (1), Map (2), Lanes (3), Tickets (4), How it runs (5).
Keys: `1`-`5` switch views (never while typing), arrows move inside the view switch and the inspector
tabs, `Tab` moves between zones, `Esc` clears the selected place.

## Pointing a project at its config

Each project describes itself in its own `home.config.json`. The tracker's `config.json` says where
each one lives, by project slug (absolute paths only, `.json` files only):

```json
"home": { "bakery": "/Users/you/code/bakery/home.config.json" }
```

A project without an entry shows a "Set up this project" card. Start from
[`home.config.example.json`](../home.config.example.json) (a made-up bakery). Problems in the file
are listed above the view in plain words (which key, what is wrong); the rest of the file is still used.

## Schema (version 1)

Keys starting with `$` (like `$comment`) are ignored. Any other unknown key is reported.

- **`version`**: `1`. A newer number is refused with a message; leaving it out means 1.
- **`title`**: the project's name as Home shows it.
- **`repos`**: the project's repositories, for the views that show where code lives and for finding live
  work (worktrees, recent branches, pull requests). Each entry is a path (`"bakery-site"`) or an object
  `{ "name": "Orders", "path": "bakery-orders" }`. Paths are relative to the folder of this file (absolute
  paths work too); `name` defaults to the folder's name. In the older flat shape a text entry is relative to
  the git top-level folder at or above the file instead, so a config kept in `docs/` can say `"."` for the
  repo itself. A path that is not an existing folder is left out and reported as a warning.
- **`fallback`**: the id of the area that takes epics no area claims (see "Where an epic belongs"); the last
  area when left out.
- **`groups`**: the top level of the map, e.g. "Shop floor" and "Kitchen". Each group has an `id`, a
  `name` and its `areas`, and may have `box`, `page`, `covers` and `keywordProjects` (the projects
  whose ticket titles may be matched by its areas' `match` patterns; `null` in the list means tickets
  with no project).
- **`areas`** (inside a group): the places work belongs to. An area has:
  - `id`: letters, digits, `-` and `_`; unique across every group, area and part (it goes in the address).
  - `name`: what the page shows.
  - `lanes`: tracker lanes whose tickets belong here.
  - `match`: a pattern (regular expression, any case) tested against ticket titles.
  - `projects`: tracker projects whose tickets belong here.
  - `box`: `[x, y, width, height]` of the area on the map drawing.
  - `page`: a handbook page about the area (path or link).
  - `covers`: what the area covers, such as folders or topics.
  - `parts`: smaller places inside the area, same keys as an area (one level only).
- **`cables`**: lines on the map between two places: `from` and `to` are ids, `path` is an optional
  SVG path, `label` an optional caption.
- **`decorations`**: optional path of an SVG file drawn behind the map, relative to the config file.
- **`services`**: the running things the project depends on: `id`, `name` and `what` (one line).
  Later views add more keys; extra keys are kept.
- **`automations`**: jobs that run by themselves (schedules, hooks, bots): `id`, `name`, `what`.
  Extra keys are kept, as for services.

### The older flat shape

A file without `version` whose `groups` is an object (`{ "<id>": "<name>" }`) is read as the older
flat shape: a top-level `areas` list where each area names its `group`, and `keywordProjects` as an
object of group id to project list. It is turned into version 1 on load (areas nested under their
group), so such a file needs no change.

### Where an epic belongs

`shared/home-areas.js` puts every epic in one area (and in one of its parts, when a part claims it). The
first rule that fits wins: (1) an area whose `lanes` hold the epic's lane; (2) an area whose `match` fits the
epic's title, only when the epic's project is in the area's group `keywordProjects` (a group without the key
allows every project); (3) an area whose `projects` hold the epic's project; (4) the `fallback` area. Areas
are tried in the order of the file (groups first to last, areas first to last). Epics that reach rule 4 are
listed by `unmatchedEpics`, so the map's owner can give them a place.

## Adding to the page

Each feature is its own module under `dashboard/js/` that registers itself, plus one import line in
`dashboard/js/home-registry.js`. Nothing else in the shell changes. The API is in
`dashboard/js/home-state.js`:

```js
import { registerHomeView } from './home-state.js';

registerHomeView({
  id: 'map', label: 'Map', key: 2,
  render(root, ctx) { /* build the view into root */ },
  update(root, ctx) { /* optional: refresh in place when tasks change; default re-runs render */ },
  dispose(root) { /* optional: undo timers or listeners */ },
});
```

- `registerInspectorTab({ id, label, render(root, ctx) })`: a tab of the inspector. It is drawn
  again when the selection or the tasks change.
- `registerTopBarItem({ id, slot, render(root, ctx) })`: `slot` is `search`, `palette`, `note` or
  `usage`.
- `registerStripItem({ id, render(root, ctx) })`: an item of the lower strip.

Views, top bar items and strip items are drawn again (focus and scroll kept) when the tasks or the
config change. For selection changes, subscribe. `ctx` gives:

| Key | What it is |
| --- | --- |
| `state()` | the tracker's task state (sections, tasks by section, meta) |
| `doc()` | the same as a `tasks.json`-shaped document |
| `selection()` | `{ project, group, area, part }` (ids, `null` when not chosen) |
| `setSelection(where)` | a box id, `{ group, area, part }`, or `null` |
| `clearSelection()` | what `Esc` does |
| `config()` | the project's config as described above (always version 1), or `null` |
| `home()` | the whole `/api/home` answer, errors included |
| `project()` | the selected project slug |
| `openTicket(id)`, `idButton(id)` | open a ticket; a ticket id as a button (same look as the Plan page) |
| `toast(message)` | a short status message |
| `redraw()` | draw this view, tab or item again in place |
| `subscribe(fn)` | `fn({ type })` for `view`, `selection`, `project`, `config`, `tasks`; returns unsubscribe, and ends by itself when the view is left |

A placeholder (registered with `placeholder: true`) gives way to the real registration with the same
id; for the top bar, any real item replaces the placeholder of its slot.

## Server routes

`GET /api/home?project=<slug>` returns `{ project, projects, path, config, errors, legacy, missing }`.
Routes live in `server/home-routes.js` as a table; each route is its own file under `server/home/`
(`{ method, path, handle }`, returning `{ status?, body }`), added with one line in the table.
`server/home/project-config.js` loads a project's config for any route that needs it, and
`server/home/repos.js` (`resolveRepos(config, configPath)`) turns its `repos` into absolute folders.

`GET /api/home/running?project=<slug>` returns `{ project, at, running[], loose[], epics{}, byTicket{}, warnings[] }`:
the live work of the project (sessions, worktrees, recent commits, pull requests; rules in
`shared/running.js`). One answer is shared for 15 s per project, and a source that cannot be read leaves
its part out with a line in `warnings` instead of failing. `dashboard/js/home-running-data.js` polls it
every 15 s while the Home tab shows (`getRunning`, `onRunning`, `runningFor`, `epicRunState`,
`refreshRunning`); `dashboard/js/home-where.js` tells any view which tickets the selected place keeps
(`selectedEpicIds`, `ticketInSelection`). The "Running now" strip item and its panel are
`dashboard/js/home-running-strip.js`.
