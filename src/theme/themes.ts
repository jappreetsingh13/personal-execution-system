import type { Importance, TaskStatus, ThemeName } from '@/types';

export type Theme = {
  name: ThemeName;
  label: string;
  /** Drives the status bar and native keyboard appearance. */
  dark: boolean;
  bg: string;
  surface: string;
  /** Raised surface: cards on top of cards, sheets, inputs. */
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  /** Text/icon colour that sits legibly on `accent`. */
  onAccent: string;
  tabActive: string;
  tabInactive: string;
  danger: string;
  /** Two-colour swatch used by the theme picker cards in Settings. */
  swatch: [string, string];
};

export const THEMES: Record<ThemeName, Theme> = {
  blossom: {
    name: 'blossom',
    label: 'Blossom',
    dark: false,
    bg: '#FFF7FA',
    surface: '#FFFFFF',
    surfaceAlt: '#FDEDF3',
    border: '#F6D6E2',
    text: '#2E1F26',
    textDim: '#7A6470',
    textFaint: '#AE9AA4',
    accent: '#E8639B',
    onAccent: '#FFFFFF',
    tabActive: '#E8639B',
    tabInactive: '#BCA3AF',
    danger: '#D8345F',
    swatch: ['#FFFFFF', '#F7B8D0'],
  },
  midnight: {
    name: 'midnight',
    label: 'Midnight',
    dark: true,
    bg: '#0E0B16',
    surface: '#1A1526',
    surfaceAlt: '#241C36',
    border: '#342A4D',
    text: '#F2EDFF',
    textDim: '#A99CC7',
    textFaint: '#6F6490',
    accent: '#A46BFF',
    onAccent: '#FFFFFF',
    tabActive: '#BD93FF',
    tabInactive: '#6F6490',
    danger: '#FF6B8A',
    swatch: ['#8A5CF6', '#0E0B16'],
  },
  // Replaces the old neon-on-black "Matrix": high-chroma green on near-black
  // read as harsh and dated. This is a soft slate-and-teal dark instead —
  // lower contrast on the chrome, warm accent, easy at night.
  harbor: {
    name: 'harbor',
    label: 'Harbor',
    dark: true,
    bg: '#0B1220',
    surface: '#141D2E',
    surfaceAlt: '#1C283C',
    border: '#293650',
    text: '#E8EEF9',
    textDim: '#97A7C0',
    textFaint: '#63748F',
    accent: '#38BDB4',
    onAccent: '#04231F',
    tabActive: '#4FD1C5',
    tabInactive: '#63748F',
    danger: '#F2778A',
    swatch: ['#0B1220', '#38BDB4'],
  },
  daylight: {
    name: 'daylight',
    label: 'Daylight',
    dark: false,
    bg: '#F5FAFF',
    surface: '#FFFFFF',
    surfaceAlt: '#E8F3FE',
    border: '#CFE4F7',
    text: '#10202E',
    textDim: '#5A7288',
    textFaint: '#93A9BC',
    accent: '#2C86D8',
    onAccent: '#FFFFFF',
    tabActive: '#2C86D8',
    tabInactive: '#9DB2C4',
    danger: '#DC4A4A',
    swatch: ['#FFFFFF', '#9CCBF5'],
  },
};

export const THEME_LIST = Object.values(THEMES);

/**
 * The 5 importance marks. Index 0 is unused so `IMPORTANCE_COLORS[n]` reads
 * naturally for n in 1..5.
 */
export const IMPORTANCE_COLORS: Record<Importance, string> = {
  1: '#8E9AAF', // none / lowest
  2: '#4CAF82', // low
  3: '#E5B93C', // medium
  4: '#F0813C', // high
  5: '#E2444D', // critical
};

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  1: 'None',
  2: 'Low',
  3: 'Medium',
  4: 'High',
  5: 'Critical',
};

export const IMPORTANCE_VALUES: Importance[] = [1, 2, 3, 4, 5];

/** Status colours — shared by the Tasks rows, the segmented bar and the drill-down. */
export const STATUS_COLORS: Record<TaskStatus, string> = {
  done: '#3BAA6E',
  in_progress: '#3B87D8',
  not_started: '#9AA4B2',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  done: 'Done',
  in_progress: 'In Progress',
  not_started: 'Not Started',
};

/** Fixed display order for the bar segments and the 3 filter buttons. */
export const STATUS_ORDER: TaskStatus[] = ['done', 'in_progress', 'not_started'];

/** Overdue is a flag, not a bucket — it only ever tints an existing row. */
export const OVERDUE_COLOR = '#E2724D';
