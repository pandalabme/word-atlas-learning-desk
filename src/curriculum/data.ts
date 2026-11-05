import type { Atlas, WordRef } from "../atlas/types";
import { isExamTag } from "../atlas/examTags";
import type { ExamTag } from "../atlas/examTags";
import type { CefrLevel, Curriculum, CurriculumFilter, CurriculumManifest, CurriculumWord, WordOverride } from "./types";

const levels: readonly CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function record(value: unknown, at: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${at} must be an object`);
  return value as Record<string, unknown>;
}

function safeKeys(value: Record<string, unknown>, allowed: readonly string[], at: string): void {
  for (const key of Object.keys(value)) {
    if (dangerousKeys.has(key)) throw new Error(`${at} contains unsafe field ${key}`);
    if (!allowed.includes(key)) throw new Error(`${at} contains unknown field ${key}`);
  }
}

function string(value: unknown, at: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${at} must be a non-empty string`);
  return value;
}

function stringArray(value: unknown, at: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array`);
  const result = value.map((item, i) => string(item, `${at}[${i}]`));
  if (new Set(result).size !== result.length) throw new Error(`${at} contains duplicates`);
  return result;
}

function numberArray(value: unknown, at: string): number[] {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item < 0)) throw new Error(`${at} must contain non-negative integer topic IDs`);
  const result = value as number[];
  if (new Set(result).size !== result.length) throw new Error(`${at} contains duplicates`);
  return result;
}

/** Validates untrusted JSON and returns a fresh, strictly shaped manifest. */
export function validateCurriculumManifest(value: unknown): CurriculumManifest {
  const root = record(value, "manifest");
  safeKeys(root, ["id", "version", "name", "description", "attribution", "selection", "domains", "wordOverrides"], "manifest");
  const id = string(root.id, "manifest.id");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("manifest.id must be a lowercase slug");
  if (root.version !== 1) throw new Error("manifest.version must be 1");
  const name = string(root.name, "manifest.name");
  const description = string(root.description, "manifest.description");

  const attribution = record(root.attribution, "manifest.attribution");
  safeKeys(attribution, ["curator", "official", "note"], "manifest.attribution");
  if (attribution.official !== false) throw new Error("manifest.attribution.official must be false");
  const parsedAttribution = {
    curator: string(attribution.curator, "manifest.attribution.curator"),
    official: false as const,
    note: string(attribution.note, "manifest.attribution.note"),
  };

  const rawSelection = record(root.selection, "manifest.selection");
  let selection: CurriculumManifest["selection"];
  if (rawSelection.mode === "all") {
    safeKeys(rawSelection, ["mode"], "manifest.selection");
    selection = { mode: "all" };
  } else if (rawSelection.mode === "filter") {
    safeKeys(rawSelection, ["mode", "filter"], "manifest.selection");
    const rawFilter = record(rawSelection.filter, "manifest.selection.filter");
    safeKeys(rawFilter, ["minCefr", "maxCefr", "topicIds", "examTags"], "manifest.selection.filter");
    const filter: CurriculumFilter = {};
    if (own(rawFilter, "minCefr")) {
      if (!levels.includes(rawFilter.minCefr as CefrLevel)) throw new Error("manifest.selection.filter.minCefr is invalid");
      filter.minCefr = rawFilter.minCefr as CefrLevel;
    }
    if (own(rawFilter, "maxCefr")) {
      if (!levels.includes(rawFilter.maxCefr as CefrLevel)) throw new Error("manifest.selection.filter.maxCefr is invalid");
      filter.maxCefr = rawFilter.maxCefr as CefrLevel;
    }
    if (own(rawFilter, "topicIds")) filter.topicIds = numberArray(rawFilter.topicIds, "manifest.selection.filter.topicIds");
    if (own(rawFilter, "examTags")) {
      const tags = stringArray(rawFilter.examTags, "manifest.selection.filter.examTags");
      for (const tag of tags) if (!isExamTag(tag)) throw new Error(`manifest.selection.filter.examTags contains unknown tag ${tag}`);
      filter.examTags = tags as ExamTag[];
    }
    if (filter.minCefr && filter.maxCefr && levels.indexOf(filter.minCefr) > levels.indexOf(filter.maxCefr)) throw new Error("manifest CEFR range is empty");
    if (!filter.minCefr && !filter.maxCefr && !filter.topicIds?.length && !filter.examTags?.length) throw new Error("manifest filter cannot be empty");
    selection = { mode: "filter", filter };
  } else if (rawSelection.mode === "explicit") {
    safeKeys(rawSelection, ["mode", "ids"], "manifest.selection");
    const ids = stringArray(rawSelection.ids, "manifest.selection.ids");
    if (!ids.length) throw new Error("manifest path cannot be empty");
    selection = { mode: "explicit", ids };
  } else {
    throw new Error("manifest.selection.mode is invalid");
  }

  if (!Array.isArray(root.domains)) throw new Error("manifest.domains must be an array");
  const domainIds = new Set<string>();
  const domains = root.domains.map((item, i) => {
    const domain = record(item, `manifest.domains[${i}]`);
    safeKeys(domain, ["id", "name", "topicIds"], `manifest.domains[${i}]`);
    const domainId = string(domain.id, `manifest.domains[${i}].id`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(domainId) || domainIds.has(domainId)) throw new Error(`manifest.domains[${i}].id is invalid or duplicated`);
    domainIds.add(domainId);
    return { id: domainId, name: string(domain.name, `manifest.domains[${i}].name`), topicIds: numberArray(domain.topicIds, `manifest.domains[${i}].topicIds`) };
  });

  let wordOverrides: Record<string, WordOverride> | undefined;
  if (own(root, "wordOverrides")) {
    const rawOverrides = record(root.wordOverrides, "manifest.wordOverrides");
    wordOverrides = Object.create(null) as Record<string, WordOverride>;
    for (const [wordId, rawOverride] of Object.entries(rawOverrides)) {
      if (dangerousKeys.has(wordId) || !wordId.trim()) throw new Error(`manifest.wordOverrides has unsafe word ID ${wordId}`);
      const override = record(rawOverride, `manifest.wordOverrides.${wordId}`);
      safeKeys(override, ["relevance", "domains"], `manifest.wordOverrides.${wordId}`);
      const parsed: WordOverride = {};
      if (own(override, "relevance")) {
        if (typeof override.relevance !== "number" || !Number.isFinite(override.relevance) || override.relevance < 0 || override.relevance > 1) throw new Error(`manifest.wordOverrides.${wordId}.relevance must be between 0 and 1`);
        parsed.relevance = override.relevance;
      }
      if (own(override, "domains")) parsed.domains = stringArray(override.domains, `manifest.wordOverrides.${wordId}.domains`);
      if (!own(override, "relevance") && !own(override, "domains")) throw new Error(`manifest.wordOverrides.${wordId} is empty`);
      wordOverrides[wordId] = parsed;
    }
  }
  return { id, version: 1, name, description, attribution: parsedAttribution, selection, domains, ...(wordOverrides ? { wordOverrides } : {}) };
}

export async function loadCurriculumManifest(url: string, fetcher: typeof fetch = fetch): Promise<CurriculumManifest> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Curriculum manifest loading failed (${response.status})`);
  let parsed: unknown;
  try { parsed = await response.json(); } catch { throw new Error("Curriculum manifest is not valid JSON"); }
  return validateCurriculumManifest(parsed);
}

/** Load the built-in paths from public/curricula and resolve them against the canonical atlas. */
export async function loadBuiltInCurricula(atlas: Atlas, fetcher: typeof fetch = fetch): Promise<Curriculum[]> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const paths = [
    "ielts.json",
    "zk-ecdict.json",
    "gk-ecdict.json",
    "cet4-ecdict.json",
    "cet6-ecdict.json",
    "ky-ecdict.json",
    "ielts-ecdict.json",
    "toefl-ibt-2026.json",
    "gre-ecdict.json",
  ];
  const manifests = await Promise.all(
    paths.map((path) => loadCurriculumManifest(`${base}/curricula/${path}`, fetcher)),
  );
  return manifests.map((manifest) => buildCurriculum(atlas, manifest));
}

export function buildCurriculum(atlas: Atlas, input: CurriculumManifest | unknown): Curriculum {
  const manifest = validateCurriculumManifest(input);
  const topicIds = new Set(atlas.topics.map((_, index) => index));
  for (const domain of manifest.domains) for (const topicId of domain.topicIds) if (!topicIds.has(topicId)) throw new Error(`Unknown atlas topic ID ${topicId} in domain ${domain.id}`);
  if (manifest.selection.mode === "filter" && manifest.selection.filter.topicIds) {
    for (const topicId of manifest.selection.filter.topicIds) if (!topicIds.has(topicId)) throw new Error(`Unknown atlas topic ID ${topicId} in filter`);
  }
  const overrides = manifest.wordOverrides ?? Object.create(null) as Record<string, WordOverride>;
  for (const [wordId, override] of Object.entries(overrides)) {
    if (!atlas.byId.has(wordId)) throw new Error(`Unknown atlas word ID in override: ${wordId}`);
    for (const domainId of override.domains ?? []) if (!manifest.domains.some((domain) => domain.id === domainId)) throw new Error(`Unknown curriculum domain ${domainId} for ${wordId}`);
  }

  let selected: WordRef[];
  if (manifest.selection.mode === "all") selected = [...atlas.words];
  else if (manifest.selection.mode === "explicit") {
    for (const id of manifest.selection.ids) if (!atlas.byId.has(id)) throw new Error(`Unknown atlas word ID: ${id}`);
    const ranks = new Map(manifest.selection.ids.map((id, i) => [id, i]));
    selected = [...manifest.selection.ids].sort((a, b) => ranks.get(a)! - ranks.get(b)!).map((id) => atlas.byId.get(id)!);
  } else {
    const { minCefr, maxCefr, topicIds: topics, examTags } = manifest.selection.filter;
    const min = minCefr ? levels.indexOf(minCefr) : 0;
    const max = maxCefr ? levels.indexOf(maxCefr) : levels.length - 1;
    const topicSet = topics ? new Set(topics) : null;
    const examSet = examTags?.length ? new Set(examTags) : null;
    selected = atlas.words.filter((word) => word.cefr >= min && word.cefr <= max && (!topicSet || topicSet.has(word.topic)) && (!examSet || word.examTags.some((tag) => examSet.has(tag))));
  }
  if (!selected.length) throw new Error(`Curriculum ${manifest.id} selected no words`);

  const domains = new Map(manifest.domains.map((domain) => [domain.id, { id: domain.id, name: domain.name, wordIds: [] as string[] }]));
  const words: CurriculumWord[] = selected.map((word) => {
    const override = overrides[word.id];
    const assigned = override?.domains ?? manifest.domains.filter((domain) => domain.topicIds.includes(word.topic)).map((domain) => domain.id);
    for (const domainId of assigned) domains.get(domainId)?.wordIds.push(word.id);
    return { ...word, domains: [...assigned], ...(override?.relevance !== undefined ? { relevance: override.relevance } : {}) };
  });
  const byId = new Map(words.map((word) => [word.id, word]));
  return { id: manifest.id, version: 1, name: manifest.name, description: manifest.description, attribution: manifest.attribution, count: words.length, words, byId, domains };
}
