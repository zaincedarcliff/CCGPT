// Server-side verification of Firebase Auth ID tokens (no Admin SDK / service account needed).
// Firebase ID tokens are RS256 JWTs signed by Google; we verify the signature against Google's
// public JWKS and check issuer/audience for this project.

import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
let jwks

export function firebaseProjectId() {
  return (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim()
}

/**
 * @param {string|undefined} authorizationHeader "Bearer <idToken>"
 * @returns {Promise<{ uid: string, email?: string } | null>} null when missing/invalid
 */
export async function verifyFirebaseToken(authorizationHeader) {
  const m = /^Bearer\s+(.+)$/i.exec(String(authorizationHeader || ''))
  if (!m) return null
  const projectId = firebaseProjectId()
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID (or VITE_FIREBASE_PROJECT_ID) is not set on the server')
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL), { cooldownDuration: 60_000, cacheMaxAge: 6 * 3600_000 })
  try {
    const { payload } = await jwtVerify(m[1], jwks, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    })
    const uid = String(payload.sub || payload.user_id || '')
    if (!uid) return null
    return { uid, email: typeof payload.email === 'string' ? payload.email : undefined }
  } catch (err) {
    console.warn('[auth] token rejected:', err?.message || err)
    return null
  }
}

/** Local-dev escape hatch: ALLOW_ANON_CHAT=1 lets `vite dev` work without a signed-in user. */
export function anonymousAllowed() {
  return process.env.ALLOW_ANON_CHAT === '1' && process.env.VERCEL_ENV !== 'production'
}
