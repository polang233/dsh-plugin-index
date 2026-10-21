# Plugin checks / 插件核查 · 2026-10-18

GitHub counts were checked at approximately 05:26 UTC. Source tests and published-package checks are recorded separately; a successful source test does not establish that the npm build is identical.

Star 数采集于当日约 05:26 UTC。源码测试和发布包检查分别记录，不将源码测试结果等同于 npm 安装或宿主集成测试。

## Chat Import · 238 stars

[Repository / 仓库](https://github.com/Nwflower/dsh-chat-import) · [npm 0.26.1](https://www.npmjs.com/package/dsh-chat-import/v/0.26.1)

Imports conversations from coding assistants into DSH. / 将编程助手的聊天记录导入 DSH。

**Local result / 本地结果：100 passed, 0 failed.** Windows, Node.js 24.21.0, source commit [`d207a59`](https://github.com/Nwflower/dsh-chat-import/commit/d207a59719c6c004c3b04d66f0837dc67d6d1d91), tested at 05:48 UTC.

```sh
node --test test/convert-claude.test.mjs test/convert-codex.test.mjs test/convert-shared.test.mjs
```

The suites cover Claude/Codex conversation conversion, tool-call pairing, compression boundaries and malformed input. They do not cover every import format or live DSH integration.

测试覆盖 Claude/Codex 会话转换、工具调用配对、压缩边界和异常输入，未覆盖全部导入格式或真实 DSH 集成。

[Local test log / 本地测试日志](chat-import-converters.md) · [Author CI / 作者 CI](https://github.com/Nwflower/dsh-chat-import/actions/runs/39034536342)

The tested commit matches the npm release's declared gitHead. The published archive also passed identity, SHA-512, bundle patch and main-file checks; no reproducible-build comparison was performed.

测试提交与 npm 声明的 gitHead 一致。发布包也通过了身份、SHA-512、补丁和入口文件检查，未进行可复现构建对比。

## GenUI · 626 stars

[Repository / 仓库](https://github.com/omdsh-dev/dsh-genui) · [npm @changfenhuang/dsh-genui 0.13.0](https://www.npmjs.com/package/@changfenhuang/dsh-genui/v/0.13.0)

Interactive charts, forms and diagrams in replies. / 在回复中展示交互图表、表单和流程图。

[Author CI passed](https://github.com/omdsh-dev/dsh-genui/actions/runs/39046779600) at [`3a4e524`](https://github.com/omdsh-dev/dsh-genui/commit/3a4e524fdb60611f66138d3ea9cb6dd7f141b9f4). Local dependency installation timed out. The subsequent Vitest command could not find its entry point, so **no local tests ran**. The published archive passed package checks; npm did not supply a gitHead.

作者 CI 成功。本地依赖安装超时，随后因缺少 Vitest 入口而未运行测试；不能标为本地测试通过。发布包检查通过，npm 未提供 gitHead。

## Mnemon · 579 stars

[Repository / 仓库](https://github.com/omdsh-dev/dsh-mnemon) · [npm 0.5.32](https://www.npmjs.com/package/dsh-mnemon/v/0.5.32)

Long-term memory with configurable sources and retrieval strategies. / 支持配置来源和检索策略的长期记忆。

[Author CI passed](https://github.com/omdsh-dev/dsh-mnemon/actions/runs/39062452571) at [`2143a1e`](https://github.com/omdsh-dev/dsh-mnemon/commit/2143a1edc6e57d5adc12a5300161da8d48c38af4). No local unit suite was run. The published archive passed package checks; npm did not supply a gitHead.

作者 CI 成功，未执行本地单元测试。发布包检查通过，npm 未提供 gitHead。

## Scope / 范围

Local tests used an isolated home and temporary directory with no inherited GitHub token or user API keys. Package checks read archives without executing plugins. No code audit, transitive-dependency verification or live-service installation test is claimed.

本地测试使用隔离的用户目录和临时目录，不继承 GitHub token 或用户 API 密钥。发布包检查只读取归档，不执行插件；上述结果不代表代码审计、完整依赖验证或真实服务安装测试。
