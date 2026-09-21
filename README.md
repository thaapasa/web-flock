# web-flock

A flocking simulator that runs in the browser. Up to five thousand boids fly on an unbounded plane,
drawn as stroked chevrons with velocity trails over an adaptive axis grid that fades one decade of
line spacing in as the next fades out. Every parameter can be changed while it runs.

The project is in iteration one. PLAN.md says what is built and what is left.

## Running it

You need Node 24 and yarn 4. `package.json` pins the yarn version, so corepack picks the right one
up.

```sh
yarn install
yarn dev
```

Vite serves the page at http://localhost:5173 and reloads it on save. The dev server binds to every
interface, so the page is reachable when Vite runs inside a VM rather than on your own machine.

`yarn check` runs the type check, the linter, the format check and the tests. `yarn build`
type-checks and builds into `dist/`.

`yarn site` rebuilds `site/`, which is a built copy of the page committed to the repository. The
server that hosts it checks the repository out and serves `site/` as it stands, without building
anything, so you refresh that directory and commit it whenever the hosted page should change.

## What is on screen

The parameter panel sits top left, collapsed to its title bar until you open it. The frame-time HUD
is top right: frames per second, the mean and worst frame time, and the time spent inside the
simulation. It turns amber and then red as frames get slower than 60 fps, and it prints `behind`
when the simulation cannot keep up with real time. The coordinate readout is bottom right, and the
key hints are bottom left.

## The panel

Four folders, and every value in them takes effect at once:

- **flock**: how many boids there are, the three rule weights with their radii, the field of view,
  the speed and turn limits, the pull toward the origin, the wander, and the spawn radius. A
  `restart` button sits next to the spawn radius, because that one value can only take effect on a
  re-seed.
- **cursor**: what the cursor does to the boids near it (`nothing`, `predator` or `attractor`), how
  hard it pushes, and how far its reach goes. The grid draws the reach as a ring.
- **camera**: whether the camera follows the flock, the zoom, and a button that frames the flock.
- **look**: the boid palette, trails on or off, the blend mode, the fade applied to boids too small
  to draw, the grid preset, and where the tick labels sit and how they read.

Two buttons sit at the bottom. `export to console` prints the current set in a form you can paste
back. `reset to defaults` clears the stored set and puts every value back.

Your set is written to `localStorage` shortly after you stop dragging, so a reload keeps it. If the
browser refuses storage, the page runs without remembering anything.

## Mouse and keys

- **Wheel** zooms.
- **Drag** pans, when `follow` is off. While follow is on, the camera owns the centre.
- **`z`** centres on the flock and zooms to fit it.
- **`+`** and **`-`** zoom by a twentieth of a decade, which is how you step through a grid handover
  slowly enough to watch it.

The keys do nothing while a panel field has the keyboard, because every one of them is a bare
letter.

### Development keys

These belong to `src/dev/` and go away with it once the taste calls are settled:

- **`1`** to **`9`** select a preset.
- **`c`** puts four presets on screen at once, one per quadrant. `[` and `]` slide that window
  through the list, and a digit picks one and leaves the mode.
- **`b`** switches the digits between the grid's presets and the boids'.
- **`p`** records the HUD and prints every reading taken so far as one block. **`P`** starts a fresh
  table.

## Related documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): the pieces, the seams between them, and why they sit where
  they do.
- [PLAN.md](PLAN.md): what iteration one is, what is done, and what is left.
- [CLAUDE.md](CLAUDE.md): the visual and technical direction.
