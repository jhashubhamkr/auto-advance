(() => {
  'use strict';
  const app = globalThis.ShortAutoAdvance;
  const u = app.adapterUtils;
  const selectors = Object.freeze({
    modal: '[role="dialog"], [aria-modal="true"]',
    reelLink: 'a[href*="/reel/"], a[href*="/reels/"]',
    next: 'button[aria-label="Next reel"], [role="button"][aria-label="Next reel"], button[aria-label="Next video"], [role="button"][aria-label="Next video"], button[aria-label="Scroll down"], [role="button"][aria-label="Scroll down"]',
    downIcon: 'svg[aria-label="Down chevron"]'
  });
  class InstagramReelsAdapter {
    constructor() { this.platform = 'instagram'; }
    isSupportedPage() { return /^\/reels?(?:\/|$)/.test(location.pathname); }
    scope() {
      const dialogs = [...document.querySelectorAll(selectors.modal)].filter((el) => u.geometry(el)?.fraction > 0);
      // An unrelated foreground dialog blocks background feed automation.
      return dialogs.at(-1) || document.querySelector('main, [role="main"]');
    }
    getActiveContainer(video) {
      const scope = this.scope();
      if (!video || !scope?.contains(video)) return null;
      const article = video.closest('article');
      if (article && scope.contains(article) && article.querySelectorAll('video').length === 1) return article;
      let candidate = null;
      // Instagram frequently omits article elements. Find a single-video card,
      // stopping before a parent encompassing adjacent preloaded Reels.
      for (let p = video.parentElement, depth = 0; p && p !== scope && depth < 10; p = p.parentElement, depth++) {
        if (p.querySelectorAll('video').length !== 1) break;
        const r = p.getBoundingClientRect();
        if (r.height > 0 && r.height <= innerHeight * 1.6) candidate = p;
        if (p.querySelector(selectors.reelLink)) return p;
      }
      return candidate;
    }
    findActiveVideo() {
      if (!this.isSupportedPage()) return null;
      const scope = this.scope();
      app.log.changed('instagram:scope', 'Instagram: inspecting player scope', {
        scope: !scope ? 'missing main/dialog' : scope.matches(selectors.modal) ? 'foreground dialog' : 'main feed',
        videosInScope: scope?.querySelectorAll('video').length || 0,
        videosOnPage: document.querySelectorAll('video').length
      });
      if (!scope) { app.log.throttle('instagram:no-scope', 'Instagram: cannot track playback because no supported main/dialog container was found'); return null; }
      return u.select(scope.querySelectorAll('video'), {
        platform: this.platform,
        container: (v) => this.getActiveContainer(v),
        active: (v) => Boolean(v.closest(selectors.modal)),
        exclude: (v) => Boolean(v.closest('aside, header, nav'))
      });
    }
    canRetainVideo(video) {
      // scope() excludes a background Reel when a different foreground dialog
      // opens; the visible card check excludes manual scrolling away.
      const container = this.getActiveContainer(video);
      return this.isSupportedPage() && Boolean(video?.isConnected) &&
        !video.closest('aside, header, nav') && (u.geometry(container)?.fraction || 0) >= 0.35;
    }
    getVideoIdentity(video) {
      const container = this.getActiveContainer(video);
      if (this.getAdEvidence(video)) return 'instagram:ad:' + u.identity(container || video, 'card') + ':source:' + (video.currentSrc || video.getAttribute('src') || 'pending');
      const identified = (id, source) => {
        app.log.changed('instagram:identity', 'Instagram: unique video identity identified', { videoId: app.log.identity(id), identitySource: source, urlVideoId: app.log.route().urlVideoId });
        return id;
      };
      for (const link of container?.querySelectorAll(selectors.reelLink) || []) {
        const id = link.getAttribute('href')?.match(/\/reels?\/([^/?#]+)/)?.[1];
        if (id) return identified(`instagram:${id}`, 'Reel link inside active card');
      }
      // Only trust the route when this scope contains a single video. The main
      // feed can scroll before Instagram updates its URL.
      const route = location.pathname.match(/\/reels?\/([^/?#]+)/)?.[1];
      if (route && this.scope()?.querySelectorAll('video').length === 1) return identified(`instagram:${route}`, 'URL shortcode (single-video scope)');
      const stable = container?.getAttribute('data-media-id');
      if (stable) return identified(`instagram:${stable}`, 'data-media-id');
      const source = video.currentSrc || video.getAttribute('src');
      return source ? identified(`instagram:source:${source}`, 'media source fallback; source URL omitted from logs') : identified(u.identity(container || video, 'instagram'), 'local container identity fallback');
    }
    getAdEvidence(video) { return u.adLabel(this.getActiveContainer(video)); }
    advanceToNext(video, attempt = 0) {
      const container = this.getActiveContainer(video);
      const scope = this.scope();
      if (!container || !scope) { app.log.debug('Instagram navigation unavailable: active card or scope missing'); return false; }
      const strategies = [];
      // Use explicit Reel/down controls only in this card or its enclosing dialog.
      // Generic "Next" buttons may navigate carousels and are intentionally ignored.
      const controls = container.closest(selectors.modal) || container;
      const buttons = [...controls.querySelectorAll(selectors.next), ...[...controls.querySelectorAll(selectors.downIcon)].map((svg) => svg.closest('button, [role="button"]'))];
      const button = buttons.find((el) => el && !el.closest('a') && u.enabledControl(el));
      if (button) strategies.push({ name: 'click visible native next/down control', run: () => { button.click(); return true; } });
      const cards = [...new Set([...scope.querySelectorAll('video')].map((v) => this.getActiveContainer(v)).filter(Boolean))];
      const index = cards.indexOf(container);
      const next = index >= 0 ? cards[index + 1] : null;
      if (next) strategies.push({ name: 'scroll next Reel card into view', run: () => { next.scrollIntoView({ block: 'center', behavior: 'smooth' }); return true; } });
      if (u.scrollParent(container)) strategies.push({ name: 'scroll feed ancestor by one item', run: () => u.scrollFeed(video, container) });
      app.log.debug('Instagram: navigation strategy selection', { attempt: attempt + 1, matchingControls: buttons.filter(Boolean).length,
        visibleEnabledNextControl: Boolean(button), knownCards: cards.length, activeCardIndex: index, hasNextCard: Boolean(next),
        availableStrategies: strategies.map((s) => s.name), selectedStrategy: strategies[attempt]?.name || 'none — refusing to guess' });
      return strategies[attempt]?.run() ?? false;
    }
    observePageChanges(callback) { this.cleanup?.(); this.cleanup = u.observe(this, callback); }
    dispose() { this.cleanup?.(); this.cleanup = null; }
  }
  app.InstagramReelsAdapter = InstagramReelsAdapter;
})();
