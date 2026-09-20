'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, Video } = require('./helpers.cjs');
for (const repeatCount of [0, 1, 2]) test(`repeat ${repeatCount} advances after ${repeatCount + 1} playbacks`, () => {
  const { video, controller, complete, clock, adapter } = setup({ repeatCount, advanceDelayMs: 100 });
  for (let i = 0; i <= repeatCount; i++) {
    video.ended = true; complete('ended'); clock.tick(100);
    assert.equal(controller.state.completedPlaybacks, i + 1);
    assert.equal(adapter.attempts.length, i < repeatCount ? 0 : 1);
  }
  assert.equal(video.playCalls, repeatCount); controller.dispose();
});
test('native loops needing repetition are not manually restarted', () => {
  const { complete, video, controller } = setup({ repeatCount: 2 }); complete();
  assert.equal(video.playCalls, 0); controller.dispose();
});
test('manual identity change resets counts and releases lock', () => {
  const { controller, adapter, complete } = setup(); complete();
  const old = controller.monitor; adapter.video = new Video('b'); adapter.change();
  assert.equal(controller.state.completedPlaybacks, 0);
  assert.equal(controller.state.navigationInProgress, false);
  assert.equal(old.disposed, true); controller.dispose();
});
test('element replacement preserves counts but does not count completion', () => {
  const { controller, adapter, complete } = setup({ repeatCount: 2 }); complete();
  adapter.video = new Video('a'); adapter.change();
  assert.equal(controller.state.completedPlaybacks, 1); controller.dispose();
});
test('old callbacks and stale timer cannot advance the next video', () => {
  const { controller, adapter, complete, clock } = setup();
  const oldMonitor = controller.monitor; complete();
  const oldTimer = [...clock.tasks.values()][0].callback;
  adapter.video = new Video('b'); adapter.change(); oldMonitor.callback('ended'); oldTimer(); clock.tick(5000);
  assert.equal(controller.state.completedPlaybacks, 0); assert.equal(adapter.attempts.length, 0); controller.dispose();
});
test('duplicate completions cause at most one initial navigation', () => {
  const { controller, complete, adapter, clock } = setup();
  complete(); complete(); complete(); clock.tick(400);
  assert.equal(adapter.attempts.length, 1); assert.equal(controller.state.completedPlaybacks, 1); controller.dispose();
});
test('failed navigation gets one different attempt then releases and stays stopped', () => {
  const { controller, complete, adapter, clock } = setup({ advanceDelayMs: 100 });
  complete(); clock.tick(1000); complete(); clock.tick(10000);
  assert.deepEqual(adapter.attempts, [['a', 0], ['a', 1]]);
  assert.equal(controller.state.navigationInProgress, false); controller.dispose();
});
test('missing safe navigation strategy releases without retry loop', () => {
  const { controller, adapter, complete, clock } = setup({ advanceDelayMs: 100 });
  adapter.advanceToNext = () => false; complete(); clock.tick(1000);
  assert.equal(controller.state.navigationInProgress, false); assert.equal(clock.tasks.size, 0); controller.dispose();
});
test('element churn during navigation cannot reset the attempt budget', () => {
  const { controller, adapter, complete, clock } = setup({ advanceDelayMs: 100 });
  complete(); clock.tick(100); adapter.video = new Video('a'); adapter.change();
  complete(); clock.tick(10000); assert.equal(adapter.attempts.length, 1); controller.dispose();
});
test('successful identity change cancels fallback', () => {
  const { controller, adapter, complete, clock } = setup({ advanceDelayMs: 100 });
  complete(); clock.tick(100); adapter.video = new Video('b'); adapter.change(); clock.tick(1000);
  assert.equal(adapter.attempts.length, 1); assert.equal(controller.state.navigationInProgress, false); controller.dispose();
});
test('disabled master and disabled platforms do not attach monitors', () => {
  for (const settings of [{ enabled: false }, { youtubeEnabled: false }]) {
    const { controller } = setup(settings); assert.equal(controller.monitor, null); controller.dispose();
  }
});
test('live settings immediately detach, cancel delay and re-enable current video', () => {
  const { controller, complete, clock, adapter } = setup(); complete(); controller.updateSettings({ enabled: false });
  assert.equal(controller.monitor, null); clock.tick(10000); assert.equal(adapter.attempts.length, 0);
  controller.updateSettings({ enabled: true }); assert.ok(controller.monitor); controller.dispose();
});
test('repeat increase while waiting cancels advance, retaining count', () => {
  const { controller, complete, clock, adapter } = setup(); complete(); controller.updateSettings({ repeatCount: 2 });
  clock.tick(1000); assert.equal(adapter.attempts.length, 0); assert.equal(controller.state.completedPlaybacks, 1); controller.dispose();
});
test('repeat reduction applies retained completed count safely', () => {
  const { controller, complete, clock, adapter } = setup({ repeatCount: 2 });
  complete(); controller.updateSettings({ repeatCount: 0 }); clock.tick(400);
  assert.equal(adapter.attempts.length, 1); controller.dispose();
});
test('repeat increase during ended advance delay replays the stopped clip', () => {
  const { controller, complete, video, clock, adapter } = setup(); video.ended = true; video.paused = true;
  complete('ended'); controller.updateSettings({ repeatCount: 1 }); clock.tick(1000);
  assert.equal(video.playCalls, 1); assert.equal(adapter.attempts.length, 0); controller.dispose();
});
test('hidden tab suspends and drops pending action; foreground starts fresh', () => {
  const { controller, complete, clock, adapter, doc } = setup(); complete(); doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange')); clock.tick(1000);
  assert.equal(controller.monitor, null); assert.equal(adapter.attempts.length, 0);
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
  assert.ok(controller.monitor); assert.equal(controller.state.completedPlaybacks, 0); controller.dispose();
});
test('legacy visibility option off is overridden; hidden tabs never advance', () => {
  const { controller, complete, clock, adapter, doc } = setup({ onlyWhenTabVisible: false });
  doc.hidden = true; complete(); clock.tick(400); assert.equal(adapter.attempts.length, 0); controller.dispose();
});
test('manual pause during advance delay cancels navigation', () => {
  const { controller, complete, clock, adapter, video } = setup(); complete(); video.paused = true;
  clock.tick(1000); assert.equal(adapter.attempts.length, 0); controller.dispose();
});
test('unsupported route detaches without affecting normal video', () => {
  const { controller, adapter } = setup(); adapter.supported = false; adapter.change();
  assert.equal(controller.monitor, null); controller.dispose();
});
test('rejected play promise does not retry endlessly', async () => {
  const { controller, video, complete } = setup({ repeatCount: 1 });
  let calls = 0; video.ended = true; video.play = () => { calls++; return Promise.reject(new Error('blocked')); };
  complete('ended'); await Promise.resolve(); assert.equal(calls, 1); controller.dispose();
});
test('real monitor and controller integrate for repeat two with native looping', () => {
  const { controller, video, clock, adapter } = setup({ repeatCount: 2, advanceDelayMs: 100 }, true);
  for (let i = 0; i < 3; i++) {
    video.fire('timeupdate', { currentTime: 2 }); video.fire('timeupdate', { currentTime: 9.8 }); video.fire('timeupdate', { currentTime: 0 });
  }
  clock.tick(100); assert.equal(controller.state.completedPlaybacks, 3); assert.equal(adapter.attempts.length, 1); controller.dispose();
});
for (const repeatCount of [0, 1, 2]) test(`Instagram script restart honors repeat ${repeatCount} without double replay or skipped counts`, () => {
  const { controller, video, clock, adapter } = setup({ repeatCount, advanceDelayMs: 100 }, true);
  for (let i = 0; i <= repeatCount; i++) {
    video.fire('timeupdate', { currentTime: 2 });
    video.fire('timeupdate', { currentTime: 9.8 });
    video.fire('pause', { currentTime: 10, paused: true, ended: true });
    video.fire('ended', { currentTime: 0, paused: false, ended: false, seeking: true });
    video.fire('seeking'); video.fire('seeked', { seeking: false });
    clock.tick(100);
    assert.equal(controller.state.completedPlaybacks, i + 1);
    assert.equal(adapter.attempts.length, i < repeatCount ? 0 : 1);
  }
  assert.equal(video.playCalls, 0, 'the platform already restarted playback');
  controller.dispose();
});
