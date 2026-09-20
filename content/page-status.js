(() => {
  'use strict';
  const app = globalThis.ShortAutoAdvance = globalThis.ShortAutoAdvance || {};
  // Availability describes the URL, not playback, focus, or saved preferences.
  app.pageStatus = (value) => {
    const result = { supported: false, platform: null };
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return result;
      if (['youtube.com', 'www.youtube.com'].includes(url.hostname)) {
        result.platform = 'YouTube Shorts';
        result.supported = /^\/shorts\/[^/]+/.test(url.pathname);
      } else if (['instagram.com', 'www.instagram.com'].includes(url.hostname)) {
        result.platform = 'Instagram Reels';
        result.supported = /^\/reels?(?:\/|$)/.test(url.pathname);
      }
    } catch { /* Restricted, missing and invalid tab URLs are unsupported. */ }
    return result;
  };
})();
