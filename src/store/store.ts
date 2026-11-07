import { useSyncExternalStore } from "react";
import type { Accent } from "../atlas/types";
import { isMastered, type CardState, type Grade } from "./srs";

export type QuizKind = "meaning" | "picture" | "listen" | "spell";
export type Step = { id: string; kind: "intro" } | { id: string; kind: QuizKind; retry?: boolean; options?: string[] };

export interface ActiveSession {
  id: string;
  started: number;
  /** Learning path used to construct this session; absent on legacy sessions. */
  curriculumId?: string;
  steps: Step[];
  index: number;
  /** First-attempt grade per word; retries never change it. */
  graded: Record<string, Grade>;
  newIds: string[];
  reviewIds: string[];
  /** Answer shown but not yet continued; survives reload without double counting. */
  pending?: { correct: boolean; value: string };
  finished?: number;
}

export interface PathDayStat {
  n: number; // new words met
  r: number; // graded reviews (first attempts)
  c: number; // correct first attempts
  t: number; // active seconds
  /** Stable IDs actually graded on this local calendar day. */
  words?: string[];
}

export interface DayStat extends PathDayStat {
  /** Optional per-learning-path breakdown; totals above remain backward compatible. */
  paths?: Record<string, PathDayStat>;
}

export interface TypingRound {
  at: number;
  mode: "word" | "sentence" | "dictation";
  items: number;
  wpm: number;
  accuracy: number;
}

export interface Progress {
  version: 2;
  datasetId: string;
  cards: Record<string, CardState>;
  /** Optional manual override for the learner-facing atlas status. */
  manualStatuses: Record<string, WordStatus>;
  bookmarks: string[];
  days: Record<string, DayStat>;
  typing: TypingRound[];
  session: ActiveSession | null;
  /** Rolling list of recent mistakes, newest first. */
  mistakes: string[];
}

export type WordStatus = "learning" | "mastered";

export interface Settings {
  accent: Accent;
  autoplay: boolean;
  dailyNew: number;
  retention: number;
  theme: "system" | "light" | "dark";
  sfx: boolean;
  spell: boolean;
  startLevel: number;
  onboarded: boolean;
  dataset: "open" | "private";
  /** Active learning path. Progress remains keyed by dataset and stable word ID. */
  curriculum: string;
  ambience: "off" | "stars" | "rain" | "sea" | "forest" | "fire" | "voyage" | "cafe";
  ambienceVolume: number;
  splash: boolean;
}

export type LocalSyncEventKind = "review" | "bookmark" | "day_delta" | "typing" | "settings" | "session" | "status";
export interface LocalSyncEventInput {
  kind: LocalSyncEventKind;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export const defaultSettings: Settings = {
  accent: "uk",
  autoplay: true,
  dailyNew: 10,
  retention: 0.9,
  theme: "dark",
  sfx: true,
  spell: true,
  startLevel: 0,
  onboarded: false,
  dataset: "open",
  curriculum: "ielts",
  ambience: "stars",
  ambienceVolume: 0.45,
  splash: true,
};

export const emptyProgress = (datasetId: string): Progress => ({
  version: 2,
  datasetId,
  cards: {},
  manualStatuses: {},
  bookmarks: [],
  days: {},
  typing: [],
  session: null,
  mistakes: [],
});

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const SETTINGS_KEY = "word-atlas:settings";
const progressKey = (id: string) => `word-atlas:v2:${id}`;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------- validation (backups and stored data are untrusted) ---------- */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, lo = -Infinity, hi = Infinity) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function validCard(v: unknown): v is CardState {
  return (
    isObj(v) &&
    num(v.due, 0) &&
    num(v.s, 0) &&
    num(v.d, 0, 11) &&
    num(v.el, 0) &&
    num(v.sd, 0) &&
    num(v.ls, 0) &&
    num(v.reps, 0) &&
    num(v.lapses, 0) &&
    [0, 1, 2, 3].includes(v.st as number) &&
    (v.last === undefined || num(v.last, 0)) &&
    num(v.seen, 0)
  );
}

export function sanitizeProgress(v: unknown, datasetId: string): Progress {
  const out = emptyProgress(datasetId);
  if (!isObj(v) || v.version !== 2) return out;
  if (isObj(v.cards)) for (const [k, c] of Object.entries(v.cards)) if (validCard(c)) out.cards[k] = c;
  if (isObj(v.manualStatuses)) {
    let statusCount = 0;
    for (const [id, status] of Object.entries(v.manualStatuses))
      if (statusCount < 20000 && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) && (status === "learning" || status === "mastered")) {
        out.manualStatuses[id] = status;
        statusCount++;
      }
  }
  if (Array.isArray(v.bookmarks)) out.bookmarks = v.bookmarks.filter((x): x is string => typeof x === "string").slice(0, 20000);
  if (Array.isArray(v.mistakes)) out.mistakes = v.mistakes.filter((x): x is string => typeof x === "string").slice(0, 300);
  if (isObj(v.days))
    for (const [k, d] of Object.entries(v.days))
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && isObj(d) && num(d.n, 0) && num(d.r, 0) && num(d.c, 0) && num(d.t, 0)) {
        const words = Array.isArray(d.words)
          ? [...new Set(d.words.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)))].slice(0, 512)
          : [];
        const paths: Record<string, PathDayStat> = {};
        if (isObj(d.paths))
          for (const [pathId, raw] of Object.entries(d.paths))
            if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(pathId) && isObj(raw) && num(raw.n, 0) && num(raw.r, 0) && num(raw.c, 0) && num(raw.t, 0)) {
              const pathWords = Array.isArray(raw.words)
                ? [...new Set(raw.words.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)))].slice(0, 512)
                : [];
              paths[pathId] = { n: raw.n as number, r: raw.r as number, c: raw.c as number, t: raw.t as number, ...(pathWords.length ? { words: pathWords } : {}) };
            }
        out.days[k] = { n: d.n as number, r: d.r as number, c: d.c as number, t: d.t as number, ...(words.length ? { words } : {}), ...(Object.keys(paths).length ? { paths } : {}) };
      }
  if (Array.isArray(v.typing))
    out.typing = v.typing
      .filter(
        (t): t is TypingRound =>
          isObj(t) && num(t.at, 0) && ["word", "sentence", "dictation"].includes(t.mode as string) && num(t.items, 0) && num(t.wpm, 0, 400) && num(t.accuracy, 0, 100),
      )
      .slice(-500);
  const s = v.session;
  if (isObj(s) && typeof s.id === "string" && Array.isArray(s.steps) && num(s.index, 0) && isObj(s.graded))
    out.session = s as unknown as ActiveSession;
  return out;
}

export function sanitizeSettings(v: unknown): Settings {
  const s = { ...defaultSettings };
  if (!isObj(v)) return s;
  if (v.accent === "uk" || v.accent === "us") s.accent = v.accent;
  if (typeof v.autoplay === "boolean") s.autoplay = v.autoplay;
  if (num(v.dailyNew, 0, 100)) s.dailyNew = Math.round(v.dailyNew as number);
  if (num(v.retention, 0.7, 0.97)) s.retention = v.retention as number;
  if (v.theme === "system" || v.theme === "light" || v.theme === "dark") s.theme = v.theme;
  if (typeof v.sfx === "boolean") s.sfx = v.sfx;
  if (typeof v.spell === "boolean") s.spell = v.spell;
  if (num(v.startLevel, 0, 5)) s.startLevel = Math.round(v.startLevel as number);
  if (typeof v.onboarded === "boolean") s.onboarded = v.onboarded;
  if (v.dataset === "open" || v.dataset === "private") s.dataset = v.dataset;
  if (typeof v.curriculum === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v.curriculum)) s.curriculum = v.curriculum;
  if (["off", "stars", "rain", "sea", "forest", "fire", "voyage", "cafe"].includes(v.ambience as string)) s.ambience = v.ambience as Settings["ambience"];
  if (num(v.ambienceVolume, 0, 1)) s.ambienceVolume = v.ambienceVolume as number;
  if (typeof v.splash === "boolean") s.splash = v.splash;
  return s;
}

/* ---------- store ---------- */

interface State {
  progress: Progress;
  settings: Settings;
  saveError: boolean;
}

let state: State = {
  progress: emptyProgress("word-atlas-open"),
  settings: sanitizeSettings(read(SETTINGS_KEY)),
  saveError: false,
};
const listeners = new Set<() => void>();
const localProgressListeners = new Set<(progress: Progress) => void>();
const localSyncEventListeners = new Set<(event: LocalSyncEventInput) => void>();
let saveTimer: number | undefined;
/** Only write when this tab changed something, so idle tabs never clobber newer data. */
let dirty = false;
/** Progress is written only after it has been read from storage for this dataset. */
let loadedId: string | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function scheduleSave() {
  dirty = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 250);
}

export function flush() {
  window.clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  const progressOk = loadedId !== state.progress.datasetId || write(progressKey(state.progress.datasetId), state.progress);
  const ok = progressOk && write(SETTINGS_KEY, state.settings);
  if (ok === state.saveError) {
    state = { ...state, saveError: !ok };
    emit();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  // Another tab saved: adopt its data instead of keeping a stale copy.
  window.addEventListener("storage", (e) => {
    if (!e.newValue) return;
    try {
      if (e.key === SETTINGS_KEY) state = { ...state, settings: sanitizeSettings(JSON.parse(e.newValue)) };
      else if (e.key === progressKey(state.progress.datasetId))
        state = { ...state, progress: sanitizeProgress(JSON.parse(e.newValue), state.progress.datasetId) };
      else return;
      emit();
    } catch {
      /* ignore malformed writes */
    }
  });
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  useDataset(datasetId: string) {
    flush();
    state = { ...state, progress: sanitizeProgress(read(progressKey(datasetId)), datasetId) };
    loadedId = datasetId;
    emit();
  },
  progress(fn: (p: Progress) => Progress) {
    const before = state.progress;
    state = { ...state, progress: fn(before) };
    emit();
    scheduleSave();
    localProgressListeners.forEach((listener) => listener(state.progress));
    if (before.session !== state.progress.session) {
      // Keep the identity of the session being changed. A null checkpoint
      // without this metadata could let an older device clear a newer journey.
      const changedSession = state.progress.session ?? before.session;
      store.emitSyncEvent("session", {
        session: state.progress.session,
        session_id: changedSession?.id,
        session_started: changedSession?.started,
      });
    }
  },
  replaceProgress(progress: unknown) {
    const clean = sanitizeProgress(progress, state.progress.datasetId);
    state = { ...state, progress: clean };
    emit();
    markDirty();
    flush();
  },
  replaceSyncedState(progress: unknown, settings: unknown) {
    state = {
      ...state,
      progress: sanitizeProgress(progress, state.progress.datasetId),
      settings: sanitizeSettings(settings),
    };
    emit();
    markDirty();
    flush();
  },
  subscribeLocalProgress(listener: (progress: Progress) => void) {
    localProgressListeners.add(listener);
    return () => localProgressListeners.delete(listener);
  },
  subscribeSyncEvents(listener: (event: LocalSyncEventInput) => void) {
    localSyncEventListeners.add(listener);
    return () => localSyncEventListeners.delete(listener);
  },
  emitSyncEvent(kind: LocalSyncEventKind, payload: Record<string, unknown>, occurredAt = new Date()) {
    const event = { kind, payload, occurredAt: occurredAt.toISOString() };
    localSyncEventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Sync storage failure must never interrupt local learning.
      }
    });
  },
  settings(patch: Partial<Settings>) {
    state = { ...state, settings: { ...state.settings, ...patch } };
    emit();
    scheduleSave();
    const { dataset: _dataset, ...syncable } = patch;
    if (Object.keys(syncable).length) {
      const event = { kind: "settings" as const, payload: { settings: syncable }, occurredAt: new Date().toISOString() };
      localSyncEventListeners.forEach((listener) => {
        try {
          listener(event);
        } catch {
          // Sync storage failure must never interrupt local settings changes.
        }
      });
    }
  },
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state), () => select(state));
}

export function wordStatus(card: CardState | undefined, manualStatus?: WordStatus): WordStatus | null {
  if (manualStatus) return manualStatus;
  if (!card) return null;
  return isMastered(card) ? "mastered" : "learning";
}

export function bumpDay(p: Progress, patch: Partial<PathDayStat>, curriculumId?: string): Progress {
  const k = dayKey();
  const d = p.days[k] ?? { n: 0, r: 0, c: 0, t: 0 };
  const words = [...new Set([...(d.words ?? []), ...(patch.words ?? [])])].slice(0, 512);
  const existingPaths = d.paths ?? (d.n || d.r || d.c || d.t ? { ielts: { n: d.n, r: d.r, c: d.c, t: d.t, ...(d.words?.length ? { words: d.words } : {}) } } : {});
  const beforePath = curriculumId ? existingPaths[curriculumId] ?? { n: 0, r: 0, c: 0, t: 0 } : null;
  const pathWords = beforePath ? [...new Set([...(beforePath.words ?? []), ...(patch.words ?? [])])].slice(0, 512) : [];
  const paths = beforePath && curriculumId
    ? {
        ...existingPaths,
        [curriculumId]: {
          n: beforePath.n + (patch.n ?? 0),
          r: beforePath.r + (patch.r ?? 0),
          c: beforePath.c + (patch.c ?? 0),
          t: beforePath.t + (patch.t ?? 0),
          ...(pathWords.length ? { words: pathWords } : {}),
        },
      }
    : d.paths;
  return {
    ...p,
    days: {
      ...p.days,
      [k]: { n: d.n + (patch.n ?? 0), r: d.r + (patch.r ?? 0), c: d.c + (patch.c ?? 0), t: d.t + (patch.t ?? 0), ...(words.length ? { words } : {}), ...(paths ? { paths } : {}) },
    },
  };
}

export function toggleBookmark(id: string) {
  const existed = store.get().progress.bookmarks.includes(id);
  const occurredAt = new Date();
  store.progress((p) => ({
    ...p,
    bookmarks: p.bookmarks.includes(id) ? p.bookmarks.filter((x) => x !== id) : [id, ...p.bookmarks],
  }));
  store.emitSyncEvent("bookmark", { word_id: id, action: existed ? "remove" : "add" }, occurredAt);
}

export function setManualStatus(id: string, status: WordStatus | null) {
  const current = store.get().progress.manualStatuses[id];
  if (current === status) return;
  const occurredAt = new Date();
  store.progress((p) => {
    const manualStatuses = { ...p.manualStatuses };
    if (status) manualStatuses[id] = status;
    else delete manualStatuses[id];
    return { ...p, manualStatuses };
  });
  store.emitSyncEvent("status", { word_id: id, status }, occurredAt);
}

/* ---------- backup ---------- */

export function exportBackup() {
  flush();
  const { progress, settings } = state;
  return JSON.stringify({ app: "word-atlas", version: 2, exported: new Date().toISOString(), progress: { ...progress, session: null }, settings }, null, 1);
}

function markDirty() {
  dirty = true;
}

export function importBackup(text: string): { ok: true; cards: number } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "文件不是有效的 JSON。" };
  }
  if (!isObj(data) || data.app !== "word-atlas" || data.version !== 2 || !isObj(data.progress))
    return { ok: false, error: "这不是词光的学习备份。" };
  const id = state.progress.datasetId;
  if (data.progress.datasetId !== id) return { ok: false, error: "备份来自另一个词库，请先切换到对应词库。" };
  const progress = sanitizeProgress({ ...data.progress, session: null }, id);
  // Backup imports replace this device's data locally; no destructive reset/import event is broadcast.
  state = { ...state, progress, settings: { ...sanitizeSettings(data.settings), onboarded: true } };
  emit();
  markDirty();
  flush();
  return { ok: true, cards: Object.keys(progress.cards).length };
}

export function resetProgress() {
  // Clearing progress is local-only; there is no remote tombstone/reset event.
  state = { ...state, progress: emptyProgress(state.progress.datasetId) };
  emit();
  markDirty();
  flush();
}
