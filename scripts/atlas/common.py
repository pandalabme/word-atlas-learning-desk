"""Shared helpers for the reviewable word-atlas batch pipeline."""
from __future__ import annotations
import csv, json, os, re, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOPICS = ["education", "work", "technology", "science", "environment", "health", "society", "government", "economy", "media", "arts", "travel", "city", "nature", "daily", "emotion", "thinking", "sport", "history"]

def load_local_env(root: Path = ROOT):
    """Load simple KEY=VALUE entries from an ignored local env file.

    Existing process variables always win. This deliberately supports only the
    small dotenv subset needed by the pipeline and never logs secret values.
    """
    path = root / ".env.local"
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        name, separator, value = line.partition("=")
        name = name.strip()
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(name, value)

def norm(word: str) -> str:
    return unicodedata.normalize("NFC", word.strip()).casefold()

def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))

def dump_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")

def atlas_rows(path: Path):
    return load_json(path)

def as_entry(record: dict) -> dict:
    """Convert a generated text record to the canonical data/word-atlas.json row."""
    w = record["w"]
    uk = record.get("uk") or record.get("ipa") or ""
    us = record.get("us") or ""
    senses = record.get("senses") or []
    examples = record.get("ex") or []
    if len(examples) != 2 or not all(x.get("en") and x.get("zh") for x in examples):
        raise ValueError(f"{w}: exactly two bilingual examples required")
    if not senses or not all(x.get("pos") and x.get("zh") and x.get("en") for x in senses):
        raise ValueError(f"{w}: senses require pos, zh and en")
    entry = {"w": w, "uk": uk, "us": us, "senses": senses, "ex": examples,
            "col": record.get("col", []), "fam": record.get("fam", []), "syn": record.get("syn", []),
            "ant": record.get("ant", []), "tip": record.get("tip", ""), "cefr": record.get("cefr", "B1"),
            "topic": record.get("topic", "daily"), "note": record.get("note", ""), "id": record["id"]}
    if not isinstance(entry["id"], str) or not re.fullmatch(r"[a-z0-9-]{1,64}", entry["id"]): raise ValueError(f"{w}: invalid atlas ID")
    if entry["cefr"] not in {"A1","A2","B1","B2","C1","C2"}: raise ValueError(f"{w}: invalid CEFR {entry['cefr']!r}")
    for key in ("uk","us","tip","note","w"):
        if not isinstance(entry[key], str): raise ValueError(f"{w}: {key} must be a string")
    for key in ("col","fam","syn","ant"):
        if not isinstance(entry[key], list) or any(not isinstance(v,str) for v in entry[key]): raise ValueError(f"{w}: {key} must be an array of strings")
    text_values = [entry[key] for key in ("w","uk","us","tip","note")]
    text_values += [value for key in ("col","fam","syn","ant") for value in entry[key]]
    text_values += [sense[key] for sense in senses for key in ("pos","zh","en")]
    text_values += [example[key] for example in examples for key in ("en","zh")]
    if any("\n" in value or "\r" in value for value in text_values):
        raise ValueError(f"{w}: embedded newlines are not allowed in atlas text fields")
    return entry

def csv_text(entries):
    import io
    fields = ["id","word","ipa_uk","ipa_us","cefr","topic","meanings_zh","definition_en","example1_en","example1_zh","example2_en","example2_zh","collocations","word_family","synonyms","antonyms","tip_zh"]
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n"); writer.writeheader()
    for e in entries:
        writer.writerow({"id":e["id"],"word":e["w"],"ipa_uk":e.get("uk",""),"ipa_us":e.get("us",""),"cefr":e.get("cefr",""),"topic":e.get("topic",""),
          "meanings_zh":" | ".join(f"{s['pos']} {s['zh']}" for s in e["senses"]),"definition_en":" | ".join(s["en"] for s in e["senses"]),
          **{f"example{i+1}_{lang}":e["ex"][i].get(lang,"") for i in range(2) for lang in ("en","zh")},
          "collocations":" ; ".join(e.get("col",[])),"word_family":" ; ".join(e.get("fam",[])),"synonyms":", ".join(e.get("syn",[])),"antonyms":", ".join(e.get("ant",[])),"tip_zh":e.get("tip","")})
    return out.getvalue()

def entry_to_index(entry, topic_ids):
    first = entry["senses"][0]
    zh = f"{first['pos']} {first['zh']}"
    ipa = entry.get("uk") or entry.get("us", "")
    cefr = {"A1":0,"A2":1,"B1":2,"B2":3,"C1":4,"C2":5}.get(entry.get("cefr", "B1"),2)
    return [entry["id"], entry["w"], zh, ipa, cefr, topic_ids.get(entry.get("topic", "daily"), 14), 0]

def entry_to_public(entry):
    return {k:entry[k] for k in ("w","uk","us","senses","ex","col","fam","syn","ant","tip","cefr","topic","note","id")}
