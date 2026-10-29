import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readingsRoot = path.join(root, "public", "atlas", "extras", "readings");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fail = (message) => { throw new Error(`Reading corpus check failed: ${message}`); };
const safeId = /^[A-Za-z0-9._-]{1,100}$/;
const marker = /\[\[([A-Za-z0-9._:-]{1,128})\|([^\]|\n]+)\]\]/g;

if (!fs.existsSync(path.join(readingsRoot, "LICENSE.md"))) fail("LICENSE.md is missing");
const index = readJson(path.join(readingsRoot, "index.json"));
if (index.v !== 1 || index.origin !== "original" || index.license !== "CC-BY-4.0" || index.aiGenerated !== true || typeof index.attribution !== "string" || !index.attribution.trim())
  fail("index provenance or license metadata is incomplete");
if (!Array.isArray(index.items) || index.items.length < 1 || index.items.length > 1_000) fail("invalid item count");

const atlas = readJson(path.join(root, "public", "atlas", "index.json"));
const atlasIds = new Set(atlas.words.map((word) => word[0]));
const articleIds = new Set();

for (const item of index.items) {
  if (!item || typeof item !== "object" || !safeId.test(item.id) || !item.id.startsWith("local-")) fail("every article ID must use the local- namespace");
  if (articleIds.has(item.id)) fail(`duplicate ID ${item.id}`);
  articleIds.add(item.id);
  if (![item.title, item.titleZh, item.topic].every((value) => typeof value === "string" && value.trim())) fail(`missing catalog text for ${item.id}`);
  if (!Number.isInteger(item.cefr) || item.cefr < 0 || item.cefr >= atlas.cefr.length) fail(`invalid CEFR for ${item.id}`);
  if (!Array.isArray(item.ids) || !item.ids.length || item.ids.some((id) => !atlasIds.has(id))) fail(`unknown target word in ${item.id}`);

  const file = path.join(readingsRoot, `${item.id}.json`);
  if (!fs.existsSync(file)) fail(`missing ${item.id}.json`);
  const article = readJson(file);
  if (article.origin !== "original" || article.license !== "CC-BY-4.0" || article.aiGenerated !== true) fail(`missing provenance metadata in ${item.id}`);
  if (!Array.isArray(article.paras) || !article.paras.length || !article.paras.every((value) => typeof value === "string" && value.trim())) fail(`invalid paragraphs in ${item.id}`);
  if (!Array.isArray(article.zh) || article.zh.length !== article.paras.length || !article.zh.every((value) => typeof value === "string" && value.trim())) fail(`invalid translations in ${item.id}`);
  if (!Array.isArray(article.q) || !article.q.length || article.q.some((question) => !question || typeof question.s !== "string" || !["T", "F", "NG"].includes(question.a) || typeof question.why !== "string")) fail(`invalid questions in ${item.id}`);

  const markedIds = new Set(article.paras.flatMap((paragraph) => [...paragraph.matchAll(marker)].map((match) => match[1])));
  if (markedIds.size === 0 || [...markedIds].some((id) => !atlasIds.has(id))) fail(`invalid marked word in ${item.id}`);
  if (item.ids.some((id) => !markedIds.has(id))) fail(`catalog target not marked in ${item.id}`);
}

const listedFiles = new Set(["index.json", ...[...articleIds].map((id) => `${id}.json`)]);
for (const name of fs.readdirSync(readingsRoot).filter((name) => name.endsWith(".json"))) {
  if (!listedFiles.has(name)) fail(`unlisted JSON file ${name}`);
}

// When the private inspection cache exists locally, prove no article was copied verbatim.
const privateRoot = path.join(root, ".local", "readings");
if (fs.existsSync(privateRoot)) {
  const hostedBodies = new Set();
  for (const name of fs.readdirSync(privateRoot).filter((name) => name !== "index.json" && name.endsWith(".json"))) {
    try {
      const value = readJson(path.join(privateRoot, name));
      if (Array.isArray(value.paras)) hostedBodies.add(JSON.stringify([value.paras, value.zh]));
    } catch { /* an incomplete private cache is irrelevant to the publishable corpus */ }
  }
  for (const id of articleIds) {
    const value = readJson(path.join(readingsRoot, `${id}.json`));
    if (hostedBodies.has(JSON.stringify([value.paras, value.zh]))) fail(`${id} duplicates a private hosted article`);
  }
}

console.log(`Validated ${articleIds.size} independently authored CC BY 4.0 reading articles.`);
