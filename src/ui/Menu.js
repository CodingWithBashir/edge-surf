/**
 * Menu, panel and modal screen management.
 *
 * One screen is mounted at a time; navigation is a stack so "back" always
 * returns to where the player came from. All dynamic content (modes, cosmetics,
 * achievements, records, results) is rendered from live save data, so opening a
 * screen always reflects the current progression.
 */

import { MODE_LIST, MODES, describeModifiers, buildRunConfig } from '../game/config/Modes.js';
import { CHARACTERS, BOARDS, HAZARD_LIST, POWERUP_LIST, HAZARD_BEHAVIOUR } from '../game/config/Content.js';
import { dailyLabel } from '../core/Rng.js';
import { formatNumber, formatDistance, formatTime } from '../core/MathUtils.js';

const SCREEN_IDS = {
  loading: 'screen-loading',
  menu: 'screen-menu',
  modes: 'screen-modes',
  characters: 'screen-characters',
  shop: 'screen-shop',
  achievements: 'screen-achievements',
  leaderboard: 'screen-leaderboard',
  settings: 'screen-settings',
  howto: 'screen-howto',
  pause: 'screen-pause',
  gameover: 'screen-gameover',
  results: 'screen-results',
  error: 'screen-error',
};

const hex = (value) => `#${(value >>> 0).toString(16).padStart(6, '0')}`;

const HAZARD_ICONS = {
  [HAZARD_BEHAVIOUR.DODGE]: '&#9679;',
  [HAZARD_BEHAVIOUR.JUMP]: '&#9650;',
  [HAZARD_BEHAVIOUR.DUCK]: '&#9660;',
};

const HAZARD_BEHAVIOUR_LABEL = {
  [HAZARD_BEHAVIOUR.DODGE]: 'Steer around it',
  [HAZARD_BEHAVIOUR.JUMP]: 'Jump over it',
  [HAZARD_BEHAVIOUR.DUCK]: 'Duck under it',
};

export class Menu {
  /**
   * @param {{save:any, audio:any, handlers:any}} options
   */
  constructor(options) {
    this.save = options.save;
    this.audio = options.audio;
    this.handlers = options.handlers ?? {};

    /** @type {HTMLElement|null} */
    this.current = null;
    /** @type {string[]} */
    this.stack = [];
    this.screens = {};
    for (const [key, id] of Object.entries(SCREEN_IDS)) {
      this.screens[key] = document.getElementById(id);
    }

    this.leaderboardMode = this.save?.data?.lastPlayedMode ?? 'endless';

    /**
     * Screens whose content is generated from live save data. `show()` runs the
     * matching renderer, so a screen can never be mounted empty — no caller has
     * to remember to populate it first.
     */
    this._renderers = {
      menu: () => this.refreshMenuStats(),
      modes: () => this.renderModes(),
      characters: () => this.renderCharacters(),
      shop: () => this.renderShop(),
      achievements: () => this.renderAchievements(),
      leaderboard: () => this.renderLeaderboard(),
    };

    this._bindGlobalEvents();
    this._bindSettings();
    this.renderHowTo();
  }

  /* ------------------------------------------------------------------ *
   * Settings binding
   * ------------------------------------------------------------------ */

  /**
   * Wire every `[data-setting]` control to the save manager. Two controls can
   * share a key (the settings screen and the pause menu both expose volume), so
   * both are updated whenever the value changes.
   */
  _bindSettings() {
    this._settingInputs = Array.from(document.querySelectorAll('[data-setting]'));

    for (const input of this._settingInputs) {
      const key = input.dataset.setting;
      const handler = () => {
        const value =
          input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) / 100 : input.value;
        this.handlers.onSetting?.(key, value);
        this._syncSettingUi(key, value);
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    }

    document.getElementById('btn-reset-progress')?.addEventListener('click', () => {
      if (!globalThis.confirm('Erase all Surf Rush progress on this device? This cannot be undone.')) return;
      this.handlers.onResetProgress?.();
    });

    document.getElementById('btn-error-reload')?.addEventListener('click', () => globalThis.location.reload());
  }

  /** Push a full settings object into the DOM controls. */
  applySettings(settings = {}) {
    for (const input of this._settingInputs ?? []) {
      const key = input.dataset.setting;
      if (!(key in settings)) continue;
      const value = settings[key];
      if (input.type === 'checkbox') input.checked = !!value;
      else if (input.type === 'range') input.value = String(Math.round(Number(value) * 100));
      else input.value = String(value);
      this._syncSettingUi(key, value);
    }
  }

  _syncSettingUi(key, value) {
    for (const input of this._settingInputs ?? []) {
      if (input.dataset.setting !== key) continue;
      if (input.type === 'checkbox') {
        input.checked = !!value;
      } else if (input.type === 'range') {
        const percent = Math.round(Number(value) * 100);
        if (input.value !== String(percent)) input.value = String(percent);
        // Firefox/WebKit need the CSS variable to paint the filled track.
        input.style.setProperty('--fill', `${percent}%`);
        const output = document.getElementById(`out-${key}`);
        if (output) output.textContent = `${percent}%`;
      } else if (input.value !== String(value)) {
        input.value = String(value);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Navigation
   * ------------------------------------------------------------------ */

  _bindGlobalEvents() {
    const app = document.getElementById('app');
    app.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      this.audio?.uiClick?.();
      this._handleAction(action, button, event);
    });

    // Hover / focus feedback on every control.
    app.addEventListener('pointerenter', (event) => {
      if (event.target.closest?.('.btn, .mode-card, .pick-card, .tab, .icon-btn')) this.audio?.uiHover?.();
    }, true);
  }

  _handleAction(action, button, event) {
    switch (action) {
      case 'play':
        this.show('modes');
        break;
      case 'characters':
        this.show('characters');
        break;
      case 'shop':
        this.show('shop');
        break;
      case 'achievements':
        this.show('achievements');
        break;
      case 'leaderboard':
        this.show('leaderboard');
        break;
      case 'settings':
        this.show('settings');
        break;
      case 'howto':
        this.show('howto');
        break;
      case 'back':
        this.back();
        break;
      case 'resume':
        this.handlers.onResume?.();
        break;
      case 'restart':
        this.handlers.onRestart?.();
        break;
      case 'quit':
        this.handlers.onQuit?.();
        break;
      case 'retry':
        this.handlers.onRestart?.();
        break;
      case 'results':
        this.handlers.onShowResults?.();
        break;
      default:
        if (action.startsWith('mode:')) {
          this.handlers.onStartMode?.(action.slice(5));
        } else if (action.startsWith('char:')) {
          this.handlers.onSelectCharacter?.(action.slice(5));
        } else if (action.startsWith('board:')) {
          this.handlers.onSelectBoard?.(action.slice(6));
        } else if (action.startsWith('buy:')) {
          this.handlers.onPurchase?.(action.slice(4));
        } else if (action.startsWith('lb:')) {
          this.leaderboardMode = action.slice(3);
          this.renderLeaderboard();
        }
        break;
    }
  }

  /** @param {string} key screen key from SCREEN_IDS */
  show(key, { remember = true } = {}) {
    const element = this.screens[key];
    if (!element) return;
    if (this.current === element) return;

    if (this.current) {
      this.current.classList.remove('is-active');
      if (remember && this.current !== this.screens.pause) this.stack.push(this._keyOf(this.current));
      // Let the fade-out finish before unmounting.
      const old = this.current;
      setTimeout(() => {
        if (old !== this.current) old.classList.remove('is-mounted');
      }, 220);
    }

    // Populate from the current save before it becomes visible.
    this._renderers[key]?.();

    element.classList.add('is-mounted');
    requestAnimationFrame(() => element.classList.add('is-active'));
    this.current = element;
    this.currentKey = key;
  }

  _keyOf(element) {
    for (const [key, value] of Object.entries(this.screens)) {
      if (value === element) return key;
    }
    return 'menu';
  }

  back() {
    const previous = this.stack.pop() ?? 'menu';
    this.show(previous, { remember: false });
    this.audio?.uiBack?.();
    if (previous === 'menu') this.refreshMenuStats();
  }

  hideAll() {
    for (const element of Object.values(this.screens)) {
      element.classList.remove('is-active', 'is-mounted');
    }
    this.current = null;
    this.currentKey = null;
    this.stack.length = 0;
  }

  isOpen(key) {
    return this.currentKey === key;
  }

  /* ------------------------------------------------------------------ *
   * Main menu stats
   * ------------------------------------------------------------------ */

  refreshMenuStats() {
    const stats = this.save?.stats ?? {};
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set('menu-best', formatNumber(stats.bestScore ?? 0));
    set('menu-coins', formatNumber(this.save?.coins ?? 0));
    set('menu-runs', formatNumber(stats.runs ?? 0));
  }

  /* ------------------------------------------------------------------ *
   * Mode select
   * ------------------------------------------------------------------ */

  renderModes() {
    const container = document.getElementById('mode-list');
    if (!container) return;
    const today = new Date();
    container.innerHTML = '';

    for (const mode of MODE_LIST) {
      const best = this.save?.bestScore(mode.id) ?? 0;
      const bestDistance = this.save?.bestDistance(mode.id) ?? 0;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mode-card';
      card.dataset.action = `mode:${mode.id}`;

      let extra = '';
      if (mode.id === 'daily') {
        const config = buildRunConfig('daily', { date: today });
        const modifiers = describeModifiers(config.modifiers);
        extra = `
          <div class="mode-meta"><span>${dailyLabel(today)}</span></div>
          <div class="mode-meta">
            ${modifiers.map((m) => `<span><b>${m.name}</b> — ${m.description}</span>`).join('')}
          </div>`;
      }

      card.innerHTML = `
        ${mode.tag ? `<span class="mode-badge">${mode.tag}</span>` : ''}
        <h3>${mode.name}</h3>
        <p>${mode.description}</p>
        <div class="mode-meta">
          <span>Best <b>${formatNumber(best)}</b></span>
          <span>Furthest <b>${formatDistance(bestDistance)}</b></span>
          ${mode.lives ? `<span>Lives <b>${mode.lives}</b></span>` : '<span>No lives</span>'}
        </div>
        ${extra}`;
      container.appendChild(card);
    }
  }

  /* ------------------------------------------------------------------ *
   * Cosmetics
   * ------------------------------------------------------------------ */

  renderCharacters() {
    const container = document.getElementById('character-list');
    if (!container) return;
    container.innerHTML = '';

    for (const character of CHARACTERS) {
      const owned = this.save.owns('character', character.id);
      const selected = this.save.selectedCharacter === character.id;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `pick-card${selected ? ' is-selected' : ''}${owned ? '' : ' is-locked'}`;
      card.dataset.action = owned ? `char:${character.id}` : `buy:character:${character.id}`;

      const swatch = `
        <span class="swatch-a" style="background:linear-gradient(160deg, ${hex(character.wetsuit)}, ${hex(character.wetsuitAlt)})"></span>
        <span class="swatch-b" style="background:linear-gradient(160deg, ${hex(character.board)}, ${hex(character.boardAlt)})"></span>
        <span class="swatch-c" style="background:${hex(character.hair)}"></span>`;

      card.innerHTML = `
        <span class="pick-swatch">${swatch}</span>
        <h4>${character.name}</h4>
        <p>${character.description}</p>
        <span class="pick-foot">
          ${
            selected
              ? '<span class="tag tag--equipped">Equipped</span>'
              : owned
                ? '<span class="tag tag--owned">Owned</span>'
                : character.unlock
                  ? `<span class="tag tag--locked">${character.unlock.label}</span>`
                  : `<span class="price"><span class="coin-dot"></span>${character.cost}</span>`
          }
        </span>`;
      container.appendChild(card);
    }
  }

  renderShop() {
    const container = document.getElementById('board-list');
    if (!container) return;
    const coins = document.getElementById('shop-coins');
    if (coins) coins.textContent = formatNumber(this.save.coins);
    container.innerHTML = '';

    for (const board of BOARDS) {
      const owned = this.save.owns('board', board.id);
      const selected = this.save.selectedBoard === board.id;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `pick-card${selected ? ' is-selected' : ''}${owned ? '' : ' is-locked'}`;
      card.dataset.action = owned ? `board:${board.id}` : `buy:board:${board.id}`;

      card.innerHTML = `
        <span class="pick-swatch">
          <span class="swatch-a" style="background:${hex(board.body)}"></span>
          <span class="swatch-b" style="background:${hex(board.stripe)}"></span>
          <span class="swatch-c" style="background:${hex(board.rail)}"></span>
        </span>
        <h4>${board.name}</h4>
        <p>${board.description}</p>
        <span class="pick-foot">
          ${
            selected
              ? '<span class="tag tag--equipped">Equipped</span>'
              : owned
                ? '<span class="tag tag--owned">Owned</span>'
                : board.unlock
                  ? `<span class="tag tag--locked">${board.unlock.label}</span>`
                  : `<span class="price"><span class="coin-dot"></span>${board.cost}</span>`
          }
        </span>`;
      container.appendChild(card);
    }
  }

  /* ------------------------------------------------------------------ *
   * Achievements
   * ------------------------------------------------------------------ */

  renderAchievements() {
    const container = document.getElementById('achievement-list');
    if (!container) return;
    const summary = this.save.achievementSummary();
    const unlocked = summary.filter((a) => a.unlocked).length;
    const progress = document.getElementById('ach-progress');
    if (progress) progress.textContent = `${unlocked} / ${summary.length}`;

    container.innerHTML = '';
    for (const entry of summary) {
      const row = document.createElement('div');
      row.className = `ach-row${entry.unlocked ? ' is-unlocked' : ''}`;
      row.innerHTML = `
        <span class="ach-medal">${entry.unlocked ? '&#9733;' : '&#9675;'}</span>
        <div>
          <h4>${entry.def.name}</h4>
          <p>${entry.def.description}</p>
          <div class="ach-bar"><i style="width:${Math.round(entry.fraction * 100)}%"></i></div>
        </div>
        <span class="ach-progress">
          <b>${formatNumber(Math.min(entry.value, entry.target))}</b> / ${formatNumber(entry.target)}
          <br /><span>+${entry.def.reward} coins</span>
        </span>`;
      container.appendChild(row);
    }
  }

  /* ------------------------------------------------------------------ *
   * Local records
   * ------------------------------------------------------------------ */

  renderLeaderboard() {
    const tabs = document.getElementById('lb-tabs');
    const body = document.getElementById('leaderboard-body');
    if (!tabs || !body) return;

    tabs.innerHTML = '';
    for (const mode of MODE_LIST) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `tab${mode.id === this.leaderboardMode ? ' is-active' : ''}`;
      tab.dataset.action = `lb:${mode.id}`;
      tab.textContent = mode.name;
      tabs.appendChild(tab);
    }

    const records = this.save.getRecords(this.leaderboardMode);
    if (!records.length) {
      body.innerHTML = `<div class="empty-state">
        No runs recorded for <b>${MODES[this.leaderboardMode]?.name ?? this.leaderboardMode}</b> yet.<br />
        Surf a run and your top ten will appear here.
      </div>`;
      return;
    }

    const rows = records
      .map(
        (record, index) => `
        <tr>
          <td>${index + 1}</td>
          <td class="num">${formatNumber(record.score)}</td>
          <td class="num">${formatDistance(record.distance)}</td>
          <td class="num">${record.coins}</td>
          <td>${new Date(record.date).toLocaleDateString()}</td>
        </tr>`
      )
      .join('');

    body.innerHTML = `
      <table class="lb">
        <thead>
          <tr><th>#</th><th>Score</th><th>Distance</th><th>Coins</th><th>Date</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* ------------------------------------------------------------------ *
   * How to play
   * ------------------------------------------------------------------ */

  renderHowTo() {
    const hazards = document.getElementById('hazard-legend');
    if (hazards) {
      hazards.innerHTML = HAZARD_LIST.filter((h) => !h.formationOnly)
        .map(
          (hazard) => `
          <div class="legend-item">
            <span class="legend-glyph" style="background:${hex(hazard.color)}">${HAZARD_ICONS[hazard.behaviour] ?? '&#9679;'}</span>
            <div><b>${hazard.label}</b><span>${hazard.legend} <em>(${HAZARD_BEHAVIOUR_LABEL[hazard.behaviour]})</em></span></div>
          </div>`
        )
        .join('');
    }

    const powerups = document.getElementById('powerup-legend');
    if (powerups) {
      powerups.innerHTML = POWERUP_LIST.map(
        (powerup) => `
        <div class="legend-item">
          <span class="legend-glyph" style="background:${hex(powerup.color)}">&#9733;</span>
          <div><b>${powerup.label}</b><span>${powerup.legend}</span></div>
        </div>`
      ).join('');
    }
  }

  /* ------------------------------------------------------------------ *
   * Pause / game over / results
   * ------------------------------------------------------------------ */

  updatePause({ score, distance, coins }) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set('pause-score', formatNumber(score));
    set('pause-distance', formatDistance(distance));
    set('pause-coins', formatNumber(coins));
  }

  /**
   * @param {{score:number, best:number, isRecord:boolean, distance:number, coins:number,
   *          topSpeed:number, obstacles:number, flavour?:string, title?:string, unlocks?:string[]}} data
   */
  showGameOver(data) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set('gameover-score', formatNumber(data.score));
    set('gameover-best', `Best ${formatNumber(data.best)}`);
    set('go-distance', formatDistance(data.distance));
    set('go-coins', formatNumber(data.coins));
    set('go-speed', `${Math.round(data.topSpeed)} km/h`);
    set('go-obstacles', formatNumber(data.obstacles));
    set('gameover-flavour', data.flavour ?? 'Wipeout!');
    set('gameover-title', data.title ?? 'Run Over');

    const record = document.getElementById('gameover-newrecord');
    if (record) record.hidden = !data.isRecord;

    const unlocks = document.getElementById('gameover-unlocks');
    if (unlocks) {
      if (data.unlocks?.length) {
        unlocks.hidden = false;
        unlocks.innerHTML = data.unlocks.join('<br />');
      } else {
        unlocks.hidden = true;
        unlocks.innerHTML = '';
      }
    }

    this.show('gameover', { remember: false });
  }

  /** @param {any} snapshot @param {{modeName:string, reason:string, records:any[]}} meta */
  showResults(snapshot, meta) {
    const container = document.getElementById('results-body');
    if (!container) return;

    const block = (title, rows) => `
      <div class="result-block">
        <h3>${title}</h3>
        <div class="result-table">
          ${rows.map(([label, value]) => `<div class="result-cell"><span>${label}</span><b>${value}</b></div>`).join('')}
        </div>
      </div>`;

    container.innerHTML = `
      ${block('Summary', [
        ['Mode', meta.modeName],
        ['Ended', meta.reason],
        ['Score', formatNumber(snapshot.score)],
        ['Distance', formatDistance(snapshot.distance)],
        ['Time on water', formatTime(snapshot.time)],
      ])}
      ${block('Score breakdown', [
        ['Distance', formatNumber(snapshot.breakdown.distance)],
        ['Collectibles', formatNumber(snapshot.breakdown.pickups)],
        ['Style bonuses', formatNumber(snapshot.breakdown.bonus)],
        ['Events', formatNumber(snapshot.breakdown.events)],
      ])}
      ${block('Collecting', [
        ['Coins', formatNumber(snapshot.coins)],
        ['Shells', formatNumber(snapshot.shells)],
        ['Pearls', formatNumber(snapshot.pearls)],
        ['Banked', `${formatNumber(snapshot.walletCoins)} coins`],
      ])}
      ${block('Riding', [
        ['Jumps', formatNumber(snapshot.jumps)],
        ['Obstacles passed', formatNumber(snapshot.obstaclesPassed)],
        ['Near misses', formatNumber(snapshot.nearMisses)],
        ['Wipeouts', formatNumber(snapshot.hits)],
      ])}
      ${block('Records', [
        ['Best combo', formatNumber(snapshot.combo)],
        ['Top multiplier', `×${snapshot.bestMultiplier}`],
        ['Top speed', `${Math.round(snapshot.topSpeed)} km/h`],
        ['Clean streak', formatDistance(snapshot.bestCleanDistance)],
      ])}`;

    this.show('results', { remember: false });
  }

  showError(title, message) {
    const titleEl = document.getElementById('error-title');
    const messageEl = document.getElementById('error-message');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    this.hideAll();
    this.show('error', { remember: false });
  }
}
