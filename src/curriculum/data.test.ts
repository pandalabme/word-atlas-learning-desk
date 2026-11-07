import assert from "node:assert/strict";
import test from "node:test";
import type { Atlas, WordRef } from "../atlas/types";
import { buildCurriculum, validateCurriculumManifest } from "./data";
import type { CurriculumManifest } from "./types";

const words: WordRef[] = [
  { id: "w1", word: "alpha", zh: "甲", ipa: "", cefr: 0, topic: 0, media: 0, examTags: ["cet4"], order: 0 },
  { id: "w2", word: "beta", zh: "乙", ipa: "", cefr: 2, topic: 1, media: 0, examTags: ["ielts", "toefl"], order: 1 },
  { id: "w3", word: "gamma", zh: "丙", ipa: "", cefr: 3, topic: 0, media: 0, examTags: ["toefl"], order: 2 },
  { id: "w4", word: "delta", zh: "丁", ipa: "", cefr: 5, topic: 1, media: 0, examTags: [], order: 3 },
];
const atlas = {
  id: "test",
  name: "Test",
  kind: "open",
  count: words.length,
  examples: 0,
  illustrated: 0,
  topics: [["one", "一"], ["two", "二"]],
  cefr: ["A1", "A2", "B1", "B2", "C1", "C2"],
  words,
  byId: new Map(words.map((word) => [word.id, word])),
  entry: async () => { throw new Error("unused"); },
  peek: () => undefined,
  img: () => null,
  audio: () => null,
} as unknown as Atlas;

const manifest = (selection: CurriculumManifest["selection"]): CurriculumManifest => ({
  id: "test-path",
  version: 1,
  name: "Test path",
  description: "Test",
  attribution: { curator: "Test", official: false, note: "Test curated, not official" },
  selection,
  domains: [{ id: "one", name: "One", topicIds: [0] }],
});

test("manifest JSON validation rejects duplicate IDs, unknown fields, and dangerous keys", () => {
  assert.throws(() => validateCurriculumManifest({ ...manifest({ mode: "explicit", ids: ["w1", "w1"] }) }), /duplicates/);
  assert.throws(() => validateCurriculumManifest({ ...manifest({ mode: "all" }), extra: true }), /unknown field/);
  const unsafe = JSON.parse('{"id":"test-path","version":1,"name":"Path","description":"x","attribution":{"curator":"x","official":false,"note":"x"},"selection":{"mode":"all"},"domains":[],"wordOverrides":{"__proto__":{"relevance":0.5}}}');
  assert.throws(() => validateCurriculumManifest(unsafe), /unsafe word ID/);
  assert.throws(() => validateCurriculumManifest({ ...manifest({ mode: "all" }), wordOverrides: { w1: { relevance: 0.5, constructor: "bad" } } }), /unsafe field|unknown field/);
});

test("explicit and filtered selections preserve deterministic ordering and reject unknown or empty choices", () => {
  assert.deepEqual(buildCurriculum(atlas, manifest({ mode: "explicit", ids: ["w3", "w1"] })).words.map((word) => word.id), ["w3", "w1"]);
  assert.deepEqual(buildCurriculum(atlas, manifest({ mode: "filter", filter: { minCefr: "B1", maxCefr: "C1", topicIds: [0] } })).words.map((word) => word.id), ["w3"]);
  assert.throws(() => buildCurriculum(atlas, manifest({ mode: "explicit", ids: ["missing"] })), /Unknown atlas word ID/);
  assert.throws(() => buildCurriculum(atlas, manifest({ mode: "filter", filter: { minCefr: "C2", topicIds: [0] } })), /selected no words/);
  assert.throws(() => validateCurriculumManifest({ ...manifest({ mode: "explicit", ids: [] }) }), /cannot be empty/);
  assert.throws(() => validateCurriculumManifest({ ...manifest({ mode: "filter", filter: { topicIds: [] } }) }), /cannot be empty/);
});

test("domain and relevance overrides apply to runtime words", () => {
  const input = { ...manifest({ mode: "all" }), wordOverrides: { w2: { relevance: 0.75, domains: ["one"] } } };
  const result = buildCurriculum(atlas, input);
  assert.equal(result.byId.get("w2")?.relevance, 0.75);
  assert.deepEqual(result.byId.get("w2")?.domains, ["one"]);
  assert.deepEqual(result.domains.get("one")?.wordIds, ["w1", "w2", "w3"]);
});

test("exam filters use any tag, combine with CEFR and topics, and preserve atlas order", () => {
  const result = buildCurriculum(atlas, manifest({ mode: "filter", filter: { minCefr: "B1", maxCefr: "B2", topicIds: [0, 1], examTags: ["ielts", "toefl"] } }));
  assert.deepEqual(result.words.map((word) => word.id), ["w2", "w3"]);
});

test("exam filters reject unknown and duplicate tags", () => {
  const unknownTag = { ...manifest({ mode: "all" }), selection: { mode: "filter", filter: { examTags: ["bad"] } } };
  assert.throws(() => validateCurriculumManifest(unknownTag), /unknown tag/);
  assert.throws(() => validateCurriculumManifest({ ...manifest({ mode: "filter", filter: { examTags: ["ielts", "ielts"] } }) }), /duplicates/);
});
