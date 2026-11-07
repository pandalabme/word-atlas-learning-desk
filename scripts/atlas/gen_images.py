#!/usr/bin/env python3
"""Generate one image per approved scene into batch-local staging."""
import argparse, base64, io, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path
from image_providers import generate_image, image_format
from media_common import ROOT, digest, file_hash, load_local_env, read, validate_asset, validate_plan, verify_batch, write

MOCK_WEBP = base64.b64decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==")

def convert_to_webp(blob, output, width, cwebp):
    if cwebp:
        with tempfile.TemporaryDirectory(prefix='atlas-webp-') as td:
            source_format=image_format(blob); src=Path(td)/f'source.{source_format}'; src.write_bytes(blob)
            proc=subprocess.run([cwebp,'-quiet','-q','78','-m','6','-resize',str(width),'0',str(src),'-o',str(output)],capture_output=True)
            if proc.returncode: raise ValueError(f'cwebp failed: {proc.stderr.decode(errors="replace")}')
        return 'cwebp'
    try:
        from PIL import Image
    except ImportError as exc:
        raise ValueError('cwebp executable or Pillow is required to convert provider output to WebP') from exc
    with Image.open(io.BytesIO(blob)) as source:
        source=source.convert('RGB')
        height=max(1,round(source.height*width/source.width))
        source.resize((width,height),Image.Resampling.LANCZOS).save(output,'WEBP',quality=78,method=6)
    return 'pillow'

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('--batch-dir',required=True,type=Path); p.add_argument('--only'); p.add_argument('--resume',action='store_true'); p.add_argument('--force',action='store_true'); p.add_argument('--mock',action='store_true'); p.add_argument('--root',type=Path,default=ROOT); p.add_argument('--endpoint',default=os.getenv('ATLAS_IMAGE_BASE_URL','https://api.openai.com/v1')); a=p.parse_args()
    load_local_env(a.root); batch=a.batch_dir if a.batch_dir.is_absolute() else a.root/a.batch_dir; plan=read(batch/'media/plan.json'); review=read(batch/'media/review.json'); _,entries=verify_batch(batch,a.root); validate_plan(plan,entries)
    selected=set(a.only.split(',')) if a.only else set(plan['items'])
    if selected-set(plan['items']): raise ValueError('--only contains unknown IDs')
    first_image = plan['items'][next(iter(selected))]['image'] if selected else {}
    model=os.getenv('ATLAS_IMAGE_MODEL') or first_image.get('model','')
    configured_provider=(os.getenv('ATLAS_IMAGE_PROVIDER') or '').strip().lower()
    for ident in sorted(selected):
        image=plan['items'][ident]['image']
        if image['model'] != model: raise ValueError('ATLAS_IMAGE_MODEL must match the image model in plan.json')
        plan_provider=image.get('provider') or ('cloudflare' if image['model'].startswith('@cf/') else 'openai')
        provider=configured_provider or plan_provider
        if provider != plan_provider: raise ValueError('ATLAS_IMAGE_PROVIDER must match the provider in plan.json; rerun plan_media.py after changing it')
        if review['items'][ident].get('scene')!='approved': raise ValueError(f'{ident}: scene must be approved in media/review.json before image generation')
    changed=[]
    for ident in sorted(selected):
        image=plan['items'][ident]['image']; directory=batch/'media/candidates'; target=directory/'img'/f'{ident}.webp'; thumb=directory/'thumb'/f'{ident}.webp'; side=target.with_suffix('.json')
        if target.exists() and thumb.exists() and side.exists() and thumb.with_suffix('.json').exists() and not a.force and read(side).get('inputHash')==image['inputHash'] and read(side).get('sha256')==file_hash(target) and read(thumb.with_suffix('.json')).get('inputHash')==image['inputHash'] and read(thumb.with_suffix('.json')).get('sha256')==file_hash(thumb):
            validate_asset(target,'image'); validate_asset(thumb,'thumb'); print(f'Cached image: {ident}'); continue
        if a.mock: master=thumbblob=MOCK_WEBP; source_format='webp'
        else:
            master=generate_image(provider, image['prompt'], image['model'], image.get('size','1024x1024'), a.endpoint)
            source_format=image_format(master)
            cwebp=shutil.which(os.getenv('ATLAS_CWEBP','cwebp'))
            target.parent.mkdir(parents=True,exist_ok=True); thumb.parent.mkdir(parents=True,exist_ok=True)
            conversion=';'.join(convert_to_webp(master, output, width, cwebp) for output,width in ((target,768),(thumb,256)))
            thumbblob=None
        if a.mock:
            target.parent.mkdir(parents=True,exist_ok=True); thumb.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(master); thumb.write_bytes(thumbblob)
        validate_asset(target,'image'); validate_asset(thumb,'thumb')
        meta={'inputHash':image['inputHash'],'mock':a.mock,'provider':plan_provider,'model':image['model'],'sourceFormat':'mock-webp' if a.mock else source_format,'conversion': 'mock' if a.mock else conversion,'masterSize':768,'thumbSize':256}
        meta['sha256']=file_hash(target); write(side,meta); thumbmeta={**meta,'sha256':file_hash(thumb)}; write(thumb.with_suffix('.json'),thumbmeta); changed.append(ident)
        review['items'][ident]['image']='pending'; write(batch/'media/review.json',review); print(f'Generated image: {ident}')

if __name__=='__main__':
    try: main()
    except (OSError,ValueError,KeyError,TypeError,json.JSONDecodeError) as e: print(f'error: {e}',file=sys.stderr); sys.exit(2)
