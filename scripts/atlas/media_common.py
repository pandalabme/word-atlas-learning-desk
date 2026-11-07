"""Shared helpers for the isolated, reviewable media batch pipeline."""
from __future__ import annotations

import hashlib
import json
import re
import struct
from pathlib import Path
from common import load_local_env

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM_COMMIT = "19a9bd889d2f642fef1d8d0eef85a3f35e1a66ff"
UPSTREAM = f"https://github.com/designfuchen/word-atlas/tree/{UPSTREAM_COMMIT}/scripts/atlas"
STYLE_VERSION = "word-atlas-editorial-v1"
STYLE = (
    "Mid-century modern editorial illustration, like a plate from a vintage illustrated field guide. "
    "Strict limited palette: deep ink navy, warm terracotta, mustard ochre, muted sage green and soft sky blue on warm cream paper. "
    "Flat geometric shapes, confident clean silhouettes, subtle risograph grain and paper texture, gentle shading, "
    "one clear focal subject with generous negative space, centered square composition, calm and charming mood. "
    "Absolutely no text, letters, words, numbers, captions, signs, labels, logos, watermarks or frames."
)
BITS = {"image": 1, "uk": 2, "us": 4, "ex": 8, "ex2": 16}


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def digest(value) -> str:
    raw = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_id(value):
    return isinstance(value, str) and re.fullmatch(r"[a-z0-9-]{1,64}", value) is not None


def entry_json(path: Path):
    item = read(path)
    return item


def verify_batch(batch: Path, root: Path):
    manifest = read(batch / "manifest.json")
    if manifest.get("status") != "approved":
        raise ValueError("text batch manifest status must be approved")
    if manifest.get("generator", {}).get("mode") == "offline-scaffold":
        raise ValueError("offline-scaffold text batches cannot receive media")
    heads = read(batch / "headwords.json")
    data = read(root / "data/word-atlas.json")
    index = read(root / "public/atlas/index.json")
    byid = {row[0]: i for i, row in enumerate(index["words"])}
    if len(byid) != len(index["words"]):
        raise ValueError("duplicate IDs in formal index")
    result = []
    for head in heads:
        ident = head["hid"]
        if not safe_id(ident):
            raise ValueError(f"invalid ID {ident!r}")
        path = batch / "text" / f"{ident}.json"
        text = read(path)
        if text.get("id") != ident or text.get("w") != head["word"]:
            raise ValueError(f"{ident}: text record/headword mismatch")
        pos = byid.get(ident)
        if pos is None or pos >= len(data):
            raise ValueError(f"{ident}: must already exist in formal atlas")
        formal = data[pos]
        if formal != text:
            raise ValueError(f"{ident}: batch text differs from formal atlas")
        if index["words"][pos][1] != text["w"]:
            raise ValueError(f"{ident}: formal index headword mismatch")
        chunk_path = root / "public/atlas/entries" / f"{pos // index['chunk']}.json"
        chunk = read(chunk_path)[pos % index["chunk"]]
        if {k: v for k, v in chunk.items() if k != "m"} != text:
            raise ValueError(f"{ident}: public chunk differs from batch text")
        result.append((head, text, pos))
    return manifest, result


def validate_plan(plan, entries):
    if plan.get("schemaVersion") != 1 or plan.get("status") != "planned":
        raise ValueError("unsupported media plan schema or status")
    expected = {head["hid"] for head, _, _ in entries}
    actual = set(plan.get("items", {}))
    if actual != expected:
        raise ValueError("media plan IDs must exactly match the approved batch entries")
    entry_by_id = {head["hid"]: entry for head, entry, _ in entries}
    for ident, item in plan["items"].items():
        if item.get("textHash") != digest(entry_by_id[ident]):
            raise ValueError(f"{ident}: text changed since media planning")
        image = item.get("image") or {}
        image_hash_fields = {
            key: image.get(key)
            for key in ("scene", "style", "styleVersion", "prompt", "model", "size", "format")
        }
        if "provider" in image:
            image_hash_fields["provider"] = image.get("provider")
        if image.get("provider", "openai") not in {"openai", "cloudflare", "newapi"}:
            raise ValueError(f"{ident}: unsupported image provider")
        if any(not isinstance(value, str) or not value for value in image_hash_fields.values()):
            raise ValueError(f"{ident}: incomplete image plan")
        if image.get("inputHash") != digest(image_hash_fields):
            raise ValueError(f"{ident}: image plan hash mismatch")
        kinds = set(item.get("audio", {}))
        if not {"uk", "us", "ex"}.issubset(kinds) or kinds - {"uk", "us", "ex", "ex2"}:
            raise ValueError(f"{ident}: audio plan must contain uk/us/ex and optional ex2 only")
        for kind, audio in item["audio"].items():
            hash_fields = {
                key: audio.get(key)
                for key in ("text", "voiceId", "model", "outputFormat", "kind")
            }
            if hash_fields["kind"] != kind or any(not isinstance(value, str) or not value for value in hash_fields.values()):
                raise ValueError(f"{ident}/{kind}: incomplete audio plan")
            if audio.get("inputHash") != digest(hash_fields):
                raise ValueError(f"{ident}/{kind}: audio plan hash mismatch")


def validate_review(review, plan, require_approved=False):
    if set(review.get("items", {})) != set(plan["items"]):
        raise ValueError("media review IDs must exactly match the plan")
    for ident, item in plan["items"].items():
        expected = {"scene", "image", *item["audio"]}
        flags = review["items"][ident]
        if set(flags) != expected or any(value not in {"pending", "approved"} for value in flags.values()):
            raise ValueError(f"{ident}: review states are incomplete or invalid")
        if require_approved and any(value != "approved" for value in flags.values()):
            raise ValueError(f"{ident}: all planned media and scene reviews must be approved")


def dimensions(blob: bytes):
    if blob.startswith(b"\x89PNG\r\n\x1a\n") and len(blob) >= 24:
        return struct.unpack(">II", blob[16:24]), "png"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return None, "webp"
    raise ValueError("image is not a PNG or WebP")


def valid_audio(blob: bytes):
    return len(blob) > 16 and (blob.startswith(b"ID3") or (blob[0] == 0xFF and blob[1] & 0xE0 == 0xE0))


def validate_asset(path: Path, kind: str):
    blob = path.read_bytes()
    limit = 20 * 1024 * 1024 if kind in ("image", "thumb") else 10 * 1024 * 1024
    if len(blob) < 20 or len(blob) > limit:
        raise ValueError(f"invalid media size ({len(blob)} bytes): {path}")
    if kind in ("image", "thumb"):
        dimensions(blob)
    elif not valid_audio(blob):
        raise ValueError(f"invalid MP3 frame/header: {path}")
    return blob
