// End-to-end answer pipeline: homework gate → retrieval (KB → web) → LLM → citation post-processing
// → (optional) memory extraction. Used by /api/chat and the CLI (`node scripts/ask.js`).

import { isHomeworkHelpRequest, HOMEWORK_REFUSAL_MESSAGE } from './homework.js'
import { retrieveForQuestion, citedSourceNumbers, looksUnverified } from './retrieval.js'
import { webSearchAvailable } from './webSearch.js'
import { generateAnswer, extractMemoryFacts, groundingFallbackEnabled } from './llm.js'
import { TIER_LABELS } from './sources.js'

const PERSONAL_HINT_RE =
  /\b(i am|i'm|im|i was|i will|i'll|i play|i run|i swim|i wrestle|i like|i love|i hate|i prefer|i want|i need|i have|i've|i take|i'm taking|i joined|i'm in|i am in|my name|call me|remember|don't forget|my counselor|my teacher|my grade|my class|my classes|my schedule|my sport|my team|my club|senior|junior|sophomore|freshman|class of)\b/i

/**
 * @param {{
 *   question: string,
 *   history?: {role:string,text:string}[],
 *   memoryFacts?: string[],
 *   allowWeb?: boolean | (() => Promise<boolean>|boolean),
 *   extractMemory?: boolean,
 *   log?: Function,
 * }} args
 */
export async function answerQuestion({ question, history = [], memoryFacts = [], allowWeb = true, extractMemory = false, log = () => {} }) {
  const q = String(question || '').trim()
  const started = Date.now()

  if (isHomeworkHelpRequest(q)) {
    return { text: HOMEWORK_REFUSAL_MESSAGE, sources: [], meta: { refused: 'academic-integrity', ms: Date.now() - started } }
  }

  // 1. Retrieve (KB first; web when needed).
  let retrieval = await retrieveForQuestion(q, { allowWeb, log })
  let useGrounding = Boolean(
    retrieval.decision.wantWeb &&
      retrieval.decision.webUnavailable &&
      !retrieval.decision.webRateLimited &&
      !retrieval.decision.liveAnnouncements &&
      groundingFallbackEnabled(),
  )

  // 2. Generate.
  let gen = await generateAnswer({ question: q, history, memoryFacts, contextText: retrieval.contextText, useGrounding })

  // 3. Safety net: if we answered from the KB only and the model still says it couldn't verify,
  //    run the web search now and answer again. This is what turns "I don't have the grading
  //    scale" into an actual answer with a link.
  let retried = false
  if (retrieval.decision.schoolRelated && !retrieval.decision.searchedWeb && webSearchAvailable() && looksUnverified(gen.text)) {
    const gate = typeof allowWeb === 'function' ? await allowWeb() : allowWeb !== false
    if (gate) {
      log('[answer] first answer looked unverified → retrying with web search')
      retrieval = await retrieveForQuestion(q, { forceWeb: true, allowWeb: true, log })
      gen = await generateAnswer({ question: q, history, memoryFacts, contextText: retrieval.contextText, useGrounding: false })
      retried = true
    }
  }

  // 4. Citations: keep the sources the model actually cited (in order of first appearance);
  //    strip markers that don't map to a real source.
  const { text, sources } = finalizeCitations(gen.text, retrieval.sources, gen.groundingSources, {
    schoolRelated: retrieval.decision.schoolRelated,
    searchedWeb: retrieval.decision.searchedWeb,
  })

  // 5. Long-term memory (only when the message plausibly says something personal).
  let memoryUpdate = null
  if (extractMemory && q.length >= 6 && PERSONAL_HINT_RE.test(q)) {
    memoryUpdate = await extractMemoryFacts(q, text, memoryFacts)
    if (!memoryUpdate.add.length && !memoryUpdate.remove.length) memoryUpdate = null
  }

  return {
    text,
    sources,
    memoryUpdate,
    meta: {
      ms: Date.now() - started,
      decision: retrieval.decision,
      kbConfidence: Number(retrieval.kbConfidence?.toFixed?.(3) ?? 0),
      kbStats: retrieval.kbStats,
      web: retrieval.web,
      usedGrounding: useGrounding && gen.groundingSources.length > 0,
      retriedWithWeb: retried,
      retrievedSourceCount: retrieval.sources.length,
    },
  }
}

/**
 * @returns {{ text: string, sources: { n:number, url:string, title:string, publisher:string, domain:string, tier:number, tierLabel:string, origin:string, cited:boolean, lastChecked?:string|null, lastChanged?:string|null, docYear?:string|null }[] }}
 */
export function finalizeCitations(answerText, retrievedSources, groundingSources = [], { schoolRelated, searchedWeb } = {}) {
  let text = String(answerText || '')
  const byN = new Map(retrievedSources.map((s) => [s.n, s]))
  const cited = citedSourceNumbers(text)

  // Drop markers that point at nothing.
  text = text.replace(/\s?\[(\d{1,2})\]/g, (m, n) => (byN.has(Number(n)) ? m : ''))

  // Order sources by first appearance in the text; renumber sequentially so the UI shows 1,2,3…
  const order = []
  const re = /\[(\d{1,2})\]/g
  let m
  while ((m = re.exec(text))) {
    const n = Number(m[1])
    if (byN.has(n) && !order.includes(n)) order.push(n)
  }
  const renumber = new Map(order.map((n, i) => [n, i + 1]))
  text = text.replace(/\[(\d{1,2})\]/g, (all, n) => (renumber.has(Number(n)) ? `[${renumber.get(Number(n))}]` : all))

  const sources = order.map((n) => toClientSource(byN.get(n), renumber.get(n), true))

  // If a school answer used web results but the model forgot to cite, still surface the top
  // official sources it was given (labelled as consulted, not cited).
  if (!sources.length && schoolRelated && (searchedWeb || retrievedSources.length) && !cited.size && !looksUnverified(text)) {
    const maxBest = Math.max(0, ...retrievedSources.map((s) => s.best || 0))
    const top = retrievedSources.filter((s) => s.tier <= 2 && (s.best || 0) >= maxBest * 0.6).slice(0, 2)
    top.forEach((s, i) => sources.push(toClientSource(s, i + 1, false)))
  }
  // Gemini grounding fallback sources (no numbering in text; listed as consulted).
  for (const g of groundingSources.slice(0, 4)) {
    if (sources.some((s) => s.url === g.url)) continue
    sources.push({ ...g, n: sources.length + 1, tierLabel: TIER_LABELS[g.tier] || 'Other', cited: false })
  }
  return { text: text.replace(/[ \t]+\n/g, '\n').trim(), sources }
}

function toClientSource(s, n, cited) {
  return {
    n,
    url: s.url,
    title: s.title || s.url,
    publisher: s.publisher || s.domain,
    domain: s.domain,
    tier: s.tier,
    tierLabel: TIER_LABELS[s.tier] || 'Other',
    origin: s.origin,
    cited,
    lastChecked: s.lastChecked || null,
    lastChanged: s.lastChanged || null,
    publishedAt: s.publishedAt || null,
    docYear: s.docYear || null,
  }
}
