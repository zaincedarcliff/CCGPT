// Source-priority system.
//
// Every URL that enters the pipeline (crawler, web search, LLM grounding) is classified into a
// tier. Lower tier number = more authoritative. Retrieval ranking, web-result ranking, and the
// prompt all use the tier so official Cedar Cliff / WSSD content wins over third-party pages.
//
//   Tier 1  Official West Shore School District / Cedar Cliff sources
//   Tier 2  Official government / education bodies (PDE, PIAA, College Board, partner colleges)
//           and athletics data feeds the district itself publishes to (MaxPreps, ArbiterLive)
//   Tier 3  Reliable third parties (local news, school-data aggregators)
//   Tier 4  Everything else (allowed but heavily down-ranked)
//   blocked User-generated / unreliable domains are never used

const TIER1_HOSTS = [
  'wssd.k12.pa.us',
  'psweb.wssd.k12.pa.us',
  'wssd.bz',
  'cedarcliffproductions.com',
  'cedarcliffcolts.com',
  'westshoresd.org',
]

// Google-hosted content is official only when it belongs to a district workspace or is a
// document linked from an official page. Google Sites under /wssd.bz/ are always official.
const TIER1_PATH_RULES = [
  { host: 'sites.google.com', pathPrefix: '/wssd.bz/' },
  { host: 'sites.google.com', pathPrefix: '/a/wssd.k12.pa.us/' },
  { host: 'sites.google.com', pathPrefix: '/wssd.k12.pa.us/' },
  { host: 'go.boarddocs.com', pathPrefix: '/pa/wssd/' },
  { host: 'boarddocs.com', pathPrefix: '/pa/wssd/' },
  // WSSD publishes its Board Policies (e.g. 213 Grading, 217 Graduation Requirements) on PolicyMain.
  { host: 'policymain.org', pathPrefix: '/west-shore-school-district' },
  { host: 'filecabinet9.eschoolview.com', pathPrefix: '/' }, // WSSD CMS file host (uploads/images)
]

const TIER2_HOSTS = [
  'education.pa.gov',
  'pa.gov',
  'paschoolperformance.org',
  'futurereadypa.org',
  'pde.state.pa.us',
  'piaa.org',
  'ed.gov',
  'nces.ed.gov',
  'collegeboard.org',
  'apstudents.collegeboard.org',
  'apcentral.collegeboard.org',
  'hacc.edu',
  'pct.edu',
  'centralpenn.edu',
  'harrisburgu.edu',
  'cpactc.org',
  'cumberlandcountypa.gov',
  'camphillpa.gov',
  'ccpa.net',
  // athletics data providers the district's own athletics pages link to
  'maxpreps.com',
  'arbiterlive.com',
  'arbitersports.com',
  'midpennconference.org',
  'pennlive.com/highschoolsports',
]

const TIER3_HOSTS = [
  'pennlive.com',
  'abc27.com',
  'fox43.com',
  'local21news.com',
  'cumberlink.com',
  'theburgnews.com',
  'patch.com',
  'wgal.com',
  'niche.com',
  'greatschools.org',
  'usnews.com',
  'publicschoolreview.com',
  'schooldigger.com',
  'wikipedia.org',
  'ballotpedia.org',
  'hudl.com',
  'gofan.co',
  'nfhsnetwork.com',
  'pa-news.com',
]

const BLOCKED_HOSTS = [
  'reddit.com',
  'quora.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'pinterest.com',
  'yelp.com',
  'ratemyteachers.com',
  'rateyourteacher.com',
  'answers.com',
  'brainly.com',
  'chegg.com',
  'coursehero.com',
  'quizlet.com',
  'yahoo.com/answers',
]

export const TIER_LABELS = {
  1: 'Official (WSSD / Cedar Cliff)',
  2: 'Trusted (state / education / athletics data)',
  3: 'Third-party',
  4: 'Other',
}

/** Extra official hosts can be added without a code change: KB_EXTRA_OFFICIAL_DOMAINS="a.org,b.org" */
function extraOfficialHosts() {
  const raw = process.env.KB_EXTRA_OFFICIAL_DOMAINS || ''
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean)
}

export function safeUrl(url) {
  try {
    return new URL(String(url))
  } catch {
    return null
  }
}

function hostMatches(host, list) {
  return list.some((h) => {
    const [ruleHost, ...rest] = h.split('/')
    if (rest.length) return false
    return host === ruleHost || host.endsWith(`.${ruleHost}`)
  })
}

function hostPathMatches(host, pathname, list) {
  return list.some((h) => {
    if (!h.includes('/')) return false
    const idx = h.indexOf('/')
    const ruleHost = h.slice(0, idx)
    const rulePath = h.slice(idx)
    return (host === ruleHost || host.endsWith(`.${ruleHost}`)) && pathname.startsWith(rulePath)
  })
}

/**
 * Classify a URL into a source tier (1–4). Returns 0 for blocked/unusable URLs.
 * @param {string} url
 * @param {{ linkedFromOfficial?: boolean }} [opts] — Google Docs/Drive files linked from an official page are official.
 */
export function classifySource(url, opts = {}) {
  const u = safeUrl(url)
  if (!u || !/^https?:$/.test(u.protocol)) return 0
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const pathname = u.pathname || '/'

  if (hostMatches(host, BLOCKED_HOSTS) || hostPathMatches(host, pathname, BLOCKED_HOSTS)) return 0

  if (hostMatches(host, [...TIER1_HOSTS, ...extraOfficialHosts()])) return 1
  if (TIER1_PATH_RULES.some((r) => (host === r.host || host.endsWith(`.${r.host}`)) && pathname.startsWith(r.pathPrefix))) return 1
  if (opts.linkedFromOfficial && isGoogleDocument(u)) return 1

  if (hostPathMatches(host, pathname, TIER2_HOSTS) || hostMatches(host, TIER2_HOSTS)) return 2
  if (hostMatches(host, TIER3_HOSTS)) return 3
  return 4
}

export function isGoogleDocument(u) {
  const url = typeof u === 'string' ? safeUrl(u) : u
  if (!url) return false
  const host = url.hostname.toLowerCase()
  return host === 'docs.google.com' || host === 'drive.google.com'
}

export function isOfficialTier(tier) {
  return tier === 1
}

/** Weight used to boost/penalize retrieval scores by tier. */
export function tierWeight(tier) {
  switch (tier) {
    case 1:
      return 1.0
    case 2:
      return 0.85
    case 3:
      return 0.7
    case 4:
      return 0.5
    default:
      return 0
  }
}

export function displayDomain(url) {
  const u = safeUrl(url)
  if (!u) return ''
  return u.hostname.replace(/^www\./, '')
}

/** Human-readable publisher label for citations, e.g. "West Shore School District". */
export function publisherLabel(url) {
  const u = safeUrl(url)
  if (!u) return ''
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const path = u.pathname.toLowerCase()
  if (host.endsWith('wssd.k12.pa.us')) {
    if (host.startsWith('psweb')) return 'PowerSchool — West Shore School District'
    return 'West Shore School District'
  }
  if (host === 'sites.google.com' && path.includes('wssd')) return 'Cedar Cliff / WSSD (Google Sites)'
  if (host.endsWith('wssd.bz')) return 'Cedar Cliff / WSSD'
  if (host.endsWith('cedarcliffproductions.com')) return 'Cedar Cliff Productions'
  if (host.endsWith('maxpreps.com')) return 'MaxPreps'
  if (host.endsWith('arbiterlive.com') || host.endsWith('arbitersports.com')) return 'ArbiterLive'
  if (host.endsWith('piaa.org')) return 'PIAA'
  if (host.endsWith('education.pa.gov') || host.endsWith('pde.state.pa.us')) return 'Pennsylvania Department of Education'
  if (host.endsWith('collegeboard.org')) return 'College Board'
  if (host.endsWith('hacc.edu')) return 'HACC'
  if (host.endsWith('pennlive.com')) return 'PennLive'
  if (host.endsWith('abc27.com')) return 'abc27'
  if (host.endsWith('boarddocs.com')) return 'WSSD School Board (BoardDocs)'
  if (host.endsWith('policymain.org')) return 'West Shore School District — Board Policies'
  if (host.endsWith('eschoolview.com')) return 'West Shore School District (file)'
  if (host === 'docs.google.com' || host === 'drive.google.com') return 'Google Docs / Drive'
  return host
}

/** Normalize a URL so the same page isn't stored twice (strip fragments, tracking params, trailing slash noise). */
export function normalizeUrl(url) {
  const u = safeUrl(url)
  if (!u) return null
  u.hash = ''
  const drop = []
  for (const key of u.searchParams.keys()) {
    if (/^(utm_|fbclid|gclid|mc_|ref$|source$|usp$)/i.test(key)) drop.push(key)
  }
  for (const key of drop) u.searchParams.delete(key)
  u.hostname = u.hostname.toLowerCase()
  if (u.pathname !== '/' && u.pathname.endsWith('/') && !/sites\.google\.com/.test(u.hostname)) {
    u.pathname = u.pathname.replace(/\/+$/, '')
  }
  return u.toString()
}
