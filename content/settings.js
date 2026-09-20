(() => {
  'use strict';
  // This namespace exists only in the extension's isolated world (and popup).
  const app = globalThis.ShortAutoAdvance = globalThis.ShortAutoAdvance || {};
  // Public builds are quiet. Diagnostics can be enabled in this isolated
  // DevTools context with ShortAutoAdvance.log.setEnabled(true).
  const DEBUG = false;
  let loggingEnabled = DEBUG;
  const lastMessages = new Map();
  const lastTimes = new Map();
  function output(level, event, details) {
    if (level === 'info' && !loggingEnabled) return;
    // Only pass explicit scalar snapshots, never live page elements or raw URLs.
    console[level](`[Auto Advance] ${new Date().toISOString()} ${event}`, details ?? '');
  }
  app.log = {
    debug: (event, details) => output('info', event, details),
    warn: (event, details) => output('warn', event, details),
    setEnabled(value) { loggingEnabled = Boolean(value); lastMessages.clear(); lastTimes.clear(); },
    changed(key, event, details) {
      if (!loggingEnabled) return;
      const signature = JSON.stringify([event, details]);
      if (lastMessages.get(key) === signature) return;
      lastMessages.set(key, signature); output('info', event, details);
    },
    throttle(key, event, details, intervalMs = 2000) {
      if (!loggingEnabled) return;
      const now = performance.now();
      if (now - (lastTimes.get(key) ?? -Infinity) < intervalMs) return;
      lastTimes.set(key, now); output('info', event, typeof details === 'function' ? details() : details);
    },
    identity(id) {
      if (!id?.includes(':source:')) return id;
      // A diagnostic-only fingerprint distinguishes changing fallback sources
      // without exposing their URLs. Actual identity comparison still uses id.
      let hash = 2166136261;
      for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
      return `${id.split(':')[0]}:source:fingerprint-${(hash >>> 0).toString(16)}`;
    },
    route() {
      const pathname = globalThis.location?.pathname || '';
      const match = pathname.match(/^\/(shorts|reels?)(?:\/([^/?#]+))?(?:\/|$)/);
      return { host: globalThis.location?.hostname, route: match ? match[0] : '(outside Shorts/Reels)', urlVideoId: match?.[2] || null };
    },
    media(video) {
      if (!video) return null;
      return { currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : String(video.duration),
        paused: video.paused, ended: video.ended, loop: video.loop, seeking: video.seeking,
        readyState: video.readyState, networkState: video.networkState, mediaErrorCode: video.error?.code || null };
    }
  };
  const defaults = Object.freeze({
    enabled: true, youtubeEnabled: true, instagramEnabled: true,
    repeatCount: 0, advanceDelayMs: 400, onlyWhenTabVisible: true,
    durationLimitEnabled: false, durationLimitSeconds: 60
  });
  function integer(value, fallback, max) {
    // Stored numbers and form strings are accepted; blanks, null and booleans aren't.
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && !value.trim()) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.trunc(number))) : fallback;
  }
  function normalize(raw = {}) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const result = { ...defaults };
    for (const key of ['enabled', 'youtubeEnabled', 'instagramEnabled', 'durationLimitEnabled']) {
      if (typeof raw[key] === 'boolean') result[key] = raw[key];
    }
    result.repeatCount = integer(raw.repeatCount, defaults.repeatCount, 6);
    result.advanceDelayMs = Math.max(100, Math.round(integer(raw.advanceDelayMs, defaults.advanceDelayMs, 3000) / 100) * 100);
    result.durationLimitSeconds = Math.max(30, integer(raw.durationLimitSeconds, defaults.durationLimitSeconds, 120));
    return result;
  }
  app.settings = {
    defaults, normalize,
    async read() {
      app.log.debug('Settings: loading from local storage');
      try {
        const raw = await chrome.storage.local.get(Object.keys(defaults));
        const next = normalize(raw);
        app.log.debug('Settings: loaded saved settings (defaults applied where needed)', { ...next });
        return next;
      } catch (error) { app.log.warn('Settings: failed to load local storage', { error: error.name }); throw error; }
    },
    async write(values) {
      const next = normalize(values);
      app.log.debug('Settings: saving to local storage', { ...next });
      try { await chrome.storage.local.set(next); app.log.debug('Settings: saved settings to local storage', { ...next }); return next; }
      catch (error) { app.log.warn('Settings: failed to save local storage', { error: error.name }); throw error; }
    },
    async patch(values) {
      // Independent controls must not commit a draft or overwrite the master switch.
      const normalized = normalize(values);
      const next = Object.fromEntries(Object.keys(defaults).filter((key) => Object.hasOwn(values, key)).map((key) => [key, normalized[key]]));
      try {
        await chrome.storage.local.set(next);
        app.log.debug('Settings: saved settings to local storage', next);
        return next;
      } catch (error) { app.log.warn('Settings: failed to save local storage', { error: error.name }); throw error; }
    },
    subscribe(callback) {
      const handler = (changes, area) => {
        if (area !== 'local') return;
        const patch = {};
        for (const key of Object.keys(defaults)) {
          if (Object.hasOwn(changes, key)) patch[key] = changes[key].newValue ?? defaults[key];
        }
        if (Object.keys(patch).length) {
          const safe = normalize(patch);
          app.log.debug('Settings: local storage changed; applying to this page', Object.fromEntries(Object.keys(patch).map((key) => [key, safe[key]])));
          callback(patch);
        }
      };
      chrome.storage.onChanged.addListener(handler);
      app.log.debug('Settings: listening for local storage changes');
      return () => { chrome.storage.onChanged.removeListener(handler); app.log.debug('Settings: storage listener removed'); };
    }
  };
})();
