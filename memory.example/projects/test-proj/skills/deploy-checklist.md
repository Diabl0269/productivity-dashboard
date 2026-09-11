# Deploy Checklist

Use before merging Projects UI changes.

## Local

- [ ] `node serve.js 3000`
- [ ] Open `http://localhost:3000/dashboard/projects/test-proj`
- [ ] Collapse / expand docs panel; drag resizer
- [ ] Select nested doc from tree; preview renders markdown

## Browser

- [ ] Refresh on nested route — CSS/JS still load (base href fix)
- [ ] Drag ticket to sub-project and epic drop zones
- [ ] ⋯ menu stays in viewport on last rows

## Release

- [ ] Example fixtures in `memory.example/projects/test-proj/`
- [ ] No secrets in committed JSON or markdown
