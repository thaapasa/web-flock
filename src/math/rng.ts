/**
 * Everything random in the simulation comes from here, so a seed reproduces a
 * run exactly. Nothing here needs statistical quality and the simulation calls
 * it a lot, so these are the cheap 32-bit constructions.
 */

/** mulberry32. One stream, 32 bits of state, values in `[0, 1)`. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Integer avalanche (the murmur3 finalizer). It turns one seed into another:
 * boid indices are adjacent numbers, and without this every boid would wander
 * in lockstep.
 */
export function hashSeed(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
