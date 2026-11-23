import { useEffect, useRef, useState } from 'react'
import { ArrowUp, AudioLines, Camera, Check, ChevronUp, FileText, ImageUp, LoaderCircle, Mic, Paperclip, Square, TriangleAlert, X } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { canDictate, canSpeak, dictate, saveVoiceLang, savedVoiceLang, stopSpeaking, VOICE_LABEL, VOICE_LANGS, VOICE_NAME, type VoiceLang } from '../lib/speech'
import { CameraCapture } from './CameraCapture'
import styles from './Composer.module.css'
import { tr } from '../lib/i18n'

export type InputMode = 'typed' | 'camera' | 'voice'

/** A PDF added from this box, shown as a chip above the question until the next question is sent (as in ChatGPT). */
export interface Attachment {
  key: string
  name: string
  state: 'uploading' | 'working' | 'ready' | 'failed'
  detail?: string | null
}
/**
 * speakReply: read the answer aloud when it arrives (voice conversation only).
 * replyLang: write the answer in Hindi or Chhattisgarhi (the language picked next to the mic); absent = follow the question.
 */
export interface AskOptions {
  speakReply?: boolean
  replyLang?: 'hi' | 'hne'
}

/** Each language in its own script, as the menu lists it. */
const NATIVE_NAME: Record<VoiceLang, string> = { en: 'English', hi: 'हिन्दी', hne: 'छत्तीसगढ़ी' }

/** Prompts shown while listening, in the language being spoken. */
const LISTEN_NOTE: Record<VoiceLang, { dictate: string; converse: string }> = {
  en: { dictate: 'Listening… speak your question. Pausing is fine.', converse: 'Listening… ask your question. When you stop, it is sent and the answer is read aloud.' },
  hi: { dictate: 'सुन रहा हूँ… अपना प्रश्न बोलिए', converse: 'सुन रहा हूँ… रुकते ही प्रश्न भेजा जाएगा और उत्तर पढ़ा जाएगा' },
  hne: { dictate: 'सुनत हँव… अपन सवाल बोलव', converse: 'सुनत हँव… रुकतेच सवाल भेजे जाही अउ जवाब पढ़ के सुनाए जाही' },
}

const todayISO = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

const canUseCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

interface Props {
  onSubmit: (question: string, asOf: string, mode: InputMode, opts?: AskOptions) => void
  busy?: boolean
  /** Stop the answer being produced; while `busy`, the Ask button becomes Stop. */
  onStop?: () => void
  initial?: { question: string; asOf: string }
  onCancel?: () => void
  autoFocus?: boolean
  compact?: boolean
  submitLabel?: string
  /** Add PDFs to this chat (paperclip). Omitted where uploading makes no sense, e.g. editing a past question. */
  onAttach?: (files: File[]) => void
  /** PDFs just added, with their progress; each can be removed again. */
  attachments?: Attachment[]
  onRemoveAttachment?: (key: string) => void
  /** Documents are still being uploaded or read: typing is fine, sending waits until they are ready. */
  waiting?: boolean
}

const ATTACH_LABEL: Record<Attachment['state'], string> = { uploading: 'Uploading…', working: 'Reading…', ready: 'Ready', failed: 'Failed' }

/**
 * Question box: the date the rule should be checked on, PDFs for this chat, text from an image or a live photo,
 * dictation into the box (you review and press Ask), and a voice conversation (speak, it asks when you pause and
 * reads the answer aloud).
 */
export function Composer({ onSubmit, busy, initial, onCancel, autoFocus, compact, submitLabel, onAttach, attachments, onRemoveAttachment, waiting, onStop }: Props) {
  const [q, setQ] = useState(initial?.question ?? '')
  const [asOf, setAsOf] = useState(initial?.asOf ?? todayISO())
  const [mode, setMode] = useState<InputMode>('typed')
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [listening, setListening] = useState<'dictate' | 'converse' | null>(null)
  const [lang, setLangState] = useState<VoiceLang>(() => savedVoiceLang(tr('Ask') !== 'Ask')) // remembered; a Hindi interface starts in Hindi
  const setLang = (l: VoiceLang) => {
    setLangState(l)
    saveVoiceLang(l)
  }
  const [langOpen, setLangOpen] = useState(false)
  const langWrap = useRef<HTMLSpanElement>(null)
  // the language menu closes on a click outside it or on Escape
  useEffect(() => {
    if (!langOpen) return
    const away = (e: PointerEvent) => {
      if (!langWrap.current?.contains(e.target as Node)) setLangOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLangOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [langOpen])
  const replyLang = lang === 'en' ? undefined : lang
  const [camera, setCamera] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const imagePick = useRef<HTMLInputElement>(null)
  const photoCapture = useRef<HTMLInputElement>(null)
  const pdfs = useRef<HTMLInputElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const heard = useRef('')
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
    if (text.length < 2 || busy || waiting) return
    stopRef.current?.()
    onSubmit(text, asOf, mode, { replyLang })
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
    setNote(lang === 'en' ? tr(LISTEN_NOTE.en[kind]) : LISTEN_NOTE[lang][kind])
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
          if (text.length >= 2 && waiting) {
            setNote(tr('Your question is in the box. Send it once the documents are ready.')) // never sent before they are
            return
          }
          if (text.length >= 2 && !busy) {
            onSubmit(text, asOf, 'voice', { speakReply: canSpeak(), replyLang })
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
      {!!attachments?.length && (
        <ul className={styles.files} aria-label={tr('Attached PDFs')}>
          {attachments.map((a) => (
            <li key={a.key} className={styles.file} data-state={a.state} title={a.state === 'failed' && a.detail ? a.detail : a.name}>
              <span className={styles.fileIcon} aria-hidden="true">
                {a.state === 'uploading' || a.state === 'working' ? <LoaderCircle size={15} className={styles.spin} />
                  : a.state === 'failed' ? <TriangleAlert size={15} strokeWidth={1.8} /> : <FileText size={15} strokeWidth={1.8} />}
              </span>
              <span className={styles.fileText}>
                <span className={styles.fileName}>{a.name}</span>
                <span className={styles.fileState}>{a.state === 'failed' && a.detail ? a.detail : tr(ATTACH_LABEL[a.state])}</span>
              </span>
              {onRemoveAttachment && a.state !== 'uploading' && (
                <button type="button" className={styles.fileRemove} onClick={() => onRemoveAttachment(a.key)} aria-label={tr('Remove {title} from this chat', { title: a.name })}>
                  <X size={13} strokeWidth={2} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {waiting && <p className={styles.note} role="status">{tr('Your documents are still being read. You can type now and send once they are ready.')}</p>}
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
            <button type="button" data-tour="upload" className="btn btn-quiet btn-icon btn-sm" onClick={() => pdfs.current?.click()} aria-label={tr('Add PDFs to this chat')} title={tr('Add PDFs to this chat')}>
              <Paperclip size={16} strokeWidth={1.8} />
            </button>
          </>
        )}

        {/* text from an image: pick a saved one, or take a live photo */}
        <input ref={imagePick} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickImage} />
        <input ref={photoCapture} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" hidden onChange={pickImage} />
        <button type="button" data-tour="image" className="btn btn-quiet btn-icon btn-sm" onClick={() => imagePick.current?.click()} disabled={reading}
          aria-label={tr('Upload an image of a question or clause')} title={tr('Upload an image')}>
          {reading ? <LoaderCircle size={16} className={styles.spin} /> : <ImageUp size={16} strokeWidth={1.8} />}
        </button>
        <button type="button" data-tour="camera" className="btn btn-quiet btn-icon btn-sm" disabled={reading}
          onClick={() => (canUseCamera() ? setCamera(true) : photoCapture.current?.click())}
          aria-label={tr('Take a photo of a question or clause')} title={tr('Take a photo')}>
          <Camera size={16} strokeWidth={1.8} />
        </button>

        {mic && (
          <span className={styles.mic}>
            <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.micBtn}`} data-tour="mic" onClick={() => listen('dictate')}
              data-on={listening === 'dictate' || undefined} disabled={listening === 'converse'}
              aria-pressed={listening === 'dictate'} aria-label={tr(listening === 'dictate' ? 'Stop dictation' : 'Dictate your question into the box')} title={tr(listening === 'dictate' ? 'Stop' : 'Dictate')}>
              {listening === 'dictate' ? <Square size={13} strokeWidth={2.4} /> : <Mic size={16} strokeWidth={1.8} />}
            </button>
            <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.micBtn} ${styles.converse}`} data-tour="voice" onClick={() => listen('converse')}
              data-on={listening === 'converse' || undefined} disabled={busy || listening === 'dictate'}
              aria-pressed={listening === 'converse'} aria-label={tr(listening === 'converse' ? 'Stop listening' : 'Voice conversation: speak, and hear the answer')} title={listening === 'converse' ? tr('Stop') : tr('Speak and hear the answer')}>
              {listening === 'converse' ? <Square size={13} strokeWidth={2.4} /> : <AudioLines size={16} strokeWidth={1.8} />}
            </button>
            <span className={styles.langWrap} ref={langWrap} data-tour="answer-lang">
              <button type="button" className={styles.lang} onClick={() => setLangOpen((o) => !o)} disabled={!!listening}
                lang={lang === 'en' ? undefined : 'hi'} aria-haspopup="menu" aria-expanded={langOpen}
                aria-label={tr('Voice and answer language: {name}. Change', { name: VOICE_NAME[lang] })}
                title={tr('Voice and answer language: {name}', { name: VOICE_NAME[lang] })}>
                {VOICE_LABEL[lang]} <ChevronUp size={11} strokeWidth={2.4} aria-hidden="true" />
              </button>
              {langOpen && (
                <span className={styles.langMenu} role="menu" aria-label={tr('Voice and answer language')}>
                  <span className={styles.langHead}>{tr('Speak and answer in')}</span>
                  {VOICE_LANGS.map((l) => (
                    <button key={l} type="button" role="menuitemradio" aria-checked={l === lang} className={styles.langItem}
                      autoFocus={l === lang} onClick={() => { setLang(l); setLangOpen(false) }}>
                      <span lang={l === 'en' ? 'en' : 'hi'}>{NATIVE_NAME[l]}</span>
                      {l !== 'en' && <span className={styles.langSub}>{VOICE_NAME[l]}</span>}
                      {l === lang && <Check size={14} strokeWidth={2.2} className={styles.langCheck} aria-hidden="true" />}
                    </button>
                  ))}
                </span>
              )}
            </span>
          </span>
        )}

        <span className={styles.spacer} />
        {onCancel && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>{tr('Cancel')}</button>
        )}
        {busy && onStop ? (
          // an answer is being produced: the send button becomes Stop, as in ChatGPT
          <button type="button" className={`btn btn-primary btn-sm ${styles.send}`} onClick={onStop}
            aria-label={tr('Stop the answer')} title={tr('Stop the answer')}>
            {tr('Stop')} <Square size={12} strokeWidth={2.6} aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" data-tour="ask" className={`btn btn-primary btn-sm ${styles.send}`} disabled={busy || waiting || q.trim().length < 2}
            title={waiting ? tr('Wait until the documents are ready') : undefined}>
            {submitLabel ?? tr('Ask')} <ArrowUp size={15} strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
      </div>
      {camera && <CameraCapture onCapture={readPhoto} onClose={() => setCamera(false)} />}
    </form>
  )
}
