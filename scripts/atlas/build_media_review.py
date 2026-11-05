#!/usr/bin/env python3
"""Build a static, read-only review page and maintain the editable review template."""
import argparse, html, json, sys
from pathlib import Path
from media_common import ROOT, read, validate_plan, verify_batch, write

def main():
 p=argparse.ArgumentParser(description=__doc__); p.add_argument('--batch-dir',required=True,type=Path); p.add_argument('--root',type=Path,default=ROOT); a=p.parse_args(); batch=a.batch_dir if a.batch_dir.is_absolute() else a.root/a.batch_dir
 _,entries=verify_batch(batch,a.root); plan=read(batch/'media/plan.json'); validate_plan(plan,entries); rp=batch/'media/review.json'; review=read(rp) if rp.exists() else {'schemaVersion':1,'items':{}}
 cards=[]
 for head,e,_ in entries:
  ident=head['hid']; item=plan['items'][ident]; flags=review.setdefault('items',{}).setdefault(ident,{'scene':'pending','image':'pending','uk':'pending','us':'pending','ex':'pending'})
  flags.setdefault('ex2','pending') if 'ex2' in item['audio'] else None
  aud=' '.join(f'<section><b>{k.upper()}</b> — {html.escape(flags.get(k,"pending"))}<br>{html.escape(v["text"])} <audio controls preload="none" src="candidates/audio/{k}/{ident}.mp3"></audio></section>' for k,v in item['audio'].items())
  cards.append(f'<article><h2>{html.escape(e["w"])} <small>{ident}</small></h2><p>{html.escape(e["senses"][0]["pos"])} {html.escape(e["senses"][0]["en"])} · {html.escape(e["senses"][0]["zh"])}</p><p>{html.escape(e["ex"][0]["en"])}<br>{html.escape(e["ex"][0]["zh"])}</p><pre>{html.escape(item["image"]["scene"])}</pre><img src="candidates/img/{ident}.webp" alt="{html.escape(e["w"])}"><p>Scene: {html.escape(flags.get("scene","pending"))} · Image: {html.escape(flags.get("image","pending"))}</p>{aud}</article>')
 write(rp,review); out=batch/'media/review.html'; out.write_text('<!doctype html><meta charset="utf-8"><title>Atlas media review</title><style>body{font:16px system-ui;max-width:1100px;margin:auto;background:#f4f0e7;color:#28241e}article{padding:1rem;margin:1rem;background:white;border-radius:12px}img{width:256px}audio{display:block}</style><h1>Media review</h1><p>Read-only preview. Edit approval states in review.json after human review.</p>'+''.join(cards),encoding='utf-8'); print(out)
if __name__=='__main__':
 try: main()
 except (OSError,ValueError,KeyError,TypeError,json.JSONDecodeError) as e: print(f'error: {e}',file=sys.stderr); sys.exit(2)
