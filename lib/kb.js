// Persistent school knowledge base: index format, load/save, and hybrid (vector + keyword) search.
//
// Index layout (one JSON document, `kb/index.json`, plus a tiny `kb/meta.json` for cheap freshness checks):
//   {
//     version, updatedAt, embeddingModel, dims,
//     pages:  { [url]: { url, title, tier, kind, group, hash, lastChecked, lastChanged, lastModified,
//                        docYear, chunkCount, status, error, errorCount, discoveredFrom, checkIntervalHours } },
//     chunks: [ { id, url, ord, text, vec?: { q: base64-int8, s: scale } } ]
//   }
// `lastChecked` = when the crawler last fetched the page; `lastChanged` = when the content hash last
// changed (i.e. when the school actually updated it). Unchanged pages are never re-embedded.

import { readJson, writeJson, storageKind } from './storage.js'
import { BM25, tokenize, termCoverage } from './bm25.js'
import { dequantize, dot, embedQuery, embeddingsAvailable, EMBEDDING_MODEL, EMBEDDING_DIMS } from './embeddings.js'
import { tierWeight, publisherLabel, displayDomain } from './sources.js'

export const INDEX_KEY = 'kb/index.json'
export const META_KEY = 'kb/meta.json'
const CACHE_TTL_MS = Number(process.env.KB_CACHE_TTL_MS || 5 * 60 * 1000)

export function emptyIndex() {
  return {
    version: 2,
    updatedAt: null,
    embeddingModel: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,
    pages: {},
    chunks: [],
  }
}

// ---------------------------------------------------------------- load / save

/** @type {{ index: any, bm25: BM25|null, vectors: Float32Array[]|null, loadedAt: number, updatedAt: string|null } | null} */
let cache = null

export async function loadIndex({ force = false } = {}) {
  const now = Date.now()
  if (!force && cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.index
  // Cheap freshness probe: only download the big index if meta says it changed.
  if (!force && cache) {
    try {
      const meta = await readJson(META_KEY)
      if (meta?.updatedAt && meta.updatedAt === cache.updatedAt) {
        cache.loadedAt = now
        return cache.index
      }
    } catch {
      /* fall through to full load */
    }
  }
  const index = (await readJson(INDEX_KEY)) || emptyIndex()
  if (!index.pages) index.pages = {}
  if (!Array.isArray(index.chunks)) index.chunks = []
  cache = { index, bm25: null, vectors: null, loadedAt: now, updatedAt: index.updatedAt || null }
  return index
}

export async function saveIndex(index) {
  index.updatedAt = new Date().toISOString()
  index.version = 2
  const res = await writeJson(INDEX_KEY, index)
  await writeJson(META_KEY, {
    updatedAt: index.updatedAt,
    pages: Object.keys(index.pages).length,
    chunks: index.chunks.length,
    bytes: res.bytes,
    storage: storageKind(),
  })
  cache = { index, bm25: null, vectors: null, loadedAt: Date.now(), updatedAt: index.updatedAt }
  return res
}

export function invalidateIndexCache() {
  cache = null
}

function ensureSearchStructures(index) {
  if (!cache || cache.index !== index) cache = { index, bm25: null, vectors: null, loadedAt: Date.now(), updatedAt: index.updatedAt }
  if (!cache.bm25) cache.bm25 = new BM25(index.chunks.map((c) => tokenize(`${c.text}`)))
  if (!cache.vectors) cache.vectors = index.chunks.map((c) => (c.vec ? dequantize(c.vec) : null))
  return cache
}

// ---------------------------------------------------------------- search

/**
 * @typedef {Object} Hit
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} text
 * @property {number} tier
 * @property {number} score        fused score in [0, ~1]
 * @property {number} cosine       vector similarity (0 when unavailable)
 * @property {number} bm25         raw BM25 score
 * @property {number} coverage     fraction of query terms found in chunk
 * @property {string|null} lastChecked
 * @property {string|null} lastChanged
 * @property {string|null} docYear
 */

/**
 * Hybrid search over the KB. Reciprocal-rank fusion of BM25 and cosine rankings, then
 * re-weighted by source tier and document freshness.
 * @param {string} query
 * @param {{ topK?: number, index?: any, queryVector?: Float32Array|null }} [opts]
 * @returns {Promise<{ hits: Hit[], confidence: number, queryVector: Float32Array|null, stats: object }>}
 */
export async function searchKnowledgeBase(query, opts = {}) {
  const index = opts.index || (await loadIndex())
  const topK = opts.topK ?? 8
  if (!index.chunks.length) return { hits: [], confidence: 0, queryVector: null, stats: { chunks: 0 } }
  const { bm25, vectors } = ensureSearchStructures(index)

  const POOL = 40
  const bmHits = bm25.search(query, POOL)

  let queryVector = opts.queryVector ?? null
  let vecHits = []
  const hasVectors = vectors.some(Boolean)
  if (hasVectors && embeddingsAvailable()) {
    try {
      if (!queryVector) queryVector = await embedQuery(query)
      const scored = []
      for (let i = 0; i < vectors.length; i++) {
        const v = vectors[i]
        if (!v) continue
        scored.push({ index: i, score: dot(queryVector, v) })
      }
      scored.sort((a, b) => b.score - a.score)
      vecHits = scored.slice(0, POOL)
    } catch (err) {
      console.warn('[kb] query embedding failed, keyword-only search:', err?.message || err)
    }
  }

  // Reciprocal rank fusion
  const K = 60
  const fused = new Map()
  const add = (i, rank, kind, raw) => {
    const cur = fused.get(i) || { index: i, rrf: 0, cosine: 0, bm25: 0 }
    cur.rrf += 1 / (K + rank)
    if (kind === 'vec') cur.cosine = raw
    if (kind === 'bm') cur.bm25 = raw
    fused.set(i, cur)
  }
  bmHits.forEach((h, r) => add(h.index, r, 'bm', h.score))
  vecHits.forEach((h, r) => add(h.index, r, 'vec', h.score))

  const now = Date.now()
  const hits = []
  for (const f of fused.values()) {
    const chunk = index.chunks[f.index]
    const page = index.pages[chunk.url] || {}
    const tier = page.tier || 4
    const coverage = termCoverage(query, chunk.text)
    // Freshness: content that changed within the last year gets a small boost; very old pages a small penalty.
    const changedAt = page.lastChanged ? Date.parse(page.lastChanged) : NaN
    const ageDays = Number.isNaN(changedAt) ? 400 : (now - changedAt) / 86400000
    const freshness = ageDays < 120 ? 1.05 : ageDays < 400 ? 1.0 : 0.92
    // Both signals agreeing (appears in both rankings) is the strongest evidence.
    const both = f.cosine > 0 && f.bm25 > 0 ? 1.15 : 1
    // Keyword coverage lifts the chunk that actually contains the terms (e.g. the letter-grade
    // table) above a nearby policy page that only mentions "grading".
    const score = f.rrf * 30 * tierWeight(tier) * freshness * both * (0.75 + 0.5 * coverage)
    hits.push({
      id: chunk.id,
      url: chunk.url,
      title: page.title || chunk.url,
      text: chunk.text,
      tier,
      score,
      cosine: f.cosine,
      bm25: f.bm25,
      coverage,
      lastChecked: page.lastChecked || null,
      lastChanged: page.lastChanged || null,
      docYear: page.docYear || null,
      publisher: publisherLabel(chunk.url),
      domain: displayDomain(chunk.url),
    })
  }
  hits.sort((a, b) => b.score - a.score)
  const top = hits.slice(0, topK)

  // Confidence heuristic (0..1): strongest chunk's semantic similarity + keyword coverage, boosted when
  // the best hit is official. Tuned so that ~0.55+ means "the KB very likely contains the answer".
  let confidence = 0
  if (top.length) {
    const best = top[0]
    const cos = hasVectors ? Math.max(0, (best.cosine - 0.45) / 0.35) : 0 // 0.45→0, 0.80→1
    const cov = Math.max(...top.slice(0, 3).map((h) => h.coverage))
    const kw = Math.min(1, best.bm25 / 12)
    confidence = hasVectors ? 0.55 * cos + 0.3 * cov + 0.15 * kw : 0.6 * cov + 0.4 * kw
    if (best.tier === 1) confidence = Math.min(1, confidence * 1.1)
    confidence = Math.max(0, Math.min(1, confidence))
  }

  return {
    hits: top,
    confidence,
    queryVector,
    stats: { chunks: index.chunks.length, pages: Object.keys(index.pages).length, bmHits: bmHits.length, vecHits: vecHits.length, hasVectors },
  }
}

// ---------------------------------------------------------------- status

export function indexStats(index) {
  const pages = Object.values(index.pages || {})
  const ok = pages.filter((p) => p.status === 'ok')
  const pending = pages.filter((p) => p.status === 'pending' || !p.lastChecked)
  const skipped = pages.filter((p) => p.status === 'skipped')
  const withVec = index.chunks.filter((c) => c.vec).length
  const byTier = {}
  const byKind = {}
  for (const p of ok) {
    byTier[p.tier] = (byTier[p.tier] || 0) + 1
    byKind[p.kind] = (byKind[p.kind] || 0) + 1
  }
  const lastChecked = ok.map((p) => p.lastChecked).filter(Boolean).sort()
  return {
    updatedAt: index.updatedAt,
    pages: pages.length,
    pagesOk: ok.length,
    pagesPending: pending.length,
    pagesSkipped: skipped.length,
    pagesError: pages.filter((p) => p.status === 'error').length,
    chunks: index.chunks.length,
    chunksWithEmbeddings: withVec,
    byTier,
    byKind,
    oldestCheck: lastChecked[0] || null,
    newestCheck: lastChecked[lastChecked.length - 1] || null,
    embeddingModel: index.embeddingModel,
    storage: storageKind(),
  }
}
