/**
 * Deterministic pseudo random number generator.
 *
 * Surf Rush needs reproducible worlds for the Daily Challenge (every player
 * gets the same course for a given date) and for unit tests, so all gameplay
 * randomness funnels through a seeded generator instead of Math.random().
 *
 * Uses mulberry32 — small, fast and good enough for gameplay variation.
 */
export class Rng {
  /** @param {number} seed 32-bit integer */
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this._state = this.seed || 1;
    this._spare = null;
  }

  /** Reset back to the original seed (used when a run restarts). */
  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this._state = this.seed || 1;
    this._spare = null;
    return this;
  }

  /** @returns {number} float in [0, 1) */
  next() {
    let t = (this._state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** @returns {number} float in [min, max) */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** @returns {number} integer in [min, max] inclusive */
  int(min, max) {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  /** @returns {boolean} */
  chance(probability) {
    return this.next() < probability;
  }

  /** @returns {number} approximately gaussian, mean 0, stddev ~1 */
  gaussian() {
    if (this._spare !== null) {
      const value = this._spare;
      this._spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this._spare = v * mul;
    return u * mul;
  }

  /** @template T @param {T[]} array @returns {T} */
  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  /**
   * Weighted pick.
   * @param {Array<{weight:number} | any>} items
   * @param {(item:any)=>number} [weightOf]
   */
  weighted(items, weightOf = (item) => item.weight ?? 1) {
    let total = 0;
    for (const item of items) total += Math.max(0, weightOf(item));
    if (total <= 0) return items.length ? items[0] : undefined;
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weightOf(item));
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  /** Fisher–Yates shuffle (returns a new array; input untouched). */
  shuffled(array) {
    const out = array.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /** @returns {number[]} `count` unique lane indices chosen from `lanes`. */
  sample(lanes, count) {
    return this.shuffled(lanes).slice(0, Math.max(0, Math.min(count, lanes.length)));
  }
}

/**
 * Turn a date into a stable 32-bit seed so the Daily Challenge is identical
 * for every player on the same calendar day (UTC).
 */
export function seedFromDate(date = new Date(), salt = 0) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  // Simple, well-distributed string hash (FNV-1a, 32 bit).
  const key = `surf-rush-${y}-${m}-${d}-${salt}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Human friendly label for a daily challenge, e.g. "12 Oct 2026". */
export function dailyLabel(date = new Date()) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
