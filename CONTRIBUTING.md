# Contributing

Thank you for your interest in contributing to the Claude Code Productivity Dashboard! This guide will help you get started.

## Development Setup

1. Fork and clone the repository
2. Copy example files to create your personal configuration:
   ```bash
   cp config.example.json config.json
   cp CLAUDE.md.example CLAUDE.md
   cp TASKS.md.example TASKS.md
   cp -r memory.example/ memory/
   ```
3. Edit `config.json` with your personal links and sprint schedule
4. Start the dev server:
   ```bash
   node serve.js
   ```
5. Open http://localhost:3000/dashboard/ in your browser

## Project Structure

```
dashboard/
  js/         # ES modules — each file owns one feature
  styles/     # CSS files — one per feature area
  index.html  # Single-page app shell
serve.js      # Zero-dependency Node.js dev server
```

## Code Style

- **Dashboard JS:** ES modules with `import`/`export`, loaded via `<script type="module">`
- **Server:** CommonJS (`require`), Node.js built-in modules only
- **Zero dependencies:** No npm packages — the entire project runs on vanilla JS and Node.js built-ins
- **CSS:** Plain CSS with CSS custom properties for theming — no preprocessors
- **Naming:** camelCase for JS, kebab-case for CSS classes and file names

## Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Test locally by running `node serve.js` and verifying in the browser
4. Ensure no personal data is included in your changes (check `.gitignore`)
5. Submit a pull request with a clear description of what changed and why

## What to Contribute

- Bug fixes
- New dashboard widgets
- Improved mobile responsiveness
- Accessibility improvements
- Documentation improvements
- New memory file parsers or renderers

## What NOT to Include

- Personal data (names, emails, Slack IDs, internal URLs)
- External dependencies (keep it zero-dependency)
- Changes to `.gitignore` that would expose personal files
- Generated or minified files

## Reporting Issues

When filing an issue, please include:
- Browser and OS version
- Steps to reproduce
- Expected vs actual behavior
- Console errors (if any)

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
