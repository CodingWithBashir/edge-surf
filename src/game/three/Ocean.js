/**
 * The ocean surface.
 *
 * One large plane displaced in the vertex shader by a sum of five directional
 * sine waves. The same wave table is evaluated on the CPU (`waveHeight`,
 * `waveNormal`) so the surfer, hazards, particles and camera all agree with the
 * pixels on screen.
 *
 * The plane is baked into world space (rotated + translated once at build time)
 * so the shader can treat `position.xz` as world coordinates, and the illusion
 * of travel comes from a `uTravel` uniform rather than moving any geometry.
 */

import * as THREE from 'three';
import { GLSL_WAVES, GLSL_NOISE, GLSL_SKY, GLSL_FOG } from './shaders/common.glsl.js';
import { TAU } from '../../core/MathUtils.js';

/** Mirrors WAVE_A..WAVE_E in common.glsl.js — keep the two in sync. */
const WAVE_TABLE = [
  // dirX, dirZ, wavelength, amplitude
  [0.0, 1.0, 27.0, 0.62],
  [0.722, 0.692, 15.0, 0.3],
  [-0.622, 0.783, 8.6, 0.15],
  [0.924, -0.382, 4.4, 0.065],
  [0.86, 0.51, 2.3, 0.03],
];
const WAVE_SPEEDS = [1.0, 1.14, 1.28, 1.42, 0.0];

/**
 * The water surface is a *trapezoid*, not a rectangle: it is narrow and finely
 * tessellated right around the surfer, and fans out toward the horizon so its
 * edges always stay outside the camera frustum. A uniform grid large enough to
 * reach the horizon would either waste vertices or facet badly up close.
 */
export const OCEAN_EXTENT = Object.freeze({
  nearZ: 78, // slightly behind the camera
  farZ: -430,
  halfWidthNear: 26,
  halfWidthFar: 440,
  /** How far the fine detail is stretched along Z (1 = uniform). */
  zBias: 0.35,
  /** Lateral fan exponent (>1 concentrates samples near the centre line). */
  xBias: 1.45,
  widthBias: 1.3,
});

const QUALITY_SEGMENTS = {
  low: [64, 120],
  medium: [96, 190],
  high: [130, 250],
};

/**
 * Build the trapezoidal water grid.
 * @param {number} segX samples across the fan
 * @param {number} segZ samples along the course
 */
function buildOceanGeometry(segX, segZ) {
  const { nearZ, farZ, halfWidthNear, halfWidthFar, zBias, xBias, widthBias } = OCEAN_EXTENT;
  const cols = segX + 1;
  const rows = segZ + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices = new Uint32Array(segX * segZ * 6);

  let p = 0;
  let t = 0;
  for (let j = 0; j < rows; j++) {
    const v = j / segZ;
    // Quadratic ramp: dense near the camera, stretching out with distance.
    const z = nearZ + (farZ - nearZ) * (zBias * v + (1 - zBias) * v * v);
    const halfWidth = halfWidthNear + (halfWidthFar - halfWidthNear) * Math.pow(v, widthBias);
    for (let i = 0; i < cols; i++) {
      const u = (i / segX) * 2 - 1;
      const x = Math.sign(u) * Math.pow(Math.abs(u), xBias) * halfWidth;
      positions[p++] = x;
      positions[p++] = 0;
      positions[p++] = z;
      uvs[t++] = i / segX;
      uvs[t++] = v;
    }
  }

  let k = 0;
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Winding chosen so the face normal points up (+Y).
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, farZ * 0.4), Math.abs(farZ) + halfWidthFar);
  return geometry;
}

/**
 * Water height at a world position.
 * @param {number} x @param {number} z
 * @param {number} travel distance surfed
 * @param {number} time seconds
 * @param {number} scale wave amplitude multiplier
 */
export function waveHeight(x, z, travel, time = 0, scale = 1) {
  let h = 0;
  for (let i = 0; i < WAVE_TABLE.length; i++) {
    const w = WAVE_TABLE[i];
    const k = TAU / w[2];
    const amp = w[3] * scale;
    const coord = i < 4 ? w[0] * x + w[1] * (z - travel * WAVE_SPEEDS[i]) : w[0] * x + w[1] * z + time * 2.4;
    h += amp * Math.sin(k * coord);
  }
  return h;
}

/**
 * Surface normal (unit) at a world position.
 * @param {{x:number,y:number,z:number}} out
 */
export function waveNormal(x, z, travel, time = 0, scale = 1, out = new THREE.Vector3()) {
  let dx = 0;
  let dz = 0;
  for (let i = 0; i < WAVE_TABLE.length; i++) {
    const w = WAVE_TABLE[i];
    const k = TAU / w[2];
    const amp = w[3] * scale;
    const coord = i < 4 ? w[0] * x + w[1] * (z - travel * WAVE_SPEEDS[i]) : w[0] * x + w[1] * z + time * 2.4;
    const c = Math.cos(k * coord);
    dx += amp * k * w[0] * c;
    dz += amp * k * w[1] * c;
  }
  return out.set(-dx, 1, -dz).normalize();
}

const vertexShader = /* glsl */ `
uniform float uTravel;
uniform float uTime;
uniform float uWaveScale;

varying vec3 vWorldPos;
varying vec3 vSurfaceNormal;
varying float vHeight;
varying float vSlope;
varying float vViewDist;

${GLSL_WAVES}

void main() {
  vec3 field = waveField(position.xz, uTravel, uTime, uWaveScale);
  vec3 displaced = vec3(position.x, field.x, position.z);

  vWorldPos = displaced;
  vSurfaceNormal = normalize(vec3(-field.y, 1.0, -field.z));
  vHeight = field.x;
  vSlope = length(vec2(field.y, field.z));

  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  vViewDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform float uTravel;
uniform float uTime;
uniform float uWaveScale;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uFoamAmount;
uniform vec3 uSunDir;
uniform vec3 uSunTint;
uniform float uSunSize;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uBiolum;
uniform float uOpacity;

varying vec3 vWorldPos;
varying vec3 vSurfaceNormal;
varying float vHeight;
varying float vSlope;
varying float vViewDist;

${GLSL_NOISE}
${GLSL_SKY}
${GLSL_FOG}

void main() {
  vec3 n = normalize(vSurfaceNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDir);

  // --- body colour ---------------------------------------------------
  float heightMix = smoothstep(-0.7, 1.0, vHeight);
  vec3 base = mix(uDeep, uShallow, heightMix * 0.55);

  // Cheap subsurface: light bleeding through the back of a wave face.
  float sss = pow(max(dot(n, sunDir), 0.0), 2.5) * max(vHeight, 0.0);
  base += uSunTint * sss * 0.30;

  // --- reflection ----------------------------------------------------
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 4.0);
  vec3 refl = reflect(-viewDir, n);
  // Keep the reflection above the horizon so it never samples the "ground".
  refl.y = abs(refl.y) * 0.55 + 0.03;
  vec3 sky = skyGradient(normalize(refl), sunDir, uSkyZenith, uSkyHorizon, uSunTint, uSunSize);
  vec3 col = mix(base, sky, clamp(fres * 0.85 + 0.14, 0.0, 0.92));

  // --- specular glitter ----------------------------------------------
  vec3 halfVec = normalize(sunDir + viewDir);
  float spec = pow(max(dot(n, halfVec), 0.0), 300.0);
  col += uSunTint * spec * 1.8;
  float glitter = pow(max(dot(n, halfVec), 0.0), 60.0);
  col += uSunTint * glitter * 0.06;

  // --- foam -----------------------------------------------------------
  float crests = smoothstep(0.45 * uWaveScale, 1.0 * uWaveScale, vHeight);
  float steep = smoothstep(0.30, 1.15, vSlope);
  float breakup = fbm21(vWorldPos.xz * 0.6 + vec2(uTravel * 0.05, uTime * 0.12));
  float foam = clamp(crests * 0.95 + steep * 0.4, 0.0, 1.0) * smoothstep(0.28, 0.72, breakup + 0.22);
  float streak = smoothstep(0.80, 1.0, fbm21(vec2(vWorldPos.x * 0.4, (vWorldPos.z - uTravel * 0.85) * 0.24)));
  foam = clamp(foam + streak * crests * 0.55, 0.0, 1.0) * uFoamAmount;
  col = mix(col, uFoam, foam);

  // Night sessions get a little bioluminescence in the chop.
  if (uBiolum > 0.001) {
    float pulse = 0.45 + 0.55 * sin(uTime * 2.6 + vWorldPos.z * 0.55 + vWorldPos.x * 0.2);
    col += vec3(0.18, 0.95, 0.82) * uBiolum * pow(steep, 3.0) * pulse * 0.30;
  }

  col = applyFog(col, vViewDist, uFogColor, uFogNear, uFogFar);
  gl_FragColor = vec4(col, uOpacity);
}
`;

export class Ocean {
  /**
   * @param {{quality?:'low'|'medium'|'high'}} [options]
   */
  constructor(options = {}) {
    this.quality = options.quality ?? 'high';
    this.travel = 0;
    this.time = 0;
    this.waveScale = 1;

    this.uniforms = {
      uTravel: { value: 0 },
      uTime: { value: 0 },
      uWaveScale: { value: 1 },
      uDeep: { value: new THREE.Color(0x05243f) },
      uShallow: { value: new THREE.Color(0x1a8fa8) },
      uFoam: { value: new THREE.Color(0xf2fbff) },
      uFoamAmount: { value: 0.85 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.55, -0.72).normalize() },
      uSunTint: { value: new THREE.Color(0xfff0c9) },
      uSunSize: { value: 1 },
      uSkyZenith: { value: new THREE.Color(0x1c6fb8) },
      uSkyHorizon: { value: new THREE.Color(0xbfe6f5) },
      uFogColor: { value: new THREE.Color(0xbfe6f5) },
      uFogNear: { value: 70 },
      uFogFar: { value: 300 },
      uBiolum: { value: 0 },
      uOpacity: { value: 1 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: false,
      depthWrite: true,
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.Mesh(this._buildGeometry(this.quality), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'ocean';
  }

  _buildGeometry(quality) {
    const [segX, segZ] = QUALITY_SEGMENTS[quality] ?? QUALITY_SEGMENTS.high;
    return buildOceanGeometry(segX, segZ);
  }

  /** Rebuild the mesh at a different tessellation level. */
  setQuality(quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    const old = this.mesh.geometry;
    this.mesh.geometry = this._buildGeometry(quality);
    old.dispose();
  }

  /** Apply an environment preset (colours, sun, fog). */
  setEnvironment(preset) {
    const u = this.uniforms;
    u.uDeep.value.set(preset.waterDeep);
    u.uShallow.value.set(preset.waterShallow);
    u.uFoam.value.set(preset.foam);
    u.uFoamAmount.value = preset.foamAmount;
    u.uSunDir.value.copy(preset.sunDirection).normalize();
    u.uSunTint.value.set(preset.sunTint);
    u.uSunSize.value = preset.sunSize;
    u.uSkyZenith.value.set(preset.skyZenith);
    u.uSkyHorizon.value.set(preset.skyHorizon);
    u.uFogColor.value.set(preset.fogColor);
    u.uFogNear.value = preset.fogNear;
    u.uFogFar.value = preset.fogFar;
    u.uBiolum.value = preset.bioluminescence ?? 0;
  }

  setWaveScale(scale) {
    this.waveScale = scale;
    this.uniforms.uWaveScale.value = scale;
  }

  /** @param {number} dt @param {number} travelDelta */
  update(dt, travelDelta) {
    this.time += dt;
    this.travel += travelDelta;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uTravel.value = this.travel;
  }

  /** CPU query matching the rendered surface. */
  heightAt(x, z) {
    return waveHeight(x, z, this.travel, this.time, this.waveScale);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    return waveNormal(x, z, this.travel, this.time, this.waveScale, out);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
