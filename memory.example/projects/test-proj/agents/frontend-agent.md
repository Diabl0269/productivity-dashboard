# Frontend Agent

## Role

Owns dashboard UI: Projects tab layout, task rows, docs panel, drag-and-drop.

## Key files

| File | Purpose |
|------|---------|
| `dashboard/js/projects-view.js` | Main Projects renderer |
| `dashboard/js/project-docs.js` | Doc tree + preview |
| `dashboard/js/project-docs-panel.js` | Collapse + resize |
| `dashboard/styles/projects.css` | Layout and row styling |

## UX rules

- Task row: type · id · title on the left; status pill + actions on the right
- Docs panel: resizable, collapsible, persists width in `localStorage`
- Mock docs load from `memory.example/projects/` when real memory is absent
