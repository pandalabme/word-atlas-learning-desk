export interface ReadingIndexItem {
  id: string;
  title: string;
  titleZh: string;
  topic: string;
  cefr: number;
  ids: string[];
}

export interface ReadingQuestion {
  s: string;
  a: "T" | "F" | "NG";
  why: string;
}

export interface ReadingArticle extends ReadingIndexItem {
  paras: string[];
  zh: string[];
  q: ReadingQuestion[];
}

export interface ReadingSegment {
  text: string;
  id?: string;
  surface?: string;
}

export function parseReadingIndex(value: unknown): ReadingIndexItem[] {
  if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 1 || !Array.isArray((value as { items?: unknown }).items))
    throw new Error("阅读目录数据格式不正确。");
  const rawItems = (value as { items: unknown[] }).items;
  if (rawItems.length > 2_000) throw new Error("阅读目录项目过多。");
  const items = rawItems.map((item) => {
    if (!item || typeof item !== "object") throw new Error("阅读目录含有无效项目。");
    const row = item as Record<string, unknown>;
    if ([row.id, row.title, row.titleZh, row.topic].some((part) => typeof part !== "string" || !part.trim()) || !Number.isInteger(row.cefr) || (row.cefr as number) < 0 || (row.cefr as number) > 10 || !/^[A-Za-z0-9._-]{1,100}$/.test(row.id as string) || !Array.isArray(row.ids) || !row.ids.length || row.ids.length > 64 || !row.ids.every((id) => typeof id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(id)))
      throw new Error("阅读目录含有无效项目。");
    return { id: row.id as string, title: row.title as string, titleZh: row.titleZh as string, topic: row.topic as string, cefr: row.cefr as number, ids: row.ids as string[] };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("阅读目录含有重复 ID。");
  return items;
}

export function parseReadingArticle(value: unknown, item: ReadingIndexItem): ReadingArticle {
  if (!value || typeof value !== "object") throw new Error("短文数据格式不正确。");
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.paras) || !data.paras.length || data.paras.length > 50 || !data.paras.every((p) => typeof p === "string" && p.trim()) || !Array.isArray(data.zh) || !data.zh.every((p) => typeof p === "string") || data.zh.length !== data.paras.length || !Array.isArray(data.q) || !data.q.length || data.q.length > 20)
    throw new Error("短文内容不完整。");
  const questions = data.q.map((q) => {
    if (!q || typeof q !== "object") throw new Error("短文理解题格式不正确。");
    const row = q as Record<string, unknown>;
    if (typeof row.s !== "string" || !row.s.trim() || !["T", "F", "NG"].includes(String(row.a)) || typeof row.why !== "string")
      throw new Error("短文理解题格式不正确。");
    return { s: row.s, a: row.a as ReadingQuestion["a"], why: row.why };
  });
  return { ...item, paras: data.paras as string[], zh: data.zh as string[], q: questions };
}

/** Ranks articles by the number of learned words they contain, preserving source order for ties. */
export function recommendReadings(items: ReadingIndexItem[], preferredIds: string[], learnedIds: string[]): ReadingIndexItem[] {
  const rank = (ids: string[]) => {
    const set = new Set(ids);
    return items.map((item, index) => ({ item, index, matches: item.ids.filter((id) => set.has(id)).length }))
      .filter(({ matches }) => matches > 0)
      .sort((a, b) => b.matches - a.matches || a.index - b.index)
      .map(({ item }) => item);
  };
  const preferred = rank(preferredIds);
  const preferredSet = new Set(preferred.map((item) => item.id));
  const learned = rank(learnedIds).filter((item) => !preferredSet.has(item.id));
  const seen = new Set([...preferred, ...learned].map((item) => item.id));
  return [...preferred, ...learned, ...items.filter((item) => !seen.has(item.id))];
}

export function splitMarkedText(text: string): ReadingSegment[] {
  const out: ReadingSegment[] = [];
  const marker = /\[\[([A-Za-z0-9._:-]{1,128})\|([^\]|\n]+)\]\]/g;
  let cursor = 0;
  for (const match of text.matchAll(marker)) {
    const index = match.index ?? 0;
    if (index > cursor) out.push({ text: text.slice(cursor, index) });
    out.push({ text: match[2], id: match[1], surface: match[2] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

export function readingBaseUrl(envValue?: string, appBase = import.meta.env?.BASE_URL || "/"): string {
  const bundled = `${appBase.replace(/\/?$/, "/")}atlas/extras/readings`;
  return (envValue?.trim() || bundled).replace(/\/+$/, "");
}

export function readingIndexUrl(base = readingBaseUrl(import.meta.env?.VITE_WORD_ATLAS_READING_BASE_URL)): string {
  return `${base}/index.json`;
}

export function readingArticleUrl(id: string, base = readingBaseUrl(import.meta.env?.VITE_WORD_ATLAS_READING_BASE_URL)): string {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(id)) throw new Error("短文 ID 无效。");
  return `${base}/${encodeURIComponent(id)}.json`;
}

type ReadingFetchResponse = Pick<Response, "ok" | "status" | "json">;
type ReadingFetch = (url: string, init?: RequestInit) => Promise<ReadingFetchResponse>;

/** Retries transient network/server failures so a Vite restart does not strand the reader. */
export async function fetchReadingJson(
  url: string,
  fetcher: ReadingFetch = fetch,
  attempts = 3,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
): Promise<unknown> {
  const total = Math.max(1, Math.min(3, Math.trunc(attempts)));
  let lastError: unknown = new Error("阅读资源加载失败。");
  for (let attempt = 0; attempt < total; attempt += 1) {
    try {
      const response = await fetcher(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (reason) {
      lastError = reason;
      if (attempt + 1 < total) await wait(300 * 2 ** attempt);
    }
  }
  throw lastError;
}
