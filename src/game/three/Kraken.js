/**
 * The Kraken — Surf Rush's original chase creature.
 *
 * A giant, bioluminescent squid that surfaces behind the player during chase
 * sequences. Tentacles are bone chains animated with travelling sine waves; the
 * whole rig rises, lunges and roars as it closes the gap.
 *
 * It is driven entirely by `KrakenAI` state, so the encounter is a real
 * gameplay event (the player must outrun it) rather than a cut-scene.
 */

import * as THREE from 'three';
import { part, mergeParts, propMaterial, makeRandom } from './GeometryUtils.js';
import { clamp, clamp01, damp, lerp } from '../../core/MathUtils.js';
import { KrakenState } from '../rules/KrakenAI.js';

const TENTACLE_COUNT = 6;
const SEGMENTS = 6;

export class Kraken {
  /** @param {THREE.Object3D} parent */
  constructor(parent, options = {}) {
    this.group = new THREE.Group();
    this.group.name = 'kraken';
    this.group.visible = false;
    parent.add(this.group);

    this.quality = options.quality ?? 'high';
    this.material = propMaterial({ roughness: 0.55, flatShading: true });
    this.eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x7b3fd4,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this._geometries = [];
    this._build();

    this.visibleAmount = 0; // 0 hidden, 1 fully surfaced
    this._elapsed = 0;
    this._lunge = 0;
    this.state = KrakenState.IDLE;
    this.gap = 100;
  }

  _track(geometry) {
    this._geometries.push(geometry);
    return geometry;
  }

  _build() {
    const seg = this.quality === 'low' ? [8, 6] : this.quality === 'medium' ? [12, 9] : [18, 13];

    /* ------------------------------ mantle ------------------------------ */
    const mantleParts = [
      part(new THREE.SphereGeometry(3.2, seg[0], seg[1]), 0x4c2a86, { position: [0, 2.6, 0], scale: [1, 1.55, 1.15] }),
      part(new THREE.ConeGeometry(2.4, 3.4, seg[0]), 0x3b1f6d, { position: [0, 6.4, 0], scale: [1, 1, 0.85] }),
      part(new THREE.SphereGeometry(1.9, seg[0], seg[1]), 0x6840b0, { position: [0, 1.2, 0.2], scale: [1.15, 0.85, 1] }),
      // Fins.
      part(new THREE.ConeGeometry(1.5, 3.0, 4), 0x5e33a0, { position: [-2.9, 3.6, 0], rotation: [0, 0, 1.1], scale: [1, 1, 0.35] }),
      part(new THREE.ConeGeometry(1.5, 3.0, 4), 0x5e33a0, { position: [2.9, 3.6, 0], rotation: [0, 0, -1.1], scale: [1, 1, 0.35] }),
      // Bioluminescent spots.
      part(new THREE.SphereGeometry(0.3, 8, 6), 0x7df9ff, { position: [-1.5, 4.2, -1.6] }),
      part(new THREE.SphereGeometry(0.26, 8, 6), 0x7df9ff, { position: [1.4, 4.8, -1.4] }),
      part(new THREE.SphereGeometry(0.22, 8, 6), 0x7df9ff, { position: [0.2, 3.2, -2.4] }),
    ];
    const mantle = new THREE.Mesh(this._track(mergeParts(mantleParts)), this.material);
    this.group.add(mantle);
    this.mantle = mantle;

    /* ------------------------------- eyes -------------------------------- */
    const eyeGeometry = new THREE.SphereGeometry(0.62, seg[0], seg[1]);
    this._track(eyeGeometry);
    this.eyeL = new THREE.Mesh(eyeGeometry, this.eyeMaterial);
    this.eyeR = new THREE.Mesh(eyeGeometry, this.eyeMaterial);
    this.eyeL.position.set(-1.55, 1.7, -2.35);
    this.eyeR.position.set(1.55, 1.7, -2.35);
    this.group.add(this.eyeL, this.eyeR);

    const browParts = [
      part(new THREE.BoxGeometry(1.7, 0.4, 0.5), 0x2a1250, { position: [-1.55, 2.35, -2.2], rotation: [0, 0, 0.12] }),
      part(new THREE.BoxGeometry(1.7, 0.4, 0.5), 0x2a1250, { position: [1.55, 2.35, -2.2], rotation: [0, 0, -0.12] }),
    ];
    const brows = new THREE.Mesh(this._track(mergeParts(browParts)), this.material);
    this.group.add(brows);

    /* ------------------------------- beak -------------------------------- */
    const beakParts = [
      part(new THREE.ConeGeometry(0.7, 1.3, 4), 0x1b0f2b, { position: [0, 0.5, -2.6], rotation: [Math.PI, 0, Math.PI / 4] }),
    ];
    const beak = new THREE.Mesh(this._track(mergeParts(beakParts)), this.material);
    this.group.add(beak);

    /* ----------------------------- tentacles ------------------------------ */
    this.tentacles = [];
    const rng = makeRandom(4242);
    for (let t = 0; t < TENTACLE_COUNT; t++) {
      const angle = (t / TENTACLE_COUNT) * Math.PI * 2;
      const root = new THREE.Group();
      root.position.set(Math.cos(angle) * 2.1, 0.9, Math.sin(angle) * 1.1 - 0.4);
      root.rotation.y = angle;
      this.group.add(root);

      const bones = [];
      let parent = root;
      for (let s = 0; s < SEGMENTS; s++) {
        const bone = new THREE.Group();
        bone.position.y = s === 0 ? 0 : -1.05;
        parent.add(bone);

        const radius = 0.46 - s * 0.058;
        const length = 1.15;
        const geometry = new THREE.CylinderGeometry(radius * 0.82, radius, length, seg[0] < 12 ? 7 : 10, 1);
        geometry.translate(0, -length / 2, 0);
        const mesh = new THREE.Mesh(this._track(paintTentacle(geometry, s)), this.material);
        bone.add(mesh);

        // Suckers on the underside.
        if (s < SEGMENTS - 1 && this.quality !== 'low') {
          const sucker = new THREE.Mesh(
            this._track(new THREE.SphereGeometry(radius * 0.26, 6, 5)),
            this.material
          );
          sucker.position.set(0, -length * 0.55, -radius * 0.85);
          sucker.scale.set(1, 0.6, 1);
          bone.add(sucker);
        }

        bones.push(bone);
        parent = bone;
      }
      this.tentacles.push({
        bones,
        phase: rng() * Math.PI * 2,
        speed: 1.1 + rng() * 0.7,
        sway: 0.5 + rng() * 0.4,
        side: t % 2 === 0 ? 1 : -1,
      });
    }

    /* -------------------------------- glow --------------------------------- */
    const glowGeometry = new THREE.SphereGeometry(6.2, 16, 12);
    this._track(glowGeometry);
    this.glow = new THREE.Mesh(glowGeometry, this.glowMaterial);
    this.glow.position.y = 2.4;
    this.group.add(this.glow);
  }

  /** Distance behind the player, derived from the AI gap (100 = far). */
  setGap(gap) {
    this.gap = clamp(gap, 0, 100);
  }

  setState(state) {
    this.state = state;
  }

  /** One-shot lunge animation (used when the player is caught). */
  lunge() {
    this._lunge = 1;
  }

  /**
   * @param {number} dt
   * @param {{playerX:number, playerZ:number, surfaceY:number}} ctx
   */
  update(dt, ctx) {
    this._elapsed += dt;
    const active = this.state === KrakenState.CHASING || this.state === KrakenState.WARNING;
    const target = active ? clamp01(1 - this.gap / 130 + 0.25) : 0;
    this.visibleAmount = damp(this.visibleAmount, target, 2.4, dt);
    this.group.visible = this.visibleAmount > 0.01;
    if (!this.group.visible) return;

    this._lunge = Math.max(0, this._lunge - dt * 1.6);

    const closeness = clamp01(1 - this.gap / 100);
    // Slides up right behind the player as the gap closes.
    const z = ctx.playerZ + lerp(46, 9, closeness) - this._lunge * 6;
    const rise = lerp(-6.5, -1.6, this.visibleAmount) - this._lunge * 1.5;
    const swayX = Math.sin(this._elapsed * 0.7) * (1.4 + closeness * 2.2);

    this.group.position.set(
      damp(this.group.position.x, ctx.playerX * 0.35 + swayX, 2.2, dt),
      damp(this.group.position.y, ctx.surfaceY + rise, 3.2, dt),
      z
    );
    this.group.rotation.y = Math.sin(this._elapsed * 0.5) * 0.12;
    this.group.rotation.z = Math.sin(this._elapsed * 0.9) * 0.05;

    // Mantle breathes; eyes narrow when it is close.
    const breathe = 1 + Math.sin(this._elapsed * 1.5) * 0.035;
    this.mantle.scale.set(breathe, 1 / breathe, breathe);
    const eyeScale = lerp(1, 0.55, closeness) * (0.9 + Math.sin(this._elapsed * 9) * 0.04);
    this.eyeL.scale.setScalar(eyeScale);
    this.eyeR.scale.setScalar(eyeScale);
    const rage = lerp(0xffe066, 0xff4d4d, closeness);
    this.eyeMaterial.color.setHex(rage);
    this.glowMaterial.opacity = 0.16 + closeness * 0.3 + Math.sin(this._elapsed * 4) * 0.03;

    // Tentacles: travelling wave, faster and wilder as it closes in.
    const intensity = 0.35 + closeness * 0.85 + this._lunge * 0.8;
    for (const tentacle of this.tentacles) {
      tentacle.phase += dt * tentacle.speed * (1 + closeness);
      for (let s = 0; s < tentacle.bones.length; s++) {
        const bone = tentacle.bones[s];
        const wave = Math.sin(tentacle.phase - s * 0.7) * tentacle.sway * intensity;
        const lateral = Math.cos(tentacle.phase - s * 0.55) * tentacle.sway * intensity * 0.7 * tentacle.side;
        bone.rotation.x = damp(bone.rotation.x, wave * 0.3 - 0.12, 8, dt);
        bone.rotation.z = damp(bone.rotation.z, lateral * 0.3 + tentacle.side * 0.08, 8, dt);
      }
    }
  }

  /** World position of the mouth, used for ink and roar effects. */
  mouthPosition(out = new THREE.Vector3()) {
    return out.set(this.group.position.x, this.group.position.y + 0.5, this.group.position.z - 2.6);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  dispose() {
    for (const geometry of this._geometries) geometry.dispose();
    this._geometries.length = 0;
    this.material.dispose();
    this.eyeMaterial.dispose();
    this.glowMaterial.dispose();
  }
}

/** Tentacle segments fade from deep purple to a lighter tip. */
function paintTentacle(geometry, index) {
  const colors = [0x5b2f9e, 0x6335ab, 0x6b3bb8, 0x7442c4, 0x7d4ad0, 0x8a55dd];
  const hex = colors[Math.min(index, colors.length - 1)];
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  const c = new THREE.Color(hex).convertSRGBToLinear();
  for (let i = 0; i < count; i++) {
    array[i * 3 + 0] = c.r;
    array[i * 3 + 1] = c.g;
    array[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return geometry;
}
