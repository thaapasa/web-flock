# web-flock — plan for iteration one

## Goal

A flocking simulator in the browser that is worth looking at. Visual impact over
simulation accuracy. See CLAUDE.md for the visual and technical direction.

## What success looks like

A stranger opens the page and within ten seconds wants to keep playing with it.
Concretely, five things must be true:

1. **It flocks.** Coherent sub-flocks form, split, stretch around each other and
   re-merge — not a uniform drifting cloud, not a jittery ball. The hardest
   criterion and the one most likely to disappoint. Visuals cannot compensate
   for failing it.
2. **It is smooth.** 5,000 boids at a locked 60fps, no hitching when the flock
   compresses. Frame time on screen so this is checkable rather than claimed.
3. **The grid breathes.** Scrolling the wheel makes finer lines emerge from
   black and coarse ones dissolve, continuously, with no pop at the handover
   between decades. This is the wow moment. If only one thing is polished, it is
   this.
4. **The cursor has weight.** Moving the mouse through the flock scatters it
   instantly and it visibly re-forms behind you. No perceptible lag.
5. **The sliders do something you can see.** Dragging a parameter visibly
   changes the character of the motion within a second or two.

Plus one thing that is not a feature: it stays interesting when left alone. The
flock migrates, the camera follows, coordinates climb, the grid shifts scale.

## How we work

Three modes per step:

- **Solo** — Claude implements, no review needed.
- **Review** — Claude implements, the user checks the result.
- **Collaborate** — tight loop, the user's eyes during the work, not after.

The dividing line is aesthetic judgement. Everything mechanical is Solo or
Review; everything felt is Collaborate.

Claude has no browser in the sandbox and cannot see the running app or measure
performance. The user is the instrument for every visual and performance
question. This is deliberate: the user's look costs ~2s against tens of seconds
for a screenshot round trip, and the user is working alongside rather than
leaving Claude to run overnight. Vite HMR keeps that loop tight.

## Steps

### 1. Foundation and contracts — Solo

Scaffold, camera model, and the simulation interface.

- yarn + Vite + strict TypeScript, ESLint + Prettier + Vitest, and an
  auto-fixing import-sort plugin to keep import churn out of diffs
- Resize-aware full-window canvas, WebGL2 context, black clear
- A minimal GL helper: compile/link, uniforms, VAOs, instanced draws
- Camera model: world/screen transform, zoom held as a log value.
  **Y-axis points up** (mathematical, not screen-native)
- The `step(dt)` interface and buffer layout — no implementation

The interface file is the one thing worth reviewing: it decides whether a later
GPU backend is a drop-in or a rewrite.

### 2. Simulation core — Solo

Typed arrays, uniform spatial hash, separation / alignment / cohesion, field-of-
view angle, turn-rate limit, weak pull toward the origin.

- **Fixed timestep** with a real-time accumulator, so behaviour does not change
  with framerate and a frame hitch cannot fling boids across the world
- **Seeded RNG** for initial state, so two parameter sets can be compared
  against identical starting conditions
- Tests: spatial hash returns the same neighbour set as brute force, nothing
  goes NaN, speeds stay bounded

Correctness only. Whether it *looks* like a flock is step 7a. Keeping these
separate matters — a neighbour-lookup bug does not crash, it just makes the
flock mushy, and we would waste 7a tuning our way around a bug.

### 3. The grid — Collaborate (labels: Review)

Fullscreen shader, per-decade fade driven by log zoom, anti-aliased lines,
emphasized axes, origin marker, edge tick labels, live coordinate readout.

Claude can guarantee the maths: lines in the right world positions, crisp at any
zoom, fade weights that sum consistently so brightness does not pulse at a
handover. The feel needs the user: how many decades are visible at once, the
shape of the fade curve, the brightness ratio between coarse and fine lines,
whether axes and origin are emphasized.

To keep that cheap, build a **comparison mode** — the same grid rendered as a
2x2 of variants in one frame, plus number keys for named presets. One look
covers four variants. The mode pays for itself again in 7a.

Tick labels and the coordinate readout ride along as Review. Open taste calls:
`1200` vs `1.2k`, labels on the screen edge or on the axes.

### 4a. Design one boid — Collaborate

A single large boid on screen, slowly rotating, with its trail. Iterate live
until the mark itself looks right.

This is where these get decided rather than guessed:

- Trail construction: a short ring buffer of recent positions drawn as a fading
  polyline (curves with the path, costs history for 5,000 boids — roughly 16
  points each, trivial for a GPU) versus a quad stretched along the velocity
  vector (nearly free, always straight, reads as motion blur)
- Chevron proportions, line weight
- Colour: single cyan-white, or brightness/hue mapped to speed or local density

Needs only the scaffold and a fake velocity, so it can start early — before the
simulation is finished.

### 4b. Render five thousand — Review

Instancing, buffer plumbing, one draw call.

- Boid size scales with zoom but **clamped to a minimum**, so distant flocks
  thin into a texture while individuals stay visible up close. Not LOD — the
  same mark throughout — but a departure from strictly constant screen size
- The frame-time HUD and a boid-count slider land here, not in step 8, so
  performance is visible the whole way through

### 5. Controls — Review (panel contents: Collaborate)

Parameter panel, zoom input, cursor force.

- **Tweakpane** for now. Good enough for iteration one; replaced in 7b if worth it
- Parameter sets persist to **localStorage**, with **export to console** so the
  user can paste a set to Claude, and a **reset button** that clears storage and
  reverts to defaults
- **The wheel adjusts framing percentage, not raw zoom**: how much room the
  flock gets, from ~10% (in among individual boids) to ~1000% (a small knot in a
  vast grid). Multiplicative steps, with a readout. Roughly two decades, so the
  grid handover repeats rather than happening once
- No manual pan, and no follow/override state machine. The camera always centres
  the flock; zoom is a parameter of the framing, not a mode that disengages it
- Cursor force: predator or attractor, radius drawn on the grid

Slider **ranges** matter more than the code — a range that is mostly dead zone
makes the simulation feel broken when it is not. Ranges get revised in 7a, once
there is something to tune against.

### 6. Camera behaviour — Collaborate

Auto-follow and auto-zoom, damped.

- **Robust framing**: the tightest region containing ~85% of the flock, so a
  single straggler cannot drag the frame or force a zoom-out
- **Hysteresis, not a dead zone**: the flock moves freely inside a window; once
  it pushes past an edge the camera follows, then holds that position when they
  turn back, until they have crossed to the opposite edge. Same for zoom, with
  its own tolerance band
- Separate time constants for pan and zoom, zoom noticeably lazier

Most likely step to be quietly bad: every piece is easy, the composite is a feel
problem. Coupled to step 3 — camera zoom drives the grid's LOD, so a camera that
hunts makes the grid pulse between decades. The grid can be perfect on its own
and still look broken. Judging it means watching both together.

### 7a. Behaviour tuning — Collaborate

Finding parameter values that genuinely flock. Starts as soon as 4b can draw a
crowd, even an ugly one, and continues throughout — so we learn early whether it
flocks rather than discovering it at the end.

The top success criterion and pure judgement; Claude cannot evaluate it. The
machinery that makes the user's time cheap: seeded starts make A/B fair, saved
sets and console export make "this one felt good" concrete, comparison mode puts
four candidates on screen at once. The pattern is *Claude prepares candidates,
the user picks a direction, repeat* — not the user alone with sliders, not
Claude guessing blind.

### 7b. Visual polish — Collaborate

Colour, line weights, trail falloff, glow, the grid's fade curve, and possibly
replacing Tweakpane with a panel that matches the aesthetic. End of project,
against the finished renderer.

### 8. Performance and ship — Solo

Both target machines (M1 Max MacBook Pro, Ryzen 9800X3D desktop) are far above
what 5,000 CPU-side boids needs, so no optimization work is planned unless the
HUD from 4b says otherwise. The predictable failure, if it shows up, is the
spatial hash degrading toward O(n^2) when the flock compresses into one cell —
fixed with cell sizing tied to the neighbour radius and a per-cell cap.

Short README: how to run it, what the controls do.

## Sequencing

1 blocks everything. After it, 2 and 4a are independent and 4a only needs a fake
velocity, so the single-boid design can happen while the simulation is being
built. 3 needs only the camera model. 4b needs 2 and 4a. 5 and 6 need 4b. 7a
starts the moment 4b draws a crowd and runs alongside 5 and 6. 7b and 8 last.

## Out of scope for iteration one

Obstacles, painted force fields, GPU simulation, deployment, manual panning,
zoom-dependent LOD for the boid mark.

## Open questions

- Tick label format and placement (decided in step 3)
- Trail construction, chevron proportions, colour (decided in 4a)
- Slider ranges (decided in 7a)
- Whether Tweakpane gets replaced (decided in 7b)
