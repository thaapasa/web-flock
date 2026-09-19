import { createApp } from './app';

const canvasElement = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvasElement) throw new Error('#canvas is missing from the page');

createApp(canvasElement).start();
