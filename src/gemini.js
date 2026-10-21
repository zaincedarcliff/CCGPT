// Browser-side client for the CCGPT backend (/api/chat).
//
// The Gemini key, web-search key, and knowledge base all live on the server now — nothing
// secret ships in this bundle. This module keeps the same export names App.jsx always used.

import { auth } from './firebase.js'
import { isHomeworkHelpRequest, HOMEWORK_REFUSAL_MESSAGE } from '../lib/homework.js'

export { isHomeworkHelpRequest, HOMEWORK_REFUSAL_MESSAGE }

/** The AI runs server-side; only an explicit kill switch turns it off in the UI. */
export function isGeminiConfigured() {
  return import.meta.env.VITE_DISABLE_AI !== '1'
}

/**
 * Public backend status (no secrets): which services are configured + knowledge-base size.
 * Used for the status pill. Never throws.
 */
export async function fetchAiStatus() {
  try {
    const res = await fetch('/api/kb-status', { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function idToken() {
  try {
    return (await auth.currentUser?.getIdToken()) || null
  } catch {
    return null
  }
}

/**
 * @typedef {Object} ChatSource
 * @property {number} n
 * @property {string} url
 * @property {string} title
 * @property {string} publisher
 * @property {string} domain
 * @property {number} tier
 * @property {string} tierLabel
 * @property {boolean} cited
 * @property {string|null} [lastChecked]
 * @property {string|null} [lastChanged]
 * @property {string|null} [docYear]
 */

/**
 * Ask CCGPT. Resolves to `{ text, sources, memoryUpdate, meta }`.
 * @param {string} userText
 * @param {{ history?: {role:string,text:string}[], memoryFacts?: string[] }} [options]
 */
export async function askGemini(userText, options = {}) {
  if (isHomeworkHelpRequest(userText)) {
    return { text: HOMEWORK_REFUSAL_MESSAGE, sources: [], memoryUpdate: null, meta: { refused: true } }
  }
  const token = await idToken()
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message: String(userText),
      history: (options.history || []).slice(-10).map((m) => ({ role: m.role, text: m.text })),
      memoryFacts: options.memoryFacts || [],
    }),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.text || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return {
    text: String(data?.text || ''),
    sources: Array.isArray(data?.sources) ? data.sources : [],
    memoryUpdate: data?.memoryUpdate || null,
    meta: data?.meta || {},
  }
}

/** Turn transport/API errors into a short chat message. */
export function formatGeminiClientError(err) {
  const status = err?.status
  const raw = String(err?.message ?? err ?? '')
  if (status === 401) return 'Please sign in again to keep chatting.'
  if (status === 429) return raw || 'You’re sending messages too quickly. Wait a moment and try again.'
  if (status === 503) {
    if (/not configured/i.test(raw)) return raw
    if (/busy|high demand|unavailable/i.test(raw)) return 'The AI service is busy right now. Please try again in a moment.'
    return raw || 'The AI service is not configured on the server yet.'
  }
  if (/Failed to fetch|NetworkError|network/i.test(raw)) return "I couldn't reach the CCGPT server. Check your connection and try again."
  return raw || "Sorry, I couldn't reach the AI service. Please try again in a moment."
}
