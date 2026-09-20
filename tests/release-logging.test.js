'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('fresh public context is quiet until diagnostics are explicitly enabled', () => {
  const messages = [], warnings = [];
  const context = vm.createContext({ console: { info: (...args) => messages.push(args), warn: (...args) => warnings.push(args) }, performance: { now: () => 10000 } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/settings.js'), 'utf8'), context);
  const log = context.ShortAutoAdvance.log;
  let detailReads = 0;
  log.debug('startup'); log.changed('scan', 'scan', { count: 1 });
  log.throttle('progress', 'progress', () => { detailReads++; return {}; });
  assert.equal(messages.length, 0); assert.equal(detailReads, 0);
  log.warn('Storage unavailable'); assert.equal(warnings.length, 1);
  log.setEnabled(true); log.debug('opt-in diagnostic');
  assert.equal(messages.length, 1);
  log.setEnabled(false); log.debug('quiet again'); assert.equal(messages.length, 1);
});
