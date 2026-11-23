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

/**
 * The language you speak and hear: English, Hindi or Chhattisgarhi. It is also the language the answer is written in.
 * No browser has a Chhattisgarhi recogniser or voice, so Chhattisgarhi listens and speaks with the Hindi ones: both
 * are written in Devanagari and close enough for dictation and reading aloud, while the answer itself is written in
 * Chhattisgarhi by the backend.
 */
export type VoiceLang = 'en' | 'hi' | 'hne'
export const VOICE_LANGS: VoiceLang[] = ['en', 'hi', 'hne']
export const VOICE_LABEL: Record<VoiceLang, string> = { en: 'EN', hi: 'हिं', hne: 'छग' }
export const VOICE_NAME: Record<VoiceLang, string> = { en: 'English', hi: 'Hindi', hne: 'Chhattisgarhi' }
const BCP47: Record<VoiceLang, string> = { en: 'en-IN', hi: 'hi-IN', hne: 'hi-IN' }

const PREF = 'zg-voice-lang'
/** The last language picked, else the interface's (a Hindi interface listens in Hindi). */
export function savedVoiceLang(uiHindi: boolean): VoiceLang {
  try {
    const v = localStorage.getItem(PREF)
    if (v === 'en' || v === 'hi' || v === 'hne') return v
  } catch {
    /* private mode */
  }
  return uiHindi ? 'hi' : 'en'
}
export function saveVoiceLang(l: VoiceLang) {
  try {
    localStorage.setItem(PREF, l)
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}
const asVoiceLang = (l: string | undefined | null): VoiceLang => (l === 'hi' || l === 'hne' ? l : 'en')

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser’s site settings.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in the browser’s site settings.',
  'no-speech': 'No speech was heard. Try again a little closer to the microphone.',
  'audio-capture': 'No microphone was found.',
  network: 'Dictation needs an internet connection in this browser.',
  'language-not-supported': 'This browser cannot listen in this language. Try Chrome or Edge.',
}

/**
 * Start dictation. `onText` gets the running transcript; returns a stop function.
 * The browser's own end-of-speech cut-off is about a second, so a stutter or a breath ended the take. Here the
 * recogniser runs continuously and we stop it ourselves: after `pauseMs` without new words once something was said,
 * or after `idleMs` if nothing is said at all.
 */
export function dictate(
  lang: VoiceLang,
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
  r.lang = BCP47[lang]
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

const NO_PROOF: Record<VoiceLang, string> = {
  en: "I don't have proof for this.",
  hi: 'इसका प्रमाण दस्तावेज़ों में नहीं मिला। कारण स्क्रीन पर देखें।',
  hne: 'एकर परमान दस्तावेज मन म नइ मिलिस। कारन स्क्रीन म देखव।',
}
const DISAGREE: Record<VoiceLang, string> = {
  en: 'Note: the documents disagree on this. Compare the quotes on screen.',
  hi: 'ध्यान दें: इस बात पर दस्तावेज़ों में विरोधाभास है। स्क्रीन पर दोनों उद्धरण देखें।',
  hne: 'धियान देवव: ए बात म दस्तावेज मन म फरक हावय। स्क्रीन म दूनों उद्धरण देखव।',
}

/** What "Listen" reads: the verified answer only (blocked claims are never spoken), or the abstention. */
export function spokenAnswer(a: Answer): { text: string; lang: VoiceLang } {
  const lang = asVoiceLang(a.lang)
  const translated = lang !== 'en'
  if (a.status === 'chat') return { text: a.reply ?? '', lang }
  if (a.status === 'abstained') {
    // the reasons are written in English: read them out only in English, otherwise point to the screen
    const missing = !translated && a.abstention?.missing?.length ? ` ${a.abstention.missing.join('. ')}.` : ''
    return { text: `${NO_PROOF[lang]}${missing}`, lang }
  }
  const said = a.claims
    .filter((c) => c.verdict === 'supported' || c.verdict === 'conflicted')
    .map((c) => (translated && c.text_hi ? c.text_hi : c.text).trim())
  if (a.contradictions?.length) said.push(DISAGREE[lang])
  return { text: said.join(' '), lang }
}

/** Voices load after the page does: Chrome returns an empty list at first and fires `voiceschanged` later. */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = window.speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.speechSynthesis.removeEventListener('voiceschanged', finish)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', finish)
    window.setTimeout(finish, 2000)
  })
}
if (canSpeak()) void loadVoices() // start loading early, so the first answer does not wait

const tag = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase()

/** The best voice for a language: natural (neural) voices first, then ones on this device, then any. */
function pickVoice(voices: SpeechSynthesisVoice[], lang: VoiceLang): SpeechSynthesisVoice | null {
  const want = BCP47[lang].toLowerCase()
  const base = want.slice(0, 2)
  const fits = voices.filter((v) => tag(v) === want || tag(v) === base || tag(v).startsWith(`${base}-`))
  if (!fits.length) return null
  const score = (v: SpeechSynthesisVoice) =>
    (tag(v) === want ? 4 : 0) + (/natural|neural|online/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0)
  return [...fits].sort((a, b) => score(b) - score(a))[0]
}

/**
 * Short pieces, one sentence (or part of a long one) each. Chrome's network voices, the only Hindi voice on many
 * Windows machines, stop after about 15 seconds of speech and never report the end, so one long utterance went silent
 * half-way and the voice conversation never heard it finish.
 */
function pieces(text: string, max = 180): string[] {
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.!?।])\s+/)) {
    let rest = sentence.trim()
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf(' ', max))
      const at = cut > 40 ? cut + 1 : max
      out.push(rest.slice(0, at).trim())
      rest = rest.slice(at).trim()
    }
    if (rest) out.push(rest)
  }
  return out
}

const RUPEES: Record<VoiceLang, string> = { en: 'rupees ', hi: 'रुपये ', hne: 'रुपिया ' }
const MISSING_VOICE =
  'No Hindi voice is installed in this browser, so the answer cannot be read aloud (Chhattisgarhi is read with a Hindi voice). ' +
  'Use Chrome or Edge, or add Hindi in Windows Settings › Time & language › Speech.'

let session = 0
let queue: SpeechSynthesisUtterance[] = [] // kept referenced: Chrome drops the end event of a garbage-collected utterance

/**
 * Read text aloud, replacing anything already playing. `onEnd` runs when it finishes or is stopped, with a message
 * when it could not be read at all (no voice for the language).
 */
export function speak(text: string, lang: VoiceLang, onEnd: (problem?: string) => void) {
  if (!canSpeak() || !text.trim()) return onEnd()
  const synth = window.speechSynthesis
  const mine = ++session
  synth.cancel()
  queue = []
  void loadVoices().then((voices) => {
    if (mine !== session) return onEnd() // stopped, or replaced by another answer, while voices were loading
    const voice = pickVoice(voices, lang)
    // a Devanagari answer handed to an English voice is skipped in silence: say why instead
    if (!voice && lang !== 'en' && voices.length) return onEnd(MISSING_VOICE)
    const parts = pieces(text.replace(/₹\s?/g, RUPEES[lang]))
    if (!parts.length) return onEnd()
    let left = parts.length
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      window.clearInterval(nudge)
      if (mine === session) queue = []
      onEnd()
    }
    // Chrome can leave the queue paused between pieces: keep it moving until it is done
    const nudge = window.setInterval(() => {
      if (mine !== session) return finish()
      if (synth.paused) synth.resume()
    }, 3000)
    queue = parts.map((p) => {
      const u = new SpeechSynthesisUtterance(p)
      u.lang = BCP47[lang]
      if (voice) u.voice = voice
      u.onend = u.onerror = () => {
        left -= 1
        if (left <= 0 || mine !== session) finish()
      }
      return u
    })
    synth.resume()
    // speaking straight after cancel() is sometimes dropped by Chrome: give the cancel a moment
    window.setTimeout(() => {
      if (mine !== session) return finish()
      for (const u of queue) synth.speak(u)
    }, 60)
  })
}

export function stopSpeaking() {
  session += 1
  queue = []
  if (canSpeak()) window.speechSynthesis.cancel()
}
