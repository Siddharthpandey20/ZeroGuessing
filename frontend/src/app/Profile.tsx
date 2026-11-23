import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, KeyRound, LoaderCircle, Pencil, Trash2 } from 'lucide-react'
import { api, ApiError, patch, post } from '../lib/api'
import { tr } from '../lib/i18n'
import type { User } from '../lib/types'
import { fmtDate, fmtDateTime } from './answer/selection'
import styles from './Profile.module.css'

/** The signed-in user's profile (GET /api/profile). */
interface Profile {
  id: string
  email: string
  name: string | null
  picture: string | null
  role: 'admin' | 'viewer'
  job_title: string | null
  organisation: string | null
  has_password: boolean
  google_linked: boolean
  created_at: string
  last_login_at: string | null
}

const MAX_PHOTO = 5 * 1024 * 1024
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export default function ProfilePage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/api/profile') })
  const [editing, setEditing] = useState(false)

  /** Keep the profile page and the top bar (name, avatar) in step after any change. */
  const saved = (p: Profile) => {
    qc.setQueryData(['profile'], p)
    qc.setQueryData<User | null>(['me'], (u) => (u ? { ...u, name: p.name ?? u.name, picture: p.picture } : u))
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.h1}>{tr('Your profile')}</h1>
        <p className={styles.sub}>{tr('How you appear in ZeroGuess, and how you sign in.')}</p>
      </header>

      {q.isLoading && <div className={`skeleton ${styles.skel}`} />}
      {q.isError && <p className={styles.error} role="alert">{tr('Your profile could not be loaded. Refresh to try again.')}</p>}
      {q.data && (
        <div className={styles.cols}>
          <section className={styles.card} aria-labelledby="about-title">
            {editing
              ? <EditDetails p={q.data} onSaved={(p) => { saved(p); setEditing(false) }} onPhoto={saved} onCancel={() => setEditing(false)} />
              : <ViewDetails p={q.data} onEdit={() => setEditing(true)} />}
          </section>
          <section className={styles.card} aria-labelledby="pw-title">
            <PasswordCard p={q.data} onSaved={saved} />
          </section>
        </div>
      )}
    </div>
  )
}

function Avatar({ p, size }: { p: Pick<Profile, 'name' | 'email' | 'picture'>; size: number }) {
  const [broken, setBroken] = useState<string | null>(null)
  const initials = (p.name || p.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
  if (p.picture && broken !== p.picture)
    return <img src={p.picture} alt="" className={styles.avatar} style={{ width: size, height: size }} referrerPolicy="no-referrer"
      onError={() => setBroken(p.picture)} />
  return <span className={styles.avatar} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">{initials}</span>
}

function ViewDetails({ p, onEdit }: { p: Profile; onEdit: () => void }) {
  const ways = [p.google_linked && 'Google', p.has_password && tr('Email and password')].filter(Boolean).join(' · ')
  return (
    <>
      <div className={styles.who}>
        <Avatar p={p} size={96} />
        <div className={styles.whoText}>
          <h2 id="about-title" className={styles.name}>{p.name || p.email.split('@')[0]}</h2>
          {(p.job_title || p.organisation) && (
            <p className={styles.line}>{[p.job_title, p.organisation].filter(Boolean).join(' · ')}</p>
          )}
          <span className={styles.role} data-role={p.role}>{tr(p.role === 'admin' ? 'Admin' : 'Viewer')}</span>
        </div>
        <button type="button" className={`btn btn-ghost btn-sm ${styles.editBtn}`} onClick={onEdit}>
          <Pencil size={14} strokeWidth={1.8} aria-hidden="true" /> {tr('Edit profile')}
        </button>
      </div>
      <dl className={styles.facts}>
        <div><dt>{tr('Email')}</dt><dd>{p.email}</dd></div>
        <div><dt>{tr('Job title')}</dt><dd>{p.job_title || <span className={styles.muted}>{tr('Not added')}</span>}</dd></div>
        <div><dt>{tr('Organisation')}</dt><dd>{p.organisation || <span className={styles.muted}>{tr('Not added')}</span>}</dd></div>
        <div><dt>{tr('Role')}</dt><dd>{tr(p.role === 'admin' ? 'Admin: can upload and confirm' : 'Viewer: can ask and share')}</dd></div>
        <div><dt>{tr('Signs in with')}</dt><dd>{ways || '—'}</dd></div>
        <div><dt>{tr('Member since')}</dt><dd>{fmtDate(p.created_at)}</dd></div>
        <div><dt>{tr('Last signed in')}</dt><dd>{p.last_login_at ? fmtDateTime(p.last_login_at) : '—'}</dd></div>
      </dl>
    </>
  )
}

function EditDetails({ p, onSaved, onPhoto, onCancel }: {
  p: Profile; onSaved: (p: Profile) => void; onPhoto: (p: Profile) => void; onCancel: () => void
}) {
  const [name, setName] = useState(p.name ?? '')
  const [job, setJob] = useState(p.job_title ?? '')
  const [org, setOrg] = useState(p.organisation ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError(tr('Your name cannot be empty.'))
    setBusy(true)
    setError(null)
    try {
      onSaved(await patch<Profile>('/api/profile', { name, job_title: job, organisation: org }))
    } catch (err) {
      setError(err instanceof ApiError ? tr(err.message) : tr('Not saved. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const upload = async (file: File) => {
    setPhotoError(null)
    if (!PHOTO_TYPES.includes(file.type)) return setPhotoError(tr('Use a JPEG, PNG or WebP image.'))
    if (file.size > MAX_PHOTO) return setPhotoError(tr('That photo is larger than 5 MB. Choose a smaller one.'))
    setPhotoBusy(true)
    try {
      const fd = new FormData()
      fd.append('photo', file)
      onPhoto(await api<Profile>('/api/profile/photo', { method: 'POST', body: fd }))
    } catch (err) {
      setPhotoError(err instanceof ApiError ? tr(err.message) : tr('The upload failed. Check your connection and try again.'))
    } finally {
      setPhotoBusy(false)
    }
  }

  const removePhoto = async () => {
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      onPhoto(await api<Profile>('/api/profile/photo', { method: 'DELETE' }))
    } catch {
      setPhotoError(tr('Not saved. Check your connection and try again.'))
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={save} noValidate>
      <h2 id="about-title" className={styles.cardTitle}>{tr('Edit profile')}</h2>

      <div className={styles.photoRow}>
        <button type="button" className={styles.photoBtn} onClick={() => picker.current?.click()} disabled={photoBusy}
          aria-label={tr('Upload a profile photo')}>
          <Avatar p={p} size={96} />
          <span className={styles.photoOverlay} aria-hidden="true">
            {photoBusy ? <LoaderCircle size={20} className={styles.spin} /> : <Camera size={20} strokeWidth={1.8} />}
          </span>
        </button>
        <div className={styles.photoText}>
          <input ref={picker} type="file" accept={PHOTO_TYPES.join(',')} hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
          <div className={styles.photoActions}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => picker.current?.click()} disabled={photoBusy}>
              <Camera size={14} strokeWidth={1.8} aria-hidden="true" /> {tr(p.picture ? 'Change photo' : 'Upload photo')}
            </button>
            {p.picture && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void removePhoto()} disabled={photoBusy}>
                <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" /> {tr('Remove')}
              </button>
            )}
          </div>
          <p className={styles.hint}>{tr('JPEG, PNG or WebP, up to 5 MB. It is cropped to a square, and location and camera details are removed.')}</p>
          {photoError && <p className={styles.error} role="alert">{photoError}</p>}
        </div>
      </div>

      <label className="field">
        <span className="field-label">{tr('Name')}</span>
        <input className="input" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        <span className="field-label">{tr('Job title')} <span className={styles.muted}>{tr('(optional)')}</span></span>
        <input className="input" value={job} maxLength={80} autoComplete="organization-title" placeholder={tr('e.g. Claims officer')}
          onChange={(e) => setJob(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">{tr('Organisation')} <span className={styles.muted}>{tr('(optional)')}</span></span>
        <input className="input" value={org} maxLength={120} autoComplete="organization" placeholder={tr('e.g. Raipur branch')}
          onChange={(e) => setOrg(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">{tr('Email')}</span>
        <input className="input" value={p.email} readOnly disabled aria-describedby="email-note" />
        <span id="email-note" className={styles.hint}>{tr('Your email is how you sign in, so it cannot be changed here.')}</span>
      </label>

      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>{tr('Cancel')}</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? <LoaderCircle size={14} className={styles.spin} aria-hidden="true" /> : <Check size={14} strokeWidth={2.2} aria-hidden="true" />}
          {' '}{tr(busy ? 'Saving' : 'Save changes')}
        </button>
      </div>
    </form>
  )
}

function PasswordCard({ p, onSaved }: { p: Profile; onSaved: (p: Profile) => void }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setError(null) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (next.length < 8) return setError(tr('Use a password of at least 8 characters.'))
    if (next !== confirm) return setError(tr('The two passwords do not match.'))
    setBusy(true)
    try {
      onSaved(await post<Profile>('/api/profile/password', { current_password: p.has_password ? current : null, new_password: next }))
      reset()
      setOpen(false)
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? tr(err.message.replace(/^Value error, /, '')) : tr('Not saved. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 id="pw-title" className={styles.cardTitle}><KeyRound size={16} strokeWidth={1.8} aria-hidden="true" /> {tr('Password')}</h2>
      <p className={styles.sub}>
        {tr(p.has_password
          ? 'You can sign in with your email and password. Changing it signs you out on your other devices.'
          : 'You sign in with Google. Set a password if you also want to sign in with your email.')}
      </p>
      {done && !open && <p className={styles.ok} role="status">{tr('Password saved. Your other devices were signed out.')}</p>}
      {!open ? (
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(true); setDone(false) }}>
            {tr(p.has_password ? 'Change password' : 'Set a password')}
          </button>
        </div>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          {p.has_password && (
            <label className="field">
              <span className="field-label">{tr('Current password')}</span>
              <input className="input" type="password" autoComplete="current-password" maxLength={128} value={current}
                onChange={(e) => setCurrent(e.target.value)} required />
            </label>
          )}
          <label className="field">
            <span className="field-label">{tr('New password')}</span>
            <input className="input" type="password" autoComplete="new-password" maxLength={128} value={next}
              onChange={(e) => setNext(e.target.value)} required aria-describedby="new-pw-hint" />
            <span id="new-pw-hint" className={styles.hint}>{tr('At least 8 characters.')}</span>
          </label>
          <label className="field">
            <span className="field-label">{tr('Confirm password')}</span>
            <input className="input" type="password" autoComplete="new-password" maxLength={128} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} required aria-invalid={(!!confirm && confirm !== next) || undefined} />
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => { reset(); setOpen(false) }} disabled={busy}>{tr('Cancel')}</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !next || !confirm || (p.has_password && !current)}>
              {tr(busy ? 'Saving' : 'Save password')}
            </button>
          </div>
        </form>
      )}
    </>
  )
}
