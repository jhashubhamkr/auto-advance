'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./helpers.cjs');
require('../content/adapter-utils.js');
require('../content/youtube-shorts-adapter.js');
require('../content/instagram-reels-adapter.js');
test('route gates exclude normal YouTube, Instagram posts and lookalike paths', () => {
  for (const [Adapter, yes, no] of [
    [app.YouTubeShortsAdapter, ['/shorts/abc'], ['/', '/watch?v=abc', '/shorts', '/shorts-other/abc']],
    [app.InstagramReelsAdapter, ['/reels/', '/reels/abc/', '/reel/abc/'], ['/', '/p/abc/', '/reelish/abc', '/stories/abc']]
  ]) {
    const adapter = new Adapter();
    for (const pathname of yes) { global.location = { pathname }; assert.equal(adapter.isSupportedPage(), true, pathname); }
    for (const pathname of no) { global.location = { pathname }; assert.equal(adapter.isSupportedPage(), false, pathname); }
  }
});
test('geometry selection prefers visible active media over first preloaded item', () => {
  global.innerWidth = 1000; global.innerHeight = 800;
  global.getComputedStyle = () => ({ visibility: 'visible', display: 'block', opacity: '1' });
  const video = (id, top, paused = false) => ({ id, isConnected: true, paused, closest: () => null,
    getBoundingClientRect: () => ({ left: 300, right: 700, top, bottom: top + 700, width: 400, height: 700 }) });
  const offscreen = video('offscreen', -1000), active = video('active', 50), sliver = video('sliver', 750);
  assert.equal(app.adapterUtils.select([offscreen, sliver, active], { container: () => true }), active);
  assert.equal(app.adapterUtils.select([active], { container: () => true, exclude: () => true }), null);
});
test('zero-size and hidden videos cannot win selection', () => {
  global.innerWidth = 1000; global.innerHeight = 800;
  const video = { isConnected: true, closest: () => null, getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  global.getComputedStyle = () => ({ visibility: 'visible', display: 'block', opacity: '1' });
  assert.equal(app.adapterUtils.geometry(video), null);
});
test('fallback container identity remains stable across video replacement', () => {
  const container = {};
  assert.equal(app.adapterUtils.identity(container, 'test'), app.adapterUtils.identity(container, 'test'));
  assert.notEqual(app.adapterUtils.identity({}, 'test'), app.adapterUtils.identity(container, 'test'));
});
