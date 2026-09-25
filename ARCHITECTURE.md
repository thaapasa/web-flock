# Architecture

## Overview

The app is built with Vite, TypeScript and WebGL2, with a thin GL wrapper of our own. There is no
engine and no framework. The only UI library is Tweakpane, which draws the parameter panel. The
simulation runs on the CPU over typed arrays and targets 5,000 boids.

The page has three layers:

- a WebGL canvas for the scene
- a 2D canvas on top of it for text
- the parameter panel

### Source layout

- `src/app.ts`: connects the modules and runs the frame loop. Start reading here.
- `src/sim`: the simulation and its parameters.
- `src/render`: the GL wrapper, the grid, the boids, the text layer and the shaders.
- `src/camera`: the transform between world and screen, and the controls that move the camera.
- `src/ui`: the settings, the panel that edits them, and saving them.
- `src/dev`: a temporary log of frame times.

## Frame loop

Each frame, the loop:

1. Adds the elapsed time to an accumulator.
2. Runs simulation steps of 1/120 s until less than one step's worth of time is left. Every fourth
   step also records a trail sample.
3. Moves the camera.
4. Uploads the boid state to the GPU.
5. Draws the grid, then the trail ribbons, then the chevrons, then the text.

The timestep is fixed for two reasons:

- The flock behaves the same at any framerate.
- After a slow frame, the loop runs several normal steps instead of one long one.

A frame runs at most five steps and discards the remaining time, so a slow step cannot freeze the
page. When this happens, the HUD shows `behind`.

## Simulation

The interface is in `src/sim/simulation.ts` and the implementation in `src/sim/flock.ts`.

- State: positions, velocities and neighbour counts, stored as packed typed arrays.
- Neighbour search: a spatial hash. Nearly all of the step time is spent here.
- Parameters: plain data, applied from the next step on.
- Randomness: seeded, so two parameter sets can be compared starting from the same flock.

### Minimum distance between boids

Boids keep a minimum distance apart. This is what keeps the cost of a step bounded.

Separation is only a steering force. With a strong pull or a slow turn rate, boids end up on top of
each other. In such a clump every boid is a neighbour of every other boid, so the cost of a step
grows with the square of the density.

To prevent this, a contact pass runs after each step and pushes apart any two boids closer than
`contactDistance`. This limits the number of boids in one neighbourhood to roughly
`(neighbour radius / contact distance)²`.

The push is also added to the velocity for the next step. Without it, a boid that was pushed out
keeps flying back into the crowd, and the clump packs down anyway.

### Summaries for other modules

The simulation also computes values that other modules need:

- a sample of boid positions, for the camera
- the ranges of speed and density, which the renderer uses for colour

These are computed in the simulation because no other module can afford to loop over every boid.

### Replacing it with a GPU backend

A GPU backend must be able to replace the simulation. For that reason:

- `Simulation` contains no GL code.
- Per-boid data reaches the GPU through a separate interface, `BoidFeed`, which the renderer owns.

The CPU backend is wrapped in a feed that uploads its arrays. A GPU backend would implement both
interfaces and give the renderer the buffer it has already filled, so nothing is read back from the
GPU.

## Rendering

### Grid

The grid is a single fullscreen shader pass with no geometry. For each pixel, the shader works out
which lines pass through it, using the decades of line spacing that are currently visible. Each
decade fades in and out as you zoom. Since there is no geometry, the grid covers the plane however
far the flock travels.

The shader works in device pixels and never receives a world coordinate. Far from the origin,
float32 does not have enough precision for world positions, and the lines start to shimmer. To avoid
this, the CPU converts the world position to a small pixel offset in float64 before uploading it.

### Boids

The boids are drawn with two instanced draw calls: the trail ribbons first, then the chevrons on
top.

Trail history is stored in a texture of recent samples, one column per boid. Samples are recorded on
simulation steps, not on frames, so a trail covers a fixed length of simulated time at any
framerate.

Both boid shaders output premultiplied colour. The source blend factor is then `ONE` in both blend
modes, and only the destination factor differs between additive and alpha blending. One shader
serves both modes.

### Colour and styles

Colour ramps span the speed and density ranges that the simulation reports, not fixed values. That
way, retuning the flock cannot leave a style with a ramp over a range that no boid reaches.

Everything else about the look that the user can adjust is a named preset in
`src/render/grid-style.ts` or `src/render/boid-style.ts`. The renderers have no built-in appearance.

## Camera

World space has +y up. The flip to screen space happens only in `src/camera/camera.ts`.

Zoom is stored as log10 of pixels per world unit. This matches the grid, which fades lines in and
out per decade.

### Following the flock

With follow on, the camera centres on the flock every frame and sets the zoom from the flock's size.
With follow off, dragging the pointer moves the centre, and the zoom stays where the user set it.

The centre is not smoothed, because the centroid of hundreds of boids barely moves between frames.

The zoom is smoothed. The flock's size changes every step, and a zoom that followed it directly
would keep oscillating. The grid's decades would then fade in and out, and a correct grid would look
broken. So the zoom:

- responds only to the part of a change that goes past a deadband
- eases toward its target instead of jumping
- zooms in more slowly than it zooms out, because boids about to leave the screen need a quick
  response and empty space around the flock does not

To measure the flock's size, the camera takes a quantile of the sampled positions rather than the
farthest one, so a single straggler cannot pull the camera away.

## Settings

A single object holds everything the user can change. The panel, the mouse wheel and the preset keys
all change this object in place, so there is no second copy that could go out of sync. `src/app.ts`
is the only place that turns it into simulation parameters, styles and a camera.

### Saved sets

Sets of settings are saved in `localStorage`. They are validated when loaded, because the stored
text may come from an older build or may have been edited by hand.

The look is saved as preset names plus overrides, not as a finished style. When a preset is retuned
later, saved sets that use it get the change.

### Flock presets

How the flock flies is also a named preset, defined in `src/sim/presets.ts`. A flock preset contains
only the flocking rules. Choosing one leaves the boid count, the spawn disc and the cursor as they
were.

Unlike the look, the flock preset is saved as values, not as a name. Moving a slider takes the set
off its preset, and that change has to survive a reload. The readout finds the preset name by
comparing values, so when a slider goes back to a preset's value, the readout shows that preset's
name again.

## Tests

Tests sit next to the code they cover and run in Node. Three of them describe the intended behaviour
and are worth reading:

- `src/sim/spatial-hash.test.ts` compares the index with a brute-force search.
- `src/sim/flock.test.ts` checks that the flock stays bounded and produces no NaN values.
- `src/render/grid-bands.test.ts` checks that no grid line appears or disappears abruptly while the
  zoom sweeps across six decades.

## Related documentation

- [README.md](README.md): how to run the app, and what the controls do.
- [PLAN.md](PLAN.md): what is done and what is left.
- [CLAUDE.md](CLAUDE.md): the visual and technical direction.
