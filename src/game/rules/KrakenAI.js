/**
 * Kraken chase director.
 *
 * A pure state machine: it decides *when* a chase starts, how close the
 * creature is, and when the player escapes or is caught. Rendering, audio and
 * life-loss consequences live in the Game layer, which reacts to the events
 * returned from `update()`.
 */

import { BALANCE } from '../config/Content.js';
import { clamp, clamp01 } from '../../core/MathUtils.js';

export const KrakenState = Object.freeze({
  IDLE: 'idle',
  WARNING: 'warning',
  CHASING: 'chasing',
  RETREATING: 'retreating',
});

export class KrakenAI {
  /** @param {{kraken?:boolean, krakenIntervalScale?:number}} [config] */
  constructor(config = {}) {
    this.configure(config);
    this.reset();
  }

  configure(config = {}) {
    this.enabled = config.kraken !== false;
    this.interval = BALANCE.kraken.interval * (config.krakenIntervalScale ?? 1);
  }

  reset() {
    this.state = KrakenState.IDLE;
    this.gap = BALANCE.kraken.startGap;
    this.timeInState = 0;
    this.surfedDuringChase = 0;
    this.distanceToNext = this.enabled ? this.interval : Infinity;
    this.chases = 0;
    this.escapes = 0;
    this.catches = 0;
    /** @type {Array<{type:string}>} */
    this.events = [];
    this.warningPlayed = false;
  }

  get isActive() {
    return this.state === KrakenState.CHASING || this.state === KrakenState.WARNING;
  }

  get isChasing() {
    return this.state === KrakenState.CHASING;
  }

  /** 0..100 where 100 is "far behind and safe", 0 is "it has you". */
  get threat() {
    return 100 - clamp(this.gap, 0, 100);
  }

  /** 0..1 completion of the escape distance requirement. */
  get escapeProgress() {
    return clamp01(this.surfedDuringChase / BALANCE.kraken.escapeDistance);
  }

  /**
   * @param {number} dt
   * @param {{distanceDelta:number, difficulty:number, seedOrb?:boolean, hit?:boolean}} ctx
   * @returns {Array<{type:string}>} events raised this frame
   */
  update(dt, ctx) {
    const raised = [];
    this.timeInState += dt;
    const { distanceDelta = 0, difficulty = 0 } = ctx;

    switch (this.state) {
      case KrakenState.IDLE: {
        if (!this.enabled) break;
        this.distanceToNext -= distanceDelta;
        if (this.distanceToNext <= 0) {
          this.state = KrakenState.WARNING;
          this.timeInState = 0;
          this.warningPlayed = true;
          raised.push({ type: 'warning' });
        }
        break;
      }

      case KrakenState.WARNING: {
        if (this.timeInState >= BALANCE.kraken.warningTime) {
          this.state = KrakenState.CHASING;
          this.timeInState = 0;
          this.surfedDuringChase = 0;
          this.gap = BALANCE.kraken.startGap;
          this.chases++;
          raised.push({ type: 'start' });
        }
        break;
      }

      case KrakenState.CHASING: {
        this.surfedDuringChase += distanceDelta;

        // Pressure scales with difficulty; clean surfing pushes it back.
        const drain = BALANCE.kraken.drainPerSecond * (0.75 + difficulty * 0.75);
        this.gap -= drain * dt;
        this.gap += BALANCE.kraken.recoverPerSecond * dt;

        if (ctx.seedOrb) {
          this.gap = clamp(this.gap + BALANCE.kraken.orbBonus, 0, 100);
          raised.push({ type: 'orb' });
        }

        if (ctx.hit) {
          this.gap = clamp(this.gap - BALANCE.kraken.hitPenalty, 0, 100);
        }

        if (this.surfedDuringChase >= BALANCE.kraken.escapeDistance) {
          this.escapes++;
          this.state = KrakenState.RETREATING;
          this.timeInState = 0;
          raised.push({ type: 'escaped' });
        } else if (this.gap <= 0) {
          this.catches++;
          this.state = KrakenState.RETREATING;
          this.timeInState = 0;
          raised.push({ type: 'caught' });
        }
        break;
      }

      case KrakenState.RETREATING: {
        this.gap = Math.min(100, this.gap + 55 * dt);
        if (this.timeInState >= 2.2) {
          this.state = KrakenState.IDLE;
          this.timeInState = 0;
          this.distanceToNext = this.enabled ? this.interval : Infinity;
          raised.push({ type: 'clear' });
        }
        break;
      }
      default:
        break;
    }

    for (const event of raised) this.events.push(event);
    return raised;
  }

  /** Skip straight into a chase (used by Practice Mode preview / debugging). */
  forceStart() {
    if (this.state !== KrakenState.IDLE) return false;
    this.state = KrakenState.WARNING;
    this.timeInState = 0;
    this.events.push({ type: 'warning' });
    return true;
  }

  flushEvents() {
    if (this.events.length === 0) return [];
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }
}
