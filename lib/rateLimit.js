// Rate limiting for the chat + web-search backend.
//
// Two stores:
//   - Upstash Redis (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN): shared across all serverless
//     instances → real, enforceable limits. Uses the REST API via fetch (no dependency).
//   - In-memory fallback: per warm instance. Still stops bursts and runaway loops, but a
//     determined abuser hitting many cold instances could exceed it. Set up Upstash for production.
//
// Fixed-window counters keyed by `{bucket}:{subject}:{window}`.

const LIMITS = {
  chatPerMinute: Number(process.env.RATE_CHAT_PER_MINUTE || 12),
  chatPerDay: Number(process.env.RATE_CHAT_PER_DAY || 300),
  webPerMinute: Number(process.env.RATE_WEB_PER_MINUTE || 6),
  webPerDay: Number(process.env.RATE_WEB_PER_DAY || 120),
  ipPerMinute: Number(process.env.RATE_IP_PER_MINUTE || 30),
}

const mem = new Map()
function memIncr(key, ttlSec) {
  const now = Date.now()
  const cur = mem.get(key)
  if (!cur || cur.exp < now) {
    mem.set(key, { n: 1, exp: now + ttlSec * 1000 })
    if (mem.size > 5000) for (const [k, v] of mem) if (v.exp < now) mem.delete(k)
    return 1
  }
  cur.n++
  return cur.n
}

function upstashConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

async function redisIncr(key, ttlSec) {
  const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, String(ttlSec), 'NX'],
    ]),
  })
  if (!res.ok) throw new Error(`upstash ${res.status}`)
  const json = await res.json()
  return Number(json?.[0]?.result ?? 0)
}

async function incr(key, ttlSec) {
  if (upstashConfigured()) {
    try {
      return await redisIncr(key, ttlSec)
    } catch (err) {
      console.warn('[ratelimit] upstash failed, using memory:', err?.message || err)
    }
  }
  return memIncr(key, ttlSec)
}

function windows() {
  const now = Date.now()
  return { minute: Math.floor(now / 60000), day: Math.floor(now / 86400000) }
}

/**
 * @param {'chat'|'web'} bucket
 * @param {string} subject uid or ip
 * @returns {Promise<{ ok: boolean, retryAfterSec?: number, reason?: string }>}
 */
export async function checkLimit(bucket, subject) {
  const w = windows()
  const perMin = bucket === 'chat' ? LIMITS.chatPerMinute : LIMITS.webPerMinute
  const perDay = bucket === 'chat' ? LIMITS.chatPerDay : LIMITS.webPerDay
  const [m, d] = await Promise.all([incr(`rl:${bucket}:m:${subject}:${w.minute}`, 90), incr(`rl:${bucket}:d:${subject}:${w.day}`, 90000)])
  if (m > perMin) return { ok: false, retryAfterSec: 60 - (Math.floor(Date.now() / 1000) % 60), reason: `${bucket} per-minute limit` }
  if (d > perDay) return { ok: false, retryAfterSec: 3600, reason: `${bucket} daily limit` }
  return { ok: true }
}

export async function checkIpLimit(ip) {
  const w = windows()
  const n = await incr(`rl:ip:m:${ip}:${w.minute}`, 90)
  return n <= LIMITS.ipPerMinute
}

export function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '')
  return (xf.split(',')[0] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown').toString().trim()
}

export function rateLimitStore() {
  return upstashConfigured() ? 'upstash' : 'memory'
}
