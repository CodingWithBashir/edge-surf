/**
 * Sky dome, sun, clouds and lighting.
 *
 * The dome is a shader sphere rendered from the inside: an analytic gradient
 * plus a sun disc, procedural fbm clouds and (at night) a star field. Because
 * the same `skyGradient()` function is compiled into the water shader, ocean
 * reflections match the sky exactly — no cube map needed.
 *
 * Rain is a recycled point cloud that only exists while the weather is stormy.
 */

import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SKY } from './shaders/common.glsl.js';
import { ENVIRONMENTS, WEATHER } from '../config/Environments.js';

const DOME_RADIUS = 620;

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFragment = /* glsl */ `
precision highp float;

uniform vec3 uSunDir;
uniform vec3 uSunTint;
uniform float uSunSize;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uCloudAmount;
uniform vec3 uCloudColor;
uniform vec3 uCloudTint;
uniform float uTime;
uniform float uDrift;
uniform float uStars;
uniform float uDarken;
uniform float uFlash;

varying vec3 vDir;

${GLSL_NOISE}
${GLSL_SKY}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyGradient(dir, uSunDir, uZenith, uHorizon, uSunTint, uSunSize);

  // --- clouds ---------------------------------------------------------
  if (uCloudAmount > 0.001 && dir.y > 0.005) {
    vec2 uv = dir.xz / max(dir.y, 0.06);
    float horizonFade = smoothstep(0.005, 0.30, dir.y);
    float base = fbm21(uv * 0.55 + vec2(uDrift * 0.35, uDrift * 0.12));
    float detail = fbm21(uv * 1.6 + vec2(uDrift * 0.7, uTime * 0.02));
    float cover = smoothstep(0.52 - uCloudAmount * 0.34, 0.86, base * 0.75 + detail * 0.35);
    vec3 cloud = mix(uCloudColor, uCloudTint, clamp(detail * 0.9, 0.0, 1.0));
    // Sun-lit cloud edges.
    float lit = pow(max(dot(dir, normalize(uSunDir)) * 0.5 + 0.5, 0.0), 3.0);
    cloud += uSunTint * lit * 0.22;
    col = mix(col, cloud, cover * horizonFade * clamp(uCloudAmount + 0.15, 0.0, 1.0));
  }

  // --- stars ----------------------------------------------------------
  if (uStars > 0.001) {
    vec2 sp = vec2(atan(dir.z, dir.x) * 2.6, dir.y * 4.2) * 46.0;
    vec2 cell = floor(sp);
    float rnd = hash21(cell);
    float star = smoothstep(0.9975, 0.99995, rnd);
    float twinkle = 0.55 + 0.45 * sin(uTime * 2.4 + rnd * 60.0);
    col += vec3(0.85, 0.92, 1.0) * star * twinkle * uStars * smoothstep(-0.02, 0.35, dir.y);
  }

  col *= (1.0 - uDarken);
  col += vec3(0.7, 0.82, 1.0) * uFlash;

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(options = {}) {
    this.group = new THREE.Group();
    this.group.name = 'sky';

    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0.34, 0.5, -0.8).normalize() },
      uSunTint: { value: new THREE.Color(0xfff4d4) },
      uSunSize: { value: 1 },
      uZenith: { value: new THREE.Color(0x2f86cc) },
      uHorizon: { value: new THREE.Color(0xc9ecfa) },
      uCloudAmount: { value: 0.42 },
      uCloudColor: { value: new THREE.Color(0xffffff) },
      uCloudTint: { value: new THREE.Color(0x9dc9e6) },
      uTime: { value: 0 },
      uDrift: { value: 0 },
      uStars: { value: 0 },
      uDarken: { value: 0 },
      uFlash: { value: 0 },
    };

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS, 40, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.group.add(this.dome);

    // --- lighting -----------------------------------------------------
    this.sunLight = new THREE.DirectionalLight(0xfff2d2, 1.7);
    this.sunLight.position.set(24, 40, -56);
    this.sunLight.castShadow = false;
    this.group.add(this.sunLight);
    this.group.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0xc9ecfa, 0x1b4a63, 0.9);
    this.group.add(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight(0x2a5c7c, 0.42);
    this.group.add(this.ambientLight);

    // --- weather ------------------------------------------------------
    this.rain = this._buildRain();
    this.rain.visible = false;
    this.group.add(this.rain);

    this.environment = ENVIRONMENTS.day;
    this.weather = WEATHER.clear;
    this._lightningTimer = 4 + Math.random() * 6;
    this._flash = 0;
    this._elapsed = 0;
  }

  _buildRain() {
    const count = 2600;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 90;
      positions[i * 3 + 1] = Math.random() * 60;
      positions[i * 3 + 2] = -Math.random() * 150 + 20;
      speeds[i] = 55 + Math.random() * 45;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xbfe0f5,
      size: 0.42,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.userData.speeds = speeds;
    return points;
  }

  /** @param {'day'|'sunset'|'night'} id */
  setEnvironment(id) {
    const preset = ENVIRONMENTS[id] ?? ENVIRONMENTS.day;
    this.environment = preset;
    const u = this.uniforms;
    u.uZenith.value.set(preset.skyZenith);
    u.uHorizon.value.set(preset.skyHorizon);
    u.uSunTint.value.set(preset.sunTint);
    u.uSunSize.value = preset.sunSize;
    u.uCloudColor.value.set(preset.cloudColor);
    u.uCloudTint.value.set(preset.cloudTint);
    u.uStars.value = id === 'night' ? 1 : 0;
    this.sunLight.color.set(preset.sunColor);
    this.hemiLight.color.set(preset.hemiSky);
    this.hemiLight.groundColor.set(preset.hemiGround);
    this.ambientLight.color.set(preset.ambientColor);
    this.applyWeather(this.weather.id);
  }

  /** @param {'clear'|'cloudy'|'storm'} id */
  setWeather(id) {
    this.applyWeather(id);
  }

  /** @param {'clear'|'cloudy'|'storm'} id */
  applyWeather(id) {
    const weather = WEATHER[id] ?? WEATHER.clear;
    this.weather = weather;
    const env = this.environment;
    const u = this.uniforms;

    u.uCloudAmount.value = Math.min(1, env.cloudAmount + weather.cloudBoost);
    u.uDarken.value = weather.darken;

    const sunScale = weather.sunScale;
    this.sunLight.intensity = env.sunIntensity * sunScale;
    this.hemiLight.intensity = env.hemiIntensity * (1 - weather.darken * 0.8);
    this.ambientLight.intensity = env.ambientIntensity * (1 - weather.darken * 0.5);

    const dir = env.sunDirection;
    this.sunLight.position.set(dir[0] * 120, dir[1] * 120 + 20, dir[2] * 120);
    this.sunLight.target.position.set(0, 0, -20);
    u.uSunDir.value.set(dir[0], dir[1], dir[2]).normalize();

    this.rain.visible = weather.rain > 0;
    this._lightningEnabled = weather.lightning > 0;
  }

  /** Sun direction as a normalised vector (shared with the water shader). */
  get sunDirection() {
    return this.uniforms.uSunDir.value;
  }

  /**
   * @param {number} dt
   * @param {number} travelDelta
   * @param {THREE.Vector3} cameraPosition
   */
  update(dt, travelDelta, cameraPosition) {
    this._elapsed += dt;
    const u = this.uniforms;
    u.uTime.value = this._elapsed;
    u.uDrift.value += travelDelta * 0.012 + dt * 0.02 * (0.3 + this.weather.wind);

    // Keep the dome centred on the camera so it never clips.
    this.dome.position.set(cameraPosition.x, 0, cameraPosition.z);

    if (this.rain.visible) {
      const positions = this.rain.geometry.attributes.position.array;
      const speeds = this.rain.userData.speeds;
      const wind = this.weather.wind;
      for (let i = 0; i < speeds.length; i++) {
        const i3 = i * 3;
        positions[i3 + 1] -= speeds[i] * dt;
        positions[i3 + 0] += wind * 16 * dt;
        positions[i3 + 2] += 42 * dt;
        if (positions[i3 + 1] < -4) {
          positions[i3 + 1] = 58 + Math.random() * 12;
          positions[i3 + 0] = cameraPosition.x + (Math.random() - 0.5) * 90;
          positions[i3 + 2] = cameraPosition.z - Math.random() * 150 + 20;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // Lightning flashes during storms.
    if (this._lightningEnabled) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningTimer = 4 + Math.random() * 9;
        this._flash = 0.85;
        this.userDataThunder = true;
      }
    }
    this._flash = Math.max(0, this._flash - dt * 2.6);
    u.uFlash.value = this._flash;
  }

  /** True on the frame a lightning strike fires (consumed by the Game). */
  consumeThunder() {
    if (this.userDataThunder) {
      this.userDataThunder = false;
      return true;
    }
    return false;
  }

  dispose() {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.rain.geometry.dispose();
    this.rain.material.dispose();
  }
}
