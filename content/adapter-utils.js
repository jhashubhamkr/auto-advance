(() => {
  'use strict';
  const app = globalThis.ShortAutoAdvance;
  const ids = new WeakMap();
  let sequence = 0;
  function geometry(element) {
    if (!element || !element.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return null;
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return { rect, fraction: width * height / (rect.width * rect.height),
      distance: Math.hypot((rect.left + rect.right) / 2 - innerWidth / 2, (rect.top + rect.bottom) / 2 - innerHeight / 2) };
  }
  function select(videos, { container, active = () => false, exclude = () => false, platform = 'unknown' }) {
    let best = null;
    let score = -Infinity;
    const candidates = [];
    for (const video of videos) {
      const candidateId = identity(video, platform);
      if (!container(video)) { candidates.push({ candidateId, rejected: 'no supported card/container' }); continue; }
      if (exclude(video)) { candidates.push({ candidateId, rejected: 'ad or unrelated page region' }); continue; }
      const g = geometry(video);
      if (!g) { candidates.push({ candidateId, rejected: 'hidden, disconnected, transparent, or zero size' }); continue; }
      if (g.fraction < 0.35) { candidates.push({ candidateId, rejected: 'less than 35% visible', visiblePercent: Math.round(g.fraction * 100) }); continue; }
      const candidate = g.fraction * 100 - g.distance / Math.max(innerHeight, innerWidth) * 35 +
        (!video.paused && !video.ended ? 8 : 0) + (active(video) ? 18 : 0);
      if (candidate > score) { best = video; score = candidate; }
      candidates.push({ candidateId, visiblePercent: Math.round(g.fraction * 100), score: Math.round(candidate), paused: video.paused, activeSlideHint: Boolean(active(video)) });
    }
    const report = { platform, candidateCount: candidates.length, selectedCandidate: best ? identity(best, platform) : null, candidates: candidates.slice(0, 20), omittedCandidates: Math.max(0, candidates.length - 20) };
    app.log.changed(`${platform}:selection`, 'Adapter: active-video candidate scan', report);
    return best;
  }
  function identity(element, prefix) {
    if (!ids.has(element)) ids.set(element, ++sequence);
    return `${prefix}:element:${ids.get(element)}`;
  }
  function enabledControl(element) {
    const g = geometry(element);
    return g && g.fraction > 0.5 && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  }
  function adLabel(container) {
    if (!container) return null;
    // Match a standalone disclosure, not a caption mentioning sponsors or a
    // creator's paid-partnership text. Only the active card's visible UI counts.
    for (const label of container.querySelectorAll('[aria-label="Sponsored"], [aria-label="Advertisement"], span, yt-formatted-string, a')) {
      if (label.children.length || label.closest('button, [role="button"], [hidden], [aria-hidden="true"]')) continue;
      const text = (label.getAttribute('aria-label') || label.textContent).trim();
      if (/^(Sponsored|Advertisement)$/i.test(text) && geometry(label)?.fraction > 0.5) return 'visible ' + text + ' disclosure';
    }
    return null;
  }
  function scrollParent(element) {
    for (let parent = element?.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 20) return parent;
    }
    return null; // Never scroll the unrelated page as a fallback.
  }
  function scrollFeed(video, container) {
    const parent = scrollParent(container);
    if (!parent) return false;
    const height = container.getBoundingClientRect().height;
    parent.scrollBy({ top: Math.max(height, parent.clientHeight * 0.85), behavior: 'smooth' });
    return true;
  }
  // Debounced structural/scroll observation only runs while a supported experience
  // is active. A cheap URL comparison catches page-world history changes without
  // injecting or monkey-patching the site's history methods in the MAIN world.
  function observe(adapter, callback) {
    let timer = null;
    let observer = null;
    let url = location.href;
    const schedule = () => {
      if (timer !== null) return;
      timer = setTimeout(() => { timer = null; callback(); }, 100);
    };
    const sync = () => {
      const supported = adapter.isSupportedPage();
      if (supported && !observer) {
        app.log.debug('SPA: watching DOM mutations and feed scrolling', { platform: adapter.platform });
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
          attributeFilter: ['src', 'href', 'class', 'style', 'is-active', 'aria-hidden', 'aria-modal', 'aria-label', 'hidden', 'video-id'] });
        document.addEventListener('scroll', schedule, true);
      } else if (!supported && observer) {
        app.log.debug('SPA: unsupported route; disconnecting DOM/scroll observers', { platform: adapter.platform });
        observer.disconnect(); observer = null;
        document.removeEventListener('scroll', schedule, true);
      }
    };
    const route = () => { url = location.href; app.log.debug('SPA: navigation detected', { platform: adapter.platform, ...app.log.route() }); sync(); schedule(); };
    const poll = setInterval(() => { if (location.href !== url) route(); }, 1000);
    window.addEventListener('popstate', route);
    window.addEventListener('yt-navigate-finish', route);
    window.addEventListener('resize', schedule);
    sync();
    return () => {
      app.log.debug('SPA: disposing observers and route safety timer', { platform: adapter.platform });
      clearTimeout(timer); clearInterval(poll); observer?.disconnect();
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('popstate', route);
      window.removeEventListener('yt-navigate-finish', route);
      window.removeEventListener('resize', schedule);
    };
  }
  app.adapterUtils = { geometry, select, identity, enabledControl, adLabel, scrollParent, scrollFeed, observe };
})();
