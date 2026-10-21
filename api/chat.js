// POST /api/chat — the only way the browser talks to the AI.
// Body:    { message: string, history?: {role,text}[], memoryFacts?: string[] }
// Headers: Authorization: Bearer <Firebase ID token>
// Reply:   { text, sources: [...], memoryUpdate: {add,remove}|null, meta }
//
// All secrets (Gemini, web search, blob) stay on the server. Requests are authenticated with the
// user's Firebase ID token and rate limited per user (chat + web search) and per IP.

import { verifyFirebaseToken, anonymousAllowed } from '../lib/auth.js'
import { checkLimit, checkIpLimit, clientIp } from '../lib/rateLimit.js'
import { answerQuestion } from '../lib/answer.js'
import { friendlyErrorMessage, llmConfigured } from '../lib/llm.js'

export const config = { maxDuration: 60 }

const MAX_MESSAGE_CHARS = 4000
const MAX_HISTORY = 10

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!llmConfigured()) {
    return res.status(503).json({ error: 'AI not configured', text: friendlyErrorMessage(new Error('not configured')) })
  }

  const ip = clientIp(req)
  if (!(await checkIpLimit(ip))) {
    res.setHeader('Retry-After', '60')
    return res.status(429).json({ error: 'Too many requests from this network. Please wait a minute.' })
  }

  // --- auth
  let user = null
  try {
    user = await verifyFirebaseToken(req.headers.authorization)
  } catch (err) {
    console.error('[chat] auth misconfigured:', err?.message || err)
    return res.status(500).json({ error: 'Server auth misconfigured (set FIREBASE_PROJECT_ID).' })
  }
  if (!user) {
    if (!anonymousAllowed()) return res.status(401).json({ error: 'Please sign in to use CCGPT.' })
    user = { uid: `anon:${ip}` }
  }

  // --- body
  const body = await readJsonBody(req)
  const message = String(body?.message || '').trim()
  if (!message) return res.status(400).json({ error: 'message is required' })
  if (message.length > MAX_MESSAGE_CHARS) return res.status(413).json({ error: `Message too long (max ${MAX_MESSAGE_CHARS} characters).` })
  const history = Array.isArray(body?.history)
    ? body.history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }))
    : []
  const memoryFacts = Array.isArray(body?.memoryFacts) ? body.memoryFacts.map((f) => String(f).slice(0, 200)).slice(0, 40) : []

  // --- rate limits
  const chat = await checkLimit('chat', user.uid)
  if (!chat.ok) {
    res.setHeader('Retry-After', String(chat.retryAfterSec || 60))
    return res.status(429).json({ error: `You’re sending messages too quickly (${chat.reason}). Try again in a bit.` })
  }
  const allowWeb = async () => (await checkLimit('web', user.uid)).ok

  try {
    const result = await answerQuestion({
      question: message,
      history,
      memoryFacts,
      allowWeb,
      extractMemory: !String(user.uid).startsWith('anon:'),
      log: (...a) => console.log(...a),
    })
    const debug = process.env.CHAT_DEBUG === '1' || req.headers['x-ccgpt-debug'] === '1'
    return res.status(200).json({
      text: result.text,
      sources: result.sources,
      memoryUpdate: result.memoryUpdate,
      meta: debug ? result.meta : { ms: result.meta.ms, searchedWeb: Boolean(result.meta.decision?.searchedWeb), usedKb: Boolean(result.meta.decision?.searchedKb) },
    })
  } catch (err) {
    console.error('[chat] failed:', err)
    return res.status(200).json({ text: friendlyErrorMessage(err), sources: [], memoryUpdate: null, meta: { error: true } })
  }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 200_000) {
        resolve(null)
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null)
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}
