# dsh-open-market

Brings [Open Plugin Market](https://dshopen.org/) into DeepSeek Harness. This community plugin index puts fast-growing, actively maintained and newly published plugins first, so small developers get seen.

把开放插件市场加入 DeepSeek Harness 的「发现」。推荐偏向近期增长快、更新勤、刚上架的插件，让小开发者也能被看到。

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
- Adds an **Open Market** tab to the Plugins page: a search over the whole catalog, a rotating row of today's picks, scrolling rows of most liked, recommended, fast-growing and newly published plugins (the last three never repeat a plugin), and a grid of the whole catalog, which you can sort by recommended, most liked, fastest growing, most stars or newest, from the buttons or the side arrows. Beside the search, Installed lists your plugins from this index with their updates, and a favorites list keeps plugins without installing them: sort them into groups, add any package by name, enable or disable a whole group at once, and import or export the list. Installing goes through DSH's own install dialog. DSH cannot install over an installed plugin, so **Update** removes the current version first and then opens the install for the new one, as DSH's own Update for official plugins does.
- You can like a plugin once a day, and installing one counts as a like. Likes lose one every three days and weigh today's picks.
- **Start new conversations in Auto review** (off by default; in the settings, or the second row of this plugin under Installed): every new conversation switches to DSH's experimental Auto review permission when it starts, so you no longer pick and confirm it each time. Auto review is switched on too if it was off, which may need a restart. Restored conversations, forks and subagents keep their own permission.
- The market opens with the data saved on this computer and updates in the background every six hours; a failed update leaves the saved data on screen. **Sync latest data** in the settings updates it right away.
- Settings: the gear beside Installed on the Open Market tab, or the plugin's page under Installed. Both show the same groups: display, data and sync, downloads, conversations and links. **Download from** picks the npm registry for installs and updates started in this tab (official, DSH's own choice, the mainland China mirror or a custom address); Git plugins and DSH's Discover tab are not affected.
- **Show Open Market in the sidebar** adds a separate full-width page. It is off by default where the Plugins page has the Open Market tab, and on where it does not. When DSH has no market service, that page reads `dshopen.org/index.json` itself. It installs without DSH's install dialog, so a plugin whose install scripts need approval has to be installed from Plugins.
- The browsing tab appears when Custom plugin markets is available; an unavailable market service does not block DSH startup.
- `/open-market` puts the index back and switches Custom plugin markets on again, for when you change your mind.
- The plugin keeps a small marker file, `.dsh-open-market.json`, in the profile directory. DSH fetches the index. The plugin's own requests are likes (reading `dshopen.org/likes.json` and sending a like, with no account or identifier; turn off **Join likes** in the settings to stop both) and images: plugin icons and the site mark from `dshopen.org`, re-read once to tint each card with its logo colour, and the maintainer's avatar from `github.com` in the footer. Favorites and the saved market data stay in this browser and are never sent anywhere.

- 每个 profile 自动打开一次「插件 → 实验性插件 → 自定义插件市场」，DSH 在下次启动时生效。之后手动关掉，插件不会再打开。
- 每个 profile 只添加一次索引源，追加在已有索引源之后，不会重复；删掉后不会被加回来，除非把插件关掉再打开。
- 在「插件」页增加「开放市场」标签：顶部可以搜索全部插件，下面是自动轮播的今日推荐，最受欢迎、智能推荐、增长最快、最新发布几行横向列表，后三行互不重复，最底下可以展开全部插件，并用按钮或两侧箭头切换推荐、最受欢迎、增长最快、星数最多、最新发布几种排序。搜索框旁的「我已安装」列出从这里装的插件和可用更新；收藏夹可以先收藏插件、不急着安装：可以分组，可以按包名加入任何插件，一键启用或停用整组，也能导入导出。安装走 DSH 自己的安装对话框。DSH 不能覆盖安装已装的插件，所以「更新」会先卸载当前版本，再打开新版本的安装，和 DSH 官方插件的更新方式一样。
- 每个插件每天可以点赞一次，安装也算一次点赞；点赞每 3 天减少 1，并影响今日推荐。
- **新对话自动使用「自动审查」**（默认关闭，在设置里或「已安装」中本插件的第二个组件开关）：每个新对话开始时自动切换到 DSH 实验性的「自动审查」权限，不用每次手动选择、再确认两次。DSH 没开「自动审查」时会一并打开，可能需要重启生效。恢复的对话、分叉和子代理保持各自的权限。
- 打开市场时先显示本机保存的数据，每 6 小时在后台更新一次；更新失败时继续显示已有数据。设置里的「同步最新数据」可以马上更新。
- 设置入口在开放市场「我已安装」右侧的齿轮，也在「已安装」里本插件的详情页中，两处内容相同，分为显示、数据与同步、下载、对话和关于。「从哪个源下载」决定在这个标签页里安装和更新 npm 插件时用哪个源（npm 官方源、跟随 DSH、中国大陆镜像源或自定义地址）；Git 来源的插件和 DSH 自己的「发现」页不受影响。
- **在侧边栏显示开放市场**会增加一个独立的全宽页面。「插件」页有开放市场标签时默认关闭，没有时默认打开。DSH 没有市场服务时，这个页面会自己读取 `dshopen.org/index.json`。从这里安装不弹 DSH 的安装窗口，需要确认安装脚本的插件请到「插件」页安装。
- 「自定义插件市场」服务就绪后才显示市场标签，服务关闭或暂未启动时不会阻塞 DSH 启动。
- 想恢复时输入 `/open-market`，会重新加入索引源，并在需要时打开自定义插件市场。
- 插件在 profile 目录中记录 `.dsh-open-market.json`，索引由 DSH 读取。插件自己发出的请求只有点赞和图片两类：点赞是读取 `dshopen.org/likes.json` 和提交点赞，不带账号或任何标识，在设置里关掉「参与点赞」后两者都不会发送；图片是 `dshopen.org` 上的插件图标和站点标志（图标会再读一次，用来按 logo 颜色给卡片着色），以及页脚里来自 `github.com` 的维护者头像。收藏夹和保存的市场数据只存在本机浏览器里，不会发送到任何地方。

To use a mirror, override the row in your profile's `cordis.patch.yml`:

```yaml
- id: open-market
  name: dsh-open-market
  config:
    indexUrl: https://example.com/index.json
```

GPL-3.0
