import assert from "node:assert/strict";
import test from "node:test";
import { buildLabelBody, buildSyncBody, endpoint, getLabelStatus, getRemoteSyncConfig, labelWordsFromAtlas, syncLabelWords, syncProgress, type RemoteSyncConfig } from "./remoteSync";

const requestId = "018f3f4a-5c9a-7b2c-8000-000000000001";

const config: RemoteSyncConfig = {
  baseUrl: "https://sync.example.test/",
  profileId: "profile-a",
  token: "wa-secret",
  deviceId: "device-a",
  autoSync: false,
};

test("persists one device identity before remote sync is configured", () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    const first = getRemoteSyncConfig();
    const second = getRemoteSyncConfig();
    assert.equal(first.deviceId, second.deviceId);
    assert.ok(values.size > 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("builds the progress contract without changing progress content", () => {
  const progress = { version: 2, datasetId: "word-atlas-open", cards: { library: { due: 1 } } };
  assert.deepEqual(buildSyncBody("p", "d", "word-atlas-open", progress, "2026-01-02T03:04:05.000Z"), {
    profile_id: "p",
    device_id: "d",
    dataset_id: "word-atlas-open",
    progress,
    client_updated_at: "2026-01-02T03:04:05.000Z",
  });
  assert.equal(endpoint("https://sync.example.test///", "/api/word-atlas/sync"), "https://sync.example.test/api/word-atlas/sync");
  assert.throws(() => endpoint("file:///tmp", "/api/word-atlas/sync"), /HTTPS/);
  assert.throws(() => endpoint("http://sync.example.test", "/api/word-atlas/sync"), /HTTPS/);
  assert.equal(endpoint("http://127.0.0.1:8765", "/api/word-atlas/sync"), "http://127.0.0.1:8765/api/word-atlas/sync");
});

test("maps loaded atlas word refs to safe label IDs and words", () => {
  const words = labelWordsFromAtlas([
    { id: "a:1", word: "abandon" } as never,
    { id: "wood-shed", word: "woodshed" } as never,
  ]);
  assert.deepEqual(buildLabelBody("p", "word-atlas-open", words, requestId), {
    request_id: requestId,
    profile_id: "p",
    dataset_id: "word-atlas-open",
    cards: [{ id: "a:1", word: "abandon" }, { id: "wood-shed", word: "woodshed" }],
  });
  assert.throws(() => buildLabelBody("p", "d", [{ id: "not/allowed", text: "word" }], requestId), /不安全字符/);
  assert.throws(() => buildLabelBody("p", "d", [], requestId), /1 到 64/);
  assert.throws(() => buildLabelBody("p", "d", Array.from({ length: 65 }, (_, i) => ({ id: `w${i}`, text: `word${i}` })), requestId), /1 到 64/);
});

test("posts label words using an independent bearer token", async () => {
  let request: RequestInit | undefined;
  const reply = await syncLabelWords(config, "word-atlas-open", [{ id: "library", text: "library" }], async (_input, init) => {
    request = init;
    return new Response(JSON.stringify({ job_id: requestId, status: "queued" }), { status: 202, headers: { "Content-Type": "application/json" } });
  });
  assert.deepEqual(reply, { job_id: requestId, status: "queued" });
  assert.equal((request?.headers as Record<string, string>).Authorization, "Bearer wa-secret");
  assert.deepEqual(JSON.parse(String(request?.body)), {
    profile_id: "profile-a",
    dataset_id: "word-atlas-open",
    request_id: JSON.parse(String(request?.body)).request_id,
    cards: [{ id: "library", word: "library" }],
  });
  assert.match(JSON.parse(String(request?.body)).request_id, /^[0-9a-f-]{36}$/);
});

test("reads a bounded label job status with bearer authentication", async () => {
  const reply = await getLabelStatus(config, requestId, async (_input, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer wa-secret");
    return new Response(JSON.stringify({ job_id: requestId, status: "succeeded", created_at: "2026-01-02T03:04:05Z", updated_at: "2026-01-02T03:05:05Z", error: null }), { status: 200 });
  });
  assert.equal(reply.status, "succeeded");
});

test("sync returns the server progress envelope and rejects malformed responses", async () => {
  const reply = await syncProgress(config, "word-atlas-open", { version: 2 }, async (_input, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer wa-secret");
    return new Response(JSON.stringify({ progress: { version: 2, datasetId: "word-atlas-open" }, server_updated_at: "2026-01-02T03:04:05.000Z", version: 3 }), { status: 200 });
  });
  assert.equal(reply.version, 3);
  await assert.rejects(
    () => syncProgress(config, "word-atlas-open", {}, async () => new Response(JSON.stringify({ progress: {} }), { status: 200 })),
    /格式不正确/,
  );
  await assert.rejects(
    () => syncProgress(config, "word-atlas-open", {}, async () => new Response(JSON.stringify({
      progress: { version: 2, datasetId: "another-atlas" },
      server_updated_at: "2026-01-02T03:04:05.000Z",
      version: 3,
    }), { status: 200 })),
    /与当前词库不匹配/,
  );
  await assert.rejects(
    () => syncProgress(config, "word-atlas-open", {}, async () => new Response(JSON.stringify({
      progress: {},
      server_updated_at: "2026-01-02T03:04:05.000Z",
      version: 3,
    }), { status: 200 })),
    /与当前词库不匹配/,
  );
});
