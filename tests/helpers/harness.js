/**
 * Headless gameplay harness.
 *
 * three.js only needs a GPU for `WebGLRenderer`; geometry, scene graph and
 * maths all run in Node. That lets the test suite drive the *real* systems
 * (spawn director, streaming, collision, scoring, power-ups, Kraken AI) at
 * fixed 60 Hz timesteps without a browser.
 */

import * as THREE from 'three';
import { Ocean } from '../../src/game/three/Ocean.js';
import { Player } from '../../src/game/three/Player.js';
import { ObstacleManager, SPAWN_AHEAD } from '../../src/game/three/ObstacleManager.js';
import { CollectibleManager } from '../../src/game/three/CollectibleManager.js';
import { SpawnDirector } from '../../src/game/rules/SpawnDirector.js';
import { ScoreManager } from '../../src/game/rules/ScoreManager.js';
import { PowerUpManager } from '../../src/game/rules/PowerUpManager.js';
import { KrakenAI } from '../../src/game/rules/KrakenAI.js';
import * as Difficulty from '../../src/game/rules/Difficulty.js';
import { buildRunConfig } from '../../src/game/config/Modes.js';
import { HAZARD_BEHAVIOUR } from '../../src/game/config/Content.js';

export const FIXED_DT = 1 / 60;

/**
 * @param {{modeId?:string, seed?:number, date?:Date, quality?:string}} [options]
 */
export function createHarness(options = {}) {
  const config = buildRunConfig(options.modeId ?? 'endless', {
    seed: options.seed ?? 20261011,
    date: options.date ?? new Date('2026-10-11T00:00:00Z'),
  });

  const scene = new THREE.Group();
  const ocean = new Ocean({ quality: options.quality ?? 'low' });
  const player = new Player(scene, { quality: 'low' });
  player.reset(config.lanes);

  const obstacles = new ObstacleManager(scene, { quality: 'low' });
  const collectibles = new CollectibleManager(scene, { quality: 'low' });
  const director = new SpawnDirector(player.lanes, config.seed);
  obstacles.attach(director, ocean);

  const score = new ScoreManager();
  score.reset(config);
  const powerUps = new PowerUpManager();
  const kraken = new KrakenAI();
  kraken.configure(config);
  kraken.reset();

  const state = {
    config,
    scene,
    ocean,
    player,
    obstacles,
    collectibles,
    director,
    score,
    powerUps,
    kraken,
    lives: config.lives,
    time: 0,
    hits: 0,
    collected: { coin: 0, shell: 0, pear: 0, pearl: 0, escapeOrb: 0 },
    powerUpsTaken: 0,
    krakenEvents: [],
    /** Set by the autopilot each frame. */
    wantJump: false,
    wantDuck: false,
    wantLane: player.lanes.index,
    _vector: new THREE.Vector3(),
  };

  /** Advance one fixed step. Returns a summary of what happened. */
  state.step = (dt = FIXED_DT) => {
    state.time += dt;
    const tuning = Difficulty.evaluate(score.distance, config, powerUps.boostFactor);
    const speed = player.alive ? tuning.speed : 6;
    const travel = speed * dt;
    state.currentSpeed = speed;

    score.update(dt, speed);
    score.setMultiplierBonus(powerUps.multiplierBonus);

    const created = obstacles.stream(travel, tuning.gapDistance, tuning.difficulty, {
      gapTime: tuning.gapTime,
      hazardCount: tuning.hazardCount,
      powerUpChance: tuning.powerUpChance,
      formationChance: tuning.formationChance,
    }, { chase: kraken.isChasing });
    for (const group of created) collectibles.spawnGroup(group, -SPAWN_AHEAD);

    obstacles.update(dt, travel, player.surfaceY);

    if (player.alive) {
      if (state.wantJump) player.requestJump();
      player.setCrouch(state.wantDuck);
      player.lanes.setLane(state.wantLane);
    }
    player.update(dt, { ocean, speed01: Math.min(1, speed / Difficulty.SPEED.max) });

    const pv = state._vector.set(player.x, player.y, player.z);

    let hit = null;
    if (player.alive) {
      const query = obstacles.query(pv, player.crouching, player.airborne);
      for (const hazard of query.passed) {
        score.registerObstaclePassed();
        if (hazard.clearedByJump) score.registerHop();
      }
      if (query.nearMiss) score.registerNearMiss();
      if (query.hit) {
        hit = query.hit;
        if (!powerUps.consumeShield()) {
          if (player.takeHit()) {
            state.hits++;
            score.registerHit();
            if (config.lives > 0) state.lives = Math.max(0, state.lives - 1);
          }
        }
      }
    } else if (player.wipeoutComplete) {
      player.revive();
    }

    const pickedUp = collectibles.update(dt, travel, state.time, pv, powerUps.magnetRadius);
    let gotOrb = false;
    for (const item of pickedUp) {
      if (item.type === 'powerup') {
        powerUps.activate(item.id);
        score.registerPowerUp();
        state.powerUpsTaken++;
      } else {
        score.collect(item.type);
        state.collected[item.type] = (state.collected[item.type] ?? 0) + 1;
        if (item.type === 'escapeOrb') gotOrb = true;
      }
    }

    const events = kraken.update(dt, {
      distanceDelta: travel,
      difficulty: tuning.difficulty,
      seedOrb: gotOrb,
      hit: !!hit,
    });
    for (const event of events) state.krakenEvents.push({ ...event, at: score.distance });

    for (const event of powerUps.update(dt)) state.lastPowerUpEvent = event;
    player.setShield(powerUps.isActive('shield'));
    ocean.update(dt, travel);

    return { speed, tuning, hit, pickedUp, events };
  };

  /**
   * A simple autopilot: score every lane by the threats in it, steer to the
   * safest one, and time jumps / ducks from the actual time-to-impact rather
   * than a raw distance. It exists so the suite can play whole runs
   * unattended — and so a regression that makes the course unfair (too little
   * reaction time, unclearable jumps) shows up as a failed test.
   */
  state.autopilot = () => {
    if (!player.alive) {
      state.wantJump = false;
      state.wantDuck = false;
      return;
    }
    const lanes = player.lanes;
    const speed = Math.max(6, state.currentSpeed ?? Difficulty.SPEED.base);
    const NEAR = 60;
    const playerHalf = 0.45;

    // --- lane scoring ---------------------------------------------------
    const danger = new Array(lanes.count).fill(0);
    for (const hazard of obstacles.live) {
      const ahead = player.z - hazard.z;
      if (ahead < -3 || ahead > NEAR) continue;
      const halfSpan =
        (hazard.span > 1 ? (lanes.width * hazard.span) / 2 : lanes.width / 2) + playerHalf;
      for (let lane = 0; lane < lanes.count; lane++) {
        if (Math.abs(lanes.laneX(lane) - hazard.x) > halfSpan) continue;
        if (hazard.def.behaviour === HAZARD_BEHAVIOUR.DODGE) {
          // Unavoidable by jumping: always weight it heavily.
          danger[lane] = Math.max(danger[lane], 100 - ahead * 0.35);
        } else {
          danger[lane] = Math.max(danger[lane], 26 - ahead * 0.12);
        }
      }
    }

    let best = state.wantLane ?? lanes.index;
    if (best < 0 || best >= lanes.count) best = lanes.index;
    // Bias toward the committed lane so the surfer does not dither.
    let bestScore = danger[best] + Math.abs(best - lanes.index) * 3 - 1.5;
    for (let lane = 0; lane < lanes.count; lane++) {
      const score = danger[lane] + Math.abs(lane - lanes.index) * 3;
      if (score < bestScore - 0.75) {
        bestScore = score;
        best = lane;
      }
    }
    state.wantLane = best;

    // --- jump / duck timing ---------------------------------------------
    // A jump lasts ~0.52 s and is above hazard height between ~0.09 s and
    // ~0.47 s after take-off, so take off when impact is ~0.28 s away.
    // The swept path matters: the surfer passes *through* intermediate lanes
    // on the way to the target, so anything in between has to be considered.
    let shouldJump = false;
    let shouldDuck = false;
    const targetX = lanes.laneX(best);
    const sweepMin = Math.min(player.x, targetX) - playerHalf;
    const sweepMax = Math.max(player.x, targetX) + playerHalf;

    for (const hazard of obstacles.live) {
      const ahead = player.z - hazard.z;
      if (ahead < -1.5 || ahead > NEAR) continue;
      const halfSpan = hazard.span > 1 ? (lanes.width * hazard.span) / 2 : lanes.width / 2;
      if (hazard.x + halfSpan < sweepMin || hazard.x - halfSpan > sweepMax) continue;
      const tta = ahead / speed;
      if (hazard.def.behaviour === HAZARD_BEHAVIOUR.JUMP) {
        if (tta <= 0.3 && tta >= 0.1) shouldJump = true;
      } else if (hazard.def.behaviour === HAZARD_BEHAVIOUR.DUCK) {
        if (tta <= 0.34 && tta >= -0.12) shouldDuck = true;
      }
    }

    state.wantJump = shouldJump && player.jump.grounded;
    state.wantDuck = shouldDuck && !player.airborne;
  };

  /** Put the surfer back on the board and restore the life counter. */
  state.revive = () => {
    state.player.revive();
    if (config.lives > 0) state.lives = config.lives;
  };

  /**
   * Run `seconds` of simulated play.
   * @param {number} seconds
   * @param {{drive?:boolean, immortal?:boolean}} [options]
   */
  state.run = (seconds, { drive = true, immortal = false } = {}) => {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      if (drive) state.autopilot();
      state.step();
      if (!state.player.alive && state.player.wipeoutComplete) state.revive();
      if (state.lives <= 0 && config.lives > 0) {
        if (immortal) state.revive();
        else break;
      }
    }
    return state;
  };

  return state;
}
