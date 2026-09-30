import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Importance, Sketch, SketchPaper, SketchStroke, SketchImage } from '@/types';
import { makeId } from '@/lib/id';
import { deleteAttachmentUris } from '@/lib/attachments';

/**
 * The page every sketch made before the page became resizable was drawn on.
 * Migrations must use exactly this, or old strokes land in the wrong place.
 */
export const LEGACY_PAGE_W = 1080;
export const LEGACY_PAGE_H = 1620;

/** A fresh page: same width, twice the height, because you scroll down as you write. */
export const DEFAULT_PAGE_W = 1080;
export const DEFAULT_PAGE_H = 3240;

export type SketchDraft = {
  title: string;
  strokes: SketchStroke[];
  images: SketchImage[];
  paper: SketchPaper;
  pageW: number;
  pageH: number;
  importance: Importance;
  linkedNoteIds: string[];
  linkedTaskIds: string[];
};

type SketchesState = {
  sketches: Record<string, Sketch>;
  hydrated: boolean;

  addSketch: (draft: SketchDraft) => string;
  updateSketch: (id: string, patch: Partial<SketchDraft> & { pinned?: boolean }) => void;
  deleteSketch: (id: string) => void;
  togglePinned: (id: string) => void;
  setHydrated: () => void;
};

/**
 * Defensive coercion on load, plus defaults for the fields added when the page
 * gained zoom, ruling and a variable size.
 *
 * Sketches written before that have no `pageW`/`pageH`, and their strokes are in
 * the old fixed 1080x1620 space — so they must migrate to *those* numbers rather
 * than to the new default page, or every existing drawing would be stranded in
 * the top-left corner of a much bigger sheet.
 */
function migrateSketch(raw: unknown): Sketch {
  const s = raw as Sketch;
  return {
    ...s,
    strokes: Array.isArray(s.strokes) ? s.strokes : [],
    images: Array.isArray(s.images) ? s.images : [],
    linkedNoteIds: Array.isArray(s.linkedNoteIds) ? s.linkedNoteIds : [],
    linkedTaskIds: Array.isArray(s.linkedTaskIds) ? s.linkedTaskIds : [],
    paper: s.paper ?? 'plain',
    pageW: typeof s.pageW === 'number' && s.pageW > 0 ? s.pageW : LEGACY_PAGE_W,
    pageH: typeof s.pageH === 'number' && s.pageH > 0 ? s.pageH : LEGACY_PAGE_H,
    importance: s.importance ?? 3,
  };
}

export const useSketchesStore = create<SketchesState>()(
  persist(
    (set) => ({
      sketches: {},
      hydrated: false,

      addSketch: (draft) => {
        const id = makeId();
        const now = Date.now();
        set((s) => ({
          sketches: {
            ...s.sketches,
            [id]: { id, ...draft, createdAt: now, updatedAt: now },
          },
        }));
        return id;
      },

      updateSketch: (id, patch) =>
        set((s) => {
          const existing = s.sketches[id];
          if (!existing) return s;
          // Sweep the copies of photos that were taken off the page.
          //
          // Deliberately here rather than at the moment the user taps remove:
          // if the app were killed between that tap and the save, a file deleted
          // eagerly would still be referenced by the stored sketch and the photo
          // would come back as a blank. Deleting only once the new list is
          // actually committed cannot strand a live reference.
          if (patch.images && existing.images.length) {
            const kept = new Set(patch.images.map((img) => img.uri));
            const dropped = existing.images.filter((img) => !kept.has(img.uri));
            if (dropped.length) void deleteAttachmentUris(dropped.map((img) => img.uri));
          }
          return {
            sketches: {
              ...s.sketches,
              [id]: { ...existing, ...patch, updatedAt: Date.now() },
            },
          };
        }),

      deleteSketch: (id) =>
        set((s) => {
          const next = { ...s.sketches };
          const removed = next[id];
          delete next[id];
          // Photos placed on the page are real copies in app storage, referenced
          // only from here — sweep them with the sketch or they leak forever.
          if (removed?.images?.length) {
            void deleteAttachmentUris(removed.images.map((img) => img.uri));
          }
          return { sketches: next };
        }),

      togglePinned: (id) =>
        set((s) => {
          const existing = s.sketches[id];
          if (!existing) return s;
          return {
            sketches: {
              ...s.sketches,
              [id]: { ...existing, pinned: !existing.pinned, updatedAt: Date.now() },
            },
          };
        }),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'todos.sketches.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ sketches }) => ({ sketches }),
      merge: (persisted, current) => {
        const incoming = (persisted as { sketches?: Record<string, unknown> })?.sketches ?? {};
        const sketches: Record<string, Sketch> = {};
        for (const [id, raw] of Object.entries(incoming)) sketches[id] = migrateSketch(raw);
        return { ...current, sketches };
      },
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

/** Pinned first, then most-recently-updated. */
export function sortSketches(sketches: Sketch[]): Sketch[] {
  return [...sketches].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

/** Sensible defaults for a new sketch page. */
export function emptySketchDraft(): SketchDraft {
  return {
    title: '',
    strokes: [],
    images: [],
    paper: 'plain',
    pageW: DEFAULT_PAGE_W,
    pageH: DEFAULT_PAGE_H,
    importance: 3,
    linkedNoteIds: [],
    linkedTaskIds: [],
  };
}
