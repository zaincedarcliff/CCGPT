import { useState, useCallback } from 'react'
import { loginWithEmail, signUpWithEmail, loginWithGoogle, getSignInMethodsForEmail } from './firebase.js'
import cedarCliffLogo from './assets/cedar-cliff-logo.png'
import './Auth.css'

export default function Auth() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light')

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      try { localStorage.setItem('ccgpt_theme', next) } catch { /* ignore */ }
      return next
    })
  }, [])

  const isLogin = mode === 'login'

  function friendlyError(err) {
    const code = err?.code || ''
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential')
      return 'Incorrect email or password.'
    if (code === 'auth/email-already-in-use')
      return 'An account with this email already exists. Try logging in.'
    if (code === 'auth/weak-password')
      return 'Password must be at least 6 characters.'
    if (code === 'auth/too-many-requests')
      return 'Too many attempts. Please wait a moment and try again.'
    if (code === 'auth/popup-closed-by-user')
      return 'Google sign-in was cancelled.'
    if (code === 'auth/popup-blocked')
      return 'Your browser blocked the sign-in popup. Please allow popups for this site and try again.'
    return err.message || 'Something went wrong. Please try again.'
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!isLogin && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    try {
      if (isLogin) {
        await loginWithEmail(email, password)
      } else {
        await signUpWithEmail(email, password)
      }
    } catch (err) {
      const code = err?.code || ''
      const em = email.trim()

      if (code === 'auth/email-already-in-use' && em) {
        const methods = await getSignInMethodsForEmail(em)
        if (methods.includes('google.com') && !methods.includes('password')) {
          setError(
            'This email is already used with Google. Sign in with Google, then use “Add email password” at the top of the app to choose a password for email login.',
          )
        } else if (methods.includes('password')) {
          setError('An account with this email already exists. Use Sign In instead.')
        } else {
          setError(friendlyError(err))
        }
      } else if (
        isLogin &&
        em &&
        (code === 'auth/invalid-credential' ||
          code === 'auth/wrong-password' ||
          code === 'auth/user-not-found')
      ) {
        const methods = await getSignInMethodsForEmail(em)
        if (methods.includes('google.com') && !methods.includes('password')) {
          setError(
            'This account was created with Google and has no password yet. Sign in with Google, then use “Add email password” at the top to set one.',
          )
        } else {
          setError(friendlyError(err))
        }
      } else {
        setError(friendlyError(err))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setError('')
    setLoading(true)
    try {
      await loginWithGoogle()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <button
          className="theme-toggle auth-theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <img
          alt="Cedar Cliff logo"
          className="auth-card__logo"
          src={cedarCliffLogo}
        />
        <h1 className="auth-card__title">
          {isLogin ? 'Welcome back!' : 'Create your account'}
        </h1>
        <p className="auth-card__subtitle">
          {isLogin
            ? 'Sign in to access CCGPT'
            : 'Sign up to get started with CCGPT'}
        </p>

        <button
          className="auth-google-btn"
          type="button"
          onClick={handleGoogle}
          disabled={loading}
        >
          <svg className="auth-google-btn__icon" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              className="auth-field__input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              disabled={loading}
            />
          </div>

          <div className="auth-field">
            <label className="auth-field__label" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              className="auth-field__input"
              type="password"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              disabled={loading}
            />
          </div>

          {!isLogin && (
            <div className="auth-field">
              <label className="auth-field__label" htmlFor="auth-confirm">
                Confirm password
              </label>
              <input
                id="auth-confirm"
                className="auth-field__input"
                type="password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button
            className="auth-submit-btn"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="auth-toggle">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            className="auth-toggle__btn"
            type="button"
            onClick={() => {
              setMode(isLogin ? 'signup' : 'login')
              setError('')
              setConfirmPassword('')
            }}
          >
            {isLogin ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>
    </div>
  )
}
