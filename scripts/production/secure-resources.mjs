import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export async function secureResources(env = process.env, request = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID
  const token = env.CLOUDFLARE_API_TOKEN
  const bucket = env.NUXT_HUB_CLOUDFLARE_BUCKET_NAME
  const hostname = env.NUXT_CLOUDFLARE_CUSTOM_DOMAIN
  const teamDomain = env.NUXT_CLOUDFLARE_ACCESS_TEAM_DOMAIN
  const policyId = env.CLOUDFLARE_ACCESS_POLICY_ID
  if (!/^[a-f0-9]{32}$/i.test(account || '') || !token
    || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(bucket || '')
    || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(hostname || '')
    || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\/?$/i.test(teamDomain || '')
    || !/^[a-f0-9-]{36}$/i.test(policyId || '')) {
    throw new Error('Configure Cloudflare account/token, production bucket/hostname, HTTPS Access team domain, and CLOUDFLARE_ACCESS_POLICY_ID (a reusable Allow policy managed in Cloudflare).')
  }
  async function api(path, method = 'GET', body) {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000)
    })
    const payload = await response.json()
    if (!response.ok || payload.success !== true) throw new Error(`Cloudflare ${method} ${path} failed (HTTP ${response.status}).`)
    return payload
  }

  const policy = (await api(`access/policies/${policyId}`)).result
  if (policy.decision !== 'allow') throw new Error('Production Access requires a reusable Allow policy.')

  // Reconcile actual state on every run without rewriting an already private bucket.
  let managed = (await api(`r2/buckets/${bucket}/domains/managed`)).result
  if (managed.enabled !== false) {
    await api(`r2/buckets/${bucket}/domains/managed`, 'PUT', { enabled: false })
    managed = (await api(`r2/buckets/${bucket}/domains/managed`)).result
  }
  const custom = (await api(`r2/buckets/${bucket}/domains/custom`)).result
  if (managed.enabled !== false || !Array.isArray(custom.domains)
    || custom.domains.some(domain => domain.enabled !== false)) {
    throw new Error('R2 is publicly accessible. Disable all bucket custom domains before deploying.')
  }

  const apps = []
  for (let page = 1; ; page++) {
    const payload = await api(`access/apps?per_page=100&page=${page}`)
    apps.push(...payload.result)
    if (payload.result.length < 100) break
  }
  const matching = apps.filter(app => app.name === 'libroo-production')
  if (matching.length > 1) throw new Error('Multiple production Access applications found.')
  if (apps.some(app => app.domain === hostname && app.name !== 'libroo-production')) {
    throw new Error('Another Access application already protects this hostname; reconcile it before deploying.')
  }
  const body = {
    name: 'libroo-production',
    type: 'self_hosted',
    domain: hostname,
    destinations: [{ type: 'public', uri: hostname }],
    policies: [{ id: policyId, precedence: 1 }],
    app_launcher_visible: false,
    http_only_cookie_attribute: true,
    same_site_cookie_attribute: 'lax',
    session_duration: '24h'
  }
  const existing = matching.length ? (await api(`access/apps/${matching[0].id}`)).result : undefined
  // Cloudflare expands policy references and may add destination metadata. Compare
  // only fields owned by this script, but include every attached policy/destination.
  const matches = existing && Object.entries(body).every(([key, value]) => {
    if (key === 'policies') return existing.policies?.length === 1
      && existing.policies[0].id === policyId && existing.policies[0].precedence === 1
    if (key === 'destinations') return existing.destinations?.length === 1
      && existing.destinations[0].type === 'public' && existing.destinations[0].uri === hostname
      && !existing.destinations[0].overrides?.length
    return existing[key] === value
  })
  const app = matches ? existing : (await api(matching.length ? `access/apps/${matching[0].id}` : 'access/apps', matching.length ? 'PUT' : 'POST', body)).result
  if (!/^[a-f0-9]{64}$/i.test(app.aud || '')) throw new Error('Cloudflare did not return a valid Access audience.')
  return { NUXT_CLOUDFLARE_ACCESS_AUDIENCE: app.aud, NUXT_CLOUDFLARE_ACCESS_ENABLED: 'true' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const values = await secureResources()
    const output = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
    if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, output)
    console.log('Production R2 is private and Cloudflare Access is configured.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
