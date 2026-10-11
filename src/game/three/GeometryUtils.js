/**
 * Geometry helpers.
 *
 * Every prop in Surf Rush is generated from primitives and then merged into a
 * single vertex-coloured buffer. That keeps the draw-call count low (one mesh
 * per island, cliff or hazard) while still allowing rich shapes.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _matrix = new THREE.Matrix4();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * Bake a flat colour into a geometry's `color` attribute.
 * @param {THREE.BufferGeometry} geometry
 * @param {number} hex
 */
export function paint(geometry, hex) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  _color.set(hex).convertSRGBToLinear();
  for (let i = 0; i < count; i++) {
    colors[i * 3 + 0] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Transform a geometry in place.
 * @param {THREE.BufferGeometry} geometry
 * @param {{position?:[number,number,number], rotation?:[number,number,number], scale?:[number,number,number]|number}} spec
 */
export function place(geometry, spec = {}) {
  const p = spec.position ?? [0, 0, 0];
  const r = spec.rotation ?? [0, 0, 0];
  const s = spec.scale ?? 1;
  _pos.set(p[0], p[1], p[2]);
  _euler.set(r[0], r[1], r[2]);
  _quat.setFromEuler(_euler);
  if (typeof s === 'number') _scale.set(s, s, s);
  else _scale.set(s[0], s[1], s[2]);
  _matrix.compose(_pos, _quat, _scale);
  geometry.applyMatrix4(_matrix);
  return geometry;
}

/**
 * Build + paint + transform a primitive in one call.
 * @param {THREE.BufferGeometry} geometry
 * @param {number} color
 * @param {Object} spec
 */
export function part(geometry, color, spec = {}) {
  place(geometry, spec);
  paint(geometry, color);
  return geometry;
}

const KEEP_ATTRIBUTES = ['position', 'normal', 'uv', 'color'];

/**
 * Merge parts into one geometry.
 *
 * `mergeGeometries` requires every input to agree on an index buffer and on the
 * attribute set, while three's primitives disagree (ExtrudeGeometry is
 * non-indexed, CylinderGeometry is indexed). Normalising here keeps the
 * builders free to mix primitives.
 *
 * @param {THREE.BufferGeometry[]} geometries
 */
export function mergeParts(geometries) {
  if (!geometries.length) return new THREE.BufferGeometry();
  if (geometries.length === 1) return geometries[0];

  const nonIndexed = geometries.some((g) => g.index === null);
  const normalised = geometries.map((geometry) => {
    let result = geometry;
    if (nonIndexed && result.index !== null) {
      const converted = result.toNonIndexed();
      result.dispose();
      result = converted;
    }
    for (const name of Object.keys(result.attributes)) {
      if (!KEEP_ATTRIBUTES.includes(name)) result.deleteAttribute(name);
    }
    if (!result.attributes.normal) result.computeVertexNormals();
    if (!result.attributes.uv) {
      const count = result.attributes.position.count;
      result.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (!result.attributes.color) paint(result, 0xffffff);
    return result;
  });

  const merged = mergeGeometries(normalised, false);
  for (const geometry of normalised) geometry.dispose();
  return merged;
}

/** Standard material for merged vertex-coloured props. */
export function propMaterial(options = {}) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: options.flatShading ?? true,
    roughness: options.roughness ?? 0.88,
    metalness: options.metalness ?? 0.02,
    ...(options.extra ?? {}),
  });
}

/**
 * A lumpy rock: an icosahedron with per-vertex noise displacement.
 * @param {number} radius @param {number} seed @param {number} [detail]
 */
export function rockGeometry(radius = 1, seed = 1, detail = 1) {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 1.9 + seed) * 0.5 + Math.sin(v.y * 2.4 + seed * 1.7) * 0.32 + Math.sin(v.z * 2.1 + seed * 2.3) * 0.4;
    const squash = 1 + n * 0.28;
    v.multiplyScalar(squash);
    v.y *= 0.92;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Deterministic PRNG for prop generation (avoids Math.random in builders). */
export function makeRandom(seed = 1) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
