# Maintainer review evidence / 维护者审查依据

The [review ledger](../../data/maintainer-reviews.json) lists each accepted package, exact version, archive SHA-512, repository, source, review date and scope. Git entries also identify the reviewed commit and, when applicable, package directory. The market applies its Reviewed label only when the current package matches that evidence.

`package` means the release received package and metadata checks. `static-security` also means the maintainer inspected the published code and corresponding source for relevant security boundaries. Reviews are scoped to the recorded release; they do not guarantee that a plugin, its dependencies or later releases are safe.

The ledger is the public summary. Detailed working notes, submission correspondence and archived review material are kept locally by the maintainer.

The same rules apply to `dsh-open-market` itself. Versions 0.3.0 and 0.3.1 received release-bound static reviews on 2026-11-04. The published bytes must match the recorded archive hash; later versions need their own review evidence.

本站的[审查清单](../../data/maintainer-reviews.json)记录通过项的包名、精确版本、归档 SHA-512、仓库、来源、日期和范围；Git 来源还记录提交及使用的子目录。只有当前发布包与这些信息匹配时，市场才授予本站的「已审查」标签。

`package` 表示完成包结构和元数据核查；`static-security` 表示还检查了发布代码及对应源码的相关安全边界。审查只针对记录的版本，不能保证插件、依赖或后续版本绝对安全。

审查清单是公开摘要；详细工作记录、投稿往来和历史检查材料由维护者保存在本地。

`dsh-open-market` 自身也遵循相同规则。2026-11-04 对 0.3.0 和 0.3.1 完成了绑定版本的静态复核。发布包字节必须与记录中的归档哈希匹配；后续版本需单独审查。
