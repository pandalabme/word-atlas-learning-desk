# Word Atlas text pipeline V1

This pipeline prepares ECDICT candidates, produces reviewable text records, and appends approved records without sorting or rewriting existing atlas entries. The adapted text generator is based on `designfuchen/word-atlas` at commit `19a9bd889d2f642fef1d8d0eef85a3f35e1a66ff` ([upstream generator](https://github.com/designfuchen/word-atlas/blob/19a9bd889d2f642fef1d8d0eef85a3f35e1a66ff/scripts/atlas/gen_text.py)). The batch interfaces and append logic are local V1 adaptations.

## Batch contract and review

Each batch lives in `.local/forge/batches/<safe-batch-id>/` and contains:

- `manifest.json`: schema version, status (`draft` or `approved`), ECDICT commit and CSV SHA-256, selection details, and generator mode.
- `headwords.json`: ordered `{ "hid", "word" }` records. `hid` is a stable lowercase atlas ID.
- `ecdict-source.json`: original selected CSV rows, including definition, translation, phonetic, tags, and exchange fields.
- `text/<hid>.json`: canonical text record per selected headword.

Generation never approves a batch. Starting any regeneration resets its status to `draft`, so changed text must be reviewed again. Offline mode creates explicit editorial scaffolds and marks the batch `offline-scaffold`; the appender rejects these even if someone changes status. Use either the API mode or the Codex CLI mode only when deliberately generating content, then review and edit every record. Check that source meanings and pronunciation remain faithful, examples are natural and translated, and topic/CEFR are appropriate. Set manifest `status` to `approved` only after that review and ensure generator mode is not `offline-scaffold`.

## Commands

Use a fixed ECDICT checkout/export and record the full Git commit for that source:

```sh
python scripts/atlas/prepare_ecdict_batch.py /path/to/ecdict.csv \
  --source-commit <40-character-commit> --batch-id 2026-11-sample \
  --words arid artifact
```

Or select reproducibly from the ECDICT/atlas difference with `--limit N --seed N`. Without `--words` or `--limit`, all difference candidates are written. The adapter does not alter formal data.

Filter candidates to one or more ECDICT exam tags with `--tag toefl`; repeated or comma-separated tags use OR semantics. For example, add `--tag toefl --limit 50 --seed 2026` to select at most 50 missing TOEFL-tagged words reproducibly. Explicit `--words` selections are also checked against supplied tags.

For a no-network input/prompt inspection:

```sh
python scripts/atlas/gen_text.py --batch-dir .local/forge/batches/2026-11-sample --dry-run
```

For an offline structural scaffold (not publishable):

```sh
python scripts/atlas/gen_text.py --batch-dir .local/forge/batches/2026-11-sample --offline
```

To generate through the locally signed-in Codex CLI (using the Codex account allowance rather than `OPENAI_API_KEY`):

```sh
python scripts/atlas/gen_text.py \
  --batch-dir .local/forge/batches/2026-11-sample \
  --provider codex-cli \
  --codex-cli codex
```

The provider invokes `codex exec` with an ephemeral read-only sandbox, a JSON schema, and a per-record output file. It does not need repository access or an API key. The CLI path is read from `--codex-cli`, `CODEX_CLI_PATH`, `CODEX_APP_RUNTIME_CLI_PATH`, or finally `codex`. Set `--codex-model MODEL` or `CODEX_MODEL` when needed; set `--codex-timeout SECONDS` for a slower environment. Codex CLI is now the default provider; use `--provider api` only when deliberately using `OPENAI_API_KEY`. `--force` is required when replacing an existing offline scaffold.

After generation, manual editorial review, and setting `status` to `approved`, inspect and apply:

```sh
python scripts/atlas/append_atlas.py --batch-dir .local/forge/batches/2026-11-sample
python scripts/atlas/append_atlas.py --batch-dir .local/forge/batches/2026-11-sample --apply
python scripts/import_ecdict_exam_tags.py /path/to/ecdict.csv \
  --source-commit <same-40-character-commit>
npm run check:atlas
npm run check:curricula
npm test
npm run build
```

The appender refuses unapproved batches, malformed text, duplicate IDs/headwords, and differing collisions. Exact entries already present are skipped. Dry-run is the default. Apply validates the complete batch and target state before staging outputs; it appends to `data/word-atlas.json` and CSV, the public index, and only affected 100-row chunks. New records have `m=0`. Existing physical order is retained; append order does not imply course sequence. Rebuilding exam tags is a deterministic explicit step after append, using the same fixed ECDICT source CSV and commit.

## Failure and rollback

An error before apply leaves formal outputs untouched. If an apply is interrupted during filesystem replacement, restore the affected files from version control together as one change, then rerun the appender and checks. Never hand-edit the generated index/chunks independently. A batch can be discarded by removing only its own directory under `.local/forge/batches`.

## Limits

V1 creates text only. It does not produce image or audio media. Topic and CEFR classification need human review. Offline scaffold examples are placeholders and are rejected by the appender. The generator writes each text record separately, so interrupted runs can resume by rerunning; completed files are deterministically overwritten in offline mode. The API and Codex CLI modes skip completed records and retry transient request failures. No credentials are stored in the repository. The checker validates media flags and references structurally; local media existence is checked only when `--media-root` or `--require-local-media` is supplied because current media is served remotely.

## Priority word-pack flow

For a small automatic word pack, use `scripts/atlas/run_word_pack.py`. It selects missing single-word entries in this order: `ielts`, `toefl`, `gre`, then entries without those three tags. Within each group it sorts by ECDICT `frq` ascending; unknown or zero ranks are placed last, with the normalized headword as a stable tie-breaker. The flow then prepares text, generates through Codex CLI, appends the formal atlas, rebuilds exam tags, plans and generates media, marks every text/scene/media review as `approved`, installs and activates media, and runs the atlas/curriculum checks.

Preview the deterministic selection without changing files:

```bash
python scripts/atlas/run_word_pack.py \
  --csv-path .local/forge/sources/ecdict-<commit>.csv \
  --source-commit <commit> \
  --batch-id priority-word-pack-YYYYMMDD \
  --count 5 --dry-run
```

Use `--apply` to run the complete automatic flow. Automatic approval is intentionally scoped to this explicit entry point; the underlying single-step scripts retain their normal review gates.
