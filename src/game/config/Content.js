/**
 * Surf Rush content tables.
 *
 * Everything here is data: hazard behaviour, collision volumes, power-up
 * timings, unlockable cosmetics and achievement definitions. Keeping it in one
 * place makes balancing possible without touching simulation code.
 *
 * Collision volumes are authored in *water space*: y = 0 is the mean water
 * surface, x is the lane axis, z runs along the course (negative = ahead).
 */

/* ------------------------------------------------------------------ *
 * Hazards
 * ------------------------------------------------------------------ */

export const HAZARD_BEHAVIOUR = Object.freeze({
  /** Too tall to jump — change lane. */
  DODGE: 'dodge',
  /** Low enough to clear with a jump. */
  JUMP: 'jump',
  /** Overhead — hold Down to duck beneath it. */
  DUCK: 'duck',
});

/**
 * @typedef {Object} HazardDef
 * @property {string} id
 * @property {string} label
 * @property {string} behaviour   one of HAZARD_BEHAVIOUR
 * @property {number} weight      base spawn weight
 * @property {number} minDifficulty 0..1 gate before this hazard appears
 * @property {number} lanes       how many adjacent lanes it blocks (1 or 2)
 * @property {boolean} [moving]   oscillates between lanes
 * @property {number} [moveAmp]   lane units of lateral oscillation
 * @property {number} [moveSpeed]
 * @property {{kind:'box', half:[number,number,number], y:number}
 *           |{kind:'cylinder', radius:number, bottom:number, top:number}
 *           |{kind:'sphere', radius:number, y:number}} volume
 * @property {number} color       hex, used by the legend and low-detail LOD
 * @property {string} legend      How-to-Play description
 */

/** @type {Record<string, HazardDef>} */
export const HAZARDS = {
  rock: {
    id: 'rock',
    label: 'Rock',
    behaviour: HAZARD_BEHAVIOUR.DODGE,
    weight: 22,
    minDifficulty: 0,
    lanes: 1,
    volume: { kind: 'cylinder', radius: 1.0, bottom: -0.7, top: 2.7 },
    color: 0x6b7a86,
    legend: 'Too tall to jump. Steer around it.',
  },
  coral: {
    id: 'coral',
    label: 'Coral head',
    behaviour: HAZARD_BEHAVIOUR.JUMP,
    weight: 17,
    minDifficulty: 0,
    lanes: 1,
    volume: { kind: 'box', half: [0.85, 0.5, 0.85], y: 0.5 },
    color: 0xff7a9c,
    legend: 'Snags the board. Tap Jump to clear it.',
  },
  log: {
    id: 'log',
    label: 'Floating log',
    behaviour: HAZARD_BEHAVIOUR.JUMP,
    weight: 15,
    minDifficulty: 0,
    lanes: 1,
    volume: { kind: 'box', half: [1.6, 0.42, 0.45], y: 0.42 },
    color: 0x8a5a34,
    legend: 'Wide but low — jump it.',
  },
  buoy: {
    id: 'buoy',
    label: 'Buoy',
    behaviour: HAZARD_BEHAVIOUR.DODGE,
    weight: 14,
    minDifficulty: 0,
    lanes: 1,
    volume: { kind: 'cylinder', radius: 0.62, bottom: -0.5, top: 2.3 },
    color: 0xff6b6b,
    legend: 'Bobs on the swell. Change lane.',
  },
  whitewater: {
    id: 'whitewater',
    label: 'Breaking wave',
    behaviour: HAZARD_BEHAVIOUR.JUMP,
    weight: 11,
    minDifficulty: 0.05,
    lanes: 2,
    volume: { kind: 'box', half: [2.1, 0.45, 0.6], y: 0.45 },
    color: 0xd8f4ff,
    legend: 'A foaming wall. Jump the crest.',
  },
  driftwood: {
    id: 'driftwood',
    label: 'Driftwood arch',
    behaviour: HAZARD_BEHAVIOUR.DUCK,
    weight: 11,
    minDifficulty: 0.12,
    lanes: 1,
    volume: { kind: 'box', half: [1.6, 0.42, 0.32], y: 1.6 },
    color: 0xa9713f,
    legend: 'Overhead. Hold Down to duck under.',
  },
  rockFormation: {
    id: 'rockFormation',
    label: 'Rock formation',
    behaviour: HAZARD_BEHAVIOUR.DODGE,
    weight: 9,
    minDifficulty: 0.18,
    lanes: 2,
    volume: { kind: 'cylinder', radius: 1.15, bottom: -0.7, top: 3.1 },
    color: 0x5b6a76,
    legend: 'Two lanes of granite. Pick the gap.',
  },
  movingBuoy: {
    id: 'movingBuoy',
    label: 'Drifting buoy',
    behaviour: HAZARD_BEHAVIOUR.DODGE,
    weight: 9,
    minDifficulty: 0.28,
    lanes: 1,
    moving: true,
    moveAmp: 1.3,
    moveSpeed: 0.75,
    volume: { kind: 'cylinder', radius: 0.7, bottom: -0.5, top: 2.4 },
    color: 0xffa94d,
    legend: 'Drifts across lanes. Time your pass.',
  },
  jellyfish: {
    id: 'jellyfish',
    label: 'Stinger bloom',
    behaviour: HAZARD_BEHAVIOUR.DODGE,
    weight: 8,
    minDifficulty: 0.38,
    lanes: 1,
    volume: { kind: 'cylinder', radius: 0.8, bottom: 0, top: 2.2 },
    color: 0xb388ff,
    legend: 'Tall and soft. Do not touch.',
  },
  stormDebris: {
    id: 'stormDebris',
    label: 'Storm debris',
    behaviour: HAZARD_BEHAVIOUR.JUMP,
    weight: 9,
    minDifficulty: 0.45,
    lanes: 1,
    volume: { kind: 'box', half: [0.9, 0.5, 0.5], y: 0.5 },
    color: 0xc9b28a,
    legend: 'Storm-tossed crate — jump it.',
  },
  whirlpool: {
    id: 'whirlpool',
    label: 'Whirlpool',
    behaviour: HAZARD_BEHAVIOUR.JUMP,
    weight: 6,
    minDifficulty: 0.55,
    lanes: 2,
    volume: { kind: 'box', half: [2.3, 0.3, 1.6], y: 0.15 },
    color: 0x1d4e6b,
    legend: 'Broad and sucking. Needs a full jump.',
  },
  spinner: {
    id: 'spinner',
    label: 'Spinning boom',
    behaviour: HAZARD_BEHAVIOUR.JUMP,
    weight: 7,
    minDifficulty: 0.62,
    lanes: 2,
    moving: true,
    moveAmp: 0.9,
    moveSpeed: 1.35,
    volume: { kind: 'box', half: [2.0, 0.4, 0.4], y: 0.4 },
    color: 0xe0c068,
    legend: 'Rotating boom — jump, or dodge wide.',
  },
  narrowPassage: {
    id: 'narrowPassage',
    label: 'Narrow passage',
    behaviour: HAZARD_BEHAVIOUR.DODGE,
    weight: 7,
    minDifficulty: 0.2,
    lanes: 1,
    volume: { kind: 'cylinder', radius: 1.0, bottom: -0.7, top: 3.0 },
    color: 0x74838d,
    legend: 'Only one lane is open. Commit early.',
  },
};

/** Ordered array form for weighted picks. */
export const HAZARD_LIST = Object.values(HAZARDS);

/* ------------------------------------------------------------------ *
 * Collectibles
 * ------------------------------------------------------------------ */

export const COLLECTIBLES = Object.freeze({
  coin: { id: 'coin', value: 10, score: 25, radius: 0.62, color: 0xffd166, label: 'Coin' },
  shell: { id: 'shell', value: 25, score: 75, radius: 0.7, color: 0xff9ec7, label: 'Shell' },
  pearl: { id: 'pearl', value: 60, score: 200, radius: 0.72, color: 0xe8f6ff, label: 'Pearl' },
  escapeOrb: { id: 'escapeOrb', value: 0, score: 150, radius: 0.95, color: 0x2ee6c5, label: 'Escape orb' },
});

/* ------------------------------------------------------------------ *
 * Power-ups
 * ------------------------------------------------------------------ */

/**
 * @typedef {Object} PowerUpDef
 * @property {string} id
 * @property {string} label
 * @property {number} duration seconds (0 = instant effect)
 * @property {number} color
 * @property {number} weight spawn weight
 * @property {boolean} instant
 * @property {string} legend
 */

/** @type {Record<string, PowerUpDef>} */
export const POWERUPS = {
  magnet: {
    id: 'magnet',
    label: 'Coin Magnet',
    duration: 9,
    color: 0x38bdf8,
    weight: 26,
    instant: false,
    legend: 'Pulls nearby coins to your board for 9s.',
    radius: 11,
  },
  shield: {
    id: 'shield',
    label: 'Shield',
    duration: 14,
    color: 0x2ee6c5,
    weight: 24,
    instant: false,
    legend: 'Absorbs exactly one wipeout for 14s.',
  },
  boost: {
    id: 'boost',
    label: 'Speed Boost',
    duration: 6,
    color: 0xffd166,
    weight: 20,
    instant: false,
    legend: '+55% board speed and double distance points for 6s.',
    speedFactor: 1.55,
  },
  multiplier: {
    id: 'multiplier',
    label: 'Score x2',
    duration: 10,
    color: 0xff8a7a,
    weight: 18,
    instant: false,
    legend: 'Adds +2 to your score multiplier for 10s.',
    multiplierBonus: 2,
  },
  extralife: {
    id: 'extralife',
    label: 'Extra Life',
    duration: 0,
    color: 0x7dff9b,
    weight: 12,
    instant: true,
    legend: 'Grants one more chance (where the mode has lives).',
  },
};

export const POWERUP_LIST = Object.values(POWERUPS);

/* ------------------------------------------------------------------ *
 * Cosmetics — surfers
 * ------------------------------------------------------------------ */

/**
 * A cosmetic is owned from the first launch when it is free *and* has no
 * special unlock condition. Things with an `unlock` are earned by playing;
 * things with a `cost` are bought with coins.
 */
export function isStarter(def) {
  return !def.unlock && (def.cost ?? 0) === 0;
}

/** @type {Array<{id:string,name:string,description:string,cost:number,
 *   wetsuit:number, wetsuitAlt:number, skin:number, hair:number, board:number,
 *   boardAlt:number, hairStyle:string, unlock?:{type:string,value:number,label:string}}>} */
export const CHARACTERS = [
  {
    id: 'kai',
    name: 'Kai',
    description: 'Balanced all-rounder with a calm, low stance.',
    cost: 0,
    wetsuit: 0x1f6f8b,
    wetsuitAlt: 0x0d3b4d,
    skin: 0xd9a06b,
    hair: 0x2b1b12,
    board: 0x2ee6c5,
    boardAlt: 0xffffff,
    hairStyle: 'short',
  },
  {
    id: 'nalu',
    name: 'Nalu',
    description: 'Loose, springy style. Loves a big air.',
    cost: 0,
    wetsuit: 0xff6b6b,
    wetsuitAlt: 0x8c1f3a,
    skin: 0x8d5524,
    hair: 0x14100e,
    board: 0xffd166,
    boardAlt: 0xff8a7a,
    hairStyle: 'long',
  },
  {
    id: 'mira',
    name: 'Mira',
    description: 'Precise line-holder with sharp rail turns.',
    cost: 600,
    wetsuit: 0x8b5cf6,
    wetsuitAlt: 0x3b1f7a,
    skin: 0xf0c8a0,
    hair: 0x4a2c1a,
    board: 0xa78bfa,
    boardAlt: 0xffffff,
    hairStyle: 'bun',
  },
  {
    id: 'tama',
    name: 'Tama',
    description: 'Heavy-water specialist. Steady in the storm.',
    cost: 0,
    wetsuit: 0x0f766e,
    wetsuitAlt: 0x04302c,
    skin: 0x6b4423,
    hair: 0x0d0b09,
    board: 0x34d399,
    boardAlt: 0x052e2b,
    hairStyle: 'cap',
    unlock: { type: 'distance', value: 25000, label: 'Surf 25 km in total' },
  },
  {
    id: 'sora',
    name: 'Sora',
    description: 'Outran the Kraken and kept the board. Respect.',
    cost: 0,
    wetsuit: 0x0b3b6f,
    wetsuitAlt: 0x061d3a,
    skin: 0xe8b98a,
    hair: 0x141414,
    board: 0x38bdf8,
    boardAlt: 0x0b3b6f,
    hairStyle: 'ponytail',
    unlock: { type: 'achievement', value: 'krakenEscapee', label: 'Escape the Kraken' },
  },
];

/* ------------------------------------------------------------------ *
 * Cosmetics — boards
 * ------------------------------------------------------------------ */

/** @type {Array<{id:string,name:string,description:string,cost:number,
 *   body:number, stripe:number, rail:number, style:string}>} */
export const BOARDS = [
  { id: 'classic', name: 'Classic Foamie', description: 'The trustworthy starter.', cost: 0, body: 0x2ee6c5, stripe: 0xffffff, rail: 0x0e5f57, style: 'stripe' },
  { id: 'sunset', name: 'Sunset Cruiser', description: 'Warm gradient, longboard feel.', cost: 350, body: 0xff9f43, stripe: 0xffd166, rail: 0x8c3b00, style: 'gradient' },
  { id: 'abyss', name: 'Abyss', description: 'Deep-water camo for night sessions.', cost: 900, body: 0x1e3a8a, stripe: 0x38bdf8, rail: 0x0b1740, style: 'gradient' },
  { id: 'reef', name: 'Reef Runner', description: 'Coral-bright and impossible to miss.', cost: 1400, body: 0xff7a9c, stripe: 0xffe3ec, rail: 0x8c2f4c, style: 'stripe' },
  { id: 'thunder', name: 'Thunderbolt', description: 'Charged rails. Pure arcade energy.', cost: 2200, body: 0xfacc15, stripe: 0x1f2937, rail: 0x78350f, style: 'bolt' },
  {
    id: 'kraken',
    name: 'Kraken Scale',
    description: 'Cured in ink. Only for those who got away.',
    cost: 0,
    body: 0x4c1d95,
    stripe: 0xa78bfa,
    rail: 0x1e1b4b,
    style: 'scale',
    unlock: { type: 'achievement', value: 'krakenEscapee', label: 'Escape the Kraken' },
  },
];

/* ------------------------------------------------------------------ *
 * Achievements
 * ------------------------------------------------------------------ */

/**
 * @typedef {Object} AchievementDef
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {'distance'|'coins'|'score'|'runs'|'obstacles'|'jumps'|'kraken'|'mode'|'combo'|'clean'|'daily'|'unlock'} metric
 * @property {number} target
 * @property {number} reward coins granted on unlock
 * @property {(stats:any)=>number} [progress] current progress from lifetime stats
 */

/** @type {AchievementDef[]} */
export const ACHIEVEMENTS = [
  { id: 'firstDrop', name: 'First Drop', description: 'Finish your first run.', metric: 'runs', target: 1, reward: 25 },
  { id: 'mileOne', name: 'One Click', description: 'Travel 1,000 m in a single run.', metric: 'bestDistance', target: 1000, reward: 50 },
  { id: 'mileFive', name: 'Five Clicks', description: 'Travel 5,000 m in a single run.', metric: 'bestDistance', target: 5000, reward: 100 },
  { id: 'marathon', name: 'Blue Marathon', description: 'Travel 10,000 m in a single run.', metric: 'bestDistance', target: 10000, reward: 250 },
  { id: 'coinHunter', name: 'Coin Hunter', description: 'Collect 500 coins in total.', metric: 'totalCoins', target: 500, reward: 50 },
  { id: 'coinBaron', name: 'Coin Baron', description: 'Collect 5,000 coins in total.', metric: 'totalCoins', target: 5000, reward: 250 },
  { id: 'piggyBank', name: 'Piggy Bank', description: 'Collect 200 coins in one run.', metric: 'bestCoins', target: 200, reward: 150 },
  { id: 'airTime', name: 'Air Time', description: 'Land 250 jumps in total.', metric: 'totalJumps', target: 250, reward: 75 },
  { id: 'threading', name: 'Threading the Needle', description: 'Pass 1,000 obstacles in total.', metric: 'totalObstacles', target: 1000, reward: 100 },
  { id: 'untouchable', name: 'Untouchable', description: 'Reach 3,000 m in one run without wiping out.', metric: 'bestCleanDistance', target: 3000, reward: 200 },
  { id: 'comboKing', name: 'Combo King', description: 'Reach a x5 score multiplier.', metric: 'bestMultiplier', target: 5, reward: 150 },
  { id: 'krakenEscapee', name: 'Kraken Escapee', description: 'Survive a full Kraken chase.', metric: 'krakenEscapes', target: 1, reward: 300 },
  { id: 'krakenTamer', name: 'Kraken Tamer', description: 'Escape the Kraken five times.', metric: 'krakenEscapes', target: 5, reward: 500 },
  { id: 'timeAttack', name: 'Against the Clock', description: 'Score 15,000 in Time Trial.', metric: 'bestScore_timeTrial', target: 15000, reward: 200 },
  { id: 'zigzagMaster', name: 'Zigzag Master', description: 'Complete the Zigzag Challenge course.', metric: 'zigzagCompletions', target: 1, reward: 300 },
  { id: 'dailyRegular', name: 'Daily Regular', description: 'Complete 5 daily challenges.', metric: 'dailyCompletions', target: 5, reward: 200 },
  { id: 'veteran', name: 'Line-up Veteran', description: 'Complete 50 runs.', metric: 'runs', target: 50, reward: 200 },
  { id: 'centurion', name: 'Centurion', description: 'Score 100,000 in a single run.', metric: 'bestScore', target: 100000, reward: 500 },
];

/* ------------------------------------------------------------------ *
 * Misc balance constants
 * ------------------------------------------------------------------ */

export const BALANCE = Object.freeze({
  /** Player collider, in water space. */
  player: {
    halfWidth: 0.42,
    halfDepth: 0.72,
    standingHeight: 1.75,
    crouchHeight: 0.95,
  },
  jump: {
    gravity: 44,
    velocity: 12.2,
    coyoteTime: 0.1,
    bufferTime: 0.14,
    /** Extra downward pull at the apex for a punchier arc. */
    fallMultiplier: 1.35,
  },
  lane: {
    count: 5,
    width: 2.3,
    /** Lateral units per second the board can shift. */
    maxLateralSpeed: 15.5,
    /** Exponential approach rate used for lane changes. */
    damp: 13.5,
  },
  score: {
    perMetre: 0.85,
    nearMiss: 15,
    hopBonus: 12,
    comboTiers: [
      { combo: 0, multiplier: 1 },
      { combo: 10, multiplier: 2 },
      { combo: 25, multiplier: 3 },
      { combo: 50, multiplier: 4 },
      { combo: 100, multiplier: 5 },
    ],
  },
  kraken: {
    /** Distance (m) between chases in Endless-like modes. */
    interval: 1200,
    warningTime: 2.4,
    /** Metres that must be surfed during a chase to escape. */
    escapeDistance: 700,
    /** Starting gap 0..100 (100 = far behind). */
    startGap: 72,
    /** Gap lost per second, scaled by difficulty. */
    drainPerSecond: 3.1,
    /** Gap regained per second when the player is surfing clean. */
    recoverPerSecond: 1.05,
    /** Instant gap penalty on a wipeout during a chase. */
    hitPenalty: 26,
    /** Gap gained per escape orb. */
    orbBonus: 14,
  },
});
