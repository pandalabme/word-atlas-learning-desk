export const EXAM_TAGS = ["zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre"] as const;

export type ExamTag = (typeof EXAM_TAGS)[number];

export const EXAM_TAG_LABELS: Record<ExamTag, string> = {
  zk: "中考",
  gk: "高考",
  cet4: "CET-4",
  cet6: "CET-6",
  ky: "考研",
  ielts: "IELTS",
  toefl: "TOEFL",
  gre: "GRE",
};

const examTagSet: ReadonlySet<string> = new Set(EXAM_TAGS);

export function isExamTag(value: string): value is ExamTag {
  return examTagSet.has(value);
}

/** Validate the optional public-atlas sidecar; absence is handled by the loader. */
export function parseExamTagsSidecar(value: unknown, knownIds: ReadonlySet<string>): Map<string, ExamTag[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Exam tag sidecar must be an object");
  const root = value as Record<string, unknown>;
  if (Object.keys(root).some((key) => !["version", "source", "tags"].includes(key))) throw new Error("Exam tag sidecar has unknown fields");
  if (root.version !== 1) throw new Error("Exam tag sidecar version must be 1");

  if (!root.source || typeof root.source !== "object" || Array.isArray(root.source)) throw new Error("Exam tag sidecar source must be an object");
  const source = root.source as Record<string, unknown>;
  const sourceFields = ["name", "repository", "commit", "sha256", "license"];
  if (Object.keys(source).some((key) => !sourceFields.includes(key))) throw new Error("Exam tag sidecar source has unknown fields");
  if (
    source.name !== "ECDICT"
    || source.repository !== "https://github.com/skywind3000/ECDICT"
    || source.license !== "MIT"
    || typeof source.commit !== "string"
    || !/^[a-f0-9]{40}$/.test(source.commit)
    || typeof source.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(source.sha256)
  ) throw new Error("Exam tag sidecar source metadata is invalid");

  if (!root.tags || typeof root.tags !== "object" || Array.isArray(root.tags)) throw new Error("Exam tag sidecar tags must be an object");
  const result = new Map<string, ExamTag[]>();
  for (const [id, raw] of Object.entries(root.tags as Record<string, unknown>)) {
    if (!knownIds.has(id)) throw new Error(`Exam tag sidecar references unknown word ID ${id}`);
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((tag) => typeof tag !== "string" || !isExamTag(tag))) {
      throw new Error(`Exam tag sidecar has invalid tags for ${id}`);
    }
    if (new Set(raw).size !== raw.length) throw new Error(`Exam tag sidecar has duplicate tags for ${id}`);
    result.set(id, [...raw] as ExamTag[]);
  }
  return result;
}
