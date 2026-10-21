// Live web search with official-source prioritization.
//
// Provider adapters (pick with WEB_SEARCH_PROVIDER or auto-detect from the key that is set):
//   - tavily  (TAVILY_API_KEY)                — built for RAG, supports include_domains, returns extracts
//   - brave   (BRAVE_SEARCH_API_KEY)          — supports `site:` operator + freshness
//   - google  (GOOGLE_CSE_KEY + GOOGLE_CSE_CX) — Google Programmable Search JSON API
//
// Flow for a school question:
//   1. Run an *official-only* query (restricted to WSSD / Cedar Cliff domains) and a general query
//      in parallel; add a "West Shore School District" variant when results are thin.
//   2. Merge + de-duplicate, drop blocked domains, score by tier, relevance, and freshness.
//   3. Fetch the best pages/PDFs (official first), chunk them, and rank the chunks against the
//      question (BM25 pre-filter, then embeddings when available).
// The result is a list of passages with full provenance the LLM can cite.

import { classifySource, tierWeight, normalizeUrl, publisherLabel, displayDomain } from './sources.js'
import { fetchDocument } from './extract.js'
import { chunkText } from './chunk.js'
import { BM25, tokenize, termCoverage } from './bm25.js'
import { embedTexts, embeddingsAvailable, dot } from './embeddings.js'

const OFFICIAL_DOMAINS = ['wssd.k12.pa.us', 'sites.google.com/wssd.bz', 'cedarcliffproductions.com']
const OFFICIAL_SITE_OPERATOR = '(site:wssd.k12.pa.us OR site:sites.google.com/wssd.bz)'

const PAGE_TIMEOUT_MS = Number(process.env.WEB_PAGE_TIMEOUT_MS || 12000)
const MAX_PAGES_TO_FETCH = Number(process.env.WEB_MAX_PAGES || 4)

// ---------------------------------------------------------------- provider selection

export function searchProvider() {
  const forced = (process.env.WEB_SEARCH_PROVIDER || '').trim().toLowerCase()
  if (forced) return forced
  if (process.env.TAVILY_API_KEY) return 'tavily'
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave'
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) return 'google'
  return null
}

export function webSearchAvailable() {
  const p = searchProvider()
  if (p === 'tavily') return Boolean(process.env.TAVILY_API_KEY)
  if (p === 'brave') return Boolean(process.env.BRAVE_SEARCH_API_KEY)
  if (p === 'google') return Boolean(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX)
  if (p === 'custom') return Boolean(process.env.WEB_SEARCH_ENDPOINT)
  return false
}

/**
 * `custom` provider: any HTTP endpoint (e.g. a self-hosted SearXNG proxy) that accepts
 * GET ?q=<query>&official=0|1 and returns { results: [{ url, title, snippet, publishedAt? }] }.
 */
async function customSearch(query, { officialOnly, maxResults }) {
  const url = new URL(process.env.WEB_SEARCH_ENDPOINT)
  url.searchParams.set('q', officialOnly ? `${query} ${OFFICIAL_SITE_OPERATOR}` : query)
  url.searchParams.set('official', officialOnly ? '1' : '0')
  url.searchParams.set('max', String(maxResults))
  const headers = process.env.WEB_SEARCH_ENDPOINT_TOKEN ? { Authorization: `Bearer ${process.env.WEB_SEARCH_ENDPOINT_TOKEN}` } : {}
  const res = await withTimeout(fetch(url, { headers }), 12000, 'custom search')
  if (!res.ok) throw new Error(`custom search ${res.status}`)
  const json = await res.json()
  const list = Array.isArray(json) ? json : json.results || []
  return list.map((r, i) => ({ url: r.url, title: r.title || '', snippet: r.snippet || r.content || '', publishedAt: isoOrNull(r.publishedAt), providerScore: 1 - i / 10 }))
}

// ---------------------------------------------------------------- adapters

/**
 * @typedef {Object} RawResult
 * @property {string} url
 * @property {string} title
 * @property {string} snippet
 * @property {string|null} publishedAt ISO date if the provider knows it
 * @property {number} providerScore 0..1 relevance from the provider (position-based when absent)
 */

async function withTimeout(promise, ms, label) {
  let t
  const timeout = new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`${label} timed out`)), ms)))
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(t)
  }
}

async function tavilySearch(query, { officialOnly, maxResults }) {
  const body = {
    query,
    search_depth: 'advanced',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    ...(officialOnly ? { include_domains: OFFICIAL_DOMAINS } : {}),
  }
  const res = await withTimeout(
    fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify(body),
    }),
    12000,
    'tavily',
  )
  if (!res.ok) throw new Error(`tavily ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  return (json.results || []).map((r, i) => ({
    url: r.url,
    title: r.title || '',
    snippet: r.content || '',
    publishedAt: r.published_date ? isoOrNull(r.published_date) : null,
    providerScore: typeof r.score === 'number' ? r.score : 1 - i / 10,
  }))
}

async function braveSearch(query, { officialOnly, maxResults }) {
  const q = officialOnly ? `${query} ${OFFICIAL_SITE_OPERATOR}` : query
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', q)
  url.searchParams.set('count', String(Math.min(20, maxResults)))
  url.searchParams.set('country', 'US')
  url.searchParams.set('search_lang', 'en')
  url.searchParams.set('text_decorations', 'false')
  const res = await withTimeout(
    fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY } }),
    12000,
    'brave',
  )
  if (!res.ok) throw new Error(`brave ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  return (json.web?.results || []).map((r, i) => ({
    url: r.url,
    title: r.title || '',
    snippet: r.description || '',
    publishedAt: isoOrNull(r.page_age || r.age),
    providerScore: 1 - i / 12,
  }))
}

async function googleSearch(query, { officialOnly, maxResults }) {
  const q = officialOnly ? `${query} ${OFFICIAL_SITE_OPERATOR}` : query
  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', process.env.GOOGLE_CSE_KEY)
  url.searchParams.set('cx', process.env.GOOGLE_CSE_CX)
  url.searchParams.set('q', q)
  url.searchParams.set('num', String(Math.min(10, maxResults)))
  const res = await withTimeout(fetch(url), 12000, 'google')
  if (!res.ok) throw new Error(`google cse ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  return (json.items || []).map((r, i) => {
    const meta = r.pagemap?.metatags?.[0] || {}
    const date = meta['article:modified_time'] || meta['og:updated_time'] || meta['article:published_time'] || meta['date'] || null
    return { url: r.link, title: r.title || '', snippet: r.snippet || '', publishedAt: isoOrNull(date), providerScore: 1 - i / 10 }
  })
}

function isoOrNull(v) {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

async function providerSearch(query, opts) {
  const p = searchProvider()
  if (p === 'tavily') return tavilySearch(query, opts)
  if (p === 'brave') return braveSearch(query, opts)
  if (p === 'google') return googleSearch(query, opts)
  if (p === 'custom') return customSearch(query, opts)
  throw new Error('no web search provider configured')
}

// ---------------------------------------------------------------- query building

const FILLER_RE =
  /\b(what|whats|what's|is|are|the|a|an|of|for|at|in|on|does|do|did|can|could|i|me|my|you|tell|about|please|hey|hi|to|how|when|where|who|which|there|this|that|it|its|it's|and|or|be|will|would|should|find|know|need|want|get)\b/gi

/** Turn a user question into a short topic string, e.g. "What is Cedar Cliff's grading scale?" → "grading scale". */
export function topicFromQuestion(question) {
  let t = String(question || '')
    .replace(/cedar\s*cliff(?:'s|s)?(\s+high\s+school)?/gi, ' ')
    .replace(/\bwssd\b|west\s+shore(\s+school\s+district)?/gi, ' ')
    .replace(/\bcchs\b/gi, ' ')
    .replace(/[?!.,;:"()]/g, ' ')
  t = t.replace(FILLER_RE, ' ').replace(/\s+/g, ' ').trim()
  return t || String(question).replace(/[?]/g, '').trim()
}

export function buildQueries(question, { year = new Date().getFullYear(), timeSensitive = false } = {}) {
  const topic = topicFromQuestion(question)
  const yearTag = timeSensitive ? ` ${year}` : ''
  return {
    official: `Cedar Cliff ${topic}${yearTag}`.trim(),
    general: `Cedar Cliff High School Camp Hill PA ${topic}${yearTag}`.trim(),
    district: `West Shore School District ${topic}${yearTag}`.trim(),
    topic,
  }
}

// ---------------------------------------------------------------- ranking

function rankResults(results, topic) {
  const seen = new Map()
  for (const r of results) {
    const url = normalizeUrl(r.url)
    if (!url) continue
    const tier = classifySource(url)
    if (!tier) continue // blocked / unusable
    const prev = seen.get(url)
    if (prev) {
      prev.providerScore = Math.max(prev.providerScore, r.providerScore)
      prev.hits++
      if (!prev.publishedAt && r.publishedAt) prev.publishedAt = r.publishedAt
      continue
    }
    seen.set(url, { ...r, url, tier, hits: 1 })
  }
  const now = Date.now()
  const out = []
  for (const r of seen.values()) {
    const ageDays = r.publishedAt ? (now - Date.parse(r.publishedAt)) / 86400000 : null
    const freshness = ageDays == null ? 0 : ageDays < 90 ? 0.35 : ageDays < 400 ? 0.2 : ageDays < 800 ? 0 : -0.2
    const overlap = termCoverage(topic, `${r.title} ${r.snippet}`)
    const isPdf = /\.pdf(\?|$)/i.test(r.url)
    const score = tierWeight(r.tier) * 2 + r.providerScore * 0.8 + overlap * 0.8 + freshness + (r.hits > 1 ? 0.2 : 0) + (isPdf && r.tier === 1 ? 0.1 : 0)
    out.push({ ...r, score, publisher: publisherLabel(r.url), domain: displayDomain(r.url) })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

/** Choose which results to open: mostly official, at most a couple of non-official when needed. */
function pickToFetch(ranked, max) {
  const official = ranked.filter((r) => r.tier === 1).slice(0, max)
  const rest = ranked.filter((r) => r.tier !== 1)
  const picks = [...official]
  const nonOfficialAllowed = official.length >= 2 ? 1 : max - official.length
  for (const r of rest) {
    if (picks.length >= max || picks.filter((p) => p.tier !== 1).length >= nonOfficialAllowed) break
    picks.push(r)
  }
  return picks
}

// ---------------------------------------------------------------- caches (per warm instance)

const docCache = new Map() // url -> { doc, at }
const searchCache = new Map() // key -> { results, at }
const DOC_TTL = 30 * 60 * 1000
const SEARCH_TTL = 10 * 60 * 1000

function cached(map, key, ttl) {
  const v = map.get(key)
  if (v && Date.now() - v.at < ttl) return v.value
  if (v) map.delete(key)
  return undefined
}
function remember(map, key, value, cap = 200) {
  map.set(key, { value, at: Date.now() })
  if (map.size > cap) map.delete(map.keys().next().value)
}

async function fetchDocCached(url) {
  const hit = cached(docCache, url, DOC_TTL)
  if (hit) return hit
  const doc = await withTimeout(fetchDocument(url, { timeoutMs: PAGE_TIMEOUT_MS }), PAGE_TIMEOUT_MS + 3000, `fetch ${url}`)
  remember(docCache, url, doc, 60)
  return doc
}

async function searchCached(query, opts) {
  const key = `${searchProvider()}|${opts.officialOnly ? 1 : 0}|${query}`
  const hit = cached(searchCache, key, SEARCH_TTL)
  if (hit) return hit
  const results = await providerSearch(query, opts)
  remember(searchCache, key, results)
  return results
}

// ---------------------------------------------------------------- main entry

/**
 * @typedef {Object} WebPassage
 * @property {string} url
 * @property {string} title
 * @property {string} text
 * @property {number} tier
 * @property {string} publisher
 * @property {string} domain
 * @property {string|null} publishedAt
 * @property {string|null} lastModified
 * @property {string|null} docYear
 * @property {number} score
 * @property {'web'} origin
 */

/**
 * Search the web for a school question and return ranked passages with provenance.
 * @param {string} question
 * @param {{ timeSensitive?: boolean, queryVector?: Float32Array|null, maxPassages?: number, log?: Function }} [opts]
 * @returns {Promise<{ passages: WebPassage[], results: object[], queries: string[], provider: string|null, fetched: string[], errors: string[] }>}
 */
export async function webSearchForQuestion(question, opts = {}) {
  const log = opts.log || (() => {})
  const provider = searchProvider()
  const empty = { passages: [], results: [], queries: [], provider, fetched: [], errors: [] }
  if (!webSearchAvailable()) return { ...empty, errors: ['web search not configured'] }

  const q = buildQueries(question, { timeSensitive: opts.timeSensitive })
  const queries = [q.official, q.general]
  const errors = []
  const settled = await Promise.allSettled([
    searchCached(q.official, { officialOnly: true, maxResults: 8 }),
    searchCached(q.general, { officialOnly: false, maxResults: 8 }),
  ])
  let raw = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') raw.push(...s.value)
    else errors.push(`${queries[i]}: ${s.reason?.message || s.reason}`)
  })
  let ranked = rankResults(raw, q.topic)
  if (ranked.filter((r) => r.tier <= 2).length < 3) {
    queries.push(q.district)
    try {
      raw.push(...(await searchCached(q.district, { officialOnly: false, maxResults: 8 })))
      ranked = rankResults(raw, q.topic)
    } catch (err) {
      errors.push(`${q.district}: ${err?.message || err}`)
    }
  }
  log(`[web] ${provider} queries=${JSON.stringify(queries)} results=${ranked.length}`)

  const toFetch = pickToFetch(ranked, MAX_PAGES_TO_FETCH)
  const docs = await Promise.allSettled(toFetch.map((r) => fetchDocCached(r.url)))
  const fetched = []
  const ephemeral = [] // { text, meta }
  docs.forEach((d, i) => {
    const r = toFetch[i]
    if (d.status !== 'fulfilled') {
      errors.push(`fetch ${r.url}: ${d.reason?.message || d.reason}`)
      // Still usable: the provider snippet itself, as a low-confidence passage.
      if (r.snippet) ephemeral.push({ text: `${r.title}\n${r.snippet}`, meta: { ...r, title: r.title, fromSnippet: true } })
      return
    }
    const doc = d.value
    fetched.push(doc.url)
    const chunks = chunkText(doc.text, { title: doc.title || r.title })
    for (const text of chunks) ephemeral.push({ text, meta: { ...r, title: doc.title || r.title, lastModified: doc.lastModified, docYear: doc.docYear } })
  })
  if (!ephemeral.length) return { ...empty, results: ranked, queries, errors }

  // Rank passages: BM25 pre-filter (cheap), then embeddings on the shortlist when available.
  const bm = new BM25(ephemeral.map((e) => tokenize(e.text)))
  const bmHits = bm.search(question, 40)
  const shortlist = bmHits.length ? bmHits.map((h) => ({ i: h.index, bm25: h.score })) : ephemeral.slice(0, 40).map((_, i) => ({ i, bm25: 0 }))
  let cos = new Map()
  if (opts.queryVector && embeddingsAvailable()) {
    try {
      const vecs = await embedTexts(shortlist.map((s) => ephemeral[s.i].text), 'RETRIEVAL_DOCUMENT')
      vecs.forEach((v, j) => cos.set(shortlist[j].i, dot(opts.queryVector, v)))
    } catch (err) {
      errors.push(`embedding web passages: ${err?.message || err}`)
    }
  }
  const maxBm = Math.max(1, ...shortlist.map((s) => s.bm25))
  const passages = shortlist
    .map((s) => {
      const e = ephemeral[s.i]
      const c = cos.get(s.i) ?? 0
      const rel = cos.size ? 0.6 * Math.max(0, (c - 0.4) / 0.4) + 0.4 * (s.bm25 / maxBm) : s.bm25 / maxBm
      const score = rel * tierWeight(e.meta.tier) * (e.meta.fromSnippet ? 0.6 : 1)
      return {
        url: e.meta.url,
        title: e.meta.title || e.meta.url,
        text: e.text,
        tier: e.meta.tier,
        publisher: e.meta.publisher,
        domain: e.meta.domain,
        publishedAt: e.meta.publishedAt || null,
        lastModified: e.meta.lastModified || null,
        docYear: e.meta.docYear || null,
        score,
        cosine: c,
        origin: 'web',
      }
    })
    .sort((a, b) => b.score - a.score)

  // Diversity: at most 3 passages per page.
  const perUrl = new Map()
  const picked = []
  for (const p of passages) {
    const n = perUrl.get(p.url) || 0
    if (n >= 3) continue
    perUrl.set(p.url, n + 1)
    picked.push(p)
    if (picked.length >= (opts.maxPassages ?? 8)) break
  }
  return { passages: picked, results: ranked, queries, provider, fetched, errors }
}
