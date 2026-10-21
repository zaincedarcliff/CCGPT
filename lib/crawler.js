// Incremental, change-detecting crawler for the school knowledge base.
//
// Each run:
//   1. loads the persisted index (pages + chunks),
//   2. registers seeds + previously discovered pages, picks the ones that are *due* (never checked,
//      or older than their check interval), highest priority first,
//   3. fetches them (concurrently, politely, respecting robots.txt) within a time budget,
//   4. compares the content hash — unchanged pages only get `lastChecked` bumped; changed pages
//      are re-chunked and marked for embedding; links on official pages are added as new pages,
//   5. embeds the chunks that still lack vectors (changed pages first) within the remaining budget,
//   6. saves the index. Anything not finished simply carries over to the next run.
//
// The same function powers the daily Vercel cron (`api/scrape.js`, ~4 minute budget) and the
// local CLI (`node index.js`, unlimited budget for the initial full build).

import { fetchDocument, REQUEST_HEADERS } from './extract.js'
import { chunkText } from './chunk.js'
import { classifySource, normalizeUrl, isGoogleDocument } from './sources.js'
import { SEEDS, discoveryRule } from './seeds.js'
import { loadIndex, saveIndex, emptyIndex } from './kb.js'
import { embedTexts, embeddingsAvailable, quantize, EMBEDDING_MODEL, EMBEDDING_DIMS } from './embeddings.js'
import { transcribeImage, visionAvailable } from './vision.js'
import axios from 'axios'

const DEFAULTS = {
  budgetMs: Infinity,
  maxPages: Number(process.env.KB_MAX_PAGES || 450),
  concurrency: Number(process.env.KB_CRAWL_CONCURRENCY || 4),
  maxErrorsBeforeDrop: 4,
  embedReserveRatio: 0.35, // share of the budget kept for embedding + saving
  log: (...a) => console.log(...a),
}

// ---------------------------------------------------------------- robots.txt (per host, per run)

const robotsCache = new Map()
async function isAllowedByRobots(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const origin = u.origin
  if (!robotsCache.has(origin)) {
    robotsCache.set(
      origin,
      (async () => {
        try {
          const { data } = await axios.get(`${origin}/robots.txt`, { timeout: 8000, headers: REQUEST_HEADERS, responseType: 'text' })
          return parseRobots(String(data))
        } catch {
          return []
        }
      })(),
    )
  }
  const rules = await robotsCache.get(origin)
  return pathAllowedByRobots(rules, u.pathname + u.search)
}

/**
 * Google (and others) publish Allow rules before a blanket Disallow: /.
 * Longest matching prefix wins; an Allow wins a tie. An empty Disallow means allow all.
 */
export function parseRobots(txt) {
  const rules = []
  let applies = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const [k, ...rest] = line.split(':')
    const v = rest.join(':').trim()
    const key = k.trim().toLowerCase()
    if (key === 'user-agent') applies = v === '*' || /ccgpt/i.test(v)
    else if (applies && (key === 'allow' || key === 'disallow')) rules.push({ allow: key === 'allow', prefix: v })
  }
  return rules
}

export function pathAllowedByRobots(rules, path) {
  let best = null
  for (const rule of rules) {
    if (!rule.prefix) continue
    if (!path.startsWith(rule.prefix)) continue
    if (
      !best ||
      rule.prefix.length > best.prefix.length ||
      (rule.prefix.length === best.prefix.length && rule.allow && !best.allow)
    ) {
      best = rule
    }
  }
  return best ? best.allow : true
}

// ---------------------------------------------------------------- page records

function ensurePage(index, url, patch) {
  const key = normalizeUrl(url) || url
  const existing = index.pages[key]
  if (existing) {
    // Seeds always win on group/interval so a page we care about keeps its schedule.
    if (patch.group === 'seed') Object.assign(existing, { group: 'seed', checkIntervalHours: patch.checkIntervalHours })
    return existing
  }
  const tier = classifySource(key, { linkedFromOfficial: Boolean(patch.discoveredFrom) })
  const page = {
    url: key,
    title: null,
    tier,
    kind: patch.kind || 'html',
    group: patch.group || 'discovered',
    depth: patch.depth ?? 0,
    hash: null,
    lastChecked: null,
    lastChanged: null,
    lastModified: null,
    docYear: null,
    chunkCount: 0,
    status: 'pending',
    error: null,
    errorCount: 0,
    discoveredFrom: patch.discoveredFrom || null,
    checkIntervalHours: patch.checkIntervalHours || 72,
    addedAt: new Date().toISOString(),
  }
  index.pages[key] = page
  return page
}

function isDue(page, now) {
  if (!page.lastChecked) return true
  const backoff = page.status === 'error' ? Math.min(7 * 24, 24 * Math.max(1, page.errorCount)) : 0
  const interval = (page.checkIntervalHours || 72) + backoff
  return now - Date.parse(page.lastChecked) > interval * 3600 * 1000
}

function priority(page) {
  // lower = sooner. Never-checked seeds first, then due seeds, then pdfs/docs, then discovered html.
  const groupRank = page.group === 'seed' ? 0 : page.kind === 'pdf' || page.kind === 'doc' ? 1 : 2
  const neverChecked = page.lastChecked ? 1 : 0
  const age = page.lastChecked ? -Date.parse(page.lastChecked) : -Infinity
  return [neverChecked, groupRank, page.tier, age]
}

function cmpPriority(a, b) {
  const pa = priority(a)
  const pb = priority(b)
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  return 0
}

// ---------------------------------------------------------------- crawl

/**
 * @param {Partial<typeof DEFAULTS> & { onlyUrls?: string[] }} [options]
 */
export async function runCrawl(options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const log = opts.log
  const started = Date.now()
  const deadline = Number.isFinite(opts.budgetMs) ? started + opts.budgetMs : Infinity
  const fetchDeadline = Number.isFinite(opts.budgetMs) ? started + opts.budgetMs * (1 - opts.embedReserveRatio) : Infinity

  let index = await loadIndex({ force: true })
  if (index.embeddingModel !== EMBEDDING_MODEL || index.dims !== EMBEDDING_DIMS) {
    // Embedding space changed — vectors are incompatible; drop them (text stays, will re-embed).
    if (index.chunks.length) log(`[crawl] embedding model changed (${index.embeddingModel} → ${EMBEDDING_MODEL}); re-embedding all chunks`)
    for (const c of index.chunks) delete c.vec
    index.embeddingModel = EMBEDDING_MODEL
    index.dims = EMBEDDING_DIMS
  }
  if (!Object.keys(index.pages).length && !index.chunks.length) index = { ...emptyIndex(), ...index }

  for (const s of SEEDS) ensurePage(index, s.url, { group: 'seed', checkIntervalHours: s.interval, kind: 'html', depth: 0 })

  const now = Date.now()
  let queue = Object.values(index.pages).filter((p) => (opts.onlyUrls ? opts.onlyUrls.includes(p.url) : isDue(p, now)))
  queue.sort(cmpPriority)

  const stats = { checked: 0, changed: 0, unchanged: 0, errors: 0, discovered: 0, embedded: 0, skippedBudget: 0, dropped: 0 }
  const changedUrls = new Set()
  const discoveredThisRun = []

  const processPage = async (page) => {
    if (Date.now() > fetchDeadline) {
      stats.skippedBudget++
      return
    }
    if (!(await isAllowedByRobots(page.url))) {
      page.status = 'skipped'
      page.error = 'disallowed by robots.txt'
      page.lastChecked = new Date().toISOString()
      page.errorCount = (page.errorCount || 0) + 1
      if (page.group !== 'seed') page.checkIntervalHours = Math.max(page.checkIntervalHours || 72, 24 * 30)
      stats.errors++
      return
    }
    try {
      const doc = await fetchDocument(page.url)
      stats.checked++
      const nowIso = new Date().toISOString()
      page.lastChecked = nowIso
      page.lastModified = doc.lastModified
      page.kind = doc.kind === 'text' ? page.kind : doc.kind
      if (doc.title) page.title = doc.title
      page.status = 'ok'
      page.error = null
      page.errorCount = 0
      page.bytes = doc.bytes

      if (doc.text.length < 40) {
        // Empty/JS-only page: nothing to index, but not an error either.
        page.hash = doc.hash
        page.chunkCount = 0
        removeChunks(index, page.url)
        stats.unchanged++
      } else if (doc.hash === page.hash && index.chunks.some((c) => c.url === page.url)) {
        stats.unchanged++
      } else {
        page.hash = doc.hash
        page.lastChanged = nowIso
        page.docYear = doc.docYear
        removeChunks(index, page.url)
        // Images on official pages (bell schedules, flyers) → text via Gemini vision, cached per image URL.
        let text = doc.text
        if (page.tier === 1 && doc.images?.length && visionAvailable() && Date.now() < fetchDeadline) {
          index.imageText = index.imageText || {}
          for (const img of doc.images.slice(0, 4)) {
            let t = index.imageText[img.src]?.text
            if (t === undefined) {
              try {
                t = await transcribeImage(img.src, { pageTitle: page.title, alt: img.alt })
                index.imageText[img.src] = { text: t, at: nowIso, page: page.url }
                if (t) stats.imagesTranscribed = (stats.imagesTranscribed || 0) + 1
              } catch (err) {
                log(`[crawl] image transcription failed ${img.src} — ${String(err?.message || err).slice(0, 120)}`)
                t = ''
              }
            }
            if (t) text += `\n[Image transcription${img.alt ? `: ${img.alt}` : ''}]\n${t}`
          }
        }
        const chunks = chunkText(text, { title: page.title })
        chunks.forEach((text, ord) => index.chunks.push({ id: `${shortHash(page.url)}-${ord}`, url: page.url, ord, text }))
        page.chunkCount = chunks.length
        changedUrls.add(page.url)
        stats.changed++
        log(`[crawl] changed  ${page.url} (${chunks.length} chunks, ${doc.kind})`)
      }

      // Discovery: only from official HTML pages.
      if (doc.kind === 'html' && page.tier === 1 && doc.links.length) {
        for (const link of doc.links) {
          if (Object.keys(index.pages).length >= opts.maxPages) break
          if (index.pages[link.url]) continue
          const rule = discoveryRule(link.url, { fromUrl: page.url, depth: (page.depth ?? 0) + 1 })
          if (!rule.allow) continue
          if (classifySource(link.url, { linkedFromOfficial: true }) !== 1) continue
          const p = ensurePage(index, link.url, {
            group: rule.kind === 'html' ? 'discovered' : rule.kind,
            kind: rule.kind === 'doc' ? (isGoogleDocument(link.url) ? 'doc' : 'pdf') : rule.kind,
            depth: (page.depth ?? 0) + 1,
            discoveredFrom: page.url,
            checkIntervalHours: rule.interval,
          })
          if (link.text && !p.title) p.title = link.text
          discoveredThisRun.push(p)
          stats.discovered++
        }
      }
    } catch (err) {
      stats.errors++
      page.lastChecked = new Date().toISOString()
      page.status = 'error'
      page.errorCount = (page.errorCount || 0) + 1
      page.error = String(err?.message || err).slice(0, 200)
      const permanent = /maxContentLength|maxBodyLength|ENOTFOUND|larger than \d+ bytes/i.test(page.error)
      if (permanent && page.group !== 'seed') {
        page.status = 'skipped'
        page.errorCount = opts.maxErrorsBeforeDrop
      }
      if (page.errorCount >= opts.maxErrorsBeforeDrop && page.group !== 'seed') {
        removeChunks(index, page.url)
        page.chunkCount = 0
        stats.dropped++
      }
      log(`[crawl] failed   ${page.url} — ${page.error}`)
    }
  }

  // Simple worker pool. Newly discovered pages join the queue immediately so PDFs linked from
  // a handbook page get indexed in the same run when budget allows.
  let cursor = 0
  const workers = Array.from({ length: opts.concurrency }, async () => {
    for (;;) {
      if (cursor >= queue.length) {
        if (discoveredThisRun.length) {
          const fresh = discoveredThisRun.splice(0).filter((p) => !p.lastChecked)
          fresh.sort(cmpPriority)
          queue = queue.concat(fresh)
          if (cursor >= queue.length) return
        } else return
      }
      const page = queue[cursor++]
      if (!page) return
      await processPage(page)
    }
  })
  await Promise.all(workers)

  // ------------------------------------------------------------ embeddings
  const pending = index.chunks.filter((c) => !c.vec)
  // Changed pages first so today's updates are searchable semantically right away.
  pending.sort((a, b) => Number(changedUrls.has(b.url)) - Number(changedUrls.has(a.url)))
  if (pending.length && embeddingsAvailable()) {
    log(`[crawl] embedding ${pending.length} chunks (${EMBEDDING_MODEL}, ${EMBEDDING_DIMS}d)`)
    const BATCH = Number(process.env.KB_EMBED_BATCH || 25)
    let consecutiveFailures = 0
    for (let i = 0; i < pending.length; i += BATCH) {
      if (Date.now() > deadline - 15000) {
        log(`[crawl] budget reached — ${pending.length - i} chunks left for next run`)
        break
      }
      const batch = pending.slice(i, i + BATCH)
      try {
        const vecs = await embedTexts(batch.map((c) => c.text), 'RETRIEVAL_DOCUMENT')
        vecs.forEach((v, j) => (batch[j].vec = quantize(v)))
        stats.embedded += batch.length
        consecutiveFailures = 0
      } catch (err) {
        const msg = String(err?.message || err)
        log(`[crawl] embedding batch failed — ${msg.slice(0, 160)}`)
        consecutiveFailures++
        // Serverless: stop and let the next run continue. CLI (no deadline): wait out rate limits.
        if (/exceeded your current quota|check your plan|PerDay/i.test(msg)) break
        if (Number.isFinite(deadline) || consecutiveFailures > 6 || !/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) break
        log('[crawl] rate limited — pausing 65s before continuing')
        await new Promise((r) => setTimeout(r, 65000))
        i -= BATCH
      }
    }
  } else if (pending.length) {
    log(`[crawl] GEMINI_API_KEY not set — ${pending.length} chunks stored without embeddings (keyword search only)`)
  }

  const saved = await saveIndex(index)
  const elapsedMs = Date.now() - started
  const summary = {
    ...stats,
    pages: Object.keys(index.pages).length,
    chunks: index.chunks.length,
    chunksWithEmbeddings: index.chunks.filter((c) => c.vec).length,
    pendingEmbeddings: index.chunks.filter((c) => !c.vec).length,
    elapsedMs,
    savedTo: saved.url,
    savedBytes: saved.bytes,
  }
  log(`[crawl] done in ${(elapsedMs / 1000).toFixed(1)}s`, JSON.stringify(summary))
  return { index, summary }
}

function removeChunks(index, url) {
  index.chunks = index.chunks.filter((c) => c.url !== url)
}

function shortHash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Backwards-compatible export of the index in the original scraper's shape
 * (`[{ source, scrapedAt, content: string[] }]`), consumed by /api/data and the offline responder.
 */
export function toLegacySchoolData(index) {
  const out = []
  const byUrl = new Map()
  for (const c of index.chunks) {
    if (!byUrl.has(c.url)) byUrl.set(c.url, [])
    byUrl.get(c.url).push(c)
  }
  for (const page of Object.values(index.pages)) {
    if (page.status !== 'ok' || page.kind !== 'html' || page.group === 'discovered') continue
    const chunks = (byUrl.get(page.url) || []).sort((a, b) => a.ord - b.ord)
    const lines = []
    const seen = new Set()
    for (const c of chunks) {
      for (const line of c.text.split('\n')) {
        if (line.length > 40 && !seen.has(line)) {
          seen.add(line)
          lines.push(line)
        }
      }
    }
    if (lines.length) out.push({ source: page.url, scrapedAt: page.lastChecked, content: lines })
  }
  return out
}
