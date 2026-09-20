(() => {
  'use strict';
  const app = globalThis.ShortAutoAdvance;
  class PlaybackMonitor {
    constructor(video, onComplete, { now = () => performance.now(), videoId = null } = {}) {
      this.video = video;
      this.onComplete = onComplete;
      this.now = now;
      this.videoId = videoId;
      this.lastProgressLog = -Infinity;
      this.listeners = [];
      this.disposed = false;
      this.suppressSeekUntil = -Infinity;
      this.reset();
      for (const name of ['timeupdate', 'ended', 'seeking', 'seeked', 'durationchange', 'loadedmetadata', 'emptied', 'play', 'playing', 'pause', 'waiting', 'stalled', 'error']) {
        const handler = () => this.handle(name);
        video.addEventListener(name, handler);
        this.listeners.push([name, handler]);
      }
      app.log.debug('Media monitor attached', { videoId, frameSampling: typeof video.requestVideoFrameCallback === 'function', ...app.log.media(video) });
      // Frame callbacks cover sub-second clips that may have too few timeupdate
      // samples. They run only as this active video renders; no global DOM work.
      if (typeof video.requestVideoFrameCallback === 'function') {
        const sample = () => {
          if (this.disposed) return;
          this.handle('timeupdate');
          if (!this.disposed) this.frameCallback = video.requestVideoFrameCallback(sample);
        };
        this.frameCallback = video.requestVideoFrameCallback(sample);
      }
    }
    reset() {
      this.previousTime = Number(this.video.currentTime) || 0;
      this.duration = this.video.duration;
      this.forward = false;
      this.nearEnd = false;
      this.wasSeeking = false;
      this.nativeSeek = false;
      this.observedEndAt = null;
      this.completed = false;
      this.lastCompletionTimestamp = -Infinity;
    }
    // Called on input in the player. Browser-native looping can itself emit seeking;
    // recent pointer/keyboard interaction makes an ambiguous reset a manual seek.
    noteUserInteraction() {
      this.suppressSeekUntil = this.now() + 1500; this.nativeSeek = false;
      this.observedEndAt = null;
      app.log.debug('Media: user interaction; suppress ambiguous loop resets for 1500 ms', { videoId: this.videoId });
    }
    tolerance() { return Math.min(0.8, this.duration * 0.22); }
    valid() { return Number.isFinite(this.video.duration) && this.video.duration > 0; }
    emit(signal) {
      this.observedEndAt = null;
      if (this.disposed || this.completed) { app.log.debug('Media completion ignored: duplicate or disposed monitor', { videoId: this.videoId, signal }); return; }
      this.completed = true;
      this.lastCompletionTimestamp = this.now();
      app.log.debug('Media completion detected', { videoId: this.videoId, signal, ...app.log.media(this.video) });
      this.onComplete(signal);
    }
    handle(type) {
      if (this.disposed) return;
      const v = this.video;
      const time = v.currentTime;
      if (type !== 'timeupdate') app.log.debug(`Media event: ${type}`, { videoId: this.videoId, ...app.log.media(v) });
      if (type === 'timeupdate' && this.now() - this.lastProgressLog >= 2000) {
        this.lastProgressLog = this.now();
        app.log.debug('Playback progress (every 2 seconds while samples arrive)', { videoId: this.videoId, ...app.log.media(v),
          previousTime: this.previousTime, nearEnd: this.nearEnd, forward: this.forward, completionLatched: this.completed,
          seekingInProgress: this.wasSeeking, recentUserInteraction: this.now() <= this.suppressSeekUntil });
      }
      if (['durationchange', 'loadedmetadata', 'emptied'].includes(type) || v.duration !== this.duration) {
        app.log.debug('Media sampling history reset: metadata/duration changed; no completion counted', { videoId: this.videoId, event: type, previousDuration: String(this.duration), duration: String(v.duration) });
        this.reset();
        return;
      }
      if (!this.valid()) { app.log.throttle('media:duration', 'Media: waiting for a finite positive duration', () => ({ videoId: this.videoId, ...app.log.media(v) })); return; }
      const tolerance = this.tolerance();
      const atStart = time <= tolerance;
      // Instagram can rewind and play in its earlier ended listener. By the time
      // our listener runs, ended is false and seeking is true. Preserve the genuine
      // terminal state seen by pause/timeupdate until that queued ended event.
      // This is evidence of ended=true, never an inference from being near the end.
      if ((type === 'pause' || type === 'timeupdate') && !this.completed && this.observedEndAt === null &&
          v.ended && !v.seeking && !this.wasSeeking && time >= this.duration - tolerance) {
        this.observedEndAt = this.now();
        app.log.debug('Media: genuine end state observed; retaining evidence for queued ended event', { videoId: this.videoId, observedOn: type, currentTime: time, duration: this.duration });
      }
      if (type === 'seeking') {
        this.wasSeeking = true;
        this.nativeSeek = v.loop && this.nearEnd && this.forward && atStart &&
          !v.paused && this.now() > this.suppressSeekUntil;
        app.log.debug('Media seek classified', { videoId: this.videoId, nativeLoopCandidate: this.nativeSeek, nearEnd: this.nearEnd,
          forward: this.forward, atStart, recentUserInteraction: this.now() <= this.suppressSeekUntil });
        if (!this.nativeSeek) { this.nearEnd = false; this.forward = false; }
        return;
      }
      if (type === 'seeked') {
        const wrapped = this.nativeSeek && atStart && !v.paused;
        this.wasSeeking = false;
        this.nativeSeek = false;
        this.previousTime = time;
        this.nearEnd = false;
        this.forward = false;
        if (wrapped) this.emit('native-loop');
        else app.log.debug('Media seek finished: no completion counted', { videoId: this.videoId });
        return;
      }
      if (type === 'ended') {
        // A genuine ended state after seeked is deliberately accepted.
        const currentlyEnded = v.ended && !v.seeking && !this.wasSeeking;
        const observedEnd = this.observedEndAt !== null && this.now() - this.observedEndAt <= 1000;
        this.observedEndAt = null;
        if (currentlyEnded || observedEnd) {
          if (!currentlyEnded) app.log.debug('Media: recovered completion after platform restarted before ended handler', { videoId: this.videoId, currentTime: time, seeking: v.seeking });
          this.emit('ended');
        }
        else app.log.debug('Media ended event ignored: no genuine ended state or seek still in progress', { videoId: this.videoId });
        return;
      }
      if (type === 'pause') {
        if (!v.ended) { this.forward = false; this.nearEnd = false; }
        return;
      }
      if (type !== 'timeupdate' || v.seeking || this.wasSeeking) return;
      if (v.paused) { this.previousTime = time; this.forward = false; this.nearEnd = false; return; }
      const delta = time - this.previousTime;
      if (delta < 0 && this.nearEnd && this.forward && atStart && this.now() > this.suppressSeekUntil) {
        this.emit('wrap');
      } else if (delta < -0.005) app.log.debug('Media backward time jump ignored: wrap criteria not satisfied', { videoId: this.videoId, previousTime: this.previousTime, currentTime: time, nearEnd: this.nearEnd, forward: this.forward, atStart, recentUserInteraction: this.now() <= this.suppressSeekUntil });
      // Re-arm only after forward progress in the new playback. This deduplicates
      // ended + reset + wrap without a fixed debounce that would lose short clips.
      if (delta > 0.005 && time < this.duration - tolerance) {
        if (this.completed) app.log.debug('Media: next playback started; completion detection rearmed', { videoId: this.videoId });
        this.completed = false;
      }
      if (Math.abs(delta) > 0.005) {
        if (!this.nearEnd && delta > 0 && time >= this.duration - tolerance) app.log.debug('Media: near end; watching for a loop reset', { videoId: this.videoId, currentTime: time, duration: this.duration, tolerance });
        this.forward = delta > 0;
        this.nearEnd = this.forward && time >= this.duration - tolerance;
      }
      this.previousTime = time;
    }
    prepareReplay() {
      this.previousTime = 0;
      this.forward = false;
      this.nearEnd = false;
      // Keep completed latched until actual forward progress after replay.
    }
    dispose() {
      app.log.debug('Media monitor disposed: listeners and frame callback removed', { videoId: this.videoId });
      this.disposed = true;
      this.observedEndAt = null;
      if (this.frameCallback !== undefined) this.video.cancelVideoFrameCallback(this.frameCallback);
      for (const [name, handler] of this.listeners) this.video.removeEventListener(name, handler);
      this.listeners = [];
    }
  }
  app.PlaybackMonitor = PlaybackMonitor;
})();
