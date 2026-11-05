import type { WordRef } from "../atlas/types";
import type { ExamTag } from "../atlas/examTags";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface CurriculumDomainManifest {
  id: string;
  name: string;
  topicIds: number[];
}

export interface CurriculumFilter {
  minCefr?: CefrLevel;
  maxCefr?: CefrLevel;
  topicIds?: number[];
  examTags?: ExamTag[];
}

export interface WordOverride {
  /** Explicit relevance score, on a neutral 0–1 scale. */
  relevance?: number;
  /** Replaces inferred domains for this word. */
  domains?: string[];
}

export interface CurriculumManifest {
  id: string;
  version: 1;
  name: string;
  description: string;
  attribution: {
    curator: string;
    official: false;
    note: string;
  };
  selection:
    | { mode: "all" }
    | { mode: "filter"; filter: CurriculumFilter }
    | { mode: "explicit"; ids: string[] };
  domains: CurriculumDomainManifest[];
  wordOverrides?: Record<string, WordOverride>;
}

export interface CurriculumWord extends WordRef {
  /** Omitted when the manifest does not assign a relevance score. */
  relevance?: number;
  domains: string[];
}

export interface Curriculum {
  id: string;
  version: 1;
  name: string;
  description: string;
  attribution: CurriculumManifest["attribution"];
  count: number;
  words: CurriculumWord[];
  byId: Map<string, CurriculumWord>;
  domains: Map<string, { id: string; name: string; wordIds: string[] }>;
}
