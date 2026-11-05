#!/usr/bin/env python3
"""Install fully approved staged media. Dry-run is the default."""
import argparse, json, shutil, sys
from pathlib import Path
from media_common import ROOT, digest, file_hash, read, validate_asset, validate_plan, validate_review, verify_batch, write

def main():
 p=argparse.ArgumentParser(description=__doc__); p.add_argument('--batch-dir',required=True,type=Path); p.add_argument('--root',type=Path,default=ROOT); p.add_argument('--media-root',type=Path); p.add_argument('--apply',action='store_true'); p.add_argument('--allow-mock',action='store_true'); a=p.parse_args(); batch=a.batch_dir if a.batch_dir.is_absolute() else a.root/a.batch_dir; mr=a.media_root or a.root/'public/atlas'; plan=read(batch/'media/plan.json'); review=read(batch/'media/review.json'); _,entries=verify_batch(batch,a.root); validate_plan(plan,entries); validate_review(review,plan,True); files={}
 for head,entry,_ in entries:
  if digest(entry)!=plan['items'][head['hid']]['textHash']: raise ValueError(f'{head["hid"]}: text changed since plan')
 for ident,item in plan['items'].items():
  flags=review['items'].get(ident,{})
  for k in ['scene','image',*item['audio']]:
   if flags.get(k)!='approved': raise ValueError(f'{ident}/{k}: approval required before installation')
  for kind,src,dest in [('image',batch/'media/candidates/img'/f'{ident}.webp',Path('img')/f'{ident}.webp'),('thumb',batch/'media/candidates/thumb'/f'{ident}.webp',Path('thumb')/f'{ident}.webp')]:
   validate_asset(src,kind); meta=read(src.with_suffix('.json'))
   if meta.get('inputHash')!=item['image']['inputHash'] or meta.get('sha256')!=file_hash(src): raise ValueError(f'{ident}/{kind}: input/asset hash mismatch')
   if meta.get('mock') and not a.allow_mock: raise ValueError('mock media is refused by default; --allow-mock is for test fixtures only')
   files[dest.as_posix()]=(src,meta.get('mock',False))
  for k,cfg in item['audio'].items():
   src=batch/'media/candidates/audio'/k/f'{ident}.mp3'; validate_asset(src,'audio'); meta=read(src.with_suffix('.json'))
   if meta.get('inputHash')!=cfg['inputHash'] or meta.get('sha256')!=file_hash(src): raise ValueError(f'{ident}/{k}: input/asset hash mismatch')
   if meta.get('mock') and not a.allow_mock: raise ValueError('mock media is refused by default; --allow-mock is for test fixtures only')
   files[(Path('audio')/k/f'{ident}.mp3').as_posix()]=(src,meta.get('mock',False))
 outputs={}
 for rel,(src,mock) in files.items():
  target=mr/rel; sha=file_hash(src)
  if target.exists() and file_hash(target)!=sha: raise ValueError(f'install conflict at {target}; refusing overwrite')
  outputs[rel]={'sha256':sha,'size':src.stat().st_size,'mock':mock}
 manifest={'schemaVersion':1,'batchId':plan['batchId'],'planHash':file_hash(batch/'media/plan.json'),'files':outputs}
 mf=mr/'manifests'/f'{plan["batchId"]}.json'
 if a.apply:
  for rel,(src,_) in files.items():
   target=mr/rel; target.parent.mkdir(parents=True,exist_ok=True)
   if not target.exists(): shutil.copyfile(src,target)
  write(mf,manifest); write(batch/'media/install-manifest.json',manifest)
 else: print(f'Dry-run: would install {len(files)} media files into {mr}')
if __name__=='__main__':
 try: main()
 except (OSError,ValueError,KeyError,TypeError,json.JSONDecodeError) as e: print(f'error: {e}',file=sys.stderr); sys.exit(2)
