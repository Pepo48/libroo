# Cloudflare deployment

Follow the four steps below to deploy your private library without an email provider.

1. [Complete the one time Cloudflare steps](#1-complete-the-one-time-cloudflare-steps)
2. [Run the setup command](#2-run-the-setup-command)
3. [Create your account and finish](#3-create-your-account-and-finish)
4. [Save the billing alert and check access](#4-save-the-billing-alert-and-check-access)

Reference: [Email roles](#which-email-goes-where) · [Open Library](#what-open-library-is-for) ·
[Dashboard locations](#dashboard-locations-and-troubleshooting) ·
[GitHub configuration](#required-github-configuration) · [Previews](#preview-deployments) ·
[Migrations](#hosted-migrations) · [Rollback](#hosted-rollback) ·
[Moving production data](#production-resource-migration-runbook)

## 1 Complete the one time Cloudflare steps

In the [Cloudflare dashboard](https://dash.cloudflare.com/):

- Activate your domain and choose a hostname such as `library.example.com`.
- Activate **R2 object storage** if prompted. Keep Workers on Free.
- Complete **Zero Trust** onboarding on Free. Under **Integrations → Identity
  providers**, enable **One-time PIN** if it is not already available.
- Under **Zero Trust → Access controls → Policies**, create a reusable Allow
  policy named `Libroo household`, initially allowing only your own email.
  Use your [Cloudflare Access email](#which-email-goes-where). You can edit the
  allowed addresses later in Cloudflare. The command discovers the policy ID.

Create a custom API token under **My Profile → API Tokens → Create Token →
Custom token**. Scope it to your production account and domain, with:

| Scope | Permission |
| --- | --- |
| Account | D1 Edit |
| Account | Workers Scripts Edit |
| Account | Workers R2 Storage Edit |
| Account | Account Settings Read |
| Account | Access: Apps and Policies Write or Edit |
| Account | Access: Organizations, Identity Providers, and Groups Read |
| Zone | Zone Read |
| Zone | Workers Routes Write or Edit |

Copy the token when it is shown; you will paste it into a hidden prompt. [Token creation instructions](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

## 2 Run the setup command

From an updated checkout with the setup changes on `main`, open Terminal.
With Node and pnpm installed, run:

```bash
# Install GitHub CLI if it is not already installed on your Mac.
brew install gh
# Sign in once with permission to administer this repository and run Actions.
gh auth login
pnpm install --frozen-lockfile
pnpm setup:cloudflare
```

Enter your Libroo hostname, Cloudflare API token, and an email you monitor as
the admin/operator for the [Open Library contact](#what-open-library-is-for).
Follow the GitHub Actions link printed by the command and wait for deployment
to succeed. [What the command configures](#what-the-setup-command-configures).

## 3 Create your account and finish

After deployment succeeds, open your HTTPS hostname. On the Cloudflare Access
screen, enter the email allowed by your policy and the login code sent to that
inbox. Then create your first Libroo account with an email and password and
confirm you can open `/admin/users`.

Then close registration and deploy that change:

```bash
pnpm setup:cloudflare --finish
```

This closes registration and starts the deployment that applies the change.
It does not ask for the Cloudflare token again. Once deployment succeeds, add
the second household email to your Cloudflare policy and share a Libroo invite
link from `/admin/invites`. Future normal setup runs preserve closed registration.

## 4 Save the billing alert and check access

In **Cloudflare → Manage Account → Billing → Billable Usage → Create budget
alert**, save an alert with a **1 USD** threshold and your recipient email.
The threshold is in USD; it is not an exact €1 conversion. This is an email alert,
not an R2 spending cap. [Billing alert instructions](https://developers.cloudflare.com/billing/manage/budget-alerts/)

Confirm that an unauthenticated browser encounters Access, an unapproved email
is denied, and you can add a book and view its cover after signing in. In the R2
bucket settings, confirm that the development URL and all custom domains are
disabled. Confirm that ordinary Libroo registration requires an invitation.

## Explanations

### Which email goes where

| Email | Who uses or monitors it | Purpose |
| --- | --- | --- |
| Cloudflare dashboard account | You, the hosting operator | Manage the Cloudflare account, infrastructure, and billing. |
| Cloudflare Access policy | Each household user | Receive a login code to enter the protected site. |
| Libroo account | Each household user | Sign in to Libroo and use their library. |
| Open Library contact | You, the Libroo admin/operator | Receive questions from Open Library about the app's API traffic. |

For each person, using the same email for Cloudflare Access and their Libroo
account keeps login simple. The two sign-in steps are independent: changing the
Access policy does not change the Libroo account email. Your Cloudflare dashboard
email and Open Library contact can use the same address or an operator alias.
Regular Libroo users do not need to monitor Open Library correspondence.

Cloudflare Access sends its own login codes. Libroo email verification,
password-reset emails, and email notifications are disabled in this setup; keep
your Libroo password securely.

### What Open Library is for

[Open Library](https://openlibrary.org/) supplies book details and cover images.
When you enter or scan an ISBN, Libroo uses it to fill in information such as
the title, authors, and publisher, saving you manual data entry. Your library
inventory and lending records are managed in Libroo.

Libroo includes the operator's contact email in its API requests so Open Library
can contact you about traffic or usage problems. No Open Library account or API
key is needed, and regular users do not need to supply their own contact address.
This setting does not require Plunk or enable email sending from Libroo.
[Open Library API guidance](https://openlibrary.org/developers/api)

### What the setup command configures

The command uses the discovery permissions to find your account, zone, and team
domain. It selects matching Cloudflare resources automatically, asking you to
choose if multiple matches exist. It then:

- Finds the account, zone, team domain, and household policy.
- Creates the GitHub `production` Environment when missing, restricted to `main`.
- Saves the required secrets and variables directly through GitHub CLI.
- Generates an auth secret once and preserves it on reruns.
- Configures operation without email delivery and starts deployment from `main`.

No credentials are written to a local file or committed. The Cloudflare token is
sent to GitHub as a secret through stdin. The existing deployment workflow reuses
your D1 database, creates private R2 if needed, configures Access, migrates, and
deploys. Follow the Actions link printed by the command.

An existing GitHub Environment keeps its protection rules. Private repositories
need a GitHub plan supporting Environments. If old repository-level email settings
or resource pins conflict with setup, the command identifies that condition and
stops before changing settings; remove those production-only values and rerun.
To save configuration without starting a deployment, use
`pnpm setup:cloudflare --no-deploy`.

The deployment workflow must already be on `main` with manual dispatch support.
An automatic deployment before settings exist may fail; setup starts a fresh run
after saving them.

## Optional private metadata modules

For production builds that include a private module, see
[public deployment with private modules](book-metadata-providers.md#deploy-from-a-public-repository-with-private-modules).
The default Open Library build needs no private repository or checkout key.

## Dashboard locations and troubleshooting

| What you need | Where to find it |
| --- | --- |
| Domain, zone ID, account ID | Cloudflare → Domains → your domain → Overview → API section |
| Team domain | Cloudflare → Zero Trust → Settings |
| Household emails | Cloudflare → Zero Trust → Access controls → Policies → Libroo household → Edit |
| Access application | Cloudflare → Zero Trust → Access controls → Applications → libroo-production |
| R2 privacy settings | Cloudflare → Storage & databases → R2 object storage → libroo-production → Settings |
| Worker addresses and preview URLs | Cloudflare → Workers & Pages → libroo-production → Settings → Domains & Routes |
| D1 database | Cloudflare → Storage & databases → D1 SQL database → libroo-production |
| GitHub secrets and variables | Repository → Settings → Environments → production |
| Deployment logs | GitHub → Actions → Deploy to Cloudflare → latest run → Deploy production |

Documentation and test-only pushes skip production deployment. After changing
GitHub secrets or variables, use **GitHub → Actions → Deploy to Cloudflare → Run
workflow → main → Run workflow** to apply them. Rerunning is safe: existing D1/R2
resources are reused, and R2 privacy and Access settings are written only when
they need correcting. Completed database migrations are not rolled back after a
failed deployment. See [repeat deployments](#repeat-deployments-and-deployment-cost)
for details.

For a personal deployment that only needs production, keep **Deploy to Cloudflare**
enabled and disable the other workflows under **GitHub → Actions → select a
workflow → ⋯ → Disable workflow**. This is a repository setting; the workflow
files can stay in place. Use the same menu to enable checks or previews later.

If setup cannot discover the zone or team domain, check the token permissions in
step 1 and confirm domain activation and Zero Trust onboarding are complete.
If it cannot find the policy, confirm its name is `Libroo household` and its
action is Allow. If deployment rejects a public R2 custom domain, disable it in
the bucket settings and rerun the workflow.

The [deployment reference](#required-github-configuration) contains
the complete settings table for manual configuration and optional email or OIDC.
It also covers [preview deployments](#preview-deployments),
[migrations](#hosted-migrations), and
[production data migration](#production-resource-migration-runbook).
Use [Backup and restore](backup-restore.md) to protect the library's data.

## Runtime and deployment reference

The hosted instance uses the Cloudflare runtime profile:

```bash
NUXT_LIBROO_RUNTIME_PROFILE=cloudflare
pnpm build:cloudflare
```

The generated Worker uses NuxtHub D1 and R2 bindings from `nuxt.config.ts`. The
active production resources are:

- Worker: `libroo-production`
- D1 database: `libroo-production`
- R2 bucket: `libroo-production`

Set `NUXT_CLOUDFLARE_WORKER_NAME` to select the Worker; the production workflow
pins it to `libroo-production`. Same-repository PRs validate the Cloudflare
build as part of their full preview deployment. The `Build Cloudflare Worker`
workflow is retained only for fork PRs, which cannot receive preview
Environment secrets. The `Deploy to Cloudflare` workflow runs on pushes to
`main` or manual dispatch from `main`. It validates the generated Wrangler
configuration and applies D1 migrations immediately
before deploy because Cloudflare D1 migrations are not applied by
`wrangler deploy` automatically.

### Repeat deployments and deployment cost

Production deployment skips pushes that change only `docs/`, `test/`, or the
root README, agent instructions, and pitch. Application, migration,
dependency, and workflow changes still deploy. To apply GitHub Environment
settings without a code change, open **Actions → Deploy to Cloudflare → Run
workflow**, select `main`, and run it manually; manual runs bypass path filters.

Every deployment checks the live Cloudflare configuration. Existing D1 and R2
resources are reused, an already disabled R2 development URL is left alone, and
the Access application is updated only when its managed settings differ.
Household email rules remain in the reusable Cloudflare policy. Public R2 custom
domains still block deployment, and unexpected attached Access policies are
removed when the application is reconciled.

D1 migration history prevents applying the same migration again. A failed run
does not roll back completed migrations or resource changes; rerunning reconciles
the existing state and retries the remaining work. Production runs stay
serialized so that a newer push cannot interrupt an active migration or deploy.
The pnpm dependency store is cached; Nuxt build output containing production
configuration is rebuilt rather than stored in a shared Actions cache.

### First Admin Setup

Follow the [Cloudflare deployment guide](#3-create-your-account-and-finish)
for first-account creation and closing registration. The first created user in
an empty database becomes an admin through Better Auth's `user.role` field.

User roles and bans are Better Auth state: use `user.role`, `user.banned`,
`user.ban_reason`, and `user.ban_expires`; do not create a separate Libroo auth
table.

### Promotion Policy

Hosted production policy:

- Protect `main`.
- Require the `Lint`, `Typecheck`, `Unit Tests`, `Docker Image`, and
  `Build Cloudflare Worker` checks before merge.
- Merging to `main` deploys `libroo-production` through the protected
  `production` GitHub Environment.
- Production D1 migrations run from `main` after merge, through the push or
  manual-dispatch deployment workflow.

Same-repository pull requests receive isolated Cloudflare previews. Fork pull requests remain build-only because they must not receive the `preview` GitHub Environment secrets. Production D1 migrations still run only after merge to protected `main`.

After the `Typecheck` workflow has completed at least once, add
`Typecheck` to the required status checks in the `main` branch protection
settings before relying on it as a merge gate.

If manual promotion becomes necessary, prefer a GitHub Environment approval or a workflow dispatch input over a permanently diverging production branch.

### Preview Deployments

Same-repository pull requests targeting `main` receive disposable, physical-first preview infrastructure:

- Worker: `libroo-pr-<number>`
- D1 database: `libroo-preview-pr-<number>`
- R2 bucket: `libroo-preview-pr-<number>`

The Worker keeps the generated NuxtHub binding names `DB` and `BLOB`. These are application-level variable names, not shared infrastructure: `DB` resolves to the D1 UUID embedded in that Worker's generated Wrangler config, and `BLOB` resolves to its configured R2 bucket name. Preview and production Workers can therefore use the same code-facing binding names while pointing at completely different physical resources.

The preview workflow keeps those resource identities separate and explicit:

- `PREVIEW_D1_DATABASE_NAME` identifies the D1 database being provisioned.
- `NUXT_HUB_CLOUDFLARE_DATABASE_ID` is captured from that named D1 database and becomes the generated `DB` target.
- `NUXT_HUB_CLOUDFLARE_BUCKET_NAME` becomes the generated `BLOB` target.
- `NUXT_CLOUDFLARE_WORKER_NAME` selects the per-PR Worker.

Immediately after the build and before migrations, `scripts/preview/validate-wrangler-config.mjs` fails closed unless the generated config targets the expected `libroo-pr-<number>` Worker, the expected `libroo-preview-pr-<number>` D1 UUID, and the expected preview R2 bucket. It also rejects custom routes, custom domains, cron triggers, missing `workers_dev`, additional D1/R2 bindings, and non-preview resource names. Only after that assertion passes can `wrangler d1 migrations apply DB` run. No preview uses the hosted D1 database, hosted R2 bucket, production Worker, or a custom domain.

Each preview is served from:

```text
https://libroo-pr-<number>.<account-subdomain>.workers.dev
```

The workflows bind to the `preview` GitHub Environment. Keep its Cloudflare token, account ID, and Better Auth secret isolated from production. Environment approvals can be used when same-repository contributors should not deploy without review. Every preview hostname is protected by a per-PR Cloudflare Access application which attaches one existing reusable Access policy.

The lifecycle is:

1. A same-repository pull request is opened, synchronized, or reopened.
2. `.github/workflows/preview-cloudflare.yml` checks the concurrent-preview ceiling.
3. The workflow creates or updates `libroo-preview-pr-<number>` as a Cloudflare Access application for the exact `workers.dev` hostname and attaches the configured reusable policy.
4. It idempotently creates the per-PR D1 database and R2 bucket.
5. It builds the Worker with the Access audience and captured D1 ID, validates the generated bindings, applies migrations to that isolated database, and optionally loads synthetic fixtures.
6. It syncs only the preview Better Auth secret and deploys the Worker.
7. It registers a transient GitHub deployment and creates or updates a sticky PR comment with the Access-protected `workers.dev` URL and status.
8. When the pull request closes, `.github/workflows/preview-cloudflare-cleanup.yml` deletes the Worker first, removes its Access application only after the Worker is confirmed absent, then deletes D1 and R2.
9. `.github/workflows/preview-cloudflare-sweep.yml` runs daily as a backstop and removes prefixed Worker, Access, D1, and R2 resources whose PR is no longer open.

Deploy, close cleanup, and scheduled sweep workflows share the
`cloudflare-preview-lifecycle` concurrency group. This serializes the quota
check with resource creation and prevents simultaneous PR runs from both
claiming the final available preview slot.

Fork pull requests never receive preview credentials. They continue through the build-only `.github/workflows/build-cloudflare.yml` path.

#### Safe Non-Production Defaults

The canonical checked-in values are in `scripts/preview/runtime.env`; the deployment workflow consumes that file rather than duplicating the values in workflow YAML.

| Setting | Preview behavior |
| --- | --- |
| Email verification | Disabled. No Plunk API key is synced, so email-dependent flows must degrade gracefully. |
| Turnstile | Disabled. Cloudflare's always-pass public test site and secret keys are used as non-secret test values. |
| Passkeys | Disabled by default. Set `NUXT_PUBLIC_PASSKEYS_ENABLED=true` on the `preview` GitHub Environment only when actively testing WebAuthn. |
| Public access | Denied by Cloudflare Access unless the visitor matches the reusable preview policy. Libroo also validates the Access JWT and fails closed when it is missing or invalid. |
| Legal Markdown and canonical URLs | Empty, so no production legal content endpoint is contacted. |
| Registration | Enabled for tester convenience. |
| Scheduled tasks | Wrangler cron triggers are omitted when `NUXT_CLOUDFLARE_PREVIEW=true`. |
| Better Auth origin | `NUXT_BETTER_AUTH_URL` is the exact generated origin, `https://libroo-pr-<number>.<account-subdomain>.workers.dev`. |
| Custom domain | `NUXT_CLOUDFLARE_CUSTOM_DOMAIN` must be unset. The generated Worker keeps `workers_dev: true`. |

The optional seed is disabled unless the `preview` Environment variable `PREVIEW_SEED_ENABLED` is `true`. `scripts/preview/seed.sql` contains only obviously fictional `example.invalid` users and imaginary books. It never contains production-derived data. Because seeded users can affect first-user role behavior, leave seeding disabled when testing initial admin setup.

#### Cloudflare Access Setup

Reuse an existing Cloudflare Zero Trust organization and identity provider. Create one reusable **Allow** policy specifically for preview testers under **Zero Trust → Access controls → Policies**. The policy can allow individual email addresses, an email domain, an identity-provider group, or another suitable identity rule. Do not use a reusable Bypass or Everyone policy, because that would make every generated preview public.

The preview workflow creates the applications; do not manually create an application for every PR. Each generated application:

- is named `libroo-preview-pr-<number>`;
- targets the exact `libroo-pr-<number>.<account-subdomain>.workers.dev` hostname;
- attaches the configured reusable policy;
- allows only the configured Authentik identity provider;
- enables instant authentication so Cloudflare redirects directly to Authentik
  instead of showing an identity-provider picker;
- is hidden from the App Launcher;
- uses a 24-hour application session;
- uses `SameSite=Lax` for the application authorization cookie so redirects
  from external identity providers can complete;
- supplies its unique audience to the Worker for JWT verification.

Configure these variables on the GitHub `preview` Environment:

| Variable | Where to find it |
| --- | --- |
| `CLOUDFLARE_ACCESS_IDP_ID` | The Cloudflare Access identity-provider UUID for the Authentik OIDC integration. This is Cloudflare's provider `id`, not Authentik's application/client ID. Use the API command below to list it. |
| `CLOUDFLARE_ACCESS_POLICY_ID` | The UUID of the reusable preview policy. List it with the API command below after granting the token Access read/write permission. |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | In Cloudflare, open **Zero Trust → Settings → Team name and domain**. Store the complete origin, for example `https://my-team.cloudflareaccess.com`. |

List reusable policy IDs:

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/access/policies" \
  | jq '.result[] | { id, name, decision }'
```

List Cloudflare Access identity-provider IDs:

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/access/identity_providers" \
  | jq '.result[] | { id, name, type }'
```

The selected Cloudflare token needs the existing Workers Scripts, D1, and R2 edit permissions plus the account-level **Access: Apps and Policies Write** permission. Scope the token to only the Cloudflare account used for previews. The reusable policy itself remains operator-managed; workflows only link it to and unlink it from per-PR applications.

Libroo's `server/middleware/preview-access.ts` is defense in depth behind Cloudflare's edge enforcement. It is enabled when `NUXT_CLOUDFLARE_PREVIEW=true` or `NUXT_CLOUDFLARE_ACCESS_ENABLED=true`, validates `Cf-Access-Jwt-Assertion` against the team domain's JWKS and the generated application's audience, and returns `403` for absent or invalid tokens. It returns `503` if an Access-protected build lacks its Access configuration. Production setup enables this verification too; ordinary self-hosted deployments leave it disabled.

#### Cost and Quota Safeguards

One open same-repository PR consumes one Access application, one Worker, one D1 database, and one R2 bucket. The expected steady state is therefore one complete resource set per open same-repository PR.

Set `PREVIEW_CONCURRENT_LIMIT` as a variable on the `preview` GitHub Environment to lower or raise the D1/R2 ceiling; the default workflow value is `10`. Before creating anything, the deploy workflow counts existing `libroo-preview-` D1 databases and R2 buckets. It fails with a remediation message when either resource type would exceed the ceiling. Updating an already-provisioned PR remains allowed at the ceiling. Workers and Access applications are not independently counted by this gate; close cleanup and the orphan sweep inventory all four resource types so incomplete or leaked sets are still removed.

Current Cloudflare allowances should be checked before changing the ceiling:

- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) measures rows read, rows written, and total storage across the account. The Workers Free allowance currently includes 5 million rows read per day, 100,000 rows written per day, and 5 GB total storage. Empty databases still consume a small amount of storage, and preview migrations count as usage.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/) currently includes 10 GB-month of Standard storage, 1 million Class A operations, and 10 million Class B operations per month. Uploads, object listings during cleanup, and test traffic share those account-wide allowances.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) currently include 100,000 requests per day on the Free plan. Preview Workers share the account limit; they do not each receive a separate allowance.
- [Cloudflare One account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/) currently allow 500 Access applications by default. Cleanup and sweeping prevent disposable preview applications from accumulating toward that account-wide limit.

The daily orphan sweep is the quota backstop behind close-event cleanup. In a healthy steady state, every preview Worker, Access application, D1 database, and R2 bucket maps to an open pull request. D1 and R2 counts stay at or below the configured ceiling; orphan count across every resource type should normally be zero.

#### Preview Limitations

- Preview URLs are `workers.dev` origins only. They do not validate production DNS, custom-domain routing, certificates, or hostname-specific policy.
- Email delivery and email verification are intentionally unavailable.
- Turnstile enforcement is intentionally unavailable because Access restricts the whole preview to authenticated testers before Libroo account flows are reached.
- Cron-driven audit cleanup and cover repair do not run.
- Cloudflare account-wide limits and API availability can still block provisioning or cleanup.
- The preview environment is disposable. Testers must not rely on its data surviving a force-push, manual cleanup, PR close, or sweep.

#### Troubleshooting and Manual Cleanup

To retry a failed close cleanup, open the failed `Cleanup Cloudflare Preview` run in GitHub Actions and choose **Re-run failed jobs**. The scheduled sweep can also be started immediately with **Run workflow** on `Sweep Cloudflare Preview Resources`.

Cleanup and sweep jobs write a summary containing detected, deleted, and failed resources. A cleanup failure also updates the sticky PR comment. An R2 failure that mentions emptying usually means the temporary remote cleaner could not start or access the bucket. D1 and Worker failures normally indicate missing token permissions, an API outage, or a resource that changed outside the workflow.

Manual cleanup for PR `123`:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...

# If the bucket contains known objects, delete them first.
pnpm exec wrangler r2 object delete libroo-preview-pr-123/path/to/object
pnpm exec wrangler r2 bucket delete libroo-preview-pr-123

pnpm exec wrangler d1 delete libroo-preview-pr-123 --skip-confirmation
node scripts/preview/worker-delete.mjs libroo-pr-123

# Find and delete a leaked Access application.
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/access/apps" \
  | jq '.result[] | select(.name == "libroo-preview-pr-123") | { id, name, domain }'

curl --fail-with-body --request DELETE --silent --show-error \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/access/apps/ACCESS_APP_ID"
```

If the R2 bucket contains unknown object keys, prefer re-running the cleanup workflow because it uses `scripts/preview/empty-r2-worker.mjs` to list and delete every object through the bucket binding. The Cloudflare dashboard is the other practical way to inspect and remove unknown objects before running `wrangler r2 bucket delete`.

All delete operations are intended to be idempotent: an already-absent resource is success. Worker cleanup uses Cloudflare's Workers service API directly instead of `wrangler delete`, because Wrangler also queries legacy Workers KV asset namespaces and would otherwise require unrelated KV permissions. If a command fails for another reason, verify that the token in the `preview` Environment has D1, R2, and Workers edit permissions and that `CLOUDFLARE_ACCOUNT_ID` targets the expected account.

### Required GitHub Configuration

Production Environment secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Wrangler deploy, D1 migration, R2, and custom-domain route access. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account for Wrangler. |
| `NUXT_HUB_CLOUDFLARE_DATABASE_ID` | Optional: pin an existing production D1 UUID; otherwise discovered or created by name. |
| `NUXT_HUB_CLOUDFLARE_BUCKET_NAME` | Optional: existing production bucket name; defaults to `libroo-production`. |
| `NUXT_BETTER_AUTH_SECRET` | Hosted auth secret. |
| `NUXT_OIDC_CLIENT_SECRET` | OIDC client secret when `NUXT_PUBLIC_OIDC_ENABLED=true`. |
| `NUXT_PLUNK_API_KEY` | Optional hosted email delivery. Required if email verification is enabled; omit with `NUXT_EMAIL_FROM` for operation without email. |
| `NUXT_OPEN_LIBRARY_CONTACT_EMAIL` | Contact address sent in Open Library requests so hosted Workers are identified and receive the documented identified-client limit. Configure this separately in both the `production` and `preview` GitHub Environments. |
| `NUXT_TURNSTILE_SECRET_KEY` | Hosted Turnstile server-side verification secret. |

For automated setup, use the [Cloudflare deployment guide](#1-complete-the-one-time-cloudflare-steps).
For manual configuration, open **GitHub repository → Settings → Environments →
production**. Create the Environment if needed, restrict deployment branches to
`main`, and add entries under **Environment secrets** or **Environment variables**
according to the tables here. Keep production values out of repository-wide
settings so previews cannot inherit them. Store the custom domain as a hostname;
store the auth URL and Environment URL as the corresponding HTTPS origin.

The [API token permissions](#1-complete-the-one-time-cloudflare-steps)
cover both automated discovery and production deployment.

Add `CLOUDFLARE_ZONE_ID` as a `production` Environment variable using the zone
ID that contains `NUXT_CLOUDFLARE_CUSTOM_DOMAIN`. Before building, registering
a deployment, or migrating D1, the workflow creates and immediately deletes a
uniquely named route on an unused hostname beneath the custom domain. This
proves zone-level Workers Routes Write access without changing the production
hostname.

Separately, retain the `preview` GitHub Environment with preview-scoped
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`NUXT_BETTER_AUTH_SECRET`, and `NUXT_OPEN_LIBRARY_CONTACT_EMAIL`, plus the `CLOUDFLARE_ACCESS_IDP_ID`,
`CLOUDFLARE_ACCESS_POLICY_ID`, and `CLOUDFLARE_ACCESS_TEAM_DOMAIN` variables
documented above. Do not put `NUXT_PLUNK_API_KEY`, the production Better Auth
secret, or production resource IDs in the preview Environment. No preview
workflow may reference the `production` Environment.

The Cloudflare deploy workflow syncs `NUXT_BETTER_AUTH_SECRET`, `NUXT_OIDC_CLIENT_SECRET` when enabled, `NUXT_PLUNK_API_KEY` when email delivery is configured,
`NUXT_OPEN_LIBRARY_CONTACT_EMAIL`, and, when Turnstile is enabled,
`NUXT_TURNSTILE_SECRET_KEY` with `wrangler secret bulk`. Do not configure these
values as plain GitHub variables or Wrangler vars.

Production Environment variables:

| Variable | Value or condition |
| --- | --- |
| `CLOUDFLARE_ZONE_ID` | Zone ID containing the production custom domain. |
| `CLOUDFLARE_ACCESS_POLICY_ID` | Reusable household Allow policy ID; its email rules remain managed in Cloudflare. |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | HTTPS Zero Trust team URL, for example `https://household.cloudflareaccess.com`. |
| `NUXT_BETTER_AUTH_URL` | Canonical production origin, including `https://`. |
| `NUXT_EMAIL_FROM` | Set only when email delivery is configured; use an address on a verified Plunk sender domain. |
| `NUXT_EMAIL_REPLY_TO` | Optional hosted reply-to address. |
| `NUXT_EMAIL_VERIFICATION_ENABLED` | `false` when deploying without email delivery; `true` requires an email provider. |
| `NUXT_PUBLIC_OIDC_ENABLED` | `true` only after the OIDC callback and discovery configuration have been tested. |
| `NUXT_OIDC_CLIENT_ID` | OIDC client ID; keep the matching `NUXT_OIDC_CLIENT_SECRET` in GitHub Secrets. |
| `NUXT_OIDC_DISCOVERY_URL` | Provider discovery URL, preferred over explicit endpoint variables. |
| `NUXT_OIDC_AUTHORIZATION_URL` / `NUXT_OIDC_TOKEN_URL` / `NUXT_OIDC_USER_INFO_URL` | Set all three only when discovery is unavailable. |
| `NUXT_OIDC_SCOPES` | `openid email profile` unless the provider requires additional scopes. |
| `NUXT_OIDC_TRUST_PROVIDER` | `false` by default; `true` permits automatic same-email linking for an existing locally verified user even without a provider `email_verified` claim. Use only when the IdP makes every asserted email authoritative. |
| `NUXT_PUBLIC_OIDC_DISPLAY_NAME` / `NUXT_PUBLIC_OIDC_ICON` | Optional client-visible provider label and icon. |
| `NUXT_EMAIL_PASSWORD_ENABLED` | `true`; set `false` only after validating OIDC sign-in. This also disables passkeys. |
| `NUXT_PUBLIC_REGISTRATION_ENABLED` | `false` after the first admin exists. |
| `NUXT_PUBLIC_PASSKEYS_ENABLED` | `true` only when local authentication is enabled and an HTTPS origin matches `NUXT_BETTER_AUTH_URL`; otherwise `false`. |
| `NUXT_PUBLIC_TURNSTILE_ENABLED` | `true` for hosted public deployments. |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` | Hosted Turnstile public site key. |
| `NUXT_TURNSTILE_ALLOWED_HOSTNAMES` | Hosted public hostname, or a comma-separated list if multiple hostnames serve the app. |
| `NUXT_PUBLIC_OPEN_LIBRARY_LINKS_ENABLED` | `false` unless the hosted operator intentionally wants third-party source links visible. |
| `NUXT_OPEN_LIBRARY_REQUEST_TIMEOUT_SECONDS` | `12` |
| `NUXT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS` | `20` |
| `NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_WINDOW_SECONDS` / `NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_MAX_REQUESTS` | `60` / `10` |
| `NUXT_BOOKS_ENRICHMENT_BATCH_SIZE` / `NUXT_BOOKS_ENRICHMENT_CONCURRENCY` | `20` / `4` |
| `NUXT_BOOKS_ENRICHMENT_LEASE_SECONDS` | `900` |
| `NUXT_BOOKS_ENRICHMENT_MAX_ATTEMPTS` / `NUXT_BOOKS_ENRICHMENT_BACKOFF_SECONDS` | `5` / `60` |
| `NUXT_BOOKS_ENRICHMENT_RECOVERY_TIME_BUDGET_SECONDS` / `NUXT_BOOKS_ENRICHMENT_RECOVERY_SAFETY_SECONDS` | `840` / `35` |
| `NUXT_LEGAL_MARKDOWN_FETCH_TIMEOUT_SECONDS` | `5` |
| `NUXT_PLUNK_SEND_TIMEOUT_SECONDS` | `5` |
| `NUXT_PUBLIC_LEGAL_PRIVACY_POLICY_URL` / `NUXT_PUBLIC_LEGAL_IMPRINT_URL` / `NUXT_PUBLIC_LEGAL_TERMS_URL` | Optional canonical hosted legal page URLs. |
| `NUXT_LEGAL_PRIVACY_POLICY_MARKDOWN_URL` / `NUXT_LEGAL_IMPRINT_MARKDOWN_URL` / `NUXT_LEGAL_TERMS_MARKDOWN_URL` | Optional Markdown source URLs, used when the matching canonical URL is empty. |
| `NUXT_CLOUDFLARE_CUSTOM_DOMAIN` | Production hostname used for the Wrangler custom-domain route and GitHub deployment URL. |
| `NUXT_CLOUDFLARE_WORKER_NAME` | The workflow pins this to `libroo-production`. |

For a private deployment without email delivery, set
`NUXT_EMAIL_VERIFICATION_ENABLED=false` and leave both `NUXT_PLUNK_API_KEY` and
`NUXT_EMAIL_FROM` unset. Signup invite links remain available to share manually;
email verification, password-reset emails, emailed invites, and email notifications
are unavailable. The workflow validates email settings before provisioning and
clears a stale Worker Plunk key when email is unconfigured. It retains the default
of email verification enabled for production unless explicitly set to false.

The deploy workflow defaults hosted production Turnstile enforcement to `true`.
To intentionally deploy a private or access-controlled Cloudflare Worker
without Turnstile, set the `production` Environment variable
`NUXT_PUBLIC_TURNSTILE_ENABLED=false`.

### Production Provisioning and Access

The deployment runs `scripts/production/provision-resources.mjs` before building.
It finds D1 `libroo-production` by name or validates an explicitly pinned UUID,
then creates missing D1 and R2 resources. New buckets use Standard storage.
Bindings are passed directly to the build; provisioning preserves existing data
and does not import data or run migrations.

Next, `scripts/production/secure-resources.mjs` disables the bucket's managed
`r2.dev` URL and checks that all R2 custom domains are disabled. Deployment stops
if any public bucket endpoint remains enabled. This check covers direct bucket
endpoints, not independent services an operator separately binds to the bucket.

The security step creates or updates the Access application `libroo-production`
for the production hostname, referencing the configured reusable Allow policy
without changing its email rules. An unrelated application already assigned to
the exact hostname causes setup to fail. The Worker verifies Access JWT signature,
issuer, and audience before serving application requests; missing or invalid
credentials fail closed. The production configuration disables `workers.dev` and
Worker preview URLs. Covers are served through Libroo's authenticated API.

Account onboarding, the household email policy, first-user setup, and billing
alerts are covered once in the [Cloudflare deployment guide](#1-complete-the-one-time-cloudflare-steps).

### Hosted Migrations

After provisioning and Access configuration, the `main` deployment runs these
steps for both pushes and manual dispatch:

```bash
pnpm build:cloudflare
node scripts/production/validate-wrangler-config.mjs .output/server/wrangler.json
pnpm exec wrangler d1 migrations apply DB --remote --config .output/server/wrangler.json
# CI pipes required Worker secrets into wrangler secret bulk here.
pnpm exec wrangler deploy --config .output/server/wrangler.json
```

Before migration, the workflow registers a non-transient production deployment
through the GitHub Deployments API and publishes an `in_progress` status with
the production Environment URL. The validator fails closed unless the generated
config targets `libroo-production`, the configured production custom domain,
the required scheduled tasks, and exactly the configured production D1 and R2
bindings. Migration and deploy cannot run if validation fails. A final
always-running step publishes `success` or `failure` against the captured
deployment ID; if registration failed before returning an ID, the status call
is safely skipped.

Migration files live in `server/db/migrations/sqlite`. Append new migrations; do not rewrite migration history for existing hosted data. For manual hosted migrations, use the same generated `.output/server/wrangler.json` after a Cloudflare build.

Do not run hosted migrations from pull request workflows. If a PR contains a
migration, it is validated by the `Lint`, `Typecheck`, `Unit Tests`,
`Docker Image`, and `Build Cloudflare Worker` checks, then applied only after
that PR is merged to protected `main`.

### Hosted Rollback

Rollback application code through the Cloudflare or NuxtHub deployment history by promoting the previous known-good deployment. Database migrations are forward-only unless a release explicitly ships a rollback plan. If a bad deploy includes a destructive migration, restore D1 and R2 from the documented backup workflow or apply a corrective forward migration, then redeploy the known-good application version. Do not restore hosted data from a backup whose manifest migration state or app version is ahead of the deployed code.

Before promoting a release that changes schema or storage behavior, confirm that export/import or backup coverage is current for the hosted instance. Hosted D1/R2 backup and restore commands live in [Backup And Restore](./backup-restore.md).

## Production Resource Migration Runbook

This is the operator-executed cutover from the historical `libroo-beta`
Worker, D1 database, and R2 bucket to the new production resources. Record every
resource ID, export location, object-copy report, verification result, cutover
time, and approval in the migration ticket. Do not alter the old resources
during the rollback window. Use the D1-first, R2-second backup order and
manifest guidance from [Backup And Restore](./backup-restore.md) for every
captured backup/export set.

### Create Production Resources (pre-maintenance)

1. Authenticate Wrangler to the production Cloudflare account and confirm the
   account ID before creating anything:

   ```bash
   export CLOUDFLARE_API_TOKEN=...
   export CLOUDFLARE_ACCOUNT_ID=...
   pnpm exec wrangler whoami
   ```

2. Create the D1 database and capture its UUID from both command output and a
   fresh inventory:

   ```bash
   pnpm exec wrangler d1 create libroo-production
   pnpm exec wrangler d1 list --json | tee d1-inventory-production.json
   ```

   Record the UUID for `libroo-production` as the future
   `NUXT_HUB_CLOUDFLARE_DATABASE_ID`.

3. Build a production config with the new UUID and resource names, then apply
   the complete checked-in migration history:

   ```bash
   export NUXT_CLOUDFLARE_WORKER_NAME=libroo-production
   export NUXT_CLOUDFLARE_CUSTOM_DOMAIN=libroo.example.com
   export NUXT_HUB_CLOUDFLARE_DATABASE_ID=NEW_D1_UUID
   export NUXT_HUB_CLOUDFLARE_BUCKET_NAME=libroo-production
   pnpm build:cloudflare
   node scripts/production/validate-wrangler-config.mjs .output/server/wrangler.json
   pnpm exec wrangler d1 migrations apply DB --remote \
     --config .output/server/wrangler.json
   ```

4. Create the R2 bucket and reproduce the existing beta bucket's region,
   jurisdiction, storage-class, CORS, lifecycle, and private-access posture.
   Do not add public development URLs or public bucket access:

   ```bash
   pnpm exec wrangler r2 bucket create libroo-production
   pnpm exec wrangler r2 bucket list
   ```

   Record `libroo-production` as the future
   `NUXT_HUB_CLOUDFLARE_BUCKET_NAME`.

5. Take an initial full D1 export from the beta database using Cloudflare's
   supported D1 export command. Keep this timestamped file immutable. Then
   create a data-only export of application tables so the already-applied
   production schema and `_hub_migrations` state are not overwritten:

   ```bash
   pnpm exec wrangler d1 export libroo-beta --remote \
     --output beta-initial-YYYYMMDDTHHMMSSZ.sql
   pnpm exec wrangler d1 export libroo-beta --remote --no-schema \
     --table account \
     --table admin_audit_log \
     --table session \
     --table signup_invites \
     --table user \
     --table verification \
     --table authors \
     --table book_authors \
     --table book_system_tags \
     --table books \
     --table loans \
     --table locations \
     --table tags \
     --table user_book_tags \
     --table user_books \
     --output beta-initial-data-YYYYMMDDTHHMMSSZ.sql
   pnpm exec wrangler d1 execute libroo-production --remote \
     --file beta-initial-data-YYYYMMDDTHHMMSSZ.sql
   ```

   Update the explicit table list whenever the schema gains a table. Review the
   export for transaction/pragma statements required by the current Wrangler
   version. Rehearse the export/import against a disposable D1 database before
   touching `libroo-production`, and verify that the import does not replace or
   duplicate migration-history rows.

6. Configure audited S3-compatible remotes for the beta and production R2
   buckets, then perform the initial bulk copy with `rclone` or an equivalent
   tool. Use copy semantics, not move or sync-with-delete:

   ```bash
   rclone copy r2-beta:libroo-beta r2-production:libroo-production \
     --checksum --fast-list --log-file r2-initial-copy.log --log-level INFO
   rclone check r2-beta:libroo-beta r2-production:libroo-production \
     --checksum --one-way --combined r2-initial-check.txt
   ```

   Prefer the checksum-based `rclone check` above. If either R2 remote cannot
   expose compatible hashes, rerun it with `--size-only` and record that result
   as a coarse key-and-size sanity check rather than integrity verification.
   Preserve the command version, configuration scope, logs, object counts, and
   bytes transferred in the migration record. Never expose private cover
   objects to make copying easier.

### Final Synchronization (maintenance window)

1. Announce the maintenance window and put the existing application into
   maintenance/read-only mode. Block account changes, invites, loans, library
   edits, metadata edits, and blob uploads. Confirm no background or operator
   process can write to D1 or R2.
2. Wait for in-flight requests to finish, then take a final full timestamped D1
   export from `libroo-beta`. Repeat the data-only export with the complete
   application-table list above. Use the rehearsed clear-and-reimport procedure
   or an audited delta import so the initial copy is replaced without duplicate
   rows while the target schema and `_hub_migrations` state remain intact.
3. Run a final `rclone copy` from the beta bucket to `libroo-production`, again
   without deletion, followed by `rclone check`.
4. Verify D1 row counts table by table and inspect representative critical
   records:

   - Better Auth users, accounts, sessions, verification records, and auth
     secrets/identifiers where applicable.
   - Roles, bans, invites, admin audit, and auth audit records.
   - Books, authors, locations, tags, loans, user-library records, and their
     join tables.
   - The D1 migration table and its applied migration sequence.

   Save source and destination query output. Counts must match unless a
   documented transformation explains the difference.
5. Compare R2 object counts and total bytes. Use checksums where the tool and
   object metadata support them; otherwise compare keys and sizes, and manually
   read a representative sample including private cover objects.
6. Update the `production` GitHub Environment secret
   `NUXT_HUB_CLOUDFLARE_DATABASE_ID` to the new D1 UUID and
   `NUXT_HUB_CLOUDFLARE_BUCKET_NAME` to `libroo-production`. Reconfirm all
   production runtime variables and secrets before allowing the deployment.

### Deploy Production Worker and Custom Domain Cutover

1. Merge or push the approved release commit to protected `main` to trigger
   `.github/workflows/deploy-cloudflare.yml`.
2. Confirm the workflow binds to the `production` Environment, registers the
   GitHub deployment, builds, validates, migrates, syncs secrets, and deploys in
   that order.
3. In Cloudflare, inspect `libroo-production` before cutover:

   - Cron triggers are `0 3 * * *` and `30 3 * * *`.
   - Observability and logs are enabled.
   - Source maps are uploaded.
   - Runtime variables and encrypted Worker secrets contain production values.
   - `workers_dev` is disabled and the intended custom-domain route is present.
   - D1 `DB` and R2 `BLOB` point to the new production resources.

4. Remove or detach the canonical custom-domain route from `libroo-beta`, then
   attach the same custom domain to `libroo-production`. Make only one Worker
   authoritative for the hostname. Verify DNS, certificate, route ownership,
   and an HTTPS response from the canonical origin.
5. Run the post-cutover smoke checklist while writes remain controlled:

   - Login, logout, signup/invite policy, password reset, and auth callbacks.
   - Plunk email delivery and configured sender/reply-to behavior.
   - Turnstile on every enabled public flow.
   - Representative D1 reads and writes, including admin/audit behavior.
   - R2 read and write, including private cover upload and retrieval.
   - Privacy policy, imprint, and terms links/content.
   - Manual execution or observation of both scheduled tasks.

6. Treat the deployment as accepted only after the smoke checklist passes.
   Preserve the results with the GitHub deployment/migration record. The
   workflow publishes its terminal API status from the job result; if smoke
   testing finds a defect afterward, immediately publish a failed/inactive
   operational status in the incident record and begin rollback.
7. Exit maintenance/read-only mode and resume writes only after acceptance.

### Rollback Window and Retirement

Keep `libroo-beta`, its old D1 database, and its old R2 bucket unchanged and
read-only for the explicitly recorded rollback window. Do not run cleanup,
migrations, lifecycle changes, or object deletions against them.

If rollback is required:

1. Re-enter maintenance/read-only mode and stop writes to
   `libroo-production`.
2. Assess whether production accepted writes after cutover. Export and preserve
   them before rollback; do not silently discard them.
3. Detach the canonical custom domain from `libroo-production` and reattach it
   to `libroo-beta`.
4. Verify DNS/certificate routing, run the critical smoke checks against the
   beta Worker, then resume writes only when the rollback target is healthy.
5. Record the failed release, data divergence, exports, and follow-up recovery
   plan.

Delete the beta Worker, old D1 database, or old R2 bucket only after all of the
following gates are satisfied:

- The rollback window has expired.
- Production smoke tests and normal usage remain healthy.
- D1 and R2 migration verification is recorded and approved.
- Required backups/exports and copy logs are retained under the backup policy.
- An authorized operator gives explicit deletion approval.
