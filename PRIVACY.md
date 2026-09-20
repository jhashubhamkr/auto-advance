# Privacy policy

Auto Advance · version 0.1.0 · updated September 20, 2026

Auto Advance processes video playback information locally to move between supported YouTube Shorts and Instagram Reels. The extension does not collect or transmit personal data to its developer or a backend.

## Information used on your device

- Playback preferences and the light/dark theme are stored in Chrome's local extension storage. Chrome Sync storage is not used.
- The active tab's URL is checked transiently to recognize supported routes and update toolbar/popup availability.
- Content scripts inspect the active video, its identity, playback state, relevant visible ad markers, and next-video controls. Counters and temporary state stay in page memory.
- Tab identifiers and route support states stay in service-worker memory. The extension does not keep a browsing history.

## Network access and third parties

There are no analytics, telemetry, advertising services, external APIs or remote executable code in the extension. Icons and scripts are bundled locally.

YouTube and Instagram continue making their own requests when you use their websites or when the extension advances/replays a video. Their policies apply to that activity. Clicking the popup's GitHub link opens [this public repository](https://github.com/jhashubhamkr/auto-advance); GitHub's own policies then apply.

Ad detection does not intercept, block or send requests to ad networks, and the extension does not click advertiser destinations.

## Permissions

`storage` remembers your settings. Host access is restricted to the bare and www HTTPS domains of YouTube and Instagram, allowing route detection and content-script operation across same-page navigation. Playback automation runs only on supported Shorts/Reels routes.

The extension does not request access to cookies, browser history, passwords, or the broad tabs permission. It does not interact with likes, follows, messages or comments.

## Diagnostics

Debug logs are off by default. Concise operational warnings may appear locally when something fails. If you explicitly enable debug logs in DevTools, they can include video IDs, supported route paths, settings, playback timing and decisions. The extension does not transmit or persist these logs. Media source URLs, URL query strings, credentials and account details are omitted from its diagnostic snapshots.

Anything you voluntarily paste into a public issue is public. Review logs and screenshots before sharing them; see [troubleshooting](DEBUGGING.md).

## Control and deletion

Disable Auto advance or either platform in the popup to stop automation. Hidden tabs never advance. Reset settings restores playback defaults while retaining the theme. Removing the extension removes its local extension storage according to Chrome's normal behavior.

For privacy questions, use the repository's [issues](https://github.com/jhashubhamkr/auto-advance/issues) without including personal information. For a vulnerability, follow [SECURITY.md](SECURITY.md).
