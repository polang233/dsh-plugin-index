# 贡献指南

## 推荐插件

提交[插件收录申请](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml)，提供 npm 包名或源码仓库地址，以及一句功能介绍，中文或英文均可。作者也可以通过同一表单申请更正信息。

目前收录的插件需要：

- 有公开 npm 版本和发布时间。
- 声明 `dsh.bundle.patch`，引用的补丁文件已包含在发布包中。
- 有公开源码仓库和明确的许可证。
- 用途清楚。收录时由维护者补齐简短的中英文介绍。

请勿提交密钥、私有仓库、跟踪链接或无依据的安全承诺。发布包检查不代表代码审计或安装测试。

### Git 来源

尚未发布 npm 的插件可经维护者确认后按固定 GitHub 提交收录。条目需要固定 `version`，并提供 `source: {type: "git", url, commit, integrity, publishedAt}`。`commit` 为完整提交 SHA，`integrity` 为对应 GitHub 源码归档的 SHA-512，`publishedAt` 为发行时间。根目录必须包含可安装的完整插件与 `package.json`。更新提交后需重新核查归档哈希；建议作者同时发布 npm 包。

## 申请下架

作者或维护者可以提交[插件下架申请](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-remove.yml)，issue 标题以 `[plugin-remove]` 开头。请用发布该包或拥有源码仓库的 GitHub 账号提交，否则需附上能证明身份的链接。也可以直接提交 PR，同时修改下面两个文件。

维护者确认身份后：

1. 从 `data/sources.json` 删除该条目，推送后由 GitHub Actions 重新生成索引与页面。
2. 在 `data/withdrawn.json` 记录包名、仓库、申请人、日期和申请链接。

构建、收录预览和候选扫描都会读取下架名单：名单中的包出现在收录列表里会让构建失败，候选扫描会直接跳过它们。作者本人再次申请收录时，先从下架名单删除该记录，再按正常流程收录。

## 提交 PR

在 `data/sources.json` 中添加条目，使用已有分类：

```json
{
  "name": "@owner/plugin",
  "title": { "en": "Plugin name", "zh": "插件名称" },
  "description": { "en": "What the plugin does.", "zh": "插件的具体用途。" },
  "category": "tools"
}
```

默认跟踪 npm 的 `latest` 标签；填写 `version` 可以固定版本，之后需手动修改。运行兼容范围来自实际发布包，不使用提交说明中的声明。

源码字段缺失或归档超出默认预算时，需要先按[维护规则](../docs/maintenance.zh-CN.md#经核查的源码补充)核查准确版本。此类条目保持固定版本，升级需重新核查。

本地只核对本次改动的条目、必要字段和归档哈希。批量收录可按[维护说明](../docs/maintenance.zh-CN.md#更新收录)运行 `preview-submissions.mjs`，仅检查这批归档。提交来源配置、文案和必要的复核记录即可，不要求本地全量下载插件或更新 `public/` 生成文件。

推送后由 GitHub Actions 执行全量单元测试、构建、官方格式校验和浏览器测试。CI 失败时查看日志，针对失败条目或相关代码修正后再次推送。脚本或页面改动只需在本地做相关的定向检查或局部预览。

收录调整与无关的网站修改请分开提交。维护者合并前会核对包的归属、用途、发布记录和介绍。

## 名称与中英文文案

品牌、项目和产品名保留作者的写法与大小写，例如 DeepSeek Bot、Flowglass、Pharos。作者提供正式中文名时可以使用，或与原名并列；没有正式译名时直接保留原文。不要用功能概括替换产品名。普通功能名称可以自然翻译。

描述用简洁中文讲清用途、必要的运行条件和重要限制。技术术语应放进具体语境，例如权限提升审批、沙箱外执行、衬线字体，避免逐词直译，也不扩大原说明中的能力或保证。名称有疑问时先核对作者 README、包内语言文件或清单。

已核对的产品名记录在 `data/brand-names.json`。完整构建、指标刷新和文案刷新会检查这些名称是否仍保留。只修改文案时可运行 `pnpm build:copy`，更新已校验的本地索引和双语页面，保留版本、指标、推荐顺序及曝光记录。新收录和升级版本由 GitHub Actions 完整构建。
