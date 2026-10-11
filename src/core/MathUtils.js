/**
 * Small, allocation-free math helpers used across Surf Rush.
 * Kept free of any rendering dependency so gameplay rules stay unit-testable.
 */

export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function inverseLerp(a, b, value) {
  if (a === b) return 0;
  return clamp01((value - a) / (b - a));
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}

export function smootherstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Frame-rate independent exponential approach.
 * `lambda` is the rate: bigger = snappier. Safe for any dt (including large
 * tab-switch deltas) because it uses an exponential rather than a raw lerp.
 */
export function damp(current, target, lambda, dt) {
  return lerp(target, current, Math.exp(-lambda * dt));
}

/** Move `current` toward `target` by at most `maxDelta`, preserving direction. */
export function moveTowards(current, target, maxDelta) {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

export function wrap(value, min, max) {
  const span = max - min;
  if (span <= 0) return min;
  return min + ((((value - min) % span) + span) % span);
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

/** Deterministic 1D value noise, handy for cheap organic variation. */
export function hash01(n) {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth 1D noise in [-1, 1]. */
export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash01(i) * 2 - 1, hash01(i + 1) * 2 - 1, u);
}

/** Format a number with thousands separators without locale surprises. */
export function formatNumber(value) {
  const n = Math.round(value);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format metres: <1000 -> "123 m", else "1.23 km". */
export function formatDistance(metres) {
  if (metres < 1000) return `${Math.floor(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

/** Seconds -> "m:ss". */
export function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}:${String(rem).padStart(2, '0')}`;
}
