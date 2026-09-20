'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, Video } = require('./helpers.cjs');
for (const duration of [NaN, Infinity, 0, 59, 60]) test('duration limit leaves unknown or qualifying duration alone: ' + duration, () => {
  const { controller, video, adapter, clock } = setup({ durationLimitEnabled: true, advanceDelayMs: 100 });
  video.fire('loadedmetadata', { duration }); clock.tick(5000);
  assert.equal(adapter.attempts.length, 0); controller.dispose();
});
test('late finite metadata above the limit skips without a playback completion', () => {
  const { controller, video, adapter, clock, complete } = setup({ durationLimitEnabled: true, repeatCount: 6, advanceDelayMs: 100 });
  video.fire('durationchange', { duration: NaN }); clock.tick(100);
  video.fire('loadedmetadata', { duration: 60.01, paused: true });
  complete(); video.fire('durationchange'); video.fire('playing'); clock.tick(99);
  assert.equal(adapter.attempts.length, 0); clock.tick(1);
  assert.deepEqual(adapter.attempts, [['a', 0]]);
  assert.equal(controller.state.completedPlaybacks, 0); controller.dispose();
});
test('duration limit off retains normal repeat behavior for long videos', () => {
  const { controller, video, adapter, clock, complete } = setup({ repeatCount: 1, advanceDelayMs: 100 });
  video.fire('loadedmetadata', { duration: 100 }); clock.tick(100); complete(); clock.tick(100);
  assert.equal(adapter.attempts.length, 0); complete(); clock.tick(100);
  assert.equal(adapter.attempts.length, 1); controller.dispose();
});
for (const patch of [{ durationLimitEnabled: false }, { durationLimitSeconds: 120 }, { enabled: false }, { youtubeEnabled: false }]) test('settings cancel a queued duration skip: ' + JSON.stringify(patch), () => {
  const { controller, video, adapter, clock } = setup({ durationLimitEnabled: true, advanceDelayMs: 400 });
  video.fire('loadedmetadata', { duration: 90 }); controller.updateSettings(patch); clock.tick(5000);
  assert.equal(adapter.attempts.length, 0); controller.dispose();
});
test('lowering limit applies to the current video immediately', () => {
  const { controller, video, adapter, clock } = setup({ durationLimitEnabled: true, advanceDelayMs: 100 });
  video.fire('loadedmetadata', { duration: 59 }); controller.updateSettings({ durationLimitSeconds: 30 }); clock.tick(100);
  assert.equal(adapter.attempts.length, 1); controller.dispose();
});
test('duration correction cancels queued skip and subsequent completions still work', () => {
  const { controller, video, adapter, clock } = setup({ durationLimitEnabled: true, advanceDelayMs: 100 });
  video.fire('loadedmetadata', { duration: 90 }); video.fire('durationchange', { duration: 30 }); clock.tick(500);
  assert.equal(adapter.attempts.length, 0);
  controller.monitor.callback('wrap'); clock.tick(100); assert.equal(adapter.attempts.length, 1); controller.dispose();
});
test('duration skip never follows a stale identity or hidden tab', () => {
  for (const action of ['replace', 'hidden', 'unsupported', 'interaction']) {
    const { controller, video, adapter, clock, doc } = setup({ durationLimitEnabled: true, advanceDelayMs: 100 });
    video.fire('loadedmetadata', { duration: 90 });
    if (action === 'replace') { adapter.video = new Video('b'); adapter.change(); }
    if (action === 'hidden') { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); }
    if (action === 'unsupported') { adapter.supported = false; adapter.change(); }
    if (action === 'interaction') doc.dispatchEvent(new Event('pointerdown'));
    clock.tick(5000); assert.equal(adapter.attempts.length, 0, action); controller.dispose();
  }
});
test('duration skip respects active selection and bounded retry budget', () => {
  const { controller, video, adapter, clock } = setup({ durationLimitEnabled: true, advanceDelayMs: 100 });
  adapter.canRetainVideo = () => true; adapter.video = null;
  video.fire('loadedmetadata', { duration: 90 }); clock.tick(300);
  assert.equal(adapter.attempts.length, 0);
  adapter.video = video; adapter.change(); clock.tick(5000);
  assert.deepEqual(adapter.attempts, [['a', 0], ['a', 1]]);
  video.fire('durationchange'); clock.tick(5000);
  assert.equal(adapter.attempts.length, 2); controller.dispose();
  video.fire('loadedmetadata'); assert.equal(clock.tasks.size, 0);
});
