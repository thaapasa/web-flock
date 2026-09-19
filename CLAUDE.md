# web-flock

A flocking simulator that runs in the browser. The goal is visual impact, not simulation accuracy:
it should look good and feel alive, and let the user push it around.

## Direction

Black background, line art, a techy/mathematical look rather than a naturalistic one. Boids are
stroked chevrons with velocity trails — direction must always be readable.

The adaptive axis grid is the signature feature, not decoration. Line spacing fades in and out per
decade as you zoom, so the current scale is always visible and a change of scale is something you
watch happen.

The world is an unbounded plane with a weak pull toward the origin: the flock should genuinely
migrate without ever escaping for good. The camera follows it by default so it cannot be lost.

## Technical

Vite + TypeScript, yarn, WebGL2 with a thin wrapper — no engine.

The simulation is CPU-side over typed arrays with a spatial hash, targeting ~5k boids. It sits
behind a narrow `step(dt)` interface so a GPU backend can replace it later without touching
rendering or UI. Keep that seam clean.

Parameters are tuned live, so anything the user can change must take effect without a restart.

## Git

Never commit on your own initiative. The user decides when to commit, and whether a change is a new
commit or an amend to the previous one. Never push or pull from remotes.

A request to commit authorizes that one commit, or the single batch of work it names — not the rest
of the session. Ask again after that.

## Commit messages

No conventional-commit prefixes. Subject in sentence case. No `Co-Authored-By` or other AI
attribution trailers.

Keep messages short. The diff already shows what changed and how — use the body only when there is a
reason worth recording, and leave it out otherwise.
