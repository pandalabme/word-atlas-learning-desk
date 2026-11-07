import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const atlas = await readJson("public/atlas/index.json");
const ielts = await readJson("public/curricula/ielts.json");
const examTags = await readJson("public/atlas/exam-tags.json");
const ids = new Set(atlas.words.map((row) => row[0]));
const allowedTags = ["zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre"];
const allowedTagSet = new Set(allowedTags);
const tagPathFiles = {
  zk: "zk-ecdict.json",
  gk: "gk-ecdict.json",
  cet4: "cet4-ecdict.json",
  cet6: "cet6-ecdict.json",
  ky: "ky-ecdict.json",
  ielts: "ielts-ecdict.json",
  toefl: "toefl-ibt-2026.json",
  gre: "gre-ecdict.json",
};
const tagPaths = Object.fromEntries(
  await Promise.all(Object.entries(tagPathFiles).map(async ([tag, file]) => [tag, await readJson(`public/curricula/${file}`)])),
);

assert.equal(atlas.words.length, atlas.count, "atlas index count does not match its word rows");
assert.deepEqual(Object.keys(examTags).sort(), ["source", "tags", "version"], "exam tag sidecar fields changed");
assert.equal(examTags.version, 1, "exam tag sidecar version must be 1");
assert.deepEqual(Object.keys(examTags.source ?? {}).sort(), ["commit", "license", "name", "repository", "sha256"], "exam tag source fields changed");
assert.equal(examTags.source.name, "ECDICT", "exam tag source attribution must name ECDICT");
assert.equal(examTags.source.repository, "https://github.com/skywind3000/ECDICT", "exam tag source repository changed");
assert.equal(examTags.source.license, "MIT", "exam tag source license changed");
assert.match(examTags.source.commit, /^[a-f0-9]{40}$/, "exam tag source commit is invalid");
assert.match(examTags.source.sha256, /^[a-f0-9]{64}$/, "exam tag source SHA-256 is invalid");
assert.ok(examTags.tags && typeof examTags.tags === "object" && !Array.isArray(examTags.tags), "exam tag map must be an object");
assert.deepEqual(Object.keys(examTags.tags), Object.keys(examTags.tags).toSorted(), "exam tag word IDs must be sorted");
const tagCounts = Object.fromEntries(allowedTags.map((tag) => [tag, 0]));
for (const [id, tags] of Object.entries(examTags.tags)) {
  assert.ok(ids.has(id), `exam tag sidecar references unknown word ${id}`);
  assert.ok(Array.isArray(tags) && tags.length > 0, `exam tags for ${id} must be a non-empty array`);
  assert.equal(tags.length, new Set(tags).size, `exam tags for ${id} contain duplicates`);
  assert.deepEqual(tags, [...tags].toSorted((a, b) => allowedTags.indexOf(a) - allowedTags.indexOf(b)), `exam tags for ${id} are not in canonical order`);
  for (const tag of tags) {
    assert.ok(allowedTagSet.has(tag), `exam tag sidecar contains unknown tag ${tag}`);
    tagCounts[tag] += 1;
  }
}
for (const manifest of [ielts, ...Object.values(tagPaths)]) {
  assert.equal(manifest.version, 1, `${manifest.id}: unsupported manifest version`);
  assert.equal(manifest.attribution?.official, false, `${manifest.id}: must not claim official status`);
  assert.equal(manifest.attribution?.note, "词光整理，非官方词表", `${manifest.id}: attribution note is missing or changed`);
  for (const domain of manifest.domains ?? []) {
    for (const topicId of domain.topicIds) assert.ok(atlas.topics[topicId], `${manifest.id}: unknown domain topic ${topicId}`);
  }
  for (const id of Object.keys(manifest.wordOverrides ?? {})) assert.ok(ids.has(id), `${manifest.id}: unknown overridden word ${id}`);
  for (const tag of manifest.selection?.filter?.examTags ?? []) assert.ok(allowedTagSet.has(tag), `${manifest.id}: unknown exam tag ${tag}`);
}

assert.equal(ielts.id, "ielts");
assert.deepEqual(ielts.selection, { mode: "all" }, "IELTS must cover the entire canonical atlas");
const ieltsRows = atlas.words;
assert.equal(ieltsRows.length, atlas.count, "IELTS path does not cover all atlas words");
for (let index = 0; index < ieltsRows.length; index += 1) {
  assert.equal(ieltsRows[index][0], atlas.words[index][0], `IELTS order differs at ${index}`);
}

for (const tag of allowedTags) {
  const manifest = tagPaths[tag];
  assert.deepEqual(manifest.selection?.filter, { examTags: [tag] }, `${tag} path filter changed`);
  const expected = atlas.words.filter((row) => examTags.tags[row[0]]?.includes(tag));
  assert.ok(expected.length > 0, `${tag} path is empty against the public atlas`);
  assert.equal(expected.length, new Set(expected.map((row) => row[0])).size, `${tag} path contains duplicate words`);
  assert.equal(expected.length, tagCounts[tag], `${tag} path does not match the imported tag count`);
  assert.equal(manifest.id, tag === "toefl" ? "toefl-ibt-2026" : `${tag}-ecdict`, `${tag} path ID changed`);
}
const counts = allowedTags.map((tag) => `${tag.toUpperCase()} ${tagCounts[tag]}`).join("; ");
console.log(`Curricula OK: IELTS ${ieltsRows.length}; ${counts}; atlas ${atlas.count}`);
