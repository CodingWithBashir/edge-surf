/**
 * Vertical jump integration.
 *
 * Deliberately forgiving: a small coyote-time window and an input buffer
 * remove the "I pressed jump but nothing happened" feel, while an explicit
 * `grounded` flag makes accidental double jumps impossible.
 */

import { BALANCE } from '../config/Content.js';

export class JumpPhysics {
  constructor() {
    this.reset();
  }

  reset(y = 0) {
    this.y = y;
    this.velocity = 0;
    this.grounded = true;
    this.coyote = 0;
    this.buffer = 0;
    this.airTime = 0;
    this.jumpCount = 0;
    this.justLanded = false;
    this.justJumped = false;
    /** True during the frame a jump begins — consumed by audio/particles. */
    this.launchImpulse = 0;
    this.peakHeight = 0;
  }

  /**
   * Queue a jump. Buffered so a slightly early press still fires on landing.
   * @param {number} [scale] multiplies jump velocity (wave launches use >1)
   */
  request(scale = 1) {
    this.buffer = BALANCE.jump.bufferTime;
    this.bufferScale = scale;
  }

  /** Cut the jump short when the button is released early (variable height). */
  release() {
    if (!this.grounded && this.velocity > 0) this.velocity *= 0.55;
  }

  /**
   * @param {number} dt
   * @param {{hold:boolean, waveLift?:number}} input
   * @returns {number} new height above the water surface
   */
  update(dt, { hold = true, waveLift = 0 } = {}) {
    this.justLanded = false;
    this.justJumped = false;
    this.launchImpulse = 0;

    // --- timers ---
    if (this.grounded) this.coyote = BALANCE.jump.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);
    this.buffer = Math.max(0, this.buffer - dt);

    // --- launch ---
    if (this.buffer > 0 && this.coyote > 0 && this.grounded) {
      this.velocity = BALANCE.jump.velocity * (this.bufferScale ?? 1);
      this.grounded = false;
      this.buffer = 0;
      this.coyote = 0;
      this.airTime = 0;
      this.jumpCount++;
      this.justJumped = true;
      this.launchImpulse = this.velocity;
    }
    this.bufferScale = 1;

    // --- integrate ---
    if (!this.grounded) {
      this.airTime += dt;
      // Rising uses the base gravity; falling is slightly heavier for punch.
      const gravity = BALANCE.jump.gravity * (this.velocity > 0 ? 1 : BALANCE.jump.fallMultiplier);
      this.velocity -= gravity * dt;
      this.y += this.velocity * dt;
      this.peakHeight = Math.max(this.peakHeight, this.y);

      if (this.y <= waveLift) {
        this.y = waveLift;
        this.velocity = 0;
        this.grounded = true;
        this.justLanded = true;
        this.peakHeight = 0;
      }
    } else {
      // Ride the surface: the water itself can lift the board.
      this.y = waveLift;
      this.velocity = 0;
      this.airTime = 0;
    }

    return this.y;
  }

  /** Force the player airborne (big-wave launches, Kraken knock-back). */
  launch(scale = 1.25) {
    this.velocity = BALANCE.jump.velocity * scale;
    this.grounded = false;
    this.coyote = 0;
    this.airTime = 0;
    this.jumpCount++;
    this.justJumped = true;
    this.launchImpulse = this.velocity;
  }

  get isAirborne() {
    return !this.grounded;
  }

  /** 0 at the water line, 1 at the apex of the current jump. */
  get airProgress() {
    if (this.grounded) return 0;
    const apex = (BALANCE.jump.velocity * BALANCE.jump.velocity) / (2 * BALANCE.jump.gravity);
    return Math.max(0, Math.min(1, this.y / (apex || 1)));
  }
}
