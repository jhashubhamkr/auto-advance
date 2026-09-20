'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
function fixture() {
  const stored = {}, calls = [], responses = new Map();
  let fail = false, pending = null;
  const chrome = {
    runtime: { id: 'test', getURL: (p) => 'chrome-extension://test/' + p, onMessage: event(), onInstalled: event(), onStartup: event() },
    tabs: { query: async () => [], get: async (id) => ({ id, ...responses.get(id) }), sendMessage: async () => { throw new Error('No content receiver'); }, onUpdated: event(), onActivated: event(), onRemoved: event(), onReplaced: event() },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event() },
    action: { setIcon: async (v) => { calls.push(v); }, setTitle: async () => {} },
    storage: { local: { get: async () => stored, set: async (v) => { if (pending) await pending; if (fail) throw new Error('failure'); Object.assign(stored, v); } } }
  };
  const context = vm.createContext({ chrome, console, URL, performance });
  context.importScripts = (file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  const send = (message, sender = { id: 'test', url: 'chrome-extension://test/popup/popup.html' }) => new Promise((resolve) => {
    const keepAlive = chrome.runtime.onMessage.listeners[0](message, sender, resolve);
    if (keepAlive !== true) resolve(undefined);
  });
  return { stored, calls, responses, chrome, context, send, setFail: (v) => { fail = v; }, block: (v) => { pending = v; } };
}
test('worker serializes rapid writes, reset and theme independently; failed writes can be retried', async () => {
  const f = fixture(); let release; f.block(new Promise((r) => { release = r; }));
  const one = f.send({ type: 'auto-advance:save-preferences', values: { repeatCount: 2 } });
  const two = f.send({ type: 'auto-advance:save-preferences', values: { repeatCount: 6 } });
  release(); f.block(null);
  assert.equal((await one).ok, true); assert.equal((await two).ok, true); assert.equal(f.stored.repeatCount, 6);
  await f.send({ type: 'auto-advance:save-preferences', values: { popupTheme: 'dark' } });
  await f.send({ type: 'auto-advance:reset-preferences' });
  assert.equal(f.stored.repeatCount, 0); assert.equal(f.stored.popupTheme, 'dark'); assert.equal(f.stored.onlyWhenTabVisible, true);
  f.setFail(true); assert.equal((await f.send({ type: 'auto-advance:save-preferences', values: { repeatCount: 4 } })).ok, false);
  assert.equal(f.stored.repeatCount, 0);
  f.setFail(false); await f.send({ type: 'auto-advance:save-preferences', values: { repeatCount: 4 } }); assert.equal(f.stored.repeatCount, 4);
});
test('worker rejects webpage writes and unknown preferences and migrates old stored bounds', async () => {
  const f = fixture();
  assert.equal(await f.send({ type: 'auto-advance:reset-preferences' }, { id: 'test', url: 'https://www.youtube.com/shorts/a', tab: { id: 1 } }), undefined);
  assert.equal((await f.send({ type: 'auto-advance:save-preferences', values: { unknown: true } })).ok, false);
  Object.assign(f.stored, { repeatCount: 99, advanceDelayMs: 0, onlyWhenTabVisible: false });
  f.chrome.runtime.onInstalled.listeners[0]();
  await vm.runInContext('writes', f.context);
  assert.equal(f.stored.repeatCount, 6); assert.equal(f.stored.advanceDelayMs, 100); assert.equal(f.stored.onlyWhenTabVisible, true);
});
test('toolbar follows current URLs without content replies; stale tab reads cannot recolor it', async () => {
  const f = fixture();
  f.responses.set(1, { url: 'https://www.youtube.com/shorts/a' });
  await f.send({ type: 'auto-advance:page-state' }, { id: 'test', url: 'https://www.youtube.com/shorts/a', tab: { id: 1 }, frameId: 0 });
  assert.equal(f.calls.at(-1).path[16], 'icons/icon-16.png');
  let release;
  f.chrome.tabs.get = () => new Promise((r) => { release = r; });
  const old = vm.runInContext('refreshToolbar(1)', f.context);
  f.chrome.tabs.get = async () => ({ url: 'https://www.youtube.com/watch?v=a' });
  await vm.runInContext('refreshToolbar(1)', f.context);
  release({ url: 'https://www.youtube.com/shorts/a' }); await old;
  assert.equal(f.calls.at(-1).path[16], 'icons/icon-gray-16.png');
  f.chrome.tabs.get = async () => ({});
  await vm.runInContext('refreshToolbar(1)', f.context);
  assert.equal(f.calls.at(-1).path[16], 'icons/icon-gray-16.png');
  f.chrome.tabs.onRemoved.listeners[0](1);
  assert.equal(vm.runInContext('toolbarStates.has(1)', f.context), false);
});

test('activation returns to a valid tab, loading-only SPA updates recover, and focus refreshes availability', async () => {
  const f = fixture();
  f.responses.set(1, { url: 'https://www.youtube.com/shorts/existing' });
  f.responses.set(2, { url: 'https://www.youtube.com/watch?v=normal' });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  for (const [id, expected] of [[1, true], [2, false], [1, true]]) {
    f.chrome.tabs.onActivated.listeners[0]({ tabId: id }); await settle();
    assert.equal(f.calls.at(-1).path[16], expected ? 'icons/icon-16.png' : 'icons/icon-gray-16.png');
  }
  f.responses.set(2, { url: 'https://www.youtube.com/shorts/new', status: 'loading' });
  f.chrome.tabs.onUpdated.listeners[0](2, { status: 'loading' }); await settle();
  assert.equal(f.calls.at(-1).path[16], 'icons/icon-16.png', 'SPA loading without a later complete event must not stick gray');
  f.responses.set(2, { url: 'https://www.instagram.com/reels/' });
  f.chrome.tabs.query = async () => [{ id: 2 }];
  f.chrome.windows.onFocusChanged.listeners[0](5); await settle();
  assert.equal(f.calls.at(-1).path[16], 'icons/icon-16.png');
  f.responses.set(2, { url: 'https://www.instagram.com/p/post' });
  f.chrome.tabs.onUpdated.listeners[0](2, { url: 'https://www.instagram.com/p/post' }); await settle();
  assert.equal(f.calls.at(-1).path[16], 'icons/icon-gray-16.png');
});
test('popup and toolbar share a fresh URL result, even before a content script exists', async () => {
  const f = fixture();
  f.responses.set(1, { url: 'https://www.youtube.com/', pendingUrl: 'https://www.youtube.com/shorts/a' });
  const status = await f.send({ type: 'auto-advance:tab-status', tabId: 1 });
  assert.equal(status.supported, true); assert.equal(status.platform, 'YouTube Shorts');
  assert.equal(f.calls.at(-1).path[16], 'icons/icon-16.png');
  f.responses.set(1, {});
  assert.equal((await f.send({ type: 'auto-advance:tab-status', tabId: 1 })).supported, false);
  f.chrome.tabs.get = async () => { throw new Error('Tab removed'); };
  assert.equal((await f.send({ type: 'auto-advance:tab-status', tabId: 1 })).supported, false);
});
test('availability classifier rejects unrelated hosts, normal pages and invalid URLs', () => {
  const f = fixture();
  for (const [url, supported] of [
    ['https://www.youtube.com/shorts/abc', true], ['https://youtube.com/shorts/abc?x=1', true],
    ['https://www.instagram.com/reels/', true], ['https://instagram.com/reel/abc/', true],
    ['https://www.youtube.com/shorts/', false], ['https://www.youtube.com/watch?v=a', false],
    ['https://www.instagram.com/p/a/', false], ['https://www.instagram.com/stories/a/', false],
    ['https://www.youtube.com.evil.test/shorts/a', false], ['http://youtube.com/shorts/a', false],
    ['chrome://extensions', false], ['', false]
  ]) {
    f.context.testUrl = url;
    assert.equal(vm.runInContext('app.pageStatus(testUrl).supported', f.context), supported, url);
  }
});
