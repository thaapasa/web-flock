# Architecture

## What it does

web-flock steps a flock of boids on the CPU and draws it with WebGL2. There is no engine and no
framework: Vite, TypeScript, a thin wrapper over WebGL2, and Tweakpane for the parameter panel.

The page is two stacked canvases and one frame loop. Everything the user can change is one plain
object that the panel mutates in place.

This page is for someone about to change the code. README.md covers running the app and using it.

## The model

Six pieces, and the seams between them are the design:

- **The simulation** (`src/sim`) owns the boids. It exposes `step(dt, input)`, packed typed arrays
  of positions, velocities and neighbour counts, and two summaries it computes as it goes: a small
  position sample for the camera, and the speed and density bands the renderer maps colour across.
  It knows nothing about GL.
- **The feed** (`src/render/boid-feed.ts`, `src/render/trail-history.ts`) carries per-boid data to
  the GPU: the current state as vertex attributes, and a ring of recent samples as a texture.
- **The renderers** (`src/render`) draw the grid, the trail ribbons, the chevrons, and then the text
  layer over all of it.
- **The camera** (`src/camera`) is the world/screen transform, plus the wheel, drag and keys that
  move it and the one-shot measurement that frames the flock.
- **The settings** (`src/ui`) are everything adjustable, with the panel bound to them and the
  persistence that survives a reload.
- **The orchestrator** (`src/app.ts`) owns the frame loop and is the only place that knows all of
  the above exist in the same program.

A frame runs in this order:

1. Add the elapsed real time to an accumulator.
2. Run whole simulation steps at 120 Hz until the accumulator is spent, capturing a trail sample
   every fourth step.
3. Move the camera to where the flock is now.
4. Upload the boid state to the GPU.
5. Draw the grid, then the ribbons, then the chevrons, then the overlay text.

## Why it works this way

**The simulation and the path to the GPU are two interfaces, not one.** A simulation computes and
does not draw, so `Simulation` has no GL in it. But a GPU backend that had to hand back a
`Float32Array` would read its own results off the GPU every frame, only for the renderer to upload
them straight back, and that readback is what would turn a later GPU backend into a rewrite. So
getting per-boid data onto the GPU is a second interface, `BoidFeed`, and it belongs to the
renderer. The CPU backend gets an uploading feed wrapped around it. A GPU backend implements both,
hands over the buffer it just computed into, and its `sync` does nothing.

Two consequences keep that seam honest. Parameters go in as plain data, never as callbacks or
objects with behaviour, so a parameter set is equally natural as JavaScript fields or as a uniform
block. And any summary of the whole flock comes from the backend, because only the backend knows
what it can afford to produce. Nobody else scans every boid.

**The timestep is fixed, and the debt is capped.** The simulation owes 120 steps per second of real
time whatever the display does, so behaviour does not change with the framerate and a frame hitch
produces several ordinary steps instead of one enormous one. A fixed timestep behind a slow step
does not degrade, it spirals, so a frame runs at most five steps and drops the rest of the debt. The
simulation then runs in slow motion under overload while the page stays responsive, and the HUD says
`behind` rather than hiding it.

**Neighbour search is the whole cost of flocking**, so `sim/spatial-hash.ts` is where the
performance lives. Cost scales with how many neighbours each boid has, which is why the thing that
made five thousand boids affordable was spreading the flock out rather than any change to the index.

**The camera holds two conventions for everyone.** World space has +y up while the screen has +y
down, and the flip lives in `camera/camera.ts` alone. Zoom is held as
`log10(pixels per world unit)`, because everything that cares about zoom wants it that way: the
integer part names the decade the grid is fading, multiplicative steps become addition, and damping
toward a target zoom is linear in this space, which is what will make step 6 feel even rather than
accelerating.

**Zoom is a number the camera holds, not one it derives.** Deriving it every frame from the flock's
spread was built and taken out again: the reach moves a little every step, so the scale moved a
little every frame, and the grid turned that into a permanent shimmer. The measurement was right,
and running it continuously was what could not work. `camera/framing.ts` keeps the quantile, the
reach and the fit as a one-shot that only a key or a button calls. A continuously derived zoom
becomes possible in step 6, which adds the tolerance band the flock can move inside.

**The grid is found per pixel, with no geometry.** One fullscreen triangle, one draw call, and every
line comes out of the distance to the nearest multiple of each visible decade. That is what makes
the plane unbounded: there is no vertex buffer to run out of, and a line ten million units out costs
what one at the origin costs.

**A line's brightness depends only on how far apart that decade's lines are on screen.** Every line
belongs to several decades at once, since the line at 100 is also a multiple of 10 and of 1, so the
shader takes the maximum weight over the decades a pixel falls on rather than the sum. Each line
then draws at the weight of the coarsest decade it belongs to, with no test anywhere for which
decade owns a line, and never brighter than 1. Continuity at a handover follows from where a decade
enters and leaves the set rather than from tuning, and `render/grid-bands.ts` holds that arithmetic
on the CPU, where the tests can reach it.

**The shaders work in device pixels, never in world units.** Once the flock has migrated a few
hundred thousand units out, float32 runs out of mantissa on a world coordinate and the lines
shimmer. Each decade is reduced to an offset near the camera centre, once per frame, in float64, so
the shader never handles a large number.

**Coverage is a box filter rather than a smoothstep**, for the grid lines and for the boid marks
alike. A box filter stays correct below one pixel: a half-pixel line comes out at half brightness
instead of being widened to a full one, which is what lets fine lines fade out instead of crowding
together, and what lets a distant flock thin into a texture.

**A boid is a distance field, not geometry.** `gl.lineWidth` is capped at 1 on every platform that
matters, so stroked geometry would have fixed the stroke weight for good; as a field, weight is a
number and a later glow is a change to that number. Below a few pixels of mark the stroke thins in
proportion instead of filling in, so direction stays readable at the size floor, which CLAUDE.md
requires.

**The trail follows the path, not the velocity.** A straight streak behind a turning boid points off
at a tangent while the boid curves away from it, which reads as wrong immediately. So the ribbon is
threaded through recorded positions, and it slides back half a mark along the path so that it leaves
the chevron's open back rather than the boid's centre, which is inside the V.

That needs several past samples per boid, and a vertex shader cannot reach them through attributes,
since an attribute is indexed by instance or by vertex and never by both. History is therefore a
texture, one column per boid and one row per sample, written as a ring so a capture is one row
upload. Each texel holds position, speed and density: recording what the boid was doing at each
sample, rather than colouring the whole trail by what it is doing now, is what makes the trail a
history of the flight. Capture is tied to simulation steps rather than frames, so a trail is a
length of time rather than a length of framerate.

**Colour ramps name fractions of a band, never world values.** A style says where in the band its
ramp starts and ends, and the simulation reports the band, so retuning the speed or dragging the
count slider changes what the colours mean without touching a style. The speed band is exact. The
density band has no parameter behind it, so it is estimated from the sample the camera already needs
and smoothed, because a band divides a colour and one that twitched would shimmer the whole flock
between hues.

**Everything adjustable lives in one settings object, mutated in place.** The panel binds to it, and
so do the wheel and the preset keys, so nothing is copied out and copied back and no second copy can
disagree. `src/app.ts` is the only place that turns it into simulation parameters, a pair of styles
and a camera.

Two details of that object are load-bearing. The cursor is a mode plus a magnitude rather than one
signed number, because an off position in the middle of a slider is one nobody finds. And the look
is stored as preset names plus overrides, never as a resolved style: a saved style would freeze a
copy of whatever the preset said that day, and later retuning would never reach a browser that had
one.

**Persistence assumes the stored blob is wrong.** It comes from a store the user can edit, from an
older build, or from a newer build that was rolled back, so every field is validated on the way in
and each bad one falls back on its own. Storage sits behind an interface because the tests run in
node with no DOM, and because `localStorage` throws rather than failing quietly in a private window
and wherever a browser blocks site data. A refused store leaves the page running without
persistence.

**Text is a second canvas with the 2D context.** A glyph atlas and a layout pass would gain nothing,
because these few dozen numbers never need to sit inside the scene. The overlay takes no pointer
events, so the canvas underneath keeps receiving them.

**`src/dev/` is temporary and nothing outside it may import from it.** It holds comparison mode,
which puts four presets on screen in one frame, and the readings log, which is how a measurement
leaves the browser in a shape that survives being pasted back. Both exist because only a person
looking at the screen can answer the taste calls and the performance questions. They go when the
taste calls are settled.

## Where the code is

`src/sim` owns the simulation: the contract in `simulation.ts`, the CPU backend in `flock.ts`, the
neighbour index in `spatial-hash.ts`, and the parameter set in `params.ts`.

`src/render` owns everything that draws, including the shaders it loads as raw text. The GL wrapper
is `gl.ts`. The grid, the boids and the text layer each have a module, and the two style files
(`grid-style.ts` and `boid-style.ts`) hold every adjustable value with its presets.

`src/camera` owns the transform and the controls that move it. `src/ui` owns the settings, the panel
bound to them and the storage behind them. `src/dev` owns the tools described above. `src/app.ts`
wires it all together and runs the frame loop; start reading there.

Tests sit beside the code they cover. The ones worth reading as a specification are
`sim/spatial-hash.test.ts`, which checks the index against brute force, `sim/flock.test.ts`, which
pins the flock as bounded and free of NaN, and `render/grid-bands.test.ts`, which sweeps the zoom
across six decades and asserts that no line ever pops.

## Related documentation

- [README.md](README.md): how to run the app, and what every control does.
- [PLAN.md](PLAN.md): what iteration one is, what is done, and what is left.
- [CLAUDE.md](CLAUDE.md): the visual and technical direction this all serves.
