# 维护与部署

[English](maintenance.md)

## 使用统计

**索引使用量**是 DSH 读取索引的总次数，每次在「发现」里打开或刷新这个市场都会读取一次（DSH 会缓存约 10 分钟）；**今日使用**是今天的次数。读取者按「IP + 浏览器标识」的加盐哈希按天去重，不保存 IP，明细见 [stats.json](https://dshopen.org/stats.json)。只统计 dshopen.org，旧的 github.io 地址无法统计。

## 目录结构

```text
data/       收录列表 sources.json 与发布者身份 publishers.json
scripts/    索引、指标、推荐和网站的生成脚本
packages/   dsh-open-market 插件
site/       网站样式与品牌素材
public/     构建产物，发布到 dshopen.org 和 GitHub Pages
cloudflare/ dshopen.org 的 Worker：静态页与读取统计
docs/       维护说明、指标说明、核查记录
test/       单元测试与浏览器测试
```

## 构建与测试

需要 Node.js 24+ 和 pnpm 11。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm validate
pnpm exec playwright install chromium
pnpm test:browser
```

本机已有 Chrome 或 Chromium 时，可设置 `BROWSER_EXECUTABLE` 为浏览器路径，省去下载。浏览器测试会自动启动和关闭本地预览服务。

- `data/sources.json`：收录列表、中英文介绍和分类。
- `scripts/lib.mjs`：发布源和归档检查、兼容范围、索引生成。
- `scripts/site.mjs` 与 `site/`：中英文页面。
- `public/index.json`：DSH 格式 1 索引。
- `public/status.json`：生成时间和逐包检查记录。

仅修改页面时运行 `pnpm build:site`，再用 `pnpm preview` 访问 `http://127.0.0.1:4173/dsh-plugin-index/`。

仅刷新指标、市场名称和作者身份时运行 `pnpm build:metadata`。它保留已检查的包版本与原始包检查时间；收录列表或固定版本改变时会要求完整构建。`publishers.json` 记录身份依据，`public/downloads.json` 与 `public/display.json` 记录下载数据和 DSH 展示内容。指标含义与客户端限制见[市场指标与身份标签](market-display.md)。

## 更新收录

回复收录申请时保持一句话、自然简短。中文示例：`感谢！将在下个提交后收录 😊`，可换用不同的微笑表情。非中文开发者用英文：`Thanks! It'll be added in the next commit 😊`。接纳后按维护者授权回复并关闭 issue。

批量收录可先将 issue、包名和回复草稿记录为 `schema: 1`、`entries: [{issue, name, replyLanguage, reply}]` 的 JSON。运行 `node scripts/preview-submissions.mjs <复核记录.json>`，仅检查这批发布归档并生成 `.local/submission-preview/` 下的索引、证据和回复预览，不安装插件、不改写已发布快照、不发评论。

未指定 `version` 时跟踪 npm `latest`，索引每 6 小时构建一次；指定后固定为该版本。仓库核查和大包预算会固定版本，运行 `pnpm check:pins` 可列出已落后于 npm `latest` 的固定条目，需重新核查后升级。生成器最多并发读取四个来源，并重试临时网络错误。npm 包下载限于公共 npm registry，固定 Git 来源仅使用下文的 GitHub 提交归档；审核仓库图片使用独立的图标读取边界，不执行被收录插件的代码。全部来源与官方校验器通过后才允许发布。

目前每个插件提供一个版本。兼容范围来自 `engines.dsh`，缺失时取 DSH peer dependencies 的交集。没有约束表示作者未声明范围，不代表已验证兼容。

构建失败时查看 Actions 日志，修正来源或连接问题后重新运行。撤回或停止维护的插件通过修改收录列表移除，不会在生成过程中被悄悄跳过。

## 固定 Git 来源

经维护者确认的 Git 条目通过 `source` 声明固定 GitHub 仓库、完整提交 SHA、源码归档 SHA-512 和发行时间，并固定 `version`。生成器从 `codeload.github.com` 下载该提交的归档，禁止重定向，沿用下载与解压预算，检查包名、版本、补丁和入口文件。安装源写为官方 `git` 类型，DSH 按固定提交安装根目录插件。Git 条目不请求 npm 下载量，也不生成 npm 发版活跃数据。升级需要更新提交与哈希。不执行插件安装或生命周期脚本。

## 作者下架

作者通过 `[plugin-remove]` issue 或 PR 申请下架。确认申请人是 npm 维护者或源码仓库所有者后，从 `data/sources.json` 删除条目，重新生成 `public/`，并在 `data/withdrawn.json` 记录 `{name, repository, requestedBy, requestedAt, request}`，`request` 为申请链接。

`pnpm build` 与 `preview-submissions.mjs` 遇到下架名单中的包会直接失败，`review-candidates.mjs` 会把它们记为 `stage: "withdrawn"` 并跳过下载与检查，单元测试也会核对收录列表中没有已下架的包。只有作者本人再次申请收录时，才从下架名单删除记录。

## 经核查的源码补充

发布包缺少 `repository` 时，维护者只有在确认该 npm 归档与上游发行对应后，才能添加 `repositoryReview`。条目必须固定 `version`，核查记录绑定相同版本、npm SHA-512、规范 GitHub 地址和不可变源码提交。版本或哈希变化、发布包声明的仓库冲突都会让构建失败。`status.json` 用 `repositorySource: "review"` 与 `"package"` 区分来源，并链接核查的源码清单。这类插件升级需要重新核查，不自动跟随 `latest`。

首个条目的[Taskboard 来源记录](reviews/taskboard-review.md)包含 npm 与 GitHub 发行资产的相同哈希。

## 经核查的大包预算

普通下载时限为每次 30 秒，完整 tar 解压流上限为 100 MiB。大型包只有固定版本并匹配 npm 完整性哈希，才能声明 `archiveReview`，最多使用每次 120 秒和 256 MiB。下载总共最多尝试三次。压缩下载仍限 64 MiB；包清单和单条 tar 扩展元数据均限 1 MiB；包括 PAX/GNU 扩展头在内最多 20,000 条目。解压字节预算包含头部、元数据、对齐及尾部内容。解析器只保留清单、文件名与受限显示文件，不落盘解包。`status.json` 各包的 `archive` 字段同时记录声明载荷 `unpackedBytes` 和完整解压流 `decodedBytes`。

[Univer Office 归档核查](reviews/univer-archive-review.md)记录实测大小和预算；版本或哈希变化需要重新核查。

## 插件图标与本地化

构建读取已通过 SHA-512 校验的发布包，从清单的 `icon` 或导出的 `./icon` 查找 SVG、PNG、JPEG 或 WebP，最多 256 KiB。图片保存在 `public/icons/`，以内容哈希命名；官方 `icon` 字段使用相对路径，DSH 按索引地址解析。网页使用同一图片。没有图标时显示名称首字，缺失、过大或不支持的图标记入 `status.json` 的 `display.warnings`。

维护者可通过 `iconReview: {commit, path, sha256, normalization?}` 明确选用发布清单所声明 GitHub 仓库中的作品。不写 `version` 和 `integrity` 时条目继续跟随 npm `latest`：每次构建都核对当前版本仍声明同一 GitHub 仓库，作品本身由提交和哈希固定。确需绑定某个发布包时，可同时写入 `version`、`integrity` 并固定条目 `version`。`commit` 为完整的 40 位小写提交 SHA，`path` 为仓库根目录下的相对作品路径，`sha256` 对应原始文件字节。构建只根据该仓库和提交生成不可变的 `raw.githubusercontent.com` 地址，禁止自定义 URL、重定向、路径穿越、主动 SVG 内容及外部资源，并沿用包内图片的 256 KiB 限制和格式检查。审核记录不匹配会中止构建。显式审核图标优先于可用的包内图标；`display.publishedIcon` 保留包内图标证据，`display.icon` 记录 `source: "reviewed-repository"`、固定源码地址、原始哈希和审核内容。该例外不改变 npm 下载地址限制。

只有显式设置 `normalization: "remove-xml-comments"` 才会移除审核 SVG 的 XML 注释，否则保留原始字节。构建先检查原始哈希，再按处理后的字节生成图片路径与最终 `sha256`。版本或完整性哈希变化需要重新审核；构建不从本地审核页或调研目录读取图片。

作者提供的 `locale/en.json` 和同目录中文文件用于名称与介绍；`data/sources.json` 中的编辑文案优先。归档读取只额外保留这些受限文件，不解包、不执行插件。除显式审核的 XML 注释处理外，源图片保持原样；SVG 必须是无外部资源和主动内容的图片。

本地预览端口被占用时，可为预览和浏览器测试同时设置 `DSH_INDEX_PREVIEW_PORT`。

## GitHub star

每次构建对同一仓库只请求一次 GitHub 公开 API，并生成 `public/github.json`，记录准确的 star 数、获取时间和最近推送时间。计数同时写入官方索引的 `github-stars` 排序字段，DSH 内也可以据此排序。

GitHub Actions 使用只读 `GITHUB_TOKEN`。本地可设置 `GITHUB_TOKEN` 或 `GH_TOKEN`，未设置时使用 GitHub 的匿名限额。凭据只用于 `api.github.com` 请求，不写入快照，浏览器也不直接请求 GitHub API。

请求失败时，最多保留七天内成功获取的计数，保留原始时间并标为 `stale`；超过七天或从未获取的计数标为 `unavailable`，不显示为 0。非 GitHub 仓库不提供 GitHub star。Actions 会跨构建保存 `.cache/github.json`，仓库中的公开快照作为备用。Star 反映仓库关注度，不代表测试覆盖率或插件质量。

## GitHub Pages

1. 在 **Settings → Pages** 中选择 **GitHub Actions**。
2. 设置仓库变量 `PUBLISH_INDEX=true`。
3. 在 `main` 分支运行 **Check and publish index**。

工作流先运行单元测试、构建目录、使用 Chromium 检查中英文网站并校验官方格式，再上传 Pages 产物。部署后核对完整收录集合、逐包检查记录、两种语言页面、所有引用图标的内容哈希与项目品牌图片，全部请求禁止重定向。PR 不触发部署。

定时任务每六小时触发，GitHub 可能延迟任务或暂停不活跃仓库的计划；实际更新时间以线上 `status.json` 为准。定时任务直接部署产物，不自动提交代码；仓库内快照由维护者随改动提交。

仅修改 `README*.md`、`docs/` 或 `.github/` 顶层 Markdown 文档时，推送和 PR 不触发完整构建与部署。定时任务和手动运行照常执行；同次提交包含收录、脚本、网站素材或工作流修改时，仍执行完整流程。

公开索引必须直接返回 200 JSON，不能依赖重定向：

```sh
node scripts/validate.mjs https://polang233.github.io/dsh-plugin-index/index.json
pnpm check:published
```

DSH 默认缓存十分钟。未来绑定自有域名时，要同时更新网站地址、canonical 元数据、sitemap、复制按钮目标和文档，再校验最终 JSON 地址。

## 检查范围

每个版本检查 SHA-512、包名与版本、组合包补丁及声明的 `main` 文件；记录源码地址、声明的许可证和安装生命周期脚本名称。不检查所有补丁引用、不解析完整依赖、不执行安装，也不做代码审计。

官方校验器固定为 `@deepseek-ai/dsh-plugin-market-index@0.2.1-rc.2`。升级时应重新运行测试，并在目标 DSH 版本中验证接入。协议细节见[官方格式说明](https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market)和[参考生成器](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/plugin-market-generator)。

## dshopen.org（Cloudflare）

`cloudflare/` 下的 Worker 直接提供 `public/` 里的静态文件，并统计 `index.json` 的读取次数（D1 数据库 `dshopen-stats`），统计结果从 `https://dshopen.org/stats.json` 查看。GitHub Pages 继续保留，旧地址的用户不受影响。

CI 在仓库设置了 `CLOUDFLARE_API_TOKEN` 时，会在每次构建后用 `wrangler versions upload` 和 `versions deploy` 自动发布新版本，不改动域名绑定，所以 Token 只需要 Workers 脚本和 D1 的权限。域名绑定只在手动 `wrangler deploy` 时更新。手动部署：

```sh
pnpm build
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

部署后的检查请求带 `dshopen-check` 这个 user-agent，不计入统计。

## 图片

原图放在 `site/originals/` 和 `docs/images/originals/`，网站和 README 实际加载的是同名的无损 WebP（按显示尺寸缩放）。替换或新增原图后运行 `node scripts/optimize-images.mjs` 重新生成（需要 `sharp`，可用 `npm i --no-save sharp` 临时安装）。

## 最近新增

`public/added.json` 记录每个插件首次进入索引的日期（UTC），网站的「最近新增」排序按它倒序排列。完整构建优先读取 GitHub Pages 上已发布的记录，失败时读取本地快照，已有日期保持不变，新出现的包记为构建当天。移除后再收录的包按重新收录日期计算。2026-10-19 之前的记录来自 `data/sources.json` 的 Git 历史，因此首批插件日期相同。

## 每日推荐轮换

`public/recommendations.json` 随索引一同发布，保存每周候选池和近 14 天前十曝光记录。完整构建和指标刷新优先读取 GitHub Pages 已发布快照，失败时读取本地公开快照；不将尚未部署的记录写入 CI 缓存。规则见 [指标说明](market-display.md)。只重排本地已校验版本可运行 `pnpm build:recommendations`，新收录或版本变化仍需完整构建。运行 `pnpm preview:recommendations` 可生成 `.local/recommendation-preview.json` 查看连续 14 天的两组首屏名单。

## 文案与品牌名称

收录文案以 `data/sources.json` 为准。品牌身份记录在 `data/brand-names.json`，构建时检查中英文名称保留原名；作者提供的中文别名可并列展示。审核记录见 [2026-10-20 文案复核](reviews/localization-2026-10-20.md)。

仅改名称和描述时运行 `pnpm build:copy`。它更新 `public/index.json`、`public/display.json` 和双语网页，保留包版本、校验时间、指标、排序和推荐曝光记录，不访问网络。尚未写入公开快照的新收录会列在输出中，等待完整构建。

结构化复核记录可用 `node scripts/apply-copy-review.mjs docs/reviews/localization-2026-10-20.json` 重放。重复执行不重复修改；源文案已被其他改动修改时会停止，要求重新复核。
