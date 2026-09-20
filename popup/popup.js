(() => {
  'use strict';
  const { settings, log } = globalThis.ShortAutoAdvance;
  const $ = (id) => document.getElementById(id);
  const status = $('status'), master = $('enabled'), opener = $('advanced-toggle');
  const controls = $('controls'), panel = $('advanced-panel'), themeButton = $('theme-toggle');
  const rangeKeys = ['repeatCount', 'advanceDelayMs', 'durationLimitSeconds'];
  let ready = false, supported = false, resetting = false, themeReady = false, stopped = false;
  let revision = 0, checkSequence = 0, fadeTimer, restoreTimer;
  let baseStatus = 'Ready to work', lastPageSignature = '', noticeActive = false;
  const revisions = {}, acknowledged = { ...settings.defaults, popupTheme: 'light' };
  const pendingWrites = new Set();
  let earlySettings = {};
  function text(text, tone = '') {
    clearTimeout(fadeTimer);
    status.classList.add('fading');
    const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120;
    fadeTimer = setTimeout(() => {
      status.textContent = text; status.title = text;
      status.className = tone;
    }, delay);
  }
  function notice(message, tone = 'success') {
    clearTimeout(restoreTimer);
    noticeActive = true; text(message, tone);
    restoreTimer = setTimeout(() => { noticeActive = false; text(baseStatus); }, 2600);
  }
  function updateControls() {
    master.disabled = !ready || !supported || resetting;
    opener.disabled = !ready || !supported || resetting;
    controls.disabled = !ready || !supported || resetting;
    themeButton.disabled = !themeReady;
    $('durationLimitSeconds').disabled = !ready || !supported || resetting || !$('durationLimitEnabled').checked;
    $('duration-range').classList.toggle('disabled', !$('durationLimitEnabled').checked);
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
    themeButton.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    themeButton.title = themeButton.getAttribute('aria-label');
  }
  function renderField(key, value) {
    if (key === 'popupTheme') { applyTheme(value); return; }
    const input = $(key);
    if (!input) return;
    if (input.matches('button')) input.setAttribute('aria-pressed', String(value));
    else if (input.type === 'checkbox') input.checked = value;
    else input.value = key === 'advanceDelayMs' ? value / 1000 : value;
    if (rangeKeys.includes(key)) {
      const label = key === 'advanceDelayMs' ? (value / 1000).toFixed(1) + 's' : String(value) + (key === 'durationLimitSeconds' ? 's' : '');
      $(key + '-value').textContent = label;
      input.style.setProperty('--progress', ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100) + '%');
      input.setAttribute('aria-valuetext', key === 'repeatCount' ? value + ' additional repeats' : label.replace('s', ' seconds'));
    }
  }
  function render(values) { Object.entries(values).forEach(([key, value]) => renderField(key, value)); updateControls(); }
  async function persist(values, reset = false) {
    const operation = ++revision, keys = Object.keys(values);
    keys.forEach((key) => { revisions[key] = operation; pendingWrites.add(key); });
    render(values);
    try {
      const result = await chrome.runtime.sendMessage(reset
        ? { type: 'auto-advance:reset-preferences' }
        : { type: 'auto-advance:save-preferences', values });
      if (!result?.ok) throw new Error('Save failed');
      Object.assign(acknowledged, result.values);
      if (stopped) return;
      for (const key of keys) if (revisions[key] === operation) renderField(key, result.values[key]);
      if (operation === revision) notice(reset ? 'Settings restored' : 'Saved');
      log.debug(reset ? 'Popup: settings restored to defaults' : 'Popup: autosave confirmed', result.values);
    } catch {
      if (stopped) return;
      for (const key of keys) if (revisions[key] === operation) renderField(key, acknowledged[key]);
      if (operation === revision) notice('Could not save. Try again.', 'error');
      log.warn('Popup: autosave failed; restored saved values');
    } finally {
      for (const key of keys) if (revisions[key] === operation) pendingWrites.delete(key);
      if (reset) resetting = false;
      if (!stopped) updateControls();
    }
  }
  function expand(open) {
    opener.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('open', open); panel.inert = !open;
    panel.setAttribute('aria-hidden', String(!open));
  }
  async function checkPage() {
    const sequence = ++checkSequence;
    let response, tabId;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
      if (Number.isInteger(tabId)) response = await chrome.runtime.sendMessage({ type: 'auto-advance:tab-status', tabId });
    } catch {}
    if (stopped || sequence !== checkSequence) return;
    supported = response?.supported === true;
    const signature = JSON.stringify([tabId, supported, response?.platform]);
    if (signature !== lastPageSignature) {
      lastPageSignature = signature;
      baseStatus = ready ? (supported ? 'Ready to work' : 'Open Shorts or Reels') : baseStatus;
      opener.title = supported ? 'Show or hide settings' : 'Open a YouTube Short or Instagram Reel to use these settings.';
      master.title = opener.title;
      if (!supported) expand(false);
      if (!noticeActive) text(baseStatus);
      log.debug('Popup: active-page status', { supported });
    }
    updateControls();
  }
  opener.addEventListener('click', () => expand(opener.getAttribute('aria-expanded') !== 'true'));
  for (const key of ['enabled', 'durationLimitEnabled']) {
    $(key).addEventListener('change', () => { if (ready && supported && !resetting) persist({ [key]: $(key).checked }); });
  }
  for (const key of ['youtubeEnabled', 'instagramEnabled']) {
    $(key).addEventListener('click', () => {
      if (ready && supported && !resetting) persist({ [key]: $(key).getAttribute('aria-pressed') !== 'true' });
    });
  }
  for (const key of rangeKeys) {
    $(key).addEventListener('input', () => {
      if (!ready || !supported || resetting) return;
      const value = key === 'advanceDelayMs' ? Math.round(Number($(key).value) * 1000) : Number($(key).value);
      persist({ [key]: value }); // Dispatch immediately; worker serializes rapid changes.
    });
  }
  $('settings-form').addEventListener('submit', (event) => event.preventDefault());
  $('reset').addEventListener('click', () => {
    if (!ready || !supported || resetting) return;
    resetting = true; updateControls(); persist({ ...settings.defaults }, true);
  });
  themeButton.addEventListener('click', () => persist({ popupTheme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }));
  chrome.storage.local.get('popupTheme').then(({ popupTheme }) => {
    acknowledged.popupTheme = popupTheme === 'dark' ? 'dark' : 'light';
    applyTheme(acknowledged.popupTheme);
  }).catch(() => notice('Could not load theme.', 'error')).finally(() => { themeReady = true; updateControls(); });
  const unsubscribeSettings = settings.subscribe((patch) => {
    Object.assign(acknowledged, patch);
    if (!ready) { Object.assign(earlySettings, patch); return; }
    for (const [key, value] of Object.entries(patch)) if (!pendingWrites.has(key)) renderField(key, value);
    updateControls();
  });
  settings.read().then((values) => {
    const latest = { ...values, ...earlySettings }; earlySettings = {};
    Object.assign(acknowledged, latest); ready = true; render(latest);
    baseStatus = supported ? 'Ready to work' : 'Open Shorts or Reels';
    if (!noticeActive) text(baseStatus);
  }).catch(() => { baseStatus = 'Could not load settings.'; text(baseStatus, 'error'); });
  checkPage();
  const tabChanged = () => { checkPage(); };
  const tabUpdated = (_tabId, info) => { if (info.status || info.url || Object.hasOwn(info, 'discarded')) checkPage(); };
  chrome.tabs.onActivated.addListener(tabChanged);
  chrome.tabs.onUpdated.addListener(tabUpdated);
  chrome.windows.onFocusChanged.addListener(tabChanged);
  window.addEventListener('focus', tabChanged);
  document.addEventListener('visibilitychange', tabChanged);
  const pageTimer = setInterval(checkPage, 1000);
  window.addEventListener('pagehide', () => {
    stopped = true; checkSequence++;
    clearInterval(pageTimer); clearTimeout(fadeTimer); clearTimeout(restoreTimer);
    unsubscribeSettings();
    chrome.tabs.onActivated.removeListener(tabChanged);
    chrome.tabs.onUpdated.removeListener(tabUpdated);
    chrome.windows.onFocusChanged.removeListener(tabChanged);
    window.removeEventListener('focus', tabChanged);
    document.removeEventListener('visibilitychange', tabChanged);
  }, { once: true });
  log.debug('Popup: Auto Advance 0.1.0 loaded', { extensionId: chrome.runtime.id });
})();
