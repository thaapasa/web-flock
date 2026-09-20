import { describe, expect, it } from 'vitest';

import { MAX_LOG_SCALE, MIN_LOG_SCALE } from '../camera/framing';
import { BOID_PRESETS } from '../render/boid-style';
import type { SimParams } from '../sim/params';
import { DEFAULT_SIM_PARAMS } from '../sim/params';
import type { Settings } from './settings';
import {
  boidStyle,
  copyInto,
  cursorRadius,
  defaultSettings,
  exportLiteral,
  parse,
  serialise,
  simParams,
} from './settings';

/** A stored blob at the current version, from whatever `settings` is given. */
function stored(settings: unknown): string {
  return JSON.stringify({ version: 1, settings });
}

describe('simParams', () => {
  it('turns the cursor mode and magnitude back into one signed strength', () => {
    const settings = defaultSettings();
    settings.cursor.strength = 400;

    settings.cursor.mode = 'predator';
    expect(simParams(settings).cursorStrength).toBe(-400);

    settings.cursor.mode = 'attractor';
    expect(simParams(settings).cursorStrength).toBe(400);
  });

  // `nothing` is a mode rather than a zero on the strength slider, so that
  // putting the cursor down does not also lose the strength it was set to.
  it('leaves the strength alone when the mode is nothing', () => {
    const settings = defaultSettings();
    settings.cursor.strength = 400;
    settings.cursor.mode = 'nothing';

    expect(simParams(settings).cursorStrength).toBe(0);
    expect(settings.cursor.strength).toBe(400);
    expect(cursorRadius(settings)).toBe(0);
  });

  it('carries every other parameter through untouched', () => {
    const settings = defaultSettings();
    const params = simParams(settings);
    for (const key of Object.keys(DEFAULT_SIM_PARAMS) as (keyof SimParams)[]) {
      if (key === 'cursorStrength') continue;
      expect(params[key]).toBe(DEFAULT_SIM_PARAMS[key]);
    }
  });

  // The default set has to survive the trip out through the panel's shape and
  // back, or a cold start would already differ from what `sim/params.ts` says.
  it('reproduces the default parameters exactly', () => {
    expect(simParams(defaultSettings())).toEqual({ ...DEFAULT_SIM_PARAMS });
  });
});

describe('parse', () => {
  it('round-trips a set through serialise', () => {
    const settings = defaultSettings();
    settings.flock.count = 1234;
    settings.flock.maxSpeed = 77;
    settings.cursor.mode = 'attractor';
    settings.camera.follow = false;
    settings.camera.logScale = 1.5;
    settings.look.boid = 'ember';
    settings.look.trails = false;

    expect(parse(serialise(settings))).toEqual(settings);
  });

  it.each([
    ['nothing stored', null],
    ['an empty string', ''],
    ['not JSON at all', '{oh no'],
    ['JSON that is not an object', '[1, 2, 3]'],
    ['a version we cannot read', JSON.stringify({ version: 99, settings: { flock: {} } })],
    ['no settings inside', JSON.stringify({ version: 1 })],
  ])('falls back to the defaults given %s', (_case, text) => {
    expect(parse(text)).toEqual(defaultSettings());
  });

  it('keeps what a partial blob does say and defaults the rest', () => {
    const settings = parse(stored({ flock: { count: 99 } }));
    expect(settings.flock.count).toBe(99);
    expect(settings.flock.maxSpeed).toBe(DEFAULT_SIM_PARAMS.maxSpeed);
    expect(settings.look).toEqual(defaultSettings().look);
  });

  // The blob comes from a store the user can edit and from older builds of this
  // app, so a bad field is ordinary. Losing the whole set to one of them would
  // be the wrong trade: everything else in it is still good.
  it.each([
    ['a string where a number belongs', { flock: { count: 'lots', maxSpeed: 42 } }],
    ['a NaN', { flock: { count: NaN, maxSpeed: 42 } }],
    ['an infinity', { flock: { count: Infinity, maxSpeed: 42 } }],
    ['a null', { flock: { count: null, maxSpeed: 42 } }],
  ])('rejects %s on its own and keeps its neighbours', (_case, blob) => {
    const settings = parse(stored(blob));
    expect(settings.flock.count).toBe(DEFAULT_SIM_PARAMS.count);
    expect(settings.flock.maxSpeed).toBe(42);
  });

  it('ignores keys that are not parameters', () => {
    const settings = parse(stored({ flock: { nonsense: 1 }, nonsense: 2 }));
    expect(settings).toEqual(defaultSettings());
    expect(settings.flock).not.toHaveProperty('nonsense');
  });

  // A preset renamed in 7b must leave the panel pointing at something that
  // exists, rather than at a name nothing in the list answers to.
  it('falls back when a preset name no longer exists', () => {
    const settings = parse(stored({ look: { boid: 'gone', grid: 'also gone' } }));
    expect(settings.look.boid).toBe(defaultSettings().look.boid);
    expect(settings.look.grid).toBe(defaultSettings().look.grid);
  });

  it('keeps a preset name that does exist', () => {
    const name = BOID_PRESETS[BOID_PRESETS.length - 1].name;
    expect(parse(stored({ look: { boid: name } })).look.boid).toBe(name);
  });

  it.each([
    ['below the range', -99, MIN_LOG_SCALE],
    ['above the range', 99, MAX_LOG_SCALE],
    ['inside the range', 1.5, 1.5],
  ])('clamps a zoom %s', (_case, value, expected) => {
    expect(parse(stored({ camera: { logScale: value } })).camera.logScale).toBe(expected);
  });

  it('refuses a negative cursor strength, which the mode owns instead', () => {
    expect(parse(stored({ cursor: { strength: -500 } })).cursor.strength).toBe(0);
  });

  it.each([
    ['cursor mode', { cursor: { mode: 'hostile' } }],
    ['blend mode', { look: { blend: 'subtractive' } }],
    ['label placement', { look: { labels: 'corner' } }],
  ])('rejects an unknown %s', (_case, blob) => {
    expect(parse(stored(blob))).toEqual(defaultSettings());
  });
});

describe('copyInto', () => {
  // The panel binds to the objects inside a set and holds those references for
  // as long as it lives, so a reset has to write through them, not past them.
  it('writes through the existing objects', () => {
    const target = defaultSettings();
    const flock = target.flock;
    const look = target.look;

    target.flock.count = 4000;
    target.look.boid = 'ember';
    copyInto(target, defaultSettings());

    expect(target.flock).toBe(flock);
    expect(target.look).toBe(look);
    expect(flock.count).toBe(DEFAULT_SIM_PARAMS.count);
    expect(look.boid).toBe(defaultSettings().look.boid);
  });
});

describe('boidStyle', () => {
  it('returns the preset itself when nothing overrides it', () => {
    const look = defaultSettings().look;
    expect(boidStyle(look)).toBe(BOID_PRESETS[0]);
  });

  it('applies the panel overrides on top of the preset', () => {
    const look = defaultSettings().look;
    look.trails = false;
    look.blend = 'alpha';

    const style = boidStyle(look);
    expect(style.trail).toBe('none');
    expect(style.blend).toBe('alpha');
    expect(style.name).toBe(BOID_PRESETS[0].name);
  });

  // Read once per pane per frame, so a fresh object every time would be garbage
  // the renderer never asked for.
  it('hands back the same object for the same overrides', () => {
    const look = defaultSettings().look;
    look.trails = false;
    expect(boidStyle(look)).toBe(boidStyle(look));
  });
});

describe('exportLiteral', () => {
  const settings: Settings = defaultSettings();
  const text = exportLiteral(settings);

  it('names every parameter the simulation takes', () => {
    for (const key of Object.keys(DEFAULT_SIM_PARAMS)) {
      expect(text).toContain(`${key}: `);
    }
  });

  it('exports the signed strength, not the panel magnitude', () => {
    expect(text).toContain('cursorStrength: -500');
  });

  it('says what the numbers were seen under', () => {
    expect(text).toContain(settings.look.boid);
    expect(text).toContain(`follow ${settings.camera.follow ? 'on' : 'off'}`);
  });

  // It is meant to be pasted into `sim/params.ts`, so the body has to be a
  // literal that evaluates to the parameters it came from.
  it('is a literal that evaluates back to the same parameters', () => {
    const body = text.slice(text.indexOf('{'));
    const parsed = JSON.parse(
      body.replace(/(\w+):/g, '"$1":').replace(/,(\s*})/g, '$1'),
    ) as SimParams;

    expect(Object.keys(parsed).sort()).toEqual(Object.keys(DEFAULT_SIM_PARAMS).sort());
    for (const key of Object.keys(DEFAULT_SIM_PARAMS) as (keyof SimParams)[]) {
      // Six significant figures, so an angle that `sim/params.ts` writes as a
      // multiple of pi comes back rounded rather than exact.
      expect(parsed[key]).toBeCloseTo(DEFAULT_SIM_PARAMS[key], 4);
    }
  });
});
