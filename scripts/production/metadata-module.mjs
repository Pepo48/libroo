import { execFileSync } from 'node:child_process'
import { appendFile, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveMetadataRef(value) {
  const requested = value?.trim() || 'main'
  if (requested === 'latest' || requested === 'main') return 'main'
  if (/^[a-f0-9]{40}$/.test(requested)) return requested
  throw new Error('Metadata plugin ref must be main, latest, or a complete 40-character commit SHA.')
}

export function validateMetadataModule(environment) {
  const repository = environment.METADATA_PLUGIN_REPOSITORY?.trim() || ''
  const ref = environment.METADATA_PLUGIN_REF?.trim() || ''
  if (!repository && !ref) return { enabled: false }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Metadata plugins require an owner/repository.')
  }
  if (!environment.METADATA_PLUGIN_SSH_KEY?.trim()) throw new Error('Configure the read-only METADATA_PLUGIN_SSH_KEY production secret.')
  return { enabled: true, ref: resolveMetadataRef(ref) }
}

export async function configureMetadataModule(environment) {
  if (!environment.METADATA_PLUGIN_REPOSITORY?.trim()) return
  const root = await realpath(resolve(environment.GITHUB_WORKSPACE, 'plugins'))
  const entry = environment.METADATA_PLUGIN_MODULE || 'module.mjs'
  if (/[\r\n]/.test(entry) || isAbsolute(entry)) throw new Error('Plugin module must be a relative path within its checkout.')
  const path = await realpath(resolve(root, entry))
  const within = relative(root, path)
  if (within.startsWith('..') || isAbsolute(within)) throw new Error('Plugin module must stay within its checkout.')
  if (!environment.GITHUB_ENV) throw new Error('GITHUB_ENV is required to configure the deployment module.')
  await appendFile(environment.GITHUB_ENV, `LIBROO_METADATA_MODULES=${path}\n`)
}

export async function recordMetadataRevision(environment) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: resolve(environment.GITHUB_WORKSPACE, 'plugins'), encoding: 'utf8'
  }).trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Cannot identify the checked-out metadata module commit.')
  const requested = resolveMetadataRef(environment.METADATA_PLUGIN_REF)
  if (requested !== 'main' && requested !== commit) throw new Error('Checked-out metadata commit does not match the configured pin.')
  await appendFile(environment.GITHUB_ENV, `METADATA_PLUGIN_COMMIT=${commit}\n`)
  if (environment.GITHUB_STEP_SUMMARY) {
    await appendFile(environment.GITHUB_STEP_SUMMARY, `### Metadata module\n\nRequested revision: \`${requested}\`\n\nChecked-out plugin commit: \`${commit}\`\n`)
  }
  return commit
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--configure') await configureMetadataModule(process.env)
  else if (process.argv[2] === '--record') await recordMetadataRevision(process.env)
  else {
    const configuration = validateMetadataModule(process.env)
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.')
    await appendFile(process.env.GITHUB_OUTPUT, `enabled=${configuration.enabled}\nref=${configuration.ref || ''}\n`)
  }
}
