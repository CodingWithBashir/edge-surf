/**
 * Local persistence for Surf Rush.
 *
 * Everything lives in the browser's localStorage under a single versioned key.
 * The storage backend is injectable so the module can be unit tested in Node
 * (see tests/save.test.js) and can survive private-browsing modes where
 * localStorage throws on write.
 *
 * There is deliberately no cloud sync: the project ships without a server, so
 * no online account is advertised.
 */

import { ACHIEVEMENTS, CHARACTERS, BOARDS, isStarter } from '../game/config/Content.js';

export const STORAGE_KEY = 'surf-rush:save:v1';
export const SCHEMA_VERSION = 1;

/** In-memory storage used when localStorage is unavailable or in tests. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

export const DEFAULT_SETTINGS = Object.freeze({
  master: 0.7,
  music: 0.55,
  sfx: 0.8,
  muted: false,
  quality: 'auto',
  shadows: true,
  showFps: false,
  reduceMotion: false,
  highContrast: false,
  largeText: false,
  colorAssist: false,
  laneGuides: true,
  forceTouch: false,
  invertSwipe: false,
});

function defaultStats() {
  return {
    runs: 0,
    totalDistance: 0,
    totalCoins: 0,
    totalJumps: 0,
    totalObstacles: 0,
    bestScore: 0,
    bestDistance: 0,
    bestCoins: 0,
    bestMultiplier: 1,
    bestCleanDistance: 0,
    bestScore_timeTrial: 0,
    krakenEscapes: 0,
    zigzagCompletions: 0,
    dailyCompletions: 0,
  };
}

function defaultData() {
  return {
    version: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    coins: 0,
    selectedCharacter: CHARACTERS[0].id,
    selectedBoard: BOARDS[0].id,
    ownedCharacters: CHARACTERS.filter(isStarter).map((c) => c.id),
    ownedBoards: BOARDS.filter(isStarter).map((b) => b.id),
    achievements: {},
    stats: defaultStats(),
    /** @type {Record<string, Array<any>>} top runs per mode */
    records: {},
    /** @type {Record<string, number>} best score per daily date key */
    dailyBest: {},
    lastPlayedMode: 'endless',
  };
}

export class SaveManager {
  /** @param {{storage?:any, debounceMs?:number}} [options] */
  constructor(options = {}) {
    this.storage = options.storage ?? resolveStorage();
    this.debounceMs = options.debounceMs ?? 250;
    this._timer = null;
    this._dirty = false;
    this.data = defaultData();
    this.load();
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) {
        this.data = defaultData();
        return this.data;
      }
      const parsed = JSON.parse(raw);
      this.data = migrate(parsed);
    } catch (error) {
      console.warn('[SaveManager] could not read save data, starting fresh', error);
      this.data = defaultData();
    }
    return this.data;
  }

  save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this._dirty = false;
      return true;
    } catch (error) {
      // Quota exceeded or private mode — keep playing, just don't persist.
      console.warn('[SaveManager] could not write save data', error);
      return false;
    }
  }

  /** Coalesce frequent writes (coins tick up constantly during a run). */
  saveSoon() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._dirty) this.save();
    }, this.debounceMs);
  }

  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._dirty) this.save();
  }

  reset() {
    this.data = defaultData();
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.save();
    return this.data;
  }

  /* ---------------------------------------------------------------- *
   * Settings
   * ---------------------------------------------------------------- */

  get settings() {
    return this.data.settings;
  }

  getSetting(key) {
    return this.data.settings[key];
  }

  setSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return value;
    this.data.settings[key] = value;
    this.saveSoon();
    return value;
  }

  /* ---------------------------------------------------------------- *
   * Wallet & cosmetics
   * ---------------------------------------------------------------- */

  get coins() {
    return this.data.coins;
  }

  addCoins(amount) {
    const value = Math.max(0, Math.floor(amount));
    this.data.coins += value;
    this.saveSoon();
    return this.data.coins;
  }

  spendCoins(amount) {
    if (this.data.coins < amount) return false;
    this.data.coins -= amount;
    this.saveSoon();
    return true;
  }

  owns(kind, id) {
    const list = kind === 'character' ? this.data.ownedCharacters : this.data.ownedBoards;
    return list.includes(id);
  }

  /** @param {'character'|'board'} kind */
  purchase(kind, def) {
    if (!def || def.unlock) return { ok: false, reason: 'locked' };
    const list = kind === 'character' ? this.data.ownedCharacters : this.data.ownedBoards;
    if (list.includes(def.id)) return { ok: false, reason: 'owned' };
    if (this.data.coins < def.cost) return { ok: false, reason: 'poor' };
    this.data.coins -= def.cost;
    list.push(def.id);
    this.saveSoon();
    return { ok: true };
  }

  select(kind, id) {
    if (kind === 'character') {
      if (!this.owns('character', id)) return false;
      this.data.selectedCharacter = id;
    } else {
      if (!this.owns('board', id)) return false;
      this.data.selectedBoard = id;
    }
    this.saveSoon();
    return true;
  }

  get selectedCharacter() {
    return this.data.selectedCharacter;
  }

  get selectedBoard() {
    return this.data.selectedBoard;
  }

  /**
   * Grant anything the player has earned but does not own yet (achievement
   * unlocks). Returns the ids that were newly granted.
   */
  syncAchievementUnlocks() {
    const granted = [];
    for (const def of ACHIEVEMENTS) {
      if (!this.data.achievements[def.id]) continue;
      for (const entry of CHARACTERS) {
        if (entry.unlock?.type === 'achievement' && entry.unlock.value === def.id) {
          if (!this.owns('character', entry.id)) {
            this.data.ownedCharacters.push(entry.id);
            granted.push({ kind: 'character', id: entry.id, name: entry.name });
          }
        }
      }
      for (const entry of BOARDS) {
        if (entry.unlock?.type === 'achievement' && entry.unlock.value === def.id) {
          if (!this.owns('board', entry.id)) {
            this.data.ownedBoards.push(entry.id);
            granted.push({ kind: 'board', id: entry.id, name: entry.name });
          }
        }
      }
    }
    // Coin / distance gated cosmetics.
    for (const entry of CHARACTERS) {
      if (entry.unlock?.type === 'coins' && this.data.coins >= entry.unlock.value && !this.owns('character', entry.id)) {
        this.data.ownedCharacters.push(entry.id);
        granted.push({ kind: 'character', id: entry.id, name: entry.name });
      }
      if (
        entry.unlock?.type === 'distance' &&
        this.data.stats.totalDistance >= entry.unlock.value &&
        !this.owns('character', entry.id)
      ) {
        this.data.ownedCharacters.push(entry.id);
        granted.push({ kind: 'character', id: entry.id, name: entry.name });
      }
    }
    if (granted.length) this.saveSoon();
    return granted;
  }

  /* ---------------------------------------------------------------- *
   * Achievements
   * ---------------------------------------------------------------- */

  /** @returns {number} current progress value for an achievement */
  achievementProgress(def) {
    return Number(this.data.stats[def.metric] ?? 0);
  }

  isUnlocked(id) {
    return !!this.data.achievements[id];
  }

  /**
   * Evaluate every achievement against lifetime stats.
   * @returns {Array<{def:any, reward:number}>} newly unlocked achievements
   */
  evaluateAchievements() {
    const unlocked = [];
    for (const def of ACHIEVEMENTS) {
      if (this.data.achievements[def.id]) continue;
      if (this.achievementProgress(def) >= def.target) {
        this.data.achievements[def.id] = { at: Date.now() };
        this.data.coins += def.reward;
        unlocked.push({ def, reward: def.reward });
      }
    }
    if (unlocked.length) {
      this.syncAchievementUnlocks();
      this.saveSoon();
    }
    return unlocked;
  }

  achievementSummary() {
    return ACHIEVEMENTS.map((def) => {
      const value = this.achievementProgress(def);
      return {
        def,
        unlocked: this.isUnlocked(def.id),
        value,
        target: def.target,
        fraction: Math.min(1, value / def.target),
      };
    });
  }

  /* ---------------------------------------------------------------- *
   * Stats & records
   * ---------------------------------------------------------------- */

  get stats() {
    return this.data.stats;
  }

  /**
   * Fold a finished run into lifetime stats and the local records table.
   * @param {any} snapshot ScoreManager.snapshot()
   * @param {{modeId:string, recordScore?:boolean, dateKey?:string|null, completed?:boolean}} meta
   * @returns {{records:Array, isRecord:boolean, newAchievements:Array, unlockedCosmetics:Array}}
   */
  recordRun(snapshot, meta) {
    const stats = this.data.stats;
    stats.runs += 1;
    stats.totalDistance += snapshot.distance;
    stats.totalCoins += snapshot.coins + snapshot.shells + snapshot.pearls;
    stats.totalJumps += snapshot.jumps;
    stats.totalObstacles += snapshot.obstaclesPassed;
    stats.krakenEscapes += snapshot.krakenEscapes;
    stats.bestScore = Math.max(stats.bestScore, snapshot.score);
    stats.bestDistance = Math.max(stats.bestDistance, snapshot.distance);
    stats.bestCoins = Math.max(stats.bestCoins, snapshot.coins);
    stats.bestMultiplier = Math.max(stats.bestMultiplier, snapshot.bestMultiplier);
    stats.bestCleanDistance = Math.max(stats.bestCleanDistance, snapshot.bestCleanDistance);
    stats.bestScore_timeTrial = Math.max(stats.bestScore_timeTrial ?? 0, meta.modeId === 'timeTrial' ? snapshot.score : 0);

    if (meta.modeId === 'zigzag' && meta.completed) stats.zigzagCompletions += 1;
    if (meta.modeId === 'daily' && meta.dateKey) {
      const previous = this.data.dailyBest[meta.dateKey] ?? 0;
      if (snapshot.score > previous) {
        if (previous === 0) stats.dailyCompletions += 1;
        this.data.dailyBest[meta.dateKey] = snapshot.score;
      }
    }

    this.data.coins += snapshot.walletCoins;
    this.data.lastPlayedMode = meta.modeId;

    let isRecord = false;
    const records = meta.recordScore === false ? [] : this._pushRecord(meta.modeId, snapshot, meta);
    if (records.isRecord) isRecord = true;

    const newAchievements = this.evaluateAchievements();
    const unlockedCosmetics = this.syncAchievementUnlocks();
    this.saveSoon();

    return { records: records.list, isRecord, newAchievements, unlockedCosmetics };
  }

  _pushRecord(modeId, snapshot, meta) {
    const list = this.data.records[modeId] ?? (this.data.records[modeId] = []);
    const entry = {
      score: snapshot.score,
      distance: snapshot.distance,
      coins: snapshot.coins,
      date: Date.now(),
      dateKey: meta.dateKey ?? null,
      completed: !!meta.completed,
    };
    const previousBest = list.length ? Math.max(...list.map((r) => r.score)) : 0;
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    // Keep a bounded local leaderboard.
    if (list.length > 10) list.length = 10;
    entry.isBest = snapshot.score > previousBest;
    return { list, isRecord: snapshot.score > previousBest };
  }

  getRecords(modeId) {
    return (this.data.records[modeId] ?? []).slice();
  }

  bestScore(modeId) {
    const list = this.data.records[modeId];
    if (!list || !list.length) return 0;
    return Math.max(...list.map((r) => r.score));
  }

  bestDistance(modeId) {
    const list = this.data.records[modeId];
    if (!list || !list.length) return 0;
    return Math.max(...list.map((r) => r.distance));
  }

  dailyBest(dateKey) {
    return this.data.dailyBest[dateKey] ?? 0;
  }
}

/** Fill in missing fields so older saves keep working. */
function migrate(parsed) {
  const base = defaultData();
  if (!parsed || typeof parsed !== 'object') return base;
  const merged = {
    ...base,
    ...parsed,
    settings: { ...base.settings, ...(parsed.settings ?? {}) },
    stats: { ...base.stats, ...(parsed.stats ?? {}) },
    achievements: { ...(parsed.achievements ?? {}) },
    records: { ...(parsed.records ?? {}) },
    dailyBest: { ...(parsed.dailyBest ?? {}) },
    ownedCharacters: Array.isArray(parsed.ownedCharacters) ? parsed.ownedCharacters.slice() : base.ownedCharacters,
    ownedBoards: Array.isArray(parsed.ownedBoards) ? parsed.ownedBoards.slice() : base.ownedBoards,
  };
  merged.version = SCHEMA_VERSION;
  // Ensure the selected cosmetics are actually owned.
  if (!merged.ownedCharacters.includes(merged.selectedCharacter)) merged.selectedCharacter = base.selectedCharacter;
  if (!merged.ownedBoards.includes(merged.selectedBoard)) merged.selectedBoard = base.selectedBoard;
  return merged;
}

/** Pick the best available storage backend. */
function resolveStorage() {
  try {
    if (typeof localStorage === 'undefined') return createMemoryStorage();
    const probe = '__surf_rush_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return createMemoryStorage();
  }
}
