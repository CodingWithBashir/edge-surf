/**
 * Pooled GPU particle systems.
 *
 * Every effect (splashes, board spray, coin sparkles, Kraken ink, boost trails)
 * shares one of a handful of fixed-capacity point clouds. Particles are stored
 * in flat typed arrays and compacted with swap-remove, so the hot loop performs
 * no allocations and the draw range shrinks as particles die.
 */

import * as THREE from 'three';

const particleVertex = /* glsl */ `
attribute float size;
attribute float alpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = color;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (320.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}
`;

const particleFragment = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = dot(uv, uv);
  if (d > 0.25) discard;
  float soft = smoothstep(0.25, 0.02, d);
  gl_FragColor = vec4(vColor, vAlpha * soft);
}
`;

export class ParticleSystem {
  /**
   * @param {{capacity?:number, blending?:THREE.Blending, depthWrite?:boolean}} [options]
   */
  constructor(options = {}) {
    const capacity = options.capacity ?? 300;
    this.capacity = capacity;
    this.count = 0;

    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);

    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -50), 500);

    this.material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: options.depthWrite ?? false,
      blending: options.blending ?? THREE.NormalBlending,
      vertexColors: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  /**
   * Emit one particle. Silently drops the request when at capacity.
   * @param {Object} spec
   */
  spawn(spec) {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    const i3 = i * 3;

    this.positions[i3 + 0] = spec.x ?? 0;
    this.positions[i3 + 1] = spec.y ?? 0;
    this.positions[i3 + 2] = spec.z ?? 0;

    this.velocities[i3 + 0] = spec.vx ?? 0;
    this.velocities[i3 + 1] = spec.vy ?? 0;
    this.velocities[i3 + 2] = spec.vz ?? 0;

    const color = spec.color ?? 0xffffff;
    this.colors[i3 + 0] = ((color >> 16) & 255) / 255;
    this.colors[i3 + 1] = ((color >> 8) & 255) / 255;
    this.colors[i3 + 2] = (color & 255) / 255;

    const size = spec.size ?? 0.4;
    this.baseSize[i] = size;
    this.sizes[i] = size;
    this.alphas[i] = spec.alpha ?? 1;
    this.life[i] = spec.life ?? 1;
    this.maxLife[i] = spec.life ?? 1;
    this.gravity[i] = spec.gravity ?? -9.8;
    this.drag[i] = spec.drag ?? 0.6;
    this.spin[i] = spec.grow ?? 0;
    return true;
  }

  _swapRemove(i) {
    const last = --this.count;
    if (i !== last) {
      const i3 = i * 3;
      const l3 = last * 3;
      for (let k = 0; k < 3; k++) {
        this.positions[i3 + k] = this.positions[l3 + k];
        this.colors[i3 + k] = this.colors[l3 + k];
        this.velocities[i3 + k] = this.velocities[l3 + k];
      }
      this.sizes[i] = this.sizes[last];
      this.alphas[i] = this.alphas[last];
      this.life[i] = this.life[last];
      this.maxLife[i] = this.maxLife[last];
      this.gravity[i] = this.gravity[last];
      this.drag[i] = this.drag[last];
      this.baseSize[i] = this.baseSize[last];
      this.spin[i] = this.spin[last];
    }
  }

  /**
   * @param {number} dt
   * @param {number} [windX] lateral acceleration (storm / chase gusts)
   */
  update(dt, windX = 0) {
    for (let i = 0; i < this.count; ) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._swapRemove(i);
        continue;
      }
      const i3 = i * 3;
      const dragFactor = Math.max(0, 1 - this.drag[i] * dt);
      this.velocities[i3 + 0] = this.velocities[i3 + 0] * dragFactor + windX * dt;
      this.velocities[i3 + 1] += this.gravity[i] * dt;
      this.velocities[i3 + 2] *= dragFactor;

      this.positions[i3 + 0] += this.velocities[i3 + 0] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      const t = this.life[i] / this.maxLife[i];
      this.alphas[i] = t > 0.75 ? (1 - t) * 4 : t / 0.75;
      this.sizes[i] = this.baseSize[i] * (1 + this.spin[i] * (1 - t));
      i++;
    }

    this.geometry.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.color.needsUpdate = true;
      this.geometry.attributes.size.needsUpdate = true;
      this.geometry.attributes.alpha.needsUpdate = true;
    }
  }

  clear() {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Named particle effects shared by the whole game. */
export class ParticleManager {
  /** @param {{quality?:string}} [options] */
  constructor(options = {}) {
    const quality = options.quality ?? 'high';
    const scale = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1;

    this.group = new THREE.Group();
    this.group.name = 'particles';

    this.splash = new ParticleSystem({ capacity: Math.round(420 * scale) });
    this.spray = new ParticleSystem({ capacity: Math.round(320 * scale) });
    this.sparkle = new ParticleSystem({
      capacity: Math.round(280 * scale),
      blending: THREE.AdditiveBlending,
    });
    this.ink = new ParticleSystem({ capacity: Math.round(180 * scale) });
    this.trail = new ParticleSystem({
      capacity: Math.round(220 * scale),
      blending: THREE.AdditiveBlending,
    });

    this.group.add(this.spray.points, this.splash.points, this.sparkle.points, this.ink.points, this.trail.points);
    this.systems = [this.spray, this.splash, this.sparkle, this.ink, this.trail];
    this.scale = scale;
  }

  /** Water bursting up — landings, collisions, big waves. */
  burst(x, y, z, strength = 1, color = 0xe8f9ff) {
    const count = Math.round((10 + strength * 16) * this.scale);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (1.8 + Math.random() * 4.2) * strength;
      this.splash.spawn({
        x: x + (Math.random() - 0.5) * 0.6,
        y: y + Math.random() * 0.3,
        z: z + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(angle) * speed * 0.55,
        vy: 2.5 + Math.random() * 5.5 * strength,
        vz: Math.sin(angle) * speed * 0.55,
        life: 0.55 + Math.random() * 0.7,
        size: 0.22 + Math.random() * 0.4 * strength,
        color,
        gravity: -15,
        drag: 0.5,
      });
    }
  }

  /** Fine mist thrown off the rails while carving. */
  rail(x, y, z, direction, strength = 1) {
    if (Math.random() > 0.75 * strength) return;
    this.spray.spawn({
      x: x + (Math.random() - 0.5) * 0.5,
      y: y + 0.1 + Math.random() * 0.25,
      z: z + (Math.random() - 0.5) * 0.6,
      vx: direction * (1.6 + Math.random() * 2.4),
      vy: 0.7 + Math.random() * 1.9,
      vz: 6 + Math.random() * 7,
      life: 0.3 + Math.random() * 0.35,
      size: 0.18 + Math.random() * 0.26,
      color: 0xf4feff,
      gravity: -6.5,
      drag: 1.6,
      grow: 0.6,
    });
  }

  /** Golden pop when a collectible is banked. */
  pickup(x, y, z, color = 0xffd166, amount = 10) {
    for (let i = 0; i < Math.round(amount * this.scale); i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * 3.2;
      this.sparkle.spawn({
        x,
        y,
        z,
        vx: Math.cos(angle) * speed,
        vy: 1.2 + Math.random() * 3.4,
        vz: Math.sin(angle) * speed * 0.6,
        life: 0.32 + Math.random() * 0.4,
        size: 0.16 + Math.random() * 0.26,
        color,
        gravity: -5,
        drag: 1.2,
      });
    }
  }

  /** Dark ink cloud from the Kraken. */
  inkCloud(x, y, z, amount = 14) {
    for (let i = 0; i < Math.round(amount * this.scale); i++) {
      const angle = Math.random() * Math.PI * 2;
      this.ink.spawn({
        x: x + (Math.random() - 0.5) * 2.4,
        y: y + Math.random() * 2.4,
        z: z + (Math.random() - 0.5) * 2.4,
        vx: Math.cos(angle) * 0.9,
        vy: 0.4 + Math.random() * 1.2,
        vz: Math.sin(angle) * 0.9,
        life: 0.9 + Math.random() * 1.1,
        size: 1.1 + Math.random() * 2.2,
        color: 0x1b0f2b,
        gravity: 0.4,
        drag: 0.9,
        alpha: 0.8,
        grow: 1.4,
      });
    }
  }

  /** Boost / escape-orb trail. */
  trailPuff(x, y, z, color = 0x2ee6c5) {
    this.trail.spawn({
      x: x + (Math.random() - 0.5) * 0.7,
      y: y + Math.random() * 0.5,
      z: z + (Math.random() - 0.5) * 0.7,
      vx: (Math.random() - 0.5) * 1.2,
      vy: 0.6 + Math.random() * 1.4,
      vz: 5 + Math.random() * 6,
      life: 0.35 + Math.random() * 0.35,
      size: 0.3 + Math.random() * 0.4,
      color,
      gravity: -1.5,
      drag: 1.4,
      grow: 0.9,
    });
  }

  /** Wide foam ring used for heavy landings and wave events. */
  ring(x, y, z, radius = 2.2, color = 0xffffff, count = 22) {
    for (let i = 0; i < Math.round(count * this.scale); i++) {
      const angle = (i / count) * Math.PI * 2;
      this.splash.spawn({
        x: x + Math.cos(angle) * radius * 0.4,
        y: y + 0.1,
        z: z + Math.sin(angle) * radius * 0.4,
        vx: Math.cos(angle) * radius * 2.6,
        vy: 1.4 + Math.random() * 1.6,
        vz: Math.sin(angle) * radius * 2.6,
        life: 0.5 + Math.random() * 0.4,
        size: 0.3 + Math.random() * 0.35,
        color,
        gravity: -9,
        drag: 1.1,
        grow: 0.8,
      });
    }
  }

  /** @param {number} dt @param {number} [windX] */
  update(dt, windX = 0) {
    for (const system of this.systems) system.update(dt, windX);
  }

  clear() {
    for (const system of this.systems) system.clear();
  }

  get activeCount() {
    let total = 0;
    for (const system of this.systems) total += system.count;
    return total;
  }

  dispose() {
    for (const system of this.systems) system.dispose();
  }
}
