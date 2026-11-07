import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpDay, dayKey, emptyProgress, sanitizeProgress, sanitizeSettings, wordStatus } from "./store";

const card = { due: 1, s: 2, d: 5, el: 0, sd: 1, ls: 0, reps: 1, lapses: 0, st: 2, seen: 1 };

test("keeps valid progress and drops malformed records", () => {
  const p = sanitizeProgress(
    {
      version: 2,
      cards: { ok: card, bad: { ...card, d: 99 }, worse: "x" },
      bookmarks: ["ok", 3],
      days: { "2026-10-25": { n: 1, r: 2, c: 1, t: 30, words: ["valid", "valid", "../bad", 3], paths: { ielts: { n: 1, r: 2, c: 1, t: 30, words: ["valid"] }, "../bad": { n: 9, r: 9, c: 9, t: 9 } } }, nope: { n: 1, r: 1, c: 1, t: 1 } },
      typing: [{ at: 1, mode: "word", items: 10, wpm: 40, accuracy: 98 }, { at: 1, mode: "hack", items: 1, wpm: 1, accuracy: 1 }],
    },
    "word-atlas-open",
  );
  assert.deepEqual(Object.keys(p.cards), ["ok"]);
  assert.deepEqual(p.bookmarks, ["ok"]);
  assert.deepEqual(Object.keys(p.days), ["2026-10-25"]);
  assert.deepEqual(p.days["2026-10-25"].words, ["valid"]);
  assert.deepEqual(p.days["2026-10-25"].paths?.ielts.words, ["valid"]);
  assert.equal(p.days["2026-10-25"].paths?.["../bad"], undefined);
  assert.equal(p.typing.length, 1);
});

test("rejects other versions and unknown settings", () => {
  assert.deepEqual(sanitizeProgress({ version: 1, cards: { ok: card } }, "x").cards, {});
  const s = sanitizeSettings({ accent: "fr", dailyNew: 1e9, theme: "dark", retention: 0.5 });
  assert.equal(s.accent, "uk");
  assert.equal(s.dailyNew, 10);
  assert.equal(s.theme, "dark");
  assert.equal(s.retention, 0.9);
  assert.equal(s.curriculum, "ielts");
});

test("keeps safe manual atlas statuses and lets them override inferred card status", () => {
  const p = sanitizeProgress({
    version: 2,
    manualStatuses: { apple: "mastered", pear: "learning", bad: "unknown", "../unsafe": "mastered" },
  }, "x");
  assert.deepEqual(p.manualStatuses, { apple: "mastered", pear: "learning" });
  assert.equal(wordStatus(undefined, "mastered"), "mastered");
  assert.equal(wordStatus({ ...card, s: 30, st: 2 }, "learning"), "learning");
  assert.equal(wordStatus(undefined), null);
});

test("keeps a safe learning path without changing the progress dataset", () => {
  const settings = sanitizeSettings({ curriculum: "toefl-ibt-2026", dataset: "open" });
  assert.equal(settings.curriculum, "toefl-ibt-2026");
  assert.equal(settings.dataset, "open");
  assert.equal(sanitizeSettings({ curriculum: "../unsafe" }).curriculum, "ielts");
});

test("first path-aware update preserves legacy daily totals as IELTS history", () => {
  const progress = emptyProgress("test");
  progress.days[dayKey()] = { n: 2, r: 3, c: 2, t: 60, words: ["legacy"] };
  const updated = bumpDay(progress, { n: 1, r: 1, c: 1, t: 10, words: ["toefl-word"] }, "toefl-ibt-2026");
  const day = updated.days[dayKey()];
  assert.deepEqual(day.paths?.ielts, { n: 2, r: 3, c: 2, t: 60, words: ["legacy"] });
  assert.deepEqual(day.paths?.["toefl-ibt-2026"], { n: 1, r: 1, c: 1, t: 10, words: ["toefl-word"] });
  assert.equal(day.n, 3);
});
