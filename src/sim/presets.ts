import type { FlockBehaviour } from './params';

/**
 * Named ways for the flock to fly, bound to the number keys.
 *
 * A preset carries the rules and nothing else, so picking one leaves the count,
 * the spawn disc and the cursor as the user set them.
 *
 * These are candidates to look at, not answers. Each one is a whole set rather
 * than one changed field, because the rules only read as a flock together: a
 * wider neighbourhood wants a different cohesion under it.
 *
 * Every set here keeps `separationRadius` near half of `neighbourRadius`, and
 * leaves the force cap and the turn rate high enough to hold that spacing.
 * Below that the flock packs tighter than separation can push it apart, until
 * `contactDistance` stops it. The step then costs several times what a
 * well-spaced flock does, though it no longer grows without limit.
 */
export interface FlockPreset extends FlockBehaviour {
  readonly name: string;
}

/** What each preset starts from. Only the differences are spelled out below. */
const BASE: FlockBehaviour = {
  separationRadius: 12,
  neighbourRadius: 24,
  fieldOfView: (Math.PI * 2) / 3,

  separationWeight: 1.5,
  alignmentWeight: 1,
  cohesionWeight: 0.8,
  maxForce: 120,

  originPull: 0.02,

  minSpeed: 20,
  maxSpeed: 60,
  maxTurnRate: Math.PI * 1.5,

  wanderStrength: 8,
  wanderRate: 2,
};

function preset(overrides: { name: string } & Partial<FlockBehaviour>): FlockPreset {
  return Object.freeze({ ...BASE, ...overrides });
}

export const FLOCK_PRESETS: readonly FlockPreset[] = Object.freeze([
  // Long narrow flocks that keep their distance from each other instead of
  // settling into one ring. Fast enough that the origin pull bends its path
  // rather than gathering it.
  preset({
    name: 'swifts',
    separationRadius: 14,
    neighbourRadius: 36,
    maxForce: 260,
    minSpeed: 70,
    maxSpeed: 140,
    maxTurnRate: Math.PI * 2,
    wanderStrength: 18,
    wanderRate: 3.5,
  }),

  // A narrow view, so a group that turns away stops being seen and leaves.
  // Small flocks, closer to single file than to a sheet.
  preset({
    name: 'split',
    neighbourRadius: 30,
    fieldOfView: 1.2,
    separationWeight: 1.6,
    alignmentWeight: 0.9,
    cohesionWeight: 1.1,
    wanderStrength: 10,
  }),

  // Alignment led and barely cohesive. Boids far apart still agree on a
  // heading, so the flock draws out into lanes.
  preset({
    name: 'streams',
    separationRadius: 16,
    neighbourRadius: 36,
    alignmentWeight: 1.6,
    cohesionWeight: 0.5,
    maxForce: 180,
    originPull: 0.015,
    minSpeed: 45,
    maxSpeed: 90,
    maxTurnRate: Math.PI * 1.3,
    wanderStrength: 5,
  }),

  // Spread thin and travelling, with a weak origin pull so the flock gets
  // somewhere before it is drawn back. It arrives as one flock and breaks up
  // on the way.
  preset({
    name: 'drift',
    separationRadius: 20,
    neighbourRadius: 40,
    alignmentWeight: 1.2,
    cohesionWeight: 0.35,
    maxForce: 150,
    originPull: 0.008,
    minSpeed: 35,
    maxSpeed: 70,
    wanderStrength: 6,
    wanderRate: 1.2,
  }),

  // The narrow view at speed: lines that hold together while they cross.
  preset({
    name: 'weave',
    separationRadius: 16,
    neighbourRadius: 34,
    fieldOfView: 1.1,
    separationWeight: 1.6,
    alignmentWeight: 1.1,
    cohesionWeight: 0.9,
    maxForce: 220,
    originPull: 0.012,
    minSpeed: 55,
    maxSpeed: 110,
    maxTurnRate: Math.PI * 1.8,
    wanderStrength: 12,
    wanderRate: 2.5,
  }),

  // Narrower still and hardly cohesive, against the weakest origin pull here:
  // aimed at flocks that break up and stay broken up.
  preset({
    name: 'shards',
    separationRadius: 18,
    neighbourRadius: 30,
    fieldOfView: 0.9,
    separationWeight: 1.7,
    alignmentWeight: 1.3,
    cohesionWeight: 0.5,
    maxForce: 200,
    originPull: 0.006,
    minSpeed: 50,
    maxSpeed: 100,
    maxTurnRate: Math.PI * 1.6,
    wanderStrength: 9,
    wanderRate: 1.5,
  }),

  // Cohesion against a slow turn: a boid aims at a centre it cannot turn to
  // reach, which is how a mill forms. The turn rate sets the ring, roughly the
  // speed divided by it, so these two are what to move if it will not circle.
  preset({
    name: 'mill',
    separationRadius: 18,
    neighbourRadius: 34,
    fieldOfView: 2.6,
    separationWeight: 1.6,
    alignmentWeight: 0.45,
    cohesionWeight: 1.6,
    maxForce: 170,
    originPull: 0.012,
    minSpeed: 40,
    maxSpeed: 70,
    maxTurnRate: Math.PI * 0.9,
    wanderStrength: 5,
    wanderRate: 1.5,
  }),

  // Ordinary flocking under a restless heading: the wander turns fast enough
  // to keep knocking the flock off the orbit it would otherwise settle into.
  preset({
    name: 'gusts',
    separationRadius: 15,
    neighbourRadius: 32,
    fieldOfView: 2.2,
    alignmentWeight: 1.2,
    cohesionWeight: 0.7,
    maxForce: 160,
    originPull: 0.01,
    minSpeed: 40,
    maxSpeed: 85,
    maxTurnRate: Math.PI * 1.4,
    wanderStrength: 14,
    wanderRate: 4.5,
  }),
]);

export const DEFAULT_FLOCK_PRESET = FLOCK_PRESETS[0];

/** Every rule there is, for a caller that has to walk them one by one. */
export const FLOCK_BEHAVIOUR_KEYS = Object.freeze(Object.keys(BASE) as (keyof FlockBehaviour)[]);

/** The rules alone, with the preset's name dropped. */
export function flockBehaviour(preset: FlockPreset): FlockBehaviour {
  const behaviour = {} as FlockBehaviour;
  for (const key of FLOCK_BEHAVIOUR_KEYS) behaviour[key] = preset[key];
  return behaviour;
}
