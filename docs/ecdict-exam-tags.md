# ECDICT exam tags

The public atlas carries a small `public/atlas/exam-tags.json` sidecar that associates canonical atlas word IDs with exam categories. The supported categories are `zk`, `gk`, `cet4`, `cet6`, `ky`, `ielts`, `toefl`, and `gre`. Curriculum filters match when a word has **any** requested category; CEFR and topic conditions still apply at the same time.

The sidecar contains only tags and provenance. It does not import ECDICT definitions, translations, examples, phonetics, or audio. The importer matches the ECDICT `word` column to `public/atlas/index.json` using exact NFC normalization, surrounding-whitespace trimming, and Unicode case folding. It never uses fuzzy matching. Unmatched words and unsupported tags are reported; unsupported tags are excluded.

## Reproduce an import

Obtain an ECDICT CSV and record the exact upstream commit used. From this project directory run:

```sh
python scripts/import_ecdict_exam_tags.py /path/to/ecdict.csv --source-commit <upstream-commit>
```

The command writes the deterministic sidecar to `public/atlas/exam-tags.json`, prints match and unmatched counts, lists unsupported tags, and records the input CSV SHA-256. `--index` and `--output` can override the default paths. The CSV must have `word` and `tag` header columns. To regenerate exactly, use the same CSV bytes, source commit, and atlas index.

The checked-in sidecar was generated from ECDICT commit `39cfb9672c0906b63569e0453c2e6abfb9ab182a`; its input CSV SHA-256 is `d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc`. Exact matching found 7,300 of the atlas's 7,303 headwords, and 6,557 atlas words received at least one supported tag. Current intersections are: `zk` 1,466; `gk` 3,142; `cet4` 3,311; `cet6` 4,161; `ky` 3,921; `ielts` 3,620; `toefl` 3,434; `gre` 2,129. Counts overlap because one word may carry several tags.

Repository builds require and validate the checked-in sidecar. The runtime loader still tolerates a missing file for backward compatibility with older deployments; if a sidecar is present but malformed, loading fails instead of silently producing a misleading curriculum. Private catalog words inherit the tags of their exact matching public word while retaining their existing private word IDs and progress identity.

The existing `toefl-ibt-2026` curriculum ID is intentionally retained so saved path settings and per-path statistics remain compatible, but its displayed name and selection now use the ECDICT `toefl` tag. The full IELTS path remains available at 7,303 words, alongside the narrower `ielts-ecdict` path. All eight supported tags now have selectable built-in paths; switching paths does not change word IDs or shared study progress.

## Five-entry text MVP

The atlas entries `arid`, `artifact`, `deteriorate`, `notion`, and `urbanization` were added as a text-only MVP. Their headwords, source phonetics, definitions, translations, inflections, and exam tags were taken from or adapted from the same pinned ECDICT snapshot. Their learner-facing examples, collocations, usage tips, CEFR levels, and Word Atlas topics were independently written or classified for this project. These five entries intentionally have no media bits yet, so the app displays its built-in typographic fallback instead of requesting missing images or audio.

## Use in the learning desk

Run the desk with `npm run dev`, open `http://127.0.0.1:5188/`, and use the `学习内容` selector in the top bar. The selector contains the full IELTS path plus these ECDICT-filtered paths: 中考 (`zk`), 高考 (`gk`), CET-4 (`cet4`), CET-6 (`cet6`), 考研 (`ky`), IELTS (`ielts`), TOEFL (`toefl`), and GRE (`gre`). A path matches a word when that word has the selected tag; tags are not combined across paths.

## Attribution and status

Source project: [ECDICT by Linwei (skywind3000)](https://github.com/skywind3000/ECDICT), licensed under the MIT License. This project uses only its exam-tag field as a classification hint and matches those tags to its own canonical word index. The atlas's exam-category assignments and resulting learning paths are unofficial, independently curated, and are not endorsed by any examination authority or ECDICT. Exam names and abbreviations identify categories only; they do not imply affiliation.

ECDICT's repository license notice, reproduced in full:

```text
MIT License

Copyright (c) 2025 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The notice records the upstream repository's MIT terms and attribution. It is not a claim that ECDICT authors certify every underlying dictionary contribution or that examination labels are official.
