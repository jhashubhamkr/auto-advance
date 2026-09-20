'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, Video } = require('./helpers.cjs');
function gapFixture() {
  const fixture = setup({ repeatCount: 1, advanceDelayMs: 100 }, true);
  fixture.adapter.canRetainVideo = () => true;
  fixture.loop = () => {
    fixture.video.fire('timeupdate', { currentTime: 2 });
    fixture.video.fire('timeupdate', { currentTime: 9.8 });
    fixture.video.fire('timeupdate', { currentTime: 0 });
  };
  return fixture;
}
test('repeat one survives temporary candidate loss across second loop without navigating while unconfirmed', () => {
  const { controller, adapter, video, clock, loop } = gapFixture();
  loop(); assert.equal(controller.state.completedPlaybacks, 1);
  video.fire('timeupdate', { currentTime: 2 }); video.fire('timeupdate', { currentTime: 9.8 });
  const monitor = controller.monitor;
  adapter.video = null; adapter.change();
  assert.equal(controller.monitor, monitor, 'retain the original near-end sampling history');
  video.fire('timeupdate', { currentTime: 0 }); clock.tick(800);
  assert.equal(adapter.attempts.length, 0);
  adapter.video = video; adapter.change(); clock.tick(100);
  assert.equal(controller.state.completedPlaybacks, 2);
  assert.equal(adapter.attempts.length, 1); controller.dispose();
});
test('completion can start grace before the debounced DOM scan notices candidate loss', () => {
  const { controller, adapter, video, clock, loop } = gapFixture();
  loop(); adapter.video = null; loop();
  assert.equal(adapter.attempts.length, 0);
  adapter.video = video; adapter.change(); clock.tick(100);
  assert.equal(controller.state.completedPlaybacks, 2); assert.equal(adapter.attempts.length, 1); controller.dispose();
});
test('gap expiry is bounded and repeated DOM changes cannot extend it', () => {
  const { controller, adapter, clock, loop } = gapFixture();
  loop(); adapter.video = null; adapter.change(); loop();
  clock.tick(800); adapter.change(); clock.tick(701);
  assert.equal(controller.monitor, null); assert.equal(controller.state.completedPlaybacks, 1);
  assert.equal(adapter.attempts.length, 0); assert.equal(clock.tasks.size, 0); controller.dispose();
});
test('manually changing clips during grace discards buffered old completions', () => {
  const { controller, adapter, clock, loop } = gapFixture();
  loop(); adapter.video = null; adapter.change(); loop();
  adapter.video = new Video('b'); adapter.change(); clock.tick(3000);
  assert.equal(controller.state.completedPlaybacks, 0); assert.equal(adapter.attempts.length, 0); controller.dispose();
});
for (const condition of ['offscreen card', 'disconnected video', 'identity changed', 'route changed']) test(`grace does not retain an unsafe player: ${condition}`, () => {
  const { controller, adapter, video, loop } = gapFixture(); loop();
  if (condition === 'offscreen card') adapter.canRetainVideo = () => false;
  if (condition === 'disconnected video') video.isConnected = false;
  if (condition === 'identity changed') video.id = 'recycled';
  const previousLocation = global.location;
  if (condition === 'route changed') global.location = { href: 'https://www.youtube.com/shorts/other' };
  try { adapter.video = null; adapter.change(); assert.equal(controller.monitor, null); }
  finally { controller.dispose(); global.location = previousLocation; }
});
test('hiding or disabling cancels retained monitoring and its pending completion', () => {
  for (const action of ['hidden', 'disabled']) {
    const { controller, adapter, clock, loop, doc } = gapFixture(); loop(); adapter.video = null; adapter.change(); loop();
    if (action === 'hidden') { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); }
    else controller.updateSettings({ enabled: false });
    clock.tick(3000); assert.equal(controller.monitor, null); assert.equal(adapter.attempts.length, 0); assert.equal(clock.tasks.size, 0); controller.dispose();
  }
});
test('advance already queued waits for confirmed visibility to return', () => {
  const { controller, adapter, video, clock } = setup({ advanceDelayMs: 400 });
  adapter.canRetainVideo = () => true;
  controller.monitor.callback('wrap'); adapter.video = null; adapter.change(); clock.tick(400);
  assert.equal(adapter.attempts.length, 0);
  adapter.video = video; adapter.change(); clock.tick(400);
  assert.equal(adapter.attempts.length, 1); controller.dispose();
});
test('same-identity replacement cannot inherit unconfirmed completion from an old element', () => {
  const { controller, adapter, clock, loop } = gapFixture(); loop(); adapter.video = null; adapter.change(); loop();
  adapter.video = new Video('a'); adapter.change(); clock.tick(3000);
  assert.equal(controller.state.completedPlaybacks, 1); assert.equal(adapter.attempts.length, 0); controller.dispose();
});
test('a grace period without a genuine completion does not invent one from a new timestamp', () => {
  const { controller, adapter, video, clock, loop } = gapFixture(); loop(); adapter.video = null; adapter.change();
  video.fire('seeking', { currentTime: 0, seeking: true }); video.fire('seeked', { seeking: false });
  adapter.video = video; adapter.change(); clock.tick(100);
  assert.equal(controller.state.completedPlaybacks, 1); assert.equal(adapter.attempts.length, 0); controller.dispose();
});
