<div align="center">

<img src="site/logo-256.png" alt="The Open Plugin Market whale maid" width="180">

# Open Plugin Market

[![Plugins](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdshopen.org%2Findex.json&query=%24.plugins.length&label=plugins&color=2563eb)](https://dshopen.org/)
[![Index usage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdshopen.org%2Fstats.json&query=%24.total&label=index%20usage&color=16a34a)](https://dshopen.org/stats.json)
[![Usage today](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdshopen.org%2Fstats.json&query=%24.today.reads&label=usage%20today&color=7c3aed)](https://dshopen.org/stats.json)
[![Stars](https://img.shields.io/github/stars/polang233/dsh-plugin-index?style=flat&label=stars&color=f59e0b)](https://github.com/polang233/dsh-plugin-index/stargazers)
[![npm](https://img.shields.io/npm/v/dsh-open-market?label=npm&color=0891b2&logo=npm)](https://www.npmjs.com/package/dsh-open-market)
[![Open Plugin Market](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-open-market.json%3Flang%3Den&color=db2777)](https://dshopen.org/plugins/dsh-open-market/)

[Website](https://dshopen.org/) &nbsp;|&nbsp; [Usage stats](https://dshopen.org/stats/) &nbsp;|&nbsp; [Submit a plugin](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml) &nbsp;|&nbsp; [简体中文](README.md)

</div>

A community **plugin market** for DeepSeek Harness (DSH). Add it as an **index source** in the official Discover tab, or install the plugin for a standalone Open Market page inside DSH.

**Stars aren't everything.** The default picks refresh every day and put fast-growing, actively shipped, genuinely good plugins first, with verification, downloads and stars as supporting signals. Established favourites can't hog the list, so new projects and newcomers' plugins get a chance at the first screen and a wider audience.

## Quick start

**Option 1: Add the index source.** switch on **Custom plugin markets** under **Plugins → Experimental plugins**, then go to **Discover → Add index source** and paste:

```text
https://dshopen.org/index.json
```

<p><img src="docs/images/add-index.webp" alt="Adding the dshopen.org index URL under Discover → Index sources" width="49%"> <img src="docs/images/discover-list-en.webp" alt="Browsing Open Plugin Market in Discover after adding it" width="49%"></p>

**Option 2: Install the plugin.** Run the command below; [`dsh-open-market`](https://www.npmjs.com/package/dsh-open-market) switches on Custom plugin markets and adds the index for you, from the next start of DSH.

```bash
dsh plugin --profile desktop add dsh-open-market
```

It also adds an **Open Market** tab to the Plugins page: today's picks and rows ranked by likes and growth. Open a card for details, likes and install.

![The Open Market tab on the DSH Plugins page](docs/images/open-market-en.webp)

[![The Open Plugin Market website home](docs/images/home-en.webp)](https://dshopen.org/)

![Open Plugin Market website catalog](docs/images/catalog-en.webp)

## Labels and sorting

✅ Verified · 🔥 Rising · ⚡ Frequent updates (10+ releases in 30 days) · ◷ four update-age buckets · ↓ seven download tiers · ♥ likes from the Open Market tab (once per person, plugin and day, including installs; each plugin loses one every three days). *Default* rotates ten front-page plugins daily from a weekly pool of about seventy qualified entries. *✨ Smart picks* also changes daily, with mostly random rotation and a small preference for recent updates and growth. Entries shown this week move down, and next week reshuffles the pool. *Random resources* reshuffles independently each day. The index rebuilds every six hours; rotation follows calendar days in UTC+8. See [metrics and exposure history](docs/market-display.md).

## Submit a plugin

[Open a request](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml): plugins need public source code, an installable npm release and a declared license (a pinned Git commit works with maintainer approval; see the [contributing guide](.github/CONTRIBUTING.md)). Plugins with their own logo and a complete description are reviewed first. To take one down, [request removal](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-remove.yml).

Once listed, put the badge in your README. It shows likes and links to your plugin's page here. Replace `dsh-pet` with your package name (`%40scope/name` for a scoped one):

```md
[![Open Plugin Market](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-pet.json%3Flang%3Den)](https://dshopen.org/plugins/dsh-pet/)
```

[![Open Plugin Market](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-pet.json%3Flang%3Den)](https://dshopen.org/plugins/dsh-pet/)

## Spare a star ⭐

A star is the simplest thank-you a developer gets, and it feeds the recommendations here too. If a plugin earns a place in your setup, star its repo. The next star could be someone starring yours.

<a href="https://www.star-history.com/#polang233/dsh-plugin-index&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=polang233/dsh-plugin-index&amp;type=Date&amp;theme=dark">
    <img src="https://api.star-history.com/svg?repos=polang233/dsh-plugin-index&amp;type=Date" alt="GitHub star history for polang233/dsh-plugin-index" width="800">
  </picture>
</a>

[Maintenance](docs/maintenance.md) · [GPL-3.0 license](LICENSE)

Independent community project, not affiliated with DeepSeek. Plugins retain their authors' copyrights and licenses.
