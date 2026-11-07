# Atlas media pipeline v1

This pipeline stages illustrations and speech independently from text approval. It never edits the formal data JSON/CSV or exam-tag data. Formal text must already be appended and approved before a plan can be created.

## Commands

From the repository root (batch directory can be relative to the root):

```sh
python scripts/atlas/plan_media.py --batch-dir .local/forge/batches/BATCH [--scene-file scenes.json] [--ex2]
python scripts/atlas/build_media_review.py --batch-dir .local/forge/batches/BATCH
python scripts/atlas/gen_images.py --batch-dir .local/forge/batches/BATCH [--only id,id] [--resume|--force] [--mock]
python scripts/atlas/gen_audio.py --batch-dir .local/forge/batches/BATCH [--only id,id] [--resume|--force] [--mock]
python scripts/atlas/check_media.py --batch-dir .local/forge/batches/BATCH [--require-approved]
python scripts/atlas/install_media.py --batch-dir .local/forge/batches/BATCH [--media-root public/atlas] [--apply]
python scripts/atlas/activate_media.py --batch-dir .local/forge/batches/BATCH [--media-root public/atlas] [--apply]
```

`plan_media.py` records deterministic text, scene, model, voice and input hashes in `media/plan.json`. Missing or generic scenes are marked pending and must be approved before image generation. Review output is a static `media/review.html`; it displays entries, examples, candidate images and audio players. It does not change files. Set individual `scene`, `image`, `uk`, `us`, `ex`, and optional `ex2` values to `approved` in `media/review.json` only after human review. Any regenerated asset returns its corresponding approval to pending. A changed plan resets all media approvals.

Image outputs are one provider image per entry. Provider output is converted into `media/candidates/img/<id>.webp` at 768 px and `media/candidates/thumb/<id>.webp` at 256 px. The pipeline prefers `cwebp` (available on PATH or configured with `ATLAS_CWEBP`) and falls back to Pillow when `cwebp` is unavailable. There is no external image search/gallery. The fixed warm editorial style is adapted from upstream `designfuchen/word-atlas`, commit [`19a9bd889d2f642fef1d8d0eef85a3f35e1a66ff`](https://github.com/designfuchen/word-atlas/tree/19a9bd889d2f642fef1d8d0eef85a3f35e1a66ff/scripts/atlas).

Speech defaults to word UK, word US, and example one (UK voice). `--ex2` adds example two (US voice). Output is MP3 44.1 kHz / 64 kbps in `media/candidates/audio/<kind>/<id>.mp3`.

## Configuration and mock media

Image settings: `ATLAS_IMAGE_MODEL` (must match the saved plan), `ATLAS_IMAGE_BASE_URL`, `ATLAS_OPENAI_API_KEY` (falls back to `OPENAI_API_KEY`), and `ATLAS_CWEBP`. ElevenLabs settings: `ATLAS_ELEVENLABS_API_KEY` (falls back to `ELEVENLABS_API_KEY`), `ATLAS_ELEVENLABS_BASE_URL`, `ATLAS_ELEVENLABS_MODEL`, and `ATLAS_ELEVENLABS_{UK,US,EX,EX2}_VOICE_ID`. The plan captures model and voice configuration; re-plan after changing them.

For local development, copy `.env.local.example` to `.env.local` and fill in only the services being used. The pipeline loads `.env.local` automatically; existing process environment variables take precedence. `.env.local` is ignored by Git and must never be committed or pasted into documentation.

Image providers: set `ATLAS_IMAGE_PROVIDER=openai` for the OpenAI Images API, `ATLAS_IMAGE_PROVIDER=cloudflare` for Cloudflare Workers AI, or `ATLAS_IMAGE_PROVIDER=newapi` for an OpenAI-compatible New API gateway. For New API, fill `ATLAS_NEWAPI_BASE_URL`, `ATLAS_NEWAPI_API_KEY`, and optionally set `ATLAS_IMAGE_MODEL` (default `gpt-image-1`). The adapter sends `Authorization: Bearer`, `model`, `prompt`, `n`, and `size` to `/v1/images/generations`, then reads `data[0].b64_json` or downloads `data[0].url`. Changing the provider changes the media plan hash; rerun `plan_media.py`, review the scene again, then run `gen_images.py`.

`--mock` writes tiny fixture WebP/MP3 bytes and marks sidecars as `mock: true`. Mock media is refused by installation and activation unless `--allow-mock` is supplied for isolated test fixtures. Never pass that flag for a production deployment.

## Two-phase deployment and rollback

1. Review and approve all media. `check_media.py --require-approved` checks the saved plan, formal approved text, asset signatures, sidecar input hashes and review completeness. This is structural validation only; it does not claim automated semantic/content review.
2. Run `install_media.py` without `--apply` to inspect the proposed copy. The default local media root is `public/atlas`, matching runtime URLs `${MEDIA_BASE}/atlas/img|thumb|audio/...`; for remote deployment pass a locally mounted or synchronized `<base>/atlas` directory. The V1 script performs filesystem installation, not HTTP upload. With `--apply`, it validates the whole batch first, copies immutable assets under that root, and writes a SHA-256 manifest at `manifests/<batchId>.json` (also retained in the batch). Identical files are skipped; a different file at a target path is a hard conflict.
3. Run `activate_media.py` without `--apply` to validate the installed manifest, hashes, review states, and exact formal text. With `--apply`, only `public/atlas/index.json` and affected `public/atlas/entries/<chunk>.json` media fields/counters change. Flags are image=1, UK=2, US=4, example=8, optional second example=16, yielding 15 or 31.

Rollback by restoring the prior index and affected chunks, then remove the installed files listed in that batch's install manifest when no other active batch references them. Keep the manifest with the batch for audit. Activation is idempotent. It validates only the requested batch and does not rewrite data JSON/CSV or exam tags.

## Limits and provenance

Human review remains required for scene suitability, image quality, pronunciation and audio content. `check_media.py` checks hashes, file signatures and structural review state, not meaning or perceptual quality. Provider response compatibility and voice availability depend on the configured external accounts. The pipeline makes no real API requests unless the generation commands are explicitly run without `--mock` and credentials are present.

The app defaults to media relative to its current deployment (`/atlas/...` in local development and `/electronic_diy/atlas/...` on project Pages), so newly installed files in `public/atlas` are used locally. For compatibility with the existing atlas, failed local image/audio loads fall back to the legacy `https://0xlei.tech/words` media host. Set `VITE_WORD_ATLAS_MEDIA_BASE_URL` when intentionally using a separate synchronized media host.
