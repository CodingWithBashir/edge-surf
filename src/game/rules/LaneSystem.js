/**
 * Lane bookkeeping and lateral movement.
 *
 * Movement is an exponential approach toward a target lane x with a hard cap
 * on lateral speed, which keeps lane changes snappy at 60 FPS and identical at
 * 144 FPS (frame-rate independent) while still feeling "surfy".
 */

import { BALANCE } from '../config/Content.js';
import { clamp, damp, moveTowards } from '../../core/MathUtils.js';

export class LaneSystem {
  /** @param {number} [count] @param {number} [width] */
  constructor(count = BALANCE.lane.count, width = BALANCE.lane.width) {
    this.count = count;
    this.width = width;
    /** @type {number[]} world x position for each lane index */
    this.positions = [];
    this._build();
    this.reset();
  }

  _build() {
    this.positions.length = 0;
    const offset = ((this.count - 1) * this.width) / 2;
    for (let i = 0; i < this.count; i++) this.positions.push(i * this.width - offset);
  }

  configure(count, width = this.width) {
    const changed = count !== this.count || width !== this.width;
    this.count = count;
    this.width = width;
    if (changed) this._build();
    this.reset();
  }

  reset(lane = null) {
    this.index = lane == null ? Math.floor(this.count / 2) : clamp(lane, 0, this.count - 1);
    this.targetIndex = this.index;
    this.x = this.laneX(this.index);
    this.targetX = this.x;
    this.velocityX = 0;
  }

  laneX(index) {
    const i = clamp(index, 0, this.count - 1);
    return this.positions[Math.round(i)];
  }

  /** Nearest lane index for a world x (used by moving hazards and particles). */
  nearestIndex(x) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.count; i++) {
      const d = Math.abs(this.positions[i] - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** @returns {boolean} true when the lane actually changed */
  move(direction) {
    const next = clamp(this.targetIndex + direction, 0, this.count - 1);
    if (next === this.targetIndex) return false;
    this.targetIndex = next;
    this.targetX = this.laneX(next);
    return true;
  }

  setLane(index) {
    const next = clamp(Math.round(index), 0, this.count - 1);
    this.targetIndex = next;
    this.targetX = this.laneX(next);
  }

  /** Snap instantly (used on respawn / restart). */
  snapTo(index) {
    this.index = clamp(index, 0, this.count - 1);
    this.targetIndex = this.index;
    this.x = this.laneX(this.index);
    this.targetX = this.x;
    this.velocityX = 0;
  }

  /**
   * @param {number} dt
   * @param {number} [speedScale] scales lateral agility (boost feels twitchier)
   * @returns {number} lateral velocity this frame
   */
  update(dt, speedScale = 1) {
    const previous = this.x;
    const maxSpeed = BALANCE.lane.maxLateralSpeed * speedScale;
    let next = damp(this.x, this.targetX, BALANCE.lane.damp, dt);
    next = moveTowards(this.x, next, maxSpeed * dt);
    this.x = next;
    this.velocityX = dt > 0 ? (this.x - previous) / dt : 0;
    this.index = this.nearestIndex(this.x);
    return this.velocityX;
  }

  /** Normalised lean (-1..1) derived from lateral motion — drives animation. */
  get lean() {
    return clamp(this.velocityX / BALANCE.lane.maxLateralSpeed, -1, 1);
  }

  /** How many lanes the board can cross in `seconds`. */
  reachableLanes(seconds) {
    return Math.floor((BALANCE.lane.maxLateralSpeed * seconds) / this.width);
  }
}
