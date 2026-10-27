# 插件安全审查 2026-10-27 / Plugin security review

这次从收录插件里按 npm 下载量和 GitHub star 挑出最常用、还没审查过的一批，做了简单的静态安全审查。审查由 AI 代理逐个完成、维护者汇总判定，通过的版本记入[审查清单](../../data/maintainer-reviews.json)，范围为 `static-security`，市场里显示「已审查」。

**做法**：下载记录版本的 npm 包并核对 SHA-512，不安装、不运行；检查安装脚本、子进程、`eval` 和远程代码、对外请求、密钥读取、文件写入、自动更新、遥测、XSS，以及是否默认放开审批或远程访问；再抽查 GitHub 仓库里的对应源码。没有中、高风险问题即通过。

审查只针对表中的版本，不保证插件、依赖或后续版本绝对安全；下表的「小问题」都是低风险，大多是功能本身需要、文档里也写明了的行为。

## 通过

| 插件 | 版本 | 小问题 |
| --- | --- | --- |
| dshmarket | 1.66.47 | 评论区加载 giscus.app 脚本、截图走 images.weserv.nl 代理；可安装任意目录插件并重启 DSH，属于插件管理器本身的能力 |
| @openviking/dsh-memory-plugin | 0.5.28 | 读取 `~/.openviking` 里的配置和 API key，对话内容会发给用户配置的 OpenViking 服务（功能本身） |
| dsh-pet | 0.3.8 | 首次使用从 npmmirror 下载 Electron，校验文件来自同一镜像；Electron 窗口未开 sandbox |
| @tt-a1i/archify-dsh | 1.0.0 | 只发通知用的更新检查；技能脚本会调用 git、本机浏览器和系统打开命令 |
| dsh-whale-widget | 0.4.2 | 处理多家服务商的 API key，有目标地址白名单；「自定义地址」需要用户主动开启；一个出错后备路径用 innerHTML 显示用户自己写的文字 |
| @wxg-prc-cpg/browser-skill-dsh-plugin | 0.3.3 | 驱动已登录的浏览器、可拦截和重放请求，信任度高，浏览不可信页面时注意提示注入 |
| dsh-better-sidebar | 0.28.0 | 通过本地路由暴露工作区文件，有路径限制，HTML 预览带 CSP sandbox |
| @liustack/modlens | 3.27.1 | 可选的 Antigravity 后端以跳过权限模式运行；复用其他工具的登录需要用户主动开启 |
| dsh-context | 0.74.0 | 附件复制到工作区的路由；常量 SVG 用 `dangerouslySetInnerHTML` |
| @smalltailqwq/dsh-client-ui-skin-maid-atelier | 0.1.9 | 纯皮肤，无网络；innerHTML 只写入打包好的常量 |
| @smalltailqwq/dsh-client-ui-skin-deep-whale-manager | 0.1.8 | 改写 profile 里的皮肤配置块；Windows 上可选同步桌面图标；接口不带 Origin 的本地请求也会被接受 |
| @smalltailqwq/dsh-client-ui-skin-orca-link | 0.1.9 | 纯皮肤，无网络；innerHTML 只写入打包好的常量 || @nanmicoder/dsh-agent-teams | 0.1.26 | 可选的修复脚本会动态加载 DSH 模块，只在用户手动运行时执行 |
| cc-safety-net | 2.6.16 | 打包代码经过压缩，按网络、执行和密钥关键词检查；独立 CLI 有用户触发的更新检查 |
| dsh-vision-router | 3.0.5 | **默认把图片发给免费的 OVHcloud 视觉接口**（README 写明，可在设置里改成仅本地）；HTML 截图用 `--no-sandbox` 启动浏览器；全局包装了 tesseract 的调用 |
| dsh-plugin-wallpaper-engine | 1.4.0 | 首次转码时下载约 70 MB 的 ffmpeg 并运行，有固定的 sha256 校验；依赖的 7 个同系列子包不在本次范围 |
| dsh-ops | 0.4.1 | 自带预编译的 Rust 二进制，未重新构建，字符串检查没有网络地址；Windows 上的 Bash/PowerShell 下载需要用户确认 |
| @michengai/dsh-skills-manager | 1.2.11 | 点击更新会安装 npm 最新版并跳过 pnpm 的发布时长保护；会读写约 20 个工具目录下的 skills 文件夹；从 skills.sh 等目录装的技能是第三方内容 |
| @michengai/dsh-codex-ui | 1.1.47 | 「关于」页可一键安装或更新同作者的固定几个插件，会改 profile 的 pnpm 配置 |
| @michengai/dsh-archive-manager | 1.1.7 | 点击更新同上，并把自己加入发布时长保护的例外；归档和修复会改写、删除会话文件，修复前有确认和备份 |

## 未通过

这些插件没有打「已审查」标签，仍然留在目录里，作者修复后可以重新申请。

| 插件 | 版本 | 原因 |
| --- | --- | --- |
| billion-context | 0.1.204 | 默认每几分钟检查 npm 并静默更新自己，「紧急公告」通道还能强制安装任意版本，审查过的代码不等于实际运行的代码；会全局接管模型请求转发到本地代理 |
| @xmanrui/dsh-im | 5.4.0 | 新建的飞书、QQ 机器人默认允许任何人私聊和在群里驱动 AI；模型可调用的发送文件工具能把本机任意可读文件发到聊天，没有目录限制 |
| @deepseek-harness-tui/dsh-tui | 0.16.1 | Windows 上默认设为完全访问、永不弹审批；自更新只校验同一发布里的 SHA256SUMS || dsh-cost-meter | 1.9.26 | 全局改写子进程启动，向 billion-context 进程注入代码；自动读取 opencode、WorkBuddy 等其他工具的登录凭据并发给对应服务商，且没有明确的开关说明 |

`@linxin666/*` 系列（同一仓库的 10 个包）这次没有审查，之后单独进行。

## 近期投稿审查

10 月 21 日到 26 日，通过 issue 投稿收录的插件都逐个审查过，清单里共有 70 个插件的 81 个版本：

- **包级审查（`package`）**：核对发布包结构、元数据、许可证和来源，覆盖全部投稿。
- **源码级审查（`static-security`）**：从 10 月 26 日起，新投稿还会检查发布代码和对应源码的安全边界，目前有 21 个：auto-review-model、novel-fish、external-task-context、selection-quote、Argo、custom-env、BiliMini、canteen-retention-check、composer-predictions、construction-doc-check、FlyMemory、game-translate、Matrix 主题、Mobile、moodboard、move-to-workspace、pinned-panel、screen-control、prompt-rewrite、safety-ledger-check、workspace-status。
- **暂缓**：QQ Gateway 需要补上媒体来源授权，6 个文档类工具需要限制解压大小；另有几项投稿等待安全、运行或打包问题修复后再收录。

各版本的哈希和日期见[审查清单](../../data/maintainer-reviews.json)，规则见[审查说明](review-policy.md)。

## 本项目

同一天也审查了本站和 dsh-open-market 插件自己：修复了点赞去重可以通过更换 User-Agent 绕过的问题（改为只按 IP，IPv6 按 /64），图标响应加上 `nosniff` 和禁止脚本的 CSP。CI 权限、发布包解析、SVG 过滤、HTML 转义和链接检查没有发现问题。

---

**English.** On 2026-10-27 the most used plugins without a review were statically reviewed, one exact release each, by AI agents with the maintainer making the call: package bytes checked against npm's SHA-512, nothing installed or run, then install scripts, processes, remote code, network hosts, secrets, file writes, self-updates, telemetry, XSS and permission defaults were inspected and spot-checked against the GitHub source. Releases without medium or high findings joined the [review ledger](../../data/maintainer-reviews.json) as `static-security`; the low findings above are mostly documented behaviour. billion-context (silent self-update and a forced-update channel), dsh-im (bots open to everyone by default, unrestricted file sending), dsh-TUI (no approvals and full access by default on Windows) and dsh-cost-meter (a global spawn hook injecting code into another package, and reuse of other tools' credentials) were not labelled. Issue submissions from 21–26 October cover 81 releases of 70 plugins, 21 of them with source-level review; QQ Gateway and six document tools are on hold. A review covers only the listed release.
