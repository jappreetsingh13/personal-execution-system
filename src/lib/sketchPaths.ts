import { Skia, type SkPath } from '@shopify/react-native-skia';
import type { SketchPaper, SketchStroke } from '@/types';
import { PAPER_STEP } from './sketchGeom';

/**
 * Skia path building for the sketch page.
 *
 * Split from sketchGeom.ts so that the coordinate maths there stays a plain
 * TypeScript module with no native dependency, and can therefore be run and
 * checked without a device.
 */


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
