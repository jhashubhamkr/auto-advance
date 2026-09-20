'use strict';
require('../content/settings.js');
require('../content/playback-monitor.js');
require('../content/controller.js');
globalThis.ShortAutoAdvance.log.setEnabled(false);
class Video extends EventTarget {
  constructor(id = 'a') { super(); Object.assign(this, { id, isConnected: true, currentTime: 0, duration: 10, paused: false, ended: false, seeking: false, loop: false, playCalls: 0 }); }
  fire(type, values = {}) { Object.assign(this, values); this.dispatchEvent(new Event(type)); }
  play() { this.playCalls++; this.paused = false; this.ended = false; return Promise.resolve(); }
}
class Clock {
  constructor() { this.now = 0; this.nextId = 0; this.tasks = new Map(); }
  set = (callback, ms) => { const id = ++this.nextId; this.tasks.set(id, { callback, at: this.now + ms }); return id; };
  clear = (id) => this.tasks.delete(id);
  tick(ms) {
    const end = this.now + ms;
    for (let i = 0; i < 100; i++) {
      const entry = [...this.tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) { this.now = end; return; }
      this.tasks.delete(entry[0]); this.now = entry[1].at; entry[1].callback();
    }
    throw new Error('Unbounded timer loop');
  }
}
function setup(settings = {}, realMonitor = false, options = {}) {
  const app = globalThis.ShortAutoAdvance;
  const clock = new Clock();
  const doc = new EventTarget(); doc.hidden = false;
  const video = new Video();
  const adapter = {
    platform: 'youtube', video, supported: true, attempts: [],
    isSupportedPage() { return this.supported; },
    findActiveVideo() { return this.video; },
    getVideoIdentity(v) { return v.id; },
    getActiveContainer() { return { contains: () => true }; },
    advanceToNext(v, attempt) { this.attempts.push([v.id, attempt]); return true; },
    observePageChanges(callback) { this.change = callback; }, dispose() {}
  };
  class Monitor {
    constructor(v, callback) { this.video = v; this.callback = callback; this.disposed = false; }
    dispose() { this.disposed = true; }
    prepareReplay() {}
    noteUserInteraction() {}
  }
  const controller = new app.Controller(adapter, settings, { doc,
    Monitor: realMonitor ? app.PlaybackMonitor : Monitor, setTimer: clock.set, clearTimer: clock.clear, navigationTimeoutMs: 100, ...options });
  controller.start();
  return { app, clock, doc, video, adapter, controller, complete: (signal = 'wrap') => controller.monitor.callback(signal) };
}
module.exports = { Video, Clock, setup, app: globalThis.ShortAutoAdvance };
