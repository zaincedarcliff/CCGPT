// Per-account long-term memory.
//
// Every fact is stored under `userMemory/{uid}` in Firestore, where `uid` is the
// Firebase Auth id of the signed-in user. Two guarantees keep accounts separate:
//   1. Every read/write here takes the caller's uid and only touches that document.
//   2. firestore.rules only allows a user to read/write the doc whose id equals
//      their own auth uid — so even a buggy client cannot reach another account.
// The in-process cache below is keyed by uid too and is dropped whenever the
// signed-in account changes (see resetMemoryCache).

import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase.js'
import { extractMemoryFacts, isGeminiConfigured } from './gemini.js'

const COLLECTION = 'userMemory'
const MAX_FACTS = 40

/** @type {{ uid: string | null, facts: string[], loaded: boolean }} */
let cache = { uid: null, facts: [], loaded: false }

function memoryRef(uid) {
  return doc(db, COLLECTION, uid)
}

/** Drop any cached facts. Call on sign-out / account switch. */
export function resetMemoryCache() {
  cache = { uid: null, facts: [], loaded: false }
}

/**
 * Load the facts stored for this account. Cached per uid after first load.
 * @param {string} uid
 * @returns {Promise<string[]>}
 */
export async function loadUserMemory(uid) {
  if (!uid) return []
  if (cache.loaded && cache.uid === uid) return cache.facts
  try {
    const snap = await getDoc(memoryRef(uid))
    const facts = snap.exists() && Array.isArray(snap.data()?.facts)
      ? snap.data().facts.map((f) => String(f)).filter(Boolean)
      : []
    cache = { uid, facts, loaded: true }
    return facts
  } catch (err) {
    console.warn('[memory] load failed:', err?.message || err)
    cache = { uid, facts: [], loaded: true }
    return []
  }
}

async function saveUserMemory(uid, facts) {
  const trimmed = facts.slice(-MAX_FACTS)
  cache = { uid, facts: trimmed, loaded: true }
  await setDoc(
    memoryRef(uid),
    { facts: trimmed, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return trimmed
}

/**
 * Wipe everything remembered about this account.
 * @param {string} uid
 */
export async function clearUserMemory(uid) {
  if (!uid) return
  cache = { uid, facts: [], loaded: true }
  try {
    await deleteDoc(memoryRef(uid))
  } catch (err) {
    console.warn('[memory] clear failed:', err?.message || err)
  }
}

/**
 * Remove a single fact (exact text) from this account's memory.
 * @param {string} uid
 * @param {string} fact
 */
export async function forgetFact(uid, fact) {
  if (!uid) return []
  const facts = await loadUserMemory(uid)
  const next = facts.filter((f) => f !== fact)
  if (next.length === facts.length) return facts
  return saveUserMemory(uid, next)
}

/**
 * Turn stored facts into a prompt section. Empty string when nothing is known.
 * @param {string[]} facts
 */
export function formatMemoryForPrompt(facts) {
  if (!facts?.length) return ''
  const lines = facts.map((f) => `- ${f}`).join('\n')
  return [
    '## About this student (long-term memory)',
    'These facts were saved from earlier conversations with the signed-in user. Use them naturally to personalize answers (their name, grade, sports, clubs, preferences), but do not recite the whole list or mention that you keep a memory unless asked.',
    'If the user asks what you remember about them, summarize these facts. If they correct one, trust the new information.',
    lines,
  ].join('\n')
}

/**
 * Convenience: load + format for the given account.
 * @param {string} uid
 */
export async function getMemoryPromptBlock(uid) {
  const facts = await loadUserMemory(uid)
  return formatMemoryForPrompt(facts)
}

const CLEAR_MEMORY_RE =
  /\b(forget|erase|delete|clear|wipe|reset)\b[^.?!]{0,40}\b(everything|all|memory|memories|about me|what you know|my (info|information|data|profile))\b/i

/**
 * Handle explicit memory commands ("forget everything about me", "clear your memory").
 * Returns a reply string when a command was handled, otherwise null.
 * @param {string} uid
 * @param {string} userText
 */
export async function handleMemoryCommand(uid, userText) {
  const text = String(userText || '').trim()
  if (!uid || !text) return null
  if (CLEAR_MEMORY_RE.test(text)) {
    await clearUserMemory(uid)
    return "Done — I've cleared everything I remembered about you. From here on I'll only know what you tell me again."
  }
  return null
}

/** Cheap gate so we only pay for an extraction call when the message plausibly
 *  contains something personal. */
const PERSONAL_HINT_RE =
  /\b(i am|i'm|im|i was|i will|i'll|i play|i run|i swim|i wrestle|i like|i love|i hate|i prefer|i want|i need|i have|i've|i take|i'm taking|i take|i joined|i'm in|i am in|my name|call me|remember|don't forget|my counselor|my teacher|my grade|my class|my classes|my schedule|my sport|my team|my club|senior|junior|sophomore|freshman|class of)\b/i

/**
 * After an exchange, pull out durable facts and merge them into this account's memory.
 * Fire-and-forget safe: never throws.
 * @param {string} uid
 * @param {string} userText
 * @param {string} assistantText
 */
export async function rememberFromExchange(uid, userText, assistantText) {
  if (!uid || !isGeminiConfigured()) return
  const text = String(userText || '').trim()
  if (text.length < 6 || !PERSONAL_HINT_RE.test(text)) return

  try {
    const existing = await loadUserMemory(uid)
    const { add, remove } = await extractMemoryFacts(text, assistantText, existing)
    if (!add.length && !remove.length) return

    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const removeSet = new Set(remove.map(norm))
    let next = existing.filter((f) => !removeSet.has(norm(f)))
    const seen = new Set(next.map(norm))
    for (const fact of add) {
      const key = norm(fact)
      if (!key || seen.has(key)) continue
      seen.add(key)
      next.push(fact)
    }
    if (next.length === existing.length && next.every((f, i) => f === existing[i])) return
    await saveUserMemory(uid, next)
  } catch (err) {
    console.warn('[memory] update failed:', err?.message || err)
  }
}
