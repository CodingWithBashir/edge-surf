/**
 * The surfer.
 *
 * Owns the lane system, jump integration and the pose blending for the
 * procedural rig. All motion is delta-time driven; the visual rig is a pure
 * function of the simulation state so animation can never desync from physics.
 */

import * as THREE from 'three';
import { buildSurfer } from './SurferModel.js';
import { LaneSystem } from '../rules/LaneSystem.js';
import { JumpPhysics } from '../rules/JumpPhysics.js';
import { BALANCE, CHARACTERS, BOARDS } from '../config/Content.js';
import { clamp, clamp01, damp, lerp } from '../../core/MathUtils.js';
import { GLSL_WAVES, GLSL_NOISE } from './shaders/common.glsl.js';

/** The player stays at z = 0; the world streams past. */
export const PLAYER_Z = 0;

const wakeVertex = /* glsl */ `
uniform float uTravel;
uniform float uTime;
uniform float uWaveScale;
varying vec2 vUv;
varying float vDist;
${GLSL_WAVES}
void main() {
  vUv = uv;
  vec3 field = waveField(position.xz, uTravel, uTime, uWaveScale);
  vec4 mv = modelViewMatrix * vec4(position.x, field.x + 0.12, position.z, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const wakeFragment = /* glsl */ `
precision mediump float;
uniform float uTime;
uniform float uStrength;
uniform vec3 uColor;
varying vec2 vUv;
varying float vDist;
${GLSL_NOISE}
void main() {
  // vUv.y: 0 at the tail (behind), 1 at the board.
  float along = vUv.y;
  float across = abs(vUv.x - 0.5) * 2.0;
  // V-shaped wake: narrow at the board, widening behind.
  float width = mix(0.14, 0.95, 1.0 - along);
  float foam = smoothstep(width, width * 0.25, across);
  foam *= smoothstep(0.0, 0.22, 1.0 - along);
  float churn = fbm21(vec2(vUv.x * 9.0, (1.0 - along) * 6.0 - uTime * 2.2));
  foam *= 0.55 + churn * 0.75;
  foam *= uStrength;
  foam *= smoothstep(90.0, 12.0, vDist);
  if (foam < 0.01) discard;
  gl_FragColor = vec4(uColor, foam * 0.72);
}
`;

export class Player {
  /**
   * @param {THREE.Object3D} parent
   * @param {{quality?:string}} [options]
   */
  constructor(parent, options = {}) {
    this.root = new THREE.Group();
    this.root.name = 'player';
    parent.add(this.root);

    this.lanes = new LaneSystem();
    this.jump = new JumpPhysics();
    this.quality = options.quality ?? 'high';

    /** @type {any} */
    this.rig = null;
    this.characterId = CHARACTERS[0].id;
    this.boardId = BOARDS[0].id;

    this.x = 0;
    this.y = 0;
    this.z = PLAYER_Z;
    this.surfaceY = 0;
    this.crouching = false;
    this.airborne = false;
    this.alive = true;
    this.invulnerable = 0;
    this.wipeoutTimer = 0;
    this.wipeoutDuration = 1.5;
    this.landSquash = 0;
    this.leanValue = 0;
    this.speed01 = 0;
    this._elapsed = 0;
    this._normal = new THREE.Vector3(0, 1, 0);
    this._sprayAccumulator = 0;

    this._pose = {
      hipsY: 0.74,
      torsoX: 0.2,
      headX: -0.12,
      armLz: -1.02,
      armRz: 1.02,
      armLx: -0.35,
      armRx: -0.28,
      legLx: 0.5,
      legRx: 0.5,
      kneeLx: -1.0,
      kneeRx: -1.0,
      roll: 0,
      pitch: 0,
      yaw: 0,
    };

    this.wakeUniforms = {
      uTravel: { value: 0 },
      uTime: { value: 0 },
      uWaveScale: { value: 1 },
      uStrength: { value: 0.85 },
      uColor: { value: new THREE.Color(0xf2feff) },
    };
    this.wake = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 13, 8, 20),
      new THREE.ShaderMaterial({
        uniforms: this.wakeUniforms,
        vertexShader: wakeVertex,
        fragmentShader: wakeFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.wake.rotateX(-Math.PI / 2);
    this.wake.position.set(0, 0, 6.2);
    this.wake.frustumCulled = false;
    this.wake.renderOrder = 3;
    parent.add(this.wake);

    this.setAppearance(this.characterId, this.boardId);
  }

  /** Swap character / board cosmetics (rebuilds the merged rig). */
  setAppearance(characterId, boardId) {
    const character = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0];
    const board = BOARDS.find((b) => b.id === boardId) ?? BOARDS[0];
    if (this.rig) {
      this.root.remove(this.rig.root);
      this.rig.dispose();
    }
    this.rig = buildSurfer({ character, board, quality: this.quality });
    this.root.add(this.rig.root);
    this.characterId = character.id;
    this.boardId = board.id;
    this.shieldMesh = this._buildShield();
    this.root.add(this.shieldMesh);
    return this.rig;
  }

  _buildShield() {
    const geometry = new THREE.IcosahedronGeometry(1.35, 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0x2ee6c5,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      wireframe: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 5;
    return mesh;
  }

  /** Put the player back at the start of a run. */
  reset(laneCount = this.lanes.count) {
    this.lanes.configure(laneCount);
    this.jump.reset(0);
    this.x = this.lanes.x;
    this.y = 0;
    this.z = PLAYER_Z;
    this.crouching = false;
    this.airborne = false;
    this.alive = true;
    this.invulnerable = 1.2;
    this.wipeoutTimer = 0;
    this.landSquash = 0;
    this.leanValue = 0;
    this.speed01 = 0;
    this.root.visible = true;
    this.wake.visible = true;
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(this.x, 0, this.z);
    this._elapsed = 0;
    Object.assign(this._pose, {
      hipsY: 0.74,
      torsoX: 0.2,
      headX: -0.12,
      armLz: -1.02,
      armRz: 1.02,
      armLx: -0.35,
      armRx: -0.28,
      legLx: 0.5,
      legRx: 0.5,
      kneeLx: -1.0,
      kneeRx: -1.0,
      roll: 0,
      pitch: 0,
      yaw: 0,
    });
    this._applyPose(1);
  }

  /* ------------------------------- input ------------------------------- */

  moveLeft() {
    if (!this.alive) return false;
    return this.lanes.move(-1);
  }

  moveRight() {
    if (!this.alive) return false;
    return this.lanes.move(1);
  }

  requestJump(scale = 1) {
    if (!this.alive) return false;
    if (this.jump.grounded) {
      this.jump.request(scale);
      return true;
    }
    this.jump.request(scale); // still buffered for a forgiving landing
    return false;
  }

  releaseJump() {
    this.jump.release();
  }

  setCrouch(value) {
    this.crouching = !!value && this.alive && !this.airborne;
  }

  /** Launch off a big wave. */
  launch(scale = 1.3) {
    this.jump.launch(scale);
  }

  /* ------------------------------ update ------------------------------- */

  /**
   * @param {number} dt
   * @param {{ocean:any, speed01?:number, particles?:any, invulnerable?:boolean}} ctx
   */
  update(dt, ctx) {
    const { ocean } = ctx;
    this._elapsed += dt;
    this.speed01 = clamp01(ctx.speed01 ?? 0);

    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);

    // --- horizontal -----------------------------------------------------
    this.lanes.update(dt, 1 + this.speed01 * 0.25);
    this.x = this.lanes.x;

    // --- water surface ---------------------------------------------------
    this.surfaceY = ocean ? ocean.heightAt(this.x, this.z) : 0;
    if (ocean) ocean.normalAt(this.x, this.z, this._normal);

    // --- vertical --------------------------------------------------------
    this.jump.update(dt, { hold: true, waveLift: this.surfaceY });
    this.y = this.jump.y;
    this.airborne = !this.jump.grounded;

    if (this.jump.justJumped) this.onJump?.();
    if (this.jump.justLanded) {
      this.landSquash = 1;
      this.onLand?.();
    }
    this.landSquash = Math.max(0, this.landSquash - dt * 3.4);

    // --- wipeout ----------------------------------------------------------
    if (!this.alive) {
      this.wipeoutTimer += dt;
      this._updateWipeout(dt, ocean);
      return;
    }

    // --- transform --------------------------------------------------------
    this.root.position.set(this.x, this.y, this.z);

    const lean = this.lanes.lean;
    this.leanValue = damp(this.leanValue, lean, 9, dt);

    // Board attitude follows the swell, plus a carved roll while turning.
    const targetRoll = -this.leanValue * 0.42 + this._normal.x * 0.5;
    const targetPitch = this._normal.z * 0.42 + (this.airborne ? -0.18 : 0.05);
    const targetYaw = -this.leanValue * 0.34;

    this._pose.roll = damp(this._pose.roll, targetRoll, 10, dt);
    this._pose.pitch = damp(this._pose.pitch, targetPitch, 9, dt);
    this._pose.yaw = damp(this._pose.yaw, targetYaw, 10, dt);

    // --- pose targets ------------------------------------------------------
    const target = this._targetPose();
    const rate = 12;
    for (const key of Object.keys(target)) {
      if (key === 'roll' || key === 'pitch' || key === 'yaw') continue;
      this._pose[key] = damp(this._pose[key], target[key], rate, dt);
    }

    this._applyPose(dt);

    // --- wake ---------------------------------------------------------------
    this.wake.visible = !this.airborne;
    this.wake.position.set(this.x, 0, this.z + 6.2);
    this.wakeUniforms.uTime.value = this._elapsed;
    this.wakeUniforms.uTravel.value = ocean ? ocean.travel : 0;
    this.wakeUniforms.uWaveScale.value = ocean ? ocean.waveScale : 1;
    this.wakeUniforms.uStrength.value = this.airborne ? 0 : 0.55 + this.speed01 * 0.55;

    // --- rail spray ----------------------------------------------------------
    if (ctx.particles && !this.airborne) {
      this._sprayAccumulator += dt * (18 + this.speed01 * 46) * (0.35 + Math.abs(this.leanValue));
      while (this._sprayAccumulator > 1) {
        this._sprayAccumulator -= 1;
        ctx.particles.rail(this.x - Math.sign(this.leanValue) * 0.5, this.y + 0.1, this.z + 0.6, -Math.sign(this.leanValue) || 1, 0.5 + Math.abs(this.leanValue));
      }
      if (Math.abs(this.leanValue) > 0.55) {
        ctx.particles.trailPuff(this.x, this.y + 0.2, this.z + 1.2, 0xcdf3ff);
      }
    }

    // --- shield bubble --------------------------------------------------------
    if (this.shieldMesh) {
      this.shieldMesh.visible = !!this.shieldActive;
      if (this.shieldActive) {
        this.shieldMesh.position.set(0, 0.9, 0);
        const pulse = 1 + Math.sin(this._elapsed * 6) * 0.04;
        this.shieldMesh.scale.setScalar(pulse);
        this.shieldMesh.material.opacity = 0.18 + Math.sin(this._elapsed * 6) * 0.06;
        this.shieldMesh.rotation.y += dt * 0.8;
      }
    }
  }

  _targetPose() {
    const pose = { ...this._pose };
    const lean = this.leanValue;

    // Base surfing stance.
    pose.hipsY = 0.74;
    pose.torsoX = 0.2;
    pose.headX = -0.12;
    pose.armLz = -1.02 - lean * 0.35;
    pose.armRz = 1.02 - lean * 0.35;
    pose.armLx = -0.35;
    pose.armRx = -0.28;
    pose.legLx = 0.5;
    pose.legRx = 0.5;
    pose.kneeLx = -1.0;
    pose.kneeRx = -1.0;

    if (this.crouching) {
      // Duck under overhead hazards.
      pose.hipsY = 0.3;
      pose.torsoX = 0.95;
      pose.headX = -0.55;
      pose.armLz = -1.5;
      pose.armRz = 1.5;
      pose.armLx = 0.35;
      pose.armRx = 0.35;
      pose.legLx = 1.15;
      pose.legRx = 1.15;
      pose.kneeLx = -2.1;
      pose.kneeRx = -2.1;
    } else if (this.airborne) {
      // Tuck the knees and throw the arms up.
      const t = clamp01(this.jump.airProgress);
      pose.hipsY = 0.8;
      pose.torsoX = 0.34 - t * 0.3;
      pose.headX = -0.2;
      pose.armLz = -1.9;
      pose.armRz = 1.9;
      pose.armLx = -0.9;
      pose.armRx = -0.9;
      pose.legLx = 1.25;
      pose.legRx = 1.05;
      pose.kneeLx = -1.9;
      pose.kneeRx = -1.7;
    }

    // Landing compression.
    pose.hipsY -= this.landSquash * 0.28;
    pose.kneeLx += this.landSquash * 0.35;
    pose.kneeRx += this.landSquash * 0.35;
    pose.torsoX += this.landSquash * 0.25;

    // Carving: the body leans into the turn.
    pose.torsoX += Math.abs(lean) * 0.12;
    pose.legLx += lean * 0.12;
    pose.legRx -= lean * 0.12;

    return pose;
  }

  _applyPose(dt) {
    const rig = this.rig;
    if (!rig) return;
    const p = this._pose;

    rig.root.rotation.set(p.pitch, p.yaw, p.roll);
    rig.hips.position.y = p.hipsY;
    rig.torso.rotation.x = p.torsoX;
    rig.head.rotation.x = p.headX;
    rig.armL.rotation.set(p.armLx, 0, p.armLz);
    rig.armR.rotation.set(p.armRx, 0, p.armRz);
    rig.legL.hip.rotation.x = p.legLx;
    rig.legR.hip.rotation.x = p.legRx;
    rig.legL.knee.rotation.x = p.kneeLx;
    rig.legR.knee.rotation.x = p.kneeRx;

    // Subtle idle sway so the surfer never looks frozen.
    const sway = Math.sin(this._elapsed * 1.6) * 0.035;
    rig.torso.rotation.z = sway + this.leanValue * 0.12;
    rig.head.rotation.y = Math.sin(this._elapsed * 0.9) * 0.09 - this.leanValue * 0.2;

    // Blink while invulnerable.
    if (this.invulnerable > 0 && this.alive) {
      this.root.visible = Math.sin(this._elapsed * 42) > -0.35;
    } else {
      this.root.visible = true;
    }
  }

  /* ------------------------------ wipeout ------------------------------ */

  /** @returns {boolean} true if the hit landed (not invulnerable) */
  takeHit() {
    if (!this.alive) return false;
    if (this.invulnerable > 0) return false;
    this.alive = false;
    this.wipeoutTimer = 0;
    this.wake.visible = false;
    if (this.shieldMesh) this.shieldMesh.visible = false;
    this._tumble = {
      spinX: -2.6 - Math.random() * 1.6,
      spinY: (Math.random() - 0.5) * 4,
      spinZ: (Math.random() - 0.5) * 5,
      vy: 4.6 + Math.random() * 2.4,
      vx: (Math.random() - 0.5) * 3,
      y: this.y,
    };
    return true;
  }

  _updateWipeout(dt, ocean) {
    const t = this.wipeoutTimer;
    const tumble = this._tumble;
    tumble.vy -= 26 * dt;
    tumble.y += tumble.vy * dt;
    const floor = this.surfaceY - 1.4;
    if (tumble.y < floor) {
      tumble.y = floor;
      tumble.vy *= -0.24;
    }
    this.x = clamp(this.x + tumble.vx * dt, this.lanes.positions[0] - 3, this.lanes.positions[this.lanes.count - 1] + 3);

    this.root.position.set(this.x, tumble.y, this.z + Math.min(6, t * 5));
    this.root.rotation.x += tumble.spinX * dt;
    this.root.rotation.y += tumble.spinY * dt;
    this.root.rotation.z += tumble.spinZ * dt;

    // Flail.
    const rig = this.rig;
    if (rig) {
      const flail = Math.sin(t * 16);
      rig.armL.rotation.set(-2.2 + flail * 0.6, 0, -2.4);
      rig.armR.rotation.set(-2.2 - flail * 0.6, 0, 2.4);
      rig.legL.hip.rotation.x = 1.4 + flail * 0.4;
      rig.legR.hip.rotation.x = 1.1 - flail * 0.4;
      rig.legL.knee.rotation.x = -0.7;
      rig.legR.knee.rotation.x = -0.5;
      rig.torso.rotation.x = -0.5;
    }
  }

  /** Bring the player back after a non-fatal wipeout. */
  revive() {
    this.alive = true;
    this.invulnerable = 2.2;
    this.wipeoutTimer = 0;
    this.jump.reset(this.surfaceY);
    this.lanes.snapTo(this.lanes.targetIndex);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;
    this.wake.visible = true;
  }

  get wipeoutComplete() {
    return !this.alive && this.wipeoutTimer >= this.wipeoutDuration;
  }

  setShield(active) {
    this.shieldActive = !!active;
  }

  dispose() {
    if (this.rig) this.rig.dispose();
    this.wake.geometry.dispose();
    this.wake.material.dispose();
    this.shieldMesh?.geometry.dispose();
    this.shieldMesh?.material.dispose();
  }
}
