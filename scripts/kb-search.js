// Inspect knowledge-base retrieval without calling the LLM.
//   node scripts/kb-search.js "grading scale"
//   node scripts/kb-search.js --stats            (index summary: pages, chunks, embeddings, per tier)
//   node scripts/kb-search.js --pages            (every indexed page + last checked / changed)

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(path.join(root, f))
  } catch {
    /* optional */
  }
}

const { loadIndex, indexStats, searchKnowledgeBase } = await import('../lib/kb.js')
const { classifyQuestion } = await import('../lib/retrieval.js')

const args = process.argv.slice(2)
const index = await loadIndex({ force: true })

if (args.includes('--stats') || !args.length) {
  console.log(JSON.stringify(indexStats(index), null, 2))
}
if (args.includes('--pages')) {
  for (const p of Object.values(index.pages).sort((a, b) => a.tier - b.tier || a.url.localeCompare(b.url))) {
    console.log(`${p.status.padEnd(7)} t${p.tier} ${String(p.kind).padEnd(4)} ${String(p.chunkCount).padStart(4)}ch  checked ${String(p.lastChecked || '-').slice(0, 10)}  changed ${String(p.lastChanged || '-').slice(0, 10)}  ${p.url}${p.error ? `  !! ${p.error}` : ''}`)
  }
}
const query = args.filter((a) => !a.startsWith('--')).join(' ').trim()
if (query) {
  console.log('classification:', classifyQuestion(query))
  const r = await searchKnowledgeBase(query, { topK: 8, index })
  console.log(`confidence: ${r.confidence.toFixed(3)}  stats: ${JSON.stringify(r.stats)}`)
  for (const h of r.hits) {
    console.log(`\n— score ${h.score.toFixed(3)} cos ${h.cosine.toFixed(3)} bm25 ${h.bm25.toFixed(2)} cov ${h.coverage.toFixed(2)} tier ${h.tier}  ${h.title}\n  ${h.url}\n  ${h.text.replace(/\n/g, ' | ').slice(0, 400)}`)
  }
}
