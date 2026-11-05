import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'

export function repositoryFromRemote(remote) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([a-z0-9_.-]+\/[a-z0-9_.-]+?)(?:\.git)?$/i.exec(remote.trim())
  if (!match) throw new Error('The origin remote must identify a github.com owner/repository.')
  return match[1]
}

export async function discoverDeployment({ token, hostname, choose }, request = fetch) {
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(hostname)) throw new Error('Enter a hostname such as library.example.com, without https:// or a path.')
  async function api(path) {
    const response = await request(`https://api.cloudflare.com/client/v4/${path}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000)
    })
    const body = await response.json()
    if (!response.ok || body.success !== true) {
      throw new Error(`Cloudflare discovery failed for ${path} (HTTP ${response.status}). Check token permissions, R2 activation, and Zero Trust onboarding.`)
    }
    return body
  }
  let zone
  const labels = hostname.split('.')
  for (let index = 0; index < labels.length - 1; index++) {
    const zones = (await api(`zones?name=${labels.slice(index).join('.')}&per_page=50`)).result
    if (zones.length) {
      zone = await choose('Cloudflare zone', zones, item => `${item.name} (${item.account.name})`)
      break
    }
  }
  if (!zone || zone.status !== 'active') throw new Error('No active Cloudflare zone matches this hostname. Add/activate the domain first.')
  const account = zone.account.id
  await api(`accounts/${account}/r2/buckets`)
  const organization = (await api(`accounts/${account}/access/organizations`)).result
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(organization.auth_domain || '')) {
    throw new Error('Complete Zero Trust onboarding and choose a team domain first.')
  }
  const policies = []
  for (let page = 1; ; page++) {
    const body = await api(`accounts/${account}/access/policies?per_page=100&page=${page}`)
    policies.push(...body.result.filter(policy => policy.decision === 'allow'))
    if (body.result.length < 100) break
  }
  if (!policies.length) throw new Error('Create a reusable Allow policy for your household in Cloudflare Zero Trust → Access controls → Policies, then rerun setup. Emails stay in Cloudflare.')
  const preferred = policies.filter(policy => policy.name === 'Libroo household')
  const policy = await choose('Reusable Access Allow policy', preferred.length ? preferred : policies, item => item.name)
  return {
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_ZONE_ID: zone.id,
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: `https://${organization.auth_domain}`,
    CLOUDFLARE_ACCESS_POLICY_ID: policy.id,
    NUXT_CLOUDFLARE_CUSTOM_DOMAIN: hostname,
    NUXT_BETTER_AUTH_URL: `https://${hostname}`
  }
}

function runGitHub(args, input) {
  return spawnSync('gh', args, { input, encoding: 'utf8', timeout: 60_000 })
}

export async function configureGitHub({ repo, config, token, contactEmail, finish = false, deploy = true }, run = runGitHub) {
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo)) throw new Error('Invalid GitHub owner/repository.')
  function gh(args, input, allowMissing = false) {
    const result = run(args, input)
    if (result.status !== 0) {
      if (allowMissing && /HTTP 404/.test(result.stderr || '')) return null
      throw new Error(`GitHub ${args[0]} failed. Check gh auth login, repository admin access, Environment support, and Actions permissions. No secret values are printed.`)
    }
    return result.stdout.trim()
  }
  const apiRoot = `repos/${repo}`
  const workflow = JSON.parse(gh(['api', `${apiRoot}/contents/.github/workflows/deploy-cloudflare.yml?ref=main`]))
  const workflowText = Buffer.from(workflow.content, 'base64').toString('utf8')
  if (!/^ {2}workflow_dispatch:/m.test(workflowText)) throw new Error('Merge the setup changes into main first, then rerun this command. The main workflow needs workflow_dispatch.')
  if (finish) {
    gh(['variable', 'set', 'NUXT_PUBLIC_REGISTRATION_ENABLED', '--env', 'production', '--repo', repo], 'false')
  } else {
    if (!token?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail || '')) throw new Error('Cloudflare token and Open Library contact email are required.')
    const environmentPath = `${apiRoot}/environments/production`
    const existingEnvironment = gh(['api', environmentPath], undefined, true)
    if (!existingEnvironment) {
      gh(['api', environmentPath, '--method', 'PUT', '--input', '-'], JSON.stringify({
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }
      }))
      gh(['api', `${environmentPath}/deployment-branch-policies`, '--method', 'POST', '--input', '-'], JSON.stringify({ name: 'main', type: 'branch' }))
    }
    const variables = JSON.parse(gh(['variable', 'list', '--env', 'production', '--repo', repo, '--json', 'name,value']))
    const previous = Object.fromEntries(variables.map(item => [item.name, item.value]))
    const repositorySecrets = JSON.parse(gh(['secret', 'list', '--repo', repo, '--json', 'name']))
    const repositoryVariables = JSON.parse(gh(['variable', 'list', '--repo', repo, '--json', 'name,value']))
    const repositorySettings = Object.fromEntries(repositoryVariables.map(item => [item.name, item.value]))
    const previousHostname = previous.NUXT_CLOUDFLARE_CUSTOM_DOMAIN || repositorySettings.NUXT_CLOUDFLARE_CUSTOM_DOMAIN
    if (previousHostname && previousHostname !== config.NUXT_CLOUDFLARE_CUSTOM_DOMAIN) {
      throw new Error('The production Environment already targets another hostname. Reconcile it manually before running setup.')
    }
    const conflictingNames = new Set(['NUXT_PLUNK_API_KEY', 'NUXT_HUB_CLOUDFLARE_DATABASE_ID', 'NUXT_HUB_CLOUDFLARE_BUCKET_NAME', 'NUXT_EMAIL_FROM'])
    if ([...repositorySecrets, ...repositoryVariables].some(item => conflictingNames.has(item.name))) {
      throw new Error('Repository-level email settings or resource pins would override automatic setup. Remove those production-only values from GitHub Settings → Secrets and variables → Actions, then rerun. Shared repository settings were not changed.')
    }
    const secretList = JSON.parse(gh(['secret', 'list', '--env', 'production', '--repo', repo, '--json', 'name']))
    const secretNames = new Set(secretList.map(item => item.name))
    const secrets = {
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: config.CLOUDFLARE_ACCOUNT_ID,
      NUXT_OPEN_LIBRARY_CONTACT_EMAIL: contactEmail
    }
    // GitHub cannot return secret values. Preserve the existing auth secret on reruns.
    if (!secretNames.has('NUXT_BETTER_AUTH_SECRET') && !repositorySecrets.some(item => item.name === 'NUXT_BETTER_AUTH_SECRET')) secrets.NUXT_BETTER_AUTH_SECRET = randomBytes(32).toString('base64')
    const settings = {
      ...config,
      NUXT_EMAIL_VERIFICATION_ENABLED: 'false',
      NUXT_EMAIL_PASSWORD_ENABLED: 'true',
      NUXT_PUBLIC_OIDC_ENABLED: 'false',
      NUXT_PUBLIC_PASSKEYS_ENABLED: 'false',
      NUXT_PUBLIC_TURNSTILE_ENABLED: 'false',
      // Never reopen registration after a completed setup.
      NUXT_PUBLIC_REGISTRATION_ENABLED: previous.NUXT_PUBLIC_REGISTRATION_ENABLED ?? repositorySettings.NUXT_PUBLIC_REGISTRATION_ENABLED ?? 'true'
    }
    delete settings.CLOUDFLARE_ACCOUNT_ID
    for (const [name, value] of Object.entries(secrets)) gh(['secret', 'set', name, '--env', 'production', '--repo', repo], value)
    for (const [name, value] of Object.entries(settings)) gh(['variable', 'set', name, '--env', 'production', '--repo', repo], value)
    // Clear old email config and binding pins so this setup uses automatic discovery.
    for (const name of ['NUXT_PLUNK_API_KEY', 'NUXT_HUB_CLOUDFLARE_DATABASE_ID', 'NUXT_HUB_CLOUDFLARE_BUCKET_NAME']) {
      if (secretNames.has(name)) gh(['secret', 'delete', name, '--env', 'production', '--repo', repo])
    }
    if (previous.NUXT_EMAIL_FROM !== undefined) gh(['variable', 'delete', 'NUXT_EMAIL_FROM', '--env', 'production', '--repo', repo])
  }
  if (deploy) gh(['workflow', 'run', 'deploy-cloudflare.yml', '--ref', 'main', '--repo', repo])
}

export async function ask(label, hidden = false) {
  if (!process.stdin.isTTY) throw new Error('Run setup in an interactive terminal.')
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    }
  })
  const prompt = createInterface({ input: process.stdin, output: hidden ? muted : process.stdout, terminal: true })
  try {
    if (hidden) process.stdout.write(label)
    return (await prompt.question(hidden ? '' : label)).trim()
  } finally {
    prompt.close()
    if (hidden) process.stdout.write('\n')
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('pnpm setup:cloudflare [--finish] [--no-deploy]\nInitial setup discovers Cloudflare settings, configures the GitHub production Environment, and starts deployment.\n--finish closes registration and starts deployment after you create the first account.\n--no-deploy saves settings without starting deployment. Requires gh auth login, an activated R2 account, Zero Trust, and a household Allow policy. Emails remain in Cloudflare.')
    return
  }
  if (args.some(arg => !['--finish', '--no-deploy'].includes(arg))) throw new Error('Unknown option. Use --help.')
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })
  if (origin.status !== 0) throw new Error('Run setup from a checkout with an origin remote.')
  const repo = repositoryFromRemote(origin.stdout)
  const repoResult = runGitHub(['repo', 'view', repo, '--json', 'nameWithOwner'])
  if (repoResult.status !== 0) throw new Error('Install GitHub CLI and run gh auth login with access to the origin repository, then rerun setup.')
  console.log(`Configuring ${repo}, Environment production. Household emails remain in Cloudflare.`)
  const finish = args.includes('--finish')
  if (finish) {
    await configureGitHub({ repo, finish, deploy: !args.includes('--no-deploy') })
  } else {
    const hostname = (await ask('Libroo hostname (e.g. library.example.com): ')).toLowerCase()
    const token = process.env.CLOUDFLARE_API_TOKEN || await ask('Cloudflare API token (hidden): ', true)
    const contactEmail = process.env.NUXT_OPEN_LIBRARY_CONTACT_EMAIL || await ask('Open Library contact email: ')
    const choose = async (label, items, display) => {
      if (items.length === 1) {
        console.log(`${label}: ${display(items[0])}`)
        return items[0]
      }
      console.log(label)
      items.forEach((item, index) => console.log(`${index + 1}. ${display(item)}`))
      const choice = Number(await ask('Select number: '))
      if (!Number.isInteger(choice) || choice < 1 || choice > items.length) throw new Error('Invalid selection; rerun setup.')
      return items[choice - 1]
    }
    const config = await discoverDeployment({ token, hostname, choose })
    await configureGitHub({ repo, config, token, contactEmail, deploy: !args.includes('--no-deploy') })
  }
  console.log(`Settings saved. ${args.includes('--no-deploy') ? 'Deployment was not started.' : `Follow deployment at https://github.com/${repo}/actions/workflows/deploy-cloudflare.yml`}`)
  if (!finish) console.log('Once deployed, create your first Libroo account, then run: pnpm setup:cloudflare --finish\nSave the $1 billing alert in Cloudflare Billing → Billable Usage → Create budget alert.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
