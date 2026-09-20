(() => {
  'use strict';
  const app = globalThis.ShortAutoAdvance;
  const isContextValid = () => {
    try { return Boolean(chrome.runtime.id); } catch { return false; }
  };
  app.log.debug('Content script loaded — Auto Advance 0.1.0', { extensionId: chrome.runtime.id, ...app.log.route() });
  let controller = null;
  let unsubscribe = null;
  let pendingPatch = {};
  let stopped = false;
  let lastPageState = null;
  app.reportPageStatus = (supported) => {
    if (!isContextValid()) { stop(); return; }
    const signature = location.href + '|' + document.visibilityState + '|' + supported;
    if (signature === lastPageState) return;
    lastPageState = signature;
    try {
      chrome.runtime.sendMessage({ type: 'auto-advance:page-state' }).catch(() => { lastPageState = null; if (!isContextValid()) stop(); });
    } catch { lastPageState = null; if (!isContextValid()) stop(); }
  };
  const refreshAvailability = () => {
    lastPageState = null;
    app.reportPageStatus();
  };
  document.addEventListener('visibilitychange', refreshAvailability);
  window.addEventListener('focus', refreshAvailability);
  window.addEventListener('popstate', refreshAvailability);
  window.addEventListener('yt-navigate-finish', refreshAvailability);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'auto-advance:page-status') return;
    const Adapter = location.hostname.endsWith('youtube.com') ? app.YouTubeShortsAdapter : app.InstagramReelsAdapter;
    const supported = !stopped && new Adapter().isSupportedPage();
    app.log.changed('popup-page-status', 'Popup requested supported-page status', { supported });
    respond({ supported, platform: location.hostname.endsWith('youtube.com') ? 'YouTube Shorts' : 'Instagram Reels' });
  });
  async function start() {
    if (!isContextValid()) { stop(); return; }
    if (unsubscribe) { app.log.debug('Startup ignored: already initialized'); return; }
    stopped = false;
    lastPageState = null;
    // Subscribe first so a storage change cannot be lost while initial get awaits.
    unsubscribe = app.settings.subscribe((patch) => {
      if (controller) controller.updateSettings(patch);
      else pendingPatch = { ...pendingPatch, ...patch };
    });
    try {
      const settings = await app.settings.read();
      if (stopped) return;
      const Adapter = location.hostname.endsWith('youtube.com') ? app.YouTubeShortsAdapter : app.InstagramReelsAdapter;
      controller = new app.Controller(new Adapter(), { ...settings, ...pendingPatch }, {
        isContextValid, readCurrentSettings: () => app.settings.read()
      });
      // Select this extension's execution context in DevTools to request a snapshot.
      app.diagnostics = () => {
        const snapshot = controller ? { ...controller.snapshot(), reason: controller.suspensionReason(),
          settings: { ...controller.settings }, route: app.log.route() } : { status: 'stopped' };
        app.log.debug('Diagnostic snapshot', snapshot);
        return snapshot;
      };
      pendingPatch = {};
      controller.start();
    } catch (error) { app.log.warn('Startup failed. Reload this page after reloading the extension.', { error: error.name }); }
  }
  function stop() {
    if (stopped) return;
    app.log.debug('Content script stopping: page left or extension context invalidated');
    stopped = true;
    controller?.dispose(); controller = null;
    try { unsubscribe?.(); } catch { /* An invalidated context cannot access Chrome listeners. */ }
    unsubscribe = null;
  }
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', (event) => { if (event.persisted) { app.log.debug('Page restored from browser cache: restarting'); start(); } });
  start();
})();
