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

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm validate
pnpm exec playwright install chromium
pnpm test:browser
```

For local browser tests, set `BROWSER_EXECUTABLE` to an existing Chrome or Chromium executable to skip the browser download. Browser tests start and stop their own localhost preview server.

- `data/sources.json`: package list, translations and categories.
- `scripts/lib.mjs`: registry and archive checks, compatibility ranges, index generation.
- `scripts/site.mjs` and `site/`: English and Chinese pages.
- `public/index.json`: DSH format-1 index.
- `public/status.json`: generation time and package-check evidence.

Use `pnpm build:site` for website-only changes and `pnpm preview` to open the result at `http://127.0.0.1:4173/dsh-plugin-index/`.

## Updates

Keep acceptance replies to one short, friendly sentence: `感谢！将在下个提交后收录 😊` for Chinese-speaking developers, or `Thanks! It'll be added in the next commit 😊` for other developers. Vary the smiling emoji. Reply and close accepted issues as authorized by the maintainer.

For a batch review, record `schema: 1` and `entries: [{issue, name, replyLanguage, reply}]` in a JSON file. Run `node scripts/preview-submissions.mjs <review.json>` to inspect only those release archives and write the index, evidence, and reply preview under `.local/submission-preview/`. It does not install plugins, change public snapshots, or post comments.

The generator follows npm `latest`, unless an entry pins `version`. It reads up to four sources concurrently and retries temporary network errors. npm downloads are limited to the public npm registry; pinned Git sources use the GitHub commit archives described below. Reviewed repository artwork uses a separate icon boundary. Third-party package code is never executed. All sources and the official format validator must pass before the build can publish.

The build lists one version per package. DSH reads compatibility from `engines.dsh`, or from the intersection of DSH peer dependencies when that field is absent. Missing constraints mean the author supplied no range; they do not prove compatibility.

On a failure, inspect the Actions log, fix the source or connection, and rerun. Remove a withdrawn or unmaintained listing through a source-list change. No failed source is silently omitted from a successful deployment.

## Reviewed repository metadata

If a published package omits `repository`, maintainers may add `repositoryReview` only after matching that exact npm archive to an upstream release. The source entry must pin `version`; the review records the same version, npm SHA-512 integrity, canonical GitHub URL and immutable source commit. A version/hash mismatch or a conflicting published repository stops the build. `status.json` distinguishes `repositorySource: "review"` from `"package"` and links the reviewed source manifest. Updates to reviewed packages require a new review; they do not follow `latest` automatically.

[Taskboard provenance](reviews/taskboard-review.md) documents the first such entry, including the matching npm/release-asset digest.

## Reviewed archive budgets

Ordinary downloads have a 30-second deadline and archives a 100 MiB decoded-byte limit. A large package can declare `archiveReview` only with a pinned version and matching npm integrity. It may use at most 120 seconds per attempt and 256 MiB. Downloads make at most three attempts in total. Compressed downloads remain capped at 64 MiB; package manifests and individual tar metadata records at 1 MiB; all tar headers, including PAX/GNU records, at 20,000. Decoded-byte limits include headers, metadata, padding and trailing data. The parser retains the manifest, file names and bounded display files, discards other content and never extracts to disk. `status.json` reports both declared payload bytes (`unpackedBytes`) and the complete tar stream (`decodedBytes`) under each package's `archive` record.

[Univer Office archive review](reviews/univer-archive-review.md) records the measured package and its budget. A changed version or integrity requires a new review.

## Plugin icons and localization

The build reads the SHA-512-verified package's `icon` field or exported `./icon`: SVG, PNG, JPEG or WebP, up to 256 KiB. Original artwork is stored under content-addressed paths in `public/icons/`. The official `icon` field is relative to the index URL, so DSH and the website use the same image. Missing, oversized and unsupported icons appear in `status.json` under `display.warnings`; the website falls back to an initial.

Maintainers may explicitly select artwork from the published manifest's GitHub repository with `iconReview: {version, integrity, commit, path, sha256, normalization?}`. The entry must pin `version`; the review must match that exact npm version and SHA-512 integrity. `commit` is a full 40-character lowercase SHA, `path` names artwork relative to the repository root, and `sha256` identifies its original bytes. The build constructs an immutable `raw.githubusercontent.com` URL from that published repository and commit. It accepts no custom URL, redirects, path traversal, active SVG content or external image resources, and applies the same 256 KiB limit and image checks as package artwork. A mismatched review fails the build. An explicit review takes precedence over an available package icon; `display.publishedIcon` preserves the package icon evidence, while `display.icon` records `source: "reviewed-repository"`, the immutable source URL, original hash and review. This exception does not change the npm download allowlist.

Only `normalization: "remove-xml-comments"` permits removing XML comments from reviewed SVG bytes. Without it, the original bytes are preserved. The original hash is checked before normalization; the published asset path and final `sha256` use the resulting bytes. Version or integrity changes require a fresh review. Builds never read artwork from local review pages or research folders.

Author metadata comes from `locale/en.json` and Chinese files in that directory. Editorial text in `data/sources.json` takes precedence. Archive inspection retains only these bounded display files in addition to the manifest and file names; it neither extracts nor executes plugins. SVG artwork must contain no external resources or active content.

Set `DSH_INDEX_PREVIEW_PORT` for both the preview server and browser checks when the default local port is occupied.

## GitHub stars

Use `pnpm build:metadata` to refresh metrics, the market title and identity labels while preserving validated package versions and their original check timestamps. A changed allowlist or pinned version requires a full build. `publishers.json` records identity evidence; `public/downloads.json` and `public/display.json` record download readings and DSH row text. See [market metrics and identity labels](market-display.md) for definitions and client limits.

Each build reads the public GitHub API once per unique repository and writes `public/github.json`. It records the exact star count, fetch time and last push time. Counts also populate the official index's `github-stars` sort key, so DSH can sort by stars.

GitHub Actions supplies a read-only `GITHUB_TOKEN`. Local builds can use `GITHUB_TOKEN` or `GH_TOKEN`; without either, GitHub's anonymous rate limit applies. Tokens are used only for requests to `api.github.com` and are never written to snapshots. The browser does not request the GitHub API.

If GitHub is unavailable, a verified snapshot up to seven days old is kept with its original timestamp and marked `stale`. Older or missing counts become `unavailable`, not zero. Non-GitHub repositories have no GitHub star count. Actions preserves `.cache/github.json` between builds; the checked-in public snapshot is a fallback. Stars describe repository popularity, not test coverage or plugin quality.

## GitHub Pages

1. In **Settings → Pages**, select **GitHub Actions**.
2. Set the repository variable `PUBLISH_INDEX=true`.
3. Run **Check and publish index** on `main`.

The workflow runs unit tests, builds the catalog, checks both website languages in Chromium and validates the official format before uploading the Pages artifact. After deployment it checks the complete source allowlist, package evidence, both language pages, every referenced icon hash and the project branding assets. All requests reject redirects. Pull requests never deploy.

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

## Images

Full-size originals live in `site/originals/` and `docs/images/originals/`; the site and README load lossless WebP copies scaled to display size. After changing an original, run `node scripts/optimize-images.mjs` (needs `sharp`, e.g. `npm i --no-save sharp`).

## Pinned Git sources

Maintainer-approved Git entries pin `version` and declare `source: {type: "git", url, commit, integrity, publishedAt}`. The source must be a canonical GitHub repository URL with a full commit SHA, SHA-512 of that commit archive, and a release date. The repository root must contain the complete installable package. The generator downloads from `codeload.github.com` without redirects and applies the existing archive limits, identity, patch and entry-point checks. DSH installs the root package at that commit through the official Git source type. Git entries have no npm download or release-activity data. Updating requires reviewing the new commit and archive hash. No installation or lifecycle scripts run during generation.

## Author withdrawals

Authors ask for removal through a `[plugin-remove]` issue or a PR. After confirming the requester maintains the npm package or owns the source repository, delete the entry from `data/sources.json`, regenerate `public/`, and record `{name, repository, requestedBy, requestedAt, request}` in `data/withdrawn.json`, where `request` links to the request.

`pnpm build` and `preview-submissions.mjs` fail when a withdrawn package is listed. `review-candidates.mjs` records withdrawn candidates with `stage: "withdrawn"` and skips downloading them, and a unit test checks that the source list contains none. Remove a record from the withdrawn list only when the author asks to relist.

## Recently added

`public/added.json` records the first UTC day each plugin entered the index; the website's *Recently added* order sorts by it, newest first. Full builds prefer the deployed GitHub Pages record and fall back to the local snapshot, keep existing dates and stamp new packages with the build day. A package removed and listed again counts from its new listing. Dates before 2026-10-19 come from the Git history of `data/sources.json`, so the initial import shares one date.

## Daily recommendation rotation

`public/recommendations.json` ships with the index and stores weekly candidate pools and fourteen days of front-page exposure. Full builds and metadata refreshes prefer the deployed GitHub Pages state, with the local public snapshot as fallback. Unpublished state is not saved to the CI cache. See [recommendation rules](market-display.md). `pnpm build:recommendations` reorders already checked local versions offline; new sources and versions still require a full build. `pnpm preview:recommendations` writes a fourteen-day preview to `.local/recommendation-preview.json`.

## Editorial copy and product names

`data/sources.json` owns display names and bilingual descriptions. `data/brand-names.json` records reviewed product names; builds check that both display titles retain them. Author-provided Chinese aliases may appear alongside the original name. See the [2026-10-20 copy review](reviews/localization-2026-10-20.md).

`pnpm build:copy` refreshes the existing index, display snapshot and bilingual pages offline. It retains package versions, validation timestamps, metrics, ranks and exposure history. New entries absent from the checked snapshot still need a full build. Structured reviews can be replayed with `node scripts/apply-copy-review.mjs docs/reviews/localization-2026-10-20.json`; already-applied edits are skipped, and conflicting copy requires another review.
