import type { Settings } from "../store/store";
import { emptyProgress, sanitizeProgress, sanitizeSettings, type ActiveSession, type PathDayStat, type Progress, type TypingRound, type WordStatus } from "../store/store";
import { Rating, review, type CardState, type Grade } from "../store/srs";
import type { RemoteSyncConfig } from "./remoteSync";

export type SyncEventKind = "bootstrap" | "review" | "bookmark" | "day_delta" | "typing" | "settings" | "session" | "status";
export interface SyncEvent {
  event_id: string;
  occurred_at: string;
  kind: SyncEventKind;
  payload: Record<string, unknown>;
}
export interface ServerSyncEvent extends SyncEvent {
  seq: number;
  device_id: string;
}
export interface EventSyncSnapshot {
  progress: Progress;
  settings: Settings;
}
export interface EventSyncStatus {
  state: "idle" | "syncing" | "success" | "error";
  message: string;
  cursor?: number;
}
export interface EventStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type EventFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const EVENT_URL_PATH = "/api/word-atlas/events";
const MAX_BATCH_EVENTS = 500;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OUTBOX_KEY = (device: string, dataset: string) => `word-atlas:event-outbox:v1:${encodeURIComponent(device)}:${encodeURIComponent(dataset)}`;
const CURSOR_KEY = (profile: string, device: string, dataset: string) =>
  `word-atlas:event-cursor:v1:${encodeURIComponent(profile)}:${encodeURIComponent(device)}:${encodeURIComponent(dataset)}`;
const BOOTSTRAP_KEY = (profile: string, device: string, dataset: string) =>
  `word-atlas:event-bootstrap:v1:${encodeURIComponent(profile)}:${encodeURIComponent(device)}:${encodeURIComponent(dataset)}`;
const INBOX_KEY = (profile: string, device: string, dataset: string) =>
  `word-atlas:event-inbox:v1:${encodeURIComponent(profile)}:${encodeURIComponent(device)}:${encodeURIComponent(dataset)}`;

const listeners = new Set<(status: EventSyncStatus) => void>();
let status: EventSyncStatus = { state: "idle", message: "尚未同步" };
const locks = new Map<string, Promise<void>>();

export function getEventSyncStatus(): EventSyncStatus {
  return status;
}

export function subscribeEventSyncStatus(listener: (next: EventSyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

function setStatus(next: EventSyncStatus): void {
  status = next;
  listeners.forEach((listener) => listener(next));
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  throw new Error("当前浏览器不支持安全的 UUID 生成，无法启用事件同步。");
}

export function createSyncEvent(kind: SyncEventKind, payload: Record<string, unknown>, occurredAt = new Date()): SyncEvent {
  return { event_id: uuid(), occurred_at: occurredAt.toISOString(), kind, payload };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Leave headroom for the request envelope under the server's 5 MiB bound. */
export function boundedEventBatch(events: SyncEvent[], excluded = new Set<string>()): SyncEvent[] {
  const batch: SyncEvent[] = [];
  let bytes = 0;
  for (const event of events) {
    if (excluded.has(event.event_id)) continue;
    const size = byteLength(event) + 1;
    if (batch.length && bytes + size > MAX_BATCH_BYTES) break;
    batch.push(event);
    bytes += size;
    if (batch.length >= MAX_BATCH_EVENTS) break;
  }
  return batch;
}

function readJson<T>(storage: EventStorage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage: EventStorage, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

function makeBootstrapEvent(payload: Record<string, unknown>, idFactory: () => string, occurredAt: string): SyncEvent {
  return { event_id: idFactory(), occurred_at: occurredAt, kind: "bootstrap", payload };
}

/** Creates bounded bootstrap events. Device credentials are deliberately omitted. */
export function buildBootstrapEvents(
  progress: Progress,
  settings: Settings,
  idFactory: () => string = uuid,
): SyncEvent[] {
  // Baseline events sort before later reviews and settings changes.
  const occurredAt = "1970-01-01T00:00:00.000Z";
  const events: SyncEvent[] = [];
  const push = (payload: Record<string, unknown>) => {
    const event = makeBootstrapEvent(payload, idFactory, occurredAt);
    if (byteLength(event) > MAX_EVENT_BYTES) throw new Error("首次同步中的单项数据超过 64 KiB，无法拆分。");
    events.push(event);
  };
  for (const [wordId, card] of Object.entries(progress.cards)) push({ card: { word_id: wordId, state: card } });

  const chunks = <T>(items: T[], payloadKey: string) => {
    let current: T[] = [];
    for (const item of items) {
      const candidate = [...current, item];
      const candidatePayload = { [payloadKey]: candidate };
      const candidateEvent = makeBootstrapEvent(candidatePayload, () => "00000000-0000-4000-8000-000000000000", occurredAt);
      if (current.length && byteLength(candidateEvent) > MAX_EVENT_BYTES) {
        push({ [payloadKey]: current });
        current = [item];
      } else current = candidate;
      const single = makeBootstrapEvent({ [payloadKey]: [item] }, () => "00000000-0000-4000-8000-000000000000", occurredAt);
      if (byteLength(single) > MAX_EVENT_BYTES) throw new Error("首次同步中的单项元数据超过 64 KiB，无法拆分。");
    }
    if (current.length) push({ [payloadKey]: current });
  };
  chunks(progress.bookmarks, "bookmarks");
  chunks(Object.entries(progress.days).map(([day, stats]) => [day, stats]), "days");
  chunks(progress.mistakes, "mistakes");
  chunks(progress.typing, "typing");
  chunks(Object.entries(progress.manualStatuses), "statuses");
  // A session is a resumable journey, so include its current checkpoint in the
  // initial sync. A null session is intentionally omitted: a device that has
  // never started a journey must not clear another device's active journey.
  if (progress.session) push({ session: progress.session });
  push({ settings: omitLocalSettings(settings) });
  return events;
}

function omitLocalSettings(settings: Settings): Partial<Settings> {
  const { dataset: _dataset, ...syncable } = settings;
  return syncable;
}

export function enqueueSyncEvent(storage: EventStorage, deviceId: string, datasetId: string, event: SyncEvent): void {
  if (!UUID.test(event.event_id)) throw new Error("同步事件 ID 必须是 UUID。");
  if (byteLength(event) > MAX_EVENT_BYTES) throw new Error("同步事件超过 64 KiB。");
  const key = OUTBOX_KEY(deviceId, datasetId);
  const outbox = readJson<SyncEvent[]>(storage, key, []);
  if (!outbox.some((item) => item.event_id === event.event_id)) {
    outbox.push(event);
    writeJson(storage, key, outbox);
  }
}

function validConfig(config: RemoteSyncConfig): void {
  if (!config.baseUrl.trim() || !config.profileId.trim() || !config.deviceId.trim() || !config.token.trim())
    throw new Error("请先填写服务器 URL、用户配置 ID、设备 ID 和同步密钥。");
  if (!SAFE_ID.test(config.profileId) || !SAFE_ID.test(config.deviceId))
    throw new Error("配置 ID 和设备 ID 只能使用安全字符，且不能超过 128 个字符。");
}

function endpoint(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("请输入有效的同步服务器 URL。");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error("同步服务器必须使用 HTTPS；只有本机回环地址可以使用 HTTP。");
  return `${url.href.replace(/\/+$/, "")}${EVENT_URL_PATH}`;
}

function validateReply(value: unknown): { cursor: number; events: ServerSyncEvent[]; has_more: boolean } {
  if (!value || typeof value !== "object") throw new Error("事件同步服务器返回格式不正确。");
  const reply = value as Record<string, unknown>;
  if (!Number.isSafeInteger(reply.cursor) || (reply.cursor as number) < 0 || !Array.isArray(reply.events) || typeof reply.has_more !== "boolean")
    throw new Error("事件同步服务器返回格式不正确。");
  for (const event of reply.events) {
    if (!event || typeof event !== "object") throw new Error("事件同步服务器包含无效事件。");
    const item = event as Record<string, unknown>;
    if (
      !Number.isSafeInteger(item.seq) ||
      (item.seq as number) < 0 ||
      typeof item.event_id !== "string" ||
      !UUID.test(item.event_id) ||
      typeof item.device_id !== "string" ||
      typeof item.occurred_at !== "string" ||
      !Number.isFinite(Date.parse(item.occurred_at)) ||
      !["bootstrap", "review", "bookmark", "day_delta", "typing", "settings", "session", "status"].includes(String(item.kind)) ||
      !item.payload ||
      typeof item.payload !== "object" ||
      Array.isArray(item.payload)
    )
      throw new Error("事件同步服务器包含无效事件。");
  }
  return reply as unknown as { cursor: number; events: ServerSyncEvent[]; has_more: boolean };
}

function addStats(progress: Progress, day: string, delta: Partial<PathDayStat>, curriculumId?: string): Progress {
  const validDelta = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const before = progress.days[day] ?? { n: 0, r: 0, c: 0, t: 0 };
  const words = [...new Set([...(before.words ?? []), ...(delta.words ?? [])])].slice(0, 512);
  const existingPaths = before.paths ?? (before.n || before.r || before.c || before.t ? { ielts: { n: before.n, r: before.r, c: before.c, t: before.t, ...(before.words?.length ? { words: before.words } : {}) } } : {});
  const beforePath = curriculumId ? existingPaths[curriculumId] ?? { n: 0, r: 0, c: 0, t: 0 } : null;
  const pathWords = beforePath ? [...new Set([...(beforePath.words ?? []), ...(delta.words ?? [])])].slice(0, 512) : [];
  const paths = beforePath && curriculumId
    ? {
        ...existingPaths,
        [curriculumId]: {
          n: Math.max(0, beforePath.n + validDelta(delta.n)),
          r: Math.max(0, beforePath.r + validDelta(delta.r)),
          c: Math.max(0, beforePath.c + validDelta(delta.c)),
          t: Math.max(0, beforePath.t + validDelta(delta.t)),
          ...(pathWords.length ? { words: pathWords } : {}),
        },
      }
    : before.paths;
  return {
    ...progress,
    days: {
      ...progress.days,
      [day]: {
        n: Math.max(0, before.n + validDelta(delta?.n)),
        r: Math.max(0, before.r + validDelta(delta?.r)),
        c: Math.max(0, before.c + validDelta(delta?.c)),
        t: Math.max(0, before.t + validDelta(delta?.t)),
        ...(words.length ? { words } : {}),
        ...(paths ? { paths } : {}),
      },
    },
  };
}

function validCard(value: unknown, datasetId: string): CardState | undefined {
  const cleaned = sanitizeProgress({ version: 2, cards: { item: value } }, datasetId).cards.item;
  return cleaned;
}

function validSession(value: unknown, datasetId: string): ActiveSession | null | undefined {
  if (value === null) return null;
  const cleaned = sanitizeProgress({ version: 2, session: value }, datasetId).session;
  return cleaned;
}

function validWordStatus(value: unknown): value is WordStatus {
  return value === "learning" || value === "mastered";
}

/** Remove words completed on another device from the local pending journey. */
function removeRemotelyReviewedWord(progress: Progress, wordId: string, finishedAt: number): Progress {
  const session = progress.session;
  if (!session || session.finished || session.index >= session.steps.length) return progress;
  const before = session.steps.length;
  const steps = [
    ...session.steps.slice(0, session.index),
    ...session.steps.slice(session.index).filter((step) => step.id !== wordId),
  ];
  if (steps.length === before) return progress;
  const index = Math.min(session.index, steps.length);
  const pending = session.pending && session.steps[session.index]?.id === wordId ? undefined : session.pending;
  return {
    ...progress,
    session: {
      ...session,
      steps,
      index,
      newIds: session.newIds.filter((id) => id !== wordId),
      reviewIds: session.reviewIds.filter((id) => id !== wordId),
      pending,
      ...(index >= steps.length ? { finished: session.finished ?? Math.max(1, finishedAt) } : {}),
    },
  };
}

/** Merge two independently started journeys without restoring completed words. */
function mergeActiveSessions(current: ActiveSession, incoming: ActiveSession): ActiveSession {
  // A different learning path has a different ordered plan. Keep the existing
  // path's winner rule for that case; same-path journeys can be merged safely
  // by stable word IDs.
  if (current.curriculumId && incoming.curriculumId && current.curriculumId !== incoming.curriculumId)
    return incoming.started > current.started ? incoming : current;

  const completed = new Set([...Object.keys(current.graded), ...Object.keys(incoming.graded)]);
  const steps = current.steps.filter((step, index) => index < current.index || !completed.has(step.id));
  const present = new Set(steps.map((step) => step.id));
  const additions = incoming.steps.slice(incoming.index).filter((step) => !completed.has(step.id) && !present.has(step.id));
  const mergedSteps = [...steps, ...additions];
  const index = Math.min(current.index, mergedSteps.length);
  const newIds = [...new Set([...current.newIds, ...incoming.newIds])].filter((id) => !completed.has(id));
  const reviewIds = [...new Set([...current.reviewIds, ...incoming.reviewIds])].filter((id) => !completed.has(id));
  return {
    ...current,
    steps: mergedSteps,
    index,
    graded: { ...incoming.graded, ...current.graded },
    newIds,
    reviewIds,
    ...(index >= mergedSteps.length ? { finished: current.finished ?? incoming.finished ?? Date.now() } : { finished: undefined }),
  };
}

/** Replays only other devices' events in stable time/sequence order. */
export function replaySyncEvents(snapshot: EventSyncSnapshot, events: ServerSyncEvent[], ownDeviceId: string): EventSyncSnapshot {
  const ordered = [...events]
    .filter((event) => event.device_id !== ownDeviceId)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.seq - b.seq);
  let progress = snapshot.progress;
  let settings = snapshot.settings;
  for (const event of ordered) {
    const payload = event.payload;
    if (event.kind === "bootstrap") {
      const card = payload.card;
      if (card && typeof card === "object") {
        const item = card as Record<string, unknown>;
        if (typeof item.word_id === "string" && !progress.cards[item.word_id]) {
          const clean = validCard(item.state, progress.datasetId);
          if (clean) progress = { ...progress, cards: { ...progress.cards, [item.word_id]: clean } };
        }
      }
      if (Array.isArray(payload.bookmarks)) {
        const merged = new Set(progress.bookmarks);
        payload.bookmarks.forEach((id) => typeof id === "string" && merged.add(id));
        progress = { ...progress, bookmarks: [...merged].slice(0, 20000) };
      }
      if (Array.isArray(payload.days)) {
        const days = { ...progress.days };
        for (const pair of payload.days) {
          if (Array.isArray(pair) && typeof pair[0] === "string") {
            const clean = sanitizeProgress({ version: 2, days: { [pair[0]]: pair[1] } }, progress.datasetId).days[pair[0]];
            if (clean && !days[pair[0]]) days[pair[0]] = clean;
          }
        }
        progress = { ...progress, days };
      }
      if (Array.isArray(payload.mistakes)) {
        const mistakes = new Set(progress.mistakes);
        for (const id of payload.mistakes) if (typeof id === "string") mistakes.add(id);
        progress = { ...progress, mistakes: [...mistakes].slice(0, 300) };
      }
      if (Array.isArray(payload.typing)) {
        const records = sanitizeProgress({ version: 2, typing: payload.typing }, progress.datasetId).typing;
        const keys = new Set(progress.typing.map(typingKey));
        progress = { ...progress, typing: [...progress.typing, ...records.filter((item) => !keys.has(typingKey(item)))].slice(-500) };
      }
      if (Array.isArray(payload.statuses)) {
        const manualStatuses = { ...progress.manualStatuses };
        for (const pair of payload.statuses) {
          if (Array.isArray(pair) && typeof pair[0] === "string" && SAFE_ID.test(pair[0]) && validWordStatus(pair[1])) manualStatuses[pair[0]] = pair[1];
        }
        progress = { ...progress, manualStatuses };
      }
      if (Object.prototype.hasOwnProperty.call(payload, "session")) {
        const session = validSession(payload.session, progress.datasetId);
        // Bootstrap is a baseline. Do not let a device that has no journey
        // erase a journey already open on this device.
        if (session && (!progress.session || session.started >= progress.session.started))
          progress = { ...progress, session };
      }
      if (payload.settings && typeof payload.settings === "object") settings = sanitizeSettings({ ...settings, ...(payload.settings as Record<string, unknown>) });
    } else if (event.kind === "review") {
      const wordId = payload.word_id;
      const grade = payload.grade;
      const retention = payload.retention;
      const time = Date.parse(event.occurred_at);
      if (typeof wordId === "string" && [1, 2, 3, 4].includes(grade as number) && Number.isFinite(time) && typeof retention === "number" && retention >= 0.7 && retention <= 0.97) {
        const existing = progress.cards[wordId];
        // A newer offline review on this device is authoritative for this card; do not rewind FSRS time.
        if (existing?.last !== undefined && existing.last >= time) {
          progress = removeRemotelyReviewedWord(progress, wordId, time);
          continue;
        }
        progress = { ...progress, cards: { ...progress.cards, [wordId]: review(progress.cards[wordId], grade as Grade, time, retention) } };
        if (grade === Rating.Again) progress = { ...progress, mistakes: [wordId, ...progress.mistakes.filter((id) => id !== wordId)].slice(0, 300) };
        // The review is authoritative even when the card already existed
        // locally: it proves that this word was completed on the other device.
        // Trim only the not-yet-reached part, so local history remains intact.
        progress = removeRemotelyReviewedWord(progress, wordId, time);
      }
      const delta = payload.stats_delta;
      if (delta && typeof delta === "object" && !Array.isArray(delta)) {
        const stats = delta as Record<string, unknown>;
        if (typeof stats.day_key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stats.day_key) && stats.delta && typeof stats.delta === "object" && !Array.isArray(stats.delta))
          progress = addStats(
            progress,
            stats.day_key,
            { ...(stats.delta as Partial<PathDayStat>), ...(typeof wordId === "string" ? { words: [wordId] } : {}) },
            typeof payload.curriculum_id === "string" ? payload.curriculum_id : undefined,
          );
      }
    } else if (event.kind === "bookmark") {
      const wordId = payload.word_id;
      if (typeof wordId === "string") {
        if (payload.action === "add" && !progress.bookmarks.includes(wordId)) progress = { ...progress, bookmarks: [wordId, ...progress.bookmarks].slice(0, 20000) };
        if (payload.action === "remove") progress = { ...progress, bookmarks: progress.bookmarks.filter((id) => id !== wordId) };
      }
    } else if (event.kind === "day_delta") {
      const day = payload.day_key;
      if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && payload.delta && typeof payload.delta === "object" && !Array.isArray(payload.delta))
        progress = addStats(progress, day, payload.delta as Partial<PathDayStat>, typeof payload.curriculum_id === "string" ? payload.curriculum_id : undefined);
    } else if (event.kind === "typing") {
      const records = sanitizeProgress({ version: 2, typing: [payload.round] }, progress.datasetId).typing;
      if (records.length && !progress.typing.some((item) => typingKey(item) === typingKey(records[0])))
        progress = { ...progress, typing: [...progress.typing, records[0]].slice(-500) };
    } else if (event.kind === "settings") {
      if (payload.settings && typeof payload.settings === "object" && !Array.isArray(payload.settings))
        settings = sanitizeSettings({ ...settings, ...(payload.settings as Record<string, unknown>) });
    } else if (event.kind === "session") {
      if (Object.prototype.hasOwnProperty.call(payload, "session")) {
        const session = validSession(payload.session, progress.datasetId);
        const current = progress.session;
        const sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined;
        const sessionStarted = typeof payload.session_started === "number" && Number.isFinite(payload.session_started)
          ? payload.session_started
          : undefined;
        if (session !== undefined) {
          if (session && !current)
            progress = { ...progress, session };
          else if (session && current && session.id === current.id)
            progress = { ...progress, session };
          else if (session && current && current.finished && !session.finished)
            progress = { ...progress, session };
          else if (session && current && !current.finished)
            progress = { ...progress, session: mergeActiveSessions(current, session) };
          else if (session === null && (!current || (sessionId && current.id === sessionId) || (current.finished && sessionStarted !== undefined && current.started <= sessionStarted)))
            progress = { ...progress, session: null };
        }
      }
    } else if (event.kind === "status") {
      const wordId = payload.word_id;
      const status = payload.status;
      if (typeof wordId === "string" && SAFE_ID.test(wordId) && (status === null || validWordStatus(status))) {
        const manualStatuses = { ...progress.manualStatuses };
        if (status === null) delete manualStatuses[wordId];
        else manualStatuses[wordId] = status;
        progress = { ...progress, manualStatuses };
      }
    }
  }
  return { progress, settings };
}

function typingKey(round: TypingRound): string {
  return `${round.at}:${round.mode}`;
}

async function postBatch(
  config: RemoteSyncConfig,
  datasetId: string,
  cursor: number,
  events: SyncEvent[],
  fetcher: EventFetch,
): Promise<{ cursor: number; events: ServerSyncEvent[]; has_more: boolean }> {
  const body = {
    profile_id: config.profileId,
    device_id: config.deviceId,
    dataset_id: datasetId,
    cursor,
    events: events.slice(0, MAX_BATCH_EVENTS),
  };
  const response = await fetcher(endpoint(config.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`同步服务器返回 HTTP ${response.status}。`);
  return validateReply(await response.json());
}

export interface EventSyncDependencies {
  storage?: EventStorage;
  fetcher?: EventFetch;
  getCurrent: () => EventSyncSnapshot;
  apply: (snapshot: EventSyncSnapshot) => void;
  makeBootstrap?: (progress: Progress, settings: Settings) => SyncEvent[];
}

/** Sends bounded outbox batches, drains server pages, and applies inbox only against an unchanged local snapshot. */
export async function syncEventStream(config: RemoteSyncConfig, datasetId: string, deps: EventSyncDependencies): Promise<void> {
  validConfig(config);
  const storage = deps.storage ?? localStorage;
  const fetcher = deps.fetcher ?? fetch;
  const lockKey = `${config.profileId}|${config.deviceId}|${datasetId}`;
  const active = locks.get(lockKey);
  if (active) return active;
  const run = (async () => {
    setStatus({ state: "syncing", message: "正在同步学习事件…" });
    try {
      let stable = false;
      while (!stable) {
        const snapshot = deps.getCurrent();
        const cursorKey = CURSOR_KEY(config.profileId, config.deviceId, datasetId);
        const bootstrapKey = BOOTSTRAP_KEY(config.profileId, config.deviceId, datasetId);
        const inboxKey = INBOX_KEY(config.profileId, config.deviceId, datasetId);
        let cursor = readJson<number>(storage, cursorKey, 0);
        let inbox = readJson<ServerSyncEvent[]>(storage, inboxKey, []);
        if (!readJson<boolean>(storage, bootstrapKey, false)) {
          const built = (deps.makeBootstrap ?? buildBootstrapEvents)(snapshot.progress, snapshot.settings);
          const key = OUTBOX_KEY(config.deviceId, datasetId);
          const outbox = readJson<SyncEvent[]>(storage, key, []);
          const ids = new Set(outbox.map((event) => event.event_id));
          outbox.push(...built.filter((event) => !ids.has(event.event_id)));
          writeJson(storage, key, outbox);
          writeJson(storage, bootstrapKey, true);
        }

        const sentIds = new Set<string>();
        let firstRequest = true;
        let drained = false;
        const acceptPage = (page: { cursor: number; events: ServerSyncEvent[]; has_more: boolean }) => {
          if (page.cursor < cursor) throw new Error("事件同步服务器游标倒退，已停止应用事件。");
          const ownIds = new Set(page.events.filter((event) => event.device_id === config.deviceId).map((event) => event.event_id));
          const outboxKey = OUTBOX_KEY(config.deviceId, datasetId);
          const remainder = readJson<SyncEvent[]>(storage, outboxKey, []).filter((event) => !ownIds.has(event.event_id));
          writeJson(storage, outboxKey, remainder);
          const knownInbox = new Set(inbox.map((event) => `${event.device_id}:${event.seq}`));
          inbox.push(...page.events.filter((event) => event.device_id !== config.deviceId && !knownInbox.has(`${event.device_id}:${event.seq}`)));
          cursor = page.cursor;
          writeJson(storage, inboxKey, inbox);
          writeJson(storage, cursorKey, cursor);
        };
        while (!drained) {
          const outboxKey = OUTBOX_KEY(config.deviceId, datasetId);
          const outbox = readJson<SyncEvent[]>(storage, outboxKey, []);
          const batch = boundedEventBatch(outbox, sentIds);
          batch.forEach((event) => sentIds.add(event.event_id));
          if (!batch.length && !firstRequest) break;
          firstRequest = false;
          let page = await postBatch(config, datasetId, cursor, batch, fetcher);
          acceptPage(page);
          while (page.has_more) {
            page = await postBatch(config, datasetId, cursor, [], fetcher);
            acceptPage(page);
          }
          const latest = readJson<SyncEvent[]>(storage, outboxKey, []);
          drained = latest.every((event) => sentIds.has(event.event_id));
        }

        const current = deps.getCurrent();
        if (current.progress === snapshot.progress && current.settings === snapshot.settings) {
          if (inbox.length) deps.apply(replaySyncEvents(current, inbox, config.deviceId));
          writeJson(storage, inboxKey, []);
          stable = true;
        }
      }
      const cursor = readJson<number>(storage, CURSOR_KEY(config.profileId, config.deviceId, datasetId), 0);
      setStatus({ state: "success", message: "事件同步完成", cursor });
    } catch (error) {
      const message = error instanceof TypeError && /fetch|network/i.test(error.message)
        ? "无法连接学习进度同步服务器；这不影响价签直连。请检查服务器 URL，或关闭自动同步。"
        : error instanceof Error ? error.message : "事件同步失败。";
      setStatus({ state: "error", message });
      throw error;
    }
  })();
  locks.set(lockKey, run);
  try {
    await run;
  } finally {
    if (locks.get(lockKey) === run) locks.delete(lockKey);
  }
}

export function eventOutboxKeyForTesting(deviceId: string, datasetId: string): string {
  return OUTBOX_KEY(deviceId, datasetId);
}

export function eventCursorKeyForTesting(profile: string, device: string, dataset: string): string {
  return CURSOR_KEY(profile, device, dataset);
}

export function emptySyncSnapshot(datasetId: string): EventSyncSnapshot {
  return { progress: emptyProgress(datasetId), settings: sanitizeSettings(null) };
}
