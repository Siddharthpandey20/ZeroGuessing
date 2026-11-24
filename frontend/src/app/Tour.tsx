import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { tr } from '../lib/i18n'
import styles from './Tour.module.css'

/**
 * First-run tour of the workspace: everything but the feature being shown is dimmed and blurred, a ring marks the
 * feature, and a card explains it with Skip / Back / Next.
 *
 * Features are found by their `data-tour="..."` attribute. A step lists the keys it may point at, best first: a
 * first-time user has no chat yet, so Rename and Share are not on screen, and on a phone the chat list (with New chat)
 * is folded away. Then the step points at the next key on the list (the chat name, the rail toggle) and shows its
 * `alt` text, which says where the feature appears. A step whose keys are all missing (no microphone in this
 * browser) is skipped.
 *
 * Starts by itself on a user's first visit to the Ask page (remembered per user in this browser); "Take the tour" in
 * the profile menu starts it again by dispatching START_TOUR.
 */
export const START_TOUR = 'zg-start-tour'
const doneKey = (userId: string) => `zg-tour-done:${userId}`

interface Step {
  targets?: string[]
  title: string
  body: string
  /** shown when the step points at a stand-in (a later key in `targets`) because the feature itself is not on screen */
  alt?: string
}

const STEPS: Step[] = [
  {
    title: 'Welcome to ZeroGuess',
    body: 'A one-minute tour of the workspace. Every answer you get here comes with the exact quote that proves it, or an honest “I don’t have proof”.',
  },
  {
    targets: ['new-chat', 'rail-toggle'],
    title: 'Start a new chat',
    body: 'Each chat keeps its own documents, so its answers come only from the PDFs you add to it. Your earlier chats are listed here.',
    alt: 'Open your chats here to start a new chat or go back to an earlier one. Each chat keeps its own documents.',
  },
  {
    targets: ['rename', 'chat-name'],
    title: 'Rename a chat',
    body: 'Click the pencil, or double-click the name, to call this chat something you will recognise.',
    alt: 'Your chat’s name appears here. It is named after your first question; then a pencil next to it lets you rename it.',
  },
  {
    targets: ['share', 'chat-bar'],
    title: 'Share with a link',
    body: 'Make a read-only link to this chat: whoever opens it sees the answers and the quoted proof. Links expire, and you can revoke them.',
    alt: 'After your first answer, a Share button appears up here. It makes a read-only link to the answers and their quoted proof.',
  },
  {
    targets: ['upload-empty', 'upload'],
    title: 'Add your documents',
    body: 'Upload the PDFs this chat should answer from, digital or scanned. You can also drag and drop PDFs anywhere in the chat.',
  },
  {
    targets: ['ui-lang'],
    title: 'English or Hindi screens',
    body: 'Switch the menus and buttons between English and Hindi.',
  },
  {
    targets: ['answer-lang'],
    title: 'Your language: English, हिन्दी or छत्तीसगढ़ी',
    body: 'Open this menu to pick the language you speak in and want answers in. Hindi and Chhattisgarhi answers keep every number exactly as in the document.',
  },
  {
    targets: ['mic'],
    title: 'Speak your question',
    body: 'Press the mic and speak: your words are typed into the box, so you can check them before pressing Ask.',
  },
  {
    targets: ['voice'],
    title: 'Voice conversation',
    body: 'Hands-free: ask aloud, the question is sent when you pause, and the answer is read back to you. Press again to stop.',
  },
  {
    targets: ['image'],
    title: 'Upload an image',
    body: 'Have a screenshot or a saved photo of a question or a clause? Upload it and its text is read into the box for you to check.',
  },
  {
    targets: ['camera'],
    title: 'Take a photo',
    body: 'Point your camera at a printed clause or letter. Its text is read into the box; check it before you ask.',
  },
  {
    targets: ['ask'],
    title: 'Ask',
    body: 'Type your question and press Ask. Each sentence of the answer is checked against your documents; hover a citation to see the passage on its page.',
  },
]

const PAD = 6 // space between the feature and its ring
const GAP = 14 // space between the ring and the card
const EDGE = 12 // the card never touches the window edge

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
  const s = getComputedStyle(el)
  return s.visibility !== 'hidden' && s.display !== 'none'
}

/** The first key of the step that is on screen, and its element. */
function locate(step: Step): { el: HTMLElement; alt: boolean } | null {
  for (const [i, key] of (step.targets ?? []).entries()) {
    const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`)).find(visible)
    if (el) return { el, alt: i > 0 }
  }
  return null
}

const usable = (s: Step) => !s.targets || locate(s) !== null

interface Box { x: number; y: number; w: number; h: number }

export function Tour({ userId }: { userId: string }) {
  const { pathname } = useLocation()
  const onAsk = !/^\/app\/(library|alerts|profile)/.test(pathname)
  const [i, setI] = useState<number | null>(null)
  const [hole, setHole] = useState<Box | null>(null)
  const [alt, setAlt] = useState(false)
  const [card, setCard] = useState({ w: 360, h: 200 })
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    try { localStorage.setItem(doneKey(userId), '1') } catch { /* private mode: it may show again */ }
    setI(null)
  }, [userId])

  /** Move from step `from` in direction `dir` to the next step whose feature can be shown. */
  const go = useCallback((from: number, dir: 1 | -1) => {
    for (let n = from + dir; n >= 0 && n < STEPS.length; n += dir) {
      if (usable(STEPS[n])) return setI(n)
    }
    if (dir === 1) close()
  }, [close])

  // first visit: start once the Ask page has drawn; "Take the tour" starts it again from anywhere
  useEffect(() => {
    const start = () => setI(0)
    window.addEventListener(START_TOUR, start)
    let t: number | undefined
    let seen = true
    try { seen = !!localStorage.getItem(doneKey(userId)) } catch { /* treat as seen */ }
    if (!seen && onAsk) t = window.setTimeout(start, 700)
    return () => {
      window.removeEventListener(START_TOUR, start)
      window.clearTimeout(t)
    }
  }, [userId, onAsk])

  // measure the feature now and whenever the page moves under it
  const measure = useCallback(() => {
    if (i === null) return
    const found = locate(STEPS[i])
    if (!found) return setHole(null)
    const r = found.el.getBoundingClientRect()
    setAlt(found.alt)
    setHole({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 })
  }, [i])

  useLayoutEffect(() => {
    if (i === null) return
    locate(STEPS[i])?.el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    measure()
    const again = window.setTimeout(measure, 260) // after any scroll or layout settles
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearTimeout(again)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [i, measure])

  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (Math.abs(r.width - card.w) > 1 || Math.abs(r.height - card.h) > 1) setCard({ w: r.width, h: r.height })
  }, [i, alt, card.w, card.h]) // the card's size changes with its text

  // keyboard: Esc skips, arrows move; focus stays in the card while the rest of the page is shaded
  useEffect(() => {
    if (i === null) return
    nextRef.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(i, 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i, -1) }
    }
    const keepFocus = (e: FocusEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) nextRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', keepFocus)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', keepFocus)
    }
  }, [i, go, close])

  if (i === null) return null
  const step = STEPS[i]
  const shown = STEPS.filter(usable)
  const pos = shown.indexOf(step) + 1
  const last = !STEPS.slice(i + 1).some(usable)
  const first = !STEPS.slice(0, i).some(usable)

  // the card goes below the feature, else above it, else beside it; the welcome card sits in the middle
  const vw = innerWidth
  const vh = innerHeight
  let top: number
  let left: number
  if (!hole) {
    top = (vh - card.h) / 2
    left = (vw - card.w) / 2
  } else {
    const below = hole.y + hole.h + GAP
    const above = hole.y - GAP - card.h
    left = hole.x + hole.w / 2 - card.w / 2
    if (below + card.h <= vh - EDGE) top = below
    else if (above >= EDGE) top = above
    else { // beside: right of the feature if there is room, else left of it
      top = hole.y + hole.h / 2 - card.h / 2
      left = hole.x + hole.w + GAP + card.w <= vw - EDGE ? hole.x + hole.w + GAP : hole.x - GAP - card.w
    }
  }
  left = Math.min(Math.max(left, EDGE), vw - card.w - EDGE)
  top = Math.min(Math.max(top, EDGE), Math.max(EDGE, vh - card.h - EDGE))

  const panels = hole
    ? [
        { left: 0, top: 0, width: vw, height: Math.max(0, hole.y) },
        { left: 0, top: hole.y + hole.h, width: vw, height: Math.max(0, vh - hole.y - hole.h) },
        { left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.h },
        { left: hole.x + hole.w, top: hole.y, width: Math.max(0, vw - hole.x - hole.w), height: hole.h },
      ]
    : [{ left: 0, top: 0, width: vw, height: vh }]

  return (
    <div className={styles.tour}>
      {panels.map((p, n) => <div key={n} className={styles.shade} style={p} />)}
      {hole && (
        <>
          {/* the feature is shown but not clickable during the tour */}
          <div className={styles.block} style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} />
          <div className={styles.ring} style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} aria-hidden="true" />
        </>
      )}
      <div ref={cardRef} className={styles.card} style={{ top, left }} role="dialog" aria-modal="true"
        aria-labelledby="tour-title" aria-describedby="tour-body">
        <div className={styles.meta}>
          <span className="tnum">{tr('{n} of {total}', { n: pos, total: shown.length })}</span>
          <span className={styles.dots} aria-hidden="true">
            {shown.map((s) => <i key={s.title} data-on={s === step || undefined} />)}
          </span>
        </div>
        <h2 id="tour-title" className={styles.title}>{tr(step.title)}</h2>
        <p id="tour-body" className={styles.body}>{tr(alt && step.alt ? step.alt : step.body)}</p>
        <div className={styles.actions}>
          {!last && <button type="button" className="btn btn-quiet btn-sm" onClick={close}>{tr('Skip tour')}</button>}
          <span className={styles.spacer} />
          {!first && <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(i, -1)}>{tr('Back')}</button>}
          <button ref={nextRef} type="button" className="btn btn-primary btn-sm" onClick={() => (last ? close() : go(i, 1))}>
            {tr(last ? 'Finish' : first ? 'Start the tour' : 'Next')}
          </button>
        </div>
      </div>
    </div>
  )
}
