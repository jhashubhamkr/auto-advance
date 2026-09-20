'use strict';
importScripts('content/settings.js');
importScripts('content/page-status.js');
const app = globalThis.ShortAutoAdvance;
let writes = Promise.resolve();
const toolbarStates = new Map();
const revisions = new Map();
function enqueue(work) {
  const result = writes.then(work);
  writes = result.catch(() => {});
  return result;
}
async function showToolbar(tabId, supported, revision) {
  if (revisions.get(tabId) !== revision) return;
  const path = Object.fromEntries([16, 32].map((size) => [size, supported ? 'icons/icon-' + size + '.png' : 'icons/icon-gray-' + size + '.png']));
  try {
    await Promise.all([
      chrome.action.setIcon({ tabId, path }),
      chrome.action.setTitle({ tabId, title: supported ? 'Auto Advance — ready on Shorts/Reels' : 'Auto Advance — open a YouTube Short or Instagram Reel' })
    ]);
    if (revisions.get(tabId) === revision) toolbarStates.set(tabId, supported);
  } catch { /* A tab may close during the update. */ }
}
async function refreshToolbar(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const revision = (revisions.get(tabId) || 0) + 1;
  revisions.set(tabId, revision);
  let status = app.pageStatus();
  try {
    const tab = await chrome.tabs.get(tabId);
    status = app.pageStatus(tab.pendingUrl || tab.url);
  } catch { /* The tab may have closed or its URL may be restricted. */ }
  await showToolbar(tabId, status.supported, revision);
  return { ...status, tabId };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'auto-advance:page-state' && sender.tab && sender.frameId === 0) {
    refreshToolbar(sender.tab.id).then(() => respond({ ok: true }));
    return true;
  }
  // Only extension pages can write preferences through this endpoint.
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (message?.type === 'auto-advance:tab-status' && Number.isInteger(message.tabId)) {
    refreshToolbar(message.tabId).then((status) => respond(status), () => respond({ supported: false, platform: null }));
    return true;
  }
  if (!['auto-advance:save-preferences', 'auto-advance:reset-preferences'].includes(message?.type)) return;
  enqueue(async () => {
    if (message.type === 'auto-advance:reset-preferences') return app.settings.write(app.settings.defaults);
    const patch = message.values;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid preferences');
    if (Object.hasOwn(patch, 'popupTheme')) {
      if (Object.keys(patch).length !== 1 || !['light', 'dark'].includes(patch.popupTheme)) throw new Error('Invalid theme');
      await chrome.storage.local.set({ popupTheme: patch.popupTheme });
      return { popupTheme: patch.popupTheme };
    }
    const keys = Object.keys(patch);
    if (!keys.length || keys.some((key) => !Object.hasOwn(app.settings.defaults, key))) throw new Error('Unknown preference');
    return app.settings.patch(patch);
  }).then((values) => respond({ ok: true, values }), (error) => {
    app.log.warn('Autosave failed', { error: error.name });
    respond({ ok: false });
  });
  return true; // Keep the worker alive even if the popup closes during a write.
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // URL changes include same-document pushState/replaceState navigation. A
  // loading notification must not leave a valid SPA route permanently gray.
  if (info.status || info.url || Object.hasOwn(info, 'discarded')) refreshToolbar(tabId);
});
chrome.tabs.onActivated.addListener(({ tabId }) => refreshToolbar(tabId));
chrome.tabs.onRemoved.addListener((tabId) => { revisions.delete(tabId); toolbarStates.delete(tabId); });
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  revisions.delete(removedTabId); toolbarStates.delete(removedTabId);
  refreshToolbar(addedTabId);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }).then((tabs) => {
    for (const tab of tabs) refreshToolbar(tab.id);
  }).catch(() => {});
});
async function refreshAll() {
  for (const tab of await chrome.tabs.query({})) refreshToolbar(tab.id);
}
chrome.runtime.onInstalled.addListener(() => {
  // Migrate old slider bounds and enforce visible-tab-only behavior.
  enqueue(async () => app.settings.write(await app.settings.read())).catch(() => {});
  refreshAll().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => refreshAll().catch(() => {}));
refreshAll().catch(() => {});
