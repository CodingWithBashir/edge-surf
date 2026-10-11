/**
 * Scoring, combo multiplier and per-run statistics.
 *
 * Pure data + arithmetic: no renderer, no DOM. The Game feeds it events, the
 * HUD and SaveManager read from it.
 */

import { BALANCE, COLLECTIBLES } from '../config/Content.js';
import { clamp01 } from '../../core/MathUtils.js';

const TIERS = BALANCE.score.comboTiers;

/** Score multiplier granted by the current combo tier. */
export function comboMultiplier(combo) {
  let multiplier = 1;
  for (const tier of TIERS) {
    if (combo >= tier.combo) multiplier = tier.multiplier;
  }
  return multiplier;
}

/** Combo needed to reach the next multiplier tier (null at the top tier). */
export function nextTier(combo) {
  for (const tier of TIERS) {
    if (combo < tier.combo) return tier;
  }
  return null;
}

export class ScoreManager {
  constructor() {
    this.reset({ recordScore: true, modeId: 'endless' });
  }

  /** @param {{modeId?:string, recordScore?:boolean}} [config] */
  reset(config = {}) {
    this.config = config;
    this.modeId = config.modeId ?? 'endless';
    this.recordScore = config.recordScore !== false;

    this.score = 0;
    this.distance = 0;
    this.coins = 0;
    this.walletCoins = 0; // coins banked toward unlocks
    this.shells = 0;
    this.pearls = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.bestMultiplier = 1;
    this.jumps = 0;
    this.landings = 0;
    this.nearMisses = 0;
    this.obstaclesPassed = 0;
    this.hits = 0;
    this.powerUpsTaken = 0;
    this.krakenEscapes = 0;
    this.topSpeed = 0;
    this.cleanDistance = 0;
    this.bestCleanDistance = 0;
    this.time = 0;

    this._multiplierBonus = 0;
    this._distancePoints = 0;
    this._pickupPoints = 0;
    this._bonusPoints = 0;
    this._eventPoints = 0;
  }

  /** Extra multiplier granted by the Score x2 power-up. */
  setMultiplierBonus(bonus) {
    this._multiplierBonus = bonus;
  }

  get multiplier() {
    const value = comboMultiplier(this.combo) + this._multiplierBonus;
    this.bestMultiplier = Math.max(this.bestMultiplier, value);
    return value;
  }

  get tierProgress() {
    const current = comboMultiplier(this.combo);
    const next = nextTier(this.combo);
    if (!next) return 1;
    const previous = TIERS.filter((t) => t.combo <= this.combo).pop() ?? TIERS[0];
    return clamp01((this.combo - previous.combo) / (next.combo - previous.combo));
  }

  /**
   * Advance the run.
   * @param {number} dt seconds
   * @param {number} speed world units / second
   */
  update(dt, speed) {
    const metres = speed * dt;
    this.distance += metres;
    this.cleanDistance += metres;
    this.time += dt;
    if (speed > this.topSpeed) this.topSpeed = speed;
    const gained = metres * BALANCE.score.perMetre * this.multiplier;
    this._distancePoints += gained;
    this.score += gained;
  }

  /** @param {'coin'|'shell'|'pearl'|'escapeOrb'} type */
  collect(type, count = 1) {
    const def = COLLECTIBLES[type];
    if (!def) return 0;
    const points = def.score * count * this.multiplier;
    this._pickupPoints += points;
    this.score += points;

    if (type === 'coin') {
      this.coins += count;
      this.walletCoins += def.value * count;
    } else if (type === 'shell') {
      this.shells += count;
      this.walletCoins += def.value * count;
    } else if (type === 'pearl') {
      this.pearls += count;
      this.walletCoins += def.value * count;
    } else if (type === 'escapeOrb') {
      this._eventPoints += points;
    }

    this.combo += count;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    return points;
  }

  registerJump() {
    this.jumps++;
  }

  registerLanding() {
    this.landings++;
  }

  /** Successfully cleared a hazard (jumped, ducked or steered past). */
  registerObstaclePassed() {
    this.obstaclesPassed++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
  }

  registerNearMiss() {
    this.nearMisses++;
    const points = BALANCE.score.nearMiss * this.multiplier;
    this._bonusPoints += points;
    this.score += points;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
  }

  /** Cleared a hazard by jumping over it — small style bonus. */
  registerHop() {
    const points = BALANCE.score.hopBonus * this.multiplier;
    this._bonusPoints += points;
    this.score += points;
  }

  registerPowerUp() {
    this.powerUpsTaken++;
  }

  registerKrakenEscape() {
    this.krakenEscapes++;
    const points = 2500 * this.multiplier;
    this._eventPoints += points;
    this.score += points;
  }

  /** The player wiped out: bank the clean streak and drop the combo. */
  registerHit() {
    this.hits++;
    this.bestCleanDistance = Math.max(this.bestCleanDistance, this.cleanDistance);
    this.cleanDistance = 0;
    this.combo = 0;
  }

  /** Called once when a run ends: bank the final clean streak. */
  finalise() {
    this.bestCleanDistance = Math.max(this.bestCleanDistance, this.cleanDistance);
  }

  /** Flat award (time-trial completion, zigzag goal, …). */
  award(points) {
    const value = points * this.multiplier;
    this._eventPoints += value;
    this.score += value;
    return value;
  }

  /** Snapshot used by the results screen and persistence. */
  snapshot() {
    return {
      modeId: this.modeId,
      score: Math.floor(this.score),
      distance: Math.floor(this.distance),
      coins: this.coins,
      walletCoins: this.walletCoins,
      shells: this.shells,
      pearls: this.pearls,
      combo: this.bestCombo,
      bestMultiplier: this.bestMultiplier,
      jumps: this.jumps,
      landings: this.landings,
      nearMisses: this.nearMisses,
      obstaclesPassed: this.obstaclesPassed,
      hits: this.hits,
      powerUpsTaken: this.powerUpsTaken,
      krakenEscapes: this.krakenEscapes,
      topSpeed: this.topSpeed,
      bestCleanDistance: Math.floor(this.bestCleanDistance),
      cleanDistance: Math.floor(this.cleanDistance),
      time: this.time,
      breakdown: {
        distance: Math.floor(this._distancePoints),
        pickups: Math.floor(this._pickupPoints),
        bonus: Math.floor(this._bonusPoints),
        events: Math.floor(this._eventPoints),
      },
    };
  }
}
