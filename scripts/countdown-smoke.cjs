'use strict';
// Actual MV3 injection and original local media, with controlled site fixtures.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const profile = path.join(output, `countdown-profile-${Date.now()}`);
const media = fs.readFileSync(path.join(root, 'tests/fixtures/short.webm'));
async function enableFixtureDiagnostics(context, page) {
  const session = await context.newCDPSession(page), worlds = [];
  session.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  try {
    await session.send('Runtime.enable');
    for (const world of worlds) {
      const result = await session.send('Runtime.evaluate', { contextId: world.id,
        expression: 'typeof ShortAutoAdvance !== "undefined" && (ShortAutoAdvance.log.setEnabled(true), true)', returnByValue: true });
      if (result.result.value === true) return;
    }
    throw new Error('Extension diagnostic context missing');
  } finally { await session.detach(); }
}
function html(platform, autoplay) {
  const yt = platform === 'youtube';
  const feed = yt ? 'ytd-shorts' : 'main', card = yt ? 'ytd-reel-video-renderer' : 'article';
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#151d25;color:white;font:16px system-ui} ${feed}{display:block;height:800px} ${card}{display:block;height:800px;position:relative} video{display:block;width:400px;height:700px;margin:auto;background:#223749} header{position:absolute;top:24px;left:calc(50% - 170px)} button{position:fixed;right:30px;top:380px;width:60px;height:50px} a{color:white} [hidden]{display:none!important}</style>
  <${feed}><${card} video-id="first" is-active><video muted loop ${autoplay ? 'autoplay' : ''} src="/fixture.webm"></video><header><span id="disclosure"></span></header><a href="/reel/FIRST/">Reel</a><a id="advertiser" href="https://advertiser.invalid/">Learn more</a>${yt ? '' : '<button aria-label="Next reel">↓</button>'}</${card}>
  <${card} video-id="second" hidden><video></video><a href="/reel/SECOND/">Reel</a></${card}>${yt ? '<div id="navigation-button-down"><button>↓</button></div>' : ''}</${feed}>
  <script>window.clicks=0;window.adClicks=0;window.siteClicks=0;document.addEventListener('click',()=>siteClicks++);document.querySelector('#advertiser').onclick=e=>{e.preventDefault();adClicks++;};document.querySelector('button').onclick=()=>{clicks++;document.querySelector('video').pause();const cards=document.querySelectorAll('${card}');cards[0].hidden=true;cards[1].hidden=false;cards[1].setAttribute('is-active','');history.pushState({},'', '${yt ? '/shorts/second' : '/reel/SECOND/'}');};</script>`;
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1100, height: 800 },
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'] });
  const results = [], errors = [];
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
    const preferences = await context.newPage(); await preferences.goto(`chrome-extension://${id}/popup/popup.html`);
    async function pageFor(platform, autoplay, settings) {
      // Use the same serialized writer as the popup so install-time preference
      // migration cannot overwrite fixture values with defaults mid-test.
      const saved = await preferences.evaluate((values) => chrome.runtime.sendMessage({ type: 'auto-advance:save-preferences', values: { enabled: true, youtubeEnabled: true, instagramEnabled: true, durationLimitEnabled: false, repeatCount: 0, advanceDelayMs: 3000, ...values } }), settings);
      assert.equal(saved?.ok, true);
      const page = await context.newPage(), logs = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.text().includes('[Auto Advance]')) logs.push(message.text()); });
      await page.route('**/*', (route) => route.request().url().endsWith('/fixture.webm')
        ? route.fulfill({ contentType: 'video/webm', body: media })
        : route.fulfill({ contentType: 'text/html', body: html(platform, autoplay) }));
      await page.goto(platform === 'youtube' ? 'https://www.youtube.com/shorts/first' : 'https://www.instagram.com/reel/FIRST/');
      await page.bringToFront();
      await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
      await enableFixtureDiagnostics(context, page);
      return { page, logs };
    }
    for (const [platform, repeatCount, keyboard] of [['youtube', 0, false], ['youtube', 1, true], ['instagram', 2, false]]) {
      const { page, logs } = await pageFor(platform, true, { repeatCount });
      try {
        const button = page.getByRole('button', { name: 'Watch again', exact: true });
        await button.waitFor({ state: 'visible', timeout: 12000 });
        const geometry = await page.evaluate(() => {
          const host = document.querySelector('[data-auto-advance-overlay]'), root = host.shadowRoot;
          const ring = root.querySelector('svg').getBoundingClientRect(), video = document.querySelector('video').getBoundingClientRect();
          return { size: ring.width, x: ring.x + ring.width / 2 - video.x - video.width / 2, y: ring.y + ring.height / 2 - video.y - video.height / 2,
            duration: root.querySelector('circle').getAnimations()[0].effect.getTiming().duration,
            easing: root.querySelector('circle').getAnimations()[0].effect.getTiming().easing,
            backdrop: getComputedStyle(root.querySelector('.countdown'), '::before').backgroundColor };
        });
        assert.deepEqual(geometry, { size: 96, x: 0, y: 0, duration: 3000, easing: 'ease-in-out', backdrop: 'rgba(5, 14, 24, 0.82)' });
        const color = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
        await button.hover();
        await page.waitForFunction((previous) => getComputedStyle(document.querySelector('[data-auto-advance-overlay]').shadowRoot.querySelector('button')).backgroundColor !== previous, color);
        if (platform === 'youtube' && repeatCount === 0) {
          await page.screenshot({ path: path.join(output, 'countdown-watch-again.png') });
          const panel = await page.locator('[data-auto-advance-overlay]').locator('.countdown').boundingBox();
          await page.screenshot({ path: path.join(output, 'countdown-detail.png'), clip: { x: panel.x - 20, y: panel.y - 22, width: panel.width + 40, height: panel.height + 44 } });
        }
        if (keyboard) { await button.focus(); await page.keyboard.press('Space'); } else await button.click();
        await page.waitForFunction(() => !document.querySelector('[data-auto-advance-overlay]'));
        assert.equal(await page.evaluate(() => clicks), 0);
        assert.equal(await page.evaluate(() => siteClicks), 0, 'Replay button must not click/pause the website player');
        assert.ok(logs.some((line) => line.includes('Watch again: cancelled skip, reset playback count to 0')));
        await button.waitFor({ state: 'visible', timeout: 12000 });
        const resetIndex = logs.findIndex((line) => line.includes('Watch again: cancelled skip'));
        assert.equal(logs.slice(resetIndex + 1).filter((line) => line.includes('Playback count incremented')).length, repeatCount + 1);
        await page.waitForFunction(() => clicks === 1, null, { timeout: 6000 });
        assert.equal(await page.locator('[data-auto-advance-overlay]').count(), 0);
        await page.waitForTimeout(300); assert.equal(await page.evaluate(() => clicks), 1);
        const result = `${platform} repeat ${repeatCount}: real media replay via ${keyboard ? 'keyboard' : 'mouse'}, full repeat cycle, centered 96px ring and one navigation`;
        results.push(result); console.log('PASS ' + result);
      } catch (error) {
        console.error('Replay fixture failure:', { platform, repeatCount, logs: logs.slice(-20) });
        throw error;
      } finally { await page.close(); }
    }
    for (const kind of ['youtube', 'youtube-slot', 'instagram']) {
      const platform = kind === 'youtube-slot' ? 'youtube' : kind;
      const { page, logs } = await pageFor(platform, false, { repeatCount: 6, advanceDelayMs: 1500 });
      try {
        await page.evaluate(() => { document.querySelector('#disclosure').textContent = 'This reel talks about sponsored videos'; });
        await page.waitForTimeout(200); assert.equal(await page.locator('[data-auto-advance-overlay]').count(), 0);
        await page.evaluate(() => { const label = document.querySelector('#disclosure'); label.hidden = true; label.textContent = 'Sponsored'; });
        await page.waitForTimeout(200); assert.equal(await page.locator('[data-auto-advance-overlay]').count(), 0);
        await page.evaluate((kind) => {
          if (kind === 'youtube-slot') {
            const video = document.querySelector('video'), slot = document.createElement('ytd-ad-slot-renderer');
            video.before(slot); slot.append(video);
          } else if (kind === 'youtube') {
            const player = document.querySelector('video').parentElement;
            player.classList.add('ad-showing');
            player.insertAdjacentHTML('beforeend', '<span class="ytp-ad-badge" style="position:absolute;top:30px;left:400px">Ad</span>');
          }
          else document.querySelector('#disclosure').hidden = false;
        }, kind);
        await page.getByText('Skipping Ad', { exact: true }).waitFor({ state: 'visible' });
        assert.equal(await page.getByRole('button', { name: 'Watch again' }).count(), 0);
        if (platform === 'youtube') await page.screenshot({ path: path.join(output, 'countdown-skipping-ad.png') });
        assert.equal(await page.evaluate(() => clicks), 0);
        await page.waitForFunction(() => clicks === 1, null, { timeout: 5000 });
        assert.equal(await page.evaluate(() => adClicks), 0);
        assert.equal(logs.filter((line) => line.includes('Playback count incremented')).length, 0);
        assert.ok(logs.some((line) => line.includes('Advertisement detected: queuing skip')));
        assert.equal(await page.locator('[data-auto-advance-overlay]').count(), 0);
        const result = `${kind}: late ad disclosure/state skips paused ad after delay, no advertiser clicks, captions/hidden labels ignored`;
        results.push(result); console.log('PASS ' + result);
      } finally { await page.close(); }
    }
    const recycled = await pageFor('youtube', false, { repeatCount: 6, advanceDelayMs: 1000 });
    try {
      const { page } = recycled;
      await page.evaluate(() => {
        const card = document.querySelector('video').parentElement;
        card.classList.add('ad-showing'); // Recycled player state from an earlier ad.
        card.insertAdjacentHTML('beforeend', '<ytd-ad-slot-renderer id="preloaded-ad" style="position:absolute;top:30px;left:400px"><span class="ytp-ad-badge">Ad</span><span>Sponsored</span></ytd-ad-slot-renderer>');
        document.querySelector('ytd-shorts').classList.add('ad-showing'); // Shared ancestor must not supply evidence.
      });
      await page.waitForTimeout(1200);
      assert.equal(await page.locator('[data-auto-advance-overlay]').count(), 0);
      assert.equal(await page.evaluate(() => clicks), 0, 'A neighboring/preloaded badge must not skip a normal video');
      await page.evaluate(() => {
        document.querySelector('#preloaded-ad').remove();
        const video = document.querySelector('video'), card = video.parentElement;
        card.classList.remove('ad-showing');
        const slot = document.createElement('ytd-ad-slot-renderer'); video.before(slot); slot.append(video);
        card.setAttribute('video-id', 'actual-ad'); history.pushState({}, '', '/shorts/actual-ad');
        const next = document.querySelector('button'), original = next.onclick;
        next.onclick = () => { window.skippedAt = performance.now(); original(); };
      });
      await page.getByText('Skipping Ad', { exact: true }).waitFor();
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        document.querySelector('ytd-reel-video-renderer').setAttribute('video-id', 'actual-ad-2');
        history.pushState({}, '', '/shorts/actual-ad-2'); window.recycledAt = performance.now();
      });
      await page.waitForTimeout(550);
      assert.equal(await page.evaluate(() => clicks), 0, 'Reused video/container/source must not inherit the previous deadline');
      await page.waitForFunction(() => clicks === 1);
      assert.ok(await page.evaluate(() => skippedAt - recycledAt >= 1000));
      assert.ok(recycled.logs.some((line) => line.includes('youtube:actual-ad-2')));
      results.push('Normal card with preloaded ad badge is not skipped; reused ad video/container/source gets a full saved 1s delay for each real ID');
      console.log('PASS ' + results.at(-1));
    } finally { await recycled.page.close(); }
    const { page } = await pageFor('youtube', false, { repeatCount: 6 });
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => {
        const player = document.querySelector('video').parentElement; player.classList.add('ad-showing');
        player.insertAdjacentHTML('beforeend', '<span class="ytp-ad-badge" style="position:absolute;top:30px;left:400px">Ad</span>');
      });
      await page.getByText('Skipping Ad', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-auto-advance-overlay]').evaluate((host) => host.shadowRoot.querySelector('circle').getAnimations().length), 0);
      await page.evaluate(() => document.querySelector('video').parentElement.classList.remove('ad-showing'));
      await page.waitForFunction(() => !document.querySelector('[data-auto-advance-overlay]'));
      await page.waitForTimeout(3100); assert.equal(await page.evaluate(() => clicks), 0);
      results.push('Ad-to-content transition cancels countdown; reduced motion keeps the timer without animation'); console.log('PASS ' + results.at(-1));
    } finally { await page.close(); }
    for (const placement of ['current card', 'feed companion']) {
      const { page, logs } = await pageFor('youtube', false, { repeatCount: 6, advanceDelayMs: 1000 });
      try {
        await page.evaluate((placement) => {
          const panel = document.createElement('section'); panel.id = 'sponsor-panel';
          panel.style.cssText = 'position:fixed;left:10px;bottom:30px;width:290px;padding:16px;background:#292929;border-radius:16px;opacity:0';
          panel.innerHTML = '<div>Advertiser</div><span>Sponsored</span><a href="https://advertiser.invalid/" style="display:block;background:white;color:black;border-radius:20px;text-align:center;padding:12px;margin-top:12px">Visit site</a>';
          panel.querySelector('a').onclick = (event) => { event.preventDefault(); adClicks++; };
          (placement === 'current card' ? document.querySelector('ytd-reel-video-renderer') : document.querySelector('ytd-shorts')).append(panel);
          const next = document.querySelector('#navigation-button-down button'), original = next.onclick;
          next.onclick = () => { window.skippedAt = performance.now(); panel.remove(); original(); };
        }, placement);
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('[data-auto-advance-overlay]').count(), 0, 'Transparent Sponsored panel must not trigger');
        await page.evaluate(() => { document.querySelector('#sponsor-panel').style.opacity = '1'; });
        await page.getByText('Skipping Ad', { exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await page.locator('[data-auto-advance-overlay]').evaluate((host) => host.shadowRoot.querySelector('circle').getAnimations()[0].effect.getTiming().duration), 1000);
        await page.waitForTimeout(250);
        await page.evaluate(() => { document.querySelector('#sponsor-panel').hidden = true; });
        await page.waitForFunction(() => !document.querySelector('[data-auto-advance-overlay]'));
        await page.waitForTimeout(1100); assert.equal(await page.evaluate(() => clicks), 0, 'Disappearing disclosure cancels pending skip');
        await page.evaluate(() => { window.disclosedAt = performance.now(); document.querySelector('#sponsor-panel').hidden = false; });
        await page.getByText('Skipping Ad', { exact: true }).waitFor();
        if (placement === 'feed companion') await page.screenshot({ path: path.join(output, 'countdown-sponsored-companion.png') });
        await page.waitForFunction(() => clicks === 1);
        assert.ok(await page.evaluate(() => skippedAt - disclosedAt >= 1000), 'Sponsored skip must use the full saved delay');
        assert.equal(await page.evaluate(() => adClicks), 0);
        assert.ok(logs.some((line) => line.includes('YouTube visible Sponsored advertiser card')));
        assert.equal(logs.filter((line) => line.includes('Playback count incremented')).length, 0);
        results.push(`YouTube Sponsored ${placement}: opacity reveal, disappearance cancels, full saved 1s delay, native next only`);
        console.log('PASS ' + results.at(-1));
      } finally { await page.close(); }
    }
    for (const variant of ['buttoned', 'metadata']) {
      const { page, logs } = await pageFor('youtube', false, { repeatCount: 6, advanceDelayMs: 1000 });
      try {
        const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/youtube-sponsored-overlay.html'), 'utf8');
        await page.addStyleTag({ content: 'reels-player-overlay-layout-view-model{display:block;position:fixed;left:10px;bottom:20px;width:300px;padding:10px;background:#333;color:white} reels-ad-card-buttoned-view-model,reels-ad-metadata-view-model,yt-ad-metadata-shape,ad-button-view-model{display:block} .ytwReelsPlayerOverlayLayoutViewModelHostActionBar,.ytwReelsPlayerOverlayLayoutViewModelHide{display:none} ad-button-view-model a{display:block;padding:12px}' });
        await page.evaluate(({ fixture, variant }) => {
          const wrapper = document.createElement('div'); wrapper.innerHTML = fixture;
          const overlay = wrapper.querySelector('reels-player-overlay-layout-view-model');
          const expanded = overlay.querySelector('reels-ad-card-buttoned-view-model').parentElement;
          const collapsed = overlay.querySelector('reels-ad-metadata-view-model').parentElement;
          expanded.setAttribute('aria-hidden', 'true');
          window.adVariant = variant === 'buttoned' ? expanded : collapsed;
          adVariant.classList.remove('ytwReelsPlayerOverlayLayoutViewModelHide');
          overlay.addEventListener('click', (event) => { event.preventDefault(); adClicks++; });
          document.querySelector('ytd-shorts').append(overlay);
          const next = document.querySelector('#navigation-button-down button'), original = next.onclick;
          next.onclick = () => { window.skippedAt = performance.now(); overlay.remove(); original(); };
        }, { fixture, variant });
        await page.waitForTimeout(1200);
        assert.equal(await page.locator('[data-auto-advance-overlay]').count(), 0, 'Both hidden duplicate badges must be ignored');
        await page.evaluate(() => { window.disclosedAt = performance.now(); adVariant.setAttribute('aria-hidden', 'false'); });
        await page.getByText('Skipping Ad', { exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await page.getByRole('button', { name: 'Watch again' }).count(), 0);
        await page.waitForFunction(() => clicks === 1);
        assert.ok(await page.evaluate(() => skippedAt - disclosedAt >= 1000));
        assert.equal(await page.evaluate(() => adClicks), 0);
        assert.ok(logs.some((line) => line.includes('YouTube visible Sponsored badge in native reels ad overlay')));
        assert.equal(logs.filter((line) => line.includes('Playback count incremented')).length, 0);
        results.push(`Supplied YouTube ${variant} DOM: hidden duplicates ignored, aria reveal detected, full saved 1s delay and no ad action clicks`);
        console.log('PASS ' + results.at(-1));
      } finally { await page.close(); }
    }
    const stale = await pageFor('youtube', false, { durationLimitEnabled: true, advanceDelayMs: 1000 });
    try {
      const { page, logs } = stale;
      const session = await context.newCDPSession(page), worlds = [];
      session.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
      await session.send('Runtime.enable');
      let extensionWorld;
      for (const world of worlds) {
        const result = await session.send('Runtime.evaluate', { contextId: world.id, expression: 'typeof ShortAutoAdvance !== "undefined" && typeof ShortAutoAdvance.diagnostics === "function"', returnByValue: true });
        if (result.result.value === true) { extensionWorld = world.id; break; }
      }
      assert.ok(extensionWorld, 'Actual manifest content-script world must exist');
      const evaluate = async (expression) => {
        const result = await session.send('Runtime.evaluate', { contextId: extensionWorld, expression, returnByValue: true });
        assert.equal(result.exceptionDetails, undefined); return result.result.value;
      };
      // Simulate a missed storage event, not a fake saved value: Chrome really
      // persists false while this controller temporarily retains true.
      await evaluate(`(() => {
        const original = ShortAutoAdvance.Controller.prototype.updateSettings;
        ShortAutoAdvance.Controller.prototype.updateSettings = function(patch) {
          if (Object.keys(patch).length === 1 && patch.durationLimitEnabled === false) return;
          return original.call(this, patch);
        };
        const video = document.querySelector('video');
        Object.defineProperty(video, 'duration', { configurable: true, get: () => 118.741 });
        video.dispatchEvent(new Event('durationchange'));
      })()`);
      await page.getByText('Duration limit reached', { exact: true }).waitFor();
      await preferences.evaluate(() => chrome.storage.local.set({ durationLimitEnabled: false }));
      assert.equal(await evaluate('ShortAutoAdvance.diagnostics().settings.durationLimitEnabled'), true);
      await page.waitForFunction(() => !document.querySelector('[data-auto-advance-overlay]'));
      assert.equal(await page.evaluate(() => clicks), 0);
      assert.equal(await evaluate('ShortAutoAdvance.diagnostics().settings.durationLimitEnabled'), false);
      assert.ok(logs.some((line) => line.includes('Saved settings differ from page settings')));
      for (const duration of [109.981, 15.041]) {
        await evaluate(`(() => { const video = document.querySelector('video'); Object.defineProperty(video, 'duration', { configurable: true, get: () => ${duration} }); video.dispatchEvent(new Event('durationchange')); })()`);
        await page.waitForTimeout(1100); assert.equal(await page.evaluate(() => clicks), 0);
      }
      // Reload the real extension while a duration timer is pending. The old
      // isolated-world controller must not keep navigating from cached settings.
      await preferences.evaluate(() => chrome.storage.local.set({ durationLimitEnabled: true }));
      await evaluate(`(() => { const video = document.querySelector('video'); Object.defineProperty(video, 'duration', { configurable: true, get: () => 118.741 }); video.dispatchEvent(new Event('durationchange')); })()`);
      await page.getByText('Duration limit reached', { exact: true }).waitFor();
      await preferences.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 0); });
      await page.waitForTimeout(1600);
      assert.equal(await page.evaluate(() => clicks), 0, 'An invalidated old content script must not navigate');
      assert.equal(await page.locator('[data-auto-advance-overlay]').count(), 0);
      results.push('Actual saved duration off defeats a stale page setting: reported 118/109/15 second sequence is preserved');
      console.log('PASS ' + results.at(-1));
    } finally { await stale.page.close(); }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'countdown-results.json'), JSON.stringify({ passed: results.length, tests: results, browser: context.browser().version(), liveSites: false }, null, 2));
  } finally { await context.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
