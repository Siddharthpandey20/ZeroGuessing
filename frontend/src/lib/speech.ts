// Voice in and out with the browser's own speech services (no backend): Web Speech recognition for dictation,
// speechSynthesis to read an answer aloud. Chrome and Edge support both; Firefox has synthesis only, so the
// microphone hides there. Note: Chrome sends dictated audio to Google's speech service to transcribe it.
import type { Answer } from './types'

interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => Recognition

const ctor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const canDictate = () => ctor() !== null
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

export type SpeechLang = 'en-IN' | 'hi-IN'

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser’s site settings.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in the browser’s site settings.',
  'no-speech': 'No speech was heard. Try again a little closer to the microphone.',
  'audio-capture': 'No microphone was found.',
  network: 'Dictation needs an internet connection in this browser.',
}

/**
 * Start dictation. `onText` gets the running transcript; returns a stop function.
 * The browser's own end-of-speech cut-off is about a second, so a stutter or a breath ended the take. Here the
 * recogniser runs continuously and we stop it ourselves: after `pauseMs` without new words once something was said,
 * or after `idleMs` if nothing is said at all.
 */
export function dictate(
  lang: SpeechLang,
  onText: (text: string) => void,
  onEnd: (error?: string) => void,
  { pauseMs = 2500, idleMs = 8000 }: { pauseMs?: number; idleMs?: number } = {},
): () => void {
  const R = ctor()
  if (!R) {
    onEnd('Dictation is not available in this browser. Try Chrome or Edge.')
    return () => {}
  }
  const r = new R()
  r.lang = lang
  r.interimResults = true
  r.continuous = true
  let failed: string | undefined
  let heard = false
  let ended = false
  let timer = window.setTimeout(() => r.stop(), idleMs)
  r.onresult = (e) => {
    // continuous mode returns one segment per phrase; join them with spaces ("the" + "penal" must not become "thepenal")
    const parts: string[] = []
    for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript.trim())
    const t = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ')
    if (t) heard = true
    onText(t)
    window.clearTimeout(timer)
    timer = window.setTimeout(() => r.stop(), heard ? pauseMs : idleMs)
  }
  r.onerror = (e) => {
    if (e.error !== 'aborted' && !(e.error === 'no-speech' && heard)) failed = ERRORS[e.error] ?? 'Dictation stopped unexpectedly.'
  }
  r.onend = () => {
    if (ended) return
    ended = true
    window.clearTimeout(timer)
    onEnd(failed)
  }
  r.start()
  return () => {
    window.clearTimeout(timer)
    r.stop()
  }
}

/** What "Listen" reads: the verified answer only (blocked claims are never spoken), or the abstention. */
export function spokenAnswer(a: Answer): { text: string; lang: SpeechLang } {
  const hindi = a.lang === 'hi'
  const lang: SpeechLang = hindi ? 'hi-IN' : 'en-IN'
  if (a.status === 'chat') return { text: a.reply ?? '', lang }
  if (a.status === 'abstained') {
    const missing = a.abstention?.missing?.length ? ` ${a.abstention.missing.join('. ')}.` : ''
    return { text: `I don't have proof for this.${missing}`, lang: 'en-IN' }
  }
  const said = a.claims
    .filter((c) => c.verdict === 'supported' || c.verdict === 'conflicted')
    .map((c) => (hindi && c.text_hi ? c.text_hi : c.text).trim())
  if (a.contradictions?.length) said.push(hindi ? 'दस्तावेज़ों में एक विरोधाभास है।' : 'Note: the documents disagree on this. Compare the quotes on screen.')
  return { text: said.join(' '), lang }
}

let current: SpeechSynthesisUtterance | null = null

/** Read text aloud, replacing anything already playing. `onEnd` runs when it finishes or is stopped. */
export function speak(text: string, lang: SpeechLang, onEnd: () => void) {
  if (!canSpeak()) return onEnd()
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text.replace(/₹/g, 'rupees '))
  u.lang = lang
  const voices = window.speechSynthesis.getVoices()
  const voice = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)))
  if (voice) u.voice = voice
  u.onend = u.onerror = () => {
    if (current === u) current = null
    onEnd()
  }
  current = u
  window.speechSynthesis.speak(u)
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel()
  current = null
}
