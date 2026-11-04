# dsh-open-market

Discover and manage community plugins in DeepSeek Harness with [Open Plugin Market](https://dshopen.org/): category search, grouped favorites, version switching and updates.

在 DeepSeek Harness 中发现和管理社区插件，支持分类搜索、收藏分组、版本切换与更新。

## 0.3.2 — What's new / 更新内容

- **Macaron theme**: an optional theme in the style of the [dshopen.org](https://dshopen.org/) website, covering the sidebar, conversations, code blocks, menus, dialogs and settings. Turn it on under Settings → Display; switching it off restores DSH right away. 新增可选的**马卡龙主题**，沿用 [dshopen.org](https://dshopen.org/zh/) 网站的风格，覆盖侧边栏、对话、代码块、菜单、对话框和设置页。在设置 → 显示里打开，关闭后立即恢复原样。
- Coming from 0.2.7 or earlier? Take the first upgrade from DSH's Plugins page or the install command: older versions run their own updater, which could remove Open Market. 从 0.2.7 或更早版本升级时，第一次请到 DSH「插件」页或用安装命令更新：旧版用的是自己的更新代码，可能把开放市场卸载掉。

[Full release notes / 完整更新说明](https://github.com/polang233/dsh-plugin-index/blob/main/packages/dsh-open-market/CHANGELOG.md#032)

## Install / 安装

```bash
dsh plugin --profile desktop add dsh-open-market
```

Or from GitHub / 或从 GitHub 安装:

```bash
dsh plugin --profile desktop add "git+https://github.com/polang233/dsh-plugin-index.git#main&path:/packages/dsh-open-market"
```

On the next start, `https://dshopen.org/index.json` appears in **Plugins → Discover**.
重启后，开放插件市场会出现在「插件 → 发现」中。

## Behavior / 行为

- Switches on **Custom plugin markets** (Plugins → Experimental plugins) once per profile; DSH applies it at the next start. If you turn it off later, it stays off.
- Adds the index once per profile, after your existing sources. It never duplicates a source, and a source you remove stays removed until you switch the plugin off and on again.
- Adds an **Open Market** tab to the Plugins page: search the catalog with category filters and synonyms, browse today's picks and ranked rows, and sort the full grid. Installed lists your plugins from this index with their updates. Favorites support named groups, packages added by name, group enable/disable and list import/export. New installs use DSH's install dialog. Updates and version switches run on the Host, with an attempt to restore the original version if replacement fails.
- You can like a plugin once a day, and installing one counts as a like. Likes lose one every three days and weigh today's picks.
- **Start new conversations in Auto review** (off by default; in the settings, or the second row of this plugin under Installed): every new conversation switches to DSH's experimental Auto review permission when it starts, so you no longer pick and confirm it each time. Auto review is switched on too if it was off, which may need a restart. Restored conversations, forks and subagents keep their own permission.
- The market opens with the data saved on this computer and updates in the background every six hours; a failed update leaves the saved data on screen. **Sync latest data** in the settings updates it right away.
- **Other versions** in a plugin's detail loads npm version metadata only when expanded, then caches the list on this computer for one hour. Releases are shown by publication date, with prerelease labels and publisher-declared DSH requirements; deprecated releases and releases without a bundle declaration are omitted. Each row installs or copies the exact version. Other npm versions have not been reviewed by this market, and DSH checks the chosen package when installing. Switching an installed version removes it first, as Update does. Git sources list only the fixed commits already in the index, without querying npm or Git tags.
- Updating Open Market itself runs through an authenticated request to DSH. The Host continues the operation if the market page closes, and a separate notice shows the result. The original source must be known before removal. Failed replacements attempt restoration; if that also fails, reinstall from Plugins. Older versions need to receive this update through Plugins or the install command first.
- Settings: the gear beside Installed on the Open Market tab, or the plugin's page under Installed. Both show the same groups: display, data and sync, downloads, conversations and links. **Download from** picks the npm registry for installs and updates started in this tab (official, DSH's own choice, the mainland China mirror or a custom address); Git plugins and DSH's Discover tab are not affected.
- **Macaron theme** (Settings → Display, off by default) restyles DSH in the style of the [dshopen.org](https://dshopen.org/) website, with the whale maid in empty spaces only (the new-conversation screen, the bottom of the sidebar, the Open Market header and its empty states). It covers the sidebar, conversation list, messages, composer, buttons, inputs, menus, dialogs, tabs, settings, code blocks, scrollbars and the Open Market tab, and follows DSH's light or dark appearance with a matching night palette. Text keeps WCAG AA contrast or better than DSH's defaults, focus rings stay visible, and outlines are drawn with shadows so nothing changes size. It works through DSH's own color tokens plus a few scoped rules; switching it off removes everything at once, no reload needed. The choice is saved in the profile like the other settings. The Host serves the stylesheet and artwork from the package at `/dsh-open-market/theme/`.
- **Show Open Market in the sidebar** adds a separate full-width page. It is off by default where the Plugins page has the Open Market tab, and on where it does not. When DSH has no market service, that page reads `dshopen.org/index.json` itself. It installs without DSH's install dialog, so a plugin whose install scripts need approval has to be installed from Plugins.
- The browsing tab appears when Custom plugin markets is available; an unavailable market service does not block DSH startup.
- `/open-market` puts the index back and switches Custom plugin markets on again, for when you change your mind.
- The plugin keeps its setup marker in `.dsh-open-market.json` and user preferences in `.dsh-open-market-user.json` within the profile. DSH fetches the index. The plugin requests likes from `dshopen.org` (turn off **Join likes** to stop them), plugin icons, the site mark and the maintainer's GitHub avatar. Opening details reads the site's selected screenshots or the public GitHub README; expanding release notes reads a matching GitHub release, CHANGELOG or fixed-commit comparison. Expanding Other versions reads npm metadata from the selected registry. These public metadata requests omit browser credentials. Favorites and settings live in the profile with a browser cache; catalog and version caches stay in this browser.

- 每个 profile 自动打开一次「插件 → 实验性插件 → 自定义插件市场」，DSH 在下次启动时生效。之后手动关掉，插件不会再打开。
- 每个 profile 只添加一次索引源，追加在已有索引源之后，不会重复；删掉后不会被加回来，除非把插件关掉再打开。
- 在「插件」页增加「开放市场」标签：搜索支持分类与同义词，下面有今日推荐、按热度及增长排列的推荐行和可排序的全部插件。搜索框旁的「我已安装」列出收录插件及其更新。收藏支持分组、按包名加入插件、整组启停和导入导出。新安装走 DSH 的安装对话框，更新和切换版本由宿主完成，替换失败时尝试恢复原版本。
- 每个插件每天可以点赞一次，安装也算一次点赞；点赞每 3 天减少 1，并影响今日推荐。
- **新对话自动使用「自动审查」**（默认关闭，在设置里或「已安装」中本插件的第二个组件开关）：每个新对话开始时自动切换到 DSH 实验性的「自动审查」权限，不用每次手动选择、再确认两次。DSH 没开「自动审查」时会一并打开，可能需要重启生效。恢复的对话、分叉和子代理保持各自的权限。
- 打开市场时先显示本机保存的数据，每 6 小时在后台更新一次；更新失败时继续显示已有数据。设置里的「同步最新数据」可以马上更新。
- 详情里的**其他版本**只在展开后读取 npm 版本元数据，并在本机缓存一小时。按发布时间列出版本，显示预发布标记和作者声明的 DSH 兼容范围，排除已弃用或未声明 bundle 的版本；每行可安装或复制精确版本的命令。其他 npm 版本未经过本站审查，安装时由 DSH 检查所选包。切换已安装版本会和「更新」一样先卸载旧版。Git 来源只展示索引已有的固定提交，不查询同名 npm 包或 Git 标签。
- 开放市场自更新通过当前 DSH 的身份验证交给宿主完成，市场页面暂时关闭也会继续，独立提示显示结果。卸载前必须确认原安装来源；替换失败时尝试恢复旧版，恢复也失败时可从「插件」页重新安装。旧版本需先通过「插件」页或安装命令更新到本版。
- 设置入口在开放市场「我已安装」右侧的齿轮，也在「已安装」里本插件的详情页中，两处内容相同，分为显示、数据与同步、下载、对话和关于。「从哪个源下载」决定在这个标签页里安装和更新 npm 插件时用哪个源（npm 官方源、跟随 DSH、中国大陆镜像源或自定义地址）；Git 来源的插件和 DSH 自己的「发现」页不受影响。
- **马卡龙主题**（设置 → 显示，默认关闭）：沿用 [dshopen.org](https://dshopen.org/zh/) 网站的风格，鲸鱼女仆只出现在空白处（新对话页、侧边栏底部、开放市场顶部和空状态）。覆盖侧边栏、会话列表、消息、输入框、按钮、输入控件、菜单、对话框、标签页、设置、代码块、滚动条和开放市场标签；跟随 DSH 的浅色或深色外观，深色下使用对应的夜海配色。文字对比度达到 WCAG AA 或高于 DSH 默认值，焦点框保持可见，描边用阴影绘制，不改变任何元素尺寸。主题通过 DSH 自带的颜色变量和少量限定作用域的样式实现，关闭后立即全部移除，无需重新加载；选择和其他设置一样保存在 profile 中。样式表和插画由宿主从插件包内提供，路径为 `/dsh-open-market/theme/`。
- **在侧边栏显示开放市场**会增加一个独立的全宽页面。「插件」页有开放市场标签时默认关闭，没有时默认打开。DSH 没有市场服务时，这个页面会自己读取 `dshopen.org/index.json`。从这里安装不弹 DSH 的安装窗口，需要确认安装脚本的插件请到「插件」页安装。
- 「自定义插件市场」服务就绪后才显示市场标签，服务关闭或暂未启动时不会阻塞 DSH 启动。
- 想恢复时输入 `/open-market`，会重新加入索引源，并在需要时打开自定义插件市场。
- profile 目录中的 `.dsh-open-market.json` 保存初始化标记，`.dsh-open-market-user.json` 保存用户偏好；索引由 DSH 读取。插件会请求 `dshopen.org` 的点赞数据、插件图标和站点标志，以及 GitHub 上的维护者头像，关闭「参与点赞」后不再发送点赞请求。打开详情时才读取本站选定的截图或公开 GitHub README，展开更新说明才读取对应版本的 GitHub Release、CHANGELOG 或固定提交差异；展开其他版本才向所选 npm 源读取元数据。这些公开元数据请求不带浏览器登录凭据。收藏和设置保存在 profile 中，并在浏览器缓存；目录和版本缓存保留在当前浏览器。

To use a mirror, override the row in your profile's `cordis.patch.yml`:

```yaml
- id: open-market
  name: dsh-open-market
  config:
    indexUrl: https://example.com/index.json
```

## Artwork / 插画

The whale-maid poses in `theme/` (`whale-maid-wave`, `whale-maid-tea`, `whale-maid-peek`) were generated with OpenAI's GPT image model through Codex, using the dshopen.org whale-maid logo as the character reference, then trimmed and converted to WebP. Full-size PNGs stay in `theme/originals/` and are not published to npm.

`theme/` 中的鲸鱼女仆姿势（挥手、喝茶、探头）由 Codex 调用 OpenAI GPT 图像模型生成，以 dshopen.org 的鲸鱼女仆标志为角色参考，之后裁边并转为 WebP。原尺寸 PNG 保留在 `theme/originals/`，不随 npm 包发布。

GPL-3.0
