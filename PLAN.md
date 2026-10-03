# web-flock: plan for iteration one

This file covers what the project aims for and how far it has got. It does not cover how to run the
app or how the code works:

- [README.md](README.md): how to run it and what the controls do.
- [ARCHITECTURE.md](ARCHITECTURE.md): how the code fits together, and why.

Implementation notes stay out of this plan, because a note written here is out of date by the time
the step that needs it starts.

## Goal

A flocking simulator in the browser that is worth looking at. Visual impact matters more than
simulation accuracy. [CLAUDE.md](CLAUDE.md) describes the visual and technical direction.

## Success criteria

A stranger opens the page and, within ten seconds, wants to keep playing with it. For that, five
things have to be true:

1. **It flocks.** Sub-flocks form, split, stretch around each other and merge again. The flock is
   not a uniform cloud that drifts, and not a ball that jitters. This is the hardest criterion, and
   visual polish cannot make up for failing it.
2. **It is smooth.** 5,000 boids run at a steady 60 fps, with no dropped frames when the flock
   compresses. Frame time is shown on screen, so the user can check this for themselves.
3. **The grid shows the scale changing.** When you scroll the wheel, finer lines fade in from black
   and coarse ones fade out. No line appears or disappears abruptly when one decade replaces the
   next. If only one thing gets polished, it is this.
4. **The cursor pushes the flock around.** Moving the mouse through the flock scatters it
   immediately, and the boids visibly form up again behind the cursor.
5. **Every slider makes a visible change** within a second or two of moving it.

The page should also stay interesting when nobody touches it. This is not a feature to build: the
flock migrates, the camera follows it, the coordinates grow and the grid changes scale.

## How we work

Each step uses one of three modes:

- **Solo**: Claude implements the step, and nobody reviews the result.
- **Review**: Claude implements the step, and the user checks the result.
- **Collaborate**: Claude and the user work in short iterations, with the user watching during the
  work rather than after it.

Mechanical work is Solo or Review. Anything that has to be judged by eye is Collaborate.

Claude has no browser in the sandbox, so it cannot see the running app or measure performance. The
user answers every question about looks and performance. Working this way is cheaper while the user
works alongside Claude, rather than leaving it to run overnight. Looking at the screen takes the
user a couple of seconds, while taking and sharing a screenshot takes tens of seconds.

## Steps

| Step | Name                     | Mode                               | Status |
| ---- | ------------------------ | ---------------------------------- | ------ |
| 1    | Foundation and contracts | Solo                               | Done   |
| 2    | Simulation core          | Solo                               | Done   |
| 3    | The grid                 | Collaborate, labels Review         | Done   |
| 4a   | Design one boid          | Collaborate                        | Done   |
| 4b   | Render five thousand     | Review                             | Done   |
| 5    | Controls                 | Review, panel contents Collaborate | Done   |
| 6    | Camera behaviour         | Collaborate                        | Done   |
| 7a   | Behaviour tuning         | Collaborate                        | Done   |
| 7b   | Visual polish            | Collaborate                        | Done   |
| 8    | Performance and ship     | Solo                               | Next   |

Step 7b comes before step 8, and both come last, because both assess the finished app.

### 1. Foundation and contracts

The scaffold, the camera model, a thin GL helper, and the `step(dt)` interface that a later GPU
backend has to fit.

The `step(dt)` interface ended up as two interfaces instead of one. If the simulation returned typed
arrays, a GPU backend would have to read its own results back from the GPU.

### 2. Simulation core

Typed arrays, a spatial hash, the three rules, field of view, a limit on turn rate, and a weak pull
toward the origin. A fixed timestep and a seeded start.

This step covered correctness only. Whether the result looks like a flock is step 7a. A bug in the
neighbour lookup does not crash anything; it only makes the flock move less crisply. Without this
step, we would have spent step 7a tuning parameters to hide such a bug.

### 3. The grid

The adaptive axis grid, its tick labels and the coordinate readout.

This step added a comparison mode, which showed four variants of the same view in one frame. It was
used to settle the style choices in this step and in step 4a. Step 7a explains why it was removed.

The style choices are made. Every option that was not chosen can still be picked from a preset,
because step 7b reviews all of them again against the finished renderer.

### 4a. Design one boid

One large boid with its trail, changed live until the shape looked right.

Both ways of drawing a trail were built and compared, which is why the result can be trusted. The
ribbon was chosen. The streak was deleted instead of kept behind a flag.

### 4b. Render five thousand

Instancing, the buffer code, and the frame-time HUD. The HUD was added here instead of in step 8, so
that performance could be seen through all the later steps.

On the M1 Max, 5,000 boids run well above 60 fps, which meets the second success criterion. This
needed no optimisation code. The first measurement was well below 60 fps. The fix was to spread the
flock out, which step 4a had already wanted for looks, so the problem with looks and the problem
with performance turned out to be the same problem. Step 8 had expected to need an optimisation, and
it did not.

The Ryzen desktop has not been measured yet.

### 5. Controls

The parameter panel, saving settings, zoom input, and the cursor force with its radius drawn on the
grid.

Two parts of the original plan were wrong:

- **The framing percentage moved to step 6.** A zoom that is continuously computed from the flock's
  spread keeps zooming in and out. It needs a tolerance band, which is part of step 6.
- **Manual panning came back**, behind a `follow` checkbox. It is worth being able to watch the
  flock leave the screen, and the pull toward the origin means the flock cannot be lost for good.
  Nothing turns follow off unless the user asks.

As planned, the slider ranges are wide rather than tuned. The design tool from step 4a was deleted
in this step, as step 4a had planned.

### 6. Camera behaviour

Automatic follow and zoom that are comfortable to watch:

- framing that a single straggler cannot pull away
- a tolerance band, so the flock can move freely within a window before the camera reacts
- damping, so both the centre and the zoom move evenly

The framing percentage from step 5 was added here.

Half of this was not needed. The centre never needed damping, because the centroid of hundreds of
boids does not jitter. Only the zoom looked broken.

The framing percentage ended up as a multiplier on the flock's size, not as the quantile. The useful
range spans several decades, from flying inside the flock to showing it as a small spot on the grid,
and a quantile cannot go beyond the whole flock. The quantile is now a constant that only filters
out stragglers.

In follow mode the camera controls the zoom, so the panel has two zoom controls and shows whichever
one is in use. The two settings for tuning the follow zoom stayed in the panel after step 7b.

### 7a. Behaviour tuning

Eight named flock presets in `src/sim/presets.ts`, chosen with the number keys. The slider ranges
were narrowed to around the values the presets use.

The result is a list of presets rather than one set of values. A stranger gets the first one in the
list.

The four-pane comparison mode was removed in this step, along with the keys for the grid presets.
Comparing four styles in one frame was worth the code. Comparing four simulations would not be,
because the difference between two presets shows in how they move over a minute. The number keys are
more useful for choosing the flock, and the palettes moved to shift and a number key.

Tuning could not fix two problems. Iteration two would start with these.

#### A linear origin pull gathers every sub-flock into one ring

A boid circling under the pull settles at a radius of `v/√k` and turns at `√k`, whatever its speed.
Every sub-flock then turns at the same angular rate, and they lock into phase with each other. The
presets that stay interesting either fly fast enough to overcome the pull, or pull so weakly that
one lap takes minutes.

A pull of constant magnitude beyond some radius would prevent this, because the angular rate would
then depend on speed.

#### Separation saturates, so a clump that forms does not break up (partly fixed)

The summed `1/d` vector is normalised before it is used for steering. It therefore pushes no harder
as the flock gets more crowded, and it shares the force cap with cohesion. Deep inside a clump the
terms also cancel out. The neighbour search costs the square of the density, so a crowded flock is
also a slow one.

A minimum contact distance now limits the density, and with it the step time. At 5,000 boids, the
mill preset used to slow to over 20 ms per step and kept getting slower. With a contact distance of
10, it stays near 6 ms, measured in Node.

The classic separation rule still saturates. Crowd pressure, added later, is an alternative rule
whose push grows as boids get closer and adds up over neighbours. It defaults to 8, so the spacing
spreads out between the contact distance and the separation radius instead of forming a lattice. No
preset sets it.

### 7b. Visual polish

Colour, line weights, how trails fade, glow, the grid's fade curve, and whether to replace
Tweakpane.

What was decided:

- **Tweakpane stays.** The panel is titled Flock. The rules a flock preset sets have their own
  folder, whose title shows the matching preset or `custom`. The other flock settings are in a
  folder called simulation.
- **One grid style.** The other grid presets were removed. Grid lines always snap to pixels, tick
  labels always sit at the edges, and they always use the compact format, such as `1.2k`.
- **Seven palettes, five of them coloured by density.** Each colour ramp has three colours instead
  of two, because a mix between two distant hues passes through grey halfway. Signal stays the
  default.
- **Floor fade is fixed at 1.**
- **Line width, trail width, trail brightness, trail fade and glow are panel sliders.** Their values
  are good enough for now and can be tuned later. Export to console prints them.

Glow is a halo drawn around each chevron and trail in their own shaders. Its radius is in world
units, so it scales with the zoom, and its cost grows with the zoom too. At glow 0 it costs nothing.
If it turns out to be too slow, a screen-space bloom pass would replace it: blur a chain of smaller
copies of the boid layer and add it back on top. Its cost depends only on the screen size.

The plan was to remove the development tools when this step ended. They stay, so the look can still
be tuned and exported later.

### 8. Performance and ship

Both target machines are much faster than 5,000 boids on the CPU need. No optimisation work is
planned unless the HUD shows a problem.

What remains:

- Measure performance on the Ryzen desktop.
- Check README.md and ARCHITECTURE.md against the finished project.

## Out of scope for iteration one

- Obstacles
- Painted force fields
- GPU simulation
- Level of detail for the boid shape that depends on zoom
- The origin pull that grows less than linearly, described in step 7a

## Open questions

- ~~Tick label format and placement~~: decided in step 3.
- ~~Trail construction, chevron proportions and colour~~: decided in step 4a.
- ~~Slider ranges~~: decided in step 7a.
- ~~Whether to replace Tweakpane~~: decided in step 7b.
