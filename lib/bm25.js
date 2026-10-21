// Small in-memory BM25 keyword index. Built at load time over all KB chunks (a few thousand
// documents takes tens of milliseconds) and also used to rank ephemeral web-page chunks.

const STOPWORDS = new Set(
  'a an and are as at be but by for from has have how i in is it its of on or that the this to was what when where which who will with you your does do did can could should would about my me our we they their there here than then so if not no yes'.split(
    ' ',
  ),
)

const SYNONYMS = {
  hs: ['high', 'school'],
  cchs: ['cedar', 'cliff'],
  wssd: ['west', 'shore', 'school', 'district'],
  ap: ['advanced', 'placement'],
  nhs: ['national', 'honor', 'society'],
  gpa: ['grade', 'point', 'average'],
  hw: ['homework'],
  bball: ['basketball'],
  fball: ['football'],
  '&': ['and'],
}

export function tokenize(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9%.:/&-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const out = []
  for (let t of raw) {
    t = t.replace(/^[.:/-]+|[.:/-]+$/g, '')
    if (!t || STOPWORDS.has(t)) continue
    if (SYNONYMS[t]) {
      out.push(...SYNONYMS[t])
      continue
    }
    out.push(stem(t))
  }
  return out
}

/** Very light stemmer: plurals + common suffixes. Enough for "grades"→"grade", "policies"→"polici". */
function stem(t) {
  if (t.length <= 3) return t
  if (/ies$/.test(t)) return t.slice(0, -3) + 'i'
  if (/sses$/.test(t)) return t.slice(0, -2)
  if (/ing$/.test(t) && t.length > 5) return t.slice(0, -3)
  if (/s$/.test(t) && !/ss$/.test(t)) return t.slice(0, -1)
  return t
}

export class BM25 {
  /**
   * @param {string[]} docs tokenized or raw documents
   * @param {{ k1?: number, b?: number }} [opts]
   */
  constructor(docs, opts = {}) {
    this.k1 = opts.k1 ?? 1.4
    this.b = opts.b ?? 0.75
    this.docCount = docs.length
    this.tf = new Array(docs.length)
    this.len = new Float32Array(docs.length)
    this.df = new Map()
    let total = 0
    docs.forEach((doc, i) => {
      const toks = Array.isArray(doc) ? doc : tokenize(doc)
      const map = new Map()
      for (const t of toks) map.set(t, (map.get(t) || 0) + 1)
      this.tf[i] = map
      this.len[i] = toks.length
      total += toks.length
      for (const t of map.keys()) this.df.set(t, (this.df.get(t) || 0) + 1)
    })
    this.avgLen = total / Math.max(1, docs.length)
  }

  idf(term) {
    const n = this.df.get(term) || 0
    return Math.log(1 + (this.docCount - n + 0.5) / (n + 0.5))
  }

  /**
   * @param {string} query
   * @param {number} topK
   * @returns {{ index: number, score: number, matched: number }[]}
   */
  search(query, topK = 20) {
    const qTokens = [...new Set(tokenize(query))]
    if (!qTokens.length || !this.docCount) return []
    const scores = new Float64Array(this.docCount)
    const matched = new Uint8Array(this.docCount)
    for (const term of qTokens) {
      const idf = this.idf(term)
      if (!this.df.has(term)) continue
      for (let i = 0; i < this.docCount; i++) {
        const f = this.tf[i].get(term)
        if (!f) continue
        const denom = f + this.k1 * (1 - this.b + (this.b * this.len[i]) / this.avgLen)
        scores[i] += idf * ((f * (this.k1 + 1)) / denom)
        matched[i]++
      }
    }
    const results = []
    for (let i = 0; i < this.docCount; i++) if (scores[i] > 0) results.push({ index: i, score: scores[i], matched: matched[i] })
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  get queryTermCount() {
    return this._qtc
  }
}

/** Fraction of distinct query terms that appear in a text — cheap relevance sanity check. */
export function termCoverage(query, text) {
  const q = [...new Set(tokenize(query))]
  if (!q.length) return 0
  const t = new Set(tokenize(text))
  let hit = 0
  for (const term of q) if (t.has(term)) hit++
  return hit / q.length
}
