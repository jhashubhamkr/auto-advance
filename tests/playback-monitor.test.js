'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, Video } = require('./helpers.cjs');
function monitor(values = {}) {
  const video = Object.assign(new Video(), values);
  const signals = [];
  let now = 10000;
  const m = new app.PlaybackMonitor(video, (s) => signals.push(s), { now: () => now });
  return { video, signals, m, tick: (time) => { now += 250; video.fire('timeupdate', { currentTime: time }); } };
}
test('normal genuine ended event and duplicate ended count once', () => {
  const { video, signals } = monitor();
  video.fire('ended', { currentTime: 10, ended: true, paused: true });
  video.fire('ended'); assert.deepEqual(signals, ['ended']);
});
test('forward near-end to zero native wrap counts', () => {
  const { tick, signals } = monitor({ loop: true });
  tick(9.4); tick(9.8); tick(0.05); assert.deepEqual(signals, ['wrap']);
});
test('native loop seeking and seeked events count a single completion', () => {
  const { video, tick, signals } = monitor({ loop: true });
  tick(9.7);
  video.fire('seeking', { seeking: true, currentTime: 0 });
  video.fire('timeupdate');
  video.fire('seeked', { seeking: false });
  tick(0.01); assert.deepEqual(signals, ['native-loop']);
});
test('duplicate ended followed by wrap counts once', () => {
  const { tick, video, signals } = monitor();
  tick(9.8); video.fire('ended', { ended: true }); tick(0);
  assert.equal(signals.length, 1);
});
test('second full playback rearms without a long fixed debounce', () => {
  const { tick, signals } = monitor({ duration: 0.5, loop: true });
  tick(0.2); tick(0.45); tick(0.01); tick(0.2); tick(0.45); tick(0.01);
  assert.equal(signals.length, 2);
});
for (const target of [0, 2]) test(`manual backward seek to ${target} does not count`, () => {
  const { tick, video, signals, m } = monitor({ loop: true });
  tick(9.8); m.noteUserInteraction();
  video.fire('seeking', { seeking: true, currentTime: target });
  video.fire('seeked', { seeking: false }); tick(target + 0.1);
  assert.equal(signals.length, 0);
});
test('non-looping programmatic backward seek does not count', () => {
  const { tick, video, signals } = monitor();
  tick(9.8); video.fire('seeking', { currentTime: 0, seeking: true });
  video.fire('seeked', { seeking: false }); tick(0.1); assert.equal(signals.length, 0);
});
test('duration changes and metadata reloads never count', () => {
  for (const event of ['durationchange', 'loadedmetadata', 'emptied']) {
    const { tick, video, signals } = monitor();
    tick(9.8); video.fire(event, { currentTime: 0, duration: 12 }); tick(0.1);
    assert.equal(signals.length, 0);
  }
});
test('pause and buffering near end do not count', () => {
  const { tick, video, signals } = monitor();
  tick(9.8); tick(9.8); tick(9.8);
  video.fire('pause', { paused: true }); tick(0);
  assert.equal(signals.length, 0);
});
test('buffering stationary samples preserve an otherwise genuine wrap', () => {
  const { tick, signals } = monitor();
  tick(9.8); tick(9.8); tick(0); assert.equal(signals.length, 1);
});
test('seeking to end counts only genuine ended after seeking finishes', () => {
  const { video, signals } = monitor();
  video.fire('seeking', { seeking: true, currentTime: 10 });
  video.fire('ended', { ended: true }); assert.equal(signals.length, 0);
  video.fire('seeked', { seeking: false }); video.fire('ended'); assert.equal(signals.length, 1);
});
test('invalid durations and synthetic ended without ended state are ignored', () => {
  for (const duration of [0, NaN, Infinity]) {
    const { video, signals } = monitor({ duration }); video.fire('ended', { ended: true }); assert.equal(signals.length, 0);
  }
  const { video, signals } = monitor(); video.fire('ended'); assert.equal(signals.length, 0);
});
test('disposal removes listeners and replacement starts fresh', () => {
  const { tick, video, signals, m } = monitor();
  tick(9.8); m.dispose(); video.fire('ended', { ended: true }); tick(0);
  const replacement = new app.PlaybackMonitor(new Video(), () => signals.push('unexpected'));
  assert.equal(signals.length, 0); replacement.dispose();
});

test('Instagram end-state race: pause observes ended before site restarts ahead of ended listener', () => {
  const { video, tick, signals } = monitor({ loop: false });
  tick(9.8);
  video.fire('pause', { currentTime: 10, paused: true, ended: true });
  // An earlier site ended handler synchronously sets currentTime=0 and play().
  video.fire('ended', { currentTime: 0, paused: false, ended: false, seeking: true });
  video.fire('seeking'); video.fire('seeked', { seeking: false });
  assert.deepEqual(signals, ['ended']);
});
test('terminal timeupdate evidence survives Instagram restart and deduplicates pause/ended/seek signals', () => {
  const { video, tick, signals } = monitor({ loop: false });
  tick(9.8); video.fire('timeupdate', { currentTime: 10, paused: true, ended: true });
  video.fire('pause');
  video.fire('ended', { currentTime: 0, paused: false, ended: false, seeking: true });
  video.fire('ended'); video.fire('seeking'); video.fire('seeked', { seeking: false });
  assert.deepEqual(signals, ['ended']);
});
test('manual pause and restart near end is never accepted as Instagram completion', () => {
  const { video, tick, signals } = monitor();
  tick(9.8); video.fire('pause', { paused: true, ended: false });
  video.fire('ended', { currentTime: 0, paused: false, seeking: true });
  video.fire('seeking'); video.fire('seeked', { seeking: false });
  assert.deepEqual(signals, []);
});
test('user input or metadata reload invalidates pending terminal evidence', () => {
  for (const invalidate of ['input', 'loadedmetadata', 'emptied', 'durationchange']) {
    const { video, tick, signals, m } = monitor();
    tick(9.8); video.fire('pause', { currentTime: 10, paused: true, ended: true });
    if (invalidate === 'input') m.noteUserInteraction(); else video.fire(invalidate);
    video.fire('ended', { currentTime: 0, ended: false, paused: false, seeking: true });
    assert.deepEqual(signals, [], invalidate);
  }
});
test('stale observed end state cannot be used by a much later ended event', () => {
  const { video, tick, signals } = monitor();
  tick(9.8); video.fire('pause', { currentTime: 10, ended: true, paused: true });
  for (let i = 0; i < 5; i++) tick(10);
  video.fire('ended', { currentTime: 0, ended: false, paused: false, seeking: true });
  assert.deepEqual(signals, []);
});
