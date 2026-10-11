/**
 * Surf Rush — game orchestration.
 *
 * Owns the state machine, the run lifecycle and the wiring between input,
 * simulation, presentation, audio and persistence. Every gameplay rule lives in
 * `src/game/rules/*` (pure, unit-tested); this class is the only place that
 * knows about all of them at once.
 */

import { StateMachine, GameState, SIMULATED_STATES } from '../core/StateMachine.js';
import { EventBus } from '../core/EventBus.js';
import { InputManager, Action } from '../core/InputManager.js';
import { World } from './three/World.js';
import { SPAWN_AHEAD } from './three/ObstacleManager.js';
import { CameraMode } from './three/CameraRig.js';
import { SpawnDirector } from './rules/SpawnDirector.js';
import { ScoreManager } from './rules/ScoreManager.js';
import { PowerUpManager } from './rules/PowerUpManager.js';
import { KrakenAI, KrakenState } from './rules/KrakenAI.js';
import { LaneSystem } from './rules/LaneSystem.js';
import * as Difficulty from './rules/Difficulty.js';
import { buildRunConfig, Weather, Environment } from './config/Modes.js';
import { SaveManager } from '../storage/SaveManager.js';
import { AudioManager } from './AudioManager.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { clamp, clamp01 } from '../core/MathUtils.js';
import * as THREE from 'three';

const MAX_DT = 1 / 20; // never simulate more than 50 ms in one step
const QUALITY_ORDER = ['low', 'medium', 'high'];

/** Flavour text shown on the game-over screen. */
const END_REASONS = {
  wipeout: { title: 'Wipeout', flavour: 'The reef wins this one' },
  time: { title: 'Time!', flavour: 'The clock ran out' },
  goal: { title: 'Course Cleared', flavour: 'You made it through' },
  kraken: { title: 'Taken', flavour: 'The Kraken got you' },
  quit: { title: 'Run Ended', flavour: 'Back to the beach' },
};

export class Game {
  /**
   * @param {{canvas:HTMLCanvasElement, touchControls:HTMLElement}} dom
   */
  constructor(dom) {
    this.dom = dom;
    this.bus = new EventBus();

    this.save = new SaveManager();
    this.audio = new AudioManager({ settings: this.save.settings });

    /** @type {World|null} */
    this.world = null;
    this.hud = new HUD({ onPause: () => this.togglePause() });
    this.menu = new Menu({
      save: this.save,
      audio: this.audio,
      handlers: {
        onStartMode: (modeId) => this.startRun(modeId),
        onResume: () => this.resume(),
        onRestart: () => this.restart(),
        onQuit: () => this.quitToMenu(),
        onShowResults: () => this.showResults(),
        onSelectCharacter: (id) => this.selectCharacter(id),
        onSelectBoard: (id) => this.selectBoard(id),
        onPurchase: (payload) => this.purchase(payload),
        onSetting: (key, value) => this.setSetting(key, value),
        onResetProgress: () => this.resetProgress(),
      },
    });

    this.input = new InputManager({
      canvas: dom.canvas,
      touchControls: dom.touchControls,
      onAction: (action, event) => this.onAction(action, event),
    });

    this.lanes = new LaneSystem();
    this.score = new ScoreManager();
    this.powerUps = new PowerUpManager();
    this.krakenAI = new KrakenAI();

    this.state = new StateMachine(GameState.BOOT);
    /** @type {import('./config/Modes.js').ModeDef|null} */
    this.config = null;
    this.director = null;

    this._lastFrame = 0;
    this._raf = null;
    this._running = false;
    this._elapsed = 0;
    this._playerVector = new THREE.Vector3();
    this._krakenMouth = new THREE.Vector3();

    this._repeat = { timer: 0, first: true };
    this._fps = { frames: 0, elapsed: 0, value: 60, slowSeconds: 0, fastSeconds: 0, level: 2 };
    this._pendingUnlocks = [];
    this._lastResult = null;
    this._isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches || 'ontouchstart' in globalThis;

    this._bindWindowEvents();
  }

  /* ================================================================== *
   * Boot
   * ================================================================== */

  /**
   * Create the renderer and scene. Returns false when WebGL is unavailable so
   * the caller can show an explanatory screen instead of a blank canvas.
   */
  async init() {
    try {
      this.world = new World(this.dom.canvas, {
        quality: this.save.getSetting('quality') === 'auto' ? 'high' : this.save.getSetting('quality'),
        shadows: this.save.getSetting('shadows'),
      });
    } catch (error) {
      console.error('[Surf Rush] WebGL initialisation failed', error);
      this.state.change(GameState.ERROR, { force: true });
      this.menu.showError(
        'Surf Rush can’t start',
        error?.message ?? 'Your browser or graphics driver could not create a WebGL context.'
      );
      return false;
    }

    this.world.player.onJump = () => {
      this.audio.jump();
      this.score.registerJump();
    };
    this.world.player.onLand = () => {
      this.audio.land();
      this.score.registerLanding();
      const p = this.world.player;
      this.world.particles.burst(p.x, p.surfaceY, p.z, 0.8 + this.world.player.speed01 * 0.6);
      this.world.particles.ring(p.x, p.surfaceY, p.z, 1.6 + p.speed01);
      this.world.cameraRig.shake(0.22);
    };

    this.director = new SpawnDirector(this.world.player.lanes, 1);
    this.world.obstacles.attach(this.director, this.world.ocean);

    this.applySettings();
    this.state.change(GameState.LOADING, { force: true });
    this._start();

    // Let the first frame compile shaders before revealing the menu.
    await new Promise((resolve) => setTimeout(resolve, 60));
    this.toMenu();
    return true;
  }

  _bindWindowEvents() {
    this._onResize = () => this.world?.resize();
    globalThis.addEventListener('resize', this._onResize);
    globalThis.addEventListener('orientationchange', this._onResize);

    this._onVisibility = () => {
      if (document.hidden && this.state.is(GameState.PLAYING)) this.pause();
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    this._onBeforeUnload = () => this.save.flush();
    globalThis.addEventListener('beforeunload', this._onBeforeUnload);

    // Audio can only start from a user gesture.
    const unlock = () => {
      if (this.audio.unlock()) {
        this.audio.applySettings(this.save.settings);
        this.audio.setMood(this.state.is(GameState.PLAYING) ? 'game' : 'menu');
      }
    };
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      globalThis.addEventListener(type, unlock, { once: true, passive: true });
    }
  }

  /* ================================================================== *
   * Settings
   * ================================================================== */

  applySettings() {
    const settings = this.save.settings;
    this.audio.applySettings(settings);

    const root = document.documentElement;
    root.dataset.reduceMotion = String(!!settings.reduceMotion);
    root.dataset.highContrast = String(!!settings.highContrast);
    root.dataset.largeText = String(!!settings.largeText);

    if (this.world) {
      this.world.cameraRig.configure({ reduceMotion: !!settings.reduceMotion });
      this.world.setShadows(settings.shadows !== false);
      this.world.setLaneGuides(!!settings.laneGuides, this.lanes.count, this.lanes.width);
      const quality = settings.quality === 'auto' ? QUALITY_ORDER[this._fps.level] : settings.quality;
      if (quality !== this.world.quality) this.world.setQuality(quality);
    }

    this.hud.setFpsVisible(!!settings.showFps);
    this.input.setInvertSwipe(!!settings.invertSwipe);

    const showTouch = this._isTouch || !!settings.forceTouch;
    if (this.dom.touchControls) this.dom.touchControls.hidden = !showTouch;

    this.menu.applySettings?.(settings);
  }

  setSetting(key, value) {
    this.save.setSetting(key, value);
    this.applySettings();
  }

  resetProgress() {
    this.save.reset();
    if (this.world) {
      this.world.player.setAppearance(this.save.selectedCharacter, this.save.selectedBoard);
    }
    this.applySettings();
    this.menu.refreshMenuStats();
    this.hud.toast('Progress reset — <b>fresh line-up</b>', 0xff6b6b, 2600);
  }

  /* ================================================================== *
   * Main loop
   * ================================================================== */

  _start() {
    if (this._running) return;
    this._running = true;
    this._lastFrame = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      const rawDt = (now - this._lastFrame) / 1000;
      this._lastFrame = now;
      // Clamp: a backgrounded tab must not teleport the player through hazards.
      const dt = Math.min(Math.max(rawDt, 0), MAX_DT);
      this._update(dt, rawDt);
      this.world.render();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _update(dt, rawDt) {
    this._elapsed += dt;
    this._trackFps(rawDt);

    const state = this.state.state;

    if (SIMULATED_STATES.has(state)) {
      this._updateRun(dt, state);
    } else {
      this._updateIdle(dt);
    }
  }

  /** Menu / results / error backdrop: a calm idle surf. */
  _updateIdle(dt) {
    const travelDelta = 7 * dt;
    this.world.update(dt, travelDelta, {
      krakenGap: 100,
      krakenState: KrakenState.IDLE,
      speed01: 0.25,
    });
    this.world.player.crouching = false;
    this.audio.updateSurf(0.25, false);
    this.audio.setAmbienceLevel(0.16);
  }

  /* ================================================================== *
   * Run lifecycle
   * ================================================================== */

  /** @param {string} modeId */
  startRun(modeId) {
    const config = buildRunConfig(modeId, { date: new Date() });
    this.config = config;

    this.world.applyEnvironment(config.environment, config.weather);
    this.world.setWaveScale(config.waveScale ?? 1, true);
    this.world.player.setAppearance(this.save.selectedCharacter, this.save.selectedBoard);
    this.world.player.reset(config.lanes);
    this.lanes = this.world.player.lanes;
    this.world.setLaneGuides(this.save.getSetting('laneGuides'), config.lanes, this.lanes.width);

    this.world.obstacles.reset();
    this.world.collectibles.reset();
    this.world.particles.clear();
    this.world.kraken.setVisible(false);
    this.world.cameraRig.setMode(CameraMode.GAME);
    this.world.cameraRig.snap();

    this.director = new SpawnDirector(this.lanes, config.seed);
    this.world.obstacles.attach(this.director, this.world.ocean);

    this.score.reset({ modeId: config.modeId, recordScore: config.recordScore });
    this.powerUps.reset();
    this.krakenAI.configure(config);
    this.krakenAI.reset();

    this.lives = config.lives;
    this.maxLives = Math.max(1, config.lives);
    this.timeRemaining = config.timeLimit;
    this.goalDistance = config.goalDistance;
    this.completed = false;
    this.endReason = null;
    this._pendingUnlocks = [];
    this._lastResult = null;
    this._milestone = 0;
    this._nextEventDistance = 620;
    this._event = null;
    this._hazardScaleBoost = 1;
    this._countdown = 3.4;
    this._lastCountdownShown = null;
    this._krakenWasActive = false;
    this.endReasonOverride = null;

    this.hud.reset();
    this.hud.show();
    this.hud.setMode(config.name, this._objectiveText());
    this.hud.setBest(this.save.bestScore(config.modeId));
    this.hud.setLives(config.lives > 0 ? this.lives : 0, config.lives > 0 ? this.maxLives : 0);
    this.hud.setScore(0);
    this.hud.setCoins(0);
    this.hud.setDistance(0);
    this.hud.setSpeed(0);
    this.hud.setMultiplier(1);
    this.hud.setVignette(0);
    this.hud.setFlash(0);

    this.menu.hideAll();
    this.input.setGameplayEnabled(true);

    if (this.audio.ready) {
      this.audio.setMood('game');
      this.audio.setIntensity(0);
      this.audio.setAmbienceLevel(0.22);
    }

    this.state.change(GameState.READY, { force: true });
  }

  restart() {
    if (!this.config) return;
    this.startRun(this.config.modeId);
  }

  quitToMenu() {
    this.endRun('quit', { silent: true });
    this.toMenu();
  }

  toMenu() {
    this.hud.hide();
    this.hud.reset();
    this.input.setGameplayEnabled(false);
    this.world.cameraRig.setMode(CameraMode.MENU);
    this.world.obstacles.reset();
    this.world.collectibles.reset();
    this.world.particles.clear();
    this.world.kraken.setVisible(false);
    this.world.applyEnvironment(Environment.DAY, Weather.CLEAR);
    this.world.setWaveScale(1, true);
    this.menu.refreshMenuStats();
    this.menu.show('menu', { remember: false });
    this.menu.stack.length = 0;
    this.state.change(GameState.MENU, { force: true });
    if (this.audio.ready) {
      this.audio.setMood('menu');
      this.audio.setIntensity(0);
    }
  }

  pause() {
    if (!this.state.is(GameState.PLAYING, GameState.READY)) return;
    this._resumeState = this.state.state;
    this.state.change(GameState.PAUSED, { force: true });
    this.input.setGameplayEnabled(false);
    this.menu.updatePause({
      score: this.score.score,
      distance: this.score.distance,
      coins: this.score.coins,
    });
    this.menu.show('pause', { remember: false });
    this.hud.setVignette(0);
    if (this.audio.ready) this.audio.setAmbienceLevel(0.06);
  }

  resume() {
    if (!this.state.is(GameState.PAUSED)) return;
    this.menu.hideAll();
    this.state.change(this._resumeState ?? GameState.PLAYING, { force: true });
    this.input.setGameplayEnabled(true);
    this._lastFrame = performance.now();
    if (this.audio.ready) this.audio.setAmbienceLevel(0.22);
  }

  togglePause() {
    if (this.state.is(GameState.PLAYING, GameState.READY)) this.pause();
    else if (this.state.is(GameState.PAUSED)) this.resume();
  }

  /* ================================================================== *
   * Per-frame run simulation
   * ================================================================== */

  _updateRun(dt, state) {
    const world = this.world;
    const player = world.player;
    const config = this.config;

    /* ------------------------- countdown ------------------------- */
    if (state === GameState.READY) {
      this._countdown -= dt;
      const remaining = Math.ceil(this._countdown - 0.4);
      if (remaining !== this._lastCountdownShown) {
        this._lastCountdownShown = remaining;
        if (remaining > 0) {
          this.hud.showCountdown(String(remaining), false);
          this.audio.countdown(false);
        } else {
          this.hud.showCountdown('GO!', true);
          this.audio.countdown(true);
        }
      }
      if (this._countdown <= 0.4) {
        this.hud.hideCountdown();
        this.state.change(GameState.PLAYING, { force: true });
      }
    }

    /* ------------------------ difficulty ------------------------- */
    const boostFactor = this.powerUps.boostFactor;
    const tuning = Difficulty.evaluate(this.score.distance, config, boostFactor);
    const difficulty = tuning.difficulty;
    const speed = player.alive ? tuning.speed : Math.max(4, tuning.speed * 0.25);
    const travelDelta = speed * dt;

    /* --------------------------- input --------------------------- */
    if (state === GameState.PLAYING && player.alive) {
      this._handleHeldInput(dt);
      player.setCrouch(this.input.duck);
    }

    /* ------------------------- simulation ------------------------- */
    if (state === GameState.PLAYING) {
      this.score.update(dt, speed);
      this.score.setMultiplierBonus(this.powerUps.multiplierBonus);
      if (config.timeLimit > 0) {
        this.timeRemaining -= dt;
        if (this.timeRemaining <= 0) {
          this.timeRemaining = 0;
          this.endRun('time');
          return;
        }
      }
      this._updateEnvironmentEvents(dt);
    }

    /* --------------------------- streaming ------------------------ */
    const streamTuning = {
      gapTime: tuning.gapTime,
      hazardCount: tuning.hazardCount * this._hazardScaleBoost,
      powerUpChance: tuning.powerUpChance,
      formationChance: tuning.formationChance,
    };
    if (state === GameState.PLAYING) {
      const created = world.obstacles.stream(travelDelta, tuning.gapDistance, difficulty, streamTuning, {
        chase: this.krakenAI.isChasing,
      });
      for (const group of created) world.collectibles.spawnGroup(group, -SPAWN_AHEAD);
    }

    world.obstacles.update(dt, travelDelta, this.world.player.surfaceY);

    /* -------------------------- collisions ------------------------- */
    this._playerVector.set(player.x, player.y, player.z);
    let wipedOut = false;

    if (state === GameState.PLAYING && player.alive) {
      const query = world.obstacles.query(this._playerVector, player.crouching, player.airborne);
      if (query.passed.length) {
        for (const hazard of query.passed) {
          this.score.registerObstaclePassed();
          if (hazard.clearedByJump) this.score.registerHop();
        }
      }
      if (query.nearMiss) this.score.registerNearMiss();
      if (query.hit) wipedOut = this._registerHit(query.hit);
    }

    /* -------------------------- collectibles ----------------------- */
    const collected = world.collectibles.update(
      dt,
      travelDelta,
      this._elapsed,
      this._playerVector,
      this.powerUps.magnetRadius
    );
    let gotOrb = false;
    for (const item of collected) {
      if (item.type === 'powerup') {
        this._activatePowerUp(item);
      } else {
        this.score.collect(item.type);
        world.particles.pickup(item.x, item.y, item.z, item.def?.color ?? 0xffd166, item.type === 'coin' ? 8 : 16);
        if (item.type === 'coin') this.audio.coin(Math.min(this.score.combo, 12));
        else if (item.type === 'shell') this.audio.shell();
        else if (item.type === 'pearl') this.audio.pearl();
        else if (item.type === 'escapeOrb') {
          gotOrb = true;
          this.audio.boost();
        }
      }
    }

    /* ---------------------------- kraken --------------------------- */
    const krakenEvents = this.krakenAI.update(dt, {
      distanceDelta: travelDelta,
      difficulty,
      seedOrb: gotOrb,
      hit: wipedOut,
    });
    for (const event of krakenEvents) this._handleKrakenEvent(event);

    const isChasing = this.krakenAI.isActive;
    if (isChasing !== this._krakenWasActive) {
      this._krakenWasActive = isChasing;
      this.world.cameraRig.setMode(isChasing ? CameraMode.CHASE : CameraMode.GAME);
    }

    /* --------------------------- power-ups ------------------------- */
    for (const event of this.powerUps.update(dt)) {
      if (event.type === 'expired') {
        this.hud.toast(`${event.def.label} ended`, 0x8ea7b8, 1400);
      }
    }
    player.setShield(this.powerUps.isActive('shield'));

    /* ---------------------------- world --------------------------- */
    const speed01 = clamp01((speed - Difficulty.SPEED.base) / (Difficulty.SPEED.max - Difficulty.SPEED.base));
    world.update(dt, travelDelta, {
      krakenGap: this.krakenAI.gap,
      krakenState: this.krakenAI.state,
      speed01,
    });

    if (this.world.sky.consumeThunder()) {
      this.audio.thunder();
      this.hud.setFlash(0.22, '#cfe6ff');
      setTimeout(() => this.hud.setFlash(0), 90);
    }

    /* ---------------------------- audio --------------------------- */
    this.audio.updateSurf(speed01, player.airborne);
    this.audio.setAmbienceLevel(isChasing ? 0.3 : 0.22);
    if (this.audio.ready) {
      this.audio.setMood(this.krakenAI.isChasing ? 'chase' : 'game');
      this.audio.setIntensity(this.krakenAI.isChasing ? clamp01(0.6 + this.krakenAI.threat / 200) : difficulty);
    }

    /* ----------------------------- HUD ---------------------------- */
    this._updateHud(dt, speed01, tuning);

    /* --------------------------- milestones ------------------------ */
    const milestone = Math.floor(this.score.distance / 1000);
    if (milestone > this._milestone) {
      this._milestone = milestone;
      this.hud.banner(`${milestone} km`, 'keep charging');
      this.audio.eventStart();
      this.score.award(500);
    }

    /* ------------------------- wipeout / end ---------------------- */
    if (state === GameState.WIPEOUT) {
      if (player.wipeoutComplete) this._afterWipeout();
    } else if (!player.alive && player.wipeoutTimer > 0.25) {
      this.state.change(GameState.WIPEOUT, { force: true });
      world.cameraRig.setMode(CameraMode.WIPEOUT);
    }

    /* ---------------------------- goal ---------------------------- */
    if (config.goalDistance > 0 && this.score.distance >= config.goalDistance && !this.completed) {
      this.completed = true;
      this.score.award(5000);
      this.endRun('goal');
    }
  }

  _handleHeldInput(dt) {
    const direction = this.input.laneDirection;
    if (direction === 0) {
      this._repeat.timer = 0;
      this._repeat.first = true;
      return;
    }
    this._repeat.timer += dt;
    const threshold = this._repeat.first ? 0.26 : 0.13;
    if (this._repeat.timer >= threshold) {
      this._repeat.timer = 0;
      this._repeat.first = false;
      if (direction < 0) this.world.player.moveLeft();
      else this.world.player.moveRight();
    }
  }

  /* ================================================================== *
   * Collisions & consequences
   * ================================================================== */

  /** @returns {boolean} true when the player actually wiped out */
  _registerHit(hazard) {
    const world = this.world;
    const player = world.player;

    // A shield eats exactly one hit.
    if (this.powerUps.consumeShield()) {
      this.audio.shieldBreak();
      world.particles.burst(player.x, player.y + 0.8, player.z, 1.1, 0x9ffff0);
      world.cameraRig.shake(0.7);
      this.hud.setFlash(0.35, '#9ffff0');
      setTimeout(() => this.hud.setFlash(0), 110);
      this.hud.toast('<b>Shield</b> absorbed the hit', 0x2ee6c5);
      player.invulnerable = Math.max(player.invulnerable, 1.1);
      hazard.hit = true;
      return false;
    }

    if (!player.takeHit()) return false;

    this.audio.hit();
    this.audio.wipeout();
    world.particles.burst(player.x, player.y + 0.6, player.z, 1.6, 0xdff4ff);
    world.particles.ring(player.x, player.surfaceY, player.z, 3.2, 0xffffff, 26);
    world.cameraRig.shake(1.2);
    this.hud.setFlash(0.5, '#ffd7d7');
    setTimeout(() => this.hud.setFlash(0), 130);
    this.score.registerHit();

    if (this.config.lives > 0) {
      this.lives = Math.max(0, this.lives - 1);
      this.hud.setLives(this.lives, this.maxLives);
    } else if (this.config.timeLimit > 0) {
      this.timeRemaining = Math.max(0, this.timeRemaining - 3);
      this.hud.toast('<b>-3s</b> penalty', 0xff6b6b);
    }

    return true;
  }

  _afterWipeout() {
    const player = this.world.player;

    if (this.config.lives > 0 && this.lives <= 0) {
      const reason = this.endReasonOverride ?? 'wipeout';
      this.endReasonOverride = null;
      this.endRun(reason);
      return;
    }
    this.endReasonOverride = null;

    player.revive();
    this.hud.banner('Wipeout', this.config.lives > 0 ? `${this.lives} left` : 'shake it off', { danger: true });
    this.world.cameraRig.setMode(this.krakenAI.isChasing ? CameraMode.CHASE : CameraMode.GAME);
    this.state.change(GameState.PLAYING, { force: true });
  }

  /* ================================================================== *
   * Kraken
   * ================================================================== */

  _handleKrakenEvent(event) {
    const world = this.world;
    switch (event.type) {
      case 'warning':
        this.hud.banner('Kraken Rising', 'something huge is behind you', { danger: true });
        this.audio.krakenWarning();
        this.hud.setVignette(0.35);
        break;
      case 'start':
        this.audio.krakenRoar();
        world.kraken.mouthPosition(this._krakenMouth);
        world.particles.inkCloud(this._krakenMouth.x, this._krakenMouth.y + 1, this._krakenMouth.z, 20);
        this.hud.banner('Run!', 'outrun the Kraken', { danger: true });
        break;
      case 'orb':
        this.hud.toast('<b>Escape orb</b> — it falls back', 0x2ee6c5, 1400);
        break;
      case 'escaped':
        this.score.registerKrakenEscape();
        this.audio.achievement();
        this.hud.banner('Escaped!', '+2,500 points');
        this.hud.setVignette(0);
        world.kraken.mouthPosition(this._krakenMouth);
        world.particles.inkCloud(this._krakenMouth.x, this._krakenMouth.y, this._krakenMouth.z, 24);
        break;
      case 'caught': {
        this.endReasonOverride = 'kraken';
        world.krakenLunge();
        world.particles.inkCloud(this.world.player.x, this.world.player.y + 1, this.world.player.z + 4, 26);
        this.audio.krakenRoar();
        this.hud.setVignette(0.7);
        this.hud.banner('Caught!', 'the Kraken strikes', { danger: true });
        if (!this.world.player.takeHit()) break;
        this.audio.wipeout();
        this.score.registerHit();
        if (this.config.lives > 0) {
          this.lives = Math.max(0, this.lives - 1);
          this.hud.setLives(this.lives, this.maxLives);
        } else if (this.config.timeLimit > 0) {
          this.timeRemaining = Math.max(0, this.timeRemaining - 3);
        }
        break;
      }
      case 'clear':
        this.hud.setVignette(0);
        this.hud.toast('The water goes quiet…', 0x8ea7b8, 1600);
        break;
      default:
        break;
    }
  }

  /* ================================================================== *
   * Power-ups
   * ================================================================== */

  _activatePowerUp(item) {
    const def = this.powerUps.activate(item.id);
    if (!def) return;
    this.score.registerPowerUp();
    this.audio.powerUp();
    this.world.particles.pickup(item.x, item.y, item.z, def.color, 22);
    this.hud.toast(`<b>${def.label}</b> — ${def.legend}`, def.color, 2600);

    if (item.id === 'extralife') {
      if (this.config.lives > 0) {
        this.maxLives = Math.max(this.maxLives, this.lives + 1);
        this.lives = Math.max(0, Math.min(this.maxLives, this.lives + 1));
        this.hud.setLives(this.lives, this.maxLives);
      } else {
        this.score.award(750);
        this.hud.toast('No lives in this mode — <b>+750</b> points', 0x7dff9b, 2000);
      }
    }
    if (item.id === 'boost') this.audio.boost();
    if (item.id === 'shield') this.world.player.setShield(true);
  }

  /* ================================================================== *
   * Environmental events
   * ================================================================== */

  _updateEnvironmentEvents(dt) {
    if (this._event) {
      this._event.remaining -= dt;
      if (this._event.remaining <= 0) this._endEvent();
      else return;
    }

    if (this.score.distance < this._nextEventDistance) return;
    this._nextEventDistance = this.score.distance + 480 + Math.random() * 420;

    const roll = Math.random();
    if (roll < 0.38) {
      this._startEvent({
        id: 'bigWave',
        label: 'Big Wave',
        duration: 7,
        onStart: () => {
          this.hud.banner('Big Wave!', 'paddle for it');
          this.world.setWaveScale(this.world.waveScale * 1.9);
          this.world.player.launch(1.35);
          this.audio.eventStart();
          this.world.particles.burst(this.world.player.x, this.world.player.surfaceY, this.world.player.z + 2, 1.8);
        },
        onEnd: () => this.world.setWaveScale(this.config.waveScale ?? 1),
      });
    } else if (roll < 0.68) {
      this._startEvent({
        id: 'squall',
        label: 'Squall',
        duration: 16,
        onStart: () => {
          this.hud.banner('Squall', 'wind and rain roll in', { danger: true });
          this.world.applyEnvironment(this.config.environment, Weather.STORM);
          this.world.setWaveScale((this.config.waveScale ?? 1) * 1.4);
          this.audio.thunder();
        },
        onEnd: () => {
          this.world.applyEnvironment(this.config.environment, this.config.weather);
          this.world.setWaveScale(this.config.waveScale ?? 1);
        },
      });
    } else {
      this._startEvent({
        id: 'debris',
        label: 'Debris Field',
        duration: 18,
        onStart: () => {
          this.hud.banner('Debris Field', 'the water is full of junk', { danger: true });
          this._hazardScaleBoost = 1.5;
          this.audio.eventStart();
        },
        onEnd: () => {
          this._hazardScaleBoost = 1;
        },
      });
    }
  }

  _startEvent(event) {
    this._event = { ...event, remaining: event.duration };
    event.onStart?.();
  }

  _endEvent() {
    const event = this._event;
    this._event = null;
    event?.onEnd?.();
  }

  /* ================================================================== *
   * HUD
   * ================================================================== */

  _objectiveText() {
    const config = this.config;
    if (!config) return '';
    switch (config.objective) {
      case 'time':
        return `${Math.ceil(this.timeRemaining)}s`;
      case 'goal':
        return `${Math.floor(this.score.distance)} / ${this.goalDistance} m`;
      case 'distance':
        return `${Math.floor(this.score.distance)} m`;
      default:
        return '';
    }
  }

  _updateHud(dt, speed01, tuning) {
    const hud = this.hud;
    const config = this.config;

    hud.setScore(this.score.score);
    hud.setCoins(this.score.coins);
    hud.setDistance(this.score.distance);
    hud.setSpeed(speed01);
    hud.setMultiplier(this.score.multiplier);
    hud.setPowerUps(this.powerUps.list());

    let progress = 0;
    let urgent = false;
    switch (config.objective) {
      case 'time':
        progress = this.timeRemaining / config.timeLimit;
        urgent = this.timeRemaining <= 15;
        break;
      case 'goal':
        progress = this.score.distance / this.goalDistance;
        urgent = progress > 0.85;
        break;
      case 'distance':
        progress = (this.score.distance % 1000) / 1000;
        break;
      default:
        progress = tuning.difficulty;
        break;
    }
    hud.setObjective(this._objectiveText(), progress, urgent);

    if (this.krakenAI.isChasing) {
      hud.setVignette(0.15 + this.krakenAI.threat / 180);
    }

    if (this.save.getSetting('showFps')) hud.setFps(this._fps.value);
  }

  /* ================================================================== *
   * End of run
   * ================================================================== */

  /**
   * @param {'wipeout'|'time'|'goal'|'kraken'|'quit'} reason
   * @param {{silent?:boolean}} [options]
   */
  endRun(reason, options = {}) {
    if (!this.config) return;
    if (this.state.is(GameState.GAME_OVER, GameState.RESULTS)) return;
    this._event = null;
    this.endReasonOverride = null;
    this._hazardScaleBoost = 1;
    this.world.setWaveScale(this.config?.waveScale ?? 1);
    if (this.config) this.world.applyEnvironment(this.config.environment, this.config.weather);
    this.score.finalise();

    this.input.setGameplayEnabled(false);
    this.hud.hideCountdown();
    this.hud.setVignette(0);
    this.hud.setFlash(0);

    const snapshot = this.score.snapshot();
    const meta = {
      modeId: this.config?.modeId ?? 'endless',
      recordScore: this.config?.recordScore !== false,
      dateKey: this.config?.dateKey ?? null,
      completed: this.completed,
    };

    const outcome = this.save.recordRun(snapshot, meta);
    this.save.flush();

    this._lastResult = {
      snapshot,
      reason,
      modeName: this.config?.name ?? 'Endless Surf',
      isRecord: outcome.isRecord,
      newAchievements: outcome.newAchievements,
      unlockedCosmetics: outcome.unlockedCosmetics,
      best: this.save.bestScore(meta.modeId),
    };

    if (!options.silent) {
      this.state.change(GameState.GAME_OVER, { force: true });
      this._showGameOverScreen();
    } else {
      this.state.change(GameState.MENU, { force: true });
    }
  }

  _showGameOverScreen() {
    const result = this._lastResult;
    if (!result) return;
    const info = END_REASONS[result.reason] ?? END_REASONS.wipeout;
    const unlocks = [];

    for (const achievement of result.newAchievements) {
      unlocks.push(`Achievement unlocked: <b>${achievement.def.name}</b> (+${achievement.reward} coins)`);
    }
    for (const cosmetic of result.unlockedCosmetics) {
      unlocks.push(`New ${cosmetic.kind} unlocked: <b>${cosmetic.name}</b>`);
    }

    for (const achievement of result.newAchievements) this.audio.achievement();

    this.menu.showGameOver({
      score: result.snapshot.score,
      best: result.best,
      isRecord: result.isRecord,
      distance: result.snapshot.distance,
      coins: result.snapshot.coins,
      topSpeed: result.snapshot.topSpeed * 3.6,
      obstacles: result.snapshot.obstaclesPassed,
      flavour: info.flavour,
      title: result.reason === 'goal' ? 'Course Cleared' : info.title,
      unlocks,
    });

    this.hud.hide();
    this.world.cameraRig.setMode(CameraMode.MENU);
    if (this.audio.ready) {
      this.audio.setMood('menu');
      this.audio.setIntensity(0);
      this.audio.gameOver();
    }
  }

  showResults() {
    if (!this._lastResult) return;
    this.state.change(GameState.RESULTS, { force: true });
    this.menu.showResults(this._lastResult.snapshot, {
      modeName: this._lastResult.modeName,
      reason: END_REASONS[this._lastResult.reason]?.title ?? 'Run ended',
      records: this.save.getRecords(this.config?.modeId ?? 'endless'),
    });
  }

  /* ================================================================== *
   * Cosmetics
   * ================================================================== */

  selectCharacter(id) {
    if (this.save.select('character', id)) {
      this.world?.player.setAppearance(this.save.selectedCharacter, this.save.selectedBoard);
      this.audio.uiClick();
      this.menu.renderCharacters();
    }
  }

  selectBoard(id) {
    if (this.save.select('board', id)) {
      this.world?.player.setAppearance(this.save.selectedCharacter, this.save.selectedBoard);
      this.audio.uiClick();
      this.menu.renderShop();
    }
  }

  /** @param {string} payload e.g. "character:mira" or "board:thunder" */
  purchase(payload) {
    const [kind, id] = payload.split(':');
    const table = kind === 'character' ? CHARACTERS : BOARDS;
    const def = table.find((entry) => entry.id === id);
    if (!def) return;

    const result = this.save.purchase(kind, def);
    if (result.ok) {
      this.audio.achievement();
      this.hud.toast(`Unlocked <b>${def.name}</b>`, 0xffd166, 2600);
      this.save.select(kind, id);
      this.world?.player.setAppearance(this.save.selectedCharacter, this.save.selectedBoard);
    } else if (result.reason === 'poor') {
      this.audio.uiBack();
      this.hud.toast(`Need <b>${def.cost - this.save.coins}</b> more coins`, 0xff6b6b, 2400);
    } else {
      this.audio.uiBack();
      this.hud.toast(`${def.name} is unlocked by ${def.unlock?.label ?? 'an achievement'}`, 0xff6b6b, 2600);
    }
    if (kind === 'character') this.menu.renderCharacters();
    else this.menu.renderShop();
  }

  /* ================================================================== *
   * Input routing
   * ================================================================== */

  onAction(action, event) {
    const state = this.state.state;

    if (action === Action.PAUSE) {
      if (this.state.is(GameState.PLAYING, GameState.READY)) {
        this.pause();
      } else if (this.state.is(GameState.PAUSED)) {
        this.resume();
      } else if (this.menu.currentKey && this.menu.currentKey !== 'menu' && this.menu.currentKey !== 'error') {
        this.menu.back();
      }
      return;
    }

    if (action === Action.CONFIRM) {
      if (this.state.is(GameState.GAME_OVER)) {
        this.restart();
        return;
      }
      if (this.state.is(GameState.MENU)) {
        this.menu.show('modes');
        return;
      }
    }

    if (!SIMULATED_STATES.has(state)) return;

    switch (action) {
      case Action.LEFT:
        if (this._tryMove(-1)) this._repeat = { timer: 0, first: true };
        break;
      case Action.RIGHT:
        if (this._tryMove(1)) this._repeat = { timer: 0, first: true };
        break;
      case Action.JUMP:
        if (this.state.is(GameState.PLAYING)) this.world.player.requestJump();
        break;
      case Action.DUCK:
        if (this.state.is(GameState.PLAYING)) this.world.player.setCrouch(true);
        break;
      default:
        break;
    }
  }

  _tryMove(direction) {
    if (!this.state.is(GameState.PLAYING)) return false;
    const player = this.world.player;
    return direction < 0 ? player.moveLeft() : player.moveRight();
  }

  /* ================================================================== *
   * Performance
   * ================================================================== */

  _trackFps(rawDt) {
    const fps = this._fps;
    fps.frames++;
    fps.elapsed += rawDt;
    if (fps.elapsed < 1) return;

    const value = fps.frames / fps.elapsed;
    fps.value = fps.value * 0.4 + value * 0.6;
    fps.frames = 0;
    fps.elapsed = 0;

    if (this.save.getSetting('quality') !== 'auto' || !this.world) return;

    if (fps.value < 46) {
      fps.slowSeconds++;
      fps.fastSeconds = 0;
    } else if (fps.value > 57) {
      fps.fastSeconds++;
      fps.slowSeconds = 0;
    } else {
      fps.slowSeconds = 0;
      fps.fastSeconds = 0;
    }

    if (fps.slowSeconds >= 3 && fps.level > 0) {
      fps.level--;
      fps.slowSeconds = 0;
      this.world.setQuality(QUALITY_ORDER[fps.level]);
      this.hud.toast(`Quality lowered to <b>${QUALITY_ORDER[fps.level]}</b>`, 0x8ea7b8, 1800);
    } else if (fps.fastSeconds >= 12 && fps.level < QUALITY_ORDER.length - 1) {
      fps.level++;
      fps.fastSeconds = 0;
      this.world.setQuality(QUALITY_ORDER[fps.level]);
    }
  }

  /* ================================================================== *
   * Teardown
   * ================================================================== */

  dispose() {
    this.stop();
    globalThis.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    globalThis.removeEventListener('beforeunload', this._onBeforeUnload);
    this.input.dispose();
    this.world?.dispose();
    this.audio.dispose();
    this.save.flush();
  }
}
