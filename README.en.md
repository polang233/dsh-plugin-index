# Open Plugin Market

<img src="site/logo-256.png" alt="Open Plugin Market" width="144" align="right">

In DeepSeek Harness, switch on **Plugins → Experimental plugins → Custom plugin markets**, then go to **Discover → Add index source** and paste:

```text
https://dshopen.org/index.json
```

[![Plugins](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdshopen.org%2Findex.json&query=%24.plugins.length&label=plugins&color=2563eb)](https://dshopen.org/)
[![Index usage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdshopen.org%2Fstats.json&query=%24.total&label=index%20usage&color=16a34a)](https://dshopen.org/stats.json)
[![Usage today](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdshopen.org%2Fstats.json&query=%24.today.reads&label=usage%20today&color=0d9488)](https://dshopen.org/stats.json)
[![Stars](https://img.shields.io/github/stars/polang233/dsh-plugin-index?style=flat&label=stars&color=f59e0b)](https://github.com/polang233/dsh-plugin-index/stargazers)
[![npm](https://img.shields.io/npm/v/dsh-open-market?label=npm&color=2563eb&logo=npm)](https://www.npmjs.com/package/dsh-open-market)
[![Open Plugin Market](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-open-market.json%3Flang%3Den)](https://dshopen.org/plugins/dsh-open-market/)

A community **plugin market index** for DeepSeek Harness (DSH). Add it as an official **index source**, or use the standalone market plugin.

**Stars aren't everything.** The default picks refresh every day and put fast-growing, actively shipped, genuinely good plugins first, with verification, downloads and stars as supporting signals. Established favourites can't hog the list, so new projects and newcomers' plugins get a chance at the first screen and a wider audience.

[Browse plugins](https://dshopen.org/) · [简体中文](README.md) · [Suggest a plugin](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml)

<a href="docs/images/add-index.webp"><img src="docs/images/add-index.webp" alt="Adding the dshopen.org index URL under Discover → Index sources" width="560"></a>

![Open Plugin Market in the DSH Discover tab](docs/images/dsh-discover-en.webp)

## Use it

Pick one:

**Add the source by hand.** Switch on **Custom plugin markets** under **Plugins → Experimental plugins**, then paste `https://dshopen.org/index.json` into **Discover → Add index source**. The earlier `https://polang233.github.io/dsh-plugin-index/index.json` still works.

**Install the plugin.** Run the command below to install [`dsh-open-market`](https://www.npmjs.com/package/dsh-open-market). It switches on Custom plugin markets and adds the source for you once, from the next start of DSH.

```bash
dsh plugin --profile desktop add dsh-open-market
```

The plugin also adds an **Open Market** tab to the Plugins page: a rotating row of today's picks, rows ranked by likes and growth, and a checkup of your installed plugins. Open a card for details, likes and install. Settings and links to the website and repository are on the plugin's page under Installed. Remove the source and it stays removed; `/open-market` brings it back. You can also install it from GitHub: `dsh plugin --profile desktop add "git+https://github.com/polang233/dsh-plugin-index.git#main&path:/packages/dsh-open-market"`.

[![The Open Plugin Market website home](docs/images/home-en.webp)](https://dshopen.org/)

![Open Plugin Market website catalog](docs/images/catalog-en.webp)

## Labels and sorting

✅ Verified · 🔥 Rising · ⚡ Frequent updates (10+ releases in 30 days) · ◷ four update-age buckets · ↓ seven download tiers · ♥ likes from the Open Market tab (once per person, plugin and day, including installs; each plugin loses one every three days). *Default* rotates ten front-page plugins daily from a weekly pool of about seventy qualified entries. *✨ Smart picks* also changes daily, with mostly random rotation and a small preference for recent updates and growth. Entries shown this week move down, and next week reshuffles the pool. *Random resources* reshuffles independently each day. The index rebuilds every six hours; rotation follows calendar days in UTC+8. See [metrics and exposure history](docs/market-display.md).

## Add a badge once you're listed

Once your plugin is listed, add this badge to its README. It carries our mascot, says the plugin is listed with its current likes, and links to the plugin's page here. Likes lose one every three days, and the badge refreshes about every half hour. Replace both `dsh-pet` with your package name (for a scoped name use `@scope/name`, written as `%40scope/name` in the links):

```md
[![Open Plugin Market](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-pet.json%3Flang%3Den)](https://dshopen.org/plugins/dsh-pet/)
```

[![Open Plugin Market](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-pet.json%3Flang%3Den)](https://dshopen.org/plugins/dsh-pet/)

## Submit a plugin

[Open a request](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml). Plugins need public source code, an installable npm release and a declared license. Maintainers may also accept a pinned Git commit; see the [contributing guide](.github/CONTRIBUTING.md). Plugins with their own logo and a complete description are reviewed first.

To take down a plugin, [request removal](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-remove.yml). Removed plugins are recorded in [`data/withdrawn.json`](data/withdrawn.json) and stay out unless the author asks to relist.

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
