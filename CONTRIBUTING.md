# Contributing

Thanks for helping improve Auto Advance. Small focused fixes and reproducible platform-layout reports are especially useful.

## Local setup

1. Fork and clone the repository.
2. Install a current Node.js LTS release (CI uses Node 24).
3. Run `npm ci`, then `npx playwright install chromium`.
4. Load the repository root as an unpacked Chrome extension.
5. After edits, reload the extension and refresh website tabs.

```sh
npm test
npm run check
npm run test:browser
npm run test:extension
npm run test:countdown
npm run package
```

On Linux, use `npx playwright install --with-deps chromium`. Optional `CHROME_PATH` and `PLAYWRIGHT_MODULE` environment variables point at an existing browser/runtime. Tests create disposable browser profiles under ignored `test-results/`.

## Changes and pull requests

- Describe the concrete problem, resulting behavior, and tests you ran.
- Keep runtime code local and dependency-free. Avoid new permissions unless necessary and justified.
- Keep debug logging off by default. Diagnostic tests can opt in explicitly.
- Add a regression fixture for playback, settings or selector bugs. Sanitize real DOM before committing it.
- Check keyboard operation, both themes, unsupported routes, and visible-tab-only behavior when relevant.
- Preserve repeat semantics: 0 means one play; Watch again starts a fresh cycle.
- Do not commit browser profiles, user logs, credentials, private media, generated ZIPs or dependency folders.
- Refresh public screenshots when the UI changes; use synthetic content or material you have permission to share.

Style: two-space indentation, plain JavaScript, explicit naming, and concise comments explaining non-obvious platform behavior. There is no formatting framework or bundler to install.

Be respectful and constructive. Report security vulnerabilities through [SECURITY.md](SECURITY.md), not a public reproduction.
