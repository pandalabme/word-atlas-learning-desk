import type { WordRef } from "../atlas/types";

const CONFIG_KEY = "word-atlas:remote-sync";
const MAX_SYNC_BYTES = 5 * 1024 * 1024;
const WORD_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const WORD = /^[a-z]+(?:[-'][a-z]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RemoteSyncConfig {
  baseUrl: string;
  profileId: string;
  token: string;
  deviceId: string;
  autoSync: boolean;
}

export interface SyncReply {
  progress: unknown;
  server_updated_at: string;
  version: number;
}

export interface SyncStatus {
  state: "idle" | "syncing" | "success" | "error";
  message: string;
  serverUpdatedAt?: string;
  version?: number;
}

export interface LabelWord {
  id: string;
  text: string;
}

export interface LabelReply {
  job_id: string;
  status: string;
  [key: string]: unknown;
}

export interface LabelStatusReply {
  job_id: string;
  status: "queued" | "leased" | "succeeded" | "failed";
  created_at: string;
  updated_at: string;
  error: string | null;
}

const listeners = new Set<(status: SyncStatus) => void>();
let status: SyncStatus = { state: "idle", message: "尚未同步" };
let ephemeralDeviceId: string | undefined;

const defaultDeviceId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
};

export function getRemoteSyncConfig(): RemoteSyncConfig {
  const fallback: RemoteSyncConfig = { baseUrl: "", profileId: "", token: "", deviceId: ephemeralDeviceId ??= defaultDeviceId(), autoSync: false };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) {
      // Persist the anonymous device identity immediately so learning events
      // created before the user configures a server stay in one durable outbox.
      localStorage.setItem(CONFIG_KEY, JSON.stringify(fallback));
      return fallback;
    }
    const value = JSON.parse(raw) as Partial<RemoteSyncConfig>;
    return {
      baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
      profileId: typeof value.profileId === "string" ? value.profileId : "",
      token: typeof value.token === "string" ? value.token : "",
      deviceId: typeof value.deviceId === "string" && value.deviceId ? value.deviceId : fallback.deviceId,
      autoSync: value.autoSync === true,
    };
  } catch {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(fallback));
    } catch {
      // Keep a stable in-memory ID when storage is unavailable.
    }
    return fallback;
  }
}

export function saveRemoteSyncConfig(config: RemoteSyncConfig): void {
  const clean = {
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
    profileId: config.profileId.trim(),
    token: config.token.trim(),
    deviceId: config.deviceId.trim(),
    autoSync: config.autoSync,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
}

export function subscribeSyncStatus(listener: (next: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function setStatus(next: SyncStatus): void {
  status = next;
  listeners.forEach((listener) => listener(next));
}

export function endpoint(baseUrl: string, path: "/api/word-atlas/sync" | "/api/word-atlas/label"): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("请输入有效的同步服务器 URL。");
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
    throw new Error("同步服务器必须使用 HTTPS；只有本机回环地址可以使用 HTTP。");
  return `${parsed.href.replace(/\/+$/, "")}${path}`;
}

export function buildSyncBody(profileId: string, deviceId: string, datasetId: string, progress: unknown, clientUpdatedAt = new Date().toISOString()) {
  return { profile_id: profileId, device_id: deviceId, dataset_id: datasetId, progress, client_updated_at: clientUpdatedAt };
}

export function buildLabelBody(profileId: string, datasetId: string, words: LabelWord[], requestId = crypto.randomUUID()) {
  if (words.length < 1 || words.length > 64) throw new Error("每次价签同步需选择 1 到 64 个单词。");
  if (!UUID.test(requestId)) throw new Error("价签请求 ID 格式不正确。");
  const ids = new Set<string>();
  const texts = new Set<string>();
  for (const word of words) {
    if (!WORD_ID.test(word.id)) throw new Error("词条 ID 含有不安全字符。");
    if (!WORD.test(word.text) || word.text.length > 31) throw new Error("价签仅支持不超过 31 个字符的英文单词。");
    if (ids.has(word.id) || texts.has(word.text.toLocaleLowerCase())) throw new Error("价签单词和词条 ID 不能重复。");
    ids.add(word.id);
    texts.add(word.text.toLocaleLowerCase());
  }
  return { request_id: requestId, profile_id: profileId, dataset_id: datasetId, cards: words.map(({ id, text }) => ({ id, word: text })) };
}

function requireCredentials(config: RemoteSyncConfig): void {
  if (!config.baseUrl.trim()) throw new Error("请先填写同步服务器 URL。");
  if (!config.profileId.trim()) throw new Error("请先填写用户配置 ID。");
  if (!config.token.trim()) throw new Error("请先填写 Word Atlas 专用同步密钥。");
  if (!config.deviceId.trim()) throw new Error("请先填写设备 ID。");
  if (!WORD_ID.test(config.profileId) || !WORD_ID.test(config.deviceId)) throw new Error("配置 ID 和设备 ID 只能使用安全字符，且不能超过 128 个字符。");
}

async function postJson<T>(config: RemoteSyncConfig, path: "/api/word-atlas/sync" | "/api/word-atlas/label", body: unknown, fetcher: typeof fetch): Promise<T> {
  requireCredentials(config);
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SYNC_BYTES) throw new Error("学习进度超过 5 MiB，同步已取消。");
  const response = await fetcher(endpoint(config.baseUrl, path), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
    body: serialized,
  });
  if (!response.ok) throw new Error(`同步服务器返回 HTTP ${response.status}。`);
  return (await response.json()) as T;
}

export async function syncProgress(config: RemoteSyncConfig, datasetId: string, progress: unknown, fetcher: typeof fetch = fetch): Promise<SyncReply> {
  setStatus({ state: "syncing", message: "正在同步本地学习进度…" });
  try {
    const reply = await postJson<SyncReply>(config, "/api/word-atlas/sync", buildSyncBody(config.profileId, config.deviceId, datasetId, progress), fetcher);
    if (!reply || typeof reply !== "object" || !("progress" in reply) || typeof reply.server_updated_at !== "string" || typeof reply.version !== "number")
      throw new Error("同步服务器返回的数据格式不正确。");
    const remoteProgress = reply.progress;
    if (
      !remoteProgress ||
      typeof remoteProgress !== "object" ||
      Array.isArray(remoteProgress) ||
      !("version" in remoteProgress) ||
      remoteProgress.version !== 2 ||
      !("datasetId" in remoteProgress) ||
      remoteProgress.datasetId !== datasetId
    )
      throw new Error("同步服务器返回的学习进度与当前词库不匹配。");
    setStatus({ state: "success", message: "同步完成", serverUpdatedAt: reply.server_updated_at, version: reply.version });
    return reply;
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败。";
    setStatus({ state: "error", message });
    throw error;
  }
}

export async function syncLabelWords(config: RemoteSyncConfig, datasetId: string, words: LabelWord[], fetcher: typeof fetch = fetch): Promise<LabelReply> {
  const reply = await postJson<LabelReply>(config, "/api/word-atlas/label", buildLabelBody(config.profileId, datasetId, words), fetcher);
  if (!reply || !UUID.test(reply.job_id) || typeof reply.status !== "string") throw new Error("价签服务器返回的数据格式不正确。");
  return reply;
}

export async function getLabelStatus(config: RemoteSyncConfig, jobId: string, fetcher: typeof fetch = fetch): Promise<LabelStatusReply> {
  requireCredentials(config);
  if (!UUID.test(jobId)) throw new Error("价签任务 ID 格式不正确。");
  const response = await fetcher(`${endpoint(config.baseUrl, "/api/word-atlas/label")}/${jobId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!response.ok) throw new Error(`价签服务器返回 HTTP ${response.status}。`);
  const reply = (await response.json()) as LabelStatusReply;
  if (!reply || reply.job_id !== jobId || !["queued", "leased", "succeeded", "failed"].includes(reply.status))
    throw new Error("价签服务器返回的数据格式不正确。");
  return reply;
}

export function labelWordsFromAtlas(refs: WordRef[]): LabelWord[] {
  return refs.map((ref) => ({ id: ref.id, text: ref.word }));
}
