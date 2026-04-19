import { GoogleGenerativeAI, DynamicRetrievalMode } from '@google/generative-ai'
import { studentKnowledge } from './studentKnowledge.js'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY
const modelName =
  import.meta.env.VITE_GEMINI_MODEL?.trim() || 'gemini-2.5-flash'

/** Set VITE_GEMINI_GOOGLE_SEARCH=false to disable (saves grounding billing). Default: on. */
function isGoogleSearchGroundingEnabled() {
  const v = import.meta.env.VITE_GEMINI_GOOGLE_SEARCH
  if (v === '0' || v === 'false') return false
  return true
}

function googleSearchTools() {
  if (!isGoogleSearchGroundingEnabled()) return undefined
  const thresholdRaw = import.meta.env.VITE_GEMINI_SEARCH_THRESHOLD
  const threshold =
    thresholdRaw !== undefined && thresholdRaw !== ''
      ? Number(thresholdRaw)
      : undefined

  return [
    {
      googleSearchRetrieval: {
        dynamicRetrievalConfig: {
          mode: DynamicRetrievalMode.MODE_DYNAMIC,
          ...(threshold !== undefined && !Number.isNaN(threshold)
            ? { dynamicThreshold: threshold }
            : {}),
        },
      },
    },
  ]
}

function appendGroundingSources(text, result) {
  const chunks = result?.response?.candidates?.[0]?.groundingMetadata?.groundingChunks
  if (!chunks?.length) return text
  const seen = new Set()
  const urls = []
  for (const ch of chunks) {
    const u = ch.web?.uri
    if (u && !seen.has(u)) {
      seen.add(u)
      urls.push(u)
    }
  }
  if (!urls.length) return text
  const lines = urls.slice(0, 8).map((u) => `- ${u}`)
  return `${text}\n\n**Sources (web)**\n${lines.join('\n')}`
}

const BASE_INSTRUCTION = `You are CCGPT, the official AI assistant for Cedar Cliff High School, part of the West Shore School District in Camp Hill, Pennsylvania.

## Your role
- Help students, parents, families, and staff with any school-related questions.
- When **Google Search grounding** is available, use it for recent or missing facts (scores, dates, news, “what happened today”, etc.). Prefer answers grounded in search when the built-in knowledge and scraped school data are not enough.
- Always try to give the most up-to-date information possible. If you are unsure even after search, say so and direct the user to the official website: https://www.wssd.k12.pa.us/cedarcliff.aspx

## Key school facts
- **Full name**: Cedar Cliff High School
- **Address**: 1301 Carlisle Road, Camp Hill, PA 17011
- **Phone**: 717-737-8654
- **Fax**: 717-737-0874
- **District**: West Shore School District
- **Mascot**: Colts
- **School colors**: Navy blue and gold
- **Website**: https://www.wssd.k12.pa.us/cedarcliff.aspx
- **Instagram**: @cedarcliff_colts

## Important pages & resources
- Cedar Cliff Guidance (counselors)
- Cedar Cliff Athletics
- Daily Announcements
- Student & Parent Handbook
- Student Activities Handbook
- High School Bell Schedule
- Cedar Cliff NHS (National Honor Society)
- Cedar Cliff Key Club
- Cedar Cliff JROTC
- Cedar Cliff Yearbook
- Cedar Cliff Musical
- Cedar Cliff Friends Forever Club
- Cedar Cliff Gifted Program
- Seniors 2026 information
- ExCEL Virtual Learning Academy
- PowerSchool (grades portal)
- Electronic Absence Submission

## District schools
Cedar Cliff HS, Red Land HS, Allen MS, Crossroads MS, New Cumberland MS, Fairview Intermediate, Old Trail Intermediate, Fishing Creek Elementary, Highland Elementary, Hillside Elementary, Newberry Elementary, Red Mill Elementary, Rossmoyne Elementary, Washington Heights Elementary, ExCEL Virtual Learning Academy, Cumberland Perry Area CTC.

## Academic integrity (required)
- **Do not** give direct answers, worked solutions, final numbers, or step-by-step solutions to problems that are clearly graded schoolwork (math, science, history questions, etc.).
- **Do not** write or complete essays, lab reports, discussion posts, or other assignments for the user.
- **Do not** provide quiz, test, or exam answers, or “what to put” for specific questions.
- **You may** help with **school logistics** (where to find assignments, how to use PowerSchool, counselor info, clubs, schedules) and **general study skills** (how to study, time management) when not tied to solving their specific graded task.
- If a message asks for homework help, problem solutions, or assignment completion—even without using those exact words—politely refuse the academic work and redirect: teacher, tutoring, approved resources, or classmates only as allowed by their teacher.

## Guidelines
- Answer clearly and concisely.
- You can answer about school life, events, and general topics that are not completing someone’s graded work. Use your general knowledge; when search grounding is enabled, use it when you need current or verifiable web information.
- Use plain text. You may use **bold** sparingly for section labels.
- Be friendly, supportive, and encouraging. Use the school spirit phrase "Go Colts!" when appropriate.
- For the latest news, events, schedules, and announcements, reference the official website or suggest the user check it.

${studentKnowledge}`

// --------------- scraped data loader ---------------

let schoolDataCache = null

async function loadSchoolData() {
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

const TOPIC_RULES = [
  { keywords: ['announcement', 'announcements', 'today', 'happening', 'event', 'events', 'news', 'blood drive', 'paintball', 'trivia', 'school store'],
    match: (src) => src.includes('DailyAnnouncements') },
  { keywords: [
      'sport', 'sports', 'game', 'games', 'score', 'scores', 'record', 'records', 'standing', 'standings',
      'win', 'wins', 'loss', 'losses', 'season', 'team', 'varsity', 'jv',
      'basketball', 'football', 'soccer', 'baseball', 'softball', 'lacrosse', 'tennis', 'golf', 'track',
      'swim', 'swimming', 'wrestling', 'volleyball', 'field hockey', 'cheerleading', 'cross country', 'athlete', 'athletic',
    ],
    match: (src) =>
      src.includes('sports-news') ||
      src.includes('Athletics') ||
      src.includes('arbiterlive') ||
      src.includes('Natatorium') ||
      src.includes('StadiumBag') },
  { keywords: ['schedule', 'bell', 'period', 'lunch', 'block'],
    match: (src) => src.includes('BellSchedule') },
  { keywords: ['counselor', 'guidance', 'counseling'],
    match: (src) => src.includes('Guidance') },
  { keywords: ['newsletter', 'monthly', 'e-news', 'enews'],
    match: (src) =>
      src.includes('newsletter') ||
      src.includes('Monthlye-News') },
  { keywords: ['lunch', 'cafeteria', 'menu', 'menus', 'food', 'breakfast', 'meal', 'meals', 'free and reduced'],
    match: (src) =>
      src.includes('FoodServices') ||
      src.includes('Menus.aspx') ||
      src.includes('FreeandReduced') ||
      src.includes('StudentMealAccounts') ||
      src.includes('WellnessPolicy') },
  { keywords: ['community'],
    match: (src) => src.includes('cc-community-news') },
  { keywords: ['lifestyle'],
    match: (src) => src.includes('cc-lifestyle-news') },
]

function getRelevantData(question, allData) {
  if (!allData || allData.length === 0) return ''

  const q = question.toLowerCase()
  const matched = []

  for (const rule of TOPIC_RULES) {
    if (rule.keywords.some((kw) => q.includes(kw))) {
      const entry = allData.find((d) => rule.match(d.source))
      if (entry && !matched.includes(entry)) matched.push(entry)
    }
  }

  const entries = matched.length > 0 ? matched : allData

  const sections = entries.map((entry) => {
    const label = entry.source.split('/').pop().replace('.aspx', '')
    const lines = entry.content.slice(0, 40).join('\n')
    return `### ${label}\n${lines}`
  })

  return sections.join('\n\n')
}

// --------------- homework / anti-cheat ---------------

/** Shown when the user asks for homework answers, solutions, or assignment completion (offline + Gemini). */
export const HOMEWORK_REFUSAL_MESSAGE = `I’m here for **Cedar Cliff school information** — not to do homework, quizzes, tests, or assignments for you. That keeps academic work honest.

**Try instead:** your teacher, study hall or tutoring, the counseling office, or resources your teacher approves (textbook, class materials, etc.).

Ask me about bell schedules, sports, clubs, counselors, announcements, or other school topics. Go Colts!`

/**
 * Detects requests aimed at getting graded work done for the user (not school logistics like “where is the homework posted”).
 * @param {string} text
 */
export function isHomeworkHelpRequest(text) {
  const t = text.toLowerCase()
  if (t.length < 4) return false

  const patterns = [
    /\bhomework help\b/,
    /\bhelp (me )?(with|on) (my )?homework\b/,
    /\b(do|finish|complete)\s+(my|the|this)\s+(homework|hw|assignment|essay|paper|worksheet|lab)\b/,
    /\b(can you|could you|please)\s+(do|solve|finish|complete)\s+(my|this|that|the)\b/,
    /\b(solve|work out|figure out)\s+(this|that|the|these|it)\b/,
    /\bwhat(?:'s| is|s)?\s+the\s+answers?\s+to\s+(number|question|problem|q\.?|this|that)\b/i,
    /\b(answer|answers)\s+to\s+(number|question|problem|q\.?)\s*\d+/i,
    /\bgive me (the )?answers?\s+(to|for)\b/,
    /\b(quiz|test|exam)\s+answers?\b/,
    /\bcheat(ing)?\s+(on|for|with)\b/,
    /\b(write|draft|complete)\s+(my|the)\s+(essay|paper|report|assignment)\b/,
    /\bshow (me )?(the )?(full )?(solution|work|steps)\b/,
    /\bhelp me (with )?(this|my) (problem|question|equation|proof|worksheet)\b/,
    /\b(answer|solve)\s+(number|question|problem)\s*\d+/i,
  ]

  return patterns.some((re) => re.test(t))
}

// --------------- public API ---------------

export function isGeminiConfigured() {
  return Boolean(apiKey && String(apiKey).trim())
}

/**
 * @param {string} userText
 * @returns {Promise<string>}
 */
export async function askGemini(userText) {
  if (!isGeminiConfigured()) {
    throw new Error('Gemini not configured — add VITE_GEMINI_API_KEY to .env.local')
  }

  if (isHomeworkHelpRequest(userText)) {
    return HOMEWORK_REFUSAL_MESSAGE
  }

  const data = await loadSchoolData()
  const relevantInfo = getRelevantData(userText, data)

  let systemInstruction = BASE_INSTRUCTION
  if (relevantInfo) {
    systemInstruction += `\n\n## Latest scraped school data (updated daily)\nUse this real-time data to answer the user. It was scraped directly from official school websites.\n\n${relevantInfo}`
  }

  const genAI = new GoogleGenerativeAI(String(apiKey).trim())
  const tools = googleSearchTools()

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
    ...(tools ? { tools } : {}),
  })

  let result
  try {
    result = await model.generateContent(userText)
  } catch (err) {
    if (
      tools &&
      (err?.message?.includes('tool') ||
        err?.message?.includes('GoogleSearch') ||
        err?.status === 400)
    ) {
      const fallback = genAI.getGenerativeModel({ model: modelName, systemInstruction })
      result = await fallback.generateContent(userText)
    } else {
      throw err
    }
  }

  let text = result.response.text()
  if (!text || !String(text).trim()) {
    throw new Error('Empty response from Gemini')
  }
  text = String(text).trim()
  if (isGoogleSearchGroundingEnabled() && tools) {
    text = appendGroundingSources(text, result)
  }
  return text
}
