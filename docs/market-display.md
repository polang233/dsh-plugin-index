# 指标、标签与推荐 / Metrics, labels and recommendations

## 列表里显示什么

每行介绍前显示 GitHub star：`★ 1,138 │ 插件介绍`。名称旁是 DSH 原生标签，全部来自下表这一组固定 id，筛选菜单不会随下载量变化而膨胀：

| 标签 id | 中文 / English | 条件 |
| --- | --- | --- |
| `verified` | ✅ 已审查 / Reviewed | 本站对当前版本的审查记录匹配，或有下列其他市场的审查依据 |
| `trending` | 🔥 增长快 / Rising | 近 7 天下载 ≥ 30 且达到此前周均值的 1.5 倍；或近 7 天新增 star ≥ 5 且增幅 ≥ 10% |
| `active` | ⚡ 更新勤 / Frequent updates | 近 30 天发版 ≥ 10 次（约前三分之一） |
| `updated-recent` / `-week` / `-month` / `-quarter` | ◷ 最近 / 本周 / 本月 / 三个月内更新 | 收录版本发布于 3 / 7 / 30 / 90 天内 |
| `downloads-100k` … `downloads-100` | ↓ 10万+ / 5万+ / 1万+ / 5000+ / 1000+ / 500+ / 100+ | npm 近 30 天下载量档位 |
| `publisher-*` | 官方身份 | 经核查的发布者，见 `data/publishers.json` |

精确数值保存在 `downloads.json`、`github.json` 和 `display.json`（含每个插件的 `signals`），并写入排序键。数据暂时取不到时沿用最近一次读数，标签里不出现缓存日期。

## 排序

DSH 的排序菜单固定包含「默认排序」和「发布时间」，索引无法去掉；索引声明的排序项按标题的本地化排序规则排在后面。标题开头的符号决定了实际顺序：⊙、▲、★、⚄。

- **默认排序**（DSH 打开时的顺序，即索引顺序）：每周建立 280 个插件的候选池，每 6 小时从中轮换 10 个上首页（一天 4 轮，一周 28 轮，正好覆盖整个候选池）。同一周展示过的前十会移到尚未展示的候选后面。每周的候选池至少 40% 来自上周不在池里的插件，其余按「60% 质量评分 + 40% 周随机数」排序，所以下周不会还是同一批，同时高质量插件仍更容易入选；新一周的第一轮还会避开上一轮的前十。
- **⊙ 智能推荐**：照顾新人。前十里的第 2、5、8 位留给近 10 天新收录的插件，不要求下载量或 star，归档仓库除外；每位新人一周只占一次位置，没有合适的新人时由普通候选补位。其余 7 位先从质量排序前 560 个合格插件中选出每周的 280 个候选，同样保证 40% 换新，再每 6 小时轮换。周内不重复，跨周重新组合。每轮混排以随机性为主，保留 20% 的综合评分权重，略偏向最近维护、最近发布、下载与 star 增长；同一作者和分类仍会分散展示。标题带 ⊙，排在自定义排序项的第一位。
- **▲ 近期增长**：按近 7 天新增 star 排序，需要至少 6 天的 star 历史。
- **★ 星数最多**：按 GitHub star 总数排序。
- **⚄ 随机资源**：独立于推荐评分，按日重新打乱全部插件。网站和 DSH 使用同一组随机排序值，同一天刷新、切换排序或多次构建不会反复变动。

### 候选门槛与权重

候选需满足至少一项：经过本站或其他市场审查、npm 近 30 天下载量 ≥ 300、GitHub star ≥ 5。归档仓库不进入推荐池，在默认排序和智能推荐中沉底。没有指标基础的插件保留在完整目录和随机资源中，不会仅凭随机数进入首屏候选。

默认候选的质量评分继续参考下载量 32%、star 28%、有 Logo 15%、经过验证 10%（只被大列表收录记 5%）、近期维护 10%。这些权重用于选择候选，首页展示机会则由每轮轮换决定。同一作者的多个插件会降权，分散曝光。

智能推荐的综合评分参考近期维护 25%、最近发布 7%、下载增长 12%、star 增长 10%、发版频率 8%、新上架 7%、经过验证 8%、下载量 10%、star 8%；每轮混排只保留这个分数的 20%。每周候选选择也使用独立的周随机数和 20% 综合分数。随机资源不使用这些权重。

### 日期与曝光记录

按 `Asia/Taipei` 时间计算，每天分成 00、06、12、18 点开始的四轮，周一开启新一周。定时构建计划在当地 00:17、06:17、12:17、18:17 运行，新排序在该轮第一次成功构建并部署后生效。GitHub 调度可能延迟：迟到的构建落在哪一轮就用哪一轮，没跑到的轮次会跳过；构建失败时继续提供上一版。

`recommendations.json` 保存本周的两个候选池、当前轮次和最近 14 天每轮实际生成的前十名单。收录日期来自 `added.json`，新人不进候选池，只记录在前十名单里，其曝光同样计入周内不重复。完整构建和指标刷新都读取上一次已发布的记录，本地 `public/` 快照作为读取失败时的备用。PR、构建失败或部署失败不会提前消耗下一批曝光机会；同一轮重跑保留该轮名单，移除或归档的插件除外。

池中不足 280 个合格插件时，先展示本周未出现过的，再按最早曝光时间回补。小目录不足十个合格插件时，其余条目维持基础排序；记录仍对应实际前十，不会漏掉或重复目录条目。

`pnpm build:recommendations` 可离线重排已校验的本地快照并重建网站，不重新读取所有 npm 发布包，也不添加新来源或升级版本。`pnpm preview:recommendations` 用真实目录生成 8 天共 32 轮的轮换预览，写入 `.local/recommendation-preview.json`，不改公开文件。

## 验证来源

本站记录保存在 `data/maintainer-reviews.json`，绑定包名、仓库、精确版本、SHA-512 与来源类型；Git 版本还绑定完整提交和使用的子目录。构建时必须与实际归档检查证据相符才授予 `verified`。npm `latest` 更新、归档哈希变化或更换仓库后，旧记录不再适用，不为保留标签而锁定自动更新。

`scope: package` 表示早期包结构、来源及许可核查；`scope: static-security` 表示增加静态安全审查后的通过版本。网站标签提示和插件详情显示本站的范围、版本、日期及记录链接，`display.json` 的 `signals.verifiedBy` 保留审查方，`signals.maintainerReview` 保存本站依据。历史核查不能改写为完整安全审计，标签也不保证绝对安全。暂缓、缺少证据和已确认有未解决问题的版本不授予本站标签。

| 来源 | 作用 | 匹配方式 |
| --- | --- | --- |
| 本站人工复核记录 | 「已审查」标签 | 包名、仓库、版本、归档哈希与来源全部匹配；保留具体核查范围 |
| [awesome-deepseek-harness-plugins](https://github.com/walkinglabs/awesome-deepseek-harness-plugins) | 「已审查」标签 | 源码级 DSH 插件验证加静态安全检查后才收录；按 GitHub 仓库匹配 |
| [dsh-plugin-shop](https://github.com/LivXue/dsh-plugin-shop) `registry/verified.yml` | 「已审查」标签 | 人工审核；绑定仓库或精确的 npm 版本 |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | 只影响排序 | 审核后收录，但覆盖了本索引六成以上的插件，单独作为标签区分度不够 |

外部快照保存在 `endorsements.json`，读取失败时沿用 14 天内的上一次结果。外部来源仅代表对方的审核，不转为本站审查记录。

## 来源

| 指标 | 来源 |
| --- | --- |
| ★ star、最近推送、star 增长 | GitHub 公开 API，同一仓库的多个包共享；每天记录一次 star，保留 35 天 |
| ↓ 下载量、增长 | [npm downloads range API](https://github.com/npm/registry/blob/main/docs/download-counts.md) `last-month` 的逐日数据 |
| 发版频率、首次发布 | npm registry 的 `time` 字段 |

npm 下载量包含 CI 和镜像等自动请求，只能反映趋势，不等于 DSH 用户数。

---

**English.** Rows show `★ stars │ description` plus a fixed set of native labels: Reviewed, Rising (downloads or stars), Frequent updates, four update-age buckets, seven download tiers, and verified publishers. The *Default* order rotates ten entries every six hours from a weekly pool of 280 qualified plugins; at least 40% of each pool was not in the last one and the rest is ranked 60% by quality, 40% by a weekly random draw. *⊙ Smart picks* looks after newcomers: places 2, 5 and 8 of its front page go to non-archived plugins listed in the last ten days, each once a week. The other seven come from its own 280-entry pool of the top 560 quality candidates, with mostly random ordering each round and a 20% momentum/quality score. *▲ Recent growth* sorts by new stars in the last seven days and *★ Most stars* by total GitHub stars. Entries do not repeat within a week; a new week reshuffles the pools while avoiding yesterday's front page. Daily *⚄ Random resources* use the same published ranks on the website and in DSH. Dates use Asia/Taipei. Pools and fourteen days of per-round exposure history live in `recommendations.json`. Exact readings live in `downloads.json`, `github.json` and `display.json`. Fallback readings never add cache dates to labels.

Local maintainer reviews bind the exact package, repository, version, SHA-512 and source commit for Git releases. Historical package checks and static security reviews keep separate scopes. A changed release loses its local badge until reviewed again; external endorsements keep their own attribution.
