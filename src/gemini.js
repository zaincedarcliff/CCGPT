import { GoogleGenAI } from '@google/genai'
import { studentKnowledge } from './studentKnowledge.js'
import {
  loadSchoolData,
  getRelevantEntries,
  getFallbackCurriculumEntries,
  formatEntriesForPrompt,
  extractCourses,
  groupCoursesByDept,
  isCourseListQuestion,
} from './schoolData.js'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY
const modelName =
  import.meta.env.VITE_GEMINI_MODEL?.trim() || 'gemini-2.5-flash'

/** Set VITE_GEMINI_GOOGLE_SEARCH=false to disable grounding (saves billing). Default: on. */
function isGoogleSearchGroundingEnabled() {
  const v = import.meta.env.VITE_GEMINI_GOOGLE_SEARCH
  if (v === '0' || v === 'false') return false
  return true
}

/**
 * Google Search grounding for Gemini 2.x uses the `googleSearch` tool (no dynamic retrieval knob).
 * When enabled, the model decides per-turn whether to actually browse — we strongly steer it to
 * search for any Cedar Cliff / current-info question via the system instruction and query augmentation.
 */
function googleSearchTools() {
  if (!isGoogleSearchGroundingEnabled()) return undefined
  return [{ googleSearch: {} }]
}

const CORE_INSTRUCTION = `You are CCGPT, the official AI assistant for Cedar Cliff High School (West Shore School District, Camp Hill, Pennsylvania).

## How to behave (ChatGPT-style)
- Act like a helpful, conversational AI assistant — similar to ChatGPT.
- Be friendly, natural, and direct. Write like a knowledgeable person talking, not a template.
- Keep continuity: remember what the user has already said in this conversation, reference earlier messages when relevant, and don't re-introduce yourself every turn.
- Use general knowledge freely to answer any question that isn't graded schoolwork (see academic integrity below). You're not just a school-info bot — you can have normal conversations, explain concepts (not tied to an assignment), help brainstorm non-academic ideas, chat about sports, talk about Cedar Cliff life, etc.
- Prefer short, clear answers. Expand when the user wants detail.
- Only use emojis if the user uses them first or the topic genuinely calls for one; don't sprinkle emojis everywhere.
- If you don't know something, say so plainly — don't make up facts.

## Information sources (priority order)
You have **three** kinds of context. **Do not** behave as if only the long "supplemental" block at the end is your knowledge base.

1. **Google Search grounding (the web) — YOU HAVE INTERNET ACCESS via the \`googleSearch\` tool.** For **any** factual question about Cedar Cliff High School, West Shore School District, staff, teachers, principal, counselors, events, athletics, bell schedule, clubs, dates, deadlines, policies, addresses, contacts, or anything that might have changed — **CALL THE SEARCH TOOL FIRST**, then answer from what you find. Rewrite the user's question into a strong search query that includes "Cedar Cliff High School Camp Hill PA" (or "West Shore School District"), the specific topic, and the current year when relevant. **Never** say "I can't browse the internet" — you can. **Never** refuse a Cedar Cliff question because the scrape doesn't cover it — **search for it** and cite the URL. Prefer search results over any other context when they conflict.

2. **Scraped school data** — When provided in this prompt (see "Latest scraped school data"), it is pulled from official district/school pages and MaxPreps team feeds. Treat it as **real, current school content** — use it to answer questions directly (including sports scores, recaps, previews, and recent announcements), not just as background. If it has concrete game results, give them. When the scrape looks incomplete, outdated, or off-topic, **use Google Search** to fill the gap.

3. **Supplemental student knowledge** — The large block at the end of this prompt is **additional reference only** (course catalog, stable policies, counselor structure, etc.). It is **not** a substitute for the web for schedules, scores, news, or "what's true today." Use it when helpful; **never** treat it as the only or definitive source for time-sensitive facts.

## Your role
- Help students, parents, families, and staff with anything they ask — school-related or not — as long as it isn't graded schoolwork.
- When **Google Search grounding** is available, use it for recent or missing facts (scores, dates, news, "what happened today", etc.).
- Always try to give the most up-to-date information possible. If you're unsure even after search, say so and point to the official site: https://www.wssd.k12.pa.us/cedarcliff.aspx

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

## Academic policies & scheduling pages (scraped; use when the user asks about these)
- Course Sequencing & Credit Recommendations
- Credit Requirements & Grade Level Promotion
- Academic Contracts
- Advanced Placement Courses
- Early Admissions / Early Graduation
- Make-Up of Failures / Summer school
- Requesting a Schedule Change
- Senior Option
- Studying Abroad / Exchange
- Teen Parenting Day Care Program
- Weighted Grades

## Course offerings & descriptions (scraped by department — use when the user asks about classes, electives, pathways, prerequisites, or dual enrollment)
- Art
- Business and Marketing
- Computer Science
- Engineering and Technology
- English
- English Language Development (ELD)
- Health and Physical Education
- JROTC (Junior Reserve Officers' Training Corps)
- Library
- Mathematics
- Music
- Science
- Social Studies
- Special Education
- World Languages (Spanish, French)
- Cooperative Diversified Occupations (Co-Op)
- Dual Enrollment (HACC, Penn College, Central Penn, HU)
- Pathway Internships (including ACE)

When a user asks about credit requirements, graduation, AP/dual-enrollment options, weighted grades, schedule changes, senior option, studying abroad, specific courses, or department course offerings, **use the Scraped school data above** (and Google Search if needed) to answer with concrete names, course numbers, prerequisites, or credits — not a generic "check the website."

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

## Response style (MANDATORY — make every answer easy to understand)
- **Lead with the direct answer in one sentence.** Don't start with "Based on the search results..." or "According to..."  — just answer.
- **Short + plain language.** Write like you're talking to a high-school student, not a press release. Avoid jargon, run-on sentences, or repeating the question back.
- **Use short bullets or a tight list only when the content is genuinely a list** (multiple people, multiple options, multiple dates). Otherwise, write 1–3 short sentences.
- **Don't paste long paragraphs of source text.** Summarize in your own words.
- **Use \`**bold**\` sparingly** — a few key labels max. Don't bold every other word. No markdown tables. Don't wrap things in headings unless the answer really has multiple sections.
- **Emojis**: only if the user used one first, or for a natural match (🏀 for basketball, 🎓 for graduation). Don't sprinkle.
- **Match length to question.** One-line question → one-line answer. Broad question → a few short sentences.
- **Do NOT list sources, citations, URLs, or "Source:" lines in your reply.** Just answer the question — do not print the URLs you searched. (The app hides them on purpose.)
- **Do NOT leave placeholder or meta notes in the reply**, e.g. do NOT write "[Relevant URL was omitted as per instruction.]", "[Source omitted]", "Note: URL hidden", or anything similar. Just omit the URL silently and move on.
- **Never** pad the answer with "I hope this helps!" / "Feel free to ask…" / "As an AI…". Just answer.

## Content guidelines
- Use your general knowledge for anything that isn't graded schoolwork. When search grounding is enabled, use it for current or verifiable web info.
- Be friendly and supportive. "Go Colts!" is welcome when it fits naturally — but don't force it into every reply.
- For **sports** (schedules, scores, recaps, "games left"): first use the **Scraped school data** in this prompt — it includes MaxPreps game results and previews and is the most recent version available at build time. If Google Search is enabled, use it to verify or extend what's in the scrape. Only fall back to "check MaxPreps" if neither source has anything useful.

## Supplemental reference only (not a closed knowledge base)
The following section is **additional Cedar Cliff reference material** (courses, policies, stable facts). It does **not** replace Google Search or the scraped data for current events, athletics results, or anything that changes over time.

${studentKnowledge}`

const BASE_INSTRUCTION = CORE_INSTRUCTION

function getRelevantData(question, allData) {
  let entries = getRelevantEntries(question, allData)
  if (entries.length === 0) {
    entries = getFallbackCurriculumEntries(allData)
  }
  const list = entries.length > 0 ? entries : allData || []
  return formatEntriesForPrompt(list)
}

// --------------- homework / anti-cheat ---------------

/** Shown when the user asks for homework answers, solutions, or assignment completion (offline + Gemini). */
export const HOMEWORK_REFUSAL_MESSAGE = `I can’t help with **homework, assignments, quizzes, tests, labs, essays, or any graded schoolwork** — I’m only set up to help with Cedar Cliff school info and general study habits, not completing coursework for you.

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

/** Casual greetings / chit-chat that don't need search. Anything else gets search pressure. */
function isSmallTalk(text) {
  const t = String(text || '').trim().toLowerCase()
  if (t.length < 2) return true
  if (t.length < 20 && /^(hi|hey|hello|yo|sup|howdy|gm|good (morning|afternoon|evening|night)|thanks|thank you|thx|ty|ok|okay|cool|nice|lol|lmao|bye|goodbye|cya|see ya)\b/.test(t)) {
    return true
  }
  return false
}

/** Looks like a factual question about Cedar Cliff / WSSD — always search. */
function isCedarCliffFactualQuestion(text) {
  const t = String(text || '').toLowerCase()
  if (t.length < 3) return false
  if (isSmallTalk(t)) return false
  if (/\b(cedar cliff|wssd|west shore|camp hill|colts|red land|allen ms|crossroads|new cumberland ms)\b/.test(t)) return true
  // school-topic words strongly imply Cedar Cliff context in this app
  if (/\b(principal|assistant principal|vice principal|counselor|counselors|teacher|teachers|staff|faculty|athletic director|ad\b|nurse|secretary|office|main office|guidance|tardy|attendance|dress code|handbook|powerschool|skyward)\b/.test(t)) return true
  if (/\b(school|high school|middle school|elementary|district|campus)\b/.test(t)) return true
  if (/\b(bell schedule|homeroom|period|lunch|cafeteria|parking|senior|junior|sophomore|freshman|graduation|commencement|prom|homecoming|spirit week|open house|back to school|first day|last day|half day|early dismissal|delayed opening|snow day|closing|closure|calendar)\b/.test(t)) return true
  if (/\b(sport|sports|athletic|athletics|football|basketball|baseball|softball|soccer|volleyball|lacrosse|hockey|swim|wrestling|track|tennis|golf|field hockey|cheer|cheerleading|cross country|bocce|game|games|schedule|scores?|record|standing|standings|playoff|tournament|roster)\b/.test(t)) return true
  if (/\b(club|clubs|activity|activities|nhs|national honor society|key club|jrotc|yearbook|musical|band|chorus|orchestra|robotics|newspaper|drama|student council|stuco|fbla|deca)\b/.test(t)) return true
  if (/\b(course|courses|class|classes|elective|curriculum|ap|advanced placement|honors|dual enroll|hacc|gpa|credit|credits|requirement|requirements)\b/.test(t)) return true
  if (/\b(address|phone|contact|email|website|map|directions|location|where.*located)\b/.test(t)) return true
  if (/\b(who (is|are)|what (is|are|time|day|date)|when (is|are|does|do|will)|where (is|are)|how (do|can|much|many|long)|why|which)\b/.test(t)) return true
  if (/\b(latest|current|today|right now|this week|this month|upcoming|soon|recent|news|happening|deadline|score|scores|standing|standings|playoff|tournament|weather|open|closed|cancelled|canceled|postponed)\b/.test(t)) return true
  return false
}

/**
 * Prepend a grounding directive + a rewritten search query so Gemini's `googleSearch` tool
 * has every reason to fire, with keywords that actually return Cedar Cliff results.
 */
function augmentUserMessageForSearch(userText) {
  const raw = String(userText || '').trim()
  if (!raw) return raw
  if (isSmallTalk(raw)) return raw
  if (!isCedarCliffFactualQuestion(raw)) return raw

  const year = new Date().getFullYear()
  const preface = [
    '[Tool-use instruction — do not quote back to the user]',
    'Use the `googleSearch` tool to answer this. The question is about Cedar Cliff High School (West Shore School District, Camp Hill, PA 17011).',
    `Build your search query around: "Cedar Cliff High School" OR "West Shore School District" + the specific topic the user asked about${/\b(this year|current|latest|upcoming|now|today|recent)\b/i.test(raw) ? ` + ${year}` : ''}.`,
    'If the first search misses, try "wssd.k12.pa.us" + the topic, or "Cedar Cliff Colts" + the topic. Cite the URLs you used.',
    'Do NOT refuse, hedge, or say you can\'t browse — you can. Answer with the fresh facts you find, then briefly point to the official page.',
  ].join('\n')
  return `${preface}\n\n---\nUser question: ${raw}`
}

// --------------- public API ---------------

export function isGeminiConfigured() {
  return Boolean(apiKey && String(apiKey).trim())
}

/**
 * Turn SDK/API errors into a short chat message (avoids dumping raw JSON).
 * @param {unknown} err
 * @returns {string}
 */
export function formatGeminiClientError(err) {
  const raw = String(err?.message ?? err ?? '')
  let code
  let apiMessage = ''
  try {
    const j = JSON.parse(raw)
    code = j?.error?.code
    apiMessage = String(j?.error?.message ?? '')
  } catch {
    /* message may not be JSON */
  }
  const is429 =
    code === 429 || raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')
  // Only treat as prepay-wallet empty when Google says so — not every 429 mentions "billing".
  const isPrepayCreditsDepleted =
    /prepayment credits are depleted|prepaid credits|prepayment credits/i.test(
      `${apiMessage} ${raw}`,
    )
  if (is429) {
    if (isPrepayCreditsDepleted) {
      return [
        '**Gemini billing:** Google says **prepayment credits** for this API key’s project are used up.',
        'A **new API key in the same project** still uses that same balance — it does not reset credits.',
        'Open https://aistudio.google.com/ → **API keys** → note the **project** → **Billing / usage** and add prepay or link Cloud billing. Or create a **new project** with its own funded billing.',
        'If production (e.g. Vercel) still fails locally works: set **VITE_GEMINI_API_KEY** there and redeploy.',
      ].join('\n\n')
    }
    const detail = apiMessage.trim() || raw.slice(0, 500)
    return [
      'The AI service returned a quota / rate limit error (429).',
      detail ? `**From Google:** ${detail}` : 'Wait a minute and try again, or check AI Studio → Usage for this key’s project.',
    ].join('\n\n')
  }
  if (code === 403 || raw.includes('PERMISSION_DENIED')) {
    return 'The API key was rejected (permission). Check that it is valid and that the Generative Language API is enabled for its project.'
  }
  return `Sorry, I couldn't reach the AI service.\n\n${raw}`
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

  if (isCourseListQuestion(userText)) {
    const allCourses = extractCourses(data)
    if (allCourses.length > 0) {
      const grouped = groupCoursesByDept(allCourses)
      const deptSections = Object.entries(grouped)
        .map(([dept, list]) => {
          const lines = list.map((c) => {
            const flags = c.tags.filter((t) =>
              ['AP', 'Honors', 'Dual Enrollment', 'NCAA', 'College', 'HACC', 'Harrisburg University', 'Penn College', 'Semester', 'Full Year'].includes(t),
            )
            return `  - ${c.title}${flags.length ? ` [${flags.join(', ')}]` : ''}`
          })
          return `- **${dept}** (${list.length}):\n${lines.join('\n')}`
        })
        .join('\n')
      systemInstruction += `\n\n## Cedar Cliff course catalog (structured, with tags)\nThe user is asking about courses/classes offered at Cedar Cliff. Below is the authoritative list of courses extracted from the West Shore School District curriculum pages, grouped by department. Each course includes relevant tags in brackets: AP, Honors, Dual Enrollment, NCAA-eligible, College (college-level), HACC / Harrisburg University / Penn College (partner institution), Semester, or Full Year.\n\n### Response rules\n- **Always format as a clean bulleted list** (not prose paragraphs). Group by department when listing many courses.\n- **Filter the list to what the user actually asked for.** If they asked for "dual enrollment classes", return only courses tagged Dual Enrollment. If they asked for "Honors English", return only English courses tagged Honors. Combine filters intelligently.\n- **Be flexible about phrasing.** "AP classes", "advanced placement courses", "AP offerings", "what APs can I take" should all produce the AP list. Likewise "HACC", "college in high school", "college courses", "dual enrollment" are all near-synonyms — use them interchangeably when reasonable.\n- If no courses match the combination, say so and suggest a related filter (e.g. "Cedar Cliff doesn't currently list an Honors Math course. The closest options are: Calculus, AP Calculus AB, AP Calculus BC, AP Statistics…").\n- Keep prerequisites / credit / summer-work mentions brief — point students to the counselor for scheduling.\n\n### Course data\n${deptSections}`
    }
  }
  if (wantsLiveSportsAnswer(userText)) {
    systemInstruction += `\n\n## Priority for this message\nThe user asked about sports games, schedules, or scores. **Use Google Search grounding** to answer with current information. Do not rely on older announcement snippets alone for a full schedule — confirm against search when possible. If scraped lines conflict with search, prefer search for dates and scores.`
  }
  if (isCedarCliffFactualQuestion(userText)) {
    systemInstruction += `\n\n## Priority for this message\nThis is a factual Cedar Cliff / West Shore question. **CALL the \`googleSearch\` tool** before drafting your final answer. Use "Cedar Cliff High School Camp Hill PA" or "West Shore School District" plus the topic. Cite the URLs you used at the bottom.`
  }

  const ai = new GoogleGenAI({ apiKey: String(apiKey).trim() })
  const tools = googleSearchTools()
  const contents = augmentUserMessageForSearch(userText)

  const callModel = (useTools) =>
    ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        systemInstruction,
        ...(useTools && tools ? { tools } : {}),
      },
    })

  let response
  let usedTools = Boolean(tools)
  try {
    response = await callModel(true)
  } catch (err) {
    const msg = String(err?.message || '')
    const looksLikeToolError =
      /tool|googleSearch|google_search|grounding|unsupported/i.test(msg) ||
      err?.status === 400
    if (tools && looksLikeToolError) {
      console.warn('[gemini] googleSearch tool rejected, retrying without it:', msg)
      usedTools = false
      response = await callModel(false)
    } else {
      throw err
    }
  }

  let text = extractResponseText(response)

  // If the grounded call came back empty (safety filter hiccup, grounding returned
  // citations only, MAX_TOKENS with no text yet, etc.) retry once without tools.
  if (!text && usedTools) {
    console.warn(
      '[gemini] empty response with tools enabled — retrying without googleSearch. finishReason=',
      response?.candidates?.[0]?.finishReason,
    )
    try {
      response = await callModel(false)
      usedTools = false
      text = extractResponseText(response)
    } catch (err) {
      console.warn('[gemini] retry without tools failed:', err?.message || err)
    }
  }

  if (!text) {
    const reason = response?.candidates?.[0]?.finishReason
    const promptBlock = response?.promptFeedback?.blockReason
    console.warn('[gemini] empty response. finishReason=', reason, 'promptBlock=', promptBlock, response)
    if (reason === 'SAFETY' || promptBlock === 'SAFETY') {
      return "I can't answer that one — it was blocked by Gemini's safety filter. Try rephrasing, or ask me something about Cedar Cliff (sports, clubs, counselors, schedule, etc.)."
    }
    if (reason === 'RECITATION') {
      return "Gemini didn't return an answer for that (blocked for recitation). Try asking it a different way, or ask me about something else at Cedar Cliff."
    }
    if (reason === 'MAX_TOKENS') {
      return "That answer got cut off before Gemini finished. Try asking a narrower question (e.g. one sport, one counselor, one topic at a time)."
    }
    throw new Error('Empty response from Gemini')
  }

  text = stripSourcesFooter(String(text).trim())
  return text
}

/** Pull text out of a Gemini response. `response.text` is the convenience path,
 *  but if it's missing (tools-only turn, partial parts, etc.) fall back to
 *  walking candidates[].content.parts[].text so we don't throw on valid answers. */
function extractResponseText(response) {
  if (!response) return ''
  const direct = typeof response.text === 'string' ? response.text : ''
  if (direct.trim()) return direct.trim()
  const candidates = Array.isArray(response.candidates) ? response.candidates : []
  for (const cand of candidates) {
    const parts = cand?.content?.parts
    if (!Array.isArray(parts)) continue
    const joined = parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('')
      .trim()
    if (joined) return joined
  }
  return ''
}

/** Remove any "Sources / Source / References / Citations" trailer + trailing bare URLs
 *  the model may print despite the system-prompt rule. We want clean answers only. */
function stripSourcesFooter(text) {
  if (!text) return text
  let out = text
  out = out.replace(
    /\n+\s*(?:\*{0,2}|#{1,6}\s*)(?:sources?|references?|citations?|links?)\b[^\n]*[\s\S]*$/i,
    '',
  )
  out = out.replace(/(?:\n[^\n]*https?:\/\/\S+[^\n]*)+\s*$/g, '')
  out = stripMetaNotes(out)
  return out.trimEnd()
}

/** Strip any bracketed/parenthetical meta-notes the model sometimes leaks, e.g.
 *  "[Relevant URL was omitted as per instruction.]" or "(Source URL omitted.)".
 *  These are never meant for the user. */
function stripMetaNotes(text) {
  if (!text) return text
  const metaRe =
    /\s*[[({]\s*(?:relevant\s+)?(?:url|urls|source|sources|link|links|citation|citations|reference|references)\b[^\])}]*?(?:omitted|hidden|removed|not\s+shown|per\s+instruction|as\s+per\s+instruction|as\s+instructed)[^\])}]*[\])}]\s*/gi
  let out = text.replace(metaRe, ' ')
  out = out.replace(/^[ \t]*(?:note|n\.b\.)\s*:.*$/gim, '')
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trim()
}
