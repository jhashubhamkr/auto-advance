(() => {
  'use strict';
  const app = globalThis.ShortAutoAdvance;
  const u = app.adapterUtils;
  // Stable custom elements and IDs are preferred to generated class names.
  const selectors = Object.freeze({
    item: 'ytd-reel-video-renderer, ytm-shorts-lockup-view-model',
    feed: 'ytd-shorts, ytm-shorts',
    next: '#navigation-button-down button, button#navigation-button-down, #navigation-button-down [role="button"], button[aria-label="Next video"], button[aria-label="Scroll down"]'
  });
  class YouTubeShortsAdapter {
    constructor() { this.platform = 'youtube'; }
    isSupportedPage() { return /^\/(shorts)\/[^/]+/.test(location.pathname); }
    getActiveContainer(video) { return video?.closest(selectors.item) || null; }
    canRetainVideo(video) {
      // A buffering/loop transition may hide only the video surface. Retain its
      // monitor briefly only while its Shorts card is still visibly on screen.
      const item = this.getActiveContainer(video);
      if (!this.isSupportedPage() || !video?.isConnected || !item?.closest(selectors.feed) ||
          video.closest('.ad-showing, ytd-display-ad-renderer')) return false;
      if ([...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some((dialog) => u.geometry(dialog)?.fraction > 0 && !dialog.contains(video))) return false;
      return (u.geometry(item)?.fraction || 0) >= 0.35;
    }
    findActiveVideo() {
      if (!this.isSupportedPage()) return null;
      return u.select(document.querySelectorAll(`${selectors.feed.split(', ').join(' video, ')} video`), {
        platform: this.platform,
        container: (v) => this.getActiveContainer(v),
        active: (v) => this.getActiveContainer(v)?.hasAttribute('is-active')
      });
    }
    getSponsoredEvidence(video, item) {
      const feed = item.closest(selectors.feed);
      if (!feed) return null;
      const visible = (element) => {
        const geometry = u.geometry(element);
        if (!geometry || geometry.fraction <= 0.5) return false;
        // A preloaded companion card can have a normal bounding box while an
        // ancestor is transparent, or be clipped/covered by the active slide.
        for (let parent = element; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none') return false;
        }
        const rect = element.getBoundingClientRect();
        const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
        const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (element.contains(hit) || hit.contains(element)));
      };
      // Desktop Shorts can place the advertiser card beside the playback frame.
      // Search within this feed, not just the video player and not the whole page.
      const texts = document.createTreeWalker(feed, NodeFilter.SHOW_TEXT);
      for (let text = texts.nextNode(); text; text = texts.nextNode()) {
        if (!/^Sponsored$/i.test(text.textContent.trim())) continue;
        const label = text.parentElement;
        if (!label || !/^Sponsored$/i.test(label.textContent.trim()) || !visible(label)) continue;
        const owner = label.closest(selectors.item);
        if (owner && owner !== item) continue;
        const linkedId = label.closest('[video-id]')?.getAttribute('video-id');
        if (linkedId && linkedId !== item.getAttribute('video-id')) continue;
        if (label.closest('button, a, [role="button"], #description, #content-text, ytd-comments')) continue;
        // Shared feed-level companion panels must not describe another slide
        // entering/leaving the viewport during a swipe.
        if (!owner && [...feed.querySelectorAll(selectors.item)].some((other) =>
          other !== item && [...other.querySelectorAll('video')].some((v) => (u.geometry(v)?.fraction || 0) >= 0.35))) continue;
        // Observed desktop markup has two variants, one aria-hidden while the
        // other is shown. These explicit ad components already identify the
        // badge as advertising: CTA wording (e.g. Apply now) is irrelevant, and
        // the metadata-only variant has no CTA. visible() checks the whole
        // ancestor chain, including the variant's aria-hidden state via geometry.
        const badge = label.closest('ad-badge-view-model');
        const adPanel = badge?.closest('reels-ad-card-buttoned-view-model, reels-ad-metadata-view-model');
        const overlay = adPanel?.closest('reels-player-overlay-layout-view-model');
        if (overlay && feed.contains(overlay) && !adPanel.querySelector('video')) {
          return 'YouTube visible Sponsored badge in native reels ad overlay';
        }
        // Require an actual compact advertiser panel: a standalone disclosure
        // and a visible advertising action. A caption mentioning Sponsored or a
        // neighboring/preloaded badge alone is not sufficient evidence.
        for (let panel = label.parentElement, depth = 0; panel && panel !== item && panel !== feed && depth < 6; panel = panel.parentElement, depth++) {
          if (panel.querySelector('video')) break;
          const action = [...panel.querySelectorAll('a, button, [role="button"]')].find((el) =>
            /^(Visit site|Visit website|Learn more|Shop now|Sign up|Get offer|Download|Install now|Book now)$/i.test(el.textContent.trim()) && visible(el));
          if (!action) continue;
          return 'YouTube visible Sponsored advertiser card with advertising action in current Shorts feed';
        }
      }
      return null;
    }
    getAdEvidence(video) {
      const item = this.getActiveContainer(video);
      const geometry = u.geometry(video);
      if (!item || !geometry || geometry.fraction < 0.85 || this.findActiveVideo() !== video) return null;
      const routeId = location.pathname.match(/^\/shorts\/([^/?#]+)/)?.[1];
      const cardId = item.getAttribute('video-id');
      if (cardId && routeId && cardId !== routeId) return null;
      // A Shorts feed ad may be a dedicated slot rather than an ad-showing
      // player. The slot must contain this video; hidden preloaded slots elsewhere
      // in the card must not turn an ordinary Short into an advertisement.
      const slot = video.closest('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer');
      if (slot && item.contains(slot)) return 'YouTube current video inside its own ad slot';
      const sponsored = this.getSponsoredEvidence(video, item);
      if (sponsored) return sponsored;
      const player = video.closest('.ad-showing');
      if (!player || !(player === item || item.contains(player)) || player.querySelectorAll('video').length !== 1) return null;
      // A badge elsewhere in the card can describe the next/preloaded ad. A
      // recycled ad-showing class alone is also insufficient: require a visible
      // badge owned by this single-video player, not a sibling ad slot/player.
      const badge = [...player.querySelectorAll('ytd-ad-badge-renderer, .ytp-ad-badge, .ytp-ad-text')].find((el) =>
        el.closest('.ad-showing') === player && !el.closest('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer') && u.geometry(el)?.fraction > 0.5);
      return badge ? 'YouTube current ad player with its own visible ad badge' : null;
    }
    getVideoIdentity(video) {
      const item = this.getActiveContainer(video);
      // Identity must not depend on labels/classes that YouTube preloads or
      // recycles. Always retain the actual Short ID across ad-status changes.
      const identified = (id, source) => {
        app.log.changed('youtube:identity', 'YouTube: unique video identity identified', { videoId: app.log.identity(id), identitySource: source, urlVideoId: app.log.route().urlVideoId });
        return id;
      };
      const id = item?.getAttribute('video-id') || item?.querySelector('a[href*="/shorts/"]')?.getAttribute('href')?.match(/\/shorts\/([^/?#]+)/)?.[1];
      if (id) return identified(`youtube:${id}`, item?.getAttribute('video-id') ? 'video-id attribute' : 'Shorts link inside active card');
      // URL only describes the active slide; preloaded slides must use their own ID.
      if (item?.hasAttribute('is-active')) {
        const route = location.pathname.match(/\/shorts\/([^/?#]+)/)?.[1];
        if (route) return identified(`youtube:${route}`, 'URL ID (active slide)');
      }
      return identified(u.identity(item || video, 'youtube'), 'local container identity fallback');
    }
    advanceToNext(video, attempt = 0) {
      const item = this.getActiveContainer(video);
      const feed = item?.closest(selectors.feed);
      if (!feed) { app.log.debug('YouTube navigation unavailable: active Shorts feed missing'); return false; }
      const strategies = [];
      const button = [...feed.querySelectorAll(selectors.next)].find(u.enabledControl);
      if (button) strategies.push({ name: 'click visible native next/down control', run: () => { button.click(); return true; } });
      const items = [...feed.querySelectorAll(selectors.item)];
      const next = items[items.indexOf(item) + 1];
      if (items.includes(item) && next) strategies.push({ name: 'scroll next Short card into view', run: () => { next.scrollIntoView({ block: 'center', behavior: 'smooth' }); return true; } });
      if (u.scrollParent(item)) strategies.push({ name: 'scroll feed ancestor by one item', run: () => u.scrollFeed(video, item) });
      app.log.debug('YouTube: navigation strategy selection', { attempt: attempt + 1, visibleEnabledNextControl: Boolean(button), knownCards: items.length,
        hasNextCard: Boolean(next), availableStrategies: strategies.map((s) => s.name), selectedStrategy: strategies[attempt]?.name || 'none — refusing to guess' });
      return strategies[attempt]?.run() ?? false;
    }
    observePageChanges(callback) { this.cleanup?.(); this.cleanup = u.observe(this, callback); }
    dispose() { this.cleanup?.(); this.cleanup = null; }
  }
  app.YouTubeShortsAdapter = YouTubeShortsAdapter;
})();
