/**
 * The sketch tab's six pen colours. Fixed, saturated hues chosen to stay
 * readable on every theme (light paper and near-black paper alike) and on
 * every stroke width.
 */

export type SketchPenKey = 'r' | 'o' | 'g' | 'b' | 'p' | 'k';

export const SKETCH_PENS: { key: SketchPenKey; color: string; label: string }[] = [
  { key: 'r', color: '#E5484D', label: 'Red' },
  { key: 'o', color: '#E8871E', label: 'Orange' },
  { key: 'g', color: '#30A46C', label: 'Green' },
  { key: 'b', color: '#3B7FE8', label: 'Blue' },
  { key: 'p', color: '#8E4EC6', label: 'Purple' },
  { key: 'k', color: '#D6409F', label: 'Pink' },
];
