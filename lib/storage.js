// Persistent storage for the knowledge base.
//   - Production (Vercel): private Vercel Blob (BLOB_READ_WRITE_TOKEN present)
//   - Local dev / CLI:     ./.kb/ directory on disk (gitignored)
// Both back the same tiny get/put JSON interface so the rest of the code doesn't care.

import fs from 'node:fs/promises'
import path from 'node:path'

const LOCAL_DIR = process.env.KB_LOCAL_DIR || path.resolve(process.cwd(), '.kb')

export function hasBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

export function storageKind() {
  return hasBlobStorage() ? 'vercel-blob' : `local:${LOCAL_DIR}`
}

/** @returns {Promise<any|null>} parsed JSON or null when missing */
export async function readJson(key) {
  if (hasBlobStorage()) {
    const { get } = await import('@vercel/blob')
    try {
      const result = await get(key, { access: 'private', useCache: false })
      if (result?.statusCode === 200 && result.stream) {
        return await new Response(result.stream).json()
      }
      return null
    } catch (err) {
      if (/not.?found|404/i.test(String(err?.message || err))) return null
      throw err
    }
  }
  try {
    const raw = await fs.readFile(path.join(LOCAL_DIR, key), 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

export async function writeJson(key, value) {
  const body = JSON.stringify(value)
  if (hasBlobStorage()) {
    const { put } = await import('@vercel/blob')
    const blob = await put(key, body, {
      access: 'private',
      contentType: 'application/json',
      allowOverwrite: true,
      addRandomSuffix: false,
    })
    return { url: blob.url, bytes: Buffer.byteLength(body) }
  }
  const file = path.join(LOCAL_DIR, key)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
  return { url: file, bytes: Buffer.byteLength(body) }
}
