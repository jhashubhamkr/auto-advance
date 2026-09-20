'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, setup, Video } = require('./helpers.cjs');
function capture(t) {
  const records = [];
  t.mock.method(console, 'info', (...args) => records.push(args));
  app.log.setEnabled(true);
  t.after(() => app.log.setEnabled(false));
  return records;
}
test('diagnostics distinguish start, count, navigation and reset with video identity', (t) => {
  const records = capture(t);
  const { controller, complete, clock, adapter } = setup({ repeatCount: 0, advanceDelayMs: 100 });
  complete(); clock.tick(100); adapter.video = new Video('b'); adapter.change();
  const find = (event) => records.find(([message]) => message.includes(event));
  assert.equal(find('Playback tracking started')[1].completedPlaybacks, 0);
  assert.equal(find('Playback count incremented')[1].completedPlaybacks, 1);
  assert.equal(find('Playback count incremented')[1].requiredTotalPlaybacks, 1);
  assert.equal(find('Navigation queued')[1].videoId, 'a');
  assert.equal(find('Navigation verified: active video identity changed')[1].nextVideoId, 'b');
  assert.equal(controller.snapshot().completedPlaybacks, 0);
  controller.dispose();
});
test('disabled and missing-video states explain why monitoring is inactive', (t) => {
  const records = capture(t);
  const { controller, adapter } = setup({ enabled: false });
  assert.ok(records.some(([message, detail]) => message.includes('Controller suspended') && detail.reason === 'master switch disabled'));
  adapter.video = null; controller.updateSettings({ enabled: true });
  assert.ok(records.some(([message]) => message.includes('No active video detected')));
  controller.dispose();
});
test('settings loading, saving and local change events produce useful normalized logs', async (t) => {
  const records = capture(t);
  let changed;
  global.chrome = { storage: { local: { get: async () => ({ repeatCount: 2 }), set: async () => {} }, onChanged: { addListener: (cb) => { changed = cb; }, removeListener() {} } } };
  await app.settings.read(); await app.settings.write({ repeatCount: 1 });
  const stop = app.settings.subscribe(() => {}); changed({ repeatCount: { newValue: 3 } }, 'local'); stop();
  for (const event of ['loaded saved settings', 'saved settings to local storage', 'local storage changed']) assert.ok(records.some(([message]) => message.includes(event)));
  assert.equal(records.find(([message]) => message.includes('loaded saved settings'))[1].repeatCount, 2);
});
test('logger deduplicates unchanged scans, throttles progress, and can be disabled', (t) => {
  const records = capture(t);
  app.log.changed('scan', 'candidate scan', { count: 0 });
  app.log.changed('scan', 'candidate scan', { count: 0 });
  app.log.changed('scan', 'candidate scan', { count: 1 });
  app.log.throttle('progress', 'progress', { time: 0 });
  app.log.throttle('progress', 'progress', { time: 0.1 });
  assert.equal(records.length, 3);
  app.log.setEnabled(false); app.log.debug('silent'); app.log.changed('new', 'silent', {});
  assert.equal(records.length, 3);
});
test('identity diagnostics include URL shortcode but omit query strings and media URLs', () => {
  global.location = { hostname: 'www.instagram.com', pathname: '/reel/TEST123/', search: '?token=secret' };
  assert.equal(app.log.route().urlVideoId, 'TEST123');
  assert.ok(!JSON.stringify(app.log.route()).includes('secret'));
  const source = 'instagram:source:https://cdn.example/video?token=secret';
  assert.match(app.log.identity(source), /^instagram:source:fingerprint-[0-9a-f]+$/);
  assert.equal(app.log.identity(source), app.log.identity(source));
  assert.notEqual(app.log.identity(source), app.log.identity(`${source}2`));
});
