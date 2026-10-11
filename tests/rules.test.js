/**
 * Unit tests for the pure gameplay rules.
 * Run with: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Rng, seedFromDate } from '../src/core/Rng.js';
import { clamp, damp, formatDistance, formatNumber } from '../src/core/MathUtils.js';
import { ObjectPool, PoolGroup } from '../src/core/ObjectPool.js';
import { StateMachine, GameState } from '../src/core/StateMachine.js';
import { EventBus } from '../src/core/EventBus.js';

import { LaneSystem } from '../src/game/rules/LaneSystem.js';
import { JumpPhysics } from '../src/game/rules/JumpPhysics.js';
import * as CollisionSystem from '../src/game/rules/CollisionSystem.js';
import * as Difficulty from '../src/game/rules/Difficulty.js';
import { ScoreManager, comboMultiplier } from '../src/game/rules/ScoreManager.js';
import { PowerUpManager } from '../src/game/rules/PowerUpManager.js';
import { KrakenAI, KrakenState } from '../src/game/rules/KrakenAI.js';
import { SpawnDirector } from '../src/game/rules/SpawnDirector.js';

import { BALANCE, HAZARDS, HAZARD_LIST, HAZARD_BEHAVIOUR, POWERUPS } from '../src/game/config/Content.js';
import { buildRunConfig, MODES, MODE_LIST } from '../src/game/config/Modes.js';

/* ------------------------------------------------------------------ *
 * Core utilities
 * ------------------------------------------------------------------ */

test('Rng is deterministic for a given seed', () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  const c = new Rng(999);
  const seqA = Array.from({ length: 25 }, () => a.next());
  const seqB = Array.from({ length: 25 }, () => b.next());
  const seqC = Array.from({ length: 25 }, () => c.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const value of seqA) assert.ok(value >= 0 && value < 1, 'values stay in [0,1)');
});

test('Rng.reset restores the original sequence', () => {
  const rng = new Rng(7);
  const first = Array.from({ length: 10 }, () => rng.next());
  rng.reset();
  const second = Array.from({ length: 10 }, () => rng.next());
  assert.deepEqual(first, second);
});

test('Rng.sample returns unique members and respects count', () => {
  const rng = new Rng(3);
  const lanes = [0, 1, 2, 3, 4];
  for (let i = 0; i < 50; i++) {
    const picked = rng.sample(lanes, 3);
    assert.equal(picked.length, 3);
    assert.equal(new Set(picked).size, 3);
    for (const lane of picked) assert.ok(lanes.includes(lane));
  }
  assert.equal(rng.sample(lanes, 9).length, 5, 'never more than available');
});

test('seedFromDate is stable within a day and changes across days', () => {
  const morning = new Date('2026-10-11T02:30:00Z');
  const evening = new Date('2026-10-11T23:59:00Z');
  const tomorrow = new Date('2026-10-12T02:30:00Z');
  assert.equal(seedFromDate(morning), seedFromDate(evening));
  assert.notEqual(seedFromDate(morning), seedFromDate(tomorrow));
});

test('MathUtils behave as advertised', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatDistance(940), '940 m');
  assert.equal(formatDistance(1500), '1.50 km');
  // damp is frame-rate independent: two half steps ≈ one full step.
  const one = damp(0, 10, 4, 0.5);
  let two = 0;
  two = damp(two, 10, 4, 0.25);
  two = damp(two, 10, 4, 0.25);
  assert.ok(Math.abs(one - two) < 0.35, `${one} ≈ ${two}`);
});

test('ObjectPool recycles instances and never double-releases', () => {
  let created = 0;
  const pool = new ObjectPool(
    () => ({ id: created++ }),
    (obj) => {
      obj.reset = true;
    },
    2
  );
  assert.equal(pool.created, 2);
  const a = pool.acquire();
  const b = pool.acquire();
  const c = pool.acquire();
  assert.equal(pool.created, 3, 'grows on demand');
  assert.equal(pool.activeCount, 3);
  assert.equal(pool.release(a), true);
  assert.equal(a.reset, true, 'reset hook runs');
  assert.equal(pool.release(a), false, 'second release is a no-op');
  pool.releaseAll();
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.idleCount, 3);
  assert.equal(c.id, 2);
});

test('PoolGroup tracks its key and reports totals', () => {
  const group = new PoolGroup({
    rock: { factory: () => ({ kind: 'rock' }) },
    coin: { factory: () => ({ kind: 'coin' }) },
  });
  const rock = group.acquire('rock');
  const coin = group.acquire('coin');
  assert.equal(rock.poolKey, 'rock');
  assert.equal(group.activeCount, 2);
  group.release(coin);
  assert.equal(group.activeCount, 1);
  assert.equal(group.createdCount, 2);
});

test('StateMachine blocks illegal transitions and fires listeners once', () => {
  const sm = new StateMachine(GameState.MENU, {
    [GameState.MENU]: [GameState.PLAYING],
    [GameState.PLAYING]: [GameState.PAUSED, GameState.GAME_OVER],
  });
  let enters = 0;
  let exits = 0;
  sm.onEnter(GameState.PLAYING, () => enters++);
  sm.onExit(GameState.MENU, () => exits++);

  assert.equal(sm.change(GameState.RESULTS), false, 'undefined transition rejected');
  assert.equal(sm.change(GameState.PLAYING), true);
  assert.equal(enters, 1);
  assert.equal(exits, 1);
  assert.equal(sm.change(GameState.PAUSED), true);
  assert.equal(sm.change(GameState.PAUSED), false, 'same-state transition is a no-op');
  assert.equal(sm.previous, GameState.PLAYING);
  assert.equal(sm.is(GameState.PAUSED), true);
});

test('StateMachine survives a throwing listener', () => {
  const sm = new StateMachine('a');
  sm.onEnter('b', () => {
    throw new Error('boom');
  });
  let reached = false;
  sm.onEnter('b', () => {
    reached = true;
  });
  sm.change('b');
  assert.equal(reached, true, 'other listeners still run');
  assert.equal(sm.state, 'b');
});

test('EventBus delivers, unsubscribes and isolates handler errors', () => {
  const bus = new EventBus();
  const seen = [];
  const off = bus.on('coin', (value) => seen.push(value));
  bus.emit('coin', 1);
  off();
  bus.emit('coin', 2);
  assert.deepEqual(seen, [1]);
  bus.on('bad', () => {
    throw new Error('nope');
  });
  let ok = false;
  bus.on('bad', () => {
    ok = true;
  });
  bus.emit('bad');
  assert.equal(ok, true);
});

/* ------------------------------------------------------------------ *
 * Lanes
 * ------------------------------------------------------------------ */

test('LaneSystem lays out symmetric lanes and clamps movement', () => {
  const lanes = new LaneSystem(5, 2.3);
  assert.deepEqual(
    lanes.positions.map((x) => Math.round(x * 100) / 100),
    [-4.6, -2.3, 0, 2.3, 4.6]
  );
  lanes.reset();
  assert.equal(lanes.index, 2, 'starts in the middle');

  for (let i = 0; i < 10; i++) lanes.move(-1);
  assert.equal(lanes.targetIndex, 0, 'cannot leave the course on the left');
  for (let i = 0; i < 10; i++) lanes.move(1);
  assert.equal(lanes.targetIndex, 4, 'cannot leave the course on the right');
});

test('LaneSystem converges on the target and reports lean', () => {
  const lanes = new LaneSystem(5, 2.3);
  lanes.reset(0);
  lanes.move(1);
  for (let i = 0; i < 120; i++) lanes.update(1 / 60);
  assert.ok(Math.abs(lanes.x - lanes.laneX(1)) < 0.01, 'reaches the target lane');
  assert.equal(lanes.index, 1);

  lanes.reset(2);
  lanes.move(1);
  lanes.update(1 / 60);
  assert.ok(lanes.lean > 0, 'leaning while moving right');
  lanes.move(-1);
  lanes.move(-1);
  lanes.update(1 / 60);
  assert.ok(lanes.lean < 0, 'leaning while moving left');
});

test('LaneSystem reaches the same position at 30 and 144 fps', () => {
  const slow = new LaneSystem(5, 2.3);
  const fast = new LaneSystem(5, 2.3);
  slow.reset(0);
  fast.reset(0);
  slow.move(1);
  fast.move(1);
  for (let i = 0; i < 30; i++) slow.update(1 / 30);
  for (let i = 0; i < 144; i++) fast.update(1 / 144);
  assert.ok(Math.abs(slow.x - fast.x) < 0.05, `30fps ${slow.x} vs 144fps ${fast.x}`);
});

test('LaneSystem.reachableLanes grows with the time available', () => {
  const lanes = new LaneSystem(5, 2.3);
  assert.ok(lanes.reachableLanes(0.5) >= 3);
  assert.equal(lanes.reachableLanes(0), 0);
});

/* ------------------------------------------------------------------ *
 * Jump physics
 * ------------------------------------------------------------------ */

test('JumpPhysics produces a single, predictable arc', () => {
  const jump = new JumpPhysics();
  jump.reset(0);
  jump.request();
  assert.equal(jump.grounded, true, 'not airborne until the next update');

  jump.update(1 / 60, { waveLift: 0 });
  assert.equal(jump.justJumped, true);
  assert.equal(jump.grounded, false);

  let apex = 0;
  let frames = 0;
  while (!jump.grounded && frames < 600) {
    apex = Math.max(apex, jump.y);
    jump.update(1 / 60, { waveLift: 0 });
    frames++;
  }
  const expectedApex = (BALANCE.jump.velocity ** 2) / (2 * BALANCE.jump.gravity);
  assert.ok(Math.abs(apex - expectedApex) < 0.12, `apex ${apex} vs ${expectedApex}`);
  assert.ok(frames > 20 && frames < 90, `airtime ${frames} frames is playable`);
  assert.equal(jump.justLanded, true);
  assert.equal(jump.y, 0, 'lands back on the surface');
});

test('JumpPhysics cannot double jump in mid-air', () => {
  const jump = new JumpPhysics();
  jump.reset(0);
  jump.request();
  jump.update(1 / 60, { waveLift: 0 });
  const height = jump.y;
  jump.request();
  jump.update(1 / 60, { waveLift: 0 });
  assert.equal(jump.jumpCount, 1, 'only one jump per take-off');
  assert.ok(jump.y > height, 'still rising from the original jump');
});

test('JumpPhysics buffers an early press (coyote + buffer window)', () => {
  const jump = new JumpPhysics();
  jump.reset(0);
  // Press slightly before landing: the buffer survives until touchdown.
  jump.update(1 / 60, { waveLift: 0 });
  jump.launch(1);
  let guard = 0;
  while (!jump.grounded && guard++ < 600) jump.update(1 / 60, { waveLift: 0 });
  jump.request();
  jump.update(1 / 60, { waveLift: 0 });
  assert.equal(jump.grounded, false, 'buffered jump fires on landing');
  assert.equal(jump.jumpCount, 2);
});

test('JumpPhysics rides a rising water surface', () => {
  const jump = new JumpPhysics();
  jump.reset(0);
  jump.update(1 / 60, { waveLift: 0.4 });
  assert.ok(Math.abs(jump.y - 0.4) < 1e-6, 'the board follows the swell when grounded');
});

/* ------------------------------------------------------------------ *
 * Collision system
 * ------------------------------------------------------------------ */

const playerAt = (x, y, z) => ({ x, y, z });

test('box / cylinder / sphere primitives agree with hand-checked cases', () => {
  assert.equal(CollisionSystem.boxVsBox(0, 1, 0, 1, 0, 1, 0.5, 1.5, 0.5, 1.5, 0.5, 1.5), true);
  assert.equal(CollisionSystem.boxVsBox(0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3), false);

  // Cylinder radius 1 at the origin vs a box touching it at distance 0.5.
  assert.equal(CollisionSystem.cylinderVsBox(0, 0, 1, -1, 1, 0.5, 1.5, -1, 1, -1, 1), true);
  assert.equal(CollisionSystem.cylinderVsBox(0, 0, 1, -1, 1, 1.6, 2.6, -1, 1, -1, 1), false);
  // Vertically separated cylinders must not report a hit.
  assert.equal(CollisionSystem.cylinderVsBox(0, 0, 1, 5, 7, -1, 1, -1, 1, -1, 1), false);

  assert.equal(CollisionSystem.sphereVsBox(0, 0, 0, 1, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5), true);
  assert.equal(CollisionSystem.sphereVsBox(4, 0, 0, 1, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5), false);
});

test('player box shrinks when ducking', () => {
  const standing = CollisionSystem.playerBox(playerAt(0, 0, 0), false);
  const ducking = CollisionSystem.playerBox(playerAt(0, 0, 0), true);
  assert.equal(standing.height, BALANCE.player.standingHeight);
  assert.equal(ducking.height, BALANCE.player.crouchHeight);
  assert.ok(ducking.maxY < standing.maxY);
  assert.equal(standing.minX, -BALANCE.player.halfWidth);
  assert.ok(standing.minY >= 0, 'collider sits on the board');
});

test('every dodge hazard is too tall to jump, every jump hazard is clearable', () => {
  const apex = (BALANCE.jump.velocity ** 2) / (2 * BALANCE.jump.gravity);

  for (const hazard of HAZARD_LIST) {
    if (hazard.id === 'narrowPassage') continue; // formation-only, uses rock volumes
    const volumes = CollisionSystem.volumesOf(hazard);
    const top = Math.max(
      ...volumes.map((v) => (v.kind === 'box' ? v.y + v.half[1] : v.kind === 'cylinder' ? v.top : v.y + v.radius))
    );
    if (hazard.behaviour === HAZARD_BEHAVIOUR.JUMP) {
      assert.ok(top < apex - 0.15, `${hazard.id} top ${top} must clear apex ${apex.toFixed(2)}`);
    }
    if (hazard.behaviour === HAZARD_BEHAVIOUR.DODGE) {
      assert.ok(top > apex, `${hazard.id} top ${top} must NOT be jumpable (apex ${apex.toFixed(2)})`);
    }
    if (hazard.behaviour === HAZARD_BEHAVIOUR.DUCK) {
      const bottom = Math.min(
        ...volumes.map((v) => (v.kind === 'box' ? v.y - v.half[1] : v.kind === 'cylinder' ? v.bottom : v.y - v.radius))
      );
      assert.ok(bottom > BALANCE.player.crouchHeight, `${hazard.id} must clear a ducking surfer`);
      assert.ok(bottom < BALANCE.player.standingHeight, `${hazard.id} must hit a standing surfer`);
    }
  }
});

test('ducking clears overhead hazards and standing does not', () => {
  const driftwood = { def: HAZARDS.driftwood, x: 0, y: 0, z: 0, scale: 1 };
  const standing = CollisionSystem.hazardHitsPlayer(driftwood, playerAt(0, 0, 0), false);
  const ducking = CollisionSystem.hazardHitsPlayer(driftwood, playerAt(0, 0, 0), true);
  assert.equal(standing, true);
  assert.equal(ducking, false);
});

test('a jump clears low hazards and a grounded surfer does not', () => {
  const coral = { def: HAZARDS.coral, x: 0, y: 0, z: 0, scale: 1 };
  assert.equal(CollisionSystem.hazardHitsPlayer(coral, playerAt(0, 0, 0), false), true);
  assert.equal(CollisionSystem.hazardHitsPlayer(coral, playerAt(0, 1.4, 0), false), false);
});

test('lateral misses stay misses', () => {
  const rock = { def: HAZARDS.rock, x: 2.3, y: 0, z: 0, scale: 1 };
  assert.equal(CollisionSystem.hazardHitsPlayer(rock, playerAt(0, 0, 0), false), false);
  assert.equal(CollisionSystem.hazardHitsPlayer(rock, playerAt(2.3, 0, 0), false), true);
});

test('collectible pickup is generous but finite', () => {
  const player = playerAt(0, 0, 0);
  assert.equal(CollisionSystem.collectibleHitsPlayer({ x: 0, y: 0.9, z: 0 }, 0.62, player), true);
  assert.equal(CollisionSystem.collectibleHitsPlayer({ x: 0, y: 0.9, z: 25 }, 0.62, player), false);
  assert.equal(
    CollisionSystem.collectibleHitsPlayer({ x: 0, y: 0.9, z: 4.2 }, 0.62, player, 6),
    true,
    'the magnet widens the pickup'
  );
});

/* ------------------------------------------------------------------ *
 * Difficulty
 * ------------------------------------------------------------------ */

test('difficulty rises monotonically and respects the mode cap', () => {
  let previous = -1;
  for (let d = 0; d <= 20000; d += 250) {
    const value = Difficulty.computeDifficulty(d, 1);
    assert.ok(value >= previous, 'never goes backwards');
    previous = value;
  }
  assert.ok(Difficulty.computeDifficulty(0, 1) < 0.01);
  assert.ok(Difficulty.computeDifficulty(20000, 1) > 0.99);
  assert.ok(Difficulty.computeDifficulty(999999, 0.35) <= 0.3501, 'cap is honoured');
});

test('speed rises with difficulty and the boost multiplies it', () => {
  const slow = Difficulty.computeSpeed(0, 1, 1);
  const fast = Difficulty.computeSpeed(1, 1, 1);
  assert.ok(fast > slow);
  assert.ok(Math.abs(Difficulty.computeSpeed(0.5, 1, 1.55) - Difficulty.computeSpeed(0.5, 1, 1) * 1.55) < 1e-9);
});

test('gap distance keeps reaction time roughly constant as speed climbs', () => {
  for (const distance of [0, 1000, 4000, 12000]) {
    const difficulty = Difficulty.computeDifficulty(distance, 1);
    const speed = Difficulty.computeSpeed(difficulty, 1, 1);
    const gap = Difficulty.computeGapDistance(difficulty, speed, 1);
    const reaction = gap / speed;
    assert.ok(reaction > 0.45, `${reaction.toFixed(2)}s of reaction time at ${distance} m`);
    assert.ok(gap >= 12.5, 'minimum spacing floor');
  }
});

test('difficulty evaluate() returns one consistent snapshot', () => {
  const config = buildRunConfig('endless');
  const snapshot = Difficulty.evaluate(3000, config, 1);
  assert.ok(snapshot.difficulty >= 0 && snapshot.difficulty <= 1);
  assert.ok(snapshot.speed > 0);
  assert.ok(snapshot.gapDistance >= 12.5);
  assert.equal(typeof snapshot.label, 'string');
  assert.ok(snapshot.hazardCount > 0);
});

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

test('combo multipliers follow the defined tiers', () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(9), 1);
  assert.equal(comboMultiplier(10), 2);
  assert.equal(comboMultiplier(25), 3);
  assert.equal(comboMultiplier(50), 4);
  assert.equal(comboMultiplier(100), 5);
  assert.equal(comboMultiplier(10000), 5, 'capped');
});

test('ScoreManager accrues distance, pickups and resets the combo on a hit', () => {
  const score = new ScoreManager();
  score.reset({ modeId: 'endless' });

  score.update(1, 30);
  assert.equal(score.distance, 30);
  assert.ok(score.score > 0);

  score.collect('coin', 5);
  assert.equal(score.coins, 5);
  assert.equal(score.walletCoins, 50);
  assert.equal(score.combo, 5);

  const beforeHit = score.score;
  score.registerHit();
  assert.equal(score.combo, 0, 'combo drops on a wipeout');
  assert.equal(score.bestCleanDistance, 30, 'clean streak banked');
  assert.equal(score.cleanDistance, 0);
  assert.equal(score.score, beforeHit);

  score.update(1, 30);
  assert.ok(score.breakdown === undefined);
  assert.equal(score.snapshot().distance, 60);
});

test('ScoreManager multiplier combines combo tier and power-up bonus', () => {
  const score = new ScoreManager();
  score.reset({});
  score.collect('coin', 30);
  assert.equal(score.multiplier, 3);
  score.setMultiplierBonus(2);
  assert.equal(score.multiplier, 5);
  assert.equal(score.bestMultiplier, 5);
});

test('ScoreManager snapshot breaks the total down', () => {
  const score = new ScoreManager();
  score.reset({ modeId: 'endless' });
  score.update(10, 20);
  score.collect('coin', 3);
  score.registerNearMiss();
  score.registerKrakenEscape();
  const snapshot = score.snapshot();
  assert.ok(snapshot.breakdown.distance > 0);
  assert.ok(snapshot.breakdown.pickups > 0);
  assert.ok(snapshot.breakdown.bonus > 0);
  assert.ok(snapshot.breakdown.events > 0);
  assert.equal(snapshot.krakenEscapes, 1);
});

/* ------------------------------------------------------------------ *
 * Power-ups
 * ------------------------------------------------------------------ */

test('power-up timers expire exactly once', () => {
  const powerUps = new PowerUpManager();
  powerUps.activate('magnet');
  assert.equal(powerUps.isActive('magnet'), true);
  assert.equal(powerUps.magnetActive, true);

  let expired = 0;
  for (let i = 0; i < 700; i++) {
    for (const event of powerUps.update(1 / 60)) {
      if (event.type === 'expired') expired++;
    }
  }
  assert.equal(expired, 1, 'fires a single expiry event');
  assert.equal(powerUps.isActive('magnet'), false);
  assert.equal(powerUps.fraction('magnet'), 0);
});

test('re-picking a live power-up refreshes rather than stacks', () => {
  const powerUps = new PowerUpManager();
  powerUps.activate('boost');
  for (let i = 0; i < 180; i++) powerUps.update(1 / 60);
  const remaining = powerUps.remaining('boost');
  assert.ok(remaining < POWERUPS.boost.duration);
  powerUps.activate('boost');
  assert.ok(powerUps.remaining('boost') > remaining, 'timer topped up');
  assert.equal(powerUps.list().length, 1, 'still a single entry');
});

test('the shield absorbs exactly one hit', () => {
  const powerUps = new PowerUpManager();
  powerUps.activate('shield');
  assert.equal(powerUps.consumeShield(), true);
  assert.equal(powerUps.consumeShield(), false, 'second hit gets through');
  assert.equal(powerUps.isActive('shield'), false);
});

test('power-up derived values are only active while running', () => {
  const powerUps = new PowerUpManager();
  assert.equal(powerUps.boostFactor, 1);
  assert.equal(powerUps.multiplierBonus, 0);
  assert.equal(powerUps.magnetRadius, 0);
  powerUps.activate('boost');
  powerUps.activate('multiplier');
  powerUps.activate('magnet');
  assert.equal(powerUps.boostFactor, POWERUPS.boost.speedFactor);
  assert.equal(powerUps.multiplierBonus, POWERUPS.multiplier.multiplierBonus);
  assert.equal(powerUps.magnetRadius, POWERUPS.magnet.radius);
});

test('extra life is instant and never lingers', () => {
  const powerUps = new PowerUpManager();
  const def = powerUps.activate('extralife');
  assert.equal(def.instant, true);
  assert.equal(powerUps.isActive('extralife'), false);
  assert.equal(powerUps.list().length, 0);
});

/* ------------------------------------------------------------------ *
 * Kraken
 * ------------------------------------------------------------------ */

test('KrakenAI runs warning → chase → escape', () => {
  const kraken = new KrakenAI({ kraken: true, krakenIntervalScale: 1 });
  kraken.reset();
  assert.equal(kraken.state, KrakenState.IDLE);
  assert.equal(kraken.isChasing, false);

  const events = [];
  let guard = 0;
  while (kraken.state !== KrakenState.CHASING && guard++ < 20000) {
    events.push(...kraken.update(1 / 60, { distanceDelta: 1, difficulty: 0.3 }));
  }
  assert.equal(kraken.state, KrakenState.CHASING);
  assert.ok(events.some((e) => e.type === 'warning'));
  assert.ok(events.some((e) => e.type === 'start'));

  guard = 0;
  let escaped = false;
  while (!escaped && guard++ < 200000) {
    for (const event of kraken.update(1 / 60, { distanceDelta: 4, difficulty: 0.1 })) {
      if (event.type === 'escaped') escaped = true;
    }
  }
  assert.ok(escaped, 'clean surfing escapes the Kraken');
  assert.equal(kraken.escapes, 1);
  assert.ok(kraken.escapeProgress >= 1);
});

test('KrakenAI catches a player who keeps wiping out', () => {
  const kraken = new KrakenAI({ kraken: true });
  kraken.reset();
  let guard = 0;
  while (kraken.state !== KrakenState.CHASING && guard++ < 20000) {
    kraken.update(1 / 60, { distanceDelta: 1, difficulty: 0.5 });
  }
  let caught = false;
  guard = 0;
  while (!caught && guard++ < 20000) {
    for (const event of kraken.update(1 / 60, { distanceDelta: 0.5, difficulty: 1, hit: guard % 30 === 0 })) {
      if (event.type === 'caught') caught = true;
    }
  }
  assert.ok(caught, 'repeated wipeouts let the Kraken close in');
  assert.equal(kraken.catches, 1);
});

test('escape orbs push the Kraken back', () => {
  const kraken = new KrakenAI({ kraken: true });
  kraken.reset();
  let guard = 0;
  while (kraken.state !== KrakenState.CHASING && guard++ < 20000) {
    kraken.update(1 / 60, { distanceDelta: 1, difficulty: 0.5 });
  }
  kraken.gap = 40;
  kraken.update(1 / 60, { distanceDelta: 0, difficulty: 0.5, seedOrb: true });
  assert.ok(kraken.gap > 40, `gap grew to ${kraken.gap}`);
});

test('KrakenAI stays idle when the mode disables it', () => {
  const kraken = new KrakenAI({ kraken: false });
  kraken.reset();
  for (let i = 0; i < 5000; i++) kraken.update(1 / 60, { distanceDelta: 5, difficulty: 1 });
  assert.equal(kraken.state, KrakenState.IDLE);
  assert.equal(kraken.chases, 0);
});

test('KrakenAI threat and progress stay normalised', () => {
  const kraken = new KrakenAI({ kraken: true });
  kraken.reset();
  assert.equal(kraken.threat, 100 - BALANCE.kraken.startGap);
  kraken.gap = 0;
  assert.equal(kraken.threat, 100);
  kraken.gap = 100;
  assert.equal(kraken.threat, 0);
});

/* ------------------------------------------------------------------ *
 * Spawn director
 * ------------------------------------------------------------------ */

function directorFor(laneCount, seed = 99) {
  const lanes = new LaneSystem(laneCount, BALANCE.lane.width);
  lanes.reset();
  return new SpawnDirector(lanes, seed);
}

test('every generated group leaves at least one reachable lane', () => {
  for (const laneCount of [3, 5]) {
    for (let seed = 0; seed < 12; seed++) {
      const director = directorFor(laneCount, seed * 7919 + laneCount);
      const lanes = director.lanes;
      for (let difficulty = 0; difficulty <= 1.0001; difficulty += 0.05) {
        const tuning = {
          gapTime: Difficulty.computeGapTime(difficulty),
          hazardCount: Difficulty.computeHazardCount(difficulty, 1.4),
          powerUpChance: 0.1,
          formationChance: Difficulty.formationChance(difficulty),
        };
        for (let group = 0; group < 120; group++) {
          const plan = director.createGroup(difficulty, tuning, { chase: difficulty > 0.5 });
          const occupied = new Set();
          for (const hazard of plan.hazards) {
            for (let i = 0; i < hazard.span; i++) occupied.add(hazard.lane + i);
          }
          assert.ok(
            occupied.size <= laneCount - 1,
            `seed ${seed} d=${difficulty.toFixed(2)} blocked ${occupied.size}/${laneCount} lanes`
          );
          assert.ok(plan.freeLanes.length >= 1, 'freeLanes reported');
          for (const lane of plan.freeLanes) {
            assert.ok(lane >= 0 && lane < laneCount, 'lane index in range');
            assert.ok(!occupied.has(lane));
          }
        }
      }
    }
  }
});

test('groups never place two hazards in the same lane', () => {
  const director = directorFor(5, 4242);
  for (let difficulty = 0; difficulty <= 1.0001; difficulty += 0.1) {
    const tuning = {
      gapTime: Difficulty.computeGapTime(difficulty),
      hazardCount: Difficulty.computeHazardCount(difficulty, 1.4),
      powerUpChance: 0.1,
      formationChance: Difficulty.formationChance(difficulty),
    };
    for (let i = 0; i < 400; i++) {
      const plan = director.createGroup(difficulty, tuning);
      const lanes = plan.hazards.map((h) => h.lane);
      assert.equal(new Set(lanes).size, lanes.length, 'one hazard per lane');
    }
  }
});

test('consecutive groups stay reachable from the previous free lanes', () => {
  for (const laneCount of [3, 5]) {
    const director = directorFor(laneCount, 555);
    const lanes = director.lanes;
    for (let difficulty = 0; difficulty <= 1.0001; difficulty += 0.1) {
      const gapTime = Difficulty.computeGapTime(difficulty);
      const tuning = {
        gapTime,
        hazardCount: Difficulty.computeHazardCount(difficulty, 1.4),
        powerUpChance: 0,
        formationChance: Difficulty.formationChance(difficulty),
      };
      let previous = director._lastFree.slice();
      for (let i = 0; i < 250; i++) {
        const plan = director.createGroup(difficulty, tuning);
        const maxShift = Math.max(1, lanes.reachableLanes(gapTime));
        const reachable = plan.freeLanes.some((lane) => previous.some((p) => Math.abs(p - lane) <= maxShift));
        assert.ok(reachable, `lane ${plan.freeLanes} unreachable from ${previous} within ${maxShift}`);
        previous = plan.freeLanes.slice();
      }
      director.reset();
    }
  }
});

test('hazards unlock progressively with difficulty', () => {
  const director = directorFor(5, 31337);
  const seenAtEasy = new Set();
  const seenAtHard = new Set();
  const tuning = {
    gapTime: 0.8,
    hazardCount: 3,
    powerUpChance: 0,
    formationChance: 0,
  };
  for (let i = 0; i < 3000; i++) {
    for (const hazard of director.createGroup(0, tuning).hazards) seenAtEasy.add(hazard.id);
    for (const hazard of director.createGroup(1, tuning).hazards) seenAtHard.add(hazard.id);
  }
  for (const hazard of HAZARD_LIST) {
    if (hazard.formationOnly) continue;
    if (hazard.minDifficulty > 0) {
      assert.ok(!seenAtEasy.has(hazard.id), `${hazard.id} must not appear at difficulty 0`);
    }
    assert.ok(seenAtHard.has(hazard.id), `${hazard.id} should appear at max difficulty`);
  }
});

test('the same seed generates identical courses; different seeds do not', () => {
  const tuning = { gapTime: 0.7, hazardCount: 2.5, powerUpChance: 0.2, formationChance: 0.3 };
  const build = (seed) => {
    const director = directorFor(5, seed);
    return Array.from({ length: 60 }, () => director.createGroup(0.6, tuning))
      .map((g) => g.hazards.map((h) => `${h.id}@${h.lane}`).join(','))
      .join('|');
  };
  assert.equal(build(2024), build(2024));
  assert.notEqual(build(2024), build(2025));
});

test('coin trails arc over jumpable hazards', () => {
  const director = directorFor(5, 8080);
  const tuning = { gapTime: 0.7, hazardCount: 2, powerUpChance: 0, formationChance: 0 };
  let arced = 0;
  for (let i = 0; i < 400; i++) {
    const plan = director.createGroup(0.5, tuning);
    const jumpables = plan.hazards.filter((h) => h.def.behaviour === HAZARD_BEHAVIOUR.JUMP);
    if (!jumpables.length) continue;
    const high = plan.collectibles.filter((c) => c.y > 1.8);
    if (high.length) arced++;
  }
  assert.ok(arced > 20, `saw ${arced} arced trails — coins should reward jumping`);
});

test('power-ups respect the cooldown between groups', () => {
  const director = directorFor(5, 6161);
  const tuning = { gapTime: 0.7, hazardCount: 2, powerUpChance: 1, formationChance: 0.2 };
  let gaps = 0;
  let last = -99;
  for (let i = 0; i < 60; i++) {
    const plan = director.createGroup(0.5, tuning);
    if (plan.powerup) {
      assert.ok(i - last >= 4, 'at least four groups between power-ups');
      last = i;
      gaps++;
    }
  }
  assert.ok(gaps > 5, 'power-ups do appear when the chance is 1');
});

/* ------------------------------------------------------------------ *
 * Modes
 * ------------------------------------------------------------------ */

test('every advertised mode is fully configured', () => {
  for (const mode of MODE_LIST) {
    assert.ok(mode.name && mode.description, `${mode.id} has copy`);
    assert.ok(mode.lives >= 0 && Number.isFinite(mode.lives));
    assert.ok(Number.isFinite(mode.timeLimit));
    assert.ok(Number.isFinite(mode.goalDistance));
    assert.ok(mode.difficultyCap > 0 && mode.difficultyCap <= 1);
    assert.ok(mode.lanes >= 3);
    assert.ok(typeof mode.recordScore === 'boolean');
    assert.ok(Object.values(MODES).includes(mode));
  }
});

test('buildRunConfig merges mode defaults with daily modifiers', () => {
  const endless = buildRunConfig('endless', { seed: 1 });
  assert.equal(endless.seed, 1);
  assert.equal(endless.modifiers.length, 0);

  const day = new Date('2026-10-11T12:00:00Z');
  const daily = buildRunConfig('daily', { date: day });
  assert.equal(daily.dateKey, '2026-10-11');
  assert.equal(daily.modifiers.length, 2, 'two modifiers per day');
  const sameDay = buildRunConfig('daily', { date: new Date('2026-10-11T23:00:00Z') });
  assert.deepEqual(daily.modifiers, sameDay.modifiers, 'stable within the day');
  const nextDay = buildRunConfig('daily', { date: new Date('2026-10-12T01:00:00Z') });
  assert.notEqual(daily.seed, nextDay.seed);
});

test('daily modifiers actually change the configuration', () => {
  const base = buildRunConfig('endless', { seed: 5 });
  let changed = 0;
  const days = ['2026-01-01', '2026-02-14', '2026-03-30', '2026-07-04', '2026-11-19', '2026-12-25'];
  for (const day of days) {
    const config = buildRunConfig('daily', { date: new Date(`${day}T09:00:00Z`) });
    const differs =
      config.speedScale !== base.speedScale ||
      config.hazardScale !== base.hazardScale ||
      config.weather !== base.weather ||
      config.environment !== base.environment ||
      config.waveScale !== base.waveScale ||
      config.powerupScale !== base.powerupScale;
    if (differs) changed++;
  }
  assert.equal(changed, days.length, 'every sampled day applies at least one modifier');
});

test('practice mode never records a score', () => {
  const practice = buildRunConfig('practice', { seed: 2 });
  assert.equal(practice.recordScore, false);
  assert.equal(practice.lives, 0);
  assert.ok(practice.difficultyCap < 0.5, 'stays easy');
  const zigzag = buildRunConfig('zigzag', { seed: 2 });
  assert.equal(zigzag.lanes, 3);
  assert.ok(zigzag.goalDistance > 0);
});
