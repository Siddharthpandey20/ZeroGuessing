import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Camera, LoaderCircle } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import styles from './Composer.module.css'

export type InputMode = 'typed' | 'camera' | 'voice'

const todayISO = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

interface Props {
  onSubmit: (question: string, asOf: string, mode: InputMode) => void
  busy?: boolean
  initial?: { question: string; asOf: string }
  onCancel?: () => void
  autoFocus?: boolean
  compact?: boolean
  submitLabel?: string
}

/** Question box with the date the rule should be checked on, and a camera for printed clauses. */
export function Composer({ onSubmit, busy, initial, onCancel, autoFocus, compact, submitLabel = 'Ask' }: Props) {
  const [q, setQ] = useState(initial?.question ?? '')
  const [asOf, setAsOf] = useState(initial?.asOf ?? todayISO())
  const [mode, setMode] = useState<InputMode>('typed')
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [q])
  useEffect(() => {
    if (autoFocus) ta.current?.focus()
  }, [autoFocus])

  const send = () => {
    const text = q.trim()
    if (text.length < 2 || busy) return
    onSubmit(text, asOf, mode)
    if (!initial) {
      setQ('')
      setMode('typed')
      setNote(null)
    }
  }

  const readPhoto = async (f: File) => {
    setReading(true)
    setNote(null)
    try {
      const fd = new FormData()
      fd.append('image', f)
      const r = await api<{ text: string; note: string }>('/api/camera/transcribe', { method: 'POST', body: fd })
      setQ(r.text.trim())
      setMode('camera')
      setNote('Read from the photo. Check the text before you ask.')
      ta.current?.focus()
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'The photo could not be read.')
    } finally {
      setReading(false)
      if (file.current) file.current.value = ''
    }
  }

  return (
    <form
      className={styles.box}
      data-compact={compact || undefined}
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <label className="sr-only" htmlFor="question">Question</label>
      <textarea
        id="question"
        ref={ta}
        className={styles.input}
        rows={1}
        placeholder="Ask about the loaded documents, in English or Hindi"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
          if (e.key === 'Escape' && onCancel) onCancel()
        }}
      />
      {note && <p className={styles.note} role="status">{note}</p>}
      <div className={styles.bar}>
        <label className={styles.date}>
          <span>Rule in force on</span>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || todayISO())} className="tnum" />
        </label>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" hidden onChange={(e) => e.target.files?.[0] && readPhoto(e.target.files[0])} />
        <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => file.current?.click()} disabled={reading} aria-label="Read a question or clause from a photo" title="Read text from a photo">
          {reading ? <LoaderCircle size={16} className={styles.spin} /> : <Camera size={16} strokeWidth={1.8} />}
        </button>
        <span className={styles.spacer} />
        {onCancel && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>Cancel</button>
        )}
        <button type="submit" className={`btn btn-primary btn-sm ${styles.send}`} disabled={busy || q.trim().length < 2}>
          {submitLabel} <ArrowUp size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
