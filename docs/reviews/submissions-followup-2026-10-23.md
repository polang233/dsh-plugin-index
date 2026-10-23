# 投稿复核与收录记录

本轮检查 14 项，13 项通过并加入收录配置，1 项待补充。维护者确认后已向全部 14 个 Issue 回复；通过的申请随收录提交关闭，发布由 GitHub Actions 执行。

仅检查本轮条目的公开来源、归档身份、SHA-512、许可证、补丁、入口、导出文件及官方索引格式；没有安装或执行插件，全量测试与发布留给 GitHub Actions。

| Issue | 插件 | 复核版本 | 结论 |
| --- | --- | --- | --- |
| [#43](https://github.com/polang233/dsh-plugin-index/issues/43) | @dr-co/dsh-speech-gate | 0.1.1 | 通过，加入收录配置 |
| [#45](https://github.com/polang233/dsh-plugin-index/issues/45) | @sunshaobei/dsh-balance-panel | 3.1.0 | 通过，加入收录配置 |
| [#46](https://github.com/polang233/dsh-plugin-index/issues/46) | @sunshaobei/dsh-codex-auth | 3.1.3 | 通过，加入收录配置 |
| [#47](https://github.com/polang233/dsh-plugin-index/issues/47) | @sunshaobei/dsh-input-history | 3.0.4 | 通过，加入收录配置 |
| [#50](https://github.com/polang233/dsh-plugin-index/issues/50) | @sunshaobei/dsh-workflow | 3.0.4 | 通过，加入收录配置 |
| [#53](https://github.com/polang233/dsh-plugin-index/issues/53) | @yyyzl/dsh-image-feedback | 0.1.0 | 通过，加入收录配置 |
| [#54](https://github.com/polang233/dsh-plugin-index/issues/54) | @dr-co/dsh-skills | 0.1.0 | 通过，加入收录配置 |
| [#55](https://github.com/polang233/dsh-plugin-index/issues/55) | @local/skill-compiler | 3.9.3 | 待补充 |
| [#56](https://github.com/polang233/dsh-plugin-index/issues/56) | dsh-jev-progress | 0.5.5 | 通过，加入收录配置 |
| [#57](https://github.com/polang233/dsh-plugin-index/issues/57) | dsh-reforge | 0.1.0-alpha.1 | 通过，加入收录配置 |
| [#58](https://github.com/polang233/dsh-plugin-index/issues/58) | dsh-mcp-tools | 1.0.2 | 通过，加入收录配置 |
| [#59](https://github.com/polang233/dsh-plugin-index/issues/59) | @lifenrir/dsh-video-preview | 0.1.0 | 通过，加入收录配置 |
| [#60](https://github.com/polang233/dsh-plugin-index/issues/60) | @lifenrir/dsh-selection-quote | 0.1.0 | 通过，加入收录配置 |
| [#61](https://github.com/polang233/dsh-plugin-index/issues/61) | @lifenrir/dsh-external-task-context | 0.1.0 | 通过，加入收录配置 |

## 需要保留的说明

- #45、#46 的 npm gitHead 指向前一提交，但当前公开源码已包含相同的运行代码，已比较差异文件。
- #53、#59、#60、#61 使用固定 Git 提交和归档 SHA-512；#53 的 private 标记仅禁止 npm 发布，不妨碍完整 Git 包收录。
- #57 固定 0.1.0-alpha.1，保留实验性、DSH 0.2.0-rc.2 Web、学习默认关闭及执行/模型共享说明；旧仓库与新仓库 ID 相同，更名不是源码归属问题。
- #56 保留 JeV Key、外部服务数据传输和轻量摘要费用说明。
- Logo 和截图是可选项，不作为这些条目的拒绝理由。

## Issue 回复

### [#43](https://github.com/polang233/dsh-plugin-index/issues/43#issuecomment-6363331135)

Thanks for the submission and updates! The package checks passed and it has been added to the listing configuration. It will appear once the commit is pushed and GitHub Actions publishes the updated index. 🙂

### [#45](https://github.com/polang233/dsh-plugin-index/issues/45#issuecomment-6363331917)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#46](https://github.com/polang233/dsh-plugin-index/issues/46#issuecomment-6363332571)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#47](https://github.com/polang233/dsh-plugin-index/issues/47#issuecomment-6363333176)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#50](https://github.com/polang233/dsh-plugin-index/issues/50#issuecomment-6363334021)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#53](https://github.com/polang233/dsh-plugin-index/issues/53#issuecomment-6363334720)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#54](https://github.com/polang233/dsh-plugin-index/issues/54#issuecomment-6363335351)

Thanks for the submission and updates! The package checks passed and it has been added to the listing configuration. It will appear once the commit is pushed and GitHub Actions publishes the updated index. 🙂

### [#55](https://github.com/polang233/dsh-plugin-index/issues/55#issuecomment-6363336090)

Thanks for submitting LifeCode Skill-Compiler! I found the plugin under `skill-compiler/`, with package name `@local/skill-compiler` and `private: true`. Our fixed Git source currently requires the complete installable plugin at the repository root, so this layout cannot be listed yet.

Please either publish a public npm package containing the patch and runtime files, or provide a dedicated repository with the complete plugin at its root and a full commit SHA.

The MIT license is present. Reply here with the installable source when ready and we can recheck. 🙂

### [#56](https://github.com/polang233/dsh-plugin-index/issues/56#issuecomment-6363336833)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#57](https://github.com/polang233/dsh-plugin-index/issues/57#issuecomment-6363337504)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#58](https://github.com/polang233/dsh-plugin-index/issues/58#issuecomment-6363338183)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#59](https://github.com/polang233/dsh-plugin-index/issues/59#issuecomment-6363338891)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#60](https://github.com/polang233/dsh-plugin-index/issues/60#issuecomment-6363339576)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂

### [#61](https://github.com/polang233/dsh-plugin-index/issues/61#issuecomment-6363340214)

感谢提交！已核查并加入收录配置，提交推送且 GitHub Actions 发布完成后即可在市场中看到。🙂


## 后续检查

未发现新的插件投稿。新增的 [#62](https://github.com/polang233/dsh-plugin-index/issues/62) 是自动维护单，涉及 4 个 Git 固定版本更新与 `@tnnevol/dsh-codebuddy` 的源码或许可证信息缺失，另行处理。
