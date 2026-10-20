# 收录名称与双语文案复核 · 2026-10-20

逐条阅读 `data/sources.json` 中全部 775 个收录的名称和双语描述，结合现有发布快照，对有品牌识别问题的条目核对作者 README、仓库简介或项目名称。更正 392 个条目，其中 143 项调整名称，333 项调整描述，两类有重叠。范围是文案准确性与可读性，不涉及插件安装或代码审计。

## 名称

产品与项目名称保留原文，描述解释具体用途。作者提供正式中文名时与原名并列，普通功能名称仍可自然翻译。

| 包 | 展示名 | 来源 |
| --- | --- | --- |
| `ds-bot` | DeepSeek Bot | [作者 README](https://github.com/Fei2411/DeepSeek-Bot#readme) |
| `@openma/deepseek-harness-tui` | Martty | [作者 README](https://github.com/openma-ai/Martty#readme) |
| `@geml/dsh-plugin` | GEML | [作者 README](https://github.com/geml-spec/geml#readme) |
| `@deepblend/dsh-blender-bundle` | DeepBlend Studio | [作者 README](https://github.com/pearjelly/deep-blend#readme) |
| `dsh-flowglass` | Flowglass（流镜） | [作者 README](https://github.com/Iwctwbh/dsh-flowglass#readme) |
| `dsh-pharos` | Pharos（法罗斯灯塔） | [作者 README](https://github.com/Leo-Cjw/dsh-pharos#readme) |
| `dsh-brewreel` | BrewReel（精酿） | [作者 README](https://github.com/Finderchangchang/brewreel#readme) |
| `dsh-scout` | Scout（司察） | [作者 README](https://github.com/MaxHou-infinity/dsh-scout#readme) |

还统一了 GitHub、ChatGPT、OpenCode、OpenRouter、WorkBuddy、ComfyUI、MCP、API 等名称与缩写的大小写。梁神、灵枢、灵犀、庖丁、黑塔等已有中文名称保持不变。

## 描述

描述用具体动作解释功能，缩短实现细节堆叠，保留会影响使用判断的运行条件、授权、数据处理和依赖信息。主要语义更正包括：

- `dsh-escalation-review`：说明它复核需要离开沙箱执行的权限请求，审查失败时不自动放行。
- `dsh-claude-code-desktop-theme`：将 serif 准确表述为“衬线字体”。
- `@klarkxy/dsh-fusion`：依据作者说明恢复 Sidekick 名称，描述主模型与副手的任务委派和验收。
- `ds-bot`：描述带记忆的长期 Bot、私聊、群聊和 Bot 之间的分工协作。
- 审批、上下文处理、MCP 和会话管理条目：将抽象实现术语改为用户能据此判断用途的说明，保留工具名、协议名和必要前提。

## 维护与重放

完整覆盖清单和逐字段前后值见 [结构化复核记录](localization-2026-10-20.json)。`data/brand-names.json` 保存需要保留的产品名称，完整构建、指标刷新及文案刷新均会检查。

`node scripts/apply-copy-review.mjs docs/reviews/localization-2026-10-20.json` 可以重放本轮更正。已应用的字段会跳过；遇到审核后另行修改的文案会停止，避免覆盖新改动。

`pnpm build:copy` 仅刷新现有已校验快照的名称、介绍和双语页面，保留版本、指标和推荐曝光。当前公开快照有 773 项，新增的 `dsh-whale-balance` 和 `dsh-advanced-human-writing` 已审阅并保存在来源列表中，仍需完整构建后进入公开索引。未运行本地测试。
