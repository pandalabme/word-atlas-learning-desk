import assert from "node:assert/strict";
import test from "node:test";
import { curriculumLevelCounts, curriculumLevelRange } from "./levels";

const atlasLevels = ["A1", "A2", "B1", "B2", "C1", "C2"];

test("curriculum route shows only represented levels and keeps atlas indices", () => {
  const words = [{ cefr: 2 }, { cefr: 3 }, { cefr: 4 }, { cefr: 4 }];
  const levels = curriculumLevelCounts(atlasLevels, words);
  assert.deepEqual(levels, [
    { index: 2, name: "B1", total: 1 },
    { index: 3, name: "B2", total: 1 },
    { index: 4, name: "C1", total: 2 },
  ]);
  assert.equal(curriculumLevelRange(levels), "从 B1 到 C1");
});

test("full curriculum retains A1–C2 route and a single-level path has a stable range", () => {
  const full = curriculumLevelCounts(atlasLevels, atlasLevels.map((_, cefr) => ({ cefr })));
  assert.equal(curriculumLevelRange(full), "从 A1 到 C2");
  assert.equal(curriculumLevelRange(curriculumLevelCounts(atlasLevels, [{ cefr: 3 }])), "从 B2 到 B2");
});
