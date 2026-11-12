# Open Market development checkpoint

Version **0.4.1** is released on npm, with the tag `dsh-open-market@0.4.1` and a matching GitHub Release.

## Implementation

- `client.js`: complete inventory, system grouping, state badges, native settings navigation, diagnostics views, load-order editing and horizontal dragging.
- `management.js`: authenticated local management API, serialized mutations and persistent idle update queue.
- `task-guard.js`: reported activity checks and idle Agent maintenance leases, including Agents created during maintenance.
- `diagnostics.js`: local package metadata, directory shortcuts, dependency/compatibility checks and native profile-layer reordering.
- `DETAIL.md` and `DETAIL.zh.md`: short native detail documents selected by locale metadata. The full README remains documentation.

Native management remains responsible for compatibility, read-only restrictions, restart requirements and installation-script approval. Reordering uses the native manifest lock and `hmr.runExclusive()` around reconciliation. Its optimistic revision check prevents overwriting a profile edited elsewhere.

## Continue on another device

Use an isolated DSH home and the official `dsh` CLI or Desktop CLI launcher. Run these commands from the repository root after installing the repository's declared dependencies.

PowerShell:

```powershell
$env:DSH_HOME = Join-Path (Get-Location) '.local/open-market-dev'
$env:DSH_TELEMETRY_DISABLED = '1'
$marketPackage = Join-Path (Get-Location) 'packages/dsh-open-market'
dsh plugin --profile web add $marketPackage
```

macOS or Linux:

```sh
export DSH_HOME="$PWD/.local/open-market-dev"
export DSH_TELEMETRY_DISABLED=1
dsh plugin --profile web add "$PWD/packages/dsh-open-market"
```

Before first startup, set the isolated profile's `.dsh-open-market-user.json` to the following to keep anonymous likes off during testing:

```json
{"schema":1,"settings":{"likes":false},"installCounted":true}
```

Start the preview in the same shell environment:

```sh
dsh web --host 127.0.0.1 --port 18474 --no-open
```

Open the local URL printed by DSH. A local package install may copy the source; reinstall it and reload the test Host after further edits. Use local no-op fixtures to test enable/disable, dependencies and layer ordering. The preview profile and screenshots from another device are local evidence and are not part of this checkout.

## Verification and follow-up

Run focused tests for changed modules, for example:

```sh
node --test packages/dsh-open-market/client.test.js packages/dsh-open-market/diagnostics.test.js packages/dsh-open-market/management.test.js packages/dsh-open-market/task-guard.test.js
```

The checkpoint was checked with targeted Node.js regression suites, npm pack inspection, the native document reader, and an isolated DSH **0.2.2-rc.1 Web** preview on Windows. Manual checks covered native settings navigation, short detail documents, directory opening, enable/disable, dependency and compatibility output, load-order saving, horizontal dragging and default/Macaron styling. Full repository build and browser suites run in GitHub Actions.

On macOS (DSH **0.2.1-rc.5 Web**, isolated home, linked package and two local no-op fixtures) the directory opener launched Finder for a profile directory and, for the DSH directory inside `app.asar`, for `DeepSeek Harness.app/Contents/Resources`. Enable/disable and valid load-order changes applied without a restart, and an inverted dependency order was refused without touching the profile. The refusal now names both the plugin and the dependency to move above it.

Keep these boundaries visible during further development:

- Activity protection is global across reported sessions. Exact per-plugin session usage and admission of independent background producers need additional Host APIs.
- The profile is the shared DSH configuration location. Separate data directories chosen by plugins have no common registry.
- Bundle-layer order controls patch composition; runtime entry order is an inventory position. Neither is an asynchronous startup timestamp.
- Risk counts identify plugins with metadata indicators, not security-audit findings.
- Mutations fail closed when monitoring is unavailable. Restarted queued updates need explicit retry, and a changed installed source, version or selection requires a fresh update choice.

Review the development changelog again before preparing a later public release.
