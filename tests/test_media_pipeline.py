import hashlib, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

BASE=Path(__file__).resolve().parents[1]; PY=sys.executable
class MediaPipelineTest(unittest.TestCase):
 def setUp(self):
  self.tmp=Path(tempfile.mkdtemp()); self.root=self.tmp/'repo'; self.batch=self.root/'.local/forge/batches/b1'; self.mr=self.root/'public/atlas'
  for d in ['data','public/atlas/entries','.local/forge/batches']: (self.root/d).mkdir(parents=True,exist_ok=True)
  self.entry={'id':'known','w':'known','uk':'/k/','us':'/k/','senses':[{'pos':'n.','zh':'已知','en':'known'}],'ex':[{'en':'a known example','zh':'甲'},{'en':'another known example','zh':'乙'}],'col':[],'fam':[],'syn':[],'ant':[],'tip':'','cefr':'A1','topic':'daily','note':''}
  self.put(self.root/'data/word-atlas.json',[self.entry]); self.put(self.root/'public/atlas/index.json',{'id':'atlas','version':1,'name':'test','license':'CC','count':1,'examples':2,'illustrated':0,'voiced':0,'chunk':100,'topics':[],'cefr':[],'fields':[],'words':[['known','known','known','/k/',0,0,0]]}); self.put(self.root/'public/atlas/entries/0.json',[{**self.entry,'m':0}])
  self.batch.mkdir(parents=True); self.put(self.batch/'manifest.json',{'batchId':'b1','status':'approved','generator':{'mode':'api'}}); self.put(self.batch/'headwords.json',[{'hid':'known','word':'known'}]); (self.batch/'text').mkdir(); self.put(self.batch/'text/known.json',self.entry)
 def put(self,path,obj): path.parent.mkdir(parents=True,exist_ok=True); path.write_text(json.dumps(obj,ensure_ascii=False),encoding='utf-8')
 def read(self,path): return json.loads(path.read_text(encoding='utf-8'))
 def runpy(self,name,*args,ok=True,env=None):
  e=os.environ.copy(); e['PYTHONIOENCODING']='utf-8'; e.pop('ATLAS_IMAGE_MODEL',None); e.update(env or {}); r=subprocess.run([PY,str(BASE/'scripts/atlas'/name),'--root',str(self.root),*map(str,args)],cwd=BASE,capture_output=True,text=True,encoding='utf-8',env=e)
  if ok and r.returncode: self.fail(r.stdout+r.stderr)
  if not ok: self.assertNotEqual(r.returncode,0)
  return r
 def plan(self,ok=True): return self.runpy('plan_media.py','--batch-dir',self.batch,ok=ok)
 def assets(self):
  review=self.read(self.batch/'media/review.json'); review['items']['known']['scene']='approved'; self.put(self.batch/'media/review.json',review)
  self.runpy('gen_images.py','--batch-dir',self.batch,'--mock'); self.runpy('gen_audio.py','--batch-dir',self.batch,'--mock')
 def approve(self):
  r=self.read(self.batch/'media/review.json'); r['items']['known'].update({k:'approved' for k in r['items']['known']}); self.put(self.batch/'media/review.json',r)
 def test_unapproved_plan_scene_gate_and_deterministic_hash(self):
  mf=self.read(self.batch/'manifest.json'); mf['status']='draft'; self.put(self.batch/'manifest.json',mf); self.plan(ok=False)
  mf['status']='approved'; self.put(self.batch/'manifest.json',mf); self.plan(); first=(self.batch/'media/plan.json').read_bytes(); self.plan(); self.assertEqual(first,(self.batch/'media/plan.json').read_bytes())
  self.runpy('gen_images.py','--batch-dir',self.batch,'--mock',ok=False)
 def test_local_env_file_is_loaded_for_media_plan(self):
  (self.root/'.env.local').write_text('ATLAS_IMAGE_MODEL=local-image\nATLAS_ELEVENLABS_MODEL=local-audio\n',encoding='utf-8')
  self.plan()
  plan=self.read(self.batch/'media/plan.json')
  self.assertEqual(plan['items']['known']['image']['model'],'local-image')
  self.assertEqual(plan['items']['known']['audio']['uk']['model'],'local-audio')
 def test_cloudflare_image_provider_is_recorded_in_plan(self):
  (self.root/'.env.local').write_text('ATLAS_IMAGE_PROVIDER=cloudflare\n',encoding='utf-8')
  self.plan()
  plan=self.read(self.batch/'media/plan.json')
  self.assertEqual(plan['items']['known']['image']['provider'],'cloudflare')
  self.assertEqual(plan['items']['known']['image']['model'],'@cf/black-forest-labs/flux-1-schnell')
  review=self.read(self.batch/'media/review.json'); review['items']['known']['scene']='approved'; self.put(self.batch/'media/review.json',review)
  self.runpy('gen_images.py','--batch-dir',self.batch,'--mock',env={'ATLAS_IMAGE_PROVIDER':'cloudflare'})
  self.assertEqual(self.read(self.batch/'media/candidates/img/known.json')['provider'],'cloudflare')
 def test_mock_cache_invalidation_and_approval_revocation(self):
  self.plan(); self.assets(); self.approve(); before=self.read(self.batch/'media/review.json'); self.runpy('gen_audio.py','--batch-dir',self.batch,'--mock','--force'); after=self.read(self.batch/'media/review.json'); self.assertEqual(after['items']['known']['uk'],'pending'); self.assertEqual(after['items']['known']['image'],'approved')
  self.approve(); self.runpy('gen_images.py','--batch-dir',self.batch,'--mock'); self.assertEqual(self.read(self.batch/'media/review.json')['items']['known']['image'],'approved') # cache hit
  side=self.batch/'media/candidates/img/known.json'; meta=self.read(side); meta['inputHash']='stale'; self.put(side,meta); self.approve(); self.runpy('gen_images.py','--batch-dir',self.batch,'--mock','--force'); self.assertEqual(self.read(self.batch/'media/review.json')['items']['known']['image'],'pending')
 def test_review_install_dry_run_conflict_activate_and_idempotence(self):
  self.plan(); self.assets(); self.runpy('check_media.py','--batch-dir',self.batch,'--require-approved',ok=False); self.runpy('install_media.py','--batch-dir',self.batch,'--allow-mock',ok=False); self.approve(); self.runpy('check_media.py','--batch-dir',self.batch,'--require-approved')
  self.runpy('install_media.py','--batch-dir',self.batch,ok=False); self.runpy('install_media.py','--batch-dir',self.batch,'--allow-mock'); self.assertFalse((self.mr/'img/known.webp').exists())
  data_before=(self.root/'data/word-atlas.json').read_bytes(); self.runpy('install_media.py','--batch-dir',self.batch,'--apply','--allow-mock'); installed=self.mr/'img/known.webp'; self.assertTrue(installed.exists()); installed_before=installed.read_bytes(); self.runpy('install_media.py','--batch-dir',self.batch,'--apply','--allow-mock'); self.assertEqual(installed_before,installed.read_bytes()); self.runpy('check_media.py','--batch-dir',self.batch,'--media-root',self.mr); self.runpy('activate_media.py','--batch-dir',self.batch,'--allow-mock'); self.assertEqual(self.read(self.root/'public/atlas/index.json')['words'][0][6],0)
  self.runpy('activate_media.py','--batch-dir',self.batch,'--apply','--allow-mock'); self.assertEqual(self.read(self.root/'public/atlas/index.json')['words'][0][6],15); self.assertEqual(self.read(self.root/'public/atlas/entries/0.json')[0]['m'],15)
  self.assertEqual(data_before,(self.root/'data/word-atlas.json').read_bytes())
  index=(self.root/'public/atlas/index.json').read_bytes(); chunk=(self.root/'public/atlas/entries/0.json').read_bytes(); self.runpy('activate_media.py','--batch-dir',self.batch,'--apply','--allow-mock'); self.assertEqual(index,(self.root/'public/atlas/index.json').read_bytes()); self.assertEqual(chunk,(self.root/'public/atlas/entries/0.json').read_bytes())
  installed.write_bytes(b'conflict'); self.runpy('install_media.py','--batch-dir',self.batch,'--apply','--allow-mock',ok=False)
 def test_bad_install_and_formal_text_change_refuse_activation(self):
  self.plan(); self.assets(); self.approve(); self.runpy('install_media.py','--batch-dir',self.batch,'--apply','--allow-mock'); installed=self.mr/'img/known.webp'; installed.write_bytes(b'changed-but-present'); self.runpy('activate_media.py','--batch-dir',self.batch,'--apply','--allow-mock',ok=False); installed.unlink(); self.runpy('activate_media.py','--batch-dir',self.batch,'--apply','--allow-mock',ok=False)
  self.assets(); self.approve(); self.runpy('install_media.py','--batch-dir',self.batch,'--apply','--allow-mock'); changed={**self.entry,'tip':'changed'}; self.put(self.root/'data/word-atlas.json',[changed]); self.runpy('activate_media.py','--batch-dir',self.batch,'--apply','--allow-mock',ok=False)
 def test_check_media_passes_after_mock_staging(self):
  self.plan(); self.assets(); self.approve(); self.runpy('check_media.py','--batch-dir',self.batch,'--require-approved')
 def test_plan_tamper_review_recovery_and_install_text_guard(self):
  self.plan(); review=self.batch/'media/review.json'; review.unlink(); self.plan(); self.assertTrue(review.exists()); self.assertEqual(self.read(review)['items']['known']['scene'],'pending')
  plan_path=self.batch/'media/plan.json'; plan=self.read(plan_path); plan['items']['known']['image']['prompt']='tampered prompt'; self.put(plan_path,plan); self.runpy('check_media.py','--batch-dir',self.batch,ok=False)
  self.plan(); self.assets(); self.approve(); changed={**self.entry,'tip':'changed'}; self.put(self.root/'data/word-atlas.json',[changed]); self.runpy('install_media.py','--batch-dir',self.batch,'--apply','--allow-mock',ok=False)
 def test_chunk_index_media_mismatch_refuses_activation(self):
  self.plan(); self.assets(); self.approve(); self.runpy('install_media.py','--batch-dir',self.batch,'--apply','--allow-mock'); chunk=self.read(self.root/'public/atlas/entries/0.json'); chunk[0]['m']=2; self.put(self.root/'public/atlas/entries/0.json',chunk); self.runpy('activate_media.py','--batch-dir',self.batch,'--apply','--allow-mock',ok=False)
 def test_optional_second_example_sets_all_five_bits(self):
  self.runpy('plan_media.py','--batch-dir',self.batch,'--ex2'); self.assets(); self.approve(); self.runpy('install_media.py','--batch-dir',self.batch,'--apply','--allow-mock'); self.runpy('activate_media.py','--batch-dir',self.batch,'--apply','--allow-mock'); self.assertEqual(self.read(self.root/'public/atlas/index.json')['words'][0][6],31)
 def test_single_example_works_without_ex2_and_rejects_ex2(self):
  self.entry['ex']=self.entry['ex'][:1]
  self.put(self.root/'data/word-atlas.json',[self.entry]); self.put(self.root/'public/atlas/entries/0.json',[{**self.entry,'m':0}]); self.put(self.batch/'text/known.json',self.entry)
  self.plan(); self.assertEqual(set(self.read(self.batch/'media/plan.json')['items']['known']['audio']),{'uk','us','ex'})
  self.runpy('plan_media.py','--batch-dir',self.batch,'--ex2',ok=False)
if __name__=='__main__': unittest.main()
