'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, Video, app } = require('./helpers.cjs');
const flush = () => new Promise((resolve) => setImmediate(resolve));
class Overlay {
  show() { this.visible = true; }
  hide() { this.visible = false; }
  containsEvent() { return false; }
}
test('saved duration off overrides stale page duration on for the reported 118/109/15 second sequence', async () => {
  const saved = { ...app.settings.defaults, advanceDelayMs: 1000, durationLimitEnabled: false };
  const f = setup({ ...saved, durationLimitEnabled: true }, false, { readCurrentSettings: async () => saved, Overlay });
  f.video.fire('loadedmetadata', { duration: 118.741 });
  assert.equal(f.controller.navigationReason, 'duration');
  f.clock.tick(1000); await flush();
  assert.equal(f.adapter.attempts.length, 0);
  assert.equal(f.controller.settings.durationLimitEnabled, false);
  assert.equal(f.controller.overlay.visible, false);
  for (const duration of [109.981, 15.041]) {
    f.adapter.video = new Video(String(duration)); f.adapter.video.duration = duration; f.adapter.change();
    f.clock.tick(2000); await flush(); assert.equal(f.adapter.attempts.length, 0);
  }
  f.complete(); f.clock.tick(1000); await flush();
  assert.equal(f.adapter.attempts.length, 1); f.controller.dispose();
});
test('saved master off cancels a skip when the page missed its storage event', async () => {
  const f = setup({}, false, { readCurrentSettings: async () => ({ ...app.settings.defaults, enabled: false }), Overlay });
  f.complete(); f.clock.tick(400); await flush();
  assert.equal(f.adapter.attempts.length, 0); assert.equal(f.controller.monitor, null); f.controller.dispose();
});
test('unverifiable saved settings never dispatch cached duration navigation', async () => {
  const f = setup({ durationLimitEnabled: true }, false, { readCurrentSettings: async () => { throw new Error('Extension context invalidated'); }, Overlay });
  f.video.fire('loadedmetadata', { duration: 119 }); f.clock.tick(400); await flush();
  assert.equal(f.adapter.attempts.length, 0); assert.equal(f.controller.overlay.visible, false);
  f.clock.tick(5000); await flush(); assert.equal(f.adapter.attempts.length, 0); f.controller.dispose();
});
test('invalidated extension context cancels the old controller timer and overlay', () => {
  let alive = true;
  const f = setup({ durationLimitEnabled: true }, false, { isContextValid: () => alive, Overlay });
  f.video.fire('loadedmetadata', { duration: 119 }); alive = false; f.clock.tick(400);
  assert.equal(f.adapter.attempts.length, 0); assert.equal(f.controller.overlay.visible, false); assert.equal(f.controller.monitor, null); f.controller.dispose();
});
test('a delayed settings read cannot navigate after the selected video changes', async () => {
  let resolve;
  const f = setup({}, false, { readCurrentSettings: () => new Promise((done) => { resolve = done; }), Overlay });
  f.complete(); f.clock.tick(400); f.adapter.video = new Video('b'); f.adapter.change();
  resolve(app.settings.defaults); await flush(); assert.equal(f.adapter.attempts.length, 0); f.controller.dispose();
});
test('saved delay change starts a fresh full delay instead of dispatching the old one', async () => {
  const saved = { ...app.settings.defaults, advanceDelayMs: 1000 };
  const f = setup({}, false, { readCurrentSettings: async () => saved, Overlay });
  f.complete(); f.clock.tick(400); await flush(); assert.equal(f.adapter.attempts.length, 0);
  f.clock.tick(999); await flush(); assert.equal(f.adapter.attempts.length, 0);
  f.clock.tick(1); await flush(); assert.equal(f.adapter.attempts.length, 1); f.controller.dispose();
});
