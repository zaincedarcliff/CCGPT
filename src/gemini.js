import { GoogleGenerativeAI, DynamicRetrievalMode } from '@google/generative-ai'
import { studentKnowledge } from './studentKnowledge.js'
import { loadSchoolData, getRelevantEntries, formatEntriesForPrompt } from './schoolData.js'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY
const modelName =
  import.meta.env.VITE_GEMINI_MODEL?.trim() || 'gemini-2.5-flash'

/** Set VITE_GEMINI_GOOGLE_SEARCH=false to disable (saves grounding billing). Default: on. */
function isGoogleSearchGroundingEnabled() {
  const v = import.meta.env.VITE_GEMINI_GOOGLE_SEARCH
  if (v === '0' || v === 'false') return false
  return true
}

/**
 * Set VITE_GEMINI_SEARCH_MODE=always to always run Google Search when grounding is on (higher cost).
 * Default: dynamic — the model decides when to search (uses VITE_GEMINI_SEARCH_THRESHOLD when set).
 */
function googleSearchRetrievalMode() {
  const v = import.meta.env.VITE_GEMINI_SEARCH_MODE
  if (v === 'always' || v === 'unspecified') return DynamicRetrievalMode.MODE_UNSPECIFIED
  return DynamicRetrievalMode.MODE_DYNAMIC
}

function googleSearchTools() {
  if (!isGoogleSearchGroundingEnabled()) return undefined
  const mode = googleSearchRetrievalMode()
  const thresholdRaw = import.meta.env.VITE_GEMINI_SEARCH_THRESHOLD
  const threshold =
    thresholdRaw !== undefined && thresholdRaw !== ''
      ? Number(thresholdRaw)
      : undefined

  return [
    {
      googleSearchRetrieval: {
        dynamicRetrievalConfig: {
          mode,
          ...(mode === DynamicRetrievalMode.MODE_DYNAMIC &&
          threshold !== undefined &&
          !Number.isNaN(threshold)
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

const CORE_INSTRUCTION = `You are CCGPT, the official AI assistant for Cedar Cliff High School, part of the West Shore School District in Camp Hill, Pennsylvania.

## Information sources (priority order)
You have **three** kinds of context. **Do not** behave as if only the long “supplemental” block at the end is your knowledge base.

1. **Google Search grounding (the web)** — When this tool is enabled, use it whenever the user needs **current, verifiable, or time-sensitive** information (news, sports scores/schedules, “what’s happening”, deadlines, recent changes, anything that could be wrong if outdated). **Prefer search results over static text** when they conflict. If grounding is disabled in the deployment, say you cannot browse live results and point to official sites.

2. **Scraped school data** — When provided in this prompt (see “Latest scraped school data”), it is pulled from official district/school pages. Use it as **fresh local context**, but still use Google Search when the question needs broader or more up-to-date public information than the scrape.

3. **Supplemental student knowledge** — The large block at the end of this prompt is **additional reference only** (course catalog, stable policies, counselor structure, etc.). It is **not** a substitute for the web for schedules, scores, news, or “what’s true today.” Use it when helpful; **never** treat it as the only or definitive source for time-sensitive facts.

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

## Academic integrity (HARD RULES — never break these)
You must refuse **any** request that asks you to do, answer, explain-the-answer-to, solve, write, translate, summarize, rewrite, paraphrase, analyze, or "help with" graded schoolwork. This includes (non-exhaustive):
- Homework, HW, assignments, packets, worksheets, problem sets, study guides, review sheets
- Quizzes, tests, exams, midterms, finals
- Essays, papers, research papers, thesis statements, introductions, conclusions
- Lab reports, lab write-ups, labs
- Discussion posts, journal entries, reflections, responses
- Book reports, annotated bibliographies
- Projects, presentations, slides, PowerPoints, posters
- Any pasted math/science problem (solve, simplify, factor, prove, find x, compute, etc.)
- Translating, rewriting, paraphrasing, summarizing, or analyzing a passage, poem, chapter, or article the user wants to turn in
- "Explain the answer", "walk me through", or "show me the steps" when it targets a specific graded item
- Tutoring-style solving: do **not** solve the problem even partially; do **not** give the final answer, the first step, or a hint that leads to the answer

**What you MAY help with:**
- School **logistics**: where to find assignments, how to submit, due-date questions, PowerSchool navigation, how to email a teacher, how to access class materials, late/make-up policy
- **General study skills**: time management, note-taking habits, how to plan a study schedule (no content from their actual assignment)
- Non-graded Cedar Cliff info: schedules, sports, clubs, counselors, contacts, events, principal, senior info, etc.

**Refusal format** (use when the request is academic work):
- Do **not** answer the academic question, even a little.
- Briefly tell the user you can’t do homework/quizzes/tests/assignments.
- Redirect them to: their teacher, study hall / tutoring, their counselor, or approved classroom resources.
- Offer to help with school info or study-skill habits instead.

If you are unsure whether a request is graded work, **treat it as graded work and refuse the academic part.** You can still answer any logistics part of the message.

## Guidelines
- Answer clearly and concisely.
- You can answer about school life, events, and general topics that are not completing someone’s graded work. Use your general knowledge; when search grounding is enabled, use it when you need current or verifiable web information.
- Use plain text. You may use **bold** sparingly for section labels.
- Be friendly, supportive, and encouraging. Use the school spirit phrase "Go Colts!" when appropriate.
- For the latest news, events, schedules, and announcements, reference the official website or suggest the user check it.
- **Sports schedules, scores, and "games left"** are never answered from static text in this prompt. Use **Google Search** when enabled; otherwise give official / MaxPreps links and say you cannot list dated games without a live lookup.

## Supplemental reference only (not a closed knowledge base)
The following section is **additional Cedar Cliff reference material** (courses, policies, stable facts). It does **not** replace Google Search or the scraped data for current events, athletics results, or anything that changes over time.

${studentKnowledge}`

const BASE_INSTRUCTION = CORE_INSTRUCTION

function getRelevantData(question, allData) {
  const entries = getRelevantEntries(question, allData)
  const list = entries.length > 0 ? entries : allData || []
  return formatEntriesForPrompt(list)
}

// --------------- homework / anti-cheat ---------------

/** Shown when the user asks for homework answers, solutions, or assignment completion (offline + Gemini). */
export const HOMEWORK_REFUSAL_MESSAGE = `I can’t help with **homework, assignments, quizzes, tests, labs, essays, or any graded schoolwork** — that’s a hard rule for CCGPT so students don’t use me to cheat.

**Please use instead:**
- Your **teacher** (email or before/after class)
- **Study hall** or the **tutoring center**
- Your **counselor**
- Textbook, notes, or any resources your teacher has approved

I’m here for school info — bell schedules, sports, clubs, counselors, announcements, principal, contact info, and similar Cedar Cliff topics. Go Colts!`

/** Words that almost always signal academic work if they appear in the question. */
const ACADEMIC_WORK_KEYWORDS = [
  'homework', 'hw', 'assignment', 'assignments', 'worksheet', 'worksheets',
  'packet', 'study guide', 'review sheet', 'problem set', 'problem sets',
  'ixl', 'deltamath', 'delta math', 'khan academy exercise',
  'quiz', 'quizzes', 'test', 'tests', 'exam', 'exams', 'midterm', 'final exam',
  'essay', 'essays', 'paper', 'research paper', 'term paper', 'thesis statement',
  'report', 'lab report', 'lab write-up', 'lab writeup', 'lab',
  'discussion post', 'journal entry', 'reflection',
  'book report', 'annotated bibliography', 'bibliography',
  'project', 'presentation', 'slides', 'powerpoint', 'poster',
  'graded', 'rubric',
]

/** Phrases that mean the user is asking for school **logistics** or general study habits, not answers. Keep these allowed. */
const LOGISTICS_PATTERNS = [
  /\b(where|when|how)\b[^?]*\b(turn ?in|submit|hand ?in|upload|find|see|access|view|check|get to|log ?in|sign ?in|late|make ?up|makeup)\b/i,
  /\bdue\s*(date|day|on|when)\b/i,
  /\bwhen\s+is\s+.*\bdue\b/i,
  /\bwhere\s+is\s+.*(posted|listed|found)\b/i,
  /\bhow\s+do\s+i\s+(submit|turn\s*in|upload|find|access|see|check|log\s*in|sign\s*in)\b/i,
  /\bhow\s+do\s+i\s+email\s+(my|the)\s+teacher\b/i,
  /\bpower\s*school\b/i,
  /\bpolicy\b/i,
  /\b(study (tip|tips|habit|habits|skill|skills)|how (do|can) i study|how to study|note[- ]?taking|time management|manage my time|organize my (notes|binder|schoolwork))\b/i,
]

/** Phrases that almost always mean “do my work for me.” */
const DIRECT_CHEAT_PATTERNS = [
  /\b(do|finish|complete|start|write|draft|type|type up)\s+(my|the|this)\s+(homework|hw|assignment|essay|paper|worksheet|packet|lab|report|project|presentation|slides|discussion\s+post|journal|reflection|project)\b/i,
  /\b(solve|work out|figure out|compute|calculate|evaluate|simplify|factor|differentiate|integrate|graph|prove|derive)\s+(this|that|the|these|it|for\s+me|my|question|problem)\b/i,
  /\b(show|give|tell)\s+(me\s+)?(the\s+)?(full\s+)?(answer|answers|solution|solutions|work|steps|process|working)\b/i,
  /\b(what(?:'s| is|s)?|whats)\s+the\s+answer(?:s)?\s+(to|for)\b/i,
  /\b(answer|answers|solution|solutions)\s+(to|for)\s+(number|question|problem|q\.?|this|that|#)\s*\d*/i,
  /\bgive\s+me\s+(the\s+)?answers?\b/i,
  /\b(quiz|test|exam|midterm|final)\s+(answers?|key|questions?)\b/i,
  /\bcheat(ing)?\s+(on|for|with|in)\b/i,
  /\bhelp\s+(me\s+)?(with|on)\s+(my|this|that|the)\s+(homework|hw|assignment|essay|paper|worksheet|packet|lab|test|quiz|exam|problem|question|equation|proof|project|report|discussion|journal)\b/i,
  /\b(translate|rewrite|paraphrase|summarize|analyze)\s+(this|my|the)\s+(passage|poem|essay|paragraph|chapter|story|article|text|book)\b/i,
  /\bwrite\s+(me\s+)?(a|an|the)\s+(essay|paper|paragraph|report|thesis|conclusion|introduction|poem|story|lab|discussion|response|reflection|letter\s+for\s+class)\b/i,
  /\b(find|look ?up)\s+(the\s+)?answers?\s+(to|for)\s+(my|this|the|number|question|problem)\b/i,
  /\bread\s+(this|my|the)\s+(passage|chapter|article)\s+and\b/i,
]

/** Patterns that look like someone pasted a math/science problem in for us to solve. */
const PROBLEM_SHAPE_PATTERNS = [
  /^\s*(solve|simplify|factor|evaluate|differentiate|integrate|graph|prove|find\s+x|find\s+y|find\s+the\s+value|compute)\b/i,
  /^[\s\d+\-*/=^().x yXY]+$/,
  /[=≠≤≥]/,
  /\b\d+\s*[+\-*/^]\s*\d+/,
]

/**
 * Detects requests aimed at getting graded work done for the user.
 * Broad on purpose — we'd rather over-refuse than help a student cheat.
 * Still lets pure logistics questions through (e.g. “where do I turn in homework?”, “when is it due?”).
 * @param {string} text
 */
export function isHomeworkHelpRequest(text) {
  const raw = String(text || '').trim()
  if (raw.length < 2) return false
  const t = raw.toLowerCase()

  if (DIRECT_CHEAT_PATTERNS.some((re) => re.test(t))) return true

  const hasAcademicWord = ACADEMIC_WORK_KEYWORDS.some((kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}\\b`, 'i')
    return re.test(t)
  })

  if (hasAcademicWord) {
    const isPureLogistics = LOGISTICS_PATTERNS.some((re) => re.test(t))
    if (!isPureLogistics) return true
  }

  if (PROBLEM_SHAPE_PATTERNS.some((re) => re.test(raw))) return true

  return false
}

/** User is asking for time-sensitive sports info; prioritize search over embedded knowledge. */
function wantsLiveSportsAnswer(text) {
  const t = text.toLowerCase()
  if (t.length < 4) return false
  const sport =
    /\b(basketball|football|baseball|softball|soccer|volleyball|lacrosse|hockey|swimming|wrestling|track|tennis|golf|field hockey|cheer|cheerleading|cross country|bocce|natatorium)\b/i.test(
      t,
    )
  const timeSensitive =
    /\b(game|games|match|matches|schedule|schedules|score|scores|record|records|standing|standings|win|wins|loss|losses|season|playoff|playoffs|tournament|left|remaining|upcoming|tonight|today|tomorrow|this week|next week)\b/i.test(
      t,
    )
  return sport && timeSensitive
}

/** Likely needs current web facts; prepend a light hint so dynamic retrieval is more likely to search. */
function likelyNeedsWebSearch(text) {
  const t = text.toLowerCase()
  if (t.length < 4) return false
  return (
    /\b(latest|current|today|right now|this week|this month|upcoming|soon|recent|news|happening|schedule|deadline|when is|what time|what date|score|scores|standing|standings|playoff|tournament|weather|open|closed|cancelled|canceled|postponed|game|games|match|season|left|remaining)\b/i.test(
      t,
    ) ||
    /\b(website|online|link|search|google|internet|look up|find out)\b/i.test(t)
  )
}

function augmentUserMessageForSearch(userText) {
  if (!likelyNeedsWebSearch(userText)) return userText
  return `The user’s question may depend on **current or web-verifiable** information. Use **Google Search grounding** if available; treat supplemental instructions as background, not a substitute for live facts.\n\n---\n\n${userText}`
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
    systemInstruction += `\n\n## Latest scraped school data (updated daily)\n**Supplementary context** scraped from official school/district pages. Use it when relevant, but **use Google Search** when the user needs fresher or fuller public information (e.g. athletics calendars, breaking news) or when this scrape looks incomplete or outdated.\n\n${relevantInfo}`
  }
  if (wantsLiveSportsAnswer(userText)) {
    systemInstruction += `\n\n## Priority for this message\nThe user asked about sports games, schedules, or scores. **Use Google Search grounding** to answer with current information. Do not rely on older announcement snippets alone for a full schedule — confirm against search when possible. If scraped lines conflict with search, prefer search for dates and scores.`
  }

  const genAI = new GoogleGenerativeAI(String(apiKey).trim())
  const tools = googleSearchTools()

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
    ...(tools ? { tools } : {}),
  })

  const contentPayload = augmentUserMessageForSearch(userText)

  let result
  try {
    result = await model.generateContent(contentPayload)
  } catch (err) {
    if (
      tools &&
      (err?.message?.includes('tool') ||
        err?.message?.includes('GoogleSearch') ||
        err?.status === 400)
    ) {
      const fallback = genAI.getGenerativeModel({ model: modelName, systemInstruction })
      result = await fallback.generateContent(contentPayload)
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
