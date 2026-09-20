'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./helpers.cjs');
test('defaults include exactly zero additional repeats', () => {
  assert.deepEqual(app.settings.normalize(), { enabled: true, youtubeEnabled: true, instagramEnabled: true, repeatCount: 0, advanceDelayMs: 400, onlyWhenTabVisible: true, durationLimitEnabled: false, durationLimitSeconds: 60 });
});
test('invalid repeat fields never produce invalid counts', () => {
  for (const value of ['', ' ', null, undefined, NaN, Infinity, -Infinity, 'abc', {}, true]) assert.equal(app.settings.normalize({ repeatCount: value }).repeatCount, 0);
  for (const [input, expected] of [[-3, 0], [101, 6], [2.9, 2], ['2', 2]]) assert.equal(app.settings.normalize({ repeatCount: input }).repeatCount, expected);
});
test('delay and switches normalize safely', () => {
  assert.equal(app.settings.normalize({ advanceDelayMs: '' }).advanceDelayMs, 400);
  assert.equal(app.settings.normalize({ advanceDelayMs: 9999 }).advanceDelayMs, 3000);
  assert.equal(app.settings.normalize({ advanceDelayMs: -5 }).advanceDelayMs, 100);
  assert.equal(app.settings.normalize({ advanceDelayMs: 455 }).advanceDelayMs, 500);
  assert.equal(app.settings.normalize({ onlyWhenTabVisible: false }).onlyWhenTabVisible, true);
  assert.equal(app.settings.normalize({ durationLimitSeconds: 0 }).durationLimitSeconds, 30);
  assert.equal(app.settings.normalize({ durationLimitSeconds: 999 }).durationLimitSeconds, 120);
  assert.equal(app.settings.normalize({ durationLimitSeconds: NaN }).durationLimitSeconds, 60);
  assert.equal(app.settings.normalize({ enabled: 'false' }).enabled, true);
  assert.equal(app.settings.normalize({ enabled: false }).enabled, false);
});
test('local storage subscription applies only settings and handles removal', async () => {
  let handler, removed;
  global.chrome = { storage: { local: { get: async () => ({ repeatCount: 2 }), set: async (v) => { assert.equal(v.repeatCount, 0); } },
    onChanged: { addListener: (h) => { handler = h; }, removeListener: (h) => { removed = h; } } } };
  assert.equal((await app.settings.read()).repeatCount, 2);
  await app.settings.write({ repeatCount: NaN });
  const calls = [];
  const unsubscribe = app.settings.subscribe((patch) => calls.push(patch));
  handler({ repeatCount: { newValue: 3 } }, 'sync');
  handler({ popupTheme: { newValue: 'dark' } }, 'local');
  handler({ repeatCount: { newValue: 3 }, unrelated: { newValue: 'private' } }, 'local');
  handler({ repeatCount: { oldValue: 3 } }, 'local');
  assert.deepEqual(calls, [{ repeatCount: 3 }, { repeatCount: 0 }]);
  unsubscribe(); assert.equal(removed, handler);
});
test('partial storage writes keep independent preferences intact and discard unrelated keys', async () => {
  const stored = { ...app.settings.defaults, repeatCount: 3, popupTheme: 'dark' };
  const writes = [];
  global.chrome = { storage: { local: { set: async (values) => { writes.push(values); Object.assign(stored, values); } } } };
  await app.settings.patch({ enabled: false, popupTheme: 'light', unrelated: 'ignored' });
  assert.deepEqual(writes[0], { enabled: false });
  assert.equal(stored.repeatCount, 3);
  assert.equal(stored.popupTheme, 'dark');
  await app.settings.patch({ repeatCount: '2', advanceDelayMs: 9999 });
  assert.deepEqual(writes[1], { repeatCount: 2, advanceDelayMs: 3000 });
  assert.equal(stored.enabled, false);
  global.chrome.storage.local.set = async () => { throw new Error('Storage failed'); };
  await assert.rejects(app.settings.patch({ enabled: true }), /Storage failed/);
  assert.equal(stored.enabled, false);
});
