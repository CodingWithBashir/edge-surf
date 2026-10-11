/**
 * Collectibles and power-up pickups.
 *
 * Coins, shells, pearls, escape orbs and power-ups are pooled per type. The
 * coin magnet lives here too: when it is active, nearby pickups are steered
 * toward the player before the collection test runs, which makes the power-up
 * feel like it is doing real work.
 */

import * as THREE from 'three';
import { PoolGroup } from '../../core/ObjectPool.js';
import { COLLECTIBLES, POWERUPS } from '../config/Content.js';
import { collectibleHitsPlayer } from '../rules/CollisionSystem.js';
import { part, mergeParts, propMaterial, paint } from './GeometryUtils.js';

const RECYCLE_BEHIND = 26;

/* ------------------------------------------------------------------ *
 * Pickup geometry
 * ------------------------------------------------------------------ */

function coinGeometry() {
  const body = new THREE.CylinderGeometry(0.36, 0.36, 0.08, 18);
  body.rotateX(Math.PI / 2);
  const rim = new THREE.TorusGeometry(0.34, 0.05, 6, 20);
  const parts = [paint(body, 0xffd166), paint(rim, 0xfff0b8)];
  // Embossed star so the coin reads at distance.
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.ConeGeometry(0.07, 0.22, 4);
    spike.rotateZ(Math.PI / 2);
    spike.translate(0, 0, 0.05);
    spike.rotateZ((i / 5) * Math.PI * 2);
    parts.push(paint(spike, 0xffe9a8));
  }
  return mergeParts(parts);
}

function shellGeometry() {
  const shell = new THREE.SphereGeometry(0.44, 12, 8, 0, Math.PI, 0, Math.PI * 0.55);
  shell.rotateX(-Math.PI / 2);
  const parts = [paint(shell, 0xff9ec7)];
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.BoxGeometry(0.05, 0.06, 0.42);
    rib.translate(0, 0.02, 0.2);
    rib.rotateY((i / 6) * Math.PI - Math.PI / 2);
    parts.push(paint(rib, 0xffd0e4));
  }
  parts.push(paint(new THREE.SphereGeometry(0.1, 8, 6), 0xfff0f6, 1));
  parts[parts.length - 1].translate(0, 0.02, -0.1);
  return mergeParts(parts);
}

function pearlGeometry() {
  return paint(new THREE.SphereGeometry(0.36, 16, 12), 0xeaf7ff);
}

function orbGeometry() {
  const core = new THREE.IcosahedronGeometry(0.42, 0);
  return paint(core, 0x2ee6c5);
}

function powerUpGeometry(id) {
  switch (id) {
    case 'magnet': {
      const parts = [];
      const torus = new THREE.TorusGeometry(0.3, 0.11, 8, 18, Math.PI * 1.35);
      parts.push(paint(torus, 0xdfe9ef));
      for (const s of [-1, 1]) {
        const tip = new THREE.CylinderGeometry(0.11, 0.11, 0.16, 8);
        tip.rotateZ(Math.PI / 2);
        tip.translate(s * 0.3, -0.06, 0);
        parts.push(paint(tip, 0xff6b6b));
      }
      return mergeParts(parts);
    }
    case 'shield': {
      const shell = new THREE.OctahedronGeometry(0.42, 0);
      shell.scale(1, 1.15, 0.6);
      return paint(shell, 0x2ee6c5);
    }
    case 'boost': {
      const parts = [];
      for (let i = 0; i < 3; i++) {
        const chevron = new THREE.ConeGeometry(0.22, 0.22, 3);
        chevron.rotateX(Math.PI / 2);
        chevron.translate(0, 0.16 - i * 0.16, 0);
        parts.push(paint(chevron, i === 0 ? 0xfff3c4 : 0xffd166));
      }
      return mergeParts(parts);
    }
    case 'multiplier': {
      const parts = [];
      const barA = new THREE.BoxGeometry(0.6, 0.16, 0.16);
      barA.rotateZ(0.5);
      const barB = new THREE.BoxGeometry(0.6, 0.16, 0.16);
      barB.rotateZ(-0.5);
      parts.push(paint(barA, 0xff8a7a), paint(barB, 0xffb3a7));
      return mergeParts(parts);
    }
    case 'extralife': {
      const parts = [];
      for (const s of [-1, 1]) {
        const lobe = new THREE.SphereGeometry(0.2, 10, 8);
        lobe.translate(s * 0.16, 0.14, 0);
        parts.push(paint(lobe, 0x7dff9b));
      }
      const tip = new THREE.ConeGeometry(0.28, 0.42, 4);
      tip.rotateZ(Math.PI);
      tip.rotateY(Math.PI / 4);
      tip.translate(0, -0.14, 0);
      parts.push(paint(tip, 0x7dff9b));
      return mergeParts(parts);
    }
    default:
      return paint(new THREE.OctahedronGeometry(0.4, 0), 0xffffff);
  }
}

/* ------------------------------------------------------------------ *
 * Manager
 * ------------------------------------------------------------------ */

export class CollectibleManager {
  /** @param {THREE.Object3D} parent @param {{quality?:string}} [options] */
  constructor(parent, options = {}) {
    this.group = new THREE.Group();
    this.group.name = 'collectibles';
    parent.add(this.group);

    this.material = propMaterial({ roughness: 0.35, metalness: 0.25, flatShading: false });
    this.shinyMaterial = propMaterial({ roughness: 0.08, metalness: 0.35, flatShading: false });

    /** @type {Array<any>} */
    this.active = [];
    this.powerUpsActive = [];
    this._geometries = [];
    this._glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this._buildPools();
  }

  _geometry(key) {
    let geometry;
    switch (key) {
      case 'coin':
        geometry = coinGeometry();
        break;
      case 'shell':
        geometry = shellGeometry();
        break;
      case 'pearl':
        geometry = pearlGeometry();
        break;
      case 'escapeOrb':
        geometry = orbGeometry();
        break;
      default:
        geometry = powerUpGeometry(key);
        break;
    }
    this._geometries.push(geometry);
    return geometry;
  }

  _buildPools() {
    const self = this;
    const makeFactory = (key, shiny = false) => () => {
      const mesh = new THREE.Mesh(self._geometry(key), shiny ? self.shinyMaterial : self.material);
      mesh.visible = false;
      const record = { mesh, key, glow: null };

      if (key === 'escapeOrb' || POWERUPS[key]) {
        const glow = new THREE.Mesh(
          new THREE.SphereGeometry(key === 'escapeOrb' ? 0.72 : 0.66, 12, 10),
          self._glowMaterial.clone()
        );
        const def = POWERUPS[key];
        glow.material.color.set(def ? def.color : 0x2ee6c5);
        glow.material.opacity = 0.22;
        mesh.add(glow);
        record.glow = glow;
      }
      self.group.add(mesh);
      return record;
    };
    const reset = (record) => {
      record.mesh.visible = false;
      record.mesh.scale.setScalar(1);
      record.mesh.rotation.set(0, 0, 0);
    };

    this.pools = new PoolGroup({
      coin: { factory: makeFactory('coin'), reset, initial: 24 },
      shell: { factory: makeFactory('shell'), reset, initial: 6 },
      pearl: { factory: makeFactory('pearl', true), reset, initial: 3 },
      escapeOrb: { factory: makeFactory('escapeOrb', true), reset, initial: 3 },
      magnet: { factory: makeFactory('magnet'), reset, initial: 2 },
      shield: { factory: makeFactory('shield'), reset, initial: 2 },
      boost: { factory: makeFactory('boost'), reset, initial: 2 },
      multiplier: { factory: makeFactory('multiplier'), reset, initial: 2 },
      extralife: { factory: makeFactory('extralife'), reset, initial: 2 },
    });
  }

  reset() {
    for (const item of this.active) this._release(item);
    this.active.length = 0;
    this.powerUpsActive.length = 0;
  }

  _release(item) {
    item.mesh.visible = false;
    this.pools.release(item.record);
  }

  /**
   * Spawn the collectibles + power-up from a planned group.
   * @param {{collectibles:any[], powerup:any|null}} group
   * @param {number} groupZ
   */
  spawnGroup(group, groupZ) {
    for (const item of group.collectibles) {
      const record = this.pools.acquire(item.type);
      const entry = {
        type: item.type,
        def: item.def,
        record,
        mesh: record.mesh,
        x: item.x,
        homeX: item.x,
        y: item.y,
        baseY: item.y,
        z: groupZ + item.dz,
        phase: Math.random() * Math.PI * 2,
        collected: false,
        magnetised: false,
        scale: 1,
      };
      record.mesh.visible = true;
      record.mesh.position.set(entry.x, entry.y, entry.z);
      record.mesh.scale.setScalar(entry.type === 'coin' ? 1 : 1);
      this.active.push(entry);
    }

    if (group.powerup) {
      const item = group.powerup;
      const record = this.pools.acquire(item.id);
      const entry = {
        type: 'powerup',
        id: item.id,
        def: item.def,
        record,
        mesh: record.mesh,
        x: item.x,
        homeX: item.x,
        y: item.y,
        baseY: item.y,
        z: groupZ + item.dz,
        phase: Math.random() * Math.PI * 2,
        collected: false,
        magnetised: false,
        scale: 1,
      };
      record.mesh.visible = true;
      record.mesh.position.set(entry.x, entry.y, entry.z);
      this.active.push(entry);
    }
  }

  /**
   * @param {number} dt
   * @param {number} travelDelta
   * @param {number} time
   * @param {{x:number,y:number,z:number}} player
   * @param {number} magnetRadius
   * @returns {Array<any>} items collected this frame
   */
  update(dt, travelDelta, time, player, magnetRadius = 0) {
    const collected = [];

    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      item.z += travelDelta;
      if (item.z > RECYCLE_BEHIND) {
        this._release(item);
        this.active.splice(i, 1);
        continue;
      }

      // Coin magnet steers pickups toward the board.
      const dx = player.x - item.x;
      const dz = item.z - player.z;
      if (magnetRadius > 0 && item.type !== 'powerup') {
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < magnetRadius) {
          item.magnetised = true;
          const pull = (1 - dist / magnetRadius) * 26 * dt;
          item.x += (dx / (dist || 1)) * pull;
          item.y += ((player.y + 1.0 - item.y) / (dist || 1)) * pull * 0.7;
        }
      }

      // Idle animation.
      item.phase += dt * (item.type === 'coin' ? 3.4 : 2.0);
      const bob = Math.sin(item.phase) * (item.type === 'powerup' ? 0.22 : 0.13);
      item.mesh.position.set(item.x, item.y + bob, item.z);
      if (item.type === 'coin') {
        item.mesh.rotation.y = item.phase;
      } else if (item.type === 'shell') {
        item.mesh.rotation.y = item.phase * 0.6;
        item.mesh.rotation.z = Math.sin(item.phase * 0.8) * 0.14;
      } else if (item.type === 'pearl' || item.type === 'escapeOrb') {
        item.mesh.rotation.y = item.phase * 0.5;
        item.mesh.rotation.x = item.phase * 0.32;
        const pulse = 1 + Math.sin(time * 4 + item.phase) * 0.07;
        item.mesh.scale.setScalar(pulse);
      } else if (item.type === 'powerup') {
        item.mesh.rotation.y = item.phase * 0.9;
        if (item.record.glow) {
          item.record.glow.scale.setScalar(1 + Math.sin(time * 5 + item.phase) * 0.12);
        }
      }

      if (collectibleHitsPlayer(item, item.def?.radius ?? 0.7, player, magnetRadius > 0 ? 0.6 : 0)) {
        collected.push({ type: item.type, id: item.id, def: item.def, x: item.x, y: item.y, z: item.z });
        this._release(item);
        this.active.splice(i, 1);
      }
    }

    return collected;
  }

  get count() {
    return this.active.length;
  }

  dispose() {
    this.reset();
    this.pools.clear();
    for (const geometry of this._geometries) geometry.dispose();
    this._geometries.length = 0;
    this.material.dispose();
    this.shinyMaterial.dispose();
    this._glowMaterial.dispose();
  }
}
