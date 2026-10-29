import assert from "node:assert/strict";
import { test } from "node:test";
import { labelIdsForToday, studiedIdsForDay } from "./session";
import { emptyProgress } from "./store";

test("finds words reviewed inside the selected local calendar day", () => {
  const selected = new Date(2026, 9, 29, 12, 0, 0);
  const progress = emptyProgress("test");
  progress.days = {
    "2026-10-28": { n: 1, r: 1, c: 1, t: 10, words: ["yesterday"] },
    "2026-10-29": { n: 2, r: 2, c: 2, t: 20, words: ["first", "second"] },
    "2026-10-30": { n: 1, r: 1, c: 1, t: 10, words: ["tomorrow"] },
  };
  assert.deepEqual(studiedIdsForDay(progress, selected), ["first", "second"]);
});

test("label list keeps completed words after the plan is empty and de-duplicates pending words", () => {
  const selected = new Date(2026, 9, 29, 12, 0, 0);
  const progress = emptyProgress("test");
  progress.days = {
    "2026-10-29": { n: 1, r: 2, c: 2, t: 20, words: ["learned", "reviewed"] },
  };
  assert.deepEqual(labelIdsForToday(progress, [], selected), ["learned", "reviewed"]);
  assert.deepEqual(labelIdsForToday(progress, ["reviewed", "pending"], selected), ["learned", "reviewed", "pending"]);
  assert.deepEqual(labelIdsForToday(progress, ["pending"], selected, 2), ["learned", "reviewed"]);
});
