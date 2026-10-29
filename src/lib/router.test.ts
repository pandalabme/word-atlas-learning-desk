import assert from "node:assert/strict";
import test from "node:test";

Object.defineProperty(globalThis, "location", { configurable: true, value: { hash: "#/" } });
Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {} } });

test("read routes parse and encode article IDs", async () => {
  const { href, parseLocation } = await import("./router");
  assert.deepEqual(parseLocation("#/read/a-short-story"), { route: { page: "read", id: "a-short-story" }, word: null });
  assert.equal(href({ page: "read", id: "city-life" }), "#/read/city-life");
  assert.deepEqual(parseLocation("#/read"), { route: { page: "read", id: undefined }, word: null });
});
