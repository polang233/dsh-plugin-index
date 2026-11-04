# 贡献指南 · Contributing

每一节先写中文，引用块里是英文。
Each section is in Chinese first, with the English in the quote block below it.

**目录 · Contents：** [提交插件](#提交插件--submit-a-plugin) · [常见退回原因](#常见退回原因--common-reasons-for-changes) · [Git 来源](#git-来源--git-sources) · [提交后](#提交后--after-you-submit) · [更新与更正](#更新与更正--updates-and-corrections) · [申请下架](#申请下架--removal-requests)

## 提交插件 · Submit a plugin

不用等到完美再提交。开一个[插件收录申请](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml)，写上 npm 包名或源码仓库，再用一句话说明插件做什么，中英文都行。插件在仓库子目录里的话，把目录也写上。

收录需要：

- 公开的 npm 版本，或者一个固定的 GitHub 提交（见下文 [Git 来源](#git-来源--git-sources)）。
- `package.json` 里声明了 `dsh.bundle.patch`，补丁文件在发布包里。
- 公开的源码仓库和明确的许可证（`license` 字段，以及仓库里的 LICENSE 文件）。
- 清楚的用途。中英文简介由维护者来写。

可以顺便附上 Logo、1–6 张实际使用截图（每张配一句说明，记得遮住密钥和个人信息），以及你测试过的 DSH 版本和系统。兼容范围请写在 `engines.dsh` 或 DSH 相关的 `peerDependencies` 里。

提交前到[开放插件市场](https://dshopen.org/zh/)搜一下。已经有类似插件也欢迎提交，在申请里说一句你的不同之处就好。

> No need to wait until it is perfect. Open a [plugin request](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml) with the npm package name or source repository and one sentence on what the plugin does, in Chinese or English. If it lives in a subdirectory, include the directory.
>
> A listed plugin needs:
>
> - A public npm release, or a pinned GitHub commit (see [Git sources](#git-来源--git-sources) below).
> - A `dsh.bundle.patch` declaration in `package.json`, with the patch file in the published package.
> - A public source repository and a clear license (the `license` field and a LICENSE file in the repository).
> - A clear purpose. Maintainers write the Chinese and English descriptions.
>
> You can also attach a logo, 1–6 screenshots of the plugin in use (one caption each; hide keys and personal details) and the DSH versions and systems you tested. Put compatibility in `engines.dsh` or DSH-related `peerDependencies`.
>
> Search [Open Plugin Market](https://dshopen.org/) first. A similar plugin is still welcome; just say in the request what yours does differently.

## 常见退回原因 · Common reasons for changes

每个提交都会过一遍简单的安全审查。下面这些问题最常见，提交前自己看一下，能省掉一来一回：

- **本机接口没有接入宿主认证。** 插件通过 `webServer` 注册的接口，请用 `connection.requestRejection(req)` 做准入；拿不到 `connection` 或它抛错时直接拒绝，不要退回到只检查 Host、Origin 或回环地址。会读写密钥、会话、文件或触发模型调用的接口尤其要注意。
- **跨域放得太宽。** 不要给敏感接口返回 `Access-Control-Allow-Origin: *`。
- **路径没有限制。** 写文件前确认目标路径还在插件自己的数据目录或工作区里，挡住 `..` 这类目录穿越。
- **凭据可能发到别处。** 带着令牌请求外部地址时，把地址限制在对应服务的域名内，重定向后也要检查。
- **绕过审批或权限。** 执行命令、写文件、提升权限都应遵守 DSH 的审批和会话权限，不要从消息正文里推断权限。
- **缺许可证或 `repository` 字段**，或者发布包里缺构建产物。

确实需要做上面某件事的话，在申请里写清楚原因。审查不等于完整的代码审计，也不是安装测试。

> Every submission gets a basic security review. These come up most often; checking them first saves a round trip:
>
> - **Local routes without host authentication.** Routes registered through `webServer` should admit requests with `connection.requestRejection(req)`. If `connection` is missing or throws, reject the request; do not fall back to checking only Host, Origin or the loopback address. This matters most for routes that touch keys, sessions or files, or that trigger model calls.
> - **CORS that is too open.** Do not send `Access-Control-Allow-Origin: *` from sensitive routes.
> - **Unchecked paths.** Before writing a file, make sure the target stays inside the plugin's data directory or the workspace, and block traversal such as `..`.
> - **Credentials that can leak.** When a request carries a token, limit it to that service's domain, including after redirects.
> - **Skipping approval or permissions.** Running commands, writing files and raising permissions should follow DSH approval and session permissions. Do not infer permissions from message text.
> - **A missing license or `repository` field**, or build output missing from the published package.
>
> If your plugin really needs one of these, explain why in the request. The review is not a full code audit or an install test.

## Git 来源 · Git sources

还没发布 npm 的插件，可以按固定的 GitHub 提交收录。请提供公开仓库、版本号和完整的 40 位提交 SHA；插件在子目录里的话，再给出相对路径。那个目录要能直接安装：包含 `package.json`、补丁和构建产物。维护者会核对归档并记录哈希。能发 npm 的话还是建议发一份。

GitHub Release 的附件目前不能作为市场的安装来源。如果构建产物只放在 Release 里，请另外提供 npm 包或完整的固定提交。

> A plugin not yet on npm can be listed from a pinned GitHub commit. Give the public repository, the version and the full 40-character commit SHA, plus the relative path if the plugin is in a subdirectory. That directory must install as is, with `package.json`, the patch and the build output. Maintainers check the archive and record its hash. Publishing to npm as well is still recommended.
>
> GitHub Release attachments cannot be used as an install source yet. If your build output only exists on a Release, also provide an npm package or a complete pinned commit.

## 提交后 · After you submit

维护者会核对包的归属、用途、许可证、补丁和入口文件，做一次安全审查，有问题会在 Issue 里告诉你。通过的版本会加上「已审查」标签（范围见[审查说明](../docs/reviews/review-policy.md)），新版本需要重新审查。风险不高的问题，有时会先收录，并在简介里写明需要注意的地方。

修好之后请在原 Issue 回复一句，附上新版本或新的提交 SHA，我们看到就会复核。**超过 7 天没有回复的 Issue 会先关闭**，之后随时回复或重新提交都可以。

> Maintainers check ownership, purpose, license, patch and entry files, run a security review and tell you in the Issue if something needs changing. A version that passes gets the Reviewed label (scope in the [review policy](../docs/reviews/review-policy.md)); new releases need a new review. A low-risk issue may be listed anyway, with a note in the description.
>
> Once you have fixed something, reply in the same Issue with the new version or commit SHA and we will review it again. **Issues with no reply for 7 days are closed for now**; you can reply or submit again at any time.

## 更新与更正 · Updates and corrections

收录后默认跟踪 npm 的 `latest`。固定了版本或 Git 提交的插件，要等维护者重新核查后才会升级；想升级的话，在原 Issue 里回复新版本或提交即可，关闭了的 Issue 也可以。要改名称、简介或仓库地址，用[插件收录申请](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml)写明包名和要改的内容。

> Listed plugins follow the npm `latest` tag. Plugins pinned to a version or commit are upgraded after a maintainer checks the new one; reply in your original Issue with the new version or commit, even if it is closed. To change the name, description or repository, use the [plugin request](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml) form with the package name and what to change.

## 申请下架 · Removal requests

作者可以提交[插件下架申请](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-remove.yml)，标题以 `[plugin-remove]` 开头。请用发布这个包或拥有源码仓库的 GitHub 账号提交，否则附一个能证明身份的链接。确认后条目会被移除并记入下架名单，候选扫描也会跳过它；以后作者本人申请时可以重新收录。

> Authors can open a [removal request](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-remove.yml) with a title starting `[plugin-remove]`. Use the GitHub account that published the package or owns the repository, or link something that proves who you are. Once confirmed, the entry is removed and added to the withdrawn list, and candidate scans skip it. It can be listed again if the author asks.
