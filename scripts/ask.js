// Ask CCGPT from the terminal (runs the exact server pipeline, no browser / auth needed).
//   node scripts/ask.js "What is Cedar Cliff's grading scale?"
//   node scripts/ask.js --no-web "Who is the principal?"     (knowledge base only)
//   node scripts/ask.js --debug "When is homecoming?"        (print retrieval decision + sources)

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

const { answerQuestion } = await import('../lib/answer.js')

const args = process.argv.slice(2)
const noWeb = args.includes('--no-web')
const debug = args.includes('--debug')
const question = args.filter((a) => !a.startsWith('--')).join(' ').trim()
if (!question) {
  console.error('usage: node scripts/ask.js [--no-web] [--debug] "your question"')
  process.exit(1)
}

const result = await answerQuestion({ question, allowWeb: !noWeb, log: debug ? console.log : () => {} })
console.log('\n' + result.text + '\n')
if (result.sources.length) {
  console.log('Sources:')
  for (const s of result.sources) {
    console.log(`  [${s.n}] ${s.title} — ${s.publisher} (${s.tierLabel}${s.cited ? '' : ', consulted'}) ${s.url}`)
  }
}
if (debug) console.log('\nmeta:', JSON.stringify(result.meta, null, 2))
