# web-flock: plan for iteration one

Where the project is going, and where it has got to. README.md says how to run it and what the
controls do. ARCHITECTURE.md says how the pieces fit and why. Neither belongs here: an
implementation note in a plan is out of date by the time the step that needs it starts.

## Goal

A flocking simulator in the browser that is worth looking at. Visual impact over simulation
accuracy. See CLAUDE.md for the visual and technical direction.

## What success looks like

A stranger opens the page, and within ten seconds they want to keep playing with it. Five things
have to be true:

1. **It flocks.** Sub-flocks form, split, stretch around each other and merge again. Not a uniform
   drifting cloud, and not a jittery ball. This is the hardest criterion, and no amount of visual
   polish makes up for failing it.
2. **It is smooth.** 5,000 boids hold a locked 60 fps, with no hitching when the flock compresses.
   Frame time is on screen, so the user can check the claim instead of taking it.
3. **The grid shows the scale changing.** Scrolling the wheel brings finer lines out of black and
   dissolves coarse ones, with no pop where one decade hands over to the next. If only one thing is
   polished, it is this.
4. **The cursor pushes the flock around.** Moving the mouse through the flock scatters it at once,
   and the boids visibly re-form behind the cursor.
5. **Every slider changes something the user can see**, within a second or two of the drag.

One more thing, which is not a feature: the page stays interesting when nobody touches it. The flock
migrates, the camera follows, the coordinates climb and the grid shifts scale.

## How we work

Three modes per step. **Solo**: Claude implements, and nobody reviews the result. **Review**: Claude
implements, and the user checks it. **Collaborate**: a tight loop, with the user watching during the
work rather than after it.

Aesthetic judgement decides the mode. Mechanical work is Solo or Review, and anything judged by eye
is Collaborate.

Claude has no browser in the sandbox, so it cannot see the running app or measure performance. The
user answers every visual and performance question. That is the cheaper arrangement while the user
works alongside Claude rather than leaving it to run overnight: a look at the screen costs a couple
of seconds, against tens of seconds for a screenshot round trip.

## Steps

### 1. Foundation and contracts (Solo, done)

Scaffold, camera model, a thin GL helper, and the `step(dt)` seam a later GPU backend has to drop
into.

The seam came out as two interfaces rather than one, because a simulation that handed back typed
arrays would force a GPU backend to read its own results back off the GPU.

### 2. Simulation core (Solo, done)

Typed arrays, a spatial hash, the three rules, field of view, a turn-rate limit, and a weak pull
toward the origin. Fixed timestep and a seeded start.

Correctness only. Whether it looks like a flock is step 7a, and a neighbour-lookup bug does not
crash, it only makes the flock mushy, so we would have spent 7a tuning around it.

### 3. The grid (Collaborate, labels Review, done)

The adaptive axis grid, its tick labels and the coordinate readout.

Comparison mode was built here, and it earns its place again in every step that is settled by eye:
four variants of the same view in one frame, one look to choose from.

The taste calls are settled, and every option that lost is still reachable from a preset, because 7b
looks at all of them again against the finished renderer.

### 4a. Design one boid (Collaborate, done)

One large boid with its trail, iterated live until the mark looked right.

Both trail constructions were built and compared, which is the only reason to trust the answer. The
ribbon won and the streak was deleted rather than left behind a flag.

### 4b. Render five thousand (Review, done)

Instancing, buffer plumbing, and the frame-time HUD, which lands here rather than in step 8 so that
performance is visible the whole way through.

Five thousand boids hold well above 60 fps on the M1 Max, which meets the second success criterion.
It took no optimization code. The first reading was far short of it, and the fix was to spread the
flock out, which step 4a had wanted by eye anyway: the looks problem and the performance problem
were one problem. Step 8's predicted fix was not needed.

The Ryzen desktop is still unmeasured.

### 5. Controls (Review, panel contents Collaborate, done)

Parameter panel, persistence, zoom input, and the cursor force with its radius drawn on the grid.

Two things in this plan turned out to be wrong. **The framing percentage moved to step 6**, because
a zoom derived continuously from the flock's spread hunts, and the tolerance band it needs under it
is step 6's. **Manual pan came back**, behind a `follow` checkbox, because watching the flock leave
is worth having and the origin spring means it cannot be lost for good. Nothing turns follow off
without the user asking, so the state machine this plan rules out is still ruled out.

Slider ranges are wide rather than right, as planned. Step 4a's design harness was deleted here, as
it said it would be.

### 6. Camera behaviour (Collaborate)

Auto-follow and auto-zoom that are comfortable to watch: robust framing that one straggler cannot
drag, hysteresis so the flock moves freely inside a window before the camera reacts, and damping
that makes both feel even. The framing percentage from step 5 lands here.

This is the step most likely to come out subtly wrong. Every piece is easy, and the combination is a
feel problem. It is coupled to the grid, because a camera that hunts makes the grid pulse between
decades, so the grid can be correct on its own and still look broken. Judging it means watching both
together.

### 7a. Behaviour tuning (Collaborate)

Find parameter values that genuinely flock. This is the first success criterion and pure judgement,
so Claude cannot evaluate it.

The pattern is that Claude prepares candidates, the user picks a direction, and we repeat. Not the
user alone with sliders, and not Claude guessing blind. Seeded starts, saved sets and comparison
mode are already there to make that cheap.

Slider ranges get revised here, once there is something to tune against. A range that is mostly dead
zone makes the simulation feel broken when it is not.

### 7b. Visual polish (Collaborate)

Colour, line weights, trail falloff, glow, the grid's fade curve, and possibly a replacement for
Tweakpane that matches the aesthetic. Against the finished renderer, so it comes last.

The development tools go when this ends, and the taste calls it settles can be cut down to the
presets that won.

### 8. Performance and ship (Solo)

Both target machines are far above what 5,000 CPU-side boids need, so there is no optimization work
planned unless the HUD asks for it.

What is left is measuring the Ryzen desktop, and a last pass over README.md and ARCHITECTURE.md
against what the project turned out to be.

## Sequencing

Steps 1 to 5 are done. Step 6 and step 7a are independent of each other and can run in either order
or together. Steps 7b and 8 come last, because both judge the finished thing.

## Out of scope for iteration one

Obstacles, painted force fields, GPU simulation, deployment, and zoom-dependent LOD for the boid
mark.

## Open questions

- ~~Tick label format and placement~~, decided in step 3
- ~~Trail construction, chevron proportions, colour~~, decided in step 4a
- Slider ranges, to be decided in step 7a
- Whether Tweakpane gets replaced, to be decided in step 7b
