export interface CanvasSize {
  /** CSS pixels. Pointer coordinates are in this space. */
  readonly width: number;
  readonly height: number;
  /** Device pixels. The drawing buffer is this size. */
  readonly deviceWidth: number;
  readonly deviceHeight: number;
  readonly pixelRatio: number;
}

export interface ResizingCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly size: CanvasSize;
  /** Called after the drawing buffer has been resized. */
  onResize(listener: (size: CanvasSize) => void): () => void;
  dispose(): void;
}

/**
 * Keeps the canvas drawing buffer the size of its CSS box. Prefers the exact
 * device-pixel box where the browser reports one, which avoids the rounding
 * seam from multiplying a CSS size by a fractional `devicePixelRatio`.
 */
export function createResizingCanvas(canvas: HTMLCanvasElement): ResizingCanvas {
  const listeners = new Set<(size: CanvasSize) => void>();

  let size: CanvasSize = measureFromClientRect(canvas);

  const apply = (next: CanvasSize): void => {
    if (
      next.deviceWidth === canvas.width &&
      next.deviceHeight === canvas.height &&
      next.width === size.width &&
      next.height === size.height &&
      next.pixelRatio === size.pixelRatio
    ) {
      return;
    }
    size = next;
    canvas.width = next.deviceWidth;
    canvas.height = next.deviceHeight;
    for (const listener of listeners) listener(next);
  };

  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    apply(entry ? measureFromEntry(entry, canvas) : measureFromClientRect(canvas));
  });
  observer.observe(canvas, { box: 'content-box' });

  // ResizeObserver does not fire when only devicePixelRatio changes, which it
  // does when the window moves to a display with a different scale. The query
  // matches the current ratio exactly, so it stops matching as soon as the
  // ratio changes, and it has to be re-armed after each change.
  let ratioQuery: MediaQueryList | undefined;
  const watchPixelRatio = (): void => {
    ratioQuery?.removeEventListener('change', onRatioChange);
    ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    ratioQuery.addEventListener('change', onRatioChange);
  };
  function onRatioChange(): void {
    apply(measureFromClientRect(canvas));
    watchPixelRatio();
  }
  watchPixelRatio();

  apply(measureFromClientRect(canvas));

  return {
    canvas,
    get size() {
      return size;
    },
    onResize(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      observer.disconnect();
      ratioQuery?.removeEventListener('change', onRatioChange);
      listeners.clear();
    },
  };
}

function measureFromClientRect(canvas: HTMLCanvasElement): CanvasSize {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  return {
    width,
    height,
    deviceWidth: Math.max(1, Math.round(width * pixelRatio)),
    deviceHeight: Math.max(1, Math.round(height * pixelRatio)),
    pixelRatio,
  };
}

function measureFromEntry(entry: ResizeObserverEntry, canvas: HTMLCanvasElement): CanvasSize {
  const devicePixelBox = entry.devicePixelContentBoxSize?.[0];
  const contentBox = entry.contentBoxSize?.[0];
  if (!devicePixelBox || !contentBox) return measureFromClientRect(canvas);

  const width = Math.max(1, contentBox.inlineSize);
  const height = Math.max(1, contentBox.blockSize);
  const deviceWidth = Math.max(1, devicePixelBox.inlineSize);
  const deviceHeight = Math.max(1, devicePixelBox.blockSize);
  return { width, height, deviceWidth, deviceHeight, pixelRatio: deviceWidth / width };
}
