/**
 * Generic object pool.
 *
 * Surf Rush spawns hundreds of obstacles, coins and particles per minute;
 * pooling avoids GC hitches on the main loop. The pool owns *creation* and
 * *reset* concerns, callers own `acquire()` / `release()` discipline.
 */
export class ObjectPool {
  /**
   * @param {() => any} factory      creates a new instance
   * @param {(obj:any) => void} [reset] called when an instance is recycled
   * @param {number} [initial]      instances created up-front
   */
  constructor(factory, reset, initial = 0) {
    this._factory = factory;
    this._reset = reset;
    this._free = [];
    this._inUse = new Set();
    this.created = 0;
    for (let i = 0; i < initial; i++) {
      this._free.push(this._make());
    }
  }

  _make() {
    this.created++;
    return this._factory();
  }

  /** @returns {any} an instance, freshly reset. */
  acquire() {
    const obj = this._free.pop() ?? this._make();
    this._inUse.add(obj);
    return obj;
  }

  /** Return an instance to the pool. No-op if it is not currently in use. */
  release(obj) {
    if (!this._inUse.delete(obj)) return false;
    if (this._reset) this._reset(obj);
    this._free.push(obj);
    return true;
  }

  /** Release every in-use instance. */
  releaseAll() {
    for (const obj of Array.from(this._inUse)) this.release(obj);
  }

  /** @returns {any[]} snapshot of currently acquired objects. */
  active() {
    return Array.from(this._inUse);
  }

  get activeCount() {
    return this._inUse.size;
  }

  get idleCount() {
    return this._free.length;
  }

  /** Drop all pooled instances (used when tearing down a scene). */
  clear() {
    this._free.length = 0;
    this._inUse.clear();
  }
}

/**
 * Pool keyed by a string — lets ObstacleManager keep one pool per obstacle
 * type without a pile of manual bookkeeping.
 */
export class PoolGroup {
  /**
   * @param {Record<string, {factory:()=>any, reset?:(obj:any)=>void, initial?:number}>} definitions
   */
  constructor(definitions) {
    /** @type {Record<string, ObjectPool>} */
    this.pools = {};
    for (const [key, def] of Object.entries(definitions)) {
      this.pools[key] = new ObjectPool(def.factory, def.reset, def.initial ?? 0);
    }
  }

  acquire(key) {
    const pool = this.pools[key];
    if (!pool) throw new Error(`PoolGroup: unknown key "${key}"`);
    const obj = pool.acquire();
    obj.poolKey = key;
    return obj;
  }

  release(obj) {
    const pool = this.pools[obj.poolKey];
    if (!pool) return false;
    return pool.release(obj);
  }

  releaseAll() {
    for (const pool of Object.values(this.pools)) pool.releaseAll();
  }

  get activeCount() {
    let total = 0;
    for (const pool of Object.values(this.pools)) total += pool.activeCount;
    return total;
  }

  get createdCount() {
    let total = 0;
    for (const pool of Object.values(this.pools)) total += pool.created;
    return total;
  }

  clear() {
    for (const pool of Object.values(this.pools)) pool.clear();
  }
}
