# Book metadata providers

Libroo includes Open Library for ISBN lookup, title search and refreshing saved
books. Optional catalog adapters register through one Effect layer; the editor,
search UI and book service do not import or name individual adapters.

## Add a provider

Implement `BookMetadataSource` from
[`book-metadata-sources.ts`](../server/services/book-metadata-sources.ts):

| Member | Purpose |
| --- | --- |
| `id`, `label` | Stable unique ID and user-facing source name. Reserve `auto` for automatic selection. |
| `lookup(isbn)` | Fetch full metadata for refresh previews; return `null` for a miss. |
| `lookupCore(isbn)` | Optional lightweight ISBN lookup for adding books. |
| `lookupMany(isbns)` | Optional batch capability; bulk import never fans out into individual remote scraping requests. |
| `searchByTitle(query, limit)` | Optional title search returning ISBN-addressable editions. |
| `local` | Mark offline catalogs so ordinary ISBN/bulk lookups check them before remote providers. Refresh previews prefer remote providers. |
| `attribution` | Optional source credit displayed with title results. |

Keep external requests and format parsing in repositories. Services validate,
coordinate providers and decide which results to use. Use
`BookMetadataSourceError` for provider failures. Register adapters in
`BookMetadataSources` through a replacement Effect layer. An optional Nuxt module
can override the `#libroo-metadata-sources` alias with a file that exports
`BookMetadataSourcesLive`. The layer should provide its own repositories and use
the host's `CatalogRequestService` when website request controls are needed. `BookMetadataSourcesLive` is the Open Library-only
default; adding a provider does not require changes to routes or UI components.

Provider IDs and URLs are trusted server configuration. Clients can select only
registered source IDs, never supply arbitrary fetch URLs. Title search merges
up to 20 editions, deduplicates ISBNs, preserves source attribution and reports
partial outages. A selected result follows the normal ISBN preview/add flow.

## Shared request controls

Website adapters can use `CatalogRequestService` with a configured target:

```ts
const target = { id: 'example', origin: 'https://catalog.example', spacingMs: 2000, dailyLimit: 100 }
const response = await client.get(target, '/search?q=isbn', signal)
```

The target must have a stable ID and an HTTPS origin. D1 coordinates one active
request per provider, spacing with jitter, UTC daily budgets, cached robots rules
and cooldowns across instances. Robots reads and redirect hops consume budget.
Crawl-delay and Retry-After may increase waiting times; cooldowns persist across
restarts. Off-origin redirects, challenge pages and disallowed URLs stop requests.
A database failure denies admission. The bounded transport never sends user
cookies or authentication headers and identifies itself as Libroo.

These controls also work with the self-hosted SQLite runtime. Providers using
an official API can retain their API-specific limiter; Open Library keeps its
existing identified-client request accounting rather than website robots rules.


## Load an external module

Keep optional adapters in their own checkout. Install that module's dependencies,
then set `LIBROO_METADATA_MODULES` to its module file when running Libroo:

```bash
LIBROO_METADATA_MODULES=../my-metadata-module/module.mjs pnpm build:cloudflare
```

The value is a comma-separated list of trusted local module paths, resolved from
the app root. Leave it unset for Open Library-only builds. No private repository
or credential is required by the public app. The `#libroo-core` alias points to
the host checkout so adapters reuse its services, types and request controls.
Import Effect runtime values from `#libroo-core/server/metadata-plugin-api` to
avoid separate runtime instances in an external module's dependency tree.

External modules own their dependencies, assets, provenance and tests. A private
module can own the production workflow, check out a pinned public app revision,
and build with its own module enabled. This keeps deployment secrets in the
private repository and requires no private-repository token in public CI.
