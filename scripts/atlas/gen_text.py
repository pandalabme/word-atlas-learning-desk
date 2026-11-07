#!/usr/bin/env python3
"""Generate reviewed text records for one ECDICT batch."""
import argparse, json, os, subprocess, sys, tempfile, time, urllib.request, unicodedata, re
from pathlib import Path
from common import ROOT, TOPICS, dump_json, load_json, load_local_env, norm

UPSTREAM = "https://github.com/designfuchen/word-atlas/blob/19a9bd889d2f642fef1d8d0eef85a3f35e1a66ff/scripts/atlas/gen_text.py"
PROMPT = """Create a concise bilingual vocabulary record. ECDICT definition, translation and phonetic are source facts: preserve them or faithfully organize them. Never replace a present source field with speculation; only generate missing fields. You may write examples, collocations, tips and topic. The topic value must be exactly one of: education, work, technology, science, environment, health, society, government, economy, media, arts, travel, city, nature, daily, emotion, thinking, sport, history. The cefr value must be exactly one of A1, A2, B1, B2, C1, C2. Return JSON fields senses[{pos,zh,en}], uk, us, ex[{en,zh} x2], col, fam, syn, ant, tip, cefr, topic. Exactly two natural bilingual example pairs. Source: {source}"""

# ECDICT contains IPA and other Unicode characters. Keep dry-run diagnostics
# usable on Windows consoles whose legacy code page cannot encode them.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

CODEX_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "uk": {"type": "string"},
        "us": {"type": "string"},
        "senses": {"type": "array", "items": {"type": "object", "properties": {"pos": {"type": "string"}, "zh": {"type": "string"}, "en": {"type": "string"}}, "required": ["pos", "zh", "en"], "additionalProperties": False}},
        "ex": {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "object", "properties": {"en": {"type": "string"}, "zh": {"type": "string"}}, "required": ["en", "zh"], "additionalProperties": False}},
        "col": {"type": "array", "items": {"type": "string"}},
        "fam": {"type": "array", "items": {"type": "string"}},
        "syn": {"type": "array", "items": {"type": "string"}},
        "ant": {"type": "array", "items": {"type": "string"}},
        "tip": {"type": "string"},
        "cefr": {"type": "string"},
        "topic": {"type": "string"},
    },
    "required": ["uk", "us", "senses", "ex", "col", "fam", "syn", "ant", "tip", "cefr", "topic"],
    "additionalProperties": False,
}

def offline_record(head, source):
    word=head["word"]; trans=(source.get("translation") or "").strip(); definition=(source.get("definition") or "").strip()
    pho=source.get("phonetic") or ""
    pos=(source.get("pos") or "n.").strip() or "n."
    # Explicit review markers keep offline scaffolding from being mistaken for publishable copy.
    return {"id":head["hid"],"w":word,"uk":f"/{pho}/" if pho else "","us":"","senses":[{"pos":pos,"zh":trans or "待补充中文释义","en":definition or "Editorial definition required."}],"ex":[{"en":f"[Write a natural example using {word}.]","zh":"[补充对应中文译文。]"},{"en":f"[Write a second natural example using {word}.]","zh":"[补充对应中文译文。]"}],"col":[],"fam":[],"syn":[],"ant":[],"tip":"","cefr":"B1","topic":"daily","note":"OFFLINE SCAFFOLD: editorial review required"}

def validate_record(record, head):
    record.setdefault("note", "")
    for key in ("col","fam","syn","ant"): record.setdefault(key, [])
    record.setdefault("us", ""); record.setdefault("uk", ""); record.setdefault("tip", "")
    record.setdefault("cefr", "B1"); record.setdefault("topic", "daily")
    required={"id","w","uk","us","senses","ex","col","fam","syn","ant","tip","cefr","topic","note"}
    if not isinstance(record,dict) or not required.issubset(record): raise ValueError(f"{head['word']}: response missing required fields")
    if record["id"]!=head["hid"] or record["w"]!=head["word"]: raise ValueError(f"{head['word']}: response ID/headword mismatch")
    if not record["senses"] or any(not all(isinstance(s.get(k),str) and s[k].strip() for k in ("pos","zh","en")) for s in record["senses"]): raise ValueError(f"{head['word']}: invalid senses")
    if len(record["ex"])!=2 or any(not all(isinstance(x.get(k),str) and x[k].strip() for k in ("en","zh")) for x in record["ex"]): raise ValueError(f"{head['word']}: exactly two bilingual examples required")
    if record["cefr"] not in {"A1", "A2", "B1", "B2", "C1", "C2"}: raise ValueError(f"{head['word']}: invalid CEFR {record['cefr']!r}")
    if record["topic"] not in TOPICS: raise ValueError(f"{head['word']}: unknown topic {record['topic']!r}")
    return record


def run_codex_cli(head, source, cli, model, timeout):
    """Generate one record through a ChatGPT-authenticated Codex CLI session."""
    source_facts = json.dumps(
        {k: source.get(k) for k in ("definition", "translation", "phonetic")},
        ensure_ascii=False,
    )
    prompt = (
        PROMPT.replace("{source}", source_facts)
        + f"\nHeadword: {head['word']}\nReturn only the JSON object; do not use Markdown fences."
    )
    with tempfile.TemporaryDirectory(prefix="word-atlas-codex-") as temp:
        temp_path = Path(temp)
        schema_path = temp_path / "schema.json"
        answer_path = temp_path / "answer.json"
        schema_path.write_text(json.dumps(CODEX_OUTPUT_SCHEMA), encoding="utf-8")
        command = [
            cli,
            "exec",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--output-schema",
            str(schema_path),
            "--output-last-message",
            str(answer_path),
            "-",
        ]
        if model:
            command[2:2] = ["--model", model]
        try:
            result = subprocess.run(
                command,
                input=prompt,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(f"Codex CLI not found: {cli}") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"Codex CLI timed out after {timeout}s") from exc
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()[-2000:]
            raise RuntimeError(f"Codex CLI exited with {result.returncode}: {detail}")
        if not answer_path.exists():
            raise RuntimeError("Codex CLI did not write an output message")
        try:
            return json.loads(answer_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError("Codex CLI output was not valid JSON") from exc


def generate_codex_record(head, source, cli, model, timeout):
    last_error = None
    for attempt in range(4):
        try:
            return run_codex_cli(head, source, cli, model, timeout)
        except RuntimeError as exc:
            last_error = exc
            if attempt == 3:
                raise
            time.sleep(min(2**attempt, 8))
    raise RuntimeError(str(last_error))

def main():
    load_local_env(ROOT)
    p=argparse.ArgumentParser(description=__doc__); p.add_argument("--batch-dir",type=Path,required=True); p.add_argument("--source-policy",choices=["ecdict-prefer"],default="ecdict-prefer"); p.add_argument("--provider",choices=["api","codex-cli"],default="codex-cli",help="text-generation backend (default: Codex CLI)"); p.add_argument("--offline",action="store_true",help="write editorial scaffolds without network/API"); p.add_argument("--dry-run",action="store_true",help="print inputs/prompts only; do not write text"); p.add_argument("--force",action="store_true",help="regenerate existing records"); p.add_argument("--model",default=os.getenv("OPENAI_MODEL","gpt-4o-mini"),help="API model; not passed to Codex CLI unless --codex-model is set"); p.add_argument("--codex-cli",default=os.getenv("CODEX_CLI_PATH") or os.getenv("CODEX_APP_RUNTIME_CLI_PATH") or "codex"); p.add_argument("--codex-model",default=os.getenv("CODEX_MODEL")); p.add_argument("--codex-timeout",type=int,default=180); a=p.parse_args()
    if a.codex_timeout < 1: p.error("--codex-timeout must be positive")
    batch=a.batch_dir if a.batch_dir.is_absolute() else ROOT/a.batch_dir
    manifest=load_json(batch/"manifest.json"); heads=load_json(batch/"headwords.json"); sources=load_json(batch/"ecdict-source.json")
    byword={norm(x.get("word","")):x for x in sources}; out=batch/"text"
    mode="offline-scaffold" if a.offline else a.provider
    generation_started=False
    def mark_generation_started():
        nonlocal generation_started
        if generation_started: return
        generation_started=True
        manifest["status"]="draft"
        manifest["generator"]={"source":"designfuchen/word-atlas gen_text.py adapted","upstreamCommit":"19a9bd889d2f642fef1d8d0eef85a3f35e1a66ff","upstreamUrl":UPSTREAM,"mode":mode,"sourcePolicy":a.source_policy}
        dump_json(batch/"manifest.json",manifest)
    if not a.dry_run: out.mkdir(parents=True,exist_ok=True)
    for h in heads:
        source=byword.get(norm(h["word"]))
        if not source: raise SystemExit(f"missing ECDICT source record for {h['word']}")
        target=out/f"{h['hid']}.json"
        if target.exists() and not a.force and not a.offline and not a.dry_run:
            cached=validate_record(load_json(target),h)
            print(f"Cached: {h['word']}"); continue
        prompt=PROMPT.replace("{source}",json.dumps({k:source.get(k) for k in ("definition","translation","phonetic")},ensure_ascii=False))
        if a.dry_run:
            print(f"--- {h['word']} ---\n{prompt}"); continue
        mark_generation_started()
        if a.offline:
            record=offline_record(h,source)
        elif a.provider == "codex-cli":
            record = generate_codex_record(h, source, a.codex_cli, a.codex_model, a.codex_timeout)
        else:
            key=os.getenv("OPENAI_API_KEY")
            if not key: raise SystemExit("Set OPENAI_API_KEY, use --provider codex-cli, or use --offline; no API call was made")
            url=os.getenv("OPENAI_BASE_URL","https://api.openai.com/v1").rstrip("/")+"/chat/completions"
            payload={"model":a.model,"messages":[{"role":"system","content":prompt},{"role":"user","content":f"Headword: {h['word']}"}],"response_format":{"type":"json_object"}}
            req=urllib.request.Request(url,data=json.dumps(payload).encode(),headers={"Authorization":f"Bearer {key}","Content-Type":"application/json"})
            error=None
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(req,timeout=90) as response: record=json.loads(json.loads(response.read())["choices"][0]["message"]["content"])
                    break
                except Exception as exc:
                    error=exc
                    if attempt==3: raise
                    time.sleep(min(2**attempt,8))
            # Do not discard source pronunciation or translated definition when output omits them.
            if not record.get("uk") and source.get("phonetic"): record["uk"]="/"+source["phonetic"]+"/"
            if record.get("senses") and source.get("translation") and not any(x.get("zh") for x in record["senses"]): record["senses"][0]["zh"]=source["translation"]
        record.update({"id":h["hid"],"w":h["word"]})
        validate_record(record,h)
        dump_json(target,record)
    if not a.dry_run: print(f"Wrote text records under {out}")
if __name__=="__main__":
    try: main()
    except (OSError,json.JSONDecodeError,KeyError,TypeError,ValueError) as e: print(f"error: {e}",file=sys.stderr); sys.exit(2)
