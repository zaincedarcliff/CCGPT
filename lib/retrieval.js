// Retrieval orchestration: decide *whether* to search, run knowledge-base + web retrieval,
// and assemble numbered sources for the prompt.
//
//   IF answer exists in the trusted knowledge base (high confidence)  → KB only
//   IF answer missing / low confidence / KB content stale             → KB + web search
//   IF the question is inherently time-sensitive                       → KB + web search
//   IF the user explicitly asks for current / latest information       → KB + web search
//   IF the question isn't about school at all (chit-chat, general)     → no retrieval

import { searchKnowledgeBase } from './kb.js'
import { webSearchForQuestion, webSearchAvailable } from './webSearch.js'
import { fetchLiveAnnouncements, wantsLiveAnnouncements } from './announcements.js'
import { detectAthletics, fetchAthleticsPages } from './athletics.js'
import { formatRetrievedContext, noRetrievalNote } from './prompt.js'
import { publisherLabel, displayDomain } from './sources.js'

const KB_CONFIDENT = Number(process.env.KB_CONFIDENCE_THRESHOLD || 0.58)
const KB_STALE_DAYS_TIME_SENSITIVE = 3
const MAX_SOURCES = 8
const MAX_PASSAGES_PER_SOURCE = 3

// ---------------------------------------------------------------- classification

const SMALL_TALK_RE =
  /^(hi|hey|hello|yo|sup|howdy|gm|good (morning|afternoon|evening|night)|thanks|thank you|thx|ty|ok|okay|cool|nice|lol|lmao|bye|goodbye|cya|see ya|what'?s up|how are you)\b[\s!.?]*$/i

const SCHOOL_TERMS_RE =
  /\b(cedar cliff|wssd|west shore|camp hill|colts?|red land|principal|assistant principal|vice principal|counselor|counselors|guidance|teacher|teachers|staff|faculty|coach|coaches|athletic director|nurse|secretary|main office|handbook|powerschool|bell schedule|homeroom|period|lunch|cafeteria|menu|parking|senior|seniors|junior|sophomore|freshman|graduation|graduate|commencement|prom|homecoming|spirit week|open house|back to school|first day|last day|half day|early dismissal|delayed opening|two.hour delay|snow day|school (is|be) (closed|open|cancel)|closure|calendar|attendance|absence|absences|absent|tardy|tardies|dress code|discipline|detention|suspension|grading|grade scale|grading scale|gpa|honor roll|weighted|credits?|requirements?|graduation requirements|course|courses|class|classes|elective|electives|curriculum|program of studies|course selection|schedule change|ap\b|advanced placement|honors|dual enroll|hacc|keystone|psat|sat\b|act\b|transcript|work permit|driver'?s? (ed|permit)|bus|busing|transportation|club|clubs|activity|activities|nhs|national honor society|key club|jrotc|yearbook|musical|drama|band|chorus|orchestra|robotics|newspaper|student council|stuco|fbla|deca|sport|sports|athletic|athletics|football|basketball|baseball|softball|soccer|volleyball|lacrosse|field hockey|hockey|swim|swimming|diving|wrestling|track|cross country|tennis|golf|cheer|cheerleading|bocce|game|games|tryouts?|roster|scores?|playoffs?|district (3|iii)|mid.?penn|piaa|maxpreps|school board|board meeting|superintendent|district office|registration|enroll|enrollment|excel|virtual academy|ctc|scholarship|fafsa|college visit|senior (option|info|information|dues|trip)|cap and gown|locker|library|chromebook|laptop|wifi|tech support|fee|fees|activity fee|meal|meals|free and reduced|breakfast|field trip|fundraiser|pep rally|assembly|announcements?|newsletter|colt (online|news))\b/i

const TIME_SENSITIVE_RE =
  /\b(today|tonight|tomorrow|yesterday|this (week|weekend|month|friday|monday|tuesday|wednesday|thursday|saturday|sunday)|next (week|month|game|match|meet|home game|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|upcoming|when is|when are|when does|when do|what time|what day|what date|is there school|do we have school|no school|day off|early dismissal|delay|delayed|closed|closing|cancel+ed|postponed|score|scores|result|results|record|standings?|schedule for|deadline|due date|sign.?ups?|tryouts?|homecoming|prom|graduation date|last day|first day|spring break|winter break|thanksgiving|report cards?|midterms?|finals? week|keystones?|picture day|open house|conferences?|202\d)\b/i

const WANTS_CURRENT_RE = /\b(latest|current|currently|newest|most recent|recent|up.to.date|right now|as of now|this year|this school year|new|updated|still|anymore|any ?more)\b/i

export function classifyQuestion(text) {
  const t = String(text || '').trim()
  const smallTalk = t.length < 2 || SMALL_TALK_RE.test(t)
  const schoolTerms = SCHOOL_TERMS_RE.test(t)
  const timeSensitive = TIME_SENSITIVE_RE.test(t)
  const wantsCurrent = WANTS_CURRENT_RE.test(t)
  const announcements = wantsLiveAnnouncements(t)
  const athletics = Boolean(detectAthletics(t))
  return { smallTalk, schoolTerms, timeSensitive, wantsCurrent, announcements, athletics }
}

// ---------------------------------------------------------------- main

/**
 * @param {string} question
 * @param {{ forceWeb?: boolean, allowWeb?: boolean | (() => Promise<boolean>|boolean), log?: Function }} [opts]
 */
export async function retrieveForQuestion(question, opts = {}) {
  const log = opts.log || (() => {})
  const cls = classifyQuestion(question)
  const decision = { ...cls, schoolRelated: false, searchedKb: false, searchedWeb: false, liveAnnouncements: false, reason: '' }
  const result = { sources: [], contextText: '', decision, kbConfidence: 0, web: null, kbStats: null }

  if (cls.smallTalk) {
    decision.reason = 'small talk — no retrieval'
    return result
  }

  // 1. Knowledge base (always — it is local and cheap, and its confidence tells us what to do next).
  let kb = { hits: [], confidence: 0, queryVector: null, stats: {} }
  try {
    kb = await searchKnowledgeBase(question, { topK: 8 })
    decision.searchedKb = true
  } catch (err) {
    log('[retrieval] kb search failed:', err?.message || err)
  }
  result.kbConfidence = kb.confidence
  result.kbStats = kb.stats
  decision.schoolRelated = cls.schoolTerms || cls.announcements || cls.athletics || kb.confidence >= 0.5
  if (!decision.schoolRelated) {
    decision.reason = 'not school-related — answer from general knowledge'
    return result
  }

  if (cls.athletics) {
    const sportsHits = kb.hits.filter((h) => /maxpreps\.com|piaa\.org|athletics/i.test(h.url))
    if (sportsHits.length) kb.hits = [...sportsHits, ...kb.hits.filter((h) => !sportsHits.includes(h))].slice(0, 8)
  }

  // 2. Decide on the web.
  const staleForTimeSensitive =
    cls.timeSensitive &&
    kb.hits.length > 0 &&
    kb.hits[0].lastChecked &&
    (Date.now() - Date.parse(kb.hits[0].lastChecked)) / 86400000 > KB_STALE_DAYS_TIME_SENSITIVE
  const officialTop = kb.hits.slice(0, 3).some((h) => h.tier === 1)
  const kbConfident = !cls.athletics && kb.confidence >= KB_CONFIDENT && officialTop
  const wantWeb = cls.announcements && !opts.forceWeb && !cls.athletics
    ? false
    : Boolean(opts.forceWeb) || cls.athletics || cls.wantsCurrent || cls.timeSensitive || !kbConfident || staleForTimeSensitive
  // allowWeb may be a boolean or an async gate (e.g. per-user web-search rate limit) evaluated only when needed.
  let canWeb = webSearchAvailable()
  if (canWeb && wantWeb) {
    canWeb = typeof opts.allowWeb === 'function' ? Boolean(await opts.allowWeb()) : opts.allowWeb !== false
    if (!canWeb) decision.webRateLimited = typeof opts.allowWeb === 'function'
  }
  decision.wantWeb = wantWeb
  decision.reason = opts.forceWeb
    ? 'web search forced (retry after unverified answer)'
    : cls.athletics
      ? 'athletics schedule / scores — live MaxPreps'
      : cls.announcements
        ? 'daily announcements — live school page'
        : cls.timeSensitive
          ? 'time-sensitive question'
          : cls.wantsCurrent
            ? 'user asked for current information'
            : staleForTimeSensitive
              ? 'knowledge base content is stale'
              : !kbConfident
                ? `knowledge base confidence ${kb.confidence.toFixed(2)} < ${KB_CONFIDENT}`
                : 'knowledge base confident'

  const wantLiveAnns = cls.announcements || (cls.timeSensitive && !cls.athletics)

  const webPromise =
    wantWeb && canWeb
      ? webSearchForQuestion(question, {
          timeSensitive: cls.timeSensitive || cls.wantsCurrent || cls.athletics,
          athletics: cls.athletics,
          queryVector: kb.queryVector,
          log,
        }).catch((err) => {
          log('[retrieval] web search failed:', err?.message || err)
          return { passages: [], results: [], queries: [], provider: null, fetched: [], errors: [String(err?.message || err)] }
        })
      : Promise.resolve(null)
  const annsPromise = wantLiveAnns
    ? fetchLiveAnnouncements().catch((err) => {
        log('[retrieval] live announcements failed:', err?.message || err)
        return { passages: [], errors: [String(err?.message || err)] }
      })
    : Promise.resolve(null)
  const athleticsPromise = cls.athletics
    ? fetchAthleticsPages(question).catch((err) => {
        log('[retrieval] athletics fetch failed:', err?.message || err)
        return { passages: [], errors: [String(err?.message || err)], urls: [] }
      })
    : Promise.resolve(null)

  const [web, anns, athletics] = await Promise.all([webPromise, annsPromise, athleticsPromise])
  if (web) decision.searchedWeb = true
  if (anns?.passages?.length) decision.liveAnnouncements = true
  if (athletics?.passages?.length) decision.liveAthletics = true
  result.web = web ? { provider: web.provider, queries: web.queries, fetched: web.fetched, errors: web.errors, resultCount: web.results.length } : null
  decision.webUnavailable = wantWeb && !canWeb

  // 3. Merge live announcements + web + KB into numbered sources.
  const kbPassages = kb.hits
    .filter((h) => h.coverage > 0 || h.cosine > 0.5)
    .map((h) => ({
      url: h.url,
      title: h.title,
      text: h.text,
      tier: h.tier,
      publisher: h.publisher,
      domain: h.domain,
      lastChecked: h.lastChecked,
      lastChanged: h.lastChanged,
      docYear: h.docYear,
      score: h.score,
      origin: 'kb',
    }))
  const webPassages = (web?.passages || []).map((p) => ({ ...p, score: p.score * 1.1 })) // fresh > cached
  result.sources = groupIntoSources([...(athletics?.passages || []), ...(anns?.passages || []), ...webPassages, ...kbPassages])
  const extraNotes =
    anns && !anns.passages?.length && anns.errors?.length
      ? `## Live announcements\nCould not load the Daily Announcements page just now (${anns.errors[0]}).`
      : ''
  result.contextText = result.sources.length
    ? [formatRetrievedContext(result.sources, { searchedWeb: decision.searchedWeb, kbConfidence: kb.confidence }), extraNotes].filter(Boolean).join('\n\n')
    : [noRetrievalNote({ searchedWeb: decision.searchedWeb, checked: web?.fetched || [] }), extraNotes].filter(Boolean).join('\n\n')
  return result
}

/** Group passages by URL, order by (tier, best score), number them, cap counts. */
export function groupIntoSources(passages) {
  const byUrl = new Map()
  for (const p of passages) {
    if (!p?.url || !p.text) continue
    let s = byUrl.get(p.url)
    if (!s) {
      s = {
        url: p.url,
        title: p.title || p.url,
        publisher: p.publisher || publisherLabel(p.url),
        domain: p.domain || displayDomain(p.url),
        tier: p.tier,
        origin: p.origin,
        lastChecked: p.lastChecked || null,
        lastChanged: p.lastChanged || null,
        publishedAt: p.publishedAt || null,
        docYear: p.docYear || null,
        best: p.score,
        passages: [],
      }
      byUrl.set(p.url, s)
    }
    if (p.origin === 'web' && s.origin === 'kb') s.origin = 'web'
    if (p.origin === 'live') s.origin = 'live'
    if (p.origin === 'athletics') s.origin = 'athletics'
    s.best = Math.max(s.best, p.score)
    if (s.passages.length < MAX_PASSAGES_PER_SOURCE && !s.passages.includes(p.text)) s.passages.push(p.text)
  }
  const originRank = (o) => (o === 'athletics' ? 0 : o === 'live' ? 1 : o === 'web' ? 2 : 3)
  const sources = [...byUrl.values()]
    .sort((a, b) => originRank(a.origin) - originRank(b.origin) || a.tier - b.tier || b.best - a.best)
    .slice(0, MAX_SOURCES)
  return sources.map((s, i) => ({ ...s, n: i + 1 }))
}

/** Extract the [n] markers the model actually used. */
export function citedSourceNumbers(text) {
  const out = new Set()
  const re = /\[(\d{1,2})\]/g
  let m
  while ((m = re.exec(String(text || '')))) out.add(Number(m[1]))
  return out
}

/** Answers that admit they couldn't verify — used to trigger a web-search retry. */
export function looksUnverified(text) {
  return /\b(couldn'?t|could not|can'?t|cannot|unable to|don'?t have|do not have|not able to|no (specific|exact|current) (information|details|data)|isn'?t (listed|available|published)|not (listed|available|published|found)|wasn'?t able)\b[^.]{0,80}\b(verify|find|confirm|locate|information|details|data|access|see|know)\b/i.test(
    String(text || ''),
  )
}
