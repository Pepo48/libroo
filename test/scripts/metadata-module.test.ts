import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { configureMetadataModule, recordMetadataRevision, validateMetadataModule } from '../../scripts/production/metadata-module.mjs'

const created: string[] = []
afterEach(async () => {
  await Promise.all(created.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
describe('optional private deployment module', () => {
  it('does not need a private credential for an Open Library-only deployment', () => {
    expect(validateMetadataModule({})).toEqual({ enabled: false })
  })
  it('supports latest main or an explicit pin, and still requires a read-only credential', () => {
    const valid = { METADATA_PLUGIN_REPOSITORY: 'owner/plugins', METADATA_PLUGIN_REF: 'a'.repeat(40), METADATA_PLUGIN_SSH_KEY: 'private-key-fixture' }
    expect(validateMetadataModule(valid)).toEqual({ enabled: true, ref: valid.METADATA_PLUGIN_REF })
    for (const ref of ['', 'main', 'latest']) {
      expect(validateMetadataModule({ ...valid, METADATA_PLUGIN_REF: ref })).toEqual({ enabled: true, ref: 'main' })
    }
    const { METADATA_PLUGIN_REF: _ref, ...withoutRef } = valid
    expect(validateMetadataModule(withoutRef)).toEqual({ enabled: true, ref: 'main' })
    for (const change of [{ METADATA_PLUGIN_REF: 'feature/unreviewed' }, { METADATA_PLUGIN_SSH_KEY: '' }, { METADATA_PLUGIN_REPOSITORY: 'https://example.com/repo' }]) {
      expect(() => validateMetadataModule({ ...valid, ...change })).toThrow()
    }
  })
  it('configures only a module file contained in the checked-out repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'libroo-module-'))
    created.push(root)
    await mkdir(join(root, 'plugins'))
    await writeFile(join(root, 'plugins/module.mjs'), 'export default {}')
    await writeFile(join(root, 'outside.mjs'), 'export default {}')
    await symlink(join(root, 'outside.mjs'), join(root, 'plugins/escape.mjs'))
    const environment = { METADATA_PLUGIN_REPOSITORY: 'owner/plugins', GITHUB_WORKSPACE: root, GITHUB_ENV: join(root, 'env') }
    await configureMetadataModule(environment)
    expect(await readFile(environment.GITHUB_ENV, 'utf8')).toBe(`LIBROO_METADATA_MODULES=${await realpath(join(root, 'plugins/module.mjs'))}\n`)
    for (const entry of ['../outside.mjs', 'escape.mjs', '/absolute.mjs', 'module.mjs\nEVIL=value']) {
      await expect(configureMetadataModule({ ...environment, METADATA_PLUGIN_MODULE: entry })).rejects.toThrow()
    }
  })
  it('records the actual checkout SHA and rejects a checkout that differs from an explicit pin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'libroo-revision-'))
    created.push(root)
    const checkout = join(root, 'plugins')
    execFileSync('git', ['init', '--initial-branch=main', checkout], { stdio: 'ignore' })
    execFileSync('git', ['-c', 'user.name=Libroo Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Test checkout'], { cwd: checkout, stdio: 'ignore' })
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim()
    const environment = { GITHUB_WORKSPACE: root, GITHUB_ENV: join(root, 'env'), GITHUB_STEP_SUMMARY: join(root, 'summary') }
    expect(await recordMetadataRevision(environment)).toBe(commit)
    expect(await readFile(environment.GITHUB_ENV, 'utf8')).toContain(`METADATA_PLUGIN_COMMIT=${commit}`)
    expect(await readFile(environment.GITHUB_STEP_SUMMARY, 'utf8')).toContain(commit)
    await expect(recordMetadataRevision({ ...environment, METADATA_PLUGIN_REF: 'a'.repeat(40) })).rejects.toThrow('configured pin')
  })
  it('does not publish private command output on either success or failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'libroo-logs-'))
    created.push(directory)
    const script = join(process.cwd(), 'scripts/production/run-command.mjs')
    const environment = { ...process.env, METADATA_PLUGIN_REPOSITORY: 'owner/plugins', RUNNER_TEMP: directory }
    const output = execFileSync(process.execPath, [script, process.execPath, '-e', 'console.log("PRIVATE_SOURCE_FIXTURE")'], { encoding: 'utf8', env: environment })
    expect(output).not.toContain('PRIVATE_SOURCE_FIXTURE')
    try {
      execFileSync(process.execPath, [script, process.execPath, '-e', 'console.error("PRIVATE_SOURCE_FIXTURE");process.exit(2)'], { encoding: 'utf8', env: environment, stdio: 'pipe' })
      throw new Error('Expected the command to fail')
    } catch (error) {
      const failure = error as { status?: number, stdout?: string, stderr?: string }
      expect(failure.status).toBe(2)
      expect(`${failure.stdout}${failure.stderr}`).not.toContain('PRIVATE_SOURCE_FIXTURE')
    }
  })
})
