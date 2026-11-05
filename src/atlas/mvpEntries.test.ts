import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, root), "utf8")) as T;
const ids = ["arid", "artifact", "deteriorate", "notion", "urbanization", "abate", "works", "scenario", "exploit", "enterprise", "denial"];
const mediaById: Record<string, number> = {
  arid: 15,
  artifact: 15,
  deteriorate: 15,
  notion: 15,
  urbanization: 15,
  abate: 31,
  works: 15,
  scenario: 15,
  exploit: 15,
  enterprise: 15,
  denial: 15,
};

test("new entries stay searchable, chunk-addressable, and tagged for TOEFL", () => {
  const data = readJson<Array<{ id: string; ex: unknown[] }>>("data/word-atlas.json");
  const index = readJson<{ count: number; examples: number; chunk: number; words: Array<[string, string, string, string, number, number, number]> }>("public/atlas/index.json");
  const tags = readJson<{ tags: Record<string, string[]> }>("public/atlas/exam-tags.json");

  assert.equal(data.length, 7_309);
  assert.equal(index.count, data.length);
  assert.equal(index.examples, data.reduce((total, entry) => total + entry.ex.length, 0));
  assert.deepEqual(data.slice(-ids.length).map((entry) => entry.id), ids);
  assert.equal(new Set(index.words.map((row) => row[0])).size, index.words.length);
  assert.equal(new Set(index.words.map((row) => row[1].normalize("NFC").trim().toLowerCase())).size, index.words.length);

  for (const id of ids) {
    const expectedMedia = mediaById[id];
    const order = index.words.findIndex((row) => row[0] === id);
    assert.notEqual(order, -1, `${id} is missing from the search index`);
    assert.equal(index.words[order][6], expectedMedia, `${id} has an unexpected media flag`);
    assert.ok(tags.tags[id]?.length, `${id} is missing its exam tags`);
    const chunk = readJson<Array<{ id: string; m: number }>>(`public/atlas/entries/${Math.floor(order / index.chunk)}.json`);
    assert.equal(chunk[order % index.chunk]?.id, id, `${id} is not addressable at its indexed chunk offset`);
    assert.equal(chunk[order % index.chunk]?.m, expectedMedia, `${id} has an unexpected chunk media flag`);
  }

  const csvLines = readFileSync(new URL("data/word-atlas.csv", root), "utf8").trimEnd().split(/\r?\n/);
  assert.equal(csvLines.length, data.length + 1);
  assert.deepEqual(csvLines.slice(-ids.length).map((line) => line.slice(0, line.indexOf(","))), ids);
});
