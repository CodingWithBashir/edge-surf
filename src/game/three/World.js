/**
 * World assembly.
 *
 * Owns the renderer, scene graph and every 3D subsystem, and exposes a small
 * surface for the Game layer (`update`, `render`, `applyEnvironment`,
 * `setQuality`). Nothing in here knows about scoring, menus or input.
 */

import * as THREE from 'three';
import { Ocean } from './Ocean.js';
import { Sky } from './Sky.js';
import { Scenery } from './Scenery.js';
import { ParticleManager } from './Particles.js';
import { ObstacleManager } from './ObstacleManager.js';
import { CollectibleManager } from './CollectibleManager.js';
import { Player } from './Player.js';
import { Kraken } from './Kraken.js';
import { CameraRig, CameraMode } from './CameraRig.js';
import { ENVIRONMENTS, WEATHER } from '../config/Environments.js';
import { clamp01, damp, lerp } from '../../core/MathUtils.js';

const PIXEL_RATIO = { low: 1, medium: 1.4, high: 2 };

/* ------------------------------------------------------------------ *
 * Contact shadow decals
 * ------------------------------------------------------------------ */

const decalVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const decalFragment = /* glsl */ `
precision mediump float;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.15, d) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.01, 0.06, 0.10, a);
}
`;

class ShadowDecals {
  constructor(parent, capacity = 16) {
    this.group = new THREE.Group();
    this.group.name = 'shadows';
    parent.add(this.group);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0.3 } },
      vertexShader: decalVertex,
      fragmentShader: decalFragment,
      transparent: true,
      depthWrite: false,
    });
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.pool = [];
    for (let i = 0; i < capacity; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.pool.push(mesh);
    }
    this.enabled = true;
  }

  begin() {
    this.cursor = 0;
  }

  /** @param {number} x @param {number} y @param {number} z @param {number} radius */
  place(x, y, z, radius, opacity = 0.32) {
    if (!this.enabled || this.cursor >= this.pool.length) return;
    const mesh = this.pool[this.cursor++];
    mesh.visible = true;
    mesh.position.set(x, y + 0.07, z);
    mesh.scale.set(radius * 2, 1, radius * 2);
    mesh.material.opacity = opacity;
  }

  end() {
    for (let i = this.cursor; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.group.visible = enabled;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Renderer creation
 * ------------------------------------------------------------------ */

export function createRenderer(canvas, quality = 'high') {
  const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) || null;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality !== 'low',
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    context: gl ?? undefined,
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, PIXEL_RATIO[quality] ?? 2));
  renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = false;
  return renderer;
}

/* ------------------------------------------------------------------ *
 * World
 * ------------------------------------------------------------------ */

export class World {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{quality?:string, shadows?:boolean}} [options]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.quality = options.quality ?? 'high';
    this.shadowsEnabled = options.shadows !== false;

    this.renderer = createRenderer(canvas, this.quality);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1400);
    this.camera.position.set(0, 5, 14);

    this.ocean = new Ocean({ quality: this.quality });
    this.sky = new Sky();
    this.scenery = new Scenery({ quality: this.quality });
    this.particles = new ParticleManager({ quality: this.quality });
    this.obstacles = new ObstacleManager(this.scene, { quality: this.quality });
    this.collectibles = new CollectibleManager(this.scene, { quality: this.quality });
    this.player = new Player(this.scene, { quality: this.quality });
    this.kraken = new Kraken(this.scene, { quality: this.quality });
    this.cameraRig = new CameraRig(this.camera);
    this.decals = new ShadowDecals(this.scene);

    this.scene.add(this.ocean.mesh);
    this.scene.add(this.sky.group);
    this.scene.add(this.scenery.group);
    this.scene.add(this.particles.group);

    this.obstacles.attach(null, this.ocean);

    this.environmentId = 'day';
    this.weatherId = 'clear';
    this.waveScale = 1;
    this._targetWaveScale = 1;
    this.time = 0;
    this.applyEnvironment('day', 'clear');

    this.scenery.build(ENVIRONMENTS.day.islandPalette, { quality: this.quality });
    this.resize();
  }

  /** @param {'day'|'sunset'|'night'} environmentId @param {'clear'|'cloudy'|'storm'} weatherId */
  applyEnvironment(environmentId, weatherId) {
    const env = ENVIRONMENTS[environmentId] ?? ENVIRONMENTS.day;
    const weather = WEATHER[weatherId] ?? WEATHER.clear;
    this.environmentId = env.id;
    this.weatherId = weather.id;

    this.sky.setEnvironment(env.id);
    this.sky.setWeather(weather.id);
    this.ocean.setEnvironment({
      ...env,
      fogNear: env.fogNear * weather.fogScale,
      fogFar: env.fogFar * weather.fogScale,
      foamAmount: env.foamAmount * (weather.id === 'storm' ? 1.15 : 1),
      sunDirection: new THREE.Vector3(...env.sunDirection).normalize(),
    });
    this.renderer.toneMappingExposure = env.exposure * (1 - weather.darken * 0.35);

    this.scenery.build(env.islandPalette, { quality: this.quality });
    this._targetWaveScale = weather.waveScale;
    this._weather = weather;
    this._env = env;
  }

  /** Smoothly blend the swell size (big-wave events, storms). */
  setWaveScale(scale, immediate = false) {
    this._targetWaveScale = scale;
    if (immediate) {
      this.waveScale = scale;
      this.ocean.setWaveScale(scale);
    }
  }

  setQuality(quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.ocean.setQuality(quality);
    this.obstacles.setQuality(quality);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, PIXEL_RATIO[quality] ?? 2));
    this.scenery.build((this._env ?? ENVIRONMENTS.day).islandPalette, { quality });
    this.resize();
  }

  setShadows(enabled) {
    this.shadowsEnabled = enabled;
    this.decals.setEnabled(enabled);
  }

  setLaneGuides(visible, laneCount, laneWidth) {
    this.scenery.setLaneGuides(visible, laneCount, laneWidth);
  }

  resize() {
    const canvas = this.canvas;
    const width = canvas.clientWidth || globalThis.innerWidth || 800;
    const height = canvas.clientHeight || globalThis.innerHeight || 600;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, PIXEL_RATIO[this.quality] ?? 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Advance every visual subsystem.
   * @param {number} dt
   * @param {number} travelDelta world units moved this frame
   * @param {{krakenGap?:number, krakenState?:string, playerAlive?:boolean}} [ctx]
   */
  update(dt, travelDelta, ctx = {}) {
    this.time += dt;
    const weather = this._weather ?? WEATHER.clear;

    if (Math.abs(this.waveScale - this._targetWaveScale) > 0.001) {
      this.waveScale = damp(this.waveScale, this._targetWaveScale, 1.6, dt);
      this.ocean.setWaveScale(this.waveScale);
    }

    this.ocean.update(dt, travelDelta);
    this.sky.update(dt, travelDelta, this.camera.position);
    this.scenery.update(dt, travelDelta, this.time, this.waveScale);
    this.particles.update(dt, weather.wind * 1.2);

    const closeness = ctx.krakenGap == null ? 0 : clamp01(1 - ctx.krakenGap / 100);

    this.kraken.setGap(ctx.krakenGap ?? 100);
    this.kraken.setState(ctx.krakenState ?? 'idle');
    this.kraken.update(dt, {
      playerX: this.player.x,
      playerZ: this.player.z,
      surfaceY: this.player.surfaceY,
    });

    // Contact shadows under the player and nearby hazards.
    this.decals.begin();
    if (this.shadowsEnabled) {
      const p = this.player;
      if (p.root.visible) {
        const height = p.airborne ? clamp01(1 - p.y / 3) : 1;
        this.decals.place(p.x, p.surfaceY, p.z, lerp(1.6, 0.7, 1 - height), 0.34 * height);
      }
      for (const hazard of this.obstacles.live) {
        const dz = hazard.z - this.player.z;
        if (dz > 30 || dz < -18) continue;
        this.decals.place(hazard.x, hazard.y, hazard.z, hazard.scale * (hazard.span > 1 ? 1.9 : 1.1), 0.26);
      }
    }
    this.decals.end();

    // Wind-blown spray during storms.
    if (weather.rain > 0 && Math.random() < weather.rain * 0.6) {
      this.particles.rail(
        this.player.x + (Math.random() - 0.5) * 24,
        this.player.surfaceY + Math.random() * 3,
        this.player.z - 10 - Math.random() * 40,
        (Math.random() - 0.5) * 2,
        0.4
      );
    }

    this.player.update(dt, {
      ocean: this.ocean,
      speed01: ctx.speed01 ?? 0,
      particles: this.particles,
    });

    this.cameraRig.update(dt, {
      playerX: this.player.x,
      playerY: this.player.y,
      playerZ: this.player.z,
      surfaceY: this.player.surfaceY,
      speed01: ctx.speed01 ?? 0,
      lean: this.player.leanValue,
      closeness,
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Extra flourish used when the player is caught by the Kraken. */
  krakenLunge() {
    this.kraken.lunge();
    this.cameraRig.shake(1.4);
  }

  dispose() {
    this.ocean.dispose();
    this.sky.dispose();
    this.scenery.dispose();
    this.particles.dispose();
    this.obstacles.dispose();
    this.collectibles.dispose();
    this.player.dispose();
    this.kraken.dispose();
    this.decals.dispose();
    this.renderer.dispose();
  }
}

export { CameraMode };
