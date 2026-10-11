/**
 * Camera rig.
 *
 * Handles follow, speed-driven FOV, wipeout framing, impact shake and the
 * menu's slow orbiting shot. Shake is suppressed entirely when the player
 * enables "reduce motion".
 */

import * as THREE from 'three';
import { clamp, clamp01, damp, lerp } from '../../core/MathUtils.js';

export const CameraMode = Object.freeze({
  MENU: 'menu',
  GAME: 'game',
  CHASE: 'chase',
  WIPEOUT: 'wipeout',
});

export class CameraRig {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    this.camera = camera;
    this.mode = CameraMode.MENU;
    this.reduceMotion = false;

    this._position = new THREE.Vector3(0, 5, 14);
    this._target = new THREE.Vector3(0, 1.4, -12);
    this._lookAt = new THREE.Vector3(0, 1.4, -12);
    this._shake = 0;
    this._shakeSeed = Math.random() * 100;
    this._fov = 62;
    this._elapsed = 0;
    this._orbit = 0;
    this._impulse = new THREE.Vector3();
  }

  configure({ reduceMotion = false } = {}) {
    this.reduceMotion = reduceMotion;
  }

  setMode(mode) {
    this.mode = mode;
  }

  /** Add a one-shot camera kick. */
  shake(strength = 1) {
    if (this.reduceMotion) return;
    this._shake = Math.min(1.6, this._shake + strength);
  }

  /** Instant reposition (run start). */
  snap() {
    this._shake = 0;
    this._elapsed = 0;
  }

  /**
   * @param {number} dt
   * @param {{playerX:number, playerY:number, playerZ:number, surfaceY:number,
   *          speed01:number, lean:number, closeness?:number, playerAlive?:boolean}} ctx
   */
  update(dt, ctx) {
    this._elapsed += dt;
    const cam = this.camera;

    let targetPos;
    let targetLook;
    let targetFov;

    switch (this.mode) {
      case CameraMode.MENU: {
        this._orbit += dt * 0.08;
        const radius = 13.5;
        targetPos = this._position.set(Math.sin(this._orbit) * radius, 4.4 + Math.sin(this._orbit * 1.7) * 0.5, Math.cos(this._orbit) * radius * 0.55 + 9);
        targetLook = this._target.set(Math.sin(this._orbit * 0.6) * 1.2, 1.5, -8);
        targetFov = 58;
        break;
      }
      case CameraMode.CHASE: {
        const closeness = clamp01(ctx.closeness ?? 0);
        targetPos = this._position.set(
          ctx.playerX * 0.42,
          ctx.surfaceY + lerp(4.6, 3.4, closeness),
          ctx.playerZ + lerp(11.5, 14.5, closeness)
        );
        targetLook = this._target.set(ctx.playerX * 0.55, ctx.playerY + 1.5, ctx.playerZ - lerp(16, 22, closeness));
        targetFov = lerp(62, 82, clamp01(ctx.speed01)) + closeness * 4;
        break;
      }
      case CameraMode.WIPEOUT: {
        targetPos = this._position.set(ctx.playerX * 0.6, ctx.playerY + 2.6, ctx.playerZ + 7.5);
        targetLook = this._target.set(ctx.playerX, ctx.playerY + 0.7, ctx.playerZ - 2);
        targetFov = 66;
        break;
      }
      default: {
        targetPos = this._position.set(ctx.playerX * 0.38, ctx.surfaceY + 4.7, ctx.playerZ + 11.6);
        targetLook = this._target.set(ctx.playerX * 0.52, ctx.playerY + 1.6, ctx.playerZ - 15 - ctx.speed01 * 6);
        targetFov = lerp(62, 80, clamp01(ctx.speed01));
        break;
      }
    }

    const followRate = this.mode === CameraMode.MENU ? 1.6 : 7.5;
    const lookRate = this.mode === CameraMode.MENU ? 2.2 : 9;
    cam.position.x = damp(cam.position.x, targetPos.x, followRate, dt);
    cam.position.y = damp(cam.position.y, targetPos.y, followRate * 0.9, dt);
    cam.position.z = damp(cam.position.z, targetPos.z, followRate, dt);

    this._lookAt.x = damp(this._lookAt.x, targetLook.x, lookRate, dt);
    this._lookAt.y = damp(this._lookAt.y, targetLook.y, lookRate, dt);
    this._lookAt.z = damp(this._lookAt.z, targetLook.z, lookRate, dt);

    // Impact shake (skipped entirely when reduce-motion is on).
    if (this._shake > 0.001 && !this.reduceMotion) {
      this._shake = Math.max(0, this._shake - dt * 2.4);
      const amount = this._shake * this._shake * 0.55;
      const t = this._elapsed * 34 + this._shakeSeed;
      cam.position.x += Math.sin(t * 1.13) * amount;
      cam.position.y += Math.sin(t * 1.71 + 1.3) * amount * 0.7;
      cam.position.z += Math.sin(t * 0.91 + 2.7) * amount * 0.4;
      this._lookAt.x += Math.sin(t * 1.37) * amount * 0.35;
    }

    cam.lookAt(this._lookAt);

    // Slight roll into turns for arcade feel.
    const roll = this.mode === CameraMode.MENU ? 0 : -clamp(ctx.lean ?? 0, -1, 1) * 0.055;
    cam.rotation.z += roll;

    this._fov = damp(this._fov, targetFov, 3.2, dt);
    if (Math.abs(cam.fov - this._fov) > 0.01) {
      cam.fov = this._fov;
      cam.updateProjectionMatrix();
    }
  }

  dispose() {
    /* nothing retained */
  }
}
