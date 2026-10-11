/**
 * Collision detection for Surf Rush.
 *
 * Deliberately *not* a blanket AABB test: each hazard declares one or more
 * volume primitives (box / vertical cylinder / sphere) that match its silhouette,
 * and the player is tested as an axis-aligned box whose height changes when
 * ducking. Coordinates are plain numbers so this module has no renderer
 * dependency and can be unit tested in Node.
 *
 * Space: y = 0 is the mean water surface. The player's `y` is the height of the
 * *bottom* of the board above that surface.
 */

import { BALANCE } from '../config/Content.js';

/* ------------------------------------------------------------------ *
 * Primitive tests
 * ------------------------------------------------------------------ */

/** Closest point on the closed box [min, max] to `value`, per axis. */
function clampToRange(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Box vs box overlap (all axis aligned).
 * @param {number[]} aMin @param {number[]} aMax @param {number[]} bMin @param {number[]} bMax
 */
export function boxVsBox(aMinX, aMaxX, aMinY, aMaxY, aMinZ, aMaxZ, bMinX, bMaxX, bMinY, bMaxY, bMinZ, bMaxZ) {
  return aMinX <= bMaxX && aMaxX >= bMinX && aMinY <= bMaxY && aMaxY >= bMinY && aMinZ <= bMaxZ && aMaxZ >= bMinZ;
}

/** Vertical (Y aligned) cylinder vs box. */
export function cylinderVsBox(cx, cz, radius, bottom, top, boxMinX, boxMaxX, boxMinY, boxMaxY, boxMinZ, boxMaxZ) {
  if (top < boxMinY || bottom > boxMaxY) return false;
  // Nearest point on the box (in XZ) to the cylinder axis.
  const nx = clampToRange(cx, boxMinX, boxMaxX);
  const nz = clampToRange(cz, boxMinZ, boxMaxZ);
  const dx = cx - nx;
  const dz = cz - nz;
  return dx * dx + dz * dz <= radius * radius;
}

/** Sphere vs box. */
export function sphereVsBox(cx, cy, cz, radius, boxMinX, boxMaxX, boxMinY, boxMaxY, boxMinZ, boxMaxZ) {
  const nx = clampToRange(cx, boxMinX, boxMaxX);
  const ny = clampToRange(cy, boxMinY, boxMaxY);
  const nz = clampToRange(cz, boxMinZ, boxMaxZ);
  const dx = cx - nx;
  const dy = cy - ny;
  const dz = cz - nz;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

/* ------------------------------------------------------------------ *
 * Player box
 * ------------------------------------------------------------------ */

/**
 * Resolve the player's collision box for this frame.
 * @param {{x:number,y:number,z:number}} player
 * @param {boolean} crouching
 * @param {{halfWidth?:number, halfDepth?:number, standingHeight?:number, crouchHeight?:number}} [tuning]
 * @returns {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number,height:number}}
 */
export function playerBox(player, crouching, tuning = BALANCE.player) {
  const halfWidth = tuning.halfWidth ?? BALANCE.player.halfWidth;
  const halfDepth = tuning.halfDepth ?? BALANCE.player.halfDepth;
  const height = crouching ? (tuning.crouchHeight ?? BALANCE.player.crouchHeight) : tuning.standingHeight ?? BALANCE.player.standingHeight;
  const bottom = player.y + 0.05; // tiny skin so the board clips the waterline
  return {
    minX: player.x - halfWidth,
    maxX: player.x + halfWidth,
    minY: bottom,
    maxY: bottom + height,
    minZ: player.z - halfDepth,
    maxZ: player.z + halfDepth,
    height,
  };
}

/* ------------------------------------------------------------------ *
 * Volume helpers
 * ------------------------------------------------------------------ */

/**
 * Normalise a hazard definition's volume(s) into an array.
 * @param {{volume:any}} def
 */
export function volumesOf(def) {
  return Array.isArray(def.volume) ? def.volume : [def.volume];
}

/**
 * Test a single volume (already translated into world space) against a box.
 * @param {any} volume
 * @param {number} ox world x offset of the hazard
 * @param {number} oy world y offset of the hazard (usually the local wave height)
 * @param {number} oz world z of the hazard
 * @param {ReturnType<typeof playerBox>} box
 */
export function volumeHitsBox(volume, ox, oy, oz, box) {
  if (!volume) return false;
  if (volume.kind === 'box') {
    const [hx, hy, hz] = volume.half;
    const cx = ox + (volume.offsetX ?? 0);
    const cy = oy + (volume.y ?? 0) + (volume.offsetY ?? 0);
    return boxVsBox(
      box.minX,
      box.maxX,
      box.minY,
      box.maxY,
      box.minZ,
      box.maxZ,
      cx - hx,
      cx + hx,
      cy - hy,
      cy + hy,
      oz + (volume.offsetZ ?? 0) - hz,
      oz + (volume.offsetZ ?? 0) + hz
    );
  }
  if (volume.kind === 'cylinder') {
    return cylinderVsBox(
      ox + (volume.offsetX ?? 0),
      oz + (volume.offsetZ ?? 0),
      volume.radius,
      oy + volume.bottom,
      oy + volume.top,
      box.minX,
      box.maxX,
      box.minY,
      box.maxY,
      box.minZ,
      box.maxZ
    );
  }
  if (volume.kind === 'sphere') {
    return sphereVsBox(
      ox + (volume.offsetX ?? 0),
      oy + (volume.y ?? 0) + (volume.offsetY ?? 0),
      oz + (volume.offsetZ ?? 0),
      volume.radius,
      box.minX,
      box.maxX,
      box.minY,
      box.maxY,
      box.minZ,
      box.maxZ
    );
  }
  return false;
}

/**
 * Cheap broad-phase: is this hazard anywhere near the player along z?
 * @param {number} hazardZ @param {number} playerZ @param {number} reach
 */
export function withinZ(hazardZ, playerZ, reach) {
  return Math.abs(hazardZ - playerZ) <= reach;
}

/**
 * Full hazard test.
 *
 * `hazard.collisionY` (when present) is the waterline used for the *collision*
 * test. Hazards bob with the swell for looks, but gameplay uses the waterline
 * under the player's board so that jump clearance matches the tuned numbers no
 * matter where in the wave the surfer happens to be. Without this, a hazard on
 * a crest while the player is in a trough could become impossible to jump.
 *
 * @param {{x:number,y:number,z:number,def:any,scale?:number,collisionY?:number}} hazard
 * @param {{x:number,y:number,z:number}} player
 * @param {boolean} crouching
 */
export function hazardHitsPlayer(hazard, player, crouching) {
  const box = playerBox(player, crouching);
  const scale = hazard.scale ?? 1;
  const referenceY = hazard.collisionY ?? hazard.y ?? 0;
  for (const volume of volumesOf(hazard.def)) {
    if (volumeHitsBox(scaleVolume(volume, scale), hazard.x, referenceY, hazard.z, box)) return true;
  }
  return false;
}

const _scaleCache = new WeakMap();

/** Uniformly scale a volume primitive (used for small/large hazard variants). */
export function scaleVolume(volume, scale) {
  if (scale === 1) return volume;
  let cached = _scaleCache.get(volume);
  if (!cached) {
    cached = new Map();
    _scaleCache.set(volume, cached);
  }
  let scaled = cached.get(scale);
  if (scaled) return scaled;
  scaled = { ...volume };
  if (scaled.kind === 'box') {
    scaled.half = [volume.half[0] * scale, volume.half[1] * scale, volume.half[2] * scale];
    if (volume.y != null) scaled.y = volume.y * scale;
  } else if (scaled.kind === 'cylinder') {
    scaled.radius = volume.radius * scale;
    scaled.bottom = volume.bottom * scale;
    scaled.top = volume.top * scale;
    if (volume.offsetX != null) scaled.offsetX = volume.offsetX * scale;
  } else if (scaled.kind === 'sphere') {
    scaled.radius = volume.radius * scale;
    if (volume.y != null) scaled.y = volume.y * scale;
    if (volume.offsetX != null) scaled.offsetX = volume.offsetX * scale;
  }
  cached.set(scale, scaled);
  return scaled;
}

/* ------------------------------------------------------------------ *
 * Collectibles
 * ------------------------------------------------------------------ */

/**
 * Sphere vs sphere collection test with a generous pickup radius so the game
 * feels fair at high speed.
 * @param {{x:number,y:number,z:number}} item
 * @param {number} itemRadius
 * @param {{x:number,y:number,z:number}} player
 * @param {number} [bonusRadius] magnet / combo pickup assistance
 */
export function collectibleHitsPlayer(item, itemRadius, player, bonusRadius = 0) {
  const dx = item.x - player.x;
  const dz = item.z - player.z;
  // Vertical band: the surfer's body is tall, so use a wide y window.
  const dy = item.y - (player.y + 0.9);
  const r = itemRadius + 0.95 + bonusRadius;
  return dx * dx + dy * dy * 0.55 + dz * dz <= r * r;
}

/**
 * Distance (squared, XZ only) from the player to a hazard — used for the
 * "near miss" scoring bonus.
 */
export function hazardDistanceSq(hazard, player) {
  const dx = hazard.x - player.x;
  const dz = hazard.z - player.z;
  return dx * dx + dz * dz;
}

/**
 * Broad-phase helper: keep only hazards whose z is inside a window around the
 * player. Avoids allocating a filtered array each frame.
 */
export function filterNearby(hazards, playerZ, ahead, behind, out = []) {
  out.length = 0;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    const dz = h.z - playerZ;
    if (dz <= ahead && dz >= -behind) out.push(h);
  }
  return out;
}
