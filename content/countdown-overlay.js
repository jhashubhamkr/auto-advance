(() => {
  'use strict';
  const app = globalThis.ShortAutoAdvance;
  class CountdownOverlay {
    constructor(doc = document) { this.doc = doc; this.view = doc.defaultView; }
    containsEvent(event) { return Boolean(this.host && event.composedPath?.().includes(this.host)); }
    show(video, { durationMs, reason, onWatchAgain }) {
      this.hide();
      const host = this.doc.createElement('div');
      this.host = host;
      host.setAttribute('data-auto-advance-overlay', '');
      host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;display:block!important;';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
        :host{color-scheme:dark}*{box-sizing:border-box}
        .countdown{position:absolute;width:176px;transform:translate(-50%,-48px);text-align:center;color:#71d3ff;font:600 15px/1.4 system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 4px #000}
        .countdown::before{content:"";position:absolute;inset:-18px -6px;z-index:-1;border-radius:26px;background:rgba(5,14,24,.82);border:1px solid #ffffff24;box-shadow:0 8px 28px #0006;backdrop-filter:blur(8px)}
        .ring{display:block;width:96px;height:96px;margin:0 auto;overflow:visible;filter:drop-shadow(0 1px 3px #0008)}
        .progress{stroke:#00b0ff;stroke-width:3;fill:none;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;transform:rotate(-90deg);transform-origin:48px 48px}
        button,.caption{margin:12px auto 0;padding:8px 18px;border:1px solid #00b0ff;border-radius:999px;color:#e1f5ff;background:#07172438;font:600 15px/1.4 system-ui,sans-serif;text-shadow:0 1px 3px #000;white-space:nowrap}
        button{pointer-events:auto;cursor:pointer;transition:background .15s,border-color .15s;touch-action:manipulation}
        button:hover{background:#005f8966;border-color:#9ee1ff}
        button:focus-visible{outline:2px solid #b6e9ff;outline-offset:4px;background:#005f8966}
        .caption{display:table;border-color:transparent;background:#07172430}
        .reason{margin:8px 0 0;color:#e1f5ff;font:500 13px/1.4 system-ui,sans-serif}
        @media(prefers-reduced-motion:reduce){button{transition:none}}
      </style><div class="countdown" role="group" aria-label="${reason === 'ad' ? 'Skipping ad' : 'Next video soon'}">
        <svg class="ring" viewBox="0 0 96 96" aria-hidden="true"><circle class="progress" cx="48" cy="48" r="45" pathLength="1"/><g class="next" transform="translate(18 18) scale(.6)"><circle cx="50" cy="50" r="46" fill="#00b0ff"/><path d="M40 29 61 50 40 71" fill="none" stroke="#092b40" stroke-width="12" stroke-linejoin="miter"/></g></svg>
        ${reason === 'ad' ? '<p class="caption" role="status">Skipping Ad</p>' : (reason === 'duration' ? '<p class="reason" role="status">Duration limit reached</p>' : '') + '<button type="button">Watch again</button>'}
      </div>`;
      const button = shadow.querySelector('button');
      // Do not send these pointer/keyboard actions to the website's player.
      for (const type of ['pointerdown', 'pointerup', 'keydown', 'keyup', 'dblclick']) host.addEventListener(type, (event) => event.stopPropagation());
      button?.addEventListener('click', (event) => { event.stopPropagation(); onWatchAgain(); });
      const full = this.doc.fullscreenElement;
      (full && full !== video && full.contains(video) ? full : this.doc.body).append(host);
      const panel = shadow.querySelector('.countdown');
      const position = () => {
        if (this.host !== host) return;
        const rect = video.getBoundingClientRect();
        const visible = video.isConnected && !this.doc.hidden && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < this.view.innerHeight;
        panel.style.display = visible ? '' : 'none';
        panel.style.left = (rect.left + rect.width / 2) + 'px';
        panel.style.top = (rect.top + rect.height / 2) + 'px';
        this.frame = this.view.requestAnimationFrame(position);
      };
      position();
      const circle = shadow.querySelector('.progress');
      if (this.view.matchMedia('(prefers-reduced-motion: reduce)').matches) circle.style.strokeDashoffset = '0';
      else this.animation = circle.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: durationMs, easing: 'ease-in-out', fill: 'forwards' });
    }
    hide() {
      this.animation?.cancel(); this.animation = null;
      if (this.frame != null) this.view.cancelAnimationFrame(this.frame);
      this.frame = null;
      this.host?.remove(); this.host = null;
    }
  }
  app.CountdownOverlay = CountdownOverlay;
})();
