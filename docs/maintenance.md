# Maintenance

[简体中文](maintenance.zh-CN.md)

## Usage stats

*Index usage* counts every time DSH loads this market from dshopen.org, which happens when Discover opens or refreshes (DSH caches it for about ten minutes). *Usage today* is today's share. Readers are deduplicated per day with a salted hash of IP and user agent; IPs are never stored. Details live in [stats.json](https://dshopen.org/stats.json). Only dshopen.org is counted; the earlier github.io endpoint has no usage statistics.

## Directory structure

```text
data/       sources.json listings and publishers.json identities
scripts/    Index, metrics, recommendation, and website generators
packages/   The dsh-open-market plugin
site/       Website styles and branding
public/     Build output for dshopen.org and GitHub Pages
cloudflare/ The dshopen.org Worker for static files and usage stats
docs/       Maintenance notes, metrics, and review records
test/       Unit tests and browser tests
```

## Build and test

Requires Node.js 24+ and pnpm 11.

Use this workflow for routine additions, pinned-version upgrades, and maintenance fixes:

1. Locally check only the changed entries: source, version, archive hash, manifest, patch and entry files, license, and withdrawal status. For batch additions, use `preview-submissions.mjs` below to download only the submitted archives. For script or website changes, run the relevant targeted checks or local preview.
2. Review `git diff` and run `git diff --check`, then commit and push the source configuration, copy, and required review evidence. Local submissions do not require downloading the full catalog, refreshing all metrics, rebuilding the index, or updating `public/` snapshots.
3. Let the **Check and publish index** GitHub Actions workflow run the full unit tests, build, official format validation, and browser tests. Pull requests run checks. Passing builds on `main` publish the generated artifacts.
4. If CI fails, inspect the Actions log, fix the affected entry or code, and push the correction for Actions to verify again.

The commands below document the full Actions checks. They are not local pre-commit requirements:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm validate
pnpm exec playwright install --with-deps chromium
pnpm test:browser
```

To reproduce a browser test failure locally, set `BROWSER_EXECUTABLE` to an existing Chrome or Chromium executable to skip the browser download. Browser tests start and stop their own localhost preview server.

- `data/sources.json`: package list, translations and categories.
- `scripts/lib.mjs`: registry and archive checks, compatibility ranges, index generation.
- `scripts/site.mjs` and `site/`: the website in English (`/`), Simplified Chinese (`/zh/`) and Traditional Chinese (`/zh-tw/`). Each language has a home page, a usage stats page (`stats/`) and one page per plugin (`plugins/<package>/`). Traditional Chinese is generated from the Simplified pages with OpenCC's Taiwan phrasing; DSH menu names wrapped in `ui()` keep their Simplified wording because DSH itself shows them that way. Plugin pages are rebuilt on every build and are not committed.
- `public/index.json`: DSH format-1 index.
- `public/status.json`: generation time and package-check evidence.

Use `pnpm build:site` for website-only changes and `pnpm preview` to open the result at `http://127.0.0.1:4173/dsh-plugin-index/`.

## Updates

Keep acceptance replies to one short, friendly sentence: `感谢！将在下个提交后收录 😊` for Chinese-speaking developers, or `Thanks! It'll be added in the next commit 😊` for other developers. Vary the smiling emoji. Reply and close accepted issues as authorized by the maintainer.

For a batch review, record `schema: 1` and `entries: [{issue, name, replyLanguage, reply}]` in a JSON file. Run `node scripts/preview-submissions.mjs <review.json>` to inspect only those release archives and write the index, evidence, and reply preview under `.local/submission-preview/`. It does not install plugins, change public snapshots, or post comments.

The generator follows npm `latest` and rebuilds every six hours, unless an entry pins `version`. Repository reviews and large-archive budgets pin a version; `pnpm check:pins` lists pinned entries that npm `latest` has passed, which need a fresh review before upgrading. It reads up to four sources concurrently and retries temporary network errors. npm downloads are limited to the public npm registry; pinned Git sources use the GitHub commit archives described below. Reviewed repository artwork uses a separate icon boundary. Third-party package code is never executed. All sources and the official format validator must pass before the build can publish.

The build lists one version per package. DSH reads compatibility from `engines.dsh`, or from the intersection of DSH peer dependencies when that field is absent. Missing constraints mean the author supplied no range; they do not prove compatibility.

Archive checks also verify client entries. Runtime files declared by `exports["./client"]` must be present; conditional exports and wildcard mappings are supported, while `types` branches are skipped. Legacy packages declaring `dsh.client` without `exports` must provide the `client` subpath. A package that blocks that subpath or omits its runtime file is rejected. Evidence lists the files in `clientEntries` and records `client-entry-present`. Submission previews and Actions builds share this check; it does not install or execute plugins.

Full builds read the last published `index.json` and `status.json`, so one failing package no longer blocks the catalog. Timeouts, network errors, HTTP 429/5xx or a new release over the archive limits keep the last published release and icon; an unpublished, deprecated, taken-down or mismatched package is left out. Both cases go to `failures` in `status.json` with the time the failure started, and the build log shows a warning. More than 10 failures or 5% of the catalog at once still stops the build as a systemic problem.

After each main-branch build, the `maintenance` job runs `node scripts/check-pins.mjs --issue`. It keeps one issue, "Index maintenance: pinned entries and failing packages", listing failing packages and pins that fell behind upstream (npm releases and Git sources), marks failures older than seven days as **[long]**, and closes the issue once nothing is left. Withdrawn or abandoned plugins are still removed by editing the source list.

On a build failure, inspect the Actions log, fix the source or connection, and rerun.

## Reviewed repository metadata

If a published package omits `repository`, maintainers may add `repositoryReview` only after matching that exact npm archive to an upstream release. The source entry must pin `version`; the review records the same version, npm SHA-512 integrity, canonical GitHub URL and immutable source commit. A version/hash mismatch or a conflicting published repository stops the build. `status.json` distinguishes `repositorySource: "review"` from `"package"` and links the reviewed source manifest. Updates to reviewed packages require a new review; they do not follow `latest` automatically.

[Taskboard provenance](reviews/taskboard-review.md) documents the first such entry, including the matching npm/release-asset digest.

## Reviewed archive budgets

Ordinary downloads have a 30-second deadline and archives a 100 MiB decoded-byte limit. A large package can declare `archiveReview` only with a pinned version and matching npm integrity. It may use at most 120 seconds per attempt and 256 MiB. Downloads make at most three attempts in total. Compressed downloads remain capped at 64 MiB; package manifests and individual tar metadata records at 1 MiB; all tar headers, including PAX/GNU records, at 20,000. Decoded-byte limits include headers, metadata, padding and trailing data. The parser retains the manifest, file names and bounded display files, discards other content and never extracts to disk. `status.json` reports both declared payload bytes (`unpackedBytes`) and the complete tar stream (`decodedBytes`) under each package's `archive` record.

[Univer Office archive review](reviews/univer-archive-review.md) records the measured package and its budget. A changed version or integrity requires a new review.

## Plugin icons and localization

The build reads the SHA-512-verified package's `icon` field or exported `./icon`: SVG, PNG, JPEG or WebP, up to 256 KiB. Original artwork is stored under content-addressed paths in `public/icons/`. The official `icon` field is relative to the index URL, so DSH and the website use the same image. Missing, oversized and unsupported icons appear in `status.json` under `display.warnings`; the website falls back to an initial.

Maintainers may explicitly select artwork from the published manifest's GitHub repository with `iconReview: {commit, path, sha256, normalization?}`. Without `version` and `integrity` the entry keeps following npm `latest`: every build re-checks that the current release still declares the same GitHub repository, while the commit and hash pin the artwork. To bind the review to one archive, add `version` and `integrity` and pin the entry's `version`. `commit` is a full 40-character lowercase SHA, `path` names artwork relative to the repository root, and `sha256` identifies its original bytes. The build constructs an immutable `raw.githubusercontent.com` URL from that published repository and commit. It accepts no custom URL, redirects, path traversal, active SVG content or external image resources, and applies the same 256 KiB limit and image checks as package artwork. A mismatched review fails the build. An explicit review takes precedence over an available package icon; `display.publishedIcon` preserves the package icon evidence, while `display.icon` records `source: "reviewed-repository"`, the immutable source URL, original hash and review. This exception does not change the npm download allowlist.

Only `normalization: "remove-xml-comments"` permits removing XML comments from reviewed SVG bytes. Without it, the original bytes are preserved. The original hash is checked before normalization; the published asset path and final `sha256` use the resulting bytes. Version or integrity changes require a fresh review. Builds never read artwork from local review pages or research folders.

Author metadata comes from `locale/en.json` and Chinese files in that directory. Editorial text in `data/sources.json` takes precedence. Archive inspection retains only these bounded display files in addition to the manifest and file names; it neither extracts nor executes plugins. SVG artwork must contain no external resources or active content.

Set `DSH_INDEX_PREVIEW_PORT` for both the preview server and browser checks when the default local port is occupied.

## GitHub stars

Use `pnpm build:metadata` to refresh metrics, the market title and identity labels while preserving validated package versions and their original check timestamps. GitHub Actions runs a full build when the allowlist or a pinned version changes. `publishers.json` records identity evidence; `public/downloads.json` and `public/display.json` record download readings and DSH row text. See [market metrics and identity labels](market-display.md) for definitions and client limits.

Each build reads the public GitHub API once per unique repository and writes `public/github.json`. It records the exact star count, fetch time and last push time. Counts also populate the official index's `github-stars` sort key, so DSH can sort by stars.

GitHub Actions supplies a read-only `GITHUB_TOKEN`. Local builds can use `GITHUB_TOKEN` or `GH_TOKEN`; without either, GitHub's anonymous rate limit applies. Tokens are used only for requests to `api.github.com` and are never written to snapshots. The browser does not request the GitHub API.

If GitHub is unavailable, a verified snapshot up to seven days old is kept with its original timestamp and marked `stale`. Older or missing counts become `unavailable`, not zero. Non-GitHub repositories have no GitHub star count. Actions preserves `.cache/github.json` between builds; the checked-in public snapshot is a fallback. Stars describe repository popularity, not test coverage or plugin quality.

## GitHub Pages

1. In **Settings → Pages**, select **GitHub Actions**.
2. Set the repository variable `PUBLISH_INDEX=true`.
3. Run **Check and publish index** on `main`.

The workflow runs unit tests, builds the catalog, checks all three website languages, plugin pages and the stats page in Chromium and validates the official format before uploading the Pages artifact. After deployment it checks the complete source allowlist, package evidence, the three language pages and a plugin page in each, every referenced icon hash and the project branding assets. All requests reject redirects. Pull requests never deploy.

The build job uses the official Playwright container based on Ubuntu 24.04, with browsers, runtime libraries and fonts already installed. This removes the apt and browser CDN installation steps from each run. Full package checks and browser tests still run. Keep the container tag in `.github/workflows/publish.yml` aligned with the `@playwright/test` version in `package.json` when upgrading.

Scheduled runs are set to every six hours; GitHub may delay or suspend schedules in inactive repositories. The timestamp in the live `status.json` is the source of truth. Scheduled artifacts are deployed directly and do not create repository commits; a checked-in snapshot changes only when a maintainer includes it in a commit.

Pushes and pull requests that change only `README*.md`, `docs/`, or top-level Markdown files in `.github/` skip the full build and deployment. Scheduled and manual runs still execute. A commit that also changes listings, scripts, website assets, or workflows runs the full pipeline.

The public endpoint must return 200 JSON without redirects:

```sh
node scripts/validate.mjs https://polang233.github.io/dsh-plugin-index/index.json
pnpm check:published
```

DSH caches a successful index for ten minutes. If a custom domain is added later, update the site URL, canonical metadata, sitemap, copy target and documentation together, then verify the final JSON URL.

## Package checks

Each listed release is checked for SHA-512 integrity, matching name and version, bundle patch files and any declared `main` file. The generator records the repository, declared license and installation lifecycle script names. It does not inspect all patch references, resolve all dependencies, run an installation or audit the code.

The validator is pinned to `@deepseek-ai/dsh-plugin-market-index@0.2.1-rc.2`. When updating it, rerun tests and verify the index in the target DSH release. The official [format guide](https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market) and [reference generator](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/plugin-market-generator) describe the protocol.

## dshopen.org (Cloudflare)

The Worker in `cloudflare/` serves `public/` as static assets and counts reads of `index.json` in the `dshopen-stats` D1 database; see `https://dshopen.org/stats.json`. GitHub Pages stays up for the earlier address. CI uploads and promotes a new version after each build when the `CLOUDFLARE_API_TOKEN` secret is set, leaving the domain binding alone; otherwise run `pnpm build` and `npx wrangler deploy --config cloudflare/wrangler.jsonc`. Post-deploy checks send the `dshopen-check` user agent and are not counted.

`stats.json` also reports each day's reads and readers by Cloudflare's two-letter country or region code (`countries`), which the stats page groups into UN geographic regions and names in UN style (for example "Hong Kong SAR, China"). The `countries` table must exist before country data appears; the Worker keeps counting totals without it. Create it once, and again after any change to `cloudflare/schema.sql`:

```sh
npx wrangler d1 execute dshopen-stats --remote --file cloudflare/schema.sql
```

With an analytics token the country split comes from Cloudflare's own traffic analytics instead, covering the last 30 days from the start: loads of `/index.json` by country, sampled, cached for an hour. People counts always stay in D1. Create a custom API token with **Zone → Analytics → Read** for the `dshopen.org` zone only, copy the zone ID from the zone's Overview page, and store both as Worker secrets (they carry over to the versions CI uploads):

```sh
npx wrangler secret put CF_ANALYTICS_TOKEN --config cloudflare/wrangler.jsonc
npx wrangler secret put CF_ZONE_ID --config cloudflare/wrangler.jsonc
```

`stats.json` then reports `countries.source: "cloudflare"` and `metric: "reads"`. If the query fails, the Worker logs the error and falls back to its own D1 split (`source: "d1"`, `metric: "readers"`).

## Likes

The Worker also serves likes for the Open Market tab of the `dsh-open-market` plugin:

- `GET /likes.json`: each plugin's current likes after decay, listing only those above zero; cached for 60 seconds.
- `POST /api/like`: body `{name, source}`, where `source` is `like` or `install` (an install counts as a like).

Each person likes a plugin at most once a day, and a like and an install share that once; each person has at most 100 a day. A person is the day's salted hash of IP and user agent, neither of which is stored. From its first like, each plugin loses one like every full three days, never below zero, settled lazily by date on reads and writes. Names missing from the current `index.json` are refused. The `likes` table and the daily `like_votes` table are in `cloudflare/schema.sql`; run the `d1 execute` above before deploying. The plugin has a setting to opt out of likes, which stops both requests.


`sitemap.xml` lists every page in all three languages with `hreflang` alternates (`zh-TW` and `zh-HK` point to the Traditional pages). Submit `https://dshopen.org/sitemap.xml` once in Google Search Console and Bing Webmaster Tools; both pick up later changes on their own.

## Images

Full-size originals live in `site/originals/` and `docs/images/originals/`; the site and README load lossless WebP copies scaled to display size. After changing an original, run `node scripts/optimize-images.mjs` (needs `sharp`, e.g. `npm i --no-save sharp`).

`site/originals/logo.png` is the brand master. `node scripts/optimize-images.mjs logo` exports the 720px lossless WebP, 256px PNG, 180px Apple touch icon, 96px favicon, an ICO with 16/32/48px frames and the matching DSH package icon. It also crops the character's head for the directory's 192px fallback avatar, `placeholder-whale.webp`. Originals and exports with an `-old` suffix are retained as backups and skipped by the optimizer.

After replacing the logo, refresh the README home and catalog screenshots in English and Simplified Chinese, plus the three 1200×630 sharing cards (English, Simplified and Traditional Chinese), from the local pages. The capture script needs Playwright Chromium, or a browser path in `BROWSER_EXECUTABLE`, plus `sharp` or `SHARP_PATH`:

```sh
pnpm build:site
node scripts/capture-brand-images.mjs
node scripts/optimize-images.mjs home-en home-zh catalog-en catalog-zh
pnpm build:site
```

## Pinned Git sources

Maintainer-approved Git entries pin `version` and declare `source: {type: "git", url, commit, integrity, publishedAt}`. The source must be a canonical GitHub repository URL with a full commit SHA, SHA-512 of that commit archive, and a release date. The repository root must contain the complete installable package. The generator downloads from `codeload.github.com` without redirects and applies the existing archive limits, identity, patch and entry-point checks. DSH installs the root package at that commit through the official Git source type. Git entries have no npm download or release-activity data. Updating requires reviewing the new commit and archive hash. No installation or lifecycle scripts run during generation.

## Author withdrawals

Authors ask for removal through a `[plugin-remove]` issue. After confirming the requester maintains the npm package or owns the source repository, delete the entry from `data/sources.json` and record `{name, repository, requestedBy, requestedAt, request}` in `data/withdrawn.json`, where `request` links to the request. GitHub Actions regenerates `public/` after the push.

`pnpm build` and `preview-submissions.mjs` fail when a withdrawn package is listed. `review-candidates.mjs` records withdrawn candidates with `stage: "withdrawn"` and skips downloading them, and a unit test checks that the source list contains none. Remove a record from the withdrawn list only when the author asks to relist.

## Listing dates

`public/added.json` records the first UTC day each plugin entered the index; the website's *Recently updated* order uses the later of the release date and this listing date, so new listings rise to the top too. Full builds prefer the deployed GitHub Pages record and fall back to the local snapshot, keep existing dates and stamp new packages with the build day. A package removed and listed again counts from its new listing. Dates before 2026-10-19 come from the Git history of `data/sources.json`, so the initial import shares one date.

## Daily recommendation rotation

`public/recommendations.json` ships with the index and stores weekly candidate pools and fourteen days of front-page exposure. Full builds and metadata refreshes prefer the deployed GitHub Pages state, with the local public snapshot as fallback. Unpublished state is not saved to the CI cache. See [recommendation rules](market-display.md). `pnpm build:recommendations` reorders already checked local versions offline; GitHub Actions builds new sources and versions in full. `pnpm preview:recommendations` writes a fourteen-day preview to `.local/recommendation-preview.json`.

## Editorial copy and product names

`data/sources.json` owns display names and bilingual descriptions. `data/brand-names.json` records reviewed product names; builds check that both display titles retain them. Author-provided Chinese aliases may appear alongside the original name. See the [2026-10-20 copy review](reviews/localization-2026-10-20.md).

`pnpm build:copy` refreshes the existing index, display snapshot and bilingual pages offline. It retains package versions, validation timestamps, metrics, ranks and exposure history. GitHub Actions builds new entries that are absent from the checked snapshot. Structured reviews can be replayed with `node scripts/apply-copy-review.mjs docs/reviews/localization-2026-10-20.json`; already-applied edits are skipped, and conflicting copy requires another review.
