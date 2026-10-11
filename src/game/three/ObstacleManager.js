/**
 * Obstacle streaming, recycling and collision queries.
 *
 * Hazards are pooled per type and streamed from the far end of the course
 * toward the player. The spawn *plan* comes from `SpawnDirector` (pure logic);
 * this class only turns plans into meshes and keeps them in sync with the
 * water surface.
 */

import * as THREE from 'three';
import { getHazardGeometry, hazardMaterial, setHazardQuality } from './HazardFactory.js';
import { PoolGroup } from '../../core/ObjectPool.js';
import { HAZARD_BEHAVIOUR } from '../config/Content.js';
import { hazardHitsPlayer } from '../rules/CollisionSystem.js';

/** How far ahead of the player hazards are created (world units). */
export const SPAWN_AHEAD = 250;
/** Recycle once a hazard is this far behind the player. */
export const RECYCLE_BEHIND = 34;
/** Clear water at the start of a run. */
export const SAFE_RUNWAY = 46;

export class ObstacleManager {
  /**
   * @param {THREE.Object3D} parent
   * @param {{quality?:string}} [options]
   */
  constructor(parent, options = {}) {
    this.group = new THREE.Group();
    this.group.name = 'obstacles';
    parent.add(this.group);

    this.material = hazardMaterial();
    setHazardQuality(options.quality ?? 'high');
    this.quality = options.quality ?? 'high';

    /** @type {PoolGroup|null} */
    this.pools = null;
    /** @type {Array<any>} live hazards */
    this.active = [];
    this.frontier = -SAFE_RUNWAY;
    this._scratch = [];

    /** @type {import('../rules/SpawnDirector.js').SpawnDirector|null} */
    this.director = null;
    /** @type {import('./Ocean.js').Ocean|null} */
    this.ocean = null;
  }

  /**
   * @param {import('../rules/SpawnDirector.js').SpawnDirector} director
   * @param {import('./Ocean.js').Ocean} ocean
   */
  attach(director, ocean) {
    this.director = director;
    this.ocean = ocean;
  }

  _ensurePools() {
    if (this.pools) return this.pools;
    const self = this;
    const factoryFor = (id) => () => {
      const mesh = new THREE.Mesh(getHazardGeometry(id), self.material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      self.group.add(mesh);
      return mesh;
    };
    const reset = (mesh) => {
      mesh.visible = false;
      mesh.scale.setScalar(1);
      mesh.rotation.set(0, 0, 0);
    };

    const definitions = {
      rock: { factory: factoryFor('rock'), reset },
      rockFormation: { factory: factoryFor('rockFormation'), reset },
      coral: { factory: factoryFor('coral'), reset },
      log: { factory: factoryFor('log'), reset },
      buoy: { factory: factoryFor('buoy'), reset },
      movingBuoy: { factory: factoryFor('movingBuoy'), reset },
      whitewater: { factory: factoryFor('whitewater'), reset },
      driftwood: { factory: factoryFor('driftwood'), reset },
      jellyfish: { factory: factoryFor('jellyfish'), reset },
      stormDebris: { factory: factoryFor('stormDebris'), reset },
      whirlpool: { factory: factoryFor('whirlpool'), reset },
      spinner: { factory: factoryFor('spinner'), reset },
      narrowPassage: { factory: factoryFor('narrowPassage'), reset },
    };
    this.pools = new PoolGroup(definitions);
    return this.pools;
  }

  reset() {
    for (const hazard of this.active) {
      hazard.mesh.visible = false;
      this.pools?.release(hazard.mesh);
    }
    this.active.length = 0;
    this.frontier = -SAFE_RUNWAY;
  }

  setQuality(quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    setHazardQuality(quality);
    // Geometries changed: drop the pool so meshes rebuild with new geometry.
    if (this.pools) {
      for (const pool of Object.values(this.pools.pools)) {
        for (const mesh of pool.active()) this.group.remove(mesh);
        pool.clear();
      }
    }
    this.pools = null;
    this.reset();
  }

  /**
   * Place a planned group into the world.
   * @param {{hazards:any[]}} group
   */
  spawnGroup(group) {
    this._ensurePools();
    for (const item of group.hazards) {
      const mesh = this.pools.acquire(item.id);
      const hazard = {
        uid: item.uid,
        id: item.id,
        def: item.def,
        mesh,
        x: item.x,
        baseX: item.baseX,
        y: 0,
        z: -SPAWN_AHEAD + item.dz,
        span: item.span,
        scale: item.scale,
        moving: item.moving,
        moveAmp: item.moveAmp,
        moveSpeed: item.moveSpeed,
        phase: item.phase,
        spin: item.id === 'spinner' ? 2.6 : 0,
        passed: false,
        counted: false,
        hit: false,
        nearMissed: false,
      };
      mesh.visible = true;
      mesh.scale.setScalar(item.scale);
      mesh.rotation.y = item.yaw;
      mesh.position.set(hazard.x, 0, hazard.z);
      this.active.push(hazard);
    }
    this.frontier = -SPAWN_AHEAD;
  }

  /**
   * Stream new groups as the world moves.
   * @param {number} travelDelta
   * @param {number} gapDistance
   * @param {number} difficulty
   * @param {object} tuning
   * @param {{chase?:boolean}} [options]
   * @returns {Array<any>} groups created this frame (for collectible spawning)
   */
  stream(travelDelta, gapDistance, difficulty, tuning, options = {}) {
    this.frontier += travelDelta;
    const created = [];
    let guard = 0;
    while (this.frontier >= -SPAWN_AHEAD + gapDistance && guard++ < 6) {
      const group = this.director.createGroup(difficulty, tuning, options);
      this.spawnGroup(group);
      created.push(group);
    }
    return created;
  }

  /**
   * Advance every live hazard.
   * @param {number} dt
   * @param {number} travelDelta
   * @param {number} [referenceY] waterline used for collision (the player's)
   */
  update(dt, travelDelta, referenceY = 0) {
    const ocean = this.ocean;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const hazard = this.active[i];
      hazard.z += travelDelta;
      if (hazard.z > RECYCLE_BEHIND) {
        this._release(i);
        continue;
      }
      if (hazard.moving) {
        hazard.phase += dt * hazard.moveSpeed;
        hazard.x = hazard.baseX + Math.sin(hazard.phase) * hazard.moveAmp;
      }
      hazard.mesh.position.x = hazard.x;
      hazard.mesh.position.z = hazard.z;

      // Ride the swell.
      const surface = ocean ? ocean.heightAt(hazard.x, hazard.z) : 0;
      hazard.y = surface;
      // Visual bobbing vs. gameplay waterline (see CollisionSystem above).
      hazard.collisionY = referenceY;
      hazard.mesh.position.y = surface;

      if (hazard.spin) hazard.mesh.rotation.x += hazard.spin * dt;
      if (hazard.id === 'jellyfish') {
        hazard.mesh.position.y = surface + Math.sin(hazard.phase + hazard.z * 0.1) * 0.25;
        hazard.mesh.rotation.y += dt * 0.4;
      } else if (hazard.id === 'whirlpool') {
        hazard.mesh.rotation.y += dt * 2.2;
      } else if (hazard.id === 'movingBuoy') {
        hazard.mesh.rotation.z = Math.sin(hazard.phase) * 0.12;
      } else if (hazard.id === 'whitewater') {
        hazard.mesh.position.y = surface + Math.sin(hazard.z * 0.35 + hazard.phase) * 0.08;
      }
    }
  }

  _release(index) {
    const hazard = this.active[index];
    hazard.mesh.visible = false;
    this.pools?.release(hazard.mesh);
    this.active.splice(index, 1);
  }

  /**
   * Collision + clearance queries for the current frame.
   * @param {{x:number,y:number,z:number}} player
   * @param {boolean} crouching
   * @param {boolean} airborne
   * @returns {{hit:any|null, passed:any[], nearMiss:boolean}}
   */
  query(player, crouching, airborne) {
    let hit = null;
    const passed = [];
    let nearMiss = false;

    for (const hazard of this.active) {
      const dz = hazard.z - player.z;
      if (dz > 6 || dz < -6) continue;

      if (!hazard.hit && !hit && hazardHitsPlayer(hazard, player, crouching)) {
        hazard.hit = true;
        hit = hazard;
      }

      if (!hazard.passed && dz > 0.9) {
        hazard.passed = true;
        passed.push(hazard);
        if (!hazard.hit) {
          const dx = Math.abs(hazard.x - player.x);
          const clearance = hazard.def.behaviour === HAZARD_BEHAVIOUR.DODGE ? 2.1 : 1.5;
          if (dx < clearance) {
            if (hazard.def.behaviour === HAZARD_BEHAVIOUR.JUMP && airborne) {
              hazard.clearedByJump = true;
            }
            if (hazard.def.behaviour === HAZARD_BEHAVIOUR.DUCK && crouching) {
              hazard.clearedByDuck = true;
            }
            nearMiss = true;
          }
        }
      }
    }

    return { hit, passed, nearMiss };
  }

  /** Everything currently on the water (read-only). */
  get live() {
    return this.active;
  }

  get count() {
    return this.active.length;
  }

  dispose() {
    this.reset();
    if (this.pools) {
      for (const pool of Object.values(this.pools.pools)) {
        for (const mesh of pool.active()) this.group.remove(mesh);
        pool.clear();
      }
      this.pools = null;
    }
    this.material.dispose();
  }
}
