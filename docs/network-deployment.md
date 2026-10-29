# Network deployment

The public address remains `dshopen.org`. EdgeOne serves the validated static site and routes `/index.json` internally. China initially prefers GitHub Pages; other locations initially prefer Cloudflare. A stalled first source starts the other after 400 ms. Each complete response must match the release SHA-256. If both upstreams fail or contain another release, an immutable snapshot from the same deployment remains available. Clients receive JSON directly, without a redirect or settings change.

The Cloudflare origin is `dshopen.polang.workers.dev`, separate from the public hostname to avoid a routing loop. The EdgeOne project is `dshopen-network-probe`, initially tested through `network-probe.dshopen.org`. Mainland nodes are excluded from its hosting region because the domain has no ICP filing.

## Statistics

Both selected sources produce the same daily salted reader fingerprint. The original Cloudflare salt is transferred to the trusted gateway through the authenticated `/internal/config` API and configured as its `VISITOR_SALT` environment variable. The signing secret is separate. Public statistics never expose either value. No raw IP address or user agent is placed in the retry queue.

Authenticated read events enter a SQLite Durable Object, one per UTC day. Replayed IDs cannot increment totals twice. During the initial UTC day, existing D1 visitor hashes still deduplicate returning readers. A transactional D1 watermark adds only new increments to the existing reports, preserving their historical totals. Reports can lag by five minutes plus their response-cache lifetime. Country reports use D1 counts once the shared counter is active; old Cloudflare analytics samples are not added to exact reader counts.

If delivery fails, EdgeOne Blob stores the anonymous event for retry. Background traffic and a GitHub Actions task every fifteen minutes drain this queue. Retries use bounded parallelism and preserve events after a failed acknowledgement. If both the counter and Blob fail, index access continues and a reporting error is logged; that exceptional read cannot be guaranteed recoverable. Counter events and visitor hashes expire after thirty-two days, and events older than thirty days are rejected.

Likes and installs retain the existing daily deduplication and IPv6 /64 rule. The gateway signs the anonymous voter hash together with the request body, route and timestamp. Cloudflare rejects forged identities. Likes still require the Cloudflare database API to be available.

## Publishing

GitHub Actions builds and validates once. Cloudflare is published first, followed by GitHub Pages, full index hash equality, and then EdgeOne using the same artifact. Source checks use the independent Cloudflare origin, so moving the public hostname does not create a deployment dependency on an older gateway release. The shared Durable Object backend is configured in `cloudflare/read-counter.wrangler.jsonc` and must exist before publishing the main Worker.

Required repository Secrets are `CLOUDFLARE_API_TOKEN`, `DSH_GATEWAY_AUTH_SECRET`, and `EDGEONE_PAGES_API_TOKEN`. `PUBLISH_INDEX=true` enables GitHub Pages and `PUBLISH_EDGEONE=true` enables the gateway and retry task. EdgeOne needs `GATEWAY_AUTH_SECRET` and `VISITOR_SALT` configured before production traffic is switched. Credentials must not be committed or printed in deployment output.

Before changing public DNS, verify complete index hashes, the site and icons, authenticated read delivery, retries, and existing statistics and like APIs on the test hostname. Add and validate the production hostname and its certificate in EdgeOne, then update the Cloudflare DNS-only record. Keep the independent Cloudflare origin and GitHub Pages available for recovery.
