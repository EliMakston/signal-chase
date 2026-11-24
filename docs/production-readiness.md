# Signal Chase v0.1.0: production readiness

This runbook prepares Signal Chase for its Demo-first public beta. This task
does not authorize or perform a deployment. Written approval for public
Last.fm use is still outstanding; that approval is a prerequisite only for
enabling live music, not for launching the playable Demo with Last.fm disabled.

## Architecture and configuration

Signal Chase is a DeepSpace-managed Cloudflare Worker app. The Worker serves the Vite
build and handles `/api/music/*`; `LASTFM_API_KEY` is read only by the Worker
and is never part of the client bundle. The music API is disabled unless the
server-side `LASTFM_ENABLED` value is exactly `true`. A missing value (the
default) disables search, similar-track lookup, and graph-building before any
upstream request. Demo mode does not depend on these endpoints.

Runtime configuration is split across the app and platform:

| Kind | Names | Source |
| --- | --- | --- |
| Project vars | `DEEPSPACE_APP_ID`, `APP_NAME`, `NATIVE_AUTH_REDIRECT_URIS` | `wrangler.toml` |
| Static/Worker bindings | `ASSETS`, `MUSIC_API_LIMITER`, and the declared app Durable Objects | DeepSpace/Cloudflare deployment from `wrangler.toml` |
| DeepSpace-managed runtime values | `AUTH_JWT_PUBLIC_KEY`, `AUTH_JWT_ISSUER`, `AUTH_WORKER_URL`, `APP_OWNER_JWT`, `OWNER_USER_ID` | Supplied by the DeepSpace app runtime; do not copy them into source or set them manually |
| Optional platform values | `PLATFORM_WORKER`, `API_WORKER`, `APP_IDENTITY_TOKEN`, debug/native-auth settings | Platform bindings or `wrangler.toml`; only configure when the corresponding feature is used |
| Last.fm secrets | `LASTFM_API_KEY`, `LASTFM_ENABLED` | DeepSpace secrets config (`prd` for production); required only to enable live music |

Use separate DeepSpace secrets configurations:

- `dev` for `npm run dev`, browser tests, and screenshots. Those scripts now
  select `dev` explicitly. An empty `dev` config has been created for this
  app; if setting up another environment, create it with
  `npx deepspace secrets configs create dev`. The screenshot command captures
  the already-running local server. Do not copy production secrets into `dev`;
  add a development key only when needed and permitted.
- `prd` for production. The production config currently contains a secret
  named `LASTFM_API_KEY`; its value must not be printed or copied into source,
  logs, or command-line arguments. `LASTFM_ENABLED` is intentionally not
  enabled while approval is outstanding.

The ignored `.dev.vars` and `.env*` files are for local use only. Never commit
them; `.env.example` is the only `.env` exception. Keep Worker bindings and
non-secret configuration in `wrangler.toml`, and credentials in DeepSpace
secrets. `MUSIC_API_LIMITER` is a Cloudflare rate-limit binding declared there.

## Secrets and live-music switch

Set a secret through stdin so its value is not placed in shell history or the
process argument list:

```sh
npx deepspace secrets set LASTFM_API_KEY --config prd --stdin
```

Only after written approval, enable the feature for the next release:

```sh
printf %s true | npx deepspace secrets set LASTFM_ENABLED --config prd --stdin
```

To disable it without changing gameplay code, set `LASTFM_ENABLED` to `false`
in the applicable secrets config and deploy a release containing that
configuration. An unset or non-`true` value is also disabled. Secret changes
do not alter an already-running Worker until a release applies them. Do not
put either value in a `VITE_*` variable, frontend configuration, logs, or a
checked-in file.

## Request protection and operational budget

The public music routes require `MUSIC_API_LIMITER`; if it is missing or fails,
the Worker fails closed without contacting Last.fm. One shared per-IP bucket
allows 30 weighted units per 60 seconds: search and similar-track requests
cost 1 each, and a graph build costs 30 (its maximum upstream-call budget).
Responses return `429` and `Retry-After` when the bucket rejects a request.
The graph builder retains its existing 30-request, 50-song, depth-3, and
6-recommendations-per-song bounds. Individual upstream requests time out after
10 seconds; graph builds have a 30-second overall timeout. At most four graph
builds are active per Worker isolate, with identical in-flight seed builds
coalesced. Completed Last.fm graph results are not cached.

Cloudflare's native rate-limit binding is an approximate, eventually
consistent limit per Cloudflare location, not a strict global quota or a
billing ceiling. Bursts may exceed the configured value, and each location
maintains its own counter. Treat 30 weighted units per IP per minute as an
abuse-control starting point for a small beta, not a guaranteed global Last.fm
request cap. Reassess against Last.fm's approved terms and observed traffic
before enabling the feature. A strict cross-location ceiling would require a
centralized limiter such as a Durable Object and is intentionally not added
for this beta preparation.

Do not add caching unless Last.fm's applicable terms explicitly permit it.
The current implementation deduplicates only simultaneous graph requests;
completed responses are fetched again.

## Security and privacy review

- Music inputs are validated and length-bounded before provider calls. The
  Last.fm origin is fixed in server code; request parameters cannot select an
  upstream URL, so these routes do not provide a user-controlled SSRF path.
- Song metadata is rendered as React text, not injected markup.
- Provider errors are converted to bounded public messages and stable error
  codes. Logs contain endpoint, status, duration, and limited error
  diagnostics—not API keys, IP addresses, search queries, or song metadata.
- `/api/debug/*` is not found unless `ALLOW_DEBUG_ROUTES` is exactly `true`;
  enabling it still requires an authenticated app admin. Keep the flag unset
  in production. The API status utility is protected and omitted from public
  navigation. Client error screens show exception messages and stack traces
  only in development builds.
- `/api/*` currently uses Hono's wildcard CORS policy without credentials.
  These are public endpoints and CORS is not authentication; other websites
  can initiate browser requests on a visitor's behalf. The rate limit helps
  constrain abuse, but is approximate. Retain wildcard CORS for native/cross-
  origin compatibility unless the product chooses a supported origin allowlist.
- Dependency audit results should be reviewed before release. Do not apply
  unrelated breaking dependency upgrades as part of this readiness change.
  The current audit reports one low-severity `esbuild` advisory affecting its
  Windows development server; no unrelated upgrade was applied.

## Build, test, and deploy

The empty `dev` secrets config is ready for local development and tests; never
use `prd` for local work:

```sh
npm run dev
npm run test:unit
npm run test:api
npm run test:e2e
npm run type-check
npm run lint
npm run build
```

The release version is `0.1.0` in the package metadata. The internal npm
package identifier remains unchanged; the configured Worker hostname is now
`signal-chase`. The production asset build is `npm run build`; this does not
deploy. The supported release command is `npx deepspace deploy`; `npm run
deploy` is the package-script alias. Both use the current app configuration
and production (`prd`) secrets by default. The deploy command runs the build
and deploy workflow; there is no separate `deepspace build` command in the
installed CLI. No release command was run for this task.

Before a future release:

1. Review the worktree and commit the intended changes for the default
   DeepSpace source. The deploy command syncs DeepSpace source by default.
2. Confirm the `signal-chase.app.space` hostname is available. The Worker
   name changed, so the existing app must be explicitly renamed on deployment.
3. Confirm that Cloudflare rate-limit namespace ID `20261123001` is unused in
   the target account.
4. Confirm `LASTFM_ENABLED` is absent or not `true` for the Demo-only beta.
   The production config may retain a Last.fm API key; the disabled server
   opt-in prevents its use.
5. Build and validate, then deploy only with explicit release approval.

```sh
npm run build
npm run type-check
npm run lint
npm run test:unit
npx deepspace deploy --rename
```

`npm run deploy -- --rename` is the package-script equivalent. The installed
CLI requires `--rename` to confirm this hostname change. These deployment
commands are documented only; they were not run for this task. A Last.fm key
is not required for the Demo-first launch. Do not place production secrets in
the `dev` configuration. Never use `--ignore-stale` to bypass a stale-release
guard without first resolving the release state.

## Monitoring and beta request budget

Use `npx deepspace status`, `npx deepspace activity`, and
`npx deepspace releases` to inspect app health and release history. In the
Cloudflare dashboard, enable Workers Observability/Logs and watch Worker
errors, request volume, `429` responses, upstream timeout/error rates, and
duration. Rate-limit binding counters are not directly visible in the
dashboard; the Worker emits a minimal warning when a request is rejected.
Logs should be reviewed without exporting request URLs or secrets.

For an initial small beta, use the configured 30-unit per-IP-per-minute
allowance as the operational starting budget, monitor actual upstream
failures and throttling closely, and disable Last.fm if usage or terms become
unclear. It is not a hard aggregate or account-wide quota. Demo mode remains
available while Last.fm is disabled.

## Post-release smoke checks

When a release is eventually authorized:

1. Load the app and complete a Demo race, including a restart and a new race.
2. While live music is disabled, verify `/api/music/search` and the other music
   endpoints return `503` with `live_music_disabled`, and that no upstream
   Last.fm traffic is produced.
3. Only after written approval and explicit enablement, test song search,
   recommendations, a dynamically expanded custom race, retry behavior, and
   safe handling of upstream `429`/timeout responses.
4. Confirm Worker logs contain no keys, IPs, search terms, or song IDs.
5. Check browser console/network errors and verify responsive layouts.

## Rollback

Inspect releases with `npx deepspace releases`, then roll back to the intended
release with `npx deepspace rollback <release-id>` (or omit the ID to select
the previous release). Rollback re-deploys the old bundle but keeps the live
secrets; it does not restore the secrets that existed when that bundle was
released. If live music must be disabled, set `LASTFM_ENABLED` to `false` in
the active config and deploy that configuration as well as considering a
bundle rollback.

## Current release blockers

- Confirm `signal-chase.app.space` is available and authorize the app rename
  using `npx deepspace deploy --rename`.
- Confirm namespace ID `20261123001` is unused in the target Cloudflare
  account before the first deployment.
- The native rate limiter is approximate per location; it cannot guarantee a
  strict global upstream quota.
- Written approval for public Last.fm use remains required before enabling
  live music. It is not required for the Demo-only public beta.
- The production config contains `LASTFM_API_KEY`; keep `LASTFM_ENABLED`
  absent or false for the first release.
- Confirm production secrets and bindings in the DeepSpace app before release;
  never print secret values during that check.
- Deploy authorization is outstanding. No deployment has been performed.
