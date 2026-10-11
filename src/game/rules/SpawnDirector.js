/**
 * Spawn planning.
 *
 * Pure logic: given a difficulty snapshot it emits the *plan* for the next
 * hazard group — which hazards go in which lanes, where the coin trails arc and
 * whether a power-up appears. Planning is separated from mesh construction so
 * the important guarantee ("there is always a lane you can actually reach in
 * time") can be unit tested without a renderer.
 *
 * All `dz` values are offsets from the group origin. The ObstacleManager places
 * the group at the far end of the course and lets it stream toward the player.
 */

import { HAZARDS, HAZARD_LIST, POWERUP_LIST, COLLECTIBLES, BALANCE, HAZARD_BEHAVIOUR } from '../config/Content.js';
import { Rng } from '../../core/Rng.js';

/** Minimum clear-water distance in front of the course start. */
export const SAFE_RUNWAY = 46;

let _hazardSerial = 0;
let _pickupSerial = 0;

export class SpawnDirector {
  /**
   * @param {import('./LaneSystem.js').LaneSystem} laneSystem
   * @param {number} seed
   */
  constructor(laneSystem, seed = 1) {
    this.lanes = laneSystem;
    this.rng = new Rng(seed);
    this.reset();
  }

  reset(seed = null) {
    if (seed != null) this.rng.reset(seed);
    else this.rng.reset();
    this.groupIndex = 0;
    this.groupsSincePowerUp = 0;
    /** Lanes the player could realistically have been in during the last group. */
    this._lastFree = this.lanes.positions.map((_, i) => i);
    this.stats = { hazards: 0, coins: 0, powerups: 0, formations: 0 };
  }

  /** World x for a lane index (delegates to the shared lane layout). */
  laneX(index) {
    return this.lanes.laneX(index);
  }

  /** World x for a hazard spanning `lane` .. `lane + span - 1`. */
  spanX(lane, span) {
    if (span <= 1) return this.laneX(lane);
    let sum = 0;
    for (let i = 0; i < span; i++) sum += this.laneX(lane + i);
    return sum / span;
  }

  /**
   * Lanes the player can reach from the previous group's free lanes within the
   * time between groups.
   * @param {number} gapTime seconds between groups
   */
  _reachableLanes(gapTime) {
    const maxShift = Math.max(1, this.lanes.reachableLanes(gapTime));
    const all = [];
    for (let i = 0; i < this.lanes.count; i++) all.push(i);
    const reachable = all.filter((lane) => this._lastFree.some((free) => Math.abs(free - lane) <= maxShift));
    return reachable.length ? reachable : all;
  }

  /**
   * Weighted hazard pick respecting the difficulty gate and the number of
   * lanes still available in this group.
   * @param {number} difficulty
   * @param {number} spanLimit max lanes this hazard may occupy
   */
  _pickHazard(difficulty, spanLimit) {
    const pool = HAZARD_LIST.filter(
      (h) => !h.formationOnly && h.minDifficulty <= difficulty + 1e-6 && h.lanes <= spanLimit
    );
    if (!pool.length) return null;
    return this.rng.weighted(pool);
  }

  /**
   * Build the next hazard group.
   *
   * @param {number} difficulty 0..1
   * @param {{gapTime:number, hazardCount:number, powerUpChance:number, formationChance:number}} tuning
   * @param {{chase?:boolean}} [options]
   * @returns {{hazards:any[], collectibles:any[], powerup:any|null, freeLanes:number[]}}
   */
  createGroup(difficulty, tuning, options = {}) {
    const laneCount = this.lanes.count;
    const group = { hazards: [], collectibles: [], powerup: null, freeLanes: [] };

    // --- reserve one lane the player can definitely be in ------------------
    const reachable = this._reachableLanes(tuning.gapTime);
    const reserved = this.rng.pick(reachable);
    const occupied = new Set();

    const canOccupy = (lane, span) => {
      for (let i = 0; i < span; i++) {
        const l = lane + i;
        if (l < 0 || l >= laneCount) return false;
        if (l === reserved) return false;
        if (occupied.has(l)) return false;
      }
      return true;
    };

    const occupy = (def, lane, span, extra = {}) => {
      for (let i = 0; i < span; i++) occupied.add(lane + i);
      group.hazards.push(this._makeHazard(def, lane, span, extra));
    };

    // --- scripted formations ----------------------------------------------
    const useFormation = this.rng.chance(tuning.formationChance) && difficulty > 0.12;
    if (useFormation) {
      this.stats.formations++;
      this._buildFormation(group, difficulty, reserved, canOccupy, occupy);
    }

    // --- loose hazards -----------------------------------------------------
    let target = Math.floor(tuning.hazardCount) + (this.rng.chance(tuning.hazardCount % 1) ? 1 : 0);
    target = Math.min(target, laneCount - 1); // always leave one lane open
    for (let attempt = 0; attempt < target; attempt++) {
      const remaining = laneCount - 1 - occupied.size; // one lane must stay open
      if (remaining <= 0) break;
      const def = this._pickHazard(difficulty, remaining);
      if (!def) break;

      const span = Math.min(def.lanes, remaining);
      const start = this._findSpan(laneCount, span, canOccupy);
      if (start == null) continue;
      occupy(def, start, span);
    }

    // --- record which lanes are actually free ------------------------------
    const freeLanes = [];
    for (let i = 0; i < laneCount; i++) if (!occupied.has(i)) freeLanes.push(i);
    group.freeLanes = freeLanes;
    this._lastFree = freeLanes.length ? freeLanes : [reserved];

    // --- rewards -----------------------------------------------------------
    this._addCollectibles(group, difficulty, freeLanes, options);
    this._maybeAddPowerUp(group, tuning, freeLanes, difficulty);

    this.groupIndex++;
    return group;
  }

  /** Find a valid start lane for a hazard occupying `span` consecutive lanes. */
  _findSpan(laneCount, span, canOccupy) {
    const starts = [];
    for (let i = 0; i + span <= laneCount; i++) {
      if (canOccupy(i, span)) starts.push(i);
    }
    if (!starts.length) return null;
    return this.rng.pick(starts);
  }

  _makeHazard(def, lane, span, extra = {}) {
    const spread = def.lanes > 1 ? 1 : 0.35;
    const hazard = {
      uid: ++_hazardSerial,
      id: def.id,
      def,
      lane,
      span,
      x: this.spanX(lane, span),
      dz: this.rng.range(-1.1, 1.1) * spread,
      scale: this.rng.range(0.88, 1.14),
      yaw: this.rng.range(0, Math.PI * 2),
      moving: !!def.moving,
      moveAmp: def.moveAmp ?? 0,
      moveSpeed: def.moveSpeed ?? 0,
      phase: this.rng.range(0, Math.PI * 2),
      baseX: this.spanX(lane, span),
      ...extra,
    };
    this.stats.hazards++;
    return hazard;
  }

  /**
   * Scripted patterns. Each keeps `reserved` clear so the run stays fair.
   */
  _buildFormation(group, difficulty, reserved, canOccupy, occupy) {
    const laneCount = this.lanes.count;
    const roll = this.rng.next();
    const rock = HAZARDS.rock;

    if (difficulty > 0.2 && roll < 0.3) {
      // Narrow passage: rocks everywhere but one lane.
      for (let i = 0; i < laneCount; i++) {
        if (i === reserved) continue;
        if (canOccupy(i, 1)) occupy(rock, i, 1);
      }
      return;
    }

    if (roll < 0.55) {
      // Log line: a wall of jumpable timber across two or three lanes.
      const log = HAZARDS.log;
      const span = Math.min(this.rng.int(2, 3), laneCount - 1);
      const start = this._findSpan(laneCount, span, canOccupy);
      if (start != null) {
        for (let i = 0; i < span; i++) occupy(log, start + i, 1, { dz: this.rng.range(-0.4, 0.4) });
      }
      return;
    }

    if (roll < 0.78) {
      // Whitewater wall plus a second hazard to force a lane commitment.
      const whitewater = HAZARDS.whitewater;
      const start = this._findSpan(laneCount, 2, canOccupy);
      if (start != null) occupy(whitewater, start, 2);
      const second = this._pickHazard(difficulty, laneCount - 1 - group.hazards.length);
      if (second) {
        const lane = this._findSpan(laneCount, Math.min(second.lanes, laneCount - 1), canOccupy);
        if (lane != null) occupy(second, lane, Math.min(second.lanes, laneCount - 1));
      }
      return;
    }

    // Gauntlet: alternating dodge / jump hazards down the line-up.
    const dodge = this.rng.chance(0.5) ? HAZARDS.rock : HAZARDS.buoy;
    const jumpable = this.rng.chance(0.5) ? HAZARDS.coral : HAZARDS.log;
    for (let i = 0; i < laneCount; i++) {
      if (i === reserved || !canOccupy(i, 1)) continue;
      occupy(i % 2 === 0 ? dodge : jumpable, i, 1);
    }
  }

  /**
   * Coin trails, shells and pearls.
   * Coins arc over jumpable hazards so jumping is actively rewarded.
   */
  _addCollectibles(group, difficulty, freeLanes, options) {
    const rng = this.rng;
    if (!freeLanes.length && !group.hazards.length) return;

    // Prefer arcing a trail over something jumpable.
    const jumpables = group.hazards.filter((h) => h.def.behaviour === HAZARD_BEHAVIOUR.JUMP);
    let arcHazard = null;
    if (jumpables.length && rng.chance(0.6)) arcHazard = rng.pick(jumpables);

    const trailCount = arcHazard ? 1 : rng.int(0, 1);
    for (let t = 0; t <= trailCount; t++) {
      const count = rng.int(4, 8);
      const spacing = 1.15;
      const startDz = -((count - 1) * spacing) / 2;

      let x;
      let arcHeight = 0.3;
      if (arcHazard && t === 0) {
        x = arcHazard.x;
        arcHeight = 2.55;
      } else if (freeLanes.length) {
        x = this.laneX(rng.pick(freeLanes));
      } else {
        continue;
      }

      for (let i = 0; i < count; i++) {
        const t01 = count === 1 ? 0.5 : i / (count - 1);
        group.collectibles.push({
          uid: ++_pickupSerial,
          type: 'coin',
          x,
          y: 0.85 + arcHeight * Math.sin(Math.PI * t01),
          dz: startDz + i * spacing,
          def: COLLECTIBLES.coin,
        });
        this.stats.coins++;
      }

      // A nicer prize at the end of the trail.
      if (rng.chance(0.16)) {
        group.collectibles.push({
          uid: ++_pickupSerial,
          type: 'shell',
          x,
          y: 1.0,
          dz: startDz + count * spacing,
          def: COLLECTIBLES.shell,
        });
      } else if (rng.chance(0.045)) {
        group.collectibles.push({
          uid: ++_pickupSerial,
          type: 'pearl',
          x,
          y: 1.0,
          dz: startDz + count * spacing,
          def: COLLECTIBLES.pearl,
        });
      }
    }

    // Kraken chases drop escape orbs that push the creature back.
    if (options.chase && freeLanes.length && rng.chance(0.55)) {
      group.collectibles.push({
        uid: ++_pickupSerial,
        type: 'escapeOrb',
        x: this.laneX(rng.pick(freeLanes)),
        y: 1.15,
        dz: rng.range(-2, 2),
        def: COLLECTIBLES.escapeOrb,
      });
    }
  }

  _maybeAddPowerUp(group, tuning, freeLanes, difficulty) {
    this.groupsSincePowerUp++;
    if (!freeLanes.length) return;
    if (this.groupsSincePowerUp < 4) return;
    if (!this.rng.chance(tuning.powerUpChance)) return;

    const def = this.rng.weighted(POWERUP_LIST);
    group.powerup = {
      uid: ++_pickupSerial,
      id: def.id,
      def,
      x: this.laneX(this.rng.pick(freeLanes)),
      y: 1.3,
      dz: 0,
    };
    this.groupsSincePowerUp = 0;
    this.stats.powerups++;
  }
}
