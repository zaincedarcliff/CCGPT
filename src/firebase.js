import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  fetchSignInMethodsForEmail,
  EmailAuthProvider,
  linkWithCredential,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

const googleProvider = new GoogleAuthProvider()

export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider)
  return result.user
}

export async function signUpWithEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  return cred.user
}

export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password)
  return cred.user
}

export async function logout() {
  await signOut(auth)
}

/**
 * Which sign-in methods exist for this email (e.g. ['google.com'], ['password'], or both).
 */
export async function getSignInMethodsForEmail(email) {
  const e = String(email || '').trim()
  if (!e) return []
  return fetchSignInMethodsForEmail(auth, e)
}

/**
 * Attach an email/password to the current user (e.g. after Google sign-in) so they can
 * sign in with email + password later. Requires user.email to match.
 */
export async function linkPasswordToCurrentUser(password) {
  const user = auth.currentUser
  if (!user?.email) throw new Error('Not signed in')
  const credential = EmailAuthProvider.credential(user.email, password)
  await linkWithCredential(user, credential)
}

export { onAuthStateChanged }
