'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, Video } = require('./helpers.cjs');
class Overlay {
  show(video, options) { this.video = video; this.options = options; this.visible = true; }
  hide() { this.visible = false; }
  containsEvent(event) { return event.overlay === true; }
}
const fixture = (values = {}) => setup({ advanceDelayMs: 400, ...values }, false, { Overlay });
for (const repeatCount of [0, 1, 2, 6]) test('Watch again restarts the complete repeat cycle for repeat ' + repeatCount, () => {
  const f = fixture({ repeatCount });
  for (let i = 0; i <= repeatCount; i++) f.complete();
  const overlay = f.controller.overlay;
  assert.equal(overlay.visible, true); assert.equal(overlay.options.durationMs, 400);
  f.clock.tick(399); f.video.currentTime = 7;
  const oldClick = overlay.options.onWatchAgain;
  assert.equal(oldClick(), true);
  assert.equal(f.video.currentTime, 0); assert.equal(f.video.playCalls, 1);
  assert.equal(f.controller.state.completedPlaybacks, 0); assert.equal(overlay.visible, false);
  assert.equal(oldClick(), false); // Old overlay callbacks cannot reset the new cycle.
  f.clock.tick(2000); assert.equal(f.adapter.attempts.length, 0);
  for (let i = 0; i < repeatCount; i++) { f.complete(); f.clock.tick(400); assert.equal(f.adapter.attempts.length, 0); }
  f.complete(); f.clock.tick(399); assert.equal(f.adapter.attempts.length, 0);
  f.clock.tick(1); assert.equal(f.adapter.attempts.length, 1); assert.equal(overlay.visible, false);
  f.controller.dispose();
});
test('expired Watch again cannot interrupt dispatched navigation', () => {
  const f = fixture(); f.complete(); const click = f.controller.overlay.options.onWatchAgain;
  f.clock.tick(400); assert.equal(click(), false); assert.equal(f.video.playCalls, 0); f.controller.dispose();
});
for (const action of ['identity', 'hidden', 'disabled', 'route', 'dispose', 'interaction']) test('countdown cancels safely on ' + action, () => {
  const f = fixture(); f.complete(); const click = f.controller.overlay.options.onWatchAgain;
  if (action === 'identity') { f.adapter.video = new Video('b'); f.adapter.change(); }
  if (action === 'hidden') { f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); }
  if (action === 'disabled') f.controller.updateSettings({ enabled: false });
  if (action === 'route') { f.adapter.supported = false; f.adapter.change(); }
  if (action === 'dispose') f.controller.dispose();
  if (action === 'interaction') f.doc.dispatchEvent(new Event('pointerdown'));
  assert.equal(f.controller.overlay.visible, false); assert.equal(click(), false);
  f.clock.tick(2000); assert.equal(f.adapter.attempts.length, 0); f.controller.dispose();
});
test('overlay pointer actions do not exhaust navigation before its click', () => {
  const f = fixture(); f.complete(); const event = new Event('pointerdown'); event.overlay = true; f.doc.dispatchEvent(event);
  assert.equal(f.controller.countdownActive, true); assert.equal(f.controller.exhausted, false);
  assert.equal(f.controller.overlay.options.onWatchAgain(), true); f.controller.dispose();
});
test('Watch again overrides duration for this identity only and still honors repeats', () => {
  const f = fixture({ durationLimitEnabled: true, repeatCount: 1 });
  f.video.fire('loadedmetadata', { duration: 90 }); assert.equal(f.controller.navigationReason, 'duration');
  f.controller.overlay.options.onWatchAgain(); f.adapter.change(); f.clock.tick(1000);
  assert.equal(f.adapter.attempts.length, 0); f.complete(); f.clock.tick(500); assert.equal(f.adapter.attempts.length, 0);
  f.complete(); assert.equal(f.controller.navigationReason, 'playbacks');
  f.adapter.video = new Video('b'); f.adapter.video.duration = 90; f.adapter.change();
  assert.equal(f.controller.navigationReason, 'duration'); f.controller.dispose();
});
test('ad detection uses the full delay, skips before completion and takes priority over duration/repeats', () => {
  const f = fixture({ repeatCount: 6, durationLimitEnabled: true });
  f.adapter.getAdEvidence = () => 'explicit ad marker'; f.video.duration = 90; f.adapter.change();
  assert.equal(f.controller.navigationReason, 'ad'); assert.equal(f.controller.overlay.options.reason, 'ad');
  assert.equal(f.controller.overlay.options.onWatchAgain(), false);
  f.complete(); f.adapter.change(); f.clock.tick(399); assert.equal(f.adapter.attempts.length, 0);
  f.clock.tick(1); assert.equal(f.adapter.attempts.length, 1); assert.equal(f.controller.state.completedPlaybacks, 0);
  f.clock.tick(3000); assert.equal(f.adapter.attempts.length, 2); assert.equal(f.controller.overlay.visible, false);
  f.adapter.change(); f.clock.tick(3000); assert.equal(f.adapter.attempts.length, 2); f.controller.dispose();
});
test('ad marker disappearing before dispatch cancels skip without consuming a playback', () => {
  const f = fixture(); f.adapter.getAdEvidence = () => 'ad'; f.adapter.change();
  f.adapter.getAdEvidence = () => null; f.clock.tick(1000);
  assert.equal(f.adapter.attempts.length, 0); assert.equal(f.controller.state.completedPlaybacks, 0);
  f.complete(); f.clock.tick(400); assert.equal(f.adapter.attempts.length, 1); f.controller.dispose();
});
test('changing delay replaces the countdown; stale click cannot affect the replacement', () => {
  const f = fixture(); f.complete(); const oldClick = f.controller.overlay.options.onWatchAgain;
  f.controller.updateSettings({ advanceDelayMs: 1000 });
  assert.equal(f.controller.overlay.options.durationMs, 1000); assert.equal(oldClick(), false);
  f.clock.tick(999); assert.equal(f.adapter.attempts.length, 0); f.clock.tick(1); assert.equal(f.adapter.attempts.length, 1); f.controller.dispose();
});
test('a newly detected ad cannot inherit the almost-expired playback countdown', () => {
  const f = fixture({ advanceDelayMs: 1000 }); f.complete(); f.clock.tick(900);
  f.adapter.getAdEvidence = () => 'confirmed current ad'; f.adapter.change();
  assert.equal(f.controller.navigationReason, 'ad');
  f.clock.tick(999); assert.equal(f.adapter.attempts.length, 0);
  f.clock.tick(1); assert.equal(f.adapter.attempts.length, 1); f.controller.dispose();
});
for (const change of ['identity', 'source', 'route']) test('recycled ad player gets a full saved delay after ' + change + ' changes', () => {
  const previousLocation = globalThis.location;
  globalThis.location = { href: 'https://www.youtube.com/shorts/a' };
  try {
    const f = fixture({ advanceDelayMs: 1000 }); f.adapter.getAdEvidence = () => 'ad';
    f.adapter.change(); f.clock.tick(900);
    if (change === 'identity') f.video.id = 'b';
    if (change === 'source') f.video.currentSrc = 'new-media';
    if (change === 'route') globalThis.location.href = 'https://www.youtube.com/shorts/b';
    f.adapter.change(); f.clock.tick(999); assert.equal(f.adapter.attempts.length, 0);
    f.clock.tick(1); assert.equal(f.adapter.attempts.length, 1); f.controller.dispose();
  } finally { globalThis.location = previousLocation; }
});
