// Shared loader + topic matcher for the scraped Cedar Cliff data.
// Used by both the Gemini path (gemini.js) and the no-API-key fallback (App.jsx),
// so the bot answers from real school content either way.

let schoolDataCache = null

export async function loadSchoolData() {
  if (schoolDataCache) return schoolDataCache
  try {
    const res = await fetch('/api/data')
    if (!res.ok) throw new Error(res.statusText)
    const payload = await res.json()
    schoolDataCache = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : []
  } catch {
    try {
      const res = await fetch('/schoolData.json')
      if (!res.ok) throw new Error(res.statusText)
      schoolDataCache = await res.json()
    } catch {
      schoolDataCache = []
    }
  }
  return schoolDataCache
}

/** Keyword → source-URL matcher. A user question that contains any keyword
 *  pulls in the first entry whose `source` URL matches.  */
export const TOPIC_RULES = [
  {
    id: 'announcements',
    keywords: [
      'announcement', 'announcements', 'today', 'happening', 'event', 'events',
      'news', 'blood drive', 'paintball', 'trivia', 'school store',
    ],
    match: (src) => src.includes('DailyAnnouncements'),
  },
  {
    id: 'sports',
    keywords: [
      'sport', 'sports', 'game', 'games', 'score', 'scores', 'record', 'records',
      'standing', 'standings', 'win', 'wins', 'loss', 'losses', 'season', 'team',
      'varsity', 'jv', 'playoff', 'playoffs', 'tournament',
      'basketball', 'football', 'soccer', 'baseball', 'softball', 'lacrosse',
      'tennis', 'golf', 'track', 'swim', 'swimming', 'wrestling', 'volleyball',
      'field hockey', 'cheerleading', 'cross country', 'athlete', 'athletic',
      'bocce', 'archery',
    ],
    match: (src) =>
      src.includes('maxpreps.com') ||
      src.includes('sports-news') ||
      src.includes('Athletics') ||
      src.includes('arbiterlive') ||
      src.includes('Natatorium') ||
      src.includes('StadiumBag') ||
      src.includes('DailyAnnouncements') ||
      src.includes('AthleticForms') ||
      src.includes('InterscholasticAthletic'),
  },
  {
    id: 'schedule',
    keywords: ['schedule', 'bell', 'period', 'block'],
    match: (src) => src.includes('BellSchedule'),
  },
  {
    id: 'guidance',
    keywords: ['counselor', 'guidance', 'counseling'],
    match: (src) => src.includes('Guidance'),
  },
  {
    id: 'newsletter',
    keywords: ['newsletter', 'monthly', 'e-news', 'enews'],
    match: (src) => src.includes('newsletter') || src.includes('Monthlye-News'),
  },
  {
    id: 'food',
    keywords: [
      'lunch', 'cafeteria', 'menu', 'menus', 'food', 'breakfast', 'meal',
      'meals', 'free and reduced',
    ],
    match: (src) =>
      src.includes('FoodServices') ||
      src.includes('Menus.aspx') ||
      src.includes('FreeandReduced') ||
      src.includes('StudentMealAccounts') ||
      src.includes('WellnessPolicy'),
  },
  {
    id: 'community',
    keywords: ['community'],
    match: (src) => src.includes('cc-community-news'),
  },
  {
    id: 'lifestyle',
    keywords: ['lifestyle'],
    match: (src) => src.includes('cc-lifestyle-news'),
  },
]

function questionKeywords(q) {
  return q
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3)
}

/** Returns the scraped entries most relevant to the user's question.
 *  Collects **all** entries whose source matches any triggered rule, not just the first. */
export function getRelevantEntries(question, allData) {
  if (!allData || allData.length === 0) return []
  const q = question.toLowerCase()
  const matched = []
  for (const rule of TOPIC_RULES) {
    if (!rule.keywords.some((kw) => q.includes(kw))) continue
    for (const entry of allData) {
      if (rule.match(entry.source) && !matched.includes(entry)) {
        matched.push(entry)
      }
    }
  }
  return matched
}

/** Formats matched entries for the Gemini system prompt. */
export function formatEntriesForPrompt(entries) {
  if (!entries || entries.length === 0) return ''
  return entries
    .map((entry) => {
      const label = entry.source.split('/').pop().replace('.aspx', '')
      const lines = entry.content.slice(0, 40).join('\n')
      return `### ${label}\n${lines}`
    })
    .join('\n\n')
}

// --------- offline-friendly extractor (no LLM needed) ---------

function isNavigationBlock(text) {
  if (!text) return true
  if (text.length < 15) return true
  const indents = (text.match(/\n\s{6,}/g) || []).length
  if (indents >= 3) return true
  if (/^(About Us|Schools|Departments|Curriculum|School Board|Community)\b/.test(text)) return true

  // MaxPreps + site-nav concatenations that jam nav labels together with no spaces.
  if (/HomeTeamsPlayers|TeamsPlayersStates|StatesScoresRankings|PopularSports|POPULAR SPORTS|All SportsBoys|Stat leaders/i.test(text)) {
    return true
  }
  // Generic CamelCase run with many nav-ish words jammed together.
  if (/(Home|Teams|Players|Scores|Rankings|Photos|Videos|Playoffs|News)(?:[A-Z][a-z]+){3,}/.test(text)) {
    return true
  }
  if (/^(Stats are entered|If you know who the head coach|Follow your favorite|Get access to|Don't miss the action|Explore and purchase)/i.test(text)) {
    return true
  }
  return false
}

const DAY_DATE = /(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+[A-Z][a-z]+\s+\d+,\s+\d{4}/

function cleanLine(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim()

  // MaxPreps often emits: "<Title><Day>, <Mon> <d>, <YYYY><Title>..." — keep just the title.
  const repeatedTitle = s.match(
    new RegExp(`^(.+?)${DAY_DATE.source}\\1`),
  )
  if (repeatedTitle) {
    s = repeatedTitle[1].trim()
  }

  // "Game Results<date>On <date>..." → drop the duplicated prefix.
  s = s.replace(new RegExp(`^Game Results${DAY_DATE.source}`), '').trim()

  // "<Season> Cedar Cliff Colts ... Season<date>Welcome ..." → keep from "Welcome".
  s = s.replace(new RegExp(`^[A-Z][a-z]+\\s+Cedar Cliff[^]*?Season${DAY_DATE.source}`), '').trim()

  // Trailing "Cedar Cliff<score>Opponent<score>FinalBox Score" noise after a real sentence.
  s = s.replace(/\s*Cedar Cliff\s*\d+[A-Za-z .'-]+\d+\s*FinalBox Score\s*$/i, '').trim()

  // Trailing "Tournament Game2026 PIAA Boys' Basketball Championships..." fragment noise.
  s = s.replace(/\s*Tournament Game\d{4}[^.]*Championship[^.]*$/i, '').trim()

  // Trailing byline + "Read Article" / "Team Reports" noise.
  s = s.replace(/\s*(Team Reports[•\s]+[A-Z][a-z]+\s+\d+,\s+\d{4}.*)$/i, '').trim()
  s = s.replace(/\s*(Read Article.*)$/i, '').trim()
  s = s.replace(/\s*[A-Z][a-z]+\s+[A-Z][a-z]+•[A-Z][a-z]+\s+\d+,\s+\d{4}.*$/, '').trim()

  return s
}

/** Pick content lines from matched entries that actually answer the user.
 *  Ranks lines by how many of the question's own words appear in them,
 *  boosts domain-specific topic keywords heavily, and filters out site navigation. */
export function extractRelevantSnippets(question, allData, opts = {}) {
  const { maxSnippets = 6, maxCharsPerSnippet = 320 } = opts
  const entries = getRelevantEntries(question, allData)
  if (entries.length === 0) return []

  const q = question.toLowerCase()
  const words = new Set(questionKeywords(question))
  const stop = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'about', 'what',
    'when', 'where', 'which', 'your', 'you', 'are', 'tell', 'please', 'have',
    'has', 'was', 'were', 'will', 'would', 'could', 'should', 'them', 'they',
    'their', 'any', 'all', 'can', 'get', 'got', 'out', 'into', 'like', 'just',
    'much', 'many', 'some', 'one', 'two', 'year', 'years', 'day', 'days',
    'week', 'weeks', 'month', 'months', 'today', 'left', 'right', 'time',
  ])
  const queryTerms = [...words].filter((w) => !stop.has(w))

  const domainKeywords = new Set()
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.some((kw) => q.includes(kw))) {
      for (const kw of rule.keywords) if (q.includes(kw)) domainKeywords.add(kw)
    }
  }

  const NAMED_SPORTS = [
    'basketball', 'football', 'soccer', 'baseball', 'softball', 'lacrosse',
    'tennis', 'golf', 'track', 'swim', 'swimming', 'wrestling', 'volleyball',
    'field hockey', 'cheerleading', 'cross country', 'bocce', 'archery', 'hockey',
  ]
  const requiredSports = NAMED_SPORTS.filter((s) => q.includes(s))

  const ranked = []
  for (const entry of entries) {
    for (const raw of entry.content || []) {
      if (isNavigationBlock(raw)) continue
      const line = cleanLine(raw)
      if (line.length < 25) continue
      const lower = line.toLowerCase()

      if (requiredSports.length > 0 && !requiredSports.some((s) => lower.includes(s))) {
        continue
      }

      let domainHits = 0
      for (const kw of domainKeywords) {
        if (lower.includes(kw)) domainHits += 1
      }

      let genericHits = 0
      for (const term of queryTerms) {
        if (lower.includes(term)) genericHits += 1
      }

      if (domainHits === 0) continue

      const score = domainHits * 10 + genericHits
      const trimmed =
        line.length > maxCharsPerSnippet
          ? line.slice(0, maxCharsPerSnippet - 1).trimEnd() + '…'
          : line
      ranked.push({ line: trimmed, score, source: entry.source })
    }
  }

  ranked.sort((a, b) => b.score - a.score)
  const seen = new Set()
  const out = []
  for (const r of ranked) {
    const lower = r.line.toLowerCase()
    if (out.some((o) => o.line.toLowerCase().includes(lower) || lower.includes(o.line.toLowerCase()))) {
      continue
    }
    const key = r.line.slice(0, 80).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
    if (out.length >= maxSnippets) break
  }
  return out
}
