#!/usr/bin/env python3
"""Create a deterministic media plan for an approved, already appended text batch."""
import argparse
import os
import sys
from pathlib import Path

from media_common import ROOT, STYLE, STYLE_VERSION, UPSTREAM, UPSTREAM_COMMIT, digest, load_local_env, read, verify_batch, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-dir", required=True, type=Path)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--scene-file", type=Path, help="JSON object mapping atlas IDs to reviewed scene strings")
    parser.add_argument("--ex2", action="store_true", help="include optional second example audio")
    args = parser.parse_args()
    load_local_env(args.root)
    batch = args.batch_dir if args.batch_dir.is_absolute() else args.root / args.batch_dir
    _, entries = verify_batch(batch, args.root)
    scenes = read(args.scene_file) if args.scene_file else {}
    image_provider = (os.getenv("ATLAS_IMAGE_PROVIDER") or "openai").strip().lower()
    if image_provider not in {"openai", "cloudflare", "newapi"}:
        raise ValueError("ATLAS_IMAGE_PROVIDER must be openai, cloudflare, or newapi")
    default_image_model = {
        "openai": "gpt-image-2.5-flare",
        "cloudflare": "@cf/black-forest-labs/flux-1-schnell",
        "newapi": "gpt-image-1",
    }[image_provider]
    image_model = os.getenv("ATLAS_IMAGE_MODEL") or default_image_model
    audio_model = os.getenv("ATLAS_ELEVENLABS_MODEL") or "eleven_v4_turbo"
    voices = {"uk": os.getenv("ATLAS_ELEVENLABS_UK_VOICE_ID", "Xb7hH8MSUJpSbSDYk0k2"), "us": os.getenv("ATLAS_ELEVENLABS_US_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")}
    records = {}
    for head, entry, _ in entries:
        ident = head["hid"]
        scene = scenes.get(ident)
        needs_review = not isinstance(scene, str) or not scene.strip()
        if needs_review:
            sense = entry["senses"][0]
            scene = f"A clear editorial scene illustrating {entry['w']} ({sense['pos']} {sense['en']}); use the example context: {entry['ex'][0]['en']}"
        image_hash_fields = {
            "provider": image_provider,
            "scene": scene,
            "style": STYLE,
            "styleVersion": STYLE_VERSION,
            "prompt": f"{STYLE}\n\nScene: {scene}",
            "model": image_model,
            "size": "1024x1024",
            "format": "webp",
        }
        image = {**image_hash_fields, "needsReview": needs_review, "inputHash": digest(image_hash_fields)}
        audio = {}
        audio_sources = [
            ("uk", entry["w"], os.getenv("ATLAS_ELEVENLABS_UK_VOICE_ID", voices["uk"])),
            ("us", entry["w"], os.getenv("ATLAS_ELEVENLABS_US_VOICE_ID", voices["us"])),
            ("ex", entry["ex"][0]["en"], os.getenv("ATLAS_ELEVENLABS_EX_VOICE_ID", voices["uk"])),
        ]
        if args.ex2:
            if len(entry["ex"]) < 2:
                raise ValueError(f"{ident}: --ex2 requires a second example")
            audio_sources.append(("ex2", entry["ex"][1]["en"], os.getenv("ATLAS_ELEVENLABS_EX2_VOICE_ID", voices["us"])))
        for kind, text, voice in audio_sources:
            cfg = {"text": text, "voiceId": voice, "model": audio_model, "outputFormat": "mp3_44100_64", "kind": kind}
            audio[kind] = {**cfg, "inputHash": digest(cfg)}
        records[ident] = {"textHash": digest(entry), "image": image, "audio": audio}
    plan = {"schemaVersion": 1, "batchId": read(batch / "manifest.json").get("batchId", batch.name),
            "status": "planned", "upstreamCommit": UPSTREAM_COMMIT, "upstreamUrl": UPSTREAM,
            "items": records}
    media = batch / "media"
    previous = media / "plan.json"
    unchanged = previous.exists() and read(previous) == plan
    if not unchanged: write(previous, plan)
    review_path = media / "review.json"
    if unchanged and review_path.exists():
        print(f"Media plan unchanged: {previous}")
        return
    # A plan change invalidates all prior media approvals and staged output.
    existing = read(review_path) if review_path.exists() and unchanged else {}
    states = {}
    for ident, item in records.items():
        prior = existing.get("items", {}).get(ident, {})
        states[ident] = {key: prior.get(key, "pending") for key in ["scene", "image", *item["audio"]]}
    write(review_path, {"schemaVersion": 1, "instructions": "Set scene to approved after reviewing the scene text. Set image/uk/us/ex (and optional ex2) to approved only after human review.", "items": states})
    print(f"Wrote media plan for {len(records)} entries: {previous}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(2)
