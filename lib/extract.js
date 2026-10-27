// Fetch a URL and turn it into clean text + metadata. Handles:
//   - HTML pages (including the WSSD CMS `span[id$="_lblText"]` body blocks and Cloudflare
//     email obfuscation — logic carried over from the original index.js scraper)
//   - PDF documents (handbooks, program of studies, calendars…) via unpdf
//   - Google Docs (exported as text) and Google Drive files (direct download)
// Also collects outbound links so the crawler can discover new official pages and PDFs.

import axios from 'axios'
import * as cheerio from 'cheerio'
import crypto from 'node:crypto'
import { normalizeUrl, safeUrl } from './sources.js'
import { maxPrepsTextFromHtml } from './athletics.js'

export const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CCGPT-Indexer/1.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const MAX_BYTES = Number(process.env.KB_MAX_DOC_BYTES || 20 * 1024 * 1024) // 20 MB
const MIN_LINE_LENGTH = 3

// ---------------------------------------------------------------- helpers

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex')
}

/** Cloudflare "email-protection" obfuscates addresses; decode them so the text keeps the real email. */
function decodeCloudflareEmail(encoded) {
  const key = parseInt(encoded.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < encoded.length; i += 2) {
    out += String.fromCharCode(parseInt(encoded.slice(i, i + 2), 16) ^ key)
  }
  return out
}

function unprotectEmails($) {
  $('[data-cfemail]').each((_i, el) => {
    const encoded = $(el).attr('data-cfemail')
    if (encoded) $(el).replaceWith(decodeCloudflareEmail(encoded))
  })
  $('a[href^="/cdn-cgi/l/email-protection#"]').each((_i, el) => {
    const hash = ($(el).attr('href') || '').split('#')[1]
    if (hash && !/@/.test($(el).text())) $(el).text(decodeCloudflareEmail(hash))
  })
}

/** The district site returns HTTP 200 for missing pages; detect them so stale URLs aren't stored as content. */
function isErrorPage($) {
  const title = $('title').text().trim()
  return /an error has occurred|page not found|404/i.test(title) && !/handbook|schedule/i.test(title)
}

function normalizeWhitespace(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/** Turn an HTML fragment into newline-separated text, preserving block boundaries. */
function blockText($, el) {
  const html = $(el).html() || ''
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6]|section|article|blockquote|dd|dt)>/gi, '$&\n')
    .replace(/<\/(td|th)>/gi, ' | ')
  return cheerio.load(`<div>${withBreaks}</div>`)('div').first().text()
}

// ---------------------------------------------------------------- Google URLs

/** Convert Google Docs / Drive viewer URLs into directly fetchable export URLs. */
export function toFetchableUrl(url) {
  const u = safeUrl(url)
  if (!u) return url
  const host = u.hostname.toLowerCase()
  if (host === 'docs.google.com') {
    const m = u.pathname.match(/^\/document\/d\/([^/]+)/)
    if (m) return `https://docs.google.com/document/d/${m[1]}/export?format=txt`
    const s = u.pathname.match(/^\/spreadsheets\/d\/([^/]+)/)
    if (s) return `https://docs.google.com/spreadsheets/d/${s[1]}/export?format=csv`
    const p = u.pathname.match(/^\/presentation\/d\/([^/]+)/)
    if (p) return `https://docs.google.com/presentation/d/${p[1]}/export/pdf`
    const v = u.pathname.match(/^\/viewer/)
    if (v && u.searchParams.get('url')) return u.searchParams.get('url')
  }
  if (host === 'drive.google.com') {
    const m = u.pathname.match(/\/file\/d\/([^/]+)/) || [null, u.searchParams.get('id')]
    if (m?.[1]) return `https://drive.google.com/uc?export=download&id=${m[1]}`
  }
  return url
}

// ---------------------------------------------------------------- fetch

/**
 * @typedef {Object} FetchedDoc
 * @property {string} url            canonical URL we store / cite
 * @property {string} fetchUrl       URL actually requested
 * @property {string} title
 * @property {string} text           clean extracted text (newline separated)
 * @property {string} hash           sha256 of normalized text (change detection)
 * @property {'html'|'pdf'|'text'} kind
 * @property {string|null} lastModified  Last-Modified header if any (ISO)
 * @property {string|null} docYear       school year detected in the document, e.g. "2025-2026"
 * @property {string[]} links        absolute outbound links (HTML only)
 * @property {number} bytes
 */

/**
 * Fetch and extract one document.
 * @param {string} url
 * @param {{ timeoutMs?: number, etag?: string }} [opts]
 * @returns {Promise<FetchedDoc>}
 */
export async function fetchDocument(url, opts = {}) {
  const fetchUrl = toFetchableUrl(url)
  let res
  try {
    res = await axios.get(fetchUrl, {
      timeout: opts.timeoutMs ?? 25000,
      headers: REQUEST_HEADERS,
      responseType: 'arraybuffer',
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      maxRedirects: 6,
      validateStatus: (s) => s >= 200 && s < 400,
    })
  } catch (err) {
    const msg = String(err?.message || err)
    if (/maxContentLength|maxBodyLength/i.test(msg)) {
      throw new Error(`document larger than ${MAX_BYTES} bytes — skipped`)
    }
    throw err
  }
  const buf = Buffer.from(res.data)
  const contentType = String(res.headers['content-type'] || '').toLowerCase()
  const lastModifiedRaw = res.headers['last-modified']
  const lastModified = lastModifiedRaw && !Number.isNaN(Date.parse(lastModifiedRaw)) ? new Date(lastModifiedRaw).toISOString() : null
  const finalUrl = res.request?.res?.responseUrl || fetchUrl

  const looksPdf = contentType.includes('pdf') || /\.pdf(\?|$)/i.test(finalUrl) || buf.subarray(0, 5).toString() === '%PDF-'
  let doc
  if (looksPdf) {
    doc = await extractPdf(buf)
  } else if (contentType.includes('html') || /<html[\s>]/i.test(buf.subarray(0, 2048).toString('utf8'))) {
    doc = extractHtml(buf.toString('utf8'), finalUrl)
  } else {
    // plain text / csv exports
    const text = normalizeWhitespace(buf.toString('utf8'))
    doc = { title: '', text, kind: 'text', links: [] }
  }

  const text = doc.text
  return {
    url: normalizeUrl(url) || url,
    fetchUrl,
    title: doc.title || titleFromUrl(url),
    text,
    hash: sha256(text),
    kind: doc.kind,
    lastModified,
    docYear: detectSchoolYear(text),
    links: doc.links || [],
    images: doc.images || [],
    bytes: buf.length,
  }
}

// ---------------------------------------------------------------- HTML

export function extractHtml(html, baseUrl) {
  const $ = cheerio.load(html)
  if (isErrorPage($)) {
    throw new Error(`site returned an error page (${$('title').text().trim()})`)
  }
  unprotectEmails($)
  const title = normalizeWhitespace($('meta[property="og:title"]').attr('content') || $('title').first().text() || $('h1').first().text())

  // Outbound links before we start removing nodes.
  const links = []
  $('a[href]').each((_i, a) => {
    const href = String($(a).attr('href') || '').trim()
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return
    try {
      const abs = new URL(href, baseUrl).toString()
      const norm = normalizeUrl(abs)
      if (norm) links.push({ url: norm, text: normalizeWhitespace($(a).text()).slice(0, 120) })
    } catch {
      /* ignore bad hrefs */
    }
  })

  // Embedded documents (PDF viewers, Google Docs iframes) count as links for discovery.
  $('iframe[src], embed[src], object[data]').each((_i, el) => {
    const src = String($(el).attr('src') || $(el).attr('data') || '').trim()
    if (!src) return
    try {
      const norm = normalizeUrl(new URL(src, baseUrl).toString())
      if (norm && /\.pdf(\?|$)|docs\.google\.com|drive\.google\.com/i.test(norm)) links.push({ url: norm, text: 'embedded document' })
    } catch {
      /* ignore */
    }
  })

  // Strip chrome: scripts, menus, headers/footers. The WSSD site runs on eSchoolView, whose main
  // content lives in #ucContentPage_pnlControls with the left nav in #ucLeftNav_pnlLeftSide.
  $(
    'script, style, noscript, svg, nav, header, footer, .SubFooter, #ucLeftNav_pnlLeftSide, .DynamicNav, #navigation, [role="navigation"], .breadcrumb, .skip, .cookie, #cookie-banner, #ucFooter_lblText',
  ).remove()

  // Images inside the main content (bell schedules, flyers, calendars are often posted as images).
  // They become `[Image] url` placeholder lines (so the content hash changes when the image does) and
  // the crawler can transcribe them with Gemini vision.
  const contentRoot = $('#ucContentPage_pnlControls, main, article, [role="main"], #content, .content').first()
  const images = []
  ;(contentRoot.length ? contentRoot : $('span[id$="_lblText"], .component_container')).find('img[src]').each((_i, img) => {
    const src = String($(img).attr('src') || '').trim()
    if (!src || /^data:/i.test(src)) return
    try {
      const abs = new URL(src, baseUrl).toString()
      if (!/\.(jpe?g|png|gif|webp)(\?|$)/i.test(abs) && !/filecabinet|eschoolview|googleusercontent/i.test(abs)) return
      if (/(icon|logo|spacer|bullet|arrow|pixel|badge|social|facebook|twitter|instagram)/i.test(abs)) return
      const w = Number(String($(img).attr('width') || $(img).attr('style')?.match(/width:\s*(\d+)/)?.[1] || 0))
      if (w && w < 120) return
      if (!images.some((x) => x.src === abs)) images.push({ src: abs, alt: normalizeWhitespace($(img).attr('alt') || '') })
    } catch {
      /* ignore */
    }
  })

  const lines = []
  const seen = new Set()
  const push = (raw) => {
    for (const piece of String(raw).split('\n')) {
      const line = piece.replace(/\s+/g, ' ').trim()
      if (line.length >= MIN_LINE_LENGTH && !seen.has(line)) {
        seen.add(line)
        lines.push(line)
      }
    }
  }

  // Main content container first (it carries the real content), then headings/paragraphs/lists/
  // tables anywhere that survived the chrome removal.
  if (contentRoot.length) push(blockText($, contentRoot))
  else $('span[id$="_lblText"], .component_container').each((_i, el) => push(blockText($, el)))
  $('h1, h2, h3, h4, p, li, td, th, dd, dt, blockquote').each((_i, el) => push($(el).text()))
  if (lines.length < 5) push(blockText($, 'body'))
  for (const img of images.slice(0, 8)) push(`[Image${img.alt ? `: ${img.alt}` : ''}] ${img.src}`)

  let text = lines.join('\n')
  if (/maxpreps\.com/i.test(String(baseUrl))) {
    const schedule = maxPrepsTextFromHtml(html, title)
    if (schedule) text = `${schedule}\n${text}`
  }

  return { title, text, kind: 'html', links, images: images.slice(0, 8) }
}

// ---------------------------------------------------------------- PDF

export async function extractPdf(buf) {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { text, totalPages } = await extractText(pdf, { mergePages: false })
  let title = ''
  try {
    const meta = await pdf.getMetadata()
    title = normalizeWhitespace(meta?.info?.Title || '')
  } catch {
    /* no metadata */
  }
  const pages = Array.isArray(text) ? text : [String(text)]
  const cleanPages = pages.map((p, i) => {
    const body = normalizeWhitespace(
      String(p)
        .replace(/-\n(?=[a-z])/g, '') // de-hyphenate line wraps
        .replace(/[ \t]{2,}/g, ' '),
    )
    return body ? `[Page ${i + 1}]\n${body}` : ''
  })
  return { title, text: cleanPages.filter(Boolean).join('\n'), kind: 'pdf', links: [], totalPages }
}

// ---------------------------------------------------------------- metadata

export function titleFromUrl(url) {
  const u = safeUrl(url)
  if (!u) return String(url)
  const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname)
  return last
    .replace(/\.(aspx|html?|pdf)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
}

/** Most frequent "2025-2026" / "2025-26" style school-year mention, if any. */
export function detectSchoolYear(text) {
  const counts = new Map()
  const re = /\b(20\d{2})\s*[-–/]\s*(20)?(\d{2})\b/g
  let m
  let n = 0
  while ((m = re.exec(text)) && n < 5000) {
    n++
    const start = Number(m[1])
    const end = Number(`20${m[3]}`)
    if (end !== start + 1) continue
    const key = `${start}-${end}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let best = null
  for (const [k, c] of counts) if (!best || c > best[1]) best = [k, c]
  return best ? best[0] : null
}
