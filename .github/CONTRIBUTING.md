# 贡献指南 · Contributing

每一节先写中文，引用块里是对应的英文。
Each section is in Chinese first, with the English in the quote block below it.

**目录 · Contents：** [提交前](#提交前--before-you-submit) · [推荐插件](#推荐插件--suggest-a-plugin) · [更新或补充信息](#更新或补充信息--updates-and-corrections) · [提交后](#提交后--after-you-submit) · [申请下架](#申请下架--removal-requests) · [名称与文案](#名称与文案--names-and-copy)

## 提交前 · Before you submit

有好插件就先提交，不用等到完美。下面两件事提前做了，收录会更快：

- **搜一下有没有类似的插件。** 到[开放插件市场](https://dshopen.org/zh/)搜一搜功能相近的插件。已有类似的也欢迎提交，最好能做出一些不同点或优化点，并在申请里写一句。
- **自己先查一遍安全问题。** 我们会对提交的插件做一次简单审查，但这不等于完整的安全审计。提交前请先看看：插件把数据发到哪里、是否读取密钥或凭据、是否有安装脚本或混淆代码、是否修改 DSH 自身文件。如果确实需要做这些事，在说明里写清楚原因。

> If you have a good plugin, submit it. It does not have to be perfect first. Two things done up front make listing faster:
>
> - **Search for similar plugins.** Look through [Open Plugin Market](https://dshopen.org/) for plugins that do something close to yours. A similar plugin is still welcome, but try to offer something different or better, and say what it is in your request.
> - **Check it for security problems yourself.** We run a basic review on submitted plugins, which is not a full security audit. Before submitting, look at where the plugin sends data, whether it reads keys or credentials, whether it has install scripts or obfuscated code, and whether it changes DSH's own files. If it really needs to do any of these, explain why in the description.

## 推荐插件 · Suggest a plugin

插件推荐、信息更正、版本更新和下架申请都通过 GitHub Issue 提交，维护者负责更新收录配置与发布。

提交[插件收录申请](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml)，提供 npm 包名或源码仓库地址，以及一句功能介绍，中文或英文均可。插件在仓库子目录时，请一并注明目录。作者也可以通过同一表单申请更正信息。

目前收录的插件需要：

- 有公开 npm 版本和发布时间，或经维护者确认的固定 Git 来源。
- 声明 `dsh.bundle.patch`，引用的补丁文件已包含在发布包中。
- 有公开源码仓库和明确的许可证。
- 用途清楚。收录时由维护者补齐简短的中英文介绍。

请勿提交密钥、私有仓库、跟踪链接或无依据的安全承诺。收录审查不代表完整的代码审计或安装测试。

> Plugin suggestions, corrections, version updates and removal requests all go through GitHub Issues. Maintainers update the catalog configuration and publish it.
>
> Open a [plugin request](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml) with the npm package name or source repository and one sentence on what it does, in Chinese or English. If the plugin lives in a subdirectory of the repository, give the directory too. Authors can use the same form to correct their listing.
>
> A listed plugin currently needs:
>
> - A public npm release with a publish date, or a pinned Git source confirmed by a maintainer.
> - A `dsh.bundle.patch` declaration, with the patch file included in the published package.
> - A public source repository and a declared license.
> - A clear purpose. Maintainers add a short description in Chinese and English when listing it.
>
> Do not submit keys, private repositories, tracking links or unfounded security claims. The listing review is not a full code audit or an install test.

### DSH 版本兼容 · DSH compatibility

不要求插件只支持最新版 DSH，也不要求把 DSH 兼容范围锁定在单一版本。支持旧版或预发布版 DSH 的插件同样欢迎提交；兼容范围较窄、只验证过某个版本，或暂未声明范围，都不会单独成为拒绝收录的理由。

建议按实际依赖，通过 `engines.dsh` 或 DSH 相关的 `peerDependencies` 声明合理的版本范围。已知支持多个版本时不必锁死在单一版本；确实依赖特定版本或内部 API 时，也可以保留必要限制。申请中请区分「声明的兼容范围」和「实际验证过的版本、平台」。未声明范围不等于兼容所有版本；市场保留包的原始声明，安装时仍由 DSH 检查兼容性。

> Plugins do not have to target the latest DSH or declare compatibility with only one exact DSH version. Plugins for older or prerelease DSH versions are welcome. A narrow range, testing on only one version, or a missing range does not by itself prevent listing.
>
> We recommend declaring a reasonable range in `engines.dsh` or DSH-related `peerDependencies`, based on the plugin's actual dependencies. If multiple versions are known to work, there is no need to pin just one; keep necessary limits when a plugin depends on a specific version or internal API. Distinguish the declared range from the versions and platforms actually tested. A missing range does not mean every version is compatible. The market preserves the package's declarations, and DSH still checks compatibility when installing.

### Git 来源 · Git sources

尚未发布 npm 的插件可经维护者确认后按固定 GitHub 提交收录。请在收录申请中提供公开仓库地址、版本和完整提交 SHA；插件位于子目录时还需提供相对路径。选定目录须包含可安装的完整插件、`package.json`、补丁及构建产物。维护者核查归档并记录哈希；建议作者同时发布 npm 包。

GitHub Release 附件可以供用户下载或手动安装，但当前 DSH 市场索引尚不能直接以 Release 附件作为安装源。仅在 Release 中提供构建产物时，请同时提供可用的 npm 包或完整的固定 Git 提交。

> A plugin not yet on npm can be listed from a pinned GitHub commit once a maintainer confirms it. Give the public repository, the version and the full commit SHA in your request, plus the relative path if the plugin lives in a subdirectory. That directory must contain the complete installable plugin: `package.json`, the patch and the build output. Maintainers check the archive and record its hash. Publishing to npm as well is recommended.
>
> GitHub Release attachments work for manual downloads and installs, but the DSH market index cannot use them as an install source yet. If build output exists only on a Release, also provide a working npm package or a complete pinned Git commit.

## 更新或补充信息 · Updates and corrections

已有收录申请时，请在原 Issue 回复新版本、固定提交或补充材料，即使已经关闭也可以继续补充。更正已收录插件的名称、介绍、仓库等信息，也可以使用[插件收录申请](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml)，注明包名和需要更正的内容。

默认跟踪 npm 的 `latest` 标签；固定版本或 Git 提交的插件需要维护者重新核查后升级。运行兼容范围以实际发布包中的声明为准。

> If you already have a request, reply there with the new version, pinned commit or extra material, even if the Issue is closed. To correct the name, description or repository of a listed plugin, use the [plugin request](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml) form with the package name and what needs changing.
>
> Plugins follow the npm `latest` tag by default. Plugins pinned to a version or Git commit are upgraded after a maintainer checks them again. Runtime compatibility follows what the published package declares.

## 提交后 · After you submit

维护者会核对包的归属、用途、发布记录、许可证、补丁和入口文件，并做一次简单的安全审查，按需在 Issue 中请作者补充信息或修改，再补齐简短的中英文介绍。通过审查的版本带「已审查」标签，范围见[审查说明](../docs/reviews/review-policy.md)；发布新版本后需要重新审查。

本地只检查本次改动的条目。提交推送后，由 GitHub Actions 执行全量测试、构建、官方格式校验和浏览器测试，通过后发布。

> Maintainers check the package's ownership, purpose, release history, license, patch and entry files, and run a basic security review. They may ask you in the Issue for more information or for changes, then add the short Chinese and English descriptions. A version that passes carries the Reviewed label; its scope is explained in the [review policy](../docs/reviews/review-policy.md). A new release needs its own review.
>
> Local checks cover only the entries a change touches. After a push, GitHub Actions runs the full tests, build, official format validation and browser tests, and publishes when they pass.

## 申请下架 · Removal requests

作者或维护者可以提交[插件下架申请](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-remove.yml)，Issue 标题以 `[plugin-remove]` 开头。请用发布该包或拥有源码仓库的 GitHub 账号提交，否则需附上能证明身份的链接。

维护者确认身份后移除收录条目，并记录下架申请。下架的插件会被候选扫描跳过；只有作者本人再次申请时，才按正常流程重新核查收录。

> Authors or maintainers can open a [removal request](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-remove.yml), with an Issue title starting `[plugin-remove]`. Use the GitHub account that published the package or owns the repository, or link something that proves your identity.
>
> Once a maintainer confirms your identity, the entry is removed and the request recorded. Candidate scans skip removed plugins. It is listed again only if the author asks, and goes through the normal checks.

## 名称与文案 · Names and copy

品牌、项目和产品名保留作者的写法与大小写，例如 DeepSeek Bot、Flowglass、Pharos。作者提供正式中文名时可以使用，或与原名并列；没有正式译名时直接保留原文。不要用功能概括替换产品名。普通功能名称可以自然翻译。

描述用简洁中文讲清用途、必要的运行条件和重要限制。技术术语应放进具体语境，例如权限提升审批、沙箱外执行、衬线字体，避免逐词直译，也不扩大原说明中的能力或保证。名称有疑问时先核对作者 README、包内语言文件或清单。

> Brand, project and product names keep the author's spelling and capitalization, for example DeepSeek Bot, Flowglass and Pharos. A formal Chinese name from the author can be used alone or next to the original; without one, keep the original. Do not replace a product name with a summary of what it does. Ordinary feature names can be translated naturally.
>
> Descriptions state the purpose, necessary runtime conditions and important limits in plain language. Put technical terms in context, such as privilege escalation approval, running outside the sandbox or serif fonts, instead of translating word for word, and do not widen the abilities or guarantees in the original. When a name is in doubt, check the author's README, the package's locale files or its manifest.
