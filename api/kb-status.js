// GET /api/kb-status — health/diagnostics for the knowledge base and retrieval stack.
// Public summary is safe (counts + timestamps). Pass `Authorization: Bearer <CRON_SECRET>` and
// `?pages=1` to list every indexed page with its last-checked / last-changed dates and errors.
// `?q=<question>` (with the secret) runs a retrieval dry-run and shows what would be sent to the model.

import { loadIndex, indexStats } from '../lib/kb.js'
import { searchProvider, webSearchAvailable } from '../lib/webSearch.js'
import { embeddingsAvailable, EMBEDDING_MODEL } from '../lib/embeddings.js'
import { llmConfigured, MODEL, groundingFallbackEnabled } from '../lib/llm.js'
import { rateLimitStore } from '../lib/rateLimit.js'
import { firebaseProjectId } from '../lib/auth.js'
import { retrieveForQuestion } from '../lib/retrieval.js'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  const index = await loadIndex()
  const stats = indexStats(index)
  const isAdmin = Boolean(process.env.CRON_SECRET) && req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`

  const out = {
    ok: true,
    knowledgeBase: stats,
    services: {
      llm: llmConfigured() ? MODEL : null,
      embeddings: embeddingsAvailable() ? EMBEDDING_MODEL : null,
      webSearch: webSearchAvailable() ? searchProvider() : null,
      groundingFallback: groundingFallbackEnabled(),
      rateLimitStore: rateLimitStore(),
      authProject: firebaseProjectId() ? 'set' : 'MISSING',
    },
  }

  if (isAdmin && req.query?.pages) {
    out.pages = Object.values(index.pages)
      .map((p) => ({
        url: p.url,
        title: p.title,
        tier: p.tier,
        kind: p.kind,
        group: p.group,
        status: p.status,
        error: p.error,
        chunkCount: p.chunkCount,
        lastChecked: p.lastChecked,
        lastChanged: p.lastChanged,
        lastModified: p.lastModified,
        docYear: p.docYear,
        checkIntervalHours: p.checkIntervalHours,
        discoveredFrom: p.discoveredFrom,
      }))
      .sort((a, b) => a.tier - b.tier || String(a.url).localeCompare(String(b.url)))
  }

  if (isAdmin && req.query?.q) {
    const r = await retrieveForQuestion(String(req.query.q), { allowWeb: req.query.web !== '0' })
    out.dryRun = {
      decision: r.decision,
      kbConfidence: r.kbConfidence,
      web: r.web,
      sources: r.sources.map((s) => ({ n: s.n, url: s.url, title: s.title, tier: s.tier, origin: s.origin, passages: s.passages.map((p) => p.slice(0, 300)) })),
    }
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json(out)
}
