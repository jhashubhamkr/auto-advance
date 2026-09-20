# Troubleshooting Auto Advance

Public releases disable debug output by default. Ordinary playback, navigation and settings changes should not fill the console. Short warnings about failed storage, blocked playback or unavailable navigation remain enabled.

## Start here

1. Reload Auto Advance in `chrome://extensions`, then refresh the website tab.
2. Confirm the URL is a supported Shorts/Reels route and the main/platform switches are on.
3. Keep the tab visible and the video substantially visible. Check Duration Limit if long videos are skipped.
4. If no next item exists or the layout is unrecognized, navigate manually. Automatic retries are bounded.

Settings apply live; refreshing is required after an extension update to replace old content scripts.

## Temporarily enable diagnostics

Open DevTools on the website and select the **Auto Advance** content-script context from the Console context dropdown. The ordinary page context does not have the extension namespace.

```js
ShortAutoAdvance.log.setEnabled(true)
ShortAutoAdvance.diagnostics()
```

Use the extension's popup DevTools or service-worker inspector for logs from those contexts. Each context has its own toggle. The setting is not saved and resets when that context reloads. Enabling diagnostics does not recover past startup messages.

To turn it off again:

```js
ShortAutoAdvance.log.setEnabled(false)
```

Filter the console for `Auto Advance` and enable the Info level. Reproduce one video cycle and expand relevant objects.

| Message or overlay | Meaning |
| --- | --- |
| Playback tracking started | An active video and identity were selected |
| Playback count incremented | A completed play was counted |
| Watch again without another caption | Configured repeat count completed |
| Duration limit reached | The active video exceeds the enabled duration threshold |
| Skipping Ad | A supported ad marker was detected |
| Navigation queued | The saved delay started |
| Navigation verified | The next video identity was observed |
| Controller suspended | Check master/platform state, route, visibility or extension context |
| Navigation stopped | No safe next action succeeded; advance manually |

For the native YouTube ad overlay, the evidence field reads `YouTube visible Sponsored badge in native reels ad overlay`. Hidden duplicate badges must not qualify.

## Sharing a bug report

Include Chrome and extension versions, the platform, settings, expected/actual behavior, and whether the overlay says Watch again, Duration limit reached, or Skipping Ad. A minimal sanitized DOM fragment is useful for selector issues.

Diagnostics can include video IDs, route paths, timing and settings. Review and redact logs before posting them publicly. Do not share cookies, tokens, private messages, full page dumps, browser profiles or advertisement tracking URLs. Logs stay in the local console unless you copy them.
