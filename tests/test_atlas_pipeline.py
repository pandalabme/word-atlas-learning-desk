import csv, importlib.util, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[1]
PY=sys.executable
COMMIT="0123456789abcdef0123456789abcdef01234567"

class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp=Path(tempfile.mkdtemp()); self.root=self.tmp/"repo"; self.root.mkdir()
        for d in ("data","public/atlas/entries",".local/forge/batches"): (self.root/d).mkdir(parents=True,exist_ok=True)
        row={"w":"known","uk":"/k/","us":"/k/","senses":[{"pos":"n.","zh":"已知","en":"known"}],"ex":[{"en":"a","zh":"甲"},{"en":"b","zh":"乙"}],"col":[],"fam":[],"syn":[],"ant":[],"tip":"","cefr":"A1","topic":"daily","note":"","id":"known"}
        (self.root/"data/word-atlas.json").write_text(json.dumps([row]),encoding="utf8")
        (self.root/"data/word-atlas.csv").write_text("id,word,ipa_uk,ipa_us,cefr,topic,meanings_zh,definition_en,example1_en,example1_zh,example2_en,example2_zh,collocations,word_family,synonyms,antonyms,tip_zh\nknown,known,,,,,,,,,,,,,,,\n",encoding="utf8")
        (self.root/"public/atlas/entries/0.json").write_text(json.dumps([{**row,"m":0}]),encoding="utf8")
        topics=[["daily","生活"]]
        ix={"id":"word-atlas-open","version":1,"name":"fixture","license":"CC BY 4.0","count":1,"examples":2,"illustrated":0,"voiced":0,"chunk":100,"topics":topics,"cefr":["A1","A2","B1","B2","C1","C2"],"fields":["id","word","zh","ipa","cefr","topic","media"],"words":[["known","known","已知","/k/",0,0,0]]}
        (self.root/"public/atlas/index.json").write_text(json.dumps(ix),encoding="utf8")
        self.csv=self.tmp/"ecdict.csv"
        with self.csv.open("w",newline="",encoding="utf8") as f:
            w=csv.DictWriter(f,fieldnames=["word","phonetic","definition","translation","tag","exchange","pos"]); w.writeheader(); w.writerow({"word":"New Word","phonetic":"njuː","definition":"A definition","translation":"新词","tag":"cet4","exchange":"","pos":"n."}); w.writerow({"word":"known","definition":"known","translation":"已知","tag":"gk"})
        self.batch="test-batch"; self.batch_dir=self.root/".local/forge/batches"/self.batch
    def runpy(self,script,*args,ok=True):
        env=os.environ.copy(); env["PYTHONIOENCODING"]="utf-8"
        r=subprocess.run([PY,str(BASE/"scripts/atlas"/script),*map(str,args)],cwd=BASE,text=True,capture_output=True,encoding="utf-8",env=env)
        if ok and r.returncode: self.fail(r.stdout+r.stderr)
        if not ok: self.assertNotEqual(r.returncode,0)
        return r
    def prepare(self):
        self.runpy("prepare_ecdict_batch.py",self.csv,"--source-commit",COMMIT,"--batch-id",self.batch,"--words","new word","--atlas",self.root/"data/word-atlas.json","--batches",self.root/".local/forge/batches")
    def complete(self):
        h=json.loads((self.batch_dir/"headwords.json").read_text(encoding="utf-8"))[0]
        (self.batch_dir/"text").mkdir(exist_ok=True)
        rec={"id":h["hid"],"w":h["word"],"uk":"/njuː/","us":"","senses":[{"pos":"n.","zh":"新词","en":"A new lexical item."}],"ex":[{"en":"A new word entered the glossary.","zh":"一个新词进入了词汇表。"},{"en":"The editor added a new word today.","zh":"编辑今天新增了一个词。"}],"col":[],"fam":[],"syn":[],"ant":[],"tip":"","cefr":"B1","topic":"daily","note":""}
        (self.batch_dir/"text"/(h["hid"]+".json")).write_text(json.dumps(rec),encoding="utf8")
        mf=json.loads((self.batch_dir/"manifest.json").read_text(encoding="utf-8")); mf["status"]="approved"; mf["generator"]={"mode":"api"}; (self.batch_dir/"manifest.json").write_text(json.dumps(mf),encoding="utf8")
    def test_prepare_difference_determinism_and_safe_slugs(self):
        self.prepare(); heads=json.loads((self.batch_dir/"headwords.json").read_text(encoding="utf-8")); self.assertEqual(heads,[{"hid":"new-word","word":"New Word"}]); self.assertEqual(len(json.loads((self.batch_dir/"ecdict-source.json").read_text(encoding="utf-8"))),1)
    def test_tag_filter_selects_only_tagged_difference(self):
        self.runpy("prepare_ecdict_batch.py",self.csv,"--source-commit",COMMIT,"--batch-id","cet4-only","--tag","cet4","--limit","20","--atlas",self.root/"data/word-atlas.json","--batches",self.root/".local/forge/batches")
        selected=json.loads((self.root/".local/forge/batches/cet4-only/headwords.json").read_text(encoding="utf-8"))
        manifest=json.loads((self.root/".local/forge/batches/cet4-only/manifest.json").read_text(encoding="utf-8"))
        self.assertEqual([x["word"] for x in selected],["New Word"]); self.assertEqual(manifest["selection"]["tags"],["cet4"])
        self.runpy("prepare_ecdict_batch.py",self.csv,"--source-commit",COMMIT,"--batch-id","wrong-tag","--words","new word","--tag","toefl","--atlas",self.root/"data/word-atlas.json","--batches",self.root/".local/forge/batches",ok=False)
    def test_offline_generation_is_explicit_nonpublishable(self):
        self.prepare(); mf=json.loads((self.batch_dir/"manifest.json").read_text(encoding="utf-8")); mf["status"]="approved"; (self.batch_dir/"manifest.json").write_text(json.dumps(mf),encoding="utf-8")
        self.runpy("gen_text.py","--batch-dir",self.batch_dir,"--offline")
        rec=json.loads(next((self.batch_dir/"text").glob("*.json")).read_text(encoding="utf-8")); self.assertIn("新词",rec["senses"][0]["zh"])
        mf=json.loads((self.batch_dir/"manifest.json").read_text(encoding="utf-8")); self.assertEqual(mf["status"],"draft"); mf["status"]="approved"; (self.batch_dir/"manifest.json").write_text(json.dumps(mf),encoding="utf-8")
        self.runpy("append_atlas.py","--batch-dir",self.batch_dir,"--root",self.root,"--apply",ok=False)
    def test_dry_run_does_not_write_and_draft_cannot_append(self):
        self.prepare(); self.runpy("gen_text.py","--batch-dir",self.batch_dir,"--dry-run")
        self.assertFalse((self.batch_dir/"text").exists())
        self.runpy("append_atlas.py","--batch-dir",self.batch_dir,"--root",self.root,"--apply",ok=False)
    def test_codex_cli_uses_ephemeral_read_only_structured_output(self):
        scripts_dir=str(BASE/"scripts"/"atlas")
        if scripts_dir not in sys.path: sys.path.insert(0,scripts_dir)
        spec=importlib.util.spec_from_file_location("atlas_gen_text",BASE/"scripts/atlas/gen_text.py")
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        head={"hid":"new-word","word":"New Word"}
        source={"definition":"A definition","translation":"新词","phonetic":"njuː"}
        def fake_run(command, **kwargs):
            self.assertEqual(command[1:3],["exec","--ephemeral"])
            self.assertIn("--sandbox",command); self.assertEqual(command[command.index("--sandbox")+1],"read-only")
            self.assertIn("--output-schema",command); self.assertIn("--output-last-message",command)
            output=Path(command[command.index("--output-last-message")+1])
            output.write_text(json.dumps({"uk":"/njuː/","us":"","senses":[{"pos":"n.","zh":"新词","en":"A new lexical item."}],"ex":[{"en":"A new word entered the glossary.","zh":"一个新词进入了词汇表。"},{"en":"The editor added a new word today.","zh":"编辑今天新增了一个词。"}],"col":[],"fam":[],"syn":[],"ant":[],"tip":"","cefr":"B1","topic":"daily"}),encoding="utf-8")
            return subprocess.CompletedProcess(command,0,"","")
        with patch.object(module.subprocess,"run",side_effect=fake_run):
            record=module.run_codex_cli(head,source,"codex",None,30)
        self.assertEqual(record["ex"][0]["zh"],"一个新词进入了词汇表。")
        self.assertFalse(module.CODEX_OUTPUT_SCHEMA["additionalProperties"])
        self.assertFalse(module.CODEX_OUTPUT_SCHEMA["properties"]["ex"]["items"]["additionalProperties"])
    def test_requires_approval_dry_run_apply_idempotence_and_tags(self):
        self.prepare(); self.complete(); original=(self.root/"data/word-atlas.json").read_bytes()
        self.runpy("append_atlas.py","--batch-dir",self.batch_dir,"--root",self.root)
        self.assertEqual((self.root/"data/word-atlas.json").read_bytes(),original)
        original_csv=(self.root/"data/word-atlas.csv").read_bytes()
        self.runpy("append_atlas.py","--batch-dir",self.batch_dir,"--root",self.root,"--apply")
        self.assertTrue((self.root/"data/word-atlas.csv").read_bytes().startswith(original_csv))
        appended=json.loads((self.root/"data/word-atlas.json").read_text(encoding="utf-8")); self.assertEqual(len(appended),2); self.assertEqual(appended[0]["id"],"known")
        self.runpy("append_atlas.py","--batch-dir",self.batch_dir,"--root",self.root,"--apply")
        idx=json.loads((self.root/"public/atlas/index.json").read_text(encoding="utf-8")); self.assertEqual(idx["count"],2)
        self.assertEqual(idx["words"][1][2],"n. 新词")
        out=self.tmp/"tags.json"; self.runpy("../import_ecdict_exam_tags.py",self.csv,"--source-commit",COMMIT,"--index",self.root/"public/atlas/index.json","--output",out)
        tags=json.loads(out.read_text(encoding="utf-8")); self.assertEqual(tags["tags"]["new-word"],["cet4"])
        text=self.batch_dir/"text/new-word.json"; changed=json.loads(text.read_text(encoding="utf-8")); changed["note"]="different note"; text.write_text(json.dumps(changed),encoding="utf-8")
        self.runpy("append_atlas.py","--batch-dir",self.batch_dir,"--root",self.root,ok=False)
    def test_conflicting_existing_id_fails(self):
        self.prepare(); self.complete(); row=json.loads((self.root/"data/word-atlas.json").read_text(encoding="utf-8"))[0]; row["id"]="new-word"; row["w"]="Different"; (self.root/"data/word-atlas.json").write_text(json.dumps([row]),encoding="utf8")
        self.runpy("append_atlas.py","--batch-dir",self.batch_dir,"--root",self.root,ok=False)
    def test_invalid_cefr_fails_before_any_formal_write(self):
        self.prepare(); self.complete(); text=self.batch_dir/"text/new-word.json"; rec=json.loads(text.read_text(encoding="utf-8")); rec["cefr"]="A9"; text.write_text(json.dumps(rec),encoding="utf-8")
        before={p:p.read_bytes() for p in [self.root/"data/word-atlas.json",self.root/"data/word-atlas.csv",self.root/"public/atlas/index.json"]}
        self.runpy("append_atlas.py","--batch-dir",self.batch_dir,"--root",self.root,"--apply",ok=False)
        self.assertTrue(all(p.read_bytes()==content for p,content in before.items()))
    def test_embedded_newline_fails_before_any_formal_write(self):
        self.prepare(); self.complete(); text=self.batch_dir/"text/new-word.json"; rec=json.loads(text.read_text(encoding="utf-8")); rec["tip"]="line one\nline two"; text.write_text(json.dumps(rec),encoding="utf-8")
        before={p:p.read_bytes() for p in [self.root/"data/word-atlas.json",self.root/"data/word-atlas.csv",self.root/"public/atlas/index.json"]}
        self.runpy("append_atlas.py","--batch-dir",self.batch_dir,"--root",self.root,"--apply",ok=False)
        self.assertTrue(all(p.read_bytes()==content for p,content in before.items()))

if __name__=="__main__": unittest.main()
