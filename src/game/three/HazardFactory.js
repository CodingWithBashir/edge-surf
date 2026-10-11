/**
 * Hazard mesh factory.
 *
 * One merged, vertex-coloured geometry is built per hazard type and shared by
 * every instance, so a screen full of rocks costs a handful of draw calls and
 * zero runtime allocation.
 */

import * as THREE from 'three';
import { part, mergeParts, propMaterial, rockGeometry, makeRandom } from './GeometryUtils.js';

const QUALITY = {
  low: { radial: 6, sphere: [7, 5], rockDetail: 0 },
  medium: { radial: 9, sphere: [10, 7], rockDetail: 1 },
  high: { radial: 14, sphere: [16, 11], rockDetail: 1 },
};

let currentQuality = 'high';
const cache = new Map();

export function setHazardQuality(quality) {
  if (quality === currentQuality) return;
  currentQuality = quality;
  disposeHazardGeometries();
}

export function disposeHazardGeometries() {
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

function buildRock(seed = 11) {
  const q = QUALITY[currentQuality];
  const parts = [
    part(rockGeometry(1.0, seed, q.rockDetail), 0x6b7a86, { position: [0, 0.25, 0], scale: [1.05, 1.5, 1.0] }),
    part(rockGeometry(0.55, seed + 3, q.rockDetail), 0x7d8b95, { position: [0.55, -0.1, 0.35], scale: [1, 0.8, 1] }),
    part(rockGeometry(0.42, seed + 9, q.rockDetail), 0x5d6a74, { position: [-0.5, -0.15, -0.4], scale: [1, 0.75, 1] }),
    // Algae skirt at the waterline.
    part(rockGeometry(0.95, seed + 21, 0), 0x2f6f52, { position: [0, -0.42, 0], scale: [1.1, 0.28, 1.05] }),
  ];
  return mergeParts(parts);
}

function buildRockFormation(seed = 31) {
  const q = QUALITY[currentQuality];
  const parts = [];
  for (const [x, s, r] of [
    [-1.15, 1.15, 0x5b6a76],
    [1.15, 1.0, 0x66757f],
    [0.1, 0.62, 0x74838d],
  ]) {
    parts.push(part(rockGeometry(s, seed + x * 13, q.rockDetail), r, { position: [x, s * 0.55 - 0.1, (x % 1) * 0.3], scale: [1, 1.5, 1] }));
  }
  parts.push(part(rockGeometry(1.35, seed + 77, 0), 0x2f6f52, { position: [0, -0.5, 0], scale: [1.05, 0.22, 0.9] }));
  return mergeParts(parts);
}

function buildCoral(seed = 5) {
  const q = QUALITY[currentQuality];
  const parts = [];
  const rng = makeRandom(seed);
  const base = new THREE.SphereGeometry(0.7, q.sphere[0], q.sphere[1]);
  parts.push(part(base, 0xff7a9c, { position: [0, -0.1, 0], scale: [1.2, 0.55, 1.2] }));
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + rng() * 0.6;
    const height = 0.55 + rng() * 0.75;
    const radius = 0.11 + rng() * 0.07;
    const tilt = 0.35 + rng() * 0.5;
    parts.push(
      part(new THREE.CylinderGeometry(radius * 0.5, radius, height, q.radial), i % 2 ? 0xff9ec7 : 0xffb3d1, {
        position: [Math.cos(angle) * 0.32, height * 0.4, Math.sin(angle) * 0.32],
        rotation: [Math.sin(angle) * tilt, 0, -Math.cos(angle) * tilt],
      })
    );
    parts.push(
      part(new THREE.SphereGeometry(radius * 1.5, q.sphere[0], q.sphere[1]), 0xffd6e6, {
        position: [Math.cos(angle) * (0.32 + Math.sin(tilt) * height * 0.35), height * 0.82, Math.sin(angle) * (0.32 + Math.sin(tilt) * height * 0.35)],
      })
    );
  }
  return mergeParts(parts);
}

function buildLog(seed = 17) {
  const q = QUALITY[currentQuality];
  const parts = [];
  const length = 2.6;
  const body = new THREE.CylinderGeometry(0.42, 0.42, length, q.radial, 1);
  body.rotateZ(Math.PI / 2);
  parts.push(part(body, 0x8a5a34));
  // Growth rings on the cut ends.
  parts.push(part(new THREE.CylinderGeometry(0.3, 0.3, 0.06, q.radial), 0xc59a6b, { position: [length / 2 + 0.02, 0, 0], rotation: [0, 0, Math.PI / 2] }));
  parts.push(part(new THREE.CylinderGeometry(0.3, 0.3, 0.06, q.radial), 0xc59a6b, { position: [-length / 2 - 0.02, 0, 0], rotation: [0, 0, Math.PI / 2] }));
  // Bark knots and a stubby branch.
  parts.push(part(new THREE.CylinderGeometry(0.09, 0.12, 0.7, q.radial), 0x7a4d2c, { position: [0.5, 0.3, 0.15], rotation: [0.4, 0, -0.6] }));
  parts.push(part(new THREE.SphereGeometry(0.16, q.sphere[0], q.sphere[1]), 0x3f6b3a, { position: [-0.4, 0.38, -0.15], scale: [1.6, 0.4, 1] }));
  return mergeParts(parts);
}

function buildBuoy(seed = 23, palette = { body: 0xff6b6b, band: 0xffffff, top: 0xffd166 }) {
  const q = QUALITY[currentQuality];
  const parts = [
    part(new THREE.SphereGeometry(0.62, q.sphere[0], q.sphere[1]), palette.body, { position: [0, 0.15, 0], scale: [1, 0.92, 1] }),
    part(new THREE.CylinderGeometry(0.63, 0.63, 0.22, q.radial), palette.band, { position: [0, 0.15, 0] }),
    part(new THREE.CylinderGeometry(0.1, 0.1, 1.5, q.radial), 0xdadada, { position: [0, 1.05, 0] }),
    part(new THREE.ConeGeometry(0.34, 0.5, q.radial), palette.top, { position: [0, 1.85, 0] }),
    part(new THREE.SphereGeometry(0.16, q.sphere[0], q.sphere[1]), 0x1b2a33, { position: [0, 1.62, 0] }),
    // Waterline fender.
    part(new THREE.TorusGeometry(0.6, 0.09, 6, q.radial), 0x2b3a44, { position: [0, -0.25, 0], rotation: [Math.PI / 2, 0, 0] }),
  ];
  return mergeParts(parts);
}

function buildWhitewater(seed = 41) {
  const q = QUALITY[currentQuality];
  const parts = [];
  const width = 4.6;

  // Slab of broken water.
  const slab = new THREE.BoxGeometry(width, 0.85, 1.1, 6, 2, 2);
  const pos = slab.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    if (y > 0) pos.setY(i, y + Math.sin(x * 1.4) * 0.12 + 0.1);
  }
  slab.computeVertexNormals();
  parts.push(part(slab, 0xdff4ff, { position: [0, -0.05, 0] }));

  // Rolling curl on the player-facing side.
  const curl = new THREE.CylinderGeometry(0.55, 0.5, width, q.radial * 2, 1, true, Math.PI * 0.15, Math.PI * 1.1);
  curl.rotateZ(Math.PI / 2);
  parts.push(part(curl, 0xf6fdff, { position: [0, 0.42, 0.42], rotation: [0, 0, 0] }));

  // Foam blobs.
  const rng = makeRandom(seed);
  for (let i = 0; i < 12; i++) {
    parts.push(
      part(new THREE.SphereGeometry(0.2 + rng() * 0.25, q.sphere[0], q.sphere[1]), i % 3 ? 0xffffff : 0xcfefff, {
        position: [(rng() - 0.5) * width * 0.95, 0.1 + rng() * 0.55, 0.1 + (rng() - 0.5) * 0.7],
        scale: [1, 0.7, 1],
      })
    );
  }
  return mergeParts(parts);
}

function buildDriftwood(seed = 53) {
  const q = QUALITY[currentQuality];
  const parts = [];
  const width = 3.2;
  const beam = new THREE.CylinderGeometry(0.3, 0.34, width, q.radial);
  beam.rotateZ(Math.PI / 2);
  parts.push(part(beam, 0xa9713f, { position: [0, 1.6, 0] }));

  const beam2 = new THREE.CylinderGeometry(0.2, 0.22, width * 0.8, q.radial);
  beam2.rotateZ(Math.PI / 2);
  parts.push(part(beam2, 0x8d5a30, { position: [0.2, 1.95, -0.15], rotation: [0, 0.12, 0.08] }));

  // Support posts so it reads as an overhead obstacle.
  parts.push(part(new THREE.CylinderGeometry(0.16, 0.2, 2.4, q.radial), 0x7a5230, { position: [-width / 2 + 0.1, 0.55, 0] }));
  parts.push(part(new THREE.CylinderGeometry(0.16, 0.2, 2.4, q.radial), 0x7a5230, { position: [width / 2 - 0.1, 0.55, 0] }));

  // Hanging kelp.
  const rng = makeRandom(seed);
  for (let i = 0; i < 5; i++) {
    parts.push(
      part(new THREE.BoxGeometry(0.09, 0.7 + rng() * 0.6, 0.02), 0x3f6b3a, {
        position: [(rng() - 0.5) * width * 0.85, 1.25, 0.1],
        rotation: [0, 0, (rng() - 0.5) * 0.4],
      })
    );
  }
  return mergeParts(parts);
}

function buildJellyfish(seed = 61) {
  const q = QUALITY[currentQuality];
  const parts = [];
  parts.push(
    part(new THREE.SphereGeometry(0.8, q.sphere[0], q.sphere[1]), 0xb388ff, {
      position: [0, 1.7, 0],
      scale: [1, 0.78, 1],
    })
  );
  parts.push(part(new THREE.SphereGeometry(0.6, q.sphere[0], q.sphere[1]), 0xd9c2ff, { position: [0, 1.55, 0], scale: [1, 0.5, 1] }));
  const rng = makeRandom(seed);
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const length = 0.9 + rng() * 0.8;
    parts.push(
      part(new THREE.CylinderGeometry(0.035, 0.015, length, 5), 0xe0ccff, {
        position: [Math.cos(angle) * 0.42, 1.7 - length / 2, Math.sin(angle) * 0.42],
      })
    );
  }
  return mergeParts(parts);
}

function buildStormDebris(seed = 71) {
  const q = QUALITY[currentQuality];
  const parts = [];
  const rng = makeRandom(seed);
  parts.push(part(new THREE.BoxGeometry(0.9, 0.75, 0.8), 0xc9b28a, { position: [0, 0.4, 0], rotation: [0, rng() * 0.5, 0.08] }));
  parts.push(part(new THREE.BoxGeometry(0.95, 0.1, 0.86), 0x8a6f4a, { position: [0, 0.76, 0], rotation: [0, rng() * 0.5, 0.08] }));
  parts.push(part(new THREE.CylinderGeometry(0.3, 0.3, 0.9, q.radial), 0x7d8f9c, { position: [0.85, 0.28, 0.2], rotation: [Math.PI / 2, 0, 0.3] }));
  parts.push(part(new THREE.BoxGeometry(1.5, 0.08, 0.28), 0x9c7a4e, { position: [-0.5, 0.1, -0.5], rotation: [0.1, 0.5, 0.22] }));
  return mergeParts(parts);
}

function buildWhirlpool(seed = 83) {
  const q = QUALITY[currentQuality];
  const parts = [];
  parts.push(part(new THREE.TorusGeometry(1.5, 0.22, 6, q.radial * 3), 0x1d4e6b, { rotation: [Math.PI / 2, 0, 0], position: [0, 0.05, 0] }));
  parts.push(part(new THREE.TorusGeometry(1.0, 0.18, 6, q.radial * 3), 0x2a6f92, { rotation: [Math.PI / 2, 0, 0], position: [0, -0.08, 0] }));
  parts.push(part(new THREE.ConeGeometry(0.6, 1.5, q.radial * 2, 1, true), 0x113449, { position: [0, -0.75, 0], rotation: [Math.PI, 0, 0] }));
  const rng = makeRandom(seed);
  for (let i = 0; i < 10; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 0.8 + rng() * 1.1;
    parts.push(
      part(new THREE.SphereGeometry(0.16 + rng() * 0.14, q.sphere[0], q.sphere[1]), i % 2 ? 0x9fd8ee : 0xffffff, {
        position: [Math.cos(angle) * radius, 0.05, Math.sin(angle) * radius],
        scale: [1.6, 0.4, 0.7],
        rotation: [0, -angle, 0],
      })
    );
  }
  return mergeParts(parts);
}

function buildSpinner(seed = 97) {
  const q = QUALITY[currentQuality];
  const parts = [];
  const width = 4.6;
  const boom = new THREE.CylinderGeometry(0.32, 0.32, width, q.radial);
  boom.rotateZ(Math.PI / 2);
  parts.push(part(boom, 0xe0c068));
  for (let i = -2; i <= 2; i++) {
    parts.push(part(new THREE.CylinderGeometry(0.35, 0.35, 0.34, q.radial), i % 2 ? 0x2b3a44 : 0xf2f5f7, { position: [i * 0.9, 0, 0], rotation: [0, 0, Math.PI / 2] }));
  }
  parts.push(part(new THREE.SphereGeometry(0.42, q.sphere[0], q.sphere[1]), 0xff6b6b, { position: [-width / 2, 0, 0] }));
  parts.push(part(new THREE.SphereGeometry(0.42, q.sphere[0], q.sphere[1]), 0xff6b6b, { position: [width / 2, 0, 0] }));
  return mergeParts(parts);
}

const BUILDERS = {
  rock: buildRock,
  rockFormation: buildRockFormation,
  coral: buildCoral,
  log: buildLog,
  buoy: () => buildBuoy(23, { body: 0xff6b6b, band: 0xffffff, top: 0xffd166 }),
  movingBuoy: () => buildBuoy(29, { body: 0xffa94d, band: 0x2b3a44, top: 0xffe066 }),
  whitewater: buildWhitewater,
  driftwood: buildDriftwood,
  jellyfish: buildJellyfish,
  stormDebris: buildStormDebris,
  whirlpool: buildWhirlpool,
  spinner: buildSpinner,
  narrowPassage: buildRock,
};

/** Shared material for every hazard instance. */
export function hazardMaterial() {
  return propMaterial({ roughness: 0.85, flatShading: true });
}

/**
 * Get (and cache) the geometry for a hazard type.
 * @param {string} id
 */
export function getHazardGeometry(id) {
  if (cache.has(id)) return cache.get(id);
  const builder = BUILDERS[id] ?? BUILDERS.rock;
  const geometry = builder();
  cache.set(id, geometry);
  return geometry;
}
