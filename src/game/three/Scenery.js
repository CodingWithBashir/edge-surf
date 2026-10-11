/**
 * Procedural coastline: islands, cliffs, rock stacks, marker buoys, a
 * lighthouse and the optional in-water lane guides.
 *
 * Props are merged into single vertex-coloured meshes at build time and then
 * recycled: instead of creating geometry while surfing, each layer's instances
 * simply wrap around when they pass behind the camera and are re-randomised.
 */

import * as THREE from 'three';
import { part, mergeParts, propMaterial, rockGeometry, makeRandom } from './GeometryUtils.js';
import { GLSL_WAVES } from './shaders/common.glsl.js';

const RECYCLE_Z = 90;
const START_OFFSET = -60;

/** @param {number} rngSeed */
function buildPalm(rng, height, trunkColor, leafColor) {
  const parts = [];
  const segments = 4;
  let y = 0;
  let tilt = 0;
  let x = 0;
  for (let i = 0; i < segments; i++) {
    const segH = height / segments;
    const radius = 0.3 - i * 0.05;
    parts.push(
      part(new THREE.CylinderGeometry(radius * 0.85, radius, segH, 6), trunkColor, {
        position: [x, y + segH / 2, 0],
        rotation: [0, 0, tilt],
      })
    );
    y += segH * Math.cos(tilt);
    x += segH * Math.sin(tilt) * 0.9;
    tilt += (rng() - 0.35) * 0.14;
  }

  const fronds = 6;
  for (let i = 0; i < fronds; i++) {
    const angle = (i / fronds) * Math.PI * 2 + rng() * 0.4;
    const droop = 0.5 + rng() * 0.55;
    const len = 2.3 + rng() * 0.9;
    parts.push(
      part(new THREE.ConeGeometry(0.42, len, 4), leafColor, {
        position: [x + Math.cos(angle) * len * 0.35, y + 0.25 - droop * 0.35, Math.sin(angle) * len * 0.35],
        rotation: [Math.PI / 2 - droop, -angle, 0.2],
        scale: [1, 1, 0.22],
      })
    );
  }
  // Coconuts.
  if (rng() > 0.45) {
    for (let i = 0; i < 3; i++) {
      parts.push(
        part(new THREE.SphereGeometry(0.19, 6, 5), 0x6b4526, {
          position: [x + (rng() - 0.5) * 0.5, y - 0.15, (rng() - 0.5) * 0.5],
        })
      );
    }
  }
  return parts;
}

function buildIsland(seed, palette) {
  const rng = makeRandom(seed);
  const [sand, grass, tree, dark] = palette;
  const parts = [];

  const radius = 8 + rng() * 6;
  parts.push(
    part(new THREE.CylinderGeometry(radius * 0.72, radius, 2.1, 10), sand, { position: [0, -0.1, 0] })
  );
  parts.push(
    part(new THREE.CylinderGeometry(radius * 0.5, radius * 0.78, 1.1, 10), sand, { position: [0, 0.95, 0] })
  );
  const mound = rockGeometry(radius * 0.55, seed, 1);
  parts.push(part(mound, grass, { position: [0, 1.9, 0], scale: [1.5, 0.85, 1.5] }));
  parts.push(part(rockGeometry(radius * 0.3, seed + 7, 1), dark, { position: [radius * 0.35, 2.4, -radius * 0.2], scale: [1.3, 0.7, 1.1] }));

  // Vegetation.
  const palms = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < palms; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = radius * (0.18 + rng() * 0.45);
    const palm = buildPalm(rng, 4.2 + rng() * 2.6, 0x7a5533, tree);
    for (const p of palm) {
      p.translate(Math.cos(angle) * dist, 1.0, Math.sin(angle) * dist);
      parts.push(p);
    }
  }

  // Shoreline rocks.
  const rocks = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < rocks; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = radius * (0.85 + rng() * 0.25);
    parts.push(
      part(rockGeometry(0.7 + rng() * 1.1, seed + i * 13, 0), dark, {
        position: [Math.cos(angle) * dist, -0.2 + rng() * 0.4, Math.sin(angle) * dist],
        scale: [1, 0.7, 1],
      })
    );
  }

  // A little beach hut on the bigger islands.
  if (radius > 11 && rng() > 0.4) {
    const angle = rng() * Math.PI * 2;
    const dist = radius * 0.4;
    const hx = Math.cos(angle) * dist;
    const hz = Math.sin(angle) * dist;
    parts.push(part(new THREE.BoxGeometry(2.2, 1.6, 2.2), 0xb5834a, { position: [hx, 2.4, hz] }));
    parts.push(
      part(new THREE.ConeGeometry(2.0, 1.4, 4), 0x8a4b2a, { position: [hx, 3.85, hz], rotation: [0, Math.PI / 4, 0] })
    );
  }

  return mergeParts(parts);
}

function buildCliff(seed, palette) {
  const rng = makeRandom(seed);
  const [, grass, , dark] = palette;
  const parts = [];
  const chunks = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < chunks; i++) {
    const h = 9 + rng() * 12;
    const r = 3 + rng() * 3.2;
    parts.push(
      part(rockGeometry(r, seed + i * 31, 1), dark, {
        position: [(rng() - 0.5) * 5, h * 0.35 - 1.2, (rng() - 0.5) * 5],
        scale: [1, (h / r) * 0.42, 1],
      })
    );
    // Vegetation cap.
    if (rng() > 0.25) {
      parts.push(
        part(rockGeometry(r * 0.85, seed + 99 + i, 1), grass, {
          position: [(rng() - 0.5) * 4, h * 0.62, (rng() - 0.5) * 4],
          scale: [1.1, 0.22, 1.1],
        })
      );
    }
  }
  return mergeParts(parts);
}

function buildRockStack(seed) {
  const rng = makeRandom(seed);
  const parts = [];
  const count = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const r = 1.6 + rng() * 2.2 - i * 0.25;
    parts.push(
      part(rockGeometry(r, seed + i * 17, 1), i % 2 ? 0x5d6b74 : 0x6f7d85, {
        position: [(rng() - 0.5) * 3.4, r * 0.35 - 0.5, (rng() - 0.5) * 3.4],
        scale: [1, 0.7 + rng() * 0.5, 1],
      })
    );
  }
  return mergeParts(parts);
}

function buildBuoyCluster(seed) {
  const rng = makeRandom(seed);
  const parts = [];
  const count = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const x = (rng() - 0.5) * 4;
    const z = (rng() - 0.5) * 4;
    const body = 0xe4483f + (((seed + i) % 3) * 0x001a05);
    parts.push(part(new THREE.SphereGeometry(0.75, 8, 6), body, { position: [x, 0.15, z], scale: [1, 0.85, 1] }));
    parts.push(part(new THREE.CylinderGeometry(0.09, 0.09, 2.0, 5), 0xdadada, { position: [x, 1.1, z] }));
    parts.push(part(new THREE.ConeGeometry(0.42, 0.7, 4), 0xffd166, { position: [x + 0.3, 1.95, z] }));
  }
  return mergeParts(parts);
}

function buildLighthouse(seed, palette) {
  const rng = makeRandom(seed);
  const parts = [];
  parts.push(part(rockGeometry(4.2, seed, 1), 0x5a6670, { position: [0, -0.6, 0], scale: [1.4, 0.5, 1.4] }));
  parts.push(part(new THREE.CylinderGeometry(1.0, 1.7, 11, 12), 0xf2f5f7, { position: [0, 5.2, 0] }));
  parts.push(part(new THREE.CylinderGeometry(1.05, 1.05, 2.2, 12), 0xe4483f, { position: [0, 2.4, 0] }));
  parts.push(part(new THREE.CylinderGeometry(1.02, 1.02, 2.2, 12), 0xe4483f, { position: [0, 7.4, 0] }));
  parts.push(part(new THREE.CylinderGeometry(1.4, 1.4, 0.5, 12), 0x33414d, { position: [0, 10.9, 0] }));
  parts.push(part(new THREE.CylinderGeometry(1.25, 1.25, 1.6, 10), 0x2a3540, { position: [0, 11.8, 0] }));
  parts.push(part(new THREE.ConeGeometry(1.5, 1.6, 12), 0xe4483f, { position: [0, 13.2, 0] }));
  if (rng() > 0.5) {
    parts.push(part(new THREE.BoxGeometry(3.2, 2.0, 3.2), 0xd9cdb5, { position: [3.5, 0.6, 2.2] }));
    parts.push(part(new THREE.ConeGeometry(2.6, 1.3, 4), 0x8a4b2a, { position: [3.5, 2.2, 2.2], rotation: [0, Math.PI / 4, 0] }));
  }
  return mergeParts(parts);
}

/* ------------------------------------------------------------------ *
 * Lane guides
 * ------------------------------------------------------------------ */

const guideVertex = /* glsl */ `
uniform float uTravel;
uniform float uTime;
uniform float uWaveScale;
varying float vDist;
varying float vCoord;
${GLSL_WAVES}
void main() {
  vec3 field = waveField(position.xz, uTravel, uTime, uWaveScale);
  vec3 displaced = vec3(position.x, field.x + 0.09, position.z);
  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  vDist = -mv.z;
  vCoord = position.z;
  gl_Position = projectionMatrix * mv;
}
`;

const guideFragment = /* glsl */ `
precision mediump float;
uniform float uTravel;
uniform vec3 uColor;
uniform float uOpacity;
varying float vDist;
varying float vCoord;
void main() {
  float dash = fract((vCoord + uTravel) * 0.11);
  float a = step(dash, 0.5) * 0.85 + 0.06;
  a *= smoothstep(240.0, 70.0, vDist);
  a *= smoothstep(2.0, 14.0, vDist);
  gl_FragColor = vec4(uColor, a * uOpacity);
}
`;

export class Scenery {
  /** @param {{quality?:string}} [options] */
  constructor(options = {}) {
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    this.material = propMaterial({ roughness: 0.94 });
    this.lampMaterial = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });

    /** @type {Array<{mesh:THREE.Mesh, z:number, side:number, baseScale:number, kind:string}>} */
    this.instances = [];
    this.layers = [];
    this._palette = [0xc2b280, 0x7d9a5b, 0x2f7d4f, 0x1d5c3f];
    this._built = false;

    this.guideUniforms = {
      uTravel: { value: 0 },
      uTime: { value: 0 },
      uWaveScale: { value: 1 },
      uColor: { value: new THREE.Color(0xd9f6ff) },
      uOpacity: { value: 0.34 },
    };
    this.guideMaterial = new THREE.ShaderMaterial({
      uniforms: this.guideUniforms,
      vertexShader: guideVertex,
      fragmentShader: guideFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.laneGuides = new THREE.Mesh(new THREE.BufferGeometry(), this.guideMaterial);
    this.laneGuides.frustumCulled = false;
    this.laneGuides.visible = false;
    this.laneGuides.renderOrder = 2;
    this.group.add(this.laneGuides);
  }

  /**
   * Build (or rebuild) all scenery for an environment palette.
   * @param {string[]} palette
   * @param {{quality?:string}} [options]
   */
  build(palette, options = {}) {
    this._palette = palette;
    const quality = options.quality ?? 'high';
    const density = quality === 'low' ? 0.6 : quality === 'medium' ? 0.82 : 1;

    this._clear();

    const seedBase = 1337;
    this.layers = [
      { kind: 'island', count: Math.max(2, Math.round(5 * density)), spacing: 96, minX: 26, maxX: 74, scale: [1, 1.3] },
      { kind: 'cliff', count: Math.max(2, Math.round(6 * density)), spacing: 78, minX: 20, maxX: 58, scale: [0.8, 1.5] },
      { kind: 'rocks', count: Math.max(4, Math.round(10 * density)), spacing: 44, minX: 13, maxX: 40, scale: [0.7, 1.4] },
      { kind: 'buoy', count: Math.max(6, Math.round(14 * density)), spacing: 30, minX: 11, maxX: 26, scale: [0.7, 1.2] },
      { kind: 'lighthouse', count: 2, spacing: 300, minX: 22, maxX: 40, scale: [0.9, 1.2] },
      { kind: 'far', count: Math.max(2, Math.round(4 * density)), spacing: 150, minX: 78, maxX: 130, scale: [1.8, 3.0] },
    ];

    let seed = seedBase;
    for (const layer of this.layers) {
      for (let i = 0; i < layer.count; i++) {
        const geometry = this._geometryFor(layer.kind, seed++);
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        const instance = {
          mesh,
          kind: layer.kind,
          layer,
          side: i % 2 === 0 ? -1 : 1,
          z: START_OFFSET - i * layer.spacing,
          baseScale: 1,
          bob: 0,
          bobSpeed: 0.4 + Math.random() * 0.5,
        };
        this._randomise(instance, true);
        this.group.add(mesh);
        this.instances.push(instance);
      }
    }

    // Lighthouse lamps glow.
    for (const instance of this.instances) {
      if (instance.kind !== 'lighthouse') continue;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6), this.lampMaterial);
      lamp.position.set(0, 11.9, 0);
      instance.mesh.add(lamp);
      instance.lamp = lamp;
    }

    this._built = true;
    return this;
  }

  _geometryFor(kind, seed) {
    switch (kind) {
      case 'island':
      case 'far':
        return buildIsland(seed, this._palette);
      case 'cliff':
        return buildCliff(seed, this._palette);
      case 'rocks':
        return buildRockStack(seed);
      case 'buoy':
        return buildBuoyCluster(seed);
      case 'lighthouse':
        return buildLighthouse(seed, this._palette);
      default:
        return buildRockStack(seed);
    }
  }

  _randomise(instance, initial = false) {
    const layer = instance.layer;
    const rng = Math.random();
    const x = instance.side * (layer.minX + rng * (layer.maxX - layer.minX));
    const scale = layer.scale[0] + Math.random() * (layer.scale[1] - layer.scale[0]);
    instance.baseScale = scale;
    instance.mesh.position.set(x, 0, instance.z);
    instance.mesh.scale.setScalar(scale);
    instance.mesh.rotation.y = Math.random() * Math.PI * 2;
    if (instance.kind === 'far') instance.mesh.position.y = -1.5;
    if (initial) instance.side = Math.random() > 0.5 ? 1 : -1;
  }

  _clear() {
    for (const instance of this.instances) {
      this.group.remove(instance.mesh);
      instance.mesh.geometry.dispose();
      if (instance.lamp) instance.lamp.geometry.dispose();
    }
    this.instances.length = 0;
    this._built = false;
  }

  /** Rebuild lane guide ribbons for a lane layout. */
  setLaneGuides(visible, laneCount, laneWidth) {
    this.laneGuides.visible = visible;
    if (!visible) return;
    const geometry = this.laneGuides.geometry;
    geometry.dispose();
    const parts = [];
    const halfWidth = 0.11;
    for (let i = 0; i <= laneCount; i++) {
      const x = (i - laneCount / 2) * laneWidth;
      const strip = new THREE.PlaneGeometry(halfWidth * 2, 340, 1, 1);
      strip.rotateX(-Math.PI / 2);
      strip.translate(x, 0, -130);
      parts.push(strip);
    }
    const merged = mergeParts(parts);
    this.laneGuides.geometry = merged;
  }

  /**
   * @param {number} dt
   * @param {number} travelDelta
   * @param {number} time
   * @param {number} waveScale
   */
  update(dt, travelDelta, time, waveScale) {
    for (const instance of this.instances) {
      instance.z += travelDelta;
      if (instance.z > RECYCLE_Z) {
        instance.z -= instance.layer.count * instance.layer.spacing;
        instance.side = Math.random() > 0.5 ? 1 : -1;
        this._randomise(instance);
      }
      instance.mesh.position.z = instance.z;

      // Gentle bob for anything that floats.
      if (instance.kind === 'buoy') {
        instance.bob += dt * instance.bobSpeed;
        instance.mesh.position.y = Math.sin(instance.bob) * 0.28 - 0.1;
        instance.mesh.rotation.z = Math.sin(instance.bob * 0.8) * 0.09;
      } else if (instance.kind === 'rocks') {
        instance.mesh.position.y = Math.sin(time * 0.7 + instance.z * 0.1) * 0.12;
      }
      if (instance.lamp) {
        instance.lamp.material.color.setHSL(0.12, 0.9, 0.55 + Math.sin(time * 2.2 + instance.z * 0.05) * 0.25);
      }
    }

    this.guideUniforms.uTravel.value = (this.guideUniforms.uTravel.value ?? 0) + travelDelta;
    this.guideUniforms.uTime.value = time;
    this.guideUniforms.uWaveScale.value = waveScale;
  }

  setGuideOpacity(value) {
    this.guideUniforms.uOpacity.value = value;
  }

  dispose() {
    this._clear();
    this.material.dispose();
    this.lampMaterial.dispose();
    this.laneGuides.geometry.dispose();
    this.guideMaterial.dispose();
  }
}
