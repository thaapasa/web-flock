# web-flock

A flocking simulator that runs in the browser. Up to 5,000 boids fly on an unbounded plane. They are
drawn as line art over an adaptive grid, and you can change every parameter while the simulation
runs.

## Running it

You need Node 24 and yarn 4.

```sh
yarn install
yarn dev          # http://localhost:5173
```

Other commands:

- `yarn check` runs the type check, the linter, the format check and the tests.
- `yarn build` builds the app into `dist/`.
- `yarn site` rebuilds `site/`.

`site/` is a built copy of the page, kept in the repository. The host serves the directory exactly
as it is committed. To change the published page, run `yarn site` and commit the result.

## Using it

### Screen layout

- Top left: the parameter panel. It starts collapsed.
- The other three corners: the frame-time HUD, the coordinate readout and the key hints.

### Parameter panel

Every change in the panel takes effect immediately. The panel has four sections:

- **flock**: the boid count, the contact distance, the rule weights and their radii, the field of
  view, the speed and turn limits, the pull toward the origin, wander, and the spawn radius. The
  `restart` button next to the spawn radius starts the flock again.
- **cursor**: makes the cursor a predator, an attractor or nothing. It has a strength and a reach.
  The reach is drawn as a ring around the cursor.
- **camera**: follow, the zoom, and a button that fits the flock on screen.
- **look**: the palette, trails, blending, the grid preset, and tick labels.

The two buttons at the bottom of the panel print the current settings to the console and reset
everything to defaults. Your settings are saved in `localStorage`.

### Camera and zoom

With follow on, the camera stays centred on the flock, and the zoom is a percentage of the flock's
size:

- 100% fits the flock on screen.
- Less than 100% zooms into the middle of the flock.
- More than 100% zooms out, and the flock becomes a small spot on the grid.

The camera keeps its zoom until the flock grows or shrinks past a limit. This stops the view from
zooming in and out all the time. Two settings control this:

- `zoom hold`: how far the flock's size can change, in decades, before the zoom starts to follow.
- `zoom ease`: the time constant, in seconds, of the zoom as it follows.

With follow off, the zoom is a plain scale that you set yourself.

### Controls

| Input                | Action                                          |
| -------------------- | ----------------------------------------------- |
| Wheel                | Zoom                                            |
| Drag                 | Pan, when follow is off                         |
| `z`                  | Fit the flock on screen                         |
| `+` / `-`            | Zoom in or out by a small step                  |
| Number key           | Choose a flock preset from `src/sim/presets.ts` |
| Shift and number key | Choose a palette                                |
| `p`                  | Record a frame-time reading and print the log   |
| `P`                  | Clear the frame-time log                        |

The readout shows the name of the current flock preset and palette. When you move a slider, it shows
`custom` instead.

The `p` and `P` keys are temporary. They will be removed together with `src/dev/`.

## Related documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how the code fits together.
- [PLAN.md](PLAN.md): what is done and what is left.
- [CLAUDE.md](CLAUDE.md): the visual and technical direction.
