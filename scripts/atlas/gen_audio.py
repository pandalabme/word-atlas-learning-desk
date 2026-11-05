#!/usr/bin/env python3
"""Generate planned speech into batch-local staging (no formal files touched)."""
import argparse, base64, json, os, sys, time, urllib.parse, urllib.request
from pathlib import Path
from media_common import ROOT, file_hash, load_local_env, read, validate_asset, validate_plan, verify_batch, write

DEFAULTS={'uk':'Xb7hH8MSUJpSbSDYk0k2','us':'EXAVITQu4vr4xnSDxMaL','ex':'Xb7hH8MSUJpSbSDYk0k2','ex2':'EXAVITQu4vr4xnSDxMaL'}
def main():
 p=argparse.ArgumentParser(description=__doc__); p.add_argument('--batch-dir',required=True,type=Path); p.add_argument('--root',type=Path,default=ROOT); p.add_argument('--only'); p.add_argument('--resume',action='store_true'); p.add_argument('--force',action='store_true'); p.add_argument('--mock',action='store_true'); a=p.parse_args()
 load_local_env(a.root); batch=a.batch_dir if a.batch_dir.is_absolute() else a.root/a.batch_dir; plan=read(batch/'media/plan.json'); review=read(batch/'media/review.json'); _,entries=verify_batch(batch,a.root); validate_plan(plan,entries); selected=set(a.only.split(',')) if a.only else set(plan['items'])
 if selected-set(plan['items']): raise ValueError('--only contains unknown IDs')
 api=os.getenv('ATLAS_ELEVENLABS_API_KEY') or os.getenv('ELEVENLABS_API_KEY'); endpoint=os.getenv('ATLAS_ELEVENLABS_BASE_URL','https://api.elevenlabs.io/v1').rstrip('/'); changed=[]
 for ident in sorted(selected):
  for kind,item in plan['items'][ident]['audio'].items():
   folder=batch/'media/candidates/audio'/kind; target=folder/f'{ident}.mp3'; side=target.with_suffix('.json')
   if target.exists() and side.exists() and not a.force and read(side).get('inputHash')==item['inputHash'] and read(side).get('sha256')==file_hash(target):
    validate_asset(target,'audio'); print(f'Cached audio: {ident}/{kind}'); continue
   output_format=item['outputFormat']
   if a.mock: blob=base64.b64decode('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//uQxAADB8AhT0kACAAADAMAAAB9AAAACAAADSAAAAAA')
   else:
    if not api: raise ValueError('Set ATLAS_ELEVENLABS_API_KEY (or ELEVENLABS_API_KEY)')
    voice=item['voiceId']; url=f'{endpoint}/text-to-speech/{urllib.parse.quote(voice)}?output_format={urllib.parse.quote(output_format)}'; payload=json.dumps({'text':item['text'],'model_id':item['model']}).encode()
    req=urllib.request.Request(url,payload,{'xi-api-key':api,'Content-Type':'application/json','Accept':'audio/mpeg'}); error=None
    for attempt in range(3):
     try:
      with urllib.request.urlopen(req,timeout=120) as response: blob=response.read()
      break
     except Exception as exc:
      error=exc
      if attempt==2: raise
      time.sleep(2**attempt)
   folder.mkdir(parents=True,exist_ok=True); target.write_bytes(blob); validate_asset(target,'audio'); write(side,{'inputHash':item['inputHash'],'sha256':file_hash(target),'mock':a.mock,'model':item['model'],'voiceId':item['voiceId'],'outputFormat':output_format}); changed.append((ident,kind)); review['items'][ident][kind]='pending'; write(batch/'media/review.json',review); print(f'Generated audio: {ident}/{kind}')
if __name__=='__main__':
 try: main()
 except (OSError,ValueError,KeyError,TypeError,json.JSONDecodeError) as e: print(f'error: {e}',file=sys.stderr); sys.exit(2)
