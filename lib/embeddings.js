// Gemini text embeddings + compact int8 storage.
//
// Vectors are L2-normalized then quantized to int8 (with a per-vector scale) and stored as
// base64, which cuts the index size ~4x versus float32 JSON while keeping cosine ranking
// accurate enough for retrieval. If GEMINI_API_KEY is missing or the embedding call fails,
// callers fall back to keyword-only search — embeddings are an accelerator, not a requirement.

import { GoogleGenAI } from '@google/genai'

export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001'
export const EMBEDDING_DIMS = Number(process.env.GEMINI_EMBEDDING_DIMS || 768)
const BATCH_SIZE = 50
const MAX_CHARS_PER_INPUT = 6000

function apiKey() {
  return (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim()
}

export function embeddingsAvailable() {
  return Boolean(apiKey())
}

let client
function ai() {
  if (!client) client = new GoogleGenAI({ apiKey: apiKey() })
  return client
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Embed a batch of texts.
 * @param {string[]} texts
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} taskType
 * @returns {Promise<Float32Array[]>}
 */
export async function embedTexts(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  if (!embeddingsAvailable()) throw new Error('GEMINI_API_KEY not set — embeddings unavailable')
  const out = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => String(t || '').slice(0, MAX_CHARS_PER_INPUT) || ' ')
    let attempt = 0
    // Retry on 429/5xx with exponential backoff — the free tier is strict on tokens/minute.
    for (;;) {
      try {
        const res = await ai().models.embedContent({
          model: EMBEDDING_MODEL,
          contents: batch,
          config: { taskType, outputDimensionality: EMBEDDING_DIMS },
        })
        const vecs = (res.embeddings || []).map((e) => normalize(Float32Array.from(e.values || [])))
        if (vecs.length !== batch.length) throw new Error(`embedding count mismatch (${vecs.length} vs ${batch.length})`)
        out.push(...vecs)
        break
      } catch (err) {
        attempt++
        const msg = String(err?.message || err)
        const hardQuota = /exceeded your current quota|check your plan|PerDay|limit:\s*0/i.test(msg)
        const retryable = /429|RESOURCE_EXHAUSTED|5\d\d|UNAVAILABLE|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)
        if (hardQuota || !retryable || attempt > 5) throw err
        const wait = Math.min(30000, 1500 * 2 ** attempt)
        console.warn(`[embeddings] ${msg.slice(0, 120)} — retrying in ${wait}ms`)
        await sleep(wait)
      }
    }
  }
  return out
}

export async function embedQuery(text) {
  const [v] = await embedTexts([text], 'RETRIEVAL_QUERY')
  return v
}

export function normalize(vec) {
  let sum = 0
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i]
  const n = Math.sqrt(sum) || 1
  const out = new Float32Array(vec.length)
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n
  return out
}

/** @returns {{ q: string, s: number }} base64 int8 payload + scale */
export function quantize(vec) {
  let max = 0
  for (let i = 0; i < vec.length; i++) max = Math.max(max, Math.abs(vec[i]))
  const scale = max || 1
  const q = new Int8Array(vec.length)
  for (let i = 0; i < vec.length; i++) q[i] = Math.round((vec[i] / scale) * 127)
  return { q: Buffer.from(q.buffer).toString('base64'), s: scale }
}

export function dequantize({ q, s }) {
  const buf = Buffer.from(q, 'base64')
  const i8 = new Int8Array(buf.buffer, buf.byteOffset, buf.length)
  const out = new Float32Array(i8.length)
  for (let i = 0; i < i8.length; i++) out[i] = (i8[i] / 127) * s
  return out
}

export function dot(a, b) {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += a[i] * b[i]
  return sum
}
