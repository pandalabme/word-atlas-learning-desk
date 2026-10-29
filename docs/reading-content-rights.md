# 阅读内容发布权审计

审计日期：2026-10-29

## 结论

- **不得随本仓库发布：** `https://0xlei.tech/words/atlas/extras/readings/*.json`。公开许可证没有明确覆盖这些托管站点短文。
- **可以按所列条件发布：** 本仓库 `public/atlas/extras/readings/` 中以 `local-` 开头的独立短文及其翻译和理解题。

这是一份工程侧来源与许可记录，不替代针对特定司法辖区的律师意见。

## 一手证据

1. 上游 [`LICENSE`](https://github.com/designfuchen/word-atlas/blob/main/LICENSE) 将 MIT 范围限定为代码、原创界面美术和技术文档，并将学习内容交由单独内容许可管理。
2. 上游 [`CONTENT_LICENSE.md`](https://github.com/designfuchen/word-atlas/blob/main/CONTENT_LICENSE.md) 逐项列明 CC BY 4.0 覆盖 `data/`、`public/atlas/index.json`、`public/atlas/entries/`、指定插画与录音目录；没有列出托管网站的 `extras/readings`。
3. 上游 [`README`](https://github.com/designfuchen/word-atlas/blob/main/README.md) 明确说明托管网站独立演进，可能包含与开源仓库不同的功能。
4. [OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/) 说明，在用户与 OpenAI 之间且在适用法律允许范围内，用户拥有输出，OpenAI 将其可能拥有的输出权利转让给用户；同时指出输出可能不唯一且发布前应评估准确性与适当性。

## 本仓库的处理

- 没有把托管站点的 732 篇 JSON 复制到受版本控制的目录或构建产物。
- `local-*` 短文由本次任务从话题和已获许可的词条 ID 独立生成，没有使用托管短文作为输入或改写源。
- 每个 JSON 声明 `origin: original`、`license: CC-BY-4.0` 和 `aiGenerated: true`。
- 目录的 [`LICENSE.md`](../public/atlas/extras/readings/LICENSE.md) 记录许可、AI 使用声明和两层署名：独立短文作者贡献者，以及上游 Word Atlas 词条数据贡献者。
- `scripts/check-readings.mjs` 在本地存在私有检查缓存时还会拒绝与其中任何托管文章完全相同的英中正文。

## 发布条件

发布时必须保留：

- 根目录 `LICENSE` 和 `CONTENT_LICENSE.md`；
- `public/atlas/extras/readings/LICENSE.md`；
- JSON 中的来源、许可和 AI 标记；
- 对 Word Atlas 数据集的 CC BY 4.0 署名与授权链接。
