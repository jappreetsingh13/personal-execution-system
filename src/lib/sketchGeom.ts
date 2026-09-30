import type { SketchImage, SketchStroke } from '@/types';

/**
 * Geometry for the sketch page: hit testing and the maths that maps between
 * screen pixels and page units.
 *
 * Deliberately free of any Skia or React Native import, for two reasons. The
 * gesture code reads as intent rather than arithmetic; and the one thing that
 * silently ruins a drawing app — a coordinate conversion that disagrees with the
 * transform actually rendered — lives in exactly one place that can be executed
 * and checked on its own. See `toPage`/`toScreen`: they are inverses of the
 * `[translateX, translateY, scale]` transform the Skia <Group> is given, in that
 * order. Skia path building lives next door in sketchPaths.ts.
 */

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 6;

/** Spacing of ruled lines, grid squares and dots, in page units. */
export const PAPER_STEP = 72;

/** How close to the bottom edge a stroke may end before the page grows. */
export const GROW_MARGIN = 280;
/** How much taller the page gets each time. Roughly another screenful. */
export const GROW_BY = 1080;

/** Screen-space size of the resize grip, so it stays grabbable at any zoom. */
export const HANDLE_SIZE = 26;
export const HANDLE_TOUCH = 34;

export type Viewport = { width: number; height: number };
export type Transform = { tx: number; ty: number; scale: number };

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

// ---------------------------------------------------------------------------
// Screen <-> page
// ---------------------------------------------------------------------------

/** Screen point -> page point. Inverse of the rendered transform. */
export function toPage(x: number, y: number, t: Transform): { x: number; y: number } {
  return { x: (x - t.tx) / t.scale, y: (y - t.ty) / t.scale };
}

/** Page point -> screen point. */
export function toScreen(x: number, y: number, t: Transform): { x: number; y: number } {
  return { x: x * t.scale + t.tx, y: y * t.scale + t.ty };
}

/**
 * Keep the page in view: centred on an axis while it is smaller than the
 * viewport, and otherwise never dragged past its own edges. Without this the
 * page can be flung off-screen and there is no way back to it.
 */
export function clampTranslate(
  t: Transform,
  pageW: number,
  pageH: number,
  view: Viewport,
): Transform {
  const contentW = pageW * t.scale;
  const contentH = pageH * t.scale;
  const tx =
    contentW <= view.width ? (view.width - contentW) / 2 : clamp(t.tx, view.width - contentW, 0);
  const ty =
    contentH <= view.height
      ? (view.height - contentH) / 2
      : clamp(t.ty, view.height - contentH, 0);
  return { tx, ty, scale: t.scale };
}

/** The scale at which the page's width exactly fills the viewport. */
export function fitScale(pageW: number, view: Viewport): number {
  if (!view.width || !pageW) return 1;
  return clamp(view.width / pageW, MIN_SCALE, MAX_SCALE);
}

/** Zoom about a fixed screen point, so the pixel under the fingers stays put. */
export function zoomAbout(
  t: Transform,
  nextScale: number,
  focalX: number,
  focalY: number,
): Transform {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const k = scale / t.scale;
  return {
    scale,
    tx: focalX - (focalX - t.tx) * k,
    ty: focalY - (focalY - t.ty) * k,
  };
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/** Topmost image containing a page point. Later images draw on top, so search back to front. */
export function imageAt(images: SketchImage[], x: number, y: number): SketchImage | null {
  for (let i = images.length - 1; i >= 0; i -= 1) {
    const img = images[i];
    if (x >= img.x && x <= img.x + img.width && y >= img.y && y <= img.y + img.height) return img;
  }
  return null;
}

/**
 * Is a *screen* point on the selected image's resize grip? Tested in screen
 * space on purpose: the grip is a fixed number of pixels, so at 4x zoom it must
 * not become a 4x-larger target in page units.
 */
export function onResizeHandle(
  img: SketchImage,
  screenX: number,
  screenY: number,
  t: Transform,
): boolean {
  const corner = toScreen(img.x + img.width, img.y + img.height, t);
  return (
    Math.abs(screenX - corner.x) <= HANDLE_TOUCH && Math.abs(screenY - corner.y) <= HANDLE_TOUCH
  );
}

/** The furthest-down point a stroke reaches, for deciding whether the page grows. */
export function strokeBottom(s: SketchStroke): number {
  if (s.kind === 'pen') return (s.points ?? []).reduce((m, pt) => Math.max(m, pt.y), 0);
  return Math.max(s.y0 ?? 0, s.y1 ?? 0);
}
