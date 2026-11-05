# Deployment

Libroo supports two deployment paths:

- Self-hosted Docker for private installs that keep SQLite and uploaded assets on a mounted volume.
- Hosted Cloudflare for the managed Libroo instance using NuxtHub, D1, and R2.

For a private Cloudflare deployment, follow the
[Cloudflare deployment guide](cloudflare.md).

## Self-Hosted Docker

Build the production image from a clean checkout:

```bash
docker build -t libroo:local .
```

Build a semantically versioned release image with OCI labels:

```bash
VERSION=1.2.3
REVISION="$(git rev-parse HEAD)"
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

docker build \
  --build-arg VERSION="$VERSION" \
  --build-arg REVISION="$REVISION" \
  --build-arg CREATED="$CREATED" \
  --build-arg SOURCE="https://github.com/niklhut/libroo" \
  -t ghcr.io/OWNER/libroo:"$VERSION" \
  .
```

Build both supported CPU architectures for publishing:

```bash
VERSION=1.2.3

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  --build-arg VERSION="$VERSION" \
  --build-arg REVISION="$(git rev-parse HEAD)" \
  --build-arg CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg SOURCE="https://github.com/niklhut/libroo" \
  -t ghcr.io/OWNER/libroo:"$VERSION" \
  .
```

The Docker CI workflow builds `linux/amd64` on pull requests for a faster production-image check. Same-repository pull requests push `ghcr.io/OWNER/libroo:pr-<number>` so the image can be inspected from GitHub Packages. Pull requests from forks are build-only and load the image into the runner instead of pushing, because forked PRs should not receive package write access. Pushes to `main` and release tags build and push both `linux/amd64` and `linux/arm64`. It uses Docker metadata rules so release tags like `v1.2.3` produce `1.2.3` and `1.2`, and branch/SHA tags are available for traceability. The same metadata is written as OCI image labels.

### Base-Image Pinning

The Node base image in the `Dockerfile` retains its readable version tag and is pinned to an immutable SHA-256 digest for reproducible builds. To obtain the current multi-platform image digest, run:

```bash
docker buildx imagetools inspect node:24.16.0-alpine --format '{{.Manifest}}'
```

Update the `FROM node:24.16.0-alpine@sha256:...` line with that digest. Renovate automatically proposes digest updates; as with other dependency PRs, those changes must pass the existing Docker image build check before review and merge.

Run locally with Docker Compose:

```bash
cp .env.example .env
openssl rand -base64 32
# Put the generated value in NUXT_BETTER_AUTH_SECRET.
docker compose up --build
```

The container listens on port `3000` and exposes `GET /api/health`. The image and Docker Compose healthchecks call that endpoint and fail if the app cannot query the database.

### Runtime Environment

Required:

| Variable | Example | Notes |
| --- | --- | --- |
| `NUXT_BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` | Required in every production install. Keep stable across restarts. |
| `NUXT_BETTER_AUTH_URL` | `https://libroo.example.com` | Public origin used by auth links and callbacks. |

Self-host defaults baked into the image:

| Variable | Default | Notes |
| --- | --- | --- |
| `NUXT_LIBROO_RUNTIME_PROFILE` | `selfhost` | Uses local SQLite, local blob storage, SMTP-capable email, and Sharp image conversion. |
| `NUXT_DATABASE_URL` | `file:/data/db/sqlite.db` | libSQL/SQLite database path inside the persistent volume. |
| `NUXT_LOCAL_STORAGE_DIR` | `/data/blob` | Uploaded assets and generated cover WebP files. |
| `NUXT_TRUSTED_IP_HEADERS` | empty | Optional comma-separated trusted client-IP header names for self-hosted reverse proxy deployments. Leave empty for direct access. The Cloudflare profile does not require this setting. |

Optional email and registration settings:

| Variable | Default | Notes |
| --- | --- | --- |
| `NUXT_EMAIL_VERIFICATION_ENABLED` | `false` | Set `true` for public installs. |
| `NUXT_PUBLIC_REGISTRATION_ENABLED` | `true` | Controls new-user creation, not existing-user sign-in. Set `false` after creating the first admin to require invites for password signup and block new OIDC users. |
| `NUXT_PUBLIC_PASSKEYS_ENABLED` | `false` | Enables WebAuthn passkeys only while local authentication is enabled and the configured Better Auth origin is HTTPS (or localhost). Keep disabled unless the deployment origin and TLS termination are configured correctly. |
| `NUXT_PUBLIC_OIDC_ENABLED` / `NUXT_OIDC_DISCOVERY_URL` | `false` / empty | Enables optional OpenID Connect sign-in. Discovery is preferred; see [OAuth / OIDC Sign-In](#oauth--oidc-sign-in). |
| `NUXT_EMAIL_PASSWORD_ENABLED` | `true` | Enables local password and passkey authentication, password signup, invite-backed signup, and password reset. Set `false` only when another sign-in method is configured and tested. |
| `NUXT_PUBLIC_TURNSTILE_ENABLED` | `false` | Enables Cloudflare Turnstile server enforcement and client widget rendering for signup and password-reset email requests. Public installs should set it to `true`; private LAN, VPN/Tailscale, Cloudflare Access, or otherwise access-controlled installs may leave it `false` intentionally. |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` / `NUXT_TURNSTILE_SECRET_KEY` | empty | Cloudflare Turnstile site key and secret key. Required when Turnstile is enabled. |
| `NUXT_TURNSTILE_ALLOWED_HOSTNAMES` | empty | Optional comma-separated hostname allow-list for Turnstile token responses, such as `libroo.example.com,app.libroo.example.com`. |
| `NUXT_PUBLIC_OPEN_LIBRARY_LINKS_ENABLED` | `false` in production, `true` in development | Shows outbound Open Library edition/work links on book detail pages. Keep disabled for the hosted/product experience; enable intentionally for self-hosted source visibility or metadata debugging. |
| `NUXT_OPEN_LIBRARY_REQUEST_TIMEOUT_SECONDS` | `12` | Timeout for Open Library metadata and cover existence requests. Increase if the upstream API is slow in your deployment region. |
| `NUXT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS` | `20` | Timeout for downloading and repairing cover images from Open Library. |
| `NUXT_OPEN_LIBRARY_CONTACT_EMAIL` | empty | Contact included in the Open Library `User-Agent`. When configured, the shared outbound limiter permits three requests per second; otherwise it permits one. |
| `NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_WINDOW_SECONDS` / `NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_MAX_REQUESTS` | `60` / `10` | Dedicated database-backed inbound limit for authenticated bulk ISBN lookup requests. |
| `NUXT_BOOKS_ENRICHMENT_BATCH_SIZE` / `NUXT_BOOKS_ENRICHMENT_CONCURRENCY` | `20` / `4` | Bounds each opted-in CSV import enrichment sweep and its parallel cover/storage checks. |
| `NUXT_BOOKS_ENRICHMENT_LEASE_SECONDS` | `900` | Claim and per-ISBN lock duration. Expired work can be safely reclaimed; stale workers cannot complete another worker's claim. |
| `NUXT_BOOKS_ENRICHMENT_MAX_ATTEMPTS` / `NUXT_BOOKS_ENRICHMENT_BACKOFF_SECONDS` | `5` / `60` | Maximum attempts and exponential-backoff base for transient Open Library failures. |
| `NUXT_BOOKS_ENRICHMENT_RECOVERY_TIME_BUDGET_SECONDS` / `NUXT_BOOKS_ENRICHMENT_RECOVERY_SAFETY_SECONDS` | `840` / `35` | Stops a scheduled canonical-recovery sweep before its invocation deadline, reserving metadata, cover-download, and persistence time for an attempted book. |
| `NUXT_LEGAL_MARKDOWN_FETCH_TIMEOUT_SECONDS` | `5` | Timeout for fetching configured legal Markdown source documents. |
| `NUXT_PLUNK_SEND_TIMEOUT_SECONDS` | `5` | Timeout for Plunk email delivery requests. |
| `NUXT_EMAIL_PROVIDER` | `smtp` | Self-host supports `smtp` or `plunk`. |
| `NUXT_EMAIL_FROM` | empty | Required when email sending is enabled. |
| `NUXT_EMAIL_REPLY_TO` | empty | Optional reply-to address for sent mail. |
| `NUXT_SMTP_HOST` / `NUXT_SMTP_PORT` / `NUXT_SMTP_SECURE` | empty / `587` / `false` | SMTP transport settings. |
| `NUXT_SMTP_USER` / `NUXT_SMTP_PASSWORD` | empty | SMTP credentials, if required by the provider. |
| `NUXT_PLUNK_API_KEY` / `NUXT_PLUNK_BASE_URL` | empty / `https://next-api.useplunk.com` | Plunk delivery settings. |

Optional legal page settings:

For a hosted setup with a separate public information website, prefer making that
website the canonical legal home and point the app at those pages with the URL
variables below. Self-hosters who only deploy the application can point the app
at Markdown documents hosted on S3, R2, a static web server, or a similar source.
Libroo does not ship legally sufficient privacy-policy, imprint, or terms templates.

| Variable | Default | Notes |
| --- | --- | --- |
| `NUXT_PUBLIC_LEGAL_PRIVACY_POLICY_URL` / `NUXT_PUBLIC_LEGAL_IMPRINT_URL` / `NUXT_PUBLIC_LEGAL_TERMS_URL` | empty | Canonical legal page URLs. If set, footer links point to these URLs and the local route redirects there. |
| `NUXT_LEGAL_PRIVACY_POLICY_MARKDOWN_URL` / `NUXT_LEGAL_IMPRINT_MARKDOWN_URL` / `NUXT_LEGAL_TERMS_MARKDOWN_URL` | empty | Server-side Markdown source URLs. Used only when the matching canonical URL is empty. |

If both values for a legal page are empty, the footer link is hidden and the
direct route shows an empty state.

### Email Delivery And Verification

Libroo supports two outbound email providers:

- `smtp`: self-host default, delivered through Nodemailer with `NUXT_SMTP_HOST`, `NUXT_SMTP_PORT`, `NUXT_SMTP_SECURE`, and optional `NUXT_SMTP_USER` / `NUXT_SMTP_PASSWORD`.
- `plunk`: hosted Cloudflare provider and also available to self-hosted installs with `NUXT_PLUNK_API_KEY` and optional `NUXT_PLUNK_BASE_URL`.

Set `NUXT_EMAIL_PROVIDER=smtp` or `NUXT_EMAIL_PROVIDER=plunk`. All providers require `NUXT_EMAIL_FROM` when email sending is used. `NUXT_EMAIL_REPLY_TO` is optional; SMTP sends it as the message `Reply-To`, and Plunk sends it as `reply`.

`NUXT_EMAIL_VERIFICATION_ENABLED=false` disables Better Auth email-verification gating. Signups can sign in immediately, and email changes use the direct Better Auth `change-email` endpoint when available.

`NUXT_EMAIL_VERIFICATION_ENABLED=true` enables:

- Verification email on signup and sign-in for unverified accounts.
- `requireEmailVerification` and disabled automatic sign-in after signup until verification completes.
- Verification links that expire after 24 hours.
- Password-reset links that expire after 1 hour.
- The custom pending-email-change flow in Settings.

When verification is enabled, Libroo blocks the direct `/api/auth/change-email` endpoint. Settings instead collects the desired email and current password, stores it in `user.pending_email`, and sends a verification link to the pending address. When the link succeeds, Better Auth updates the email and Libroo clears `pending_email`.

User-facing effects:

- Settings shows the current verification status and any pending email change.
- Resend sends a current-email verification when the account is unverified.
- Resend sends the pending-email-change verification when `pending_email` is set.
- A fully verified account with no pending email change treats resend as a no-op success.

### Turnstile Bot Protection

Libroo can protect the public account creation flow and password-reset email request flow with Cloudflare Turnstile. This is operator-controlled rather than globally enforced by the application.

Use Cloudflare's Turnstile dashboard to create a widget for the public hostname, then set:

```bash
NUXT_PUBLIC_TURNSTILE_ENABLED=true
NUXT_PUBLIC_TURNSTILE_SITE_KEY=0x...
NUXT_TURNSTILE_SECRET_KEY=0x...
NUXT_TURNSTILE_ALLOWED_HOSTNAMES=libroo.example.com
```

When enabled, signup and password-reset email requests must include a valid Turnstile token. Missing or invalid tokens are rejected before Better Auth creates the account or sends a reset email. Login is not protected by Turnstile in this sprint.

Public/hosted deployments should enable Turnstile before leaving public signup or password-reset email enabled. If those flows are public without Turnstile, operators should treat the deployment as more exposed to automated account creation and reset-email spam.

Private self-hosted deployments may intentionally opt out by leaving `NUXT_PUBLIC_TURNSTILE_ENABLED=false`, especially when Libroo is only reachable on a LAN, behind VPN/Tailscale, behind Cloudflare Access, or behind another access-control layer. The app does not refuse to run when Turnstile is disabled.

### Passkeys / WebAuthn

Passkeys are an optional, per-user local sign-in method. Enabling this deployment capability neither enrolls users nor enforces passkeys or two-factor authentication globally.

```bash
NUXT_PUBLIC_PASSKEYS_ENABLED=true
```

Libroo only registers the WebAuthn plugin when this flag and `NUXT_EMAIL_PASSWORD_ENABLED` are true and `NUXT_BETTER_AUTH_URL` is a secure context: `https:` or `http://localhost` for local development. The hostname from that URL is used as the WebAuthn relying-party ID, so it must be the browser-visible application hostname. The passkey controls stay hidden when any condition is not met.

For self-hosting behind a reverse proxy, terminate TLS at the public hostname and set `NUXT_BETTER_AUTH_URL` to that exact HTTPS origin (for example `https://libroo.example.com`), not the internal HTTP container URL. Do not enable passkeys on plain HTTP LAN deployments: browsers will reject WebAuthn there. Self-hosted deployments can opt out by keeping `NUXT_PUBLIC_PASSKEYS_ENABLED=false`, which is the image default.

For recovery-code handling and the sole-admin last-factor safeguard, see [MFA recovery](./mfa-recovery.md).

### OAuth / OIDC Sign-In

Libroo can use one OpenID Connect provider as a sign-in method. Configure the
provider's redirect URI exactly as `https://libroo.example.com/api/auth/callback/oidc`
(use your own public origin); this is Better Auth 1.7's callback path.

Discovery is preferred because Better Auth validates the provider issuer and
identity token automatically. If discovery is unavailable, set all three
explicit endpoint URLs instead. All provider endpoints must use HTTPS in
production; plain HTTP is accepted only for loopback development. Configure
only endpoints from a trusted provider. Libroo validates the configured URL
schemes, but Better Auth 1.7.2 follows HTTP redirects when fetching discovery
metadata and user information; using final, non-redirecting endpoint URLs avoids
expected redirects but is not a redirect-security boundary. Deployments whose
server can reach sensitive internal services should additionally restrict
outbound network access to the trusted identity-provider hosts.

```bash
NUXT_PUBLIC_OIDC_ENABLED=true
NUXT_OIDC_DISCOVERY_URL=https://id.example.com/application/o/libroo/.well-known/openid-configuration
# Or: NUXT_OIDC_AUTHORIZATION_URL=..., NUXT_OIDC_TOKEN_URL=..., NUXT_OIDC_USER_INFO_URL=...
NUXT_OIDC_CLIENT_ID=libroo
NUXT_OIDC_CLIENT_SECRET=replace-with-a-secret
NUXT_OIDC_SCOPES="openid email profile"
NUXT_PUBLIC_OIDC_DISPLAY_NAME="Single sign-on"
NUXT_PUBLIC_OIDC_ICON=
NUXT_OIDC_TRUST_PROVIDER=false
NUXT_EMAIL_PASSWORD_ENABLED=true
```

OIDC account linking never merges different email addresses. With
`NUXT_OIDC_TRUST_PROVIDER=false` (the default), implicit linking is disabled: an
OIDC sign-in using an existing Libroo email returns `account_not_linked`, and the
provider must instead be linked explicitly from an authenticated account.
Setting the flag to `true` makes the configured IdP a trusted identity source:
a matching-email account may be linked automatically even when the IdP does not
return `email_verified=true`, provided that the existing Libroo user row already
has `emailVerified=true`. Better Auth deliberately requires that local
verification to prevent an unverified, pre-registered account from receiving a
victim's OAuth identity. `NUXT_EMAIL_VERIFICATION_ENABLED=false` disables the
verification flow but does not mark existing users as verified. Provider trust
can expose existing accounts to takeover if the IdP permits unverified or
reassigned email claims, so enable it only when the IdP reliably proves
ownership of every asserted email. Different-email linking remains disabled in
both modes.

For a private installation that intentionally does not deliver verification
email, use an explicit connection instead of weakening this gate:

1. Create the first admin with email/password and remain signed in.
2. Enable and restart with the OIDC configuration while keeping
   `NUXT_EMAIL_PASSWORD_ENABLED=true`.
3. Open **Settings → Account & sign-in** and select **Connect _provider_**.
4. Sign out and confirm that OIDC sign-in returns to the same Libroo account.
5. Only then set `NUXT_EMAIL_PASSWORD_ENABLED=false`, if desired.

The explicit connection proves control of both the existing Libroo session and
the OIDC identity, so it works without setting the local user's email as
verified. Repeat the connection step for invited family or friends before
removing their previous sign-in method. Keeping
`NUXT_PUBLIC_REGISTRATION_ENABLED=false` throughout this transition does not
reopen public password signup: existing password login continues to work, and
new password accounts still require an invite.

The provider, registration, and password switches serve different purposes:

| Public registration | Email/password | Result after bootstrap |
| --- | --- | --- |
| `true` | `true` | Public password signup and OIDC just-in-time user creation are allowed. |
| `false` | `true` | Password signup requires an invite; OIDC can sign in an already-linked user but cannot create one. |
| `true` | `false` | OIDC can create users; password login and signup are disabled, including invite-backed signup. |
| `false` | `false` | New password and OIDC users are blocked; only already-linked OIDC users can sign in. |

`NUXT_PUBLIC_OIDC_ENABLED` only exposes the provider and does not override
registration policy. New OIDC users require public registration, except that an
empty installation permits its first user as the admin bootstrap. Disabling
`NUXT_EMAIL_PASSWORD_ENABLED` disables both password login and password signup,
so a valid invite cannot restore password signup. It also disables passkey
sign-in and enrollment; `NUXT_PUBLIC_PASSKEYS_ENABLED` is an additional opt-in
only while local authentication remains enabled.

If OIDC just-in-time creation should be available while public password signup
is not, use `NUXT_PUBLIC_REGISTRATION_ENABLED=true` with
`NUXT_EMAIL_PASSWORD_ENABLED=false`. This also disables password login for
existing users. The current configuration cannot combine OIDC user creation
with existing-user password login plus invite-only password signup; that would
require a separate OIDC provisioning policy.

- **Authentik:** use the provider's OpenID Connect discovery URL from its
  application/provider configuration and register the callback above. Authentik
  2025.10 and newer reports `email_verified=false` from its default email scope;
  explicit connection therefore requires provider trust unless a controlled
  property mapping emits a reliable verified-email claim. Enable trust only when
  the Authentik account and email-assignment policy make every asserted email
  authoritative.
- **Keycloak:** use the realm discovery URL, normally
  `https://host/realms/<realm>/.well-known/openid-configuration`; make sure the
  client has the `openid`, `email`, and `profile` scopes.
- **Authelia:** create an OIDC confidential client, register the callback, and
  use its issuer discovery URL. Confirm Authelia returns verified email claims
  before enabling provider trust.

### Client IP Handling And Rate Limiting

Libroo uses the request client IP for Better Auth and ISBN rate limiting. Better Auth stores its counters in the shared database. ISBN lookup/add requests use one atomic database-backed fixed-window limiter on both Cloudflare and self-hosted runtimes; Cloudflare D1 coordinates across isolates.

For a single self-host process, the local SQLite file needs no additional infrastructure. Multiple self-host instances must set `NUXT_DATABASE_URL` to the same shared/remote libSQL database (for example Turso) so limiter decisions coordinate. A separate local SQLite file per instance cannot provide a global limit.

The default is safe: no self-hosted forwarding header is trusted unless the operator explicitly configures `NUXT_TRUSTED_IP_HEADERS`. If Libroo cannot resolve an ISBN caller IP, it uses a shared `unknown` bucket; it deliberately does not trust a caller-supplied `x-libroo-client-ip` header, since doing so would permit rate-limit evasion.

Use the setting that matches the runtime topology:

| Topology | Configuration |
| --- | --- |
| Cloudflare | No `NUXT_TRUSTED_IP_HEADERS` setting is needed. Cloudflare Workers expose the real client address through `cf-connecting-ip`, and Libroo reads it automatically in the Cloudflare profile. |
| Self-hosted, direct access | Leave `NUXT_TRUSTED_IP_HEADERS` empty. Libroo falls back to the connection IP supplied by the runtime. |
| Self-hosted behind a trusted reverse proxy | Set `NUXT_TRUSTED_IP_HEADERS` to the exact header your proxy controls, then configure that proxy to overwrite and forward the same header. Prefer a single-hop header such as `X-Real-IP` when possible. |
| Private access layers such as Cloudflare Access or Tailscale | Rate-limiting identity may collapse to an access proxy, subnet router, or shared egress address. That can make unrelated users share the same Better Auth rate-limit bucket. This is acceptable for many private installs, but operators should understand that the bucket may represent the access layer instead of the human user. |

Example Nginx forwarding:

```nginx
location / {
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_pass http://libroo:3000;
}
```

```bash
NUXT_TRUSTED_IP_HEADERS=X-Real-IP
```

Example Caddy forwarding:

```caddyfile
libroo.example.com {
  reverse_proxy libroo:3000 {
    header_up X-Real-IP {remote_host}
  }
}
```

```bash
NUXT_TRUSTED_IP_HEADERS=X-Real-IP
```

Never forward client-controlled `X-Forwarded-For` from untrusted sources. If you choose to trust `X-Forwarded-For`, the edge proxy must strip any incoming value and replace it with a value it computed itself; otherwise clients can spoof IP addresses and evade or poison rate limits.

If logs show a warning that Libroo cannot determine the client IP, resolve it according to the topology: on Cloudflare, use the `cloudflare` runtime profile; on direct self-hosted access, verify the runtime exposes a connection address; behind a reverse proxy, set `NUXT_TRUSTED_IP_HEADERS` and configure the proxy to overwrite that header. Do not silence the warning by trusting arbitrary forwarded headers from the public internet.

Better Auth rate limiting and Turnstile CAPTCHA are independent, complementary controls. Better Auth throttles requests by IP bucket; Turnstile challenges likely bots before selected auth flows proceed. Configuring `NUXT_TRUSTED_IP_HEADERS` does not change Turnstile behavior.

### Persistent Data

Mount `/data` as the durable volume. It contains:

- `/data/db/sqlite.db`: application database.
- `/data/blob`: uploaded assets and generated cover images.

The image creates both directories and runs `scripts/migrate-selfhost.mjs` before starting Nuxt. A fresh empty volume is migrated automatically. Before upgrading an existing install, back up the whole `/data` volume while the container is stopped.

Prefer the scripted online backup workflow in [Backup And Restore](./backup-restore.md):

```bash
pnpm backup:selfhost -- --output-dir /backups/libroo
```

The backup script snapshots SQLite first, copies blobs second, writes a versioned manifest, and packages the artifact for restore with `pnpm restore:selfhost`.

Secrets should be injected through the orchestrator, an env file outside source control, or a secret manager. Do not bake secrets into the image.

### Scheduled Tasks

Libroo runs an opted-in CSV import enrichment sweep every five minutes, a daily audit cleanup task at 03:00, and a daily Open Library cover repair task at 03:30. The sweep processes bounded batches and recovers deferred, retried, or interrupted work without attaching enrichment to an interactive request. Enrichment jobs use expiring claims and per-ISBN locks, apply provider fields additively, and stop when their imported record changes or is removed. Cloudflare preview Workers intentionally omit cron triggers, so queued enrichment remains pending in previews. The cover repair task checks a small random batch of Open Library books that were saved without a generated cover image, retries the cover download, and fills `cover_path` only when a cover is successfully stored.

Interactive ISBN lookup has a separate canonical enrichment job. The initial request waits only for the edition metadata, canonical book, authors, and durable pending job; the browser then calls the foreground enrichment endpoint for work details, tags, and cover storage. Claims use a short lease, so a disconnected tab or interrupted Worker leaves work reclaimable on the next lookup, Add, or foreground request. `waitUntil()` is not used as a delivery guarantee: its post-disconnect allowance is limited, and preview deployments may have no cron. The scheduled sweep remains fallback recovery rather than the normal interactive path.

### Account Deletion Operations

Users can delete their own accounts from Settings. Deletion is immediate after
recent reauthentication (password or OIDC) and destructive confirmation. It
removes the Better Auth account/session records, personal library records, owned
loans, borrowed-loan associations, user-created manual metadata that is not
still referenced by another user, and user-specific uploaded assets.

Operators should use the self-service flow for support requests whenever possible. If an operator restores an old `/data` backup, they must re-run any account deletions that happened after the restored backup point. See [Account Deletion And Retention](./account-deletion.md) for the cleanup semantics, lending behavior, backup notes, and manual support process.

### Self-Hosted Troubleshooting

If startup fails during migration with `SQLITE_FULL`, SQLite cannot write to the database volume. On Docker Desktop this often means the Docker disk image is full even when the host filesystem still has free space. Check `docker system df`, prune unused images/build cache/volumes, increase Docker Desktop's disk image size, or recreate the `libroo-data` volume after taking any needed backup.

For bind mounts, make sure the container can write to the mounted database directory. The Compose example uses a named volume mounted at `/data`.

### Self-Hosted Rollback

Rollback is image-based: stop the new container and start the previous known-good image against the same `/data` volume. If a release introduced database migrations, prefer restoring the matching backup with `scripts/restore-selfhost.mjs`. SQLite migrations are not assumed to be reversible, and a backup whose migration tag/idx or app version is ahead of the target code must not be restored.
