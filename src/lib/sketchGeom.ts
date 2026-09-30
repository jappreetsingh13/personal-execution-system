import { Skia, type SkPath } from '@shopify/react-native-skia';
import type { SketchImage, SketchPaper, SketchStroke } from '@/types';

/**
 * Pure geometry for the sketch page: path building, hit testing, and the maths
 * that maps between screen pixels and page units.
 *
 * Kept out of the screen so the gesture code reads as intent rather than
 * arithmetic, and so the one thing that silently ruins a drawing app — a
 * coordinate conversion that disagrees with the transform actually rendered —
 * lives in exactly one place. See `toPage`/`toScreen`: they are inverses of the
 * `[translate, scale]` transform the Skia <Group> is given, in that order.
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
// Paths
// ---------------------------------------------------------------------------

export function strokeToPath(s: SketchStroke): SkPath | null {
  const p = Skia.Path.Make();
  if (s.kind === 'pen') {
    const pts = s.points ?? [];
    if (pts.length === 0) return null;
    p.moveTo(pts[0].x, pts[0].y);
    // A single point still has to show up, or a tap with the pen draws nothing.
    if (pts.length === 1) p.lineTo(pts[0].x + 0.01, pts[0].y);
    else for (let i = 1; i < pts.length; i += 1) p.lineTo(pts[i].x, pts[i].y);
    return p;
  }
  if (s.x0 == null || s.y0 == null || s.x1 == null || s.y1 == null) return null;
  const { x0, y0, x1, y1 } = s;
  if (s.kind === 'line' || s.kind === 'arrow') {
    p.moveTo(x0, y0);
    p.lineTo(x1, y1);
    if (s.kind === 'arrow') {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(14, s.size * 3.2);
      p.moveTo(x1, y1);
      p.lineTo(x1 - head * Math.cos(ang - 0.45), y1 - head * Math.sin(ang - 0.45));
      p.moveTo(x1, y1);
      p.lineTo(x1 - head * Math.cos(ang + 0.45), y1 - head * Math.sin(ang + 0.45));
    }
    return p;
  }
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const w = Math.max(Math.abs(x1 - x0), 1);
  const h = Math.max(Math.abs(y1 - y0), 1);
  if (s.kind === 'rect') {
    p.addRect(Skia.XYWHRect(left, top, w, h));
    return p;
  }
  if (s.kind === 'ellipse') {
    p.addOval(Skia.XYWHRect(left, top, w, h));
    return p;
  }
  return null;
}

/**
 * The page ruling, as one stroked path.
 *
 * Dots are zero-length segments rather than circles: stroked with a round cap
 * they render as dots, and that keeps all four paper styles to one path type and
 * one draw call instead of hundreds of ovals.
 */
export function paperPath(paper: SketchPaper, pageW: number, pageH: number): SkPath | null {
  if (paper === 'plain') return null;
  const p = Skia.Path.Make();

  if (paper === 'dots') {
    for (let y = PAPER_STEP; y < pageH; y += PAPER_STEP) {
      for (let x = PAPER_STEP; x < pageW; x += PAPER_STEP) {
        p.moveTo(x, y);
        p.lineTo(x + 0.01, y);
      }
    }
    return p;
  }

  for (let y = PAPER_STEP; y < pageH; y += PAPER_STEP) {
    p.moveTo(0, y);
    p.lineTo(pageW, y);
  }
  if (paper === 'grid') {
    for (let x = PAPER_STEP; x < pageW; x += PAPER_STEP) {
      p.moveTo(x, 0);
      p.lineTo(x, pageH);
    }
  }
  return p;
}

/** Stroke width and cap the ruling is drawn with, per style. */
export function paperStroke(paper: SketchPaper): { width: number; round: boolean } {
  return paper === 'dots' ? { width: 4, round: true } : { width: 1.25, round: false };
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
