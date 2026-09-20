/**
 * Rolling frame timings, for the HUD.
 *
 * PLAN.md puts this in step 4b so that performance is visible the whole way
 * through rather than measured at the end. It arrives a step early because the
 * simulation turned out to get slower the longer it runs, and an unmeasured
 * frame rate is an argument rather than a fact.
 *
 * Both a mean and a worst case, because they answer different questions. The
 * mean says whether there is headroom; the worst frame in the last second is
 * the only thing that shows a hitch, which a mean over the same window hides
 * completely.
 */

export interface FrameStats {
  /** Frames per second, from the mean frame interval. */
  readonly fps: number;
  /** Mean milliseconds between frames. */
  readonly frameMs: number;
  /** Slowest single frame in the window. A hitch shows up here and nowhere else. */
  readonly worstFrameMs: number;
  /** Mean milliseconds of CPU spent inside `simulation.step`. */
  readonly simMs: number;
  /** Simulation steps run on the last frame. */
  readonly steps: number;
  /** True when the accumulator had to drop time to avoid spiralling. */
  readonly behind: boolean;
}

export interface FrameStatsRecorder {
  record(frameMs: number, simMs: number, steps: number, behind: boolean): void;
  readonly current: FrameStats;
}

/** Frames averaged over. About a second at 60fps: steady, still responsive. */
const DEFAULT_WINDOW = 60;

export function createFrameStats(windowSize = DEFAULT_WINDOW): FrameStatsRecorder {
  const size = Math.max(1, Math.floor(windowSize));
  const frameTimes = new Float64Array(size);
  const simTimes = new Float64Array(size);
  let cursor = 0;
  let filled = 0;
  let frameSum = 0;
  let simSum = 0;

  const stats = {
    fps: 0,
    frameMs: 0,
    worstFrameMs: 0,
    simMs: 0,
    steps: 0,
    behind: false,
  };

  return {
    record(frameMs, simMs, steps, behind): void {
      frameSum += frameMs - frameTimes[cursor];
      simSum += simMs - simTimes[cursor];
      frameTimes[cursor] = frameMs;
      simTimes[cursor] = simMs;
      cursor = (cursor + 1) % size;
      if (filled < size) filled++;

      let worst = 0;
      for (let i = 0; i < filled; i++) if (frameTimes[i] > worst) worst = frameTimes[i];

      const meanFrame = frameSum / filled;
      stats.frameMs = meanFrame;
      stats.fps = meanFrame > 0 ? 1000 / meanFrame : 0;
      stats.worstFrameMs = worst;
      stats.simMs = simSum / filled;
      stats.steps = steps;
      stats.behind = behind;
    },

    current: stats,
  };
}
