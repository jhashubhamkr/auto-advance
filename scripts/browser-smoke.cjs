'use strict';
// Optional browser tests. Install Playwright separately or point PLAYWRIGHT_MODULE
// at an existing installation. No browser dependency ships with the extension.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const scripts = ['settings', 'playback-monitor', 'adapter-utils', 'youtube-shorts-adapter', 'instagram-reels-adapter', 'controller'];
const style = '<style>body{margin:0} main,ytd-shorts{display:block;position:relative;width:100vw;height:800px;overflow-y:auto;scroll-snap-type:y mandatory} article,ytd-reel-video-renderer{display:block;position:relative;height:800px;scroll-snap-align:start} video{display:block;width:400px;height:700px;margin:auto}button{min-width:44px;min-height:44px} [role=dialog]{position:fixed;inset:0;background:white}</style>';
async function load(page, url, html) {
  await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: style + html }));
  await page.goto(url);
  for (const name of scripts) await page.addScriptTag({ path: path.join(root, 'content', `${name}.js`) });
  await page.evaluate(() => ShortAutoAdvance.log.setEnabled(true)); // Fixture diagnostics only.
}
async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  let passed = 0;
  const results = [];
  async function check(name, work) { await work(); passed++; results.push(name); console.log(`PASS ${name}`); }
  try {
    const yt = await context.newPage();
    await load(yt, 'https://www.youtube.com/shorts/a', '<ytd-shorts><ytd-reel-video-renderer video-id="a" is-active><video id="a"></video></ytd-reel-video-renderer><ytd-reel-video-renderer video-id="b"><video id="b"></video></ytd-reel-video-renderer><div id="navigation-button-down" style="position:fixed;right:30px;top:400px"><button aria-label="localized next">↓</button></div></ytd-shorts>');
    await check('YouTube visible active identity, stable replacement and native localized control', async () => {
      const result = await yt.evaluate(() => {
        const a = new ShortAutoAdvance.YouTubeShortsAdapter();
        let clicks = 0; document.querySelector('button').onclick = () => clicks++;
        const old = a.findActiveVideo(), id = a.getVideoIdentity(old);
        old.replaceWith(old.cloneNode()); const replacement = a.findActiveVideo();
        return { id, same: a.getVideoIdentity(replacement) === id, navigated: a.advanceToNext(replacement), clicks };
      });
      assert.deepEqual(result, { id: 'youtube:a', same: true, navigated: true, clicks: 1 });
    });
    await check('YouTube next-container fallback and preloaded selection', async () => {
      await yt.evaluate(() => { const a = new ShortAutoAdvance.YouTubeShortsAdapter(); a.advanceToNext(a.findActiveVideo(), 1); });
      await yt.waitForFunction(() => new ShortAutoAdvance.YouTubeShortsAdapter().findActiveVideo()?.id === 'b');
    });
    await check('SPA URL changes without DOM mutations detected; normal route remains dormant', async () => {
      await yt.evaluate(() => {
        window.changes = 0; window.observed = new ShortAutoAdvance.YouTubeShortsAdapter();
        observed.observePageChanges(() => changes++); history.pushState({}, '', '/watch?v=normal');
      });
      await yt.waitForFunction(() => changes > 0);
      assert.equal(await yt.evaluate(() => observed.findActiveVideo()), null);
      await yt.evaluate(() => { history.replaceState({}, '', '/shorts/b'); });
      await yt.waitForFunction(() => changes > 1); await yt.evaluate(() => observed.dispose());
    });
    await check('YouTube Sponsored companion cards: current card/feed accepted; hidden, covered, unrelated and preloaded labels ignored', async () => {
      const page = await context.newPage();
      await load(page, 'https://www.youtube.com/shorts/first', '<ytd-shorts><ytd-reel-video-renderer video-id="first" is-active><video></video></ytd-reel-video-renderer><ytd-reel-video-renderer video-id="second"><video></video></ytd-reel-video-renderer></ytd-shorts>');
      const outcomes = await page.evaluate(() => {
        const adapter = new ShortAutoAdvance.YouTubeShortsAdapter(), video = document.querySelector('video');
        const item = video.parentElement, feed = item.parentElement, second = feed.querySelector('[video-id="second"]');
        const panel = document.createElement('section');
        panel.style.cssText = 'position:fixed;left:10px;bottom:20px;width:300px;padding:10px;background:#333;color:white;z-index:2';
        panel.innerHTML = '<div>Advertiser</div><span>Sponsored</span><a style="display:block;color:white" href="https://advertiser.invalid/">Visit site</a>';
        const detected = () => Boolean(adapter.getAdEvidence(video));
        const result = { normal: detected() };
        item.append(panel); result.currentCard = detected();
        feed.append(panel); result.companion = detected();
        panel.hidden = true; result.hidden = detected(); panel.hidden = false;
        panel.style.opacity = '0'; result.transparent = detected(); panel.style.opacity = '';
        panel.style.transform = 'translateX(-1500px)'; result.offscreen = detected(); panel.style.transform = '';
        const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;z-index:5;background:white';
        document.body.append(cover); result.covered = detected(); cover.remove();
        document.body.append(panel); result.outsideFeed = detected();
        second.append(panel); result.otherCard = detected();
        feed.append(panel); panel.setAttribute('video-id', 'second'); result.wrongId = detected(); panel.removeAttribute('video-id');
        panel.querySelector('span').textContent = 'This video is Sponsored'; result.caption = detected();
        panel.querySelector('span').textContent = 'Sponsored'; panel.querySelector('a').hidden = true; result.noVisibleAction = detected(); panel.querySelector('a').hidden = false;
        second.style.cssText = 'position:fixed;inset:0'; result.overlappingCards = detected(); second.style.cssText = '';
        item.setAttribute('video-id', 'stale'); result.routeMismatch = detected();
        return result;
      });
      assert.deepEqual(outcomes, { normal: false, currentCard: true, companion: true, hidden: false, transparent: false, offscreen: false,
        covered: false, outsideFeed: false, otherCard: false, wrongId: false, caption: false, noVisibleAction: false, overlappingCards: false, routeMismatch: false });
      await page.close();
    });
    await check('Supplied YouTube ad overlay: Apply now and metadata variants detected; hidden duplicate and other-video overlays ignored', async () => {
      const page = await context.newPage();
      const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/youtube-sponsored-overlay.html'), 'utf8');
      await load(page, 'https://www.youtube.com/shorts/first', '<style>reels-player-overlay-layout-view-model{display:block;position:fixed;left:10px;bottom:20px;width:300px;background:#333;color:white} reels-ad-card-buttoned-view-model,reels-ad-metadata-view-model,yt-ad-metadata-shape,ad-button-view-model{display:block} .ytwReelsPlayerOverlayLayoutViewModelHostActionBar,.ytwReelsPlayerOverlayLayoutViewModelHide{display:none} ad-button-view-model a{display:block;padding:12px}</style><ytd-shorts><ytd-reel-video-renderer video-id="first" is-active><video></video>' + fixture + '</ytd-reel-video-renderer><ytd-reel-video-renderer video-id="second"><video></video></ytd-reel-video-renderer></ytd-shorts>');
      const outcomes = await page.evaluate(() => {
        const adapter = new ShortAutoAdvance.YouTubeShortsAdapter(), video = document.querySelector('video');
        const overlay = document.querySelector('reels-player-overlay-layout-view-model');
        const expanded = overlay.querySelector('reels-ad-card-buttoned-view-model').parentElement;
        const collapsed = overlay.querySelector('reels-ad-metadata-view-model').parentElement;
        // Evaluate the fully transparent state, not the first frame of the
        // supplied markup's 300ms opacity transition.
        collapsed.style.transition = 'none';
        const detected = () => Boolean(adapter.getAdEvidence(video));
        const result = { applyNow: detected() };
        expanded.querySelector('ad-button-view-model a').textContent = 'A different advertising action'; result.otherButtonText = detected();
        expanded.setAttribute('aria-hidden', 'true'); result.hiddenDuplicateOnly = detected();
        collapsed.setAttribute('aria-hidden', 'false'); collapsed.classList.remove('ytwReelsPlayerOverlayLayoutViewModelHide'); result.metadataOnly = detected();
        collapsed.style.opacity = '0'; result.transparent = detected(); collapsed.style.opacity = '';
        document.querySelector('[video-id="second"]').append(overlay); result.otherCard = detected();
        document.querySelector('ytd-shorts').append(overlay); result.feedCompanion = detected();
        document.body.append(overlay); result.outsideFeed = detected();
        return result;
      });
      assert.deepEqual(outcomes, { applyNow: true, otherButtonText: true, hiddenDuplicateOnly: false, metadataOnly: true,
        transparent: false, otherCard: false, feedCompanion: true, outsideFeed: false });
      await page.close();
    });
    const ig = await context.newPage();
    await load(ig, 'https://www.instagram.com/reels/', '<main><article><video id="a"></video><a href="/reel/AAA/">Reel</a><button aria-label="Like">Like</button><button aria-label="Next">Carousel next</button></article><article><video id="b"></video><a href="/reel/BBB/">Reel</a></article></main>');
    await check('Instagram ignores unrelated buttons and uses next card; shortcode beats stale URL', async () => {
      const result = await ig.evaluate(() => {
        const a = new ShortAutoAdvance.InstagramReelsAdapter(); let clicks = 0;
        document.querySelectorAll('button').forEach((b) => { b.onclick = () => clicks++; });
        const id = a.getVideoIdentity(a.findActiveVideo()); const acted = a.advanceToNext(a.findActiveVideo());
        return { id, acted, clicks };
      });
      assert.deepEqual(result, { id: 'instagram:AAA', acted: true, clicks: 0 });
      await ig.waitForFunction(() => new ShortAutoAdvance.InstagramReelsAdapter().findActiveVideo()?.id === 'b');
      assert.equal(await ig.evaluate(() => { history.replaceState({}, '', '/reel/AAA/'); const a = new ShortAutoAdvance.InstagramReelsAdapter(); return a.getVideoIdentity(a.findActiveVideo()); }), 'instagram:BBB');
    });
    await check('unrelated foreground Instagram dialog blocks background automation', async () => {
      await ig.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><button>Settings</button></div>'));
      assert.equal(await ig.evaluate(() => new ShortAutoAdvance.InstagramReelsAdapter().findActiveVideo()), null);
    });
    await check('Instagram Reel modal selected ahead of background video', async () => {
      await ig.evaluate(() => { document.querySelector('[role=dialog]').innerHTML = '<article><video id="modal"></video><a href="/reel/MODAL/">Reel</a><button aria-label="Next reel">Next reel</button></article>'; });
      const result = await ig.evaluate(() => { const a = new ShortAutoAdvance.InstagramReelsAdapter(); const v = a.findActiveVideo(); return [v.id, a.getVideoIdentity(v)]; });
      assert.deepEqual(result, ['modal', 'instagram:MODAL']);
    });
    await check('Instagram diagnostics distinguish missing scope from unavailable next strategy', async () => {
      const result = await ig.evaluate(() => {
        const records = []; const original = console.info;
        console.info = (...args) => records.push(args);
        try {
          const adapter = new ShortAutoAdvance.InstagramReelsAdapter();
          document.body.innerHTML = '<video></video>';
          adapter.findActiveVideo();
          document.body.innerHTML = '<main><article><video></video><a href="/reel/SINGLE/">Reel</a></article></main>';
          const video = adapter.findActiveVideo(); adapter.getVideoIdentity(video);
          const acted = adapter.advanceToNext(video);
          return { acted, records };
        } finally { console.info = original; }
      });
      assert.equal(result.acted, false);
      assert.ok(result.records.some(([message, detail]) => message.includes('inspecting player scope') && detail.scope === 'missing main/dialog'));
      assert.ok(result.records.some(([message, detail]) => message.includes('unique video identity') && detail.videoId === 'instagram:SINGLE'));
      assert.ok(result.records.some(([message, detail]) => message.includes('navigation strategy selection') && detail.availableStrategies.length === 0));
    });
    await check('player-gap retention allows a hidden surface but rejects offscreen cards, ads and foreground dialogs', async () => {
      const gap = await context.newPage();
      await load(gap, 'https://www.youtube.com/shorts/first', '<ytd-shorts><ytd-reel-video-renderer video-id="first" is-active><video></video></ytd-reel-video-renderer></ytd-shorts>');
      const youtube = await gap.evaluate(() => {
        const adapter = new ShortAutoAdvance.YouTubeShortsAdapter(), video = document.querySelector('video'), card = video.parentElement;
        video.setAttribute('aria-hidden', 'true');
        const hiddenSurface = adapter.canRetainVideo(video), noSelection = adapter.findActiveVideo() === null;
        card.style.transform = 'translateY(-1000px)'; const offscreen = adapter.canRetainVideo(video); card.style.transform = '';
        card.classList.add('ad-showing'); const ad = adapter.canRetainVideo(video); card.classList.remove('ad-showing');
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog">Settings</div>'); const dialog = adapter.canRetainVideo(video);
        return { hiddenSurface, noSelection, offscreen, ad, dialog };
      });
      assert.deepEqual(youtube, { hiddenSurface: true, noSelection: true, offscreen: false, ad: false, dialog: false });
      const instagram = await ig.evaluate(() => {
        const adapter = new ShortAutoAdvance.InstagramReelsAdapter(), video = document.querySelector('video');
        video.setAttribute('aria-hidden', 'true'); const hiddenSurface = adapter.canRetainVideo(video);
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog">Settings</div>'); const dialog = adapter.canRetainVideo(video);
        return { hiddenSurface, dialog };
      });
      assert.deepEqual(instagram, { hiddenSurface: true, dialog: false });
      await gap.close();
    });
    await check('actual 650 ms video produces three native-loop completions', async () => {
      // Original local 650 ms VP8 fixture. Nothing is downloaded.
      const media = await context.newPage(); await media.goto('about:blank'); await media.bringToFront();
      for (const name of ['settings', 'playback-monitor']) await media.addScriptTag({ path: path.join(root, 'content', `${name}.js`) });
      const result = await media.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const video = document.createElement('video'); video.muted = true; video.loop = true; video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' })); document.body.append(video);
        const events = []; for (const type of ['ended', 'seeking', 'seeked']) video.addEventListener(type, () => events.push(type));
        const signals = []; const monitor = new ShortAutoAdvance.PlaybackMonitor(video, (s) => signals.push(s));
        await video.play();
        await new Promise((resolve, reject) => {
          const timer = setInterval(() => { if (signals.length >= 3) { clearInterval(timer); clearTimeout(timeout); resolve(); } }, 50);
          const timeout = setTimeout(() => { clearInterval(timer); reject(new Error(JSON.stringify({ duration: video.duration, time: video.currentTime, signals, events }))); }, 7000);
        });
        monitor.dispose(); video.pause(); URL.revokeObjectURL(video.src);
        return { signals, events };
      }, fs.readFileSync(path.join(root, 'tests/fixtures/short.webm')).toString('base64'));
      assert.ok(result.signals.length >= 3); assert.ok(result.events.includes('seeking')); assert.ok(!result.events.includes('ended'));
    });
    const popup = await context.newPage();
    const popupErrors = [];
    popup.on('pageerror', (error) => popupErrors.push(error.message));
    popup.on('requestfailed', (request) => popupErrors.push(request.url()));
    await popup.route('https://auto-advance.test/**', (route) => {
      const file = path.join(root, new URL(route.request().url()).pathname);
      const contentType = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
      return route.fulfill({ contentType, body: fs.readFileSync(file) });
    });
    await popup.addInitScript(() => {
      window.persisted = JSON.parse(sessionStorage.getItem('preferences') || '{}');
      window.pageSupported = true;
      let queue = Promise.resolve();
      const event = () => ({ listeners: new Set(), addListener(fn) { this.listeners.add(fn); }, removeListener(fn) { this.listeners.delete(fn); }, fire(...args) { for (const fn of this.listeners) fn(...args); } });
      window.chrome = {
        tabs: { query: async () => [{ id: 1 }], onActivated: event(), onUpdated: event(), sendMessage: async () => { throw new Error('No receiver'); } },
        windows: { onFocusChanged: event() },
        runtime: { sendMessage(message) {
          if (message.type === 'auto-advance:tab-status') return Promise.resolve({ supported: window.pageSupported, platform: 'YouTube Shorts', tabId: message.tabId });
          const result = queue.then(async () => {
            if (window.storageDelay) await new Promise((resolve) => setTimeout(resolve, window.storageDelay));
            if (window.failSave) return { ok: false };
            const defaults = window.ShortAutoAdvance.settings.defaults;
            const raw = message.type === 'auto-advance:reset-preferences' ? defaults : message.values;
            const normalized = window.ShortAutoAdvance.settings.normalize(raw);
            const values = Object.fromEntries(Object.keys(raw).map((key) => [key, key === 'popupTheme' ? raw[key] : normalized[key]]));
            window.saved = values; Object.assign(window.persisted, values);
            chrome.storage.onChanged.fire(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local');
            sessionStorage.setItem('preferences', JSON.stringify(window.persisted));
            return { ok: true, values };
          });
          queue = result.catch(() => {});
          return result;
        } },
        storage: { onChanged: event(), local: { get: async (keys) => {
          if (Array.isArray(keys) && sessionStorage.getItem('failRead')) throw new Error('Read unavailable');
          return window.persisted;
        } } }
      };
    });
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto('https://auto-advance.test/popup/popup.html');
    const range = async (id, value) => popup.locator('#' + id).evaluate((el, next) => {
      el.value = next; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, String(value));
    async function capture(name) {
      await popup.locator('.accordion-inner').evaluate((el) => { el.scrollTop = 0; });
      await popup.waitForFunction(() => !document.querySelector('#status').classList.contains('fading') && getComputedStyle(document.querySelector('#status')).opacity === '1');
      await popup.locator('body').screenshot({ animations: 'disabled', path: path.join(output, name) });
    }
    await check('compact SVG popup, automatic master and fixed transient footer without layout shifts', async () => {
      await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
      assert.equal(await popup.locator('#advanced-panel').evaluate((el) => el.inert), true);
      assert.ok(await popup.locator('body').evaluate((el) => el.getBoundingClientRect().height < 270));
      assert.equal(await popup.locator('#onlyWhenTabVisible').count(), 0);
      assert.equal(await popup.getByRole('button', { name: 'Save settings' }).count(), 0);
      assert.equal(await popup.locator('img').count(), 0);
      assert.match(await popup.locator('.brand-icon').evaluate((el) => getComputedStyle(el).backgroundImage), /auto-advance.svg/);
      await capture('popup-light-compact.png');
      const masterRect = await popup.locator('.master').boundingBox();
      const disclosureRect = await popup.locator('#advanced-toggle').boundingBox();
      await popup.locator('#advanced-toggle').hover();
      assert.ok(disclosureRect.y - masterRect.y - masterRect.height >= 10, 'Hover background needs a real gap above Settings');
      assert.equal(await popup.locator('#advanced-toggle').evaluate((el) => getComputedStyle(el).paddingLeft), '12px');
      await capture('popup-settings-hover.png');
      const before = await popup.locator('footer').boundingBox();
      await popup.locator('#enabled').uncheck();
      await popup.waitForFunction(() => persisted.enabled === false && document.querySelector('#status').textContent === 'Saved');
      assert.equal(await popup.locator('#status').getAttribute('class'), 'success');
      await popup.waitForFunction(() => document.querySelector('#status').textContent === 'Ready to work');
      assert.deepEqual(await popup.locator('footer').boundingBox(), before);
      assert.equal(await popup.locator('#github-link .brand').evaluate((el) => el.getBoundingClientRect().width), 24);
      assert.equal(await popup.locator('#github-link').getAttribute('href'), 'https://github.com/jhashubhamkr/auto-advance');
      assert.match(await popup.locator('#github-link').getAttribute('rel'), /noopener/);
    });
    await check('horizontal platform toggles and keyboard-accessible autosaving ranges with correct units', async () => {
      await popup.getByRole('button', { name: 'Settings', exact: true }).click();
      await popup.getByRole('button', { name: 'YouTube Shorts' }).click();
      await popup.waitForFunction(() => persisted.youtubeEnabled === false);
      assert.equal(await popup.locator('#youtubeEnabled').getAttribute('aria-pressed'), 'false');
      const youtube = await popup.locator('#youtubeEnabled').boundingBox(), instagram = await popup.locator('#instagramEnabled').boundingBox();
      assert.equal(youtube.y, instagram.y); assert.ok(instagram.x > youtube.x);
      await popup.getByRole('button', { name: 'YouTube Shorts' }).click();
      await popup.locator('#repeatCount').focus(); await popup.keyboard.press('ArrowRight');
      await popup.waitForFunction(() => persisted.repeatCount === 1);
      await popup.locator('#repeatCount').press('End');
      await popup.waitForFunction(() => persisted.repeatCount === 6);
      await popup.locator('#repeatCount').press('Home');
      await popup.waitForFunction(() => persisted.repeatCount === 0);
      await popup.locator('#advanceDelayMs').focus(); await popup.keyboard.press('ArrowRight');
      await popup.waitForFunction(() => persisted.advanceDelayMs === 500);
      assert.equal(await popup.locator('#advanceDelayMs-value').textContent(), '0.5s');
      await popup.locator('#advanceDelayMs').press('Home'); await popup.waitForFunction(() => persisted.advanceDelayMs === 100);
      await popup.locator('#advanceDelayMs').press('End'); await popup.waitForFunction(() => persisted.advanceDelayMs === 3000);
      assert.equal(await popup.locator('#durationLimitSeconds').isDisabled(), true);
      await popup.locator('#durationLimitEnabled').check();
      await popup.locator('#durationLimitSeconds').press('ArrowRight');
      await popup.waitForFunction(() => persisted.durationLimitEnabled === true && persisted.durationLimitSeconds === 61);
      await popup.locator('#durationLimitSeconds').press('Home'); await popup.waitForFunction(() => persisted.durationLimitSeconds === 30);
      await popup.locator('#durationLimitSeconds').press('End'); await popup.waitForFunction(() => persisted.durationLimitSeconds === 120);
      const aligned = await popup.evaluate(() => {
        const label = document.querySelector('label[for="repeatCount"]').getBoundingClientRect();
        const value = document.querySelector('#repeatCount-value').getBoundingClientRect();
        return Math.abs(label.y + label.height / 2 - value.y - value.height / 2) < 1 && value.x > label.x;
      });
      assert.equal(aligned, true);
      assert.ok(await popup.locator('#repeatCount').evaluate((el) => el.getBoundingClientRect().width > 290));
    });
    await check('rapid autosave writes keep the last value; reset restores all playback defaults and preserves theme', async () => {
      await popup.getByRole('button', { name: 'Switch to dark theme' }).click();
      await popup.waitForFunction(() => persisted.popupTheme === 'dark');
      await popup.evaluate(() => { window.storageDelay = 30; });
      await range('repeatCount', 4); await range('repeatCount', 2); await range('repeatCount', 6);
      await popup.waitForFunction(() => persisted.repeatCount === 6);
      await popup.getByRole('button', { name: 'Reset settings' }).click();
      await popup.waitForFunction(() => document.querySelector('#status').textContent === 'Settings restored');
      const stored = await popup.evaluate(() => persisted);
      assert.equal(stored.enabled, true); assert.equal(stored.youtubeEnabled, true); assert.equal(stored.instagramEnabled, true);
      assert.equal(stored.repeatCount, 0); assert.equal(stored.advanceDelayMs, 400);
      assert.equal(stored.durationLimitEnabled, false); assert.equal(stored.durationLimitSeconds, 60);
      assert.equal(stored.onlyWhenTabVisible, true); assert.equal(stored.popupTheme, 'dark');
      await popup.evaluate(() => { window.storageDelay = 0; });
      await popup.waitForFunction(() => document.querySelector('#status').textContent === 'Ready to work');
      await capture('popup-dark-expanded.png');
    });
    await check('footer remains pinned during settings scroll; theme and values survive reopening', async () => {
      await popup.locator('body').evaluate((el) => { el.style.maxHeight = '430px'; });
      assert.ok(await popup.locator('.accordion-inner').evaluate((el) => el.scrollHeight > el.clientHeight));
      const footer = await popup.locator('footer').boundingBox();
      await popup.locator('.accordion-inner').evaluate((el) => { el.scrollTop = 1000; });
      assert.deepEqual(await popup.locator('footer').boundingBox(), footer);
      assert.ok(footer.y + footer.height <= 430);
      await popup.locator('body').evaluate((el) => { el.style.maxHeight = ''; });
      const color = await popup.locator('#github-link').evaluate((el) => getComputedStyle(el).color);
      await popup.locator('#github-link').hover();
      await popup.waitForFunction((old) => getComputedStyle(document.querySelector('#github-link')).color !== old, color);
      await range('repeatCount', 2);
      await popup.waitForFunction(() => persisted.repeatCount === 2);
      await popup.reload();
      await popup.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && !document.querySelector('#enabled').disabled);
      assert.equal(await popup.locator('#repeatCount').inputValue(), '2');
      assert.equal(await popup.locator('#advanced-toggle').getAttribute('aria-expanded'), 'false');
      await capture('popup-dark-compact.png');
      await popup.getByRole('button', { name: 'Switch to light theme' }).click();
      await popup.getByRole('button', { name: 'Settings', exact: true }).click();
      await popup.waitForFunction(() => document.querySelector('#status').textContent === 'Ready to work');
      await capture('popup-light-expanded.png'); await capture('popup.png');
    });
    await check('unsupported routes disable playback controls, retain theme/link, and collapse settings', async () => {
      await popup.evaluate(() => { window.pageSupported = false; chrome.tabs.onActivated.fire({ tabId: 2 }); });
      await popup.waitForFunction(() => document.querySelector('#enabled').disabled);
      assert.equal(await popup.locator('#advanced-toggle').isDisabled(), true);
      assert.equal(await popup.locator('#advanced-panel').evaluate((el) => el.inert), true);
      assert.equal(await popup.locator('#theme-toggle').isEnabled(), true);
      await popup.waitForFunction(() => document.querySelector('#status').textContent === 'Open Shorts or Reels');
      await capture('popup-disabled.png');
      assert.match(await popup.locator('#advanced-toggle').getAttribute('title'), /Short/);
      await popup.evaluate(() => { window.pageSupported = true; chrome.tabs.onActivated.fire({ tabId: 1 }); });
      await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
      await popup.evaluate(() => { window.pageSupported = false; chrome.tabs.onUpdated.fire(1, { url: 'https://www.youtube.com/watch?v=a' }); });
      await popup.waitForFunction(() => document.querySelector('#enabled').disabled);
      await popup.evaluate(() => { window.pageSupported = true; chrome.tabs.onUpdated.fire(1, { url: 'https://www.youtube.com/shorts/a' }); });
      await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
    });
    await check('failed autosaves restore confirmed values and retries work without an explicit save button', async () => {
      await popup.getByRole('button', { name: 'Settings', exact: true }).click();
      await popup.evaluate(() => { window.failSave = true; });
      await range('repeatCount', 4);
      await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('Could not save'));
      assert.equal(await popup.locator('#repeatCount').inputValue(), '2');
      assert.equal(await popup.evaluate(() => persisted.repeatCount), 2);
      await popup.locator('#enabled').click();
      await popup.waitForFunction(() => document.querySelector('#enabled').checked);
      await popup.evaluate(() => { window.failSave = false; });
      await range('repeatCount', 4); await popup.waitForFunction(() => persisted.repeatCount === 4);
      await popup.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await popup.locator('#status').evaluate((el) => getComputedStyle(el).transitionDuration), '0s');
      assert.deepEqual(popupErrors, []);
    });
    await check('initial read failure keeps controls disabled and reopening retries', async () => {
      await popup.evaluate(() => sessionStorage.setItem('failRead', 'true'));
      await popup.reload(); await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('Could not load settings'));
      assert.equal(await popup.locator('#enabled').isDisabled(), true);
      assert.equal(await popup.locator('#advanced-toggle').isDisabled(), true);
      await popup.evaluate(() => sessionStorage.removeItem('failRead'));
      await popup.reload(); await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
      assert.equal(await popup.locator('#repeatCount').inputValue(), '4');
    });
    await check('popup follows externally saved duration changes while open', async () => {
      for (const enabled of [true, false]) {
        await popup.evaluate((value) => {
          persisted.durationLimitEnabled = value;
          chrome.storage.onChanged.fire({ durationLimitEnabled: { newValue: value } }, 'local');
        }, enabled);
        assert.equal(await popup.locator('#durationLimitEnabled').isChecked(), enabled);
        assert.equal(await popup.locator('#durationLimitSeconds').isDisabled(), !enabled);
      }
    });
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ passed, tests: results, browser: browser.version(), liveSiteTests: 'Not run; fixture HTML and generated local media only.' }, null, 2));
    console.log(`${passed} browser fixture checks passed. Screenshot: test-results/popup.png`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
