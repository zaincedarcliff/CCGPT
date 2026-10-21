// Academic-integrity gate (shared by the browser and the server).
// Detects requests aimed at getting graded work done for the user. Broad on purpose — we'd rather
// over-refuse than help a student cheat — but lets pure logistics questions through.

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
  /\b(keystone|psat|sat|act|ap)\s+(exam|test|tests|exams|date|dates|schedule|registration|fee|fees|score|scores)\b/i,
  /\b(exam|test|midterm|final)s?\s+(schedule|week|dates?|calendar|exemption|policy)\b/i,
  /\b(when|what day|what time)\b.*\b(exam|exams|test|tests|midterm|midterms|final|finals|keystone|keystones)\b/i,
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
