import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { User } from '../lib/types'
import { Haze } from '../components/Haze'
import styles from './SignIn.module.css'

interface AuthConfig {
  google_client_id: string | null
  password_login: boolean
}
interface TokenOut {
  user: User
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
        }
      }
    }
  }
}

function loadGoogle(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Google sign-in could not load'))
    document.head.appendChild(s)
  })
}

export default function SignIn() {
  const { user, setUser, loading } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/app'
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: () => api<AuthConfig>('/api/auth/config') })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const gRef = useRef<HTMLDivElement>(null)

  const done = (u: User) => {
    setUser(u)
    nav(next, { replace: true })
  }

  useEffect(() => {
    const id = cfg.data?.google_client_id
    if (!id || !gRef.current) return
    let cancelled = false
    loadGoogle()
      .then(() => {
        if (cancelled || !gRef.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: id,
          callback: async ({ credential }) => {
            setError(null)
            setBusy(true)
            try {
              done((await post<TokenOut>('/api/auth/google', { credential })).user)
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Google sign-in failed. Try again.')
            } finally {
              setBusy(false)
            }
          },
        })
        window.google.accounts.id.renderButton(gRef.current, { theme: 'outline', size: 'large', shape: 'pill', width: 320, text: 'continue_with' })
      })
      .catch(() => setError('Google sign-in could not load. Use email and password instead.'))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.data?.google_client_id])

  if (!loading && user) return <Navigate to={next} replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      done((await post<TokenOut>('/api/auth/login', { email, password })).user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const google = cfg.data?.google_client_id
  const password_ok = cfg.data?.password_login ?? true

  return (
    <div className={styles.page}>
      <aside className={styles.side}>
        <Haze className={styles.haze} />
        <Link to="/" className={`${styles.brand} wordmark`}>zeroguess</Link>
        <p className={styles.line}>Answers from your documents, each one cited to the sentence it came from.</p>
      </aside>

      <main className={styles.main}>
        <div className={styles.panel}>
          <h1 className={styles.h1}>Sign in</h1>
          <p className={styles.sub}>Use your work account. Documents stay on this deployment.</p>

          {google ? (
            <div className={styles.google}>
              <div ref={gRef} className={styles.gBtn} aria-label="Continue with Google" />
            </div>
          ) : (
            !cfg.isLoading && (
              <div className={styles.google}>
                <button type="button" className="btn btn-ghost" style={{ width: '100%' }} disabled aria-describedby="g-off">
                  Continue with Google
                </button>
                <p id="g-off" className={styles.sub} style={{ marginTop: 'var(--space-xs)' }}>
                  Google sign-in is not set up on this server yet: add GOOGLE_CLIENT_ID to backend/.env and restart the API.
                </p>
              </div>
            )
          )}
          {password_ok && <div className={styles.or}><span>or with email</span></div>}

          {password_ok && (
            <form className={styles.form} onSubmit={submit} noValidate>
              <label className="field">
                <span className="field-label">Email</span>
                <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error || undefined} />
              </label>
              <label className="field">
                <span className="field-label">Password</span>
                <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error || undefined} />
              </label>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={busy || !email || !password}>
                {busy ? 'Signing in' : 'Sign in'}
              </button>
            </form>
          )}
          {!password_ok && error && <p className={styles.error} role="alert">{error}</p>}
          {cfg.isError && <p className={styles.error} role="alert">The server is not reachable. Check that the API is running.</p>}
        </div>
      </main>
    </div>
  )
}
