import type { WordRef } from "../atlas/types";

export interface CurriculumLevelCount {
  /** Position in the atlas-wide CEFR list, used for the level names and start setting. */
  index: number;
  name: string;
  total: number;
}

/** Return only CEFR levels represented in a curriculum, retaining atlas order and indices. */
export function curriculumLevelCounts(atlasLevels: readonly string[], words: readonly Pick<WordRef, "cefr">[]): CurriculumLevelCount[] {
  const counts = atlasLevels.map((name, index) => ({ index, name, total: 0 }));
  for (const word of words) {
    const level = counts[word.cefr];
    if (level) level.total += 1;
  }
  return counts.filter((level) => level.total > 0);
}

export function curriculumLevelRange(levels: readonly CurriculumLevelCount[]): string {
  if (!levels.length) return "";
  return `从 ${levels[0].name} 到 ${levels[levels.length - 1].name}`;
}
