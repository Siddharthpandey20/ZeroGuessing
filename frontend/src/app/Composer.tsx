import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Camera, LoaderCircle, Mic, Paperclip, Square } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { canDictate, dictate, type SpeechLang } from '../lib/speech'
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
  /** Add PDFs to this chat (paperclip). Omitted where uploading makes no sense, e.g. editing a past question. */
  onAttach?: (files: File[]) => void
}

/** Question box: the date the rule should be checked on, PDFs for this chat, dictation, and a camera for printed text. */
export function Composer({ onSubmit, busy, initial, onCancel, autoFocus, compact, submitLabel = 'Ask', onAttach }: Props) {
  const [q, setQ] = useState(initial?.question ?? '')
  const [asOf, setAsOf] = useState(initial?.asOf ?? todayISO())
  const [mode, setMode] = useState<InputMode>('typed')
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [lang, setLang] = useState<SpeechLang>('en-IN')
  const ta = useRef<HTMLTextAreaElement>(null)
  const photo = useRef<HTMLInputElement>(null)
  const pdfs = useRef<HTMLInputElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const mic = canDictate()

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [q])
  useEffect(() => {
    if (autoFocus) ta.current?.focus()
  }, [autoFocus])
  useEffect(() => () => stopRef.current?.(), [])

  const send = () => {
    const text = q.trim()
    if (text.length < 2 || busy) return
    stopRef.current?.()
    onSubmit(text, asOf, mode)
    if (!initial) {
      setQ('')
      setMode('typed')
      setNote(null)
    }
  }

  const toggleMic = () => {
    if (listening) {
      stopRef.current?.()
      return
    }
    const before = q.trim()
    setNote(lang === 'hi-IN' ? 'सुन रहा हूँ… बोलिए' : 'Listening… speak your question')
    setListening(true)
    stopRef.current = dictate(
      lang,
      (t) => {
        setQ(before ? `${before} ${t}` : t)
        setMode('voice')
      },
      (error) => {
        setListening(false)
        stopRef.current = null
        setNote(error ?? 'Check the words, then press Ask.')
        ta.current?.focus()
      },
    )
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
      if (photo.current) photo.current.value = ''
    }
  }

  return (
    <form
      className={styles.box}
      data-compact={compact || undefined}
      data-listening={listening || undefined}
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
        placeholder="Ask about this chat’s documents, in English or Hindi"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          if (!e.target.value) setMode('typed')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
          if (e.key === 'Escape' && onCancel) onCancel()
        }}
      />
      {note && <p className={styles.note} role="status" aria-live="polite">{note}</p>}
      <div className={styles.bar}>
        <label className={styles.date}>
          <span>Rule in force on</span>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || todayISO())} className="tnum" />
        </label>

        {onAttach && (
          <>
            <input ref={pdfs} type="file" accept="application/pdf,.pdf" multiple hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) onAttach(files)
                e.target.value = ''
              }} />
            <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => pdfs.current?.click()} aria-label="Add PDFs to this chat" title="Add PDFs to this chat">
              <Paperclip size={16} strokeWidth={1.8} />
            </button>
          </>
        )}

        <input ref={photo} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" hidden onChange={(e) => e.target.files?.[0] && readPhoto(e.target.files[0])} />
        <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => photo.current?.click()} disabled={reading} aria-label="Read a question or clause from a photo" title="Read text from a photo">
          {reading ? <LoaderCircle size={16} className={styles.spin} /> : <Camera size={16} strokeWidth={1.8} />}
        </button>

        {mic && (
          <span className={styles.mic}>
            <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.micBtn}`} onClick={toggleMic}
              aria-pressed={listening} aria-label={listening ? 'Stop dictation' : 'Dictate your question'} title={listening ? 'Stop' : 'Dictate'}>
              {listening ? <Square size={13} strokeWidth={2.4} /> : <Mic size={16} strokeWidth={1.8} />}
            </button>
            <button type="button" className={styles.lang} onClick={() => setLang((l) => (l === 'en-IN' ? 'hi-IN' : 'en-IN'))} disabled={listening}
              aria-label={`Dictation language: ${lang === 'en-IN' ? 'English' : 'Hindi'}. Switch`} title="Dictation language">
              {lang === 'en-IN' ? 'EN' : 'हि'}
            </button>
          </span>
        )}

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
