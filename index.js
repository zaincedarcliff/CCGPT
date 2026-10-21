// CLI: build / refresh the Cedar Cliff knowledge base from the terminal.
//
//   node index.js                 full incremental crawl (no time limit), embeds new chunks, saves index
//   node index.js --budget=120000 stop fetching after ~2 minutes (leftovers carry over)
//   node index.js --url=<url>     refresh one page only
//   node index.js --no-legacy     skip writing public/schoolData.json
//
// Storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is set (same store the deployed app reads),
// otherwise ./.kb/ on disk (what `npm run dev` reads). Reads .env.local automatically.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(path.join(__dirname, f))
  } catch {
    /* optional */
  }
}

const { runCrawl, toLegacySchoolData } = await import('./lib/crawler.js')
const { storageKind } = await import('./lib/storage.js')
const { SEED_URLS } = await import('./lib/seeds.js')
const { normalizeUrl } = await import('./lib/sources.js')

/** Backwards-compatible export of the seed URL list. */
export const urls = SEED_URLS

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

async function main() {
  const budget = Number(arg('budget', '')) || Infinity
  const urls = process.argv.filter((a) => a.startsWith('--url=')).map((a) => a.slice('--url='.length)).filter(Boolean)
  const writeLegacy = !process.argv.includes('--no-legacy')

  console.log(`CCGPT knowledge base build → storage: ${storageKind()}`)
  console.log(`GEMINI_API_KEY: ${process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY ? 'set (embeddings on)' : 'missing (keyword search only)'}`)

  const { index, summary } = await runCrawl({
    budgetMs: budget,
    onlyUrls: urls.length ? urls.map((u) => normalizeUrl(u) || u) : undefined,
    maxPages: Number(arg('max-pages', '')) || undefined,
  })

  if (writeLegacy) {
    const data = toLegacySchoolData(index)
    const outPath = path.join(__dirname, 'public', 'schoolData.json')
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2))
    console.log(`Wrote legacy ${outPath} (${data.length} sources)`)
  }
  console.log('Summary:', summary)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
