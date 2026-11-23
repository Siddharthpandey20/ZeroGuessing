import { useEffect, useRef, useState } from 'react'
import { ArrowUp, AudioLines, Camera, ImageUp, LoaderCircle, Mic, Paperclip, Square } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { canDictate, canSpeak, dictate, stopSpeaking, type SpeechLang } from '../lib/speech'
import { CameraCapture } from './CameraCapture'
import styles from './Composer.module.css'
import { tr } from '../lib/i18n'

export type InputMode = 'typed' | 'camera' | 'voice'
/** speakReply: read the answer aloud when it arrives (voice conversation only). */
export interface AskOptions {
  speakReply?: boolean
}

const todayISO = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

const canUseCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

interface Props {
  onSubmit: (question: string, asOf: string, mode: InputMode, opts?: AskOptions) => void
  busy?: boolean
  initial?: { question: string; asOf: string }
  onCancel?: () => void
  autoFocus?: boolean
  compact?: boolean
  submitLabel?: string
  /** Add PDFs to this chat (paperclip). Omitted where uploading makes no sense, e.g. editing a past question. */
  onAttach?: (files: File[]) => void
}

/**
 * Question box: the date the rule should be checked on, PDFs for this chat, text from an image or a live photo,
 * dictation into the box (you review and press Ask), and a voice conversation (speak, it asks when you pause and
 * reads the answer aloud).
 */
export function Composer({ onSubmit, busy, initial, onCancel, autoFocus, compact, submitLabel, onAttach }: Props) {
  const [q, setQ] = useState(initial?.question ?? '')
  const [asOf, setAsOf] = useState(initial?.asOf ?? todayISO())
  const [mode, setMode] = useState<InputMode>('typed')
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [listening, setListening] = useState<'dictate' | 'converse' | null>(null)
  const [lang, setLang] = useState<SpeechLang>(() => (tr('Ask') === 'Ask' ? 'en-IN' : 'hi-IN')) // a Hindi interface dictates Hindi
  const [camera, setCamera] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const imagePick = useRef<HTMLInputElement>(null)
  const photoCapture = useRef<HTMLInputElement>(null)
  const pdfs = useRef<HTMLInputElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const heard = useRef('')
  const mic = canDictate()
  const hi = lang === 'hi-IN'

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

  /** Mic: dictation into the box. Voice conversation: the same, then it asks by itself and reads the answer. */
  const listen = (kind: 'dictate' | 'converse') => {
    if (listening) {
      stopRef.current?.() // a second press ends the take early
      return
    }
    stopSpeaking() // never transcribe our own voice
    const before = kind === 'dictate' ? q.trim() : ''
    heard.current = before
    setNote(
      kind === 'dictate'
        ? (hi ? 'सुन रहा हूँ… बोलिए' : tr('Listening… speak your question. Pausing is fine.'))
        : (hi ? 'सुन रहा हूँ… रुकते ही प्रश्न भेजा जाएगा और उत्तर पढ़ा जाएगा' : 'Listening… ask your question. When you stop, it is sent and the answer is read aloud.'),
    )
    setListening(kind)
    stopRef.current = dictate(
      lang,
      (t) => {
        heard.current = before ? `${before} ${t}` : t
        setQ(heard.current)
        setMode('voice')
      },
      (error) => {
        setListening(null)
        stopRef.current = null
        const text = heard.current.trim()
        if (kind === 'converse') {
          if (text.length >= 2 && !busy) {
            onSubmit(text, asOf, 'voice', { speakReply: canSpeak() })
            setQ('')
            setMode('typed')
            setNote(null)
            return
          }
          setNote(error ?? tr('I didn’t catch a question. Press the voice button and try again.'))
          return
        }
        setNote(error ?? tr('Check the words, then press Ask.'))
        ta.current?.focus()
      },
    )
  }

  const readPhoto = async (f: File) => {
    setCamera(false)
    setReading(true)
    setNote(null)
    try {
      const fd = new FormData()
      fd.append('image', f)
      const r = await api<{ text: string; note: string }>('/api/camera/transcribe', { method: 'POST', body: fd })
      setQ(r.text.trim())
      setMode('camera')
      setNote(tr('Read from the image. Check the text before you ask.'))
      ta.current?.focus()
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : tr('The image could not be read.'))
    } finally {
      setReading(false)
      if (imagePick.current) imagePick.current.value = ''
      if (photoCapture.current) photoCapture.current.value = ''
    }
  }

  const pickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void readPhoto(f)
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
      <label className="sr-only" htmlFor="question">{tr('Question')}</label>
      <textarea
        id="question"
        ref={ta}
        className={styles.input}
        rows={1}
        placeholder={tr('Ask about this chat’s documents, in English or Hindi')}
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
          <span>{tr('Rule in force on')}</span>
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
            <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => pdfs.current?.click()} aria-label={tr('Add PDFs to this chat')} title={tr('Add PDFs to this chat')}>
              <Paperclip size={16} strokeWidth={1.8} />
            </button>
          </>
        )}

        {/* text from an image: pick a saved one, or take a live photo */}
        <input ref={imagePick} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickImage} />
        <input ref={photoCapture} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" hidden onChange={pickImage} />
        <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => imagePick.current?.click()} disabled={reading}
          aria-label={tr('Upload an image of a question or clause')} title={tr('Upload an image')}>
          {reading ? <LoaderCircle size={16} className={styles.spin} /> : <ImageUp size={16} strokeWidth={1.8} />}
        </button>
        <button type="button" className="btn btn-quiet btn-icon btn-sm" disabled={reading}
          onClick={() => (canUseCamera() ? setCamera(true) : photoCapture.current?.click())}
          aria-label={tr('Take a photo of a question or clause')} title={tr('Take a photo')}>
          <Camera size={16} strokeWidth={1.8} />
        </button>

        {mic && (
          <span className={styles.mic}>
            <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.micBtn}`} onClick={() => listen('dictate')}
              data-on={listening === 'dictate' || undefined} disabled={listening === 'converse'}
              aria-pressed={listening === 'dictate'} aria-label={tr(listening === 'dictate' ? 'Stop dictation' : 'Dictate your question into the box')} title={tr(listening === 'dictate' ? 'Stop' : 'Dictate')}>
              {listening === 'dictate' ? <Square size={13} strokeWidth={2.4} /> : <Mic size={16} strokeWidth={1.8} />}
            </button>
            <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.micBtn} ${styles.converse}`} onClick={() => listen('converse')}
              data-on={listening === 'converse' || undefined} disabled={busy || listening === 'dictate'}
              aria-pressed={listening === 'converse'} aria-label={tr(listening === 'converse' ? 'Stop listening' : 'Voice conversation: speak, and hear the answer')} title={listening === 'converse' ? tr('Stop') : tr('Speak and hear the answer')}>
              {listening === 'converse' ? <Square size={13} strokeWidth={2.4} /> : <AudioLines size={16} strokeWidth={1.8} />}
            </button>
            <button type="button" className={styles.lang} onClick={() => setLang((l) => (l === 'en-IN' ? 'hi-IN' : 'en-IN'))} disabled={!!listening}
              aria-label={tr(hi ? 'Speech language: Hindi. Switch' : 'Speech language: English. Switch')} title={tr('Speech language')}>
              {hi ? 'हि' : 'EN'}
            </button>
          </span>
        )}

        <span className={styles.spacer} />
        {onCancel && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>{tr('Cancel')}</button>
        )}
        <button type="submit" className={`btn btn-primary btn-sm ${styles.send}`} disabled={busy || q.trim().length < 2}>
          {submitLabel ?? tr('Ask')} <ArrowUp size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      {camera && <CameraCapture onCapture={readPhoto} onClose={() => setCamera(false)} />}
    </form>
  )
}
