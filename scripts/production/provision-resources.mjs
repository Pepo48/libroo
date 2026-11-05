import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// Only creates missing resources. Never migrates, deletes, or changes existing data.
export async function provisionResources(env = process.env, request = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID
  const token = env.CLOUDFLARE_API_TOKEN
  if (!/^[a-f0-9]{32}$/i.test(account || '') || !token) {
    throw new Error('Set CLOUDFLARE_ACCOUNT_ID (32 hex characters) and CLOUDFLARE_API_TOKEN.')
  }
  const name = 'libroo-production'
  const bucketName = env.NUXT_HUB_CLOUDFLARE_BUCKET_NAME || name
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(bucketName)
    || /^libroo-preview-pr-/.test(bucketName)) {
    throw new Error('Invalid production R2 bucket name.')
  }
  async function api(path, method = 'GET', body, allowMissing = false) {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000)
    })
    if (allowMissing && response.status === 404) return null
    const payload = await response.json()
    if (!response.ok || payload.success !== true) {
      // Do not log response bodies: credentials must never appear in CI logs.
      throw new Error(`Cloudflare ${method} ${path} failed (HTTP ${response.status}). Check token permissions and R2 activation.`)
    }
    return payload.result
  }

  let database
  if (env.NUXT_HUB_CLOUDFLARE_DATABASE_ID) {
    const id = env.NUXT_HUB_CLOUDFLARE_DATABASE_ID
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid configured D1 UUID.')
    database = await api(`d1/database/${id}`)
    if (database.name !== name) throw new Error(`Configured D1 must be named ${name}.`)
  } else {
    const matches = []
    for (let page = 1; ; page++) {
      const results = await api(`d1/database?name=${name}&per_page=100&page=${page}`)
      matches.push(...results.filter(item => item.name === name))
      if (results.length < 100) break
    }
    if (matches.length > 1) throw new Error('Multiple production D1 databases found.')
    database = matches[0]
  }
  // Validate existing targets before creating either resource.
  const bucket = await api(`r2/buckets/${bucketName}`, 'GET', undefined, true)
  database ??= await api('d1/database', 'POST', { name })
  if (!/^[a-f0-9-]{36}$/i.test(database.uuid || '')) throw new Error('Cloudflare returned an invalid D1 UUID.')
  if (!bucket) await api('r2/buckets', 'POST', { name: bucketName, storageClass: 'Standard' })
  return {
    NUXT_HUB_CLOUDFLARE_DATABASE_ID: database.uuid,
    NUXT_HUB_CLOUDFLARE_BUCKET_NAME: bucketName
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const resources = await provisionResources()
    const output = Object.entries(resources).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
    if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, output)
    console.log(output.trim())
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
