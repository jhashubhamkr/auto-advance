# Release validation — 0.1.0

September 20, 2026. Local checks use Windows, Node.js 20.19.0, Playwright 1.62.1 and Chrome 152.0.7977.83. CI uses Node 24 and Playwright's full Chromium. Checks use local fixtures, not signed-in live platform accounts.

| Check | Scope |
| --- | --- |
| Clean `npm ci` | Public lockfile installs; npm reported zero known vulnerabilities at validation time |
| `npm test` | 119 unit tests, including fresh-context quiet logging and opt-in diagnostics |
| `npm run check` | Manifest, matching versions, host permissions, local assets, syntax, debug-off default and real repository link |
| `npm run test:browser` | 19 checks for popup, settings, supported routes, media selection and native Sponsored overlays |
| `npm run test:extension` | 11 actual-extension checks for storage/restart, toolbar/SPA behavior, repeats, player gaps, duration and quiet normal playback |
| `npm run test:countdown` | 13 actual-extension checks for Watch again, ad/duration countdowns, full saved delay, hidden badges, stale settings and invalidated contexts |
| `npm run package` | 41 allowlisted production files plus a separate SHA-256 checksum |

The normal integration suite checks that expected playback produces no console output, while the countdown suite opts into diagnostics in isolated test contexts. A leftover log-count assertion was removed after the first quiet-mode run exposed it; playback-state assertions remain.

Public screenshots are reviewed captures of the real popup and a local synthetic-video countdown. Tracking URLs and advertiser details were removed from the supplied ad DOM fixture. Generated browser profiles and reports remain ignored and are not published.

Live YouTube/Instagram qualification is still pending for the public release candidate. Account experiments, translated ad labels and unknown layouts can differ from fixtures. Follow [TESTING.md](TESTING.md) before calling a release fully qualified.

Reproduce using [CONTRIBUTING.md](CONTRIBUTING.md). GitHub CI status is the authority for the remote runner result; local success does not imply a completed remote run.
