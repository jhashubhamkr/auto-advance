# Release guide

The public source repository and Chrome Web Store are separate distribution steps. A GitHub release ZIP can be installed using Load unpacked; publishing source does not create a store listing or automatic updates.

## Before a release

1. Update `manifest.json`, `package.json`, and both version fields in `package-lock.json` together. Update CHANGELOG and installation examples for the new version.
2. Run `npm ci`, `npm test`, `npm run check`, and all three browser suites. The check command rejects debug-enabled packages and placeholder popup links.
3. Complete the live checks in [TESTING.md](TESTING.md), especially normal clips beside ads, repeat 0/1, Watch again, tab switching, SPA navigation and disabling Duration Limit. Record limits honestly.
4. Review the staged diff for secrets, personal paths, user logs, browser profiles, real ad tracking URLs and private screenshots. Keep `dist/`, `node_modules/` and `test-results/` out of Git.
5. Run `npm run package`. Load an extracted copy of the generated ZIP in a clean Chrome profile and confirm settings, themes, toolbar and normal playback.
6. Confirm the ZIP contains runtime files and licenses only. The adjacent `.sha256` file is a checksum, not a digital signature.
7. Merge the reviewed release commit, tag it `vX.Y.Z`, and publish a GitHub release with the ZIP, checksum, user-facing changes and known limitations. Mark early builds as prereleases until live qualification is complete.

CI checks pull requests and pushes, and retains a package artifact after successful tests. Releases are deliberately published by a maintainer, not automatically for every push.

## Repository settings

Enable Issues and private vulnerability reporting. Add a description and topics such as `chrome-extension`, `youtube-shorts`, `instagram-reels` and `accessibility`. Require the CI check before merging into main when practical. Dependabot configuration covers npm and GitHub Actions. Keep workflow token permissions read-only for normal CI and avoid secrets in pull-request tests.

See GitHub's [workflow permissions documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions) and [private vulnerability reporting instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## Chrome Web Store, if desired

Register a developer account, prepare the listing's description, icons and screenshots, supply a public privacy-policy URL, explain the extension's single purpose and each permission, and submit the ZIP for review. Complete the privacy disclosures according to what the extension actually processes, including local processing. Do not claim approval before review finishes.

The README popup images are documentation assets, not a complete store-listing asset set. Create store screenshots at the required dimensions and review current requirements before submission.

Official references: [publishing](https://developer.chrome.com/docs/webstore/publish/), [developer registration](https://developer.chrome.com/docs/webstore/register), [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), and [local-data disclosure FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
