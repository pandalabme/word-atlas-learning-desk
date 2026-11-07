import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBootstrapEvents,
  boundedEventBatch,
  emptySyncSnapshot,
  enqueueSyncEvent,
  eventCursorKeyForTesting,
  eventOutboxKeyForTesting,
  getEventSyncStatus,
  replaySyncEvents,
  syncEventStream,
  type EventStorage,
  type ServerSyncEvent,
  type SyncEvent,
} from "./eventSync";
import { Rating } from "../store/srs";
import type { Settings } from "../store/store";

class MemoryStorage implements EventStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const settings: Settings = {
  accent: "uk", autoplay: true, dailyNew: 10, retention: 0.9, theme: "dark", sfx: true, spell: true,
  startLevel: 0, onboarded: true, dataset: "open", curriculum: "ielts", ambience: "off", ambienceVolume: 0.4, splash: false,
};
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const serverEvent = (seq: number, deviceId: string, event: SyncEvent): ServerSyncEvent => ({ ...event, seq, device_id: deviceId });
const config = { baseUrl: "https://sync.example.test", profileId: "profile-a", deviceId: "device-a", token: "secret", autoSync: false };

test("bootstrap is chunked below 64 KiB and includes a resumable session checkpoint", () => {
  const snapshot = emptySyncSnapshot("word-atlas-open");
  snapshot.progress.bookmarks = Array.from({ length: 1300 }, (_, i) => `bookmark-${i}-${"x".repeat(45)}`);
  snapshot.progress.mistakes = ["wrong-a", "wrong-b"];
  snapshot.progress.typing = Array.from({ length: 500 }, (_, i) => ({ at: i + 1, mode: "word" as const, items: 10, wpm: 50, accuracy: 95 }));
  snapshot.progress.manualStatuses = { "word-a": "learning", "word-b": "mastered" };
  snapshot.progress.session = { id: "private-session", started: 1, steps: [], index: 0, graded: {}, newIds: [], reviewIds: [] };
  const events = buildBootstrapEvents(snapshot.progress, settings, (() => { let n = 0; return () => uid(++n); })());
  assert.ok(events.length > 1);
  for (const event of events) assert.ok(new TextEncoder().encode(JSON.stringify(event)).byteLength <= 64 * 1024);
  const payloads = events.map((event) => event.payload);
  assert.ok(payloads.some((payload) => Array.isArray(payload.mistakes)));
  assert.ok(payloads.some((payload) => Array.isArray(payload.statuses)));
  assert.ok(payloads.some((payload) => (payload.session as { id?: string } | undefined)?.id === "private-session"));
  assert.equal(JSON.stringify(payloads).includes('"token"'), false);
});

test("replay applies and clears manual atlas statuses from another device", () => {
  const initial = emptySyncSnapshot("word-atlas-open");
  initial.progress.manualStatuses = { apple: "learning" };
  const mastered: SyncEvent = {
    event_id: uid(42), occurred_at: "2026-01-01T00:00:01.000Z", kind: "status",
    payload: { word_id: "apple", status: "mastered" },
  };
  const cleared: SyncEvent = {
    event_id: uid(43), occurred_at: "2026-01-01T00:00:02.000Z", kind: "status",
    payload: { word_id: "apple", status: null },
  };
  const updated = replaySyncEvents(initial, [serverEvent(1, "phone", mastered)], "pc");
  assert.equal(updated.progress.manualStatuses.apple, "mastered");
  const restored = replaySyncEvents(updated, [serverEvent(2, "phone", cleared)], "pc");
  assert.equal(restored.progress.manualStatuses.apple, undefined);
});

test("replay merges a completed remote journey and clears it after remote completion", () => {
  const initial = emptySyncSnapshot("word-atlas-open");
  initial.progress.session = {
    id: "pc-session", started: 10, steps: [{ id: "apple", kind: "intro" }], index: 0,
    graded: {}, newIds: ["apple"], reviewIds: [],
  };
  const remoteSession: SyncEvent = {
    event_id: uid(40), occurred_at: "2026-01-01T00:00:01.000Z", kind: "session",
    payload: { session: { id: "phone-session", started: 20, steps: [{ id: "apple", kind: "intro" }], index: 1, graded: { apple: Rating.Good }, newIds: ["apple"], reviewIds: [] } },
  };
  const remoteDone: SyncEvent = {
    event_id: uid(41), occurred_at: "2026-01-01T00:00:02.000Z", kind: "session", payload: { session: null },
  };
  const resumed = replaySyncEvents(initial, [serverEvent(1, "phone", remoteSession)], "pc");
  assert.equal(resumed.progress.session?.id, "pc-session");
  assert.equal(resumed.progress.session?.finished !== undefined, true);
  const completed = replaySyncEvents(resumed, [serverEvent(2, "phone", { ...remoteDone, payload: { session: null, session_id: "phone-session", session_started: 20 } })], "pc");
  assert.equal(completed.progress.session, null);
});

test("independently started journeys merge completed words instead of replacing each other", () => {
  const initial = emptySyncSnapshot("word-atlas-open");
  initial.progress.session = {
    id: "local-session", started: 100,
    steps: [
      { id: "a", kind: "intro" }, { id: "a", kind: "meaning", options: ["a", "b", "c"] },
      { id: "b", kind: "intro" }, { id: "b", kind: "meaning", options: ["a", "b", "c"] },
      { id: "c", kind: "intro" }, { id: "c", kind: "meaning", options: ["a", "b", "c"] },
    ],
    index: 0, graded: {}, newIds: ["a", "b", "c"], reviewIds: [],
    curriculumId: "ielts",
  };
  const remote: SyncEvent = {
    event_id: uid(46), occurred_at: "2026-01-01T00:00:05.000Z", kind: "session",
    payload: {
      session: {
        id: "remote-session", started: 200,
        steps: [
          { id: "a", kind: "intro" }, { id: "a", kind: "meaning", options: ["a", "b", "c"] },
          { id: "b", kind: "intro" }, { id: "b", kind: "meaning", options: ["a", "b", "c"] },
          { id: "c", kind: "intro" }, { id: "c", kind: "meaning", options: ["a", "b", "c"] },
        ],
        index: 4, graded: { a: Rating.Good, b: Rating.Good }, newIds: ["a", "b", "c"], reviewIds: [], curriculumId: "ielts",
      },
    },
  };
  const merged = replaySyncEvents(initial, [serverEvent(1, "phone", remote)], "pc");
  assert.equal(merged.progress.session?.id, "local-session");
  assert.deepEqual(merged.progress.session?.steps.map((step) => step.id), ["c", "c"]);
  assert.deepEqual(merged.progress.session?.newIds, ["c"]);
});

test("journey merge never appends a larger remote plan", () => {
  const initial = emptySyncSnapshot("word-atlas-open");
  initial.progress.session = {
    id: "local-session", started: 100,
    steps: [{ id: "a", kind: "intro" }, { id: "a", kind: "meaning", options: ["a"] }],
    index: 0, graded: {}, newIds: ["a"], reviewIds: [], curriculumId: "ielts",
  };
  const remote: SyncEvent = {
    event_id: uid(47), occurred_at: "2026-01-01T00:00:06.000Z", kind: "session",
    payload: {
      session: {
        id: "remote-session", started: 200,
        steps: [
          { id: "a", kind: "intro" }, { id: "a", kind: "meaning", options: ["a"] },
          { id: "b", kind: "intro" }, { id: "b", kind: "meaning", options: ["b"] },
        ],
        index: 0, graded: {}, newIds: ["a", "b"], reviewIds: [], curriculumId: "ielts",
      },
    },
  };
  const merged = replaySyncEvents(initial, [serverEvent(1, "phone", remote)], "pc");
  assert.equal(merged.progress.session?.steps.length, 2);
  assert.deepEqual(merged.progress.session?.newIds, ["a"]);
});

test("remote reviews remove already completed words from the pending local journey", () => {
  const initial = emptySyncSnapshot("word-atlas-open");
  initial.progress.session = {
    id: "pc-session", started: 10,
    steps: [
      { id: "done-remotely", kind: "intro" },
      { id: "done-remotely", kind: "meaning", options: ["done-remotely"] },
      { id: "keep", kind: "intro" },
    ],
    index: 0, graded: {}, newIds: ["done-remotely", "keep"], reviewIds: [],
  };
  const remoteReview: SyncEvent = {
    event_id: uid(44), occurred_at: "2026-01-01T00:00:03.000Z", kind: "review",
    payload: { word_id: "done-remotely", grade: Rating.Good, retention: 0.9 },
  };
  const result = replaySyncEvents(initial, [serverEvent(1, "phone", remoteReview)], "pc");
  assert.deepEqual(result.progress.session?.steps.map((step) => step.id), ["keep"]);
  assert.deepEqual(result.progress.session?.newIds, ["keep"]);
});

test("an old session completion cannot clear a newer active journey", () => {
  const initial = emptySyncSnapshot("word-atlas-open");
  initial.progress.session = {
    id: "new-session", started: 200, steps: [{ id: "keep", kind: "intro" }], index: 0, graded: {}, newIds: ["keep"], reviewIds: [],
  };
  const oldDone: SyncEvent = {
    event_id: uid(45), occurred_at: "2026-01-01T00:00:04.000Z", kind: "session",
    payload: { session: null, session_id: "old-session", session_started: 100 },
  };
  const result = replaySyncEvents(initial, [serverEvent(1, "phone", oldDone)], "pc");
  assert.equal(result.progress.session?.id, "new-session");
});

test("event batches obey both the 500-event and request-byte bounds", () => {
  const large = Array.from({ length: 100 }, (_, i): SyncEvent => ({
    event_id: uid(2000 + i), occurred_at: new Date(i).toISOString(), kind: "bootstrap",
    payload: { values: "x".repeat(60 * 1024) },
  }));
  const batch = boundedEventBatch(large);
  assert.ok(batch.length < large.length);
  assert.ok(new TextEncoder().encode(JSON.stringify(batch)).byteLength < 5 * 1024 * 1024);
  assert.equal(boundedEventBatch(Array.from({ length: 501 }, (_, i) => ({ ...large[0], event_id: uid(3000 + i), payload: {} }))).length, 500);
});

test("replay orders remote events, ignores self events, deduplicates typing, and applies deltas safely", () => {
  const initial = emptySyncSnapshot("word-atlas-open");
  const bookmarkAdd: SyncEvent = { event_id: uid(1), occurred_at: "2026-01-01T00:00:02.000Z", kind: "bookmark", payload: { word_id: "apple", action: "add" } };
  const bookmarkRemove: SyncEvent = { event_id: uid(2), occurred_at: "2026-01-01T00:00:03.000Z", kind: "bookmark", payload: { word_id: "apple", action: "remove" } };
  const again: SyncEvent = { event_id: uid(3), occurred_at: "2026-01-01T00:00:04.000Z", kind: "review", payload: { word_id: "apple", grade: Rating.Again, retention: 0.9, curriculum_id: "toefl-ibt-2026", stats_delta: { day_key: "2026-01-01", delta: { r: 1, c: 0, n: 1 } } } };
  const malformed: SyncEvent = { event_id: uid(4), occurred_at: "2026-01-01T00:00:05.000Z", kind: "review", payload: { word_id: "pear", grade: Rating.Good, retention: 0.9, stats_delta: { day_key: "2026-01-01", delta: { r: "oops", c: Infinity } } } };
  const typing: SyncEvent = { event_id: uid(5), occurred_at: "2026-01-01T00:00:06.000Z", kind: "typing", payload: { round: { at: 10, mode: "word", items: 2, wpm: 40, accuracy: 90 } } };
  const applied = replaySyncEvents(initial, [
    serverEvent(3, "other-device", bookmarkRemove),
    serverEvent(2, "other-device", bookmarkAdd),
    serverEvent(4, "other-device", again),
    serverEvent(5, "other-device", malformed),
    serverEvent(6, "other-device", typing),
    serverEvent(7, "other-device", typing),
    serverEvent(8, "device-a", { ...again, event_id: uid(8), payload: { ...again.payload, word_id: "self" } }),
  ], "device-a");
  assert.deepEqual(applied.progress.bookmarks, []);
  assert.ok(applied.progress.cards.apple);
  assert.equal(applied.progress.cards.self, undefined);
  assert.deepEqual(applied.progress.mistakes, ["apple"]);
  assert.equal(applied.progress.days["2026-01-01"].r, 1);
  assert.equal(applied.progress.days["2026-01-01"].n, 1);
  assert.equal(applied.progress.days["2026-01-01"].paths?.["toefl-ibt-2026"]?.n, 1);
  assert.deepEqual(applied.progress.days["2026-01-01"].words, ["apple", "pear"]);
  assert.equal(applied.progress.typing.length, 1);
});

test("an older remote review cannot rewind an offline card, while another word still merges", () => {
  const initial = emptySyncSnapshot("word-atlas-open");
  initial.progress.cards.apple = { due: 500, s: 2, d: 5, el: 1, sd: 2, ls: 0, reps: 2, lapses: 0, st: 2, last: 200, seen: 100 };
  const stale: SyncEvent = { event_id: uid(31), occurred_at: new Date(100).toISOString(), kind: "review", payload: { word_id: "apple", grade: Rating.Again, retention: 0.9, stats_delta: { day_key: "1970-01-01", delta: { r: 1 } } } };
  const other: SyncEvent = { event_id: uid(32), occurred_at: new Date(300).toISOString(), kind: "review", payload: { word_id: "pear", grade: Rating.Good, retention: 0.9, stats_delta: { day_key: "1970-01-01", delta: { r: 1, c: 1 } } } };
  const result = replaySyncEvents(initial, [serverEvent(1, "remote", stale), serverEvent(2, "remote", other)], "local");
  assert.equal(result.progress.cards.apple.last, 200);
  assert.equal(result.progress.days["1970-01-01"].r, 1);
  assert.ok(result.progress.cards.pear);
});

test("sync persists integer cursor and device-scoped outbox across bounded pagination", async () => {
  const storage = new MemoryStorage();
  const snapshot = emptySyncSnapshot("word-atlas-open");
  const outboxEvent: SyncEvent = { event_id: uid(11), occurred_at: "2026-03-01T00:00:00.000Z", kind: "bookmark", payload: { word_id: "one", action: "add" } };
  enqueueSyncEvent(storage, config.deviceId, snapshot.progress.datasetId, outboxEvent);
  const requests: Record<string, unknown>[] = [];
  let applied = snapshot;
  const remote: SyncEvent = { event_id: uid(12), occurred_at: "2026-03-01T00:00:01.000Z", kind: "bookmark", payload: { word_id: "two", action: "add" } };
  await syncEventStream(config, snapshot.progress.datasetId, {
    storage,
    getCurrent: () => snapshot,
    apply: (next) => { applied = next; },
    makeBootstrap: () => [],
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      const firstPage = requests.length === 1;
      const events = firstPage
        ? (body.events as SyncEvent[]).map((event, i) => serverEvent(i + 1, config.deviceId, event))
        : [serverEvent(2, "other-device", remote)];
      return new Response(JSON.stringify({ cursor: firstPage ? 1 : 2, events, has_more: firstPage }), { status: 200 });
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].cursor, 0);
  assert.equal(requests[0].profile_id, config.profileId);
  assert.equal((requests[0].events as unknown[]).length, 1);
  assert.deepEqual(requests[1].events, []);
  assert.equal(storage.getItem(eventCursorKeyForTesting(config.profileId, config.deviceId, snapshot.progress.datasetId)), "2");
  assert.deepEqual(JSON.parse(storage.getItem(eventOutboxKeyForTesting(config.deviceId, snapshot.progress.datasetId)) ?? "null"), []);
  assert.deepEqual(applied.progress.bookmarks, ["two"]);
});

test("sync emits a fresh active-journey checkpoint after the old cursor was consumed", async () => {
  const storage = new MemoryStorage();
  const snapshot = emptySyncSnapshot("word-atlas-open");
  snapshot.progress.session = {
    id: "active-session", started: 10, steps: [{ id: "apple", kind: "intro" }], index: 0,
    graded: {}, newIds: ["apple"], reviewIds: [], curriculumId: "ielts",
  };
  const requests: SyncEvent[][] = [];
  let sequence = 31873;
  await syncEventStream({ ...config, deviceId: "device-checkpoint" }, snapshot.progress.datasetId, {
    storage,
    getCurrent: () => snapshot,
    apply: () => undefined,
    makeBootstrap: () => [],
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { events: SyncEvent[] };
      requests.push(body.events);
      const events = body.events.map((event) => serverEvent(++sequence, "device-checkpoint", event));
      return new Response(JSON.stringify({ cursor: sequence, events, has_more: false }), { status: 200 });
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0]?.kind, "session");
  assert.equal((requests[0][0]?.payload.session as { id: string }).id, "active-session");
});

test("events queued for one device are not sent under a different device identity", () => {
  const storage = new MemoryStorage();
  const event: SyncEvent = { event_id: uid(20), occurred_at: new Date(0).toISOString(), kind: "bookmark", payload: { word_id: "x", action: "add" } };
  enqueueSyncEvent(storage, "device-one", "dataset", event);
  assert.ok(storage.getItem(eventOutboxKeyForTesting("device-one", "dataset")));
  assert.equal(storage.getItem(eventOutboxKeyForTesting("device-two", "dataset")), null);
});

test("one sync call sends the entire outbox in batches of at most 500", async () => {
  const storage = new MemoryStorage();
  const snapshot = emptySyncSnapshot("word-atlas-open");
  for (let i = 1; i <= 501; i++) {
    enqueueSyncEvent(storage, config.deviceId, snapshot.progress.datasetId, {
      event_id: uid(100 + i), occurred_at: new Date(i).toISOString(), kind: "bookmark", payload: { word_id: `word-${i}`, action: "add" },
    });
  }
  const batchSizes: number[] = [];
  let seq = 0;
  await syncEventStream(config, snapshot.progress.datasetId, {
    storage,
    getCurrent: () => snapshot,
    apply: () => undefined,
    makeBootstrap: () => [],
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { cursor: number; events: SyncEvent[] };
      batchSizes.push(body.events.length);
      const events = body.events.map((event) => serverEvent(++seq, config.deviceId, event));
      return new Response(JSON.stringify({ cursor: seq, events, has_more: false }), { status: 200 });
    },
  });
  assert.deepEqual(batchSizes, [500, 1]);
  assert.deepEqual(JSON.parse(storage.getItem(eventOutboxKeyForTesting(config.deviceId, snapshot.progress.datasetId)) ?? "null"), []);
});

test("network failures explain that direct price-tag Bluetooth is unaffected", async () => {
  const storage = new MemoryStorage();
  const snapshot = emptySyncSnapshot("word-atlas-open");
  await assert.rejects(() => syncEventStream(config, snapshot.progress.datasetId, {
    storage,
    getCurrent: () => snapshot,
    apply: () => undefined,
    makeBootstrap: () => [],
    fetcher: async () => { throw new TypeError("Failed to fetch"); },
  }), /Failed to fetch/);
  assert.equal(
    getEventSyncStatus().message,
    "无法连接学习进度同步服务器；这不影响价签直连。请检查服务器 URL，或关闭自动同步。",
  );
});
