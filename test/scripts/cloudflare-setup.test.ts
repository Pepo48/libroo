import { describe, expect, it, vi } from 'vitest'
import { configureGitHub, discoverDeployment, repositoryFromRemote } from '../../scripts/production/setup.mjs'

const zone = { id: 'zone-id', name: 'example.com', status: 'active', account: { id: 'account-id', name: 'Home' } }
const config = {
  CLOUDFLARE_ACCOUNT_ID: 'account-id', CLOUDFLARE_ZONE_ID: 'zone-id',
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://home.cloudflareaccess.com', CLOUDFLARE_ACCESS_POLICY_ID: 'policy-id',
  NUXT_CLOUDFLARE_CUSTOM_DOMAIN: 'library.example.com', NUXT_BETTER_AUTH_URL: 'https://library.example.com'
}
const options = { repo: 'owner/libroo', config, token: 'private-token', contactEmail: 'owner@example.invalid' }
const choose = async (_label: string, items: unknown[]) => items[0]
function cloudflare(results: unknown[]) {
  return vi.fn(async () => new Response(JSON.stringify({ success: true, result: results.shift() })))
}
function github({ variables = [] as Array<{ name: string, value: string }>, secrets = [] as Array<{ name: string }>, missingEnvironment = false, repositorySecrets = [] as Array<{ name: string }>, repositoryVariables = [] as Array<{ name: string, value: string }> } = {}) {
  return vi.fn((args: string[], _input?: string) => {
    let value: unknown = {}
    if (args[0] === 'api' && args[1]?.includes('/contents/')) value = { content: Buffer.from('on:\n  workflow_dispatch:\n').toString('base64') }
    else if (args[0] === 'api' && args.length === 2 && missingEnvironment) return { status: 1, stdout: '', stderr: 'HTTP 404' }
    else if (args[0] === 'variable' && args[1] === 'list') value = args.includes('--env') ? variables : repositoryVariables
    else if (args[0] === 'secret' && args[1] === 'list') value = args.includes('--env') ? secrets : repositorySecrets
    return { status: 0, stdout: JSON.stringify(value), stderr: '' }
  })
}

describe('Cloudflare setup discovery', () => {
  it('targets origin rather than the upstream default of a fork', () => {
    expect(repositoryFromRemote('https://github.com/owner/libroo.git')).toBe('owner/libroo')
    expect(repositoryFromRemote('git@github.com:owner/libroo.git')).toBe('owner/libroo')
    expect(() => repositoryFromRemote('https://other.example/owner/libroo')).toThrow('origin remote')
  })

  it('discovers IDs and the existing household policy without modifying Cloudflare', async () => {
    const request = cloudflare([[], [zone], { buckets: [] }, { auth_domain: 'home.cloudflareaccess.com' }, [{ id: 'policy-id', name: 'Libroo household', decision: 'allow' }]])
    expect(await discoverDeployment({ token: 'private-token', hostname: 'library.example.com', choose }, request)).toEqual(config)
    expect(request).toHaveBeenCalledTimes(5)
    for (const call of request.mock.calls) expect(call).not.toContainEqual(expect.objectContaining({ method: 'POST' }))
  })

  it('requires a manually managed Allow policy instead of creating an email list', async () => {
    const request = cloudflare([[], [zone], {}, { auth_domain: 'home.cloudflareaccess.com' }, []])
    await expect(discoverDeployment({ token: 'private-token', hostname: 'library.example.com', choose }, request)).rejects.toThrow('Create a reusable Allow policy')
  })

  it('rejects a URL before making requests', async () => {
    const request = cloudflare([])
    await expect(discoverDeployment({ token: 'private-token', hostname: 'https://library.example.com', choose }, request)).rejects.toThrow('without https://')
    expect(request).not.toHaveBeenCalled()
  })

  it('stops on permission failures instead of writing guessed configuration', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 403 }))
    await expect(discoverDeployment({ token: 'private-token', hostname: 'library.example.com', choose }, request)).rejects.toThrow('HTTP 403')
  })
})

describe('GitHub production setup', () => {
  it('creates a main-only Environment, generates an auth secret, and dispatches main', async () => {
    const run = github({ missingEnvironment: true })
    await configureGitHub(options, run)
    expect(run).toHaveBeenCalledWith(expect.arrayContaining(['deployment-branch-policies'].map(part => expect.stringContaining(part))), expect.any(String))
    const authWrite = run.mock.calls.find(([args]) => args[0] === 'secret' && args[1] === 'set' && args[2] === 'NUXT_BETTER_AUTH_SECRET')
    expect(authWrite?.[1]).toMatch(/^[a-zA-Z0-9+/]{43}=$/)
    expect(run).toHaveBeenCalledWith(['workflow', 'run', 'deploy-cloudflare.yml', '--ref', 'main', '--repo', options.repo], undefined)
    // Tokens go to stdin, never process arguments.
    expect(run.mock.calls.some(([args]) => args.includes(options.token))).toBe(false)
    expect(run).toHaveBeenCalledWith(['secret', 'set', 'CLOUDFLARE_API_TOKEN', '--env', 'production', '--repo', options.repo], options.token)
  })

  it('preserves an auth secret and closed registration on reruns', async () => {
    const run = github({ secrets: [{ name: 'NUXT_BETTER_AUTH_SECRET' }], variables: [{ name: 'NUXT_PUBLIC_REGISTRATION_ENABLED', value: 'false' }] })
    await configureGitHub({ ...options, deploy: false }, run)
    expect(run.mock.calls.some(([args]) => args[0] === 'secret' && args[1] === 'set' && args[2] === 'NUXT_BETTER_AUTH_SECRET')).toBe(false)
    expect(run).toHaveBeenCalledWith(['variable', 'set', 'NUXT_PUBLIC_REGISTRATION_ENABLED', '--env', 'production', '--repo', options.repo], 'false')
    expect(run.mock.calls.some(([args]) => args[0] === 'workflow')).toBe(false)
  })

  it('closes registration without reading or rewriting Cloudflare credentials', async () => {
    const run = github()
    await configureGitHub({ ...options, finish: true, token: undefined }, run)
    expect(run.mock.calls).toHaveLength(3)
    expect(run).toHaveBeenCalledWith(['variable', 'set', 'NUXT_PUBLIC_REGISTRATION_ENABLED', '--env', 'production', '--repo', options.repo], 'false')
  })

  it('refuses to change an existing deployment for another hostname', async () => {
    const run = github({ variables: [{ name: 'NUXT_CLOUDFLARE_CUSTOM_DOMAIN', value: 'other.example.com' }] })
    await expect(configureGitHub(options, run)).rejects.toThrow('another hostname')
    expect(run.mock.calls.some(([args]) => args.includes('set') || args[0] === 'workflow')).toBe(false)
  })

  it('preserves repository-level closed registration and its auth secret', async () => {
    const run = github({ repositorySecrets: [{ name: 'NUXT_BETTER_AUTH_SECRET' }], repositoryVariables: [{ name: 'NUXT_PUBLIC_REGISTRATION_ENABLED', value: 'false' }] })
    await configureGitHub(options, run)
    expect(run).toHaveBeenCalledWith(['variable', 'set', 'NUXT_PUBLIC_REGISTRATION_ENABLED', '--env', 'production', '--repo', options.repo], 'false')
    expect(run.mock.calls.some(([args]) => args[0] === 'secret' && args[1] === 'set' && args[2] === 'NUXT_BETTER_AUTH_SECRET')).toBe(false)
  })

  it('refuses conflicting shared repository settings before changing deployment settings', async () => {
    const run = github({ repositorySecrets: [{ name: 'NUXT_PLUNK_API_KEY' }] })
    await expect(configureGitHub(options, run)).rejects.toThrow('Repository-level email settings')
    expect(run.mock.calls.some(([args]) => args.includes('set') || args[0] === 'workflow')).toBe(false)
  })

  it('requires the dispatch workflow on main before changing settings', async () => {
    const run = vi.fn(() => ({ status: 0, stdout: JSON.stringify({ content: Buffer.from('on:\n  push:\n').toString('base64') }), stderr: '' }))
    await expect(configureGitHub(options, run)).rejects.toThrow('Merge the setup changes into main')
    expect(run).toHaveBeenCalledTimes(1)
  })
})
