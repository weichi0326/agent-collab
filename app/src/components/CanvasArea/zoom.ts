export const ZOOM_MIN = 0.65;
export const ZOOM_MAX = 2.0;
export const DISPLAY_MAX = 200;
export const DEFAULT_ZOOM = toZoom(150);

export function toDisplay(z: number): number {
  return Math.round(((z - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * DISPLAY_MAX);
}

export function toZoom(d: number): number {
  return ZOOM_MIN + (d / DISPLAY_MAX) * (ZOOM_MAX - ZOOM_MIN);
}
