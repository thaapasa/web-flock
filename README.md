# web-flock

A flocking simulator in the browser. Up to five thousand boids on an unbounded plane, drawn as line
art over an adaptive grid, with every parameter adjustable while it runs.

## Running it

Needs Node 24 and yarn 4.

```sh
yarn install
yarn dev          # http://localhost:5173
```

`yarn check` runs the type check, the linter, the format check and the tests. `yarn build` builds
into `dist/`. `yarn site` rebuilds `site/`, a built copy of the page kept in the repository: the
host serves that directory as it stands, so refresh and commit it when the published page should
change.

## Using it

The parameter panel is top left, collapsed until you open it, and everything in it takes effect
immediately:

- **flock**: count, the rule weights and their radii, field of view, speed and turn limits, the pull
  toward the origin, wander, and a spawn radius with a `restart` button beside it.
- **cursor**: predator, attractor or nothing, with a strength and a reach drawn as a ring.
- **camera**: follow, the zoom, and a button that frames the flock.
- **look**: palette, trails, blending, grid preset, and tick labels.

Two buttons at the bottom print the current set to the console and reset everything to defaults.
Your set is saved in `localStorage`. The other three corners show the frame-time HUD, the coordinate
readout and the key hints.

With follow on, the camera centres on the flock and the zoom is a percentage of the flock's size:
100% frames it, less flies you into the middle of it, and more leaves it a speck on the grid. The
camera holds a zoom until the flock outgrows it, so the view does not hunt, and `zoom hold` and
`zoom ease` say how far it lets the flock drift and how fast it follows. Turn follow off and the
zoom is a plain scale you set yourself.

Wheel zooms. Drag pans, while follow is off. `z` frames the flock, and `+` and `-` zoom a small step
at a time.

A number key picks how the flock flies, from the sets in `sim/presets.ts`. Shift and a number key
picks the palette. The readout names the one you are on, and says `custom` once you move a slider.

`p` records a frame-time reading and prints the log, and `P` clears it. Both go away with
`src/dev/`.

## Related documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how the code fits together.
- [PLAN.md](PLAN.md): what is done and what is left.
- [CLAUDE.md](CLAUDE.md): the visual and technical direction.
