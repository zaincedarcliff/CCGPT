// Live Cedar Cliff athletics: pull MaxPreps team/schedule pages (including the
// __NEXT_DATA__ contest list the public HTML does not render without JS).

import axios from 'axios'
import { classifySource, publisherLabel, displayDomain, normalizeUrl } from './sources.js'
import { chunkText } from './chunk.js'

const BASE = 'https://www.maxpreps.com/pa/camp-hill/cedar-cliff-colts'
const TTL_MS = Number(process.env.ATHLETICS_TTL_MS || 45 * 60 * 1000)
const FETCH_TIMEOUT_MS = Number(process.env.ATHLETICS_TIMEOUT_MS || 12000)

const SPORT_SLUGS = {
  basketball: { boys: 'basketball', girls: 'basketball/girls' },
  soccer: { boys: 'soccer', girls: 'soccer/girls' },
  football: { boys: 'football' },
  baseball: { boys: 'baseball' },
  softball: { girls: 'softball' },
  lacrosse: { boys: 'lacrosse', girls: 'lacrosse/girls' },
  tennis: { boys: 'tennis', girls: 'tennis/girls' },
  golf: { boys: 'golf', girls: 'golf/girls' },
  volleyball: { boys: 'volleyball/boys', girls: 'volleyball' },
  wrestling: { boys: 'wrestling' },
  'field hockey': { girls: 'field-hockey' },
  'cross country': { boys: 'cross-country', girls: 'cross-country' },
  track: { boys: 'track-field', girls: 'track-field/girls' },
  swimming: { boys: 'swimming' },
  swim: { boys: 'swimming' },
}

const SPORT_DETECT = Object.keys(SPORT_SLUGS).sort((a, b) => b.length - a.length)

const ATHLETICS_INTENT_RE =
  /\b(game|games|match|matches|season|schedule|score|scores|record|standings?|playoff|playoffs|districts?|piaa|maxpreps|opponent|roster|tryouts?|next|first|last|when|who (did|do|does) they play|make (it to )?(districts?|playoffs?|states?)|varsity|jv)\b/i

const CONTEST_LINE_RE = /varsity .+\b(game|match|contest)\b/i

/** @type {Map<string, { at: number, value: any }>} */
const mem = new Map()

export function detectNamedSport(text) {
  const t = String(text || '').toLowerCase()
  return SPORT_DETECT.find((s) => t.includes(s)) || null
}

export function detectAthletics(text) {
  const sport = detectNamedSport(text)
  if (!sport) return null
  if (!ATHLETICS_INTENT_RE.test(text) && !/\b(team|colts)\b/i.test(text)) return null
  const t = String(text || '').toLowerCase()
  const girls = /\b(girls?|lady|ladies|women'?s)\b/.test(t)
  const boys = /\b(boys?|men'?s)\b/.test(t)
  return { sport, gender: girls && !boys ? 'girls' : boys && !girls ? 'boys' : null }
}

export function maxPrepsUrls(sport, gender = null) {
  const slugs = SPORT_SLUGS[sport]
  if (!slugs) return []
  const chosen = gender && slugs[gender] ? [slugs[gender]] : Object.values(slugs).filter((v, i, a) => a.indexOf(v) === i)
  const urls = []
  for (const slug of chosen) {
    urls.push(`${BASE}/${slug}/schedule/`)
    urls.push(`${BASE}/${slug}/`)
  }
  return urls
}

/** Pull contest / recap sentences from MaxPreps `__NEXT_DATA__`. */
export function maxPrepsTextFromHtml(html, pageTitle = '') {
  const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return ''
  let data
  try {
    data = JSON.parse(m[1])
  } catch {
    return ''
  }
  const lines = unique(collectContestLines(data.props?.pageProps || data))
  if (!lines.length) return ''
  const tracking = data.props?.pageProps?.tracking || {}
  const label = [tracking.gender, tracking.sportName || pageTitle, tracking.teamLevel].filter(Boolean).join(' ')
  return [`Cedar Cliff ${label || 'athletics'} — MaxPreps schedule / results`, ...lines.map((l) => `- ${l}`)].join('\n')
}

function collectContestLines(node, out = []) {
  if (typeof node === 'string') {
    if (CONTEST_LINE_RE.test(node) && node.length < 400) out.push(node.replace(/\s+/g, ' ').trim())
    return out
  }
  if (Array.isArray(node)) {
    for (const x of node) collectContestLines(x, out)
    return out
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) collectContestLines(v, out)
  }
  return out
}

function unique(list) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function toPassages(url, title, text, score) {
  if (!text) return []
  const nowIso = new Date().toISOString()
  return chunkText(text, { title }).slice(0, 3).map((chunk) => ({
    url,
    title,
    text: chunk.slice(0, 2200),
    tier: classifySource(url),
    publisher: publisherLabel(url),
    domain: displayDomain(url),
    lastChecked: nowIso,
    lastChanged: nowIso,
    publishedAt: nowIso,
    docYear: null,
    score,
    origin: 'athletics',
  }))
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CCGPT-Indexer/1.0',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  })
  return { url: normalizeUrl(url) || url, html: String(res.data || ''), finalUrl: res.request?.res?.responseUrl || url }
}

/**
 * @param {string} question
 * @returns {Promise<{ passages: object[], errors: string[], urls: string[] }>}
 */
export async function fetchAthleticsPages(question) {
  const detected = detectAthletics(question)
  if (!detected) return { passages: [], errors: [], urls: [] }
  const urls = maxPrepsUrls(detected.sport, detected.gender).slice(0, 4)
  const key = urls.join('|')
  const hit = mem.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const errors = []
  const passages = []
  const settled = await Promise.allSettled(urls.map((u) => fetchHtml(u)))
  settled.forEach((r, i) => {
    const url = urls[i]
    if (r.status !== 'fulfilled') {
      errors.push(`${url}: ${r.reason?.message || r.reason}`)
      return
    }
    const titleMatch = r.value.html.match(/<title[^>]*>([^<]+)</i)
    const title = (titleMatch?.[1] || 'Cedar Cliff MaxPreps').replace(/\s+/g, ' ').trim()
    const text = maxPrepsTextFromHtml(r.value.html, title)
    if (!text) {
      errors.push(`${url}: no contest data`)
      return
    }
    passages.push(...toPassages(r.value.url, title, text, /schedule/i.test(url) ? 92 : 80))
  })

  const value = { passages, errors, urls }
  if (passages.length) mem.set(key, { at: Date.now(), value })
  return value
}
