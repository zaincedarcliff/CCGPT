// Gemini calls (server-side only). The API key never leaves the server.

import { GoogleGenAI } from '@google/genai'
import { coreInstruction, dateHeader, formatMemoryForPrompt, MEMORY_EXTRACTION_INSTRUCTION } from './prompt.js'
import { classifySource, publisherLabel, displayDomain } from './sources.js'

export const MODEL = (process.env.GEMINI_MODEL || process.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash').trim()

function apiKey() {
  return (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim()
}
export function llmConfigured() {
  return Boolean(apiKey())
}

let client
function ai() {
  if (!client) client = new GoogleGenAI({ apiKey: apiKey() })
  return client
}

const usesThinking = /gemini-2\.5|gemini-3/i.test(MODEL)

/** Gemini's built-in Google Search grounding — used only as a fallback when no search API key is configured. */
export function groundingFallbackEnabled() {
  const v = String(process.env.GEMINI_GOOGLE_SEARCH_FALLBACK ?? process.env.VITE_GEMINI_GOOGLE_SEARCH ?? 'true').toLowerCase()
  return !(v === '0' || v === 'false')
}

let cachedCore = null
function systemPrompt({ memoryFacts, contextText, useGrounding }) {
  if (!cachedCore) cachedCore = coreInstruction()
  const parts = [dateHeader(), cachedCore]
  const mem = formatMemoryForPrompt(memoryFacts || [])
  if (mem) parts.push(mem)
  if (contextText) parts.push(contextText)
  if (useGrounding) {
    parts.push(
      `## Google Search for this message\nThe app's own web search is not configured, so the \`googleSearch\` tool is attached. This is a factual Cedar Cliff / West Shore question: CALL the tool, using "Cedar Cliff High School Camp Hill PA" or "West Shore School District" plus the topic (try "wssd.k12.pa.us" + topic if the first search misses). Prefer wssd.k12.pa.us results. Answer from what you find; do not print URLs — the app shows the pages you used.`,
    )
  } else {
    parts.push(`## Tools\nNo tools are attached to this message. Do not attempt to call any tool; answer from the information above.`)
  }
  return parts.join('\n\n')
}

/**
 * @param {{ question: string, history?: {role:'user'|'assistant', text:string}[], memoryFacts?: string[], contextText?: string, useGrounding?: boolean }} args
 * @returns {Promise<{ text: string, groundingSources: object[], finishReason?: string }>}
 */
export async function generateAnswer({ question, history = [], memoryFacts = [], contextText = '', useGrounding = false }) {
  if (!llmConfigured()) throw new Error('GEMINI_API_KEY is not set on the server')
  // A short reminder on the user turn itself measurably improves [n] citation compliance.
  let reminder = contextText && /### \[\d+\]/.test(contextText)
    ? '\n\n(Answer from the numbered Retrieved information when it covers this; put [n] after each fact you take from source n. Do not print URLs.)'
    : ''
  if (useGrounding) {
    reminder += `\n\n[Tool-use instruction — do not quote back to the user] Use the googleSearch tool NOW before answering. Search "Cedar Cliff High School" + the topic, and "site:wssd.k12.pa.us" + the topic. Answer from what the search returns; never say you don't have access to the information without searching first.`
  }
  const contents = [
    ...history.slice(-10).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.text || '').slice(0, 4000) }] })),
    { role: 'user', parts: [{ text: String(question) + reminder }] },
  ]
  const call = (grounded) =>
    ai().models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt({ memoryFacts, contextText, useGrounding: grounded }),
        maxOutputTokens: 4096,
        temperature: 0.3,
        ...(usesThinking ? { thinkingConfig: { thinkingBudget: 512 } } : {}),
        ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
      },
    })

  let response
  let grounded = useGrounding
  try {
    response = await withModelRetry(() => call(grounded))
  } catch (err) {
    if (!grounded || isQuotaOrAuthError(err)) throw err
    console.warn('[llm] grounded call failed, retrying without tools:', err?.message || err)
    grounded = false
    response = await withModelRetry(() => call(false))
  }
  let text = extractResponseText(response)
  if (!text && grounded) {
    const retry = await call(false)
    const t = extractResponseText(retry)
    if (t) {
      response = retry
      text = t
      grounded = false
    }
  }
  const finishReason = response?.candidates?.[0]?.finishReason
  if (!text) return { text: messageForEmptyModelReply(finishReason, response?.promptFeedback?.blockReason), groundingSources: [], finishReason }
  return { text: cleanAnswer(text), groundingSources: grounded ? groundingSourcesFrom(response) : [], finishReason }
}

/** Pull cited pages out of Gemini grounding metadata (fallback mode only). */
function groundingSourcesFrom(response) {
  const meta = response?.candidates?.[0]?.groundingMetadata
  const chunks = Array.isArray(meta?.groundingChunks) ? meta.groundingChunks : []
  const out = []
  const seen = new Set()
  for (const c of chunks) {
    const uri = c?.web?.uri
    if (!uri || seen.has(uri)) continue
    seen.add(uri)
    // Grounding URIs are Google redirect links; the title is usually the real domain.
    const title = c.web.title || uri
    const tierGuess = classifySource(`https://${title}`) || 4
    out.push({ url: uri, title, publisher: publisherLabel(`https://${title}`) || title, domain: displayDomain(`https://${title}`) || title, tier: tierGuess, origin: 'grounding' })
  }
  return out
}

/**
 * Extract durable facts about the user from one exchange. Never throws.
 * @returns {Promise<{ add: string[], remove: string[] }>}
 */
export async function extractMemoryFacts(userText, assistantText, existingFacts = []) {
  const empty = { add: [], remove: [] }
  if (!llmConfigured()) return empty
  const user = String(userText || '').trim()
  if (!user) return empty
  const existing = existingFacts.length ? existingFacts.map((f, i) => `${i + 1}. ${f}`).join('\n') : '(none yet)'
  const prompt = [
    `## Existing facts\n${existing}`,
    `## Latest user message\n${user.slice(0, 2000)}`,
    `## Assistant reply (context only — do not extract facts from it)\n${String(assistantText || '').slice(0, 1200)}`,
  ].join('\n\n')
  try {
    const response = await ai().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: MEMORY_EXTRACTION_INSTRUCTION(),
        responseMimeType: 'application/json',
        maxOutputTokens: 512,
        temperature: 0.1,
        ...(usesThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    })
    const raw = extractResponseText(response)
    if (!raw) return empty
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim())
    const clean = (arr) => (Array.isArray(arr) ? arr.map((s) => String(s || '').trim()).filter((s) => s && s.length <= 160).slice(0, 8) : [])
    return { add: clean(parsed?.add), remove: clean(parsed?.remove) }
  } catch (err) {
    console.warn('[memory] fact extraction failed:', err?.message || err)
    return empty
  }
}

// ---------------------------------------------------------------- helpers

function extractResponseText(response) {
  if (!response) return ''
  try {
    const direct = typeof response.text === 'string' ? response.text : ''
    if (direct.trim()) return direct.trim()
  } catch {
    /* getter can throw when there are no text parts */
  }
  for (const cand of Array.isArray(response.candidates) ? response.candidates : []) {
    const parts = cand?.content?.parts
    if (!Array.isArray(parts)) continue
    const joined = parts
      .map((p) => (p?.thought ? '' : typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim()
    if (joined) return joined
  }
  return ''
}

/** Remove model-printed source lists / raw URL trailers (the app renders sources itself) but keep [n] markers. */
export function cleanAnswer(text) {
  let out = String(text || '').trim()
  out = out.replace(/\n+\s*(?:\*{0,2}|#{1,6}\s*)(?:sources?|references?|citations?)\s*:?\*{0,2}\s*\n(?:[^\n]*https?:\/\/[^\n]*\n?)+\s*$/i, '')
  out = out.replace(/(?:\n[ \t]*[-*•]?\s*\[?\d*\]?\s*https?:\/\/\S+[^\n]*)+\s*$/g, '')
  out = out.replace(
    /\s*[[({]\s*(?:relevant\s+)?(?:url|urls|source|sources|link|links|citation|citations|reference|references)\b[^\])}]*?(?:omitted|hidden|removed|not\s+shown|per\s+instruction|as\s+instructed)[^\])}]*[\])}]\s*/gi,
    ' ',
  )
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

function isTransientModelError(err) {
  const raw = String(err?.message ?? err ?? '')
  const status = err?.status ?? err?.code
  if (isQuotaOrAuthError(err)) return false
  return status === 503 || status === 500 || /UNAVAILABLE|high demand|INTERNAL|ECONNRESET|ETIMEDOUT|fetch failed/i.test(raw)
}

async function withModelRetry(fn) {
  let last
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (!isTransientModelError(err) || attempt === 3) throw err
      const wait = Math.min(12000, 800 * 2 ** attempt)
      console.warn(`[llm] ${String(err?.message || err).slice(0, 140)} — retrying in ${wait}ms`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw last
}

function isQuotaOrAuthError(err) {
  const raw = String(err?.message ?? err ?? '')
  const status = err?.status ?? err?.code
  return status === 429 || status === 403 || /RESOURCE_EXHAUSTED|PERMISSION_DENIED|"code":\s*(429|403)\b/.test(raw)
}

function messageForEmptyModelReply(reason, promptBlock) {
  if (reason === 'SAFETY' || promptBlock === 'SAFETY') {
    return "I can't answer that one — it was blocked by a safety filter. Try rephrasing, or ask me something about Cedar Cliff (sports, clubs, counselors, schedule, etc.)."
  }
  if (reason === 'MAX_TOKENS') return 'That answer got cut off before it finished. Try asking a narrower question.'
  return "I didn't get a usable answer that time. Please try again in a moment, or rephrase your question."
}

/** Turn SDK/API errors into a short, user-facing chat message. */
export function friendlyErrorMessage(err) {
  const raw = String(err?.message ?? err ?? '')
  if (/not set on the server|not configured/i.test(raw)) return 'The AI service is not configured. Add GEMINI_API_KEY in Vercel (server-side) and redeploy.'
  let code
  let apiMessage = ''
  try {
    const j = JSON.parse(raw)
    code = j?.error?.code
    apiMessage = String(j?.error?.message ?? '')
  } catch {
    /* not JSON */
  }
  const is429 = code === 429 || raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')
  if (is429) {
    if (/prepayment credits|prepaid credits/i.test(`${apiMessage} ${raw}`)) return '**AI billing:** the prepaid credits for this API key’s project are used up. Add credits or link Cloud billing in Google AI Studio.'
    if (/PerDay|free_tier_requests/i.test(raw)) return '**AI daily limit reached.** This API key is on the Gemini free tier and has used today’s quota. It resets at midnight Pacific time.'
    return 'The AI service hit a quota or rate limit. Wait a minute and try again.'
  }
  if (code === 403 || raw.includes('PERMISSION_DENIED')) return 'The API key was rejected. Check that it is valid and that the Generative Language API is enabled for its project.'
  if (code === 503 || raw.includes('UNAVAILABLE') || /high demand/i.test(raw)) return 'The AI service is busy right now. Please try again in a moment.'
  return "Sorry, I couldn't reach the AI service. Please try again in a moment."
}
