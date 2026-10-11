/**
 * Power-up timers.
 *
 * Owns activation, countdown and expiry so every consumer (HUD, audio,
 * simulation) sees exactly the same state. Instant effects such as Extra Life
 * are applied by the caller and never enter the timer map.
 */

import { POWERUPS } from '../config/Content.js';

export const POWERUP_EVENT = Object.freeze({
  ACTIVATED: 'activated',
  EXPIRED: 'expired',
  CONSUMED: 'consumed',
});

export class PowerUpManager {
  constructor() {
    /** @type {Map<string, {id:string, remaining:number, duration:number, def:any}>} */
    this.active = new Map();
    /** @type {Array<{id:string, type:string, def:any}>} */
    this.events = [];
    this.shieldCharges = 0;
  }

  reset() {
    this.active.clear();
    this.events.length = 0;
    this.shieldCharges = 0;
  }

  /** @returns {any} the power-up definition (or undefined for unknown ids) */
  activate(id) {
    const def = POWERUPS[id];
    if (!def) return undefined;

    if (def.instant) {
      if (id === 'extralife') this.shieldCharges += 0; // lives are handled by the run
      this.events.push({ id, type: POWERUP_EVENT.ACTIVATED, def });
      return def;
    }

    const existing = this.active.get(id);
    if (existing) {
      // Re-picking a live power-up tops the timer up rather than stacking.
      existing.remaining = Math.max(existing.remaining, def.duration);
      existing.duration = def.duration;
    } else {
      this.active.set(id, { id, remaining: def.duration, duration: def.duration, def });
    }
    if (id === 'shield') this.shieldCharges = 1;
    this.events.push({ id, type: POWERUP_EVENT.ACTIVATED, def });
    return def;
  }

  /**
   * @param {number} dt
   * @returns {Array<{id:string,type:string,def:any}>} events raised this frame
   */
  update(dt) {
    const raised = [];
    for (const entry of Array.from(this.active.values())) {
      entry.remaining -= dt;
      if (entry.remaining <= 0) {
        this.active.delete(entry.id);
        if (entry.id === 'shield') this.shieldCharges = 0;
        const event = { id: entry.id, type: POWERUP_EVENT.EXPIRED, def: entry.def };
        this.events.push(event);
        raised.push(event);
      }
    }
    return raised;
  }

  /**
   * Spend the shield if one is active.
   * @returns {boolean} true when the hit was absorbed
   */
  consumeShield() {
    if (!this.active.has('shield')) return false;
    this.active.delete('shield');
    this.shieldCharges = 0;
    this.events.push({ id: 'shield', type: POWERUP_EVENT.CONSUMED, def: POWERUPS.shield });
    return true;
  }

  isActive(id) {
    return this.active.has(id);
  }

  remaining(id) {
    return this.active.get(id)?.remaining ?? 0;
  }

  /** 0..1 remaining fraction — drives the HUD ring. */
  fraction(id) {
    const entry = this.active.get(id);
    if (!entry || entry.duration <= 0) return 0;
    return Math.max(0, Math.min(1, entry.remaining / entry.duration));
  }

  /** True during the last 2.5 seconds so the HUD can blink a warning. */
  isExpiring(id, threshold = 2.5) {
    const entry = this.active.get(id);
    return !!entry && entry.remaining <= threshold;
  }

  get magnetActive() {
    return this.active.has('magnet');
  }

  get boostFactor() {
    return this.active.has('boost') ? POWERUPS.boost.speedFactor : 1;
  }

  get multiplierBonus() {
    return this.active.has('multiplier') ? POWERUPS.multiplier.multiplierBonus : 0;
  }

  get magnetRadius() {
    return this.active.has('magnet') ? POWERUPS.magnet.radius : 0;
  }

  /** Drain queued events (call once per frame after reading). */
  flushEvents() {
    if (this.events.length === 0) return [];
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  /** @returns {Array<{id:string,def:any,remaining:number,duration:number,fraction:number}>} */
  list() {
    const out = [];
    for (const entry of this.active.values()) {
      out.push({
        id: entry.id,
        def: entry.def,
        remaining: entry.remaining,
        duration: entry.duration,
        fraction: this.fraction(entry.id),
      });
    }
    return out;
  }
}
