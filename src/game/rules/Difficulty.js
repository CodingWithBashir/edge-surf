/**
 * Difficulty curve.
 *
 * A single normalised `difficulty` value (0..1) drives speed, hazard density,
 * spawn spacing and the Kraken's pressure, so every system stays in sync.
 */

import { clamp, clamp01, lerp } from '../../core/MathUtils.js';

export const SPEED = Object.freeze({
  base: 20.5, // m/s at difficulty 0
  max: 62, // m/s at difficulty 1 (capped by the mode's speedScale)
  /** Distance at which the curve reaches ~63% of its range. */
  rampDistance: 2100,
});

/** Normalised difficulty from distance travelled. */
export function computeDifficulty(distance, cap = 1) {
  const raw = 1 - Math.exp(-Math.max(0, distance) / SPEED.rampDistance);
  return clamp01(Math.min(raw, cap));
}

/** Forward speed in world units per second. */
export function computeSpeed(difficulty, speedScale = 1, boostFactor = 1) {
  return lerp(SPEED.base, SPEED.max, clamp01(difficulty)) * speedScale * boostFactor;
}

/** Seconds of clear water between hazard groups. */
export function computeGapTime(difficulty) {
  return lerp(0.95, 0.52, clamp01(difficulty));
}

/** Metres between hazard groups (speed aware so reaction time is preserved). */
export function computeGapDistance(difficulty, speed, hazardScale = 1) {
  const time = computeGapTime(difficulty) / clamp(hazardScale, 0.5, 1.8);
  return Math.max(12.5, speed * time);
}

/** Expected number of hazards inside a single group. */
export function computeHazardCount(difficulty, hazardScale = 1) {
  return clamp(lerp(0.95, 2.7, clamp01(difficulty)) * hazardScale, 0, 4.2);
}

/** Chance that a group is a scripted formation rather than loose hazards. */
export function formationChance(difficulty) {
  return clamp01(lerp(0.12, 0.42, clamp01(difficulty)));
}

/** Chance that a group contains a power-up. */
export function powerUpChance(difficulty, powerupScale = 1) {
  return clamp01(lerp(0.055, 0.085, clamp01(difficulty)) * powerupScale);
}

/** Human readable difficulty band used by the HUD. */
export function difficultyLabel(difficulty) {
  const d = clamp01(difficulty);
  if (d < 0.16) return 'Glassy';
  if (d < 0.34) return 'Ankle high';
  if (d < 0.54) return 'Shoulder high';
  if (d < 0.72) return 'Overhead';
  if (d < 0.88) return 'Big swell';
  return 'Huge';
}

/**
 * One-shot evaluation of every derived difficulty value for a frame.
 * Called once per update so the numbers can never drift apart.
 */
export function evaluate(distance, config, boostFactor = 1, extraCap = null) {
  const cap = extraCap == null ? config.difficultyCap : Math.min(config.difficultyCap, extraCap);
  const difficulty = computeDifficulty(distance, cap);
  const speed = computeSpeed(difficulty, config.speedScale, boostFactor);
  return {
    difficulty,
    speed,
    gapTime: computeGapTime(difficulty),
    gapDistance: computeGapDistance(difficulty, speed, config.hazardScale),
    hazardCount: computeHazardCount(difficulty, config.hazardScale),
    powerUpChance: powerUpChance(difficulty, config.powerupScale),
    formationChance: formationChance(difficulty),
    label: difficultyLabel(difficulty),
  };
}
