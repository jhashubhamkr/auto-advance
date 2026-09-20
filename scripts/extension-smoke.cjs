'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = path.join(root, 'test-results', `extension-profile-${Date.now()}`);
async function launch() {
  return chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1100, height: 800 },
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'] });
}
async function main() {
  let context = await launch();
  let id;
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    ({ id } = await cdp.send('Extensions.loadUnpacked', { path: root }));
    assert.ok(id);
    async function openPopup(browserContext) {
      // The real action popup lives outside the tab strip. Keep a supported tab
      // active while inspecting its extension popup document in a background tab.
      const popup = await browserContext.newPage();
      const target = await browserContext.newPage();
      await target.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main>Popup route fixture</main><a id="shorts-link" href="/shorts/popup-check">Shorts</a><script>window.fixtureDocumentId=crypto.randomUUID();document.querySelector("#shorts-link").onclick=(event)=>{event.preventDefault();history.pushState({},"","/shorts/popup-check");document.querySelector("main").textContent="Shorts loaded without reloading";};</script>' }));
      await target.goto('https://www.youtube.com/shorts/popup-check');
      await target.bringToFront();
      await popup.goto(`chrome-extension://${id}/popup/popup.html`);
      await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
      return { popup, target };
    }
    const { popup, target } = await openPopup(context);
    const toolbarReady = async (page, supported) => page.waitForFunction(async (expected) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const title = await chrome.action.getTitle({ tabId: tab.id });
      return title.includes('ready on Shorts/Reels') === expected && title.includes('Auto Advance');
    }, supported);
    await toolbarReady(popup, true);
    const documentId = await target.evaluate(() => window.fixtureDocumentId);
    const otherTab = await context.newPage();
    await otherTab.goto('about:blank');
    for (let iteration = 0; iteration < 3; iteration++) {
      await otherTab.bringToFront();
      await popup.waitForFunction(() => document.querySelector('#enabled').disabled);
      await toolbarReady(popup, false);
      await target.bringToFront();
      await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
      await toolbarReady(popup, true);
    }
    assert.equal(await target.evaluate(() => window.fixtureDocumentId), documentId);
    await otherTab.close();
    await target.evaluate(() => history.replaceState({}, '', '/watch?v=ordinary'));
    await popup.waitForFunction(() => document.querySelector('#enabled').disabled);
    await toolbarReady(popup, false);
    await target.getByRole('link', { name: 'Shorts', exact: true }).click();
    await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
    await toolbarReady(popup, true);
    assert.equal(await target.evaluate(() => window.fixtureDocumentId), documentId, 'Sidebar navigation must not reload the document');
    await target.evaluate(() => history.back());
    await popup.waitForFunction(() => document.querySelector('#enabled').disabled);
    await toolbarReady(popup, false);
    await target.evaluate(() => history.forward());
    await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
    await toolbarReady(popup, true);
    console.log('PASS repeated valid/invalid tab switches, sidebar pushState, replaceState and history back/forward recover both controls without reloading');
    assert.equal(await popup.locator('#advanced-toggle').getAttribute('aria-expanded'), 'false');
    await target.evaluate(() => history.pushState({}, '', '/watch?v=ordinary'));
    await popup.waitForFunction(() => document.querySelector('#enabled').disabled);
    assert.equal(await popup.locator('#advanced-toggle').isDisabled(), true);
    await toolbarReady(popup, false);
    await target.goto('about:blank');
    await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('Open Shorts'));
    await toolbarReady(popup, false);
    assert.equal(await popup.locator('#enabled').isDisabled(), true);
    await target.goto('https://www.instagram.com/p/post/');
    await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('Open Shorts'));
    assert.equal(await popup.locator('#enabled').isDisabled(), true);
    await target.evaluate(() => history.pushState({}, '', '/reel/POPUP/'));
    await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
    await toolbarReady(popup, true);
    await popup.getByRole('button', { name: 'Switch to dark theme' }).click();
    await popup.waitForFunction(async () => (await chrome.storage.local.get('popupTheme')).popupTheme === 'dark');
    await popup.locator('#enabled').uncheck();
    await popup.waitForFunction(async () => (await chrome.storage.local.get('enabled')).enabled === false);
    await popup.locator('#enabled').check();
    await popup.waitForFunction(async () => (await chrome.storage.local.get('enabled')).enabled === true);
    console.log('PASS actual content-script messaging gates YouTube/Instagram routes; master and theme save independently');
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await popup.locator('#repeatCount').evaluate((el) => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await popup.locator('#advanceDelayMs').evaluate((el) => { el.value = '0.1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await popup.waitForFunction(async () => (await chrome.storage.local.get('repeatCount')).repeatCount === 2);
    assert.deepEqual(await popup.evaluate(() => chrome.runtime.getManifest().permissions), ['storage']);
    assert.deepEqual(await popup.evaluate(() => chrome.runtime.getManifest().host_permissions), ['https://www.youtube.com/*', 'https://youtube.com/*', 'https://www.instagram.com/*', 'https://instagram.com/*']);
    assert.equal(await popup.evaluate(() => chrome.runtime.getManifest().background.service_worker), 'background.js');
    console.log('PASS Chrome loaded the unpacked MV3 extension and saved real local settings');
    await context.close(); context = await launch();
    // CDP-loaded extensions are session-scoped in some branded Chrome builds;
    // load the same ID again in the restarted profile to verify persisted storage.
    const restartedCdp = await context.browser().newBrowserCDPSession();
    const reloaded = await restartedCdp.send('Extensions.loadUnpacked', { path: root });
    assert.equal(reloaded.id, id);
    const { popup: restored } = await openPopup(context);
    await restored.waitForFunction(() => document.querySelector('#repeatCount').value === '2');
    await restored.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await restored.locator('#advanced-toggle').getAttribute('aria-expanded'), 'false');
    console.log('PASS settings persisted through a complete browser restart');
    const fixture = await context.newPage();
    const diagnosticEvents = [];
    fixture.on('console', (message) => { if (message.text().includes('[Auto Advance]')) diagnosticEvents.push(message.text()); });
    const errors = []; fixture.on('pageerror', (error) => errors.push(error.message));
    fixture.on('console', (message) => { if (message.type() === 'warning' || message.type() === 'error') console.log(`Fixture console: ${message.text()}`); });
    await fixture.route('https://www.youtube.com/**', (route) => {
      if (route.request().url().endsWith('/fixture.webm')) return route.fulfill({ contentType: 'video/webm', body: fs.readFileSync(path.join(root, 'tests/fixtures/short.webm')) });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{margin:0}ytd-shorts,ytd-reel-video-renderer{display:block;height:800px}video{display:block;width:400px;height:700px;margin:auto}button{position:fixed;top:300px;right:10px;width:60px;height:60px}[hidden]{display:none}</style><ytd-shorts><ytd-reel-video-renderer video-id="one" is-active><video muted loop autoplay src="/fixture.webm"></video></ytd-reel-video-renderer><ytd-reel-video-renderer video-id="two" hidden><video></video></ytd-reel-video-renderer><div id="navigation-button-down"><button>Down</button></div></ytd-shorts><script>window.clicks=0;window.loops=0;const v=document.querySelector('video');v.addEventListener('seeked',()=>loops++);document.querySelector('button').onclick=()=>{clicks++;v.pause();const cards=document.querySelectorAll('ytd-reel-video-renderer');cards[0].hidden=true;cards[0].removeAttribute('is-active');cards[1].hidden=false;cards[1].setAttribute('is-active','');history.pushState({},'', '/shorts/two');};</script>` });
    });
    await fixture.goto('https://www.youtube.com/shorts/one');
    await fixture.bringToFront();
    if (process.env.DEBUG_EXTENSION_TEST) {
      const debugSession = await context.newCDPSession(fixture); let extensionWorld;
      debugSession.on('Runtime.executionContextCreated', ({ context: world }) => { if (world.name === 'Auto Advance') extensionWorld = world.id; });
      await debugSession.send('Runtime.enable');
      if (extensionWorld) await debugSession.send('Runtime.evaluate', { contextId: extensionWorld, expression: `ShortAutoAdvance.log.debug = console.warn; const originalHandle = ShortAutoAdvance.PlaybackMonitor.prototype.handle; ShortAutoAdvance.PlaybackMonitor.prototype.handle = function(type) { if(type === 'seeking' || type === 'seeked') console.warn(JSON.stringify({type, previous:this.previousTime, time:this.video.currentTime, nearEnd:this.nearEnd, forward:this.forward, completed:this.completed, seeking:this.wasSeeking})); return originalHandle.call(this,type); }; chrome.storage.local.get(null).then(x=>console.warn(JSON.stringify(x)));` });
    }
    try { await fixture.waitForFunction(() => clicks === 1, null, { timeout: 12000 }); }
    catch (error) {
      console.log('Fixture media state:', await fixture.evaluate(() => { const v = document.querySelector('video'); return { clicks, loops, paused: v.paused, duration: v.duration, currentTime: v.currentTime, error: v.error?.message, readyState: v.readyState }; }));
      const session = await context.newCDPSession(fixture); const worlds = [];
      session.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world)); await session.send('Runtime.enable');
      for (const world of worlds) {
        const data = await session.send('Runtime.evaluate', { contextId: world.id, expression: 'typeof ShortAutoAdvance === "undefined" ? "no extension namespace" : JSON.stringify({keys:Object.keys(ShortAutoAdvance), active:new ShortAutoAdvance.YouTubeShortsAdapter().findActiveVideo()?.currentTime})', returnByValue: true });
        console.log('World:', world.name, data.result.value);
      }
      throw error;
    }
    assert.ok(await fixture.evaluate(() => loops >= 3), 'Repeat two must complete three native loops before navigation');
    await fixture.waitForTimeout(2000);
    assert.equal(await fixture.evaluate(() => clicks), 1);
    assert.deepEqual(errors, []);
    assert.equal(diagnosticEvents.length, 0, 'Public defaults must complete playback without console diagnostics');
    console.log('PASS manifest-injected isolated content scripts counted three real loops and navigated exactly once');
    for (const repeatCount of [0, 1, 2]) {
      await restored.evaluate((count) => chrome.storage.local.set({ repeatCount: count }), repeatCount);
      const instagram = await context.newPage();
      const instagramLogs = [];
      instagram.on('console', (message) => { if (message.text().includes('[Auto Advance]')) instagramLogs.push(message.text()); });
      instagram.on('pageerror', (error) => errors.push(error.message));
      await instagram.route('https://www.instagram.com/**', (route) => {
        if (route.request().url().endsWith('/fixture.webm')) return route.fulfill({ contentType: 'video/webm', body: fs.readFileSync(path.join(root, 'tests/fixtures/short.webm')) });
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{margin:0}main,article{display:block;height:800px}video{display:block;width:400px;height:650px;margin:auto}button{width:100px;height:50px}[hidden]{display:none!important}</style><main><article><video muted autoplay src="/fixture.webm"></video><a href="/reel/FIRST/">Reel</a><button aria-label="Next reel">Next reel</button></article><article hidden><video></video><a href="/reel/SECOND/">Reel</a></article></main><script>window.clicks=0;window.siteEnds=0;window.endStates=[];const video=document.querySelector('video');video.addEventListener('ended',()=>{siteEnds++;video.currentTime=0;video.play();});video.addEventListener('ended',()=>endStates.push({ended:video.ended,seeking:video.seeking,time:video.currentTime}));document.querySelector('button').onclick=()=>{clicks++;video.pause();const cards=document.querySelectorAll('article');cards[0].hidden=true;cards[1].hidden=false;history.pushState({},'', '/reel/SECOND/');};</script>` });
      });
      try {
        await instagram.goto('https://www.instagram.com/reel/FIRST/');
        await instagram.bringToFront();
        await instagram.waitForFunction(() => clicks === 1, null, { timeout: 12000 });
        await instagram.waitForTimeout(250);
        const actual = await instagram.evaluate(() => ({ clicks, siteEnds, endStates }));
        assert.equal(actual.clicks, 1);
        assert.equal(actual.siteEnds, repeatCount + 1);
        assert.ok(actual.endStates.every((state) => !state.ended && state.seeking && state.time === 0), 'The site must reset media state before the extension ended listener');
        assert.equal(instagramLogs.length, 0, 'Normal Instagram playback must be quiet by default');
        assert.deepEqual(errors, []);
        console.log(`PASS Instagram site-script restart with repeat ${repeatCount}: ${repeatCount + 1} actual completions, one navigation`);
        diagnosticEvents.push(...instagramLogs);
      } finally { await instagram.close(); }
    }
    await restored.evaluate(() => chrome.storage.local.set({ repeatCount: 1 }));
    const gapPage = await context.newPage();
    const gapLogs = [];
    gapPage.on('console', (message) => { if (message.text().includes('[Auto Advance]')) gapLogs.push(message.text()); });
    gapPage.on('pageerror', (error) => errors.push(error.message));
    await gapPage.route('https://www.youtube.com/**', (route) => {
      if (route.request().url().endsWith('/fixture.webm')) return route.fulfill({ contentType: 'video/webm', body: fs.readFileSync(path.join(root, 'tests/fixtures/short.webm')) });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{margin:0}ytd-shorts,ytd-reel-video-renderer{display:block;height:800px}video{display:block;width:400px;height:700px;margin:auto}button{position:fixed;top:300px;right:10px;width:60px;height:60px}[hidden]{display:none!important}</style><ytd-shorts><ytd-reel-video-renderer video-id="gap-first" is-active><video muted loop autoplay src="/fixture.webm"></video></ytd-reel-video-renderer><ytd-reel-video-renderer video-id="gap-next" hidden><video></video></ytd-reel-video-renderer><div id="navigation-button-down"><button>Down</button></div></ytd-shorts><script>window.clicks=0;window.loops=0;window.hiddenOnce=false;window.hiddenAtClick=false;const v=document.querySelector('video');v.playbackRate=0.5;v.addEventListener('seeked',()=>loops++);function frame(){if(loops===1&&!hiddenOnce&&v.currentTime>0.53){hiddenOnce=true;v.setAttribute('aria-hidden','true');setTimeout(()=>v.removeAttribute('aria-hidden'),800);}v.requestVideoFrameCallback(frame);}v.requestVideoFrameCallback(frame);document.querySelector('button').onclick=()=>{clicks++;hiddenAtClick=v.hasAttribute('aria-hidden');v.pause();const cards=document.querySelectorAll('ytd-reel-video-renderer');cards[0].hidden=true;cards[0].removeAttribute('is-active');cards[1].hidden=false;cards[1].setAttribute('is-active','');history.pushState({},'', '/shorts/gap-next');};</script>` });
    });
    try {
      await gapPage.goto('https://www.youtube.com/shorts/gap-first');
      await gapPage.bringToFront();
      await gapPage.waitForFunction(() => clicks === 1, null, { timeout: 15000 });
      await gapPage.waitForTimeout(250);
      const result = await gapPage.evaluate(() => ({ clicks, loops, hiddenOnce, hiddenAtClick }));
      assert.deepEqual(result, { clicks: 1, loops: 2, hiddenOnce: true, hiddenAtClick: false });
      assert.equal(gapLogs.length, 0, 'Player-gap handling must be quiet by default');
      assert.deepEqual(errors, []);
      console.log('PASS repeat one retains monitoring across an 800 ms player gap at the second loop and navigates once after visibility returns');
      diagnosticEvents.push(...gapLogs);
    } finally { await gapPage.close(); }
    await restored.evaluate(() => chrome.storage.local.set({ repeatCount: 6, advanceDelayMs: 100, durationLimitEnabled: true, durationLimitSeconds: 60 }));
    const longPage = await context.newPage(), longLogs = [];
    longPage.on('console', (message) => { if (message.text().includes('[Auto Advance]')) longLogs.push(message.text()); });
    const longMedia = Buffer.from(fs.readFileSync(path.join(root, 'tests/fixtures/short.webm')));
    const durationOffset = longMedia.indexOf(Buffer.from('448988', 'hex'));
    assert.ok(durationOffset >= 0); longMedia.writeDoubleBE(90000, durationOffset + 3);
    await longPage.route('https://www.youtube.com/**', (route) => {
      if (route.request().url().endsWith('/long.webm')) return route.fulfill({ contentType: 'video/webm', body: longMedia });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{margin:0}ytd-shorts,ytd-reel-video-renderer{display:block;height:800px}video{display:block;width:400px;height:700px;margin:auto}button{position:fixed;right:10px;top:300px;width:60px;height:60px}[hidden]{display:none!important}</style><ytd-shorts><ytd-reel-video-renderer video-id="long" is-active><video muted autoplay src="/long.webm"></video></ytd-reel-video-renderer><ytd-reel-video-renderer video-id="short" hidden><video></video></ytd-reel-video-renderer><div id="navigation-button-down"><button>Down</button></div></ytd-shorts><script>window.clicks=0;window.durationAtSkip=0;window.timeAtSkip=0;const v=document.querySelector('video');document.querySelector('button').onclick=()=>{clicks++;durationAtSkip=v.duration;timeAtSkip=v.currentTime;v.pause();const cards=document.querySelectorAll('ytd-reel-video-renderer');cards[0].hidden=true;cards[1].hidden=false;cards[1].setAttribute('is-active','');history.pushState({},'', '/shorts/short');};</script>` });
    });
    try {
      await longPage.goto('https://www.youtube.com/shorts/long'); await longPage.bringToFront();
      await longPage.waitForFunction(() => clicks === 1, null, { timeout: 10000 });
      const result = await longPage.evaluate(() => ({ clicks, durationAtSkip, timeAtSkip }));
      assert.equal(result.durationAtSkip, 90); assert.ok(result.timeAtSkip < 1);
      assert.equal(longLogs.length, 0, 'Duration filtering must be quiet by default');
      await longPage.waitForTimeout(400); assert.equal(await longPage.evaluate(() => clicks), 1);
      diagnosticEvents.push(...longLogs);
      console.log('PASS real 90-second media metadata triggers a duration skip before playback completes, independent of repeats');
    } finally { await longPage.close(); }
    const closingPopup = await context.newPage();
    await closingPopup.goto(`chrome-extension://${id}/popup/popup.html`);
    await closingPopup.evaluate(() => { chrome.runtime.sendMessage({ type: 'auto-advance:save-preferences', values: { repeatCount: 5 } }); });
    await closingPopup.close();
    await restored.waitForFunction(async () => (await chrome.storage.local.get('repeatCount')).repeatCount === 5);
    console.log('PASS worker autosave persists a dispatched change after the popup closes');
    fs.writeFileSync(path.join(root, 'test-results/extension-results.json'), JSON.stringify({ passed: 11, extensionId: id, browser: context.browser().version(), realStorage: true, actualManifestInjection: true, liveSites: false, diagnosticEvents }, null, 2));
  } finally { await context.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
