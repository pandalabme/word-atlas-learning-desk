import assert from "node:assert/strict";
import { test } from "node:test";
import { labelIdsForToday, studiedIdsForDay } from "./session";
import { emptyProgress } from "./store";
import type { CardState } from "./srs";

const card = (last?: number): CardState => ({
  due: (last ?? 1) + 60_000,
  s: 1,
  d: 5,
  el: 0,
  sd: 1,
  ls: 0,
  reps: 1,
  lapses: 0,
  st: 1,
  last,
  seen: last ?? 1,
});

test("finds words reviewed inside the selected local calendar day", () => {
  const selected = new Date(2026, 9, 29, 12, 0, 0);
  const start = new Date(2026, 9, 29, 0, 0, 0).getTime();
  const end = new Date(2026, 9, 30, 0, 0, 0).getTime();
  const progress = emptyProgress("test");
  progress.cards = {
    yesterday: card(start - 1),
    second: card(start + 2_000),
    first: card(start + 1_000),
    tomorrow: card(end),
    never: card(),
  };
  assert.deepEqual(studiedIdsForDay(progress, selected), ["first", "second"]);
});

test("label list keeps completed words after the plan is empty and de-duplicates pending words", () => {
  const selected = new Date(2026, 9, 29, 12, 0, 0);
  const progress = emptyProgress("test");
  progress.cards = {
    learned: card(new Date(2026, 9, 29, 9, 0, 0).getTime()),
    reviewed: card(new Date(2026, 9, 29, 10, 0, 0).getTime()),
  };
  assert.deepEqual(labelIdsForToday(progress, [], selected), ["learned", "reviewed"]);
  assert.deepEqual(labelIdsForToday(progress, ["reviewed", "pending"], selected), ["learned", "reviewed", "pending"]);
  assert.deepEqual(labelIdsForToday(progress, ["pending"], selected, 2), ["learned", "reviewed"]);
});
