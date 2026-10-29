import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBootstrapEvents,
  boundedEventBatch,
  emptySyncSnapshot,
  enqueueSyncEvent,
  eventCursorKeyForTesting,
  eventOutboxKeyForTesting,
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
  startLevel: 0, onboarded: true, dataset: "open", ambience: "off", ambienceVolume: 0.4, splash: false,
};
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const serverEvent = (seq: number, deviceId: string, event: SyncEvent): ServerSyncEvent => ({ ...event, seq, device_id: deviceId });
const config = { baseUrl: "https://sync.example.test", profileId: "profile-a", deviceId: "device-a", token: "secret", autoSync: false };

test("bootstrap is chunked below 64 KiB and excludes session state", () => {
  const snapshot = emptySyncSnapshot("word-atlas-open");
  snapshot.progress.bookmarks = Array.from({ length: 1300 }, (_, i) => `bookmark-${i}-${"x".repeat(45)}`);
  snapshot.progress.mistakes = ["wrong-a", "wrong-b"];
  snapshot.progress.typing = Array.from({ length: 500 }, (_, i) => ({ at: i + 1, mode: "word" as const, items: 10, wpm: 50, accuracy: 95 }));
  snapshot.progress.session = { id: "private-session", started: 1, steps: [], index: 0, graded: {}, newIds: [], reviewIds: [] };
  const events = buildBootstrapEvents(snapshot.progress, settings, (() => { let n = 0; return () => uid(++n); })());
  assert.ok(events.length > 1);
  for (const event of events) assert.ok(new TextEncoder().encode(JSON.stringify(event)).byteLength <= 64 * 1024);
  const payloads = events.map((event) => event.payload);
  assert.ok(payloads.some((payload) => Array.isArray(payload.mistakes)));
  assert.equal(JSON.stringify(payloads).includes("private-session"), false);
  assert.equal(JSON.stringify(payloads).includes('"token"'), false);
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
  const again: SyncEvent = { event_id: uid(3), occurred_at: "2026-01-01T00:00:04.000Z", kind: "review", payload: { word_id: "apple", grade: Rating.Again, retention: 0.9, stats_delta: { day_key: "2026-01-01", delta: { r: 1, c: 0, n: 1 } } } };
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
