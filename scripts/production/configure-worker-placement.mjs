import { readFile, writeFile } from 'node:fs/promises'

const region = process.env.NUXT_CLOUDFLARE_PLACEMENT_REGION?.trim()
if (region) {
  if (!/^(aws|azure|gcp):[a-z0-9-]+$/.test(region)) {
    throw new Error('NUXT_CLOUDFLARE_PLACEMENT_REGION must be a cloud region such as aws:eu-central-1')
  }
  const configPath = process.argv[2]
  if (!configPath) throw new Error('Provide the path to the generated Wrangler configuration')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  config.placement = { region }
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n')
  console.log(`Worker placement region: ${region}`)
}
