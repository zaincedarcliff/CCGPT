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

/** Pulls every course title from WSSD curriculum pages, grouped by department.
 *  Course lines in the scrape follow the pattern:
 *    "<TITLE IN CAPS><6+ digit code>[.5|1] Credit(s) ... Weight..."
 *  Returns a map: { [deptName]: string[] of prettified titles, sorted } */
export function extractCourseCatalog(allData) {
  const catalog = {}
  if (!allData || allData.length === 0) return catalog

  const rawByDept = {}
  for (const entry of allData) {
    const dept = departmentForSource(entry.source)
    if (!dept) continue
    const seenTitles = (rawByDept[dept] ||= new Map())
    for (const raw of entry.content || []) {
      const s = String(raw).replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
      const courseRe = /([A-Z][A-Z0-9 \-&',/:()\.]{2,90}?)(\d{6,})(?:\s*\.?\s*\d+)?\s*Credits?\b/g
      let m
      while ((m = courseRe.exec(s)) !== null) {
        let title = m[1].replace(/\s+/g, ' ').trim()

        // Common scrape artifact: title ending in "LEVEL" loses its trailing
        // level number to the course code. Steal the first digit back.
        if (/\bLEVEL$/.test(title) && /^\d/.test(m[2])) {
          title = `${title} ${m[2].slice(0, 1)}`
        }

        // Drop trailing stray punctuation / hanging connector words.
        title = title.replace(/[\s\-–:,]+$/, '').trim()
        title = title.replace(/\s+\-\s+$/, '').trim()

        if (title.length < 4) continue
        if (/^LEVEL\b/.test(title)) continue
        if (/^(THE|A|AN|AND|OR|OF|IN|ON|FOR|WITH|TO)\b/.test(title)) continue

        const pretty = prettifyCourseTitle(title)
        const key = pretty.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        if (!key || seenTitles.has(key)) continue
        seenTitles.set(key, pretty)
      }
    }
  }

  for (const dept of Object.keys(rawByDept)) {
    const titles = [...rawByDept[dept].values()].sort((a, b) => a.localeCompare(b))
    if (titles.length > 0) catalog[dept] = titles
  }
  return catalog
}

/** Does this question ask for a course list / catalog? */
export function isCourseListQuestion(message) {
  const s = String(message || '').toLowerCase()
  const asksCourses = /\b(course|courses|class|classes|elective|electives|offering|offerings|curriculum|catalog|subject|subjects)\b/.test(s)
  const asksList = /\b(offer|offered|offering|offerings|available|list|what|which|all|every|every\s+class|take|taught|teach|teaching)\b/.test(s)
  if (!asksCourses) return false
  if (!asksList && !/\b(course list|course catalog|class list|courses offered|classes offered|all courses|all classes|every course|every class)\b/.test(s)) {
    return false
  }
  return true
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
