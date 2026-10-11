/**
 * Surf Rush — application entry point.
 *
 * Boots the game, drives the loading screen and installs a top-level error
 * boundary so a failure surfaces as a readable message instead of a black
 * canvas.
 */

import { Game } from './game/Game.js';
import { GameState } from './core/StateMachine.js';

const LOADING_STEPS = [
  [0.1, 'Waxing the board…'],
  [0.28, 'Reading the swell…'],
  [0.45, 'Building the coastline…'],
  [0.62, 'Teaching the surfer to stand…'],
  [0.78, 'Waking the Kraken…'],
  [0.92, 'Tuning the buoy band…'],
];

const dom = {
  canvas: document.getElementById('game-canvas'),
  touchControls: document.getElementById('touch-controls'),
};

const loaderFill = document.getElementById('loader-fill');
const loaderStatus = document.getElementById('loader-status');
const loadingScreen = document.getElementById('screen-loading');

function setProgress(value, message) {
  if (loaderFill) loaderFill.style.width = `${Math.round(value * 100)}%`;
  if (message && loaderStatus) loaderStatus.textContent = message;
}

/** Yield to the browser so the loading bar actually paints between steps. */
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function hideLoading() {
  if (!loadingScreen) return;
  loadingScreen.classList.remove('is-active');
  setTimeout(() => {
    loadingScreen.classList.remove('is-mounted');
    loadingScreen.setAttribute('aria-hidden', 'true');
  }, 260);
}

function showFatal(title, message) {
  hideLoading();
  const titleEl = document.getElementById('error-title');
  const messageEl = document.getElementById('error-message');
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;
  const errorScreen = document.getElementById('screen-error');
  if (errorScreen) {
    errorScreen.classList.add('is-mounted');
    requestAnimationFrame(() => errorScreen.classList.add('is-active'));
  }
}

async function boot() {
  let step = 0;

  /** @type {Game} */
  let game = null;

  try {
    setProgress(LOADING_STEPS[0][0], LOADING_STEPS[0][1]);
    await nextFrame();

    game = new Game(dom);
    globalThis.__surfRush = game;

    // Advance the bar while the heavy subsystems are constructed.
    const advance = setInterval(() => {
      step = Math.min(step + 1, LOADING_STEPS.length - 1);
      setProgress(LOADING_STEPS[step][0], LOADING_STEPS[step][1]);
    }, 90);

    const ok = await game.init();

    clearInterval(advance);
    if (!ok) return; // init() already showed the error screen

    setProgress(1, 'Dropping in…');
    await nextFrame();
    // Warm-up frame: compiles shaders before the menu appears.
    game.world.render();
    await nextFrame();

    hideLoading();
    game.state.change(GameState.MENU, { force: true });
  } catch (error) {
    console.error('[Surf Rush] boot failed', error);
    clearInterval(0);
    showFatal('Surf Rush can’t start', error?.message ?? String(error));
    if (game) {
      try {
        game.state.change(GameState.ERROR, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

// Never let an unhandled rejection leave the player staring at the loader.
globalThis.addEventListener('unhandledrejection', (event) => {
  console.error('[Surf Rush] unhandled rejection', event.reason);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
