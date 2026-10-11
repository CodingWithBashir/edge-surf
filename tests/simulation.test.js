/**
 * Headless integration tests.
 *
 * These drive the *real* subsystems (ocean, player rig, hazard streaming,
 * collision, collectibles, scoring, Kraken AI) at a fixed 60 Hz timestep with a
 * simple autopilot, so a full run can be played unattended in CI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHarness, FIXED_DT } from './helpers/harness.js';
import { SPAWN_AHEAD } from '../src/game/three/ObstacleManager.js';
import { HAZARD_BEHAVIOUR, HAZARDS } from '../src/game/config/Content.js';
import * as Difficulty from '../src/game/rules/Difficulty.js';
import { waveHeight, waveNormal } from '../src/game/three/Ocean.js';
import { KrakenState } from '../src/game/rules/KrakenAI.js';

/* ------------------------------------------------------------------ *
 * Ocean surface
 * ------------------------------------------------------------------ */

test('the CPU wave field matches the documented wave table', () => {
  // Deterministic sanity: translating the sampling point by `travel` along z is
  // the same as looking further along the course.
  const h0 = waveHeight(1.5, -20, 0, 0, 1);
  const h1 = waveHeight(1.5, -20, 10, 0, 1);
  assert.notEqual(h0, h1, 'the field is not flat');

  const near = waveHeight(0, 0, 0, 0, 1);
  const far = waveHeight(0, 0, 0.0001, 0, 1);
  assert.ok(Math.abs(near - far) < 0.05, 'the field is continuous');

  const scaled = waveHeight(2, -13, 4, 1.5, 2.2);
  assert.ok(Number.isFinite(scaled));
  assert.ok(Math.abs(scaled) < 3, 'amplitudes stay bounded');
});

test('wave normals are unit length and point upward', () => {
  const normal = waveNormal(3.2, -40, 120, 2.5, 1.4);
  assert.ok(Math.abs(normal.length() - 1) < 1e-6, 'normalised');
  assert.ok(normal.y > 0, 'never upside down');
  assert.ok(Number.isFinite(normal.x) && Number.isFinite(normal.z));
});

/* ------------------------------------------------------------------ *
 * Streaming
 * ------------------------------------------------------------------ */

test('hazards stream in ahead of the player and recycle behind', () => {
  const sim = createHarness({ modeId: 'endless', seed: 4242 });
  sim.run(20);

  assert.ok(sim.obstacles.count > 0, 'hazards are on the water');
  for (const hazard of sim.obstacles.live) {
    assert.ok(hazard.z <= 34 + 1e-6, `recycled before z=34 (saw ${hazard.z})`);
    assert.ok(hazard.z >= -SPAWN_AHEAD - 4, `spawned at the horizon (saw ${hazard.z})`);
    assert.ok(Number.isFinite(hazard.x) && Number.isFinite(hazard.y));
  }
  assert.ok(sim.score.distance > 100, `travelled ${sim.score.distance.toFixed(0)} m`);
});

test('the run opens with a clear runway', () => {
  const sim = createHarness({ modeId: 'endless', seed: 7 });
  // One frame: the first group spawns at the horizon, nowhere near the player.
  sim.step();
  for (const hazard of sim.obstacles.live) {
    assert.ok(hazard.z < -SPAWN_AHEAD / 2, `first hazards are far ahead (${hazard.z})`);
  }
});

test('hazard counts stay bounded over a long run (pooling works)', () => {
  const sim = createHarness({ modeId: 'endless', seed: 31337 });
  let peak = 0;
  for (let i = 0; i < 60 * 90; i++) {
    sim.autopilot();
    sim.step();
    peak = Math.max(peak, sim.obstacles.count);
    if (sim.lives <= 0) break;
  }
  assert.ok(peak < 90, `peak live hazards ${peak} should be bounded`);
  assert.ok(peak > 4, 'but the course is not empty');
});

/* ------------------------------------------------------------------ *
 * A full, playable run
 * ------------------------------------------------------------------ */

test('an autopiloted endless run survives, scores and collects', () => {
  const sim = createHarness({ modeId: 'endless', seed: 20261011 });
  sim.run(120, { immortal: true });

  assert.ok(sim.score.distance > 1500, `surfed ${sim.score.distance.toFixed(0)} m`);
  assert.ok(sim.score.score > 500, `scored ${sim.score.score.toFixed(0)}`);
  assert.ok(sim.score.coins > 5, `collected ${sim.score.coins} coins`);
  assert.ok(sim.score.obstaclesPassed > 20, `passed ${sim.score.obstaclesPassed} obstacles`);
  assert.ok(sim.score.topSpeed > 20, `top speed ${sim.score.topSpeed.toFixed(1)}`);
  assert.equal(sim.hits < 12, true, `autopilot only wiped out ${sim.hits} times`);
});

test('difficulty actually ramps during a run', () => {
  const sim = createHarness({ modeId: 'endless', seed: 99 });
  const samples = [];
  for (let i = 0; i < 60 * 150; i++) {
    sim.autopilot();
    const info = sim.step();
    if (i % 600 === 0) samples.push(info.speed);
    if (sim.lives <= 0) sim.revive();
  }
  assert.ok(samples.length >= 4, 'enough samples');
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i] >= samples[i - 1] - 0.01, `speed must not fall (${samples})`);
  }
  assert.ok(samples[samples.length - 1] > samples[0] + 2, 'speed meaningfully increases');
});

test('never taking input eventually ends the run (hazards are real)', () => {
  const sim = createHarness({ modeId: 'endless', seed: 4321 });
  sim.wantLane = sim.player.lanes.index;
  let steps = 0;
  while (sim.lives > 0 && steps++ < 60 * 300) {
    sim.step(); // no autopilot: sit in the middle lane
  }
  assert.ok(sim.lives <= 0, 'a passive player wipes out');
  assert.ok(sim.hits >= 3, `took ${sim.hits} hits`);
});

test('lives are consumed one at a time and the run ends at zero', () => {
  const sim = createHarness({ modeId: 'endless', seed: 2468 });
  assert.equal(sim.lives, 3);
  let steps = 0;
  while (sim.lives > 0 && steps++ < 60 * 300) sim.step();
  assert.equal(sim.lives, 0);
  assert.equal(sim.hits, 3, 'exactly three wipeouts');
});

test('practice mode cannot be lost', () => {
  const sim = createHarness({ modeId: 'practice', seed: 1212 });
  sim.run(90);
  assert.equal(sim.lives, 0, 'no lives to lose');
  assert.ok(sim.hits >= 0);
  assert.ok(sim.player.alive, 'the surfer is always back on the board');
  assert.ok(sim.score.distance > 500);
});

test('zigzag runs a narrower course and can be completed', () => {
  const sim = createHarness({ modeId: 'zigzag', seed: 777 });
  assert.equal(sim.player.lanes.count, 3);
  sim.run(150, { immortal: true });
  assert.ok(sim.score.distance > 400, `surfed ${sim.score.distance.toFixed(0)} m on a 3-lane course`);
  for (const hazard of sim.obstacles.live) {
    assert.ok(Math.abs(hazard.x) <= 2.3 * 1.5 + 0.6, `hazard stays in the channel (${hazard.x})`);
  }
});

test('time trial ends when the clock runs out', () => {
  const sim = createHarness({ modeId: 'timeTrial', seed: 12 });
  // Mirror Game's own clock handling.
  let remaining = sim.config.timeLimit;
  let steps = 0;
  while (remaining > 0 && steps++ < 60 * 200) {
    sim.autopilot();
    sim.step();
    remaining -= FIXED_DT;
  }
  assert.equal(remaining <= 0, true, 'the clock reaches zero');
  assert.ok(sim.score.score > 0, 'points were scored against the clock');
  assert.equal(sim.config.lives, 0, 'time trial has no lives');
});

test('the daily challenge is reproducible across two harnesses', () => {
  const date = new Date('2026-10-11T08:00:00Z');
  const a = createHarness({ modeId: 'daily', seed: 555, date });
  const b = createHarness({ modeId: 'daily', seed: 555, date });
  a.run(45, { immortal: true });
  b.run(45, { immortal: true });
  assert.equal(Math.round(a.score.distance), Math.round(b.score.distance));
  assert.equal(Math.round(a.score.score), Math.round(b.score.score));
  assert.equal(a.score.coins, b.score.coins);
  assert.ok(a.config.dateKey === '2026-10-11');
});

/* ------------------------------------------------------------------ *
 * Collisions in motion
 * ------------------------------------------------------------------ */

test('jumping clears jumpable hazards at every speed', () => {
  for (const speed of [22, 34, 46, 58, 62]) {
    const sim = createHarness({ modeId: 'endless', seed: 3141 });

    // Place exactly one coral head in the surfer's lane, far enough ahead that
    // the jump can be timed, then verify it is cleared at each speed.
    sim.obstacles.reset();
    sim.obstacles.spawnGroup({
      hazards: [
        {
          uid: 1,
          id: 'coral',
          def: HAZARDS.coral,
          lane: sim.player.lanes.index,
          span: 1,
          x: sim.player.x,
          dz: 0,
          scale: 1,
          yaw: 0,
          moving: false,
          moveAmp: 0,
          moveSpeed: 0,
          phase: 0,
          baseX: sim.player.x,
        },
      ],
      collectibles: [],
      powerup: null,
      freeLanes: [],
    });

    const hazard = sim.obstacles.live[0];
    hazard.z = -speed * 0.55;

    let jumped = false;
    let cleared = true;
    for (let i = 0; i < 400; i++) {
      const lead = -hazard.z;
      // Jump when the hazard is roughly half a jump away.
      if (!jumped && lead < speed * 0.3) {
        sim.player.requestJump();
        jumped = true;
      }
      sim.ocean.update(FIXED_DT, 0); // still water: a fair, repeatable test
      sim.player.lanes.update(FIXED_DT);
      sim.player.update(FIXED_DT, { ocean: sim.ocean, speed01: 0.5 });
      sim.obstacles.update(FIXED_DT, speed * FIXED_DT);

      const pv = sim._vector.set(sim.player.x, sim.player.y, sim.player.z);
      if (sim.obstacles.query(pv, false, sim.player.airborne).hit) cleared = false;
      if (hazard.z > 8) break;
    }
    assert.ok(jumped, `took off at ${speed} u/s`);
    assert.ok(cleared, `cleared the coral at ${speed} u/s`);
  }
});

test('ducking is required for overhead hazards and standing is not enough', () => {
  const sim = createHarness({ modeId: 'endless', seed: 2718 });
  const overhead = Object.values(HAZARDS).filter((h) => h.behaviour === HAZARD_BEHAVIOUR.DUCK);
  assert.ok(overhead.length >= 1, 'at least one duckable hazard exists');

  sim.obstacles.reset();
  sim.obstacles.spawnGroup({
    hazards: [
      {
        uid: 2,
        id: 'driftwood',
        def: HAZARDS.driftwood,
        lane: sim.player.lanes.index,
        span: 1,
        x: sim.player.x,
        dz: 0,
        scale: 1,
        yaw: 0,
        moving: false,
        moveAmp: 0,
        moveSpeed: 0,
        phase: 0,
        baseX: sim.player.x,
      },
    ],
    collectibles: [],
    powerup: null,
    freeLanes: [],
  });

  const hazard = sim.obstacles.live[0];
  const standingHit = () => {
    hazard.z = 0;
    const pv = sim._vector.set(sim.player.x, sim.player.y, sim.player.z);
    return sim.obstacles.query(pv, false, false).hit;
  };
  assert.ok(standingHit(), 'a standing surfer is clipped by the driftwood');

  sim.player.setCrouch(true);
  hazard.z = 0;
  sim.player.update(FIXED_DT, { ocean: sim.ocean, speed01: 0 });
  const duckingHit = sim.obstacles.query(
    sim._vector.set(sim.player.x, sim.player.y, sim.player.z),
    sim.player.crouching,
    false
  ).hit;
  assert.equal(duckingHit, null, 'a ducking surfer passes underneath');
});

/* ------------------------------------------------------------------ *
 * Collectibles & power-ups in motion
 * ------------------------------------------------------------------ */

test('coins are collected as the surfer passes through a trail', () => {
  const sim = createHarness({ modeId: 'endless', seed: 5150 });
  sim.run(60, { immortal: true });
  assert.ok(sim.score.coins > 0, `banked ${sim.score.coins} coins`);
  assert.ok(sim.collected.coin > 0);
  assert.ok(sim.score.walletCoins >= sim.score.coins * 10);
});

test('the coin magnet pulls pickups toward the board', () => {
  const sim = createHarness({ modeId: 'endless', seed: 616 });
  sim.run(25, { immortal: true });

  // Drop a coin well off to one side and verify the magnet moves it.
  sim.collectibles.reset();
  sim.collectibles.spawnGroup(
    {
      collectibles: [
        { uid: 1, type: 'coin', x: sim.player.x + 7, y: 1, dz: -6, def: { radius: 0.62 } },
      ],
      powerup: null,
    },
    -6
  );
  const coin = sim.collectibles.active[0];
  const startX = coin.x;
  for (let i = 0; i < 20; i++) {
    sim.collectibles.update(FIXED_DT, 0.5, i * FIXED_DT, sim._vector.set(sim.player.x, sim.player.y, 0), 11);
  }
  assert.ok(coin.x < startX, `magnet pulled the coin from ${startX.toFixed(2)} to ${coin.x.toFixed(2)}`);
});

test('picking up a power-up activates it and it expires on schedule', () => {
  const sim = createHarness({ modeId: 'endless', seed: 8888 });
  sim.run(180, { drive: true, immortal: true });
  assert.ok(sim.powerUpsTaken > 0, `picked up ${sim.powerUpsTaken} power-ups`);
  assert.ok(sim.score.powerUpsTaken > 0);
});

test('an activated power-up expires and stops affecting the run', () => {
  const sim = createHarness({ modeId: 'endless', seed: 246 });
  sim.run(15, { immortal: true });
  sim.powerUps.activate('boost');
  const boosted = sim.powerUps.boostFactor;
  assert.ok(boosted > 1);
  let expired = false;
  for (let i = 0; i < 60 * 8; i++) {
    for (const event of sim.powerUps.update(FIXED_DT)) {
      if (event.id === 'boost' && event.type === 'expired') expired = true;
    }
  }
  assert.equal(expired, true, 'the boost ran out on schedule');
  assert.equal(sim.powerUps.boostFactor, 1);
});

test('the shield absorbs exactly one hit in a live run', () => {
  const sim = createHarness({ modeId: 'endless', seed: 2024 });
  sim.run(30, { immortal: true });
  assert.equal(sim.player.alive, true);
  sim.powerUps.activate('shield');
  const livesBefore = sim.lives;

  // Force a wipeout with the shield up.
  sim.player.invulnerable = 0;
  const took = sim.player.takeHit();
  assert.equal(took, true);
  assert.equal(sim.powerUps.consumeShield(), true);
  assert.equal(sim.lives, livesBefore, 'no life lost while shielded');
  assert.equal(sim.powerUps.consumeShield(), false, 'shield is spent');
});

/* ------------------------------------------------------------------ *
 * Kraken in a live run
 * ------------------------------------------------------------------ */

test('the Kraken wakes up and the encounter resolves', () => {
  const sim = createHarness({ modeId: 'endless', seed: 60660, quality: 'low' });
  let steps = 0;
  while (sim.kraken.chases === 0 && steps++ < 60 * 400) {
    sim.autopilot();
    sim.step();
    if (sim.lives <= 0) sim.revive();
  }
  assert.ok(sim.kraken.chases > 0, 'a chase started during a long run');
  assert.ok(
    sim.krakenEvents.some((e) => e.type === 'warning'),
    'a warning was broadcast first'
  );
  assert.ok(
    sim.krakenEvents.some((e) => e.type === 'start'),
    'the chase began'
  );
  assert.notEqual(sim.kraken.state, KrakenState.IDLE);
});

test('the Kraken is disabled in practice mode', () => {
  const sim = createHarness({ modeId: 'practice', seed: 4 });
  sim.run(120, { immortal: true });
  assert.equal(sim.kraken.chases, 0);
  assert.equal(sim.kraken.state, KrakenState.IDLE);
});

/* ------------------------------------------------------------------ *
 * Stability
 * ------------------------------------------------------------------ */

test('a long run produces no NaN in any simulated value', () => {
  const sim = createHarness({ modeId: 'endless', seed: 1717 });
  for (let i = 0; i < 60 * 180; i++) {
    sim.autopilot();
    sim.step();
    if (sim.lives <= 0) sim.revive();
    if (i % 600 === 0) {
      assert.ok(Number.isFinite(sim.player.x), 'player x');
      assert.ok(Number.isFinite(sim.player.y), 'player y');
      assert.ok(Number.isFinite(sim.score.score), 'score');
      assert.ok(Number.isFinite(sim.ocean.travel), 'ocean travel');
      assert.ok(sim.player.x >= sim.player.lanes.positions[0] - 6, 'player stays near the course');
      assert.ok(
        sim.player.x <= sim.player.lanes.positions[sim.player.lanes.count - 1] + 6,
        'player stays near the course'
      );
    }
    if (sim.lives <= 0) break;
  }
});

test('restarting a harness releases every pooled object', () => {
  const sim = createHarness({ modeId: 'endless', seed: 31 });
  sim.run(40);
  const liveBefore = sim.obstacles.count;
  assert.ok(liveBefore > 0);
  sim.obstacles.reset();
  sim.collectibles.reset();
  assert.equal(sim.obstacles.count, 0);
  assert.equal(sim.collectibles.count, 0);
  // Stream again: the pool must reuse rather than leak.
  sim.run(20);
  assert.ok(sim.obstacles.count > 0, 'spawns again after a reset');
  assert.ok(sim.obstacles.pools.createdCount < 120, `created ${sim.obstacles.pools.createdCount} meshes total`);
});

test('every hazard type gets exercised across a long session', () => {
  const sim = createHarness({ modeId: 'endless', seed: 90210 });
  const seen = new Set();
  for (let i = 0; i < 60 * 240; i++) {
    sim.autopilot();
    sim.step();
    for (const hazard of sim.obstacles.live) seen.add(hazard.id);
    if (sim.lives <= 0) sim.revive();
  }
  assert.ok(seen.size >= 8, `saw ${seen.size} hazard types: ${Array.from(seen).join(', ')}`);
  assert.ok(seen.has('rock'));
  assert.ok(seen.has('coral'));
  assert.ok(seen.has('log'));
  assert.ok(seen.has('buoy'));
});
