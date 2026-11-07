#!/usr/bin/env python3
"""Validate media plan, staged/installed bytes, sidecars and human review flags."""
import argparse, json, sys
from pathlib import Path
from media_common import ROOT, digest, file_hash, read, validate_asset, validate_plan, validate_review, verify_batch

def main():
 p=argparse.ArgumentParser(description=__doc__); p.add_argument('--batch-dir',required=True,type=Path); p.add_argument('--root',type=Path,default=ROOT); p.add_argument('--media-root',type=Path); p.add_argument('--require-approved',action='store_true'); a=p.parse_args(); batch=a.batch_dir if a.batch_dir.is_absolute() else a.root/a.batch_dir; media_root=a.media_root or a.root/'public/atlas'
 _,entries=verify_batch(batch,a.root); plan=read(batch/'media/plan.json'); validate_plan(plan,entries); review=read(batch/'media/review.json'); validate_review(review,plan,a.require_approved); manifest_path=media_root/'manifests'/f'{plan["batchId"]}.json'; manifest=read(manifest_path) if a.media_root else None
 for head,e,_ in entries:
  ident=head['hid']; item=plan['items'][ident]
  if item['textHash']!=digest(e): raise ValueError(f'{ident}: text changed since plan')
  for kind,rel in [('image',Path('candidates/img')/f'{ident}.webp'),('thumb',Path('candidates/thumb')/f'{ident}.webp')]:
   path=(media_root/('img' if kind=='image' else 'thumb')/f'{ident}.webp') if a.media_root else batch/'media'/rel
   validate_asset(path,kind); side=path.with_suffix('.json') if not a.media_root else None
   if side and (not side.exists() or read(side).get('inputHash')!=item['image']['inputHash'] or read(side).get('sha256')!=file_hash(path)): raise ValueError(f'{ident}/{kind}: sidecar input/asset hash mismatch')
  for kind,cfg in item['audio'].items():
   path=(media_root/'audio'/kind/f'{ident}.mp3') if a.media_root else batch/'media/candidates/audio'/kind/f'{ident}.mp3'; validate_asset(path,'audio')
   side=path.with_suffix('.json') if not a.media_root else None
   if side and (not side.exists() or read(side).get('inputHash')!=cfg['inputHash'] or read(side).get('sha256')!=file_hash(path)): raise ValueError(f'{ident}/{kind}: sidecar input/asset hash mismatch')
 if a.media_root:
  if not manifest or manifest.get('batchId')!=plan['batchId'] or manifest.get('planHash')!=file_hash(batch/'media/plan.json'): raise ValueError('missing or stale install manifest')
  for head,_,_ in entries:
   ident=head['hid']; item=plan['items'][ident]
   required=[f'img/{ident}.webp',f'thumb/{ident}.webp']+[f'audio/{k}/{ident}.mp3' for k in item['audio']]
   if any(key not in manifest.get('files',{}) for key in required): raise ValueError(f'{ident}: required files absent from install manifest')
  for key,info in manifest['files'].items():
   path=media_root/key
   if not path.exists() or file_hash(path)!=info['sha256']: raise ValueError(f'installed file missing or hash mismatch: {key}')
 print(f'Media checks passed for {len(entries)} entries (asset structure only; no semantic review is automated).')
if __name__=='__main__':
 try: main()
 except (OSError,ValueError,KeyError,TypeError,json.JSONDecodeError) as e: print(f'error: {e}',file=sys.stderr); sys.exit(2)
