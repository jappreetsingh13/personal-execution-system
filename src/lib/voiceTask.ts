/**
 * Voice → task parsing. Deliberately small and forgiving: the transcript fills
 * the form, and every parsed field stays editable on the task afterwards.
 */

import type { DateKey } from '@/types';
import { addDays, todayKey } from './date';

export type ParsedTask = {
  title: string;
  /** Minutes past local midnight; null when nothing time-like was heard. */
  minutes: number | null;
  dateKey: DateKey;
};

/**
 * Strip the command words people naturally say first, so they don't end up in
 * the title.
 */
const LEAD_INS: RegExp[] = [
  /^(?:hey\s+)?(?:please\s+)?(?:add|create|make|new)\s+(?:a\s+)?(?:new\s+)?task(?:\s+(?:called|named|to|for))?\s*[:,]?\s*/i,
  /^(?:hey\s+)?(?:please\s+)?remind\s+me\s+(?:to|about|that)?\s*/i,
  /^(?:hey\s+)?(?:please\s+)?remember\s+to\s*/i,
  /^(?:i\s+)?need\s+to\s*/i,
  /^(?:i\s+)?want\s+to\s*/i,
  /^(?:lets?\s+|let\s+me\s+)?(?:todo|to-do)\s*[:,]?\s*/i,
];

const DAY_WORDS: RegExp[] = [/\btomorrow\b/i, /\btoday\b/i];

/** "at 5", "at 5:30", "at 6 pm", "5 30 pm", "11 am". */
const TIME_RE =
  /\b(?:at\s+)?(\d{1,2})(?::|\s)?(\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\b/i;

function stripMeridiemDots(s: string): string {
  return s.replace(/[.\s]/g, '').toLowerCase();
}

export function parseTaskFromSpeech(raw: string): ParsedTask {
  let text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return { title: '', minutes: null, dateKey: todayKey() };

  for (const re of LEAD_INS) text = text.replace(re, '');

  let dateKey = todayKey();
  if (/\btomorrow\b/i.test(text)) {
    dateKey = addDays(todayKey(), 1);
  }

  let minutes: number | null = null;
  const match = text.match(TIME_RE);
  if (match) {
    const hour = Number(match[1]);
    const min = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3] ? stripMeridiemDots(match[3]) : null;
    const valid = hour >= 0 && hour <= 23 && min <= 59;
    if (valid && (match[3] || match[0].match(/\bat\b/i) || /:\d{2}/.test(match[0]))) {
      let h24 = hour % 24;
      if (meridiem === 'pm' && hour < 12) h24 = hour + 12;
      else if (meridiem === 'am' && hour === 12) h24 = 0;
      else if (!meridiem) {
        // "call mum at 5" almost always means the evening, not dawn.
        if (hour < 8) h24 = hour + 12;
      }
      minutes = h24 * 60 + min;
    }
  }

  // Remove the time and day phrases from the title.
  if (match) text = text.replace(match[0], ' ');
  text = text.replace(/\b(?:tomorrow|today)\b/gi, ' ');
  text = text.replace(/\b(?:at|on|by|from)\s*$/i, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > 0) text = text[0].toUpperCase() + text.slice(1);

  return { title: text, minutes, dateKey };
}
