import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSession, labelIdsForToday, nextNew, studiedIdsForDay, todayPlan } from "./session";
import { dayKey, defaultSettings, emptyProgress, type Settings } from "./store";
import type { Atlas, WordRef } from "../atlas/types";
import type { Curriculum } from "../curriculum/types";

const ref = (id: string, cefr = 1, order = 0): WordRef => ({ id, word: id, zh: `${id}词`, ipa: "", cefr, topic: 0, media: 0, examTags: [], order });

function fixtures(pathIds: string[], atlasIds = pathIds) {
  const all = new Map([...new Set([...pathIds, ...atlasIds])].map((id, i) => [id, ref(id, i % 4, i)]));
  const words = pathIds.map((id) => all.get(id)!);
  const atlasWords = atlasIds.map((id) => all.get(id)!);
  const atlas = { words: atlasWords, byId: new Map(atlasWords.map((word) => [word.id, word])) } as Atlas;
  const curriculum = { id: `path-${pathIds.join("-")}`, words, byId: new Map(words.map((word) => [word.id, word])) } as Curriculum;
  return { atlas, curriculum };
}

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings, ...patch });

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

test("new words follow curriculum order, honor start level, and keep progress keyed by word ID", () => {
  const { atlas, curriculum } = fixtures(["below-level", "path-later", "path-first", "shared"]);
  // Keep deterministic levels independent of fixture construction order.
  curriculum.words[0].cefr = 0;
  curriculum.words[1].cefr = 3;
  curriculum.words[2].cefr = 2;
  const progress = emptyProgress("test");
  progress.cards.shared = { due: 0, s: 1, d: 1, el: 0, sd: 0, ls: 0, reps: 1, lapses: 0, st: 0, seen: 1 };
  const fresh = nextNew(atlas, curriculum, progress, settings({ startLevel: 2 }), 2);
  assert.deepEqual(fresh, ["path-later", "path-first"]);
  assert.ok(progress.cards.shared); // the card remains addressable by its original word ID across paths
});

test("today plan filters due reviews to the active curriculum and atlas and applies the new-word quota", () => {
  const { atlas, curriculum } = fixtures(["inside", "new-one", "new-two"], ["inside", "new-one", "new-two", "atlas-only"]);
  const progress = emptyProgress("test");
  const card = { due: 0, s: 1, d: 1, el: 0, sd: 0, ls: 0, reps: 1, lapses: 0, st: 0 as const, seen: 1 };
  progress.cards.inside = card;
  progress.cards["outside-path"] = card;
  progress.cards["atlas-only"] = card;
  progress.days[dayKey()] = { n: 1, r: 0, c: 0, t: 0, paths: { [curriculum.id]: { n: 1, r: 0, c: 0, t: 0 } } };
  const plan = todayPlan(atlas, curriculum, progress, settings({ dailyNew: 2 }));
  assert.deepEqual(plan.due, ["inside"]);
  assert.equal(plan.fresh.length, 1);
});

test("new-word quotas are independent across learning paths", () => {
  const { atlas, curriculum } = fixtures(["one", "two"]);
  const other = { ...curriculum, id: "other-path" };
  const progress = emptyProgress("test");
  progress.days[dayKey()] = { n: 2, r: 2, c: 2, t: 30, paths: { [curriculum.id]: { n: 2, r: 2, c: 2, t: 30 } } };
  assert.equal(todayPlan(atlas, curriculum, progress, settings({ dailyNew: 2 })).fresh.length, 0);
  assert.equal(todayPlan(atlas, other, progress, settings({ dailyNew: 2 })).fresh.length, 2);
});

test("explicit session IDs discard unknown and off-path IDs while preserving shared card IDs", () => {
  const { atlas, curriculum } = fixtures(["review", "fresh"], ["review", "fresh", "atlas-only"]);
  const progress = emptyProgress("test");
  progress.cards.review = { due: 0, s: 1, d: 1, el: 0, sd: 0, ls: 0, reps: 1, lapses: 0, st: 0, seen: 1 };
  const session = buildSession(atlas, curriculum, progress, settings(), { ids: ["review", "fresh", "outside-path", "atlas-only", "missing"] });
  assert.equal(session.curriculumId, curriculum.id);
  assert.deepEqual(session.reviewIds, ["review"]);
  assert.deepEqual(session.newIds, ["fresh"]);
});
