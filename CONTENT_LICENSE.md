# 内容授权 / Content license

## 代码 / Code

源代码与界面设计采用 [MIT License](LICENSE)。依赖包保留各自授权；Fraunces 字体为 SIL Open Font License 1.1。

Source code and UI design are under the [MIT License](LICENSE). Dependencies keep their own licenses; the Fraunces typeface is under the SIL Open Font License 1.1.

## 词库内容、插画与录音 / Dataset, illustrations and recordings

以下内容以 **[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)** 提供，在项目维护者能够授予的权利范围内：

- `data/` 下的词库文件，以及 `public/atlas/index.json`、`public/atlas/entries/` 中的释义、英文释义、例句、译文、搭配、词族、近反义词、提示、分级与分类；
- `public/atlas/img/`、`public/atlas/thumb/`、`public/brand/` 中的插画；
- `public/atlas/audio/` 中的发音与例句录音。

The material above is offered under CC BY 4.0, to the extent of the rights the maintainers can grant.

**署名 / Attribution:** `Word Atlas contributors — CC BY 4.0`，并附授权链接，说明是否做过修改。

## ECDICT 考试标签与文本 MVP / ECDICT exam tags and text MVP

`public/atlas/exam-tags.json` 不属于上述 CC BY 4.0 内容。该文件把 ECDICT 的考试分类标签映射到本项目的词条 ID，并保留来源 commit 与输入文件 SHA-256。`arid`、`artifact`、`deteriorate`、`notion`、`urbanization` 五个文本 MVP 词条的词头、源音标、释义、翻译、词形与考试标签取自或改写自同一 ECDICT 快照。这些 ECDICT 来源内容依据 ECDICT 的 MIT License 使用；本项目独立编写的例句、搭配、提示和分类仍适用上述 CC BY 4.0 条款。完整来源、许可声明与复现方法见 [`docs/ecdict-exam-tags.md`](docs/ecdict-exam-tags.md)。

`public/atlas/exam-tags.json` is excluded from the CC BY 4.0 dataset grant above. It maps ECDICT exam-category tags to this project's word IDs and records the source commit and input SHA-256. The headwords, source phonetics, definitions, translations, inflections, and exam tags for the five text-MVP entries `arid`, `artifact`, `deteriorate`, `notion`, and `urbanization` are taken from or adapted from the same ECDICT snapshot. Those ECDICT-derived parts are used under ECDICT's MIT License; independently authored examples, collocations, tips, and classifications remain under the CC BY 4.0 terms above. See [`docs/ecdict-exam-tags.md`](docs/ecdict-exam-tags.md) for provenance, notice, and reproduction steps.

## 独立短篇阅读集 / Independent reading corpus

`public/atlas/extras/readings/` 中以 `local-` 开头的短文、中文译文与理解题是为本仓库独立生成的新内容，未复制托管网站的 `extras/readings` 短文。它们以 **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)** 发布，详细来源、AI 使用声明和署名方式见该目录的 `LICENSE.md`。

The passages, Chinese translations and comprehension questions prefixed with `local-` under `public/atlas/extras/readings/` are newly generated for this repository and do not copy the hosted site's `extras/readings` corpus. They are released under **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. See that directory's `LICENSE.md` for provenance, AI disclosure and attribution.

### 说明 / Notes

- 单个英文单词与通用词表本身不主张专有权。This project claims no exclusive rights over English words or the bare headword list.
- 内容由 AI 模型按项目规范生成（文本：大语言模型；插画：图像模型；录音：ElevenLabs 合成语音），经过自动校验，未逐条人工审校，按现状提供，不作准确性担保。Content was generated with AI models under the project's specifications, checked automatically, not proofread entry by entry, and is provided as-is without warranty.
- 录音授权只涉及这些完成的音频文件，不包含底层声音模型、声音身份或任何人的肖像、人格权，也不表示声音提供方为本项目背书。英音声音为 ElevenLabs “Alice”，美音为 “Sarah”。The recording license covers the finished audio files only, not the underlying voice models or voice identities, and implies no endorsement. Voices: ElevenLabs "Alice" (UK) and "Sarah" (US).
- 所有考试路径与分类均为非官方复习参考，与相关考试主办方无关。All exam paths and classifications are unofficial study references and are not affiliated with the relevant examination authorities.
