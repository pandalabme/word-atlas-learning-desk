#!/usr/bin/env python3
"""Create a deterministic, unapproved text-generation batch from an ECDICT CSV."""
import argparse, csv, hashlib, json, random, re, sys, unicodedata
from pathlib import Path
from common import ROOT, dump_json, load_json, norm
ALLOWED_TAGS={"zk","gk","cet4","cet6","ky","ielts","toefl","gre"}

def split_tags(value):
    return {part.strip().casefold() for part in value.replace(";",",").replace("|",",").replace(" ",",").split(",") if part.strip()}

def stable_hid(word):
    s=unicodedata.normalize("NFKD",word).encode("ascii","ignore").decode().lower()
    s=re.sub(r"['’]", "", s); s=re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if not s or len(s)>64: raise ValueError(f"word cannot map to a valid stable atlas ID: {word!r}")
    return s

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument("csv_path",type=Path); p.add_argument("--source-commit",required=True); p.add_argument("--batch-id",required=True); p.add_argument("--words",nargs="*"); p.add_argument("--limit",type=int); p.add_argument("--seed",type=int,default=0); p.add_argument("--tag",action="append",default=[],help="ECDICT exam tag filter; repeat or comma-separated tags (OR)"); p.add_argument("--atlas",type=Path,default=ROOT/"data/word-atlas.json"); p.add_argument("--batches",type=Path,default=ROOT/".local/forge/batches")
    a=p.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}",a.batch_id): p.error("--batch-id must be a lowercase safe slug")
    if a.words and a.limit is not None: p.error("use --words or --limit, not both")
    requested_tags={tag.strip().casefold() for value in a.tag for tag in value.split(",") if tag.strip()}
    if requested_tags-ALLOWED_TAGS: p.error("unknown exam tag(s): "+", ".join(sorted(requested_tags-ALLOWED_TAGS)))
    if not re.fullmatch(r"[0-9a-f]{40}",a.source_commit): p.error("--source-commit must be a lowercase 40-character git SHA")
    raw=a.csv_path.read_bytes(); digest=hashlib.sha256(raw).hexdigest(); atlas=load_json(a.atlas)
    existing={norm(x["w"]) for x in atlas}; rows={}
    with a.csv_path.open(encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        if not reader.fieldnames or "word" not in reader.fieldnames: p.error("ECDICT CSV needs a word column")
        for row in reader:
            word=(row.get("word") or "").strip(); key=norm(word)
            if not key: continue
            if key in rows: raise SystemExit(f"duplicate normalized ECDICT word: {word}")
            rows[key]=row
    candidates={k:v for k,v in rows.items() if k not in existing}
    if requested_tags: candidates={k:v for k,v in candidates.items() if requested_tags & split_tags(v.get("tag") or "")}
    if a.words:
        wanted=[norm(w) for w in a.words]
        if len(wanted)!=len(set(wanted)): raise SystemExit("duplicate --words selection")
        missing=[w for w in wanted if w not in candidates]
        if missing: raise SystemExit("requested words missing or already in atlas: "+", ".join(missing))
        chosen=[candidates[w] for w in wanted]
    else:
        keys=sorted(candidates); random.Random(a.seed).shuffle(keys)
        chosen=[candidates[k] for k in keys[:a.limit]] if a.limit is not None else [candidates[k] for k in sorted(candidates)]
    if a.limit is not None and a.limit < 1: p.error("--limit must be positive")
    batch=a.batches/a.batch_id
    if batch.exists(): raise SystemExit(f"batch already exists: {batch}")
    ids=set(); raw_rows=[]; heads=[]
    for row in chosen:
        word=row["word"].strip(); hid=norm(word)
        if hid in ids: raise SystemExit(f"duplicate batch word: {word}")
        slug=stable_hid(word)
        if slug in ids: raise SystemExit(f"duplicate normalized word/ID in batch: {word}")
        ids.add(slug); raw_rows.append(dict(row)); heads.append({"hid":slug,"word":word})
    batch.mkdir(parents=True)
    dump_json(batch/"headwords.json",heads); dump_json(batch/"ecdict-source.json",raw_rows)
    dump_json(batch/"manifest.json",{"schemaVersion":1,"batchId":a.batch_id,"status":"draft","createdFrom":"ECDICT","source":{"repository":"https://github.com/skywind3000/ECDICT","commit":a.source_commit,"sha256":digest,"file":a.csv_path.name,"license":"MIT"},"selection":{"count":len(heads),"mode":"explicit" if a.words else "seeded-sample" if a.limit else "all-difference","seed":a.seed if a.limit and not a.words else None,"tags":sorted(requested_tags)},"headwords":"headwords.json","sourceRecords":"ecdict-source.json","textDirectory":"text"})
    print(f"Prepared {len(heads)} candidates in {batch}; status=draft")
if __name__=="__main__":
    try: main()
    except (OSError,csv.Error,json.JSONDecodeError,KeyError) as e: print(f"error: {e}",file=sys.stderr); sys.exit(2)
