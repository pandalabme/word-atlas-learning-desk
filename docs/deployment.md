# 部署 / Deployment

## GitHub Pages

仓库根目录的 `.github/workflows/word-atlas-pages.yml` 会在 `main` 分支中学习台文件变化时：

1. 安装锁定依赖；
2. 运行单元测试；
3. 运行 `npm run check:readings` 校验短文的授权元数据、词条引用和文件完整性；
4. 以 `ATLAS_BASE=/electronic_diy/` 构建；
5. 仅上传 `word-atlas-learning-desk/dist` 并部署到 GitHub Pages。

首次使用时，在 GitHub 仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。默认项目站点地址为：

`https://pandalabme.github.io/electronic_diy/`

如果仓库改名或配置自定义域名，需要同步调整工作流中的 `ATLAS_BASE`。

## 阅读内容

生产版本只发布 `public/atlas/extras/readings/` 中以 `local-` 开头、通过校验的独立短文。被 `.gitignore` 排除的 `.local/` 不会进入构建或 Pages artifact。

授权审计见 [`reading-content-rights.md`](reading-content-rights.md)。
