/**
 * Cleanup helper for the retired note colour-pen feature. Bodies were stored
 * as plain text with light `{{r}}…{{/}}` markers; pens are gone, so any
 * markers left in saved notes are stripped on load and stripped again before
 * sharing, keeping note bodies plain text forever.
 */

const MARKER_RE = /\{\{(?:[rogpbk])\}\}|\{\{\/\}\}/g;

export function stripNoteMarkup(text: string): string {
  return text.replace(MARKER_RE, '');
}
