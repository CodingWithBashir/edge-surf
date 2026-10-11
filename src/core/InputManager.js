/**
 * Input handling for keyboard, touch and on-screen controls.
 *
 * The manager translates raw events into *game actions* and never touches
 * gameplay state itself. Discrete presses are emitted as they happen; held
 * state is polled so the Game can implement its own key-repeat feel.
 *
 * Touch: swipe left/right to change lane, swipe up (or tap) to jump, swipe
 * down to duck. All gestures call preventDefault so the page never scrolls
 * mid-run, and `touch-action: none` is set in CSS as a second line of defence.
 */

export const Action = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
  JUMP: 'jump',
  DUCK: 'duck',
  PAUSE: 'pause',
  CONFIRM: 'confirm',
  BACK: 'back',
});

const KEY_MAP = {
  ArrowLeft: Action.LEFT,
  KeyA: Action.LEFT,
  ArrowRight: Action.RIGHT,
  KeyD: Action.RIGHT,
  Space: Action.JUMP,
  ArrowUp: Action.JUMP,
  KeyW: Action.JUMP,
  ArrowDown: Action.DUCK,
  KeyS: Action.DUCK,
  KeyP: Action.PAUSE,
  Escape: Action.PAUSE,
  Enter: Action.CONFIRM,
  NumpadEnter: Action.CONFIRM,
};

/** Keys we must stop the browser from acting on (scrolling, shortcuts). */
const SWALLOW = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyP', 'Enter']);

const SWIPE_THRESHOLD = 28;
const TAP_THRESHOLD = 16;
const TAP_TIME = 260;

export class InputManager {
  /**
   * @param {{canvas:HTMLCanvasElement, onAction:(action:string, event?:any)=>void,
   *          touchControls?:HTMLElement, invertSwipe?:boolean}} options
   */
  constructor(options) {
    this.canvas = options.canvas;
    this.onAction = options.onAction ?? (() => {});
    this.touchControls = options.touchControls ?? null;
    this.invertSwipe = false;

    /** @type {Set<string>} */
    this.held = new Set();
    this.gameplayEnabled = false;
    this.duckHeld = false;

    this._touch = null;
    this._bound = [];
    this._duckTimer = null;

    this._bind();
  }

  _add(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    this._bound.push([target, type, handler, opts]);
  }

  _bind() {
    this._add(globalThis, 'keydown', this._onKeyDown, { passive: false });
    this._add(globalThis, 'keyup', this._onKeyUp, { passive: false });
    this._add(globalThis, 'blur', this._onBlur);
    this._add(this.canvas, 'pointerdown', this._onPointerDown, { passive: false });
    this._add(this.canvas, 'pointermove', this._onPointerMove, { passive: false });
    this._add(this.canvas, 'pointerup', this._onPointerUp, { passive: false });
    this._add(this.canvas, 'pointercancel', this._onPointerUp, { passive: false });
    this._add(this.canvas, 'contextmenu', (e) => e.preventDefault());

    if (this.touchControls) {
      const map = {
        'touch-left': Action.LEFT,
        'touch-right': Action.RIGHT,
        'touch-up': Action.JUMP,
        'touch-down': Action.DUCK,
      };
      for (const [id, action] of Object.entries(map)) {
        const button = this.touchControls.querySelector(`#${id}`);
        if (!button) continue;
        this._add(button, 'pointerdown', (event) => {
          event.preventDefault();
          button.classList.add('is-held');
          this.held.add(action);
          if (action === Action.DUCK) this.duckHeld = true;
          this.onAction(action, event);
        }, { passive: false });
        const release = (event) => {
          button.classList.remove('is-held');
          this.held.delete(action);
          if (action === Action.DUCK) this.duckHeld = false;
          if (event) event.preventDefault();
        };
        this._add(button, 'pointerup', release, { passive: false });
        this._add(button, 'pointerleave', release, { passive: false });
        this._add(button, 'pointercancel', release, { passive: false });
      }
    }
  }

  /* ------------------------------ keyboard ------------------------------ */

  _onKeyDown = (event) => {
    const action = KEY_MAP[event.code];
    if (!action) return;
    if (SWALLOW.has(event.code)) event.preventDefault();
    if (event.repeat) return; // repeat is handled by the Game's own timer

    this.held.add(action);
    if (action === Action.DUCK) this.duckHeld = true;

    // Pause / confirm are always available (menus included).
    if (action === Action.PAUSE || action === Action.CONFIRM) {
      this.onAction(action, event);
      return;
    }
    if (!this.gameplayEnabled) return;
    this.onAction(action, event);
  };

  _onKeyUp = (event) => {
    const action = KEY_MAP[event.code];
    if (!action) return;
    if (SWALLOW.has(event.code)) event.preventDefault();
    this.held.delete(action);
    if (action === Action.DUCK) this.duckHeld = false;
  };

  _onBlur = () => {
    this.held.clear();
    this.duckHeld = false;
  };

  /* -------------------------------- touch -------------------------------- */

  _onPointerDown = (event) => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    this._touch = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      time: performance.now(),
      moved: false,
    };
  };

  _onPointerMove = (event) => {
    const touch = this._touch;
    if (!touch || event.pointerId !== touch.id) return;
    event.preventDefault();
    if (!this.gameplayEnabled) return;

    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;

    if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      const direction = (dx > 0 ? 1 : -1) * (this.invertSwipe ? -1 : 1);
      this.onAction(direction > 0 ? Action.RIGHT : Action.LEFT, event);
      // Reset the origin so a long drag can chain lane changes.
      touch.x = event.clientX;
      touch.startX = event.clientX;
      touch.moved = true;
      return;
    }

    if (Math.abs(dy) >= SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) {
        this.onAction(Action.JUMP, event);
      } else {
        this.onAction(Action.DUCK, event);
        this._holdDuck();
      }
      touch.moved = true;
      touch.x = event.clientX;
      touch.y = event.clientY;
    }
  };

  _onPointerUp = (event) => {
    const touch = this._touch;
    if (!touch || event.pointerId !== touch.id) return;
    event.preventDefault();
    const dt = performance.now() - touch.time;
    const dx = event.clientX - touch.startX;
    const dy = event.clientY - touch.startY;
    const distance = Math.hypot(dx, dy);

    if (!touch.moved && distance < TAP_THRESHOLD && dt < TAP_TIME && this.gameplayEnabled) {
      // A quick tap means "jump".
      this.onAction(Action.JUMP, event);
    }
    this._touch = null;
  };

  /** Swipe-down produces a short duck rather than a held one. */
  _holdDuck() {
    this.duckHeld = true;
    if (this._duckTimer) clearTimeout(this._duckTimer);
    this._duckTimer = setTimeout(() => {
      this.duckHeld = false;
      this.held.delete(Action.DUCK);
      this._duckTimer = null;
    }, 420);
  }

  /* --------------------------------- API -------------------------------- */

  setGameplayEnabled(enabled) {
    this.gameplayEnabled = enabled;
    if (!enabled) {
      this.held.clear();
      this.duckHeld = false;
    }
  }

  setInvertSwipe(value) {
    this.invertSwipe = !!value;
  }

  isHeld(action) {
    return this.held.has(action);
  }

  /** Currently held lane direction, -1 / 0 / +1. */
  get laneDirection() {
    if (this.held.has(Action.LEFT) && !this.held.has(Action.RIGHT)) return -1;
    if (this.held.has(Action.RIGHT) && !this.held.has(Action.LEFT)) return 1;
    return 0;
  }

  get duck() {
    return this.duckHeld || this.held.has(Action.DUCK);
  }

  dispose() {
    for (const [target, type, handler, opts] of this._bound) {
      target.removeEventListener(type, handler, opts);
    }
    this._bound.length = 0;
    if (this._duckTimer) clearTimeout(this._duckTimer);
  }
}
