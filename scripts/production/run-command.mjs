import { spawn } from 'node:child_process'
import { open, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

/** Keep private module source, compiler snippets and test fixtures out of public CI logs. */
export async function runDeploymentCommand(args, environment = process.env) {
  if (!args.length) throw new Error('A command is required.')
  let log
  if (environment.METADATA_PLUGIN_REPOSITORY) {
    const directory = environment.RUNNER_TEMP || tmpdir()
    await mkdir(directory, { recursive: true })
    log = await open(join(directory, `libroo-build-${randomUUID()}.log`), 'wx', 0o600)
  }
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), {
        env: environment, stdio: log ? ['ignore', log.fd, log.fd] : 'inherit'
      })
      child.on('error', reject)
      child.on('exit', (status, signal) => resolve(signal ? 1 : status ?? 1))
    })
    if (log) console.log(code === 0
      ? 'Command completed. Private module output was not published.'
      : 'Command failed. Output is retained only on the ephemeral runner to protect private source; reproduce locally to inspect it.')
    return code
  } finally { await log?.close() }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await runDeploymentCommand(process.argv.slice(2))
