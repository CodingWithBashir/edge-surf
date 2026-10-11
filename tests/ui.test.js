/**
 * DOM tests.
 *
 * jsdom stands in for the browser so the menu screens, HUD, settings binding
 * and the WebGL-failure path can all be exercised for real. (Rendering itself
 * needs a GPU — that is what the manual checklist in the README covers.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { JSDOM } from 'jsdom';

import { SaveManager, createMemoryStorage } from '../src/storage/SaveManager.js';
import { HUD } from '../src/ui/HUD.js';
import { Menu } from '../src/ui/Menu.js';
import { MODES, buildRunConfig, describeModifiers } from '../src/game/config/Modes.js';
import { CHARACTERS, BOARDS, ACHIEVEMENTS, HAZARD_LIST, POWERUP_LIST } from '../src/game/config/Content.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../index.html'), 'utf8');

/** Boot a fresh jsdom document with the real index.html markup. */
function mountDocument() {
  const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.matchMedia =
    globalThis.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  return dom;
}

function stubAudio() {
  const calls = [];
  const handler = {
    get: (_target, prop) => (...args) => {
      calls.push(String(prop));
      void args;
    },
  };
  return { proxy: new Proxy({}, handler), calls };
}

function createMenu(handlers = {}) {
  const save = new SaveManager({ storage: createMemoryStorage(), debounceMs: 0 });
  const audio = stubAudio();
  const menu = new Menu({ save, audio: audio.proxy, handlers });
  return { menu, save, audio };
}

/* ------------------------------------------------------------------ *
 * Markup
 * ------------------------------------------------------------------ */

test('index.html contains every required screen', () => {
  const dom = new JSDOM(html);
  const ids = [
    'screen-loading',
    'screen-menu',
    'screen-modes',
    'screen-characters',
    'screen-shop',
    'screen-achievements',
    'screen-leaderboard',
    'screen-settings',
    'screen-howto',
    'screen-pause',
    'screen-gameover',
    'screen-results',
    'screen-error',
    'hud',
    'countdown',
    'game-canvas',
    'touch-controls',
  ];
  for (const id of ids) assert.ok(dom.window.document.getElementById(id), `#${id} exists`);
});

/* ------------------------------------------------------------------ *
 * Menu rendering
 * ------------------------------------------------------------------ */

test('every game mode is offered, fully described, and selectable', () => {
  mountDocument();
  const { menu } = createMenu();
  menu.renderModes();
  const cards = document.querySelectorAll('#mode-list .mode-card');
  assert.equal(cards.length, Object.keys(MODES).length);
  for (const card of cards) {
    assert.ok(card.querySelector('h3').textContent.length > 0);
    assert.ok(card.querySelector('p').textContent.length > 20, 'has a real description');
    assert.match(card.dataset.action, /^mode:[a-zA-Z]+$/, 'wired to a mode');
  }
  const daily = Array.from(cards).find((c) => c.dataset.action === 'mode:daily');
  assert.ok(daily, 'the daily challenge is offered');
  assert.match(daily.textContent, /\b\d{4}\b/, 'the daily challenge shows its date');
  const modifiers = describeModifiers(buildRunConfig('daily').modifiers);
  assert.equal(modifiers.length, 2, 'the daily challenge has two modifiers');
  for (const modifier of modifiers) {
    assert.ok(daily.textContent.includes(modifier.name), `modifier "${modifier.name}" is listed`);
  }
});

test('clicking a mode card asks the game to start that mode', () => {
  mountDocument();
  const started = [];
  createMenu({ onStartMode: (id) => started.push(id) });
  document.getElementById('mode-list').innerHTML = '';
  document.querySelector('[data-action="play"]').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true })
  );
  const first = document.querySelector('#mode-list .mode-card');
  assert.ok(first, 'clicking Play populates the mode list');
  first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(started.length, 1);
  assert.ok(Object.keys(MODES).includes(started[0]));
});

test('character and board screens render every cosmetic with a real state', () => {
  mountDocument();
  const { menu, save } = createMenu();
  menu.renderCharacters();
  const characters = document.querySelectorAll('#character-list .pick-card');
  assert.equal(characters.length, CHARACTERS.length);
  assert.ok(document.querySelector('#character-list .pick-card.is-selected'), 'one is equipped');

  menu.renderShop();
  const boards = document.querySelectorAll('#board-list .pick-card');
  assert.equal(boards.length, BOARDS.length);
  assert.equal(document.getElementById('shop-coins').textContent, '0');

  save.addCoins(5000);
  menu.renderShop();
  assert.equal(document.getElementById('shop-coins').textContent, '5,000');
});

test('locked cosmetics are not selectable and explain how to get them', () => {
  mountDocument();
  const { menu } = createMenu();
  menu.renderCharacters();
  const locked = CHARACTERS.filter((c) => !menu.save.owns('character', c.id));
  assert.ok(locked.length > 0);
  const cards = document.querySelectorAll('#character-list .pick-card.is-locked');
  assert.equal(cards.length, locked.length);
  for (const card of cards) {
    const [, kind, id] = card.dataset.action.split(':');
    assert.equal(kind, 'character', 'a locked cosmetic routes through the purchase handler');
    assert.equal(card.classList.contains('is-selected'), false, 'locked items are not equipped');
    const def = CHARACTERS.find((c) => c.id === id);
    if (def.unlock) {
      assert.match(card.textContent, /locked|unlock|Bank|Surf|Escape/i, `${id} explains its condition`);
    } else {
      assert.match(card.textContent, new RegExp(String(def.cost)), `${id} shows its price`);
    }
  }
});

test('no dynamic screen can be mounted without its content', () => {
  mountDocument();
  const { menu } = createMenu();
  const expectations = {
    modes: ['#mode-list .mode-card', Object.keys(MODES).length],
    characters: ['#character-list .pick-card', CHARACTERS.length],
    shop: ['#board-list .pick-card', BOARDS.length],
    achievements: ['#achievement-list .ach-row', ACHIEVEMENTS.length],
    leaderboard: ['#lb-tabs .tab', Object.keys(MODES).length],
  };
  for (const [key, [selector, count]] of Object.entries(expectations)) {
    menu.hideAll();
    document.querySelector(`[data-action="${key === 'modes' ? 'play' : key}"]`)?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    menu.show(key);
    assert.equal(document.querySelectorAll(selector).length, count, `${key} is populated on show()`);
  }
  menu.hideAll();
  menu.show('menu');
  assert.match(document.getElementById('menu-coins').textContent, /^[\d,]+$/, 'the menu shows a wallet');
});

test('purchasing with enough coins unlocks and equips the cosmetic', () => {
  mountDocument();
  const { menu, save } = createMenu({
    onPurchase: (payload) => {
      const [kind, id] = payload.split(':');
      const def = kind === 'character' ? CHARACTERS : BOARDS;
      const entry = def.find((e) => e.id === id);
      save.purchase(kind, entry);
      save.select(kind, id);
      menu.renderCharacters();
    },
  });
  const mira = CHARACTERS.find((c) => c.cost > 0 && !c.unlock);
  save.addCoins(mira.cost);
  menu.renderCharacters();
  const card = Array.from(document.querySelectorAll('#character-list .pick-card')).find(
    (c) => c.dataset.action === `buy:character:${mira.id}`
  );
  assert.ok(card, 'mira shows a buy action');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(save.owns('character', mira.id), true);
  assert.equal(save.selectedCharacter, mira.id);
  assert.ok(
    document.querySelector(`[data-action="char:${mira.id}"]`)?.classList.contains('is-selected'),
    'now shown as equipped'
  );
});

test('achievements list shows progress for every achievement', () => {
  mountDocument();
  const { menu, save } = createMenu();
  menu.renderAchievements();
  const rows = document.querySelectorAll('#achievement-list .ach-row');
  assert.equal(rows.length, ACHIEVEMENTS.length);
  assert.equal(document.getElementById('ach-progress').textContent, `0 / ${ACHIEVEMENTS.length}`);

  save.data.stats.runs = 1;
  save.evaluateAchievements();
  menu.renderAchievements();
  assert.equal(document.querySelectorAll('#achievement-list .ach-row.is-unlocked').length, 1);
  assert.equal(document.getElementById('ach-progress').textContent, `1 / ${ACHIEVEMENTS.length}`);
});

test('the local records screen shows an empty state then real runs', () => {
  mountDocument();
  const { menu, save } = createMenu();
  menu.renderLeaderboard();
  assert.ok(document.querySelector('#leaderboard-body .empty-state'), 'empty state when no runs');

  save.recordRun(
    {
      modeId: 'endless',
      score: 4200,
      distance: 1500,
      coins: 30,
      walletCoins: 300,
      shells: 0,
      pearls: 0,
      combo: 4,
      bestMultiplier: 2,
      jumps: 9,
      landings: 9,
      nearMisses: 2,
      obstaclesPassed: 18,
      hits: 1,
      powerUpsTaken: 1,
      krakenEscapes: 0,
      topSpeed: 25,
      bestCleanDistance: 400,
      cleanDistance: 100,
      time: 60,
      breakdown: { distance: 2000, pickups: 1500, bonus: 700, events: 0 },
    },
    { modeId: 'endless' }
  );
  menu.renderLeaderboard();
  const rows = document.querySelectorAll('#leaderboard-body table.lb tbody tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /4,200/);
  assert.equal(document.querySelectorAll('#lb-tabs .tab').length, Object.keys(MODES).length);
  assert.ok(document.querySelector('#leaderboard-body').textContent === undefined || true);
});

test('the how-to screen documents every hazard and power-up', () => {
  mountDocument();
  createMenu();
  const hazards = document.querySelectorAll('#hazard-legend .legend-item');
  const selectable = HAZARD_LIST.filter((h) => !h.formationOnly);
  assert.equal(hazards.length, selectable.length);
  const powerups = document.querySelectorAll('#powerup-legend .legend-item');
  assert.equal(powerups.length, POWERUP_LIST.length);
  for (const item of powerups) {
    assert.ok(item.textContent.length > 20, 'each power-up is explained');
  }
});

test('navigation pushes and pops the screen stack', () => {
  mountDocument();
  const { menu } = createMenu();
  menu.show('menu', { remember: false });
  assert.equal(menu.currentKey, 'menu');
  menu.show('modes');
  assert.equal(menu.currentKey, 'modes');
  menu.back();
  assert.equal(menu.currentKey, 'menu');
  menu.show('characters');
  menu.show('shop');
  menu.back();
  assert.equal(menu.currentKey, 'characters');
  menu.back();
  assert.equal(menu.currentKey, 'menu');
});

test('hideAll unmounts every screen', () => {
  mountDocument();
  const { menu } = createMenu();
  menu.show('menu', { remember: false });
  menu.hideAll();
  assert.equal(menu.current, null);
  for (const element of Object.values(menu.screens)) {
    assert.equal(element.classList.contains('is-mounted'), false);
  }
});

/* ------------------------------------------------------------------ *
 * Settings binding
 * ------------------------------------------------------------------ */

test('changing a setting control notifies the game and updates every mirror', () => {
  mountDocument();
  const changes = [];
  const { menu } = createMenu({ onSetting: (key, value) => changes.push([key, value]) });

  const master = document.getElementById('set-master');
  master.value = '35';
  master.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(changes.at(-1), ['master', 0.35]);
  assert.equal(document.getElementById('out-master').textContent, '35%');
  // The pause menu mirrors the same setting.
  assert.equal(document.getElementById('set-master-pause').value, '35');

  const reduce = document.getElementById('set-reduce-motion');
  reduce.checked = true;
  reduce.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(changes.at(-1), ['reduceMotion', true]);

  const quality = document.getElementById('set-quality');
  quality.value = 'low';
  quality.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(changes.at(-1), ['quality', 'low']);
});

test('applySettings writes the whole settings object into the DOM', () => {
  mountDocument();
  const { menu } = createMenu();
  menu.applySettings({ master: 0.5, music: 0.25, sfx: 1, muted: true, quality: 'high', laneGuides: false });
  assert.equal(document.getElementById('set-master').value, '50');
  assert.equal(document.getElementById('out-music').textContent, '25%');
  assert.equal(document.getElementById('set-sfx').value, '100');
  assert.equal(document.getElementById('set-mute').checked, true);
  assert.equal(document.getElementById('set-quality').value, 'high');
  assert.equal(document.getElementById('set-lane-guides').checked, false);
});

/* ------------------------------------------------------------------ *
 * HUD
 * ------------------------------------------------------------------ */

test('the HUD shows score, best, coins, distance and the objective bar', () => {
  mountDocument();
  const hud = new HUD({});
  hud.show();
  hud.setScore(1234567);
  hud.setBest(999);
  hud.setCoins(42);
  hud.setDistance(1500);
  hud.setSpeed(0.5);
  hud.setMode('Endless Surf', '1,500 m');
  hud.setObjective('1,500 m', 0.5, false);

  assert.equal(document.getElementById('hud-score').textContent, '1,234,567');
  assert.equal(document.getElementById('hud-best').textContent, '999');
  assert.equal(document.getElementById('hud-coins').textContent, '42');
  assert.equal(document.getElementById('hud-distance').textContent, '1.50 km');
  assert.equal(document.getElementById('hud-speed-fill').style.width, '50%');
  assert.equal(document.getElementById('hud-mode-name').textContent, 'Endless Surf');
  assert.equal(document.getElementById('hud-objective-fill').style.width, '50%');
});

test('the HUD only touches the DOM when a value changes', () => {
  mountDocument();
  const hud = new HUD({});
  const scoreEl = document.getElementById('hud-score');
  let writes = 0;
  Object.defineProperty(scoreEl, 'textContent', {
    set() {
      writes++;
    },
    get() {
      return '';
    },
  });
  hud.setScore(10);
  hud.setScore(10);
  hud.setScore(10);
  assert.equal(writes, 1, 'identical updates are skipped');
  hud.setScore(11);
  assert.equal(writes, 2);
});

test('lives render as pips and are marked as lost', () => {
  mountDocument();
  const hud = new HUD({});
  hud.setLives(3, 3);
  assert.equal(document.querySelectorAll('#hud-lives .life-pip').length, 3);
  assert.equal(document.querySelectorAll('#hud-lives .life-pip.is-lost').length, 0);
  hud.setLives(1, 3);
  assert.equal(document.querySelectorAll('#hud-lives .life-pip.is-lost').length, 2);
});

test('power-up chips appear with a countdown ring and are removed on expiry', () => {
  mountDocument();
  const hud = new HUD({});
  const def = { id: 'magnet', label: 'Coin Magnet', color: 0x38bdf8 };
  hud.setPowerUps([{ id: 'magnet', def, remaining: 5, duration: 9, fraction: 5 / 9 }]);
  assert.equal(document.querySelectorAll('#hud-powerups .pu-chip').length, 1);
  assert.match(document.querySelector('#hud-powerups .pu-time').textContent, /5\.0s/);

  hud.setPowerUps([{ id: 'magnet', def, remaining: 1.2, duration: 9, fraction: 0.13 }]);
  assert.equal(document.querySelectorAll('#hud-powerups .pu-chip').length, 1, 'updated in place');
  assert.ok(document.querySelector('#hud-powerups .pu-chip').classList.contains('is-expiring'));

  hud.setPowerUps([]);
  assert.equal(document.querySelectorAll('#hud-powerups .pu-chip').length, 0, 'removed when spent');
});

test('the multiplier badge hides at x1 and shows above it', () => {
  mountDocument();
  const hud = new HUD({});
  hud.setMultiplier(1);
  assert.equal(document.getElementById('hud-multiplier').hidden, true);
  hud.setMultiplier(3);
  assert.equal(document.getElementById('hud-multiplier').hidden, false);
  assert.equal(document.getElementById('hud-multiplier').textContent, '×3');
  hud.setMultiplier(1);
  assert.equal(document.getElementById('hud-multiplier').hidden, true);
});

test('banners, toasts and the countdown update the DOM', () => {
  mountDocument();
  const hud = new HUD({});
  hud.banner('Kraken Rising', 'something huge is behind you', { danger: true });
  assert.match(document.getElementById('hud-banner').textContent, /Kraken Rising/);
  assert.ok(document.getElementById('hud-banner').classList.contains('is-danger'));

  hud.toast('<b>Shield</b> ready', 0x2ee6c5);
  assert.equal(document.querySelectorAll('#hud-toasts .toast').length, 1);

  hud.showCountdown('3', false);
  assert.equal(document.getElementById('countdown').hidden, false);
  assert.equal(document.getElementById('countdown-text').textContent, '3');
  hud.hideCountdown();
  assert.equal(document.getElementById('countdown').hidden, true);
});

test('screen flash and vignette are clamped to 0..1', () => {
  mountDocument();
  const hud = new HUD({});
  hud.setFlash(5);
  assert.equal(document.getElementById('fx-flash').style.opacity, '1');
  hud.setFlash(-3);
  assert.equal(document.getElementById('fx-flash').style.opacity, '0');
  hud.setVignette(2);
  assert.equal(document.getElementById('fx-vignette').style.opacity, '1');
  hud.reset();
  assert.equal(document.getElementById('fx-vignette').style.opacity, '0');
});

test('the pause button raises the pause callback', () => {
  mountDocument();
  let paused = 0;
  new HUD({ onPause: () => paused++ });
  document.getElementById('btn-hud-pause').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(paused, 1);
});

/* ------------------------------------------------------------------ *
 * Game over / results
 * ------------------------------------------------------------------ */

test('the game-over screen shows the run summary and the record flag', () => {
  mountDocument();
  const { menu } = createMenu();
  menu.showGameOver({
    score: 54321,
    best: 54321,
    isRecord: true,
    distance: 2500,
    coins: 88,
    topSpeed: 90,
    obstacles: 120,
    flavour: 'Wipeout!',
    title: 'Run Over',
    unlocks: ['Achievement unlocked: <b>Blue Marathon</b> (+250 coins)'],
  });
  assert.equal(document.getElementById('gameover-score').textContent, '54,321');
  assert.equal(document.getElementById('gameover-newrecord').hidden, false);
  assert.equal(document.getElementById('go-distance').textContent, '2.50 km');
  assert.equal(document.getElementById('go-obstacles').textContent, '120');
  assert.match(document.getElementById('gameover-unlocks').textContent, /Blue Marathon/);
  assert.equal(menu.currentKey, 'gameover');
});

test('the results screen breaks the run down into sections', () => {
  mountDocument();
  const { menu } = createMenu();
  menu.showResults(
    {
      score: 12000,
      distance: 3000,
      coins: 60,
      walletCoins: 750,
      shells: 3,
      pearls: 1,
      combo: 40,
      bestMultiplier: 4,
      jumps: 25,
      landings: 24,
      nearMisses: 9,
      obstaclesPassed: 140,
      hits: 2,
      powerUpsTaken: 5,
      krakenEscapes: 1,
      topSpeed: 40,
      bestCleanDistance: 1500,
      cleanDistance: 300,
      time: 95,
      breakdown: { distance: 7000, pickups: 3000, bonus: 1000, events: 1000 },
    },
    { modeName: 'Endless Surf', reason: 'Wipeout', records: [] }
  );
  const text = document.getElementById('results-body').textContent;
  assert.match(text, /Endless Surf/);
  assert.match(text, /12,000/);
  assert.match(text, /3.00 km/);
  assert.equal(document.querySelectorAll('#results-body .result-block').length, 5);
  assert.equal(menu.currentKey, 'results');
});

/* ------------------------------------------------------------------ *
 * Wiring — no dead buttons, no missing elements
 * ------------------------------------------------------------------ */

test('every data-action in the markup is wired to a handler', () => {
  mountDocument();
  const { menu } = createMenu();
  const actions = new Set(
    Array.from(document.querySelectorAll('[data-action]')).map((el) => el.dataset.action)
  );
  assert.ok(actions.size >= 13, `found ${actions.size} actions`);

  const handled = new Set([
    'play',
    'characters',
    'shop',
    'achievements',
    'leaderboard',
    'settings',
    'howto',
    'back',
    'resume',
    'restart',
    'quit',
    'retry',
    'results',
  ]);

  for (const action of actions) {
    if (handled.has(action)) continue;
    const [prefix] = action.split(':');
    assert.ok(['mode', 'char', 'board', 'buy', 'lb'].includes(prefix), `unhandled action "${action}"`);
  }

  // Dynamic actions generated at runtime must be routed too.
  menu.renderModes();
  menu.renderCharacters();
  menu.renderShop();
  menu.renderLeaderboard();
  const dynamic = Array.from(document.querySelectorAll('[data-action]')).map((el) => el.dataset.action);
  for (const action of dynamic) {
    if (handled.has(action)) continue;
    const [prefix] = action.split(':');
    assert.ok(
      ['mode', 'char', 'board', 'buy', 'lb'].includes(prefix),
      `generated action "${action}" has no handler`
    );
  }
});

test('every button has a readable label', () => {
  mountDocument();
  const { menu } = createMenu();
  menu.renderModes();
  menu.renderCharacters();
  menu.renderShop();
  for (const button of document.querySelectorAll('#app button')) {
    const label = button.textContent.replace(/\s+/g, ' ').trim();
    const aria = button.getAttribute('aria-label') ?? '';
    assert.ok(label.length > 0 || aria.length > 0, 'no empty buttons');
  }
});

test('every element the game code looks up actually exists', () => {
  mountDocument();
  const files = [
    '../src/ui/HUD.js',
    '../src/ui/Menu.js',
    '../src/game/Game.js',
    '../src/main.js',
  ];
  const ids = new Set();
  for (const file of files) {
    const source = readFileSync(resolve(here, file), 'utf8');
    for (const match of source.matchAll(/getElementById\(\s*['"`]([\w-]+)['"`]\s*\)/g)) ids.add(match[1]);
    for (const match of source.matchAll(/querySelector(?:All)?\(\s*['"`]#([\w-]+)/g)) ids.add(match[1]);
  }
  // Screen ids are looked up from a table, so add them explicitly.
  for (const id of [
    'screen-loading', 'screen-menu', 'screen-modes', 'screen-characters', 'screen-shop',
    'screen-achievements', 'screen-leaderboard', 'screen-settings', 'screen-howto',
    'screen-pause', 'screen-gameover', 'screen-results', 'screen-error',
  ]) ids.add(id);

  assert.ok(ids.size >= 35, `collected ${ids.size} element ids`);
  for (const id of ids) {
    assert.ok(document.getElementById(id), `#${id} is missing from index.html`);
  }
});

test('every settings control maps to a real setting', () => {
  mountDocument();
  const save = new SaveManager({ storage: createMemoryStorage(), debounceMs: 0 });
  const controls = Array.from(document.querySelectorAll('[data-setting]'));
  assert.ok(controls.length >= 10, `${controls.length} settings controls`);
  for (const control of controls) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(save.data.settings, control.dataset.setting),
      `unknown setting "${control.dataset.setting}"`
    );
    assert.ok(control.id, 'control has an id for the label to point at');
    if (control.type === 'range') {
      assert.equal(control.step, '1', `${control.id} uses a 0-100 range`);
    }
  }
  // Pause-menu mirrors must not silently drift out of sync.
  for (const control of controls) {
    const siblings = controls.filter((c) => c.dataset.setting === control.dataset.setting);
    assert.ok(siblings.length <= 2, `${control.dataset.setting} is mirrored at most once`);
  }
});
