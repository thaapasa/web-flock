import { Camera } from './camera/camera';
import type { Vec2 } from './math/types';
import { createResizingCanvas } from './render/canvas';
import { getContext } from './render/gl';
import { createNullSimulation } from './sim/null-simulation';
import { DEFAULT_SIM_PARAMS } from './sim/params';
import type { SimInput } from './sim/simulation';

/** Seconds per simulation step. 120 Hz, so a 60 fps frame is two steps. */
const FIXED_STEP = 1 / 120;

/**
 * Longest real interval a single frame is allowed to advance the simulation.
 * A backgrounded tab returns with an enormous elapsed time; without this the
 * accumulator would try to catch up and lock the page solid.
 */
const MAX_FRAME_TIME = 0.25;

function main(): void {
  const canvasElement = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvasElement) throw new Error('#canvas is missing from the page');

  const surface = createResizingCanvas(canvasElement);
  const gl = getContext(canvasElement);

  const camera = new Camera({
    logScale: 0,
    viewportWidth: surface.size.width,
    viewportHeight: surface.size.height,
  });

  const simulation = createNullSimulation(gl, {
    capacity: 5000,
    params: DEFAULT_SIM_PARAMS,
    seed: 1,
  });

  const applySize = (): void => {
    const { width, height, deviceWidth, deviceHeight } = surface.size;
    camera.setViewport(width, height);
    gl.viewport(0, 0, deviceWidth, deviceHeight);
  };
  surface.onResize(applySize);
  applySize();

  // Cursor position, tracked in world space so it survives camera movement.
  const cursor: Vec2 = { x: 0, y: 0 };
  let cursorOverCanvas = false;
  canvasElement.addEventListener('pointermove', (event) => {
    const rect = canvasElement.getBoundingClientRect();
    camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, cursor);
    cursorOverCanvas = true;
  });
  canvasElement.addEventListener('pointerleave', () => {
    cursorOverCanvas = false;
  });

  const input: SimInput = { cursor: null };

  gl.clearColor(0, 0, 0, 1);

  let previous = performance.now() / 1000;
  let accumulator = 0;

  const frame = (nowMs: number): void => {
    const now = nowMs / 1000;
    accumulator += Math.min(now - previous, MAX_FRAME_TIME);
    previous = now;

    input.cursor = cursorOverCanvas ? cursor : null;
    while (accumulator >= FIXED_STEP) {
      simulation.step(FIXED_STEP, input);
      accumulator -= FIXED_STEP;
    }

    gl.clear(gl.COLOR_BUFFER_BIT);

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
