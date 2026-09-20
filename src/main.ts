import { createApp } from './app';

function element<T extends HTMLElement>(id: string): T {
  const found = document.querySelector<T>(`#${id}`);
  if (!found) throw new Error(`#${id} is missing from the page`);
  return found;
}

createApp(
  element<HTMLCanvasElement>('scene'),
  element<HTMLCanvasElement>('overlay'),
  element('panel'),
).start();
