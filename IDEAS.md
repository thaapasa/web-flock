# Ideas

What could come next, and the problems that are known but not fixed. Nothing here is planned yet.

## Known problems

### A linear origin pull gathers every sub-flock into one ring

A boid circling under the pull settles at a radius of `v/√k` and turns at `√k`, whatever its speed.
Every sub-flock then turns at the same angular rate, and they lock into phase with each other. The
presets that stay interesting either fly fast enough to overcome the pull, or pull so weakly that
one lap takes minutes.

A pull of constant magnitude beyond some radius would prevent this, because the angular rate would
then depend on speed.

### The classic separation rule saturates

The summed `1/d` vector is normalised before it is used for steering. It therefore pushes no harder
as the flock gets more crowded, and it shares the force cap with cohesion. Deep inside a clump the
terms also cancel out.

Crowd pressure replaces this rule and is on by default, so this only matters with pressure set to 0.
See the crowd pressure section in [ARCHITECTURE.md](ARCHITECTURE.md).

## Features

- **Obstacles** that the flock steers around.
- **Painted force fields**: the user paints areas that push or pull the flock.
- **GPU simulation**, for boid counts well past what the CPU can step. It needs WebGPU for both the
  simulation and the renderer. [ARCHITECTURE.md](ARCHITECTURE.md) describes how to switch.
- **A boid shape that changes with zoom**: fewer strokes when the mark is small, more detail when it
  is large.
- **Screen-space bloom instead of the per-boid glow.** The current glow costs more as you zoom in. A
  bloom pass would blur a chain of smaller copies of the boid layer, choose the copy that matches
  the glow radius at the current zoom, and add it back on top. Its cost would depend only on the
  screen size. The glow strength would need scaling with the radius, because a wider blur spreads
  the same light thinner. The boid layer would need a half-float texture, so that dense areas do not
  clip to white before the blur.
