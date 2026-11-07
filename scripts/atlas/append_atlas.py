#!/usr/bin/env python3
"""Validate and append an approved batch. Dry-run is the default."""
import argparse, csv, json, sys, io
from pathlib import Path
from common import ROOT, TOPICS, as_entry, dump_json, entry_to_index, entry_to_public, load_json, norm, csv_text

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument("--batch-dir",type=Path,required=True); p.add_argument("--apply",action="store_true"); p.add_argument("--root",type=Path,default=ROOT); a=p.parse_args()
    root=a.root; batch=a.batch_dir if a.batch_dir.is_absolute() else root/a.batch_dir
    manifest=load_json(batch/"manifest.json")
    if manifest.get("status")!="approved": raise SystemExit("refusing append: batch manifest status must be approved")
    if manifest.get("generator",{}).get("mode")=="offline-scaffold": raise SystemExit("refusing append: offline scaffolds are never publishable; replace with reviewed text generated from approved source")
    heads=load_json(batch/"headwords.json"); records=load_json(batch/"ecdict-source.json"); rec_by={norm(x.get("word","")):x for x in records}
    entries=[]
    for h in heads:
        path=batch/"text"/(h["hid"]+".json")
        if not path.exists(): raise SystemExit(f"missing generated text: {path}")
        x=as_entry(load_json(path))
        if norm(x["w"])!=norm(h["word"]) or x["id"]!=h["hid"]: raise SystemExit(f"{h['word']}: hid/id/headword mismatch")
        if "OFFLINE SCAFFOLD" in x.get("note",""): raise SystemExit(f"{h['word']}: offline scaffold requires editorial completion")
        if x.get("topic") not in TOPICS: raise SystemExit(f"{h['word']}: unknown topic {x.get('topic')}")
        entries.append(x)
    ids=[x["id"] for x in entries]; words=[norm(x["w"]) for x in entries]
    if len(ids)!=len(set(ids)) or len(words)!=len(set(words)): raise SystemExit("duplicate ID/headword inside batch")
    data_path=root/"data/word-atlas.json"; data=load_json(data_path); index_path=root/"public/atlas/index.json"; idx=load_json(index_path)
    if idx.get("count")!=len(data) or len(idx.get("words",[]))!=len(data): raise SystemExit("formal JSON and public index counts differ")
    old_ids={x["id"]:x for x in data}; old_words={norm(x["w"]):x for x in data}
    if len(old_ids)!=len(data) or len(old_words)!=len(data): raise SystemExit("formal atlas already contains duplicate IDs/headwords")
    for i,(e,row) in enumerate(zip(data,idx["words"])):
        if row[0]!=e["id"] or row[1]!=e["w"]: raise SystemExit(f"formal JSON/index order mismatch at {i}")
    csv_path=root/"data/word-atlas.csv"; csv_raw=csv_path.read_bytes()
    old_csv=list(csv.DictReader(io.StringIO(csv_raw.decode("utf-8-sig",errors="strict"))))
    if len(old_csv)!=len(data) or any(r.get("id")!=e["id"] or r.get("word")!=e["w"] for r,e in zip(old_csv,data)):
        raise SystemExit("formal CSV rows do not match formal JSON order/IDs")
    chunks_dir=root/"public/atlas/entries"; chunks={}
    for number in range((len(data)+idx["chunk"]-1)//idx["chunk"]):
        chunks[number]=load_json(chunks_dir/f"{number}.json")
    for i,e in enumerate(data):
        chunk_row=chunks[i//idx["chunk"]][i%idx["chunk"]]; chunk_text={k:v for k,v in chunk_row.items() if k!="m"}
        if chunk_text!=entry_to_public(e) or chunk_row.get("m")!=idx["words"][i][6]: raise SystemExit(f"formal JSON/chunk mismatch at {i}")
    add=[]
    for e in entries:
        collision=old_ids.get(e["id"]) or old_words.get(norm(e["w"]))
        if collision:
            if collision==e: continue
            raise SystemExit(f"conflict with existing atlas entry: {e['w']} ({e['id']})")
        add.append(e)
    if not add:
        print("No changes: every entry already exists identically."); return
    data_new=data+add
    if not csv_raw.endswith(b"\n"): raise SystemExit("formal CSV must end with a newline; refusing a risky append")
    csv_add=csv_text(add).splitlines(keepends=True)
    old_header=csv_raw.splitlines()[0].decode("utf-8-sig").rstrip("\r")
    new_header=csv_add[0].rstrip("\r\n") if csv_add else ""
    if not csv_add or old_header!=new_header: raise SystemExit("formal CSV header mismatch")
    added_csv="".join(csv_add[1:])
    if b"\r\n" in csv_raw: added_csv=added_csv.replace("\n","\r\n")
    csv_new=csv_raw.decode("utf-8")+added_csv
    topic_ids={k:i for i,(k,_) in enumerate(idx["topics"])}
    rows=idx["words"]+[entry_to_index(e,topic_ids) for e in add]
    idx["words"]=rows; idx["count"]=len(rows); idx["examples"]=sum(len(e.get("ex",[])) for e in data_new)
    # The existing remote media inventory remains unchanged; each new entry starts with m=0.
    idx["illustrated"]=sum(1 for row in rows if row[6]&1); idx["voiced"]=sum(1 for row in rows if row[6]&2)
    chunk=idx.get("chunk",100); chunks_dir=root/"public/atlas/entries"; chunk_files=sorted(chunks_dir.glob("*.json"),key=lambda x:int(x.stem))
    chunks={int(f.stem):load_json(f) for f in chunk_files}
    if not chunks: raise SystemExit("public atlas chunks missing")
    new_chunks={}
    for add_index,e in enumerate(add):
        row=entry_to_public(e); row["m"]=0
        target=(len(rows)-len(add)+add_index)//chunk
        if target not in new_chunks: new_chunks[target]=list(chunks.get(target, []))
        new_chunks[target].append(row)
    idx_text=json.dumps(idx,ensure_ascii=False,separators=(",",":"))+"\n"
    writes={data_path:json.dumps(data_new,ensure_ascii=False,indent=1)+"\n",csv_path:csv_new,index_path:idx_text}
    for number,chunk_rows in new_chunks.items(): writes[chunks_dir/f"{number}.json"]=json.dumps(chunk_rows,ensure_ascii=False,separators=(",",":"))+"\n"
    if not a.apply:
        print(f"Dry-run OK: {len(add)} entries would append; {len(data)} existing entries remain in order."); return
    # Validate all target serialization before replacing any target; stage sibling files first.
    staged=[]
    try:
        for target,content in writes.items():
            tmp=target.with_name(target.name+".pipeline-tmp"); tmp.write_text(content,encoding="utf-8",newline="\n"); staged.append((tmp,target))
        for tmp,target in staged: tmp.replace(target)
    finally:
        for tmp,_ in staged:
            if tmp.exists(): tmp.unlink()
    print(f"Appended {len(add)} entries; formal count is {len(data_new)}.")
if __name__=="__main__":
    try: main()
    except (OSError,json.JSONDecodeError,KeyError,TypeError,ValueError) as e: print(f"error: {e}",file=sys.stderr); sys.exit(2)
