# Architecture

## Overview

Vite, TypeScript and WebGL2 behind a thin wrapper. No engine and no framework, apart from Tweakpane
for the parameter panel. The simulation runs on the CPU over typed arrays and targets five thousand
boids.

The page is two stacked canvases, WebGL for the scene and a 2D one for the text over it, plus the
panel.

Where the code is:

- `src/sim`: the simulation and its parameters.
- `src/render`: the GL wrapper, the grid, the boids, the text layer, and the shaders.
- `src/camera`: the world/screen transform and the controls that move it.
- `src/ui`: the settings, the panel bound to them, and persistence.
- `src/dev`: temporary tools for choosing presets by eye and logging frame times.
- `src/app.ts`: wires it all together and runs the frame loop. Start reading there.

## The frame loop

Each frame:

1. Add the elapsed time to an accumulator.
2. Run whole simulation steps at 120 Hz until the accumulator is spent, capturing a trail sample
   every fourth step.
3. Move the camera.
4. Upload the boid state to the GPU.
5. Draw the grid, the trail ribbons, the chevrons, and the text over them.

The timestep is fixed, so behaviour does not change with the framerate and a frame hitch produces
several normal steps instead of one huge one. A frame runs at most five steps and drops the rest, so
a slow step cannot lock the page up. The HUD shows `behind` when that happens.

## Simulation

`src/sim/simulation.ts` is the interface and `flock.ts` the implementation. It owns positions,
velocities and neighbour counts as packed typed arrays, and finds neighbours through a spatial hash,
which is where nearly all of the time goes. Parameters go in as plain data and take effect on the
next step. Randomness is seeded, so two parameter sets can be compared from the same starting flock.

It also hands out the summaries other parts need, a position sample for the camera and the speed and
density ranges the renderer colours by, because it is the only thing that can afford to look at
every boid.

**A GPU backend has to be able to replace it.** That is why `Simulation` contains no GL, and why
per-boid data reaches the GPU through a separate interface, `BoidFeed`, which belongs to the
renderer. The CPU backend gets an uploading feed wrapped around it. A GPU backend would implement
both and hand over the buffer it had already filled, with nothing read back off the GPU.

## Rendering

The grid is one fullscreen shader pass with no geometry: lines are found per pixel from the decades
of spacing currently visible, and each decade fades in and out as you zoom. That is what makes the
plane unbounded, since there is nothing to run out of however far the flock travels.

The boids are two instanced draws, the trail ribbons and then the chevrons over them. Trail history
is a texture of recent samples, one column per boid. Samples are captured on simulation steps rather
than on frames, so a trail is a length of time rather than a length of framerate.

Colour ramps span the ranges the simulation reports rather than fixed values, so retuning the flock
cannot leave a style pointing at a range no boid reaches. Everything else adjustable about the look
is a named preset in `grid-style.ts` or `boid-style.ts`; a renderer has no appearance of its own.

## Camera

World space has +y up, and the flip to screen space happens in `camera/camera.ts` and nowhere else.
Zoom is held as log10 pixels per world unit, which suits the grid's per-decade fade.

The camera centres on the flock every frame, or the pointer drags it when follow is off. Both are
undamped: smoothing, hysteresis and automatic zoom are step 6 in PLAN.md.

## Settings

One object holds everything the user can change. The panel binds to it and changes it in place, as
do the wheel and the preset keys, so there is no second copy to keep in step. `src/app.ts` is the
only place that turns it into simulation parameters, styles and a camera.

Sets are saved in `localStorage` and validated on the way back in, because the stored text can come
from an older build or from a user who edited it. The look is saved as preset names plus overrides
rather than as a finished style, so retuning a preset still reaches saved sets.

## Tests

Tests sit beside the code they cover and run in node. Three are worth reading as a specification:
`sim/spatial-hash.test.ts` checks the index against brute force, `sim/flock.test.ts` pins the flock
as bounded and free of NaN, and `render/grid-bands.test.ts` asserts that no grid line pops as the
zoom sweeps across six decades.

## Related documentation

- [README.md](README.md): how to run it, and what the controls do.
- [PLAN.md](PLAN.md): what is done and what is left.
- [CLAUDE.md](CLAUDE.md): the visual and technical direction.
