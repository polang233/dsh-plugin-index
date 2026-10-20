# 投稿收录准备 · 2026-10-21

本轮准备收录 #11–#16 共 6 个插件，npm 来源 2 个，固定 Git 来源 4 个。来源清单由 775 条增至 781 条，另为 ColorLab、DSH BTW 和 DeepSeek Workbench 记录品牌名称。六条已回复并关闭，收录内容已获维护者确认。

在线核对了投稿、作者语言线索、项目文档、许可证、固定提交的清单与文件列表。归档只在内存中读取并计算 SHA-512，没有保存或解包，没有安装、执行插件或运行本地测试。

## 来源与展示文案

| Issue | 包与展示名 | 本次核对版本 | 来源 | DSH 范围 |
| --- | --- | --- | --- | --- |
| [#11](https://github.com/polang233/dsh-plugin-index/issues/11) | `dsh-plugin-session-fulltext` · 会话全文搜索 | `1.0.0` | npm latest | `>=0.2.1-rc.2 <0.3.0` |
| [#12](https://github.com/polang233/dsh-plugin-index/issues/12) | `dsh-deepseek-workbench` · DeepSeek Workbench | `0.1.0-dsh.0.2.1-rc.2` | `24b3de5ca54c0516487f8de1ef0a8ae2fadde400` | `0.2.1-rc.2` |
| [#13](https://github.com/polang233/dsh-plugin-index/issues/13) | `dsh-colorlab` · ColorLab 配色主题 | `1.0.0` | `b973f6bdd44b0bc3267f52b55115cc0e55fff889` | `未声明` |
| [#14](https://github.com/polang233/dsh-plugin-index/issues/14) | `@gulagala001/dsh-btw` · DSH BTW | `0.1.0-dsh.0.2.1-rc.2` | `f53d5291bd8e252ab04290f8d9040f158a9f0c81` | `0.2.1-rc.2` |
| [#15](https://github.com/polang233/dsh-plugin-index/issues/15) | `@gulagala001/dsh-theme-plugin` · DSH 主题与外观 | `0.1.0-dsh.0.2.1-rc.2` | `d5093a8895f9303c73cda716ee80bfcf143ff3ba` | `0.2.1-rc.2` |
| [#16](https://github.com/polang233/dsh-plugin-index/issues/16) | `dsh-global-todo` · 全局待办 | `0.11.2` | npm latest | `>=0.2.0-rc.1 <0.3.0` |

全部为 MIT。npm 条目沿用跟踪 latest 的习惯，不在来源配置中固定版本。全局待办已于核对期间发布 0.11.2，本次使用实际 npm 最新版本。Git 条目固定 manifest 匹配的版本、完整提交和归档 SHA-512；三个有 Release 的 Git 项目也核对了 tag 与提交一致。ColorLab 没有 Release，发布时间采用固定提交的提交时间。

六条均已通过现有生成器的 SHA-512、清单身份、补丁文件及官方索引格式检查，预览位于 `.local/submission-preview/`。可运行 `node scripts/preview-submissions.mjs docs/reviews/plugin-submissions-2026-10-21.json` 重新生成，不安装或执行插件。

完整 SHA-512、归档地址、静态入口、许可证链接和语言判断依据见 [结构化记录](plugin-submissions-2026-10-21.json)。

## #11 会话全文搜索

按字词搜索会话正文，支持中文短词匹配、结果定位高亮和命中跳转。

英文展示名：Session Full-text Search

英文描述：Search session messages with Chinese-friendly substring matching, jump to highlighted results and move between matches.

- 首次安装需重启客户端以加载浏览器扩展。
- 通过内存缓存与字面子串扫描实现搜索，大量历史会话会增加预热时间与内存占用。

已回复：感谢！将在下个提交后收录 😄（[评论](https://github.com/polang233/dsh-plugin-index/issues/11#issuecomment-6296372429)）

## #12 DeepSeek Workbench

在 DSH 桌面内使用 DeepSeek 网页聊天与 API 平台，将网页会话转为 DSH 会话继续。仅适配 DSH 0.2.1-rc.2，持久登录与官网下载需配套宿主适配。

英文展示名：DeepSeek Workbench

英文描述：Use DeepSeek web chat and its API platform in DSH, and continue web chats as DSH sessions. Requires DSH 0.2.1-rc.2 desktop; persistent sign-in and downloads need the companion host adapter.

- 仅支持 DSH 0.2.1-rc.2 和 Cordis 4.0.5。
- 标准桌面提供进程内登录，持久登录、官网下载和扩展平台页面需要配套桌面源码适配并重新构建宿主。
- 浏览器客户端受嵌入与跨域限制，只提供外部入口。
- 作者未完成真实官网登录后的发送、临时会话删除，以及 Windows/Linux 设备验证。

已回复：感谢！将在下个提交后收录 😊（[评论](https://github.com/polang233/dsh-plugin-index/issues/12#issuecomment-6296374217)）

## #13 ColorLab 配色主题

以 Mariana 为默认配色，调整界面与正文颜色、保存配色方案并查看对比度提示。包内未声明适用的 DSH 版本。

英文展示名：ColorLab

英文描述：Customize DSH colors with the Mariana palette, saved presets and contrast hints. The package does not declare a DSH compatibility range.

- package.json 标记 private:true，未发布 npm，按维护者允许的固定 Git 提交收录。
- 未声明 engines.dsh 或 DSH peerDependencies，不推断、补写兼容范围。
- 正文着色依赖宿主 CSS 类名前缀；设置页目前仅中文；终端 ANSI 16 色不随主题改变。
- README 声称源码安装需授权构建，但 package.json 没有构建生命周期脚本，此处仅记录文档差异。

已回复：感谢！将在下个提交后收录 🙂（[评论](https://github.com/polang233/dsh-plugin-index/issues/13#issuecomment-6296375575)）

## #14 DSH BTW

借助当前会话上下文旁聊，主任务可继续运行。仅适配 DSH 0.2.1-rc.2，刷新后旁聊历史清空，旁聊不能执行工具。

英文展示名：DSH BTW

英文描述：Ask side questions using the current conversation while the main task continues. Requires DSH 0.2.1-rc.2; side history disappears on reload and side requests cannot run tools.

- 仅支持 DSH 0.2.1-rc.2 和 Cordis 4.0.5。
- 每个主会话最多保留最近 20 轮旁聊，数据仅在当前窗口内存中，刷新或关闭后清空。
- 旁聊不执行工具，沿用现有模型提供商并正常计费，不能保证缓存命中。
- 作者仅报告 macOS 原生 Web 验证，Windows/Linux/Electron 未验证。

已回复：感谢！将在下个提交后收录 ☺️（[评论](https://github.com/polang233/dsh-plugin-index/issues/14#issuecomment-6296377041)）

## #15 DSH 主题与外观

管理外观与主题，浏览带预览图的社区市场，安装检查通过后应用主题。仅适配 DSH 0.2.1-rc.2，部分检查需要下载 Chromium。

英文展示名：DSH Themes and Appearance

英文描述：Manage appearance and themes, browse a visual community market, and check themes before applying them. Requires DSH 0.2.1-rc.2; some checks need a Chromium download.

- 仅支持 DSH 0.2.1-rc.2 和 Cordis 4.0.5。
- 安装标识是 @gulagala001/dsh-theme-plugin，无作用域 npm 同名包属于其他作者。
- 动态主题预检使用独立 DSH 与浏览器；没有可用浏览器时会下载固定 Chromium。
- 社区目录数量不代表全部兼容，作者未逐一验证所有设备和插件组合。

已回复：感谢！将在下个提交后收录 😃（[评论](https://github.com/polang233/dsh-plugin-index/issues/15#issuecomment-6296378726)）

## #16 全局待办

跨会话管理人和 Agent 共用的待办清单，一键交给对话继续处理，并由人确认完成。界面需使用 DSH Web 客户端。

英文展示名：Global Todo

英文描述：Keep a shared cross-session todo list, hand tasks to a conversation and confirm agent-reported completion. The panel requires the DSH Web client.

- 支持 DSH >=0.2.0-rc.1 <0.3.0，Node >=22.19.0。
- 待办面板依赖 Web 客户端；Electron 客户端暂不支持；无界面环境仍可使用 Agent 工具。
- 作者宣称的测试数和平台验证来自项目文档，本轮未重跑。

已回复：感谢！将在下个提交后收录 😁（[评论](https://github.com/polang233/dsh-plugin-index/issues/16#issuecomment-6296380099)）

上述六条均根据作者资料、仓库文档和投稿内容选择中文回复，已发送并关闭 issue。收录与 README 修改已获维护者确认，将一同提交发布。
