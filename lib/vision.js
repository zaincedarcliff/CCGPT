// Transcribe images posted on official pages (bell schedules, flyers, calendars are frequently
// uploaded as JPG/PNG) into searchable text using Gemini's multimodal input.
// Only runs for tier-1 pages, only when the page content changed, and results are cached in the
// index by image URL so an unchanged image is never re-transcribed.

import axios from 'axios'
import { GoogleGenAI } from '@google/genai'
import { REQUEST_HEADERS } from './extract.js'

const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const VISION_MODEL = (process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim()

function apiKey() {
  return (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim()
}
export function visionAvailable() {
  return Boolean(apiKey()) && process.env.KB_TRANSCRIBE_IMAGES !== '0'
}

let client
function ai() {
  if (!client) client = new GoogleGenAI({ apiKey: apiKey() })
  return client
}

/**
 * @param {string} url image URL
 * @param {{ pageTitle?: string, alt?: string }} [ctx]
 * @returns {Promise<string>} transcription ('' when nothing readable / unavailable)
 */
export async function transcribeImage(url, ctx = {}) {
  if (!visionAvailable()) return ''
  const res = await axios.get(url, {
    timeout: 20000,
    headers: { ...REQUEST_HEADERS, Accept: 'image/*' },
    responseType: 'arraybuffer',
    maxContentLength: MAX_IMAGE_BYTES,
    maxBodyLength: MAX_IMAGE_BYTES,
  })
  const mime = String(res.headers['content-type'] || '').split(';')[0].trim() || guessMime(url)
  if (!/^image\//.test(mime)) return ''
  const data = Buffer.from(res.data).toString('base64')

  const prompt = [
    `This image was posted on the official Cedar Cliff High School / West Shore School District website${ctx.pageTitle ? ` on the page "${ctx.pageTitle}"` : ''}${ctx.alt ? ` (alt text: "${ctx.alt}")` : ''}.`,
    'Transcribe ALL text in the image exactly as written, preserving numbers, times, dates, names, and order.',
    'If it is a table or schedule, write one row per line with cells separated by " | " and include the header row.',
    'If it is a flyer or announcement, transcribe it top to bottom. Do not summarize, do not add commentary.',
    'If the image contains no readable text (photo, decorative graphic), reply with exactly: NO_TEXT',
  ].join('\n')

  const response = await ai().models.generateContent({
    model: VISION_MODEL,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data } }, { text: prompt }] }],
    config: { temperature: 0, maxOutputTokens: 2048, ...(/gemini-2\.5|gemini-3/i.test(VISION_MODEL) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
  })
  const text = String(response?.text || '').trim()
  if (!text || /^NO_TEXT\b/i.test(text)) return ''
  return text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()
}

function guessMime(url) {
  const m = /\.(jpe?g|png|gif|webp)(\?|$)/i.exec(url)
  if (!m) return 'image/jpeg'
  const ext = m[1].toLowerCase()
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
}
