/** A source of random numbers in [0, 1), like Math.random. */
export type Random = () => number;

/**
 * Small seeded pseudo-random generator (mulberry32). Same seed → same sequence, which makes
 * simulations and tests reproducible. Not for anything security-related.
 */
export function mulberry32(seed: number): Random {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
