# web-flock — plan for iteration one

## Goal

A flocking simulator in the browser that is worth looking at. Visual impact over simulation
accuracy. See CLAUDE.md for the visual and technical direction.

## What success looks like

A stranger opens the page and within ten seconds wants to keep playing with it. Concretely, five
things must be true:

1. **It flocks.** Coherent sub-flocks form, split, stretch around each other and re-merge — not a
   uniform drifting cloud, not a jittery ball. The hardest criterion and the one most likely to
   disappoint. Visuals cannot compensate for failing it.
2. **It is smooth.** 5,000 boids at a locked 60fps, no hitching when the flock compresses. Frame
   time on screen so this is checkable rather than claimed.
3. **The grid breathes.** Scrolling the wheel makes finer lines emerge from black and coarse ones
   dissolve, continuously, with no pop at the handover between decades. This is the wow moment. If
   only one thing is polished, it is this.
4. **The cursor has weight.** Moving the mouse through the flock scatters it instantly and it
   visibly re-forms behind you. No perceptible lag.
5. **The sliders do something you can see.** Dragging a parameter visibly changes the character of
   the motion within a second or two.

Plus one thing that is not a feature: it stays interesting when left alone. The flock migrates, the
camera follows, coordinates climb, the grid shifts scale.

## How we work

Three modes per step:

- **Solo** — Claude implements, no review needed.
- **Review** — Claude implements, the user checks the result.
- **Collaborate** — tight loop, the user's eyes during the work, not after.

The dividing line is aesthetic judgement. Everything mechanical is Solo or Review; everything felt
is Collaborate.

Claude has no browser in the sandbox and cannot see the running app or measure performance. The user
is the instrument for every visual and performance question. This is deliberate: the user's look
costs ~2s against tens of seconds for a screenshot round trip, and the user is working alongside
rather than leaving Claude to run overnight. Vite HMR keeps that loop tight.

## Steps

### 1. Foundation and contracts — Solo — done

Scaffold, camera model, and the simulation interface.

- yarn + Vite + strict TypeScript, ESLint + Prettier + Vitest, and an auto-fixing import-sort plugin
  to keep import churn out of diffs
- Resize-aware full-window canvas, WebGL2 context, black clear
- A minimal GL helper: compile/link, uniforms, VAOs, instanced draws
- Camera model: world/screen transform, zoom held as a log value. **Y-axis points up**
  (mathematical, not screen-native)
- The `step(dt)` interface and buffer layout — no implementation

The interface file is the one thing worth reviewing: it decides whether a later GPU backend is a
drop-in or a rewrite.

Done. The contract lives in `src/sim/simulation.ts`: the backend owns the boid data and hands the
renderer GL buffers rather than typed arrays, so a GPU backend never reads back merely to satisfy
the interface. Trails are deliberately not in it — 4a decides what they are, and either shape is the
renderer's business. A null backend allocates everything and simulates nothing, so the seam can be
built against before step 2 exists.

Two toolchain notes: TypeScript is pinned to 5.x because no released typescript-eslint supports TS 7
yet, and `eslint-config-prettier` is absent on purpose — measured against this config it disables
358 rules, none of which we enable.

### 2. Simulation core — Solo — done

Typed arrays, uniform spatial hash, separation / alignment / cohesion, field-of- view angle,
turn-rate limit, weak pull toward the origin.

- **Fixed timestep** with a real-time accumulator, so behaviour does not change with framerate and a
  frame hitch cannot fling boids across the world
- **Seeded RNG** for initial state, so two parameter sets can be compared against identical starting
  conditions
- Tests: spatial hash returns the same neighbour set as brute force, nothing goes NaN, speeds stay
  bounded

Correctness only. Whether it _looks_ like a flock is step 7a. Keeping these separate matters — a
neighbour-lookup bug does not crash, it just makes the flock mushy, and we would waste 7a tuning our
way around a bug.

Done. `src/sim/flock.ts` is the backend, `src/sim/spatial-hash.ts` the neighbour index, and
`src/app.ts` the orchestrator that assembles canvas, GL, camera, simulation and feed and runs the
frame loop. Nothing draws yet.

Step 1's contract was rewritten in the process. It required a GL context because a GPU backend must
not be forced to read its results back off the GPU merely to satisfy the interface — a real concern,
but one that was conflated with the simulation _owning_ GL. Split in two, both properties hold:
`Simulation` is pure and testable in node, and `BoidFeed` in `render/` carries per-boid data to the
GPU. A GPU backend implements both, and its `sync` does nothing. Upload cadence became the
orchestrator's business, which is what it always was: once per frame, not once per 120 Hz step.

Three parameters were added because the step needed them. `maxForce` caps the summed steering of the
three rules, which is what turns the weights into a ratio instead of three unbounded gains and is
worth more to 7a than anything else here. `wanderStrength`/`wanderRate` keep a settled flock from
crystallising. `spawnRadius` sizes the seeded starting disc. Field of view applies to alignment and
cohesion only — separation stays omnidirectional, since a blind spot in the rule that prevents
collisions reads as a bug. Origin pull is a linear spring, so boundedness is guaranteed rather than
hoped for; a test runs the flock for four minutes at extreme settings and checks its reach settles
instead of creeping.

Raising `count` live spawns the new boids beside boids already flying, so the slider in 4b thickens
the flock you are watching rather than firing a clump in from the spawn disc.

One performance note, and it is a caveat rather than a result. Neighbour search is the whole cost:
the 3x3 cell walk is done once per _cell_ and shared by the boids in it, which is worth about 20%,
and after it the profile is 98% the neighbour loop, with the hash rebuild free at 0.06 ms. Absolute
numbers are not available here — the sandbox benchmarks roughly 15x slower than native hardware on a
calibration loop, so nothing measured in it says whether 5,000 boids hold 60fps. The HUD in 4b
answers that, on a real machine. The relevant lever, if it turns out to be needed, is that cost
scales with the square of `neighbourRadius`.

### 3. The grid — Collaborate (labels: Review) — done

Fullscreen shader, per-decade fade driven by log zoom, anti-aliased lines, emphasized axes, origin
marker, edge tick labels, live coordinate readout.

Claude can guarantee the maths: lines in the right world positions, crisp at any zoom, fade weights
that sum consistently so brightness does not pulse at a handover. The feel needs the user: how many
decades are visible at once, the shape of the fade curve, the brightness ratio between coarse and
fine lines, whether axes and origin are emphasized.

To keep that cheap, build a **comparison mode** — the same grid rendered as a 2x2 of variants in one
frame, plus number keys for named presets. One look covers four variants. The mode pays for itself
again in 7a.

Tick labels and the coordinate readout ride along as Review. Open taste calls: `1200` vs `1.2k`,
labels on the screen edge or on the axes.

Done. The maths lives on the CPU in `render/grid-bands.ts`, where it can be tested, and the shader
consumes what comes out of it. One rule carries the whole thing: **a line's brightness is a function
of how far apart that decade's lines are on screen, and nothing else.** Every line belongs to
several decades at once — the line at 100 is also a multiple of 10 and of 1 — so the shader takes
the **maximum** weight over the decades a pixel falls on rather than the sum. A line is then drawn
at the weight of the coarsest decade it belongs to, automatically, with no "which decade owns this
line" test anywhere, and never brighter than 1, which is what a sum would do at every intersection
of scales.

The plan asked for fade weights that "sum consistently so brightness does not pulse at a handover".
Summing is exactly what cannot be done. Continuity instead follows from two facts: a decade enters
the set precisely where its weight is 0, and leaves only once its weight has saturated at 1, so the
decade above is already drawing its lines at the same brightness. Neither is tuned. Both are
asserted by sweeping the zoom across six decades and requiring that no line's brightness ever jump,
and that no line ever dim as it gains room.

**Everything in the shader is in device pixels**, never world units. A world unit is a bad numeric
neighbourhood once the flock has migrated a few hundred thousand units out: float32 runs out of
mantissa and the lines shimmer. `bandPhase` reduces each decade to an offset within half a spacing
of the camera centre, once per decade per frame, in float64 — so the shader never handles a large
number at all. Pinned by a test at a million units out.

Line coverage is a **box filter rather than a smoothstep**, because it stays honest below one pixel:
a half-pixel line comes out at half brightness instead of being quietly fattened to a full one,
which is what lets fine lines fade out rather than crowd together. The same function now draws the
boids.

The taste calls, all settled by eye against comparison mode. Preset `open`: lines that stay well
apart, a two-decade ramp, axes that barely announce themselves. **Axes and origin are not special
marks** — they are ordinary decade lines turned up slightly, which is why `axisBoost` is a
multiplier and can only say "a bit more than a line at full strength". The origin marker is off: the
origin of an unbounded plane the flock wanders away from carries no meaning worth a heavier mark.
Labels sit on the screen edge and read `1.2k` rather than `1200`. Every losing option stays
reachable — nine presets on the number keys, both label placements and both formats on `l` and `f` —
because 7b looks at all of it again against the finished renderer.

Comparison mode paid for itself immediately in 4a, as predicted, and the machinery is now shared:
`dev/compare.ts` owns the preset list, the selection and the four panes, and the grid and the boids
each point the number keys at their own list.

Text is a second canvas with the 2D context over the WebGL one. A glyph atlas and a layout pass
would buy nothing here, because these few dozen numbers never need to be inside the scene.

### 4a. Design one boid — Collaborate — done

A single large boid on screen, slowly rotating, with its trail. Iterate live until the mark itself
looks right.

This is where these get decided rather than guessed:

- Trail construction: a short ring buffer of recent positions drawn as a fading polyline (curves
  with the path, costs history for 5,000 boids — roughly 16 points each, trivial for a GPU) versus a
  quad stretched along the velocity vector (nearly free, always straight, reads as motion blur)
- Chevron proportions, line weight
- Colour: single cyan-white, or brightness/hue mapped to speed or local density

Needs only the scaffold and a fake velocity, so it can start early — before the simulation is
finished.

Done. The mark is a **chevron found per pixel as a distance field** over one instanced quad, covered
with the same box filter as the grid. That was not one of the options considered; stroking real
geometry was, and it loses on every count — `gl.lineWidth` is capped at 1 on every platform that
matters, so stroke weight would not have been adjustable at all, and glow in 7b is a change to a
number rather than a mesh. Below about 5.6 px of mark the **stroke thins in proportion** instead of
filling it in, so a flock far enough away thins into a texture while every boid still points
somewhere. Direction survives the floor, which CLAUDE.md requires and a fixed stroke would not.

**The ribbon won.** Both trails were built and compared side by side, which is the only reason the
answer is trustworthy — a straight streak looks perfectly good until the boid turns, and then it
points off at a tangent while the boid curves away from it. The streak was then deleted rather than
left behind a flag. The ribbon is threaded through recorded positions and slid back half a mark
along the path, so it leaves the chevron's open back rather than starting at the boid's centre,
which is inside the V. Sliding the whole ribbon and not just its head matters: a boid covers less
ground between captures than half its own length, so insetting the head alone folds the first
segment over.

History is a texture — one column per boid, one row per sample — because a vertex shader cannot
reach per-boid history through attributes: an attribute is indexed by instance or by vertex, never
by both. Each texel is `(x, y, speed, density)`, and capture is tied to **simulation steps, not
frames**, so a trail is a length of time rather than a length of framerate.

Recording speed per sample, rather than colouring the whole trail by what the boid is doing now, is
what makes the trail a history of the flight instead of a shadow of the present. It was not in the
plan and is most of what makes the mark feel alive.

**Colour is speed, through the `signal` scheme.** Density was built too, reads well, and is kept —
as a palette the user switches to in step 5 rather than as the default. Six schemes survive for the
same reason; which one a given person wants is not a thing to settle here.

Neither ramp names a world value. Both are **fractions of a band the simulation reports**, because
both would otherwise go stale without looking stale: retuning speed in 7a, or dragging the count
slider in 4b, would leave the ramp spanning something the flock no longer does, and every boid would
come out the same colour. Speed is exact from the parameters; crowding has no parameter to read, so
`FlockRanges.maxDensity` is estimated as mean plus 1.5 standard deviations over the sample the
camera already needs — one pass, no sort, and measured to land within a point or two of the true
90th percentile from 500 boids to 5,000. It is smoothed over 1.5 s because a band is the divisor of
a colour, and one that twitched would shimmer the whole flock between hues while nothing about the
flock had changed.

Two additions to step 1's contract. `Simulation.densities` carries an omnidirectional neighbour
count — omnidirectional because how crowded it is here is not a directional question, and a density
that dropped when a boid turned would read as flicker. `Simulation.ranges` carries the colour bands,
for the same reason `FlockSample` carries the camera's: only the backend knows what its own numbers
look like.

The design harness is `dev/pose-track.ts`, six specimens on fixed paths, and it is a `Simulation`
rather than a drawing mode — so the real feed, the real history and the real draw calls all run
against it, and a mark that looks right there is not looking right by special arrangement. Its
velocities come from a central difference across the path, so a chevron cannot point somewhere the
boid is not going. PLAN.md asked for one slowly rotating boid; that shows the chevron but says
nothing about the trail, and the trail's whole question is what happens in a turn.

One bug worth recording, because it will recur the moment 7b adds a glow: `pow(0.0, k)` is defined
by the spec but drivers computing it as `exp2(k * log2(x))` return NaN, and a NaN in a vertex output
interpolates across a whole segment and reaches the framebuffer as saturated white. Every `pow`
whose base can reach zero now has a floor under it.

Left open on purpose, for 4b: additive blending has never been seen with a crowd, and at
`separationRadius` 6 against a 5-unit mark the boids fly close enough that trails will cross
constantly. Whether the mark survives that is not a question six specimens can answer.

### 4b. Render five thousand — Review — done

Instancing, buffer plumbing, one draw call.

- Boid size scales with zoom but **clamped to a minimum**, so distant flocks thin into a texture
  while individuals stay visible up close. Not LOD — the same mark throughout — but a departure from
  strictly constant screen size
- The frame-time HUD and a boid-count slider land here, not in step 8, so performance is visible the
  whole way through

Done, and one correction to the above: it is **two** draw calls, the ribbons and then the marks.
Different geometry, not mergeable. Instancing, the buffer plumbing and the minimum-size clamp all
arrived with 4a; what 4b added was capacity for five thousand, a count ladder on `n`/`m`, and the
keys that turn a look into a number — `z` to frame the flock, `t` to drop the trails, `p` to write
the HUD to the console.

**Five thousand boids hold 164.9 fps with 6.1 ms frames on the M1 Max**, which is the plan's second
success criterion met with room to spare. Getting there took no optimization code at all, and that
is the whole story of this step.

The first reading was a cliff rather than a curve: comfortable to 3,500, then 17 fps at 5,000. The
cause is the fixed timestep. The simulation owes 120 steps per second of real time whatever the
display does, so a step has to finish inside 8.33 ms simply to keep up; at 5,000 it took 11.5 ms,
the accumulator ran away to the five-step cap, and a 1.8x cost increase became a 10x frame time
increase. `t` ruled the GPU out immediately — 57.7 ms of a 58.3 ms frame was inside `step`.

The lever was not any of the ones step 8 predicted. Cost scales with how many neighbours each boid
has, and a flock held by a spring packs tighter as it grows, so density rose with count and the
search went quadratic. **Spreading the flock fixes it at the root**: `separationRadius` 6 to 12
dropped the density band from 199 to 43 and the step from 11.5 ms to 4.0 ms, and cost went from
quadratic to near-linear — ten times the boids for nineteen times the work, where it had been forty.
No per-cell cap, no smaller neighbour radius, no 60 Hz timestep.

That the same change was wanted on sight is the part worth keeping. 4a had already noticed the boids
flew nose to tail at a separation of 6 against a five-unit mark; the looks problem and the
performance problem were one problem, and `separationRadius: 12` is now the only value in
`sim/params.ts` that is an answer rather than a starting point.

Blending stays additive, judged against a real crowd. Zooming out turned out to be a way of _making_
light — the mark stops shrinking at its floor while the boids keep converging on screen, so the same
brightness lands in fewer pixels and additive sums it into a white blob. `floorFade` dims a boid by
how far below the floor it should have been, which is the grid's box filter argument applied to a
whole mark: at 1 it dims with length, at 2 with area. 1 by eye. It under-compensates by one power,
so a hard enough zoom-out still blooms — left for 7b rather than chased here.

Two things this step corrected about earlier notes. Step 2 claimed the sandbox benchmarks roughly
15x slower than real hardware on a calibration loop; measured against the M1 Max on the real
workload it is within 30%, so numbers produced here are predictive and were treated as such for the
rest of the step. And step 8's predicted failure — the spatial hash degrading toward O(n^2) as the
flock compresses — did happen, but the fix it names was not needed, because the compression was a
tuning artefact rather than a property of the index.

`dev/readings.ts` outlives the rest of `dev/`. Steps 6, 7a and 8 all ask questions only the user can
answer, and each reading carries the settings it was taken under so a log of them stays honest when
a knob moves between rows.

Left unmeasured: the Ryzen desktop. The expectation is that it is faster on this workload, which is
single-threaded and scalar, but nothing here has checked.

### 5. Controls — Review (panel contents: Collaborate) — done

Parameter panel, zoom input, cursor force.

- **Tweakpane** for now. Good enough for iteration one; replaced in 7b if worth it
- Parameter sets persist to **localStorage**, with **export to console** so the user can paste a set
  to Claude, and a **reset button** that clears storage and reverts to defaults
- **The wheel adjusts framing percentage, not raw zoom**: how much room the flock gets, from ~10%
  (in among individual boids) to ~1000% (a small knot in a vast grid). Multiplicative steps, with a
  readout. Roughly two decades, so the grid handover repeats rather than happening once
- No manual pan, and no follow/override state machine. The camera always centres the flock; zoom is
  a parameter of the framing, not a mode that disengages it
- Cursor force: predator or attractor, radius drawn on the grid

Slider **ranges** matter more than the code — a range that is mostly dead zone makes the simulation
feel broken when it is not. Ranges get revised in 7a, once there is something to tune against.

Done, and PLAN.md is wrong about two of the five bullets above. Both are recorded here rather than
edited away, because finding out what they cost is the useful part.

**The framing percentage does not work without step 6.** It was built exactly as specified — a
percentage of how much room the flock gets, `camera.logScale` derived every frame from it and from
the flock's 85%-quantile reach — and it hunts. The reach moves a little every step, so the scale
moved a little every frame, and the grid, whose whole job is to make a change of scale something you
watch happen, turned that into a permanent shimmer. Nothing was wrong with the measurement, and no
amount of tuning the percentage would have helped: it was the derivation running _continuously_ that
could not work. The missing piece is a band the flock can move inside without the camera reacting at
all, which is step 6's hysteresis. So the idea moves there, and step 5 holds a zoom instead — a
number the camera keeps until the wheel, a key or a fit changes it. `camera/framing.ts` keeps the
quantile, the reach and the fit, called once by `z` rather than every frame, and step 6 inherits
them.

**Manual pan came back, behind a `follow` checkbox.** The second half of that bullet still holds —
nothing ever disengages follow behind your back, so there is no state to be surprised by — but
watching the flock leave turned out to be worth having, and the origin spring means it cannot be
lost for good. `z` and a panel button bring it back: centre and zoom to fit, one shot.

Then the parts that went as planned.

**The panel binds to one settings object and mutates it in place**, so the wheel and the preset keys
write where the panel reads and there is no copy to fall out of step. It is deliberately not
`SimParams`. The cursor is a mode plus a magnitude rather than one signed number, because "off" as a
particular point in the middle of a slider is not a control anyone can find — and `nothing` being a
mode is what turns the ring off as well. The look is preset _names_ plus the overrides on top, never
a resolved style: a saved style would freeze a copy of whatever the preset said that day, and 7b's
retuning would never reach a browser that had one.

**Persistence validates every field on the way in.** The blob comes from a store the user can edit,
from an older build, or from a newer one rolled back, so a `NaN` speed or a preset name that no
longer exists is an ordinary case rather than an attack. Each bad field falls back on its own, so
one of them does not cost the whole set. Storage sits behind an interface for two reasons: the tests
run in node with no DOM, and `localStorage` throws rather than failing quietly in private mode and
wherever site data is blocked — so a refused store degrades to running without persistence instead
of refusing to start.

**The cursor ring is drawn by the grid**, as three uniforms and a `ringCoverage` that the origin
marker now shares — the same colour, the same width, the same box filter, composited by the same
replace. Its radius is in world units, so it grows with the zoom, and since the force's falloff
reaches zero exactly at the rim with nothing leaking past it, the circle is the true boundary rather
than an indication of one. It costs a branch in a shader that was running anyway; a separate pass
would have needed blending turned back on, which `boids.ts` deliberately leaves off.

**`dev/` shrank to what later steps still ask for.** `grid-controls.ts` and `boid-controls.ts` are
gone, and every key the panel absorbed with them. What is left is comparison mode and the readings
log, and `compare.ts` no longer owns a selection — it reads and writes the settings through a
binding, because two places remembering which preset is current is two places to disagree.

**Step 4a's design harness went with them.** `pose-track.ts` said at the top of itself that it was
deleted in step 5; 4a kept it past that, and this is where the claim comes due. It had also quietly
stopped working, which is worth recording because nothing announced it: the specimens fly paths a
couple of hundred world units across while `DESIGN_LOG_SCALE` opens at twenty pixels per unit, so
`d` parked the camera at a path's centre with the boid orbiting five thousand pixels away. In 4a
that was survivable because the wheel and the drag were always live and you zoomed out until you
found it. Step 5 took the camera away inside the harness, and the mismatch became an empty grid. The
paths are sized for watching a trail bend and the zoom for judging a stroke weight, and one zoom
cannot serve both — so if 7b wants specimens again it wants two views, not the one this had.
Deleting it also takes the two-scene machinery out of `app.ts`: the `Scene` interface, the swap, and
the trail re-seed a swap needed.

Slider ranges are wide rather than right. PLAN.md says they are revised in 7a and they have not been
touched since: they are set to find the interesting region, not to live in. One addition alongside
them, a `restart` button next to `spawnRadius`, because that parameter can only bite on a re-seed
and an inert slider is worse than no slider — and 7a wants a seeded restart for A/B anyway.

### 6. Camera behaviour — Collaborate

Auto-follow and auto-zoom, damped.

- **Robust framing**: the tightest region containing ~85% of the flock, so a single straggler cannot
  drag the frame or force a zoom-out
- **Hysteresis, not a dead zone**: the flock moves freely inside a window; once it pushes past an
  edge the camera follows, then holds that position when they turn back, until they have crossed to
  the opposite edge. Same for zoom, with its own tolerance band
- Separate time constants for pan and zoom, zoom noticeably lazier
- **The framing percentage lands here**, not in step 5. A zoom derived continuously from the flock's
  reach shimmers without a tolerance band under it — see step 5. `camera/framing.ts` already has the
  quantile, the reach and the fit; what it is missing is the hysteresis below them

Most likely step to be quietly bad: every piece is easy, the composite is a feel problem. Coupled to
step 3 — camera zoom drives the grid's LOD, so a camera that hunts makes the grid pulse between
decades. The grid can be perfect on its own and still look broken. Judging it means watching both
together.

### 7a. Behaviour tuning — Collaborate

Finding parameter values that genuinely flock. Starts as soon as 4b can draw a crowd, even an ugly
one, and continues throughout — so we learn early whether it flocks rather than discovering it at
the end.

The top success criterion and pure judgement; Claude cannot evaluate it. The machinery that makes
the user's time cheap: seeded starts make A/B fair, saved sets and console export make "this one
felt good" concrete, comparison mode puts four candidates on screen at once. The pattern is _Claude
prepares candidates, the user picks a direction, repeat_ — not the user alone with sliders, not
Claude guessing blind.

### 7b. Visual polish — Collaborate

Colour, line weights, trail falloff, glow, the grid's fade curve, and possibly replacing Tweakpane
with a panel that matches the aesthetic. End of project, against the finished renderer.

### 8. Performance and ship — Solo

Both target machines (M1 Max MacBook Pro, Ryzen 9800X3D desktop) are far above what 5,000 CPU-side
boids needs, so no optimization work is planned unless the HUD from 4b says otherwise. The
predictable failure, if it shows up, is the spatial hash degrading toward O(n^2) when the flock
compresses into one cell — fixed with cell sizing tied to the neighbour radius and a per-cell cap.

Short README: how to run it, what the controls do.

## Sequencing

1 blocks everything. After it, 2 and 4a are independent and 4a only needs a fake velocity, so the
single-boid design can happen while the simulation is being built. 3 needs only the camera model. 4b
needs 2 and 4a. 5 and 6 need 4b. 7a starts the moment 4b draws a crowd and runs alongside 5 and 6.
7b and 8 last.

## Out of scope for iteration one

Obstacles, painted force fields, GPU simulation, deployment, manual panning, zoom-dependent LOD for
the boid mark.

## Open questions

- Tick label format and placement (decided in step 3)
- ~~Trail construction, chevron proportions, colour~~ â decided in 4a: a ribbon through recorded
  positions, a chevron drawn as a distance field, colour by speed with the palette left for the user
  to switch
- Slider ranges (decided in 7a)
- Whether Tweakpane gets replaced (decided in 7b)
