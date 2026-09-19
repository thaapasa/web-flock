/**
 * Deterministic pseudo-randomness.
 *
 * Seeded on purpose. Step 7a compares parameter sets against each other, and a
 * comparison that starts from a different flock each time is not a comparison —
 * it is two anecdotes. Everything random in the simulation comes from here, so
 * a seed reproduces a run exactly.
 *
 * Quality requirements are low (scatter boids, jitter a heading) and the call
 * volume is high, so these are the cheap well-known 32-bit constructions rather
 * than anything with a period worth quoting.
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
 * Integer avalanche (the murmur3 finalizer).
 *
 * Used to derive one seed from another without correlation: adjacent inputs
 * such as boid indices must not give adjacent streams, or every boid's wander
 * moves together and the flock shimmers in lockstep.
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
