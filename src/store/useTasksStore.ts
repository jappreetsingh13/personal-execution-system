import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  Attachment,
  DateKey,
  Importance,
  OccurrenceState,
  Recurrence,
  Section,
  Task,
} from '@/types';
import { makeId } from '@/lib/id';
import { occKey } from '@/lib/status';
import { addDays, todayKey } from '@/lib/date';
import { deleteAttachmentFiles } from '@/lib/attachments';

export type TaskDraft = {
  title: string;
  details?: string;
  importance: Importance;
  minutes: number;
  recurrence: Recurrence;
  startDate: DateKey;
  endDate?: DateKey;
  linkedNoteIds: string[];
  sections: Section[];
  attachments: Attachment[];
  remindersEnabled: boolean;
  alarmEnabled: boolean;
};

/** v1 stored a single `linkedNoteId`, had no sections and no attachments. */
function migrateTask(raw: unknown): Task {
  const t = raw as Task & { linkedNoteId?: string };
  const fromSingle = t.linkedNoteId ? [t.linkedNoteId] : [];
  return {
    ...t,
    linkedNoteIds: Array.isArray(t.linkedNoteIds) ? t.linkedNoteIds : fromSingle,
    sections: Array.isArray(t.sections) ? t.sections : [],
    attachments: Array.isArray(t.attachments) ? t.attachments : [],
  };
}

type TasksState = {
  tasks: Record<string, Task>;
  /** Per-day deviations only, keyed `${taskId}|${dateKey}`. */
  occurrences: Record<string, OccurrenceState>;
  hydrated: boolean;

  addTask: (draft: TaskDraft) => string;
  updateTask: (id: string, patch: Partial<TaskDraft>) => void;
  deleteTask: (id: string) => void;

  setStatus: (taskId: string, date: DateKey, status: 'in_progress' | 'done' | null) => void;
  toggleDone: (taskId: string, date: DateKey) => void;
  toggleStarted: (taskId: string, date: DateKey) => void;
  /** Shift this one day's time, leaving the recurrence rule alone. */
  setTimeOverride: (taskId: string, date: DateKey, minutes: number | null) => void;
  skipOccurrence: (taskId: string, date: DateKey, skipped: boolean) => void;
  /** Push an occurrence to another day, remembering where it came from. */
  moveOccurrence: (taskId: string, fromDate: DateKey, toDate: DateKey | null) => void;

  unlinkNote: (noteId: string) => void;
  /**
   * Mirror a note's chosen task list onto those tasks. The relation is stored
   * on both sides so either editor can read it directly; this keeps the two
   * copies from drifting when it is edited from the note side.
   */
  syncLinksFromNote: (noteId: string, taskIds: string[]) => void;
  setHydrated: () => void;
};

/** Drop a deviation record once it carries no information. */
function pruneEmpty(
  map: Record<string, OccurrenceState>,
  key: string,
  next: OccurrenceState,
): Record<string, OccurrenceState> {
  const isEmpty =
    next.status === undefined &&
    next.timeOverride === undefined &&
    next.movedTo === undefined &&
    !next.skipped;
  const out = { ...map };
  if (isEmpty) delete out[key];
  else out[key] = next;
  return out;
}

export const useTasksStore = create<TasksState>()(
  persist(
    (set) => ({
      tasks: {},
      occurrences: {},
      hydrated: false,

      addTask: (draft) => {
        const id = makeId();
        const now = Date.now();
        set((s) => ({
          tasks: { ...s.tasks, [id]: { id, ...draft, createdAt: now, updatedAt: now } },
        }));
        return id;
      },

      updateTask: (id, patch) =>
        set((s) => {
          const existing = s.tasks[id];
          if (!existing) return s;
          return {
            tasks: {
              ...s.tasks,
              [id]: { ...existing, ...patch, updatedAt: Date.now() },
            },
          };
        }),

      deleteTask: (id) =>
        set((s) => {
          const tasks = { ...s.tasks };
          const removed = tasks[id];
          delete tasks[id];
          // The copied attachment files are unreferenced the moment the task is
          // gone — sweep them too, or app storage leaks forever.
          if (removed?.attachments?.length) {
            void deleteAttachmentFiles(removed.attachments);
          }
          // Drop every deviation belonging to this task so storage doesn't leak.
          const occurrences: Record<string, OccurrenceState> = {};
          const prefix = `${id}|`;
          for (const [k, v] of Object.entries(s.occurrences)) {
            if (!k.startsWith(prefix)) occurrences[k] = v;
          }
          return { tasks, occurrences };
        }),

      setStatus: (taskId, date, status) =>
        set((s) => {
          const key = occKey(taskId, date);
          const prev = s.occurrences[key] ?? {};
          const now = Date.now();
          const next: OccurrenceState = { ...prev };

          if (status === null) {
            delete next.status;
            delete next.startedAt;
            delete next.completedAt;
          } else if (status === 'done') {
            next.status = 'done';
            next.completedAt = now;
            // Preserve an existing start time; infer one if it was never started.
            next.startedAt = prev.startedAt ?? now;
          } else {
            next.status = 'in_progress';
            next.startedAt = prev.startedAt ?? now;
            delete next.completedAt;
          }
          return { occurrences: pruneEmpty(s.occurrences, key, next) };
        }),

      toggleDone: (taskId, date) =>
        set((s) => {
          const key = occKey(taskId, date);
          const prev = s.occurrences[key] ?? {};
          const now = Date.now();
          const next: OccurrenceState = { ...prev };

          if (prev.status === 'done') {
            // Un-ticking returns it to whatever it was before: started, or fresh.
            if (prev.startedAt) {
              next.status = 'in_progress';
              delete next.completedAt;
            } else {
              delete next.status;
              delete next.completedAt;
              delete next.startedAt;
            }
          } else {
            next.status = 'done';
            next.completedAt = now;
            next.startedAt = prev.startedAt ?? now;
          }
          return { occurrences: pruneEmpty(s.occurrences, key, next) };
        }),

      toggleStarted: (taskId, date) =>
        set((s) => {
          const key = occKey(taskId, date);
          const prev = s.occurrences[key] ?? {};
          const next: OccurrenceState = { ...prev };

          if (prev.status === 'in_progress') {
            delete next.status;
            delete next.startedAt;
          } else {
            next.status = 'in_progress';
            next.startedAt = Date.now();
            delete next.completedAt;
          }
          return { occurrences: pruneEmpty(s.occurrences, key, next) };
        }),

      setTimeOverride: (taskId, date, minutes) =>
        set((s) => {
          const key = occKey(taskId, date);
          const prev = s.occurrences[key] ?? {};
          const next: OccurrenceState = { ...prev };
          if (minutes === null) delete next.timeOverride;
          else next.timeOverride = minutes;
          return { occurrences: pruneEmpty(s.occurrences, key, next) };
        }),

      skipOccurrence: (taskId, date, skipped) =>
        set((s) => {
          const key = occKey(taskId, date);
          const prev = s.occurrences[key] ?? {};
          const next: OccurrenceState = { ...prev };
          if (skipped) next.skipped = true;
          else delete next.skipped;
          return { occurrences: pruneEmpty(s.occurrences, key, next) };
        }),

      moveOccurrence: (taskId, fromDate, toDate) =>
        set((s) => {
          const key = occKey(taskId, fromDate);
          const prev = s.occurrences[key] ?? {};
          const next: OccurrenceState = { ...prev };
          // Moving back to its own day is the same as not being moved at all.
          if (toDate === null || toDate === fromDate) delete next.movedTo;
          else next.movedTo = toDate;
          return { occurrences: pruneEmpty(s.occurrences, key, next) };
        }),

      unlinkNote: (noteId) =>
        set((s) => {
          let touched = false;
          const next: Record<string, Task> = {};
          for (const [id, task] of Object.entries(s.tasks)) {
            if (task.linkedNoteIds.includes(noteId)) {
              next[id] = {
                ...task,
                linkedNoteIds: task.linkedNoteIds.filter((n) => n !== noteId),
              };
              touched = true;
            } else {
              next[id] = task;
            }
          }
          return touched ? { tasks: next } : s;
        }),

      syncLinksFromNote: (noteId, taskIds) =>
        set((s) => {
          const wanted = new Set(taskIds);
          let touched = false;
          const next: Record<string, Task> = {};
          for (const [id, task] of Object.entries(s.tasks)) {
            const has = task.linkedNoteIds.includes(noteId);
            const should = wanted.has(id);
            if (has === should) {
              next[id] = task;
              continue;
            }
            next[id] = {
              ...task,
              linkedNoteIds: should
                ? [...task.linkedNoteIds, noteId]
                : task.linkedNoteIds.filter((n) => n !== noteId),
            };
            touched = true;
          }
          return touched ? { tasks: next } : s;
        }),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'todos.tasks.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ tasks, occurrences }) => ({ tasks, occurrences }),
      merge: (persisted, current) => {
        const p = persisted as {
          tasks?: Record<string, unknown>;
          occurrences?: Record<string, OccurrenceState>;
        };
        const tasks: Record<string, Task> = {};
        for (const [id, raw] of Object.entries(p?.tasks ?? {})) tasks[id] = migrateTask(raw);
        return { ...current, tasks, occurrences: p?.occurrences ?? {} };
      },
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

/** Sensible defaults for the "add task" form: next full hour, today, one time. */
export function emptyTaskDraft(): TaskDraft {
  const now = new Date();
  const minutes = Math.min(23 * 60 + 30, (now.getHours() + 1) * 60);
  return {
    title: '',
    details: '',
    importance: 3,
    minutes,
    recurrence: { kind: 'once' },
    startDate: todayKey(),
    linkedNoteIds: [],
    sections: [],
    attachments: [],
    remindersEnabled: true,
    alarmEnabled: false,
  };
}

/** Tomorrow, relative to whichever day the occurrence is currently shown on. */
export function nextDayFrom(date: DateKey): DateKey {
  return addDays(date, 1);
}
