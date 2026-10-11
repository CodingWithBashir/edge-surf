/**
 * Game mode definitions.
 *
 * Every mode exposed in the UI has a complete configuration here — there are
 * no "coming soon" entries. `buildRunConfig` merges the mode table with the
 * daily-challenge modifiers so the rest of the game reads one flat object.
 */

import { Rng, seedFromDate } from '../../core/Rng.js';

export const Environment = Object.freeze({
  DAY: 'day',
  SUNSET: 'sunset',
  NIGHT: 'night',
});

export const Weather = Object.freeze({
  CLEAR: 'clear',
  CLOUDY: 'cloudy',
  STORM: 'storm',
});

/** How the HUD objective bar is rendered. */
export const Objective = Object.freeze({
  NONE: 'none',
  DISTANCE: 'distance',
  TIME: 'time',
  GOAL: 'goal',
  CHASE: 'chase',
});

/**
 * @typedef {Object} ModeDef
 * @property {string} id
 * @property {string} name
 * @property {string} tag
 * @property {string} description
 * @property {number} lives           0 = cannot fail
 * @property {number} timeLimit       seconds, 0 = unlimited
 * @property {number} goalDistance    metres, 0 = endless
 * @property {number} difficultyCap   max normalised difficulty for this mode
 * @property {number} lanes
 * @property {boolean} kraken
 * @property {boolean} recordScore    persists to records / leaderboard
 * @property {boolean} hazardScale
 * @property {number} speedScale
 * @property {number} powerupScale
 * @property {string} environment
 * @property {string} weather
 * @property {'random'|'daily'} seedSource
 * @property {string} objective
 */

/** @type {Record<string, ModeDef>} */
export const MODES = {
  endless: {
    id: 'endless',
    name: 'Endless Surf',
    tag: 'Main mode',
    description:
      'Drop in and ride forever. Speed and hazard density climb the whole way, and the Kraken wakes up every 1,200 m.',
    lives: 3,
    timeLimit: 0,
    goalDistance: 0,
    difficultyCap: 1,
    lanes: 5,
    kraken: true,
    recordScore: true,
    hazardScale: 1,
    speedScale: 1,
    powerupScale: 1,
    environment: Environment.DAY,
    weather: Weather.CLEAR,
    seedSource: 'random',
    objective: Objective.DISTANCE,
  },
  timeTrial: {
    id: 'timeTrial',
    name: 'Time Trial',
    tag: '90 seconds',
    description:
      'Ninety seconds on the clock. Chain coins and clean lines for a huge score — every wipeout costs you three seconds.',
    lives: 0,
    timeLimit: 90,
    goalDistance: 0,
    difficultyCap: 0.85,
    lanes: 5,
    kraken: false,
    recordScore: true,
    hazardScale: 1.05,
    speedScale: 1.08,
    powerupScale: 1.15,
    environment: Environment.SUNSET,
    weather: Weather.CLEAR,
    seedSource: 'random',
    objective: Objective.TIME,
  },
  zigzag: {
    id: 'zigzag',
    name: 'Zigzag Challenge',
    tag: 'Precision',
    description:
      'A narrow three-lane channel packed with moving hazards. Survive 2,500 m and the run counts as complete.',
    lives: 3,
    timeLimit: 0,
    goalDistance: 2500,
    difficultyCap: 0.95,
    lanes: 3,
    kraken: true,
    recordScore: true,
    hazardScale: 1.4,
    speedScale: 1.05,
    powerupScale: 0.85,
    environment: Environment.DAY,
    weather: Weather.CLOUDY,
    seedSource: 'random',
    objective: Objective.GOAL,
  },
  daily: {
    id: 'daily',
    name: 'Daily Challenge',
    tag: 'Same seed for everyone',
    description:
      'One course per day, generated from the calendar date, with two random modifiers. Your best daily score is kept.',
    lives: 3,
    timeLimit: 0,
    goalDistance: 0,
    difficultyCap: 1,
    lanes: 5,
    kraken: true,
    recordScore: true,
    hazardScale: 1,
    speedScale: 1,
    powerupScale: 1,
    environment: Environment.DAY,
    weather: Weather.CLEAR,
    seedSource: 'daily',
    objective: Objective.DISTANCE,
  },
  practice: {
    id: 'practice',
    name: 'Practice Mode',
    tag: 'No pressure',
    description:
      'Learn the controls with a forgiving course, no lives and no time limit. Scores and records are not saved here.',
    lives: 0,
    timeLimit: 0,
    goalDistance: 0,
    difficultyCap: 0.35,
    lanes: 5,
    kraken: false,
    recordScore: false,
    hazardScale: 0.7,
    speedScale: 0.85,
    powerupScale: 1.4,
    environment: Environment.DAY,
    weather: Weather.CLEAR,
    seedSource: 'random',
    objective: Objective.NONE,
  },
};

export const MODE_LIST = Object.values(MODES);

/* ------------------------------------------------------------------ *
 * Daily challenge modifiers
 * ------------------------------------------------------------------ */

const MODIFIERS = [
  {
    id: 'tailwind',
    name: 'Tailwind',
    description: '+18% board speed all run.',
    apply: (cfg) => {
      cfg.speedScale *= 1.18;
    },
  },
  {
    id: 'crowded',
    name: 'Crowded Line-up',
    description: 'Far more hazards on the water.',
    apply: (cfg) => {
      cfg.hazardScale *= 1.35;
    },
  },
  {
    id: 'squall',
    name: 'Squall',
    description: 'Storm weather: rain, wind and heavy swell.',
    apply: (cfg) => {
      cfg.weather = Weather.STORM;
      cfg.waveScale = (cfg.waveScale ?? 1) * 1.45;
    },
  },
  {
    id: 'goldenHour',
    name: 'Golden Hour',
    description: 'A sunset session across the whole run.',
    apply: (cfg) => {
      cfg.environment = Environment.SUNSET;
    },
  },
  {
    id: 'nightSurf',
    name: 'Night Surf',
    description: 'Moonlight, bioluminescent foam.',
    apply: (cfg) => {
      cfg.environment = Environment.NIGHT;
    },
  },
  {
    id: 'bigSwell',
    name: 'Big Swell',
    description: 'Waves are 60% larger. Timing matters.',
    apply: (cfg) => {
      cfg.waveScale = (cfg.waveScale ?? 1) * 1.6;
    },
  },
  {
    id: 'scarcity',
    name: 'Scarcity',
    description: 'Power-ups are rare — make them count.',
    apply: (cfg) => {
      cfg.powerupScale *= 0.4;
    },
  },
  {
    id: 'gauntlet',
    name: 'Gauntlet',
    description: 'The Kraken wakes up twice as often.',
    apply: (cfg) => {
      cfg.krakenIntervalScale = 0.5;
    },
  },
];

export const MODIFIER_LIST = MODIFIERS.map(({ id, name, description }) => ({ id, name, description }));

/* ------------------------------------------------------------------ *
 * Run configuration
 * ------------------------------------------------------------------ */

/**
 * Build the flat configuration object the simulation reads.
 *
 * @param {string} modeId
 * @param {{date?:Date, seed?:number, modifiers?:string[]}} [options]
 */
export function buildRunConfig(modeId, options = {}) {
  const mode = MODES[modeId] ?? MODES.endless;
  const date = options.date ?? new Date();

  /** @type {any} */
  const config = {
    modeId: mode.id,
    name: mode.name,
    description: mode.description,
    lives: mode.lives,
    timeLimit: mode.timeLimit,
    goalDistance: mode.goalDistance,
    difficultyCap: mode.difficultyCap,
    lanes: mode.lanes,
    kraken: mode.kraken,
    recordScore: mode.recordScore,
    hazardScale: mode.hazardScale,
    speedScale: mode.speedScale,
    powerupScale: mode.powerupScale,
    environment: mode.environment,
    weather: mode.weather,
    objective: mode.objective,
    waveScale: 1,
    krakenIntervalScale: 1,
    modifiers: [],
    seed: 0,
    dateKey: null,
  };

  if (mode.seedSource === 'daily') {
    config.seed = options.seed ?? seedFromDate(date);
    config.dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
      date.getUTCDate()
    ).padStart(2, '0')}`;

    // Pick two deterministic modifiers from the day's seed.
    const rng = new Rng(config.seed ^ 0x5f3759df);
    const chosen = rng.sample(MODIFIERS, 2);
    config.modifiers = chosen.map((m) => m.id);
    for (const modifier of chosen) modifier.apply(config);
  } else {
    config.seed = options.seed ?? (Math.random() * 0xffffffff) >>> 0;
  }

  return config;
}

/** Resolve modifier ids to their display objects (used by the ready screen). */
export function describeModifiers(ids = []) {
  return ids.map((id) => MODIFIER_LIST.find((m) => m.id === id)).filter(Boolean);
}

export function getMode(id) {
  return MODES[id] ?? MODES.endless;
}
