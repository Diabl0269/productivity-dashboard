# Backend Agent

## Role

Owns API contracts, persistence, and server-side validation for Test Proj.

## Stack

- Node.js HTTP server (`serve.js`)
- Shared helpers under `shared/`
- JSON task store via `tasks.json`

## Checklist before PR

1. Run `node serve.js` and smoke-test `/dashboard/projects`
2. Verify `/api/project-docs?slug=test-proj` returns nested files
3. Keep personal data in gitignored paths only

## Open questions

- [ ] Should sub-project docs inherit parent overview links?
