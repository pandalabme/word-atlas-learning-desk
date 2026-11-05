import assert from "node:assert/strict";
import test from "node:test";
import { EXAM_TAG_LABELS, parseExamTagsSidecar } from "./examTags";
import { legacyMediaFallback, resolveMediaBase } from "./mediaBase";

const source = {
  name: "ECDICT",
  repository: "https://github.com/skywind3000/ECDICT",
  commit: "a".repeat(40),
  sha256: "b".repeat(64),
  license: "MIT",
};

test("exam sidecar validates tag whitelist, word IDs, and duplicate-free lists", () => {
  assert.deepEqual(parseExamTagsSidecar({ version: 1, source, tags: { w1: ["cet4", "ielts"] } }, new Set(["w1"])).get("w1"), ["cet4", "ielts"]);
  assert.throws(() => parseExamTagsSidecar({ version: 1, source, tags: { w1: ["other"] } }, new Set(["w1"])), /invalid tags/);
  assert.throws(() => parseExamTagsSidecar({ version: 1, source, tags: { w1: ["ielts", "ielts"] } }, new Set(["w1"])), /duplicate/);
  assert.throws(() => parseExamTagsSidecar({ version: 1, source, tags: { w1: [] } }, new Set(["w1"])), /invalid tags/);
  assert.throws(() => parseExamTagsSidecar({ version: 1, source, tags: { missing: ["ielts"] } }, new Set(["w1"])), /unknown word ID/);
  assert.throws(() => parseExamTagsSidecar({ version: 2, source, tags: {} }, new Set()), /version/);
  assert.throws(() => parseExamTagsSidecar({ version: 1, source: { ...source, commit: "short" }, tags: {} }, new Set()), /source metadata/);
  assert.throws(() => parseExamTagsSidecar({ version: 1, source, tags: {}, extra: true }, new Set()), /unknown fields/);
});

test("exam tags have stable learner-facing labels", () => {
  assert.deepEqual(EXAM_TAG_LABELS, {
    zk: "中考",
    gk: "高考",
    cet4: "CET-4",
    cet6: "CET-6",
    ky: "考研",
    ielts: "IELTS",
    toefl: "TOEFL",
    gre: "GRE",
  });
});

test("media defaults to the deployed site and accepts an explicit media host", () => {
  assert.equal(resolveMediaBase("/electronic_diy/"), "/electronic_diy");
  assert.equal(resolveMediaBase("/", ""), "");
  assert.equal(resolveMediaBase("/electronic_diy/", "https://media.example/"), "https://media.example");
  assert.equal(legacyMediaFallback("/atlas/img/arid.webp"), "https://0xlei.tech/words/atlas/img/arid.webp");
  assert.equal(legacyMediaFallback("https://0xlei.tech/words/atlas/img/abate.webp"), null);
});
