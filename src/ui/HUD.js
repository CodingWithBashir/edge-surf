/**
 * In-game heads-up display.
 *
 * The HUD is plain DOM (fast to style, crisp text, accessible) and updates are
 * cached so the game loop only touches the DOM when a value actually changed —
 * no per-frame writes.
 */

import { formatNumber, formatDistance, formatTime } from '../core/MathUtils.js';

const RING_RADIUS = 11;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const HEART_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <path d="M12 21s-7.5-4.6-9.6-9A5.4 5.4 0 0 1 12 5.6 5.4 5.4 0 0 1 21.6 12c-2.1 4.4-9.6 9-9.6 9z"
        fill="#ff6b6b" stroke="#ffd9d9" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`;

export class HUD {
  /** @param {{onPause?:()=>void}} [options] */
  constructor(options = {}) {
    this.root = document.getElementById('hud');
    this.el = {
      score: document.getElementById('hud-score'),
      best: document.getElementById('hud-best'),
      multiplier: document.getElementById('hud-multiplier'),
      coins: document.getElementById('hud-coins'),
      coinsChip: document.getElementById('hud-coins-chip'),
      distance: document.getElementById('hud-distance'),
      speedFill: document.getElementById('hud-speed-fill'),
      pause: document.getElementById('btn-hud-pause'),
      lives: document.getElementById('hud-lives'),
      powerups: document.getElementById('hud-powerups'),
      toasts: document.getElementById('hud-toasts'),
      banner: document.getElementById('hud-banner'),
      fps: document.getElementById('hud-fps'),
      objective: document.getElementById('hud-objective'),
      objectiveFill: document.getElementById('hud-objective-fill'),
      objectiveText: document.getElementById('hud-objective-text'),
      modeName: document.getElementById('hud-mode-name'),
      flash: document.getElementById('fx-flash'),
      vignette: document.getElementById('fx-vignette'),
      countdown: document.getElementById('countdown'),
      countdownText: document.getElementById('countdown-text'),
    };

    this.onPause = options.onPause ?? (() => {});
    this.el.pause?.addEventListener('click', () => this.onPause());

    /** @type {Map<string, HTMLElement>} */
    this._powerUpNodes = new Map();
    this._cache = {};
    this._bannerTimer = null;
    this._lives = 0;
    this._toasts = [];
  }

  show() {
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('is-visible'));
  }

  hide() {
    this.root.classList.remove('is-visible');
    this.root.hidden = true;
  }

  reset() {
    this._cache = {};
    this._clearPowerUps();
    this.el.toasts.innerHTML = '';
    this.el.lives.innerHTML = '';
    this.el.banner.classList.remove('is-visible', 'is-danger');
    this.setVignette(0);
    this.setFlash(0);
    this._lives = 0;
  }

  /* ------------------------------ numbers ------------------------------ */

  _set(key, element, value) {
    if (!element || this._cache[key] === value) return;
    this._cache[key] = value;
    element.textContent = value;
  }

  setScore(value) {
    this._set('score', this.el.score, formatNumber(value));
  }

  setBest(value) {
    this._set('best', this.el.best, formatNumber(value));
  }

  setCoins(value) {
    this._set('coins', this.el.coins, formatNumber(value));
    if (this.el.coinsChip) {
      this.el.coinsChip.classList.remove('is-bumping');
      // Force reflow so the animation can restart on consecutive pickups.
      void this.el.coinsChip.offsetWidth;
      this.el.coinsChip.classList.add('is-bumping');
    }
  }

  setDistance(metres) {
    this._set('distance', this.el.distance, formatDistance(metres));
  }

  setSpeed(normalised, label) {
    const percent = Math.round(Math.max(0, Math.min(1, normalised)) * 100);
    if (this._cache.speed !== percent && this.el.speedFill) {
      this._cache.speed = percent;
      this.el.speedFill.style.width = `${percent}%`;
    }
    if (label != null) this._set('speedLabel', this.el.objectiveText, label);
  }

  setMultiplier(value) {
    const rounded = Math.round(value * 10) / 10;
    if (this._cache.multiplier === rounded) return;
    this._cache.multiplier = rounded;
    const el = this.el.multiplier;
    if (!el) return;
    if (rounded <= 1) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = `×${rounded % 1 === 0 ? rounded : rounded.toFixed(1)}`;
    // Restart the pop animation.
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  setMode(name, objectiveLabel) {
    this._set('modeName', this.el.modeName, name);
    if (objectiveLabel != null) this._set('objectiveText', this.el.objectiveText, objectiveLabel);
  }

  /** @param {number} progress 0..1 */
  setObjective(text, progress, urgent = false) {
    if (this._cache.objectiveText !== text) {
      this._cache.objectiveText = text;
      if (this.el.objectiveText && this._cache.speedLabel == null) this.el.objectiveText.textContent = text;
    }
    const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    if (this._cache.objective !== percent && this.el.objectiveFill) {
      this._cache.objective = percent;
      this.el.objectiveFill.style.width = `${percent}%`;
    }
    if (this._cache.urgent !== urgent) {
      this._cache.urgent = urgent;
      this.el.objective?.classList.toggle('is-urgent', urgent);
    }
  }

  /* -------------------------------- lives -------------------------------- */

  setLives(current, max) {
    if (this._cache.livesMax !== max) {
      this._cache.livesMax = max;
      this.el.lives.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const pip = document.createElement('span');
        pip.className = 'life-pip';
        pip.innerHTML = HEART_SVG;
        this.el.lives.appendChild(pip);
      }
      this._cache.lives = -1;
    }
    if (this._cache.lives === current) return;
    this._cache.lives = current;
    const pips = this.el.lives.children;
    for (let i = 0; i < pips.length; i++) {
      pips[i].classList.toggle('is-lost', i >= current);
    }
  }

  /* ------------------------------- power-ups ----------------------------- */

  _clearPowerUps() {
    for (const node of this._powerUpNodes.values()) node.remove();
    this._powerUpNodes.clear();
  }

  /**
   * @param {Array<{id:string, def:any, remaining:number, duration:number, fraction:number}>} list
   */
  setPowerUps(list) {
    const seen = new Set();

    for (const entry of list) {
      seen.add(entry.id);
      let node = this._powerUpNodes.get(entry.id);
      if (!node) {
        node = document.createElement('div');
        node.className = 'pu-chip';
        node.style.setProperty('--pu-color', `#${entry.def.color.toString(16).padStart(6, '0')}`);
        node.innerHTML = `
          <span class="pu-ring">
            <svg viewBox="0 0 26 26">
              <circle class="track" cx="13" cy="13" r="${RING_RADIUS}"></circle>
              <circle class="prog" cx="13" cy="13" r="${RING_RADIUS}"
                stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="0"></circle>
            </svg>
          </span>
          <span class="pu-meta">
            <span class="pu-name">${entry.def.label}</span>
            <span class="pu-time">0.0s</span>
          </span>`;
        this.el.powerups.appendChild(node);
        this._powerUpNodes.set(entry.id, node);
        node._timeNode = node.querySelector('.pu-time');
        node._progNode = node.querySelector('.prog');
      }

      if (node._timeNode) node._timeNode.textContent = `${Math.max(0, entry.remaining).toFixed(1)}s`;
      if (node._progNode) {
        node._progNode.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - entry.fraction)).toFixed(2);
      }
      node.classList.toggle('is-expiring', entry.remaining <= 2.5);
    }

    for (const [id, node] of Array.from(this._powerUpNodes.entries())) {
      if (!seen.has(id)) {
        node.remove();
        this._powerUpNodes.delete(id);
      }
    }
  }

  /* -------------------------------- toasts -------------------------------- */

  /** @param {string} text @param {number} [color] */
  toast(text, color = 0x2ee6c5, duration = 2200) {
    const node = document.createElement('div');
    node.className = 'toast';
    node.style.setProperty('--toast-color', `#${color.toString(16).padStart(6, '0')}`);
    node.innerHTML = text;
    this.el.toasts.appendChild(node);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstElementChild.remove();
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 300);
    }, duration);
  }

  /** @param {string} text @param {string} [sub] @param {{danger?:boolean}} [options] */
  banner(text, sub = '', options = {}) {
    const el = this.el.banner;
    el.innerHTML = `<span class="banner-text">${text}</span>${sub ? `<span class="banner-sub">${sub}</span>` : ''}`;
    el.classList.remove('is-visible');
    el.classList.toggle('is-danger', !!options.danger);
    void el.offsetWidth;
    el.classList.add('is-visible');
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
  }

  /* ------------------------------- countdown ------------------------------ */

  showCountdown(text, isFinal = false) {
    this.el.countdown.hidden = false;
    this.el.countdownText.textContent = text;
    this.el.countdownText.classList.remove('is-tick');
    void this.el.countdownText.offsetWidth;
    this.el.countdownText.classList.add('is-tick');
    if (isFinal) this.el.countdownText.style.color = '#2ee6c5';
    else this.el.countdownText.style.color = '#ffffff';
  }

  hideCountdown() {
    this.el.countdown.hidden = true;
  }

  /* --------------------------------- fx ----------------------------------- */

  /** @param {number} strength 0..1 */
  setFlash(strength, color = '#ffffff') {
    const el = this.el.flash;
    el.style.background = color;
    el.style.opacity = String(Math.max(0, Math.min(1, strength)));
  }

  setVignette(strength) {
    this.el.vignette.style.opacity = String(Math.max(0, Math.min(1, strength)));
  }

  setFps(value) {
    if (!this.el.fps) return;
    this.el.fps.textContent = `${Math.round(value)} FPS`;
  }

  setFpsVisible(visible) {
    if (this.el.fps) this.el.fps.hidden = !visible;
  }

  /** Human readable helper used by the Game for time-based modes. */
  static formatTime(seconds) {
    return formatTime(seconds);
  }
}
