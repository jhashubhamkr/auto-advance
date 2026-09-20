(() => {
  'use strict';
  const app = globalThis.ShortAutoAdvance;
  class Controller {
    constructor(adapter, settings, { doc = document, Monitor = app.PlaybackMonitor,
      setTimer = (callback, ms) => setTimeout(callback, ms), clearTimer = (timer) => clearTimeout(timer), navigationTimeoutMs = 1600, Overlay = app.CountdownOverlay,
      readCurrentSettings = null, isContextValid = () => true } = {}) {
      this.adapter = adapter;
      this.settings = app.settings.normalize(settings);
      this.doc = doc;
      this.Monitor = Monitor;
      this.setTimer = setTimer;
      this.clearTimer = clearTimer;
      this.navigationTimeoutMs = navigationTimeoutMs;
      this.readCurrentSettings = readCurrentSettings;
      this.isContextValid = isContextValid;
      this.overlay = Overlay ? new Overlay(doc) : null;
      this.countdownActive = false;
      this.durationBypassId = null;
      this.state = { activeVideo: null, activeVideoId: null, completedPlaybacks: 0,
        navigationInProgress: false, lastCompletionTimestamp: 0 };
      this.generation = 0;
      this.timer = null;
      this.retentionTimer = null;
      this.pendingCompletions = [];
      this.activePageUrl = null;
      this.exhausted = false;
      this.destroyed = false;
      this.navigationReason = null;
      this.adContext = null;
      this.durationChanged = () => this.reconcile();
      this.visibility = () => { app.log.debug('Visibility changed', { hidden: this.doc.hidden, onlyWhenTabVisible: this.settings.onlyWhenTabVisible }); this.reconcile(); };
      this.interaction = (event) => {
        if (this.overlay?.containsEvent(event)) return;
        if (!this.monitor) return;
        if (event.type === 'keydown' && !['ArrowLeft', 'ArrowRight', 'Home', 'End', ' ', 'k', 'j', 'l'].includes(event.key)) return;
        const container = this.adapter.getActiveContainer(this.state.activeVideo);
        if (event.type === 'keydown' || container?.contains(event.target)) {
          app.log.debug('Player interaction detected', { type: event.type, key: event.key, videoId: app.log.identity(this.state.activeVideoId) });
          this.monitor?.noteUserInteraction();
          if (this.pendingCompletions.length) {
            app.log.debug('Player interaction: discarding completions awaiting active-video confirmation');
            this.pendingCompletions = [];
          }
          // An explicit interaction cancels delayed auto-navigation for this clip.
          if (this.state.navigationInProgress) { app.log.debug('Navigation cancelled: user interacted; manual next required for this clip'); this.cancelOperation(); this.exhausted = true; }
        }
      };
    }
    start() {
      app.log.debug('Controller started', { platform: this.adapter.platform, settings: { ...this.settings } });
      this.doc.addEventListener('visibilitychange', this.visibility);
      this.doc.addEventListener('pointerdown', this.interaction, true);
      this.doc.addEventListener('pointerup', this.interaction, true);
      this.doc.addEventListener('keydown', this.interaction, true);
      this.adapter.observePageChanges(() => this.reconcile());
      this.reconcile();
    }
    snapshot() {
      return { platform: this.adapter.platform, videoId: app.log.identity(this.state.activeVideoId),
        completedPlaybacks: this.state.completedPlaybacks, additionalRepeats: this.settings.repeatCount,
        requiredTotalPlaybacks: this.settings.repeatCount + 1, navigationInProgress: this.state.navigationInProgress,
        waitingForManualNavigation: this.exhausted && !this.state.navigationInProgress,
        retainingThroughPlayerGap: this.retentionTimer !== null, pendingCompletions: this.pendingCompletions.length,
        countdownActive: this.countdownActive, navigationReason: this.navigationReason,
        generation: this.generation, monitoring: Boolean(this.monitor), media: app.log.media(this.state.activeVideo) };
    }
    suspensionReason() {
      if (this.destroyed) return 'controller disposed';
      if (!this.isContextValid()) return 'extension context invalidated; reload the page';
      if (!this.settings.enabled) return 'master switch disabled';
      if (!this.settings[`${this.adapter.platform}Enabled`]) return 'platform switch disabled';
      if (this.settings.onlyWhenTabVisible && this.doc.hidden) return 'tab hidden and visible-tab-only setting enabled';
      if (!this.adapter.isSupportedPage()) return 'URL is outside a supported Shorts/Reels route';
      return null;
    }
    enabled() { return this.suspensionReason() === null; }
    clearRetention() {
      if (this.retentionTimer !== null) this.clearTimer(this.retentionTimer);
      this.retentionTimer = null;
      this.pendingCompletions = [];
    }
    retainThroughPlayerGap() {
      const video = this.state.activeVideo;
      if (!this.enabled() || !this.monitor || !video?.isConnected ||
          globalThis.location?.href !== this.activePageUrl ||
          this.adapter.getVideoIdentity(video) !== this.state.activeVideoId || !this.adapter.canRetainVideo?.(video)) return false;
      if (this.retentionTimer === null) {
        const generation = this.generation;
        app.log.debug('Temporary player gap: retaining monitor for up to 1500 ms; navigation requires reconfirmation', this.snapshot());
        this.retentionTimer = this.setTimer(() => {
          if (generation !== this.generation) return;
          this.retentionTimer = null;
          if (this.enabled() && this.adapter.findActiveVideo()) this.reconcile();
          else {
            app.log.debug('Player gap expired: discarding unconfirmed completions and detaching', this.snapshot());
            this.detach(false);
          }
        }, 1500);
      }
      return true;
    }
    cancelOperation() {
      if (this.timer !== null || this.state.navigationInProgress) app.log.debug('Navigation: cancelling pending operation and invalidating old timer', this.snapshot());
      this.generation++;
      this.hideCountdown();
      this.clearRetention();
      if (this.timer !== null) this.clearTimer(this.timer);
      this.timer = null;
      this.state.navigationInProgress = false;
      this.navigationReason = null;
      this.adContext = null;
    }
    detach(clearIdentity = true) {
      this.cancelOperation();
      for (const name of ['loadedmetadata', 'durationchange', 'playing']) this.state.activeVideo?.removeEventListener(name, this.durationChanged);
      if (this.monitor) app.log.debug('Playback tracking detached', this.snapshot());
      this.monitor?.dispose(); this.monitor = null;
      this.state.activeVideo = null;
      if (clearIdentity) {
        if (this.state.activeVideoId !== null) app.log.debug('Playback count reset to 0: monitoring suspended', { previousVideoId: app.log.identity(this.state.activeVideoId), previousCount: this.state.completedPlaybacks });
        this.state.activeVideoId = null; this.state.completedPlaybacks = 0; this.exhausted = false;
        this.durationBypassId = null;
      }
    }
    reconcile() {
      app.reportPageStatus?.(this.adapter.isSupportedPage());
      const reason = this.suspensionReason();
      app.log.changed('controller:route', reason ? 'Controller suspended: no automatic action' : `Detected ${this.adapter.platform === 'youtube' ? 'YouTube Shorts' : 'Instagram Reels'} route`, { reason, ...app.log.route() });
      if (reason) { this.detach(); return; }
      const video = this.adapter.findActiveVideo();
      if (!video) {
        app.log.changed('controller:candidate', 'No active video detected: waiting for a supported visible player', { platform: this.adapter.platform });
        if (this.retainThroughPlayerGap()) return;
        this.detach(false); return;
      }
      const id = this.adapter.getVideoIdentity(video);
      app.log.changed('controller:candidate', 'Active video detected', { platform: this.adapter.platform, videoId: app.log.identity(id) });
      if (video === this.state.activeVideo && id === this.state.activeVideoId) {
        if (this.navigationReason === 'ad' && (!this.adapter.getAdEvidence?.(video) ||
            this.adContext?.url !== globalThis.location?.href || this.adContext?.source !== (video.currentSrc || video.getAttribute?.('src') || ''))) {
          app.log.debug('Ad countdown cancelled: active route, media or ad evidence changed; a confirmed ad gets a fresh full delay');
          this.detach(false); this.reconcile(); return;
        }
        if (this.navigationReason === 'duration' && !this.exceedsDuration(video)) {
          app.log.debug('Duration skip cancelled: video no longer exceeds the limit');
          this.detach(false); this.reconcile(); return;
        }
        const pending = this.pendingCompletions;
        if (this.retentionTimer !== null || pending.length) app.log.debug('Active video reconfirmed after player gap: preserving monitor and processing buffered completions', this.snapshot());
        this.clearRetention();
        this.activePageUrl = globalThis.location?.href;
        if (this.checkAd() || this.checkDuration()) return;
        for (const signal of pending) this.complete(signal);
        if (!this.exhausted && this.state.completedPlaybacks >= this.settings.repeatCount + 1) this.queueAdvance();
        return;
      }
      const sameIdentity = id === this.state.activeVideoId;
      const previousId = this.state.activeVideoId;
      if (this.state.navigationInProgress && previousId !== id) app.log.debug('Navigation verified: active video identity changed; releasing lock', { previousVideoId: app.log.identity(previousId), nextVideoId: app.log.identity(id) });
      this.detach(false);
      if (!sameIdentity) {
        app.log.debug('Playback count reset to 0: new video identity', { previousVideoId: app.log.identity(previousId), videoId: app.log.identity(id), previousCount: this.state.completedPlaybacks });
        this.state.completedPlaybacks = 0; this.exhausted = false;
        this.durationBypassId = null;
      }
      this.state.activeVideo = video;
      this.state.activeVideoId = id;
      this.activePageUrl = globalThis.location?.href;
      const generation = this.generation;
      this.monitor = new this.Monitor(video, (signal) => {
        if (generation === this.generation) this.complete(signal);
        else app.log.debug('Ignored stale completion from an old monitor', { signal, oldGeneration: generation, generation: this.generation });
      }, { videoId: app.log.identity(id) });
      app.log.debug(sameIdentity ? 'Playback tracking rebound: count preserved for same identity' : 'Playback tracking started: count is 0', this.snapshot());
      for (const name of ['loadedmetadata', 'durationchange', 'playing']) video.addEventListener(name, this.durationChanged);
      if (this.checkAd() || this.checkDuration()) return;
      // An element replacement during the advance delay must not lose an already
      // completed playback, but a failed attempt stays exhausted for this identity.
      if (!this.exhausted && this.state.completedPlaybacks >= this.settings.repeatCount + 1) this.queueAdvance();
    }
    updateSettings(patch) {
      const wasWaiting = this.state.navigationInProgress;
      this.settings = app.settings.normalize({ ...this.settings, ...patch });
      app.log.debug('Controller: applying updated settings immediately', { settings: { ...this.settings }, completedPlaybacks: this.state.completedPlaybacks });
      // Rebind to invalidate callbacks/timers while retaining counts for this clip.
      this.detach(false);
      this.reconcile();
      if (wasWaiting && this.enabled() && !this.exhausted && this.state.activeVideo?.ended &&
          this.state.completedPlaybacks < this.settings.repeatCount + 1) this.replay();
    }
    complete(signal) {
      if (!this.enabled() || this.state.navigationInProgress || this.exhausted) {
        app.log.debug('Completion ignored', { signal, reason: this.suspensionReason() || (this.state.navigationInProgress ? 'navigation already in progress' : 'attempts exhausted; navigate manually'), ...this.snapshot() });
        return;
      }
      const v = this.state.activeVideo;
      // Recheck active identity at completion, never on each media timeupdate.
      const selected = this.adapter.findActiveVideo();
      if (!selected && this.retainThroughPlayerGap()) {
        // Keep the monitor's genuine completion signal, not a guessed wrap from
        // the new timestamp. Do not replay or navigate until selection recovers.
        if (this.pendingCompletions.length < 101) this.pendingCompletions.push(signal);
        app.log.debug('Completion buffered during player gap: waiting for same active video', { signal, ...this.snapshot() });
        return;
      }
      if (!v || selected !== v || this.adapter.getVideoIdentity(v) !== this.state.activeVideoId) {
        app.log.debug('Completion ignored: active video changed before it was processed', { signal });
        this.reconcile(); return;
      }
      if (this.retentionTimer !== null || this.pendingCompletions.length) {
        this.reconcile();
        if (this.state.navigationInProgress || this.exhausted) return;
      }
      if (this.checkAd()) return;
      this.state.completedPlaybacks++;
      this.state.lastCompletionTimestamp = Date.now();
      const requiredTotalPlaybacks = this.settings.repeatCount + 1;
      app.log.debug('Playback count incremented', { signal, ...this.snapshot() });
      if (this.state.completedPlaybacks >= requiredTotalPlaybacks) this.queueAdvance();
      else if (signal === 'ended' && v.ended) this.replay();
      else app.log.debug('Repeat required: allowing platform replay/loop to continue', this.snapshot());
      // A native wrap already started the next playback; leave it alone.
    }
    replay() {
      const v = this.state.activeVideo;
      if (!v?.ended) return;
      const videoId = app.log.identity(this.state.activeVideoId);
      app.log.debug('Repeat required: resetting ended video to 0 and calling play()', this.snapshot());
      this.monitor?.prepareReplay();
      try {
        v.currentTime = 0;
        Promise.resolve(v.play()).then(() => app.log.debug('Replay play() resolved', { videoId }))
          .catch(() => app.log.warn('Replay was blocked. Press play to continue.'));
      } catch { app.log.warn('Replay is unavailable. Press play to continue.'); }
    }
    exceedsDuration(video) {
      return this.durationBypassId !== this.state.activeVideoId && this.settings.durationLimitEnabled === true && Number.isFinite(video?.duration) &&
        video.duration > this.settings.durationLimitSeconds;
    }
    checkAd() {
      const video = this.state.activeVideo;
      if (!this.enabled() || this.exhausted || !video || this.adapter.findActiveVideo() !== video ||
          this.adapter.getVideoIdentity(video) !== this.state.activeVideoId) return false;
      const evidence = this.adapter.getAdEvidence?.(video);
      if (!evidence) return false;
      if (this.state.navigationInProgress && this.navigationReason !== 'ad') {
        app.log.debug('Ad detected during another countdown: restarting with the full saved delay');
        this.detach(false); this.reconcile(); return true;
      }
      if (!this.state.navigationInProgress) {
        app.log.debug('Advertisement detected: queuing skip', { platform: this.adapter.platform, evidence, videoId: app.log.identity(this.state.activeVideoId) });
        this.queueAdvance('ad');
      }
      return true;
    }
    hideCountdown() {
      this.countdownActive = false;
      this.overlay?.hide();
    }
    watchAgain(token) {
      const video = this.state.activeVideo;
      if (token !== this.generation || !this.countdownActive || !this.enabled() || this.navigationReason === 'ad' ||
          this.adapter.findActiveVideo() !== video || this.adapter.getVideoIdentity(video) !== this.state.activeVideoId) return false;
      // Start a fresh repeat cycle, including for native loops already underway.
      // A deliberate replay of a long clip bypasses its duration filter until
      // the identity changes; otherwise the button would immediately skip again.
      this.durationBypassId = this.state.activeVideoId;
      this.detach(false);
      this.state.completedPlaybacks = 0; this.state.lastCompletionTimestamp = 0; this.exhausted = false;
      this.reconcile();
      if (this.state.activeVideo !== video) return false;
      this.monitor?.prepareReplay();
      app.log.debug('Watch again: cancelled skip, reset playback count to 0 and restarted video', this.snapshot());
      try {
        video.currentTime = 0;
        Promise.resolve(video.play()).catch(() => app.log.warn('Watch again playback was blocked. Press play to continue.'));
      } catch { app.log.warn('Watch again playback is unavailable. Press play to continue.'); }
      return true;
    }
    checkDuration() {
      const video = this.state.activeVideo;
      if (!this.enabled() || this.exhausted || !this.exceedsDuration(video) ||
          this.adapter.findActiveVideo() !== video || this.adapter.getVideoIdentity(video) !== this.state.activeVideoId) return false;
      if (!this.state.navigationInProgress) {
        app.log.debug('Duration limit exceeded: skipping video', { durationLimitEnabled: this.settings.durationLimitEnabled, duration: video.duration, limitSeconds: this.settings.durationLimitSeconds, videoId: app.log.identity(this.state.activeVideoId) });
        this.queueAdvance('duration');
      }
      return true;
    }
    queueAdvance(reason = 'playbacks') {
      if (this.state.navigationInProgress || this.exhausted) return;
      this.state.navigationInProgress = true;
      this.navigationReason = reason;
      this.adContext = reason === 'ad' ? { url: globalThis.location?.href, source: this.state.activeVideo?.currentSrc || this.state.activeVideo?.getAttribute?.('src') || '' } : null;
      app.log.debug('Navigation queued: ' + (reason === 'ad' ? 'advertisement detected' : reason === 'duration' ? 'duration limit exceeded' : 'target playback count reached') + '; lock acquired', { delayMs: this.settings.advanceDelayMs, ...this.snapshot() });
      const token = this.generation;
      const video = this.state.activeVideo;
      const id = this.state.activeVideoId;
      const current = () => token === this.generation && this.enabled() && this.state.activeVideo === video;
      const finish = (reason = 'identity unchanged after both navigation attempts') => {
        if (token !== this.generation) return;
        this.hideCountdown();
        this.timer = null; this.state.navigationInProgress = false; this.exhausted = true;
        app.log.warn('Navigation stopped: lock released; navigate manually to continue', { reason, ...this.snapshot() });
      };
      const attempt = async (number) => {
        if (!current()) {
          if (token === this.generation && !this.enabled()) this.detach();
          app.log.debug('Navigation timer ignored: stale video, invalid extension context, or disabled setting', { token, generation: this.generation }); return;
        }
        // A popup can be correct while an old page controller missed the storage
        // event. Never execute a skip using only cached preferences.
        if (this.readCurrentSettings) {
          let saved;
          try { saved = app.settings.normalize(await this.readCurrentSettings()); }
          catch {
            if (token === this.generation) finish('current settings could not be verified; reload the page');
            return;
          }
          if (!current()) {
            if (token === this.generation && !this.enabled()) this.detach();
            return;
          }
          if (Object.keys(saved).some((key) => saved[key] !== this.settings[key])) {
            app.log.warn('Saved settings differ from page settings: cancelling stale skip and resynchronizing', {
              cachedDurationLimitEnabled: this.settings.durationLimitEnabled, savedDurationLimitEnabled: saved.durationLimitEnabled,
              cachedDelayMs: this.settings.advanceDelayMs, savedDelayMs: saved.advanceDelayMs, navigationReason: reason
            });
            this.updateSettings(saved); return;
          }
        }
        this.hideCountdown();
        this.reconcile();
        if (!current()) return;
        if (this.retentionTimer !== null) {
          if (this.exhausted) { finish('active player could not be confirmed after navigation'); return; }
          this.timer = null;
          this.state.navigationInProgress = false;
          app.log.debug('Navigation postponed until active video is reconfirmed', this.snapshot());
          return;
        }
        // Honor a manual pause during the delay, but allow genuine ended media.
        if (reason === 'playbacks' && video.paused && !video.ended) { finish('video manually paused during the advance delay'); return; }
        if (reason === 'ad' && !this.adapter.getAdEvidence?.(video)) { this.detach(false); this.reconcile(); return; }
        let acted = false;
        // Even if the site replaces this element mid-navigation, never restart
        // the attempt budget for the same identity.
        this.exhausted = true;
        app.log.debug('Navigation: requesting adapter action', { attempt: number + 1, videoId: app.log.identity(id) });
        try { acted = this.adapter.advanceToNext(video, number); }
        catch (error) { app.log.warn('Navigation: adapter threw an error', { error: error.name }); }
        if (!acted) { finish('adapter found no safe navigation strategy for this attempt'); return; }
        app.log.debug('Navigation action dispatched; waiting for a new identity', { attempt: number + 1, timeoutMs: this.navigationTimeoutMs });
        this.timer = this.setTimer(() => {
          if (!current()) return;
          this.reconcile();
          if (!current() || this.state.activeVideoId !== id) { app.log.debug('navigation verified'); return; }
          app.log.debug('Navigation verification timed out: identity has not changed', { attempt: number + 1, videoId: app.log.identity(id) });
          if (number === 0) { app.log.debug('Navigation: trying one fallback strategy'); attempt(1); } else finish();
        }, this.navigationTimeoutMs);
      };
      this.countdownActive = true;
      this.overlay?.show(video, { durationMs: this.settings.advanceDelayMs, reason, onWatchAgain: () => this.watchAgain(token) });
      this.timer = this.setTimer(() => attempt(0), this.settings.advanceDelayMs);
    }
    dispose() {
      app.log.debug('Controller disposing: removing observers, timers, and media listeners', this.snapshot());
      this.destroyed = true;
      this.detach(); this.adapter.dispose();
      this.doc.removeEventListener('visibilitychange', this.visibility);
      this.doc.removeEventListener('pointerdown', this.interaction, true);
      this.doc.removeEventListener('pointerup', this.interaction, true);
      this.doc.removeEventListener('keydown', this.interaction, true);
    }
  }
  app.Controller = Controller;
})();
