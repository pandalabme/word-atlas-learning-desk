import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const arg = process.argv.slice(2);
const mediaArg = arg.indexOf("--media-root");
const requireMedia = arg.includes("--require-local-media");
const mediaRoot = mediaArg >= 0 ? resolve(arg[mediaArg + 1]) : null;
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
function parseCsv(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){ const ch=text[i];
    if(quoted){ if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;} else if(ch==='"') quoted=false; else cell+=ch; }
    else if(ch==='"') quoted=true; else if(ch===","){row.push(cell);cell="";} else if(ch==="\n"){row.push(cell.replace(/\r$/, ""));rows.push(row);row=[];cell="";} else cell+=ch;
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);} assert.equal(quoted,false,"unterminated quoted CSV field"); return rows;
}
const data = await json("data/word-atlas.json");
const index = await json("public/atlas/index.json");
const csv = await readFile(resolve(root, "data/word-atlas.csv"), "utf8");
assert.equal(index.count, index.words.length, "index count mismatch");
assert.equal(index.chunk, 100, "chunk size must remain 100");
assert.equal(data.length, index.count, "formal JSON/index count mismatch");
assert.equal(index.examples, data.length * 2, "example count mismatch");
const ids = new Set(), heads = new Set(), topics = new Map(index.topics.map(([id], i) => [id, i]));
const files = await readdir(resolve(root, "public/atlas/entries"));
const chunkCount = Math.ceil(index.count / index.chunk);
assert.equal(files.filter((x) => /^\d+\.json$/.test(x)).length, chunkCount, "chunk file count mismatch");
let examples = 0, illustrated = 0, voiced = 0;
for (let c = 0; c < chunkCount; c++) {
  const rows = await json(`public/atlas/entries/${c}.json`);
  assert.equal(rows.length, Math.min(index.chunk, index.count - c * index.chunk), `chunk ${c} length mismatch`);
  for (let j = 0; j < rows.length; j++) {
    const pos = c * index.chunk + j, e = rows[j], ix = index.words[pos], formal = data[pos];
    assert.equal(ix[0], e.id, `chunk/index ID mismatch at ${pos}`);
    assert.equal(ix[1], e.w, `chunk/index headword mismatch at ${pos}`);
    assert.equal(ix[2], `${e.senses[0]?.pos ?? ""} ${e.senses[0]?.zh ?? ""}`.trim(), `index definition mismatch at ${pos}`);
    assert.equal(ix[3], e.uk || e.us || "", `index phonetic mismatch at ${pos}`);
    assert.equal(ix[4], ({ A1:0,A2:1,B1:2,B2:3,C1:4,C2:5 })[e.cefr], `index CEFR mismatch at ${pos}`);
    assert.equal(ix[5], topics.get(e.topic), `index topic mismatch at ${pos}`);
    assert.ok(Number.isInteger(ix[6]) && ix[6] >= 0 && (ix[6] & ~31) === 0, `invalid media bitfield at ${pos}`);
    assert.equal(e.m, ix[6], `chunk/index media mismatch at ${pos}`);
    const {m: _chunkMedia, ...chunkText}=e;
    assert.deepEqual(chunkText, formal, `formal/chunk text mismatch at ${pos}`);
    assert.equal(e.ex.length, 2, `expected two examples at ${pos}`); examples += e.ex.length;
    assert.ok(/^[a-z0-9-]{1,64}$/.test(e.id), `invalid ID ${e.id}`);
    assert.ok(!ids.has(e.id), `duplicate ID ${e.id}`); ids.add(e.id);
    const h=e.w.normalize("NFC").trim().toLocaleLowerCase("en-US");
    assert.ok(!heads.has(h), `duplicate headword ${e.w}`); heads.add(h);
    if (ix[6] & 1) illustrated++; if (ix[6] & 2) voiced++;
    if ((mediaRoot || requireMedia) && ix[6]) {
      const base = mediaRoot ?? resolve(root, "public/atlas");
      const paths=[];
      if(ix[6]&1) paths.push(`img/${e.id}.webp`,`thumb/${e.id}.webp`);
      for(const [bit,kind] of [[2,"uk"],[4,"us"],[8,"ex"],[16,"ex2"]]) if(ix[6]&bit) paths.push(`audio/${kind}/${e.id}.mp3`);
      for(const path of paths) try { await readFile(join(base,path)); } catch { assert.fail(`missing local media ${path}`); }
    }
  }
}
assert.equal(examples,index.examples); assert.equal(illustrated,index.illustrated); assert.equal(voiced,index.voiced);
const csvRows=parseCsv(csv); const headers=csvRows.shift();
assert.deepEqual(headers,["id","word","ipa_uk","ipa_us","cefr","topic","meanings_zh","definition_en","example1_en","example1_zh","example2_en","example2_zh","collocations","word_family","synonyms","antonyms","tip_zh"],"CSV header mismatch");
assert.equal(csvRows.length,data.length,"CSV row count mismatch");
const csvById=new Map();
for(const vals of csvRows){assert.equal(vals.length,headers.length,"CSV column count mismatch"); const rec=Object.fromEntries(headers.map((h,i)=>[h,vals[i]])); assert.ok(!csvById.has(rec.id),`duplicate CSV ID ${rec.id}`); csvById.set(rec.id,rec);}
for(const e of data){const r=csvById.get(e.id); assert.ok(r,`CSV missing ID ${e.id}`); assert.equal(r.word,e.w); assert.equal(r.ipa_uk,e.uk); assert.equal(r.ipa_us,e.us); assert.equal(r.cefr,e.cefr); assert.equal(r.topic,e.topic);
  assert.equal(r.meanings_zh,e.senses.map(s=>`${s.pos} ${s.zh}`).join(" | ")); assert.equal(r.definition_en,e.senses.map(s=>s.en).join(" | "));
  for(let i=0;i<2;i++){assert.equal(r[`example${i+1}_en`],e.ex[i].en);assert.equal(r[`example${i+1}_zh`],e.ex[i].zh);}
  assert.equal(r.collocations,e.col.join(" ; ")); assert.equal(r.word_family,e.fam.join(" ; ")); assert.equal(r.synonyms,e.syn.join(", ")); assert.equal(r.antonyms,e.ant.join(", ")); assert.equal(r.tip_zh,e.tip);
}
console.log(`Atlas OK: ${data.length} words, ${chunkCount} chunks, ${examples} examples; media references validated structurally.`);
