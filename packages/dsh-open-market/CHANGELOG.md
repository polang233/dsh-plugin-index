# dsh-open-market 更新记录

## 0.4.1

### English

- Added leaderboards under today's picks: Most popular and Most stars sit side by side, five places each and twenty on request, and a row opens the plugin's details. The Recommended, Fastest growing and Newly published rows stay below them.
- Rows open staggered by an offset drawn per day, each row in its own band so no two line up; the offsets hold all day and change the next.
- Fixed clipping: today's picks no longer start under the edge fade, and the carousel arrows start at the gutter's outer edge so they cover less of the cards. In the Whale Maid theme the Plugins tab bar's bottom outline and shadow are no longer cut off.
- Today's picks open on a slide drawn per day instead of always on the first.
- Card labels keep a fixed number of rows (one on row cards, two on today's picks). A label that does not fit is left out whole instead of being cut mid-pill or stretching the card.
- Section, like and favorite icons are drawn instead of typed, so they no longer depend on system fonts.
- Plugin markets and managers, this one included, no longer take recommendation places in the tab: they are left out of today's picks and come after every other plugin in Recommended. Search, the leaderboards and the other orders are unchanged.
- Whale Maid theme: from the sidebar the mascot peeks over a rule under the page title instead of floating with her lower edge cut off; on the Plugins page, where DSH's tab bar covered all but a sliver of her, she is left out.

### 中文

- 今日推荐下方新增排行榜：「最受欢迎」「星数最多」并排展示，各显示前 5 名，可展开到前 20 名，点一行打开插件详情。「智能推荐」「增长最快」「最新发布」横排仍保留在排行榜下方。
- 横排打开时按天随机错开，每条横排的错位幅度各不相同，几行不会对齐；同一天内保持不变，第二天重新随机。
- 修复裁切：今日推荐的第一张卡不再被边缘渐隐遮住；左右箭头移到页面留白的外沿，少压住卡片。鲸鱼女仆主题下，「插件」页标签栏底部的描边和阴影不再被切掉。
- 今日推荐按天随机停在其中一张，不再总是从第一张开始。
- 卡片标签固定行数（横排卡片 1 行，今日推荐 2 行），放不下的标签整枚隐藏，不再被切半截，也不再把卡片撑高。
- 分区标题、点赞和收藏的图标改为绘制的矢量图标，不再依赖系统字体里的符号。
- 插件市场和管理类插件（包括本插件）在标签页里不再占推荐位：不进今日推荐，在「智能推荐」中排在其他插件之后。搜索、排行榜和其他排序不变。
- 鲸鱼女仆主题：从侧边栏打开时，吉祥物趴在页面标题下的墨线上；在「插件」页里 DSH 的标签栏会把她盖得只剩一条，所以那里不再显示。

## 0.4.0

### English

- Replaced Installed with a complete local plugin manager, including bundles outside the market. System plugins start collapsed, state badges distinguish enabled and disabled bundles, and details open even for broken or incompatible plugins. Added native settings navigation, enable/disable, typed-confirmation uninstall, search, filters and bulk controls.
- Added immediate and idle-queued updates, including exact-version switches. The Host owns a persistent queue with cancellation, retry, outcome history and installation identity checks. Reported tasks must be idle before mutation; new Agent input waits during maintenance. Host restarts require explicit retry, and failed replacements retain the existing recovery path.
- Added runtime and configuration locations with directory shortcuts, loaded/error/risk counts, direct dependency and compatibility diagnostics, and management reports. Import-only dependencies with private manifest exports are resolved through the native package locator. Separate plugin data directories are not guessed, and risk indicators are metadata checks rather than a security audit.
- Added custom bundle-layer order editing with fixed system positions, dependency checks, profile revision checks, native file locking and exclusive HMR reconciliation. Failed application restores the previous profile. Layer order describes patch composition, not asynchronous startup completion time.
- Added horizontal mouse dragging from text, buttons and cards without selecting text or activating a button after a drag. Regular clicks, typing, touch scrolling and keyboard navigation remain available.
- Added short localized native detail documents and management styling for DSH's default appearance and the Macaron theme. Fixed native RPC option arguments, disabled-component labels and missing label metadata in the native settings launcher.
- Renamed the Macaron theme to the Whale Maid theme, with its own light or dark choice that follows DSH by default, and brought it much closer to dshopen.org: dotted cream paper, 2px ink outlines and hard shadows, a macaron tone per plugin on tilted icons, solid coloured label pills, sun-yellow install buttons, marker-pen section titles and cards that lift on hover. The management dialog now shares the market's look and is simpler: one summary row, search with Check updates, filter pills, card-style rows, the plugin's actions in one row, updates only when there is one, and load order, components and notes folded away.
- Show Open Market in the sidebar is now on by default. Likes are always on and no longer have a switch. Auto review for new conversations moved to a Small tools group in the settings.

Task protection covers activity reported by the Host across all sessions. Independent background producers and operations started directly in native management do not share this gate. Older Hosts without the required APIs refuse protected mutations.

### 中文

- 将「我已安装」扩展为完整本机插件管理，包含市场外插件。系统插件默认折叠，启停使用独立标签，异常或不兼容插件仍可打开详情；补齐官方设置跳转、启停、输入包名确认卸载、搜索筛选和批量操作。
- 支持立即更新、空闲后更新和精确版本切换。宿主持有持久化队列，支持取消、重试、结果记录和安装状态核对；已报告任务空闲后才修改插件，维护期间保留新输入。Host 重启后须重新确认，更新失败继续使用原有恢复机制。
- 增加运行与配置目录、快捷打开、加载数与异常/风险计数、直接依赖和版本兼容性诊断，以及管理报告；仅支持导入且未导出清单的依赖通过原生目录定位继续核对。插件独立数据目录不做猜测，风险提示只代表元数据检查。
- 支持调整自定义插件配置层顺序，保留系统层位置，校验依赖与配置版本，复用原生文件锁和 HMR 排他事务；应用失败时恢复原配置。顺序表示补丁合并位置，不代表异步启动完成时间。
- 横向推荐行支持从文字、按钮或卡片按住拖动，拖动不会选中文字或误触按钮，保留普通单击、输入、触屏和键盘操作。
- 官方详情改用简短中英文说明，管理页适配 DSH 默认外观和马卡龙主题；修复原生 RPC 可选参数、停用组件状态，以及官方设置入口缺少标签元数据时的异常。
- 马卡龙主题更名为鲸鱼女仆主题，可单独选浅色或深色（默认跟随 DSH），并更贴近 dshopen.org：点阵奶油底、2px 墨线和硬阴影、每个插件一种马卡龙色的倾斜图标、实色标签胶囊、阳光黄安装按钮、马克笔标题和悬停抬起的卡片。插件管理页沿用市场的样式并精简：顶部一行概况、搜索旁「检查更新」、胶囊筛选、卡片式列表、插件操作排在同一行，有更新时才显示更新区，启动顺序、组件和说明默认收起。
- 「在侧边栏显示开放市场」默认开启；点赞始终开启，不再提供开关；「新对话默认自动审查」移到设置里的「小工具」。

任务保护基于宿主报告的所有会话活动；独立后台生产者和直接在官方管理页发起的操作不共用此维护入口。旧版宿主缺少必要 API 时会拒绝受保护的修改。

## 0.3.3

### 中文

- 修复 Dream Skin 等透明主题下「我已安装」、收藏夹、插件详情和设置弹窗背景透明、内容重叠的问题。弹窗挂载到页面外层，使用 DSH 的弹窗背景和遮罩模糊设置。

### English

- Fixed transparent backgrounds and overlapping content in Installed, favorites, plugin details and settings with themes such as Dream Skin. Dialogs now mount outside the page and use DSH's dialog background and mask blur settings.

## 0.3.2

### 中文

- 新增可选的「马卡龙主题」（设置 → 显示，默认关闭），沿用 dshopen.org 网站的风格，覆盖侧边栏、会话列表、消息、输入框、菜单、对话框、标签页、设置、代码块、滚动条和开放市场；跟随 DSH 浅色或深色外观。开关即时生效，关闭后完全移除，选择保存在 profile 中。
- 鲸鱼女仆只出现在空白处：新对话页、侧边栏底部、开放市场顶部和空状态。三张插画由 Codex 调用 OpenAI GPT 图像模型生成，以站点鲸鱼女仆标志为参考，合计约 45 KB。
- 宿主新增只读路由 `/dsh-open-market/theme/`，只提供包内的样式表和插画。

### English

- Added an optional **Macaron theme** (Settings → Display, off by default) in the style of the dshopen.org website, covering the sidebar, conversation list, messages, composer, menus, dialogs, tabs, settings, code blocks, scrollbars and Open Market, following DSH's light or dark appearance. It switches on and off instantly, leaves nothing behind when off, and is saved in the profile.
- The whale maid appears only in empty spaces: the new-conversation screen, the bottom of the sidebar, the Open Market header and empty states. The three poses were generated with OpenAI's GPT image model through Codex from the site's whale-maid logo, about 45 KB in total.
- The Host serves the theme's stylesheet and artwork from the package at `/dsh-open-market/theme/`, read-only.

## 0.3.1

### 中文

- 修复搜索遇到缺少标题或简介的插件时导致页面异常的问题，保留分类和同义词筛选。
- 自更新持有 Cordis 服务原实例，更新锁跨重载保留。修复卸载已部分完成却报错时跳过恢复的问题：旧包仍在时恢复启用状态，已移除时恢复原版本；原生更新成功后核实实际版本。
- 界面预览优先采用作者提交、维护者确认的截图，README 自动识别增加预览语境、装饰图和图片尺寸过滤。读取失败保留原文入口。
- README 优先读取 Raw 文件，减少 GitHub API 限流影响；更新说明支持包名前缀标签，并在 Release 不可用时读取对应版本的 CHANGELOG。
- 分类下拉框统一主题样式，更新安装列表简介，侧栏采用「鲸鱼与插件」单色图标。

### English

- Fixed search crashing when a plugin has no title or description.
- Updates retain the original Cordis service and a lock across reloads. Partial removal failures restore the existing selection or reinstall the original release. Native update results are checked against the installed version.
- Author-provided, maintainer-selected screenshots take priority. README previews filter decorative and small images and retain a source link when loading fails.
- README loading prefers Raw files to reduce GitHub API requests. Release notes recognize package-prefixed tags and fall back to the selected version in CHANGELOG.
- Styled the category selector, rewrote the installed-plugin summary and added a monochrome whale and plug sidebar icon.

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
