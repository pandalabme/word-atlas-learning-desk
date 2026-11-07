#!/usr/bin/env python3
"""Activate an installed and verified media batch in public index/chunks only."""
import argparse, json, os, sys, tempfile
from pathlib import Path
from media_common import ROOT, digest, file_hash, read, validate_plan, validate_review, verify_batch

def main():
 p=argparse.ArgumentParser(description=__doc__); p.add_argument('--batch-dir',required=True,type=Path); p.add_argument('--root',type=Path,default=ROOT); p.add_argument('--media-root',type=Path); p.add_argument('--apply',action='store_true'); p.add_argument('--allow-mock',action='store_true'); a=p.parse_args(); root=a.root; batch=a.batch_dir if a.batch_dir.is_absolute() else root/a.batch_dir; mr=a.media_root or root/'public/atlas'; _,entries=verify_batch(batch,root); plan=read(batch/'media/plan.json'); validate_plan(plan,entries); review=read(batch/'media/review.json'); validate_review(review,plan,True); mf=read(mr/'manifests'/f'{plan["batchId"]}.json')
 if mf.get('batchId')!=plan['batchId'] or mf.get('planHash')!=file_hash(batch/'media/plan.json'): raise ValueError('install manifest does not match this plan')
 formal=read(root/'data/word-atlas.json'); idx=read(root/'public/atlas/index.json'); updates=[]
 for head,e,pos in entries:
  if formal[pos]!=e: raise ValueError(f'{head["hid"]}: formal text differs from planned approved entry')
  if digest(e)!=plan['items'][head['hid']]['textHash']: raise ValueError(f'{head["hid"]}: text changed since plan')
  ident=head['hid']; item=plan['items'][ident]; flags=review['items'].get(ident,{})
  for k in ['scene','image',*item['audio']]:
   if flags.get(k)!='approved': raise ValueError(f'{ident}/{k}: approval required')
  keys=[f'img/{ident}.webp',f'thumb/{ident}.webp']+[f'audio/{k}/{ident}.mp3' for k in item['audio']]
  for key in keys:
   info=mf['files'].get(key); path=mr/key
   if not info or not path.exists() or file_hash(path)!=info['sha256']: raise ValueError(f'missing or bad installed asset: {key}')
   if info.get('mock') and not a.allow_mock: raise ValueError('mock media is refused for activation')
  m=15 | (16 if 'ex2' in item['audio'] else 0); current=idx['words'][pos][6]
  if current not in (0,m): raise ValueError(f'{ident}: current media flags {current} conflict with activation target {m}')
  row=list(idx['words'][pos]); row[6]=m; updates.append((pos,m))
 chunks={}; chunk_size=idx['chunk']; media_by_pos={pos:(15 | (16 if 'ex2' in plan['items'][head['hid']]['audio'] else 0)) for head,_,pos in entries}
 for pos,_ in updates:
  num=pos//chunk_size
  if num not in chunks: chunks[num]=read(root/'public/atlas/entries'/f'{num}.json')
  chunk_row=chunks[num][pos%chunk_size]
  if chunk_row.get('m')!=idx['words'][pos][6]: raise ValueError(f'chunk/index media flags differ for index {pos}')
  if chunk_row.get('m') not in (0,media_by_pos[pos]): raise ValueError(f'chunk media flags conflict for index {pos}')
  chunk_row['m']=media_by_pos[pos]
 idx['words']=[list(row) for row in idx['words']]
 for pos,m in updates: idx['words'][pos][6]=m
 idx['illustrated']=sum(1 for row in idx['words'] if row[6]&1); idx['voiced']=sum(1 for row in idx['words'] if row[6]&2)
 if a.apply:
  outputs={root/'public/atlas/index.json':(json.dumps(idx,ensure_ascii=False,separators=(',',':'))+'\n')}
  for num,chunk in chunks.items(): outputs[root/'public/atlas/entries'/f'{num}.json']=(json.dumps(chunk,ensure_ascii=False,separators=(',',':'))+'\n')
  staged=[]
  try:
   for path,content in outputs.items():
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=path.name+'.',suffix='.tmp',dir=path.parent)
    with os.fdopen(fd,'w',encoding='utf-8',newline='\n') as f: f.write(content)
    staged.append((Path(tmp),path))
   for tmp,path in staged: os.replace(tmp,path)
  finally:
   for tmp,_ in staged:
    if tmp.exists(): tmp.unlink()
 else: print(f'Dry-run: would activate {len(updates)} entries (index and affected chunks only)')
if __name__=='__main__':
 try: main()
 except (OSError,ValueError,KeyError,TypeError,json.JSONDecodeError) as e: print(f'error: {e}',file=sys.stderr); sys.exit(2)
