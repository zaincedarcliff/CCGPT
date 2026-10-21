// Live fetch of Cedar Cliff daily announcements (and the school home "upcoming events"
// block). Used on chat for "what's happening today" / "is there school Friday" so we are
// not stuck on a 24-hour-old knowledge-base copy.
//
// Cached ~90 minutes in memory and in storage (Blob / .kb) so many students asking the
// same question in a class period share one fetch.

import { fetchDocument } from './extract.js'
import { chunkText } from './chunk.js'
import { classifySource, publisherLabel, displayDomain, normalizeUrl } from './sources.js'
import { readJson, writeJson } from './storage.js'

export const DAILY_ANNOUNCEMENTS_URL = 'https://www.wssd.k12.pa.us/DailyAnnouncements1.aspx'
export const SCHOOL_HOME_URL = 'https://www.wssd.k12.pa.us/CedarCliff.aspx'

const CACHE_KEY = 'cache/live-announcements.json'
const TTL_MS = Number(process.env.ANNOUNCEMENTS_TTL_MS || 90 * 60 * 1000)
const FETCH_TIMEOUT_MS = Number(process.env.ANNOUNCEMENTS_TIMEOUT_MS || 8000)
const MAX_PASSAGE_CHARS = 1800

const DATE_HEADING_RE =
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
}

/** @type {{ at: number, passages: object[] } | null} */
let mem = null

function easternNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)
  const num = (t) => Number(parts.find((p) => p.type === t)?.value)
  return { y: num('year'), m: num('month'), d: num('day') }
}

function parseHeadingDate(line) {
  const m = DATE_HEADING_RE.exec(String(line || '').trim())
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase()]
  const day = Number(m[3])
  const year = Number(m[4])
  if (month == null || !day || !year) return null
  return Date.UTC(year, month, day)
}

function dayStamp({ y, m, d }) {
  return Date.UTC(y, m - 1, d)
}

/**
 * Keep dated announcement blocks near "today" (last 10 days through next 2).
 * The public page keeps months of history; the model only needs the current ones.
 */
export function selectRecentAnnouncementText(text, now = new Date()) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return ''

  const today = dayStamp(easternNow(now))
  const min = today - 10 * 86400000
  const max = today + 2 * 86400000

  const sections = []
  let cur = { date: null, lines: [] }
  const flush = () => {
    if (cur.lines.length) sections.push(cur)
    cur = { date: null, lines: [] }
  }

  for (const line of lines) {
    const date = parseHeadingDate(line)
    if (date != null) {
      flush()
      cur = { date, lines: [line] }
    } else {
      cur.lines.push(line)
    }
  }
  flush()

  const dated = sections.filter((s) => s.date != null)
  const keep = dated.filter((s) => s.date >= min && s.date <= max)
  const chosen = keep.length ? keep : dated.slice(-4)
  if (!chosen.length) {
    return lines.slice(0, 80).join('\n').slice(0, 6000)
  }
  chosen.sort((a, b) => b.date - a.date)
  const out = []
  let n = 0
  for (const s of chosen) {
    const block = s.lines.join('\n')
    if (n && n + block.length > 7000) break
    out.push(block)
    n += block.length + 2
  }
  return out.join('\n\n')
}

function toPassages(doc, { score, origin }) {
  if (!doc?.text) return []
  const url = normalizeUrl(doc.url) || doc.url
  const recent = /dailyannouncements/i.test(url) ? selectRecentAnnouncementText(doc.text) : doc.text
  const chunks = chunkText(recent, { title: doc.title }).slice(0, 4)
  const nowIso = new Date().toISOString()
  return chunks.map((text) => ({
    url,
    title: doc.title || 'Cedar Cliff Daily Announcements',
    text: text.slice(0, MAX_PASSAGE_CHARS),
    tier: classifySource(url),
    publisher: publisherLabel(url),
    domain: displayDomain(url),
    lastChecked: nowIso,
    lastChanged: doc.lastModified || nowIso,
    publishedAt: doc.lastModified || null,
    docYear: doc.docYear || null,
    score,
    origin,
  }))
}

async function fetchOne(url) {
  return fetchDocument(url, { timeoutMs: FETCH_TIMEOUT_MS })
}

async function loadFresh() {
  const results = await Promise.allSettled([fetchOne(DAILY_ANNOUNCEMENTS_URL), fetchOne(SCHOOL_HOME_URL)])
  const passages = []
  const errors = []
  results.forEach((r, i) => {
    const url = i === 0 ? DAILY_ANNOUNCEMENTS_URL : SCHOOL_HOME_URL
    if (r.status !== 'fulfilled') {
      errors.push(`${url}: ${r.reason?.message || r.reason}`)
      return
    }
    const score = i === 0 ? 80 : 55
    passages.push(...toPassages(r.value, { score, origin: 'live' }))
  })
  return { passages, errors, fetchedAt: new Date().toISOString() }
}

/**
 * @returns {Promise<{ passages: object[], errors: string[], fromCache: boolean }>}
 */
export async function fetchLiveAnnouncements() {
  if (mem && Date.now() - mem.at < TTL_MS) {
    return { passages: mem.passages, errors: [], fromCache: true }
  }
  try {
    const stored = await readJson(CACHE_KEY)
    if (stored?.fetchedAt && Date.now() - Date.parse(stored.fetchedAt) < TTL_MS && Array.isArray(stored.passages) && stored.passages.length) {
      mem = { at: Date.parse(stored.fetchedAt), passages: stored.passages }
      return { passages: stored.passages, errors: stored.errors || [], fromCache: true }
    }
  } catch {
    /* ignore cache read */
  }

  const fresh = await loadFresh()
  if (fresh.passages.length) {
    mem = { at: Date.now(), passages: fresh.passages }
    try {
      await writeJson(CACHE_KEY, fresh)
    } catch {
      /* cache write is best-effort */
    }
  }
  return { ...fresh, fromCache: false }
}

export function wantsLiveAnnouncements(text) {
  const t = String(text || '')
  return (
    /\b(announcements?|morning announcement|what'?s happening|whats happening|happening today|anything going on|any events|cycle day)\b/i.test(t) ||
    /\b(is there school|do we have school|no school|day off|early dismissal|two.?hour delay|delayed opening|snow day)\b/i.test(t)
  )
}
