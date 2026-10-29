import assert from "node:assert/strict";
import test from "node:test";
import { fetchReadingJson, parseReadingArticle, parseReadingIndex, readingArticleUrl, readingBaseUrl, recommendReadings, splitMarkedText } from "./readings";

test("validates reading index and article contracts without embedding article data", () => {
  const items = parseReadingIndex({ v: 1, items: [{ id: "city-life", title: "A Busy City", titleZh: "繁忙城市", topic: "society", cefr: 2, ids: ["commute"] }] });
  const article = parseReadingArticle({ paras: ["People [[commute|commute]] every day."], zh: ["人们每天通勤。"], q: [{ s: "People commute.", a: "T", why: "The paragraph says so." }] }, items[0]);
  assert.equal(article.q[0].a, "T");
  assert.deepEqual(splitMarkedText(article.paras[0]), [
    { text: "People " }, { text: "commute", id: "commute", surface: "commute" }, { text: " every day." },
  ]);
  assert.throws(() => parseReadingIndex({ v: 2, items: [] }), /格式不正确/);
  assert.throws(() => parseReadingArticle({ paras: ["text"], zh: [], q: [] }, items[0]), /不完整/);
});

test("recommendations prioritize session words, then learned words, then the remaining shelf", () => {
  const items = parseReadingIndex({ v: 1, items: [
    { id: "learned", title: "Learned", titleZh: "已学词", topic: "x", cefr: 1, ids: ["old"] },
    { id: "session", title: "Session", titleZh: "本次学习", topic: "x", cefr: 2, ids: ["today", "today-2"] },
    { id: "other", title: "Other", titleZh: "其他", topic: "x", cefr: 2, ids: ["unused"] },
  ] });
  assert.deepEqual(recommendReadings(items, ["today"], ["old"]).map((item) => item.id), ["session", "learned", "other"]);
});

test("reading URLs support a deployment override and validate article IDs", () => {
  assert.equal(readingBaseUrl("https://cdn.example/reading/"), "https://cdn.example/reading");
  assert.equal(readingBaseUrl(undefined, "/electronic_diy/"), "/electronic_diy/atlas/extras/readings");
  assert.equal(readingArticleUrl("city-life", "/words/atlas/extras/readings"), "/words/atlas/extras/readings/city-life.json");
  assert.throws(() => readingArticleUrl("../secrets"), /ID 无效/);
});

test("reading JSON retries a transient fetch failure and bypasses stale browser caches", async () => {
  let calls = 0;
  const waits: number[] = [];
  const value = await fetchReadingJson("/readings/index.json", async (_url, init) => {
    calls += 1;
    assert.equal(init?.cache, "no-store");
    if (calls < 3) throw new TypeError("Failed to fetch");
    return { ok: true, status: 200, json: async () => ({ v: 1 }) };
  }, 3, async (milliseconds) => { waits.push(milliseconds); });
  assert.deepEqual(value, { v: 1 });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [300, 600]);
});
