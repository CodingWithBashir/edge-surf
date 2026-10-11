/**
 * Finite state machine used for the game lifecycle.
 *
 * Guards against the classic arcade bugs: illegal transitions, states that
 * silently run twice, or gameplay continuing behind a menu.
 */

export const GameState = Object.freeze({
  BOOT: 'boot',
  LOADING: 'loading',
  MENU: 'menu',
  MODE_SELECT: 'modeSelect',
  CHARACTERS: 'characters',
  SHOP: 'shop',
  ACHIEVEMENTS: 'achievements',
  LEADERBOARD: 'leaderboard',
  SETTINGS: 'settings',
  HOWTO: 'howto',
  READY: 'ready', // countdown / "get set"
  PLAYING: 'playing',
  PAUSED: 'paused',
  WIPEOUT: 'wipeout', // short crash animation before the summary
  GAME_OVER: 'gameOver',
  RESULTS: 'results',
  ERROR: 'error',
});

/** States in which the simulation must advance. */
export const SIMULATED_STATES = new Set([GameState.READY, GameState.PLAYING, GameState.WIPEOUT]);

export class StateMachine {
  /**
   * @param {string} initial
   * @param {Record<string, string[]>} [transitions] allowed from -> [to]
   */
  constructor(initial, transitions = null) {
    this.state = initial;
    this.previous = null;
    this.transitions = transitions;
    /** @type {Map<string, Set<(to:string, from:string)=>void>>} */
    this._listeners = new Map();
    this._history = [initial];
  }

  /** Register a handler fired on entering `state`. */
  onEnter(state, handler) {
    if (!this._listeners.has(state)) this._listeners.set(state, new Set());
    this._listeners.get(state).add(handler);
    return () => this._listeners.get(state)?.delete(handler);
  }

  /** Register a handler fired on leaving `state`. */
  onExit(state, handler) {
    return this.onEnter(`__exit:${state}`, handler);
  }

  canTransition(to) {
    if (to === this.state) return false;
    if (!this.transitions) return true;
    const allowed = this.transitions[this.state];
    return !allowed || allowed.includes(to);
  }

  /**
   * @param {string} to
   * @param {{force?:boolean}} [options]
   * @returns {boolean} true when the transition happened
   */
  change(to, options = {}) {
    if (!options.force && !this.canTransition(to)) return false;
    const from = this.state;
    this.previous = from;
    this.state = to;
    this._history.push(to);
    if (this._history.length > 32) this._history.shift();
    this._emit(`__exit:${from}`, to, from);
    this._emit(to, to, from);
    return true;
  }

  _emit(key, to, from) {
    const set = this._listeners.get(key);
    if (!set) return;
    for (const handler of Array.from(set)) {
      try {
        handler(to, from);
      } catch (error) {
        console.error(`[StateMachine] listener for "${key}" threw`, error);
      }
    }
  }

  is(...states) {
    return states.includes(this.state);
  }
}
