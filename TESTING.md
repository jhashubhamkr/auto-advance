# Testing

## Automated checks

```sh
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:browser
npm run test:extension
npm run test:countdown
npm run package
```

On Linux use `npx playwright install --with-deps chromium`. All browser suites intercept site requests and use local fixtures. They do not sign in to YouTube/Instagram or inspect a user's live tabs.

- Unit tests cover repeat counting, seeks/loops, stale timers, navigation bounds, settings normalization/synchronization, toolbar routing and default-off diagnostics.
- Browser fixtures cover both popup themes, autosave, errors/retry, keyboard controls, unsupported routes, video selection and hidden/preloaded ad markers.
- Extension integration loads the real manifest and service worker, tests persistence through restart, route/tab changes, real media completion and quiet default logging.
- Countdown integration checks Watch again, full saved delays, reused video elements, duration filtering, invalidated contexts and supplied sanitized YouTube ad-overlay variants. It explicitly opts into logs in its isolated test contexts.

Generated reports, screenshots and temporary profiles go to ignored `test-results/`. They are not release assets. Only selected reviewed screenshots are copied to `docs/images/`.

For a locally installed browser/runtime, set `CHROME_PATH` and/or `PLAYWRIGHT_MODULE` before running the suites. Current Chrome/Chromium support for `Extensions.loadUnpacked` is required by extension integration.

## Manual live qualification

A green fixture run does not certify every account-specific site layout. Before a release, record the date, extension/browser versions, platform and observed results:

| Scenario | Expected behavior |
| --- | --- |
| Repeat 0, 1 and 2 | Exactly 1, 2 and 3 plays before one advance |
| Watch again during delay | Restart a full repeat cycle; no stale navigation |
| Delay 0.1s, 1s, 3s | Same saved delay for normal completion and recognized ads |
| Duration Limit off | Long videos continue normally |
| Duration Limit on | Only videos strictly longer than the threshold skip |
| Ordinary Short before/after an ad | No inherited ad label or premature skip |
| Visible Sponsored ad; hidden duplicate/preloaded badge | Only the active visible ad qualifies |
| Pause, seek, buffer, element replacement | No false completion or repeated advance |
| Hide tab or disable during countdown | Cancel countdown and pending navigation |
| Switch valid → invalid → valid tabs | Toolbar and popup recover without refresh |
| YouTube sidebar navigation and Back/Forward | Route state follows SPA changes |
| Unknown layout or no safe next control | Bounded attempts, then manual navigation |
| Both themes, keyboard and reduced motion | Readable controls, visible focus and correct timing |
| Reload extension, then refresh existing tabs | One current controller; old timers stop |
| Extract release ZIP in a clean profile | Loads with all assets, defaults and local saves |
| Default production logging | No routine playback/settings console output |

Ad skipping is best effort and relies on recognized DOM structure or disclosure text. Image-only ads, translations and new layouts may not qualify.

Use minimal sanitized DOM when adding a selector regression. Never commit credentials, user logs, browser profiles, private media or complete account pages.
