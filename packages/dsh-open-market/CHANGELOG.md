# dsh-open-market 更新记录

## 0.3.0

### 中文

- 新增分类筛选和本地同义词搜索。分类可与关键词叠加，完整字面匹配优先展示。
- 插件详情按需加载项目 README 中的界面截图；更新说明按版本展开读取，历史版本也可单独查看。请求结果缓存一小时，读取失败可重试。
- 收藏、分组、设置及首次运行标记改为保存在当前 DSH profile，自动迁移已有浏览器数据；后台读取期间的本地修改会保留，保存失败时可重试。
- 更新和切换版本交给宿主完成。优先使用宿主原生更新恢复接口；替换失败时尝试恢复原版本或固定 Git 提交及启用状态。无法确认原安装来源时保留当前版本，恢复失败会明确提示。
- 右下角链接每次打开先显示与上次最后看到的不同文案，自动轮换间隔改为 10 秒；鼠标悬停或键盘聚焦时暂停轮换。

### English

- Added category filters and local synonym search. Categories work together with keywords, and literal matches appear first.
- Plugin details load screenshots from the project's README on demand. Expand release notes for the selected version, including individual historical versions. Successful requests are cached for one hour; failed requests can be retried.
- Favorites, groups, settings and first-launch state now persist in the current DSH profile, with automatic migration from browser storage. Local edits made during loading are preserved, and failed saves can be retried.
- The Host now owns updates and version switches. It prefers the native update and recovery API; failed replacements attempt to restore the original version or pinned Git commit and enabled state. If the original source cannot be confirmed, the current installation is kept. Failed restoration is reported explicitly.
- The bottom-right link opens with a different message from the last one shown and rotates every 10 seconds. Rotation pauses while hovered or focused.

## 0.2.7

- 插件详情增加「其他版本」，展开后按需读取 npm 元数据，按发布时间列出可安装版本；支持预发布标记、作者声明的 DSH 兼容范围和精确版本安装、复制命令。
- 版本列表在本机缓存一小时，读取失败可重试；遵循下载源设置，Git 来源只展示索引已确认的固定提交。
- 其他 npm 版本标明「本站未审查」，不会继承收录版本的审查标记；切换已安装版本复用卸载再安装流程，并保留运行中需重启等错误提示。
- 修复开放市场更新自己时卸载后中断的问题：由宿主持有管理器完成后续安装，页面卸载或请求断开不会取消；独立提示显示完成、失败或重启要求，服务不可用时保留当前安装。
- 修复缓存恢复时预发布版升级到正式版未显示可更新的问题；管理器服务稍后就绪时，也会同步刷新安装状态。

## 0.2.6

- 市场数据和点赞保存在本机：打开即显示，每 6 小时在后台更新，更新失败时继续显示已有数据。
- 「我已安装」旁新增设置入口，与插件详情页共用分组后的设置；新增下载源选择、手动同步，「显示已安装插件」现在同时作用于推荐和全部插件。
- 所有推荐行改为平滑翻页，翻页按钮移到页面边距；今日推荐增加两侧渐变，渐变落在边距里，不占卡片宽度，首张卡片默认略微进入左侧渐变。
- 「全部插件」展开后占满页面边距，「收起」左侧新增排序按钮，两侧箭头可以切换排序。
- 新增侧边栏入口和全宽市场页面，设置里可开关；旧版 DSH 没有开放市场标签时默认显示，并直接读取索引。
- 右下角在 star 和收录邀请之间轮换，收录邀请打开贡献指南。

## 0.2.5

- 新增收藏分组，支持按组管理插件，并可导入或导出列表。
- 新增已安装插件面板，方便查看和更新来自开放市场的插件。
- 调整市场卡片、推荐列表和整体布局，并修复启动问题。
