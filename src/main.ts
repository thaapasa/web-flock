import { createApp } from './app';

function canvas(id: string): HTMLCanvasElement {
  const element = document.querySelector<HTMLCanvasElement>(`#${id}`);
  if (!element) throw new Error(`#${id} is missing from the page`);
  return element;
}

createApp(canvas('scene'), canvas('overlay')).start();
