/**
 * Minimal type-safe-ish event bus.
 *
 * Used to decouple gameplay (which emits `coin:collected`, `player:hit`, …)
 * from the HUD, audio, achievements and persistence layers.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  on(type, handler) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(type, handler) {
    this._handlers.get(type)?.delete(handler);
  }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (!set || set.size === 0) return;
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[EventBus] handler for "${type}" threw`, error);
      }
    }
  }

  clear(type) {
    if (type) this._handlers.delete(type);
    else this._handlers.clear();
  }
}
