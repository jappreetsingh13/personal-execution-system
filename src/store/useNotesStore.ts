import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Importance, Note, Section } from '@/types';
import { makeId } from '@/lib/id';

export type NoteDraft = {
  title: string;
  body: string;
  importance: Importance;
  linkedTaskIds: string[];
  sections: Section[];
};

/**
 * v1 stored a single `linkedTaskId` and had no sections. Migrate rather than
 * reset, so notes written before the many-to-many change survive an update.
 */
function migrateNote(raw: unknown): Note {
  const n = raw as Note & { linkedTaskId?: string };
  const fromSingle = n.linkedTaskId ? [n.linkedTaskId] : [];
  return {
    ...n,
    linkedTaskIds: Array.isArray(n.linkedTaskIds) ? n.linkedTaskIds : fromSingle,
    sections: Array.isArray(n.sections) ? n.sections : [],
  };
}

type NotesState = {
  notes: Record<string, Note>;
  hydrated: boolean;

  addNote: (draft: NoteDraft) => string;
  updateNote: (id: string, patch: Partial<NoteDraft> & { pinned?: boolean }) => void;
  deleteNote: (id: string) => void;
  togglePinned: (id: string) => void;
  /** Clear any note's back-reference to a task that no longer exists. */
  unlinkTask: (taskId: string) => void;
  /** Mirror a task's chosen note list onto those notes. See syncLinksFromNote. */
  syncLinksFromTask: (taskId: string, noteIds: string[]) => void;
  setHydrated: () => void;
};

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
      notes: {},
      hydrated: false,

      addNote: (draft) => {
        const id = makeId();
        const now = Date.now();
        set((s) => ({
          notes: {
            ...s.notes,
            [id]: { id, ...draft, createdAt: now, updatedAt: now },
          },
        }));
        return id;
      },

      updateNote: (id, patch) =>
        set((s) => {
          const existing = s.notes[id];
          if (!existing) return s;
          return {
            notes: {
              ...s.notes,
              [id]: { ...existing, ...patch, updatedAt: Date.now() },
            },
          };
        }),

      deleteNote: (id) =>
        set((s) => {
          const next = { ...s.notes };
          delete next[id];
          return { notes: next };
        }),

      togglePinned: (id) =>
        set((s) => {
          const existing = s.notes[id];
          if (!existing) return s;
          return {
            notes: {
              ...s.notes,
              [id]: { ...existing, pinned: !existing.pinned, updatedAt: Date.now() },
            },
          };
        }),

      unlinkTask: (taskId) =>
        set((s) => {
          let touched = false;
          const next: Record<string, Note> = {};
          for (const [id, note] of Object.entries(s.notes)) {
            if (note.linkedTaskIds.includes(taskId)) {
              next[id] = {
                ...note,
                linkedTaskIds: note.linkedTaskIds.filter((t) => t !== taskId),
              };
              touched = true;
            } else {
              next[id] = note;
            }
          }
          return touched ? { notes: next } : s;
        }),

      syncLinksFromTask: (taskId, noteIds) =>
        set((s) => {
          const wanted = new Set(noteIds);
          let touched = false;
          const next: Record<string, Note> = {};
          for (const [id, note] of Object.entries(s.notes)) {
            const has = note.linkedTaskIds.includes(taskId);
            const should = wanted.has(id);
            if (has === should) {
              next[id] = note;
              continue;
            }
            next[id] = {
              ...note,
              linkedTaskIds: should
                ? [...note.linkedTaskIds, taskId]
                : note.linkedTaskIds.filter((x) => x !== taskId),
            };
            touched = true;
          }
          return touched ? { notes: next } : s;
        }),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'todos.notes.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ notes }) => ({ notes }),
      merge: (persisted, current) => {
        const incoming = (persisted as { notes?: Record<string, unknown> })?.notes ?? {};
        const notes: Record<string, Note> = {};
        for (const [id, raw] of Object.entries(incoming)) notes[id] = migrateNote(raw);
        return { ...current, notes };
      },
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

/** Pinned first, then most-recently-updated. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}
