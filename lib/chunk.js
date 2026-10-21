// Split a document into overlapping chunks suitable for embedding + keyword search.
// Chunks break on line boundaries (the extractor emits one logical line per block) so a
// counselor list, a bell-schedule table row, or a handbook paragraph stays intact.

const TARGET_CHARS = Number(process.env.KB_CHUNK_CHARS || 1100)
const OVERLAP_LINES = 2
const MAX_CHUNK_CHARS = TARGET_CHARS * 2

/**
 * @param {string} text newline-separated text
 * @param {{ title?: string }} [opts]
 * @returns {string[]}
 */
export function chunkText(text, opts = {}) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return []

  const chunks = []
  let cur = []
  let curLen = 0
  const flush = () => {
    if (!cur.length) return
    chunks.push(cur.join('\n'))
    // keep a little overlap so facts split across a boundary still co-occur somewhere
    cur = cur.slice(-OVERLAP_LINES)
    curLen = cur.reduce((n, l) => n + l.length + 1, 0)
  }

  for (const rawLine of lines) {
    // A single enormous "line" (e.g. a PDF page) gets split on sentence boundaries.
    const pieces = rawLine.length > MAX_CHUNK_CHARS ? splitLong(rawLine) : [rawLine]
    for (const line of pieces) {
      if (curLen + line.length > TARGET_CHARS && cur.length) flush()
      cur.push(line)
      curLen += line.length + 1
    }
  }
  if (cur.length && (chunks.length === 0 || cur.length > OVERLAP_LINES)) chunks.push(cur.join('\n'))

  const title = String(opts.title || '').trim()
  // Prefix each chunk with the document title so "Bell Schedule" context survives chunking.
  return chunks.map((c) => (title && !c.startsWith(title) ? `${title}\n${c}` : c))
}

function splitLong(line) {
  const out = []
  const sentences = line.split(/(?<=[.!?])\s+/)
  let cur = ''
  for (const s of sentences) {
    if ((cur + ' ' + s).length > TARGET_CHARS && cur) {
      out.push(cur.trim())
      cur = s
    } else {
      cur = cur ? `${cur} ${s}` : s
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out.flatMap((s) => (s.length > MAX_CHUNK_CHARS ? s.match(new RegExp(`.{1,${TARGET_CHARS}}`, 'g')) || [] : [s]))
}
