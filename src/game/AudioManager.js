/**
 * Surf Rush audio engine.
 *
 * Every sound is synthesised at runtime with the Web Audio API — there are no
 * audio files to license and nothing to download. The engine provides:
 *
 *   • a continuous ocean ambience + surf-noise bed that tracks board speed
 *   • one-shot SFX for jumps, pickups, wipeouts, UI and events
 *   • a small procedural arcade music sequencer with menu / game / chase moods
 *
 * Browser autoplay rules mean the AudioContext is only created after an
 * explicit user gesture (`unlock()`); before that every call is a no-op.
 */

const NOTE = {
  C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.0, A2: 110.0, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, E5: 659.25, G5: 783.99, A5: 880.0,
};

/** Chord progressions per mood. Each chord: bass root + arpeggio pool. */
const PROGRESSIONS = {
  menu: [
    { bass: NOTE.A2, notes: [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.G4] },
    { bass: NOTE.F2, notes: [NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4] },
    { bass: NOTE.C3, notes: [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.B4] },
    { bass: NOTE.G2, notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4] },
  ],
  game: [
    { bass: NOTE.A2, notes: [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.A4] },
    { bass: NOTE.F2, notes: [NOTE.F3, NOTE.A3, NOTE.C4, NOTE.F4] },
    { bass: NOTE.C3, notes: [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5] },
    { bass: NOTE.G2, notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.G4] },
  ],
  chase: [
    { bass: NOTE.A2, notes: [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.G4] },
    { bass: NOTE.A2, notes: [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.G4] },
    { bass: NOTE.F2, notes: [NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4] },
    { bass: NOTE.E2, notes: [NOTE.E3, NOTE.G3, NOTE.B3, NOTE.E4] },
  ],
};

const MOODS = {
  menu: { bpm: 96, density: 0.55, cutoff: 900, gain: 0.4 },
  game: { bpm: 132, density: 0.85, cutoff: 1700, gain: 0.5 },
  chase: { bpm: 152, density: 1, cutoff: 2400, gain: 0.62 },
};

export class AudioManager {
  /** @param {{settings?:any}} [options] */
  constructor(options = {}) {
    this.settings = options.settings ?? {};
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.ready = false;
    this.failed = false;
    this.unlocked = false;

    this.enabled = true;
    this.musicEnabled = true;

    /** @type {AudioBuffer|null} */
    this._noiseBuffer = null;
    this._ambience = null;
    this._surf = null;
    this._music = null;
    this._schedulerId = null;

    this._lookahead = 0.16;
    this._scheduleTimer = 25;
  }

  /* ---------------------------------------------------------------- *
   * Setup
   * ---------------------------------------------------------------- */

  /**
   * Create / resume the AudioContext. Must be called from a user gesture.
   * @returns {boolean} true when audio is live
   */
  unlock() {
    if (this.failed) return false;
    try {
      if (!this.ctx) {
        const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return false;
        }
        this.ctx = new Ctor();
        this._buildGraph();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.unlocked = true;
      this.ready = true;
      this.applySettings(this.settings);
      return true;
    } catch (error) {
      console.warn('[AudioManager] Web Audio unavailable', error);
      this.failed = true;
      this.ready = false;
      return false;
    }
  }

  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._volume('master');

    // Gentle limiter so stacked SFX never clip.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.18;

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this._volume('music');
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this._volume('sfx');

    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this._noiseBuffer = this._createNoiseBuffer(2.4);
    this._startAmbience();
    this._startSurfNoise();
    this._startMusic();
  }

  _createNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Pink-ish noise: a cheap one-pole filtered white noise, warmer than white.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
    }
    return buffer;
  }

  _volume(kind) {
    if (this.settings.muted) return 0;
    const value = this.settings[kind];
    if (typeof value !== 'number') return kind === 'master' ? 1 : 0.8;
    return Math.max(0, Math.min(1, value));
  }

  /**
   * Push settings (volume, mute) into the live graph.
   * Safe to call before the context exists.
   */
  applySettings(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    if (!this.ready || !this.ctx) return;
    const now = this.ctx.currentTime;
    const ramp = (param, value) => {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, 0.03);
    };
    ramp(this.master.gain, this._volume('master'));
    ramp(this.musicBus.gain, this._volume('music'));
    ramp(this.sfxBus.gain, this._volume('sfx'));
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /* ---------------------------------------------------------------- *
   * Continuous beds
   * ---------------------------------------------------------------- */

  /** Rolling ocean: filtered noise with a slow LFO on the band. */
  _startAmbience() {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this._noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 480;
    filter.Q.value = 0.6;

    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowpass';
    shelf.frequency.value = 1400;

    const gain = ctx.createGain();
    gain.gain.value = 0.16;

    // Slow swell.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 240;
    lfo.connect(lfoGain).connect(filter.frequency);

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.13;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.06;
    lfo2.connect(lfo2Gain).connect(gain.gain);

    source.connect(filter).connect(shelf).connect(gain).connect(this.sfxBus);
    source.start();
    lfo.start();
    lfo2.start();

    this._ambience = { source, filter, gain, lfo, lfo2 };
  }

  /** Board hiss: volume and brightness follow the speed. */
  _startSurfNoise() {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this._noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 1.1;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    source.connect(filter).connect(gain).connect(this.sfxBus);
    source.start();

    this._surf = { source, filter, gain };
  }

  /**
   * Feed the surf bed from gameplay.
   * @param {number} speed01 normalised 0..1 board speed
   * @param {boolean} airborne kills the hiss while in the air
   */
  updateSurf(speed01, airborne = false) {
    if (!this.ready || !this._surf) return;
    const gain = airborne ? 0 : Math.min(0.28, speed01 * 0.3);
    const freq = Math.round(700 + speed01 * 2200);
    // Called every frame — only touch the graph when something changed.
    if (Math.abs(gain - this._surfGain) < 0.005 && Math.abs(freq - this._surfFreq) < 40) return;
    this._surfGain = gain;
    this._surfFreq = freq;
    const now = this.ctx.currentTime;
    this._surf.gain.gain.setTargetAtTime(gain, now, 0.08);
    this._surf.filter.frequency.setTargetAtTime(freq, now, 0.12);
  }

  /** Duck the ambience during pauses / menus. */
  setAmbienceLevel(level) {
    const value = Math.max(0, Math.min(0.35, level));
    if (Math.abs(value - this._ambienceLevel) < 0.01) return;
    this._ambienceLevel = value;
    if (!this.ready || !this._ambience) return;
    this._ambience.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.25);
  }

  /* ---------------------------------------------------------------- *
   * One-shot SFX helpers
   * ---------------------------------------------------------------- */

  /**
   * Simple enveloped oscillator.
   * @param {Object} spec
   */
  tone(spec) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const {
      freq = 440,
      type = 'sine',
      duration = 0.2,
      gain = 0.3,
      attack = 0.006,
      slideTo = null,
      delay = 0,
      detune = 0,
      filter = null,
      curve = 'exp',
    } = spec;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo != null) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + duration);
      else osc.frequency.linearRampToValueAtTime(Math.max(1, slideTo), start + duration);
    }
    if (detune) osc.detune.value = detune;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    let node = osc;
    if (filter) {
      const biquad = ctx.createBiquadFilter();
      biquad.type = filter.type ?? 'lowpass';
      biquad.frequency.setValueAtTime(filter.freq ?? 1200, start);
      if (filter.slideTo) biquad.frequency.exponentialRampToValueAtTime(Math.max(40, filter.slideTo), start + duration);
      biquad.Q.value = filter.q ?? 1;
      node.connect(biquad);
      node = biquad;
    }
    node.connect(env).connect(this.sfxBus);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /** Filtered noise burst — splashes, hits, hats. */
  noise(spec = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const {
      duration = 0.2,
      gain = 0.3,
      type = 'bandpass',
      freq = 1200,
      q = 1,
      slideTo = null,
      delay = 0,
      attack = 0.004,
    } = spec;
    const start = ctx.currentTime + delay;

    const source = ctx.createBufferSource();
    source.buffer = this._noiseBuffer;
    source.loop = true;
    const offset = Math.random() * (this._noiseBuffer.duration - duration - 0.1);

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, start);
    if (slideTo != null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), start + duration);
    filter.Q.value = q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter).connect(env).connect(this.sfxBus);
    source.start(start, Math.max(0, offset));
    source.stop(start + duration + 0.05);
  }

  /* ---------------------------------------------------------------- *
   * Game sounds
   * ---------------------------------------------------------------- */

  jump() {
    this.tone({ freq: 300, slideTo: 720, type: 'triangle', duration: 0.17, gain: 0.24 });
    this.noise({ freq: 900, slideTo: 2400, duration: 0.13, gain: 0.14, q: 0.8 });
  }

  land() {
    this.noise({ freq: 1500, slideTo: 260, duration: 0.28, gain: 0.3, q: 0.7 });
    this.tone({ freq: 150, slideTo: 70, type: 'sine', duration: 0.2, gain: 0.2 });
  }

  coin(pitchStep = 0) {
    const base = 880 * Math.pow(2, Math.min(pitchStep, 12) / 24);
    this.tone({ freq: base, type: 'square', duration: 0.07, gain: 0.13 });
    this.tone({ freq: base * 1.5, type: 'square', duration: 0.09, gain: 0.1, delay: 0.055 });
  }

  shell() {
    this.tone({ freq: 620, slideTo: 1240, type: 'sine', duration: 0.22, gain: 0.2 });
    this.tone({ freq: 930, type: 'triangle', duration: 0.18, gain: 0.12, delay: 0.05 });
  }

  pearl() {
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((freq, i) => {
      this.tone({ freq, type: 'sine', duration: 0.4, gain: 0.16, delay: i * 0.06 });
    });
  }

  powerUp() {
    [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5].forEach((freq, i) => {
      this.tone({ freq, type: 'square', duration: 0.14, gain: 0.13, delay: i * 0.045 });
    });
    this.tone({ freq: 200, slideTo: 900, type: 'sawtooth', duration: 0.3, gain: 0.1, filter: { type: 'lowpass', freq: 2200, slideTo: 900 } });
  }

  shieldBreak() {
    this.tone({ freq: 1400, slideTo: 300, type: 'triangle', duration: 0.35, gain: 0.24 });
    this.noise({ freq: 3200, slideTo: 500, duration: 0.3, gain: 0.2 });
  }

  hit() {
    this.noise({ freq: 700, slideTo: 90, duration: 0.42, gain: 0.42, q: 0.5 });
    this.tone({ freq: 180, slideTo: 55, type: 'sawtooth', duration: 0.36, gain: 0.3, filter: { type: 'lowpass', freq: 900, slideTo: 200 } });
  }

  wipeout() {
    this.noise({ freq: 1800, slideTo: 120, duration: 0.9, gain: 0.4, q: 0.6 });
    this.tone({ freq: 240, slideTo: 48, type: 'sawtooth', duration: 0.8, gain: 0.26, filter: { type: 'lowpass', freq: 1400, slideTo: 160 } });
    this.tone({ freq: 120, slideTo: 40, type: 'sine', duration: 0.9, gain: 0.2, delay: 0.05 });
  }

  gameOver() {
    [NOTE.A4, NOTE.G4, NOTE.F4, NOTE.E4].forEach((freq, i) => {
      this.tone({ freq, type: 'triangle', duration: 0.5, gain: 0.2, delay: i * 0.16 });
    });
    this.tone({ freq: NOTE.A2, type: 'sine', duration: 1.4, gain: 0.18, delay: 0.6 });
  }

  achievement() {
    [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5].forEach((freq, i) => {
      this.tone({ freq, type: 'triangle', duration: 0.5, gain: 0.16, delay: i * 0.07 });
    });
  }

  uiHover() {
    this.tone({ freq: 660, type: 'sine', duration: 0.05, gain: 0.05 });
  }

  uiClick() {
    this.tone({ freq: 520, slideTo: 780, type: 'square', duration: 0.08, gain: 0.1 });
  }

  uiBack() {
    this.tone({ freq: 520, slideTo: 320, type: 'square', duration: 0.09, gain: 0.09 });
  }

  countdown(final = false) {
    if (final) {
      this.tone({ freq: NOTE.C5, type: 'square', duration: 0.35, gain: 0.22 });
      this.tone({ freq: NOTE.G5, type: 'triangle', duration: 0.4, gain: 0.16, delay: 0.04 });
    } else {
      this.tone({ freq: 440, type: 'square', duration: 0.14, gain: 0.14 });
    }
  }

  krakenWarning() {
    this.tone({ freq: 70, slideTo: 40, type: 'sawtooth', duration: 1.6, gain: 0.3, filter: { type: 'lowpass', freq: 400 } });
    this.tone({ freq: 104, slideTo: 62, type: 'square', duration: 1.4, gain: 0.14, delay: 0.1 });
    this.noise({ freq: 200, slideTo: 60, duration: 1.8, gain: 0.18, q: 0.4 });
  }

  krakenRoar() {
    this.tone({ freq: 90, slideTo: 46, type: 'sawtooth', duration: 1.1, gain: 0.34, filter: { type: 'lowpass', freq: 700, slideTo: 220 } });
    this.tone({ freq: 61, slideTo: 33, type: 'square', duration: 1.2, gain: 0.2 });
    this.noise({ freq: 620, slideTo: 120, duration: 1.3, gain: 0.28, q: 0.6 });
  }

  thunder() {
    this.noise({ freq: 260, slideTo: 60, duration: 1.5, gain: 0.22, q: 0.35, type: 'lowpass' });
    this.tone({ freq: 58, slideTo: 30, type: 'sine', duration: 1.2, gain: 0.2 });
  }

  splash() {
    this.noise({ freq: 2200, slideTo: 400, duration: 0.22, gain: 0.14, q: 0.7 });
  }

  boost() {
    this.tone({ freq: 220, slideTo: 1400, type: 'sawtooth', duration: 0.45, gain: 0.16, filter: { type: 'lowpass', freq: 900, slideTo: 4200 } });
    this.noise({ freq: 500, slideTo: 3500, duration: 0.4, gain: 0.12 });
  }

  eventStart() {
    [NOTE.G4, NOTE.B4, NOTE.D4 * 2].forEach((freq, i) => {
      this.tone({ freq, type: 'sawtooth', duration: 0.28, gain: 0.1, delay: i * 0.08, filter: { type: 'lowpass', freq: 2600 } });
    });
  }

  /* ---------------------------------------------------------------- *
   * Procedural music
   * ---------------------------------------------------------------- */

  _startMusic() {
    this._music = {
      mood: 'menu',
      step: 0,
      nextNoteTime: this.ctx.currentTime + 0.1,
      intensity: 0,
      playing: true,
      chordIndex: 0,
    };
    this._schedulerId = setInterval(() => this._scheduler(), this._scheduleTimer);
  }

  /** @param {'menu'|'game'|'chase'} mood */
  setMood(mood) {
    if (!this._music) return;
    if (this._music.mood === mood) return;
    this._music.mood = mood;
    this._music.chordIndex = 0;
    this._music.step = 0;
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = enabled;
    if (this._music) this._music.playing = enabled;
  }

  /** 0..1 — drives filter brightness and percussion density. */
  setIntensity(value) {
    if (this._music) this._music.intensity = Math.max(0, Math.min(1, value));
  }

  _scheduler() {
    if (!this.ready || !this._music || !this._music.playing || !this.musicEnabled) return;
    const ctx = this.ctx;
    const mood = MOODS[this._music.mood] ?? MOODS.game;
    const bpm = mood.bpm * (1 + this._music.intensity * 0.09);
    const stepDuration = 60 / bpm / 4; // sixteenth notes

    while (this._music.nextNoteTime < ctx.currentTime + this._lookahead) {
      this._scheduleStep(this._music.step, this._music.nextNoteTime, stepDuration, mood);
      this._music.nextNoteTime += stepDuration;
      this._music.step = (this._music.step + 1) % 64;
      if (this._music.step % 16 === 0) {
        this._music.chordIndex = (this._music.chordIndex + 1) % 4;
      }
    }
  }

  _scheduleStep(step, time, stepDuration, mood) {
    const progression = PROGRESSIONS[this._music.mood] ?? PROGRESSIONS.game;
    const chord = progression[this._music.chordIndex];
    const beat = step % 16;
    const intensity = this._music.intensity;
    const cutoff = mood.cutoff * (0.7 + intensity * 0.6);
    const level = mood.gain * (0.55 + intensity * 0.45);

    const voice = (freq, type, duration, gain, filterFreq) => {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, time);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterFreq ?? cutoff, time);
      osc.connect(filter).connect(env).connect(this.musicBus);
      osc.start(time);
      osc.stop(time + duration + 0.05);
    };

    const drum = (kind) => {
      if (kind === 'kick') {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(45, time + 0.11);
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, time);
        env.gain.exponentialRampToValueAtTime(0.5 * level, time + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
        osc.connect(env).connect(this.musicBus);
        osc.start(time);
        osc.stop(time + 0.2);
        return;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = this._noiseBuffer;
      source.loop = true;
      const filter = this.ctx.createBiquadFilter();
      const env = this.ctx.createGain();
      const isHat = kind === 'hat';
      filter.type = isHat ? 'highpass' : 'bandpass';
      filter.frequency.setValueAtTime(isHat ? 7000 : 1900, time);
      filter.Q.value = isHat ? 0.8 : 0.9;
      const dur = isHat ? 0.045 : 0.14;
      env.gain.setValueAtTime(0.0001, time);
      env.gain.exponentialRampToValueAtTime((isHat ? 0.09 : 0.2) * level, time + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      source.connect(filter).connect(env).connect(this.musicBus);
      source.start(time, Math.random() * 1.5);
      source.stop(time + dur + 0.05);
    };

    // Bass: driving eighths.
    if (beat % 2 === 0) {
      voice(chord.bass, 'sawtooth', stepDuration * 1.7, 0.11 * level, 420 + intensity * 320);
    }
    // Arpeggio: sixteenths, gated by mood density.
    if (Math.random() < mood.density && beat % 2 === 1) {
      const note = chord.notes[(step >> 1) % chord.notes.length];
      voice(note, 'square', stepDuration * 1.2, 0.045 * level, 1500 + intensity * 2200);
    }
    // Pad on the downbeat.
    if (beat === 0) {
      voice(chord.notes[0] / 2, 'triangle', stepDuration * 12, 0.05 * level, 1100);
      voice(chord.notes[2] / 2, 'triangle', stepDuration * 12, 0.035 * level, 900);
    }
    // Drums.
    if (beat === 0 || beat === 8) drum('kick');
    if (beat === 4 || beat === 12) drum('snare');
    if (this._music.mood !== 'menu' && beat % 2 === 0) drum('hat');
    if (this._music.mood === 'chase' && beat % 4 === 2) drum('kick');
    // Chase lead: a tense top line.
    if (this._music.mood === 'chase' && beat % 8 === 0) {
      voice(chord.notes[3] * 2, 'sawtooth', stepDuration * 3, 0.05 * level, 3000);
    }
  }

  /* ---------------------------------------------------------------- *
   * Teardown
   * ---------------------------------------------------------------- */

  dispose() {
    if (this._schedulerId) {
      clearInterval(this._schedulerId);
      this._schedulerId = null;
    }
    try {
      this._ambience?.source.stop();
      this._ambience?.lfo.stop();
      this._ambience?.lfo2.stop();
      this._surf?.source.stop();
    } catch {
      /* already stopped */
    }
    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.ready = false;
  }
}
