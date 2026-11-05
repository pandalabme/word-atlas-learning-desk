#!/usr/bin/env python3
"""Import only ECDICT exam tags into the atlas word-ID sidecar."""

import argparse
import csv
import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ALLOWED = ("zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre")
ALLOWED_SET = set(ALLOWED)


def normalized(word: str) -> str:
    return unicodedata.normalize("NFC", word.strip()).casefold()


def split_tags(value: str) -> list[str]:
    return [part.strip().casefold() for part in value.replace(";", ",").replace("|", ",").replace(" ", ",").split(",") if part.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path, help="ECDICT CSV containing word and tag columns")
    parser.add_argument("--source-commit", required=True, help="ECDICT git commit used for this CSV")
    parser.add_argument("--index", type=Path, default=Path("public/atlas/index.json"))
    parser.add_argument("--output", type=Path, default=Path("public/atlas/exam-tags.json"))
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
        parser.error("--source-commit must be a lowercase 40-character git SHA")

    raw = args.csv_path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    atlas = json.loads(args.index.read_text(encoding="utf-8"))
    by_word: dict[str, list[str]] = defaultdict(list)
    for row in atlas["words"]:
        by_word[normalized(row[1])].append(row[0])
    ambiguous = {word: ids for word, ids in by_word.items() if len(ids) != 1}
    if ambiguous:
        raise SystemExit(f"Atlas contains {len(ambiguous)} ambiguous normalized headwords; refusing to assign tags")

    tags_by_id: dict[str, set[str]] = defaultdict(set)
    unknown: dict[str, int] = defaultdict(int)
    rows = matched_rows = unmatched_rows = 0
    matched_words: set[str] = set()
    unmatched_words: set[str] = set()
    with args.csv_path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or "word" not in reader.fieldnames or "tag" not in reader.fieldnames:
            raise SystemExit("CSV must have exact 'word' and 'tag' column headers")
        for row in reader:
            rows += 1
            word = row.get("word") or ""
            key = normalized(word)
            ids = by_word.get(key, []) if key else []
            if ids:
                matched_rows += 1
                matched_words.add(key)
            else:
                unmatched_rows += 1
                if key:
                    unmatched_words.add(key)
            for tag in split_tags(row.get("tag") or ""):
                if tag not in ALLOWED_SET:
                    unknown[tag] += 1
                elif ids:
                    for word_id in ids:
                        tags_by_id[word_id].add(tag)

    payload = {
        "version": 1,
        "source": {
            "name": "ECDICT",
            "repository": "https://github.com/skywind3000/ECDICT",
            "commit": args.source_commit,
            "sha256": digest,
            "license": "MIT",
        },
        "tags": {
            word_id: [tag for tag in ALLOWED if tag in tags]
            for word_id, tags in sorted(tags_by_id.items())
            if tags
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + "\n", encoding="utf-8", newline="\n")
    print(f"CSV rows: {rows}; matched rows: {matched_rows}; unmatched rows: {unmatched_rows}")
    print(f"Matched unique words: {len(matched_words)}; unmatched unique words: {len(unmatched_words)}; tagged atlas IDs: {len(payload['tags'])}")
    print(f"Unknown tags (excluded): {json.dumps(dict(sorted(unknown.items())), ensure_ascii=False)}")
    print(f"Wrote {args.output} (SHA-256 {digest})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, csv.Error, json.JSONDecodeError, KeyError, TypeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
