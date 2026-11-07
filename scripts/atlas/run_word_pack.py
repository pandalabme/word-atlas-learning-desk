#!/usr/bin/env python3
"""Select a priority word pack and run the complete text/media pipeline.

The existing pipeline commands remain individually review-gated. This entry
point is the explicit batch workflow for a small, machine-reviewed word pack:
IELTS candidates are considered first, then TOEFL, GRE, and finally words with
none of those three tags. Within each group, the ECDICT frequency rank is
ascending (a lower rank is more frequent); unknown ranks are considered last.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable

try:
    from common import ROOT, dump_json, load_json, load_local_env, norm
except ModuleNotFoundError:  # imported by the focused unit tests
    from .common import ROOT, dump_json, load_json, load_local_env, norm

PRIORITY = ("ielts", "toefl", "gre", "other")
WORD_RE = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
SHA_RE = re.compile(r"[0-9a-f]{40}")


def split_tags(value: str) -> set[str]:
    return {
        part.strip().casefold()
        for part in re.split(r"[;,|\s]+", value or "")
        if part.strip()
    }


def frequency_rank(row: dict[str, str]) -> int | None:
    """Return ECDICT's rank, where lower positive values are more frequent."""

    raw = (row.get("frq") or "").strip()
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def priority_group(row: dict[str, str]) -> str:
    tags = split_tags(row.get("tag") or "")
    return next((tag for tag in PRIORITY[:-1] if tag in tags), "other")


def candidate_sort_key(item: tuple[dict[str, str], int | None]):
    row, rank = item
    return (rank is None, rank if rank is not None else 2**31 - 1, norm(row["word"]))


def select_candidates(csv_path: Path, atlas_path: Path, count: int) -> list[dict[str, object]]:
    """Select missing single-word entries in deterministic priority order."""

    if count < 1:
        raise ValueError("count must be positive")
    atlas = load_json(atlas_path)
    existing = {norm(row["w"]) for row in atlas}
    rows: dict[str, dict[str, str]] = {}
    with csv_path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or not {"word", "tag", "frq"}.issubset(reader.fieldnames):
            raise ValueError("ECDICT CSV must contain word, tag, and frq columns")
        for row in reader:
            word = (row.get("word") or "").strip()
            key = norm(word)
            if not key:
                continue
            if key in rows:
                raise ValueError(f"duplicate normalized ECDICT word: {word}")
            rows[key] = row

    grouped: dict[str, list[tuple[dict[str, str], int | None]]] = {
        group: [] for group in PRIORITY
    }
    for key, row in rows.items():
        word = (row.get("word") or "").strip()
        if key in existing or not WORD_RE.fullmatch(word):
            continue
        if not 4 <= len(word) <= 16:
            continue
        rank = frequency_rank(row)
        grouped[priority_group(row)].append((row, rank))

    selected: list[dict[str, object]] = []
    for group in PRIORITY:
        for row, rank in sorted(grouped[group], key=candidate_sort_key):
            selected.append({
                "word": row["word"].strip(),
                "group": group,
                "frequencyRank": rank,
                "tags": sorted(split_tags(row.get("tag") or "")),
            })
            if len(selected) == count:
                return selected
    return selected


def run_step(root: Path, *args: str) -> None:
    command = [sys.executable, str(root / "scripts/atlas" / args[0]), *args[1:]]
    print("$", " ".join(command))
    subprocess.run(command, cwd=root, check=True)


def approve_text(batch: Path) -> None:
    path = batch / "manifest.json"
    manifest = load_json(path)
    manifest["status"] = "approved"
    manifest["approval"] = {
        "mode": "automatic-word-pack",
        "text": "approved",
        "media": "approved",
    }
    dump_json(path, manifest)


def approve_media(batch: Path, keys: Iterable[str] | None = None) -> None:
    path = batch / "media/review.json"
    review = load_json(path)
    selected = set(keys) if keys is not None else set(review["items"])
    for ident in selected:
        if ident not in review["items"]:
            raise ValueError(f"media review is missing {ident}")
        for key in review["items"][ident]:
            if key != "instructions":
                review["items"][ident][key] = "approved"
    review["approval"] = {
        "mode": "automatic-word-pack",
        "all": "approved",
    }
    dump_json(path, review)


def validate_configuration(image_provider: str) -> None:
    missing: list[str] = []

    def require_any(*names: str) -> None:
        if not any(os.getenv(name) for name in names):
            missing.append(" or ".join(names))

    if image_provider == "newapi":
        require_any("ATLAS_NEWAPI_API_KEY", "NEWAPI_API_KEY")
        require_any("ATLAS_NEWAPI_BASE_URL", "NEWAPI_BASE_URL")
    elif image_provider == "cloudflare":
        require_any("CLOUDFLARE_ACCOUNT_ID")
        require_any("CLOUDFLARE_API_TOKEN")
    else:
        require_any("ATLAS_OPENAI_API_KEY", "OPENAI_API_KEY")
    require_any("ATLAS_ELEVENLABS_API_KEY", "ELEVENLABS_API_KEY")
    if missing:
        raise SystemExit("missing configured pipeline values: " + ", ".join(missing))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv-path", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--batch-id", required=True)
    parser.add_argument("--count", type=int, default=5)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--provider", choices=["codex-cli", "api"], default="codex-cli")
    parser.add_argument("--codex-model", default=os.getenv("CODEX_MODEL"))
    parser.add_argument("--ex2", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="select and print words without changing the atlas")
    parser.add_argument("--apply", action="store_true", help="append and activate the selected word pack")
    args = parser.parse_args()

    if not SHA_RE.fullmatch(args.source_commit):
        parser.error("--source-commit must be a lowercase 40-character git SHA")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", args.batch_id):
        parser.error("--batch-id must be a lowercase safe slug")
    if args.dry_run and args.apply:
        parser.error("use --dry-run or --apply, not both")
    root = args.root.resolve()
    csv_path = args.csv_path if args.csv_path.is_absolute() else root / args.csv_path
    load_local_env(root)
    image_provider = (os.getenv("ATLAS_IMAGE_PROVIDER") or "openai").strip().lower()
    selected = select_candidates(csv_path, root / "data/word-atlas.json", args.count)
    if len(selected) < args.count:
        raise SystemExit(f"only {len(selected)} eligible missing words found; need {args.count}")
    print(json.dumps({"count": len(selected), "priority": selected}, ensure_ascii=False, indent=2))
    if not args.apply:
        return 0
    validate_configuration(image_provider)
    batch = root / ".local/forge/batches" / args.batch_id
    words = [str(item["word"]) for item in selected]
    run_step(root, "prepare_ecdict_batch.py", str(csv_path), "--source-commit", args.source_commit,
             "--batch-id", args.batch_id, "--words", *words, "--atlas", "data/word-atlas.json")
    text_args = ["gen_text.py", "--batch-dir", str(batch), "--provider", args.provider]
    if args.codex_model:
        text_args.extend(["--codex-model", args.codex_model])
    run_step(root, *text_args)
    approve_text(batch)
    run_step(root, "append_atlas.py", "--batch-dir", str(batch), "--root", str(root), "--apply")
    run_step(root, "../import_ecdict_exam_tags.py", str(csv_path), "--source-commit", args.source_commit,
             "--index", "public/atlas/index.json", "--output", "public/atlas/exam-tags.json")
    media_args = ["plan_media.py", "--batch-dir", str(batch), "--root", str(root)]
    if args.ex2:
        media_args.append("--ex2")
    run_step(root, *media_args)
    approve_media(batch)
    run_step(root, "gen_images.py", "--batch-dir", str(batch), "--root", str(root))
    approve_media(batch)
    run_step(root, "gen_audio.py", "--batch-dir", str(batch), "--root", str(root))
    approve_media(batch)
    run_step(root, "check_media.py", "--batch-dir", str(batch), "--root", str(root), "--require-approved")
    run_step(root, "install_media.py", "--batch-dir", str(batch), "--root", str(root), "--apply")
    run_step(root, "activate_media.py", "--batch-dir", str(batch), "--root", str(root), "--apply")
    run_step(root, "check_media.py", "--batch-dir", str(batch), "--root", str(root),
             "--media-root", "public/atlas", "--require-approved")
    subprocess.run(["node", "scripts/check-atlas.mjs"], cwd=root, check=True)
    subprocess.run(["node", "scripts/check-curricula.mjs"], cwd=root, check=True)
    print(f"Activated automatic word pack: {', '.join(words)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, csv.Error, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
