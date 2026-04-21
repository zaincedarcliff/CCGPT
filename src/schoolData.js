// Shared loader + topic matcher for the scraped Cedar Cliff data.
// Used by both the Gemini path (gemini.js) and the no-API-key fallback (App.jsx),
// so the bot answers from real school content either way.

let schoolDataCache = null

function toEntries(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  return []
}

/** Load scraped school data. Fetches **both** the static `/schoolData.json`
 *  (what was deployed with the latest build) and `/api/data` (Vercel Blob,
 *  may be updated by a cron), then merges by source URL keeping whichever
 *  entry has more content lines. That way a freshly deployed scrape isn't
 *  hidden by a stale blob, and vice versa. */
export async function loadSchoolData() {
  if (schoolDataCache) return schoolDataCache

  let fromStatic = []
  let fromApi = []

  const staticReq = fetch('/schoolData.json')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
  const apiReq = fetch('/api/data')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])

  const [staticPayload, apiPayload] = await Promise.all([staticReq, apiReq])
  fromStatic = toEntries(staticPayload)
  fromApi = toEntries(apiPayload)

  const bySource = new Map()
  const push = (entry) => {
    if (!entry?.source) return
    const existing = bySource.get(entry.source)
    const size = Array.isArray(entry.content) ? entry.content.length : 0
    const existingSize = existing?.content?.length || 0
    if (!existing || size > existingSize) bySource.set(entry.source, entry)
  }
  for (const e of fromStatic) push(e)
  for (const e of fromApi) push(e)

  schoolDataCache = [...bySource.values()]
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
    id: 'academics',
    keywords: [
      'credit', 'credits', 'graduation', 'graduate', 'graduating', 'diploma',
      'gpa', 'class rank', 'weighted', 'weight', 'honor roll',
      'ap', 'advanced placement', 'dual enrollment', 'hacc', 'college in the high school',
      'early admission', 'early admissions', 'early graduation',
      'schedule change', 'schedule changes', 'senior option', 'senior year',
      'study abroad', 'studying abroad', 'exchange', 'teen parenting', 'day care',
      'make-up', 'makeup', 'make up', 'summer school', 'academic contract', 'contract',
      'course selection', 'course sequencing', 'course requirement', 'requirements',
      'promotion', 'grade level', 'powerschool',
    ],
    match: (src) =>
      src.includes('CourseSequencing') ||
      src.includes('CreditRequirements') ||
      src.includes('AcademicContract') ||
      src.includes('AdvancedPlacement') ||
      src.includes('EarlyAdmissions') ||
      src.includes('EarlyGraduation') ||
      src.includes('Make-UpofFailures') ||
      src.includes('ScheduleChanges') ||
      src.includes('SeniorOption') ||
      src.includes('StudyingAbroad') ||
      src.includes('TeenParenting') ||
      src.includes('WeightedGrades') ||
      src.includes('DualEnrollment'),
  },
  {
    id: 'courses',
    keywords: [
      'course', 'courses', 'class', 'classes', 'elective', 'electives',
      'offering', 'offerings', 'department', 'curriculum', 'pathway', 'pathways',
      'prerequisite', 'prerequisites',
      'art', 'drawing', 'painting', 'ceramics', 'sculpture', 'animation',
      'business', 'marketing', 'accounting', 'personal finance',
      'computer science', 'programming', 'microsoft office',
      'engineering', 'technology', 'drafting', 'woodworking', 'metal', 'photography',
      'english', 'literature', 'writing', 'language arts', 'esl', 'ell',
      'health', 'physical education', 'pe ', 'wellness', 'sports medicine',
      'aquatics', 'lifeguard', 'strength training',
      'jrotc', 'rotc', 'library',
      'math', 'mathematics', 'algebra', 'geometry', 'calculus',
      'statistics', 'pre-calculus', 'precalculus',
      'music', 'band', 'chorus', 'orchestra', 'choir', 'music theory',
      'science', 'biology', 'chemistry', 'physics', 'anatomy', 'environmental',
      'social studies', 'history', 'government', 'economics', 'psychology', 'sociology',
      'special education',
      'world language', 'world languages', 'spanish', 'french',
      'co-op', 'coop', 'cooperative education', 'internship', 'internships',
      'diversified occupations',
    ],
    match: (src) =>
      src.includes('Art.aspx') ||
      src.includes('BusinessandMarketing') ||
      src.includes('ComputerScience') ||
      src.includes('EngineeringandTechnology') ||
      src.includes('English.aspx') ||
      src.includes('EnglishLanguageDev') ||
      src.includes('HealthPhysicalEd') ||
      src.includes('JuniorReserveOfficersTrainingCorps') ||
      src.includes('Library.aspx') ||
      src.includes('Mathematics') ||
      src.includes('Music.aspx') ||
      src.includes('Science.aspx') ||
      src.includes('SocialStudies') ||
      src.includes('SpecialEducation') ||
      src.includes('WorldLanguages') ||
      src.includes('CooperativeEducation') ||
      src.includes('DualEnrollment') ||
      src.includes('PathwayInternships'),
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

/** District academics / course catalog pages (union of academics + courses TOPIC_RULES matchers). */
function isCurriculumOrAcademicSource(src) {
  if (!src) return false
  const s = String(src)
  return (
    s.includes('CourseSequencing') ||
    s.includes('CreditRequirements') ||
    s.includes('AcademicContract') ||
    s.includes('AdvancedPlacement') ||
    s.includes('EarlyAdmissions') ||
    s.includes('EarlyGraduation') ||
    s.includes('Make-UpofFailures') ||
    s.includes('ScheduleChanges') ||
    s.includes('SeniorOption') ||
    s.includes('StudyingAbroad') ||
    s.includes('TeenParenting') ||
    s.includes('WeightedGrades') ||
    s.includes('DualEnrollment') ||
    s.includes('Art.aspx') ||
    s.includes('BusinessandMarketing') ||
    s.includes('ComputerScience') ||
    s.includes('EngineeringandTechnology') ||
    s.includes('English.aspx') ||
    s.includes('EnglishLanguageDev') ||
    s.includes('HealthPhysicalEd') ||
    s.includes('JuniorReserveOfficersTrainingCorps') ||
    s.includes('Library.aspx') ||
    s.includes('Mathematics') ||
    s.includes('Music.aspx') ||
    s.includes('Science.aspx') ||
    s.includes('SocialStudies') ||
    s.includes('SpecialEducation') ||
    s.includes('WorldLanguages') ||
    s.includes('CooperativeEducation') ||
    s.includes('PathwayInternships')
  )
}

/** When no TOPIC_RULES keyword matches, still search curriculum pages by word overlap. */
export function getFallbackCurriculumEntries(allData) {
  if (!allData || allData.length === 0) return []
  return allData.filter((e) => isCurriculumOrAcademicSource(e.source))
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
  let entries = getRelevantEntries(question, allData)
  /** No topic keyword matched — still search course/policy pages by question words. */
  const fallbackMode = entries.length === 0
  if (fallbackMode) {
    entries = getFallbackCurriculumEntries(allData)
  }
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

      if (fallbackMode) {
        if (queryTerms.length === 0 || genericHits < 1) continue
      } else if (domainHits === 0) {
        continue
      }

      const score = fallbackMode
        ? genericHits * 8 + domainHits * 10
        : domainHits * 10 + genericHits
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

/** Returns a deduplicated, nicely-cased list of AP courses found in the scrape.
 *  Matches real course titles from WSSD curriculum pages, which follow the
 *  format "<SUBJECT IN CAPS> (ADVANCED PLACEMENT) (OPTIONAL QUALIFIER)<digits>",
 *  plus a known mixed-case title: "Pre-calculus Advanced Placement". */
export function extractAPCourses(allData) {
  if (!allData || allData.length === 0) return []
  const found = new Map()

  const prettify = (rawSubject) => {
    let s = String(rawSubject).replace(/\s+/g, ' ').trim()
    const upper = s.replace(/[^A-Z]/g, '').length
    const letters = s.replace(/[^A-Za-z]/g, '').length
    if (letters > 0 && upper / letters > 0.7) {
      s = s.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase())
      s = s.replace(/\bAnd\b/g, 'and')
      s = s.replace(/\bOf\b/g, 'of')
      s = s.replace(/\bOr\b/g, 'or')
      s = s.replace(/^Us\b/, 'US')
      s = s.replace(/\bUs\b/, 'US')
    }
    s = s.replace(/\bAb\b/g, 'AB')
    s = s.replace(/\bBc\b/g, 'BC')
    return s.replace(/\s+/g, ' ').trim()
  }

  const add = (subject) => {
    const pretty = prettify(subject)
    if (!pretty || pretty.length < 2 || pretty.length > 60) return
    const key = pretty.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!key || found.has(key)) return
    found.set(key, `AP ${pretty}`)
  }

  /** "SUBJECT (ADVANCED PLACEMENT) (OPTIONAL QUALIFIER)" followed by a course code. */
  const withParens = /\b([A-Z][A-Z0-9 ,'\-&/:]{2,60}?)\s*\(\s*ADVANCED PLACEMENT\s*\)(?:\s*\(([^)]+)\))?\s*\d/g
  /** "SUBJECT ADVANCED PLACEMENT (OPTIONAL QUALIFIER)" followed by a course code (no parens around ADVANCED PLACEMENT). */
  const noParens = /\b([A-Z][A-Z0-9 ,'\-&/:]{2,60}?)\s+ADVANCED PLACEMENT(?:\s*\(([^)]+)\))?\s*\d/g

  for (const entry of allData) {
    for (const raw of entry.content || []) {
      const s = String(raw)
      if (!/ADVANCED PLACEMENT/.test(s) && !/Pre-calculus Advanced Placement/.test(s)) continue

      let m
      while ((m = withParens.exec(s)) !== null) {
        add(m[1].replace(/\s+/g, ' ').trim())
      }
      while ((m = noParens.exec(s)) !== null) {
        const subject = m[1].replace(/\s+/g, ' ').trim()
        if (/ADVANCED PLACEMENT/.test(subject)) continue
        add(subject)
      }

      if (/Pre-calculus Advanced Placement/.test(s)) {
        add('Pre-calculus')
      }
    }
  }

  return [...found.values()].sort((a, b) => a.localeCompare(b))
}

/** Map of course-catalog source URLs → human-friendly department names. */
export const COURSE_DEPARTMENTS = [
  { match: 'Art.aspx', name: 'Art' },
  { match: 'BusinessandMarketing', name: 'Business & Marketing' },
  { match: 'ComputerScience', name: 'Computer Science' },
  { match: 'EngineeringandTechnology', name: 'Engineering & Technology' },
  { match: 'English.aspx', name: 'English' },
  { match: 'EnglishLanguageDev', name: 'English Language Development (ESL)' },
  { match: 'HealthPhysicalEd', name: 'Health & Physical Education' },
  { match: 'JuniorReserveOfficersTrainingCorps', name: 'JROTC' },
  { match: 'Library.aspx', name: 'Library' },
  { match: 'Mathematics', name: 'Mathematics' },
  { match: 'Music.aspx', name: 'Music' },
  { match: 'Science.aspx', name: 'Science' },
  { match: 'SocialStudies', name: 'Social Studies' },
  { match: 'SpecialEducation', name: 'Special Education' },
  { match: 'WorldLanguages', name: 'World Languages' },
  { match: 'CooperativeEducation', name: 'Cooperative Education' },
  { match: 'PathwayInternships', name: 'Pathway Internships' },
]

function departmentForSource(src) {
  if (!src) return null
  for (const d of COURSE_DEPARTMENTS) {
    if (String(src).includes(d.match)) return d.name
  }
  return null
}

/** Prettify an all-caps course title from the catalog into "Sentence Case"
 *  while preserving common acronyms, roman numerals, and joiner words. */
function prettifyCourseTitle(raw) {
  let s = String(raw).replace(/\s+/g, ' ').trim()
  s = s.replace(/\s+&\s+/g, ' & ')
  s = s.replace(/\s*,\s*/g, ', ')

  const keepUpper = new Set([
    'AP', 'AB', 'BC', 'US', 'USA', 'JROTC', 'ROTC', 'HACC', 'CCHS',
    'IT', 'PC', 'DIY', 'CAD', 'FBLA', 'DECA', 'HU', 'DNA', 'TV', 'ELD', 'ESL',
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    'IA', 'IB', 'IIA', 'IIB',
  ])
  const keepLower = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'to', 'in', 'for', 'on', 'with'])

  const words = s.split(' ')
  const out = words.map((w, i) => {
    if (!w) return w
    const stripped = w.replace(/[^A-Za-z0-9&/]/g, '')
    const upper = stripped.toUpperCase()
    if (keepUpper.has(upper)) {
      return w.replace(stripped, upper)
    }
    if (i > 0 && keepLower.has(upper.toLowerCase())) {
      return w.toLowerCase()
    }
    const letters = w.replace(/[^A-Za-z]/g, '')
    const isAllCaps = letters.length > 0 && letters === letters.toUpperCase()
    if (isAllCaps) {
      return w.replace(/([A-Za-z])([A-Za-z]*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase())
    }
    return w
  })
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

/** Heuristically tag a course from its raw line + nearby description text.
 *  To avoid bleed from prose descriptions that *mention* other pathways
 *  (e.g. an honors course description saying "leads to Advanced Placement"),
 *  pathway tags (AP, Honors, Dual Enrollment) are only detected in:
 *    - the course title itself, OR
 *    - the short metadata "tag line" right after the credit/weight block
 *      (before "Prerequisite(s):" or the first prose sentence). */
function detectCourseTags(title, contextText) {
  const tags = new Set()
  const t = title.toUpperCase()
  const ctx = String(contextText || '').replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')

  // The catalog format puts attribute tags (NCAA, AP, Dual Enrollment, etc.)
  // between the "Weight" marker and either "Prerequisite(s):" or the start of
  // the prose description. Extract just that slice for pathway detection.
  let tagBand = ctx
  const prereqIdx = tagBand.search(/Prerequisite\(s\)/i)
  if (prereqIdx >= 0) tagBand = tagBand.slice(0, prereqIdx)
  tagBand = tagBand.slice(0, 200)
  // The scrape often concatenates labels with no whitespace ("WeightNCAA",
  // "NCAAAPDualEnrollment"). Insert spaces at case transitions so word-boundary
  // regexes match each label.
  tagBand = tagBand
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]{2,})(?=[A-Z][a-z])/g, '$1 ')
    .replace(/\s+/g, ' ')

  const titleAndBand = `${t} ${tagBand}`

  if (/\bAP\b/.test(titleAndBand) || /ADVANCED PLACEMENT/i.test(titleAndBand)) tags.add('AP')
  if (/\bHONORS\b/i.test(titleAndBand)) tags.add('Honors')
  if (/DUAL ENROLLMENT/i.test(titleAndBand) || /\bCollege in (?:the )?High School\b/i.test(titleAndBand)) {
    tags.add('Dual Enrollment')
  }

  // Always-safe tags (depend on title or whole context).
  if (/^COLLEGE\b/.test(t) || /\bCOLLEGE\b/.test(t)) tags.add('College')
  if (/\bNCAA\b/.test(tagBand)) tags.add('NCAA')
  if (/\bHACC\b/i.test(ctx) || /Harrisburg Area Community College/i.test(ctx)) tags.add('HACC')
  // Catch courses that are clearly dual-enrollment by description even when
  // the short tag band didn't explicitly say "Dual Enrollment".
  if (!tags.has('Dual Enrollment')) {
    if ((/^COLLEGE\b/.test(t) || /\bCOLLEGE\b/.test(t)) && (tags.has('HACC') || /Harrisburg University/i.test(ctx) || /Penn College/i.test(ctx))) {
      tags.add('Dual Enrollment')
    }
  }
  if (/\bHarrisburg University\b/i.test(ctx) || /\bHU\b/.test(tagBand) || /\(HU [A-Z]/.test(title)) {
    tags.add('Harrisburg University')
  }
  if (/Penn College|Pennsylvania College of Technology/i.test(ctx)) tags.add('Penn College')
  if (/\(SEMESTER\)|\bSEMESTER\b/i.test(t)) tags.add('Semester')
  if (/\(FULL YEAR\)|\(YEAR LONG\)|\bFULL YEAR\b|\bYEAR LONG\b/i.test(t)) tags.add('Full Year')
  if (/Teacher Recommendation/i.test(tagBand)) tags.add('Teacher Recommendation Required')
  if (/summer (?:reading|work|assignment)/i.test(ctx)) tags.add('Summer Work')
  if (/\bLEVEL 1\b/i.test(t) || /\bLEVEL I\b/i.test(t)) tags.add('Level 1')
  if (/\bLEVEL 2\b/i.test(t) || /\bLEVEL II\b/i.test(t)) tags.add('Level 2')

  return [...tags]
}

/** Extract a list of course objects from WSSD curriculum pages.
 *  Each object: { title, dept, source, tags: string[], description }
 *  Each title is prettified; tags are inferred from the raw course line and the
 *  following content chunk so questions can filter by AP / Dual Enrollment /
 *  Honors / College / HACC / Semester / Full Year / etc. */
export function extractCourses(allData) {
  const results = []
  if (!allData || allData.length === 0) return results

  const nextCourseRe = /[A-Z][A-Z0-9 \-&',/:()\.]{2,90}?\d{6,}(?:\s*\.?\s*\d+)?\s*Credits?\b/

  for (const entry of allData) {
    const dept = departmentForSource(entry.source)
    if (!dept) continue
    const content = entry.content || []
    for (let i = 0; i < content.length; i++) {
      const rawLine = String(content[i]).replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
      const courseRe = /([A-Z][A-Z0-9 \-&',/:()\.]{2,90}?)(\d{6,})(?:\s*\.?\s*\d+)?\s*Credits?\b/g
      let m
      while ((m = courseRe.exec(rawLine)) !== null) {
        let title = m[1].replace(/\s+/g, ' ').trim()

        if (/\bLEVEL$/.test(title) && /^\d/.test(m[2])) {
          title = `${title} ${m[2].slice(0, 1)}`
        }
        title = title.replace(/[\s\-–:,]+$/, '').trim()
        title = title.replace(/\s+\-\s+$/, '').trim()

        if (title.length < 4) continue
        if (/^LEVEL\b/.test(title)) continue
        if (/^(THE|A|AN|AND|OR|OF|IN|ON|FOR|WITH|TO)\b/.test(title)) continue

        const pretty = prettifyCourseTitle(title)

        const startCtx = m.index + m[0].length
        const restOfLine = rawLine.slice(startCtx)
        const nextMatch = restOfLine.match(nextCourseRe)
        const lineContext = nextMatch ? restOfLine.slice(0, nextMatch.index) : restOfLine

        let combined = lineContext
        if (!nextMatch) {
          const nextBlock = String(content[i + 1] || '').replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
          if (nextBlock && !nextCourseRe.test(nextBlock)) {
            combined = `${lineContext} ${nextBlock}`
          }
        }
        const contextText = combined.slice(0, 1200).trim()
        const tags = detectCourseTags(title, contextText)

        results.push({
          title: pretty,
          dept,
          source: entry.source,
          tags,
          description: contextText,
        })
      }
    }
  }

  const seen = new Set()
  const unique = []
  for (const c of results) {
    const key = `${c.dept}|${c.title.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(c)
  }
  unique.sort((a, b) => a.dept.localeCompare(b.dept) || a.title.localeCompare(b.title))
  return unique
}

/** Group a flat list of course objects by department. */
export function groupCoursesByDept(courses) {
  const grouped = {}
  for (const c of courses) {
    if (!grouped[c.dept]) grouped[c.dept] = []
    grouped[c.dept].push(c)
  }
  return grouped
}

/** Back-compat wrapper: { deptName: string[] of titles } */
export function extractCourseCatalog(allData) {
  const courses = extractCourses(allData)
  const grouped = groupCoursesByDept(courses)
  const out = {}
  for (const [dept, list] of Object.entries(grouped)) {
    out[dept] = list.map((c) => c.title)
  }
  return out
}

/** Filter criteria spec:
 *    tags: string[]        - require ALL listed tags (case-insensitive)
 *    anyTags: string[]     - require ANY of these tags (case-insensitive)
 *    dept: string          - exact dept name
 *    keyword: string       - search across title + description (case-insensitive) */
export function filterCourses(courses, criteria = {}) {
  const lc = (x) => String(x || '').toLowerCase()
  const reqAll = (criteria.tags || []).map(lc)
  const reqAny = (criteria.anyTags || []).map(lc)
  const keyword = lc(criteria.keyword).trim()
  const dept = criteria.dept || null

  return courses.filter((c) => {
    if (dept && c.dept !== dept) return false
    const tagsLc = c.tags.map(lc)
    for (const t of reqAll) if (!tagsLc.includes(t)) return false
    if (reqAny.length > 0 && !reqAny.some((t) => tagsLc.includes(t))) return false
    if (keyword) {
      const hay = `${c.title} ${c.description}`.toLowerCase()
      if (!hay.includes(keyword)) return false
    }
    return true
  })
}

/** Parse a user question into a filter spec. Picks up tags, department, and
 *  any significant remaining keyword. Used by the offline course handler and
 *  echoed to Gemini for structured guidance. */
export function parseCourseQuery(message, deptNames = []) {
  const lower = String(message || '').toLowerCase()
  const tags = []
  const TAG_PHRASES = [
    ['AP', /\b(ap|advanced\s+placement)\b/],
    ['Honors', /\bhonors?\b/],
    ['Dual Enrollment', /dual\s*enroll(?:ment)?|college\s+in\s+(?:the\s+)?high\s+school|\bhs\s+college\b/],
    ['College', /\bcollege(?:\s+level)?\b/],
    ['NCAA', /\bncaa\b/],
    ['HACC', /\bhacc\b/],
    ['Harrisburg University', /\bharrisburg\s+university\b|\bhu\b/],
    ['Penn College', /\bpenn\s+college\b|\bpennsylvania\s+college\s+of\s+technology\b/],
    ['Semester', /\bsemester(?:\s+only)?\b|\bhalf[\s-]year\b/],
    ['Full Year', /\b(full[\s-]year|year[\s-]long|yearlong)\b/],
    ['Summer Work', /\bsummer\s+(?:work|reading|assignment)s?\b/],
  ]
  for (const [tag, re] of TAG_PHRASES) {
    if (re.test(lower)) tags.push(tag)
  }

  /** Ordered so more-specific depts (ESL, World Languages) match before
   *  overlapping generic ones (English, Art, etc.). */
  const deptKeywordOrder = [
    ['English Language Development (ESL)', ['english language development', 'esl', 'ell', 'eld']],
    ['World Languages', ['world language', 'world languages', 'foreign language', 'spanish', 'french', 'german', 'chinese', 'japanese']],
    ['Cooperative Education', ['co-op', 'coop', 'cooperative education']],
    ['Pathway Internships', ['internship', 'internships', 'pathway', 'pathways']],
    ['Computer Science', ['computer science', 'compsci', 'programming', 'coding', 'it essentials']],
    ['Engineering & Technology', ['engineering', 'drafting', 'woodworking', 'metal', 'robotics', 'drones', 'drone', 'graphic', 'cte ', ' cte', 'technical education', 'technology', 'carpentry']],
    ['Health & Physical Education', ['physical education', 'phys ed', ' pe ', 'wellness', 'sports medicine', 'lifeguard', 'strength training', 'fitness']],
    ['Business & Marketing', ['business', 'marketing', 'accounting', 'finance', 'entrepreneur']],
    ['JROTC', ['jrotc', 'rotc']],
    ['Library', ['library']],
    ['Special Education', ['special education', 'special ed', 'life skills']],
    ['Social Studies', ['social studies', 'history', 'government', 'economics', 'psychology', 'sociology', 'world religions', 'anthropology', 'civics']],
    ['Music', ['music', 'band', 'choir', 'chorus', 'orchestra', 'jazz', 'ensemble', 'musicianship']],
    ['Art', ['art ', ' art', 'drawing', 'painting', 'ceramic', 'ceramics', 'sculpture', 'animation', 'studio art', 'art studio']],
    ['Science', ['science', 'biology', 'chemistry', 'physics', 'anatomy', 'meteorology', 'geology']],
    ['Mathematics', ['math', 'mathematics', 'algebra', 'geometry', 'calculus', 'precalc', 'pre-calc', 'pre-calculus', 'precalculus', 'statistics', 'trigonometry']],
    ['English', ['english', 'literature', 'composition', 'creative writing', 'broadcasting', 'journalism', 'language arts', 'speech']],
  ]
  let dept = null
  const available = new Set(deptNames)
  for (const [name, kws] of deptKeywordOrder) {
    if (available.size > 0 && !available.has(name)) continue
    if (kws.some((kw) => lower.includes(kw))) {
      dept = name
      break
    }
  }

  return { tags, dept, rawLower: lower }
}

/** Does this question ask for a course list / catalog (broad or narrow)?
 *  Deliberately permissive: any mention of a course tag (AP, honors, dual
 *  enrollment, HACC, NCAA, semester/year-long), a course word (course, class,
 *  elective, curriculum, catalog), or a "college X course/class" phrasing
 *  is treated as a catalog query. The handler downstream gracefully shows a
 *  helpful message if no courses match. */
export function isCourseListQuestion(message) {
  const s = String(message || '').toLowerCase()
  const tagWords = /\b(ap|advanced placement|honors?|dual enroll(?:ment)?|ncaa|hacc|harrisburg university|penn college|summer work|summer reading)\b/
  const collegePhrase = /\bcollege\s+(?:course|class|courses|classes|level|credit|credits)\b|\bcollege\s+in\s+(?:the\s+)?high\s+school\b/
  const scheduleWord = /\b(semester[-\s]?only|full[-\s]?year|year[-\s]?long|yearlong)\b/
  const courseWords = /\b(course|courses|class|classes|elective|electives|offering|offerings|curriculum|catalog|subjects?|program|programs)\b/
  const strong = /\b(course list|course catalog|class list|courses offered|classes offered|all courses|all classes|every course|every class)\b/

  if (strong.test(s)) return true
  if (courseWords.test(s)) return true
  if (collegePhrase.test(s)) return true
  if (tagWords.test(s)) return true
  if (scheduleWord.test(s)) return true
  return false
}

/** Canonical named sports users mention in questions. Shared by extractors. */
export const NAMED_SPORTS = [
  'basketball', 'football', 'soccer', 'baseball', 'softball', 'lacrosse',
  'tennis', 'golf', 'track', 'swim', 'swimming', 'wrestling', 'volleyball',
  'field hockey', 'cheerleading', 'cross country', 'bocce', 'archery', 'hockey',
]

/** Returns the first sport name found in the question text, or null. */
export function detectNamedSport(text) {
  const t = String(text || '').toLowerCase()
  for (const s of NAMED_SPORTS) {
    if (t.includes(s)) return s
  }
  return null
}

function sportUrlPattern(sport) {
  const slug = sport === 'track' ? 'track-field' : sport.replace(/\s+/g, '-')
  return new RegExp(`maxpreps\\.com.*${slug}`, 'i')
}

/** Heuristics that identify a MaxPreps line worth showing (a game recap,
 *  preview, score line, or dated game-result sentence). */
const GAME_LINE_PATTERNS = [
  /^On\s+(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day,\s+[A-Z][a-z]+\s+\d+,\s+\d{4}/,
  /\b(Recap|Preview|Highlights?)\b/i,
  /\b(Takes? a Loss|Takes? the Win|Beats?|Defeats?|Falls to|Wins?|Extends?|Ends?\s+.*Streak)\b/i,
  /\b\d+\s*[-–]\s*\d+\b/,
]

/** Guaranteed fallback: when the keyword-ranked path returns nothing, still
 *  surface the most recent clean MaxPreps lines for a named sport so the bot
 *  never says "no updates" while the scrape actually has data. */
export function extractLatestForSport(sport, allData, opts = {}) {
  if (!sport || !allData || allData.length === 0) return []
  const { maxSnippets = 6, maxCharsPerSnippet = 320 } = opts
  const urlRe = sportUrlPattern(sport)
  const entries = allData.filter((d) => urlRe.test(d.source))
  if (entries.length === 0) return []

  const out = []
  const seen = new Set()

  for (const entry of entries) {
    for (const raw of entry.content || []) {
      if (isNavigationBlock(raw)) continue
      const line = cleanLine(raw)
      if (line.length < 25) continue
      if (!GAME_LINE_PATTERNS.some((re) => re.test(line))) continue

      const lower = line.toLowerCase()
      const key = lower.slice(0, 80)
      if (seen.has(key)) continue
      if (out.some((o) => o.line.toLowerCase().includes(lower) || lower.includes(o.line.toLowerCase()))) continue
      seen.add(key)

      const trimmed =
        line.length > maxCharsPerSnippet
          ? line.slice(0, maxCharsPerSnippet - 1).trimEnd() + '…'
          : line
      out.push({ line: trimmed, source: entry.source })
      if (out.length >= maxSnippets) return out
    }
  }
  return out
}
